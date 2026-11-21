package com.allduf.trailmap;

import static org.maplibre.android.style.expressions.Expression.get;
import static org.maplibre.android.style.expressions.Expression.literal;
import static org.maplibre.android.style.expressions.Expression.step;
import static org.maplibre.android.style.expressions.Expression.stop;
import static org.maplibre.android.style.expressions.Expression.zoom;

import android.content.res.Resources;
import android.graphics.Bitmap;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.Matrix;
import android.graphics.Paint;
import android.graphics.Path;
import android.graphics.RectF;
import android.graphics.Typeface;
import androidx.core.graphics.PathParser;
import java.util.Collections;
import java.util.HashSet;
import java.util.List;
import java.util.Set;
import org.json.JSONArray;
import org.json.JSONObject;
import org.maplibre.android.geometry.LatLng;
import org.maplibre.android.maps.Style;
import org.maplibre.android.style.layers.Property;
import org.maplibre.android.style.layers.PropertyFactory;
import org.maplibre.android.style.layers.SymbolLayer;
import org.maplibre.android.style.sources.GeoJsonSource;
import org.maplibre.geojson.Feature;
import org.maplibre.geojson.Point;

// The map's tap pins in native 3D, the Android side of NativePins.swift (native 3D parity step 2): webcams, huts,
// parking, saved spots, the searched place, tour starts, trailheads and every other pin the page's flat map shows with a
// tap behind it. The page (native-pins.js) sends them as GeoJSON points: i (the pin's number on the page), n (its name),
// s (what it is, the card's second line), k (which picture: cam, hut, park, saved, search, ski, pin), c (its colour),
// r (minus how much it matters: a bigger one keeps its place when pins would overlap), nd: 1 for no Details, img (the
// picture's name, "tfpin:kind:#rrggbb").
// A tap shows the usual card with Details: that goes back to the page and opens the pin's own card there. The pictures
// are the page's line icons (line-icons.js) in white on a rounded square of the pin's colour, as on the iPhone.
final class NativePins implements NativeLayer {
    private static final String SOURCE = "tf-pins", LAYER = "tf-pins";
    private static final int INK = Color.rgb(20, 33, 26);
    private String data = "{\"type\":\"FeatureCollection\",\"features\":[]}";
    private final Set<String> made = new HashSet<>();   // pictures already on the current style
    private TrailMapScreen screen;

    @Override public String key() { return "pins"; }
    @Override public List<String> tapLayers() { return Collections.singletonList(LAYER); }

    @Override
    public void added(Style style, TrailMapScreen screen) {
        made.clear();
        this.screen = screen;
        style.addSource(new GeoJsonSource(SOURCE, data));
        addPictures(style);
        SymbolLayer l = new SymbolLayer(LAYER, SOURCE).withProperties(
            PropertyFactory.iconImage(get("img")),
            PropertyFactory.iconAllowOverlap(false),
            PropertyFactory.iconPitchAlignment(Property.ICON_PITCH_ALIGNMENT_VIEWPORT),
            PropertyFactory.iconRotationAlignment(Property.ICON_ROTATION_ALIGNMENT_VIEWPORT),
            PropertyFactory.symbolSortKey(get("r")),
            PropertyFactory.textField(get("n")),
            PropertyFactory.textFont(new String[] { "Noto Sans Bold" }),
            PropertyFactory.textSize(12f),
            PropertyFactory.textOptional(true),   // a name that doesn't fit is left out, the pin stays
            PropertyFactory.textAnchor(Property.TEXT_ANCHOR_TOP),
            PropertyFactory.textOffset(new Float[] { 0f, 1.3f }),
            PropertyFactory.textColor(INK),
            PropertyFactory.textHaloColor(Color.WHITE),
            PropertyFactory.textHaloWidth(1.6f),
            PropertyFactory.textMaxWidth(9f),
            // Names from zoom 13 (the flat map's 14), like the trail names; pins at every zoom the page shows them.
            PropertyFactory.textOpacity(step(zoom(), literal(0), stop(13, 1))));
        style.addLayer(l);   // over the trails and names: pins sit on top, as on the web 3D map
    }

    @Override
    public void setData(String json, Style style) {
        data = json == null || json.isEmpty() ? "{\"type\":\"FeatureCollection\",\"features\":[]}" : json;
        if (style == null) return;
        addPictures(style);
        GeoJsonSource s = style.getSourceAs(SOURCE);
        if (s != null) s.setGeoJson(data);
    }

    @Override
    public boolean tapped(Feature f, TrailMapScreen screen) {
        int i = TrailMapScreen.num(f, "i");
        if (i < 0) return false;
        String name = TrailMapScreen.str(f, "n");
        LatLng at = f.geometry() instanceof Point
            ? new LatLng(((Point) f.geometry()).latitude(), ((Point) f.geometry()).longitude()) : null;
        if (at == null) return false;
        screen.showFeatureCard(name.isEmpty() ? "Pin" : name, TrailMapScreen.str(f, "s"), TrailMapScreen.str(f, "c"), i, at, key(),
            TrailMapScreen.num(f, "nd") != 1);
        return true;
    }

