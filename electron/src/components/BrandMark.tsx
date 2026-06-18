// The LazyCreatives Uploader mark: the shared shield + Sloth Blue waveform (the
// family brand), but with a green UP arrow instead of Backups' verify check —
// signalling "publish / send up to SoundCloud". The waveform bars animate while `active`.
export function BrandMark({ active = false }: { active?: boolean }) {
  return (
    <svg className={`mark${active ? " mark--on" : ""}`} viewBox="0 0 64 72" fill="none"
      role="img" aria-label="LazyCreatives Uploader">
      <defs>
        <linearGradient id="umTile" x1="0" y1="0" x2="0" y2="72" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#1C1F25" /><stop offset="1" stopColor="#0B0C0F" />
        </linearGradient>
        <radialGradient id="umGlow" cx="50%" cy="28%" r="62%">
          <stop offset="0" stopColor="#86B3D3" stopOpacity="0.22" />
          <stop offset="1" stopColor="#86B3D3" stopOpacity="0" />
        </radialGradient>
      </defs>
      <path d="M32 3 L57 13 V31 C57 47 47.5 57.5 32 61.5 C16.5 57.5 7 47 7 31 V13 Z"
        fill="url(#umTile)" stroke="#86B3D3" strokeWidth="2.4" />
      <path d="M32 3 L57 13 V31 C57 47 47.5 57.5 32 61.5 C16.5 57.5 7 47 7 31 V13 Z" fill="url(#umGlow)" />
      <g className="mark__wave" stroke="#86B3D3" strokeWidth="3.2" strokeLinecap="round" opacity="0.85">
        <line x1="17" y1="36" x2="17" y2="42" />
        <line x1="23" y1="31" x2="23" y2="47" />
      </g>
      <g className="mark__wave mark__wave--single" stroke="#86B3D3" strokeWidth="3.2" strokeLinecap="round" opacity="0.5">
        <line x1="47" y1="33" x2="47" y2="45" />
      </g>
      {/* upload arrow */}
      <path d="M32 47 V31 M25 38 l7 -7 l7 7" stroke="#4ADE80" strokeWidth="4" fill="none"
        strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
