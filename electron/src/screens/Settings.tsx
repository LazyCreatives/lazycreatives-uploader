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
import { ReadingSettings } from "../components/ReadingSettings";
import { GlyphPicker } from "../components/Marks";
import { DENSITIES, useDensity } from "../marks";
import { Choice, OnOff, SetPanel, SetRow, SetTabs, useSettingsTab } from "../components/SetRow";
import { useAuditionMode } from "../audition";
import { UpdateCheck } from "../components/UpdateCheck";
import { PAUSE_ON_MINIMIZE, keep, pausesOnMinimize } from "../desktop";

const api = makeApi();

const BLANK_TEMPLATE: MetadataTemplate = {
  name: "New template", title_template: "{name}", description: "", genre: "",
  tags: [], sharing: "public", downloadable: false,
};

// How often the folder check runs. A time saved before these buttons existed still shows, as its own button.
const INTERVALS = [[0, "Off"], [15, "Every 15 min"], [60, "Hourly"], [360, "Every 6 hours"], [1440, "Daily"]] as const;
const TABS = [["folders", "Folders"], ["soundcloud", "SoundCloud"], ["posts", "New posts"], ["auto", "Automatic"],
  ["look", "Look"], ["privacy", "Privacy"], ["app", "App"]] as const;
const TAB_KEYS = TABS.map(([k]) => k);
const SHARING = [["public", "Public"], ["private", "Private"]] as const;

const LOGIN_STORAGE: Record<NonNullable<Account["login_storage"]>, string> = {
  windows: "Your SoundCloud login is encrypted and locked to your Windows user account.",
  file: "Your SoundCloud login is encrypted, with the key kept in a file only your user account can open.",
  plain: "No secure storage was found on this computer, so your SoundCloud login is saved without encryption.",
};

