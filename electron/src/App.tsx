import { useEffect, useRef, useState } from "react";
import { makeApi, makeCoverSource, readImage } from "./api";
import { Nav, type Tab } from "./components/Nav";
import { LcBrand } from "./components/LcBrand";
import { PlayerBar, togglePlaying } from "./components/Player";
import { currentTheme, genreColor, toggleTheme, useGenreColors } from "./look";
import { PaletteHost, openPalette, type PaletteItem } from "./components/Palette";
import { smartCrates } from "./smart";
import { IS_MAC } from "./desktop";
import { COMPANION_KEYS, openCompanion, useCompanionCommand } from "./companion";
import { NO_FILTERS, type TrackFilters } from "./trackFilter";
import { Manage, showTracks } from "./screens/Manage";
import type { Track } from "./types";
import { Setup } from "./screens/Setup";
import { Home } from "./screens/Home";
import { Upload } from "./screens/Upload";
import { History } from "./screens/History";
import { Playlists } from "./screens/Playlists";
import { PlaylistPickHost } from "./components/PlaylistPick";
import { loadPlaylists, playlistPlace, playlistsNow, songOnPlaylist } from "./playlists";
import { Settings } from "./screens/Settings";
import { WhatsNewHost, openWhatsNew } from "./components/WhatsNew";
import { ConfirmHost, ContextMenuHost, DropZone, ShortcutsPanel, ToastHost, toast, toastWarn } from "./components/Desktop";
import { GenrePickHost } from "./components/GenrePick";
import { CoverPickHost } from "./components/CoverPick";
import { changeCovers, coverState, setCoverSource, shrinkImage } from "./coverArt";
import { baseName, folderOf, isInside, keep, pageNumber, recall, useDesktopCommands, useEscapeToClose, useFileDrop, useIconProgress, type Dropped } from "./desktop";
import { useLiveProgress } from "./useProgress";
import type { Account, Config, Entitlement } from "./types";
import { EmptyState } from "./components/SlothSpot";
import { useBackForwardInput, useNav, type Place } from "./nav";
import { getRecents, openedWhen } from "./recents";

const api = makeApi();
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;
const TABS: Tab[] = ["home", "upload", "manage", "playlists", "history", "settings"];
const LAST_PAGE = "lc-last-page";

// Mixes Uploader can post; dropping one adds the folder it sits in.
const AUDIO_FILE = /\.(wav|aiff?|flac|mp3|m4a|aac|ogg|opus)$/i;

// The one default cover from before Settings, Covers existed becomes the main picture,
// used as the full cover for everything: what it did before. Then the old setting goes.
async function moveOldDefault(c: Config): Promise<Config | null> {
  if (coverState().pictures.length) return null;
  const raw = await readImage(c.default_artwork_path || "");
  if (!raw) return null;  // the file is gone: the old setting keeps doing what it did
  const { data, w, h } = await shrinkImage(raw);
  const name = (c.default_artwork_path || "").split(/[\\/]/).pop()?.replace(/\.[^.]+$/, "") || "Default cover";
  await changeCovers((s) => s.add({ data, name: name.slice(0, 80), use: "full", w, h }));
  await changeCovers((s) => s.settings({ rule: "one" }));
  return api.saveSettings({ ...c, default_artwork_path: "" });
}

