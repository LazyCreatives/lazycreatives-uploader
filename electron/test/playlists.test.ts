import { describe, expect, it } from "vitest";
import { fmtLength, mainGenre, moveItem, playlistsWith, sideLabel } from "../src/playlists";
import type { Playlist } from "../src/types";

describe("playlists", () => {
  it("moves a track up and down", () => {
    expect(moveItem([1, 2, 3, 4], 0, 2)).toEqual([2, 3, 1, 4]);
    expect(moveItem([1, 2, 3, 4], 3, 0)).toEqual([4, 1, 2, 3]);
    expect(moveItem([1, 2, 3], 1, 1)).toEqual([1, 2, 3]);
    expect(moveItem([1, 2, 3], 1, 99)).toEqual([1, 3, 2]);
  });

  it("numbers Sleeve playlists by side", () => {
    expect([0, 1, 2, 3, 4].map((i) => sideLabel(i, 5))).toEqual(["A1", "A2", "A3", "B1", "B2"]);
    expect(sideLabel(1, 3)).toBe("2");    // too short for sides
    expect(sideLabel(29, 30)).toBe("30"); // too long for sides
  });

  it("says how long a playlist is in plain words", () => {
    expect(fmtLength(0)).toBe("");
    expect(fmtLength(42)).toBe("42 sec");
    expect(fmtLength(48 * 60)).toBe("48 min");
    expect(fmtLength(72 * 60)).toBe("1 hr 12 min");
    expect(fmtLength(120 * 60)).toBe("2 hr");
  });

  it("finds the main genre and the playlists a track is in", () => {
    expect(mainGenre([{ genre: "House" }, { genre: "Techno" }, { genre: "House" }, { genre: "" }])).toBe("House");
    expect(mainGenre([])).toBeNull();
    const p = (id: number, ids: number[]) => ({ id, tracks: ids.map((i) => ({ id: i })) }) as unknown as Playlist;
    expect(playlistsWith(7, [p(1, [7, 8]), p(2, [8]), p(3, [7])]).map((x) => x.id)).toEqual([1, 3]);
  });
});
