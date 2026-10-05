import { useEffect, useState } from "react";
import { makeApi, openExternal, revealPath } from "../api";
import { openMenu } from "../components/Desktop";
import { copyText } from "../desktop";
import type { UploadRow } from "../types";
import { fmtBytes, fmtWhen, PageHeader } from "../components/ui";
import { Icon } from "../components/Icon";
import { Cover } from "../components/Cover";
import { PlayButton, SongWave } from "../components/Player";
import { EmptyState } from "../components/SlothSpot";
import { genreColor } from "../look";

const api = makeApi();

const STATUS: Record<string, { pill: string; label: string }> = {
  uploaded: { pill: "pill--ok", label: "Posted" },
  error: { pill: "pill--error", label: "Failed" },
  skipped: { pill: "pill--skipped", label: "Skipped" },
};

// One fixed-column table of uploads; Home shows the latest few with the same columns.
// Each row carries the mix's cover, a play button and its waveform.
export function UploadTable({ rows }: { rows: UploadRow[] }) {
  return (
    <div className="table table--crate">
      <div className="row cols cols-head history-cols">
        <span /><span /><span /><span>Track</span><span>Waveform</span><span>Result</span><span>Privacy</span>
        <span className="col-num">Size</span><span className="col-num">When</span><span />
      </div>
      {rows.map((r) => {
        const st = STATUS[r.status] ?? { pill: "", label: r.status };
        const meta = { title: r.title, sub: r.project_match ? `From ${r.project_match}` : `Posted ${fmtWhen(r.timestamp)}`,
          cover: r.project_match || r.title, genre: r.project_genre };
        return (
          <div key={r.id} className="row cols history-cols" onContextMenu={(e) => openMenu(e, [
            ...(r.permalink_url ? [
              { label: "Open on SoundCloud", onClick: () => openExternal(r.permalink_url!) },
              { label: "Copy SoundCloud link", onClick: () => { copyText(r.permalink_url!); } }, "-" as const] : []),
            { label: "Show the file", onClick: () => revealPath(r.file_path) },
            { label: "Copy file path", onClick: () => { copyText(r.file_path); } },
          ])}>
            <span className="stripe" style={{ background: genreColor(r.project_genre) }} />
            <PlayButton path={r.file_path} meta={meta} size={28} />
            <Cover name={meta.cover} genre={meta.genre} size={36} label={false} />
            <div className="row__main">
              <div className="row__title">{r.title}</div>
              {r.error && <div className="row__sub" style={{ color: "var(--danger)" }}>{r.error}</div>}
            </div>
            <SongWave path={r.file_path} meta={meta} height={22} />
            <span className={`pill ${st.pill}`}>{st.label}</span>
            <span className="muted" style={{ textTransform: "capitalize" }}>{r.sharing}</span>
            <span className="col-num">{fmtBytes(r.size)}</span>
            <span className="col-num">{fmtWhen(r.timestamp)}</span>
            <span className="col-act">
              {r.permalink_url
                ? <button className="iconbtn" title="Open on SoundCloud" aria-label={`Open ${r.title} on SoundCloud`}
                    onClick={() => openExternal(r.permalink_url!)}><Icon name="external" /></button>
                : <button className="iconbtn" title="Show the file" aria-label={`Show ${r.title} on disk`}
                    onClick={() => revealPath(r.file_path)}><Icon name="folder" /></button>}
            </span>
          </div>
        );
      })}
    </div>
  );
}

export function History() {
  const [rows, setRows] = useState<UploadRow[] | null>(null);
  useEffect(() => { api.history(100).then(setRows).catch(() => setRows([])); }, []);

  return (
    <div>
      <PageHeader title="History" sub="Everything Uploader has posted, newest first." />
      {rows && rows.length === 0 && (
        <EmptyState pose="napping" title="Nothing posted yet">
          Every mix you post shows here, newest first, with a link to it on SoundCloud.
        </EmptyState>
      )}
      {rows && rows.length > 0 && <UploadTable rows={rows} />}
    </div>
  );
}
