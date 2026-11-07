-- MEGS' Cafe: what the app needs to run on the database (spec 2026-11-08-supabase-data-layer-design)
--   * Sign-in helpers: mobile/email/username to login address, "already registered", lockout (FR-ACC-06/07, FR-STF-01)
--   * Promo code lookup for the checkout picker (the server re-checks when the order is placed, FR-PRO-08)
--   * create_order(): the one place an order is written, called by the place-order Edge Function only
--   * Demo mode: screen-index states and points for the demo account, switchable off by staff
--   * Seeding: the server may set past times; clients still can't

/* ============================================================
   Demo mode switch (store settings)
   ============================================================ */

alter table public.store_settings add column if not exists demo_mode boolean not null default true;
comment on column public.store_settings.demo_mode is 'Demo tools (screen index states, demo points, reset) work only while this is on. Turn off before a real launch.';
grant update (demo_mode) on public.store_settings to authenticated;

create or replace function public.demo_mode_on()
returns boolean
language sql stable security definer set search_path = ''
as $$ select coalesce((select s.demo_mode from public.store_settings s order by s.settings_id limit 1), false) $$;

/* ============================================================
   Points ledger: adjustments, and past times when seeding
   ============================================================ */

-- "Earn names an order" and "redeem names a voucher" are checked when the entry is written (trigger
-- below); as table constraints they would block unlinking when an order or voucher is later deleted.
alter table public.points_txn drop constraint if exists earn_has_order;
alter table public.points_txn drop constraint if exists redeem_has_voucher;
alter table public.points_txn drop constraint if exists sign_matches_type;
alter table public.points_txn add constraint sign_matches_type check (
  (type = 'redeem' and points < 0)
  or (type in ('earn', 'restore') and points > 0)
  or (type = 'adjust' and points <> 0)
);

create or replace function public.points_txn_check()
returns trigger
language plpgsql set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' then
    -- The ledger is append-only. Two changes leave the amounts untouched and are allowed:
    --  * unlinking: a deleted order or voucher clears its reference (foreign key ON DELETE SET NULL)
    --  * the server back-dating an entry while seeding demo history
    if (to_jsonb(new) - array['order_id', 'customer_reward_id']) = (to_jsonb(old) - array['order_id', 'customer_reward_id'])
       and (new.order_id is null or new.order_id = old.order_id)
       and (new.customer_reward_id is null or new.customer_reward_id = old.customer_reward_id) then
      return new;
    end if;
    if public.current_actor() = 'system'
       and (to_jsonb(new) - 'created_at') = (to_jsonb(old) - 'created_at') then
      return new;
    end if;
    raise exception 'The points ledger is append-only.' using errcode = 'check_violation';
  end if;
  if new.type = 'redeem' and new.customer_reward_id is null then
    raise exception 'A redemption must name the voucher it paid for.' using errcode = 'check_violation';
  end if;
  -- IR-05: points are earned only on a Completed order of the same customer
  if new.type = 'earn' and not exists (
    select 1 from public.orders o
    where o.order_id = new.order_id and o.status = 'Completed' and o.customer_id = new.customer_id
  ) then
    raise exception 'Points are credited only when the order is Completed.' using errcode = 'check_violation';
  end if;
  return new;
end
$$;

/* ============================================================
   Orders: server-set past times; demo rewrites skip the rules
   ============================================================ */

create or replace function public.orders_before_insert()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  p public.promotion;
begin
  -- Orders come only from the server (place-order Edge Function or automation), never a client insert
  if public.current_actor() <> 'system' then
    raise exception 'Orders are placed through the ordering service.' using errcode = 'insufficient_privilege';
  end if;
  new.status := 'Received';
  new.is_delayed := false;
  -- The server may back-date an order when seeding demo history
  new.placed_at := coalesce(new.placed_at, now());

  -- IR-04 / FR-CHK-05: the voucher must be this customer's, unused and not expired
  if new.customer_reward_id is not null and not exists (
    select 1 from public.customer_reward cr
     where cr.customer_reward_id = new.customer_reward_id
       and cr.customer_id = new.customer_id
       and cr.status = 'unused'
       and cr.expires_on > now()
  ) then
    raise exception 'This reward can''t be used with your order.' using errcode = 'check_violation';
  end if;

  -- FR-PRO-08: window, one use per customer, usage limit
  if new.promotion_id is not null then
    select * into p from public.promotion where promotion_id = new.promotion_id for share;
    if not found or not p.is_published or now() < p.starts_at or now() > p.ends_at then
      raise exception 'This code can''t be used with your order.' using errcode = 'check_violation';
    end if;
    if p.is_one_time and exists (
      select 1 from public.promotion_redemption r where r.promotion_id = p.promotion_id and r.customer_id = new.customer_id
    ) then
      raise exception 'You''ve already used this offer.' using errcode = 'check_violation';
    end if;
    if p.usage_limit is not null and (select count(*) from public.promotion_redemption r where r.promotion_id = p.promotion_id) >= p.usage_limit then
      raise exception 'This code can''t be used with your order.' using errcode = 'check_violation';
    end if;
  end if;
  return new;
