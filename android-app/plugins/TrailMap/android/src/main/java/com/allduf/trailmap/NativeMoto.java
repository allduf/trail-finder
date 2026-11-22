package com.allduf.trailmap;

import static org.maplibre.android.style.expressions.Expression.raw;

import android.graphics.Bitmap;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.Paint;
import java.util.Arrays;
import java.util.Collections;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import org.json.JSONArray;
import org.json.JSONObject;
import org.maplibre.android.geometry.LatLng;
import org.maplibre.android.maps.Style;
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
import org.maplibre.geojson.Feature;

// Adventure moto in native 3D, the Android side of NativeMoto.swift: what the web 3D map draws for Moto (moto.js sync3d),
// with the page side in native-moto.js. Under the trails, the dirt roads coloured for the rider's bike: BC's forest
// roads (DataBC map images, from zoom 8, BC only), our own far dirt-road tiles up to zoom 13 and OpenFreeMap's roads and
// tracks from 13, tracks dashed. Over the trails, the stops (gas, campsites, BC rec sites, hot springs, shops, ferries)
// as the web 3D map's dots; MapLibre leaves out the ones that would sit on each other, gas first. A tap on a stop shows
// its name; "Details" opens its card on the page. Data (JSON): { roads, road, track, ften, pts: [[lat, lon, kind, colour, name]] }.
final class NativeMoto implements NativeLayer {
    private static final String DIRT_HOST = "dirt.trailfinder.invalid";
    private static final List<String> ORDER = Arrays.asList("fuel", "camp", "rec", "hot", "shop", "ferry");   // which dot wins
    private static final String[] ROAD_IDS = { "mt-ften", "mt-far-case", "mt-far-road", "mt-far-track", "mt-case", "mt-road", "mt-track" };
    private static boolean rewriting = false;

    private boolean on = false;
    private String road = "#2f9e44", track = "#f08c00", ften = "";
    private String drawn;                        // what the current style has (null: nothing yet)
    private String pts;                          // the stops as GeoJSON text (null: none sent)
    private final Map<String, String> colours = new HashMap<>();   // stop kind -> its colour (one dot image each)
    private TrailMapScreen screen;

    @Override public String key() { return "moto"; }
    @Override public List<String> tapLayers() { return Collections.singletonList("mt-pts"); }

    @Override
    public void added(Style style, TrailMapScreen screen) {
        this.screen = screen;
        drawn = null;
        draw(style);
    }

    @Override
    public void setData(String json, Style style) {
        JSONObject o;
        try { o = new JSONObject(json); } catch (Exception e) { return; }
        on = o.optBoolean("roads", false);
        road = o.optString("road", road);
        track = o.optString("track", track);
        ften = o.optString("ften", "");
        JSONArray out = new JSONArray(), raw = o.optJSONArray("pts");
        if (raw != null) for (int i = 0; i < raw.length(); i++) {
            JSONArray p = raw.optJSONArray(i);
            if (p == null || p.length() < 5) continue;
            double lat = p.optDouble(0), lon = p.optDouble(1);
            String k = p.optString(2, ""), c = p.optString(3, "");
            if (Double.isNaN(lat) || Double.isNaN(lon) || k.isEmpty() || c.isEmpty()) continue;
            colours.put(k, c);
            int s = ORDER.indexOf(k);
            out.put(BaseStyles.o("type", "Feature", "geometry", BaseStyles.o("type", "Point", "coordinates", BaseStyles.a(lon, lat)),
                "properties", BaseStyles.o("k", k, "c", c, "n", p.optString(4, ""), "s", s < 0 ? 9 : s, "la", lat, "lo", lon)));
        }
        pts = BaseStyles.o("type", "FeatureCollection", "features", out).toString();
        if (style != null) draw(style);
    }

    @Override
    public boolean tapped(Feature f, TrailMapScreen screen) {
        String name = TrailMapScreen.str(f, "n");
        if (name.isEmpty()) return false;
        // The stop's own spot (a tapped feature's coordinate is rounded to its tile): the page finds the stop by it.
        Number la = f.hasProperty("la") ? f.getNumberProperty("la") : null, lo = f.hasProperty("lo") ? f.getNumberProperty("lo") : null;
        if (la == null || lo == null) return false;
        screen.showFeatureCard(name, null, TrailMapScreen.str(f, "c"), -1, new LatLng(la.doubleValue(), lo.doubleValue()), null, true);
        return true;
    }

