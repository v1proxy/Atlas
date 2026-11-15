# fileops.py: what Atlas can do with files. Every path goes through security.guard first.
# Delete always goes to a bin: the Recycle Bin on the PC (send2trash), Drive's trash or OneDrive's recycle bin on the
# server. Nothing here deletes permanently. On the server (mode "cloud") the same actions run through rclone (rfs.py).
import io, os, json, time, shutil, hashlib, pathlib, sqlite3, subprocess, tempfile, threading
import config as cfg
from security import guard, readonly, check_name, Denied, HERE, BLOCKED
if cfg.CLOUD: import rfs
else: import send2trash
W = cfg.W

TAGS = os.path.join(cfg.STATE, "tags.json")
LOG = os.path.join(HERE, "actions.log")
CACHE = os.path.join(HERE, "cache", "thumbs")
PDFS = os.path.join(HERE, "cache", "pdf")                 # Word, Excel and PowerPoint files turned into PDFs, for previews
_lock = threading.Lock()
_convert = threading.Lock()                             # one LibreOffice at a time

KINDS = {
    "image": "jpg jpeg png gif webp bmp svg avif ico",
    "image_conv": "tif tiff heic psd",
    "video": "mp4 webm mov m4v ogv",
    "audio": "mp3 wav m4a ogg flac aac opus",
    "pdf": "pdf",
    "model": "glb gltf stl obj ply",
    "text": "txt md csv tsv json yaml yml py js ts css xml log ini cfg ps1 sh bat ino c cpp h tex html htm svg rtf toml",
    "office": "docx doc xlsx xls pptx ppt odt ods odp pages numbers key",
    "archive": "zip rar 7z tar gz",
    "cad": "blend fbx dwg dxf rvt rfa 3dm skp ifc step stp dae 3mf usd usdz",
}
EXT = {e: k for k, v in KINDS.items() for e in v.split()}


def kind(name):
    return EXT.get(W.splitext(name)[1].lower().lstrip("."), "other")


def log(device, action, detail):
    with open(LOG, "a", encoding="utf-8") as f:
        f.write(f"{time.strftime('%Y-%m-%dT%H:%M:%S')}  {device}  {action}  {json.dumps(detail, ensure_ascii=False)}\n")


# ---- tags ----------------------------------------------------------------------------------
COLORS = ["red", "orange", "amber", "green", "teal", "blue", "violet", "graphite"]


def _tags():
    try: return json.load(open(TAGS, encoding="utf-8"))
    except Exception: return {"vocab": {}, "files": {}}


def _save_tags(t):
    tmp = TAGS + ".tmp"; json.dump(t, open(tmp, "w", encoding="utf-8"), ensure_ascii=False, indent=1); os.replace(tmp, TAGS)


def tags_of(path):
    return _tags()["files"].get(W.normcase(path), [])


def prune_tags():
    """Forget tags of files that are gone, and tag names no file uses any more. A file whose folder can't be
    reached right now (a cloud drive not mounted) keeps its tags. The server leaves this to the PC."""
    if cfg.CLOUD: return
    from security import ROOTS_RW, ROOTS_RO
    roots = [os.path.normcase(r) for r in ROOTS_RW + ROOTS_RO]
    def gone(p):
        if os.path.exists(p): return False
        r = next((r for r in roots if p.startswith(r + os.sep)), None)
        return r is not None and os.path.isdir(r)
    with _lock:
        t = _tags()
        files = {p: v for p, v in t["files"].items() if not gone(p)}
        used = {n for v in files.values() for n in v}
        if len(files) != len(t["files"]) or set(t["vocab"]) - used:
            _save_tags({"vocab": {k: c for k, c in t["vocab"].items() if k in used}, "files": files})


def vocab():
    return _tags()["vocab"]


