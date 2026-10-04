import type { ReactNode } from "react";

export function Button({ kind = "ghost", sm, children, ...rest }:
  { kind?: "primary" | "ghost" | "quiet" | "danger" | "sc"; sm?: boolean; children: ReactNode } &
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

export function PageHeader({ title, sub, actions }: { title: string; sub?: ReactNode; actions?: ReactNode }) {
  return (
    <header className="page-head">
      <div>
        <h1>{title}</h1>
        {sub && <p className="sub">{sub}</p>}
      </div>
      {actions && <div className="page-head__actions">{actions}</div>}
    </header>
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

// "2026-10-02 08:15:09" (or ISO) → "2 Oct, 08:15"; this year drops the year.
export function fmtWhen(s: string | null | undefined): string {
  if (!s) return "—";
  const d = new Date(s.includes("T") ? s : s.replace(" ", "T"));
  if (isNaN(d.getTime())) return s;
  const sameYear = d.getFullYear() === new Date().getFullYear();
  const day = d.toLocaleDateString("en-GB", { day: "numeric", month: "short", ...(sameYear ? {} : { year: "numeric" }) });
  return `${day}, ${d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}`;
}

// The grey second line under a row title; renders nothing when every part is empty,
// so single-line rows stay vertically centred with their neighbours.
export function SubLine({ parts }: { parts: (string | null | undefined | false)[] }) {
  const text = parts.filter(Boolean).join(" · ");
  return text ? <div className="row__sub">{text}</div> : null;
}
