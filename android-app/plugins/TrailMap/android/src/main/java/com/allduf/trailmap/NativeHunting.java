package com.allduf.trailmap;

import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.Paint;
import android.os.Handler;
import android.os.Looper;
import android.util.Base64;
import com.getcapacitor.JSObject;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import org.json.JSONArray;
import org.json.JSONObject;
import org.maplibre.android.geometry.LatLng;
import org.maplibre.android.geometry.LatLngQuad;
import org.maplibre.android.maps.Style;
import org.maplibre.android.style.expressions.Expression;
import org.maplibre.android.style.layers.CircleLayer;
import org.maplibre.android.style.layers.FillLayer;
import org.maplibre.android.style.layers.Layer;
import org.maplibre.android.style.layers.LineLayer;
import org.maplibre.android.style.layers.PropertyFactory;
import org.maplibre.android.style.layers.RasterLayer;
import org.maplibre.android.style.layers.SymbolLayer;
import org.maplibre.android.style.sources.GeoJsonSource;
import org.maplibre.android.style.sources.ImageSource;
import org.maplibre.android.style.sources.RasterSource;
import org.maplibre.android.style.sources.Source;
import org.maplibre.android.style.sources.TileSet;

// Hunting in native 3D, the Android side of NativeHunting.swift: what the web 3D map adds for Hunting (hunting.js sync3d).
// The zone, park and closure outlines and the scent cone's edge already come with the trails (native-map.js copies every
// line on the flat map); this adds what isn't a line there:
//   - the parks, towns and closures as see-through fills, closed ones hatched red (Hunting's "Parks, towns and closures");
//   - the zone names (Hunting zones);
//   - the scent cone's orange fill (Scent cone);
//   - the range rings round the spot (Range rings) and the glassing view's 5 km circle;
//   - the glassing view (What can I see from here?): the ground hidden from the spot darkened, worked out on the page;
//   - the spot pin;
//   - the picture layers (land, property lines, forest, burns, cut blocks, wetlands, far from roads): raster tiles from
//     the same map servers as the flat map, the addresses worked out on the page (hunting.js nativePics).
// The page sends everything near the view as text under the key "hunt", only in Hunting and only what's switched on
// there, so other sports draw nothing from here. Slope angle and aspect, and the pictures the phone repaints, are the
// ground layer's (NativeGround): until this build draws that, the page opens the web 3D map for them.
final class NativeHunting implements NativeLayer {
    private static final int ORANGE = Color.rgb(0xd9, 0x48, 0x0f);   // ORANGE in hunting.js
    private static final int ZONE = Color.rgb(0x34, 0x3a, 0x40);     // C.zone
    private static final String[] SHAPES = { "fills", "labels", "cone", "rings", "spot" };
    private static final String EMPTY = "{\"type\":\"FeatureCollection\",\"features\":[]}";
    private static final ExecutorService READER = Executors.newSingleThreadExecutor();

    // A picture layer: one raster source + layer per entry ("hn-pic:" + id); its address keyed so a change reloads it.
    private static final class Pic {
        final String id, tiles, attr; final int z; final Integer to; final double opacity; final double[] bounds;
        Pic(String id, String tiles, int z, Integer to, double opacity, double[] bounds, String attr) {
            this.id = id; this.tiles = tiles; this.z = z; this.to = to; this.opacity = opacity; this.bounds = bounds; this.attr = attr;
        }
        @Override public boolean equals(Object o) {
            if (!(o instanceof Pic)) return false;
            Pic p = (Pic) o;
            return id.equals(p.id) && tiles.equals(p.tiles) && attr.equals(p.attr) && z == p.z && Objects.equals(to, p.to)
                && opacity == p.opacity && java.util.Arrays.equals(bounds, p.bounds);
        }
        @Override public int hashCode() { return Objects.hash(id, tiles, z, to); }
    }
    private static final class Glass {
        final String at; final Bitmap image; final LatLngQuad quad;
        Glass(String at, Bitmap image, LatLngQuad quad) { this.at = at; this.image = image; this.quad = quad; }
    }

    private Map<String, String> parsed = new HashMap<>();
    private Glass glass;
    private String glassShown;                           // the glassing view on the current style (its "at")
    private int round = 0;
    private List<Pic> pics = new ArrayList<>();
    private final Map<String, Pic> picsShown = new HashMap<>();   // on the current style, by id
    private TrailMapScreen screen;
    private final Handler main = new Handler(Looper.getMainLooper());

