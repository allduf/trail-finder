package com.allduf.trailmap;

import android.content.Context;
import android.os.Handler;
import android.os.Looper;
import com.getcapacitor.JSObject;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.TimeUnit;
import java.util.function.Consumer;
import okhttp3.OkHttpClient;
import okhttp3.Request;
import okhttp3.Response;
import org.json.JSONArray;
import org.json.JSONObject;
import org.maplibre.android.MapLibre;
import org.maplibre.android.geometry.LatLngBounds;
import org.maplibre.android.offline.OfflineGeometryRegionDefinition;
import org.maplibre.android.offline.OfflineManager;
import org.maplibre.android.offline.OfflineRegion;
import org.maplibre.android.offline.OfflineRegionDefinition;
import org.maplibre.android.offline.OfflineRegionError;
import org.maplibre.android.offline.OfflineRegionStatus;
import org.maplibre.android.offline.OfflineTilePyramidRegionDefinition;
import org.maplibre.geojson.MultiPolygon;
import org.maplibre.geojson.Point;

// The phone's own copy of each area saved with "3D map too", the Android side of OfflinePacks in NativeOffline.swift:
// the page keeps its saved files where only the page can read them, so the native map keeps its own (the same map,
// heights and Winter photos) as MapLibre offline regions. Each region's metadata says which area and part it is:
// { tf: "offline", id, part: "main" or "r6"..."r10", boxes, ski, sharp, tmpl }. The page sends the whole list each time
// (TrailMap.offline from native-offline.js, only on alex's devices for now), and this makes the regions match it: new
// areas are added, finished ones left alone, unfinished ones carry on, deleted ones removed.
final class OfflinePacks {
    static final OfflinePacks shared = new OfflinePacks();
    private static final String TILE_JSON = "https://tiles.openfreemap.org/planet";
    // A region's style is made here, not downloaded: it's put in MapLibre's store under this made-up address first.
    private static final String STYLE_BASE = "https://offline.trailfinder.invalid/";

    private static final class Area {
        final String id; final List<double[]> boxes; final boolean ski, sharp;
        Area(String id, List<double[]> boxes, boolean ski, boolean sharp) { this.id = id; this.boxes = boxes; this.ski = ski; this.sharp = sharp; }
    }
    static final class Ours {
        final OfflineRegion region; final JSONObject ctx;
        Ours(OfflineRegion region, JSONObject ctx) { this.region = region; this.ctx = ctx; }
    }

    private final Handler main = new Handler(Looper.getMainLooper());
    private final OkHttpClient http = new OkHttpClient.Builder().callTimeout(20, TimeUnit.SECONDS).build();
    private Context ctx;
    private List<Ours> ours;                                   // null until MapLibre has listed them
    private final List<Consumer<List<Ours>>> waiting = new ArrayList<>();
    private final Map<Long, OfflineRegionStatus> statuses = new HashMap<>();
    private final Set<Long> observed = new HashSet<>();
    private final Set<String> creating = new HashSet<>();
    private Set<String> wanted = new HashSet<>();              // the areas the page last asked for
    private boolean notifyQueued = false;
    Consumer<JSObject> onChange;

    // Main thread only, from here on.
    private void init(Context c) {
        if (ctx != null) return;
        ctx = c.getApplicationContext();
        MapLibre.getInstance(ctx);   // before MapLibre's offline store or download client is touched
    }

    // The list of MapLibre's regions (ours only), read once.
    void withRegions(Context c, Consumer<List<Ours>> fn) {
        init(c);
        if (ours != null) { fn.accept(ours); return; }
        waiting.add(fn);
        if (waiting.size() > 1) return;
        OfflineManager.getInstance(ctx).listOfflineRegions(new OfflineManager.ListOfflineRegionsCallback() {
            @Override public void onList(OfflineRegion[] regions) {
                List<Ours> got = new ArrayList<>();
                if (regions != null) for (OfflineRegion r : regions) {
                    JSONObject o = meta(r);
                    if (o != null) got.add(new Ours(r, o));
                }
                done(got);
            }
            @Override public void onError(String error) { done(new ArrayList<>()); }
            private void done(List<Ours> got) {
                if (ours == null) ours = got;
                List<Consumer<List<Ours>>> w = new ArrayList<>(waiting);
                waiting.clear();
                for (Consumer<List<Ours>> f : w) f.accept(ours);
            }
        });
    }
    // Ready to use (listed already): for drawing with no signal.
    boolean listed() { return ours != null; }

