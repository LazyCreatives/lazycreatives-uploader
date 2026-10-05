import { useEffect, useRef, useState } from "react";
import { makeApi } from "../api";
import { coverColor } from "../look";
import { Cover } from "./Cover";
import { Icon } from "./Icon";
import { Wave } from "./Wave";

const api = makeApi();

// One shared <audio> for the whole app, so starting a mix stops the last one.
// Components subscribe to know whether *their* file is the one playing; the player
// bar along the bottom shows whatever is loaded.
// `cover` is the name the drawn cover art comes from: the Backups project when the mix is
// linked to one, so a song has the same cover in both apps. `genre` colours it.
export interface SongMeta { title: string; sub?: string; genre?: string | null; art?: string | null; cover?: string | null }
type State = {
  path: string | null; playing: boolean; error: string | null;
  meta: SongMeta | null; time: number; duration: number;
};
let audio: HTMLAudioElement | null = null;
let state: State = { path: null, playing: false, error: null, meta: null, time: 0, duration: 0 };
const subs = new Set<(s: State) => void>();

function set(next: Partial<State>) {
  state = { ...state, ...next };
  subs.forEach((f) => f(state));
}

function el(): HTMLAudioElement {
  if (!audio) {
    audio = new Audio();
    audio.addEventListener("playing", () => set({ playing: true, error: null }));
    audio.addEventListener("pause", () => set({ playing: false }));
    audio.addEventListener("ended", () => set({ playing: false }));
    audio.addEventListener("timeupdate", () => set({ time: audio!.currentTime }));
    audio.addEventListener("durationchange", () => set({ duration: audio!.duration || 0 }));
    audio.addEventListener("error", () => set({ playing: false, error: "Couldn't play this file" }));
  }
  return audio;
}

export function toggle(path: string, meta?: SongMeta) {
  const a = el();
  if (state.path === path && !a.paused) { a.pause(); return; }
  if (state.path !== path) {
    a.src = api.audioUrl(path);
    set({ path, error: null, meta: meta ?? { title: path.split(/[\\/]/).pop() || "Mix" }, time: 0, duration: 0 });
  }
  a.play().catch(() => set({ playing: false, error: "Couldn't play this file" }));
}

// The Space bar: pause, or carry on with whatever is in the player bar. False when
// nothing is loaded, so the key is left alone.
export function togglePlaying(): boolean {
  if (!state.path) return false;
  toggle(state.path, state.meta ?? undefined);
  return true;
}

export function seek(fraction: number) {
  if (audio && state.duration) audio.currentTime = fraction * state.duration;
}

export function close() {
  if (audio) { audio.pause(); audio.removeAttribute("src"); audio.load(); }
  set({ path: null, playing: false, meta: null, time: 0, duration: 0, error: null });
}

function usePlayerState() {
  const [s, setS] = useState<State>(state);
  useEffect(() => { subs.add(setS); return () => { subs.delete(setS); }; }, []);
  return s;
}

export function usePlayer(path: string | null | undefined) {
  const s = usePlayerState();
  const mine = !!path && s.path === path;
  return { playing: mine && s.playing, error: mine ? s.error : null, played: mine && s.duration ? s.time / s.duration : 0 };
}

// ── waveforms: a local mix is asked of the upload service first (WAV, AIFF), and
// anything it can't read (MP3 and the like) is decoded here, one at a time, only once
// it's on screen. A track with no local file uses SoundCloud's own waveform.
const peakCache = new Map<string, number[] | null>();
const waiting = new Map<string, Promise<number[] | null>>();
let queue: Promise<unknown> = Promise.resolve();
const BARS = 120;

async function decodeHere(path: string): Promise<number[] | null> {
  const run = queue.then(async () => {
    try {
      const buf = await (await fetch(api.audioUrl(path))).arrayBuffer();
      const ctx = new OfflineAudioContext(1, 1, 44100);
      const audioBuf = await ctx.decodeAudioData(buf);
      const ch = audioBuf.getChannelData(0);
      const step = Math.max(1, Math.floor(ch.length / BARS));
      const out: number[] = [];
      for (let i = 0; i < BARS; i++) {
        let m = 0;
        for (let j = i * step, end = Math.min(ch.length, j + step); j < end; j += 16) m = Math.max(m, Math.abs(ch[j]));
        out.push(m);
      }
      const top = Math.max(...out) || 1;
      return out.map((v) => Math.round((v / top) * 1000) / 1000);
    } catch { return null; }
  });
  queue = run;
  return run;
}

export interface PeakSource { path?: string | null; scUrl?: string | null }
const keyOf = (src: PeakSource) => src.path ? `f:${src.path}` : src.scUrl ? `s:${src.scUrl}` : "";

