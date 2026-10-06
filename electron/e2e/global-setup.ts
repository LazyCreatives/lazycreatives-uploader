// Runs once before the picture tests: builds the page and makes the fake library.
import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync } from "node:fs";
import path from "node:path";
import { ELECTRON_DIR, WORK_DIR, python } from "./app";

export default function globalSetup(): void {
  // The app loads the built page (dist/), so build it from the current code.
  // E2E_SKIP_BUILD=1 skips this when dist/ is already fresh.
  if (!process.env.E2E_SKIP_BUILD) {
    execFileSync(process.execPath, [path.join(ELECTRON_DIR, "node_modules", "vite", "bin", "vite.js"), "build", "--logLevel", "warn"],
      { cwd: ELECTRON_DIR, stdio: "inherit" });
  }
  // A fresh scratch folder with 14 made-up finished mixes and a made-up Backups catalog.
  rmSync(WORK_DIR, { recursive: true, force: true });
  mkdirSync(WORK_DIR, { recursive: true });
  execFileSync(python(), [path.join(__dirname, "fixtures", "seed_files.py"), WORK_DIR], { stdio: "inherit" });
}
