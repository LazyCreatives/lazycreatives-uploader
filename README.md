<p align="center">
  <img src="https://raw.githubusercontent.com/LazyCreatives/.github/main/profile/logo.png" alt="Lazy Creatives — Uploader" width="380">
</p>

<h1 align="center">Lazy Creatives — Uploader</h1>

<p align="center"><b>Automatically publish your finished mixes to SoundCloud — and manage your whole library.</b></p>

<p align="center">
  <a href="https://lazycreatives.github.io">Website</a> ·
  <a href="https://github.com/LazyCreatives/lazycreatives-backups">Sibling tool: Backups</a>
</p>

Point it at the folder you bounce mixes into. It finds every new render, lets you
publish with one click — or watches the folder and uploads automatically — and never
double-posts the same mix (de-duplicated by audio content hash, not filename). It also
**manages your existing SoundCloud tracks**: edit titles/tags/genre, flip public↔private,
or delete — without leaving the app.

Part of [**Lazy Creatives**](https://lazycreatives.github.io) — tools that take the boring,
behind-the-scenes work of making music off your plate. *Looks lazy. Works obsessively.*
A sibling to [Backups](https://github.com/LazyCreatives/lazycreatives-backups): same
Electron + Python/FastAPI sidecar, same brand, same licensing — built so both tools can
sit behind one dashboard / subscription later.

> Runs fully **offline in demo mode** with no SoundCloud account, so you can try the
> entire flow before you have API credentials.

---

## How it works

```
Setup (once)   →   Scan   →   Pick   →   Publish   →   Manage
folders + connect   find new   choose &   POST to       edit / privacy /
SoundCloud          renders    metadata   SoundCloud     delete existing
```

- **Never double-posts.** Each mix is hashed; if that exact audio is already on
  SoundCloud it's skipped. Re-render with a change and it's treated as new.
- **One-click or hands-off.** Publish selected mixes manually, or (Pro) let it watch
  a folder and upload new renders on a schedule.
- **Manages your whole library.** Lists every track on your account; edit title,
  description, tags and genre, toggle public/private, or delete — all in-app.
- **Your account stays yours.** OAuth tokens are stored locally and refreshed
  automatically; no third-party server sees your audio.

## Architecture

An **Electron** shell + React/TypeScript renderer over a **Python/FastAPI** sidecar
that does the scanning, hashing, OAuth and uploading.

```
electron/   desktop shell + flow-first UI (Setup → Home → Upload → Manage → History → Settings)
backend/    lazyupload/ — the engine
  soundcloud   OAuth2 (Authorization Code + PKCE) + multipart upload; mock client
  connect      loopback browser sign-in session
  scanner      discover audio in the watched folders
  service      scan-with-dedupe, the upload engine, the connected account, overview
  catalog      SQLite history + dedupe index + settings
  scheduler    APScheduler watch-folder auto-upload (Pro)
  entitlement  Free/Pro tiers (HMAC-signed local cache; Lemon Squeezy activation)
```

## SoundCloud setup (for real uploads)

The app ships ready to run in **demo mode**. To publish for real you (the developer)
register **one** SoundCloud API app and bake its credentials into the build:

1. Subscribe to **SoundCloud Artist Pro** — required to register API apps.
2. Create an app at <https://soundcloud.com/you/apps/new>.
3. Add this **redirect URI** exactly: `http://127.0.0.1:8765/callback`
4. Provide the credentials to the backend via environment (or a git-ignored
   `backend/lazyupload/_buildsecret.py`):

   ```
   LAZYUP_SC_CLIENT_ID=<your client id>
   LAZYUP_SC_CLIENT_SECRET=<your client secret>
   ```

With those set, the mock is bypassed and end-users sign in with their own SoundCloud
accounts (no Pro subscription needed to *authorize* an upload). Set `LAZYUP_MOCK=1` to
force demo mode even when credentials exist.

**For distribution, don't ship the secret — use the token broker.** SoundCloud needs
the client secret to mint tokens even with PKCE, so embedding it exposes it. Deploy the
included [`broker/`](broker/) service (it holds the secret) and configure the app with:

```
LAZYUP_SC_CLIENT_ID=<client id>      # public, fine to embed
LAZYUP_BROKER_URL=https://your-broker.example.com
LAZYUP_BROKER_KEY=<shared app key>
```

The app then exchanges/refreshes tokens through the broker and **no secret ships**.

> **Reality check:** SoundCloud gates API access fairly tightly. Getting the API app
> approved is the one external dependency for going live — the code is ready either way.

## Develop / run

Prereqs: Node 18+, Python 3.11+.

```bash
# backend
cd backend
python -m venv .venv
.venv/Scripts/pip install -e ".[dev]"   # Windows  (.venv/bin/pip on macOS/Linux)

# app (spawns the sidecar automatically; runs in demo mode)
cd ../electron
npm install
npm start
```

> **Behind a TLS-inspecting proxy / antivirus?** If `npm install` fails with
> `UNABLE_TO_VERIFY_LEAF_SIGNATURE`, Node isn't trusting your network's root CA.
> Run npm with the Windows certificate store:
> `NODE_OPTIONS=--use-system-ca npm install` (Node 22+).

Headless CLI (handy for a dry run against the mock):

```bash
cd backend
.venv/Scripts/python -m lazyupload.cli scan   --source "D:/Mixes" --db catalog.db
.venv/Scripts/python -m lazyupload.cli upload --source "D:/Mixes" --db catalog.db --sharing private
```

## Tests

```bash
cd backend  && .venv/Scripts/python -m pytest   # backend engine + API (31 tests)
cd electron && npm test                         # renderer
```

## Plans

| Feature | Free | Pro |
|---|---|---|
| Manual upload (one at a time) | ✅ | ✅ |
| Public / private release | ✅ | ✅ |
| Manage existing tracks (edit / privacy / delete) | ✅ | ✅ |
| Dedupe (never double-post) | ✅ | ✅ |
| Batch upload a whole folder | — | ✅ |
| Watch-folder auto-upload | — | ✅ |
| Scheduled public release (upload private, flip public later) | — | ✅ |
| Multiple SoundCloud accounts | — | ✅ |
| Saved metadata templates | — | ✅ |

Licensing (`entitlement.py`) is a deliberate near-clone of the Backups tool's, so a
future "buy tools separately / all-access subscription" dashboard can point both at
one shared licensing service with minimal change.

## Security notes

- SoundCloud OAuth tokens are **encrypted at rest**: Windows DPAPI (bound to your
  user account); on macOS and Linux AES-GCM with the key in the macOS Keychain or
  the Linux Secret Service keyring, or an owner-only key file when no keyring is
  running. Logins saved by older builds are re-encrypted on first read. The sidecar
  is localhost-only behind a per-launch auth token.
- The renderer is hardened (context isolation, no node integration, navigation +
  popups blocked, CSP when packaged).
- **Client secret stays server-side.** SoundCloud requires the client secret for
  token exchange/refresh even with PKCE. The included [`broker/`](broker/) service
  holds it so it never ships in the desktop build; set `LAZYUP_BROKER_URL` to use it.
  (Embedding `LAZYUP_SC_CLIENT_SECRET` directly is supported for local dev only.)

## Status

Active development. App icons are generated from the brand mark by
`brand/make_icons.py`. Installers for Windows (.exe), Mac (Apple Silicon .dmg) and
Linux (.AppImage) are built by `.github/workflows/installers.yml` (same as Backups),
unsigned for now. Locally, `cd electron && npm run dist` works on any of the three
systems (`npm run build:py` uses `backend/.venv` if present, else `pyinstaller` on
PATH). `npm start` runs it in dev. Behind the harness/IDE, launch needs `ELECTRON_RUN_AS_NODE` unset (handled by the
`npm start` script).