    // ---------- drawing ----------
    private void draw(Style style) {
        String under = style.getLayer("tf-fill") != null ? "tf-fill" : style.getLayer("tf-line") != null ? "tf-line" : null;
        String now = on + "|" + road + "|" + track + "|" + ften;
        if (!Objects.equals(drawn, now)) {
            removeRoads(style);
            if (on) addRoads(style, under);
            drawn = now;
        }
        for (Map.Entry<String, String> e : colours.entrySet())
            if (style.getImage("mt-dot-" + e.getKey()) == null) style.addImage("mt-dot-" + e.getKey(), dot(e.getValue()));
        GeoJsonSource src = style.getSourceAs("mt-pts");
        if (src != null) { src.setGeoJson(pts == null ? "{\"type\":\"FeatureCollection\",\"features\":[]}" : pts); return; }
        if (pts == null) return;
        style.addSource(new GeoJsonSource("mt-pts", pts));
        SymbolLayer l = new SymbolLayer("mt-pts", "mt-pts").withProperties(
            PropertyFactory.iconImage(raw("[\"concat\", \"mt-dot-\", [\"get\", \"k\"]]")),
            PropertyFactory.iconAllowOverlap(false),
            PropertyFactory.symbolSortKey(raw("[\"get\", \"s\"]")),
            PropertyFactory.iconPitchAlignment(Property.ICON_PITCH_ALIGNMENT_VIEWPORT));
        style.addLayer(l);   // over the trails, as the web map's pins
    }

    private void removeRoads(Style style) {
        for (String id : ROAD_IDS) { Layer l = style.getLayer(id); if (l != null) style.removeLayer(l); }
        for (String id : new String[] { "mt-ften", "mt-ofm", "mt-dirt" }) { Source s = style.getSource(id); if (s != null) style.removeSource(s); }
    }

    private static void put(Style style, Layer l, String under) {
        if (under != null) style.addLayerBelow(l, under); else style.addLayer(l);
    }
    private static String q(String s) { return JSONObject.quote(s); }

