package com.allduf.trailgps;

import android.annotation.SuppressLint;
import android.content.Context;
import android.location.Location;
import android.location.LocationListener;
import android.location.LocationManager;
import android.media.AudioAttributes;
import android.media.AudioFocusRequest;
import android.media.AudioManager;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.speech.tts.TextToSpeech;
import android.speech.tts.UtteranceProgressListener;
import java.io.BufferedReader;
import java.io.File;
import java.io.FileReader;
import java.io.FileWriter;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.text.SimpleDateFormat;
import java.util.ArrayList;
import java.util.Date;
import java.util.List;
import java.util.Locale;
import java.util.TimeZone;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import org.json.JSONObject;

// The Android app's own GPS, the same as ios-app/plugins/TrailGps (TrailGpsPlugin.swift) does on the iPhone:
// - records a ride with the screen off (RideService keeps the app running, with a notification), and writes every fix
//   to a file, so the page gets back the ones it missed while it slept, was reloaded or the app was closed mid-ride;
// - speaks directions over the music (which dips meanwhile), and says a planned ride's turns (cues) by itself while
//   the app is in the background;
// - sends live location every 20 s, ride or no ride (10 m steps while only sharing, to save battery);
// - the notification stands in for the iPhone's lock screen ride: km, climb, the trail you're on, or the next turn,
//   km left and arrival time, worked out here from each fix while the page is asleep.
// Everything runs on the main thread (the location callbacks come there too); only the live sends go to a background one.
final class GpsEngine {
    interface Listener {
        void onFix(JSONObject fix);
        void onError(String code);
    }

    private static final double KEEP_MS = 12 * 3600 * 1000;   // older fixes left in the file are from a ride long over
    @SuppressLint("StaticFieldLeak")
    private static GpsEngine instance;

    static synchronized GpsEngine get(Context ctx) {
        if (instance == null) instance = new GpsEngine(ctx.getApplicationContext());
        return instance;
    }

    private final Context ctx;
    private final Handler main = new Handler(Looper.getMainLooper());
    private final ExecutorService net = Executors.newSingleThreadExecutor();
    private final LocationManager lm;
    Listener listener;
    boolean appActive = true;

    boolean running = false;
    boolean recording = false;
    private boolean registered = false;
    private boolean registeredFine = false;
    final List<JSONObject> saved = new ArrayList<>();
    private FileWriter file;

    // Spoken directions
    private TextToSpeech tts;
    private boolean ttsReady = false;
    private final List<String> ttsWaiting = new ArrayList<>();
    private AudioFocusRequest focus;
    private int speaking = 0;
    private static final class Cue { double lat, lon, r; String text; }
    private final List<Cue> cueList = new ArrayList<>();
    private int cueNext = 0;

    // Live location
    JSONObject liveCfg;
    private double liveSent = 0;
    private boolean liveBusy = false;

    // The ride in the notification
    boolean actOn = false;
    String actSport = "mtb", actTitle = "Riding";
    double actKm = 0, actClimb = 0;
    String actLine = "", actPausedText = "";
    boolean actPaused = false;
    private Location actLast;
    private Double actAltBase;
    private double actPushed = 0, actFromPage = 0;
    String actTurn = "", actArrow = "";
    int actTurnM = -1;
    double actLeftKm = 0, actEta = 0;   // eta in s since 1970, 0: none
    private static final class Turn { double lat, lon, at; String text, arrow; }
    private final List<Turn> turnList = new ArrayList<>();
    private int turnNext = 0;
    private double turnTotal = 0, turnMps = 13;

    private GpsEngine(Context ctx) {
        this.ctx = ctx;
        this.lm = (LocationManager) ctx.getSystemService(Context.LOCATION_SERVICE);
        loadFile();
    }

    private static double now() { return System.currentTimeMillis(); }

    private File fileOf() { return new File(ctx.getFilesDir(), "ride-fixes.jsonl"); }

    private void loadFile() {
        File f = fileOf();
        if (!f.exists()) return;
        double since = now() - KEEP_MS;
        try (BufferedReader r = new BufferedReader(new FileReader(f))) {
            String line;
            while ((line = r.readLine()) != null) {
                try {
                    JSONObject fix = new JSONObject(line);
                    if (fix.optDouble("time", 0) > since) saved.add(fix);
                } catch (Exception ignored) {}
            }
        } catch (Exception ignored) {}
        if (saved.isEmpty()) f.delete();
    }

    // ---------- the calls from the page ----------

