// The test pages fetch files they don't have from the live site. A server hiccup there (a 502, 503 or 504, a dropped
// connection) is not the app's fault: try again up to 2 more times, 1 s then 3 s later (alex 2026-11-27, "make it fix
// itself"). A 404 or another answer is passed on as it is, so a file that's really missing still fails the test.
export async function fetchRetry(url, opts) {
  for (let i = 0; ; i++) {
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(60000), ...opts });
      if (![502, 503, 504].includes(r.status) || i >= 2) return r;
    } catch (e) { if (i >= 2) throw e; }
    await new Promise((ok) => setTimeout(ok, i ? 3000 : 1000));
  }
}
