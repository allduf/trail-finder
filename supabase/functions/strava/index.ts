// Trail Finder Strava sync (strava.js on the site): brings a rider's Strava bike rides into My rides on their own, with no
// GPX exporting. The rider connects once (My rides → Connect Strava); Strava then gives this function keys for that rider,
// kept in the strava_links table (supabase/strava.sql, run once), which only this function can read. Any device signed
// in to the account can then ask for the rider's newest rides and each ride's GPS track.
// Setup (once):
// 1. strava.com/settings/api → create an app: Website https://allduf.github.io/trail-finder/, Authorization Callback
//    Domain allduf.github.io. It gives a Client ID and a Client Secret.
// 2. Supabase dashboard → Edge Functions → deploy this file named "strava" (FN in strava.js must match), Verify JWT off
//    (the page Strava sends the rider back to may be in a browser that isn't signed in: the one-time state says who).
// 3. Edge Functions → Secrets → add STRAVA_CLIENT_ID and STRAVA_CLIENT_SECRET.
// A new Strava app lets only its owner connect ("Single Player Mode") until Strava approves more riders (the app's page
// on strava.com/settings/api has the form). Strava allows 100 reads every 15 minutes and 1,000 a day for the whole app:
// a sync is one read for the list plus one per new ride.
// Actions (POST { action }): status, start { back } (the address to Strava's consent page), connect { code, state, scope },
// list { after, before } (bike rides with GPS, newest first), streams { id } (the GPS track), disconnect.

const ORIGINS = [/^https:\/\/allduf\.github\.io$/, /^http:\/\/localhost(:\d+)?$/];
const BACK = /^(https:\/\/allduf\.github\.io\/trail-finder\/|http:\/\/localhost(:\d+)?\/)[\w./-]*$/;
const BIKES = new Set(["MountainBikeRide", "EMountainBikeRide", "Ride", "EBikeRide", "GravelRide"]);
const STATE_MS = 30 * 60e3;

