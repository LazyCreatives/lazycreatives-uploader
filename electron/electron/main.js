const { app, BrowserWindow, ipcMain, dialog, shell, session } = require("electron");
const path = require("path");
const fs = require("fs");
const { startSidecar, stopSidecar, killGroup } = require("./sidecar");
const { createTray } = require("./tray");
const { startUpdater } = require("./updater");
const { windowStateOptions, installAppMenu, registerDesktopIpc, showWindow } = require("./desktop");

const isDev = !!process.env.LAZYUP_DEV;
let win = null;
let sidecar = null;
let tray = null;
let isQuitting = false;
let stopping = null;

// Single-instance: a second launch must focus the running window, not spawn a
// duplicate sidecar (which would fight over the same DB + the fixed OAuth port).
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    showWindow(win);
  });
}

function backendDir() {
  return isDev
    ? path.join(__dirname, "..", "..", "backend")
    : path.join(process.resourcesPath, "backend");
}

function dbPath() {
  return process.env.LAZYUP_DB || path.join(app.getPath("userData"), "catalog.db");
}

// The app icon (build/icon.png). Packaged builds carry it inside app.asar; if it is
// ever missing, run without it rather than fail to start (dock.setIcon throws).
const ICON = path.join(__dirname, "..", "build", "icon.png");
const hasIcon = () => fs.existsSync(ICON);

function createWindow() {
  // Reopens at the size and place it was last closed at (see desktop.js).
  const placement = windowStateOptions();
  win = new BrowserWindow({
    ...placement.options, backgroundColor: "#0D0E10",
    ...(hasIcon() ? { icon: ICON } : {}),
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true, nodeIntegration: false,
      additionalArguments: [
        `--lazyup-token=${sidecar.token}`,
        `--lazyup-port=${sidecar.port}`,
      ],
    },
  });
  placement.track(win);
  if (process.platform === "darwin" && app.dock && hasIcon()) {
    try { app.dock.setIcon(ICON); } catch (err) { console.error("[main] dock icon:", err.message); }
  }
  if (isDev) win.loadURL(`http://localhost:${process.env.LAZYUP_VITE_PORT || 5173}`);
  else win.loadFile(path.join(__dirname, "..", "dist", "index.html"));

  // The renderer only ever talks to the localhost sidecar — block navigation and
  // remote windows. External links (SoundCloud, the OAuth page) go via IPC.
  win.webContents.on("will-navigate", (e, url) => {
    if (url !== win.webContents.getURL()) e.preventDefault();
  });
  win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));

  win.webContents.on("console-message", ({ level, message }) => {
    console.log(`[renderer:${level}] ${message}`);
  });
  win.webContents.on("render-process-gone", (_e, details) => {
    console.error("[renderer GONE]", JSON.stringify(details));
  });

  // Side mouse buttons and the keyboard's Back/Forward keys reach Windows and Linux
  // apps as window commands; the page treats them like its own back/forward.
  win.on("app-command", (_e, cmd) => {
    if (cmd === "browser-backward") win.webContents.send("nav-command", "back");
    else if (cmd === "browser-forward") win.webContents.send("nav-command", "forward");
  });

  win.on("close", (e) => {
    if (!isQuitting) { e.preventDefault(); win.hide(); }
  });
}

// File pickers open where the user last picked something. Electron 43+ would
// otherwise start every picker in Downloads instead of the last-used folder.
let lastPickedDir;
async function pick(options) {
  const r = await dialog.showOpenDialog(win, { defaultPath: lastPickedDir, ...options });
  if (r.canceled || !r.filePaths.length) return null;
  const picked = r.filePaths[0];
  lastPickedDir = options.properties.includes("openDirectory") ? picked : path.dirname(picked);
  return picked;
}

registerDesktopIpc(() => win);

ipcMain.handle("pick-folder", () => pick({ properties: ["openDirectory"] }));

ipcMain.handle("pick-image", () => pick({
  properties: ["openFile"],
  filters: [{ name: "Images", extensions: ["jpg", "jpeg", "png", "webp", "gif"] }],
}));

// Read a local image into a data URL for in-app previews. Guarded against huge
// files so we never blow up the renderer with a 50 MB base64 string.
const IMAGE_MIME = {
  ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
  ".webp": "image/webp", ".gif": "image/gif",
};
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
ipcMain.handle("read-image", async (_e, target) => {
  try {
    if (typeof target !== "string" || !target) return null;
    const mime = IMAGE_MIME[path.extname(target).toLowerCase()];
    if (!mime) return null;
    const stat = await fs.promises.stat(target);
    if (!stat.isFile() || stat.size > MAX_IMAGE_BYTES) return null;
    const buf = await fs.promises.readFile(target);
    return `data:${mime};base64,${buf.toString("base64")}`;
  } catch {
    return null;
  }
});

