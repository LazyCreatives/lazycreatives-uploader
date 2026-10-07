import { LcBrand } from "./LcBrand";
import { Icon, type IconName } from "./Icon";
import { openPalette } from "./Palette";
import { IS_MAC } from "../desktop";
import { COMPANION_KEYS, openCompanion } from "../companion";
import { NavRecents } from "./Recents";

export type Tab = "home" | "upload" | "manage" | "playlists" | "albums" | "history" | "settings";

const ITEMS: { key: Tab; label: string; icon: IconName }[] = [
  { key: "home", label: "Home", icon: "home" },
  { key: "upload", label: "Upload", icon: "upload" },
  { key: "manage", label: "Your tracks", icon: "library" },
  { key: "playlists", label: "Playlists", icon: "disc" },
  { key: "albums", label: "Albums", icon: "music" },
  { key: "history", label: "History", icon: "history" },
  { key: "settings", label: "Settings", icon: "settings" },
];

export function Nav({ tab, busy, onNavigate, account, tier, beta = false, onOpenRecent, openId }: {
  tab: Tab; busy: boolean; onNavigate: (t: Tab) => void;
  account: string | null; tier: string; beta?: boolean;
  onOpenRecent: (id: string) => void; openId?: string | null;  // the track open now
}) {
  const plan = beta ? "free beta" : tier === "free" ? "free plan" : `${tier} plan`;
  return (
    <nav className="nav">
      <LcBrand app="Uploader" tag={`Lazy Creatives · ${plan}`} busy={busy} />
      <button type="button" className="nav__find" onClick={openPalette} title="Find a page, project or action">
        <Icon name="search" size={14} /><span>Find anything</span><kbd>{IS_MAC ? "⌘K" : "Ctrl K"}</kbd>
      </button>
      {ITEMS.map((it) => (
        <button key={it.key}
          className={`nav__item${tab === it.key ? " nav__item--active" : ""}`}
          aria-current={tab === it.key ? "page" : undefined}
          onClick={() => onNavigate(it.key)}>
          <Icon name={it.icon} className="nav__icon" />
          <span className="nav__label">{it.label}</span>
          {busy && it.key === "upload" && <span className="nav__dot" />}
        </button>
      ))}
      <NavRecents onOpen={onOpenRecent} current={openId} />
      <div className="nav__spacer" />
      <NarrowWindowButton />
      <div className="nav__foot">
        <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span className={`dot${account ? " dot--ok" : ""}`} />
          {account ? "SoundCloud connected" : "Not connected"}
        </span>
        {account && <span className="faint">as {account}</span>}
      </div>
    </nav>
  );
}

// Opens the narrow window that sits beside your music program (see companion.js).
// Same in Backups and Uploader.
export function NarrowWindowButton() {
  return (
    <button type="button" className="nav__item nav__narrow" onClick={openCompanion}
      title={`A narrow window to keep beside your music program (${COMPANION_KEYS})`}>
      <Icon name="narrow" className="nav__icon" />
      <span className="nav__label">Narrow window</span>
    </button>
  );
}
