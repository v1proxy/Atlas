# config.py: everything that belongs to one person's PC lives in atlas.config.json beside this file:
# which folders Atlas reads, which it may change, how folders are sorted, and the words on the map.
# The code holds no personal paths or rules. atlas.config.json is never published (see .gitignore);
# atlas.config.example.json is the starting point for a new install.
import json, ntpath, os

HERE = os.path.dirname(os.path.abspath(__file__))
PATH = os.path.join(HERE, "atlas.config.json")
EXAMPLE = os.path.join(HERE, "atlas.config.example.json")
HOME = os.path.expanduser("~")


def _expand(v, home=None):
    """'~' at the start of a path means this Windows user's home folder; %VARS% are expanded too.
    On the server, "home" in the settings names the PC's home folder, so paths read the same everywhere."""
    home = home or HOME
    if isinstance(v, str):
        if v == "~" or v.startswith(("~\\", "~/")): v = home + v[1:]
        return os.path.expandvars(v) if "%" in v else v
    if isinstance(v, list): return [_expand(x, home) for x in v]
    if isinstance(v, dict): return {k: _expand(x, home) for k, x in v.items()}
    return v


def load():
    if not os.path.exists(PATH):
        import shutil
        shutil.copyfile(EXAMPLE, PATH)          # first run: start from the example, then edit it
    with open(PATH, encoding="utf-8") as f:
        raw = json.load(f)
    return _expand(raw, raw.get("home"))


C = load()
MODE = C.get("mode", "pc")                               # "pc": Atlas on the computer; "cloud": Atlas on an always-on server
CLOUD = MODE == "cloud"
W = ntpath                                               # file paths are Windows paths everywhere, also on a Linux server
PORT = int(C.get("port", 8765))
VIEW = C.get("view_folder")
SOURCES = C["sources"]                                   # in matching order: the most specific path first
SOURCE = {s["id"]: s for s in SOURCES}
STATES = C["states"]
CATS = C["categories"]
UI = C.get("ui", {})
TREE_CATS = {CATS[u["category"]] for u in C.get("fixed", []) if u.get("kind") == "tree"}

# Tags, your corrections on the map and the color choice. With "state_folder" set (a folder inside a cloud drive,
# for example "G:\\My Drive\\.atlas"), the PC and the server share them; a name starting with a dot keeps the
# folder off the map. On the server the folder is mirrored into ./state and synced every minute (rfs.sync_state).
STATE_FOLDER = C.get("state_folder")
STATE_FILES = ("tags.json", "overrides.json", "settings.json")


def _state_dir():
    if CLOUD:
        d = os.path.join(HERE, "state"); os.makedirs(d, exist_ok=True); return d
    if STATE_FOLDER and os.path.isdir(os.path.dirname(STATE_FOLDER.rstrip("\\/"))):
        try:
            os.makedirs(STATE_FOLDER, exist_ok=True)
            for f in STATE_FILES:                          # first time: bring this PC's files along
                src, dst = os.path.join(HERE, f), os.path.join(STATE_FOLDER, f)
                if os.path.exists(src) and not os.path.exists(dst):
                    import shutil; shutil.copy2(src, dst)
            return STATE_FOLDER
        except OSError:
            pass
    return HERE


STATE = _state_dir()
