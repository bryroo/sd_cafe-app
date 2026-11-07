-- MEGS' Cafe: business rules enforced by the database, and access control
--
-- Rules (each change is one transaction, NFR-REL-02):
--   * Order status moves only along SRS Table 3-1; customers may only cancel while Received or Accepted
--     (FR-STF-06, FR-TRK-04, IR-02); Accept can be undone for a few seconds (FR-STF-06).
--   * Order contents and totals never change after placement (SRS 3.8).
--   * Completing an order credits its points once and only then (FR-LOY-01, IR-05), captures a counter
--     payment and re-evaluates the tier (FR-TIR-01).
--   * Cancelling refunds an in-app payment, restores the voucher and gives the promo code use back
--     (FR-TRK-05, TBD-08, TBD-12).
--   * A voucher pays for one order; a promotion is checked for its window, one-time use and usage limit
--     (IR-04, FR-PRO-08).
--   * Points balance always equals the ledger sum (SRS 3.8); redeeming is atomic (FR-LOY-05).
--   * Every status change is recorded (ORDER_STATUS_EVENT) and customer messages are sent from the
--     templates (FR-TRK-03); staff actions and settings or template edits are audited (NFR-SEC-06).
--
-- Access (NFR-SEC-04, IR-03, SRS 3.8 "Access"):
--   * Row Level Security on every table. Customers read only their own rows; staff read operational data.
--   * Column grants limit what each role may change. Internal notes, payment references, system
--     error codes and promo codes are never readable by customers.
--   * Orders are created only by the server (the place-order Edge Function, service role).

/* ============================================================
   Helpers
   ============================================================ */

create or replace function public.is_staff()
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.staff_user s where s.staff_id = (select auth.uid()) and s.is_active
  )
$$;
comment on function public.is_staff() is 'True when the signed-in user is an active staff member (NFR-SEC-04)';

-- Who is acting: staff (console), customer (app) or system (service role, cron, server functions)
create or replace function public.current_actor()
returns public.actor_type
language sql stable security definer set search_path = ''
as $$
  select case
    when (select auth.uid()) is null then 'system'::public.actor_type
    when public.is_staff() then 'staff'::public.actor_type
    else 'customer'::public.actor_type
  end
$$;

create or replace function public.actor_name()
returns text
language sql stable security definer set search_path = ''
as $$
  select coalesce(
    (select s.full_name from public.staff_user s where s.staff_id = (select auth.uid())),
    (select c.full_name from public.customer c where c.customer_id = (select auth.uid())),
    'System'
  )
$$;

create or replace function public.set_updated_at()
returns trigger
language plpgsql set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end
$$;

create trigger customer_updated_at before update on public.customer for each row execute function public.set_updated_at();
create trigger address_updated_at before update on public.address for each row execute function public.set_updated_at();
create trigger staff_user_updated_at before update on public.staff_user for each row execute function public.set_updated_at();
create trigger menu_item_updated_at before update on public.menu_item for each row execute function public.set_updated_at();
create trigger payment_updated_at before update on public.payment for each row execute function public.set_updated_at();
create trigger automated_order_updated_at before update on public.automated_order for each row execute function public.set_updated_at();

/* ============================================================
   Customer accounts (FR-ACC-02)
   ============================================================ */

-- Sign-up passes account_type, full_name, mobile_no, contact_email and terms_accepted in the user
-- metadata. Staff accounts are never created from metadata: an admin inserts them into staff_user.
create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  meta jsonb := coalesce(new.raw_user_meta_data, '{}'::jsonb);
begin
  if meta ->> 'account_type' is distinct from 'customer' then
    return new;
  end if;
  if coalesce((meta ->> 'terms_accepted')::boolean, false) is not true then
    raise exception 'Accept the terms of use and privacy notice to create an account.'
      using errcode = 'check_violation';
  end if;
  insert into public.customer (customer_id, full_name, mobile_no, email, tier_id, terms_accepted_at)
  values (
    new.id,
    trim(meta ->> 'full_name'),
    meta ->> 'mobile_no',
    nullif(trim(meta ->> 'contact_email'), ''),
    (select t.tier_id from public.tier t where t.is_default),
    now()
  );
  return new;
