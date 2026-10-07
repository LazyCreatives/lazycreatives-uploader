import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Cover } from "./components/Cover";
import { coverState, resolveCover } from "./coverArt";
import font600 from "@fontsource/schibsted-grotesk/files/schibsted-grotesk-latin-600-normal.woff2?inline";
import font700 from "@fontsource/schibsted-grotesk/files/schibsted-grotesk-latin-700-normal.woff2?inline";

// The cover a mix shows in the app, made into a square PNG for SoundCloud, so what
// goes up is exactly what you saw. The cover is drawn as a picture of its own, which
// can't reach the app's fonts or the sidecar, so the font and your picture go inside it.
const FONTS = `@font-face{font-family:"Schibsted Grotesk";font-weight:600;src:url(${font600}) format("woff2")}`
  + `@font-face{font-family:"Schibsted Grotesk";font-weight:700;src:url(${font700}) format("woff2")}`;

async function asDataUrl(src: string): Promise<string> {
  if (src.startsWith("data:")) return src;
  const blob = await (await fetch(src)).blob();
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });
}

export async function coverPng(name: string, genre?: string | null, size = 1000): Promise<string> {
  const found = resolveCover(coverState(), name, genre);
  const art = found ? { ...found, src: await asDataUrl(found.src) } : null;
  const markup = renderToStaticMarkup(createElement(Cover, { name, genre, size, art }))
    .replace("<svg", `<svg xmlns="http://www.w3.org/2000/svg"`)
    .replace(/(<svg[^>]*>)/, `$1<style>${FONTS}</style>`);
  const img = new Image();
  img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(markup)}`;
  await img.decode();
  const c = document.createElement("canvas");
  c.width = size; c.height = size;
  c.getContext("2d")!.drawImage(img, 0, 0, size, size);
  return c.toDataURL("image/png");
}
