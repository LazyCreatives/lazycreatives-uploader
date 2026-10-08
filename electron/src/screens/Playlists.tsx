import { useEffect, useMemo, useRef, useState } from "react";
import { makeApi, openExternal, pickImage } from "../api";
import { askConfirm, Exit, openMenu, toast, toastWarn, type MenuItem } from "../components/Desktop";
import { copyText } from "../desktop";
import { Button, PageHeader, fmtDuration } from "../components/ui";
import { Icon } from "../components/Icon";
import { Art, PlayButton } from "../components/Player";
import { EmptyState } from "../components/SlothSpot";
import { NoteOpened } from "../components/Recents";
import { EditPanel, Overlay } from "./Manage";
import { PlaylistArt, playlistLine } from "../components/PlaylistPick";
import { rowKey } from "../components/a11y";
import { GENRES, genreColor } from "../look";
import { fuzzyScore } from "../fuzzy";
import {
  createPlaylist, deletePlaylist, detailChanges, fmtLength, joinTrack, mainGenre, moveItem, savePlaylist, setPlaylistCover,
  showOrder, usePlaylists,
} from "../playlists";
import type { Playlist, PlaylistTrack, Sharing, Track } from "../types";
import "../playlists.css";

// Playlists: your SoundCloud playlists ("sets"). Make one, add tracks from Your tracks,
// drag them into order, take them out. Every change goes to SoundCloud straight away.
// Playlists and their tracks show as rows in columns.

const api = makeApi();

// "Today", "Yesterday", "20 Mar", or "20 Mar 2025" for another year.
export function shortDay(iso: string | null | undefined, now: Date = new Date()): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  const y = new Date(now); y.setDate(now.getDate() - 1);
  if (d.toDateString() === now.toDateString()) return "Today";
  if (d.toDateString() === y.toDateString()) return "Yesterday";
  return d.toLocaleDateString(undefined, { day: "numeric", month: "short", ...(d.getFullYear() === now.getFullYear() ? {} : { year: "numeric" }) });
}

// Your tracks, for covers, projects and the "Add tracks" list. Loaded once per visit.
function useYourTracks(): [Track[] | null, (t: Track) => void] {
  const [t, setT] = useState<Track[] | null>(null);
  useEffect(() => { api.listTracks().then(setT).catch(() => setT([])); }, []);
  const keepOne = (u: Track) => setT((all) => (all ?? []).map((x) => (x.id === u.id ? u : x)));
  return [t, keepOne];
}

// song: one of your tracks open in its panel over the playlist (its id), or null.
export function Playlists({ open, song, onOpen, onClose, onOpenTrack, onCloseTrack }: {
  open: string | null; song: string | null; onOpen: (id: number | "new") => void; onClose: () => void;
  onOpenTrack: (id: string) => void; onCloseTrack: () => void;
}) {
  const { list, error, reload } = usePlaylists();
  const [yours, keepTrack] = useYourTracks();
  const byId = useMemo(() => new Map((yours ?? []).map((t) => [t.id, t])), [yours]);
  const openId = open && open !== "new" ? Number(open) : null;
  const current = openId != null ? (list ?? []).find((p) => p.id === openId) ?? null : null;

  if (openId != null && current) {
    const editing = song ? byId.get(Number(song)) ?? null : null;
    return (<>
      <PlaylistPage key={current.id} p={current} yours={yours} byId={byId} onBack={onClose} onOpenTrack={onOpenTrack} />
      {editing && <NoteOpened id={String(editing.id)} name={editing.title} cover={editing.project_match || editing.title}
        genre={editing.project_match ? editing.project_genre : editing.genre} />}
      <Exit>{editing && (
        <EditPanel track={editing} defaultArt={null} onClose={onCloseTrack}
          onSaved={(t) => { keepTrack(t); onCloseTrack(); void reload(); }} />
      )}</Exit>
    </>);
  }
  return <PlaylistList list={list} error={error} reload={reload} composing={open === "new"}
    onOpen={onOpen} onCompose={() => onOpen("new")} onComposed={onClose} />;
}

// ── the list of playlists ────────────────────────────────────────────────────

