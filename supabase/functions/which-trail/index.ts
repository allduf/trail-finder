// Trail Finder "Which trail is this?": an AI (Google Gemini, free tier) looks at a trail photo (or a few frames of a
// video) and says what it sees that can place it: trail names written in it, big landmarks in the background (the
// Chief, Black Tusk...), places, the kind of terrain, and its best guesses. The site (photo-find.js) then matches that
// against its own trail lists. A second call ("compare") then takes the app's likely trails, searches Google for what
// riders and sites say each one looks like, gathers photos of them (pictures on those pages, video thumbnails, geotagged
// Wikimedia Commons photos near each trail) and compares them with the rider's picture. Setup (once): Supabase dashboard → Edge Functions → deploy this file (it's deployed as
// "smooth-worker"; AI_FN in photo-find.js must match), turn "Verify JWT" off; then Edge Functions → Secrets → add
// GEMINI_API_KEY (free from aistudio.google.com/apikey). Optional secret GEMINI_MODEL picks another model.
// Free-tier pictures may be used by Google to improve its products; a paid Google key stops that.

const ORIGINS = [/^https:\/\/allduf\.github\.io$/, /^http:\/\/localhost(:\d+)?$/];
const MAX_IMAGES = 3, MAX_B64 = 1_500_000, PER_HOUR = 30;
// Tried in turn: a name Google retired (404) or one that is too slow moves on to the next. Lite is the quick fallback.
const MODELS = ["gemini-flash-latest", "gemini-2.5-flash", "gemini-flash-lite-latest"];
// Ways to ask for little or no thinking (it answers in seconds instead of tens of seconds): Gemini 2.5 takes a budget,
// Gemini 3 and later a level. A model that refuses one setting is asked with the next.
const THINK = [{ thinkingBudget: 0 }, { thinkingLevel: "minimal" }, { thinkingLevel: "low" }, null];
const slow = new Set<string>();   // models that ran out of time in this running copy: tried last from then on
const seen = new Map<string, number[]>();   // a light brake per address (each running copy of the function keeps its own)

const list = (description: string) => ({ type: "ARRAY", items: { type: "STRING" }, description });
const SCHEMA = {
  type: "OBJECT",
  properties: {
    trail_names: list("Trail names written anywhere in the pictures or text (signs, captions, overlays, hashtags), as written"),
    landmarks: list("Named landmarks you can see or that are named, using the names from the landmark list when one fits"),
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
  required: ["trail_names", "landmarks", "places", "terrain", "scene", "viewpoint", "guesses"],
};

type Viewpoint = { lat: number; lon: number; km: number; where: string } | null;
type Out = { trail_names: string[]; landmarks: string[]; places: string[]; terrain: string[]; scene: string; viewpoint: Viewpoint; guesses: { trail: string; area: string; why: string }[] };
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
  const key = Deno.env.get("GEMINI_API_KEY");
  if (!key) return reply(503, { error: "GEMINI_API_KEY is not set" });
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0].trim() || "?";
  const now = Date.now(), recent = (seen.get(ip) || []).filter((t) => now - t < 3600e3);
  if (recent.length >= PER_HOUR) return reply(429, { error: "too many pictures this hour" });
  seen.set(ip, [...recent, now]);

  let body: { images?: string[]; text?: string; description?: string; area?: string; landmarks?: string[]; mode?: string; trails?: unknown; scene?: string };
  try { body = await req.json(); } catch { return reply(400, { error: "bad request" }); }
  const images = (body.images || []).filter((s) => typeof s === "string" && s.length < MAX_B64).slice(0, MAX_IMAGES);
  if (!images.length) return reply(400, { error: "no picture" });
  const clip = (s: unknown, n: number) => (typeof s === "string" ? s.slice(0, n) : "");

  const prompt = `These are ${images.length > 1 ? "frames from a mountain bike video" : "a mountain bike picture"} (often a screenshot of a social media post). ` +
    `Help find which trail it is. The app covers British Columbia (Vancouver to the Rockies) and Alberta riding areas.\n` +
    `Look at everything: words written anywhere, the post's caption, location tags, Strava or Trailforks overlays, and the background: ` +
    `big mountains, rock walls, peaks, glaciers, lakes, ocean, towns, ski runs, the type of forest, rock and dirt.\n` +
    `Then work out where the camera stood: which way the landmarks, water and valleys lie, and how high above them, and give that spot as the viewpoint.\n` +
    `Only name a landmark you really recognise; say nothing rather than guess. Prefer these landmark names when one fits: ${(body.landmarks || []).slice(0, 120).map((s) => clip(s, 60)).join("; ")}.\n` +
    (clip(body.area, 80) ? `The rider thinks it's in: ${clip(body.area, 80)}.\n` : "") +
    (clip(body.description, 800) ? `The rider describes it as: """${clip(body.description, 800)}"""\n` : "") +
    (clip(body.text, 2000) ? `Words already read from the picture (may have errors): """${clip(body.text, 2000)}"""\n` : "");

  const t0 = Date.now();
  if (body.mode === "compare") return compare(body as Compare, images, key, t0, reply);
  const r = await gemini(key, [...images.map((d) => img(d)), { text: prompt }], { schema: SCHEMA }, t0 + 40000);
  if ("error" in r) return reply(r.status, { error: r.error });
  if (!r.text) return reply(200, { ok: false });           // blocked, or nothing to say
  try { return reply(200, { ok: true, model: r.model, ms: Date.now() - t0, ...clean(JSON.parse(r.text)) }); } catch { return reply(200, { ok: false }); }
});