end
$$;

create or replace function public.orders_before_update()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_actor public.actor_type := public.current_actor();
  v_fixed text[] := array[
    'order_id', 'order_no', 'idempotency_key', 'cafe_id', 'fulfillment', 'address_id', 'note',
    'subtotal', 'tier_name', 'tier_discount', 'promotion_id', 'promotion_label', 'promo_discount',
    'customer_reward_id', 'reward_name', 'reward_discount', 'delivery_fee', 'total', 'points_to_earn',
    'source', 'placed_at'
  ];
  v_mins integer;
  -- The server may set a step's time itself (seeding demo history); everyone else gets now()
  v_server boolean := v_actor = 'system';
begin
  -- demo_set_order_state() rewrites the demo order directly
  if current_setting('megs.demo', true) = 'on' then
    new.updated_at := now();
    return new;
  end if;

  -- SRS 3.8: contents and totals are immutable after placement
  if (select jsonb_object_agg(k, to_jsonb(new) -> k) from unnest(v_fixed) k)
     is distinct from (select jsonb_object_agg(k, to_jsonb(old) -> k) from unnest(v_fixed) k) then
    raise exception 'An order''s contents and totals can''t change after it is placed.' using errcode = 'check_violation';
  end if;
  new.updated_at := now();

  if v_actor = 'customer' then
    -- FR-TRK-04 / IR-02: a customer may only cancel their own order, while Received or Accepted
    if old.customer_id is distinct from (select auth.uid()) then
      raise exception 'Order not found.' using errcode = 'insufficient_privilege';
    end if;
    if new.status is distinct from 'Cancelled'
       or (to_jsonb(new) - array['status', 'cancel_reason', 'cancel_reason_code', 'cancelled_by', 'cancelled_at', 'updated_at'])
          is distinct from (to_jsonb(old) - array['status', 'cancel_reason', 'cancel_reason_code', 'cancelled_by', 'cancelled_at', 'updated_at']) then
      raise exception 'You can only cancel this order.' using errcode = 'insufficient_privilege';
    end if;
    if old.status not in ('Received', 'Accepted') then
      raise exception 'The cafe has started preparing this order, so it can''t be cancelled.' using errcode = 'check_violation';
    end if;
    new.cancelled_by := 'customer';
    new.cancel_reason_code := 'customer_request';
    new.cancel_reason := 'Customer request';
  end if;

  if new.status is distinct from old.status then
    if old.status = 'Accepted' and new.status = 'Received' then
      -- FR-STF-06: Undo for a few seconds after Accept
      if v_actor = 'customer' or old.accepted_at < now() - public.undo_accept_window() then
        raise exception 'Undo is available only for 5 seconds after Accept.' using errcode = 'check_violation';
      end if;
      new.accepted_at := null;
    elsif not (new.status = any (public.order_next_statuses(old.status))) then
      -- FR-STF-06: invalid transitions are rejected by the server
      raise exception 'Order #% can''t go from % to %.', old.order_no, old.status, new.status using errcode = 'check_violation';
    end if;

    -- Table 3-1: the Delayed flag clears when the status advances
    new.is_delayed := false;

    case new.status
      when 'Accepted' then
        new.accepted_at := case when v_server and new.accepted_at is distinct from old.accepted_at then coalesce(new.accepted_at, now()) else now() end;
        -- FR-OPS-03: the ETA counts from acceptance (the server may set it when seeding)
        if not (v_server and new.eta is distinct from old.eta) then
          select case when new.fulfillment = 'delivery' then s.delivery_eta_minutes else s.default_prep_minutes end
            into v_mins from public.store_settings s where s.settings_id = new.cafe_id;
          new.eta := greatest(old.eta, new.accepted_at + make_interval(mins => coalesce(v_mins, 10)));
        end if;
      when 'Preparing' then
        new.preparing_at := case when v_server and new.preparing_at is distinct from old.preparing_at then coalesce(new.preparing_at, now()) else now() end;
      when 'Ready' then
        new.ready_at := case when v_server and new.ready_at is distinct from old.ready_at then coalesce(new.ready_at, now()) else now() end;
      when 'Completed' then
        new.completed_at := case when v_server and new.completed_at is distinct from old.completed_at then coalesce(new.completed_at, now()) else now() end;
      when 'Cancelled' then
        new.cancelled_at := case when v_server and new.cancelled_at is distinct from old.cancelled_at then coalesce(new.cancelled_at, now()) else now() end;
        new.cancelled_by := coalesce(new.cancelled_by, 'cafe');
        -- FR-STF-07: staff must give a reason
        if new.cancelled_by = 'cafe' and v_actor = 'staff' and new.cancel_reason_code is null then
          raise exception 'Choose a reason to cancel.' using errcode = 'check_violation';
        end if;
        if new.cancel_reason_code = 'other' and coalesce(trim(new.cancel_reason), '') = '' then
          raise exception 'Describe the reason for cancelling.' using errcode = 'check_violation';
        end if;
        new.cancel_reason := coalesce(nullif(trim(new.cancel_reason), ''), case new.cancel_reason_code
          when 'out_of_stock' then 'Out of stock'
          when 'too_busy' then 'Too busy'
          when 'customer_request' then 'Customer request'
          when 'payment_issue' then 'Payment issue'
          else 'Cancelled by the cafe' end);
      else null;
    end case;
  elsif new.is_delayed and not old.is_delayed then
    -- FR-STF-08: a delay needs a new estimate in the future
    if v_actor = 'customer' then
      raise exception 'Only the cafe can mark an order delayed.' using errcode = 'insufficient_privilege';
    end if;
    if new.eta <= now() or new.eta is not distinct from old.eta then
      raise exception 'Set a new estimate to mark the order delayed.' using errcode = 'check_violation';
    end if;
  end if;
  return new;