    void startRecording() {
        recording = true;
        begin();
        tune();
    }

    void stopRecording() {
        recording = false;
        turnList.clear();
        actTurn = ""; actTurnM = -1; actArrow = ""; actLeftKm = 0; actEta = 0;
        actOn = false;
        if (liveCfg == null) halt(); else { cueList.clear(); cueNext = 0; tune(); RideService.refresh(ctx); }
        saved.clear();
        try { if (file != null) file.close(); } catch (Exception ignored) {}
        file = null;
        fileOf().delete();
    }

    List<JSONObject> fixesAfter(double after) {
        List<JSONObject> out = new ArrayList<>();
        for (JSONObject f : saved) if (f.optDouble("time", 0) > after) out.add(f);
        return out;
    }

    void setCues(List<double[]> pts, List<String> texts) {
        cueList.clear();
        for (int i = 0; i < pts.size(); i++) {
            Cue c = new Cue();
            c.lat = pts.get(i)[0]; c.lon = pts.get(i)[1]; c.r = pts.get(i)[2]; c.text = texts.get(i);
            cueList.add(c);
        }
        cueNext = 0;
    }

    int cueCount() { return cueList.size(); }

    // Live location on (cfg) or off (null). Returns false if location isn't allowed.
    void setLive(JSONObject cfg, boolean allowed) {
        liveCfg = cfg;
        liveSent = 0;
        if (cfg == null) {
            if (!recording) halt(); else { tune(); RideService.refresh(ctx); }
            return;
        }
        if (allowed) { begin(); tune(); RideService.refresh(ctx); }
    }

    void liveAllowed() {
        if (liveCfg != null && !running) { begin(); tune(); RideService.refresh(ctx); }
    }

    void activity(String action, JSONObject a) {
        if (a.has("turn")) actTurn = cut(a.optString("turn"), 90);
        if (a.has("turnM")) actTurnM = (int) a.optDouble("turnM", -1);
        if (a.has("arrow")) actArrow = a.optString("arrow");
        if (a.has("leftKm")) actLeftKm = a.optDouble("leftKm", 0);
        if (a.has("eta")) { double e = a.optDouble("eta", 0); actEta = e > 0 ? e / 1000 : 0; }
        if (a.has("km")) actKm = a.optDouble("km", actKm);
        if (a.has("climb")) actClimb = a.optDouble("climb", actClimb);
        if (a.has("line")) actLine = cut(a.optString("line"), 80);
        if (a.has("paused")) actPaused = a.optBoolean("paused");
        if (a.has("pausedText")) actPausedText = a.optString("pausedText");
        actFromPage = now();
        if ("start".equals(action)) {
            actLast = null;
            actAltBase = null;
            actSport = a.optString("sport", "mtb");
            actTitle = a.optString("title", "Riding");
            actOn = true;
            actPushed = now();
            RideService.refresh(ctx);
        } else if ("end".equals(action)) {
            actOn = false;
            RideService.refresh(ctx);
        } else {
            pushActivity();
        }
    }

    void setTurns(List<double[]> pts, List<String> texts, List<String> arrows, double total, double mps, boolean asleep) {
        turnList.clear();
        for (int i = 0; i < pts.size(); i++) {
            Turn t = new Turn();
            t.lat = pts.get(i)[0]; t.lon = pts.get(i)[1]; t.at = pts.get(i)[2]; t.text = texts.get(i); t.arrow = arrows.get(i);
            turnList.add(t);
        }
        turnNext = 0;
        turnTotal = total;
        turnMps = Math.max(1, mps);
        if (turnList.isEmpty()) { actTurn = ""; actTurnM = -1; actArrow = ""; actLeftKm = 0; actEta = 0; }
        if (asleep) actFromPage = 0;   // the page is going to sleep: the notification is worked out here from now on
    }

    int turnCount() { return turnList.size(); }

    // ---------- GPS ----------

    @SuppressLint("MissingPermission")
    private void begin() {
        if (running) return;
        running = true;
        RideService.start(ctx);
        register();
    }

    // Full accuracy while recording; 10 m steps while only sharing.
    private void tune() {
        if (!running) return;
        if (registered && registeredFine == recording) return;
        register();
    }

