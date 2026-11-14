// Atlas file browser: browse inside folders, preview (image, video, audio, PDF, 3D, text), tags, rename,
// new folder, copy/cut/paste, delete to the Recycle Bin, download, open on the PC; file search; devices.
// Every action is checked again on the PC (security.py); read-only folders refuse changes there too.
const TAGC = { red: 25, orange: 48, amber: 78, green: 150, teal: 195, blue: 255, violet: 295, graphite: 255 };
const tagColor = c => `oklch(.62 ${c === "graphite" ? .02 : .15} ${TAGC[c] ?? 255})`;
const FB = { dir: null, entries: [], readonly: false, checked: new Set(), focus: null, vocab: {}, msg: "", err: false };
let CLIP = null;
try { CLIP = JSON.parse(localStorage.getItem("atlas.clip") || "null"); } catch (e) { CLIP = null; }
const saveClip = () => { try { localStorage.setItem("atlas.clip", JSON.stringify(CLIP)); } catch (e) {} };
const dirname = p => p.slice(0, p.lastIndexOf("\\")) || p;
const base = p => p.slice(p.lastIndexOf("\\") + 1);
const fileUrl = (p, dl) => "/api/file?" + new URLSearchParams({ path: p, ...(dl ? { dl: "1" } : {}) });
const fmtSize = n => n < 1024 ? n + " B" : n < 1048576 ? (n / 1024).toFixed(0) + " KB" : n < 1073741824 ? (n / 1048576).toFixed(1) + " MB" : (n / 1073741824).toFixed(2) + " GB";
const fmtDate = t => new Date(t * 1000).toISOString().slice(0, 10);
const extOf = n => (n.split(".").pop() || "").toLowerCase();
const api = async (path) => { const r = await fetch(path, { cache: "no-store" }); const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j.error || "failed"); return j; };

function chips(tags, removable) {
  return (tags || []).map(t => `<span class="chipt"><i style="background:${tagColor(FB.vocab[t])}"></i>${esc(t)}${removable ? `<button type="button" data-rm="${esc(t)}" aria-label="Remove ${esc(t)}">×</button>` : ""}</span>`).join("");
}

async function browse(dir, focusPath) {
  try {
    const [d, v] = await Promise.all([api("/api/ls?" + new URLSearchParams({ path: dir })), api("/api/tags")]);
    FB.vocab = v.vocab; S.browse = true;
    document.body.classList.remove("sheet");          // on a phone, the folder's details sheet gives way to its files
    Object.assign(FB, { dir: d.path, entries: d.entries, readonly: d.readonly, parent: d.parent, checked: new Set(), focus: null });
    FB.msg = ""; FB.err = false; render();
    if (focusPath) { const e = FB.entries.find(x => x.path.toLowerCase() === focusPath.toLowerCase()); if (e) focusEntry(e); }
  } catch (e) { FB.msg = "Can't open that folder: " + e.message; FB.err = true; if (S.browse) render(); else alert(FB.msg); }
}

function leaveBrowser() { S.browse = false; render(); }

function selection() {
  const sel = FB.entries.filter(e => FB.checked.has(e.path));
  return sel.length ? sel : (FB.focus ? [FB.focus] : []);
}

