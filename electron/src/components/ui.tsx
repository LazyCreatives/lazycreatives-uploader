import { useEffect, useRef, useState, type ReactNode, type CSSProperties } from "react";

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
        style={{ "--pct": Math.max(0, Math.min(100, pct)) } as CSSProperties} />
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

const KB = 1024, MB = KB * 1024, GB = MB * 1024, TB = GB * 1024;
export function fmtBytes(n: number): string {
  if (!n) return "0 B";
  if (n >= TB) return `${(n / TB).toFixed(1)} TB`;
  if (n >= GB) return `${(n / GB).toFixed(1)} GB`;
  if (n >= MB) return `${(n / MB).toFixed(1)} MB`;
  if (n >= KB) return `${(n / KB).toFixed(0)} KB`;
  return `${n} B`;
}
export function fmtDuration(s: number | null): string {
  if (!s) return "";
  const t = Math.round(s), h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), sec = t % 60;
  const p2 = (n: number) => String(n).padStart(2, "0");
  // an hour-long DJ set reads 1:00:00, not 60:00
  return h > 0 ? `${h}:${p2(m)}:${p2(sec)}` : `${m}:${p2(sec)}`;
}
// A count with the computer's own digit grouping: 12345 -> "12,345".
export function fmtCount(n: number | null | undefined): string {
  if (n === null || n === undefined || !isFinite(n)) return "—";
  return Math.round(n).toLocaleString();
}

// "2026-10-02 08:15:09" (or ISO) → "2 Oct, 08:15"; this year drops the year.
export function fmtWhen(s: string | null | undefined): string {
  if (!s) return "—";
  const d = new Date(s.includes("T") ? s : s.replace(" ", "T"));
  if (isNaN(d.getTime())) return s;
  const now = new Date();
  const time = d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  const yesterday = new Date(now); yesterday.setDate(now.getDate() - 1);
  if (d.toDateString() === now.toDateString()) return `Today ${time}`;
  if (d.toDateString() === yesterday.toDateString()) return `Yesterday ${time}`;
  const sameYear = d.getFullYear() === now.getFullYear();
  const day = d.toLocaleDateString(undefined, { day: "numeric", month: "short", ...(sameYear ? {} : { year: "numeric" }) });
  return `${day}, ${time}`;
}

// The grey second line under a row title; renders nothing when every part is empty,
// so single-line rows stay vertically centred with their neighbours.
export function SubLine({ parts }: { parts: (string | null | undefined | false)[] }) {
  const text = parts.filter(Boolean).join(" · ");
  return text ? <div className="row__sub">{text}</div> : null;
}

// Split typed tags ("lo-fi, chill, late night") into tags: commas separate them,
// spaces stay inside a tag, and the same tag twice counts once.
export function parseTags(text: string): string[] {
  const seen = new Set<string>();
  return text.split(",").map((t) => t.trim()).filter((t) => {
    const k = t.toLowerCase();
    if (!t || seen.has(k)) return false;
    seen.add(k); return true;
  });
}

// A comma-separated tags box that keeps what you type as you type it (commas and
// spaces included) and turns it into tags when you leave the box or press Enter.
export function TagsInput({ tags, onChange, placeholder = "e.g. lo-fi, chill, late night", ...rest }: {
  tags: string[]; onChange: (tags: string[]) => void; placeholder?: string;
} & Omit<React.InputHTMLAttributes<HTMLInputElement>, "value" | "onChange">) {
  const [text, setText] = useState(tags.join(", "));
  const editing = useRef(false);
  const joined = tags.join("\n");
  useEffect(() => { if (!editing.current) setText(tags.join(", ")); }, [joined]);
  const commit = () => {
    editing.current = false;
    const next = parseTags(text);
    setText(next.join(", "));
    if (next.join("\n") !== joined) onChange(next);
  };
  return (
    <input type="text" {...rest} value={text} placeholder={placeholder}
      onFocus={() => { editing.current = true; }}
      onChange={(e) => { editing.current = true; setText(e.target.value); }}
      onBlur={commit}
      onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); commit(); } }} />
  );
}