def set_tags(path, names, colors=None):
    rp = guard(path)                                   # tags live in Atlas, so read access is enough
    names = [n.strip()[:40] for n in names if isinstance(n, str) and n.strip()][:12]
    with _lock:
        t = _tags()
        for n in names:
            c = (colors or {}).get(n)
            if c in COLORS: t["vocab"][n] = c
            t["vocab"].setdefault(n, COLORS[len(t["vocab"]) % len(COLORS)])
        key = W.normcase(rp)
        if names: t["files"][key] = names
        else: t["files"].pop(key, None)
        _save_tags(t)
    return names


def _move_tags(src, dst):
    with _lock:
        t = _tags(); s, d = W.normcase(src), W.normcase(dst)
        moved = {}
        for k, v in list(t["files"].items()):
            if k == s or k.startswith(s + "\\"):
                moved[d + k[len(s):]] = v; t["files"].pop(k)
        t["files"].update(moved); _save_tags(t)


# ---- reading -------------------------------------------------------------------------------
def _hidden(name):
    return name.lower() in ("desktop.ini", "thumbs.db") or name.startswith("~$")


def _blocked(path):
    return any(W.normcase(path) == W.normcase(b) for b in BLOCKED)


def _cloud(fn):
    """Server only: turns rclone's errors into plain answers."""
    def wrap(*a, **k):
        try: return fn(*a, **k)
        except rfs.Missing as e: raise Denied(str(e))
        except OSError as e: raise Denied("the cloud said: " + str(e))
    return wrap


def listdir(path):
    rp = guard(path)
    t = _tags()["files"]
    if cfg.CLOUD:
        try: items = rfs.lsjson(rp, timeout=60)
        except rfs.Missing as e: raise Denied(str(e))
        except OSError: raise Denied("not a folder, or the cloud can't be reached right now")
        out = [{"name": e["name"], "path": W.join(rp, e["name"]), "dir": e["dir"], "size": 0 if e["dir"] else e["size"],
                "mtime": int(e["mtime"]), "kind": "folder" if e["dir"] else kind(e["name"]), "cloud": False,
                "tags": t.get(W.normcase(W.join(rp, e["name"])), [])} for e in items
               if not _hidden(e["name"]) and not _blocked(W.join(rp, e["name"]))][:3000]
        out.sort(key=lambda x: (not x["dir"], x["name"].lower()))
        return {"path": rp, "readonly": readonly(rp), "entries": out, "parent": W.dirname(rp), "server": True}
    if not os.path.isdir(rp): raise Denied("not a folder")
    out = []
    with os.scandir(rp) as it:
        for e in it:
            try:
                st = e.stat(follow_symlinks=False)
                a = getattr(st, "st_file_attributes", 0)
                if a & 0x2 or a & 0x4 or _hidden(e.name) or _blocked(e.path):
                    continue                            # hidden and system files stay hidden
                isdir = e.is_dir(follow_symlinks=False)
                out.append({"name": e.name, "path": e.path, "dir": isdir, "size": 0 if isdir else st.st_size,
                            "mtime": int(st.st_mtime), "kind": "folder" if isdir else kind(e.name),
                            "cloud": bool(a & (0x400000 | 0x40000 | 0x1000)), "tags": t.get(os.path.normcase(e.path), [])})
            except OSError:
                continue
            if len(out) >= 3000: break
    out.sort(key=lambda x: (not x["dir"], x["name"].lower()))
    return {"path": rp, "readonly": readonly(rp), "entries": out, "parent": os.path.dirname(rp)}


def text(path, limit=262144):
    rp = guard(path)
    if cfg.CLOUD: b = _cloud(rfs.read)(rp, limit + 1)
    else:
        with open(rp, "rb") as f: b = f.read(limit + 1)
    return {"text": b[:limit].decode("utf-8", errors="replace"), "truncated": len(b) > limit}