    @Override public String key() { return "hunt"; }

    @Override
    public void added(Style style, TrailMapScreen screen) {
        this.screen = screen;
        if (style.getImage("hn-hatch") == null) style.addImage("hn-hatch", hatch(screen.getResources().getDisplayMetrics().density));
        for (String k : SHAPES) {
            String id = "hn-" + k;
            if (style.getSource(id) == null) style.addSource(new GeoJsonSource(id, parsed.containsKey(k) ? parsed.get(k) : EMPTY));
        }
        if (style.getLayer("hn-fill") != null) return;
        glassShown = null;   // a new style has no glassing view or pictures yet
        picsShown.clear();
        screen.send("huntPics", new JSObject());   // tells the page this build draws the picture layers (native-map.js webOnly)

        // Under the trails, bottom to top: a marker the ground pictures go under, the picture layers and the glassing
        // view (added when there are some), the fills, the cone, the rings.
        FillLayer bottom = new FillLayer("hn-bottom", "hn-fills");
        bottom.setProperties(PropertyFactory.visibility("none"));
        under(style, bottom);
        FillLayer fill = new FillLayer("hn-fill", "hn-fills");
        fill.setFilter(Expression.raw("[\"==\", [\"get\", \"h\"], 0]"));
        fill.setProperties(PropertyFactory.fillColor(Expression.raw("[\"to-color\", [\"get\", \"c\"]]")),
            PropertyFactory.fillOpacity(Expression.raw("[\"to-number\", [\"get\", \"o\"]]")));
        under(style, fill);
        FillLayer hatch = new FillLayer("hn-hatch", "hn-fills");
        hatch.setFilter(Expression.raw("[\"==\", [\"get\", \"h\"], 1]"));
        hatch.setProperties(PropertyFactory.fillPattern("hn-hatch"));
        under(style, hatch);
        FillLayer cone = new FillLayer("hn-cone", "hn-cone");
        cone.setProperties(PropertyFactory.fillColor(ORANGE), PropertyFactory.fillOpacity(0.25f));
        under(style, cone);
        // Rings: a white line under dark dashes (as on the page), the glassing circle orange dashes. Dashes in line widths.
        int dark = Color.rgb(0x21, 0x25, 0x29);
        ring(style, "hn-ring-w", "w", Color.WHITE, 3.5f, 0.55f, null);
        ring(style, "hn-ring-d", "d", dark, 1.5f, 0.8f, new Float[] { 3.33f, 3.33f });
        ring(style, "hn-ring-g", "g", ORANGE, 2f, 0.9f, new Float[] { 3f, 3f });

        // Over the trails: the zone names (a second line with the zone's own name from zoom 8, as on the page), the pin.
        label(style, "hn-labels", "t", 5, 8f);
        label(style, "hn-labels-long", "tl", 8, null);
        CircleLayer outer = new CircleLayer("hn-spot", "hn-spot");
        outer.setProperties(PropertyFactory.circleRadius(11.5f), PropertyFactory.circleColor(Color.WHITE), PropertyFactory.circleOpacity(0.4f),
            PropertyFactory.circleStrokeColor(ORANGE), PropertyFactory.circleStrokeWidth(3f));
        style.addLayer(outer);
        CircleLayer inner = new CircleLayer("hn-spot-dot", "hn-spot");
        inner.setProperties(PropertyFactory.circleRadius(4f), PropertyFactory.circleColor(ORANGE),
            PropertyFactory.circleStrokeColor(Color.WHITE), PropertyFactory.circleStrokeWidth(1.5f));
        style.addLayer(inner);
        showGlass(style);
        showPics(style);
    }

    private void under(Style style, Layer l) {
        String below = screen != null ? screen.trailsBottomLayer() : null;
        if (below != null && style.getLayer(below) != null) style.addLayerBelow(l, below); else style.addLayer(l);
    }

    private void ring(Style style, String id, String kind, int colour, float width, float opacity, Float[] dash) {
        LineLayer l = new LineLayer(id, "hn-rings");
        l.setFilter(Expression.raw("[\"==\", [\"get\", \"k\"], " + JSONObject.quote(kind) + "]"));
        l.setProperties(PropertyFactory.lineColor(colour), PropertyFactory.lineWidth(width), PropertyFactory.lineOpacity(opacity));
        if (dash != null) l.setProperties(PropertyFactory.lineDasharray(dash));
        under(style, l);
    }