end
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_auth_user();

-- The balance changes only through the points ledger (SRS 3.8)
create or replace function public.customer_guard()
returns trigger
language plpgsql set search_path = ''
as $$
begin
  if new.points_balance is distinct from old.points_balance
     and current_setting('megs.ledger', true) is distinct from 'on' then
    raise exception 'The points balance changes only through the points ledger.' using errcode = 'check_violation';
  end if;
  if new.mobile_no is distinct from old.mobile_no and public.current_actor() = 'customer' then
    raise exception 'The mobile number is verified and can''t be changed here.' using errcode = 'check_violation';
  end if;
  -- DPA consent time follows the promotions toggle (OR-03)
  if new.notify_promotions and not old.notify_promotions then
    new.promo_consent_at := now();
  elsif not new.notify_promotions then
    new.promo_consent_at := null;
  end if;
  return new;
end
$$;

create trigger customer_guard before update on public.customer for each row execute function public.customer_guard();

/* ============================================================
   Points ledger (POINTS_TXN)
   ============================================================ */

create or replace function public.points_txn_check()
returns trigger
language plpgsql set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' then
    raise exception 'The points ledger is append-only.' using errcode = 'check_violation';
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

create or replace function public.points_txn_apply()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  perform set_config('megs.ledger', 'on', true);
  -- points_balance >= 0 makes an overspend fail the whole transaction
  update public.customer set points_balance = points_balance + new.points where customer_id = new.customer_id;
  perform set_config('megs.ledger', 'off', true);
  return new;
end
$$;

create trigger points_txn_check before insert or update on public.points_txn for each row execute function public.points_txn_check();
create trigger points_txn_apply after insert on public.points_txn for each row execute function public.points_txn_apply();

/* ============================================================
   Vouchers (CUSTOMER_REWARD): one unused voucher per reward (FR-LOY-06)
   ============================================================ */

create unique index customer_reward_one_unused on public.customer_reward (customer_id, reward_id) where status = 'unused';

-- FR-LOY-05: points out and voucher in, in one transaction. A repeated tap finds the unused voucher
-- and fails without spending points (3.2.7.5).
create or replace function public.redeem_reward(p_reward_id text)
returns public.customer_reward
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_reward public.reward;
  v_balance integer;
  v_days integer;
  v_voucher public.customer_reward;
begin
  select c.points_balance, coalesce(s.voucher_valid_days, 30)
    into v_balance, v_days
    from public.customer c
    left join public.store_settings s on s.settings_id = coalesce(c.favorite_cafe_id, (select min(settings_id) from public.store_settings))
   where c.customer_id = v_uid
     for update of c;
  if not found then
    raise exception 'Sign in to redeem rewards.' using errcode = 'insufficient_privilege';
  end if;

  select * into v_reward from public.reward r where r.reward_id = p_reward_id and r.is_active;
  if not found then
    raise exception 'This reward is no longer available.' using errcode = 'no_data_found';
  end if;
  if exists (select 1 from public.customer_reward cr where cr.customer_id = v_uid and cr.reward_id = p_reward_id and cr.status = 'unused') then
    raise exception 'You already have this reward. Find it in My rewards.' using errcode = 'unique_violation';
  end if;
  if v_balance < v_reward.cost_pts then
    raise exception 'Need % more pts.', v_reward.cost_pts - v_balance using errcode = 'check_violation';
  end if;

  insert into public.customer_reward (customer_id, reward_id, expires_on)
  values (v_uid, p_reward_id, now() + make_interval(days => v_days))
  returning * into v_voucher;

  insert into public.points_txn (customer_id, type, points, customer_reward_id, description)
  values (v_uid, 'redeem', -v_reward.cost_pts, v_voucher.customer_reward_id, v_reward.name);

  return v_voucher;
