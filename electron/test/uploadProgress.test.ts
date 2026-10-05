import { describe, expect, it } from "vitest";
import { foldUpload, initialUpload, queueUpload, type UploadState } from "../src/useProgress";
import type { ProgressEvent } from "../src/types";

const run = (s: UploadState, evs: ProgressEvent[]) => evs.reduce(foldUpload, s);

describe("each mix's own progress", () => {
  it("goes waiting → uploading → posted / skipped / failed", () => {
    let s = queueUpload(initialUpload, ["/a.wav", "/b.wav", "/c.wav", "/d.wav"], false);
    expect(Object.values(s.items).every((i) => i.phase === "waiting")).toBe(true);
    s = run(s, [
      { type: "upload_start", total: 4, timestamp: "t" },
      { type: "track_start", index: 0, name: "a", path: "/a.wav", total: 4 },
      { type: "track_progress", index: 0, name: "a", path: "/a.wav", sent: 50, size: 200 },
    ]);
    expect(s.items["/a.wav"]).toMatchObject({ phase: "uploading", sent: 50, size: 200 });
    expect(s.items["/b.wav"].phase).toBe("waiting");
    s = run(s, [
      { type: "track_done", index: 0, name: "a", path: "/a.wav", permalink_url: "https://sc/a" },
      { type: "track_start", index: 1, name: "b", path: "/b.wav", total: 4 },
      { type: "track_skipped", index: 1, name: "b", path: "/b.wav", reason: "duplicate" },
      { type: "track_start", index: 2, name: "c", path: "/c.wav", total: 4 },
      { type: "track_error", index: 2, name: "c", path: "/c.wav", error: "[Errno 2] No such file", reason: "The file was moved or deleted." },
      { type: "upload_done", ok_count: 1, error_count: 1, skipped_count: 1, cancelled: true },
    ]);
    expect(s.items["/a.wav"]).toMatchObject({ phase: "posted", url: "https://sc/a" });
    expect(s.items["/b.wav"].phase).toBe("skipped");
    expect(s.items["/c.wav"]).toMatchObject({ phase: "failed", reason: "The file was moved or deleted.", error: "[Errno 2] No such file" });
    expect(s.items["/d.wav"]).toBeUndefined();  // stopped before its turn: back to normal
    expect(s).toMatchObject({ done: true, completed: 1, skipped: 1, errors: 1 });
  });

  it("Try again on one mix keeps how the others went", () => {
    let s = queueUpload(initialUpload, ["/a.wav", "/c.wav"], false);
    s = run(s, [
      { type: "upload_start", total: 2, timestamp: "t" },
      { type: "track_done", index: 0, name: "a", path: "/a.wav", permalink_url: null },
      { type: "track_error", index: 1, name: "c", path: "/c.wav", error: "x" },
      { type: "upload_done", ok_count: 1, error_count: 1, skipped_count: 0 },
    ]);
    expect(s.items["/c.wav"].reason).toBe("Something went wrong.");  // older sidecar: no reason
    s = queueUpload(s, ["/c.wav"], true);
    expect(s.items["/a.wav"].phase).toBe("posted");
    expect(s.items["/c.wav"].phase).toBe("waiting");
    expect(s.done).toBe(false);
    s = run(s, [
      { type: "upload_start", total: 1, timestamp: "t" },
      { type: "track_done", index: 0, name: "c", path: "/c.wav", permalink_url: null },
    ]);
    expect(s.items["/a.wav"].phase).toBe("posted");
    expect(s.items["/c.wav"].phase).toBe("posted");
    expect(s.total).toBe(1);
  });

  it("a new post starts a clean list", () => {
    const s = queueUpload({ ...initialUpload, items: { "/x.wav": { phase: "failed", sent: 0, size: 0 } } }, ["/y.wav"], false);
    expect(Object.keys(s.items)).toEqual(["/y.wav"]);
  });

  it("falls back to the name when an event has no path", () => {
    const s = foldUpload(initialUpload, { type: "track_start", index: 0, name: "Mix", total: 1 });
    expect(s.items["Mix"].phase).toBe("uploading");
  });
});