function renderBrowser() {
  const map = $("#map"); map.innerHTML = "";
  const parts = FB.dir.split("\\"); let acc = "";
  const crumbs = parts.map((s, i) => { acc = i ? acc + "\\" + s : s; return `<button type="button" data-go="${esc(acc)}">${esc(i ? s : s + "\\")}</button>`; }).join("<span>›</span>");
  const sel = selection(), ro = FB.readonly, one = sel.length === 1, any = sel.length > 0;
  const wrap = document.createElement("div"); wrap.className = "fb";
  wrap.innerHTML = `
    <div class="fb-bar"><button type="button" class="btn" id="fb-back">Back to map</button><nav class="fb-crumbs" aria-label="Folder">${crumbs}</nav></div>
    <div class="fb-tools" role="toolbar" aria-label="File actions">
      <button type="button" data-a="up">Up</button>
      <button type="button" data-a="mkdir" ${ro ? "disabled" : ""}>New folder</button>
      <button type="button" data-a="copy" ${any ? "" : "disabled"}>Copy</button>
      <button type="button" data-a="cut" ${any && !ro ? "" : "disabled"}>Cut</button>
      <button type="button" data-a="paste" ${CLIP && !ro ? "" : "disabled"}>Paste${CLIP ? ` (${CLIP.items.length})` : ""}</button>
      <button type="button" data-a="rename" ${one && !ro ? "" : "disabled"}>Rename</button>
      <button type="button" data-a="tags" ${any ? "" : "disabled"}>Tags</button>
      <button type="button" data-a="delete" ${any && !ro ? "" : "disabled"}>Delete</button>
      <button type="button" data-a="download" ${any && sel.every(e => !e.dir) ? "" : "disabled"}>Download</button>
      ${window.ATLAS_SERVER ? "" : `<button type="button" data-a="openpc" ${one ? "" : "disabled"}>Open on PC</button>`}
      ${ro ? `<span class="ro">Read only</span>` : ""}
    </div>
    <div class="fb-msg ${FB.err ? "err" : ""}" aria-live="polite">${esc(FB.msg || `${FB.entries.length} items`)}</div>
    <div class="fb-list" role="list"></div>`;
  const list = wrap.querySelector(".fb-list"), q = (S.q || "").trim().toLowerCase();
  const shown = q ? FB.entries.filter(e => e.name.toLowerCase().includes(q)) : FB.entries;
  if (q) wrap.querySelector(".fb-msg").textContent = FB.msg || `${shown.length} of ${FB.entries.length} items match “${S.q.trim()}”`;
  for (const e of shown) {
    const r = document.createElement("div"); r.className = "frow" + (FB.focus && FB.focus.path === e.path ? " focus" : ""); r.setAttribute("role", "listitem"); r.tabIndex = 0;
    r.dataset.path = e.path;
    const isImg = e.kind === "image" || e.kind === "image_conv";
    const ic = e.dir ? `<span class="ic folder" aria-hidden="true">▰</span>` : isImg ? `<span class="ic"><img loading="lazy" alt="" src="/api/thumb?${new URLSearchParams({ path: e.path })}"></span>` : `<span class="ic">${esc(extOf(e.name).slice(0, 4))}</span>`;
    r.innerHTML = `<input type="checkbox" aria-label="Select ${esc(e.name)}" ${FB.checked.has(e.path) ? "checked" : ""}>${ic}
      <span class="nm"><span class="t">${esc(e.name)}</span>${chips(e.tags)}${e.cloud ? `<span class="cloud">cloud</span>` : ""}</span>
      <span class="num">${e.dir ? "" : fmtSize(e.size)}</span><span class="num fm">${fmtDate(e.mtime)}</span>`;
    r.querySelector("input").onclick = ev => { ev.stopPropagation(); ev.target.checked ? FB.checked.add(e.path) : FB.checked.delete(e.path); render(); };
    r.onclick = () => e.dir ? browse(e.path) : focusEntry(e);
    r.onkeydown = ev => { if (ev.key === "Enter") r.onclick(); };
    list.appendChild(r);
  }
  if (!shown.length) list.innerHTML = `<p class="note">${FB.entries.length ? "Nothing here matches the search." : "This folder is empty."}</p>`;
  map.appendChild(wrap);
  wrap.querySelector("#fb-back").onclick = leaveBrowser;
  wrap.querySelectorAll("[data-go]").forEach(b => b.onclick = () => browse(b.dataset.go));
  wrap.querySelectorAll("[data-a]").forEach(b => b.onclick = () => act(b.dataset.a));
}

function say(msg, err) { FB.msg = msg; FB.err = !!err; const m = document.querySelector(".fb-msg"); if (m) { m.textContent = msg; m.classList.toggle("err", !!err); } }

