package com.allduf.trailmap;

import static org.maplibre.android.style.expressions.Expression.raw;

import android.app.AlertDialog;
import android.graphics.Bitmap;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.Paint;
import android.graphics.Path;
import android.graphics.RectF;
import android.graphics.Typeface;
import android.os.Handler;
import android.os.Looper;
import com.getcapacitor.JSObject;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import org.json.JSONArray;
import org.json.JSONObject;
import org.maplibre.android.geometry.LatLng;
import org.maplibre.android.maps.Style;
import org.maplibre.android.style.expressions.Expression;
import org.maplibre.android.style.layers.CircleLayer;
import org.maplibre.android.style.layers.LineLayer;
import org.maplibre.android.style.layers.Property;
import org.maplibre.android.style.layers.PropertyFactory;
import org.maplibre.android.style.layers.SymbolLayer;
import org.maplibre.android.style.sources.GeoJsonSource;

// The map tools in native 3D, the Android side of NativeTools.swift: Plan a route (each sport's own planner), Record
// (Ride mode), Compass and Measure, working exactly as on the web because they ARE the web's: the page's own tool, with
// its own bar (distance, climb, Undo, Ride it, Pause, Stop...), shows above or below the native map, which shrinks to the
// space between (TrailMapScreen.setToolInsets); a tap on the map goes to the page's tool as a tap on its map, and what
// the tool draws (the route, the recorded track, the sight line, the measured line) comes back here, over the trails.
// A "Tools" button under Back lists the sport's tools (the page sends them, in its language) and starts the one picked.
// Page -> here (key "tools"): "<state>\u0001<version>\u0001<shapes>", where
//   state: { "tool": "" | "plan" | "ride" | "compass" | "measure", "cover": a dialog of the page's is open over
//            everything (the screen steps aside until it's answered), "top", "bottom": the page's bar, in points from the
//            screen's top and bottom edges, "taps": the tool takes map taps, "follow": "heading" | "follow" | "none" |
//            "" (leave it), "menu": [the tools' names], "words": { English: the page's language } }
//   version: the shapes' version; shapes (only read when the version changes, may be empty then):
//            { "lines": GeoJSON (c colour, w width, o opacity, d 1 dashed), "dots": GeoJSON (r, c stroke, w, f fill, fo),
//              "labels": GeoJSON (t text, c colour), "arrows": GeoJSON (b bearing from north, c fill, e edge, img) }
// Here -> page: "toolStart" { i } (the menu's number), "toolTap" { lat, lon, i } (i: the trail tapped, -1 for none).
// Nothing is drawn while no tool has anything on the map. No travel advice and no new words of our own: the words are
// the page's (CLAUDE.md).
final class NativeTools implements NativeLayer {
    private static final String LINES = "tf-tool-lines", DOTS = "tf-tool-dots", LABELS = "tf-tool-labels", ARROWS = "tf-tool-arrows";
    private static final String EMPTY = "{\"type\":\"FeatureCollection\",\"features\":[]}";
    private static final ExecutorService READER = Executors.newSingleThreadExecutor();
    private final Handler main = new Handler(Looper.getMainLooper());
    private TrailMapScreen screen;
    private boolean button = false, taps = false, cover = false;
    private String tool = "", follow = "", version = "";
    private float top = 0, bottom = 0;
    private List<String> menu = new ArrayList<>();
    private Map<String, String> words = new HashMap<>();
    private String lines = EMPTY, dots = EMPTY, labels = EMPTY, arrows = EMPTY;
    private List<String[]> labelTexts = new ArrayList<>();   // (text, colour) of each label, for its picture
    private List<String[]> arrowInks = new ArrayList<>();    // (fill, edge) of each direction arrow, for its picture
    private final Set<String> made = new HashSet<>();        // pictures already on the current style
    private int round = 0;
    private AlertDialog picking;

    private String t(String s) { String w = words.get(s); return w != null ? w : s; }

    @Override public String key() { return "tools"; }
    @Override public boolean wantsTaps() { return taps && !tool.isEmpty() && !cover; }