    private static JSONObject meta(OfflineRegion r) {
        try {
            JSONObject o = new JSONObject(new String(r.getMetadata(), StandardCharsets.UTF_8));
            return "offline".equals(o.optString("tf")) ? o : null;
        } catch (Exception e) { return null; }
    }

    // The OpenFreeMap tile addresses the saved copies use (for the no-signal ground).
    List<String> savedTemplates() {
        List<String> seen = new ArrayList<>();
        if (ours != null) for (Ours o : ours) {
            String t = o.ctx.optString("tmpl", "");
            if (!t.isEmpty() && !seen.contains(t)) seen.add(t);
        }
        return seen;
    }

    void sync(Context c, JSONArray list, Consumer<JSObject> done) {
        List<Area> want = new ArrayList<>();
        if (list != null) for (int i = 0; i < list.length(); i++) {
            JSONObject a = list.optJSONObject(i);
            if (a == null || a.optString("id", "").isEmpty()) continue;
            List<double[]> boxes = boxes(a.optJSONArray("boxes"));
            if (boxes.isEmpty()) { double[] b = box(a.optJSONArray("box")); if (b != null) boxes.add(b); }
            if (!boxes.isEmpty()) want.add(new Area(a.optString("id"), boxes, a.optBoolean("ski", false), a.optBoolean("sharp", false)));
        }
        withRegions(c, (all) -> {
            Map<String, Area> byId = new LinkedHashMap<>();
            for (Area a : want) byId.putIfAbsent(a.id, a);
            wanted = new HashSet<>(byId.keySet());
            Map<String, Set<String>> have = new HashMap<>();
            for (Ours o : new ArrayList<>(all)) {
                String id = o.ctx.optString("id", "");
                Area a = byId.get(id);
                boolean same = a != null && sameBoxes(boxes(o.ctx.optJSONArray("boxes")), a.boxes)
                    && o.ctx.optBoolean("ski", false) == a.ski && o.ctx.optBoolean("sharp", false) == a.sharp;
                if (!same) { remove(o); continue; }
                have.computeIfAbsent(id, k -> new HashSet<>()).add(o.ctx.optString("part", ""));
                watch(o.region);
                o.region.getStatus(new OfflineRegion.OfflineRegionStatusCallback() {
                    @Override public void onStatus(OfflineRegionStatus s) {
                        statuses.put(o.region.getId(), s);
                        if (!s.isComplete() && s.getDownloadState() != OfflineRegion.STATE_ACTIVE) resume(o);
                        changed();
                    }
                    @Override public void onError(String error) {}
                });
            }
            for (Area a : want) {
                List<String> parts = new ArrayList<>();
                parts.add("main");
                if (a.ski) for (int z = 6; z <= 10; z++) parts.add("r" + z);
                List<String> missing = new ArrayList<>();
                Set<String> h = have.containsKey(a.id) ? have.get(a.id) : new HashSet<>();
                for (String p : parts) if (!h.contains(p) && !creating.contains(a.id + "/" + p)) missing.add(p);
                if (!missing.isEmpty()) create(a, missing);
            }
            done.accept(status());
        });
    }

    private void remove(Ours o) {
        ours.remove(o);
        statuses.remove(o.region.getId());
        o.region.setDownloadState(OfflineRegion.STATE_INACTIVE);
        o.region.delete(new OfflineRegion.OfflineRegionDeleteCallback() {
            @Override public void onDelete() { changed(); }
            @Override public void onError(String error) {}
        });
    }

