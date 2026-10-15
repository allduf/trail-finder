# Temporary: what the fire hosts answer from GitHub Actions.
g() { echo; echo "=== $1"; curl -sS -m 90 -A "trail-finder probe" -o /tmp/o "$1" -w "[HTTP %{http_code}, %{size_download} bytes]\n"; head -c "${2:-3000}" /tmp/o; echo; }
W="https://geoserver.cwfif.nrcan.gc.ca/geoserver/wfs?service=WFS&version=2.0.0&request=GetFeature&typeName=public:cwfif_national_activefires&outputFormat=application/json&srsName=EPSG:4326&CQL_FILTER=now()%3E=record_start%20AND%20now()%3C=record_end"
g "$W&count=3" 3000
curl -sS -m 90 "$W" -o /tmp/af.json -w "[HTTP %{http_code}, %{size_download} bytes]\n"
python3 -c "
import json,collections
d=json.load(open('/tmp/af.json'));f=d['features'];print(len(f),'active fires')
print(collections.Counter(x['properties']['agency_code'] for x in f))
print(collections.Counter(x['properties']['stage_of_control_status'] for x in f))
print(collections.Counter(x['properties']['response_type'] for x in f))
print([x['properties'] for x in f if x['properties']['agency_code'] not in ('BC',)][:3])
"
curl -sS -m 90 "https://geoserver.cwfif.nrcan.gc.ca/geoserver/wfs?service=WFS&request=GetCapabilities" -o /tmp/c2; grep -o '<Name>[^<]*</Name>' /tmp/c2 | sort -u | tr '\n' ' '; echo
M="https://cwfis.cfs.nrcan.gc.ca/geoserver/public/wfs?service=WFS&version=2.0.0&request=GetFeature&typeName=public:m3_polygons_current&outputFormat=application/json&srsName=EPSG:4326"
curl -sS -m 120 "$M" -o /tmp/m3.json -w "[HTTP %{http_code}, %{size_download} bytes]\n"
python3 -c "
import json
d=json.load(open('/tmp/m3.json'));f=d['features'];print(len(f),'m3 polys')
ds=sorted(x['properties']['lastdate'] for x in f); print('lastdate range',ds[0],ds[-1]); print('firstdate min',min(x['properties']['firstdate'] for x in f))
c=lambda x: x['geometry']['coordinates']
print(f[0]['properties'], str(c(f[0]))[:200])
import statistics; print('areas', sorted(x['properties']['area'] for x in f)[-5:])
"
A=https://geospatial.alberta.ca/mimas/rest/services/wildfire
for i in 4 5 6 7 8 9; do g "$A/alberta_fire_status_by_category_group/MapServer/$i?f=json" 300; g "$A/alberta_fire_status_by_category_group/MapServer/$i/query?where=1%3D1&returnCountOnly=true&f=json" 100; done
g "$A/alberta_fire_status_by_category_group/MapServer/2/query?where=1%3D1&outFields=*&outSR=4326&resultRecordCount=2&f=geojson" 2500
g "$A/fire_control_order_data/MapServer/1/query?where=1%3D1&outFields=name,alert_type,jurisdictions,start_date&returnGeometry=false&f=json" 9000
g "$A/fire_control_order_data/MapServer/1/query?where=1%3D1&outFields=name,alert_type&outSR=4326&maxAllowableOffset=0.001&geometryPrecision=5&f=geojson" 600
curl -sS -m 90 "$A/fire_control_order_data/MapServer/1/query?where=1%3D1&outFields=name,alert_type&outSR=4326&maxAllowableOffset=0.001&geometryPrecision=5&f=geojson" | wc -c
g "$A/fire_control_order_data/MapServer?f=json" 200
g "https://geospatial.alberta.ca/mimas/rest/services/wildfire/alberta_fire_status/MapServer?f=json" 200
curl -sS -m 60 "https://geospatial.alberta.ca/mimas/rest/services/wildfire/alberta_fire_status/MapServer?f=json" | grep -o '"name":"[^"]*","type":"[^"]*"' | tr '\n' ' '; echo
curl -sS -m 60 "$A/alberta_fire_status_by_category_group/MapServer?f=json" | grep -o '"id":[0-9]*,"name":"[^"]*"' | tr '\n' ' '; echo
curl -sS -m 60 "$A/fire_control_order_data/MapServer?f=json" | grep -o '"id":[0-9]*,"name":"[^"]*"' | tr '\n' ' '; echo
curl -sS -m 60 "$A/fire_control_order_data/MapServer?f=json" | grep -o '"copyrightText":"[^"]*"' | head -2
curl -sS -m 60 "$A/fire_control_order_data/MapServer/info/iteminfo?f=json" | head -c 2500; echo
g "https://www.emergencyalert.alberta.ca/aeapublic/feed.atom" 2500
g "https://emergencyalert.alberta.ca/aeapublic/feed-all.atom" 1500
g "https://www.emergencyalert.alberta.ca/aeapublic/feed-archive.atom" 3000
exit 0
