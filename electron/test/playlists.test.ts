import { describe, expect, it } from "vitest";
import { detailChanges, fmtLength, mainGenre, moveItem, playlistPlace, playlistsWith, songOnPlaylist } from "../src/playlists";
import type { Playlist } from "../src/types";

describe("playlists", () => {
  it("sends only the playlist details that changed, never its songs", () => {
    const p = { id: 1, title: "Late night", description: "", genre: "House", tags: ["deep"], sharing: "public", tracks: [] } as unknown as Playlist;
    const same = { title: "Late night", description: "", genre: "House", tags: ["deep"], sharing: "public" as const };
    expect(detailChanges(p, same)).toEqual({});
    expect(detailChanges(p, { ...same, title: "  Late night drives ", tags: ["deep", "140"] }))
      .toEqual({ title: "Late night drives", tags: ["deep", "140"] });
    expect(detailChanges(p, { ...same, title: "   " })).toEqual({});  // a blank name is never sent
    expect(detailChanges(p, { ...same, genre: "", sharing: "private" })).toEqual({ genre: "", sharing: "private" });
  });

  it("opens a song over its playlist, and closing goes back to the playlist", () => {
    expect(playlistPlace(songOnPlaylist("12", "345"))).toEqual({ open: "12", track: "345" });
    expect(playlistPlace("12")).toEqual({ open: "12", track: null });
    expect(playlistPlace("new")).toEqual({ open: "new", track: null });
    expect(playlistPlace(null)).toEqual({ open: null, track: null });
  });

  it("moves a track up and down", () => {
    expect(moveItem([1, 2, 3, 4], 0, 2)).toEqual([2, 3, 1, 4]);
    expect(moveItem([1, 2, 3, 4], 3, 0)).toEqual([4, 1, 2, 3]);
    expect(moveItem([1, 2, 3], 1, 1)).toEqual([1, 2, 3]);
    expect(moveItem([1, 2, 3], 1, 99)).toEqual([1, 3, 2]);
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
