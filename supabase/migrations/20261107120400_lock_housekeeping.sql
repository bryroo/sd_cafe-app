-- housekeeping() runs from pg_cron only. It was created after the bulk revoke in
-- 20261107120100_rules_and_security.sql, and Postgres grants EXECUTE to PUBLIC on every new function
-- (a schema-level ALTER DEFAULT PRIVILEGES cannot remove that global default), so guests could call it
-- through /rest/v1/rpc/housekeeping. Close it, and close the global default for later migrations.
revoke execute on function public.housekeeping() from public, anon, authenticated;

alter default privileges revoke execute on functions from public;
