import { describe, it, expect } from "vitest";
import { levelCheck, needsLook, preflight } from "../src/checklist";

const cfg = { default_artwork_path: "", default_description: "" };
const states = (c: ReturnType<typeof preflight>) => Object.fromEntries(c.map((x) => [x.key, x.state]));

describe("the checklist before posting", () => {
  it("flags a file-name title, no cover, no genre and too few tags", () => {
    const c = preflight({ path: "/m/Neon_Rain_final_v3.wav", name: "Neon_Rain_final_v3", tags: ["one"] }, cfg, ".wav");
    expect(states(c)).toMatchObject({ title: "warn", cover: "warn", genre: "warn", tags: "warn", description: "tip", file: "ok" });
    expect(needsLook(c)).toBe(4);
  });
  it("is happy with a tidy, tagged mix and the default cover", () => {
    const c = preflight({ path: "/m/a.wav", name: "Neon Rain", genre: "Techno", tags: ["a", "b", "c"] },
      { default_artwork_path: "/cover.png", default_description: "Made this week." }, ".wav");
    expect(needsLook(c)).toBe(0);
    expect(c.find((x) => x.key === "cover")!.say).toMatch(/default cover/);
  });
  it("suggests a lossless file over an MP3", () => {
    expect(states(preflight({ path: "/m/a.mp3", name: "A" }, cfg, ".mp3")).file).toBe("tip");
  });
  it("reads the level: clipping, quiet and fine", () => {
    expect(levelCheck({ peak_db: 0, rms_db: -8 })!.state).toBe("warn");
    expect(levelCheck({ peak_db: -6, rms_db: -30 })!.state).toBe("tip");
    expect(levelCheck({ peak_db: -1.2, rms_db: -11 })!.state).toBe("ok");
    expect(levelCheck(null)).toBeNull();
  });
});
