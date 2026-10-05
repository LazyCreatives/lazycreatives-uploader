import { describe, it, expect } from "vitest";
import { NO_FILTERS, applyFilters, isFiltered, pickerOptions, privacyCounts, sortTracks } from "../src/trackFilter";
import type { Track } from "../src/types";

function track(over: Partial<Track>): Track {
  return {
    id: 1, title: "t", description: "", sharing: "public", genre: "", tags: [],
    permalink_url: null, artwork_url: null, duration: null, playback_count: null,
    created_at: null, ...over,
  };
}

const list: Track[] = [
  track({ id: 1, title: "Tunnel Vision", genre: "DnB", daw: "flstudio", bpm: 174, project_match: "Tunnel Vision",
    backups: { count: 2, first_backup: null, last_backup: null, archived_bytes: null, file_count: null, verified: true, verified_at: null, status: "ok" },
    seo: { score: 45, grade: "D", checks: [], suggestions: [], suggested_tags: [] }, playback_count: 10, created_at: "2026-10-01T10:00:00Z" }),
  track({ id: 2, title: "Velvet Room", genre: "Hip hop", daw: "ableton", bpm: 92, project_match: "Velvet Room", sharing: "private",
    missing_count: 3, tags: ["late night"], seo: { score: 80, grade: "B", checks: [], suggestions: [], suggested_tags: [] },
    playback_count: 300, created_at: "2026-10-03T10:00:00Z" }),
  track({ id: 3, title: "Warehouse Set", genre: "Techno", playback_count: null, created_at: "2026-09-01T10:00:00Z" }),
];
const ids = (ts: Track[]) => ts.map((t) => t.id);

describe("Your tracks filters", () => {
  it("search forgives typos and finds project names, DAWs and tags", () => {
    expect(ids(applyFilters(list, { ...NO_FILTERS, q: "tunel" }))).toEqual([1]);
    expect(ids(applyFilters(list, { ...NO_FILTERS, q: "fl studio" }))).toEqual([1]);
    expect(ids(applyFilters(list, { ...NO_FILTERS, q: "late night" }))).toEqual([2]);
    expect(ids(applyFilters(list, { ...NO_FILTERS, q: "zzzz" }))).toEqual([]);
  });

  it("DAW, genre, tempo, project and score pickers narrow the list", () => {
    expect(ids(applyFilters(list, { ...NO_FILTERS, daw: "ableton" }))).toEqual([2]);
    expect(ids(applyFilters(list, { ...NO_FILTERS, genre: "Techno" }))).toEqual([3]);
    expect(ids(applyFilters(list, { ...NO_FILTERS, bpm: "170" }))).toEqual([1]);
    expect(ids(applyFilters(list, { ...NO_FILTERS, project: "unlinked" }))).toEqual([3]);
    expect(ids(applyFilters(list, { ...NO_FILTERS, project: "backedup" }))).toEqual([1]);
    expect(ids(applyFilters(list, { ...NO_FILTERS, project: "missing" }))).toEqual([2]);
    expect(ids(applyFilters(list, { ...NO_FILTERS, score: "low" }))).toEqual([1]);
    expect(ids(applyFilters(list, { ...NO_FILTERS, score: "good" }))).toEqual([2]);
  });

  it("privacy counts follow the other filters", () => {
    expect(privacyCounts(list, NO_FILTERS)).toEqual({ all: 3, public: 2, private: 1 });
    expect(privacyCounts(list, { ...NO_FILTERS, privacy: "private", project: "linked" })).toEqual({ all: 2, public: 1, private: 1 });
  });

  it("pickers only offer what your tracks have", () => {
    expect(pickerOptions(list)).toEqual({ daws: ["ableton", "flstudio"], genres: ["DnB", "Hip hop", "Techno"] });
  });

  it("knows when anything is filtered", () => {
    expect(isFiltered(NO_FILTERS)).toBe(false);
    expect(isFiltered({ ...NO_FILTERS, bpm: "120" })).toBe(true);
  });
});

describe("Your tracks sorting", () => {
  it("puts empty values last either way round", () => {
    expect(ids(sortTracks(list, "plays", true))).toEqual([2, 1, 3]);
    expect(ids(sortTracks(list, "plays", false))).toEqual([1, 2, 3]);
    expect(ids(sortTracks(list, "project", false))).toEqual([1, 2, 3]);
    expect(ids(sortTracks(list, "project", true))).toEqual([2, 1, 3]);
  });
  it("sorts newest first by date", () => {
    expect(ids(sortTracks(list, "date", true))).toEqual([2, 1, 3]);
  });
});
