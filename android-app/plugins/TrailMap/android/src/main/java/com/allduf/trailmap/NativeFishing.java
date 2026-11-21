package com.allduf.trailmap;

import static org.maplibre.android.style.expressions.Expression.raw;

import android.graphics.Color;
import android.os.Handler;
import android.os.Looper;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import org.json.JSONArray;
import org.json.JSONObject;
import org.maplibre.android.maps.Style;
import org.maplibre.android.style.expressions.Expression;
import org.maplibre.android.style.layers.CircleLayer;
import org.maplibre.android.style.layers.FillLayer;
import org.maplibre.android.style.layers.Layer;
import org.maplibre.android.style.layers.LineLayer;
import org.maplibre.android.style.layers.Property;
import org.maplibre.android.style.layers.PropertyFactory;
import org.maplibre.android.style.layers.RasterLayer;
import org.maplibre.android.style.layers.SymbolLayer;
import org.maplibre.android.style.sources.GeoJsonSource;
import org.maplibre.android.style.sources.RasterSource;
import org.maplibre.android.style.sources.Source;
import org.maplibre.android.style.sources.TileSet;
import org.maplibre.android.style.sources.VectorSource;

// Fishing in native 3D, the Android side of NativeFishing.swift. The page side is native-fishing.js, the data comes from
// fishing.js (tfFish.native3d). The fishing dots and the zone outlines come over with the trails (the screen's own dots
// and lines); these three draw the rest of what the web 3D map draws for Fishing, the same way (fishing.js sync3d and
// overlays3d):
//   "fish": zone, park and boating-zone fills and names, the picked spot, the water colours (OpenFreeMap), Crown land
//           (each province's own server; Quebec through its WMS with our colour, so nothing is repainted here) and
//           the lake depth pictures (Manitoba's tiles, DataBC's few BC lakes);
//   "fish-creeks" (Creeks below): creeks from further away (fishing.js farCreeks, the flat map reads them from zoom-13 tiles);
//   "fish-depth" (Depth below): lake depth lines and soundings (Ontario, Quebec, New Brunswick, from data/fishing/depth).
// Bottom to top as on the web: water colours, depth, Crown land, fills, under the trails; names and the spot on top.
final class NativeFishing implements NativeLayer {
    static final String EMPTY = "{\"type\":\"FeatureCollection\",\"features\":[]}";
    static final ExecutorService READER = Executors.newSingleThreadExecutor();
    static final Handler MAIN = new Handler(Looper.getMainLooper());

    // ---------- shared bits for the three ----------
    // Under the trails, and under the lowest layer whose id starts with one of `above` (the parts that go over it, so the
    // order stays the web's whichever of the three parts arrives or is rebuilt first).
    static void insert(Layer l, Style style, TrailMapScreen screen, List<String> above) {
        if (!above.isEmpty()) for (Layer s : style.getLayers()) {
            for (String a : above) if (s.getId().startsWith(a)) { style.addLayerBelow(l, s.getId()); return; }
        }
        String b = screen != null ? screen.trailsBottomLayer() : null;
        if (b != null && style.getLayer(b) != null) style.addLayerBelow(l, b); else style.addLayer(l);
    }
    // Bottom to top: water colours, far creeks, depth lines, BC depth pictures, Crown land, fills.
    static final List<String> OVER_WATER = Arrays.asList("fs-creek-far", "fs-mb-line", "fs-q-line", "fs-q-pt", "fs-bcd", "fs-cl-", "fs-fill");
    static final List<String> OVER_CREEKS = Arrays.asList("fs-lake", "fs-sea", "fs-mb-line", "fs-q-line", "fs-q-pt", "fs-bcd", "fs-cl-", "fs-fill");
    static final List<String> OVER_DEPTH = Arrays.asList("fs-bcd", "fs-cl-", "fs-fill");

    static SymbolLayer label(String id, String src) {
        SymbolLayer t = new SymbolLayer(id, src);
        t.setProperties(PropertyFactory.textFont(new String[] { "Noto Sans Bold" }), PropertyFactory.textHaloColor(Color.WHITE));
        return t;
    }
    static String shape(Object o) { return o instanceof JSONObject ? o.toString() : EMPTY; }
    static Style ready(TrailMapScreen screen) {
        Style s = screen == null || screen.mapLibre() == null ? null : screen.mapLibre().getStyle();
        return s != null && s.isFullyLoaded() ? s : null;
    }
    static TileSet tiles(String url, float min, float max, JSONArray b) {
        TileSet t = new TileSet("2.2.0", url);
        t.setMinZoom(min);
        t.setMaxZoom(max);
        if (b != null && b.length() == 4) t.setBounds((float) b.optDouble(0), (float) b.optDouble(1), (float) b.optDouble(2), (float) b.optDouble(3));
        return t;
    }
    private static String q(String s) { return JSONObject.quote(s); }

