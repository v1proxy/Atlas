# Atlas launcher

Atlas as an Android phone's Home screen. A frame like Atlas on top, then the screen split into two boxes, **Apps** and **Files**, with a circle on the line between them.

**Baseline 1, 2026-11-14.** The design and the code are set. The Android app's first build on a PC is the next step; until then the page can be tried in any browser (see the end of this page).

## Using it

- **Tap a box** to open its Atlas map: Treemap, Tree or List. Apps are sorted the Atlas way, into Current, Superseded and Working and into your own categories; Files is Atlas itself, from your Atlas server.
- **Tap the circle** for the dial. The cross spins while your pinned names come out of the circle onto three rings: apps toward the Apps box, files and folders toward the Files box, the most used first and nearest. Tap a name to open it. Tap the circle again and the names go back in while the cross spins the other way.
- **Hold the circle** to take names off the dial: they come out gray, a first tap turns one red, a second tap takes it off.
- **Tap the circle twice quickly** to open the phone's camera, ready for a photo. (A single tap opens the dial a quarter second later, once no second tap has come.)
- **Everywhere, one tap opens and a long press offers more**, including Add to dial: on an app or a folder.
- **Files: tap a file to see it here**, without leaving the launcher: photos, videos, music, PDFs, text, 3D models, and Word, Excel and PowerPoint files (your Atlas server turns them into PDFs). The bar on top has **Add to dial**, **Share**, **Open in app** and **Details**. **Hold a file** to open it straight in the phone's own app for it.
- **Hold an app and drag it** onto a category to move it there, on the treemap, the tree or the list. Let go without moving to see its details instead.
- **Tap the name on the left** to go back Home, from any screen, Files included. **Swiping right** goes back too, anywhere.
- **Swipe up on Home** for what Claude is running on your PC: how many processes, the memory, CPU and GPU they use, a ring of who uses what (CPU, GPU or memory: tap to switch) and each project with its requests. **Swipe down**, or Back, puts it away. The numbers are the PC's, saved every 2 minutes; the panel says how old they are, and when the PC seems asleep or off. **Pause all** at its top freezes Claude's jobs on the PC (renders, jobs, chat commands, Claude Code, Atlas), never the Claude app or its connectors: tap it, then **Sure?**. The same button then says **Resume all** and wakes the same processes.
- **Swipe right on Home** for your calendar: every calendar on the phone, personal and work, in one place, the way Outlook shows all its accounts together. It follows the finger in from the left; **swipe left**, Back or the name on the left puts it away.
  - **Agenda**, **Day**, **3 days** or **Month**, with the week on top: tap a day, swipe the week sideways for the next or previous one, and the circle with today's date comes back to today. In Day and 3 days, swipe the hours sideways for the next days; in Month, swipe for the next month.
  - Each calendar keeps its own color, at the brightness of the launcher's tiles. As in Outlook, an invitation you haven't answered is an outline, tentative is hatched, and declined or canceled events are struck through.
  - **Tap an event** for its details: when, where (tap for the map), **Join** for a Teams, Zoom, Meet or Webex meeting, **Accept**, **Tentative** or **Decline** (for a repeating meeting, this event or every event), the people and their answers, the notes, and **Open in the calendar app** or **Edit**. **Join** is also right in the agenda.
  - **Calendars** lists every calendar by account: tap one to show or hide it here, hold it to pick its color, turn on one the phone keeps off, show or hide declined events, and **Sync now**.
  - **+**, or an empty hour in Day or 3 days, makes a new event: title, calendar, all day, start and end, place, notes and a reminder, or **More options in the calendar app**.