end
$$;

-- The after-update work (events, messages, points, refunds) is skipped for demo rewrites, which
-- rebuild the order's timeline and messages themselves.
drop trigger orders_after_update on public.orders;
create trigger orders_after_update after update on public.orders
  for each row when (current_setting('megs.demo', true) is distinct from 'on')
  execute function public.orders_after_update();

/* ============================================================
   Sign-in helpers (anon may call; they reveal only what the SRS screens already show)
   ============================================================ */

-- '0917 123 4567', '+63 917 123 4567', '639171234567' -> '+639171234567'; anything else unchanged
create or replace function public.to_e164(p text)
returns text
language sql immutable set search_path = ''
as $$
  select case
    when length(regexp_replace(regexp_replace(coalesce(p, ''), '\D', '', 'g'), '^(63|0)', '')) = 10
      then '+63' || regexp_replace(regexp_replace(p, '\D', '', 'g'), '^(63|0)', '')
    else p
  end
$$;

-- 3.2.1.5: sign-up shows a Log in link for a number that already has an account
create or replace function public.is_mobile_registered(p_mobile text)
returns boolean
language sql stable security definer set search_path = ''
as $$ select exists (select 1 from public.customer c where c.mobile_no = public.to_e164(p_mobile)) $$;

-- FR-ACC-06: a mobile number or email -> the address Supabase Auth signs in with
create or replace function public.customer_login_address(p_identifier text)
returns text
language sql stable security definer set search_path = ''
as $$
  select u.email
    from public.customer c
    join auth.users u on u.id = c.customer_id
   where (position('@' in p_identifier) > 0 and c.email = lower(trim(p_identifier))::extensions.citext)
      or (position('@' in p_identifier) = 0 and c.mobile_no = public.to_e164(p_identifier))
   limit 1
$$;

-- FR-STF-01: a username or email -> an active staff member's sign-in email
create or replace function public.staff_login_address(p_identifier text)
returns text
language sql stable security definer set search_path = ''
as $$
  select s.email::text
    from public.staff_user s
   where s.is_active and (s.username = lower(trim(p_identifier))::extensions.citext or s.email = lower(trim(p_identifier))::extensions.citext)
   limit 1
$$;

-- FR-ACC-07 / FR-STF-01: lock sign-in after N failures for M minutes (store_settings)
create or replace function public.login_locked_until(p_identifier text, p_audience public.login_audience)
returns timestamptz
language sql stable security definer set search_path = ''
as $$
  select a.locked_until from public.login_attempt a
   where a.audience = p_audience and a.identifier = lower(trim(p_identifier)) and a.locked_until > now()
$$;

create or replace function public.login_failed(p_identifier text, p_audience public.login_audience)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_id text := lower(trim(p_identifier));
  v_max integer;
  v_mins integer;
  v_row public.login_attempt;
