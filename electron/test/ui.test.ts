import { describe, expect, it } from "vitest";
import { fmtBytes, fmtDuration } from "../src/components/ui";

describe("fmtBytes", () => {
  it("formats common sizes", () => {
    expect(fmtBytes(0)).toBe("0 B");
    expect(fmtBytes(2048)).toBe("2 KB");
    expect(fmtBytes(5 * 1024 * 1024)).toBe("5.0 MB");
  });
});

describe("fmtDuration", () => {
  it("formats seconds as m:ss", () => {
    expect(fmtDuration(0)).toBe("");
    expect(fmtDuration(75)).toBe("1:15");
    expect(fmtDuration(5)).toBe("0:05");
  });
});
