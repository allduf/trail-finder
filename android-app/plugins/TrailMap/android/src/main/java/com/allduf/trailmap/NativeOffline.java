package com.allduf.trailmap;

import static org.maplibre.android.style.expressions.Expression.raw;

import android.graphics.Bitmap;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.Paint;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.util.TypedValue;
import android.view.Gravity;
import android.view.View;
import android.widget.FrameLayout;
import android.widget.TextView;
import java.util.ArrayList;
import java.util.List;
import org.json.JSONArray;
import org.json.JSONObject;
import org.maplibre.android.maps.Style;
import org.maplibre.android.style.layers.BackgroundLayer;
import org.maplibre.android.style.layers.FillLayer;
import org.maplibre.android.style.layers.HillshadeLayer;
import org.maplibre.android.style.layers.Layer;
import org.maplibre.android.style.layers.LineLayer;
import org.maplibre.android.style.layers.Property;
import org.maplibre.android.style.layers.PropertyFactory;
import org.maplibre.android.style.layers.SymbolLayer;
import org.maplibre.android.style.sources.GeoJsonSource;
import org.maplibre.android.style.sources.RasterDemSource;
import org.maplibre.android.style.sources.Source;
import org.maplibre.android.style.sources.TileSet;
import org.maplibre.android.style.sources.VectorSource;

// Offline maps in native 3D, the Android side of NativeOffline.swift. Works like the web 3D map with no signal
// (offline.js, map3d.js offGround):
//   - the photos that can't come (Satellite, Topo, Map; Esri's far photo under Winter) are hidden, and the ground is the
//     saved map instead: woods, open ground, rock, ice and water from OpenFreeMap with the hills shaded, under the
//     trails; Skiing's Winter photos saved with an area stay on top of it;
//   - each saved area shows as a green dashed square with "Saved: name" (the page sends the areas and the words);
//   - a small "No signal: the saved map" label says why the map looks different.
// Online none of this is on the map (nothing added, nothing slower). The copies themselves: OfflinePacks.java.
final class NativeOffline implements NativeLayer {
    private static final int GREEN = Color.rgb(0x14, 0x80, 0x4a);
    private boolean online = true;
    private final List<Object[]> areas = new ArrayList<>();   // { double[] box (s, w, n, e), label }
    private String noSignal = "No signal: the saved map";
    private TrailMapScreen screen;
    private TextView tag;

    @Override public String key() { return "offline"; }

    @Override
    public void added(Style style, TrailMapScreen screen) {
        this.screen = screen;
        apply(style);
        // Right after the app starts, MapLibre may still be reading its list of saved regions: draw again once it's in.
        if (!online && !OfflinePacks.shared.listed()) {
            OfflinePacks.shared.withRegions(screen.getContext(), (l) -> {
                // Only the style still showing (a new base map may have come meanwhile; it draws this again itself).
                Style now = ready();
                if (now == style) apply(now);
            });
        }
    }

    @Override
    public void setData(String json, Style style) {
        JSONObject o;
        try { o = new JSONObject(json); } catch (Exception e) { return; }
        online = o.optBoolean("online", true);
        String s = o.optString("noSignal", "");
        if (!s.isEmpty()) noSignal = s;
        areas.clear();
        JSONArray as = o.optJSONArray("areas");
        if (as != null) for (int i = 0; i < as.length(); i++) {
            JSONObject a = as.optJSONObject(i);
            double[] b = a == null ? null : OfflinePacks.box(a.optJSONArray("box"));
            if (b != null) areas.add(new Object[] { b, a.optString("label", "") });
        }
        // Only the style showing now, once loaded: while a new base map loads, its added() draws this when it's in.
        Style now = ready();
        if (now != null) apply(now);
    }
    private Style ready() {
        Style s = screen == null || screen.mapLibre() == null ? null : screen.mapLibre().getStyle();
        return s != null && s.isFullyLoaded() ? s : null;
    }