    @Override
    public void added(Style style, TrailMapScreen screen) {
        this.screen = screen;
        made.clear();
        style.addSource(new GeoJsonSource(LINES, lines));
        style.addSource(new GeoJsonSource(DOTS, dots));
        style.addSource(new GeoJsonSource(LABELS, labels));
        style.addSource(new GeoJsonSource(ARROWS, arrows));
        for (boolean dashed : new boolean[] { false, true }) {
            LineLayer l = new LineLayer(LINES + (dashed ? "-dash" : ""), LINES);
            l.setFilter(raw("[\"==\", [\"to-number\", [\"get\", \"d\"], 0], " + (dashed ? 1 : 0) + "]"));
            l.setProperties(PropertyFactory.lineColor(raw("[\"to-color\", [\"get\", \"c\"]]")),
                PropertyFactory.lineWidth(raw("[\"to-number\", [\"get\", \"w\"], 4]")),
                PropertyFactory.lineOpacity(raw("[\"to-number\", [\"get\", \"o\"], 1]")),
                PropertyFactory.lineJoin(Property.LINE_JOIN_ROUND),
                PropertyFactory.lineCap(dashed ? Property.LINE_CAP_BUTT : Property.LINE_CAP_ROUND));
            if (dashed) l.setProperties(PropertyFactory.lineDasharray(new Float[] { 2f, 1.6f }));
            style.addLayer(l);
        }
        CircleLayer d = new CircleLayer(DOTS, DOTS);
        d.setProperties(PropertyFactory.circleRadius(raw("[\"to-number\", [\"get\", \"r\"], 5]")),
            PropertyFactory.circleColor(raw("[\"to-color\", [\"get\", \"f\"]]")),
            PropertyFactory.circleOpacity(raw("[\"to-number\", [\"get\", \"fo\"], 1]")),
            PropertyFactory.circleStrokeColor(raw("[\"to-color\", [\"get\", \"c\"]]")),
            PropertyFactory.circleStrokeWidth(raw("[\"to-number\", [\"get\", \"w\"], 0]")),
            PropertyFactory.circlePitchAlignment(Property.CIRCLE_PITCH_ALIGNMENT_VIEWPORT));
        style.addLayer(d);
        // Direction arrows (which way the planned or followed route goes): flat on the ground, turning with the map.
        SymbolLayer a = new SymbolLayer(ARROWS, ARROWS);
        a.setProperties(PropertyFactory.iconImage(Expression.get("img")),
            PropertyFactory.iconRotate(raw("[\"to-number\", [\"get\", \"b\"], 0]")),
            PropertyFactory.iconAllowOverlap(true), PropertyFactory.iconIgnorePlacement(true),
            PropertyFactory.iconPitchAlignment(Property.ICON_PITCH_ALIGNMENT_MAP),
            PropertyFactory.iconRotationAlignment(Property.ICON_ROTATION_ALIGNMENT_MAP));
        style.addLayer(a);
        // Labels (distances, point numbers) as pictures, as on the iPhone (the page names each one "tftl:<colour>:<text>").
        SymbolLayer x = new SymbolLayer(LABELS, LABELS);
        x.setProperties(PropertyFactory.iconImage(Expression.get("img")), PropertyFactory.iconAllowOverlap(true),
            PropertyFactory.iconPitchAlignment(Property.ICON_PITCH_ALIGNMENT_VIEWPORT),
            PropertyFactory.iconRotationAlignment(Property.ICON_ROTATION_ALIGNMENT_VIEWPORT));
        style.addLayer(x);
        addPictures(style);
        if (!button) {
            button = true;
            screen.addToolButton(t("Tools"), this::pick);
        }
        apply(screen);
        if (!follow.isEmpty() && !"none".equals(follow)) screen.followUser(follow);   // a tool already on when the screen opened
    }

    private void pick() {
        if (screen == null || menu.isEmpty() || (picking != null && picking.isShowing())) return;
        String[] names = menu.toArray(new String[0]);
        picking = new AlertDialog.Builder(screen.getContext())
            .setItems(names, (dlg, i) -> {
                JSObject o = new JSObject();
                o.put("i", i);
                if (screen != null) screen.send("toolStart", o);
            })
            .setNegativeButton(t("Cancel"), null)
            .show();
    }

