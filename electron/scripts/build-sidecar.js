// Freeze the Python sidecar with PyInstaller, on Windows, macOS or Linux.
//
// Uses backend/.venv when it exists (Scripts\ on Windows, bin/ elsewhere), else
// whatever `pyinstaller` is on PATH (CI installs it globally).
const { spawnSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const backend = path.resolve(__dirname, "..", "..", "backend");
const win = process.platform === "win32";
const venvBin = path.join(backend, ".venv", win ? "Scripts" : "bin", win ? "pyinstaller.exe" : "pyinstaller");
const cmd = fs.existsSync(venvBin) ? venvBin : "pyinstaller";

const res = spawnSync(cmd, ["sidecar.spec", "--noconfirm", "--distpath", "dist"],
  { cwd: backend, stdio: "inherit", shell: win && cmd === "pyinstaller" });
if (res.error) {
  console.error(`couldn't run ${cmd}: ${res.error.message}`);
  console.error("Install it with: cd backend && pip install pyinstaller");
  process.exit(1);
}
process.exit(res.status ?? 1);
