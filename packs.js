// Downloads: province trail packs kept on this device, and the "Save mobile data" switch.
// The nightly Canada build (scripts/build-canada.mjs) publishes ca/index.json and one ca/c/<chunk>.json per map
// chunk (1° lat x 1.2° lon). A province pack is the list of chunks it touches. Chunks are saved in the
// "tf-packs-1" cache (sw.js keeps it across new versions of the site) and localStorage "tf:packs" records which
// hash of each chunk this device holds, so Update fetches only the chunks whose hash changed.
// window.tfPacks = { get(id), allowOnline(bytes, what) }: the core loader reads a downloaded chunk first and asks
// allowOnline before fetching one online. Save mobile data never locks anything: with it on (and not on Wi-Fi),
// the app asks first before online chunks, satellite, 3D and old vs new photos, and one tap says yes.
(() => {
  "use strict";
  const CACHE = "tf-packs-1", KEY = "tf:packs", SAVE_KEY = "tf:saveData", USED_KEY = "tf:packsUsed";
  const INDEX = "ca/index.json", chunkUrl = (id) => new URL(`ca/c/${id}.json`, location.href).href;
  const PROVINCES = { ab: "Alberta", bc: "British Columbia", mb: "Manitoba", nb: "New Brunswick", nl: "Newfoundland and Labrador",
    ns: "Nova Scotia", nt: "Northwest Territories", nu: "Nunavut", on: "Ontario", pe: "Prince Edward Island", qc: "Quebec",
    sk: "Saskatchewan", yt: "Yukon" };
  const hasCaches = "caches" in window;
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const lsGet = (k, d) => { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; } };
  const lsSet = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} };
  const mb = (b) => (!b ? "0 MB" : b < 1e5 ? "under 0.1 MB" : b < 1e9 ? (b < 1e7 ? (b / 1e6).toFixed(1) : Math.round(b / 1e6)) + " MB" : (b / 1e9).toFixed(1) + " GB");
  const day = (iso) => (iso ? new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }) : "");
  const packs = () => lsGet(KEY, {});            // { prov: { at, done, chunks: { id: h } } }
  const savePacks = (p) => lsSet(KEY, p);
  const saveData = () => lsGet(SAVE_KEY, false) === true;

  // ---------- connection ----------
  const conn = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
  const canTellWifi = !!(conn && "type" in conn);   // Android Chrome: yes. iPhone Safari and desktop Firefox: no
  const onWifi = () => canTellWifi && (conn.type === "wifi" || conn.type === "ethernet");

  // ---------- data used counter ----------
  function countUsed(bytes) {
    if (!(bytes > 0)) return;
    const u = lsGet(USED_KEY, {}), m = new Date().toISOString().slice(0, 7);
    if (u.m !== m) { u.m = m; u.month = 0; }
    u.month = (u.month || 0) + bytes; u.all = (u.all || 0) + bytes;
    lsSet(USED_KEY, u);
  }

  // ---------- the published index ----------
  let index = null, indexAt = 0;
  async function getIndex(force) {
    if (index && !force && Date.now() - indexAt < 10 * 60e3) return index;
    const res = await fetch(INDEX, { cache: "no-cache" });
    if (!res.ok) throw new Error(res.status === 404 ? "not published" : `index answered ${res.status}`);
    const j = await res.json();
    if (!j || !Array.isArray(j.provinces) || !j.chunks) throw new Error("index looks wrong");
    index = j; indexAt = Date.now();
    return j;
  }
  const provOf = (idx, id) => idx && idx.provinces.find((p) => p.id === id);
  // Chunks of a downloaded province that are new or changed in the index, and the bytes they add up to.
  function changes(idx, id) {
    const p = provOf(idx, id), have = (packs()[id] || {}).chunks || {};
    if (!p) return { ids: [], bytes: 0, gone: [] };
    const ids = p.chunks.filter((c) => idx.chunks[c] && have[c] !== idx.chunks[c].h);
    const gone = Object.keys(have).filter((c) => !p.chunks.includes(c));
    return { ids, gone, bytes: ids.reduce((s, c) => s + (idx.chunks[c].bytes || 0), 0) };
  }
  const packBytes = (idx, id) => {
    const have = (packs()[id] || {}).chunks || {};
    return Object.keys(have).reduce((s, c) => s + ((idx && idx.chunks[c] && idx.chunks[c].bytes) || 0), 0);
  };
  // A chunk at a border belongs to two provinces: it's only removed when no downloaded province still needs it.
  const usedElsewhere = (all, prov, c) => Object.entries(all).some(([k, v]) => k !== prov && v.chunks && c in v.chunks);

  // ---------- downloading ----------
  let busy = null;   // { prov, stop, done, total } while a download or update runs
  async function sync(prov, quiet) {
    if (busy || !hasCaches) return false;
    const idx = await getIndex(true);
    const p = provOf(idx, prov);
    if (!p) throw new Error("This province isn't in the downloads yet.");
    const all = packs(), cur = all[prov] || (all[prov] = { at: null, done: false, chunks: {} });
    savePacks(all);
    const cache = await caches.open(CACHE);
    // A chunk another province already holds at the same hash is reused, not fetched again.
    const held = {};
    Object.values(all).forEach((v) => Object.entries(v.chunks || {}).forEach(([c, h]) => { held[c] = h; }));
    const { ids, gone } = changes(idx, prov);
    const todo = [];
    for (const c of ids) {
      if (held[c] === idx.chunks[c].h && (await cache.match(chunkUrl(c)))) cur.chunks[c] = held[c];
      else todo.push(c);
    }
    busy = { prov, stop: false, done: 0, total: todo.length, quiet };
    render();
    let i = 0, failed = 0;
    async function worker() {
      while (i < todo.length && !busy.stop) {
        const c = todo[i++];
        let ok = false;
        for (let tries = 0; tries < 3 && !ok && !busy.stop; tries++) {
          try {
            const r = await fetch(chunkUrl(c), { cache: "no-cache" });
            if (r.ok) {
              const blob = await r.clone().blob();
              await cache.put(chunkUrl(c), r);
              countUsed(blob.size);
              const now = packs(); (now[prov] = now[prov] || { chunks: {} }).chunks[c] = idx.chunks[c].h; savePacks(now);   // progress survives a closed tab
              ok = true;
            } else if (r.status === 404) break;
          } catch { await new Promise((res) => setTimeout(res, 800 * (tries + 1))); }
        }
        if (!ok && !busy.stop) failed++;
        busy.done++;
        progress();
      }
    }
    try {
      await Promise.all(Array.from({ length: 4 }, worker));
      const now = packs(), mine = now[prov] || { chunks: {} };
      Object.assign(mine.chunks, cur.chunks);
      for (const c of gone) { delete mine.chunks[c]; if (!usedElsewhere(now, prov, c)) await cache.delete(chunkUrl(c)); }
      const complete = !busy.stop && !failed;
      mine.done = complete || (mine.done && busy.stop);   // an update stopped half way still leaves a usable pack
      if (complete) mine.at = new Date().toISOString();
      now[prov] = mine; savePacks(now);
      if (failed) throw new Error(`${failed} part${failed > 1 ? "s" : ""} didn't download. Tap Resume to try again.`);
      return complete;
    } finally { busy = null; render(); }
  }
  async function remove(prov) {
    const all = packs(), mine = all[prov];
    if (!mine) return;
    delete all[prov];
    if (hasCaches) {
      const cache = await caches.open(CACHE);
      for (const c of Object.keys(mine.chunks || {})) if (!usedElsewhere(all, prov, c)) await cache.delete(chunkUrl(c));
    }
    savePacks(all);
  }

  // ---------- asking first, with Save mobile data on ----------
  const asked = new Map();   // what -> { yes, until } or a pending Promise
  function ask(what, bytes) {
    const a = asked.get(what);
    if (a instanceof Promise) return a;
    if (a && a.until > Date.now()) return Promise.resolve(a.yes);
    const p = new Promise((done) => {
      const box = document.createElement("div");
      box.className = "packs-ask";
      box.setAttribute("role", "dialog");
      box.setAttribute("aria-label", "Use mobile data?");
      box.innerHTML = `<p><b>Use mobile data?</b> Save mobile data is on. Load ${esc(what)} online${bytes ? ` (about ${mb(bytes)})` : ""}?</p>
<div class="row"><button class="btn primary" type="button" data-yes>Load</button><button class="btn" type="button" data-no>Not now</button></div>`;
      document.body.append(box);
      const end = (yes) => {
        box.remove();
        // Yes holds for this visit; Not now for 5 minutes, then the app asks again. Nothing stays locked.
        asked.set(what, { yes, until: yes ? Infinity : Date.now() + 5 * 60e3 });
        done(yes);
      };
      box.querySelector("[data-yes]").addEventListener("click", () => end(true));
      box.querySelector("[data-no]").addEventListener("click", () => end(false));
      box.querySelector("[data-yes]").focus();
    });
    asked.set(what, p);
    return p;
  }
  async function allowOnline(bytes, what) {
    let ok = true;
    if (saveData() && !onWifi()) ok = await ask(what || "trail data for this area", bytes);
    if (ok) countUsed(bytes);
    return ok;
  }
  async function get(id) {
    if (!hasCaches) return null;
    try {
      const res = await caches.match(chunkUrl(id), { cacheName: CACHE });
      return res ? await res.json() : null;
    } catch { return null; }
  }
  window.tfPacks = { get, allowOnline };

  // Satellite, 3D and old vs new photos: with Save mobile data on, the tap that turns one on asks first. A capture
  // listener runs before the button's own, so the button's code is untouched; "Load" replays the tap.
  let replaying = false;
  const HEAVY = { satBtn: "satellite photos", btn3d: "the 3D map", photoBtn: "old vs new photos" };
  document.addEventListener("click", (e) => {
    if (replaying || !saveData() || onWifi()) return;
    const b = e.target.closest && e.target.closest("#satBtn, #btn3d, #photoBtn");
    if (!b || b.getAttribute("aria-pressed") === "true") return;   // turning it off never asks
    const what = HEAVY[b.id], a = asked.get(what);
    if (a && !(a instanceof Promise) && a.yes) return;
    e.stopImmediatePropagation(); e.preventDefault();
    ask(what).then((yes) => { if (yes) { replaying = true; try { b.click(); } finally { replaying = false; } } });
  }, true);
  let lastBase = null;
  addEventListener("load", () => { const s = document.getElementById("basemap"); if (s) lastBase = s.value; });
  document.addEventListener("change", (e) => {
    const s = e.target;
    if (!s || s.id !== "basemap") return;
    if (replaying || !/^sat/.test(s.value) || /^sat/.test(lastBase || "") || !saveData() || onWifi()) { lastBase = s.value; return; }
    const a = asked.get(HEAVY.satBtn);
    if (a && !(a instanceof Promise) && a.yes) { lastBase = s.value; return; }
    const want = s.value;
    e.stopImmediatePropagation();
    s.value = lastBase || "osm";
    ask(HEAVY.satBtn).then((yes) => {
      if (!yes) return;
      s.value = want; lastBase = want;
      replaying = true; try { s.dispatchEvent(new Event("change", { bubbles: true })); } finally { replaying = false; }
    });
  }, true);

  // ---------- the Downloads card ----------
  const btn = document.getElementById("packsBtn");
  const css = document.createElement("style");
  css.textContent = `
.packs-card { position: absolute; z-index: 1001; left: 56px; top: 12px; width: min(380px, calc(100% - 68px)); max-height: calc(100% - 40px); overflow-y: auto; box-sizing: border-box;
  background: var(--panel); color: var(--fg); border: 1px solid var(--line); border-radius: 12px; box-shadow: 0 8px 24px rgba(0,0,0,.22); padding: 12px 14px; font-size: .88rem; }
.packs-card h2 { margin: 0 0 4px; font-size: 1rem; display: flex; justify-content: space-between; align-items: center; }
.packs-card h2 button { font: inherit; border: 0; background: none; color: var(--muted); cursor: pointer; font-size: 1.1rem; padding: 0 4px; }
.packs-card p { margin: 6px 0; }
.packs-card .muted { color: var(--muted); font-size: .8rem; }
.packs-card .save { display: flex; gap: 10px; align-items: flex-start; padding: 8px 0; border-top: 1px solid var(--line); cursor: pointer; }
.packs-card .save input { width: 18px; height: 18px; margin: 2px 0 0; accent-color: var(--accent); flex: none; }
.packs-card .save span { display: block; }
.packs-card .note { background: color-mix(in srgb, var(--accent) 12%, transparent); border-radius: 8px; padding: 8px 10px; display: flex; gap: 8px; align-items: center; }
.packs-card .note span { flex: 1; }
.packs-card ul { list-style: none; margin: 8px 0 0; padding: 0; border-top: 1px solid var(--line); }
.packs-card li { display: flex; flex-wrap: wrap; gap: 6px 8px; align-items: center; padding: 8px 0; border-bottom: 1px solid var(--line); }
.packs-card li > div { flex: 1 1 150px; min-width: 0; }
.packs-card li b { display: block; }
.packs-card li .muted { display: block; }
.packs-card li .upd { color: var(--accent); font-weight: 600; }
.packs-card button.sm { font: inherit; font-size: .8rem; padding: 4px 9px; border-radius: 6px; border: 1px solid var(--line); background: var(--chip); color: var(--fg); cursor: pointer; }
.packs-card button.sm.go { background: var(--accent); border-color: var(--accent); color: #fff; }
.packs-card button.sm:disabled { opacity: .5; cursor: default; }
.packs-card .bar { flex-basis: 100%; height: 6px; border-radius: 3px; background: var(--line); overflow: hidden; }
.packs-card .bar i { display: block; height: 100%; width: 0; background: var(--accent); transition: width .2s; }
.map-tools #packsBtn.on { background: var(--accent); border-color: var(--accent); color: #fff; }
.map-tools #packsBtn .dot { margin-left: auto; width: 8px; height: 8px; border-radius: 50%; background: var(--accent); }
.packs-ask { position: fixed; z-index: 3000; left: 50%; bottom: 24px; transform: translateX(-50%); width: min(360px, calc(100% - 32px)); box-sizing: border-box;
  background: var(--panel); color: var(--fg); border: 1px solid var(--line); border-radius: 12px; box-shadow: 0 10px 30px rgba(0,0,0,.3); padding: 12px 14px; font-size: .9rem; }
.packs-ask p { margin: 0 0 10px; }
.packs-ask .row { display: flex; gap: 8px; }
@media (max-width: 700px) { .packs-card { left: 8px; right: 8px; width: auto; top: 8px; } }`;
  document.head.append(css);
  if (!btn) return;
  if (!hasCaches) { btn.hidden = true; return; }
  const card = document.createElement("div");
  card.className = "packs-card";
  card.hidden = true;
  card.setAttribute("role", "dialog");
  card.setAttribute("aria-label", "Downloads");
  card.innerHTML = `<h2>Downloads <button type="button" data-x aria-label="Close">✕</button></h2>
<p class="muted">Download a province's trails to use them with no signal. Without a download the app still works anywhere online.</p>
<label class="save"><input type="checkbox" data-save><span><b>Save mobile data</b><span class="muted" data-save-note></span></span></label>
<div data-top></div><ul data-list></ul><p class="muted" data-use></p>`;
  (document.querySelector(".mapwrap") || document.body).append(card);
  ["click", "dblclick", "mousedown", "touchstart", "wheel", "pointerdown"].forEach((t) => card.addEventListener(t, (e) => e.stopPropagation(), { passive: true }));
  const $ = (s) => card.querySelector(s);

  function open(on) {
    card.hidden = !on;
    btn.classList.toggle("on", on);
    btn.setAttribute("aria-pressed", String(on));
    if (on) { render(); getIndex(true).then(render, (e) => { indexErr = e; render(); }); }
  }
  btn.addEventListener("click", () => open(card.hidden));
  $("[data-x]").addEventListener("click", () => open(false));
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !card.hidden) open(false); });

  $("[data-save]").checked = saveData();
  $("[data-save]").addEventListener("change", (e) => {
    lsSet(SAVE_KEY, e.target.checked);
    asked.clear();
    render();
  });

  let indexErr = null;
  function progress() {
    if (!busy) return;
    const li = card.querySelector(`li[data-p="${busy.prov}"]`);
    if (!li) return;
    const pct = busy.total ? Math.round((busy.done / busy.total) * 100) : 100;
    li.querySelector(".bar i").style.width = pct + "%";
    li.querySelector("[data-st]").textContent = `${busy.stop ? "Stopping" : "Downloading"}: ${busy.done} of ${busy.total} parts`;
  }
  function pending(idx) {   // downloaded provinces with changed chunks
    return Object.keys(packs()).map((id) => ({ id, ...changes(idx, id) })).filter((c) => c.ids.length || c.gone.length);
  }
  function render() {
    btn.querySelector(".dot")?.remove();
    const upd = index ? pending(index) : [];
    if (upd.length) btn.insertAdjacentHTML("beforeend", `<span class="dot" title="Updates ready"></span>`);
    if (card.hidden) return;
    const save = saveData();
    $("[data-save-note]").textContent = save
      ? (onWifi() ? "On. You're on Wi-Fi, so nothing is held back right now." : "On. Your downloads are used first, and the app asks before loading trail data, satellite, 3D or photos online. Nothing is locked: one tap says yes.")
      : "Off. Everything loads online as you need it.";
    const all = packs();
    let top = "";
    if (indexErr && !index) top = `<p class="muted">${indexErr.message === "not published" ? "Province downloads aren't published yet. They'll show here after the next nightly build." : navigator.onLine ? "Couldn't check for downloads right now." : "You're offline. Your downloads still work."}</p>`;
    else if (upd.length && !busy) {
      const bytes = upd.reduce((s, c) => s + c.bytes, 0);
      top = `<div class="note"><span>Updates ready for ${upd.map((c) => esc((provOf(index, c.id) || {}).name || PROVINCES[c.id])).join(", ")} (${mb(bytes)}).${canTellWifi ? " They download by themselves on Wi-Fi." : ""}</span><button class="sm go" type="button" data-all>Update now</button></div>`;
    }
    $("[data-top]").innerHTML = top;
    const list = index ? index.provinces.slice() : Object.keys(PROVINCES).map((id) => ({ id, name: PROVINCES[id] }));
    list.sort((a, b) => (!!all[b.id] - !!all[a.id]) || a.name.localeCompare(b.name));   // downloaded ones first
    $("[data-list]").innerHTML = list.map((p) => {
      const mine = all[p.id], ch = index && mine ? changes(index, p.id) : null, run = busy && busy.prov === p.id;
      const size = index ? (mine ? packBytes(index, p.id) : p.bytes) : null;
      let meta;
      if (run) meta = `<span class="muted" data-st></span>`;
      else if (mine && !mine.done) meta = `<span class="muted">Download didn't finish${size ? ` · ${mb(size)} so far` : ""}</span>`;
      else if (mine) meta = `<span class="muted">${size != null ? mb(size) + " · " : ""}downloaded ${day(mine.at)}${ch && (ch.ids.length || ch.gone.length) ? ` · <span class="upd">update ready, ${mb(ch.bytes)}</span>` : index ? " · up to date" : ""}</span>`;
      else meta = `<span class="muted">${p.chunks ? `${mb(p.bytes)} · built ${day(index.builtAt)}` : "Not available yet"}</span>`;
      const off = !!busy || !index || !p.chunks;
      let btns = "";
      if (run) btns = `<button class="sm" type="button" data-stop>Stop</button><div class="bar"><i></i></div>`;
      else if (!mine) btns = `<button class="sm go" type="button" data-dl="${p.id}"${off ? " disabled" : ""}>Download</button>`;
      else {
        if (!mine.done) btns += `<button class="sm go" type="button" data-dl="${p.id}"${off ? " disabled" : ""}>Resume</button>`;
        else btns += `<button class="sm${ch && (ch.ids.length || ch.gone.length) ? " go" : ""}" type="button" data-up="${p.id}"${off || !(ch && (ch.ids.length || ch.gone.length)) ? " disabled" : ""}>Update</button>`;
        btns += `<button class="sm" type="button" data-del="${p.id}"${busy ? " disabled" : ""}>Delete</button>`;
      }
      return `<li data-p="${p.id}"><div><b>${esc(p.name || PROVINCES[p.id])}</b>${meta}</div>${btns}</li>`;
    }).join("");
    progress();
    usage();
  }
  async function usage() {
    const u = lsGet(USED_KEY, {}), m = new Date().toISOString().slice(0, 7);
    const held = Object.keys(packs()).length;
    let txt = `Trail data downloaded on this device: ${mb(u.m === m ? u.month : 0)} this month, ${mb(u.all)} in all.`;
    if (index && held) txt += ` Your downloads take ${mb(Object.keys(packs()).reduce((s, id) => s + packBytes(index, id), 0))}.`;
    if (navigator.storage && navigator.storage.estimate) {
      const s = await navigator.storage.estimate().catch(() => null);
      if (s && s.quota) txt += ` This site uses ${mb(s.usage)} of storage, of the ${mb(s.quota)} your browser allows.`;
    }
    if (!card.hidden) $("[data-use]").textContent = txt;
  }

  async function run(prov) {
    try { await sync(prov); }
    catch (e) { alert(e.message || "The download didn't work. Check the connection and try again."); }
  }
  card.addEventListener("click", async (e) => {
    const b = e.target.closest("button");
    if (!b) return;
    if (b.dataset.stop != null && busy) { busy.stop = true; progress(); }
    else if (b.dataset.dl || b.dataset.up) {
      const id = b.dataset.dl || b.dataset.up, p = provOf(index, id);
      const bytes = b.dataset.up ? changes(index, id).bytes : p && p.bytes;
      if (saveData() && !onWifi() && !canTellWifi && !confirm(`Download ${p ? p.name : "this province"} (${mb(bytes)})? If you're not on Wi-Fi this uses mobile data.`)) return;
      if (saveData() && canTellWifi && !onWifi() && !confirm(`You're not on Wi-Fi. Download ${p ? p.name : "this province"} (${mb(bytes)}) with mobile data?`)) return;
      run(id);
    } else if (b.dataset.del) {
      const name = (provOf(index, b.dataset.del) || {}).name || PROVINCES[b.dataset.del];
      if (confirm(`Delete the ${name} download from this device?`)) { await remove(b.dataset.del); render(); }
    } else if (b.dataset.all != null && index) {
      for (const c of pending(index)) { try { await sync(c.id); } catch (err) { alert(err.message); break; } }
    }
  });

  // ---------- auto-update on Wi-Fi ----------
  // Android reports the connection type, so downloaded provinces update by themselves on Wi-Fi (changed chunks
  // only), at most every 6 hours. iPhone doesn't say, so the card shows "Update now" instead.
  async function autoUpdate() {
    if (busy || !Object.keys(packs()).length || !navigator.onLine) return;
    if (!onWifi() && saveData()) return;   // with Save mobile data on, don't even check over mobile data
    const last = lsGet("tf:packsChecked", 0);
    if (Date.now() - last < 6 * 3600e3 && index) return;
    try { await getIndex(true); } catch { return; }
    lsSet("tf:packsChecked", Date.now());
    if (onWifi()) for (const c of pending(index)) { try { await sync(c.id, true); } catch { break; } }
    render();
  }
  setTimeout(autoUpdate, 8000);
  if (conn && conn.addEventListener) conn.addEventListener("change", () => { if (onWifi()) setTimeout(autoUpdate, 3000); });
  addEventListener("online", () => setTimeout(autoUpdate, 3000));
})();
