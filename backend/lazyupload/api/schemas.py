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
    templates: list[MetadataTemplate] = Field(default_factory=list, max_length=50)


class ActivateRequest(BaseModel):
    key: str = Field(..., max_length=200)


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


class WipRequest(BaseModel):
    """Mark/unmark a track (by name) as work-in-progress (watched + re-published)."""
    name: str = Field(..., max_length=300)
    wip: bool


class AccountActivateRequest(BaseModel):
    id: str = Field(..., max_length=64)


class DisconnectRequest(BaseModel):
    id: str | None = Field(None, max_length=64)  # which account; None = the active one
