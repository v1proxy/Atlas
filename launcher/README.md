# Atlas launcher

Atlas as an Android phone's Home screen. A frame like Atlas on top, then the screen split into two boxes, **Apps** and **Files**, with a circle on the line between them.

- **Tap a box** to open its Atlas map: Treemap, Tree or List. Apps are sorted the Atlas way, into Current, Superseded and Working and into your own categories; Files is Atlas itself, from your Atlas server.
- **Hold the circle** for the speed dial: your pinned apps fan out into the Apps box and your pinned files into the Files box. Slide to one and let go to open it, or let go first and tap.
- **Everywhere, one tap opens and a long press offers more**, including Add to speed dial: on an app, a folder, or a file.

## How apps are placed

Like folders in Atlas, apps are placed by the software and you correct it on the map (long press, then Move). In order: your own move, known package names, the category the app declares (games, music, photos…), apps that came with the phone, keywords in the app's name, then Unsorted. The rules live in `rules.json` (start from [rules.example.json](rules.example.json)); category ids are the numbers of your Atlas categories.

States follow use: **Working** is new (installed in the last two weeks) or not sorted yet; **Superseded** is not used for two months; **Current** is everything in use. With Android's usage access allowed (Options), tiles are sized by how much you use each app; without it, by how often you open it from Atlas.

## How it works

The app holds two pages. The home page (frame, boxes, speed dial, Apps map) is built into the app and never goes on the network: apps come from Android, and Atlas data comes through the app, signed in to Atlas the same way the Files page is. The Files page is Atlas from your server over Tailscale, which sees the launcher and switches to launcher mode (a Home button instead of Devices, one tap opens a folder, a long press offers the speed dial). Atlas's own security is unchanged: the launcher is one more signed-in device, listed in Devices as "Android launcher", and signs out with Lock.

| File | Role |
|---|---|
| `web/` | The home page: `index.html`, `launcher.css`, `launcher.js` |
| `android/` | The Android app (Kotlin, no libraries): Home screen activity, apps, icons and usage, the bridge to the page, updates |
| `rules.example.json` | How apps are placed in categories |
| `launcher.example.json` | Your Atlas address and an optional one-time pairing code for your own build |
| `build.ps1` | Builds the app on a Windows PC and hands it to Atlas |
| `test/` | `preview.py` runs the page at phone size against a stand-in for Android; `atlas_mode.py` checks Atlas in launcher mode against the demo server |

## Build and install

1. Copy `launcher.example.json` to `launcher.json` and set `server` to your Atlas address (`https://<name>.<tailnet>.ts.net`). For a first start with no typing, put a pairing code in `pair` (on the server: `atlas_service.py --pair`). Optionally copy `rules.example.json` to `rules.json` and make it yours. Both stay out of git.
2. On the PC, in the Atlas folder: `powershell -ExecutionPolicy Bypass -File launcher\build.ps1`. The first run downloads a JDK and Android's build tools into `%LOCALAPPDATA%\AtlasBuild` and makes the signing key.
3. Copy `launcher_dist\` to Atlas wherever your phone reaches it (the server in server mode: `/opt/atlas/app/launcher_dist/`).
4. On the phone, with Tailscale on, open `https://<your Atlas>/launcher` in Chrome, download, install, open Atlas and accept **Make Atlas the Home screen**.

Later versions: raise `atlasVersionCode` and `atlasVersionName` in `android/gradle.properties`, build again with `-Notes "what changed"`, copy `launcher_dist\` again, and on the phone use Options, Check for an update.

From 2027 Google requires apps installed outside the Play Store to come from a registered developer. A free registration for hobbyists covers up to 20 devices; register the app's signing key before then.

## Try the page without a phone

```
python launcher/test/preview.py            # screenshots in launcher/test/shots
python docs/demo/demo_server.py &          # Atlas with invented data
python launcher/test/atlas_mode.py         # Atlas in launcher mode
```