    // ---------- the pictures: one per kind and colour in use, made once per style ----------
    private void addPictures(Style style) {
        JSONArray feats;
        try { feats = new JSONObject(data).optJSONArray("features"); } catch (Exception e) { return; }
        if (feats == null || screen == null) return;
        for (int n = 0; n < feats.length(); n++) {
            JSONObject p = feats.optJSONObject(n) == null ? null : feats.optJSONObject(n).optJSONObject("properties");
            String img = p == null ? "" : p.optString("img", "");
            if (img.isEmpty() || made.contains(img)) continue;
            made.add(img);
            String[] parts = img.split(":", 3);
            if (parts.length != 3) continue;
            style.addImage(img, picture(screen.getResources(), parts[1], parts[2]));
        }
    }

    // The page's line icons (24 x 24, line-icons.js): camera, a house, a bookmark, a map pin, a skier.
    private static final String CAMERA = "M3 8h4l2-3h6l2 3h4v11H3z";
    private static final String HOUSE = "M3 11.5 12 4l9 7.5M5.5 10v10h13V10M10 20v-5.5h4V20";
    private static final String BOOKMARK = "M6.5 3h11v18L12 16.5 6.5 21z";
    private static final String PIN = "M12 21s-7-6.2-7-11a7 7 0 0 1 14 0c0 4.8-7 11-7 11z";
    private static final String SKI = "M3 20 21 8M6 21l2-6M9 12l4-3 3 3";

    static Bitmap picture(Resources res, String kind, String colour) {
        float d = res.getDisplayMetrics().density;
        boolean search = "search".equals(kind);
        float size = (search ? 34 : 28) * d, pad = 2 * d;
        Bitmap b = Bitmap.createBitmap(Math.round(size + 2 * pad), Math.round(size + 2 * pad), Bitmap.Config.ARGB_8888);
        Canvas c = new Canvas(b);
        RectF box = new RectF(pad, pad, pad + size, pad + size);
        Paint fill = new Paint(Paint.ANTI_ALIAS_FLAG);
        fill.setColor(TrailMapScreen.colour(colour, Color.rgb(28, 28, 30)));
        Paint edge = new Paint(Paint.ANTI_ALIAS_FLAG);
        edge.setStyle(Paint.Style.STROKE);
        edge.setColor(Color.WHITE);
        edge.setStrokeWidth(2 * d);
        if (search) { c.drawOval(box, fill); c.drawOval(box, edge); }
        else { c.drawRoundRect(box, 8 * d, 8 * d, fill); c.drawRoundRect(box, 8 * d, 8 * d, edge); }
        if ("park".equals(kind)) {
            Paint t = new Paint(Paint.ANTI_ALIAS_FLAG);
            t.setColor(Color.WHITE);
            t.setTypeface(Typeface.create(Typeface.DEFAULT, Typeface.BOLD));
            t.setTextSize(size * 0.55f);
            t.setTextAlign(Paint.Align.CENTER);
            Paint.FontMetrics m = t.getFontMetrics();
            c.drawText("P", box.centerX(), box.centerY() - (m.ascent + m.descent) / 2, t);
            return b;
        }
        // The icon: 24 units drawn over half the square, centred, in a white line.
        float s = size * 0.56f / 24f;
        c.save();
        c.translate(box.centerX() - 12 * s, box.centerY() - 12 * s);
        Paint line = new Paint(Paint.ANTI_ALIAS_FLAG);
        line.setStyle(Paint.Style.STROKE);
        line.setColor(Color.WHITE);
        line.setStrokeWidth(2.2f * s);
        line.setStrokeCap(Paint.Cap.ROUND);
        line.setStrokeJoin(Paint.Join.ROUND);
        Matrix scale = new Matrix();
        scale.setScale(s, s);
        String shape; float[] dot = null;
        switch (kind) {
            case "cam": shape = CAMERA; dot = new float[] { 12, 13, 3.5f }; break;
            case "hut": shape = HOUSE; break;
            case "saved": shape = BOOKMARK; break;
            case "ski": shape = SKI; dot = new float[] { 12, 4.5f, 1.6f }; break;
            default: shape = PIN; dot = new float[] { 12, 10, 2.5f };
        }
        try {
            Path p = PathParser.createPathFromPathData(shape);
            p.transform(scale);
            c.drawPath(p, line);
        } catch (RuntimeException ignored) {}
        if (dot != null) c.drawCircle(dot[0] * s, dot[1] * s, dot[2] * s, line);
        c.restore();
        return b;
    }
}
