// A stand-in for Android, so the launcher page can be tried and tested in a desktop browser.
// Sample apps only: the real app reads the phone's own apps. Icons here are plain letters, not the apps' icons.
(function () {
  const now = Date.now(), D = 864e5;
  // label, package, Android category (-1 none, 0 game, 1 audio, 2 video, 3 image, 4 social, 5 news, 6 maps), came with the phone,
  // installed (days ago), last used (days ago, -1 never), use in 30 days (minutes), opens in 30 days
  const A = [
    ["Phone", "com.google.android.dialer", -1, 1, 700, 0, 96, 150], ["Messages", "com.google.android.apps.messaging", -1, 1, 700, 0, 260, 310],
    ["Contacts", "com.google.android.contacts", -1, 1, 700, 6, 8, 9], ["Camera", "com.google.android.GoogleCamera", 3, 1, 700, 1, 40, 62],
    ["Photos", "com.google.android.apps.photos", 3, 1, 700, 0, 75, 70], ["Clock", "com.google.android.deskclock", -1, 1, 700, 0, 12, 40],
    ["Calculator", "com.google.android.calculator", -1, 1, 700, 9, 3, 6], ["Calendar", "com.google.android.calendar", -1, 1, 700, 0, 30, 85],
    ["Settings", "com.android.settings", -1, 1, 700, 0, 25, 48], ["Files", "com.google.android.apps.nbu.files", -1, 1, 700, 3, 9, 14],
    ["Chrome", "com.android.chrome", -1, 1, 700, 0, 640, 420], ["Gmail", "com.google.android.gm", -1, 1, 700, 0, 180, 260],
    ["Maps", "com.google.android.apps.maps", 6, 1, 700, 0, 150, 66], ["YouTube", "com.google.android.youtube", 2, 1, 700, 1, 300, 52],
    ["Play Store", "com.android.vending", -1, 1, 700, 4, 14, 12], ["Drive", "com.google.android.apps.docs", -1, 1, 700, 1, 35, 29],
    ["Keep Notes", "com.google.android.keep", -1, 1, 700, 21, 4, 5], ["Wallet", "com.google.android.apps.walletnfcrel", -1, 1, 700, 2, 6, 22],
    ["Device Care", "com.example.devicecare", -1, 1, 700, -1, 0, 0], ["Members", "com.example.members", -1, 1, 700, 420, 0, 0],
    ["Home Assistant", "io.homeassistant.companion.android", -1, 0, 380, 0, 190, 210], ["Tailscale", "com.tailscale.ipn", -1, 0, 300, 0, 6, 30],
    ["Google Home", "com.google.android.apps.chromecast.app", -1, 0, 500, 3, 14, 16], ["Hue", "com.philips.lighting.hue2", -1, 0, 500, 45, 2, 3],
    ["Bambu Handy", "com.bambulab.handy", -1, 0, 5, 1, 50, 31], ["LinkedIn", "com.linkedin.android", 4, 0, 600, 0, 110, 75],
    ["Indeed", "com.indeed.android.jobsearch", -1, 0, 300, 150, 0, 0], ["GitHub", "com.github.android", -1, 0, 260, 0, 45, 40],
    ["Slack", "com.Slack", -1, 0, 400, 0, 160, 140], ["Notion", "notion.id", -1, 0, 350, 2, 30, 20], ["Lucid", "com.lucidchart.android", -1, 0, 120, 12, 9, 6],
    ["Zotero", "org.zotero.android", -1, 0, 200, 8, 22, 14], ["Canvas Student", "com.instructure.candroid", -1, 0, 420, 2, 26, 30],
    ["Zoom", "us.zoom.videomeetings", -1, 0, 500, 5, 120, 18], ["Teams", "com.microsoft.teams", -1, 0, 500, 0, 140, 95],
    ["Outlook", "com.microsoft.office.outlook", -1, 0, 500, 0, 200, 230], ["Claude", "com.anthropic.claude", -1, 0, 200, 0, 330, 160],
    ["Spotify", "com.spotify.music", 1, 0, 800, 0, 420, 70], ["WhatsApp", "com.whatsapp", 4, 0, 800, 0, 380, 330],
    ["Instagram", "com.instagram.android", 4, 0, 800, 1, 90, 60], ["Uber", "com.ubercab", 6, 0, 800, 20, 4, 3],
    ["United Airlines", "com.united.mobile.android", -1, 0, 400, 40, 3, 4], ["Weather", "com.example.weather", -1, 0, 300, 0, 5, 44],
    ["Kindle", "com.amazon.kindle", -1, 0, 900, 70, 0, 0], ["Duolingo", "com.duolingo", -1, 0, 900, 400, 0, 0],
    ["Chess", "com.example.chess", 0, 0, 900, 200, 0, 0], ["Bank", "com.example.bank", -1, 0, 900, 3, 8, 15],
    ["Strava", "com.strava", -1, 0, 900, 15, 12, 8], ["Translate", "com.google.android.apps.translate", -1, 1, 700, 33, 2, 2],
  ];
  const apps = A.map(([label, pkg, cat, system, inst, used, fg, opens]) => ({
    key: pkg + "/.Main|0", label, pkg, cat, system: !!system, work: false,
    installed: now - inst * D, updated: now - Math.min(inst, 30 + (pkg.length % 50)) * D,
    lastUsed: used < 0 ? 0 : now - used * D - 3600e3, fg30: fg * 60000, opens30: opens, launches30: 0, lastLaunch: 0,
  }));
  const files = [
    { path: "G:\\My Drive\\Harbor Library\\Concept report.pdf", name: "Concept report.pdf", size: 2400000, mtime: now / 1000 - 86400 * 3, kind: "pdf", dir: false },
    { path: "G:\\My Drive\\Harbor Library\\Massing model.stl", name: "Massing model.stl", size: 9800000, mtime: now / 1000 - 86400 * 6, kind: "model", dir: false },
    { path: "G:\\My Drive\\Harbor Library\\Facade study.jpg", name: "Facade study.jpg", size: 3100000, mtime: now / 1000 - 86400 * 30, kind: "image", dir: false },
    { path: "G:\\My Drive\\Courses\\Syllabus.pdf", name: "Syllabus.pdf", size: 400000, mtime: now / 1000 - 86400 * 60, kind: "pdf", dir: false },
  ];
  const prefs = window.MOCK_PREFS || {
    pins: { apps: [], files: [] }, over: {}, order: "apps-top", tone: "red", view: "treemap", metric: "use",
  };
  const colors = ["#3D6B8C", "#7A5C9E", "#4F7F5A", "#9E6B3D", "#3D8C86", "#8C3D5A", "#5A5F6B", "#6B8C3D"];
  const hash = s => [...s].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7);
  const icon = key => {
    const a = apps.find(x => x.key === key), l = (a ? a.label : "?")[0], c = colors[hash(key) % colors.length];
    return "data:image/svg+xml," + encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 96"><rect x="4" y="4" width="88" height="88" rx="22" fill="${c}"/><text x="48" y="64" font-family="Arial" font-size="46" text-anchor="middle" fill="#fff">${l}</text></svg>`);
  };
  const thumb = p => "data:image/svg+xml," + encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 96"><rect width="96" height="96" fill="#5b6f7d"/><path d="M0 70 L30 44 L52 62 L70 48 L96 70 L96 96 L0 96Z" fill="#2f3d47"/><circle cx="70" cy="26" r="9" fill="#e9d7a6"/></svg>`);
  const log = window.MOCK_LOG = [];
  async function handle(method, args) {
    log.push([method, args]);
    switch (method) {
      case "apps": return { apps, usage: window.MOCK_USAGE !== false };
      case "prefs.get": return prefs;
      case "prefs.set": prefs[args.key] = args.value; return true;
      case "info": return { version: "1.0.0 (preview)", server: "https://atlas.example.ts.net", isDefault: false };
      case "server": {
        if (args.path === "/map.json") return { status: 200, body: await (await fetch("demo-map.json")).text() };
        if (args.path === "/settings") return { status: 200, body: JSON.stringify({ tone: prefs.tone }) };
        if (args.path.startsWith("/api/find")) {
          const q = new URLSearchParams(args.path.split("?")[1]).get("q").toLowerCase();
          return { status: 200, body: JSON.stringify({ results: files.filter(f => f.name.toLowerCase().includes(q)) }) };
        }
        return { status: 404, body: "{}" };
      }
      case "update.check": return { available: false };
      default: return true;
    }
  }
  window.LauncherMock = {
    icon, thumb, files,
    call(id, method, json) { handle(method, JSON.parse(json)).then(r => window.__native(id, true, JSON.stringify(r)), e => window.__native(id, false, JSON.stringify(e.message))); },
  };
})();
