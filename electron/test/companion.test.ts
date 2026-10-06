import { describe, expect, it } from "vitest";
import { ago } from "../src/companion";
import { isMix, mixName, postState, postingLine, preselect, queueRows, whenMs } from "../src/companionQueue";
import { initialUpload, type UploadState } from "../src/useProgress";
import type { Mix } from "../src/types";
// companion.js is the main-process side (CommonJS); only its pure placement is used here.
// @ts-ignore - untyped JS module imported for its runtime behaviour
import * as companionMain from "../electron/companion";

const { companionBounds } = companionMain as any;

const mix = (path: string, more: Partial<Mix> = {}): Mix => ({
  path, name: mixName(path), ext: ".wav", size: 1, mtime: 1, duration: 60, file_hash: null,
  uploaded: false, permalink_url: null, ...more,
});

describe("dropping a mix on the narrow window", () => {
  it("takes mixes, not other files", () => {
    expect(isMix("/m/Night Drive.wav")).toBe(true);
    expect(isMix("/m/Night Drive.AIFF")).toBe(true);
    expect(isMix("/m/cover.png")).toBe(false);
    expect(isMix("/m/Project.als")).toBe(false);
  });
  it("names a mix by its file name", () => {
    expect(mixName("/Users/me/Mixdowns/Night Drive v3.wav")).toBe("Night Drive v3");
    expect(mixName("C:\\Mixes\\Tape.flac")).toBe("Tape");
  });
  it("ticks the dropped mixes that can still go up, and names the ones already posted", () => {
    const mixes = [mix("/m/A.wav"), mix("/m/B.wav", { uploaded: true }), mix("/m/C.wav")];
    const r = preselect(mixes, ["/m/A.wav", "/m/B.wav", "/elsewhere/D.wav"]);
    expect(r.pick).toEqual(["/m/A.wav"]);
    expect(r.already.map((m) => m.name)).toEqual(["B"]);
    expect(r.notFound).toEqual(["/elsewhere/D.wav"]);
  });
});

describe("the post going up now", () => {
  const u: UploadState = {
    ...initialUpload, active: true, total: 3, completed: 1, current: "Tape",
    items: {
      "/m/Done.wav": { phase: "posted", sent: 10, size: 10, url: "https://x" },
      "/m/Next.wav": { phase: "waiting", sent: 0, size: 0 },
      "/m/Tape.wav": { phase: "uploading", sent: 25, size: 100 },
    },
  };
  it("lists the mix going up first, then waiting, then finished", () => {
    const rows = queueRows(u);
    expect(rows.map((r) => r.name)).toEqual(["Tape", "Next", "Done"]);
    expect(rows[0]).toMatchObject({ pct: 25, note: "Uploading 25%" });
    expect(rows[1].note).toBe("Waiting its turn");
  });
  it("says how far the post has got", () => {
    expect(postingLine(u)).toBe("Posting 2 of 3");
    expect(postingLine({ ...u, total: 1, completed: 0 })).toBe("Posting your mix");
    expect(postingLine(initialUpload)).toBe(null);
  });
  it("a failed mix says why", () => {
    const rows = queueRows({ ...initialUpload, items: { "/m/X.wav": { phase: "failed", sent: 0, size: 0, reason: "SoundCloud said no" } } });
    expect(rows[0].note).toBe("SoundCloud said no");
  });
});

describe("recent posts", () => {
  it("shows public, private or failed", () => {
    expect(postState({ status: "uploaded", sharing: "public" }).word).toBe("Public");
    expect(postState({ status: "uploaded", sharing: "private" }).word).toBe("Private");
    expect(postState({ status: "error", sharing: "public" })).toMatchObject({ word: "Failed", tone: "error" });
  });
  it("reads the engine's times", () => {
    expect(whenMs("2026-10-05 15:03:00")).toBe(new Date(2026, 9, 5, 15, 3).getTime());
    expect(whenMs(null)).toBe(null);
    expect(whenMs("soon")).toBe(null);
  });
  it("says how long ago, short enough for a narrow column", () => {
    const now = new Date(2026, 9, 6, 15, 0).getTime();
    expect(ago(now - 20_000, now)).toBe("Just now");
    expect(ago(now - 4 * 60_000, now)).toBe("4 min ago");
    expect(ago(new Date(2026, 9, 5, 9, 0).getTime(), now)).toBe("Yesterday");
  });
});

describe("where the narrow window opens", () => {
  const screens = [{ workArea: { x: 0, y: 0, width: 1440, height: 900 } }];
  it("against the right edge of the screen the first time, then where it was left", () => {
    expect(companionBounds({}, screens, { x: 100, y: 100, width: 1100, height: 760 }))
      .toEqual({ x: 1440 - 340 - 16, y: 140, width: 340, height: 620 });
    expect(companionBounds({ x: 20, y: 30, width: 380, height: 700 }, screens, null)).toEqual({ x: 20, y: 30, width: 380, height: 700 });
  });
});
