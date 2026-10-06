import { useEffect, useState } from "react";
import { makeApi, openExternal } from "../api";
import type { Account, Mix, Overview, UploadRow } from "../types";
import { Button, fmtBytes, fmtWhen, ProBadge } from "../components/ui";
import { ConnectPanel } from "../components/Connect";
import { Info } from "../components/Info";
import { Icon } from "../components/Icon";
import { UploadTable } from "./History";
import { Cover } from "../components/Cover";
import { PlayButton } from "../components/Player";
import { EmptyState } from "../components/SlothSpot";
import { useLook } from "../look";

const api = makeApi();

// Mixes in the watched folders that haven't gone up yet (an extra format of the
// same mix doesn't count), and the most recently exported one.
export function waitingMixes(mixes: Mix[] | null): { count: number; newest: Mix | null } {
  const fresh = (mixes ?? []).filter((m) => !m.uploaded && !m.superseded_by);
  const newest = fresh.reduce<Mix | null>((a, m) => (!a || m.mtime > a.mtime ? m : a), null);
  return { count: fresh.length, newest };
}
export const readyHeadline = (n: number) => `${n} new ${n === 1 ? "mix" : "mixes"} ready to post.`;
export const readyInFolder = (n: number) => `${n} ${n === 1 ? "mix is" : "mixes are"} ready in your folder.`;

