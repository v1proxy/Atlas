# shoot.py: takes the screenshots in docs/screenshots from the demo server (invented data only).
#   python docs/demo/demo_server.py        (in one window)
#   python docs/demo/shoot.py              (in another)
import os
from playwright.sync_api import sync_playwright

BASE = "http://127.0.0.1:" + os.environ.get("ATLAS_DEMO_PORT", "8799")
OUT = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "screenshots")
os.makedirs(OUT, exist_ok=True)
HL = r"G:\My Drive\Harbor Library"
ARGS = ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"]


def ready(pg):
    pg.goto(BASE + "/"); pg.wait_for_load_state("networkidle"); pg.evaluate("document.fonts.ready"); pg.wait_for_timeout(900)


def shot(pg, name):
    pg.mouse.move(2, 2); pg.wait_for_timeout(250)
    pg.screenshot(path=os.path.join(OUT, name + ".png")); print("saved", name)


def harbor(pg):
    return pg.evaluate("S.data.folders.find(f => f.name.startsWith('Harbor Library')).id")


def open_file(pg, name, wait=1500):
    pg.locator(".frow").filter(has_text=name).first.click(); pg.wait_for_timeout(wait)


with sync_playwright() as p:
    try: b = p.chromium.launch(args=ARGS)
    except Exception: b = p.chromium.launch(channel="chrome", args=ARGS)

    # ---- PC ------------------------------------------------------------------------------------------
    pg = b.new_context(viewport={"width": 1440, "height": 900}, device_scale_factor=1.5).new_page()
    pg.on("dialog", lambda d: d.accept())
    ready(pg)
    pg.click("#views button[data-v=treemap]"); pg.wait_for_timeout(700)
    hid = harbor(pg); pg.evaluate("id => select(id)", hid); pg.wait_for_timeout(400)
    shot(pg, "pc-1-map")
    pg.fill("#q", "harbor"); pg.wait_for_timeout(1300)
    shot(pg, "pc-2-find"); pg.fill("#q", ""); pg.wait_for_timeout(300)
    pg.click("#views button[data-v=tree]"); pg.wait_for_timeout(900)
    pg.evaluate("id => select(id)", hid); pg.wait_for_timeout(300)
    shot(pg, "pc-3-tree")
    pg.click("#views button[data-v=treemap]"); pg.wait_for_timeout(600)
    pg.evaluate("id => select(id)", hid); pg.wait_for_timeout(300)
    pg.click("#o-browse"); pg.wait_for_timeout(1200)
    open_file(pg, "concept report.pdf", 3500)
    shot(pg, "pc-4-files-pdf")
    open_file(pg, "Massing model.stl", 4500)
    shot(pg, "pc-5-files-3d")
    open_file(pg, "Reading room.jpg", 1500)
    pg.click("#pv-tags"); pg.wait_for_timeout(300)
    shot(pg, "pc-6-tags")
    pg.click("#tg-cancel"); pg.wait_for_timeout(400)
    pg.click("#pv-big"); pg.wait_for_timeout(1500)
    shot(pg, "pc-7-fullscreen"); pg.keyboard.press("Escape"); pg.wait_for_timeout(300)
    pg.click("#fb-back"); pg.wait_for_timeout(600)
    pg.click("#devices"); pg.wait_for_timeout(600); pg.click("#pair"); pg.wait_for_timeout(800)
    shot(pg, "pc-8-devices")
    pg.click("#tonebtn"); pg.click("#tones button[data-k=teal]"); pg.wait_for_timeout(300); pg.click("#tonebtn"); pg.wait_for_timeout(300)
    shot(pg, "pc-9-color")
    pg.click("#tones button[data-k=red]"); pg.wait_for_timeout(200)

    # ---- phone ---------------------------------------------------------------------------------------
    phone = {**p.devices["Pixel 7"], "device_scale_factor": 2}
    m = b.new_context(**phone).new_page(); m.on("dialog", lambda d: d.accept())
    m.goto(BASE + "/locked"); m.wait_for_timeout(500); m.fill("#code", "x7Kq-demo-code"); m.screenshot(path=os.path.join(OUT, "phone-1-unlock.png")); print("saved phone-1-unlock")
    ready(m)
    m.click("#views button[data-v=treemap]"); m.wait_for_timeout(700)
    shot(m, "phone-2-map")
    m.evaluate("id => select(id)", harbor(m)); m.wait_for_timeout(600)
    shot(m, "phone-3-details")
    m.click("#o-browse"); m.wait_for_timeout(1200)
    shot(m, "phone-4-files")
    open_file(m, "Reading room.jpg", 1800)
    shot(m, "phone-5-viewer")
    m.click("#v-close"); m.wait_for_timeout(300); m.click("#sheetx"); m.wait_for_timeout(300)
    m.click("#fb-back"); m.wait_for_timeout(500)
    m.click("#views button[data-v=tree]"); m.wait_for_timeout(900)
    shot(m, "phone-6-tree")
    b.close()
