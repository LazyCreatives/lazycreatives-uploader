import { describe, expect, it } from "vitest";
import { moreToShow, SHOW_PAGE } from "./paging";

describe("moreToShow", () => {
  it("shows no button when the whole list fits", () => {
    expect(moreToShow(0, SHOW_PAGE)).toBeNull();
    expect(moreToShow(12, SHOW_PAGE)).toBeNull();
    expect(moreToShow(200, SHOW_PAGE)).toBeNull();
  });

  it("offers the next 200 and says how many are left", () => {
    expect(moreToShow(7502, 200)).toEqual({ next: 200, left: 7302 });
    expect(moreToShow(7502, 7400)).toEqual({ next: 102, left: 102 });
    expect(moreToShow(201, 200)).toEqual({ next: 1, left: 1 });
  });

  it("pages through a huge list to the end", () => {
    let shown = SHOW_PAGE, presses = 0;
    for (let m = moreToShow(10_000, shown); m; m = moreToShow(10_000, shown)) { shown += m.next; presses++; }
    expect(shown).toBe(10_000);
    expect(presses).toBe(49);
  });
});
