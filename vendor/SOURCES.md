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

Still loaded from cdn.jsdelivr.net at a fixed version: tesseract.js 5.1.1 (Photo find text reading: its worker, the 3-4 MB reading engine and the English data) and geotiff 2.1.3's JPEG reader (height tiles). Both are too large or split into many module files to copy here for now.
