import { describe, expect, it, vi } from "vitest";
import type { UploadRow } from "./types";

vi.mock("./api", () => ({ makeApi: () => ({}), openExternal: vi.fn(), revealPath: vi.fn(), saveRenderedCover: vi.fn() }));

const row = (id: number, timestamp: string, extra: Partial<UploadRow> = {}): UploadRow => ({
  id, title: `Mix ${id}`, file_path: `/m/${id}.wav`, file_hash: null, size: 1, sharing: "public", status: "uploaded",
  sc_track_id: null, permalink_url: null, account: null, error: null, timestamp, ...extra,
});

describe("History's day headings and Try again", () => {
  it("heads each new day once, with how many posts it holds", async () => {
    const { dayHeadings } = await import("./screens/History");
    const now = new Date(2026, 9, 21, 18, 0);
    const rows = [row(1, "2026-10-21 09:00:00"), row(2, "2026-10-21 08:00:00"), row(3, "2026-10-20 23:00:00"), row(4, "2026-10-14 10:00:00")];
    const h = dayHeadings(rows, now);
    expect([...h.keys()]).toEqual([1, 3, 4]);
    expect(h.get(1)).toEqual({ day: "Today", n: 2 });
    expect(h.get(3)).toEqual({ day: "Yesterday", n: 1 });
    expect(h.get(4)?.n).toBe(1);
  });
  it("works out the headings for 10,000 posts in well under a second", async () => {
    const { dayHeadings } = await import("./screens/History");
    const t0 = new Date(2026, 9, 21, 18, 0).getTime();
    const rows = Array.from({ length: 10_000 }, (_, i) => row(i, new Date(t0 - i * 3.6e6).toISOString()));
    const start = performance.now();
    const h = dayHeadings(rows, new Date(t0));
    expect(h.size).toBeGreaterThan(400);
    expect(performance.now() - start).toBeLessThan(1000);
  });
  it("offers Try again only until the same file has gone up since", async () => {
    const { retryableIds } = await import("./screens/History");
    const rows = [  // newest first
      row(5, "2026-10-21 10:00:00", { status: "error", file_path: "/m/b.wav" }),
      row(4, "2026-10-21 09:00:00", { status: "uploaded", file_path: "/m/a.wav", file_hash: "h1" }),
      row(3, "2026-10-21 08:00:00", { status: "error", file_path: "/m/a.wav" }),
      row(2, "2026-10-21 07:00:00", { status: "error", file_path: "/m/c.wav", file_hash: "h1" }),
      row(1, "2026-10-21 06:00:00", { status: "error", file_path: "/m/d.wav" }),
    ];
    expect([...retryableIds(rows)].sort()).toEqual([1, 5]);
  });
});