    private void addRoads(Style style, String under) {
        // BC forest roads (moto.js ftenTiles): already coloured for the bike by the page's map style.
        if (!ften.isEmpty()) {
            TileSet set = new TileSet("2.2.0", ften);
            set.setMinZoom(8); set.setMaxZoom(17);
            set.setBounds(-139.1f, 48.2f, -114f, 60f);
            style.addSource(new RasterSource("mt-ften", set, 256));
            RasterLayer l = new RasterLayer("mt-ften", "mt-ften");
            l.setMinZoom(8);
            l.setProperties(PropertyFactory.rasterOpacity(raw("[\"interpolate\", [\"linear\"], [\"zoom\"], 8, 0.6, 11, 0.8, 13, 0.95]")));
            put(style, l, under);
        }
        // Far dirt roads up to zoom 13 (scripts/build-dirt-roads.mjs, zooms 7-11) on four sites picked by the zoom-7
        // square, as index.html's tfdirt://: "c" is "t" for a track, "r" for a gravel road.
        synchronized (NativeMoto.class) {
            if (!rewriting) {
                rewriting = true;
                TileRewriter.add(DIRT_HOST, (url) -> {
                    List<String> p = url.pathSegments();
                    if (p.size() != 3) return null;
                    int z = Integer.parseInt(p.get(0)), x = Integer.parseInt(p.get(1)), y = Integer.parseInt(p.get(2));
                    int site = z < 7 ? 0 : ((x >> (z - 7)) * 31 + (y >> (z - 7))) % 4;
                    return "https://trailfinder-dirt-" + site + ".pages.dev/dirt/" + z + "/" + x + "/" + y + ".pbf";
                });
            }
        }
        TileSet dirtSet = new TileSet("2.2.0", "https://" + DIRT_HOST + "/{z}/{x}/{y}");
        dirtSet.setMinZoom(7); dirtSet.setMaxZoom(11);
        style.addSource(new VectorSource("mt-dirt", dirtSet));
        String farColour = "[\"case\", [\"==\", [\"get\", \"c\"], \"t\"], [\"to-color\", " + q(track) + "], [\"to-color\", " + q(road) + "]]";
        LineLayer farCase = new LineLayer("mt-far-case", "mt-dirt");
        farCase.setSourceLayer("dirt");
        farCase.setMinZoom(9); farCase.setMaxZoom(13);
        farCase.setProperties(PropertyFactory.lineColor(Color.WHITE), PropertyFactory.lineOpacity(0.7f),
            PropertyFactory.lineWidth(raw("[\"interpolate\", [\"linear\"], [\"zoom\"], 9, 2.2, 12.9, 4.4]")),
            PropertyFactory.lineCap(Property.LINE_CAP_ROUND), PropertyFactory.lineJoin(Property.LINE_JOIN_ROUND));
        put(style, farCase, under);
        for (boolean tr : new boolean[] { false, true }) {
            LineLayer l = new LineLayer(tr ? "mt-far-track" : "mt-far-road", "mt-dirt");
            l.setSourceLayer("dirt");
            l.setMaxZoom(13);
            l.setFilter(raw("[" + q(tr ? "==" : "!=") + ", [\"get\", \"c\"], \"t\"]"));
            l.setProperties(PropertyFactory.lineColor(raw(farColour)),
                PropertyFactory.lineWidth(raw("[\"interpolate\", [\"linear\"], [\"zoom\"], 7, 0.6, 10, 1.1, 12.9, 2.5]")),
                PropertyFactory.lineJoin(Property.LINE_JOIN_ROUND));
            if (!tr) l.setProperties(PropertyFactory.lineCap(Property.LINE_CAP_ROUND));
            else l.setProperties(PropertyFactory.lineDasharray(new Float[] { 2f, 1f }));
            put(style, l, under);
        }
        // OpenFreeMap's roads and tracks from zoom 13 (moto.js ROAD_FILTER: tracks, and unpaved roads of these classes).
        style.addSource(new VectorSource("mt-ofm", "https://tiles.openfreemap.org/planet"));
        String filter = "[\"all\", [\"in\", [\"get\", \"class\"], [\"literal\", [\"track\", \"minor\", \"service\", \"tertiary\", \"secondary\", \"primary\", \"trunk\"]]],"
            + " [\"any\", [\"==\", [\"get\", \"class\"], \"track\"], [\"==\", [\"get\", \"surface\"], \"unpaved\"]], [\"!=\", [\"get\", \"brunnel\"], \"tunnel\"]]";
        LineLayer near = new LineLayer("mt-case", "mt-ofm");
        near.setSourceLayer("transportation");
        near.setMinZoom(13);
        near.setFilter(raw(filter));
        near.setProperties(PropertyFactory.lineColor(Color.WHITE), PropertyFactory.lineOpacity(0.85f),
            PropertyFactory.lineWidth(raw("[\"interpolate\", [\"linear\"], [\"zoom\"], 9, 2.6, 12, 4.6, 15, 7]")),
            PropertyFactory.lineCap(Property.LINE_CAP_ROUND), PropertyFactory.lineJoin(Property.LINE_JOIN_ROUND));
        put(style, near, under);
        for (boolean tr : new boolean[] { false, true }) {
            LineLayer l = new LineLayer(tr ? "mt-track" : "mt-road", "mt-ofm");
            l.setSourceLayer("transportation");
            l.setMinZoom(13);
            l.setFilter(raw("[\"all\", " + filter + ", [" + q(tr ? "==" : "!=") + ", [\"get\", \"class\"], \"track\"]]"));
            l.setProperties(PropertyFactory.lineColor(TrailMapScreen.colour(tr ? track : road, Color.GRAY)),
                PropertyFactory.lineWidth(raw("[\"interpolate\", [\"linear\"], [\"zoom\"], 9, 1.2, 12, 2.6, 15, 4.5]")),
                PropertyFactory.lineJoin(Property.LINE_JOIN_ROUND));
            if (!tr) l.setProperties(PropertyFactory.lineCap(Property.LINE_CAP_ROUND));
            else l.setProperties(PropertyFactory.lineDasharray(new Float[] { 2f, 1f }));
            put(style, l, under);
        }
    }

    // The web 3D map's stop dot: 7 pt across the middle, a 2 pt white ring.
    private Bitmap dot(String hex) {
        float d = screen != null ? screen.getResources().getDisplayMetrics().density : 2;
        int size = Math.round(18 * d);
        Bitmap b = Bitmap.createBitmap(size, size, Bitmap.Config.ARGB_8888);
        Canvas c = new Canvas(b);
        Paint p = new Paint(Paint.ANTI_ALIAS_FLAG);
        p.setColor(Color.WHITE);
        c.drawCircle(size / 2f, size / 2f, size / 2f, p);
        p.setColor(TrailMapScreen.colour(hex.startsWith("#") ? hex : "#" + hex, Color.GRAY));
        c.drawCircle(size / 2f, size / 2f, 7 * d, p);
        return b;
    }
}
