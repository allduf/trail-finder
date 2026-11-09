// Ask in plain words (alex approved from the competitor review, 2026-10-27): one box on every sport's Find page, like
// "2-hour loop with prime loam near Squamish tomorrow". The free AI (Gemini, in the photo function, mode "ask": its own
// daily limits per app and per person) only reads the words and says what to look for: the place, the day, the length,
// the levels, prime loam, new... The answer always comes from the app's own data, the same as the rest of the app:
//  - MTB: loops (loops.js: from a parking lot, never bike park trails), trails (the All trails lists, the shared Loam
//    readings for that day, new trails, your Ridden list) or riding areas (data/riding-areas.json).
//  - Skiing: tours, nordic, snowshoe or snowmobile routes with their risk light, huts, the avalanche forecast (winter.js).
//  - Hunting: the spot card at the place (zone, what's open, rules: hunting.js).
//  - Fishing: stocked waters near the place, for the fish named (fishing.js), or the spot card.
//  - Adventure moto: ADV routes near the place (data/moto-routes.json), or the spot card.
// When the AI isn't there (no signal to it, its daily limit reached, the function not updated yet) the words are read
// here, more simply, and the answer says so.
(() => {
  "use strict";
  const map = window.tfLeaflet;
  if (!map || !window.L || window.tfAsk) return;
  const AI_FN = "smooth-worker";
  // For alex's usage page (usage.js): what is asked or searched, and how many answers came back.
  const logUse = (...a) => (window.tfUse ? window.tfUse(...a) : (window.tfUseQ = window.tfUseQ || []).push(a));
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const kmTo = (a, b) => Math.hypot((a[1] - b[1]) * 111.32 * Math.cos(a[0] * Math.PI / 180), (a[0] - b[0]) * 110.57);
  const norm = (s) => String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, " ").trim();
  const sportOf = () => ["ski", "hunt", "fish", "moto"].find((s) => document.body.classList.contains("sport-" + s)) || "mtb";
  const localDay = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  const addDays = (iso, n) => { const d = new Date(iso + "T12:00"); d.setDate(d.getDate() + n); return localDay(d); };
  const dayName = (d) => {
    const n = Math.round((Date.parse(d + "T12:00") - Date.parse(localDay() + "T12:00")) / 864e5);
    return n <= 0 ? "today" : n === 1 ? "tomorrow" : new Date(d + "T12:00").toLocaleDateString(undefined, { weekday: "long" });
  };
  const fmtKm = (k) => (k < 1 ? "under 1 km" : `${k < 10 ? k.toFixed(1) : Math.round(k)} km`);

  // Each sport's own words (alex, 2026-10-26: "every mode should have its own feature").
  const SP = {
    mtb: { ph: "2-hour loop in prime loam near Squamish tomorrow", ex: ["2-hour loop in prime loam near Squamish tomorrow", "New blue trails near Pemberton I haven't ridden", "Where to ride today near me"] },
    ski: { ph: "Simple ski tour near Whistler", ex: ["Simple ski tour near Whistler", "Huts near Rogers Pass", "Avalanche danger near Revelstoke tomorrow"] },
    hunt: { ph: "What can I hunt near Pemberton", ex: ["What can I hunt near Pemberton", "Elk near Canmore", "Deer season near Kamloops"] },
    fish: { ph: "Lakes stocked with rainbow trout near Kamloops", ex: ["Lakes stocked with rainbow trout near Kamloops", "Where to fish near Squamish", "Fishing rules near Banff"] },
    moto: { ph: "Dirt route under 300 km near Kamloops", ex: ["Dirt route under 300 km near Kamloops", "ADV routes near Revelstoke", "Gas and camping near Lillooet"] },
  };

  const css = document.createElement("style");
  css.textContent = `
form.ask-box { display: flex; flex-direction: column; gap: 5px; margin: 0; }
form.ask-box label { font-size: .78rem; font-weight: 800; letter-spacing: .04em; text-transform: uppercase; color: var(--muted); }
.ask-row { display: flex; gap: 6px; }
.ask-in { flex: 1; min-width: 0; font: inherit; font-size: 16px; box-sizing: border-box; padding: 9px 12px; border: 1px solid var(--line); border-radius: 12px; background: var(--panel); color: var(--fg); }
.ask-go { font: inherit; font-size: .9rem; font-weight: 700; padding: 0 16px; min-height: 42px; border-radius: 12px; border: 0; background: #1f5fe0; color: #fff; cursor: pointer; }
.hub form.ask-box { margin: 10px 0 2px; }
#panel > .panel-head form.ask-box.ask-desk { margin: 2px 0 8px; }
dialog.ask-dlg form.ask-box label { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); }
/* ONE bar for searching and asking, on phones and computers (alex 2026-11-07: "Not clear if I Ask things in the search
   bar or not? Should it be in the same bar or two separate bar?"). The sport's own search box takes questions (asks()
   below), says so in its placeholder, and its Go button turns into Ask while the words read like a question. The Ask box
   is only used inside the answer sheet now. */
form.ask-box:not(.ask-in-dlg) { display: none !important; }
.ask-will { all: unset; box-sizing: border-box; display: block; width: 100%; cursor: pointer; margin: 2px 0 0; padding: 9px 12px; border-radius: 12px; border: 1px dashed #1f5fe0; font-size: .9rem; font-weight: 600; color: #1f5fe0; line-height: 1.3; }
.ask-will b { font-weight: 700; }
#trailHits .hnote .ask-will { margin: 0; }
.ask-will[hidden] { display: none; }
#skFindForm.tf-asking ~ #skPlaceMsg, form.ps-box.tf-asking .ps-msg { display: none; }
.ask-try { all: unset; display: none; box-sizing: border-box; cursor: pointer; font-size: .84rem; color: var(--muted); padding: 2px 2px 4px; line-height: 1.35; }
.ask-try b { color: #1f5fe0; font-weight: 600; }
dialog.ask-dlg { border: 1px solid var(--line); border-radius: 14px; background: var(--panel); color: var(--fg); padding: 14px; width: min(540px, calc(100vw - 16px)); max-height: calc(100dvh - 24px); overflow: auto; box-sizing: border-box; box-shadow: 0 10px 40px rgba(0,0,0,.3); font: inherit; }
dialog.ask-dlg::backdrop { background: rgba(0,0,0,.45); }
dialog.ask-dlg h2 { margin: 0 0 8px; font-family: var(--font-display); font-size: 1.25rem; display: flex; justify-content: space-between; align-items: center; gap: 8px; }
dialog.ask-dlg h2 button { font: inherit; border: 0; background: none; color: var(--muted); font-size: 1.3rem; cursor: pointer; min-width: 40px; min-height: 40px; }
dialog.ask-dlg h3 { margin: 14px 0 6px; font-size: .76rem; font-weight: 800; letter-spacing: .06em; text-transform: uppercase; color: var(--muted); }
.ask-said { margin: 10px 0 0; font-size: .92rem; font-weight: 650; }
.ask-chips { display: flex; flex-wrap: wrap; gap: 4px; margin: 6px 0 0; padding: 0; list-style: none; }
.ask-chips li { font-size: .76rem; padding: 2px 9px; border-radius: 999px; background: var(--chip, #eef1f4); border: 1px solid var(--line); }
.ask-note { margin: 6px 0 0; color: var(--muted); font-size: .8rem; }
.ask-warn { color: #b45309; }
.ask-ex { display: flex; flex-direction: column; gap: 5px; margin: 6px 0 0; }
.ask-ex button { all: unset; box-sizing: border-box; cursor: pointer; font-size: .86rem; padding: 8px 10px; border-radius: 10px; border: 1px dashed var(--line); color: #1f5fe0; }
ol.ask-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 6px; }
ol.ask-list > li > button { width: 100%; text-align: left; font: inherit; padding: 9px 11px; border-radius: 10px; border: 1px solid var(--line); background: var(--chip, #fff); color: var(--fg); cursor: pointer; display: flex; flex-direction: column; gap: 2px; min-height: 44px; }
ol.ask-list b { font-size: .96rem; } ol.ask-list small { color: var(--muted); font-size: .8rem; }
.ask-dot { display: inline-block; width: 9px; height: 9px; border-radius: 50%; margin-right: 5px; }
.ask-new { display: inline-block; font-size: .7rem; font-weight: 800; padding: 1px 7px; border-radius: 999px; background: #b8f03a; color: #10230f; margin-left: 6px; vertical-align: 1px; }
.ask-lv { font-weight: 800; margin-right: 4px; }
.ask-areas { display: flex; flex-wrap: wrap; gap: 5px; margin: 0 0 4px; }
.ask-areas button { font: inherit; font-size: .82rem; font-weight: 600; padding: 6px 11px; min-height: 36px; border-radius: 999px; border: 1px solid var(--line); background: var(--chip, #fff); color: var(--fg); cursor: pointer; }
.ask-areas button[aria-pressed="true"] { background: #1f5fe0; border-color: #1f5fe0; color: #fff; }
.ask-act { font: inherit; font-weight: 700; padding: 10px 14px; min-height: 44px; border-radius: 12px; border: 0; background: #1f5fe0; color: #fff; cursor: pointer; width: 100%; margin: 6px 0 0; }
.ask-act.ask-act2 { background: transparent; color: #1f5fe0; box-shadow: inset 0 0 0 2px #1f5fe0; }
.ask-more { font: inherit; font-weight: 700; padding: 8px 14px; min-height: 44px; border-radius: 12px; border: 1px solid var(--line); background: var(--chip, #fff); color: #1f5fe0; cursor: pointer; width: 100%; margin: 6px 0 0; }
.ask-wait { color: var(--muted); font-size: .88rem; padding: 6px 0; }
ol.ask-plan { margin: 0; padding: 0 0 0 4px; list-style: none; counter-reset: st; display: flex; flex-direction: column; gap: 6px; }
ol.ask-plan li { counter-increment: st; display: flex; flex-wrap: wrap; align-items: baseline; gap: 4px; font-size: .95rem; padding: 8px 10px 8px 34px; border: 1px solid var(--line); border-radius: 10px; position: relative; }
ol.ask-plan li::before { content: counter(st); position: absolute; left: 9px; top: 8px; width: 18px; height: 18px; border-radius: 50%; background: #e8590c; color: #fff; font-size: .72rem; font-weight: 800; display: grid; place-items: center; }
ul.ask-why { margin: 4px 0 0; padding: 0 0 0 18px; font-size: .84rem; display: flex; flex-direction: column; gap: 3px; }
ol.ask-plan small { color: var(--muted); font-size: .78rem; flex-basis: 100%; }`;
  document.head.append(css);

  // ---------- the box (on each sport's Find page) and the answer sheet ----------
  const boxHtml = (sp, cls = "") => `<form class="ask-box ${cls}" data-ask="${sp}" role="search"><label for="askIn-${sp}${cls ? "-" + cls : ""}">💬 Ask in plain words</label>
    <div class="ask-row"><input class="ask-in" id="askIn-${sp}${cls ? "-" + cls : ""}" type="search" enterkeyhint="search" autocomplete="off" placeholder="${esc(SP[sp].ph)}" aria-label="Ask in plain words"><button type="submit" class="ask-go">Ask</button></div></form>`;
  document.addEventListener("click", (e) => { const b = e.target.closest && e.target.closest(".ask-try"); if (b) open(b.dataset.try); });
  // The sport's own search box answers questions too (interface review 2026-11-02: two search boxes on Find). Words that
  // read like a question ("loop near Squamish tomorrow", "what can I hunt near Pemberton") go to Ask; names (a trail, a
  // town, "Lord of the Squirrels") stay with the normal search.
  // alex 2026-11-06: "Simple ski tour in the duffeys" got "No place named …" ("Not clear where to ask"): "in the …",
  // planning words and how hard read as a question too, and words that aren't a place go to Ask. One box for everything.
  const QWORD = /\b(near|nearby|around|loop|loops|where|what|which|how|when|best|today|tomorrow|tonight|weekend|stocked|danger|hours?|km|under|i|me)\b/i;
  // (not in MTB, where trail names like "Walk in the Park" are searched by name)
  const QMORE = /\b(in the|plan|touring|simple|easy|beginner|intermediate|advanced|challenging|want|find|show)\b/i;
  const asks = (q) => !document.body.classList.contains("sport-hike") && !!SP[sportOf()] && q.trim().split(/\s+/).length >= 3 && (QWORD.test(q) || (sportOf() !== "mtb" && QMORE.test(q)) || (sportOf() === "ski" && planLike(q)));
  // (Skiing: a plan of the day typed without "I want…", like "start at the top of Showcase, ski DOA, finish in Lakeside
  // Bowl", goes to Ask too, which makes it a tour; the video thread found it running a place search, 2026-11-05.)
  document.addEventListener("submit", (e) => {
    // Only each sport's own search under its buttons (and Skiing's find box), not a box like Plan a route's "Add a place".
    const f = e.target.closest && e.target.closest("form.ps-box, form#skFindForm");
    const inp = f && f.querySelector("input"), q = inp ? inp.value.trim() : "";
    const own = f && (f.id === "skFindForm" || (f.previousElementSibling && f.previousElementSibling.matches(".hn-actions, .fs-actions, .mt-actions")));
    if (!own || f.closest("dialog") || !asks(q)) return;
    e.preventDefault(); e.stopImmediatePropagation();
    inp.blur(); open(q);
  }, true);
  // While typing in that one bar: when the words read like a question, Go says Ask and one line says what will happen.
  const ownBox = (el) => {
    if (!el || el.tagName !== "INPUT") return null;
    if (el.id === "trailQ") return { inp: el, btn: $("trailGo"), row: null };   // its list under the box says it (index.html)
    const f = el.closest("form.ps-box, form#skFindForm");
    if (!f || f.closest("dialog")) return null;
    const own = f.id === "skFindForm" || (f.previousElementSibling && f.previousElementSibling.matches(".hn-actions, .fs-actions, .mt-actions"));
    return own ? { inp: el, btn: f.querySelector(".ps-go"), row: f.querySelector(".ps-row") } : null;
  };
  const askCue = (b) => {
    if (!b) return;
    const on = asks(b.inp.value || "");
    if (b.btn) {
      if (!b.btn.dataset.word) b.btn.dataset.word = b.btn.textContent;
      b.btn.textContent = on ? "Ask" : b.btn.dataset.word;
    }
    if (!b.row) return;
    // (inside the form, right under its row, so it stays with the box wherever the pane puts it)
    let will = b.row.nextElementSibling && b.row.nextElementSibling.classList.contains("ask-will") ? b.row.nextElementSibling : null;
    if (!will && !on) return;
    if (!will) { will = document.createElement("button"); will.type = "submit"; will.className = "ask-will"; b.row.after(will); }
    will.hidden = !on;
    will.innerHTML = on ? `<span aria-hidden="true">💬 </span><span>Ask</span> <b>“${esc(b.inp.value.trim())}”</b>` : "";
    b.row.closest("form").classList.toggle("tf-asking", on);
  };
  document.addEventListener("click", (e) => { if (e.target.closest && e.target.closest("[data-ask-now]")) trailAsk(e); }, true);
  document.addEventListener("input", (e) => askCue(ownBox(e.target)));
  document.addEventListener("search", (e) => askCue(ownBox(e.target)), true);   // the ✕ in the box
  document.addEventListener("focusout", (e) => { const b = ownBox(e.target); if (b) setTimeout(() => askCue(b), 0); });
  const trailAsk = (e) => {
    const inp = $("trailQ"), q = inp ? inp.value.trim() : "";
    if (!asks(q)) return;
    e.preventDefault(); e.stopImmediatePropagation();
    inp.blur(); open(q);
  };
  document.addEventListener("keydown", (e) => { if (e.key === "Enter" && e.target && e.target.id === "trailQ") trailAsk(e); }, true);
  document.addEventListener("click", (e) => { if (e.target.closest && e.target.closest("#trailGo")) trailAsk(e); }, true);
  document.addEventListener("submit", (e) => {
    const f = e.target.closest && e.target.closest("form[data-ask]");
    if (!f) return;
    e.preventDefault();
    const inp = f.querySelector(".ask-in"), q = inp.value.trim();
    inp.blur();
    open(q);
  });
  // MTB on a computer: above Where to ride today (on phones it's on the Find page, index.html's hubHtml).
  const desk = () => {
    if (document.querySelector("form.ask-desk")) return;
    const a = $("todayBtn") || $("wantList");
    if (a) a.insertAdjacentHTML("beforebegin", boxHtml("mtb", "ask-desk"));
  };
  // The other sports: in their own panel, under their buttons. Adventure moto's panel comes when Moto is first picked.
  const PANES = { ski: ["#skiPane", "#skPlaces"], hunt: ["#huntPane", ".ps-box"], fish: ["#fishPane", ".ps-box"], moto: ["#motoPane", ".ps-box"] };
  function mount() {
    desk();
    let left = 0;
    for (const [sp, [pane, after]] of Object.entries(PANES)) {
      const p = document.querySelector(pane);
      if (!p) { left++; continue; }
      if (p.querySelector("form.ask-box")) continue;
      const a = p.querySelector(after);
      if (a) a.insertAdjacentHTML("afterend", boxHtml(sp)); else p.insertAdjacentHTML("afterbegin", boxHtml(sp));
    }
    return left;
  }
  if (mount()) {
    const mo = new MutationObserver(() => { if (!mount()) mo.disconnect(); });
    mo.observe(document.body, { childList: true, subtree: true });
  }

  const dlg = document.createElement("dialog");
  dlg.className = "ask-dlg";
  dlg.tabIndex = -1;   // the sheet itself takes the focus, not the ✕ (and the phone's keyboard stays down)
  dlg.innerHTML = `<h2><span>💬 Ask</span><button type="button" aria-label="Close">✕</button></h2><div class="ask-top"></div><div class="ask-head"></div><div class="ask-out"></div>`;
  document.body.append(dlg);
  dlg.querySelector("h2 button").addEventListener("click", () => dlg.close());
  dlg.addEventListener("click", (e) => { if (e.target === dlg) dlg.close(); });   // a tap outside the sheet
  dlg.querySelector(".ask-out").addEventListener("click", (e) => { if (e.target.closest("button") && !e.target.closest(".ask-ex, .ask-more")) logUse("pick", "Ask"); });
  const close = () => { if (dlg.open) dlg.close(); };
  // Opened from Skiing's Plan a tour ("Tap the map where you start", alex 2026-11-07: "When I click plan a route I want
  // to be able to ask what I want to plan"): the words are read as the plan of the day, whatever they're worded like.
  let planAsk = false;
  dlg.addEventListener("close", () => { planAsk = false; });
  const PLAN_EX = ["Start at the top of Showcase, ski DOA, finish in Lakeside Bowl", "Start at Joffre Lakes parking, skin up the Shoulder, finish at the parking", "From the top of 7th Heaven ski Lakeside Bowl and finish at the bottom of 7th Heaven"];

  let token = 0;
  async function open(q, o) {
    const sp = sportOf(), my = ++token;
    if (o) planAsk = !!o.plan && sp === "ski";
    dlg.querySelector(".ask-top").innerHTML = boxHtml(sp, "ask-in-dlg");
    const inp = dlg.querySelector(".ask-in");
    inp.value = q || "";
    if (!dlg.open) { try { dlg.showModal(); } catch { dlg.setAttribute("open", ""); } dlg.focus(); }
    const head = dlg.querySelector(".ask-head"), out = dlg.querySelector(".ask-out");
    if (!q) {
      head.innerHTML = "";
      out.innerHTML = planAsk ? `<p class="ask-note">Type your plan of the day: where you start, the lines you want to ski or climb, and where you finish. For example:</p><div class="ask-ex">${PLAN_EX.map((x) => `<button type="button">${esc(x)}</button>`).join("")}</div>`
        : `<p class="ask-note">Type what you're after, the way you'd ask a friend. For example:</p><div class="ask-ex">${SP[sp].ex.map((x) => `<button type="button">${esc(x)}</button>`).join("")}</div>`;
      out.querySelectorAll(".ask-ex button").forEach((b) => b.addEventListener("click", () => open(b.textContent)));
      setTimeout(() => inp.focus(), 50);
      return;
    }
    head.innerHTML = `<p class="ask-wait">Reading your question…</p>`;
    out.innerHTML = "";
    const ai = await aiParse(q, sp);
    if (my !== token) return;
    const p = ai.ok ? fromAi(ai, q, sp) : localParse(q, sp);
    if (planAsk) p.plan = true;
    head.innerHTML = `<p class="ask-said">${esc(p.summary || summaryOf(p, sp))}</p><ul class="ask-chips">${chipsOf(p, sp).map((c) => `<li>${esc(c)}</li>`).join("")}</ul>
      ${ai.ok ? "" : `<p class="ask-note">${esc(ai.why)} Read here more simply: ask again later for a smarter read.</p>`}`;
    out.innerHTML = `<p class="ask-wait">Finding the place…</p>`;
    // A ski plan's own pieces ("finish in Lakeside Bowl") aren't the place to look around: they're found near the map.
    if (sp === "ski" && (planAsk || planLike(q)) && p.place && planSteps(q).some((x) => norm(x.name) === norm(p.place) || norm(p.place).includes(norm(x.name)))) p.place = "";
    const was = p.place;
    let at = await whereOf(p);
    if (my !== token) return;
    // A backcountry area read from the words ("in the duffys", "Duffy Lake"): the heading says where it looked.
    if (at && at.name && (at.region || p.place !== was)) {
      p.place = at.name; p.summary = "";
      head.innerHTML = `<p class="ask-said">${esc(summaryOf(p, sp))}</p><ul class="ask-chips">${chipsOf(p, sp).map((c) => `<li>${esc(c)}</li>`).join("")}</ul>${ai.ok ? "" : `<p class="ask-note">${esc(ai.why)} Read here more simply: ask again later for a smarter read.</p>`}`;
    }
    // A ski tour typed as a plan names its own pieces: when the place isn't found, they're looked for around the map.
    if (!at && sp === "ski" && (planAsk || planLike(q))) { const m = map.getCenter(); at = { c: [m.lat, m.lng], mid: true }; }
    if (!at) { logUse("search", "Ask:" + q, 0); out.innerHTML = `<p class="ask-note ask-warn">Couldn't find “${esc(p.place)}” on the map. Try the town's name, or move the map there and ask “near here”.</p>`; return; }
    out.innerHTML = `<p class="ask-wait">Looking ${at.you ? "around you" : at.mid ? "around the middle of the map" : "near " + esc(at.name)}…</p>`;
    try { await ANSWER[sp](p, at, out, () => my !== token); if (my === token) logUse("search", "Ask:" + q, out.querySelectorAll("button").length); }
    catch (e) { if (my === token) { logUse("search", "Ask:" + q, 0); out.innerHTML = `<p class="ask-note ask-warn">Something went wrong (${esc(e.message || e)}). Try again.</p>`; } }
  }

  // ---------- reading the question ----------
  // The AI, in the photo function (supabase/functions/which-trail, mode "ask"). Its answer, or why not.
  let aiOff = "";
  async function aiParse(q, sport) {
    if (aiOff) return { ok: false, why: aiOff };
    // Google's AI only after a yes (welcome.js tfAiConsent); without it the words are read on the phone.
    if (window.tfAiConsent && !(await window.tfAiConsent.ask("ask"))) return { ok: false, why: "Google's AI is off (your choice), so your words were read on the phone." };
    const acct = window.tfAccount;
    try {
      if (!acct || !acct.enabled) return { ok: false, why: "The AI isn't available here." };
      await acct.load();
      if (!acct.client) return { ok: false, why: "The AI isn't available here." };
      const { data, error } = await acct.client.functions.invoke(AI_FN, { timeout: 25000, body: { mode: "ask", q, sport, today: localDay() } });
      if (error) {
        const st = error.context && error.context.status;
        let msg = "";
        try { msg = (await error.context.json()).error || ""; } catch {}
        // An older copy of the function takes every question for a picture: "no picture".
        if (st === 400 && /picture/i.test(msg)) { aiOff = "The AI needs a small update first."; return { ok: false, why: aiOff }; }
        if (st === 429) return { ok: false, why: msg ? msg[0].toUpperCase() + msg.slice(1) + "." : "The AI's questions for today are used up." };
        return { ok: false, why: "The AI didn't answer." };
      }
      return data && data.ok ? data : { ok: false, why: "The AI didn't answer." };
    } catch { return { ok: false, why: "The AI didn't answer (no signal?)." }; }
  }
  const blank = (sp) => ({ what: "", place: "", ll: null, near_me: false, date: localDay(), hours: 0, km: 0, km_away: 0, levels: [], loam: false, new_only: false, not_ridden: false, species: "", words: [], summary: "", sport: sp });
  const WHAT = { mtb: ["loop", "trails", "areas"], ski: ["tours", "huts", "avalanche"], hunt: ["spot"], fish: ["waters", "spot"], moto: ["routes", "spot"] };
  function fromAi(a, q, sp) {
    const p = { ...blank(sp), ...a, sport: sp, q };
    if (!WHAT[sp].includes(p.what)) p.what = localParse(q, sp).what;
    // The place read here when the AI didn't name one (it sometimes keeps it for the summary only).
    if (!p.place && !p.near_me) { const l = localParse(q, sp); p.place = l.place; }
    if (p.date < localDay()) p.date = localDay();
    return p;
  }
  const DAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
  const SPECIES = /\b(elk|moose|deer|mule deer|white-?tailed deer|whitetail|black bear|bear|cougar|wolf|coyote|bighorn|sheep|mountain goat|goat|caribou|grouse|ptarmigan|duck|goose|turkey|pheasant|rabbit|hare|rainbow trout|cutthroat|bull trout|brook trout|lake trout|brown trout|trout|kokanee|char|salmon|chinook|coho|steelhead|walleye|pike|bass|perch|whitefish|sturgeon|halibut|lingcod|rockfish|crab|prawn)s?\b/;
  // A simpler read of the words, here: used when the AI isn't there.
  function localParse(q, sp) {
    const p = blank(sp), s = q.toLowerCase().replace(/[’']/g, "'");
    p.q = q;
    // The day
    const today = localDay(), wd = new Date().getDay();
    let m;
    if (/\btomorrow\b/.test(s)) p.date = addDays(today, 1);
    else if ((m = s.match(/\bin (\d) days?\b/))) p.date = addDays(today, +m[1]);
    else if (/\b(this )?weekend\b/.test(s)) p.date = addDays(today, (6 - wd + 7) % 7);
    else { const i = DAYS.findIndex((d) => new RegExp(`\\b${d}\\b`).test(s)); if (i >= 0) p.date = addDays(today, (i - wd + 7) % 7); }
    // How long
    if ((m = s.match(/(\d+(?:[.,]\d+)?)\s*(?:-|\s)?\s*(?:h|hr|hrs|hour|hours)\b/))) p.hours = +m[1].replace(",", ".");
    else if ((m = s.match(/(\d+)\s*(?:-|\s)?\s*(?:min|mins|minutes)\b/))) p.hours = Math.round((+m[1] / 60) * 4) / 4;
    else if (/\bhalf[- ]day\b/.test(s)) p.hours = 4;
    else if (/\b(an|one) hour\b/.test(s)) p.hours = 1;
    else if (/\bfull[- ]day\b|\ball[- ]day\b/.test(s)) p.hours = 6;
    if ((m = s.match(/\b(within|less than \d+ ?km from|up to)\s*(\d+)\s*km\b/))) p.km_away = +m[2];
    else if ((m = s.match(/(\d+(?:[.,]\d+)?)\s*(?:-|\s)?\s*(?:km|kms|kilomet\w*)\b/))) p.km = +m[1].replace(",", ".");
    // Levels
    const lv = new Set();
    if (/\bdouble[- ]black\b|\bexpert\b|\bpro line\b|\bgnar/.test(s)) lv.add("dbl");
    if (/\bblack\b/.test(s.replace(/double[- ]black/g, "")) || /\bhard\b|\btechnical\b|\btech\b|\badvanced\b|\bchallenging\b|\bcomplex\b/.test(s)) lv.add("black");
    if (/\bblue\b|\bintermediate\b|\bmoderate\b|\bmedium\b/.test(s)) lv.add("blue");
    if (/\bgreen\b|\beasy\b|\bbeginner\b|\bsimple\b|\bmellow\b|\bchill\b/.test(s)) lv.add("green");
    p.levels = [...lv];
    p.loam = /\bloam|\btacky\b|\bhero dirt\b|\bprime\b|\bperfect dirt\b|\bgood dirt\b|\bconditions\b/.test(s);
    p.new_only = /\bnew\b(?! to me)|\brecent(ly)?\b/.test(s) && !/\bnew to me\b/.test(s);
    p.not_ridden = /\b(havent|haven't|have not|never|not yet) (ridden|ride|done|been)\b|\bnew to me\b|\bunridden\b/.test(s);
    if ((m = s.match(SPECIES))) p.species = m[1];
    // What
    if (sp === "mtb") p.what = /\bloop\b|\bride of\b|\bhour\b|\bhours\b|\d\s*h\b|\bkm\b|\bmin/.test(s) ? "loop" : /\bwhere (to|should|can|do) (i |we )?ride\b|\bwhich area|\bareas?\b|\bride today\b/.test(s) ? "areas" : "trails";
    else if (sp === "ski") p.what = /\bhut|\bcabin/.test(s) ? "huts" : /\bavalanche|\bavy\b|\bdanger\b/.test(s) ? "avalanche" : "tours";
    else if (sp === "hunt") p.what = "spot";
    else if (sp === "fish") p.what = /\brule|\bregulation|\blimit\b|\bseason\b|\bopen\b|\bclosed?\b|\blicen/.test(s) ? "spot" : "waters";
    else p.what = /\bgas\b|\bfuel\b|\bcamp|\bride here\b|\bhot spring/.test(s) ? "spot" : "routes";
    p.words = ["views", "flowy", "jumps", "lake", "quiet", "dirt", "paved", "gravel", "nordic", "snowshoe", "snowmobile", "classic", "skate"].filter((w) => s.includes(w));
    // The place: after near, around, close to, at, by or in (in only before a capital: "in prime loam" isn't a place).
    p.near_me = /\b(near|around|close to) (me|here|us)\b|\bnearby\b|\bclose by\b/.test(s);
    if (!p.near_me) {
      const STOP = "today|tomorrow|tonight|this|next|on|with|for|in|under|over|within|that|which|i|we|and|or|the weekend|weekend|monday|tuesday|wednesday|thursday|friday|saturday|sunday|loop|trails?|please";
      const W = "(?!(?:I|Today|Tomorrow|Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)\\b)[A-ZÀ-Ý][\\w'’.-]*";
      const cap = q.match(new RegExp(`\\b(?:near|around|close to|at|by|in|from|to)\\s+(${W}(?:\\s+(?:${W}|de|du|des|la|le|of))*)`));
      const low = s.match(new RegExp(`\\b(?:near|around|close to)\\s+([a-zà-ÿ][a-zà-ÿ'.-]*(?:\\s+(?!(?:${STOP})\\b)[a-zà-ÿ][a-zà-ÿ'.-]*){0,3})`));
      p.place = ((cap && cap[1]) || (low && low[1]) || "").replace(/\s+(?:de|du|des|la|le|of)$/i, "").trim();
    }
    return p;
  }
  const LV = { green: ["●", "#2f9e44", "Green"], blue: ["■", "#1c6fe0", "Blue"], black: ["◆", "#1b1b1b", "Black"], dbl: ["◆◆", "#d6202a", "Double black"], pro: ["▲", "#e8590c", "Pro line"] };
  const hrs = (h) => (h % 1 ? `${Math.floor(h)} h ${Math.round((h % 1) * 60)}` : `${h} h`);
  function chipsOf(p, sp) {
    const out = [];
    out.push(p.near_me || !p.place ? "📍 Near you" : `📍 ${p.place}`);
    if (p.date !== localDay() || p.loam) out.push(`📅 ${dayName(p.date)[0].toUpperCase() + dayName(p.date).slice(1)}`);
    if (p.hours) out.push(`⏱ ${hrs(p.hours)}`);
    if (p.km) out.push(`↔ ${p.km} km`);
    if (p.km_away) out.push(`within ${p.km_away} km`);
    if (sp === "mtb" || sp === "ski") p.levels.forEach((l) => out.push(sp === "ski" ? ["Simple", "Challenging", "Complex", "Complex"][["green", "blue", "black", "dbl"].indexOf(l)] : LV[l][2]));
    if (p.loam && sp === "mtb") out.push("🤎 Prime loam");
    if (p.new_only) out.push("✨ New");
    if (p.not_ridden && sp === "mtb") out.push("Not ridden yet");
    if (p.species) out.push(p.species[0].toUpperCase() + p.species.slice(1));
    return out;
  }
  function summaryOf(p, sp) {
    const what = { loop: "Loops", trails: "Trails", areas: "Where to ride", tours: "Tours", huts: "Huts", avalanche: "The avalanche forecast", spot: sp === "hunt" ? "What you can hunt" : sp === "fish" ? "Fishing rules and conditions" : "What's there", waters: "Waters to fish", routes: "ADV routes" }[p.what] || "What there is";
    return `${what} ${p.near_me || !p.place ? "near you" : "near " + p.place}`;
  }

  // ---------- the place ----------
  let areasP = null;
  const ridingAreas = () => areasP || (areasP = fetch("data/riding-areas.json").then((r) => r.json()).then((f) => (f.areas || []).filter((a) => Array.isArray(a.c))).catch(() => { areasP = null; return []; }));
  function youOr() {
    const T = window.tfToday, ll = T && T.you();
    if (ll) return Promise.resolve({ c: [ll.lat, ll.lng], you: true });
    const mid = () => { const m = map.getCenter(); return { c: [m.lat, m.lng], mid: true }; };
    if (!navigator.geolocation) return Promise.resolve(mid());
    return new Promise((ok) => navigator.geolocation.getCurrentPosition((x) => ok({ c: [x.coords.latitude, x.coords.longitude], you: true }), () => ok(mid()), { timeout: 8000, maximumAge: 600000 }));
  }
  // Skiing: the backcountry areas (data/ski-areas.json, "Backcountry areas across Canada") by their name or their
  // region, spelling slips and all (alex 2026-11-06: "Plan a backcountry day in the duffys" went to a Duffy Lake near
  // Kamloops, the place search's only Canadian "Duffy Lake", and found no tours). A region is the middle of its areas,
  // with a radius that takes them all in.
  let skiAreasP = null;
  const skiAreas = () => skiAreasP || (skiAreasP = fetch("data/ski-areas.json").then((r) => r.json()).then((d) => (d.areas || []).filter((a) => a.lat != null)).catch(() => { skiAreasP = null; return []; }));
  const FILL = new Set(["the", "a", "lake", "lakes", "road", "rd", "hwy", "highway", "area", "areas", "backcountry", "zone", "zones", "peak", "peaks", "mount", "mt", "mountain", "mountains", "range", "ski", "skiing", "touring", "tour", "tours", "bc", "of", "and", "in", "near", "around", "park", "region", "day"]);
  const stem = (w) => (w.length > 4 && /s$/.test(w) && !/ss$/.test(w) ? w.slice(0, -1) : w);
  const slip = (a, b) => {   // one letter added, left out or changed, on words of 5 letters or more
    if (a === b) return true;
    if (Math.min(a.length, b.length) < 5 || Math.abs(a.length - b.length) > 1) return false;
    let i = 0, j = 0, e = 0;
    while (i < a.length && j < b.length) {
      if (a[i] === b[j]) { i++; j++; continue; }
      if (++e > 1) return false;
      if (a.length > b.length) i++; else if (b.length > a.length) j++; else { i++; j++; }
    }
    return e + (a.length - i) + (b.length - j) <= 1;
  };
  const wordsOf = (s) => norm(s).split(" ").filter(Boolean).map(stem);
  const namedBy = (want, name) => { const have = wordsOf(name); return want.every((w) => have.some((h) => slip(w, h))); };
  async function skiAreaOf(place) {
    const want = wordsOf(place).filter((w) => !FILL.has(w) && w.length >= 3);
    if (!want.length) return null;
    const areas = await skiAreas();
    // The region first ("the duffys": all four Duffey areas), then one area ("Joffre", "Marriott Basin").
    const reg = areas.filter((a) => a.region && (namedBy(want, a.region) || (a.sub && namedBy(want, a.sub))));
    const regName = reg.length && reg[0].region;
    const inReg = reg.filter((a) => a.region === regName);
    // A region of one area is often a town too (Pemberton, Kamloops): the town, by the place search, not that one area.
    if (inReg.length > 1) {
      const c = [inReg.reduce((s, a) => s + a.lat, 0) / inReg.length, inReg.reduce((s, a) => s + a.lon, 0) / inReg.length];
      const R = Math.max(25, Math.ceil(Math.max(...inReg.map((a) => kmTo(c, [a.lat, a.lon]))) + 15));
      return { c, name: regName, R, region: true };
    }
    const a = areas.find((x) => namedBy(want, x.name) || namedBy(want, x.id.replace(/-/g, " ")));
    return a ? { c: [a.lat, a.lon], name: a.name } : null;
  }
  // "in the duffys", "in the Chic-Chocs": the words after "in the" at the end of a ski question, tried only against
  // the backcountry areas (never the place search: "in the trees", "in the alpine").
  const inThe = (q) => { const m = norm(q).match(/\b(?:in|at|to|around) the ([a-z][a-z ]{2,30})$/); return m ? m[1] : ""; };

  // The place named: a riding area or zone by its name, else the place search (OpenStreetMap), else the AI's own spot.
  async function whereOf(p) {
    if (p.sport === "ski" && !p.near_me && !p.place && inThe(p.q)) { const a = await skiAreaOf(inThe(p.q)); if (a) { p.place = a.name; return a; } }
    if (p.near_me || !p.place) return youOr();
    const n = norm(p.place);
    if (p.sport === "mtb") {
      const a = (await ridingAreas()).find((x) => norm(x.name) === n);
      if (a) return { c: a.c, name: a.name, area: a };
    }
    // Skiing: a resort by its name ("Blackcomb", "Blackcomb Mountain", "Blackcomb slackcountry") before the place
    // search, which once answered a mountain bike jump park for Blackcomb Mountain.
    if (p.sport === "ski") {
      const SKIW = new Set(["mount", "mt", "mountain", "resort", "ski", "area", "hill", "slack", "country", "slackcountry", "backcountry", "side", "the", "de", "du", "station", "mont"]);
      const w = n.split(" ").filter((x) => x && !SKIW.has(x));
      const rs = w.length ? await fetch("data/ski-lifts.json?v=4090").then((r) => r.json()).then((d) => Object.values(d.resorts || {})).catch(() => []) : [];
      const hit = rs.find((r) => r.name && w.every((x) => norm(r.name).split(" ").includes(x)));
      if (hit) return { c: [hit.lat, hit.lon], name: hit.name };
      const a = await skiAreaOf(p.place);
      if (a) return a;
    }
    const ps = window.tfPlaceSearch;
    if (ps) {
      const hits = await Promise.race([ps.search(p.place).catch(() => null), new Promise((r) => setTimeout(() => r(null), 8000))]);
      // A ski question never lands on a bike park, a skate park or a pump track.
      const ok = (x) => p.sport !== "ski" || !/\bbike|\bjump park|\bskate|\bpump track|\bbmx\b/i.test(x.name + " " + (x.sub || ""));
      const h = hits && (hits.find((x) => x.ca && ok(x)) || (!p.ll && hits.find(ok)));
      if (h) return { c: [h.lat, h.lon], name: h.name, bb: h.bb };
    }
    if (p.ll) return { c: p.ll, name: p.place };
    return null;
  }

  // ---------- the answers ----------
  const lvGlyph = (k) => (LV[k] ? `<span class="ask-lv" style="color:${LV[k][1]}" title="${LV[k][2]}">${LV[k][0]}</span>` : "");
  const LOAM = [[20, "Dry", "#d9a35a"], [40, "Tacky", "#5aa86a"], [60, "Prime", "#3f8f8c"], [80, "Wet", "#3b6fb0"], [101, "Saturated", "#33468f"]];
  const loamLv = (v) => LOAM.find((l) => v < l[0]);
  const loamDot = (v) => `<i class="ask-dot" style="background:${v == null ? "#8a8f98" : loamLv(v)[2]}"></i>`;
  const isPrime = (v) => v != null && v >= 40 && v < 60;
  const listHtml = (rows) => `<ol class="ask-list">${rows.map((r, i) => `<li><button type="button" data-i="${i}"><b>${r.title}</b><small>${r.sub}</small></button></li>`).join("")}</ol>`;
  const wire = (el, rows) => el.querySelectorAll("ol.ask-list button[data-i]").forEach((b) => b.addEventListener("click", () => { close(); rows[+b.dataset.i].go(); }));
  const nearName = (at) => (at.you ? "you" : at.mid ? "the middle of the map" : at.name);

  // ---------- Skiing: a tour typed as the plan of the day ----------
  // alex 2026-11-05: "i want to plan a tour in blackcomb slack country and ride doa starting from the top of showcase
  // and finish in lakeside bowl", then "could be nice to type your plan of the day and it creates the route for you".
  // The words are cut into steps (start, the lines skied or climbed in order, the finish), each named piece is found
  // near the place among the lifts (data/ski-lifts.json), the slackcountry lines (data/slackcountry.json) and every
  // named ski route (tours, resort runs, off-piste bowls: winter.js), and the pieces become a Plan a tour: the lines as
  // drawn, the 🛡 Safest way between them for today's forecast.
  const PLAN_LIKE = /\bplan\b|\bstart|\bstrat|\bbegin|\bfinish|\bend(?:ing)? (?:in|at|up|on)\b|\bthen\b|\bvia\b|\bfrom the (?:top|bottom)\b|\btop of\b|\bdrop (?:in|into)\b|\b(?:the|far) end of\b/i;
  const planLike = (q) => PLAN_LIKE.test(q || "");
  const K_START = "start(?:ing)?|strat(?:ing)?|begin(?:ning)?|from|leav(?:e|ing)";
  const K_END = "finish(?:ing)?|end(?:ing)?(?: up)?|come out|coming out|exit(?:ing)?|get(?:ting)? out|back (?:to|in|at)";
  const K_UP = "skin(?:ning)?(?: up)?|climb(?:ing)?|bootpack(?:ing)?|hike|hiking|walk(?:ing)? up|go(?:ing)? up|ride (?:up )?the lift|take the lift";
  const K_VIA = `${K_UP}|ride|riding|ski|skiing|board|boarding|do|doing|take|taking|drop(?:ping)?(?: in(?:to)?)?|via|through`;
  function planSteps(q, loose) {
    let s = " " + q.toLowerCase().replace(/[’']/g, "'").replace(/[.,;!?]+/g, " , ") + " ";
    // When is for the forecast, not a place (alex 2026-11-08: "I want to go skiing at the end of Brandywine Meadow
    // tomorrow" made "the" a place to find and the meadows a one-point tour).
    s = s.replace(/\s(?:today|tomorrow|tonight|this (?:morning|afternoon|weekend)|(?:on |next |this )?(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday)|the day after tomorrow)(?=\s)/g, " ");
    // "(go to / ski at) the end of Brandywine Meadows": the far end of it is where you finish; "the start of" where you start.
    s = s.replace(/\s(?:(?:at|to|until|till|up to)\s+)?the (?:far )?end of\s/g, " finish at far-end ").replace(/\s(?:(?:at|from)\s+)?the (?:start|beginning) of\s/g, " start at ");
    // A cut before each step word, and at "and" / commas.
    s = s.replace(new RegExp(`\\s(${K_START}|${K_END}|${K_VIA})(?=\\s)`, "g"), " | $1").replace(/\s(?:and then|and|then|after that|,)(?=\s)/g, " | ");
    const out = [];
    for (let c of s.split("|").map((x) => x.trim()).filter(Boolean)) {
      let m, kind = null, up = false;
      if ((m = c.match(new RegExp(`^(?:${K_START})\\b`)))) kind = "start";
      else if ((m = c.match(new RegExp(`^(?:${K_END})\\b`)))) kind = "end";
      else if ((m = c.match(new RegExp(`^(?:${K_VIA})\\b`)))) { kind = "via"; up = new RegExp(`^(?:${K_UP})\\b`).test(c); }
      if (!kind && loose && c.length > 2 && !/^(?:i|i'd|i'm|we|plan|planning|let's|make|a|an|my|tour|touring|go|want)\b/.test(c)) { kind = "via"; m = [""]; }   // from Plan a tour: a bare name ("DOA and Lakeside Bowl") is a line to ski
      if (!kind) continue;
      let n = c.slice(m[0].length).trim(), pos = "";
      for (let k = 0; k < 4; k++) n = n.replace(/^(?:from|at|on|in|into|to|by|of|off|up|down|the|a|an|with|out)\s+/, "");
      if ((m = n.match(/^far-end\s+(?:the\s+)?/))) { pos = "far"; n = n.slice(m[0].length); }
      else if ((m = n.match(/^(top|bottom|base|summit|end|start)\s+(?:of\s+)?(?:the\s+)?/))) { pos = /top|summit|start/.test(m[1]) ? "top" : "bottom"; n = n.slice(m[0].length); }
      n = n.replace(/\s+(?:today|tomorrow|please|and|then|run|line|in the (?:morning|afternoon))$/g, "").trim();
      if (!n || /^(?:a |my |our )?(?:tour|ski tour|day|lap|it|there|here|plan)$/.test(n) || n.length < 2) continue;
      // Only small words left ("skiing at the"): no name there.
      if (n.split(/\s+/).every((w) => /^(?:the|a|an|at|to|in|on|of|it|there|here|some|go|going|ski|skiing|tour|touring|want|i|we|me|us|for|day|and)$/.test(w))) continue;
      if (/^the (?:car|parking|lot)|^(?:parking|car|the road)$/.test(n)) continue;
      // "the bottom of Poop Chutes on Glacier Road": the name, then where it is (a hint, also used when the name isn't found).
      let hint = "";
      if ((m = n.match(/^(.+?)\s+(?:on|onto|at|by|near|above|below|beside|next to|along)\s+(?:the\s+)?(.{2,})$/))) { n = m[1].trim(); hint = m[2].trim(); }
      out.push({ kind, name: n, hint, pos, up, lift: /\b(?:chair|chairlift|lift|gondola|t ?-?bar|express|quad)\b/.test(n) });
    }
    return out;
  }
  let liftsP = null, slackP = null;
  const liftsList = () => liftsP || (liftsP = fetch("data/ski-lifts.json?v=4090").then((r) => r.json()).then((d) => d.lifts || []).catch(() => { liftsP = null; return []; }));
  const slackList = () => slackP || (slackP = fetch("data/slackcountry.json").then((r) => r.json()).then((d) => (d.resorts || []).flatMap((rs) => (rs.lines || []).map((l) => ({ ...l, resort: rs.name })))).catch(() => { slackP = null; return []; }));
  const pairs = (flat) => { const o = []; for (let i = 0; i + 1 < flat.length; i += 2) o.push([flat[i], flat[i + 1]]); return o; };
  // How well a name typed matches a name on the map: 3 the same, 2.5 the same before its brackets or its short name,
  // 2 every word there (a word of 4+ letters may be one letter off), 0 not it.
  // A word typed close enough to a word on the map: a letter or two off by length (alex 2026-11-05: "7th even" is the
  // 7th Heaven chair), also said the way it sounds (a silent h dropped: "even" / "heaven").
  const lev = (a, b) => {
    const d = Array.from({ length: b.length + 1 }, (_, j) => j);
    for (let i = 1; i <= a.length; i++) {
      let prev = d[0]; d[0] = i;
      for (let j = 1; j <= b.length; j++) { const t = d[j]; d[j] = Math.min(d[j] + 1, d[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1)); prev = t; }
    }
    return d[b.length];
  };
  const close1 = (a, b) => {
    if (a === b) return true;
    if (/^\d/.test(a) || /^\d/.test(b)) return a.replace(/(st|nd|rd|th)$/, "") === b.replace(/(st|nd|rd|th)$/, "");   // 7th = 7
    const n = Math.max(a.length, b.length), max = n >= 7 ? 2 : n >= 4 ? 1 : 0;
    if (!max) return false;
    const sound = (w) => w.replace(/^h/, "").replace(/ph/g, "f").replace(/(.)\1/g, "$1");
    return lev(a, b) <= max || lev(sound(a), sound(b)) <= 1;
  };
  const GENERIC = new Set(["the", "lift", "chair", "run", "line", "trail", "route", "mount", "mt", "mountain", "bowl", "express", "t", "bar"]);
  function nameScore(typed, ...names) {
    const t = norm(typed);
    let best = 0;
    for (const nm of names) {
      if (!nm) continue;
      const n = norm(nm), lead = norm(String(nm).split("(")[0]);
      if (n === t) return 3;
      if (lead === t) best = Math.max(best, 2.5);
      const tw = t.split(" ").filter((w) => !GENERIC.has(w)), nw = n.split(" ");
      if (!tw.length) continue;
      // DOA = Down, Over and Around: the initials count too.
      if (tw.length === 1 && tw[0].length >= 2 && tw[0].length <= 5 && nw.filter((w) => !["and", "of", "the"].includes(w)).map((w) => w[0]).join("") === tw[0]) best = Math.max(best, 2.2);
      // Every word typed is there: 2, less a little for each other word in the name (min 1.8) and each word only close.
      if (tw.every((w) => nw.some((x) => close1(w, x)))) best = Math.max(best, Math.max(1.8, 2 - (nw.length - tw.length) * 0.02) - tw.filter((w) => !nw.includes(w)).length * 0.1);
    }
    return best;
  }
  async function planPieces(steps, c) {
    const S = window.tfSki.trip;
    const [lifts, slack, routes] = await Promise.all([liftsList(), slackList(), S.namedNear(c, 30).catch(() => [])]);
    const R = 30;
    const cands = [
      ...lifts.filter((l) => l.g && l.g.length > 1 && kmTo(l.g[0], c) < R).map((l) => ({ kind: "lift", name: l.n, alt: l.st, lines: [l.g], what: "lift" })),
      ...slack.filter((l) => l.g && l.g.ski && kmTo([l.g.ski[0], l.g.ski[1]], c) < R).map((l) => ({ kind: "slack", name: l.name, alt: l.short, lines: [pairs(l.g.ski)], what: "slackcountry line", diff: l.diff })),
      ...routes.map((r) => ({ kind: r.area ? "area" : r.type === "resort" ? "run" : "route", name: r.name, alt: r.aka, lines: r.lines.map((ln) => ln.map((p) => [p[0], p[1]])), what: r.area ? "bowl" : r.type === "resort" ? "run" : r.type === "offpiste" ? "off-piste" : "ski route", diff: r.diff, rid: r.id })),
    ];
    // What each kind of step looks for first: a start or finish at the top/bottom of something is most often a lift;
    // a line skied is a slackcountry line or a route; a finish "in" something is most often a bowl or a run.
    const PREF = { start: { lift: 0.3, run: 0.1, area: 0.1 }, via: { slack: 0.4, route: 0.25, run: 0.2, area: 0.15 }, end: { area: 0.3, run: 0.2, lift: 0.05 } };
    // How far a piece is from a point (km), from a few of its points.
    const away = (x, ref) => { let m = Infinity; for (const ln of x.lines) { const k = Math.max(1, Math.ceil(ln.length / 12)); for (let i = 0; i < ln.length; i += k) m = Math.min(m, kmTo(ln[i], ref)); m = Math.min(m, kmTo(ln[ln.length - 1], ref)); } return m; };
    // The best piece for a name: how well it's named, what the step looks for, then how near (to the place, then to the
    // tour's other pieces and the "on Glacier Road" hint: 0.1 a km, so the Glacier Road by the Poop Chutes, not 3 km on).
    const pick = (name, st, refs) => {
      let best = null;
      for (const x of cands) {
        const sc = nameScore(name, x.name, x.alt);
        if (sc < 1.5) continue;
        const d = refs.length ? Math.min(...refs.map((r) => away(x, r))) / 10 : away(x, c) / 200;
        const v = sc + (PREF[st.kind][x.kind] || 0) + (st.pos && x.kind === "lift" ? 0.2 : 0) + (st.lift && x.kind === "lift" ? 1 : 0) - d;
        if (!best || v > best.v) best = { v, x };
      }
      return best && best.x;
    };
    const mid = (x) => { const ln = x.lines[0]; return ln[Math.floor(ln.length / 2)]; };
    // First each step on its own (its name, else its "on ..." hint), then again near the others it goes with.
    let hits = steps.map((st) => pick(st.name, st, []) || null);
    const hintHit = steps.map((st) => (st.hint ? pick(st.hint, st, []) : null));
    hits = steps.map((st, i) => {
      if (!hits[i]) return hintHit[i] ? { x: hintHit[i], byHint: true } : null;
      const refs = [...(hintHit[i] ? hintHit[i].lines.flat() : []), ...hits.filter((h, j) => h && j !== i).map(mid)];
      return { x: (refs.length && pick(st.name, st, refs)) || hits[i] };
    });
    return steps.map((st, i) => {
      const h = hits[i];
      if (!h) return { ...st, miss: true };
      // Same-name pieces close by (a run mapped in parts): all of them, for its top and bottom.
      const near = h.x.lines.flat();
      const same = cands.filter((y) => y === h.x || (y.kind === h.x.kind && y.name === h.x.name && near.some((p) => away(y, p) < 0.3)));
      return { ...st, hit: h.x, lines: same.flatMap((y) => y.lines) };
    });
  }
  // The highest and lowest of a piece's points (heights from the terrain tiles, at most ~14 asked).
  async function hiLo(lines) {
    const all = lines.flat(), k = Math.max(1, Math.ceil(all.length / 14));
    const pts = all.filter((_, i) => i % k === 0 || i === all.length - 1);
    const e = await Promise.all(pts.map((p) => window.tfSki.trip.heightAt(p[0], p[1]).catch(() => null)));
    let hi = null, lo = null;
    pts.forEach((p, i) => { if (e[i] == null) return; if (!hi || e[i] > hi.e) hi = { p, e: e[i] }; if (!lo || e[i] < lo.e) lo = { p, e: e[i] }; });
    return { hi: hi || { p: pts[0] }, lo: lo || { p: pts[pts.length - 1] } };
  }
  // The longest piece of a line, as one list of points from start to end.
  const mainLine = (lines) => lines.slice().sort((a, b) => b.length - a.length)[0];
  // The snow line on a day (yyyy-mm-dd) at a place, in m: about 300 m under the freezing level when it snowed (like
  // Hiking's Snow line), the lowest of the last week up to that day, as snow that fell stays. null: no snow fell.
  async function snowLine(c, date) {
    const q = new URLSearchParams({ latitude: c[0].toFixed(3), longitude: c[1].toFixed(3), hourly: "freezing_level_height,snowfall", past_days: "7", forecast_days: "7", timezone: "auto" });
    const j = await fetch("https://api.open-meteo.com/v1/forecast?" + q).then((r) => (r.ok ? r.json() : null));
    const h = j && j.hourly;
    if (!h || !h.time) return null;
    const to = date || localDay(), from = addDays(to, -7);
    let lo = null;
    h.time.forEach((t, i) => {
      const d = t.slice(0, 10), fz = h.freezing_level_height[i];
      if (d < from || d > to || fz == null || !(h.snowfall[i] > 0.1)) return;
      if (lo == null || fz - 300 < lo) lo = fz - 300;
    });
    return lo == null ? null : Math.max(0, Math.round(lo / 50) * 50);
  }
  // Where the car stops on the way to a trailhead: on the drivable roads near it (index.html's forest roads), the point
  // nearest the trailhead that's under the snow line. { p, name, what } or null when no roads are loaded there.
  async function carStart(th, date) {
    const nav = window.tfNav;
    if (!nav || !nav.roadsAlong) return null;
    const [zs, line] = await Promise.all([nav.roadsAlong([L.latLng(th[0], th[1]).toBounds(16000)]), snowLine(th, date).catch(() => null)]);
    const pts = [];
    for (const z of zs) for (const r of z.list || []) {
      if (/^(closed|impass)$/.test(r.st || "") || !r.geom || r.geom.length < 2) continue;
      if (!r.geom.some((p) => kmTo(p, th) < 6)) continue;
      for (let i = 1; i < r.geom.length; i++) {   // every ~100 m along it
        const a = r.geom[i - 1], b = r.geom[i], k = Math.max(1, Math.ceil(kmTo(a, b) / 0.1));
        for (let j = 0; j < k; j++) { const p = [a[0] + ((b[0] - a[0]) * j) / k, a[1] + ((b[1] - a[1]) * j) / k]; if (kmTo(p, th) < 6) pts.push({ p, r }); }
      }
    }
    if (!pts.length) return null;
    pts.sort((x, y) => kmTo(x.p, th) - kmTo(y.p, th));
    const near = pts.slice(0, 400);
    if (kmTo(near[0].p, th) > 3) return null;   // no road reaches it
    const es = line == null ? [] : await Promise.all(near.map((x) => window.tfSki.trip.heightAt(x.p[0], x.p[1]).catch(() => null)));
    const ok = line == null ? near[0] : near.find((x, i) => es[i] != null && es[i] <= line);
    const pick = ok || near[near.length - 1];
    // A government road code ("R08938 251") isn't a name people know: a named road near it, else "the forest road".
    const named = (r) => r && r.name && !/^[A-Z]{0,2}\d[\w-]*(?:\s+\d+)?$/.test(r.name.trim()) ? r.name : "";
    const nm = named(pick.r) || named((pts.find((x) => named(x.r) && kmTo(x.p, pick.p) < 0.3) || {}).r) || "the forest road";
    const at = line == null ? "" : ok === near[0] ? ` (under the snow line, about ${line.toLocaleString("en-CA")} m)` : ` at the snow line, about ${line.toLocaleString("en-CA")} m`;
    return { p: [+pick.p[0].toFixed(6), +pick.p[1].toFixed(6)], name: nm, what: line == null ? "where the road comes closest (no snow on the roads in the forecast)" : `where you leave the car${at}: drag it if the road is open higher` };
  }
  async function planPts(pieces, date) {
    const pts = [], used = [];
    const near = (a, b, m) => map.distance([a[0], a[1]], [b[0], b[1]]) < m;
    const addPt = (p) => { const l = pts[pts.length - 1]; if (!l || !near(l, p, 60)) pts.push([p[0], p[1]]); };
    const addLine = (line, name) => {
      const l = pts[pts.length - 1];
      if (!l || !near(l, line[0], 60)) pts.push([line[0][0], line[0][1]]);
      pts.push([line[line.length - 1][0], line[line.length - 1][1], { via: line, name }]);
    };
    const order = [...pieces.filter((x) => x.kind === "start"), ...pieces.filter((x) => x.kind === "via"), ...pieces.filter((x) => x.kind === "end")];
    // Only where you go, on a ski route or tour ("the end of Brandywine Meadows"): start where you'd leave the car
    // (alex 2026-11-08: "it should place the start at the end of the nearest fsr based on the snow line level and put
    // the end at the top of the end of brandywine meadow. after the user can add and move the point"): on the roads near
    // the route's low end, the point closest to it that's still under the snow line (driving stops where the snow
    // starts). No roads loaded: the nearest trailhead parking, else the route's low end.
    let auto = null;
    const first = order.find((x) => !x.miss);
    if (first && first.hit.kind === "route" && !order.some((x) => x.kind === "start" && !x.miss)) {
      const ln = mainLine(first.lines), e = [ln[0], ln[ln.length - 1]];
      const [h0, h1] = await Promise.all(e.map((p) => window.tfSki.trip.heightAt(p[0], p[1]).catch(() => null)));
      const low = h0 != null && h1 != null && h1 < h0 ? e[1] : e[0];
      const st = await carStart(low, date).catch(() => null);
      if (st) {
        auto = { kind: "start", auto: true, hit: { kind: "road", name: st.name, what: st.what } };
        pts.push(st.p);
      } else {
        const parks = window.tfSki.trip.parkingNear ? await window.tfSki.trip.parkingNear(low, 5).catch(() => []) : [];
        const pk = parks.find((x) => kmTo([x.lat, x.lon], low) < 3);
        auto = { kind: "start", auto: true, hit: { kind: "park", name: pk ? pk.name || "Trailhead parking" : "the trailhead", what: pk ? "trailhead parking" : "the low end of " + first.hit.name } };
        pts.push(pk ? [pk.lat, pk.lon] : [low[0], low[1]]);
      }
      used.push(auto);
    }
    for (const pc of order) {
      if (pc.miss) continue;
      const x = pc.hit;
      used.push(pc);
      if (pc.kind === "via") {
        if (x.kind === "area") { const h = await hiLo(pc.lines); addPt(pc.up ? h.lo.p : h.hi.p); addPt(pc.up ? h.hi.p : h.lo.p); continue; }
        let line = mainLine(pc.lines).slice();
        if (x.kind === "slack") {
          // The line as it's skied (its drawn order). The way up to it is the 🛡 Safest way's (alex 2026-11-05: "a custom
          // route ... with the safest way to go uphill"), not the line's usual approach.
          addLine(line, x.alt || x.name);
          continue;
        }
        const [ea, eb] = await Promise.all([window.tfSki.trip.heightAt(line[0][0], line[0][1]).catch(() => null), window.tfSki.trip.heightAt(line[line.length - 1][0], line[line.length - 1][1]).catch(() => null)]);
        const upward = x.kind === "lift" || pc.up;
        if (ea != null && eb != null && (upward ? ea > eb : ea < eb)) line.reverse();
        if (line.length > 300) { const k = Math.ceil(line.length / 300); line = line.filter((_, i) => i % k === 0 || i === line.length - 1); }
        addLine(line, x.name);
        continue;
      }
      // A start or a finish: the top or bottom asked; else a start at the top (of a lift: where it drops you off) and a
      // finish at the bottom (of a bowl or run: where it comes out).
      // The far end: the end of it farthest from where the tour starts (a finish on the route the trailhead is on too).
      if (pc.pos === "far" || (pc.kind === "end" && auto && pc === first && !pc.pos)) {
        const ln = mainLine(pc.lines), ends = [ln[0], ln[ln.length - 1]];
        if (pts.length) { addPt(kmTo(ends[0], pts[0]) > kmTo(ends[1], pts[0]) ? ends[0] : ends[1]); continue; }
        const h = await hiLo(pc.lines); addPt(h.hi.p); continue;
      }
      const top = pc.pos ? pc.pos === "top" : pc.kind === "start";
      if (x.kind === "lift") { const g = mainLine(pc.lines); const [e0, e1] = await Promise.all([window.tfSki.trip.heightAt(g[0][0], g[0][1]).catch(() => null), window.tfSki.trip.heightAt(g[g.length - 1][0], g[g.length - 1][1]).catch(() => null)]); const hiEnd = e0 != null && e1 != null && e0 > e1 ? g[0] : g[g.length - 1]; addPt(top ? hiEnd : hiEnd === g[0] ? g[g.length - 1] : g[0]); continue; }
      // A finish "on" a run or road ("finish on Glacier Road"): where the tour reaches it, not its far bottom.
      if (pc.kind === "end" && !pc.pos && x.kind !== "area" && x.kind !== "lift" && pts.length) {
        const l = pts[pts.length - 1];
        let b = null, bd = Infinity;
        for (const p of pc.lines.flat()) { const d = kmTo(p, l); if (d < bd) { bd = d; b = p; } }
        if (b) { addPt(b); continue; }
      }
      const h = await hiLo(pc.lines);
      // A finish "in" a bowl: its middle, where you're in it, more than its lowest corner.
      if (pc.kind === "end" && x.kind === "area" && !pc.pos) { const all = pc.lines.flat(); addPt([(h.lo.p[0] * 2 + all.reduce((s, p) => s + p[0], 0) / all.length) / 3, (h.lo.p[1] * 2 + all.reduce((s, p) => s + p[1], 0) / all.length) / 3]); continue; }
      addPt(top ? h.hi.p : h.lo.p);
    }
    return { pts, used };
  }
  // The answer: the steps as read, and Make this tour.
  async function askPlan(p, at, out, stale) {
    const S = window.tfSki && window.tfSki.trip;
    if (!S || !S.namedNear || !S.planSet) return false;
    // From Plan a tour, a name without a step word ("DOA and Lakeside Bowl") is a line to ski, in that order.
    const steps = planSteps(p.q || "", !!p.plan);
    if (!steps.length) return false;
    out.innerHTML = `<p class="ask-wait">Finding ${esc(steps.map((x) => x.name).join(", "))}…</p>`;
    let pieces = await planPieces(steps, at.c);
    if (stale()) return true;
    // Nothing named there: the middle of the map (where the person is looking) before giving up.
    if (!pieces.some((x) => !x.miss) && !at.mid) {
      const m = map.getCenter(), mid = { c: [m.lat, m.lng], mid: true };
      if (kmTo(mid.c, at.c) > 20) { const again = await planPieces(steps, mid.c); if (stale()) return true; if (again.some((x) => !x.miss)) { pieces = again; at = mid; } }
    }
    const found = pieces.filter((x) => !x.miss);
    if (!found.length) return false;
    const { pts, used } = await planPts(pieces, p.date && p.date !== localDay() ? p.date : "");
    if (stale()) return true;
    const miss = pieces.filter((x) => x.miss);
    const lbl = (x) => {
      const h = x.hit, nm = esc(h.alt && h.kind === "slack" ? h.alt : h.name), pos = x.auto ? "" : x.pos === "far" ? "the end of " : x.pos === "top" ? "the top of " : x.pos === "bottom" ? "the bottom of " : x.kind === "start" && h.kind === "lift" ? "the top of " : "";
      const what = `<small>${esc(h.what)}${h.diff ? " · " + esc(h.diff) : ""}</small>`;
      return x.kind === "start" ? `<b>Start</b> at ${pos}${nm} ${what}` : x.kind === "end" ? `<b>Finish</b> ${pos ? "at " + pos : h.kind === "area" ? "in " : "at "}${nm} ${what}` : `<b>${x.up || h.kind === "lift" ? "Up" : "Ski"}</b> ${nm} ${what}`;
    };
    const ord = [...used.filter((x) => x.kind === "start"), ...used.filter((x) => x.kind === "via"), ...used.filter((x) => x.kind === "end")];
    // The heading says what was read: a tour from these pieces (not "Tours near you").
    const hd = dlg.querySelector(".ask-head .ask-said"), ch = dlg.querySelector(".ask-head .ask-chips");
    const short = (x) => (x.hit.kind === "slack" && x.hit.alt) || x.hit.name;
    if (hd) hd.textContent = `A tour ${ord.map((x) => (x.kind === "start" ? "from " : x.kind === "end" ? "to " : "via ") + short(x)).join(", ")}`;
    if (ch) ch.innerHTML = `<li>🗺 Plan a tour</li>${at.name ? `<li>📍 ${esc(at.name)}</li>` : ""}`;
    const ok = pts.length > 1;
    // A day asked ("tomorrow"): the less exposed way reads that day's avalanche forecast.
    const later = p.date && p.date !== localDay() ? p.date : "";
    if (ch && later) ch.insertAdjacentHTML("beforeend", `<li>📅 ${esc(dayName(later))}</li>`);
    out.innerHTML = `<h3>Your tour</h3><ol class="ask-plan">${ord.map((x) => `<li>${lbl(x)}</li>`).join("")}</ol>
      ${miss.length ? `<p class="ask-note ask-warn">Couldn't find ${miss.map((x) => `“${esc(x.name)}”`).join(", ")} near ${esc(nearName(at))}: left out. Add it by tapping the map once the tour is drawn.</p>` : ""}
      ${ok ? `<button type="button" class="ask-act" data-plan>🗺 Make this tour on the map</button>
      <button type="button" class="ask-act ask-act2" data-plan-safe>🗺 Make it with the less exposed way</button>
      <p class="ask-said">The less exposed way finds the way between the pieces (the climb too). It weighs:</p>
      <ul class="ask-why">
        <li><b>${later ? esc(dayName(later)).replace(/^./, (c) => c.toUpperCase()) + "'s" : "Today's"} avalanche danger</b> where you are${later ? " (when the forecast covers that day)" : ""}: alpine, treeline or below treeline (Avalanche Canada)</li>
        <li><b>Slope angle</b>: it keeps off 30° to 45°, where most slab avalanches start</li>
        <li><b>Which way slopes face</b>: more care on the aspects of today's avalanche problems</li>
        <li><b>What's above you</b>: where a slide from steeper ground could run, and gullies or creeks (terrain traps)</li>
        <li><b>Time</b>: about 430 m an hour up, slower in forest; open water and cliffs can't be crossed</li>
      </ul>
      <p class="ask-note">Your tour is kept in Saved. Its card shows each stretch and why it goes there. Drag, add or take away points with ✎ Edit my tour. No route is avalanche-safe: check the forecast and decide in the field.</p>`
      : `<p class="ask-note">That's only one point: say where you start and where you finish, or a line to ski.</p>`}`;
    const b = out.querySelector("[data-plan]");
    if (b) b.addEventListener("click", () => { logUse("pick", "Ask plan"); close(); S.planSet(pts, later ? { date: later } : undefined); });
    // The same, with the less exposed way turned on for this tour in the same tap (alex 2026-11-07: fewer steps).
    const bs = out.querySelector("[data-plan-safe]");
    if (bs) bs.addEventListener("click", () => { logUse("pick", "Ask plan less exposed"); close(); S.planSet(pts, { safe: true, date: later }); });
    return true;
  }

  const ANSWER = {
    // MTB: the trails within reach, read for the day asked.
    async mtb(p, at, out, stale) {
      const T = window.tfToday;
      if (!T || !window.tfZoneTrails) { out.innerHTML = `<p class="ask-note">The trail lists aren't loaded yet. Try again in a moment.</p>`; return; }
      const R = p.km_away || (at.area ? 12 : at.you ? 40 : 25);
      const zs = await T.zonesNear(at.c, R);
      if (stale()) return;
      if (!zs.length) { out.innerHTML = `<p class="ask-note">No trails within ${R} km of ${esc(nearName(at))}.</p>`; return; }
      out.innerHTML = `<p class="ask-wait">Reading the trails and the loam…</p>`;
      const [lists, areasAll, born] = await Promise.all([Promise.all(zs.map((z) => window.tfZoneTrails(z.id).catch(() => []))), ridingAreas(), T.firstMappedIn(zs).catch(() => null)]);
      if (stale()) return;
      let trails = lists.flat().filter((t) => t.c && kmTo(t.c, at.c) <= R).map((t) => ({ ...t, km: kmTo(t.c, at.c) }));
      const areas = areasAll.filter((a) => zs.some((z) => z.id === a.zone) && kmTo(a.c, at.c) <= R + 5).map((a) => ({ ...a, km: kmTo(a.c, at.c), trails: [] }));
      trails.forEach((t) => { let best = null, d = 10; areas.forEach((a) => { const k = kmTo(t.c, a.c); if (k < d) { d = k; best = a; } }); t.area = best; if (best) best.trails.push(t); });
      // The loam that day, the same reading as everywhere in the app (snow on the ground is never prime).
      const day = p.date, read = window.tfLoamDay ? await window.tfLoamDay(trails.map((t) => t.c), day).catch(() => null) : null;
      if (stale()) return;
      const fdays = read ? Math.max(0, ...read.map((x) => x.days)) : 0, far = day > addDays(localDay(), fdays);
      trails.forEach((t, i) => { const x = read && read[i]; t.v = x ? x.v : null; t.snow = x && x.snow >= (window.tfSnowCm || 5); t.prime = isPrime(t.v) && !t.snow; });
      const newSince = Date.now() - 183 * 864e5;
      trails.forEach((t) => { const ts = born ? t.ids.map((id) => born.get(id)).filter(Boolean) : []; t.isNew = ts.length === t.ids.length && ts.length > 0 && Math.min(...ts) >= newSince; });
      const ridden = T.ridden();
      const dn = dayName(day), loamWord = (t) => (t.snow ? "❄ Snow" : t.v == null ? "Loam not known" : `${loamLv(t.v)[1]} · Loam ${t.v}`);
      const farNote = far && p.loam ? `<p class="ask-note ask-warn">The loam forecast only goes ${fdays} day${fdays === 1 ? "" : "s"} ahead: ${esc(dn)} isn't known yet.</p>` : "";
      const lvOk = (t) => !p.levels.length || p.levels.includes(t.lvl) || (p.levels.includes("dbl") && t.lvl === "pro");

      if (p.what === "areas" || p.what === "loop") {
        // Riding areas, best first: the most trails in prime loam that day (when asked, or always for "where to ride"), then nearest.
        const scored = areas.filter((a) => a.trails.length >= 2).map((a) => {
          const rd = a.trails.filter((t) => t.v != null), pr = rd.filter((t) => t.prime);
          return { a, pr: pr.length, rd: rd.length, share: rd.length ? (pr.length / rd.length) * Math.min(1, rd.length / 5) : 0, park: /\bbike ?park\b/i.test(a.name) };
        });
        const byLoam = p.loam || p.what === "areas";
        scored.sort((x, y) => (x.park - y.park) || (byLoam ? (y.share > 0) - (x.share > 0) || y.share - x.share : 0) || x.a.km - y.a.km);
        if (!scored.length) { out.innerHTML = `${farNote}<p class="ask-note">No riding areas within ${R} km of ${esc(nearName(at))}.</p>`; return; }
        const areaLine = (s) => s.rd ? (s.pr ? `${s.pr} of ${s.rd} trails in prime loam ${esc(dn)}` : `No trail in prime loam ${esc(dn)}`) : `Loam ${esc(dn)} not known`;
        if (p.what === "areas") {
          const rows = scored.slice(0, 8).map((s) => ({ title: esc(s.a.name), sub: `${loamDot(s.pr ? 50 : null)}${areaLine(s)} · ${fmtKm(s.a.km)} away · ${s.a.trails.length} trails`,
            go: () => { map.flyTo(s.a.c, 13); if (window.tfSnapTo) window.tfSnapTo("peek"); } }));
          out.innerHTML = `${farNote}<h3>Riding areas ${at.you ? "near you" : "near " + esc(at.name || "the map")}</h3>${listHtml(rows)}<p class="ask-note">Tap one to go there. ☀ Where to ride today has each area's rider reports, closures and fires.</p>`;
          wire(out, rows);
          return;
        }
        // Loops (loops.js): from the parking lot nearest the trails, never bike park trails, at the length asked.
        if (!window.tfLoops) { out.innerHTML = `<p class="ask-note">Loops aren't available here.</p>`; return; }
        if (window.tfLoops.setWant && (p.hours || p.km)) window.tfLoops.setWant({ km: p.km || null, h: p.hours || null });
        const top = scored.filter((s) => !s.park).slice(0, 5);
        if (!top.length) { out.innerHTML = `<p class="ask-note">Only bike parks near ${esc(nearName(at))}: their trails are reached by the lifts, so no pedal loop.</p>`; return; }
        const lvlNote = p.levels.length ? `<p class="ask-note">Each area has an easy, a classic, a technical and a big loop: ${p.levels.includes("green") ? "the Easy loop is green and blue trails." : p.levels.includes("black") || p.levels.includes("dbl") ? "the Technical loop is black and double black trails." : "the Classic loop is blue and black trails."}</p>` : "";
        out.innerHTML = `${farNote}<h3>Loops ${p.loam ? `where the loam is best ${esc(dn)}` : "near " + esc(at.you ? "you" : at.name || "the map")}</h3>
          <div class="ask-areas">${top.map((s, i) => `<button type="button" data-a="${i}" aria-pressed="${i === 0}">${esc(s.a.name)}</button>`).join("")}</div>
          <p class="ask-note ask-aline"></p>${lvlNote}<div class="ask-loops"></div>`;
        const box = out.querySelector(".ask-loops"), line = out.querySelector(".ask-aline");
        const pick = (i) => {
          const s = top[i];
          out.querySelectorAll(".ask-areas button").forEach((b) => b.setAttribute("aria-pressed", String(+b.dataset.a === i)));
          line.innerHTML = `${loamDot(s.pr ? 50 : null)}${areaLine(s)} · ${fmtKm(s.a.km)} away`;
          window.tfLoops.show(box, s.a, close);
        };
        out.querySelectorAll(".ask-areas button").forEach((b) => b.addEventListener("click", () => pick(+b.dataset.a)));
        pick(0);
        return;
      }

      // Trails
      let pool = trails.filter(lvOk);
      if (p.new_only) pool = pool.filter((t) => t.isNew);
      if (p.not_ridden) pool = pool.filter((t) => !ridden.has(T.nameKey(t.name)));
      const want = p.loam && !far;
      pool.sort((a, b) => (want ? b.prime - a.prime : 0) || (b.isNew - a.isNew) || (b.off - a.off) || a.km - b.km);
      const rows = pool.slice(0, 10).map((t) => ({
        title: `${lvGlyph(t.lvl)}${esc(t.name)}${t.isNew ? `<span class="ask-new">New</span>` : ""}`,
        sub: `${loamDot(t.snow ? null : t.v)}${esc(loamWord(t))} ${esc(dn)}${t.area ? ` · ${esc(t.area.name)}` : ""}${t.lift ? " · 🚡 lift access" : ""} · ${fmtKm(t.km)} away${ridden.has(T.nameKey(t.name)) ? " · ✓ ridden" : ""}`,
        go: () => window.tfShowFound({ type: "w", items: t.ids.map((id) => ({ id })), name: t.name, kind: t.kind, center: L.latLng(t.c[0], t.c[1]) }),
      }));
      const primeN = pool.filter((t) => t.prime).length;
      out.innerHTML = farNote + (rows.length ? `<h3>${pool.length} trail${pool.length === 1 ? "" : "s"}${want ? `, ${primeN} in prime loam ${esc(dn)}` : ""}</h3>${listHtml(rows)}
        ${want && !primeN ? `<p class="ask-note">None of them is in prime loam ${esc(dn)}: the nearest are first.</p>` : ""}${pool.length > rows.length ? `<p class="ask-note">The best ${rows.length} of ${pool.length}. Ask for a level, new trails or an area to narrow it down.</p>` : ""}`
        : `<p class="ask-note">No trail like that within ${R} km of ${esc(nearName(at))}.${p.new_only ? " Nothing new was mapped there in the last 6 months." : ""}</p>`);
      wire(out, rows);
    },

    // Skiing: routes and huts near the place with their risk light (winter.js), or the avalanche forecast there.
    async ski(p, at, out, stale) {
      const S = window.tfSki;
      if (!S || !S.near) { out.innerHTML = `<p class="ask-note">Skiing isn't loaded yet. Try again in a moment.</p>`; return; }
      // A tour typed as a plan ("start at the top of Showcase, ski DOA, finish in Lakeside Bowl"): made into Plan a tour.
      if ((p.plan || (p.what !== "huts" && p.what !== "avalanche" && planLike(p.q))) && (await askPlan(p, at, out, stale))) return;
      if (stale()) return;
      if (p.plan) {   // asked from Plan a tour: say what's missing, not a list of other tours
        out.innerHTML = `<p class="ask-note ask-warn">Couldn't find those names near ${esc(nearName(at))}.</p><p class="ask-note">Name a lift, run, bowl or line, like this:</p><div class="ask-ex">${PLAN_EX.map((x) => `<button type="button">${esc(x)}</button>`).join("")}</div><p class="ask-note">Or close this and tap the map where you start.</p>`;
        out.querySelectorAll(".ask-ex button").forEach((b) => b.addEventListener("click", () => open(b.textContent)));
        return;
      }
      const s = (p.q || "").toLowerCase() + " " + p.words.join(" ");
      const types = /nordic|cross[- ]country|classic|skate|xc\b/.test(s) ? ["nordic"] : /snowshoe/.test(s) ? ["snowshoe"] : /snowmobile|sled/.test(s) ? ["snowmobile"] : ["tour"];
      let R = p.km_away || at.R || 25;
      let near = await S.near(at.c, R, types);
      if (stale()) return;
      // Nothing that close: look further (up to 75 km) before saying there's nothing, and say how far it went.
      let wider = 0;
      if (!p.km_away && p.what !== "huts" && !near.routes.some((r) => r.name)) {
        for (const k of [50, 75]) { const n2 = await S.near(at.c, k, types); if (stale()) return; if (n2.routes.length) { wider = R; R = k; near = n2; break; } }
      }
      const go = (fn) => () => { if (window.tfSnapTo) window.tfSnapTo("half"); fn(); };
      if (p.what === "huts") {
        const rows = near.huts.slice(0, 10).map((h) => ({ title: `🛖 ${esc(h.name)}`, sub: `${esc(h.kind)} · ${fmtKm(h.d / 1000)} away`, go: go(() => S.showHut(h.lat, h.lon)) }));
        out.innerHTML = rows.length ? `<h3>Huts near ${esc(nearName(at))}</h3>${listHtml(rows)}` : `<p class="ask-note">No huts or cabins mapped within ${R} km of ${esc(nearName(at))}.</p>`;
        wire(out, rows);
        return;
      }
      // Terrain class wanted: Simple (1) for easy, Challenging (2), Complex (3).
      const max = p.levels.length ? Math.max(...p.levels.map((l) => ({ green: 1, blue: 2, black: 3, dbl: 3 }[l]))) : 0;
      // An easy tour leaves out the ones mapped as advanced or harder, whatever their terrain class.
      let routes = near.routes.filter((r) => (!max || !r.cls || r.cls <= max) && !(max === 1 && /advanced|expert|extreme|freeride/.test(r.diff)));
      if (p.km) routes = routes.filter((r) => r.km <= p.km * 1.3);
      // The classics of the area first (data/ski-hand/ "hand:classic"; alex 2026-11-04: "kayoosh and joffre lake and
      // sholder is a classic in the duffys", missing under Steep Creek Forest Service Road and Chute 56).
      routes.sort((a, b) => (max ? (!a.cls) - (!b.cls) : 0) || (!a.classic) - (!b.classic) || a.d - b.d);
      // Many options (alex 2026-11-06: "We should have many option"): the first 12, the rest one tap away.
      const SHOW = 12;
      const rows = routes.map((r) => ({ title: (r.classic ? "★ " : "") + esc(r.name), sub: (r.classic ? "Classic · " : "") + `${r.pill ? r.pill + " · " : ""}${r.km >= 0.05 ? fmtKm(r.km) + " long · " : ""}${fmtKm(r.d / 1000)} away`,
        go: go(() => S.show(r.id, r.c)) }));
      const avy = p.what === "avalanche" ? `<button type="button" class="ask-act" data-avy>⚠ Open the avalanche forecast ${at.you ? "here" : "for " + esc(at.name)}</button>
        <p class="ask-note">${p.date !== localDay() ? `The forecast has the next days too: look for ${esc(dayName(p.date))}. ` : ""}The light on each tour is today's danger in its terrain.</p>` : "";
      const word = { tour: "ski tours", nordic: "Nordic trails", snowshoe: "snowshoe routes", snowmobile: "snowmobile trails" }[types[0]];
      // Few left after "simple" or "easy" (the Duffey is nearly all Challenging and Complex terrain): say so, and offer them all.
      const allN = near.routes.length, fewNote = max && rows.length < 3 && allN > rows.length
        ? `<p class="ask-note">Only ${rows.length || "none"} of the ${allN} ${word} here ${rows.length === 1 ? "is" : "are"} mapped as ${["", "Simple", "Challenging or easier", "Complex or easier"][max]} terrain.</p><button type="button" class="ask-more" data-all>Show all ${allN} ${word}</button>` : "";
      out.innerHTML = avy + (rows.length ? `<h3>${rows.length} ${rows.length === 1 ? word.replace(/s$/, "").replace(/s (trail|route)$/, " $1") : word} ${at.region ? "around " : "near "}${esc(nearName(at))}</h3>
        ${wider ? `<p class="ask-note">None within ${wider} km, so these go out to ${R} km.</p>` : ""}${listHtml(rows)}
        ${rows.length > SHOW ? `<button type="button" class="ask-more">Show all ${rows.length}</button>` : ""}
        ${fewNote}<p class="ask-note">Open maps can be wrong and no route is avalanche-safe: check the forecast before you go.</p>`
        : `<p class="ask-note">No ${word} like that mapped within ${R} km of ${esc(nearName(at))}.</p>${fewNote}`);
      const allB = out.querySelector("[data-all]");
      if (allB) allB.addEventListener("click", () => { p.levels = []; p.km = 0; ANSWER.ski(p, at, out, stale); });
      wire(out, rows);
      const list = out.querySelector("ol.ask-list"), more = out.querySelector(".ask-more");
      if (list && more) {
        [...list.children].forEach((li, i) => { li.hidden = i >= SHOW; });
        more.addEventListener("click", () => { [...list.children].forEach((li) => { li.hidden = false; }); more.remove(); });
      }
      const ab = out.querySelector("[data-avy]");
      if (ab) ab.addEventListener("click", () => { close(); map.setView(at.c, 11); setTimeout(() => { const b = $("skNow"); if (b && !b.hidden) b.click(); }, 400); });
    },

    // Hunting: the spot card at the place (zone, what's open today, rules).
    async hunt(p, at, out, stale) {
      const H = window.tfHunt;
      if (!H) { out.innerHTML = `<p class="ask-note">Hunting isn't loaded yet. Try again in a moment.</p>`; return; }
      const zone = H.zoneAt ? await H.zoneAt(at.c[0], at.c[1]).catch(() => "") : "";
      if (stale()) return;
      out.innerHTML = `<h3>${esc(at.you ? "Where you are" : at.name || "This spot")}</h3>
        <p>${zone ? `In <b>${esc(zone)}</b>.` : "No hunting zone found here."}</p>
        <button type="button" class="ask-act" data-go>🦌 See what's open here${p.species ? ` for ${esc(p.species)}` : ""}</button>
        <p class="ask-note">The spot card lists what's open today, the land (parks, no-shooting areas), the season dates and the rules for the zone${p.date !== localDay() ? `: check the dates for ${esc(dayName(p.date))}` : ""}.</p>`;
      out.querySelector("[data-go]").addEventListener("click", () => { close(); H.openAt(at.c[0], at.c[1]); if (window.tfSnapTo) window.tfSnapTo("half"); });
    },

    // Fishing: stocked waters near the place (for the fish named), or the spot card.
    async fish(p, at, out, stale) {
      const F = window.tfFish;
      if (!F) { out.innerHTML = `<p class="ask-note">Fishing isn't loaded yet. Try again in a moment.</p>`; return; }
      const spotBtn = `<button type="button" class="ask-act" data-go>🎣 Open ${at.you ? "this spot" : esc(at.name)}: rules, conditions, what's there</button>`;
      const spot = () => { close(); F.show(at.c[0], at.c[1], at.you ? "" : at.name); if (window.tfSnapTo) window.tfSnapTo("half"); };
      if (p.what === "spot" || !F.stockedNear) { out.innerHTML = spotBtn; out.querySelector("[data-go]").addEventListener("click", spot); return; }
      const R = p.km_away || 30;
      let ws = await F.stockedNear(at.c[0], at.c[1], R);
      if (stale()) return;
      const sp = norm(p.species).replace(/s$/, "");
      if (sp) ws = ws.filter((w) => w.sp.some((x) => norm(x).includes(sp)));
      const when = (d) => (/^\d{4}-\d\d-\d\d$/.test(d || "") ? new Date(d + "T12:00").toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }) : d || "");
      const rows = ws.slice(0, 10).map((w) => ({ title: `💧 ${esc(w.n)}`, sub: `${esc(w.sp.slice(0, 3).join(", "))}${w.last ? ` · last stocked ${esc(when(w.last))}` : ""} · ${fmtKm(w.d)} away`,
        go: () => { F.show(w.c[0], w.c[1], w.n); if (window.tfSnapTo) window.tfSnapTo("half"); } }));
      out.innerHTML = (rows.length ? `<h3>Stocked waters${p.species ? ` with ${esc(p.species)}` : ""} near ${esc(nearName(at))}</h3>${listHtml(rows)}`
        : `<p class="ask-note">No stocked waters${p.species ? ` with ${esc(p.species)}` : ""} within ${R} km of ${esc(nearName(at))} in the stocking reports.</p>`) + spotBtn
        + `<p class="ask-note">From the provinces' stocking reports. Check the rules for each water before you fish.</p>`;
      wire(out, rows);
      out.querySelector("[data-go]").addEventListener("click", spot);
    },

    // Adventure moto: ADV routes near the place (data/moto-routes.json), or the spot card.
    async moto(p, at, out, stale) {
      const spot = () => { close(); map.setView(at.c, Math.max(map.getZoom(), 11)); map.fire("click", { latlng: L.latLng(at.c[0], at.c[1]) }); };
      if (p.what === "spot") {
        out.innerHTML = `<button type="button" class="ask-act" data-go>🏍 Open ${at.you ? "this spot" : esc(at.name)}: gas, camping, can I ride here</button>`;
        out.querySelector("[data-go]").addEventListener("click", spot);
        return;
      }
      const j = await fetch("data/moto-routes.json").then((r) => r.json()).catch(() => null);
      if (stale()) return;
      const R = p.km_away || 200;
      let rs = ((j && j.routes) || []).filter((t) => t && t.n && t.start).map((t) => ({ t, d: Math.min(kmTo(at.c, t.start), t.end ? kmTo(at.c, t.end) : 1e9) })).filter((x) => x.d <= R);
      if (p.km) rs = rs.filter((x) => (x.t.km || 0) <= p.km * 1.15);
      const s = (p.q || "").toLowerCase();
      const dirt = /\bdirt\b|\bgravel\b|\boff[- ]?road\b/.test(s), easy = p.levels.includes("green") || /\beasy\b/.test(s), hard = p.levels.some((l) => l === "black" || l === "dbl");
      if (easy) rs = rs.filter((x) => (x.t.grade || 2) <= 2);
      if (hard) rs = rs.filter((x) => (x.t.grade || 2) >= 3);
      if (dirt) rs = rs.filter((x) => (x.t.dirtPct || 0) >= 50);
      rs.sort((a, b) => a.d - b.d);
      const rows = rs.slice(0, 10).map(({ t, d }) => ({ title: esc(t.n), sub: `${fmtKm(t.km || 0)}${t.dirtPct != null ? ` · ${t.dirtPct}% dirt` : ""} · grade ${t.grade || 2}${t.season ? ` · ${esc(t.season)}` : ""} · starts ${fmtKm(d)} away`,
        go: async () => { if (window.tfLoadMoto) await window.tfLoadMoto().catch(() => {}); if (window.tfMoto && window.tfMoto.openTrip) window.tfMoto.openTrip(t.id); } }));
      out.innerHTML = rows.length ? `<h3>ADV routes near ${esc(nearName(at))}</h3>${listHtml(rows)}<p class="ask-note">Grade 1 is paved, 5 is the roughest. Tap one for its gas stops, camps and Plan it for my bike.</p>`
        : `<p class="ask-note">No ADV route like that within ${R} km of ${esc(nearName(at))}.</p>`;
      wire(out, rows);
    },
  };

  // looks: whether words read like a question (the sport's search box hands those to Ask, winter.js and place-search.js
  // also when no place has that name).
  window.tfAsk = { html: (sp) => boxHtml(sp), open, parse: localParse, looks: (q) => asks(q || "") };
})();
