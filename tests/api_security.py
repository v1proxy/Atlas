# Atlas API and security checks. Runs on the PC against the live service at 127.0.0.1:8765.
# Makes its own test folder in Downloads (and one in Google Drive for the delete check) and removes it at the end.
import http.client, json, os, sys, time, urllib.parse, shutil
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import security as sec, config as cfg

H, PORT = "127.0.0.1", 8765
T = os.path.join(os.path.expanduser("~"), "Downloads", "Atlas_selftest")
GD = cfg.SOURCE.get("gdrive", {}).get("path")          # Google Drive, if this PC has it
G = os.path.join(GD, "Atlas_selftest") if GD else None
RO = [p for p in sec.ROOTS_RO if os.path.isdir(p)]           # read-only folders from the config
RES = []


def req(method, path, body=None, cookie=None, host=f"127.0.0.1:{PORT}", headers=None):
    c = http.client.HTTPConnection(H, PORT, timeout=60)
    hd = {"Host": host}
    if cookie: hd["Cookie"] = cookie
    if body is not None: hd["Content-Type"] = "application/json"
    hd.update(headers or {})
    c.request(method, path, body=json.dumps(body) if body is not None else None, headers=hd)
    r = c.getresponse(); data = r.read(); c.close()
    return r.status, dict(r.getheaders()), data


def check(name, ok, detail=""):
    RES.append((name, bool(ok), detail)); print(("PASS " if ok else "FAIL ") + name + (f"  [{detail}]" if detail else ""))


def q(p, **kw): return p + "?" + urllib.parse.urlencode(kw)


