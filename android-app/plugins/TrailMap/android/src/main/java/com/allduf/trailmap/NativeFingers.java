package com.allduf.trailmap;

import android.content.Context;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.Paint;
import android.graphics.PointF;
import android.graphics.RectF;
import android.graphics.Typeface;
import android.os.Handler;
import android.os.Looper;
import android.view.HapticFeedbackConstants;
import android.view.MotionEvent;
import android.view.View;
import android.widget.FrameLayout;
import java.util.Locale;
import org.json.JSONObject;
import org.maplibre.android.geometry.LatLng;
import org.maplibre.android.maps.MapLibreMap;
import org.maplibre.android.maps.Style;
import org.maplibre.android.maps.UiSettings;

// Two-finger measure in native 3D, the Android side of NativeFingers.swift (alex 2026-11-21, "small extras"): hold two
// fingers still on the map for a moment and a line joins them, with the straight-line distance between the two spots of
// ground under them. Slide the fingers to measure something else; the map stays still meanwhile. Lift a finger and the
// result stays a moment, then fades. The web map does the same (finger-measure.js).
// Page -> here (key "fingers"): { "line": the page's words for "straight line" }. Nothing is drawn until two fingers are
// held, nothing is sent back, and nothing changes the map's own data. The map keeps getting every touch (its gestures
// are only switched off while measuring).
final class NativeFingers implements NativeLayer, TrailMapScreen.TouchWatcher {
    // It showed while moving the map (alex 2026-11-22: "it appears when I don't really want to see it"): both fingers
    // must come down together (a second finger added to a pan never counts) and stay still for 1 s (alex: "hold still for 1sec").
    private static final long HOLD_MS = 1000, TOGETHER_MS = 250;
    private long firstAt = 0;
    private TrailMapScreen screen;
    private Drawing drawing;
    private String line = "straight line";
    private final Handler main = new Handler(Looper.getMainLooper());
    private PointF a0, b0;                       // where the two fingers came down
    private boolean measuring = false;
    private boolean[] held;                      // the map's gestures before measuring
    private final Runnable start = this::begin;
    private final Runnable fade = () -> { if (drawing != null) drawing.animate().alpha(0).setDuration(400).withEndAction(() -> drawing.setVisibility(View.GONE)).start(); };
    private MotionEvent last;

    @Override public String key() { return "fingers"; }

    @Override
    public void added(Style style, TrailMapScreen screen) {
        if (this.screen == screen) return;       // a new base map: the same screen, already set up
        this.screen = screen;
        drawing = new Drawing(screen.getContext());
        drawing.setVisibility(View.GONE);
        screen.addOverMap(drawing);
        screen.watchTouches(this);
    }

    @Override
    public void setData(String json, Style style) {
        try {
            String w = new JSONObject(json).optString("line", "");
            if (!w.isEmpty()) line = w;
        } catch (Exception ignored) {}
    }

    // Every touch on the map comes here first (never kept from the map).
    @Override
    public void onTouch(MotionEvent e) {
        int act = e.getActionMasked();
        if (last != null) last.recycle();
        last = MotionEvent.obtain(e);
        if (measuring) {
            if (act == MotionEvent.ACTION_MOVE && e.getPointerCount() >= 2) draw(e);
            if (act == MotionEvent.ACTION_POINTER_UP || act == MotionEvent.ACTION_UP || act == MotionEvent.ACTION_CANCEL) end();
            return;
        }
        if (act == MotionEvent.ACTION_DOWN) firstAt = e.getEventTime();
        if (act == MotionEvent.ACTION_POINTER_DOWN && e.getPointerCount() == 2 && e.getEventTime() - firstAt <= TOGETHER_MS) {
            a0 = new PointF(e.getX(0), e.getY(0));
            b0 = new PointF(e.getX(1), e.getY(1));
            main.removeCallbacks(start);
            main.postDelayed(start, HOLD_MS);
        } else if (act == MotionEvent.ACTION_MOVE && a0 != null && e.getPointerCount() >= 2) {
            // Fingers that move are a pinch, a twist or a tilt: the map's own.
            float tol = screen.dp(8);
            if (Math.hypot(e.getX(0) - a0.x, e.getY(0) - a0.y) > tol || Math.hypot(e.getX(1) - b0.x, e.getY(1) - b0.y) > tol) cancel();
        } else if (act != MotionEvent.ACTION_MOVE && act != MotionEvent.ACTION_DOWN) {
            cancel();
        }
    }

    private void cancel() { main.removeCallbacks(start); a0 = b0 = null; }

    private void begin() {
        MapLibreMap m = screen == null ? null : screen.mapLibre();
        if (m == null || last == null || last.getPointerCount() < 2 || screen.isLeft()) return;
        measuring = true;
        main.removeCallbacks(fade);
        UiSettings u = m.getUiSettings();
        held = new boolean[] { u.isZoomGesturesEnabled(), u.isRotateGesturesEnabled(), u.isTiltGesturesEnabled(), u.isScrollGesturesEnabled() };
        u.setZoomGesturesEnabled(false); u.setRotateGesturesEnabled(false); u.setTiltGesturesEnabled(false); u.setScrollGesturesEnabled(false);
        drawing.animate().cancel();
        drawing.setAlpha(1);
        drawing.setVisibility(View.VISIBLE);
        drawing.performHapticFeedback(HapticFeedbackConstants.LONG_PRESS);
        draw(last);
    }

