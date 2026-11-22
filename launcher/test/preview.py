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

def swipe(page, y0, y1, x=206, ms=200, sel="#home"):
    """A one-finger swipe made of touch events, as on the phone (Chromium here has no touch-drag of its own)."""
    page.evaluate("""([x, y0, y1, ms, sel]) => new Promise(done => {
        const el = document.elementFromPoint(x, y0) || document.querySelector(sel), n = 8;
        const T = y => new Touch({ identifier: 7, target: el, clientX: x, clientY: y });
        const ev = (type, y, on) => el.dispatchEvent(new TouchEvent(type, { touches: on ? [T(y)] : [], changedTouches: [T(y)], bubbles: true, cancelable: true }));
        ev('touchstart', y0, true); let i = 0;
        const tick = () => { i++; const y = y0 + (y1 - y0) * i / n; ev('touchmove', y, true); if (i < n) setTimeout(tick, ms / n); else { ev('touchend', y, false); done(); } };
        setTimeout(tick, ms / n); })""", [x, y0, y1, ms, sel])

def hswipe(page, x0, x1, y, ms=220, sel="#home"):
    """The same, sideways: right to bring the calendar in, left to put it away, or to move a week, a day or a month."""
    page.evaluate("""([x0, x1, y, ms, sel]) => new Promise(done => {
        const el = document.elementFromPoint(x0, y) || document.querySelector(sel), n = 8;
        const T = x => new Touch({ identifier: 8, target: el, clientX: x, clientY: y });
        const ev = (type, x, on) => el.dispatchEvent(new TouchEvent(type, { touches: on ? [T(x)] : [], changedTouches: [T(x)], bubbles: true, cancelable: true }));
        ev('touchstart', x0, true); let i = 0;
        const tick = () => { i++; const x = x0 + (x1 - x0) * i / n; ev('touchmove', x, true); if (i < n) setTimeout(tick, ms / n); else { ev('touchend', x, false); done(); } };
        setTimeout(tick, ms / n); })""", [x0, x1, y, ms, sel])

