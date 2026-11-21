package com.allduf.trailmap;

import android.content.Intent;
import android.graphics.Color;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.net.Uri;
import android.text.TextUtils;
import android.util.TypedValue;
import android.view.Gravity;
import android.view.View;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;
import com.getcapacitor.JSObject;
import java.util.ArrayList;
import java.util.Collections;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import org.json.JSONArray;
import org.json.JSONObject;
import org.maplibre.android.geometry.LatLng;
import org.maplibre.android.maps.Style;

// The avalanche card in native 3D, the Android side of NativeAvalanche.swift (avalanche-rules). The slope colours
// themselves come through NativeGround (the page's own paint(), lossless). This card goes with them: it shows, word for
// word, what the page's own avalanche card says (native-avalanche.js reads it), so it can never say anything else:
//   { on, title, day, warn: [..], bands: [{ r: rating, n: band, c: colour, t: text colour }], line, notes: [..],
//     words: { avy, more, tap } (the card's own words in the page's language) }
// Warnings (example, expired, an old copy, no forecast) always show in full, in red, above the ratings. The notes (what
// the colours and the darker shade mean, the treeline estimate) show when the card is tapped open, with "Full forecast",
// which goes back to the page's card. Nothing shows while the page sends on: false.
// days: [{ t, on }] are the page card's own day buttons: pressing one here sends "avyDay" { i } and the page presses its
// own button, so the colours, this card and the slope card change exactly as on the page.
// spot: a slope tapped beside every trail and pin (emptyTap sends "avyTap" { lat, lon }): the page's own This spot top
// and Avalanche danger part, row by row (native-avalanche.js spotRows), in a card at the bottom that scrolls. ✕ closes
// it and any other tap replaces it, as This spot on the web map ("avySpot" { close }); "More about this spot" goes back
// to the page's This spot card there. (MapLibre Android's map click is a single tap only: a double tap zooms.)
final class NativeAvalanche implements NativeLayer {
    private static final int INK = Color.rgb(28, 36, 51), GREY = Color.rgb(92, 102, 117);
    private TrailMapScreen screen;
    private JSONObject info = new JSONObject();
    private boolean open = false;
    private LinearLayout box;
    private LinearLayout sheet, sheetRows;     // the slope card, at the bottom
    private TextView sheetTitle;
    private ScrollView sheetScroll;
    private double[] spotAt;
    private int taps = 0, asked = 0;           // the slope card asked for last (0: none): an older one arriving late stays shut

    private String word(String k, String english) {
        JSONObject w = info.optJSONObject("words");
        String s = w != null ? w.optString(k, "") : "";
        return s.isEmpty() ? english : s;
    }

    @Override public String key() { return "avy"; }

    @Override
    public void added(Style style, TrailMapScreen screen) {
        this.screen = screen;
        show();
        screen.send("avyReady", new JSObject());   // this build shows the card: the page may send the colours (native-avalanche.js)
    }

    @Override
    public void setData(String json, Style style) {
        try { info = new JSONObject(json); } catch (Exception e) { info = new JSONObject(); }
        show();
        showSpot();
    }

    // A new tap anywhere closes the slope card; a tap beside every trail and pin, while the avalanche card shows, asks
    // the page for that slope's card.
    @Override
    public void tapBegan(TrailMapScreen screen) {
        if (asked == 0 && (sheet == null || sheet.getVisibility() != View.VISIBLE)) return;
        closeSpot();
    }
    @Override
    public boolean emptyTap(LatLng at, TrailMapScreen screen) {
        if (!info.optBoolean("on", false)) return false;
        JSObject e = new JSObject();
        e.put("lat", at.getLatitude());
        e.put("lon", at.getLongitude());
        asked = ++taps;
        e.put("n", asked);
        screen.send("avyTap", e);
        return true;
    }
    private void closeSpot() {
        spotAt = null;
        asked = 0;
        if (sheet != null) sheet.setVisibility(View.GONE);
        JSObject e = new JSObject();
        e.put("close", true);
        if (screen != null) screen.send("avySpot", e);
    }

