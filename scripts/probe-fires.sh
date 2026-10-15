# Temporary: what the fire hosts answer from GitHub Actions.
g() { echo; echo "=== $1"; curl -sS -m 60 -A "trail-finder probe" -o /tmp/o "$1" -w "[HTTP %{http_code}, %{size_download} bytes]\n"; head -c "${2:-3000}" /tmp/o; echo; }
D=https://cwfis.cfs.nrcan.gc.ca/downloads
g "$D/licence.txt" 2000
g "$D/reportedfires/" 3000
g "$D/evacs/" 3000
g "$D/hotspots/" 3000
curl -sS -m 60 "https://cwfis.cfs.nrcan.gc.ca/geoserver/wfs?service=WFS&version=2.0.0&request=GetCapabilities" -o /tmp/caps; grep -o '<Name>[^<]*</Name>' /tmp/caps | sort -u | tr '\n' ' '; echo
curl -sS -m 60 "https://cwfis.cfs.nrcan.gc.ca/geoserver/wms?service=WMS&request=GetCapabilities" -o /tmp/wcaps; grep -o '<Name>[^<]*</Name>' /tmp/wcaps | sort -u | grep -i -E "fire|evac|perim|m3" | tr '\n' ' '; echo
for f in $(curl -sS -m 60 "$D/reportedfires/" | grep -o 'href="[^"?/][^"]*"' | cut -d'"' -f2 | head -8); do g "$D/reportedfires/$f" 1500; done
for f in $(curl -sS -m 60 "$D/evacs/" | grep -o 'href="[^"?/][^"]*"' | cut -d'"' -f2 | head -8); do g "$D/evacs/$f" 1500; done
C=https://cwfis.cfs.nrcan.gc.ca/geoserver/public/wfs
g "$C?service=WFS&version=2.0.0&request=GetFeature&typeName=public:m3_polygons_current&outputFormat=application/json&srsName=EPSG:4326&count=1&propertyName=uid,hcount,firstdate,lastdate,area,status,firetype,agency" 1500
g "$C?service=WFS&version=1.1.0&request=GetFeature&typeName=public:m3_polygons_current&resultType=hits" 800
A=https://services.arcgis.com/Eb8P5h4CJk8utIBz/ArcGIS/rest/services
for S in alberta_fire_ban_system _fire_control_order_markers off_highway_vehicle_ohv_restriction provincial_parks_fire_ban_markers fire_danger_rating; do
  g "$A/$S/FeatureServer?f=json" 2500
  for i in 0 1 2; do g "$A/$S/FeatureServer/$i/query?where=1%3D1&outFields=*&returnGeometry=false&resultRecordCount=2&f=json" 2500; g "$A/$S/FeatureServer/$i/query?where=1%3D1&returnCountOnly=true&f=json" 200; done
done
curl -sS -m 60 "$A?f=json" | grep -o '"name":"[^"]*"' | tr '\n' ' '; echo
exit 0