end
$$;
comment on function public.redeem_reward(text) is 'FR-LOY-05: deducts points and issues a voucher atomically';

/* ============================================================
   Customer messages from templates (FR-TRK-03, FR-ART)
   ============================================================ */

create or replace function public.render_template(p_body text, p_order public.orders, p_extra jsonb default '{}'::jsonb)
returns text
language sql stable set search_path = ''
as $$
  select replace(replace(replace(replace(replace(replace(p_body,
    '{customer_name}', coalesce(nullif(split_part(trim(p_order.customer_name), ' ', 1), ''), 'there')),
    '{order_number}', p_order.order_no::text),
    '{pickup_time}', greatest(1, round(extract(epoch from (p_order.eta - now())) / 60))::int || ' min'),
    '{cafe_name}', coalesce((select s.cafe_name from public.store_settings s where s.settings_id = p_order.cafe_id), 'MEGS'' Cafe')),
    '{reason}', coalesce(lower(p_order.cancel_reason), '')),
    '{item_name}', coalesce(p_extra ->> 'item_name', ''))
$$;

create or replace function public.notify_order(p_order public.orders, p_event public.template_event, p_extra jsonb default '{}'::jsonb)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  t public.response_template;
begin
  if p_order.customer_id is null then
    return;
  end if;
  select * into t from public.response_template where event = p_event and audience = 'customer';
  if not found or not t.enabled then
    return;
  end if;
  insert into public.notification (customer_id, template_id, order_id, title, body, deep_link, channel)
  values (
    p_order.customer_id, t.template_id, p_order.order_id, t.title,
    public.render_template(t.body, p_order, p_extra),
    '/orders/tracking?n=' || p_order.order_no,
    t.channel
  );
end
$$;

create or replace function public.template_event_for(p_order public.orders)
returns public.template_event
language sql immutable set search_path = ''
as $$
  select case p_order.status
    when 'Received'  then 'order_received'::public.template_event
    when 'Accepted'  then 'order_accepted'::public.template_event
    when 'Preparing' then 'order_preparing'::public.template_event
    when 'Ready'     then case when p_order.fulfillment = 'delivery' then 'order_ready_delivery'::public.template_event else 'order_ready_pickup'::public.template_event end
    when 'Completed' then 'order_completed'::public.template_event
    when 'Cancelled' then case when p_order.cancelled_by = 'customer' then 'order_cancelled_customer'::public.template_event else 'order_cancelled_cafe'::public.template_event end
  end
$$;

-- FR-TRK-01: delivery orders read "Out for delivery" and "Delivered"
create or replace function public.status_label(p_order public.orders)
returns text
language sql immutable set search_path = ''
as $$
  select case
    when p_order.status = 'Ready' and p_order.fulfillment = 'delivery' then 'Out for delivery'
    when p_order.status = 'Completed' and p_order.fulfillment = 'delivery' then 'Delivered'
    when p_order.status = 'Cancelled' then 'Cancelled by ' || case when p_order.cancelled_by = 'customer' then 'customer' else 'cafe' end
    else p_order.status::text
  end
$$;

/* ============================================================
   Orders: placement checks
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
  new.placed_at := now();

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

create or replace function public.orders_after_insert()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  insert into public.order_status_event (order_id, from_status, to_status, label, actor_type, actor_name)
  values (
    new.order_id, null, 'Received',
    case when new.source = 'automated' then 'Order placed by automation' else 'Order placed' end,
    case when new.source = 'automated' then 'system'::public.actor_type else 'customer'::public.actor_type end,
    case when new.source = 'automated' then 'System' else new.customer_name end
  );
  if new.customer_reward_id is not null then
    update public.customer_reward set status = 'used', used_at = now() where customer_reward_id = new.customer_reward_id;
  end if;
  if new.promotion_id is not null then
    insert into public.promotion_redemption (promotion_id, customer_id, order_id) values (new.promotion_id, new.customer_id, new.order_id);
  end if;
  perform public.notify_order(new, 'order_received');
  return new;
end
$$;

create trigger orders_before_insert before insert on public.orders for each row execute function public.orders_before_insert();
create trigger orders_after_insert after insert on public.orders for each row execute function public.orders_after_insert();

/* ============================================================
   Orders: status transitions (SRS Table 3-1)
   ============================================================ */