    private void label(Style style, String id, String field, float minZoom, Float maxZoom) {
        SymbolLayer l = new SymbolLayer(id, "hn-labels");
        l.setProperties(
            PropertyFactory.textField(Expression.get(field)),
            PropertyFactory.textFont(new String[] { "Noto Sans Bold" }),
            PropertyFactory.textSize(13f),
            PropertyFactory.textAllowOverlap(false),
            PropertyFactory.textColor(ZONE),
            PropertyFactory.textHaloColor(Color.WHITE),
            PropertyFactory.textHaloWidth(2f));
        l.setMinZoom(minZoom);
        if (maxZoom != null) l.setMaxZoom(maxZoom);
        style.addLayer(l);
    }

    // The page's text: { fills, labels, cone, rings, spot } as GeoJSON, glass: { at, box: [w, s, e, n], png (base64) } or
    // null, pics: [{ id, tiles, z, to, opacity, bounds, attr }]. The page sends the picture only when it's new: without
    // png, the same "at" keeps the one there. Read off the main thread (a zone-dense view can be a few hundred KB).
    @Override
    public void setData(String json, Style style) {
        final int mine = ++round;
        final Glass prior = glass;
        READER.execute(() -> {
            JSONObject o;
            try { o = new JSONObject(json); } catch (Exception e) { return; }
            Map<String, String> shapes = new HashMap<>();
            for (String k : SHAPES) {
                JSONObject fc = o.optJSONObject(k);
                if (fc != null) shapes.put(k, fc.toString());
            }
            JSONObject g = o.optJSONObject("glass");
            Glass gl = null;
            if (g != null) {
                String at = g.optString("at", "");
                Bitmap img = null;
                String b64 = g.optString("png", "");
                if (!b64.isEmpty()) {
                    try { byte[] bytes = Base64.decode(b64, Base64.DEFAULT); img = BitmapFactory.decodeByteArray(bytes, 0, bytes.length); }
                    catch (IllegalArgumentException ignored) {}
                }
                if (img == null && prior != null && prior.at.equals(at)) img = prior.image;
                JSONArray box = g.optJSONArray("box");
                if (img != null && box != null && box.length() == 4) {
                    double w = box.optDouble(0), s = box.optDouble(1), e = box.optDouble(2), n = box.optDouble(3);
                    gl = new Glass(at, img, new LatLngQuad(new LatLng(n, w), new LatLng(n, e), new LatLng(s, e), new LatLng(s, w)));
                }
            }
            List<Pic> ps = new ArrayList<>();
            JSONArray raw = o.optJSONArray("pics");
            if (raw != null) for (int i = 0; i < raw.length(); i++) {
                JSONObject p = raw.optJSONObject(i);
                if (p == null || !p.has("id") || !p.has("tiles") || !p.has("z")) continue;
                double[] b = new double[0];
                JSONArray bb = p.optJSONArray("bounds");
                if (bb != null && bb.length() == 4) b = new double[] { bb.optDouble(0), bb.optDouble(1), bb.optDouble(2), bb.optDouble(3) };
                ps.add(new Pic(p.optString("id"), p.optString("tiles"), p.optInt("z"), p.has("to") && !p.isNull("to") ? p.optInt("to") : null,
                    p.optDouble("opacity", 1), b, p.optString("attr", "")));
            }
            final Glass fg = gl;
            main.post(() -> {
                if (mine != round) return;
                parsed = shapes;
                glass = fg;
                pics = ps;
                // Only a style this feature has set up (added() runs again for a new one, with what's here now).
                Style now = screen == null || screen.mapLibre() == null ? null : screen.mapLibre().getStyle();
                if (now == null || !now.isFullyLoaded() || now.getLayer("hn-fill") == null) return;
                for (String k : SHAPES) {
                    GeoJsonSource src = now.getSourceAs("hn-" + k);
                    if (src != null) src.setGeoJson(shapes.containsKey(k) ? shapes.get(k) : EMPTY);
                }
                showGlass(now);
                showPics(now);
            });
        });
    }

