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
    ["Podcasts", "com.google.android.apps.podcasts", 1, 0, 300, 150, 0, 0], ["GitHub", "com.github.android", -1, 0, 260, 0, 45, 40],
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
  const row = (id, app, what) => ({ kind: "data", id, mime: `vnd.android.cursor.item/vnd.${app}.${what}` });
  const o = (label, k, act) => ({ label, k, act });
  const phone = n => [{ name: "Phone", opts: [o("Call", "voice", { kind: "call", number: n })] }, { name: "Messages", opts: [o("Message", "chat", { kind: "sms", number: n })] }];
  const mail = a => ({ name: "Gmail", opts: [o("Email", "mail", { kind: "email", address: a })] });
  const CONTACTS = [
    { id: 1, key: "k1", name: "Ada Lovelace", sub: "+1 555 0101 · mobile", apps: [...phone("+15550101"),
      { name: "WhatsApp", opts: [o("Message", "chat", row(11, "com.whatsapp", "profile")), o("Call", "voice", row(12, "com.whatsapp", "voip.call")), o("Video call", "video", row(15, "com.whatsapp", "video.call"))] },
      { name: "Signal", opts: [o("Message", "chat", row(13, "org.thoughtcrime.securesms", "contact")), o("Call", "voice", row(14, "org.thoughtcrime.securesms", "call"))] },
      mail("ada@example.com")] },
    { id: 2, key: "k2", name: "Alan Turing", sub: "+1 555 0102 · work", apps: [...phone("+15550102"),
      { name: "Telegram", opts: [o("Message", "chat", row(21, "org.telegram.messenger.android", "profile")), o("Call", "voice", row(22, "org.telegram.messenger.android", "call"))] }] },
    { id: 3, key: "k3", name: "Grace Hopper", sub: "grace@example.com", apps: [mail("grace@example.com")] },
  ];
  // What the PC's Claude process tracker saves every 2 minutes (G:\\My Drive\\.atlas\\claude-processes.json): made up.
  // Pause all (1.6.0): the marker the panel renames, and the PC (here, a moment later) doing it.
  const MOCK_CTL = { want: "running", have: "running", since: null };
  const claudeRows = () => {
    const d = claudeBase(), c = MOCK_CTL;
    for (const r of d.rows) {
      if (r.kind === "request") r.paused = c.have === "paused" && r.project !== "Claude itself";
      if (r.kind === "total") Object.assign(r, { control: c.want, paused: c.have === "paused" ? 6 : 0, pausedSince: c.since });
    }
    return d;
  };
  const claudeBase = () => ({ v: 1, every: 120, rows: [
    { kind: "request", key: "q:job-1", project: "Harbor Library", title: "Massing model renders", desc: "Blender renders the views one at a time, on the CPU at low priority.", procs: 3, memPct: 35.2, cpu: 71.4, gpu: 0 },
    { kind: "request", key: "q:job-2", project: "Harbor Library", title: "Compositing and encoding", desc: "Puts the frames together as they arrive, then encodes the film.", procs: 2, memPct: 0.6, cpu: 2.1, gpu: 4.5 },
    { kind: "request", key: "q:dc-1", project: "Courses", title: "Command from a Claude chat", desc: "python export_slides.py --deck \"Lecture 04\"", procs: 1, memPct: 0.4, cpu: 0.8, gpu: 0 },
    { kind: "request", key: "q:claude", project: "Claude itself", title: "Claude app and connectors", desc: "The Claude app and Cowork service, plus the connectors it runs on this PC: Desktop Commander, PDF viewer.", procs: 38, memPct: 4.6, cpu: 1.2, gpu: 0.5 },
    { kind: "project", key: "j:Harbor Library", project: "Harbor Library", title: "Harbor Library", requests: 2, memPct: 35.8, cpu: 73.5, gpu: 4.5 },
    { kind: "project", key: "j:Courses", project: "Courses", title: "Courses", requests: 1, memPct: 0.4, cpu: 0.8, gpu: 0 },
    { kind: "project", key: "j:Kitchen renovation", project: "Kitchen renovation", title: "Kitchen renovation", requests: 0, memPct: 0, cpu: 0, gpu: 0 },
    { kind: "project", key: "j:Claude itself", project: "Claude itself", title: "Claude itself", requests: 1, memPct: 4.6, cpu: 1.2, gpu: 0.5 },
    { kind: "other", key: "o:apps", title: "Other apps", memPct: 41, cpu: 12, gpu: 6 },
    { kind: "other", key: "o:free", title: "Free or idle", memPct: 18.4, cpu: 12.5, gpu: 89 },
    { kind: "total", key: "total", procs: 44, requests: 3, gb: 6.5, pctRam: 41, memPct: 40.8, cpu: 75.5, gpu: 5, cpuPc: 87.5, gpuPc: 11,
      ramGb: 16, freeGb: 2.9, freePct: 18, cpus: 16, host: "STUDIO-PC", at: new Date(Date.now() - 60000).toISOString() }] });
  // The phone's calendars (1.6.0), made up: a Google account, two Outlook accounts and a work profile; the events are laid
  // out around today, so every view has something in it. MOCK_CAL_OK = false: Android hasn't been asked yet.
  const CALS = [
    { id: 1, work: false, name: "you@example.com", account: "you@example.com", type: "com.google", app: "Google", owner: "you@example.com", color: "#039be5", access: 700, visible: true, sync: true, primary: true },
    { id: 2, work: false, name: "Family", account: "you@example.com", type: "com.google", app: "Google", owner: "family7@group.calendar.google.com", color: "#33b679", access: 700, visible: true, sync: true, primary: false },
    { id: 3, work: false, name: "Holidays in United States", account: "you@example.com", type: "com.google", app: "Google", owner: "en.usa#holiday@group.v.calendar.google.com", color: "#0b8043", access: 200, visible: true, sync: true, primary: false },
    { id: 4, work: false, name: "Birthdays", account: "you@example.com", type: "com.google", app: "Google", owner: "addressbook#contacts@group.v.calendar.google.com", color: "#f6bf26", access: 200, visible: false, sync: false, primary: false },
    { id: 5, work: false, name: "Calendar", account: "you@company.example", type: "com.microsoft.office.outlook.USER_ACCOUNT", app: "Outlook", owner: "you@company.example", color: "#8e24aa", access: 700, visible: true, sync: true, primary: true },
    { id: 6, work: false, name: "Calendar", account: "you@university.example", type: "com.microsoft.office.outlook.USER_ACCOUNT", app: "Outlook", owner: "you@university.example", color: "#f4511e", access: 700, visible: true, sync: true, primary: true },
    { id: 1, work: true, name: "", account: "", type: "work", app: "Work profile", owner: "", color: "#7986cb", access: 0, visible: true, sync: true, primary: true },
  ];
  const JD0 = 2440588, jdOf = d => Math.round(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / D) + JD0;
  const at = (jd, h, m) => { const u = new Date((jd - JD0) * D); return new Date(u.getUTCFullYear(), u.getUTCMonth(), u.getUTCDate(), h, m || 0).getTime(); };
  const colOf = (cal, w) => (CALS.find(c => c.id === cal && c.work === !!w) || CALS[0]).color;
  const TEAMS = "https://teams.microsoft.com/l/meetup-join/19%3ameeting_ZmFrZS1zdGFuZC11cA%40thread.v2/0?context=%7b%22Tid%22%3a%22example%22%7d";
  const ZOOM = "https://example.zoom.us/j/5550100123";
  const answers = {};                                    // the answers given here: event id, or "id@begin" for one occurrence
  const added = [];                                      // events made here
  let iid = 0;
  const timed = (cal, t, jd, h0, m0, h1, m1, more = {}) => {     // a timed event; an end hour past 24 runs into the next day
    const b = at(jd, h0, m0), e = at(jd, h1, m1), sb = new Date(b), se = new Date(e);
    let ed = jdOf(se), em = se.getHours() * 60 + se.getMinutes(); const sd = jdOf(sb);
    if (em === 0 && ed > sd) { ed -= 1; em = 1440; }
    return { iid: ++iid, id: 9000 + iid, b, e, sd, ed, sm: sb.getHours() * 60 + sb.getMinutes(), em, ad: false, t, loc: "", cal, col: colOf(cal, more.w),
      me: 0, st: 1, av: 0, rr: false, org: "", att: false, ...more };
  };
  const allDay = (cal, t, jd, days, more = {}) => ({ iid: ++iid, id: 9000 + iid, b: (jd - JD0) * D, e: (jd + days - JD0) * D, sd: jd, ed: jd + days - 1, sm: 0, em: 1440,
    ad: true, t, loc: "", cal, col: colOf(cal, more.w), me: 0, st: 1, av: 1, rr: false, org: "", att: false, ...more });
  function calEvents(from, to) {
    iid = 0;
    const T = jdOf(new Date()), out = [];
    for (let jd = from - 1; jd <= to; jd++) {
      const wd = new Date((jd - JD0) * D).getUTCDay();
      if (wd >= 1 && wd <= 5) out.push(timed(5, "Stand-up", jd, 9, 0, 9, 15, { id: 500, rr: true, att: true, me: 1, org: "lead@company.example", loc: "Microsoft Teams Meeting", join: TEAMS, jl: "Teams" }));
      if (wd === 1 || wd === 3) out.push(timed(5, "Design review", jd, 11, 0, 12, 0, { id: 501, rr: true, att: true, me: 3, org: "pm@company.example", loc: "Room 2.14", join: TEAMS, jl: "Teams" }));
      if (wd === 2 || wd === 4) out.push(timed(6, "Studio: lunar habitats", jd, 14, 0, 15, 30, { id: 502, rr: true, loc: "Architecture building, room 120" }));
      if (wd === 3) out.push(timed(5, "Call with the supplier", jd, 14, 30, 15, 0, { id: 503, att: true, me: 4, org: "buyer@company.example", join: ZOOM, jl: "Zoom" }));
      if (wd === 1 || wd === 3 || wd === 5) out.push(timed(1, "Gym", jd, 18, 30, 19, 30, { id: 504, rr: true }));
      if (wd === 5) out.push(timed(1, "Dinner with friends", jd, 20, 0, 22, 30, { id: 505, loc: "Harbor Street 12" }));
      if (wd === 6) out.push(allDay(2, "Hike", jd, 1, { id: 506 }));
      if (wd === 0) out.push(timed(2, "Call with Mom", jd, 17, 0, 17, 45, { id: 507, rr: true }));
    }
    out.push(timed(1, "Focus time", T, 10, 0, 10, 30, { id: 40, w: true }),
      timed(1, "Lunch with Ada", T, 13, 0, 14, 0, { id: 601, loc: "Blue Door Cafe, 5th Street" }),
      timed(5, "Weekly sync", T, 15, 0, 15, 30, { id: 602, st: 2, att: true, org: "lead@company.example" }),
      timed(5, "Proposal review", T, 16, 0, 17, 0, { id: 603, att: true, me: 2, org: "pm@company.example" }),
      timed(1, "Dentist", T + 1, 8, 0, 8, 45, { id: 604, loc: "Smile Clinic" }),
      timed(1, "Concert", T + 2, 21, 0, 24, 0, { id: 605, loc: "Music Hall" }),
      allDay(3, "Public holiday", T + 4, 1, { id: 606 }),
      timed(1, "Night flight to Rome", T + 6, 22, 30, 30, 10, { id: 607, loc: "Terminal D" }),
      allDay(5, "Space architecture conference", T + 9, 3, { id: 608, loc: "Convention center" }),
      ...added);
    for (const ev of out) { const a = answers[ev.id + "@" + ev.b] ?? answers[ev.id]; if (a != null) ev.me = a; }
    return out.filter(ev => ev.ed >= from && ev.sd <= to);
  }
  const DETAILS = {
    500: { rrule: "FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR", org: "lead@company.example", tz: "America/Chicago",
      desc: "________________________________________________________________________________\nMicrosoft Teams meeting\nJoin on your computer, mobile app or room device\nClick here to join the meeting <" + TEAMS + ">\nMeeting ID: 555 010 123 45\nPasscode: Ab12cd\n________________________________________________________________________________",
      att: [{ n: "Team lead", e: "lead@company.example", s: 1, r: 2, ty: 1 }, { n: "", e: "you@company.example", s: 1, r: 1, ty: 1 }, { n: "Ada Lovelace", e: "ada@company.example", s: 1, r: 1, ty: 1 },
        { n: "Alan Turing", e: "alan@company.example", s: 4, r: 1, ty: 1 }, { n: "Grace Hopper", e: "grace@company.example", s: 3, r: 1, ty: 2 }] },
    501: { rrule: "FREQ=WEEKLY;BYDAY=MO,WE", org: "pm@company.example", tz: "America/New_York", desc: "<p>Agenda:</p><ul><li>Hatch seals, rev C</li><li>Closeout panels</li></ul><p>Slides: https://example.sharepoint.com/sites/design/review.pptx</p>",
      att: [{ n: "Project manager", e: "pm@company.example", s: 1, r: 2, ty: 1 }, { n: "", e: "you@company.example", s: 3, r: 1, ty: 1 }, ...Array.from({ length: 9 }, (_, i) => ({ n: "Engineer " + (i + 1), e: `eng${i + 1}@company.example`, s: [1, 1, 3, 4, 2][i % 5], r: 1, ty: 1 })),
        { n: "Room 2.14", e: "room214@company.example", s: 1, r: 1, ty: 3 }] },
    503: { org: "buyer@company.example", desc: "Join Zoom Meeting\n" + ZOOM, att: [{ n: "Buyer", e: "buyer@company.example", s: 1, r: 2, ty: 1 }, { n: "", e: "you@company.example", s: 4, r: 1, ty: 1 }] },
  };
  async function handle(method, args) {
    log.push([method, args]);
    switch (method) {
      case "apps": return { apps, usage: window.MOCK_USAGE !== false };
      case "prefs.get": return prefs;
      case "prefs.set": prefs[args.key] = args.value; return true;
      case "info": return { version: "1.0.0 (preview)", server: "https://atlas.example.ts.net", isDefault: false, calendar: window.MOCK_CAL_OK !== false };
      case "server": {
        if (args.method === "POST") {                              // Pause all (1.6.0): the marker beside the PC's file
          const b = JSON.parse(args.body || "{}"), c = MOCK_CTL;
          const to = args.path === "/api/rename" ? (b.name === "claude-paused" ? "paused" : b.name === "claude-run" ? "running" : "")
            : args.path === "/api/mkdir" && b.name === "claude-paused" ? "paused" : args.path === "/api/delete" ? "running" : "";
          if (!to) return { status: 400, body: JSON.stringify({ error: "not here" }) };
          c.want = to;
          setTimeout(() => { c.have = to; c.since = to === "paused" ? new Date().toISOString() : null; }, 1500);
          return { status: 200, body: JSON.stringify(args.path === "/api/delete" ? { deleted: 1 } : { path: b.path || b.dir || "" }) };
        }
        if (args.path === "/map.json") return { status: 200, body: await (await fetch("demo-map.json")).text() };
        if (args.path === "/settings") return { status: 200, body: JSON.stringify({ tone: prefs.tone }) };
        if (args.path.startsWith("/api/text?")) {                // Claude on the PC (1.5.0): the PC's numbers, made up
          const p = new URLSearchParams(args.path.split("?")[1]).get("path") || "";
          if (!/claude-processes\.json$/.test(p) || window.MOCK_CLAUDE === null) return { status: 404, body: JSON.stringify({ error: "not a file" }) };
          return { status: 200, body: JSON.stringify({ text: JSON.stringify(window.MOCK_CLAUDE || claudeRows()), truncated: false }) };
        }
        if (args.path.startsWith("/api/find")) {
          const q = new URLSearchParams(args.path.split("?")[1]).get("q").toLowerCase();
          return { status: 200, body: JSON.stringify({ results: files.filter(f => f.name.toLowerCase().includes(q)) }) };
        }
        return { status: 404, body: "{}" };
      }
      case "update.check": return window.MOCK_UPDATE || { available: false };
      case "update.install": window.MOCK_INSTALLS = (window.MOCK_INSTALLS || 0) + 1; return true;
      case "web.suggest": return ["weather today", "weather houston", "weather radar", "weather tomorrow", "weather this weekend", "weather 10 day"]
        .filter(x => x.startsWith(args.q.toLowerCase().slice(0, 3)));
      case "web.search": (window.MOCK_WEB = window.MOCK_WEB || []).push(args.q); return true;
      case "contacts.search": {                                  // made-up people and numbers (555-01xx is fictional)
        if (!window.MOCK_CONTACTS_OK) return { allowed: false, contacts: [] };
        const q = args.q.toLowerCase();
        return { allowed: true, contacts: CONTACTS.filter(c => c.name.toLowerCase().split(" ").some(w => w.startsWith(q))).slice(0, 5) };
      }
      case "contacts.allow": window.MOCK_CONTACTS_OK = true; setTimeout(() => window.onLauncherEvent({ type: "contacts" }), 50); return true;
      case "contacts.open": (window.MOCK_REACH = window.MOCK_REACH || []).push(args); return true;
      case "place.get": return window.MOCK_PLACE || { allowed: false, on: true };            // Sun (1.4.0)
      case "place.allow":                                                                     // a made-up answer: Lisbon
        if (!window.MOCK_PLACE_NO) { window.MOCK_PLACE = { allowed: true, on: true, lat: 38.72, lon: -9.14, at: Date.now() }; setTimeout(() => window.onLauncherEvent({ type: "place" }), 50); }
        return true;
      case "files.theme": window.MOCK_FILES_THEME = args.theme; return true;
      case "cal.list": {
        const ok = window.MOCK_CAL_OK !== false;
        return { allowed: ok, write: ok, workProfile: true, h24: !!window.MOCK_H24, calendars: ok ? CALS.map(c => ({ ...c })) : [] };
      }
      case "cal.events": return window.MOCK_CAL_OK === false ? { allowed: false, events: [] } : { allowed: true, events: calEvents(args.from, args.to) };
      case "cal.event": return { id: args.id, desc: "", org: "", rrule: "", tz: "", att: [], ...(DETAILS[args.id] || {}) };
      case "cal.allow":                                       // MOCK_CAL_DENY: you said no (or haven't answered yet)
        if (window.MOCK_CAL_OK === false && !window.MOCK_CAL_DENY) { window.MOCK_CAL_OK = true; setTimeout(() => window.onLauncherEvent({ type: "calendar" }), 50); }
        return true;
      case "cal.respond": answers[args.one ? args.id + "@" + args.begin : args.id] = args.status; return true;
      case "cal.create": {
        const jd = jdOf(new Date(args.begin)), s = new Date(args.begin), e = new Date(args.end);
        added.push(args.allDay ? allDay(args.cal, args.title || "New event", jdOf(new Date(args.startDate + "T00:00")), 1 + Math.round((Date.parse(args.endDate) - Date.parse(args.startDate)) / D), { id: 7000 + added.length, loc: args.loc })
          : timed(args.cal, args.title || "New event", jd, s.getHours(), s.getMinutes(), e.getHours() + 24 * (jdOf(e) - jd), e.getMinutes(), { id: 7000 + added.length, loc: args.loc }));
        return 7000 + added.length;
      }
      case "cal.show": { const c = CALS.find(x => x.id === args.id && !x.work); if (c) { c.visible = c.sync = true; } return !!c; }
      case "cal.sync": return 3;
      default: return true;
    }
  }
  window.LauncherMock = {
    icon, thumb, files,
    call(id, method, json) { handle(method, JSON.parse(json)).then(r => window.__native(id, true, JSON.stringify(r)), e => window.__native(id, false, JSON.stringify(e.message))); },
  };
})();
