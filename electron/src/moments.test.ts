import { afterEach, describe, expect, it, vi } from "vitest";
import { glowRow, isFirstPost, newlyPosted, playsGainLine, sinceDay } from "./moments";
import { doneLine } from "./screens/Upload";
import { fmtCount } from "./components/ui";
import type { ItemState } from "./useProgress";

const st = (phase: ItemState["phase"]): ItemState => ({ phase, sent: 0, size: 0 });

describe("the row that just went up", () => {
  it("is only a mix that turned posted since the last look", () => {
    const before = { a: st("uploading"), b: st("posted"), c: st("waiting") };
    const after = { a: st("posted"), b: st("posted"), c: st("uploading"), d: st("posted") };
    expect(newlyPosted(before, after)).toEqual(["a", "d"]);
  });
  it("doesn't glow again when nothing changed (a search, Check folders)", () => {
    const items = { a: st("posted"), b: st("failed") };
    expect(newlyPosted(items, { ...items })).toEqual([]);
  });
});

describe("a row that just changed", () => {
  afterEach(() => { vi.useRealTimers(); document.body.innerHTML = ""; });
  it("glows for the glow's 2s, then goes back to how it was", () => {
    vi.useFakeTimers();
    document.body.innerHTML = `<div data-nav-key="42" class="row"></div>`;
    expect(glowRow("42")).toBe(true);
    const row = document.querySelector("[data-nav-key='42']")!;
    expect(row.classList.contains("nav-came-from")).toBe(true);
    vi.advanceTimersByTime(2000);
    expect(row.classList.contains("nav-came-from")).toBe(false);
  });
  it("does nothing when the row isn't on screen", () => {
    expect(glowRow("missing")).toBe(false);
  });
});

describe("the first post ever", () => {
  it("is first only when nothing went up from here or anywhere else", () => {
    expect(isFirstPost({ uploaded_count: 0, sc_track_count: 0 })).toBe(true);
    expect(isFirstPost({ uploaded_count: 0, sc_track_count: null })).toBe(true);
    expect(isFirstPost({ uploaded_count: 0, sc_track_count: 12 })).toBe(false);  // posted elsewhere
    expect(isFirstPost({ uploaded_count: 3, sc_track_count: 0 })).toBe(false);
    expect(isFirstPost(null)).toBe(false);  // couldn't ask: the usual line
  });
  it("gets its own line when it all went up", () => {
    expect(doneLine(1, 0, 0, true)).toBe("Your first mix is up on SoundCloud.");
    expect(doneLine(3, 0, 0, true)).toBe("Your first 3 mixes are up on SoundCloud.");
  });
  it("keeps the usual line when something failed or was skipped", () => {
    expect(doneLine(1, 0, 1, true)).toBe(doneLine(1, 0, 1));
    expect(doneLine(0, 0, 1, true)).toBe("That mix didn’t go up. The reason is on its row.");
    expect(doneLine(2, 1, 0, true)).toBe(doneLine(2, 1, 0));
    expect(doneLine(1, 0, 0)).toBe("1 mix is up on SoundCloud. Just the once.");
  });
});

describe("plays gained lately", () => {
  const tue = new Date(2026, 9, 20, 15, 0);   // Tuesday 20 Oct 2026, afternoon
  it("names the day plainly", () => {
    expect(sinceDay("2026-10-19", tue)).toBe("yesterday");
    expect(sinceDay("2026-10-15", tue)).toBe("Thursday");
    expect(sinceDay("2026-10-14", tue)).toBe("Wednesday");
    expect(sinceDay("2026-10-13", tue)).toBe(null);   // a week back: "Tuesday" would be today
    expect(sinceDay("2026-10-20", tue)).toBe(null);   // today
    expect(sinceDay("soon", tue)).toBe(null);
  });
  it("says the gain, or nothing", () => {
    expect(playsGainLine({ total: 500, gain: 38, since: "2026-10-15" }, fmtCount, tue)).toBe("+38 plays since Thursday");
    expect(playsGainLine({ total: 5, gain: 1, since: "2026-10-19" }, fmtCount, tue)).toBe("+1 play since yesterday");
    expect(playsGainLine({ total: 5, gain: 0, since: "2026-10-19" }, fmtCount, tue)).toBe(null);
    expect(playsGainLine(null, fmtCount, tue)).toBe(null);
  });
  it("writes a huge gain the way Home writes numbers", () => {
    expect(playsGainLine({ total: 9e6, gain: 1234567, since: "2026-10-18" }, fmtCount, tue))
      .toBe(`+${fmtCount(1234567)} plays since Sunday`);
  });
});
