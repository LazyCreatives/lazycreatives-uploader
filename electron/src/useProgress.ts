import { useEffect, useRef, useState } from "react";
import type { ProgressEvent } from "./types";

export interface ScanState { active: boolean; done: number; total: number; }

// Where one mix has got in a post: waiting its turn, going up, or finished one way or another.
export type ItemPhase = "waiting" | "uploading" | "posted" | "skipped" | "failed";
export interface ItemState {
  phase: ItemPhase;
  sent: number; size: number;   // bytes sent so far while uploading
  reason?: string;              // failed: a few plain words; skipped: why
  error?: string;               // failed: the full message
  url?: string | null;          // posted: its SoundCloud link
}

export interface UploadState {
  active: boolean; done: boolean; total: number;
  completed: number; errors: number; skipped: number;
  current: string | null; sent: number; size: number; cancelled: boolean;
  lastUrl: string | null;
  items: Record<string, ItemState>;  // keyed by file path (or name, from an older sidecar)
}

const initialScan: ScanState = { active: false, done: 0, total: 0 };
export const initialUpload: UploadState = {
  active: false, done: false, total: 0, completed: 0, errors: 0, skipped: 0,
  current: null, sent: 0, size: 0, cancelled: false, lastUrl: null, items: {},
};

// Set the mixes about to be posted to "Waiting". A fresh post starts a clean list;
// trying one mix again keeps how the others went.
export function queueUpload(u: UploadState, paths: string[], keepOthers: boolean): UploadState {
  const items: Record<string, ItemState> = keepOthers ? { ...u.items } : {};
  for (const p of paths) items[p] = { phase: "waiting", sent: 0, size: 0 };
  return { ...initialUpload, items };
}

// Fold one live event into the upload view-state (no React in here, so it is easy to test).
export function foldUpload(u: UploadState, ev: ProgressEvent): UploadState {
  const key = "path" in ev && ev.path ? ev.path : "name" in ev ? ev.name : "";
  const setItem = (patch: Partial<ItemState>) => ({
    ...u.items, [key]: { ...(u.items[key] ?? { phase: "waiting", sent: 0, size: 0 }), ...patch },
  });
  switch (ev.type) {
    case "upload_start":
      // the list of mixes is only cleared by a new post (queueUpload)
      return { ...initialUpload, active: true, total: ev.total, items: u.items };
    case "track_start":
      return { ...u, active: true, current: ev.name, sent: 0, size: 0,
        items: setItem({ phase: "uploading", sent: 0, size: 0 }) };
    case "track_progress":
      return { ...u, sent: ev.sent, size: ev.size,
        items: setItem({ phase: "uploading", sent: ev.sent, size: ev.size }) };
    case "track_done":
      return { ...u, completed: u.completed + 1, lastUrl: ev.permalink_url,
        items: setItem({ phase: "posted", url: ev.permalink_url }) };
    case "track_skipped":
      return { ...u, skipped: u.skipped + 1,
        items: setItem({ phase: "skipped", reason: ev.note || ev.reason, url: ev.permalink_url ?? null }) };
    case "track_error":
      return { ...u, errors: u.errors + 1,
        items: setItem({ phase: "failed", reason: ev.reason || "Something went wrong.", error: ev.error }) };
    case "upload_done": {
      // anything still waiting (a stopped post) goes back to how it was
      const items = Object.fromEntries(Object.entries(u.items).filter(([, it]) => it.phase !== "waiting"));
      return {
        ...u, active: false, done: true, current: null,
        completed: ev.ok_count, errors: ev.error_count, skipped: ev.skipped_count,
        cancelled: !!ev.cancelled, items,
      };
    }
    default:
      return u;
  }
}

// Subscribe to the sidecar's /ws/progress stream and fold events into scan +
// upload view-state. Mirrors the Backups live-progress hook.
export function useLiveProgress() {
  const [scan, setScan] = useState<ScanState>(initialScan);
  const [upload, setUpload] = useState<UploadState>(initialUpload);
  const wsRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    const port = (window as any).lazyupload?.port ?? "8754";
    const token = (window as any).lazyupload?.token ?? "";
    let stop = false;

    function connect() {
      if (stop) return;
      const ws = new WebSocket(`ws://127.0.0.1:${port}/ws/progress?token=${encodeURIComponent(token)}`);
      wsRef.current = ws;
      ws.onmessage = (m) => handle(JSON.parse(m.data) as ProgressEvent);
      ws.onclose = () => { if (!stop) setTimeout(connect, 800); };
      ws.onerror = () => ws.close();
    }
    connect();
    return () => { stop = true; wsRef.current?.close(); };
  }, []);

  function handle(ev: ProgressEvent) {
    switch (ev.type) {
      case "scan_start":
        setScan({ active: true, done: 0, total: ev.total }); break;
      case "scan_progress":
        setScan({ active: true, done: ev.done, total: ev.total }); break;
      case "scan_done":
        setScan({ active: false, done: 0, total: 0 }); break;
      default:
        if (ev.type.startsWith("upload_") || ev.type.startsWith("track_")) setUpload((u) => foldUpload(u, ev));
    }
  }

  // Clear the last post. Pass the mixes about to go up to show them as "Waiting";
  // keepOthers leaves the rest of the list as it was (for Try again on one mix).
  function resetUpload(queue?: string[], keepOthers = false) {
    setUpload((u) => (queue ? queueUpload(u, queue, keepOthers) : initialUpload));
  }
  return { scan, upload, resetUpload };
}
