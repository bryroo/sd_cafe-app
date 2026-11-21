// Builds the SQL that loads a delivery service area (a municipality boundary) from OpenStreetMap.
// Used once per area; the output becomes a data migration. Nothing here runs in the app.
//
//   node scripts/service-area.mjs R17638809 "Bocaue, Bulacan" > supabase/migrations/<ts>_service_area_bocaue_data.sql
//
// Source: OpenStreetMap administrative boundary, fetched through Nominatim's lookup API (one request).
// Licence: ODbL 1.0. The stored polygon is a derived database: credit "© OpenStreetMap contributors"
// wherever the boundary is shown (the map sheet does), and keep the boundary itself under ODbL if it is
// ever shared outside the app. Nominatim's usage policy: at most one request per second, a real
// User-Agent, no bulk downloads.
//
// The full OSM geometry is kept (no simplification), so the server check matches the boundary as mapped.
// Verify it against a local map before launch, especially where the border runs along rivers and roads.

const [osmId, name] = process.argv.slice(2)
if (!/^[NWR]\d+$/.test(osmId ?? '') || !name) {
  console.error('Usage: node scripts/service-area.mjs R<relation id> "<name>"')
  process.exit(1)
}

const url = `https://nominatim.openstreetmap.org/lookup?osm_ids=${osmId}&format=jsonv2&polygon_geojson=1`
const res = await fetch(url, { headers: { 'User-Agent': 'megs-service-area-build/1.0' } })
if (!res.ok) {
  console.error(`Nominatim answered ${res.status}`)
  process.exit(1)
}
const [place] = await res.json()
if (!place?.geojson || !['Polygon', 'MultiPolygon'].includes(place.geojson.type)) {
  console.error('No polygon for that id.')
  process.exit(1)
}

const geojson = JSON.stringify(place.geojson)
const fetched = new Date().toISOString()
const q = (s) => `'${String(s).replace(/'/g, "''")}'`

console.log(`-- Delivery service area: ${name}
-- Source: OpenStreetMap relation ${osmId.slice(1)} (${place.display_name}), fetched ${fetched.slice(0, 10)}
-- through Nominatim by scripts/service-area.mjs. Licence: ODbL 1.0, © OpenStreetMap contributors.
-- Data only: one row. Rollback: delete from public.service_area where source = ${q(`osm:relation/${osmId.slice(1)}`)};

insert into public.service_area (cafe_id, name, boundary, source, source_license, fetched_at)
select 1, ${q(name)},
  extensions.st_multi(extensions.st_setsrid(extensions.st_geomfromgeojson(${q(geojson)}), 4326))::extensions.geography,
  ${q(`osm:relation/${osmId.slice(1)}`)}, 'ODbL-1.0 (© OpenStreetMap contributors)', ${q(fetched)}
where not exists (select 1 from public.service_area where source = ${q(`osm:relation/${osmId.slice(1)}`)});`)
