-- Marks the seeded demo customers (Maria and the others the demo-reset function creates), so demo tools
-- that change a balance can be limited to them (DB_AUDIT.md finding 2). Set only by the server: it is not
-- in the customer UPDATE column grant, so a customer can't flag their own account.
--
-- Rollback: alter table public.customer drop column is_demo;
alter table public.customer add column if not exists is_demo boolean not null default false;
comment on column public.customer.is_demo is 'Seeded demo account (demo-reset). Demo tools such as demo_set_points() work only for these.';
