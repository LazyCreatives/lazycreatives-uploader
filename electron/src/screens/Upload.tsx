import { useEffect, useRef, useState, type CSSProperties } from "react";
import { rowKey, useDialogFocus } from "../components/a11y";
import { makeApi, openExternal, pickImage, readImage, revealPath, saveRenderedCover } from "../api";
import { pickCover } from "../components/CoverPick";
import { coverPng } from "../coverRender";
import { Exit, openMenu, toast, type MenuItem, toastWarn } from "../components/Desktop";
import { GenreChip, pickGenre } from "../components/GenrePick";
import { copyText } from "../desktop";
import type { Config, Entitlement, Mix, Sharing, UploadItemInput } from "../types";
import { Button, fmtBytes, fmtCount, fmtDuration, fmtWhen, PageHeader, ProBadge, ProgressBar } from "../components/ui";
import { Icon } from "../components/Icon";
import { Cover } from "../components/Cover";
import { AuditionDiv, AuditionLabel, PlayButton, SongWave, type SongMeta } from "../components/Player";
import { levelCheck, needsLook, preflight, type Check } from "../checklist";
import { genreColor, useLook } from "../look";
import { EmptyState } from "../components/SlothSpot";
import type { ItemState, UploadState, ScanState } from "../useProgress";
import { preselect as pickDropped } from "../companionQueue";

const api = makeApi();

function dedupeTags(tags: string[]): string[] {
  const seen = new Set<string>();
  return tags.filter((t) => { const k = t.toLowerCase(); if (seen.has(k)) return false; seen.add(k); return true; });
}

// The tags one mix goes up with: the template's tags if it has some, else the
// Settings default tags, with the mix's tempo added as a tag (never replacing them).
export function mixTags(base: string[], bpm?: number | null): string[] {
  return dedupeTags([...base, ...(bpm ? [`${bpm} BPM`] : [])]);
}