def thumb(path, size=320):
    rp = guard(path)
    if cfg.CLOUD:
        s = _cloud(rfs.stat)(rp)
        if not s or s["dir"]: raise Denied("not a file")
        fsize, fmtime = s["size"], s["mtime"]
    else:
        st = os.stat(rp); fsize, fmtime = st.st_size, st.st_mtime
    if fsize > 80_000_000: raise Denied("too large to preview")
    os.makedirs(CACHE, exist_ok=True)
    key = hashlib.sha1(f"{rp}|{fmtime}|{fsize}|{size}".encode()).hexdigest()
    out = os.path.join(CACHE, key + ".jpg")
    if not os.path.exists(out):
        from PIL import Image, ImageOps
        try:
            import pillow_heif; pillow_heif.register_heif_opener()      # iPhone photos (HEIC)
        except ImportError:
            pass
        src = rp
        if cfg.CLOUD: src = _cloud(rfs.local_copy)(rp, s) or io.BytesIO(_cloud(rfs.read)(rp))
        with Image.open(src) as im:
            im = ImageOps.exif_transpose(im); im.thumbnail((size, size))
            if im.mode not in ("RGB", "L"): im = im.convert("RGB")
            im.save(out, "JPEG", quality=82)
    return out


def soffice():
    return cfg.C.get("soffice") or shutil.which("soffice") or shutil.which("libreoffice")


def office_pdf(path):
    """A Word, Excel or PowerPoint file (or an OpenDocument one) as a PDF, made once with LibreOffice and kept, so a
    phone can show it like any PDF. The PDF is a preview: the file itself is never changed."""
    rp = guard(path)
    if kind(rp) != "office" or W.splitext(rp)[1].lower() in (".pages", ".numbers", ".key"):
        raise Denied("there is no preview for this kind of file")
    lo = soffice()
    if not lo: raise Denied("previews of office files need LibreOffice where Atlas runs")
    if cfg.CLOUD:
        s = _cloud(rfs.stat)(rp)
        if not s or s["dir"]: raise Denied("not a file")
        src = _cloud(rfs.local_copy)(rp, s)
        if not src: raise Denied("too large to preview")
        fsize, fmtime = s["size"], s["mtime"]
    else:
        st = os.stat(rp); src, fsize, fmtime = rp, st.st_size, st.st_mtime
        if fsize > 64 * 2 ** 20: raise Denied("too large to preview")
    os.makedirs(PDFS, exist_ok=True)
    out = os.path.join(PDFS, hashlib.sha1(f"{W.normcase(rp)}|{fmtime}|{fsize}".encode()).hexdigest() + ".pdf")
    if os.path.exists(out):
        try: os.utime(out)
        except OSError: pass
        return out
    with _convert:
        if os.path.exists(out): return out
        tmp = tempfile.mkdtemp(dir=PDFS)
        try:
            inp = os.path.join(tmp, "file" + W.splitext(rp)[1].lower())    # LibreOffice reads the kind from the extension
            shutil.copyfile(src, inp)
            profile = os.path.join(HERE, "cache", "libreoffice")
            try:
                subprocess.run([lo, "--headless", "--norestore", "--nologo", "--nodefault", "--nolockcheck",
                                "-env:UserInstallation=" + pathlib.Path(profile).as_uri(),
                                "--convert-to", "pdf", "--outdir", tmp, inp],
                               stdin=subprocess.DEVNULL, capture_output=True, timeout=180)
            except subprocess.TimeoutExpired:
                raise Denied("this file took too long to turn into a preview")
            made = os.path.join(tmp, "file.pdf")
            if not os.path.exists(made) or not os.path.getsize(made): raise Denied("this file can't be turned into a preview")
            os.replace(made, out)
        finally:
            shutil.rmtree(tmp, ignore_errors=True)
    _trim_pdfs()
    return out


def _trim_pdfs(keep=512 * 2 ** 20):
    try: fs = sorted((e.stat().st_mtime, e.stat().st_size, e.path) for e in os.scandir(PDFS) if e.is_file())
    except OSError: return
    total = sum(f[1] for f in fs)
    for _, size, p in fs:
        if total <= keep: break
        try: os.remove(p); total -= size
        except OSError: pass


