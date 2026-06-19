import { useEffect, useMemo, useRef, useState } from "react";
import { makeApi, openExternal, pickImage, readImage } from "../api";
import type { BulkResult, Config, Entitlement, SeoScore, Sharing, Track, TrackUpdate } from "../types";
import { Button, ProBadge, Segmented, fmtDuration } from "../components/ui";
import { StatusPill } from "../components/StatusPill";
import { useSpecular } from "../components/Glass";
import "../manage.css";

const api = makeApi();
const PAGE_SIZE_OPTIONS = [25, 50, 100, 200];
const BULK_CONFIRM_THRESHOLD = 25;   // confirm before a long sequential bulk write

type PrivacyFilter = "all" | "public" | "private";
type SortKey = "date" | "title" | "plays" | "duration" | "bpm" | "seo";

const SEO_GRADE_CLASS: Record<string, string> = {
  A: "seo--a", B: "seo--b", C: "seo--c", D: "seo--d", F: "seo--f",
};

function SeoBadge({ seo }: { seo?: SeoScore | null }) {
  if (!seo) return null;
  const title = `SEO ${seo.score}/100 (${seo.grade})`
    + (seo.suggestions.length ? ` — ${seo.suggestions[0]}` : "");
  return (
    <span className={`mng-seo ${SEO_GRADE_CLASS[seo.grade] || "seo--f"}`} title={title} aria-label={title}>
      {seo.grade}<span className="mng-seo__n">{seo.score}</span>
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

// Human DAW label for the chip.
const DAW_LABEL: Record<string, string> = {
  ableton: "Ableton", flstudio: "FL", logic: "Logic", "logic pro": "Logic",
  cubase: "Cubase", studioone: "Studio One", bitwig: "Bitwig", reaper: "Reaper",
  protools: "Pro Tools", reason: "Reason", garageband: "GarageBand",
};
function dawLabel(daw: string): string {
  return DAW_LABEL[daw.toLowerCase()] || daw;
}

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

function isPrivate(t: Track): boolean { return t.sharing === "private"; }
function isMatched(t: Track): boolean { return !!t.project_match; }

// A re-enriched track returned by an edit/bulk op lacks the dupe_* fields (those are set
// only in the backend's list pass), so carry them over from the row being replaced —
// otherwise editing a track silently drops its FLAC/MP3 duplicate chips.
export function mergeEnriched(prev: Track, next: Track): Track {
  return { ...next, dupe_group: prev.dupe_group, dupe_count: prev.dupe_count, dupe_keeper: prev.dupe_keeper };
}

// Surface auth/reconnect failures with a clearer call to action.
function friendlyError(msg: string): string {
  const m = msg.toLowerCase();
  if (m.includes("reconnect") || m.includes("expired") || m.includes("401")
      || m.includes("connect a soundcloud")) {
    return "Your SoundCloud session needs reconnecting — open Settings to reconnect.";
  }
  return msg;
}

export function Manage({ ent, cfg }: { ent: Entitlement; cfg: Config }) {
  const canBulk = ent.features.batch;
  const rootRef = useRef<HTMLDivElement | null>(null);
  useSpecular(rootRef);

  const [tracks, setTracks] = useState<Track[] | null>(null);
  const [avatar, setAvatar] = useState<string | null>(null);
  const [defaultArt, setDefaultArt] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // toolbar / filter state
  const [rawSearch, setRawSearch] = useState("");
  const [search, setSearch] = useState("");
  const [privacy, setPrivacy] = useState<PrivacyFilter>("all");
  const [sortKey, setSortKey] = useState<SortKey>("date");
  const [sortDesc, setSortDesc] = useState(true);
  const [matchedOnly, setMatchedOnly] = useState(false);
  const [hasBackup, setHasBackup] = useState(false);
  const [missingOnly, setMissingOnly] = useState(false);
  const [needsSeo, setNeedsSeo] = useState(false);
  const [dupesOnly, setDupesOnly] = useState(false);
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(50);

  // selection + dialogs
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const lastClickedRef = useRef<number | null>(null);
  const [editing, setEditing] = useState<Track | null>(null);
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
  // The connected account's profile picture stands in for tracks with no cover art.
  useEffect(() => { api.account().then((a) => setAvatar(a.avatar)).catch(() => {}); }, []);
  // The user's configured default cover art is the preferred no-art stand-in.
  useEffect(() => {
    let alive = true;
    const p = cfg.default_artwork_path;
    if (!p) { setDefaultArt(null); return; }
    readImage(p).then((url) => { if (alive) setDefaultArt(url); }).catch(() => { if (alive) setDefaultArt(null); });
    return () => { alive = false; };
  }, [cfg.default_artwork_path]);

  // debounce search (~200ms)
  useEffect(() => {
    const id = window.setTimeout(() => setSearch(rawSearch.trim().toLowerCase()), 200);
    return () => window.clearTimeout(id);
  }, [rawSearch]);

  // reset to first page whenever the filtered set changes
  useEffect(() => { setPage(0); }, [search, privacy, sortKey, sortDesc, matchedOnly, hasBackup, missingOnly, needsSeo, dupesOnly, pageSize]);

  // ---- filter + sort (client-side) ----
  const filtered = useMemo(() => {
    let list = tracks || [];
    if (privacy !== "all") list = list.filter((t) => (privacy === "private" ? isPrivate(t) : !isPrivate(t)));
    if (matchedOnly) list = list.filter(isMatched);
    if (hasBackup) list = list.filter((t) => (t.backups?.count ?? 0) > 0);
    if (missingOnly) list = list.filter((t) => (t.missing_count ?? 0) > 0);
    if (needsSeo) list = list.filter((t) => (t.seo?.score ?? 100) < 70);
    if (dupesOnly) list = list.filter((t) => (t.dupe_count ?? 0) > 1);
    if (search) {
      list = list.filter((t) => {
        const hay = [t.title, t.genre, ...(t.tags || [])].join(" ").toLowerCase();
        return hay.includes(search);
      });
    }
    const dir = sortDesc ? -1 : 1;
    const sorted = [...list].sort((a, b) => {
      let av: number | string, bv: number | string;
      switch (sortKey) {
        case "title": av = a.title.toLowerCase(); bv = b.title.toLowerCase(); break;
        case "plays": av = a.playback_count ?? 0; bv = b.playback_count ?? 0; break;
        case "duration": av = a.duration ?? 0; bv = b.duration ?? 0; break;
        case "bpm": av = a.bpm ?? 0; bv = b.bpm ?? 0; break;
        case "seo": av = a.seo?.score ?? -1; bv = b.seo?.score ?? -1; break;
        default: av = a.created_at ? Date.parse(a.created_at) : 0; bv = b.created_at ? Date.parse(b.created_at) : 0;
      }
      if (av < bv) return -1 * dir;
      if (av > bv) return 1 * dir;
      return 0;
    });
    return sorted;
  }, [tracks, privacy, matchedOnly, hasBackup, missingOnly, needsSeo, dupesOnly, search, sortKey, sortDesc]);

  // Lower-quality duplicate copies (e.g. the MP3 when a FLAC of the same title exists).
  const lossyDupes = useMemo(
    () => (tracks || []).filter((t) => (t.dupe_count ?? 0) > 1 && !t.dupe_keeper),
    [tracks]);
  function selectLossyDupes() {
    setSelected(new Set(lossyDupes.map((t) => t.id)));
    setBulkSummary(null);
  }
  // When the last duplicate is cleaned up, drop the (now-hidden) Duplicates filter so the
  // list doesn't dead-end as an empty filtered view with no visible way to clear it.
  useEffect(() => { if (dupesOnly && lossyDupes.length === 0) setDupesOnly(false); }, [lossyDupes.length, dupesOnly]);

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
    if (!window.confirm(`Delete “${t.title}” from SoundCloud? This can't be undone.`)) return;
    try {
      await api.deleteTrack(t.id);
      setTracks((prev) => (prev || []).filter((x) => x.id !== t.id));
      setSelected((prev) => { const n = new Set(prev); n.delete(t.id); return n; });
    } catch (e) { setError(String((e as Error).message)); }
  }

  // ---- bulk mutations ----
  const selectedIds = useMemo(() => Array.from(selected), [selected]);
  // SoundCloud has no batch API, so a bulk op is N sequential writes (~0.25s each) with no
  // mid-run cancel. Warn + estimate before a large run so it isn't a surprise freeze.
  function confirmLargeBulk(verb: string): boolean {
    const n = selectedIds.length;
    if (n < BULK_CONFIRM_THRESHOLD) return true;
    const secs = Math.ceil(n * 0.25);
    const mins = secs >= 90 ? ` (~${Math.ceil(secs / 60)} min)` : ` (~${secs}s)`;
    return window.confirm(
      `${verb} ${n} tracks?\n\nThis runs as ${n} separate SoundCloud updates${mins} and can't be cancelled once it starts.`);
  }
  function summarize(res: BulkResult, noun: string, pastTense: string, failNote = ""): void {
    const ok = res.results.filter((r) => r.ok).length;
    const fails = res.results.length - ok;
    setBulkSummary(`${ok} ${noun}${ok === 1 ? "" : "s"} ${pastTense}${fails ? ` · ${fails} failed${failNote}` : ""}`);
  }
  async function runBulkUpdate(patch: TrackUpdate) {
    if (selectedIds.length === 0) return;
    if (!confirmLargeBulk(patch.sharing ? `Make ${patch.sharing}` : "Update")) return;
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
    if (!confirmLargeBulk("Set cover art on")) return;
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
    if (!confirmLargeBulk("Generate waveform covers for")) return;
    setBulkBusy(true); setBulkSummary(null); setError(null);
    try {
      const res = await api.bulkWaveformCover(selectedIds);
      spliceBulkTracks(res.results);   // splice the new covers in — no full refetch needed
      summarize(res, "waveform cover", "set", " (no waveform yet?)");
    } catch (e) { setError(String((e as Error).message)); }
    finally { setBulkBusy(false); }
  }

  function clearFilters() {
    setRawSearch(""); setSearch(""); setPrivacy("all");
    setMatchedOnly(false); setHasBackup(false); setMissingOnly(false); setNeedsSeo(false);
    setDupesOnly(false);
  }

  const friendly = error ? friendlyError(error) : null;
  const loading = tracks === null;
  const showBulkBar = canBulk && selected.size > 0;

  return (
    <div ref={rootRef}>
      <div className="row-spread" style={{ marginBottom: 4 }}>
        <h1>Manage</h1>
        <Button kind="ghost" sm onClick={load}>Refresh</Button>
      </div>
      <div className="sub">Your existing SoundCloud tracks — edit details, change privacy, or delete.</div>

      {friendly && <div className="banner banner--warn">⚠ {friendly}</div>}

      {/* ---- sticky toolbar (or bulk bar when ≥1 selected) ---- */}
      {showBulkBar ? (
        <div className="mng-bulk glass elev-1">
          <span className="mng-bulk__count">
            <b>{selected.size}</b> selected{filtered.length > selected.size ? ` of ${filtered.length}` : ""}
          </span>
          {!allFilteredSelected && (
            <Button kind="ghost" sm disabled={bulkBusy} onClick={selectAllFiltered}>Select all {filtered.length}</Button>
          )}
          <Button sm disabled={bulkBusy} onClick={() => void runBulkUpdate({ sharing: "public" })}>Make public</Button>
          <Button sm disabled={bulkBusy} onClick={() => void runBulkUpdate({ sharing: "private" })}>Make private</Button>
          <Button sm disabled={bulkBusy} onClick={() => setBulkEdit(true)}>Edit metadata…</Button>
          <Button sm disabled={bulkBusy} onClick={() => void runBulkArtwork()}>Set cover art…</Button>
          <Button sm disabled={bulkBusy} onClick={() => void runBulkWaveform()}>Waveform covers</Button>
          <Button kind="danger" sm disabled={bulkBusy} onClick={() => setConfirmDelete(true)}>Delete</Button>
          <Button kind="ghost" sm disabled={bulkBusy} onClick={clearSelection}>Clear</Button>
        </div>
      ) : (
        <div className="mng-toolbar glass elev-1">
          <p className="mng-toolbar__count">
            {loading ? "Loading your library…" : (
              <>
                {filtered.length === (tracks || []).length
                  ? `${(tracks || []).length} tracks`
                  : `${filtered.length} of ${(tracks || []).length} tracks`}
                {matchedCount ? ` · ${matchedCount} matched to projects` : ""}
                {canBulk && filtered.length > 0 && (
                  <> · <button type="button" className="linkbtn" onClick={selectAllFiltered}>Select all {filtered.length}</button></>
                )}
              </>
            )}
          </p>
          <div className="mng-toolbar__row">
            <input type="text" className="mng-search" placeholder="Search title, genre, tags…"
              value={rawSearch} onChange={(e) => setRawSearch(e.target.value)} aria-label="Search tracks" />
            <Segmented<PrivacyFilter> value={privacy} onChange={setPrivacy}
              options={[{ value: "all", label: "All" }, { value: "public", label: "Public" }, { value: "private", label: "Private" }]} />
            <label className="sub" style={{ margin: 0, display: "flex", gap: 8, alignItems: "center" }}>
              Sort
              <select value={sortKey} onChange={(e) => setSortKey(e.target.value as SortKey)} aria-label="Sort by">
                <option value="date">Date</option>
                <option value="title">Title</option>
                <option value="plays">Plays</option>
                <option value="duration">Duration</option>
                <option value="bpm">BPM</option>
                <option value="seo">SEO</option>
              </select>
            </label>
            <button type="button" className="mng-sortdir" onClick={() => setSortDesc((d) => !d)}
              aria-label={sortDesc ? "Sort descending" : "Sort ascending"} title={sortDesc ? "Descending" : "Ascending"}>
              {sortDesc ? "↓" : "↑"}
            </button>
          </div>
          <div className="mng-toolbar__row">
            <button type="button" className={`pill pill--toggle${matchedOnly ? " pill--on" : ""}`}
              aria-pressed={matchedOnly} onClick={() => setMatchedOnly((v) => !v)}>Matched only</button>
            <button type="button" className={`pill pill--toggle${hasBackup ? " pill--on" : ""}`}
              aria-pressed={hasBackup} onClick={() => setHasBackup((v) => !v)}>Has backup</button>
            <button type="button" className={`pill pill--toggle${missingOnly ? " pill--on" : ""}`}
              aria-pressed={missingOnly} onClick={() => setMissingOnly((v) => !v)}>Missing samples</button>
            <button type="button" className={`pill pill--toggle${needsSeo ? " pill--on" : ""}`}
              aria-pressed={needsSeo} onClick={() => setNeedsSeo((v) => !v)} title="SEO score below 70">Needs SEO</button>
            {lossyDupes.length > 0 && (
              <button type="button" className={`pill pill--toggle${dupesOnly ? " pill--on" : ""}`}
                aria-pressed={dupesOnly} onClick={() => setDupesOnly((v) => !v)}
                title="Same title uploaded in more than one format (e.g. FLAC + MP3)">Duplicates</button>
            )}
          </div>
          {canBulk && lossyDupes.length > 0 && (
            <div className="mng-dupehint">
              <span>{lossyDupes.length} lower-quality duplicate{lossyDupes.length === 1 ? "" : "s"} — keep the lossless copies, drop the rest.</span>
              <button type="button" className="linkbtn" onClick={selectLossyDupes}>Select the {lossyDupes.length} duplicate{lossyDupes.length === 1 ? "" : "s"}</button>
            </div>
          )}
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
        <div className="empty"><div className="empty__icon">🎵</div>No tracks on your account yet.</div>
      )}
      {!loading && (tracks || []).length > 0 && filtered.length === 0 && (
        <div className="empty">
          <div className="empty__icon">🎵</div>
          No tracks match your filters
          <div style={{ marginTop: 12 }}><Button sm onClick={clearFilters}>Clear filters</Button></div>
        </div>
      )}

      {/* ---- list ---- */}
      <div className="stack">
        {pageItems.map((t, i) => (
          <TrackRow key={t.id} track={t} index={i} avatar={avatar} defaultArt={defaultArt}
            selected={selected.has(t.id)}
            onCheck={(e) => onRowCheck(e, t.id)}
            onQuickPrivacy={(next) => void quickPrivacy(t, next)}
            onEdit={() => setEditing(t)}
            onDelete={() => void deleteOne(t)} />
        ))}
      </div>

      {/* ---- pagination: item range, page size, and (when needed) page nav ---- */}
      {!loading && filtered.length > 0 && (
        <div className="mng-pager">
          <span className="mng-pager__label">
            {pageStart + 1}–{Math.min(pageStart + pageSize, filtered.length)} of {filtered.length}
          </span>
          <label className="sub" style={{ margin: 0, display: "flex", gap: 6, alignItems: "center" }}>
            Per page
            <select value={pageSize} onChange={(e) => setPageSize(Number(e.target.value))} aria-label="Tracks per page">
              {PAGE_SIZE_OPTIONS.map((n) => <option key={n} value={n}>{n}</option>)}
            </select>
          </label>
          {totalPages > 1 && (
            <span className="mng-pager__nav">
              <Button kind="ghost" sm disabled={safePage === 0} onClick={() => setPage((p) => Math.max(0, p - 1))}>← Prev</Button>
              <span className="mng-pager__label">Page {safePage + 1} of {totalPages}</span>
              <Button kind="ghost" sm disabled={safePage >= totalPages - 1} onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}>Next →</Button>
            </span>
          )}
        </div>
      )}

      {/* ---- edit drawer ---- */}
      {editing && (
        <EditPanel track={editing} defaultArt={defaultArt} onClose={() => setEditing(null)}
          onSaved={(t) => { applyUpdate(t); setEditing(null); }} />
      )}

      {/* ---- bulk metadata editor ---- */}
      {bulkEdit && (
        <BulkEditPanel count={selected.size} busy={bulkBusy}
          onClose={() => setBulkEdit(false)} onApply={(patch) => void runBulkUpdate(patch)} />
      )}

      {/* ---- typed-confirmation bulk delete ---- */}
      {confirmDelete && (
        <DeleteConfirm count={selected.size} busy={bulkBusy}
          onClose={() => setConfirmDelete(false)}
          onConfirm={async () => { const res = await runBulkDelete(); if (res) setConfirmDelete(false); }} />
      )}
    </div>
  );
}

