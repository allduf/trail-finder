package com.allduf.trailmap;

import android.graphics.Color;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.os.Handler;
import android.os.Looper;
import android.util.Base64;
import android.util.TypedValue;
import android.view.Gravity;
import android.view.View;
import android.widget.LinearLayout;
import android.widget.TextView;
import com.getcapacitor.JSObject;
import java.io.IOException;
import java.util.ArrayList;
import java.util.Collections;
import java.util.HashMap;
import java.util.Iterator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;
import okhttp3.Interceptor;
import okhttp3.MediaType;
import okhttp3.Protocol;
import okhttp3.Response;
import okhttp3.ResponseBody;
import org.json.JSONArray;
import org.json.JSONObject;
import org.maplibre.android.maps.Style;
import org.maplibre.android.style.layers.Layer;
import org.maplibre.android.style.layers.PropertyFactory;
import org.maplibre.android.style.layers.RasterLayer;
import org.maplibre.android.style.sources.RasterSource;
import org.maplibre.android.style.sources.Source;
import org.maplibre.android.style.sources.TileSet;

// Ground layers in native 3D, the Android side of NativeGround.swift: elevation lines, sun and shade, slope angle, slope
// direction, flats, elevation bands, new snow and the snow forecast (Skiing), Hunting's slope layers, avalanche colours.
// The page paints these pictures already, for its own 3D map; here the map asks the page for the very same pictures
// (native-ground.js), so the colours, forecasts and estimates match the web exactly and live in one piece of code.
// The page sends under "ground":
//   - JSON { layers: [{ id, v, min, max, op, z, credit, keep }], keys: [{ t, c: [colours], l: [labels] }] }: the layers
//     that are on (drawn under the trails, lowest z first) and their colour keys;
//   - "T|<request>|<base64 PNG>": a picture asked for ("" when there's nothing there, "!" when it couldn't be painted
//     now, for example with no signal: MapLibre then asks again later).
// MapLibre loads a layer's tiles from a made-up address (HOST); TileRewriter hands those requests here, which asks the
// page ("groundTile" { r, id, z, x, y }) and answers with what it paints ("groundStop" { r } when no longer needed).
final class NativeGround implements NativeLayer {
    static final String HOST = "ground.trailfinder.invalid";
    // Layers a feature keeps over the ground pictures (ours go under the first one there, else under the trails):
    // Hunting's lowest layer, so its pictures, fills and rings stay over slope and forest colours.
    static final List<String> CEILING = Collections.singletonList("hn-bottom");

    private static final class Item {
        final String id, v, credit; final double min, max, op, z; final boolean keep;
        Item(String id, String v, double min, double max, double op, double z, String credit, boolean keep) {
            this.id = id; this.v = v; this.min = min; this.max = max; this.op = op; this.z = z; this.credit = credit; this.keep = keep;
        }
        String sourceId() { return "tfg-" + id; }
        String url() { return "https://" + HOST + "/" + id + "/{z}/{x}/{y}.png?v=" + v + "&k=" + (keep ? 1 : 0); }
    }
    private List<Item> items = new ArrayList<>();
    private final Map<String, String> onMap = new HashMap<>();   // source id -> its tile address, on the style now
    private final List<Object[]> keys = new ArrayList<>();       // { title, colours[], labels[] }
    private TrailMapScreen screen;
    private LinearLayout keyBox;

    @Override public String key() { return "ground"; }

    @Override
    public void added(Style style, TrailMapScreen screen) {
        this.screen = screen;
        Tiles.start();   // here, not when made: the page lists the features (TrailMap.features) before MapLibre starts
        Tiles.screen = screen;
        onMap.clear();   // a new style has none of them
        apply(style);
        showKeys();
        screen.send("groundReady", new JSObject());
    }