function PlaylistList({ list, error, reload, composing, onOpen, onCompose, onComposed }: {
  list: Playlist[] | null; error: string | null; reload: () => Promise<void>; composing: boolean;
  onOpen: (id: number) => void; onCompose: () => void; onComposed: () => void;
}) {
  const empty = list !== null && list.length === 0;
  return (
    <div>
      <PageHeader title="Playlists"
        sub="Your SoundCloud playlists. Tracks keep the order you give them."
        actions={<>
          <Button kind="quiet" onClick={() => void reload()}><Icon name="refresh" />Refresh</Button>
          {!composing && !empty && <Button kind="primary" onClick={onCompose}><Icon name="plus" />New playlist</Button>}
        </>} />
      {error && <div className="mng-err" style={{ marginBottom: 12 }}><Icon name="alert" />{error}</div>}
      {(composing || empty) && <Composer first={empty} onMade={(p) => { onComposed(); onOpen(p.id); }} onCancel={empty ? undefined : onComposed} />}
      {list === null && <div className="table"><div className="row faint pl-wait">Getting your playlists from SoundCloud…</div></div>}
      {list && list.length > 0 && (
          <div className="table table--crate">
            <div className="row cols cols-head pl-cols">
              <span /><span /><span>Playlist</span><span className="col-num">Tracks</span>
              <span className="col-num">Length</span><span>Privacy</span><span className="col-num">Changed</span><span />
            </div>
            {list.map((p) => <PlaylistRow key={p.id} p={p} onOpen={() => onOpen(p.id)} />)}
          </div>
      )}
    </div>
  );
}

function listMenu(p: Playlist, open: () => void): MenuItem[] {
  return [
    { label: "Open", onClick: open },
    ...(p.permalink_url ? [
      { label: "Open on SoundCloud", onClick: () => openExternal(p.permalink_url!) },
      { label: "Copy SoundCloud link", onClick: () => { copyText(p.permalink_url!); } }] : []),
    "-",
    { label: p.sharing === "private" ? "Make public" : "Make private",
      onClick: () => void savePlaylist(p.id, { sharing: p.sharing === "private" ? "public" : "private" }).catch((e) => toastWarn(String(e.message))) },
    "-",
    { label: "Delete playlist…", danger: true, onClick: () => void confirmDelete(p) },
  ];
}

async function confirmDelete(p: Playlist, after?: () => void) {
  const ok = await askConfirm({
    title: `Delete “${p.title}”?`,
    body: "The playlist goes from SoundCloud. Its tracks stay where they are.",
    confirm: "Delete playlist", danger: true,
  });
  if (!ok) return;
  try { await deletePlaylist(p.id); toast(`Deleted ${p.title}.`); after?.(); }
  catch (e) { toastWarn(String((e as Error).message)); }
}

function PlaylistRow({ p, onOpen }: { p: Playlist; onOpen: () => void }) {
  return (
    <div className="row cols pl-cols pl-row" role="button" tabIndex={0} onClick={onOpen} onKeyDown={rowKey(onOpen)}
      onContextMenu={(e) => openMenu(e, listMenu(p, onOpen))}>
      <span className="stripe" style={{ background: genreColor(mainGenre(p.tracks)) }} />
      <PlaylistArt p={p} size={36} />
      <div className="row__main">
        <div className="row__title" title={p.title}>{p.title}</div>
        <div className="row__sub col-trunc">{p.tracks.slice(0, 3).map((t) => t.title).join(", ") || "Empty so far"}</div>
      </div>
      <span className="col-num">{p.track_count}</span>
      <span className="col-num">{fmtLength(p.duration) || "—"}</span>
      <span className={`pill ${p.sharing === "private" ? "pill--private" : "pill--ok"}`}>{p.sharing === "private" ? "Private" : "Public"}</span>
      <span className="col-num faint">{shortDay(p.last_modified || p.created_at) || "—"}</span>
      <span className="col-act"><Icon name="more" /></span>
    </div>
  );
}

