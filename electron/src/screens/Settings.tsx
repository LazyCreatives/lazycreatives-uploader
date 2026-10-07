import { useEffect, useRef, useState } from "react";
import { getOpenAtLogin, makeApi, setOpenAtLogin } from "../api";
import type { Account, Config, Entitlement, MetadataTemplate, Sharing } from "../types";
import { Button, PageHeader, ProBadge, TagsInput } from "../components/ui";
import { CoverShelf } from "../components/CoverShelf";
import { toast } from "../components/Desktop";
import { Folders } from "../components/Folders";
import { ConnectPanel } from "../components/Connect";
import { LookPicker, ThemePicker } from "../components/LookPicker";
import { GlyphPicker } from "../components/Marks";
import { UpdateCheck } from "../components/UpdateCheck";

const api = makeApi();

const BLANK_TEMPLATE: MetadataTemplate = {
  name: "New template", title_template: "{name}", description: "", genre: "",
  tags: [], sharing: "public", downloadable: false,
};

const LOGIN_STORAGE: Record<NonNullable<Account["login_storage"]>, string> = {
  windows: "Your SoundCloud login is encrypted and locked to your Windows user account.",
  keychain: "Your SoundCloud login is encrypted, with the key kept in your computer’s own keychain.",
  file: "Your SoundCloud login is encrypted. No system keychain was found, so the key is kept in a file only your user account can open.",
  plain: "No secure storage was found on this computer, so your SoundCloud login is saved without encryption.",
};

