import { useEffect, useState } from "react";
import { makeApi } from "../api";
import type { Account, Mix, Overview, UploadRow } from "../types";
import { Button, fmtCount, fmtWhen, ProBadge } from "../components/ui";
import { ConnectPanel } from "../components/Connect";
import { Icon } from "../components/Icon";
import { UploadTable } from "./History";
import { Rolling } from "../components/Rolling";
import { EmptyState } from "../components/SlothSpot";
import { tally, type CollectionData } from "../components/Collection";
import { genreColor } from "../look";
import { NO_FILTERS, yearOf, type TrackFilters } from "../trackFilter";
import type { Track } from "../types";

const api = makeApi();

// Mixes in the watched folders that haven't gone up yet (an extra format of the
// same mix doesn't count), and the most recently exported one.
export function waitingMixes(mixes: Mix[] | null): { count: number; newest: Mix | null } {
  const fresh = (mixes ?? []).filter((m) => !m.uploaded && !m.superseded_by && !m.short && !m.stem && !m.on_soundcloud);
  const newest = fresh.reduce<Mix | null>((a, m) => (!a || m.mtime > a.mtime ? m : a), null);
  return { count: fresh.length, newest };
}
export const readyHeadline = (n: number) => `${fmtCount(n)} new ${n === 1 ? "mix" : "mixes"} ready to post.`;
export const readyInFolder = (n: number) => `${fmtCount(n)} ${n === 1 ? "mix is" : "mixes are"} ready in your folder.`;

export function Home({ account, onAccount, onUpload, onHistory }: {
  account: Account; onAccount: (a: Account) => void; onUpload: () => void; onHistory?: () => void;
  onTracks?: (f: Partial<TrackFilters>) => void;   // Your tracks showing one genre or year
  onOpenTrack?: (id: string) => void;
}) {
  const [ov, setOv] = useState<Overview | null>(null);
  const [recent, setRecent] = useState<UploadRow[] | null>(null);
  const [mixes, setMixes] = useState<Mix[] | null>(null);
  useEffect(() => {
    api.overview().then(setOv).catch(() => setOv(null));
    api.history(3).then(setRecent).catch(() => setRecent([]));
    api.scan().then(setMixes).catch(() => setMixes(null));  // same list as the Upload page
  }, [account]);
  // Plays come from SoundCloud itself, so only once an account is connected.
  const [plays, setPlays] = useState<number | null>(null);
  useEffect(() => {
    if (!account.connected) { setPlays(null); return; }
    let live = true;
    api.listTracks().then((t) => { if (live) setPlays(t.reduce((n, x) => n + (x.playback_count || 0), 0)); })
      .catch(() => { if (live) setPlays(null); });
    return () => { live = false; };
  }, [account]);
  const waiting = waitingMixes(mixes);
  const ready = account.connected && waiting.count > 0;

  const posted = ov?.uploaded_count ?? 0;
  const headline = ready ? readyHeadline(waiting.count)
    : !ov ? " "
    : posted === 0 ? "Nothing posted yet."
    : ov.error_count ? `${fmtCount(posted)} posted, ${fmtCount(ov.error_count)} need a look.`
    : `${fmtCount(posted)} ${posted === 1 ? "track" : "tracks"} posted, no problems.`;

  const demo = ov?.mock && (
    <div className="banner banner--demo">
      <Icon name="info" className="banner__icon" />
      Demo mode: no SoundCloud keys are set up, so uploads go to a pretend account.
    </div>
  );
  // One quiet line under the headline: when you last posted, plus anything waiting or
  // running by itself. Things that are off or at zero aren't mentioned.
  const schedLine = [
    ov?.last_upload ? `Last posted ${fmtWhen(ov.last_upload)}` : "",
    ov?.scheduled_count ? `${fmtCount(ov.scheduled_count)} waiting to go public` : "",
    ov?.schedule.enabled ? `auto-upload every ${ov.schedule.interval_minutes} min` : "",
  ].filter(Boolean).join(" · ");
  const subText = ready && waiting.newest
    ? `Newest is ${waiting.newest.name}, exported ${fmtWhen(new Date(waiting.newest.mtime * 1000).toISOString())}.`
    : "Drop finished mixes in your watched folder and post them in one go. The same mix is never posted twice.";
  const mainButton = <Button kind="primary" onClick={onUpload} disabled={!account.connected}>
    {ready ? "Review and post" : "Upload new mixes"}</Button>;
  // The empty "Latest uploads" box: point at the mixes waiting, if there are any.
  const emptyBox = (
    <div className="table"><EmptyState pose={ready ? "waving" : "napping"} title="Nothing posted yet" say={ready ? "Your mixes are waiting. Go on." : "Wake me when there’s a mix."}
      action={ready ? <Button sm onClick={onUpload}>Post your first mix</Button> : undefined}>
      {ready ? readyInFolder(waiting.count) : "Export a mix into your folder and it shows up here, ready to post in one click."}
    </EmptyState></div>
  );

  return (
    <div>
      {demo}

      <header className="page-head up-head">
        <div>
          <h1>{headline}</h1>
          <p className="sub">{subText}{schedLine && <span className="faint"> {schedLine}.</span>}</p>
        </div>
        <div className="page-head__actions">
          {mainButton}
        </div>
      </header>

      <HomeDeck figures={[
        { label: "Ready to post", value: mixes ? waiting.count : null },
        { label: "Posted", value: ov ? posted : null },
        { label: "Plays", value: plays },
        { label: "Failed", value: ov ? ov.error_count : null, bad: !!ov?.error_count },
      ]} />

      {!account.connected && (
        <section className="card section">
          <h2>Connect your SoundCloud</h2>
          <ConnectPanel account={account} onChange={onAccount} />
        </section>
      )}

      <section className="section">
        <div className="section__head">
          <h2>Latest uploads</h2>
          {onHistory && recent && recent.length > 0 &&
            <button className="linkbtn" onClick={onHistory}>See all in History</button>}
        </div>
        {recent && recent.length === 0
          ? emptyBox
          : <UploadTable rows={(recent ?? []).slice(0, 3)} />}
      </section>

      {ov && ov.tier === "free" && !ov.beta && (
        <div className="locked-note">
          <span>Want hands-off posting?</span>
          <b>Auto-upload a watched folder<ProBadge /></b>
          <span>Upgrade in Settings.</span>
        </div>
      )}
    </div>
  );
}

