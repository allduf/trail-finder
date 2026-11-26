package com.allduf.trailmap;

import static org.maplibre.android.style.expressions.Expression.all;
import static org.maplibre.android.style.expressions.Expression.eq;
import static org.maplibre.android.style.expressions.Expression.get;
import static org.maplibre.android.style.expressions.Expression.gt;
import static org.maplibre.android.style.expressions.Expression.has;
import static org.maplibre.android.style.expressions.Expression.interpolate;
import static org.maplibre.android.style.expressions.Expression.linear;
import static org.maplibre.android.style.expressions.Expression.literal;
import static org.maplibre.android.style.expressions.Expression.neq;
import static org.maplibre.android.style.expressions.Expression.product;
import static org.maplibre.android.style.expressions.Expression.stop;
import static org.maplibre.android.style.expressions.Expression.sum;
import static org.maplibre.android.style.expressions.Expression.toColor;
import static org.maplibre.android.style.expressions.Expression.zoom;

import android.Manifest;
import android.annotation.SuppressLint;
import android.app.Activity;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.graphics.PointF;
import android.graphics.RectF;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.text.TextUtils;
import android.util.TypedValue;
import android.view.Gravity;
import android.view.View;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.TextView;
import androidx.core.content.ContextCompat;
import androidx.core.graphics.Insets;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowInsetsCompat;
import com.getcapacitor.JSObject;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import org.maplibre.android.MapLibre;
import org.maplibre.android.camera.CameraPosition;
import org.maplibre.android.camera.CameraUpdateFactory;
import org.maplibre.android.geometry.LatLng;
import org.maplibre.android.geometry.LatLngBounds;
import org.maplibre.android.location.LocationComponent;
import org.maplibre.android.location.LocationComponentActivationOptions;
import org.maplibre.android.location.modes.CameraMode;
import org.maplibre.android.location.modes.RenderMode;
import org.maplibre.android.maps.MapLibreMap;
import org.maplibre.android.maps.MapLibreMapOptions;
import org.maplibre.android.maps.MapView;
import org.maplibre.android.maps.Style;
import org.maplibre.android.maps.TerrainLoadMode;
import org.maplibre.android.style.layers.CircleLayer;
import org.maplibre.android.style.layers.FillLayer;
import org.maplibre.android.style.layers.Layer;
import org.maplibre.android.style.layers.LineLayer;
import org.maplibre.android.style.layers.Property;
import org.maplibre.android.style.layers.PropertyFactory;
import org.maplibre.android.style.layers.SymbolLayer;
import org.maplibre.android.style.sources.GeoJsonSource;
import org.maplibre.android.style.terrain.Terrain;
import org.maplibre.geojson.Feature;
import org.maplibre.geojson.Point;

// A trail map drawn by the Android phone itself (MapLibre Native), the Android side of the iPhone's TrailMapScreen
// (ios-app/plugins/TrailMap/.../TrailMapPlugin.swift): the same screen, from the same calls (TrailMapPlugin.java), for
// native-map.js on the website. It sits over the page (the app's web view) until it's left.
//   lines, dots: GeoJSON FeatureCollections as text. Lines carry c (colour), w (width), o (opacity), d (dash key, "" for
//   solid); dots carry r (radius), c, w, f (fill), fo (fill opacity). A named trail or dot carries n (its name), and
//   i (its number on the page) when it has its own tap handler there; lb is the name written along a line in 3D.
//   dashes: the dash keys in use, joined by "|", each a dash pattern in line widths ("2.00,1.20"; "0,2.2" is dots).
// threeD: satellite photos (and the other base maps) draped over the mountains (Mapterhorn heights), tilted, with the
// same trails, names, roads and peaks as the iPhone's native 3D (BaseStyles.java); winter adds Skiing's Winter map.
// "Layers" closes it with layers: true in "closed": the page opens its own 3D map there with its Layers open, for what
// this Android build doesn't draw yet (native for viewing, web for tools, alex 2026-11-20).
// Events back to the page: "moved" { lat, lon, zoom, bearing } after each move (the page loads the trails there and
// sends them with update), and "closed" { lat, lon, zoom, bearing, details, layers, open, tapLat, tapLon, feature? }.
@SuppressLint("ViewConstructor")
final class TrailMapScreen extends FrameLayout {
    interface Events { void send(String name, JSObject data); }
    // A feature that watches the fingers on the map (NativeFingers.java); the map still gets every touch.
    interface TouchWatcher { void onTouch(android.view.MotionEvent e); }
    private final List<TouchWatcher> watchers = new ArrayList<>();

    // The map styles, in the order the style button goes through them (as the iPhone's).
    private static final String[][] FLAT = { { "osm", "Map" }, { "topo", "Topo" }, { "sat", "Satellite" }, { "vector", "Sharp" } };
    private static final String[][] THREE_D = { { "sat", "Satellite" }, { "topo", "Topo" }, { "osm", "Map" } };
    private static final double TILT = 65;        // the web 3D map eases to 70
    private static final int INK = Color.rgb(20, 33, 26);
    private static final int PAPER = Color.rgb(242, 239, 231);
    private static final String EMPTY = "{\"type\":\"FeatureCollection\",\"features\":[]}";
    // In 3D, dotted lines (approach and uphill routes, unofficial trails) are drawn as the web 3D map draws them
    // (map3d.js DOT_GROW, DOT_BAND): dots 1.3 times wider, on a dark see-through band.
    private static final float DOT_GROW = 1.3f, DOT_BAND = 2.5f;

