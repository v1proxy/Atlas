# Phone layout: Atlas is one screen (no page scroll), the Tree zooms out exactly to the whole structure, details slide up as a sheet.
import json, os, sys
from playwright.sync_api import sync_playwright
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import security as sec

BASE = "http://127.0.0.1:8765"; SHOTS = os.path.join(os.path.dirname(os.path.abspath(__file__)), "shots"); os.makedirs(SHOTS, exist_ok=True)
R = []
def check(name, ok, detail=""):
    R.append((name, bool(ok))); print(("PASS" if ok else "FAIL"), name, ":", str(detail)[:140], flush=True)

with sync_playwright() as p:
    b = p.chromium.launch(channel="chrome", headless=True)
    for label, ctx_args in (("Phone", p.devices["Pixel 7"]), ("PC", {"viewport": {"width": 1440, "height": 900}})):
        ctx = b.new_context(**ctx_args); pg = ctx.new_page(); errs = []
        pg.on("pageerror", lambda e: errs.append(str(e)))
        pg.goto(BASE + "/login?key=" + sec.local_key()); pg.wait_for_url(BASE + "/"); pg.wait_for_load_state("networkidle"); pg.wait_for_timeout(1200)
        saved = pg.evaluate("fetch('/settings').then(r => r.json())")
        pg.click("#views button[data-v=treemap]"); pg.wait_for_timeout(600)
        one = pg.evaluate("[document.documentElement.scrollHeight, document.body.scrollHeight, innerHeight]")
        wide = pg.evaluate("[Math.round(Math.max(...[...document.querySelectorAll('header *, #map')].map(e => e.getBoundingClientRect().right))), innerWidth]")
        check(f"{label}: nothing wider than the screen", wide[0] <= wide[1] + 1, wide)
        check(f"{label}: one screen, nothing to scroll", max(one[0], one[1]) <= one[2] + 1, one)
        pg.mouse.wheel(0, 2000); pg.wait_for_timeout(300)
        check(f"{label}: the title stays on screen", pg.evaluate("document.querySelector('h1').getBoundingClientRect().top >= 0"), "")
        tiles = pg.locator(".tile").count(); check(f"{label}: treemap fills the screen", tiles > 50, tiles)
        pg.click("#views button[data-v=tree]"); pg.wait_for_timeout(800)
        fitted = pg.evaluate("""() => { const m = document.querySelector('#map').getBoundingClientRect(), g = document.querySelector('#map svg > g').getBoundingClientRect();
            return [Math.round(g.width), Math.round(g.height), Math.round(m.width), Math.round(m.height), g.left >= m.left - 1 && g.right <= m.right + 1 && g.top >= m.top - 1 && g.bottom <= m.bottom + 1] }""")
        check(f"{label}: Tree opens showing the whole structure", fitted[4], fitted)
        pg.screenshot(path=os.path.join(SHOTS, f"{label.lower()}_tree_all.png"))
        for _ in range(4): pg.click(".tzbar [data-z=in]"); pg.wait_for_timeout(100)
        k_in = pg.evaluate("S.tz.k")
        for _ in range(20): pg.click(".tzbar [data-z=out]"); pg.wait_for_timeout(50)
        k_out = pg.evaluate("S.tz.k")
        whole = pg.evaluate("""() => { const m = document.querySelector('#map').getBoundingClientRect(), g = document.querySelector('#map svg > g').getBoundingClientRect();
            return g.left >= m.left - 1 && g.right <= m.right + 1 && g.top >= m.top - 1 && g.bottom <= m.bottom + 1 }""")
        check(f"{label}: zoom in, then zoom out stops at the whole structure", k_in > k_out and whole, f"in {k_in:.2f}, out {k_out:.2f}")
        box = pg.locator("#map svg").bounding_box(); cx, cy = box["x"] + box["width"] / 2, box["y"] + box["height"] / 2
        for _ in range(3): pg.click(".tzbar [data-z=in]")
        x0 = pg.evaluate("S.tz.x"); pg.mouse.move(cx, cy); pg.mouse.down(); pg.mouse.move(cx - 120, cy - 60, steps=6); pg.mouse.up(); pg.wait_for_timeout(200)
        check(f"{label}: drag moves the tree", pg.evaluate("S.tz.x") != x0, f"{x0} -> {pg.evaluate('S.tz.x')}")
        pg.click(".tzbar [data-z=fit]"); pg.wait_for_timeout(200)
        pg.click("#views button[data-v=treemap]"); pg.wait_for_timeout(600)
        pg.locator(".tile").first.click(); pg.wait_for_timeout(500)
        if label == "Phone":
            vis = pg.evaluate("() => { const r = document.querySelector('aside').getBoundingClientRect(); return [document.body.classList.contains('sheet'), Math.round(r.top), innerHeight] }")
            check("Phone: details slide up as a sheet", vis[0] and vis[1] < vis[2], vis)
            pg.screenshot(path=os.path.join(SHOTS, "phone_sheet.png"))
            pg.click("#sheetx"); pg.wait_for_timeout(400)
            gone = pg.evaluate("document.querySelector('aside').getBoundingClientRect().top >= innerHeight - 2")
            check("Phone: Close puts the sheet away", gone, "")
            pg.screenshot(path=os.path.join(SHOTS, "phone_treemap.png"))
        else:
            check("PC: details stay in the side panel", "ORIGINAL" in pg.inner_text("#panel").upper(), "")
        check(f"{label}: no script errors", not errs, errs[:2])
        pg.evaluate("s => fetch('/settings', {method: 'POST', headers: {'X-Atlas': '1', 'Content-Type': 'application/json'}, body: JSON.stringify({view: s.view || 'treemap', tone: s.tone || 'red'})})", saved)
        pg.goto(BASE + "/logout"); ctx.close()
    b.close()
print(json.dumps({"passed": sum(r[1] for r in R), "total": len(R), "failed": [r[0] for r in R if not r[1]]}))
