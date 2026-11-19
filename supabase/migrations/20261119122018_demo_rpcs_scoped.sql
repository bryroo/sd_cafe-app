-- Demo tools: limit who they act on (DB_AUDIT.md findings 1 and 2). Signatures and grants unchanged.
--   * demo_set_order_state(): only the caller's own order, or any order for staff. Before this, any
--     signed-in customer could rewrite anyone's order while demo mode was on.
--   * demo_set_points(): only seeded demo accounts (customer.is_demo). Before this, any customer could
--     give themselves unlimited points.
-- Both still require demo mode (store_settings.demo_mode).
--
-- Rollback: re-run the two function definitions from 20261108100100_app_data_layer.sql.

create or replace function public.demo_set_order_state(p_order_no bigint, p_status public.order_status, p_fulfillment public.fulfillment_type default null)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  o public.orders;
  v_ful public.fulfillment_type;
  v_fee integer;
  v_addr jsonb;
  v_steps public.order_status[] := array['Received', 'Accepted', 'Preparing', 'Ready', 'Completed']::public.order_status[];
  v_reach integer;
  v_t0 timestamptz := now() - interval '6 minutes';
  s public.order_status;
  i integer := 0;
begin
  if not public.demo_mode_on() then
    raise exception 'Demo tools are off.' using errcode = 'insufficient_privilege';
  end if;
  select * into o from public.orders where order_no = p_order_no;
  -- The caller's own order; staff and the server may set any (same message, so other orders stay hidden)
  if not found or not (
    o.customer_id = (select auth.uid()) or public.is_staff() or public.current_actor() = 'system'
  ) then
    raise exception 'Order #% not found.', p_order_no using errcode = 'no_data_found';
  end if;

  v_ful := coalesce(p_fulfillment, o.fulfillment);
  v_fee := case when v_ful = 'delivery' then (select delivery_fee from public.store_settings where settings_id = o.cafe_id) else 0 end;
  v_addr := case when v_ful = 'delivery' then coalesce(
    o.delivery_address,
    (select jsonb_build_object('label', a.label, 'recipient_name', a.recipient_name, 'street', a.street, 'barangay', a.barangay,
                               'city', a.city, 'mobile_no', a.mobile_no, 'notes', a.notes)
       from public.address a where a.customer_id = o.customer_id order by a.is_default desc, a.created_at limit 1),
    jsonb_build_object('label', 'Home', 'recipient_name', o.customer_name, 'street', '12 Mabini St', 'barangay', 'San Roque', 'city', 'Quezon City')
  ) end;
  v_reach := coalesce(array_position(v_steps, p_status), 3);

  perform set_config('megs.demo', 'on', true);
  update public.orders set
    status = p_status,
    fulfillment = v_ful,
    delivery_fee = v_fee,
    delivery_address = v_addr,
    total = greatest(0, subtotal - tier_discount - promo_discount - reward_discount) + v_fee,
    is_delayed = false,
    placed_at = v_t0,
    accepted_at = case when v_reach >= 2 then v_t0 + interval '1 minute' end,
    preparing_at = case when v_reach >= 3 then v_t0 + interval '3 minutes' end,
    ready_at = case when v_reach >= 4 then v_t0 + interval '5 minutes' end,
    completed_at = case when v_reach >= 5 then v_t0 + interval '6 minutes' end,
    eta = now() + make_interval(mins => case when v_ful = 'delivery' then 30 else 4 end),
    cancelled_by = case when p_status = 'Cancelled' then 'cafe'::public.cancelled_by end,
    cancel_reason_code = case when p_status = 'Cancelled' then 'out_of_stock'::public.cancel_reason_code end,
    cancel_reason = case when p_status = 'Cancelled' then 'Out of stock' end,
    cancelled_at = case when p_status = 'Cancelled' then now() end
  where order_id = o.order_id
  returning * into o;

  -- Timeline: the steps reached, then the cancellation if any
  delete from public.order_status_event where order_id = o.order_id;
  foreach s in array v_steps loop
    i := i + 1;
    exit when i > v_reach or (p_status = 'Cancelled' and i > 2);
    insert into public.order_status_event (order_id, from_status, to_status, label, actor_type, actor_name, created_at)
    values (o.order_id, case when i > 1 then v_steps[i - 1] end, s,
            case when i = 1 then 'Order placed'
                 when s = 'Ready' and v_ful = 'delivery' then 'Out for delivery'
                 when s = 'Completed' and v_ful = 'delivery' then 'Delivered'
                 else s::text end,
            case when i = 1 then 'customer'::public.actor_type else 'staff'::public.actor_type end,
            case when i = 1 then o.customer_name else 'Staff' end,
            case i when 1 then o.placed_at when 2 then o.placed_at + interval '1 minute' when 3 then o.placed_at + interval '3 minutes'
                   when 4 then o.placed_at + interval '5 minutes' else o.placed_at + interval '6 minutes' end);
  end loop;
  if p_status = 'Cancelled' then
    insert into public.order_status_event (order_id, from_status, to_status, label, actor_type, actor_name)
    values (o.order_id, 'Accepted', 'Cancelled', 'Cancelled by cafe', 'staff', 'Staff');
  end if;

  -- Messages: only the one that is true now (a "Ready" message must never open an order still being made)
  delete from public.notification where order_id = o.order_id;
  if p_status <> 'Received' then
    perform public.notify_order(o, public.template_event_for(o));
  end if;
  perform set_config('megs.demo', 'off', true);
end
$$;

-- Screen index: set the signed-in demo customer's balance (an adjustment entry keeps balance = ledger sum)
create or replace function public.demo_set_points(p_points integer)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_now integer;
begin
  if not public.demo_mode_on() then
    raise exception 'Demo tools are off.' using errcode = 'insufficient_privilege';
  end if;
  select points_balance into v_now from public.customer where customer_id = v_uid and is_demo;
  if not found then
    raise exception 'Demo points are for the demo accounts only.' using errcode = 'insufficient_privilege';
  end if;
  if p_points <> v_now then
    insert into public.points_txn (customer_id, type, points, description)
    values (v_uid, 'adjust', p_points - v_now, 'Demo adjustment');
  end if;
end
$$;
