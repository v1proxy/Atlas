# demo_server.py: runs the real Atlas page against invented data, for screenshots and trying the interface.
# Nothing here reads your files. Every folder, file, tag and device is made up (a fictional architect, Alex Rivera).
#   python docs/demo/demo_server.py      then open http://127.0.0.1:8799
import hashlib, io, json, math, os, random, sys, time
from http.server import ThreadingHTTPServer, BaseHTTPRequestHandler
from urllib.parse import urlsplit, parse_qs

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
PORT = int(os.environ.get("ATLAS_DEMO_PORT", "8799"))
random.seed(7)

# ---- the invented person ---------------------------------------------------------------------------------
H = r"C:\Users\alex"
SOURCES = {"gdrive": ("Google Drive", "Drive", r"G:\My Drive"), "onedrive": ("OneDrive", "OneDrive", H + r"\OneDrive"),
           "local": ("this PC", "PC", H), "backup": ("Old laptop backup (Drive)", "Laptop", r"G:\Other computers\Old laptop"),
           "studio": ("Studio share", "Studio", H + r"\Studio\Shared")}
CATS = ["01 Work", "02 Projects", "03 Learning", "04 Home", "05 Personal", "06 References", "Unsorted"]
TREE_CAT = "00 Studio share"
WHY = {"name": "known folder name", "kw": "keywords: {}", "fixed": "{}", "old": "{}; old laptop backup, unchanged for 2 years",
       "dup": "{}; {}% are copies of newer files"}

F = []  # folders
def folder(state, cat, leaf, root, files, gb, days, how="auto", why=None, kind="dir", dup=0, parent=None):
    label, tag, base = SOURCES[root]
    src = (parent or base) + "\\" + leaf
    newest = time.strftime("%Y-%m-%d", time.localtime(time.time() - days * 86400))
    F.append({"id": "f" + hashlib.sha1(src.encode()).hexdigest()[:10], "source": src + ("\\|files" if kind == "loose" else ""),
              "kind": kind, "root": root, "name": f"{leaf} ({tag})" if kind == "dir" else f"{leaf} loose files ({tag})",
              "state": state, "category": cat, "why": why or WHY["name"], "how": how, "files": files, "gb": gb, "dup": dup,
              "newest": newest, "top_kind": "doc", "readonly": root in ("backup", "studio"),
              "link": H + "\\Atlas\\" + state + "\\" + cat + "\\" + leaf + f" ({tag})"})

C, S_, W = "Current", "Superseded", "Working"
for cat, rows in {
    "01 Work": [("Clients 2026", "gdrive", 1840, 38.2, 2), ("Invoices", "gdrive", 412, 0.9, 6), ("Proposals", "onedrive", 230, 3.1, 11),
                ("Contracts", "gdrive", 96, 0.4, 40), ("Meeting notes", "onedrive", 310, 0.2, 1)],
    "02 Projects": [("Harbor Library", "gdrive", 2210, 64.5, 0), ("Riverside Pavilion", "gdrive", 1630, 41.2, 9),
                    ("Lakeview Housing", "onedrive", 980, 22.7, 25), ("Furniture line", "local", 540, 12.4, 70),
                    ("Civic Hall competition", "gdrive", 720, 18.9, 150)],
    "03 Learning": [("Courses", "gdrive", 860, 15.2, 33), ("Workshop slides", "onedrive", 140, 2.3, 200), ("Reading notes", "local", 210, 0.3, 4)],
    "04 Home": [("Kitchen renovation", "local", 320, 6.8, 14), ("Garden plans", "gdrive", 88, 1.2, 120), ("Home server", "local", 1450, 3.3, 3)],
    "05 Personal": [("Photos 2026", "gdrive", 4300, 52.1, 1), ("Travel - Lisbon", "gdrive", 620, 9.8, 300), ("Taxes", "onedrive", 140, 0.6, 210),
                    ("Music", "local", 2100, 14.6, 500)],
    "06 References": [("Material samples", "gdrive", 540, 7.9, 60), ("Manuals", "local", 160, 1.1, 420), ("Fonts", "local", 420, 0.8, 380),
                      ("Textures", "gdrive", 1300, 21.4, 95)],
}.items():
    for leaf, root, n, gb, days in rows:
        kw = {"Harbor Library": "library, concept, facade", "Riverside Pavilion": "pavilion, concept", "Lakeview Housing": "housing, plans",
              "Kitchen renovation": "kitchen, renovation", "Material samples": "samples, datasheets"}.get(leaf)
        folder(C, cat, leaf, root, n, gb, days, why=WHY["kw"].format(kw) if kw else None)
