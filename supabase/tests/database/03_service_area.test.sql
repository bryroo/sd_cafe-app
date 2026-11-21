-- Delivery service area (Bocaue, Bulacan): is_within_service_area() against real coordinates.
-- Border points were derived from the OSM polygons themselves: for each town that shares a border with
-- Bocaue (Balagtas, Bulakan, Marilao, Meycauayan, Pandi, Santa Maria; Guiguinto and Obando don't touch
-- it), the middle of the shared border, then the nearest point 50 m inside Bocaue and 50 m inside the
-- neighbour. Barangay points are OSM's place nodes. Re-derive them if the boundary data is replaced.
-- Self-contained; rolls back.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select no_plan();

create or replace function pg_temp.inside(lat double precision, lng double precision) returns boolean
language sql as $$ select public.is_within_service_area(lat, lng) $$;

/* ---------- The data ---------- */

select is((select count(*)::int from public.service_area where is_active), 1, 'one active service area');
select ok((select bool_and(extensions.st_isvalid(boundary::extensions.geometry)) from public.service_area), 'the boundary is a valid polygon');

/* ---------- Inside Bocaue ---------- */

select ok(pg_temp.inside(14.7980, 120.9260), 'centre of Bocaue');
select ok(pg_temp.inside(14.7949017, 120.9254911), 'Poblacion');
select ok(pg_temp.inside(14.7811638, 120.9353354), 'Lolomboy');
select ok(pg_temp.inside(14.8081205, 120.9424684), 'Turo');
select ok(pg_temp.inside(14.7968478, 120.9411046), 'Igulot');
select ok(pg_temp.inside(14.7883152, 120.9423079), 'Bundukan');
select ok(pg_temp.inside(14.8058780, 120.9190062), 'Wakas');
select ok(pg_temp.inside(14.8129527, 120.9330809), 'Taal');
select ok(pg_temp.inside(14.8301170, 120.9442824), 'Batia');
select ok(pg_temp.inside(14.8148552, 120.9393774), 'Tambobong');
select ok(pg_temp.inside(14.7882627, 120.9281679), 'Bambang');

/* ---------- 50 m either side of each shared border ---------- */

select ok(pg_temp.inside(14.801435, 120.913489), 'Balagtas border: 50 m inside Bocaue');
select ok(not pg_temp.inside(14.801853, 120.912666), 'Balagtas border: 50 m inside Balagtas');
select ok(pg_temp.inside(14.774732, 120.910191), 'Bulakan border: 50 m inside Bocaue');
select ok(not pg_temp.inside(14.773979, 120.909678), 'Bulakan border: 50 m inside Bulakan');
select ok(pg_temp.inside(14.774230, 120.939901), 'Marilao border: 50 m inside Bocaue');
select ok(not pg_temp.inside(14.773513, 120.940659), 'Marilao border: 50 m inside Marilao');
select ok(pg_temp.inside(14.765415, 120.918650), 'Meycauayan border: 50 m inside Bocaue');
select ok(not pg_temp.inside(14.764623, 120.918204), 'Meycauayan border: 50 m inside Meycauayan');
select ok(pg_temp.inside(14.837179, 120.940415), 'Pandi border: 50 m inside Bocaue');
select ok(not pg_temp.inside(14.837848, 120.939790), 'Pandi border: 50 m inside Pandi');
select ok(pg_temp.inside(14.814460, 120.942228), 'Santa Maria border: 50 m inside Bocaue');
select ok(not pg_temp.inside(14.814023, 120.943065), 'Santa Maria border: 50 m inside Santa Maria');

/* ---------- Inside a neighbouring town ---------- */

select ok(not pg_temp.inside(14.826146, 120.911374), 'middle of Balagtas');
select ok(not pg_temp.inside(14.709588, 120.850202), 'middle of Bulakan');
select ok(not pg_temp.inside(14.770195, 120.957623), 'middle of Marilao');
select ok(not pg_temp.inside(14.752215, 120.974576), 'middle of Meycauayan');
select ok(not pg_temp.inside(14.877111, 120.938347), 'middle of Pandi');
select ok(not pg_temp.inside(14.839413, 120.990101), 'middle of Santa Maria');
select ok(not pg_temp.inside(14.8434, 120.8114), 'Malolos (Bulacan, not a neighbour)');

/* ---------- Far away and bad input ---------- */

select ok(not pg_temp.inside(14.5896, 120.9817), 'Manila City Hall');
select ok(not pg_temp.inside(10.3157, 123.8854), 'Cebu City');
select ok(not pg_temp.inside(16.4023, 120.5960), 'Baguio');
select ok(not pg_temp.inside(-14.798, -120.926), 'mirrored coordinates (sign flipped)');
select ok(not pg_temp.inside(120.926, 14.798), 'swapped lat and lng');
select ok(not pg_temp.inside(null, 120.926), 'null latitude');
select ok(not pg_temp.inside(14.798, null), 'null longitude');
select ok(not pg_temp.inside('NaN', 120.926), 'NaN latitude');
select ok(not pg_temp.inside(91, 120.926), 'latitude out of range');
select ok(not pg_temp.inside(14.798, 181), 'longitude out of range');

/* ---------- An inactive area is not served ---------- */

update public.service_area set is_active = false;
select ok(not pg_temp.inside(14.7980, 120.9260), 'with every area switched off, nowhere is deliverable');
select is(jsonb_array_length(public.service_area_geojson() -> 'features'), 0, 'and the overlay is empty');
update public.service_area set is_active = true;
select is(jsonb_array_length(public.service_area_geojson() -> 'features'), 1, 'the overlay has the active area');

/* ---------- Who may call ---------- */

select ok(not has_function_privilege('anon', 'public.is_within_service_area(double precision, double precision)', 'execute'), 'anon cannot check the area');
select ok(not has_function_privilege('anon', 'public.service_area_geojson()', 'execute'), 'anon cannot read the overlay');
select ok(has_function_privilege('authenticated', 'public.is_within_service_area(double precision, double precision)', 'execute'), 'signed-in users can check the area');
select ok(has_function_privilege('authenticated', 'public.service_area_geojson()', 'execute'), 'signed-in users can read the overlay');
select ok(not has_table_privilege('authenticated', 'public.service_area', 'select'), 'nobody reads the table directly');
select ok(not has_table_privilege('authenticated', 'public.service_area', 'update'), 'nobody changes the areas from the app');

select * from finish();
rollback;