async function act(a) {
  const sel = selection();
  try {
    if (a === "up") return browse(FB.parent || FB.dir);
    if (a === "copy" || a === "cut") {
      CLIP = { mode: a === "cut" ? "move" : "copy", items: sel.map(e => e.path) }; saveClip(); render();
      return say(`${sel.length} ${sel.length === 1 ? "item" : "items"} ready to ${a === "cut" ? "move" : "copy"}. Open the folder you want and press Paste.`);
    }
    if (a === "paste") {
      say(CLIP.mode === "move" ? "Moving…" : "Copying…");
      const r = await post("/api/paste", { items: CLIP.items, dest: FB.dir, mode: CLIP.mode });
      if (CLIP.mode === "move") { CLIP = null; saveClip(); }
      await browse(FB.dir); return say(`${r.done.length} pasted.`);
    }
    if (a === "mkdir") {
      const name = prompt("Name of the new folder", "New folder"); if (!name) return;
      const r = await post("/api/mkdir", { dir: FB.dir, name }); return browse(FB.dir, r.path);
    }
    if (a === "rename") {
      const e = sel[0], name = prompt("New name", e.name); if (!name || name === e.name) return;
      const r = await post("/api/rename", { path: e.path, name }); return browse(FB.dir, r.path);
    }
    if (a === "delete") {
      if (!confirm(`Move ${sel.length} ${sel.length === 1 ? "item" : "items"} to the Recycle Bin? You can restore them from there.`)) return;
      const r = await post("/api/delete", { items: sel.map(e => e.path) }); await browse(FB.dir); return say(`${r.deleted} moved to the trash.`);
    }
    if (a === "download") { sel.forEach((e, i) => setTimeout(() => { const l = document.createElement("a"); l.href = fileUrl(e.path, true); l.download = e.name; document.body.appendChild(l); l.click(); l.remove(); }, i * 400)); return; }
    if (a === "openpc") { await post("/api/openpath", { path: sel[0].path }); return say("Opened on the PC."); }
    if (a === "tags") return tagEditor(sel);
  } catch (e) { say(e.message, true); }
}

function focusEntry(e) {
  FB.focus = e;
  document.querySelectorAll(".frow").forEach(x => x.classList.toggle("focus", x.dataset.path === e.path));
  document.querySelectorAll(".fb-tools [data-a]").forEach(b => {
    const a = b.dataset.a, ro = FB.readonly, n = selection().length;
    if (["copy", "tags"].includes(a)) b.disabled = !n;
    if (a === "cut" || a === "delete") b.disabled = !n || ro;
    if (a === "rename") b.disabled = n !== 1 || ro;
    if (a === "openpc") b.disabled = n !== 1;
    if (a === "download") b.disabled = !n || selection().some(x => x.dir);
  });
  preview(e);
}

const VIEWABLE = new Set(["image", "image_conv", "video", "audio", "pdf", "model", "text"]);
const narrow = () => window.innerWidth <= 900;

function preview(e) {
  const p = $("#panel"), can = VIEWABLE.has(e.kind), phone = narrow() && can;
  p.innerHTML = `<div class="chip">${esc(e.kind === "image_conv" ? "image" : e.kind)}</div><h2>${esc(e.name)}</h2>
    ${can ? `<div class="row"><button type="button" class="btn" id="pv-big">${phone ? "View" : "Full screen"}</button></div>` : ""}
    <div class="pv" id="pv"></div>
    <dl><dt>Size</dt><dd>${fmtSize(e.size)}</dd><dt>Changed</dt><dd>${fmtDate(e.mtime)}</dd>${e.cloud ? `<dt>Stored</dt><dd>In the cloud; previewing downloads it</dd>` : ""}</dl>
    <div>${chips(e.tags)}</div>
    <div class="path"><b>Path</b>${esc(e.path)}</div>
    <div class="row">${window.ATLAS_SERVER ? "" : `<button type="button" class="btn primary" id="pv-open">Open on PC</button>`}<a class="btn" href="${fileUrl(e.path, true)}" download>Download</a><button type="button" class="btn" id="pv-tags">Tags</button></div>`;
  if ($("#pv-open")) $("#pv-open").onclick = () => post("/api/openpath", { path: e.path }).then(() => say("Opened on the PC."), x => say(x.message, true));
  $("#pv-tags").onclick = () => tagEditor([e]);
  if (can) $("#pv-big").onclick = () => viewer(e);
  if (phone) { viewer(e); return; }                 // on a phone the file opens full screen; the panel keeps the details
  fill($("#pv"), e, false);
}