export function Home({ account, onAccount, onUpload, onHistory }: {
  account: Account; onAccount: (a: Account) => void; onUpload: () => void; onHistory?: () => void;
}) {
  const [look] = useLook();
  const [ov, setOv] = useState<Overview | null>(null);
  const [recent, setRecent] = useState<UploadRow[] | null>(null);
  const [mixes, setMixes] = useState<Mix[] | null>(null);
  useEffect(() => {
    api.overview().then(setOv).catch(() => setOv(null));
    api.history(6).then(setRecent).catch(() => setRecent([]));
    api.scan().then(setMixes).catch(() => setMixes(null));  // same list as the Upload page
  }, [account]);
  const waiting = waitingMixes(mixes);
  const ready = account.connected && waiting.count > 0;

  const posted = ov?.uploaded_count ?? 0;
  const headline = ready ? readyHeadline(waiting.count)
    : !ov ? " "
    : posted === 0 ? "Nothing posted yet."
    : ov.error_count ? `${posted} posted, ${ov.error_count} need a look.`
    : `${posted} ${posted === 1 ? "track" : "tracks"} posted, no problems.`;

  const demo = ov?.mock && (
    <div className="banner banner--demo">
      <Icon name="info" className="banner__icon" />
      Demo mode: no SoundCloud keys are set up, so uploads go to a pretend account.
    </div>
  );
  const schedLine = <>
    {ov?.last_upload ? `Last upload ${fmtWhen(ov.last_upload)}` : "No uploads yet"}
    {ov && ` · auto-upload ${ov.schedule.enabled ? `every ${ov.schedule.interval_minutes} min` : "off"}`}
  </>;
  const posts = (recent ?? []).filter((r) => r.status === "uploaded");
  const subText = ready && waiting.newest
    ? `Newest: ${waiting.newest.name}, exported ${fmtWhen(new Date(waiting.newest.mtime * 1000).toISOString())}`
    : "Drop finished mixes in your watched folder and post them in one go. The same mix is never posted twice.";
  const mainButton = <Button kind="primary" onClick={onUpload} disabled={!account.connected}>
    {ready ? "Review and post" : "Upload new mixes"}</Button>;
  // The empty "Latest uploads" box: point at the mixes waiting, if there are any.
  const emptyBox = (
    <div className="table"><EmptyState pose={ready ? "waving" : "napping"} title="Nothing posted yet" say={ready ? "Your mixes are waiting. Go on." : "Wake me when there’s a mix."}
      action={ready ? <Button sm onClick={onUpload}>Post your first mix</Button> : undefined}>
      {ready ? readyInFolder(waiting.count) : "Your first upload will show up here."}
    </EmptyState></div>
  );

  if (look === "sleeve") return (
    <div>
      {demo}
      <header className="up-hero">
        <div className="up-hero__text">
          <h1>{headline}</h1>
          <p className="sub">{subText}</p>
          <p className="statusline"><Icon name="history" size={13} />{schedLine}</p>
          <div>{mainButton}</div>
        </div>
        <dl className="up-hero__stats">
          <div><dt>Posted</dt><dd>{ov ? posted : "—"}<span>{ov ? fmtBytes(ov.uploaded_bytes) : ""}</span></dd></div>
          <div><dt>Failed</dt><dd className={ov?.error_count ? "warn-text" : ""}>{ov ? ov.error_count : "—"}<span>{ov?.error_count ? "see History" : "all clear"}</span></dd></div>
          <div><dt>Going public later</dt><dd>{ov ? ov.scheduled_count : "—"}<span>scheduled</span></dd></div>
          <div><dt>Auto-upload</dt><dd>{ov?.schedule.enabled ? "On" : "Off"}<span>{ov?.schedule.enabled ? `every ${ov.schedule.interval_minutes} min` : "by hand"}</span></dd></div>
        </dl>
      </header>

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
        {recent && posts.length === 0
          ? emptyBox
          : <div className="up-shelf">
              {posts.slice(0, 6).map((r) => (
                <div key={r.id} className="sleeve" role={r.permalink_url ? "button" : undefined} tabIndex={r.permalink_url ? 0 : undefined}
                  onClick={() => r.permalink_url && openExternal(r.permalink_url)}
                  onKeyDown={(e) => { if (e.key === "Enter" && r.permalink_url) openExternal(r.permalink_url); }}>
                  <div className="sleeve__art">
                    <Cover name={r.project_match || r.title} genre={r.project_genre} />
                    <span className="sleeve__badge"><span className={`dot ${r.sharing === "private" ? "dot--warn" : "dot--ok"}`} />{r.sharing === "private" ? "Private" : "Public"}</span>
                    <PlayButton path={r.file_path} meta={{ title: r.title, sub: r.project_match ? `From ${r.project_match}` : `Posted ${fmtWhen(r.timestamp)}`, cover: r.project_match || r.title, genre: r.project_genre }} size={34} className="sleeve__play" />
                  </div>
                  <div className="sleeve__meta">
                    <div className="sleeve__name" title={r.title}>{r.title}</div>
                    <div className="sleeve__sub">Posted {fmtWhen(r.timestamp)}</div>
                  </div>
                </div>
              ))}
            </div>}
      </section>
    </div>
  );

  return (
    <div>
      {demo}

      <header className="page-head">
        <div>
          <h1>{headline}</h1>
          <p className="sub">{subText}</p>
          <p className="statusline"><Icon name="history" size={13} />{schedLine}</p>
        </div>
        <div className="page-head__actions">
          {mainButton}
        </div>
      </header>

      {!account.connected && (
        <section className="card section">
          <h2>Connect your SoundCloud</h2>
          <ConnectPanel account={account} onChange={onAccount} />
        </section>
      )}

      <div className="figures">
        <div className="figure">
          <div className="figure__label"><span className="dot dot--ok" />Posted
            <Info text="Tracks posted to SoundCloud, and the total audio uploaded." /></div>
          <div className="figure__value">{ov ? posted : "—"}</div>
          <div className="figure__hint">{ov ? fmtBytes(ov.uploaded_bytes) : ""}</div>
        </div>
        <div className="figure">
          <div className="figure__label"><span className={`dot${ov?.error_count ? " dot--error" : ""}`} />Failed</div>
          <div className="figure__value">{ov ? ov.error_count : "—"}</div>
          <div className="figure__hint">{ov?.error_count ? "see History" : "all clear"}</div>
        </div>
        <div className="figure">
          <div className="figure__label">Waiting to go public</div>
          <div className="figure__value">{ov ? ov.scheduled_count : "—"}</div>
          <div className="figure__hint">scheduled releases</div>
        </div>
        <div className="figure">
          <div className="figure__label">Auto-upload
            <Info text="Watch a folder and post new renders automatically. Turn it on in Settings." /></div>
          <div className="figure__value">{ov?.schedule.enabled ? "On" : "Off"}</div>
          <div className="figure__hint">{ov?.schedule.enabled ? `every ${ov.schedule.interval_minutes} min` : "you post by hand"}</div>
        </div>
      </div>

      <section className="section">
        <div className="section__head">
          <h2>Latest uploads</h2>
          {onHistory && recent && recent.length > 0 &&
            <button className="linkbtn" onClick={onHistory}>See all in History</button>}
        </div>
        {recent && recent.length === 0
          ? emptyBox
          : <UploadTable rows={recent ?? []} />}
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
