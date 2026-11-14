# atlas_service.py: the always-on part of Atlas. Started at sign-in (Startup folder).
# Every 10 minutes: index every source (read-only), classify every folder, update the Atlas links, write map.json.
# Serves Atlas at http://127.0.0.1:8765 on this PC; the phone reaches it only through Tailscale (tailscale serve),
# never through the router. Every request needs a signed-in device (see security.py).
# With "mode": "cloud" the same service runs on an always-on Linux server: files are read and changed in the
# cloud drives through rclone (rfs.py), there is no folder of links, and tags, corrections and settings are shared
# with the PC through the state folder.
import os, sys, json, time, threading, traceback, socket, mimetypes, html
from http.server import ThreadingHTTPServer, BaseHTTPRequestHandler
from urllib.parse import urlsplit, parse_qs

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
if sys.stdout is None: sys.stdout = open(os.devnull, "w")
if sys.stderr is None: sys.stderr = open(os.path.join(HERE, "service.err.log"), "a", encoding="utf-8")
import config as cfg
import atlas_index, classify, build_view
import security as sec
import fileops as fo

if cfg.CLOUD: import rfs
PORT, EVERY = sec.PORT, int(cfg.C.get("every_min", 10)) * 60
MAP, LOG = os.path.join(HERE, "map.json"), os.path.join(HERE, "service.log")
OVR, SET = os.path.join(cfg.STATE, "overrides.json"), os.path.join(cfg.STATE, "settings.json")
STATIC = os.path.join(HERE, "static")
TONES = {"red", "orange", "amber", "green", "teal", "blue", "violet", "graphite"}
ROOTS = {s["id"]: s["path"] for s in cfg.SOURCES}
UI = {**cfg.UI, "sources": {s["id"]: s.get("label", s["id"]) for s in cfg.SOURCES}}
LOCK = threading.Lock()
WAKE = threading.Event()
STATUS = {"running": False, "last": None, "next": None, "error": None, "build": None}
_refresh = {"t": None}

CSP_PAGE = ("default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; "
            "img-src 'self' data: blob:; media-src 'self' blob:; font-src 'self'; connect-src 'self'; "
            "worker-src 'self' blob:; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'")
CSP_FILE = "sandbox; default-src 'none'; img-src 'self' data:; media-src 'self'; style-src 'unsafe-inline'"
TEXT_TYPES = {".html", ".htm", ".xhtml", ".js", ".mjs", ".xml", ".hta", ".svgz"}


def log(m):
    with open(LOG, "a", encoding="utf-8") as f: f.write(time.strftime("%Y-%m-%dT%H:%M:%S  service  ") + m + "\n")


_gz = {"src": None, "out": b""}
def gzipped(b):
    """map.json grows with every folder's subfolders; compressed it is about a tenth, which matters on a phone."""
    if _gz["src"] != b:
        import gzip
        _gz["src"], _gz["out"] = b, gzip.compress(b, 6)
    return _gz["out"]


def load_map():
    try: return json.load(open(MAP, encoding="utf-8"))
    except Exception: return {}


def link_of(f):
    if f["state"] == "skip": return None
    if f["kind"] == "tree": return os.path.join(build_view.VIEW, f["state"], f["category"])
    return os.path.join(build_view.VIEW, f["state"], build_view.safe(f["category"]), build_view.safe(f["name"]))


def cycle(reindex=True):
    with LOCK:
        STATUS["running"] = True
        try:
            missing = [r for r, p in ROOTS.items() if not atlas_index._reachable(p)]
            if reindex: atlas_index.main()
            prev = load_map()
            folders = classify.classify(prev, missing)
            if not cfg.CLOUD: STATUS["build"] = build_view.build(folders, [ROOTS[r] for r in missing])
            fo.prune_tags()
            for f in folders:
                f["link"] = None if cfg.CLOUD else link_of(f); f["readonly"] = sec.readonly(f["source"][:-7] if f["kind"] == "loose" else f["source"])
            summ = json.load(open(os.path.join(HERE, "summary.json"), encoding="utf-8"))
            data = {"generated": time.strftime("%Y-%m-%dT%H:%M:%S"), "view_root": build_view.VIEW, "server": cfg.CLOUD,
                    "every_min": EVERY // 60, "missing": missing, "total_files": sum(r[2] for r in summ["roots"]),
                    "total_gb": round(sum(r[3] for r in summ["roots"]), 1), "states": classify.STATES,
                    "categories": [c for c in classify.CATS.values() if c not in cfg.TREE_CATS], "ui": UI, "folders": folders}
            tmp = MAP + ".tmp"
            json.dump(data, open(tmp, "w", encoding="utf-8"), ensure_ascii=False); os.replace(tmp, MAP)
            STATUS["last"], STATUS["error"] = data["generated"], None
            log(f"cycle ok: {len(folders)} folders, missing {missing}, {STATUS['build']}")
        except Exception:
            STATUS["error"] = traceback.format_exc(limit=3); log("cycle failed: " + STATUS["error"])
        finally:
            STATUS["running"] = False