// ---- Backups chip cluster (each chip renders only when its field is present) ----
function ChipCluster({ track }: { track: Track }) {
  const t = track;
  const stale = backupStale(t);
  const hasBackup = !!t.backups && (t.backups.count ?? 0) > 0;
  return (
    <div className="mng-chips">
      {t.bpm != null && <span className="mchip mchip--bpm">BPM {t.bpm}</span>}
      {t.genre && (t.genre_emoji || isMatched(t)) && (
        <span className="mchip">{t.genre_emoji ? `${t.genre_emoji} ` : ""}{t.genre}</span>
      )}
      {t.daw && <span className="mchip mchip--daw">{dawLabel(t.daw)}</span>}
      {hasBackup && (
        stale
          ? <span className="mchip mchip--stale" title="Newer than the most recent backup — metadata may be stale">
              as of {fmtDate(t.backups!.last_backup)}
            </span>
          : <span className="mchip mchip--ok">
              ✅ {t.backups!.count} backup{t.backups!.count === 1 ? "" : "s"}{t.backups!.verified ? " · verified" : ""}
            </span>
      )}
      {(t.missing_count ?? 0) > 0 && (
        <span className="mchip mchip--warn" title="Missing-sample references in the matched project">
          ⚠ {t.missing_count} missing
        </span>
      )}
      {(t.dupe_count ?? 0) > 1 && (
        <span className={`mchip ${t.dupe_keeper ? "mchip--keep" : "mchip--dupe"}`}
          title={t.dupe_keeper
            ? `Best-quality of ${t.dupe_count} copies — keep this one`
            : `Lower-quality duplicate (${t.dupe_count} copies share this title) — safe to delete`}>
          {(t.original_format || "?").toUpperCase()} · {t.dupe_keeper ? "keep" : "dupe"}
        </span>
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
        <span className="mng-seo-panel__title">SEO score — {seo.score}/100</span>
      </div>
      <div className="mng-seo-checks">
        {seo.checks.map((c) => {
          const state = c.points >= c.max ? "is-ok" : c.points === 0 ? "is-bad" : "is-part";
          return (
            <div key={c.id} className="mng-seo-check">
              <span className={`mng-seo-check__mark ${state}`}>
                {state === "is-ok" ? "✓" : state === "is-bad" ? "✗" : "~"}
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

function TrackRow({ track, index, avatar, defaultArt, selected, onCheck, onQuickPrivacy, onEdit, onDelete }: {
  track: Track; index: number; avatar: string | null; defaultArt: string | null; selected: boolean;
  onCheck: (e: React.MouseEvent) => void;
  onQuickPrivacy: (next: Sharing) => void;
  onEdit: () => void; onDelete: () => void;
}) {
  const t = track;
  const priv = isPrivate(t);
  const next: Sharing = priv ? "public" : "private";
  // No-art fallback chain: real cover → user's default art → profile pic → 🎵.
  // Only the profile-pic stand-in is dimmed; the user's own default art shows full.
  const usingAvatar = !t.artwork_url && !defaultArt && !!avatar;
  return (
    <label className="row scanrow--enter" style={{ ["--i" as string]: index, marginBottom: 0 } as React.CSSProperties}>
      <input type="checkbox" className="mixrow__check" checked={selected}
        onChange={() => { /* click handler owns toggling for shift-range support */ }}
        onClick={onCheck} aria-label={`Select ${t.title}`} />
      <span className={`mng-art${usingAvatar ? " mng-art--avatar" : ""}`} aria-hidden="true">
        {t.artwork_url
          ? <img src={t.artwork_url} alt="" loading="lazy" />
          : defaultArt
            ? <img src={defaultArt} alt="" loading="lazy" title="No cover art — showing your default cover" />
            : avatar
              ? <img src={avatar} alt="" loading="lazy" title="No cover art — showing your profile picture" />
              : <span className="mng-art--ph">🎵</span>}
      </span>
      <div className="row__main">
        <div className="row__title">{t.title}</div>
        <div className="row__sub">
          {t.genre || "—"}
          {t.duration ? ` · ${fmtDuration(t.duration)}` : ""}
          {t.playback_count != null ? ` · ${t.playback_count} plays` : ""}
          {t.tags.length ? ` · #${t.tags.join(" #")}` : ""}
        </div>
      </div>
      <ChipCluster track={t} />
      <SeoBadge seo={t.seo} />
      <StatusPill status={priv ? "private" : "public"} label={priv ? "private" : "public"} />
      <span className="mng-date">{fmtDate(t.created_at)}</span>
      <button type="button" className={`pill ${priv ? "pill--private" : "pill--ok"}`}
        title={`Make ${next}`} aria-label={`Make ${next}`}
        onClick={(e) => { e.preventDefault(); onQuickPrivacy(next); }}>
        Make {next}
      </button>
      {t.permalink_url && (
        <button type="button" className="mng-iconbtn" title="Open on SoundCloud" aria-label="Open on SoundCloud"
          onClick={(e) => { e.preventDefault(); openExternal(t.permalink_url!); }}>↗</button>
      )}
      <button type="button" className="mng-iconbtn" title="Edit" aria-label="Edit track"
        onClick={(e) => { e.preventDefault(); onEdit(); }}>✎</button>
      <button type="button" className="mng-iconbtn mng-iconbtn--danger" title="Delete" aria-label="Delete track"
        onClick={(e) => { e.preventDefault(); onDelete(); }}>🗑</button>
    </label>
  );
}

// Shared overlay shell: side-drawer on wide windows, centered modal on narrow ones.
// `forceModal` always centers (used by the delete confirmation).
function Overlay({ children, onClose, forceModal }: {
  children: React.ReactNode; onClose: () => void; forceModal?: boolean;
}) {
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
      <div className={`glass elev-1 ${centered ? "mng-modal" : "mng-drawer"}`} role="dialog" aria-modal="true">
        {children}
      </div>
    </div>
  );
}

function EditPanel({ track, defaultArt, onClose, onSaved }: {
  track: Track; defaultArt: string | null; onClose: () => void; onSaved: (t: Track) => void;
}) {
  const [title, setTitle] = useState(track.title);
  const [description, setDescription] = useState(track.description);
  const [genre, setGenre] = useState(track.genre);
  const [sharing, setSharing] = useState<Sharing>(isPrivate(track) ? "private" : "public");
  const [tags, setTags] = useState(track.tags.join(", "));
  const [downloadable, setDownloadable] = useState(!!track.downloadable);
  const [busy, setBusy] = useState(false);
  const [artBusy, setArtBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const titleRef = useRef<HTMLInputElement | null>(null);
  useEffect(() => { titleRef.current?.focus(); }, []);

  async function save() {
    setBusy(true); setErr(null);
    try {
      const updated = await api.updateTrack(track.id, {
        title, description, genre, sharing, downloadable,
        tags: tags.split(",").map((t) => t.trim()).filter(Boolean),
      });
      onSaved(updated);
    } catch (e) { setErr(String((e as Error).message)); }
    finally { setBusy(false); }
  }

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
    setTags((prev) => {
      const have = new Set(prev.split(",").map((t) => t.trim().toLowerCase()).filter(Boolean));
      if (have.has(tag.toLowerCase())) return prev;
      const p = prev.trim().replace(/,\s*$/, "");
      return p ? `${p}, ${tag}` : tag;
    });
  }
  const haveTags = new Set(tags.split(",").map((t) => t.trim().toLowerCase()).filter(Boolean));
  const tagSuggestions = (track.seo?.suggested_tags || []).filter((t) => !haveTags.has(t.toLowerCase()));
  const matched = isMatched(track);
  return (
    <Overlay onClose={onClose}>
      <div className="mng-panel__head">
        <h2>Edit track</h2>
        <button type="button" className="mng-panel__close" onClick={onClose} aria-label="Close">✕</button>
      </div>
      <div className="mng-panel__body">
        <label className="field"><span>Title</span>
          <input ref={titleRef} type="text" value={title} onChange={(e) => setTitle(e.target.value)} /></label>
        <label className="field"><span>Description</span>
          <textarea value={description} onChange={(e) => setDescription(e.target.value)} /></label>
        <label className="field"><span>Genre</span>
          <input type="text" value={genre} onChange={(e) => setGenre(e.target.value)} /></label>
        <label className="field"><span>Privacy</span>
          <select value={sharing} onChange={(e) => setSharing(e.target.value as Sharing)}>
            <option value="public">Public</option>
            <option value="private">Private</option>
          </select></label>
        <label className="field" style={{ marginBottom: tagSuggestions.length ? 6 : 0 }}><span>Tags (comma-separated)</span>
          <input type="text" value={tags} onChange={(e) => setTags(e.target.value)} /></label>
        <label className="toolchk" style={{ fontSize: 13 }}>
          <input type="checkbox" checked={downloadable} onChange={(e) => setDownloadable(e.target.checked)} />
          Allow fans to download the original file
        </label>
        {tagSuggestions.length > 0 && (
          <div className="mng-tagsugg">
            <span className="mng-tagsugg__label">Suggested for {genre || "this genre"}:</span>
            {tagSuggestions.map((t) => (
              <button type="button" key={t} className="mng-tagchip" onClick={() => addTag(t)}
                title={`Add “${t}” to tags`}>+ {t}</button>
            ))}
          </div>
        )}
        {err && <div className="mng-err">⚠ {err}</div>}

        <div className="mng-cover">
          <div className="mng-cover__label">Cover art</div>
          <div className="art-row">
            <span className={`art-thumb${track.artwork_url || defaultArt ? "" : " art-thumb--ph"}`} aria-hidden="true">
              {track.artwork_url
                ? <img src={track.artwork_url} alt="" />
                : defaultArt
                  ? <img src={defaultArt} alt="" />
                  : "🎵"}
            </span>
            <Button sm onClick={() => void changeCover()} disabled={artBusy || busy}>
              {artBusy ? "Working…" : "Change cover…"}
            </Button>
            <Button kind="ghost" sm onClick={() => void genWaveCover()} disabled={artBusy || busy}
              title="Generate a cover from this track's waveform + your name">
              Waveform cover
            </Button>
          </div>
        </div>

        {track.seo && <SeoPanel seo={track.seo} />}

        {matched && (
          <div className="mng-matched">
            <div className="mng-matched__label">Matched to project</div>
            <div className="mng-matched__name" style={{ marginBottom: 10 }}>{track.project_match}</div>
            <ChipCluster track={track} />
          </div>
        )}
      </div>
      <div className="mng-panel__foot">
        <Button sm onClick={onClose} disabled={busy}>Cancel</Button>
        <Button kind="primary" sm onClick={() => void save()} disabled={busy}>{busy ? "Saving…" : "Save"}</Button>
      </div>
    </Overlay>
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
    if (tags.trim()) patch.tags = tags.split(",").map((t) => t.trim()).filter(Boolean);
    if (sharing) patch.sharing = sharing;
    onApply(patch);
  }
  const empty = !genre.trim() && !tags.trim() && !sharing;

  return (
    <Overlay onClose={onClose}>
      <div className="mng-panel__head">
        <h2>Edit {count} tracks</h2>
        <button type="button" className="mng-panel__close" onClick={onClose} aria-label="Close">✕</button>
      </div>
      <div className="mng-panel__body">
        <p className="sub" style={{ marginTop: 0 }}>Only the fields you fill in are applied to all selected tracks.</p>
        <label className="field"><span>Genre</span>
          <input type="text" value={genre} onChange={(e) => setGenre(e.target.value)} placeholder="Leave blank to keep" /></label>
        <label className="field"><span>Tags (comma-separated)</span>
          <input type="text" value={tags} onChange={(e) => setTags(e.target.value)} placeholder="Leave blank to keep" /></label>
        <label className="field" style={{ marginBottom: 0 }}><span>Privacy</span>
          <select value={sharing} onChange={(e) => setSharing(e.target.value as "" | Sharing)}>
            <option value="">Keep current</option>
            <option value="public">Public</option>
            <option value="private">Private</option>
          </select></label>
      </div>
      <div className="mng-panel__foot">
        <Button sm onClick={onClose} disabled={busy}>Cancel</Button>
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
    <Overlay onClose={onClose} forceModal>
      <div className="mng-panel__head">
        <h2>Delete {count} tracks</h2>
        <button type="button" className="mng-panel__close" onClick={onClose} aria-label="Close">✕</button>
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