    @SuppressLint("MissingPermission")
    private void register() {
        try {
            if (registered) lm.removeUpdates(gpsListener);
            long ms = recording ? 1000 : 3000;
            float m = recording ? 2f : 10f;
            boolean any = false;
            if (lm.isProviderEnabled(LocationManager.GPS_PROVIDER)) {
                lm.requestLocationUpdates(LocationManager.GPS_PROVIDER, ms, m, gpsListener, Looper.getMainLooper());
                any = true;
            }
            // Before the first GPS fix (or with only approximate location allowed), the phone's network position.
            if (lm.isProviderEnabled(LocationManager.NETWORK_PROVIDER)) {
                lm.requestLocationUpdates(LocationManager.NETWORK_PROVIDER, ms, m, gpsListener, Looper.getMainLooper());
                any = true;
            }
            registered = any;
            registeredFine = recording;
        } catch (SecurityException e) {
            registered = false;
            halt();
            liveCfg = null;
            if (listener != null) listener.onError("DENIED");
        }
    }

    void halt() {
        cueList.clear();
        cueNext = 0;
        try { lm.removeUpdates(gpsListener); } catch (Exception ignored) {}
        registered = false;
        running = false;
        RideService.stop(ctx);
    }

    private long lastGps = 0;
    private final LocationListener gpsListener = new LocationListener() {
        @Override
        public void onLocationChanged(Location l) {
            // Network positions only until the GPS has one (and again if it's been quiet for 20 s)
            boolean gps = LocationManager.GPS_PROVIDER.equals(l.getProvider());
            if (gps) lastGps = System.currentTimeMillis();
            else if (System.currentTimeMillis() - lastGps < 20000) return;
            onFix(l);
        }
        @Override public void onProviderEnabled(String p) {}
        @Override public void onProviderDisabled(String p) {}
        @Override public void onStatusChanged(String p, int s, Bundle b) {}
    };

    private void onFix(Location l) {
        if (!l.hasAccuracy()) return;
        JSONObject fix = new JSONObject();
        try {
            fix.put("lat", l.getLatitude());
            fix.put("lon", l.getLongitude());
            fix.put("acc", (double) l.getAccuracy());
            fix.put("time", (double) Math.round((double) l.getTime()));
            if (l.hasAltitude()) fix.put("alt", l.getAltitude());
            if (l.hasSpeed()) fix.put("speed", (double) l.getSpeed());
            if (l.hasBearing()) fix.put("heading", (double) l.getBearing());
        } catch (Exception ignored) {}
        if (recording) { keep(fix); countActivity(l); }
        if (listener != null) listener.onFix(fix);
        cueAt(l);
        if (l.getAccuracy() < 100) sendLive(l);
    }

    private void keep(JSONObject fix) {
        saved.add(fix);
        try {
            if (file == null) file = new FileWriter(fileOf(), true);
            file.write(fix.toString());
            file.write("\n");
            file.flush();
        } catch (Exception ignored) {}
    }

    // ---------- the ride in the notification ----------

    private boolean pageAwake() { return now() - actFromPage < 20000; }

    // With the screen off the page sleeps: add up the km and climb here and refresh the notification every 15 s.
    private void countActivity(Location l) {
        if (!actOn || !recording || actPaused) { actLast = null; return; }
        double t = now();
        boolean awake = pageAwake();
        if (l.getAccuracy() <= 30) {
            if (actLast != null) {
                double d = l.distanceTo(actLast);
                if (d >= 5) {
                    if (!awake) actKm += d / 1000;
                    actLast = l;
                }
            } else actLast = l;
        }
        boolean altOk = l.hasAltitude() && (Build.VERSION.SDK_INT < 26 || (l.hasVerticalAccuracy() && l.getVerticalAccuracyMeters() <= 15));
        if (altOk) {
            double alt = l.getAltitude();
            if (actAltBase != null) {
                if (alt > actAltBase + 4) { if (!awake) actClimb += alt - actAltBase; actAltBase = alt; }
                else if (alt < actAltBase - 4) actAltBase = alt;
            } else actAltBase = alt;
        }
        if (!awake && !turnList.isEmpty()) {
            boolean changed = turnAt(l);
            if (changed || t - actPushed >= 4000) pushActivity();
            return;
        }
        if (!awake && t - actPushed >= 15000) pushActivity();
    }