const img = (data: string, mime = "image/jpeg") => ({ inline_data: { mime_type: mime, data } });

// One Gemini answer from the first model that answers in time. schema: JSON in that shape; search: Google Search on (then
// no schema: Gemini 2.5 can't do both, so the prompt asks for JSON in the text). Each model but the last gets at most
// PER_MODEL ms, so one slow model can't use up all the time.
const PER_MODEL = 16000;
type Said = { text: string; model: string; meta: Record<string, unknown> | null } | { status: number; error: string; search?: boolean };
async function gemini(key: string, parts: unknown[], o: { schema?: unknown; search?: boolean }, until: number): Promise<Said> {
  const ask = (think: Record<string, unknown> | null) => JSON.stringify({
    contents: [{ role: "user", parts }],
    ...(o.search ? { tools: [{ google_search: {} }] } : {}),
    generationConfig: { temperature: 0.2, ...(o.schema ? { responseMimeType: "application/json", responseSchema: o.schema } : {}), ...(think ? { thinkingConfig: think } : {}) },
  });
  const named = [Deno.env.get("GEMINI_MODEL"), ...MODELS].filter((m, i, a): m is string => !!m && a.indexOf(m) === i);
  const models = [...named.filter((m) => !slow.has(m)), ...named.filter((m) => slow.has(m))];
  const late: string[] = [];
  for (const [n, model] of models.entries()) {
    const left = until - Date.now();
    if (left < 2500) break;
    const stop = Date.now() + (n === models.length - 1 ? left : Math.min(left, PER_MODEL));
    let r: Response | null = null;
    try {
      for (const think of THINK) {
        r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
          { method: "POST", headers: { "content-type": "application/json", "x-goog-api-key": key }, body: ask(think), signal: AbortSignal.timeout(Math.max(1000, stop - Date.now())) });
        if (r.status !== 400 || !think) break;
        if (!/thinking/i.test(await r.clone().text())) break;   // another 400: handled below
      }
    } catch (e) {
      if (e instanceof DOMException && e.name === "TimeoutError") { slow.add(model); late.push(model); continue; }
      return { status: 502, error: "the picture check failed" };
    }
    if (!r) continue;
    if (r.status === 404) continue;                       // that model name is gone: try the next
    if (r.status === 429) return { status: 429, error: "the free AI is busy or used up for today, try again later", search: o.search };
    if (r.status === 400 || r.status === 401 || r.status === 403) {
      const msg = await r.text();
      if (/API key|API_KEY|UNAUTHENTICATED/i.test(msg)) return { status: 503, error: "the API key was refused" };
      if (o.search && /search|ground|tool/i.test(msg)) return { status: 502, error: "the picture check failed (" + r.status + ")", search: true };
      continue;                                           // this model can't take the request: try the next
    }
    if (!r.ok) continue;
    const j = await r.json().catch(() => null);
    slow.delete(model);
    const cand = j?.candidates?.[0];
    const text = (cand?.content?.parts || []).filter((p: { text?: string; thought?: boolean }) => typeof p.text === "string" && !p.thought).map((p: { text: string }) => p.text).join("");
    return { text, model, meta: cand?.groundingMetadata || null };
  }
  return late.length ? { status: 504, error: `the AI took too long (${late.join(", ")})` } : { status: 502, error: "no Gemini model answered" };
}