- **Swipe left on Home** for Home Assistant: the app opens straight from Home, with nothing in between, when you let go past about a fifth of the screen or flick. A short pull does nothing.
- **The search** finds apps and files, and searches Google: under the results, **Search Google** and Google's own suggestions as you type (what you type goes to Google for them). **Enter** opens the first matching app, or searches Google when no app matches. Google's results open in the browser.
- **Contacts in the search**, between Apps and Files: each person whose name matches, with the apps that reach them listed underneath (Phone, Messages, WhatsApp, Signal, Telegram, email and the like). An app that does one thing does it at a tap: Phone calls at once, Messages starts a text. **Tap** WhatsApp, Signal or Telegram to list **Message**, **Call** and **Video call** under it; **hold** it to call straight away. The name opens the contact. While what you type matches a contact, Google's suggestions are left out, so the name doesn't go to Google; the Search Google row at the end still searches it. Android asks once to let Atlas read your contacts, and the first call asks to let it make calls. Contacts are read on the phone and go nowhere.
- **The empty circle beside the search** opens Settings. **Hold it** to swap black and ivory: the background turns ivory, and the text, the lines and the circle turn black.
- Names only: no app icons anywhere, on the maps or on the dial.

## The dial's order

The dial holds up to 10 apps and 10 files or folders, on rings of 3, 3 and 4 a side. The order is worked out each time it opens:

- **Apps**: time in front over the last 30 days, from Android's usage data (allow it in Settings). Without it, how often you open each app from Atlas.
- **Files and folders**: Android can't time a file, so the launcher counts the time from opening one on the dial until you go back Home or leave the launcher, up to 3 hours at a time. Recent use counts most: the total halves every two weeks.

On each ring the most used sits in the middle, then to its left and right.

## Settings

- **Appearance**: a color wheel for any color, or a gradient between two colors. The color runs through every screen and map, Atlas's own in Files included; with a gradient, each tile and dot takes the color of where it sits, top to bottom. **Back to red** resets it.
- **Sun**, the third choice in Appearance: the gradient follows the sky where you are, from the top of the screen (the sky overhead) to the bottom (the horizon). Black at night; at dawn navy, violet and pink, then sunrise, gold and the blue of the day; warmer in the evening, and black again after dusk. The colors flow continuously, worked out from the clock and the sun's height, so they follow the seasons and wherever you travel. The maps take the same sky at their usual brightness, so names stay readable: blue by day, warm at dawn and dusk, gray at night. Settings shows today's sky hour by hour, and when the sun rises and sets. Picking Sun asks Android for your approximate location (about 2 km), which stays on the phone; without it, the times come from your time zone.
- **Layout**: Apps on top or Files on top.
- **Home screen**, **Usage access**, **Atlas sign-in**, **Version and updates**.
- **Quit**: hands the phone back to its own launcher (tap it twice). Opening Atlas from the apps makes it the Home screen again.

## Categories

The Apps map uses your Atlas categories. In the List view each category has a **−** beside it: tap it, then **Sure?**, to take the category out of the launcher; its apps are sorted again among the others. **Add a category** at the bottom of the list adds one, numbered after the last unless you give it a number; categories with no apps yet are listed just above it, ready to drag apps onto. These changes are the launcher's own: Atlas's folders keep their categories.

## How apps are placed

Like folders in Atlas, apps are placed by the software and you correct it on the map: hold an app and drag it onto a category, or hold, let go, and use Move in its details. In order: your own move, known package names, the category the app declares (games, music, photos…), apps that came with the phone, keywords in the app's name, then Unsorted. The rules live in `rules.json` (start from [rules.example.json](rules.example.json)); category ids are the numbers of your Atlas categories.

States follow use: **Working** is new (installed in the last two weeks) or not sorted yet; **Superseded** is not used for two months; **Current** is everything in use. With Android's usage access allowed, tiles are sized by how much you use each app; without it, by how often you open it from Atlas.

## How it works

