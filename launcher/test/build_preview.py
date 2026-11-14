# build_preview.py: an interactive preview of the launcher that runs in any browser, phone included, with no phone
# and no Atlas server: the launcher page and Atlas's own page side by side in a phone frame, with Back and Home
# buttons, sample apps (letter icons) and the demo's invented folders and files. Publish the folder as a static site.
#   python docs/demo/demo_server.py &
#   python launcher/test/build_preview.py OUT_DIR [rules.json]
import json, os, re, shutil, sys, time, urllib.parse, urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
LAUNCHER = os.path.dirname(HERE)
ATLAS = os.path.dirname(LAUNCHER)
OUT = os.path.abspath(sys.argv[1])
RULES = sys.argv[2] if len(sys.argv) > 2 else os.path.join(LAUNCHER, "rules.example.json")
DEMO = os.environ.get("ATLAS_DEMO", "http://127.0.0.1:8799")

def get(path, binary=False):
    with urllib.request.urlopen(DEMO + path, timeout=30) as r:
        b = r.read()
    return b if binary else json.loads(b)

def write(rel, data):
    p = os.path.join(OUT, rel); os.makedirs(os.path.dirname(p), exist_ok=True)
    with open(p, "wb" if isinstance(data, bytes) else "w", **({} if isinstance(data, bytes) else {"encoding": "utf-8"})) as f: f.write(data)

def copy(src, rel):
    p = os.path.join(OUT, rel); os.makedirs(os.path.dirname(p), exist_ok=True); shutil.copyfile(src, p)

def patch(text, pairs, name):
    for old, new, n in pairs:
        if text.count(old) != n: sys.exit(f"{name}: expected {n} of {old!r}, found {text.count(old)}")
        text = text.replace(old, new)
    return text

# ---- the shell and the launcher page ---------------------------------------------------------------------------------
copy(os.path.join(HERE, "preview-shell.html"), "index.html")
# IBM Plex from Google Fonts: the preview ships no font files of its own.
PLEX = '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500;600;700&family=IBM+Plex+Sans:wght@300;400;500;600;700&display=swap">'
drop_faces = lambda css: re.sub(r"@font-face\s*\{[^}]*\}\s*", "", css)
write("launcher.css", drop_faces(open(os.path.join(LAUNCHER, "web", "launcher.css"), encoding="utf-8").read()))
html = open(os.path.join(LAUNCHER, "web", "index.html"), encoding="utf-8").read()
write("launcher.html", patch(html, [('<script src="launcher.js"></script>', '<script src="preview-bridge.js"></script><script src="launcher.js"></script>', 1),
                                    ('<link rel="stylesheet" href="launcher.css">', PLEX + '\n<link rel="stylesheet" href="launcher.css">', 1)], "launcher"))
copy(os.path.join(LAUNCHER, "web", "launcher.js"), "launcher.js")
copy(os.path.join(HERE, "preview-bridge.js"), "preview-bridge.js")
copy(RULES, "rules.json")

# ---- Atlas's own page, with its server answered in the page --------------------------------------------------------------
m = open(os.path.join(ATLAS, "map.html"), encoding="utf-8").read()
m = patch(m, [("<head>\n", '<head>\n<script src="preview-atlas.js"></script>\n', 1),
              ('<link rel="manifest" href="/manifest.webmanifest">\n', "", 1),
              ('if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js").catch(() => {});', "", 1)], "map.html")
m = m.replace('href="/static/', 'href="static/').replace('src="/static/', 'src="static/')
m = drop_faces(m).replace('<link rel="stylesheet" href="static/app/files.css', PLEX + '\n<link rel="stylesheet" href="static/app/files.css', 1)
write("atlas.html", m)
copy(os.path.join(HERE, "preview-atlas.js"), "preview-atlas.js")
js = open(os.path.join(ATLAS, "static", "app", "files.js"), encoding="utf-8").read()
js = patch(js, [
    ('const fileUrl = (p, dl) => "/api/file?" + new URLSearchParams({ path: p, ...(dl ? { dl: "1" } : {}) });', "const fileUrl = (p, dl) => PV_FILE(p, dl);", 1),
    ("/api/thumb?${new URLSearchParams(", "${PV_THUMB(", 3),
    ('import("/static/vendor/pdfjs/pdf.min.mjs")', 'import(new URL("static/vendor/pdfjs/pdf.min.mjs", document.baseURI).href)', 1),
    ('"/static/vendor/pdfjs/pdf.worker.min.mjs"', 'new URL("static/vendor/pdfjs/pdf.worker.min.mjs", document.baseURI).href', 1),
    ('"/static/vendor/three/three.min.js"', '"static/vendor/three/three.min.js"', 1),
    ("`/static/vendor/three/${f}.js`", "`static/vendor/three/${f}.js`", 1),
], "files.js")
js += '''
// The preview carries no PDF or 3D viewer (Atlas's own, in the app, shows them).
pdfView = async el => { el.innerHTML = `<p class="note">PDF pages show in the app. The preview has no PDF viewer.</p>`; };
modelView = async el => { el.innerHTML = `<p class="note">3D models turn and zoom in the app. The preview has no 3D viewer.</p>`; };
'''
write("static/app/files.js", js)
copy(os.path.join(ATLAS, "static", "app", "files.css"), "static/app/files.css")