    // ---------- "fish" ----------
    private TrailMapScreen screen;
    private JSONObject data = new JSONObject();
    private String built = "";             // the water / Crown land / depth setup now on the map
    private int round = 0;
    private final List<String> layers = new ArrayList<>(), sources = new ArrayList<>();

    @Override public String key() { return "fish"; }

    @Override
    public void added(Style style, TrailMapScreen screen) {
        this.screen = screen;
        layers.clear(); sources.clear(); built = "";
        build(style);
    }

    @Override
    public void setData(String json, Style style) {
        final int r = ++round;
        READER.execute(() -> {
            JSONObject o;
            try { o = new JSONObject(json); } catch (Exception e) { return; }
            String fills = shape(o.opt("fills")), names = shape(o.opt("names")), pin = shape(o.opt("pin"));
            MAIN.post(() -> {
                if (r != round) return;
                data = o;
                Style s = ready(screen);
                if (s == null) return;
                if (!setup().equals(built) || s.getSource("fs-fill") == null) { build(s); return; }
                GeoJsonSource f = s.getSourceAs("fs-fill"), n = s.getSourceAs("fs-names"), p = s.getSourceAs("fs-pin");
                if (f != null) f.setGeoJson(fills);
                if (n != null) n.setGeoJson(names);
                if (p != null) p.setGeoJson(pin);
            });
        });
    }

    private String setup() {
        return String.valueOf(data.opt("water")) + "|" + data.opt("crown") + "|" + data.opt("depth");
    }

    private void under(Style style, Layer l, List<String> above) { insert(l, style, screen, above); layers.add(l.getId()); }
    private void top(Style style, Layer l) { style.addLayer(l); layers.add(l.getId()); }
    private void add(Style style, Source s) { style.addSource(s); sources.add(s.getId()); }

