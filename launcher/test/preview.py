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
PINS = {"apps": [{"key": "io.homeassistant.companion.android/.Main|0", "label": "Home Assistant"}, {"key": "com.google.android.apps.messaging/.Main|0", "label": "Messages"},
                 {"key": "com.android.chrome/.Main|0", "label": "Chrome"}, {"key": "com.google.android.GoogleCamera/.Main|0", "label": "Camera"},
                 {"key": "com.google.android.apps.maps/.Main|0", "label": "Maps"}, {"key": "com.Slack/.Main|0", "label": "Slack"}],
        "files": [{"path": "G:\\My Drive\\Harbor Library\\Concept report.pdf", "name": "Concept report.pdf", "dir": False, "kind": "pdf"},
                  {"path": "G:\\My Drive\\Kitchen renovation", "name": "Kitchen renovation", "dir": True, "kind": ""},
                  {"path": "G:\\My Drive\\Harbor Library\\Massing model.stl", "name": "Massing model.stl", "dir": False, "kind": "model"},
                  {"path": "G:\\My Drive\\Harbor Library\\Facade study.jpg", "name": "Facade study.jpg", "dir": False, "kind": "image"}]}
open(os.path.join(SITE, "prefs.js"), "w").write("window.MOCK_PREFS = " + json.dumps({"pins": PINS, "over": {}, "order": "apps-top", "tone": "red", "view": "treemap", "metric": "use"}) + ";")

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
    hub = pg.locator("#hub").bounding_box(); cx, cy = hub["x"] + hub["width"] / 2, hub["y"] + hub["height"] / 2
    pg.mouse.move(cx, cy); pg.mouse.down(); pg.wait_for_timeout(500)
    first = pg.locator("#dial .di").nth(0).bounding_box()
    pg.mouse.move(first["x"] + first["width"] / 2, first["y"] + first["height"] / 2, steps=6); pg.wait_for_timeout(300)
    pg.screenshot(path=os.path.join(SHOTS, "2-dial.png"))
    pg.mouse.up(); pg.wait_for_timeout(200)
    log = pg.evaluate("window.MOCK_LOG.filter(x => x[0] === 'launch').map(x => x[1].key)")
    pg.click("#box-apps"); pg.wait_for_timeout(400)
    pg.screenshot(path=os.path.join(SHOTS, "3-apps.png"))
    t = pg.locator('#map .tile[data-k="io.homeassistant.companion.android/.Main|0"]').bounding_box()
    pg.mouse.move(t["x"] + 20, t["y"] + 20); pg.mouse.down(); pg.wait_for_timeout(650); pg.mouse.up(); pg.wait_for_timeout(350)
    pg.screenshot(path=os.path.join(SHOTS, "4-sheet.png"))
    pg.click("#sheetx"); pg.click("#homebtn"); pg.wait_for_timeout(200)
    pg.fill("#q", "red"); pg.wait_for_timeout(200); pg.fill("#q", "concept"); pg.wait_for_timeout(700)
    pg.screenshot(path=os.path.join(SHOTS, "5-search.png"))
    pg.fill("#q", ""); pg.wait_for_timeout(100)
    for v in ("tree", "list"):
        pg.click("#box-apps"); pg.click(f'#views button[data-v="{v}"]'); pg.wait_for_timeout(300)
        pg.screenshot(path=os.path.join(SHOTS, f"6-{v}.png")); pg.click("#homebtn")
    states = pg.evaluate("Object.fromEntries(['Current','Superseded','Working'].map(s => [s, L.apps.filter(a => a.state === s).map(a => a.label + ' > ' + a.category)]))")
    b.close()
srv.shutdown()
print("dial released on:", log)
print(json.dumps(states, indent=1))
print("errors:", errors or "none")
