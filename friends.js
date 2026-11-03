// Friends see unofficial trails (go-public checklist item 8, alex 2026-11-03).
// The app reads localStorage "tf-friend" when it opens (index.html, the tf-pub class in <head> and FRIEND in the main
// script): "1" = alex or a friend alex added on usage.html (supabase/friends.sql), so the Unofficial chips, Likely MTB
// paths and possible unmapped lines show, as before. Anyone else gets the public map: hidden or risky trails left out.
// After each sign-in or sign-out this asks Supabase (tf_is_friend) and reloads the page once when the answer changed.
// The key has no "tf:" prefix, so account.js never syncs it between devices: each device asks for itself.
(function () {
  const KEY = "tf-friend";
  const now = () => { try { return localStorage.getItem(KEY) === "1"; } catch { return false; } };
  const save = (v) => { try { if (v) localStorage.setItem(KEY, "1"); else localStorage.removeItem(KEY); } catch {} };
  const flip = (v) => { if (v === now()) return; save(v); location.reload(); };
  async function check(user) {
    const a = window.tfAccount;
    if (!a) return;
    if (!user) { flip(false); return; }
    if (!a.client) return;
    try {
      const { data, error } = await a.client.rpc("tf_is_friend");
      if (error) return;   // no signal, or friends.sql not run yet: keep what this device knew
      flip(data === true);
    } catch {}
  }
  window.addEventListener("tf:account", (e) => check(e.detail));
  // Signed in from before: tf:account fires once the sign-in library loads. Never signed in here: no event, so a device
  // that was a friend's and has no sign-in any more goes back to the public map.
  const a = window.tfAccount;
  if (a && a.ready) a.ready.then((u) => { if (!u && now()) flip(false); });
})();