create or replace function public.order_next_statuses(p_status public.order_status)
returns public.order_status[]
language sql immutable set search_path = ''
as $$
  select case p_status
    when 'Received'  then array['Accepted', 'Cancelled']::public.order_status[]
    when 'Accepted'  then array['Preparing', 'Cancelled']::public.order_status[]
    when 'Preparing' then array['Ready', 'Cancelled']::public.order_status[]
    when 'Ready'     then array['Completed', 'Cancelled']::public.order_status[]
    else array[]::public.order_status[]
  end
$$;

-- Seconds the server allows for Undo after Accept: the console offers 5 s; the rest covers the network
create or replace function public.undo_accept_window()
returns interval language sql immutable set search_path = '' as $$ select interval '10 seconds' $$;

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
begin
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
        new.accepted_at := now();
        -- FR-OPS-03: the ETA counts from acceptance
        select case when new.fulfillment = 'delivery' then s.delivery_eta_minutes else s.default_prep_minutes end
          into v_mins from public.store_settings s where s.settings_id = new.cafe_id;
        new.eta := greatest(old.eta, now() + make_interval(mins => coalesce(v_mins, 10)));
      when 'Preparing' then new.preparing_at := now();
      when 'Ready' then new.ready_at := now();
      when 'Completed' then new.completed_at := now();
      when 'Cancelled' then
        new.cancelled_at := now();
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

create or replace function public.orders_after_update()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_actor public.actor_type := public.current_actor();
  v_staff uuid := case when v_actor = 'staff' then (select auth.uid()) end;
  v_name text := public.actor_name();
  v_tier smallint;
