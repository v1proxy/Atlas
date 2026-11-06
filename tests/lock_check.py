# Unlock with a code on the locked screen, go Back without being asked again, then the red Lock button signs the device out.
import http.client, json, os, sys
from playwright.sync_api import sync_playwright
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import security as sec

BASE = "http://127.0.0.1:8765"; R = []
def check(name, ok, detail=""):
    R.append((name, bool(ok))); print(("PASS" if ok else "FAIL"), name, ":", str(detail)[:120], flush=True)

def new_code():
    def req(m, p, body=None, ck=None):
        c = http.client.HTTPConnection("127.0.0.1", 8765, timeout=30)
        h = {"Host": "127.0.0.1:8765", "X-Atlas": "1", "Origin": BASE}
        if ck: h["Cookie"] = ck
        if body is not None: h["Content-Type"] = "application/json"
        c.request(m, p, body=json.dumps(body) if body is not None else None, headers=h); r = c.getresponse(); d = r.read(); hd = dict(r.getheaders()); c.close(); return r.status, hd, d
    _, h, _ = req("GET", "/login?key=" + sec.local_key()); ck = h["Set-Cookie"].split(";")[0]
    url = json.loads(req("POST", "/api/pair", {}, ck)[2])["url"]; req("GET", "/logout", ck=ck)
    return url.split("code=")[1]

with sync_playwright() as p:
    b = p.chromium.launch(channel="chrome", headless=True)
    ctx = b.new_context(**p.devices["Pixel 7"]); pg = ctx.new_page(); pg.on("dialog", lambda d: d.accept())
    pg.goto(BASE + "/"); check("Locked screen has a code box", pg.locator("#code").count() == 1, pg.title())
    code = new_code()
    pg.fill("#code", code); pg.click("button[type=submit]"); pg.wait_for_url(BASE + "/"); pg.wait_for_load_state("networkidle"); pg.wait_for_timeout(800)
    check("The code unlocks the phone", pg.locator("#lock").count() == 1, "")
    n = len(sec.devices())
    pg.go_back(); pg.wait_for_timeout(800)
    back = pg.url
    check("Back does not bring the lock screen back", "Atlas is locked" not in (pg.content() if back.startswith(BASE) else ""), back)
    pg.goto(BASE + "/pair?code=" + code); pg.wait_for_timeout(800)
    check("A used code while unlocked just opens Atlas", pg.locator("#lock").count() == 1 and len(sec.devices()) == n, pg.url)
    pg.reload(); pg.wait_for_timeout(800)
    check("Still unlocked after reopening", pg.locator("#lock").count() == 1, "")
    color = pg.evaluate("getComputedStyle(document.querySelector('#lock')).backgroundColor")
    check("Lock button is red and on screen", color == "rgb(200, 54, 47)" and pg.locator("#lock").is_visible(), color)
    # opening from the home screen: Android starts the app like a link from outside the site
    launcher = "data:text/html,<a id=go href='" + BASE + "/'>open</a>"
    pg.goto(launcher); pg.click("#go"); pg.wait_for_url(BASE + "/"); pg.wait_for_load_state("networkidle"); pg.wait_for_timeout(1200)
    check("Opening from the home screen keeps the phone signed in", pg.locator("#lock").count() == 1, "")
    ck = [c for c in ctx.cookies() if c["name"] == "atlas"][0]
    ctx.add_cookies([{**ck, "sameSite": "Strict"}])                     # a sign-in from before this fix
    pg.goto(launcher); pg.click("#go"); pg.wait_for_timeout(2500)
    check("An older sign-in also opens straight in", pg.locator("#lock").count() == 1, pg.url)
    check("and is renewed for the home screen", [c for c in ctx.cookies() if c["name"] == "atlas"][0]["sameSite"] == "Lax", "")
    pg.click("#lock"); pg.wait_for_timeout(1000)
    check("Lock signs this phone out", "Atlas is locked" in pg.content() and len(sec.devices()) == n - 1, len(sec.devices()))
    pg.goto(BASE + "/map.json"); check("After Lock the data is closed", "sign in first" in pg.content(), "")
    b.close()
print(json.dumps({"passed": sum(r[1] for r in R), "total": len(R), "failed": [r[0] for r in R if not r[1]]}))
