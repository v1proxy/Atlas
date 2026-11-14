# preview.py: runs the launcher page in Chromium at phone size against the stand-in for Android (mock.js) and
# takes screenshots of the home screen, the dial, the Apps map and the details sheet.
#   python launcher/test/preview.py [rules.json] [map.json]      shots go to launcher/test/shots
import json, os, shutil, sys, threading, functools, http.server
from playwright.sync_api import sync_playwright

HERE = os.path.dirname(os.path.abspath(__file__))
WEB = os.path.join(os.path.dirname(HERE), "web")
FONTS = os.path.join(os.path.dirname(os.path.dirname(HERE)), "static", "vendor", "fonts")
SITE, SHOTS = os.path.join(HERE, "site"), os.path.join(HERE, "shots")
rules = sys.argv[1] if len(sys.argv) > 1 else os.path.join(os.path.dirname(HERE), "rules.example.json")
mapj = sys.argv[2] if len(sys.argv) > 2 else os.path.join(HERE, "demo-map.json")

shutil.rmtree(SITE, ignore_errors=True); os.makedirs(os.path.join(SITE, "fonts")); os.makedirs(SHOTS, exist_ok=True)
for f in ("launcher.css", "launcher.js"): shutil.copy(os.path.join(WEB, f), SITE)
html = open(os.path.join(WEB, "index.html"), encoding="utf-8").read().replace('<script src="launcher.js">', '<script src="prefs.js"></script><script src="mock.js"></script><script src="launcher.js">')
open(os.path.join(SITE, "index.html"), "w", encoding="utf-8").write(html)
for f in os.listdir(FONTS):
    if f.endswith(".woff2"): shutil.copy(os.path.join(FONTS, f), os.path.join(SITE, "fonts"))
shutil.copy(os.path.join(HERE, "mock.js"), SITE); shutil.copy(rules, os.path.join(SITE, "rules.json")); shutil.copy(mapj, os.path.join(SITE, "demo-map.json"))
A_ = lambda pkg, label: {"key": pkg + "/.Main|0", "label": label}
F_ = lambda path, d=False: {"path": path, "name": path.rsplit("\\", 1)[-1], "dir": d, "kind": ""}
PINS = {"apps": [A_("io.homeassistant.companion.android", "Home Assistant"), A_("com.google.android.apps.messaging", "Messages"),
                 A_("com.android.chrome", "Chrome"), A_("com.google.android.GoogleCamera", "Camera"), A_("com.google.android.apps.maps", "Maps"),
                 A_("com.Slack", "Slack"), A_("com.whatsapp", "WhatsApp"), A_("com.instructure.candroid", "Canvas Student"),
                 A_("com.united.mobile.android", "United Airlines"), A_("com.spotify.music", "Spotify")],
        "files": [F_("G:\\My Drive\\Harbor Library\\Concept report.pdf"), F_("G:\\My Drive\\Kitchen renovation", True),
                  F_("G:\\My Drive\\Harbor Library\\Massing model.stl"), F_("G:\\My Drive\\Harbor Library\\Facade study.jpg"),
                  F_("G:\\My Drive\\Courses\\Syllabus.pdf"), F_("G:\\My Drive\\Courses\\Lecture 04 Lunar habitats and surface operations.pptx"),
                  F_("G:\\My Drive\\Home\\Floor plan.dwg"), F_("G:\\My Drive\\Home\\Greenhouse wiring.pdf"),
                  F_("G:\\My Drive\\Pitch deck v7.pdf"), F_("G:\\My Drive\\Taxes 2025", True)]}
H_ = 3600e3
USE = {"G:\\My Drive\\Kitchen renovation": [5 * H_, 0], "G:\\My Drive\\Courses\\Syllabus.pdf": [3 * H_, 0], "G:\\My Drive\\Harbor Library\\Concept report.pdf": [1 * H_, 0]}
open(os.path.join(SITE, "prefs.js"), "w").write("window.MOCK_PREFS = " + json.dumps({"pins": PINS, "over": {}, "order": "apps-top", "tone": "red", "view": "treemap", "metric": "use", "use": USE}) + ";\nfor (const v of Object.values(MOCK_PREFS.use)) v[1] = Date.now();")

