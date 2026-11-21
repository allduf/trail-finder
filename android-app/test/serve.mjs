// The site for the Android deep check (deep-check.sh): this checkout on port 8080, and any file it doesn't have (the
// data jobs' files live on the site-data branch, not in git) from the live site, so every sport has its trails, spots
// and zones like on a real phone.
//   node test/serve.mjs   (from android-app/, serves the repository root)
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { join, extname, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const LIVE = "https://trailfinderapp.ca/";
const root = fileURLToPath(new URL("../../", import.meta.url));
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript", ".css": "text/css", ".json": "application/json", ".png": "image/png",
  ".jpg": "image/jpeg", ".webp": "image/webp", ".svg": "image/svg+xml", ".webmanifest": "application/manifest+json", ".pbf": "application/x-protobuf", ".txt": "text/plain" };
createServer(async (req, res) => {
  let path, file;
  try { path = decodeURIComponent(new URL(req.url, "http://x").pathname).replace(/^\/+/, "") || "index.html"; file = normalize(join(root, path)); }
  catch { res.writeHead(400).end(); return; }
  try {
    if (!file.startsWith(root) || /^(\.git|\.github|scripts|supabase|ios-app|android-app)\//.test(path)) throw new Error("not served");
    const body = await readFile(file);
    res.writeHead(200, { "content-type": TYPES[extname(file)] || "application/octet-stream" }).end(body);
  } catch {
    try {
      const r = await fetch(LIVE + path + (new URL(req.url, "http://x").search || ""));
      res.writeHead(r.status, { "content-type": r.headers.get("content-type") || "application/octet-stream" }).end(Buffer.from(await r.arrayBuffer()));
    } catch { res.writeHead(502).end(); }
  }
}).listen(8080, "0.0.0.0", () => console.log("serving on 8080"));
