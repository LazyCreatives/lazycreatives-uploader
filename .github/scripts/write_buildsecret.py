"""Write backend/lazyupload/_buildsecret.py for an installer build.

ENT_SECRET signs the local licence cache; a throwaway key is used when the repo
secret isn't set. SoundCloud client id and the login-helper address/key are
written when set; without them the app runs in demo mode. The SoundCloud client
secret is never written: the login helper service holds it. A release build on the
public repo stops if the SoundCloud id or login-helper address/key is missing."""
import os
import pathlib
import secrets
import sys

values = {
    "ENT_SECRET": os.environ.get("ENT_SECRET") or secrets.token_hex(32),
    "SC_CLIENT_ID": os.environ.get("SC_CLIENT_ID", ""),
    "BROKER_URL": os.environ.get("BROKER_URL", ""),
    "BROKER_KEY": os.environ.get("BROKER_KEY", ""),
}
# A release build on the public repo must be able to sign in to SoundCloud; refuse
# to ship a demo-only release because a repository secret was missed.
is_release = (os.environ.get("GITHUB_REF", "").startswith("refs/tags/v")
              and not os.environ.get("GITHUB_REPOSITORY", "").endswith("-dev"))
missing = [k for k in ("SC_CLIENT_ID", "BROKER_URL", "BROKER_KEY") if not values[k]]
if is_release and missing:
    sys.exit("Release build is missing repository secrets: "
             + ", ".join("LAZYUP_" + k for k in missing)
             + ". Add them on the public repo (Settings > Secrets and variables > Actions)"
             " or the app would ship in demo mode.")

out = pathlib.Path(__file__).resolve().parents[2] / "backend" / "lazyupload" / "_buildsecret.py"
out.write_text("".join(f"{k} = {v!r}\n" for k, v in values.items()))
print("wrote", out.name, "with", ", ".join(k for k, v in values.items() if v))
