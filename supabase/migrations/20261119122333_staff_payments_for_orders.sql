-- Staff console: payments (with the staff-only provider reference, IR-03) for the orders on screen only,
-- instead of every payment ever taken on each reload (DB_AUDIT.md finding 8). Additive: staff_payments()
-- and staff_order_payments() are unchanged.
--
-- Rollback: drop function public.staff_payments_for(uuid[]); (the app falls back to staff_payments()).
create or replace function public.staff_payments_for(p_order_ids uuid[])
returns setof public.payment
language plpgsql stable security definer set search_path = ''
as $$
begin
  if not public.is_staff() then
    raise exception 'Staff only.' using errcode = 'insufficient_privilege';
  end if;
  return query select * from public.payment where order_id = any (p_order_ids) order by created_at;
end
$$;
comment on function public.staff_payments_for(uuid[]) is 'IR-03: payments with provider references for the given orders. Staff only.';

revoke execute on function public.staff_payments_for(uuid[]) from public, anon;
grant execute on function public.staff_payments_for(uuid[]) to authenticated;
