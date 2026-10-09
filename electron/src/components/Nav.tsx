import { useEffect, useState, type ReactNode } from "react";
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

// Below 880px wide the sidebar shows icons only (lazy-ui.css): each one then needs
// its name as a tooltip. Screen readers get the name at every width.
const ICONS_ONLY = "(max-width: 880px)";
function useIconsOnly(): boolean {
  const [on, setOn] = useState(() => typeof window !== "undefined" && !!window.matchMedia?.(ICONS_ONLY).matches);
  useEffect(() => {
    const m = window.matchMedia?.(ICONS_ONLY);
    if (!m) return;
    const f = () => setOn(m.matches);
    f();
    m.addEventListener("change", f);
    return () => m.removeEventListener("change", f);
  }, []);
  return on;
}

export function Nav({ tab, busy, onNavigate, account, tier, beta = false, onOpenRecent, openId, signIn }: {
  tab: Tab; busy: boolean; onNavigate: (t: Tab) => void;
  account: string | null; tier: string; beta?: boolean;
  onOpenRecent: (id: string) => void; openId?: string | null;  // the track open now
  // SoundCloud stopped accepting the saved sign-in: say so and offer to sign in again.
  signIn?: { signedOut: boolean; waiting: ReactNode; busy: boolean; start: () => void };
}) {
  const out = !!signIn?.signedOut;
  const iconsOnly = useIconsOnly();
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
          aria-label={it.label} title={iconsOnly ? it.label : undefined}
          onClick={() => onNavigate(it.key)}>
          <Icon name={it.icon} className="nav__icon" />
          <span className="nav__label">{it.label}</span>
          {busy && it.key === "upload" && <span className="nav__dot" />}
        </button>
      ))}
      <NavRecents onOpen={onOpenRecent} current={openId} />
      <div className="nav__spacer" />
      <NarrowWindowButton />
      {out && signIn && (
        <button type="button" className="nav__item nav__signin" onClick={signIn.start} disabled={signIn.busy}
          aria-label={signIn.busy ? "Waiting for browser" : "Sign in again"}
          title="SoundCloud signed you out. Sign in again to post and edit your tracks.">
          <Icon name="alert" className="nav__icon" />
          <span className="nav__label">{signIn.busy ? "Waiting for browser…" : "Sign in again"}</span>
        </button>
      )}
      <div className="nav__foot">
        <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span className={`dot${out ? " dot--warn" : account ? " dot--ok" : ""}`} />
          {out ? "SoundCloud signed you out" : account ? "SoundCloud connected" : "Not connected"}
        </span>
        {account && <span className="faint">as {account}</span>}
        {out && signIn?.waiting}
      </div>
    </nav>
  );
}

// Opens the narrow window that sits beside your music program (see companion.js).
// Same in Backups and Uploader.
export function NarrowWindowButton() {
  return (
    <button type="button" className="nav__item nav__narrow" onClick={openCompanion} aria-label="Narrow window"
      title={`A narrow window to keep beside your music program (${COMPANION_KEYS})`}>
      <Icon name="narrow" className="nav__icon" />
      <span className="nav__label">Narrow window</span>
    </button>
  );
}
