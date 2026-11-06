# End-to-end test of Atlas in Chrome (headless): map, views, colors, find, file browser, previews, file actions, devices, phone layout.
# Works in its own folder in Downloads for anything that changes files; the user's own files are only opened for preview, never changed.
import json, os, sys, time, shutil, urllib.request
from playwright.sync_api import sync_playwright
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import security as sec, config as cfg

BASE = "http://127.0.0.1:8765"
HERE = os.path.dirname(os.path.abspath(__file__))
SHOTS = os.path.join(HERE, "shots"); os.makedirs(SHOTS, exist_ok=True)
T = os.path.join(os.path.expanduser("~"), "Downloads", "Atlas_selftest")
SAMPLES = json.load(open(os.path.join(HERE, "samples.json"), encoding="utf-8-sig"))
R = []
def check(name, ok, detail=""):
    R.append((name, bool(ok), str(detail)[:140])); print(("PASS" if ok else "FAIL"), name, ":", str(detail)[:140], flush=True)

def fixture():
    shutil.rmtree(T, ignore_errors=True); os.makedirs(os.path.join(T, "Inbox"))
    from PIL import Image, ImageDraw
    im = Image.new("RGB", (1200, 800), (12, 12, 12)); d = ImageDraw.Draw(im)
    for i, c in enumerate([(200, 54, 52), (160, 32, 34), (232, 120, 112), (122, 22, 24)]):
        d.rectangle([40 + i * 280, 120, 280 + i * 280, 680], fill=c)
    im.save(os.path.join(T, "Site photo.jpg"), quality=90)
    pages = []
    for n in (1, 2):
        p = Image.new("RGB", (850, 1100), "white"); dd = ImageDraw.Draw(p)
        dd.rectangle([60, 60, 790, 160], fill=(200, 54, 52)); dd.text((80, 95), f"ATLAS TEST DOCUMENT  page {n} of 2", fill="white")
        for k in range(18): dd.line([80, 220 + k * 40, 770 - (k % 4) * 90, 220 + k * 40], fill=(120, 120, 120), width=6)
        pages.append(p)
    pages[0].save(os.path.join(T, "Spec sheet.pdf"), save_all=True, append_images=pages[1:])
    tri = []
    def quad(a, b, c, d_): tri.extend([(a, b, c), (a, c, d_)])
    P = lambda x, y, z: f"{x} {y} {z}"
    # a stepped block, 3 x 2 x 1 with a riser
    for (x0, y0, z0, x1, y1, z1) in [(0, 0, 0, 3, 2, 1), (0, 0, 1, 1.2, 2, 2.2)]:
        v = [P(x0, y0, z0), P(x1, y0, z0), P(x1, y1, z0), P(x0, y1, z0), P(x0, y0, z1), P(x1, y0, z1), P(x1, y1, z1), P(x0, y1, z1)]
        for a, b, c, d_ in [(0, 3, 2, 1), (4, 5, 6, 7), (0, 1, 5, 4), (1, 2, 6, 5), (2, 3, 7, 6), (3, 0, 4, 7)]: quad(v[a], v[b], v[c], v[d_])
    open(os.path.join(T, "Bracket.stl"), "w").write("solid b\n" + "".join(f"facet normal 0 0 0\nouter loop\nvertex {a}\nvertex {b}\nvertex {c}\nendloop\nendfacet\n" for a, b, c in tri) + "endsolid b\n")
    open(os.path.join(T, "Readme.txt"), "w").write("Atlas test folder.\nMade by the end-to-end test and removed when it ends.\n")

def raw(path):
    with urllib.request.urlopen(urllib.request.Request(BASE + path, headers={"Cookie": COOKIE}), timeout=20) as r: return r.read()

