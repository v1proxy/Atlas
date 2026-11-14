// Atlas's page inside the interactive preview (preview-shell.html): a stand-in for the launcher's bridge and for the
// Atlas server, answering from invented folders and files. Loaded before Atlas's own scripts. Not part of Atlas.
(function () {
  const P = window.parent && window.parent.PREVIEW;
  if (!P) return;
  let D = null; P.data().then(d => { D = d; });
  window.AtlasLauncher = {
    home() { P.home(); },
    haptic(k) { P.haptic(k); },
    isPinned(p) { return P.isPinnedFile(p); },
    pin(json) { return P.togglePinFile(JSON.parse(json)); },
  };
  window.PV_FILE = (path, dl) => (D && D.index[path] ? D.index[path].file : "data:,");
  window.PV_THUMB = q => { const f = D && D.index[q.path]; return f ? (q.s === "1600" ? f.big || f.file : f.thumb || f.file) : "data:,"; };
  const json = (o, status) => new Response(JSON.stringify(o), { status: status || 200, headers: { "Content-Type": "application/json" } });
  const real = window.fetch.bind(window);
  const ROUTES = new Set(["/map.json", "/settings", "/status", "/open", "/place", "/rescan", "/logout"]);
  window.fetch = async function (input, init) {
    const url = new URL(typeof input === "string" ? input : input.url, location.href);
    const path = url.pathname.replace(/^.*?(\/api\/|\/map\.json$|\/settings$|\/status$|\/open$|\/place$|\/rescan$)/, "$1");
    if (!path.startsWith("/api/") && !ROUTES.has(path)) return real(input, init);
    const d = await P.data(), q = url.searchParams, method = (init && init.method) || "GET";
    const body = init && init.body ? JSON.parse(init.body) : {};
    if (method === "POST") {
      if (path === "/settings") { if (body.tone) P.setTone(body.tone); return json({ ok: true }); }
      if (path === "/place") { P.toast("Moved (in the preview the map doesn't change)."); return json({ ok: true }); }
      if (path === "/api/tag") return json({ tags: body.tags || [] });
      P.toast("Files aren't changed in the preview."); return json({ error: "not in the preview" }, 400);
    }
    if (path === "/map.json") return json(d.map);
    if (path === "/settings") return json({ tone: P.prefs().tone, view: "treemap" });
    if (path === "/status") return json({ running: false, last: d.map.generated });
    if (path === "/api/whoami") return json({ name: "Android launcher", kind: "phone", local: false, server: true });
    if (path === "/api/tags") return json({ vocab: { "Client review": "teal", "Final": "green", "Urgent": "red" }, colors: ["teal", "green", "red"] });
    if (path === "/api/devices") return json({ devices: [{ id: "x1", name: "Android launcher", kind: "phone", created: "2026-11-14 12:00", last: "today", me: true }], local: false });
    if (path === "/api/ls") {
      const p = q.get("path") || "", l = d.listings[p];
      return json(l || { path: p, readonly: false, entries: [], parent: p.slice(0, p.lastIndexOf("\\")) || p });
    }
    if (path === "/api/find") {
      const s = (q.get("q") || "").toLowerCase(), out = [], seen = new Set();
      for (const l of Object.values(d.listings)) for (const e of l.entries) if (!e.dir && !seen.has(e.path) && e.name.toLowerCase().includes(s)) { seen.add(e.path); out.push(e); }
      return json({ results: out.slice(0, 60) });
    }
    if (path === "/api/text") {
      const f = d.index[q.get("path")];
      return json({ text: f ? await (await real(f.file)).text() : "", truncated: false });
    }
    return json({ error: "not found" }, 404);
  };
})();