    private final Activity activity;
    private final Events events;
    private final boolean threeD, winter, fr;
    private final String esri;
    private final LatLng start;
    private final double startZoom, startBearing;
    private String base;
    private final MapView mapView;
    private MapLibreMap map;
    private String lines = EMPTY, dots = EMPTY;
    private List<String> dashKeys = new ArrayList<>();
    private final Set<String> dashLayers = new LinkedHashSet<>();
    private int picked = -1;
    private LatLng pickedAt = new LatLng(0, 0);
    private String pickedFeature;
    private boolean left = false, tilted = false, located = false;
    // ---------- under the page (alex 2026-11-22: "i want to keep the same interface for both i never want the map to
    // switch from web to native map"), as on the iPhone (TrailMapScreen.under in TrailMapPlugin.swift) ----------
    // The page's own buttons, menus, bottom bar and cards stay on top, as on the flat map; this map sits behind the web
    // view and takes the touches where the page shows nothing (TrailMapPlugin passes them on, mapTakes). Its own Back,
    // Layers, style and Me buttons and its trail card don't show: the page's do that. A trail tapped here opens the
    // page's card ("tap"); Details on a feature's card opens on the page ("details") and this map stays. The page
    // closes it (its 2D button, or Back once the page has nothing else to close).
    final boolean under;
    private float maskCell = 0;
    private int maskCols = 0, maskRows = 0;
    private byte[] maskBits = new byte[0];
    private int uiTop = 0, uiBottom = 0;   // the page's rows of buttons, in px from the top and bottom
    private PointF lastTouch;      // where the finger last lifted: a tap's own spot (over the mountains, a spot worked back
    private long lastTouchAt = 0;  // from the map's tap can sit off the finger)
    private final List<NativeLayer> features;

    private final FrameLayout area;
    private final TextView styleBtn;
    private final LinearLayout card;
    private final View cardSwatch;
    private final TextView cardName, cardSub, cardDetails;
    private final LinearLayout toolStack;

    TrailMapScreen(Activity activity, Events events, double lat, double lon, double zoom, double bearing, String base,
                   boolean threeD, boolean winter, String esri, boolean fr, boolean under) {
        super(activity);
        this.under = under;
        this.activity = activity;
        this.events = events;
        this.threeD = threeD;
        this.winter = threeD && winter;
        this.fr = fr;
        this.esri = esri != null && esri.startsWith("https://") && esri.contains("{z}") ? esri : null;
        this.start = new LatLng(lat, lon);
        this.startZoom = zoom;
        this.startBearing = bearing;
        String b = "sathybrid".equals(base) ? "sat" : base;
        // 3D opens in the flat map's style where it has it (Topo, Map), so the change to 3D shows no other map.
        if (threeD) this.base = this.winter && "winter".equals(b) ? "winter" : listed(THREE_D, b) ? b : "sat";
        else this.base = listed(FLAT, b) ? b : "osm";
        features = threeD ? NativeLayers.make() : new ArrayList<>();
        setBackgroundColor(PAPER);
        setClickable(true);   // nothing under the screen gets a touch

        // MapLibre first: its download client reads the app's name from it the first time it's touched (TileRewriter).
        MapLibre.getInstance(activity);
        if (threeD) WinterTiles.shared.install(activity);           // the photo address rewriter (Winter, late-summer mountains)
        if (this.winter) WinterTiles.shared.load(activity, (ok) -> {}); // the lists of photo squares, ready by the time Winter is picked

        MapLibreMapOptions opts = MapLibreMapOptions.createFromAttributes(activity)
            .logoEnabled(false)
            .compassEnabled(true)
            .attributionEnabled(true)
            .camera(new CameraPosition.Builder().target(start).zoom(startZoom).bearing(startBearing).build());
        mapView = new MapView(activity, opts);
        mapView.onCreate(null);
        mapView.setOnTouchListener((v, e) -> {
            if (e.getActionMasked() == android.view.MotionEvent.ACTION_UP) { lastTouch = new PointF(e.getX(), e.getY()); lastTouchAt = e.getEventTime(); }
            for (TouchWatcher w : watchers) { try { w.onTouch(e); } catch (Exception ignored) {} }
            return false;   // the map still gets every touch
        });
        addView(mapView, new LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.MATCH_PARENT));

