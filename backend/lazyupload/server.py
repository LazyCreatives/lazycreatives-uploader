"""Uvicorn entrypoint for the uploader sidecar (configured via environment)."""
import os
import sys
import threading
import time
from pathlib import Path

from lazyupload.api.app import create_app

_DEFAULT_PORT = 8754  # Backups uses 8753; keep them distinct if both ever run
_GRACEFUL_SHUTDOWN_SECS = 3


def _default_db_path() -> str:
    base = os.environ.get("LOCALAPPDATA") or str(Path.home() / ".lazyupload")
    return str(Path(base) / "lazyupload" / "catalog.db")


def read_config() -> dict:
    parent = os.environ.get("LAZYUP_PARENT_PID")
    return {
        "token": os.environ.get("LAZYUP_TOKEN", ""),
        "port": int(os.environ.get("LAZYUP_PORT", _DEFAULT_PORT)),
        "db_path": os.environ.get("LAZYUP_DB", _default_db_path()),
        "parent_pid": int(parent) if parent else None,
    }


if sys.platform == "win32":
    import ctypes
    from ctypes import wintypes

    _kernel32 = ctypes.windll.kernel32
    _PROCESS_QUERY_LIMITED_INFORMATION = 0x1000
    _STILL_ACTIVE = 259

    def _parent_alive(pid: int) -> bool:
        """Whether process `pid` is still running, on Windows.

        os.kill(pid, 0) is NOT a safe liveness probe here — signal 0 maps to
        CTRL_C_EVENT semantics, not a no-op probe. Use OpenProcess + the exit code
        instead so a hard-killed Electron reliably takes the sidecar down with it.
        """
        h = _kernel32.OpenProcess(_PROCESS_QUERY_LIMITED_INFORMATION, False, pid)
        if not h:
            return False  # can't open our own parent -> it's gone
        try:
            code = wintypes.DWORD()
            if not _kernel32.GetExitCodeProcess(h, ctypes.byref(code)):
                return True  # query failed; err toward "alive" so we don't exit early
            return code.value == _STILL_ACTIVE
        finally:
            _kernel32.CloseHandle(h)
else:
    def _parent_alive(pid: int) -> bool:
        try:
            os.kill(pid, 0)  # signal 0 *is* a valid liveness probe on POSIX
        except ProcessLookupError:
            return False
        except PermissionError:
            return True
        return True


def install_parent_watchdog(parent_pid, *, poll_interval=2.0, on_dead=None,
                            alive=_parent_alive) -> threading.Thread:
    """Exit this process when the parent (Electron) goes away, so a crash can't leave
    an orphaned sidecar running. Injectable for tests."""
    if on_dead is None:
        on_dead = lambda: os._exit(0)

    def loop():
        while True:
            if not alive(parent_pid):
                on_dead()
                return
            time.sleep(poll_interval)

    t = threading.Thread(target=loop, name="parent-watchdog", daemon=True)
    t.start()
    return t


def build_app_from_env():
    cfg = read_config()
    return create_app(token=cfg["token"], db_path=Path(cfg["db_path"]))


def main() -> None:  # pragma: no cover - exercised manually / by Electron
    import uvicorn
    cfg = read_config()
    if cfg["parent_pid"]:
        install_parent_watchdog(cfg["parent_pid"])
    app = create_app(token=cfg["token"], db_path=Path(cfg["db_path"]))
    uvicorn.run(app, host="127.0.0.1", port=cfg["port"],
                timeout_graceful_shutdown=_GRACEFUL_SHUTDOWN_SECS)


if __name__ == "__main__":  # pragma: no cover
    import multiprocessing
    multiprocessing.freeze_support()
    main()
