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
  templates: MetadataTemplate[];
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
  project_match?: string | null;
  // Format de-dupe: set on lower-quality copies of the same track (= the kept format,
  // e.g. "AIF"); the winning file lists the formats it beat in dupe_formats.
  superseded_by?: string | null;
  dupe_formats?: string[];
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
}

export interface Entitlement {
  tier: Tier;
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
  | { type: "track_start"; index: number; name: string; total: number }
  | { type: "track_progress"; index: number; name: string; sent: number; size: number }
  | { type: "track_done"; index: number; name: string; permalink_url: string | null }
  | { type: "track_skipped"; index: number; name: string; reason: string }
  | { type: "track_error"; index: number; name: string; error: string }
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
