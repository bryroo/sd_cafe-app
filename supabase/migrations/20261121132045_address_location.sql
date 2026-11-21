-- Saved addresses get the pinned delivery location (the customer's own pin on the map; the coordinates
-- are the source of truth, the text is for the rider). Extends the existing address table rather than
-- adding a second one, so old app versions keep working: every new column is optional.
--
--   * lat/lng: WGS 84, both or neither. Old rows have neither and must be pinned before delivery
--     (place-order answers ADDRESS_NEEDS_PIN).
--   * A pin outside every active service area can't be saved (OUT_OF_SERVICE_AREA): no waitlist.
--   * Anonymous Auth users (is_anonymous claim) get nothing, even if anonymous sign-in is turned on later.
--   * set_default_address(): swaps the default in one statement order the unique index accepts.
--
-- Rollback:
--   drop function if exists public.set_default_address(uuid);
--   drop trigger if exists address_check_area on public.address;
--   drop function if exists public.address_check_area();
--   alter policy "Customers read own addresses" on public.address using (customer_id = (select auth.uid()) or (select public.is_staff()));
--   alter policy "Customers add own addresses" on public.address with check (customer_id = (select auth.uid()));
--   alter policy "Customers edit own addresses" on public.address using (customer_id = (select auth.uid())) with check (customer_id = (select auth.uid()));
--   alter policy "Customers delete own addresses" on public.address using (customer_id = (select auth.uid()));
--   alter table public.address drop constraint if exists address_pin_pair, drop constraint if exists address_pin_range,
--     drop column if exists lat, drop column if exists lng, drop column if exists place_id,
--     drop column if exists landmark, drop column if exists location_set_at;

alter table public.address
  add column lat             double precision,
  add column lng             double precision,
  -- Google place id when the pin came from a search result (Google allows keeping place ids)
  add column place_id        text check (length(place_id) <= 300),
  add column landmark        text check (length(landmark) <= 120),
  add column location_set_at timestamptz,
  add constraint address_pin_pair check ((lat is null) = (lng is null)),
  add constraint address_pin_range check (lat is null or (lat between -90 and 90 and lng between -180 and 180));

comment on column public.address.lat is 'Pinned delivery location (WGS 84), set by the customer on the map. Source of truth for delivery.';

-- A new or moved pin must be inside an active service area. Rows whose pin doesn't change are left alone,
-- so switching an area off later doesn't block edits to names or notes.
create or replace function public.address_check_area()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' and new.lat is not distinct from old.lat and new.lng is not distinct from old.lng then
    return new;
  end if;
  if new.lat is not null then
    if not public.is_within_service_area(new.lat, new.lng) then
      raise exception 'OUT_OF_SERVICE_AREA: We deliver within Bocaue only for now.' using errcode = 'check_violation';
    end if;
    new.location_set_at := now();
  else
    new.location_set_at := null;
    new.place_id := null;
  end if;
  return new;
end
$$;
revoke execute on function public.address_check_area() from public, anon, authenticated;

create trigger address_check_area before insert or update of lat, lng on public.address
  for each row execute function public.address_check_area();

-- Signed-in, non-anonymous customers only (staff keep reading, to deliver)
alter policy "Customers read own addresses" on public.address
  using ((customer_id = (select auth.uid()) and not coalesce(((select auth.jwt()) ->> 'is_anonymous')::boolean, false))
         or (select public.is_staff()));
alter policy "Customers add own addresses" on public.address
  with check (customer_id = (select auth.uid()) and not coalesce(((select auth.jwt()) ->> 'is_anonymous')::boolean, false));
alter policy "Customers edit own addresses" on public.address
  using (customer_id = (select auth.uid()) and not coalesce(((select auth.jwt()) ->> 'is_anonymous')::boolean, false))
  with check (customer_id = (select auth.uid()) and not coalesce(((select auth.jwt()) ->> 'is_anonymous')::boolean, false));
alter policy "Customers delete own addresses" on public.address
  using (customer_id = (select auth.uid()) and not coalesce(((select auth.jwt()) ->> 'is_anonymous')::boolean, false));

-- Makes one of the caller's addresses the default. SECURITY INVOKER: RLS limits it to their own rows.
create or replace function public.set_default_address(p_address_id uuid)
returns void
language plpgsql security invoker set search_path = ''
as $$
begin
  if not exists (select 1 from public.address where address_id = p_address_id and customer_id = (select auth.uid())) then
    raise exception 'Address not found.' using errcode = 'no_data_found';
  end if;
  update public.address set is_default = false
    where customer_id = (select auth.uid()) and is_default and address_id <> p_address_id;
  update public.address set is_default = true
    where address_id = p_address_id and customer_id = (select auth.uid());
end
$$;
revoke execute on function public.set_default_address(uuid) from public, anon;
grant execute on function public.set_default_address(uuid) to authenticated;
