import { describe, expect, it } from "vitest";
import { waitingMixes } from "./Home";
import type { Mix } from "../types";

const mix = (name: string, extra: Partial<Mix> = {}): Mix => ({
  path: `/m/${name}.wav`, name, ext: ".wav", size: 1, mtime: 1, duration: 120,
  file_hash: name, uploaded: false, permalink_url: null, ...extra,
});

describe("waitingMixes", () => {
  it("doesn't count a song that is already on SoundCloud in another format or version", () => {
    const on = { kind: "same" as const, title: "Heavy", format: "MP3", permalink_url: null, posted_at: null, count: 1 };
    const { count, newest } = waitingMixes([
      mix("Heavy", { on_soundcloud: on }),
      mix("Tide v2", { on_soundcloud: { ...on, kind: "version" }, mtime: 9 }),
      mix("Heavy", { path: "/m/Heavy.mp3", ext: ".mp3", superseded_by: "WAV" }),
      mix("Glow", { mtime: 3 }),
    ]);
    expect(count).toBe(1);
    expect(newest?.name).toBe("Glow");
  });
});
