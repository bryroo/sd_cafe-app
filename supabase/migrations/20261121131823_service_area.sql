-- Delivery service areas: the polygons a delivery pin must fall inside. Bocaue only for now; another
-- area is a new row (and is_active switches one off) without a code change.
-- Clients never read this table directly: is_within_service_area() and service_area_geojson() (next
-- migrations) are the only ways in, so no grants here. RLS is on with no policies, like login_attempt.
--
-- Rollback:
--   drop table if exists public.service_area;

create table public.service_area (
  service_area_id  smallint    generated always as identity primary key,
  cafe_id          smallint    not null references public.store_settings (settings_id),
  name             text        not null check (length(trim(name)) between 1 and 100),
  -- WGS 84 longitude/latitude; ST_Covers on geography is exact on the boundary line
  boundary         extensions.geography(MultiPolygon, 4326) not null,
  is_active        boolean     not null default true,
  -- Where the polygon came from and its licence (OSM is ODbL: attribution required)
  source           text        not null,
  source_license   text        not null,
  fetched_at       timestamptz not null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create index service_area_boundary on public.service_area using gist (boundary);
create index service_area_cafe on public.service_area (cafe_id);
create unique index service_area_source on public.service_area (source);
comment on table public.service_area is 'Delivery service areas (PostGIS). A delivery pin must be covered by an active area.';

alter table public.service_area enable row level security;
create trigger service_area_updated_at before update on public.service_area for each row execute function public.set_updated_at();
