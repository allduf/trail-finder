package com.allduf.trailmap;

import android.app.Activity;
import android.graphics.Color;
import android.view.MotionEvent;
import android.view.View;
import android.view.ViewGroup;
import android.webkit.WebView;
import androidx.activity.OnBackPressedCallback;
import androidx.activity.ComponentActivity;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.util.HashMap;
import java.util.Iterator;
import java.util.Map;

// The Android side of the iPhone's TrailMap plugin (ios-app/plugins/TrailMap): the same calls, so native-map.js on the
// website works unchanged in the Android app (alex 2026-11-21: native 3D on Android too).
//   open({ lat, lon, zoom, bearing, base, threeD, winter, esri, lang, lines, dots, dashes, layers }): the map screen
//     over the page (TrailMapScreen.java); a second open while it's up only sends the new data.
//   update({ lines, dots, dashes }): the trails again, as the page's map follows.
//   layer({ key, data }): one feature's data (NativeLayers.java; "base" is the map style picked on the page).
//   close(): leaves it, as Back does.
//   features(): { keys } the native 3D features this build draws (the page opens the web 3D map for the others).
//   offline({ areas: [{ id, box, boxes, ski, sharp }] }): the saved areas this phone keeps its own copy of for native 3D
//     (OfflinePacks.java); answers { areas: { id: { pct, saved, active, bytes } } }, and "offlinePacks" with the same as
//     the copies download.
// Events: "moved" and "closed", as on the iPhone (TrailMapScreen.java), and "offlinePacks".
@CapacitorPlugin(name = "TrailMap")
public class TrailMapPlugin extends Plugin {
    private TrailMapScreen screen;
    private TrailMapScreen closing;   // a screen fading out after "closed": still torn down if the app goes meanwhile
    private OnBackPressedCallback back;