    private void apply(Style style) {
        boolean off = !online;
        for (Layer l : style.getLayers()) if (l.getId().startsWith("tf-off-")) style.removeLayer(l);
        for (Source s : style.getSources()) if (s.getId().startsWith("tf-off-")) style.removeSource(s);
        // Hidden, the photos aren't asked for at all (no retries with no signal). Winter's own photos stay.
        for (String id : new String[] { "base", "esri" }) {
            Layer l = style.getLayer(id);
            if (l != null) l.setProperties(PropertyFactory.visibility(off ? Property.NONE : Property.VISIBLE));
        }
        showTag(off);
        if (!off) return;

        // The saved ground: under Winter's photos when they're there, else right under the trails.
        String under = style.getLayer("wide") != null ? "wide" : style.getLayer("tf-line") != null ? "tf-line" : null;
        BackgroundLayer bg = new BackgroundLayer("tf-off-bg");
        bg.setProperties(PropertyFactory.backgroundColor(Color.rgb(0xdf, 0xe5, 0xd2)));
        put(style, bg, under);
        // One map source per OpenFreeMap edition the copies were saved from (its tile addresses change each week).
        List<String> tmpls = OfflinePacks.shared.savedTemplates();
        for (int i = 0; i < tmpls.size(); i++) {
            TileSet set = new TileSet("2.2.0", tmpls.get(i));
            set.setMinZoom(0); set.setMaxZoom(14);
            style.addSource(new VectorSource("tf-off-ofm-" + i, set));
            FillLayer land = new FillLayer("tf-off-land-" + i, "tf-off-ofm-" + i);
            land.setSourceLayer("landcover");
            land.setProperties(PropertyFactory.fillColor(raw("[\"match\", [\"get\", \"class\"], \"wood\", \"#a7c496\", \"grass\", \"#d4e3b5\", \"rock\", \"#d3cfc6\","
                + " \"ice\", \"#f3f7fa\", \"sand\", \"#ece2c3\", \"wetland\", \"#c2dacb\", \"farmland\", \"#e3e6c3\", \"#d6e0c4\"]")));
            put(style, land, under);
            FillLayer water = new FillLayer("tf-off-water-" + i, "tf-off-ofm-" + i);
            water.setSourceLayer("water");
            water.setProperties(PropertyFactory.fillColor(Color.rgb(0x98, 0xc0, 0xe4)));
            put(style, water, under);
        }
        // The hills shaded, from the same saved heights as the 3D ground (same addresses: nothing more to save).
        TileSet dem = new TileSet("2.2.0", BaseStyles.DEM_TILES);
        dem.setMaxZoom(12);
        dem.setEncoding("terrarium");
        style.addSource(new RasterDemSource("tf-off-dem", dem, 512));
        HillshadeLayer shade = new HillshadeLayer("tf-off-shade", "tf-off-dem");
        shade.setProperties(PropertyFactory.hillshadeExaggeration(0.35f), PropertyFactory.hillshadeShadowColor(new String[] { "#3a4a66" }),
            PropertyFactory.hillshadeHighlightColor(new String[] { "#ffffff" }), PropertyFactory.hillshadeAccentColor(Color.rgb(0x5a, 0x6a, 0x80)));
        put(style, shade, under);

        // The saved areas' edges, on top (as on the web map).
        if (areas.isEmpty()) return;
        JSONArray feats = new JSONArray();
        float d = screen != null ? screen.getResources().getDisplayMetrics().density : 2;
        for (int i = 0; i < areas.size(); i++) {
            double[] b = (double[]) areas.get(i)[0];
            String label = (String) areas.get(i)[1];
            double s = b[0], w = b[1], n = b[2], e = b[3];
            feats.put(BaseStyles.o("type", "Feature", "properties", new JSONObject(), "geometry", BaseStyles.o("type", "LineString",
                "coordinates", BaseStyles.a(BaseStyles.a(w, s), BaseStyles.a(e, s), BaseStyles.a(e, n), BaseStyles.a(w, n), BaseStyles.a(w, s)))));
            Bitmap img = label.isEmpty() ? null : labelImage(label, d);
            if (img == null) continue;
            String name = "tf-off-name-" + i;
            style.addImage(name, img);
            feats.put(BaseStyles.o("type", "Feature", "properties", BaseStyles.o("img", name),
                "geometry", BaseStyles.o("type", "Point", "coordinates", BaseStyles.a((w + e) / 2, n))));
        }
        style.addSource(new GeoJsonSource("tf-off-areas", BaseStyles.o("type", "FeatureCollection", "features", feats).toString()));
        String lineOnly = "[\"==\", [\"geometry-type\"], \"LineString\"]";
        LineLayer caseL = new LineLayer("tf-off-area-case", "tf-off-areas");
        caseL.setFilter(raw(lineOnly));
        caseL.setProperties(PropertyFactory.lineColor(Color.WHITE), PropertyFactory.lineWidth(6f), PropertyFactory.lineOpacity(0.85f));
        style.addLayer(caseL);
        LineLayer line = new LineLayer("tf-off-area", "tf-off-areas");
        line.setFilter(raw(lineOnly));
        line.setProperties(PropertyFactory.lineColor(GREEN), PropertyFactory.lineWidth(3f), PropertyFactory.lineDasharray(new Float[] { 2f, 1.5f }));
        style.addLayer(line);
        SymbolLayer names = new SymbolLayer("tf-off-name", "tf-off-areas");
        names.setFilter(raw("[\"==\", [\"geometry-type\"], \"Point\"]"));
        names.setProperties(PropertyFactory.iconImage(raw("[\"get\", \"img\"]")), PropertyFactory.iconAnchor(Property.ICON_ANCHOR_BOTTOM),
            PropertyFactory.iconAllowOverlap(true));
        style.addLayer(names);
    }
    private static void put(Style style, Layer l, String under) { if (under != null) style.addLayerBelow(l, under); else style.addLayer(l); }

