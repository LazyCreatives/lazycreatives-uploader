import { BrandLockup } from "./BrandLockup";

export type Tab = "home" | "upload" | "manage" | "history" | "settings";

const ITEMS: { key: Tab; label: string; icon: string }[] = [
  { key: "home", label: "Home", icon: "M3 11l9-8 9 8M5 10v9h5v-6h4v6h5v-9" },
  { key: "upload", label: "Upload", icon: "M12 16V4M7 9l5-5 5 5M5 20h14" },
  { key: "manage", label: "Manage", icon: "M4 6h16M4 12h16M4 18h10M18 16v6M15 19h6" },
  { key: "history", label: "History", icon: "M3 12a9 9 0 1 0 9-9 9 9 0 0 0-7 3.3M3 4v4h4M12 7v5l4 2" },
  { key: "settings", label: "Settings", icon: "M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6M19 12l2 1-2 4-2-1a7 7 0 0 1-2 1l-1 2H10l-1-2a7 7 0 0 1-2-1l-2 1-2-4 2-1a7 7 0 0 1 0-2L1 8l2-4 2 1a7 7 0 0 1 2-1l1-2h4l1 2a7 7 0 0 1 2 1l2-1 2 4-2 1a7 7 0 0 1 0 2Z" },
];

export function Nav({ tab, busy, onNavigate, account, tier }: {
  tab: Tab; busy: boolean; onNavigate: (t: Tab) => void;
  account: string | null; tier: string;
}) {
  return (
    <nav className="nav">
      <div className="nav__brand nav__brand--lockup" title="Lazy Creatives — Uploader">
        <BrandLockup active={busy} />
        <span className="nav__brandtool">Uploader</span>
      </div>
      {ITEMS.map((it) => (
        <button key={it.key}
          className={`nav__item${tab === it.key ? " nav__item--active" : ""}`}
          onClick={() => onNavigate(it.key)}>
          <svg className="nav__icon" viewBox="0 0 24 24" fill="none" stroke="currentColor"
            strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d={it.icon} />
          </svg>
          <span className="nav__label">{it.label}</span>
          {busy && it.key === "upload" && <span className="nav__dot" />}
        </button>
      ))}
      <div className="nav__spacer" />
      <div className="nav__foot">
        {account ? <>Connected as <b style={{ color: "var(--text-dim)" }}>{account}</b><br /></> : "Not connected"}
        <span style={{ textTransform: "uppercase", letterSpacing: ".05em" }}>
          {tier === "free" ? "Free plan" : `${tier} plan`}
        </span>
      </div>
    </nav>
  );
}
