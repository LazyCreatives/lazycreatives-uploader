import { Fragment, useEffect, useState } from "react";
import { makeApi, openExternal, revealPath, saveRenderedCover } from "../api";
import { coverPng } from "../coverRender";
import { openMenu, toast, toastWarn } from "../components/Desktop";
import { copyText } from "../desktop";
import type { Sharing, UploadRow } from "../types";
import { Button, fmtBytes, fmtCount, fmtWhen, PageHeader } from "../components/ui";
import { Icon } from "../components/Icon";
import { Cover } from "../components/Cover";
import { PlayButton, SongWave } from "../components/Player";
import { EmptyState } from "../components/SlothSpot";
import { genreColor } from "../look";
import { useDensity, type Density } from "../marks";

const api = makeApi();

const STATUS: Record<string, { pill: string; label: string }> = {
  uploaded: { pill: "pill--ok", label: "Posted" },
  error: { pill: "pill--error", label: "Failed" },
  skipped: { pill: "pill--skipped", label: "Skipped" },
};

function parseWhen(s: string): Date { return new Date(s.includes("T") ? s : s.replace(" ", "T")); }
function fmtTime(s: string): string {
  const d = parseWhen(s);
  return isNaN(d.getTime()) ? s : d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}
// "Today", "Yesterday", or the day it happened.
export function dayLabel(s: string, now: Date = new Date()): string {
  const d = parseWhen(s);
  if (isNaN(d.getTime())) return "Earlier";
  const y = new Date(now); y.setDate(now.getDate() - 1);
  if (d.toDateString() === now.toDateString()) return "Today";
  if (d.toDateString() === y.toDateString()) return "Yesterday";
  return d.toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long",
    ...(d.getFullYear() === now.getFullYear() ? {} : { year: "numeric" }) });
}

// One fixed-column table of uploads; Home shows the latest few with the same columns.
// Each row carries the mix's cover, a play button and its waveform.
// With `byDay`, rows sit under a heading per day and the When column shows just the time.
export function UploadTable({ rows, byDay, density = "comfortable", onRetry, retrying }: {
  rows: UploadRow[]; byDay?: boolean; density?: Density;
  onRetry?: (r: UploadRow) => void; retrying?: Set<number>;
}) {
  let lastDay = "";
  return (
    <div className={`table table--crate rows--${density}`}>
      <div className="row cols cols-head history-cols">
        <span /><span /><span /><span>Track</span><span>Waveform</span><span>Result</span><span>Privacy</span>
        <span className="col-num">Size</span><span className="col-num">When</span><span />
      </div>
      {rows.map((r) => {
        const st = STATUS[r.status] ?? { pill: "", label: r.status };
        const day = byDay ? dayLabel(r.timestamp) : "";
        const heading = byDay && day !== lastDay
          ? <div key={`day-${day}`} className="row hist-day">{day}<span>{rows.filter((x) => dayLabel(x.timestamp) === day).length}</span></div>
          : null;
        lastDay = day;
        const meta = { title: r.title, sub: r.project_match ? `From ${r.project_match}` : `Posted ${fmtWhen(r.timestamp)}`,
          cover: r.project_match || r.title, genre: r.project_genre };
        return (<Fragment key={r.id}>
          {heading}
          <div className={`row cols history-cols${r.status === "error" ? " row--failed" : ""}`} onContextMenu={(e) => openMenu(e, [
            ...(r.permalink_url ? [
              { label: "Open on SoundCloud", onClick: () => openExternal(r.permalink_url!) },
              { label: "Copy SoundCloud link", onClick: () => { copyText(r.permalink_url!); } }, "-" as const] : []),
            ...(onRetry && canRetry(r, rows) ? [{ label: "Try again", onClick: () => onRetry(r), disabled: retrying?.has(r.id) }, "-" as const] : []),
            { label: "Show the file", onClick: () => revealPath(r.file_path) },
            { label: "Copy file path", onClick: () => { copyText(r.file_path); } },
          ])}>
            <span className="stripe" style={{ background: genreColor(r.project_genre) }} />
            <PlayButton path={r.file_path} meta={meta} size={28} />
            <Cover name={meta.cover} genre={meta.genre} size={36} label={false} />
            <div className="row__main">
              <div className="row__title" title={r.title}>{r.title}</div>
              {r.error && <div className="row__sub hist-err">
                {onRetry && canRetry(r, rows) && (
                  <button type="button" className="btn btn--ghost btn--sm mixstate__retry" disabled={retrying?.has(r.id)}
                    onClick={() => onRetry(r)}>{retrying?.has(r.id) ? "Posting…" : "Try again"}</button>
                )}
                <span className="col-trunc" title={r.error}>{r.error}</span>
              </div>}
            </div>
            <SongWave path={r.file_path} meta={meta} height={22} />
            <span className={`pill ${st.pill}`}>{st.label}</span>
            <span className="muted" style={{ textTransform: "capitalize" }}>{r.sharing}</span>
            <span className="col-num">{fmtBytes(r.size)}</span>
            <span className="col-num">{byDay ? fmtTime(r.timestamp) : fmtWhen(r.timestamp)}</span>
            <span className="col-act">
              {r.permalink_url
                ? <button className="iconbtn" title="Open on SoundCloud" aria-label={`Open ${r.title} on SoundCloud`}
                    onClick={() => openExternal(r.permalink_url!)}><Icon name="external" /></button>
                : <button className="iconbtn" title="Show the file" aria-label={`Show ${r.title} on disk`}
                    onClick={() => revealPath(r.file_path)}><Icon name="folder" /></button>}
            </span>
          </div>
        </Fragment>);
      })}
    </div>
  );
}

