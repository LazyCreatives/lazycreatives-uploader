const { app, BrowserWindow, ipcMain, dialog, shell, session } = require("electron");
const path = require("path");
const fs = require("fs");
const { startSidecar, stopSidecar, killGroup } = require("./sidecar");
const { createTray } = require("./tray");

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
    if (win) { if (win.isMinimized()) win.restore(); win.show(); win.focus(); }
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

function maybeIcon() {
  const p = path.join(__dirname, "..", "build", "icon.png");
  return fs.existsSync(p) ? p : undefined;
}

function createWindow() {
  win = new BrowserWindow({
    width: 1100, height: 760, backgroundColor: "#0A0B0D",
    icon: maybeIcon(),
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true, nodeIntegration: false,
      additionalArguments: [
        `--lazyup-token=${sidecar.token}`,
        `--lazyup-port=${sidecar.port}`,
      ],
    },
  });
  if (isDev) win.loadURL(`http://localhost:${process.env.LAZYUP_VITE_PORT || 5173}`);
  else win.loadFile(path.join(__dirname, "..", "dist", "index.html"));

  // The renderer only ever talks to the localhost sidecar — block navigation and
  // remote windows. External links (SoundCloud, the OAuth page) go via IPC.
  win.webContents.on("will-navigate", (e, url) => {
    if (url !== win.webContents.getURL()) e.preventDefault();
  });
  win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));

  const LEVELS = ["log", "info", "warn", "error"];
  win.webContents.on("console-message", (_e, level, message) => {
    console.log(`[renderer:${LEVELS[level] || level}] ${message}`);
  });
  win.webContents.on("render-process-gone", (_e, details) => {
    console.error("[renderer GONE]", JSON.stringify(details));
  });

  win.on("close", (e) => {
    if (!isQuitting) { e.preventDefault(); win.hide(); }
  });
}

ipcMain.handle("pick-folder", async () => {
  const r = await dialog.showOpenDialog(win, { properties: ["openDirectory"] });
  return r.canceled ? null : r.filePaths[0];
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
            "connect-src http://127.0.0.1:* ws://127.0.0.1:*; img-src 'self' data:; font-src 'self' data:",
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
    tray = createTray({
      onShow: () => { if (win) win.show(); },
      onQuit: () => { isQuitting = true; app.quit(); },
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