begin
  if new.status is distinct from old.status then
    insert into public.order_status_event (order_id, from_status, to_status, label, actor_type, staff_id, actor_name)
    values (
      new.order_id, old.status, new.status,
      case when old.status = 'Accepted' and new.status = 'Received' then 'Accept undone' else public.status_label(new) end,
      v_actor, v_staff, v_name
    );

    if old.status = 'Accepted' and new.status = 'Received' then
      -- The "accepted" message must not stay up for an order that is back to Received
      delete from public.notification n
       using public.response_template t
       where n.order_id = new.order_id and n.template_id = t.template_id and t.event = 'order_accepted'
         and n.created_at > now() - public.undo_accept_window();
    else
      perform public.notify_order(new, public.template_event_for(new));
    end if;

    if new.status = 'Completed' then
      -- FR-LOY-01 / IR-05: points credited once, in the same transaction that completes the order
      if new.customer_id is not null and new.points_to_earn > 0 then
        insert into public.points_txn (customer_id, type, points, order_id, description)
        values (new.customer_id, 'earn', new.points_to_earn, new.order_id, 'Order #' || new.order_no)
        on conflict (order_id) where type = 'earn' do nothing;
      end if;
      -- Pay at counter is collected on completion
      update public.payment set status = 'captured', captured_at = now()
       where order_id = new.order_id and method = 'counter' and status = 'pending';
      -- FR-TIR-01: evaluate the tier after each completed order (upgrades only; downgrade rule is TBD-02)
      if new.customer_id is not null then
        select t.tier_id into v_tier
          from public.tier t
         where t.qualify_orders is not null
           and (select count(*) from public.orders o
                 where o.customer_id = new.customer_id and o.status = 'Completed'
                   and o.completed_at >= now() - make_interval(days => t.qualify_days)) >= t.qualify_orders
         order by t.rank desc
         limit 1;
        if v_tier is not null then
          update public.customer c set tier_id = v_tier
           where c.customer_id = new.customer_id
             and (select rank from public.tier where tier_id = v_tier) > (select rank from public.tier where tier_id = c.tier_id);
        end if;
      end if;
    end if;

    if new.status = 'Cancelled' then
      -- FR-TRK-05: refund an in-app payment; a counter payment was never taken
      update public.payment set status = 'refunded', refunded_at = now()
       where order_id = new.order_id and status in ('authorized', 'captured');
      update public.payment set status = 'failed', failure_reason = 'Not charged: order cancelled'
       where order_id = new.order_id and status = 'pending';
      -- FR-TRK-05 / TBD-08: the voucher comes back
      if new.customer_reward_id is not null then
        update public.customer_reward set status = 'unused', used_at = null
         where customer_reward_id = new.customer_reward_id and status = 'used';
      end if;
      -- TBD-12: the promo code use is given back
      delete from public.promotion_redemption where order_id = new.order_id;
    end if;

    -- NFR-SEC-06: staff status changes and every cancellation
    if v_actor = 'staff' or new.status = 'Cancelled' then
      insert into public.audit_log (actor_id, actor_type, action, entity, entity_id, before, after)
      values ((select auth.uid()), v_actor,
              case when new.status = 'Cancelled' then 'order.cancel' else 'order.status' end,
              'orders', new.order_no::text,
              jsonb_build_object('status', old.status),
              jsonb_build_object('status', new.status, 'reason', new.cancel_reason));
    end if;

  elsif new.is_delayed and not old.is_delayed then
    insert into public.order_status_event (order_id, is_delay, new_eta, label, actor_type, staff_id, actor_name)
    values (
      new.order_id, true, new.eta,
      'Delayed: new estimate ' || greatest(1, round(extract(epoch from (new.eta - now())) / 60))::int || ' min',
      v_actor, v_staff, v_name
    );
    perform public.notify_order(new, 'order_delayed');
    insert into public.audit_log (actor_id, actor_type, action, entity, entity_id, before, after)
    values ((select auth.uid()), v_actor, 'order.delay', 'orders', new.order_no::text,
            jsonb_build_object('eta', old.eta), jsonb_build_object('eta', new.eta));
  end if;
  return new;
end
$$;

create trigger orders_before_update before update on public.orders for each row execute function public.orders_before_update();
create trigger orders_after_update after update on public.orders for each row execute function public.orders_after_update();

-- Order lines are written with the order and never edited afterwards
create or replace function public.order_lines_locked()
returns trigger
language plpgsql set search_path = ''
as $$
begin
  if public.current_actor() <> 'system' then
    raise exception 'Order lines are written only by the ordering service.' using errcode = 'insufficient_privilege';
  end if;
  if tg_op = 'UPDATE' then
    raise exception 'Order lines can''t change after the order is placed.' using errcode = 'check_violation';
  end if;
  return new;
end
$$;
create trigger order_line_locked before insert or update on public.order_line for each row execute function public.order_lines_locked();
create trigger order_line_option_locked before insert or update on public.order_line_option for each row execute function public.order_lines_locked();

/* ============================================================
   Internal notes, templates, settings, availability: stamps and audit (NFR-SEC-06)
   ============================================================ */

create or replace function public.internal_note_stamp()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if public.current_actor() = 'staff' then
    new.staff_id := (select auth.uid());
    new.author_name := public.actor_name();
  end if;
  new.created_at := now();
  return new;
end
$$;
create trigger internal_note_stamp before insert on public.internal_note for each row execute function public.internal_note_stamp();

create or replace function public.template_stamp()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  new.last_edited_at := now();
  new.last_edited_by := case when public.current_actor() = 'staff' then (select auth.uid()) end;
  new.last_edited_by_name := public.actor_name();
  return new;
end
$$;
create trigger response_template_stamp before update on public.response_template for each row execute function public.template_stamp();

create or replace function public.settings_stamp()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  new.updated_at := now();
  new.updated_by := (select auth.uid());
  return new;
end
$$;
create trigger store_settings_stamp before update on public.store_settings for each row execute function public.settings_stamp();

