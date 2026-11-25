// Atlas launcher: the phone's home screen. A frame like Atlas, two boxes (Apps and Files), and a circle on the line
// between them that opens the dial. Apps open as an Atlas map of every app on the phone;
// Files open Atlas itself, from your Atlas server.
// This page never talks to the network: apps come from Android and files from your Atlas server, both through
// the app (window.Launcher), which signs in to Atlas for it.
"use strict";
const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const DAY = 864e5;
const fmtN = n => Math.round(n || 0).toLocaleString("en-US");
const fmtGB = g => g < 0.01 ? "<0.01 GB" : g >= 1000 ? (g / 1000).toFixed(2) + " TB" : (g >= 100 ? g.toFixed(0) : g.toFixed(1)) + " GB";
const fmtSize = n => n < 1024 ? n + " B" : n < 1048576 ? (n / 1024).toFixed(0) + " KB" : n < 1073741824 ? (n / 1048576).toFixed(1) + " MB" : (n / 1073741824).toFixed(2) + " GB";
const fmtDur = ms => { const m = Math.round((ms || 0) / 60000); return m < 1 ? "under a minute" : m < 60 ? m + " min" : Math.floor(m / 60) + " h" + (m % 60 ? " " + (m % 60) + " min" : ""); };
const ymd = t => t ? new Date(t).toISOString().slice(0, 10) : "unknown";
const sum = (list, f = x => x.v) => list.reduce((a, b) => a + f(b), 0);
const extOf = n => (String(n).split(".").pop() || "").toLowerCase();
const baseName = p => p.slice(p.lastIndexOf("\\") + 1);
const dirName = p => p.slice(0, p.lastIndexOf("\\")) || p;
function ago(t) {
  const d = Math.floor((Date.now() - t) / DAY);
  return d <= 0 ? "today" : d === 1 ? "yesterday" : d < 30 ? d + " days ago" : d < 365 ? Math.round(d / 30.4) + " months ago" : Math.round(d / 365) + " years ago";
}

// ---- state --------------------------------------------------------------------------------------------
const L = {
  screen: "home", apps: [], byKey: {}, usage: false, files: null, filesErr: "",
  cats: [], atlasCats: [], catEdits: { add: [], del: [] }, states: ["Current", "Superseded", "Working"],
  pins: { apps: [], files: [] }, over: {}, order: "apps-top", theme: null, use: {},
  view: "treemap", metric: "use", zoom: [], q: "", tz: null,
  open: new Set(["Apps", "Current", "Superseded", "Working"]),
};
const MAX_PINS = 10;
const HOW = { auto: "Decided by the software", you: "Moved by you" };
// Rules for placing apps in your categories. rules.json comes with the app (your own copy, or rules.example.json).
let RULES = {
  categories: { "01": "01 Work", "02": "02 Projects", "03": "03 Learning", "04": "04 Home", "05": "05 Personal", "06": "06 References", U: "Unsorted" },
  unsorted: "U", essentials: "05", android: { game: "05", audio: "05", video: "05", image: "05", social: "05", news: "05", maps: "05" },
  names: {}, keywords: {},
};

// ---- the bridge to Android ------------------------------------------------------------------------------
// window.Launcher.call(id, method, json) answers later through window.__native(id, ok, json).
const NB = { seq: 0, wait: new Map() };
function native(method, args) {
  const B = window.Launcher || window.LauncherMock;
  if (!B) return Promise.reject(new Error("This page runs inside the Atlas app"));
  return new Promise((res, rej) => {
    const id = ++NB.seq; NB.wait.set(id, { res, rej });
    try { B.call(id, method, JSON.stringify(args || {})); } catch (e) { NB.wait.delete(id); rej(e); }
  });
}
window.__native = (id, ok, json) => {
  const w = NB.wait.get(id); if (!w) return; NB.wait.delete(id);
  let v = null; try { v = json ? JSON.parse(json) : null; } catch (e) { v = json; }
  if (ok) w.res(v); else w.rej(new Error(typeof v === "string" ? v : "failed"));
};
const fire = (m, a) => { native(m, a).catch(() => {}); };
const haptic = k => fire("haptic", { k });
async function server(path) {
  const r = await native("server", { path });
  if (r.status === 401) throw new Error("not signed in");
  if (r.status !== 200) throw new Error(r.status ? "Atlas answered " + r.status : "can't reach Atlas");
  return JSON.parse(r.body);
}
async function serverPost(path, obj) {                                   // a change on Atlas (the app adds its X-Atlas header)
  const r = await native("server", { path, method: "POST", body: JSON.stringify(obj || {}) });
  if (r.status === 401) throw new Error("not signed in");
  if (r.status !== 200) throw new Error(r.status ? "Atlas answered " + r.status : "can't reach Atlas");
  return JSON.parse(r.body || "{}");
}
const savePref = (key, value) => fire("prefs.set", { key, value });

// Android tells the page about the world through window.onLauncherEvent.
window.onLauncherEvent = ev => {
  if (!ev) return;
  if (ev.type === "home") { endSession(); skyPaint(true); return goHome(); }
  if (ev.type === "pause") return endSession();                       // Atlas went to the background
  if (ev.type === "apps") return loadApps().then(refreshScreen);
  if (ev.type === "pins") return loadPrefs().then(() => { if (dialOpen()) openDial(dialMode, true); });
  if (ev.type === "resume") { if (theme().mode === "sun") loadPlace(); if (CAL.open) loadCal(); return refresh(); }
  if (ev.type === "place") return loadPlace();                        // a new place, or location allowed (or taken back)
  if (ev.type === "paired") return loadFiles().then(refreshScreen);
  if (ev.type === "calendar") { if (CAL.open || CAL.shown) loadCal(); else if (L.screen === "settings" && $("#o-cal")) renderSettings(); return; }   // a change, or allowed
  if (ev.type === "contacts") { if (L.q.trim() && L.screen !== "apps") findContacts(L.q); return; }   // allowed (or taken back)
};
// Back: true when this page used it (closing the dial, a sheet, a search, zooming out, leaving the Apps map).
window.launcherBack = () => {
  if (CAL.open) { if (document.body.classList.contains("sheeton")) closeSheet(); else closeCal(); return true; }
  if (PR.open) { closeProcs(); return true; }
  if (dialOpen()) { closeDial(true); return true; }
  if (document.body.classList.contains("sheeton")) { closeSheet(); return true; }
  if (L.q) { clearSearch(); return true; }
  if (L.screen === "settings") { goHome(); return true; }
  if (L.screen === "apps") {
    if (L.view === "treemap" && L.zoom.length) { L.zoom = L.zoom.slice(0, -1); resetMZ(); renderApps(); crumbs(); return true; }
    goHome(); return true;
  }
  return false;
};

// ---- long press: one tap opens, holding offers the options ----------------------------------------------
let fingers = 0;
document.addEventListener("pointerdown", () => { fingers++; }, true);
["pointerup", "pointercancel"].forEach(n => document.addEventListener(n, () => { fingers = Math.max(0, fingers - 1); }, true));
document.addEventListener("contextmenu", e => { if (!e.target.closest("input")) e.preventDefault(); });
function pressable(el, onTap, onLong) {
  let t = 0, x0 = 0, y0 = 0, down = false, fired = false;
  el.addEventListener("pointerdown", e => {
    down = true; fired = false; x0 = e.clientX; y0 = e.clientY; clearTimeout(t);
    el.classList.add("press");
    t = setTimeout(() => {
      el.classList.remove("press");
      if (!down || fingers > 1) return;
      fired = true; haptic("long"); onLong(e);
    }, 460);
  });
  el.addEventListener("pointermove", e => { if (down && Math.hypot(e.clientX - x0, e.clientY - y0) > 9) { clearTimeout(t); down = false; el.classList.remove("press"); } });
  ["pointerup", "pointercancel", "pointerleave"].forEach(n => el.addEventListener(n, () => { clearTimeout(t); down = false; el.classList.remove("press"); }));
  el.addEventListener("click", e => {
    if (fired) { e.preventDefault(); e.stopPropagation(); fired = false; return; }
    onTap(e);
  });
}

// ---- where an app belongs ----------------------------------------------------------------------------
const ANDROID_CAT = { 0: "game", 1: "audio", 2: "video", 3: "image", 4: "social", 5: "news", 6: "maps", 7: "productivity", 8: "accessibility" };
function unsortedLabel() { return L.cats.find(c => /^unsorted$/i.test(c)) || (RULES.categories || {})[RULES.unsorted] || "Unsorted"; }
function catLabel(id) {
  if (!id) return null;
  if (id === RULES.unsorted) return unsortedLabel();
  return L.cats.find(c => c.startsWith(id + " ")) || (L.cats.length ? null : (RULES.categories || {})[id]) || null;
}
// The categories for apps: Atlas's own (from your Atlas), less the ones you took out and plus the ones you added, both in
// the List view (− beside a category, + at the bottom). Unsorted always stays. Atlas's folders keep their categories.
const isUnsorted = c => /^unsorted$/i.test(c);
const catNum = c => { const m = /^(\d+)\s/.exec(c); return m ? +m[1] : 1e6; };
function setCats() {
  const base = L.atlasCats.length ? L.atlasCats : Object.values(RULES.categories || {}), del = new Set(L.catEdits.del);
  const out = base.filter(c => !del.has(c));
  for (const c of L.catEdits.add) if (!out.includes(c)) out.push(c);
  if (!out.some(isUnsorted)) out.push((RULES.categories || {})[RULES.unsorted] || "Unsorted");
  L.cats = out.sort((a, b) => (isUnsorted(a) ? 2e6 : catNum(a)) - (isUnsorted(b) ? 2e6 : catNum(b)) || a.localeCompare(b));
}
function addCategory(name) {
  name = name.replace(/\s+/g, " ").trim(); if (!name) return;
  if (!/^\d+\s/.test(name)) name = String(Math.max(0, ...L.cats.map(catNum).filter(n => n < 1e6)) + 1).padStart(2, "0") + " " + name;
  if (L.cats.some(c => c.toLowerCase() === name.toLowerCase())) return toast(`${name} is already there`);
  const d = L.catEdits.del.indexOf(name);
  if (d >= 0) L.catEdits.del.splice(d, 1); else L.catEdits.add.push(name);
  savePref("catEdits", L.catEdits); setCats(); classifyAll(); refreshScreen();
  toast(`${name} added. Hold an app and drag it there.`);
}
function removeCategory(c) {
  if (isUnsorted(c)) return;
  const i = L.catEdits.add.indexOf(c);
  if (i >= 0) L.catEdits.add.splice(i, 1); else if (!L.catEdits.del.includes(c)) L.catEdits.del.push(c);
  let moved = 0;
  for (const [k, o] of Object.entries(L.over)) if (o.category === c) { delete L.over[k]; moved++; }
  savePref("catEdits", L.catEdits); if (moved) savePref("over", L.over);
  setCats(); classifyAll(); refreshScreen();
  toast(`${c} taken out; its apps are sorted again`);
}
function addCategorySheet() {
  openSheet(`<div class="chip">Categories</div><h2>Add a category</h2>
    <p class="note">For apps, here in the launcher. It gets the next number unless you give it one.</p>
    <div class="set"><input id="cat-name" type="text" placeholder="Name, like Travel" maxlength="40" autocomplete="off" autocapitalize="words" enterkeyhint="done"></div>
    <div class="row"><button type="button" class="btn primary" id="cat-add">Add</button></div>`, P => {
    const go = () => { const v = P.querySelector("#cat-name").value.trim(); if (!v) return; closeSheet(); addCategory(v); };
    P.querySelector("#cat-add").onclick = go;
    P.querySelector("#cat-name").onkeydown = e => { if (e.key === "Enter") go(); };
    setTimeout(() => { try { P.querySelector("#cat-name").focus(); } catch (e) {} }, 260);
  });
}
const pkgMatch = (pkg, p) => p.endsWith("*") ? pkg.startsWith(p.slice(0, -1)) : pkg === p;
const words = a => (a.label + " " + a.pkg.replace(/[._]/g, " ")).toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
function lastUse(a) { return Math.max(a.lastUsed || 0, a.lastLaunch || 0); }

function classify(a) {
  const o = L.over[a.key];
  if (o && L.states.includes(o.state) && (L.cats.includes(o.category) || !L.cats.length)) return { category: o.category, state: o.state, how: "you", why: "moved by you on the map", swhy: "" };
  let cat = null, why = "";
  for (const [id, list] of Object.entries(RULES.names || {})) {
    if ((list || []).some(p => pkgMatch(a.pkg, p))) { cat = catLabel(id); if (cat) { why = "known app"; break; } }
  }
  if (!cat && a.cat >= 0) {
    const k = ANDROID_CAT[a.cat], id = k && (RULES.android || {})[k];
    if (id) { cat = catLabel(id); why = "the app says it is " + (k === "audio" ? "music or audio" : k); }
  }
  if (!cat && a.system && RULES.essentials) { cat = catLabel(RULES.essentials); why = "came with the phone"; }
  if (!cat) {
    const ws = new Set(words(a).flatMap(w => [w, w.replace(/s$/, "")])), votes = {}, hits = {};
    for (const [id, kw] of Object.entries(RULES.keywords || {})) {
      for (const w of String(kw).split(/[|\s]+/).filter(Boolean)) if (ws.has(w)) { votes[id] = (votes[id] || 0) + 1; (hits[id] ||= []).push(w); }
    }
    const best = Object.entries(votes).sort((x, y) => y[1] - x[1])[0];
    if (best && catLabel(best[0])) { cat = catLabel(best[0]); why = "keywords: " + hits[best[0]].join(", "); }
  }
  if (!cat) { cat = unsortedLabel(); why = "nothing clear yet"; }
  const [state, swhy] = appState(a, cat);
  return { category: cat, state, how: "auto", why, swhy };
}
function appState(a, cat) {
  // Working: new or not sorted yet. Superseded: not used for two months. Current: in use.
  const now = Date.now(), lu = lastUse(a);
  if (a.installed && now - a.installed < 14 * DAY) return ["Working", "new, installed " + ago(a.installed)];
  if (L.usage && !(lu && now - lu <= 60 * DAY)) return ["Superseded", lu ? "last used " + ago(lu) : "not used in the last two years"];
  if (cat === unsortedLabel()) return ["Working", "not sorted yet"];
  if (lu && now - lu <= 60 * DAY) return ["Current", (L.usage ? "used " : "opened ") + ago(lu)];
  return ["Current", "no usage data yet"];
}
function classifyAll() {
  for (const a of L.apps) Object.assign(a, classify(a));
  L.byKey = Object.fromEntries(L.apps.map(a => [a.key, a]));
}

// ---- loading --------------------------------------------------------------------------------------------
async function loadRules() {
  try { const r = await fetch("rules.json", { cache: "no-store" }); if (r.ok) RULES = { ...RULES, ...(await r.json()) }; } catch (e) { /* the defaults above */ }
}
async function loadPrefs() {
  try {
    const p = await native("prefs.get") || {};
    L.pins = p.pins && p.pins.apps ? p.pins : { apps: [], files: [] };
    L.over = p.over || {}; L.order = p.order || "apps-top"; L.view = p.view || "treemap"; L.metric = p.metric || "use";
    L.theme = validTheme(p.theme) || (p.tone ? themeFromTone(p.tone) : L.theme);
    if (Array.isArray(p.cats) && p.cats.length && !L.atlasCats.length) L.atlasCats = p.cats.filter(c => typeof c === "string");
    const ce = p.catEdits || {}, strs = x => Array.isArray(x) ? x.filter(c => typeof c === "string" && c.trim()) : [];
    L.catEdits = { add: strs(ce.add), del: strs(ce.del) };
    const cp = p.cal && typeof p.cal === "object" ? p.cal : {};
    CAL.view = CAL_VIEWS.includes(cp.view) ? cp.view : "agenda";
    CAL.hide = Array.isArray(cp.hide) ? cp.hide.filter(x => typeof x === "string") : [];
    CAL.colors = cp.colors && typeof cp.colors === "object" ? Object.fromEntries(Object.entries(cp.colors).filter(([, v]) => NAMED[v])) : {};
    CAL.def = typeof cp.def === "string" ? cp.def : ""; CAL.declined = cp.declined === true;
    L.use = {};
    if (p.use && typeof p.use === "object") for (const [k, v] of Object.entries(p.use)) if (Array.isArray(v) && isFinite(v[0]) && isFinite(v[1])) L.use[k] = [+v[0], +v[1]];
  } catch (e) { /* first run */ }
  setCats();
}
async function loadApps() {
  try { const r = await native("apps"); L.usage = !!r.usage; L.apps = (r.apps || []).filter(a => a.pkg); }
  catch (e) { L.apps = []; }
  classifyAll();
}
async function loadFiles() {
  try {
    if (L.files) {                                      // the map changes only when Atlas sorts again: ask first, it's small
      const st = await server("/status");
      if (st.last && st.last === L.files.generated) { L.filesErr = ""; return; }
    }
    const d = await server("/map.json");
    const fs = (d.folders || []).filter(f => f.state !== "skip");
    const cats = {};
    for (const f of fs) cats[f.category] = (cats[f.category] || 0) + (f.gb || 0);
    L.files = { total_files: d.total_files || 0, total_gb: d.total_gb || 0, folders: fs.length, generated: d.generated, missing: d.missing || [], cats: Object.values(cats) };
    if (Array.isArray(d.categories) && d.categories.length) { L.atlasCats = d.categories; savePref("cats", d.categories); }
    L.filesErr = "";
  } catch (e) { L.filesErr = e.message || "can't reach Atlas"; }
  if (!L.theme) try { const s = await server("/settings"); if (s.tone) { L.theme = themeFromTone(s.tone); applyTheme(); saveTheme(); } } catch (e) {}  // start from Atlas's color
  setCats();
  classifyAll();
}
let lastRefresh = 0;
async function refresh() {
  if (Date.now() - lastRefresh < 30000) return;
  lastRefresh = Date.now();
  await Promise.allSettled([loadApps(), loadFiles()]);
  refreshScreen();
}
function refreshScreen() {
  if (L.screen === "apps" && !document.body.classList.contains("sheeton")) { renderApps(); crumbs(); }
  else if (L.screen === "home") renderHome();
  meta();
}

// ---- the frame ---------------------------------------------------------------------------------------
const usedRecently = a => lastUse(a) && Date.now() - lastUse(a) <= 30 * DAY;
function meta() {
  const n = L.apps.length, used = L.apps.filter(usedRecently).length;
  if (L.screen === "settings") { $("#meta").textContent = "Atlas launcher" + (L.version ? " " + L.version : ""); return; }
  if (L.screen === "apps") {
    $("#meta").innerHTML = `<b>${fmtN(n)}</b> apps` + (L.usage || used ? ` · <b>${fmtN(used)}</b> used in 30 days` : "") + ` · ${L.usage ? "use from Android" : "no usage data"}`;
    return;
  }
  $("#meta").innerHTML = `<b>${fmtN(n)}</b> apps` + (L.files ? ` · <b>${fmtN(L.files.total_files)}</b> files · <b>${fmtGB(L.files.total_gb)}</b>` : "");
}
// ---- color: one color, or a gradient of two, picked on a wheel; or the sky (Sun) -----------------------------------
// A color is a hue (degrees) and a strength (OKLCH chroma); the four shades of the map come from it as in Atlas.
const DEF_THEME = { mode: "solid", a: { h: 27, c: .17 }, b: { h: 295, c: .15 } };          // Atlas red; the second color for gradients
const NAMED = { red: [27, .17], orange: [48, .15], amber: [78, .13], green: [150, .13], teal: [195, .11], blue: [255, .15], violet: [295, .15], graphite: [255, .02] };
const themeFromTone = k => { const t = NAMED[k] || NAMED.red; return { mode: "solid", a: { h: t[0], c: t[1] }, b: { ...DEF_THEME.b } }; };
const goodColor = x => x && isFinite(x.h) && isFinite(x.c) && x.c >= 0 && x.c <= .4;
const MODES = ["solid", "gradient", "sun"];                           // Sun keeps the wheel's two colors for when you go back
const validTheme = t => t && goodColor(t.a) && goodColor(t.b) ? { mode: MODES.includes(t.mode) ? t.mode : "solid", a: { h: +t.a.h, c: +t.a.c }, b: { h: +t.b.h, c: +t.b.c }, ...(t.ivory ? { ivory: true } : {}) } : null;
const theme = () => L.theme || (L.theme = JSON.parse(JSON.stringify(DEF_THEME)));
const okl = (l, x) => `oklch(${l} ${x.c.toFixed(3)} ${x.h.toFixed(1)})`;
function midColor(A, B) { const dh = ((B.h - A.h + 540) % 360) - 180; return { h: (A.h + dh / 2 + 360) % 360, c: (A.c + B.c) / 2 }; }
// What each box shows: in a gradient the color runs from the top of the upper box to the bottom of the lower one.
function boxColors(t) {
  if (t.mode !== "gradient") { const apps = okl(.63, t.a), files = okl(.53, t.a); return L.order === "files-top" ? [files, apps] : [apps, files]; }
  const M = midColor(t.a, t.b);
  return [`linear-gradient(to bottom, ${okl(.63, t.a)}, ${okl(.58, M)})`, `linear-gradient(to bottom, ${okl(.58, M)}, ${okl(.53, t.b)})`];
}
function applyTheme() {
  const t = theme(), r = document.documentElement.style, g = t.mode === "gradient", sun = t.mode === "sun";
  document.body.classList.toggle("ivory", !!t.ivory);
  document.body.classList.toggle("gradient", g);
  document.body.classList.toggle("sun", sun);
  if (sun) { if (!skyTimer) skyTimer = setInterval(() => skyPaint(false), SKY_MS); skyPaint(true); return; }
  clearInterval(skyTimer); skyTimer = 0; skyNow = null; skySent = null;
  r.setProperty("--h", t.a.h.toFixed(1)); r.setProperty("--c", t.a.c.toFixed(3));
  const [top, bottom] = boxColors(t);
  r.setProperty("--top-bg", top); r.setProperty("--bottom-bg", bottom);
  r.setProperty("--dot", g ? `linear-gradient(135deg, ${okl(.63, t.a)} 50%, ${okl(.63, t.b)} 50%)` : okl(.63, t.a));
}
// The app passes the color on to Atlas in Files. In Sun mode Atlas gets the sky itself (skyFiles), as a gradient.
function saveTheme() {
  savePref("theme", theme());
  if (theme().mode === "sun") { if (skyNow) skyFiles(skyNow, true); } else fire("files.theme", { theme: null });
}

// ---- Sun (1.4.0): the gradient follows the sky where the phone is ---------------------------------------------------
// The sun's height comes from the clock and the phone's place (NOAA's solar formulas). Each height has a color for the
// top of the screen (the sky overhead) and one for the bottom (the horizon): black at night; navy, violet and pink at
// dawn; sunrise, gold, the blue of the day; warmer colors in the evening, back to black. The colors mix in OKLab, so the
// day flows without steps, and stay at or under the maps' own brightness (OKLCH .62) so the white names stay readable.
const RAD = Math.PI / 180;
const NIGHT = [0, 0, 265];
//                 sun's height, overhead [OKLCH],   horizon [OKLCH]
const SKY_AM = [[-18, NIGHT, NIGHT], [-15, [.10, .025, 265], [.15, .04, 268]], [-12, [.15, .045, 264], [.24, .07, 270]],
  [-9, [.20, .065, 263], [.31, .09, 276]], [-6, [.26, .085, 262], [.37, .10, 292]], [-3, [.33, .10, 260], [.46, .12, 335]],
  [-.8, [.40, .11, 258], [.58, .15, 38]], [2, [.45, .12, 256], [.62, .15, 55]], [6, [.50, .13, 253], [.62, .12, 75]],
  [11, [.52, .14, 251], [.61, .07, 228]], [18, [.52, .15, 253], [.62, .09, 236]], [30, [.51, .155, 256], [.62, .105, 238]],
  [45, [.50, .16, 258], [.62, .11, 240]]].map(skyLab);
