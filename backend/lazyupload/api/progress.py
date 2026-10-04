"""Async pub/sub for streaming scan/upload progress to WebSocket subscribers.

Same design as Backups' ProgressHub: replay recent events to a socket that connects
mid-run, but never resurrect a finished run's "complete" for a late subscriber.
"""
import asyncio
from typing import Optional

_START = ("scan_start", "upload_start")
_DONE = ("scan_done", "upload_done")


class ProgressHub:
    def __init__(self, history_limit: int = 500):
        self._subscribers: list[asyncio.Queue] = []
        self._history: list[dict] = []
        self._history_limit = history_limit
        self._active = False
        self._loop: Optional[asyncio.AbstractEventLoop] = None

    def bind_loop(self, loop: asyncio.AbstractEventLoop) -> None:
        self._loop = loop

    def subscribe(self) -> asyncio.Queue:
        q: asyncio.Queue = asyncio.Queue()
        if self._active:
            for event in self._history:
                q.put_nowait(event)
        self._subscribers.append(q)
        return q

    def unsubscribe(self, q: asyncio.Queue) -> None:
        if q in self._subscribers:
            self._subscribers.remove(q)

    async def publish(self, event: dict) -> None:
        t = event.get("type")
        if t in _START:
            self._history = []
            self._active = True
        self._record(event)
        for q in list(self._subscribers):
            q.put_nowait(event)
        if t in _DONE:
            self._active = False

    def publish_threadsafe(self, event: dict) -> None:
        if self._loop is None:
            raise RuntimeError("ProgressHub.bind_loop must be called first")
        asyncio.run_coroutine_threadsafe(self.publish(event), self._loop)

    def _record(self, event: dict) -> None:
        # High-volume per-byte/per-item ticks are pointless to replay.
        if event.get("type") in ("scan_progress", "track_progress"):
            return
        self._history.append(event)
        if len(self._history) > self._history_limit:
            self._history = self._history[-self._history_limit:]
