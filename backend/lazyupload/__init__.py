"""LazyCreatives Uploader — automatically publish your finished mixes to SoundCloud.

A sibling to LazyCreatives Backups: same Electron + Python/FastAPI sidecar shape,
same entitlement model. Where Backups watches DAW *projects* and snapshots them,
Uploader watches your *render/mixdown* folder and publishes new audio to SoundCloud
(de-duplicated by content hash, so a mix never double-posts).
"""
__version__ = "0.1.0"

# Trust the computer's own certificate store (Windows, macOS, Linux) for HTTPS, so
# sign-in and uploads also work behind work or college networks that check secure
# traffic with their own certificate. Must run before anything imports requests.
try:
    import truststore

    truststore.inject_into_ssl()
except Exception:  # pragma: no cover - fall back to the bundled certificate list
    pass
