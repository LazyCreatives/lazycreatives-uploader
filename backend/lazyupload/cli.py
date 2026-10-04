"""Headless CLI — handy for testing the engine without the desktop shell.

  python -m lazyupload.cli scan --source "D:/Mixes"
  python -m lazyupload.cli upload --source "D:/Mixes" --db catalog.db --sharing private

With no SoundCloud credentials configured it runs against the mock client, so
`upload` works end-to-end (recording demo permalinks) for a dry run.
"""
import argparse
from pathlib import Path

from lazyupload import service
from lazyupload.catalog import Catalog


def _cmd_scan(args) -> int:
    cat = Catalog(Path(args.db))
    try:
        mixes = service.scan_mixes(cat, [Path(s) for s in args.source])
    finally:
        cat.close()
    for m in mixes:
        flag = "[uploaded]" if m["uploaded"] else "[new]     "
        print(f"{flag}  {m['name']}{m['ext']}  ({m['size']} bytes)")
    print(f"{len(mixes)} mix(es) found")
    return 0


def _cmd_upload(args) -> int:
    cat = Catalog(Path(args.db))
    try:
        if not service.connected(cat):
            # Mock connect so a dry run works with no account configured.
            from lazyupload.connect import SoundCloudConnectSession
            SoundCloudConnectSession(lambda t: service.save_account(cat, t)).start()
        mixes = service.scan_mixes(cat, [Path(s) for s in args.source])
        items = [m for m in mixes if not m["uploaded"]]
        defaults = {"sharing": args.sharing, "genre": args.genre or "",
                    "title_template": "{name}"}

        def progress(ev):
            if ev["type"] == "track_done":
                print(f"uploaded {ev['name']} -> {ev['permalink_url']}")
            elif ev["type"] == "track_skipped":
                print(f"skipped {ev['name']} ({ev['reason']})")
            elif ev["type"] == "track_error":
                print(f"ERROR {ev['name']}: {ev['error']}")

        summary = service.run_upload(cat, items, defaults, progress=progress)
    finally:
        cat.close()
    print(f"done: {summary['ok_count']} uploaded, {summary['skipped_count']} skipped, "
          f"{summary['error_count']} error(s)")
    return 1 if summary["error_count"] else 0


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="lazyupload")
    sub = parser.add_subparsers(dest="command", required=True)

    scan_p = sub.add_parser("scan", help="list discovered mixes (and which are uploaded)")
    scan_p.add_argument("--source", action="append", required=True)
    scan_p.add_argument("--db", default="catalog.db")
    scan_p.set_defaults(func=_cmd_scan)

    up_p = sub.add_parser("upload", help="upload not-yet-published mixes to SoundCloud")
    up_p.add_argument("--source", action="append", required=True)
    up_p.add_argument("--db", default="catalog.db")
    up_p.add_argument("--sharing", default="public", choices=["public", "private"])
    up_p.add_argument("--genre", default="")
    up_p.set_defaults(func=_cmd_upload)
    return parser


def run(argv: list[str]) -> int:
    args = build_parser().parse_args(argv)
    return args.func(args)


if __name__ == "__main__":
    import sys
    raise SystemExit(run(sys.argv[1:]))
