export type Tier = "free" | "pro" | "studio";
export type Sharing = "public" | "private";

export interface Config {
  sources: string[];
  interval_minutes: number;
  default_sharing: Sharing;
  default_genre: string;
  default_tags: string[];
  title_template: string;
  default_description: string;
  downloadable: boolean;
  auto_upload_sharing: Sharing;
  changelog_comments: boolean;
  default_artwork_path: string;
  cover_watermark: boolean;
  cover_waveform_color: string;
  templates: MetadataTemplate[];
  min_length_seconds?: number;  // shorter exports are hidden on Upload; 0 = off
}

export interface Mix {
  path: string;
  name: string;
  ext: string;
  size: number;
  mtime: number;
  duration: number | null;
  file_hash: string | null;
  uploaded: boolean;
  permalink_url: string | null;
  // Borrowed from the sibling Backups catalog when the mix name matches a project.
  bpm?: number | null;
  genre?: string | null;
  genre_emoji?: string | null;
  genre_by_you?: boolean;           // the producer set this genre (in Backups or for this mix)
  genre_mix?: boolean;              // set for this mix only, in Uploader
  genre_project?: string | null;    // the Backups project's genre
  project_match?: string | null;
  project_id?: string | null;
  project_link?: "exact" | "name";  // exact = Backups linked this very file to the project
  // Format de-dupe: set on lower-quality copies of the same track (= the kept format,
  // e.g. "AIF"); the winning file lists the formats it beat in dupe_formats.
  superseded_by?: string | null;
  dupe_formats?: string[];
  short?: boolean; // shorter than the Settings minimum: hidden on Upload, never auto-posted
  wip?: boolean;   // user is iterating on this track — keep private + watch for re-bounces
}

export interface AccountSummary {
  id: string;
  username: string;
  avatar_url?: string | null;
  mock: boolean;
  active: boolean;
}

export interface Account {
  connected: boolean;
  account: string | null;
  avatar: string | null;     // active account's SoundCloud profile picture
  accounts: AccountSummary[];
  multi: boolean;
  mock: boolean;
  // Where the SoundCloud login is locked away on this computer.
  login_storage?: "windows" | "keychain" | "file" | "plain";
}

export interface MetadataTemplate {
  name: string;
  title_template: string;
  description: string;
  genre: string;
  tags: string[];
  sharing: Sharing;
  downloadable: boolean;
}

export interface Overview {
  connected: boolean;
  account: string | null;
  mock: boolean;
  uploaded_count: number;
  error_count: number;
  uploaded_bytes: number;
  last_upload: string | null;
  last_upload_ok: boolean;
  scheduled_count: number;
  tier: Tier;
  beta?: boolean;
  schedule: { enabled: boolean; interval_minutes: number; next_run?: string | null };
}

export interface UploadRow {
  id: number;
  title: string;
  file_path: string;
  file_hash: string | null;
  size: number;
  sharing: string;
  status: string;
  sc_track_id: number | null;
  permalink_url: string | null;
  account: string | null;
  error: string | null;
  timestamp: string;
  project_match?: string | null;   // the Backups project the file came from, if known
  project_genre?: string | null;
}

export interface Entitlement {
  tier: Tier;
  beta?: boolean;   // free beta: everything unlocked, plan box hidden
  features: {
    auto_upload: boolean;
    batch: boolean;
    schedule_release: boolean;
    multi_account: boolean;
    metadata_templates: boolean;
  };
}

export interface JobStatus {
  state: "running" | "cancelling" | "done" | "error";
  result?: { ok_count?: number; error_count?: number; skipped_count?: number; cancelled?: boolean };
  error?: string;
}

export type ProgressEvent =
  | { type: "scan_start"; total: number }
  | { type: "scan_progress"; done: number; total: number; name: string }
  | { type: "scan_done"; count: number }
  | { type: "upload_start"; total: number; timestamp: string }
  // `path` names the mix each track event is about (older sidecars leave it out).
  | { type: "track_start"; index: number; name: string; path?: string; total: number }
  | { type: "track_progress"; index: number; name: string; path?: string; sent: number; size: number }
  | { type: "track_done"; index: number; name: string; path?: string; permalink_url: string | null }
  | { type: "track_skipped"; index: number; name: string; path?: string; reason: string }
  // `error` is the full message (kept in History); `reason` is a few plain words for the row.
  | { type: "track_error"; index: number; name: string; path?: string; error: string; reason?: string }
  | { type: "upload_done"; ok_count: number; error_count: number; skipped_count: number; cancelled?: boolean };

