// Trail Finder "Which trail is this?": Claude looks at a trail photo (or a few frames of a video) and says what it
// sees that can place it: trail names written in it, big landmarks in the background (the Chief, Black Tusk...),
// places, the kind of terrain, and its best guesses. The site (photo-find.js) then matches that against its own
// trail lists. Setup (once): Supabase dashboard → Edge Functions → Deploy a new function named "which-trail",
// paste this file, turn "Verify JWT" off; then Edge Functions → Secrets → add ANTHROPIC_API_KEY.
import Anthropic from "npm:@anthropic-ai/sdk@0.135.0";
import { zodOutputFormat } from "npm:@anthropic-ai/sdk@0.135.0/helpers/zod";
import { z } from "npm:zod@4.6.7";

const ORIGINS = [/^https:\/\/allduf\.github\.io$/, /^http:\/\/localhost(:\d+)?$/];
const MAX_IMAGES = 3, MAX_B64 = 1_500_000, PER_HOUR = 30;
const seen = new Map<string, number[]>();   // a light brake per address (each running copy of the function keeps its own)

const Out = z.object({
  trail_names: z.array(z.string()).describe("Trail names written anywhere in the pictures or text (signs, captions, overlays, hashtags), as written"),
  landmarks: z.array(z.string()).describe("Named landmarks you can see or that are named, using the names from the landmark list when one fits"),
  places: z.array(z.string()).describe("Towns, riding areas or regions the pictures or text point to"),
  terrain: z.array(z.string()).describe("Short plain words for what the trail and background look like: granite slabs, roots, loam, alpine, desert, cedar forest, lake below, ocean view..."),
  scene: z.string().describe("One or two sentences on what is in the picture and where it might be"),
  guesses: z.array(z.object({
    trail: z.string().describe("A trail name, only if you have a real reason to think so"),
    area: z.string(),
    why: z.string(),
  })).describe("Up to 3 trails you think it is, best first; empty when you don't know"),
});

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
  const key = Deno.env.get("ANTHROPIC_API_KEY");
  if (!key) return reply(503, { error: "ANTHROPIC_API_KEY is not set" });
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

  try {
    const client = new Anthropic({ apiKey: key });
    const response = await client.messages.parse({
      model: "claude-opus-5-5",
      max_tokens: 4000,
      output_config: { effort: "medium", format: zodOutputFormat(Out) },
      messages: [{ role: "user", content: [
        ...images.map((data) => ({ type: "image" as const, source: { type: "base64" as const, media_type: "image/jpeg" as const, data } })),
        { type: "text" as const, text: prompt },
      ] }],
    });
    if (response.stop_reason === "refusal" || !response.parsed_output) return reply(200, { ok: false });
    return reply(200, { ok: true, ...response.parsed_output });
  } catch (e) {
    if (e instanceof Anthropic.RateLimitError) return reply(429, { error: "busy, try again in a minute" });
    if (e instanceof Anthropic.AuthenticationError) return reply(503, { error: "the API key was refused" });
    if (e instanceof Anthropic.APIError) return reply(502, { error: "the picture check failed (" + e.status + ")" });
    return reply(500, { error: "the picture check failed" });
  }
});
