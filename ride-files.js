// Reads ride files from other apps (Strava, Garmin, Wahoo, Trailforks…) for "Import rides" in ride.html.
// GPX, TCX and FIT, plain or gzipped (.gpx.gz, .fit.gz, .tcx.gz, as in Strava's "Download your data" export).
// tfRideFiles.read(file) -> { name, sport, points } with points as [lat, lon, altitude or null, time ms or null, null],
// the same shape Record ride uses. Throws an Error with a plain message when the file can't be read.
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

  window.tfRideFiles = { read };
})();
