"""Licensing entitlement — the single source of truth for Free vs Pro features.

This is intentionally a near-clone of LazyCreatives Backups' entitlement module so
that, when the planned multi-tool dashboard arrives, both tools can be pointed at
one shared licensing service with minimal change: same tier shape, same Lemon
Squeezy activation, same HMAC-signed local cache. The only differences here are the
FEATURES map (upload-specific gates) and the env/secret names.

License activation uses Lemon Squeezy's License API when configured (env:
LS_PRO_VARIANT / LS_STUDIO_VARIANT — the variant ids of your Pro/Studio products,
or an "all-access" subscription variant). Per the plan: one online check at
activation, then cache locally and run offline.

Security (same posture as Backups):
- Built-in demo keys ONLY work when LAZYUP_DEV is set (dev/CI). A packaged build
  sets neither LS_* nor LAZYUP_DEV, so activation *fails closed* (stays Free) — no
  free-Pro backdoor ships.
- The stored tier is HMAC-signed (sign_tier) and verified on read (verify_stored)
  so hand-editing the local SQLite to grant a paid tier is rejected.
"""
import hmac
import json as _json
import os
import urllib.parse
import urllib.request

# Feature gate map. Free lets you upload by hand, one mix at a time — enough to be
# genuinely useful. Pro is the "set it and forget it" tier: watch a folder and
# publish automatically, in batches, with scheduled public release and more than
# one connected account.
FEATURES = {
    "free": {
        "auto_upload": False,       # watch a folder and upload new renders automatically
        "batch": False,             # queue more than one mix in a single run
        "schedule_release": False,  # upload private now, flip to public at a chosen time
        "multi_account": False,     # connect more than one SoundCloud account
        "metadata_templates": False,# saved title/description/tag templates
    },
    "pro": {
        "auto_upload": True, "batch": True, "schedule_release": True,
        "multi_account": True, "metadata_templates": True,
    },
    # Reserved for the bundle / all-access subscription. Same as Pro today; kept
    # distinct so the dashboard can map an "all tools" variant here later.
    "studio": {
        "auto_upload": True, "batch": True, "schedule_release": True,
        "multi_account": True, "metadata_templates": True,
    },
}

VALID_TIERS = tuple(FEATURES)

# Demo keys for development/CI only — honoured ONLY when LAZYUP_DEV is set, so they
# cannot unlock a paid tier in a shipped build.
_TEST_KEYS = {
    "LC-PRO-DEMO-2026": "pro",
    "LC-STUDIO-DEMO-2026": "studio",
}

_LS_BASE = "https://api.lemonsqueezy.com/v1/licenses"


def _entitlement_secret() -> bytes:
    """Resolve the signing key, newest-wins:
      1. LAZYUP_ENT_SECRET env var (set at packaging / runtime), then
      2. a build-injected module `lazyupload/_buildsecret.py` (git-ignored, written
         per release), then
      3. a dev-only, intentionally-public fallback.
    Release builds MUST provide (1) or (2): the repo is public, so the fallback is
    not a secret. Rotating the build secret invalidates old local entitlements
    (users simply re-activate)."""
    env = os.environ.get("LAZYUP_ENT_SECRET")
    if env:
        return env.encode()
    try:
        from lazyupload._buildsecret import ENT_SECRET  # type: ignore
        if ENT_SECRET:
            return ENT_SECRET.encode()
    except Exception:
        pass
    return b"lazyupload-dev-insecure-do-not-ship"


_ENT_SECRET = _entitlement_secret()


def _dev_keys_enabled() -> bool:
    return bool(os.environ.get("LAZYUP_DEV"))


def sign_tier(tier: str, key, instance_id) -> str:
    """HMAC over the entitlement so a hand-edited DB row is rejected on read."""
    msg = f"{tier}|{key or ''}|{instance_id or ''}".encode()
    return hmac.new(_ENT_SECRET, msg, "sha256").hexdigest()


def verify_stored(stored: dict) -> str:
    """The verified tier from a stored entitlement, or 'free' if missing/forged."""
    tier = (stored or {}).get("tier", "free")
    if tier == "free" or tier not in VALID_TIERS:
        return "free"
    expected = sign_tier(tier, stored.get("key"), stored.get("instance_id"))
    sig = stored.get("sig") or ""
    return tier if hmac.compare_digest(sig, expected) else "free"


# Free beta: while the app is not for sale, every feature is on for everyone and
# the plan box is hidden. Flip this to False (or set LAZYUP_FREE_BETA=0) when
# selling starts; the tier/licence code underneath is untouched and keeps working.
# Same switch as Backups' entitlement.FREE_BETA.
FREE_BETA = True


def free_beta() -> bool:
    env = os.environ.get("LAZYUP_FREE_BETA")
    return FREE_BETA if env is None else env not in ("", "0", "false", "no")


def features_for(tier: str) -> dict:
    if free_beta():
        return dict(FEATURES["studio"])
    return dict(FEATURES.get(tier, FEATURES["free"]))


def allows(tier: str, feature: str) -> bool:
    return bool(features_for(tier).get(feature, False))


def _variant_to_tier(variant_id) -> str | None:
    vid = str(variant_id or "")
    if vid and vid == os.environ.get("LS_STUDIO_VARIANT", ""):
        return "studio"
    if vid and vid == os.environ.get("LS_PRO_VARIANT", ""):
        return "pro"
    return None


def _ls_enabled() -> bool:
    return bool(os.environ.get("LS_PRO_VARIANT") or os.environ.get("LS_STUDIO_VARIANT"))


def _ls_request(path: str, payload: dict) -> dict | None:
    data = urllib.parse.urlencode(payload).encode()
    req = urllib.request.Request(
        _LS_BASE + path, data=data, method="POST",
        headers={"Accept": "application/json", "Content-Type": "application/x-www-form-urlencoded"},
    )
    try:
        with urllib.request.urlopen(req, timeout=12) as r:
            return _json.load(r)
    except Exception:
        return None  # network/HTTP error — treat as activation failure


def activate(key: str) -> dict | None:
    """Validate + activate a license key. Returns {"tier", "instance_id"} or None.

    Lemon Squeezy when configured; otherwise the demo keys but ONLY in dev. A
    shipped build with neither configured fails closed (returns None -> Free).
    """
    key = (key or "").strip()
    if not key:
        return None
    if _ls_enabled():
        body = _ls_request("/activate", {"license_key": key, "instance_name": "LazyCreatives Uploader"})
        if not body or not body.get("activated"):
            return None
        tier = _variant_to_tier((body.get("meta") or {}).get("variant_id"))
        if tier is None:
            return None  # a valid key, but for a product we don't map to a tier
        return {"tier": tier, "instance_id": (body.get("instance") or {}).get("id")}
    if _dev_keys_enabled():
        tier = _TEST_KEYS.get(key.upper())
        return {"tier": tier, "instance_id": None} if tier else None
    return None  # fail closed: not configured + not dev -> no activation


def deactivate(key: str, instance_id) -> None:
    """Release a seat on Lemon Squeezy (best-effort). No-op for test keys."""
    if _ls_enabled() and key and instance_id:
        _ls_request("/deactivate", {"license_key": key, "instance_id": instance_id})