// A failed post can be tried again unless the same file has gone up since.
// Rows are newest first, so anything before this one in the list is later.
export function canRetry(r: UploadRow, rows: UploadRow[]): boolean {
  if (r.status !== "error") return false;
  const i = rows.indexOf(r);
  return !rows.slice(0, i < 0 ? 0 : i).some((x) => x.status === "uploaded"
    && (x.file_path === r.file_path || (!!r.file_hash && x.file_hash === r.file_hash)));
}

type ResultFilter = "all" | "uploaded" | "error" | "skipped";
const PAGE = 100;

export function History() {
  const [density] = useDensity("history");   // set in Settings > Lists
  const [rows, setRows] = useState<UploadRow[] | null>(null);
  const [limit, setLimit] = useState(PAGE);
  const [query, setQuery] = useState("");
  const [result, setResult] = useState<ResultFilter>("all");
  const load = () => api.history(limit).then(setRows).catch(() => setRows((r) => r ?? []));
  useEffect(() => { void load(); }, [limit]);   // eslint-disable-line react-hooks/exhaustive-deps
  const [retrying, setRetrying] = useState<Set<number>>(new Set());

  // Post a failed mix again, as it was meant to go up: same title, same privacy,
  // with the cover it shows. The service still checks it isn't on SoundCloud already.
  async function retry(r: UploadRow) {
    setRetrying((s) => new Set(s).add(r.id));
    const done = () => setRetrying((s) => { const n = new Set(s); n.delete(r.id); return n; });
    try {
      const name = r.project_match || r.title;
      const art = await coverPng(name, r.project_genre).then((png) => saveRenderedCover(name, png)).catch(() => undefined);
      const { job_id } = await api.upload([{
        path: r.file_path, name: r.title, title: r.title, sharing: r.sharing as Sharing,
        genre: r.project_genre || undefined, file_hash: r.file_hash, size: r.size, artwork_path: art,
      }]);
      const tick = async () => {
        const job = await api.jobStatus(job_id).catch(() => null);
        if (job && (job.state === "running" || job.state === "cancelling")) { window.setTimeout(tick, 1000); return; }
        done(); void load();
        const res = job?.result;
        if (job?.state === "done" && res?.ok_count) toast(`${r.title} is on SoundCloud now.`);
        else if (job?.state === "done" && res?.skipped_count) toast(`${r.title} was already on SoundCloud, so it wasn’t posted again.`);
        else toastWarn(`${r.title} didn’t go up this time. ${job?.error ?? "Its reason is on the new row."}`);
      };
      window.setTimeout(tick, 1000);
    } catch (e) {
      done();
      toastWarn(`Couldn’t post ${r.title} again: ${String((e as Error).message)}`);
    }
  }

  const q = query.trim().toLowerCase();
  const matching = (rows ?? []).filter((r) => !q || [r.title, r.project_match, r.project_genre, r.sharing]
    .some((v) => v && v.toLowerCase().includes(q)));
  const count = (k: ResultFilter) => k === "all" ? matching.length : matching.filter((r) => r.status === k).length;
  const shown = result === "all" ? matching : matching.filter((r) => r.status === result);
  const more = rows !== null && rows.length >= limit;
  // Only the results that happened get a button; with nothing but posts there's no choice to make.
  const kinds = ([["all", "All"], ["uploaded", "Posted"], ["error", "Failed"], ["skipped", "Skipped"]] as [ResultFilter, string][])
    .filter(([k]) => k === "all" || k === result || (rows ?? []).some((r) => r.status === k));

  return (
    <div>
      <PageHeader title="History" sub="Everything Uploader has posted, newest first." />
      {rows && rows.length === 0 && (
        <EmptyState pose="napping" title="Nothing posted yet" say="Nothing yet. I’m patient.">
          Every mix you post shows here, newest first, with a link to it on SoundCloud.
        </EmptyState>
      )}
      {rows && rows.length > 0 && <>
        <div className="toolbar">
          <label className="find__search upload-search">
            <Icon name="search" size={15} />
            <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search posts, projects, genres…"
              aria-label="Search history" spellCheck={false} data-find
              onKeyDown={(e) => { if (e.key === "Escape") setQuery(""); }} />
            {query && <button type="button" className="find__x" aria-label="Clear search"
              onClick={() => setQuery("")}><Icon name="close" size={13} /></button>}
          </label>
          {kinds.length > 2 && <div className="seg" role="group" aria-label="Result">
            {kinds.map(([k, label]) => (
              <button key={k} type="button" className={`seg__opt${result === k ? " seg__opt--on" : ""}`}
                aria-pressed={result === k} onClick={() => setResult(k)}>
                {label} <span className="find__n">{fmtCount(count(k))}</span>
              </button>
            ))}
          </div>}
        </div>
        {shown.length > 0
          ? <UploadTable rows={shown} byDay density={density} onRetry={(r) => void retry(r)} retrying={retrying} />
          : <div className="table"><EmptyState pose="searching" title="Nothing matches" say="Looked everywhere. Nothing.">
              Try fewer letters, or pick All.
            </EmptyState></div>}
        {more && (
          <div className="hist-more">
            <Button sm onClick={() => setLimit((l) => l + PAGE)}>Show older posts</Button>
          </div>
        )}
      </>}
    </div>
  );
}