export default function App() {
  const [cfg, setCfg] = useState<Config | null | "error">(null);
  useGenreColors();  // a crate colour you pick redraws every screen
  const [account, setAccount] = useState<Account | null>(null);
  const [ent, setEnt] = useState<Entitlement | null>(null);
  // Where you are: a tab, maybe a track open for editing on it. Kept as a back/forward
  // history (side mouse buttons, Alt+arrows), the same as in Backups.
  // The app opens on the page it was closed on.
  const nav = useNav<Place & { tab: Tab }>({ tab: recall<Tab>(LAST_PAGE, "home", (v) => TABS.includes(v as Tab)) });
  useBackForwardInput(nav.back, nav.forward);
  const { tab } = nav.place;
  const sub = nav.place.sub ?? null;
  const setTab = (t: Tab, open: string | null = null) => nav.go({ tab: t, sub: open });
  // a track opens in a panel over its list, so the list stays where it was underneath
  const openTrack = (id: string) => nav.go({ tab: "manage", sub: id }, { overlay: true });
  const openPlaylist = (id: number | "new") => setTab("playlists", String(id));
  // A song clicked on a playlist opens in the same panel, over the playlist; closing
  // it steps back to the playlist.
  const onPlaylist = playlistPlace(tab === "playlists" ? sub : null);
  const openPlaylistSong = (id: string) => {
    if (onPlaylist.open) nav.go({ tab: "playlists", sub: songOnPlaylist(onPlaylist.open, id) }, { overlay: true });
  };
  const closePlaylistSong = () => {
    const p = nav.prev;
    if (p && p.tab === "playlists" && (p.sub ?? null) === onPlaylist.open) nav.back(); else setTab("playlists", onPlaylist.open);
  };
  // Close an open track: step back if that's where we came from (its list, or the
  // playlist it was opened from), else stay on the list.
  const closeSub = () => {
    const p = nav.prev;
    if (p && (p.tab === tab ? !p.sub : p.tab === "playlists")) nav.back(); else setTab(tab);
  };
  const live = useLiveProgress();
  const [showKeys, setShowKeys] = useState(false);
  const [viewKey, setViewKey] = useState(0);  // bumped to reload a page after a drop
  useEffect(() => { keep(LAST_PAGE, tab); }, [tab]);

  // Cmd/Ctrl+K: every page, action, smart crate, genre and track in one list. Your
  // tracks come from SoundCloud, so the box opens without them if it's slow to answer.
  const paletteTracks = useRef<Track[]>([]);
  const showPalette = () => {
    const wait = new Promise((ok) => setTimeout(ok, 1200));
    const tracks = api.listTracks().then((t) => { paletteTracks.current = t; });
    Promise.race([Promise.all([tracks, loadPlaylists()]), wait]).catch(() => {}).finally(openPalette);
  };
  const tracksWith = (f: Partial<TrackFilters>) => { showTracks({ ...NO_FILTERS, ...f }); setTab("manage"); };
  const paletteItems = (): PaletteItem[] => {
    const mod = IS_MAC ? "Cmd" : "Ctrl";
    const pages: [Tab, string, PaletteItem["icon"]][] = [["home", "Home", "home"], ["upload", "Upload", "upload"], ["manage", "Your tracks", "library"], ["playlists", "Playlists", "disc"], ["history", "History", "history"], ["settings", "Settings", "settings"]];
    const list = paletteTracks.current;
    const genres = [...new Set(list.map((t) => (t.genre || "").trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b));
    return [
      // the last few opened, ready before anything is typed
      ...getRecents().slice(0, 4).map((r) => ({ id: `recent-${r.id}`, group: "Recently opened", label: r.name, cover: { name: r.cover, genre: r.genre },
        hint: openedWhen(r.at).replace(/^o/, "O"), idle: true,
        run: () => { setTab("manage"); openTrack(r.id); } })),
      ...pages.map(([t, label, icon], i) => ({ id: `go-${t}`, group: "Go to", label, icon, keys: `${mod} + ${i + 1}`, run: () => setTab(t) })),
      { id: "upload", group: "Actions", label: "Post a mix", icon: "upload", words: ["upload", "soundcloud", "post"], run: () => setTab("upload") },
      { id: "new-playlist", group: "Actions", label: "New playlist", icon: "plus", words: ["playlist", "set", "make", "create"], run: () => openPlaylist("new") },
      { id: "theme", group: "Actions", label: `Switch to ${currentTheme() === "light" ? "dark" : "light"}`, icon: "palette", words: ["theme", "light", "dark", "mode"], run: toggleTheme },
      { id: "companion", group: "Actions", label: "Open the narrow window", icon: "narrow", keys: COMPANION_KEYS,
        words: ["companion", "small", "side", "beside", "float", "on top", "mini", "drop"], run: openCompanion },
      { id: "play", group: "Actions", label: "Play or pause", icon: "play", keys: "Space", run: togglePlaying },
      { id: "new", group: "Actions", label: "What's new", icon: "info", run: openWhatsNew },
      { id: "keys", group: "Actions", label: "Keyboard shortcuts", icon: "command", words: ["keys", "help"], run: () => setShowKeys(true) },
      ...smartCrates<TrackFilters>("tracks").map((c) => ({ id: `smart-${c.id}`, group: "Smart crates", label: c.name, icon: "crate" as const, run: () => tracksWith(c.filters) })),
      ...genres.map((g) => ({ id: `genre-${g}`, group: "Genres", label: g, colour: genreColor(g), quiet: true,
        hint: plural(list.filter((t) => (t.genre || "").trim() === g).length, "track"), run: () => tracksWith({ genre: g }) })),
      ...playlistsNow().map((p) => ({ id: `pl-${p.id}`, group: "Playlists", label: p.title, icon: "disc" as const, quiet: true,
        hint: plural(p.track_count, "track"), words: ["playlist", "set"], run: () => openPlaylist(p.id) })),
      ...list.map((t) => ({ id: `t-${t.id}`, group: "Your tracks", label: t.title, cover: { name: t.project_match || t.title, genre: t.project_match ? t.project_genre : t.genre }, quiet: true,
        hint: [t.genre, t.sharing === "private" ? "Private" : "Public", t.project_match ? `from ${t.project_match}` : ""].filter(Boolean).join(" · "),
        words: [t.genre || "", ...(t.tags || []), t.project_match || ""], run: () => { setTab("manage"); openTrack(String(t.id)); } })),
    ];
  };

  // Keyboard shortcuts and the menu bar (see desktop.ts).
  useDesktopCommands((cmd) => {
    if (cmd === "settings") setTab("settings");
    else if (cmd === "back") nav.back();
    else if (cmd === "forward") nav.forward();
    else if (cmd === "play") togglePlaying();
    else if (cmd === "whats-new") openWhatsNew();
    else if (cmd === "shortcuts") setShowKeys(true);
    else if (cmd === "palette") showPalette();
    else {
      const n = pageNumber(cmd);
      if (n && TABS[n - 1]) setTab(TABS[n - 1]);
    }
  });
  // Escape closes an open track (its panel closes itself too; this covers the rest).
  useEscapeToClose(sub ? closeSub : null);

  // How far an upload has got, on the dock / taskbar icon.
  const u = live.upload;
  useIconProgress(u.active ? (u.size ? u.sent / u.size : u.total ? u.completed / u.total : 0) : null);

  // Drop a folder (or a mix) on the window to add it to the folders Uploader watches.
  async function addDropped(items: Dropped[]) {
    if (!cfg || cfg === "error") return;
    const folders = [...new Set(items.flatMap((d) =>
      d.kind === "folder" ? [d.path] : d.kind === "file" && AUDIO_FILE.test(d.path) ? [folderOf(d.path)] : []))];
    if (!folders.length) { toast("Drop a folder of mixes (or a mix) to watch it."); return; }
    const fresh = folders.filter((f) => !isInside(f, cfg.sources));
    const goUpload = { label: "Go to Upload", onClick: () => setTab("upload") };
    if (!fresh.length) {
      toast(folders.length === 1 ? `Already watching ${baseName(folders[0])}.` : "Already watching those folders.", goUpload);
      return;
    }
    try {
      const saved = await api.saveSettings({ ...cfg, sources: [...cfg.sources, ...fresh] });
      setCfg(saved);
      setViewKey((k) => k + 1);
      toast(fresh.length === 1 ? `Now watching ${baseName(fresh[0])}.` : `Now watching ${fresh.length} more folders.`, goUpload);
    } catch {
      toastWarn("Couldn’t add that folder. Try Add folder in Settings.");
    }
  }
  // A mix dropped on the narrow window: Upload opens with it ticked, ready to post. Its
  // folder is watched from now on if it wasn't already (Upload lists watched folders).
  const [preselect, setPreselect] = useState<string[] | null>(null);
  async function postFromCompanion(paths: string[]) {
    if (!cfg || cfg === "error") return;
    const mixes = paths.filter((p) => AUDIO_FILE.test(p));
    if (!mixes.length) { setTab("upload"); return; }
    const fresh = [...new Set(mixes.map(folderOf))].filter((f) => !isInside(f, cfg.sources));
    if (fresh.length) {
      try {
        setCfg(await api.saveSettings({ ...cfg, sources: [...cfg.sources, ...fresh] }));
        toast(fresh.length === 1 ? `Now watching ${baseName(fresh[0])} as well.` : `Now watching ${fresh.length} more folders.`);
      } catch {
        toastWarn("Couldn’t add that mix’s folder. Try Add folder in Settings.");
        return;
      }
    }
    setPreselect(mixes);
    setViewKey((k) => k + 1);
    setTab("upload");
  }
  useCompanionCommand((cmd) => {
    if (cmd.go === "upload" && cmd.paths?.length) void postFromCompanion(cmd.paths);
    else if (cmd.go === "upload") setTab("upload");
    else setTab("home");
  });

  const dragging = useFileDrop(addDropped, !!cfg && cfg !== "error" && !!account && cfg.sources.length > 0 && account.connected);

  // Was the app already set up when it opened? Only then can "What's new" show
  // on a first run of this version (a fresh install has nothing new to show).
  const setUpAtOpen = useRef<boolean | null>(null);
  const setUpOnce = useRef(false);
  useEffect(() => {
    const covers = setCoverSource(makeCoverSource());
    Promise.all([api.getSettings(), api.account(), api.entitlement()])
      .then(([c, a, e]) => {
        if (setUpAtOpen.current === null) setUpAtOpen.current = c.sources.length > 0 && a.connected;
        setCfg(c); setAccount(a); setEnt(e);
        if (c.default_artwork_path) covers.then(() => moveOldDefault(c)).then((m) => { if (m) setCfg(m); }).catch(() => {});
      })
      .catch(() => setCfg("error"));
  }, []);

  // Ask for notification permission once; toast when a batch finishes.
  useEffect(() => {
    if ("Notification" in window && Notification.permission === "default") {
      Notification.requestPermission().catch(() => {});
    }
  }, []);
  const prevDone = useRef(false);
  useEffect(() => {
    if (live.upload.done && !prevDone.current && "Notification" in window
        && Notification.permission === "granted") {
      new Notification("LazyCreatives Uploader", {
        body: `Published ${live.upload.completed}, skipped ${live.upload.skipped}, ${live.upload.errors} error(s).`,
      });
    }
    prevDone.current = live.upload.done;
  }, [live.upload.done, live.upload.completed, live.upload.skipped, live.upload.errors]);

  if (cfg === null || account === null || ent === null) {
    return (
      <div className="splash">
        <div style={{ display: "grid", placeItems: "center", gap: 14 }}>
          <LcBrand app="Uploader" tag="Starting…" busy />
        </div>
      </div>
    );
  }
  if (cfg === "error") {
    return (
      <div className="splash">
        <EmptyState pose="tangled" title="Uploader couldn’t start its engine"
          action={<button className="btn btn--primary" onClick={() => (window as any).lazyupload?.relaunch?.()}>Restart the app</button>}>
          The part of the app that talks to SoundCloud didn’t answer. Restarting the app usually fixes it; nothing you posted is lost. If it keeps happening, use Help, Report a problem.
        </EmptyState>
      </div>
    );
  }

  // First-run setup shows until the app has a folder and an account. Once it has been
  // set up, disconnecting the last account (or removing the last folder) keeps you where
  // you are: Settings and Home offer to connect again.
  const configured = cfg.sources.length > 0 && account.connected;
  if (configured) setUpOnce.current = true;
  if (!configured && !setUpOnce.current) {
    return (
      <Setup cfg={cfg} account={account} onAccount={setAccount}
        onDone={(c) => { setCfg(c); setTab("home"); }} />
    );
  }

  const busy = live.scan.active || live.upload.active;

  return (
    <div className="app">
      <Nav tab={tab} busy={busy} onNavigate={(t) => setTab(t)}
        account={account.account} tier={ent.tier} beta={Boolean(ent.beta)}
        onOpenRecent={(id) => { setTab("manage"); openTrack(id); }} openId={tab === "manage" ? sub : null} />
      <div className="main">
        <div className="content">
          <div key={tab === "settings" || tab === "upload" ? `${tab}-${viewKey}` : tab} className="view-enter">
            {tab === "home" ? (
              <Home account={account} onAccount={setAccount} onUpload={() => setTab("upload")}
                onHistory={() => setTab("history")} onTracks={tracksWith}
                onOpenTrack={(id) => { setTab("manage"); openTrack(id); }} />
            ) : tab === "upload" ? (
              <Upload cfg={cfg} ent={ent} scan={live.scan} upload={live.upload} resetUpload={live.resetUpload}
                account={account.account} preselect={preselect} onPreselected={() => setPreselect(null)} />
            ) : tab === "manage" ? (
              <Manage ent={ent} cfg={cfg} openTrack={sub}
                onOpenTrack={openTrack} onCloseTrack={closeSub} />
            ) : tab === "playlists" ? (
              <Playlists open={onPlaylist.open} song={onPlaylist.track} onOpen={openPlaylist} onClose={() => setTab("playlists")}
                onOpenTrack={openPlaylistSong} onCloseTrack={closePlaylistSong} />
            ) : tab === "history" ? (
              <History />
            ) : (
              <Settings cfg={cfg} account={account} ent={ent}
                onCfg={setCfg} onAccount={setAccount} onEnt={setEnt} />
            )}
          </div>
        </div>
      </div>
      <PlayerBar onOpenTrack={(id) => { setTab("manage"); openTrack(id); }} />
      <WhatsNewHost setUp={setUpAtOpen.current === true} />
      <ContextMenuHost />
      <ToastHost />
      <ConfirmHost />
      <GenrePickHost />
      <CoverPickHost />
      <PlaylistPickHost onOpen={openPlaylist} />
      <PaletteHost items={paletteItems} />
      <DropZone show={dragging} title="Drop to watch" hint="Drop a folder of mixes to add it to the folders Uploader watches." />
      {showKeys && <ShortcutsPanel onClose={() => setShowKeys(false)} />}
    </div>
  );
}