create or replace function public.audit_change()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  -- Fields are read through jsonb: the trigger serves several tables with different columns
  v_new jsonb := to_jsonb(new);
  v_old jsonb := to_jsonb(old);
  v_id text := coalesce(v_new ->> 'settings_id', v_new ->> 'event', v_new ->> 'item_id', '?');
begin
  if tg_table_name = 'menu_item'
     and (v_new -> 'is_available', v_new -> 'unavailable_reason') is not distinct from (v_old -> 'is_available', v_old -> 'unavailable_reason') then
    return new;
  end if;
  insert into public.audit_log (actor_id, actor_type, action, entity, entity_id, before, after)
  values ((select auth.uid()), public.current_actor(), tg_table_name || '.update', tg_table_name, v_id, to_jsonb(old), to_jsonb(new));
  return new;
end
$$;
create trigger store_settings_audit after update on public.store_settings for each row execute function public.audit_change();
create trigger response_template_audit after update on public.response_template for each row execute function public.audit_change();
create trigger menu_item_audit after update on public.menu_item for each row execute function public.audit_change();

/* ============================================================
   Staff-only payment detail (IR-03: payment references are staff only)
   ============================================================ */

create or replace function public.staff_order_payments(p_order_id uuid)
returns setof public.payment
language plpgsql stable security definer set search_path = ''
as $$
begin
  if not public.is_staff() then
    raise exception 'Staff only.' using errcode = 'insufficient_privilege';
  end if;
  return query select * from public.payment where order_id = p_order_id order by created_at;
end
$$;

/* ============================================================
   Row Level Security
   ============================================================ */

alter table public.store_settings       enable row level security;
alter table public.tier                 enable row level security;
alter table public.staff_user           enable row level security;
alter table public.customer             enable row level security;
alter table public.address              enable row level security;
alter table public.payment_method       enable row level security;
alter table public.menu_category        enable row level security;
alter table public.menu_item            enable row level security;
alter table public.option_group         enable row level security;
alter table public.option_value         enable row level security;
alter table public.reward               enable row level security;
alter table public.customer_reward      enable row level security;
alter table public.promotion            enable row level security;
alter table public.orders               enable row level security;
alter table public.order_line           enable row level security;
alter table public.order_line_option    enable row level security;
alter table public.payment              enable row level security;
alter table public.order_status_event   enable row level security;
alter table public.internal_note        enable row level security;
alter table public.points_txn           enable row level security;
alter table public.promotion_redemption enable row level security;
alter table public.response_template    enable row level security;
alter table public.notification         enable row level security;
alter table public.automated_order      enable row level security;
alter table public.audit_log            enable row level security;
alter table public.login_attempt        enable row level security;  -- no policies: server functions only

-- Public catalog: guests may browse the menu and promotions (FR-ACC-01)
create policy "Anyone can read store settings" on public.store_settings for select to anon, authenticated using (true);
create policy "Anyone can read tiers" on public.tier for select to anon, authenticated using (true);
create policy "Anyone can read active categories" on public.menu_category for select to anon, authenticated using (is_active or public.is_staff());
create policy "Anyone can read active items" on public.menu_item for select to anon, authenticated using (is_active or public.is_staff());
create policy "Anyone can read option groups" on public.option_group for select to anon, authenticated using (true);
create policy "Anyone can read option values" on public.option_value for select to anon, authenticated using (true);
create policy "Anyone can read active rewards" on public.reward for select to anon, authenticated using (is_active);
-- Promo codes are validated by the server (FR-PRO-08) and never listed
create policy "Anyone can read published offers" on public.promotion for select to anon, authenticated using (is_published and code is null);

-- Staff
create policy "Staff update store settings" on public.store_settings for update to authenticated using (public.is_staff()) with check (public.is_staff());
create policy "Staff update item availability" on public.menu_item for update to authenticated using (public.is_staff()) with check (public.is_staff());
create policy "Staff read staff" on public.staff_user for select to authenticated using (public.is_staff() or staff_id = (select auth.uid()));