// ---------- compare: the app's likely trails against what's online about them ----------
type Trail = { name: string; area: string; kind: string; c: [number, number] | null };
type Compare = { trails?: unknown; scene?: string; description?: string };
type Photo = { img: string; page: string; title: string; trail: string; data: string; mime: string; from: string };
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
// Geotagged photos on Wikimedia Commons within 1.5 km of a trail (no key needed).
async function commons(t: Trail): Promise<{ img: string; page: string; title: string }[]> {
  if (!t.c) return [];
  const q = `https://commons.wikimedia.org/w/api.php?action=query&format=json&generator=geosearch&ggscoord=${t.c[0]}|${t.c[1]}&ggsradius=1500&ggsnamespace=6&ggslimit=4&prop=imageinfo&iiprop=url&iiurlwidth=640`;
  const g = await get(q, 4000, 200_000);
  try {
    const pages = Object.values(JSON.parse(new TextDecoder().decode(g!.bytes)).query?.pages || {}) as { title: string; imageinfo?: { thumburl?: string; descriptionurl?: string }[] }[];
    return pages.filter((p) => p.imageinfo?.[0]?.thumburl && /\.(jpe?g|png|webp)$/i.test(p.title)).slice(0, 2)
      .map((p) => ({ img: p.imageinfo![0].thumburl!, page: p.imageinfo![0].descriptionurl || "", title: p.title.replace(/^File:/, "").replace(/\.\w+$/, "") }));
  } catch { return []; }
}
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
  },
  required: ["ranks"],
};

