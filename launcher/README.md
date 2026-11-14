# Atlas launcher

Atlas as an Android phone's Home screen. A frame like Atlas on top, then the screen split into two boxes, **Apps** and **Files**, with a circle on the line between them.

**Baseline 1, 2026-11-14.** The design and the code are set. The Android app's first build on a PC is the next step; until then the page can be tried in any browser (see the end of this page).

## Using it

- **Tap a box** to open its Atlas map: Treemap, Tree or List. Apps are sorted the Atlas way, into Current, Superseded and Working and into your own categories; Files is Atlas itself, from your Atlas server.
- **Tap the circle** for the dial. The cross spins while your pinned names come out of the circle onto three rings: apps toward the Apps box, files and folders toward the Files box, the most used first and nearest. Tap a name to open it. Tap the circle again and the names go back in while the cross spins the other way.
- **Hold the circle** to take names off the dial: they come out gray, a first tap turns one red, a second tap takes it off.
- **Everywhere, one tap opens and a long press offers more**, including Add to dial: on an app, a folder or a file.
- **Hold an app and drag it** onto a category to move it there, on the treemap, the tree or the list. Let go without moving to see its details instead.
- **Tap the name on the left** to go back Home, from any screen, Files included. **Swiping right** goes back too, anywhere.
- **The empty circle beside the search** opens Settings. **Hold it** to swap black and ivory: the background turns ivory, and the text, the lines and the circle turn black.
- Names only: no app icons anywhere, on the maps or on the dial.

## The dial's order

The dial holds up to 10 apps and 10 files or folders, on rings of 3, 3 and 4 a side. The order is worked out each time it opens:

- **Apps**: time in front over the last 30 days, from Android's usage data (allow it in Settings). Without it, how often you open each app from Atlas.
- **Files and folders**: Android can't time a file, so the launcher counts the time from opening one on the dial until you go back Home or leave the launcher, up to 3 hours at a time. Recent use counts most: the total halves every two weeks.

On each ring the most used sits in the middle, then to its left and right.

## Settings

- **Appearance**: a color wheel for any color, or a gradient between two colors. The color runs through every screen and map, Atlas's own in Files included; with a gradient, each tile and dot takes the color of where it sits, top to bottom. **Back to red** resets it.
- **Layout**: Apps on top or Files on top.
- **Home screen**, **Usage access**, **Atlas sign-in**, **Version and updates**.
- **Quit**: hands the phone back to its own launcher (tap it twice). Opening Atlas from the apps makes it the Home screen again.

## Categories

The Apps map uses your Atlas categories. In the List view each category has a **−** beside it: tap it, then **Sure?**, to take the category out of the launcher; its apps are sorted again among the others. **Add a category** at the bottom of the list adds one, numbered after the last unless you give it a number; categories with no apps yet are listed just above it, ready to drag apps onto. These changes are the launcher's own: Atlas's folders keep their categories.

## How apps are placed

Like folders in Atlas, apps are placed by the software and you correct it on the map: hold an app and drag it onto a category, or hold, let go, and use Move in its details. In order: your own move, known package names, the category the app declares (games, music, photos…), apps that came with the phone, keywords in the app's name, then Unsorted. The rules live in `rules.json` (start from [rules.example.json](rules.example.json)); category ids are the numbers of your Atlas categories.

States follow use: **Working** is new (installed in the last two weeks) or not sorted yet; **Superseded** is not used for two months; **Current** is everything in use. With Android's usage access allowed, tiles are sized by how much you use each app; without it, by how often you open it from Atlas.

## How it works

The app holds two pages. The home page (frame, boxes, dial, Apps map, Settings) is built into the app and never goes on the network: apps come from Android, and Atlas data comes through the app, signed in to Atlas the same way the Files page is. The Files page is Atlas from your server over Tailscale, which sees the launcher and switches to launcher mode: the Atlas name goes Home, there is no Devices button, one tap opens a folder and a long press offers the dial. Atlas's own security is unchanged: the launcher is one more signed-in device, listed in Devices as "Android launcher", and signs out with Lock.

| File | Role |
|---|---|
| `web/` | The home page: `index.html`, `launcher.css`, `launcher.js` |
| `android/` | The Android app (Kotlin, no libraries): Home screen activity, apps and usage, the bridge to the page, black or ivory for the window and the system bars, updates |
| `rules.example.json` | How apps are placed in categories |
| `launcher.example.json` | Your Atlas address and an optional one-time pairing code for your own build |
| `build.ps1` | Builds the app on a Windows PC and hands it to Atlas |
| `test/` | `preview.py` runs the page at phone size against a stand-in for Android; `atlas_mode.py` checks Atlas in launcher mode against the demo server; `build_preview.py` builds an interactive preview |

## Build and install

1. Copy `launcher.example.json` to `launcher.json` and set `server` to your Atlas address (`https://<name>.<tailnet>.ts.net`). For a first start with no typing, put a pairing code in `pair` (on the server: `atlas_service.py --pair`). Optionally copy `rules.example.json` to `rules.json` and make it yours. Both stay out of git.
2. On the PC, in the Atlas folder: `powershell -ExecutionPolicy Bypass -File launcher\build.ps1`. The first run downloads a JDK and Android's build tools into `%LOCALAPPDATA%\AtlasBuild` and makes the signing key.
3. Copy `launcher_dist\` to Atlas wherever your phone reaches it (the server in server mode: `/opt/atlas/app/launcher_dist/`).
4. On the phone, with Tailscale on, open `https://<your Atlas>/launcher` in Chrome, download, install, open Atlas and accept **Make Atlas the Home screen**.

Later versions: raise `atlasVersionCode` and `atlasVersionName` in `android/gradle.properties`, build again with `-Notes "what changed"`, copy `launcher_dist\` again, and on the phone use Settings, Version and updates.

From 2027 Google requires apps installed outside the Play Store to come from a registered developer. A free registration for hobbyists covers up to 20 devices; register the app's signing key before then. Some phones (Xiaomi, Redmi, POCO) may switch gesture navigation off while a launcher other than their own is the Home screen.

## Try the page without a phone

```
python launcher/test/preview.py                            # screenshots in launcher/test/shots
python docs/demo/demo_server.py &                          # Atlas with invented data
python launcher/test/atlas_mode.py                         # Atlas in launcher mode
python launcher/test/build_preview.py OUT_DIR              # the launcher and Atlas side by side in a phone frame, as a static site
```

## Changes

- **Since Baseline 1.** Swiping right goes back, in the launcher and in Files. Hold an app and drag it onto a category (treemap, tree or list); near the edges the list and the tree move by themselves. Categories: − beside each in the List view takes one out, Add a category at the bottom adds one. The Settings circle is as tall as the buttons, and its right edge is in line with the search field's.
- **Baseline 1 (2026-11-14).** Names only, no icons. The dial: tap to open (the cross spins while the names come out onto three rings by use), tap to close (the same in reverse), hold to take names off. The name on the left goes Home; the Home buttons are gone. The Settings circle beside the search: tap for Settings, hold for black or ivory. A color wheel and two-color gradients that run through every map. A black band with 1px line, ring and cross. Quit.
