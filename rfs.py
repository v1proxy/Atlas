# rfs.py: files for Atlas on a server. Paths stay the Windows paths the PC uses (G:\My Drive\..., C:\Users\you\...),
# so the map, tags and folder moves are the same on both; behind them each top folder is a cloud remote in rclone
# (Google Drive, OneDrive, SharePoint). Settings, in atlas.config.json:
#   "cloud": {"rclone": "rclone", "config": "rclone.conf",
#             "remotes": [["G:\\My Drive", "gdrive:"], ["~\\Team site\\Documents", "team:", "ro"], ...]}
# A third item "ro" marks a remote read only here too: rfs refuses every change on it, whatever asks.
import json, os, subprocess, time
from datetime import datetime
import config as cfg

W = cfg.W
CC = cfg.C.get("cloud") or {}
RCLONE = CC.get("rclone", "rclone")
CONF = CC.get("config") or "rclone.conf"
CONF = CONF if os.path.isabs(CONF) else os.path.join(cfg.HERE, CONF)
REMOTES = sorted(((W.normcase(W.normpath(r[0])), r[1]) for r in CC.get("remotes", [])), key=lambda x: -len(x[0]))
READONLY = {r[1] for r in CC.get("remotes", []) if len(r) > 2 and r[2] == "ro"}


class Missing(Exception):
    pass


def remote(path):
    """Windows path -> rclone path ("gdrive:Projects/Harbor"). Raises Missing when no remote holds it."""
    n = W.normpath(path)
    for pre, rem in REMOTES:
        if W.normcase(n) == pre or W.normcase(n).startswith(pre + "\\"):
            rest = n[len(pre):].lstrip("\\").replace("\\", "/")
            if not rest: return rem
            return rem + rest if rem.endswith(":") else rem.rstrip("/") + "/" + rest
    raise Missing("this folder is not reachable from the server")


def roots():
    """The Windows folders the server can reach."""
    return [p for p, _ in REMOTES]


def _run(args, timeout=300, binary=False):
    r = subprocess.run([RCLONE, "--config", CONF, *args], capture_output=True, timeout=timeout)
    if r.returncode != 0:
        msg = r.stderr.decode("utf-8", "replace").strip().splitlines()
        raise OSError((msg[-1] if msg else "rclone failed")[:300])
    return r.stdout if binary else r.stdout.decode("utf-8", "replace")


def _mtime(s):
    try: return datetime.fromisoformat(s.replace("Z", "+00:00")).timestamp()
    except Exception: return time.time()


def lsjson(path, recursive=False, files_only=False, extra=(), timeout=300):
    args = ["lsjson", "--no-mimetype", remote(path)] + (["-R", "--fast-list"] if recursive else []) + (["--files-only"] if files_only else []) + list(extra)
    out = []
    for e in json.loads(_run(args, timeout=timeout) or "[]"):
        out.append({"rel": e["Path"].replace("/", "\\"), "name": e["Name"], "dir": e.get("IsDir", False),
                    "size": max(0, e.get("Size", 0)), "mtime": _mtime(e.get("ModTime", ""))})
    return out


def stat(path):
    try:
        e = json.loads(_run(["lsjson", "--stat", "--no-mimetype", remote(path)], timeout=60) or "null")
    except OSError:
        return None
    if not e: return None
    return {"name": e["Name"], "dir": e.get("IsDir", False), "size": max(0, e.get("Size", 0)), "mtime": _mtime(e.get("ModTime", ""))}


def isdir(path):
    s = stat(path); return bool(s and s["dir"])


def exists(path):
    return stat(path) is not None


def read(path, limit=None, offset=0):
    args = ["cat", remote(path)] + (["--offset", str(offset)] if offset else []) + (["--count", str(limit)] if limit else [])
    return _run(args, binary=True, timeout=600)


def stream(path, offset=0, count=None):
    """A running rclone that writes the file (or a byte range of it) to its stdout."""
    args = [RCLONE, "--config", CONF, "cat", remote(path)] + (["--offset", str(offset)] if offset else []) + (["--count", str(count)] if count else [])
    return subprocess.Popen(args, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL)


def _writable(path):
    r = remote(path)
    if any(r.startswith(ro) if ro.endswith(":") else (r == ro or r.startswith(ro.rstrip("/") + "/")) for ro in READONLY):
        raise Missing("this folder is read only")
    return r


def mkdir(path):
    _run(["mkdir", _writable(path)])


def copy(src, dst):
    _run(["copyto", remote(src), _writable(dst)], timeout=3600)


def move(src, dst):
    _run(["moveto", _writable(src), _writable(dst)], timeout=3600)


def delete(path):
    """Google Drive keeps deleted files in its trash and OneDrive in its recycle bin, so this can be undone there."""
    r = _writable(path)
    if isdir(path): _run(["purge", r], timeout=3600)
    else: _run(["deletefile", r])


def sync_state(local_dir, folder, files, push_only=False):
    """Two-way copy of the shared state folder, file by file, the newer copy winning (rclone --update)."""
    rem = remote(folder)
    inc = []
    for f in files: inc += ["--include", "/" + f]
    if not push_only:
        try: _run(["copy", "--update", *inc, rem, local_dir], timeout=120)
        except OSError as e:
            if "not found" not in str(e).lower(): raise
    _run(["copy", "--update", *inc, local_dir, rem], timeout=120)
