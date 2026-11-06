# security.py: who may use Atlas, from where, and on which paths.
#
# - Every page and API call needs a signed-in device (an HttpOnly, SameSite=Strict cookie).
#   The PC signs in through the Start menu shortcut, which carries a key only this Windows user can read.
#   A phone signs in by scanning a one-time pairing code shown on the PC (valid 5 minutes, one use).
# - Requests must name this PC in the Host header (blocks DNS rebinding) and, for changes, come from
#   Atlas's own page (Origin check plus a custom header that other websites cannot send).
# - Every file path is resolved and must sit inside the folders listed in atlas.config.json:
#   read_write folders can be changed, read_only folders can only be looked at. Nothing else is reachable.
import os, json, time, hmac, hashlib, secrets, subprocess, threading
import config as cfg

HERE = cfg.HERE
DEV, KEY = os.path.join(HERE, "devices.json"), os.path.join(HERE, "local.key")
PORT = cfg.PORT
H = cfg.HOME
ROOTS_RW = cfg.C.get("read_write", [])
ROOTS_RO = cfg.C.get("read_only", [])
_lock = threading.Lock()
_pairs = {}      # sha256(code) -> expiry time
_fails = []      # times of failed sign-in attempts
_ts = {"name": None, "at": 0}


class Denied(Exception):
    pass


def _h(s):
    return hashlib.sha256(s.encode()).hexdigest()


def local_key():
    if not os.path.exists(KEY):
        with open(KEY, "w") as f: f.write(secrets.token_urlsafe(32))
    return open(KEY).read().strip()


def ts_name():
    """This PC's Tailscale name (e.g. mypc.tail1234.ts.net), refreshed every 10 minutes."""
    if time.time() - _ts["at"] > 600:
        _ts["at"] = time.time()
        try:
            out = subprocess.run([r"C:\Program Files\Tailscale\tailscale.exe", "status", "--json"],
                                 capture_output=True, timeout=10, creationflags=0x08000000)
            _ts["name"] = json.loads(out.stdout)["Self"]["DNSName"].rstrip(".").lower() or None
        except Exception:
            pass
    return _ts["name"]


def allowed_hosts():
    hs = {f"127.0.0.1:{PORT}", f"localhost:{PORT}"}
    n = ts_name()
    if n: hs |= {n, n + ":443"}
    return hs


def allowed_origins():
    o = {f"http://127.0.0.1:{PORT}", f"http://localhost:{PORT}"}
    n = ts_name()
    if n: o.add("https://" + n)
    return o


def is_local(host, client_ip):
    return client_ip == "127.0.0.1" and host in (f"127.0.0.1:{PORT}", f"localhost:{PORT}")


# ---- devices -------------------------------------------------------------------------------
def _load():
    try: return json.load(open(DEV, encoding="utf-8"))
    except Exception: return {}


def _save(d):
    tmp = DEV + ".tmp"
    json.dump(d, open(tmp, "w", encoding="utf-8"), indent=1)
    os.replace(tmp, DEV)


def new_device(name, kind):
    tok = secrets.token_urlsafe(32)
    with _lock:
        d = _load()
        d[_h(tok)] = {"id": secrets.token_hex(4), "name": name[:80], "kind": kind,
                      "created": time.strftime("%Y-%m-%d %H:%M"), "last": time.strftime("%Y-%m-%d %H:%M")}
        _save(d)
    return tok


def device(cookie_header):
    tok = None
    for part in (cookie_header or "").split(";"):
        k, _, v = part.strip().partition("=")
        if k == "atlas": tok = v
    if not tok: return None
    with _lock:
        d = _load(); rec = d.get(_h(tok))
        if rec:
            now = time.strftime("%Y-%m-%d %H:%M")
            if rec.get("last") != now: rec["last"] = now; _save(d)
        return rec


def devices():
    return sorted(_load().values(), key=lambda r: r["created"])


def revoke(dev_id):
    with _lock:
        d = _load(); n = len(d)
        d = {k: v for k, v in d.items() if v["id"] != dev_id}
        _save(d)
        return n != len(d)


# ---- sign-in -------------------------------------------------------------------------------
def throttled():
    now = time.time()
    with _lock:
        _fails[:] = [t for t in _fails if now - t < 60]
        return len(_fails) >= 10


def failed():
    with _lock: _fails.append(time.time())


def check_key(k):
    return bool(k) and hmac.compare_digest(k, local_key())


PAIRS = os.path.join(HERE, "pairs.json")                 # pairing codes, stored hashed, so they survive a restart
PAIR_DAYS = float(cfg.C.get("pair_code_days", 30))       # a code works once, within this many days


def _load_pairs():
    try: return json.load(open(PAIRS, encoding="utf-8"))
    except Exception: return {}


def _save_pairs(p):
    tmp = PAIRS + ".tmp"; json.dump(p, open(tmp, "w", encoding="utf-8")); os.replace(tmp, PAIRS)


def new_pair_code():
    code = secrets.token_urlsafe(16)
    with _lock:
        now = time.time()
        p = {c: t for c, t in _load_pairs().items() if t > now}
        p[_h(code)] = now + PAIR_DAYS * 86400
        _save_pairs(p)
    return code


def use_pair_code(code):
    if not code: return False
    with _lock:
        p = _load_pairs(); t = p.pop(_h(code), None)
        if t is not None: _save_pairs(p)
    return bool(t and t > time.time())


# ---- paths ---------------------------------------------------------------------------------
def _under(p, root):
    p, r = os.path.normcase(p), os.path.normcase(root).rstrip("\\")
    return p == r or p.startswith(r + "\\")


def guard(path, write=False):
    """Return the real path if it is inside your folders (and writable when write=True), else raise Denied."""
    if not isinstance(path, str) or not path or len(path) > 1000 or "\x00" in path:
        raise Denied("bad path")
    if path.startswith("\\\\") or path.startswith("//"):
        raise Denied("network and device paths are not allowed")
    rp = os.path.realpath(os.path.abspath(path))
    if ":" in rp[2:]:
        raise Denied("bad path")                       # NTFS alternate data streams
    if not any(_under(rp, r) for r in ROOTS_RW + ROOTS_RO):
        raise Denied("outside your folders")
    if write:
        if any(_under(rp, r) for r in ROOTS_RO):
            raise Denied("this folder is read only in Atlas")
        if any(os.path.normcase(rp) == os.path.normcase(r) for r in ROOTS_RW):
            raise Denied("a top folder cannot be changed")
    return rp


def readonly(path):
    try: rp = os.path.realpath(path)
    except Exception: return True
    return any(_under(rp, r) for r in ROOTS_RO)


def root_of(path):
    rp = os.path.realpath(path)
    for r in ROOTS_RO + ROOTS_RW:
        if _under(rp, r): return r
    return None


SAFE_NAME_BAD = set('<>:"/\\|?*') | {chr(i) for i in range(32)}
RESERVED = {"con", "prn", "aux", "nul"} | {f"com{i}" for i in range(1, 10)} | {f"lpt{i}" for i in range(1, 10)}


def check_name(name):
    if not isinstance(name, str) or not name.strip() or len(name) > 200:
        raise Denied("empty or too long name")
    if any(c in SAFE_NAME_BAD for c in name) or name in (".", "..") or name.rstrip(" .") != name:
        raise Denied('a name cannot contain < > : " / \\ | ? * or end with a space or dot')
    if name.split(".")[0].lower() in RESERVED:
        raise Denied("that name is reserved by Windows")
    return name
