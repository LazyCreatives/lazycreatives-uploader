import { LcBrand } from "./LcBrand";
import { Icon, type IconName } from "./Icon";

export type Tab = "home" | "upload" | "manage" | "history" | "settings";

const ITEMS: { key: Tab; label: string; icon: IconName }[] = [
  { key: "home", label: "Home", icon: "home" },
  { key: "upload", label: "Upload", icon: "upload" },
  { key: "manage", label: "Your tracks", icon: "library" },
  { key: "history", label: "History", icon: "history" },
  { key: "settings", label: "Settings", icon: "settings" },
];

export function Nav({ tab, busy, onNavigate, account, tier, beta = false }: {
  tab: Tab; busy: boolean; onNavigate: (t: Tab) => void;
  account: string | null; tier: string; beta?: boolean;
}) {
  const plan = beta ? "free beta" : tier === "free" ? "free plan" : `${tier} plan`;
  return (
    <nav className="nav">
      <LcBrand app="Uploader" tag={`Lazy Creatives · ${plan}`} busy={busy} />
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
      <div className="nav__spacer" />
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
