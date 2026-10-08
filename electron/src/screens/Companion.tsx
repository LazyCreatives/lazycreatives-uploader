import { useEffect, useState } from "react";
import { makeApi, openExternal } from "../api";
import type { Account, Mix, Overview, UploadRow } from "../types";
import { useLiveProgress } from "../useProgress";
import { isMix, mixName, postState, postingLine, queueRows, whenMs } from "../companionQueue";
import { ago, showMain, useGentlePoll, useLookFromOtherWindows, usePinned } from "../companion";
import { useFileDrop, type Dropped } from "../desktop";
import { waitingMixes } from "./Home";
import { fmtCount, fmtWhen } from "../components/ui";
import { genreColor, useGenreColors, useLook } from "../look";
import { Cover } from "../components/Cover";
import { Icon } from "../components/Icon";
import { EmptyState } from "../components/SlothSpot";
import { rowKey } from "../components/a11y";
import slothUrl from "../assets/lazy-creatives-sloth.png";

// The narrow window: drop a mix in to post it, and see what's going up and what went
// up lately, kept beside your music program. Opened from View > Narrow window (see companion.js).
const api = makeApi();
const RECENT = 6;

export function Companion() {
  useGenreColors();
  useLookFromOtherWindows();
  const [look] = useLook();
  const [pinned, togglePin] = usePinned();
  const live = useLiveProgress();
  const [account, setAccount] = useState<Account | null>(null);
  const [ov, setOv] = useState<Overview | null>(null);
  const [posts, setPosts] = useState<UploadRow[] | null>(null);
  const [mixes, setMixes] = useState<Mix[] | null>(null);
  const [err, setErr] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [, setNow] = useState(0);  // re-draws the "5 min ago" times

  const load = () => {
    Promise.all([api.account(), api.overview(), api.history(RECENT)])
      .then(([a, o, h]) => { setAccount(a); setOv(o); setPosts(h); setErr(false); })
      .catch(() => setErr(true));
  };
  // The mixes waiting in your folders: looked for when the window opens and after a post.
  const findMixes = () => { api.scan().then(setMixes).catch(() => setMixes(null)); };
  useEffect(load, [live.upload.done, live.upload.completed, live.upload.errors]);
  useEffect(findMixes, [live.upload.done]);
  useGentlePoll(() => { load(); setNow((n) => n + 1); }, 30000);

  // Drop a mix on the window: the full window opens on Upload with it ticked, ready to post.
  const connected = !!account?.connected;
  function dropped(items: Dropped[]) {
    const paths = items.filter((d) => d.kind === "file" && isMix(d.path)).map((d) => d.path);
    if (!paths.length) {
      setNote(items.some((d) => d.kind === "folder")
        ? "That's a folder. Drop the mix itself (a WAV, AIFF, FLAC or MP3)."
        : "That isn't a mix. Drop a WAV, AIFF, FLAC or MP3.");
      return;
    }
    setNote(paths.length === 1 ? `${mixName(paths[0])} is ready to post in the full window.` : `${fmtCount(paths.length)} mixes are ready to post in the full window.`);
    showMain({ go: "upload", paths });
  }
  const dragging = useFileDrop(dropped, connected);

  const head = (
    <header className="cw-head">
      <img className="cw-head__mark" src={slothUrl} alt="" draggable={false} />
      <span className="cw-head__name">Uploader</span>
      <span className="cw-head__space" />
      <button type="button" className={`iconbtn cw-pin${pinned ? " cw-pin--on" : ""}`} aria-pressed={pinned} onClick={togglePin}
        title={pinned ? "Kept on top of other windows. Click to let it go behind" : "Keep this window on top of other windows"}>
        <Icon name="pin" />
      </button>
      <button type="button" className="iconbtn" onClick={() => showMain({ go: "home" })} title="Open the full Uploader window" aria-label="Open the full Uploader window">
        <Icon name="external" />
      </button>
    </header>
  );
  const shell = (body: React.ReactNode, foot?: React.ReactNode) => (
    <div className="cw" data-look={look}>{head}<div className="cw-body">{body}</div>{foot}</div>
  );

  if (err) return shell(
    <EmptyState pose="tangled" title="Uploader lost touch with its engine"
      action={<button className="btn btn--primary" onClick={() => showMain({ go: "home" })}>Open Uploader</button>}>
      Open the full window to get it going again. Nothing you posted is lost.
    </EmptyState>);
  if (!account || !ov || !posts) return shell(<p className="cw-wait">Waking the sloth…</p>);

  const lastMs = whenMs(ov.last_upload);
  const posting = postingLine(live.upload);
  const glanceBox = (
    <section className={`cw-glance cw-glance--${posting ? "busy" : connected ? "ok" : "look"}`} aria-live="polite">
      <span className={`dot cw-glance__dot ${posting ? "dot--accent" : connected ? "dot--ok" : "dot--warn"}`} />
      <div className="cw-glance__text">
        <div className="cw-glance__title">{posting ?? (connected ? "SoundCloud connected" : "Not connected")}</div>
        <div className="cw-glance__detail" title={account.account ?? undefined}>
          {posting && live.upload.current ? live.upload.current
            : connected ? `as ${account.account}${ov.mock && !/demo/i.test(account.account || "") ? " (demo account)" : ""}`
            : "Connect SoundCloud to post"}
        </div>
      </div>
      <div className="cw-glance__when">
        <span>Last post</span>
        <b title={ov.last_upload ? fmtWhen(ov.last_upload) : undefined}>{lastMs ? ago(lastMs) : "None yet"}</b>
      </div>
      {!connected && <button className="btn btn--primary btn--sm" onClick={() => showMain({ go: "home" })}>Connect in the full window</button>}
    </section>
  );

  const waiting = waitingMixes(mixes);
  const dropZone = (
    <section className="cw-section">
      <button type="button" className={`cw-drop${dragging ? " cw-drop--over" : ""}`} disabled={!connected}
        onClick={() => showMain({ go: "upload" })} title="Open Upload in the full window">
        <span className="cw-drop__icon"><Icon name="upload" size={17} /></span>
        <span className="cw-drop__title">{dragging ? "Let go to post it" : "Drop a mix here to post it"}</span>
        <span className="cw-drop__hint">{dragging ? "It opens ready to post, so you can check the details first." : "Or click to pick from the mixes in your folders."}</span>
      </button>
      {note && <div className="cw-note cw-drop__note" role="status">{note}</div>}
      {!note && connected && waiting.count > 0 && (
        <div className="cw-note cw-drop__note">
          {fmtCount(waiting.count)} new {waiting.count === 1 ? "mix is" : "mixes are"} ready in your folder.{" "}
          <button type="button" className="linkbtn" onClick={() => showMain({ go: "upload" })}>Review and post</button>
        </div>
      )}
    </section>
  );

  const queue = queueRows(live.upload);
  const queueList = queue.length > 0 && (
    <section className="cw-section">
      <h2 className="cw-label">{live.upload.active ? "Going up now" : "Just posted"}</h2>
      <div className={look === "crate" ? "table table--crate cw-list" : "cw-cards"}>
        {queue.map((q) => {
          const tone = q.phase === "failed" ? "error" : q.phase === "posted" ? "ok" : q.phase === "uploading" ? "changed" : "new";
          const dot = q.phase === "failed" ? "dot--error" : q.phase === "posted" ? "dot--ok" : q.phase === "uploading" ? "dot--accent" : "";
          const word = q.phase === "uploading" ? `${q.pct}%` : q.phase === "waiting" ? "Waiting" : q.phase === "posted" ? "Posted" : q.phase === "skipped" ? "Skipped" : "Failed";
          return (
            <div key={q.key} className={look === "crate" ? "row cols cw-cols" : "cw-card"}>
              {look === "crate" && <span className="stripe" style={{ background: tone === "error" ? "var(--danger)" : "var(--accent)" }} />}
              <Cover name={q.name} size={look === "crate" ? 28 : 44} label={false} />
              <span className={look === "crate" ? "cw-cols__main" : "cw-card__main"}>
                <span className={`col-trunc ${look === "crate" ? "cw-cols__name" : "cw-card__name"}`} title={q.name}>{q.name}</span>
                {q.phase === "uploading"
                  ? <span className="cw-mini" role="progressbar" aria-valuenow={q.pct} aria-valuemin={0} aria-valuemax={100}><i className="cw-mini__fill" style={{ ["--pct" as any]: q.pct }} /></span>
                  : <span className={look === "crate" ? "cw-cols__when" : "cw-card__when"} title={q.note}>{q.note}</span>}
              </span>
              <span className={`cw-state cw-tone--${tone}`}><span className={`dot ${dot}`} />{word}</span>
            </div>
          );
        })}
      </div>
    </section>
  );

  const openPost = (r: UploadRow) => { if (r.permalink_url) openExternal(r.permalink_url); else showMain({ go: "home" }); };
  const recentList = (
    <section className="cw-section">
      <h2 className="cw-label">Recent posts</h2>
      {posts.length === 0 ? (
        <EmptyState pose="napping" title="Nothing posted yet" say="Wake me when there's a mix.">
          Your posts show up here as they go up.
        </EmptyState>
      ) : (
        <div className={look === "crate" ? "table table--crate cw-list" : "cw-cards"}>
          {posts.map((r) => {
            const st = postState(r);
            const ms = whenMs(r.timestamp);
            const cover = r.project_match || r.title;
            return (
              <div key={r.id} className={look === "crate" ? "row cols cw-cols" : "cw-card"} role="button" tabIndex={0}
                title={r.permalink_url ? `${r.title}: open on SoundCloud` : r.error || r.title}
                onClick={() => openPost(r)} onKeyDown={rowKey(() => openPost(r))}>
                {look === "crate" && <span className="stripe" style={{ background: genreColor(r.project_genre) }} />}
                <Cover name={cover} genre={r.project_genre} size={look === "crate" ? 28 : 44} label={false} />
                <span className={look === "crate" ? "cw-cols__main" : "cw-card__main"}>
                  <span className={`col-trunc ${look === "crate" ? "cw-cols__name" : "cw-card__name"}`}>{r.title}</span>
                  <span className={look === "crate" ? "cw-cols__when" : "cw-card__when"}>
                    {r.status === "uploaded" ? `Posted ${ago(ms).toLowerCase()}` : r.status === "error" ? `Tried ${ago(ms).toLowerCase()}` : ago(ms)}
                  </span>
                </span>
                <span className={`cw-state cw-tone--${st.tone}`}><span className={`dot ${st.dot}`} />{st.word}</span>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );

  const foot = (
    <footer className="cw-foot">
      <span className="cw-foot__drive" title={account.account ?? undefined}>
        <span className={`dot${connected ? " dot--ok" : ""}`} />
        {connected ? `${fmtCount(ov.uploaded_count)} posted${ov.error_count ? `, ${fmtCount(ov.error_count)} failed` : ""}` : "Not connected"}
      </span>
      <button type="button" className="linkbtn cw-foot__open" onClick={() => showMain({ go: "home" })}>Open Uploader</button>
    </footer>
  );

  return shell(<>{glanceBox}{dropZone}{queueList}{recentList}</>, foot);
}
