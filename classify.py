# classify.py: decides where every folder goes in Atlas. No review step.
# Order of decision for each folder: your correction from the map (overrides.json), a fixed place,
# a known folder name, document numbers, keyword votes from the folder's name and file names,
# and otherwise Unsorted. A protected tree (kind "tree") is linked as it is and never reclassified.
# Every rule comes from atlas.config.json (see config.py); nothing personal is in this file.
import os, re, json, sqlite3, time, hashlib, fnmatch
from collections import defaultdict
import config as cfg

HERE = cfg.HERE
DB, OVR = os.path.join(HERE, "index.db"), os.path.join(cfg.STATE, "overrides.json")
C = cfg.C
VIEW, STATES, CATS = cfg.VIEW, cfg.STATES, cfg.CATS
W = cfg.W                                    # Windows paths, also when Atlas runs on a Linux server
U = C.get("unsorted", "U")
TAG = {s["id"]: s.get("tag", s["id"]) for s in cfg.SOURCES}
RANK = {s["id"]: s.get("rank", i) for i, s in enumerate(cfg.SOURCES)}
ROOT_OF = [(s["id"], s["path"]) for s in cfg.SOURCES]
DEFAULT_ROOT = cfg.SOURCES[-1]["id"]

NAMES = {n: cat for cat, names in C.get("names", {}).items() for n in names.split("|")}
ALIASES = C.get("name_aliases", {})
SKIP = set(C.get("skip_names", "").split("|")) - {""}
KW = C.get("keywords", {})
KWSET = {c: (set(v.split("|")[0].split()), set(v.split("|")[1:])) for c, v in KW.items()}
TOK = re.compile(r"[a-z0-9à-ÿ]+")
DOCS = C.get("doc_numbers") or {}
ARCH = C.get("archive_rules", {"copies": 0.5, "years": 2})
NEVER = {W.normcase(p) for p in C.get("never", [])}
PARENTS = [tuple(p) for p in C.get("parents", [])]


def tokens(text):
    t = TOK.findall(text.lower())
    return set(t) | {a + " " + b for a, b in zip(t, t[1:])}


def hits(toks):
    out = {}
    for c, (words, phrases) in KWSET.items():
        m = (toks & words) | (toks & phrases)
        if m: out[c] = m
    return out


def fid(source):
    return "f" + hashlib.sha1(source.encode("utf-8")).hexdigest()[:10]


def root_of(path):
    for tag, base in ROOT_OF:
        if path.lower().startswith(base.lower() + "\\"): return tag
    return DEFAULT_ROOT


def units():
    """The folders that get a place of their own: (source, kind, root, (state, category, why), display name)."""
    return [(u["path"], u.get("kind", "dir"), u["source"], (u["state"], CATS[u["category"]], u["why"]), u.get("name"))
            for u in C.get("fixed", [])]


def _day(t):
    return time.strftime("%Y-%m-%d", time.localtime(t)) if t else ""


def _entry(name, v, kids=None):
    e = {"name": name, "files": v[0], "gb": round(v[1] / 1e9, 3), "newest": _day(v[2])}
    if kids: e["kids"] = kids
    return e


def _pack(items, top, more):
    """The largest `top` entries by size; the rest summed into one "(N more ...)" entry."""
    items = sorted(items, key=lambda kv: -kv[1][1])
    keep, rest = items[:top], items[top:]
    if rest:
        keep.append((f"({len(rest)} more {more})", [sum(v[0] for _, v in rest), sum(v[1] for _, v in rest), max(v[2] for _, v in rest)]))
    return keep


