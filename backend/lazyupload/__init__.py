"""LazyCreatives Uploader — automatically publish your finished mixes to SoundCloud.

A sibling to LazyCreatives Backups: same Electron + Python/FastAPI sidecar shape,
same entitlement model. Where Backups watches DAW *projects* and snapshots them,
Uploader watches your *render/mixdown* folder and publishes new audio to SoundCloud
(de-duplicated by content hash, so a mix never double-posts).
"""
__version__ = "0.1.0"