function fill(pv, e, big) {
  const url = fileUrl(e.path), ext = extOf(e.name);
  if (e.kind === "image") pv.innerHTML = e.size > 15e6 ? `<img alt="" src="/api/thumb?${new URLSearchParams({ path: e.path, s: "1600" })}">` : `<img alt="" src="${url}">`;
  else if (e.kind === "image_conv") pv.innerHTML = `<img alt="" src="/api/thumb?${new URLSearchParams({ path: e.path, s: "1600" })}">`;
  else if (e.kind === "video") pv.innerHTML = `<video controls preload="metadata" playsinline src="${url}"></video>`;
  else if (e.kind === "audio") pv.innerHTML = `<audio controls preload="metadata" src="${url}"></audio>`;
  else if (e.kind === "pdf") pdfView(pv, url, big);
  else if (e.kind === "model") modelView(pv, url, ext);
  else if (e.kind === "text") api("/api/text?" + new URLSearchParams({ path: e.path })).then(t => { pv.innerHTML = `<pre>${esc(t.text)}${t.truncated ? "\n…" : ""}</pre>`; }, x => { pv.innerHTML = `<p class="note err">${esc(x.message)}</p>`; });
  else pv.innerHTML = `<p class="note">No preview for this type. Open it on the PC or download it.</p>`;
}

function viewer(e) {
  document.querySelectorAll(".viewer").forEach(v => v.remove());
  const o = document.createElement("div"); o.className = "viewer"; o.setAttribute("role", "dialog"); o.setAttribute("aria-modal", "true"); o.setAttribute("aria-label", e.name);
  o.innerHTML = `<div class="vbar"><span>${esc(e.name)}</span><button type="button" class="btn" id="v-close">Close</button></div><div class="pv vbody"></div>`;
  document.body.appendChild(o); document.body.classList.add("noscroll");
  const keys = ev => { if (ev.key === "Escape") close(); };
  const close = () => { o.remove(); document.body.classList.remove("noscroll"); document.removeEventListener("keydown", keys); };
  document.addEventListener("keydown", keys); o.querySelector("#v-close").onclick = close; o.querySelector("#v-close").focus();
  fill(o.querySelector(".vbody"), e, true);
}

async function pdfView(el, url, big) {
  el.innerHTML = `<p class="note">Loading the PDF…</p>`;
  try {
    const lib = await import("/static/vendor/pdfjs/pdf.min.mjs");
    lib.GlobalWorkerOptions.workerSrc = "/static/vendor/pdfjs/pdf.worker.min.mjs";
    const doc = await lib.getDocument({ url, isEvalSupported: false, enableXfa: false }).promise;
    let n = 1; const cv = document.createElement("canvas"); const nav = document.createElement("div"); nav.className = "pv-nav";
    nav.innerHTML = `<button type="button" data-d="-1">Previous</button><span></span><button type="button" data-d="1">Next</button>`;
    el.innerHTML = ""; el.append(nav, cv);
    const draw = async () => {
      const page = await doc.getPage(n), v1 = page.getViewport({ scale: 1 });
      let w = (el.clientWidth || 320) - (big ? 24 : 0);
      if (big) w = Math.min(w, ((el.clientHeight || 800) - 60) * v1.width / v1.height);   // the whole page fits the screen
      const vp = page.getViewport({ scale: (w / v1.width) * (window.devicePixelRatio || 1) });
      cv.width = vp.width; cv.height = vp.height; cv.style.width = Math.round(w) + "px";
      await page.render({ canvasContext: cv.getContext("2d"), viewport: vp }).promise;
      nav.querySelector("span").textContent = `Page ${n} of ${doc.numPages}`;
    };
    nav.querySelectorAll("button").forEach(b => b.onclick = () => { const m = n + +b.dataset.d; if (m >= 1 && m <= doc.numPages) { n = m; draw(); } });
    await draw();
  } catch (e) { el.innerHTML = `<p class="note err">This PDF can't be shown here: ${esc(e.message)}</p>`; }
}

let threeReady = null;
const loadScript = src => new Promise((res, rej) => { const s = document.createElement("script"); s.src = src; s.onload = res; s.onerror = () => rej(new Error("could not load " + src)); document.head.appendChild(s); });
function three() {
  if (!threeReady) threeReady = (async () => {
    await loadScript("/static/vendor/three/three.min.js");
    for (const f of ["GLTFLoader", "STLLoader", "OBJLoader", "PLYLoader", "OrbitControls"]) await loadScript(`/static/vendor/three/${f}.js`);
  })();
  return threeReady;
}