// Name a new playlist, choose who can see it. Tracks come after, on its page.
function Composer({ first, onMade, onCancel }: { first: boolean; onMade: (p: Playlist) => void; onCancel?: () => void }) {
  const [name, setName] = useState("");
  const [sharing, setSharing] = useState<Sharing>("public");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  async function make() {
    if (!name.trim() || busy) return;
    setBusy(true); setErr(null);
    try { onMade(await createPlaylist(name, sharing)); }
    catch (e) { setErr(String((e as Error).message)); setBusy(false); }
  }
  return (
    <div className={`pl-compose${first ? " pl-compose--first" : ""}`}>
      {first && <EmptyState pose="empty-crate" title="No playlists yet" say="One crate. Fill it slowly.">
        Name one here, then add tracks to it from its page or from Your tracks.
      </EmptyState>}
      <div className="pl-compose__row">
        <input type="text" value={name} maxLength={100} autoFocus placeholder="Name your playlist, e.g. Late night"
          aria-label="Playlist name" onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") void make(); if (e.key === "Escape" && onCancel) onCancel(); }} />
        <div className="seg" role="group" aria-label="Who can see it">
          {(["public", "private"] as Sharing[]).map((v) => (
            <button key={v} type="button" className={`seg__opt${sharing === v ? " seg__opt--on" : ""}`}
              aria-pressed={sharing === v} onClick={() => setSharing(v)}>{v === "public" ? "Public" : "Private"}</button>
          ))}
        </div>
        <Button kind="primary" disabled={!name.trim() || busy} onClick={() => void make()}>{busy ? "Making…" : "Make playlist"}</Button>
        {onCancel && <Button kind="quiet" onClick={onCancel}>Cancel</Button>}
      </div>
      {err && <div className="mng-err"><Icon name="alert" />{err}</div>}
    </div>
  );
}

// ── one playlist ─────────────────────────────────────────────────────────────

type Row = PlaylistTrack & Partial<Track>;

function PlaylistPage({ p, yours, byId, onBack, onOpenTrack }: {
  p: Playlist; yours: Track[] | null; byId: Map<number, Track>; onBack: () => void; onOpenTrack: (id: string) => void;
}) {
  const [saving, setSaving] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [editing, setEditing] = useState(false);
  const [adding, setAdding] = useState(p.tracks.length === 0);
  const rows: Row[] = p.tracks.map((t) => joinTrack(t, byId));
  const ids = p.tracks.map((t) => t.id);
  const genre = mainGenre(rows);

  async function save(change: Parameters<typeof savePlaylist>[1], undo?: () => void) {
    setSaving(true);
    try { await savePlaylist(p.id, change); }
    catch (e) { undo?.(); toastWarn(String((e as Error).message)); }
    finally { setSaving(false); }
  }
  const setOrder = (next: number[]) => {
    const before = ids;
    showOrder(p.id, next);
    void save({ track_ids: next }, () => showOrder(p.id, before));
  };
  const remove = (id: number) => {
    const t = rows.find((r) => r.id === id);
    setOrder(ids.filter((x) => x !== id));
    if (t) toast(`Took ${t.title} out of ${p.title}.`, { label: "Undo", onClick: () => void save({ track_ids: ids }) });
  };
  const add = (more: number[]) => save({ track_ids: [...ids, ...more.filter((x) => !ids.includes(x))] });

  const pageMenu: MenuItem[] = [
    { label: "Edit details…", onClick: () => setEditing(true) },
    { label: "Rename", onClick: () => setRenaming(true) },
    ...(p.permalink_url ? [{ label: "Copy SoundCloud link", onClick: () => { copyText(p.permalink_url!); } }] : []),
    "-",
    { label: "Delete playlist…", danger: true, onClick: () => void confirmDelete(p, onBack) },
  ];

  return (
    <div className="plpage plpage--crate">
      <button type="button" className="linkbtn plpage__back" onClick={onBack}><Icon name="arrowLeft" size={14} />Playlists</button>
      <header className="plpage__head">
        <PlaylistArt p={p} size={96} className="plpage__art" />
        <div className="plpage__info">
          <div className="eyebrow">Playlist{p.sharing === "private" ? " · Private" : ""}</div>
          {renaming
            ? <RenameBox title={p.title} onDone={(t) => { setRenaming(false); if (t && t !== p.title) void save({ title: t }); }} />
            : <h1 className="plpage__title" title="Double-click to rename" onDoubleClick={() => setRenaming(true)}>{p.title}</h1>}
          <div className="plpage__line">
            {playlistLine(p, false) || "Empty so far"}
            <span className="plpage__saved faint" aria-live="polite">{saving ? "Saving to SoundCloud…" : ""}</span>
          </div>
          {(p.genre || (p.tags ?? []).length > 0) && (
            <div className="plpage__tags">
              {p.genre && <span className="plpage__genre"><span className="pl-dot" style={{ background: genreColor(p.genre) }} />{p.genre}</span>}
              {(p.tags ?? []).map((t) => <span key={t} className="plpage__tag">{t}</span>)}
            </div>
          )}
          {p.description && <p className="plpage__desc" title={p.description}>{p.description}</p>}
          <div className="plpage__actions">
            <Button kind={adding ? "ghost" : "primary"} sm onClick={() => setAdding((a) => !a)}>
              <Icon name={adding ? "close" : "plus"} size={14} />{adding ? "Done adding" : "Add tracks"}
            </Button>
            <Button sm onClick={() => setEditing(true)}><Icon name="edit" size={14} />Edit details</Button>
            <Button sm onClick={() => void save({ sharing: p.sharing === "private" ? "public" : "private" })} disabled={saving}>
              {p.sharing === "private" ? "Make public" : "Make private"}
            </Button>
            {p.permalink_url && <Button kind="quiet" sm onClick={() => openExternal(p.permalink_url!)}><Icon name="external" size={14} />SoundCloud</Button>}
            <button type="button" className="iconbtn" aria-label="More" title="More"
              onClick={(e) => { const r = (e.currentTarget as HTMLElement).getBoundingClientRect(); openMenu({ preventDefault() {}, stopPropagation() {}, clientX: r.left, clientY: r.bottom + 4 }, pageMenu); }}>
              <Icon name="more" />
            </button>
          </div>
        </div>
      </header>

      {rows.length > 0
        ? <TrackList rows={rows} genre={genre} onOrder={setOrder} onRemove={remove}
            canOpen={(id) => byId.has(id)} onOpen={(id) => onOpenTrack(String(id))} />
        : !adding && <div className="table"><EmptyState pose="napping" title="Nothing in it yet" say="Plenty of room.">
            Press Add tracks, or tick tracks in Your tracks and choose Add to playlist.
          </EmptyState></div>}

      {adding && <AddTracks yours={yours} inIt={new Set(ids)} onAdd={add} />}
      <Exit>{editing && <PlaylistDetails p={p} onClose={() => setEditing(false)} />}</Exit>
    </div>
  );
}

