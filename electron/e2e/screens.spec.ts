// Picture tests for LazyCreatives Uploader: start the real app, then take a picture
// of each main screen and compare it with the saved one. (Uploader has one look,
// Crate; Your tracks also has a Covers view.)
import { expect, test, type Locator, type Page } from "@playwright/test";
import { WINDOW, closeApp, launchApp, resizeWindow, type RunningApp } from "./app";
import { apiOf, fillLibrary } from "./library";

const LOOKS = ["crate"] as const;
type Look = (typeof LOOKS)[number];
const SCREENS = ["home", "upload", "manage", "history", "settings"] as const;
type Theme = "dark" | "light";
// The smallest the window can be made (MIN_SIZE in electron/desktop.js): the
// narrow-window layout (max-width 1099px) at its tightest.
const NARROW = { width: 760, height: WINDOW.height };

let running: RunningApp | undefined;

test.describe.configure({ mode: "serial" });
test.beforeAll(async () => { running = await launchApp(); });
test.afterAll(async () => { await closeApp(running); });

// Open the app on `tab` in `look` and `theme`: all three are read from localStorage
// when the page loads (lc-look, lc-theme: see src/look.ts; lc-last-page: the page the
// app reopens on).
async function open(look: Look, tab: string, theme: Theme = "dark"): Promise<Page> {
  const { page, version } = running!;
  await page.evaluate(([l, t, v, th]) => {
    localStorage.setItem("lc-look", l);
    localStorage.setItem("lc-theme", th);
    localStorage.setItem("lc-last-page", JSON.stringify(t));
    localStorage.setItem("lc_onboarded", "1");     // the one-time "first backup done" note
    localStorage.setItem("lc-seen-version", v);    // "What's new" already read
  }, [look, tab, version, theme] as const);
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-look", look);
  await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
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
    await page.getByRole("radio", { name: "Covers" }).first().click();
    await snap(page, "manage-covers");
    await page.getByRole("radio", { name: "Rows" }).first().click();
  });
});

test("light mode", async () => {
  for (const look of LOOKS) {
    for (const screen of SCREENS) {
      await test.step(`${screen} light (${look})`, async () => {
        const page = await open(look, screen, "light");
        await expect(page.locator(".nav")).toBeVisible();
        await snap(page, `${screen}-${look}-light`);
      });
    }
  }
});

test("narrow window", async () => {
  await resizeWindow(running!, NARROW);
  try {
    for (const look of LOOKS) {
      for (const screen of ["upload", "manage"]) {
        await test.step(`${screen} narrow (${look})`, async () => {
          const page = await open(look, screen);
          await expect(page.locator(".nav")).toBeVisible();
          await snap(page, `${screen}-${look}-narrow`);
        });
      }
    }
  } finally {
    await resizeWindow(running!, WINDOW);
  }
});

// Last, because it stops the page's clock: an album's "44 days to go" and release
// date read from today's date. The clock is fixed only for the page (dates are
// worked out there), so the backend's own times are left alone.
test("albums", async () => {
  const { page, port, token } = running!;
  const call = apiOf(port, token);
  await page.clock.setFixedTime(new Date("2026-10-01T12:00:00Z"));
  const songs = (await call("GET", "/api/albums/candidates")) as { path: string; title: string; project: string; genre?: string }[];
  expect(songs.length).toBeGreaterThan(5);
  const pick = [...songs].sort((a, b) => a.path.localeCompare(b.path)).slice(0, 6);
  const album = await call("POST", "/api/albums", { title: "Late Night Tapes", release_date: "2026-11-14" });
  await call("POST", `/api/albums/${album.id}/songs`, { songs: pick.map(({ path, title, project, genre }) => ({ path, title, project, genre })) });
  await call("PUT", `/api/albums/${album.id}`, { crossfade: 3 });
  await call("PUT", `/api/albums/${album.id}/song`, { path: pick[0].path, ready: true });
  await call("PUT", `/api/albums/${album.id}/song`, { path: pick[1].path, ready: true, gapless_after: true });
  await call("POST", "/api/albums", { title: "Sketchbook Vol. 2", release_date: "" });
  for (const look of LOOKS) {
    await test.step(`albums (${look})`, async () => {
      const p = await open(look, "albums");
      await expect(p.getByText("Late Night Tapes").first()).toBeVisible();
      await snap(p, `albums-${look}`);
    });
    await test.step(`album (${look})`, async () => {
      await page.locator(".alb-row").filter({ hasText: "Late Night Tapes" }).click();
      await expect(page.locator(".albpage__head")).toBeVisible();
      // each song's quality check reads its file once; wait for every answer
      await expect(page.locator(".alb-q", { hasText: "Checking" })).toHaveCount(0, { timeout: 30_000 });
      await settle(page);
      await snap(page, `album-${look}`);
    });
  }
});