def find(q, db_path, limit=60):
    q = (q or "").strip()
    if len(q) < 2: return []
    con = sqlite3.connect(f"file:{db_path}?mode=ro", uri=True)
    rows = con.execute("SELECT path, name, size, mtime, root FROM files WHERE name LIKE ? ESCAPE '\\' ORDER BY mtime DESC LIMIT ?",
                       ("%" + q.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_") + "%", limit)).fetchall()
    con.close()
    out = []
    for p, n, s, m, r in rows:
        try: guard(p)
        except Denied: continue
        out.append({"path": p, "name": n, "size": s, "mtime": int(m), "kind": kind(n), "dir": False})
    return out


# ---- changing ------------------------------------------------------------------------------
def _exists(p):
    return rfs.exists(p) if cfg.CLOUD else os.path.exists(p)


def _isdir(p):
    return rfs.isdir(p) if cfg.CLOUD else os.path.isdir(p)


def _unique(dst):
    if not _exists(dst): return dst
    base, ext = W.splitext(dst); i = 2
    while _exists(f"{base} ({i}){ext}"): i += 1
    return f"{base} ({i}){ext}"


def rename(path, new_name, device):
    rp = guard(path, write=True); check_name(new_name)
    dst = W.join(W.dirname(rp), new_name)
    guard(dst, write=True)
    if _exists(dst) and W.normcase(dst) != W.normcase(rp): raise Denied("a file with that name is already there")
    if cfg.CLOUD: _cloud(rfs.move)(rp, dst)
    else: os.rename(rp, dst)
    _move_tags(rp, dst); log(device, "rename", [rp, dst])
    return dst


def mkdir(parent, name, device):
    rp = guard(parent); guard(W.join(rp, "x"), write=True); check_name(name)
    dst = _unique(W.join(rp, name))
    if cfg.CLOUD: _cloud(rfs.mkdir)(dst)
    else: os.mkdir(dst)
    log(device, "mkdir", dst)
    return dst


def paste(items, dest, mode, device):
    if mode not in ("copy", "move") or not isinstance(items, list) or not 0 < len(items) <= 500: raise Denied("nothing to paste")
    dd = guard(dest)
    if not _isdir(dd): raise Denied("not a folder")
    guard(W.join(dd, "x"), write=True)
    done = []
    for p in items:
        src = guard(p, write=(mode == "move"))
        if W.normcase(dd) == W.normcase(src) or W.normcase(dd).startswith(W.normcase(src) + "\\"):
            raise Denied("a folder cannot go inside itself")
        dst = W.join(dd, W.basename(src))
        if mode == "move" and W.normcase(W.dirname(src)) == W.normcase(dd):
            continue
        dst = _unique(dst)
        if cfg.CLOUD:
            _cloud(rfs.copy if mode == "copy" else rfs.move)(src, dst)
            if mode == "move": _move_tags(src, dst)
        elif mode == "copy":
            (shutil.copytree if os.path.isdir(src) else shutil.copy2)(src, dst)
        else:
            shutil.move(src, dst); _move_tags(src, dst)
        done.append(dst)
    log(device, mode, {"to": dd, "items": items})
    return done


def delete(items, device):
    if not isinstance(items, list) or not 0 < len(items) <= 500: raise Denied("nothing to delete")
    paths = [guard(p, write=True) for p in items]
    for p in paths:
        if cfg.CLOUD: _cloud(rfs.delete)(p)            # Drive's trash, OneDrive's recycle bin
        else: send2trash.send2trash(p)                 # Recycle Bin, Google Drive for desktop included
    log(device, "delete", paths)
    return len(paths)


def open_on_pc(path, device):
    if cfg.CLOUD: raise Denied("Open on PC works from Atlas on the PC")
    rp = guard(path); os.startfile(rp); log(device, "open", rp)
