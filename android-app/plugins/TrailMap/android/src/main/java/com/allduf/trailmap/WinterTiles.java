package com.allduf.trailmap;

import android.content.Context;
import android.os.Handler;
import android.os.Looper;
import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import java.util.function.Consumer;
import okhttp3.HttpUrl;
import okhttp3.OkHttpClient;
import okhttp3.Request;
import okhttp3.Response;
import org.json.JSONArray;
import org.json.JSONObject;

// Skiing's Winter map in native 3D, the same as the iPhone's (WinterTiles.swift; alex 2026-11-20: "can we have the
// Winter map like that?"): the same pictures as the web 3D map's Winter, straight from their sites. Bottom to top: last
// winter's far-view photos of all of Canada (zooms 3-10), last winter's 10 m photos around ski spots (zooms 6-14) and the
// AI-sharpened ones (zooms 11-15). The photos are spread over many sites by zoom-11 square, worked out from the square
// (as tfWinterShard and sharpBase in map3d.js). MapLibre fills {z}/{x}/{y} into one address only, so the style asks a
// made-up address (HOST) and this object, through TileRewriter, turns it into the real one. Lists of squares (~55 KB)
// are loaded once, before the Winter style is shown. Also the late-summer mountains over Satellite in the Sea to Sky.
// Keep the sites, revisions and sums in step with WinterTiles.swift and map3d.js.
final class WinterTiles {
    static final String HOST = "winter.trailfinder.invalid";
    static final String CREDIT = "Winter: Copernicus Sentinel-2 data 2025-2026 (ESA), via AWS Open Data";
    // No photo there: a real "not found" (tiny, and MapLibre doesn't ask again), not the made-up address.
    static final String NONE = "https://trailfinder-w1-0.pages.dev/none.webp";
    private static final String[] LISTS = {
        "https://trailfinder-w1-0.pages.dev/trail-finder-winter/blocks.json",
        "https://trailfinder-w2-0.pages.dev/trail-finder-winter2/blocks.json",
        "https://trailfinder-sharp-0.pages.dev/trail-finder-winter2/sharp.json",
        "https://trailfinderapp.ca/data/sharp-canada.json"
    };
    private static final String SHARP_REV = "?r=3";    // SHARP_REV in map3d.js (and WinterTiles.swift sharpRev)
    private static final String SUMMER_REV = "?r=1";   // SUMMER_REV in map3d.js

    static final WinterTiles shared = new WinterTiles();

    private final Object lock = new Object();
    private final Map<Integer, Integer> have = new HashMap<>();      // zoom-11 square (x * 4096 + y) -> 0 (first site) or 1
    private final Map<String, int[]> some = new HashMap<>();         // zoom 6-10 tile "z/x/y" -> squares under it on each site
    private Set<Integer> sharpWest = new HashSet<>();                // sharpened squares on trailfinder-sharp-0..9
    private Set<Integer> sharpCa = new HashSet<>();                  // sharpened squares on trailfinder-sharpca-0..47
    private Set<Integer> summer;                                     // late-summer squares (null until known)
    private boolean loaded = false, stale = false, installed = false, summerAsked = false;
    private final List<Consumer<Boolean>> waiting = new ArrayList<>();
    private final ExecutorService pool = Executors.newFixedThreadPool(4);
    private final Handler main = new Handler(Looper.getMainLooper());
    private final OkHttpClient http = new OkHttpClient.Builder().callTimeout(30, TimeUnit.SECONDS).build();
    private File dir;

    boolean ready() { synchronized (lock) { return loaded; } }
    // The lists came from their sites just now (not the copy kept for no signal, which may lack newer squares).
    boolean fresh() { synchronized (lock) { return loaded && !stale; } }

    // The address rewriter: set once a 3D screen opens (the late-summer mountains need it too, no lists).
    void install(Context ctx) {
        synchronized (lock) {
            if (dir == null) { dir = new File(ctx.getFilesDir(), "trail-map"); dir.mkdirs(); }
            if (!installed) { installed = true; TileRewriter.add(HOST, this::rewrite); }
        }
        loadSummer();
    }

    static JSONArray summerBounds() { return BaseStyles.a(-123.58, 49.6, -122.17, 50.74); }