    // With the page asleep: the next turn from this fix (passed within 35 m: on to the one after), straight-line metres
    // to it, and the km and time left from where it sits along the route. Returns true when the turn changed.
    private boolean turnAt(Location l) {
        if (turnList.isEmpty() || l.getAccuracy() > 50) return false;
        int before = turnNext;
        for (int i = turnNext; i < Math.min(turnList.size(), turnNext + 4); i++) {
            if (dist(l, turnList.get(i).lat, turnList.get(i).lon) <= 35) turnNext = i + 1;
        }
        if (turnNext >= turnList.size()) {
            actTurn = "You have arrived"; actTurnM = 0; actArrow = "arrive"; actLeftKm = 0;
            actEta = now() / 1000;
        } else {
            Turn tn = turnList.get(turnNext);
            double d = dist(l, tn.lat, tn.lon);
            double left = Math.max(0, turnTotal - tn.at) + d;
            actTurn = tn.text; actTurnM = (int) Math.round(d); actArrow = tn.arrow; actLeftKm = left / 1000;
            actEta = now() / 1000 + left / turnMps;
        }
        return turnNext != before;
    }

    private void pushActivity() {
        if (!actOn) return;
        actPushed = now();
        RideService.refresh(ctx);
    }

    private static final java.util.Map<String, String> ARROWS = new java.util.HashMap<>();
    static {
        ARROWS.put("left", "←"); ARROWS.put("right", "→"); ARROWS.put("straight", "↑"); ARROWS.put("arrive", "🏁");
        ARROWS.put("slight-left", "↖"); ARROWS.put("slight-right", "↗"); ARROWS.put("sharp-left", "←"); ARROWS.put("sharp-right", "→");
        ARROWS.put("uturn", "↩"); ARROWS.put("roundabout", "↻");
    }

    // What the notification says: the title line and the line under it.
    String[] notificationText() {
        if (!actOn) {
            return new String[] { "Sharing your location", "Trail Finder sends where you are every 20 s. Turn it off in Trail Finder." };
        }
        if (!actTurn.isEmpty()) {
            String arrow = ARROWS.containsKey(actArrow) ? ARROWS.get(actArrow) + " " : "";
            String when = actTurnM >= 0 && !"arrive".equals(actArrow) ? (actTurnM >= 1000 ? String.format(Locale.US, "%.1f km", actTurnM / 1000.0) : actTurnM + " m") + " · " : "";
            StringBuilder sub = new StringBuilder();
            if (actLeftKm > 0) sub.append(String.format(Locale.US, "%.1f km left", actLeftKm));
            if (actEta > 0) {
                if (sub.length() > 0) sub.append(" · ");
                sub.append("arrive ").append(android.text.format.DateFormat.getTimeFormat(ctx).format(new Date((long) (actEta * 1000))));
            }
            return new String[] { arrow + when + actTurn, sub.length() > 0 ? sub.toString() : actTitle };
        }
        String km = String.format(Locale.US, "%.1f km · %d m climb", actKm, (int) Math.round(actClimb));
        if (actPaused) return new String[] { actTitle + " · " + (actPausedText.isEmpty() ? "Paused" : actPausedText), km };
        return new String[] { actTitle + " · " + km, actLine.isEmpty() ? "Recording" : actLine };
    }

    // ---------- live location ----------

    private void sendLive(Location l) {
        final JSONObject cfg = liveCfg;
        if (cfg == null || liveBusy) return;
        final String url = cfg.optString("url", "");
        if (url.isEmpty()) return;
        final double t = now();
        double until = cfg.optDouble("until", 0);
        if (until > 0 && t > until) {
            liveCfg = null;
            if (!recording) halt(); else RideService.refresh(ctx);
            return;
        }
        if (t - liveSent < 20000) return;
        SimpleDateFormat iso = new SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss'Z'", Locale.US);
        iso.setTimeZone(TimeZone.getTimeZone("UTC"));
        double due = cfg.optDouble("due", 0);
        final JSONObject body = new JSONObject();
        try {
            body.put("p_grp", cfg.optString("grp")); body.put("p_id", cfg.optString("id")); body.put("p_secret", cfg.optString("secret"));
            body.put("p_name", cfg.optString("name")); body.put("p_sport", cfg.optString("sport"));
            body.put("p_lat", l.getLatitude()); body.put("p_lon", l.getLongitude());
            body.put("p_acc", (double) l.getAccuracy());
            body.put("p_speed", l.hasSpeed() ? (Object) (double) l.getSpeed() : JSONObject.NULL);
            body.put("p_due", due > 0 ? iso.format(new Date((long) due)) : JSONObject.NULL);
            body.put("p_until", until > 0 ? iso.format(new Date((long) until)) : JSONObject.NULL);
        } catch (Exception e) { return; }
        final String key = cfg.optString("key", "");
        liveBusy = true;
        liveSent = t;
        net.execute(() -> {
            int code = 0;
            HttpURLConnection c = null;
            try {
                c = (HttpURLConnection) new URL(url).openConnection();
                c.setConnectTimeout(15000);
                c.setReadTimeout(15000);
                c.setRequestMethod("POST");
                c.setDoOutput(true);
                c.setRequestProperty("Content-Type", "application/json");
                c.setRequestProperty("apikey", key);
                c.setRequestProperty("Authorization", "Bearer " + key);
                try (OutputStream o = c.getOutputStream()) { o.write(body.toString().getBytes(StandardCharsets.UTF_8)); }
                code = c.getResponseCode();
            } catch (Exception ignored) {
            } finally {
                if (c != null) c.disconnect();
            }
            final int got = code;
            main.post(() -> {
                liveBusy = false;
                // No signal: try again with the next fix after 5 s instead of 20
                if (got != 200) liveSent = t - 15000;
            });
        });
    }

