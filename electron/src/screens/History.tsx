import { Fragment, useEffect, useState } from "react";
import { makeApi, openExternal, revealPath } from "../api";
import { openMenu } from "../components/Desktop";
import { copyText } from "../desktop";
import type { UploadRow } from "../types";
import { Button, fmtBytes, fmtCount, fmtWhen, PageHeader } from "../components/ui";
import { Icon } from "../components/Icon";
import { Cover } from "../components/Cover";
import { PlayButton, SongWave } from "../components/Player";
import { EmptyState } from "../components/SlothSpot";
import { genreColor, useLook } from "../look";
import { RowSize } from "../components/Marks";
import { useDensity, type Density } from "../marks";
import { rowKey } from "../components/a11y";

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
export function UploadTable({ rows, byDay, density = "comfortable" }: { rows: UploadRow[]; byDay?: boolean; density?: Density }) {
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
          <div className="row cols history-cols" onContextMenu={(e) => openMenu(e, [
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
              <div className="row__title" title={r.title}>{r.title}</div>
              {r.error && <div className="row__sub" style={{ color: "var(--danger)" }} title={r.error}>{r.error}</div>}
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

// "October 2026": the month a post went up, for the Sleeve look's back catalogue.
export function monthLabel(s: string): string {
  const d = parseWhen(s);
  return isNaN(d.getTime()) ? "Earlier" : d.toLocaleDateString(undefined, { month: "long", year: "numeric" });
}

// Sleeve look: History as a label's back catalogue, every post as its cover,
// a shelf per month, newest month first. Failed posts sit faded with their reason.
function BackCatalogue({ rows }: { rows: UploadRow[] }) {
  const months: { label: string; rows: UploadRow[] }[] = [];
  for (const r of rows) {
    const label = monthLabel(r.timestamp);
    const last = months[months.length - 1];
    if (last && last.label === label) last.rows.push(r); else months.push({ label, rows: [r] });
  }
  return (
    <div className="backcat">
      {months.map((m) => (
        <section key={m.label} className="backcat__month" aria-label={m.label}>
          <h2 className="backcat__head">{m.label}<span>{fmtCount(m.rows.filter((r) => r.status === "uploaded").length)} posted</span></h2>
          <div className="sleeves">
            {m.rows.map((r) => {
              const st = STATUS[r.status] ?? { pill: "", label: r.status };
              const open = () => { if (r.permalink_url) openExternal(r.permalink_url); else revealPath(r.file_path); };
              const meta = { title: r.title, sub: r.project_match ? `From ${r.project_match}` : `Posted ${fmtWhen(r.timestamp)}`,
                cover: r.project_match || r.title, genre: r.project_genre };
              return (
                <div key={r.id} className={`sleeve${r.status === "uploaded" ? "" : " sleeve--done"}`} role="button" tabIndex={0}
                  onClick={open} onKeyDown={rowKey(open)}
                  onContextMenu={(e) => openMenu(e, [
                    ...(r.permalink_url ? [
                      { label: "Open on SoundCloud", onClick: () => openExternal(r.permalink_url!) },
                      { label: "Copy SoundCloud link", onClick: () => { copyText(r.permalink_url!); } }, "-" as const] : []),
                    { label: "Show the file", onClick: () => revealPath(r.file_path) },
                    { label: "Copy file path", onClick: () => { copyText(r.file_path); } },
                  ])}>
                  <div className="sleeve__art">
                    <Cover name={meta.cover} genre={meta.genre} />
                    <span className="sleeve__badge">
                      <span className={`dot ${r.status === "uploaded" ? (r.sharing === "private" ? "dot--warn" : "dot--ok") : r.status === "error" ? "dot--error" : ""}`} />
                      {r.status === "uploaded" ? (r.sharing === "private" ? "Private" : "Public") : st.label}
                    </span>
                    <PlayButton path={r.file_path} meta={meta} size={34} className="sleeve__play" />
                  </div>
                  <div className="sleeve__meta">
                    <div className="sleeve__name" title={r.title}>{r.title}</div>
                    <div className="sleeve__sub" title={r.error || undefined}>{r.error ? r.error : `${dayLabel(r.timestamp)}, ${fmtTime(r.timestamp)}`}</div>
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      ))}
    </div>
  );
}

type ResultFilter = "all" | "uploaded" | "error" | "skipped";
const PAGE = 100;

export function History() {
  const [look] = useLook();
  const [density, setDensity] = useDensity("history");
  const [rows, setRows] = useState<UploadRow[] | null>(null);
  const [limit, setLimit] = useState(PAGE);
  const [query, setQuery] = useState("");
  const [result, setResult] = useState<ResultFilter>("all");
  useEffect(() => { api.history(limit).then(setRows).catch(() => setRows((r) => r ?? [])); }, [limit]);

  const q = query.trim().toLowerCase();
  const matching = (rows ?? []).filter((r) => !q || [r.title, r.project_match, r.project_genre, r.sharing]
    .some((v) => v && v.toLowerCase().includes(q)));
  const count = (k: ResultFilter) => k === "all" ? matching.length : matching.filter((r) => r.status === k).length;
  const shown = result === "all" ? matching : matching.filter((r) => r.status === result);
  const more = rows !== null && rows.length >= limit;

  return (
    <div>
      <PageHeader title="History" sub={look === "sleeve" ? "Your back catalogue: everything Uploader has posted, a shelf per month." : "Everything Uploader has posted, newest first."} />
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
          <div className="seg" role="group" aria-label="Result">
            {([["all", "All"], ["uploaded", "Posted"], ["error", "Failed"], ["skipped", "Skipped"]] as [ResultFilter, string][]).map(([k, label]) => (
              <button key={k} type="button" className={`seg__opt${result === k ? " seg__opt--on" : ""}`}
                aria-pressed={result === k} onClick={() => setResult(k)}>
                {label} <span className="find__n">{fmtCount(count(k))}</span>
              </button>
            ))}
          </div>
          {look === "crate" && <RowSize value={density} onChange={setDensity} />}
        </div>
        {shown.length > 0
          ? look === "sleeve" ? <BackCatalogue rows={shown} /> : <UploadTable rows={shown} byDay density={density} />
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
