import { useEffect, useRef, useState } from "react";
import { makeApi } from "./api";
import { Nav, type Tab } from "./components/Nav";
import { LcBrand } from "./components/LcBrand";
import { PlayerBar } from "./components/Player";
import "./look";
import { Setup } from "./screens/Setup";
import { Home } from "./screens/Home";
import { Upload } from "./screens/Upload";
import { Manage } from "./screens/Manage";
import { History } from "./screens/History";
import { Settings } from "./screens/Settings";
import { WhatsNewHost } from "./components/WhatsNew";
import { useLiveProgress } from "./useProgress";
import type { Account, Config, Entitlement } from "./types";
import { useBackForwardInput, useNav, type Place } from "./nav";

const api = makeApi();

export default function App() {
  const [cfg, setCfg] = useState<Config | null | "error">(null);
  const [account, setAccount] = useState<Account | null>(null);
  const [ent, setEnt] = useState<Entitlement | null>(null);
  // Where you are: a tab, maybe a track open for editing on it. Kept as a back/forward
  // history (side mouse buttons, Alt+arrows), the same as in Backups.
  const nav = useNav<Place & { tab: Tab }>({ tab: "home" });
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
        <div className="card" style={{ borderColor: "var(--danger)", color: "var(--danger)", maxWidth: 380 }}>
          Couldn't reach the upload service.
        </div>
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
          <div key={tab} className="view-enter">
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
    </div>
  );
}
