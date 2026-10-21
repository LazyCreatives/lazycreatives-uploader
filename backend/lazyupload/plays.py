"""How many plays the account has gained lately, for Home ("+38 plays since Tuesday").

Each time the app reads the account's tracks it keeps that day's total plays (the
last total seen that day), for the last few weeks. The gain is the total now minus
the total on the oldest day kept within the last six days (not counting today), so
the day can be named plainly ("yesterday", "Tuesday") without two Tuesdays to choose
from. Nothing here talks to SoundCloud: it only remembers what was already read.
"""

from __future__ import annotations

from datetime import date, timedelta

PLAYS_KEY = "plays_history"
KEEP_DAYS = 30      # how long a day's total is kept
LOOK_BACK = 6       # the oldest day the gain is counted from


def record(catalog, account_id, total: int, today: date) -> dict | None:
    """Keep today's total for this account and say what has changed.

    Returns {"total", "gain", "since"} (since: "YYYY-MM-DD") when the plays went up
    since an earlier day in the last six, or None when there is nothing to say: no
    earlier day kept, no gain, or another account than last time."""
    saved = catalog.get_setting(PLAYS_KEY) or {}
    days: dict = {}
    if isinstance(saved, dict) and saved.get("account") == account_id and isinstance(saved.get("days"), dict):
        days = {k: v for k, v in saved["days"].items() if isinstance(v, (int, float))}
    days[today.isoformat()] = int(total)
    oldest_kept = (today - timedelta(days=KEEP_DAYS)).isoformat()
    days = {k: v for k, v in days.items() if k >= oldest_kept}
    catalog.set_setting(PLAYS_KEY, {"account": account_id, "days": days})
    return gain(days, int(total), today)


def gain(days: dict, total: int, today: date) -> dict | None:
    """The plays gained since the oldest day kept in the last six (today not counted)."""
    first = (today - timedelta(days=LOOK_BACK)).isoformat()
    now = today.isoformat()
    earlier = sorted(k for k in days if first <= k < now)
    if not earlier:
        return None
    since = earlier[0]
    up = total - int(days[since])
    if up <= 0:
        return None
    return {"total": total, "gain": up, "since": since}
