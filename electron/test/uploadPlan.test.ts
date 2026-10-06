import { describe, expect, it } from "vitest";
import { fmtRelease, lastLookTitle, localInput, mixTags, releaseProblem, tomorrowSameHour } from "../src/screens/Upload";
import { parseTags } from "../src/components/ui";

describe("tags", () => {
  it("splits on commas only, keeps spaces inside a tag, drops repeats", () => {
    expect(parseTags("lo-fi, late night ,, Chill, chill")).toEqual(["lo-fi", "late night", "Chill"]);
    expect(parseTags("  ")).toEqual([]);
  });
  it("adds the tempo to the default tags instead of replacing them", () => {
    expect(mixTags(["house", "deep"], 124)).toEqual(["house", "deep", "124 BPM"]);
    expect(mixTags(["house"], null)).toEqual(["house"]);
    expect(mixTags([], 90)).toEqual(["90 BPM"]);
    expect(mixTags(["124 bpm"], 124)).toEqual(["124 bpm"]);
  });
});

describe("go public later", () => {
  const now = new Date(2026, 9, 6, 14, 37);
  it("starts at this hour tomorrow", () => {
    expect(tomorrowSameHour(now)).toBe("2026-10-07T14:00");
    expect(localInput(now)).toBe("2026-10-06T14:37");
  });
  it("refuses an empty or past time, and only when the box is ticked", () => {
    expect(releaseProblem(false, "", now)).toBeNull();
    expect(releaseProblem(true, "", now)).toMatch(/Pick when/);
    expect(releaseProblem(true, "2026-10-06T14:00", now)).toMatch(/passed/);
    expect(releaseProblem(true, "2026-10-07T14:00", now)).toBeNull();
  });
  it("shows the time in words", () => {
    expect(fmtRelease("2026-10-07T14:00")).toMatch(/7/);
  });
});

describe("last look", () => {
  it("names how many, as what, and the account", () => {
    expect(lastLookTitle(3, ["public", "public", "public"], "robert", null))
      .toBe("Post 3 mixes to SoundCloud as Public on robert");
    expect(lastLookTitle(1, ["private"], null, null)).toBe("Post 1 mix to SoundCloud as Private");
    expect(lastLookTitle(2, ["public", "private"], "robert", null)).toBe("Post 2 mixes to SoundCloud on robert");
    expect(lastLookTitle(2, ["private", "private"], "robert", "Wed 7 Oct, 14:00"))
      .toBe("Post 2 mixes to SoundCloud on robert, going public Wed 7 Oct, 14:00");
  });
});
