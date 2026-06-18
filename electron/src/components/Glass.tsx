import { useEffect } from "react";
import type { RefObject } from "react";

export const reduceMotion = () => matchMedia("(prefers-reduced-motion: reduce)").matches;

// Pointer-tracked specular highlight on every .glass panel under `ref` — the soft
// sheen that follows the cursor across frosted panels (see .glass::before).
export function useSpecular(ref: RefObject<HTMLElement | null>) {
  useEffect(() => {
    const root = ref.current;
    if (!root || reduceMotion()) return;
    const move = (e: MouseEvent) => {
      root.querySelectorAll<HTMLElement>(".glass").forEach((p) => {
        const r = p.getBoundingClientRect();
        p.style.setProperty("--mx", ((e.clientX - r.left) / r.width) * 100 + "%");
        p.style.setProperty("--my", ((e.clientY - r.top) / r.height) * 100 + "%");
      });
    };
    addEventListener("mousemove", move, { passive: true });
    return () => removeEventListener("mousemove", move);
  }, [ref]);
}
