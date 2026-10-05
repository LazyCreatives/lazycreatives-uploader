const { contextBridge, ipcRenderer } = require("electron");

function argValue(flag) {
  const a = process.argv.find((x) => x.startsWith(flag + "="));
  return a ? a.slice(flag.length + 1) : "";
}

contextBridge.exposeInMainWorld("lazyupload", {
  token: argValue("--lazyup-token"),
  port: argValue("--lazyup-port"),
  pickFolder: () => ipcRenderer.invoke("pick-folder"),
  pickImage: () => ipcRenderer.invoke("pick-image"),
  readImage: (p) => ipcRenderer.invoke("read-image", p),
  revealPath: (target) => ipcRenderer.invoke("reveal-path", target),
  openExternal: (url) => ipcRenderer.invoke("open-external", url),
  getOpenAtLogin: () => ipcRenderer.invoke("get-open-at-login"),
  setOpenAtLogin: (enabled) => ipcRenderer.invoke("set-open-at-login", enabled),
  // "Check for updates" in Settings (see updater.js).
  updateStatus: () => ipcRenderer.invoke("update-status"),
  checkForUpdates: () => ipcRenderer.invoke("update-check"),
  applyUpdate: () => ipcRenderer.invoke("update-apply"),
  whatsNew: () => ipcRenderer.invoke("whats-new"),
  // Back/forward from the mouse's side buttons (see nav.ts).
  onNavCommand: (cb) => {
    const h = (_e, dir) => cb(dir);
    ipcRenderer.on("nav-command", h);
    return () => ipcRenderer.removeListener("nav-command", h);
  },
  onUpdateStatus: (cb) => {
    const h = (_e, s) => cb(s);
    ipcRenderer.on("update-status", h);
    return () => ipcRenderer.removeListener("update-status", h);
  },
});