def schedule_refresh():
    """After a file change, rescan once things have been quiet for 20 seconds."""
    if _refresh["t"]: _refresh["t"].cancel()
    _refresh["t"] = threading.Timer(20, lambda: threading.Thread(target=cycle, daemon=True).start())
    _refresh["t"].daemon = True; _refresh["t"].start()


def loop():
    w = cfg.C.get("wait_for")
    if w and not cfg.CLOUD and not os.path.isdir(w): time.sleep(90)     # give a cloud drive time to mount after sign-in
    while True:
        cycle(); WAKE.clear()
        STATUS["next"] = time.strftime("%Y-%m-%dT%H:%M:%S", time.localtime(time.time() + EVERY))
        WAKE.wait(EVERY)


def sync_state(push_only=False):
    """Server only: share tags, corrections and settings with the PC, newest file wins. When the PC changed a
    correction, the map is sorted again."""
    if not (cfg.CLOUD and cfg.STATE_FOLDER): return
    def stamp(): return {f: (os.path.getmtime(os.path.join(cfg.STATE, f)) if os.path.exists(os.path.join(cfg.STATE, f)) else 0) for f in cfg.STATE_FILES}
    with SYNC:
        before = stamp()
        try: rfs.sync_state(cfg.STATE, cfg.STATE_FOLDER, cfg.STATE_FILES, push_only)
        except Exception as e: log("state sync: " + str(e)[:200]); return
        if stamp()["overrides.json"] != before["overrides.json"] and not STATUS["running"]:
            threading.Thread(target=cycle, kwargs={"reindex": False}, daemon=True).start()


def sync_loop():
    while True:
        sync_state(); time.sleep(60)


def push_state():
    if cfg.CLOUD: threading.Thread(target=sync_state, kwargs={"push_only": True}, daemon=True).start()


SYNC = threading.Lock()


def device_label(ua):
    ua = ua or ""
    for k, v in (("Android", "Android phone"), ("iPhone", "iPhone"), ("iPad", "iPad"), ("Windows", "Windows browser"), ("Mac", "Mac")):
        if k in ua: return v
    return "Browser"


def browser_label(ua):
    ua = ua or ""
    for k, v in (("Edg/", "Edge"), ("Firefox/", "Firefox"), ("Chrome/", "Chrome")):
        if k in ua: return v
    return "browser"


LOCKED = """<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Atlas</title><style>body{background:#000;color:#F3F1EC;font:16px/1.5 Arial,sans-serif;display:grid;place-items:center;min-height:100vh;margin:0}
main{max-width:30rem;padding:24px}h1{font-weight:300;font-size:28px;margin:0 0 12px}p{color:#8E9096}
form{display:grid;gap:10px;margin-top:20px}input{font:16px monospace;padding:12px;background:#000;color:#F3F1EC;border:1px solid #45474D;border-radius:4px}
button{font:16px Arial,sans-serif;padding:12px;background:#F3F1EC;color:#000;border:0;border-radius:4px}</style>
<main><h1>Atlas is locked</h1><p>{msg}</p>
<form action="/pair" method="get" onsubmit="event.preventDefault();location.replace('/pair?code='+encodeURIComponent(this.code.value.trim()))"><label for="code">Pairing code from Atlas on the PC</label>
<input id="code" name="code" autocomplete="one-time-code" autocapitalize="off" autocorrect="off" spellcheck="false" required>
<button type="submit">Unlock this device</button></form></main>
<script>try{if(!sessionStorage.getItem("atlasRetry")){sessionStorage.setItem("atlasRetry","1");fetch("/api/whoami",{credentials:"same-origin",cache:"no-store"}).then(function(r){if(r.ok)location.replace("/")})}}catch(e){}</script>"""