begin
  select coalesce(s.lockout_attempts, 5), coalesce(s.lockout_minutes, 15) into v_max, v_mins
    from public.store_settings s order by s.settings_id limit 1;
  insert into public.login_attempt as a (identifier, audience, fail_count, updated_at)
  values (v_id, p_audience, 1, now())
  on conflict (audience, identifier) do update set
    -- A lock that has run out starts the count again
    fail_count = case when a.locked_until is not null and a.locked_until <= now() then 1 else a.fail_count + 1 end,
    locked_until = case when a.locked_until is not null and a.locked_until <= now() then null else a.locked_until end,
    updated_at = now()
  returning * into v_row;
  if v_row.fail_count >= v_max then
    update public.login_attempt set fail_count = 0, locked_until = now() + make_interval(mins => v_mins)
     where audience = p_audience and identifier = v_id
     returning * into v_row;
  end if;
  return jsonb_build_object(
    'left', greatest(0, v_max - v_row.fail_count),
    'locked_until', v_row.locked_until
  );
end
$$;

create or replace function public.login_succeeded(p_identifier text, p_audience public.login_audience)
returns void
language sql security definer set search_path = ''
as $$ delete from public.login_attempt where audience = p_audience and identifier = lower(trim(p_identifier)) $$;

/* ============================================================
   Promo code lookup for the checkout picker (the server re-checks, FR-PRO-08)
   ============================================================ */

create or replace function public.check_promo_code(p_code text)
returns jsonb
language sql stable security definer set search_path = ''
as $$
  select jsonb_build_object(
    'id', p.promotion_id, 'code', p.code::text, 'title', p.title, 'rule', p.rule,
    'starts_at', p.starts_at, 'ends_at', p.ends_at, 'is_one_time', p.is_one_time,
    'used', exists (select 1 from public.promotion_redemption r where r.promotion_id = p.promotion_id and r.customer_id = (select auth.uid()))
  )
  from public.promotion p
  where p.code = upper(trim(p_code))::extensions.citext and p.is_published
$$;

/* ============================================================
   create_order(): the one writer of orders (service role only)
   ============================================================ */

create or replace function public.create_order(p jsonb)
returns public.orders
language plpgsql security definer set search_path = ''
as $$
declare
  o public.orders;
  l jsonb;
  opt jsonb;
  v_line uuid;
  v_i integer := 0;
  v_j integer;
begin
  -- IR-08: the same submission returns the order it already made
  select * into o from public.orders where idempotency_key = (p ->> 'idempotency_key')::uuid;
  if found then
    return o;
  end if;

  insert into public.orders (
    order_no, idempotency_key, cafe_id, customer_id, customer_name, customer_mobile, fulfillment, address_id,
    delivery_address, note, subtotal, tier_name, tier_discount, promotion_id, promotion_label,
    promo_discount, customer_reward_id, reward_name, reward_discount, delivery_fee, total,
    points_to_earn, eta, source, placed_at
  ) values (
    -- A fixed number only when seeding the demo's known orders (#1027 to #1042)
    coalesce((p ->> 'order_no')::bigint, nextval('public.order_no_seq')),
    (p ->> 'idempotency_key')::uuid,
    (p ->> 'cafe_id')::smallint,
    (p ->> 'customer_id')::uuid,
    p ->> 'customer_name',
    p ->> 'customer_mobile',
    (p ->> 'fulfillment')::public.fulfillment_type,
    (p ->> 'address_id')::uuid,
    p -> 'delivery_address',
    nullif(p ->> 'note', ''),
    (p ->> 'subtotal')::integer,
    p ->> 'tier_name',
    coalesce((p ->> 'tier_discount')::integer, 0),
    p ->> 'promotion_id',
    p ->> 'promotion_label',
    coalesce((p ->> 'promo_discount')::integer, 0),
    (p ->> 'customer_reward_id')::uuid,
    p ->> 'reward_name',
    coalesce((p ->> 'reward_discount')::integer, 0),
    coalesce((p ->> 'delivery_fee')::integer, 0),
    (p ->> 'total')::integer,
    coalesce((p ->> 'points_to_earn')::integer, 0),
    (p ->> 'eta')::timestamptz,
    coalesce((p ->> 'source')::public.order_source, 'app'),
    (p ->> 'placed_at')::timestamptz
  ) returning * into o;

  for l in select * from jsonb_array_elements(coalesce(p -> 'lines', '[]'::jsonb)) loop
    v_i := v_i + 1;
    insert into public.order_line (order_id, item_id, item_name, unit_price, quantity, note, sort_order)
    values (o.order_id, l ->> 'item_id', l ->> 'item_name', (l ->> 'unit_price')::integer,
            (l ->> 'quantity')::integer, nullif(l ->> 'note', ''), v_i)
    returning line_id into v_line;
    v_j := 0;
    for opt in select * from jsonb_array_elements(coalesce(l -> 'options', '[]'::jsonb)) loop
      v_j := v_j + 1;
      insert into public.order_line_option (line_id, value_id, group_title, label, price, sort_order)
      values (v_line, (opt ->> 'value_id')::bigint, opt ->> 'group_title', opt ->> 'label',
              coalesce((opt ->> 'price')::integer, 0), v_j);
    end loop;
  end loop;

  if p ? 'payment' then
    insert into public.payment (order_id, method, payment_method_id, method_label, amount, status, provider_ref, authorized_at, captured_at)
    values (
      o.order_id,
      (p -> 'payment' ->> 'method')::public.payment_method_type,
      (p -> 'payment' ->> 'payment_method_id')::uuid,
      p -> 'payment' ->> 'method_label',
      (p -> 'payment' ->> 'amount')::integer,
      (p -> 'payment' ->> 'status')::public.payment_status,
      p -> 'payment' ->> 'provider_ref',
      case when p -> 'payment' ->> 'status' in ('authorized', 'captured') then o.placed_at end,
      case when p -> 'payment' ->> 'status' = 'captured' then o.placed_at end
    );
  end if;
  return o;