The app holds two pages. The home page (frame, boxes, dial, Apps map, Settings) is built into the app and never goes on the network: apps come from Android, and Atlas data comes through the app, signed in to Atlas the same way the Files page is. The Files page is Atlas from your server over Tailscale, which sees the launcher and switches to launcher mode: the Atlas name goes Home, there is no Devices button, one tap opens a folder or shows a file, and a long press offers the dial for a folder or opens a file in its app. To open or share a file, the app fetches it from Atlas with its own sign-in into its cache and hands it to the other app read only; the copy is deleted a day later. Atlas's own security is unchanged: the launcher is one more signed-in device, listed in Devices as "Android launcher", and signs out with Lock.

The calendar reads the calendars Android keeps for every account on the phone (Google, Outlook when it syncs its calendars, Exchange, Samsung and the rest), so nothing is signed in twice and nothing leaves the phone. Android asks once, on the first swipe right, to let Atlas see your calendars and to add events and answer invitations; each account's own app then syncs what you change. A calendar missing? In Outlook, open Settings, tap each account and turn on **Sync calendars**; Google and Exchange accounts are added in Android's Settings. A work profile's calendar comes too when the company lets personal apps see it (Android's cross-profile calendar), with times, titles and places only.

The Claude panel reads `claude-processes.json` from Atlas's state folder in your cloud drive (`G:\My Drive\.atlas`) through Atlas, like any other file. A small job on the PC writes it every 2 minutes, the same inventory as the Claude Process Tracker: `{"v": 1, "every": 120, "rows": [...]}`, with a row for each request (`project`, `title`, `desc`, `memPct`, `cpu`, `gpu`), each project, other apps, the free or idle rest, and the totals (`procs`, `gb`, `cpu`, `gpu`, `freeGb`, `host`, `at` and the like). Without the file the panel says so. Pause all renames a marker folder beside that file, `claude-run` or `claude-paused`, through Atlas; the PC's job looks at it every 5 seconds, freezes or wakes the processes and saves its numbers at once, so the panel shows it within about a minute. Rows of paused requests carry `paused: true`, and the totals `control` (what the marker says), `paused` (how many processes are frozen) and `pausedSince`.

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
2. On the PC, in the Atlas folder: `powershell -ExecutionPolicy Bypass -File launcher\build.ps1`. The first run downloads a JDK and Android's build tools into `%LOCALAPPDATA%\AtlasBuild` and makes the signing key. The key is `%USERPROFILE%\.android\atlas-launcher.jks`, with its password in `atlas-launcher.keystore.properties` beside it: back both up, since every later version must be signed with the same key.
3. Copy `launcher_dist\` to Atlas wherever your phone reaches it (the server in server mode: `/opt/atlas/app/launcher_dist/`).
4. On the phone, with Tailscale on, open `https://<your Atlas>/launcher` in Chrome, download, install, open Atlas and accept **Make Atlas the Home screen**.