        // Where the map's own buttons go: the screen inside the phone's bars (insets below).
        area = new FrameLayout(activity);
        addView(area, new LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.MATCH_PARENT));

        TextView back = pill("← Back", (v) -> leave(false, false, null));
        area.addView(back, at(Gravity.TOP | Gravity.START, 12, 8, 0, 0));
        if (under) back.setVisibility(GONE);   // the page's own buttons do these
        TextView tag = new TextView(activity);
        tag.setText("");
        tag.setTextColor(Color.WHITE);
        tag.setTextSize(TypedValue.COMPLEX_UNIT_SP, 12);
        tag.setTypeface(Typeface.DEFAULT_BOLD);
        tag.setPadding(dp(10), dp(3), dp(10), dp(3));
        tag.setBackground(round(Color.argb(191, 20, 33, 26), 11));
        area.addView(tag, at(Gravity.TOP | Gravity.CENTER_HORIZONTAL, 0, 18, 0, 0));
        tag.setVisibility(GONE);   // no "(test)" label any more (alex 2026-11-25, "keep the app professional")
        toolStack = new LinearLayout(activity);
        toolStack.setOrientation(LinearLayout.VERTICAL);
        toolStack.setGravity(Gravity.END);
        area.addView(toolStack, at(Gravity.TOP | Gravity.END, 0, 8, 12, 0));
        if (under) toolStack.setVisibility(GONE);   // the page's own search bar and Tools: no Search or Tools pills over the page

        LinearLayout bottom = new LinearLayout(activity);
        bottom.setOrientation(LinearLayout.VERTICAL);
        LinearLayout row = new LinearLayout(activity);
        row.setOrientation(LinearLayout.HORIZONTAL);
        row.setGravity(Gravity.END);
        if (threeD) row.addView(pill("☰ Layers", (v) -> leave(false, true, null)), gap());
        styleBtn = pill(styleTitle(), (v) -> nextStyle());
        row.addView(styleBtn, gap());
        row.addView(pill("◎ Me", (v) -> locate()));
        LinearLayout.LayoutParams rowAt = new LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT);
        rowAt.setMargins(dp(12), 0, dp(12), dp(12));
        bottom.addView(row, rowAt);
        if (under) row.setVisibility(GONE);

        // The trail card: name, colour, Details (opens the trail's details on the page) and ✕.
        card = new LinearLayout(activity);
        card.setOrientation(LinearLayout.HORIZONTAL);
        card.setGravity(Gravity.CENTER_VERTICAL);
        card.setBackground(round(Color.WHITE, 16));
        card.setElevation(dp(8));
        card.setPadding(dp(14), dp(14), dp(8), dp(14));
        card.setVisibility(GONE);
        card.setClickable(true);
        cardSwatch = new View(activity);
        LinearLayout.LayoutParams sw = new LinearLayout.LayoutParams(dp(8), dp(34));
        sw.setMarginEnd(dp(10));
        card.addView(cardSwatch, sw);
        LinearLayout text = new LinearLayout(activity);
        text.setOrientation(LinearLayout.VERTICAL);
        cardName = new TextView(activity);
        cardName.setTextColor(INK);
        cardName.setTextSize(TypedValue.COMPLEX_UNIT_SP, 17);
        cardName.setTypeface(Typeface.DEFAULT_BOLD);
        cardName.setMaxLines(2);
        cardName.setEllipsize(TextUtils.TruncateAt.END);
        cardSub = new TextView(activity);
        cardSub.setTextColor(Color.DKGRAY);
        cardSub.setTextSize(TypedValue.COMPLEX_UNIT_SP, 13);
        cardSub.setMaxLines(1);
        cardSub.setVisibility(GONE);
        text.addView(cardName);
        text.addView(cardSub);
        card.addView(text, new LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1));
        cardDetails = pill("Details ›", (v) -> leave(true, false, null));
        LinearLayout.LayoutParams dl = new LinearLayout.LayoutParams(LinearLayout.LayoutParams.WRAP_CONTENT, LinearLayout.LayoutParams.WRAP_CONTENT);
        dl.setMarginStart(dp(8));
        card.addView(cardDetails, dl);
        TextView shut = new TextView(activity);
        shut.setText("✕");
        shut.setTextColor(INK);
        shut.setTextSize(TypedValue.COMPLEX_UNIT_SP, 18);
        shut.setGravity(Gravity.CENTER);
        shut.setOnClickListener((v) -> showCard(null));
        card.addView(shut, new LinearLayout.LayoutParams(dp(40), dp(40)));
        LinearLayout.LayoutParams cardAt = new LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT);
        cardAt.setMargins(dp(12), 0, dp(12), dp(12));
        bottom.addView(card, cardAt);
        area.addView(bottom, new LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.WRAP_CONTENT, Gravity.BOTTOM));

        ViewCompat.setOnApplyWindowInsetsListener(this, (v, ins) -> { inset(ins); return ins; });

        mapView.getMapAsync(this::ready);
    }

    // ---------- the phone's bars (status bar, navigation) ----------
    @Override
    protected void onAttachedToWindow() {
        super.onAttachedToWindow();
        WindowInsetsCompat ins = ViewCompat.getRootWindowInsets(this);
        if (ins != null) inset(ins);
        ViewCompat.requestApplyInsets(this);
    }
    private int barTop = 0, barBottom = 0;
    private void inset(WindowInsetsCompat ins) {
        Insets s = ins.getInsets(WindowInsetsCompat.Type.systemBars() | WindowInsetsCompat.Type.displayCutout());
        barTop = s.top; barBottom = s.bottom; barLeft = s.left; barRight = s.right;
        padArea();
    }
    private int barLeft = 0, barRight = 0;
    // The phone's bars only where the map reaches the screen's edge (a tool's page bar may sit between).
    private void padArea() {
        if (under) area.setPadding(barLeft, Math.max(barTop, uiTop), barRight, Math.max(barBottom, uiBottom));   // between the page's rows
        else area.setPadding(barLeft, insetTop > 0 ? 0 : barTop, barRight, insetBottom > 0 ? 0 : barBottom);
        if (map != null) placeMapMarks();
    }

    // ---------- a tool of the page's (NativeTools): its bars show above and below, the map between ----------
    // top and bottom in the page's points (CSS pixels, dp here) from the screen's edges.
    private int insetTop = 0, insetBottom = 0;
    private boolean aside = false;
    void setToolInsets(float top, float bottom) {
        if (under) return;   // the tool's bar is on the page, over this map: nothing to make room for
        float h = heightDp();
        if (h <= 0) return;
        float t = Math.max(0, Math.min(top, h * 0.6f)), b = Math.max(0, Math.min(bottom, h * 0.75f));
        if (t + b > h - 160) return;          // no room left for a map: keep it as it is
        int ti = dp(Math.round(t)), bi = dp(Math.round(b));
        if (ti == insetTop && bi == insetBottom) return;
        insetTop = ti; insetBottom = bi;
        if (getLayoutParams() instanceof MarginLayoutParams) {
            MarginLayoutParams lp = (MarginLayoutParams) getLayoutParams();
            lp.topMargin = ti; lp.bottomMargin = bi;
            setLayoutParams(lp);
        }
        padArea();
    }
    // A dialog of the page's is open (or there's no room for a map): the screen steps aside until it's answered.
    void stepAside(boolean on) {
        if (under) return;   // the page's dialog is over this map already
        if (aside == on) return;
        aside = on;
        animate().cancel();
        if (on) animate().alpha(0).setDuration(200).withEndAction(() -> { if (aside) setVisibility(INVISIBLE); }).start();
        else { setVisibility(VISIBLE); animate().alpha(1).setDuration(200).start(); }
    }
    // Back goes to the page while its tool or dialog is showing (it closes them there).
    boolean pageHasBack() { return aside || insetTop > 0 || insetBottom > 0; }
    // The whole screen's height, not the map's between a tool's bars (the margins set above shrink this view itself).
    float heightDp() {
        android.view.ViewParent p = getParent();
        int h = p instanceof View && ((View) p).getHeight() > 0 ? ((View) p).getHeight() : getHeight() + insetTop + insetBottom;
        return h / getResources().getDisplayMetrics().density;
    }
    // MapLibre's compass under Back, its credits (ⓘ) at the bottom left, above the phone's bar.
    private void placeMapMarks() {
        map.getUiSettings().setCompassMargins(0, (under ? Math.max(barTop, uiTop) + dp(8) : barTop + dp(64)), dp(14), 0);
        map.getUiSettings().setAttributionMargins(dp(6), 0, 0, (under ? Math.max(barBottom, uiBottom) : barBottom) + dp(6));
    }

    // ---------- the map ----------
    private void ready(MapLibreMap m) {
        if (left) return;
        map = m;
        mapView.addOnDidFinishRenderingMapListener((fully) -> {
            Style st = map.getStyle();
            if (!fully || onReady == null || st == null || !st.isFullyLoaded()) return;
            Runnable r = onReady;
            onReady = null;
            r.run();
        });
        placeMapMarks();
        if (threeD) {
            map.setMaxPitchPreference(80);
            // New ground fills in over a few frames instead of all in one (which can stall a frame while turning).
            map.setTerrainLoadMode(TerrainLoadMode.BALANCED);
            map.setCenterClampedToGround(true);
        } else {
            map.getUiSettings().setTiltGesturesEnabled(false);
        }
        map.addOnCameraIdleListener(() -> {
            if (fingerMoving) { fingerMoving = false; fingerMovedAt = android.os.SystemClock.uptimeMillis(); }
            if (!left) events.send("moved", camera());
        });
        map.addOnCameraMoveStartedListener((reason) -> {
            if (reason == MapLibreMap.OnCameraMoveStartedListener.REASON_API_GESTURE) { fingerMoving = true; fingerMovedAt = android.os.SystemClock.uptimeMillis(); }
        });
        map.addOnMapClickListener(this::tapped);
        // Winter waits for its lists of photo squares (a moment, once a session): Satellite until then.
        if ("winter".equals(base) && !WinterTiles.shared.ready()) { setStyle("sat"); showStyle(); }
        else setStyle(base);
    }

    private void setStyle(String key) {
        if (map == null) return;
        Style.Builder b = "vector".equals(key) ? new Style.Builder().fromUri("https://tiles.openfreemap.org/styles/liberty")
            : new Style.Builder().fromJson(threeD ? BaseStyles.threeD(key, esri, fr) : BaseStyles.flat(key, esri));
        map.setStyle(b, this::styleLoaded);
    }

    private void showStyle() {
        if (!"winter".equals(base) || WinterTiles.shared.ready()) { setStyle(base); return; }
        WinterTiles.shared.load(activity, (ok) -> {
            if (left || !"winter".equals(base)) return;
            if (ok) { setStyle("winter"); return; }
            // The lists couldn't come (no connection, no copy kept): back to Satellite.
            base = "sat";
            styleBtn.setText(styleTitle());
            setStyle("sat");
        });
    }

    // A new style has no trails: they're added again on top of it.
    private void styleLoaded(Style style) {
        if (left) return;
        dashLayers.clear();
        style.addSource(new GeoJsonSource("tf-lines", lines));
        style.addSource(new GeoJsonSource("tf-dots", dots));
        // The ground is draped over the heights (a little taller than life, like the web 3D map).
        if (threeD && style.getSource("dem") != null) style.setTerrain(new Terrain("dem", 1.15f));
        // Filled areas (native-map.js: polygons with fc, fa), see-through as on the flat map, under every trail line.
        put(style, new FillLayer("tf-fill", "tf-lines").withFilter(all(has("fa"), gt(get("fa"), literal(0)))).withProperties(
            PropertyFactory.fillColor(toColor(get("fc"))),
            PropertyFactory.fillOpacity(get("fa")),
            PropertyFactory.fillAntialias(false)));
        put(style, line("tf-line", ""));
        CircleLayer dot = new CircleLayer("tf-dots", "tf-dots").withProperties(
            PropertyFactory.circleRadius(get("r")),
            PropertyFactory.circleColor(toColor(get("f"))),
            PropertyFactory.circleOpacity(get("fo")),
            PropertyFactory.circleStrokeColor(toColor(get("c"))),
            PropertyFactory.circleStrokeWidth(get("w")));
        put(style, dot);
        if (threeD) {
            // Trail and route names along their lines, in the line's colour (the web 3D map's trail-names); lb: the
            // line's own label only (native-map.js), never a tooltip like "Unnamed trail".
            SymbolLayer label = new SymbolLayer("tf-names", "tf-lines")
                .withFilter(all(has("lb"), neq(get("lb"), literal(""))))
                .withProperties(
                    PropertyFactory.textField(get("lb")),
                    PropertyFactory.textOpacity(get("o")),
                    PropertyFactory.textFont(new String[] { "Noto Sans Bold" }),
                    PropertyFactory.symbolPlacement(Property.SYMBOL_PLACEMENT_LINE),
                    PropertyFactory.textSize(interpolate(linear(), zoom(), stop(12, 11.5f), stop(15, 13.5f))),
                    PropertyFactory.textColor(toColor(get("c"))),
                    PropertyFactory.textHaloColor(Color.WHITE),
                    PropertyFactory.textHaloWidth(1.8f));
            label.setMinZoom(12);
            put(style, label);
        }
        addDashLayers(style);
        for (NativeLayer f : features) { try { f.added(style, this); } catch (Exception ignored) {} }
        showMe(style);
    }
    // 3D opens flat where the flat map was, then tilts in (as the web 3D map does), once it shows (TrailMapPlugin.open).
    void tiltIn() {
        if (!threeD || tilted || left || map == null) return;
        tilted = true;
        map.animateCamera(CameraUpdateFactory.tiltTo(TILT), 1200);
    }
    // A feature that sets the camera itself first (a Flyover): no tilt in after it.
    void noTiltIn() { tilted = true; }
    // Tips the map to this pitch in place (the one map's 3D and 2D, applyUnder "tilt"): a full tilt in 1.2 s, part of one less.
    void pitchTo(double to) {
        if (!threeD || left || map == null) return;
        tilted = true;
        double from = map.getCameraPosition().tilt;
        int ms = (int) Math.max(350, 1200 * Math.abs(to - from) / TILT);
        if (Math.abs(to - from) < 0.5) { events.send("moved", camera()); return; }
        map.animateCamera(CameraUpdateFactory.tiltTo(to), ms);
    }
    // The first frame of the same spot as the page's flat map, in the loaded style (open() then shows this screen).
    Runnable onReady;

    // In 3D the trails go just under the place names, so names stay readable over them.
    private void put(Style style, Layer l) {
        if (threeD && style.getLayer(BaseStyles.FIRST_NAME_LAYER) != null) style.addLayerBelow(l, BaseStyles.FIRST_NAME_LAYER);
        else style.addLayer(l);
    }

    private LineLayer line(String id, String dash) {
        LineLayer l = new LineLayer(id, "tf-lines").withFilter(eq(get("d"), literal(dash)));
        l.setProperties(
            PropertyFactory.lineColor(toColor(get("c"))),
            PropertyFactory.lineWidth(get("w")),
            PropertyFactory.lineOpacity(get("o")),
            PropertyFactory.lineCap(Property.LINE_CAP_ROUND),
            PropertyFactory.lineJoin(Property.LINE_JOIN_ROUND));
        if (!dash.isEmpty()) {
            List<Float> parts = new ArrayList<>();
            for (String p : dash.split(",")) { try { parts.add(Float.parseFloat(p)); } catch (NumberFormatException ignored) {} }
            if (parts.size() >= 2) l.setProperties(PropertyFactory.lineDasharray(parts.toArray(new Float[0])));
        }
        return l;
    }

    // One layer per dash pattern (MapLibre can't take the pattern from each line), under the dots.
    private void addDashLayers(Style style) {
        if (style == null || !style.isFullyLoaded() || style.getLayer("tf-dots") == null) return;
        for (String d : dashKeys) {
            if (d.isEmpty()) continue;
            String id = "tf-dash:" + d;
            if (dashLayers.contains(id)) continue;
            dashLayers.add(id);
            LineLayer l = line(id, d);
            if (threeD && d.startsWith("0,")) {
                LineLayer band = new LineLayer("tf-band:" + d, "tf-lines").withFilter(eq(get("d"), literal(d)));
                band.setProperties(
                    PropertyFactory.lineColor(Color.rgb(20, 32, 26)),   // #14201a
                    PropertyFactory.lineWidth(sum(product(get("w"), literal(DOT_GROW)), literal(DOT_BAND))),
                    PropertyFactory.lineOpacity(product(get("o"), literal(0.55f))),
                    PropertyFactory.lineCap(Property.LINE_CAP_ROUND),
                    PropertyFactory.lineJoin(Property.LINE_JOIN_ROUND));
                style.addLayerBelow(band, "tf-dots");
                l.setProperties(PropertyFactory.lineWidth(product(get("w"), literal(DOT_GROW))));
            }
            style.addLayerBelow(l, "tf-dots");
        }
    }

    // ---------- the trails ----------
    void setData(String lines, String dots, String dashes) {
        this.lines = lines == null || lines.isEmpty() ? EMPTY : lines;
        this.dots = dots == null || dots.isEmpty() ? EMPTY : dots;
        dashKeys = new ArrayList<>();
        if (dashes != null) for (String d : dashes.split("\\|")) if (!d.isEmpty()) dashKeys.add(d);
        Style style = map == null ? null : map.getStyle();
        if (style == null || !style.isFullyLoaded()) return;
        GeoJsonSource l = style.getSourceAs("tf-lines"), d = style.getSourceAs("tf-dots");
        if (l != null) l.setGeoJson(this.lines);
        if (d != null) d.setGeoJson(this.dots);
        addDashLayers(style);
    }

    // ---------- the native 3D features (NativeLayers.java) ----------
    void setLayer(String key, String data) {
        if ("base".equals(key)) { setBase(data); return; }
        if ("under".equals(key)) { applyUnder(data); return; }
        for (NativeLayer f : features) {
            if (!f.key().equals(key)) continue;
            Style style = map == null ? null : map.getStyle();
            try { f.setData(data, style != null && style.isFullyLoaded() ? style : null); } catch (Exception ignored) {}
        }
    }
    static List<String> featureKeys() {
        List<String> out = new ArrayList<>();
        for (NativeLayer f : NativeLayers.make()) out.add(f.key());
        return out;
    }
    // The lowest trail layer: a feature drawn under the trails adds its layers below this one. The filled areas
    // (tf-fill, added with tf-line) count: they stay over ground pictures and radar, as the flat map's areas do.
    String trailsBottomLayer() { return "tf-fill"; }
    MapLibreMap mapLibre() { return map; }
    // Where a feature's own labels go: the screen inside the phone's bars (its children are laid out by gravity).
    FrameLayout mapArea() { return area; }
    // Top left, under the radar and smoke captions (NativeOverlay rows 0-1): the ground keys, then the avalanche card.
    private LinearLayout infoColumn;
    LinearLayout infoColumn() {
        if (infoColumn == null) {
            infoColumn = new LinearLayout(activity);
            infoColumn.setOrientation(LinearLayout.VERTICAL);
            FrameLayout.LayoutParams at = new FrameLayout.LayoutParams(LayoutParams.WRAP_CONTENT, LayoutParams.WRAP_CONTENT, Gravity.TOP | Gravity.START);
            at.setMargins(dp(12), dp(148), dp(12), 0);
            area.addView(infoColumn, at);
        }
        return infoColumn;
    }
    void watchTouches(TouchWatcher w) { if (!watchers.contains(w)) watchers.add(w); }
    // A feature's own drawing over the whole map, under the buttons (it lets every touch through).
    void addOverMap(View v) { addView(v, indexOfChild(area), new LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.MATCH_PARENT)); }
    // A feature's own card: the same card as a trail's, with Details coming back to the page ("closed" then carries
    // feature: key and open: the feature's own number). details: false for a feature with nothing more to open.
    void showFeatureCard(String name, String sub, String colour, int open, LatLng at, String key, boolean details) {
        cardDetails.setVisibility(details ? VISIBLE : GONE);
        picked = open;
        pickedAt = at;
        pickedFeature = key;
        cardName.setText(name);
        cardSub.setText(sub == null ? "" : sub);
        cardSub.setVisibility(sub == null || sub.isEmpty() ? GONE : VISIBLE);
        cardSwatch.setBackground(round(colour(colour, Color.GRAY), 4));
        card.setVisibility(VISIBLE);
        cardSaid(true);
        // Under the page, a tapped webcam, pin or stop opens its page right away, with no small card first (alex
        // 2026-11-22: "Just open the page"). One with no details keeps its card.
        if (under && details) leave(true, false, null);
    }
    // A feature's own button, top right across from Back; added once, kept across style changes.
    void addToolButton(String title, Runnable handler) {
        TextView b = pill(title, (v) -> handler.run());
        LinearLayout.LayoutParams p = new LinearLayout.LayoutParams(LinearLayout.LayoutParams.WRAP_CONTENT, LinearLayout.LayoutParams.WRAP_CONTENT);
        p.bottomMargin = dp(8);
        toolStack.addView(b, p);
    }
    // Events from a feature to the page (its native-xxx.js listens with TrailMap.addListener).
    void send(String name, JSObject data) { if (!left) events.send(name, data); }
    // The camera flies to a box (a searched place), a little less tilted in 3D.
    void fly(LatLng sw, LatLng ne) {
        if (map == null) return;
        stopFollowingMe();
        CameraPosition c = map.getCameraForLatLngBounds(LatLngBounds.from(ne.getLatitude(), ne.getLongitude(), sw.getLatitude(), sw.getLongitude()),
            new int[] { dp(30), dp(90), dp(30), dp(110) });
        if (c == null) return;
        if (threeD) c = new CameraPosition.Builder(c).tilt(55).build();
        map.animateCamera(CameraUpdateFactory.newCameraPosition(c), 1600);
    }

    // ---------- taps ----------
    // A tap on a trail or a dot shows its card; a tap anywhere else closes it. Dots win: they sit on the trails.
    // A move by finger, going on or just ended: a tap then is part of moving the map (a short drag also read as a tap,
    // a touch that stops a fling), not a tap on what's there (alex 2026-11-22: "When you navigate on the map often the
    // page pops up").
    private boolean fingerMoving = false;
    private long fingerMovedAt = 0;
    private boolean tapped(LatLng point) {
        if (map == null || left) return false;
        if (fingerMoving || android.os.SystemClock.uptimeMillis() - fingerMovedAt < 300) return true;   // eaten, nothing opens
        PointF p = lastTouch != null && android.os.SystemClock.uptimeMillis() - lastTouchAt < 1000 ? lastTouch : map.getProjection().toScreenLocation(point);
        float r = dp(22);
        RectF box = new RectF(p.x - r, p.y - r, p.x + r, p.y + r);
        pickedAt = point;
        for (NativeLayer f : features) f.tapBegan(this);
        List<String> trailIds = new ArrayList<>();
        trailIds.add("tf-line");
        trailIds.addAll(dashLayers);
        // A tool that's on (planning, measuring) takes the tap first, with the trail under it.
        boolean tools = false;
        for (NativeLayer f : features) if (f.wantsTaps()) tools = true;
        if (tools) {
            int trail = -1;
            for (Feature f : map.queryRenderedFeatures(box, trailIds.toArray(new String[0]))) { int i = num(f, "i"); if (i >= 0) { trail = i; break; } }
            for (NativeLayer f : features) if (f.wantsTaps() && f.mapTapped(point, trail, this)) return true;
        }
        // A feature's own layers first (icons sit over the trails).
        for (NativeLayer f : features) {
            if (f.tapLayers().isEmpty()) continue;
            List<Feature> hit = map.queryRenderedFeatures(box, f.tapLayers().toArray(new String[0]));
            if (!hit.isEmpty() && f.tapped(hit.get(0), this)) return true;
        }
        List<String> ids = new ArrayList<>(trailIds);
        ids.add("tf-dots");
        Feature dot = null, numbered = null, any = null;
        for (Feature f : map.queryRenderedFeatures(box, ids.toArray(new String[0]))) {
            boolean named = num(f, "i") >= 0 || !str(f, "n").isEmpty();
            if (!named) continue;
            if (dot == null && f.geometry() instanceof Point) dot = f;
            if (numbered == null && num(f, "i") >= 0) numbered = f;
            if (any == null) any = f;
        }
        // Beside every trail and dot: a feature's own card for that spot (a slope's avalanche card, NativeAvalanche).
        if (any == null) for (NativeLayer f : features) if (f.emptyTap(point, this)) { showCard(null); return true; }
        if (under) {
            // The page's own card, as a tap on its flat map there (or none: the page closes what it had open).
            showCard(null);
            Feature f = dot != null ? dot : numbered != null ? numbered : any;
            JSObject e = new JSObject();
            e.put("open", f == null ? -1 : num(f, "i"));
            e.put("tapLat", point.getLatitude());
            e.put("tapLon", point.getLongitude());
            float d = getResources().getDisplayMetrics().density;   // where on the screen, in the page's CSS pixels
            e.put("x", (p.x + mapView.getLeft() + getLeft()) / d);
            e.put("y", (p.y + mapView.getTop() + getTop()) / d);
            events.send("tap", e);
            return true;
        }
        showCard(dot != null ? dot : numbered != null ? numbered : any);
        return true;
    }

    private void showCard(Feature f) {
        pickedFeature = null;
        cardSub.setVisibility(GONE);
        cardDetails.setVisibility(VISIBLE);
        if (f == null) { picked = -1; card.setVisibility(GONE); cardSaid(false); return; }
        picked = num(f, "i");
        String name = str(f, "n");
        cardName.setText(name.isEmpty() ? "Unnamed trail" : name);
        String c = f.geometry() instanceof Point ? str(f, "f") : str(f, "c");
        cardSwatch.setBackground(round(colour(c, Color.GRAY), 4));
        card.setVisibility(VISIBLE);
        cardSaid(true);
    }
    // Under the page: whether this map's own card shows ("card" { up }), so the page's Back closes it first on the one map,
    // where Back otherwise goes on as on the flat map (native-map.js backOut).
    private boolean cardWas = false;
    private void cardSaid(boolean up) {
        if (!under || up == cardWas) return;
        cardWas = up;
        JSObject e = new JSObject();
        e.put("up", up);
        send("card", e);
    }
    void hideCard() { showCard(null); }
    boolean cardShown() { return card.getVisibility() == VISIBLE; }

    static int num(Feature f, String k) {
        try { return f.hasProperty(k) && f.getProperty(k).isJsonPrimitive() ? f.getNumberProperty(k).intValue() : -1; } catch (Exception e) { return -1; }
    }
    static String str(Feature f, String k) {
        try { return f.hasProperty(k) && f.getProperty(k).isJsonPrimitive() ? f.getStringProperty(k) : ""; } catch (Exception e) { return ""; }
    }
    // "#rgb", "#rrggbb" (the colours the page uses); anything else is the fallback.
    static int colour(String s, int fallback) {
        if (s == null) return fallback;
        String h = s.trim();
        if (!h.startsWith("#")) return fallback;
        h = h.substring(1);
        if (h.length() == 3) h = "" + h.charAt(0) + h.charAt(0) + h.charAt(1) + h.charAt(1) + h.charAt(2) + h.charAt(2);
        if (h.length() != 6) return fallback;
        try { return 0xff000000 | Integer.parseInt(h, 16); } catch (NumberFormatException e) { return fallback; }
    }

    // ---------- buttons ----------
    private String styleTitle() {
        for (String[] s : styles()) if (s[0].equals(base)) return "▦ " + s[1];
        return "▦ Map";
    }
    private List<String[]> styles() {
        List<String[]> out = new ArrayList<>();
        if (threeD && winter) out.add(new String[] { "winter", "Winter" });
        out.addAll(Arrays.asList(threeD ? THREE_D : FLAT));
        return out;
    }
    private static boolean listed(String[][] list, String key) {
        for (String[] s : list) if (s[0].equals(key)) return true;
        return false;
    }
    private void nextStyle() {
        List<String[]> all = styles();
        int i = 0;
        for (int k = 0; k < all.size(); k++) if (all.get(k)[0].equals(base)) i = k;
        base = all.get((i + 1) % all.size())[0];
        styleBtn.setText(styleTitle());
        showStyle();
    }
    // The page's map style, picked in its Layers: the same style here when it has it (as the iPhone's setBase).
    private void setBase(String b) {
        String k = "sathybrid".equals(b) ? "sat" : "advtopo".equals(b) ? "vector"
            : Arrays.asList("cyclosm", "hot", "voyager", "osmde", "osmfr").contains(b) ? "osm" : b;
        if (k == null || k.equals(base)) return;
        boolean known = false;
        for (String[] s : styles()) if (s[0].equals(k)) known = true;
        if (!known) return;
        base = k;
        styleBtn.setText(styleTitle());
        showStyle();
    }

    // You on the map (when the app may use the location), and "Me" follows you.
    private boolean mayLocate() {
        return ContextCompat.checkSelfPermission(activity, Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED
            || ContextCompat.checkSelfPermission(activity, Manifest.permission.ACCESS_COARSE_LOCATION) == PackageManager.PERMISSION_GRANTED;
    }
    @SuppressLint("MissingPermission")
    private void showMe(Style style) {
        if (located || map == null || !mayLocate()) return;
        try {
            LocationComponent lc = map.getLocationComponent();
            lc.activateLocationComponent(LocationComponentActivationOptions.builder(activity, style).build());
            lc.setLocationComponentEnabled(true);
            lc.setRenderMode(RenderMode.NORMAL);
            located = true;
        } catch (Exception ignored) {}
    }
    private void locate() {
        if (map == null) return;
        Style style = map.getStyle();
        if (!located && style != null && style.isFullyLoaded()) showMe(style);
        if (!located) return;
        LocationComponent lc = map.getLocationComponent();
        lc.setCameraMode(lc.getCameraMode() == CameraMode.NONE ? CameraMode.TRACKING : CameraMode.NONE);
    }
    // A tool follows you: "heading" turns the map with you, "follow" keeps you in the middle, anything else stops.
    void followUser(String how) {
        if (map == null) return;
        Style style = map.getStyle();
        boolean on = "heading".equals(how) || "follow".equals(how);
        if (on && !located && style != null && style.isFullyLoaded()) showMe(style);
        if (!located) return;
        try {
            map.getLocationComponent().setCameraMode("heading".equals(how) ? CameraMode.TRACKING_COMPASS : on ? CameraMode.TRACKING : CameraMode.NONE);
        } catch (Exception ignored) {}
    }
    void stopFollowingMe() {
        if (located && map != null) { try { map.getLocationComponent().setCameraMode(CameraMode.NONE); } catch (Exception ignored) {} }
    }

    // ---------- leaving ----------
    // extra: a feature's own keys for the page ("closed").
    void leave(boolean details, boolean layers, Map<String, Object> extra) {
        if (left) return;
        // Under the page, Details (a card's, or a feature's own link such as the avalanche card's full forecast) opens on
        // the page over this map, which stays.
        if (under && (details || (extra != null && !extra.isEmpty()))) {
            JSObject e = camera();
            e.put("details", details && card.getVisibility() == VISIBLE && cardDetails.getVisibility() == VISIBLE);
            if (extra != null) for (Map.Entry<String, Object> x : extra.entrySet()) e.put(x.getKey(), x.getValue());
            e.put("open", picked);
            e.put("tapLat", pickedAt.getLatitude());
            e.put("tapLon", pickedAt.getLongitude());
            if (pickedFeature != null && e.getBool("details")) e.put("feature", pickedFeature);
            events.send("details", e);
            showCard(null);
            return;
        }
        left = true;
        JSObject e = camera();
        e.put("details", details && card.getVisibility() == VISIBLE && cardDetails.getVisibility() == VISIBLE);
        e.put("layers", layers);
        if (extra != null) for (Map.Entry<String, Object> x : extra.entrySet()) e.put(x.getKey(), x.getValue());
        e.put("open", picked);
        e.put("tapLat", pickedAt.getLatitude());
        e.put("tapLon", pickedAt.getLongitude());
        if (pickedFeature != null && e.getBool("details")) e.put("feature", pickedFeature);
        events.send("closed", e);
        animate().alpha(0).setDuration(200).withEndAction(this::destroy).start();
    }
    boolean isLeft() { return left; }

    // The page's grid: { s: cell size (dp), c: columns, r: rows, m: "0101…" row by row (1: map), t, b: its rows of
    // buttons from the top and bottom (dp), cam: { lat, lon, zoom, bearing } where the page moved its map (a search, a card),
    // me: true (the page's My location: follow you), back: true (Back with nothing of the page's open) }.
    void applyUnder(String json) {
        if (!under) return;
        try {
            org.json.JSONObject o = new org.json.JSONObject(json);
            if (o.has("m") && o.optInt("c") > 0 && o.optInt("r") > 0) {
                String m = o.optString("m");
                byte[] bits = new byte[m.length()];
                for (int i = 0; i < bits.length; i++) bits[i] = (byte) (m.charAt(i) == '1' ? 1 : 0);
                maskCell = (float) o.optDouble("s", 10); maskCols = o.optInt("c"); maskRows = o.optInt("r"); maskBits = bits;
            }
            if (o.has("t") && o.has("b")) {
                int t = dp((int) Math.round(o.optDouble("t"))), b = dp((int) Math.round(o.optDouble("b")));
                if (t != uiTop || b != uiBottom) { uiTop = t; uiBottom = b; padArea(); }
            }
            org.json.JSONObject cam = o.optJSONObject("cam");
            // The page's 3D / 2D button on the one map: tips this map up into 3D or down to straight above, at the spot
            // asked (cam) when there is one (a tour shown in 3D), in one move.
            if (o.has("tilt") && map != null && !left) {
                double to = o.optBoolean("tilt") ? TILT : 0;
                if (cam == null) { pitchTo(to); }
                else {
                    stopFollowingMe();
                    tilted = true;
                    CameraPosition.Builder c = new CameraPosition.Builder(map.getCameraPosition())
                        .target(new LatLng(cam.getDouble("lat"), cam.getDouble("lon"))).zoom(cam.getDouble("zoom")).tilt(to);
                    map.animateCamera(CameraUpdateFactory.newCameraPosition(c.build()), 1200);
                }
                cam = null;
            }
            if (cam != null && map != null && !left) {
                stopFollowingMe();
                CameraPosition now = map.getCameraPosition();
                CameraPosition.Builder c = new CameraPosition.Builder(now)
                    .target(new LatLng(cam.getDouble("lat"), cam.getDouble("lon"))).zoom(cam.getDouble("zoom"));
                if (cam.has("bearing")) c.bearing(cam.getDouble("bearing"));
                map.animateCamera(CameraUpdateFactory.newCameraPosition(c.build()), 600);
            }
            if (o.optBoolean("me") && map != null && !left) locate();   // the page's My location: follow you   // the page's My location: follow you
            if (o.optBoolean("back") && !left) { if (cardShown()) hideCard(); else leave(false, false, null); }   // Back
        } catch (Exception ignored) {}
    }
    // Whether the page shows nothing of its own at this point (in the web view's px): the map's touch.
    boolean mapTakes(float x, float y) {
        float d = getResources().getDisplayMetrics().density;
        if (maskCell <= 0 || maskBits.length == 0) { float h = getHeight() / d, yy = y / d; return yy > 110 && yy < h - 170; }
        int c = (int) (x / d / maskCell), r = (int) (y / d / maskCell);
        if (c < 0 || r < 0 || c >= maskCols || r >= maskRows || r * maskCols + c >= maskBits.length) return false;
        return maskBits[r * maskCols + c] == 1;
    }

    private JSObject camera() {
        JSObject o = new JSObject();
        if (map == null) {
            o.put("lat", start.getLatitude()); o.put("lon", start.getLongitude()); o.put("zoom", startZoom); o.put("bearing", startBearing);
            return o;
        }
        CameraPosition c = map.getCameraPosition();
        o.put("lat", c.target != null ? c.target.getLatitude() : start.getLatitude());
        o.put("lon", c.target != null ? c.target.getLongitude() : start.getLongitude());
        o.put("zoom", c.zoom);
        o.put("pitch", c.tilt);
        o.put("bearing", c.bearing);
        return o;
    }

    // ---------- the app's comings and goings (TrailMapPlugin passes them on) ----------
    void onStart() { if (!destroyed) mapView.onStart(); }
    void onResume() { if (!destroyed) mapView.onResume(); }
    void onPause() { if (!destroyed) mapView.onPause(); }
    void onStop() { if (!destroyed) mapView.onStop(); }
    private boolean destroyed = false;
    void destroy() {
        if (destroyed) return;
        destroyed = true;
        try {
            if (located && map != null) map.getLocationComponent().setLocationComponentEnabled(false);
        } catch (Exception ignored) {}
        mapView.onPause();
        mapView.onStop();
        mapView.onDestroy();
        if (getParent() instanceof android.view.ViewGroup) ((android.view.ViewGroup) getParent()).removeView(this);
    }

    // ---------- looks ----------
    int dp(float v) { return Math.round(v * getResources().getDisplayMetrics().density); }
    private GradientDrawable round(int colour, float radiusDp) {
        GradientDrawable g = new GradientDrawable();
        g.setColor(colour);
        g.setCornerRadius(dp(radiusDp));
        return g;
    }
    private TextView pill(String title, View.OnClickListener tap) {
        TextView b = new TextView(activity);
        b.setText(title);
        b.setTextColor(INK);
        b.setTextSize(TypedValue.COMPLEX_UNIT_SP, 15);
        b.setTypeface(Typeface.create("sans-serif-medium", Typeface.NORMAL));
        b.setPadding(dp(14), dp(10), dp(14), dp(10));
        b.setBackground(round(Color.argb(245, 255, 255, 255), 22));
        b.setElevation(dp(3));
        b.setClickable(true);
        b.setOnClickListener(tap);
        return b;
    }
    private LinearLayout.LayoutParams gap() {
        LinearLayout.LayoutParams p = new LinearLayout.LayoutParams(LinearLayout.LayoutParams.WRAP_CONTENT, LinearLayout.LayoutParams.WRAP_CONTENT);
        p.setMarginEnd(dp(8));
        return p;
    }
    private LayoutParams at(int gravity, int l, int t, int r, int b) {
        LayoutParams p = new LayoutParams(LayoutParams.WRAP_CONTENT, LayoutParams.WRAP_CONTENT, gravity);
        p.setMargins(dp(l), dp(t), dp(r), dp(b));
        return p;
    }
}
