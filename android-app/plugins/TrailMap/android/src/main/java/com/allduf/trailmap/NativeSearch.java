package com.allduf.trailmap;

import android.app.AlertDialog;
import android.content.Context;
import android.text.InputType;
import android.view.inputmethod.EditorInfo;
import android.widget.EditText;
import android.widget.FrameLayout;
import com.getcapacitor.JSObject;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.Iterator;
import java.util.List;
import java.util.Map;
import org.json.JSONArray;
import org.json.JSONObject;
import org.maplibre.android.geometry.LatLng;
import org.maplibre.android.maps.Style;

// Search a place from native 3D and fly there, the Android side of NativeSearch.swift (native 3D parity step 2). A
// "Search" button at the top right asks for a name (or a GPS point); the page (native-search.js) looks it up with its own
// place search and sends back up to six places; picking one flies there, a little less tilted, and the page drops its red
// pin there, which comes back with the other pins (NativePins.java).
// Page -> here (key "search"): { "q", "hits": [{ "name", "sub", "lat", "lon", "bb": [s, n, w, e] or null }], "error" },
// or at open { "labels": { English: the page's language } }. Here -> page: "search" { q } and "searchPick" { i }.
final class NativeSearch implements NativeLayer {
    private TrailMapScreen screen;
    private boolean button = false;
    private String asked = "";
    private final List<JSONObject> hits = new ArrayList<>();
    private final Map<String, String> labels = new HashMap<>();
    private AlertDialog open;

    private String t(String s) { String v = labels.get(s); return v != null ? v : s; }

    @Override public String key() { return "search"; }

    @Override
    public void added(Style style, TrailMapScreen screen) {
        this.screen = screen;
        if (button) return;
        button = true;
        screen.addToolButton(t("Search"), this::ask);
    }

    private void ask() {
        if (screen == null || screen.isLeft()) return;
        Context c = screen.getContext();
        EditText field = new EditText(c);
        field.setHint(t("Place name"));
        field.setText(asked);
        field.setSingleLine(true);
        field.setInputType(InputType.TYPE_CLASS_TEXT);
        field.setImeOptions(EditorInfo.IME_ACTION_SEARCH);
        FrameLayout box = new FrameLayout(c);
        int pad = Math.round(20 * c.getResources().getDisplayMetrics().density);
        box.setPadding(pad, 0, pad, 0);
        box.addView(field);
        Runnable go = () -> {
            String q = field.getText().toString().trim();
            if (q.isEmpty()) return;
            asked = q;
            JSObject o = new JSObject();
            o.put("q", q);
            screen.send("search", o);
        };
        AlertDialog d = new AlertDialog.Builder(c)
            .setTitle(t("Search a place"))
            .setMessage(t("A town, mountain, lake or region, or a GPS point"))
            .setView(box)
            .setNegativeButton(t("Cancel"), null)
            .setPositiveButton(t("Search"), (dlg, w) -> go.run())
            .create();
        field.setOnEditorActionListener((v, action, ev) -> {
            if (action != EditorInfo.IME_ACTION_SEARCH) return false;
            go.run();
            d.dismiss();
            return true;
        });
        show(d);
        field.requestFocus();
    }

    @Override
    public void setData(String json, Style style) {
        JSONObject o;
        try { o = new JSONObject(json); } catch (Exception e) { return; }
        JSONObject l = o.optJSONObject("labels");
        if (l != null) {
            for (Iterator<String> it = l.keys(); it.hasNext(); ) { String k = it.next(); labels.put(k, l.optString(k, k)); }
            return;
        }
        if (!asked.equals(o.optString("q", null))) return;   // an answer to an older search
        hits.clear();
        JSONArray h = o.optJSONArray("hits");
        if (h != null) for (int i = 0; i < h.length(); i++) { JSONObject x = h.optJSONObject(i); if (x != null) hits.add(x); }
        result(o.isNull("error") ? null : o.optString("error", null));
    }

    private void result(String error) {
        if (screen == null || screen.isLeft()) return;
        Context c = screen.getContext();
        if (hits.isEmpty()) {
            show(new AlertDialog.Builder(c)
                .setTitle(asked)
                .setMessage("offline".equals(error) ? t("The search needs a connection.") : t("No place found."))
                .setPositiveButton(t("OK"), null)
                .create());
            return;
        }
        String[] rows = new String[hits.size()];
        for (int i = 0; i < hits.size(); i++) {
            JSONObject x = hits.get(i);
            String name = x.optString("name", ""), sub = x.optString("sub", "");
            if (name.isEmpty()) name = t("Place");
            rows[i] = sub.isEmpty() ? name : name + " · " + sub;
        }
        show(new AlertDialog.Builder(c)
            .setTitle(asked)
            .setItems(rows, (dlg, i) -> go(i))
            .setNegativeButton(t("Cancel"), null)
            .create());
    }

    // Something still open (the Search box opened again): the new one replaces it.
    private void show(AlertDialog d) {
        if (open != null && open.isShowing()) { try { open.dismiss(); } catch (Exception ignored) {} }
        open = d;
        d.show();
    }

    private void go(int i) {
        if (i < 0 || i >= hits.size() || screen == null) return;
        JSONObject h = hits.get(i);
        if (!h.has("lat") || !h.has("lon")) return;
        double lat = h.optDouble("lat"), lon = h.optDouble("lon");
        if (Double.isNaN(lat) || Double.isNaN(lon)) return;
        // The place's outline when it has a real one, else a square around it (a peak or a point, 2 km, as the page does).
        double s = lat - 0.009, n = lat + 0.009, w = lon - 0.014, e = lon + 0.014;
        JSONArray bb = h.optJSONArray("bb");
        if (bb != null && bb.length() == 4) {
            double bs = bb.optDouble(0), bn = bb.optDouble(1), bw = bb.optDouble(2), be = bb.optDouble(3);
            if (!Double.isNaN(bs + bn + bw + be) && (bn - bs > 0.004 || be - bw > 0.004)) { s = bs; n = bn; w = bw; e = be; }
        }
        screen.fly(new LatLng(s, w), new LatLng(n, e));
        JSObject o = new JSObject();
        o.put("i", i);
        screen.send("searchPick", o);
    }
}
