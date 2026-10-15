# Temporary: what the fire hosts answer from GitHub Actions.
g() { echo; echo "=== $1"; curl -sS -m 60 -A "trail-finder probe" -w "\n[HTTP %{http_code}, %{size_download} bytes]\n" "$1" | head -c "${2:-3000}"; echo; }
C=https://cwfis.cfs.nrcan.gc.ca/geoserver/public
g "$C/wfs?service=WFS&version=2.0.0&request=GetCapabilities" 200
curl -sS -m 60 "$C/wfs?service=WFS&version=2.0.0&request=GetCapabilities" | grep -o '<Name>[^<]*</Name>' | sort -u | head -200
for L in public:activefires_current public:m3_polygons_current public:m3_polygons public:hotspots_last24hrs public:activefires; do
  g "$C/wfs?service=WFS&version=2.0.0&request=GetFeature&typeName=$L&outputFormat=application/json&count=2" 2500
  g "$C/wfs?service=WFS&version=2.0.0&request=GetFeature&typeName=$L&outputFormat=application/json&resultType=hits" 600
done
g "https://cwfis.cfs.nrcan.gc.ca/downloads/activefires/activefires.csv" 1500
g "https://cwfis.cfs.nrcan.gc.ca/downloads/" 3000
g "https://cwfis.cfs.nrcan.gc.ca/datamart" 1500
A=https://geospatial.alberta.ca/titan/rest/services
g "$A?f=json" 4000
g "$A/environment?f=json" 4000
g "$A/environment/wildfire?f=json" 4000
g "https://geospatial.alberta.ca/titan/rest/services/environment/wildfire/MapServer?f=json" 4000
g "https://services.arcgis.com/Eb8P5h4CJk8utIBz/arcgis/rest/services?f=json" 6000
g "https://www.albertafirebans.ca/" 800
g "https://www.alberta.ca/wildfire-status" 400
g "https://www.alberta.ca/alberta-emergency-alert" 400
g "https://www.emergencyalert.alberta.ca/content/rss/alerts.xml" 2000
g "https://www.emergencyalert.alberta.ca/aeapublic/feed.atom" 2000
g "https://open.alberta.ca/api/3/action/package_search?q=wildfire&rows=20" 6000
g "https://open.alberta.ca/api/3/action/package_search?q=fire%20ban&rows=10" 4000
exit 0
