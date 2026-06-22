import { useEffect, useState } from "react";
import { getOpenAtLogin, makeApi, pickImage, readImage, setOpenAtLogin } from "../api";
import type { Account, Config, Entitlement, MetadataTemplate, Sharing } from "../types";
import { Button, ProBadge } from "../components/ui";
import { Folders } from "../components/Folders";
import { ConnectPanel } from "../components/Connect";

const api = makeApi();

const BLANK_TEMPLATE: MetadataTemplate = {
  name: "New template", title_template: "{name}", description: "", genre: "",
  tags: [], sharing: "public", downloadable: false,
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
  const [artPreview, setArtPreview] = useState<string | null>(null);

  useEffect(() => { getOpenAtLogin().then(setAtLogin).catch(() => {}); }, []);

  // (Re)load the default-cover preview whenever the configured path changes.
  useEffect(() => {
    let alive = true;
    const p = draft.default_artwork_path;
    if (!p) { setArtPreview(null); return; }
    readImage(p).then((url) => { if (alive) setArtPreview(url); }).catch(() => { if (alive) setArtPreview(null); });
    return () => { alive = false; };
  }, [draft.default_artwork_path]);

  function set<K extends keyof Config>(k: K, v: Config[K]) {
    setDraft((d) => ({ ...d, [k]: v }));
  }

  async function save() {
    const saved = await api.saveSettings(draft);
    setDraft(saved); onCfg(saved);
    setSavedFlash(true); setTimeout(() => setSavedFlash(false), 1500);
  }
  async function toggleLogin(v: boolean) { setAtLogin(await setOpenAtLogin(v)); }

  async function chooseArt() {
    const p = await pickImage();
    if (p) set("default_artwork_path", p);
  }

  async function activate() {
    setLicenseError(null);
    try { onEnt(await api.activateLicense(licenseKey.trim())); setLicenseKey(""); }
    catch (e) { setLicenseError(String((e as Error).message)); }
  }
  async function deactivate() { onEnt(await api.deactivateLicense()); }

  function setTemplate(i: number, t: MetadataTemplate) {
    set("templates", draft.templates.map((x, j) => (j === i ? t : x)));
  }

  const canAuto = ent.features.auto_upload;
  const canTemplates = ent.features.metadata_templates;

  return (
    <div>
      <h1>Settings</h1>
      <div className="sub">Accounts, folders, defaults, automation, templates.</div>

      <div className="card" style={{ marginBottom: 16 }}>
        <h2>SoundCloud accounts {ent.features.multi_account && <ProBadge />}</h2>
        <ConnectPanel account={account} onChange={onAccount} />
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <h2>Watched folders</h2>
        <Folders sources={draft.sources} onChange={(s) => set("sources", s)} />
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
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
          <input type="text" value={draft.default_tags.join(", ")}
            onChange={(e) => set("default_tags", e.target.value.split(",").map((t) => t.trim()).filter(Boolean))} /></label>
        <label className="field"><span>Default description</span>
          <textarea value={draft.default_description}
            onChange={(e) => set("default_description", e.target.value)} /></label>
        <label className="toolchk" style={{ fontSize: 13.5 }}>
          <input type="checkbox" checked={draft.changelog_comments !== false}
            onChange={(e) => set("changelog_comments", e.target.checked)} />
          Comment a timestamped changelog when a WIP track is re-bounced
        </label>
        <div className="field" style={{ marginBottom: 0 }}>
          <span>Default cover art</span>
          <div className="art-row">
            <span className={`art-thumb${draft.default_artwork_path && artPreview ? "" : " art-thumb--ph"}`} aria-hidden="true">
              {draft.default_artwork_path && artPreview
                ? <img src={artPreview} alt="" />
                : "🎵"}
            </span>
            <div className="art-row__actions">
              <Button sm onClick={chooseArt}>Choose image…</Button>
              {draft.default_artwork_path && (
                <Button kind="ghost" sm onClick={() => set("default_artwork_path", "")}>Remove</Button>
              )}
            </div>
          </div>
          <span className="sub" style={{ marginTop: 6 }}>Applied as the cover for uploads that don't pick their own art.</span>
        </div>
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

      <div className="card" style={{ marginBottom: 16 }}>
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
                  <input type="text" value={t.tags.join(", ")}
                    onChange={(e) => setTemplate(i, { ...t, tags: e.target.value.split(",").map((x) => x.trim()).filter(Boolean) })} /></label>
                <div style={{ textAlign: "right" }}>
                  <Button kind="danger" sm onClick={() => set("templates", draft.templates.filter((_, j) => j !== i))}>Remove</Button>
                </div>
              </div>
            ))}
            <Button kind="ghost" onClick={() => set("templates", [...draft.templates, { ...BLANK_TEMPLATE }])}>+ Add template</Button>
          </div>
        )}
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
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

      <div className="card" style={{ marginBottom: 16 }}>
        <h2>App</h2>
        <label className="toolchk" style={{ fontSize: 13.5 }}>
          <input type="checkbox" checked={atLogin} onChange={(e) => toggleLogin(e.target.checked)} />
          Launch LazyCreatives Uploader at login
        </label>
      </div>

      <div style={{ display: "flex", gap: 10, alignItems: "center", marginBottom: 24 }}>
        <Button kind="primary" onClick={save}>Save settings</Button>
        {savedFlash && <span className="pill pill--ok">Saved</span>}
      </div>

      <div className="card">
        <h2>Plan</h2>
        {ent.tier === "free" ? (
          <>
            <p className="sub" style={{ marginTop: 0 }}>
              You're on <b>Free</b>. Pro unlocks auto-upload, batch publishing, multiple
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
            <div><span className="pill pill--ok">● {ent.tier.toUpperCase()}</span> All features unlocked.</div>
            <Button sm onClick={deactivate}>Deactivate</Button>
          </div>
        )}
      </div>
    </div>
  );
}