async function compare(body: Compare, images: string[], key: string, t0: number, reply: (s: number, b: unknown) => Response) {
  const trails: Trail[] = (Array.isArray(body.trails) ? body.trails : []).slice(0, 8).map((t: Record<string, unknown>) => ({
    name: String(t?.name || "").slice(0, 120), area: String(t?.area || "").slice(0, 80), kind: String(t?.kind || "").slice(0, 60),
    c: Array.isArray(t?.c) && typeof t.c[0] === "number" && typeof t.c[1] === "number" ? [t.c[0], t.c[1]] as [number, number] : null,
  })).filter((t) => t.name);
  if (!trails.length) return reply(400, { error: "no trails" });
  const list = trails.map((t, i) => `${i + 1}. ${t.name} (${[t.kind, t.area].filter(Boolean).join(", ")})`).join("\n");
  const said = [body.scene ? `What the picture shows: ${String(body.scene).slice(0, 600)}` : "", body.description ? `The rider says: """${String(body.description).slice(0, 800)}"""` : ""].filter(Boolean).join("\n");

  // 1. Google: what each trail looks like, from riders' and sites' descriptions and videos.
  const searchAsk = `The picture is from a mountain bike trail. These are the trails it might be:\n${list}\n${said}\n` +
    `Search Google for each trail (Trailforks, Pinkbike, YouTube videos, Instagram, Strava, local riding club and blog pages) and find what it looks ` +
    `like: rock, slabs, roots, forest, views, water, features, the mountains around it. Compare that with the picture.\n` +
    `Answer only with JSON: {"trails":[{"trail":"name as in the list","looks":"what the web says it looks like","fit":0 to 1,"why":"short"}],` +
    `"pages":[{"trail":"name as in the list","url":"a page or video about that trail you found, with photos of it"}]}`;
  const s = await gemini(key, [...images.slice(0, 1).map((d) => img(d)), { text: searchAsk }], { search: true }, t0 + 30000);
  let web: { trail: string; looks: string; fit: number; why: string }[] = [], pages: { trail: string; url: string }[] = [];
  let sources: { uri: string; title: string }[] = [], suggest = "", searched = false, noSearch = "";
  if ("error" in s) {
    if (s.status === 503) return reply(503, { error: s.error });
    // Google Search not allowed on this key, used up or slow: the photos only.
    noSearch = s.status === 429 ? "Google search is busy or used up for today" : s.status === 504 ? "Google search took too long" : "Google search isn't available on this key";
  } else {
    searched = true;
    const o = json(s.text) || {};
    web = (Array.isArray(o.trails) ? o.trails : []).filter((x) => x && typeof x.trail === "string").slice(0, 8)
      .map((x) => ({ trail: x.trail.slice(0, 120), looks: String(x.looks || "").slice(0, 300), fit: Math.max(0, Math.min(1, +x.fit || 0)), why: String(x.why || "").slice(0, 200) }));
    pages = (Array.isArray(o.pages) ? o.pages : []).filter((x) => x && typeof x.url === "string" && typeof x.trail === "string").slice(0, 12);
    const m = s.meta as { groundingChunks?: { web?: { uri?: string; title?: string } }[]; searchEntryPoint?: { renderedContent?: string } } | null;
    sources = (m?.groundingChunks || []).map((c) => c.web).filter((w): w is { uri: string; title: string } => !!w?.uri).slice(0, 8)
      .map((w) => ({ uri: w.uri, title: String(w.title || "").slice(0, 80) }));
    suggest = String(m?.searchEntryPoint?.renderedContent || "").slice(0, 20000);
  }

  // 2. Photos: from the pages it named and the pages Google gave (their links go through a Google redirect), plus
  // geotagged photos near the top trails.
  const whose = (title: string, page: string) => {
    const t = norm(title + " " + decodeURIComponent(page).replace(/[-_/]/g, " "));
    return trails.find((x) => norm(x.name).length >= 4 && t.includes(norm(x.name)))?.name || "";
  };
  const fromPages = [...pages.map((p) => ({ url: p.url, trail: trails.find((t) => norm(t.name) === norm(p.trail))?.name || "" })),
    ...sources.map((w) => ({ url: w.uri, trail: "" }))].slice(0, 14);
  const [found, near] = await Promise.all([
    Promise.all(fromPages.map(async (p) => { const f = await pagePhoto(p.url); return f && { ...f, trail: p.trail || whose(f.title, f.page), from: "web" }; })),
    Promise.all(trails.slice(0, 4).map(async (t) => (await commons(t)).map((f) => ({ ...f, trail: t.name, from: "near" })))),
  ]);
  const cands = [...found.filter((f): f is NonNullable<typeof f> => !!f && !!f.trail), ...near.flat()];
  const photos: Photo[] = [];
  const seenImg = new Set<string>();
  for (const c of cands) { if (seenImg.has(c.img)) continue; seenImg.add(c.img); }
  const loaded = await Promise.all([...seenImg].slice(0, 12).map(async (u) => ({ u, p: await picture(u) })));
  for (const { u, p } of loaded) {
    const c = cands.find((x) => x.img === u)!;
    if (p && photos.length < 8 && Date.now() - t0 < 45000) photos.push({ ...c, ...p });
  }

  // 3. The rider's picture next to the found photos and what the web says: a fit for each trail.
  if (!photos.length && !web.length) return reply(200, { ok: false, searched, noSearch, sources, suggest, why: "found nothing online about these trails" });
  const parts: unknown[] = [{ text: "The rider's picture:" }, ...images.slice(0, 2).map((d) => img(d))];
  photos.forEach((p, i) => { parts.push({ text: `Found photo ${i + 1}: ${p.from === "near" ? "a photo taken within 1.5 km of" : "from a page about"} ${p.trail} ("${p.title.slice(0, 100)}")` }, img(p.data, p.mime)); });
  parts.push({ text: `Which of these mountain bike trails is the rider's picture from?\n${list}\n${said}\n` +
    (web.length ? `What Google search found about them:\n${web.map((w) => `- ${w.trail}: ${w.looks} (fit ${w.fit}: ${w.why})`).join("\n")}\n` : "") +
    `Compare the rider's picture with each found photo: the same rock, slope, view, water, mountains or trail features means the same place. ` +
    `A found photo can show a different part of the trail, so also weigh the descriptions. Give every trail a fit.` });
  const f = await gemini(key, parts, { schema: FINAL }, t0 + 75000);
  let ranks: { trail: string; fit: number; why: string; photo: { img: string; page: string; title: string } | null }[] = [];
  if (!("error" in f) && f.text) {
    const o = json(f.text) || {};
    ranks = (Array.isArray(o.ranks) ? o.ranks : []).filter((x) => x && typeof x.trail === "string").slice(0, 8).map((x) => {
      const p = photos[Math.round(+x.photo || 0) - 1];
      return { trail: x.trail.slice(0, 120), fit: Math.max(0, Math.min(1, +x.fit || 0)), why: String(x.why || "").slice(0, 200), photo: p ? { img: p.img, page: p.page, title: p.title.slice(0, 100) } : null };
    });
  } else ranks = web.map((w) => ({ trail: w.trail, fit: w.fit, why: w.why, photo: null }));
  return reply(200, { ok: ranks.length > 0, ms: Date.now() - t0, searched, noSearch, ranks, photos: photos.length, sources, suggest });
}