Later versions: raise `atlasVersionCode` and `atlasVersionName` in `android/gradle.properties`, build again with `-Notes "what changed"`, copy `launcher_dist\` again, and on the phone use Settings, Version and updates. With `updates` set in `launcher.json` to a folder in your cloud drive (for example `G:\My Drive\.atlas\launcher`), the build also goes there and the phone finds it through Atlas, so there is nothing to copy onto the server. Android installs only an update signed with your key.

From 2027 Google requires apps installed outside the Play Store to come from a registered developer. A free registration for hobbyists covers up to 20 devices; register the app's signing key before then. Some phones (Xiaomi, Redmi, POCO) may switch gesture navigation off while a launcher other than their own is the Home screen.

## Try the page without a phone

```
python launcher/test/preview.py                            # screenshots in launcher/test/shots
python docs/demo/demo_server.py &                          # Atlas with invented data
python launcher/test/atlas_mode.py                         # Atlas in launcher mode
python launcher/test/build_preview.py OUT_DIR              # the launcher and Atlas side by side in a phone frame, as a static site
```

## Changes

- **1.7.0 (2026-11-24).** Two quick taps on the circle open the phone's camera, ready for a photo. One tap still opens the dial, a quarter second later, once no second tap has come.
- **1.6.3 (2026-11-22).** Pause all in the Claude panel: freezes Claude's jobs on the PC (never the Claude app or its connectors) after a Sure?, and the same button then says Resume all. A line says what is paused since when, and paused requests are marked. The page can now ask Atlas for changes too (the app's bridge sends POSTs with Atlas's own header).
- **1.6.2 (2026-11-22).** Swipe left on Home opens Home Assistant straight away: the tile no longer comes in with the finger first.
- **1.6.1 (2026-11-22).** Swipe left on Home for Home Assistant: its tile, in the boxes' color or the sky, comes in from the right with the finger and the app opens when you let go. The mirror of the calendar on the right.
- **1.6.0 (2026-11-22).** Swipe right on Home for every calendar on the phone, personal and work, in one place, with Outlook's calendar as the model: Agenda, Day, 3 days and Month under a week strip; each calendar in its own color; details with Join, Accept, Tentative or Decline, the people and the notes; Calendars to show, hide or color each one; + for a new event. Read on the phone, where Android keeps every account's calendars.
- **1.5.1 (2026-11-22).** Updates also come from your cloud drive: Settings, Version and updates looks in `launcher.json`'s `updates` folder too (through Atlas), and build.ps1 puts each build there, so a new version needs nothing copied onto the server.
- **1.5.0 (2026-11-21).** Swipe up on Home for Claude on your PC: the processes, the memory, CPU and GPU they use, a ring of who uses what (CPU, GPU or memory) and the projects with their requests, from the numbers the PC saves every 2 minutes. It follows the finger; swipe down or Back puts it away. Its tiles take the boxes' color, or the sky in Sun mode.
- **1.4.0 (2026-11-20).** Sun, in Settings, Appearance: the colors follow the sky where you are, black at night, through dawn, sunrise, the day, sunset and dusk, flowing without steps. The maps follow it at their usual brightness. Uses the phone's approximate location, asked when you pick Sun.
- **1.3.1 (2026-11-20).** One Search Google row, at the end. WhatsApp, Signal and Telegram are found on more phones: each opens straight in its app, also where the phone's contacts app or a second copy of WhatsApp takes the same rows.
- **1.3.0 (2026-11-20).** Contacts in the search, between Apps and Files: under each name, a list of the apps that reach that person. Tap WhatsApp, Signal or Telegram to list Message, Call and Video call, or hold it to call; Phone calls at once, Messages starts a text, the name opens the contact. Google's suggestions are left out while a contact matches.
- **1.2.0 (2026-11-15).** Google in the search bar: a Search Google row under the results, Google's suggestions as you type, and Enter searches Google when no app matches. Results open in the browser.
- **1.1.1 (2026-11-15).** Settings: Check for an update turns into Update when there is one, instead of a second, black button; when there isn't, it says you have the latest version.
- **1.1.0 (2026-11-15).** Files: a tap shows a file in the launcher, with Add to dial, Share, Open in app and Details on top; holding a file opens it in its app. Word, Excel and PowerPoint files get previews. Files arrive much faster from a server (see Atlas's own README), and the viewer says when a file is still coming or can't come instead of staying black.
- **Since Baseline 1.** Swiping right goes back, in the launcher and in Files. Hold an app and drag it onto a category (treemap, tree or list); near the edges the list and the tree move by themselves. Categories: − beside each in the List view takes one out, Add a category at the bottom adds one. The Settings circle is as tall as the buttons, and its right edge is in line with the search field's. Two fingers move the maps as they pinch (launcher and Files), and a tree smaller than the screen can be moved anywhere on it instead of staying at the top.
- **Baseline 1 (2026-11-14).** Names only, no icons. The dial: tap to open (the cross spins while the names come out onto three rings by use), tap to close (the same in reverse), hold to take names off. The name on the left goes Home; the Home buttons are gone. The Settings circle beside the search: tap for Settings, hold for black or ivory. A color wheel and two-color gradients that run through every map. A black band with 1px line, ring and cross. Quit.
