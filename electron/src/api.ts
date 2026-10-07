import type {
  Account, BulkResult, Config, Entitlement, JobStatus, Mix, Overview, Playlist, Sharing, Track, TrackComment, TrackUpdate,
  UploadItemInput, UploadRow,
} from "./types";
import type { CoverSource } from "./coverArt";

function base() {
  const port = (window as any).lazyupload?.port ?? "8754";
  return `http://127.0.0.1:${port}`;
}
function token() {
  return (window as any).lazyupload?.token ?? "";
}

async function req(method: string, path: string, body?: unknown) {
  const res = await fetch(base() + path, {
    method,
    headers: { "Content-Type": "application/json", "X-Auth-Token": token() },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) {
    let detail = `${res.status}`;
    try { detail = (await res.json()).detail ?? detail; } catch { /* ignore */ }
    throw new Error(detail);
  }
  return res.json();
}

export function makeApi() {
  return {
    async getSettings(): Promise<Config> { return req("GET", "/api/settings"); },
    async saveSettings(c: Config): Promise<Config> { return req("PUT", "/api/settings", c); },
    async account(): Promise<Account> { return req("GET", "/api/account"); },
    async connect(): Promise<{ connect_id: string; auth_url: string | null; status: string; mock: boolean }> {
      return req("POST", "/api/connect");
    },
    async connectStatus(id: string): Promise<{ status: "pending" | "connected" | "failed"; account: string | null; error: string | null }> {
      return req("GET", `/api/connect/${id}`);
    },
    async activateAccount(id: string): Promise<Account> { return req("POST", "/api/accounts/activate", { id }); },
    async disconnect(id?: string): Promise<Account> { return req("POST", "/api/disconnect", { id: id ?? null }); },
    async scan(sources?: string[]): Promise<Mix[]> {
      return (await req("POST", "/api/scan", { sources })).mixes;
    },
    // Give mixes a genre of their own; null goes back to the project's genre.
    async setMixGenre(paths: string[], genre: string | null): Promise<{ ok: boolean }> {
      return req("POST", "/api/mixes/genre", { paths, genre });
    },
    async setWip(name: string, wip: boolean): Promise<{ wip: { key: string; name: string; permalink_url: string | null }[] }> {
      return req("POST", "/api/wip", { name, wip });
    },
    async upload(items: UploadItemInput[], force = false, releaseAt?: string): Promise<{ job_id: string }> {
      return req("POST", "/api/upload", { items, force, release_at: releaseAt ?? null });
    },
    async jobStatus(id: string): Promise<JobStatus> { return req("GET", `/api/jobs/${id}`); },
    async cancelJob(id: string): Promise<{ cancelling: boolean }> { return req("POST", `/api/jobs/${id}/cancel`); },
    async overview(): Promise<Overview> { return req("GET", "/api/overview"); },
    async history(limit = 50): Promise<UploadRow[]> {
      return (await req("GET", `/api/history?limit=${limit}`)).uploads;
    },
    // The in-app player: <audio> can't send headers, so the token rides in the query
    // (the sidecar only serves mixes from watched folders or ones this app posted).
    // `decode` asks the sidecar to decode the file for the player even when it looked
    // playable as it is.
    audioUrl(path: string, decode = false): string {
      return `${base()}/api/audio?path=${encodeURIComponent(path)}&t=${encodeURIComponent(token())}${decode ? "&decode=1" : ""}`;
    },
    async peaks(path: string): Promise<{ peaks: number[] | null }> {
      return req("GET", `/api/peaks?path=${encodeURIComponent(path)}`);
    },
    // how loud a mix is (peak and average, dB below full scale); null for MP3 and the like
    async levels(path: string): Promise<{ levels: { peak_db: number; rms_db: number } | null }> {
      return req("GET", `/api/levels?path=${encodeURIComponent(path)}`);
    },
    // the comments on one of your tracks; t is where it sits in the song (seconds)
    async trackComments(id: number): Promise<{ comments: TrackComment[] }> {
      return req("GET", `/api/tracks/${id}/comments`);
    },
    async scPeaks(url: string): Promise<{ peaks: number[] | null }> {
      return req("GET", `/api/sc-peaks?url=${encodeURIComponent(url)}`);
    },
    async listTracks(): Promise<Track[]> { return (await req("GET", "/api/tracks")).tracks; },
    async updateTrack(id: number, fields: TrackUpdate): Promise<Track> {
      return req("PUT", `/api/tracks/${id}`, fields);
    },
    async deleteTrack(id: number): Promise<{ ok: boolean }> { return req("DELETE", `/api/tracks/${id}`); },
    async bulkUpdate(ids: number[], patch: TrackUpdate): Promise<BulkResult> {
      return req("POST", "/api/tracks/bulk", { ids, patch });
    },
    async bulkDelete(ids: number[]): Promise<BulkResult> {
      return req("POST", "/api/tracks/bulk-delete", { ids });
    },
    async setArtwork(id: number, artworkPath: string): Promise<Track> {
      return req("POST", `/api/tracks/${id}/artwork`, { artwork_path: artworkPath });
    },
    async bulkArtwork(ids: number[], artworkPath: string): Promise<BulkResult> {
      return req("POST", "/api/tracks/bulk-artwork", { ids, artwork_path: artworkPath });
    },
    async generateWaveformCover(id: number): Promise<Track> {
      return req("POST", `/api/tracks/${id}/waveform-cover`);
    },
    async bulkWaveformCover(ids: number[]): Promise<BulkResult> {
      return req("POST", "/api/tracks/bulk-waveform-cover", { ids });
    },
    // Playlists ("sets" on SoundCloud). track_ids is always the whole list, in order.
    async listPlaylists(): Promise<Playlist[]> { return (await req("GET", "/api/playlists")).playlists; },
    async createPlaylist(title: string, sharing: Sharing, trackIds: number[] = []): Promise<Playlist> {
      return req("POST", "/api/playlists", { title, sharing, track_ids: trackIds });
    },
    async updatePlaylist(id: number, p: { title?: string; sharing?: Sharing; track_ids?: number[] }): Promise<Playlist> {
      return req("PUT", `/api/playlists/${id}`, p);
    },
    async addToPlaylist(id: number, trackIds: number[]): Promise<Playlist> {
      return req("POST", `/api/playlists/${id}/add`, { track_ids: trackIds });
    },
    async deletePlaylist(id: number): Promise<{ ok: boolean }> { return req("DELETE", `/api/playlists/${id}`); },
    async entitlement(): Promise<Entitlement> { return req("GET", "/api/entitlement"); },
    async activateLicense(key: string): Promise<Entitlement> { return req("POST", "/api/entitlement/activate", { key }); },
    async deactivateLicense(): Promise<Entitlement> { return req("POST", "/api/entitlement/deactivate"); },
  };
}
export type Api = ReturnType<typeof makeApi>;

export function openExternal(url: string) {
  (window as any).lazyupload?.openExternal?.(url);
}
export function revealPath(p: string) {
  (window as any).lazyupload?.revealPath?.(p);
}
export async function pickFolder(): Promise<string | null> {
  return (window as any).lazyupload?.pickFolder?.() ?? null;
}
export async function pickImage(): Promise<string | null> {
  return (window as any).lazyupload?.pickImage?.() ?? null;
}
export async function readImage(path: string): Promise<string | null> {
  if (!path) return null;
  return (window as any).lazyupload?.readImage?.(path) ?? null;
}
export async function getOpenAtLogin(): Promise<boolean> {
  return (window as any).lazyupload?.getOpenAtLogin?.() ?? false;
}
export async function setOpenAtLogin(enabled: boolean): Promise<boolean> {
  return (window as any).lazyupload?.setOpenAtLogin?.(enabled) ?? false;
}

// Your cover pictures (Settings, Covers), for coverArt.ts. Pictures are fetched by
// <image>, which can't send headers, so the token rides in their address. Pictures
// saved in Backups come through here too, read-only.
export function makeCoverSource(): CoverSource {
  return {
    load: () => req("GET", "/api/covers"),
    settings: (p) => req("PUT", "/api/covers/settings", p),
    add: (p) => req("POST", "/api/covers/pictures", p),
    update: (id, p) => req("PATCH", `/api/covers/pictures/${encodeURIComponent(id)}`, p),
    remove: (id) => req("DELETE", `/api/covers/pictures/${encodeURIComponent(id)}`),
    choose: (name, choice) => req("PUT", "/api/covers/choice", { name, choice }),
    src: (url) => `${base()}${url}?t=${encodeURIComponent(token())}`,
    pickImage,
    readImage,
  };
}

// Keep a finished cover (a PNG data URL) where the upload can send it; returns its path.
export async function saveRenderedCover(name: string, data: string): Promise<string> {
  return (await req("POST", "/api/covers/render", { name, data })).path;
}
