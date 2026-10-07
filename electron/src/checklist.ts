import type { Config, UploadItemInput } from "./types";

// The checklist before posting: what a mix will go up with, and anything worth fixing
// first. Nothing here stops a post; a "warn" is a nudge, a "tip" is quieter still.

export type CheckState = "ok" | "warn" | "tip";
export interface Check { key: string; state: CheckState; say: string }

// Bits of a file name that read badly as a SoundCloud title.
const FILE_WORDS = /(\.(wav|aiff?|flac|mp3)$)|(_)|\b(final|master(ed)?|bounce|mixdown|export|v\d+|take\s?\d+)\b/i;
const LOSSLESS = new Set(["wav", "aif", "aiff", "flac", "alac"]);

export function titleOf(item: UploadItemInput): string {
  return (item.title || item.name || "").trim();
}

export function preflight(item: UploadItemInput, cfg: Pick<Config, "default_artwork_path" | "default_description">, ext = ""): Check[] {
  const title = titleOf(item);
  const tags = item.tags ?? [];
  const kind = ext.replace(".", "").toLowerCase();
  return [
    FILE_WORDS.test(title)
      ? { key: "title", state: "warn", say: `The title looks like a file name (“${title}”). Give it a tidy title in a template or after posting.` }
      : { key: "title", state: "ok", say: `Title: ${title}` },
    // every mix goes up with a cover now: the one picked for the post, or the one its row shows
    { key: "cover", state: "ok", say: item.artwork_path ? "Cover: the one picked for this post"
      : cfg.default_artwork_path ? "Cover: your default cover" : "Cover: the one shown on its row" },
    item.genre
      ? { key: "genre", state: "ok", say: `Genre: ${item.genre}` }
      : { key: "genre", state: "warn", say: "No genre, so it won't show up when people browse by genre." },
    tags.length >= 3
      ? { key: "tags", state: "ok", say: `${tags.length} tags` }
      : { key: "tags", state: "warn", say: tags.length ? `Only ${tags.length} tag${tags.length === 1 ? "" : "s"}. Three or more help people find it.` : "No tags. Three or more help people find it." },
    item.description || cfg.default_description
      ? { key: "description", state: "ok", say: "Description written" }
      : { key: "description", state: "tip", say: "No description. A line about the track helps it get found." },
    !kind || LOSSLESS.has(kind)
      ? { key: "file", state: "ok", say: kind ? `${kind.toUpperCase()} file, full quality` : "Full-quality file" }
      : { key: "file", state: "tip", say: `${kind.toUpperCase()} file. SoundCloud squeezes it again, so a WAV of the same mix sounds better.` },
  ];
}

// How loud it is, read as a check: peaks at full scale can crackle once SoundCloud
// encodes them; very quiet mixes sound weak next to other tracks.
export function levelCheck(lv: { peak_db: number; rms_db: number } | null): Check | null {
  if (!lv) return null;
  if (lv.peak_db >= -0.3) {
    return { key: "level", state: "warn", say: "Peaks hit the top (0 dB). SoundCloud's encoding can make that crackle; leave about 1 dB of room." };
  }
  if (lv.rms_db < -24) {
    return { key: "level", state: "tip", say: `Quiet (average ${lv.rms_db.toFixed(0)} dB). It may sound weak next to other tracks.` };
  }
  return { key: "level", state: "ok", say: `Level fine (loudest peak ${lv.peak_db.toFixed(1)} dB)` };
}

export function needsLook(checks: Check[]): number {
  return checks.filter((c) => c.state === "warn").length;
}
