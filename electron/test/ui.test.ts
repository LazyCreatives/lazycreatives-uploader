import { describe, expect, it } from "vitest";
import { fmtBytes, fmtCount, fmtDuration } from "../src/components/ui";

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

describe("worst-case numbers", () => {
  it("shows hour-long sets as h:mm:ss", () => {
    expect(fmtDuration(3600)).toBe("1:00:00");
    expect(fmtDuration(14523)).toBe("4:02:03");
    expect(fmtDuration(3599)).toBe("59:59");
  });
  it("switches to TB for multi-terabyte totals", () => {
    expect(fmtBytes(3 * 1024 ** 4)).toBe("3.0 TB");
  });
  it("groups digits in counts", () => {
    expect(fmtCount(12345)).toBe((12345).toLocaleString());
    expect(fmtCount(null)).toBe("—");
  });
});