ipcMain.handle("reveal-path", (_e, target) => {
  if (target) shell.showItemInFolder(target);
});

ipcMain.handle("open-external", (_e, url) => {
  if (typeof url === "string" && /^https?:\/\//.test(url)) shell.openExternal(url);
});

// Launch-at-login is opt-in (audit): the renderer reads/sets it; we never force it.
ipcMain.handle("get-open-at-login", () => app.getLoginItemSettings().openAtLogin);
ipcMain.handle("set-open-at-login", (_e, enabled) => {
  app.setLoginItemSettings({ openAtLogin: !!enabled });
  return app.getLoginItemSettings().openAtLogin;
});

app.whenReady().then(async () => {
  try {
    if (!gotTheLock) return; // a primary instance is already running
    // Windows taskbar identity + correctly-attributed notifications (audit).
    if (process.platform === "win32") app.setAppUserModelId("com.lazycreatives.uploader");
    // SoundCloud sign-in opens in the user's real browser (not in-app), so the CSP
    // here only needs to allow the renderer to reach the localhost sidecar.
    if (app.isPackaged) {
      session.defaultSession.webRequest.onHeadersReceived((details, cb) => {
        cb({ responseHeaders: { ...details.responseHeaders,
          "Content-Security-Policy": [
            "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; " +
            "connect-src http://127.0.0.1:* ws://127.0.0.1:*; " +
            // sndcdn hosts serve SoundCloud cover art (i*.sndcdn.com) + profile avatars
            // (a*.sndcdn.com). Without them the Manage thumbnails/fallbacks render broken
            // in packaged builds — and dev skips CSP entirely, so this only bites a ship.
            "img-src 'self' data: https://*.sndcdn.com; font-src 'self' data:",
          ] } });
      });
    }

    let sidecarOpts;
    if (app.isPackaged) {
      const exe = process.platform === "win32" ? "lazyupload-sidecar.exe" : "lazyupload-sidecar";
      const bin = path.join(process.resourcesPath, "sidecar", exe);
      if (!fs.existsSync(bin)) {
        dialog.showErrorBox("LazyCreatives Uploader — backend missing",
          `The upload engine wasn't found at:\n\n${bin}\n\nReinstalling the app should fix this.`);
        isQuitting = true; app.quit(); return;
      }
      sidecarOpts = { backendDir: path.dirname(bin), dbPath: dbPath(), command: bin, args: [] };
    } else {
      const pythonCmd = process.env.LAZYUP_PYTHON
        || (process.platform === "win32" ? "python" : "python3");
      sidecarOpts = { backendDir: backendDir(), dbPath: dbPath(), pythonCmd };
    }
    sidecar = await startSidecar(sidecarOpts);
    createWindow();
    installAppMenu({ appName: "LazyCreatives Uploader", website: "https://lazycreatives.github.io/", getWindow: () => win });
    tray = createTray({
      appName: "LazyCreatives Uploader",
      onShow: () => showWindow(win),
      onQuit: () => { isQuitting = true; app.quit(); },
    });
    startUpdater({
      appName: "LazyCreatives Uploader",
      owner: "LazyCreatives", repo: "lazycreatives-uploader",
      downloadPage: "https://lazycreatives.github.io/#download",
      getWindow: () => win,
      onMenuItem: (item) => { if (tray) tray.setUpdateItem(item); },
    });
  } catch (err) {
    dialog.showErrorBox("LazyCreatives Uploader couldn't start",
      "The upload engine failed to start.\n\n" +
      String((err && (err.stack || err.message)) || err) +
      "\n\nIf this persists, please reinstall.");
    isQuitting = true; app.quit();
  }
});

app.on("window-all-closed", () => { /* stay alive in tray */ });

app.on("before-quit", (e) => {
  isQuitting = true;
  if (sidecar && !sidecar.stopped && !stopping) {
    e.preventDefault();
    stopping = stopSidecar(sidecar).finally(() => app.exit(0));
  }
});

process.on("unhandledRejection", (reason) => console.error("[unhandledRejection]", reason));
process.on("uncaughtException", (err) => {
  console.error("[uncaughtException]", err);
  try { if (app.isReady()) dialog.showErrorBox("LazyCreatives Uploader error", String((err && err.stack) || err)); } catch { /* ignore */ }
});

process.on("exit", () => { if (sidecar) killGroup(sidecar.proc, "SIGKILL"); });

for (const sig of ["SIGINT", "SIGTERM", "SIGHUP"]) {
  process.on(sig, () => {
    if (stopping) return;
    stopping = stopSidecar(sidecar).finally(() => app.exit(0));
  });
}