folder(C, "05 Personal", "Photos 2025", "gdrive", 3900, 47.5, 330, how="you", why="moved by you on the map")
for leaf, cat, n, gb, dup in (("Old portfolio", "02 Projects", 1200, 18.3, 78), ("Thesis models", "02 Projects", 640, 11.2, 12),
                              ("Competition 2019", "02 Projects", 410, 7.4, 64), ("University", "03 Learning", 3200, 28.9, 8),
                              ("Photos 2018", "05 Personal", 5200, 44.0, 71), ("Phone backup 2020", "05 Personal", 2400, 16.3, 55),
                              ("Old libraries", "06 References", 890, 9.6, 30), ("Misc", "Unsorted", 1300, 6.7, 20)):
    why = WHY["dup"].format("known folder name", dup) if dup >= 50 else WHY["old"].format("known folder name")
    folder(S_, cat, leaf, "backup", n, gb, 900 + n % 300, why=why, dup=dup)
folder(W, "Unsorted", "Desktop", "local", 140, 2.1, 0, how="fixed", why="Desktop is work in progress")
folder(W, "Unsorted", "Downloads", "local", 690, 12.8, 0, how="fixed", why="Downloads is work in progress")
folder(W, "Unsorted", "My Drive", "gdrive", 45, 0.4, 5, kind="loose", why="files loose at the top of the folder", parent=r"G:")
folder(W, "02 Projects", "Sketches", "onedrive", 230, 1.9, 2, why=WHY["kw"].format("sketch, concept"))
for state, kids in ((C, ["01 Admin", "02 Clients", "03 Projects", "04 Library", "05 Templates"]), (S_, ["Archive 2023", "Archive 2024"]),
                    (W, ["Inbox", "Review"])):
    src = SOURCES["studio"][2] + "\\" + state
    F.append({"id": "t" + state, "source": src, "kind": "tree", "root": "studio", "name": "Studio share", "state": state,
              "category": TREE_CAT, "why": "the studio's shared tree, linked as is", "how": "fixed", "readonly": True,
              "files": 0, "gb": 0, "dup": 0, "newest": "", "top_kind": "doc", "link": H + "\\Atlas\\" + state + "\\" + TREE_CAT,
              "children": [{"name": k, "files": random.randint(80, 2400), "gb": round(random.uniform(0.4, 26), 2),
                            "newest": time.strftime("%Y-%m-%d", time.localtime(time.time() - random.randint(0, 400) * 86400))} for k in kids]})
for f in F:
    if f["kind"] == "tree":
        f["files"] = sum(c["files"] for c in f["children"]); f["gb"] = round(sum(c["gb"] for c in f["children"]), 2)
        f["newest"] = max(c["newest"] for c in f["children"])
# Invented subfolders, two levels down, so the treemap has detail to show when you zoom in
SUBS = ["Drawings", "Renders", "Photos", "Models", "Notes", "Exports", "Admin", "Correspondence", "Site visits", "Presentations",
        "Reference", "Archive", "Specs", "Budget", "Sketches", "Video"]
def split(total, n):
    w = [random.random() ** 2 + 0.02 for _ in range(n)]; s = sum(w)
    return [total * x / s for x in w]