function headers(origin: string | null) {
  const ok = origin && ORIGINS.some((r) => r.test(origin));
  return { "Access-Control-Allow-Origin": ok ? origin! : "https://allduf.github.io", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS", "Content-Type": "application/json" };
}

type Link = { user_id: string; athlete_id: number | null; athlete_name: string | null; access_token: string | null; refresh_token: string | null; expires_at: number | null; scope: string | null; state: string | null; state_at: string | null };

Deno.serve(async (req) => {
  const origin = req.headers.get("origin"), h = headers(origin);
  if (req.method === "OPTIONS") return new Response("ok", { headers: h });
  const reply = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: h });
  if (req.method !== "POST" || !origin || !ORIGINS.some((r) => r.test(origin))) return reply(403, { error: "not allowed" });
  let body: { action?: string; back?: string; code?: string; state?: string; scope?: string; after?: number; before?: number; id?: number | string };
  try { body = await req.json(); } catch { return reply(400, { error: "bad request" }); }
  const id = Deno.env.get("STRAVA_CLIENT_ID"), secret = Deno.env.get("STRAVA_CLIENT_SECRET");
  if (!id || !secret) return reply(503, { error: "STRAVA_CLIENT_ID and STRAVA_CLIENT_SECRET are not set" });
  if (!Deno.env.get("SUPABASE_URL") || !Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")) return reply(503, { error: "no database" });

  // Strava's answer comes back with the one-time state: no sign-in needed here (it may open in another browser).
  if (body.action === "connect") {
    if (typeof body.code !== "string" || typeof body.state !== "string" || !/^[0-9a-f]{32}$/.test(body.state)) return reply(400, { error: "bad request" });
    const rows = await select(`state=eq.${body.state}`);
    if (rows === null) return reply(503, { error: "the database didn't answer (was supabase/strava.sql run?)" });
    const row = rows[0];
    if (!row || !row.state_at || Date.now() - Date.parse(row.state_at) > STATE_MS) return reply(400, { error: "that link is out of date: tap Connect Strava again" });
    const t = await token(id, secret, { grant_type: "authorization_code", code: body.code });
    if ("error" in t) return reply(502, { error: t.error });
    const athlete = t.athlete ? [t.athlete.firstname, t.athlete.lastname].filter(Boolean).join(" ") : null;
    const ok = await save({ user_id: row.user_id, athlete_id: t.athlete?.id ?? null, athlete_name: athlete, access_token: t.access_token, refresh_token: t.refresh_token,
      expires_at: t.expires_at, scope: typeof body.scope === "string" ? body.scope.slice(0, 100) : null, state: null, state_at: null });
    if (!ok) return reply(503, { error: "couldn't save the connection" });
    return reply(200, { ok: true, athlete });
  }

  const user = await who(req);
  if (!user) return reply(401, { error: "sign in first" });
  const rows = await select(`user_id=eq.${user}`);
  if (rows === null) return reply(503, { error: "the database didn't answer (was supabase/strava.sql run?)" });
  let link = rows[0] || null;
  const connected = !!(link && link.refresh_token);

  if (body.action === "status") return reply(200, { ok: true, connected, athlete: connected ? link!.athlete_name : null, scope: connected ? link!.scope : null });

  if (body.action === "start") {
    if (typeof body.back !== "string" || !BACK.test(body.back)) return reply(400, { error: "bad return address" });
    const state = [...crypto.getRandomValues(new Uint8Array(16))].map((b) => b.toString(16).padStart(2, "0")).join("");
    const ok = await save({ ...(link || { athlete_id: null, athlete_name: null, access_token: null, refresh_token: null, expires_at: null, scope: null }), user_id: user, state, state_at: new Date().toISOString() });
    if (!ok) return reply(503, { error: "couldn't start connecting" });
    const back = body.back + (body.back.includes("?") ? "&" : "?") + "strava=1";
    const url = "https://www.strava.com/oauth/authorize?" + new URLSearchParams({ client_id: id, response_type: "code", redirect_uri: back,
      approval_prompt: "auto", scope: "read,activity:read_all", state }).toString();
    return reply(200, { ok: true, url });
  }

  if (!connected) return reply(409, { error: "Strava isn't connected", connected: false });

  if (body.action === "disconnect") {
    const live = await fresh(link!, id, secret);
    if (live) await fetch("https://www.strava.com/oauth/deauthorize", { method: "POST", headers: { authorization: "Bearer " + live.access_token }, signal: AbortSignal.timeout(8000) }).catch(() => null);
    await remove(user);
    return reply(200, { ok: true, connected: false });
  }

  link = await fresh(link!, id, secret);
  if (!link) return reply(409, { error: "Strava no longer lets Trail Finder in: connect it again", connected: false });
  const api = (path: string) => fetch("https://www.strava.com/api/v3" + path, { headers: { authorization: "Bearer " + link!.access_token }, signal: AbortSignal.timeout(15000) });
  const failed = async (r: Response) => {
    if (r.status === 429) return reply(429, { error: "Strava's limit for now is used up: try again in 15 minutes" });
    if (r.status === 401) { await remove(user); return reply(409, { error: "Strava no longer lets Trail Finder in: connect it again", connected: false }); }
    return reply(502, { error: "Strava said " + r.status, detail: (await r.text()).slice(0, 300) });
  };

  if (body.action === "list") {
    const q = new URLSearchParams({ per_page: "50" });
    if (Number.isFinite(body.after)) q.set("after", String(Math.floor(body.after!)));
    if (Number.isFinite(body.before)) q.set("before", String(Math.floor(body.before!)));
    const r = await api("/athlete/activities?" + q.toString()).catch(() => null);
    if (!r) return reply(504, { error: "Strava didn't answer" });
    if (!r.ok) return failed(r);
    const all = (await r.json()) as Record<string, any>[];
    const rides = all.filter((a) => BIKES.has(a.sport_type || a.type) && !a.trainer && !a.manual && a.start_latlng && a.start_latlng.length === 2)
      .map((a) => ({ id: a.id, name: a.name, sport: a.sport_type || a.type, start: a.start_date, moving: a.moving_time, elapsed: a.elapsed_time,
        dist: a.distance, climb: a.total_elevation_gain, private: !!a.private }));
    // The oldest start in this page (any sport), so the site can ask for the page before it.
    const oldest = all.length ? Math.min(...all.map((a) => Date.parse(a.start_date) / 1000)) : null;
    return reply(200, { ok: true, rides, count: all.length, oldest });
  }

  if (body.action === "streams") {
    const aid = String(body.id || "");
    if (!/^\d{1,20}$/.test(aid)) return reply(400, { error: "bad ride" });
    const r = await api(`/activities/${aid}/streams?keys=latlng,time,altitude&key_by_type=true`).catch(() => null);
    if (!r) return reply(504, { error: "Strava didn't answer" });
    if (!r.ok) return failed(r);
    const s = (await r.json()) as Record<string, { data: unknown[] }>;
    return reply(200, { ok: true, latlng: s.latlng?.data || [], time: s.time?.data || [], altitude: s.altitude?.data || null });
  }

  return reply(400, { error: "unknown action" });
});

