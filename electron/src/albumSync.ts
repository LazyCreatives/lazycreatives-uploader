import { useEffect, useState } from "react";
import { makeApi, openExternal, saveRenderedCover } from "./api";
import { loadAlbums, mainGenre, type Album, type AlbumLink } from "./albums";
import { coverPng } from "./coverRender";
import { toast, toastWarn } from "./components/Desktop";
import type { AlbumSync } from "./components/Albums";

// "Sync to SoundCloud" on an album page: one playlist of the album's Ready songs in
// album order, posting the ones not up yet (backend/lazyupload/album_sync.py). Each
// album shows what it is doing while it runs, even after leaving the page and coming back.

const api = makeApi();
const steps = new Map<string, string>();
const subs = new Set<() => void>();
const tell = () => subs.forEach((f) => f());
const say = (id: string, step: string | null) => { if (step) steps.set(id, step); else steps.delete(id); tell(); };

function useStep(albumId: string): string | null {
  const [, bump] = useState(0);
  useEffect(() => {
    const f = () => bump((n) => n + 1);
    subs.add(f);
    return () => { subs.delete(f); };
  }, []);
  return steps.get(albumId) ?? null;
}

// The covers that go up: the album's for the playlist, and each song's for a song that
// goes up (the one the app shows), unless a cover is set for every post in Settings.
async function covers(a: Album): Promise<{ art?: string; songs: Record<string, string> }> {
  const draw = (name: string, genre: string | null) => coverPng(name, genre).then((png) => saveRenderedCover(name, png)).catch(() => undefined);
  const art = await draw(a.title, mainGenre(a) || null);
  const songs: Record<string, string> = {};
  const cfg = await api.getSettings().catch(() => null);
  if (!cfg?.default_artwork_path) {
    for (const s of a.songs.filter((x) => x.is_ready)) {
      const p = await draw(s.project || s.title, s.genre || null);
      if (p) songs[s.path] = p;
    }
  }
  return { art, songs };
}

type Result = AlbumLink & { ok: boolean; made?: boolean; posted: number; stopped?: string | null };

async function start(a: Album) {
  if (steps.has(a.id)) return;
  say(a.id, "Drawing the covers");
  try {
    const { art, songs } = await covers(a);
    say(a.id, "Starting");
    const { job_id } = await api.syncAlbum(a.id, art, songs);
    for (;;) {
      await new Promise((r) => setTimeout(r, 800));
      const job = await api.jobStatus(job_id) as { state: string; step?: string; result?: Result; error?: string };
      if (job.state === "running" || job.state === "cancelling") { say(a.id, job.step ? `${job.step}…` : "Syncing…"); continue; }
      if (job.state === "error") throw new Error(job.error || "Couldn't sync the album.");
      done(a, job.result!);
      break;
    }
  } catch (e) {
    toastWarn(`Couldn't sync ${a.title}: ${String((e as Error).message)}`);
  } finally {
    say(a.id, null);
    void loadAlbums();
  }
}

function done(a: Album, r: Result) {
  if (!r.playlist_id) {
    toastWarn(r.stopped ? `Stopped before ${a.title} went up.` : `Nothing on ${a.title} is ready to go up yet.`);
    return;
  }
  const open = r.url ? { label: "Open", onClick: () => openExternal(r.url!) } : undefined;
  const posted = r.posted ? `, ${r.posted} posted` : "";
  const head = r.made ? `${a.title} is on SoundCloud as a private playlist` : `${a.title} is synced`;
  const msg = `${head}: ${r.on} of ${r.of} song${r.of === 1 ? "" : "s"}${posted}.`;
  if (r.failed?.length || r.stopped) toastWarn(`${msg} ${r.failed?.length ? `Couldn't post ${r.failed.join(", ")}.` : "Stopped part way."}`, open);
  else toast(msg, open);
}

export const albumSync: AlbumSync = {
  label: "Sync to SoundCloud",
  hint: "Puts the album's Ready songs on SoundCloud as one private playlist, in album order. Songs not up yet are posted; nothing is posted twice.",
  start: (a) => void start(a),
  useStep,
};

// From Backups ("Sync to SoundCloud" there opens Uploader with the album's id).
export async function syncById(id: string) {
  const a = (await api.listAlbums().catch(() => ({ albums: [] as Album[] }))).albums.find((x) => x.id === id);
  if (a) void start(a);
  else toastWarn("That album isn't there any more.");
}
