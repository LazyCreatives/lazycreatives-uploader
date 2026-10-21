import { describe, expect, it } from "vitest";
import { fmtCount, fmtDuration, missingSamples } from "./components/ui";

// Digit grouping follows the computer's own settings, so these allow any separator.
const grouped = (s: string, ...parts: string[]) => expect(s).toMatch(new RegExp(`^${parts.join("\\D")}$`));

describe("numbers and lengths in Uploader", () => {
  it("groups big counts the way the computer does", () => {
    grouped(fmtCount(1234567), "1", "234", "567");
    grouped(fmtCount(9999), "9", "999");
    expect(fmtCount(42)).toBe("42");
    expect(fmtCount(null)).toBe("—");
  });
  it("reads a song past the hour as h:mm:ss", () => {
    expect(fmtDuration(212)).toBe("3:32");
    expect(fmtDuration(3600)).toBe("1:00:00");
    expect(fmtDuration(14523)).toBe("4:02:03");
    expect(fmtDuration(null)).toBe("");
  });
  it("leads missing samples with the word that matters and caps a huge count", () => {
    expect(missingSamples(1)).toBe("Missing 1 sample");
    expect(missingSamples(12)).toBe("Missing 12 samples");
    expect(missingSamples(999)).toBe("Missing 999 samples");
    expect(missingSamples(12345)).toBe("Missing 999+ samples");
  });
});
