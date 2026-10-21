import { describe, expect, it } from "vitest";
import { folderTrackCount, tracksByProject } from "./trackFilter";

describe("folder track counts", () => {
  const tracks = [
    { project_id: "a" }, { project_id: "a" }, { project_id: "b" }, { project_id: null }, { project_id: undefined }, { project_id: "c" },
  ];
  const by = tracksByProject(tracks);

  it("counts the tracks of each project once", () => {
    expect(by.get("a")).toBe(2);
    expect(by.get("b")).toBe(1);
    expect(by.get("c")).toBe(1);
    expect(by.size).toBe(3);
  });

  it("adds up a folder's projects, like scanning every track would", () => {
    const scan = (ids: string[]) => tracks.filter((t) => !!t.project_id && new Set(ids).has(t.project_id)).length;
    for (const ids of [["a"], ["a", "b"], ["a", "a"], ["gone"], [], ["a", "b", "c", "gone"]]) {
      expect(folderTrackCount(ids, by)).toBe(scan(ids));
    }
  });

  it("stays quick with 10,000 folders over 10,000 tracks", () => {
    const many = Array.from({ length: 10_000 }, (_, i) => ({ project_id: `p${i % 50}` }));
    const t0 = performance.now();
    const m = tracksByProject(many);
    let total = 0;
    for (let i = 0; i < 10_000; i++) total += folderTrackCount([`p${i % 50}`, `p${(i * 7) % 50}`], m);
    expect(total).toBeGreaterThan(0);
    expect(performance.now() - t0).toBeLessThan(500);
  });
});
