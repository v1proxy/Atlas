# rfs.py: files for Atlas on a server. Paths stay the Windows paths the PC uses (G:\My Drive\..., C:\Users\you\...),
# so the map, tags and folder moves are the same on both; behind them each top folder is a cloud remote in rclone
# (Google Drive, OneDrive, SharePoint). Settings, in atlas.config.json:
#   "cloud": {"rclone": "rclone", "config": "rclone.conf",
#             "remotes": [["G:\\My Drive", "gdrive:"], ["~\\Team site\\Documents", "team:", "ro"], ...]}
# A third item "ro" marks a remote read only here too: rfs refuses every change on it, whatever asks.
#
# Speed: starting rclone for each request costs 3 to 40 seconds with Google Drive, since every run signs in again and
# finds the file's folder from the top. So file reads, file details and folder listings go to one rclone that stays
# running ("rclone rcd", server/atlas-rclone.service) and keeps both, which answers in about a second. A file up to
# 64 MB is copied to this server's disk the first time it is opened and served from there while there is room
# ("preview_cache_mb", 2048 by default), so a PDF's many small requests, a thumbnail or a conversion don't each go
# back to the cloud. Without that rclone, everything still works by running rclone each time, only slower.
import hashlib, http.client, json, os, socket, subprocess, threading, time
from datetime import datetime
from urllib.parse import quote
import config as cfg

W = cfg.W
CC = cfg.C.get("cloud") or {}
RCLONE = CC.get("rclone", "rclone")
CONF = CC.get("config") or "rclone.conf"
CONF = CONF if os.path.isabs(CONF) else os.path.join(cfg.HERE, CONF)
REMOTES = sorted(((W.normcase(W.normpath(r[0])), r[1]) for r in CC.get("remotes", [])), key=lambda x: -len(x[0]))
READONLY = {r[1] for r in CC.get("remotes", []) if len(r) > 2 and r[2] == "ro"}
RCD = CC.get("rcd", "/run/atlas-rclone/rc.sock")          # the running rclone: a unix socket, or http://127.0.0.1:port
FILES = os.path.join(cfg.HERE, "cache", "files")           # copies of recently opened files
KEEP = int(CC.get("preview_cache_mb", 2048)) * 2 ** 20      # room for them on this server's disk
WHOLE = 64 * 2 ** 20                                       # files up to this size are copied whole; larger ones stream
STAT_FOR = 60                                              # seconds a file's details are trusted before asking again
LIST_FOR = 15                                              # seconds a folder's contents are reused (repeated taps)
WAIT = 20                                                  # seconds to wait for the running rclone before going without it


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


# ---- the running rclone (rclone rcd) ---------------------------------------------------------------------------
class _NoRcd(Exception):
    """The running rclone can't be reached: run rclone directly instead."""


class _UnixHTTP(http.client.HTTPConnection):
    def __init__(self, path, timeout):
        super().__init__("localhost", timeout=timeout); self._path = path

    def connect(self):
        s = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM); s.settimeout(self.timeout)
        try: s.connect(self._path)
        except OSError: s.close(); raise
        self.sock = s


_down = {"until": 0.0}


def _connect(timeout, force=False):
    if (time.time() < _down["until"] and not force) or not RCD: raise _NoRcd()
    if RCD.startswith("http://"):
        host, _, port = RCD[7:].rstrip("/").partition(":")
        c = http.client.HTTPConnection(host, int(port or 80), timeout=timeout)
    else:
        if not os.path.exists(RCD): raise _NoRcd()
        c = _UnixHTTP(RCD, timeout)
    try: c.connect()
    except OSError:
        c.close(); _down["until"] = time.time() + 30; raise _NoRcd()
    return c


def _split(r):
    """"gdrive:Projects/a.pdf" -> ("gdrive:", "Projects/a.pdf"). A remote's name ends at its first colon, also in a
    connection string such as "gdrive,root_folder_id=…:"."""
    i = r.index(":") + 1
    return r[:i], r[i:].strip("/")


def _stuck():
    """The running rclone didn't answer in time: one of its connections to the cloud is probably stuck (it happened on
    2026-11-15: folders waited 60 s and failed). For a minute rclone runs directly instead, and the running one is told
    to drop what it holds, so it starts again with new connections."""
    if time.time() < _down["until"]: return
    _down["until"] = time.time() + 60
    def clear():
        try:
            c = _connect(15, force=True)
            try: c.request("POST", "/fscache/clear", body=b"{}", headers={"Content-Type": "application/json"}); c.getresponse().read()
            finally: c.close()
        except Exception: pass
    threading.Thread(target=clear, daemon=True).start()


def _rc(cmd, params, timeout=None):
    c = _connect(timeout or WAIT)
    try:
        c.request("POST", "/" + cmd, body=json.dumps(params).encode(), headers={"Content-Type": "application/json"})
        r = c.getresponse(); data = r.read()
    except socket.timeout:
        _stuck(); raise _NoRcd()
    except (OSError, http.client.HTTPException):
        _down["until"] = time.time() + 30; raise _NoRcd()
    finally:
        c.close()
    try: j = json.loads(data or b"{}")
    except ValueError: j = {}
    if r.status != 200: raise OSError(str(j.get("error") or "rclone failed").splitlines()[-1][:300])
    return j


