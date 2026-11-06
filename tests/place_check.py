# Moves one folder's link to another place on the map, checks the link moved on disk, then gives the choice back to the software.
import http.client, json, os, sys, time
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import security as sec

def req(method, path, body=None, cookie=None):
    c = http.client.HTTPConnection("127.0.0.1", 8765, timeout=60)
    h = {"Host": "127.0.0.1:8765", "X-Atlas": "1", "Origin": "http://127.0.0.1:8765"}
    if cookie: h["Cookie"] = cookie
    if body is not None: h["Content-Type"] = "application/json"
    c.request(method, path, body=json.dumps(body) if body is not None else None, headers=h)
    r = c.getresponse(); d = r.read(); hd = dict(r.getheaders()); c.close(); return r.status, hd, d

s, h, _ = req("GET", "/login?key=" + sec.local_key()); ck = h["Set-Cookie"].split(";")[0]
def wait_map(old):
    for _ in range(60):
        time.sleep(1); m = json.loads(req("GET", "/map.json", cookie=ck)[2])
        if m["generated"] != old: return m
    return m
m = json.loads(req("GET", "/map.json", cookie=ck)[2])
f = next(x for x in m["folders"] if x["kind"] == "dir" and x["how"] == "auto")
before = (f["state"], f["category"], f["link"])
to = "Superseded" if f["state"] != "Superseded" else "Current"
req("POST", "/place", {"id": f["id"], "state": to, "category": f["category"]}, ck)
m2 = wait_map(m["generated"]); g = next(x for x in m2["folders"] if x["id"] == f["id"])
ok1 = g["state"] == to and g["how"] == "you" and os.path.islink(g["link"]) and not os.path.lexists(before[2])
print(("PASS" if ok1 else "FAIL"), "Move a folder to another place on the map:", before[0], "->", g["state"], "| link moved:", os.path.islink(g["link"]))
req("POST", "/place", {"id": f["id"], "state": g["state"], "category": g["category"], "reset": True}, ck)
m3 = wait_map(m2["generated"]); k = next(x for x in m3["folders"] if x["id"] == f["id"])
ok2 = (k["state"], k["category"]) == before[:2] and os.path.islink(before[2]) and k["how"] != "you"
print(("PASS" if ok2 else "FAIL"), "Let the software decide again (back where it was):", k["state"], k["how"])
req("GET", "/logout", cookie=ck)