def day(f): return time.strftime("%Y-%m-%d", time.localtime(time.time() - random.randint(0, 400) * 86400))
for f in F:
    if f["kind"] == "loose": continue
    if f["kind"] == "tree":
        for c in f["children"]:
            names = random.sample(SUBS, 6)
            c["kids"] = [{"name": n, "files": max(1, round(c["files"] * g / c["gb"])), "gb": round(g, 2), "newest": day(f)}
                         for n, g in zip(names, split(c["gb"], 6))]
        continue
    n = random.randint(4, 14); names = random.sample(SUBS, n - 1) + ["(files at the top)"]
    kids = []
    for name, g in zip(names, split(f["gb"], n)):
        k = {"name": name, "files": max(1, round(f["files"] * g / max(f["gb"], 0.01))), "gb": round(g, 2), "newest": day(f)}
        if g > f["gb"] * 0.12 and not name.startswith("("):
            m = random.randint(3, 9)
            k["kids"] = [{"name": s, "files": max(1, round(k["files"] * h / max(g, 0.01))), "gb": round(h, 2), "newest": day(f)}
                         for s, h in zip(random.sample(SUBS, m - 1) + ["(files here)"], split(g, m))]
        kids.append(k)
    f["children"] = sorted(kids, key=lambda k: -k["gb"])
MAP = {"generated": time.strftime("%Y-%m-%dT%H:%M:%S"), "view_root": H + "\\Atlas", "every_min": 10, "missing": [],
       "total_files": sum(f["files"] for f in F) + 12000, "total_gb": round(sum(f["gb"] for f in F) + 40, 1),
       "states": [C, S_, W], "categories": CATS,
       "ui": {"tree_label": "Studio share", "tree_legend": "Studio share, linked as is",
              "tree_note": "Part of the studio's shared drive. Linked as is and never rearranged.",
              "tree_readonly_note": "Read only here: the studio share is never changed from Atlas.",
              "sources": {k: v[0] for k, v in SOURCES.items()}},
       "folders": F}

# ---- invented files ----------------------------------------------------------------------------------------
from PIL import Image, ImageDraw, ImageFont, ImageFilter
FONT = "/usr/share/fonts/opentype/inter/Inter-Regular.otf"
BOLD = "/usr/share/fonts/opentype/inter/Inter-SemiBold.otf"
def font(sz, bold=False):
    try: return ImageFont.truetype(BOLD if bold else FONT, sz)
    except Exception: return ImageFont.load_default()

def sky(w, h, top, bottom):
    im = Image.new("RGB", (w, h)); d = ImageDraw.Draw(im)
    for y in range(h):
        t = y / h; d.line([(0, y), (w, y)], fill=tuple(int(top[i] + (bottom[i] - top[i]) * t) for i in range(3)))
    return im

def facade(seed=1, w=1600, h=1066):
    r = random.Random(seed); im = sky(w, h, (120, 160, 200), (232, 214, 190)); d = ImageDraw.Draw(im)
    ground = int(h * .78); d.rectangle([0, ground, w, h], fill=(70, 74, 72))
    x = int(w * .12)
    for i in range(3):
        bw, bh = r.randint(300, 460), r.randint(320, 560); col = r.choice([(214, 206, 192), (178, 74, 58), (196, 190, 180)])
        d.rectangle([x, ground - bh, x + bw, ground], fill=col)
        for gx in range(x + 24, x + bw - 40, 56):
            for gy in range(ground - bh + 30, ground - 50, 70):
                d.rectangle([gx, gy, gx + 30, gy + 44], fill=(46, 58, 70))
        x += bw + r.randint(20, 80)
    d.polygon([(int(w * .62), ground - 200), (w, ground - 330), (w, ground), (int(w * .62), ground)], fill=(36, 40, 46))
    return im.filter(ImageFilter.GaussianBlur(.6))