    // The picture layers: taken away when gone or changed, added under everything else of Hunting's (and the trails).
    // Tile zoom = the page's Leaflet zoom (256 px tiles); the native map's zoom is one less. An entry made for one zoom
    // (its address changes with the zoom) shows only there; the last one also deeper, stretched.
    private void showPics(Style style) {
        Map<String, Pic> want = new LinkedHashMap<>();
        for (Pic p : pics) want.putIfAbsent(p.id, p);
        for (String id : new ArrayList<>(picsShown.keySet())) {
            if (picsShown.get(id).equals(want.get(id))) continue;
            removePic(style, id);
            picsShown.remove(id);
        }
        // In the page's order, bottom to top (as the flat map's): each goes under the next one already there.
        for (int i = 0; i < pics.size(); i++) {
            Pic p = pics.get(i);
            if (picsShown.containsKey(p.id)) continue;
            removePic(style, p.id);   // never two of one id
            String id = "hn-pic:" + p.id;
            TileSet set = new TileSet("2.2.0", p.tiles);
            set.setMinZoom(p.z);
            set.setMaxZoom(p.to != null ? p.to : 19);
            if (p.bounds.length == 4) set.setBounds((float) p.bounds[0], (float) p.bounds[1], (float) p.bounds[2], (float) p.bounds[3]);
            if (!p.attr.isEmpty()) set.setAttribution(p.attr);
            style.addSource(new RasterSource(id, set, 256));
            RasterLayer l = new RasterLayer(id, id);
            l.setProperties(PropertyFactory.rasterOpacity((float) p.opacity), PropertyFactory.rasterFadeDuration(0f));
            l.setMinZoom(p.z - 1);
            if (p.to != null) l.setMaxZoom(p.to);
            String next = null;
            for (int j = i + 1; j < pics.size() && next == null; j++)
                if (picsShown.containsKey(pics.get(j).id) && style.getLayer("hn-pic:" + pics.get(j).id) != null) next = "hn-pic:" + pics.get(j).id;
            if (next == null) next = style.getLayer("hn-glass") != null ? "hn-glass" : style.getLayer("hn-fill") != null ? "hn-fill" : null;
            if (next != null) style.addLayerBelow(l, next); else under(style, l);
            picsShown.put(p.id, p);
        }
    }

    private static void removePic(Style style, String id) {
        Layer l = style.getLayer("hn-pic:" + id);
        if (l != null) style.removeLayer(l);
        Source s = style.getSource("hn-pic:" + id);
        if (s != null) style.removeSource(s);
    }

    // The glassing view: an image on the ground under the fills, put in, moved or taken away.
    private void showGlass(Style style) {
        Source s = style.getSource("hn-glass");
        if (glass == null) {
            Layer l = style.getLayer("hn-glass");
            if (l != null) style.removeLayer(l);
            if (s != null) style.removeSource(s);
            glassShown = null;
            return;
        }
        if (s instanceof ImageSource) {
            if (!glass.at.equals(glassShown)) {
                ((ImageSource) s).setImage(glass.image);
                ((ImageSource) s).setCoordinates(glass.quad);
                glassShown = glass.at;
            }
            return;
        }
        glassShown = glass.at;
        style.addSource(new ImageSource("hn-glass", glass.quad, glass.image));
        RasterLayer l = new RasterLayer("hn-glass", "hn-glass");
        l.setProperties(PropertyFactory.rasterFadeDuration(0f));
        if (style.getLayer("hn-fill") != null) style.addLayerBelow(l, "hn-fill"); else style.addLayer(l);
    }

    // Closed areas' red stripes, as hunting.js makeHatch(16, 3.5) (bolder on the 3D photos), 16 dp a side.
    private static Bitmap hatch(float d) {
        int n = Math.max(16, Math.round(16 * d));
        float u = n / 16f;
        Bitmap b = Bitmap.createBitmap(n, n, Bitmap.Config.ARGB_8888);
        Canvas c = new Canvas(b);
        Paint p = new Paint(Paint.ANTI_ALIAS_FLAG);
        p.setColor(Color.rgb(0xe0, 0x31, 0x31));
        p.setStrokeWidth(3.5f * u);
        p.setStyle(Paint.Style.STROKE);
        c.drawLine(-u, n + u, n + u, -u, p);
        c.drawLine(-u, u, u, -u, p);
        c.drawLine(n - u, n + u, n + u, n - u, p);
        return b;
    }
}
