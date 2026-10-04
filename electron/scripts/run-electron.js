// Launch Electron with ELECTRON_RUN_AS_NODE removed from the environment.
//
// Electron decides whether to run as plain Node by checking whether that variable
// is PRESENT (not whether it's truthy), so it can't be neutralised with an empty
// value — it must be deleted. A host that itself runs under Electron (VS Code,
// other editors) sets it on child processes, which would otherwise make `electron .`
// execute main.js as Node (require("electron") returns no API -> crash on load).
// Deleting it here, then spawning, fixes the dev launch from any environment.
const { spawn } = require("child_process");
const electronBinary = require("electron"); // resolves to the binary path under Node

const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;

const child = spawn(electronBinary, ["."], { stdio: "inherit", env });
child.on("close", (code) => process.exit(code == null ? 0 : code));
child.on("error", (err) => { console.error("failed to launch electron:", err); process.exit(1); });