    // The name as a picture (green, white halo), so it needs no font files, which can't come with no signal.
    private static Bitmap labelImage(String text, float d) {
        Paint ink = new Paint(Paint.ANTI_ALIAS_FLAG);
        ink.setTypeface(Typeface.DEFAULT_BOLD);
        ink.setTextSize(13 * d);
        ink.setColor(GREEN);
        Paint halo = new Paint(ink);
        halo.setStyle(Paint.Style.STROKE);
        halo.setStrokeWidth(3 * d);
        halo.setStrokeJoin(Paint.Join.ROUND);
        halo.setColor(Color.WHITE);
        Paint.FontMetrics fm = ink.getFontMetrics();
        float pad = 4 * d;
        int w = (int) Math.ceil(ink.measureText(text) + pad * 2), h = (int) Math.ceil(fm.descent - fm.ascent + pad * 2);
        if (w <= pad * 2) return null;
        Bitmap b = Bitmap.createBitmap(w, h, Bitmap.Config.ARGB_8888);
        Canvas c = new Canvas(b);
        c.drawText(text, pad, pad - fm.ascent, halo);
        c.drawText(text, pad, pad - fm.ascent, ink);
        return b;
    }

    private void showTag(boolean on) {
        if (screen == null) return;
        if (tag == null) {
            tag = new TextView(screen.getContext());
            tag.setTextColor(Color.WHITE);
            tag.setTextSize(TypedValue.COMPLEX_UNIT_SP, 12);
            tag.setTypeface(Typeface.DEFAULT_BOLD);
            tag.setGravity(Gravity.CENTER);
            tag.setPadding(screen.dp(8), screen.dp(3), screen.dp(8), screen.dp(3));
            GradientDrawable bg = new GradientDrawable();
            bg.setColor(Color.argb(217, 20, 31, 26));
            bg.setCornerRadius(screen.dp(6));
            tag.setBackground(bg);
            FrameLayout.LayoutParams at = new FrameLayout.LayoutParams(FrameLayout.LayoutParams.WRAP_CONTENT, FrameLayout.LayoutParams.WRAP_CONTENT, Gravity.TOP | Gravity.CENTER_HORIZONTAL);
            at.topMargin = screen.dp(44);
            screen.mapArea().addView(tag, at);
        }
        tag.setText(noSignal);
        tag.setVisibility(on ? View.VISIBLE : View.GONE);
    }
}
