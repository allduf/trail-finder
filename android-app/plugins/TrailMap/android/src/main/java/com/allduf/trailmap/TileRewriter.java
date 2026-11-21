package com.allduf.trailmap;

import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import okhttp3.Dispatcher;
import okhttp3.HttpUrl;
import okhttp3.OkHttpClient;
import okhttp3.Request;
import org.maplibre.android.module.http.HttpRequestUtil;

// MapLibre downloads every tile with one OkHttp client for the whole app (as TileRewriter.swift is MapLibre's one URL
// rewriter on the iPhone). Features whose tiles are spread over several sites (Winter photos, the late-summer mountains)
// give their style a made-up address and register its host here with the function that turns it into the real one.
// Called off the main thread, for every download; other addresses pass unchanged.
final class TileRewriter {
    interface Rewrite { String real(HttpUrl url); }

    private static final Map<String, Rewrite> hosts = new ConcurrentHashMap<>();
    private static boolean installed = false;

    static synchronized void add(String host, Rewrite rewrite) {
        hosts.put(host, rewrite);
        if (installed) return;
        installed = true;
        Dispatcher d = new Dispatcher();
        d.setMaxRequestsPerHost(20);   // as MapLibre's own client
        HttpRequestUtil.setOkHttpClient(new OkHttpClient.Builder()
            .dispatcher(d)
            .addInterceptor((chain) -> {
                Request r = chain.request();
                Rewrite f = hosts.get(r.url().host());
                if (f != null) {
                    String real = null;
                    try { real = f.real(r.url()); } catch (Exception ignored) {}
                    HttpUrl u = real == null ? null : HttpUrl.parse(real);
                    r = r.newBuilder().url(u != null ? u : HttpUrl.get(WinterTiles.NONE)).build();
                }
                return chain.proceed(r);
            })
            .build());
    }
}