def interior(w=1600, h=1066):
    im = sky(w, h, (60, 50, 44), (196, 170, 140)); d = ImageDraw.Draw(im)
    for i in range(9):
        x = 80 + i * 170; d.rectangle([x, 120, x + 120, 760], fill=(92, 70, 52))
        for y in range(150, 740, 46): d.rectangle([x + 8, y, x + 112, y + 34], fill=random.choice([(168, 64, 52), (220, 200, 160), (70, 90, 110), (200, 150, 70)]))
    d.rectangle([0, 800, w, h], fill=(150, 120, 92)); d.rectangle([520, 700, 1100, 760], fill=(64, 48, 38))
    d.ellipse([700, 20, 900, 120], fill=(255, 236, 196))
    return im.filter(ImageFilter.GaussianBlur(.8))

def site(seed):
    r = random.Random(seed); im = sky(1600, 1066, (r.randint(90, 140), r.randint(140, 180), 210), (230, 220, 200)); d = ImageDraw.Draw(im)
    d.rectangle([0, 700, 1600, 1066], fill=(r.randint(60, 90), r.randint(90, 120), r.randint(60, 80)))
    d.rectangle([0, 760, 1600, 840], fill=(80, 120, 150))
    for i in range(r.randint(3, 6)):
        x = r.randint(0, 1400); d.rectangle([x, 560 - r.randint(0, 200), x + r.randint(80, 220), 700], fill=(r.randint(150, 220),) * 3)
    return im.filter(ImageFilter.GaussianBlur(.8))

def report_pdf():
    pages = []
    for n, title in enumerate(("Concept report", "Site and program", "Massing options"), 1):
        p = Image.new("RGB", (1240, 1754), "white"); d = ImageDraw.Draw(p)
        d.rectangle([90, 90, 1150, 230], fill=(200, 54, 47))
        d.text((120, 118), "HARBOR LIBRARY", font=font(54, True), fill="white")
        d.text((120, 182), f"{title}   ·   page {n} of 3", font=font(28), fill="white")
        p.paste((facade(n) if n != 2 else site(9)).resize((1060, 600)), (90, 290))
        y = 940
        for k in range(14):
            d.rectangle([90, y, 1150 - (k % 4) * 160, y + 14], fill=(160, 160, 160)); y += 44
        d.text((90, 1640), "Alex Rivera Studio   ·   November 2026", font=font(24), fill=(120, 120, 120))
        pages.append(p)
    b = io.BytesIO(); pages[0].save(b, "PDF", save_all=True, append_images=pages[1:], resolution=150); return b.getvalue()

def massing_stl():
    tri = []
    def box(x0, y0, z0, x1, y1, z1):
        v = [(x0, y0, z0), (x1, y0, z0), (x1, y1, z0), (x0, y1, z0), (x0, y0, z1), (x1, y0, z1), (x1, y1, z1), (x0, y1, z1)]
        for a, b, c, d in [(0, 3, 2, 1), (4, 5, 6, 7), (0, 1, 5, 4), (1, 2, 6, 5), (2, 3, 7, 6), (3, 0, 4, 7)]:
            tri.extend([(v[a], v[b], v[c]), (v[a], v[c], v[d])])
    box(0, 0, 0, 60, 30, 8); box(0, 0, 8, 36, 30, 22); box(30, 6, 22, 66, 24, 30); box(44, 0, 0, 60, 12, 26)
    return ("solid massing\n" + "".join("facet normal 0 0 0\nouter loop\n" + "".join(f"vertex {x} {y} {z}\n" for x, y, z in t) + "endloop\nendfacet\n" for t in tri)
            + "endsolid massing\n").encode()

def jpg(im):
    b = io.BytesIO(); im.save(b, "JPEG", quality=86); return b.getvalue()