end
$$;
-- After seeding fixed order numbers, new orders continue after the highest one (SRS 3.8: sequential)
create or replace function public.sync_order_no_seq()
returns bigint
language sql security definer set search_path = ''
as $$ select setval('public.order_no_seq', greatest(coalesce((select max(order_no) from public.orders), 1000), 1000)) $$;

comment on function public.create_order(jsonb) is 'Writes an order, its lines, options and payment in one transaction. Service role only (place-order and staff-automations Edge Functions).';

/* ============================================================
   Staff: every payment with its reference, for the queue's "Staff only" panels (IR-03)
   ============================================================ */

create or replace function public.staff_payments()
returns setof public.payment
language plpgsql stable security definer set search_path = ''
as $$
begin
  if not public.is_staff() then
    raise exception 'Staff only.' using errcode = 'insufficient_privilege';
  end if;
  return query select * from public.payment order by created_at;
end
$$;
revoke execute on function public.staff_payments() from public, anon;
grant execute on function public.staff_payments() to authenticated;

/* ============================================================
   Demo tools (only while demo mode is on)
   ============================================================ */

-- Screen index: put an order into a state (and pickup or delivery), with a matching timeline and message
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
  if not found then
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
  select points_balance into v_now from public.customer where customer_id = v_uid;
  if not found then
    raise exception 'Sign in first.' using errcode = 'insufficient_privilege';
  end if;
  if p_points <> v_now then
    insert into public.points_txn (customer_id, type, points, description)
    values (v_uid, 'adjust', p_points - v_now, 'Demo adjustment');
  end if;
end
$$;

/* ============================================================
   Realtime: points, vouchers and staff screens follow live too
   ============================================================ */

alter publication supabase_realtime add table
  public.customer, public.points_txn, public.customer_reward, public.promotion_redemption,
  public.internal_note, public.response_template, public.payment;

/* ============================================================
   Who may call what
   ============================================================ */

revoke execute on function public.demo_mode_on(), public.to_e164(text), public.is_mobile_registered(text),
  public.customer_login_address(text), public.staff_login_address(text),
  public.login_locked_until(text, public.login_audience), public.login_failed(text, public.login_audience),
  public.login_succeeded(text, public.login_audience), public.check_promo_code(text), public.create_order(jsonb),
  public.demo_set_order_state(bigint, public.order_status, public.fulfillment_type), public.demo_set_points(integer)
  from public, anon, authenticated;

-- Before sign-in
grant execute on function public.is_mobile_registered(text), public.customer_login_address(text),
  public.staff_login_address(text), public.login_locked_until(text, public.login_audience),
  public.login_failed(text, public.login_audience), public.login_succeeded(text, public.login_audience),
  public.demo_mode_on()
  to anon, authenticated;
-- Signed in
grant execute on function public.check_promo_code(text),
  public.demo_set_order_state(bigint, public.order_status, public.fulfillment_type), public.demo_set_points(integer)
  to authenticated;
-- create_order() and sync_order_no_seq(): service role only (Edge Functions)
revoke execute on function public.sync_order_no_seq() from public, anon, authenticated;
grant execute on function public.create_order(jsonb), public.sync_order_no_seq() to service_role;