    private void build(Style style) {
        for (String id : layers) { Layer l = style.getLayer(id); if (l != null) style.removeLayer(l); }
        for (String id : sources) { Source s = style.getSource(id); if (s != null) style.removeSource(s); }
        layers.clear(); sources.clear();
        if (data.length() == 0) { built = ""; return; }
        built = setup();

        // The water colours (fishing.js WATER), from OpenFreeMap's vector tiles.
        JSONObject water = data.optJSONObject("water");
        boolean any = false;
        if (water != null) for (String k : new String[] { "rivers", "creeks", "lakes", "ocean" }) any |= water.optBoolean(k, false);
        if (any) {
            add(style, new VectorSource("fs-w", "https://tiles.openfreemap.org/planet"));
            if (water.optBoolean("rivers", false)) {
                waterFill(style, "fs-riv-area", "[\"==\", [\"get\", \"class\"], \"river\"]", "#15d1ff", 0.75f);
                waterLine(style, "fs-riv-line", "waterway", "[\"in\", [\"get\", \"class\"], [\"literal\", [\"river\", \"canal\"]]]", "#15d1ff",
                    "[\"interpolate\", [\"linear\"], [\"zoom\"], 6, 1.6, 10, 3, 14, 5]", null, 0);
            }
            if (water.optBoolean("creeks", false)) {
                // OpenFreeMap has the small creeks from zoom 13 ("fish-creeks" draws them further out); dashed when
                // they dry up in summer.
                String width = "[\"interpolate\", [\"linear\"], [\"zoom\"], 13, 1.6, 16, 3]";
                waterLine(style, "fs-creek", "waterway", "[\"all\", [\"==\", [\"get\", \"class\"], \"stream\"], [\"!=\", [\"get\", \"intermittent\"], 1]]",
                    "#8cf0ff", width, null, 13);
                waterLine(style, "fs-creek-i", "waterway", "[\"all\", [\"==\", [\"get\", \"class\"], \"stream\"], [\"==\", [\"get\", \"intermittent\"], 1]]",
                    "#8cf0ff", width, new Float[] { 2f, 1.5f }, 13);
            }
            if (water.optBoolean("lakes", false)) {
                waterFill(style, "fs-lake", "[\"in\", [\"get\", \"class\"], [\"literal\", [\"lake\", \"pond\"]]]", "#12d6b4", 0.75f);
                waterLine(style, "fs-lake-edge", "water", "[\"in\", [\"get\", \"class\"], [\"literal\", [\"lake\", \"pond\"]]]", "#d9fff7", "0.8", null, 0);
            }
            if (water.optBoolean("ocean", false)) waterFill(style, "fs-sea", "[\"==\", [\"get\", \"class\"], \"ocean\"]", "#2f7bff", 0.6f);
        }

        // Lake depth pictures: Manitoba's vector tiles and DataBC's few drawn BC lakes ("fish-depth" draws the rest).
        SymbolLayer mbLabel = null;
        JSONObject depth = data.optJSONObject("depth");
        if (depth != null) {
            JSONObject mb = depth.optJSONObject("mb");
            if (mb != null && !mb.optString("tiles", "").isEmpty()) {
                add(style, new VectorSource("fs-mb", tiles(mb.optString("tiles"), 0, 16, mb.optJSONArray("b"))));
                int colour = TrailMapScreen.colour(mb.optString("c", "#1e40af"), Color.rgb(0x1e, 0x40, 0xaf));
                LineLayer l = new LineLayer("fs-mb-line", "fs-mb");
                l.setSourceLayer("Contours");
                l.setProperties(PropertyFactory.lineColor(colour), PropertyFactory.lineWidth(1.1f), PropertyFactory.lineOpacity(0.85f));
                l.setMinZoom(10);
                under(style, l, Arrays.asList("fs-q-line", "fs-q-pt", "fs-bcd", "fs-cl-", "fs-fill"));
                SymbolLayer t = label("fs-mb-label", "fs-mb");
                t.setSourceLayer("Contours/label");
                t.setFilter(raw("[\"==\", [\"geometry-type\"], \"Point\"]"));
                t.setProperties(
                    PropertyFactory.textField(raw("[\"concat\", [\"to-string\", [\"abs\", [\"to-number\", [\"get\", \"_name\"], 0]]], \" m\"]")),
                    PropertyFactory.textSize(11f), PropertyFactory.textOptional(true), PropertyFactory.textColor(colour),
                    PropertyFactory.textHaloWidth(1.6f));
                t.setMinZoom(10);
                mbLabel = t;
            }
            JSONObject bc = depth.optJSONObject("bc");
            if (bc != null && !bc.optString("tiles", "").isEmpty()) {
                add(style, new RasterSource("fs-bcd", tiles(bc.optString("tiles"), 11, 20, bc.optJSONArray("b")), 256));
                RasterLayer l = new RasterLayer("fs-bcd", "fs-bcd");
                l.setProperties(PropertyFactory.rasterOpacity(0.85f));
                l.setMinZoom(11);
                under(style, l, Arrays.asList("fs-cl-", "fs-fill"));
            }
        }

        // Crown land: each province's own pictures (crownland.js), see-through as on the web.
        JSONArray crown = data.optJSONArray("crown");
        if (crown != null) for (int i = 0; i < crown.length(); i++) {
            JSONObject c = crown.optJSONObject(i);
            if (c == null || c.optString("id", "").isEmpty() || c.optString("tiles", "").isEmpty()) continue;
            String id = "fs-cl-" + c.optString("id");
            if (style.getSource(id) != null) continue;   // never two of one id
            float min = (float) c.optDouble("min", 9);
            add(style, new RasterSource(id, tiles(c.optString("tiles"), min, 20, c.optJSONArray("b")), 256));
            RasterLayer l = new RasterLayer(id, id);
            l.setProperties(PropertyFactory.rasterOpacity((float) c.optDouble("o", 0.26)));
            l.setMinZoom(min);
            under(style, l, Arrays.asList("fs-fill"));
        }

        // Zone, park and boating-zone fills.
        add(style, new GeoJsonSource("fs-fill", shape(data.opt("fills"))));
        FillLayer f = new FillLayer("fs-fill", "fs-fill");
        f.setProperties(PropertyFactory.fillColor(raw("[\"to-color\", [\"get\", \"c\"]]")),
            PropertyFactory.fillOpacity(raw("[\"to-number\", [\"get\", \"o\"]]")));
        under(style, f, new ArrayList<>());

        // On top: depth numbers, zone names, the picked spot.
        if (mbLabel != null) top(style, mbLabel);
        add(style, new GeoJsonSource("fs-names", shape(data.opt("names"))));
        SymbolLayer n = label("fs-names", "fs-names");
        n.setProperties(PropertyFactory.textField(Expression.get("t")), PropertyFactory.textSize(13f),
            PropertyFactory.textColor(raw("[\"to-color\", [\"get\", \"c\"]]")), PropertyFactory.textHaloWidth(2f));
        top(style, n);
        // The spot: a ring in the Fishing colour with a dot in the middle (.fs-spot in fishing.js).
        int accent = TrailMapScreen.colour(data.optString("accent", "#0c8599"), Color.rgb(0x0c, 0x85, 0x99));
        add(style, new GeoJsonSource("fs-pin", shape(data.opt("pin"))));
        ring(style, "fs-pin-halo", 12f, Color.WHITE, 0f, Color.WHITE, 2f);
        ring(style, "fs-pin", 10.5f, Color.WHITE, 0.4f, accent, 3f);
        ring(style, "fs-pin-dot", 4f, accent, 1f, Color.WHITE, 1.5f);
    }