    private void end() {
        measuring = false;
        a0 = b0 = null;
        MapLibreMap m = screen == null ? null : screen.mapLibre();
        if (m != null && held != null) {
            UiSettings u = m.getUiSettings();
            u.setZoomGesturesEnabled(held[0]); u.setRotateGesturesEnabled(held[1]); u.setTiltGesturesEnabled(held[2]); u.setScrollGesturesEnabled(held[3]);
        }
        held = null;
        main.removeCallbacks(fade);
        main.postDelayed(fade, 2500);
    }

    private void draw(MotionEvent e) {
        MapLibreMap m = screen.mapLibre();
        if (m == null || e.getPointerCount() < 2) return;
        PointF a = new PointF(e.getX(0), e.getY(0)), b = new PointF(e.getX(1), e.getY(1));
        LatLng ca = m.getProjection().fromScreenLocation(a), cb = m.getProjection().fromScreenLocation(b);
        // A finger on the sky (far tilted views) has no ground under it: the line shows, with no distance. Only a spot
        // that lands back under the finger counts as ground.
        String text = null;
        if (onGround(m, a, ca) && onGround(m, b, cb)) text = format(ca.distanceTo(cb)) + " " + line;
        drawing.show(a, b, text);
    }

    private boolean onGround(MapLibreMap m, PointF p, LatLng c) {
        if (c == null || Double.isNaN(c.getLatitude()) || Double.isNaN(c.getLongitude())) return false;
        PointF q = m.getProjection().toScreenLocation(c);
        return Math.hypot(q.x - p.x, q.y - p.y) <= screen.dp(12);
    }

    // As the web map writes it (finger-measure.js): metres under 1 km, then km.
    static String format(double m) {
        if (m < 1000) {
            double step = m < 100 ? 1 : 10;
            return Math.round(Math.round(m / step) * step) + " m";
        }
        return String.format(Locale.ROOT, m < 10000 ? "%.2f km" : "%.1f km", m / 1000);
    }

    // The line, its two ends and the distance above the fingers.
    private static final class Drawing extends View {
        private final Paint casing = new Paint(Paint.ANTI_ALIAS_FLAG), stroke = new Paint(Paint.ANTI_ALIAS_FLAG);
        private final Paint pill = new Paint(Paint.ANTI_ALIAS_FLAG), ink = new Paint(Paint.ANTI_ALIAS_FLAG);
        private PointF a, b;
        private String text;
        private final float d;

        Drawing(Context c) {
            super(c);
            d = c.getResources().getDisplayMetrics().density;
            casing.setColor(Color.argb(217, 20, 33, 26)); casing.setStrokeWidth(5 * d); casing.setStrokeCap(Paint.Cap.ROUND);
            stroke.setColor(Color.WHITE); stroke.setStrokeWidth(2.5f * d); stroke.setStrokeCap(Paint.Cap.ROUND);
            pill.setColor(Color.argb(245, 255, 255, 255));
            ink.setColor(Color.rgb(20, 33, 26)); ink.setTextSize(14 * c.getResources().getDisplayMetrics().scaledDensity);
            ink.setTypeface(Typeface.DEFAULT_BOLD); ink.setTextAlign(Paint.Align.CENTER);
            setClickable(false);
            setFocusable(false);
        }

        void show(PointF a, PointF b, String text) { this.a = a; this.b = b; this.text = text; invalidate(); }

        @Override
        protected void onDraw(Canvas c) {
            if (a == null || b == null) return;
            for (Paint p : new Paint[] { casing, stroke }) {
                c.drawLine(a.x, a.y, b.x, b.y, p);
                Paint dot = new Paint(p);
                dot.setStyle(Paint.Style.FILL);
                c.drawCircle(a.x, a.y, p == casing ? 6.5f * d : 5 * d, dot);
                c.drawCircle(b.x, b.y, p == casing ? 6.5f * d : 5 * d, dot);
            }
            if (text == null) return;
            float w = ink.measureText(text) + 24 * d, h = 28 * d;
            float mx = (a.x + b.x) / 2, my = Math.min(a.y, b.y) - 70 * d;   // above the fingers, so they don't hide it
            float x = Math.min(Math.max(8 * d, mx - w / 2), getWidth() - w - 8 * d), y = Math.min(Math.max(8 * d, my), getHeight() - h - 8 * d);
            c.drawRoundRect(new RectF(x, y, x + w, y + h), 14 * d, 14 * d, pill);
            Paint.FontMetrics fm = ink.getFontMetrics();
            c.drawText(text, x + w / 2, y + h / 2 - (fm.ascent + fm.descent) / 2, ink);
        }
    }
}
