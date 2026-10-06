import { useEffect, useRef, useState } from "react";
import { makeApi, openExternal, pickImage, readImage, revealPath } from "../api";
import { openMenu, toast, type MenuItem } from "../components/Desktop";
import { GenreChip, pickGenre } from "../components/GenrePick";
import { copyText } from "../desktop";
import type { Config, Entitlement, Mix, Sharing, UploadItemInput } from "../types";
import { Button, fmtBytes, fmtDuration, PageHeader, ProBadge, ProgressBar } from "../components/ui";
import { Icon } from "../components/Icon";
import { Cover } from "../components/Cover";
import { PlayButton, SongWave, type SongMeta } from "../components/Player";
import { genreColor, useLook } from "../look";
import { EmptyState } from "../components/SlothSpot";
import type { ItemState, UploadState, ScanState } from "../useProgress";

const api = makeApi();

export function Upload({ cfg, ent, scan, upload, resetUpload }: {
  cfg: Config; ent: Entitlement; scan: ScanState; upload: UploadState;
  resetUpload: (queue?: string[], keepOthers?: boolean) => void;
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
  const [query, setQuery] = useState("");
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
  // Whatever was ticked and didn't go up (a failed mix) stays ticked for the next post.
  useEffect(() => { if (upload.done) { void rescan(selected); setRunning(false); } }, [upload.done]);

  async function rescan(keep?: Set<string>) {
    setError(null);
    try {
      const m = await api.scan();
      setMixes(m);
      // default-select everything not yet uploaded, skipping lower-quality format
      // duplicates (highest quality wins). Single-only on Free.
      const fresh = m.filter((x) => !x.uploaded && !x.superseded_by).map((x) => x.path);
      const pick = keep ? fresh.filter((p) => keep.has(p)) : fresh;
      setSelected(new Set(ent.features.batch ? pick : pick.slice(0, 1)));
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

  // Correct a mix's genre. A mix from a Backups project takes the project's genre
  // (correct it there for the whole project); this sets one just for this mix.
  async function changeGenre(m: Mix) {
    const pick = await pickGenre({
      title: m.name, cover: m.project_match || m.name,
      current: m.genre || null, setByYou: !!m.genre_by_you,
      guess: m.genre_mix ? m.genre_project ?? null : undefined,
      resetLabel: "Use the project's genre",
      yours: (mixes || []).filter((x) => x.genre_by_you && x.genre).map((x) => x.genre!),
      why: m.bpm ? `from its project's tempo (${m.bpm} BPM) and name` : "from its project's name",
      note: m.project_match
        ? `This sets the genre for this mix only. To change it for the whole of ${m.project_match}, change it in Backups.`
        : "This mix isn't linked to a Backups project, so the genre is kept here for this mix.",
    });
    if (pick === undefined) return;
    const prev = m.genre_mix ? m.genre || null : null;
    // show it straight away, without looking through the folders again
    const show = (g: string | null) => setMixes((list) => list && list.map((x) => x.path !== m.path ? x
      : g ? { ...x, genre: g, genre_mix: true, genre_by_you: true }
        : { ...x, genre: x.genre_project ?? null, genre_mix: false, genre_by_you: !!m.genre_by_you && !m.genre_mix }));
    try {
      await api.setMixGenre([m.path], pick);
      show(pick);
      toast(pick ? `${m.name} is now ${pick}.` : `${m.name} is back to its project's genre.`, {
        label: "Undo",
        onClick: async () => { await api.setMixGenre([m.path], prev).catch(() => {}); show(prev); },
      });
    } catch {
      toast("Couldn't change the genre. Try again.");
    }
  }

  // Post the ticked mixes, or just `only` (Try again on one mix that failed).
  async function start(only?: string) {
    const paths = only ? [only] : (mixes || []).filter((m) => selected.has(m.path)).map((m) => m.path);
    if (paths.length === 0) return;
    setError(null); resetUpload(paths, !!only); setRunning(true);
    const tmpl = cfg.templates.find((t) => t.name === templateName);
    const items: UploadItemInput[] = (mixes || [])
      .filter((m) => paths.includes(m.path))
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

  // The whole post: finished mixes plus how far the current one has got.
  const finished = upload.completed + upload.skipped + upload.errors;
  const overallPct = upload.total > 0
    ? ((finished + (upload.size > 0 && upload.current ? upload.sent / upload.size : 0)) / upload.total) * 100
    : (running ? 3 : 0);
  const busy = running || upload.active;
  const itemOf = (m: Mix): ItemState | undefined => upload.items[m.path] ?? upload.items[m.name];
  const newCount = (mixes || []).filter((m) => !m.uploaded && !m.superseded_by).length;
  const matched = (mixes || []).filter((m) => m.genre || m.bpm).length;
  const dupeCount = (mixes || []).filter((m) => m.superseded_by).length;
  const wipCount = (mixes || []).filter((m) => m.wip && !m.superseded_by).length;
  const q = query.trim().toLowerCase();
  const visible = (showDupes ? (mixes || []) : (mixes || []).filter((m) => !m.superseded_by))
    .filter((m) => !q || [m.name, m.project_match, m.genre].some((v) => v && v.toLowerCase().includes(q)));
  // New mixes first; the ones already on SoundCloud go under their own heading.
  const fresh = visible.filter((m) => !m.uploaded);
  const posted = visible.filter((m) => m.uploaded);
  const pickable = fresh.filter((m) => !m.superseded_by).map((m) => m.path);
  const allPicked = pickable.length > 0 && pickable.every((p) => selected.has(p));
  const somePicked = pickable.some((p) => selected.has(p));
  function toggleAll() {
    setSelected((prev) => {
      const next = new Set(prev);
      if (allPicked) { pickable.forEach((p) => next.delete(p)); return next; }
      if (!ent.features.batch) return new Set(pickable.slice(0, 1));
      pickable.forEach((p) => next.add(p));
      return next;
    });
  }

  const summary = mixes === null ? "Looking through your watched folders…"
    : `${mixes.length} ${mixes.length === 1 ? "mix" : "mixes"} found · ${newCount} new`
      + `${matched ? ` · ${matched} tagged from Backups` : ""}${wipCount ? ` · ${wipCount} work in progress` : ""}`
      + `${dupeCount && !showDupes ? ` · ${dupeCount} extra ${dupeCount === 1 ? "format" : "formats"} hidden` : ""}`;

  const mixMeta = (m: Mix): SongMeta => ({
    title: m.name, sub: m.project_match ? `From ${m.project_match}` : m.genre || "", genre: m.genre,
    cover: m.project_match || m.name,
  });
  // Right-click on a mix (both looks).
  const mixMenu = (m: Mix): MenuItem[] => [
    ...(m.permalink_url ? [
      { label: "Open on SoundCloud", onClick: () => openExternal(m.permalink_url!) },
      { label: "Copy SoundCloud link", onClick: () => { copyText(m.permalink_url!); } }, "-" as const] : []),
    { label: m.genre ? "Change genre…" : "Set genre…", onClick: () => changeGenre(m) },
    { label: "Show the file", onClick: () => revealPath(m.path) },
    { label: "Copy file path", onClick: () => { copyText(m.path); } },
    ...(!m.uploaded && !m.superseded_by ? ["-" as const,
      { label: m.wip ? "Mark as final" : "Mark as a draft", onClick: () => toggleWip(m), disabled: running }] : []),
  ];
  const retry = (m: Mix) => (
    <button type="button" className="btn btn--ghost btn--sm mixstate__retry" disabled={busy}
      onClick={(e) => { e.preventDefault(); e.stopPropagation(); void start(m.path); }}>Try again</button>
  );
  // How this mix is doing in the post that is running (or just ran), or null.
  const liveBadge = (m: Mix) => {
    const it = itemOf(m);
    if (!it) return null;
    const pct = it.size > 0 ? Math.round((it.sent / it.size) * 100) : 0;
    switch (it.phase) {
      case "waiting": return <span className="pill pill--skipped">Waiting</span>;
      case "uploading": return (
        <span className="mixstate mixstate--up">
          <span className="mixstate__label">Uploading <span className="num">{pct}%</span></span>
          <span className="mixstate__bar"><span style={{ width: `${it.size > 0 ? pct : 8}%` }}
            className={it.size > 0 ? "" : "mixstate__bar--wait"} /></span>
        </span>);
      case "posted": return (
        <button type="button" className="pill pill--ok mixstate--ok linkbtn" title={it.url ? "Open on SoundCloud" : undefined}
          onClick={(e) => { e.preventDefault(); e.stopPropagation(); it.url && openExternal(it.url); }}><Icon name="check" size={12} />Posted</button>);
      case "skipped": return <span className="pill pill--skipped" title="Already on SoundCloud">Skipped</span>;
      case "failed": return <span className="pill pill--error" title={it.error}>Failed</span>;
    }
  };
  // The line under the name that explains a skip or a failure, with Try again.
  const liveNote = (m: Mix) => {
    const it = itemOf(m);
    if (it?.phase === "skipped") return <span className="mixstate__note">Skipped (already on SoundCloud)</span>;
    if (it?.phase === "failed") return <span className="mixstate__note mixstate__note--err" title={it.error}>{it.reason}</span>;
    return null;
  };
  const statusBadge = (m: Mix) => liveBadge(m) ?? (m.uploaded
    ? <button type="button" className="pill pill--ok linkbtn"
        onClick={(e) => { e.preventDefault(); e.stopPropagation(); m.permalink_url && openExternal(m.permalink_url); }}>Posted</button>
    : m.superseded_by
      ? <span className="pill pill--skipped">Using {m.superseded_by}</span>
      : <span className="pill" style={{ ["--dot" as any]: "var(--accent)" }}>New</span>);
  const draftButton = (m: Mix) => m.wip
    ? <button type="button" className="chip chip--on" style={{ height: 24 }}
        title="Draft: kept private and replaced on each new bounce. Click to mark as final."
        onClick={(e) => { e.preventDefault(); e.stopPropagation(); toggleWip(m); }}>Draft</button>
    : <button type="button" className="linkbtn faint" style={{ fontSize: 12.5, color: "var(--text-faint)" }}
        title="Mark as a draft: kept private and replaced on each new bounce"
        onClick={(e) => { e.preventDefault(); e.stopPropagation(); toggleWip(m); }}>Mark draft</button>;

  // One mix as a sleeve (Sleeve look) or a row (Crate look).
  const sleeveCard = (m: Mix) => {
    const meta = mixMeta(m);
    const picked = selected.has(m.path);
    const locked = m.uploaded || busy;
    const note = liveNote(m);
    const it = itemOf(m);
    return (
      <div key={m.path} className={`sleeve${picked ? " sleeve--selected" : ""}${m.uploaded || m.superseded_by ? " sleeve--done" : ""}${it?.phase === "failed" ? " sleeve--failed" : ""}`}
        role="button" tabIndex={0} aria-pressed={picked} onContextMenu={(e) => openMenu(e, mixMenu(m))}
        onClick={() => { if (!locked) toggle(m.path); }}
        onKeyDown={(e) => { if ((e.key === "Enter" || e.key === " ") && !locked) { e.preventDefault(); toggle(m.path); } }}>
        <div className="sleeve__art">
          <Cover name={m.project_match || m.name} genre={m.genre} />
          <span className="sleeve__badge">{statusBadge(m)}</span>
          <input type="checkbox" className="mixrow__check mix-sleeve__check" disabled={locked} checked={picked}
            onClick={(e) => e.stopPropagation()} onChange={() => toggle(m.path)} aria-label={`Pick ${m.name}`} />
          <PlayButton path={m.path} meta={meta} size={34} className="sleeve__play" />
          {it?.phase === "uploading" && (
            <span className="mix-sleeve__bar"><span style={{ width: `${it.size > 0 ? (it.sent / it.size) * 100 : 0}%` }} /></span>
          )}
        </div>
        <div className="sleeve__meta">
          <div className="track-sleeve__top">
            <div className="sleeve__name" title={m.name}>{m.name}</div>
            <span className="fmt-badge">{m.ext.replace(".", "")}</span>
          </div>
          <div className="track-sleeve__sub">
            <span className="col-wrap2" title={m.project_match ?? undefined}>{m.project_match ? `From ${m.project_match}` : "Not linked to a project"}</span>
            <span className="mono">{m.duration ? fmtDuration(m.duration) : ""}</span>
          </div>
          <SongWave path={m.path} meta={meta} height={18} />
          {note
            ? <div className="mix-sleeve__state">{note}{it?.phase === "failed" && retry(m)}</div>
            : !m.superseded_by && !m.uploaded && <div className="mix-sleeve__draft">
                <GenreChip genre={m.genre ?? null} setByYou={!!m.genre_by_you} onClick={() => changeGenre(m)} />
                {draftButton(m)}
              </div>}
        </div>
      </div>
    );
  };
  const crateRow = (m: Mix, i: number) => {
    const meta = mixMeta(m);
    const note = liveNote(m);
    const it = itemOf(m);
    return (
    <label key={m.path} className={`row cols mix-cols scanrow--enter${selected.has(m.path) ? " row--selected" : ""}`}
      onContextMenu={(e) => openMenu(e, mixMenu(m))}
      style={{ ["--i" as any]: i, cursor: m.uploaded || busy ? "default" : "pointer" }}>
      <span className="stripe" style={{ background: genreColor(m.genre) }} />
      <input type="checkbox" className="mixrow__check" disabled={m.uploaded || busy}
        checked={selected.has(m.path)} onChange={() => toggle(m.path)} aria-label={`Pick ${m.name}`} />
      <PlayButton path={m.path} meta={meta} size={28} />
      <span className="fmt-badge">{m.ext.replace(".", "")}</span>
      <div className="row__main" style={{ opacity: m.uploaded || m.superseded_by ? 0.6 : 1 }}>
        <div className="row__title">{m.name}</div>
        {note
          ? <div className="row__sub">{note}</div>
          : <div className="row__sub">
              <button type="button" className={`linkbtn mix-genre${m.genre_by_you || !m.genre ? "" : " genre-guess"}`}
                title={m.genre ? (m.genre_by_you ? "Genre set by you. Click to change" : "Genre guessed from the project. Click to correct it") : "Set a genre"}
                onClick={(e) => { e.preventDefault(); e.stopPropagation(); changeGenre(m); }}>{m.genre || "Set genre"}</button>
              {[m.bpm ? `${m.bpm} BPM` : "", m.dupe_formats && m.dupe_formats.length ? `also ${m.dupe_formats.join(", ")}` : ""]
                .filter(Boolean).map((t) => ` · ${t}`).join("")}
            </div>}
      </div>
      <SongWave path={m.path} meta={meta} height={24} />
      <span className={`col-wrap2${m.project_match ? "" : " faint"}`} title={m.project_match ?? undefined}>{m.project_match || "Not linked"}</span>
      <span className="col-num">{m.duration ? fmtDuration(m.duration) : "—"}</span>
      <span className="col-num">{fmtBytes(m.size)}</span>
      <span>{!m.superseded_by && !m.uploaded && draftButton(m)}</span>
      <span className="mixstate__cell">{statusBadge(m)}{it?.phase === "failed" && retry(m)}</span>
    </label>
    );
  };

  return (
    <div>
      <PageHeader title="Upload" sub={summary} actions={<>
        <Button kind="quiet" onClick={() => rescan()} disabled={scan.active || busy}>
          <Icon name="refresh" />{scan.active ? "Looking…" : "Look again"}
        </Button>
        <Button kind="primary" disabled={selected.size === 0 || busy} onClick={() => start()}>
          {running ? "Posting…" : selected.size ? `Post ${selected.size} to SoundCloud` : "Post to SoundCloud"}
        </Button>
      </>} />

      {error && <div className="banner banner--warn"><Icon name="alert" className="banner__icon" />{error}</div>}

      {(running || upload.active || upload.done) && (
        <section className="card section up-overall">
          <div className="row-spread">
            <b style={{ fontWeight: 600 }}>{upload.done ? (upload.cancelled ? "Stopped" : "Done")
              : upload.current ? `Posting ${Math.min(finished + 1, upload.total)} of ${upload.total}` : "Getting ready…"}</b>
            <span className="muted up-overall__counts">
              {upload.completed} posted · {upload.skipped} skipped · {upload.errors} failed
              {upload.lastUrl && (
                <> · <button className="linkbtn" onClick={() => openExternal(upload.lastUrl!)}>open the last one on SoundCloud</button></>
              )}
            </span>
          </div>
          <ProgressBar pct={upload.done ? 100 : overallPct} active={!upload.done} />
        </section>
      )}

      {!ent.features.batch && (
        <div className="locked-note" style={{ marginBottom: 12 }}>
          <span>Free uploads one mix at a time.</span>
          <b>Batch upload<ProBadge /></b><span>posts a whole folder at once.</span>
        </div>
      )}

      <div className="toolbar">
        <label className="find__search upload-search">
          <Icon name="search" size={15} />
          <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search mixes, projects, genres…"
            aria-label="Search mixes" spellCheck={false} data-find
            onKeyDown={(e) => { if (e.key === "Escape") setQuery(""); }} />
          {query && <button type="button" className="find__x" aria-label="Clear search"
            onClick={() => setQuery("")}><Icon name="close" size={13} /></button>}
        </label>
        {look === "sleeve" && pickable.length > 0 && (
          <Button kind="quiet" sm onClick={toggleAll} disabled={busy}>{allPicked ? "Untick all" : `Tick all ${pickable.length} new`}</Button>
        )}
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
          Cover for this post
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
        <div className="table"><EmptyState pose="empty-crate" title="No mixes in your watched folders yet" say="Empty crate. Nothing to post.">
          Export a mix into one of them, or add the folder you export into in Settings.
        </EmptyState></div>
      )}

      {visible.length > 0 && look === "sleeve" && (<>
        {fresh.length > 0 && <div className="sleeves mix-sleeves">{fresh.map(sleeveCard)}</div>}
        {posted.length > 0 && <>
          <h2 className="mix-split"><Icon name="check" size={15} />Already on SoundCloud<span>{posted.length}</span></h2>
          <div className="sleeves mix-sleeves">{posted.map(sleeveCard)}</div>
        </>}
      </>)}

      {visible.length > 0 && look === "crate" && (
        <div className="table table--crate">
          <div className="row cols cols-head mix-cols">
            <span />
            <input type="checkbox" className="mixrow__check" ref={(el) => { if (el) el.indeterminate = somePicked && !allPicked; }}
              checked={allPicked} disabled={pickable.length === 0 || busy} onChange={toggleAll}
              aria-label={allPicked ? "Untick every mix" : "Tick every new mix"} title={allPicked ? "Untick every mix" : "Tick every new mix"} />
            <span /><span>Type</span><span>Mix</span><span>Waveform</span><span>From project</span>
            <span className="col-num">Length</span><span className="col-num">Size</span><span>Draft</span><span>Status</span>
          </div>
          {fresh.map(crateRow)}
          {posted.length > 0 && (
            <div className="row mix-split mix-split--row"><Icon name="check" size={14} />Already on SoundCloud<span>{posted.length}</span></div>
          )}
          {posted.map((m, i) => crateRow(m, fresh.length + i))}
        </div>
      )}
      {mixes && mixes.length > 0 && visible.length === 0 && (
        <div className="table"><EmptyState pose="searching" title="No mixes match your search" say="Looked everywhere. Nothing.">
          Try fewer letters, or clear the search box.
        </EmptyState></div>
      )}
    </div>
  );
}
