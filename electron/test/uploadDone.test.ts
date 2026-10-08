import { describe, expect, it } from "vitest";
import { doneLine, postButtonLook } from "../src/screens/Upload";

describe("the Post button", () => {
  it("asks for a tick, outlined, until a mix is ticked", () => {
    expect(postButtonLook(0, false)).toEqual({ kind: "ghost", label: "Tick mixes to post" });
  });
  it("turns SoundCloud orange once something will post", () => {
    expect(postButtonLook(3, false)).toEqual({ kind: "sc", label: "Post 3 to SoundCloud" });
    expect(postButtonLook(3, true)).toEqual({ kind: "ghost", label: "Posting…" });
  });
});

describe("the line that ends a post", () => {
  it("says how many went up, and that none went up twice", () => {
    expect(doneLine(3, 0, 0)).toBe("3 mixes are up on SoundCloud. None went up twice.");
    expect(doneLine(1, 0, 0)).toBe("1 mix is up on SoundCloud. Just the once.");
  });
  it("says which were already there", () => {
    expect(doneLine(2, 1, 0)).toBe("2 mixes are up on SoundCloud. 1 was already there, so it wasn’t posted again.");
    expect(doneLine(0, 2, 0)).toBe("Those mixes were already on SoundCloud, so nothing went up twice.");
  });
  it("is plain when some failed", () => {
    expect(doneLine(2, 0, 1)).toBe("2 mixes posted, 1 didn’t go up. The reason is on its row.");
    expect(doneLine(0, 0, 2)).toBe("Those 2 mixes didn’t go up. The reason is on their rows.");
    expect(doneLine(0, 0, 1)).toBe("That mix didn’t go up. The reason is on its row.");
  });
});
