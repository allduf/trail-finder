package com.allduf.trailmap;

import android.graphics.Color;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.os.Handler;
import android.os.Looper;
import android.text.TextUtils;
import android.util.TypedValue;
import android.view.Gravity;
import android.view.MotionEvent;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.TextView;
import java.util.ArrayList;
import java.util.List;
import org.json.JSONArray;
import org.json.JSONObject;
import org.maplibre.android.camera.CameraPosition;
import org.maplibre.android.camera.CameraUpdateFactory;
import org.maplibre.android.geometry.LatLng;
import org.maplibre.android.maps.MapLibreMap;
import org.maplibre.android.maps.Style;

// A ski tour's Flyover in native 3D, the Android side of NativeFlyover.swift (native 3D parity step 3), as the web 3D
// map flies it (winter.js flyover): the camera follows the tour from its lower end to its top and on to its end, at zoom
// 13 and a 68° tilt, looking 400 m ahead and turning smoothly, 5 s a km (15 to 50 s). Any touch on the map, or Stop,
// ends it. The page (native-flyover.js) opens native 3D at the tour's start and sends, once, under "flyover":
//   { "pts": [[lon, lat], ...] (already from the lower end), "title": "Flyover: <tour>", "stop": "Stop" }
// The camera moves in one-second legs, so the page hears "moved" about once a second.
final class NativeFlyover implements NativeLayer, TrailMapScreen.TouchWatcher {
    private static final double ZOOM = 13, PITCH = 68, AHEAD = 400;
    private TrailMapScreen screen;
    private List<LatLng> pendingPts;
    private String pendingTitle = "Flyover", pendingStop = "Stop";
    private boolean flying = false, waiting = false;
    private final List<LatLng> pts = new ArrayList<>();
    private final List<Double> along = new ArrayList<>();
    private int leg = 0, legs = 0;
    private double heading = 0;
    private LinearLayout pill;
    private final Handler main = new Handler(Looper.getMainLooper());

    @Override public String key() { return "flyover"; }

    @Override
    public void added(Style style, TrailMapScreen screen) {
        if (this.screen != screen) { this.screen = screen; screen.watchTouches(this); }
        // The screen tilts in for 1.2 s when it first opens: the flight starts after that, unless the map was touched.
        if (pendingPts != null && !waiting) {
            waiting = true;
            main.postDelayed(() -> { if (!waiting) return; waiting = false; start(); }, 1400);
        }
    }

    @Override
    public void setData(String json, Style style) {
        List<LatLng> p = new ArrayList<>();
        JSONObject o;
        try {
            o = new JSONObject(json);
            JSONArray raw = o.getJSONArray("pts");
            for (int i = 0; i < raw.length(); i++) {
                JSONArray q = raw.optJSONArray(i);
                if (q == null || q.length() < 2) continue;
                double lon = q.getDouble(0), lat = q.getDouble(1);
                if (Math.abs(lat) <= 90 && Math.abs(lon) <= 180) p.add(new LatLng(lat, lon));
            }
        } catch (Exception e) { return; }
        if (p.size() < 2) return;
        pendingPts = p;
        pendingTitle = o.optString("title", "Flyover");
        pendingStop = o.optString("stop", "Stop");
        if (style != null && screen != null) start();   // the screen was already open: fly now
    }

    // ---------- the flight ----------
    private void start() {
        MapLibreMap map = screen == null ? null : screen.mapLibre();
        if (pendingPts == null || map == null || screen.isLeft()) return;
        List<LatLng> p = pendingPts;
        pendingPts = null;
        stop();
        pts.clear(); pts.addAll(p);
        along.clear(); along.add(0.0);
        for (int i = 1; i < pts.size(); i++) along.add(along.get(i - 1) + pts.get(i - 1).distanceTo(pts.get(i)));
        double total = Math.max(along.get(along.size() - 1), 1);
        double dur = Math.max(15, Math.min(50, total / 1000 * 5));   // seconds, as on the web
        legs = Math.max(1, (int) Math.round(dur));
        leg = 0;
        heading = turn(0, bearing(at(0), at(AHEAD)), 1);
        screen.stopFollowingMe();
        map.cancelTransitions();
        map.moveCamera(CameraUpdateFactory.newCameraPosition(new CameraPosition.Builder().target(at(0)).zoom(ZOOM).tilt(PITCH).bearing(heading).build()));
        flying = true;
        showPill(pendingTitle, pendingStop);
        next();
    }

    private void next() {
        MapLibreMap map = screen == null ? null : screen.mapLibre();
        if (!flying || map == null || screen.isLeft()) return;
        if (leg >= legs) { stop(); return; }
        leg++;
        double total = along.get(along.size() - 1), m = total * leg / legs;
        LatLng here = at(m), look = at(m + AHEAD);
        // Look 400 m ahead, and turn smoothly so a zigzag skin track doesn't swing the camera.
        if (here.distanceTo(look) > 20) heading = turn(heading, bearing(here, look), 0.6);
        CameraPosition cam = new CameraPosition.Builder().target(here).zoom(ZOOM).tilt(PITCH).bearing(heading).build();
        map.easeCamera(CameraUpdateFactory.newCameraPosition(cam), 1000, false, new MapLibreMap.CancelableCallback() {
            @Override public void onFinish() { next(); }
            @Override public void onCancel() {}
        });
    }