// Edit what SoundCloud keeps about a playlist: name, description, genre, tags, who can
// see it, and its cover. Only what changed is sent, so the songs in it stay as they are.
function PlaylistDetails({ p, onClose }: { p: Playlist; onClose: () => void }) {
  const [title, setTitle] = useState(p.title);
  const [description, setDescription] = useState(p.description || "");
  const [genre, setGenre] = useState(p.genre || "");
  const [sharing, setSharing] = useState<Sharing>(p.sharing);
  const [tags, setTags] = useState<string[]>(p.tags ?? []);
  const [tagDraft, setTagDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [artBusy, setArtBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const allTags = () => [...tags, ...tagDraft.split(",").map((t) => t.trim()).filter(Boolean)];
  const change = detailChanges(p, { title, description, genre, tags: allTags(), sharing });
  const dirty = Object.keys(change).length > 0;

  async function save() {
    if (busy || !title.trim()) return;
    if (!dirty) { onClose(); return; }
    setBusy(true); setErr(null);
    try { await savePlaylist(p.id, change); toast(`Saved ${title.trim()}.`); onClose(); }
    catch (e) { setErr(String((e as Error).message)); setBusy(false); }
  }
  const asking = useRef(false);
  async function close() {
    if (asking.current) return;
    if (dirty && !busy) {
      asking.current = true;
      const ok = await askConfirm({ title: "Discard your changes?", body: "Your changes to this playlist won’t be saved.",
        confirm: "Discard", cancel: "Keep editing" });
      setTimeout(() => { asking.current = false; }, 0);
      if (!ok) return;
    }
    onClose();
  }
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") { e.preventDefault(); void save(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });
  async function changeCover() {
    const path = await pickImage();
    if (!path) return;
    setArtBusy(true); setErr(null);
    try { await setPlaylistCover(p.id, path); toast("Cover changed on SoundCloud."); }
    catch (e) { setErr(String((e as Error).message)); }
    finally { setArtBusy(false); }
  }
  function addTag(tag: string) {
    const t = tag.trim().replace(/,$/, "").trim();
    if (!t) return;
    setTags((prev) => prev.some((x) => x.toLowerCase() === t.toLowerCase()) ? prev : [...prev, t]);
  }
  function onTagKey(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter" || e.key === ",") { e.preventDefault(); addTag(tagDraft); setTagDraft(""); }
    else if (e.key === "Backspace" && !tagDraft && tags.length) setTags((prev) => prev.slice(0, -1));
  }

  return (
    <Overlay onClose={() => void close()} label={`Edit ${p.title}`}>
      <div className="mng-panel__head mng-edit__head">
        <PlaylistArt p={p} size={48} />
        <div className="mng-edit__who">
          <h2 className="col-trunc" title={p.title}>{p.title}</h2>
          <span className="faint">Playlist · {playlistLine(p, false) || "Empty so far"}</span>
        </div>
        <button type="button" className="mng-panel__close" onClick={() => void close()} aria-label="Close"><Icon name="close" /></button>
      </div>
      <div className="mng-panel__body">
        <label className="field"><span>Name</span>
          <input type="text" value={title} maxLength={100} autoFocus aria-label="Playlist name" onChange={(e) => setTitle(e.target.value)} /></label>
        <label className="field"><span>Description</span>
          <textarea value={description} maxLength={4000} placeholder="What it is, when to play it, who made the cover…"
            onChange={(e) => setDescription(e.target.value)} /></label>
        <div className="mng-edit__pair">
          <label className="field"><span>Genre</span>
            <input type="text" value={genre} onChange={(e) => setGenre(e.target.value)} list="lc-pl-genres" placeholder="Pick or type a genre" />
            <datalist id="lc-pl-genres">{GENRES.map((g) => <option key={g} value={g} />)}</datalist></label>
          <label className="field"><span>Privacy</span>
            <select value={sharing} onChange={(e) => setSharing(e.target.value as Sharing)}>
              <option value="public">Public</option>
              <option value="private">Private</option>
            </select></label>
        </div>
        <div className="field"><span>Tags</span>
          <div className="tagbox" onClick={(e) => (e.currentTarget.querySelector("input") as HTMLInputElement | null)?.focus()}>
            {tags.map((t) => (
              <span key={t} className="tagbox__tag">{t}
                <button type="button" aria-label={`Remove ${t}`} onClick={() => setTags((prev) => prev.filter((x) => x !== t))}><Icon name="close" size={11} /></button>
              </span>
            ))}
            <input type="text" value={tagDraft} onChange={(e) => setTagDraft(e.target.value)} onKeyDown={onTagKey}
              onBlur={() => { addTag(tagDraft); setTagDraft(""); }}
              placeholder={tags.length ? "Add a tag" : "Type a tag and press Enter"} aria-label="Add a tag" />
          </div>
        </div>
        <div className="mng-cover">
          <div className="field"><span>Cover</span></div>
          <div className="art-row">
            <PlaylistArt p={p} size={56} />
            <Button sm onClick={() => void changeCover()} disabled={artBusy || busy}>{artBusy ? "Working…" : "Change cover…"}</Button>
            <span className="faint pl-cover-note">{p.artwork_url ? "" : "Until you pick one, SoundCloud shows the first song’s cover."}</span>
          </div>
        </div>
        {err && <div className="mng-err"><Icon name="alert" />{err}</div>}
      </div>
      <div className="mng-panel__foot">
        <span className="mng-edit__hint faint">{dirty ? "Unsaved changes" : ""}</span>
        <Button sm onClick={() => void close()} disabled={busy}>Cancel</Button>
        <Button kind="primary" sm onClick={() => void save()} disabled={busy || !dirty || !title.trim()}
          title={`Save (${navigator.platform.includes("Mac") ? "⌘" : "Ctrl+"}S)`}>{busy ? "Saving…" : "Save"}</Button>
      </div>
    </Overlay>
  );
}

function RenameBox({ title, onDone }: { title: string; onDone: (t: string | null) => void }) {
  const [v, setV] = useState(title);
  return (
    <input className="plpage__rename" value={v} maxLength={100} autoFocus aria-label="Playlist name"
      onChange={(e) => setV(e.target.value)} onBlur={() => onDone(v.trim() || null)}
      onKeyDown={(e) => { if (e.key === "Enter") onDone(v.trim() || null); if (e.key === "Escape") onDone(null); }} />
  );
}

// A click on a playlist row opens the track, unless it landed on something in the row
// with its own job: the drag grip, play, or take out.
export function clickOpensRow(target: EventTarget | null, row: Element): boolean {
  const el = target instanceof Element ? target : null;
  if (!el || !row.contains(el)) return false;
  const control = el.closest("button, a, input, .pl-grip");
  return !control || !row.contains(control);
}

// The tracks in order. Click a row (or press Enter on it) to open the track's page.
// Drag a row by its grip (or anywhere) to move it; Alt+Up/Down moves the focused row;
// right-click has Move to top/bottom and Take out.
function TrackList({ rows, genre, onOrder, onRemove, canOpen, onOpen }: {
  rows: Row[]; genre: string | null; onOrder: (ids: number[]) => void; onRemove: (id: number) => void;
  canOpen: (id: number) => boolean; onOpen: (id: number) => void;
}) {
  const ids = rows.map((r) => r.id);
  const [drag, setDrag] = useState<number | null>(null);
  const [over, setOver] = useState<number | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  const move = (from: number, to: number) => { if (from !== to) onOrder(moveItem(ids, from, to)); };
  const focusRow = (i: number) => requestAnimationFrame(() =>
    listRef.current?.querySelectorAll<HTMLElement>("[data-pl-row]")[i]?.focus());

  return (
    <div ref={listRef} className="table table--crate" style={{ ["--genre" as string]: genreColor(genre) }}>
      <div className="row cols cols-head pl-track-cols">
        <span /><span className="col-num">#</span><span /><span /><span>Track</span><span>Genre</span>
        <span className="col-num">Length</span><span>Privacy</span><span />
      </div>
      {rows.map((t, i) => {
        const meta = { title: t.title, sub: t.project_match ? `From ${t.project_match}` : t.user ? `by ${t.user}` : t.genre || "",
          art: t.artwork_url, cover: t.project_match || t.title, genre: t.project_match ? t.project_genre : t.genre };
        const priv = t.sharing === "private";
        const opens = canOpen(t.id);  // your own tracks have a page; other people's don't
        const menu: MenuItem[] = [
          ...(opens ? [{ label: "Open track", onClick: () => onOpen(t.id) }] : []),
          ...(t.permalink_url ? [{ label: "Open on SoundCloud", onClick: () => openExternal(t.permalink_url!) }, "-" as const] : []),
          { label: "Move to top", disabled: i === 0, onClick: () => move(i, 0) },
          { label: "Move up", disabled: i === 0, onClick: () => move(i, i - 1) },
          { label: "Move down", disabled: i === rows.length - 1, onClick: () => move(i, i + 1) },
          { label: "Move to bottom", disabled: i === rows.length - 1, onClick: () => move(i, rows.length - 1) },
          "-",
          { label: "Take out of this playlist", danger: true, onClick: () => onRemove(t.id) },
        ];
        const cls = ["row cols pl-track-cols", "pl-drag",
          opens ? "pl-open" : "", drag === i ? "pl-drag--lifted" : "", over === i && drag !== null && drag !== i ? (drag < i ? "pl-drag--below" : "pl-drag--above") : ""].join(" ");
        return (<div key={t.id}>
          <div className={cls} data-pl-row tabIndex={0} draggable
            aria-label={`${i + 1}. ${t.title}.${opens ? " Enter opens it." : ""} Alt and arrow keys move it.`}
            onClick={opens ? (e) => { if (clickOpensRow(e.target, e.currentTarget)) onOpen(t.id); } : undefined}
            onDragStart={(e) => { setDrag(i); e.dataTransfer.effectAllowed = "move"; e.dataTransfer.setData("text/plain", String(t.id)); }}
            onDragEnter={() => setOver(i)}
            onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = "move"; }}
            onDrop={(e) => { e.preventDefault(); if (drag !== null) move(drag, i); setDrag(null); setOver(null); }}
            onDragEnd={() => { setDrag(null); setOver(null); }}
            onKeyDown={(e) => {
              if (e.altKey && e.key === "ArrowUp" && i > 0) { e.preventDefault(); move(i, i - 1); focusRow(i - 1); }
              else if (e.altKey && e.key === "ArrowDown" && i < rows.length - 1) { e.preventDefault(); move(i, i + 1); focusRow(i + 1); }
              else if (e.key === "Delete" || e.key === "Backspace") { e.preventDefault(); onRemove(t.id); }
              else if (opens && e.key === "Enter" && e.target === e.currentTarget) { e.preventDefault(); onOpen(t.id); }
            }}
            onContextMenu={(e) => openMenu(e, menu)}>
            <>
              <span className="pl-grip" aria-hidden title="Drag to move"><Icon name="rows" size={14} /></span>
              <span className="col-num faint">{i + 1}</span>
              {t.local_path ? <PlayButton path={t.local_path} meta={meta} size={28} /> : <span />}
              <Art meta={meta} size={36} />
              <div className="row__main">
                <div className="row__title" title={t.title}>{t.title}</div>
                <div className="row__sub col-trunc">{meta.sub}</div>
              </div>
              <span className="col-trunc">
                {t.genre ? <><span className="pl-dot" style={{ background: genreColor(t.genre) }} />{t.genre}</> : <span className="faint">—</span>}
              </span>
              <span className="col-num">{t.duration ? fmtDuration(t.duration) : "—"}</span>
              <span className={`pill ${priv ? "pill--private" : "pill--ok"}`}>{priv ? "Private" : "Public"}</span>
              <span className="col-act">
                <button type="button" className="iconbtn" aria-label={`Take ${t.title} out`} title="Take out of this playlist"
                  onClick={() => onRemove(t.id)}><Icon name="close" /></button>
              </span>
            </>
          </div>
        </div>);
      })}
    </div>
  );
}

