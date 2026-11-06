# build_view.py: keeps the Atlas folder (view_folder in atlas.config.json) in step with the classifier.
# Everything in Atlas is a link to an original, or a plain folder that holds links.
# It only ever removes links it made itself (listed in manifest.json) and empty folders of its own.
import os, json, re, sqlite3, time
import config as cfg

HERE = cfg.HERE
DB, MAN, LOG = (os.path.join(HERE, f) for f in ("index.db", "manifest.json", "service.log"))
VIEW = cfg.VIEW
BAD = re.compile(r'[<>:"/\\|?*\x00-\x1f]')

def log(m):
    with open(LOG, "a", encoding="utf-8") as f: f.write(time.strftime("%Y-%m-%dT%H:%M:%S  build  ") + m + "\n")

def safe(name):
    return BAD.sub("_", name).rstrip(" .") or "_"

def desired_links(folders):
    """link path -> (target, is_dir)."""
    want, db = {}, sqlite3.connect(DB)
    for f in folders:
        if f["state"] == "skip" or f.get("offline"): continue
        if f["kind"] == "tree":
            want[os.path.join(VIEW, f["state"], f["category"])] = (f["source"], True); continue
        place = os.path.join(VIEW, f["state"], safe(f["category"]), safe(f["name"]))
        if f["kind"] == "loose":
            base = f["source"][:-7]
            for (p,) in db.execute("SELECT path FROM files WHERE path LIKE ? || '%'", (base + "\\",)):
                if os.path.dirname(p).lower() == base.lower():
                    want[os.path.join(place, safe(os.path.basename(p)))] = (p, False)
        else:
            want[place] = (f["source"], True)
    db.close()
    return want

def build(folders, missing_roots_paths=()):
    os.makedirs(VIEW, exist_ok=True)
    man = {}
    if os.path.exists(MAN):
        try: man = json.load(open(MAN, encoding="utf-8"))
        except Exception: man = {}
    want = desired_links(folders)
    # keep links into a source that is offline right now
    for link, (target, isdir) in man.items():
        if link not in want and any(target.lower().startswith(m.lower()) for m in missing_roots_paths):
            want[link] = (target, isdir)
    removed = made = 0
    for link, (target, isdir) in list(man.items()):
        if want.get(link, (None,))[0] == target: continue
        if os.path.islink(link):
            try:
                (os.rmdir if isdir else os.unlink)(link); removed += 1
            except OSError as e: log(f"could not remove {link}: {e}")
        man.pop(link, None)
    for link, (target, isdir) in want.items():
        if link in man and os.path.islink(link): continue
        if os.path.lexists(link):
            if os.path.islink(link) and os.readlink(link).lower().lstrip("\\?").lower().endswith(target.lower().lstrip("\\?")):
                man[link] = (target, isdir); continue
            log(f"name taken, skipped: {link}"); continue
        os.makedirs(os.path.dirname(link), exist_ok=True)
        try:
            os.symlink(target, link, target_is_directory=isdir); man[link] = (target, isdir); made += 1
        except OSError as e: log(f"could not link {link} -> {target}: {e}")
    # tidy: empty plain folders of our own, deepest first; never a link, never anything with content
    for d, subdirs, files in sorted(os.walk(VIEW, followlinks=False), key=lambda x: -x[0].count("\\")):
        if d == VIEW or os.path.islink(d): continue
        try:
            if not os.listdir(d): os.rmdir(d)
        except OSError: pass
    json.dump(man, open(MAN, "w", encoding="utf-8"), indent=0)
    log(f"{made} links made, {removed} removed, {len(man)} in place")
    return {"made": made, "removed": removed, "links": len(man)}
