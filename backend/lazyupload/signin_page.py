"""The page the browser shows after SoundCloud sign-in, in the apps' Pressing look.

Served once by the little sign-in server in connect.py, so it can't load anything from
the app: fonts and the sloth ride along inside the page as data. Light or dark follows
the computer's setting, like the app.
"""
import base64
import html
from functools import lru_cache
from pathlib import Path

_WEB = Path(__file__).parent / "web"


@lru_cache(maxsize=None)
def _data_url(name: str, mime: str) -> str:
    try:
        return f"data:{mime};base64," + base64.b64encode((_WEB / name).read_bytes()).decode()
    except OSError:
        return ""  # page still reads fine with the fallback fonts and no sloth


def _fonts() -> str:
    faces = [("Schibsted Grotesk", 400, "schibsted-grotesk-latin-400-normal.woff2"),
             ("Schibsted Grotesk", 600, "schibsted-grotesk-latin-600-normal.woff2"),
             ("Bebas Neue", 400, "bebas-neue-latin-400-normal.woff2")]
    out = []
    for family, weight, file in faces:
        url = _data_url(file, "font/woff2")
        if url:
            out.append(f"@font-face{{font-family:'{family}';font-weight:{weight};"
                       f"font-display:swap;src:url({url}) format('woff2')}}")
    return "".join(out)


_STYLE = """
:root{--bg:#EDEAE4;--surface:#F6F4F0;--border:#D9D4CB;--text:#1A1E23;--dim:#4B5561;
--accent:#2A6590;--ok:#237043;--bad:#A3392F;color-scheme:light dark}
@media (prefers-color-scheme:dark){:root{--bg:#0B0E12;--surface:#10151B;--border:#2A333D;
--text:#E6ECF2;--dim:#A3B1BF;--accent:#86B3D3;--ok:#6CCB8F;--bad:#E66F6A}}
*{box-sizing:border-box}
html,body{height:100%;margin:0}
body{background:var(--bg);color:var(--text);display:grid;place-items:center;padding:24px;
font:16px/1.5 "Schibsted Grotesk",system-ui,-apple-system,"Segoe UI",sans-serif}
.card{width:100%;max-width:440px;background:var(--surface);border:1px solid var(--border);
border-radius:10px;padding:28px 28px 24px;display:flex;flex-direction:column;gap:14px}
.brand{display:flex;align-items:center;gap:10px;padding-bottom:14px;border-bottom:1px solid var(--border)}
.brand img{width:36px;height:auto}
.brand b{font:400 26px/1 "Bebas Neue","Arial Narrow",sans-serif;letter-spacing:.02em}
.brand span{display:block;color:var(--dim);font-size:12px}
.state{display:flex;align-items:center;gap:8px;font-size:13px;font-weight:600;
letter-spacing:.06em;text-transform:uppercase;color:var(--ok)}
.state::before{content:"";width:8px;height:8px;border-radius:50%;background:currentColor}
.bad .state{color:var(--bad)}
h1{margin:0;font-size:24px;line-height:1.2;font-weight:600}
p{margin:0;color:var(--dim)}
.who{color:var(--text);font-weight:600}
.next{padding-top:14px;border-top:1px solid var(--border);font-size:14px}
"""


def _page(title: str, body_class: str, state: str, heading: str, lines: list[str],
          next_line: str) -> str:
    sloth = _data_url("sloth.png", "image/png")
    mark = f'<img src="{sloth}" alt="">' if sloth else ""
    paras = "".join(f"<p>{line}</p>" for line in lines)
    return (
        "<!doctype html><html lang=en><head><meta charset=utf-8>"
        "<meta name=viewport content='width=device-width,initial-scale=1'>"
        f"<title>{title}</title><style>{_fonts()}{_STYLE}</style></head>"
        f"<body class='{body_class}'><main class=card>"
        f"<div class=brand>{mark}<div><b>Uploader</b><span>Lazy Creatives</span></div></div>"
        f"<div class=state>{state}</div><h1>{heading}</h1>{paras}"
        f"<p class=next>{next_line}</p>"
        "</main></body></html>"
    )


def connected_page(username: str = "") -> str:
    who = (f'Signed in as <span class=who>{html.escape(username)}</span>. '
           if username else "")
    return _page("SoundCloud connected", "ok", "Connected", "SoundCloud is connected",
                 [who + "You make the music. We'll handle the posting."],
                 "You can close this tab and head back to Uploader.")


def failed_page(reason: str = "") -> str:
    lines = ["Nothing was posted and nothing on your computer changed."]
    if reason:
        lines.insert(0, html.escape(reason))
    return _page("SoundCloud didn't connect", "bad", "Not connected",
                 "SoundCloud didn't connect", lines,
                 "Close this tab, then press Connect SoundCloud in Uploader to try again.")