export function Settings({ cfg, account, ent, onCfg, onAccount, onEnt }: {
  cfg: Config; account: Account; ent: Entitlement;
  onCfg: (c: Config) => void; onAccount: (a: Account) => void; onEnt: (e: Entitlement) => void;
}) {
  const [tab, setTab] = useSettingsTab(TAB_KEYS);
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

  const every = INTERVALS.some(([m]) => m === draft.interval_minutes)
    ? INTERVALS : [...INTERVALS, [draft.interval_minutes, `Every ${draft.interval_minutes} min`] as const];
  const minLen = draft.min_length_seconds ?? 30;

  return (
    <div className="settings">
      <PageHeader title="Settings" sub="Your folders, your SoundCloud, what every post starts with, how the app looks, and what it does with your files."
        actions={savedFlash
          ? <span className="pill pill--ok" role="status">Saved</span>
          : <span className="faint settings-autosave">Changes save by themselves</span>} />
      {saveError && <div className="banner banner--warn">{saveError}</div>}

      <SetTabs tabs={TABS} value={tab} onChange={setTab} />
      <SetPanel tab={tab}>
      {tab === "folders" && <>
      <SetRow title="Watched folders" help="Where you export your mixes. Uploader finds new songs here.">
        <Folders sources={draft.sources} onChange={(s) => set("sources", s)} />
      </SetRow>
      {bkFolders?.installed && (
        <SetRow title="Backups' export folders" help="Also look in the folders where Backups finds your exported songs.">
          <OnOff label="Backups' export folders" on={!!draft.watch_backups_folders} onChange={(on) => set("watch_backups_folders", on)} />
          <p className="set-note">
            {bkFolders.folders.length === 0
              ? "Backups hasn't found any export folders yet."
              : bkExtra.length === 0
                ? "Every export folder Backups knows about is already in your list."
                : <>No need to add them twice: {bkExtra.length === 1 ? "this folder" : `these ${bkExtra.length} folders`} from Backups {draft.watch_backups_folders ? "are" : "would be"} looked in too.</>}
          </p>
          {draft.watch_backups_folders && bkExtra.length > 0 && (
            <div className="table">
              {bkExtra.map((f) => (
                <div key={f} className="row" style={{ marginBottom: 0 }}>
                  <span className="faint" style={{ display: "flex" }}><Icon name="folder" /></span>
                  <div className="row__main pathline"><div className="row__title mono col-trunc" style={{ fontSize: 12, fontWeight: 400 }} title={f}>{f}</div></div>
                  <span className="pill">from Backups</span>
                </div>
              ))}
            </div>
          )}
        </SetRow>
      )}
      <SetRow title="Skip short exports" help="Keeps clicks, test bounces and one-shots out of your Upload list. Nothing is deleted.">
        <div className="set-inline">
          <OnOff label="Skip short exports" on={minLen > 0} onChange={(on) => set("min_length_seconds", on ? 30 : 0)} />
          <label className="set-inline" style={{ opacity: minLen > 0 ? 1 : 0.5 }}>
            <span className="set-note">Shorter than</span>
            <input type="number" min={1} max={3600} aria-label="Shortest length in seconds" disabled={minLen === 0}
              value={minLen || 30} style={{ width: 64 }}
              onChange={(e) => set("min_length_seconds", Math.min(3600, Math.max(1, Math.round(Number(e.target.value)) || 1)))} />
            <span className="set-note">seconds</span>
          </label>
        </div>
        <p className="set-note">Upload can still show them. Automatic posting always skips them.</p>
      </SetRow>

      </>}
      {tab === "soundcloud" && <>
      <SetRow title={<>Accounts{ent.features.multi_account && !ent.beta && <ProBadge />}</>} help="The SoundCloud accounts Uploader posts to.">
        <ConnectPanel account={account} onChange={onAccount} />
      </SetRow>

      </>}
      {tab === "posts" && <>
      <SetRow title="Public or private" help="Who can hear a new post. You can still change each one before it goes up.">
        <Choice label="Public or private" value={draft.default_sharing} options={SHARING} onChange={(v) => set("default_sharing", v as Sharing)} />
      </SetRow>
      <SetRow title="Title" help={<>What each song is called on SoundCloud. <code>{"{name}"}</code> is the file name without the ending.</>}>
        <input type="text" aria-label="Title" value={draft.title_template}
          onChange={(e) => set("title_template", e.target.value)} placeholder="{name}" />
      </SetRow>
      <SetRow title="Genre and tags" help="Helps people find your songs on SoundCloud.">
        <input type="text" aria-label="Genre" value={draft.default_genre}
          onChange={(e) => set("default_genre", e.target.value)} placeholder="Genre, e.g. House" />
        <TagsInput aria-label="Tags" tags={draft.default_tags} onChange={(t) => set("default_tags", t)} />
      </SetRow>
      <SetRow title="Description" help="The text under every new post.">
        <textarea aria-label="Description" value={draft.default_description}
          onChange={(e) => set("default_description", e.target.value)} />
      </SetRow>
      <SetRow title="Playlist" help="Add every new post to a playlist, whether you post it or it goes up by itself.">
        <select aria-label="Playlist" value={plValue} disabled={!account.connected}
          onChange={(e) => {
            const v = e.target.value;
            set("auto_playlist", v === "genre" ? { mode: "genre", playlist_id: null }
              : v.startsWith("pl:") ? { mode: "one", playlist_id: Number(v.slice(3)) } : { mode: "off", playlist_id: null });
          }}>
          <option value="off">None</option>
          <option value="genre">A playlist for each genre</option>
          {plRule.mode === "one" && plRule.playlist_id && !(playlists || []).some((p) => p.id === plRule.playlist_id) && (
            <option value={plValue}>{playlists === null ? "Your playlist (loading…)" : "A playlist that's no longer there"}</option>)}
          {(playlists || []).map((p) => <option key={p.id} value={`pl:${p.id}`}>{p.title}</option>)}
        </select>
        {plRule.mode !== "off" && <p className="set-note">
          {plRule.mode === "genre"
            ? "Each new song goes into the playlist named after its genre, made the first time one goes up. A private song never goes in a public playlist."
            : "Each new song is added to the end of that playlist. Nothing is ever taken out."}
        </p>}
      </SetRow>
      <SetRow title="What changed comments" help="When you post a new export of a draft, add a comment listing what changed, with the time.">
        <OnOff label="What changed comments" on={draft.changelog_comments !== false} onChange={(on) => set("changelog_comments", on)} />
      </SetRow>
      <SetRow title={<>Saved sets{!canTemplates && <ProBadge />}</>} help="Titles, tags and genres you use often, saved to pick in one go on Upload.">
        {!canTemplates ? (
          <div className="locked-note">Saved sets are a Pro feature.</div>
        ) : (
          <div className="stack">
            {draft.templates.map((t, i) => (
              <div key={i} className="card" style={{ marginBottom: 0, background: "var(--surface-2)" }}>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                  <label className="field"><span>Name</span>
                    <input type="text" value={t.name} onChange={(e) => setTemplate(i, { ...t, name: e.target.value })} /></label>
                  <label className="field"><span>Public or private</span>
                    <select value={t.sharing} onChange={(e) => setTemplate(i, { ...t, sharing: e.target.value as Sharing })}>
                      <option value="public">Public</option><option value="private">Private</option>
                    </select></label>
                  <label className="field"><span>Title</span>
                    <input type="text" value={t.title_template} onChange={(e) => setTemplate(i, { ...t, title_template: e.target.value })} /></label>
                  <label className="field"><span>Genre</span>
                    <input type="text" value={t.genre} onChange={(e) => setTemplate(i, { ...t, genre: e.target.value })} /></label>
                </div>
                <label className="field"><span>Tags</span>
                  <TagsInput tags={t.tags} onChange={(tags) => setTemplate(i, { ...t, tags })} /></label>
                <div style={{ textAlign: "right" }}>
                  <Button kind="danger" sm onClick={() => removeTemplate(i)}>Remove</Button>
                </div>
              </div>
            ))}
            <div><Button sm onClick={() => set("templates", [...draft.templates, { ...BLANK_TEMPLATE }])}><Icon name="plus" />Add a saved set</Button></div>
          </div>
        )}
      </SetRow>

      </>}
      {tab === "auto" && <>
      <SetRow title={<>Automatic posting{!canAuto && <ProBadge />}</>} help="Leave the app open and it looks in your folders for new songs and posts them.">
        <Choice label="Automatic posting" value={draft.interval_minutes} options={every} disabled={!canAuto}
          onChange={(m) => set("interval_minutes", m)} />
        {!canAuto && <div className="locked-note">Automatic posting is a Pro feature.</div>}
      </SetRow>
      <SetRow title="Posts go up as" help="Private is safest: you can listen first, then make it public.">
        <Choice label="Posts go up as" value={draft.auto_upload_sharing} options={SHARING} disabled={!canAuto}
          onChange={(v) => set("auto_upload_sharing", v as Sharing)} />
      </SetRow>
      <SetRow title="Waveform cover" help="Songs that go up by themselves get a cover drawn from the song, in your waveform colour. Songs you post from Upload keep the cover you see there.">
        <OnOff label="Waveform cover" on={draft.auto_cover ?? false} disabled={!canAuto} onChange={(on) => set("auto_cover", on)} />
      </SetRow>
      <SetRow title="New versions" help="When you re-export a private song, post the new version with the same title, cover, details and playlists. The old one stays until you remove it. Public songs always wait for you to press Update.">
        <OnOff label="New versions" on={draft.auto_new_versions ?? true} disabled={!canAuto} onChange={(on) => set("auto_new_versions", on)} />
      </SetRow>

      </>}
      {tab === "look" && <>
      <SetRow title="Light or dark" help="Dark ink or light paper. Match my computer follows your computer's own setting.">
        <ThemePicker />
      </SetRow>
      <ReadingSettings />
      <SetRow title="Rating mark" help="What ratings are drawn with. Rate a track from its row in Your tracks, or right-click it.">
        <GlyphPicker />
      </SetRow>
      <SetRow title="Row spacing" help="How tall the rows are in Your tracks and History.">
        <Choice label="Row spacing" value={rows} options={DENSITIES.map((d) => [d.key, d.label] as const)}
          onChange={(k) => { setTrackRows(k); setHistoryRows(k); }} />
      </SetRow>
      <SetRow title="Preview on hover" help="Point at a song in a list to hear a few seconds of it.">
        <OnOff label="Preview on hover" on={preview} onChange={setPreview} />
      </SetRow>
      <SetRow title="Your pictures" help="Put your own pictures on covers: behind the drawing, or as the whole cover. Each mix goes up with the cover it shows here. Change one mix by right-clicking it on Upload.">
        <CoverShelf sample="Your mix" what="mix" />
      </SetRow>
      <SetRow title="Waveform colour" help="The colour of covers drawn from a song. Low sounds come out darker, high sounds brighter.">
        <div className="set-inline">
          <input type="color" value={draft.cover_waveform_color || "#86B3D3"}
            onChange={(e) => set("cover_waveform_color", e.target.value)}
            style={{ width: 44, height: 30, padding: 2, cursor: "pointer" }} aria-label="Waveform colour" />
          <span className="set-note mono">{(draft.cover_waveform_color || "#86B3D3").toUpperCase()}</span>
        </div>
      </SetRow>
      <SetRow title="Lazy Creatives mark" help="A small Lazy Creatives mark in the corner of covers drawn from a song.">
        <OnOff label="Lazy Creatives mark" on={draft.cover_watermark !== false} onChange={(on) => set("cover_watermark", on)} />
      </SetRow>

      </>}
      {tab === "privacy" && <>
      <p className="set-intro">Your music stays yours. Here is everything Uploader touches, and everything that leaves your computer.</p>
      <SetRow title="Your files" help="Your mixes and exported songs.">
        <p className="set-about">Uploader only reads them. It never moves, changes or deletes a file. Covers it draws and pictures you add are kept in its own folder.</p>
      </SetRow>
      <SetRow title="Your SoundCloud login" help="How Uploader stays signed in.">
        <p className="set-about">{account.login_storage ? LOGIN_STORAGE[account.login_storage] : "Your SoundCloud login is kept on this computer, encrypted when your computer offers a safe place for it."} Signing in passes through a small Lazy Creatives helper that holds the app's SoundCloud key. It never saves your login.</p>
      </SetRow>
      <SetRow title="What leaves your computer" help="No tracking, no adverts.">
        <p className="set-about">The songs you post, with their details and covers, go to your SoundCloud. Checking for updates asks GitHub for the newest version number. Nothing else is sent.</p>
      </SetRow>
      <SetRow title="Something not working?"
        help="Opens a short report on GitHub with your app version and computer type filled in. You read it before you send it. If the app ever crashes, it offers the same report the next time it opens.">
        <Button sm onClick={() => (window as any).lazyupload?.reportProblem?.()}>Report a problem</Button>
      </SetRow>

      </>}
      {tab === "app" && <>
      <SetRow title="Start with your computer" help="Opens Uploader when you log in, so automatic posting keeps running.">
        <OnOff label="Start with your computer" on={atLogin} onChange={toggleLogin} />
      </SetRow>
      <SetRow title="Pause when minimized" help="Stops the music when you minimize the window. Press play to carry on.">
        <OnOff label="Pause when minimized" on={pauseMin} onChange={(on) => { keep(PAUSE_ON_MINIMIZE, on); setPauseMin(on); }} />
      </SetRow>

      <SetRow title="What it does" help="Lazy Creatives. Looks lazy. Works obsessively.">
        <p className="set-about">Uploader posts your mixes to SoundCloud without doubles and lets you manage every track from one place. It only reads your audio files; it never changes them.</p>
      </SetRow>
      <SetRow title="Updates" help="The app checks for a new version by itself. Press Check for updates to look right now.">
        <UpdateCheck />
      </SetRow>
      {!ent.beta && (
        <SetRow title="Plan" help="Pro unlocks automatic posting, posting many at once, more accounts, saved sets and timed releases.">
          {ent.tier === "free" ? (
            <>
              <p className="set-about">You’re on <b>Free</b>.</p>
              <div className="set-inline">
                <input type="text" placeholder="Licence key" value={licenseKey}
                  onChange={(e) => setLicenseKey(e.target.value)} style={{ flex: 1, maxWidth: 360 }} />
                <Button kind="primary" onClick={activate} disabled={!licenseKey.trim()}>Activate</Button>
              </div>
              {licenseError && <p className="set-note set-note--bad">{licenseError}</p>}
            </>
          ) : (
            <div className="set-inline"><span className="pill pill--ok">{ent.tier} plan</span> All features unlocked.<Button sm onClick={deactivate}>Deactivate</Button></div>
          )}
        </SetRow>
      )}
      </>}
      </SetPanel>
    </div>
  );
}
