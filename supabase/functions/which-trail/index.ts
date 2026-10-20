// Trail Finder "Which trail is this?": an AI (Google Gemini, free tier) looks at a trail photo (or a few frames of a
// video) and says what it sees that can place it: trail names written in it, big landmarks in the background (the
// Chief, Black Tusk...), places, the kind of terrain, and its best guesses. The site (photo-find.js) then matches that
// against its own trail lists. Setup (once): Supabase dashboard → Edge Functions → deploy this file (it's deployed as
// "smooth-worker"; AI_FN in photo-find.js must match), turn "Verify JWT" off; then Edge Functions → Secrets → add
// GEMINI_API_KEY (free from aistudio.google.com/apikey). Optional secret GEMINI_MODEL picks another model.
// Free-tier pictures may be used by Google to improve its products; a paid Google key stops that.

const ORIGINS = [/^https:\/\/allduf\.github\.io$/, /^http:\/\/localhost(:\d+)?$/];
const MAX_IMAGES = 3, MAX_B64 = 1_500_000, PER_HOUR = 30;
const MODELS = ["gemini-flash-latest", "gemini-2.5-flash"];   // the first that answers; a name Google retired gives 404
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
  required: ["trail_names", "landmarks", "places", "terrain", "scene", "guesses"],
};

type Out = { trail_names: string[]; landmarks: string[]; places: string[]; terrain: string[]; scene: string; guesses: { trail: string; area: string; why: string }[] };
const strs = (v: unknown) => (Array.isArray(v) ? v.filter((s) => typeof s === "string").map((s) => s.slice(0, 120)).slice(0, 12) : []);
function clean(o: Record<string, unknown>): Out {
  const g = Array.isArray(o.guesses) ? o.guesses : [];
  return {
    trail_names: strs(o.trail_names), landmarks: strs(o.landmarks), places: strs(o.places), terrain: strs(o.terrain),
    scene: typeof o.scene === "string" ? o.scene.slice(0, 600) : "",
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

  let body: { images?: string[]; text?: string; description?: string; area?: string; landmarks?: string[] };
  try { body = await req.json(); } catch { return reply(400, { error: "bad request" }); }
  const images = (body.images || []).filter((s) => typeof s === "string" && s.length < MAX_B64).slice(0, MAX_IMAGES);
  if (!images.length) return reply(400, { error: "no picture" });
  const clip = (s: unknown, n: number) => (typeof s === "string" ? s.slice(0, n) : "");

  const prompt = `These are ${images.length > 1 ? "frames from a mountain bike video" : "a mountain bike picture"} (often a screenshot of a social media post). ` +
    `Help find which trail it is. The app covers British Columbia (Vancouver to the Rockies) and Alberta riding areas.\n` +
    `Look at everything: words written anywhere, the post's caption, location tags, Strava or Trailforks overlays, and the background: ` +
    `big mountains, rock walls, peaks, glaciers, lakes, ocean, towns, ski runs, the type of forest, rock and dirt.\n` +
    `Only name a landmark you really recognise; say nothing rather than guess. Prefer these landmark names when one fits: ${(body.landmarks || []).slice(0, 120).map((s) => clip(s, 60)).join("; ")}.\n` +
    (clip(body.area, 80) ? `The rider thinks it's in: ${clip(body.area, 80)}.\n` : "") +
    (clip(body.description, 800) ? `The rider describes it as: """${clip(body.description, 800)}"""\n` : "") +
    (clip(body.text, 2000) ? `Words already read from the picture (may have errors): """${clip(body.text, 2000)}"""\n` : "");

  const request = JSON.stringify({
    contents: [{ role: "user", parts: [...images.map((data) => ({ inline_data: { mime_type: "image/jpeg", data } })), { text: prompt }] }],
    generationConfig: { responseMimeType: "application/json", responseSchema: SCHEMA, temperature: 0.2 },
  });
  const models = [Deno.env.get("GEMINI_MODEL"), ...MODELS].filter((m): m is string => !!m);
  for (const model of models) {
    let r: Response;
    try {
      r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
        { method: "POST", headers: { "content-type": "application/json", "x-goog-api-key": key }, body: request });
    } catch { return reply(502, { error: "the picture check failed" }); }
    if (r.status === 404) continue;                       // that model name is gone: try the next
    if (r.status === 429) return reply(429, { error: "the free AI is busy or used up for today, try again later" });
    if (r.status === 400 || r.status === 401 || r.status === 403) {
      const msg = await r.text();
      if (/API key|API_KEY|PERMISSION_DENIED|UNAUTHENTICATED/i.test(msg)) return reply(503, { error: "the API key was refused" });
      return reply(502, { error: "the picture check failed (" + r.status + ")" });
    }
    if (!r.ok) return reply(502, { error: "the picture check failed (" + r.status + ")" });
    const j = await r.json().catch(() => null);
    const cand = j?.candidates?.[0];
    const text = (cand?.content?.parts || []).filter((p: { text?: string; thought?: boolean }) => typeof p.text === "string" && !p.thought).map((p: { text: string }) => p.text).join("");
    if (!text) return reply(200, { ok: false });           // blocked, or nothing to say
    try { return reply(200, { ok: true, model, ...clean(JSON.parse(text)) }); } catch { return reply(200, { ok: false }); }
  }
  return reply(502, { error: "no Gemini model answered" });
});
