import { useEffect, useRef, useState } from "react";
import type { ProgressEvent } from "./types";

export interface ScanState { active: boolean; done: number; total: number; }
export interface UploadState {
  active: boolean; done: boolean; total: number;
  completed: number; errors: number; skipped: number;
  current: string | null; sent: number; size: number; cancelled: boolean;
  lastUrl: string | null;
}

const initialScan: ScanState = { active: false, done: 0, total: 0 };
const initialUpload: UploadState = {
  active: false, done: false, total: 0, completed: 0, errors: 0, skipped: 0,
  current: null, sent: 0, size: 0, cancelled: false, lastUrl: null,
};

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
      case "upload_start":
        setUpload({ ...initialUpload, active: true, total: ev.total }); break;
      case "track_start":
        setUpload((u) => ({ ...u, active: true, current: ev.name, sent: 0, size: 0 })); break;
      case "track_progress":
        setUpload((u) => ({ ...u, sent: ev.sent, size: ev.size })); break;
      case "track_done":
        setUpload((u) => ({ ...u, completed: u.completed + 1, lastUrl: ev.permalink_url })); break;
      case "track_skipped":
        setUpload((u) => ({ ...u, skipped: u.skipped + 1 })); break;
      case "track_error":
        setUpload((u) => ({ ...u, errors: u.errors + 1 })); break;
      case "upload_done":
        setUpload((u) => ({
          ...u, active: false, done: true, current: null,
          completed: ev.ok_count, errors: ev.error_count, skipped: ev.skipped_count,
          cancelled: !!ev.cancelled,
        })); break;
    }
  }

  function resetUpload() { setUpload(initialUpload); }
  return { scan, upload, resetUpload };
}