const SKY_PM = [[-18, NIGHT, NIGHT], [-15, [.09, .025, 265], [.14, .04, 268]], [-12, [.14, .045, 265], [.22, .065, 272]],
  [-9, [.19, .07, 268], [.29, .09, 284]], [-6, [.25, .09, 272], [.35, .12, 305]], [-3, [.31, .10, 268], [.44, .15, 355]],
  [-.8, [.38, .11, 262], [.54, .18, 32]], [2, [.44, .12, 258], [.59, .17, 45]], [6, [.49, .13, 255], [.61, .14, 60]],
  [11, [.52, .14, 251], [.61, .07, 228]], [18, [.52, .15, 253], [.62, .09, 236]], [30, [.51, .155, 256], [.62, .105, 238]],
  [45, [.50, .16, 258], [.62, .11, 240]]].map(skyLab);
function skyLab([e, z, h]) { return [e, lchLab(z), lchLab(h)]; }
function lchLab([l, c, h]) { return [l, c * Math.cos(h * RAD), c * Math.sin(h * RAD)]; }
const labMix = (p, q, f) => [p[0] + (q[0] - p[0]) * f, p[1] + (q[1] - p[1]) * f, p[2] + (q[2] - p[2]) * f];
const labDist = (p, q) => Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);
const labHC = p => ({ h: +((Math.atan2(p[2], p[1]) / RAD + 360) % 360).toFixed(1), c: +Math.min(.4, Math.hypot(p[1], p[2])).toFixed(3) });
function labRgb([l, a, b]) {
  const L_ = (l + 0.3963377774 * a + 0.2158037573 * b) ** 3, M_ = (l - 0.1055613458 * a - 0.0638541728 * b) ** 3, S_ = (l - 0.0894841775 * a - 1.2914855480 * b) ** 3;
  const f = x => { x = x <= 0.0031308 ? 12.92 * x : 1.055 * Math.pow(x, 1 / 2.4) - 0.055; return Math.round(255 * Math.min(1, Math.max(0, x))); };
  return [f(4.0767416621 * L_ - 3.3077115913 * M_ + 0.2309699292 * S_), f(-1.2684380046 * L_ + 2.6097574011 * M_ - 0.3413193965 * S_), f(-0.0041960863 * L_ - 0.7034186147 * M_ + 1.7076147010 * S_)];
}
const rgbCss = p => `rgb(${labRgb(p).join(",")})`;
// The sun's height above the horizon (degrees) and its hour angle (negative before noon) at a moment, from anywhere.
function sunPos(ms, lat, lon) {
  const T = (ms / DAY + 2440587.5 - 2451545) / 36525, L0 = ((280.46646 + T * (36000.76983 + T * 0.0003032)) % 360 + 360) % 360;
  const M = 357.52911 + T * (35999.05029 - 0.0001537 * T), e = 0.016708634 - T * (0.000042037 + 0.0000001267 * T);
  const C = Math.sin(M * RAD) * (1.914602 - T * (0.004817 + 0.000014 * T)) + Math.sin(2 * M * RAD) * (0.019993 - 0.000101 * T) + Math.sin(3 * M * RAD) * 0.000289;
  const om = 125.04 - 1934.136 * T, lam = L0 + C - 0.00569 - 0.00478 * Math.sin(om * RAD);
  const eps = 23 + (26 + (21.448 - T * (46.815 + T * (0.00059 - T * 0.001813))) / 60) / 60 + 0.00256 * Math.cos(om * RAD);
  const dec = Math.asin(Math.sin(eps * RAD) * Math.sin(lam * RAD)), y = Math.tan(eps * RAD / 2) ** 2;
  const eot = 4 / RAD * (y * Math.sin(2 * L0 * RAD) - 2 * e * Math.sin(M * RAD) + 4 * e * y * Math.sin(M * RAD) * Math.cos(2 * L0 * RAD)
    - 0.5 * y * y * Math.sin(4 * L0 * RAD) - 1.25 * e * e * Math.sin(2 * M * RAD));                   // minutes
  const utc = (ms % DAY + DAY) % DAY / 60000, ha = ((utc + eot + 4 * lon) % 1440 + 1440) % 1440 / 4 - 180;
  const cz = Math.sin(lat * RAD) * Math.sin(dec) + Math.cos(lat * RAD) * Math.cos(dec) * Math.cos(ha * RAD);
  return { el: 90 - Math.acos(Math.max(-1, Math.min(1, cz))) / RAD, ha };
}
function skyKey(keys, e) {
  if (e <= keys[0][0]) return [keys[0][1], keys[0][2]];
  for (let i = 1; i < keys.length; i++) if (e <= keys[i][0]) {
    const f = (e - keys[i - 1][0]) / (keys[i][0] - keys[i - 1][0]);
    return [labMix(keys[i - 1][1], keys[i][1], f), labMix(keys[i - 1][2], keys[i][2], f)];
  }
  const k = keys[keys.length - 1]; return [k[1], k[2]];
}
// The sky at a moment: the colors overhead (z) and at the horizon (h). The morning's and the evening's colors blend
// near noon and midnight, where they are the same, so nothing jumps even where the sun stays low all day.
function skyAt(ms, p) {
  const s = sunPos(ms, p.lat, p.lon), w = Math.min(1, Math.max(0, .5 + Math.sin(s.ha * RAD)));
  const am = skyKey(SKY_AM, s.el), pm = skyKey(SKY_PM, s.el);
  return { el: s.el, ha: s.ha, z: labMix(am[0], pm[0], w), h: labMix(am[1], pm[1], w) };
}
const skyEase = f => Math.pow(Math.min(1, Math.max(0, f)), 1.6);      // the horizon's colors gather near the bottom, as outside
const skyColor = (s, f) => labMix(s.z, s.h, skyEase(f));               // f: 0 at the top of the screen, 1 at the bottom
function skyPhase(s) {
  const am = s.ha < 0, e = s.el;
  return e < -18 ? "night" : e < -12 ? (am ? "astronomical dawn" : "astronomical dusk") : e < -6 ? (am ? "nautical dawn" : "nautical dusk")
    : e < -.833 ? "blue hour" : e < 3 ? (am ? "sunrise" : "sunset") : e < 10 ? "golden hour" : Math.abs(s.ha) < 18.75 ? "midday" : am ? "morning" : "afternoon";
}
// Where the phone is: Android's approximate location, kept by the app (Settings, Appearance, Sun asks for it). Until there
// is one, a guess from the time zone: the longitude from its standard offset, the hemisphere from its summer time.
function placeGuess() {
  const y = new Date().getFullYear(), jan = new Date(y, 0, 1).getTimezoneOffset(), jul = new Date(y, 6, 1).getTimezoneOffset();
  return { lat: jan > jul ? 40 : jan < jul ? -35 : 20, lon: -Math.max(jan, jul) / 4, guess: true };
}
const where = () => L.place || placeGuess();
async function loadPlace(fresh) {
  try {
    const p = await native("place.get", { fresh: !!fresh }) || {};
    L.placeOk = !!p.allowed; L.placeOn = p.on !== false;
    L.place = typeof p.lat === "number" && typeof p.lon === "number" && isFinite(p.lat) && isFinite(p.lon) ? { lat: p.lat, lon: p.lon, at: +p.at || 0 } : null;
  } catch (e) { /* the guess */ }
  skyPaint(true); if (L.screen === "settings") paintLook();
}
// Six points of the sky, from the top of the upper box to the bottom of the lower one. The page sets them every 20 s,
// aimed 20 s ahead, and the colors glide there (launcher.css): a slow, continuous film, not a picture every 20 s.
const SKY_MS = 20000, SKY_AT = [0, .245, .49, .51, .755, 1];
let skyTimer = 0, skyNow = null, skySent = null, skySentAt = 0;
function skyPaint(jump) {
  if (theme().mode !== "sun") return;
  const s = skyNow = skyAt(Date.now() + (jump ? 0 : SKY_MS), where()), r = document.documentElement.style;
  r.setProperty("--sky-t", jump ? ".9s" : SKY_MS + "ms");
  SKY_AT.forEach((f, i) => r.setProperty("--s" + i, rgbCss(skyColor(s, f))));
  const top = labHC(s.z); r.setProperty("--h", top.h.toFixed(1)); r.setProperty("--c", top.c.toFixed(3));
  document.body.classList.toggle("skynight", s.z[0] < .2);
  if (L.screen === "apps") $$("#map [data-tp]").forEach(el => tint(el, +el.dataset.tp));
  if (L.screen === "settings") paintSun();
  skyFiles(s, false);
}
// Atlas in Files gets the sky as a gradient between its two ends. Its page redraws for each change, so it gets one only
// when the colors have moved enough to see, at most every 10 minutes (and the app hands it over while Files is hidden).
function skyFiles(s, force) {
  const now = Date.now(), moved = !skySent || Math.max(labDist(s.z, skySent.z), labDist(s.h, skySent.h)) > .03;
  if (!force && (!moved || now - skySentAt < 600000)) return;
  skySent = s; skySentAt = now;
  fire("files.theme", { theme: { mode: "gradient", a: labHC(s.z), b: labHC(s.h), ...(theme().ivory ? { ivory: true } : {}) } });
}
// Holding the Settings circle swaps black and ivory: background, text, lines, the circle and its cross. The new scheme
// grows out of the circle you held.
function flipScheme(el) {
  L.theme = { ...theme(), ivory: !theme().ivory }; saveTheme();
  if (!document.startViewTransition || reduced()) return applyTheme();
  const r = el.getBoundingClientRect(), x = r.left + r.width / 2, y = r.top + r.height / 2;
  const R = Math.hypot(Math.max(x, innerWidth - x), Math.max(y, innerHeight - y));
  const vt = document.startViewTransition(applyTheme);
  vt.ready.then(() => document.documentElement.animate({ clipPath: [`circle(0px at ${x}px ${y}px)`, `circle(${R}px at ${x}px ${y}px)`] },
    { duration: 560, easing: "cubic-bezier(.4, 0, .2, 1)", pseudoElement: "::view-transition-new(root)" })).catch(() => {});
}
// Where a tile or dot sits (0 at the top, 1 at the bottom) gives it its color: along the gradient, or in Sun mode the
// sky's color there at the maps' own brightness (gray at night, so the names stay readable).
function tintAt(t) {
  const th = theme();
  if (th.mode === "sun") return skyNow ? labHC(skyColor(skyNow, t)) : null;
  if (th.mode !== "gradient") return null;
  t = Math.min(1, Math.max(0, t)); const dh = ((th.b.h - th.a.h + 540) % 360) - 180;
  return { h: (th.a.h + dh * t + 360) % 360, c: th.a.c + (th.b.c - th.a.c) * t };
}
function tint(el, t) {
  const x = tintAt(t); if (!x) return;
  el.dataset.tp = t.toFixed(4);                                          // Sun mode tints it again as the sky moves
  el.style.setProperty("--h", x.h.toFixed(1)); el.style.setProperty("--c", x.c.toFixed(3));
}

// ---- home: the two boxes -----------------------------------------------------------------------------
function applyOrder() {
  const home = $("#home"), apps = $("#box-apps"), files = $("#box-files"), filesTop = L.order === "files-top";
  if (filesTop) home.insertBefore(files, apps); else home.insertBefore(apps, files);
  apps.classList.toggle("top", !filesTop); apps.classList.toggle("bottom", filesTop);
  files.classList.toggle("top", filesTop); files.classList.toggle("bottom", !filesTop);
}
function renderHome() {
  const n = L.apps.length, used = L.apps.filter(usedRecently).length;
  $("#v-apps").textContent = n ? `${fmtN(n)} apps` + (used ? ` · ${fmtN(used)} used in 30 days` : "") : "Reading the apps on this phone";
  $("#v-files").textContent = L.files ? `${fmtN(L.files.total_files)} files · ${fmtGB(L.files.total_gb)} · ${fmtN(L.files.folders)} folders`
    : L.filesErr === "not signed in" ? "Not signed in to Atlas yet: tap to sign in"
    : L.filesErr ? "Can't reach Atlas right now. Is Tailscale on?" : "Asking Atlas";
  meta();
}

function show(screen) {
  L.screen = screen; document.body.dataset.screen = screen;
  $("#home").hidden = screen !== "home"; $("#apps").hidden = screen !== "apps"; $("#settings").hidden = screen !== "settings";
  $("#title").textContent = screen === "apps" ? "Apps" : screen === "settings" ? "Settings" : "Atlas";
  $("#q").placeholder = screen === "apps" ? "Find an app, or search Google" : "Find an app or file, or search Google";
  closeSheet(); hideResults(); closeDial(); closeProcs(true); closeCal(true);
  if (screen === "apps") { setSeg("#views", "v", L.view); setSeg("#metric", "m", L.metric); renderApps(); crumbs(); }
  else if (screen === "settings") renderSettings();
  else renderHome();
  meta();
}
function goHome() { L.q = ""; $("#q").value = ""; $("#q").blur(); L.zoom = []; L.tz = null; resetMZ(); show("home"); }
function openApps() { L.zoom = []; L.tz = null; resetMZ(); L.q = ""; $("#q").value = ""; show("apps"); }
function openFilesView() { closeDial(); fire("files.show"); }
function openFile(path, dir) { closeDial(); hideResults(); fire("files.open", { path, dir: !!dir }); }
function setSeg(sel, attr, val) { $$(sel + " button").forEach(b => b.setAttribute("aria-pressed", String(b.dataset[attr] === val))); }

// ---- launching -------------------------------------------------------------------------------------------
function launch(a, el) {
  if (!a) return;
  const r = el ? el.getBoundingClientRect() : null;
  native("launch", { key: a.key, x: r ? r.left : 0, y: r ? r.top : 0, w: r ? r.width : 0, h: r ? r.height : 0 })
    .then(() => { a.launches = (a.launches || 0) + 1; a.lastLaunch = Date.now(); })
    .catch(e => toast("Couldn't open " + a.label + ": " + e.message));
}

// ---- the dial ----------------------------------------------------------------------------------
// The circle: one tap opens the dial (tap a name to open it), another tap closes it. Holding it opens the dial to remove
// names: they are gray, a first tap turns a name red, a second tap takes it off the dial. Either way the cross spins
// while the names come out of the circle and swing onto three rings, the most used first and nearest (closing runs it
// all in reverse): apps by their time in front (Android's
// usage data, last 30 days; launches from Atlas without it), files and folders by the time spent after opening them here.
const dialOpen = () => { const d = $("#dial"); return !d.hidden && !d.classList.contains("closing"); };
let dialMode = "open", armed = null, dialT = 0;
const pinId = p => p.key || p.path;
const reduced = () => matchMedia("(prefers-reduced-motion: reduce)").matches;
const HALF = 14 * DAY;                                                  // file time halves every two weeks: recent use counts most
const fileUse = (id, now = Date.now()) => { const u = L.use[id]; return u ? u[0] * Math.pow(0.5, Math.max(0, now - u[1]) / HALF) : 0; };
function useOf(p) {
  if (!p.key) return fileUse(p.path);
  const a = L.byKey[p.key]; if (!a) return -1;
  return L.usage ? a.fg30 || 0 : (a.launches30 || 0) + (a.launches || 0);
}
const rankByUse = list => list.map((p, i) => ({ p, i, u: useOf(p) })).sort((x, y) => y.u - x.u || x.i - y.i).map(x => x.p);
// A file or folder opened from the dial: the time until you come back Home (or leave Atlas) counts for it, up to 3 hours.
let session = null;
function startSession(id) { endSession(); session = { id, t0: Date.now() }; }
function endSession() {
  if (!session) return;
  const s = session, now = Date.now(), ms = Math.min(now - s.t0, 3 * 3600e3); session = null;
  if (ms < 3000 || !L.pins.files.some(p => p.path === s.id)) return;
  L.use[s.id] = [Math.round(fileUse(s.id, now) + ms), now];
  const keep = new Set(L.pins.files.map(p => p.path));
  for (const k of Object.keys(L.use)) if (!keep.has(k)) delete L.use[k];
  savePref("use", L.use);
}
// Three rings around the circle, nearest first: 3, 3 and 4 names, in order of use. On each ring the most used sits in
// the middle, the next ones to its left and right. Neighbours on a ring sit a name's width apart.
const RINGS = [[3, 108], [3, 180], [4, 252]];
const ringScale = room => Math.min(1, Math.max(.8, room / 300));
function spots(n, cx, cy, dir, W, room) {
  const k = ringScale(room), out = [];
  let left = n;
  RINGS.forEach(([cap, r0], ring) => {
    const m = Math.min(cap, left); left -= m; if (!m) return;
    const r = r0 * k, step = 2 * Math.asin(Math.min(1, 50 / r));          // radians between neighbours: 100 px apart
    const slots = [...Array(m).keys()].map(i => (m - 1) / 2 - i).sort((a, b) => Math.abs(a) - Math.abs(b) || b - a);
    for (const o of slots) {
      const ang = Math.PI / 2 + step * o;                                 // centred on the vertical; o > 0 is to the left
      out.push({ x: Math.min(W - 48, Math.max(48, cx + r * Math.cos(ang))), y: cy - dir * r * Math.sin(ang), ring });
    }
  });
  return out;
}
function dialSides() {
  const appsUp = L.order !== "files-top";
  return [{ name: "Apps", list: rankByUse(L.pins.apps.slice(0, MAX_PINS)), dir: appsUp ? 1 : -1, empty: "Long-press an app anywhere in Atlas to add it here" },
          { name: "Files", list: rankByUse(L.pins.files.slice(0, MAX_PINS)), dir: appsUp ? -1 : 1, empty: "Long-press a file or folder in Files to add it here" }];
}
function hubCenter() { const r = $("#hub").getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; }
function openDial(mode, quiet) {
  clearTimeout(dialT); clearTimeout(veilT);
  dialMode = mode === "edit" ? "edit" : "open"; armed = null;
  const d = $("#dial");
  let html = "";
  for (const s of dialSides()) {
    s.list.forEach((p, i) => { html += `<button type="button" class="di" data-side="${s.name}" data-id="${esc(pinId(p))}" data-rank="${i}"><span class="nm">${esc(p.label || p.name)}</span></button>`; });
    html += `<div class="side" data-say="${s.name}">${s.name}</div><div class="hint" data-for="${s.name}"></div>`;
  }
  html += `<div class="edithint">Tap a name twice to take it off the dial</div>`;
  d.innerHTML = html; d.hidden = false; d.classList.remove("open", "closing");
  d.classList.toggle("edit", dialMode === "edit");
  const hub = $("#hub"); hub.classList.add("on"); hub.classList.toggle("edit", dialMode === "edit");
  placeDial();
  $$("#dial .di").forEach(b => pressable(b, () => tapPin(b), () => { if (dialMode !== "edit") pinSheet(pinOf(b), b.dataset.side); }));
  void d.offsetWidth; d.classList.add("open");                          // the veil fades in
  if (quiet || reduced()) return turnCross(dialMode === "edit" ? 45 : 0, 1);
  turnCross((dialMode === "edit" ? 45 : 0) + 360, Math.max(420, swirl(true)), SPIN_OUT);
}
// Where each name sits; run again after a name is removed, so the others close up (and move in a ring if they now rank higher).
function placeDial() {
  const [cx, cy] = hubCenter(), W = window.innerWidth, H = window.innerHeight, top = $("#frame").getBoundingClientRect().bottom;
  const room = Math.min(cy - top, H - cy) - 12;
  for (const s of dialSides()) {
    const els = $$(`#dial .di[data-side="${s.name}"]`).filter(b => !b.classList.contains("gone"));
    const ps = spots(els.length, cx, cy, s.dir, W, room);
    els.forEach((b, i) => { b.dataset.rank = i; b.dataset.ring = ps[i].ring; b.style.left = ps[i].x.toFixed(1) + "px"; b.style.top = ps[i].y.toFixed(1) + "px"; });
    const side = $(`#dial .side[data-say="${s.name}"]`), hint = $(`#dial .hint[data-for="${s.name}"]`);
    const outer = els.length ? RINGS[ps[ps.length - 1].ring][1] * ringScale(room) + 36 : 70;
    side.style.top = (cy - s.dir * outer - 8).toFixed(0) + "px";          // beyond the outermost ring
    hint.textContent = els.length ? "" : s.empty; hint.style.top = (cy - s.dir * 118 - 18).toFixed(0) + "px";
  }
  const eh = $("#dial .edithint"); if (eh) eh.style.top = (top + 14).toFixed(0) + "px";
}
// The names come out of the circle and swing clockwise onto their rings, as if thrown by the spinning cross, one after
// another by rank. Closing is the same in reverse: the least used go back first, counterclockwise, into the circle.
// Returns how long it takes, in ms.
const STAGGER = 55, TRAVEL = 460, SWEEP = 1.1;                           // SWEEP: about 63 degrees of swing
function swirl(out) {
  const [cx, cy] = hubCenter(), els = $$("#dial .di").filter(b => !b.classList.contains("gone")), count = { Apps: 0, Files: 0 };
  for (const b of els) count[b.dataset.side]++;
  let total = 0;
  for (const b of els) {
    b.getAnimations().forEach(x => x.cancel());
    const fx = parseFloat(b.style.left), fy = parseFloat(b.style.top), R = Math.hypot(fx - cx, fy - cy), fa = Math.atan2(fy - cy, fx - cx);
    const frames = [];
    for (let k = 0; k <= 12; k++) {
      const u = k / 12, e = 1 - Math.pow(1 - u, 3), r = R * e, ang = fa - SWEEP * (1 - e);
      frames.push({ opacity: Math.min(1, u * 3),
        transform: `translate(${(cx + r * Math.cos(ang) - fx).toFixed(1)}px,${(cy + r * Math.sin(ang) - fy).toFixed(1)}px) scale(${(.3 + .7 * e).toFixed(3)})` });
    }
    const rank = +b.dataset.rank || 0, delay = (out ? rank : count[b.dataset.side] - 1 - rank) * STAGGER;
    b.animate(out ? frames : frames.reverse(), { duration: TRAVEL, delay, easing: "linear", fill: out ? "backwards" : "forwards" });
    total = Math.max(total, delay + TRAVEL);
  }
  return total;
}
// The cross: it turns toward an × while you hold the circle, spins clockwise for as long as the names take to come out
// (ending as a +, or an × when removing), and counterclockwise while they go back in (ending as a +).
const SPIN_OUT = "cubic-bezier(.3, .55, .2, 1)", SPIN_IN = "cubic-bezier(.8, 0, .7, .45)";   // the second is the first, mirrored
function crossAngle(el) {
  const m = getComputedStyle(el).transform, v = m && m.match(/matrix\(([^)]+)\)/);
  if (!v) return 0;
  const [a, b] = v[1].split(",").map(Number); return Math.atan2(b, a) * 180 / Math.PI;
}
function turnCross(to, ms, easing) {
  const i = $("#hub i"), from = crossAngle(i);
  i.getAnimations().forEach(x => x.cancel());
  i.animate([{ transform: `rotate(${from.toFixed(1)}deg)` }, { transform: `rotate(${to}deg)` }],
    { duration: reduced() ? 1 : Math.max(1, ms), easing: easing || "linear", fill: "forwards" });
}
function pinOf(b) { return (b.dataset.side === "Apps" ? L.pins.apps : L.pins.files).find(p => pinId(p) === b.dataset.id); }
// Closing: when you dismiss the dial, the opening in reverse (the names swing back into the circle while the cross
// spins the other way); at once when something opens.
let veilT = 0;
function closeDial(animated) {
  const d = $("#dial");
  if (d.hidden) { $("#hub").classList.remove("on", "edit"); return; }
  if (animated && d.classList.contains("closing")) return;              // already going back in
  clearTimeout(dialT); clearTimeout(veilT); dialMode = "open"; armed = null;
  $("#hub").classList.remove("on", "edit");
  if (animated && !reduced()) {
    d.classList.add("closing");
    const ms = Math.max(420, swirl(false));
    turnCross(-360, ms, SPIN_IN);
    veilT = setTimeout(() => d.classList.remove("open"), Math.max(0, ms - 240));      // the veil lifts as the last names go in
    dialT = setTimeout(() => { d.classList.remove("closing", "edit", "open"); d.hidden = true; d.innerHTML = ""; }, ms + 20);
    return;
  }
  turnCross(0, 1);
  d.classList.remove("open", "edit", "closing"); d.hidden = true; d.innerHTML = "";
}
function tapPin(b) {
  if (dialMode !== "edit") return openPin(pinOf(b));
  if (armed !== b) { if (armed) armed.classList.remove("armed"); armed = b; b.classList.add("armed"); haptic("tick"); return; }
  const p = pinOf(b), list = b.dataset.side === "Apps" ? L.pins.apps : L.pins.files, i = list.indexOf(p);
  armed = null;
  if (i >= 0) { list.splice(i, 1); savePref("pins", L.pins); }
  haptic("long"); b.classList.add("gone");
  setTimeout(() => { b.remove(); if (dialOpen()) placeDial(); }, 220);
}
function openPin(p) {
  if (!p) return;
  closeDial();
  if (p.key) { const a = L.byKey[p.key]; if (a) launch(a); else toast(`${p.label} is no longer on this phone`); }
  else { startSession(p.path); openFile(p.path, p.dir); }
}
// The circle: one tap opens the dial a quarter second later, once no second tap has come; two quick taps open the
// phone's camera instead (1.7.0); holding opens the dial for taking names off. With the dial open, a tap closes it.
const DOUBLE_TAP = 250;                                                   // ms from the first tap's lift to the second touch
(function hubControl() {
  const hub = $("#hub");
  let timer = 0, down = false, held = false, wait = 0, twice = false;
  const rest = () => turnCross(dialOpen() && dialMode === "edit" ? 45 : 0, 160);
  hub.addEventListener("pointerdown", e => {
    e.preventDefault(); down = true; held = false; twice = false;
    if (wait) {                                                          // the second of two quick taps: the camera
      clearTimeout(wait); wait = 0; twice = true;
      haptic("tick"); turnCross(0, 160); fire("camera.open");
      return;
    }
    hub.classList.add("press"); turnCross(45, 520);                      // the cross turns toward an × while you hold
    clearTimeout(timer);
    timer = setTimeout(() => { held = true; hub.classList.remove("press"); haptic("long"); openDial("edit"); }, 520);
  });
  const end = cancel => {
    clearTimeout(timer); hub.classList.remove("press");
    if (!down) return;
    down = false;
    if (held || twice) return;                                           // the dial stays open to remove names; or the camera is on its way
    if (cancel) return rest();
    if (dialOpen()) return closeDial(true);
    turnCross(crossAngle($("#hub i")), 1);                               // the cross holds still while a second tap may come
    wait = setTimeout(() => {
      wait = 0;
      if (L.screen !== "home" || dialOpen()) return rest();              // something else opened meanwhile
      haptic("tick"); openDial("open");
    }, DOUBLE_TAP);
  };
  hub.addEventListener("pointerup", () => end(false));
  hub.addEventListener("pointercancel", () => end(true));
  hub.addEventListener("pointerleave", () => { if (down && !held) { clearTimeout(timer); down = false; hub.classList.remove("press"); rest(); } });
  hub.addEventListener("click", e => e.preventDefault());
  $("#dial").addEventListener("click", e => { if (e.target.id === "dial") closeDial(true); });
})();

