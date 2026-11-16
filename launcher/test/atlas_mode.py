# atlas_mode.py: Atlas's page inside the launcher (launcher mode), against the demo server with invented data.
# A stand-in for the launcher's bridge (window.AtlasLauncher) records what the page asks of it.
#   python docs/demo/demo_server.py &      then      python launcher/test/atlas_mode.py
import time, os, sys
from playwright.sync_api import sync_playwright

URL = os.environ.get("ATLAS_DEMO", "http://127.0.0.1:8799/")
SHOTS = os.path.join(os.path.dirname(os.path.abspath(__file__)), "shots"); os.makedirs(SHOTS, exist_ok=True)
BRIDGE = """
window.LOG = []; window.PINS = [];
window.AtlasLauncher = {
  home() { LOG.push(["home"]); },
  haptic(k) { LOG.push(["haptic", k]); },
  isPinned(p) { return PINS.some(x => x.path === p); },
  pin(json) { const it = JSON.parse(json), i = PINS.findIndex(x => x.path === it.path);
    if (i >= 0) { PINS.splice(i, 1); LOG.push(["unpin", it.path]); return "removed"; }
    if (PINS.length >= 10) return "full";
    PINS.push(it); LOG.push(["pin", it.path, it.dir]); return "added"; },
};"""
fails = []
def check(name, ok):
    print(("ok   " if ok else "FAIL ") + name)
    if not ok: fails.append(name)

def hold(pg, sel, ms=650):
    b = pg.locator(sel).first.bounding_box()
    pg.mouse.move(b["x"] + min(20, b["width"] / 2), b["y"] + min(14, b["height"] / 2)); pg.mouse.down(); pg.wait_for_timeout(ms); pg.mouse.up(); pg.wait_for_timeout(250)