HL = r"G:\My Drive\Harbor Library"
NOW = int(time.time())
FILES = {  # path -> (bytes, tags)
    HL + r"\Harbor Library - concept report.pdf": (report_pdf(), ["Client review"]),
    HL + r"\Facade study.jpg": (jpg(facade(3)), []),
    HL + r"\Reading room.jpg": (jpg(interior()), ["Final"]),
    HL + r"\Massing model.stl": (massing_stl(), []),
    HL + r"\Program areas.csv": ("Space,Area m2\nReading room,640\nChildren's library,220\nStacks,410\nCafe,120\nOffices,180\n".encode(), []),
    HL + r"\Notes.txt": ("Harbor Library\n\nClient meeting, 4 Nov\n- Keep the reading room facing the water\n- Daylight study before the next review\n- Cost plan due 20 Nov\n".encode(), ["Urgent"]),
}
for i in range(1, 9): FILES[HL + rf"\Site photos\IMG_04{i:02d}.jpg"] = (jpg(site(i)), [])
DIRS = {HL: ["01 Brief", "02 Concept", "03 Design development", "Site photos"],
        HL + r"\Site photos": [], HL + r"\01 Brief": [], HL + r"\02 Concept": [], HL + r"\03 Design development": []}
KIND = {"jpg": "image", "png": "image", "pdf": "pdf", "stl": "model", "csv": "text", "txt": "text", "mp4": "video"}
TAGS = {"vocab": {"Client review": "teal", "Final": "green", "Urgent": "red"}}

def listing(path):
    out = [{"name": d, "path": path + "\\" + d, "dir": True, "size": 0, "mtime": NOW - 86400 * (i + 1), "kind": "folder", "cloud": False, "tags": []}
           for i, d in enumerate(DIRS.get(path, []))]
    for p, (b, tags) in FILES.items():
        if p.rsplit("\\", 1)[0] == path:
            n = p.rsplit("\\", 1)[1]
            out.append({"name": n, "path": p, "dir": False, "size": len(b), "mtime": NOW - 3600 * (len(n) % 9), "kind": KIND.get(n.rsplit(".", 1)[-1].lower(), "other"),
                        "cloud": False, "tags": tags})
    out.sort(key=lambda e: (not e["dir"], e["name"].lower()))
    return {"path": path, "readonly": False, "entries": out, "parent": path.rsplit("\\", 1)[0]}

def qr_svg():
    import qrcode, qrcode.image.svg
    b = io.BytesIO(); qrcode.make("https://alex-pc.tail0000.ts.net/pair?code=DEMO-NOT-A-REAL-CODE", image_factory=qrcode.image.svg.SvgPathImage, box_size=8, border=2).save(b)
    return b.getvalue().decode()

DEVICES = [{"id": "a1", "name": "This PC, Chrome", "kind": "pc", "created": "2026-10-02 09:14", "last": "2026-11-06 11:30"},
           {"id": "b2", "name": "Android phone", "kind": "phone", "created": "2026-10-02 09:20", "last": "2026-11-06 08:12"},
           {"id": "c3", "name": "iPad", "kind": "phone", "created": "2026-10-12 18:40", "last": "2026-11-01 21:05"}]
SETTINGS = {"tone": "red", "view": "treemap"}
LOCKED = open(os.path.join(ROOT, "atlas_service.py"), encoding="utf-8").read().split('LOCKED = """', 1)[1].split('"""', 1)[0].split("<script>")[0]


