// Trail condition reports from riders: quick dated "dry / tacky / muddy / trees down / snow" notes on a trail.
// Anyone can read them; posting needs the optional sign-in (account.js), to keep spam out.
// Stored in the Supabase table trail_reports (see supabase/trail-reports.sql).
// index.html calls tfReports.show(trail) when a trail's detail panel opens.
(() => {
  const acct = window.tfAccount;
  if (!acct || !acct.enabled) return;

  const KINDS = {
    dry: { icon: "☀️", label: "Dry" },
    tacky: { icon: "🤎", label: "Tacky, loamy" },
    muddy: { icon: "💧", label: "Muddy" },
    trees_down: { icon: "🌲", label: "Trees down" },
    snow: { icon: "❄️", label: "Snow" },
  };
  const LIST_DAYS = 90;       // reports listed in a trail's details
  const DAY = 86400000;

  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const when = (iso) => {
    const d = new Date(iso), days = Math.floor((Date.now() - d) / DAY);
    const date = d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
    const ago = days < 1 ? "today" : days === 1 ? "yesterday" : `${days} days ago`;
    return `${ago} · ${date}${days < 2 ? " " + d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" }) : ""}`;
  };
  const kind = (c) => KINDS[c] || { icon: "•", label: c };

  const css = document.createElement("style");
  css.textContent = `
.rep-list { list-style: none; margin: 0 0 10px; padding: 0; display: flex; flex-direction: column; gap: 6px; }
.rep-list li { display: flex; gap: 8px; align-items: flex-start; padding: 7px 9px; border: 1px solid var(--line); border-radius: 9px; }
.rep-list .rep-ico { font-size: 1.1rem; line-height: 1.3; }
.rep-list .rep-del { margin-left: auto; font-size: .8rem; }
.rep-pick { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 8px; }
.rep-pick button { font: inherit; font-weight: 600; padding: 6px 10px; border-radius: 999px; border: 1px solid var(--line); background: var(--chip); color: var(--fg); cursor: pointer; }
.rep-pick button[aria-pressed="true"] { background: var(--accent); color: var(--accent-fg, #fff); border-color: transparent; }
.rep-pick button { min-height: 40px; }
.rep-how { margin: 0 0 6px; }
.rep-form input { width: 100%; box-sizing: border-box; font: inherit; padding: 8px 10px; border: 1px solid var(--line); border-radius: 9px; background: var(--bg); color: var(--fg); margin-bottom: 8px; }
.rep-form .rep-send { font: inherit; font-weight: 600; padding: 8px 14px; border-radius: 9px; border: 0; background: var(--accent); color: var(--accent-fg, #fff); cursor: pointer; }
.rep-form .rep-send:disabled { opacity: .5; cursor: default; }`;
  document.head.appendChild(css);

  // ---------- trail details section ----------
  let current = null;   // the trail whose details are open
  async function show(t) {
    current = t;
    const box = document.getElementById("reports");
    if (!box) return;
    await acct.load();
    const type = t.osmType || "way";
    if (current !== t) return;
    if (!acct.client) {
      // No signal but signed in on this phone: reports can still be made, and post later.
      if (!navigator.onLine && acct.savedSession) { box.classList.remove("muted"); box.innerHTML = `<p class="muted">No signal, so other riders' reports can't load.</p>` + formHtml(t, type); wireForm(box, t, type); }
      else box.textContent = "Trail reports aren't available right now.";
      return;
    }
    const since = new Date(Date.now() - LIST_DAYS * DAY).toISOString();
    const { data, error } = await acct.client.from("trail_reports").select("id, user_id, condition, note, created_at")
      .eq("osm_type", type).eq("osm_id", t.id).gte("created_at", since).order("created_at", { ascending: false }).limit(30);
    if (current !== t || !document.body.contains(box)) return;
    box.classList.remove("muted");
    const me = acct.user ? acct.user.id : null;
    const list = error ? `<p class="muted">Couldn't load reports (${esc(error.message)}).</p>`
      : !data.length ? `<p class="muted">No reports in the last ${LIST_DAYS} days. Rode it lately? Tell other riders how it was.</p>`
      : `<ul class="rep-list">${data.map((r) => { const k = kind(r.condition); return `<li><span class="rep-ico" aria-hidden="true">${k.icon}</span><div><strong>${esc(k.label)}</strong> <span class="muted">${esc(when(r.created_at))}${r.user_id === me ? " · you" : ""}</span>${r.note ? `<div>${esc(r.note)}</div>` : ""}</div>${r.user_id === me ? `<button type="button" class="linkish rep-del" data-id="${r.id}">Delete</button>` : ""}</li>`; }).join("")}</ul>`;
    const form = me ? formHtml(t, type)
      : `<p><button type="button" class="linkish rep-signin">Sign in to post a report</button> <span class="muted">(reading reports needs no account)</span></p>`;
    box.innerHTML = list + form;

    box.querySelectorAll(".rep-del").forEach((b) => b.addEventListener("click", async () => {
      b.disabled = true;
      const { error: e } = await acct.client.from("trail_reports").delete().eq("id", +b.dataset.id);
      if (e) { b.disabled = false; b.textContent = "Couldn't delete"; return; }
      show(t);
    }));
    const signIn = box.querySelector(".rep-signin");
    if (signIn) signIn.addEventListener("click", () => { const b = document.querySelector(".acct-btn"); if (b) b.click(); });
    if (me) wireForm(box, t, type);
  }
  // One tap posts (alex, from Trailforks): type a note first if you want one. With no signal it waits on the
  // phone and posts when you're back online.
  function formHtml(t, type) {
    const waiting = queue().filter((q) => q.osm_type === type && q.osm_id === t.id);
    return `<div class="rep-form"><p class="muted rep-how">How was it? One tap posts it${navigator.onLine ? "" : " when you're back online"}.</p>
        <input type="text" maxlength="280" placeholder="Optional note first, like “big cedar down below the bridge”">
        <div class="rep-pick" role="group" aria-label="How was it?">${Object.entries(KINDS).map(([c, k]) => `<button type="button" data-c="${c}">${k.icon} ${esc(k.label)}</button>`).join("")}</div>
        <span class="muted rep-msg" role="status">${waiting.length ? `${waiting.length} report${waiting.length > 1 ? "s" : ""} waiting for signal to post.` : ""}</span></div>`;
  }
  function wireForm(box, t, type) {
    const note = box.querySelector(".rep-form input"), msg = box.querySelector(".rep-msg");
    box.querySelectorAll(".rep-pick button").forEach((b) => b.addEventListener("click", async () => {
      box.querySelectorAll(".rep-pick button").forEach((x) => { x.disabled = true; x.setAttribute("aria-pressed", String(x === b)); });
      msg.textContent = "Posting…";
      const mid = t.geom[Math.floor(t.geom.length / 2)], p = Array.isArray(mid) ? mid : [mid.lat, mid.lng];
      const name = t.tags && (t.tags.name || t.tags["mtb:name"]);
      const row = { osm_type: type, osm_id: t.id, trail_name: name ? String(name).slice(0, 120) : null,
        lat: p[0], lon: p[1], condition: b.dataset.c, note: note.value.trim().slice(0, 280) || null };
      const r = await post(row);
      if (r === "queued") { msg.textContent = "No signal: saved on this phone, it posts when you're back online."; note.value = ""; box.querySelectorAll(".rep-pick button").forEach((x) => { x.disabled = false; }); return; }
      if (r) { msg.textContent = "Couldn't post: " + r; box.querySelectorAll(".rep-pick button").forEach((x) => { x.disabled = false; }); return; }
      show(t);
    }));
  }

  // ---------- reports made with no signal ----------
  // tf:repQueue (this device): rows to post, each with the time it was made. Posted when the phone is online and signed in.
  const QKEY = "tf:repQueue";
  function queue() { try { const v = JSON.parse(localStorage.getItem(QKEY) || "[]"); return Array.isArray(v) ? v : []; } catch { return []; } }
  const putQueue = (q) => { try { if (q.length) localStorage.setItem(QKEY, JSON.stringify(q)); else localStorage.removeItem(QKEY); } catch {} };
  const offlineErr = (e) => !navigator.onLine || /fetch|network|load failed/i.test(String(e && (e.message || e)));
  // Returns null when posted, "queued" when kept for later, or the error message.
  async function post(row) {
    if (!navigator.onLine) { putQueue([...queue(), { ...row, made: Date.now() }]); return "queued"; }
    try {
      const { error: e } = await acct.client.from("trail_reports").insert(row);
      if (!e) return null;
      if (offlineErr(e)) { putQueue([...queue(), { ...row, made: Date.now() }]); return "queued"; }
      return e.message;
    } catch (e) {
      if (offlineErr(e)) { putQueue([...queue(), { ...row, made: Date.now() }]); return "queued"; }
      return e.message || String(e);
    }
  }
  let flushing = false;
  async function flush() {
    const q = queue();
    if (flushing || !q.length || !navigator.onLine) return;
    await acct.load();
    if (!acct.client || !acct.user) return;
    flushing = true;
    const left = [];
    for (const { made, ...row } of q) {
      // Say how long ago it was, since the report goes up later than the ride.
      const late = Date.now() - made > 30 * 60000 ? `(from ${new Date(made).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}) ` : "";
      try {
        const { error: e } = await acct.client.from("trail_reports").insert({ ...row, note: late || row.note ? (late + (row.note || "")).trim().slice(0, 280) : null });
        if (e && offlineErr(e)) left.push({ made, ...row });
      } catch { left.push({ made, ...row }); }
    }
    putQueue(left);
    flushing = false;
    if (current && document.getElementById("reports")) show(current);
  }
  window.addEventListener("online", flush);
  window.addEventListener("tf:account", flush);
  setTimeout(flush, 3000);

  window.tfReports = { show };
  window.addEventListener("tf:account", () => { if (current && document.getElementById("reports")) show(current); });
})();
