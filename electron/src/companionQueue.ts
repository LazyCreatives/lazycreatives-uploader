import type { Mix, UploadRow } from "./types";
import type { ItemPhase, UploadState } from "./useProgress";
import { baseName } from "./desktop";

// What the narrow window shows, worked out from the live post and the history. No React
// in here, so it is easy to test.

// Mixes Uploader can post (the same list the main window takes in a drop).
export const MIX_FILE = /\.(wav|aiff?|flac|mp3|m4a|aac|ogg|opus)$/i;
export const isMix = (path: string) => MIX_FILE.test(path);

// A file's name without its folder or ending: "/m/Night Drive v3.wav" → "Night Drive v3".
export function mixName(path: string): string {
  return baseName(path).replace(/\.[^.]+$/, "");
}

export interface QueueRow { key: string; name: string; phase: ItemPhase; pct: number; note: string }

// The mixes in the post that is running (or just ran): going up first, then waiting,
// then the finished ones.
export function queueRows(u: UploadState): QueueRow[] {
  const order: Record<ItemPhase, number> = { uploading: 0, waiting: 1, failed: 2, posted: 3, skipped: 4 };
  return Object.entries(u.items)
    .map(([key, it]) => ({
      key, name: mixName(key), phase: it.phase,
      pct: it.phase === "uploading" ? (it.size > 0 ? Math.round((it.sent / it.size) * 100) : 0) : it.phase === "posted" ? 100 : 0,
      note: it.phase === "uploading" ? (it.size > 0 ? `Uploading ${Math.round((it.sent / it.size) * 100)}%` : "Starting…")
        : it.phase === "waiting" ? "Waiting its turn"
        : it.phase === "posted" ? "Posted"
        : it.phase === "skipped" ? "Already on SoundCloud"
        : it.reason || "Didn’t go up",
    }))
    .sort((a, b) => order[a.phase] - order[b.phase]);
}

// "Posting 2 of 5" for the top of the narrow window, or null when nothing is going up.
export function postingLine(u: UploadState): string | null {
  if (!u.active) return null;
  const at = Math.min(u.total || 1, u.completed + u.skipped + u.errors + 1);
  return u.total > 1 ? `Posting ${at} of ${u.total}` : "Posting your mix";
}

// One post in the recent list: its state in a word, and the dot colour for it.
export function postState(r: Pick<UploadRow, "status" | "sharing">): { word: string; dot: string; tone: "ok" | "look" | "error" | "new" } {
  if (r.status === "uploaded") return r.sharing === "private"
    ? { word: "Private", dot: "dot--warn", tone: "ok" }
    : { word: "Public", dot: "dot--ok", tone: "ok" };
  if (r.status === "error") return { word: "Failed", dot: "dot--error", tone: "error" };
  return { word: "Skipped", dot: "", tone: "new" };
}

// A time from the engine ("2026-10-05 15:03:00" or ISO) as milliseconds.
export function whenMs(s: string | null | undefined): number | null {
  if (!s) return null;
  const t = new Date(s.includes("T") ? s : s.replace(" ", "T")).getTime();
  return Number.isNaN(t) ? null : t;
}

// Which dropped mixes to tick on the Upload page: the ones that can go up. Mixes
// already on SoundCloud are named so the page can say so.
export function preselect(mixes: Mix[], paths: string[]): { pick: string[]; already: Mix[]; notFound: string[] } {
  const byPath = new Map(mixes.map((m) => [m.path, m]));
  const pick: string[] = [], already: Mix[] = [], notFound: string[] = [];
  for (const p of paths) {
    const m = byPath.get(p);
    if (!m) notFound.push(p);
    else if (m.uploaded) already.push(m);
    else pick.push(p);
  }
  return { pick, already, notFound };
}
