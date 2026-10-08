import { describe, expect, it } from "vitest";
import { needsSignIn, postEndLine } from "./Upload";
import { foldUpload, initialUpload, queueUpload } from "../useProgress";

describe("a post that stops early", () => {
  it("says SoundCloud's wait with the real number and how many weren't sent", () => {
    let u = queueUpload(initialUpload, ["/a.wav", "/b.wav", "/c.wav"], false);
    u = foldUpload(u, { type: "upload_start", total: 3, timestamp: "" });
    u = foldUpload(u, { type: "track_start", index: 0, name: "a", path: "/a.wav", total: 3 });
    u = foldUpload(u, { type: "track_error", index: 0, name: "a", path: "/a.wav", error: "429",
      reason: "SoundCloud asked us to wait 3 minutes." });
    u = foldUpload(u, { type: "upload_done", ok_count: 0, error_count: 1, skipped_count: 0,
      stopped: "rate_limit", stop_note: "SoundCloud asked us to wait 3 minutes.", wait_seconds: 180, not_sent: 2 });
    expect(postEndLine(u)).toBe("SoundCloud asked us to wait 3 minutes. 2 mixes weren’t sent. Post them again then.");
    expect(Object.keys(u.items)).toEqual(["/a.wav"]);  // the two never sent go back to how they were
  });

  it("offers Sign in again when SoundCloud signed you out", () => {
    expect(needsSignIn("SoundCloud signed you out. Sign in again.")).toBe(true);
    expect(needsSignIn("Couldn't reach SoundCloud. Check your internet.")).toBe(false);
    const line = postEndLine({ ...initialUpload, total: 2, stopped: "signed_out",
      stopNote: "SoundCloud signed you out. Sign in again.", notSent: 1 });
    expect(line).toBe("SoundCloud signed you out. Sign in again. 1 mix wasn’t sent.");
  });

  it("treats Stop in the middle of a mix as not posted, not as a failure", () => {
    let u = queueUpload(initialUpload, ["/a.wav"], false);
    u = foldUpload(u, { type: "upload_start", total: 1, timestamp: "" });
    u = foldUpload(u, { type: "track_start", index: 0, name: "a", path: "/a.wav", total: 1 });
    u = foldUpload(u, { type: "track_error", index: 0, name: "a", path: "/a.wav", error: "Stopped", stopped: true });
    u = foldUpload(u, { type: "upload_done", ok_count: 0, error_count: 0, skipped_count: 0, cancelled: true });
    expect(u.errors).toBe(0);
    expect(u.items["/a.wav"]).toBeUndefined();
    expect(postEndLine(u)).toBe("Stopped. It wasn’t posted.");
  });
});
