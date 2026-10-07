import { useEffect, useState } from "react";
import { makeApi } from "./api";
import type { Playlist, PlaylistChange, Sharing, Track } from "./types";

// Your SoundCloud playlists, loaded once and shared by every screen that shows them
// (the Playlists page, "Add to playlist", a track's page, Cmd/Ctrl+K). Each change goes
// to SoundCloud straight away; the list here follows what SoundCloud sends back.

const api = makeApi();
type State = { list: Playlist[] | null; error: string | null };
let state: State = { list: null, error: null };
let loading: Promise<void> | null = null;
const subs = new Set<(s: State) => void>();
const tell = (s: State) => { state = s; subs.forEach((f) => f(s)); };

export function loadPlaylists(force = false): Promise<void> {
  if (loading && !force) return loading;
  if (state.list && !force) return Promise.resolve();
  loading = api.listPlaylists()
    .then((list) => tell({ list, error: null }))
    .catch((e) => tell({ list: state.list ?? [], error: String((e as Error).message) }))
    .finally(() => { loading = null; });
  return loading;
}

export function usePlaylists(): State & { reload: () => Promise<void> } {
  const [s, setS] = useState<State>(state);
  useEffect(() => {
    subs.add(setS);
    void loadPlaylists();
    return () => { subs.delete(setS); };
  }, []);
  return { ...s, reload: () => loadPlaylists(true) };
}

export function playlistsNow(): Playlist[] { return state.list ?? []; }

// Where you are on the Playlists page, as kept in the app's back/forward history:
// "new", a playlist ("123"), or a song's panel open over it ("123/track/456").
export function playlistPlace(sub: string | null): { open: string | null; track: string | null } {
  const m = /^(\d+)\/track\/(\d+)$/.exec(sub ?? "");
  return m ? { open: m[1], track: m[2] } : { open: sub, track: null };
}
export const songOnPlaylist = (playlist: string, track: string) => `${playlist}/track/${track}`;

// Put one playlist back into the list as SoundCloud returned it (new ones go first).
function keepOne(p: Playlist) {
  const list = state.list ?? [];
  const has = list.some((x) => x.id === p.id);
  tell({ ...state, list: has ? list.map((x) => (x.id === p.id ? p : x)) : [p, ...list] });
}

export async function createPlaylist(title: string, sharing: Sharing, trackIds: number[] = []): Promise<Playlist> {
  const p = await api.createPlaylist(title.trim(), sharing, trackIds);
  keepOne(p);
  return p;
}

export async function savePlaylist(id: number, change: PlaylistChange): Promise<Playlist> {
  const p = await api.updatePlaylist(id, change);
  keepOne(p);
  return p;
}

// A new cover for the playlist from a picture on this computer (the picture is only read).
export async function setPlaylistCover(id: number, path: string): Promise<Playlist> {
  const p = await api.setPlaylistArtwork(id, path);
  keepOne(p);
  return p;
}

// Only the details that changed, so saving never touches the playlist's songs.
export function detailChanges(p: Playlist, d: { title: string; description: string; genre: string; tags: string[]; sharing: Sharing }): PlaylistChange {
  const c: PlaylistChange = {};
  if (d.title.trim() && d.title.trim() !== p.title) c.title = d.title.trim();
  if (d.description !== (p.description || "")) c.description = d.description;
  if (d.genre.trim() !== (p.genre || "")) c.genre = d.genre.trim();
  if (d.tags.join("\n") !== (p.tags || []).join("\n")) c.tags = d.tags;
  if (d.sharing !== p.sharing) c.sharing = d.sharing;
  return c;
}

export async function addToPlaylist(id: number, trackIds: number[]): Promise<Playlist> {
  const p = await api.addToPlaylist(id, trackIds);
  keepOne(p);
  return p;
}

export async function deletePlaylist(id: number): Promise<void> {
  await api.deletePlaylist(id);
  tell({ ...state, list: (state.list ?? []).filter((x) => x.id !== id) });
}

// Shown on screen before SoundCloud answers, so a drag lands at once.
export function showOrder(id: number, ids: number[]) {
  const p = (state.list ?? []).find((x) => x.id === id);
  if (!p) return;
  const byId = new Map(p.tracks.map((t) => [t.id, t]));
  keepOne({ ...p, tracks: ids.map((i) => byId.get(i)!).filter(Boolean), track_count: ids.length });
}

// ── small helpers (tested in playlists.test.ts) ─────────────────────────────

// Move one item of a list from one place to another.
export function moveItem<T>(list: T[], from: number, to: number): T[] {
  if (from === to || from < 0 || from >= list.length) return list;
  const out = list.slice();
  const [it] = out.splice(from, 1);
  out.splice(Math.max(0, Math.min(out.length, to)), 0, it);
  return out;
}

// Sleeve look numbers a playlist like the back of a record: side A, then side B
// from the halfway point (A1 A2 A3 / B1 B2). Very long playlists stay A1..An.
export function sideLabel(i: number, n: number): string {
  if (n < 4 || n > 24) return `${i + 1}`;
  const half = Math.ceil(n / 2);
  return i < half ? `A${i + 1}` : `B${i - half + 1}`;
}

// "48 min", "1 hr 12 min", "" for nothing.
export function fmtLength(seconds: number | null | undefined): string {
  const s = Math.round(seconds ?? 0);
  if (s <= 0) return "";
  if (s < 60) return `${s} sec`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60), rest = m % 60;
  return rest ? `${h} hr ${rest} min` : `${h} hr`;
}

// Which playlists hold this track.
export function playlistsWith(trackId: number, list: Playlist[]): Playlist[] {
  return list.filter((p) => p.tracks.some((t) => t.id === trackId));
}

// The genre a playlist's cover and stripe follow: the most common one in it.
export function mainGenre(tracks: { genre?: string | null }[]): string | null {
  const n = new Map<string, number>();
  for (const t of tracks) { const g = (t.genre || "").trim(); if (g) n.set(g, (n.get(g) ?? 0) + 1); }
  let best: string | null = null, top = 0;
  for (const [g, c] of n) if (c > top) { best = g; top = c; }
  return best;
}

// A playlist track joined with what Your tracks knows about it (project, cover genre).
export function joinTrack<T extends { id: number }>(t: T, yours: Map<number, Track>): T & Partial<Track> {
  const mine = yours.get(t.id);
  return mine ? { ...mine, ...t, genre: (t as Partial<Track>).genre || mine.genre } : t;
}
