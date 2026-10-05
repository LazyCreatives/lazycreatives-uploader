import { useEffect, useRef, useState } from "react";
import { makeApi } from "./api";
import { Nav, type Tab } from "./components/Nav";
import { LcBrand } from "./components/LcBrand";
import { PlayerBar, togglePlaying } from "./components/Player";
import "./look";
import { Setup } from "./screens/Setup";
import { Home } from "./screens/Home";
import { Upload } from "./screens/Upload";
import { Manage } from "./screens/Manage";
import { History } from "./screens/History";
import { Settings } from "./screens/Settings";
import { WhatsNewHost, openWhatsNew } from "./components/WhatsNew";
import { ConfirmHost, ContextMenuHost, DropZone, ShortcutsPanel, ToastHost, toast } from "./components/Desktop";
import { baseName, folderOf, isInside, keep, recall, useDesktopCommands, useEscapeToClose, useFileDrop, useIconProgress, type Dropped } from "./desktop";
import { useLiveProgress } from "./useProgress";
import type { Account, Config, Entitlement } from "./types";
import { EmptyState } from "./components/SlothSpot";
import { useBackForwardInput, useNav, type Place } from "./nav";

const api = makeApi();
const TABS: Tab[] = ["home", "upload", "manage", "history", "settings"];
const LAST_PAGE = "lc-last-page";

// Mixes Uploader can post; dropping one adds the folder it sits in.
const AUDIO_FILE = /\.(wav|aiff?|flac|mp3|m4a|aac|ogg|opus)$/i;

export default function App() {
  const [cfg, setCfg] = useState<Config | null | "error">(null);
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
  // Close an open track: step back if that's where we came from, else stay on the list.
  const closeSub = () => {
    const p = nav.prev;
    if (p && p.tab === tab && !p.sub) nav.back(); else setTab(tab);
  };
  const live = useLiveProgress();
  const [showKeys, setShowKeys] = useState(false);
  const [viewKey, setViewKey] = useState(0);  // bumped to reload a page after a drop
  useEffect(() => { keep(LAST_PAGE, tab); }, [tab]);

  // Keyboard shortcuts and the menu bar (see desktop.ts).
  useDesktopCommands((cmd) => {
    if (cmd === "settings") setTab("settings");
    else if (cmd === "back") nav.back();
    else if (cmd === "forward") nav.forward();
    else if (cmd === "play") togglePlaying();
    else if (cmd === "whats-new") openWhatsNew();
    else if (cmd === "shortcuts") setShowKeys(true);
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
      toast("Couldn't add that folder. Try Add folder in Settings.");
    }
  }
  const dragging = useFileDrop(addDropped, !!cfg && cfg !== "error" && !!account && cfg.sources.length > 0 && account.connected);

  // Was the app already set up when it opened? Only then can "What's new" show
  // on a first run of this version (a fresh install has nothing new to show).
  const setUpAtOpen = useRef<boolean | null>(null);
  useEffect(() => {
    Promise.all([api.getSettings(), api.account(), api.entitlement()])
      .then(([c, a, e]) => {
        if (setUpAtOpen.current === null) setUpAtOpen.current = c.sources.length > 0 && a.connected;
        setCfg(c); setAccount(a); setEnt(e);
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
        <EmptyState pose="tangled" title="Uploader couldn't start its engine"
          action={<button className="btn btn--primary" onClick={() => (window as any).lazyupload?.relaunch?.()}>Restart the app</button>}>
          The part of the app that talks to SoundCloud didn't answer. Restarting the app usually fixes it; nothing you posted is lost. If it keeps happening, use Help, Report a problem.
        </EmptyState>
      </div>
    );
  }

  const configured = cfg.sources.length > 0 && account.connected;
  if (!configured) {
    return (
      <Setup cfg={cfg} account={account} onAccount={setAccount}
        onDone={(c) => { setCfg(c); setTab("home"); }} />
    );
  }

  const busy = live.scan.active || live.upload.active;

  return (
    <div className="app">
      <Nav tab={tab} busy={busy} onNavigate={(t) => setTab(t)}
        account={account.account} tier={ent.tier} beta={Boolean(ent.beta)} />
      <div className="main">
        <div className="content">
          <div key={tab === "settings" || tab === "upload" ? `${tab}-${viewKey}` : tab} className="view-enter">
            {tab === "home" ? (
              <Home account={account} onAccount={setAccount} onUpload={() => setTab("upload")}
                onHistory={() => setTab("history")} />
            ) : tab === "upload" ? (
              <Upload cfg={cfg} ent={ent} scan={live.scan} upload={live.upload} resetUpload={live.resetUpload} />
            ) : tab === "manage" ? (
              <Manage ent={ent} cfg={cfg} openTrack={sub}
                onOpenTrack={openTrack} onCloseTrack={closeSub} />
            ) : tab === "history" ? (
              <History />
            ) : (
              <Settings cfg={cfg} account={account} ent={ent}
                onCfg={setCfg} onAccount={setAccount} onEnt={setEnt} />
            )}
          </div>
        </div>
      </div>
      <PlayerBar />
      <WhatsNewHost setUp={setUpAtOpen.current === true} />
      <ContextMenuHost />
      <ToastHost />
      <ConfirmHost />
      <DropZone show={dragging} title="Drop to watch" hint="Drop a folder of mixes to add it to the folders Uploader watches." />
      {showKeys && <ShortcutsPanel onClose={() => setShowKeys(false)} />}
    </div>
  );
}