fixture()
NEXT = {"prompt": None}
with sync_playwright() as p:
    b = p.chromium.launch(channel="chrome", headless=True, args=["--enable-unsafe-swiftshader", "--use-angle=swiftshader"])
    ctx = b.new_context(viewport={"width": 1440, "height": 1000}, accept_downloads=True)
    pg = ctx.new_page()
    errors, outside = [], []
    pg.on("pageerror", lambda e: errors.append("pageerror: " + str(e)))
    pg.on("console", lambda m: errors.append("console: " + m.text) if m.type == "error" else None)
    pg.on("request", lambda r: outside.append(r.url) if not r.url.startswith(BASE) and not r.url.startswith(("data:", "blob:")) else None)
    def on_dialog(d):
        if d.type == "prompt": d.accept(NEXT["prompt"] or "") if NEXT["prompt"] else d.dismiss()
        else: d.accept()
    pg.on("dialog", on_dialog)

    pg.goto(BASE + "/login?key=" + sec.local_key()); pg.wait_for_url(BASE + "/"); pg.wait_for_load_state("networkidle"); pg.wait_for_timeout(1500)
    COOKIE = "; ".join(f"{c['name']}={c['value']}" for c in ctx.cookies())
    SAVED = json.loads(raw("/settings"))
    check("Signs in from the Start menu link and opens the map", pg.title() == "Atlas" and pg.locator("#meta").inner_text().find("files") > 0, pg.locator("#meta").inner_text()[:60])

    # ---- map, views, colors, fonts -----------------------------------------------------------
    pg.click("#views button[data-v=treemap]"); pg.wait_for_timeout(700)
    tiles = pg.locator(".tile").count(); check("Treemap view", tiles > 100, f"{tiles} tiles")
    pg.click("#views button[data-v=tree]"); pg.wait_for_timeout(700)
    grid = pg.evaluate("() => { const m = document.querySelector('#map'); return [m.classList.contains('treeview'), getComputedStyle(m).backgroundImage] }")
    check("Tree view with the dot grid", grid[0] and "radial-gradient" in grid[1], grid[1][:70])
    pg.screenshot(path=os.path.join(SHOTS, "tree_grid.png"))
    pg.click("#views button[data-v=list]"); pg.wait_for_timeout(500)
    check("List view, grid only on Tree", pg.locator(".lrow").count() > 5 and not pg.evaluate("document.querySelector('#map').classList.contains('treeview')"), pg.locator(".lrow").count())
    pg.click("#views button[data-v=treemap]"); pg.wait_for_timeout(600)
    pg.click("#metric button[data-m=files]"); pg.wait_for_timeout(400)
    check("Sized by number of files", " files" in pg.inner_text("#map"), "labels show file counts")
    pg.click("#metric button[data-m=eq]"); pg.wait_for_timeout(400)
    check("Every folder the same size", pg.locator(".tile").count() > 100, pg.locator(".tile").count())
    pg.click("#metric button[data-m=gb]"); pg.wait_for_timeout(400)
    pg.locator(".region.cat .h").first.click(); pg.wait_for_timeout(400)
    check("Zoom into a category", "›" in pg.inner_text("#crumbs") and pg.locator(".tile").count() < tiles, pg.inner_text("#crumbs").replace("\n", " "))
    pg.locator("#crumbs button").first.click(); pg.wait_for_timeout(400)
    check("Back to everything", pg.locator(".tile").count() == tiles, pg.locator(".tile").count())
    pg.locator(".tile").first.click(); pg.wait_for_timeout(300)
    panel = pg.inner_text("#panel").upper()
    check("A folder's details: why it sits there, where it lives", "ORIGINAL" in panel and "BROWSE FILES" in panel, panel[:60].replace("\n", " "))
    pg.click("#tonebtn"); pg.click("#tones button[data-k=blue]"); pg.wait_for_timeout(300)
    hue = pg.evaluate("getComputedStyle(document.documentElement).getPropertyValue('--h').trim()")
    check("Color tone changes from the collapsed color button", hue == "255" and pg.locator("#tones").is_hidden(), hue)
    pg.wait_for_timeout(500)
    fonts = pg.evaluate("document.fonts.check('16px \"IBM Plex Sans\"') && document.fonts.check('16px \"IBM Plex Mono\"')")
    check("IBM Plex fonts load from the PC", fonts, fonts)

    # ---- find --------------------------------------------------------------------------------
    term = pg.evaluate("S.data.folders.filter(f => f.kind === 'dir').sort((a, b) => b.files - a.files)[0].name.split(' ')[0]")
    pg.fill("#q", term); pg.wait_for_timeout(400)
    lit = pg.locator(".tile:not(.dim)").count(); check("Find a folder highlights it", 0 < lit < tiles, f"{lit} lit")
    fname = os.path.splitext(os.path.basename(next(iter(SAMPLES.values()))["path"]))[0][:10]   # part of a real file's name
    pg.fill("#q", fname); pg.wait_for_timeout(1600)
    finds = pg.locator("#panel .finds button").count()
    check("Find also lists matching files", finds > 0 and "Files named like" in pg.inner_text("#panel"), f"{finds} files")
    if finds:
        pg.locator("#panel .finds button").first.click(); pg.wait_for_timeout(1500)
        check("A found file opens in its folder, selected", pg.locator(".fb").count() == 1 and pg.locator(".frow.focus").count() == 1, pg.locator(".fb-crumbs").inner_text()[-50:])
        pg.click("#fb-back"); pg.wait_for_timeout(500)
    pg.fill("#q", ""); pg.wait_for_timeout(400)

    # ---- browse from a tile --------------------------------------------------------------------
    pg.locator(".tile").nth(3).click(); pg.wait_for_timeout(300)
    pg.click("#o-browse"); pg.wait_for_timeout(1500)
    rows = pg.locator(".frow").count()
    check("Browse files from a folder on the map", pg.locator(".fb").count() == 1 and rows > 0, f"{rows} items")
    pg.click("#fb-back"); pg.wait_for_timeout(500)
    check("Back to the map", pg.locator(".tile").count() == tiles, pg.locator(".tile").count())

    # ---- previews in the test folder -----------------------------------------------------------
    pg.evaluate("p => browse(p)", T); pg.wait_for_timeout(1200)
    row = lambda n: pg.locator(".frow").filter(has_text=n).first
    row("Site photo.jpg").click(); pg.wait_for_timeout(1200)
    ok = pg.evaluate("() => { const i = document.querySelector('#pv img'); return !!i && i.complete && i.naturalWidth > 0 }")
    check("Image preview", ok, ok)
    thumbs = pg.evaluate("() => [...document.querySelectorAll('.frow .ic img')].filter(i => i.naturalWidth > 0).length")
    check("Image thumbnails in the list", thumbs >= 1, thumbs)
    row("Spec sheet.pdf").click(); pg.wait_for_timeout(3500)
    pdf = pg.evaluate("() => { const c = document.querySelector('#pv canvas'); const n = document.querySelector('#pv .pv-nav span'); return [c ? c.width : 0, n ? n.textContent : ''] }")
    check("PDF preview, page 1", pdf[0] > 100 and pdf[1] == "Page 1 of 2", pdf)
    pg.screenshot(path=os.path.join(SHOTS, "pdf_preview.png"))
    pg.click("#pv .pv-nav button[data-d='1']"); pg.wait_for_timeout(1500)
    check("PDF next page", pg.inner_text("#pv .pv-nav span") == "Page 2 of 2", pg.inner_text("#pv .pv-nav span"))
    pg.click("#pv-big"); pg.wait_for_timeout(3000)
    big = pg.evaluate("() => { const c = document.querySelector('.viewer canvas'); return c ? [Math.round(c.getBoundingClientRect().height), innerHeight] : null }")
    check("Full screen viewer (PDF fills the screen height)", big and big[0] > 700 and big[0] <= big[1], big)
    pg.screenshot(path=os.path.join(SHOTS, "pdf_fullscreen.png"))
    pg.keyboard.press("Escape"); pg.wait_for_timeout(300)
    check("Escape closes the viewer", pg.locator(".viewer").count() == 0, pg.locator(".viewer").count())
    row("Bracket.stl").click(); pg.wait_for_timeout(4000)
    gl = pg.evaluate("() => [!!document.querySelector('#pv .three canvas'), (document.querySelector('#pv .err') || {}).textContent || '']")
    check("3D preview (STL)", gl[0] and not gl[1], gl)
    pg.screenshot(path=os.path.join(SHOTS, "model_preview.png"))
    row("Readme.txt").click(); pg.wait_for_timeout(1000)
    check("Text preview", "Atlas test folder" in pg.inner_text("#pv"), pg.inner_text("#pv")[:40])

    # ---- file actions --------------------------------------------------------------------------
    NEXT["prompt"] = "Made by test"; pg.click(".fb-tools [data-a=mkdir]"); pg.wait_for_timeout(1200)
    check("New folder", os.path.isdir(os.path.join(T, "Made by test")) and row("Made by test").count() == 1, os.listdir(T))
    row("Readme.txt").locator("input").click(); pg.wait_for_timeout(300)
    NEXT["prompt"] = "Notes.txt"; pg.click(".fb-tools [data-a=rename]"); pg.wait_for_timeout(1200)
    check("Rename", os.path.exists(os.path.join(T, "Notes.txt")) and row("Notes.txt").count() == 1, os.listdir(T))
    row("Notes.txt").click(); pg.wait_for_timeout(400)
    pg.click(".fb-tools [data-a=copy]"); pg.wait_for_timeout(200)
    row("Made by test").click(); pg.wait_for_timeout(1000)
    pg.click(".fb-tools [data-a=paste]"); pg.wait_for_timeout(1500)
    check("Copy and paste", os.path.exists(os.path.join(T, "Made by test", "Notes.txt")) and os.path.exists(os.path.join(T, "Notes.txt")), os.listdir(os.path.join(T, "Made by test")))
    pg.click(".fb-tools [data-a=up]"); pg.wait_for_timeout(1000)
    row("Site photo.jpg").click(); pg.wait_for_timeout(500)
    pg.click(".fb-tools [data-a=cut]"); pg.wait_for_timeout(200)
    row("Inbox").click(); pg.wait_for_timeout(1000)
    pg.click(".fb-tools [data-a=paste]"); pg.wait_for_timeout(1500)
    check("Cut and paste (move)", os.path.exists(os.path.join(T, "Inbox", "Site photo.jpg")) and not os.path.exists(os.path.join(T, "Site photo.jpg")), os.listdir(os.path.join(T, "Inbox")))
    row("Site photo.jpg").click(); pg.wait_for_timeout(600)
    pg.click(".fb-tools [data-a=tags]"); pg.wait_for_timeout(300)
    pg.click("#panel .dots button[data-c=teal]"); pg.fill("#tg-in", "Client review"); pg.click("#tg-add")
    pg.click("#panel .dots button[data-c=red]"); pg.fill("#tg-in", "Urgent"); pg.click("#tg-add")
    pg.screenshot(path=os.path.join(SHOTS, "tags.png"))
    pg.click("#tg-save"); pg.wait_for_timeout(1200)
    chips = row("Site photo.jpg").locator(".chipt").all_inner_texts()
    check("Color tags on a file", [c.strip().lower() for c in chips] == ["client review", "urgent"], chips)
    with pg.expect_download(timeout=15000) as dl:
        pg.click(".fb-tools [data-a=download]")
    check("Download", dl.value.suggested_filename == "Site photo.jpg", dl.value.suggested_filename)
    pg.click(".fb-tools [data-a=up]"); pg.wait_for_timeout(1000)
    row("Bracket.stl").locator("input").click(); pg.wait_for_timeout(200)
    pg.click(".fb-tools [data-a=delete]"); pg.wait_for_timeout(1500)
    check("Delete to the Recycle Bin", not os.path.exists(os.path.join(T, "Bracket.stl")) and row("Bracket.stl").count() == 0, os.listdir(T))
    pg.screenshot(path=os.path.join(SHOTS, "browser.png"))

    # ---- the user's own files: preview only ----------------------------------------------------
    for k, label in (("glb", "3D preview (GLB)"), ("obj", "3D preview (OBJ)"), ("ply", "3D preview (PLY)")):
        if k not in SAMPLES: check(label, False, "no sample found"); continue
        s = SAMPLES[k]["path"]
        pg.evaluate("([d, f]) => browse(d, f)", [os.path.dirname(s), s]); pg.wait_for_timeout(5000)
        gl = pg.evaluate("() => [!!document.querySelector('#pv .three canvas'), (document.querySelector('#pv .err') || {}).textContent || '']")
        check(label, gl[0] and not gl[1], gl)
    if "video" in SAMPLES:
        s = SAMPLES["video"]["path"]; pg.evaluate("([d, f]) => browse(d, f)", [os.path.dirname(s), s]); pg.wait_for_timeout(4000)
        v = pg.evaluate("() => { const v = document.querySelector('#pv video'); return v ? [v.readyState, v.duration, v.error && v.error.code] : null }")
        check("Video preview plays (MP4)", v and v[0] >= 1 and v[1] > 0, v)
    if "image_conv" in SAMPLES:
        s = SAMPLES["image_conv"]["path"]; pg.evaluate("([d, f]) => browse(d, f)", [os.path.dirname(s), s]); pg.wait_for_timeout(2500)
        ok = pg.evaluate("() => { const i = document.querySelector('#pv img'); return !!i && i.naturalWidth > 0 }")
        check("Preview of a format browsers can't show (TIFF, converted on the PC)", ok, ok)
    if "audio" in SAMPLES:
        s = SAMPLES["audio"]["path"]; pg.evaluate("([d, f]) => browse(d, f)", [os.path.dirname(s), s]); pg.wait_for_timeout(1500)
        check("Audio player", pg.locator("#pv audio").count() == 1, "")

    # ---- read only -----------------------------------------------------------------------------
    RO = [p for p in sec.ROOTS_RO if os.path.isdir(p)]
    pg.evaluate("p => browse(p)", RO[0] if RO else T); pg.wait_for_timeout(2000)
    dis = pg.evaluate("() => ['mkdir','cut','rename','delete','paste'].map(a => document.querySelector(`.fb-tools [data-a=${a}]`).disabled)")
    check("Read-only folders stay read only", pg.locator(".fb-tools .ro").count() == 1 and all(dis), dis)
    pg.click("#fb-back"); pg.wait_for_timeout(500)

    # ---- devices -------------------------------------------------------------------------------
    pg.click("#devices"); pg.wait_for_timeout(800)
    txt = pg.inner_text("#panel")
    check("Devices panel lists signed-in devices", "This PC" in txt and "Pair a phone" in txt, txt[:80].replace("\n", " "))
    pg.click("#pair"); pg.wait_for_timeout(1500)
    check("Pairing QR code for a phone", pg.locator("#pairbox svg").count() == 1, pg.inner_text("#pairbox")[:80].replace("\n", " "))

    # ---- phone layout --------------------------------------------------------------------------
    ph = b.new_context(**p.devices["Pixel 7"], accept_downloads=True)
    pp = ph.new_page(); pp.on("dialog", lambda d: d.accept())
    pp.goto(BASE + "/login?key=" + sec.local_key()); pp.wait_for_url(BASE + "/"); pp.wait_for_load_state("networkidle"); pp.wait_for_timeout(1500)
    pp.evaluate("p => browse(p)", T); pp.wait_for_timeout(1200)
    wide = pp.evaluate("document.documentElement.scrollWidth <= window.innerWidth + 1")
    check("Phone: file browser fits the screen", wide, pp.evaluate("[document.documentElement.scrollWidth, window.innerWidth]"))
    pp.screenshot(path=os.path.join(SHOTS, "phone_browser.png"))
    pp.locator(".frow").filter(has_text="Spec sheet.pdf").first.click(); pp.wait_for_timeout(3500)
    ok = pp.evaluate("() => { const c = document.querySelector('.viewer canvas'); return !!c && c.getBoundingClientRect().width <= innerWidth }")
    check("Phone: a file opens full screen", ok, ok)
    pp.screenshot(path=os.path.join(SHOTS, "phone_pdf.png"))
    pp.click("#v-close"); pp.wait_for_timeout(300)
    pp.goto(BASE + "/logout"); ph.close()

    check("No script errors", not errors, errors[:3])
    check("Nothing loaded from the internet", not outside, outside[:3])
    urllib.request.urlopen(urllib.request.Request(BASE + "/settings", data=json.dumps({"tone": SAVED.get("tone", "red"), "view": SAVED.get("view", "treemap")}).encode(),
                           method="POST", headers={"Cookie": COOKIE, "X-Atlas": "1", "Content-Type": "application/json"}), timeout=10)
    pg.goto(BASE + "/logout"); b.close()

shutil.rmtree(T, ignore_errors=True)
print(json.dumps({"passed": sum(r[1] for r in R), "total": len(R), "failed": [r[0] + ": " + r[2] for r in R if not r[1]]}))
