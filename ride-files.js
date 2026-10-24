// Reads ride files from other apps (Strava, Garmin, Wahoo, Trailforks…) for "Import rides" in ride.html.
// GPX, TCX and FIT, plain or gzipped (.gpx.gz, .fit.gz, .tcx.gz, as in Strava's "Download your data" export).
// tfRideFiles.read(file) -> { name, sport, points } with points as [lat, lon, altitude or null, time ms or null, null],
// the same shape Record ride uses. Throws an Error with a plain message when the file can't be read.
// tfRideFiles.openZip(file) reads Strava's whole archive (.zip) without unzipping it; stravaCsv reads its activities.csv.
(() => {
  "use strict";

  async function bytesOf(file) {
    let buf = new Uint8Array(await file.arrayBuffer());
    if (buf[0] === 0x1f && buf[1] === 0x8b) {
      if (!window.DecompressionStream) throw new Error("this browser can't unzip .gz files; unzip it first");
      const stream = new Blob([buf]).stream().pipeThrough(new DecompressionStream("gzip"));
      buf = new Uint8Array(await new Response(stream).arrayBuffer());
    }
    return buf;
  }
  const num = (s) => { const v = parseFloat(s); return Number.isFinite(v) ? v : null; };
  const when = (s) => { const t = s ? Date.parse(s) : NaN; return Number.isFinite(t) ? t : null; };
  const kid = (el, name) => { for (const c of el.children) if (c.localName === name) return c; return null; };
  const text = (el, name) => { const c = el && kid(el, name); return c ? c.textContent.trim() : ""; };

  // ---------- GPX: <trkpt lat lon><ele/><time/></trkpt>, or <rtept> for a planned route ----------
  function gpx(doc) {
    let pts = [...doc.getElementsByTagNameNS("*", "trkpt")];
    if (!pts.length) pts = [...doc.getElementsByTagNameNS("*", "rtept")];
    const trk = doc.getElementsByTagNameNS("*", "trk")[0], meta = doc.getElementsByTagNameNS("*", "metadata")[0];
    return {
      name: text(trk, "name") || text(meta, "name"),
      sport: text(trk, "type"),
      points: pts.map((p) => [num(p.getAttribute("lat")), num(p.getAttribute("lon")), num(text(p, "ele")), when(text(p, "time")), null]),
    };
  }

  // ---------- TCX: <Trackpoint><Time/><Position><LatitudeDegrees/><LongitudeDegrees/></Position><AltitudeMeters/> ----------
  function tcx(doc) {
    const act = doc.getElementsByTagNameNS("*", "Activity")[0];
    return {
      name: text(act, "Notes"),
      sport: act ? act.getAttribute("Sport") || "" : "",
      points: [...doc.getElementsByTagNameNS("*", "Trackpoint")].map((p) => {
        const pos = kid(p, "Position");
        return [num(text(pos, "LatitudeDegrees")), num(text(pos, "LongitudeDegrees")), num(text(p, "AltitudeMeters")), when(text(p, "Time")), null];
      }),
    };
  }

  // ---------- FIT (Garmin's binary format): only the "record" messages (GPS points) are read ----------
  const FIT_EPOCH = 631065600000;              // 1989-12-31 00:00 UTC, in Unix ms
  const SEMI = 180 / 2 ** 31;                  // semicircles to degrees
  function fit(buf) {
    const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
    const hsize = buf[0];
    if (buf.length < 12 || String.fromCharCode(buf[8], buf[9], buf[10], buf[11]) !== ".FIT") throw new Error("not a FIT file");
    const end = Math.min(buf.length, hsize + dv.getUint32(4, true));
    const defs = {}, points = [];
    let i = hsize, lastTs = null, sport = "";
    const read = (off, size, base, le) => {
      // base type low 5 bits: 0x00/0x02/0x0A enum/uint8, 0x01 sint8, 0x03 sint16, 0x04 uint16, 0x05 sint32, 0x06/0x0C uint32
      switch (base & 0x1f) {
        case 0x01: return size === 1 ? dv.getInt8(off) : null;
        case 0x03: return size === 2 ? dv.getInt16(off, le) : null;
        case 0x04: case 0x0b: return size === 2 ? dv.getUint16(off, le) : null;
        case 0x05: return size === 4 ? dv.getInt32(off, le) : null;
        case 0x06: case 0x0c: return size === 4 ? dv.getUint32(off, le) : null;
        default: return size === 1 ? dv.getUint8(off) : null;
      }
    };
    while (i < end) {
      const h = buf[i++];
      if (h & 0x80) {                          // compressed timestamp header: a data message with a 5-bit time offset
        const def = defs[(h >> 5) & 3];
        if (!def) throw new Error("damaged FIT file");
        const off = h & 0x1f;
        if (lastTs != null) { let t = (lastTs & ~0x1f) + off; if (off < (lastTs & 0x1f)) t += 32; lastTs = t; }
        i = message(def, i, lastTs);
      } else if (h & 0x40) {                   // definition message
        const le = buf[i + 1] === 0, n = buf[i + 4];
        const def = { le, global: dv.getUint16(i + 2, le), fields: [], size: 0 };
        i += 5;
        for (let k = 0; k < n; k++, i += 3) { def.fields.push([buf[i], buf[i + 1], buf[i + 2]]); def.size += buf[i + 1]; }
        if (h & 0x20) { const nd = buf[i++]; for (let k = 0; k < nd; k++, i += 3) def.size += buf[i + 1]; }
        defs[h & 0x0f] = def;
      } else {
        const def = defs[h & 0x0f];
        if (!def) throw new Error("damaged FIT file");
        i = message(def, i, null);
      }
    }
    function message(def, at, ts) {
      const v = {};
      let off = at;
      for (const [f, size, base] of def.fields) { if (off + size <= buf.length) v[f] = read(off, size, base, def.le); off += size; }
      if (v[253] != null && v[253] !== 0xffffffff) { lastTs = v[253]; ts = v[253]; }
      if (def.global === 20) {                 // record
        const lat = v[0], lon = v[1];
        if (lat != null && lon != null && lat !== 0x7fffffff && lon !== 0x7fffffff && !(lat === 0 && lon === 0)) {
          const alt = v[78] != null && v[78] !== 0xffffffff ? v[78] / 5 - 500 : v[2] != null && v[2] !== 0xffff ? v[2] / 5 - 500 : null;
          points.push([lat * SEMI, lon * SEMI, alt, ts != null ? FIT_EPOCH + ts * 1000 : null, null]);
        }
      } else if (def.global === 18 && v[5] != null && !sport) {   // session: sport 2 cycling, 12 cross-country skiing, 13 alpine skiing, 14 snowboarding, 35 snowshoeing
        sport = { 2: "cycling", 12: "cross_country_skiing", 13: "alpine_skiing", 14: "snowboarding", 35: "snowshoeing" }[v[5]] || "";
      }
      return at + def.size;
    }
    return { name: "", sport, points };
  }

  async function read(file) {
    const buf = await bytesOf(file);
    let out;
    if (buf.length >= 12 && String.fromCharCode(buf[8], buf[9], buf[10], buf[11]) === ".FIT") out = fit(buf);
    else {
      const doc = new DOMParser().parseFromString(new TextDecoder().decode(buf), "application/xml");
      const root = doc.documentElement;
      if (!root || doc.getElementsByTagName("parsererror").length) throw new Error("not a GPX, TCX or FIT file");
      if (root.localName === "gpx") out = gpx(doc);
      else if (root.localName === "TrainingCenterDatabase") out = tcx(doc);
      else throw new Error("not a GPX, TCX or FIT file");
    }
    out.points = out.points.filter((p) => p[0] != null && p[1] != null && Math.abs(p[0]) <= 90 && Math.abs(p[1]) <= 180);
    if (out.points.length < 2) throw new Error("no GPS track in it");
    return out;
  }

  // ---------- ZIP archives (Strava's "Download your data" export), read in place ----------
  // Only the central directory at the end and each entry asked for are read from the file (File.slice), so a
  // several-GB archive full of photos never has to fit in memory. Stored and deflated entries, ZIP64 too.
  async function openZip(file) {
    const at = async (from, len) => new DataView(await file.slice(from, from + len).arrayBuffer());
    const tailLen = Math.min(file.size, 65557), tailFrom = file.size - tailLen, tail = await at(tailFrom, tailLen);
    let e = -1;
    for (let i = tailLen - 22; i >= 0; i--) if (tail.getUint32(i, true) === 0x06054b50) { e = i; break; }
    if (e < 0) throw new Error("not a ZIP file");
    let count = tail.getUint16(e + 10, true), dirSize = tail.getUint32(e + 12, true), dirAt = tail.getUint32(e + 16, true);
    const big = (dv, o) => dv.getUint32(o, true) + dv.getUint32(o + 4, true) * 2 ** 32;
    if (e >= 20 && tail.getUint32(e - 20, true) === 0x07064b50) {          // ZIP64: the real numbers are in another record
      const z = await at(big(tail, e - 12), 56);
      if (z.getUint32(0, true) === 0x06064b50) { count = big(z, 32); dirSize = big(z, 40); dirAt = big(z, 48); }
    }
    const dir = await at(dirAt, dirSize), entries = [];
    for (let o = 0, k = 0; k < count && o + 46 <= dirSize; k++) {
      if (dir.getUint32(o, true) !== 0x02014b50) throw new Error("damaged ZIP file");
      const method = dir.getUint16(o + 10, true);
      let csize = dir.getUint32(o + 20, true), size = dir.getUint32(o + 24, true), local = dir.getUint32(o + 42, true);
      const nl = dir.getUint16(o + 28, true), xl = dir.getUint16(o + 30, true), cl = dir.getUint16(o + 32, true);
      const nameBytes = new Uint8Array(dir.buffer, dir.byteOffset + o + 46, nl);
      const name = new TextDecoder().decode(nameBytes);
      for (let x = o + 46 + nl; x + 4 <= o + 46 + nl + xl;) {               // ZIP64 extra field: sizes and offset
        const id = dir.getUint16(x, true), len = dir.getUint16(x + 2, true);
        if (id === 1) {
          let y = x + 4;
          if (size === 0xffffffff) { size = big(dir, y); y += 8; }
          if (csize === 0xffffffff) { csize = big(dir, y); y += 8; }
          if (local === 0xffffffff) local = big(dir, y);
        }
        x += 4 + len;
      }
      if (!name.endsWith("/")) entries.push({ name, size, csize, method, local });
      o += 46 + nl + xl + cl;
    }
    async function bytes(ent) {
      const h = await at(ent.local, 30);
      if (h.getUint32(0, true) !== 0x04034b50) throw new Error("damaged ZIP file");
      const from = ent.local + 30 + h.getUint16(26, true) + h.getUint16(28, true);
      const raw = file.slice(from, from + ent.csize);
      if (ent.method === 0) return new Uint8Array(await raw.arrayBuffer());
      if (ent.method !== 8) throw new Error("packed in a way this app can't read");
      if (!window.DecompressionStream) throw new Error("this browser can't unzip; unzip the archive first and pick the files in its activities folder");
      return new Uint8Array(await new Response(raw.stream().pipeThrough(new DecompressionStream("deflate-raw"))).arrayBuffer());
    }
    return { entries, bytes };
  }

  // Strava's activities.csv: one row per activity. Headers follow the account's language, so the columns are found by
  // name in English or French, or else by Strava's usual order (id, date, name, type, …) and the file column by its
  // contents ("activities/123.gpx.gz"). -> Map of file path -> { id, name, type }
  function stravaCsv(text) {
    const rows = [];
    let row = [], cell = "", q = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (q) { if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += c; }
      else if (c === '"') q = true;
      else if (c === ",") { row.push(cell); cell = ""; }
      else if (c === "\n" || c === "\r") { if (c === "\r" && text[i + 1] === "\n") i++; row.push(cell); rows.push(row); row = []; cell = ""; }
      else cell += c;
    }
    if (cell || row.length) { row.push(cell); rows.push(row); }
    const head = (rows.shift() || []).map((h) => h.replace(/^﻿/, "").trim().toLowerCase());
    const col = (re, d) => { const i = head.findIndex((h) => re.test(h)); return i >= 0 ? i : d; };
    const body = rows.filter((r) => r.length > 3);
    let fc = col(/^(filename|nom du fichier|fichier)$/, -1);
    if (fc < 0) fc = head.findIndex((_, i) => body.some((r) => /^activities\//.test(r[i] || "")));
    const ic = col(/^(activity id|id de l.activit[eé])$/, 0);
    const nc = col(/^(activity name|nom de l.activit[eé])$/, 2);
    const tc = col(/^(activity type|type d.activit[eé])$/, 3);
    const out = new Map();
    if (fc >= 0) body.forEach((r) => { if (r[fc]) out.set(r[fc].trim(), { id: (r[ic] || "").trim(), name: (r[nc] || "").trim(), type: (r[tc] || "").trim() }); });
    return out;
  }
  // A bike ride, from Strava's activity type (English or French) or the file's own sport. null when neither says.
  function isBike(type, sport) {
    const t = String(type || "").trim();
    if (t) return /ride|bike|cycl|v[ée]lo|vtt|gravel|velomobile|handcycle/i.test(t) && !/virtual|virtuel/i.test(t);
    const s = String(sport || "").trim();
    if (s) return /cycl|bik|mtb|ride|v[ée]lo|^[12]$/i.test(s);
    return null;
  }

  window.tfRideFiles = { read, openZip, stravaCsv, isBike };
})();
