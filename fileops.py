# fileops.py: what Atlas can do with files. Every path goes through security.guard first.
# Delete always goes to the Recycle Bin (send2trash); nothing here deletes permanently.
import os, json, time, shutil, hashlib, sqlite3, threading
import send2trash
from security import guard, readonly, check_name, Denied, HERE

TAGS = os.path.join(HERE, "tags.json")
LOG = os.path.join(HERE, "actions.log")
CACHE = os.path.join(HERE, "cache", "thumbs")
_lock = threading.Lock()

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
    return EXT.get(os.path.splitext(name)[1].lower().lstrip("."), "other")


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
    return _tags()["files"].get(os.path.normcase(path), [])


def prune_tags():
    """Forget tags of files that are gone, and tag names no file uses any more. A file whose folder can't be
    reached right now (a cloud drive not mounted) keeps its tags."""
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
        key = os.path.normcase(rp)
        if names: t["files"][key] = names
        else: t["files"].pop(key, None)
        _save_tags(t)
    return names


def _move_tags(src, dst):
    with _lock:
        t = _tags(); s, d = os.path.normcase(src), os.path.normcase(dst)
        moved = {}
        for k, v in list(t["files"].items()):
            if k == s or k.startswith(s + "\\"):
                moved[d + k[len(s):]] = v; t["files"].pop(k)
        t["files"].update(moved); _save_tags(t)


# ---- reading -------------------------------------------------------------------------------
def listdir(path):
    rp = guard(path)
    if not os.path.isdir(rp): raise Denied("not a folder")
    t = _tags()["files"]
    out = []
    with os.scandir(rp) as it:
        for e in it:
            try:
                st = e.stat(follow_symlinks=False)
                a = getattr(st, "st_file_attributes", 0)
                if a & 0x2 or a & 0x4 or e.name.lower() in ("desktop.ini", "thumbs.db") or e.name.startswith("~$"):
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
    with open(rp, "rb") as f: b = f.read(limit + 1)
    return {"text": b[:limit].decode("utf-8", errors="replace"), "truncated": len(b) > limit}


def thumb(path, size=320):
    rp = guard(path)
    st = os.stat(rp)
    if st.st_size > 80_000_000: raise Denied("too large to preview")
    os.makedirs(CACHE, exist_ok=True)
    key = hashlib.sha1(f"{rp}|{st.st_mtime}|{st.st_size}|{size}".encode()).hexdigest()
    out = os.path.join(CACHE, key + ".jpg")
    if not os.path.exists(out):
        from PIL import Image, ImageOps
        try:
            import pillow_heif; pillow_heif.register_heif_opener()      # iPhone photos (HEIC)
        except ImportError:
            pass
        with Image.open(rp) as im:
            im = ImageOps.exif_transpose(im); im.thumbnail((size, size))
            if im.mode not in ("RGB", "L"): im = im.convert("RGB")
            im.save(out, "JPEG", quality=82)
    return out


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
def _unique(dst):
    if not os.path.exists(dst): return dst
    base, ext = os.path.splitext(dst); i = 2
    while os.path.exists(f"{base} ({i}){ext}"): i += 1
    return f"{base} ({i}){ext}"


def rename(path, new_name, device):
    rp = guard(path, write=True); check_name(new_name)
    dst = os.path.join(os.path.dirname(rp), new_name)
    guard(dst, write=True)
    if os.path.exists(dst) and os.path.normcase(dst) != os.path.normcase(rp): raise Denied("a file with that name is already there")
    os.rename(rp, dst); _move_tags(rp, dst); log(device, "rename", [rp, dst])
    return dst


def mkdir(parent, name, device):
    rp = guard(parent); guard(os.path.join(rp, "x"), write=True); check_name(name)
    dst = _unique(os.path.join(rp, name)); os.mkdir(dst); log(device, "mkdir", dst)
    return dst


def paste(items, dest, mode, device):
    if mode not in ("copy", "move") or not isinstance(items, list) or not 0 < len(items) <= 500: raise Denied("nothing to paste")
    dd = guard(dest)
    if not os.path.isdir(dd): raise Denied("not a folder")
    guard(os.path.join(dd, "x"), write=True)
    done = []
    for p in items:
        src = guard(p, write=(mode == "move"))
        if os.path.normcase(dd) == os.path.normcase(src) or os.path.normcase(dd).startswith(os.path.normcase(src) + "\\"):
            raise Denied("a folder cannot go inside itself")
        dst = os.path.join(dd, os.path.basename(src))
        if mode == "move" and os.path.normcase(os.path.dirname(src)) == os.path.normcase(dd):
            continue
        dst = _unique(dst)
        if mode == "copy":
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
        send2trash.send2trash(p)                       # Recycle Bin, Google Drive for desktop included
    log(device, "delete", paths)
    return len(paths)


def open_on_pc(path, device):
    rp = guard(path); os.startfile(rp); log(device, "open", rp)
