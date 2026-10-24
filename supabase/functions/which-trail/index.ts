// Trail Finder "Which trail is this?": an AI (Google Gemini, free tier) looks at a trail photo (or a few frames of a
// video) and says what it sees that can place it: trail names written in it, big landmarks in the background (the
// Chief, Black Tusk...), places, the kind of terrain, and its best guesses. The site (photo-find.js) then matches that
// against its own trail lists. A second call ("compare") then takes the app's likely trails, searches Google for what
// riders and sites say each one looks like, gathers photos of them (pictures on those pages, video thumbnails, geotagged
// Wikimedia Commons photos near each trail) and compares them with the rider's picture. Setup (once): Supabase dashboard → Edge Functions → deploy this file (it's deployed as
// "smooth-worker"; AI_FN in photo-find.js must match), turn "Verify JWT" off; then Edge Functions → Secrets → add
// GEMINI_API_KEY (free from aistudio.google.com/apikey). Optional secret GEMINI_MODEL picks another model.
// Optional secret VISION_API_KEY (Google Cloud Vision, 1,000 pictures a month free): a reverse image search first, which
// finds the pages that show the same picture (or video frame) online; their titles often name the trail.
// Free-tier pictures may be used by Google to improve its products; a paid Google key stops that.
// Daily limits for the whole app (supabase/photo-ai-limits.sql, run once): VISION_PER_DAY reverse searches (30: the
// 1,000 a month Google gives free), AI_PER_DAY looks and COMPARE_PER_DAY online checks; each can be changed with a
// secret of that name. Until that SQL is run, each running copy of the function keeps its own count.

const ORIGINS = [/^https:\/\/allduf\.github\.io$/, /^http:\/\/localhost(:\d+)?$/];
const MAX_IMAGES = 3, MAX_B64 = 1_500_000, PER_HOUR = 30;
const PER_DAY = { vision: 30, ai: 200, compare: 100 };
// Tried in turn: a name Google retired (404), one that is too slow or one whose free allowance is used up (429) moves on
// to the next. Each model has its own free allowance, so the later ones keep photo find working when the first runs out.
// Google's model list (ai.google.dev/gemini-api/docs/models, 2026-10): the Flash models first (they see scenery best), then
// the Flash-Lite ones. Names Google stops serving are skipped.
const MODELS = ["gemini-flash-latest", "gemini-3.6-flash", "gemini-3-flash-preview", "gemini-2.5-flash",
  "gemini-flash-lite-latest", "gemini-3.5-flash-lite", "gemini-3.1-flash-lite", "gemini-2.5-flash-lite"];
// Ways to ask for little or no thinking (it answers in seconds instead of tens of seconds): Gemini 2.5 takes a budget,
// Gemini 3 and later a level. A model that refuses one setting is asked with the next.
const THINK = [{ thinkingLevel: "minimal" }, { thinkingBudget: 0 }, { thinkingLevel: "low" }, null];
const slow = new Set<string>();   // models that ran out of time in this running copy: tried last from then on
// model (or "model search": Google Search with it) -> when to try it again: that free allowance was used up (429). Google
// Search has an allowance of its own (often none on a free key): running out of it doesn't stop plain answers.
const spent = new Map<string, number>();
const gone = new Set<string>();   // model names Google doesn't serve (404): not asked again by this running copy
const seen = new Map<string, number[]>();   // a light brake per address (each running copy of the function keeps its own)

const list = (description: string) => ({ type: "ARRAY", items: { type: "STRING" }, description });
const SCHEMA = {
  type: "OBJECT",
  properties: {
    trail_names: list("Trail names written anywhere in the pictures or text (signs, captions, overlays, hashtags), as written"),
    landmarks: list("Named landmarks you can see or that are named, using the names from the landmark list when one fits"),
    views: {
      type: "ARRAY",
      description: "Each named landmark you can actually see in the picture (not only named in its text), with where it is across the picture: 0 = left edge, 0.5 = middle, 1 = right edge. Left to right",
      items: { type: "OBJECT", properties: { name: { type: "STRING" }, x: { type: "NUMBER" } }, required: ["name", "x"] },
    },
    places: list("Towns, riding areas or regions the pictures or text point to"),
    terrain: list("Short plain words for what the trail and background look like: granite slabs, roots, loam, alpine, desert, cedar forest, lake below, ocean view..."),
    scene: { type: "STRING", description: "One or two sentences on what is in the picture and where it might be" },
    viewpoint: {
      type: "OBJECT",
      description: "Your best estimate of where the camera stood, worked out from the background (which peaks, water, towns are where, and from what angle). km is how far off you might be; 0 when you can't tell",
      properties: {
        lat: { type: "NUMBER" }, lon: { type: "NUMBER" },
        km: { type: "NUMBER", description: "0 when you can't tell; else how far off the spot might be, in km" },
        where: { type: "STRING", description: "A few words for that spot, like 'above Britannia Beach'" },
      },
      required: ["lat", "lon", "km", "where"],
    },
    guesses: {
      type: "ARRAY",
      description: "Up to 3 trails you think it is, best first; empty when you don't know",
      items: {
        type: "OBJECT",
        properties: {
          trail: { type: "STRING", description: "A trail name, only if you have a real reason to think so" },
          area: { type: "STRING" },
          why: { type: "STRING" },
        },
        required: ["trail", "area", "why"],
      },
    },
  },
  required: ["trail_names", "landmarks", "views", "places", "terrain", "scene", "viewpoint", "guesses"],
};

type Viewpoint = { lat: number; lon: number; km: number; where: string } | null;
type Out = { trail_names: string[]; landmarks: string[]; views: { name: string; x: number }[]; places: string[]; terrain: string[]; scene: string; viewpoint: Viewpoint;
  guesses: { trail: string; area: string; why: string }[] };
