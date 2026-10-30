// Japanese help, in Skiing only (alex 2026-10-30: "make it so we can have the option of tracdution close by because i
// know the comunication there will be hard"). A box of phrases for a ski and camper van trip, written in Japanese to
// show people (tap one: it fills the screen), with romaji to say it, and emergency numbers. Works with no signal (it's
// all in this file). "Translate" opens Google Translate for anything else (camera for signs and menus, voice for
// talking). Opened from the 🗣 button on the map in Japan, the Skiing panel, and the Japan cards (camper.js,
// ski-areas.js): window.tfJapanese.open(), and window.tfJapanese.translate(text) for a Japanese name.
(() => {
  "use strict";
  const map = window.tfLeaflet;
  if (!map || !window.L) return;
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const isSki = () => document.body.classList.contains("sport-ski");
  const inJapan = (ll) => ll.lat > 24 && ll.lat < 46.5 && ll.lng > 122 && ll.lng < 146.5;

  // [English, Japanese, romaji]
  const PHRASES = [
    ["Emergency", [
      ["Help!", "助けて！", "Tasukete!"],
      ["Please call an ambulance.", "救急車を呼んでください。", "Kyūkyūsha o yonde kudasai."],
      ["Someone is injured.", "けが人がいます。", "Kega-nin ga imasu."],
      ["There was an avalanche. Someone is buried.", "雪崩がありました。人が埋まっています。", "Nadare ga arimashita. Hito ga umatte imasu."],
      ["Our car is stuck in the snow.", "車が雪にはまって動けません。", "Kuruma ga yuki ni hamatte ugokemasen."],
      ["I don't speak Japanese.", "日本語が話せません。", "Nihongo ga hanasemasen."],
      ["Do you speak English?", "英語を話せますか？", "Eigo o hanasemasu ka?"],
    ]],
    ["Camper van and driving", [
      ["May we sleep in our camper van here tonight?", "今夜ここで車中泊してもいいですか？", "Kon'ya koko de shachūhaku shite mo ii desu ka?"],
      ["Where can we park?", "どこに駐車できますか？", "Doko ni chūsha dekimasu ka?"],
      ["Diesel, a full tank please.", "軽油を満タンでお願いします。", "Keiyu o mantan de onegaishimasu."],
      ["Regular gasoline, a full tank please.", "レギュラー満タンでお願いします。", "Regyurā mantan de onegaishimasu."],
      ["Is this road open?", "この道は通れますか？", "Kono michi wa tōremasu ka?"],
      ["Do we need snow chains?", "チェーンは必要ですか？", "Chēn wa hitsuyō desu ka?"],
      ["Where can we empty our toilet tank?", "トイレのタンクはどこで処理できますか？", "Toire no tanku wa doko de shori dekimasu ka?"],
      ["Where can we get water?", "水はどこでもらえますか？", "Mizu wa doko de moraemasu ka?"],
      ["Where is the toilet?", "トイレはどこですか？", "Toire wa doko desu ka?"],
    ]],
    ["Onsen", [
      ["How much is it?", "いくらですか？", "Ikura desu ka?"],
      ["Are tattoos OK?", "タトゥーは大丈夫ですか？", "Tatū wa daijōbu desu ka?"],
      ["Can we rent a towel?", "タオルを借りられますか？", "Taoru o kariraremasu ka?"],
      ["What time do you close?", "何時に閉まりますか？", "Nanji ni shimarimasu ka?"],
    ]],
    ["Skiing", [
      ["Two adult one-day lift passes, please.", "大人の一日券を二枚ください。", "Otona no ichinichi-ken o ni-mai kudasai."],
      ["Is the backcountry gate open today?", "今日はバックカントリーゲートは開いていますか？", "Kyō wa bakkukantorī gēto wa aite imasu ka?"],
      ["We'd like to hand in our climbing plan.", "登山届を出したいです。", "Tozan todoke o dashitai desu."],
      ["What is the avalanche danger today?", "今日の雪崩の危険度はどうですか？", "Kyō no nadare no kikendo wa dō desu ka?"],
      ["Is the top lift running?", "一番上のリフトは動いていますか？", "Ichiban ue no rifuto wa ugoite imasu ka?"],
    ]],
    ["Everyday", [
      ["Thank you.", "ありがとうございます。", "Arigatō gozaimasu."],
      ["Excuse me / sorry.", "すみません。", "Sumimasen."],
      ["Can I pay by card?", "カードで払えますか？", "Kādo de haraemasu ka?"],
      ["Is there wifi?", "Wi-Fiはありますか？", "Wai-fai wa arimasu ka?"],
      ["Please write it down.", "書いてください。", "Kaite kudasai."],
    ]],
  ];
  // Japan's numbers (checked 2026-10-30): 119 fire and ambulance (also mountain rescue with the police), 110 police,
  // JNTO's Japan Visitor Hotline in English, 24 h.
  const NUMBERS = [["119", "Ambulance, fire, rescue"], ["110", "Police (also mountain rescue)"], ["050-3816-2787", "Japan Visitor Hotline (English, 24 h)"]];
  const gt = (text, from = "ja", to = "en") => `https://translate.google.com/?sl=${from}&tl=${to}&op=translate${text ? `&text=${encodeURIComponent(text)}` : ""}`;

  const css = document.createElement("style");
  css.textContent = `
dialog.jp-dlg { border: 1px solid var(--line); border-radius: 14px; background: var(--panel); color: var(--fg); padding: 16px; width: min(560px, calc(100vw - 24px)); max-height: calc(100dvh - 24px); overflow: auto; box-shadow: 0 10px 40px rgba(0,0,0,.3); font: inherit; font-size: .92rem; box-sizing: border-box; }
dialog.jp-dlg::backdrop { background: rgba(0,0,0,.55); }
dialog.jp-dlg h2 { margin: 0 38px 6px 0; font-family: var(--font-display); font-size: 1.25rem; }
dialog.jp-dlg h3 { margin: 14px 0 6px; font-size: .8rem; color: var(--muted); text-transform: uppercase; letter-spacing: .04em; }
dialog.jp-dlg .jp-x { position: absolute; top: 10px; right: 10px; width: 34px; height: 34px; border-radius: 50%; border: 1px solid var(--line); background: var(--bg); color: var(--fg); font-size: 18px; cursor: pointer; }
dialog.jp-dlg .jp-go { display: flex; flex-wrap: wrap; gap: 6px; margin: 6px 0; }
dialog.jp-dlg .jp-go a { font-size: .86rem; font-weight: 700; padding: 9px 14px; border-radius: 999px; background: #1f5fe0; color: #fff; text-decoration: none; }
dialog.jp-dlg .jp-go a.alt { background: var(--chip); color: var(--fg); border: 1px solid var(--line); }
dialog.jp-dlg .jp-p { all: unset; box-sizing: border-box; display: block; width: 100%; padding: 8px 10px; border-radius: 10px; border: 1px solid var(--line); margin: 0 0 6px; cursor: pointer; background: var(--bg); }
dialog.jp-dlg .jp-p b { display: block; font-size: .88rem; }
dialog.jp-dlg .jp-p span { display: block; font-size: 1.05rem; margin-top: 2px; }
dialog.jp-dlg .jp-p small { display: block; color: var(--muted); font-size: .78rem; }
dialog.jp-dlg .jp-num { display: flex; gap: 10px; align-items: baseline; margin: 4px 0; }
dialog.jp-dlg .jp-num a { font-weight: 800; font-size: 1.05rem; color: var(--accent); min-width: 120px; }
dialog.jp-dlg .jp-small { font-size: .78rem; color: var(--muted); }
html dialog.jp-big:modal { position: fixed; inset: 0; border: 0; padding: env(safe-area-inset-top, 0px) 0 env(safe-area-inset-bottom, 0px); margin: 0; width: auto; height: auto; max-width: none; max-height: none; box-sizing: border-box; background: #fff; color: #111; }
dialog.jp-big div { box-sizing: border-box; height: 100%; display: flex; flex-direction: column; justify-content: center; padding: 24px; gap: 18px; text-align: center; }
dialog.jp-big p { margin: 0; font-size: clamp(2rem, 9vw, 4rem); line-height: 1.3; font-weight: 700; }
dialog.jp-big small { font-size: 1rem; color: #555; }
dialog.jp-big button { align-self: center; font: inherit; font-weight: 700; padding: 12px 22px; border-radius: 999px; border: 1px solid #ccc; background: #f1f3f5; color: #111; }
#jpBtn { position: absolute; z-index: 800; right: 12px; top: calc(env(safe-area-inset-top, 0px) + 96px); font: inherit; font-weight: 700; font-size: .9rem; padding: 10px 14px; border-radius: 999px; border: 0; background: var(--panel); color: var(--fg); box-shadow: 0 2px 10px rgba(0,0,0,.25); cursor: pointer; display: none; }
#jpBtn.on { display: block; }
#skiPane .jp-open { font: inherit; font-size: .88rem; font-weight: 700; padding: 10px 8px; border-radius: 12px; border: 1px solid var(--line); background: var(--chip); color: var(--fg); cursor: pointer; width: 100%; margin-top: 6px; display: none; }
#skiPane .jp-open.on { display: block; }
`;
  document.head.appendChild(css);

  const dlg = document.createElement("dialog");
  dlg.className = "jp-dlg"; dlg.setAttribute("aria-label", "Japanese help");
  const big = document.createElement("dialog");
  big.className = "jp-big"; big.setAttribute("aria-label", "Show this");
  document.body.append(dlg, big);
  dlg.addEventListener("click", (e) => { if (e.target === dlg) dlg.close(); });

  function show(p) {
    big.innerHTML = `<div><p lang="ja">${esc(p[1])}</p><small>${esc(p[2])}<br>${esc(p[0])}</small><button type="button">Done</button></div>`;
    big.querySelector("button").onclick = () => big.close();
    big.showModal();
  }
  function open() {
    dlg.innerHTML = `<button type="button" class="jp-x" aria-label="Close">✕</button>
      <h2>🗣 Japanese help</h2>
      <div class="jp-go">
        <a href="${gt("", "en", "ja")}" target="_blank" rel="noopener">Translate (Google)</a>
        <a class="alt" href="${gt("", "ja", "en")}" target="_blank" rel="noopener">Japanese → English</a>
      </div>
      <p class="jp-small">In the Google Translate app: the camera reads signs and menus, Conversation listens to both of you. Download Japanese in the app before the trip so it works with no signal.</p>
      <h3>Talk with AirPods (Apple Live Translation)</h3>
      <p class="jp-small">Apple doesn't let apps start it, but it takes a second: press and hold both AirPods stems (or Control Center → Translate). You hear their Japanese in English; they read your answer in Japanese on your iPhone. Before the trip: Settings → Apps → Translate → Downloaded Languages → Japanese and English, and Settings → your AirPods → Live Translation → Japanese (if Japanese isn't listed, update iOS). Needs AirPods Pro 2 or 3 and an iPhone 15 Pro or newer with Apple Intelligence.</p>
      <h3>Emergency numbers</h3>
      ${NUMBERS.map(([n, w]) => `<div class="jp-num"><a href="tel:${n.replace(/-/g, "")}">${n}</a><span>${esc(w)}</span></div>`).join("")}
      ${PHRASES.map(([g, list], gi) => `<h3>${esc(g)}</h3>${list.map((p, i) => `<button type="button" class="jp-p" data-g="${gi}" data-i="${i}"><b>${esc(p[0])}</b><span lang="ja">${esc(p[1])}</span><small>${esc(p[2])}</small></button>`).join("")}`).join("")}
      <p class="jp-small">Tap a phrase to show it big. These work with no signal.</p>`;
    dlg.querySelector(".jp-x").onclick = () => dlg.close();
    dlg.querySelectorAll(".jp-p").forEach((b) => b.addEventListener("click", () => show(PHRASES[+b.dataset.g][1][+b.dataset.i])));
    if (!dlg.open) dlg.showModal();
  }

  // The map button (in Japan) and the Skiing panel button.
  const btn = document.createElement("button");
  btn.type = "button"; btn.id = "jpBtn"; btn.textContent = "🗣 Japanese";
  btn.title = "Japanese phrases to show people, emergency numbers and Google Translate";
  btn.addEventListener("click", (e) => { e.stopPropagation(); open(); });
  map.getContainer().append(btn);
  L.DomEvent.disableClickPropagation(btn);
  const panelBtn = document.createElement("button");
  panelBtn.type = "button"; panelBtn.className = "jp-open"; panelBtn.textContent = "🗣 Japanese help: phrases and translate";
  panelBtn.addEventListener("click", open);
  function sync() {
    const want = isSki() && inJapan(map.getCenter());
    btn.classList.toggle("on", want); panelBtn.classList.toggle("on", want);
    const acts = document.querySelector("#skiPane .sk-acts");
    if (!panelBtn.isConnected && acts) acts.after(panelBtn);
  }
  map.on("moveend", sync);
  new MutationObserver(sync).observe(document.body, { attributes: true, attributeFilter: ["class"] });
  window.tfJapanese = { open, translate: (text) => window.open(gt(text), "_blank", "noopener") , url: gt };
  sync();
})();
