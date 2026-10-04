"""Plain data shapes shared across the engine."""
from dataclasses import dataclass, field

# Audio formats SoundCloud accepts for upload (POST /tracks). We only surface these
# in the watch folder — project files, stems, and stray .asd peaks are ignored.
AUDIO_EXTS = {".wav", ".aiff", ".aif", ".flac", ".mp3", ".aac", ".m4a", ".ogg", ".wma"}


@dataclass
class Mix:
    """A candidate audio file discovered in a watched folder."""
    path: str
    name: str               # filename without extension — the default track title
    ext: str
    size: int
    mtime: float
    duration: float | None = None   # seconds, when cheaply known (WAV header)
    file_hash: str | None = None     # filled lazily; the dedupe key
    uploaded: bool = False           # already published (matched by hash in the catalog)
    permalink_url: str | None = None # if uploaded, where it lives on SoundCloud


@dataclass
class TrackMeta:
    """Per-mix metadata sent to SoundCloud. Title is required; the rest are optional."""
    title: str
    description: str = ""
    sharing: str = "public"          # "public" | "private"
    genre: str = ""
    tags: list[str] = field(default_factory=list)
    downloadable: bool = False


@dataclass
class UploadResult:
    name: str
    status: str                      # "uploaded" | "skipped" | "error"
    file_hash: str | None = None
    sc_track_id: int | None = None
    permalink_url: str | None = None
    error: str | None = None
