-- Defence in depth behind place-order: an app delivery order must carry a pinned location that an active
-- service area covers, whoever calls create_order(). The snapshot (delivery_address jsonb) holds the pin, so
-- later edits to the saved address never change a placed order.
-- Automated orders (source 'automated', a staff-side channel) are left as they are; see DELIVERY_AUDIT.md.
--
-- Rollback:
--   drop trigger if exists orders_delivery_guard on public.orders;
--   drop function if exists public.orders_delivery_guard();

create or replace function public.orders_delivery_guard()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_lat double precision;
  v_lng double precision;
begin
  if new.fulfillment <> 'delivery' or new.source <> 'app' then
    return new;
  end if;
  begin
    v_lat := (new.delivery_address ->> 'lat')::double precision;
    v_lng := (new.delivery_address ->> 'lng')::double precision;
  exception when others then
    v_lat := null;
  end;
  if v_lat is null or v_lng is null then
    raise exception 'ADDRESS_NEEDS_PIN: Pin the delivery address on the map.' using errcode = 'check_violation';
  end if;
  if not public.is_within_service_area(v_lat, v_lng) then
    raise exception 'OUT_OF_AREA: We deliver within Bocaue only for now.' using errcode = 'check_violation';
  end if;
  return new;
end
$$;
revoke execute on function public.orders_delivery_guard() from public, anon, authenticated;

create trigger orders_delivery_guard before insert on public.orders
  for each row execute function public.orders_delivery_guard();
