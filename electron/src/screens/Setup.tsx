import { useState } from "react";
import { makeApi } from "../api";
import type { Account, Config } from "../types";
import { Button } from "../components/ui";
import { Folders } from "../components/Folders";
import { ConnectPanel } from "../components/Connect";
import { WelcomeCard } from "../components/Welcome";
import { ThemePicker } from "../components/LookPicker";
import "../setup.css";

const api = makeApi();

// First run: say hello and pick light or dark, then the folder to watch, then connect
// SoundCloud. Done when at least one folder exists and an account is connected.
export function Setup({ cfg, account, onAccount, onDone }: {
  cfg: Config; account: Account;
  onAccount: (a: Account) => void;
  onDone: (c: Config) => void;
}) {
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [sources, setSources] = useState<string[]>(cfg.sources);
  const [saving, setSaving] = useState(false);

  async function finish() {
    setSaving(true);
    const saved = await api.saveSettings({ ...cfg, sources });
    onDone(saved);
  }

  const back = step > 1
    ? <Button kind="ghost" onClick={() => setStep((step - 1) as 1 | 2)}>Back</Button>
    : <span />;

  if (step === 1) {
    return (
      <WelcomeCard app="Uploader" step={1} title="Post your mixes without the busywork"
        sub="Export a mix and it's ready to post in one click, with a cover made for you, and it never goes up twice. Two quick steps after this: pick the folder you export into, then connect your account."
        foot={<>{back}<Button kind="primary" onClick={() => setStep(2)}>Next</Button></>}>
        <div className="welcome__look">
          <div className="welcome__label">Light or dark</div>
          <ThemePicker />
          <p className="welcome__hint">You can change it any time in Settings.</p>
        </div>
      </WelcomeCard>
    );
  }

  if (step === 2) {
    return (
      <WelcomeCard app="Uploader" step={2} title="Where do you export your mixes?"
        sub="Pick the folder you bounce finished mixes into. New audio that lands there is ready to upload."
        foot={<>{back}<Button kind="primary" disabled={sources.length === 0} onClick={() => setStep(3)}>Next</Button></>}>
        <Folders sources={sources} onChange={setSources} />
      </WelcomeCard>
    );
  }

  return (
    <WelcomeCard app="Uploader" step={3} title="Connect SoundCloud"
      sub="Sign in once. Your login stays on this computer and keeps itself fresh."
      foot={<>{back}<Button kind="primary" disabled={!account.connected || saving} onClick={finish}>
        {saving ? "Finishing…" : "Start uploading"}
      </Button></>}>
      <ConnectPanel account={account} onChange={onAccount} />
    </WelcomeCard>
  );
}