class _Body:
    """A file, or part of one, as it arrives: read(n) and close(), like an open file."""
    def __init__(self, resp, conn=None, proc=None):
        self.resp, self.conn, self.proc = resp, conn, proc

    def read(self, n=-1):
        return self.resp.read(n)

    def close(self):
        try: self.resp.close()
        except Exception: pass
        if self.conn: self.conn.close()
        if self.proc and self.proc.poll() is None: self.proc.kill()

    def __enter__(self): return self
    def __exit__(self, *a): self.close()


def _open_rcd(path, offset=0, count=None):
    fs, rel = _split(remote(path))
    c = _connect(30)
    try:
        h = {"Range": f"bytes={offset}-{'' if count is None else offset + count - 1}"} if (offset or count is not None) else {}
        c.request("GET", "/" + quote("[" + fs + "]", safe=":,=") + "/" + quote(rel, safe="/"), headers=h)
        r = c.getresponse()
    except socket.timeout:
        c.close(); _stuck(); raise _NoRcd()
    except (OSError, http.client.HTTPException):
        c.close(); _down["until"] = time.time() + 30; raise _NoRcd()
    if r.status not in (200, 206):
        msg = r.read(500).decode("utf-8", "replace"); c.close()
        raise OSError("not found" if r.status == 404 else (msg.strip().splitlines() or ["rclone failed"])[-1][:300])
    return _Body(r, c)


def open_range(path, offset=0, count=None):
    """The file from offset, count bytes of it (all of it when count is None), as it arrives from the cloud."""
    try: return _open_rcd(path, offset, count)
    except _NoRcd:
        p = stream(path, offset, count)
        return _Body(p.stdout, proc=p)


# The same question asked several times at once (a few taps on one folder) goes to the cloud once; all get the answer.
_inflight, _inflight_lock = {}, threading.Lock()


def _once(key, fn):
    with _inflight_lock:
        job = _inflight.get(key); lead = job is None
        if lead: job = _inflight[key] = {"done": threading.Event(), "res": None, "err": None}
    if not lead:
        if not job["done"].wait(130): raise OSError("the cloud took too long to answer")
        if job["err"]: raise job["err"]
        return job["res"]
    try:
        job["res"] = fn(); return job["res"]
    except Exception as e:
        job["err"] = e; raise
    finally:
        job["done"].set()
        with _inflight_lock: _inflight.pop(key, None)


def forget():
    """After a change: what was learned about files and folders may be out of date."""
    _stats.clear(); _lists.clear()
    try: _rc("fscache/clear", {}, timeout=10)
    except (_NoRcd, OSError): pass


def _run(args, timeout=300, binary=False):
    r = subprocess.run([RCLONE, "--config", CONF, *args], capture_output=True, timeout=timeout)
    if r.returncode != 0:
        msg = r.stderr.decode("utf-8", "replace").strip().splitlines()
        raise OSError((msg[-1] if msg else "rclone failed")[:300])
    return r.stdout if binary else r.stdout.decode("utf-8", "replace")


def _mtime(s):
    try: return datetime.fromisoformat(s.replace("Z", "+00:00")).timestamp()
    except Exception: return time.time()


_lists = {}


def lsjson(path, recursive=False, files_only=False, extra=(), timeout=300):
    if not recursive and not extra:                        # a folder's contents: from the running rclone, asked once
        key = (W.normcase(path), files_only)
        hit = _lists.get(key)
        if hit and time.time() - hit[1] < LIST_FOR: return [dict(e) for e in hit[0]]
        out = _once(("ls",) + key, lambda: _ls(path, files_only, timeout))
        if len(_lists) > 2000: _lists.clear()
        _lists[key] = (out, time.time())
        return [dict(e) for e in out]
    args = ["lsjson", "--no-mimetype", remote(path)] + (["-R", "--fast-list"] if recursive else []) + (["--files-only"] if files_only else []) + list(extra)
    out = []
    for e in json.loads(_run(args, timeout=timeout) or "[]"):
        out.append({"rel": e["Path"].replace("/", "\\"), "name": e["Name"], "dir": e.get("IsDir", False),
                    "size": max(0, e.get("Size", 0)), "mtime": _mtime(e.get("ModTime", ""))})
    return out