    // The Winter style's sources and layers (BaseStyles adds the heights, roads and names): bottom to top, Esri's photo
    // far out only, last winter's far-view photos of Canada, the 10 m Winter photos, the sharpened ones.
    static JSONObject sources(String esri, String credit) {
        JSONArray canada = BaseStyles.a(-141.1, 41.6, -52, 70);
        return BaseStyles.o(
            "esri", BaseStyles.o("type", "raster", "tileSize", 256, "maxzoom", 12, "attribution", credit, "tiles", BaseStyles.a(esri)),
            "wide", BaseStyles.o("type", "raster", "tileSize", 256, "minzoom", 3, "maxzoom", 10, "bounds", canada, "tiles", at("wide"), "attribution", CREDIT),
            "winter", BaseStyles.o("type", "raster", "tileSize", 256, "minzoom", 6, "maxzoom", 14, "bounds", BaseStyles.a(-141, 24, 146.5, 70), "tiles", at("w")),
            "sharp", BaseStyles.o("type", "raster", "tileSize", 256, "minzoom", 11, "maxzoom", 15, "bounds", BaseStyles.a(-141.1, 41.6, -52, 70), "tiles", at("s"))
        );
    }
    static JSONArray layers() {
        JSONArray out = BaseStyles.a(BaseStyles.o("id", "background", "type", "background", "paint", BaseStyles.o("background-color", "#e8ebee")));
        for (String id : new String[] { "esri", "wide", "winter", "sharp" }) out.put(BaseStyles.o("id", id, "type", "raster", "source", id));
        return out;
    }
    private static JSONArray at(String kind) { return BaseStyles.a("https://" + HOST + "/" + kind + "/{z}/{x}/{y}"); }

    private String get(String url) {
        try (Response r = http.newCall(new Request.Builder().url(url).build()).execute()) {
            if (r.code() != 200 || r.body() == null) return null;
            return r.body().string();
        } catch (Exception e) { return null; }
    }
    private static List<int[]> pairs(String text) {
        List<int[]> out = new ArrayList<>();
        try {
            JSONArray a = new JSONArray(text);
            for (int i = 0; i < a.length(); i++) {
                JSONArray p = a.optJSONArray(i);
                if (p != null && p.length() == 2) out.add(new int[] { p.getInt(0), p.getInt(1) });
            }
        } catch (Exception e) { return null; }
        return out;
    }

    // summer.json, the late-summer squares (zoom 11), so tiles elsewhere in the box aren't asked for.
    private void loadSummer() {
        synchronized (lock) { if (summerAsked) return; summerAsked = true; }
        pool.execute(() -> {
            String t = get("https://trailfinder-summer.pages.dev/trail-finder-summer/summer.json");
            List<int[]> list = t == null ? null : pairs(t);
            synchronized (lock) {
                if (list == null) { summerAsked = false; return; }   // asked again next time a 3D screen opens
                Set<Integer> s = new HashSet<>();
                for (int[] p : list) s.add(p[0] * 4096 + p[1]);
                summer = s;
            }
        });
    }

    // done(true) once the lists are in (on the main thread); done(false) when they couldn't come (offline, no copy).
    void load(Context ctx, Consumer<Boolean> done) {
        install(ctx);
        synchronized (lock) {
            if (loaded && !stale) { main.post(() -> done.accept(true)); return; }
            waiting.add(done);
            if (waiting.size() > 1) return;
        }
        pool.execute(() -> {
            List<List<int[]>> got = new ArrayList<>();
            boolean[] kept = { false };
            CountDownLatch all = new CountDownLatch(LISTS.length);
            for (int i = 0; i < LISTS.length; i++) got.add(null);
            for (int i = 0; i < LISTS.length; i++) {
                final int n = i;
                new Thread(() -> {
                    String t = get(LISTS[n]);
                    List<int[]> list = t == null ? null : pairs(t);
                    File f = kept(n);
                    if (list != null && f != null) {
                        try (FileOutputStream out = new FileOutputStream(f)) { out.write(t.getBytes(StandardCharsets.UTF_8)); } catch (IOException ignored) {}
                    }
                    // No signal: the copy from the last time, so Winter still opens.
                    if (list == null && f != null && f.exists()) {
                        try { list = pairs(new String(Files.readAllBytes(f.toPath()), StandardCharsets.UTF_8)); } catch (IOException ignored) {}
                        if (list != null) synchronized (kept) { kept[0] = true; }
                    }
                    synchronized (got) { got.set(n, list); }
                    all.countDown();
                }).start();
            }
            try { all.await(60, TimeUnit.SECONDS); } catch (InterruptedException ignored) {}
            List<Consumer<Boolean>> calls;
            boolean ok;
            synchronized (got) { ok = got.get(0) != null || got.get(1) != null; }
            synchronized (lock) {
                if (ok) {
                    have.clear();
                    some.clear();
                    for (int site = 0; site < 2; site++) {
                        List<int[]> list;
                        synchronized (got) { list = got.get(site); }
                        if (list == null) continue;
                        for (int[] p : list) {
                            int k = p[0] * 4096 + p[1];
                            if (have.containsKey(k)) continue;
                            have.put(k, site);
                            for (int z = 6; z < 11; z++) {
                                String t = z + "/" + (p[0] >> (11 - z)) + "/" + (p[1] >> (11 - z));
                                int[] c = some.get(t);
                                if (c == null) { c = new int[2]; some.put(t, c); }
                                c[site]++;
                            }
                        }
                    }
                    Set<Integer> west = new HashSet<>(), ca = new HashSet<>();
                    List<int[]> w, c;
                    synchronized (got) { w = got.get(2); c = got.get(3); }
                    if (w != null) for (int[] p : w) west.add(p[0] * 4096 + p[1]);
                    if (c != null) for (int[] p : c) { int k = p[0] * 4096 + p[1]; if (!west.contains(k)) ca.add(k); }
                    sharpWest = west;
                    sharpCa = ca;
                    loaded = true;
                    synchronized (kept) { stale = kept[0]; }
                }
                calls = new ArrayList<>(waiting);
                waiting.clear();
            }
            final boolean res = ok;
            main.post(() -> { for (Consumer<Boolean> f : calls) f.accept(res); });
        });
    }