const strs = (v: unknown) => (Array.isArray(v) ? v.filter((s) => typeof s === "string").map((s) => s.slice(0, 120)).slice(0, 12) : []);
// Only a spot inside the app's area (British Columbia and Alberta) with a usable size counts.
function spot(v: unknown): Viewpoint {
  const o = v as Record<string, unknown> | null;
  if (!o || typeof o.lat !== "number" || typeof o.lon !== "number" || typeof o.km !== "number") return null;
  if (o.lat < 48 || o.lat > 60.5 || o.lon < -139.5 || o.lon > -109.5 || !(o.km > 0) || o.km > 50) return null;
  return { lat: o.lat, lon: o.lon, km: o.km, where: String(o.where || "").slice(0, 80) };
}
function clean(o: Record<string, unknown>): Out {
  const g = Array.isArray(o.guesses) ? o.guesses : [];
  return {
    trail_names: strs(o.trail_names), landmarks: strs(o.landmarks), places: strs(o.places), terrain: strs(o.terrain),
    // Where each landmark seen is across the picture (the site works out from where the picture can show them so).
    views: (Array.isArray(o.views) ? o.views : []).filter((v) => v && typeof v.name === "string" && typeof v.x === "number" && v.x >= 0 && v.x <= 1)
      .slice(0, 6).map((v) => ({ name: v.name.slice(0, 120), x: Math.round(v.x * 100) / 100 })),
    scene: typeof o.scene === "string" ? o.scene.slice(0, 600) : "",
    viewpoint: spot(o.viewpoint),
    guesses: g.filter((x) => x && typeof x.trail === "string").slice(0, 3)
      .map((x) => ({ trail: x.trail.slice(0, 120), area: String(x.area || "").slice(0, 120), why: String(x.why || "").slice(0, 300) })),
  };
}

function headers(origin: string | null) {
  const ok = origin && ORIGINS.some((r) => r.test(origin));
  return { "Access-Control-Allow-Origin": ok ? origin! : "https://allduf.github.io", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS", "Content-Type": "application/json" };
}

Deno.serve(async (req) => {
  const origin = req.headers.get("origin"), h = headers(origin);
  if (req.method === "OPTIONS") return new Response("ok", { headers: h });
  const reply = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: h });
  if (req.method !== "POST" || !origin || !ORIGINS.some((r) => r.test(origin))) return reply(403, { error: "not allowed" });
  let body: { images?: string[]; text?: string; description?: string; area?: string; landmarks?: string[]; mode?: string; trails?: unknown; scene?: string; hash?: string; skip?: unknown };
  try { body = await req.json(); } catch { return reply(400, { error: "bad request" }); }
  if (body.mode === "same") return reply(200, { same: await same(body.hash) });   // no AI: not counted
  const key = Deno.env.get("GEMINI_API_KEY");
  if (!key) return reply(503, { error: "GEMINI_API_KEY is not set" });
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0].trim() || "?";
  const now = Date.now(), recent = (seen.get(ip) || []).filter((t) => now - t < 3600e3);
  if (recent.length >= PER_HOUR) return reply(429, { error: "too many pictures this hour" });
  seen.set(ip, [...recent, now]);

  const images = (body.images || []).filter((s) => typeof s === "string" && s.length < MAX_B64).slice(0, MAX_IMAGES);
  if (!images.length) return reply(400, { error: "no picture" });
  const kind = body.mode === "compare" ? "compare" : "ai";
  if (!(await take(kind))) return reply(429, { error: `the photo AI's daily limit is used up (${kind === "ai" ? "looks" : "online checks"}), try again tomorrow` });
  const clip = (s: unknown, n: number) => (typeof s === "string" ? s.slice(0, n) : "");

  const prompt = `These are ${images.length > 1 ? "frames from a mountain bike video" : "a mountain bike picture"} (often a screenshot of a social media post). ` +
    `Help find which trail it is. The app covers British Columbia (Vancouver to the Rockies) and Alberta riding areas.\n` +
    `Look at everything: words written anywhere, the post's caption, location tags, Strava or Trailforks overlays, and the background: ` +
    `big mountains, rock walls, peaks, glaciers, lakes, ocean, towns, ski runs, the type of forest, rock and dirt.\n` +
    `Then work out where the camera stood: which way the landmarks, water and valleys lie, and how high above them, and give that spot as the viewpoint. ` +
    `For each landmark you can see in the picture, say where it sits across the picture (views).\n` +
    `Only name a landmark you really recognise; say nothing rather than guess. Prefer these landmark names when one fits: ${(body.landmarks || []).slice(0, 120).map((s) => clip(s, 60)).join("; ")}.\n` +
    (clip(body.area, 80) ? `The rider thinks it's in: ${clip(body.area, 80)}.\n` : "") +
    (clip(body.description, 800) ? `The rider describes it as: """${clip(body.description, 800)}"""\n` : "") +
    (clip(body.text, 2000) ? `Words already read from the picture (may have errors): """${clip(body.text, 2000)}"""\n` : "");

  const t0 = Date.now();
  if (body.mode === "compare") return compare(body as Compare, images, key, t0, reply);
  const online = await reverse(images);
  const found = online && online.pages.length ? `The same ${images.length > 1 ? "frames were" : "picture was"} found online on these pages (their titles and addresses often name the trail and area):\n` +
    online.pages.map((p) => `- ${p.title} (${p.url.slice(0, 160)})`).join("\n") + (online.labels.length ? `\nGoogle's best guess for it: ${online.labels.join("; ")}` : "") + "\n" : "";
  const r = await gemini(key, [...images.map((d) => img(d)), { text: prompt + found }], { schema: SCHEMA }, t0 + 40000);
  const empty = clean({});
  if ("error" in r) return online?.pages.length ? reply(200, { ok: true, ms: Date.now() - t0, ...empty, online, aiError: r.error }) : reply(r.status, { error: r.error, detail: r.detail, online });
  if (!r.text) return reply(200, { ok: !!online?.pages.length, ms: Date.now() - t0, ...empty, online });   // blocked, or nothing to say
  try { return reply(200, { ok: true, model: r.model, ms: Date.now() - t0, ...clean(JSON.parse(r.text)), online }); } catch { return reply(200, { ok: !!online?.pages.length, ...empty, online }); }
});

