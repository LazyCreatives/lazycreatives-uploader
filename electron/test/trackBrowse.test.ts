import { describe, it, expect } from "vitest";
import { NO_FILTERS, applyFilters, describeFilters, yearOf } from "../src/trackFilter";

describe("Your tracks: year posted and smart crate names", () => {
  const tracks = [
    { id: 1, title: "A", genre: "House", created_at: "2024-03-01T10:00:00Z", sharing: "public", tags: [] },
    { id: 2, title: "B", genre: "", created_at: null, sharing: "private", tags: [] },
  ] as any[];
  it("reads the year a track was posted", () => {
    expect(yearOf(tracks[0])).toBe("2024");
    expect(yearOf(tracks[1])).toBe("");
  });
  it("filters by year and by no genre", () => {
    expect(applyFilters(tracks, { ...NO_FILTERS, year: "2024" }).map((t) => t.id)).toEqual([1]);
    expect(applyFilters(tracks, { ...NO_FILTERS, genre: "-" }).map((t) => t.id)).toEqual([2]);
  });
  it("suggests a name from the filters", () => {
    expect(describeFilters({ ...NO_FILTERS, genre: "House", privacy: "private" })).toBe("House · Private");
    expect(describeFilters(NO_FILTERS)).toBe("Everything");
  });
});
