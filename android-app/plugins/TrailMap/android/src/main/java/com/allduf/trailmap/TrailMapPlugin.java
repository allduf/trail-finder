package com.allduf.trailmap;

import android.app.Activity;
import android.view.ViewGroup;
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
// Not yet on Android: offline() (the iPhone's own copies of offline areas); the page gets "not implemented" and goes on.
// Events: "moved" and "closed", as on the iPhone (TrailMapScreen.java).
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
            TrailMapScreen s;
            try {
                s = new TrailMapScreen(a, this::fromScreen, lat, lon, zoom, bearing, base, threeD, winter, esri, fr);
            } catch (Throwable t) {
                // The map engine couldn't start on this phone (no 3D graphics support): the page keeps its own map.
                call.reject("The native map couldn't start: " + t.getMessage());
                return;
            }
            s.setData(lines, dots, dashes);
            for (Map.Entry<String, String> e : extra.entrySet()) s.setLayer(e.getKey(), e.getValue());
            screen = s;
            s.setAlpha(0);
            host.addView(s, new ViewGroup.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
            s.onStart();
            s.onResume();
            watchBack(a, true);
            s.animate().alpha(1).setDuration(250).withEndAction(call::resolve).start();
        });
    }

    // Events from the screen to the page; "closed" also lets the page have its Back button again.
    private void fromScreen(String name, JSObject data) {
        notifyListeners(name, data);
        if ("closed".equals(name)) {
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
                if (s.cardShown()) s.hideCard();
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
        if (screen != null) { screen.destroy(); screen = null; }
        if (closing != null) { closing.destroy(); closing = null; }
        if (back != null) { back.remove(); back = null; }
    }
}