class Handler(BaseHTTPRequestHandler):
    server_version = "Atlas"; sys_version = ""

    def log_message(self, *a): pass

    # ---- plumbing --------------------------------------------------------------------------
    def _headers(self, code, ctype, length, extra=None, csp=CSP_PAGE):
        self.send_response(code)
        self.send_header("Content-Type", ctype); self.send_header("Content-Length", str(length))
        self.send_header("X-Content-Type-Options", "nosniff"); self.send_header("Referrer-Policy", "no-referrer")
        self.send_header("X-Frame-Options", "DENY"); self.send_header("Content-Security-Policy", csp)
        self.send_header("Cross-Origin-Opener-Policy", "same-origin"); self.send_header("Cross-Origin-Resource-Policy", "same-origin")
        for k, v in (extra or {}).items(): self.send_header(k, v)
        self.end_headers()

    def _send(self, code, body, ctype="application/json", extra=None):
        b = body if isinstance(body, bytes) else body.encode("utf-8")
        self._headers(code, ctype, len(b), {"Cache-Control": "no-store", **(extra or {})}); self.wfile.write(b)

    def _json(self, code, obj, extra=None):
        self._send(code, json.dumps(obj, ensure_ascii=False), extra=extra)

    def _enter(self, tok):
        """Set the sign-in cookie and step into Atlas with a same-site hop, so SameSite=Strict cookies are sent
        even when the link came from another app (the camera, a QR scanner, a desktop shortcut)."""
        page = ('<!doctype html><meta charset="utf-8"><meta http-equiv="refresh" content="0;url=/"><title>Atlas</title>'
                '<body style="background:#000"><script>location.replace("/")</script>')   # replace: Back never returns here
        self._send(200, page, "text/html; charset=utf-8", {"Set-Cookie": self._cookie(tok)} if tok else None)

    def _locked(self, msg, code=401):
        self._send(code, LOCKED.replace("{msg}", html.escape(msg)), "text/html; charset=utf-8")

    def _host_ok(self):
        return (self.headers.get("Host") or "").lower() in sec.allowed_hosts()

    def _local(self):
        proxied = self.headers.get("X-Forwarded-For") or self.headers.get("Tailscale-User-Login")
        return not proxied and sec.is_local((self.headers.get("Host") or "").lower(), self.client_address[0])

    def _cookie(self, tok):
        secure = "" if self._local() else "; Secure"
        return f"atlas={tok}; HttpOnly; SameSite=Lax; Path=/; Max-Age=15552000{secure}"

    def _renew(self):
        """The same sign-in, sent back with today's settings and a fresh 180 days."""
        for part in (self.headers.get("Cookie") or "").split(";"):
            k, _, v = part.strip().partition("=")
            if k == "atlas" and v: return {"Set-Cookie": self._cookie(v)}
        return None

    def _static(self, rel):
        rp = os.path.realpath(os.path.join(STATIC, rel))
        if not rp.startswith(os.path.realpath(STATIC) + os.sep) or not os.path.isfile(rp):
            return self._send(404, "not found", "text/plain")
        ct = mimetypes.guess_type(rp)[0] or "application/octet-stream"
        if rp.endswith((".mjs", ".js")): ct = "text/javascript"
        if rp.endswith(".webmanifest"): ct = "application/manifest+json"
        b = open(rp, "rb").read()
        extra = {"Cache-Control": "public, max-age=86400"}
        if rp.endswith("sw.js"): extra = {"Cache-Control": "no-cache", "Service-Worker-Allowed": "/"}
        self._headers(200, ct, len(b), extra); self.wfile.write(b)

    def _file(self, rp, dl, size=None):
        size = os.path.getsize(rp) if size is None else size
        ext = os.path.splitext(rp)[1].lower()
        ct = "text/plain; charset=utf-8" if ext in TEXT_TYPES else (mimetypes.guess_type(rp)[0] or "application/octet-stream")
        if ext in (".mov", ".m4v"): ct = "video/mp4"
        start, end, code = 0, size - 1, 200
        rng = self.headers.get("Range", "")
        if rng.startswith("bytes=") and size:
            a, _, b = rng[6:].split(",")[0].strip().partition("-")
            try:
                if a: start, end = int(a), (int(b) if b else size - 1)
                else: start, end = max(0, size - int(b)), size - 1
            except ValueError: start, end = 0, size - 1
            end = min(end, size - 1)
            if start > end: return self._send(416, "", "text/plain", {"Content-Range": f"bytes */{size}"})
            code = 206
        name = os.path.basename(rp).replace('"', "")
        extra = {"Accept-Ranges": "bytes", "Cache-Control": "private, max-age=60",
                 "Content-Disposition": f'{"attachment" if dl else "inline"}; filename="{name.encode("ascii", "replace").decode()}"'}
        if code == 206: extra["Content-Range"] = f"bytes {start}-{end}/{size}"
        self._headers(code, ct, end - start + 1, extra, csp=CSP_FILE)
        proc = None
        try:
            if cfg.CLOUD:
                proc = rfs.stream(rp, start, end - start + 1); f = proc.stdout
            else:
                f = open(rp, "rb"); f.seek(start)
            with f:
                left = end - start + 1
                while left > 0:
                    chunk = f.read(min(1 << 20, left))
                    if not chunk: break
                    self.wfile.write(chunk); left -= len(chunk)
        except (BrokenPipeError, ConnectionResetError, ConnectionAbortedError):
            pass
        finally:
            if proc and proc.poll() is None: proc.kill()

    # ---- GET -------------------------------------------------------------------------------
    def do_GET(self):
        if not self._host_ok(): return self._send(421, "wrong host", "text/plain")
        u = urlsplit(self.path); p = u.path; q = {k: v[0] for k, v in parse_qs(u.query).items()}
        if p.startswith("/static/"): return self._static(p[len("/static/"):])
        if p == "/sw.js": return self._static("sw.js")
        if p == "/manifest.webmanifest": return self._static("manifest.webmanifest")
        if p == "/login":
            if sec.throttled(): return self._locked("Too many attempts. Wait a minute.", 429)
            if sec.check_key(q.get("key", "")):
                if not self._local(): sec.failed(); return self._locked("This sign-in link only works on the PC itself.", 403)
                cur = sec.device(self.headers.get("Cookie"))
                if cur and cur["kind"] == "pc": return self._enter(None)    # already signed in on this browser
                return self._enter(sec.new_device("This PC, " + browser_label(self.headers.get("User-Agent")), "pc"))
            sec.failed(); return self._locked("That sign-in link is not valid.", 403)
        if p == "/pair":
            if sec.device(self.headers.get("Cookie")): return self._enter(None)   # already unlocked: never spend a code again
            if sec.throttled(): return self._locked("Too many attempts. Wait a minute.", 429)
            if sec.use_pair_code(q.get("code", "")):
                return self._enter(sec.new_device(device_label(self.headers.get("User-Agent")), "phone"))
            sec.failed(); return self._locked("This pairing code has expired or was already used. Make a new one on the PC.", 403)
        dev = sec.device(self.headers.get("Cookie"))
        if not dev:
            if p in ("/", "/index.html"):
                if cfg.CLOUD: return self._locked("Enter the pairing code you were given for this device.")
                return self._locked("On the PC, open Atlas from the Start menu. To use a phone, pair it from Atlas on the PC: Devices, then Pair a phone.")
            return self._json(401, {"error": "sign in first"})
        self.dev = dev
        try:
            if p in ("/", "/index.html"):
                return self._send(200, open(os.path.join(HERE, "map.html"), "rb").read(), "text/html; charset=utf-8", self._renew())
            if p == "/map.json":
                b = open(MAP, "rb").read() if os.path.exists(MAP) else b"{}"
                if "gzip" in (self.headers.get("Accept-Encoding") or "") and len(b) > 2048:
                    return self._send(200, gzipped(b), extra={"Content-Encoding": "gzip", "Vary": "Accept-Encoding"})
                return self._send(200, b)
            if p == "/settings":
                return self._send(200, open(SET, "rb").read() if os.path.exists(SET) else b'{"tone":"red"}')
            if p == "/status": return self._json(200, STATUS)
            if p == "/api/whoami": return self._json(200, {"name": dev["name"], "kind": dev["kind"], "local": self._local(), "tailscale": sec.ts_name(), "server": cfg.CLOUD}, self._renew())
            if p == "/api/ls": return self._json(200, fo.listdir(q.get("path", "")))
            if p == "/api/text": return self._json(200, fo.text(q.get("path", "")))
            if p == "/api/file":
                rp = sec.guard(q.get("path", ""))
                if cfg.CLOUD:
                    st = rfs.stat(rp)
                    if not st or st["dir"]: return self._json(404, {"error": "not a file"})
                    return self._file(rp, q.get("dl") == "1", st["size"])
                if not os.path.isfile(rp): return self._json(404, {"error": "not a file"})
                return self._file(rp, q.get("dl") == "1")
            if p == "/api/thumb":
                out = fo.thumb(q.get("path", ""), 1600 if q.get("s") == "1600" else 320)
                b = open(out, "rb").read()
                self._headers(200, "image/jpeg", len(b), {"Cache-Control": "private, max-age=86400"}, csp=CSP_FILE); self.wfile.write(b); return
            if p == "/api/find": return self._json(200, {"results": fo.find(q.get("q", ""), os.path.join(HERE, "index.db"))})
            if p == "/api/tags": return self._json(200, {"vocab": fo.vocab(), "colors": fo.COLORS})
            if p == "/api/devices":
                return self._json(200, {"devices": [{**d, "me": d["id"] == dev["id"]} for d in sec.devices()], "local": self._local()})
            if p == "/logout":
                sec.revoke(dev["id"]); fo.log(f"{dev['name']}#{dev['id']}", "lock", dev["id"])
                page = '<!doctype html><meta charset="utf-8"><title>Atlas</title><body style="background:#000"><script>location.replace("/")</script>'
                return self._send(200, page, "text/html; charset=utf-8", {"Set-Cookie": "atlas=; Max-Age=0; Path=/; HttpOnly; SameSite=Strict"})
            self._json(404, {"error": "not found"})
        except sec.Denied as e:
            self._json(403, {"error": str(e)})
        except FileNotFoundError:
            self._json(404, {"error": "not found"})
        except Exception as e:
            log("GET error: " + traceback.format_exc(limit=2)); self._json(500, {"error": "something went wrong"})

    # ---- POST ------------------------------------------------------------------------------
    def do_POST(self):
        if not self._host_ok(): return self._send(421, "wrong host", "text/plain")
        origin = self.headers.get("Origin", "")
        if self.headers.get("X-Atlas") != "1" or (origin and origin not in sec.allowed_origins()):
            return self._json(403, {"error": "refused"})
        dev = sec.device(self.headers.get("Cookie"))
        if not dev: return self._json(401, {"error": "sign in first"})
        try:
            n = int(self.headers.get("Content-Length", "0") or 0)
            if n > 1_000_000: return self._json(413, {"error": "too large"})
            body = json.loads(self.rfile.read(n) or b"{}")
            if not isinstance(body, dict): raise ValueError
        except Exception:
            return self._json(400, {"error": "bad request"})
        p, who = urlsplit(self.path).path, f"{dev['name']}#{dev['id']}"
        try:
            if p == "/settings":
                try: cur = json.load(open(SET, encoding="utf-8"))
                except Exception: cur = {}
                if "tone" in body:
                    if body["tone"] not in TONES: return self._json(400, {"error": "unknown tone"})
                    cur["tone"] = body["tone"]
                if "view" in body:
                    if body["view"] not in ("treemap", "tree", "list"): return self._json(400, {"error": "unknown view"})
                    cur["view"] = body["view"]
                json.dump(cur, open(SET, "w", encoding="utf-8")); push_state(); return self._json(200, {"ok": True})
            if p in ("/open", "/place"):
                folders = {f["id"]: f for f in load_map().get("folders", [])}
                f = folders.get(body.get("id"))
                if not f: return self._json(404, {"error": "unknown folder"})
                if p == "/open":
                    if cfg.CLOUD: return self._json(400, {"error": "Opening folders works from Atlas on the PC"})
                    target = f.get("link") if body.get("what") == "view" else (f["source"][:-7] if f["kind"] == "loose" else f["source"])
                    child = body.get("child")
                    if child is not None:
                        known = {c["name"] for c in f.get("children", []) if not c["name"].startswith("(")}
                        known |= {c["name"] + "\\" + k["name"] for c in f.get("children", []) for k in c.get("kids", []) if not k["name"].startswith("(")}
                        if child not in known:
                            return self._json(400, {"error": "unknown folder"})
                        target = os.path.join(target, child) if target else None
                    if not target or not os.path.exists(target): return self._json(404, {"error": "not reachable right now"})
                    os.startfile(target); fo.log(who, "open", target); return self._json(200, {"ok": True})
                if f["kind"] == "tree": return self._json(400, {"error": "this folder cannot be moved"})
                st, cat = body.get("state"), body.get("category")
                if st not in classify.STATES + ["skip"] or cat not in classify.CATS.values() or cat in cfg.TREE_CATS:
                    return self._json(400, {"error": "unknown place"})
                try: ovr = json.load(open(OVR, encoding="utf-8"))
                except Exception: ovr = {}
                if body.get("reset"): ovr.pop(f["source"], None)
                else: ovr[f["source"]] = {"state": st, "category": cat, "at": time.strftime("%Y-%m-%dT%H:%M:%S")}
                json.dump(ovr, open(OVR, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
                fo.log(who, "place", {"folder": f["source"], "state": st, "category": cat, "reset": bool(body.get("reset"))}); push_state()
                threading.Thread(target=cycle, kwargs={"reindex": False}, daemon=True).start()
                return self._json(200, {"ok": True})
            if p == "/rescan":
                if not STATUS["running"]: threading.Thread(target=cycle, daemon=True).start()
                return self._json(200, {"ok": True})
            if p == "/api/tag":
                r = fo.set_tags(body.get("path", ""), body.get("tags") or [], body.get("colors")); push_state()
                return self._json(200, {"tags": r})
            if p == "/api/rename":
                dst = fo.rename(body.get("path", ""), body.get("name", ""), who); schedule_refresh(); push_state(); return self._json(200, {"path": dst})
            if p == "/api/mkdir":
                dst = fo.mkdir(body.get("dir", ""), body.get("name", ""), who); schedule_refresh(); return self._json(200, {"path": dst})
            if p == "/api/paste":
                done = fo.paste(body.get("items"), body.get("dest", ""), body.get("mode"), who); schedule_refresh(); push_state(); return self._json(200, {"done": done})
            if p == "/api/delete":
                n = fo.delete(body.get("items"), who); schedule_refresh(); return self._json(200, {"deleted": n})
            if p == "/api/openpath":
                fo.open_on_pc(body.get("path", ""), who); return self._json(200, {"ok": True})
            if p == "/api/pair":
                if not (self._local() and dev["kind"] == "pc"): return self._json(403, {"error": "pair phones from Atlas on the PC"})
                name = sec.ts_name()
                if not name: return self._json(409, {"error": "Tailscale is not running on this PC"})
                code = sec.new_pair_code(); url = f"https://{name}/pair?code={code}"
                import qrcode, qrcode.image.svg, io
                buf = io.BytesIO(); qrcode.make(url, image_factory=qrcode.image.svg.SvgPathImage, box_size=8, border=2).save(buf)
                fo.log(who, "pair-code", name)
                return self._json(200, {"url": url, "svg": buf.getvalue().decode(), "expires_days": sec.PAIR_DAYS})
            if p == "/api/devices/revoke":
                if not (self._local() and dev["kind"] == "pc"): return self._json(403, {"error": "manage devices from Atlas on the PC"})
                ok = sec.revoke(body.get("id", "")); fo.log(who, "revoke", body.get("id")); return self._json(200, {"ok": ok})
            self._json(404, {"error": "not found"})
        except sec.Denied as e:
            self._json(403, {"error": str(e)})
        except FileNotFoundError:
            self._json(404, {"error": "not found"})
        except PermissionError:
            self._json(403, {"error": "the file may be open in another program" if cfg.CLOUD else "Windows refused: the file may be open in another program"})
        except Exception:
            log("POST error: " + traceback.format_exc(limit=2)); self._json(500, {"error": "something went wrong"})


def main():
    s = socket.socket()
    try: s.bind(("127.0.0.1", PORT))
    except OSError: log("already running, exiting"); return
    finally: s.close()
    sec.local_key(); sec.ts_name()
    srv = ThreadingHTTPServer(("127.0.0.1", PORT), Handler)
    if cfg.CLOUD: sync_state(); threading.Thread(target=sync_loop, daemon=True).start()
    threading.Thread(target=loop, daemon=True).start()
    log(f"started, map at http://127.0.0.1:{PORT}")
    srv.serve_forever()


def pair_cli():
    """python3 atlas_service.py --pair: a pairing link for a phone, for a server without a screen."""
    name = sec.ts_name()
    if not name: print("Tailscale is not running here"); return
    code = sec.new_pair_code(); fo.log("server console", "pair-code", name)
    print(f"https://{name}/pair?code={code}\nThe code works once, within {sec.PAIR_DAYS} days.")


if __name__ == "__main__":
    if "--once" in sys.argv: cycle(); print(json.dumps(STATUS))
    elif "--pair" in sys.argv: pair_cli()
    else: main()
