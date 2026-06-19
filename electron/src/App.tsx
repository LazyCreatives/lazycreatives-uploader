import { useEffect, useRef, useState } from "react";
import { makeApi } from "./api";
import { Nav, type Tab } from "./components/Nav";
import { BrandMark } from "./components/BrandMark";
import { Setup } from "./screens/Setup";
import { Home } from "./screens/Home";
import { Upload } from "./screens/Upload";
import { Manage } from "./screens/Manage";
import { History } from "./screens/History";
import { Settings } from "./screens/Settings";
import { useLiveProgress } from "./useProgress";
import type { Account, Config, Entitlement } from "./types";

const api = makeApi();

export default function App() {
  const [cfg, setCfg] = useState<Config | null | "error">(null);
  const [account, setAccount] = useState<Account | null>(null);
  const [ent, setEnt] = useState<Entitlement | null>(null);
  const [tab, setTab] = useState<Tab>("home");
  const live = useLiveProgress();

  useEffect(() => {
    Promise.all([api.getSettings(), api.account(), api.entitlement()])
      .then(([c, a, e]) => { setCfg(c); setAccount(a); setEnt(e); })
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
          <div style={{ width: 56, height: 62 }}><BrandMark active /></div>
          <span className="sub" style={{ margin: 0 }}>Starting…</span>
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
      <Nav tab={tab} busy={busy} onNavigate={setTab}
        account={account.account} tier={ent.tier} />
      <div className="main">
        <div className="content">
          <div key={tab} className="view-enter">
            {tab === "home" ? (
              <Home account={account} onAccount={setAccount} onUpload={() => setTab("upload")} />
            ) : tab === "upload" ? (
              <Upload cfg={cfg} ent={ent} scan={live.scan} upload={live.upload} resetUpload={live.resetUpload} />
            ) : tab === "manage" ? (
              <Manage ent={ent} cfg={cfg} />
            ) : tab === "history" ? (
              <History />
            ) : (
              <Settings cfg={cfg} account={account} ent={ent}
                onCfg={setCfg} onAccount={setAccount} onEnt={setEnt} />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
