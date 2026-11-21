package com.allduf.trailmap;

import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.graphics.Color;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.util.Base64;
import android.util.TypedValue;
import android.view.Gravity;
import android.widget.FrameLayout;
import android.widget.TextView;
import org.json.JSONArray;
import org.json.JSONObject;
import org.maplibre.android.geometry.LatLng;
import org.maplibre.android.geometry.LatLngQuad;
import org.maplibre.android.maps.Style;
import org.maplibre.android.style.layers.Layer;
import org.maplibre.android.style.layers.Property;
import org.maplibre.android.style.layers.PropertyFactory;
import org.maplibre.android.style.layers.RasterLayer;
import org.maplibre.android.style.sources.ImageSource;
import org.maplibre.android.style.sources.RasterSource;
import org.maplibre.android.style.sources.Source;
import org.maplibre.android.style.sources.TileSet;

// Rain and snow radar (radar.js) and wildfire smoke (smoke.js) in native 3D, the Android side of NativeWeather.swift
// (native 3D parity step 5). Both are Environment Canada pictures laid on the ground under the trails, so one class draws
// either: the page sends what it shows now (the same hour or frame as its bar) under the key "radar" or "smoke":
//   {}                                                    nothing (the layer is off, or no forecast covers that hour)
//   { "tiles": url, "maxzoom": 7, "opacity": 0.7, ... }   ready-made map pictures (url with {bbox-epsg-3857})
//   { "image": "data:image/png;base64,...", "bounds": [s, w, n, e], "opacity": 1, ... }   one picture the page painted
// with "caption" (what it is, the hour and the source, in the page's language) shown at the top of the screen, as the
// page's bar does, and "credit" for the map's credits. Nothing is drawn or loaded while the page sends {}.
final class NativeOverlay implements NativeLayer {
    private final String key;
    private final int row;                 // the caption's row at the top (radar 0, smoke 1), so both can show
    private JSONObject info = new JSONObject();
    private String shown = "";             // what's on the map now: the tiles' url, "image", or "" for nothing
    private int gen = 0;                   // a tile source can't change its url: a new one replaces it
    private TrailMapScreen screen;
    private TextView caption;

    NativeOverlay(String key, int row) { this.key = key; this.row = row; }

    private String layerId() { return "tf-" + key + "-" + gen; }

    @Override public String key() { return key; }

    @Override
    public void added(Style style, TrailMapScreen screen) {
        this.screen = screen;
        shown = "";                        // a new style has none of it
        showCaption();
        apply(style);
    }

    @Override
    public void setData(String json, Style style) {
        try { info = new JSONObject(json); } catch (Exception e) { info = new JSONObject(); }
        showCaption();
        if (style != null) apply(style);
    }

    private void remove(Style style) {
        Layer l = style.getLayer(layerId());
        if (l != null) style.removeLayer(l);
        Source s = style.getSource(layerId());
        if (s != null) style.removeSource(s);
    }

    // On the ground with the photos, under the trails (as on the web 3D map, under its roads and trail lines).
    private void put(Layer layer, Style style) {
        String below = screen != null ? screen.trailsBottomLayer() : null;
        if (below != null && style.getLayer(below) != null) style.addLayerBelow(layer, below);
        else style.addLayer(layer);
    }

    private RasterLayer raster(float opacity) {
        RasterLayer l = new RasterLayer(layerId(), layerId());
        l.setProperties(
            PropertyFactory.rasterOpacity(opacity),
            PropertyFactory.rasterFadeDuration(0f),
            PropertyFactory.rasterResampling(Property.RASTER_RESAMPLING_LINEAR));
        return l;
    }

    private void apply(Style style) {
        float opacity = (float) info.optDouble("opacity", 0.7);
        String tiles = info.optString("tiles", "");
        if (!tiles.isEmpty()) {
            if (tiles.equals(shown)) {
                Layer l = style.getLayer(layerId());
                if (l != null) l.setProperties(PropertyFactory.rasterOpacity(opacity));
                return;
            }
            remove(style);
            gen++;
            shown = tiles;
            TileSet set = new TileSet("2.2.0", tiles);
            set.setMaxZoom(info.optInt("maxzoom", 7));
            String credit = info.optString("credit", "");
            if (!credit.isEmpty()) set.setAttribution(credit);
            style.addSource(new RasterSource(layerId(), set, 256));
            put(raster(opacity), style);
            return;
        }
        String url = info.optString("image", "");
        JSONArray b = info.optJSONArray("bounds");
        Bitmap img = null;
        int comma = url.indexOf(',');
        if (comma > 0 && b != null && b.length() == 4) {
            try {
                byte[] bytes = Base64.decode(url.substring(comma + 1), Base64.DEFAULT);
                img = BitmapFactory.decodeByteArray(bytes, 0, bytes.length);
            } catch (IllegalArgumentException ignored) {}
        }
        if (img != null) {
            double s = b.optDouble(0), w = b.optDouble(1), n = b.optDouble(2), e = b.optDouble(3);
            LatLngQuad quad = new LatLngQuad(new LatLng(n, w), new LatLng(n, e), new LatLng(s, e), new LatLng(s, w));
            // The same picture source keeps its layer: a new forecast frame or place swaps in without a blink.
            if ("image".equals(shown) && style.getSource(layerId()) instanceof ImageSource) {
                ImageSource src = (ImageSource) style.getSource(layerId());
                src.setImage(img);
                src.setCoordinates(quad);
                Layer l = style.getLayer(layerId());
                if (l != null) l.setProperties(PropertyFactory.rasterOpacity(opacity));
                return;
            }
            remove(style);
            gen++;
            shown = "image";
            style.addSource(new ImageSource(layerId(), quad, img));
            put(raster(opacity), style);
            return;
        }
        if (info.has("image") && "image".equals(shown)) return;   // a picture that didn't decode: keep the last one
        remove(style);
        shown = "";
    }

    // ---------- the caption: what the map shows, which hour, and where it comes from ----------
    private void showCaption() {
        if (screen == null) return;
        String text = info.optString("caption", "");
        if (caption == null) {
            TextView c = new TextView(screen.getContext());
            c.setTextColor(Color.WHITE);
            c.setTextSize(TypedValue.COMPLEX_UNIT_SP, 12);
            c.setTypeface(Typeface.DEFAULT_BOLD);
            c.setMaxLines(2);
            c.setPadding(screen.dp(8), screen.dp(4), screen.dp(8), screen.dp(4));
            GradientDrawable bg = new GradientDrawable();
            bg.setColor(Color.argb(191, 20, 33, 26));
            bg.setCornerRadius(screen.dp(10));
            c.setBackground(bg);
            FrameLayout.LayoutParams at = new FrameLayout.LayoutParams(FrameLayout.LayoutParams.WRAP_CONTENT, FrameLayout.LayoutParams.WRAP_CONTENT, Gravity.TOP | Gravity.START);
            at.setMargins(screen.dp(12), screen.dp(60 + row * 44), screen.dp(12), 0);
            screen.mapArea().addView(c, at);
            caption = c;
        }
        caption.setText(text);
        caption.setVisibility(text.isEmpty() ? android.view.View.GONE : android.view.View.VISIBLE);
    }
}
