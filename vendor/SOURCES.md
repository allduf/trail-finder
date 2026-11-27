# Libraries served from the site itself

Each file is copied byte for byte from the official npm release named here (checked 2026-11-11 against the npm registry's own checksum, and against the CDN copy the app used before). To check a file again: `npm pack <package>@<version>`, unpack it, and compare the sha256 below.

| File | npm package | File in the package | sha256 |
|---|---|---|---|
| leaflet-1.9.4.js | leaflet@1.9.4 | dist/leaflet.js | `db49d009c841f5ca34a888c96511ae936fd9f5533e90d8b2c4d57596f4e5641a` |
| leaflet-1.9.4.css | leaflet@1.9.4 | dist/leaflet.css | `a7837102824184820dfa198d1ebcd109ff6d0ff9a2672a074b9a1b4d147d04c6` |
| images/layers.png | leaflet@1.9.4 | dist/images/layers.png | `1dbbe9d028e292f36fcba8f8b3a28d5e8932754fc2215b9ac69e4cdecf5107c6` |
| images/layers-2x.png | leaflet@1.9.4 | dist/images/layers-2x.png | `066daca850d8ffbef007af00b06eac0015728dee279c51f3cb6c716df7c42edf` |
| images/marker-icon.png | leaflet@1.9.4 | dist/images/marker-icon.png | `574c3a5cca85f4114085b6841596d62f00d7c892c7b03f28cbfa301deb1dc437` |
| images/marker-icon-2x.png | leaflet@1.9.4 | dist/images/marker-icon-2x.png | `00179c4c1ee830d3a108412ae0d294f55776cfeb085c60129a39aa6fc4ae2528` |
| images/marker-shadow.png | leaflet@1.9.4 | dist/images/marker-shadow.png | `264f5c640339f042dd729062cfc04c17f8ea0f29882b538e3848ed8f10edb4da` |
| leaflet-rotate-0.2.8.js | leaflet-rotate@0.2.8 | dist/leaflet-rotate.js | `4dae04e684466dc24346a99fa7aa9bccaeee0ef690c91d320ce18fe818b5360f` |
| maplibre-gl-5.24.0.js | maplibre-gl@5.24.0 | dist/maplibre-gl.js | `45a9b07a9189ce56054c620a947ccf41e291e58c95e9b61533b740aaa65ee5cb` |
| maplibre-gl-5.24.0.css | maplibre-gl@5.24.0 | dist/maplibre-gl.css | `ab1e70d59ec40465bae7e7030da2f3ccf28133fd502e62bd598eefbadfd7a732` |
| maplibre-gl-leaflet-0.1.3.js | @maplibre/maplibre-gl-leaflet@0.1.3 | leaflet-maplibre-gl.js | `1c33367962e7755c1a16d1f85658fdc96b5baa36f81adfca9493174cd1b526ce` |
| supabase-js-2.99.3.js | @supabase/supabase-js@2.99.3 | dist/umd/supabase.js | `588fb53d9380e3cb8688065c48144fa839205c328b416cc68c11331ba01955ee` |
| exifr-lite-7.1.3.js | exifr@7.1.3 | dist/lite.umd.js | `530dbaef11cd9d4d65f108abc159b113580eb3dbd7bc69cd1364e25dd40413f9` |
| maplibre-contour-0.1.1.js | maplibre-contour@0.1.1 (BSD-3-Clause) | dist/index.min.js | `055e45d0a76aaeaaf5a96765b8ce524abba3272456be75e715081e235ebd1262` |
| geotiff-2.1.3/compression/jpeg.js | geotiff@2.1.3 (MIT) | dist-module/compression/jpeg.js | `607cd7114c4e0cffbe5bd4a2ec49350bb3e12dbe3f5edb8f60fb3afe4a71153d` |
| geotiff-2.1.3/compression/basedecoder.js | geotiff@2.1.3 (MIT) | dist-module/compression/basedecoder.js | `8d1f95fb468a03b73c304cb277cf11207e78b5a426b9cda4c8a7de930ea376f1` |
| geotiff-2.1.3/predictor.js | geotiff@2.1.3 (MIT) | dist-module/predictor.js | `e65343613131379847315aa377692b8a1906595029a2d502bb4de4b00d67ae02` |
| acorn-8.19.0.mjs | acorn@8.19.0 (MIT) | dist/acorn.mjs | `76254fc76529713b4dfd2532972d17a991ffd9aafeebb1f977445b5506b9fb0b` |
| fonts/archivo-latin-ext-wdth-normal.woff2 | @fontsource-variable/archivo@5.3.0 (OFL-1.1) | files/archivo-latin-ext-wdth-normal.woff2 | `5717f37059660ca5c899bad6c48ee22c3ac55cb3c484055241689d0f905a1a86` |
| fonts/archivo-latin-wdth-normal.woff2 | @fontsource-variable/archivo@5.3.0 (OFL-1.1) | files/archivo-latin-wdth-normal.woff2 | `e3a28eade21a900c7155a247757f4b2834c07bb7ef07ad7efa55cebaac1e8f5e` |
| fonts/barlow-condensed-latin-600-normal.woff2 | @fontsource/barlow-condensed@5.3.0 (OFL-1.1) | files/barlow-condensed-latin-600-normal.woff2 | `215a93c696f442034a46fbb382958f753fda60e30490683aeea6b235fcbb2b66` |
| fonts/barlow-condensed-latin-700-normal.woff2 | @fontsource/barlow-condensed@5.3.0 (OFL-1.1) | files/barlow-condensed-latin-700-normal.woff2 | `3787a5a419171630e6890cfa47c4da067474d005cd0ff8dc11ec090fdc3ee2b8` |
| fonts/barlow-condensed-latin-ext-600-normal.woff2 | @fontsource/barlow-condensed@5.3.0 (OFL-1.1) | files/barlow-condensed-latin-ext-600-normal.woff2 | `aef7edf54f79a5329fbca9c065b56dcec3852c680d58cf89a9ef2db6940ca4b3` |
| fonts/barlow-condensed-latin-ext-700-normal.woff2 | @fontsource/barlow-condensed@5.3.0 (OFL-1.1) | files/barlow-condensed-latin-ext-700-normal.woff2 | `9d351bd9222bfab90f943850f8039aa73cdb40e0a6cfe4127308a48bef59d5f5` |
| fonts/barlow-latin-400-normal.woff2 | @fontsource/barlow@5.3.0 (OFL-1.1) | files/barlow-latin-400-normal.woff2 | `b0a8ad37ac45f5fb22ced461576db72e44e295107aad7a9c8a7a4bad728fd03b` |
| fonts/barlow-latin-500-normal.woff2 | @fontsource/barlow@5.3.0 (OFL-1.1) | files/barlow-latin-500-normal.woff2 | `cd759df8ef9efc98fee14307b4eb5ba27f08b1f8f2f3ad2872432e25c89907a8` |
| fonts/barlow-latin-600-normal.woff2 | @fontsource/barlow@5.3.0 (OFL-1.1) | files/barlow-latin-600-normal.woff2 | `4b52ddd4836b592df0e4832b8286956883cdc651b015126bdd18f184b7f90cc3` |
| fonts/barlow-latin-ext-400-normal.woff2 | @fontsource/barlow@5.3.0 (OFL-1.1) | files/barlow-latin-ext-400-normal.woff2 | `122b24bc2a90b0abe189f5229768bf2e9ba641324fe2459b48850079625934f1` |
| fonts/barlow-latin-ext-500-normal.woff2 | @fontsource/barlow@5.3.0 (OFL-1.1) | files/barlow-latin-ext-500-normal.woff2 | `3facdf66b60778c7e64693013be7799e6686b2488dad65525b4036e211ab03e0` |
| fonts/barlow-latin-ext-600-normal.woff2 | @fontsource/barlow@5.3.0 (OFL-1.1) | files/barlow-latin-ext-600-normal.woff2 | `b7f099c421968b583734bc631e6706bff8fc23908112a219f5f0e37f59b03b32` |
| fonts/inter-latin-ext-wght-normal.woff2 | @fontsource-variable/inter@5.3.0 (OFL-1.1) | files/inter-latin-ext-wght-normal.woff2 | `34b9c504cab7a73e37b746343a449132e56cf7b5481af2cb81dc74dcff25c956` |
| fonts/inter-latin-wght-normal.woff2 | @fontsource-variable/inter@5.3.0 (OFL-1.1) | files/inter-latin-wght-normal.woff2 | `3100e775e8616cd2611beecfa23a4263d7037586789b43f035236a2e6fbd4c62` |
| fonts/jetbrains-mono-latin-400-normal.woff2 | @fontsource/jetbrains-mono@5.3.0 (OFL-1.1) | files/jetbrains-mono-latin-400-normal.woff2 | `14425ba9c695763c1547f48a206b7aa60350a33ae23de09f0407877f3fcd89eb` |
| fonts/jetbrains-mono-latin-ext-400-normal.woff2 | @fontsource/jetbrains-mono@5.3.0 (OFL-1.1) | files/jetbrains-mono-latin-ext-400-normal.woff2 | `505dfba8ecbe77e82765f36d317ed7ef4ac42719dc5f4ae68d1c483fd22d0d14` |

geotiff 2.1.3's JPEG reader (the three module files above, same folders as in the package so their imports work) moved here from cdn.jsdelivr.net on 2026-11-21 (security check; the CDN copies had the same sha256).

The fonts (fonts/, from the Fontsource packages above, checked 2026-11-27 against the npm registry's checksum) moved here from Google Fonts on 2026-11-27 (security and privacy check), so opening the app sends nothing to Google. fonts/app-fonts-5.3.0.css (index.html) and fonts/ride-fonts-5.3.0.css (ride.html) are ours: the packages' own @font-face lines, Latin and Latin Extended only, with the family names and the weight and width ranges the pages used from Google. Each font's licence is next to it (fonts/LICENSE-*.txt).

Still loaded from cdn.jsdelivr.net at a fixed version: tesseract.js 5.1.1 (Photo find text reading: its worker, the 3-4 MB reading engine and the English data), too large to copy here for now. Photo find is open only to alex and friends (PF_PUBLIC).

Loaded from challenges.cloudflare.com on purpose: Cloudflare Turnstile's api.js (the person check in the sign-in box, account.js `CAPTCHA_KEY`). Cloudflare serves it only from its own address and changes it without notice, so it can't be copied here. It loads only once the sign-in box opens, and only when a site key is set.

## iPhone app (ios-app/), not served by the site

The iPhone app's TrailMap plugin (ios-app/plugins/TrailMap) gets MapLibre Native as a ready-built framework that Xcode downloads and checks against this sha256 (Swift Package Manager refuses it if one byte differs). Since 2026-11-16 it is a community build with 3D mountains, because the official MapLibre Native has none yet (maplibre-native issue #252). It is **not an official MapLibre release**. Only the alex-only "Native map (test)" and "Native 3D (test)" screens use it.

| File | From | sha256 |
|---|---|---|
| MapLibre.dynamic.xcframework.zip | github.com/kaiuhl/maplibre-native release `glassing-terrain-20261109-337f1b4ba8a3` (feature/terrain-3d branch, 2026-11-09) | `49fcee33e83d69d87b525f28ab7025727f70affbf17a6afa67cf6d2ff0395bf9` |

## Android app (android-app/), not served by the site

The Android app's TrailReview plugin (android-app/plugins/TrailReview) shows Google Play's own rating card with Google's
Play In-App Review library, which Gradle downloads from Google's Maven at a fixed version. The iPhone's TrailReview uses
Apple's StoreKit (part of iOS, nothing to download).

| File | From | sha256 |
|---|---|---|
| review-2.0.2.aar | com.google.android.play:review:2.0.2 (dl.google.com/dl/android/maven2) | `1602026678231dba0f7482d1244e45ff83d9ff22fc8b6d6be8961228ac7a32dd` |

The Android app's TrailMap plugin (android-app/plugins/TrailMap) gets MapLibre Native for Android with 3D mountains the
same way: Gradle downloads it from one fixed commit of github.com/WxByte/maplibre-native-maven (raw files at a commit
never change), and the plugin's `checkMapLibre` step stops the build if its sha256 differs. Like the iPhone's, it is a
community build of MapLibre's terrain work (SatSquatch's globe-terrain branch, OpenGL ES, BSD-2-Clause), **not an
official MapLibre release**; only the alex-only native map screens use it (since 2026-11-21).

| File | From | sha256 |
|---|---|---|
| okhttp-4.12.0.jar | com.squareup.okhttp3:okhttp:4.12.0 (Maven Central, Apache-2.0; MapLibre's own download library, named by TrailMap to rewrite tile addresses) | `b1050081b14bb7a3a7e55a4d3ef01b5dcfabc453b4573a4fc019767191d5f4e0` |
| android-sdk-opengl-2026.10.19-globe-terrain-ss.13.aar | org.maplibre.gl:android-sdk-opengl:2026.10.19-globe-terrain-ss.13 (raw.githubusercontent.com/WxByte/maplibre-native-maven, commit `ff565a677d6f3ba8e7e0af4b1ceb3c53d3e9025a`) | `bdcdfda7b646a2a96659ddb5de34fca53c741d3221fe79c980ed6908ab4bfce1` |

acorn 8.19.0 is a build tool, not part of the app: scripts/trim-site.mjs uses its tokenizer to trim the site's scripts at publish (2026-11-26). The publish leaves it out of the website.
