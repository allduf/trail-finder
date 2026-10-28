// Private head count: tells the Supabase database "this device used Trail Finder today", at most once a day.
// Each device gets a random id kept in localStorage (tf:device). Nothing else is sent: no name, no
// location, no IP address is stored. A daily GitHub Actions job (people-count.yml) counts the devices
// seen in the last 30 days and warns alex when it passes 50. The ping also says whether this is the iPhone app, the
// website on a phone or tablet, or the website on a computer (usage.html shows the split). See supabase/visitors.sql
// and supabase/visitors-kind.sql.
(() => {
  const acct = window.tfAccount;
  if (!acct || !acct.enabled || !/^https?:/.test(location.protocol)) return;
  // Only real visits to the live site: test browsers (Playwright, local copies) made a new "device" every run.
  if (navigator.webdriver || location.hostname !== "allduf.github.io") return;
  const lsGet = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
  const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch {} };

  // tf:pingDay2 (not tf:pingDay) so every device sends its kind on the first day too.
  const today = new Date().toISOString().slice(0, 10);
  if (lsGet("tf:pingDay2") === today) return;
  let device = lsGet("tf:device");
  if (!device) { device = crypto.randomUUID ? crypto.randomUUID() : String(Math.random()).slice(2) + Date.now(); lsSet("tf:device", device); }

  const C = window.Capacitor, ua = navigator.userAgent;
  // iPads say "Macintosh" but have a touch screen.
  const kind = C && C.isNativePlatform && C.isNativePlatform() ? "app"
    : /Mobi|Android|iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1) ? "phone" : "computer";
  const ping = (body) => fetch(`${acct.url}/rest/v1/rpc/tf_ping`, {
    method: "POST",
    headers: { "Content-Type": "application/json", apikey: acct.key, Authorization: `Bearer ${acct.key}` },
    body: JSON.stringify(body),
  });
  // Until visitors-kind.sql is run the database only knows tf_ping(device): still count the device, and try again
  // with the kind on the next page load.
  ping({ device, kind }).then((res) => {
    if (res.ok) lsSet("tf:pingDay2", today);
    else if (lsGet("tf:pingDay") !== today) ping({ device }).then((r) => { if (r.ok) lsSet("tf:pingDay", today); });
  }).catch(() => {});
})();