def _ls(path, files_only, timeout):
    try:
        fs, rel = _split(remote(path))
        j = _rc("operations/list", {"fs": fs, "remote": rel, "opt": {"noMimeType": True, "filesOnly": files_only}})
        out, now = [], time.time()
        for e in j.get("list") or []:
            d = {"rel": e["Name"], "name": e["Name"], "dir": e.get("IsDir", False),
                 "size": max(0, e.get("Size", 0)), "mtime": _mtime(e.get("ModTime", ""))}
            out.append(d)
            _stats[W.normcase(W.join(path, e["Name"]))] = ({"name": d["name"], "dir": d["dir"], "size": d["size"], "mtime": d["mtime"]}, now)
        return out
    except _NoRcd:                                         # without it (or while it is stuck): rclone directly
        args = ["lsjson", "--no-mimetype", remote(path)] + (["--files-only"] if files_only else [])
        return [{"rel": e["Path"].replace("/", "\\"), "name": e["Name"], "dir": e.get("IsDir", False),
                 "size": max(0, e.get("Size", 0)), "mtime": _mtime(e.get("ModTime", ""))} for e in json.loads(_run(args, timeout=timeout) or "[]")]


_stats = {}


def stat(path):
    key = W.normcase(path)
    hit = _stats.get(key)
    if hit and time.time() - hit[1] < STAT_FOR: return hit[0]
    return _once(("stat", key), lambda: _stat(path, key))


def _stat(path, key):
    r = remote(path)
    try:
        fs, rel = _split(r)
        e = _rc("operations/stat", {"fs": fs, "remote": rel, "opt": {"noMimeType": True}}).get("item")
    except _NoRcd:
        try: e = json.loads(_run(["lsjson", "--stat", "--no-mimetype", r], timeout=60) or "null")
        except OSError: return None
    except OSError:
        return None
    s = None if not e else {"name": e["Name"], "dir": e.get("IsDir", False), "size": max(0, e.get("Size", 0)), "mtime": _mtime(e.get("ModTime", ""))}
    if len(_stats) > 20000: _stats.clear()
    _stats[key] = (s, time.time())
    return s


def isdir(path):
    s = stat(path); return bool(s and s["dir"])


def exists(path):
    return stat(path) is not None


def read(path, limit=None, offset=0):
    try: f = _open_rcd(path, offset, limit)
    except _NoRcd:
        args = ["cat", remote(path)] + (["--offset", str(offset)] if offset else []) + (["--count", str(limit)] if limit else [])
        return _run(args, binary=True, timeout=600)
    with f:
        out, left = [], limit
        while left is None or left > 0:
            b = f.read(1 << 20 if left is None else min(1 << 20, left))
            if not b: break
            out.append(b)
            if left is not None: left -= len(b)
        return b"".join(out)


_locks, _locks_guard = {}, threading.Lock()


def _lock(key):
    with _locks_guard:
        if len(_locks) > 500: _locks.clear()
        return _locks.setdefault(key, threading.Lock())


def local_copy(path, st=None):
    """This server's copy of a file up to 64 MB, fetched whole the first time and kept while there is room; None for
    a larger file, which streams instead. Google Docs, Sheets and Slides have no size until they are exported, so
    they are fetched too (up to twice that)."""
    st = st or stat(path)
    if not st or st["dir"] or st["size"] > WHOLE: return None
    key = hashlib.sha1(f"{W.normcase(path)}|{st['mtime']}|{st['size']}".encode()).hexdigest()
    out = os.path.join(FILES, key + W.splitext(path)[1].lower()[:12])
    with _lock(key):
        if os.path.exists(out):
            try: os.utime(out)
            except OSError: pass
            return out
        os.makedirs(FILES, exist_ok=True)
        tmp = out + ".part"
        try:
            with open_range(path) as src, open(tmp, "wb") as dst:
                got = 0
                while True:
                    b = src.read(1 << 20)
                    if not b: break
                    got += len(b)
                    if got > 2 * WHOLE: raise OSError("too large to preview")
                    dst.write(b)
            if not got: return None                         # nothing came: don't keep an empty copy
            if st["size"] and got != st["size"]: raise OSError("the file didn't arrive whole, try again")
            os.replace(tmp, out)
        finally:
            if os.path.exists(tmp): os.remove(tmp)
    threading.Thread(target=_trim, daemon=True).start()
    return out


def _trim():
    """Keep the copies within their room: the least recently opened go first."""
    try:
        fs = [(e.stat().st_mtime, e.stat().st_size, e.path) for e in os.scandir(FILES) if e.is_file() and not e.name.endswith(".part")]
    except OSError:
        return
    total = sum(f[1] for f in fs)
    if total <= KEEP: return
    for _, size, p in sorted(fs):
        if total <= KEEP * 0.8: break
        try: os.remove(p); total -= size
        except OSError: pass


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
    _run(["mkdir", _writable(path)]); forget()


def copy(src, dst):
    _run(["copyto", remote(src), _writable(dst)], timeout=3600); forget()


def move(src, dst):
    _run(["moveto", _writable(src), _writable(dst)], timeout=3600); forget()


def delete(path):
    """Google Drive keeps deleted files in its trash and OneDrive in its recycle bin, so this can be undone there."""
    r = _writable(path)
    if isdir(path): _run(["purge", r], timeout=3600)
    else: _run(["deletefile", r])
    forget()


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