def subfolders(db, sources, deep=10, share=0.04):
    """One pass over the index: for each folder in `sources`, its first-level subfolders with files, size and
    last change, and inside the larger ones (at least `share` of the folder) their own subfolders. Files sitting
    directly in a folder are one entry. Returns a function source, top -> list for the map."""
    want = {W.normcase(s): s for s in sources}
    lvl1 = defaultdict(lambda: defaultdict(lambda: [0, 0, 0.0]))
    lvl2 = defaultdict(lambda: defaultdict(lambda: defaultdict(lambda: [0, 0, 0.0])))
    total = defaultdict(int)
    for (path, size, mtime) in db.execute("SELECT path, size, mtime FROM files"):
        parts = path.split("\\")
        for i in range(len(parts) - 1, 0, -1):                 # the deepest folder in the list that holds the file
            src = want.get(W.normcase("\\".join(parts[:i])))
            if src is None: continue
            p = parts[i:]
            a = p[0] if len(p) > 1 else "(files at the top)"
            k = lvl1[src][a]; k[0] += 1; k[1] += size; k[2] = max(k[2], mtime); total[src] += size
            if len(p) > 1:
                b = p[1] if len(p) > 2 else "(files here)"
                k = lvl2[src][a][b]; k[0] += 1; k[1] += size; k[2] = max(k[2], mtime)
            break

    def get(source, top=30):
        out = []
        for name, v in _pack(lvl1[source].items(), top, "folders"):
            kids = None
            sub2 = lvl2[source].get(name)
            if sub2 and len(sub2) > 1 and v[1] >= share * max(total[source], 1):
                kids = [_entry(n, w) for n, w in _pack(sub2.items(), deep, "folders")]
            out.append(_entry(name, v, kids))
        return out
    return get


