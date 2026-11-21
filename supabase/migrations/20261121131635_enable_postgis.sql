-- Delivery service area (Bocaue only): PostGIS decides whether a pinned delivery location is inside an
-- active service area. Installed in the extensions schema, like citext, so its many functions and the
-- spatial_ref_sys table stay out of the public API schema.
--
-- Rollback (only once nothing uses geography any more, i.e. after rolling back the service-area
-- migrations that follow):
--   drop extension if exists postgis;

create extension if not exists postgis with schema extensions;