// Reverse image search (Google Cloud Vision web detection): the pages that show the same picture or video frame, and
// Google's best guess and the things it links to the picture. One call for all the frames.
type Online = { pages: { url: string; title: string; same: boolean }[]; labels: string[]; entities: string[]; error?: string };
async function reverse(images: string[]): Promise<Online | null> {
  const k = Deno.env.get("VISION_API_KEY");
  if (!k) return null;
  if (!(await take("vision"))) return { pages: [], labels: [], entities: [], error: "today's free reverse searches are used up" };
  const strip = (v: unknown) => String(v || "").replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").replace(/&#39;/g, "'").replace(/&quot;/g, '"').trim().slice(0, 200);
  try {
    const r = await fetch("https://vision.googleapis.com/v1/images:annotate", {
      method: "POST", headers: { "content-type": "application/json", "x-goog-api-key": k }, signal: AbortSignal.timeout(9000),
      body: JSON.stringify({ requests: images.map((content) => ({ image: { content }, features: [{ type: "WEB_DETECTION", maxResults: 15 }] })) }),
    });
    if (!r.ok) {
      const why = await r.text().catch(() => "");
      console.log("vision", r.status, why.slice(0, 300));
      return { pages: [], labels: [], entities: [], error: r.status === 403 ? "reverse search isn't allowed on this key (Cloud Vision API or billing not turned on)" : `reverse search failed (${r.status})` };
    }
    type W = { pagesWithMatchingImages?: { url?: string; pageTitle?: string; fullMatchingImages?: unknown[] }[]; bestGuessLabels?: { label?: string }[]; webEntities?: { description?: string; score?: number }[] };
    const ws = ((await r.json()).responses || []).map((x: { webDetection?: W }) => x.webDetection || {}) as W[];
    const pages = new Map<string, { url: string; title: string; same: boolean }>();
    for (const w of ws) for (const p of w.pagesWithMatchingImages || []) {
      if (!p.url || !/^https?:/.test(p.url) || pages.has(p.url)) continue;
      pages.set(p.url, { url: p.url.slice(0, 400), title: strip(p.pageTitle), same: !!p.fullMatchingImages?.length });
    }
    return {
      // Pages with the very same picture first.
      pages: [...pages.values()].sort((a, b) => +b.same - +a.same).slice(0, 12),
      labels: [...new Set(ws.flatMap((w) => (w.bestGuessLabels || []).map((l) => strip(l.label))).filter(Boolean))].slice(0, 3),
      entities: [...new Set(ws.flatMap((w) => (w.webEntities || []).filter((e) => (e.score || 0) >= 0.3).map((e) => strip(e.description))).filter(Boolean))].slice(0, 10),
    };
  } catch (e) {
    console.log("vision", String(e));
    return { pages: [], labels: [], entities: [], error: "reverse search didn't answer" };
  }
}

const img = (data: string, mime = "image/jpeg") => ({ inline_data: { mime_type: mime, data } });

// One Gemini answer from the first model that answers in time. schema: JSON in that shape; search: Google Search on (then
// no schema: Gemini 2.5 can't do both, so the prompt asks for JSON in the text). Each model but the last gets at most
// PER_MODEL ms, so one slow model can't use up all the time.
const PER_MODEL = 16000;
type Said = { text: string; model: string; meta: Record<string, unknown> | null } | { status: number; error: string; detail?: string; search?: boolean };
async function gemini(key: string, parts: unknown[], o: { schema?: unknown; search?: boolean }, until: number): Promise<Said> {
  const ask = (think: Record<string, unknown> | null) => JSON.stringify({
    contents: [{ role: "user", parts }],
    ...(o.search ? { tools: [{ google_search: {} }] } : {}),
    generationConfig: { temperature: 0.2, ...(o.schema ? { responseMimeType: "application/json", responseSchema: o.schema } : {}), ...(think ? { thinkingConfig: think } : {}) },
  });
  const used = (k: string) => (spent.get(k) || 0) > Date.now();
  const named = [Deno.env.get("GEMINI_MODEL"), ...MODELS].filter((m, i, a): m is string => !!m && a.indexOf(m) === i && !gone.has(m) && !used(m) && !(o.search && used(m + " search")));
  const models = [...named.filter((m) => !slow.has(m)), ...named.filter((m) => slow.has(m))];
  const notes: string[] = [];   // what happened with each model, shown when none answers (and in the function's Logs)
  let late = false, busy = !models.length;
  for (const [n, model] of models.entries()) {
    const left = until - Date.now();
    if (left < 2500) break;
    const t1 = Date.now(), stop = t1 + (n === models.length - 1 ? left : Math.min(left, PER_MODEL));
    const note = (why: string) => { notes.push(`${model}: ${why}`); console.log("gemini", model, why, Date.now() - t1, "ms"); };
    let r: Response | null = null;
    try {
      for (const think of THINK) {
        r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
          { method: "POST", headers: { "content-type": "application/json", "x-goog-api-key": key }, body: ask(think), signal: AbortSignal.timeout(Math.max(1000, stop - Date.now())) });
        if (r.status !== 400 || !think) break;
        if (!/thinking/i.test(await r.clone().text())) break;   // another 400: handled below
      }
    } catch (e) {
      if (e instanceof DOMException && e.name === "TimeoutError") { slow.add(model); late = true; note(`too slow (${Math.round((Date.now() - t1) / 1000)} s)`); continue; }
      note("network error " + String(e).slice(0, 80));
      continue;
    }
    if (!r) continue;
    if (r.status === 404) { gone.add(model); note("not available (404)"); continue; }   // that model name is gone: try the next
    if (r.status === 429) {
      // Used up: today's allowance (back at midnight Pacific; tried again in an hour) or this minute's. Try the next model.
      const msg = await r.text().catch(() => "");
      const daily = /per ?day|PerDay|daily/i.test(msg);
      spent.set(o.search ? model + " search" : model, Date.now() + (daily ? 3600e3 : 60e3));
      busy = true;
      note(`${o.search ? "Google search: " : ""}${daily ? "today's free allowance is used up" : "busy this minute"} (429${quota(msg)})`);
      continue;
    }
    if (r.status === 400 || r.status === 401 || r.status === 403) {
      const msg = await r.text();
      if (/API key|API_KEY|UNAUTHENTICATED/i.test(msg)) return { status: 503, error: "the API key was refused" };
      if (o.search && /search|ground|tool/i.test(msg)) return { status: 502, error: "the picture check failed (" + r.status + ")", search: true };
      let m = msg;
      try { m = JSON.parse(msg).error.message || msg; } catch { /* not JSON */ }
      note(`error ${r.status}: ${m.slice(0, 120)}`);
      continue;                                           // this model can't take the request: try the next
    }
    if (!r.ok) { note(`error ${r.status}`); continue; }
    console.log("gemini", model, "answered", Date.now() - t1, "ms");
    const j = await r.json().catch(() => null);
    slow.delete(model);
    const cand = j?.candidates?.[0];
    const text = (cand?.content?.parts || []).filter((p: { text?: string; thought?: boolean }) => typeof p.text === "string" && !p.thought).map((p: { text: string }) => p.text).join("");
    return { text, model, meta: cand?.groundingMetadata || null };
  }
  if (busy && !late) return { status: 429, error: "the free AI is busy or used up for today, try again later", detail: notes.join("; ") || "every model is used up", search: o.search };
  return { status: late ? 504 : 502, error: `no AI model answered (${notes.join("; ") || "no time left"})` };
}

