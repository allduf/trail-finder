// Ground layers in the iPhone's own 3D map (native 3D, step 6; alex 2026-11-20: "every web feature working exactly the
// same on phone, in native 3D"): elevation lines, sun and shade, slope angle, slope direction, flats, elevation bands,
// new snow and the snow forecast (Skiing), and Hunting's slope layers.
// The page already paints these pictures, tile by tile, for its own 3D map (winter.js, contours.js, shade.js,
// hunting.js each list theirs in window.tfGround). The native 3D map (NativeGround.swift) asks this page for the same
// pictures as PNGs, so the colours, the forecasts and the estimates are the web's exactly, from one piece of code.
// The painting runs in the page (its own process), never on the native map's drawing thread.
//   - "ground" (window.tfNative.addLayer): which layers are on, with their zooms, versions and credits, and the colour
//     keys shown on the map. Sent at opening, and again when a layer goes on or off or is drawn again ("tf:ground").
//   - "groundTile" { r, id, z, x, y } from the native map: the picture comes back as "T|r|<base64 PNG>" ("" = nothing
//     there, "!" = it couldn't be painted now); "groundStop" { r } when the map no longer needs it.
// Avalanche (step 8) comes through here too, winter.js's own paint(), only to app builds that show its card beside it
// (native-avalanche.js): the PNGs are lossless, so the colours are Avalanche Canada's band ratings exactly.
// On the website, and in app builds without native 3D, this file does nothing.
(() => {
  "use strict";
  const C = window.Capacitor, N = window.tfNative;
  if (!C || !C.isNativePlatform || !C.isNativePlatform() || !N || !N.addLayer || !N.on || !N.post) return;
  const reg = () => window.tfGround || {};
  const isOn = (g) => { try { return !!g.on(); } catch { return false; } };

  // The colour keys: the same bars the page shows on its map (Skiing's, translated there), plus a layer's own.
  function keys() {
    const out = [];
    for (const b of document.querySelectorAll("#skBars .sk-bar")) {
      const c = [...b.querySelectorAll(".bc i")].map((i) => i.style.backgroundColor || i.style.background);
      if (!c.length || c.some((x) => !/^(#|rgb)/.test(x))) continue;   // only plain colours (never the avalanche bar)
      out.push({ t: [...b.querySelectorAll(".bt")].map((e) => e.textContent.trim()).join(" · "), c, l: [...b.querySelectorAll(".bl span")].map((s) => s.textContent.trim()) });
    }
    for (const g of Object.values(reg())) if (g.key && isOn(g)) { try { const k = g.key(); if (k) out.push(k); } catch {} }
    return out;
  }
  function state() {
    const layers = [];
    for (const [id, g] of Object.entries(reg())) {
      if (!isOn(g)) continue;
      let v = "0"; try { v = String(g.ver ? g.ver() : 0); } catch {}
      layers.push({ id, v: v.replace(/[^\w.-]/g, ""), min: g.min || 0, max: g.max || 14, op: g.opacity || 1, z: g.z || 0, credit: g.credit || "", keep: !!g.keep });
    }
    return JSON.stringify({ layers, keys: keys() });
  }
  N.addLayer("ground", state);
  // Changes while the native map is open (new snow numbers, more forecast points in): at most every 4 s, as the web 3D
  // map does, since each one loads that layer's tiles again.
  let last = 0, timer = 0, sent = "";
  const sendNow = () => { timer = 0; last = Date.now(); const s = state(); if (s !== sent) { sent = s; N.send("ground"); } };
  // The sun and shade time slider (shade.js, detail.fast) moves the moment as the finger slides: once a second then.
  let timerAt = 0;
  window.addEventListener("tf:ground", (e) => {
    if (!N.isOpen()) return;
    const at = last + (e && e.detail && e.detail.fast ? 1000 : 4000);
    if (timer && timerAt <= at) return;
    clearTimeout(timer);
    timerAt = at;
    timer = setTimeout(sendNow, Math.max(0, at - Date.now()));
  });

  // A picture as PNG bytes in base64 ("" for an empty one). Painted pixels (ImageData) are written to the PNG as they
  // are, byte for byte: a canvas would round see-through colours by one or two (premultiplied alpha), and the slope
  // colours must stay exactly the web's.
  const CRC = new Uint32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc = (b) => { let c = 0xffffffff; for (let i = 0; i < b.length; i++) c = CRC[(c ^ b[i]) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  function chunk(type, data) {
    const out = new Uint8Array(12 + data.length), v = new DataView(out.buffer);
    v.setUint32(0, data.length);
    for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
    out.set(data, 8);
    v.setUint32(8 + data.length, crc(out.subarray(4, 8 + data.length)));
    return out;
  }
  async function pngOf(img) {
    const w = img.width, h = img.height, raw = new Uint8Array((w * 4 + 1) * h);
    for (let y = 0; y < h; y++) raw.set(img.data.subarray(y * w * 4, (y + 1) * w * 4), y * (w * 4 + 1) + 1);   // filter 0 per row
    const z = new Uint8Array(await new Response(new Blob([raw]).stream().pipeThrough(new CompressionStream("deflate"))).arrayBuffer());
    const head = new Uint8Array(13), v = new DataView(head.buffer);
    v.setUint32(0, w); v.setUint32(4, h); head[8] = 8; head[9] = 6;   // 8 bits, RGBA
    const parts = [new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", head), chunk("IDAT", z), chunk("IEND", new Uint8Array(0))];
    const out = new Uint8Array(parts.reduce((a, p) => a + p.length, 0));
    parts.reduce((at, p) => (out.set(p, at), at + p.length), 0);
    return out;
  }
  const b64 = (b) => { let s = ""; for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode.apply(null, b.subarray(i, i + 0x8000)); return btoa(s); };
  async function png(img) {
    if (!img) return "";
    if (img instanceof ImageData) {
      let any = false;
      for (let i = 3; i < img.data.length; i += 4) if (img.data[i]) { any = true; break; }
      if (!any) return "";
      if (typeof CompressionStream !== "undefined") return b64(await pngOf(img));
    }
    const w = img.width || 256, h = img.height || 256;
    const cv = typeof OffscreenCanvas !== "undefined" ? new OffscreenCanvas(w, h) : Object.assign(document.createElement("canvas"), { width: w, height: h });
    const cx = cv.getContext("2d");
    if (img instanceof ImageData) cx.putImageData(img, 0, 0);
    else { cx.drawImage(img, 0, 0); if (img.close) img.close(); }
    const blob = cv.convertToBlob ? await cv.convertToBlob({ type: "image/png" }) : await new Promise((ok) => cv.toBlob(ok, "image/png"));
    if (!blob) return "";
    return b64(new Uint8Array(await blob.arrayBuffer()));
  }
  const jobs = new Map();
  N.on("groundTile", async (e) => {
    const g = reg()[e.id], ac = new AbortController();
    jobs.set(e.r, ac);
    let data = "";
    try { if (g && isOn(g)) data = await png(await g.paint(+e.z, +e.x, +e.y, ac.signal)); } catch { data = "!"; }   // failed (no signal...): asked again later
    jobs.delete(e.r);
    if (!ac.signal.aborted) N.post("ground", `T|${e.r}|${data}`);
  });
  N.on("groundStop", (e) => { const j = jobs.get(e.r); if (j) { jobs.delete(e.r); j.abort(); } });
  // The first time a native 3D map with ground layers opens on this phone, its layers stop sending to the web 3D map.
  N.on("groundReady", () => { try { localStorage.setItem("tf-native-ground", "1"); } catch {} });
})();