    private void watch(OfflineRegion r) {
        if (!observed.add(r.getId())) return;
        r.setObserver(new OfflineRegion.OfflineRegionObserver() {
            @Override public void onStatusChanged(OfflineRegionStatus s) {
                statuses.put(r.getId(), s);
                if (s.isComplete()) r.setDownloadState(OfflineRegion.STATE_INACTIVE);
                changed();
            }
            @Override public void onError(OfflineRegionError e) { changed(); }
            @Override public void mapboxTileCountLimitExceeded(long limit) { changed(); }
        });
    }

    private void resume(Ours o) {
        JSONObject style = style(o.ctx);
        if (style == null) return;
        Runnable go = () -> {
            putStyle(style, o.region.getDefinition().getStyleURL());
            main.postDelayed(() -> { if (ours != null && ours.contains(o)) o.region.setDownloadState(OfflineRegion.STATE_ACTIVE); }, 500);
        };
        // Winter photo addresses need WinterTiles' lists (it turns the made-up ones into real ones), fresh from their sites.
        if (o.ctx.optBoolean("ski", false)) WinterTiles.shared.load(ctx, (ok) -> { if (ok && WinterTiles.shared.fresh()) go.run(); });
        else go.run();
    }

    private void create(Area a, List<String> parts) {
        for (String p : parts) creating.add(a.id + "/" + p);
        Runnable finish = () -> { for (String p : parts) creating.remove(a.id + "/" + p); };
        template((tmpl) -> {
            if (tmpl == null) { finish.run(); return; }   // no signal: the next sync tries again
            Runnable go = () -> {
                for (String part : parts) {
                    String key = a.id + "/" + part;
                    JSONObject c = new JSONObject();
                    try {
                        JSONArray bs = new JSONArray();
                        for (double[] b : a.boxes) bs.put(new JSONArray(new double[] { b[0], b[1], b[2], b[3] }));
                        c.put("tf", "offline").put("id", a.id).put("part", part).put("boxes", bs).put("ski", a.ski).put("sharp", a.sharp).put("tmpl", tmpl);
                    } catch (Exception e) { creating.remove(key); continue; }
                    JSONObject style = style(c);
                    String url = STYLE_BASE + a.id + "-" + part + ".json";
                    OfflineRegionDefinition def = region(a, part, url);
                    if (style == null || def == null) { creating.remove(key); continue; }
                    putStyle(style, url);
                    main.postDelayed(() -> OfflineManager.getInstance(ctx).createOfflineRegion(def, c.toString().getBytes(StandardCharsets.UTF_8),
                        new OfflineManager.CreateOfflineRegionCallback() {
                            @Override public void onCreate(OfflineRegion r) {
                                creating.remove(key);
                                Ours o = new Ours(r, c);
                                if (ours != null) ours.add(o);
                                // Deleted on the page while this was being set up: no copy for it.
                                if (!wanted.contains(a.id)) { remove(o); return; }
                                watch(r);
                                r.setDownloadState(OfflineRegion.STATE_ACTIVE);
                                changed();
                            }
                            @Override public void onError(String error) { creating.remove(key); }
                        }), 500);
                }
            };
            if (!a.ski) { go.run(); return; }
            // Winter photo addresses need WinterTiles' lists, fresh from their sites (not the copy kept for no signal,
            // which may lack newer squares).
            WinterTiles.shared.load(ctx, (ok) -> { if (ok && WinterTiles.shared.fresh()) go.run(); else finish.run(); });
        });
    }

    // The pack's own style, put in MapLibre's store just before it's needed (the store may let an old copy go).
    private void putStyle(JSONObject style, String url) {
        long now = System.currentTimeMillis() / 1000;
        OfflineManager.getInstance(ctx).putResourceWithUrl(url, style.toString().getBytes(StandardCharsets.UTF_8), now, now + 100L * 365 * 86400, null, false);
    }

