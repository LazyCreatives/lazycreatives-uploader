import { useEffect, useRef, useState } from "react";
import { makeApi, openExternal } from "../api";
import type { Account } from "../types";
import { Button, ProBadge } from "./ui";
import { askConfirm } from "./Desktop";

const api = makeApi();

const WAIT_MS = 300_000;
export const NOT_FINISHED = "Sign-in wasn’t finished. Press Connect to try again.";

// SoundCloud sign-in: POST /api/connect, open the browser at the sign-in page (the
// demo connects at once), then wait for the page to come back to the app. While it
// waits you can open the page again or cancel. Used by the Connect panel, the sidebar
// and the Upload page's "Sign in again".
export function useSignIn(onChange: (a: Account) => void) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pollRef = useRef<number | null>(null);
  const idRef = useRef<string | null>(null);
  const urlRef = useRef<string | null>(null);
  const stopPoll = () => { if (pollRef.current) window.clearTimeout(pollRef.current); pollRef.current = null; };
  useEffect(() => stopPoll, []);

  async function finish() {
    stopPoll(); idRef.current = null;
    setBusy(false);
    onChange(await api.account());
  }

  async function start() {
    if (busy) return;
    setError(null); setBusy(true);
    try {
      const { connect_id, auth_url, status } = await api.connect();
      idRef.current = connect_id; urlRef.current = auth_url;
      if (auth_url) openExternal(auth_url);
      if (status === "connected") return finish();
      const deadline = Date.now() + WAIT_MS;
      const tick = async () => {
        if (idRef.current !== connect_id) return;  // cancelled
        try {
          const s = await api.connectStatus(connect_id);
          if (s.status === "connected") return finish();
          if (s.status === "failed") { setError(s.error || "Sign-in failed."); setBusy(false); idRef.current = null; return; }
        } catch { /* keep waiting */ }
        if (Date.now() < deadline) pollRef.current = window.setTimeout(tick, 1200);
        else { setError(NOT_FINISHED); setBusy(false); idRef.current = null; }
      };
      pollRef.current = window.setTimeout(tick, 1200);
    } catch (e) {
      setError(String((e as Error).message)); setBusy(false);
    }
  }

  // The browser didn't open, or the tab was closed: show the same sign-in page again.
  function reopen() { if (urlRef.current) openExternal(urlRef.current); }

  function cancel() {
    const id = idRef.current;
    stopPoll(); idRef.current = null; setBusy(false); setError(null);
    if (id) void api.connectCancel(id).catch(() => {});
  }

  return { start, reopen, cancel, busy, error, setError, canReopen: busy && !!urlRef.current };
}

// While the browser sign-in is open: open the page again, or stop waiting.
export function SignInWaiting({ signIn, compact = false }: { signIn: ReturnType<typeof useSignIn>; compact?: boolean }) {
  if (!signIn.busy) return null;
  return (
    <div className={`signin-wait${compact ? " signin-wait--compact" : ""}`} role="status">
      <span className="faint">Finish signing in in your browser.</span>
      {signIn.canReopen && <button type="button" className="linkbtn" onClick={signIn.reopen}>Open the page again</button>}
      <button type="button" className="linkbtn" onClick={signIn.cancel}>Cancel</button>
    </div>
  );
}

// Sign-in and (Pro) multi-account management. Reused by Setup, Home, Settings.
export function ConnectPanel({ account, onChange }: {
  account: Account; onChange: (a: Account) => void;
}) {
  const signIn = useSignIn(onChange);
  const { busy, error, setError } = signIn;
  const start = signIn.start;

  async function switchTo(id: string) { onChange(await api.activateAccount(id)); }
  async function disconnect(id: string, name: string) {
    if (!(await askConfirm({ title: `Disconnect ${name}?`, body: "You’ll need to sign in again to post.",
      confirm: "Disconnect", danger: true }))) return;
    try { onChange(await api.disconnect(id)); }
    catch (e) { setError(String((e as Error).message)); }
  }

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
              {a.signed_out && <span className="pill pill--draft" title="SoundCloud stopped accepting this sign-in">Signed out</span>}
              {!a.active && account.multi &&
                <Button sm onClick={() => switchTo(a.id)}>Switch to</Button>}
              <Button kind="danger" sm onClick={() => void disconnect(a.id, a.username)}>Disconnect</Button>
            </div>
          ))}
        </div>
      )}

      {account.signed_out && !account.multi && (
        <Button kind="sc" onClick={start} disabled={busy}>
          {busy ? "Waiting for browser…" : "Sign in again"}
        </Button>
      )}
      {(accounts.length === 0 || account.multi) && (
        <Button kind="sc" onClick={start} disabled={busy}>
          {busy ? "Waiting for browser…"
            : account.signed_out ? "Sign in again"
            : accounts.length === 0
              ? (account.mock ? "Connect (demo account)" : "Connect SoundCloud")
              : <>Add another account{!account.multi && <ProBadge />}</>}
        </Button>
      )}
      <SignInWaiting signIn={signIn} />
      {accounts.length > 0 && !account.multi && !account.signed_out && (
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
