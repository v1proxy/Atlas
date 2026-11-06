# config.py: everything that belongs to one person's PC lives in atlas.config.json beside this file:
# which folders Atlas reads, which it may change, how folders are sorted, and the words on the map.
# The code holds no personal paths or rules. atlas.config.json is never published (see .gitignore);
# atlas.config.example.json is the starting point for a new install.
import json, os

HERE = os.path.dirname(os.path.abspath(__file__))
PATH = os.path.join(HERE, "atlas.config.json")
EXAMPLE = os.path.join(HERE, "atlas.config.example.json")
HOME = os.path.expanduser("~")


def _expand(v):
    """'~' at the start of a path means this Windows user's home folder; %VARS% are expanded too."""
    if isinstance(v, str):
        if v == "~" or v.startswith(("~\\", "~/")): v = HOME + v[1:]
        return os.path.expandvars(v) if "%" in v else v
    if isinstance(v, list): return [_expand(x) for x in v]
    if isinstance(v, dict): return {k: _expand(x) for k, x in v.items()}
    return v


def load():
    if not os.path.exists(PATH):
        import shutil
        shutil.copyfile(EXAMPLE, PATH)          # first run: start from the example, then edit it
    with open(PATH, encoding="utf-8") as f:
        return _expand(json.load(f))


C = load()
PORT = int(C.get("port", 8765))
VIEW = C["view_folder"]
SOURCES = C["sources"]                                   # in matching order: the most specific path first
SOURCE = {s["id"]: s for s in SOURCES}
STATES = C["states"]
CATS = C["categories"]
UI = C.get("ui", {})
TREE_CATS = {CATS[u["category"]] for u in C.get("fixed", []) if u.get("kind") == "tree"}