// The deck readout under the headline: four big numbers in an inset screen that roll
// to their new value when something changes. A dash while a number is still loading
// (or, for Plays, while SoundCloud isn't connected).
function HomeDeck({ figures }: { figures: { label: string; value: number | null; bad?: boolean }[] }) {
  return (
    <dl className="deckread home-deck">
      {figures.map((f) => (
        <div key={f.label} className={`deckread__cell${f.bad ? " deckread__cell--bad" : ""}${f.value === 0 ? " deckread__cell--zero" : ""}`}>
          <dt>{f.label}</dt>
          <dd>{f.value === null ? "—" : <Rolling value={f.value} />}</dd>
        </div>
      ))}
    </dl>
  );
}

// Everything you've posted in figures, for "Your collection" / the liner notes.
export function collectionOf(tracks: Track[], open: (f: Partial<TrackFilters>) => void, openTrack: (id: string) => void): CollectionData {
  const pub = tracks.filter((t) => t.sharing !== "private").length;
  const plays = tracks.reduce((n, t) => n + (t.playback_count || 0), 0);
  const secs = tracks.reduce((n, t) => n + (t.duration || 0), 0);
  const linked = tracks.filter((t) => t.project_match).length;
  const genres = tally(tracks, (t) => (t.genre || "").trim());
  const years = tally(tracks, yearOf).sort((a, b) => b[0].localeCompare(a[0]));
  const played = [...tracks].filter((t) => (t.playback_count ?? 0) > 0).sort((a, b) => (b.playback_count ?? 0) - (a.playback_count ?? 0));
  const h = Math.floor(secs / 3600), m = Math.round((secs % 3600) / 60);
  const top = genres.slice(0, 2).map(([g]) => g);
  const first = years.length ? years[years.length - 1][0] : "";
  return {
    intro: `${fmtCount(tracks.length)} track${tracks.length === 1 ? "" : "s"} on SoundCloud${first && years.length > 1 ? `, posted between ${first} and ${years[0][0]}` : ""}`
      + `${top.length ? `, mostly ${top.join(" and ")}` : ""}. Played ${fmtCount(plays)} time${plays === 1 ? "" : "s"} so far.`,
    figures: [
      { label: "Tracks", value: fmtCount(tracks.length), note: tracks.length - pub ? `${fmtCount(tracks.length - pub)} private` : "all public" },
      { label: "Plays", value: fmtCount(plays) },
      { label: "Total length", value: h ? `${h}h ${m}m` : `${m}m` },
      { label: "From a project", value: fmtCount(linked), note: "linked to Backups" },
    ],
    lists: [
      { title: "Genres", rows: genres.map(([g, n]) => ({ label: g, n, colour: genreColor(g), onClick: () => open({ ...NO_FILTERS, genre: g }) })) },
      { title: "Year posted", rows: years.map(([y, n]) => ({ label: y, n, onClick: () => open({ ...NO_FILTERS, year: y }) })) },
      { title: "Most played", rows: played.map((t) => ({ label: t.title, n: t.playback_count ?? 0, onClick: () => openTrack(String(t.id)) })) },
    ],
  };
}