# ---- invented data: the demo's map, and every folder on it filled with the demo's sample files ---------------------------------
rules = json.load(open(RULES, encoding="utf-8"))
mp = get("/map.json")
cats = [v for k, v in rules.get("categories", {}).items() if k != rules.get("unsorted", "U")]
if cats: mp["categories"] = cats + ["Unsorted"]            # the apps are sorted into these
write("data/map.json", json.dumps(mp))

HL = r"G:\My Drive\Harbor Library"
index, n = {}, 0
def stash(path, kind):
    """Images and text only: PDFs and 3D models are listed but carry no content in the preview."""
    global n
    if kind not in ("image", "text"): return
    n += 1; ext = path.rsplit(".", 1)[-1].lower(); q = urllib.parse.urlencode({"path": path})
    rec = {"file": f"files/f{n}.{ext}", "kind": kind}
    raw = get("/api/file?" + q, True); write(rec["file"], raw)
    if kind == "image":
        from PIL import Image
        import io
        for key, size in (("thumb", 320), ("big", 1600)):
            im = Image.open(io.BytesIO(raw)); im.thumbnail((size, size)); b = io.BytesIO(); im.convert("RGB").save(b, "JPEG", quality=84)
            rec[key] = f"files/f{n}-{size}.jpg"; write(rec[key], b.getvalue())
    index[path] = rec

listings, SIZES = {}, {}
for p in (HL, HL + r"\Site photos"):
    l = get("/api/ls?" + urllib.parse.urlencode({"path": p})); listings[p] = l
    for e in l["entries"]:
        if not e["dir"]: stash(e["path"], e["kind"]); SIZES[e["path"]] = e["size"]
samples = [("Overview.pdf", HL + r"\Harbor Library - concept report.pdf", "pdf"), ("Photo 01.jpg", HL + r"\Facade study.jpg", "image"),
           ("Photo 02.jpg", HL + r"\Reading room.jpg", "image"), ("Notes.txt", HL + r"\Notes.txt", "text"),
           ("Model.stl", HL + r"\Massing model.stl", "model"), ("Figures.csv", HL + r"\Program areas.csv", "text")]
now = int(time.time())
def fill(path, subs, k):
    if path in listings: return
    h = sum(map(ord, path))
    entries = [{"name": s, "path": path + "\\" + s, "dir": True, "size": 0, "mtime": now - 86400 * (i + 2), "kind": "folder", "cloud": False, "tags": []}
               for i, s in enumerate(subs)]
    for i in range(k):
        name, src, kind = samples[(h + i) % len(samples)]
        fp = path + "\\" + name
        if any(e["path"] == fp for e in entries): continue
        if src in index: index[fp] = index[src]
        entries.append({"name": name, "path": fp, "dir": False, "size": SIZES.get(src, 0),
                        "mtime": now - 3600 * ((h + i) % 200), "kind": kind, "cloud": False, "tags": []})
    entries.sort(key=lambda e: (not e["dir"], e["name"].lower()))
    listings[path] = {"path": path, "readonly": False, "entries": entries, "parent": path.rsplit("\\", 1)[0]}
for f in mp["folders"]:
    if f["state"] == "skip": continue
    base = f["source"][:-7] if f["kind"] == "loose" else f["source"]
    kids = [c for c in f.get("children", []) if not c["name"].startswith("(")]
    if base in listings:                                    # the demo's own folder keeps its files and gains the map's subfolders
        have = {e["name"] for e in listings[base]["entries"]}
        listings[base]["entries"] = [{"name": c["name"], "path": base + "\\" + c["name"], "dir": True, "size": 0, "mtime": now - 86400, "kind": "folder",
                                      "cloud": False, "tags": []} for c in kids if c["name"] not in have] + listings[base]["entries"]
    else: fill(base, [c["name"] for c in kids], 4)
    for c in kids:
        sub = [k["name"] for k in c.get("kids", []) if not k["name"].startswith("(")]
        fill(base + "\\" + c["name"], sub, 3)
        for s in sub: fill(base + "\\" + c["name"] + "\\" + s, [], 2)
write("data/listings.json", json.dumps(listings))
write("data/files.json", json.dumps(index))
total = sum(os.path.getsize(os.path.join(dp, f)) for dp, _, fs in os.walk(OUT) for f in fs)
print(f"{len(listings)} folders, {len(index)} file paths, {sum(len(fs) for _, _, fs in os.walk(OUT))} files, {total / 1e6:.1f} MB in {OUT}")