    private void waterFill(Style style, String id, String filter, String colour, float opacity) {
        FillLayer l = new FillLayer(id, "fs-w");
        l.setSourceLayer("water");
        l.setFilter(raw(filter));
        l.setProperties(PropertyFactory.fillColor(TrailMapScreen.colour(colour, Color.BLUE)), PropertyFactory.fillOpacity(opacity));
        under(style, l, OVER_WATER);
    }
    private void waterLine(Style style, String id, String layer, String filter, String colour, String width, Float[] dash, float minZoom) {
        LineLayer l = new LineLayer(id, "fs-w");
        l.setSourceLayer(layer);
        l.setFilter(raw(filter));
        l.setProperties(PropertyFactory.lineColor(TrailMapScreen.colour(colour, Color.BLUE)), PropertyFactory.lineWidth(raw(width)),
            PropertyFactory.lineCap(Property.LINE_CAP_ROUND), PropertyFactory.lineJoin(Property.LINE_JOIN_ROUND));
        if (dash != null) l.setProperties(PropertyFactory.lineDasharray(dash));
        if (minZoom > 0) l.setMinZoom(minZoom);
        under(style, l, OVER_WATER);
    }
    private void ring(Style style, String id, float r, int fill, float fillOpacity, int stroke, float sw) {
        CircleLayer c = new CircleLayer(id, "fs-pin");
        c.setProperties(PropertyFactory.circleRadius(r), PropertyFactory.circleColor(fill), PropertyFactory.circleOpacity(fillOpacity),
            PropertyFactory.circleStrokeColor(stroke), PropertyFactory.circleStrokeWidth(sw),
            PropertyFactory.circlePitchAlignment(Property.CIRCLE_PITCH_ALIGNMENT_VIEWPORT));
        top(style, c);
    }

    // ---------- "fish-creeks": creeks from further away (zooms 10 to 13; OpenFreeMap's own creeks take over from 13) ----------
    static final class Creeks implements NativeLayer {
        private TrailMapScreen screen;
        private String shape;
        private int round = 0;

        @Override public String key() { return "fish-creeks"; }
        @Override public void added(Style style, TrailMapScreen screen) { this.screen = screen; add(style); }
        @Override public void setData(String json, Style style) {
            final int r = ++round;
            // Handed to the map as it came (MapLibre reads it); only a missing or empty one is nothing.
            final String fs = json == null || !json.trim().startsWith("{") ? null : json;
            MAIN.post(() -> {
                    if (r != round) return;
                    shape = fs;
                    Style st = ready(screen);
                    if (st == null) return;
                    GeoJsonSource src = st.getSourceAs("fs-cf");
                    if (src != null) src.setGeoJson(fs == null ? EMPTY : fs); else add(st);
            });
        }
        private void add(Style style) {
            if (shape == null || style.getSource("fs-cf") != null) return;
            style.addSource(new GeoJsonSource("fs-cf", shape));
            for (boolean dashed : new boolean[] { false, true }) {
                LineLayer l = new LineLayer(dashed ? "fs-creek-far-i" : "fs-creek-far", "fs-cf");
                l.setFilter(raw("[" + q(dashed ? "==" : "!=") + ", [\"get\", \"i\"], 1]"));
                l.setProperties(PropertyFactory.lineColor(Color.rgb(0x8c, 0xf0, 0xff)),
                    PropertyFactory.lineWidth(raw("[\"interpolate\", [\"linear\"], [\"zoom\"], 10, 1, 13, 1.6]")),
                    PropertyFactory.lineOpacity(raw("[\"interpolate\", [\"linear\"], [\"zoom\"], 10, 0.85, 12, 1]")),
                    PropertyFactory.lineCap(Property.LINE_CAP_ROUND), PropertyFactory.lineJoin(Property.LINE_JOIN_ROUND));
                if (dashed) l.setProperties(PropertyFactory.lineDasharray(new Float[] { 2f, 1.5f }));
                l.setMaxZoom(13);
                insert(l, style, screen, OVER_CREEKS);
            }
        }
    }

