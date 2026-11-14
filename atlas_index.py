# atlas_index.py: read-only inventory of every file Atlas can show.
# Reads names, sizes, dates and attributes from directory listings only. No file is
# opened, so cloud-only files in Google Drive and OneDrive are never downloaded.
# Output: index.db (SQLite), index.log, summary.json, all in this folder.
# On the server (mode "cloud") the same listing comes from rclone, one recursive listing per top folder.
import os, re, sqlite3, time, json
import config as cfg
W = cfg.W

HERE = cfg.HERE
DB, TMP = os.path.join(HERE, "index.db"), os.path.join(HERE, "index.tmp.db")
LOG = os.path.join(HERE, "index.log")

ROOTS = [tuple(r) for r in cfg.C["index"]]                       # (source id, folder), from atlas.config.json
SKIP_PATHS = {W.normcase(p) for p in cfg.C.get("index_skip", []) + cfg.C.get("blocked", [])}
SKIP_DIRS = {"node_modules", "__pycache__", "$recycle.bin", "system volume information", "venv"}
SKIP_FILE = re.compile(r"^(desktop\.ini|thumbs\.db|~\$.*|\.~lock.*|.*\.tmp)$", re.I)
_dn = (cfg.C.get("doc_numbers") or {}).get("pattern")
DOCNUM = re.compile(_dn) if _dn else re.compile(r"(?!)")       # document numbers, if your files carry them
REV = re.compile(r"(?:^|[ _.\-])Rev[ _\-]?([A-Z]{1,2})(?![a-z])")
CLOUD = 0x400000 | 0x40000 | 0x1000   # recall on data access, recall on open, offline

KINDS = {
    "doc": "pdf docx doc md txt rtf odt pages tex",
    "sheet": "xlsx xls xlsm csv tsv numbers ods",
    "slides": "pptx ppt key odp",
    "gnative": "gdoc gsheet gslides gform gdraw gmap gsite gjam",
    "image": "jpg jpeg png gif heic tif tiff bmp webp svg psd ai raw cr2 cr3 nef arw dng",
    "video": "mp4 mov avi mkv m4v wmv webm",
    "audio": "mp3 wav m4a flac aac ogg",
    "cad3d": "blend glb gltf fbx obj stl step stp dwg dxf rvt rfa 3dm skp ifc usd usdz dae 3mf",
    "code": "py js ts yaml yml json html css ps1 sh ino c cpp h ipynb vbs bat",
    "archive": "zip rar 7z tar gz",
    "mail": "eml msg",
}
EXT2KIND = {e: k for k, v in KINDS.items() for e in v.split()}

def log(m):
    with open(LOG, "a", encoding="utf-8") as f:
        f.write(time.strftime("%Y-%m-%dT%H:%M:%S  ") + m + "\n")

def files(root):
    """(path, name, size, mtime, attributes) for every file under root; (None, (path, error)) when a folder fails."""
    if cfg.CLOUD:
        yield from _cloud_files(root); return
    for e, st in walk(root):
        if e is None: yield None, st
        else: yield e.path, e.name, st.st_size, st.st_mtime, getattr(st, "st_file_attributes", 0)


def _cloud_files(root):
    import rfs
    skip = [W.normcase(s) for s in SKIP_PATHS if W.normcase(s).startswith(W.normcase(root) + "\\")]
    extra = ["--exclude", ".*/**", "--exclude", "{" + ",".join(sorted(SKIP_DIRS)) + "}/**"]
    for s in skip:
        extra += ["--exclude", "/" + s[len(W.normcase(root)) + 1:].replace("\\", "/") + "/**"]
    try:
        items = rfs.lsjson(root, recursive=True, files_only=True, extra=["--ignore-case"] + extra, timeout=4 * 3600)
    except Exception as x:
        yield None, (root, str(x)[:300]); return
    for e in items:
        if e["dir"]: continue
        parts = e["rel"].split("\\")
        name = parts[-1]
        if any(p.startswith(".") or p.lower() in SKIP_DIRS for p in parts[:-1]): continue
        if name.startswith(".") or SKIP_FILE.match(name): continue
        path = W.join(root, e["rel"])
        if any(W.normcase(path).startswith(s + "\\") for s in skip): continue
        yield path, name, e["size"], e["mtime"], 0


