package com.allduf.trailmap;

import android.graphics.Color;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.util.TypedValue;
import android.view.View;
import android.widget.LinearLayout;
import android.widget.TextView;
import com.getcapacitor.JSObject;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import org.json.JSONArray;
import org.json.JSONObject;
import org.maplibre.android.maps.Style;

// The avalanche card in native 3D, the Android side of NativeAvalanche.swift (avalanche-rules). The slope colours
// themselves come through NativeGround (the page's own paint(), lossless). This card goes with them: it shows, word for
// word, what the page's own avalanche card says (native-avalanche.js reads it), so it can never say anything else:
//   { on, title, day, warn: [..], bands: [{ r: rating, n: band, c: colour, t: text colour }], line, notes: [..],
//     words: { avy, more, tap } (the card's own words in the page's language) }
// Warnings (example, expired, an old copy, no forecast) always show in full, in red, above the ratings. The notes (what
// the colours and the darker shade mean, the treeline estimate) show when the card is tapped open, with "Full forecast",
// which goes back to the page's card. Nothing shows while the page sends on: false.
final class NativeAvalanche implements NativeLayer {
    private static final int INK = Color.rgb(28, 36, 51), GREY = Color.rgb(92, 102, 117);
    private TrailMapScreen screen;
    private JSONObject info = new JSONObject();
    private boolean open = false;
    private LinearLayout box;

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
}