def mid_y(page, sel):
    b = page.locator(sel).first.bounding_box()
    return b["y"] + b["height"] / 2


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
    # Settings, Version: one button. No update: it stays and says so. An update: the same button says Update.
    pg.click("#tonebtn"); pg.wait_for_timeout(400)
    pg.click("#o-upd"); pg.wait_for_timeout(300)
    upd_none = [pg.inner_text("#o-upd"), pg.inner_text("#o-updn")]
    pg.evaluate("window.MOCK_UPDATE = {available: true, version: '1.1.1', notes: 'One button for updates.'}")
    pg.click("#o-upd"); pg.wait_for_timeout(300)
    upd_ready = [pg.inner_text("#o-upd"), pg.inner_text("#o-updn"), pg.locator("#o-inst").count()]
    pg.locator("#o-upd").scroll_into_view_if_needed(); pg.screenshot(path=os.path.join(SHOTS, "settings-update.png"))
    pg.click("#o-upd"); pg.wait_for_timeout(300)
    upd_go = [pg.evaluate("window.MOCK_INSTALLS || 0"), pg.inner_text("#o-updn"), pg.locator("#o-upd").is_disabled()]
    # Google from the search bar: a row under the results, Google's suggestions, Enter when no app matches.
    pg.click("#title"); pg.wait_for_timeout(400)
    pg.click("#q"); pg.keyboard.type("weather", delay=30); pg.wait_for_timeout(900)
    rows = pg.locator("#web [data-g]").all_inner_texts()
    pg.screenshot(path=os.path.join(SHOTS, "search-google.png"))
    pg.locator("#web [data-g]").nth(1).click(); pg.wait_for_timeout(150)
    pg.fill("#q", ""); pg.click("#q"); pg.keyboard.type("lunar habitat", delay=20); pg.wait_for_timeout(300)
    pg.keyboard.press("Enter"); pg.wait_for_timeout(150)
    web = pg.evaluate("window.MOCK_WEB || []")
    pg.fill("#q", ""); pg.click("#q"); pg.keyboard.type("chrome", delay=20); pg.wait_for_timeout(300)
    before = pg.evaluate("window.MOCK_LOG.filter(x => x[0] === 'launch').length")
    pg.keyboard.press("Enter"); pg.wait_for_timeout(200)
    enter_app = [pg.evaluate("window.MOCK_LOG.filter(x => x[0] === 'launch').length") - before, len(pg.evaluate("window.MOCK_WEB || []"))]
    # Contacts (1.3.0): between Apps and Files, the apps under each name; tap chats, hold calls; first, Android has to allow it.
    pg.fill("#q", ""); pg.click("#q"); pg.keyboard.type("ad", delay=30); pg.wait_for_timeout(500)
    c_before = [pg.locator("#results h3").all_inner_texts(), pg.locator("#c-allow").count()]
    pg.click("#c-allow"); pg.wait_for_timeout(500)
    c_heads = pg.locator("#results h3").all_inner_texts()
    c_names = pg.locator("[data-cn] .t").all_inner_texts()
    c_apps = pg.locator(".r.in1").all_inner_texts()
    pg.locator(".r.in1", has_text="WhatsApp").first.click(); pg.wait_for_timeout(200)       # opens Message, Call, Video call under it
    c_opts = pg.locator(".r.in2").all_inner_texts()
    c_rows = pg.locator("#results .r").evaluate_all("rs => rs.map(r => (r.classList.contains('in2') ? '    ' : r.classList.contains('in1') ? '  ' : '') + r.querySelector('.t').firstChild.textContent)")
    pg.screenshot(path=os.path.join(SHOTS, "search-contacts.png"))
    pg.locator(".r.in2", has_text="Call").first.click(); pg.wait_for_timeout(150)            # WhatsApp call
    pg.locator(".r.in1", has_text="Phone").first.click(); pg.wait_for_timeout(150)           # one thing: calls at once
    sb = pg.locator(".r.in1", has_text="Signal").first.bounding_box()                        # holding calls
    pg.mouse.move(sb["x"] + 40, sb["y"] + sb["height"] / 2); pg.mouse.down(); pg.wait_for_timeout(650); pg.mouse.up(); pg.wait_for_timeout(200)
    pg.locator("[data-cn]").first.click(); pg.wait_for_timeout(150)
    c_google_rows = pg.locator("#results .r .t").evaluate_all("ts => ts.filter(t => t.textContent.startsWith('Search Google')).map(t => t.textContent)")
    c_reach = pg.evaluate("(window.MOCK_REACH || []).map(a => a.kind + ':' + (a.mime ? a.mime.split('.').slice(-2).join('.') : a.number || a.id))")
    n0 = pg.evaluate("window.MOCK_LOG.length")
    pg.fill("#q", ""); pg.click("#q"); pg.keyboard.type("ada", delay=30); pg.wait_for_timeout(700)
    c_google = [pg.evaluate(f"window.MOCK_LOG.slice({n0}).filter(x => x[0] === 'web.suggest').length"), pg.locator("#web [data-g]").count()]
    pg.fill("#q", ""); pg.click("#q"); pg.keyboard.type("weather", delay=30); pg.wait_for_timeout(700)
    c_google.append(pg.locator("#web [data-g]").count())
    pg.fill("#q", ""); pg.click("#q"); pg.keyboard.type("chrome", delay=20); pg.wait_for_timeout(400)
    c_none = pg.locator("#results h3").all_inner_texts()
    # Claude on the PC (1.5.0): swipe up on Home brings the panel up with the finger; a short pull springs back; swipe
    # down, or Back, puts it away. The tiles, the ring (CPU, GPU or memory) and the projects come from the PC's file.
    pg.click("#title"); pg.wait_for_timeout(300)
    p_short = (swipe(pg, 700, 650), pg.wait_for_timeout(500), pg.evaluate("[PR.open, document.querySelector('#procs').hidden, L.screen]"))[2]
    swipe(pg, 760, 260); pg.wait_for_timeout(700)
    p_open = pg.evaluate("""[PR.open, L.screen, document.querySelectorAll('#p-tiles .ptile').length, document.querySelectorAll('#p-ring path').length,
        document.querySelectorAll('#p-list .pj').length, document.querySelectorAll('#p-list .rq').length, document.querySelector('#p-meta').textContent,
        document.querySelector('#p-idle').textContent]""")
    pg.screenshot(path=os.path.join(SHOTS, "8-claude.png"))
    pg.evaluate("document.querySelector('#p-body').scrollTop = 9999"); pg.wait_for_timeout(200); pg.screenshot(path=os.path.join(SHOTS, "8b-claude-list.png"))
    pg.evaluate("document.querySelector('#p-body').scrollTop = 0")
    pg.click('#p-metric button[data-k="memPct"]'); pg.wait_for_timeout(200)
    p_mem = pg.evaluate("[...document.querySelectorAll('#p-legend li')].map(li => li.textContent)")
    pg.screenshot(path=os.path.join(SHOTS, "8c-claude-memory.png"))
    swipe(pg, 220, 760, sel="#procs"); pg.wait_for_timeout(600)
    p_down = pg.evaluate("[PR.open, document.querySelector('#procs').hidden, L.screen]")
    swipe(pg, 760, 260); pg.wait_for_timeout(600)
    p_back = [pg.evaluate("window.launcherBack()")]; pg.wait_for_timeout(600)
    p_back += pg.evaluate("[PR.open, document.querySelector('#procs').hidden]")
    pg.evaluate("window.MOCK_CLAUDE = null"); swipe(pg, 760, 260); pg.wait_for_timeout(700)
    p_none = pg.evaluate("[document.querySelector('#p-meta').textContent.includes('No numbers'), document.querySelector('#p-main').hidden]")
    pg.evaluate("window.MOCK_CLAUDE = undefined; window.launcherBack()"); pg.wait_for_timeout(500)
    # The calendar (1.6.0): swipe right on Home brings every calendar on the phone in from the left with the finger; a
    # short pull springs back; swipe left, Back or the name on the left puts it away. Agenda, Day, 3 days and Month; an
    # event's details with Join and the answer; Calendars to show, hide or color one; + for a new event. The stand-in's
    # calendars: a Google account, two Outlook accounts and a work profile, with events around today.
    pg.click("#title"); pg.wait_for_timeout(300)
    k_short = (hswipe(pg, 40, 100, 520), pg.wait_for_timeout(500), pg.evaluate("[CAL.open, document.querySelector('#cal').hidden, L.screen]"))[2]
    hswipe(pg, 40, 360, 520); pg.wait_for_timeout(900)
    k_open = pg.evaluate("""[CAL.open, L.screen, CAL.view, CAL.sel === todayJd(), document.querySelectorAll('#c-strip .cweek button').length,
        document.querySelector('.cday.today .cdh').textContent, [...document.querySelectorAll('.cday.today .crow .cn')].map(x => x.textContent),
        document.querySelectorAll('.crow .cj').length > 0, document.querySelector('#c-meta').textContent]""")
    pg.screenshot(path=os.path.join(SHOTS, "9-calendar.png"))
    sy = mid_y(pg, "#c-strip"); hswipe(pg, 360, 60, sy, sel="#c-strip"); pg.wait_for_timeout(400)
    k_week = pg.evaluate("CAL.sel - todayJd()")
    pg.click("#c-today"); pg.wait_for_timeout(400)
    k_week = [k_week, pg.evaluate("CAL.sel === todayJd() && CAL.open")]
    # Stand-up: repeats on weekdays, a Teams meeting someone else organized. Join, then Tentative for this event only.
    pg.evaluate("[...document.querySelectorAll('.crow')].find(r => r.textContent.includes('Stand-up') && +r.dataset.jd >= todayJd()).click()"); pg.wait_for_timeout(700)
    k_event = pg.evaluate("""[document.querySelector('#panel h2').textContent, document.querySelector('.cchip').textContent, document.querySelector('.cwhen').textContent,
        !!document.querySelector('#e-join'), document.querySelectorAll('#e-rsvp button').length, !!document.querySelector('#e-one'),
        document.querySelector('.cpeople .note').textContent, document.querySelectorAll('.cnotes .clink').length]""")
    pg.screenshot(path=os.path.join(SHOTS, "9b-event.png"))
    pg.click("#e-join"); pg.wait_for_timeout(150)
    pg.click('#e-rsvp button[data-s="4"]'); pg.wait_for_timeout(400)
    k_said = pg.inner_text("#e-said")
    k_calls = pg.evaluate("window.MOCK_LOG.filter(x => x[0] === 'cal.go' || x[0] === 'cal.respond').map(x => x[0] + ' ' + JSON.stringify(x[1]).slice(0, 70))")
    pg.evaluate("window.launcherBack()"); pg.wait_for_timeout(400)
    k_back1 = pg.evaluate("[CAL.open, document.body.classList.contains('sheeton')]")
    # the views: the hours (one day, three days) and the month
    k_views = {}
    for v in ("day", "3day", "month"):
        pg.click(f'#c-views button[data-v="{v}"]'); pg.wait_for_timeout(450)
        k_views[v] = pg.evaluate("[document.querySelectorAll('#c-body .cev').length, document.querySelectorAll('#c-body .cgcol').length, !!document.querySelector('.cnow'), document.querySelectorAll('.cmgrid button').length, document.querySelector('#c-strip').hidden]")
        pg.screenshot(path=os.path.join(SHOTS, f"9c-{v}.png"))
    m0 = pg.evaluate("dateOf(CAL.sel).getMonth()"); hswipe(pg, 360, 60, mid_y(pg, ".cmgrid"), sel=".cmgrid"); pg.wait_for_timeout(400)
    k_month = [(pg.evaluate("dateOf(CAL.sel).getMonth()") - m0) % 12, pg.evaluate("CAL.open")]
    pg.click("#c-today"); pg.wait_for_timeout(300)
    pg.click('#c-views button[data-v="3day"]'); pg.wait_for_timeout(400)
    d0 = pg.evaluate("CAL.sel"); hswipe(pg, 360, 60, 600, sel=".ctime"); pg.wait_for_timeout(400)
    k_days = [pg.evaluate("CAL.sel") - d0, pg.evaluate("CAL.open")]
    pg.click("#c-today"); pg.click('#c-views button[data-v="day"]'); pg.wait_for_timeout(400)
    # an empty hour in the day: a new event there, on the half hour. Save one, and it's in the day.
    pg.evaluate(f"document.querySelector('#c-body').scrollTop = 5 * HOUR"); pg.wait_for_timeout(200)
    gb = pg.locator(".cgcol").first.bounding_box(); top = pg.evaluate("document.querySelector('.cgcol').getBoundingClientRect().top")
    pg.mouse.click(gb["x"] + gb["width"] - 40, top + 6.4 * 52); pg.wait_for_timeout(500)
    k_new = pg.evaluate("[!!document.querySelector('#n-title'), document.querySelector('#n-st').value, document.querySelector('#n-et').value, document.querySelector('#n-cal').selectedOptions[0].textContent, document.querySelector('#n-rem').value]")
    pg.screenshot(path=os.path.join(SHOTS, "9d-new.png"))
    pg.fill("#n-title", "Site visit"); pg.fill("#n-loc", "Hangar 3"); pg.select_option("#n-cal", index=2)
    pg.click("#n-save"); pg.wait_for_timeout(700)
    k_new += [pg.evaluate("window.MOCK_LOG.filter(x => x[0] === 'cal.create').map(x => [x[1].title, x[1].loc, x[1].allDay, x[1].remind, new Date(x[1].begin).getHours()])"),
              pg.evaluate("[...document.querySelectorAll('.cev')].some(e => e.textContent.includes('Site visit'))"), pg.inner_text("#toast")]
    # Calendars: tap Family to hide its events here, tap again to show them; hold it for a color; turn on Birthdays
    pg.click('#c-views button[data-v="agenda"]'); pg.wait_for_timeout(300)
    pg.click("#c-cals"); pg.wait_for_timeout(400)
    pg.screenshot(path=os.path.join(SHOTS, "9e-calendars.png"))
    count = "[...CAL.days.values()].flat().filter(e => e.cal === 2 && !e.w).length"
    n0 = pg.evaluate(count); pg.locator(".ccal", has_text="Family").click(); pg.wait_for_timeout(300)
    k_hide = [n0, pg.evaluate(count), pg.evaluate("CAL.hide")]
    pg.locator(".ccal", has_text="Family").click(); pg.wait_for_timeout(300); k_hide.append(pg.evaluate(count))
    fb = pg.locator(".ccal", has_text="Family").bounding_box()
    pg.mouse.move(fb["x"] + 60, fb["y"] + fb["height"] / 2); pg.mouse.down(); pg.wait_for_timeout(650); pg.mouse.up(); pg.wait_for_timeout(300)
    k_color = [pg.evaluate("!!document.querySelector('.cswatches')")]
    pg.click('.csw[data-col="amber"]'); pg.wait_for_timeout(300)
    k_color += [pg.evaluate("JSON.stringify(CAL.colors)"), pg.evaluate("getComputedStyle([...document.querySelectorAll('.ccal')].find(b => b.textContent.includes('Family')).querySelector('.sw')).backgroundColor")]
    pg.locator(".ccal", has_text="Birthdays").click(); pg.wait_for_timeout(300)
    k_color.append(pg.evaluate("[window.MOCK_LOG.filter(x => x[0] === 'cal.show').length, document.querySelector('#toast').textContent]"))
    pg.evaluate("CAL.colors = {}; saveCal(); window.launcherBack()"); pg.wait_for_timeout(300)
    # away: swipe left on the agenda; then Back; then the name on the left
    hswipe(pg, 360, 40, 640, sel="#c-body"); pg.wait_for_timeout(600)
    k_away = [pg.evaluate("[CAL.open, document.querySelector('#cal').hidden]")]
    hswipe(pg, 40, 360, 520); pg.wait_for_timeout(600); k_away.append(pg.evaluate("[window.launcherBack(), CAL.open]")); pg.wait_for_timeout(500)
    hswipe(pg, 40, 360, 520); pg.wait_for_timeout(600); pg.click("#c-title"); pg.wait_for_timeout(500); k_away.append(pg.evaluate("[CAL.open, L.screen]"))
    # Android not asked yet: the first swipe asks; while there's no answer the calendar says why, Allow calendars asks again
    pg.evaluate("window.MOCK_CAL_OK = false; window.MOCK_CAL_DENY = true; CAL.asked = false; CAL.ready = false; CAL.allowed = null; CAL.closedAt = 0")
    hswipe(pg, 40, 360, 520); pg.wait_for_timeout(800)
    k_perm = [pg.evaluate("[CAL.allowed, !!document.querySelector('[data-act=allow]'), document.querySelector('#c-new').hidden, window.MOCK_LOG.filter(x => x[0] === 'cal.allow').map(x => x[1])]")]
    pg.screenshot(path=os.path.join(SHOTS, "9f-allow.png"))
    pg.evaluate("window.MOCK_CAL_DENY = false"); pg.click("[data-act=allow]"); pg.wait_for_timeout(700)
    k_perm.append(pg.evaluate("[CAL.allowed, document.querySelectorAll('.crow').length > 0]"))
    # ivory
    pg.evaluate("L.theme = { ...theme(), ivory: true }; applyTheme()"); pg.wait_for_timeout(300)
    pg.screenshot(path=os.path.join(SHOTS, "9g-ivory.png"))
    pg.evaluate("L.theme = { ...theme(), ivory: false }; applyTheme(); window.launcherBack()"); pg.wait_for_timeout(500)
    # Home Assistant (1.6.1): swipe left on Home brings its tile in from the right with the finger and opens the app; a
    # short pull springs back; the tile goes once Atlas is behind the app. The calendar's swipes stay as they were.
    pg.click("#title"); pg.wait_for_timeout(300)
    launches = "window.MOCK_LOG.filter(x => x[0] === 'launch').map(x => x[1].key.split('/')[0])"
    n0 = len(pg.evaluate(launches))
    h_short = (hswipe(pg, 360, 300, 520), pg.wait_for_timeout(500), pg.evaluate(f"[HA.on, document.querySelector('#ha').hidden, {launches}.length - {n0}]"))[2]
    hswipe(pg, 360, 60, 520, ms=300); pg.wait_for_timeout(120)
    pg.screenshot(path=os.path.join(SHOTS, "10-home-assistant.png"))
    pg.wait_for_timeout(300)
    h_open = pg.evaluate(f"[HA.on, document.querySelector('#ha-v').textContent, {launches}.slice({n0})]")
    pg.evaluate("window.onLauncherEvent({ type: 'pause' })"); pg.wait_for_timeout(200)
    h_back = pg.evaluate("[HA.on, document.querySelector('#ha').hidden, L.screen]")
    hswipe(pg, 40, 360, 520); pg.wait_for_timeout(700)
    h_cal = [pg.evaluate("CAL.open")]
    hswipe(pg, 360, 40, 640, sel="#c-body"); pg.wait_for_timeout(600)
    h_cal += pg.evaluate(f"[CAL.open, HA.on, {launches}.length - {n0}]")
    # Sun (1.4.0): picking Sun asks for the phone's place (the stand-in answers Lisbon); the boxes follow the sky there.
    # The clock is frozen at moments of 2026-11-20 in Lisbon's time; the colors glide for 0.9 s to each new moment.
    sx = b.new_context(viewport={"width": 412, "height": 915}, device_scale_factor=2, has_touch=True, is_mobile=True,
                       timezone_id="Europe/Lisbon", locale="en-US")
    sp = sx.new_page()
    sp.on("pageerror", lambda e: errors.append(str(e)))
    sp.on("console", lambda m: errors.append(m.text) if m.type == "error" else None)
    sp.goto("http://127.0.0.1:8811/index.html"); sp.wait_for_timeout(900)
    sp.click("#tonebtn"); sp.wait_for_timeout(400)
    s_note0 = sp.inner_text("#o-look")
    sp.click('#o-mode button[data-m="sun"]'); sp.wait_for_timeout(1200)
    s_asked = sp.evaluate("window.MOCK_LOG.filter(x => x[0] === 'place.allow').map(x => x[1])")
    s_state = sp.evaluate("[document.body.classList.contains('sun'), L.placeOk, L.place && [L.place.lat, L.place.lon], document.querySelector('#wheel').hidden, document.querySelector('#sunday').hidden, document.querySelector('#o-place').hidden]")
    s_files = sp.evaluate("window.MOCK_FILES_THEME")
    sp.evaluate("""() => { const d0 = new Date(2026, 10, 20).getTime(); window.__T = d0 + 15 * 3600e3; Date.now = () => window.__T; skyPaint(true); paintLook(); }""")
    sp.wait_for_timeout(1100)
    sp.locator("#s-look").scroll_into_view_if_needed(); sp.screenshot(path=os.path.join(SHOTS, "sun-settings.png"))
    s_note = sp.inner_text("#o-look")
    day = sp.evaluate("""() => { const d0 = new Date(2026, 10, 20).getTime(), t = sunTimes(where(), d0, 864e5);
        let noon = d0, best = -99; for (let m = 0; m < 1440; m += 1) { const e = sunPos(d0 + m * 6e4, L.place.lat, L.place.lon).el; if (e > best) { best = e; noon = d0 + m * 6e4; } }
        return { d0, rise: t.rise, set: t.set, noon, top: best }; }""")
    MIN = 60e3
    moments = [("night", day["d0"] + 3 * 3600e3), ("nautical dawn", day["rise"] - 50 * MIN), ("blue hour", day["rise"] - 18 * MIN),
               ("sunrise", day["rise"] + 3 * MIN), ("golden hour", day["rise"] + 40 * MIN), ("midday", day["noon"]),
               ("golden hour pm", day["set"] - 35 * MIN), ("sunset", day["set"] + 2 * MIN), ("dusk", day["set"] + 25 * MIN),
               ("late dusk", day["set"] + 55 * MIN), ("night pm", day["d0"] + 22 * 3600e3)]
    sp.click("#title"); sp.wait_for_timeout(400)
    s_rows, s_shots = [], []
    for i, (name, t) in enumerate(moments):
        sp.evaluate(f"() => {{ window.__T = {t}; skyPaint(true); }}"); sp.wait_for_timeout(1100)
        f = os.path.join(SHOTS, f"sun-{i:02d}-{name.replace(' ', '-')}.png"); sp.screenshot(path=f); s_shots.append((name, f))
        s_rows.append(sp.evaluate("""() => { const cs = getComputedStyle(document.documentElement), s = skyAt(Date.now(), where());
            return [new Date(Date.now()).toLocaleTimeString('en-US', {hour: 'numeric', minute: '2-digit'}), skyPhase(s), +s.el.toFixed(1),
              cs.getPropertyValue('--s0').trim(), cs.getPropertyValue('--s5').trim(), getComputedStyle(document.querySelector('.box.top')).color]; }"""))
    # the maps take the sky at their own brightness: gray at night, blue by day
    sp.evaluate(f"() => {{ window.__T = {day['noon']}; skyPaint(true); }}"); sp.click("#box-apps"); sp.wait_for_timeout(500)
    s_tiles_day = sp.evaluate("[...document.querySelectorAll('#map .tile')].slice(0, 400).map(t => +t.style.getPropertyValue('--c')).reduce((a, b) => Math.max(a, b), 0)")
    sp.screenshot(path=os.path.join(SHOTS, "sun-apps-midday.png"))
    sp.evaluate(f"() => {{ window.__T = {day['d0'] + 2 * 3600e3}; skyPaint(true); }}"); sp.wait_for_timeout(300)
    s_tiles_night = sp.evaluate("[...document.querySelectorAll('#map .tile')].map(t => +t.style.getPropertyValue('--c')).reduce((a, b) => Math.max(a, b), 0)")
    sp.screenshot(path=os.path.join(SHOTS, "sun-apps-night.png"))
    sp.click("#title"); sp.wait_for_timeout(300)
    sp.evaluate(f"() => {{ window.__T = {day['noon']}; skyPaint(true); }}"); swipe(sp, 760, 260); sp.wait_for_timeout(1200)
    sp.screenshot(path=os.path.join(SHOTS, "sun-claude-midday.png"))
    s_claude = [sp.evaluate("getComputedStyle(document.querySelector('.ptile')).backgroundImage.slice(0, 60)")]
    sp.evaluate(f"() => {{ window.__T = {day['d0'] + 22 * 3600e3}; skyPaint(true); }}"); sp.wait_for_timeout(1200)
    sp.screenshot(path=os.path.join(SHOTS, "sun-claude-night.png"))
    s_claude.append(sp.evaluate("[document.body.classList.contains('skynight'), getComputedStyle(document.querySelector('.ptile')).boxShadow]"))
    sp.evaluate("window.launcherBack()"); sp.wait_for_timeout(500)
    sp.evaluate(f"() => {{ window.__T = {day['noon']}; skyPaint(true); }}"); hswipe(sp, 40, 360, 520); sp.wait_for_timeout(1200)
    sp.screenshot(path=os.path.join(SHOTS, "sun-calendar-midday.png"))
    s_cal = [sp.evaluate("getComputedStyle(document.querySelector('#c-strip .on .dn')).backgroundImage.slice(0, 40)")]
    sp.evaluate(f"() => {{ window.__T = {day['d0'] + 22 * 3600e3}; skyPaint(true); }}"); sp.wait_for_timeout(1200)
    sp.screenshot(path=os.path.join(SHOTS, "sun-calendar-night.png"))
    s_cal.append(sp.evaluate("[document.body.classList.contains('skynight'), getComputedStyle(document.querySelector('#c-strip .on .dn')).boxShadow]"))
    sp.evaluate("window.launcherBack()"); sp.wait_for_timeout(500)
    hswipe(sp, 360, 60, 520); sp.wait_for_timeout(400)
    sp.screenshot(path=os.path.join(SHOTS, "sun-home-assistant-night.png"))
    s_cal.append(sp.evaluate("[getComputedStyle(document.querySelector('.hatile')).backgroundImage.slice(0, 40), getComputedStyle(document.querySelector('.hatile')).boxShadow]"))
    sp.evaluate("window.onLauncherEvent({ type: 'pause' })"); sp.wait_for_timeout(300)
    sp.click("#title"); sp.click("#tonebtn"); sp.wait_for_timeout(400)
    sp.click('#o-mode button[data-m="solid"]'); sp.wait_for_timeout(300)
    s_back = sp.evaluate("[document.body.classList.contains('sun'), window.MOCK_FILES_THEME, getComputedStyle(document.querySelector('#mh .t')).backgroundColor]")
    sx.close()
    try:                                                    # one sheet of the day's home screens, to look at side by side
        from PIL import Image
        ims = [Image.open(f) for _, f in s_shots]; w, h = ims[0].size; k = 4
        sheet = Image.new("RGB", (w // k * len(ims), h // k), "black")
        for i, im in enumerate(ims): sheet.paste(im.resize((w // k, h // k)), (i * w // k, 0))
        sheet.save(os.path.join(SHOTS, "sun-day.png"))
    except ImportError: pass
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
print("update, none:", upd_none, "| ready:", upd_ready, "| tapped Update:", upd_go)
print("google rows:", rows, "| searched:", web, "| Enter with an app match: launched", enter_app[0], "web searches", enter_app[1])
print("contacts: before allowing", c_before, "| sections", c_heads, "| names", c_names, "| apps", c_apps, "| WhatsApp opened:", c_opts)
print("contacts, the rows:\n" + "\n".join(c_rows))
print("contacts: WhatsApp > Call, Phone, hold Signal, the name ->", c_reach, "| Search Google rows:", c_google_rows, "| no contact matches 'chrome':", c_none)
print("google suggestions asked for 'ad..' while it matched a contact:", c_google[0], "| Google rows then:", c_google[1], "| for 'weather':", c_google[2])
print("sun: note before", repr(s_note0), "| asked for the place:", s_asked, "| state [sun, allowed, place, wheel hidden, strip hidden, button hidden]:", s_state)
print("sun: Atlas in Files gets", s_files, "| Settings says:", repr(s_note))
print("sun: the day in Lisbon, 2026-11-20 [time, phase, sun's height, top color, bottom color, name color]:\n" + "\n".join("  " + str(r) for r in s_rows))
print("sun: strongest tile color at midday", s_tiles_day, "| at night", s_tiles_night, "| back to One color [sun, Files theme, small Home]:", s_back)
print("claude: short pull [open, hidden, screen]:", p_short, "| swiped up [open, screen, tiles, ring slices, projects, requests, meta, idle]:", p_open)
print("claude: memory ring legend:", p_mem, "| swiped down [open, hidden, screen]:", p_down, "| Back [used, open, hidden]:", p_back, "| the file gone, last numbers kept [warned, list hidden]:", p_none)
print("claude in Sun mode: midday tile", s_claude[0], "| night [skynight, tile edge]:", s_claude[1])
print("calendar: short pull [open, hidden, screen]:", k_short, "| swiped right [open, screen, view, on today, week days, today's title, today's events, a Join, meta]:", k_open)
print("calendar: week strip swiped left [days moved, Today brings it back and it stays open]:", k_week)
print("calendar: Stand-up [title, calendar, when, Join, answers, this/every, people, links in notes]:", k_event)
print("calendar: after Tentative:", repr(k_said), "| asked Android for:", k_calls, "| Back with the details open [calendar open, sheet]:", k_back1)
print("calendar: views [events, day columns, now line, month cells, strip hidden]:", k_views, "| month swiped [months moved, open]:", k_month, "| 3 days swiped [days moved, open]:", k_days)
print("calendar: new event from an empty hour [form, start, end, calendar, reminder]:", k_new[:5], "| saved:", k_new[5:])
print("calendar: Family hidden [events before, after, hide list, shown again]:", k_hide, "| color [picker, saved, swatch]:", k_color)
print("calendar: away [swipe left], [Back used, open], [name on the left]:", k_away, "| not allowed [allowed, Allow button, + hidden, asked], then allowed:", k_perm)
print("calendar in Sun mode: picked day midday", s_cal[0], "| night [skynight, edge]:", s_cal[1])
print("home assistant: short pull [on, hidden, launches]:", h_short, "| swiped left [on, says, launched]:", h_open, "| Atlas behind it [on, hidden, screen]:", h_back)
print("home assistant: then the calendar [opens, left swipe on it: open, HA on, launches since]:", h_cal, "| at night in Sun mode [tile, edge]:", s_cal[2])
print("errors:", errors or "none")
