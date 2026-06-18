import { useEffect, useRef, useState } from "react";
import { makeApi, openExternal } from "../api";
import type { Config, Entitlement, Mix, Sharing, UploadItemInput } from "../types";
import { Button, fmtBytes, fmtDuration, ProBadge, ProgressBar } from "../components/ui";
import type { UploadState, ScanState } from "../useProgress";

const api = makeApi();

export function Upload({ cfg, ent, scan, upload, resetUpload }: {
  cfg: Config; ent: Entitlement; scan: ScanState; upload: UploadState; resetUpload: () => void;
}) {
  const [mixes, setMixes] = useState<Mix[] | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [sharing, setSharing] = useState<Sharing>("public");
  const [templateName, setTemplateName] = useState("");
  const [scheduleOn, setScheduleOn] = useState(false);
  const [releaseAtValue, setReleaseAtValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [showDupes, setShowDupes] = useState(false);
  const pollRef = useRef<number | null>(null);

  useEffect(() => { void rescan(); /* on mount */ }, []);
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

  return (
    <div>
      <div className="flowbar">
        <div className="flowbar__steps">
          <span className={`flowstep ${running ? "flowstep--done" : "flowstep--on"}`}><span className="flowstep__n">1</span> Pick mixes</span>
          <span className={`flowstep ${running ? "flowstep--on" : ""}`}><span className="flowstep__n">2</span> Publish</span>
        </div>
        <Button kind="ghost" sm onClick={rescan} disabled={scan.active || running}>
          {scan.active ? "Scanning…" : "Rescan"}
        </Button>
      </div>

      {error && <div className="banner banner--warn">⚠ {error}</div>}

      {(running || upload.active || upload.done) && (
        <div className="card celebrate" style={{ marginBottom: 18 }}>
          <div className="row-spread" style={{ marginBottom: 10 }}>
            <b>{upload.done ? "Done" : upload.current ? `Uploading “${upload.current}”` : "Preparing…"}</b>
            <span className="mono sub" style={{ margin: 0 }}>
              {upload.completed + upload.skipped + upload.errors}/{upload.total}
            </span>
          </div>
          <ProgressBar pct={upload.done ? 100 : trackPct} active={!upload.done} />
          <div className="sub" style={{ margin: "10px 0 0" }}>
            {upload.completed} published · {upload.skipped} skipped · {upload.errors} error(s)
            {upload.lastUrl && (
              <> · <button className="linkbtn" onClick={() => openExternal(upload.lastUrl!)}>open last on SoundCloud ↗</button></>
            )}
          </div>
        </div>
      )}

      {!ent.features.batch && (
        <div className="locked-note" style={{ marginBottom: 12 }}>
          <span>Free uploads one mix at a time.</span>
          <b>Batch upload<ProBadge /></b><span>publishes a whole folder at once.</span>
        </div>
      )}

      <div className="row-spread" style={{ marginBottom: 12 }}>
        <div className="sub" style={{ margin: 0 }}>
          {mixes === null ? "Scanning your folders…"
            : `${mixes.length} mix(es) · ${newCount} new · ${selected.size} selected${matched ? ` · ${matched} auto-tagged` : ""}${wipCount ? ` · ${wipCount} WIP` : ""}${dupeCount && !showDupes ? ` · ${dupeCount} dup${dupeCount === 1 ? "e" : "es"} hidden` : ""}`}
        </div>
        <div style={{ display: "flex", gap: 14, alignItems: "center" }}>
          {dupeCount > 0 && (
            <label className="toolchk" style={{ margin: 0 }}>
              <input type="checkbox" checked={showDupes} onChange={(e) => setShowDupes(e.target.checked)} />
              Show all formats
            </label>
          )}
          {ent.features.metadata_templates && cfg.templates.length > 0 && (
            <label className="sub" style={{ margin: 0, display: "flex", gap: 8, alignItems: "center" }}>
              Template
              <select value={templateName} onChange={(e) => setTemplateName(e.target.value)}>
                <option value="">None</option>
                {cfg.templates.map((t) => <option key={t.name} value={t.name}>{t.name}</option>)}
              </select>
            </label>
          )}
          <label className="sub" style={{ margin: 0, display: "flex", gap: 8, alignItems: "center", opacity: templateName ? 0.5 : 1 }}>
            Release as
            <select value={sharing} disabled={!!templateName}
              onChange={(e) => setSharing(e.target.value as Sharing)}>
              <option value="public">Public</option>
              <option value="private">Private</option>
            </select>
          </label>
        </div>
      </div>

      {ent.features.schedule_release && (
        <div className="row" style={{ marginBottom: 12 }}>
          <label className="toolchk">
            <input type="checkbox" checked={scheduleOn} onChange={(e) => setScheduleOn(e.target.checked)} />
            Schedule public release
          </label>
          {scheduleOn && (
            <input type="datetime-local" value={releaseAtValue}
              onChange={(e) => setReleaseAtValue(e.target.value)} />
          )}
          {scheduleOn && (
            <span className="row__sub">uploads private now, flips public at this time</span>
          )}
        </div>
      )}

      {mixes && mixes.length === 0 && (
        <div className="empty"><div className="empty__icon">🎚️</div>No audio found in your watched folders.</div>
      )}

      <div className="stack">
        {visible.map((m, i) => (
          <label key={m.path} className="row scanrow--enter" style={{ ["--i" as any]: i, marginBottom: 0, opacity: m.uploaded || m.superseded_by ? 0.6 : 1 }}>
            <input type="checkbox" className="mixrow__check" disabled={m.uploaded || running}
              checked={selected.has(m.path)} onChange={() => toggle(m.path)} />
            <span className="fmt-badge">{m.ext.replace(".", "")}</span>
            <div className="row__main">
              <div className="row__title">{m.name}</div>
              <div className="row__sub">
                {fmtBytes(m.size)}{m.duration ? ` · ${fmtDuration(m.duration)}` : ""}
                {m.genre ? ` · ${m.genre_emoji ? m.genre_emoji + " " : ""}${m.genre}` : ""}
                {m.bpm ? ` · ${m.bpm} BPM` : ""}
                {m.dupe_formats && m.dupe_formats.length ? ` · also ${m.dupe_formats.join(", ")}` : ""}
              </div>
            </div>
            {!m.superseded_by && (
              <button type="button"
                className={`pill ${m.wip ? "pill--private" : ""}`}
                title="Work in progress — kept private and re-published on each new bounce"
                onClick={(e) => { e.preventDefault(); toggleWip(m); }}>
                {m.wip ? "● WIP" : "WIP"}
              </button>
            )}
            {m.uploaded
              ? <button className="pill pill--ok" onClick={(e) => { e.preventDefault(); m.permalink_url && openExternal(m.permalink_url); }}>● published</button>
              : m.superseded_by
                ? <span className="pill pill--skipped">↓ {m.superseded_by} kept</span>
                : <span className="pill">new</span>}
          </label>
        ))}
      </div>

      <div style={{ marginTop: 18, display: "flex", justifyContent: "flex-end" }}>
        <Button kind="primary" disabled={selected.size === 0 || running || upload.active} onClick={start}>
          {running ? "Publishing…" : `Publish ${selected.size || ""} to SoundCloud`}
        </Button>
      </div>
    </div>
  );
}
