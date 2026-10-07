import { useEffect, useRef, useState } from "react";
import { useDialogFocus } from "./a11y";
import { Cover } from "./Cover";
import { Icon } from "./Icon";
import { toast, useLeave } from "./Desktop";
import { addToPlaylist, createPlaylist, fmtLength, mainGenre, playlistsWith, usePlaylists } from "../playlists";
import type { Playlist, Sharing } from "../types";
import "../playlists.css";

// "Add to playlist": pick one of your playlists, or start a new one, for one track or
// many ticked tracks. Opened from Your tracks (the ticked bar, right-click, a track's
// page). Uploader only. Styles in playlists.css (.plpick), both looks.

type Pick = { tracks: { id: number; title: string; genre?: string | null }[] };
type PickState = (Pick & { resolve: (p: Playlist | null) => void }) | null;
const subs = new Set<(s: PickState) => void>();

export function pickPlaylist(tracks: Pick["tracks"]): Promise<Playlist | null> {
  if (!subs.size || !tracks.length) return Promise.resolve(null);
  return new Promise((resolve) => subs.forEach((f) => f({ tracks, resolve })));
}

// Shows a playlist's page; set by the host so a track's page can link to its playlists.
let opener: (id: number) => void = () => {};

// Rendered once in the app. `onOpen` shows a playlist (from the toast after adding).
export function PlaylistPickHost({ onOpen }: { onOpen: (id: number) => void }) {
  const [s, setS] = useState<PickState>(null);
  useEffect(() => { subs.add(setS); return () => { subs.delete(setS); }; }, []);
  useEffect(() => { opener = onOpen; }, [onOpen]);
  if (!s) return null;
  return <PickBox s={s} onOpen={onOpen} done={(p) => { s.resolve(p); setS(null); }} />;
}

const NEW = -1;

function PickBox({ s, done: close, onOpen }: { s: NonNullable<PickState>; done: (p: Playlist | null) => void; onOpen: (id: number) => void }) {
  const [leaving, done] = useLeave(close);
  const { list } = usePlaylists();
  const ids = s.tracks.map((t) => t.id);
  const has = (p: Playlist) => ids.every((id) => p.tracks.some((t) => t.id === id));
  const [choice, setChoice] = useState<number | null>(null);
  const [name, setName] = useState("");
  const [sharing, setSharing] = useState<Sharing>("public");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement | null>(null);
  useDialogFocus(ref);
  // No playlists yet: go straight to naming a new one.
  const picked = choice ?? (list && list.length === 0 ? NEW : null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); done(null); } };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, []);

  const one = s.tracks.length === 1;
  const what = one ? `“${s.tracks[0].title}”` : `${s.tracks.length} tracks`;
  const target = picked === NEW ? null : (list ?? []).find((p) => p.id === picked) ?? null;
  const ready = picked === NEW ? name.trim().length > 0 : !!target && !has(target);

  async function go() {
    if (!ready || busy) return;
    setBusy(true); setErr(null);
    try {
      const p = picked === NEW
        ? await createPlaylist(name, sharing, ids)
        : await addToPlaylist(target!.id, ids);
      const added = picked === NEW ? ids.length : p.added ?? ids.length;
      const skipped = ids.length - added;
      toast(`${picked === NEW ? "Made" : "Added to"} ${p.title}${skipped ? ` (${skipped} already in it)` : ""}.`,
        { label: "Open", onClick: () => onOpen(p.id) });
      done(p);
    } catch (e) {
      setErr(String((e as Error).message));
      setBusy(false);
    }
  }

  return (
    <div className="wnew__scrim" data-leaving={leaving || undefined} onClick={() => done(null)}>
      <div ref={ref} className="wnew confirm plpick" role="dialog" aria-modal="true" aria-labelledby="plpick-title"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => { if (e.key === "Enter" && (e.target as HTMLElement).tagName === "INPUT") { e.preventDefault(); void go(); } }}>
        <div className="plpick__head">
          <div className="eyebrow">Add to playlist</div>
          <h2 id="plpick-title" className="col-trunc" title={what}>{what}</h2>
        </div>
        <div className="plpick__list" role="radiogroup" aria-label="Playlist">
          {list === null && <div className="plpick__wait faint">Getting your playlists…</div>}
          {(list ?? []).map((p) => {
            const inIt = has(p);
            return (
              <label key={p.id} className={`plpick__row${picked === p.id ? " plpick__row--on" : ""}${inIt ? " plpick__row--in" : ""}`}>
                <input type="radio" name="plpick" checked={picked === p.id} disabled={inIt}
                  onChange={() => setChoice(p.id)} />
                <PlaylistArt p={p} size={36} />
                <span className="plpick__name col-trunc" title={p.title}>{p.title}</span>
                <span className="plpick__n">{inIt ? (one ? "Already in it" : "All already in it") : `${p.track_count} ${p.track_count === 1 ? "track" : "tracks"}`}</span>
                {p.sharing === "private" ? <Icon name="lock" size={13} className="plpick__lock" title="Private" /> : <span />}
              </label>
            );
          })}
          <label className={`plpick__row plpick__row--new${picked === NEW ? " plpick__row--on" : ""}`}>
            <input type="radio" name="plpick" checked={picked === NEW} onChange={() => setChoice(NEW)} />
            <span className="plpick__plus" aria-hidden><Icon name="plus" size={16} /></span>
            <span className="plpick__name">New playlist</span>
            <span /><span />
          </label>
          {picked === NEW && (
            <div className="plpick__new">
              <input type="text" value={name} maxLength={100} autoFocus placeholder="Name it, e.g. Late night"
                aria-label="Playlist name" onChange={(e) => setName(e.target.value)} />
              <div className="seg" role="group" aria-label="Who can see it">
                {(["public", "private"] as Sharing[]).map((v) => (
                  <button key={v} type="button" className={`seg__opt${sharing === v ? " seg__opt--on" : ""}`}
                    aria-pressed={sharing === v} onClick={() => setSharing(v)}>{v === "public" ? "Public" : "Private"}</button>
                ))}
              </div>
            </div>
          )}
        </div>
        {err && <div className="mng-err plpick__err"><Icon name="alert" />{err}</div>}
        <div className="confirm__foot">
          <button type="button" className="btn btn--ghost confirm__cancel" onClick={() => done(null)}>Cancel</button>
          <button type="button" className="btn btn--primary" disabled={!ready || busy} onClick={() => void go()}>
            {busy ? "Adding…" : picked === NEW ? "Make playlist" : target ? `Add to ${target.title.length > 22 ? "playlist" : target.title}` : "Add"}
          </button>
        </div>
      </div>
    </div>
  );
}