// "Go public later" starts at this time tomorrow, on the hour, as a datetime-local value.
export function tomorrowSameHour(now: Date = new Date()): string {
  const d = new Date(now); d.setDate(d.getDate() + 1); d.setMinutes(0, 0, 0);
  return localInput(d);
}
// A date as the "YYYY-MM-DDTHH:MM" a datetime-local box takes, in the computer's time.
export function localInput(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

// Why the "Go public later" time can't be used yet, or null when it's fine.
export function releaseProblem(on: boolean, value: string, now: Date = new Date()): string | null {
  if (!on) return null;
  const d = new Date(value);
  if (!value || isNaN(d.getTime())) return "Pick when they go public";
  if (d.getTime() <= now.getTime()) return "Pick a time that hasn’t passed";
  return null;
}

// "Tue 7 Oct, 14:00", in the computer's own date style.
export function fmtRelease(value: string): string {
  const d = new Date(value);
  if (isNaN(d.getTime())) return value;
  return d.toLocaleString(undefined, { weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
}

// The heading of the last look before posting: how many, as what, on which account.
export function lastLookTitle(n: number, sharings: Sharing[], account: string | null, goesPublic: string | null): string {
  const what = `${n} ${n === 1 ? "mix" : "mixes"}`;
  const on = account ? ` on ${account}` : "";
  if (goesPublic) return `Post ${what} to SoundCloud${on}, going public ${goesPublic}`;
  const all = sharings.every((x) => x === sharings[0]) ? sharings[0] : null;
  return `Post ${what} to SoundCloud${all ? ` as ${all === "public" ? "Public" : "Private"}` : ""}${on}`;
}

export function Upload({ cfg, ent, scan, upload, resetUpload, account = null, preselect = null, onPreselected }: {
  cfg: Config; ent: Entitlement; scan: ScanState; upload: UploadState; account?: string | null;
  resetUpload: (queue?: string[], keepOthers?: boolean) => void;
  preselect?: string[] | null;     // mixes dropped on the narrow window: tick just these
  onPreselected?: () => void;
}) {
  const [look] = useLook();
  const [mixes, setMixes] = useState<Mix[] | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  // "Post as" starts from the Default release in Settings.
  const [sharing, setSharing] = useState<Sharing>(cfg.default_sharing || "public");
  useEffect(() => { setSharing(cfg.default_sharing || "public"); }, [cfg.default_sharing]);
  const [templateName, setTemplateName] = useState("");
  const [scheduleOn, setScheduleOn] = useState(false);
  const [releaseAtValue, setReleaseAtValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [showDupes, setShowDupes] = useState(false);
  // The post settings (Post as, cover, go public later) stay folded under one button.
  const [optsOpen, setOptsOpen] = useState(false);
  // Mixes already on SoundCloud stay folded away until asked for.
  const [showPosted, setShowPosted] = useState(false);
  const [showShort, setShowShort] = useState(false);
  const [query, setQuery] = useState("");
  const [coverArt, setCoverArt] = useState<string | null>(null);
  const [coverPreview, setCoverPreview] = useState<string | null>(null);
  const pollRef = useRef<number | null>(null);
  const jobRef = useRef<string | null>(null);
  const [stopping, setStopping] = useState(false);
  // The last look before posting: the mixes about to go up, or null while it's closed.
  const [review, setReview] = useState<{ items: UploadItemInput[]; releaseAt?: string } | null>(null);
  // Titles typed for this post, by file path; the mix's own name is used otherwise.
  const [titles, setTitles] = useState<Record<string, string>>({});
  const [editing, setEditing] = useState<string | null>(null);

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
  useEffect(() => { if (upload.done) { void rescan(selected); setRunning(false); setStopping(false); } }, [upload.done]);

  async function rescan(keep?: Set<string>) {
    setError(null);
    try {
      const [m, ov] = await Promise.all([api.scan(), api.overview().catch(() => null)]);
      setMixes(m);
      // Start with the mixes exported since your last post ticked (all new ones if
      // you've never posted), skipping lower-quality format duplicates (highest
      // quality wins), so an old mix you left behind on purpose isn't posted by accident.
      // Single-only on Free.
      const since = ov?.last_upload ? new Date(ov.last_upload).getTime() / 1000 : 0;
      const fresh = m.filter((x) => !x.uploaded && !x.superseded_by && !x.short).map((x) => x.path);
      const recent = m.filter((x) => !x.uploaded && !x.superseded_by && !x.short && x.mtime > since).map((x) => x.path);
      let pick = keep ? fresh.filter((p) => keep.has(p)) : recent;
      if (!keep && preselect?.length) {
        const dropped = pickDropped(m, preselect);
        pick = dropped.pick;
        onPreselected?.();
        if (m.some((x) => x.short && dropped.pick.includes(x.path))) setShowShort(true);  // dropped on purpose
        if (dropped.already.length && !dropped.pick.length) {
          toast(dropped.already.length === 1 ? `${dropped.already[0].name} is already on SoundCloud.` : "Those mixes are already on SoundCloud.");
        } else if (dropped.pick.length) {
          const shown = ent.features.batch ? dropped.pick.length : 1;
          toast(shown === 1 ? `${m.find((x) => x.path === dropped.pick[0])?.name ?? "Your mix"} is ticked and ready. Check the details, then post it.`
            : `${shown} mixes are ticked and ready. Check the details, then post them.`);
        } else if (dropped.notFound.length) {
          toastWarn("Couldn’t find that mix in your folders. Try Check folders.");
        }
      }
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
      resetLabel: "Use the project’s genre",
      yours: (mixes || []).filter((x) => x.genre_by_you && x.genre).map((x) => x.genre!),
      why: m.bpm ? `from its project’s tempo (${m.bpm} BPM) and name` : "from its project’s name",
      note: m.project_match
        ? `This sets the genre for this mix only. To change it for the whole of ${m.project_match}, change it in Backups.`
        : "This mix isn’t linked to a Backups project, so the genre is kept here for this mix.",
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
      toast(pick ? `${m.name} is now ${pick}.` : `${m.name} is back to its project’s genre.`, {
        label: "Undo",
        onClick: async () => { await api.setMixGenre([m.path], prev).catch(() => {}); show(prev); },
      });
    } catch {
      toastWarn("Couldn’t change the genre. Try again.");
    }
  }

  // Pick this mix's cover. Covers follow the song's project, like genres do.
  function changeCover(m: Mix) {
    void pickCover({
      title: m.name, name: m.project_match || m.name, genre: m.genre,
      note: m.project_match ? `Every mix of ${m.project_match} shows this cover. A cover picked in Backups shows here until you pick one here.` : undefined,
    });
  }

  // The cover each mix shows, made into a picture for SoundCloud (unless one was picked
  // for the whole post).
  async function withCovers(items: UploadItemInput[]): Promise<UploadItemInput[]> {
    return Promise.all(items.map(async (i) => {
      if (i.artwork_path || cfg.default_artwork_path) return i;
      const m = (mixes || []).find((x) => x.path === i.path);
      const name = m?.project_match || m?.name || i.name || "";
      try {
        return { ...i, artwork_path: await saveRenderedCover(name, await coverPng(name, m?.genre)) };
      } catch {
        return i;  // the mix still goes up, without a cover, rather than not at all
      }
    }));
  }

  // What the ticked mixes (or just `only`) will go up as.
  function plan(only?: string): UploadItemInput[] {
    const paths = only ? [only] : (mixes || []).filter((m) => selected.has(m.path)).map((m) => m.path);
    const tmpl = cfg.templates.find((t) => t.name === templateName);
    const baseTags = tmpl && tmpl.tags.length ? tmpl.tags : (cfg.default_tags || []);
    return (mixes || [])
      .filter((m) => paths.includes(m.path))
      .map((m) => {
        // Pre-fill from the Backups match: genre -> SoundCloud genre, BPM -> a tag
        // added to the template's or the Settings tags.
        const tags = mixTags(baseTags, m.bpm);
        // Drafts publish privately and carry a [WIP] marker in the title on SoundCloud.
        const own = titles[m.path]?.trim();
        const name = own || m.name;
        const baseTitle = tmpl ? tmpl.title_template.replace("{name}", name) : name;
        const title = m.wip ? `${baseTitle} [WIP]` : (tmpl || own ? baseTitle : undefined);
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
  }

  const extOf = (path: string) => (mixes || []).find((m) => m.path === path)?.ext ?? "";

  // Post the ticked mixes, or just `only` (Try again on one mix that failed). More
  // than one mix, or anything going public, gets a last look first.
  function start(only?: string) {
    // a "Go public later" without a usable time never posts (and never posts public now)
    if (scheduleOn && releaseProblem(true, releaseAtValue)) return;
    const items = plan(only);
    if (items.length === 0) return;
    const releaseAt = scheduleOn ? new Date(releaseAtValue).toISOString() : undefined;
    const goesPublic = !!releaseAt || items.some((i) => i.sharing === "public");
    // anything on the checklist worth a look also gets the last look, even one private mix
    const worth = items.some((i) => needsLook(preflight(i, cfg, extOf(i.path))) > 0);
    if (!only && (items.length > 1 || goesPublic || worth)) { setReview({ items, releaseAt }); return; }
    void post(items, releaseAt, !!only);
  }

  // A title changed on the last look: what goes up, and kept for next time.
  function retitle(path: string, text: string) {
    setReview((r) => r && { ...r, items: r.items.map((i) => (i.path === path ? { ...i, title: text } : i)) });
    if (!templateName) setTitles((t) => ({ ...t, [path]: text.replace(/\s*\[WIP\]$/, "") }));
  }
  // Name a mix for SoundCloud without renaming the file. Empty goes back to the file's name.
  function setTitle(m: Mix, text: string) {
    const t = text.trim();
    setTitles((prev) => {
      const next = { ...prev };
      if (!t || t === m.name) delete next[m.path]; else next[m.path] = t;
      return next;
    });
    setEditing(null);
  }

  async function post(items: UploadItemInput[], releaseAt: string | undefined, keepOthers: boolean) {
    setReview(null);
    setError(null); resetUpload(items.map((i) => i.path), keepOthers); setRunning(true); setStopping(false);
    try {
      const { job_id } = await api.upload(await withCovers(items), false, releaseAt);
      jobRef.current = job_id;
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

  // Finish the mix going up now, then post no more.
  async function stopAfterThis() {
    if (!jobRef.current || stopping) return;
    setStopping(true);
    try { await api.cancelJob(jobRef.current); }
    catch { setStopping(false); toastWarn("Couldn’t stop the post. It may have just finished."); }
  }

  // The whole post: finished mixes plus how far the current one has got.
  const finished = upload.completed + upload.skipped + upload.errors;
  const overallPct = upload.total > 0
    ? ((finished + (upload.size > 0 && upload.current ? upload.sent / upload.size : 0)) / upload.total) * 100
    : (running ? 3 : 0);
  const busy = running || upload.active;
  const itemOf = (m: Mix): ItemState | undefined => upload.items[m.path] ?? upload.items[m.name];
  const newCount = (mixes || []).filter((m) => !m.uploaded && !m.superseded_by && !m.short).length;
  const shortCount = (mixes || []).filter((m) => m.short && !m.superseded_by).length;
  const matched = (mixes || []).filter((m) => m.genre || m.bpm).length;
  const dupeCount = (mixes || []).filter((m) => m.superseded_by).length;
  const wipCount = (mixes || []).filter((m) => m.wip && !m.superseded_by).length;
  const q = query.trim().toLowerCase();
  const visible = (showDupes ? (mixes || []) : (mixes || []).filter((m) => !m.superseded_by))
    .filter((m) => showShort || !m.short)
    .filter((m) => !q || [m.name, m.project_match, m.genre].some((v) => v && v.toLowerCase().includes(q)));
  // New mixes first; the ones already on SoundCloud go under their own heading.
  const fresh = visible.filter((m) => !m.uploaded).sort((a, b) => b.mtime - a.mtime);
  const posted = visible.filter((m) => m.uploaded);
  const pickable = fresh.filter((m) => !m.superseded_by && !m.short).map((m) => m.path);  // a short one is ticked by hand
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

  const whenProblem = releaseProblem(scheduleOn, releaseAtValue);

  const summary = mixes === null ? "Looking through your watched folders…"
    : `${fmtCount(newCount)} new of ${fmtCount(mixes.length)} in your folders`
      + `${matched ? ` · ${fmtCount(matched)} tagged from Backups` : ""}${wipCount ? ` · ${wipCount} ${wipCount === 1 ? "draft" : "drafts"}` : ""}`
      + `${shortCount && !showShort ? ` · ${fmtCount(shortCount)} short ${shortCount === 1 ? "file" : "files"} hidden` : ""}`;
  // What the post will do, in a few words beside the Post settings button.
  const tmplOn = !!templateName;
  const postsAs = [
    tmplOn ? `Template ${templateName}` : sharing === "private" ? "Private" : "Public",
    coverArt ? "one cover for all" : "each mix's own cover",
    scheduleOn ? (whenProblem ? "pick when they go public" : `public ${fmtRelease(releaseAtValue)}`) : "",
  ].filter(Boolean).join(" · ");

  const mixMeta = (m: Mix): SongMeta => ({
    title: m.name, sub: m.project_match ? `From ${m.project_match}` : m.genre || "", genre: m.genre,
    cover: m.project_match || m.name,
  });
  // Right-click on a mix (both looks).
  const mixMenu = (m: Mix): MenuItem[] => [
    ...(m.permalink_url ? [
      { label: "Open on SoundCloud", onClick: () => openExternal(m.permalink_url!) },
      { label: "Copy SoundCloud link", onClick: () => { copyText(m.permalink_url!); } }, "-" as const] : []),
    ...(!m.uploaded && !m.superseded_by ? [{ label: "Edit title…", onClick: () => setEditing(m.path), disabled: running }] : []),
    { label: m.genre ? "Change genre…" : "Set genre…", onClick: () => changeGenre(m) },
    { label: "Change cover…", onClick: () => changeCover(m) },
    "-" as const,
    { label: "Show the file", onClick: () => revealPath(m.path) },
    { label: "Copy file path", onClick: () => { copyText(m.path); } },
    ...(!m.uploaded && !m.superseded_by ? ["-" as const,
      { label: m.wip ? "Post as the final version" : "Post as work in progress (private)", onClick: () => toggleWip(m), disabled: running }] : []),
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
          <span className="mixstate__bar"><span style={{ "--pct": it.size > 0 ? pct : 0 } as CSSProperties}
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
      : m.short
      ? <span className="pill pill--skipped" title="Shorter than the minimum length in Settings. Tick it to post it anyway.">Short</span>
      : m.wip
        ? <button type="button" className="pill pill--draft linkbtn"
            title="Draft: posted privately with [WIP] after its title, and replaced on each new bounce. Click to mark as final."
            onClick={(e) => { e.preventDefault(); e.stopPropagation(); toggleWip(m); }}>Draft</button>
        : null);
  // The "more" button at the end of a mix: the same list as a right-click.
  const moreButton = (m: Mix, cls = "") => (
    <button type="button" className={`iconbtn mix-more ${cls}`} title="More" aria-label={`More for ${m.name}`}
      onClick={(e) => { const r = e.currentTarget.getBoundingClientRect(); openMenu({ preventDefault: () => e.preventDefault(), stopPropagation: () => e.stopPropagation(), clientX: r.left, clientY: r.bottom + 4 }, mixMenu(m)); }}>
      <Icon name="more" size={16} /></button>
  );
  // Under the name: genre and tempo, the project when it has a different name, and
  // any other formats of the same mix. A format other than WAV is named too.
  const mixFrom = (m: Mix) => !m.project_match ? "not linked to a project"
    : m.project_match.trim().toLowerCase() === m.name.trim().toLowerCase() ? "" : `from ${m.project_match}`;

  // One mix as a sleeve (Sleeve look) or a row (Crate look).
  const sleeveCard = (m: Mix) => {
    const meta = mixMeta(m);
    const picked = selected.has(m.path);
    const locked = m.uploaded || busy;
    const note = liveNote(m);
    const it = itemOf(m);
    return (
      <AuditionDiv key={m.path} song={m.path} meta={meta} className={`sleeve${picked ? " sleeve--selected" : ""}${m.uploaded || m.superseded_by || m.short ? " sleeve--done" : ""}${it?.phase === "failed" ? " sleeve--failed" : ""}`}
        role="button" tabIndex={0} aria-pressed={picked} onContextMenu={(e) => openMenu(e, mixMenu(m))}
        onClick={() => { if (!locked) toggle(m.path); }}
        onKeyDown={rowKey(() => { if (!locked) toggle(m.path); })}>
        <div className="sleeve__art">
          <Cover name={m.project_match || m.name} genre={m.genre} />
          {statusBadge(m) && <span className="sleeve__badge">{statusBadge(m)}</span>}
          <input type="checkbox" className="mixrow__check mix-sleeve__check" disabled={locked} checked={picked}
            onClick={(e) => e.stopPropagation()} onChange={() => toggle(m.path)} aria-label={`Pick ${m.name}`} />
          <PlayButton path={m.path} meta={meta} size={34} className="sleeve__play" />
          {moreButton(m, "sleeve__coverbtn")}
          {it?.phase === "uploading" && (
            <span className="mix-sleeve__bar"><span style={{ "--pct": it.size > 0 ? (it.sent / it.size) * 100 : 0 } as CSSProperties} /></span>
          )}
        </div>
        <div className="sleeve__meta">
          <div className="track-sleeve__top">
            <div className="sleeve__name" title={m.name}>{titles[m.path] || m.name}</div>
          </div>
          <div className="track-sleeve__sub">
            <span className="col-trunc" title={m.project_match ?? undefined}>{[m.bpm ? `${Math.round(m.bpm)} BPM` : "", m.uploaded ? "" : fmtWhen(new Date(m.mtime * 1000).toISOString()), mixFrom(m), m.ext.toLowerCase() === ".wav" ? "" : m.ext.replace(".", "").toUpperCase()].filter(Boolean).join(" · ")}</span>
            <span className="mono">{m.duration ? fmtDuration(m.duration) : ""}</span>
          </div>
          <SongWave path={m.path} meta={meta} height={18} />
          {note
            ? <div className="mix-sleeve__state">{note}{it?.phase === "failed" && retry(m)}</div>
            : !m.superseded_by && !m.uploaded && <div className="mix-sleeve__draft">
                <GenreChip genre={m.genre ?? null} setByYou={!!m.genre_by_you} onClick={() => changeGenre(m)} />
              </div>}
        </div>
      </AuditionDiv>
    );
  };
  const crateRow = (m: Mix, i: number) => {
    const meta = mixMeta(m);
    const note = liveNote(m);
    const it = itemOf(m);
    return (
    <AuditionLabel key={m.path} song={m.path} meta={meta} className={`row cols mix-cols scanrow--enter${selected.has(m.path) ? " row--selected" : ""}`}
      onContextMenu={(e) => openMenu(e, mixMenu(m))}
      style={{ ["--i" as any]: i, cursor: m.uploaded || busy ? "default" : "pointer" }}>
      <span className="stripe" style={{ background: genreColor(m.genre) }} />
      <input type="checkbox" className="mixrow__check" disabled={m.uploaded || busy}
        checked={selected.has(m.path)} onChange={() => toggle(m.path)} aria-label={`Pick ${m.name}`} />
      <PlayButton path={m.path} meta={meta} size={28} />
      <Cover name={m.project_match || m.name} genre={m.genre} size={36} label={false} />
      <div className="row__main" style={{ opacity: m.uploaded || m.superseded_by || m.short ? 0.6 : 1 }}>
        <div className="row__title mix-title">
          {editing === m.path
            ? <TitleField name={m.name} value={titles[m.path] || m.name} onDone={(t) => setTitle(m, t)} onCancel={() => setEditing(null)} />
            : <span className="col-trunc" title={titles[m.path] ? `Posts as “${titles[m.path]}”. The file is ${m.name}.` : undefined}
                onDoubleClick={(e) => { if (m.uploaded || m.superseded_by || running) return; e.preventDefault(); setEditing(m.path); }}>
                {titles[m.path] || m.name}</span>}
          {titles[m.path] && editing !== m.path && <span className="pill pill--quiet" title={`The file is ${m.name}`}>New title</span>}
        </div>
        {note
          ? <div className="row__sub">{note}</div>
          : <div className="row__sub">
              <button type="button" className={`linkbtn mix-genre${m.genre_by_you || !m.genre ? "" : " genre-guess"}`}
                title={m.genre ? (m.genre_by_you ? "Genre set by you. Click to change" : "Genre guessed from the project. Click to correct it") : "Set a genre"}
                onClick={(e) => { e.preventDefault(); e.stopPropagation(); changeGenre(m); }}>{m.genre || "Set genre"}</button>
              {[m.bpm ? `${Math.round(m.bpm)} BPM` : "", m.uploaded ? "" : `exported ${fmtWhen(new Date(m.mtime * 1000).toISOString())}`, mixFrom(m), m.ext.toLowerCase() === ".wav" ? "" : m.ext.replace(".", "").toUpperCase(),
                m.dupe_formats && m.dupe_formats.length ? `also ${m.dupe_formats.join(", ")}` : ""]
                .filter(Boolean).map((t) => ` · ${t}`).join("")}
            </div>}
      </div>
      <SongWave path={m.path} meta={meta} height={24} />
      <span className="col-num" title={fmtBytes(m.size)}>{m.duration ? fmtDuration(m.duration) : "—"}</span>
      <span className="mixstate__cell">{statusBadge(m)}{it?.phase === "failed" && retry(m)}</span>
      {moreButton(m)}
    </AuditionLabel>
    );
  };

  return (
    <div>
      <PageHeader title="Upload" sub={summary} actions={<>
        <Button kind="quiet" onClick={() => rescan()} disabled={scan.active || busy}>
          <Icon name="refresh" />{scan.active ? "Checking…" : "Check folders"}
        </Button>
        {scheduleOn && selected.size > 0 && !busy && (
          <span className={`up-when${whenProblem ? " up-when--bad" : ""}`} role="status">
            {whenProblem ?? `Goes public ${fmtRelease(releaseAtValue)}`}</span>
        )}
        <Button kind="primary" disabled={selected.size === 0 || busy || !!whenProblem} onClick={() => start()}
          title={whenProblem ?? undefined}>
          {running ? "Posting…" : selected.size ? `Post ${selected.size} to SoundCloud` : "Post to SoundCloud"}
        </Button>
      </>} />

      {error && <div className="banner banner--warn"><Icon name="alert" className="banner__icon" />{error}</div>}

      {(running || upload.active || upload.done) && (
        <section className="card section up-overall">
          <div className="row-spread">
            <b style={{ fontWeight: 600 }}>{upload.done
              ? (upload.cancelled ? `Stopped. ${upload.completed} posted, the rest weren’t posted.` : "Done")
              : stopping ? `Stopping after ${upload.current ?? "this mix"}…`
              : upload.current ? `Posting ${Math.min(finished + 1, upload.total)} of ${upload.total}` : "Getting ready…"}</b>
            <span className="muted up-overall__counts">
              {upload.completed} posted · {upload.skipped} skipped · {upload.errors} failed
              {upload.lastUrl && (
                <> · <button className="linkbtn" onClick={() => openExternal(upload.lastUrl!)}>open the last one on SoundCloud</button></>
              )}
            </span>
          </div>
          <div className="up-overall__bar">
            <ProgressBar pct={upload.done ? 100 : overallPct} active={!upload.done} />
            {!upload.done && jobRef.current && upload.total - finished > 1 && (
              <Button kind="quiet" sm onClick={() => void stopAfterThis()} disabled={stopping}
                title="Finish the mix going up now, then post no more">
                {stopping ? "Stopping…" : "Stop after this mix"}</Button>
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

      <div className="toolbar up-tools">
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
        <span className="up-tools__plan" title={postsAs}>{postsAs}</span>
        <button type="button" className={`btn btn--sm up-tools__opts${optsOpen ? " up-tools__opts--on" : ""}`}
          aria-expanded={optsOpen} aria-controls="post-settings" onClick={() => setOptsOpen((o) => !o)}>
          <Icon name="settings" size={14} />Post settings<Icon name="chevronDown" size={13} className="up-tools__chev" />
        </button>
      </div>
      {optsOpen && (
        <div className="up-opts" id="post-settings">
          <label className="up-opt">
            <span className="up-opt__lbl">Post as</span>
            <span className="up-opt__row"><select value={sharing} disabled={tmplOn}
              onChange={(e) => setSharing(e.target.value as Sharing)}>
              <option value="public">Public</option>
              <option value="private">Private</option>
            </select></span>
          </label>
          {ent.features.metadata_templates && cfg.templates.length > 0 && (
            <label className="up-opt">
              <span className="up-opt__lbl">Template</span>
              <span className="up-opt__row"><select value={templateName} onChange={(e) => setTemplateName(e.target.value)}>
                <option value="">None</option>
                {cfg.templates.map((t) => <option key={t.name} value={t.name}>{t.name}</option>)}
              </select></span>
            </label>
          )}
          <div className="up-opt">
            <span className="up-opt__lbl">Cover</span>
            <span className="up-opt__row">
              {coverArt && coverPreview && <span className="art-thumb art-thumb--sm" aria-hidden="true"><img src={coverPreview} alt="" /></span>}
              <Button sm onClick={chooseCover} disabled={running}>{coverArt ? "Change…" : "One picture for all…"}</Button>
              {coverArt && <Button kind="quiet" sm onClick={() => setCoverArt(null)} disabled={running}>Use each mix's own</Button>}
            </span>
          </div>
          {ent.features.schedule_release && (
            <div className="up-opt">
              <span className="up-opt__lbl">Goes public</span>
              <span className="up-opt__row">
                <label className="toolchk">
                  <input type="checkbox" checked={scheduleOn} onChange={(e) => {
                    const on = e.target.checked;
                    setScheduleOn(on);
                    if (on && releaseProblem(true, releaseAtValue)) setReleaseAtValue(tomorrowSameHour());
                  }} />
                  Later
                </label>
                {scheduleOn && <input type="datetime-local" value={releaseAtValue} aria-label="When they go public"
                  min={localInput(new Date())}
                  onChange={(e) => setReleaseAtValue(e.target.value)} />}
              </span>
            </div>
          )}
          {dupeCount > 0 && (
            <label className="toolchk up-opt up-opt--end">
              <input type="checkbox" checked={showDupes} onChange={(e) => setShowDupes(e.target.checked)} />
              Show every format ({fmtCount(dupeCount)} hidden)
            </label>
          )}
          {shortCount > 0 && (
            <label className={`toolchk up-opt${dupeCount > 0 ? "" : " up-opt--end"}`}
              title="Exports shorter than the minimum length in Settings, like clicks and test bounces">
              <input type="checkbox" checked={showShort} onChange={(e) => setShowShort(e.target.checked)} />
              Show {fmtCount(shortCount)} short {shortCount === 1 ? "file" : "files"}
            </label>
          )}
          {(coverArt || scheduleOn) && (
            <p className="up-opts__note">
              {coverArt ? "This picture replaces every mix's own cover for this post. " : ""}
              {scheduleOn ? "Mixes go up private now and turn public at the time you pick." : ""}
            </p>
          )}
        </div>
      )}

      {mixes && mixes.length === 0 && (
        <div className="table"><EmptyState pose="empty-crate" title="No mixes in your watched folders yet" say="Empty crate. Nothing to post.">
          Export a mix into one of them, or add the folder you export into in Settings.
        </EmptyState></div>
      )}

      {visible.length > 0 && look === "sleeve" && (<>
        {fresh.length > 0 && <div className="sleeves mix-sleeves">{fresh.map(sleeveCard)}</div>}
        {posted.length > 0 && <>
          <button type="button" className="mix-split mix-split--btn" aria-expanded={showPosted || !!q} onClick={() => setShowPosted((v) => !v)}>
            <Icon name={showPosted || q ? "chevronDown" : "chevronRight"} size={15} />Already on SoundCloud<span>{fmtCount(posted.length)}</span></button>
          {(showPosted || !!q) && <div className="sleeves mix-sleeves">{posted.map(sleeveCard)}</div>}
        </>}
      </>)}

      {visible.length > 0 && look === "crate" && (
        <div className="table table--crate">
          <div className="row cols cols-head mix-cols">
            <span />
            <input type="checkbox" className="mixrow__check" ref={(el) => { if (el) el.indeterminate = somePicked && !allPicked; }}
              checked={allPicked} disabled={pickable.length === 0 || busy} onChange={toggleAll}
              aria-label={allPicked ? "Untick every mix" : "Tick every new mix"} title={allPicked ? "Untick every mix" : "Tick every new mix"} />
            <span /><span /><span>Mix</span><span>Waveform</span>
            <span className="col-num">Length</span><span>Status</span><span />
          </div>
          {fresh.map(crateRow)}
          {posted.length > 0 && (
            <button type="button" className="row mix-split mix-split--row mix-split--btn" aria-expanded={showPosted || !!q} onClick={() => setShowPosted((v) => !v)}>
              <Icon name={showPosted || q ? "chevronDown" : "chevronRight"} size={14} />Already on SoundCloud<span>{fmtCount(posted.length)}</span>
              <em>{showPosted || q ? "Hide" : "Show"}</em></button>
          )}
          {(showPosted || !!q) && posted.map((m, i) => crateRow(m, fresh.length + i))}
        </div>
      )}
      {mixes && mixes.length > 0 && visible.length === 0 && (
        <div className="table"><EmptyState pose="searching" title="No mixes match your search" say="Looked everywhere. Nothing.">
          Try fewer letters, or clear the search box.
        </EmptyState></div>
      )}
      <Exit>{review && (
        <LastLook items={review.items} account={account} cfg={cfg} extOf={extOf}
          goesPublic={review.releaseAt ? fmtRelease(releaseAtValue) : null}
          onBack={() => setReview(null)} onTitle={retitle} onPost={() => void post(review.items, review.releaseAt, false)} />
      )}</Exit>
    </div>
  );
}

// A last look before posting: how many, as what, on which account, and a checklist
// for each mix (title, cover, genre, tags, file, level) with anything worth fixing.
function LastLook({ items, account, goesPublic, cfg, extOf, onBack, onTitle, onPost }: {
  items: UploadItemInput[]; account: string | null; goesPublic: string | null;
  cfg: Config; extOf: (path: string) => string;
  onBack: () => void; onTitle: (path: string, text: string) => void; onPost: () => void;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  useDialogFocus(ref);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); onBack(); } };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onBack]);
  // levels are measured by the upload service (WAV, AIFF); others just skip that line
  const [levels, setLevels] = useState<Record<string, Check | null>>({});
  useEffect(() => {
    let alive = true;
    for (const i of items) {
      api.levels(i.path).then((r) => { if (alive) setLevels((l) => ({ ...l, [i.path]: levelCheck(r.levels) })); })
        .catch(() => { if (alive) setLevels((l) => ({ ...l, [i.path]: null })); });
    }
    return () => { alive = false; };
  }, [items]);
  const mixed = !goesPublic && items.some((i) => i.sharing !== items[0].sharing);
  const n = items.length;
  const lists = items.map((i) => {
    const lv = levels[i.path];
    return { item: i, checks: [...preflight(i, cfg, extOf(i.path)), ...(lv ? [lv] : [])] };
  });
  const toLook = lists.filter((l) => needsLook(l.checks) > 0).length;
  return (
    <div className="wnew__scrim" onClick={onBack}>
      <div ref={ref} className="wnew confirm lastlook" role="dialog" aria-modal="true"
        aria-labelledby="lastlook-title" onClick={(e) => e.stopPropagation()}>
        <div className="confirm__body">
          <h2 id="lastlook-title">{lastLookTitle(n, items.map((i) => i.sharing ?? "public"), account, goesPublic)}</h2>
          {goesPublic && <p>They go up private now and turn public then.</p>}
          <p className="lastlook__sum">{toLook === 0
            ? (n === 1 ? "Ready to go: everything on the checklist is in place." : `All ${n} are ready: everything on the checklist is in place.`)
            : `${toLook === n && n > 1 ? "Each one has" : `${toLook} of ${n} ${toLook === 1 ? "has" : "have"}`} something worth a look first. You can still post as they are.`}</p>
          <ol className="lastlook__list lastlook__checks">
            {lists.map(({ item, checks }) => {
              const loud = checks.filter((c) => c.state !== "ok");
              const fine = checks.filter((c) => c.state === "ok");
              return (
                <li key={item.path} className={loud.some((c) => c.state === "warn") ? "lastlook__mix lastlook__mix--look" : "lastlook__mix"}>
                  <div className="lastlook__name">
                    <Icon name={loud.some((c) => c.state === "warn") ? "alert" : "check"} size={14} />
                    <input className="lastlook__title" value={item.title ?? item.name ?? ""} spellCheck={false}
                      aria-label={`Title on SoundCloud for ${item.name}`} title="The title it goes up with. Click to change it."
                      onChange={(e) => onTitle(item.path, e.target.value)} />
                    {mixed && <span className="faint">{item.sharing === "private" ? "Private" : "Public"}</span>}
                  </div>
                  {loud.map((c) => <div key={c.key} className={`lastlook__check lastlook__check--${c.state}`}>{c.say}</div>)}
                  <div className="lastlook__fine">{fine.map((c) => c.say).join(" · ")}</div>
                </li>
              );
            })}
          </ol>
        </div>
        <div className="confirm__foot">
          <button type="button" className="btn btn--ghost confirm__cancel" onClick={onBack}>{toLook ? "Back to fix" : "Back"}</button>
          <button type="button" className="btn btn--primary" onClick={onPost}>{toLook ? `Post ${n} anyway` : `Post ${n}`}</button>
        </div>
      </div>
    </div>
  );
}

// Type a new title in place: Enter or clicking away keeps it, Escape leaves it as it was.
function TitleField({ name, value, onDone, onCancel }: {
  name: string; value: string; onDone: (text: string) => void; onCancel: () => void;
}) {
  const [text, setText] = useState(value);
  const done = useRef(false);
  const finish = (keep: boolean) => { if (done.current) return; done.current = true; keep ? onDone(text) : onCancel(); };
  return (
    <input className="mix-title__edit" autoFocus value={text} spellCheck={false}
      aria-label={`Title on SoundCloud for ${name}`} placeholder={name}
      onFocus={(e) => e.currentTarget.select()}
      onClick={(e) => { e.preventDefault(); e.stopPropagation(); }}
      onChange={(e) => setText(e.target.value)}
      onBlur={() => finish(true)}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === "Enter") { e.preventDefault(); finish(true); }
        if (e.key === "Escape") { e.preventDefault(); finish(false); }
      }} />
  );
}
