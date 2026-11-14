# atlas_mode.py: Atlas's page inside the launcher (launcher mode), against the demo server with invented data.
# A stand-in for the launcher's bridge (window.AtlasLauncher) records what the page asks of it.
#   python docs/demo/demo_server.py &      then      python launcher/test/atlas_mode.py
import os, sys
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
    check("plain Atlas: Home hidden, Devices shown", not pg.locator("#homel").is_visible() and pg.locator("#devices").is_visible())
    pg.locator("#map .tile").first.click(); pg.wait_for_timeout(250)
    check("plain Atlas: tap shows details, no browsing", pg.evaluate("!S.browse") and pg.locator("#o-browse").count() == 1 and pg.locator("#o-pin").count() == 0)
    pg.close()

    # 2. In the launcher.
    pg = br.new_page(viewport={"width": 412, "height": 860}, is_mobile=True, has_touch=True)
    pg.on("pageerror", lambda e: errs.append(str(e)))
    pg.add_init_script(BRIDGE)
    pg.goto(URL); pg.wait_for_selector("#map .tile"); pg.wait_for_timeout(300)
    check("launcher: class set", pg.evaluate("document.body.classList.contains('launcher')"))
    check("launcher: Home shown, Devices hidden", pg.locator("#homel").is_visible() and not pg.locator("#devices").is_visible())
    pg.screenshot(path=os.path.join(SHOTS, "atlas-1-map.png"))
    pg.click("#homel"); check("Home asks the launcher", pg.evaluate("LOG.some(x => x[0] === 'home')"))
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
    br.close()
print("\n" + ("all passed" if not fails else f"{len(fails)} failed"))
sys.exit(1 if fails else 0)