    // ---------- "fish-depth": lake depth lines and soundings (fishing.js depthStyle "q"), from zoom 10 as on the web ----------
    static final class Depth implements NativeLayer {
        // DEPTH_COL in fishing.js: lighter in the shallows, darker deeper down.
        private static final String COLOUR = "[\"interpolate\", [\"linear\"], [\"get\", \"d\"], 0, \"#5fc4f0\", 5, \"#2b8fd6\", 15, \"#1d5fb8\", 40, \"#173a8a\"]";
        private TrailMapScreen screen;
        private String shape;
        private int round = 0;

        @Override public String key() { return "fish-depth"; }
        @Override public void added(Style style, TrailMapScreen screen) { this.screen = screen; add(style); }
        // A view's depth lines can be a few MB: MapLibre reads them off the main thread.
        @Override public void setData(String json, Style style) {
            final int r = ++round;
            // Handed to the map as it came (MapLibre reads it); only a missing or empty one is nothing.
            final String fs = json == null || !json.trim().startsWith("{") ? null : json;
            MAIN.post(() -> {
                    if (r != round) return;
                    shape = fs;
                    Style st = ready(screen);
                    if (st == null) return;
                    GeoJsonSource src = st.getSourceAs("fs-q");
                    if (src != null) src.setGeoJson(fs == null ? EMPTY : fs); else add(st);
            });
        }
        private void add(Style style) {
            if (shape == null || style.getSource("fs-q") != null) return;
            style.addSource(new GeoJsonSource("fs-q", shape));
            String isLine = "[\"==\", [\"geometry-type\"], \"LineString\"]", isPoint = "[\"==\", [\"geometry-type\"], \"Point\"]";
            LineLayer l = new LineLayer("fs-q-line", "fs-q");
            l.setFilter(raw(isLine));
            l.setProperties(PropertyFactory.lineColor(raw(COLOUR)),
                PropertyFactory.lineWidth(raw("[\"interpolate\", [\"linear\"], [\"zoom\"], 12, 0.9, 16, 1.6]")),
                PropertyFactory.lineOpacity(0.9f), PropertyFactory.lineCap(Property.LINE_CAP_ROUND), PropertyFactory.lineJoin(Property.LINE_JOIN_ROUND));
            l.setMinZoom(10);
            insert(l, style, screen, OVER_DEPTH);
            CircleLayer p = new CircleLayer("fs-q-pt", "fs-q");
            p.setFilter(raw(isPoint));
            p.setProperties(PropertyFactory.circleRadius(1.6f), PropertyFactory.circleColor(raw(COLOUR)));
            p.setMinZoom(13);
            insert(p, style, screen, OVER_DEPTH);
            int dark = Color.rgb(0x17, 0x3a, 0x8a);
            SymbolLayer t = label("fs-q-label", "fs-q");
            t.setFilter(raw("[\"all\", " + isLine + ", [\">\", [\"get\", \"d\"], 0]]"));
            t.setProperties(PropertyFactory.symbolPlacement(Property.SYMBOL_PLACEMENT_LINE), PropertyFactory.symbolSpacing(280f),
                PropertyFactory.textField(raw("[\"concat\", [\"to-string\", [\"get\", \"d\"]], \" m\"]")), PropertyFactory.textSize(11f),
                PropertyFactory.textMaxAngle(30f), PropertyFactory.textColor(dark), PropertyFactory.textHaloWidth(1.6f));
            t.setMinZoom(13);
            style.addLayer(t);
            SymbolLayer n = label("fs-q-ptlabel", "fs-q");
            n.setFilter(raw(isPoint));
            n.setProperties(PropertyFactory.textField(raw("[\"to-string\", [\"get\", \"d\"]]")), PropertyFactory.textSize(10f),
                PropertyFactory.textOffset(new Float[] { 0f, -0.8f }), PropertyFactory.textPadding(1f), PropertyFactory.textColor(dark),
                PropertyFactory.textHaloWidth(1.4f));
            n.setMinZoom(14);
            style.addLayer(n);
        }
    }
}