export function Settings({ cfg, account, ent, onCfg, onAccount, onEnt }: {
  cfg: Config; account: Account; ent: Entitlement;
  onCfg: (c: Config) => void; onAccount: (a: Account) => void; onEnt: (e: Entitlement) => void;
}) {
  const [draft, setDraft] = useState<Config>(cfg);
  const [savedFlash, setSavedFlash] = useState(false);
  const [licenseKey, setLicenseKey] = useState("");
  const [licenseError, setLicenseError] = useState<string | null>(null);
  const [atLogin, setAtLogin] = useState(false);

  useEffect(() => { getOpenAtLogin().then(setAtLogin).catch(() => {}); }, []);


  function set<K extends keyof Config>(k: K, v: Config[K]) {
    setDraft((d) => ({ ...d, [k]: v }));
  }

  // Changes save by themselves a moment after you make them; no Save button to forget.
  const lastSaved = useRef(JSON.stringify(cfg));
  const flashTimer = useRef<number | undefined>(undefined);
  const [saveError, setSaveError] = useState<string | null>(null);
  useEffect(() => {
    const json = JSON.stringify(draft);
    if (json === lastSaved.current) return;
    const t = window.setTimeout(async () => {
      setSaveError(null);
      try {
        const saved = await api.saveSettings(draft);
        lastSaved.current = JSON.stringify(saved);
        setDraft((d) => (JSON.stringify(d) === json ? saved : d));  // keep newer edits made meanwhile
        onCfg(saved);
        setSavedFlash(true);
        window.clearTimeout(flashTimer.current);
        flashTimer.current = window.setTimeout(() => setSavedFlash(false), 1800);
      } catch (e) {
        setSaveError(`Couldn’t save that change: ${String((e as Error).message)}`);
      }
    }, 500);
    return () => window.clearTimeout(t);
  }, [draft]);
  async function toggleLogin(v: boolean) { setAtLogin(await setOpenAtLogin(v)); }


  async function activate() {
    setLicenseError(null);
    try { onEnt(await api.activateLicense(licenseKey.trim())); setLicenseKey(""); }
    catch (e) { setLicenseError(String((e as Error).message)); }
  }
  async function deactivate() { onEnt(await api.deactivateLicense()); }

  function setTemplate(i: number, t: MetadataTemplate) {
    set("templates", draft.templates.map((x, j) => (j === i ? t : x)));
  }

  // Removing a template takes effect at once, with Undo on the message along the bottom.
  function removeTemplate(i: number) {
    const before = draft.templates;
    set("templates", before.filter((_, j) => j !== i));
    toast(`Removed the template “${before[i].name}”.`, { label: "Undo", onClick: () => set("templates", before) });
  }

  const canAuto = ent.features.auto_upload;
  const canTemplates = ent.features.metadata_templates;

  return (
    <div className="settings">
      <PageHeader title="Settings" sub="Your SoundCloud accounts, the folders to watch, and what every upload starts with."
        actions={savedFlash
          ? <span className="pill pill--ok" role="status">Saved</span>
          : <span className="faint settings-autosave">Changes save by themselves</span>} />
      {saveError && <div className="banner banner--warn">{saveError}</div>}

      <div className="card">
        <h2>Look</h2>
        <p className="sub" style={{ margin: "0 0 12px" }}>How the app is laid out. Switch any time; nothing else changes.</p>
        <LookPicker />
        <h3 style={{ margin: "18px 0 4px" }}>Light or dark</h3>
        <p className="sub" style={{ margin: "0 0 10px" }}>Ink or paper, in either look. Match my computer follows your computer's own setting.</p>
        <ThemePicker />
        <h3 style={{ margin: "18px 0 4px" }}>Rating mark</h3>
        <p className="sub" style={{ margin: "0 0 10px" }}>What ratings are drawn with. Rate a track from its row in Your tracks, or right-click it.</p>
        <GlyphPicker />
      </div>

      <div className="card">
        <h2>Covers</h2>
        <p className="sub" style={{ marginTop: 0 }}>
          Put your own pictures on your covers: behind the drawing, or as the whole cover. Each mix goes up to
          SoundCloud with the cover it shows here. Change one mix by right-clicking it on Upload.
        </p>
        <CoverShelf sample="Your mix" what="mix" />
      </div>

      <div className="card">
        <h2>SoundCloud accounts {ent.features.multi_account && !ent.beta && <ProBadge />}</h2>
        <ConnectPanel account={account} onChange={onAccount} />
        {account.connected && account.login_storage && (
          <div className="sub" style={{ margin: "10px 0 0", fontSize: 12 }}>
            {LOGIN_STORAGE[account.login_storage]}
          </div>
        )}
      </div>

      <div className="card">
        <h2>Watched folders</h2>
        <Folders sources={draft.sources} onChange={(s) => set("sources", s)} />
        <div className="toolchk minlen" style={{ fontSize: 13.5, marginTop: 14 }}>
          <input type="checkbox" id="minlen-on" checked={(draft.min_length_seconds ?? 30) > 0}
            onChange={(e) => set("min_length_seconds", e.target.checked ? 30 : 0)} />
          <label htmlFor="minlen-on">Hide exports shorter than</label>
          <input type="number" min={1} max={3600} aria-label="Shortest length in seconds"
            disabled={(draft.min_length_seconds ?? 30) === 0}
            value={(draft.min_length_seconds ?? 30) || 30} style={{ width: 64 }}
            onChange={(e) => set("min_length_seconds", Math.min(3600, Math.max(1, Math.round(Number(e.target.value)) || 1)))} />
          <label htmlFor="minlen-on">seconds</label>
        </div>
        <p className="sub" style={{ margin: "6px 0 0", fontSize: 12 }}>
          Keeps clicks, test bounces and one-shot renders out of your Upload list. Nothing is deleted:
          Upload can still show them, and automatic posting skips them.
        </p>
      </div>

      <div className="card">
        <h2>Upload defaults</h2>
        <label className="field"><span>Title template</span>
          <input type="text" value={draft.title_template}
            onChange={(e) => set("title_template", e.target.value)} placeholder="{name}" /></label>
        <label className="field"><span>Default release</span>
          <select value={draft.default_sharing} onChange={(e) => set("default_sharing", e.target.value as Sharing)}>
            <option value="public">Public</option><option value="private">Private</option>
          </select></label>
        <label className="field"><span>Genre</span>
          <input type="text" value={draft.default_genre}
            onChange={(e) => set("default_genre", e.target.value)} placeholder="e.g. House" /></label>
        <label className="field"><span>Tags (comma-separated)</span>
          <TagsInput tags={draft.default_tags} onChange={(t) => set("default_tags", t)} /></label>
        <label className="field"><span>Default description</span>
          <textarea value={draft.default_description}
            onChange={(e) => set("default_description", e.target.value)} /></label>
        <label className="toolchk" style={{ fontSize: 13.5 }}>
          <input type="checkbox" checked={draft.changelog_comments !== false}
            onChange={(e) => set("changelog_comments", e.target.checked)} />
          Comment a timestamped changelog when a draft is re-bounced
        </label>
        <label className="toolchk" style={{ fontSize: 13.5, marginTop: 14 }}>
          <input type="checkbox" checked={draft.cover_watermark !== false}
            onChange={(e) => set("cover_watermark", e.target.checked)} />
          Add a small LazyCreatives watermark to generated waveform covers
        </label>
        <label className="field" style={{ marginBottom: 0, marginTop: 12 }}>
          <span>Waveform color</span>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <input type="color" value={draft.cover_waveform_color || "#86B3D3"}
              onChange={(e) => set("cover_waveform_color", e.target.value)}
              style={{ width: 44, height: 30, padding: 2, cursor: "pointer" }} aria-label="Waveform color" />
            <span className="sub" style={{ margin: 0 }}>
              Base hue for generated covers — bass renders darker, treble brighter.
            </span>
          </div>
        </label>
      </div>

      <div className="card">
        <h2>Templates {!canTemplates && <ProBadge />}</h2>
        <p className="sub" style={{ marginTop: 0 }}>Saved metadata presets you can apply at upload time.</p>
        {!canTemplates ? (
          <div className="locked-note">Saved metadata templates are a Pro feature.</div>
        ) : (
          <div className="stack">
            {draft.templates.map((t, i) => (
              <div key={i} className="card" style={{ marginBottom: 0, background: "var(--surface-2)" }}>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                  <label className="field"><span>Name</span>
                    <input type="text" value={t.name} onChange={(e) => setTemplate(i, { ...t, name: e.target.value })} /></label>
                  <label className="field"><span>Release</span>
                    <select value={t.sharing} onChange={(e) => setTemplate(i, { ...t, sharing: e.target.value as Sharing })}>
                      <option value="public">Public</option><option value="private">Private</option>
                    </select></label>
                  <label className="field"><span>Title template</span>
                    <input type="text" value={t.title_template} onChange={(e) => setTemplate(i, { ...t, title_template: e.target.value })} /></label>
                  <label className="field"><span>Genre</span>
                    <input type="text" value={t.genre} onChange={(e) => setTemplate(i, { ...t, genre: e.target.value })} /></label>
                </div>
                <label className="field"><span>Tags (comma-separated)</span>
                  <TagsInput tags={t.tags} onChange={(tags) => setTemplate(i, { ...t, tags })} /></label>
                <div style={{ textAlign: "right" }}>
                  <Button kind="danger" sm onClick={() => removeTemplate(i)}>Remove</Button>
                </div>
              </div>
            ))}
            <Button kind="ghost" onClick={() => set("templates", [...draft.templates, { ...BLANK_TEMPLATE }])}>+ Add template</Button>
          </div>
        )}
      </div>

      <div className="card">
        <h2>Automation {!canAuto && <ProBadge />}</h2>
        <p className="sub" style={{ marginTop: 0 }}>Watch your folders and publish new renders automatically.</p>
        <label className="field" style={{ opacity: canAuto ? 1 : 0.55 }}>
          <span>Check every (minutes) — 0 = off</span>
          <input type="number" min={0} max={44640} disabled={!canAuto}
            value={draft.interval_minutes}
            onChange={(e) => set("interval_minutes", Math.max(0, Number(e.target.value) || 0))} /></label>
        <label className="field" style={{ opacity: canAuto ? 1 : 0.55 }}>
          <span>Auto-uploads are released as</span>
          <select value={draft.auto_upload_sharing} disabled={!canAuto}
            onChange={(e) => set("auto_upload_sharing", e.target.value as Sharing)}>
            <option value="private">Private (recommended)</option><option value="public">Public</option>
          </select></label>
        {!canAuto && <div className="locked-note">Automatic watch-folder uploads are a Pro feature.</div>}
      </div>

      <div className="card">
        <h2>App</h2>
        <label className="toolchk" style={{ fontSize: 13.5 }}>
          <input type="checkbox" checked={atLogin} onChange={(e) => toggleLogin(e.target.checked)} />
          Open Uploader when the computer starts
        </label>
      </div>

      <div className="card">
        <h2>Updates</h2>
        <p className="sub" style={{ marginTop: 0 }}>The app checks for a new version on its own. Press the button to check right now.</p>
        <UpdateCheck />
      </div>


      {!ent.beta && <div className="card">
        <h2>Plan</h2>
        {ent.tier === "free" ? (
          <>
            <p className="sub" style={{ marginTop: 0 }}>
              You’re on <b>Free</b>. Pro unlocks auto-upload, batch publishing, multiple
              accounts, saved templates, and scheduled release.
            </p>
            <div style={{ display: "flex", gap: 8 }}>
              <input type="text" placeholder="Licence key" value={licenseKey}
                onChange={(e) => setLicenseKey(e.target.value)} style={{ flex: 1 }} />
              <Button kind="primary" onClick={activate} disabled={!licenseKey.trim()}>Activate</Button>
            </div>
            {licenseError && <div className="locked-note" style={{ borderColor: "var(--danger)", color: "var(--danger)" }}>{licenseError}</div>}
          </>
        ) : (
          <div className="row-spread">
            <div><span className="pill pill--ok">{ent.tier} plan</span> All features unlocked.</div>
            <Button sm onClick={deactivate}>Deactivate</Button>
          </div>
        )}
      </div>}
    </div>
  );
}