    private void stop() {
        flying = false;
        if (pill != null && pill.getParent() instanceof android.view.ViewGroup) ((android.view.ViewGroup) pill.getParent()).removeView(pill);
        pill = null;
    }

    // The point m metres along the tour.
    private LatLng at(double m) {
        if (pts.size() < 2) return pts.isEmpty() ? new LatLng(0, 0) : pts.get(0);
        m = Math.max(0, Math.min(along.get(along.size() - 1), m));
        int i = 1;
        while (i < along.size() - 1 && along.get(i) < m) i++;
        double span = along.get(i) - along.get(i - 1), t = span > 0 ? (m - along.get(i - 1)) / span : 0;
        LatLng p = pts.get(i - 1), q = pts.get(i);
        return new LatLng(p.getLatitude() + (q.getLatitude() - p.getLatitude()) * t, p.getLongitude() + (q.getLongitude() - p.getLongitude()) * t);
    }
    // From a heading part of the way to another, the short way round; the answer is kept within 0 to 360.
    static double turn(double from, double to, double f) {
        double diff = pos(to - from + 180) - 180;
        return pos(from + diff * f);
    }
    private static double pos(double x) { double r = x % 360; return r < 0 ? r + 360 : r; }
    private static double bearing(LatLng a, LatLng b) {
        return Math.toDegrees(Math.atan2((b.getLongitude() - a.getLongitude()) * Math.cos(Math.toRadians(a.getLatitude())), b.getLatitude() - a.getLatitude()));
    }

    // ---------- a touch on the map ends it ----------
    @Override
    public void onTouch(MotionEvent e) {
        if (e.getActionMasked() != MotionEvent.ACTION_DOWN) return;
        if (waiting) { waiting = false; pendingPts = null; }
        stopTapped();
    }

    // ---------- "Flyover: <tour>" and Stop, at the bottom (the web's flyover pill) ----------
    private void showPill(String title, String stopTitle) {
        if (screen == null) return;
        LinearLayout box = new LinearLayout(screen.getContext());
        box.setOrientation(LinearLayout.HORIZONTAL);
        box.setGravity(Gravity.CENTER_VERTICAL);
        box.setPadding(screen.dp(14), screen.dp(6), screen.dp(6), screen.dp(6));
        GradientDrawable bg = new GradientDrawable();
        bg.setColor(Color.argb(217, 20, 33, 26));
        bg.setCornerRadius(screen.dp(20));
        box.setBackground(bg);
        box.setClickable(true);
        TextView label = new TextView(screen.getContext());
        label.setText(title);
        label.setTextColor(Color.WHITE);
        label.setTextSize(TypedValue.COMPLEX_UNIT_SP, 14);
        label.setTypeface(Typeface.DEFAULT_BOLD);
        label.setSingleLine(true);
        label.setEllipsize(TextUtils.TruncateAt.END);
        box.addView(label, new LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1));
        TextView b = new TextView(screen.getContext());
        b.setText(stopTitle);
        b.setTextColor(Color.rgb(20, 33, 26));
        b.setTextSize(TypedValue.COMPLEX_UNIT_SP, 14);
        b.setTypeface(Typeface.DEFAULT_BOLD);
        b.setPadding(screen.dp(12), screen.dp(4), screen.dp(12), screen.dp(4));
        GradientDrawable w = new GradientDrawable();
        w.setColor(Color.WHITE);
        w.setCornerRadius(screen.dp(14));
        b.setBackground(w);
        b.setOnClickListener((v) -> stopTapped());
        LinearLayout.LayoutParams bl = new LinearLayout.LayoutParams(LinearLayout.LayoutParams.WRAP_CONTENT, LinearLayout.LayoutParams.WRAP_CONTENT);
        bl.setMarginStart(screen.dp(10));
        box.addView(b, bl);
        FrameLayout.LayoutParams at = new FrameLayout.LayoutParams(FrameLayout.LayoutParams.WRAP_CONTENT, FrameLayout.LayoutParams.WRAP_CONTENT, Gravity.BOTTOM | Gravity.CENTER_HORIZONTAL);
        at.setMargins(screen.dp(12), 0, screen.dp(12), screen.dp(24));
        screen.mapArea().addView(box, at);
        pill = box;
    }

    private void stopTapped() {
        boolean was = flying;
        stop();
        MapLibreMap map = screen == null ? null : screen.mapLibre();
        if (was && map != null) map.cancelTransitions();   // halts the leg under way
    }
}