    @Override
    public void setData(String text, Style style) {
        if (text.startsWith("T|")) { Tiles.answer(text); return; }
        JSONObject j;
        try { j = new JSONObject(text); } catch (Exception e) { return; }
        List<Item> its = new ArrayList<>();
        JSONArray ls = j.optJSONArray("layers");
        if (ls != null) for (int i = 0; i < ls.length(); i++) {
            JSONObject l = ls.optJSONObject(i);
            if (l == null) continue;
            String id = l.optString("id", "");
            if (id.isEmpty() || !id.matches("[\\p{L}\\p{N}-]+")) continue;
            String v = l.optString("v", "0").replaceAll("[^\\p{L}\\p{N}._-]", "");
            its.add(new Item(id, v, l.optDouble("min", 0), l.optDouble("max", 14), l.optDouble("op", 1), l.optDouble("z", 0),
                l.optString("credit", ""), l.optBoolean("keep", false)));
        }
        its.sort((a, b) -> Double.compare(a.z, b.z));
        items = its;
        keys.clear();
        JSONArray ks = j.optJSONArray("keys");
        if (ks != null) for (int i = 0; i < ks.length(); i++) {
            JSONObject k = ks.optJSONObject(i);
            if (k == null) continue;
            keys.add(new Object[] { k.optString("t", ""), strings(k.optJSONArray("c")), strings(k.optJSONArray("l")) });
        }
        if (style != null) apply(style);
        showKeys();
    }
    private static List<String> strings(JSONArray a) {
        List<String> out = new ArrayList<>();
        if (a != null) for (int i = 0; i < a.length(); i++) out.add(a.optString(i, ""));
        return out;
    }

    // Each layer that's on, under the trails, in order; one whose address changed (a new version) is put back fresh.
    private void apply(Style style) {
        Map<String, String> want = new LinkedHashMap<>();
        for (Item it : items) want.putIfAbsent(it.sourceId(), it.url());
        for (Iterator<Map.Entry<String, String>> i = onMap.entrySet().iterator(); i.hasNext(); ) {
            Map.Entry<String, String> e = i.next();
            if (e.getValue().equals(want.get(e.getKey()))) continue;
            Layer l = style.getLayer(e.getKey());
            if (l != null) style.removeLayer(l);
            Source s = style.getSource(e.getKey());
            if (s != null) style.removeSource(s);
            i.remove();
        }
        for (int n = 0; n < items.size(); n++) {
            Item it = items.get(n);
            if (onMap.containsKey(it.sourceId()) || style.getSource(it.sourceId()) != null) continue;
            TileSet set = new TileSet("2.2.0", it.url());
            set.setMinZoom((float) it.min);
            set.setMaxZoom((float) it.max);
            if (!it.credit.isEmpty()) set.setAttribution(it.credit);
            style.addSource(new RasterSource(it.sourceId(), set, 256));
            RasterLayer layer = new RasterLayer(it.sourceId(), it.sourceId());
            layer.setProperties(PropertyFactory.rasterOpacity((float) it.op), PropertyFactory.rasterFadeDuration(0f));
            // Under the first of ours above it, else under Hunting's, else under the trails.
            String above = null;
            for (int m = n + 1; m < items.size() && above == null; m++) {
                String sid = items.get(m).sourceId();
                if (onMap.containsKey(sid) && style.getLayer(sid) != null) above = sid;
            }
            if (above == null) for (String c : CEILING) if (above == null && style.getLayer(c) != null) above = c;
            if (above == null && screen != null && style.getLayer(screen.trailsBottomLayer()) != null) above = screen.trailsBottomLayer();
            if (above != null) style.addLayerBelow(layer, above); else style.addLayer(layer);
            onMap.put(it.sourceId(), it.url());
        }
    }

