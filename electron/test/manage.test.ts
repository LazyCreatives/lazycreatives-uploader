import { describe, it, expect } from "vitest";
import { mergeEnriched } from "../src/screens/Manage";
import type { Track } from "../src/types";

function track(over: Partial<Track>): Track {
  return {
    id: 1, title: "t", description: "", sharing: "public", genre: "", tags: [],
    permalink_url: null, artwork_url: null, duration: null, playback_count: null,
    created_at: null, ...over,
  };
}

describe("mergeEnriched", () => {
  it("carries dupe_* from the previous row onto a re-enriched track", () => {
    // an edit/bulk op returns an enriched track WITHOUT dupe fields...
    const prev = track({ dupe_group: 42, dupe_count: 2, dupe_keeper: true });
    const next = track({ genre: "Dubstep" }); // re-enriched, dupe_* undefined
    const merged = mergeEnriched(prev, next);
    expect(merged.genre).toBe("Dubstep");      // new fields win
    expect(merged.dupe_group).toBe(42);          // dupe state preserved
    expect(merged.dupe_count).toBe(2);
    expect(merged.dupe_keeper).toBe(true);
  });

  it("leaves non-duplicate rows without dupe fields", () => {
    const merged = mergeEnriched(track({}), track({ sharing: "private" }));
    expect(merged.sharing).toBe("private");
    expect(merged.dupe_count).toBeUndefined();
  });
});