    @Override
    public boolean mapTapped(LatLng at, int trail, TrailMapScreen screen) {
        if (!wantsTaps()) return false;
        JSObject o = new JSObject();
        o.put("lat", at.getLatitude());
        o.put("lon", at.getLongitude());
        o.put("i", trail);
        screen.send("toolTap", o);
        return true;
    }

    @Override
    public void setData(String text, Style style) {
        String[] parts = text.split("\u0001", 3);
        JSONObject o;
        try { o = new JSONObject(parts[0]); } catch (Exception e) { return; }
        String was = tool;
        tool = o.optString("tool", "");
        taps = o.optBoolean("taps", false);
        cover = o.optBoolean("cover", false);
        top = (float) o.optDouble("top", 0);
        bottom = (float) o.optDouble("bottom", 0);
        JSONArray m = o.optJSONArray("menu");
        if (m != null) { List<String> l = new ArrayList<>(); for (int i = 0; i < m.length(); i++) l.add(m.optString(i)); menu = l; }
        JSONObject w = o.optJSONObject("words");
        if (w != null) {
            Map<String, String> mw = new HashMap<>();
            for (java.util.Iterator<String> it = w.keys(); it.hasNext(); ) { String k = it.next(); mw.put(k, w.optString(k, k)); }
            words = mw;
        }
        String f = o.optString("follow", "");
        String followNow = !f.equals(follow) ? f : "";
        follow = f;
        if (screen != null) {
            if (!tool.isEmpty() && !tool.equals(was) && !"sun".equals(tool)) screen.hideCard();   // the sun's time bar takes no taps
            apply(screen);
            if (!followNow.isEmpty()) screen.followUser(followNow);
        }
        if (parts.length < 3 || parts[1].equals(version)) return;
        version = parts[1];
        final String geo = parts[2];
        final int r = ++round;
        READER.execute(() -> {
            String l = EMPTY, p = EMPTY, x = EMPTY, ar = EMPTY;
            List<String[]> texts = new ArrayList<>(), inks = new ArrayList<>();
            try {
                JSONObject g = new JSONObject(geo);
                l = fc(g, "lines"); p = fc(g, "dots"); x = fc(g, "labels"); ar = fc(g, "arrows");
                Set<String> seen = new LinkedHashSet<>();
                for (JSONObject pr : props(g, "arrows")) {
                    String c = pr.optString("c", ""), e = pr.optString("e", "");
                    if (!c.isEmpty() && !e.isEmpty() && seen.add(c + "\u0001" + e)) inks.add(new String[] { c, e });
                }
                for (JSONObject pr : props(g, "labels")) {
                    if (pr.has("t")) texts.add(new String[] { pr.optString("t"), pr.optString("c", "#14211a") });
                }
            } catch (Exception ignored) {}
            final String fl = l, fp = p, fx = x, far = ar;
            main.post(() -> {
                if (r != round) return;
                lines = fl; dots = fp; labels = fx; arrows = far;
                labelTexts = texts; arrowInks = inks;
                Style st = screen == null || screen.mapLibre() == null ? null : screen.mapLibre().getStyle();
                if (st == null || !st.isFullyLoaded()) return;
                addPictures(st);
                set(st, LINES, fl); set(st, DOTS, fp); set(st, LABELS, fx); set(st, ARROWS, far);
            });
        });
    }
    private static String fc(JSONObject g, String k) { JSONObject v = g.optJSONObject(k); return v != null ? v.toString() : EMPTY; }
    private static List<JSONObject> props(JSONObject g, String k) {
        List<JSONObject> out = new ArrayList<>();
        JSONObject v = g.optJSONObject(k);
        JSONArray fs = v != null ? v.optJSONArray("features") : null;
        if (fs != null) for (int i = 0; i < fs.length(); i++) {
            JSONObject f = fs.optJSONObject(i), pr = f != null ? f.optJSONObject("properties") : null;
            if (pr != null) out.add(pr);
        }
        return out;
    }
    private static void set(Style st, String id, String json) { GeoJsonSource s = st.getSourceAs(id); if (s != null) s.setGeoJson(json); }