srv = http.server.ThreadingHTTPServer(("127.0.0.1", 8811), functools.partial(http.server.SimpleHTTPRequestHandler, directory=SITE))
srv.RequestHandlerClass.log_message = lambda *a: None
threading.Thread(target=srv.serve_forever, daemon=True).start()

errors = []
with sync_playwright() as p:
    b = p.chromium.launch()
    pg = b.new_page(viewport={"width": 412, "height": 915}, device_scale_factor=2, has_touch=True, is_mobile=True)
    pg.on("pageerror", lambda e: errors.append(str(e)))
    pg.on("console", lambda m: errors.append(m.text) if m.type == "error" else None)
    pg.goto("http://127.0.0.1:8811/index.html"); pg.wait_for_timeout(900)
    pg.screenshot(path=os.path.join(SHOTS, "1-home.png"))
    # the dial: one tap opens it; the cross spins while the names swing out onto three rings, the most used nearest
    hub = pg.locator("#hub").bounding_box(); cx, cy = hub["x"] + hub["width"] / 2, hub["y"] + hub["height"] / 2
    pg.mouse.move(cx, cy); pg.mouse.down(); pg.wait_for_timeout(80); pg.mouse.up()
    pg.wait_for_timeout(240); pg.screenshot(path=os.path.join(SHOTS, "2a-dial-opening.png"))
    spinning = pg.evaluate("document.querySelector('#hub i').getAnimations().length")
    pg.wait_for_timeout(1300); pg.screenshot(path=os.path.join(SHOTS, "2b-dial.png"))
    order = pg.evaluate("['Apps','Files'].map(s => [...document.querySelectorAll('#dial .di[data-side=' + s + ']')].map(b => b.textContent + ' ' + b.dataset.ring))")
    boxes = pg.evaluate("[...document.querySelectorAll('#dial .di')].map(b => { const r = b.getBoundingClientRect(); return [b.textContent, r.left, r.top, r.right, r.bottom]; })")
    overlaps = [(x[0], y[0]) for i, x in enumerate(boxes) for y in boxes[i + 1:] if min(x[3], y[3]) - max(x[1], y[1]) > 2 and min(x[4], y[4]) - max(x[2], y[2]) > 2]
    fb = pg.evaluate("document.querySelector('#frame').getBoundingClientRect().bottom")
    outside = [x[0] for x in boxes if x[1] < 0 or x[3] > 412 or x[2] < fb or x[4] > 915]
    hubhit = [x[0] for x in boxes if max(x[1], cx - 45) < min(x[3], cx + 45) and max(x[2], cy - 45) < min(x[4], cy + 45)]
    still = pg.evaluate("document.querySelectorAll('#dial .di').length && [...document.querySelectorAll('#dial .di')].some(b => b.getAnimations().length)")
    pg.locator("#dial .di").nth(0).click(); pg.wait_for_timeout(200)
    log = pg.evaluate("window.MOCK_LOG.filter(x => x[0] === 'launch').map(x => x[1].key)")
    # holding opens it for removing: names gray, one tap red, a second tap takes it off
    pg.mouse.move(cx, cy); pg.mouse.down(); pg.wait_for_timeout(700); pg.mouse.up(); pg.wait_for_timeout(1300)
    edit = pg.evaluate("document.querySelector('#dial').classList.contains('edit') && getComputedStyle(document.querySelector('#dial .di')).color")
    cross = pg.evaluate("getComputedStyle(document.querySelector('#hub i')).transform")
    pg.screenshot(path=os.path.join(SHOTS, "2c-remove.png"))
    tgt = pg.locator('#dial .di[data-side="Apps"]').nth(0); gone = tgt.text_content()
    tgt.click(); pg.wait_for_timeout(150)
    armed = pg.evaluate("getComputedStyle(document.querySelector('#dial .di.armed')).color")
    pg.screenshot(path=os.path.join(SHOTS, "2d-armed.png"))
    tgt.click(); pg.wait_for_timeout(700)
    left = pg.evaluate("L.pins.apps.map(p => p.label)")
    pg.screenshot(path=os.path.join(SHOTS, "2e-removed.png"))
    pg.mouse.click(cx, cy); pg.wait_for_timeout(260); pg.screenshot(path=os.path.join(SHOTS, "2f-closing.png"))
    back = pg.evaluate("crossAngle(document.querySelector('#hub i'))")
    pg.wait_for_timeout(1100)
    closed = pg.evaluate("document.querySelector('#dial').hidden") and abs(pg.evaluate("crossAngle(document.querySelector('#hub i'))")) < 1
    pg.click("#box-apps"); pg.wait_for_timeout(400)
    pg.screenshot(path=os.path.join(SHOTS, "3-apps.png"))
    t = pg.locator('#map .tile[data-k="io.homeassistant.companion.android/.Main|0"]').bounding_box()
    pg.mouse.move(t["x"] + 20, t["y"] + 20); pg.mouse.down(); pg.wait_for_timeout(650); pg.mouse.up(); pg.wait_for_timeout(350)
    pg.screenshot(path=os.path.join(SHOTS, "4-sheet.png"))
    pg.click("#sheetx"); pg.click("#title"); pg.wait_for_timeout(200)
    pg.fill("#q", "red"); pg.wait_for_timeout(200); pg.fill("#q", "concept"); pg.wait_for_timeout(700)
    pg.screenshot(path=os.path.join(SHOTS, "5-search.png"))
    pg.fill("#q", ""); pg.wait_for_timeout(100)
    for v in ("tree", "list"):
        pg.click("#box-apps"); pg.click(f'#views button[data-v="{v}"]'); pg.wait_for_timeout(300)
        pg.screenshot(path=os.path.join(SHOTS, f"6-{v}.png")); pg.click("#title")
    # holding the Settings circle swaps black and ivory
    tb = pg.locator("#tonebtn").bounding_box()
    pg.mouse.move(tb["x"] + 17, tb["y"] + 17); pg.mouse.down(); pg.wait_for_timeout(650); pg.mouse.up(); pg.wait_for_timeout(900)
    ivory = pg.evaluate("[document.body.classList.contains('ivory'), getComputedStyle(document.body).backgroundColor, L.screen]")
    pg.screenshot(path=os.path.join(SHOTS, "7-ivory.png"))
    hub = pg.locator("#hub").bounding_box(); cx, cy = hub["x"] + hub["width"] / 2, hub["y"] + hub["height"] / 2
    pg.mouse.click(cx, cy); pg.wait_for_timeout(1300); pg.screenshot(path=os.path.join(SHOTS, "7b-ivory-dial.png"))
    pg.mouse.click(cx, cy); pg.wait_for_timeout(1300)
    pg.click("#box-apps"); pg.click('#views button[data-v="treemap"]'); pg.wait_for_timeout(400); pg.screenshot(path=os.path.join(SHOTS, "7c-ivory-apps.png"))
    pg.click("#title"); pg.wait_for_timeout(300)
    home_again = pg.evaluate("L.screen")
    pg.mouse.move(tb["x"] + 17, tb["y"] + 17); pg.mouse.down(); pg.wait_for_timeout(650); pg.mouse.up(); pg.wait_for_timeout(900)
    black = pg.evaluate("[document.body.classList.contains('ivory'), getComputedStyle(document.body).backgroundColor]")
    states = pg.evaluate("Object.fromEntries(['Current','Superseded','Working'].map(s => [s, L.apps.filter(a => a.state === s).map(a => a.label + ' > ' + a.category)]))")
    b.close()
srv.shutdown()
print("cross spinning while opening:", spinning, "| animations still running after 1.5 s:", still)
print("dial order (name ring):", json.dumps(order, indent=1))
print("overlapping names:", overlaps or "none", "| outside the screen or under the frame:", outside or "none", "| over the circle:", hubhit or "none")
print("tapped the first name, launched:", log)
print("remove mode gray:", edit, "| cross:", cross, "| armed color:", armed, "| removed:", gone, "->", left)
print("closing: cross at", round(back, 1), "deg after 260 ms (negative = counterclockwise) | closed, cross back to +:", closed)
print("ivory after holding Settings:", ivory, "| title went home:", home_again, "| held again:", black)
print(json.dumps(states, indent=1))
print("errors:", errors or "none")
