import type { ReactNode } from "react";

export function Button({ kind = "ghost", sm, children, ...rest }:
  { kind?: "primary" | "ghost" | "danger" | "sc"; sm?: boolean; children: ReactNode } &
  React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button className={`btn btn--${kind}${sm ? " btn--sm" : ""}`} {...rest}>{children}</button>
  );
}

export function ProgressBar({ pct, active }: { pct: number; active?: boolean }) {
  return (
    <div className="progress">
      <div className={`progress__fill${active ? " progress__fill--active" : ""}`}
        style={{ width: `${Math.max(0, Math.min(100, pct))}%` }} />
    </div>
  );
}

export function ProBadge() {
  return <span className="pro-badge">PRO</span>;
}

export function PageHeader({ title, sub }: { title: string; sub?: string }) {
  return (
    <div style={{ marginBottom: 22 }}>
      <h1>{title}</h1>
      {sub && <div className="sub" style={{ margin: "4px 0 0" }}>{sub}</div>}
    </div>
  );
}

// Segmented control (e.g. public / private). Mirrors Backups' .seg.
export function Segmented<T extends string>({ value, options, onChange }: {
  value: T; options: { value: T; label: string }[]; onChange: (v: T) => void;
}) {
  return (
    <div className="seg" role="tablist">
      {options.map((o) => (
        <button key={o.value} type="button" role="tab" aria-selected={o.value === value}
          className={`seg__opt${o.value === value ? " seg__opt--on" : ""}`}
          onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

const KB = 1024, MB = KB * 1024, GB = MB * 1024;
export function fmtBytes(n: number): string {
  if (!n) return "0 B";
  if (n >= GB) return `${(n / GB).toFixed(1)} GB`;
  if (n >= MB) return `${(n / MB).toFixed(1)} MB`;
  if (n >= KB) return `${(n / KB).toFixed(0)} KB`;
  return `${n} B`;
}
export function fmtDuration(s: number | null): string {
  if (!s) return "";
  const m = Math.floor(s / 60), sec = Math.round(s % 60);
  return `${m}:${String(sec).padStart(2, "0")}`;
}
