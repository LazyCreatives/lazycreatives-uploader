import { memo, useEffect, useMemo, useRef, useState } from "react";
import { makeApi, openExternal, pickImage, readImage, revealPath } from "../api";
import { askConfirm, CopyButton, Exit, openMenu, type MenuItem } from "../components/Desktop";
import { Rating, ratingMenu } from "../components/Marks";
import { ratingOf, useDensity, useRatings } from "../marks";
import { pickCrateColor } from "../components/GenrePick";
import { copyText, keep, recall } from "../desktop";
import type { BulkResult, Config, Entitlement, SeoScore, Sharing, Track, TrackComment, TrackUpdate } from "../types";
import { Button, PageHeader, SubLine, ProBadge, fmtDuration, fmtCount, parseTags } from "../components/ui";
import { Icon } from "../components/Icon";
import { Art, PlayButton, SongWave, useAudition, useSongLength, type SongMeta } from "../components/Player";
import type { WaveMark } from "../components/Wave";
import { GENRES, genreColor, useGenreColors, useLook } from "../look";
import { EmptyState } from "../components/SlothSpot";
import {
  BPM_BANDS, FIRST_DESC, LOW_SCORE, NO_FILTERS, applyFilters, dawName, describeFilters, extraFilterCount, yearOf, isFiltered, isPrivate, pickerOptions,
  privacyCounts, sortTracks, type PrivacyFilter, type SortKey, type TrackFilters,
} from "../trackFilter";
import { rowKey, useDialogFocus } from "../components/a11y";
import { SmartBar } from "../components/SmartBar";
import { ColumnBrowse, FacetChips, NO_GENRE, facets } from "../components/Browse";
import { TrackPlaylists, pickPlaylist } from "../components/PlaylistPick";
import { NoteOpened } from "../components/Recents";
import "../manage.css";
import { Collection } from "../components/Collection";
import { collectionOf } from "./Home";

const api = makeApi();
const PAGE_SIZE_OPTIONS = [25, 50, 100, 200];
const BULK_CONFIRM_THRESHOLD = 25;   // confirm before a long sequential bulk write

const SEO_GRADE_CLASS: Record<string, string> = {
  A: "seo--a", B: "seo--b", C: "seo--c", D: "seo--d", F: "seo--f",
};

function SeoBadge({ seo }: { seo?: SeoScore | null }) {
  if (!seo) return null;
  const title = `Search score ${seo.score} out of 100`
    + (seo.suggestions.length ? ` — ${seo.suggestions[0]}` : "");
  return (
    <span className={`mng-seo ${SEO_GRADE_CLASS[seo.grade] || "seo--f"}`} title={title} aria-label={title}>
      {seo.score}
    </span>
  );
}

// Pretty-print an ISO timestamp; null → "—".
function fmtDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "—";
  return d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

// The music app's plain name, the same words Backups uses.
const dawLabel = dawName;

// A track's confident backup is "stale" if its newest backup (or the matched
// project's mtime) predates the track itself — borrowed metadata may be out of date.
function backupStale(t: Track): boolean {
  const created = t.created_at ? Date.parse(t.created_at) : NaN;
  if (isNaN(created)) return false;
  const last = t.backups?.last_backup ? Date.parse(t.backups.last_backup) : NaN;
  if (!isNaN(last)) return last < created;
  if (t.project_mtime != null) return t.project_mtime * 1000 < created;
  return false;
}

function isMatched(t: Track): boolean { return !!t.project_match; }
// what a track's rating is kept under (marks.ts)
const rateKey = (t: Track) => `sc:${t.id}`;

// A re-enriched track returned by an edit/bulk op lacks the dupe_* fields (those are set
// only in the backend's list pass), so carry them over from the row being replaced —
// otherwise editing a track silently drops its FLAC/MP3 duplicate chips.
export function mergeEnriched(prev: Track, next: Track): Track {
  return { ...next, dupe_group: prev.dupe_group, dupe_count: prev.dupe_count, dupe_keeper: prev.dupe_keeper };
}

// Surface sign-in failures with what to do. A sign-out also shows "Sign in again" in
// the sidebar (api.ts tells the app).
function friendlyError(msg: string): string {
  const m = msg.toLowerCase();
  if (m.includes("signed you out") || m.includes("sign in again")) return "SoundCloud signed you out. Sign in again from the sidebar.";
  if (m.includes("connect a soundcloud")) return "Connect SoundCloud in Settings to see your tracks here.";
  return msg;
}

// The search, filters, sort and page, kept while the app is open so "Your tracks"
// looks the same when you come back to it from another page. The filters, sort and
// page size are also saved for the next time the app opens; the search text and the
// page number are not, so the list never opens half-empty.
const KEPT_KEY = "lc-tracks-view";
const START = {
  ...NO_FILTERS, sortKey: "date" as SortKey, sortDesc: true, page: 0, pageSize: 50,
};
const savedView = recall<Partial<typeof START>>(KEPT_KEY, {}, (v) => !!v && typeof v === "object");
const kept = { ...START };
for (const k of Object.keys(START) as (keyof typeof START)[]) {
  if (k !== "q" && k !== "page" && typeof savedView[k] === typeof START[k]) (kept as any)[k] = savedView[k];
}
if (!(kept.sortKey in FIRST_DESC)) kept.sortKey = "date";

// Open Your tracks on a ready-made set of filters (a smart crate or genre picked in
// Cmd/Ctrl+K). Works whether or not the page is showing.
let applyView: ((f: TrackFilters) => void) | null = null;
export function showTracks(f: TrackFilters) {
  Object.assign(kept, f, { page: 0 });
  applyView?.(f);
}