function togglePin(side, item) {
  const list = side === "Apps" ? L.pins.apps : L.pins.files, id = item.key || item.path;
  const i = list.findIndex(p => (p.key || p.path) === id);
  if (i >= 0) { list.splice(i, 1); toast("Removed from the dial"); }
  else if (list.length >= MAX_PINS) { toast(`The dial holds ${MAX_PINS} ${side.toLowerCase()}. Remove one first.`); return; }
  else { list.push(item); toast("Added to the dial"); }
  savePref("pins", L.pins);
}
const isPinned = (side, id) => (side === "Apps" ? L.pins.apps : L.pins.files).some(p => (p.key || p.path) === id);
function pinSheet(p, side) {
  if (!p) return;
  closeDial();
  if (side === "Apps" && L.byKey[p.key]) return appSheet(L.byKey[p.key]);
  const t = p.path ? fileUse(p.path) : 0;
  openSheet(`<div class="chip">Dial · ${esc(side)}</div><h2>${esc(p.label || p.name)}</h2>
    ${p.path ? `<div class="path">${esc(p.path)}</div>
    <dl><dt>Time with it</dt><dd>${t >= 60000 ? fmtDur(t) : "none yet"}</dd></dl>
    <p class="note">Counted from opening it on the dial until you go back Home, recent weeks counting most. The dial puts what you use most nearest the circle.</p>` : ""}
    <div class="row"><button type="button" class="btn primary" id="p-open">Open</button>
      ${p.path && !p.dir ? `<button type="button" class="btn" id="p-dir">Open its folder</button>` : ""}
      <button type="button" class="btn" id="p-rm">Remove from dial</button></div>`, P => {
    P.querySelector("#p-open").onclick = () => { closeSheet(); openPin(p); };
    if (P.querySelector("#p-dir")) P.querySelector("#p-dir").onclick = () => { closeSheet(); openFile(dirName(p.path), true); };
    P.querySelector("#p-rm").onclick = () => { togglePin(side, p); closeSheet(); };
  });
}

// ---- sheets ---------------------------------------------------------------------------------------------
function openSheet(html, wire) {
  $("#panel").innerHTML = html; $("#scrim").hidden = false; document.body.classList.add("sheeton");
  $("#sheet").scrollTop = 0;
  if (wire) wire($("#panel"));
}
function closeSheet() { document.body.classList.remove("sheeton"); $("#scrim").hidden = true; }
$("#sheetx").onclick = closeSheet;
$("#scrim").onclick = closeSheet;
let toastT = 0;
function toast(msg) { const t = $("#toast"); t.textContent = msg; t.hidden = false; clearTimeout(toastT); toastT = setTimeout(() => { t.hidden = true; }, 2200); }

