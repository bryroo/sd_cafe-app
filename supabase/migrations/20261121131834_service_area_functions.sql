-- The delivery rule: a pin is deliverable when an active service area covers it. This is the only
-- authority (place-order, the address trigger and the orders guard all call it). Google's reverse-geocoded
-- town name is a hint in the app, never the rule.
--
-- Rollback:
--   drop function if exists public.service_area_geojson();
--   drop function if exists public.is_within_service_area(double precision, double precision);

create or replace function public.is_within_service_area(p_lat double precision, p_lng double precision)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select case
    -- NaN compares greater than every number, so it fails these ranges too
    when p_lat is null or p_lng is null or not (p_lat between -90 and 90) or not (p_lng between -180 and 180) then false
    else exists (
      select 1
      from public.service_area a
      where a.is_active
        and extensions.st_covers(
          a.boundary,
          extensions.st_setsrid(extensions.st_makepoint(p_lng, p_lat), 4326)::extensions.geography
        )
    )
  end
$$;
comment on function public.is_within_service_area(double precision, double precision) is
  'True when an active delivery service area covers the point (WGS 84). The authoritative delivery-area check.';

-- Active areas as GeoJSON, for the map overlay and the app's instant "Delivers here" hint
create or replace function public.service_area_geojson()
returns jsonb
language sql stable security definer set search_path = ''
as $$
  select jsonb_build_object(
    'type', 'FeatureCollection',
    'features', coalesce(jsonb_agg(jsonb_build_object(
      'type', 'Feature',
      'id', a.service_area_id,
      'properties', jsonb_build_object('name', a.name, 'attribution', a.source_license),
      'geometry', extensions.st_asgeojson(a.boundary::extensions.geometry, 7)::jsonb
    ) order by a.service_area_id), '[]'::jsonb)
  )
  from public.service_area a
  where a.is_active
$$;
comment on function public.service_area_geojson() is 'Active delivery service areas as a GeoJSON FeatureCollection (display and UX only).';

-- Signed-in people only: guests never reach delivery (the server enforces the same in place-order)
revoke execute on function public.is_within_service_area(double precision, double precision), public.service_area_geojson()
  from public, anon;
grant execute on function public.is_within_service_area(double precision, double precision), public.service_area_geojson()
  to authenticated, service_role;