    private TextView label(String text, float sp, boolean bold, int colour) {
        TextView l = new TextView(screen.getContext());
        l.setText(text);
        l.setTextSize(TypedValue.COMPLEX_UNIT_SP, sp);
        l.setTypeface(bold ? Typeface.DEFAULT_BOLD : Typeface.DEFAULT);
        l.setTextColor(colour);
        return l;
    }
    private static List<String> strings(JSONArray a) {
        List<String> out = new ArrayList<>();
        if (a != null) for (int i = 0; i < a.length(); i++) { String s = a.optString(i, ""); if (!s.isEmpty()) out.add(s); }
        return out;
    }
    private void add(View v, int gapDp) {
        LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT);
        if (box.getChildCount() > 0) lp.topMargin = screen.dp(gapDp);
        box.addView(v, lp);
    }

    private void show() {
        if (screen == null) return;
        if (box == null) {
            box = new LinearLayout(screen.getContext());
            box.setOrientation(LinearLayout.VERTICAL);
            GradientDrawable bg = new GradientDrawable();
            bg.setColor(Color.argb(245, 255, 255, 255));
            bg.setCornerRadius(screen.dp(10));
            box.setBackground(bg);
            box.setElevation(screen.dp(3));
            box.setPadding(screen.dp(10), screen.dp(8), screen.dp(10), screen.dp(8));
            box.setOnClickListener((v) -> { open = !open; show(); });
            LinearLayout.LayoutParams at = new LinearLayout.LayoutParams(screen.dp(300), LinearLayout.LayoutParams.WRAP_CONTENT);
            screen.infoColumn().addView(box, at);   // under the ground keys (sun and shade can stay on with avalanche)
        }
        box.removeAllViews();
        if (!info.optBoolean("on", false)) { box.setVisibility(View.GONE); return; }
        box.setVisibility(View.VISIBLE);
        List<String> head = new ArrayList<>();
        for (String s : new String[] { word("avy", "Avalanche"), info.optString("title", ""), info.optString("day", "") }) if (!s.isEmpty()) head.add(s);
        add(label(String.join(" · ", head), 13, true, INK), 4);
        for (String w : strings(info.optJSONArray("warn"))) add(label(w, 11.5f, true, Color.rgb(176, 18, 26)), 4);
        JSONArray bands = info.optJSONArray("bands");
        if (bands != null && bands.length() > 0) {
            LinearLayout row = new LinearLayout(screen.getContext());
            row.setOrientation(LinearLayout.HORIZONTAL);
            for (int i = 0; i < bands.length(); i++) {
                JSONObject b = bands.optJSONObject(i);
                if (b == null) continue;
                LinearLayout chip = new LinearLayout(screen.getContext());
                chip.setOrientation(LinearLayout.VERTICAL);
                GradientDrawable cb = new GradientDrawable();
                cb.setColor(NativeGround.colour(b.optString("c", ""), Color.GRAY));
                cb.setCornerRadius(screen.dp(6));
                chip.setBackground(cb);
                chip.setPadding(screen.dp(6), screen.dp(4), screen.dp(6), screen.dp(4));
                int fg = NativeGround.colour(b.optString("t", ""), INK);
                chip.addView(label(b.optString("r", ""), 11.5f, true, fg));
                chip.addView(label(b.optString("n", ""), 10, false, fg));
                LinearLayout.LayoutParams cp = new LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1);
                if (row.getChildCount() > 0) cp.setMarginStart(screen.dp(4));
                row.addView(chip, cp);
            }
            add(row, 4);
        }
        JSONArray days = info.optJSONArray("days");
        if (days != null && days.length() > 1) {
            LinearLayout row = new LinearLayout(screen.getContext());
            row.setOrientation(LinearLayout.HORIZONTAL);
            for (int i = 0; i < days.length(); i++) {
                JSONObject d = days.optJSONObject(i);
                if (d == null) continue;
                boolean on = d.optBoolean("on", false);
                TextView b = label(d.optString("t", ""), 11.5f, true, on ? Color.WHITE : INK);
                b.setGravity(Gravity.CENTER);
                b.setMaxLines(1);
                b.setEllipsize(TextUtils.TruncateAt.END);
                GradientDrawable bg = new GradientDrawable();
                bg.setColor(on ? INK : Color.WHITE);
                bg.setCornerRadius(screen.dp(13));
                bg.setStroke(screen.dp(1), on ? INK : Color.rgb(204, 212, 222));
                b.setBackground(bg);
                b.setSelected(on);
                final int idx = i;
                b.setOnClickListener((v) -> { JSObject e = new JSObject(); e.put("i", idx); screen.send("avyDay", e); });
                LinearLayout.LayoutParams bp = new LinearLayout.LayoutParams(0, screen.dp(26), 1);
                if (row.getChildCount() > 0) bp.setMarginStart(screen.dp(4));
                row.addView(b, bp);
            }
            add(row, 4);
        }
        String line = info.optString("line", "");
        if (!line.isEmpty()) add(label(line, 11.5f, false, INK), 4);
        List<String> notes = strings(info.optJSONArray("notes"));
        if (open) {
            for (String n : notes) add(label(n, 10.5f, false, GREY), 4);
            TextView more = label(word("more", "Full forecast") + " ›", 13, true, Color.rgb(31, 94, 224));
            more.setPadding(0, screen.dp(4), 0, screen.dp(2));
            more.setOnClickListener((v) -> screen.leave(false, false, Collections.singletonMap("avy", true)));
            add(more, 2);
        } else if (!notes.isEmpty()) {
            add(label(word("tap", "Tap for what the colours mean"), 10.5f, false, Color.rgb(31, 94, 224)), 4);
        }
    }

    // ---------- the slope card ----------
    private void buildSheet() {
        sheet = new LinearLayout(screen.getContext());
        sheet.setOrientation(LinearLayout.VERTICAL);
        GradientDrawable bg = new GradientDrawable();
        bg.setColor(Color.WHITE);
        bg.setCornerRadius(screen.dp(16));
        sheet.setBackground(bg);
        sheet.setElevation(screen.dp(8));
        sheet.setPadding(screen.dp(14), screen.dp(8), screen.dp(6), screen.dp(12));
        sheet.setClickable(true);   // touches on the card stay off the map
        sheet.setVisibility(View.GONE);
        LinearLayout top = new LinearLayout(screen.getContext());
        top.setOrientation(LinearLayout.HORIZONTAL);
        top.setGravity(Gravity.CENTER_VERTICAL);
        sheetTitle = label("", 17, true, INK);
        top.addView(sheetTitle, new LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1));
        TextView shut = label("✕", 18, true, INK);
        shut.setGravity(Gravity.CENTER);
        shut.setOnClickListener((v) -> closeSpot());
        top.addView(shut, new LinearLayout.LayoutParams(screen.dp(40), screen.dp(40)));
        sheet.addView(top);
        // As tall as its rows, up to half the map; the rest scrolls.
        sheetScroll = new ScrollView(screen.getContext()) {
            @Override protected void onMeasure(int w, int h) {
                int max = screen.mapArea().getHeight() / 2 - screen.dp(60);
                super.onMeasure(w, MeasureSpec.makeMeasureSpec(max > 0 ? max : screen.dp(300), MeasureSpec.AT_MOST));
            }
        };
        sheetRows = new LinearLayout(screen.getContext());
        sheetRows.setOrientation(LinearLayout.VERTICAL);
        sheetRows.setPadding(0, 0, screen.dp(8), 0);
        sheetScroll.addView(sheetRows, new FrameLayout.LayoutParams(FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.WRAP_CONTENT));
        sheet.addView(sheetScroll, new LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT));
        FrameLayout.LayoutParams at = new FrameLayout.LayoutParams(FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.WRAP_CONTENT, Gravity.BOTTOM);
        at.setMargins(screen.dp(12), 0, screen.dp(12), screen.dp(12));
        screen.mapArea().addView(sheet, at);
    }
    private void row(View v) {
        LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT);
        if (sheetRows.getChildCount() > 0) lp.topMargin = screen.dp(6);
        sheetRows.addView(v, lp);
    }
    // A box with a colour edge (the page's terrain light and stats boxes) holding a column of labels.
    private View edged(int colour, View... views) {
        LinearLayout v = new LinearLayout(screen.getContext());
        v.setOrientation(LinearLayout.HORIZONTAL);
        GradientDrawable bg = new GradientDrawable();
        bg.setColor(Color.argb(41, Color.red(colour), Color.green(colour), Color.blue(colour)));
        bg.setCornerRadius(screen.dp(8));
        v.setBackground(bg);
        View bar = new View(screen.getContext());
        bar.setBackgroundColor(colour);
        v.addView(bar, new LinearLayout.LayoutParams(screen.dp(5), LinearLayout.LayoutParams.MATCH_PARENT));
        LinearLayout col = new LinearLayout(screen.getContext());
        col.setOrientation(LinearLayout.VERTICAL);
        col.setPadding(screen.dp(7), screen.dp(5), screen.dp(6), screen.dp(5));
        for (View x : views) col.addView(x);
        v.addView(col, new LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1));
        return v;
    }
    // A line with a colour mark in front (a slope's map colour, a terrain sign, Avalanche Canada's advice).
    private View marked(int colour, int widthDp, TextView t) {
        LinearLayout r = new LinearLayout(screen.getContext());
        r.setOrientation(LinearLayout.HORIZONTAL);
        View sw = new View(screen.getContext());
        GradientDrawable bg = new GradientDrawable();
        bg.setColor(colour);
        bg.setCornerRadius(screen.dp(2));
        sw.setBackground(bg);
        LinearLayout.LayoutParams sp = new LinearLayout.LayoutParams(screen.dp(widthDp), LinearLayout.LayoutParams.MATCH_PARENT);
        sp.setMarginEnd(screen.dp(8));
        r.addView(sw, sp);
        r.addView(t, new LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1));
        return r;
    }

    private void showSpot() {
        if (screen == null) return;
        if (sheet == null) buildSheet();
        JSONObject sp = info.optBoolean("on", false) ? info.optJSONObject("spot") : null;
        if (sp == null || !sp.has("lat") || !sp.has("lon") || asked == 0 || sp.optInt("n", -1) != asked) { spotAt = null; sheet.setVisibility(View.GONE); return; }
        spotAt = new double[] { sp.optDouble("lat"), sp.optDouble("lon") };
        int red = Color.rgb(176, 18, 26);
        sheetTitle.setText(sp.optString("title", "This spot"));
        sheetRows.removeAllViews();
        JSONArray rows = sp.optJSONArray("rows");
        if (rows != null) {
            for (int i = 0; i < rows.length(); i++) {
                JSONObject r = rows.optJSONObject(i);
                if (r == null) continue;
                String t = r.optString("t", "");
                switch (r.optString("k", "")) {
                    case "h": row(label(t, 14, true, INK)); break;
                    case "warn": row(label(t, 12, true, red)); break;
                    case "note": row(label(t, 11.5f, false, GREY)); break;
                    case "chip": row(marked(NativeGround.colour(r.optString("c", ""), Color.LTGRAY), 6, label(t, 12.5f, false, INK))); break;
                    case "check": row(edged(NativeGround.colour(r.optString("c", ""), Color.LTGRAY), label(t, 14, true, INK), label(r.optString("s", ""), 11.5f, false, INK))); break;
                    case "stats": case "days": {
                        boolean stats = r.optString("k").equals("stats");
                        LinearLayout line = new LinearLayout(screen.getContext());
                        line.setOrientation(LinearLayout.HORIZONTAL);
                        JSONArray d = r.optJSONArray("d");
                        for (int j = 0; d != null && j < d.length(); j++) {
                            JSONObject x = d.optJSONObject(j);
                            if (x == null) continue;
                            View cell;
                            if (stats) cell = edged(NativeGround.colour(x.optString("c", ""), Color.LTGRAY), label(x.optString("t", ""), 13, true, INK), label(x.optString("s", ""), 10, false, GREY));
                            else {
                                LinearLayout col = new LinearLayout(screen.getContext());
                                col.setOrientation(LinearLayout.VERTICAL);
                                TextView n = label(x.optString("n", ""), 10.5f, false, GREY);
                                n.setGravity(Gravity.CENTER);
                                col.addView(n);
                                TextView c = label(x.optString("t", ""), 11, true, NativeGround.colour(x.optString("f", ""), Color.BLACK));
                                c.setGravity(Gravity.CENTER);
                                c.setMaxLines(1);
                                c.setEllipsize(TextUtils.TruncateAt.END);
                                GradientDrawable cb = new GradientDrawable();
                                cb.setColor(NativeGround.colour(x.optString("c", ""), Color.LTGRAY));
                                cb.setCornerRadius(screen.dp(5));
                                c.setBackground(cb);
                                c.setPadding(screen.dp(2), screen.dp(2), screen.dp(2), screen.dp(2));
                                col.addView(c);
                                cell = col;
                            }
                            LinearLayout.LayoutParams cp = new LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1);
                            if (line.getChildCount() > 0) cp.setMarginStart(screen.dp(4));
                            line.addView(cell, cp);
                        }
                        row(line);
                        break;
                    }
                    case "prob": {
                        LinearLayout col = new LinearLayout(screen.getContext());
                        col.setOrientation(LinearLayout.VERTICAL);
                        col.addView(label(t, 12.5f, true, INK));
                        for (String x : strings(r.optJSONArray("d"))) col.addView(label(x, 11.5f, false, INK));
                        col.setAlpha(r.optBoolean("off", false) ? 0.45f : 1f);
                        row(col);
                        break;
                    }
                    case "sign": row(marked(r.optBoolean("hi", false) ? Color.rgb(224, 49, 49) : Color.rgb(173, 181, 189), 3, label(t, 12, false, INK))); break;
                    case "li": row(marked(Color.rgb(204, 204, 204), 3, label(t, 12, false, INK))); break;
                    case "link": {
                        String u = r.optString("u", "");
                        if (!u.startsWith("https://")) break;
                        TextView a = label(t + " ↗", 12.5f, true, Color.rgb(31, 94, 224));
                        a.setOnClickListener((v) -> {
                            try { screen.getContext().startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse(u)).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)); } catch (Exception ignored) {}
                        });
                        row(a);
                        break;
                    }
                    default: row(label(t, 12.5f, false, INK));
                }
            }
            String more = sp.optString("more", "");
            TextView m = label((more.isEmpty() ? "More about this spot" : more) + " ›", 13, true, Color.rgb(31, 94, 224));
            m.setPadding(0, screen.dp(4), 0, screen.dp(2));
            m.setOnClickListener((v) -> {
                if (spotAt == null) return;
                Map<String, Object> x = new HashMap<>();
                x.put("avySpot", true);
                x.put("spotLat", spotAt[0]);
                x.put("spotLon", spotAt[1]);
                screen.leave(false, false, x);
            });
            row(m);
        } else {
            String l = sp.optString("loading", "");
            row(label(l.isEmpty() ? "Reading the terrain…" : l, 12, false, GREY));
        }
        boolean fresh = sheet.getVisibility() != View.VISIBLE;
        sheet.setVisibility(View.VISIBLE);
        if (fresh) sheetScroll.scrollTo(0, 0);   // a new slope from the top; a new day keeps the place
    }
}
