// The made-up library the picture tests use, filled through the backend's own API.
// Shared by screens.spec.ts and colourblind.spec.ts.
import { expect } from "@playwright/test";
import { MIXES_DIR } from "./app";

// The backend's API, signed in as the app is.
export function apiOf(port: string, token: string) {
  const base = `http://127.0.0.1:${port}`;
  return async (method: string, url: string, body?: unknown) => {
    const r = await fetch(base + url, {
      method, headers: { "Content-Type": "application/json", "X-Auth-Token": token },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (!r.ok) throw new Error(`${method} ${url}: ${r.status} ${await r.text()}`);
    return r.json();
  };
}

// Fill the backend through its own API the way a user would through the app (in
// demo mode, so nothing goes to SoundCloud): connect the demo account, watch the
// mixes folder, post the six oldest mixes one at a time, and make one private.
export async function fillLibrary(port: string, token: string): Promise<void> {
  const call = apiOf(port, token);
  await call("POST", "/api/connect"); // demo mode connects at once as "you (demo)"
  await expect.poll(async () => (await call("GET", "/api/account")).connected, { timeout: 15_000 }).toBe(true);
  const cfg = await call("GET", "/api/settings");
  await call("PUT", "/api/settings", { ...cfg, sources: [MIXES_DIR], default_sharing: "public",
    default_tags: ["lazycreatives", "bedroom producer"],
    default_description: "Made in the studio this week. Headphones on." });
  const { mixes } = await call("POST", "/api/scan", {});
  for (const m of mixes.slice(-6).reverse() as { path: string; name: string; size: number }[]) {
    const { job_id } = await call("POST", "/api/upload", { items: [{ path: m.path, name: m.name, size: m.size }] });
    await expect.poll(async () => (await call("GET", `/api/jobs/${job_id}`)).state, { timeout: 60_000, intervals: [250] })
      .not.toBe("running");
  }
  const { tracks } = await call("GET", "/api/tracks");
  const north = tracks.find((t: { title: string }) => /Northbound/.test(t.title));
  if (north) await call("PUT", `/api/tracks/${north.id}`, { sharing: "private" });
}
