import type {
  Account, Config, Entitlement, JobStatus, Mix, Overview, Track, TrackUpdate,
  UploadItemInput, UploadRow,
} from "./types";

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
    async listTracks(): Promise<Track[]> { return (await req("GET", "/api/tracks")).tracks; },
    async updateTrack(id: number, fields: TrackUpdate): Promise<Track> {
      return req("PUT", `/api/tracks/${id}`, fields);
    },
    async deleteTrack(id: number): Promise<{ ok: boolean }> { return req("DELETE", `/api/tracks/${id}`); },
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
export async function getOpenAtLogin(): Promise<boolean> {
  return (window as any).lazyupload?.getOpenAtLogin?.() ?? false;
}
export async function setOpenAtLogin(enabled: boolean): Promise<boolean> {
  return (window as any).lazyupload?.setOpenAtLogin?.(enabled) ?? false;
}
