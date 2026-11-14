package com.allduf.trailgps;

import android.Manifest;
import android.content.pm.PackageManager;
import android.os.Build;
import androidx.core.app.ActivityCompat;
import androidx.core.content.ContextCompat;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;
import java.util.ArrayList;
import java.util.List;
import org.json.JSONArray;
import org.json.JSONObject;

// The same calls as the iPhone's TrailGps (ios-app/plugins/TrailGps), so the website (native-gps.js, navigate.js,
// go-there.js, live.js) works unchanged in the Android app: start, stop, fixes, speak, cues, live, activity, turns,
// and the "fix" / "error" events. The work is in GpsEngine; RideService keeps it going with the screen off.
@CapacitorPlugin(
    name = "TrailGps",
    permissions = {
        @Permission(alias = "location", strings = { Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION })
    }
)
public class TrailGpsPlugin extends Plugin {
    private GpsEngine engine;

    @Override
    public void load() {
        engine = GpsEngine.get(getContext());
        engine.appActive = true;
        engine.listener = new GpsEngine.Listener() {
            @Override public void onFix(JSONObject fix) {
                try { notifyListeners("fix", JSObject.fromJSONObject(fix)); } catch (Exception ignored) {}
            }
            @Override public void onError(String code) {
                JSObject o = new JSObject();
                o.put("code", code);
                notifyListeners("error", o);
            }
        };
    }

    @Override
    protected void handleOnResume() {
        if (engine == null) return;
        engine.appActive = true;
        // Live location waiting for the page's own GPS question to be answered (like iOS's authorization change)
        if (allowed()) engine.liveAllowed();
    }

    @Override
    protected void handleOnPause() { if (engine != null) engine.appActive = false; }

    private boolean allowed() {
        return ContextCompat.checkSelfPermission(getContext(), Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED ||
            ContextCompat.checkSelfPermission(getContext(), Manifest.permission.ACCESS_COARSE_LOCATION) == PackageManager.PERMISSION_GRANTED;
    }

    // Android 13+: the ride notification needs its own permission. Asked once, after location; the ride records either way.
    private void askNotifications() {
        if (Build.VERSION.SDK_INT < 33) return;
        if (ContextCompat.checkSelfPermission(getContext(), "android.permission.POST_NOTIFICATIONS") == PackageManager.PERMISSION_GRANTED) return;
        android.content.SharedPreferences prefs = getContext().getSharedPreferences("trailgps", 0);
        if (prefs.getBoolean("askedNotif", false)) return;
        prefs.edit().putBoolean("askedNotif", true).apply();
        ActivityCompat.requestPermissions(getActivity(), new String[] { "android.permission.POST_NOTIFICATIONS" }, 4712);
    }

    @PluginMethod
    public void start(PluginCall call) {
        if (!allowed()) {
            requestPermissionForAlias("location", call, "startAnswered");
            return;
        }
        doStart(call);
    }

    @PermissionCallback
    private void startAnswered(PluginCall call) {
        if (!allowed()) { call.reject("Location is turned off for Trail Finder", "DENIED"); return; }
        doStart(call);
    }

    private void doStart(PluginCall call) {
        engine.startRecording();
        askNotifications();
        JSObject r = new JSObject();
        r.put("running", true);
        call.resolve(r);
    }

    @PluginMethod
    public void stop(PluginCall call) {
        engine.stopRecording();
        call.resolve();
    }

    // The fixes kept since `after` (ms since 1970), oldest first.
    @PluginMethod
    public void fixes(PluginCall call) {
        double after = call.getDouble("after", 0.0);
        JSArray list = new JSArray();
        for (JSONObject f : engine.fixesAfter(after)) list.put(f);
        JSObject r = new JSObject();
        r.put("fixes", list);
        r.put("running", engine.running);
        call.resolve(r);
    }

    @PluginMethod
    public void speak(PluginCall call) {
        String text = call.getString("text", "");
        if (text != null && !text.isEmpty()) engine.say(text);
        call.resolve();
    }

    // A planned ride's turns ([lat, lon, metres, text]), for when the screen is off. An empty list clears them.
    @PluginMethod
    public void cues(PluginCall call) {
        List<double[]> pts = new ArrayList<>();
        List<String> texts = new ArrayList<>();
        JSArray list = call.getArray("list", new JSArray());
        for (int i = 0; i < list.length(); i++) {
            JSONArray a = list.optJSONArray(i);
            if (a == null || a.length() < 4) continue;
            String text = a.optString(3, null);
            if (text == null || a.isNull(0) || a.isNull(1) || a.isNull(2)) continue;
            pts.add(new double[] { a.optDouble(0), a.optDouble(1), a.optDouble(2) });
            texts.add(text);
        }
        engine.setCues(pts, texts);
        JSObject r = new JSObject();
        r.put("count", engine.cueCount());
        call.resolve(r);
    }

    // Live location on or off. On: the GPS starts (if it wasn't recording already) and each fix may be sent.
    @PluginMethod
    public void live(PluginCall call) {
        String grp = call.getString("grp", "");
        JSObject r = new JSObject();
        if (grp == null || grp.isEmpty()) {
            engine.setLive(null, true);
            r.put("live", false);
            call.resolve(r);
            return;
        }
        JSONObject cfg = new JSONObject();
        try {
            cfg.put("url", call.getString("url", "")); cfg.put("key", call.getString("key", "")); cfg.put("grp", grp);
            cfg.put("id", call.getString("id", "")); cfg.put("secret", call.getString("secret", ""));
            cfg.put("name", call.getString("name", "")); cfg.put("sport", call.getString("sport", ""));
            cfg.put("due", call.getDouble("due", 0.0)); cfg.put("until", call.getDouble("until", 0.0));
        } catch (Exception ignored) {}
        if (getPermissionState("location") == PermissionState.DENIED && !allowed()) {
            call.reject("Location is turned off for Trail Finder", "DENIED");
            return;
        }
        // Not asked yet: the page's own GPS asks too; the fixes start once it's allowed (the next live call or start).
        engine.setLive(cfg, allowed());
        if (allowed()) askNotifications();
        r.put("live", true);
        call.resolve(r);
    }

    @PluginMethod
    public void activity(PluginCall call) {
        String action = call.getString("action", "");
        engine.activity(action, call.getData());
        JSObject r = new JSObject();
        r.put("on", engine.actOn);
        call.resolve(r);
    }

    // The turns still ahead ([lat, lon, metres along, text, arrow]), in order, for when the screen is off.
    @PluginMethod
    public void turns(PluginCall call) {
        List<double[]> pts = new ArrayList<>();
        List<String> texts = new ArrayList<>(), arrows = new ArrayList<>();
        JSArray list = call.getArray("list", new JSArray());
        for (int i = 0; i < list.length(); i++) {
            JSONArray a = list.optJSONArray(i);
            if (a == null || a.length() < 5) continue;
            String text = a.optString(3, null), arrow = a.optString(4, null);
            if (text == null || arrow == null || a.isNull(0) || a.isNull(1) || a.isNull(2)) continue;
            pts.add(new double[] { a.optDouble(0), a.optDouble(1), a.optDouble(2) });
            texts.add(text);
            arrows.add(arrow);
        }
        Double total = call.getDouble("total", 0.0), mps = call.getDouble("mps", 13.0);
        Boolean asleep = call.getBoolean("asleep", false);
        engine.setTurns(pts, texts, arrows, total == null ? 0 : total, mps == null ? 13 : mps, asleep != null && asleep);
        JSObject r = new JSObject();
        r.put("count", engine.turnCount());
        call.resolve(r);
    }
}
