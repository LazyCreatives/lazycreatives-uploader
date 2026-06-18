import { useEffect, useRef, useState } from "react";
import { makeApi } from "../api";
import type { Account, Overview } from "../types";
import { Button, fmtBytes, ProBadge } from "../components/ui";
import { ConnectPanel } from "../components/Connect";
import { StatusPill } from "../components/StatusPill";
import { Info } from "../components/Info";
import { useSpecular } from "../components/Glass";
import "../home.css";

const api = makeApi();

export function Home({ account, onAccount, onUpload }: {
  account: Account; onAccount: (a: Account) => void; onUpload: () => void;
}) {
  const [ov, setOv] = useState<Overview | null>(null);
  useEffect(() => { api.overview().then(setOv).catch(() => setOv(null)); }, [account]);

  const root = useRef<HTMLDivElement | null>(null);
  useSpecular(root);

  const tiles: { label: string; value: string; hint: string; info?: string }[] = [
    { label: "Published", value: ov ? String(ov.uploaded_count) : "—", hint: ov ? fmtBytes(ov.uploaded_bytes) : "",
      info: "Tracks published to SoundCloud, and the total audio uploaded." },
    { label: "Errors", value: ov ? String(ov.error_count) : "—", hint: ov?.error_count ? "needs attention" : "all clear" },
    { label: "Auto-upload", value: ov?.schedule.enabled ? "On" : "Off",
      hint: ov?.schedule.enabled ? `every ${ov.schedule.interval_minutes} min` : "manual",
      info: "Pro: watch a folder and publish new renders automatically." },
    { label: "Last upload", value: ov?.last_upload ? ov.last_upload.slice(5, 16) : "—",
      hint: ov?.last_upload ? (ov.last_upload_ok ? "ok" : "failed") : "nothing yet" },
  ];

  return (
    <div ref={root}>
      {ov?.mock && (
        <div className="banner banner--demo">
          🎧 Demo mode — no SoundCloud credentials are configured, so uploads go to a
          simulated account. Add your API keys to publish for real.
        </div>
      )}

      <div className="glass elev-1 home-hero">
        <div className="home-hero__main">
          <div className="home-hero__eyebrow">LazyCreatives · Uploader</div>
          <h1 className="home-hero__title">Your SoundCloud, on autopilot</h1>
          <p className="home-hero__sub">
            Drop finished mixes in your watched folder — publish with one click, or let it
            post new renders for you. Never double-posts the same mix.
          </p>
          <div className="home-hero__status">
            <StatusPill status={account.connected ? "ok" : "skipped"}
              label={account.connected ? "Connected" : "Not connected"} />
            {account.connected && account.account &&
              <span className="muted" style={{ fontSize: 12.5 }}>{account.account}</span>}
            {ov && <span className="muted" style={{ fontSize: 12.5 }}>
              · {ov.tier === "free" ? "Free plan" : `${ov.tier} plan`}
            </span>}
          </div>
        </div>
        <div className="home-hero__cta">
          <Button kind="primary" onClick={onUpload} disabled={!account.connected}>Upload now</Button>
          <span className="home-hero__hint">or set a schedule in Settings</span>
        </div>
      </div>

      {!account.connected && (
        <div className="card" style={{ marginBottom: 16 }}>
          <h2>Connect your account</h2>
          <ConnectPanel account={account} onChange={onAccount} />
        </div>
      )}

      <div className="grid-tiles" style={{ marginBottom: 16 }}>
        {tiles.map((t, i) => (
          <div key={t.label} className="tile tile--enter" style={{ ["--i" as any]: i }}>
            <div className="tile__label">{t.label}{t.info && <Info text={t.info} />}</div>
            <div className="tile__value">{t.value}</div>
            <div className="tile__hint">{t.hint}</div>
          </div>
        ))}
      </div>

      {ov && ov.tier === "free" && (
        <div className="card">
          <div className="locked-note" style={{ marginTop: 0 }}>
            <span>Want hands-off publishing?</span>
            <b>Auto-upload a watched folder<ProBadge /></b>
            <span>— upgrade in Settings.</span>
          </div>
        </div>
      )}
    </div>
  );
}