function appSheet(a) {
  const pinned = isPinned("Apps", a.key);
  const states = L.states.map(s => `<option ${s === a.state ? "selected" : ""}>${esc(s)}</option>`).join("");
  const cats = (L.cats.length ? L.cats : [a.category]).map(c => `<option ${c === a.category ? "selected" : ""}>${esc(c)}</option>`).join("");
  openSheet(`
    <div class="chip">${esc(a.state)}</div>
    <h2>${esc(a.label)}</h2>
    <div class="row"><button type="button" class="btn primary" id="s-pin">${pinned ? "Remove from dial" : "Add to dial"}</button><button type="button" class="btn" id="s-open">Open</button></div>
    <div class="why">${esc(a.category)}<small>${esc(HOW[a.how] || "")}: ${esc(a.why)}${a.swhy ? "; " + esc(a.swhy) : ""}</small></div>
    <dl>${L.usage ? `<dt>Last used</dt><dd>${a.lastUsed ? ago(a.lastUsed) : "not in the last two years"}</dd><dt>Use, 30 days</dt><dd>${fmtDur(a.fg30)}</dd><dt>Opens, 30 days</dt><dd>${fmtN(a.opens30)}</dd>`
      : `<dt>Opened from Atlas</dt><dd>${fmtN(a.launches30)} times in 30 days</dd>`}
      <dt>Installed</dt><dd>${ymd(a.installed)}</dd><dt>Updated</dt><dd>${ymd(a.updated)}</dd>${a.work ? `<dt>Profile</dt><dd>Work</dd>` : ""}</dl>
    <div class="path">${esc(a.pkg)}</div>
    <div class="row"><button type="button" class="btn" id="s-info">App info</button><button type="button" class="btn" id="s-un" ${a.system ? "disabled" : ""}>Uninstall</button></div>
    <div class="move">
      <label>Move to state<select id="mv-s">${states}</select></label>
      <label>Category<select id="mv-c">${cats}</select></label>
      <div class="row"><button type="button" class="btn primary" id="mv-go">Move</button>${a.how === "you" ? `<button type="button" class="btn" id="mv-reset">Let the software decide</button>` : ""}</div>
    </div>`, P => {
    P.querySelector("#s-pin").onclick = () => { togglePin("Apps", { key: a.key, label: a.label }); appSheet(a); };
    P.querySelector("#s-open").onclick = () => { closeSheet(); launch(a); };
    P.querySelector("#s-info").onclick = () => fire("appInfo", { key: a.key });
    P.querySelector("#s-un").onclick = () => fire("uninstall", { key: a.key });
    P.querySelector("#mv-go").onclick = () => {
      L.over[a.key] = { state: P.querySelector("#mv-s").value, category: P.querySelector("#mv-c").value, at: new Date().toISOString().slice(0, 19) };
      savePref("over", L.over); classifyAll(); toast("Moved"); closeSheet(); refreshScreen();
    };
    if (P.querySelector("#mv-reset")) P.querySelector("#mv-reset").onclick = () => { delete L.over[a.key]; savePref("over", L.over); classifyAll(); toast("Back to the software's choice"); closeSheet(); refreshScreen(); };
  });
}
function fileSheet(f) {
  const pinned = isPinned("Files", f.path);
  openSheet(`<div class="chip">${esc(f.dir ? "folder" : f.kind === "image_conv" ? "image" : f.kind || "file")}</div><h2>${esc(f.name)}</h2>
    <div class="row"><button type="button" class="btn primary" id="f-pin">${pinned ? "Remove from dial" : "Add to dial"}</button><button type="button" class="btn" id="f-open">Open</button>
      ${f.dir ? "" : `<button type="button" class="btn" id="f-dir">Open its folder</button>`}</div>
    <dl>${f.size != null && !f.dir ? `<dt>Size</dt><dd>${fmtSize(f.size)}</dd>` : ""}${f.mtime ? `<dt>Changed</dt><dd>${ymd(f.mtime * 1000)}</dd>` : ""}</dl>
    <div class="path">${esc(f.path)}</div>`, P => {
    P.querySelector("#f-pin").onclick = () => { togglePin("Files", { path: f.path, name: f.name, dir: !!f.dir, kind: f.kind || "" }); fileSheet(f); };
    P.querySelector("#f-open").onclick = () => { closeSheet(); openFile(f.path, f.dir); };
    if (P.querySelector("#f-dir")) P.querySelector("#f-dir").onclick = () => { closeSheet(); openFile(dirName(f.path), true); };
  });
}
// ---- Settings: appearance, layout, home screen, usage, Atlas, version, quit ------------------------------------------
async function renderSettings() {
  const info = await native("info").catch(() => ({}));
  L.version = info.version || ""; meta();
  const t = theme(), signedIn = !!L.files, err = L.filesErr;
  const box = $("#settings");
  box.innerHTML = `<div class="set">
    <section id="s-look"><h3>Appearance</h3>
      <div class="seg" id="o-mode"><button type="button" data-m="solid" aria-pressed="${t.mode === "solid"}">One color</button><button type="button" data-m="gradient" aria-pressed="${t.mode === "gradient"}">Gradient</button><button type="button" data-m="sun" aria-pressed="${t.mode === "sun"}">Sun</button></div>
      <div class="wheelrow"><div class="wheel" id="wheel"><canvas></canvas><span class="hd" data-k="a">1</span><span class="hd" data-k="b">2</span></div>
        <div class="sunday" id="sunday" hidden><canvas aria-label="Today's sky, hour by hour"></canvas><i class="now"></i><div class="ticks">${[0, 25, 50, 75, 100].map(x => `<span style="left:${x}%"></span>`).join("")}</div></div>
        <div class="mh" id="mh" aria-hidden="true"><i class="t"></i><i class="b"></i><b></b></div></div>
      <p class="note" id="o-look"></p>
      <div class="row"><button type="button" class="btn" id="o-place" hidden>Allow location</button><button type="button" class="btn" id="o-reset">Back to red</button></div></section>
    <section><h3>Layout</h3><div class="seg" id="o-order"><button type="button" data-o="apps-top" aria-pressed="${L.order !== "files-top"}">Apps on top</button><button type="button" data-o="files-top" aria-pressed="${L.order === "files-top"}">Files on top</button></div></section>
    <section><h3>Home screen</h3>${info.isDefault ? `<p class="note">Atlas is your Home screen.</p>`
      : `<p class="note">Atlas isn't your Home screen yet.</p><div class="row"><button type="button" class="btn primary" id="o-home">Make Atlas the Home screen</button></div>`}</section>
    <section><h3>Usage</h3>${L.usage ? `<p class="note">Apps are sized by how much you use them, and apps unused for two months move to Superseded.</p>`
      : `<p class="note">Allow usage access and the apps you use most become the biggest tiles, and apps you stopped using move to Superseded. Nothing leaves the phone.</p><div class="row"><button type="button" class="btn" id="o-usage">Allow usage access</button></div>`}</section>
    <section><h3>Calendar</h3><p class="note">Swipe right on Home for every calendar on this phone, personal and work, in one place.${info.calendar === false ? " Atlas needs your permission to read them." : ""}</p>
      ${info.calendar === false ? `<div class="row"><button type="button" class="btn" id="o-cal">Allow calendars</button></div>` : ""}</section>
    <section><h3>Atlas</h3><p class="note">${signedIn ? `Signed in${L.files.generated ? ", map from " + esc(L.files.generated.replace("T", " ").slice(0, 16)) : ""}.` : err === "not signed in" ? "Not signed in to Atlas yet." : "Can't reach Atlas right now. Check that Tailscale is on."}</p>
      <div class="path">${esc(info.server || "")}</div>
      ${signedIn ? "" : `<label class="note" for="o-code">Pairing code</label><input id="o-code" autocomplete="one-time-code" autocapitalize="off" spellcheck="false"><div class="row"><button type="button" class="btn" id="o-pair">Sign in to Atlas</button></div>`}</section>
    <section><h3>Version</h3><p class="note">Atlas launcher ${esc(info.version || "")}</p><div class="row"><button type="button" class="btn" id="o-upd">Check for an update</button></div><p class="note" id="o-updn"></p></section>
    <section><h3>Quit</h3><p class="note">Go back to the phone's own launcher. Atlas stays installed with everything you set: open it from your apps to come back.</p>
      <div class="row"><button type="button" class="btn quit" id="o-quit">Quit Atlas</button></div></section>
  </div>`;
  sunDayKey = "";
  wheelControl($("#wheel"));
  // Sun: Android asks once for the phone's approximate location, right when you pick it.
  $$("#o-mode button").forEach(b => b.onclick = () => {
    const m = b.dataset.m; theme().mode = m; setSeg("#o-mode", "m", m);
    applyTheme(); saveTheme(); paintLook();
    if (m === "sun") { fire("place.allow", { auto: true }); loadPlace(true); }
  });
  $("#o-place").onclick = () => fire("place.allow");
  $("#o-reset").onclick = () => { L.theme = { ...JSON.parse(JSON.stringify(DEF_THEME)), ...(theme().ivory ? { ivory: true } : {}) }; setSeg("#o-mode", "m", "solid"); applyTheme(); saveTheme(); paintLook(); };
  $$("#o-order button").forEach(b => b.onclick = () => { L.order = b.dataset.o; savePref("order", L.order); applyOrder(); applyTheme(); setSeg("#o-order", "o", L.order); paintLook(); });
  if ($("#o-home")) $("#o-home").onclick = () => fire("home.request");
  if ($("#o-usage")) $("#o-usage").onclick = () => fire("usage.request");
  if ($("#o-cal")) $("#o-cal").onclick = () => fire("cal.allow");
  if ($("#o-pair")) $("#o-pair").onclick = () => { const c = $("#o-code").value.trim(); if (c) { fire("pair", { code: c }); toast("Signing in to Atlas"); } };
  // One button: "Check for an update" becomes "Update" when Atlas has a newer version; otherwise it stays and says so.
  let ready = false;
  $("#o-upd").onclick = async () => {
    const b = $("#o-upd"), n = $("#o-updn");
    if (ready) {
      b.disabled = true; setTimeout(() => { b.disabled = false; }, 10000);
      n.textContent = "Downloading. Android will ask you to confirm."; fire("update.install"); return;
    }
    n.textContent = "Asking Atlas…";
    try {
      const u = await native("update.check");
      if (!u.available) { n.textContent = "No update. You have the latest version."; return; }
      ready = true; b.textContent = "Update";
      n.textContent = `Version ${u.version} is ready${u.notes ? ": " + u.notes : "."}`;
    } catch (e) { n.textContent = "Couldn't check: " + e.message; }
  };
  let armed = 0;
  $("#o-quit").onclick = () => {
    const b = $("#o-quit");
    if (Date.now() - armed > 4000) { armed = Date.now(); b.textContent = "Tap again to quit"; setTimeout(() => { if (Date.now() - armed >= 4000) b.textContent = "Quit Atlas"; }, 4100); return; }
    fire("quit");
  };
}

// The wheel: hue around the circle, strength from the gray middle to the edge, at the lightness of Atlas's tiles.
// Drag the handle (in a gradient, the nearer of the two) to change the color.
const CMAX = 0.2;
const oklchRgb = (l, C, h) => labRgb(lchLab([l, C, h]));
function wheelControl(el) {
  const cv = el.querySelector("canvas"), size = el.getBoundingClientRect().width || 220;
  const S = Math.round(size * Math.min(2, window.devicePixelRatio || 1));
  cv.width = S; cv.height = S;
  const ctx = cv.getContext("2d"), img = ctx.createImageData(S, S), d = img.data, R = S / 2;
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const dx = x + .5 - R, dy = R - y - .5, r = Math.hypot(dx, dy) / R, i = (y * S + x) * 4;
    if (r > 1) continue;
    const [rr, gg, bb] = oklchRgb(.63, r * CMAX, (Math.atan2(dy, dx) * 180 / Math.PI + 360) % 360);
    d[i] = rr; d[i + 1] = gg; d[i + 2] = bb; d[i + 3] = r > .985 ? Math.round(255 * (1 - r) / .015) : 255;
  }
  ctx.putImageData(img, 0, 0);
  let active = "a", drag = false;
  const at = e => {
    const r = el.getBoundingClientRect(), R = r.width / 2;
    let dx = e.clientX - r.left - R, dy = R - (e.clientY - r.top), rad = Math.hypot(dx, dy) / R;
    if (rad > 1) rad = 1;
    return { h: +((Math.atan2(dy, dx) * 180 / Math.PI + 360) % 360).toFixed(1), c: +(rad * CMAX).toFixed(3) };
  };
  const dist = (p, x) => { const k = Math.PI / 180; return Math.hypot(p.c * Math.cos(p.h * k) - x.c * Math.cos(x.h * k), p.c * Math.sin(p.h * k) - x.c * Math.sin(x.h * k)); };
  const set = v => { theme()[active] = v; applyTheme(); paintLook(); };
  el.addEventListener("pointerdown", e => {
    e.preventDefault(); drag = true; try { el.setPointerCapture(e.pointerId); } catch (x) {}
    const v = at(e), t = theme();
    active = t.mode === "gradient" && dist(v, t.b) < dist(v, t.a) ? "b" : "a";
    set(v);
  });
  el.addEventListener("pointermove", e => { if (drag) set(at(e)); });
  const end = () => { if (!drag) return; drag = false; saveTheme(); haptic("tick"); };
  el.addEventListener("pointerup", end); el.addEventListener("pointercancel", end);
  paintLook();
}
function paintLook() {
  const t = theme(), el = $("#wheel"); if (!el) return;
  const sun = t.mode === "sun";
  el.hidden = sun; $("#sunday").hidden = !sun; $("#o-place").hidden = !sun || !!L.placeOk;
  if (sun) {
    const mh = $("#mh");
    mh.querySelector(".t").style.background = "linear-gradient(to bottom, var(--s0), var(--s1), var(--s2))";
    mh.querySelector(".b").style.background = "linear-gradient(to bottom, var(--s3), var(--s4), var(--s5))";
    return paintSun();
  }
  const R = el.getBoundingClientRect().width / 2;
  for (const k of ["a", "b"]) {
    const h = el.querySelector(`.hd[data-k="${k}"]`), x = t[k], r = Math.min(1, x.c / CMAX) * R, ang = x.h * Math.PI / 180;
    h.hidden = k === "b" && t.mode !== "gradient";
    h.style.left = (R + r * Math.cos(ang)).toFixed(1) + "px"; h.style.top = (R - r * Math.sin(ang)).toFixed(1) + "px";
    h.style.background = okl(.63, x);
  }
  const [top, bottom] = boxColors(t), mh = $("#mh");
  mh.querySelector(".t").style.background = top; mh.querySelector(".b").style.background = bottom;
  const word = x => `hue ${Math.round(x.h)}°, strength ${Math.round(100 * x.c / CMAX)}%`;
  $("#o-look").textContent = t.mode === "gradient" ? `1: ${word(t.a)} · 2: ${word(t.b)}` : word(t.a);
}
// Settings, Sun: today's sky where you are, hour by hour, with a mark for now; when the sun rises and sets; what the
// sky is doing now.
let sunDayKey = "";
function paintSun() {
  const box = $("#sunday"); if (!box || box.hidden) return;
  const p = where(), d0 = new Date(Date.now()); d0.setHours(0, 0, 0, 0);
  const d1 = new Date(d0); d1.setDate(d1.getDate() + 1);
  const t0 = +d0, span = d1 - d0, cv = box.querySelector("canvas");
  const key = [t0, p.lat.toFixed(2), p.lon.toFixed(2), cv.clientWidth].join(" ");
  if (key !== sunDayKey && cv.clientWidth) {
    sunDayKey = key;
    const dpr = Math.min(2, window.devicePixelRatio || 1), W = Math.round(cv.clientWidth * dpr), H = Math.round(cv.clientHeight * dpr);
    cv.width = W; cv.height = H;
    const ctx = cv.getContext("2d"), img = ctx.createImageData(W, H), px = img.data, ev = [];
    for (let y = 0; y < H; y++) ev.push(skyEase(y / Math.max(1, H - 1)));
    for (let x = 0; x < W; x++) {
      const s = skyAt(t0 + (x + .5) / W * span, p);
      for (let y = 0; y < H; y++) { const c = labRgb(labMix(s.z, s.h, ev[y])), i = (y * W + x) * 4; px[i] = c[0]; px[i + 1] = c[1]; px[i + 2] = c[2]; px[i + 3] = 255; }
    }
    ctx.putImageData(img, 0, 0);
    box.querySelectorAll(".ticks span").forEach((sp, i) => { sp.textContent = new Date(2000, 0, 1, (i * 6) % 24).toLocaleTimeString([], { hour: "numeric" }); });
  }
  box.querySelector(".now").style.left = (100 * (Date.now() - t0) / span).toFixed(2) + "%";
  const { rise, set } = sunTimes(p, t0, span), now = skyAt(Date.now(), p), about = L.place ? "" : "about ";
  const hm = t => new Date(t).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  const day = rise != null && set != null ? `Sunrise ${about}${hm(rise)}, sunset ${about}${hm(set)}`
    : rise != null ? `Sunrise ${about}${hm(rise)}` : set != null ? `Sunset ${about}${hm(set)}`
    : now.el > 0 ? "The sun doesn't set today" : "The sun doesn't rise today";
  const from = L.place ? " where you are" : !L.placeOk ? ", from your time zone until you allow location"
    : !L.placeOn ? ", from your time zone until location is on in Android" : ", from your time zone while the phone finds where it is";
  $("#o-look").textContent = `${day}${from}. Now: ${skyPhase(now)}.`;
}
// Today's sunrise and sunset: when the sun's top edge crosses the horizon (-0.833°), to the minute.
function sunTimes(p, t0, span) {
  let rise = null, set = null, prev = sunPos(t0, p.lat, p.lon).el + .833;
  for (let m = 2; m * 60000 <= span; m += 2) {
    const u = t0 + m * 60000, e = sunPos(u, p.lat, p.lon).el + .833, at = u - 120000 * e / (e - prev);
    if (prev < 0 && e >= 0 && rise == null) rise = at;
    else if (prev >= 0 && e < 0) set = at;
    prev = e;
  }
  return { rise, set };
}

// ---- search ----------------------------------------------------------------------------------------------
const matchApp = (a, q) => (a.label + " " + a.pkg + " " + a.category).toLowerCase().includes(q);
const byUse = (x, y) => (lastUse(y) - lastUse(x)) || x.label.localeCompare(y.label);
let findT = 0, findSeq = 0;
function onSearch() {
  L.q = $("#q").value;
  if (L.screen === "apps") { if (L.view === "treemap") applySearch(); else renderApps(); return; }
  const q = L.q.trim().toLowerCase();
  clearTimeout(findT);
  suggest(L.q); findContacts(L.q);
  if (!q) { hideResults(); return; }
  const apps = L.apps.filter(a => matchApp(a, q)).sort(byUse).slice(0, 12);
  showResults(apps, q.length >= 3 ? null : []);
  if (q.length >= 3) {
    const my = ++findSeq;
    findT = setTimeout(async () => {
      try { const r = await server("/api/find?" + new URLSearchParams({ q: L.q.trim() })); if (my === findSeq) showResults(apps, r.results || []); }
      catch (e) { if (my === findSeq) showResults(apps, [], e.message); }
    }, 300);
  }
}
let lastRes = null;
function showResults(apps, files, err) {
  const R = $("#results"), top = $("#frame").getBoundingClientRect().bottom;
  lastRes = [apps, files, err];
  R.style.top = top + "px"; R.hidden = false;
  R.innerHTML = `<h3>Apps</h3>` + (apps.length ? apps.map((a, i) => `<button type="button" class="r" data-a="${i}"><span class="t">${esc(a.label)}<small>${esc(a.category)} · ${esc(a.state)}</small></span><span class="num"></span></button>`).join("") : `<p class="none">No app matches.</p>`)
    + contactsHtml()
    + `<h3>Files</h3>` + (files === null ? `<p class="none">Searching Atlas</p>` : err ? `<p class="none">${esc(err === "not signed in" ? "Sign in to Atlas to search files." : "Can't reach Atlas right now.")}</p>`
      : files.length ? files.slice(0, 40).map((f, i) => `<button type="button" class="r" data-f="${i}"><span class="t">${esc(f.name)}<small>${esc(dirName(f.path))}</small></span><span class="num">${fmtSize(f.size || 0)}</span></button>`).join("")
      : `<p class="none">${L.q.trim().length < 3 ? "Type three letters to search file names." : "No file matches."}</p>`)
    + `<div id="web"></div>`;
  R.querySelectorAll("[data-a]").forEach(b => { const a = apps[+b.dataset.a]; pressable(b, () => { launch(a, b); }, () => appSheet(a)); });
  R.querySelectorAll("[data-f]").forEach(b => { const f = files[+b.dataset.f]; pressable(b, () => openFile(f.path, false), () => fileSheet(f)); });
  wireContacts(R);
  paintWeb();
}
function hideResults() { const R = $("#results"); R.hidden = true; R.innerHTML = ""; lastRes = null; }
function clearSearch() { $("#q").value = ""; L.q = ""; cts = null; hideResults(); if (L.screen === "apps") { if (L.view === "treemap") applySearch(); else renderApps(); } }

// Contacts, between Apps and Files: the people whose names match, each with the apps that can reach them listed under
// the name, read from the phone and never sent anywhere. An app that does one thing does it at a tap (Phone calls,
// Messages starts a text, Email a mail); an app that can chat and call (WhatsApp, Signal, Telegram) lists Message, Call
// and Video call under it at a tap, and holding it calls. The name opens the contact. Android asks once to allow it.
// When what you type matches a contact, Google's suggestions are left out: the contact takes their place and the name
// doesn't go to Google. The one Search Google row, under Google at the end, still searches it when you tap it.
let cts = null, ctsSeq = 0, ctsT = 0, cOpen = null, ctsQ = "", ctsP = Promise.resolve(null);
function findContacts(text) {
  clearTimeout(ctsT); const my = ++ctsSeq, q = (text || "").trim();
  ctsQ = q;
  if (!q) { cts = null; ctsP = Promise.resolve(null); return; }
  ctsP = new Promise(done => {
    ctsT = setTimeout(async () => {
      let r = null;
      try { r = await native("contacts.search", { q }); } catch (e) { /* no contacts: the rest of the results stand */ }
      done(r);
      if (my !== ctsSeq || !r) return;
      cts = r; cOpen = null; if (lastRes && !$("#results").hidden) showResults(...lastRes);
    }, 60);
  });
}
const isContact = r => !!(r && r.allowed && (r.contacts || []).length);
function contactsHtml() {
  if (!cts) return "";
  if (!cts.allowed) return `<h3>Contacts</h3><button type="button" class="r" id="c-allow"><span class="t">Find contacts here too<small>Allow Atlas to read your contacts. They stay on the phone.</small></span><span class="num"></span></button>`;
  const list = cts.contacts || []; if (!list.length) return "";
  const row = (cls, data, text, sub, mark) => `<button type="button" class="r ${cls}" ${data}><span class="t">${esc(text)}${sub ? `<small>${esc(sub)}</small>` : ""}</span><span class="num">${mark || ""}</span></button>`;
  return `<h3>Contacts</h3>` + list.map((c, i) => row("", `data-cn="${i}"`, c.name, c.sub)
    + c.apps.map((a, j) => {
      const open = cOpen === i + "/" + j, many = a.opts.length > 1;
      return row("in1", `data-ci="${i}" data-cj="${j}"`, a.name, "", many ? (open ? "−" : "+") : "")
        + (open ? a.opts.map((o, k) => row("in2", `data-ci="${i}" data-cj="${j}" data-ck="${k}"`, o.label)).join("") : "");
    }).join("")).join("");
}
function wireContacts(R) {
  const go = act => { if (!act) return; $("#q").blur(); fire("contacts.open", act); };
  const again = () => { const st = R.scrollTop; showResults(...lastRes); R.scrollTop = st; };
  const allow = R.querySelector("#c-allow"); if (allow) allow.onclick = () => fire("contacts.allow");
  R.querySelectorAll("[data-cn]").forEach(b => { const c = cts.contacts[+b.dataset.cn]; b.onclick = () => go({ kind: "card", id: c.id, key: c.key }); });
  R.querySelectorAll("[data-ci]").forEach(b => {
    const at = b.dataset.ci + "/" + b.dataset.cj, a = cts.contacts[+b.dataset.ci].apps[+b.dataset.cj];
    if (b.dataset.ck !== undefined) { b.onclick = () => go(a.opts[+b.dataset.ck].act); return; }       // Message, Call, Video call
    const call = (a.opts.find(o => o.k === "voice") || a.opts[0]).act;
    pressable(b, () => { if (a.opts.length === 1) return go(a.opts[0].act); cOpen = cOpen === at ? null : at; again(); }, () => go(call));
  });
}

// Google, from the same bar: under the results a row searches Google for what you typed, with Google's own
// suggestions below it as you type (what you type goes to Google for them, unless it matches a contact); Enter searches
// Google when no app matches. The results open in the browser.
let sugT = 0, sugSeq = 0, sugs = [];
function webSearch(q) { q = (q || "").trim(); if (!q) return; $("#q").blur(); fire("web.search", { q }); }
function suggest(text) {
  clearTimeout(sugT); const my = ++sugSeq, q = (text || "").trim();
  if (q.length < 2) { sugs = []; return; }
  sugT = setTimeout(async () => {
    try {
      const c = q === ctsQ ? await ctsP : null;
      if (my !== sugSeq) return;
      if (isContact(c)) { sugs = []; paintWeb(); return; }               // a contact's name doesn't go to Google
      const r = await native("web.suggest", { q });
      if (my !== sugSeq) return;
      sugs = (Array.isArray(r) ? r : []).filter(x => x && x.toLowerCase() !== q.toLowerCase()).slice(0, 5); paintWeb();
    } catch (e) { /* no suggestions: the search row is still there */ }
  }, 200);
}
function paintWeb() {
  const box = $("#web"), q = L.q.trim(); if (!box) return;
  if (!q) { box.innerHTML = ""; return; }
  box.innerHTML = `<h3>Google</h3><button type="button" class="r" data-g=""><span class="t">Search Google for “${esc(q)}”</span><span class="num"></span></button>`
    + sugs.map((x, i) => `<button type="button" class="r" data-g="${i}"><span class="t">${esc(x)}</span><span class="num"></span></button>`).join("");
  box.querySelectorAll("[data-g]").forEach(b => { b.onclick = () => webSearch(b.dataset.g === "" ? q : sugs[+b.dataset.g]); });
}

$("#q").addEventListener("input", onSearch);
$("#q").addEventListener("keydown", e => {
  if (e.key !== "Enter") return;
  const q = L.q.trim().toLowerCase(); if (!q) return;
  const first = L.apps.filter(a => matchApp(a, q)).sort(byUse)[0];
  if (first) { $("#q").blur(); launch(first); }
  else webSearch(L.q);
});

// ---- the Apps map: Treemap, Tree and List, drawn the way Atlas draws folders ---------------------------------
// Area grows with the square root of use, so the apps you live in are big and the rest stay big enough to tap.
function val(a) {
  if (L.metric === "eq") return 1;
  if (L.metric === "opens") return Math.sqrt(L.usage ? (a.opens30 || 0) : (a.launches30 || 0));
  return Math.sqrt(L.usage ? (a.fg30 || 0) / 60000 : (a.launches30 || 0));
}
function age(a) {
  const t = lastUse(a) || (L.usage ? 0 : a.updated);
  if (!t) return 1;
  const d = (Date.now() - t) / DAY;
  return d <= 30 ? 4 : d <= 365 ? 3 : d <= 730 ? 2 : 1;
}
function metricText(a) {
  if (L.metric === "eq") return "";
  if (L.metric === "opens") { const n = L.usage ? a.opens30 : a.launches30; return n ? fmtN(n) + (n === 1 ? " open" : " opens") : ""; }
  return L.usage ? (a.fg30 >= 60000 ? fmtDur(a.fg30) : "") : (a.launches30 ? fmtN(a.launches30) + " opens" : "");
}

function squarify(vals, x, y, w, h) {
  const out = new Array(vals.length); const total = vals.reduce((a, b) => a + b, 0);
  if (total <= 0 || w <= 0 || h <= 0) return vals.map(() => ({ x, y, w: 0, h: 0 }));
  const sc = (w * h) / total, A = vals.map(v => v * sc);
  let i = 0, row = [];
  const worst = (r, side) => { const s = r.reduce((a, b) => a + b, 0), mx = Math.max(...r), mn = Math.min(...r); return Math.max(side * side * mx / (s * s), (s * s) / (side * side * mn)); };
  const place = () => {
    const s = row.reduce((a, b) => a + A[b], 0);
    if (w >= h) { const cw = s / h; let yy = y; for (const k of row) { const hh = A[k] / cw; out[k] = { x, y: yy, w: cw, h: hh }; yy += hh; } x += cw; w -= cw; }
    else { const rh = s / w; let xx = x; for (const k of row) { const ww = A[k] / rh; out[k] = { x: xx, y, w: ww, h: rh }; xx += ww; } y += rh; h -= rh; }
    row = [];
  };
  while (i < A.length) {
    const side = Math.min(w, h), cur = row.map(k => A[k]);
    if (!row.length || worst(cur.concat(A[i]), side) <= worst(cur, side)) { row.push(i); i++; } else place();
  }
  if (row.length) place();
  return out;
}

function hierarchy() {
  const as = L.apps, raw = as.map(val), total = raw.reduce((a, b) => a + b, 0);
  const floor = L.metric === "eq" ? 0 : (total > 0 ? total : as.length) / Math.max(1, as.length * 4);
  const states = [];
  for (const st of L.states) {
    const cats = {};
    as.forEach((a, i) => { if (a.state === st) (cats[a.category] ||= []).push({ leaf: true, a, v: Math.max(raw[i], floor, 1e-9) }); });
    const kids = Object.entries(cats).map(([c, list]) => ({ type: "cat", label: c, path: [st, c], kids: list, v: sum(list), n: list.length }));
    if (kids.length) states.push({ type: "state", label: st, path: [st], kids, v: sum(kids), n: sum(kids, k => k.n) });
  }
  let root = { type: "root", kids: states };
  if (L.zoom.length >= 1) root = states.find(s => s.label === L.zoom[0]) || root;
  if (L.zoom.length === 2 && root.kids) root = root.kids.find(c => c.label === L.zoom[1]) || root;
  return root;
}

const MZ = { k: 1, x: 0, y: 0 };
function resetMZ() { MZ.k = 1; MZ.x = 0; MZ.y = 0; }
function renderApps() {
  const map = $("#map");
  map.classList.toggle("scroll", L.view === "list");
  map.classList.toggle("zoomable", L.view === "tree");
  $("#crumbs").hidden = L.view !== "treemap";
  if (!L.apps.length) { map.innerHTML = `<div class="banner">Reading the apps on this phone.</div>`; return; }
  if (L.view === "treemap") renderTreemap();
  else { map.innerHTML = ""; (L.view === "tree" ? renderTree : renderList)(); }
}
let TH = 1;                                                            // the treemap's full height, for a gradient
function renderTreemap() {
  const map = $("#map"); map.innerHTML = "";
  const W = map.clientWidth, H = map.clientHeight;
  TH = Math.max(1, H * Math.min(30, Math.max(1, MZ.k)));
  MZ.k = Math.min(30, Math.max(1, MZ.k));
  MZ.x = Math.min(0, Math.max(W - W * MZ.k, MZ.x)); MZ.y = Math.min(0, Math.max(H - H * MZ.k, MZ.y));
  const box = document.createElement("div"); box.className = "tmz";
  Object.assign(box.style, { width: W * MZ.k + "px", height: H * MZ.k + "px", transform: `translate(${MZ.x}px,${MZ.y}px)` });
  map.appendChild(box);
  const V = { x0: -MZ.x - W, y0: -MZ.y - H, x1: -MZ.x + 2 * W, y1: -MZ.y + 2 * H };
  const off = (x, y, w, h) => x + w < V.x0 || y + h < V.y0 || x > V.x1 || y > V.y1;
  const draw = (node, x, y, w, h) => {
    if (off(x, y, w, h)) return;
    if (node.leaf) return appTile(box, node.a, x, y, w, h);
    let top = 0, pad = 0;
    if (node.type === "state") top = 28;
    if (node.type === "cat") { pad = w > 12 && h > 12 ? 3 : 0; top = (w >= 80 && h >= 46) ? 18 : 0; }
    if (node.type !== "root") {
      const r = document.createElement("div"); r.className = "region " + node.type;
      r.dataset.drop = node.type; r.dataset.state = node.path[0]; if (node.type === "cat") r.dataset.cat = node.label;
      Object.assign(r.style, { left: x + "px", top: y + "px", width: w + "px", height: h + "px" });
      if (top) {
        const hb = document.createElement("button"); hb.type = "button"; hb.className = "h";
        hb.innerHTML = node.type === "state" ? `${esc(node.label)}<small>${node.n} apps</small>` : esc(node.label);
        hb.onclick = () => { L.zoom = node.path; resetMZ(); renderApps(); crumbs(); };
        r.appendChild(hb);
      }
      box.appendChild(r);
    }
    const kids = [...node.kids].sort((a, b) => b.v - a.v);
    const inner = { x: x + pad, y: y + top + pad, w: w - 2 * pad, h: h - top - 2 * pad };
    const gap = node.type === "root" ? 10 : node.type === "state" ? 4 : 0;
    const rects = squarify(kids.map(k => k.v), inner.x, inner.y, inner.w, inner.h);
    kids.forEach((k, i) => { const q = rects[i]; draw(k, q.x + gap / 2, q.y + gap / 2, Math.max(0, q.w - gap), Math.max(0, q.h - gap)); });
  };
  draw(hierarchy(), 0, 0, W * MZ.k, H * MZ.k);
  applySearch();
  treemapZoom(map, box, W, H);
}
function appTile(box, a, x, y, w, h) {
  if (w < 1 || h < 1) return;
  const t = document.createElement("button"); t.type = "button"; t.dataset.k = a.key;
  const named = w >= 54 && h >= 24;
  t.className = "tile a" + age(a) + (named ? "" : " nolab");
  const g = w < 10 || h < 10 ? 0.5 : 1;
  Object.assign(t.style, { left: (x + g) + "px", top: (y + g) + "px", width: Math.max(0, w - 2 * g) + "px", height: Math.max(0, h - 2 * g) + "px" });
  t.setAttribute("aria-label", `${a.label}, ${a.state}, ${a.category}`);
  tint(t, (y + h / 2) / TH);
  const m = metricText(a);
  if (named) t.innerHTML = `<span class="n">${esc(a.label)}</span>` + (m && h >= 40 ? `<span class="v">${esc(m)}</span>` : "");
  grab(t, a, () => launch(a, t));
  box.appendChild(t);
}
function treemapZoom(map, box, W, H) {
  const MAX = 30, T = { k: MZ.k, x: MZ.x, y: MZ.y };
  const clamp = () => {
    T.k = Math.min(MAX, Math.max(1, T.k));
    T.x = Math.min(0, Math.max(W - W * T.k, T.x)); T.y = Math.min(0, Math.max(H - H * T.k, T.y));
    box.style.transform = `translate(${T.x}px,${T.y}px) scale(${T.k / MZ.k})`;
  };
  let timer = 0;
  const commit = later => {
    clearTimeout(timer);
    const go = () => { if (T.k !== MZ.k || T.x !== MZ.x || T.y !== MZ.y) { Object.assign(MZ, T); renderTreemap(); } };
    if (later) timer = setTimeout(go, 160); else go();
  };
  const zoomAt = (k, cx, cy) => { k = Math.min(MAX, Math.max(1, k)); T.x = cx - (cx - T.x) * k / T.k; T.y = cy - (cy - T.y) * k / T.k; T.k = k; clamp(); };
  const at = e => { const r = map.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
  const pts = new Map(); let pinch = null, moved = 0;
  const pinchStart = () => { const [a, b] = [...pts.values()]; return { d: Math.hypot(a[0] - b[0], a[1] - b[1]), mid: [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2], k: T.k, x: T.x, y: T.y }; };
  box.addEventListener("pointerdown", e => { pts.set(e.pointerId, at(e)); if (pts.size === 1) moved = 0; pinch = pts.size === 2 ? pinchStart() : null; clearTimeout(timer); });
  box.addEventListener("pointermove", e => {
    if (!pts.has(e.pointerId) || drag) return;                           // an app being dragged doesn't move the map
    const p0 = pts.get(e.pointerId), p1 = at(e); pts.set(e.pointerId, p1);
    if (pts.size === 1) { moved += Math.abs(p1[0] - p0[0]) + Math.abs(p1[1] - p0[1]); if (moved > 8) { T.x += p1[0] - p0[0]; T.y += p1[1] - p0[1]; clamp(); } return; }
    const [a, b] = [...pts.values()], d = Math.hypot(a[0] - b[0], a[1] - b[1]);
    // Two fingers move the map as they pinch: what was under them when they touched stays under them.
    const mid = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    if (!pinch) pinch = pinchStart();
    else { T.k = pinch.k; T.x = pinch.x + mid[0] - pinch.mid[0]; T.y = pinch.y + mid[1] - pinch.mid[1]; zoomAt(pinch.k * d / pinch.d, mid[0], mid[1]); }
    moved = 99;
  });
  const up = e => { if (!pts.delete(e.pointerId)) return; pinch = null; if (!pts.size && moved > 8) commit(true); };
  ["pointerup", "pointercancel"].forEach(n => box.addEventListener(n, up));
  box.addEventListener("click", e => { if (moved > 8) { e.stopPropagation(); e.preventDefault(); } }, true);
  box.addEventListener("wheel", e => { e.preventDefault(); const [cx, cy] = at(e); zoomAt(T.k * Math.exp(-e.deltaY * 0.0015), cx, cy); commit(true); }, { passive: false });
  const z = document.createElement("div"); z.className = "tzbar";
  z.innerHTML = `<button type="button" data-z="in" aria-label="Zoom in">+</button><button type="button" data-z="out" aria-label="Zoom out">−</button>` + (MZ.k > 1 ? `<button type="button" data-z="fit">All</button>` : "");
  z.onclick = e => { const b = e.target.closest("button"); if (!b) return;
    if (b.dataset.z === "fit") { T.k = 1; T.x = 0; T.y = 0; clamp(); } else zoomAt(T.k * (b.dataset.z === "in" ? 1.6 : 1 / 1.6), W / 2, H / 2);
    commit(false); };
  map.appendChild(z);
}
function applySearch() {
  const q = L.q.trim().toLowerCase();
  $$("#map .tile").forEach(t => { const a = L.byKey[t.dataset.k]; t.classList.toggle("dim", !!q && !(a && matchApp(a, q))); });
}
function crumbs() {
  const c = $("#crumbs"); c.innerHTML = "";
  const b = (label, z) => { const x = document.createElement("button"); x.type = "button"; x.textContent = label; x.onclick = () => { L.zoom = z; resetMZ(); renderApps(); crumbs(); }; return x; };
  c.appendChild(b("Everything", []));
  L.zoom.forEach((p, i) => { const s = document.createElement("span"); s.textContent = "›"; c.appendChild(s); c.appendChild(b(p, L.zoom.slice(0, i + 1))); });
}

// Tree and List: the same apps as the treemap, as a branching tree and as an indented list.
function model() {
  const q = L.q.trim().toLowerCase();
  const root = { key: "Apps", label: "Apps", type: "root", kids: [] };
  for (const st of L.states) {
    const sn = { key: st, label: st, type: "state", kids: [] }, cats = {};
    for (const a of L.apps) if (a.state === st && (!q || matchApp(a, q))) (cats[a.category] ||= []).push(a);
    for (const [c, list] of Object.entries(cats))
      sn.kids.push({ key: st + "/" + c, label: c, type: "cat", kids: list.map(a => ({ key: a.key, label: a.label, type: "app", a, kids: [], match: !!q })) });
    if (sn.kids.length) root.kids.push(sn);
  }
  const agg = n => {
    n.kids.forEach(agg);
    n.v = n.a ? val(n.a) : sum(n.kids);
    n.n = n.a ? 1 : sum(n.kids, k => k.n);
    if (n.type !== "root") n.kids.sort((x, y) => y.v - x.v || x.label.localeCompare(y.label));
  };
  agg(root);
  return { root, isOpen: n => !!q || L.open.has(n.key) };
}
function toggleNode(n) { if (L.open.has(n.key)) L.open.delete(n.key); else L.open.add(n.key); renderApps(); }
function renderTree() {
  const map = $("#map"), { root, isOpen } = model();
  const RH = 30, CW = 170, LX = 22, R = 7, max = 22;
  let row = 0, maxd = 0;
  const lay = (n, d) => {
    n.d = d; maxd = Math.max(maxd, d); n.open = n.kids.length > 0 && isOpen(n);
    if (n.open) { n.kids.forEach(k => lay(k, d + 1)); n.y = (n.kids[0].y + n.kids[n.kids.length - 1].y) / 2; }
    else n.y = row++ * RH + RH / 2 + 6;
  };
  lay(root, 0);
  const ns = "http://www.w3.org/2000/svg", X = n => LX + n.d * CW;
  const svg = document.createElementNS(ns, "svg");
  svg.setAttribute("width", "100%"); svg.setAttribute("height", "100%"); svg.setAttribute("class", "treesvg");
  const zg = document.createElementNS(ns, "g"), lg = document.createElementNS(ns, "g"), ng = document.createElementNS(ns, "g");
  zg.append(lg, ng); svg.append(zg);
  const draw = n => {
    if (n.open) for (const k of n.kids) {
      const p = document.createElementNS(ns, "path"), x1 = X(n) + R, x2 = X(k) - R, mx = (x1 + x2) / 2;
      p.setAttribute("d", `M${x1},${n.y} C${mx},${n.y} ${mx},${k.y} ${x2},${k.y}`); p.setAttribute("class", "link"); lg.appendChild(p); draw(k);
    }
    const leaf = n.type === "app", closed = n.kids.length > 0 && !n.open;
    const g = document.createElementNS(ns, "g");
    g.setAttribute("class", "node " + n.type + (leaf && n.match ? " hit" : "")); g.setAttribute("transform", `translate(${X(n)},${n.y})`);
    if (leaf) g.setAttribute("data-k", n.a.key);
    else if (n.type !== "root") { g.setAttribute("data-drop", n.type); g.setAttribute("data-state", n.type === "state" ? n.label : n.key.split("/")[0]); if (n.type === "cat") g.setAttribute("data-cat", n.label); }
    const c = document.createElementNS(ns, "circle"); c.setAttribute("r", leaf ? 5.5 : R);
    c.setAttribute("class", (leaf ? "a" + age(n.a) : "g") + (closed ? " closed" : ""));
    tint(c, n.y / Math.max(1, row * RH));
    const t = document.createElementNS(ns, "text"); t.setAttribute("x", 12); t.setAttribute("dy", "0.35em");
    const lab = n.label.length > max ? n.label.slice(0, max - 1) + "…" : n.label;
    const num = leaf ? metricText(n.a) : n.n + " apps";
    t.innerHTML = `${esc(lab)}<tspan class="m" dx="8">${esc(num)}</tspan>`;
    g.append(c, t);
    if (leaf) grab(g, n.a, () => launch(n.a)); else g.addEventListener("click", () => toggleNode(n));
    ng.appendChild(g);
  };
  draw(root);
  map.appendChild(svg);
  treeZoom(svg, zg, LX + maxd * CW + 220, row * RH + 16);
}
function treeZoom(svg, g, W0, H0) {
  g.removeAttribute("transform");
  const bb = g.getBBox(); W0 = Math.max(W0, bb.x + bb.width + 16); H0 = Math.max(H0, bb.y + bb.height + 8);
  const map = $("#map"), vw = map.clientWidth, vh = map.clientHeight, fit = Math.min(vw / W0, vh / H0, 1), MAX = 3;
  const T = L.tz || (L.tz = { k: Math.max(fit, Math.min(1, vh / H0 > .55 ? 1 : fit)), x: 0, y: 0 });
  const clamp = () => {
    T.k = Math.min(MAX, Math.max(fit, T.k));
    const w = W0 * T.k, h = H0 * T.k;
    // Smaller than the screen, the tree can sit anywhere on it; bigger, it moves until its edges reach the screen's.
    T.x = Math.min(Math.max(0, vw - w), Math.max(Math.min(0, vw - w), T.x)); T.y = Math.min(Math.max(0, vh - h), Math.max(Math.min(0, vh - h), T.y));
    g.setAttribute("transform", `translate(${T.x},${T.y}) scale(${T.k})`);
  };
  const zoomAt = (k, cx, cy) => { k = Math.min(MAX, Math.max(fit, k)); T.x = cx - (cx - T.x) * k / T.k; T.y = cy - (cy - T.y) * k / T.k; T.k = k; clamp(); };
  clamp();
  L.treePan = (dx, dy) => { T.x += dx; T.y += dy; clamp(); };
  const pts = new Map(); let pinch = null, moved = 0;
  const at = e => { const r = svg.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
  const pinchStart = () => { const [a, b] = [...pts.values()]; return { d: Math.hypot(a[0] - b[0], a[1] - b[1]), mid: [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2], k: T.k, x: T.x, y: T.y }; };
  svg.addEventListener("pointerdown", e => { pts.set(e.pointerId, at(e)); if (pts.size === 1) moved = 0; pinch = pts.size === 2 ? pinchStart() : null; });
  svg.addEventListener("pointermove", e => {
    if (!pts.has(e.pointerId) || drag) return;
    const p0 = pts.get(e.pointerId), p1 = at(e); pts.set(e.pointerId, p1);
    if (pts.size === 1) { T.x += p1[0] - p0[0]; T.y += p1[1] - p0[1]; moved += Math.abs(p1[0] - p0[0]) + Math.abs(p1[1] - p0[1]); clamp(); return; }
    const [a, b] = [...pts.values()], d = Math.hypot(a[0] - b[0], a[1] - b[1]);
    // Two fingers move the map as they pinch: what was under them when they touched stays under them.
    const mid = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    if (!pinch) pinch = pinchStart();
    else { T.k = pinch.k; T.x = pinch.x + mid[0] - pinch.mid[0]; T.y = pinch.y + mid[1] - pinch.mid[1]; zoomAt(pinch.k * d / pinch.d, mid[0], mid[1]); }
    moved = 99;
  });
  const up = e => { pts.delete(e.pointerId); pinch = null; };
  ["pointerup", "pointercancel", "pointerleave"].forEach(n => svg.addEventListener(n, up));
  svg.addEventListener("click", e => { if (moved > 8) { e.stopPropagation(); e.preventDefault(); } }, true);
  svg.addEventListener("wheel", e => { e.preventDefault(); const [cx, cy] = at(e); zoomAt(T.k * Math.exp(-e.deltaY * 0.0015), cx, cy); }, { passive: false });
  const z = document.createElement("div"); z.className = "tzbar";
  z.innerHTML = `<button type="button" data-z="in" aria-label="Zoom in">+</button><button type="button" data-z="out" aria-label="Zoom out">−</button><button type="button" data-z="fit">All</button>`;
  z.onclick = e => { const b = e.target.closest("button"); if (!b) return;
    if (b.dataset.z === "fit") { T.k = fit; T.x = 0; T.y = 0; clamp(); } else zoomAt(T.k * (b.dataset.z === "in" ? 1.4 : 1 / 1.4), vw / 2, vh / 2); };
  map.appendChild(z);
}
function renderList() {
  const map = $("#map"), { root, isOpen } = model();
  const box = document.createElement("div"); box.className = "list";
  box.innerHTML = `<div class="lrow lhead"><span>Name</span><span class="num">${L.metric === "opens" ? "Opens" : "Use"}</span><span class="num">Used</span></div>`;
  const walk = (n, d) => {
    for (const k of n.kids) {
      const leaf = k.type === "app", open = k.kids.length > 0 && isOpen(k);
      if (k.type === "cat") { box.appendChild(catRow(k.label, fmtN(k.n), d, open ? "▾" : "▸", k.key.split("/")[0], () => toggleNode(k))); if (open) walk(k, d + 1); continue; }
      const r = document.createElement("button"); r.type = "button";
      r.className = "lrow" + (k.type === "state" ? " g1" : "") + (leaf && k.match ? " hit" : "");
      r.innerHTML = `<span class="nm" style="padding-left:${d * 16}px"><span class="car">${k.kids.length ? (open ? "▾" : "▸") : ""}</span><span class="t">${esc(k.label)}</span></span>`
        + `<span class="num">${leaf ? esc(metricText(k.a)) : fmtN(k.n)}</span><span class="num">${leaf && lastUse(k.a) ? esc(ago(lastUse(k.a))) : ""}</span>`;
      if (leaf) { r.dataset.k = k.a.key; grab(r, k.a, () => launch(k.a, r)); }
      else { r.dataset.drop = "state"; r.dataset.state = k.label; r.onclick = () => toggleNode(k); }
      box.appendChild(r);
      if (open) walk(k, d + 1);
    }
  };
  walk(root, 0);
  if (!L.q.trim()) {                                                     // the categories with no apps yet, and +
    const used = new Set(L.apps.map(a => a.category)), empty = L.cats.filter(c => !used.has(c) && !isUnsorted(c));
    if (empty.length) {
      const h = document.createElement("div"); h.className = "lrow lhead"; h.innerHTML = `<span>No apps yet</span><span></span><span></span>`; box.appendChild(h);
      for (const c of empty) box.appendChild(catRow(c, "0", 0, "", "", null));
    }
    const add = document.createElement("button"); add.type = "button"; add.className = "lrow addcat";
    add.innerHTML = `<span class="nm"><span class="plus" aria-hidden="true">+</span><span class="t">Add a category</span></span><span></span><span></span>`;
    add.onclick = addCategorySheet; box.appendChild(add);
  }
  map.appendChild(box);
}
// A category in the List view: a place to drop an app, with − beside it to take the category out (tap twice).
function catRow(label, count, d, car, state, onOpen) {
  const r = document.createElement("div"); r.className = "lrow g2"; r.setAttribute("role", "button"); r.tabIndex = 0;
  r.dataset.drop = "cat"; r.dataset.cat = label; if (state) r.dataset.state = state;
  r.innerHTML = `<span class="nm" style="padding-left:${d * 16}px"><span class="car">${car}</span><span class="t">${esc(label)}</span></span><span class="num">${count}</span>`
    + (isUnsorted(label) ? `<span></span>` : `<button type="button" class="catdel" aria-label="Take out ${esc(label)}">−</button>`);
  if (onOpen) { r.onclick = e => { if (!e.target.closest(".catdel")) onOpen(); }; r.onkeydown = e => { if (e.key === "Enter") onOpen(); }; }
  const del = r.querySelector(".catdel");
  if (del) {
    let sure = 0;
    del.onclick = e => {
      e.stopPropagation();
      if (sure && Date.now() - sure < 4000) return removeCategory(label);
      sure = Date.now(); del.classList.add("sure"); del.textContent = "Sure?"; haptic("tick");
      setTimeout(() => { if (del.isConnected) { del.classList.remove("sure"); del.textContent = "−"; } sure = 0; }, 4000);
    };
  }
  return r;
}

// ---- moving apps between categories: hold one, drag it onto a category (or onto another app, to join it) and let go;
// let go without moving to see its details. Works the same on the treemap, the tree and the list. ----
let drag = null, pickedAt = 0;
function grab(el, a, onTap) {
  let t = 0, x0 = 0, y0 = 0, down = false, fired = false;
  el.addEventListener("pointerdown", e => {
    if (drag) endDrag(false);                                            // a finger left over from an earlier drag
    down = true; fired = false; x0 = e.clientX; y0 = e.clientY; clearTimeout(t); el.classList.add("press");
    t = setTimeout(() => {
      el.classList.remove("press");
      if (!down || fingers > 1) return;
      fired = true; haptic("long"); pickUp(el, a, e.pointerId, x0, y0);
    }, 460);
  });
  el.addEventListener("pointermove", e => { if (down && !fired && Math.hypot(e.clientX - x0, e.clientY - y0) > 9) { clearTimeout(t); down = false; el.classList.remove("press"); } });
  ["pointerup", "pointercancel"].forEach(n => el.addEventListener(n, () => { clearTimeout(t); down = false; el.classList.remove("press"); }));
  el.addEventListener("pointerleave", () => { if (!fired) { clearTimeout(t); down = false; el.classList.remove("press"); } });
  el.addEventListener("click", e => { if (fired) { e.preventDefault(); e.stopPropagation(); fired = false; return; } onTap(e); });
}
function pickUp(el, a, id, x, y) {
  const g = document.createElement("div"); g.className = "ghost"; g.textContent = a.label; document.body.appendChild(g);
  drag = { a, el, id, x0: x, y0: y, x, y, g, moved: false, target: null }; pickedAt = Date.now();
  el.classList.add("lifted"); document.body.classList.add("dragging");
  g.style.left = x + "px"; g.style.top = y + "px";
}
function dropAt(x, y) {
  const el = document.elementFromPoint(x, y), t = el && el.closest("[data-drop], [data-k]");
  if (!t || !$("#map").contains(t)) return null;
  if (t.dataset.k) { const b = L.byKey[t.dataset.k]; return b ? { el: t, state: b.state, cat: b.category } : null; }
  return { el: t, state: t.dataset.state || null, cat: t.dataset.cat || null };
}
function aim() {
  const t = dropAt(drag.x, drag.y), was = drag.target && drag.target.el;
  if ((t && t.el) !== was) { if (was) was.classList.remove("drop"); if (t) t.el.classList.add("drop"); }
  drag.target = t;
}
// Near the top or bottom of the list (or any edge of the tree) the view moves by itself, so every category can be reached.
let edgeRAF = 0;
function edgeScroll() {
  edgeRAF = 0;
  if (!drag || !drag.moved) return;
  const m = $("#map"), r = m.getBoundingClientRect(), E = 56;
  const v = (a, lo, hi) => a < lo + E ? -Math.ceil((lo + E - a) / 5) : a > hi - E ? Math.ceil((a - hi + E) / 5) : 0;
  const dy = v(drag.y, r.top, r.bottom), dx = v(drag.x, r.left, r.right);
  if (m.classList.contains("scroll") && dy) { m.scrollTop += dy; aim(); }
  else if (L.view === "tree" && L.treePan && (dx || dy)) { L.treePan(-dx, -dy); aim(); }
  edgeRAF = requestAnimationFrame(edgeScroll);
}
document.addEventListener("pointermove", e => {
  if (!drag || e.pointerId !== drag.id) return;
  drag.x = e.clientX; drag.y = e.clientY;
  drag.g.style.left = e.clientX + "px"; drag.g.style.top = e.clientY + "px";
  if (!drag.moved && Math.hypot(e.clientX - drag.x0, e.clientY - drag.y0) > 12) drag.moved = true;
  if (!drag.moved) return;
  aim();
  if (!edgeRAF) edgeRAF = requestAnimationFrame(edgeScroll);
}, true);
document.addEventListener("pointerup", e => { if (drag && e.pointerId === drag.id) endDrag(true); }, true);
document.addEventListener("pointercancel", e => { if (drag && e.pointerId === drag.id) endDrag(false); }, true);
document.addEventListener("touchmove", e => { if (drag) e.preventDefault(); }, { passive: false });   // no scrolling while dragging
window.addEventListener("blur", () => { if (drag) endDrag(false); });
document.addEventListener("visibilitychange", () => { if (drag && document.hidden) endDrag(false); });
function endDrag(drop) {
  const d = drag; drag = null; cancelAnimationFrame(edgeRAF); edgeRAF = 0;
  if (!d) return;
  d.g.remove(); d.el.classList.remove("lifted"); document.body.classList.remove("dragging");
  if (d.target) d.target.el.classList.remove("drop");
  if (!drop) return;
  if (!d.moved) return appSheet(d.a);
  if (d.target) moveApp(d.a, d.target.state, d.target.cat);
}
function moveApp(a, state, cat) {
  if (!cat || !L.cats.includes(cat)) cat = a.category;
  if (!L.states.includes(state)) state = a.state === "Working" && isUnsorted(a.category) ? "Current" : a.state;
  if (state === a.state && cat === a.category) return;
  L.over[a.key] = { state, category: cat, at: new Date().toISOString().slice(0, 19) };
  savePref("over", L.over); classifyAll(); refreshScreen(); haptic("tick");
  toast(`${a.label}: ${cat}${state !== a.state ? ", " + state : ""}`);
}

// ---- swiping right goes Back, like the phone's own back gesture: a quick, mostly sideways swipe to the right that
// didn't move a map, drag an app or turn the color wheel. ----
(function swipeBack() {
  let s = null;
  const pose = () => { const z = document.querySelector("#map .tmz, #map .treesvg > g"); return z ? (z.getAttribute("transform") || "") + (z.style.transform || "") : ""; };
  const hscroll = el => { for (; el && el !== document.body; el = el.parentElement) if (el.scrollWidth > el.clientWidth + 1 && /auto|scroll/.test(getComputedStyle(el).overflowX)) return el; return null; };
  document.addEventListener("touchstart", e => {
    if (e.touches.length !== 1 || (e.target.closest && e.target.closest("input, select, textarea, canvas, video, .wheel, #cal"))) { s = null; return; }
    const h = hscroll(e.target);
    s = { x: e.touches[0].clientX, y: e.touches[0].clientY, at: Date.now(), pose: pose(), h, hx: h ? h.scrollLeft : 0 };
  }, { passive: true });
  document.addEventListener("touchend", e => {
    const t = s; s = null;
    if (!t || e.touches.length || pickedAt >= t.at || CAL.gestureAt >= t.at) return;
    const c = e.changedTouches[0], dx = c.clientX - t.x, dy = c.clientY - t.y;
    const edge = t.x < 24;                                               // from the left edge it is always Back, as on the phone
    if (dx < 70 || Math.abs(dy) > dx * .6 || Date.now() - t.at > 700 || (!edge && (pose() !== t.pose || (t.h && t.h.scrollLeft !== t.hx)))) return;
    window.launcherBack();
  }, { passive: true });
  document.addEventListener("touchcancel", () => { s = null; }, { passive: true });
})();

// ---- Claude on the PC (1.5.0): swipe up on Home for what Claude is running on the PC, swipe down to put it away -------
// The PC saves the Claude process tracker's numbers every 2 minutes as claude-processes.json in Atlas's state folder in
// the cloud drive; the page reads that file through Atlas like any other file. Five tiles (processes, memory, CPU, GPU,
// free memory), a ring of who uses what (CPU, GPU or memory), and the projects with their requests.
const PROCS_FILE = "G:\\My Drive\\.atlas\\claude-processes.json";
const PR = { open: false, data: null, err: "", metric: "cpu", timer: 0, seq: 0, hideT: 0, want: null, wantAt: 0, fast: 0, sure: 0, note: "" };
// Pause all (1.6.0): the panel renames a marker folder beside the PC's file, claude-run or claude-paused, through Atlas. The
// PC looks at it every few seconds: on claude-paused it freezes Claude's jobs (never the Claude app or its connectors), on
// claude-run it wakes the same processes again, and saves its numbers at once, so the panel sees it within a minute.
const PR_DIR = "G:\\My Drive\\.atlas", PR_RUN = PR_DIR + "\\claude-run", PR_HOLD = PR_DIR + "\\claude-paused";
const PR_TONES = ["var(--r3)", "var(--r2)", "var(--r4)", "var(--r1)", "var(--r5)", "var(--r0)"];
const prNum = (v, d = 1) => v == null || v === "" || !isFinite(+v) ? "\u2013" : (+v).toLocaleString("en-US", { maximumFractionDigits: d });
const prPct = v => v == null || v === "" || !isFinite(+v) ? "\u2013" : prNum(v) + "%";
function openProcs() {
  const p = $("#procs");
  clearTimeout(PR.hideT);
  if (p.hidden) { p.classList.remove("anim"); p.style.transform = "translateY(100%)"; p.hidden = false; void p.offsetHeight; }
  p.classList.add("anim"); p.style.transform = "translateY(0px)";
  if (!PR.open) { PR.open = true; haptic("tick"); $("#p-body").scrollTop = 0; }
  loadProcs(); clearInterval(PR.timer); PR.timer = setInterval(loadProcs, 30000);
  if (PR.want) procsSoon();
}
function closeProcs(now) {
  const p = $("#procs"); if (!p) return;
  clearInterval(PR.timer); PR.timer = 0; clearInterval(PR.fast); PR.fast = 0; PR.open = false; clearTimeout(PR.hideT);
  if (PR.sure) { clearTimeout(PR.sure); PR.sure = 0; }
  if (now || p.hidden || reduced()) { p.classList.remove("anim"); p.style.transform = ""; p.hidden = true; return; }
  p.classList.add("anim"); p.style.transform = "translateY(100%)";
  PR.hideT = setTimeout(() => { if (!PR.open) { p.hidden = true; p.classList.remove("anim"); p.style.transform = ""; } }, 280);
}
async function loadProcs() {
  const seq = ++PR.seq;
  try {
    const r = await server("/api/text?path=" + encodeURIComponent(PROCS_FILE));
    const d = JSON.parse(r && r.text || "{}"), rows = Array.isArray(d.rows) ? d.rows : [];
    if (!rows.some(x => x && x.kind === "total")) throw new Error("empty");
    if (seq !== PR.seq) return;
    PR.data = { rows, every: +d.every || 120 }; PR.err = "";
    const st = procsState(rows.find(x => x.kind === "total"));
    if (PR.want && st === PR.want) { PR.want = null; PR.note = ""; clearInterval(PR.fast); PR.fast = 0; }
  } catch (e) {
    if (seq !== PR.seq) return;
    const m = e && e.message || "";
    PR.err = m === "not signed in" ? "Not signed in to Atlas yet: tap Files to sign in."
      : m === "can't reach Atlas" || /^Failed|network/i.test(m) ? "Can't reach Atlas right now. Is Tailscale on?"
      : "No numbers from the PC yet. It saves them every 2 minutes while it's on.";
  }
  renderProcs();
}
function renderProcs() {
  const rows = PR.data && PR.data.rows, t = rows && rows.find(x => x.kind === "total");
  $("#p-empty").hidden = !!t; $("#p-main").hidden = !t;
  if (!t) { $("#p-empty").textContent = PR.err || "Asking Atlas"; $("#p-meta").textContent = "Asking Atlas"; $("#p-pause").hidden = true; return; }
  const at = Date.parse(t.at), mins = isFinite(at) ? Math.max(0, Math.round((Date.now() - at) / 60000)) : null;
  const old = mins != null && mins > Math.max(6, 3 * PR.data.every / 60);
  const when = mins == null ? "" : mins < 1 ? "Updated just now" : mins < 60 ? `Updated ${mins} min ago`
    : "Updated " + new Date(at).toLocaleString("en-US", { weekday: "short", hour: "numeric", minute: "2-digit" });
  $("#p-meta").innerHTML = `<b>${esc(t.host || "Your PC")}</b> · ${esc(when)}` + (old ? ` · <span class="warn">the PC may be asleep or off</span>` : "")
    + (PR.err ? ` · <span class="warn">${esc(PR.err)}</span>` : "");
  const st = drawPause(t), sinceAt = Date.parse(t.pausedSince), np = +t.paused || 0;
  const line = st === "paused" ? `Paused since ${isFinite(sinceAt) ? new Date(sinceAt).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" }) : "now"}: `
      + (np ? `${prNum(np, 0)} process${np === 1 ? " is" : "es are"} frozen. Resume all wakes them.` : "nothing of Claude's was running.")
    : st === "pausing" ? "Pausing: the PC freezes Claude's jobs as soon as it sees it, usually within a minute."
    : st === "resuming" ? "Resuming: the PC wakes the same processes, usually within a minute." : "";
  $("#p-state").hidden = !(line || PR.note); $("#p-state").className = "pstate" + (st === "paused" ? " warn" : "");
  $("#p-state").textContent = [line, PR.note].filter(Boolean).join(" ");
  const n = +t.requests || 0;
  const tiles = [["Claude processes", prNum(t.procs, 0), `${prNum(n, 0)} request${n === 1 ? "" : "s"} and the Claude app`],
    ["Memory used by Claude", prNum(t.gb) + " GB", `${prNum(t.pctRam, 0)}% of ${prNum(t.ramGb)} GB`],
    ["CPU used by Claude", prPct(t.cpu), `of all ${prNum(t.cpus, 0)} cores`],
    ["GPU used by Claude", prPct(t.gpu), `PC total ${prPct(t.gpuPc)}`],
    ["Free memory on the PC", prNum(t.freeGb) + " GB", `${prNum(t.freePct, 0)}% of RAM is free`]];
  $("#p-tiles").innerHTML = tiles.map(([k, v, s]) => `<div class="ptile"><div class="k">${esc(k)}</div><div class="v">${esc(v)}</div><div class="s">${esc(s)}</div></div>`).join("");
  drawRing();
  const rank = p => p.project === "Claude itself" ? 2 : p.project === "Not sorted yet" ? 1 : 0;
  const projects = rows.filter(r => r.kind === "project" && +r.requests > 0).sort((a, b) => rank(a) - rank(b) || (+b.memPct || 0) - (+a.memPct || 0));
  const cells = r => `<span class="num">${esc(prPct(r.memPct))}</span><span class="num">${esc(prPct(r.cpu))}</span><span class="num">${esc(prPct(r.gpu))}</span>`;
  $("#p-list").innerHTML = `<div class="prow phd"><span>Request</span><span class="num">Memory</span><span class="num">CPU</span><span class="num">GPU</span></div>`
    + (projects.length ? projects.map(p => `<div class="prow pj"><span class="t">${esc(p.title || p.project)}</span>${cells(p)}</div>`
      + rows.filter(r => r.kind === "request" && r.project === p.project).sort((a, b) => (+b.memPct || 0) - (+a.memPct || 0) || (+b.cpu || 0) - (+a.cpu || 0))
        .map(r => `<div class="prow rq"><span class="t">${esc(r.title)}${r.paused ? `<em class="ptag">paused</em>` : ""}${r.desc ? `<small>${esc(r.desc)}</small>` : ""}</span>${cells(r)}</div>`).join("")).join("")
      : `<p class="pnone">Nothing from Claude is running.</p>`);
  const idle = rows.filter(r => r.kind === "project" && +r.requests === 0).map(r => r.project);
  $("#p-idle").hidden = !idle.length; $("#p-idle").textContent = idle.length ? `Nothing running in ${idle.join(", ")}.` : "";
}
// What the PC says: running, pausing (the marker says pause, nothing frozen yet), paused, or resuming.
function procsState(t) {
  if (!t) return "";
  if ((t.control || "running") === "paused") return t.pausedSince ? "paused" : "pausing";
  return +t.paused > 0 || t.pausedSince ? "resuming" : "running";
}
// One button: Pause all (tap, then Sure?), and while paused, Resume all. In between it says what it is waiting for.
function drawPause(t) {
  const b = $("#p-pause"); if (!b) return;
  const pc = procsState(t);
  let st = pc;
  if (PR.want === "paused" && (pc === "running" || pc === "resuming")) st = "pausing";
  if (PR.want === "running" && (pc === "paused" || pc === "pausing")) st = "resuming";
  b.hidden = !t; b.dataset.st = st;
  b.disabled = st === "pausing" || st === "resuming";
  b.classList.toggle("on", st === "paused");
  b.textContent = st === "paused" ? "Resume all" : st === "pausing" ? "Pausing\u2026" : st === "resuming" ? "Resuming\u2026" : PR.sure ? "Sure?" : "Pause all";
  return st;
}
async function procsControl(want) {
  PR.want = want; PR.wantAt = Date.now(); PR.note = ""; haptic("tick"); renderProcs();
  try { await serverPost("/api/rename", want === "paused" ? { path: PR_RUN, name: "claude-paused" } : { path: PR_HOLD, name: "claude-run" }); }
  catch (e) {
    try {                                                               // the marker isn't where it should be: set it anyway
      if (e.message === "not signed in") throw e;
      if (want === "paused") await serverPost("/api/mkdir", { dir: PR_DIR, name: "claude-paused" });
      else await serverPost("/api/delete", { items: [PR_HOLD] });
    } catch (e2) {
      PR.want = null; PR.note = e2.message === "not signed in" ? "Not signed in to Atlas yet" : `Couldn't reach Atlas to ${want === "paused" ? "pause" : "resume"}`;
      renderProcs(); return;
    }
  }
  procsSoon();
}
// While a change is on its way, look every 5 s, for up to 3 minutes.
function procsSoon() {
  clearInterval(PR.fast);
  PR.fast = setInterval(() => {
    if (PR.want && Date.now() - PR.wantAt < 180000) return loadProcs();
    clearInterval(PR.fast); PR.fast = 0;
    if (PR.want) { PR.want = null; PR.note = "The PC hasn't answered yet: is it on?"; renderProcs(); }
  }, 5000);
}
$("#p-pause").onclick = () => {
  const st = $("#p-pause").dataset.st;
  if (st === "paused") return procsControl("running");
  if (st !== "running") return;
  if (!PR.sure) { haptic("tick"); PR.sure = setTimeout(() => { PR.sure = 0; renderProcs(); }, 3000); return renderProcs(); }
  clearTimeout(PR.sure); PR.sure = 0; procsControl("paused");
};
// A slice of the ring, from angle a0 to a1 (radians, clockwise from the top), between radii r0 and r1.
function ringArc(c, r0, r1, a0, a1) {
  if (a1 - a0 >= 2 * Math.PI - 1e-6) return ringArc(c, r0, r1, a0, a0 + Math.PI) + " " + ringArc(c, r0, r1, a0 + Math.PI, a1);
  const pt = (r, a) => `${(c + r * Math.sin(a)).toFixed(2)} ${(c - r * Math.cos(a)).toFixed(2)}`, big = a1 - a0 > Math.PI ? 1 : 0;
  return `M${pt(r1, a0)} A${r1} ${r1} 0 ${big} 1 ${pt(r1, a1)} L${pt(r0, a1)} A${r0} ${r0} 0 ${big} 0 ${pt(r0, a0)} Z`;
}
function drawRing() {
  const box = $("#p-ring"), rows = PR.data && PR.data.rows; if (!box || !rows) return;
  const k = PR.metric, label = k === "memPct" ? "Memory" : k.toUpperCase(), t = rows.find(x => x.kind === "total");
  const req = rows.filter(x => x.kind === "request");
  // each request keeps its color when the choice changes; the order follows the value shown
  const tone = new Map(req.slice().sort((a, b) => (+b.memPct || 0) - (+a.memPct || 0) || String(a.key).localeCompare(String(b.key))).map((x, i) => [x.key, PR_TONES[i % PR_TONES.length]]));
  const items = req.map(x => ({ key: x.key, name: x.title, v: +x[k] || 0, color: tone.get(x.key) })).sort((a, b) => b.v - a.v);
  const other = rows.find(x => x.key === "o:apps"), free = rows.find(x => x.key === "o:free");
  if (other) items.push({ name: "Other apps", v: +other[k] || 0, hatch: true, muted: true });
  if (free) items.push({ name: k === "memPct" ? "Free" : "Idle", v: +free[k] || 0, color: "var(--surface-2)", edge: true, muted: true });
  const W = Math.max(180, Math.min(280, (box.clientWidth || 320) - 16)), c = W / 2, R = c - 2, r0 = R * .64;
  const all = items.reduce((s, d) => s + Math.max(0, d.v), 0) || 1;
  let a = 0, paths = "";
  for (const d of items) {
    if (d.v <= 0) continue;
    const a1 = a + d.v / all * 2 * Math.PI;
    paths += `<path d="${ringArc(c, r0, R, a, a1)}" style="fill:${d.hatch ? "url(#p-hatch)" : d.color};stroke:${d.edge ? "var(--line)" : "var(--bg)"};stroke-width:1"/>`;
    a = a1;
  }
  box.innerHTML = `<svg viewBox="0 0 ${W} ${W}" width="${W}" height="${W}" role="img" aria-label="${esc(label + " use: " + items.map(d => d.name + " " + prPct(d.v)).join(", "))}">`
    + `<defs><pattern id="p-hatch" width="5" height="5" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="5" height="5" style="fill:var(--bg)"/><rect width="1.6" height="5" style="fill:var(--dim)"/></pattern></defs>`
    + paths + `<circle cx="${c}" cy="${c}" r="${(r0 - 7).toFixed(1)}" style="fill:none;stroke:var(--ink);stroke-width:1"/>`
    + `<text x="${c}" y="${(c - R * .2).toFixed(1)}" class="rk">CLAUDE</text>`
    + `<text x="${c}" y="${(c + R * .1).toFixed(1)}" class="rv" style="font-size:${Math.round(R * .26)}px">${esc(prPct(t && t[k]))}</text>`
    + `<text x="${c}" y="${(c + R * .1 + 16).toFixed(1)}" class="rk">OF ${esc(label.toUpperCase())}</text></svg>`;
  $("#p-legend").innerHTML = items.map(d => `<li${d.muted ? ' class="muted"' : ""}><i class="sw${d.hatch ? " hatch" : ""}${d.edge ? " edge" : ""}"${d.hatch ? "" : ` style="background:${d.color}"`}></i>`
    + `<span class="nm">${esc(d.name)}</span><span class="vl">${esc(prPct(d.v))}</span></li>`).join("");
}
$$("#p-metric button").forEach(b => b.onclick = () => { PR.metric = b.dataset.k; setSeg("#p-metric", "k", PR.metric); haptic("tick"); drawRing(); });
$("#p-grab").onclick = () => closeProcs();
// The swipes: up on Home pulls the panel up with the finger, down on the panel (scrolled to the top) pulls it away.
// Let go past about a fifth of the screen, or with a flick, and it goes the rest of the way; otherwise it springs back.
(function swipeProcs() {
  const panel = $("#procs"), body = $("#p-body");
  let g = null;
  document.addEventListener("touchstart", e => {
    g = null;
    if (e.touches.length !== 1) return;
    const t = e.touches[0], el = e.target.closest ? e.target : null;
    if (!el) return;
    if (!PR.open) {
      if (L.screen !== "home" || L.q || dialOpen() || document.body.classList.contains("sheeton") || !el.closest("#home") || el.closest("#hub")) return;
      g = { up: true, x: t.clientX, y: t.clientY, at: Date.now(), on: false };
    } else if (el.closest("#procs") && body.scrollTop <= 0) g = { up: false, x: t.clientX, y: t.clientY, at: Date.now(), on: false };
  }, { passive: true });
  document.addEventListener("touchmove", e => {
    if (!g) return;
    const t = e.touches[0], dx = t.clientX - g.x, dy = t.clientY - g.y;
    if (!g.on) {
      if (Math.abs(dx) > 14 && Math.abs(dx) > Math.abs(dy)) { g = null; return; }   // sideways: Back, or a map
      if (Math.abs(dy) < 10) return;
      if (g.up ? dy > 0 : dy < 0 || body.scrollTop > 0) { g = null; return; }      // the other way: the page's own
      g.on = true; g.h = innerHeight; panel.classList.remove("anim"); clearTimeout(PR.hideT);
      if (g.up) { panel.style.transform = `translateY(${g.h}px)`; panel.hidden = false; if (!PR.data) loadProcs(); }
    }
    e.preventDefault();
    panel.style.transform = `translateY(${Math.max(0, g.up ? g.h + dy : dy)}px)`;
  }, { passive: false });
  const end = (e, cancel) => {
    const s = g; g = null;
    if (!s || !s.on) return;
    const c = e.changedTouches && e.changedTouches[0], dy = c ? c.clientY - s.y : 0, v = dy / Math.max(1, Date.now() - s.at);
    const go = !cancel && (s.up ? (-dy > s.h * .2 || v < -.45) : (dy > s.h * .2 || v > .45));
    if (s.up === go) openProcs(); else closeProcs();
  };
  document.addEventListener("touchend", e => end(e, false), { passive: true });
  document.addEventListener("touchcancel", e => end(e, true), { passive: true });
})();

// ---- the calendar (1.6.0): swipe right on Home for every calendar on the phone, personal and work, in one place ------
// Outlook is the model: all the accounts' calendars together, each in its own color; an agenda, a day, three days or a
// month; a week strip on top that a sideways swipe moves; Calendars to show or hide each one; an event's details with
// Join for an online meeting, Accept, Tentative or Decline, and the phone's calendar app; + for a new event. Android
// keeps every account's calendars in one store on the phone (Google, Outlook when it syncs its calendars, Exchange,
// Samsung...) and the app reads them there (PhoneCalendar.kt): nothing leaves the phone. Days are counted the way
// Android counts them, as Julian day numbers in the phone's time zone.
const JD0 = 2440588;                                                    // 1970-01-01
const jdOf = d => Math.round(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / DAY) + JD0;
const dateOf = jd => { const u = new Date((jd - JD0) * DAY); return new Date(u.getUTCFullYear(), u.getUTCMonth(), u.getUTCDate()); };
const todayJd = () => jdOf(new Date());
const WEEK0 = (() => {                                                  // the first day of the week where the phone is
  try { const l = new Intl.Locale(navigator.language || "en-US"), w = l.getWeekInfo ? l.getWeekInfo() : l.weekInfo; return w && w.firstDay ? w.firstDay % 7 : 0; }
  catch (e) { return 0; }
})();
const weekStart = jd => jd - (dateOf(jd).getDay() - WEEK0 + 7) % 7;
const CAL = {
  open: false, shown: false, ready: false, allowed: null, write: false, workProfile: false, h24: false, err: "",
  cals: [], byId: new Map(), events: [], days: new Map(),
  from: 0, to: 0, sel: 0, view: "agenda", hide: [], colors: {}, def: "", declined: false,
  seq: 0, busy: false, hideT: 0, timer: 0, closedAt: 0, gestureAt: 0, asked: false, detail: null,
};
const CAL_VIEWS = ["agenda", "day", "3day", "month"];
const calKey = (w, id) => (w ? "w" : "p") + id;
const calOf = ev => CAL.byId.get(calKey(ev.w, ev.cal));
const calPref = c => c.work ? "work|" + c.id : c.type + "|" + c.account + "|" + c.name;     // the same after Android numbers them again
const calName = c => c.work ? (c.primary ? "Work calendar" : "Work calendar " + c.id) : !c.name || c.name === c.account ? (c.primary ? "Calendar" : c.name || "Calendar") : c.name;
// In lists, a calendar's name, or its account's domain when the name says nothing ("Calendar", the address itself), or
// both when two shown calendars share a name: Outlook and Google both call the main one "Calendar".
function calLabel(c) {
  if (c.work) return calName(c);
  const dom = String(c.account || "").split("@")[1] || c.app || "", name = calName(c);
  if (!c.name || c.name === c.account || /^calendar$/i.test(c.name)) return dom || name;
  return CAL.cals.some(x => x !== c && calShown(x) && calName(x) === name) ? name + " · " + dom : name;
}
const calOn = c => c.visible && c.sync;                                // the phone syncs and shows it
const calShown = c => calOn(c) && !CAL.hide.includes(calPref(c));
const calWritable = c => !c.work && calOn(c) && c.access >= 500;
function saveCal() { savePref("cal", { view: CAL.view, hide: CAL.hide, colors: CAL.colors, def: CAL.def, declined: CAL.declined }); }

// Each calendar keeps its own hue, at the brightness of the launcher's tiles so the names on it stay readable; or the
// color picked for it in Calendars (hold one). An event with a color of its own keeps that hue.
const okCache = new Map();
function hexOk(hex) {
  if (okCache.has(hex)) return okCache.get(hex);
  const n = parseInt(String(hex).replace("#", ""), 16) || 0;
  const v = [16, 8, 0].map(s => { const x = ((n >> s) & 255) / 255; return x <= .04045 ? x / 12.92 : Math.pow((x + .055) / 1.055, 2.4); });
  const l = Math.cbrt(.4122214708 * v[0] + .5363325363 * v[1] + .0514459929 * v[2]);
  const m = Math.cbrt(.2119034982 * v[0] + .6806995451 * v[1] + .1073969566 * v[2]);
  const s = Math.cbrt(.0883024619 * v[0] + .2817188376 * v[1] + .6299787005 * v[2]);
  const a = 1.9779984951 * l - 2.4285922050 * m + .4505937099 * s, b = .0259040371 * l + .7827717662 * m - .8086757660 * s;
  const r = { c: Math.hypot(a, b), h: (Math.atan2(b, a) / RAD + 360) % 360 };
  okCache.set(hex, r); return r;
}
function tone(hex, pick) {
  if (pick && NAMED[pick]) return `oklch(.6 ${NAMED[pick][1]} ${NAMED[pick][0]})`;
  const k = hexOk(hex || "#808080");
  return k.c < .03 ? `oklch(.55 .012 ${k.h.toFixed(1)})` : `oklch(.6 ${Math.min(.16, Math.max(.08, k.c)).toFixed(3)} ${k.h.toFixed(1)})`;
}
const calColor = c => tone(c.color, CAL.colors[calPref(c)]);
function evColor(ev) {
  const c = calOf(ev); if (!c) return tone(ev.col);
  const pick = CAL.colors[calPref(c)];
  return pick ? tone("", pick) : tone(ev.col && ev.col !== c.color ? ev.col : c.color);
}

// ---- times and days -------------------------------------------------------------------------------------------
const pad2 = n => String(n).padStart(2, "0");
const hm = ms => new Date(ms).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hourCycle: CAL.h24 ? "h23" : "h12" });
const hourLabel = h => CAL.h24 ? pad2(h) + ":00" : (h % 12 || 12) + (h < 12 ? " AM" : " PM");
const evLen = ms => { const m = Math.round(ms / 60000); return m < 60 ? m + "m" : Math.floor(m / 60) + "h" + (m % 60 ? " " + (m % 60) + "m" : ""); };
const dayFmt = (jd, o) => dateOf(jd).toLocaleDateString("en-US", o);
function dayHead(jd) {
  const t = todayJd(), y = dateOf(jd).getFullYear() !== new Date().getFullYear();
  const name = dayFmt(jd, { weekday: "long", month: "long", day: "numeric", ...(y ? { year: "numeric" } : {}) });
  return jd === t ? "Today · " + name : jd === t + 1 ? "Tomorrow · " + name : jd === t - 1 ? "Yesterday · " + name : name;
}
// An event fills the whole of day jd when it is all day, or runs through it (from midnight or before, to midnight or after).
const wholeDay = (ev, jd) => !!ev.ad || ((ev.sd < jd || ev.sm <= 0) && (ev.ed > jd || ev.em >= 1440));
// As in Outlook: tentative is hatched, not answered yet is an outline, declined and canceled are struck through.
const evState = ev => ev.st === 2 ? "canceled" : ev.me === 2 ? "declined" : ev.me === 3 ? "invited" : ev.me === 4 || ev.st === 0 ? "maybe" : "";

