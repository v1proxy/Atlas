// Atlas service worker. It only exists so a phone can install Atlas as an app.
// It stores nothing: every folder and file comes live from the PC, and nothing stays on the phone.
const OFFLINE = `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Atlas</title><style>body{background:#000;color:#F3F1EC;font:16px/1.5 Arial,sans-serif;display:grid;place-items:center;min-height:100vh;margin:0}
main{max-width:30rem;padding:24px}h1{font-weight:300;font-size:28px;margin:0 0 12px}p{color:#8E9096}button{font:inherit;color:#000;background:#F3F1EC;border:0;border-radius:4px;padding:10px 16px}</style>
<main><h1>Atlas can't reach the PC</h1><p>Check that Tailscale is on on this phone, and that the PC is awake and signed in.</p><button onclick="location.reload()">Try again</button></main>`;

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", e => e.waitUntil(self.clients.claim()));
self.addEventListener("fetch", e => {
  if (e.request.mode !== "navigate") return;            // files and data always go straight to the PC
  e.respondWith(fetch(e.request).catch(() => new Response(OFFLINE, { headers: { "Content-Type": "text/html; charset=utf-8" } })));
});
