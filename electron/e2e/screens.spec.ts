// Picture tests for LazyCreatives Uploader: start the real app, then take a picture
// of each main screen and compare it with the saved one. (Uploader has one look,
// Crate; Your tracks also has a Covers view.)
import { expect, test, type Locator, type Page } from "@playwright/test";
import { MIXES_DIR, closeApp, launchApp, type RunningApp } from "./app";

const LOOKS = ["crate"] as const;
type Look = (typeof LOOKS)[number];
const SCREENS = ["home", "upload", "manage", "history", "settings"] as const;

let running: RunningApp | undefined;

test.describe.configure({ mode: "serial" });
test.beforeAll(async () => { running = await launchApp(); });
test.afterAll(async () => { await closeApp(running); });

// Open the app on `tab` in `look`: both are read from localStorage when the page loads
// (lc-look: see src/look.ts; lc-last-page: the page the app reopens on).
async function open(look: Look, tab: string): Promise<Page> {
  const { page, version } = running!;
  await page.evaluate(([l, t, v]) => {
    localStorage.setItem("lc-look", l);
    localStorage.setItem("lc-last-page", JSON.stringify(t));
    localStorage.setItem("lc_onboarded", "1");     // the one-time "first backup done" note
    localStorage.setItem("lc-seen-version", v);    // "What's new" already read
  }, [look, tab, version] as const);
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-look", look);
  await settle(page);
  return page;
}

// Wait until loading is over and the page has stopped changing.
async function settle(page: Page): Promise<void> {
  await page.waitForLoadState("networkidle").catch(() => {});
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(1500); // count-ups and entrance animations finish
}

// Things that change from run to run: times and dates, the moving level meters
// and waveforms, and folder paths (the scratch folder differs per computer).
function changing(page: Page): Locator[] {
  return [
    page.locator("time"),
    page.locator("canvas"),
    page.locator("[class*='meter'], [class*='Meter']"),
    page.locator("[class*='wave'], [class*='Wave']"),
    page.locator("[class*='date'], [class*='when'], [class*='ago'], [class*='next']"),
    page.locator("[class*='path'], [title^='/'], [title*=':\\\\']"),
    page.getByText(/\b(\d{1,2}:\d{2}|today|yesterday|ago|tomorrow)\b/i),
  ];
}

async function snap(page: Page, name: string): Promise<void> {
  await expect(page).toHaveScreenshot(`${name}.png`, { mask: changing(page), fullPage: false });
}

// Fill the backend through its own API the way a user would through the app (in
// demo mode, so nothing goes to SoundCloud): connect the demo account, watch the
// mixes folder, post the six oldest mixes one at a time, and make one private.
async function fillLibrary(port: string, token: string): Promise<void> {
  const base = `http://127.0.0.1:${port}`;
  const call = async (method: string, url: string, body?: unknown) => {
    const r = await fetch(base + url, {
      method, headers: { "Content-Type": "application/json", "X-Auth-Token": token },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (!r.ok) throw new Error(`${method} ${url}: ${r.status} ${await r.text()}`);
    return r.json();
  };
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

test("first run: welcome", async () => {
  for (const look of LOOKS) {
    const page = await open(look, "home");
    await expect(page.locator(".nav")).toHaveCount(0); // not set up yet: no side bar
    await snap(page, `welcome-${look}`);
  }
});

test("main screens", async () => {
  const { port, token } = running!;
  await fillLibrary(port, token);
  for (const look of LOOKS) {
    for (const screen of SCREENS) {
      await test.step(`${screen} (${look})`, async () => {
        const page = await open(look, screen);
        await expect(page.locator(".nav")).toBeVisible();
        await snap(page, `${screen}-${look}`);
      });
    }
  }
  await test.step("manage, Covers view", async () => {
    const page = await open("crate", "manage");
    await page.locator('[aria-label="Covers"]').first().click();
    await snap(page, "manage-covers");
    await page.locator('[aria-label="Rows"]').first().click();
  });
});