def main():
    # ---- fixture -------------------------------------------------------------------------------
    shutil.rmtree(T, ignore_errors=True); os.makedirs(os.path.join(T, "sub"))
    from PIL import Image
    Image.new("RGB", (640, 400), (200, 54, 52)).save(os.path.join(T, "red.png"))
    Image.new("RGB", (300, 200), (40, 40, 40)).save(os.path.join(T, "doc.pdf"))
    open(os.path.join(T, "notes.txt"), "w").write("hello atlas\n")
    open(os.path.join(T, "page.html"), "w").write("<script>document.title='pwned'</script><h1>x</h1>")
    open(os.path.join(T, "cube.stl"), "w").write("solid c\n" + "".join(
        f"facet normal 0 0 0\nouter loop\nvertex {a}\nvertex {b}\nvertex {c}\nendloop\nendfacet\n"
        for a, b, c in [("0 0 0", "1 0 0", "1 1 0"), ("0 0 0", "1 1 0", "0 1 0"), ("0 0 1", "1 0 1", "1 1 1"), ("0 0 1", "1 1 1", "0 1 1")]) + "endsolid c\n")

    # ---- sign-in and host checks ---------------------------------------------------------------
    s, h, b = req("GET", "/")
    check("Page is locked without sign-in", s == 401 and b"Atlas is locked" in b, s)
    s, h, b = req("GET", "/map.json")
    check("Folder data refused without sign-in", s == 401, s)
    s, h, b = req("GET", q("/api/ls", path=T))
    check("File listing refused without sign-in", s == 401, s)
    s, h, b = req("GET", "/map.json", host="evil.example:8765")
    check("Foreign Host header refused (DNS rebinding)", s == 421, s)
    s, h, b = req("GET", q("/login", key="wrong"))
    check("Wrong sign-in key refused", s == 403, s)
    key = sec.local_key()
    s, h, b = req("GET", q("/login", key=key), headers={"Tailscale-User-Login": "someone@example.com", "X-Forwarded-For": "100.64.0.9"})
    check("PC sign-in key refused when it arrives through Tailscale", s == 403, s)
    for _ in range(3): time.sleep(0)   # throttle window is per minute; the next login must still pass
    s, h, b = req("GET", q("/login", key=key))
    ck = h.get("Set-Cookie", "")
    check("PC sign-in sets an HttpOnly, SameSite=Strict cookie", s == 200 and "HttpOnly" in ck and "SameSite=Strict" in ck, ck[:60])
    cookie = ck.split(";")[0]
    s, h, b = req("GET", "/", cookie=cookie)
    check("Page opens after sign-in", s == 200 and b"<title>Atlas</title>" in b, s)
    csp = h.get("Content-Security-Policy", "")
    check("Page CSP allows only this PC (no outside scripts or fonts)", "default-src 'self'" in csp and "googleapis" not in csp and "frame-ancestors 'none'" in csp)
    s, h, b = req("GET", "/map.json", cookie=cookie)
    check("Folder data with sign-in", s == 200 and b'"folders"' in b, s)
    s, h, b = req("GET", "/map.json", cookie="atlas=forged-token")
    check("Forged cookie refused", s == 401, s)

    # ---- CSRF ----------------------------------------------------------------------------------
    s, h, b = req("POST", "/api/mkdir", {"dir": T, "name": "csrf"}, cookie=cookie)
    check("Write refused without the X-Atlas header", s == 403 and not os.path.exists(os.path.join(T, "csrf")), s)
    s, h, b = req("POST", "/api/mkdir", {"dir": T, "name": "csrf"}, cookie=cookie, headers={"X-Atlas": "1", "Origin": "https://evil.example"})
    check("Write refused from a foreign Origin", s == 403 and not os.path.exists(os.path.join(T, "csrf")), s)
    W = {"X-Atlas": "1", "Origin": f"http://127.0.0.1:{PORT}"}

    # ---- path guard ----------------------------------------------------------------------------
    for name, path in [("Windows folder", r"C:\Windows"), ("Program Files", r"C:\Program Files"), ("user profile root", os.path.expanduser("~")),
                       ("dot-dot escape", T + r"\..\..\..\AppData"), ("UNC path", r"\\127.0.0.1\c$"), ("long path prefix", "\\\\?\\C:\\Windows"),
                       ("alternate data stream", os.path.join(T, "notes.txt:hidden")), ("Atlas's own key file", os.path.join(os.path.dirname(sec.KEY), "local.key")),
                       ("SSH keys", os.path.join(os.path.expanduser("~"), ".ssh"))]:
        s, h, b = req("GET", q("/api/ls", path=path), cookie=cookie)
        s2, h2, b2 = req("GET", q("/api/file", path=path), cookie=cookie)
        check(f"Outside the allowed folders: {name}", s in (403, 404) and s2 in (403, 404), f"{s}/{s2}")
    for ro in RO:
        s, h, b = req("GET", q("/api/ls", path=ro), cookie=cookie)
        flag = json.loads(b).get("readonly") if s == 200 else None
        check(f"Read-only folder can be listed, marked read only: {os.path.basename(ro)}", s == 200 and flag is True, f"{s} readonly={flag}")
        s, h, b = req("POST", "/api/mkdir", {"dir": ro, "name": "x"}, cookie=cookie, headers=W)
        check(f"No new folder in a read-only folder: {os.path.basename(ro)}", s == 403 and not os.path.exists(os.path.join(ro, "x")), s)
        s, h, b = req("POST", "/api/paste", {"items": [os.path.join(T, "notes.txt")], "dest": ro, "mode": "copy"}, cookie=cookie, headers=W)
        check(f"No paste into a read-only folder: {os.path.basename(ro)}", s == 403, s)
    top = sec.ROOTS_RW[0]
    s, h, b = req("POST", "/api/delete", {"items": [top]}, cookie=cookie, headers=W)
    check("A whole top folder cannot be deleted", s == 403 and os.path.isdir(top), s)
    s, h, b = req("POST", "/api/rename", {"path": os.path.join(T, "notes.txt"), "name": r"..\escape.txt"}, cookie=cookie, headers=W)
    check("Rename cannot move a file out with ..\\", s in (400, 403) and os.path.exists(os.path.join(T, "notes.txt")), s)
    s, h, b = req("POST", "/api/rename", {"path": os.path.join(T, "notes.txt"), "name": "CON"}, cookie=cookie, headers=W)
    check("Reserved Windows names refused", s in (400, 403), s)

    # ---- serving files safely ------------------------------------------------------------------
    s, h, b = req("GET", q("/api/file", path=os.path.join(T, "page.html")), cookie=cookie)
    check("HTML files are shown as plain text, sandboxed", s == 200 and h.get("Content-Type", "").startswith("text/plain") and "sandbox" in h.get("Content-Security-Policy", ""), h.get("Content-Type"))
    s, h, b = req("GET", q("/api/file", path=os.path.join(T, "red.png")), cookie=cookie, headers={"Range": "bytes=0-9"})
    check("Range requests for video seeking", s == 206 and len(b) == 10 and h.get("Content-Range", "").startswith("bytes 0-9/"), s)
    s, h, b = req("GET", q("/api/thumb", path=os.path.join(T, "red.png")), cookie=cookie)
    check("Thumbnails", s == 200 and h.get("Content-Type") == "image/jpeg" and len(b) > 100, s)
    import pillow_heif
    pillow_heif.from_pillow(Image.new("RGB", (400, 300), (40, 120, 200))).save(os.path.join(T, "phone.heic"))
    s, h, b = req("GET", q("/api/thumb", path=os.path.join(T, "phone.heic"), s="1600"), cookie=cookie)
    check("iPhone HEIC photos preview (converted on the PC)", s == 200 and h.get("Content-Type") == "image/jpeg", s)
    s, h, b = req("GET", q("/api/text", path=os.path.join(T, "notes.txt")), cookie=cookie)
    check("Text preview", s == 200 and json.loads(b)["text"].startswith("hello atlas"), s)

    # ---- file actions --------------------------------------------------------------------------
    s, h, b = req("POST", "/api/mkdir", {"dir": T, "name": "made"}, cookie=cookie, headers=W)
    check("New folder", s == 200 and os.path.isdir(os.path.join(T, "made")), s)
    s, h, b = req("POST", "/api/rename", {"path": os.path.join(T, "notes.txt"), "name": "renamed.txt"}, cookie=cookie, headers=W)
    check("Rename", s == 200 and os.path.exists(os.path.join(T, "renamed.txt")), s)
    s, h, b = req("POST", "/api/paste", {"items": [os.path.join(T, "renamed.txt"), os.path.join(T, "sub")], "dest": os.path.join(T, "made"), "mode": "copy"}, cookie=cookie, headers=W)
    check("Copy and paste (file and folder)", s == 200 and os.path.exists(os.path.join(T, "made", "renamed.txt")) and os.path.isdir(os.path.join(T, "made", "sub")) and os.path.exists(os.path.join(T, "renamed.txt")), s)
    s, h, b = req("POST", "/api/paste", {"items": [os.path.join(T, "renamed.txt")], "dest": os.path.join(T, "made"), "mode": "copy"}, cookie=cookie, headers=W)
    check("Pasting a name that exists keeps both", s == 200 and any(n.startswith("renamed (") for n in os.listdir(os.path.join(T, "made"))), os.listdir(os.path.join(T, "made")))
    s, h, b = req("POST", "/api/paste", {"items": [os.path.join(T, "made")], "dest": os.path.join(T, "made", "sub"), "mode": "move"}, cookie=cookie, headers=W)
    check("A folder cannot be moved into itself", s in (400, 403) and os.path.isdir(os.path.join(T, "made")), s)
    s, h, b = req("POST", "/api/paste", {"items": [os.path.join(T, "red.png")], "dest": os.path.join(T, "sub"), "mode": "move"}, cookie=cookie, headers=W)
    check("Cut and paste (move)", s == 200 and os.path.exists(os.path.join(T, "sub", "red.png")) and not os.path.exists(os.path.join(T, "red.png")), s)
    s, h, b = req("POST", "/api/tag", {"path": os.path.join(T, "sub", "red.png"), "tags": ["Review", "Client"], "colors": {"Review": "red", "Client": "blue"}}, cookie=cookie, headers=W)
    s2, h2, b2 = req("GET", q("/api/ls", path=os.path.join(T, "sub")), cookie=cookie)
    tags = [e for e in json.loads(b2)["entries"] if e["name"] == "red.png"][0]["tags"]
    check("Color tags saved and shown", s == 200 and tags == ["Review", "Client"], tags)
    s, h, b = req("POST", "/api/rename", {"path": os.path.join(T, "sub", "red.png"), "name": "red2.png"}, cookie=cookie, headers=W)
    s2, h2, b2 = req("GET", q("/api/ls", path=os.path.join(T, "sub")), cookie=cookie)
    tags = [e for e in json.loads(b2)["entries"] if e["name"] == "red2.png"][0]["tags"]
    check("Tags follow a renamed file", tags == ["Review", "Client"], tags)
    s, h, b = req("POST", "/api/delete", {"items": [os.path.join(T, "renamed.txt")]}, cookie=cookie, headers=W)
    import win32com.client
    rb = win32com.client.Dispatch("Shell.Application").Namespace(10)
    inbin = any(it.Name in ("renamed.txt", "renamed") for it in rb.Items())
    check("Delete goes to the Recycle Bin", s == 200 and not os.path.exists(os.path.join(T, "renamed.txt")) and inbin, f"{s} in bin={inbin}")
    s, h, b = req("GET", q("/api/find", q="cube"), cookie=cookie)
    check("File search answers (index refreshes after the next scan)", s == 200 and "results" in json.loads(b), s)

    # ---- Google Drive delete -------------------------------------------------------------------
    gres = "skipped"
    if G and os.path.isdir(GD):
        os.makedirs(G, exist_ok=True)
        gp = os.path.join(G, "atlas-delete-check.txt"); open(gp, "w").write("delete me")
        time.sleep(3)
        s, h, b = req("POST", "/api/delete", {"items": [gp]}, cookie=cookie, headers=W)
        inbin = any(it.Name.startswith("atlas-delete-check") for it in rb.Items())
        gres = f"status {s}, gone={not os.path.exists(gp)}, in Windows Recycle Bin={inbin}"
        check("Delete on Google Drive", s == 200 and not os.path.exists(gp), gres)

    # ---- devices -------------------------------------------------------------------------------
    s, h, b = req("POST", "/api/pair", {}, cookie=cookie, headers=W)
    j = json.loads(b) if b else {}
    check("Pairing code made on the PC (needs Tailscale)", s == 200 and "/pair?code=" in j.get("url", "") and j.get("svg", "").startswith("<?xml") or "<svg" in j.get("svg", ""), f"{s} {j.get('url', j.get('error', ''))[:60]}")
    if s == 200:
        code = urllib.parse.parse_qs(urllib.parse.urlsplit(j["url"]).query)["code"][0]
        s1, h1, _ = req("GET", q("/pair", code=code), headers={"User-Agent": "Mozilla/5.0 (Linux; Android 14) Test"})
        s2, h2, _ = req("GET", q("/pair", code=code), headers={"User-Agent": "Mozilla/5.0 (Linux; Android 14) Test"})
        check("A pairing code works once", s1 == 200 and "Set-Cookie" in h1 and s2 == 403, f"{s1}/{s2}")
        phone = h1.get("Set-Cookie", "").split(";")[0]
        s, h, b = req("POST", "/api/pair", {}, cookie=phone, headers=W)
        check("A phone cannot make more pairing codes", s == 403, s)
        mine = [d for d in json.loads(req("GET", "/api/devices", cookie=phone)[2])["devices"] if d["me"]]
        if mine:
            req("POST", "/api/devices/revoke", {"id": mine[-1]["id"]}, cookie=cookie, headers=W)
            s, h, b = req("GET", "/map.json", cookie=phone)
            check("A signed-out phone loses access at once", s == 401, s)
    s, h, b = req("GET", "/logout", cookie=cookie)
    s, h, b = req("GET", "/map.json", cookie=cookie)
    check("Sign out ends the session", s == 401, s)

    shutil.rmtree(T, ignore_errors=True)
    if G and os.path.isdir(G): shutil.rmtree(G, ignore_errors=True)
    print(json.dumps({"passed": sum(r[1] for r in RES), "failed": [r[0] for r in RES if not r[1]], "gdrive": gres}))


if __name__ == "__main__":
    main()
