// Your tracks search, filters and sorting. Works like the Backups Library: a forgiving
// search box, and pickers that only offer what your own tracks have (their DAW, genre,
// tempo and project), so another producer never sees a list of things they don't use.
import type { Track } from "./types";
import { fuzzyScore } from "./fuzzy";

export type PrivacyFilter = "all" | "public" | "private";
export type ProjectFilter = "any" | "linked" | "backedup" | "missing" | "unlinked";
export type ScoreFilter = "any" | "low" | "good";

export interface TrackFilters {
  q: string;
  privacy: PrivacyFilter;
  daw: string;      // "" = any
  genre: string;    // "" = any
  bpm: string;      // "" = any, else a BPM_BANDS key
  project: ProjectFilter;
  score: ScoreFilter;
  dupes: boolean;
}

export const NO_FILTERS: TrackFilters = {
  q: "", privacy: "all", daw: "", genre: "", bpm: "", project: "any", score: "any", dupes: false,
};

// Same tempo bands as the Backups Library.
export const BPM_BANDS: { key: string; label: string; lo: number; hi: number }[] = [
  { key: "lt100", label: "Under 100", lo: 0, hi: 100 },
  { key: "100", label: "100–119", lo: 100, hi: 120 },
  { key: "120", label: "120–129", lo: 120, hi: 130 },
  { key: "130", label: "130–149", lo: 130, hi: 150 },
  { key: "150", label: "150–169", lo: 150, hi: 170 },
  { key: "170", label: "170 and up", lo: 170, hi: Infinity },
];

// A search score under this reads as "hard to find" on SoundCloud.
export const LOW_SCORE = 70;

const DAW_LABEL: Record<string, string> = {
  ableton: "Ableton", flstudio: "FL Studio", logic: "Logic Pro", "logic pro": "Logic Pro",
  cubase: "Cubase", studioone: "Studio One", bitwig: "Bitwig", reaper: "Reaper",
  protools: "Pro Tools", reason: "Reason", garageband: "GarageBand", dawproject: "DAWproject",
};
export function dawName(daw: string): string {
  return DAW_LABEL[daw.toLowerCase()] || daw;
}

export function isPrivate(t: Track): boolean { return t.sharing === "private"; }

export function isFiltered(f: TrackFilters): boolean {
  return f.q.trim() !== "" || f.privacy !== "all" || extraFilterCount(f) > 0;
}

// Everything but the search box and privacy (which has its own counted buttons).
export function extraFilterCount(f: TrackFilters): number {
  return [f.daw, f.genre, f.bpm, f.project !== "any", f.score !== "any", f.dupes].filter(Boolean).length;
}

/** The DAWs and genres your own tracks have, for the pickers. */
export function pickerOptions(tracks: Track[]): { daws: string[]; genres: string[] } {
  const daws = [...new Set(tracks.map((t) => t.daw || "").filter(Boolean))].sort((a, b) => dawName(a).localeCompare(dawName(b)));
  const genres = [...new Set(tracks.map((t) => (t.genre || "").trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b));
  return { daws, genres };
}

/** Tracks that pass the filters (ignoring privacy when `skipPrivacy`), in their given order. */
export function applyFilters(tracks: Track[], f: TrackFilters, skipPrivacy = false): Track[] {
  const band = BPM_BANDS.find((b) => b.key === f.bpm);
  const q = f.q.trim();
  return tracks.filter((t) => {
    if (!skipPrivacy && f.privacy !== "all" && isPrivate(t) !== (f.privacy === "private")) return false;
    if (f.daw && (t.daw || "") !== f.daw) return false;
    if (f.genre && (t.genre || "").trim() !== f.genre) return false;
    if (band) {
      const b = t.bpm ? Math.round(t.bpm) : null;
      if (b == null || b < band.lo || b >= band.hi) return false;
    }
    if (f.project === "linked" && !t.project_match) return false;
    if (f.project === "unlinked" && t.project_match) return false;
    if (f.project === "backedup" && !((t.backups?.count ?? 0) > 0)) return false;
    if (f.project === "missing" && !((t.missing_count ?? 0) > 0)) return false;
    if (f.score === "low" && !((t.seo?.score ?? 100) < LOW_SCORE)) return false;
    if (f.score === "good" && !((t.seo?.score ?? -1) >= LOW_SCORE)) return false;
    if (f.dupes && !((t.dupe_count ?? 0) > 1)) return false;
    if (q && !fuzzyScore(q, [t.title, t.genre, ...(t.tags || []), t.project_match, t.daw ? dawName(t.daw) : null])) return false;
    return true;
  });
}

/** How many tracks each privacy button would show, given the other filters. */
export function privacyCounts(tracks: Track[], f: TrackFilters): Record<PrivacyFilter, number> {
  const c = { all: 0, public: 0, private: 0 };
  for (const t of applyFilters(tracks, f, true)) { c.all++; c[isPrivate(t) ? "private" : "public"]++; }
  return c;
}

// ── sorting ──
export type SortKey = "date" | "title" | "project" | "plays" | "duration" | "bpm" | "seo";

// The way each sort goes when first picked: newest, A to Z, most played, longest,
// slowest, and lowest search score first (the ones that need you). Picking it again flips it.
export const FIRST_DESC: Record<SortKey, boolean> = {
  date: true, title: false, project: false, plays: true, duration: true, bpm: false, seo: false,
};

function sortValue(t: Track, key: SortKey): string | number | null {
  switch (key) {
    case "title": return t.title.toLowerCase();
    case "project": return t.project_match ? t.project_match.toLowerCase() : null;
    case "plays": return t.playback_count ?? null;
    case "duration": return t.duration ?? null;
    case "bpm": return t.bpm ? Math.round(t.bpm) : null;
    case "seo": return t.seo ? t.seo.score : null;
    default: {
      const d = t.created_at ? Date.parse(t.created_at) : NaN;
      return isNaN(d) ? null : d;
    }
  }
}

/** Sorted copy; empty values (not linked, no tempo, no date) always go last. Ties keep their order. */
export function sortTracks(tracks: Track[], key: SortKey, desc: boolean): Track[] {
  const dir = desc ? -1 : 1;
  return tracks
    .map((t, i) => ({ t, i, v: sortValue(t, key) }))
    .sort((a, b) => {
      if (a.v == null || b.v == null) return a.v == null && b.v == null ? a.i - b.i : a.v == null ? 1 : -1;
      const c = typeof a.v === "number" && typeof b.v === "number" ? a.v - b.v : String(a.v).localeCompare(String(b.v), undefined, { numeric: true });
      return c !== 0 ? c * dir : a.i - b.i;
    })
    .map((x) => x.t);
}
