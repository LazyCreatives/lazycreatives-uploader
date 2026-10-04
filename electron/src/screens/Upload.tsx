import { useEffect, useRef, useState } from "react";
import { makeApi, openExternal, pickImage, readImage } from "../api";
import type { Config, Entitlement, Mix, Sharing, UploadItemInput } from "../types";
import { Button, fmtBytes, fmtDuration, PageHeader, SubLine, ProBadge, ProgressBar } from "../components/ui";
import { Icon } from "../components/Icon";
import { Cover } from "../components/Cover";
import { PlayButton, SongWave, type SongMeta } from "../components/Player";
import { genreColor, useLook } from "../look";
import type { UploadState, ScanState } from "../useProgress";

const api = makeApi();

export function Upload({ cfg, ent, scan, upload, resetUpload }: {
  cfg: Config; ent: Entitlement; scan: ScanState; upload: UploadState; resetUpload: () => void;
}) {
  const [look] = useLook();
  const [mixes, setMixes] = useState<Mix[] | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [sharing, setSharing] = useState<Sharing>("public");
  const [templateName, setTemplateName] = useState("");
  const [scheduleOn, setScheduleOn] = useState(false);
  const [releaseAtValue, setReleaseAtValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [showDupes, setShowDupes] = useState(false);
  const [coverArt, setCoverArt] = useState<string | null>(null);
  const [coverPreview, setCoverPreview] = useState<string | null>(null);
  const pollRef = useRef<number | null>(null);

  useEffect(() => { void rescan(); /* on mount */ }, []);

  // Load a preview data URL whenever the batch cover art changes.
  useEffect(() => {
    let alive = true;
    if (!coverArt) { setCoverPreview(null); return; }
    readImage(coverArt).then((url) => { if (alive) setCoverPreview(url); }).catch(() => { if (alive) setCoverPreview(null); });
    return () => { alive = false; };
  }, [coverArt]);

  async function chooseCover() {
    const p = await pickImage();
    if (p) setCoverArt(p);
  }
  // When an upload finishes, refresh the list so published mixes flip to "uploaded".
  useEffect(() => { if (upload.done) { void rescan(); setRunning(false); } }, [upload.done]);

  async function rescan() {
    setError(null);
    try {
      const m = await api.scan();
      setMixes(m);
      // default-select everything not yet uploaded, skipping lower-quality format
      // duplicates (highest quality wins). Single-only on Free.
      const fresh = m.filter((x) => !x.uploaded && !x.superseded_by).map((x) => x.path);
      setSelected(new Set(ent.features.batch ? fresh : fresh.slice(0, 1)));
    } catch (e) {
      setError(String((e as Error).message));
    }
  }

  function toggle(path: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(path)) { next.delete(path); return next; }
      if (!ent.features.batch) return new Set([path]); // Free: one at a time
      next.add(path);
      return next;
    });
  }

  async function toggleWip(m: Mix) {
    const next = !m.wip;
    try {
      await api.setWip(m.name, next);
      // WIP is keyed by track name, so flag every format row sharing this name.
      setMixes((prev) => prev && prev.map((x) => (x.name === m.name ? { ...x, wip: next } : x)));
    } catch (e) {
      setError(String((e as Error).message));
    }
  }

  async function start() {
    if (selected.size === 0) return;
    setError(null); resetUpload(); setRunning(true);
    const tmpl = cfg.templates.find((t) => t.name === templateName);
    const items: UploadItemInput[] = (mixes || [])
      .filter((m) => selected.has(m.path))
      .map((m) => {
        // Pre-fill from the Backups match: genre -> SoundCloud genre, BPM -> a tag.
        const tags = [
          ...(tmpl && tmpl.tags.length ? tmpl.tags : []),
          ...(m.bpm ? [`${m.bpm} BPM`] : []),
        ];
        // WIP tracks publish privately and carry a [WIP] marker in the title.
        const baseTitle = tmpl ? tmpl.title_template.replace("{name}", m.name) : m.name;
        const title = m.wip ? `${baseTitle} [WIP]` : (tmpl ? baseTitle : undefined);
        const itemSharing: Sharing = m.wip ? "private" : (tmpl ? tmpl.sharing : sharing);
        return {
          path: m.path, name: m.name,
          title,
          sharing: itemSharing,
          genre: tmpl?.genre || m.genre || undefined,
          tags: tags.length ? tags : undefined,
          description: tmpl?.description || undefined,
          file_hash: m.file_hash, size: m.size,
          // Per-batch cover overrides the configured default; undefined lets the
          // backend apply the default cover art.
          artwork_path: coverArt || undefined,
        };
      });
    const releaseAt = scheduleOn && releaseAtValue
      ? new Date(releaseAtValue).toISOString() : undefined;
    try {
      const { job_id } = await api.upload(items, false, releaseAt);
      // The live WS stream drives the UI; poll the job only to surface a hard error.
      const tick = async () => {
        const job = await api.jobStatus(job_id);
        if (job.state === "error") { setError(job.error || "Upload failed."); setRunning(false); return; }
        if (job.state !== "done") pollRef.current = window.setTimeout(tick, 1000);
      };
      pollRef.current = window.setTimeout(tick, 1000);
    } catch (e) {
      setError(String((e as Error).message)); setRunning(false);
    }
  }

  const trackPct = upload.size > 0 ? (upload.sent / upload.size) * 100 : (running ? 5 : 0);
  const newCount = (mixes || []).filter((m) => !m.uploaded && !m.superseded_by).length;
  const matched = (mixes || []).filter((m) => m.genre || m.bpm).length;
  const dupeCount = (mixes || []).filter((m) => m.superseded_by).length;
  const wipCount = (mixes || []).filter((m) => m.wip && !m.superseded_by).length;
  const visible = showDupes ? (mixes || []) : (mixes || []).filter((m) => !m.superseded_by);

  const summary = mixes === null ? "Looking through your watched folders…"
    : `${mixes.length} ${mixes.length === 1 ? "mix" : "mixes"} found · ${newCount} new`
      + `${matched ? ` · ${matched} tagged from Backups` : ""}${wipCount ? ` · ${wipCount} work in progress` : ""}`
      + `${dupeCount && !showDupes ? ` · ${dupeCount} extra ${dupeCount === 1 ? "format" : "formats"} hidden` : ""}`;

  const mixMeta = (m: Mix): SongMeta => ({
    title: m.name, sub: m.project_match ? `From ${m.project_match}` : m.genre || "", genre: m.genre,
    cover: m.project_match || m.name,
  });
  const statusBadge = (m: Mix) => m.uploaded
    ? <button type="button" className="pill pill--ok linkbtn"
        onClick={(e) => { e.preventDefault(); e.stopPropagation(); m.permalink_url && openExternal(m.permalink_url); }}>Posted</button>
    : m.superseded_by
      ? <span className="pill pill--skipped">Using {m.superseded_by}</span>
      : <span className="pill" style={{ ["--dot" as any]: "var(--accent)" }}>New</span>;
  const draftButton = (m: Mix) => m.wip
    ? <button type="button" className="chip chip--on" style={{ height: 24 }}
        title="Draft: kept private and replaced on each new bounce. Click to mark as final."
        onClick={(e) => { e.preventDefault(); e.stopPropagation(); toggleWip(m); }}>Draft</button>
    : <button type="button" className="linkbtn faint" style={{ fontSize: 12.5, color: "var(--text-faint)" }}
        title="Mark as a draft: kept private and replaced on each new bounce"
        onClick={(e) => { e.preventDefault(); e.stopPropagation(); toggleWip(m); }}>Mark draft</button>;

  return (
    <div>
      <PageHeader title="Upload" sub={summary} actions={<>
        <Button kind="quiet" onClick={rescan} disabled={scan.active || running}>
          <Icon name="refresh" />{scan.active ? "Looking…" : "Look again"}
        </Button>
        <Button kind="primary" disabled={selected.size === 0 || running || upload.active} onClick={start}>
          {running ? "Posting…" : selected.size ? `Post ${selected.size} to SoundCloud` : "Post to SoundCloud"}
        </Button>
      </>} />

      {error && <div className="banner banner--warn"><Icon name="alert" className="banner__icon" />{error}</div>}

      {(running || upload.active || upload.done) && (
        <section className="card section">
          <div className="row-spread" style={{ marginBottom: 10 }}>
            <b style={{ fontWeight: 600 }}>{upload.done ? "Done" : upload.current ? `Uploading “${upload.current}”` : "Getting ready…"}</b>
            <span className="num muted">{upload.completed + upload.skipped + upload.errors} / {upload.total}</span>
          </div>
          <ProgressBar pct={upload.done ? 100 : trackPct} active={!upload.done} />
          <div className="muted" style={{ marginTop: 10, fontSize: 12.5 }}>
            {upload.completed} posted · {upload.skipped} skipped · {upload.errors} failed
            {upload.lastUrl && (
              <> · <button className="linkbtn" onClick={() => openExternal(upload.lastUrl!)}>open the last one on SoundCloud</button></>
            )}
          </div>
        </section>
      )}

      {!ent.features.batch && (
        <div className="locked-note" style={{ marginBottom: 12 }}>
          <span>Free uploads one mix at a time.</span>
          <b>Batch upload<ProBadge /></b><span>posts a whole folder at once.</span>
        </div>
      )}

      <div className="toolbar">
        <label className="toolchk">
          Post as
          <select value={sharing} disabled={!!templateName}
            onChange={(e) => setSharing(e.target.value as Sharing)}>
            <option value="public">Public</option>
            <option value="private">Private</option>
          </select>
        </label>
        {ent.features.metadata_templates && cfg.templates.length > 0 && (
          <label className="toolchk">
            Template
            <select value={templateName} onChange={(e) => setTemplateName(e.target.value)}>
              <option value="">None</option>
              {cfg.templates.map((t) => <option key={t.name} value={t.name}>{t.name}</option>)}
            </select>
          </label>
        )}
        <div className="toolchk">
          Cover
          <span className={`art-thumb art-thumb--sm${coverArt && coverPreview ? "" : " art-thumb--ph"}`} aria-hidden="true">
            {coverArt && coverPreview ? <img src={coverPreview} alt="" /> : <Icon name="music" />}
          </span>
          <Button sm onClick={chooseCover} disabled={running}>{coverArt ? "Change…" : "Choose image…"}</Button>
          {coverArt && <Button kind="quiet" sm onClick={() => setCoverArt(null)} disabled={running}>Remove</Button>}
        </div>
        {ent.features.schedule_release && (
          <label className="toolchk">
            <input type="checkbox" checked={scheduleOn} onChange={(e) => setScheduleOn(e.target.checked)} />
            Go public later
            {scheduleOn && <input type="datetime-local" value={releaseAtValue}
              onChange={(e) => setReleaseAtValue(e.target.value)} />}
          </label>
        )}
        {dupeCount > 0 && (
          <label className="toolchk" style={{ marginLeft: "auto" }}>
            <input type="checkbox" checked={showDupes} onChange={(e) => setShowDupes(e.target.checked)} />
            Show every format
          </label>
        )}
      </div>
      {(coverArt || scheduleOn) && (
        <p className="faint" style={{ margin: "-6px 0 12px", fontSize: 12 }}>
          {coverArt ? "This cover replaces your default cover for this upload. " : ""}
          {scheduleOn ? "Mixes go up private now and turn public at the time you pick." : ""}
        </p>
      )}

      {mixes && mixes.length === 0 && (
        <div className="table"><div className="empty">
          <div className="empty__icon"><Icon name="folder" size={28} /></div>
          <div className="empty__title">No audio in your watched folders</div>
          Export a mix into one of them, or add a folder in Settings.
        </div></div>
      )}

      {visible.length > 0 && look === "sleeve" && (
        <div className="sleeves mix-sleeves">
          {visible.map((m) => {
            const meta = mixMeta(m);
            const picked = selected.has(m.path);
            const locked = m.uploaded || running;
            return (
              <div key={m.path} className={`sleeve${picked ? " sleeve--selected" : ""}${m.uploaded || m.superseded_by ? " sleeve--done" : ""}`}
                role="button" tabIndex={0} aria-pressed={picked}
                onClick={() => { if (!locked) toggle(m.path); }}
                onKeyDown={(e) => { if ((e.key === "Enter" || e.key === " ") && !locked) { e.preventDefault(); toggle(m.path); } }}>
                <div className="sleeve__art">
                  <Cover name={m.project_match || m.name} genre={m.genre} />
                  <span className="sleeve__badge">{statusBadge(m)}</span>
                  <input type="checkbox" className="mixrow__check mix-sleeve__check" disabled={locked} checked={picked}
                    onClick={(e) => e.stopPropagation()} onChange={() => toggle(m.path)} aria-label={`Pick ${m.name}`} />
                  <PlayButton path={m.path} meta={meta} size={34} className="sleeve__play" />
                </div>
                <div className="sleeve__meta">
                  <div className="track-sleeve__top">
                    <div className="sleeve__name" title={m.name}>{m.name}</div>
                    <span className="fmt-badge">{m.ext.replace(".", "")}</span>
                  </div>
                  <div className="track-sleeve__sub">
                    <span className="col-trunc">{m.project_match ? `From ${m.project_match}` : "Not linked to a project"}</span>
                    <span className="mono">{m.duration ? fmtDuration(m.duration) : ""}</span>
                  </div>
                  <SongWave path={m.path} meta={meta} height={18} />
                  {!m.superseded_by && !m.uploaded && <div className="mix-sleeve__draft">{draftButton(m)}</div>}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {visible.length > 0 && look === "crate" && (
        <div className="table table--crate">
          <div className="row cols cols-head mix-cols">
            <span /><span /><span /><span>Type</span><span>Mix</span><span>Waveform</span><span>From project</span>
            <span className="col-num">Length</span><span className="col-num">Size</span><span>Draft</span><span>Status</span>
          </div>
          {visible.map((m, i) => {
            const meta = mixMeta(m);
            return (
            <label key={m.path} className={`row cols mix-cols scanrow--enter${selected.has(m.path) ? " row--selected" : ""}`}
              style={{ ["--i" as any]: i, cursor: m.uploaded || running ? "default" : "pointer" }}>
              <span className="stripe" style={{ background: genreColor(m.genre) }} />
              <input type="checkbox" className="mixrow__check" disabled={m.uploaded || running}
                checked={selected.has(m.path)} onChange={() => toggle(m.path)} aria-label={`Pick ${m.name}`} />
              <PlayButton path={m.path} meta={meta} size={28} />
              <span className="fmt-badge">{m.ext.replace(".", "")}</span>
              <div className="row__main" style={{ opacity: m.uploaded || m.superseded_by ? 0.6 : 1 }}>
                <div className="row__title">{m.name}</div>
                <SubLine parts={[m.genre, m.bpm ? `${m.bpm} BPM` : "",
                  m.dupe_formats && m.dupe_formats.length ? `also ${m.dupe_formats.join(", ")}` : ""]} />
              </div>
              <SongWave path={m.path} meta={meta} height={24} />
              <span className={`col-trunc${m.project_match ? "" : " faint"}`}>{m.project_match || "Not linked"}</span>
              <span className="col-num">{m.duration ? fmtDuration(m.duration) : "—"}</span>
              <span className="col-num">{fmtBytes(m.size)}</span>
              <span>{!m.superseded_by && draftButton(m)}</span>
              {statusBadge(m)}
            </label>
            );
          })}
        </div>
      )}
    </div>
  );
}