    // ---------- the colour keys, top left (as on the web map), under the radar and smoke captions ----------
    private void showKeys() {
        if (screen == null) return;
        if (keyBox == null) {
            keyBox = new LinearLayout(screen.getContext());
            keyBox.setOrientation(LinearLayout.VERTICAL);
            keyBox.setClickable(false);
            LinearLayout.LayoutParams at = new LinearLayout.LayoutParams(screen.dp(230), LinearLayout.LayoutParams.WRAP_CONTENT);
            at.bottomMargin = screen.dp(6);
            screen.infoColumn().addView(keyBox, 0, at);   // over the avalanche card (NativeAvalanche)
        }
        keyBox.removeAllViews();
        for (Object[] k : keys) {
            @SuppressWarnings("unchecked") List<String> c = (List<String>) k[1];
            @SuppressWarnings("unchecked") List<String> l = (List<String>) k[2];
            if (c.isEmpty()) continue;
            LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(LinearLayout.LayoutParams.WRAP_CONTENT, LinearLayout.LayoutParams.WRAP_CONTENT);
            if (keyBox.getChildCount() > 0) lp.topMargin = screen.dp(4);
            keyBox.addView(bar((String) k[0], c, l), lp);
        }
        keyBox.setVisibility(keyBox.getChildCount() == 0 ? View.GONE : View.VISIBLE);
    }
    private View bar(String title, List<String> colours, List<String> labels) {
        LinearLayout box = new LinearLayout(screen.getContext());
        box.setOrientation(LinearLayout.VERTICAL);
        GradientDrawable bg = new GradientDrawable();
        bg.setColor(Color.argb(240, 255, 255, 255));
        bg.setCornerRadius(screen.dp(8));
        box.setBackground(bg);
        box.setPadding(screen.dp(8), screen.dp(5), screen.dp(8), screen.dp(5));
        TextView t = new TextView(screen.getContext());
        t.setText(title);
        t.setTextSize(TypedValue.COMPLEX_UNIT_SP, 11);
        t.setTypeface(Typeface.create(Typeface.DEFAULT, Typeface.BOLD));
        t.setTextColor(Color.rgb(28, 36, 51));
        t.setMaxLines(2);
        box.addView(t);
        LinearLayout cells = new LinearLayout(screen.getContext());
        cells.setOrientation(LinearLayout.HORIZONTAL);
        cells.setMinimumWidth(screen.dp(Math.min(colours.size(), 8) * 24));
        for (int i = 0; i < colours.size(); i++) {
            LinearLayout cell = new LinearLayout(screen.getContext());
            cell.setOrientation(LinearLayout.VERTICAL);
            View sw = new View(screen.getContext());
            GradientDrawable sc = new GradientDrawable();
            sc.setColor(colour(colours.get(i), Color.GRAY));
            sc.setCornerRadius(screen.dp(2));
            sw.setBackground(sc);
            cell.addView(sw, new LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, screen.dp(8)));
            TextView l = new TextView(screen.getContext());
            l.setText(i < labels.size() ? labels.get(i) : "");
            l.setTextSize(TypedValue.COMPLEX_UNIT_SP, 9);
            l.setTextColor(Color.rgb(92, 102, 117));
            l.setGravity(Gravity.CENTER_HORIZONTAL);
            l.setSingleLine(true);
            cell.addView(l);
            LinearLayout.LayoutParams cp = new LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1);
            if (i > 0) cp.setMarginStart(screen.dp(2));
            cells.addView(cell, cp);
        }
        LinearLayout.LayoutParams cl = new LinearLayout.LayoutParams(LinearLayout.LayoutParams.WRAP_CONTENT, LinearLayout.LayoutParams.WRAP_CONTENT);
        cl.topMargin = screen.dp(3);
        box.addView(cells, cl);
        return box;
    }
    // "#rgb", "#rrggbb", "rgb(r, g, b)", "rgba(r, g, b, a)": the colours the page's keys use.
    static int colour(String s, int fallback) {
        String v = s == null ? "" : s.trim();
        try {
            if (v.startsWith("#")) {
                String h = v.substring(1);
                if (h.length() == 3) h = "" + h.charAt(0) + h.charAt(0) + h.charAt(1) + h.charAt(1) + h.charAt(2) + h.charAt(2);
                if (h.length() != 6) return fallback;
                return Color.rgb(Integer.parseInt(h.substring(0, 2), 16), Integer.parseInt(h.substring(2, 4), 16), Integer.parseInt(h.substring(4, 6), 16));
            }
            int a = v.indexOf('('), b = v.lastIndexOf(')');
            if (!v.startsWith("rgb") || a < 0 || b < a) return fallback;
            String[] p = v.substring(a + 1, b).split(",");
            if (p.length < 3) return fallback;
            int alpha = p.length > 3 ? (int) Math.round(Double.parseDouble(p[3].trim()) * 255) : 255;
            return Color.argb(alpha, (int) Math.round(Double.parseDouble(p[0].trim())), (int) Math.round(Double.parseDouble(p[1].trim())),
                (int) Math.round(Double.parseDouble(p[2].trim())));
        } catch (Exception e) { return fallback; }
    }

    // ---------- the pictures: MapLibre's download threads ask, the page paints ----------
    // "/<layer id>/<z>/<x>/<y>.png?v=<version>&k=<1: keep a day>". A download thread waits for the page's answer (30 s
    // at most); a picture comes back as a PNG, nothing there as a real "not found" (MapLibre doesn't retry that and
    // shows the ground under it), and one that couldn't be painted now as an error, so MapLibre asks again later.
    static final class Tiles {
        static volatile TrailMapScreen screen;   // set and used on the main thread
        private static final Handler MAIN = new Handler(Looper.getMainLooper());
        private static final ExecutorService READER = Executors.newSingleThreadExecutor();
        private static final AtomicInteger next = new AtomicInteger();
        private static final Map<Integer, Waiting> waiting = new ConcurrentHashMap<>();
        private static boolean started = false;
        private static final MediaType PNG = MediaType.get("image/png");

        private static final class Waiting {
            final CountDownLatch done = new CountDownLatch(1);
            volatile byte[] picture;
            volatile boolean nothing, failed;
        }

        static synchronized void start() {
            if (started) return;
            started = true;
            TileRewriter.serve(HOST, Tiles::serve);
        }

        private static Response serve(Interceptor.Chain chain) throws IOException {
            List<String> p = chain.request().url().pathSegments();
            int z, x, y;
            try {
                if (p.size() != 4) throw new NumberFormatException();
                z = Integer.parseInt(p.get(1)); x = Integer.parseInt(p.get(2)); y = Integer.parseInt(p.get(3).replace(".png", ""));
            } catch (NumberFormatException e) { return reply(chain, null, false); }
            String id = p.get(0);
            int r = next.incrementAndGet();
            Waiting w = new Waiting();
            waiting.put(r, w);
            MAIN.post(() -> {
                TrailMapScreen s = screen;
                if (s == null || s.isLeft()) { finish(r, null, false); return; }
                JSObject o = new JSObject();
                o.put("r", r); o.put("id", id); o.put("z", z); o.put("x", x); o.put("y", y);
                s.send("groundTile", o);
            });
            try {
                // Checked every quarter second: MapLibre may stop wanting it (scrolled away, or the map closed).
                long end = System.currentTimeMillis() + 30000;
                while (!w.done.await(250, TimeUnit.MILLISECONDS)) {
                    if (chain.call().isCanceled() || System.currentTimeMillis() > end) {
                        if (waiting.remove(r) != null) MAIN.post(() -> {
                            TrailMapScreen s = screen;
                            JSObject o = new JSObject();
                            o.put("r", r);
                            if (s != null) s.send("groundStop", o);
                        });
                        throw new IOException("ground picture not painted");
                    }
                }
            } catch (InterruptedException e) {
                waiting.remove(r);
                throw new IOException("ground picture stopped");
            }
            // Couldn't be painted now (no signal, no answer): an error MapLibre counts as a connection problem, so it asks
            // again later (and right away when the signal comes back). Other errors are never asked again.
            if (w.failed || (w.picture == null && !w.nothing)) throw new java.net.SocketException("ground picture not painted now");
            return reply(chain, w.picture, "1".equals(chain.request().url().queryParameter("k")));
        }

        private static Response reply(Interceptor.Chain chain, byte[] png, boolean keep) {
            Response.Builder b = new Response.Builder().request(chain.request()).protocol(Protocol.HTTP_1_1);
            if (png == null) return b.code(404).message("Not Found").header("Cache-Control", "no-cache").body(ResponseBody.create(new byte[0], PNG)).build();
            return b.code(200).message("OK").header("Content-Type", "image/png")
                .header("Cache-Control", keep ? "max-age=86400" : "no-cache").body(ResponseBody.create(png, PNG)).build();
        }

        // "T|<request>|<base64 PNG>" from the page; read off the main thread.
        static void answer(String text) {
            READER.execute(() -> {
                String[] parts = text.split("\\|", 3);
                if (parts.length != 3) return;
                int r;
                try { r = Integer.parseInt(parts[1]); } catch (NumberFormatException e) { return; }
                String body = parts[2];
                if (body.isEmpty()) { finish(r, null, true); return; }
                byte[] png = null;
                if (!"!".equals(body)) { try { png = Base64.decode(body, Base64.DEFAULT); } catch (IllegalArgumentException ignored) {} }
                finish(r, png, false);
            });
        }
        private static void finish(int r, byte[] png, boolean nothing) {
            Waiting w = waiting.remove(r);
            if (w == null) return;
            w.picture = png;
            w.nothing = nothing;
            w.failed = png == null && !nothing;
            w.done.countDown();
        }
    }
}