    // The newest OpenFreeMap tile address (from its TileJSON), or null with no signal. Answers on the main thread.
    private void template(Consumer<String> done) {
        new Thread(() -> {
            String t = null;
            try (Response r = http.newCall(new Request.Builder().url(TILE_JSON).build()).execute()) {
                if (r.code() == 200 && r.body() != null) {
                    JSONArray tiles = new JSONObject(r.body().string()).optJSONArray("tiles");
                    if (tiles != null && tiles.length() > 0) t = tiles.optString(0, null);
                }
            } catch (Exception ignored) {}
            final String ft = t;
            main.post(() -> done.accept(ft));
        }).start();
    }

    // What one part saves. main: the map, the heights and (Skiing) the Winter photos over the area; rN: Skiing's
    // Winter photos at zoom N one tile wider all around (the blurry photo just past the square, as on the web).
    private static JSONObject style(JSONObject c) {
        String part = c.optString("part", "");
        boolean ski = c.optBoolean("ski", false);
        JSONObject winter = BaseStyles.o("type", "raster", "tileSize", 256, "minzoom", 6, "maxzoom", 14, "tiles", BaseStyles.a("https://" + WinterTiles.HOST + "/w/{z}/{x}/{y}"));
        JSONObject sources = new JSONObject();
        try {
            if ("main".equals(part)) {
                String t = c.optString("tmpl", "");
                if (t.isEmpty()) return null;
                sources.put("ofm", BaseStyles.o("type", "vector", "tiles", BaseStyles.a(t), "minzoom", 0, "maxzoom", 14));
                // Heights to zoom 12, as native 3D asks for them with signal too (BaseStyles "dem"): the copy matches.
                sources.put("dem", BaseStyles.o("type", "raster-dem", "encoding", "terrarium", "tileSize", 512, "maxzoom", 12, "tiles", BaseStyles.a(BaseStyles.DEM_TILES)));
                if (ski) sources.put("winter", winter);
                // Saved at full detail on the page (dz 15): the sharpened Winter photos too, as native 3D shows them online.
                if (ski && c.optBoolean("sharp", false))
                    sources.put("sharp", BaseStyles.o("type", "raster", "tileSize", 256, "minzoom", 11, "maxzoom", 15, "tiles", BaseStyles.a("https://" + WinterTiles.HOST + "/s/{z}/{x}/{y}")));
            } else if (ski) sources.put("winter", winter);
            else return null;
        } catch (Exception e) { return null; }
        JSONArray layers = BaseStyles.a(BaseStyles.o("id", "bg", "type", "background"));
        if (sources.has("ofm")) layers.put(BaseStyles.o("id", "water", "type", "fill", "source", "ofm", "source-layer", "water"));
        if (sources.has("dem")) layers.put(BaseStyles.o("id", "shade", "type", "hillshade", "source", "dem"));
        if (sources.has("winter")) layers.put(BaseStyles.o("id", "winter", "type", "raster", "source", "winter"));
        if (sources.has("sharp")) layers.put(BaseStyles.o("id", "sharp", "type", "raster", "source", "sharp"));
        return BaseStyles.o("version", 8, "sources", sources, "layers", layers);
    }

