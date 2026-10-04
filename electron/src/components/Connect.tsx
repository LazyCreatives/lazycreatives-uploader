import { useRef, useState } from "react";
import { makeApi, openExternal } from "../api";
import type { Account } from "../types";
import { Button, ProBadge } from "./ui";

const api = makeApi();

// Drives SoundCloud sign-in and (Pro) multi-account management. POST /api/connect,
// open the browser to the auth URL (skipped in mock mode, which connects instantly),
// then poll until the loopback callback completes. Reused by Setup, Home, Settings.
export function ConnectPanel({ account, onChange }: {
  account: Account; onChange: (a: Account) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pollRef = useRef<number | null>(null);

  async function start() {
    setError(null); setBusy(true);
    try {
      const { connect_id, auth_url, status } = await api.connect();
      if (auth_url) openExternal(auth_url);
      if (status === "connected") return finish();
      const deadline = Date.now() + 300_000;
      const tick = async () => {
        try {
          const s = await api.connectStatus(connect_id);
          if (s.status === "connected") return finish();
          if (s.status === "failed") { setError(s.error || "Sign-in failed."); setBusy(false); return; }
        } catch { /* keep polling */ }
        if (Date.now() < deadline) pollRef.current = window.setTimeout(tick, 1200);
        else { setError("Sign-in timed out."); setBusy(false); }
      };
      pollRef.current = window.setTimeout(tick, 1200);
    } catch (e) {
      setError(String((e as Error).message)); setBusy(false);
    }
  }

  async function finish() {
    if (pollRef.current) window.clearTimeout(pollRef.current);
    setBusy(false);
    onChange(await api.account());
  }

  async function switchTo(id: string) { onChange(await api.activateAccount(id)); }
  async function disconnect(id: string) { onChange(await api.disconnect(id)); }

  const accounts = account.accounts || [];

  return (
    <div>
      {accounts.length > 0 && (
        <div className="table" style={{ marginBottom: 12 }}>
          {accounts.map((a) => (
            <div key={a.id} className="row" style={{ marginBottom: 0 }}>
              <span className={`pill ${a.active ? "pill--ok" : "pill--skipped"}`} style={{ width: 64 }}>{a.active ? "In use" : "Idle"}</span>
              <div className="row__main">
                <div className="row__title">{a.username}</div>
                {a.mock && <div className="row__sub">demo account</div>}
              </div>
              {!a.active && account.multi &&
                <Button sm onClick={() => switchTo(a.id)}>Switch to</Button>}
              <Button kind="danger" sm onClick={() => disconnect(a.id)}>Disconnect</Button>
            </div>
          ))}
        </div>
      )}

      {(accounts.length === 0 || account.multi) && (
        <Button kind="sc" onClick={start} disabled={busy}>
          {busy ? "Waiting for browser…"
            : accounts.length === 0
              ? (account.mock ? "Connect (demo account)" : "Connect SoundCloud")
              : <>Add another account{!account.multi && <ProBadge />}</>}
        </Button>
      )}
      {accounts.length > 0 && !account.multi && (
        <div className="locked-note">
          <span>Connecting more than one SoundCloud account is</span><b>Pro<ProBadge /></b>
        </div>
      )}

      {account.mock && accounts.length === 0 && (
        <div className="sub" style={{ margin: "8px 0 0", fontSize: 12 }}>
          No SoundCloud API credentials configured yet — connecting uses a built-in
          demo account so you can try the whole flow offline.
        </div>
      )}
      {error && <div className="locked-note" style={{ borderColor: "var(--danger)", color: "var(--danger)" }}>{error}</div>}
    </div>
  );
}