function loadPeaks(src: PeakSource): Promise<number[] | null> {
  const key = keyOf(src);
  if (peakCache.has(key)) return Promise.resolve(peakCache.get(key)!);
  let p = waiting.get(key);
  if (!p) {
    p = (src.path
      ? api.peaks(src.path).then((r) => r.peaks ?? decodeHere(src.path!))
      : api.scPeaks(src.scUrl!).then((r) => r.peaks))
      .catch(() => null)
      .then((v) => { peakCache.set(key, v); waiting.delete(key); return v; });
    waiting.set(key, p);
  }
  return p;
}

// Peaks for one mix or track, fetched once the returned ref's element scrolls into view.
export function usePeaks(src: PeakSource) {
  const key = keyOf(src);
  const ref = useRef<HTMLDivElement | null>(null);
  const [peaks, setPeaks] = useState<number[] | null>(key ? peakCache.get(key) ?? null : null);
  useEffect(() => {
    if (!key) { setPeaks(null); return; }
    if (peakCache.has(key)) { setPeaks(peakCache.get(key)!); return; }
    setPeaks(null);
    let alive = true;
    const go = () => loadPeaks(src).then((v) => { if (alive) setPeaks(v); });
    const node = ref.current;
    if (!node || typeof IntersectionObserver === "undefined") { go(); return () => { alive = false; }; }
    const io = new IntersectionObserver((es) => { if (es.some((e) => e.isIntersecting)) { io.disconnect(); go(); } });
    io.observe(node);
    return () => { alive = false; io.disconnect(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return { ref, peaks };
}

// A mix's waveform. With a local file you can click it to play from that point;
// a SoundCloud-only track just shows its shape.
export function SongWave({ path, scUrl, meta, height = 26 }: {
  path?: string | null; scUrl?: string | null; meta: SongMeta; height?: number;
}) {
  const { ref, peaks } = usePeaks({ path, scUrl });
  const { played } = usePlayer(path);
  return (
    <div ref={ref} className="songwave" onClick={(e) => { if (path) e.stopPropagation(); }}>
      <Wave peaks={peaks} color={coverColor(meta.genre, meta.cover || meta.title)} played={played} height={height}
        onSeek={path ? (f) => { if (state.path !== path) toggle(path, meta); setTimeout(() => seek(f), 60); } : undefined} />
    </div>
  );
}

// Round play / pause button for one mix. Stops click-through so it can sit inside a row.
export function PlayButton({ path, size = 30, meta, className = "" }: {
  path: string; size?: number; meta: SongMeta; className?: string;
}) {
  const { playing, error } = usePlayer(path);
  return (
    <button type="button" className={`playbtn${playing ? " playbtn--on" : ""} ${className}`.trim()}
      style={{ width: size, height: size }}
      aria-label={playing ? "Pause" : `Play ${meta.title}`}
      title={error ?? (playing ? "Pause" : `Play ${meta.title}`)}
      onClick={(e) => { e.stopPropagation(); toggle(path, meta); }}
      onKeyDown={(e) => e.stopPropagation()}>
      <Icon name={playing ? "pause" : "play"} size={Math.round(size * 0.4)} />
    </button>
  );
}

// Cover art: the real SoundCloud artwork when there is one, otherwise the drawn cover.
export function Art({ meta, size, className = "" }: { meta: SongMeta; size?: number; className?: string }) {
  if (meta.art) {
    return <img src={meta.art} alt="" className={`cover ${className}`.trim()}
      style={size ? { width: size, height: size, objectFit: "cover" } : { objectFit: "cover" }} />;
  }
  return <Cover name={meta.cover || meta.title} genre={meta.genre} size={size} className={className} label={!size || size >= 80} />;
}

const clock = (t: number) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, "0")}`;

// The bar along the bottom while a mix is loaded: what it is, where you are, controls.
export function PlayerBar() {
  const s = usePlayerState();
  const { peaks } = usePeaks({ path: s.path });
  useEffect(() => {
    document.documentElement.classList.toggle("has-player", !!s.path);
  }, [s.path]);
  if (!s.path || !s.meta) return null;
  const m = s.meta;
  return (
    <div className="playerbar" role="region" aria-label="Now playing">
      <Art meta={m} size={44} />
      <div className="playerbar__what">
        <div className="playerbar__title">{m.title}</div>
        <div className="playerbar__sub">{s.error ?? m.sub ?? ""}</div>
      </div>
      <button type="button" className="playbtn playerbar__play" onClick={() => toggle(s.path!, m)}
        aria-label={s.playing ? "Pause" : "Play"}>
        <Icon name={s.playing ? "pause" : "play"} size={14} />
      </button>
      <span className="playerbar__time">{clock(s.time)}</span>
      <Wave peaks={peaks} color={coverColor(m.genre, m.cover || m.title)} played={s.duration ? s.time / s.duration : 0}
        height={36} onSeek={seek} className="playerbar__wave" />
      <span className="playerbar__time">{s.duration ? clock(s.duration) : "–:––"}</span>
      <button type="button" className="iconbtn" onClick={close} aria-label="Close the player"><Icon name="close" /></button>
    </div>
  );
}
