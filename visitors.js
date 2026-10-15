// Private head count: tells the Supabase database "this device used Trail Finder today", at most once a day.
// Each device gets a random id kept in localStorage (tf:device). Nothing else is sent: no name, no
// location, no IP address is stored. A daily GitHub Actions job (people-count.yml) counts the devices
// seen in the last 30 days and warns alex when it passes 50. See supabase/visitors.sql.
(() => {
  const acct = window.tfAccount;
  if (!acct || !acct.enabled || !/^https?:/.test(location.protocol)) return;
  const lsGet = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
  const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch {} };

  const today = new Date().toISOString().slice(0, 10);
  if (lsGet("tf:pingDay") === today) return;
  let device = lsGet("tf:device");
  if (!device) { device = crypto.randomUUID ? crypto.randomUUID() : String(Math.random()).slice(2) + Date.now(); lsSet("tf:device", device); }

  fetch(`${acct.url}/rest/v1/rpc/tf_ping`, {
    method: "POST",
    headers: { "Content-Type": "application/json", apikey: acct.key, Authorization: `Bearer ${acct.key}` },
    body: JSON.stringify({ device }),
  }).then((res) => { if (res.ok) lsSet("tf:pingDay", today); }).catch(() => {});
})();