// ---- the days on the phone ----------------------------------------------------------------------------------------------
function calIndex() {
  CAL.days = new Map();
  CAL.events.forEach((ev, i) => { ev.ix = i; });
  for (const ev of CAL.events) {
    const c = calOf(ev);
    if (!c || !calShown(c) || (ev.me === 2 && !CAL.declined)) continue;
    for (let d = Math.max(ev.sd, CAL.from), e = Math.min(ev.ed, CAL.to); d <= e; d++) {
      let l = CAL.days.get(d); if (!l) CAL.days.set(d, l = []);
      l.push(ev);
    }
  }
  for (const [d, l] of CAL.days) l.sort((a, b) => (wholeDay(b, d) - wholeDay(a, d)) || a.b - b.b || b.e - a.e || String(a.t).localeCompare(String(b.t)));
}
async function loadCal() {
  const seq = ++CAL.seq, from = CAL.from, to = CAL.to;
  CAL.busy = true;
  try {
    const [l, e] = await Promise.all([native("cal.list"), native("cal.events", { from, to })]);
    if (seq !== CAL.seq) return;
    CAL.allowed = !!l.allowed; CAL.write = !!l.write; CAL.workProfile = !!l.workProfile; CAL.h24 = !!l.h24;
    CAL.cals = Array.isArray(l.calendars) ? l.calendars : [];
    CAL.byId = new Map(CAL.cals.map(c => [calKey(c.work, c.id), c]));
    CAL.events = Array.isArray(e.events) ? e.events : []; CAL.err = "";
  } catch (err) {
    if (seq !== CAL.seq) return;
    CAL.err = err && err.message || "failed";
  }
  CAL.ready = true; CAL.busy = false;
  calIndex(); renderCal(false);
  if (CAL.allowed === false && !CAL.asked) { CAL.asked = true; fire("cal.allow", { auto: true }); }   // the first swipe right asks Android
}
// The days loaded: from a few weeks before to a few weeks after, more at either end as the agenda scrolls, and a fresh
// stretch after a jump. At most about 14 months at a time: the far end goes as the near one grows.
function calRange(a, b) {
  if (CAL.to && a >= CAL.from && b <= CAL.to) return false;
  const MAX = 420;
  if (!CAL.to || (a < CAL.from && b > CAL.to) || a > CAL.to + 60 || b < CAL.from - 60) { CAL.from = a - 21; CAL.to = b + 42; }
  else if (b > CAL.to) { CAL.to = b + 42; CAL.from = Math.max(CAL.from, CAL.to - MAX); }
  else { CAL.from = a - 21; CAL.to = Math.min(CAL.to, CAL.from + MAX); }
  loadCal(); return true;
}

