// A status badge pill (see .pill in theme.css). Maps the uploader's status strings
// to the brand pill colours; falls back to a neutral pill for anything unknown.
const CLASS: Record<string, string> = {
  ok: "pill--ok", published: "pill--ok", public: "pill--ok",
  error: "pill--error", failed: "pill--error",
  skipped: "pill--skipped",
  running: "pill--running",
  private: "pill--private",
  partial: "pill--partial",
};

export function StatusPill({ status, label }: { status: string; label?: string }) {
  const cls = CLASS[status] || "";
  return <span className={`pill ${cls}`.trim()}>{label ?? status}</span>;
}
