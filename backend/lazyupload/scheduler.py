"""APScheduler-backed watch-folder auto-uploader (a Pro feature).

On each interval it scans the watched folders, takes any mixes not yet published,
and uploads them with the configured default metadata. De-dupe lives in the engine,
so re-scanning the same folder never re-posts an existing track.
"""
from pathlib import Path
from typing import Optional

from apscheduler.schedulers.background import BackgroundScheduler

from lazyupload import entitlement
from lazyupload.catalog import Catalog
from lazyupload.service import (
    get_wip, process_due_releases, process_wip, run_upload, scan_mixes, upload_in_progress,
)

_JOB_ID = "auto_upload"
_RELEASE_JOB_ID = "release_checker"
_WIP_JOB_ID = "wip_watch"


class UploadScheduler:
    def __init__(self, catalog: Catalog, hub=None):
        self._catalog = catalog
        self._hub = hub  # scheduled runs stream progress + fire the completion toast
        self._scheduler = BackgroundScheduler()
        self._scheduler.start(paused=False)
        # Always-on, cheap check that flips any due scheduled releases to public.
        self._scheduler.add_job(self._process_releases, "interval", seconds=60,
                                id=_RELEASE_JOB_ID)
        # Resume watching WIP tracks across restarts (no-op if none are marked).
        self.refresh_wip_job()

    def _process_releases(self) -> None:
        try:
            flipped = process_due_releases(self._catalog)
        except Exception:
            return
        if flipped and self._hub is not None:
            try:
                self._hub.publish_threadsafe(
                    {"type": "releases_published", "count": len(flipped)})
            except RuntimeError:
                pass

    def set_interval(self, minutes: int) -> None:
        existing = self._scheduler.get_job(_JOB_ID)
        if existing is not None:
            existing.remove()
        if minutes and minutes > 0:
            self._scheduler.add_job(self._run_once, "interval", minutes=minutes, id=_JOB_ID)

    def job_count(self) -> int:
        return len(self._scheduler.get_jobs())

    def next_run(self) -> Optional[str]:
        job = self._scheduler.get_job(_JOB_ID)
        if job is not None and job.next_run_time is not None:
            return job.next_run_time.isoformat()
        return None

    def _run_once(self) -> None:
        config = self._catalog.get_setting("config") or {}
        sources = config.get("sources", [])
        if not sources:
            return  # nothing watched yet
        tier = entitlement.verify_stored(self._catalog.get_setting("entitlement") or {})
        if not entitlement.allows(tier, "auto_upload"):
            return  # auto-upload is Pro-only
        if upload_in_progress():
            return  # a manual/previous run is going — skip this tick

        mixes = scan_mixes(self._catalog, [Path(s) for s in sources])
        fresh = [m for m in mixes if not m.get("uploaded")]
        if not fresh:
            return
        # Auto runs respect the configured defaults, but default to PRIVATE sharing so
        # hands-off automation never publishes a render publicly without opt-in.
        defaults = {
            "sharing": config.get("auto_upload_sharing", "private"),
            "genre": config.get("default_genre", ""),
            "tags": config.get("default_tags", []),
            "title_template": config.get("title_template", "{name}"),
            "description": config.get("default_description", ""),
        }

        def progress(ev):
            if self._hub is not None:
                try:
                    self._hub.publish_threadsafe(ev)
                except RuntimeError:
                    pass

        run_upload(self._catalog, fresh, defaults=defaults, progress=progress)

    def refresh_wip_job(self) -> None:
        """Add/remove the WIP watch job to match whether any WIP tracks are marked (and
        the tier allows it). Marking a track WIP therefore auto-enables watching."""
        existing = self._scheduler.get_job(_WIP_JOB_ID)
        tier = entitlement.verify_stored(self._catalog.get_setting("entitlement") or {})
        want = bool(get_wip(self._catalog)) and entitlement.allows(tier, "auto_upload")
        if want and existing is None:
            minutes = (self._catalog.get_setting("config") or {}).get("wip_watch_minutes") or 5
            self._scheduler.add_job(self._run_wip, "interval", minutes=minutes, id=_WIP_JOB_ID)
        elif not want and existing is not None:
            existing.remove()

    def _run_wip(self) -> None:
        config = self._catalog.get_setting("config") or {}
        sources = config.get("sources", [])
        if not sources or upload_in_progress():
            return
        tier = entitlement.verify_stored(self._catalog.get_setting("entitlement") or {})
        if not entitlement.allows(tier, "auto_upload"):
            return

        def progress(ev):
            if self._hub is not None:
                try:
                    self._hub.publish_threadsafe(ev)
                except RuntimeError:
                    pass

        published = process_wip(self._catalog, [Path(s) for s in sources], progress=progress)
        if published and self._hub is not None:
            try:
                self._hub.publish_threadsafe({"type": "wip_published", "count": len(published)})
            except RuntimeError:
                pass

    def shutdown(self) -> None:
        self._scheduler.shutdown(wait=False)
