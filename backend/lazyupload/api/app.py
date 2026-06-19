"""FastAPI application factory for the uploader sidecar."""
import asyncio
import os
import threading
import uuid
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import Depends, FastAPI, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware

from lazyupload import entitlement, service, soundcloud
from lazyupload.api.auth import require_token, ws_token_ok
from lazyupload.api.progress import ProgressHub
from lazyupload.api.schemas import (
    AccountActivateRequest, ActivateRequest, ArtworkRequest, BulkArtworkRequest,
    BulkDeleteRequest, BulkTrackUpdate, Config, DisconnectRequest, ScanRequest,
    TrackUpdate, UploadRequest, WipRequest,
)
from lazyupload.catalog import Catalog
from lazyupload.connect import SoundCloudConnectSession
from lazyupload.scheduler import UploadScheduler


def create_app(token: str, db_path: Path) -> FastAPI:
    catalog = Catalog(Path(db_path))
    hub = ProgressHub()
    scheduler = UploadScheduler(catalog, hub)  # scheduled runs stream to the UI

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        hub.bind_loop(asyncio.get_running_loop())
        saved = catalog.get_setting("config") or {}
        scheduler.set_interval(saved.get("interval_minutes", 0))
        yield
        scheduler.shutdown()
        catalog.close()

    app = FastAPI(title="lazyupload", lifespan=lifespan)
    # Localhost-only service: allow only the renderer's real origins (dev Vite + the
    # packaged file:// renderer, which sends Origin: null). Auth is the real boundary.
    # The dev Vite port defaults to 5173 but can be overridden (LAZYUP_VITE_PORT) so the
    # app can run alongside the sibling tool, which also defaults to 5173.
    _dev_ports = {"5173", os.environ.get("LAZYUP_VITE_PORT", "5173")}
    _dev_origins = [f"http://{host}:{p}" for p in sorted(_dev_ports)
                    for host in ("localhost", "127.0.0.1")]
    app.add_middleware(
        CORSMiddleware,
        allow_origins=[*_dev_origins, "null"],
        allow_methods=["*"],
        allow_headers=["*"],
    )
    app.state.token = token
    app.state.catalog = catalog
    app.state.hub = hub
    app.state.scheduler = scheduler
    app.state.jobs = {}
    app.state.cancels = {}            # job_id -> threading.Event
    app.state.connect_sessions = {}   # connect_id -> SoundCloudConnectSession

    _JOBS_CAP = 200
    _CONNECT_CAP = 10

    def _new_job(job_id: str) -> None:
        jobs = app.state.jobs
        for jid in list(jobs):
            if len(jobs) < _JOBS_CAP:
                break
            if jobs[jid].get("state") in ("done", "error"):
                del jobs[jid]
        jobs[job_id] = {"state": "running"}

    def _tier() -> str:
        return entitlement.verify_stored(catalog.get_setting("entitlement") or {})

    def _allows(feature: str) -> bool:
        return entitlement.allows(_tier(), feature)

    def _resolve_sources(supplied):
        if supplied:
            return [Path(s) for s in supplied]
        saved = catalog.get_setting("config") or {}
        return [Path(s) for s in saved.get("sources", [])]

    @app.get("/health")
    def health():
        return {"status": "ok"}

    # ---- entitlement --------------------------------------------------------
    @app.get("/api/entitlement", dependencies=[Depends(require_token)])
    def get_entitlement():
        tier = _tier()
        return {"tier": tier, "features": entitlement.features_for(tier)}

    @app.post("/api/entitlement/activate", dependencies=[Depends(require_token)])
    def activate(req: ActivateRequest):
        res = entitlement.activate(req.key)
        if res is None or res.get("tier") is None:
            raise HTTPException(status_code=400, detail="That licence key wasn't recognised.")
        key, iid = req.key.strip(), res.get("instance_id")
        catalog.set_setting("entitlement", {
            "tier": res["tier"], "key": key, "instance_id": iid,
            "sig": entitlement.sign_tier(res["tier"], key, iid),
        })
        return {"tier": res["tier"], "features": entitlement.features_for(res["tier"])}

    @app.post("/api/entitlement/deactivate", dependencies=[Depends(require_token)])
    def deactivate():
        ent = catalog.get_setting("entitlement") or {}
        entitlement.deactivate(ent.get("key", ""), ent.get("instance_id"))
        catalog.set_setting("entitlement", {"tier": "free"})
        scheduler.set_interval(0)  # auto-upload is Pro-only
        return {"tier": "free", "features": entitlement.features_for("free")}

    # ---- settings -----------------------------------------------------------
    @app.get("/api/settings", dependencies=[Depends(require_token)])
    def get_settings() -> Config:
        saved = catalog.get_setting("config")
        return Config(**saved) if saved else Config()

    @app.put("/api/settings", dependencies=[Depends(require_token)])
    def put_settings(config: Config) -> Config:
        if config.interval_minutes > 0 and not _allows("auto_upload"):
            config.interval_minutes = 0  # auto-upload (watch folder) is Pro-only
        if config.templates and not _allows("metadata_templates"):
            config.templates = []        # saved templates are Pro-only
        catalog.set_setting("config", config.model_dump())
        scheduler.set_interval(config.interval_minutes)
        return config

    # ---- account / connect --------------------------------------------------
    @app.get("/api/account", dependencies=[Depends(require_token)])
    def account():
        return {"connected": service.connected(catalog),
                "account": service.account_label(catalog),
                "avatar": service.account_avatar(catalog),
                "accounts": service.accounts_public(catalog),
                "multi": _allows("multi_account"),
                "mock": soundcloud.use_mock()}

    @app.post("/api/connect", dependencies=[Depends(require_token)])
    def connect():
        sessions = app.state.connect_sessions
        for s in list(sessions.values()):
            if s.status == "pending":
                s.cancel()
        while len(sessions) >= _CONNECT_CAP:
            sessions.pop(next(iter(sessions)))

        # Pro can connect several accounts; Free's connect replaces the existing one.
        allow_multiple = _allows("multi_account")

        def on_connected(tokens: dict):
            service.add_account(catalog, tokens, allow_multiple=allow_multiple)

        sess = SoundCloudConnectSession(on_connected)
        sess.start()
        if sess.status == "failed":
            raise HTTPException(status_code=502, detail=sess.error or "Couldn't start sign-in.")
        connect_id = uuid.uuid4().hex
        sessions[connect_id] = sess
        return {"connect_id": connect_id, "auth_url": sess.auth_url,
                "status": sess.status, "mock": soundcloud.use_mock()}

    @app.get("/api/connect/{connect_id}", dependencies=[Depends(require_token)])
    def connect_status(connect_id: str):
        sess = app.state.connect_sessions.get(connect_id)
        if not sess:
            raise HTTPException(status_code=404, detail="Unknown sign-in.")
        return {"status": sess.status, "account": service.account_label(catalog),
                "error": sess.error}

    @app.post("/api/accounts/activate", dependencies=[Depends(require_token)])
    def activate_account(req: AccountActivateRequest):
        if not service.set_active(catalog, req.id):
            raise HTTPException(status_code=404, detail="Unknown account.")
        return {"connected": service.connected(catalog),
                "account": service.account_label(catalog),
                "accounts": service.accounts_public(catalog)}

    @app.post("/api/disconnect", dependencies=[Depends(require_token)])
    def disconnect(req: DisconnectRequest):
        # SoundCloud has no token-revoke endpoint; dropping the stored tokens is enough.
        service.remove_account(catalog, req.id)
        return {"connected": service.connected(catalog),
                "account": service.account_label(catalog),
                "accounts": service.accounts_public(catalog)}

    # ---- scan ---------------------------------------------------------------
    @app.post("/api/scan", dependencies=[Depends(require_token)])
    async def scan(req: ScanRequest):
        sources = _resolve_sources(req.sources)

        def progress(ev):
            try:
                hub.publish_threadsafe(ev)
            except RuntimeError:
                pass

        app.state.hub.bind_loop(asyncio.get_running_loop())
        mixes = await asyncio.to_thread(service.scan_mixes, catalog, sources, progress)
        return {"mixes": mixes}

    @app.post("/api/wip", dependencies=[Depends(require_token)])
    async def set_wip(req: WipRequest):
        # set_wip may call SoundCloud (strip the [WIP] title on finalize) — off the loop.
        await asyncio.to_thread(service.set_wip, catalog, req.name, req.wip)
        scheduler.refresh_wip_job()  # marking a track WIP auto-enables watching
        if req.wip:
            scheduler.run_wip_soon()  # apply the [WIP] title now, not on the next tick
        return {"wip": service.wip_status(catalog)}

    # ---- upload -------------------------------------------------------------
    async def _run_job(job_id, items, defaults, force, release_at):
        cancel = app.state.cancels[job_id]

        def progress(ev):
            hub.publish_threadsafe(ev)

        try:
            result = await asyncio.to_thread(
                service.run_upload, catalog, items, defaults, progress,
                cancel.is_set, force, release_at)
            app.state.jobs[job_id] = {"state": "done", "result": result}
        except Exception as e:  # pragma: no cover - defensive
            app.state.jobs[job_id] = {"state": "error", "error": str(e)}
        finally:
            app.state.cancels.pop(job_id, None)

    @app.post("/api/upload", dependencies=[Depends(require_token)])
    async def upload(req: UploadRequest):
        if not service.connected(catalog):
            raise HTTPException(status_code=400, detail="Connect a SoundCloud account first.")
        items = [i.model_dump(exclude_none=True) for i in req.items]
        if not items:
            raise HTTPException(status_code=400, detail="No mixes selected.")
        if len(items) > 1 and not _allows("batch"):
            raise HTTPException(status_code=402,
                                detail="Uploading more than one mix at once is a Pro feature.")
        if req.release_at and not _allows("schedule_release"):
            raise HTTPException(status_code=402,
                                detail="Scheduled public release is a Pro feature.")
        saved = catalog.get_setting("config") or {}
        defaults = {
            "sharing": saved.get("default_sharing", "public"),
            "genre": saved.get("default_genre", ""),
            "tags": saved.get("default_tags", []),
            "title_template": saved.get("title_template", "{name}"),
            "description": saved.get("default_description", ""),
            "downloadable": saved.get("downloadable", False),
        }
        app.state.hub.bind_loop(asyncio.get_running_loop())
        job_id = uuid.uuid4().hex
        _new_job(job_id)
        app.state.cancels[job_id] = threading.Event()
        asyncio.create_task(_run_job(job_id, items, defaults, req.force, req.release_at))
        return {"job_id": job_id, "state": "running"}

    @app.get("/api/jobs/{job_id}", dependencies=[Depends(require_token)])
    def job_status(job_id: str):
        job = app.state.jobs.get(job_id)
        if job is None:
            raise HTTPException(status_code=404, detail="unknown job")
        return job

    @app.post("/api/jobs/{job_id}/cancel", dependencies=[Depends(require_token)])
    def cancel_job(job_id: str):
        ev = app.state.cancels.get(job_id)
        if ev is None:
            raise HTTPException(status_code=404, detail="job not running")
        ev.set()
        job = app.state.jobs.get(job_id)
        if job and job.get("state") == "running":
            app.state.jobs[job_id] = {"state": "cancelling"}
        return {"cancelling": True}

    # ---- overview / history -------------------------------------------------
    @app.get("/api/overview", dependencies=[Depends(require_token)])
    async def overview():
        data = await asyncio.to_thread(service.build_overview, catalog)
        cfg = catalog.get_setting("config") or {}
        interval = cfg.get("interval_minutes", 0) or 0
        data["schedule"] = {
            "enabled": interval > 0,
            "interval_minutes": interval,
            "next_run": scheduler.next_run(),
        }
        data["tier"] = _tier()
        return data

    @app.get("/api/history", dependencies=[Depends(require_token)])
    def history(limit: int = 50):
        return {"uploads": catalog.recent_uploads(limit=limit)}

    # ---- manage existing SoundCloud tracks ----------------------------------
    def _track_http_error(exc: Exception, fallback: str) -> HTTPException:
        """Map a SoundCloud client failure to a typed HTTP error so the UI can tell
        'reconnect your account' (401) from 'rate-limited' (429) from a generic failure."""
        if isinstance(exc, soundcloud.AuthError):
            return HTTPException(status_code=401,
                                 detail="Your SoundCloud session expired — please reconnect the account.")
        if isinstance(exc, soundcloud.RateLimitError):
            return HTTPException(status_code=429,
                                 detail="SoundCloud is rate-limiting requests — try again shortly.")
        return HTTPException(status_code=502, detail=fallback)

    @app.get("/api/tracks", dependencies=[Depends(require_token)])
    async def list_tracks():
        if not service.connected(catalog):
            raise HTTPException(status_code=400, detail="Connect a SoundCloud account first.")
        try:
            tracks = await asyncio.to_thread(service.list_tracks, catalog)
        except Exception as e:
            raise _track_http_error(e, "Couldn't load your SoundCloud tracks.")
        return {"tracks": tracks}

    @app.put("/api/tracks/{track_id}", dependencies=[Depends(require_token)])
    async def update_track(track_id: int, req: TrackUpdate):
        if not service.connected(catalog):
            raise HTTPException(status_code=400, detail="Connect a SoundCloud account first.")
        fields = req.model_dump(exclude_none=True)
        if not fields:
            raise HTTPException(status_code=400, detail="Nothing to update.")
        try:
            return await asyncio.to_thread(service.update_track, catalog, track_id, fields)
        except Exception as e:
            raise _track_http_error(e, "Couldn't update that track.")

    @app.delete("/api/tracks/{track_id}", dependencies=[Depends(require_token)])
    async def delete_track(track_id: int):
        if not service.connected(catalog):
            raise HTTPException(status_code=400, detail="Connect a SoundCloud account first.")
        try:
            await asyncio.to_thread(service.delete_track, catalog, track_id)
        except Exception as e:
            raise _track_http_error(e, "Couldn't delete that track.")
        return {"ok": True}

    @app.post("/api/tracks/bulk", dependencies=[Depends(require_token)])
    async def bulk_update_tracks(req: BulkTrackUpdate):
        if not service.connected(catalog):
            raise HTTPException(status_code=400, detail="Connect a SoundCloud account first.")
        if not _allows("batch"):
            raise HTTPException(status_code=402, detail="Bulk editing is a Pro feature.")
        patch = req.patch.model_dump(exclude_none=True)
        if not patch:
            raise HTTPException(status_code=400, detail="Nothing to update.")
        results = await asyncio.to_thread(service.bulk_update, catalog, req.ids, patch)
        return {"results": results}

    @app.post("/api/tracks/bulk-delete", dependencies=[Depends(require_token)])
    async def bulk_delete_tracks(req: BulkDeleteRequest):
        if not service.connected(catalog):
            raise HTTPException(status_code=400, detail="Connect a SoundCloud account first.")
        if not _allows("batch"):
            raise HTTPException(status_code=402, detail="Bulk deleting is a Pro feature.")
        results = await asyncio.to_thread(service.bulk_delete, catalog, req.ids)
        return {"results": results}

    @app.post("/api/tracks/{track_id}/artwork", dependencies=[Depends(require_token)])
    async def set_track_artwork(track_id: int, req: ArtworkRequest):
        if not service.connected(catalog):
            raise HTTPException(status_code=400, detail="Connect a SoundCloud account first.")
        if not Path(req.artwork_path).is_file():
            raise HTTPException(status_code=400, detail="Image file not found.")
        try:
            return await asyncio.to_thread(service.set_artwork, catalog, track_id, req.artwork_path)
        except Exception as e:
            raise _track_http_error(e, "Couldn't set that track's cover art.")

    @app.post("/api/tracks/bulk-artwork", dependencies=[Depends(require_token)])
    async def bulk_set_artwork(req: BulkArtworkRequest):
        if not service.connected(catalog):
            raise HTTPException(status_code=400, detail="Connect a SoundCloud account first.")
        if not _allows("batch"):
            raise HTTPException(status_code=402, detail="Bulk cover art is a Pro feature.")
        if not Path(req.artwork_path).is_file():
            raise HTTPException(status_code=400, detail="Image file not found.")
        results = await asyncio.to_thread(service.bulk_set_artwork, catalog, req.ids, req.artwork_path)
        return {"results": results}

    @app.post("/api/tracks/{track_id}/waveform-cover", dependencies=[Depends(require_token)])
    async def waveform_cover(track_id: int):
        if not service.connected(catalog):
            raise HTTPException(status_code=400, detail="Connect a SoundCloud account first.")
        try:
            return await asyncio.to_thread(service.generate_waveform_cover, catalog, track_id)
        except Exception as e:
            raise _track_http_error(e, str(e) or "Couldn't generate a waveform cover.")

    @app.post("/api/tracks/bulk-waveform-cover", dependencies=[Depends(require_token)])
    async def bulk_waveform_cover(req: BulkDeleteRequest):
        if not service.connected(catalog):
            raise HTTPException(status_code=400, detail="Connect a SoundCloud account first.")
        if not _allows("batch"):
            raise HTTPException(status_code=402, detail="Bulk cover art is a Pro feature.")
        results = await asyncio.to_thread(service.bulk_generate_waveform_covers, catalog, req.ids)
        return {"results": results}

    # ---- live progress ------------------------------------------------------
    @app.websocket("/ws/progress")
    async def ws_progress(websocket: WebSocket, token: str = ""):
        if not ws_token_ok(app, token):
            await websocket.close(code=1008)
            return
        await websocket.accept()
        app.state.hub.bind_loop(asyncio.get_running_loop())
        q = app.state.hub.subscribe()
        try:
            while True:
                event = await q.get()
                await websocket.send_json(event)
        except WebSocketDisconnect:
            pass
        finally:
            app.state.hub.unsubscribe(q)

    return app
