# LazyCreatives token broker

A ~80-line service that keeps your **SoundCloud client secret off users' machines**.

SoundCloud requires the client secret to exchange an authorization code for tokens
and to refresh them — even with PKCE. A desktop app can't hide an embedded secret, so
this broker holds it instead. The desktop sends the `code` (+ PKCE verifier); the
broker exchanges it with SoundCloud and returns only the user's tokens.

```
desktop  --(code + verifier, X-App-Key)-->  broker  --(+secret)-->  SoundCloud
desktop  <-----------(access + refresh tokens)----------  broker
```

## Endpoints

| Method | Path | Body | Returns |
|---|---|---|---|
| GET | `/health` | — | `{status, configured}` |
| POST | `/exchange` | `{code, code_verifier, redirect_uri}` | token set |
| POST | `/refresh` | `{refresh_token}` | token set |

Both POSTs require the header `X-App-Key: <BROKER_APP_KEY>`.

## Configure & run

```bash
export SC_CLIENT_ID=...        # your SoundCloud app (server-side only)
export SC_CLIENT_SECRET=...    # NEVER ships in the desktop app
export BROKER_APP_KEY=...      # any long random string

pip install -r requirements.txt
uvicorn app:app --host 0.0.0.0 --port 8080
# or:  docker build -t lazyupload-broker . && docker run -p 8080:8080 --env-file .env lazyupload-broker
```

## Host it for free (Render)

`render.yaml` at the repo root is a Render blueprint: in Render choose
**New > Blueprint**, pick this repository, paste the SoundCloud client id and secret
when asked, and Render builds `broker/Dockerfile` on its free plan and makes up
`BROKER_APP_KEY`. The free plan sleeps when idle, so the first sign-in after a quiet
spell can take most of a minute; the app waits up to 90 seconds for it.

## Point the desktop app at it

In the desktop build, set (env or `backend/lazyupload/_buildsecret.py`):

```
LAZYUP_SC_CLIENT_ID = <client id>     # public, fine to embed
LAZYUP_BROKER_URL   = https://your-broker.example.com
LAZYUP_BROKER_KEY   = <same BROKER_APP_KEY>
```

With `LAZYUP_BROKER_URL` set, the app uses the broker for token exchange/refresh and
**no client secret is shipped**. Without it, set `LAZYUP_SC_CLIENT_SECRET` to talk to
SoundCloud directly (fine for local dev, not for distribution).

## Notes / future

- `BROKER_APP_KEY` isn't a true secret (it ships in the desktop); it just stops the
  public URL being trivially abused. Combined with the need for a valid SoundCloud
  code/refresh-token, the endpoint is uninteresting to attackers.
- For production, add per-IP rate limiting and request logging at the broker.
- This is the natural home for the planned LazyCreatives dashboard's auth layer.