export interface Track {
  id: number;
  title: string;
  description: string;
  sharing: string;
  genre: string;
  tags: string[];
  permalink_url: string | null;
  artwork_url: string | null;
  duration: number | null;
  playback_count: number | null;
  created_at: string | null;   // ISO string (or null)
  downloadable?: boolean | null;
  // Backups-join fields — absent/null when a track has no confident project match.
  bpm?: number | null;
  genre_emoji?: string | null;       // e.g. "🔥"
  daw?: string | null;               // "ableton" | "flstudio" | ...
  project_match?: string | null;     // matched Backups project name
  project_genre?: string | null;     // that project's genre in Backups (same cover art in both apps)
  plugin_count?: number | null;
  track_count?: number | null;       // DAW project clip/track count
  missing_count?: number | null;     // missing-sample refs (>0 => warning chip)
  project_size?: number | null;      // bytes
  project_mtime?: number | null;     // unix epoch seconds
  backups?: {
    count: number;
    first_backup: string | null;     // ISO
    last_backup: string | null;      // ISO
    archived_bytes: number | null;
    file_count: number | null;
    verified: boolean;
    verified_at: string | null;      // ISO
    status: string | null;           // "ok" | "partial"
  } | null;
  // SEO / discoverability score of the LIVE SoundCloud metadata.
  seo?: SeoScore | null;
  // Manage-side format de-dupe (same title uploaded as e.g. FLAC + MP3).
  original_format?: string | null;
  dupe_group?: number | null;   // the keeper track's id, shared across the group
  dupe_count?: number;          // group size (>1 ⇒ this track has duplicates)
  dupe_keeper?: boolean;        // true on the highest-quality copy
  waveform_url?: string | null; // source for generated waveform cover art
  local_path?: string | null;   // the file this app posted, when it's still on this computer
}

export interface SeoCheck {
  id: string;
  label: string;
  points: number;
  max: number;
  hint: string | null;
}

export interface SeoScore {
  score: number;             // 0–100
  grade: string;             // "A".."F"
  checks: SeoCheck[];
  suggestions: string[];     // ordered, highest-impact first
  suggested_tags: string[];  // genre-appropriate SoundCloud tags to add
}

export interface TrackUpdate {
  title?: string;
  description?: string;
  sharing?: Sharing;
  genre?: string;
  tags?: string[];
  downloadable?: boolean;
}

export interface BulkResult {
  // `track` is the freshly-enriched row for ok items (so the UI can splice it without a refetch)
  results: { id: number; ok: boolean; error: string | null; track?: Track }[];
}

export interface UploadItemInput {
  path: string;
  name?: string;
  title?: string;
  description?: string;
  sharing?: Sharing;
  genre?: string;
  tags?: string[];
  file_hash?: string | null;
  size?: number;
  artwork_path?: string;
}

// A listener's comment on one of your SoundCloud tracks.
export interface TrackComment {
  t: number | null;          // seconds into the track; null when not pinned to a moment
  body: string;
  user: string;
  avatar_url?: string | null;
  created_at?: string | null;
}

// A SoundCloud playlist ("set"). Its tracks are in playlist order; a set can hold other
// people's tracks too (`user` is who posted each one).
export interface PlaylistTrack extends Pick<Track, "id" | "title" | "sharing" | "genre" | "permalink_url" | "artwork_url" | "duration"> {
  user?: string;
  waveform_url?: string | null;
}
// What can change on a playlist. Anything left out stays as it is.
export interface PlaylistChange {
  title?: string; description?: string; genre?: string; tags?: string[];
  sharing?: Sharing; track_ids?: number[];
}

export interface Playlist {
  id: number;
  title: string;
  description: string;
  genre?: string;
  tags?: string[];
  sharing: Sharing;
  permalink_url: string | null;
  artwork_url: string | null;
  duration: number | null;       // seconds, all tracks together
  track_count: number;
  created_at: string | null;
  last_modified: string | null;
  tracks: PlaylistTrack[];
  added?: number;                // after "Add to playlist": how many were new
}
