// Small "this just happened" moments in Uploader: the row that just went up, the
// track you just edited, the first post ever and the plays gained lately. The logic
// lives here, without React, so it is easy to test (moments.test.ts).
import type { ItemState } from "./useProgress";
import type { Overview } from "./types";

// ── the row that just went up ────────────────────────────────────────────────

// Mixes that have just turned "posted" between two looks at a post's progress. Only a
// real change counts, so a row drawn again later (a search, Check folders) doesn't
// glow a second time.
export function newlyPosted(prev: Record<string, ItemState>, next: Record<string, ItemState>): string[] {
  return Object.keys(next).filter((k) => next[k].phase === "posted" && prev[k]?.phase !== "posted");
}

// ── a row that just changed ──────────────────────────────────────────────────

const GLOW_MS = 2000;   // the nav-came-from glow in lazy-ui.css

// Glow the row (or cover) with this data-nav-key for a moment: the same glow as a row
// you come back to (nav.ts). Under reduced motion lazy-ui.css shows a still ring instead.
export function glowRow(key: string, root: ParentNode = document): boolean {
  const row = root.querySelector<HTMLElement>(`[data-nav-key="${key.replace(/["\\]/g, "\\$&")}"]`);
  if (!row) return false;
  row.classList.remove("nav-came-from");
  void row.offsetWidth;  // restart the glow if it is already showing
  row.classList.add("nav-came-from");
  window.setTimeout(() => row.classList.remove("nav-came-from"), GLOW_MS);
  return true;
}

// ── the first post ever ──────────────────────────────────────────────────────

// Nothing has ever gone up: none from this app, and none seen on the SoundCloud account
// (songs posted elsewhere count too). Asked before a post starts; unknown is "no".
export function isFirstPost(ov: Pick<Overview, "uploaded_count" | "sc_track_count"> | null): boolean {
  return !!ov && ov.uploaded_count === 0 && (ov.sc_track_count ?? 0) === 0;
}

// ── plays gained lately ──────────────────────────────────────────────────────

export interface PlaysGain { total: number; gain: number; since: string }   // since: "YYYY-MM-DD"

const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

// The day a gain is counted from, said plainly: "yesterday", or its weekday (the
// backend only counts from the last six days, so a weekday is never ambiguous).
export function sinceDay(since: string, today: Date = new Date()): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(since);
  if (!m) return null;
  const then = new Date(+m[1], +m[2] - 1, +m[3]);
  const now = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const days = Math.round((now.getTime() - then.getTime()) / 86_400_000);
  if (days < 1 || days > 6) return null;
  return days === 1 ? "yesterday" : DAYS[then.getDay()];
}

// "+38 plays since Tuesday" under Plays on Home, or null when there is nothing to say.
export function playsGainLine(p: PlaysGain | null | undefined, fmt: (n: number) => string, today?: Date): string | null {
  if (!p || !(p.gain > 0)) return null;
  const day = sinceDay(p.since, today);
  if (!day) return null;
  return `+${fmt(p.gain)} ${p.gain === 1 ? "play" : "plays"} since ${day}`;
}