async function modelView(el, url, ext) {
  el.innerHTML = `<p class="note">Loading the 3D model…</p>`;
  try {
    await three(); const T = window.THREE;
    const box = document.createElement("div"); box.className = "three"; el.innerHTML = ""; el.appendChild(box);
    const w = box.clientWidth || 320, h = box.clientHeight || 256;
    const rd = new T.WebGLRenderer({ antialias: true, alpha: true }); rd.setPixelRatio(window.devicePixelRatio || 1); rd.setSize(w, h); box.appendChild(rd.domElement);
    const scene = new T.Scene(), cam = new T.PerspectiveCamera(40, w / h, 0.01, 1e7);
    scene.add(new T.HemisphereLight(0xffffff, 0x303030, 1.1)); const dl = new T.DirectionalLight(0xffffff, 0.9); dl.position.set(1, 2, 3); scene.add(dl);
    const mat = new T.MeshStandardMaterial({ color: 0xd8d3c8, metalness: 0.05, roughness: 0.75 });
    let obj;
    if (ext === "glb" || ext === "gltf") obj = (await new T.GLTFLoader().loadAsync(url)).scene;
    else if (ext === "stl") { const g = await new T.STLLoader().loadAsync(url); g.computeVertexNormals(); obj = new T.Mesh(g, mat); }
    else if (ext === "obj") { obj = await new T.OBJLoader().loadAsync(url); obj.traverse(c => { if (c.isMesh) c.material = mat; }); }
    else {
      const g = await new T.PLYLoader().loadAsync(url), col = !!g.getAttribute("color");
      if (g.index) { g.computeVertexNormals(); obj = new T.Mesh(g, new T.MeshStandardMaterial({ vertexColors: col, color: col ? 0xffffff : 0xd8d3c8, roughness: 0.8 })); }
      else { g.computeBoundingBox(); const s = g.boundingBox.getSize(new T.Vector3()); obj = new T.Points(g, new T.PointsMaterial({ size: Math.max(s.x, s.y, s.z) / 300, vertexColors: col, color: col ? 0xffffff : 0xd8d3c8 })); }
    }
    const bb = new T.Box3().setFromObject(obj), size = bb.getSize(new T.Vector3()), c = bb.getCenter(new T.Vector3());
    obj.position.sub(c); scene.add(obj);
    const d = Math.max(size.x, size.y, size.z) || 1;
    cam.position.set(d * 1.1, d * 0.8, d * 1.3); cam.near = d / 1000; cam.far = d * 100; cam.updateProjectionMatrix();
    const ctl = new T.OrbitControls(cam, rd.domElement); ctl.enableDamping = true;
    const tick = () => { if (!document.body.contains(rd.domElement)) { rd.dispose(); return; } ctl.update(); rd.render(scene, cam); requestAnimationFrame(tick); };
    tick();
    const nav = document.createElement("div"); nav.className = "pv-nav"; nav.textContent = "Drag to turn, pinch or scroll to zoom"; el.appendChild(nav);
  } catch (e) { el.innerHTML = `<p class="note err">This model can't be shown here: ${esc(e.message)}</p>`; }
}