// ---- in and out -----------------------------------------------------------------------------------------------
function openCal() {
  const p = $("#cal");
  clearTimeout(CAL.hideT);
  if (p.hidden) { p.classList.remove("anim"); p.style.transform = "translateX(-100%)"; p.hidden = false; void p.offsetHeight; }
  p.classList.add("anim"); p.style.transform = "translateX(0px)";
  if (!CAL.open) { CAL.open = true; haptic("tick"); if (!CAL.shown) calShow(); }
  clearInterval(CAL.timer);
  CAL.timer = setInterval(() => { if (CAL.open && !document.body.classList.contains("sheeton")) renderCal(false); }, 60000);   // the time moves on
}
// The panel coming in: it opens on today, unless you looked at it in the last half hour.
function calShow() {
  CAL.shown = true;
  let jump = false;
  if (!CAL.sel || Date.now() - CAL.closedAt > 30 * 60000) { CAL.sel = todayJd(); jump = true; }
  if (!calRange(weekStart(CAL.sel) - 7, CAL.sel + 42)) loadCal();
  renderCal(jump || !$("#c-body").firstElementChild);
}
function closeCal(now) {
  const p = $("#cal"); if (!p) return;
  clearInterval(CAL.timer); CAL.timer = 0; clearTimeout(CAL.hideT);
  if (CAL.open || CAL.shown) CAL.closedAt = Date.now();
  CAL.open = false; CAL.shown = false;
  if (now || p.hidden || reduced()) { p.classList.remove("anim"); p.style.transform = ""; p.hidden = true; return; }
  p.classList.add("anim"); p.style.transform = "translateX(-100%)";
  CAL.hideT = setTimeout(() => { if (!CAL.open) { p.hidden = true; p.classList.remove("anim"); p.style.transform = ""; } }, 280);
}