// A playlist's cover: its own artwork, else the first four covers in a 2x2 grid, like
// a stack of records. An empty playlist gets a drawn cover from its name.
export function PlaylistArt({ p, size, className = "" }: { p: Playlist; size?: number; className?: string }) {
  if (p.artwork_url) {
    return <img src={p.artwork_url} alt="" className={`cover plart ${className}`.trim()}
      style={size ? { width: size, height: size, objectFit: "cover" } : undefined} />;
  }
  const four = p.tracks.slice(0, 4);
  if (four.length < 4) {
    const first = four[0];
    return <Cover name={first ? first.title : p.title} genre={first ? first.genre : mainGenre(p.tracks)} size={size}
      className={`plart ${className}`.trim()} label={!size || size >= 80} />;
  }
  return (
    <span className={`plart plart--grid ${className}`.trim()} style={size ? { width: size, height: size } : undefined} aria-hidden>
      {four.map((t) => t.artwork_url
        ? <img key={t.id} src={t.artwork_url} alt="" className="cover" />
        : <Cover key={t.id} name={t.title} genre={t.genre} label={false} />)}
    </span>
  );
}

// Plain-words summary under a playlist's name: "4 tracks · 48 min · Private".
export function playlistLine(p: Playlist, withPrivacy = true): string {
  return [`${p.track_count} ${p.track_count === 1 ? "track" : "tracks"}`, fmtLength(p.duration),
    withPrivacy ? (p.sharing === "private" ? "Private" : "Public") : ""].filter(Boolean).join(" · ");
}

// On a track's page: the playlists it is in (click one to open it) and a button to add it.
export function TrackPlaylists({ track }: { track: { id: number; title: string; genre?: string | null } }) {
  const { list } = usePlaylists();
  const inIt = playlistsWith(track.id, list ?? []);
  return (
    <div className="pl-in">
      <div className="field"><span>Playlists</span></div>
      <div className="pl-in__row">
        {list === null ? <span className="faint">…</span>
          : inIt.length === 0 ? <span className="faint">Not in a playlist yet.</span>
          : inIt.map((p) => (
            <button key={p.id} type="button" className="pl-in__chip" onClick={() => opener(p.id)} title={`Open ${p.title}`}>
              <PlaylistArt p={p} size={18} />{p.title}
            </button>
          ))}
        <button type="button" className="btn btn--ghost btn--sm" onClick={() => void pickPlaylist([track])}>
          <Icon name="plus" size={13} />Add to playlist…
        </button>
      </div>
    </div>
  );
}