    private File kept(int i) {
        synchronized (lock) { return dir == null ? null : new File(dir, "winter-list-" + i + ".json"); }
    }

    // The rewriter (TileRewriter, off the main thread, for every download) for our made-up address; null = no photo.
    private String rewrite(HttpUrl url) {
        List<String> p = url.pathSegments();
        if (p.size() != 4) return null;
        int z, x, y;
        try { z = Integer.parseInt(p.get(1)); x = Integer.parseInt(p.get(2)); y = Integer.parseInt(p.get(3)); } catch (NumberFormatException e) { return null; }
        return real(p.get(0), z, x, y);
    }

    private String real(String kind, int z, int x, int y) {
        int bx = z >= 11 ? x >> (z - 11) : 0, by = z >= 11 ? y >> (z - 11) : 0, sq = bx * 4096 + by;
        switch (kind) {
            case "wide": {   // wideSite in map3d.js
                int k = z < 7 ? 0 : ((x >> (z - 7)) * 31 + (y >> (z - 7))) % 3;
                return "https://trailfinder-wide-" + k + ".pages.dev/trail-finder-wide/" + z + "/" + x + "/" + y + ".webp";
            }
            case "w": {      // winterSite + tfWinterShard in map3d.js
                boolean two;
                synchronized (lock) {
                    if (z >= 11) {
                        Integer s = have.get(sq);
                        if (s == null) return null;
                        two = s == 1;
                    } else {
                        int[] n = some.get(z + "/" + x + "/" + y);
                        if (n == null) return null;
                        two = n[1] > n[0];
                    }
                }
                int k = z < 11 ? 0 : (bx * 31 + by) % (two ? 4 : 14);
                String site = two ? "trailfinder-w2-" + k + ".pages.dev/trail-finder-winter2" : "trailfinder-w1-" + k + ".pages.dev/trail-finder-winter";
                return "https://" + site + "/" + z + "/" + x + "/" + y + ".webp";
            }
            case "s": {      // sharpBase in map3d.js
                if (z < 11 || z > 15) return null;
                String site;
                synchronized (lock) {
                    if (sharpCa.contains(sq)) site = "trailfinder-sharpca-" + ((bx * 31 + by) % 48);
                    else if (sharpWest.contains(sq)) site = "trailfinder-sharp-" + ((bx * 31 + by) % 10);
                    else return null;
                }
                return "https://" + site + ".pages.dev/trail-finder-winter2/" + z + "/" + x + "/" + y + ".webp" + SHARP_REV;
            }
            case "sum": {
                if (z < 11 || z > 15) return null;
                synchronized (lock) { if (summer != null && !summer.contains(sq)) return null; }
                String site = z == 15 ? "trailfinder-summer-15" : "trailfinder-summer";
                return "https://" + site + ".pages.dev/trail-finder-summer/" + z + "/" + x + "/" + y + ".webp" + SUMMER_REV;
            }
            default: return null;
        }
    }
}
