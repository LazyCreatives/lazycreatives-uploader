import { useEffect, useRef, useState } from "react";
import { getOpenAtLogin, makeApi, setOpenAtLogin } from "../api";
import type { Account, Config, Entitlement, MetadataTemplate, Playlist, Sharing } from "../types";
import { Button, PageHeader, ProBadge, TagsInput } from "../components/ui";
import { CoverShelf } from "../components/CoverShelf";
import { toast } from "../components/Desktop";
import { Folders } from "../components/Folders";
import { Icon } from "../components/Icon";
import { ConnectPanel } from "../components/Connect";
import { ThemePicker } from "../components/LookPicker";
import { GlyphPicker } from "../components/Marks";
import { DENSITIES, useDensity } from "../marks";
import { useAuditionMode } from "../audition";
import { UpdateCheck } from "../components/UpdateCheck";
import { PAUSE_ON_MINIMIZE, keep, pausesOnMinimize } from "../desktop";

const api = makeApi();

const BLANK_TEMPLATE: MetadataTemplate = {
  name: "New template", title_template: "{name}", description: "", genre: "",
  tags: [], sharing: "public", downloadable: false,
};

const LOGIN_STORAGE: Record<NonNullable<Account["login_storage"]>, string> = {
  windows: "Your SoundCloud login is encrypted and locked to your Windows user account.",
  file: "Your SoundCloud login is encrypted, with the key kept in a file only your user account can open.",
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
  // Row spacing for the Crate lists (Your tracks and History share it) and hover previews.
  const [rows, setTrackRows] = useDensity("tracks");
  const [, setHistoryRows] = useDensity("history");
  const [preview, setPreview] = useAuditionMode();
  const [pauseMin, setPauseMin] = useState(pausesOnMinimize);

  useEffect(() => { getOpenAtLogin().then(setAtLogin).catch(() => {}); }, []);
  // The export folders Backups knows about, for "Also look in Backups' export folders".
  const [bkFolders, setBkFolders] = useState<{ installed: boolean; folders: string[] } | null>(null);
  useEffect(() => { api.backupsFolders().then(setBkFolders).catch(() => setBkFolders(null)); }, []);
  // Your playlists, for "Add new posts to a playlist".
  const [playlists, setPlaylists] = useState<Playlist[] | null>(null);
  useEffect(() => {
    if (!account.connected) return;
    api.listPlaylists().then(setPlaylists).catch(() => setPlaylists([]));
  }, [account.connected]);
  const plRule = draft.auto_playlist ?? { mode: "off", playlist_id: null };
  const plValue = plRule.mode === "one" && plRule.playlist_id ? `pl:${plRule.playlist_id}` : plRule.mode === "genre" ? "genre" : "off";
  // Only the ones not already in (or inside) a watched folder, as the app looks in them.
  const under = (f: string, root: string) => f === root || f.startsWith(root.replace(/[\\/]+$/, "") + "/") || f.startsWith(root.replace(/[\\/]+$/, "") + "\\");
  const bkExtra = (bkFolders?.folders || []).filter((f) => !draft.sources.some((r) => under(f, r)));


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
        <h2>Appearance</h2>
        <h3 style={{ margin: "0 0 4px" }}>Light or dark</h3>
        <p className="sub" style={{ margin: "0 0 10px" }}>Ink or paper. Match my computer follows your computer's own setting.</p>
        <ThemePicker />
        <h3 style={{ margin: "18px 0 4px" }}>Rating mark</h3>
        <p className="sub" style={{ margin: "0 0 10px" }}>What ratings are drawn with. Rate a track from its row in Your tracks, or right-click it.</p>
        <GlyphPicker />
      </div>

      <div className="card">
        <h2>Lists</h2>
        <h3 style={{ margin: "0 0 4px" }}>Row spacing</h3>
        <p className="sub" style={{ margin: "0 0 10px" }}>How tall the rows are in Your tracks and History.</p>
        <div className="seg" role="radiogroup" aria-label="Row spacing">
          {DENSITIES.map((d) => (
            <button key={d.key} type="button" role="radio" aria-checked={rows === d.key}
              className={`seg__opt${rows === d.key ? " seg__opt--on" : ""}`}
              onClick={() => { setTrackRows(d.key); setHistoryRows(d.key); }}>{d.label}</button>
          ))}
        </div>
        <label className="toolchk" style={{ marginTop: 18 }}>
          <input type="checkbox" checked={preview} onChange={(e) => setPreview(e.target.checked)} />
          Preview on hover: point at a song in a list to hear a few seconds of it
        </label>
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
        {bkFolders?.installed && (
          <>
            <div className="toolchk" style={{ fontSize: 13.5, marginTop: 14 }}>
              <input type="checkbox" id="bk-folders" checked={!!draft.watch_backups_folders}
                onChange={(e) => set("watch_backups_folders", e.target.checked)} />
              <label htmlFor="bk-folders">Also look in the export folders Backups knows about</label>
            </div>
            <p className="sub" style={{ margin: "6px 0 0", fontSize: 12 }}>
              {bkFolders.folders.length === 0
                ? "Backups hasn't found any export folders yet."
                : bkExtra.length === 0
                  ? "Every export folder Backups knows about is already in your list."
                  : <>No need to add them twice: {bkExtra.length === 1 ? "this folder" : `these ${bkExtra.length} folders`} from Backups {draft.watch_backups_folders ? "are" : "would be"} looked in too.</>}
            </p>
            {draft.watch_backups_folders && bkExtra.length > 0 && (
              <div className="table" style={{ marginTop: 8 }}>
                {bkExtra.map((f) => (
                  <div key={f} className="row" style={{ marginBottom: 0 }}>
                    <span className="faint" style={{ display: "flex" }}><Icon name="folder" /></span>
                    <div className="row__main pathline"><div className="row__title mono col-trunc" style={{ fontSize: 12.5, fontWeight: 400 }} title={f}>{f}</div></div>
                    <span className="pill">from Backups</span>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
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
        <label className="field"><span>Add new posts to a playlist</span>
          <select value={plValue} disabled={!account.connected}
            onChange={(e) => {
              const v = e.target.value;
              set("auto_playlist", v === "genre" ? { mode: "genre", playlist_id: null }
                : v.startsWith("pl:") ? { mode: "one", playlist_id: Number(v.slice(3)) } : { mode: "off", playlist_id: null });
            }}>
            <option value="off">No</option>
            <option value="genre">A playlist for each genre</option>
            {plRule.mode === "one" && plRule.playlist_id && !(playlists || []).some((p) => p.id === plRule.playlist_id) && (
              <option value={plValue}>{playlists === null ? "Your playlist (loading…)" : "A playlist that's no longer there"}</option>)}
            {(playlists || []).map((p) => <option key={p.id} value={`pl:${p.id}`}>{p.title}</option>)}
          </select></label>
        <p className="sub" style={{ margin: "-4px 0 12px", fontSize: 12 }}>
          {plRule.mode === "genre"
            ? "Each new song goes into the playlist named after its genre, made the first time one goes up. A private song never makes a public playlist."
            : "Every song you post, by hand or automatically, is added to the end of that playlist. Nothing is ever taken out."}
        </p>
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
        <label className="toolchk" style={{ fontSize: 13.5, marginTop: 12 }}>
          <input type="checkbox" checked={draft.auto_cover ?? false} disabled={!canAuto}
            onChange={(e) => set("auto_cover", e.target.checked)} />
          Give automatic posts a waveform cover
        </label>
        <p className="sub" style={{ margin: "6px 0 0", fontSize: 12 }}>
          Songs posted by the folder check or as drafts get a cover drawn from the song itself, in your waveform
          colour. Off unless you tick it. Songs you post from Upload keep the cover you see there.
        </p>
        <label className="toolchk" style={{ fontSize: 13.5, marginTop: 12 }}>
          <input type="checkbox" checked={draft.auto_new_versions ?? true} disabled={!canAuto}
            onChange={(e) => set("auto_new_versions", e.target.checked)} />
          Post new versions of private songs by themselves
        </label>
        <p className="sub" style={{ margin: "6px 0 0", fontSize: 12 }}>
          When you re-export a song that's up as private, the new version goes up with the same title, cover,
          details and playlists. The old one stays until you remove it in Your tracks. Public songs always wait
          for you to press Update on Upload.
        </p>
        {!canAuto && <div className="locked-note">Automatic watch-folder uploads are a Pro feature.</div>}
      </div>

      <div className="card">
        <h2>App</h2>
        <label className="toolchk" style={{ fontSize: 13.5 }}>
          <input type="checkbox" checked={atLogin} onChange={(e) => toggleLogin(e.target.checked)} />
          Open Uploader when the computer starts
        </label>
        <label className="toolchk" style={{ fontSize: 13.5, marginTop: 8 }}>
          <input type="checkbox" checked={pauseMin} onChange={(e) => { keep(PAUSE_ON_MINIMIZE, e.target.checked); setPauseMin(e.target.checked); }} />
          Pause the music when the window is minimized
        </label>
      </div>

      <div className="card">
        <h2>What it does</h2>
        <p className="sub" style={{ marginTop: 0 }}>
          Uploader posts your mixes to SoundCloud without doubles and lets you manage every track from one place.
          It only reads your audio files; it never changes them.
        </p>
        <p className="faint" style={{ margin: 0, fontSize: 12.5 }}>Lazy Creatives · Looks lazy. Works obsessively.</p>
      </div>

      <div className="card">
        <h2>Updates</h2>
        <p className="sub" style={{ marginTop: 0 }}>The app checks for a new version on its own. Press the button to check right now.</p>
        <UpdateCheck />
      </div>

      <div className="card">
        <h2>Something not working?</h2>
        <p className="sub" style={{ marginTop: 0 }}>
          Opens a short report on GitHub with your app version and computer type filled in. You read it before you send it.
          If the app ever crashes, it offers the same report the next time it opens.
        </p>
        <div><Button sm onClick={() => (window as any).lazyupload?.reportProblem?.()}>Report a problem</Button></div>
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