    // ---------- speaking ----------

    void say(String text) {
        if (tts == null) {
            tts = new TextToSpeech(ctx, (status) -> main.post(() -> {
                ttsReady = status == TextToSpeech.SUCCESS;
                if (!ttsReady) { ttsWaiting.clear(); return; }
                int ok = tts.setLanguage(Locale.CANADA);
                if (ok == TextToSpeech.LANG_MISSING_DATA || ok == TextToSpeech.LANG_NOT_SUPPORTED) tts.setLanguage(Locale.US);
                tts.setAudioAttributes(new AudioAttributes.Builder()
                    .setUsage(AudioAttributes.USAGE_ASSISTANCE_NAVIGATION_GUIDANCE)
                    .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH).build());
                tts.setOnUtteranceProgressListener(new UtteranceProgressListener() {
                    @Override public void onStart(String id) {}
                    @Override public void onDone(String id) { main.post(GpsEngine.this::doneSpeaking); }
                    @Override public void onError(String id) { main.post(GpsEngine.this::doneSpeaking); }
                });
                for (String w : ttsWaiting) speakNow(w);
                ttsWaiting.clear();
            }));
        }
        if (!ttsReady) { ttsWaiting.add(text); return; }
        speakNow(text);
    }

    private void speakNow(String text) {
        AudioManager am = (AudioManager) ctx.getSystemService(Context.AUDIO_SERVICE);
        if (am != null && speaking == 0) {
            if (Build.VERSION.SDK_INT >= 26) {
                focus = new AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN_TRANSIENT_MAY_DUCK)
                    .setAudioAttributes(new AudioAttributes.Builder()
                        .setUsage(AudioAttributes.USAGE_ASSISTANCE_NAVIGATION_GUIDANCE)
                        .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH).build())
                    .build();
                am.requestAudioFocus(focus);
            } else {
                am.requestAudioFocus(null, AudioManager.STREAM_MUSIC, AudioManager.AUDIOFOCUS_GAIN_TRANSIENT_MAY_DUCK);
            }
        }
        speaking++;
        tts.speak(text, TextToSpeech.QUEUE_ADD, null, "tf" + System.nanoTime());
    }

    private void doneSpeaking() {
        speaking = Math.max(0, speaking - 1);
        if (speaking > 0) return;
        AudioManager am = (AudioManager) ctx.getSystemService(Context.AUDIO_SERVICE);
        if (am == null) return;
        if (Build.VERSION.SDK_INT >= 26) { if (focus != null) am.abandonAudioFocusRequest(focus); }
        else am.abandonAudioFocus(null);
    }

    // With the app in the background (screen off), the page can't speak: say the turns it handed over here.
    // Only the next few count, in order, so a ride that comes back past an earlier spot doesn't say a later turn there.
    private void cueAt(Location l) {
        if (cueNext >= cueList.size() || appActive) return;
        for (int i = cueNext; i < Math.min(cueList.size(), cueNext + 3); i++) {
            Cue c = cueList.get(i);
            if (dist(l, c.lat, c.lon) <= c.r) {
                cueNext = i + 1;
                say(c.text);
                return;
            }
        }
    }

    private static double dist(Location l, double lat, double lon) {
        float[] out = new float[1];
        Location.distanceBetween(l.getLatitude(), l.getLongitude(), lat, lon, out);
        return out[0];
    }

    private static String cut(String s, int n) { return s.length() > n ? s.substring(0, n) : s; }
}
