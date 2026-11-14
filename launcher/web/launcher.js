// Atlas launcher: the phone's home screen. A frame like Atlas, two boxes (Apps and Files), and a circle on the line
// between them that opens the dial while you hold it. Apps open as an Atlas map of every app on the phone;
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
  cats: [], states: ["Current", "Superseded", "Working"],
  pins: { apps: [], files: [] }, over: {}, order: "apps-top", tone: "red",
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
const savePref = (key, value) => fire("prefs.set", { key, value });

// Android tells the page about the world through window.onLauncherEvent.
window.onLauncherEvent = ev => {
  if (!ev) return;
  if (ev.type === "home") return goHome();
  if (ev.type === "apps") return loadApps().then(refreshScreen);
  if (ev.type === "pins") return loadPrefs().then(() => { if (dialOpen()) openDial(); });
  if (ev.type === "resume") return refresh();
  if (ev.type === "paired") return loadFiles().then(refreshScreen);
};
// Back: true when this page used it (closing the dial, a sheet, a search, zooming out, leaving the Apps map).
window.launcherBack = () => {
  if (dialOpen()) { closeDial(); return true; }
  if (document.body.classList.contains("sheeton")) { closeSheet(); return true; }
  if (!$("#tones").hidden) { closeTones(); return true; }
  if (L.q) { clearSearch(); return true; }
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
    if (p.tone) L.tone = p.tone;
    if (Array.isArray(p.cats) && p.cats.length && !L.cats.length) L.cats = p.cats;
  } catch (e) { /* first run */ }
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
    if (Array.isArray(d.categories) && d.categories.length) { L.cats = d.categories; savePref("cats", L.cats); }
    L.filesErr = "";
  } catch (e) { L.filesErr = e.message || "can't reach Atlas"; }
  try { const s = await server("/settings"); if (s.tone && s.tone !== L.tone) { L.tone = s.tone; applyTone(s.tone); savePref("tone", s.tone); } } catch (e) {}
  if (!L.cats.length) L.cats = Object.values(RULES.categories || {});
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
  if (L.screen === "apps") {
    $("#meta").innerHTML = `<b>${fmtN(n)}</b> apps` + (L.usage || used ? ` · <b>${fmtN(used)}</b> used in 30 days` : "") + ` · ${L.usage ? "use from Android" : "no usage data"}`;
    return;
  }
  $("#meta").innerHTML = `<b>${fmtN(n)}</b> apps` + (L.files ? ` · <b>${fmtN(L.files.total_files)}</b> files · <b>${fmtGB(L.files.total_gb)}</b>` : "");
}
const TONES = [["red", "Red", 27, .17], ["orange", "Orange", 48, .15], ["amber", "Amber", 78, .13], ["green", "Green", 150, .13],
  ["teal", "Teal", 195, .11], ["blue", "Blue", 255, .15], ["violet", "Violet", 295, .15], ["graphite", "Graphite", 255, .02]];
