"""Boot the frozen sidecar and fail unless it answers within 60s: /health, then
/api/account (which loads the login encryption, so a missing bundled module shows
up here rather than on a user's machine)."""
import json, os, subprocess, sys, tempfile, time, urllib.request

exe = sys.argv[1]
port = "8771"
token = "ci"
env = {**os.environ, "LAZYUP_TOKEN": token, "LAZYUP_PORT": port, "LAZYUP_MOCK": "1",
       "LAZYUP_DB": os.path.join(tempfile.mkdtemp(), "ci.db")}
base = f"http://127.0.0.1:{port}"


def get(path):
    req = urllib.request.Request(base + path, headers={"X-Auth-Token": token})
    with urllib.request.urlopen(req, timeout=5) as r:
        return r.status, r.read()


proc = subprocess.Popen([exe], env=env)
try:
    for _ in range(60):
        time.sleep(1)
        if proc.poll() is not None:
            sys.exit(f"sidecar exited early with code {proc.returncode}")
        try:
            status, _ = get("/health")
        except OSError:
            continue
        if status == 200:
            # the bundled ffmpeg must run, or AIFF / Apple Lossless won't play
            if not json.loads(get("/health")[1]).get("player"):
                sys.exit("sidecar's audio decoder (ffmpeg) is missing or won't run")
            print("sidecar /health OK")
            status, body = get("/api/account")
            info = json.loads(body)
            print("login storage:", info.get("login_storage"))
            sys.exit(0 if status == 200 and info.get("login_storage") else "bad /api/account")
    sys.exit("sidecar never answered /health")
finally:
    if proc.poll() is None:
        proc.kill()
