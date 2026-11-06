# Atlas security model

Atlas is a small web server on your PC that can read and change your files. This page says what it protects against, how, and what it leaves to you.

## What it protects

| Threat | Defence | Tested by |
|---|---|---|
| A program or web page reading Atlas without signing in | Every page and API call needs a signed-in device: an HttpOnly, SameSite=Strict cookie, stored hashed on the PC | `api_security.py`: locked page, 401 on data, forged cookie |
| DNS rebinding (a website pointing its own name at 127.0.0.1) | Requests must name Atlas's own host (127.0.0.1, localhost, or this PC's Tailscale name); anything else gets 421 | forged Host header |
| Cross-site requests (CSRF) | Changes need the `X-Atlas` header, which other sites can't send without a preflight Atlas refuses, plus an Origin check and SameSite=Strict | missing header, foreign Origin |
| Reaching files outside your folders | Paths are resolved and must sit under `read_write` or `read_only`; network paths, `\\?\`, `..` escapes and NTFS streams are refused | 9 path cases |
| Changing protected folders | `read_only` is enforced on the PC for every write | mkdir, paste into each read-only folder |
| Malicious files opened in Atlas | HTML, SVG, JS and XML are served as `text/plain`; every file response carries `Content-Security-Policy: sandbox` and `nosniff` | HTML file check |
| A crafted PDF | PDF.js 4.10.38 (CVE-2024-4367 fixed) with `isEvalSupported: false` | |
| Third-party tracking | No CDN, no web fonts from outside; the page CSP allows only Atlas itself | E2E: nothing loaded from the internet |
| Losing files by mistake | Deletes use the Recycle Bin; top folders can't be deleted, renamed or moved; pasting a name that exists keeps both | file action tests |
| Guessing codes | 10 failed sign-ins a minute, then a pause; pairing codes are random (128 bits), stored hashed, single use, valid 30 days by default (`pair_code_days`) | single-use pairing |
| The PC key used from elsewhere | The Start menu key is accepted only from the PC itself, never through Tailscale | key through Tailscale headers |
| A phone taking over | Only the PC can make pairing codes and sign devices out | phone pairing refused |

## Remote access

Atlas listens on 127.0.0.1 only. Your phone reaches it through `tailscale serve`, which gives the PC an HTTPS name inside your tailnet. Nothing is opened on your router. Never enable Tailscale Funnel for Atlas: that would put it on the public internet.

## What remains your responsibility

- **Programs already on your PC** run as you and can read the Start menu link. They could already read your files directly, so Atlas gives them nothing new. Keep the PC clean.
- **A lost or unlocked phone** that was paired can use Atlas for up to 180 days. Keep a screen lock; if a phone is lost, sign it out in Atlas (Devices) and remove it from Tailscale.
- **Every device in your tailnet** can reach Atlas's sign-in page (not your data). Keep the tailnet to your own devices, or add a Tailscale access rule that allows only your phones to reach the PC on port 443.
- **Certificate logs.** Turning on Tailscale HTTPS lists your PC's tailnet name in public certificate transparency logs. The name can't be reached from the internet.

## Reporting a problem

Open an issue without details, and ask for a private contact.
