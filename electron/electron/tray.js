const { Tray, Menu, nativeImage } = require("electron");
const path = require("path");
const fs = require("fs");

// A tray entry to reopen/quit. The icon is optional in dev — if the asset is
// missing we fall back to an empty image so the app still runs.
function createTray({ onShow, onQuit }) {
  const iconPath = path.join(__dirname, "..", "build", "tray.png");
  const img = fs.existsSync(iconPath)
    ? nativeImage.createFromPath(iconPath)
    : nativeImage.createEmpty();
  let tray;
  try {
    tray = new Tray(img);
  } catch {
    return null; // some platforms reject an empty tray image — skip it in dev
  }
  tray.setToolTip("LazyCreatives Uploader");
  // updateItem: "Restart to update…" / "Download version…" once the updater finds one.
  const build = (updateItem) => tray.setContextMenu(Menu.buildFromTemplate([
    { label: "Open LazyCreatives Uploader", click: onShow },
    ...(updateItem ? [updateItem] : []),
    { type: "separator" },
    { label: "Quit", click: onQuit },
  ]));
  build(null);
  tray.setUpdateItem = build;
  tray.on("click", onShow);
  return tray;
}

module.exports = { createTray };
