"""Pydantic wire models for the API. Bounded to reject hostile/oversized input."""
from typing import Literal

from pydantic import BaseModel, Field

_PATH = 4096
_LIST = 5000
_TEXT = 5000

Sharing = Literal["public", "private"]  # the only values SoundCloud accepts


class MetadataTemplate(BaseModel):
    """A saved set of defaults a user can apply to an upload (Pro feature)."""
    name: str = Field(..., max_length=80)
    title_template: str = Field("{name}", max_length=200)
    description: str = Field("", max_length=_TEXT)
    genre: str = Field("", max_length=64)
    tags: list[str] = Field(default_factory=list, max_length=50)
    sharing: Sharing = "public"
    downloadable: bool = False


class AutoPlaylist(BaseModel):
    mode: Literal["off", "one", "genre"] = "off"
    playlist_id: int | None = None


class Config(BaseModel):
    sources: list[str] = Field(default_factory=list, max_length=_LIST)  # watched folders
    interval_minutes: int = Field(0, ge=0, le=44640)  # 0 = off … max 31 days
    default_sharing: Sharing = "public"
    default_genre: str = Field("", max_length=64)
    default_tags: list[str] = Field(default_factory=list, max_length=50)
    title_template: str = Field("{name}", max_length=200)
    default_description: str = Field("", max_length=_TEXT)
    downloadable: bool = False
    # Watch-folder auto-uploads default to PRIVATE so automation never publishes a
    # render publicly without the user opting in (audit: auto-upload footgun).
    auto_upload_sharing: Sharing = "private"
    # When a WIP track is re-bounced (audio overwritten on SoundCloud), post a timestamped
    # changelog comment on the new track. On by default.
    changelog_comments: bool = True
    # Local image applied as the cover for any upload that doesn't pick its own art.
    default_artwork_path: str = Field("", max_length=1024)
    # Add a small LazyCreatives watermark to generated waveform covers. On by default.
    cover_watermark: bool = True
    # Base hue for generated waveform covers (hex). Frequency depth shades it per slice.
    cover_waveform_color: str = Field("#86B3D3", max_length=9)
    templates: list[MetadataTemplate] = Field(default_factory=list, max_length=50)
    # Exports shorter than this many seconds are hidden on Upload and never posted
    # automatically (clicks, test bounces). 0 = show everything.
    min_length_seconds: int = Field(30, ge=0, le=3600)
    watch_backups_folders: bool = False  # also look in the export folders Backups knows
    # Automatic posts (folder check, drafts) get a waveform cover drawn from the song.
    # Off unless the producer ticks it.
    auto_cover: bool = False
    # Add new posts to a playlist: {"mode": "off" | "one" | "genre", "playlist_id"}.
    auto_playlist: AutoPlaylist = Field(default_factory=lambda: AutoPlaylist())
    # When a song that is already up as a PRIVATE track is re-exported, the automatic
    # folder check posts the new version in its place. Public songs always wait for
    # the producer's Update click. On by default.
    auto_new_versions: bool = True


class ActivateRequest(BaseModel):
    key: str = Field(..., max_length=200)


class NewVersionRequest(BaseModel):
    path: str = Field(..., max_length=_PATH)  # the re-exported file to post in its song's place


class ScanRequest(BaseModel):
    sources: list[str] | None = Field(None, max_length=_LIST)  # falls back to saved config


class UploadItem(BaseModel):
    path: str = Field(..., max_length=_PATH)
    name: str | None = Field(None, max_length=300)
    title: str | None = Field(None, max_length=300)
    description: str | None = Field(None, max_length=_TEXT)
    sharing: Sharing | None = None
    genre: str | None = Field(None, max_length=64)
    tags: list[str] | None = Field(None, max_length=50)
    downloadable: bool | None = None
    file_hash: str | None = Field(None, max_length=128)
    size: int | None = Field(None, ge=0)
    artwork_path: str | None = Field(None, max_length=_PATH)  # local image; overrides default cover
    allow_double: bool = False    # post even though this song is on SoundCloud in another format/version


class UploadRequest(BaseModel):
    items: list[UploadItem] = Field(..., max_length=500)
    force: bool = False           # re-upload even if a matching hash was already published
    # If set, items upload PRIVATE now and are flipped to public at this time
    # (ISO 8601). Scheduled release is a Pro feature.
    release_at: str | None = Field(None, max_length=40)


class TrackUpdate(BaseModel):
    """Edit an existing SoundCloud track. Any field left None is left unchanged."""
    title: str | None = Field(None, max_length=300)
    description: str | None = Field(None, max_length=_TEXT)
    sharing: Sharing | None = None
    genre: str | None = Field(None, max_length=64)
    tags: list[str] | None = Field(None, max_length=50)
    downloadable: bool | None = None


class BulkTrackUpdate(BaseModel):
    """Apply one metadata/privacy patch across many tracks (Pro)."""
    ids: list[int] = Field(..., min_length=1, max_length=200)
    patch: TrackUpdate


class BulkDeleteRequest(BaseModel):
    """Delete many tracks at once (Pro). Irreversible on SoundCloud."""
    ids: list[int] = Field(..., min_length=1, max_length=200)


class ArtworkRequest(BaseModel):
    """Set one track's cover art from a local image file."""
    artwork_path: str = Field(..., max_length=1024)


class BulkArtworkRequest(BaseModel):
    """Apply one cover image to many tracks (Pro)."""
    ids: list[int] = Field(..., min_length=1, max_length=200)
    artwork_path: str = Field(..., max_length=1024)


class MixGenreRequest(BaseModel):
    """Give one or more mixes a genre of their own (None goes back to the project's)."""
    paths: list[str] = Field(..., min_length=1, max_length=5000)
    genre: str | None = Field(None, max_length=40)


class WipRequest(BaseModel):
    """Mark/unmark a track (by name) as work-in-progress (watched + re-published)."""
    name: str = Field(..., max_length=300)
    wip: bool


class AccountActivateRequest(BaseModel):
    id: str = Field(..., max_length=64)


class DisconnectRequest(BaseModel):
    id: str | None = Field(None, max_length=64)  # which account; None = the active one


class CoverRenderRequest(BaseModel):
    """A finished 1000x1000 cover drawn in the renderer, as a PNG (or JPEG) data URL."""
    name: str
    data: str


class PlaylistCreate(BaseModel):
    """A new SoundCloud playlist, optionally with tracks already in it."""
    title: str = Field(..., min_length=1, max_length=100)
    sharing: Sharing = "public"
    track_ids: list[int] = Field(default_factory=list, max_length=500)


class PlaylistUpdate(BaseModel):
    """Change details (name, description, genre, tags, privacy), or replace the ordered
    track list. None = unchanged."""
    title: str | None = Field(None, min_length=1, max_length=100)
    sharing: Sharing | None = None
    track_ids: list[int] | None = Field(None, max_length=500)
    description: str | None = Field(None, max_length=4000)
    genre: str | None = Field(None, max_length=100)
    tags: list[str] | None = Field(None, max_length=50)


class PlaylistAdd(BaseModel):
    track_ids: list[int] = Field(..., min_length=1, max_length=500)