// ---- drawing ----------------------------------------------------------------------------------------------------
function calMeta() {
  const d = dateOf(CAL.sel || todayJd()), n = CAL.cals.filter(calShown).length;
  $("#c-meta").innerHTML = `<b>${esc(d.toLocaleDateString("en-US", { month: "long" }))}</b> ${d.getFullYear()}`
    + (CAL.allowed && CAL.ready ? ` · ${n} calendar${n === 1 ? "" : "s"}` : "");
}
function renderCal(jump) {
  const B = $("#c-body");
  if ($("#cal").hidden) return;
  $("#c-todayn").textContent = dateOf(todayJd()).getDate();
  setSeg("#c-views", "v", CAL.view);
  calMeta(); renderStrip();
  B.dataset.view = CAL.view;
  $("#c-new").hidden = CAL.allowed === false;
  if (CAL.allowed === false) { B.innerHTML = calPermHtml(); return; }
  if (!CAL.ready) { B.innerHTML = `<p class="cnote">Reading your calendars</p>`; return; }
  if (CAL.err && !CAL.events.length && !CAL.cals.length) { B.innerHTML = `<p class="cnote">Couldn't read the calendars: ${esc(CAL.err)}</p>`; return; }
  if (!CAL.cals.length) {
    B.innerHTML = `<div class="cperm"><h3>No calendars on this phone yet</h3><p class="note">They come from the accounts on the phone: add one in Android's Settings (Google, Exchange), or in Outlook open Settings, tap each account and turn on Sync calendars.</p></div>`;
    return;
  }
  if (CAL.view === "agenda") renderAgenda(jump);
  else if (CAL.view === "month") renderMonth();
  else renderDays(CAL.view === "3day" ? 3 : 1, jump);
}
const calPermHtml = () => `<div class="cperm"><h3>Every calendar, in one place</h3>
  <p>Personal and work, from every account on this phone (Google, Outlook, Exchange and the rest), each in its own color.</p>
  <p class="note">Android asks once to let Atlas see your calendars, and to add events and answer invitations for you. They're read on the phone and go nowhere.</p>
  <div class="row"><button type="button" class="btn primary" data-act="allow">Allow calendars</button></div></div>`;

// The week on top: the day picked takes the boxes' color, today is underlined, and a dot for each calendar with an event.
function renderStrip() {
  const S = $("#c-strip");
  if (CAL.view === "month" || CAL.allowed === false) { S.hidden = true; S.innerHTML = ""; return; }
  S.hidden = false;
  const w0 = weekStart(CAL.sel), tj = todayJd(), n = CAL.view === "3day" ? 3 : 1;
  let h = "";
  for (let i = 0; i < 7; i++) {
    const jd = w0 + i, on = jd >= CAL.sel && jd < CAL.sel + n;
    h += `<button type="button" data-sjd="${jd}" class="${on ? "on" : ""}${jd === tj ? " today" : ""}" aria-pressed="${on}" aria-label="${esc(dayFmt(jd, { weekday: "long", month: "long", day: "numeric" }))}">`
      + `<span class="dw">${esc(dayFmt(jd, { weekday: "narrow" }))}</span><span class="dn">${dateOf(jd).getDate()}</span><span class="dots">${calDots(jd)}</span></button>`;
  }
  S.innerHTML = `<div class="cweek">${h}</div>`;
}
function calDots(jd) {
  const seen = [];
  for (const ev of CAL.days.get(jd) || []) { const c = evColor(ev); if (!seen.includes(c)) seen.push(c); if (seen.length === 3) break; }
  return seen.map(c => `<i style="background:${c}"></i>`).join("");
}

// Agenda: every day in a row, its events under it (all day first), "No events" on a free day. Scrolling moves the week
// on top with it, and loads more days near either end.
function evWhen(ev, jd) {
  if (wholeDay(ev, jd)) return ["All day", ev.ed > ev.sd ? `day ${jd - ev.sd + 1} of ${ev.ed - ev.sd + 1}` : ""];
  if (ev.sd === jd && ev.ed === jd) return [hm(ev.b), evLen(ev.e - ev.b)];
  if (ev.sd === jd) return [hm(ev.b), "to " + dayFmt(ev.ed, { weekday: "short" })];
  return ["Until", hm(ev.e)];
}
function evRow(ev, jd) {
  const c = calOf(ev), now = Date.now(), live = !wholeDay(ev, jd) && ev.st !== 2 && ev.b <= now && now < ev.e;
  const [t1, t2] = evWhen(ev, jd);
  const sub = [ev.loc, c && CAL.cals.filter(calShown).length > 1 ? calLabel(c) : ""].filter(Boolean).join(" · ");
  return `<button type="button" class="crow ${evState(ev)}${live ? " live" : ""}" data-ev="${ev.ix}" data-jd="${jd}" style="--ec:${evColor(ev)}">`
    + `<span class="ct"><b>${esc(live ? "Now" : t1)}</b><small>${esc(live ? "to " + hm(ev.e) : t2)}</small></span><i class="cbar"></i>`
    + `<span class="cm"><span class="cn">${ev.st === 2 ? "Canceled: " : ""}${esc(ev.t || "(No title)")}</span>${sub ? `<small>${esc(sub)}</small>` : ""}</span>`
    + (ev.join && ev.st !== 2 && ev.e > now ? `<span class="cj" data-join="${ev.ix}" role="button">Join</span>` : "") + `</button>`;
}
function renderAgenda(jump) {
  const B = $("#c-body"), tj = todayJd();
  let anchor = null;
  if (!jump && B.firstElementChild && B.firstElementChild.classList.contains("cagenda")) {
    const top = [...B.querySelectorAll(".cday")].find(s => s.offsetTop + s.offsetHeight > B.scrollTop);
    if (top) anchor = { jd: +top.dataset.jd, dy: B.scrollTop - top.offsetTop };
  }
  let h = "";
  for (let jd = CAL.from; jd <= CAL.to; jd++) {
    const list = CAL.days.get(jd) || [];
    h += `<section class="cday${jd === tj ? " today" : ""}" data-jd="${jd}"><h4 class="cdh">${esc(dayHead(jd))}</h4>`
      + (list.length ? list.map(ev => evRow(ev, jd)).join("") : `<p class="cnone">No events</p>`) + `</section>`;
  }
  B.innerHTML = `<div class="cagenda">${h}</div>`;
  const go = anchor || { jd: CAL.sel, dy: 0 }, el = B.querySelector(`.cday[data-jd="${go.jd}"]`);
  CAL.quiet = true;
  B.scrollTop = el ? el.offsetTop + go.dy : 0;
  requestAnimationFrame(() => { CAL.quiet = false; });
}
let calRAF = 0;
function calScrolled() {
  const B = $("#c-body");
  if (CAL.view !== "agenda" || CAL.quiet || !B.firstElementChild || !B.firstElementChild.classList.contains("cagenda")) return;
  const top = [...B.querySelectorAll(".cday")].find(s => s.offsetTop + s.offsetHeight > B.scrollTop + 2);
  if (top && +top.dataset.jd !== CAL.sel) { CAL.sel = +top.dataset.jd; renderStrip(); calMeta(); }
  if (CAL.busy) return;
  if (B.scrollHeight - B.scrollTop - B.clientHeight < 900) calRange(CAL.from, CAL.to + 30);
  else if (B.scrollTop < 240 && todayJd() - CAL.from < 400) calRange(CAL.from - 30, CAL.to);
}

// Day and 3 days: the hours down the side, events where they fall (side by side when they overlap), all-day events on
// top, a line at the time now. Swipe sideways for the next or previous days; tap an empty hour for a new event there.
const HOUR = 52;
function layoutDay(list, jd) {
  const items = list.map(ev => {
    const s = ev.sd < jd ? 0 : ev.sm, e = ev.ed > jd ? 1440 : ev.em;
    return { ev, s, e: Math.min(1440, Math.max(e, s + 20)) };
  }).sort((a, b) => a.s - b.s || b.e - a.e);
  const out = [];
  let group = [], end = -1;
  const flush = () => {
    const cols = [];
    for (const it of group) { let k = cols.findIndex(t => t <= it.s); if (k < 0) { k = cols.length; cols.push(0); } cols[k] = it.e; it.k = k; }
    for (const it of group) it.n = cols.length;
    out.push(...group); group = []; end = -1;
  };
  for (const it of items) {
    if (group.length && it.s >= end) flush();
    group.push(it); end = Math.max(end, it.e);
  }
  if (group.length) flush();
  return out;
}
function evBlock(it, jd) {
  const ev = it.ev, top = it.s / 60 * HOUR, h = Math.max(20, (it.e - it.s) / 60 * HOUR - 2);
  const sub = [ev.sd === jd ? hm(ev.b) : "", ev.loc].filter(Boolean).join(" · ");
  return `<button type="button" class="cev ${evState(ev)}" data-ev="${ev.ix}" data-jd="${jd}" style="--ec:${evColor(ev)};top:${top.toFixed(1)}px;height:${h.toFixed(1)}px;left:calc(${it.k} * 100% / ${it.n});width:calc(100% / ${it.n} - 2px)">`
    + `<b>${ev.st === 2 ? "Canceled: " : ""}${esc(ev.t || "(No title)")}</b>${h >= 36 && sub ? `<small>${esc(sub)}</small>` : ""}</button>`;
}
function renderDays(n, jump) {
  const B = $("#c-body"), tj = todayJd(), days = Array.from({ length: n }, (_, i) => CAL.sel + i);
  calRange(days[0] - 7, days[n - 1] + 7);
  const keep = !jump && B.firstElementChild && B.firstElementChild.classList.contains("ctime") ? B.scrollTop : null;
  const now = new Date(), nowMin = now.getHours() * 60 + now.getMinutes();
  const top = days.map((jd, i) => {
    const all = (CAL.days.get(jd) || []).filter(ev => wholeDay(ev, jd));
    const chips = all.slice(0, 3).map(ev => `<button type="button" class="cad ${evState(ev)}" data-ev="${ev.ix}" data-jd="${jd}" style="--ec:${evColor(ev)}">${esc(ev.t || "(No title)")}</button>`).join("")
      + (all.length > 3 ? `<button type="button" class="cadmore" data-day="${jd}">${all.length - 3} more</button>` : "");
    return `<div class="cch${jd === tj ? " today" : ""}">${n > 1 ? `<span class="cchd">${esc(dayFmt(jd, { weekday: "short" }))} <b>${dateOf(jd).getDate()}</b></span>` : ""}${chips}</div>`;
  }).join("");
  let hours = "";
  for (let h = 1; h < 24; h++) hours += `<span style="top:${h * HOUR}px">${esc(hourLabel(h))}</span>`;
  const cols = days.map(jd => `<div class="cgcol${jd === tj ? " today" : ""}" data-jd="${jd}">`
    + layoutDay((CAL.days.get(jd) || []).filter(ev => !wholeDay(ev, jd)), jd).map(it => evBlock(it, jd)).join("")
    + (jd === tj ? `<i class="cnow" style="top:${(nowMin / 60 * HOUR).toFixed(1)}px"></i>` : "") + `</div>`).join("");
  const head = n > 1 || top.includes("cad") ? `<div class="ccols"><span class="cgut"></span>${top}</div>` : "";
  B.innerHTML = `<div class="ctime" style="--n:${n};--hh:${HOUR}px">${head}<div class="cgrid" style="height:${24 * HOUR}px"><div class="chours">${hours}</div>${cols}</div></div>`;
  B.scrollTop = keep != null ? keep : Math.max(0, ((days.includes(tj) ? nowMin / 60 - 1.5 : 7.5) * HOUR));
}

// Month: the weeks of the month with a dot for each calendar that has something that day, and the day picked under it.
function renderMonth() {
  const B = $("#c-body"), d = dateOf(CAL.sel), tj = todayJd();
  const first = jdOf(new Date(d.getFullYear(), d.getMonth(), 1)), last = jdOf(new Date(d.getFullYear(), d.getMonth() + 1, 0));
  const g0 = weekStart(first), rows = Math.ceil((last - g0 + 1) / 7);
  calRange(g0, g0 + rows * 7 - 1);
  let head = "", cells = "";
  for (let i = 0; i < 7; i++) head += `<span>${esc(dayFmt(g0 + i, { weekday: "narrow" }))}</span>`;
  for (let i = 0; i < rows * 7; i++) {
    const jd = g0 + i;
    cells += `<button type="button" data-mjd="${jd}" class="${jd < first || jd > last ? "out" : ""}${jd === tj ? " today" : ""}${jd === CAL.sel ? " on" : ""}" aria-label="${esc(dayFmt(jd, { weekday: "long", month: "long", day: "numeric" }))}">`
      + `<span class="dn">${dateOf(jd).getDate()}</span><span class="dots">${calDots(jd)}</span></button>`;
  }
  const list = CAL.days.get(CAL.sel) || [];
  B.innerHTML = `<div class="cmonth"><div class="cmhead">${head}</div><div class="cmgrid">${cells}</div></div>`
    + `<section class="cday" data-jd="${CAL.sel}"><h4 class="cdh">${esc(dayHead(CAL.sel))}</h4>`
    + (list.length ? list.map(ev => evRow(ev, CAL.sel)).join("") : `<p class="cnone">No events</p>`) + `</section>`;
}

// Moving on: a week (or the days shown) at a time, or a month in Month.
function calStep(dir, k) {
  CAL.sel += dir * k;
  calRange(weekStart(CAL.sel) - 7, CAL.sel + 14);
  renderCal(true);
}
function calStepMonth(dir) {
  const d = dateOf(CAL.sel), want = new Date(d.getFullYear(), d.getMonth() + dir, 1);
  const days = new Date(want.getFullYear(), want.getMonth() + 1, 0).getDate();
  CAL.sel = jdOf(new Date(want.getFullYear(), want.getMonth(), Math.min(d.getDate(), days)));
  renderCal(true);
}
function calToday() {
  CAL.sel = todayJd(); haptic("tick");
  calRange(weekStart(CAL.sel) - 7, CAL.sel + 42);
  renderCal(true);
}