    @PluginMethod
    public void open(PluginCall call) {
        double lat = call.getDouble("lat", 50.1), lon = call.getDouble("lon", -122.95);
        double zoom = call.getDouble("zoom", 12.0), bearing = call.getDouble("bearing", 0.0);
        String base = call.getString("base", "osm"), esri = call.getString("esri");
        boolean threeD = Boolean.TRUE.equals(call.getBoolean("threeD", false)), winter = Boolean.TRUE.equals(call.getBoolean("winter", false));
        boolean fr = "fr".equals(call.getString("lang"));
        String lines = call.getString("lines", ""), dots = call.getString("dots", ""), dashes = call.getString("dashes", "");
        // under: the page's buttons, menus and cards stay on top, this map behind the web view (TrailMapScreen under).
        String underData = call.getString("under");
        // flat: opens seen straight down and stays so: the one map on Winter (alex 2026-11-22), where 2D is this map from
        // above and 3D only tips it (applyUnder "tilt"). Only under the page. Same as the iPhone's.
        boolean flat = Boolean.TRUE.equals(call.getBoolean("flat", false));
        Map<String, String> extra = new HashMap<>();
        JSObject layers = call.getObject("layers", new JSObject());
        if (layers != null) for (Iterator<String> it = layers.keys(); it.hasNext(); ) {
            String k = it.next();
            Object v = layers.opt(k);
            if (v instanceof String) extra.put(k, (String) v);
        }
        Activity a = getActivity();
        if (a == null) { call.reject("No screen to show the map on"); return; }
        a.runOnUiThread(() -> {
            if (screen != null && !screen.isLeft()) {
                screen.setData(lines, dots, dashes);
                for (Map.Entry<String, String> e : extra.entrySet()) screen.setLayer(e.getKey(), e.getValue());
                call.resolve();
                return;
            }
            ViewGroup host = a.findViewById(android.R.id.content);
            if (host == null) { call.reject("No screen to show the map on"); return; }
            WebView web = getBridge() != null ? getBridge().getWebView() : null;
            boolean under = underData != null && threeD && web != null && web.getParent() instanceof ViewGroup;
            if (flat && !under) { call.reject("A flat map opens only under the page"); return; }
            TrailMapScreen s;
            try {
                s = new TrailMapScreen(a, this::fromScreen, lat, lon, zoom, bearing, base, threeD, winter, esri, fr, under);
            } catch (Throwable t) {
                // The map engine couldn't start on this phone (no 3D graphics support): the page keeps its own map.
                Throwable c = t.getCause() != null ? t.getCause() : t;
                call.reject("The native map couldn't start: " + c);
                return;
            }
            if (flat) s.noTiltIn();
            s.setData(lines, dots, dashes);
            for (Map.Entry<String, String> e : extra.entrySet()) s.setLayer(e.getKey(), e.getValue());
            screen = s;
            if (under) {
                // Behind the web view, which turns see-through where its map was (the page hides its flat map once open
                // answers); a touch where the page shows nothing of its own comes to this map (passTouches).
                ViewGroup parent = (ViewGroup) web.getParent();
                parent.addView(s, parent.indexOfChild(web), new ViewGroup.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
                android.graphics.drawable.Drawable bg = web.getBackground();
                webBg = bg instanceof android.graphics.drawable.ColorDrawable ? ((android.graphics.drawable.ColorDrawable) bg).getColor() : Color.parseColor("#f2efe7");
                web.setBackgroundColor(Color.TRANSPARENT);
                passTouches(web, s);
                if (underData != null) s.setLayer("under", underData);
            } else {
                s.setAlpha(0);
                host.addView(s, new ViewGroup.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
            }
            s.onStart();
            s.onResume();
            // Under the page, Back is the page's (it closes its own sheets and cards first, then this map: native.js).
            if (!under) watchBack(a, true);
            // Seamless from the flat map (as on the iPhone): the screen stays unseen over the page's flat map (it takes the
            // touches all the same) until its own map has drawn the same spot, then shows in a quick fade and (3D) tilts
            // up from flat. At most 2.5 s (no signal, slow tiles).
            boolean[] shown = { false };
            Runnable show = () -> {
                if (shown[0]) return;
                shown[0] = true;
                s.onReady = null;
                if (s.isLeft()) { call.resolve(); return; }
                if (s.under) {   // the page hides its flat map once this answers (under: true), then the tilt
                    JSObject r = new JSObject();
                    r.put("under", true);
                    call.resolve(r);
                    s.postDelayed(s::tiltIn, 150);
                    return;
                }
                s.animate().alpha(1).setDuration(180).withEndAction(() -> { s.tiltIn(); call.resolve(); }).start();
            };
            s.onReady = show;
            s.postDelayed(show, 2500);
            // Still not one frame drawn 8 s after opening: the page goes back to its own flat map with a note ("notDrawn",
            // as the iPhone's), instead of its buttons over a black screen.
            s.postDelayed(() -> { if (!s.isLeft() && s.framesDrawn == 0) s.send("notDrawn", new JSObject()); }, 8000);
        });
    }

    // A touch on the web view where the page shows nothing of its own goes to the map under it, for the whole gesture.
    private boolean routing = false;
    private int webBg = 0xfff2efe7;   // the web view's own background, put back after (capacitor.config.json's by default)
    private void passTouches(WebView web, TrailMapScreen s) {
        routing = false;
        web.setOnTouchListener((v, e) -> {
            if (s.isLeft()) { routing = false; return false; }
            int act = e.getActionMasked();
            if (act == MotionEvent.ACTION_DOWN) routing = s.mapTakes(e.getX(), e.getY());   // the page's grid is in its own pixels
            if (!routing) return false;
            MotionEvent c = MotionEvent.obtain(e);
            c.offsetLocation(v.getLeft() - s.getLeft(), v.getTop() - s.getTop());
            s.dispatchTouchEvent(c);
            c.recycle();
            if (act == MotionEvent.ACTION_UP || act == MotionEvent.ACTION_CANCEL) routing = false;
            return true;
        });
    }
    // The web view as it was, once the map under it goes.
    private void unpass() {
        WebView web = getBridge() != null ? getBridge().getWebView() : null;
        if (web == null) return;
        web.setOnTouchListener(null);
        web.setBackgroundColor(webBg);
        routing = false;
    }

    // Events from the screen to the page; "closed" also lets the page have its Back button again.
    private void fromScreen(String name, JSObject data) {
        notifyListeners(name, data);
        if ("closed".equals(name)) {
            if (screen != null && screen.under) unpass();
            closing = screen;
            screen = null;
            Activity a = getActivity();
            if (a != null) watchBack(a, false);
        }
    }

    // The phone's Back button: closes the card first, then the map (back to the page), as "← Back" does.
    private void watchBack(Activity a, boolean on) {
        if (!(a instanceof ComponentActivity)) return;
        if (!on) { if (back != null) { back.remove(); back = null; } return; }
        if (back != null) back.remove();
        back = new OnBackPressedCallback(true) {
            @Override public void handleOnBackPressed() {
                TrailMapScreen s = screen;
                if (s == null) { remove(); back = null; return; }
                if (s.pageHasBack()) {
                    // The page's own Back (Capacitor's): it closes its tool or dialog.
                    setEnabled(false);
                    Activity a = getActivity();
                    if (a instanceof ComponentActivity) ((ComponentActivity) a).getOnBackPressedDispatcher().onBackPressed();
                    setEnabled(true);
                } else if (s.cardShown()) s.hideCard();
                else s.leave(false, false, null);
            }
        };
        ((ComponentActivity) a).getOnBackPressedDispatcher().addCallback(back);
    }

    @PluginMethod
    public void update(PluginCall call) {
        String lines = call.getString("lines", ""), dots = call.getString("dots", ""), dashes = call.getString("dashes", "");
        run(call, () -> { if (screen != null) screen.setData(lines, dots, dashes); });
    }

    @PluginMethod
    public void layer(PluginCall call) {
        String key = call.getString("key", ""), data = call.getString("data", "");
        run(call, () -> { if (screen != null) screen.setLayer(key, data); });
    }

    @PluginMethod
    public void features(PluginCall call) {
        JSObject r = new JSObject();
        r.put("keys", new JSArray(TrailMapScreen.featureKeys()));
        call.resolve(r);
    }

    @PluginMethod
    public void offline(PluginCall call) {
        org.json.JSONArray areas;
        try { areas = call.getArray("areas", new JSArray()); } catch (Exception e) { areas = new JSArray(); }
        final org.json.JSONArray list = areas;
        Activity a = getActivity();
        if (a == null) { call.resolve(); return; }
        a.runOnUiThread(() -> {
            OfflinePacks.shared.onChange = (st) -> notifyListeners("offlinePacks", st);
            OfflinePacks.shared.sync(a, list, call::resolve);
        });
    }

    @PluginMethod
    public void close(PluginCall call) {
        run(call, () -> { if (screen != null) screen.leave(false, false, null); });
    }

    private void run(PluginCall call, Runnable r) {
        Activity a = getActivity();
        if (a == null) { call.resolve(); return; }
        a.runOnUiThread(() -> { r.run(); call.resolve(); });
    }

    // The map follows the app's own comings and goings.
    @Override protected void handleOnStart() { if (screen != null) screen.onStart(); }
    @Override protected void handleOnResume() { if (screen != null) screen.onResume(); }
    @Override protected void handleOnPause() { if (screen != null) screen.onPause(); }
    @Override protected void handleOnStop() { if (screen != null) screen.onStop(); }
    @Override protected void handleOnDestroy() {
        if (screen != null) { if (screen.under) unpass(); screen.destroy(); screen = null; }
        if (closing != null) { closing.destroy(); closing = null; }
        if (back != null) { back.remove(); back = null; }
    }
}
