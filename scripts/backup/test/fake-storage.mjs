// Tiny stand-in for Supabase Storage (download and upload with the secret key), for scripts/backup/test/run.sh.
// Files live in <root>/<bucket>/<path>; an upload also adds its storage.objects row through psql, like Supabase.
// Run: node fake-storage.mjs <port> <root folder> <database url> <key>
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

const [, , port, root, dbUrl, key] = process.argv;
const lit = (s) => "'" + String(s).replace(/'/g, "''") + "'";

http.createServer((req, res) => {
  if (req.headers.apikey !== key) { res.writeHead(401); return res.end("no key"); }
  const u = decodeURIComponent(new URL(req.url, "http://x").pathname);
  let m = u.match(/^\/storage\/v1\/object\/authenticated\/([^/]+)\/(.+)$/);
  if (req.method === "GET" && m) {
    const f = path.join(root, m[1], m[2]);
    if (!f.startsWith(root) || !fs.existsSync(f)) { res.writeHead(404); return res.end(); }
    res.writeHead(200);
    return res.end(fs.readFileSync(f));
  }
  m = u.match(/^\/storage\/v1\/object\/([^/]+)\/(.+)$/);
  if (req.method === "POST" && m) {
    const f = path.join(root, m[1], m[2]);
    if (!f.startsWith(root)) { res.writeHead(400); return res.end(); }
    if (fs.existsSync(f) && req.headers["x-upsert"] !== "true") { res.writeHead(400); return res.end('{"error":"Duplicate"}'); }
    const parts = [];
    req.on("data", (c) => parts.push(c));
    req.on("end", () => {
      fs.mkdirSync(path.dirname(f), { recursive: true });
      fs.writeFileSync(f, Buffer.concat(parts));
      const sql = `insert into storage.objects (bucket_id, name, metadata) values (${lit(m[1])}, ${lit(m[2])},
        jsonb_build_object('mimetype', ${lit(req.headers["content-type"])}))
        on conflict (bucket_id, name) do update set metadata = excluded.metadata`;
      execFileSync("psql", [dbUrl, "-X", "-q", "-c", sql]);
      res.writeHead(200);
      res.end("{}");
    });
    return;
  }
  res.writeHead(404);
  res.end();
}).listen(+port);
