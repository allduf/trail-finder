// Rider photos on a trail (alex, from Trailforks' trail photos): friends add a photo to a trail and everyone sees it
// in the trail's details. Anyone can look; adding needs the optional sign-in (account.js), to keep spam out.
// Photos are shrunk on the phone (1600 px, JPEG) before they go up, as Supabase's free storage is 1 GB.
// Stored in the Supabase table trail_photos and the public bucket "trail-photos" (see supabase/trail-photos.sql).
// The find-by-photo function also compares pictures with these (supabase/functions/which-trail).
// index.html calls tfTrailPhotos.show(trail) when a trail's detail panel opens.
(() => {
  "use strict";
  const acct = window.tfAccount;
  if (!acct || !acct.enabled) return;
  const BUCKET = "trail-photos", MAX_PX = 1600, QUALITY = 0.8, MAX_SHOWN = 12;
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  const css = document.createElement("style");
  css.textContent = `
.tp-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(96px, 1fr)); gap: 6px; margin: 0 0 8px; }
.tp-grid button { padding: 0; border: 0; background: var(--chip); border-radius: 8px; overflow: hidden; aspect-ratio: 4 / 3; cursor: pointer; }
.tp-grid img { width: 100%; height: 100%; object-fit: cover; display: block; }
.tp-add { display: inline-flex; align-items: center; gap: 6px; font: inherit; font-weight: 600; padding: 7px 12px; border-radius: 999px; border: 1px solid var(--line); background: var(--chip); color: var(--fg); cursor: pointer; }
.tp-add input { position: absolute; opacity: 0; width: 1px; height: 1px; }
dialog.tp-view { border: 0; padding: 0; background: #000; max-width: min(96vw, 1200px); max-height: 92dvh; border-radius: 12px; overflow: hidden; }
dialog.tp-view::backdrop { background: rgba(0,0,0,.8); }
dialog.tp-view img { display: block; max-width: min(96vw, 1200px); max-height: calc(92dvh - 52px); object-fit: contain; margin: 0 auto; }
dialog.tp-view footer { display: flex; gap: 8px; align-items: center; padding: 8px 10px; color: #fff; font-size: .85rem; }
dialog.tp-view footer span { flex: 1; }
dialog.tp-view footer button { font: inherit; font-weight: 600; padding: 6px 12px; border-radius: 8px; border: 1px solid #fff4; background: #ffffff1a; color: #fff; cursor: pointer; }`;
  document.head.append(css);

  const viewer = document.createElement("dialog");
  viewer.className = "tp-view";
  viewer.innerHTML = `<img alt=""><footer><span></span><button type="button" data-del hidden>Delete</button><button type="button" data-x>Close</button></footer>`;
  document.body.append(viewer);
  viewer.querySelector("[data-x]").addEventListener("click", () => viewer.close());
  viewer.addEventListener("click", (e) => { if (e.target === viewer) viewer.close(); });

  async function shrink(file) {
    const u = URL.createObjectURL(file);
    try {
      const img = new Image(); img.src = u; await img.decode();
      const s = Math.min(1, MAX_PX / Math.max(img.naturalWidth, img.naturalHeight));
      const c = document.createElement("canvas");
      c.width = Math.round(img.naturalWidth * s); c.height = Math.round(img.naturalHeight * s);
      c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
      return await new Promise((res) => c.toBlob((b) => res(b), "image/jpeg", QUALITY));
    } catch { return null; } finally { URL.revokeObjectURL(u); }
  }
  const urlOf = (path) => acct.client.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;

  let current = null;
  async function show(t) {
    current = t;
    const box = document.getElementById("trailPhotos");
    if (!box) return;
    await acct.load();
    if (current !== t || !document.body.contains(box)) return;
    if (!acct.client) { box.textContent = "Rider photos aren't available right now."; return; }
    const type = t.osmType || "way";
    const { data, error } = await acct.client.from("trail_photos").select("id, user_id, path, caption, created_at")
      .eq("osm_type", type).eq("osm_id", t.id).order("created_at", { ascending: false }).limit(MAX_SHOWN);
    if (current !== t || !document.body.contains(box)) return;
    if (error) {   // photos not set up or not reachable: hide the section, never show riders a database message (alex)
      console.warn("Rider photos:", error.message);
      box.hidden = true;
      if (box.previousElementSibling && box.previousElementSibling.tagName === "H3") box.previousElementSibling.hidden = true;
      return;
    }
    box.classList.remove("muted");
    const me = acct.user ? acct.user.id : null;
    const grid = !data.length ? `<p class="muted">No rider photos yet.${me ? " Add the first one." : ""}</p>`
      : `<div class="tp-grid">${data.map((p, i) => `<button type="button" data-i="${i}" aria-label="Open photo"><img loading="lazy" alt="${esc(p.caption || "Rider photo")}" src="${esc(urlOf(p.path))}"></button>`).join("")}</div>`;
    const add = me ? `<label class="tp-add">📷 Add a photo<input type="file" accept="image/*"></label> <span class="muted tp-msg" role="status"></span>`
      : `<p><button type="button" class="linkish tp-signin">Sign in to add a photo</button></p>`;
    box.innerHTML = grid + add;
    box.querySelectorAll(".tp-grid button").forEach((b) => b.addEventListener("click", () => {
      const p = data[+b.dataset.i];
      viewer.querySelector("img").src = urlOf(p.path);
      viewer.querySelector("span").textContent = `${p.caption ? p.caption + " · " : ""}${new Date(p.created_at).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}${p.user_id === me ? " · yours" : ""}`;
      const del = viewer.querySelector("[data-del]");
      del.hidden = p.user_id !== me;
      del.onclick = async () => {
        if (!confirm("Delete this photo?")) return;
        del.disabled = true;
        await acct.client.storage.from(BUCKET).remove([p.path]);
        await acct.client.from("trail_photos").delete().eq("id", p.id);
        del.disabled = false; viewer.close(); show(t);
      };
      try { viewer.showModal(); } catch { viewer.setAttribute("open", ""); }
    }));
    const signIn = box.querySelector(".tp-signin");
    if (signIn) signIn.addEventListener("click", () => { const b = document.querySelector(".acct-btn"); if (b) b.click(); });
    const input = box.querySelector(".tp-add input");
    if (input) input.addEventListener("change", async () => {
      const file = input.files && input.files[0], msg = box.querySelector(".tp-msg");
      if (!file) return;
      msg.textContent = "Getting it ready…";
      const blob = await shrink(file);
      if (!blob) { msg.textContent = "Couldn't read that picture."; return; }
      const caption = (prompt("A few words about it? (optional)", "") || "").trim().slice(0, 200);
      msg.textContent = "Uploading…";
      const path = `${me}/${t.id}-${Date.now().toString(36)}.jpg`;
      const up = await acct.client.storage.from(BUCKET).upload(path, blob, { contentType: "image/jpeg" });
      if (up.error) { msg.textContent = "Couldn't upload: " + up.error.message; return; }
      const mid = t.geom[Math.floor(t.geom.length / 2)], at = Array.isArray(mid) ? mid : [mid.lat, mid.lng];
      const name = t.tags && (t.tags.name || t.tags["mtb:name"]);
      const { error: e } = await acct.client.from("trail_photos").insert({ osm_type: type, osm_id: t.id, trail_name: name ? String(name).slice(0, 120) : null, lat: at[0], lon: at[1], path, caption: caption || null });
      if (e) { await acct.client.storage.from(BUCKET).remove([path]); msg.textContent = "Couldn't save: " + e.message; return; }
      show(t);
    });
  }

  window.tfTrailPhotos = { show };
  window.addEventListener("tf:account", () => { if (current && document.getElementById("trailPhotos")) show(current); });
})();
