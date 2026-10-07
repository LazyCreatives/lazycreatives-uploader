<p align="center">
  <img src="https://raw.githubusercontent.com/LazyCreatives/.github/main/profile/logo.png" alt="Lazy Creatives — Uploader" width="380">
</p>

<h1 align="center">Lazy Creatives — Uploader</h1>

<p align="center"><b>Stop uploading mixes one by one and checking for doubles.</b><br>Export a mix, post it in one click, and it never goes up twice.</p>

<p align="center">
  <a href="https://lazycreatives.github.io/#download"><b>Download</b></a> ·
  <a href="https://github.com/LazyCreatives/lazycreatives-uploader/releases">What's new</a> ·
  <a href="https://github.com/LazyCreatives/lazycreatives-backups">Sibling tool: Backups</a>
</p>

Point it at the folder you bounce mixes into. It finds every new render and posts it
with one click, or watches the folder and posts new ones for you. It never double-posts
the same mix, even when it's saved again in another format. It also **manages the
tracks already on your SoundCloud**: edit titles, tags and genre, switch public or
private, or delete, without leaving the app.

Part of [**Lazy Creatives**](https://lazycreatives.github.io), tools that take the boring,
behind-the-scenes work of making music off your plate. *Looks lazy. Works obsessively.*

---

## What you stop doing by hand

| The job | By hand | With Uploader |
|---|---|---|
| Posting a mix | Upload, type the title, pick a genre, find a cover, one song at a time | One click; a cover is made from the sound, and with Backups the tempo and genre come from the project |
| Double posts | Check by eye, and still post the WAV and the MP3 | The same song never goes up twice, even in another format |
| What's already up | Scroll your profile and try to remember | Every mix shows whether it's on SoundCloud |
| Tidying your SoundCloud | Open each track's edit page in the browser | Edit, hide, delete and sort into playlists from one list |

## What it does

- **Never double-posts.** Each mix is fingerprinted by its sound, not its file name. If
  that audio is already on SoundCloud it's skipped; re-render with a change and it's new.
- **One click or hands-off.** Post the mixes you pick, or let it watch your folders and
  post new renders automatically.
- **Manages your whole SoundCloud.** Every track on your account in one list, with search,
  filters and sorting. Edit details, switch public or private, or delete.
- **Knows where each song came from.** With [Backups](https://github.com/LazyCreatives/lazycreatives-backups)
  installed, each mix shows the project it was exported from, with its tempo and genre.
- **Cover art made for you**, and two looks to choose from: **Crate** (DJ-library rows)
  or **Sleeve** (cover cards), the same as Backups.
- **Your account stays yours.** Your SoundCloud login is stored on your computer, locked
  in its own secure storage. Your audio goes straight from your computer to SoundCloud.

## Download

Free beta, with every feature unlocked. Installers for **Windows**, **Mac (Apple
Silicon)** and **Linux** are on the [Releases page](https://github.com/LazyCreatives/lazycreatives-uploader/releases/latest)
and at [lazycreatives.github.io](https://lazycreatives.github.io/#download). They aren't
signed yet, so the first launch shows an "unknown developer" warning; the website shows
how to check the file and open it on each system. You need a SoundCloud account to post.

---

## For developers

### How it's built

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
  scheduler    APScheduler watch-folder auto-upload
```

### Run it from source

Prereqs: Node 20.19+ (or 22.12+), Python 3.11+.

```bash
# backend
cd backend
python -m venv .venv
.venv/bin/pip install -e ".[dev]"      # Windows: .venv\Scripts\pip

# app (starts the engine itself; runs in demo mode with no SoundCloud account)
cd ../electron
npm install
npm start
```

Set `LAZYUP_MOCK=1` to force demo mode. A headless dry run against the demo account:

```bash
cd backend
.venv/bin/python -m lazyupload.cli scan   --source ~/Mixes --db catalog.db
.venv/bin/python -m lazyupload.cli upload --source ~/Mixes --db catalog.db --sharing private
```

### Tests

```bash
cd backend  && .venv/bin/python -m pytest   # engine + API
cd electron && npm test                     # app screens
```

### SoundCloud app credentials

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
accounts (they need no paid SoundCloud plan to sign in). Set `LAZYUP_MOCK=1` to
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

### Security

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