-- Customer profile
create policy "Customers read own profile" on public.customer for select to authenticated using (customer_id = (select auth.uid()) or public.is_staff());
create policy "Customers update own profile" on public.customer for update to authenticated using (customer_id = (select auth.uid())) with check (customer_id = (select auth.uid()));

-- Addresses (FR-PRF-04)
create policy "Customers read own addresses" on public.address for select to authenticated using (customer_id = (select auth.uid()) or public.is_staff());
create policy "Customers add own addresses" on public.address for insert to authenticated with check (customer_id = (select auth.uid()));
create policy "Customers edit own addresses" on public.address for update to authenticated using (customer_id = (select auth.uid())) with check (customer_id = (select auth.uid()));
create policy "Customers delete own addresses" on public.address for delete to authenticated using (customer_id = (select auth.uid()));

-- Payment methods (FR-PRF-03): owner only
create policy "Customers read own payment methods" on public.payment_method for select to authenticated using (customer_id = (select auth.uid()));
create policy "Customers add own payment methods" on public.payment_method for insert to authenticated with check (customer_id = (select auth.uid()));
create policy "Customers edit own payment methods" on public.payment_method for update to authenticated using (customer_id = (select auth.uid())) with check (customer_id = (select auth.uid()));
create policy "Customers delete own payment methods" on public.payment_method for delete to authenticated using (customer_id = (select auth.uid()));

-- Orders: customers read their own and may cancel (the trigger allows nothing else); staff work the queue
create policy "Customers read own orders" on public.orders for select to authenticated using (customer_id = (select auth.uid()) or public.is_staff());
-- One policy for both (performance advisor 0006); orders_before_update decides what each may change
create policy "Customers cancel own orders; staff work the queue" on public.orders for update to authenticated
  using (customer_id = (select auth.uid()) or public.is_staff())
  with check (customer_id = (select auth.uid()) or public.is_staff());

create policy "Read lines of visible orders" on public.order_line for select to authenticated
  using (exists (select 1 from public.orders o where o.order_id = order_line.order_id));
create policy "Read options of visible lines" on public.order_line_option for select to authenticated
  using (exists (select 1 from public.order_line l where l.line_id = order_line_option.line_id));
create policy "Read events of visible orders" on public.order_status_event for select to authenticated
  using (exists (select 1 from public.orders o where o.order_id = order_status_event.order_id));
create policy "Read payments of visible orders" on public.payment for select to authenticated
  using (exists (select 1 from public.orders o where o.order_id = payment.order_id));

-- Internal notes: staff only (FR-STF-10, IR-03)
create policy "Staff read internal notes" on public.internal_note for select to authenticated using (public.is_staff());
create policy "Staff add internal notes" on public.internal_note for insert to authenticated with check (public.is_staff());

-- Loyalty
create policy "Customers read own points" on public.points_txn for select to authenticated using (customer_id = (select auth.uid()) or public.is_staff());
create policy "Customers read own vouchers" on public.customer_reward for select to authenticated using (customer_id = (select auth.uid()) or public.is_staff());
create policy "Customers read own promo uses" on public.promotion_redemption for select to authenticated using (customer_id = (select auth.uid()) or public.is_staff());

-- Notifications (FR-TRK-07)
create policy "Customers read own notifications" on public.notification for select to authenticated using (customer_id = (select auth.uid()));
create policy "Customers mark own notifications read" on public.notification for update to authenticated using (customer_id = (select auth.uid())) with check (customer_id = (select auth.uid()));

-- Staff console
create policy "Staff read templates" on public.response_template for select to authenticated using (public.is_staff());
create policy "Staff edit templates" on public.response_template for update to authenticated using (public.is_staff()) with check (public.is_staff());
create policy "Staff read automated orders" on public.automated_order for select to authenticated using (public.is_staff());
create policy "Staff read audit log" on public.audit_log for select to authenticated using (public.is_staff());

/* ============================================================
   Privileges: nothing is exposed unless granted here
   ============================================================ */