// openTrack: the track whose edit panel is open (its id), or null. Opening and closing
// go through the app's back/forward history, so the mouse's back button closes it.
export function Manage({ ent, cfg, openTrack, onOpenTrack, onCloseTrack }: {
  ent: Entitlement; cfg: Config;
  openTrack: string | null; onOpenTrack: (id: string) => void; onCloseTrack: () => void;
}) {
  const [look] = useLook();
  const [rows] = useDensity("tracks");   // set in Settings > Lists
  // The filter pickers stay folded under one button until asked for (or in use).
  const [filtersOpen, setFiltersOpen] = useState(false);
  useRatings();  // redraw (and re-sort) when a rating changes
  const canBulk = ent.features.batch;

  const [tracks, setTracks] = useState<Track[] | null>(null);
  const [defaultArt, setDefaultArt] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // toolbar / filter state
  const [filters, setFiltersState] = useState<TrackFilters>(() => {
    const f = { ...NO_FILTERS };
    for (const k of Object.keys(NO_FILTERS) as (keyof TrackFilters)[]) (f as any)[k] = kept[k];
    return f;
  });
  const setFilters = (patch: Partial<TrackFilters> | null) =>
    setFiltersState((f) => (patch ? { ...f, ...patch } : { ...NO_FILTERS }));
  useEffect(() => {
    applyView = (f) => { setFiltersState(f); };
    return () => { applyView = null; };
  }, []);
  // filters.q is the search as it applies: the search box only hands it over after a
  // pause in typing (SearchBox), so the list isn't worked out again on every key.
  const search = filters.q.trim();
  const [sortKey, setSortKey] = useState<SortKey>(kept.sortKey);
  const [sortDesc, setSortDesc] = useState(kept.sortDesc);
  const [page, setPage] = useState(kept.page);
  const [pageSize, setPageSize] = useState(kept.pageSize);
  useEffect(() => {
    Object.assign(kept, { ...filters, sortKey, sortDesc, page, pageSize });
  });
  useEffect(() => {
    keep(KEPT_KEY, { ...filters, q: "", sortKey, sortDesc, pageSize });
  }, [filters, sortKey, sortDesc, pageSize]);
  // Pick a sort; picking the one already in use flips it.
  function sortBy(key: SortKey) {
    if (key === sortKey) { setSortDesc((d) => !d); return; }
    setSortKey(key); setSortDesc(FIRST_DESC[key]);
  }

  // selection + dialogs
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const lastClickedRef = useRef<number | null>(null);
  const editing = openTrack ? (tracks || []).find((t) => String(t.id) === openTrack) ?? null : null;
  const setEditing = (t: Track | null) => (t ? onOpenTrack(String(t.id)) : onCloseTrack());
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [bulkEdit, setBulkEdit] = useState(false);
  const [bulkBusy, setBulkBusy] = useState(false);
  const [bulkSummary, setBulkSummary] = useState<string | null>(null);

  async function load() {
    setError(null);
    try { setTracks(await api.listTracks()); }
    catch (e) { setError(String((e as Error).message)); setTracks([]); }
  }
  useEffect(() => { void load(); }, []);
  // The user's configured default cover art is the preferred no-art stand-in.
  useEffect(() => {
    let alive = true;
    const p = cfg.default_artwork_path;
    if (!p) { setDefaultArt(null); return; }
    readImage(p).then((url) => { if (alive) setDefaultArt(url); }).catch(() => { if (alive) setDefaultArt(null); });
    return () => { alive = false; };
  }, [cfg.default_artwork_path]);

  // reset to first page whenever the filtered set changes (not on coming back to the page)
  const filterKey = JSON.stringify([{ ...filters, q: search }, sortKey, sortDesc, pageSize]);
  const lastFilterKey = useRef(filterKey);
  useEffect(() => {
    if (lastFilterKey.current === filterKey) return;
    lastFilterKey.current = filterKey;
    setPage(0);
  }, [filterKey]);

  // ---- filter + sort (client-side) ----
  const active = useMemo(() => ({ ...filters, q: search }), [filters, search]);
  const rated = (tracks || []).map((t) => ratingOf(rateKey(t))).join();
  const filtered = useMemo(
    () => sortTracks(applyFilters(tracks || [], active), sortKey, sortDesc),
    [tracks, active, sortKey, sortDesc, rated]);
  const counts = useMemo(() => privacyCounts(tracks || [], active), [tracks, active]);
  const options = useMemo(() => pickerOptions(tracks || []), [tracks]);
  const anyFilter = isFiltered(filters);
  const extraOn = extraFilterCount(filters);
  const showFilters = filtersOpen || extraOn > 0;
  const years = useMemo(() => [...new Set((tracks || []).map(yearOf).filter(Boolean))].sort().reverse(), [tracks]);
  const anyRated = rated.replace(/[0,]/g, "") !== "";
  // Crate: the usual list, or Genre > Year > Track columns
  // Rows, covers, or Genre > Year > Track columns
  type View = "list" | "covers" | "columns";
  const [view, setViewState] = useState<View>(() => recall<View>("lc-tracks-layout", "list", (v) => v === "list" || v === "covers" || v === "columns"));
  const setView = (v: View) => { keep("lc-tracks-layout", v); setViewState(v); };
  const columns = look === "crate" && view === "columns";
  const coverView = look === "sleeve" || view === "covers";
  // Genre and Year to browse by, counted over what the other filters leave
  const browse = useMemo(() => {
    const pool = applyFilters(tracks || [], { ...active, genre: "", year: "" });
    const inGenre = active.genre ? applyFilters(pool, { ...NO_FILTERS, genre: active.genre }).length : pool.length;
    return { ...facets(pool, (t) => t.genre, yearOf, active.genre), total: pool.length, inGenre };
  }, [tracks, active, rated]);

  // Lower-quality duplicate copies (e.g. the MP3 when a FLAC of the same title exists).
  const lossyDupes = useMemo(
    () => (tracks || []).filter((t) => (t.dupe_count ?? 0) > 1 && !t.dupe_keeper),
    [tracks]);
  const doubledSongs = useMemo(() => new Set(lossyDupes.map((t) => t.dupe_group)).size, [lossyDupes]);
  function selectLossyDupes() {
    setSelected(new Set(lossyDupes.map((t) => t.id)));
    setBulkSummary(null);
  }
  // When the last duplicate is cleaned up, drop the (now-hidden) Duplicates filter so the
  // list doesn't dead-end as an empty filtered view with no visible way to clear it.
  useEffect(() => { if (filters.dupes && lossyDupes.length === 0) setFilters({ dupes: false }); }, [lossyDupes.length, filters.dupes]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const safePage = Math.min(page, totalPages - 1);
  const pageStart = safePage * pageSize;
  const pageItems = filtered.slice(pageStart, pageStart + pageSize);

  const matchedCount = (tracks || []).filter(isMatched).length;
  // Selection can span pages, so report it against the whole filtered set.
  const filteredIds = useMemo(() => filtered.map((t) => t.id), [filtered]);
  const allFilteredSelected = filteredIds.length > 0 && filteredIds.every((id) => selected.has(id));
  function selectAllFiltered() { setSelected(new Set(filteredIds)); setBulkSummary(null); }

  // ---- selection ----
  function selectRange(toId: number, additive: boolean) {
    const ids = filtered.map((t) => t.id);
    const from = lastClickedRef.current;
    if (from == null || !ids.includes(from)) { toggleSelect(toId, additive); return; }
    const i = ids.indexOf(from), j = ids.indexOf(toId);
    const [lo, hi] = i < j ? [i, j] : [j, i];
    const range = ids.slice(lo, hi + 1);
    setSelected((prev) => {
      const next = additive ? new Set(prev) : new Set<number>();
      for (const id of range) next.add(id);
      return next;
    });
  }
  function toggleSelect(id: number, additive: boolean) {
    setSelected((prev) => {
      // Free: single-select only (mirrors Upload).
      if (!canBulk) return prev.has(id) ? new Set() : new Set([id]);
      const next = additive ? new Set(prev) : new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
    lastClickedRef.current = id;
  }
  function onRowCheck(e: React.MouseEvent, id: number) {
    if (canBulk && (e.shiftKey)) { e.preventDefault(); selectRange(id, true); return; }
    e.preventDefault();
    toggleSelect(id, true);
  }
  function clearSelection() { setSelected(new Set()); setBulkSummary(null); }

  // ---- single-track mutations ----
  function applyUpdate(t: Track) {
    setTracks((prev) => (prev || []).map((x) => (x.id === t.id ? mergeEnriched(x, t) : x)));
  }
  // Splice the freshly-enriched rows a bulk op returns, so SEO/cover/backups stay current
  // without a full refetch (and dupe_* is carried over from the previous row).
  function spliceBulkTracks(results: BulkResult["results"]) {
    const byId = new Map<number, Track>(
      results.filter((r) => r.ok && r.track).map((r) => [r.id, r.track as Track]));
    if (byId.size === 0) return;
    setTracks((prev) => (prev || []).map((t) => (byId.has(t.id) ? mergeEnriched(t, byId.get(t.id)!) : t)));
  }
  async function quickPrivacy(t: Track, next: Sharing) {
    try { applyUpdate(await api.updateTrack(t.id, { sharing: next })); }
    catch (e) { setError(String((e as Error).message)); }
  }
  async function deleteOne(t: Track) {
    if (!(await askConfirm({ title: `Delete “${t.title}” from SoundCloud?`,
      body: "It goes from SoundCloud with its plays, likes and comments. This can’t be undone.",
      confirm: "Delete", cancel: "Keep it", danger: true }))) return;
    try {
      await api.deleteTrack(t.id);
      setTracks((prev) => (prev || []).filter((x) => x.id !== t.id));
      setSelected((prev) => { const n = new Set(prev); n.delete(t.id); return n; });
    } catch (e) { setError(String((e as Error).message)); }
  }

  // Right-click on a track (both looks): the everyday actions in one place.
  function trackMenu(t: Track): MenuItem[] {
    const priv = isPrivate(t);
    const many = selected.has(t.id) ? (tracks || []).filter((x) => selected.has(x.id)) : [t];
    return [
      ...(t.permalink_url ? [
        { label: "Open on SoundCloud", onClick: () => openExternal(t.permalink_url!) },
        { label: "Copy SoundCloud link", onClick: () => { copyText(t.permalink_url!); } },
        "-" as const] : []),
      { label: "Edit details", onClick: () => setEditing(t) },
      { label: many.length > 1 ? `Add ${many.length} to a playlist…` : "Add to playlist…", onClick: () => void pickPlaylist(many) },
      { label: priv ? "Make public" : "Make private", onClick: () => void quickPrivacy(t, priv ? "public" : "private") },
      "-",
      ...ratingMenu(many.map(rateKey), ratingOf(rateKey(t))),
      ...(t.genre ? [{ label: `Crate colour for ${t.genre}…`, onClick: () => pickCrateColor(t.genre, t.title) }] : []),
      ...(t.local_path ? [
        "-" as const,
        { label: "Show the file", onClick: () => revealPath(t.local_path!) },
        { label: "Copy file path", onClick: () => { copyText(t.local_path!); } }] : []),
      "-",
      { label: "Delete from SoundCloud…", onClick: () => void deleteOne(t), danger: true },
    ];
  }

  // ---- bulk mutations ----
  const selectedIds = useMemo(() => Array.from(selected), [selected]);
  // SoundCloud has no batch API, so a bulk op is N sequential writes (~0.25s each) with no
  // mid-run cancel. Warn + estimate before a large run so it isn't a surprise freeze.
  async function confirmLargeBulk(verb: string): Promise<boolean> {
    const n = selectedIds.length;
    if (n < BULK_CONFIRM_THRESHOLD) return true;
    const secs = Math.ceil(n * 0.25);
    const mins = secs >= 90 ? ` (~${Math.ceil(secs / 60)} min)` : ` (~${secs}s)`;
    return askConfirm({ title: `${verb} ${n} tracks?`,
      body: `This runs as ${n} separate SoundCloud updates${mins} and can’t be stopped once it starts.`,
      confirm: `${verb} ${n}` });
  }
  function summarize(res: BulkResult, noun: string, pastTense: string, failNote = ""): void {
    const ok = res.results.filter((r) => r.ok).length;
    const fails = res.results.length - ok;
    setBulkSummary(`${ok} ${noun}${ok === 1 ? "" : "s"} ${pastTense}${fails ? ` · ${fails} failed${failNote}` : ""}`);
  }
  async function runBulkUpdate(patch: TrackUpdate) {
    if (selectedIds.length === 0) return;
    if (!await confirmLargeBulk(patch.sharing ? `Make ${patch.sharing}` : "Update")) return;
    setBulkBusy(true); setBulkSummary(null); setError(null);
    try {
      const res = await api.bulkUpdate(selectedIds, patch);
      spliceBulkTracks(res.results);
      summarize(res, "track", "updated");
      setBulkEdit(false);
    } catch (e) { setError(String((e as Error).message)); }
    finally { setBulkBusy(false); }
  }
  async function runBulkDelete(): Promise<BulkResult | null> {
    if (selectedIds.length === 0) return null;
    setBulkBusy(true); setError(null);
    try {
      const res = await api.bulkDelete(selectedIds);
      const okIds = new Set(res.results.filter((r) => r.ok).map((r) => r.id));
      const fails = res.results.filter((r) => !r.ok);
      // remove only the successfully-deleted ids; keep failures live & selected
      setTracks((prev) => (prev || []).filter((t) => !okIds.has(t.id)));
      setSelected((prev) => { const n = new Set(prev); for (const id of okIds) n.delete(id); return n; });
      setBulkSummary(`${okIds.size} deleted${fails.length ? ` · ${fails.length} failed (still live)` : ""}`);
      return res;
    } catch (e) { setError(String((e as Error).message)); return null; }
    finally { setBulkBusy(false); }
  }
  async function runBulkArtwork() {
    if (selectedIds.length === 0) return;
    const path = await pickImage();
    if (!path) return;
    if (!await confirmLargeBulk("Set cover art on")) return;
    setBulkBusy(true); setBulkSummary(null); setError(null);
    try {
      const res = await api.bulkArtwork(selectedIds, path);
      spliceBulkTracks(res.results);   // returned rows carry the real new artwork_url
      summarize(res, "cover", "set");
    } catch (e) { setError(String((e as Error).message)); }
    finally { setBulkBusy(false); }
  }
  async function runBulkWaveform() {
    if (selectedIds.length === 0) return;
    if (!await confirmLargeBulk("Generate waveform covers for")) return;
    setBulkBusy(true); setBulkSummary(null); setError(null);
    try {
      const res = await api.bulkWaveformCover(selectedIds);
      spliceBulkTracks(res.results);   // splice the new covers in — no full refetch needed
      summarize(res, "waveform cover", "set", " (no waveform yet?)");
    } catch (e) { setError(String((e as Error).message)); }
    finally { setBulkBusy(false); }
  }

  function clearFilters() { setFilters(null); }

  // What a row's buttons do, kept in one object that never changes, so a row only
  // draws again when its own track or tick changes (TrackRow is memoised).
  const latest = useRef({ onRowCheck, quickPrivacy, setEditing, deleteOne, trackMenu });
  latest.current = { onRowCheck, quickPrivacy, setEditing, deleteOne, trackMenu };
  const rowActions = useMemo<RowActions>(() => ({
    check: (e, t) => latest.current.onRowCheck(e, t.id),
    privacy: (t, next) => void latest.current.quickPrivacy(t, next),
    edit: (t) => latest.current.setEditing(t),
    remove: (t) => void latest.current.deleteOne(t),
    menu: (e, t) => openMenu(e, latest.current.trackMenu(t)),
  }), []);
  // The columns view draws the first COLUMN_PAGE tracks and more on asking, so a big
  // library doesn't freeze the window while thousands of buttons are made.
  const [columnShown, setColumnShown] = useState(COLUMN_PAGE);
  useEffect(() => { setColumnShown(COLUMN_PAGE); }, [filtered]);

  const friendly = error ? friendlyError(error) : null;
  const loading = tracks === null;
  const showBulkBar = canBulk && selected.size > 0;

  return (
    <div>
      <PageHeader title="Your tracks"
        sub={loading ? "Loading your SoundCloud…" : <>
          {`${fmtCount((tracks || []).length)} on SoundCloud`}
          {matchedCount ? ` · ${fmtCount(matchedCount)} linked to projects` : ""}
        </>}
        actions={<>
          {/* how the whole page shows your tracks: rows, covers, or genre/year/track columns */}
          {look === "crate" && !loading && (tracks || []).length > 0 && (
            <div className="seg find__view" role="radiogroup" aria-label="Show as">
              {([["list", "library", "Rows", "Rows"], ["covers", "image", "Covers", "Covers"], ["columns", "columns", "Columns", "Genre, year and track columns"]] as const).map(([k, icon, label, say]) => (
                <button key={k} type="button" role="radio" aria-checked={view === k} title={say}
                  className={`seg__opt${view === k ? " seg__opt--on" : ""}`} onClick={() => setView(k)}><Icon name={icon} size={14} />{label}</button>
              ))}
            </div>
          )}
          <Button kind="quiet" onClick={load}><Icon name="refresh" />Refresh</Button>
        </>} />

      {friendly && <div className="banner banner--warn"><Icon name="alert" className="banner__icon" />{friendly}</div>}

      {/* ---- search and filters; the bulk bar sits under them when tracks are ticked ---- */}
      {!loading && (tracks || []).length > 0 && (
        <div className="find">
          <div className="find__top">
            <SearchBox value={filters.q} onSearch={(q) => setFilters({ q })} />
            <div className="seg" role="group" aria-label="Privacy">
              {([["all", "All"], ["public", "Public"], ["private", "Private"]] as [PrivacyFilter, string][]).map(([k, label]) => (
                <button key={k} type="button" className={`seg__opt${filters.privacy === k ? " seg__opt--on" : ""}`}
                  aria-pressed={filters.privacy === k} onClick={() => setFilters({ privacy: k })}>
                  {label} <span className="find__n">{fmtCount(counts[k])}</span>
                </button>
              ))}
            </div>
            <label className="toolchk">
              Sort
              <select value={sortKey} onChange={(e) => sortBy(e.target.value as SortKey)} aria-label="Sort by">
                <option value="date">Date posted</option>
                <option value="title">Title</option>
                <option value="project">Project</option>
                <option value="plays">Plays</option>
                <option value="duration">Length</option>
                <option value="bpm">BPM</option>
                <option value="seo">Search score</option>
                <option value="rating">Rating</option>
              </select>
            </label>
            <button type="button" className="iconbtn" onClick={() => setSortDesc((d) => !d)}
              aria-label={sortDesc ? "Sorted high to low" : "Sorted low to high"} title={sortDesc ? "High to low" : "Low to high"}>
              <Icon name={sortDesc ? "arrowDown" : "arrowUp"} />
            </button>
            <button type="button" className={`btn btn--sm find__filters${showFilters ? " find__filters--on" : ""}`}
              aria-expanded={showFilters} onClick={() => setFiltersOpen((o) => !(o || extraOn > 0))}
              title={extraOn > 0 ? "Clear the filters to fold them away" : undefined}>
              Filters{extraOn > 0 && <span className="find__n">{extraOn}</span>}
              <Icon name="chevronDown" size={13} className="up-tools__chev" />
            </button>
          </div>
          {showFilters && <div className="find__row">
            {options.daws.length > 1 && (
              <select className={filters.daw ? "find__pick find__pick--on" : "find__pick"} value={filters.daw}
                aria-label="DAW" onChange={(e) => setFilters({ daw: e.target.value })}>
                <option value="">Any DAW</option>
                {options.daws.map((d) => <option key={d} value={d}>{dawName(d)}</option>)}
              </select>
            )}
            {options.genres.length > 0 && (
              <select className={filters.genre ? "find__pick find__pick--on" : "find__pick"} value={filters.genre}
                aria-label="Genre" onChange={(e) => setFilters({ genre: e.target.value })}>
                <option value="">Any genre</option>
                {options.genres.map((g) => <option key={g} value={g}>{g}</option>)}
                {(tracks || []).some((t) => !(t.genre || "").trim()) && <option value={NO_GENRE}>No genre</option>}
              </select>
            )}
            <select className={filters.bpm ? "find__pick find__pick--on" : "find__pick"} value={filters.bpm}
              aria-label="BPM" onChange={(e) => setFilters({ bpm: e.target.value })}>
              <option value="">Any BPM</option>
              {BPM_BANDS.map((b) => <option key={b.key} value={b.key}>{b.label} BPM</option>)}
            </select>
            <select className={filters.project !== "any" ? "find__pick find__pick--on" : "find__pick"} value={filters.project}
              aria-label="Project" onChange={(e) => setFilters({ project: e.target.value as TrackFilters["project"] })}>
              <option value="any">Any project</option>
              <option value="linked">Linked to a project</option>
              <option value="backedup">Project backed up</option>
              <option value="missing">Missing samples</option>
              <option value="unlinked">Not linked yet</option>
            </select>
            <select className={filters.score !== "any" ? "find__pick find__pick--on" : "find__pick"} value={filters.score}
              aria-label="Search score" onChange={(e) => setFilters({ score: e.target.value as TrackFilters["score"] })}>
              <option value="any">Any search score</option>
              <option value="low">Hard to find (under {LOW_SCORE})</option>
              <option value="good">Easy to find ({LOW_SCORE} and up)</option>
            </select>
            {years.length > 1 && (
              <select className={filters.year ? "find__pick find__pick--on" : "find__pick"} value={filters.year}
                aria-label="Year posted" onChange={(e) => setFilters({ year: e.target.value })}>
                <option value="">Any year</option>
                {years.map((y) => <option key={y} value={y}>Posted in {y}</option>)}
              </select>
            )}
            {(anyRated || filters.rated > 0) && (
              <select className={filters.rated ? "find__pick find__pick--on" : "find__pick"} value={filters.rated}
                aria-label="Rating" onChange={(e) => setFilters({ rated: Number(e.target.value) })}>
                <option value={0}>Any rating</option>
                <option value={3}>Rated 3 and up</option>
                <option value={4}>Rated 4 and up</option>
                <option value={5}>Rated 5</option>
              </select>
            )}
            {lossyDupes.length > 0 && (
              <button type="button" className={`chip${filters.dupes ? " chip--on" : ""}`}
                aria-pressed={filters.dupes} onClick={() => setFilters({ dupes: !filters.dupes })}
                title="Songs on SoundCloud more than once (e.g. a WAV and an MP3 of one mix)">Posted twice</button>
            )}
            {anyFilter && (
              <span className="find__count">
                Showing <b>{fmtCount(filtered.length)}</b> of {fmtCount((tracks || []).length)} track{(tracks || []).length === 1 ? "" : "s"}
              </span>
            )}
            {anyFilter && (
              <button type="button" className="find__clear" onClick={() => { clearFilters(); setFiltersOpen(false); }}>
                <Icon name="close" size={12} />Clear all
              </button>
            )}
          </div>}
          <SmartBar scope="tracks" filters={filters} blank={NO_FILTERS} canSave={anyFilter}
            suggest={describeFilters} count={(f) => applyFilters(tracks || [], f).length}
            onPick={(f) => { if (f) setFilters(f); else clearFilters(); }} />
          {coverView && showFilters && (
            <FacetChips genres={browse.genres} years={browse.years} genre={filters.genre} year={filters.year}
              onGenre={(g) => setFilters({ genre: g })} onYear={(y) => setFilters({ year: y })} yearTitle="Posted in" />
          )}
          {lossyDupes.length > 0 && (
            <div className="mng-dupehint">
              {doubledSongs === 1 ? "1 song is" : `${fmtCount(doubledSongs)} songs are`} on SoundCloud more than once ·{" "}
              <button type="button" className="linkbtn" onClick={() => setFilters({ dupes: true })}>show them</button>
              {canBulk && <> · <button type="button" className="linkbtn" onClick={selectLossyDupes}>tick the extra {lossyDupes.length === 1 ? "copy" : "copies"}</button></>}
            </div>
          )}
        </div>
      )}

      {showBulkBar && (
        <div className="mng-bulk">
          <span className="mng-bulk__count">
            {selected.size} ticked{filtered.length > selected.size ? ` of ${filtered.length}` : ""}
            {!allFilteredSelected && <> · <button type="button" className="linkbtn" disabled={bulkBusy}
              onClick={selectAllFiltered}>tick all {filtered.length}</button></>}
          </span>
          <Button sm disabled={bulkBusy} onClick={() => void runBulkUpdate({ sharing: "public" })}>Make public</Button>
          <Button sm disabled={bulkBusy} onClick={() => void runBulkUpdate({ sharing: "private" })}>Make private</Button>
          <Button sm disabled={bulkBusy} onClick={() => void pickPlaylist((tracks || []).filter((x) => selected.has(x.id)))}>Add to playlist…</Button>
          <Button sm disabled={bulkBusy} onClick={() => setBulkEdit(true)}>Edit details…</Button>
          <Button sm disabled={bulkBusy} onClick={() => void runBulkArtwork()}>Set cover…</Button>
          <Button sm disabled={bulkBusy} onClick={() => void runBulkWaveform()}>Waveform covers</Button>
          <Button kind="danger" sm disabled={bulkBusy} onClick={() => setConfirmDelete(true)}>Delete</Button>
          <Button kind="quiet" sm disabled={bulkBusy} onClick={clearSelection}>Untick</Button>
        </div>
      )}

      {!canBulk && (
        <div className="locked-note" style={{ marginBottom: 12 }}>
          <span>Free edits one track at a time.</span>
          <b>Bulk actions<ProBadge /></b><span>select many to change privacy, edit, or delete at once.</span>
        </div>
      )}

      {bulkSummary && !showBulkBar && (
        <div className="mng-summary" style={{ marginBottom: 12 }}>{bulkSummary}</div>
      )}

      {/* ---- states ---- */}
      {!loading && (tracks || []).length === 0 && !error && (
        <div className="table"><EmptyState pose="napping" title="No tracks on your SoundCloud yet" say="Quiet in here.">
          Post your first mix from Upload and it shows here.
        </EmptyState></div>
      )}
      {!loading && (tracks || []).length > 0 && filtered.length === 0 && (
        <div className="table"><EmptyState pose="searching" title={search ? `No tracks match “${search}”` : "No tracks match"} say="I looked everywhere."
          action={<Button sm onClick={clearFilters}>Clear search and filters</Button>}>
          Try fewer words or a different filter.
        </EmptyState></div>
      )}

      {/* ---- list ---- */}
      {pageItems.length > 0 && coverView && <div className="sleeves track-sleeves">
        {pageItems.map((t) => (
          <TrackCard key={t.id} track={t} defaultArt={defaultArt}
            selected={selected.has(t.id)} actions={rowActions} />
        ))}
      </div>}
      {columns && (tracks || []).length > 0 && (
        <ColumnBrowse genres={browse.genres} years={browse.years} total={browse.total} inGenre={browse.inGenre}
          genre={filters.genre} year={filters.year} yearTitle="Year posted" noun={`Tracks (${fmtCount(filtered.length)})`}
          onGenre={(g) => setFilters({ genre: g, year: "" })} onYear={(y) => setFilters({ year: y })}>
          {filtered.length === 0 ? <p className="browse__empty">No tracks here. Pick another genre or year.</p>
            : <>
              {filtered.slice(0, columnShown).map((t) => (
                <ColumnItem key={t.id} track={t} defaultArt={defaultArt} actions={rowActions} />
              ))}
              {filtered.length > columnShown && (
                <button type="button" className="browse__item browse__more" onClick={() => setColumnShown((n) => n + COLUMN_PAGE)}>
                  Show {fmtCount(Math.min(COLUMN_PAGE, filtered.length - columnShown))} more
                  <span className="faint"> of {fmtCount(filtered.length - columnShown)} left</span>
                </button>
              )}
            </>}
        </ColumnBrowse>
      )}
      {pageItems.length > 0 && look === "crate" && !columns && !coverView && <div className={`table table--crate rows--${rows}`}>
        <div className="row cols cols-head track-cols">
          <span /><span /><span /><span />
          <SortHead k="title" label="Track" sortKey={sortKey} desc={sortDesc} onSort={sortBy} />
          <SortHead k="rating" label="Rating" mid sortKey={sortKey} desc={sortDesc} onSort={sortBy} />
          <span>Waveform</span>
          <SortHead k="project" label="From project" sortKey={sortKey} desc={sortDesc} onSort={sortBy} />
          <SortHead k="plays" label="Plays" num sortKey={sortKey} desc={sortDesc} onSort={sortBy} />
          <span>Privacy</span><span />
        </div>
        {pageItems.map((t, i) => (
          <TrackRow key={t.id} track={t} index={i} defaultArt={defaultArt}
            selected={selected.has(t.id)} actions={rowActions} />
        ))}
      </div>}

      {/* ---- pagination: item range, page size, and (when needed) page nav ---- */}
      {!loading && filtered.length > 0 && !columns && (
        <div className="mng-pager">
          <span className="mng-pager__label">
            {fmtCount(pageStart + 1)}–{fmtCount(Math.min(pageStart + pageSize, filtered.length))} of {fmtCount(filtered.length)}
          </span>
          <label className="sub" style={{ margin: 0, display: "flex", gap: 6, alignItems: "center" }}>
            Per page
            <select value={pageSize} onChange={(e) => setPageSize(Number(e.target.value))} aria-label="Tracks per page">
              {PAGE_SIZE_OPTIONS.map((n) => <option key={n} value={n}>{n}</option>)}
            </select>
          </label>
          {totalPages > 1 && (
            <span className="mng-pager__nav">
              <Button kind="ghost" sm disabled={safePage === 0} onClick={() => setPage((p) => Math.max(0, p - 1))}>Previous</Button>
              <span className="mng-pager__label">Page {safePage + 1} of {totalPages}</span>
              <Button kind="ghost" sm disabled={safePage >= totalPages - 1} onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}>Next</Button>
            </span>
          )}
        </div>
      )}

      {/* ---- the whole catalogue in figures (moved here from Home) ---- */}
      {!loading && (tracks || []).length > 0 && !anyFilter && (
        <Collection data={collectionOf(tracks || [], (f) => setFilters({ ...NO_FILTERS, ...f }), (id) => onOpenTrack(id))} />
      )}

      {/* ---- edit drawer ---- */}
      {editing && <NoteOpened id={String(editing.id)} name={editing.title} cover={editing.project_match || editing.title}
        genre={editing.project_match ? editing.project_genre : editing.genre} />}
      <Exit>{editing && (
        <EditPanel track={editing} defaultArt={defaultArt} onClose={() => setEditing(null)}
          onSaved={(t) => { applyUpdate(t); setEditing(null); }} />
      )}</Exit>

      {/* ---- bulk metadata editor ---- */}
      <Exit>{bulkEdit && (
        <BulkEditPanel count={selected.size} busy={bulkBusy}
          onClose={() => setBulkEdit(false)} onApply={(patch) => void runBulkUpdate(patch)} />
      )}</Exit>

      {/* ---- typed-confirmation bulk delete ---- */}
      <Exit>{confirmDelete && (
        <DeleteConfirm count={selected.size} busy={bulkBusy}
          onClose={() => setConfirmDelete(false)}
          onConfirm={async () => { const res = await runBulkDelete(); if (res) setConfirmDelete(false); }} />
      )}</Exit>
    </div>
  );
}

// The search box keeps what you type to itself and hands it to the list only after a
// short pause in typing, so a big library isn't filtered and redrawn on every key.
// Escape and the clear button apply at once.
const SEARCH_PAUSE_MS = 220;
function SearchBox({ value, onSearch }: { value: string; onSearch: (q: string) => void }) {
  const [text, setText] = useState(value);
  const sent = useRef(value);
  const timer = useRef<number | null>(null);
  // the search changed from outside (a smart crate, Clear search and filters)
  useEffect(() => { if (value !== sent.current) { sent.current = value; setText(value); } }, [value]);
  useEffect(() => () => { if (timer.current) window.clearTimeout(timer.current); }, []);
  const send = (q: string, now = false) => {
    if (timer.current) window.clearTimeout(timer.current);
    const go = () => { timer.current = null; if (q !== sent.current) { sent.current = q; onSearch(q); } };
    if (now) go(); else timer.current = window.setTimeout(go, SEARCH_PAUSE_MS);
  };
  return (
    <label className="find__search">
      <Icon name="search" size={15} />
      <input type="search" placeholder="Search tracks, projects, genres, tags…" value={text}
        aria-label="Search tracks" spellCheck={false} data-find
        onChange={(e) => { setText(e.target.value); send(e.target.value); }}
        onKeyDown={(e) => { if (e.key === "Escape") { setText(""); send("", true); } }} />
      {text && <button type="button" className="find__x" aria-label="Clear search"
        onClick={() => { setText(""); send("", true); }}><Icon name="close" size={13} /></button>}
    </label>
  );
}

// A Crate table heading that sorts the table: click it, click again to flip it.
function SortHead({ k, label, num, mid, sortKey, desc, onSort }: {
  k: SortKey; label: string; num?: boolean; mid?: boolean; sortKey: SortKey; desc: boolean; onSort: (k: SortKey) => void;
}) {
  const on = sortKey === k;
  return (
    <button type="button" className={`find__sort${num ? " col-num" : ""}${mid ? " col-mid" : ""}${on ? " find__sort--on" : ""}`}
      onClick={() => onSort(k)}
      aria-label={on ? `${label}, sorted ${desc ? "high to low" : "low to high"}. Press to flip` : `${label}. Press to sort by it`}
      title={`Sort by ${label.toLowerCase()}`}>
      {label}{on && <Icon name={desc ? "arrowDown" : "arrowUp"} size={11} />}
    </button>
  );
}

// ---- "From project" cell: the Backups project this track came from, and its state ----
function ProjectCell({ track }: { track: Track }) {
  const t = track;
  const stale = backupStale(t);
  const hasBackup = !!t.backups && (t.backups.count ?? 0) > 0;
  const notes: { text: string; tone?: "warn" | "faint"; title?: string }[] = [];
  if (t.daw) notes.push({ text: dawLabel(t.daw) });
  if (t.bpm != null) notes.push({ text: `${Math.round(t.bpm)} BPM` });
  if (hasBackup) notes.push(stale
    ? { text: `backup older than track`, tone: "faint", title: `Last backup ${fmtDate(t.backups!.last_backup)}, before this track was posted` }
    : { text: `${t.backups!.count} backup${t.backups!.count === 1 ? "" : "s"}${t.backups!.verified ? ", checked" : ""}` });
  if ((t.missing_count ?? 0) > 0) notes.push({ text: `${fmtCount(t.missing_count)} sample${t.missing_count === 1 ? "" : "s"} missing`, tone: "warn" });
  const fmt = t.original_format ? `${t.original_format.toUpperCase()} ` : "";
  if ((t.dupe_count ?? 0) > 1) notes.push({
    text: t.dupe_keeper ? `${fmt}copy to keep` : `${fmt}posted twice`,
    tone: t.dupe_keeper ? undefined : "warn",
    title: t.dupe_keeper
      ? `This song is on SoundCloud ${t.dupe_count} times. This copy has the most plays, so it's the one to keep.`
      : `The same song is on SoundCloud ${t.dupe_count} times. This is an extra copy: removing it keeps the one with the plays.`,
  });
  else if ((t.version_count ?? 0) > 1) notes.push({
    text: `${t.version_count} versions up`, tone: "faint",
    title: `This song is on SoundCloud in ${t.version_count} versions of different lengths. Each is its own track, so nothing is marked to remove.`,
  });
  return (
    <div className="row__main">
      <div className={`row__title${t.project_match ? "" : " faint"}`} style={{ fontWeight: 400 }}>
        {t.project_match || "Not linked"}
      </div>
      {notes.length > 0 && (
        <div className="row__sub row__sub--wrap">
          {notes.map((n, i) => (
            <span key={i} title={n.title} style={n.tone === "warn" ? { color: "var(--warn)" } : undefined}>
              {i > 0 ? " · " : ""}{n.text}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

// ---- SEO breakdown (shown in the edit drawer) ----
function SeoPanel({ seo }: { seo: SeoScore }) {
  return (
    <div className="mng-seo-panel">
      <div className="mng-seo-panel__head">
        <SeoBadge seo={seo} />
        <span className="mng-seo-panel__title">Search score: {seo.score} out of 100</span>
      </div>
      <div className="mng-seo-checks">
        {seo.checks.map((c) => {
          const state = c.points >= c.max ? "is-ok" : c.points === 0 ? "is-bad" : "is-part";
          return (
            <div key={c.id} className="mng-seo-check">
              <span className={`mng-seo-check__mark ${state}`}>
                <Icon name={state === "is-ok" ? "check" : state === "is-bad" ? "close" : "more"} size={12} />
              </span>
              <span className="mng-seo-check__label">{c.label}</span>
              <span className="mng-seo-check__pts">{c.points}/{c.max}</span>
            </div>
          );
        })}
      </div>
      {seo.suggestions.length > 0 && (
        <ul className="mng-seo-sugg">
          {seo.suggestions.map((s, i) => <li key={i}>{s}</li>)}
        </ul>
      )}
    </div>
  );
}

// What a track looks like to the player: its title, where it came from, its art.
function songMeta(t: Track, art: string | null): SongMeta {
  return {
    title: t.title, sub: t.project_match ? `From ${t.project_match}` : t.genre || "", art,
    cover: t.project_match || t.title, genre: t.project_match ? t.project_genre : t.genre, track: String(t.id),
  };
}

// No-art fallback: real cover → the user's default art → a cover drawn from the title.
function artFor(t: Track, defaultArt: string | null): { src: string | null } {
  return { src: t.artwork_url || defaultArt || null };
}

// What a track row's controls do (the same object for every row, see rowActions).
type RowActions = {
  check: (e: React.MouseEvent, t: Track) => void;
  privacy: (t: Track, next: Sharing) => void;
  edit: (t: Track) => void;
  remove: (t: Track) => void;
  menu: (e: React.MouseEvent, t: Track) => void;
};
const COLUMN_PAGE = 200;

// One track in the Genre > Year > Track columns.
const ColumnItem = memo(function ColumnItem({ track: t, defaultArt, actions }: {
  track: Track; defaultArt: string | null; actions: RowActions;
}) {
  useGenreColors();  // a crate colour picked elsewhere redraws the stripe
  const meta = songMeta(t, artFor(t, defaultArt).src);
  return (
    <button type="button" className="browse__item" data-nav-key={String(t.id)}
      onClick={() => actions.edit(t)} onContextMenu={(e) => actions.menu(e, t)}>
      <span className="stripe" style={{ background: genreColor(t.genre) }} />
      <Art meta={meta} size={28} />
      <span className="browse__itemtext">
        <span className="lib-name" title={t.title}>{t.title}</span>
        <span className="lib-sub">{[t.duration ? fmtDuration(t.duration) : "", t.playback_count != null ? `${t.playback_count.toLocaleString()} plays` : "", yearOf(t)].filter(Boolean).join(" · ")}</span>
      </span>
      <Rating id={rateKey(t)} name={t.title} size={11} readOnly />
      <span className={`dot ${isPrivate(t) ? "" : "dot--ok"}`} title={isPrivate(t) ? "Private" : "Public"} />
    </button>
  );
});

// Memoised: typing in the search box or ticking another row doesn't draw this one again.
const TrackRow = memo(function TrackRow({ track, index, defaultArt, selected, actions }: {
  track: Track; index: number; defaultArt: string | null; selected: boolean; actions: RowActions;
}) {
  useGenreColors();  // a crate colour picked elsewhere redraws the stripe
  const t = track;
  const onCheck = (e: React.MouseEvent) => actions.check(e, t);
  const onQuickPrivacy = (next: Sharing) => actions.privacy(t, next);
  const onEdit = () => actions.edit(t);
  const onDelete = () => actions.remove(t);
  const onContextMenu = (e: React.MouseEvent) => actions.menu(e, t);
  const priv = isPrivate(t);
  const next: Sharing = priv ? "public" : "private";
  const art = artFor(t, defaultArt);
  const meta = songMeta(t, art.src);
  const preview = useAudition(t.local_path, meta);
  return (
    <label {...preview} data-nav-key={String(t.id)} className={`row cols track-cols scanrow--enter${selected ? " row--selected" : ""}`}
      onContextMenu={onContextMenu}
      style={{ ["--i" as string]: index } as React.CSSProperties}>
      <span className="stripe" style={{ background: genreColor(t.genre) }} />
      <input type="checkbox" className="mixrow__check" checked={selected}
        onChange={() => { /* click handler owns toggling for shift-range support */ }}
        onClick={onCheck} aria-label={`Tick ${t.title}`} />
      {t.local_path ? <PlayButton path={t.local_path} meta={meta} size={28} /> : <span />}
      <Art meta={meta} size={36} />
      <div className="row__main">
        <div className="row__title" title={t.title}>{t.title}</div>
        {t.replaced_by ? (
          <div className="row__sub">
            <span style={{ color: "var(--warn)" }}
              title="A newer version of this song was posted in its place, with the same title, cover and playlists. This old upload keeps its plays and comments until you remove it.">
              Replaced by a new version</span>
            {t.duration ? ` · ${fmtDuration(t.duration)} · ` : " · "}
            <button type="button" className="linkbtn" style={{ color: "var(--text)", textDecoration: "underline" }}
              onClick={(e) => { e.preventDefault(); e.stopPropagation(); onDelete(); }}>Remove</button>
          </div>
        ) : (
          <SubLine parts={[t.genre, t.duration ? fmtDuration(t.duration) : "", t.created_at ? `posted ${fmtDate(t.created_at)}` : ""]} />
        )}
      </div>
      <Rating id={rateKey(t)} name={t.title} />
      <SongWave path={t.local_path} scUrl={t.local_path ? null : t.waveform_url} meta={meta} height={24} />
      <ProjectCell track={t} />
      <span className="col-num">{t.playback_count != null ? t.playback_count.toLocaleString() : "—"}</span>
      <button type="button" className={`pill ${priv ? "pill--private" : "pill--quiet"} linkbtn`}
        style={{ color: "var(--text-dim)" }}
        title={`Click to make ${next}`} aria-label={`${priv ? "Private" : "Public"}. Make ${next}`}
        onClick={(e) => { e.preventDefault(); onQuickPrivacy(next); }}>
        {priv ? "Private" : "Public"}
      </button>
      <span className="col-act">
        {t.permalink_url && (
          <button type="button" className="iconbtn" title="Open on SoundCloud" aria-label="Open on SoundCloud"
            onClick={(e) => { e.preventDefault(); openExternal(t.permalink_url!); }}><Icon name="external" /></button>
        )}
        <button type="button" className="iconbtn" title="Edit" aria-label="Edit track"
          onClick={(e) => { e.preventDefault(); onEdit(); }}><Icon name="edit" /></button>
        <button type="button" className="iconbtn iconbtn--danger" title="Delete" aria-label="Delete track"
          onClick={(e) => { e.preventDefault(); onDelete(); }}><Icon name="trash" /></button>
      </span>
    </label>
  );
});

// Sleeve look: one cover card per track. Clicking the card opens its details.
const TrackCard = memo(function TrackCard({ track, defaultArt, selected, actions }: {
  track: Track; defaultArt: string | null; selected: boolean; actions: RowActions;
}) {
  useGenreColors();
  const t = track;
  const onCheck = (e: React.MouseEvent) => actions.check(e, t);
  const onEdit = () => actions.edit(t);
  const onContextMenu = (e: React.MouseEvent) => actions.menu(e, t);
  const art = artFor(t, defaultArt);
  const meta = songMeta(t, art.src);
  const preview = useAudition(t.local_path, meta);
  return (
    <div {...preview} data-nav-key={String(t.id)} className={`sleeve track-sleeve${selected ? " sleeve--selected" : ""}`} role="button" tabIndex={0}
      onClick={onEdit} onKeyDown={rowKey(onEdit)} onContextMenu={onContextMenu}>
      <div className="sleeve__art">
        <Art meta={meta} />
        {isPrivate(t) && <span className="sleeve__badge"><span className="dot dot--warn" />Private</span>}
        <input type="checkbox" className="mixrow__check track-sleeve__check" checked={selected}
          onChange={() => { /* click handler owns toggling */ }}
          onClick={(e) => { e.stopPropagation(); onCheck(e); }} aria-label={`Tick ${t.title}`} />
        {t.local_path && <PlayButton path={t.local_path} meta={meta} size={34} className="sleeve__play" />}
      </div>
      <div className="sleeve__meta">
        <div className="track-sleeve__top">
          <div className="sleeve__name" title={t.title}>{t.title}</div>
          {t.permalink_url && (
            <button type="button" className="iconbtn" title="Open on SoundCloud" aria-label="Open on SoundCloud"
              onClick={(e) => { e.stopPropagation(); openExternal(t.permalink_url!); }}><Icon name="external" size={14} /></button>
          )}
        </div>
        <div className="track-sleeve__sub">
          <span className="col-wrap2" title={t.project_match ?? undefined}>{t.project_match ? `From ${t.project_match}` : t.genre || "No genre"}</span>
          <span className="mono">{t.playback_count != null ? `${t.playback_count.toLocaleString()} play${t.playback_count === 1 ? "" : "s"}` : ""}</span>
        </div>
        <SongWave path={t.local_path} scUrl={t.local_path ? null : t.waveform_url} meta={meta} height={18} />
        <Rating id={rateKey(t)} name={t.title} size={12} />
      </div>
    </div>
  );
});

// Shared overlay shell: side-drawer on wide windows, centered modal on narrow ones.
// `forceModal` always centers (used by the delete confirmation).
export function Overlay({ children, onClose, forceModal, label }: {
  children: React.ReactNode; onClose: () => void; forceModal?: boolean; label: string;
}) {
  // Tab stays inside the panel while it's open; focus goes back to the row after.
  const box = useRef<HTMLDivElement | null>(null);
  useDialogFocus(box);
  const [narrow, setNarrow] = useState(() => matchMedia("(max-width: 880px)").matches);
  useEffect(() => {
    const mq = matchMedia("(max-width: 880px)");
    const on = () => setNarrow(mq.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  const centered = forceModal || narrow;
  return (
    <div className={`mng-scrim${centered ? " mng-scrim--center" : ""}`}
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div ref={box} className={`glass elev-1 ${centered ? "mng-modal" : "mng-drawer"}`} role="dialog" aria-modal="true"
        aria-label={label} tabIndex={-1}>
        {children}
      </div>
    </div>
  );
}

// A track's page: the panel that edits it. Also opens over a playlist.
export function EditPanel({ track, defaultArt, onClose, onSaved }: {
  track: Track; defaultArt: string | null; onClose: () => void; onSaved: (t: Track) => void;
}) {
  const [title, setTitle] = useState(track.title);
  const [description, setDescription] = useState(track.description);
  const [genre, setGenre] = useState(track.genre);
  const [sharing, setSharing] = useState<Sharing>(isPrivate(track) ? "private" : "public");
  const [tags, setTags] = useState<string[]>(track.tags);
  const [tagDraft, setTagDraft] = useState("");
  const [downloadable, setDownloadable] = useState(!!track.downloadable);
  const [busy, setBusy] = useState(false);
  const [artBusy, setArtBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const titleRef = useRef<HTMLInputElement | null>(null);
  useEffect(() => { titleRef.current?.focus(); }, []);

  // Tags typed but not yet turned into a chip still count.
  const allTags = () => [...tags, ...tagDraft.split(",").map((t) => t.trim()).filter(Boolean)];
  const dirty = title !== track.title || description !== track.description || genre !== track.genre
    || sharing !== (isPrivate(track) ? "private" : "public") || downloadable !== !!track.downloadable
    || allTags().join("\n") !== track.tags.join("\n");

  async function save() {
    if (busy) return;
    setBusy(true); setErr(null);
    try {
      const updated = await api.updateTrack(track.id, {
        title, description, genre, sharing, downloadable, tags: allTags(),
      });
      onSaved(updated);
    } catch (e) { setErr(String((e as Error).message)); }
    finally { setBusy(false); }
  }
  // Closing with unsaved changes asks first, so a stray click outside never loses them.
  const asking = useRef(false);
  async function close() {
    if (asking.current) return;
    if (dirty && !busy) {
      asking.current = true;
      const ok = await askConfirm({ title: "Discard your changes?", body: "Your changes to this track won’t be saved.",
        confirm: "Discard", cancel: "Keep editing" });
      setTimeout(() => { asking.current = false; }, 0);
      if (!ok) return;
    }
    onClose();
  }
  // Cmd/Ctrl+S saves.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") { e.preventDefault(); void save(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  async function changeCover() {
    const path = await pickImage();
    if (!path) return;
    setArtBusy(true); setErr(null);
    try {
      const updated = await api.setArtwork(track.id, path);
      onSaved(updated);
    } catch (e) { setErr(String((e as Error).message)); }
    finally { setArtBusy(false); }
  }

  async function genWaveCover() {
    setArtBusy(true); setErr(null);
    try {
      onSaved(await api.generateWaveformCover(track.id));
    } catch (e) { setErr(String((e as Error).message)); }
    finally { setArtBusy(false); }
  }

  function addTag(tag: string) {
    const t = tag.trim().replace(/,$/, "").trim();
    if (!t) return;
    setTags((prev) => prev.some((x) => x.toLowerCase() === t.toLowerCase()) ? prev : [...prev, t]);
  }
  function onTagKey(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter" || e.key === ",") { e.preventDefault(); addTag(tagDraft); setTagDraft(""); }
    else if (e.key === "Backspace" && !tagDraft && tags.length) setTags((prev) => prev.slice(0, -1));
  }
  const haveTags = new Set(tags.map((t) => t.toLowerCase()));
  const tagSuggestions = (track.seo?.suggested_tags || []).filter((t) => !haveTags.has(t.toLowerCase()));
  const matched = isMatched(track);
  const meta = songMeta(track, artFor(track, defaultArt).src);
  return (
    <Overlay onClose={() => void close()} label={`Edit ${track.title}`}>
      <div className="mng-panel__head mng-edit__head">
        <Art meta={meta} size={48} />
        <div className="mng-edit__who">
          <h2 className="col-trunc" title={track.title}>{track.title}</h2>
          <span className="faint">{[track.project_match ? `From ${track.project_match}` : "", track.duration ? fmtDuration(track.duration) : "",
            track.created_at ? `posted ${fmtDate(track.created_at)}` : ""].filter(Boolean).join(" · ")}</span>
        </div>
        {track.local_path && <PlayButton path={track.local_path} meta={meta} size={32} />}
        <button type="button" className="mng-panel__close" onClick={() => void close()} aria-label="Close"><Icon name="close" /></button>
      </div>
      <div className="mng-panel__body">
        <TrackHero track={track} meta={meta} />
        {track.permalink_url && (
          <div className="field"><span>SoundCloud link</span>
            <div className="pathline">
              <span className="mono col-trunc" title={track.permalink_url}>{track.permalink_url.replace(/^https?:\/\//, "")}</span>
              <CopyButton text={track.permalink_url} what="SoundCloud link" />
              <button type="button" className="iconbtn" title="Open on SoundCloud" aria-label="Open on SoundCloud"
                onClick={() => openExternal(track.permalink_url!)}><Icon name="external" size={14} /></button>
            </div>
          </div>
        )}
        <label className="field"><span>Title</span>
          <input ref={titleRef} type="text" value={title} onChange={(e) => setTitle(e.target.value)} /></label>
        <label className="field"><span>Description</span>
          <textarea value={description} onChange={(e) => setDescription(e.target.value)} /></label>
        <div className="mng-edit__pair">
          <label className="field"><span>Genre</span>
            <input type="text" value={genre} onChange={(e) => setGenre(e.target.value)} list="lc-genres" placeholder="Pick or type a genre" />
            <datalist id="lc-genres">{GENRES.map((g) => <option key={g} value={g} />)}</datalist></label>
          <label className="field"><span>Privacy</span>
            <select value={sharing} onChange={(e) => setSharing(e.target.value as Sharing)}>
              <option value="public">Public</option>
              <option value="private">Private</option>
            </select></label>
        </div>
        <div className="field"><span>Tags</span>
          <div className="tagbox" onClick={(e) => (e.currentTarget.querySelector("input") as HTMLInputElement | null)?.focus()}>
            {tags.map((t) => (
              <span key={t} className="tagbox__tag">{t}
                <button type="button" aria-label={`Remove ${t}`} onClick={() => setTags((prev) => prev.filter((x) => x !== t))}><Icon name="close" size={11} /></button>
              </span>
            ))}
            <input type="text" value={tagDraft} onChange={(e) => setTagDraft(e.target.value)} onKeyDown={onTagKey}
              onBlur={() => { addTag(tagDraft); setTagDraft(""); }}
              placeholder={tags.length ? "Add a tag" : "Type a tag and press Enter"} aria-label="Add a tag" />
          </div>
        </div>
        {tagSuggestions.length > 0 && (
          <div className="mng-tagsugg">
            <span className="mng-tagsugg__label">Suggested for {genre || "this genre"}:</span>
            {tagSuggestions.map((t) => (
              <button type="button" key={t} className="mng-tagchip" onClick={() => addTag(t)}
                title={`Add “${t}” to tags`}><Icon name="plus" size={11} />{t}</button>
            ))}
          </div>
        )}
        <label className="toolchk" style={{ fontSize: 13 }}>
          <input type="checkbox" checked={downloadable} onChange={(e) => setDownloadable(e.target.checked)} />
          Let listeners download the original file
        </label>
        {err && <div className="mng-err"><Icon name="alert" />{err}</div>}

        <div className="mng-cover">
          <div className="field"><span>Cover art</span></div>
          <div className="art-row">
            <Art meta={meta} size={56} className="art-thumb" />
            <Button sm onClick={() => void changeCover()} disabled={artBusy || busy}>
              {artBusy ? "Working…" : "Change cover…"}
            </Button>
            <Button kind="ghost" sm onClick={() => void genWaveCover()} disabled={artBusy || busy}
              title="Make a cover from this track’s waveform and your name">
              Make one from the waveform
            </Button>
          </div>
        </div>

        <TrackPlaylists track={track} />

        {track.seo && <SeoPanel seo={track.seo} />}

        {matched && (
          <div className="mng-matched">
            <div className="field"><span>From project</span></div>
            <ProjectCell track={track} />
          </div>
        )}
      </div>
      <div className="mng-panel__foot">
        <span className="mng-edit__hint faint">{dirty ? "Unsaved changes" : ""}</span>
        <Button sm onClick={() => void close()} disabled={busy}>Cancel</Button>
        <Button kind="primary" sm onClick={() => void save()} disabled={busy || !dirty}
          title={`Save (${navigator.platform.includes("Mac") ? "⌘" : "Ctrl+"}S)`}>{busy ? "Saving…" : "Save"}</Button>
      </div>
    </Overlay>
  );
}

// The top of a track's page: its waveform with listeners' comments pinned where they
// left them, and the numbers that matter. Sleeve prints it big, cover first.
function TrackHero({ track, meta }: { track: Track; meta: SongMeta }) {
  const [comments, setComments] = useState<TrackComment[] | null>(null);
  useEffect(() => {
    let alive = true;
    setComments(null);
    api.trackComments(track.id).then((r) => { if (alive) setComments(r.comments); }).catch(() => { if (alive) setComments([]); });
    return () => { alive = false; };
  }, [track.id]);
  const fileLength = useSongLength(track.local_path);
  const length = track.duration || fileLength;
  const pinned = (comments ?? []).filter((c) => c.t != null && length > 0 && c.t <= length);
  const marks: WaveMark[] = pinned.map((c) => ({ at: c.t! / length, label: c.body, who: c.user, time: c.t!, kind: "comment" }));
  const n = comments?.length ?? 0;
  const latest = [...pinned].sort((a, b) => (b.created_at ?? "").localeCompare(a.created_at ?? "")).slice(0, 3);
  const wave = <SongWave path={track.local_path} scUrl={track.local_path ? null : track.waveform_url} meta={meta} height={44} marks={marks} />;
  const figures: [string, string][] = [
    ["Plays", track.playback_count != null ? fmtCount(track.playback_count) : "–"],
    ["Length", length ? fmtDuration(length) : "–"],
    [n === 1 ? "Comment" : "Comments", comments ? fmtCount(n) : "…"],
  ];
  const said = latest.length > 0 && (
    <ol className="trackhero__said" aria-label="Latest comments">
      {latest.map((c, i) => (
        <li key={i}><span className="mono">{fmtDuration(c.t!) || "0:00"}</span><b>{c.user}</b><span className="col-trunc" title={c.body}>{c.body}</span></li>
      ))}
    </ol>
  );
  return (
    <section className="trackhero trackhero--crate">
      <div className="deckread">
        {figures.map(([k, v]) => <span key={k} className="deckread__cell"><small>{k}</small><b>{v}</b></span>)}
      </div>
      <div className="trackhero__wave">{wave}</div>
      {said}
    </section>
  );
}

function BulkEditPanel({ count, busy, onClose, onApply }: {
  count: number; busy: boolean; onClose: () => void;
  onApply: (patch: TrackUpdate) => void;
}) {
  const [genre, setGenre] = useState("");
  const [tags, setTags] = useState("");
  const [sharing, setSharing] = useState<"" | Sharing>("");

  function apply() {
    const patch: TrackUpdate = {};
    if (genre.trim()) patch.genre = genre.trim();
    if (tags.trim()) patch.tags = parseTags(tags);
    if (sharing) patch.sharing = sharing;
    onApply(patch);
  }
  const empty = !genre.trim() && !tags.trim() && !sharing;
  // Closing with something filled in asks first (Escape, a click outside, Cancel).
  const asking = useRef(false);
  async function close() {
    if (asking.current) return;
    if (!empty && !busy) {
      asking.current = true;
      const ok = await askConfirm({ title: "Discard your changes?", body: "Nothing has been changed on your tracks yet.",
        confirm: "Discard", cancel: "Keep editing" });
      setTimeout(() => { asking.current = false; }, 0);
      if (!ok) return;
    }
    onClose();
  }

  return (
    <Overlay onClose={() => void close()} label={`Edit ${count} tracks`}>
      <div className="mng-panel__head">
        <h2>Edit {count} tracks</h2>
        <button type="button" className="mng-panel__close" onClick={() => void close()} aria-label="Close"><Icon name="close" /></button>
      </div>
      <div className="mng-panel__body">
        <p className="sub" style={{ marginTop: 0 }}>Only the fields you fill in are applied to all selected tracks.</p>
        <label className="field"><span>Genre</span>
          <input type="text" value={genre} onChange={(e) => setGenre(e.target.value)} list="lc-genres-bulk"
            placeholder="e.g. House. Leave blank to keep each track’s" />
          <datalist id="lc-genres-bulk">{GENRES.map((g) => <option key={g} value={g} />)}</datalist></label>
        <label className="field"><span>Tags (comma-separated)</span>
          <input type="text" value={tags} onChange={(e) => setTags(e.target.value)}
            placeholder="e.g. lo-fi, chill. Leave blank to keep each track’s" /></label>
        <label className="field" style={{ marginBottom: 0 }}><span>Privacy</span>
          <select value={sharing} onChange={(e) => setSharing(e.target.value as "" | Sharing)}>
            <option value="">Keep current</option>
            <option value="public">Public</option>
            <option value="private">Private</option>
          </select></label>
      </div>
      <div className="mng-panel__foot">
        <Button sm onClick={() => void close()} disabled={busy}>Cancel</Button>
        <Button kind="primary" sm onClick={apply} disabled={busy || empty}>{busy ? "Applying…" : `Apply to ${count}`}</Button>
      </div>
    </Overlay>
  );
}

function DeleteConfirm({ count, busy, onClose, onConfirm }: {
  count: number; busy: boolean; onClose: () => void; onConfirm: () => void;
}) {
  const [text, setText] = useState("");
  const ok = text.trim() === String(count) || text.trim().toUpperCase() === "DELETE";
  return (
    <Overlay onClose={onClose} forceModal label={count === 1 ? "Delete this track" : `Delete ${count} tracks`}>
      <div className="mng-panel__head">
        <h2>Delete {count === 1 ? "this track" : `${count} tracks`}</h2>
        <button type="button" className="mng-panel__close" onClick={onClose} aria-label="Close"><Icon name="close" /></button>
      </div>
      <div className="mng-panel__body">
        <p style={{ marginTop: 0 }}>
          This permanently removes <b>{count}</b> track{count === 1 ? "" : "s"} from SoundCloud.
          This cannot be undone.
        </p>
        <label className="field" style={{ marginBottom: 0 }}>
          <span>Type <b>{count}</b> or the word <b>DELETE</b> to confirm</span>
          <input type="text" value={text} onChange={(e) => setText(e.target.value)} autoFocus
            placeholder={String(count)} aria-label="Type to confirm deletion" />
        </label>
      </div>
      <div className="mng-panel__foot">
        <Button sm onClick={onClose} disabled={busy}>Cancel</Button>
        <Button kind="danger" sm onClick={onConfirm} disabled={!ok || busy}>
          {busy ? "Deleting…" : `Delete ${count}`}
        </Button>
      </div>
    </Overlay>
  );
}