// ---------- Strava keys ----------
type Tok = { access_token: string; refresh_token: string; expires_at: number; athlete?: { id: number; firstname?: string; lastname?: string } };
async function token(id: string, secret: string, extra: Record<string, string>): Promise<Tok | { error: string }> {
  try {
    const r = await fetch("https://www.strava.com/oauth/token", { method: "POST", signal: AbortSignal.timeout(10000),
      headers: { "content-type": "application/json" }, body: JSON.stringify({ client_id: id, client_secret: secret, ...extra }) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || !j.access_token) return { error: r.status === 400 || r.status === 401 ? "Strava refused it (tap Connect Strava again)" : "Strava said " + r.status };
    return j as Tok;
  } catch { return { error: "Strava didn't answer" }; }
}
// The rider's keys, refreshed when they run out within a minute (Strava's last 6 hours). null: Strava no longer accepts them.
async function fresh(link: Link, id: string, secret: string): Promise<Link | null> {
  if (link.access_token && (link.expires_at || 0) > Date.now() / 1000 + 60) return link;
  const t = await token(id, secret, { grant_type: "refresh_token", refresh_token: link.refresh_token! });
  if ("error" in t) return null;
  const next = { ...link, access_token: t.access_token, refresh_token: t.refresh_token, expires_at: t.expires_at };
  await save(next);
  return next;
}

// ---------- the strava_links table (supabase/strava.sql), with the key Supabase gives every function ----------
function rest(path: string, init: RequestInit = {}): Promise<Response | null> {
  const base = Deno.env.get("SUPABASE_URL")!, sk = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  return fetch(base + "/rest/v1/" + path, { ...init, signal: AbortSignal.timeout(5000),
    headers: { apikey: sk, authorization: "Bearer " + sk, "content-type": "application/json", ...(init.headers || {}) } }).catch(() => null);
}
async function select(filter: string): Promise<Link[] | null> {
  const r = await rest("strava_links?select=*&" + filter);
  if (!r || !r.ok) { if (r) console.log("strava_links", r.status, (await r.text()).slice(0, 200)); return null; }
  return (await r.json()) as Link[];
}
async function save(row: Link): Promise<boolean> {
  const r = await rest("strava_links?on_conflict=user_id", { method: "POST", headers: { prefer: "resolution=merge-duplicates,return=minimal" },
    body: JSON.stringify({ ...row, updated_at: new Date().toISOString() }) });
  if (r && !r.ok) console.log("strava_links save", r.status, (await r.text()).slice(0, 200));
  return !!(r && r.ok);
}
async function remove(user: string) { await rest(`strava_links?user_id=eq.${user}`, { method: "DELETE" }); }

// The signed-in account asking (checked with Supabase), or null.
async function who(req: Request): Promise<string | null> {
  const tok = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  const base = Deno.env.get("SUPABASE_URL"), k = Deno.env.get("SUPABASE_ANON_KEY") || Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!base || !k || tok.split(".").length !== 3) return null;
  try {
    const r = await fetch(base + "/auth/v1/user", { headers: { apikey: k, authorization: "Bearer " + tok }, signal: AbortSignal.timeout(4000) });
    const u = r.ok ? await r.json() : null;
    return u && typeof u.id === "string" && /^[0-9a-f-]{36}$/.test(u.id) ? u.id : null;
  } catch { return null; }
}