revoke all on all tables in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
revoke execute on all functions in schema public from public, anon, authenticated;
alter default privileges in schema public revoke all on tables from anon, authenticated;
alter default privileges in schema public revoke all on sequences from anon, authenticated;
alter default privileges in schema public revoke execute on functions from public, anon, authenticated;

-- RLS policies call these as the querying user
grant execute on function public.is_staff() to anon, authenticated;
grant execute on function public.current_actor() to authenticated;
grant execute on function public.redeem_reward(text) to authenticated;
grant execute on function public.staff_order_payments(uuid) to authenticated;

-- Catalog
grant select on public.store_settings, public.tier, public.menu_category, public.menu_item,
  public.option_group, public.option_value, public.reward to anon, authenticated;
grant select (promotion_id, title, description, image_url, starts_at, ends_at, terms, rule, usage_limit,
  is_one_time, target_category_id, target_item_id, is_featured, is_published, created_at)
  on public.promotion to anon, authenticated;

-- Customer
grant select on public.customer to authenticated;
-- FR-PRF-02: the mobile number is read-only; balance and tier are system-managed
grant update (full_name, email, birthday, default_drink_size, favorite_cafe_id,
  notify_order_updates, notify_promotions, notify_rewards_reminders) on public.customer to authenticated;
grant select, insert, update, delete on public.address to authenticated;
grant select, delete on public.payment_method to authenticated;
grant insert (customer_id, type, provider, provider_token, brand, last4, wallet_name, is_default) on public.payment_method to authenticated;
grant update (is_default) on public.payment_method to authenticated;

-- Orders
grant select on public.orders, public.order_line, public.order_line_option, public.order_status_event to authenticated;
grant update (status, is_delayed, eta, cancelled_by, cancel_reason_code, cancel_reason) on public.orders to authenticated;
-- IR-03: provider_ref and failure_reason are left out; staff read them through staff_order_payments()
grant select (payment_id, order_id, method, method_label, amount, status, authorized_at, captured_at, refunded_at, created_at)
  on public.payment to authenticated;
grant select on public.internal_note to authenticated;
grant insert (order_id, body) on public.internal_note to authenticated;

-- Loyalty and notifications
grant select on public.points_txn, public.customer_reward, public.promotion_redemption to authenticated;
grant select on public.notification to authenticated;
grant update (read_at) on public.notification to authenticated;

-- Staff console
grant select on public.staff_user, public.response_template, public.automated_order, public.audit_log to authenticated;
grant update (title, body, enabled) on public.response_template to authenticated;
grant update (accepting_orders, opening_hours, default_prep_minutes, delivery_eta_minutes, delivery_enabled,
  delivery_fee, new_order_chime, auto_advance_demo) on public.store_settings to authenticated;
grant update (is_available, unavailable_reason) on public.menu_item to authenticated;

/* ============================================================
   Realtime: status within 5 s to the customer, new orders within 5 s to staff
   (FR-TRK-02, FR-STF-04, NFR-PER-03). Realtime applies the RLS policies above.
   ============================================================ */

alter publication supabase_realtime add table
  public.orders, public.order_status_event, public.notification,
  public.menu_item, public.store_settings, public.automated_order;

/* ============================================================
   Scheduled housekeeping (SRS 3.8 retention, FR-LOY-04 expiry)
   ============================================================ */

create extension if not exists pg_cron;

create or replace function public.housekeeping()
returns void
language plpgsql security definer set search_path = ''
as $$
begin
  -- Vouchers expire 30 days after redemption
  update public.customer_reward set status = 'expired' where status = 'unused' and expires_on <= now();
  -- Notifications are kept 90 days
  delete from public.notification where created_at < now() - interval '90 days';
  -- Lockouts that ended a day ago
  delete from public.login_attempt where coalesce(locked_until, updated_at) < now() - interval '1 day';
end
$$;

select cron.schedule('megs-housekeeping', '15 * * * *', $$select public.housekeeping()$$);