class Demo(BaseHTTPRequestHandler):
    def log_message(self, *a): pass
    def send(self, code, body, ctype="application/json", extra=None):
        b = body if isinstance(body, bytes) else (body if isinstance(body, str) else json.dumps(body)).encode()
        self.send_response(code); self.send_header("Content-Type", ctype); self.send_header("Content-Length", str(len(b)))
        self.send_header("Cache-Control", "no-store")
        for k, v in (extra or {}).items(): self.send_header(k, v)
        self.end_headers(); self.wfile.write(b)

    def do_GET(self):
        u = urlsplit(self.path); p, q = u.path, {k: v[0] for k, v in parse_qs(u.query).items()}
        if p in ("/", "/index.html"): return self.send(200, open(os.path.join(ROOT, "map.html"), "rb").read(), "text/html; charset=utf-8")
        if p == "/locked": return self.send(200, LOCKED.replace("{msg}", "To use a phone, pair it from Atlas on the PC: Devices, then Pair a phone."), "text/html; charset=utf-8")
        if p.startswith("/static/") or p in ("/sw.js", "/manifest.webmanifest"):
            rp = os.path.realpath(os.path.join(ROOT, "static", p[len("/static/"):] if p.startswith("/static/") else p[1:]))
            if not rp.startswith(os.path.join(ROOT, "static")) or not os.path.isfile(rp): return self.send(404, "not found", "text/plain")
            ct = {"js": "text/javascript", "mjs": "text/javascript", "css": "text/css", "woff2": "font/woff2", "png": "image/png",
                  "webmanifest": "application/manifest+json"}.get(rp.rsplit(".", 1)[-1], "application/octet-stream")
            return self.send(200, open(rp, "rb").read(), ct)
        if p == "/map.json": return self.send(200, MAP)
        if p == "/settings": return self.send(200, SETTINGS)
        if p == "/status": return self.send(200, {"running": False})
        if p == "/api/ls": return self.send(200, listing(q.get("path", "")))
        if p == "/api/tags": return self.send(200, {"vocab": TAGS["vocab"], "colors": list(TAGS["vocab"].values())})
        if p == "/api/devices": return self.send(200, {"devices": [{**d, "me": d["id"] == "a1"} for d in DEVICES], "local": True})
        if p == "/api/whoami": return self.send(200, {"name": "This PC, Chrome", "kind": "pc", "local": True})
        if p == "/api/find":
            s = q.get("q", "").lower()
            return self.send(200, {"results": [{"name": k.rsplit("\\", 1)[1], "path": k, "size": len(v[0])} for k, v in FILES.items() if s in k.lower()][:20]})
        if p == "/api/text":
            b = FILES.get(q.get("path"), (b"",))[0]; return self.send(200, {"text": b.decode("utf-8", "replace"), "truncated": False})
        if p in ("/api/file", "/api/thumb"):
            path = q.get("path", ""); b = FILES.get(path, (None,))[0]
            if b is None: return self.send(404, {"error": "not found"})
            ext = path.rsplit(".", 1)[-1].lower()
            if p == "/api/thumb":
                im = Image.open(io.BytesIO(b)); im.thumbnail((1600, 1600) if q.get("s") == "1600" else (320, 320)); return self.send(200, jpg(im), "image/jpeg")
            return self.send(200, b, {"jpg": "image/jpeg", "pdf": "application/pdf", "stl": "model/stl"}.get(ext, "text/plain"))
        self.send(404, {"error": "not found"})

    def do_POST(self):
        n = int(self.headers.get("Content-Length", "0") or 0); body = json.loads(self.rfile.read(n) or b"{}")
        p = urlsplit(self.path).path
        if p == "/settings": SETTINGS.update({k: v for k, v in body.items() if k in ("tone", "view")}); return self.send(200, {"ok": True})
        if p == "/api/pair": return self.send(200, {"url": "https://alex-pc.tail0000.ts.net/pair?code=DEMO-NOT-A-REAL-CODE", "svg": qr_svg(), "expires_days": 30})
        if p == "/api/tag":
            path = body.get("path"); TAGS["vocab"].update(body.get("colors") or {})
            if path in FILES: FILES[path] = (FILES[path][0], body.get("tags") or [])
            return self.send(200, {"tags": body.get("tags")})
        self.send(200, {"ok": True})


if __name__ == "__main__":
    print(f"Atlas demo with invented data: http://127.0.0.1:{PORT}")
    ThreadingHTTPServer(("127.0.0.1", PORT), Demo).serve_forever()