function tagEditor(items) {
  const p = $("#panel"); let picked = "red";
  const common = items.length === 1 ? [...(items[0].tags || [])] : [];
  const draw = () => {
    p.innerHTML = `<div class="chip">Tags</div><h2>${esc(items.length === 1 ? items[0].name : items.length + " items")}</h2>
      <div class="tagbox">
        <div class="row2" id="tg-cur">${chips(common, true) || `<span class="note">No tags yet.</span>`}</div>
        <div class="row2"><input id="tg-in" list="tg-voc" placeholder="Add a tag" autocomplete="off"><datalist id="tg-voc">${Object.keys(FB.vocab).map(t => `<option value="${esc(t)}">`).join("")}</datalist>
        <button type="button" id="tg-add">Add</button></div>
        <div class="dots" role="group" aria-label="Tag color">${Object.keys(TAGC).map(c => `<button type="button" data-c="${c}" aria-label="${c}" aria-pressed="${c === picked}" style="background:${tagColor(c)}"></button>`).join("")}</div>
        <div class="row2"><button type="button" class="btn primary" id="tg-save">Save tags</button><button type="button" class="btn" id="tg-cancel">Cancel</button></div>
        <p class="note" id="tg-note"></p>
      </div>`;
    p.querySelectorAll("[data-rm]").forEach(b => b.onclick = () => { common.splice(common.indexOf(b.dataset.rm), 1); draw(); });
    p.querySelectorAll(".dots button").forEach(b => b.onclick = () => { picked = b.dataset.c; draw(); });
    const add = () => { const v = $("#tg-in").value.trim(); if (v && !common.includes(v)) { common.push(v); if (!FB.vocab[v]) FB.vocab[v] = picked; } draw(); };
    $("#tg-add").onclick = add; $("#tg-in").onkeydown = e => { if (e.key === "Enter") add(); };
    $("#tg-cancel").onclick = () => items.length === 1 ? preview(items[0]) : (p.innerHTML = "");
    $("#tg-save").onclick = async () => {
      try {
        const colors = Object.fromEntries(common.map(t => [t, FB.vocab[t]]));
        for (const it of items) { const tags = items.length === 1 ? common : [...new Set([...(it.tags || []), ...common])]; await post("/api/tag", { path: it.path, tags, colors }); }
        await browse(FB.dir, items.length === 1 ? items[0].path : null); say("Tags saved.");
      } catch (e) { $("#tg-note").textContent = e.message; }
    };
  };
  draw();
}

// ---- file search from the main search box ----------------------------------------------------
let findT = null;
function findFiles(q) {
  clearTimeout(findT);
  if (!q || q.trim().length < 3 || S.browse) return;
  findT = setTimeout(async () => {
    try {
      const r = await api("/api/find?" + new URLSearchParams({ q }));
      if (!r.results.length) return;
      $("#panel").innerHTML = `<div class="chip">Files</div><h2>Files named like “${esc(q)}”</h2><div class="finds">${r.results.map((f, i) =>
        `<button type="button" data-i="${i}"><span>${esc(f.name)}</span><span class="num">${fmtSize(f.size)}</span><small>${esc(dirname(f.path))}</small></button>`).join("")}</div>`;
      $("#panel").querySelectorAll(".finds button").forEach(b => b.onclick = () => { const f = r.results[+b.dataset.i]; browse(dirname(f.path), f.path); });
    } catch (e) { /* the map search still works */ }
  }, 350);
}

// ---- devices and pairing -----------------------------------------------------------------------
async function devicesPanel() {
  const p = $("#panel");
  try {
    const d = await api("/api/devices");
    p.innerHTML = `<div class="chip">Devices</div><h2>Signed-in devices</h2><div class="dev">
      ${d.devices.map(x => `<div class="d"><span>${esc(x.name)}${x.me ? " (this one)" : ""}<small>Signed in ${esc(x.created)} · last used ${esc(x.last)}</small></span>${d.local && !x.me ? `<button type="button" data-rv="${esc(x.id)}">Sign out</button>` : ""}</div>`).join("")}
      ${d.local ? `<button type="button" class="btn primary" id="pair">Pair a phone</button><div id="pairbox"></div>` : `<p class="note">Pair new phones and sign devices out from Atlas on the PC.</p>`}
      <a class="btn" href="/logout">Sign out this device</a></div>`;
    p.querySelectorAll("[data-rv]").forEach(b => b.onclick = async () => { if (confirm("Sign this device out of Atlas?")) { await post("/api/devices/revoke", { id: b.dataset.rv }); devicesPanel(); } });
    const pb = $("#pair");
    if (pb) pb.onclick = async () => {
      try {
        const r = await post("/api/pair", {});
        $("#pairbox").innerHTML = `<p class="note">On the phone, with Tailscale on, scan this code with the camera. Then in Chrome's menu tap <b>Install app</b> or <b>Add to Home screen</b>. The code works once, within ${r.expires_days} days.</p><div class="qr">${r.svg}</div><div class="path"><b>Or open</b>${esc(r.url)}</div>`;
      } catch (e) { $("#pairbox").innerHTML = `<p class="note err">${esc(e.message)}</p>`; }
    };
  } catch (e) { p.innerHTML = `<p class="note err">${esc(e.message)}</p>`; }
}