    // No room left for a map between the page's bars (a tall sheet on a small phone): the screen steps aside as for a
    // dialog, so the bar's buttons (Stop, Undo...) are never hidden under the map.
    private void apply(TrailMapScreen s) {
        float t = tool.isEmpty() ? 0 : top, b = tool.isEmpty() ? 0 : bottom;
        float h = s.heightDp();
        boolean full = h > 0 && t + b > h - 160;
        s.stepAside(cover || full);
        if (!cover && !full) s.setToolInsets(t, b);
    }

    // A label's picture: its text on a white rounded box, named by the page as "tftl:<colour>:<text>"; an arrow's
    // "tfta:<fill>:<edge>".
    private void addPictures(Style style) {
        float d = screen != null ? screen.getResources().getDisplayMetrics().density : 2;
        for (String[] tc : labelTexts) {
            String name = "tftl:" + tc[1] + ":" + tc[0];
            if (made.add(name)) style.addImage(name, picture(tc[0], tc[1], d));
        }
        for (String[] fe : arrowInks) {
            String name = "tfta:" + fe[0] + ":" + fe[1];
            if (made.add(name)) style.addImage(name, arrow(fe[0], fe[1], d));
        }
    }
    // A direction arrow pointing up (north at bearing 0), its fill with an edge round it, as the flat map draws it.
    private static Bitmap arrow(String fill, String edge, float d) {
        int n = Math.round(20 * d);
        Bitmap b = Bitmap.createBitmap(n, n, Bitmap.Config.ARGB_8888);
        Canvas c = new Canvas(b);
        Path p = new Path();
        p.moveTo(10 * d, 3 * d);
        p.lineTo(17 * d, 16 * d);
        p.lineTo(10 * d, 12.5f * d);
        p.lineTo(3 * d, 16 * d);
        p.close();
        Paint pt = new Paint(Paint.ANTI_ALIAS_FLAG);
        pt.setStyle(Paint.Style.STROKE);
        pt.setStrokeJoin(Paint.Join.ROUND);
        pt.setStrokeWidth(2 * d);
        pt.setColor(TrailMapScreen.colour(edge, Color.WHITE));
        c.drawPath(p, pt);
        pt.setStyle(Paint.Style.FILL);
        pt.setColor(TrailMapScreen.colour(fill, Color.rgb(74, 15, 176)));
        c.drawPath(p, pt);
        return b;
    }
    private static Bitmap picture(String text, String colour, float d) {
        int ink = TrailMapScreen.colour(colour, Color.rgb(20, 33, 26));
        Paint tp = new Paint(Paint.ANTI_ALIAS_FLAG);
        tp.setTypeface(Typeface.DEFAULT_BOLD);
        tp.setTextSize(12 * d);
        tp.setColor(ink);
        Paint.FontMetrics fm = tp.getFontMetrics();
        int w = (int) Math.ceil(tp.measureText(text) + 12 * d), h = (int) Math.ceil(fm.descent - fm.ascent + 6 * d);
        Bitmap b = Bitmap.createBitmap(Math.max(1, w), Math.max(1, h), Bitmap.Config.ARGB_8888);
        Canvas c = new Canvas(b);
        RectF r = new RectF(0.5f * d, 0.5f * d, w - 0.5f * d, h - 0.5f * d);
        Paint bg = new Paint(Paint.ANTI_ALIAS_FLAG);
        bg.setColor(Color.argb(242, 255, 255, 255));
        c.drawRoundRect(r, h / 2f, h / 2f, bg);
        bg.setStyle(Paint.Style.STROKE);
        bg.setStrokeWidth(d);
        bg.setColor(Color.argb(128, Color.red(ink), Color.green(ink), Color.blue(ink)));
        c.drawRoundRect(r, h / 2f, h / 2f, bg);
        c.drawText(text, 6 * d, 3 * d - fm.ascent, tp);
        return b;
    }
}