def classify(prev=None, missing_roots=()):
    db = sqlite3.connect(DB)
    ovr = {}
    if os.path.exists(OVR):
        try: ovr = json.load(open(OVR, encoding="utf-8"))
        except Exception: ovr = {}
    fixed = units()
    taken = {W.normcase(u[0]) for u in fixed} | NEVER
    found = []  # (source, kind, root)
    for root, base, depth in PARENTS:
        kids, loose = set(), False
        for (rel,) in db.execute("SELECT rel FROM files WHERE path LIKE ? || '%'", (base + "\\",)):
            p = rel.split("\\")
            if len(p) <= depth:
                loose = True
                if depth == 2 and len(p) == 2: kids.add(("loose", p[0]))
            else: kids.add(("dir", "\\".join(p[:depth])))
        if loose and depth == 1: found.append((base + "\\|files", "loose", root))
        for k, rel in sorted(kids):
            src = base + "\\" + rel
            if k == "loose": found.append((src + "\\|files", "loose", root)); continue
            if W.normcase(src) in taken: continue
            found.append((src, "dir", root))

    # Per-folder statistics in one pass over the index
    best = {}
    for name, size, root in db.execute("SELECT lower(name), size, root FROM files"):
        k = (name, size); best[k] = min(best.get(k, 9), RANK.get(root, 9))
    allu = [(u[0], u[1], u[2]) for u in fixed] + found
    folder = {W.normcase(s): i for i, (s, k, r) in enumerate(allu) if k != "loose"}
    loosemap = {W.normcase(s[:-7]): i for i, (s, k, r) in enumerate(allu) if k == "loose"}
    st = [dict(files=0, bytes=0, dup=0, newest=0.0, docs=0, votes=defaultdict(int), words=defaultdict(set), kinds=defaultdict(int))
          for _ in allu]
    for path, rel, name, size, mtime, root, docnum, kind in db.execute(
            "SELECT path, rel, lower(name), size, mtime, root, docnum, kind FROM files"):
        np_ = W.normcase(path); i = loosemap.get(W.dirname(np_)); d = np_
        while i is None and len(d) > 3:
            d = W.dirname(d); i = folder.get(d)
        if i is None: continue
        s = st[i]; s["files"] += 1; s["bytes"] += size; s["newest"] = max(s["newest"], mtime); s["kinds"][kind] += 1
        if best[(name, size)] < RANK.get(root, 9): s["dup"] += 1
        if docnum: s["docs"] += 1
        if allu[i][1] == "dir":
            inner = W.relpath(path, allu[i][0])
            for c, m in hits(tokens(W.splitext(inner)[0])).items():
                s["votes"][c] += 1; s["words"][c] |= m

    out, now = [], time.time()
    fixmap = {W.normcase(u[0]): u for u in fixed}
    archive = {s["id"]: s for s in cfg.SOURCES if s.get("archive")}
    for i, (src, kind, root) in enumerate(allu):
        s = st[i]
        if s["files"] == 0 and kind != "tree": continue
        base = src[:-7] if kind == "loose" else src
        leaf = W.basename(base)
        lname = leaf.lower()
        fu = fixmap.get(W.normcase(src))
        if kind == "loose": name = f"{leaf} loose files ({TAG.get(root, root)})"
        elif kind == "tree": name = cfg.UI.get("tree_label", "Protected tree")
        elif fu and fu[4]: name = fu[4]
        else: name = f"{leaf} ({TAG.get(root, root)})"
        for pat, real in ALIASES.items():
            if fnmatch.fnmatchcase(lname, pat): lname = real
        dup = s["dup"] / s["files"] if s["files"] else 0
        old = s["newest"] < now - ARCH.get("years", 2) * 365 * 86400
        if kind == "dir" and lname in SKIP:
            continue
        how = "auto"
        if fu:
            state, cat, why = fu[3]; how = "fixed"
        else:
            if kind == "loose":
                cat, why = CATS[U], "files loose at the top of the folder"
            elif lname in NAMES:
                cat, why = CATS[NAMES[lname]], "known folder name"
            elif DOCS and (s["docs"] >= DOCS.get("share", 0.3) * s["files"] or DOCS.get("token", "\0") in tokens(leaf)):
                cat, why = CATS[DOCS["category"]], f"{DOCS.get('label', 'document numbers')} on {s['docs']} files"
            else:
                sc = {c: 6 * len(hits(tokens(leaf)).get(c, ())) + 4 * s["votes"][c] / s["files"] for c in KW}
                ranked = sorted(sc.items(), key=lambda x: -x[1]) + [(None, 0), (None, 0)]
                (c1, v1), (c2, v2) = ranked[0], ranked[1]
                if c1 and v1 >= 1.2 and v1 >= 1.5 * max(v2, 0.01):
                    words = sorted(s["words"][c1] | hits(tokens(leaf)).get(c1, set()))[:4]
                    cat, why = CATS[c1], "keywords: " + ", ".join(words)
                else:
                    cat, why = CATS[U], "no clear signal yet"
            # state: a backup of an old computer is history unless it still holds the newest copies
            if root in archive:
                note = archive[root].get("archive_note", "backup")
                if dup >= ARCH.get("copies", 0.5): state, why = STATES[1], why + f"; {round(dup*100)}% are copies of newer files"
                elif old: state, why = STATES[1], why + f"; {note}, unchanged for {ARCH.get('years', 2)} years"
                else: state = STATES[0]
            else:
                state = STATES[0]
            if cat == CATS[U] and state == STATES[0]: state = STATES[-1]
        o = ovr.get(src)
        if o and kind != "tree":
            if o.get("state") in STATES + ["skip"] and o.get("category") in CATS.values():
                state, cat, why, how = o["state"], o["category"], "moved by you on the map", "you"
        out.append(dict(id=fid(src), source=src, kind=kind, root=root, name=name, state=state, category=cat,
                        why=why, how=how, files=s["files"], gb=round(s["bytes"] / 1e9, 3), dup=round(dup * 100),
                        newest=time.strftime("%Y-%m-%d", time.localtime(s["newest"])) if s["newest"] else "",
                        top_kind=max(s["kinds"].items(), key=lambda x: x[1])[0] if s["kinds"] else ""))
    # Each folder's subfolders, two levels down, so the map can show more detail as you zoom in.
    # A protected tree keeps its whole first level (it is shown that way); other folders keep their largest ones.
    subs = subfolders(db, [o["source"] for o in out if o["kind"] != "loose"])
    for o in out:
        if o["kind"] == "loose": continue
        o["children"] = subs(o["source"], top=200 if o["kind"] == "tree" else 30)
    # Folders on a source that is offline right now (a cloud drive not mounted yet) keep their last place
    if prev and missing_roots:
        have = {o["source"] for o in out}
        for o in prev.get("folders", []):
            if o["root"] in missing_roots and o["source"] not in have:
                o = dict(o); o["offline"] = True
                if o.get("kind") == "arx": o["kind"] = "tree"          # maps saved before the rename
                out.append(o)
    db.close()
    return out


if __name__ == "__main__":
    res = classify()
    from collections import Counter
    print(Counter((r["state"], r["category"]) for r in res))
    for r in res:
        if r["how"] == "auto" and r["category"] == CATS[U]: print("UNSORTED", r["name"], r["files"], r["why"])
        elif r["why"].startswith("keywords"): print("VOTE", r["name"], "->", r["category"], r["why"])
