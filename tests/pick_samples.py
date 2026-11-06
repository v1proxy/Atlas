# Picks one small, locally available file of each preview type from the index, inside the folders Atlas may read.
import json, os, sqlite3, sys
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import security as sec

db = sqlite3.connect("file:" + os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "index.db") + "?mode=ro", uri=True)
want = {"image": ("jpg", "jpeg", "png"), "image_conv": ("heic", "tif", "tiff"), "video": ("mp4", "mov", "webm"), "audio": ("mp3", "m4a", "wav"),
        "pdf": ("pdf",), "glb": ("glb", "gltf"), "stl": ("stl",), "obj": ("obj",), "ply": ("ply",), "text": ("md", "txt", "csv")}
lo = {"video": 200_000, "pdf": 50_000}
hi = {"video": 40_000_000, "image": 8_000_000, "pdf": 15_000_000, "glb": 30_000_000, "stl": 30_000_000, "obj": 30_000_000, "ply": 60_000_000}
out = {}
for k, exts in want.items():
    rows = db.execute(f"select path, size from files where cloud = 0 and lower(ext) in ({','.join('?' * len(exts))}) and size between ? and ? order by size limit 400",
                      [*exts, lo.get(k, 1000), hi.get(k, 20_000_000)]).fetchall()
    for path, size in rows:
        try:
            sec.guard(path)
            if k == "video":                         # a whole H.264 movie, not a streaming segment
                with open(path, "rb") as f: head = f.read(size)
                if head[4:8] != b"ftyp" or b"avc1" not in head: continue
            if os.path.isfile(path) and not (os.stat(path).st_file_attributes & (0x400000 | 0x40000 | 0x1000)):
                out[k] = {"path": path, "size": size}; break
        except Exception:
            continue
print(json.dumps(out, indent=1))
