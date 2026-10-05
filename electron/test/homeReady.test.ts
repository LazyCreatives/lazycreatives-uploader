import { describe, expect, it } from "vitest";
import { readyHeadline, readyInFolder, waitingMixes } from "../src/screens/Home";
import type { Mix } from "../src/types";

const mix = (name: string, mtime: number, extra: Partial<Mix> = {}): Mix => ({
  path: `/m/${name}.wav`, name, ext: ".wav", size: 1, mtime, duration: null, file_hash: null,
  uploaded: false, permalink_url: null, ...extra,
});

describe("mixes waiting on Home", () => {
  it("counts new mixes only, and finds the newest", () => {
    const w = waitingMixes([
      mix("Old", 100), mix("Newest", 300), mix("Posted", 900, { uploaded: true }),
      mix("Newest MP3", 950, { superseded_by: "WAV" }),
    ]);
    expect(w.count).toBe(2);
    expect(w.newest?.name).toBe("Newest");
  });
  it("is empty with no list", () => {
    expect(waitingMixes(null)).toEqual({ count: 0, newest: null });
  });
  it("words it in plain English", () => {
    expect(readyHeadline(8)).toBe("8 new mixes ready to post.");
    expect(readyHeadline(1)).toBe("1 new mix ready to post.");
    expect(readyInFolder(3)).toBe("3 mixes are ready in your folder.");
    expect(readyInFolder(1)).toBe("1 mix is ready in your folder.");
  });
});