// ---- an event: when, where, Join, the answer, the people, the notes, and the phone's calendar app ----------------------
function whenText(ev) {
  const long = { weekday: "long", month: "long", day: "numeric" }, short = { weekday: "short", month: "short", day: "numeric" };
  if (ev.ad) return ev.sd === ev.ed ? [dayFmt(ev.sd, long), "All day"]
    : [`${dayFmt(ev.sd, short)} – ${dayFmt(ev.ed, short)}`, `All day · ${ev.ed - ev.sd + 1} days`];
  if (ev.sd === ev.ed) return [dayFmt(ev.sd, long), `${hm(ev.b)} – ${hm(ev.e)} · ${evLen(ev.e - ev.b)}`];
  return [`${dayFmt(ev.sd, short)}, ${hm(ev.b)} – ${dayFmt(ev.ed, short)}, ${hm(ev.e)}`, evLen(ev.e - ev.b)];
}
const BYDAY = { MO: "Monday", TU: "Tuesday", WE: "Wednesday", TH: "Thursday", FR: "Friday", SA: "Saturday", SU: "Sunday" };
function repeatText(r) {
  if (!r) return "Repeats";
  const p = Object.fromEntries(String(r).split(";").map(x => x.split("=")));
  const f = { DAILY: ["day", "daily"], WEEKLY: ["week", "weekly"], MONTHLY: ["month", "monthly"], YEARLY: ["year", "yearly"] }[p.FREQ];
  if (!f) return "Repeats";
  const n = +p.INTERVAL || 1;
  let t = n === 1 ? "Repeats " + f[1] : `Repeats every ${n} ${f[0]}s`;
  if (p.FREQ === "WEEKLY" && p.BYDAY) {
    const ds = p.BYDAY.split(",").map(x => BYDAY[x.slice(-2)]).filter(Boolean);
    t += ds.length === 5 && !ds.includes("Saturday") && !ds.includes("Sunday") ? " on weekdays" : ds.length ? " on " + ds.join(", ") : "";
  }
  if (p.UNTIL && /^\d{8}/.test(p.UNTIL)) t += " until " + new Date(+p.UNTIL.slice(0, 4), +p.UNTIL.slice(4, 6) - 1, +p.UNTIL.slice(6, 8)).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  else if (p.COUNT) t += `, ${p.COUNT} times`;
  return t;
}
const ANSWER = { 1: "Accepted", 2: "Declined", 3: "No answer yet", 4: "Tentative", 0: "" };
const online = s => /teams meeting|microsoft teams|zoom|google meet|webex|online|^https?:/i.test(s || "");
// The notes as plain text (invitations often come as HTML, read inertly here), with their links tappable.
function noteHtml(s) {
  s = String(s || "");
  if (/<\/?(p|div|br|span|a|table|html|body|font|b|i)\b/i.test(s)) {
    s = s.replace(/<br\s*\/?>/gi, "\n").replace(/<\/(p|div|tr|li|h[1-6]|table)>/gi, "\n");
    s = new DOMParser().parseFromString(s, "text/html").body.textContent || "";
  }
  s = s.replace(/<(https?:\/\/[^\s<>]+)>/g, "$1").replace(/\r/g, "").replace(/^[ \t]*[_\-=.~*]{6,}[ \t]*$/gm, "").replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  return esc(s).replace(/https?:\/\/[^\s<>"']+/g, all => {
    const m = /^(.*?)((?:&quot;|&#39;|&gt;|&lt;|&amp;|[.,;:!?)\]])*)$/.exec(all), u = m[1];
    return `<button type="button" class="clink" data-url="${u}">${u.length > 52 ? u.slice(0, 48) + "…" : u}</button>${m[2]}`;
  });
}
function rsvpHtml(ev, c, d) {
  if (ev.w || !ev.att || !c || c.access < 300 || ev.st === 2 || !CAL.write) return "";
  const me = String(c.owner || "").toLowerCase();
  if (me && String(ev.org || "").toLowerCase() === me) return `<p class="note">You organized this.</p>`;
  if (d && Array.isArray(d.att) && d.att.length && !d.att.some(a => String(a.e || "").toLowerCase() === me)) return "";
  const said = { 1: "You accepted.", 4: "You said tentative.", 2: "You declined.", 3: "You haven't answered yet." }[ev.me] || "";
  return `<div class="crsvp"><div class="seg" id="e-rsvp" role="group" aria-label="Your answer">${[[1, "Accept"], [4, "Tentative"], [2, "Decline"]]
      .map(([s, l]) => `<button type="button" data-s="${s}" aria-pressed="${ev.me === s}">${l}</button>`).join("")}</div>`
    + (ev.rr ? `<div class="seg" id="e-one" role="group" aria-label="Answer for"><button type="button" data-o="1" aria-pressed="true">This event</button><button type="button" data-o="0" aria-pressed="false">Every event</button></div>` : "")
    + `<p class="note" id="e-said">${esc(said)}</p></div>`;
}
function peopleHtml(ev, c, d) {
  if (!d || !Array.isArray(d.att) || !d.att.length) return d && d.org ? `<dl><dt>Organizer</dt><dd>${esc(d.org)}</dd></dl>` : "";
  const me = c ? String(c.owner || "").toLowerCase() : "";
  const rank = a => a.r === 2 ? 0 : a.s === 1 ? 1 : a.s === 4 ? 2 : a.s === 2 ? 4 : 3;
  const people = d.att.filter(a => a.ty !== 3).sort((x, y) => rank(x) - rank(y) || String(x.n || x.e).localeCompare(String(y.n || y.e)));
  const rooms = d.att.filter(a => a.ty === 3).map(a => a.n || a.e);
  const count = s => people.filter(a => a.r !== 2 && a.s === s).length;
  const sum = [`${people.length} ${people.length === 1 ? "person" : "people"}`, count(1) && `${count(1)} accepted`, count(4) && `${count(4)} tentative`,
    count(2) && `${count(2)} declined`, (count(3) + count(0)) && `${count(3) + count(0)} no answer`].filter(Boolean).join(" · ");
  const li = a => `<li><span class="nm">${esc(a.n || a.e)}${me && String(a.e || "").toLowerCase() === me ? " (you)" : ""}</span><span class="st">${esc(a.r === 2 ? "Organizer" : ANSWER[a.s] || "")}</span></li>`;
  return `<div class="cpeople"><h4>People</h4><p class="note">${esc(sum)}</p><ul>${people.slice(0, 8).map(li).join("")}</ul>`
    + (people.length > 8 ? `<ul id="e-more" hidden>${people.slice(8).map(li).join("")}</ul><button type="button" class="btn" id="e-all">Show all ${people.length}</button>` : "")
    + (rooms.length ? `<p class="note">Room: ${esc(rooms.join(", "))}</p>` : "") + `</div>`;
}
function eventHtml(ev, d) {
  const c = calOf(ev), [w1, w2] = whenText(ev), st = evState(ev);
  const tz = d && d.tz && !ev.ad && d.tz !== Intl.DateTimeFormat().resolvedOptions().timeZone && d.tz !== "UTC" ? d.tz.replace(/_/g, " ") : "";
  const notes = d && d.desc ? noteHtml(d.desc) : "";
  return `<div class="chip cchip"><i style="background:${evColor(ev)}"></i>${esc(c ? calName(c) : "Calendar")}${c && !c.work ? " · " + esc(c.account || c.app) : ""}</div>
    <h2 class="${st}">${ev.st === 2 ? "Canceled: " : ""}${esc(ev.t || "(No title)")}</h2>
    <div class="cwhen"><b>${esc(w1)}</b><span>${esc(w2)}</span>${ev.rr ? `<span>${esc(repeatText(d && d.rrule))}</span>` : ""}${tz ? `<span>Set in ${esc(tz)} time</span>` : ""}</div>
    ${ev.join && ev.st !== 2 ? `<div class="row"><button type="button" class="btn primary" id="e-join">Join ${esc(ev.jl || "the")} meeting</button></div>` : ""}
    ${ev.loc ? `<button type="button" class="cplace" id="e-loc"${online(ev.loc) && !/^https?:/i.test(ev.loc) ? " disabled" : ""}><small>Where</small>${esc(ev.loc)}</button>` : ""}
    ${rsvpHtml(ev, c, d)}${peopleHtml(ev, c, d)}
    ${notes ? `<div class="cnotes" id="e-notes"><h4>Notes</h4><div class="tx">${notes}</div>${notes.length > 900 ? `<button type="button" class="btn" id="e-notesall">Show all</button>` : ""}</div>` : ""}
    <div class="row">${ev.w ? `<button type="button" class="btn" id="e-work">Open in the work profile</button>`
      : `<button type="button" class="btn" id="e-open">Open in the calendar app</button>${CAL.write && c && c.access >= 500 ? `<button type="button" class="btn" id="e-edit">Edit</button>` : ""}`}</div>
    ${ev.w ? `<p class="note">The work profile shares the times, titles and places of its events; the rest stays there.</p>` : ""}`;
}
function joinMeeting(ev) { haptic("tick"); fire("cal.go", { url: ev.join }); }
function wireEvent(P, ev) {
  const on = (id, f) => { const b = P.querySelector(id); if (b) b.onclick = f; };
  on("#e-join", () => joinMeeting(ev));
  on("#e-loc", () => fire("cal.go", /^https?:/i.test(ev.loc) ? { url: ev.loc } : { place: ev.loc }));
  on("#e-open", () => fire("cal.open", { kind: "view", id: ev.id, begin: ev.b, end: ev.e }));
  on("#e-edit", () => fire("cal.open", { kind: "edit", id: ev.id, begin: ev.b, end: ev.e }));
  on("#e-work", () => fire("cal.open", { kind: "work", id: ev.id, begin: ev.b, end: ev.e, allDay: !!ev.ad }));
  on("#e-all", () => { P.querySelector("#e-more").hidden = false; P.querySelector("#e-all").remove(); });
  on("#e-notesall", () => { P.querySelector("#e-notes").classList.add("all"); P.querySelector("#e-notesall").remove(); });
  P.querySelectorAll(".clink").forEach(b => b.onclick = () => fire("cal.go", { url: b.dataset.url }));
  P.querySelectorAll("#e-one button").forEach(b => b.onclick = () => setSeg("#e-one", "o", b.dataset.o));
  P.querySelectorAll("#e-rsvp button").forEach(b => b.onclick = async () => {
    const s = +b.dataset.s, oneB = P.querySelector('#e-one [aria-pressed="true"]'), one = !!ev.rr && (!oneB || oneB.dataset.o === "1"), n = P.querySelector("#e-said");
    try {
      const ok = await native("cal.respond", { id: ev.id, begin: ev.b, status: s, one });
      if (!ok) { n.textContent = "Couldn't answer from here: open it in the calendar app."; return; }
      haptic("tick"); ev.me = s; setSeg("#e-rsvp", "s", String(s));
      n.textContent = { 1: "Accepted.", 4: "Tentative.", 2: "Declined." }[s] + " Your calendar's app sends the answer when it syncs.";
      calIndex(); renderCal(false); setTimeout(loadCal, 1600);
    } catch (e) { n.textContent = "Couldn't answer: " + e.message; }
  });
}
async function eventSheet(ev) {
  CAL.detail = ev;
  openSheet(eventHtml(ev, null), P => wireEvent(P, ev));
  if (ev.w) return;
  try {
    const d = await native("cal.event", { id: ev.id });
    if (CAL.detail !== ev || !document.body.classList.contains("sheeton")) return;
    const y = $("#sheet").scrollTop;
    openSheet(eventHtml(ev, d), P => wireEvent(P, ev));
    $("#sheet").scrollTop = y;
  } catch (e) { /* the summary stays */ }
}

// ---- Calendars: every calendar on the phone by account; tap to show or hide it here, hold for its color ---------------
function calsSheet(keep) {
  const y = keep ? $("#sheet").scrollTop : 0;
  const groups = new Map();
  for (const c of CAL.cals) {
    const g = c.work ? "Work profile\u0000" : (c.app || "") + "\u0000" + (c.account || "");
    if (!groups.has(g)) groups.set(g, []);
    groups.get(g).push(c);
  }
  const order = [...groups.keys()].sort((a, b) => (a.startsWith("Work profile") - b.startsWith("Work profile")) || a.localeCompare(b));
  const row = c => {
    const k = calPref(c), off = !calOn(c), on = calShown(c);
    return `<button type="button" class="ccal${on ? " on" : ""}${off ? " off" : ""}" data-ck="${esc(k)}" style="--cc:${calColor(c)}"><i class="sw"></i>`
      + `<span class="nm">${esc(calName(c))}</span><span class="st">${off ? (CAL.write && !c.work ? "Turn on" : "Off on the phone") : on ? "Shown" : "Hidden"}</span></button>`;
  };
  let h = `<div class="chip">Calendars</div><h2>Your calendars</h2>
    <p class="note">Every calendar on this phone, by account. Tap one to show or hide it here, hold it to pick its color. Your calendar apps stay as they are.</p>`;
  for (const g of order) {
    const [app, acct] = g.split("\u0000"), list = groups.get(g).sort((a, b) => (b.primary - a.primary) || calName(a).localeCompare(calName(b)));
    h += `<div class="cacct"><h4>${esc(app)}${acct ? ` <span>${esc(acct)}</span>` : ""}</h4>${list.map(row).join("")}</div>`;
  }
  if (!CAL.cals.length) h += `<p class="note">No calendars on this phone yet.</p>`;
  h += `<div class="opt"><h4>Declined events</h4><div class="seg" id="cs-dec"><button type="button" data-d="0" aria-pressed="${!CAL.declined}">Hide</button><button type="button" data-d="1" aria-pressed="${CAL.declined}">Show</button></div></div>
    <div class="opt"><h4>A calendar missing?</h4><p class="note">Calendars come from the accounts on this phone. For Outlook: open Outlook, Settings, tap the account and turn on Sync calendars; do it for each account. For Google or Exchange: add the account in Android's Settings, Passwords and accounts.</p>
    ${CAL.workProfile && !CAL.cals.some(c => c.work) ? `<p class="note">Your work profile keeps its calendar to itself: Android shows it here only when your company lets personal apps see it.</p>` : ""}
    <div class="row"><button type="button" class="btn" id="cs-sync">Sync now</button><button type="button" class="btn" id="cs-app">Open the calendar app</button></div></div>`;
  openSheet(h, P => {
    $("#sheet").scrollTop = y;
    P.querySelectorAll(".ccal").forEach(b => {
      const c = CAL.cals.find(x => calPref(x) === b.dataset.ck); if (!c) return;
      pressable(b, async () => {
        if (!calOn(c)) {
          if (!CAL.write || c.work) { toast("Turn it on in the calendar app"); return; }
          try { await native("cal.show", { id: c.id }); c.visible = c.sync = true; toast(`${calName(c)} is on: its events come with the next sync`); setTimeout(loadCal, 2500); }
          catch (e) { toast("Couldn't turn it on: " + e.message); return; }
        } else {
          const k = calPref(c), i = CAL.hide.indexOf(k);
          if (i >= 0) CAL.hide.splice(i, 1); else CAL.hide.push(k);
          saveCal();
        }
        haptic("tick"); calIndex(); renderCal(false); calsSheet(true);
      }, () => colorSheet(c));
    });
    P.querySelectorAll("#cs-dec button").forEach(b => b.onclick = () => { CAL.declined = b.dataset.d === "1"; saveCal(); haptic("tick"); setSeg("#cs-dec", "d", b.dataset.d); calIndex(); renderCal(false); });
    P.querySelector("#cs-sync").onclick = async () => { try { const n = await native("cal.sync"); toast(n ? "Syncing your calendars" : "Nothing to sync"); setTimeout(loadCal, 4000); } catch (e) { toast("Couldn't sync: " + e.message); } };
    P.querySelector("#cs-app").onclick = () => fire("cal.open", { kind: "day", at: dateOf(CAL.sel || todayJd()).getTime() + 9 * 3600e3 });
  });
}
function colorSheet(c) {
  const k = calPref(c), cur = CAL.colors[k] || "";
  const sw = (key, label, bg) => `<button type="button" class="csw${cur === key ? " on" : ""}" data-col="${key}" aria-label="${esc(label)}" style="background:${bg}"></button>`;
  openSheet(`<div class="chip">Color</div><h2>${esc(calName(c))}</h2>
    <div class="cswatches">${sw("", "Its own color", tone(c.color))}${Object.keys(NAMED).map(n => sw(n, n, tone("", n))).join("")}</div>
    <p class="note">The first is the calendar's own color, at the launcher's brightness.</p>
    <div class="row"><button type="button" class="btn" id="cc-back">Back to Calendars</button></div>`, P => {
    P.querySelectorAll("[data-col]").forEach(b => b.onclick = () => {
      if (b.dataset.col) CAL.colors[k] = b.dataset.col; else delete CAL.colors[k];
      saveCal(); haptic("tick"); calIndex(); renderCal(false); calsSheet();
    });
    P.querySelector("#cc-back").onclick = () => calsSheet();
  });
}

// ---- a new event, the way Outlook asks for one: title, calendar, all day, start, end, place, notes, a reminder ----------
const isoDay = d => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
const isoTime = d => `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
const fromInputs = (day, time) => { const [y, m, d] = String(day).split("-").map(Number), [h, mi] = String(time || "00:00").split(":").map(Number); return new Date(y, m - 1, d, h || 0, mi || 0).getTime(); };
function newEvent(jd, min) {
  const writable = CAL.cals.filter(calWritable);
  if (CAL.allowed === false || !CAL.write) { fire("cal.allow"); toast("Allow the calendar first"); return; }
  if (!writable.length) {
    openSheet(`<div class="chip">New event</div><h2>No calendar here takes new events</h2><p class="note">Add it in the calendar app instead.</p>
      <div class="row"><button type="button" class="btn primary" id="n-app">Open the calendar app</button></div>`,
      P => { P.querySelector("#n-app").onclick = () => { closeSheet(); fire("cal.open", { kind: "insert" }); }; });
    return;
  }
  jd = jd || CAL.sel || todayJd();
  const now = new Date();
  if (min == null) min = jd === todayJd() ? Math.min(23 * 60, Math.ceil((now.getHours() * 60 + now.getMinutes() + 1) / 30) * 30) : 9 * 60;
  const d0 = dateOf(jd), start = new Date(d0.getFullYear(), d0.getMonth(), d0.getDate(), 0, min), end = new Date(start.getTime() + 3600e3);
  const pick = writable.find(c => calPref(c) === CAL.def) || writable.find(c => c.primary && c.type === "com.google") || writable.find(c => c.primary) || writable[0];
  const opts = writable.map(c => `<option value="${esc(calPref(c))}"${c === pick ? " selected" : ""}>${esc(calName(c) + " · " + (c.account || c.app))}</option>`).join("");
  const REM = [[-1, "None"], [0, "At the start"], [5, "5 minutes before"], [10, "10 minutes before"], [15, "15 minutes before"], [30, "30 minutes before"], [60, "1 hour before"], [1440, "1 day before"]];
  openSheet(`<div class="chip">New event</div>
    <div class="cform">
      <input type="text" class="t" id="n-title" placeholder="Title" autocomplete="off" enterkeyhint="done">
      <label>Calendar<select id="n-cal">${opts}</select></label>
      <label class="ccheck"><input type="checkbox" id="n-all"> All day</label>
      <label>Starts<span class="two"><input type="date" id="n-sd" value="${isoDay(start)}"><input type="time" id="n-st" value="${isoTime(start)}"></span></label>
      <label>Ends<span class="two"><input type="date" id="n-ed" value="${isoDay(end)}"><input type="time" id="n-et" value="${isoTime(end)}"></span></label>
      <input type="text" id="n-loc" placeholder="Location" autocomplete="off">
      <textarea id="n-notes" placeholder="Notes"></textarea>
      <label>Reminder<select id="n-rem">${REM.map(([m, l]) => `<option value="${m}"${m === 15 ? " selected" : ""}>${l}</option>`).join("")}</select></label>
      <p class="note err" id="n-err" hidden></p>
      <div class="row"><button type="button" class="btn primary" id="n-save">Save</button><button type="button" class="btn" id="n-more">More options in the calendar app</button></div>
    </div>`, P => {
    const q = s => P.querySelector(s), all = q("#n-all");
    let dur = 3600e3;
    const span = () => ({ b: fromInputs(q("#n-sd").value, all.checked ? "00:00" : q("#n-st").value), e: fromInputs(q("#n-ed").value, all.checked ? "00:00" : q("#n-et").value) });
    const moved = () => {                                               // the end keeps its distance from the start, as in Outlook
      const b = fromInputs(q("#n-sd").value, q("#n-st").value), e = new Date(b + dur);
      q("#n-ed").value = isoDay(e); q("#n-et").value = isoTime(e);
    };
    q("#n-sd").onchange = moved; q("#n-st").onchange = moved;
    const ended = () => { const s = span(); if (s.e > s.b) dur = s.e - s.b; };
    q("#n-ed").onchange = ended; q("#n-et").onchange = ended;
    all.onchange = () => {
      q("#n-st").hidden = q("#n-et").hidden = all.checked;
      if (all.checked && q("#n-rem").value === "15") q("#n-rem").value = "-1";
    };
    const args = () => {
      const s = span(), c = writable.find(x => calPref(x) === q("#n-cal").value) || pick;
      return { c, a: { cal: c.id, title: q("#n-title").value.trim(), loc: q("#n-loc").value.trim(), notes: q("#n-notes").value.trim(), allDay: all.checked,
        begin: s.b, end: all.checked ? fromInputs(q("#n-ed").value, "00:00") + DAY : s.e, startDate: q("#n-sd").value, endDate: q("#n-ed").value, remind: +q("#n-rem").value } };
    };
    q("#n-save").onclick = async () => {
      const { c, a } = args(), err = q("#n-err");
      if (!a.startDate || !a.endDate) { err.hidden = false; err.textContent = "Pick a day."; return; }
      if (a.allDay ? a.endDate < a.startDate : a.end <= a.begin) { err.hidden = false; err.textContent = "It ends before it starts."; return; }
      q("#n-save").disabled = true;
      try {
        await native("cal.create", a);
        CAL.def = calPref(c); saveCal(); closeSheet(); haptic("tick"); toast(`Added to ${calLabel(c)}`);
        CAL.sel = jdOf(new Date(a.begin)); calRange(weekStart(CAL.sel) - 7, CAL.sel + 14); loadCal(); renderCal(true);
      } catch (e) { q("#n-save").disabled = false; err.hidden = false; err.textContent = "Couldn't add it: " + e.message; }
    };
    q("#n-more").onclick = () => { const { a } = args(); closeSheet(); fire("cal.open", { kind: "insert", begin: a.begin, end: a.end, allDay: a.allDay, title: a.title, loc: a.loc, notes: a.notes }); };
    setTimeout(() => q("#n-title").focus(), 250);
  });
}

// ---- taps, and the swipes inside the calendar ---------------------------------------------------------------------------
$("#c-title").onclick = () => { haptic("tick"); closeCal(); };      // the name on the left goes back Home, as everywhere
$("#c-title").onkeydown = e => { if (e.key === "Enter") closeCal(); };
$("#c-today").onclick = calToday;
$$("#c-views button").forEach(b => b.onclick = () => { CAL.view = b.dataset.v; saveCal(); haptic("tick"); renderCal(true); });
$("#c-cals").onclick = () => calsSheet();
$("#c-new").onclick = () => newEvent(CAL.sel);
$("#c-strip").addEventListener("click", e => {
  const b = e.target.closest("[data-sjd]"); if (!b) return;
  CAL.sel = +b.dataset.sjd; haptic("tick"); renderCal(true);
});
$("#c-body").addEventListener("click", e => {
  const t = e.target;
  const j = t.closest("[data-join]"); if (j) { const ev = CAL.events[+j.dataset.join]; if (ev) joinMeeting(ev); return; }
  const r = t.closest("[data-ev]"); if (r) { const ev = CAL.events[+r.dataset.ev]; if (ev) eventSheet(ev); return; }
  const m = t.closest("[data-mjd]"); if (m) { CAL.sel = +m.dataset.mjd; haptic("tick"); renderCal(false); return; }
  const more = t.closest("[data-day]"); if (more) { CAL.sel = +more.dataset.day; CAL.view = "agenda"; saveCal(); renderCal(true); return; }
  const a = t.closest("[data-act]"); if (a && a.dataset.act === "allow") { fire("cal.allow"); return; }
  const col = t.closest(".cgcol");
  if (col) {                                                         // an empty hour: a new event there, on the half hour
    const y = e.clientY - col.getBoundingClientRect().top;
    newEvent(+col.dataset.jd, Math.max(0, Math.min(23 * 60 + 30, Math.floor(y / HOUR * 2) * 30)));
  }
});
$("#c-body").addEventListener("scroll", () => { cancelAnimationFrame(calRAF); calRAF = requestAnimationFrame(calScrolled); }, { passive: true });
// Sideways inside: on the week, a week; on the hours, the next days; on the month, a month. A quick, mostly sideways swipe.
function sideSwipe(el, test, go) {
  let s = null;
  el.addEventListener("touchstart", e => {
    const t = e.touches[0];
    s = e.touches.length === 1 && test(e.target) ? { x: t.clientX, y: t.clientY, at: Date.now() } : null;
  }, { passive: true });
  el.addEventListener("touchend", e => {
    const t = s; s = null;
    if (!t) return;
    const c = e.changedTouches[0], dx = c.clientX - t.x, dy = c.clientY - t.y;
    if (Math.abs(dx) < 48 || Math.abs(dy) > Math.abs(dx) * .7 || Date.now() - t.at > 900) return;
    CAL.gestureAt = Date.now(); haptic("tick"); go(dx < 0 ? 1 : -1);
  }, { passive: true });
  el.addEventListener("touchcancel", () => { s = null; }, { passive: true });
}
sideSwipe($("#c-strip"), () => true, dir => calStep(dir, 7));
sideSwipe($("#c-body"), t => !!(t.closest && t.closest(".ctime, .cmonth")), dir => { if (CAL.view === "month") calStepMonth(dir); else calStep(dir, CAL.view === "3day" ? 3 : 1); });
// The swipes in and out: right on Home pulls the calendar in from the left with the finger, left on it (outside the week,
// the hours and the month, which swipe on their own) pushes it away. Past a fifth of the screen, or with a flick, it
// goes the rest of the way; otherwise it springs back.
(function swipeCal() {
  const panel = $("#cal");
  let g = null;
  document.addEventListener("touchstart", e => {
    g = null;
    if (e.touches.length !== 1) return;
    const t = e.touches[0], el = e.target && e.target.closest ? e.target : null;
    if (!el) return;
    const sheet = document.body.classList.contains("sheeton");
    if (!CAL.open) {
      if (L.screen !== "home" || L.q || dialOpen() || sheet || PR.open || !el.closest("#home") || el.closest("#hub")) return;
      g = { opening: true, x: t.clientX, y: t.clientY, at: Date.now(), on: false };
    } else if (!sheet && el.closest("#cal") && !el.closest("#c-strip, .ctime, .cmonth, input, select, textarea"))
      g = { opening: false, x: t.clientX, y: t.clientY, at: Date.now(), on: false };
  }, { passive: true });
  document.addEventListener("touchmove", e => {
    if (!g) return;
    const t = e.touches[0], dx = t.clientX - g.x, dy = t.clientY - g.y;
    if (!g.on) {
      if (Math.abs(dy) > 12 && Math.abs(dy) > Math.abs(dx)) { g = null; return; }      // up or down: the page's own, or the Claude panel
      if (Math.abs(dx) < 10) return;
      if (g.opening ? dx < 0 : dx > 0) { g = null; return; }                           // the other way
      g.on = true; g.w = innerWidth; CAL.gestureAt = Date.now(); clearTimeout(CAL.hideT);
      panel.classList.remove("anim");
      if (g.opening) { panel.style.transform = `translateX(${-g.w}px)`; panel.hidden = false; if (!CAL.shown) calShow(); }
    }
    e.preventDefault();
    panel.style.transform = `translateX(${Math.min(0, g.opening ? dx - g.w : dx)}px)`;
  }, { passive: false });
  const end = (e, cancel) => {
    const s = g; g = null;
    if (!s || !s.on) return;
    CAL.gestureAt = Date.now();
    const c = e.changedTouches && e.changedTouches[0], dx = c ? c.clientX - s.x : 0, v = dx / Math.max(1, Date.now() - s.at);
    const go = !cancel && (s.opening ? (dx > s.w * .2 || v > .45) : (-dx > s.w * .2 || v < -.45));
    if (s.opening === go) openCal(); else closeCal();
  };
  document.addEventListener("touchend", e => end(e, false), { passive: true });
  document.addEventListener("touchcancel", e => end(e, true), { passive: true });
})();

// ---- Home Assistant (1.6.2): swipe left on Home opens the Home Assistant app -----------------------------------------
// Straight from Home to the app, with nothing in between (1.6.1 brought a tile in with the finger first). Let go past a
// fifth of the screen, or with a flick, and the app opens with Android's own animation; a shorter pull does nothing.
const HA_PKG = /^io\.homeassistant\.companion\.android(\.minimal)?$/;            // the Play Store app, or the minimal one
const haApp = () => L.apps.filter(a => HA_PKG.test(a.pkg)).sort((x, y) => (x.work ? 1 : 0) - (y.work ? 1 : 0))[0]
  || L.apps.find(a => /^home assistant$/i.test(a.label));
function openHA() {
  const a = haApp();
  if (!a) { haptic("long"); toast("Home Assistant isn't on this phone"); return; }
  haptic("tick"); launch(a);
}
(function swipeHA() {
  let g = null;
  document.addEventListener("touchstart", e => {
    g = null;
    if (e.touches.length !== 1 || CAL.open || PR.open) return;
    const t = e.touches[0], el = e.target && e.target.closest ? e.target : null;
    if (!el || L.screen !== "home" || L.q || dialOpen() || document.body.classList.contains("sheeton") || !el.closest("#home") || el.closest("#hub")) return;
    g = { x: t.clientX, y: t.clientY, at: Date.now(), on: false };
  }, { passive: true });
  document.addEventListener("touchmove", e => {
    if (!g) return;
    const t = e.touches[0], dx = t.clientX - g.x, dy = t.clientY - g.y;
    if (!g.on) {
      if (Math.abs(dy) > 12 && Math.abs(dy) > Math.abs(dx)) { g = null; return; }      // up or down: the Claude panel
      if (Math.abs(dx) < 10) return;
      if (dx > 0) { g = null; return; }                                                 // to the right: the calendar
      g.on = true; g.w = innerWidth;
    }
    e.preventDefault();                                                                 // Home stays still under the finger
  }, { passive: false });
  const end = (e, cancel) => {
    const s = g; g = null;
    if (!s || !s.on || cancel) return;
    const c = e.changedTouches && e.changedTouches[0], dx = c ? c.clientX - s.x : 0, v = dx / Math.max(1, Date.now() - s.at);
    if (-dx > s.w * .2 || v < -.45) openHA();
  };
  document.addEventListener("touchend", e => end(e, false), { passive: true });
  document.addEventListener("touchcancel", e => end(e, true), { passive: true });
})();

// ---- wiring --------------------------------------------------------------------------------------------
$("#box-apps").onclick = openApps;
$("#box-files").onclick = openFilesView;
$("#title").onclick = () => { haptic("tick"); goHome(); };                // the name on the left: back Home
$("#title").onkeydown = e => { if (e.key === "Enter") goHome(); };
$$("#views button").forEach(b => b.onclick = () => { L.view = b.dataset.v; L.tz = null; resetMZ(); setSeg("#views", "v", L.view); savePref("view", L.view); renderApps(); });
$$("#metric button").forEach(b => b.onclick = () => { L.metric = b.dataset.m; resetMZ(); setSeg("#metric", "m", L.metric); savePref("metric", L.metric); renderApps(); });
pressable($("#tonebtn"), () => show("settings"), () => flipScheme($("#tonebtn")));   // the circle by the search: Settings; hold: black or ivory
let rt = 0;
window.addEventListener("resize", () => { clearTimeout(rt); rt = setTimeout(() => { if (dialOpen()) placeDial(); if (L.screen !== "settings") refreshScreen(); if (PR.open) renderProcs(); if (CAL.open) renderCal(false); }, 120); });

(async function start() {
  applyTheme();
  await loadRules();
  await loadPrefs();
  if (theme().mode === "sun") await loadPlace();
  applyOrder(); applyTheme();
  await Promise.allSettled([loadApps(), loadFiles()]);
  classifyAll();
  lastRefresh = Date.now();
  show("home");
  fire("ready");
})();