def walk(root):
    stack = [root]
    while stack:
        d = stack.pop()
        try:
            with os.scandir(d) as it:
                for e in it:
                    n = e.name
                    try:
                        if e.is_symlink() or e.is_junction():
                            continue
                        if e.is_dir(follow_symlinks=False):
                            if n.startswith(".") or n.lower() in SKIP_DIRS or os.path.normcase(e.path) in SKIP_PATHS:
                                continue
                            stack.append(e.path)
                        elif not n.startswith(".") and not SKIP_FILE.match(n):
                            yield e, e.stat(follow_symlinks=False)
                    except OSError as x:
                        yield None, (e.path, str(x))
        except OSError as x:
            yield None, (d, str(x))

def _reachable(root):
    if not cfg.CLOUD: return os.path.isdir(root)
    import rfs
    try: rfs.remote(root); return True
    except rfs.Missing:                      # a source like the user folder: reachable when folders inside it are
        r = W.normcase(W.normpath(root)).rstrip("\\")
        return any(p.startswith(r + "\\") for p in rfs.roots())


def main():
    t0 = time.time()
    if os.path.exists(TMP): os.remove(TMP)
    db = sqlite3.connect(TMP)
    db.executescript("""
      CREATE TABLE files(id INTEGER PRIMARY KEY, root TEXT, path TEXT, rel TEXT, name TEXT, ext TEXT,
        kind TEXT, size INTEGER, mtime REAL, attrs INTEGER, cloud INTEGER, docnum TEXT, doccat TEXT, rev TEXT);
      CREATE TABLE errors(path TEXT, msg TEXT);
      CREATE TABLE roots(root TEXT, path TEXT, files INTEGER, bytes INTEGER, seconds REAL);""")
    log("start")
    for tag, root in ROOTS:
        if not _reachable(root):
            log(f"missing root {root}"); continue
        t1, n, b, rows = time.time(), 0, 0, []
        for f in files(root):
            if f[0] is None:
                db.execute("INSERT INTO errors VALUES(?,?)", f[1]); continue
            path, name, size, mtime, a = f
            ext = W.splitext(name)[1].lower().lstrip(".")
            m, r = DOCNUM.search(name), REV.search(name)
            rows.append((tag, path, W.relpath(path, root), name, ext, EXT2KIND.get(ext, "other"),
                         size, mtime, a, 1 if a & CLOUD else 0,
                         m.group(0) if m else None, m.group(1) if m else None, r.group(1) if r else None))
            n += 1; b += size
            if len(rows) >= 2000:
                db.executemany("INSERT INTO files VALUES(NULL,?,?,?,?,?,?,?,?,?,?,?,?,?)", rows); rows = []
            if n % 20000 == 0: log(f"{tag} {n} files")
        db.executemany("INSERT INTO files VALUES(NULL,?,?,?,?,?,?,?,?,?,?,?,?,?)", rows)
        db.execute("INSERT INTO roots VALUES(?,?,?,?,?)", (tag, root, n, b, round(time.time() - t1, 1)))
        db.commit(); log(f"done {tag} {root}: {n} files, {b/1e9:.2f} GB, {time.time()-t1:.0f} s")
    db.executescript("CREATE INDEX i_name ON files(name); CREATE INDEX i_doc ON files(docnum);")
    q = lambda s: db.execute(s).fetchall()
    summary = {
        "seconds": round(time.time() - t0),
        "roots": q("SELECT root, path, files, round(bytes/1e9,2), seconds FROM roots"),
        "kinds": q("SELECT kind, count(*), round(sum(size)/1e9,2) FROM files GROUP BY kind ORDER BY 2 DESC"),
        "cloud_only": q("SELECT root, sum(cloud), count(*) FROM files GROUP BY root"),
        "doc_numbered": q("SELECT root, count(*) FROM files WHERE docnum IS NOT NULL GROUP BY root"),
        "doc_categories": q("SELECT doccat, count(DISTINCT docnum), count(*) FROM files WHERE docnum IS NOT NULL GROUP BY doccat"),
        "errors": q("SELECT count(*) FROM errors")[0][0],
    }
    db.close()
    if os.path.exists(DB): os.remove(DB)
    os.replace(TMP, DB)
    with open(os.path.join(HERE, "summary.json"), "w", encoding="utf-8") as f: json.dump(summary, f, indent=1)
    log(f"finished in {summary['seconds']} s"); print(json.dumps(summary))

if __name__ == "__main__":
    main()