    // MapLibre zooms count 512 px tiles: the 256 px Winter photos at photo zoom N are map zoom N - 1.
    private OfflineRegionDefinition region(Area a, String part, String url) {
        float ratio = ctx.getResources().getDisplayMetrics().density;
        if ("main".equals(part)) {
            List<List<List<Point>>> polys = new ArrayList<>();
            for (double[] b : a.boxes) {
                List<Point> ring = new ArrayList<>();
                ring.add(Point.fromLngLat(b[1], b[0])); ring.add(Point.fromLngLat(b[3], b[0]));
                ring.add(Point.fromLngLat(b[3], b[2])); ring.add(Point.fromLngLat(b[1], b[2]));
                ring.add(Point.fromLngLat(b[1], b[0]));
                List<List<Point>> poly = new ArrayList<>();
                poly.add(ring);
                polys.add(poly);
            }
            return new OfflineGeometryRegionDefinition(url, MultiPolygon.fromLngLats(polys), 0, 14, ratio);
        }
        int z;
        try { z = Integer.parseInt(part.substring(1)); } catch (Exception e) { return null; }
        if (z < 6 || z > 10) return null;
        double s = 90, w = 180, n = -90, e = -180;
        for (double[] b : a.boxes) { s = Math.min(s, b[0]); w = Math.min(w, b[1]); n = Math.max(n, b[2]); e = Math.max(e, b[3]); }
        double zz = 1 << z;
        // One tile more on every side, a hair inside its edges so the next tile out isn't counted.
        double x0 = tx(w, zz) - 1, x1 = tx(e, zz) + 1, y0 = ty(n, zz) - 1, y1 = ty(s, zz) + 1, eps = 1e-6;
        LatLngBounds bounds = LatLngBounds.from(lat(y0, zz) - eps, lon(x1 + 1, zz) - eps, lat(y1 + 1, zz) + eps, lon(x0, zz) + eps);
        return new OfflineTilePyramidRegionDefinition(url, bounds, z - 1, z - 1, ratio);
    }
    private static double tx(double lon, double zz) { return Math.floor((lon + 180) / 360 * zz); }
    private static double ty(double lat, double zz) { double r = Math.toRadians(lat); return Math.floor((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2 * zz); }
    private static double lon(double x, double zz) { return x / zz * 360 - 180; }
    private static double lat(double y, double zz) { return Math.toDegrees(Math.atan(Math.sinh(Math.PI * (1 - 2 * y / zz)))); }

    static List<double[]> boxes(JSONArray v) {
        List<double[]> out = new ArrayList<>();
        if (v != null) for (int i = 0; i < v.length(); i++) { double[] b = box(v.optJSONArray(i)); if (b != null) out.add(b); }
        return out;
    }
    static double[] box(JSONArray b) {
        if (b == null || b.length() != 4) return null;
        double[] out = new double[4];
        for (int i = 0; i < 4; i++) { out[i] = b.optDouble(i); if (Double.isNaN(out[i])) return null; }
        return out;
    }
    private static boolean sameBoxes(List<double[]> a, List<double[]> b) {
        if (a.size() != b.size()) return false;
        for (int i = 0; i < a.size(); i++) for (int j = 0; j < 4; j++) if (Math.abs(a.get(i)[j] - b.get(i)[j]) >= 1e-6) return false;
        return true;
    }

    // Per area: { id: { pct, saved, active, bytes } }.
    JSObject status() {
        Map<String, long[]> by = new LinkedHashMap<>();   // id -> { expected, done, bytes, all complete (1/0), active (1/0) }
        Set<String> unknown = new HashSet<>();            // a region MapLibre hasn't reported on yet
        if (ours != null) for (Ours o : ours) {
            String id = o.ctx.optString("id", "");
            OfflineRegionStatus s = statuses.get(o.region.getId());
            if (s == null) { unknown.add(id); continue; }
            long[] v = by.computeIfAbsent(id, k -> new long[] { 0, 0, 0, 1, 0 });
            v[0] += Math.max(s.getRequiredResourceCount(), s.getCompletedResourceCount());
            v[1] += s.getCompletedResourceCount();
            v[2] += s.getCompletedResourceSize();
            if (!s.isComplete()) v[3] = 0;
            if (s.getDownloadState() == OfflineRegion.STATE_ACTIVE && !s.isComplete()) v[4] = 1;
        }
        JSObject areas = new JSObject();
        for (Map.Entry<String, long[]> e : by.entrySet()) {
            if (unknown.contains(e.getKey())) continue;
            long[] v = e.getValue();
            JSObject a = new JSObject();
            a.put("pct", v[0] > 0 ? (int) (100 * v[1] / v[0]) : 0);
            a.put("saved", v[3] == 1);
            a.put("active", v[4] == 1);
            a.put("bytes", (double) v[2]);
            areas.put(e.getKey(), a);
        }
        JSObject out = new JSObject();
        out.put("areas", areas);
        return out;
    }

    // At most once a second to the page.
    private void changed() {
        if (notifyQueued) return;
        notifyQueued = true;
        main.postDelayed(() -> {
            notifyQueued = false;
            Consumer<JSObject> f = onChange;
            if (f != null) f.accept(status());
        }, 1000);
    }
}
