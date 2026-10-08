# PyInstaller build of the LazyCreatives Uploader FastAPI sidecar (onedir), so end
# users need no system Python. Same layout as the Backups sidecar.
#
#   cd backend
#   pip install pyinstaller
#   pyinstaller sidecar.spec --noconfirm --distpath dist
#   (or from electron/: npm run build:py, which works on Windows, macOS and Linux)
#
# -> backend/dist/lazyupload-sidecar/lazyupload-sidecar(.exe)  (electron-builder copies
#    this folder into the app's resources/sidecar; main.js runs it when packaged).
import sys

from PyInstaller.utils.hooks import collect_all, collect_submodules, copy_metadata

datas, binaries, hiddenimports = [], [], []
for pkg in ("uvicorn", "fastapi", "starlette", "apscheduler", "websockets", "pydantic",
            "soundfile", "_soundfile_data", "imageio_ffmpeg"):
    try:
        d, b, h = collect_all(pkg)
    except Exception:
        continue  # e.g. _soundfile_data isn't a separate package on every platform
    datas += d
    binaries += b
    hiddenimports += h

# Cover-art lettering font (Inter Bold) + its licence, next to coverart.py.
datas += [("lazyupload/fonts", "lazyupload/fonts")]
# Fonts and sloth for the page the browser shows after SoundCloud sign-in.
datas += [("lazyupload/web", "lazyupload/web")]

if sys.platform.startswith("linux"):
    # keyring finds its Secret Service backends through package metadata. Linux only:
    # the Mac build never touches the Keychain (see lazyupload/crypto.py).
    hiddenimports += collect_submodules("keyring.backends")
    datas += copy_metadata("keyring")

# Bundle our own package as BYTECODE only (collect_submodules), NOT via collect_all
# — collect_all would also ship every .py as readable source, exposing the
# licensing logic. The bytecode goes into the PYZ; no plaintext source.
hiddenimports += collect_submodules("lazyupload")

a = Analysis(
    ["lazyupload/server.py"],
    pathex=["."],
    binaries=binaries,
    datas=datas,
    hiddenimports=hiddenimports,
    noarchive=False,
)
pyz = PYZ(a.pure)
exe = EXE(
    pyz, a.scripts, [],
    exclude_binaries=True,
    name="lazyupload-sidecar",
    console=True,          # the sidecar logs to stdout/stderr (captured by main.js)
)
coll = COLLECT(exe, a.binaries, a.datas, name="lazyupload-sidecar")