with sync_playwright() as p:
    br = p.chromium.launch()
    # 1. Without the launcher nothing changes: a tap on a tile shows its details.
    pg = br.new_page(viewport={"width": 412, "height": 860}, is_mobile=True, has_touch=True)
    errs = []; pg.on("pageerror", lambda e: errs.append(str(e)))
    pg.goto(URL); pg.wait_for_selector("#map .tile"); pg.wait_for_timeout(300)
    check("plain Atlas: no launcher class", not pg.evaluate("document.body.classList.contains('launcher')"))
    check("plain Atlas: the name is not a Home button, Devices shown", pg.evaluate("document.querySelector('header h1').getAttribute('role')") is None and pg.locator("#devices").is_visible())
    pg.locator("#map .tile").first.click(); pg.wait_for_timeout(250)
    check("plain Atlas: tap shows details, no browsing", pg.evaluate("!S.browse") and pg.locator("#o-browse").count() == 1 and pg.locator("#o-pin").count() == 0)
    pg.close()

    # 2. In the launcher.
    pg = br.new_page(viewport={"width": 412, "height": 860}, is_mobile=True, has_touch=True)
    pg.on("pageerror", lambda e: errs.append(str(e)))
    pg.add_init_script(BRIDGE)
    pg.goto(URL); pg.wait_for_selector("#map .tile"); pg.wait_for_timeout(300)
    check("launcher: class set", pg.evaluate("document.body.classList.contains('launcher')"))
    check("launcher: the Atlas name is the Home button, Devices hidden", pg.evaluate("document.querySelector('header h1').getAttribute('role')") == "button" and not pg.locator("#devices").is_visible())
    pg.screenshot(path=os.path.join(SHOTS, "atlas-1-map.png"))
    pg.click("header h1"); check("tapping Atlas asks the launcher for Home", pg.evaluate("LOG.some(x => x[0] === 'home')"))
    hold(pg, "#map .tile")
    check("long press on a folder: details with Add to dial", pg.locator("#o-pin").count() == 1 and pg.evaluate("document.body.classList.contains('sheet')"))
    pg.click("#o-pin"); pg.wait_for_timeout(100)
    check("Add to dial pins the folder", pg.evaluate("PINS.length === 1 && PINS[0].dir === true") and pg.inner_text("#o-pin") == "Remove from dial")
    pg.screenshot(path=os.path.join(SHOTS, "atlas-2-details.png"))
    check("Back closes the sheet", pg.evaluate("atlasBack()") and not pg.evaluate("document.body.classList.contains('sheet')"))
    pg.locator("#map .tile").first.click(); pg.wait_for_timeout(600)
    check("one tap on a folder opens it", pg.evaluate("S.browse === true") and pg.locator(".frow").count() > 0)
    first_dir = pg.evaluate("FB.dir")
    sub = pg.locator(".frow", has=pg.locator(".ic.folder"))
    if sub.count():
        sub.first.click(); pg.wait_for_timeout(600)
        check("a subfolder opens with one tap", pg.evaluate("FB.dir") != first_dir)
        check("Back returns to the previous folder", pg.evaluate("atlasBack()") and (pg.wait_for_timeout(600) or True) and pg.evaluate("FB.dir") == first_dir)
    files = pg.locator(".frow", has_not=pg.locator(".ic.folder"))
    if files.count():
        hold(pg, ".frow:not(:has(.ic.folder))")
        check("long press on a file: Add to dial", pg.locator("#fm-pin").count() == 1)
        pg.click("#fm-pin"); pg.wait_for_timeout(100)
        check("the file is pinned", pg.evaluate("PINS.some(x => x.dir === false)"))
        pg.screenshot(path=os.path.join(SHOTS, "atlas-3-file.png"))
        pg.evaluate("atlasBack()")
    check("Back leaves the folder for the map", pg.evaluate("atlasBack()") and pg.evaluate("S.browse === false"))
    path = pg.evaluate("PINS.find(x => !x.dir) ? PINS.find(x => !x.dir).path : null")
    if path:
        pg.evaluate(f"atlasOpen({path!r}, false)"); pg.wait_for_timeout(900)
        check("atlasOpen opens a pinned file full screen", pg.locator(".viewer").count() == 1)
        check("Back closes the viewer", pg.evaluate("atlasBack()") and pg.locator(".viewer").count() == 0)
    check("Back with nothing open says so", pg.evaluate("(() => { while (atlasBack()) {} return atlasBack(); })()") is False)
    check("no page errors", not errs)
    if errs: print(errs)
    pg.close()

    # 3. A launcher that opens files in their apps and shares them (1.1.0): tap shows, hold opens in the app.
    pg = br.new_page(viewport={"width": 412, "height": 860}, is_mobile=True, has_touch=True)
    errs = []; pg.on("pageerror", lambda e: errs.append(str(e)))
    pg.add_init_script(BRIDGE + """
      AtlasLauncher.openWith = json => { LOG.push(["openWith", JSON.parse(json).path]); return true; };
      AtlasLauncher.share = json => { LOG.push(["share", JSON.parse(json).path]); return true; };""")
    pg.goto(URL); pg.wait_for_selector("#map .tile"); pg.wait_for_timeout(300)
    pg.evaluate(r"atlasOpen('G:\\My Drive\\Harbor Library', true)"); pg.wait_for_timeout(700)
    row = lambda name: f".frow[data-path$='{name}']"
    pg.locator(row("Facade study.jpg")).tap(); pg.wait_for_timeout(900)
    check("a tap on a photo opens the viewer", pg.locator(".viewer").count() == 1)
    check("the photo arrives and the waiting note goes", pg.locator(".viewer img").is_visible() and pg.locator(".viewer .pv-wait").count() == 0)
    check("the top bar: Add to dial, Share, Open in app, Details", [b.strip() for b in pg.locator(".vacts button").all_inner_texts()] == ["Add to dial", "Share", "Open in app", "Details"])
    check("details are folded", pg.locator(".vinfo").is_hidden())
    pg.click("#v-info"); check("Details shows size, date and path", pg.locator(".vinfo").is_visible() and "Facade study.jpg" in pg.inner_text(".vinfo"))
    pg.screenshot(path=os.path.join(SHOTS, "atlas-4-viewer.png"))
    pg.click("#v-pin"); pg.wait_for_timeout(100)
    check("Add to dial in the viewer pins the file", pg.evaluate("PINS.some(x => x.path.endsWith('Facade study.jpg') && x.dir === false)") and pg.inner_text("#v-pin") == "Remove from dial")
    pg.click("#v-share"); pg.wait_for_timeout(100)
    check("Share asks the launcher to share it", pg.evaluate("LOG.some(x => x[0] === 'share' && x[1].endsWith('Facade study.jpg'))") and pg.locator("#atoast").is_visible())
    pg.evaluate("atlasFile({state: 'progress', name: 'Facade study.jpg', pct: 40})")
    check("the launcher's progress shows", "40%" in pg.inner_text("#atoast"))
    pg.evaluate("atlasFile({state: 'done'})"); check("and goes when done", pg.locator("#atoast").is_hidden())
    pg.evaluate("atlasFile({state: 'error', msg: 'No app on this phone opens .blend files.'})")
    check("an error from the launcher shows", "No app" in pg.inner_text("#atoast"))
    check("Back closes the viewer", pg.evaluate("atlasBack()") and pg.locator(".viewer").count() == 0)
    hold(pg, row("Reading room.jpg"))
    check("holding a file opens it in its app, no sheet", pg.evaluate("LOG.some(x => x[0] === 'openWith' && x[1].endsWith('Reading room.jpg'))") and pg.locator(".viewer").count() == 0 and pg.locator("#fm-pin").count() == 0)
    hold(pg, row("Site photos"))
    check("holding a folder still shows Add to dial", pg.locator("#fm-pin").count() == 1)
    pg.evaluate("atlasBack()")
    pg.locator(row("Cost plan.docx")).tap(); pg.wait_for_timeout(1500)
    check("a Word file previews as a PDF", pg.locator(".viewer canvas").count() == 1 and "Page 1 of 3" in pg.inner_text(".viewer"))
    pg.screenshot(path=os.path.join(SHOTS, "atlas-5-office.png"))
    pg.evaluate("atlasBack()")
    pg.locator(row("Section model.blend")).tap(); pg.wait_for_timeout(500)
    check("a file without a preview still opens the viewer, pointing to Open in app", pg.locator(".viewer").count() == 1 and "Open in app" in pg.inner_text(".viewer .vbody"))
    pg.evaluate("atlasBack()")
    pg.route("**/api/file?*Reading*", lambda r: r.fulfill(status=502, body='{"error": "the cloud said: timeout"}'))
    pg.locator(row("Reading room.jpg")).tap(); pg.wait_for_timeout(900)
    check("a photo that can't come says so", "can't be shown here right now" in pg.inner_text(".viewer .vbody"))
    check("no page errors in 1.1.0", not errs)
    if errs: print(errs)
    pg.close()

    # 4. A folder that takes a while to open (the cloud): it says so at once, more taps wait for it, a failure says why.
    pg = br.new_page(viewport={"width": 412, "height": 860}, is_mobile=True, has_touch=True)
    errs, dialogs, ls = [], [], []
    pg.on("pageerror", lambda e: errs.append(str(e))); pg.on("dialog", lambda d: (dialogs.append(d.message), d.dismiss()))
    pg.on("request", lambda r: "/api/ls" in r.url and ls.append(r.url))
    pg.add_init_script(BRIDGE)
    pg.goto(URL); pg.wait_for_selector("#map .tile"); pg.wait_for_timeout(300)
    held = []                                                   # the folder's answer waits until the test lets it go
    pg.route("**/api/ls?*", lambda r: held.append(r))
    hold(pg, "#map .tile")
    check("a folder's details offer Browse files", pg.locator("#o-browse").count() == 1)
    pg.click("#o-browse"); pg.wait_for_timeout(600)
    check("while it opens, it says Opening…", pg.locator("#atoast").is_visible() and pg.inner_text("#atoast").startswith("Opening "))
    pg.evaluate("document.querySelector('#o-browse') && document.querySelector('#o-browse').click()"); pg.wait_for_timeout(400)
    check("a second tap doesn't ask again", len(ls) == 1)
    for r in held: r.continue_()
    pg.wait_for_timeout(800)
    check("then the folder opens and the note goes", pg.evaluate("S.browse") and pg.locator("#atoast").is_hidden())
    pg.evaluate("while (atlasBack()) {}"); pg.wait_for_timeout(300)
    pg.unroute("**/api/ls?*"); pg.route("**/api/ls?*", lambda r: r.abort())
    hold(pg, "#map .tile"); pg.click("#o-browse"); pg.wait_for_timeout(600)
    check("if Atlas doesn't answer, it says so, without a dialog", not dialogs and "didn't answer" in pg.inner_text("#atoast"))
    check("no page errors when a folder is slow", not errs)
    if errs: print(errs)
    br.close()
print("\n" + ("all passed" if not fails else f"{len(fails)} failed"))
sys.exit(1 if fails else 0)