function applyTone(k) {
  const t = TONES.find(x => x[0] === k) || TONES[0], r = document.documentElement.style;
  r.setProperty("--h", t[2]); r.setProperty("--c", t[3]); L.tone = t[0];
  $$("#tones button, .swatches button").forEach(b => b.setAttribute("aria-pressed", String(b.dataset.k === t[0])));
}
function setTone(k) {
  applyTone(k); savePref("tone", k);
  fire("serverPost", { path: "/settings", body: { tone: k } });      // the same tone in Atlas everywhere
}
const swatchHtml = () => TONES.map(t => `<button type="button" data-k="${t[0]}" title="${t[1]}" aria-label="${t[1]} tone" aria-pressed="${t[0] === L.tone}" style="background:oklch(.6 ${t[3]} ${t[2]})"></button>`).join("");
function closeTones() { $("#tones").hidden = true; $("#tonebtn").setAttribute("aria-expanded", "false"); }

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
  $("#home").hidden = screen !== "home"; $("#apps").hidden = screen !== "apps";
  $("#title").textContent = screen === "apps" ? "Apps" : "Atlas";
  $("#homebtn").hidden = screen === "home"; $("#optbtn").hidden = screen !== "home";
  $("#q").placeholder = screen === "apps" ? "Find an app" : "Find an app, folder or file";
  closeSheet(); hideResults(); closeDial(); closeTones();
  if (screen === "apps") { setSeg("#views", "v", L.view); setSeg("#metric", "m", L.metric); renderApps(); crumbs(); }
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
const dialOpen = () => !$("#dial").hidden;
let hot = null;
// Up to 4 names on an inner arc and 6 on an outer one, fanned away from the line so each side stays in its own box.
function spots(n, cx, cy, dir, W) {
  const out = [], rings = [[Math.min(n, 4), 118, 40], [Math.max(0, Math.min(n - 4, 6)), 206, 22]];
  for (const [k, r, step] of rings) for (let i = 0; i < k; i++) {
    const ang = (90 + step * ((k - 1) / 2 - i)) * Math.PI / 180;           // centred on the vertical, filling outwards
    out.push({ x: Math.min(W - 46, Math.max(46, cx + r * Math.cos(ang))), y: cy - dir * r * Math.sin(ang) });
  }
  return out;
}
function openDial() {
  const d = $("#dial"), hub = $("#hub").getBoundingClientRect(), W = window.innerWidth;
  const cx = hub.left + hub.width / 2, cy = hub.top + hub.height / 2;
  const appsUp = L.order !== "files-top";
  const sides = [
    { list: L.pins.apps.slice(0, MAX_PINS), dir: appsUp ? 1 : -1, name: "Apps", empty: "Hold an app anywhere in Atlas to add it here" },
    { list: L.pins.files.slice(0, MAX_PINS), dir: appsUp ? -1 : 1, name: "Files", empty: "Hold a file or folder in Files to add it here" },
  ];
  let html = "";
  for (const s of sides) {
    const ps = spots(s.list.length, cx, cy, s.dir, W);
    s.list.forEach((p, i) => {
      const dx = (cx - ps[i].x).toFixed(1) + "px", dy = (cy - ps[i].y).toFixed(1) + "px";
      html += `<button type="button" class="di" data-side="${s.name}" data-i="${i}" style="left:${ps[i].x.toFixed(1)}px;top:${ps[i].y.toFixed(1)}px;--dx:${dx};--dy:${dy}"><span class="nm">${esc(p.label || p.name)}</span></button>`;
    });
    const edge = cy - s.dir * (s.list.length > 4 ? 250 : s.list.length ? 164 : 70);
    html += `<div class="side" data-say="${s.name}" style="top:${(edge - 8).toFixed(0)}px">${s.name}</div>`;
    if (!s.list.length) html += `<div class="hint" style="top:${(cy - s.dir * 118 - 18).toFixed(0)}px">${esc(s.empty)}</div>`;
  }
  d.innerHTML = html; d.hidden = false;
  requestAnimationFrame(() => requestAnimationFrame(() => d.classList.add("open")));
  $("#hub").classList.add("on"); hot = null;
  $$("#dial .di").forEach(b => pressable(b, () => openPin(pinOf(b)), () => pinSheet(pinOf(b), b.dataset.side)));
}
function pinOf(b) { return (b.dataset.side === "Apps" ? L.pins.apps : L.pins.files)[+b.dataset.i]; }
function closeDial() {
  const d = $("#dial"); if (d.hidden) return;
  d.classList.remove("open"); d.hidden = true; d.innerHTML = ""; $("#hub").classList.remove("on"); hot = null;
}
function setHot(b) {
  if (b === hot) return;
  if (hot) hot.classList.remove("hot");
  hot = b;
  if (b) { b.classList.add("hot"); haptic("tick"); }
}
function openPin(p) {
  if (!p) return;
  closeDial();
  if (p.key) { const a = L.byKey[p.key]; if (a) launch(a); else toast(`${p.label} is no longer on this phone`); }
  else openFile(p.path, p.dir);
}
// The circle: hold it, slide to a pin and let go to open it. Let go anywhere else and the dial stays open for a tap.
(function hubControl() {
  const hub = $("#hub");
  let timer = 0, down = false, held = false;
  hub.addEventListener("pointerdown", e => {
    e.preventDefault(); down = true; held = false;
    try { hub.setPointerCapture(e.pointerId); } catch (x) {}
    clearTimeout(timer);
    timer = setTimeout(() => { held = true; haptic("long"); openDial(); }, 240);
  });
  hub.addEventListener("pointermove", e => {
    if (!down || !held) return;
    let best = null, bd = 44;
    for (const b of $$("#dial .di")) {
      const r = b.getBoundingClientRect(), d = Math.hypot(e.clientX - (r.left + r.width / 2), e.clientY - (r.top + r.height / 2));
      if (d < bd) { bd = d; best = b; }
    }
    setHot(best);
  });
  const end = cancel => {
    clearTimeout(timer);
    if (!down) return;
    down = false;
    if (!held) { if (!cancel) { if (dialOpen()) closeDial(); else { haptic("tick"); openDial(); } } return; }
    if (hot && !cancel) { const p = pinOf(hot); openPin(p); }
    else setHot(null);
  };
  hub.addEventListener("pointerup", () => end(false));
  hub.addEventListener("pointercancel", () => end(true));
  hub.addEventListener("click", e => e.preventDefault());
  $("#dial").addEventListener("click", e => { if (e.target.id === "dial") closeDial(); });
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
  const list = side === "Apps" ? L.pins.apps : L.pins.files, i = list.indexOf(p);
  openSheet(`<div class="chip">Dial · ${esc(side)}</div><h2>${esc(p.label || p.name)}</h2>
    ${p.path ? `<div class="path">${esc(p.path)}</div>` : ""}
    <div class="row"><button type="button" class="btn primary" id="p-open">Open</button>
      ${p.path && !p.dir ? `<button type="button" class="btn" id="p-dir">Open its folder</button>` : ""}
      <button type="button" class="btn" id="p-rm">Remove from dial</button></div>
    <div class="row"><button type="button" class="btn" id="p-l" ${i <= 0 ? "disabled" : ""}>Move earlier</button><button type="button" class="btn" id="p-r" ${i >= list.length - 1 ? "disabled" : ""}>Move later</button></div>`, P => {
    P.querySelector("#p-open").onclick = () => { closeSheet(); openPin(p); };
    if (P.querySelector("#p-dir")) P.querySelector("#p-dir").onclick = () => { closeSheet(); openFile(dirName(p.path), true); };
    P.querySelector("#p-rm").onclick = () => { togglePin(side, p); closeSheet(); };
    const mv = d => { const j = i + d; if (j < 0 || j >= list.length) return; [list[i], list[j]] = [list[j], list[i]]; savePref("pins", L.pins); closeSheet(); openDial(); };
    P.querySelector("#p-l").onclick = () => mv(-1); P.querySelector("#p-r").onclick = () => mv(1);
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
async function optionsSheet() {
  const info = await native("info").catch(() => ({}));
  const signedIn = !!L.files, err = L.filesErr;
  openSheet(`<div class="chip">Options</div><h2>Atlas on this phone</h2>
    <div class="opt"><h4>Color</h4><div class="swatches">${swatchHtml()}</div></div>
    <div class="opt"><h4>Layout</h4><div class="seg" id="o-order"><button type="button" data-o="apps-top" aria-pressed="${L.order !== "files-top"}">Apps on top</button><button type="button" data-o="files-top" aria-pressed="${L.order === "files-top"}">Files on top</button></div></div>
    <div class="opt"><h4>Home screen</h4>${info.isDefault ? `<p class="note">Atlas is your Home screen. To switch back, choose another Home app in Android's settings.</p>`
      : `<p class="note">Atlas isn't your Home screen yet.</p><div class="row"><button type="button" class="btn primary" id="o-home">Make Atlas the Home screen</button></div>`}</div>
    <div class="opt"><h4>Usage</h4>${L.usage ? `<p class="note">Apps are sized by how much you use them, and apps unused for two months move to Superseded.</p>`
      : `<p class="note">Allow usage access and the apps you use most become the biggest tiles, and apps you stopped using move to Superseded. Nothing leaves the phone.</p><div class="row"><button type="button" class="btn" id="o-usage">Allow usage access</button></div>`}</div>
    <div class="opt"><h4>Files</h4><p class="note">${signedIn ? `Signed in to Atlas${L.files.generated ? ", map from " + esc(L.files.generated.replace("T", " ").slice(0, 16)) : ""}.` : err === "not signed in" ? "Not signed in to Atlas yet." : "Can't reach Atlas right now. Check that Tailscale is on."}</p>
      <div class="path">${esc(info.server || "")}</div>
      ${signedIn ? "" : `<label class="note" for="o-code">Pairing code</label><input id="o-code" autocomplete="one-time-code" autocapitalize="off" spellcheck="false"><div class="row"><button type="button" class="btn" id="o-pair">Sign in to Atlas</button></div>`}</div>
    <div class="opt"><h4>Version</h4><p class="note">Atlas launcher ${esc(info.version || "")}</p><div class="row"><button type="button" class="btn" id="o-upd">Check for an update</button></div><p class="note" id="o-updn"></p></div>`, P => {
    P.querySelectorAll(".swatches button").forEach(b => b.onclick = () => setTone(b.dataset.k));
    P.querySelectorAll("#o-order button").forEach(b => b.onclick = () => { L.order = b.dataset.o; savePref("order", L.order); applyOrder(); setSeg("#o-order", "o", L.order); renderHome(); });
    if (P.querySelector("#o-home")) P.querySelector("#o-home").onclick = () => fire("home.request");
    if (P.querySelector("#o-usage")) P.querySelector("#o-usage").onclick = () => fire("usage.request");
    if (P.querySelector("#o-pair")) P.querySelector("#o-pair").onclick = () => { const c = P.querySelector("#o-code").value.trim(); if (c) { fire("pair", { code: c }); closeSheet(); toast("Signing in to Atlas"); } };
    P.querySelector("#o-upd").onclick = async () => {
      const n = P.querySelector("#o-updn"); n.textContent = "Asking Atlas";
      try {
        const u = await native("update.check");
        if (!u.available) { n.textContent = "This is the newest version."; return; }
        n.innerHTML = `Version ${esc(u.version)} is ready${u.notes ? ": " + esc(u.notes) : "."} <button type="button" class="btn primary" id="o-inst">Update</button>`;
        P.querySelector("#o-inst").onclick = () => { n.textContent = "Downloading. Android will ask you to confirm."; fire("update.install"); };
      } catch (e) { n.textContent = "Couldn't check: " + e.message; }
    };
  });
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
function showResults(apps, files, err) {
  const R = $("#results"), top = $("#frame").getBoundingClientRect().bottom;
  R.style.top = top + "px"; R.hidden = false;
  R.innerHTML = `<h3>Apps</h3>` + (apps.length ? apps.map((a, i) => `<button type="button" class="r" data-a="${i}"><span class="t">${esc(a.label)}<small>${esc(a.category)} · ${esc(a.state)}</small></span><span class="num"></span></button>`).join("") : `<p class="none">No app matches.</p>`)
    + `<h3>Files</h3>` + (files === null ? `<p class="none">Searching Atlas</p>` : err ? `<p class="none">${esc(err === "not signed in" ? "Sign in to Atlas to search files." : "Can't reach Atlas right now.")}</p>`
      : files.length ? files.slice(0, 40).map((f, i) => `<button type="button" class="r" data-f="${i}"><span class="t">${esc(f.name)}<small>${esc(dirName(f.path))}</small></span><span class="num">${fmtSize(f.size || 0)}</span></button>`).join("")
      : `<p class="none">${L.q.trim().length < 3 ? "Type three letters to search file names." : "No file matches."}</p>`);
  R.querySelectorAll("[data-a]").forEach(b => { const a = apps[+b.dataset.a]; pressable(b, () => { launch(a, b); }, () => appSheet(a)); });
  R.querySelectorAll("[data-f]").forEach(b => { const f = files[+b.dataset.f]; pressable(b, () => openFile(f.path, false), () => fileSheet(f)); });
}
function hideResults() { const R = $("#results"); R.hidden = true; R.innerHTML = ""; }
function clearSearch() { $("#q").value = ""; L.q = ""; hideResults(); if (L.screen === "apps") { if (L.view === "treemap") applySearch(); else renderApps(); } }
$("#q").addEventListener("input", onSearch);
$("#q").addEventListener("keydown", e => {
  if (e.key !== "Enter") return;
  const q = L.q.trim().toLowerCase(); if (!q) return;
  const first = L.apps.filter(a => matchApp(a, q)).sort(byUse)[0];
  if (first) { $("#q").blur(); launch(first); }
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
function renderTreemap() {
  const map = $("#map"); map.innerHTML = "";
  const W = map.clientWidth, H = map.clientHeight;
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
  const m = metricText(a);
  if (named) t.innerHTML = `<span class="n">${esc(a.label)}</span>` + (m && h >= 40 ? `<span class="v">${esc(m)}</span>` : "");
  pressable(t, () => launch(a, t), () => appSheet(a));
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
  box.addEventListener("pointerdown", e => { pts.set(e.pointerId, at(e)); if (pts.size === 1) moved = 0; pinch = null; clearTimeout(timer); });
  box.addEventListener("pointermove", e => {
    if (!pts.has(e.pointerId)) return;
    const p0 = pts.get(e.pointerId), p1 = at(e); pts.set(e.pointerId, p1);
    if (pts.size === 1) { moved += Math.abs(p1[0] - p0[0]) + Math.abs(p1[1] - p0[1]); if (moved > 8) { T.x += p1[0] - p0[0]; T.y += p1[1] - p0[1]; clamp(); } return; }
    const [a, b] = [...pts.values()], d = Math.hypot(a[0] - b[0], a[1] - b[1]);
    if (pinch) zoomAt(T.k * d / pinch, (a[0] + b[0]) / 2, (a[1] + b[1]) / 2);
    pinch = d; moved = 99;
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
    const c = document.createElementNS(ns, "circle"); c.setAttribute("r", leaf ? 5.5 : R);
    c.setAttribute("class", (leaf ? "a" + age(n.a) : "g") + (closed ? " closed" : ""));
    const t = document.createElementNS(ns, "text"); t.setAttribute("x", 12); t.setAttribute("dy", "0.35em");
    const lab = n.label.length > max ? n.label.slice(0, max - 1) + "…" : n.label;
    const num = leaf ? metricText(n.a) : n.n + " apps";
    t.innerHTML = `${esc(lab)}<tspan class="m" dx="8">${esc(num)}</tspan>`;
    g.append(c, t);
    if (leaf) pressable(g, () => launch(n.a), () => appSheet(n.a)); else g.addEventListener("click", () => toggleNode(n));
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
    T.x = w <= vw ? 0 : Math.min(0, Math.max(vw - w, T.x)); T.y = h <= vh ? 0 : Math.min(0, Math.max(vh - h, T.y));
    g.setAttribute("transform", `translate(${T.x},${T.y}) scale(${T.k})`);
  };
  const zoomAt = (k, cx, cy) => { k = Math.min(MAX, Math.max(fit, k)); T.x = cx - (cx - T.x) * k / T.k; T.y = cy - (cy - T.y) * k / T.k; T.k = k; clamp(); };
  clamp();
  const pts = new Map(); let pinch = null, moved = 0;
  const at = e => { const r = svg.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
  svg.addEventListener("pointerdown", e => { pts.set(e.pointerId, at(e)); if (pts.size === 1) moved = 0; pinch = null; });
  svg.addEventListener("pointermove", e => {
    if (!pts.has(e.pointerId)) return;
    const p0 = pts.get(e.pointerId), p1 = at(e); pts.set(e.pointerId, p1);
    if (pts.size === 1) { T.x += p1[0] - p0[0]; T.y += p1[1] - p0[1]; moved += Math.abs(p1[0] - p0[0]) + Math.abs(p1[1] - p0[1]); clamp(); return; }
    const [a, b] = [...pts.values()], d = Math.hypot(a[0] - b[0], a[1] - b[1]);
    if (pinch) zoomAt(T.k * d / pinch, (a[0] + b[0]) / 2, (a[1] + b[1]) / 2);
    pinch = d; moved = 99;
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
      const r = document.createElement("button"); r.type = "button";
      r.className = "lrow" + (k.type === "state" ? " g1" : k.type === "cat" ? " g2" : "") + (leaf && k.match ? " hit" : "");
      r.innerHTML = `<span class="nm" style="padding-left:${d * 16}px"><span class="car">${k.kids.length ? (open ? "▾" : "▸") : ""}</span><span class="t">${esc(k.label)}</span></span>`
        + `<span class="num">${leaf ? esc(metricText(k.a)) : fmtN(k.n)}</span><span class="num">${leaf && lastUse(k.a) ? esc(ago(lastUse(k.a))) : ""}</span>`;
      if (leaf) pressable(r, () => launch(k.a, r), () => appSheet(k.a)); else r.onclick = () => toggleNode(k);
      box.appendChild(r);
      if (open) walk(k, d + 1);
    }
  };
  walk(root, 0);
  map.appendChild(box);
}

// ---- wiring --------------------------------------------------------------------------------------------
$("#box-apps").onclick = openApps;
$("#box-files").onclick = openFilesView;
$("#homebtn").onclick = goHome;
$("#optbtn").onclick = optionsSheet;
$$("#views button").forEach(b => b.onclick = () => { L.view = b.dataset.v; L.tz = null; resetMZ(); setSeg("#views", "v", L.view); savePref("view", L.view); renderApps(); });
$$("#metric button").forEach(b => b.onclick = () => { L.metric = b.dataset.m; resetMZ(); setSeg("#metric", "m", L.metric); savePref("metric", L.metric); renderApps(); });
$("#tones").innerHTML = swatchHtml();
$$("#tones button").forEach(b => b.onclick = () => { setTone(b.dataset.k); closeTones(); });
$("#tonebtn").onclick = e => { e.stopPropagation(); const t = $("#tones"); t.hidden = !t.hidden; $("#tonebtn").setAttribute("aria-expanded", String(!t.hidden)); };
document.addEventListener("click", e => { if (!$("#tones").hidden && !e.target.closest(".tonebox")) closeTones(); });
let rt = 0;
window.addEventListener("resize", () => { clearTimeout(rt); rt = setTimeout(() => { if (dialOpen()) openDial(); refreshScreen(); }, 120); });

(async function start() {
  applyTone(L.tone);
  await loadRules();
  await loadPrefs();
  applyTone(L.tone); applyOrder();
  await Promise.allSettled([loadApps(), loadFiles()]);
  classifyAll();
  lastRefresh = Date.now();
  show("home");
  fire("ready");
})();
