import { useState } from "react";
import { makeApi } from "../api";
import type { Account, Config } from "../types";
import { LcBrand } from "../components/LcBrand";
import { Button } from "../components/ui";
import { Folders } from "../components/Folders";
import { ConnectPanel } from "../components/Connect";

const api = makeApi();

// First-run wizard: pick the folder(s) to watch, then connect SoundCloud. Done when
// at least one folder exists and an account is connected.
export function Setup({ cfg, account, onAccount, onDone }: {
  cfg: Config; account: Account;
  onAccount: (a: Account) => void;
  onDone: (c: Config) => void;
}) {
  const [step, setStep] = useState<0 | 1>(0);
  const [sources, setSources] = useState<string[]>(cfg.sources);
  const [saving, setSaving] = useState(false);

  async function finish() {
    setSaving(true);
    const saved = await api.saveSettings({ ...cfg, sources });
    onDone(saved);
  }

  return (
    <div className="splash">
      <div className="wizard view-enter">
        <div className="wizard__head">
          <LcBrand app="Uploader" tag="Lazy Creatives" />
        </div>
        <div style={{ marginBottom: 18 }}>
          <h1 style={{ margin: 0 }}>Post your finished mixes to SoundCloud</h1>
          <p className="sub" style={{ margin: "6px 0 0" }}>Two quick steps: connect your account, then pick the folder you export into.</p>
        </div>

        <div className="wizard__body">
          {step === 0 ? (
            <>
              <h2>Step 1 — Watch a folder</h2>
              <p className="sub" style={{ marginTop: 0 }}>
                Point it at the folder you bounce mixes into. New audio that lands here
                becomes a one-click (or automatic) upload.
              </p>
              <Folders sources={sources} onChange={setSources} />
            </>
          ) : (
            <>
              <h2>Step 2 — Connect SoundCloud</h2>
              <p className="sub" style={{ marginTop: 0 }}>
                Sign in once. We store your account securely on this machine and refresh
                it automatically.
              </p>
              <ConnectPanel account={account} onChange={onAccount} />
            </>
          )}
        </div>

        <div className="wizard__foot">
          <Button kind="ghost" disabled={step === 0} onClick={() => setStep(0)}>Back</Button>
          {step === 0 ? (
            <Button kind="primary" disabled={sources.length === 0} onClick={() => setStep(1)}>
              Next
            </Button>
          ) : (
            <Button kind="primary" disabled={!account.connected || saving} onClick={finish}>
              {saving ? "Finishing…" : "Start uploading"}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
