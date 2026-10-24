// Rider grades: riders give any MTB trail their own difficulty grade (green, blue, black, double black, pro line),
// and the app shows what riders say. Anyone sees the grades; giving one needs the optional sign-in (account.js).
// Stored in the Supabase table trail_grades, one grade per rider per trail piece (see supabase/trail-grades.sql).
// The counts for the whole map load once (view trail_grade_counts, kept on this device for the next visit), so every
// trail's riders' grade is known without opening it. A trail with no rating on OpenStreetMap or in open data takes
// the riders' grade before a slope estimate (ratings.js rate()).
// index.html calls tfGrades.show(trail) when a trail's detail panel opens; "tf:grades" fires when the counts change.
(() => {
  const LEVELS = ["green", "blue", "black", "dbl", "pro"];
  const LABEL = { green: "Green", blue: "Blue", black: "Black", dbl: "Double black", pro: "Pro line" };
  const SYM = { green: "●", blue: "■", black: "◆", dbl: "◆◆", pro: "▲" };
  const CACHE = "tf:gradeCounts", QKEY = "tf:gradeQueue";
  const MAX_SEGS = 60;   // a joined trail's pieces all take the rider's grade

  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const lsGet = (k) => { try { return JSON.parse(localStorage.getItem(k) || "null"); } catch { return null; } };
  const lsSet = (k, v) => { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, JSON.stringify(v)); } catch {} };
  const keyOf = (type, id) => (type === "relation" ? "r" : "w") + id;

  // counts: "w123" -> { green: 2, black: 1 }
  let counts = new Map(Object.entries(lsGet(CACHE) || {}));
  const changed = () => {
    if (window.tfRatings && window.tfRatings.changed) window.tfRatings.changed();
    window.dispatchEvent(new Event("tf:grades"));
  };

  // What riders say about one trail piece: { d, n, by } (d = the middle grade of all riders' grades, harder on a tie), or null.
  function of(id, type) {
    const c = counts.get(keyOf(type || "way", Number(String(id).replace(/^\D+/, ""))));
    if (!c) return null;
    const all = LEVELS.flatMap((l) => Array(c[l] || 0).fill(l));
    if (!all.length) return null;
    return { d: all[all.length >> 1], n: all.length, by: c };
  }
  const byText = (g) => LEVELS.filter((l) => g.by[l]).map((l) => `${g.by[l]} ${LABEL[l].toLowerCase()}`).join(", ");
  // For ratings.js: the riders' grade as a rating.
  function rating(id, mapped) {
    const g = of(id);
    if (!g) return null;
    return { d: g.d, src: "riders", why: `Graded ${LABEL[g.d].toLowerCase()} by ${g.n === 1 ? "1 rider" : `${g.n} riders`} in Trail finder${g.n > 1 ? ` (${byText(g)})` : ""}.${mapped || ""}` };
  }

  // ---------- counts for the whole map ----------
  // Plain REST read (no sign-in library needed), a page of 1000 rows at a time.
  async function loadCounts() {
    const acct = window.tfAccount;
    if (!acct || !acct.enabled || !navigator.onLine) return;
    const next = new Map();
    try {
      for (let from = 0; from < 50000; from += 1000) {
        const r = await fetch(`${acct.url}/rest/v1/trail_grade_counts?select=osm_type,osm_id,grade,riders`, {
          headers: { apikey: acct.key, Authorization: `Bearer ${acct.key}`, Range: `${from}-${from + 999}` } });
        if (!r.ok) return;   // the table isn't set up yet, or no signal: keep what this device had
        const rows = await r.json();
        rows.forEach((x) => { const k = keyOf(x.osm_type, x.osm_id), c = next.get(k) || {}; c[x.grade] = x.riders; next.set(k, c); });
        if (rows.length < 1000) break;
      }
    } catch { return; }
    const before = JSON.stringify([...counts]), after = JSON.stringify([...next]);
    counts = next;
    lsSet(CACHE, Object.fromEntries(next));
    if (before !== after) changed();
  }

  // ---------- giving a grade ----------
  // Grades given with no signal wait on this device (tf:gradeQueue: trail key -> { rows, grade }) and go up when back online.
  async function save(rows, grade) {
    const acct = window.tfAccount;
    await acct.load();
    if (!acct.client || !acct.user) return "Sign in first";
    const ids = rows.map((r) => r.osm_id), type = rows[0].osm_type;
    const { error } = grade
      ? await acct.client.from("trail_grades").upsert(rows.map((r) => ({ ...r, grade, updated_at: new Date().toISOString() })), { onConflict: "user_id,osm_type,osm_id" })
      : await acct.client.from("trail_grades").delete().eq("user_id", acct.user.id).eq("osm_type", type).in("osm_id", ids);
    return error ? error.message : null;
  }
  const offlineErr = (e) => !navigator.onLine || /fetch|network|load failed/i.test(String(e));
  let flushing = false;
  async function flush() {
    const q = lsGet(QKEY) || {};
    if (flushing || !Object.keys(q).length || !navigator.onLine || !window.tfAccount) return;
    await window.tfAccount.load();
    if (!window.tfAccount.client || !window.tfAccount.user) return;
    flushing = true;
    for (const [k, v] of Object.entries(q)) {
      const e = await save(v.rows, v.grade).catch((x) => x.message || String(x));
      if (!e || !offlineErr(e)) delete q[k];
    }
    lsSet(QKEY, Object.keys(q).length ? q : null);
    flushing = false;
    loadCounts();
  }
  // Count the change on this device right away, so the trail shows it before the next load.
  function countHere(rows, was, now) {
    rows.forEach((r) => {
      const k = keyOf(r.osm_type, r.osm_id), c = { ...(counts.get(k) || {}) };
      if (was && c[was]) c[was]--;
      if (now) c[now] = (c[now] || 0) + 1;
      LEVELS.forEach((l) => { if (!c[l]) delete c[l]; });
      if (Object.keys(c).length) counts.set(k, c); else counts.delete(k);
    });
    lsSet(CACHE, Object.fromEntries(counts));
    changed();
  }

  // ---------- trail details section ----------
  const css = document.createElement("style");
  css.textContent = `
.rg-box { margin: 4px 0 10px; padding: 9px 11px; border: 1px solid var(--line); border-radius: 10px; }
.rg-box .rg-say { margin: 0 0 6px; }
.rg-box .rg-say .diff { margin-left: 2px; }
.rg-pick { display: flex; flex-wrap: wrap; gap: 6px; margin: 4px 0 2px; }
.rg-pick button { font: inherit; font-weight: 600; min-height: 38px; padding: 5px 10px; border-radius: 999px; border: 1px solid var(--line); background: var(--chip); color: var(--fg); cursor: pointer; }
.rg-pick button .rg-sym { margin-right: 3px; }
.rg-pick button.g-green .rg-sym { color: #2f9e44; } .rg-pick button.g-blue .rg-sym { color: #1c6fe0; } .rg-pick button.g-dbl .rg-sym { color: #d6202a; } .rg-pick button.g-pro .rg-sym { color: #e8590c; }
.rg-pick button[aria-pressed="true"] { background: var(--accent); color: var(--accent-fg, #fff); border-color: transparent; }
.rg-pick button[aria-pressed="true"] .rg-sym { color: inherit; }
.rg-pick button:disabled { opacity: .6; cursor: default; }
.rg-msg { font-size: .88rem; }`;
  document.head.appendChild(css);

  let current = null, mine = null;   // the trail whose details are open, and this rider's grade for it
  const rowsOf = (t) => {
    const type = t.osmType || "way", name = t.tags && (t.tags.name || t.tags["mtb:name"] || t.tfName);
    const ids = [...new Set([t.id, ...(type === "way" && t.segIds ? t.segIds : [])])].slice(0, MAX_SEGS);
    return ids.map((id) => ({ osm_type: type, osm_id: id, trail_name: name ? String(name).slice(0, 120) : null }));
  };
  function paint(box, t, msg) {
    const g = of(t.id, t.osmType), acct = window.tfAccount;
    const me = acct && acct.user, waiting = (lsGet(QKEY) || {})[keyOf(t.osmType || "way", t.id)];
    const say = g ? `<strong>Riders say</strong> <span class="diff d-${g.d}">${SYM[g.d]} ${LABEL[g.d]}</span> <span class="muted">${g.n === 1 ? "1 rider" : `${g.n} riders`}${g.n > 1 ? `: ${esc(byText(g))}` : ""}</span>`
      : `<strong>No rider grades yet.</strong> <span class="muted">Ridden it? Say how hard it is.</span>`;
    const pick = me || (acct && acct.savedSession && !navigator.onLine)
      ? `<div class="muted">${mine ? "Your grade (tap it again to take it back):" : "Your grade, one tap:"}</div>
         <div class="rg-pick" role="group" aria-label="Your grade">${LEVELS.map((l) => `<button type="button" class="g-${l}" data-g="${l}" aria-pressed="${mine === l}"><span class="rg-sym" aria-hidden="true">${SYM[l]}</span>${LABEL[l]}</button>`).join("")}</div>`
      : acct && acct.enabled ? `<p><button type="button" class="linkish rg-signin">Sign in to give your grade</button> <span class="muted">(seeing grades needs no account)</span></p>` : "";
    box.innerHTML = `<p class="rg-say">${say}</p>${pick}<span class="muted rg-msg" role="status">${esc(msg || (waiting ? "Your grade is waiting for signal to go up." : ""))}</span>`;
    const signIn = box.querySelector(".rg-signin");
    if (signIn) signIn.addEventListener("click", () => { if (acct.open) acct.open(); else { const b = document.querySelector(".acct-btn"); if (b) b.click(); } });
    box.querySelectorAll(".rg-pick button").forEach((b) => b.addEventListener("click", () => give(box, t, b.dataset.g === mine ? null : b.dataset.g)));
  }
  async function give(box, t, grade) {
    const rows = rowsOf(t), was = mine;
    box.querySelectorAll(".rg-pick button").forEach((x) => { x.disabled = true; });
    const queue = () => {
      const q = lsGet(QKEY) || {};
      q[keyOf(rows[0].osm_type, t.id)] = { rows, grade };
      lsSet(QKEY, q);
      mine = grade; countHere(rows, was, grade);
      paint(box, t, "No signal: saved on this phone, it goes up when you're back online.");
    };
    if (!navigator.onLine) { queue(); return; }
    const e = await save(rows, grade).catch((x) => x.message || String(x));
    if (current !== t) return;
    if (e && offlineErr(e)) { queue(); return; }
    if (e) { paint(box, t, "Couldn't save your grade: " + e); return; }
    mine = grade; countHere(rows, was, grade);
    paint(box, t, grade ? "Thanks! Your grade is in." : "Your grade is taken back.");
  }
  async function show(t) {
    current = t; mine = null;
    const box = document.getElementById("riderGrade");
    if (!box) return;
    paint(box, t);
    const acct = window.tfAccount;
    if (!acct || !acct.enabled || !acct.user || !navigator.onLine) {
      const w = (lsGet(QKEY) || {})[keyOf(t.osmType || "way", t.id)];
      if (w) { mine = w.grade; paint(box, t); }
      return;
    }
    await acct.load();
    if (!acct.client || current !== t) return;
    const { data } = await acct.client.from("trail_grades").select("grade").eq("user_id", acct.user.id)
      .eq("osm_type", t.osmType || "way").eq("osm_id", t.id).maybeSingle();
    if (current !== t || !document.body.contains(box)) return;
    mine = data ? data.grade : null;
    paint(box, t);
  }

  window.tfGrades = { of, rating, show, label: (d) => LABEL[d] };
  window.addEventListener("tf:account", () => { flush(); if (current && document.getElementById("riderGrade")) show(current); });
  window.addEventListener("online", () => { flush(); loadCounts(); });
  window.addEventListener("tf:grades", () => { const box = document.getElementById("riderGrade"); if (current && box && !box.querySelector(".rg-msg:not(:empty)")) paint(box, current); });
  if (counts.size) setTimeout(changed, 0);   // this device's copy from the last visit, until the fresh counts load
  setTimeout(() => { loadCounts(); flush(); }, 2500);
  setInterval(() => { if (document.visibilityState === "visible") loadCounts(); }, 10 * 60000);
})();