// Your tracks that aren't in the playlist yet, with a search. "+" adds one to the end.
function AddTracks({ yours, inIt, onAdd }: { yours: Track[] | null; inIt: Set<number>; onAdd: (ids: number[]) => Promise<void> }) {
  const [q, setQ] = useState("");
  const left = (yours ?? []).filter((t) => !inIt.has(t.id));
  const shown = q.trim() ? left.filter((t) => fuzzyScore(q, [t.title, t.genre, t.project_match, ...(t.tags || [])]) > 0) : left;
  return (
    <section className="pl-add" aria-label="Add tracks">
      <div className="pl-add__head">
        <h2>Add from your tracks</h2>
        <label className="find__search pl-add__search">
          <Icon name="search" size={15} />
          <input type="search" value={q} autoFocus onChange={(e) => setQ(e.target.value)} placeholder="Search your tracks…"
            aria-label="Search your tracks" spellCheck={false} onKeyDown={(e) => { if (e.key === "Escape") setQ(""); }} />
        </label>
        {shown.length > 1 && <Button sm onClick={() => void onAdd(shown.map((t) => t.id))}>Add all {shown.length}</Button>}
      </div>
      {yours === null && <div className="faint pl-wait">Getting your tracks…</div>}
      {yours && left.length === 0 && <div className="faint pl-wait">Every one of your tracks is in this playlist.</div>}
      {yours && left.length > 0 && shown.length === 0 && <div className="faint pl-wait">Nothing matches “{q}”.</div>}
      <div className="pl-add__list">
        {shown.slice(0, 200).map((t) => {
          const meta = { title: t.title, art: t.artwork_url, cover: t.project_match || t.title, genre: t.project_match ? t.project_genre : t.genre };
          return (
            <button key={t.id} type="button" className="pl-add__row" onClick={() => void onAdd([t.id])} title={`Add ${t.title}`}>
              <Art meta={meta} size={32} />
              <span className="pl-add__title col-trunc">{t.title}</span>
              <span className="pl-add__meta faint">{[t.genre, t.duration ? fmtDuration(t.duration) : ""].filter(Boolean).join(" · ")}</span>
              <span className="pl-add__plus" aria-hidden><Icon name="plus" size={14} /></span>
            </button>
          );
        })}
      </div>
      {shown.length > 200 && <div className="faint pl-wait">Showing the first 200. Search to find the rest.</div>}
    </section>
  );
}

