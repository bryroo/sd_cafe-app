-- Data: mark the customers the demo seed already created (before is_demo existed). New seeds set it
-- themselves (supabase/functions/demo-reset/seed.ts). No rows are deleted.
--
-- Preview first (approved locally: 6 rows; run on production before db push):
--   select customer_id, full_name, mobile_no from public.customer
--    where is_demo = false and mobile_no in ('+639171234567','+639175550123','+639275550198',
--                                            '+639195550177','+639185550142','+639055550164');
--
-- Rollback: update public.customer set is_demo = false where mobile_no in (<same list>);
update public.customer
   set is_demo = true
 where is_demo = false
   and mobile_no in ('+639171234567', '+639175550123', '+639275550198', '+639195550177', '+639185550142', '+639055550164');
