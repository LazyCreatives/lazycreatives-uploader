import { describe, expect, it } from "vitest";
import { clickOpensRow } from "../src/screens/Playlists";

describe("clicking a song in a playlist", () => {
  const row = document.createElement("div");
  row.innerHTML = `<span class="pl-grip"><svg></svg></span><span class="art"></span>
    <div class="row__main"><div class="row__title">SKEPTA - NASTY BH</div></div>
    <button class="play"><svg></svg></button><span class="col-act"><button class="x"><svg></svg></button></span>`;
  const q = (s: string) => row.querySelector(s)!;

  it("opens the track from its title, cover or the row itself", () => {
    expect(clickOpensRow(q(".row__title"), row)).toBe(true);
    expect(clickOpensRow(q(".art"), row)).toBe(true);
    expect(clickOpensRow(row, row)).toBe(true);
  });

  it("leaves the drag grip, play and take-out buttons to do their own job", () => {
    expect(clickOpensRow(q(".pl-grip svg"), row)).toBe(false);
    expect(clickOpensRow(q(".play svg"), row)).toBe(false);
    expect(clickOpensRow(q(".x"), row)).toBe(false);
    expect(clickOpensRow(document.createElement("span"), row)).toBe(false);
  });
});