// Which allowance Google says ran out, and its size ("…FreeTier, limit 20"): a limit of 0 means the free tier has none.
function quota(msg: string): string {
  try {
    type V = { quotaId?: string; quotaValue?: string };
    const v = ((JSON.parse(msg).error?.details || []) as { violations?: V[] }[]).flatMap((d) => d.violations || [])[0];
    return v ? `: ${String(v.quotaId || "").slice(0, 70)}${v.quotaValue ? ", limit " + v.quotaValue : ""}` : "";
  } catch { return ""; }
}

// ---------- compare: the app's likely trails against what's online about them ----------
type Trail = { name: string; area: string; kind: string; c: [number, number] | null };
type Compare = { trails?: unknown; scene?: string; description?: string; spot?: { lat?: unknown; lon?: unknown; km?: unknown; where?: unknown }; skip?: unknown };
type Photo = { img: string; page: string; title: string; trail: string; data: string; mime: string; from: string; at?: [number, number]; near?: boolean };
const norm = (s: string) => s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, " ").trim();
const UA = { "user-agent": "TrailFinder/1.0 (https://allduf.github.io/trail-finder/)" };
// Only plain public web addresses (no addresses inside Supabase's own network).
function publicUrl(u: string): URL | null {
  try {
    const x = new URL(u);
    if (x.protocol !== "https:" || x.port || /^(\d+\.){3}\d+$|^\[|localhost|\.local$|\.internal$|supabase/i.test(x.hostname)) return null;
    return x;
  } catch { return null; }
}
async function get(u: string, ms: number, max: number): Promise<{ res: Response; bytes: Uint8Array } | null> {
  const x = publicUrl(u);
  if (!x) return null;
  try {
    const res = await fetch(x, { headers: UA, redirect: "follow", signal: AbortSignal.timeout(ms) });
    if (!res.ok || !res.body) return null;
    const rd = res.body.getReader(), chunks: Uint8Array[] = [];
    let n = 0;
    while (n < max) { const { done, value } = await rd.read(); if (done) break; chunks.push(value); n += value.length; }
    rd.cancel().catch(() => {});
    if (n >= max && /^image\//.test(res.headers.get("content-type") || "")) return null;   // too big a picture
    const bytes = new Uint8Array(n); let o = 0;
    for (const c of chunks) { bytes.set(c.subarray(0, Math.min(c.length, n - o)), o); o += c.length; if (o >= n) break; }
    return { res, bytes };
  } catch { return null; }
}
const b64 = (u8: Uint8Array) => { let s = ""; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode(...u8.subarray(i, i + 0x8000)); return btoa(s); };
async function picture(u: string): Promise<{ data: string; mime: string } | null> {
  const g = await get(u, 5000, 600_000);
  const mime = g && (g.res.headers.get("content-type") || "").split(";")[0].trim();
  if (!g || !mime || !/^image\/(jpeg|png|webp)$/.test(mime) || g.bytes.length < 3000) return null;   // tiny = a placeholder
  return { data: b64(g.bytes), mime };
}
const tag = (html: string, prop: string) => {
  const m = html.match(new RegExp(`<meta[^>]+(?:property|name)=["']${prop}["'][^>]*content=["']([^"']+)`, "i")) ||
    html.match(new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]*(?:property|name)=["']${prop}["']`, "i"));
  return m ? m[1].replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;/g, "'") : "";
};
// A page Google found: its main picture (a video's thumbnail) and title.
async function pagePhoto(u: string): Promise<{ img: string; page: string; title: string } | null> {
  const x = publicUrl(u);
  if (!x) return null;
  const yt = x.hostname.endsWith("youtube.com") ? x.searchParams.get("v") || (x.pathname.match(/^\/shorts\/([\w-]{6,})/) || [])[1]
    : x.hostname === "youtu.be" ? x.pathname.slice(1) : "";
  if (yt && /^[\w-]{6,20}$/.test(yt)) {
    const page = "https://www.youtube.com/watch?v=" + yt;
    const o = await get("https://www.youtube.com/oembed?format=json&url=" + encodeURIComponent(page), 4000, 20_000);
    let title = "";
    try { title = o ? JSON.parse(new TextDecoder().decode(o.bytes)).title || "" : ""; } catch { /* no title */ }
    if (!o) return null;                                  // not a real video
    return { img: `https://i.ytimg.com/vi/${yt}/hqdefault.jpg`, page, title };
  }
  const g = await get(x.href, 5000, 400_000);
  if (!g || !/html/i.test(g.res.headers.get("content-type") || "")) return null;
  const html = new TextDecoder().decode(g.bytes);
  const im = tag(html, "og:image") || tag(html, "twitter:image");
  if (!im) return null;
  let img = "";
  try { img = new URL(im, g.res.url || x.href).href; } catch { return null; }
  const title = tag(html, "og:title") || (html.match(/<title[^>]*>([^<]{1,200})/i) || [])[1] || "";
  return { img, page: g.res.url || x.href, title: title.trim() };
}
// Geotagged photos on Wikimedia Commons within r metres of a spot (no key needed), with where each was taken.
async function commons(c: [number, number], r: number, n: number): Promise<{ img: string; page: string; title: string; at: [number, number] }[]> {
  const q = `https://commons.wikimedia.org/w/api.php?action=query&format=json&generator=geosearch&ggscoord=${c[0]}|${c[1]}&ggsradius=${Math.round(Math.min(10000, r))}` +
    `&ggsnamespace=6&ggslimit=${Math.min(50, n * 3)}&prop=imageinfo|coordinates&iiprop=url&iiurlwidth=640`;
  const g = await get(q, 5000, 400_000);
  try {
    type P = { title: string; imageinfo?: { thumburl?: string; descriptionurl?: string }[]; coordinates?: { lat: number; lon: number }[] };
    const pages = Object.values(JSON.parse(new TextDecoder().decode(g!.bytes)).query?.pages || {}) as P[];
    return pages.filter((p) => p.imageinfo?.[0]?.thumburl && p.coordinates?.[0] && /\.(jpe?g|png|webp)$/i.test(p.title))
      // Maps, logos and signs say nothing about the place.
      .filter((p) => !/\b(map|logo|sign|diagram|plan|chart|svg)\b/i.test(p.title)).slice(0, n)
      .map((p) => ({ img: p.imageinfo![0].thumburl!, page: p.imageinfo![0].descriptionurl || "", title: p.title.replace(/^File:/, "").replace(/\.\w+$/, ""),
        at: [p.coordinates![0].lat, p.coordinates![0].lon] as [number, number] }));
  } catch { return []; }
}
// ---------- riders' confirmed matches (supabase/trail-matches.sql) ----------
// The site can't read their details or pictures; this function can, with the key Supabase gives every function.
// Nothing here goes back to the site but trail names and places.
function db(path: string): Promise<Response | null> {
  const base = Deno.env.get("SUPABASE_URL"), sk = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!base || !sk) return Promise.resolve(null);
  return fetch(base + path, { headers: { apikey: sk, authorization: "Bearer " + sk }, signal: AbortSignal.timeout(4000) }).catch(() => null);
}
// One use of a daily limit (supabase/photo-ai-limits.sql): false when today's is used up. Without that table (or when the
// database doesn't answer) this running copy counts on its own.
const counted = new Map<string, number>();
async function take(kind: keyof typeof PER_DAY): Promise<boolean> {
  const cap = Math.max(0, Math.round(+(Deno.env.get(kind.toUpperCase() + "_PER_DAY") || PER_DAY[kind])));
  const base = Deno.env.get("SUPABASE_URL"), sk = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (base && sk) {
    try {
      const r = await fetch(base + "/rest/v1/rpc/photo_ai_take", { method: "POST", signal: AbortSignal.timeout(3000),
        headers: { apikey: sk, authorization: "Bearer " + sk, "content-type": "application/json" }, body: JSON.stringify({ p_kind: kind, p_cap: cap }) });
      if (r.ok) return (await r.json()) === true;
      console.log("limit", kind, r.status, (await r.text()).slice(0, 200));
    } catch (e) { console.log("limit", kind, String(e)); }
  }
  const day = new Date().toISOString().slice(0, 10) + kind, n = counted.get(day) || 0;
  if (n >= cap) return false;
  counted.set(day, n + 1);
  return true;
}
// Confirmed matches whose picture has nearly the same fingerprint (the same picture resized or recompressed).
async function same(hash: unknown) {
  if (typeof hash !== "string" || !/^[0-9a-f]{16}$/.test(hash)) return [];
  const r = await db("/rest/v1/trail_matches?select=trail_name,osm_type,osm_ids,zone,lat,lon,hash:details->>hash&details->>hash=not.is.null&order=created_at.desc&limit=2000");
  if (!r?.ok) return [];
  const bits = (a: string, b: string) => { let n = 0; for (let i = 0; i < 16; i++) { let x = parseInt(a[i], 16) ^ parseInt(b[i], 16); while (x) { n += x & 1; x >>= 1; } } return n; };
  try {
    const rows = (await r.json()) as { trail_name: string; hash: string | null }[];
    return rows.filter((x) => typeof x.hash === "string" && /^[0-9a-f]{16}$/.test(x.hash) && bits(hash, x.hash) <= 10)
      .slice(0, 3).map(({ hash: _, ...x }) => x);
  } catch { return []; }
}
// Pictures riders confirmed ("Is this the trail?" Yes) for these trails, from the private bucket, and (with a spot)
// confirmed pictures of other trails around where the AI placed this one: that's how each Yes teaches later searches.
// Only ever sent to the AI to compare, never back to the site. skip: match ids left out (the accuracy test's own photo).
type Spot = { c: [number, number]; r: number; where: string };
async function confirmed(trails: Trail[], skip: number[], spot: Spot | null): Promise<Photo[]> {
  const names = trails.map((t) => '"' + t.name.replace(/["\\]/g, (c) => "\\" + c) + '"').join(",");
  const notSkip = skip.length ? `&id=not.in.(${skip.join(",")})` : "";
  const r = await db(`/rest/v1/trail_matches?select=trail_name,photo&photo=not.is.null${notSkip}&trail_name=in.(${encodeURIComponent(names)})&order=created_at.desc&limit=30`);
  if (!r?.ok) return [];
  try {
    const rows = (await r.json()) as { trail_name: string; photo: string }[];
    const per = new Map<string, string[]>();
    for (const x of rows) { const l = per.get(x.trail_name) || []; if (l.length < 2 && !l.includes(x.photo)) per.set(x.trail_name, [...l, x.photo]); }
    // Riders' own photos on these trails (supabase/trail-photos.sql) fill in where there's no confirmed match yet.
    const r2 = await db(`/rest/v1/trail_photos?select=trail_name,path&trail_name=in.(${encodeURIComponent(names)})&order=created_at.desc&limit=30`);
    const extra: { trail: string; path: string; bucket: string }[] = [];
    if (r2?.ok) {
      try {
        const seen = new Map<string, number>();
        for (const x of (await r2.json()) as { trail_name: string; path: string }[]) {
          const n = (per.get(x.trail_name) || []).length + (seen.get(x.trail_name) || 0);
          if (n < 2) { seen.set(x.trail_name, (seen.get(x.trail_name) || 0) + 1); extra.push({ trail: x.trail_name, path: x.path, bucket: "trail-photos" }); }
        }
      } catch { /* no rider photos */ }
    }
    type Want = { trail: string; path: string; bucket: string; at?: [number, number] };
    const want: Want[] = [...per.entries()].flatMap(([trail, ps]) => ps.map((path) => ({ trail, path, bucket: "trail-match-photos" }))).concat(extra).slice(0, 4);
    // Around the spot: the newest confirmed picture of each other trail there, nearest first.
    if (spot) {
      const dLat = spot.r / 111200, dLon = dLat / Math.cos(spot.c[0] * Math.PI / 180);
      const r3 = await db(`/rest/v1/trail_matches?select=trail_name,photo,lat,lon&photo=not.is.null${notSkip}` +
        `&lat=gte.${spot.c[0] - dLat}&lat=lte.${spot.c[0] + dLat}&lon=gte.${spot.c[1] - dLon}&lon=lte.${spot.c[1] + dLon}&order=created_at.desc&limit=40`);
      if (r3?.ok) {
        try {
          const listed = new Set(trails.map((t) => norm(t.name))), seen = new Set<string>();
          const near = ((await r3.json()) as { trail_name: string; photo: string; lat: number; lon: number }[])
            .map((x) => ({ ...x, d: kmApart(spot.c, [x.lat, x.lon]) * 1000 })).filter((x) => x.d <= spot.r && !listed.has(norm(x.trail_name)))
            .filter((x) => !seen.has(norm(x.trail_name)) && seen.add(norm(x.trail_name))).sort((a, b) => a.d - b.d).slice(0, 3);
          want.push(...near.map((x) => ({ trail: x.trail_name, path: x.photo, bucket: "trail-match-photos", at: [x.lat, x.lon] as [number, number] })));
        } catch { /* none near */ }
      }
    }
    const got = await Promise.all(want.map(async ({ trail, path, bucket, at }) => {
      const f = await db(`/storage/v1/object/${bucket}/${path.split("/").map(encodeURIComponent).join("/")}`);
      if (!f?.ok) return null;
      try {
        const bytes = new Uint8Array(await f.arrayBuffer());
        return bytes.length > 1_000_000 ? null : { img: "", page: "", title: "", trail, data: b64(bytes), mime: "image/jpeg", from: "confirmed", ...(at ? { at, near: true } : {}) };
      } catch { return null; }
    }));
    return got.filter((x): x is Photo => !!x);
  } catch { return []; }
}
const kmApart = (a: [number, number], b: [number, number]) => Math.hypot(a[0] - b[0], (a[1] - b[1]) * Math.cos(a[0] * Math.PI / 180)) * 111.2;
function json(text: string): Record<string, unknown> | null {
  const a = text.indexOf("{"), b = text.lastIndexOf("}");
  if (a < 0 || b <= a) return null;
  try { return JSON.parse(text.slice(a, b + 1)); } catch { return null; }
}
const FINAL = {
  type: "OBJECT",
  properties: {
    ranks: {
      type: "ARRAY",
      description: "Every trail from the list, best fit first",
      items: {
        type: "OBJECT",
        properties: {
          trail: { type: "STRING", description: "The name exactly as in the list" },
          fit: { type: "NUMBER", description: "0 to 1: how well what is known of this trail (online descriptions and its photos) fits the rider's picture" },
          photo: { type: "NUMBER", description: "The number of the found photo that looks like the same place as the rider's picture, or 0" },
          why: { type: "STRING", description: "One short sentence" },
        },
        required: ["trail", "fit", "photo", "why"],
      },
    },
    photos: {
      type: "ARRAY",
      description: "Every found photo",
      items: {
        type: "OBJECT",
        properties: {
          n: { type: "NUMBER", description: "The found photo's number" },
          close: { type: "NUMBER", description: "0 to 1: 1 = the same place as the rider's picture, 0.6 = very like it (same kind of rock, slope, forest and view), 0 = nothing alike" },
          why: { type: "STRING", description: "A few words" },
        },
        required: ["n", "close"],
      },
    },
  },
  required: ["ranks"],
};

async function compare(body: Compare, images: string[], key: string, t0: number, reply: (s: number, b: unknown) => Response) {
  const trails: Trail[] = (Array.isArray(body.trails) ? body.trails : []).slice(0, 8).map((t: Record<string, unknown>) => ({
    name: String(t?.name || "").slice(0, 120), area: String(t?.area || "").slice(0, 80), kind: String(t?.kind || "").slice(0, 60),
    c: Array.isArray(t?.c) && typeof t.c[0] === "number" && typeof t.c[1] === "number" ? [t.c[0], t.c[1]] as [number, number] : null,
  })).filter((t) => t.name);
  if (!trails.length) return reply(400, { error: "no trails" });
  // The AI sometimes copies the whole list line ("1. Pretty Slabs (Trail, Squamish)"): back to the list's name.
  const named = (x: string) => {
    const n = norm(x.replace(/^\s*\d+[.)]\s*/, "").replace(/\s*\(.*$/, ""));
    if (trails.some((t) => norm(t.name) === n)) return trails.find((t) => norm(t.name) === n)!.name;
    const longest = trails.filter((t) => norm(t.name).length >= 4 && norm(x).includes(norm(t.name))).sort((a, b) => b.name.length - a.name.length)[0];
    return longest?.name || x.slice(0, 120);
  };
  const list = trails.map((t, i) => `${i + 1}. ${t.name} (${[t.kind, t.area].filter(Boolean).join(", ")})`).join("\n");
  // Where the AI placed the camera (the first look): photos from all around it, not only of the listed trails.
  const v = body.spot || {}, km = +(v.km as number);
  const spot: Spot | null = typeof v.lat === "number" && typeof v.lon === "number" && v.lat > 45 && v.lat < 62 && v.lon > -140 && v.lon < -108 && km > 0 && km <= 15
    ? { c: [v.lat, v.lon] as [number, number], r: Math.max(3000, Math.min(10000, km * 1500)), where: String(v.where || "").slice(0, 100) || `${v.lat.toFixed(3)}, ${v.lon.toFixed(3)}` } : null;
  const said = [body.scene ? `What the picture shows: ${String(body.scene).slice(0, 600)}` : "", body.description ? `The rider says: """${String(body.description).slice(0, 800)}"""` : ""].filter(Boolean).join("\n");

  const skip = (Array.isArray(body.skip) ? body.skip : []).filter((n): n is number => Number.isSafeInteger(n) && n > 0).slice(0, 20);
  const mine = confirmed(trails, skip, spot);
  // 1. Google: what each trail looks like, from riders' and sites' descriptions and videos.
  const searchAsk = `The picture is from a mountain bike trail. These are the trails it might be:\n${list}\n${said}\n` +
    `Search Google for each trail (Trailforks, Pinkbike, YouTube videos, Instagram, Strava, local riding club and blog pages) and find what it looks ` +
    `like: rock, slabs, roots, forest, views, water, features, the mountains around it. Compare that with the picture.\n` +
    `Answer only with JSON: {"trails":[{"trail":"name as in the list","looks":"what the web says it looks like","fit":0 to 1,"why":"short"}],` +
    `"pages":[{"trail":"name as in the list","url":"a page or video about that trail you found, with photos of it"}]` +
    (spot ? `,"area":[{"trail":"the trail's name, or empty","url":"a page or video"}]}\nAlso search for photos and videos of mountain bike riding around ` +
      `${spot.where} (within ${Math.round(spot.r / 1000)} km of ${spot.c[0].toFixed(3)}, ${spot.c[1].toFixed(3)}), on any trail there, not only the listed ones, ` +
      `and put the pages and videos whose photos look most like the rider's picture in "area", with the trail's name when the page is about one trail.` : "}");
  const s = await gemini(key, [...images.slice(0, 1).map((d) => img(d)), { text: searchAsk }], { search: true }, t0 + 30000);
  let web: { trail: string; looks: string; fit: number; why: string }[] = [], pages: { trail: string; url: string }[] = [], area: { trail: string; url: string }[] = [];
  let sources: { uri: string; title: string }[] = [], suggest = "", searched = false, noSearch = "";
  const notes: string[] = [];   // why a step had no AI answer (each model's note): for the accuracy test and the Logs
  if ("error" in s) {
    if (s.status === 503) return reply(503, { error: s.error });
    // Google Search not allowed on this key, used up or slow: the photos only.
    noSearch = s.status === 429 ? "Google search is busy or used up for today" : s.status === 504 ? "Google search took too long" : "Google search isn't available on this key";
    notes.push("search: " + (s.detail || s.error));
  } else {
    searched = true;
    const o = json(s.text) || {};
    web = (Array.isArray(o.trails) ? o.trails : []).filter((x) => x && typeof x.trail === "string").slice(0, 8)
      .map((x) => ({ trail: named(x.trail), looks: String(x.looks || "").slice(0, 300), fit: Math.max(0, Math.min(1, +x.fit || 0)), why: String(x.why || "").slice(0, 200) }));
    pages = (Array.isArray(o.pages) ? o.pages : []).filter((x) => x && typeof x.url === "string" && typeof x.trail === "string").slice(0, 12);
    area = (spot && Array.isArray(o.area) ? o.area : []).filter((x) => x && typeof x.url === "string").slice(0, 8)
      .map((x) => ({ url: x.url, trail: typeof x.trail === "string" ? x.trail.slice(0, 120) : "" }));
    const m = s.meta as { groundingChunks?: { web?: { uri?: string; title?: string } }[]; searchEntryPoint?: { renderedContent?: string } } | null;
    sources = (m?.groundingChunks || []).map((c) => c.web).filter((w): w is { uri: string; title: string } => !!w?.uri).slice(0, 8)
      .map((w) => ({ uri: w.uri, title: String(w.title || "").slice(0, 80) }));
    suggest = String(m?.searchEntryPoint?.renderedContent || "").slice(0, 20000);
  }

  // 2. Photos: from the pages it named and the pages Google gave (their links go through a Google redirect), geotagged
  // photos near the top trails, and (with a viewpoint) pages and geotagged photos from all around where the AI placed it.
  const whose = (title: string, page: string) => {
    const t = norm(title + " " + decodeURIComponent(page).replace(/[-_/]/g, " "));
    return trails.find((x) => norm(x.name).length >= 4 && t.includes(norm(x.name)))?.name || "";
  };
  const fromPages = [...pages.map((p) => ({ url: p.url, trail: trails.find((t) => t.name === named(p.trail))?.name || "", from: "web" })),
    ...area.map((p) => ({ url: p.url, trail: p.trail, from: "area" })), ...sources.map((w) => ({ url: w.uri, trail: "", from: "web" }))].slice(0, 18);
  const [found, near, around] = await Promise.all([
    Promise.all(fromPages.map(async (p) => { const f = await pagePhoto(p.url); return f && { ...f, trail: p.trail || whose(f.title, f.page), from: p.from }; })),
    Promise.all(trails.slice(0, 4).map(async (t) => (t.c ? await commons(t.c, 1500, 2) : []).map((f) => ({ ...f, trail: t.name, from: "near" })))),
    spot ? commons(spot.c, spot.r, 8).then((l) => l.map((f) => ({ ...f, trail: "", from: "area" }))) : [],
  ]);
  const pics = found.filter((f): f is NonNullable<typeof f> => !!f && (!!f.trail || f.from === "area"));
  // Each kind gets its share of the photos the AI looks at.
  const cands = [...pics.filter((f) => f.from === "web").slice(0, 5), ...near.flat().slice(0, 4), ...pics.filter((f) => f.from === "area").slice(0, 4), ...around];
  const photos: Photo[] = (await mine).slice(0, 6);
  const seenImg = new Set<string>();
  for (const c of cands) { if (seenImg.has(c.img)) continue; seenImg.add(c.img); }
  const loaded = await Promise.all([...seenImg].slice(0, 20).map(async (u) => ({ u, p: await picture(u) })));
  for (const { u, p } of loaded) {
    const c = cands.find((x) => x.img === u)!;
    if (p && photos.length < 16 && Date.now() - t0 < 45000) photos.push({ ...c, ...p });
  }

  // 3. The rider's picture next to the found photos and what the web says: a fit for each trail, and how close each
  // photo looks.
  if (!photos.length && !web.length) return reply(200, { ok: false, searched, noSearch, sources, suggest, why: "found nothing online about these trails", detail: notes.join(" | ") });
  const km1 = kmApart;
  const label = (p: Photo) => p.from === "confirmed" && p.near && p.at ? `a rider confirmed this picture is ${p.trail}, ${spot ? km1(p.at, spot.c).toFixed(1) + " km from" : "near"} where the picture seems taken`
    : p.from === "confirmed" ? `a rider confirmed this picture is ${p.trail}`
    : p.from === "near" ? `a photo taken within 1.5 km of ${p.trail} ("${p.title.slice(0, 100)}")`
    : p.from === "area" && p.at ? `a photo taken ${spot ? km1(p.at, spot.c).toFixed(1) + " km from" : "near"} where the picture seems taken ("${p.title.slice(0, 100)}")`
    : p.from === "area" ? `from a page about riding around ${spot?.where || "there"}${p.trail ? ` (about ${p.trail})` : ""} ("${p.title.slice(0, 100)}")`
    : `from a page about ${p.trail} ("${p.title.slice(0, 100)}")`;
  const parts: unknown[] = [{ text: "The rider's picture:" }, ...images.slice(0, 2).map((d) => img(d))];
  photos.forEach((p, i) => { parts.push({ text: `Found photo ${i + 1}: ${label(p)}` }, img(p.data, p.mime)); });
  parts.push({ text: `Which of these mountain bike trails is the rider's picture from?\n${list}\n${said}\n` +
    (web.length ? `What Google search found about them:\n${web.map((w) => `- ${w.trail}: ${w.looks} (fit ${w.fit}: ${w.why})`).join("\n")}\n`
      : `Google search wasn't available this time: use what you know about these trails too, if anything.\n`) +
    `Compare the rider's picture with each found photo: the same rock, slope, view, water, mountains or trail features means the same place. ` +
    `A found photo can show a different part of the trail, so also weigh the descriptions. Give every trail a fit, and every found photo a closeness.` });
  const f = await gemini(key, parts, { schema: FINAL }, t0 + 75000);
  type Pic = { img: string; page: string; title: string };
  const pub = (p: Photo | undefined): Pic | null => p && p.from !== "confirmed" ? { img: p.img, page: p.page, title: p.title.slice(0, 100) } : null;
  let ranks: { trail: string; fit: number; why: string; photo: Pic | null; confirmed?: boolean }[] = [];
  // Photos from around the viewpoint that look close: their spot (or the trail their page is about) goes back to the
  // site, which adds the trails there to the list.
  let close: (Pic & { close: number; why: string; at: [number, number] | null; trail: string; confirmed?: boolean })[] = [];
  if (!("error" in f) && f.text) {
    const o = json(f.text) || {};
    ranks = (Array.isArray(o.ranks) ? o.ranks : []).filter((x) => x && typeof x.trail === "string").slice(0, 8).map((x) => {
      const p = photos[Math.round(+x.photo || 0) - 1];
      return { trail: named(x.trail), fit: Math.max(0, Math.min(1, +x.fit || 0)), why: String(x.why || "").slice(0, 200), photo: pub(p), confirmed: p?.from === "confirmed" };
    });
    close = (Array.isArray(o.photos) ? o.photos : []).map((x) => ({ p: photos[Math.round(+x?.n || 0) - 1], c: Math.max(0, Math.min(1, +x?.close || 0)), why: String(x?.why || "").slice(0, 200) }))
      .filter((x) => x.p && (x.p.from === "area" || x.p.near) && (x.p.at || x.p.trail) && x.c >= 0.4).sort((a, b) => b.c - a.c).slice(0, 5)
      .map((x) => ({ ...(pub(x.p) || { img: "", page: "", title: "" }), close: x.c, why: x.why, at: x.p.at || null, trail: x.p.trail, ...(x.p.near ? { confirmed: true } : {}) }));
  } else {
    ranks = web.map((w) => ({ trail: w.trail, fit: w.fit, why: w.why, photo: null }));
    notes.push("compare: " + ("error" in f ? f.detail || f.error : "no answer"));
  }
  return reply(200, { ok: ranks.length > 0 || close.length > 0, ms: Date.now() - t0, searched, noSearch, ranks, close, photos: photos.length,
    area: photos.filter((p) => p.from === "area" || p.near).length, sources, suggest, detail: notes.join(" | ") });
}
