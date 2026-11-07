-- MEGS' Cafe: core schema
-- Follows SRS v1.2.0 Table 4-1 (logical tables), Section 3.4 (class attributes) and Section 3.8
-- (data formats and integrity). Money is integer centavos; timestamps are timestamptz (UTC, shown in
-- Asia/Manila); mobile numbers are E.164; statuses are enums.
--
-- Additions beyond Table 4-1, each tied to a requirement:
--   promotion_redemption  one use per customer, given back on cancel (FR-PRO-08, TBD-12)
--   audit_log             staff status changes, cancellations, template and settings edits (NFR-SEC-06)
--   login_attempt         5 failures lock sign-in for 15 minutes (FR-ACC-07, FR-STF-01)

create extension if not exists citext with schema extensions;

/* ============================================================
   Enumerations
   ============================================================ */

-- SRS 1.3 / Table 3-1. Delayed is a flag on the order, not a status.
create type public.order_status as enum ('Received', 'Accepted', 'Preparing', 'Ready', 'Completed', 'Cancelled');
create type public.fulfillment_type as enum ('pickup', 'delivery');
create type public.order_source as enum ('app', 'automated');
create type public.cancelled_by as enum ('customer', 'cafe');
-- FR-STF-07
create type public.cancel_reason_code as enum ('out_of_stock', 'too_busy', 'customer_request', 'payment_issue', 'other');
-- SRS 3.4.5
create type public.payment_method_type as enum ('card', 'e_wallet', 'counter');
create type public.payment_status as enum ('pending', 'authorized', 'captured', 'failed', 'refunded');
-- SRS 3.4.7: earn, redeem, restore
create type public.points_txn_type as enum ('earn', 'redeem', 'restore');
-- SRS 3.4.8
create type public.voucher_status as enum ('unused', 'used', 'expired');
-- SRS 3.4.12
create type public.automated_order_state as enum ('queued', 'processing', 'succeeded', 'failed');
-- SRS 3.4.11
create type public.message_channel as enum ('push', 'in_app');
create type public.template_audience as enum ('customer', 'staff');
-- FR-ART-01 (Ready is split by fulfillment so pickup and delivery read correctly, FR-TRK-01)
create type public.template_event as enum (
  'order_received', 'order_accepted', 'order_preparing', 'order_ready_pickup', 'order_ready_delivery',
  'order_completed', 'order_cancelled_cafe', 'order_cancelled_customer', 'order_delayed',
  'item_unavailable', 'payment_failed',
  -- FR-ART-07: internal staff alerts, listed separately
  'staff_new_order', 'staff_automation_failed', 'staff_order_waiting'
);
create type public.menu_kind as enum ('drink', 'food');
create type public.category_kind as enum ('board', 'collection');
create type public.option_pick as enum ('one', 'many');
create type public.address_label as enum ('Home', 'Work', 'Other');
-- TBD-11: single Staff role at launch; Manager kept for later
create type public.staff_role as enum ('staff', 'manager');
create type public.actor_type as enum ('customer', 'staff', 'system');
create type public.login_audience as enum ('customer', 'staff');

/* ============================================================
   STORE_SETTINGS (one row per cafe: SRS 3.7 allows more locations)
   ============================================================ */

create table public.store_settings (
  settings_id            smallint generated always as identity primary key,
  cafe_name              text        not null,
  address                text,
  timezone               text        not null default 'Asia/Manila',
  -- FR-OPS-01
  accepting_orders       boolean     not null default true,
  -- FR-OPS-02: seven entries, Sunday first: {"open":"07:00","close":"21:00","closed":false}
  opening_hours          jsonb       not null,
  -- FR-OPS-03
  default_prep_minutes   integer     not null default 10 check (default_prep_minutes between 1 and 240),
  delivery_eta_minutes   integer     not null default 35 check (delivery_eta_minutes between 1 and 480),
  -- FR-OPS-05, AS-02
  delivery_enabled       boolean     not null default true,
  delivery_fee           integer     not null default 2500 check (delivery_fee >= 0),
  -- NFR-MNT-01: business rules configurable without an app release
  points_per_peso        numeric(6,3) not null default 1 check (points_per_peso >= 0),  -- AS-03, TBD-01
  voucher_valid_days     integer     not null default 30 check (voucher_valid_days > 0), -- FR-LOY-04
  voucher_reminder_days  integer     not null default 3 check (voucher_reminder_days >= 0), -- TBD-09
  lockout_attempts       integer     not null default 5 check (lockout_attempts > 0),     -- FR-ACC-07
  lockout_minutes        integer     not null default 15 check (lockout_minutes > 0),
  waiting_flag_minutes   integer     not null default 10 check (waiting_flag_minutes > 0), -- FR-STF-05
  campaign_modal_days    integer     not null default 7 check (campaign_modal_days >= 0),  -- FR-PRO-04
  new_order_chime        boolean     not null default true,  -- FR-STF-04
  auto_advance_demo      boolean     not null default false, -- prototype demo switch only
  updated_at             timestamptz not null default now(),
  updated_by             uuid,
  constraint opening_hours_week check (jsonb_typeof(opening_hours) = 'array' and jsonb_array_length(opening_hours) = 7)
);
comment on table public.store_settings is 'SRS STORE_SETTINGS: one row per cafe location (hours, accepting orders, fees, configurable rules)';

/* ============================================================
   TIER
   ============================================================ */

create table public.tier (
  tier_id        smallint generated always as identity primary key,
  name           text         not null unique,
  rank           smallint     not null unique,         -- Regular = 1, Loyal = 2
  discount_pct   numeric(5,2) not null check (discount_pct between 0 and 100),
  -- AS-04 / TBD-02: Loyal after qualify_orders completed orders in qualify_days days
  qualify_orders integer      check (qualify_orders > 0),
  qualify_days   integer      check (qualify_days > 0),
  description    text,
  is_default     boolean      not null default false,
  created_at     timestamptz  not null default now()
);
create unique index tier_one_default on public.tier (is_default) where is_default;
comment on table public.tier is 'SRS TIER: Regular-customer tiers (FR-TIR-01 to 04)';

/* ============================================================
   STAFF_USER
   ============================================================ */

create table public.staff_user (
  staff_id    uuid        primary key references auth.users (id) on delete cascade,
  username    extensions.citext not null unique,
  email       extensions.citext unique,
  full_name   text        not null,
  role        public.staff_role not null default 'staff',
  cafe_id     smallint    not null references public.store_settings (settings_id),
  is_active   boolean     not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
comment on table public.staff_user is 'SRS STAFF_USER: credentials live in auth.users (bcrypt, NFR-SEC-02)';

/* ============================================================
   CUSTOMER
   ============================================================ */

create table public.customer (
  customer_id               uuid        primary key references auth.users (id) on delete cascade,
  full_name                 text        not null check (length(trim(full_name)) between 1 and 100),
  -- SRS 3.8: E.164 (+63); unique per customer
  mobile_no                 text        not null unique check (mobile_no ~ '^\+639[0-9]{9}$'),
  mobile_verified_at        timestamptz,
  email                     extensions.citext unique,
  birthday                  date,
  -- FR-CRT-05
  default_drink_size        text,
  favorite_cafe_id          smallint    references public.store_settings (settings_id) on delete set null,
  tier_id                   smallint    not null references public.tier (tier_id),
  -- SRS 3.8: always equal to the sum of points_txn (kept by trigger)
  points_balance            integer     not null default 0 check (points_balance >= 0),
  -- notificationSettings (FR-PRF-05). Promotions are off by default (OR-03, DPA)
  notify_order_updates      boolean     not null default true,
  notify_promotions         boolean     not null default false,
  notify_rewards_reminders  boolean     not null default true,
  promo_consent_at          timestamptz,
  -- FR-ACC-02, OR-03
  terms_accepted_at         timestamptz not null,
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now()
);
comment on table public.customer is 'SRS CUSTOMER: account, profile and preferences. Password hash lives in auth.users.';

/* ============================================================
   ADDRESS
   ============================================================ */

create table public.address (
  address_id      uuid        primary key default gen_random_uuid(),
  customer_id     uuid        not null references public.customer (customer_id) on delete cascade,
  label           public.address_label not null default 'Home',
  -- FR-CHK-02: recipient name and street, barangay, city
  recipient_name  text        not null check (length(trim(recipient_name)) between 1 and 100),
  street          text        not null check (length(trim(street)) between 1 and 200),
  barangay        text        not null check (length(trim(barangay)) between 1 and 100),
  city            text        not null check (length(trim(city)) between 1 and 100),
  mobile_no       text        check (mobile_no ~ '^\+639[0-9]{9}$'),
  notes           text        check (length(notes) <= 200),
  is_default      boolean     not null default false,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index address_customer on public.address (customer_id);
create unique index address_one_default on public.address (customer_id) where is_default;
comment on table public.address is 'SRS ADDRESS: saved delivery addresses (FR-PRF-04)';

/* ============================================================
   PAYMENT_METHOD
   ============================================================ */

create table public.payment_method (
  method_id       uuid        primary key default gen_random_uuid(),
  customer_id     uuid        not null references public.customer (customer_id) on delete cascade,
  type            public.payment_method_type not null check (type <> 'counter'),
  -- NFR-SEC-03 / IR-01: only the provider token and display data; never card numbers or CVV
  provider        text        not null default 'test',
  provider_token  text        not null,
  brand           text,
  last4           text        check (last4 ~ '^[0-9]{4}$'),
  wallet_name     text,
  is_default      boolean     not null default false,
  created_at      timestamptz not null default now(),
  constraint card_has_last4 check (type <> 'card' or last4 is not null),
  unique (provider, provider_token)
);
create index payment_method_customer on public.payment_method (customer_id);
create unique index payment_method_one_default on public.payment_method (customer_id) where is_default;
comment on table public.payment_method is 'SRS PAYMENT_METHOD: tokenized card or linked e-wallet. Pay at counter is not stored.';

/* ============================================================
   MENU_CATEGORY / MENU_ITEM
   ============================================================ */

create table public.menu_category (
  category_id  text        primary key,
  title        text        not null,
  -- FR-MNU-03: Coffee, Non-Coffee, Food (boards only)
  menu_group   text,
  kind         public.category_kind not null default 'board',
  -- Collections (Best Sellers, Must-Try, Kids' Favorites) are the items carrying this badge
  badge_match  text,
  sort_order   integer     not null default 0,
  is_active    boolean     not null default true,
  constraint collection_has_badge check (kind = 'board' or badge_match is not null),
  constraint board_has_group check (kind = 'collection' or menu_group is not null)
);
comment on table public.menu_category is 'SRS MENU_CATEGORY: printed menu boards and curated collections (data-driven, FR-MNU-03)';

create table public.menu_item (
  item_id             text        primary key,
  category_id         text        not null references public.menu_category (category_id),
  kind                public.menu_kind not null,
  name                text        not null,
  description         text        not null default '',
  blurb               text,
  -- FR-CRT-01: Best Seller, Must-Try, New, Kids' Favorite
  badges              text[]      not null default '{}',
  image_url           text,
  -- One price items (food). Drinks are priced per size in their Size option group.
  price               integer     check (price >= 0),
  is_new              boolean     not null default false,
  -- FR-MNU-05, FR-OPS-04
  is_available        boolean     not null default true,
  unavailable_reason  text        check (length(unavailable_reason) <= 140),
  is_active           boolean     not null default true,
  sort_order          integer     not null default 0,
  updated_at          timestamptz not null default now()
);
create index menu_item_category on public.menu_item (category_id);
comment on table public.menu_item is 'SRS MENU_ITEM: price is set for single-price items; sized items are priced by their Size option values';

/* ============================================================
   OPTION_GROUP / OPTION_VALUE (per item, as SRS Table 4-1)
   ============================================================ */

create table public.option_group (
  group_id     bigint      generated always as identity primary key,
  item_id      text        not null references public.menu_item (item_id) on delete cascade,
  code         text        not null,                 -- size, sugar, milk, add-ons, ...
  title        text        not null,
  is_required  boolean     not null default false,
  pick         public.option_pick not null default 'one',
  -- A Size group's values carry the item's full price for that size (SRS 1.3 "Size")
  is_size      boolean     not null default false,
  sort_order   integer     not null default 0,
  unique (item_id, code),
  constraint size_is_pick_one check (not is_size or (pick = 'one' and is_required))
);
create unique index option_group_one_size on public.option_group (item_id) where is_size;

create table public.option_value (
  value_id      bigint      generated always as identity primary key,
  group_id      bigint      not null references public.option_group (group_id) on delete cascade,
  label         text        not null,
  -- Price delta in centavos; for a Size group, the item's full price in that size
  price         integer     not null default 0 check (price >= 0),
  badge         text,
  is_default    boolean     not null default false,
  is_available  boolean     not null default true,
  sort_order    integer     not null default 0,
  unique (group_id, label)
);
comment on column public.option_value.price is 'Centavos. Delta for ordinary options; full item price for values of a Size group.';

/* ============================================================
   REWARD / CUSTOMER_REWARD
   ============================================================ */

create table public.reward (
  reward_id       text        primary key,
  name            text        not null,
  cost_pts        integer     not null check (cost_pts > 0),
  terms           text[]      not null default '{}',
  -- FR-LOY-09: slots the voucher makes free, e.g. [{"label":"a drink","kind":"drink"},{"label":"a snack","categories":["snacks"]}]
  eligible_items  jsonb       not null check (jsonb_typeof(eligible_items) = 'array' and jsonb_array_length(eligible_items) > 0),
  goal_label      text,       -- "a free drink" (FR-LOY-02)
  image_url       text,
  is_active       boolean     not null default true,
  sort_order      integer     not null default 0,
  created_at      timestamptz not null default now()
);
comment on table public.reward is 'SRS REWARD: catalog (FR-LOY-03, TBD-13)';

create table public.customer_reward (
  customer_reward_id  uuid        primary key default gen_random_uuid(),
  customer_id         uuid        not null references public.customer (customer_id) on delete cascade,
  reward_id           text        not null references public.reward (reward_id),
  status              public.voucher_status not null default 'unused',
  redeemed_at         timestamptz not null default now(),
  -- FR-LOY-05: 30 days after redemption
  expires_on          timestamptz not null,
  used_at             timestamptz,
  constraint used_has_time check ((status = 'used') = (used_at is not null)),
  constraint expiry_after_redeem check (expires_on > redeemed_at)
);
create index customer_reward_customer on public.customer_reward (customer_id, status);
comment on table public.customer_reward is 'SRS CUSTOMER_REWARD: issued vouchers';

/* ============================================================
   PROMOTION
   ============================================================ */

create table public.promotion (
  promotion_id        text        primary key,
  title               text        not null,
  description         text        not null default '',
  image_url           text,
  starts_at           timestamptz not null,
  ends_at             timestamptz not null,
  terms               text[]      not null default '{}',
  -- Discount rule evaluated by the pricing engine, e.g. {"type":"percent_after_tier","percent":10,"min_spend":20000}
  rule                jsonb       not null check (jsonb_typeof(rule) = 'object' and rule ? 'type'),
  -- Promo codes (FR-CHK-05); null for automatic offers
  code                extensions.citext unique,
  -- Total uses across all customers; null = unlimited
  usage_limit         integer     check (usage_limit > 0),
  -- One use per customer (FR-PRO-07, TBD-12)
  is_one_time         boolean     not null default false,
  -- "Order now" target (FR-PRO-02)
  target_category_id  text        references public.menu_category (category_id),
  target_item_id      text        references public.menu_item (item_id),
  is_featured         boolean     not null default false,
  is_published        boolean     not null default true,
  cms_synced_at       timestamptz,
  created_at          timestamptz not null default now(),
  constraint promotion_window check (ends_at > starts_at),
  constraint code_upper check (code is null or code::text = upper(code::text))
);
comment on table public.promotion is 'SRS PROMOTION: automatic offers and promo codes, cached from the CMS (AS-07)';

/* ============================================================
   ORDER (named orders: ORDER is reserved in SQL)
   ============================================================ */

-- SRS 3.8: unique, sequential, human-readable order numbers (#1001, #1002, ...)
create sequence public.order_no_seq start with 1001;

create table public.orders (
  order_id            uuid        primary key default gen_random_uuid(),
  order_no            bigint      not null unique default nextval('public.order_no_seq'),
  -- SRS 3.1.4, FR-CHK-08, NFR-REL-01, IR-08: a retried submission never makes a second order
  idempotency_key     uuid        not null unique,
  cafe_id             smallint    not null references public.store_settings (settings_id),
  customer_id         uuid        references public.customer (customer_id) on delete set null,
  -- Copies taken at placement, so the record keeps what the cafe saw; anonymized on account deletion
  customer_name       text        not null,
  customer_mobile     text        not null,
  fulfillment         public.fulfillment_type not null,
  address_id          uuid        references public.address (address_id) on delete set null,
  delivery_address    jsonb,
  note                text        check (length(note) <= 140),
  -- Price breakdown in the FR-CHK-04 order. All centavos.
  subtotal            integer     not null check (subtotal >= 0),
  tier_name           text,
  tier_discount       integer     not null default 0 check (tier_discount >= 0),
  promotion_id        text        references public.promotion (promotion_id),
  promotion_label     text,
  promo_discount      integer     not null default 0 check (promo_discount >= 0),
  customer_reward_id  uuid        references public.customer_reward (customer_reward_id),
  reward_name         text,
  reward_discount     integer     not null default 0 check (reward_discount >= 0),
  delivery_fee        integer     not null default 0 check (delivery_fee >= 0),
  total               integer     not null check (total >= 0),
  -- AS-03: points this order earns when Completed
  points_to_earn      integer     not null default 0 check (points_to_earn >= 0),
  status              public.order_status not null default 'Received',
  is_delayed          boolean     not null default false,
  eta                 timestamptz not null,
  source              public.order_source not null default 'app',
  cancelled_by        public.cancelled_by,
  cancel_reason_code  public.cancel_reason_code,
  cancel_reason       text        check (length(cancel_reason) <= 200),
  -- Timestamps per step (SRS 3.4.4 "timestamps")
  placed_at           timestamptz not null default now(),
  accepted_at         timestamptz,
  preparing_at        timestamptz,
  ready_at            timestamptz,
  completed_at        timestamptz,
  cancelled_at        timestamptz,
  updated_at          timestamptz not null default now(),
  -- FR-CHK-04 / AS-05: discounts never take the items below zero; the fee is added after
  constraint total_adds_up check (
    total = greatest(0, subtotal - tier_discount - promo_discount - reward_discount) + delivery_fee
  ),
  -- FR-CHK-03: delivery fee on delivery orders only
  constraint fee_only_on_delivery check (fulfillment = 'delivery' or delivery_fee = 0),
  -- FR-CHK-02: delivery needs an address
  constraint delivery_has_address check (fulfillment = 'pickup' or delivery_address is not null),
  constraint promo_has_promotion check ((promo_discount = 0) or promotion_id is not null),
  constraint reward_has_voucher check ((reward_discount = 0) or customer_reward_id is not null),
  constraint cancel_fields check (
    (status = 'Cancelled') = (cancelled_by is not null and cancelled_at is not null)
  ),
  -- Table 3-1: Delayed only while Accepted or Preparing (FR-STF-08)
  constraint delayed_when_open check (not is_delayed or status in ('Accepted', 'Preparing'))
);
alter sequence public.order_no_seq owned by public.orders.order_no;
create index orders_customer on public.orders (customer_id, placed_at desc);
create index orders_queue on public.orders (cafe_id, status, placed_at);
-- IR-04 / AS-05: a voucher pays for at most one live order
create unique index orders_voucher_once on public.orders (customer_reward_id)
  where customer_reward_id is not null and status <> 'Cancelled';
comment on table public.orders is 'SRS ORDER: header, fulfillment, status and totals. Totals are immutable after placement (SRS 3.8).';

/* ============================================================
   ORDER_LINE / ORDER_LINE_OPTION
   ============================================================ */

create table public.order_line (
  line_id     uuid        primary key default gen_random_uuid(),
  order_id    uuid        not null references public.orders (order_id) on delete cascade,
  item_id     text        references public.menu_item (item_id) on delete set null,
  item_name   text        not null,
  -- Price of one unit with its options, at placement
  unit_price  integer     not null check (unit_price >= 0),
  -- FR-CRT-04
  quantity    integer     not null check (quantity between 1 and 20),
  note        text        check (length(note) <= 140),
  line_total  integer     generated always as (unit_price * quantity) stored,
  sort_order  integer     not null default 0
);
create index order_line_order on public.order_line (order_id);

create table public.order_line_option (
  line_id      uuid        not null references public.order_line (line_id) on delete cascade,
  value_id     bigint      references public.option_value (value_id) on delete set null,
  group_title  text        not null,
  label        text        not null,
  price        integer     not null default 0 check (price >= 0),
  sort_order   integer     not null default 0,
  primary key (line_id, group_title, label)
);
comment on table public.order_line_option is 'SRS ORDER_LINE_OPTION: chosen option values, with label and price copied at placement';

/* ============================================================
   PAYMENT
   ============================================================ */

create table public.payment (
  payment_id         uuid        primary key default gen_random_uuid(),
  order_id           uuid        not null references public.orders (order_id) on delete cascade,
  method             public.payment_method_type not null,
  payment_method_id  uuid        references public.payment_method (method_id) on delete set null,
  method_label       text        not null,             -- "Card ending 4242", "Pay at counter"
  amount             integer     not null check (amount >= 0),
  status             public.payment_status not null default 'pending',
  -- Staff-only (IR-03)
  provider_ref       text,
  failure_reason     text,
  authorized_at      timestamptz,
  captured_at        timestamptz,
  refunded_at        timestamptz,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  constraint refund_time check ((status = 'refunded') = (refunded_at is not null))
);
create index payment_order on public.payment (order_id);
create unique index payment_provider_ref on public.payment (provider_ref) where provider_ref is not null;
comment on table public.payment is 'SRS PAYMENT: attempts, captures and refunds. Refunds are recorded here; order totals never change.';

/* ============================================================
   ORDER_STATUS_EVENT / INTERNAL_NOTE
   ============================================================ */

create table public.order_status_event (
  event_id     bigint      generated always as identity primary key,
  order_id     uuid        not null references public.orders (order_id) on delete cascade,
  from_status  public.order_status,
  to_status    public.order_status,
  -- Delayed (flag) events have no status change
  is_delay     boolean     not null default false,
  new_eta      timestamptz,
  label        text        not null,
  actor_type   public.actor_type not null,
  staff_id     uuid        references public.staff_user (staff_id) on delete set null,
  actor_name   text,
  created_at   timestamptz not null default now()
);
create index order_status_event_order on public.order_status_event (order_id, created_at);
comment on table public.order_status_event is 'SRS ORDER_STATUS_EVENT: status history and audit trail of staff actions';

create table public.internal_note (
  note_id     bigint      generated always as identity primary key,
  order_id    uuid        not null references public.orders (order_id) on delete cascade,
  staff_id    uuid        references public.staff_user (staff_id) on delete set null,
  author_name text        not null,
  body        text        not null check (length(trim(body)) between 1 and 1000),
  created_at  timestamptz not null default now()
);
create index internal_note_order on public.internal_note (order_id);
comment on table public.internal_note is 'SRS INTERNAL_NOTE: staff only, never shown to customers (FR-STF-10, IR-03)';

/* ============================================================
   POINTS_TXN
   ============================================================ */

create table public.points_txn (
  txn_id              bigint      generated always as identity primary key,
  customer_id         uuid        not null references public.customer (customer_id) on delete cascade,
  type                public.points_txn_type not null,
  -- Signed: earn and restore add, redeem subtracts
  points              integer     not null,
  order_id            uuid        references public.orders (order_id) on delete set null,
  customer_reward_id  uuid        references public.customer_reward (customer_reward_id) on delete set null,
  description         text        not null,
  created_at          timestamptz not null default now(),
  constraint sign_matches_type check (
    (type = 'redeem' and points < 0) or (type in ('earn', 'restore') and points > 0)
  ),
  constraint earn_has_order check (type <> 'earn' or order_id is not null),
  constraint redeem_has_voucher check (type <> 'redeem' or customer_reward_id is not null)
);
-- FR-LOY-01 / IR-05: an order earns points once
create unique index points_earn_once on public.points_txn (order_id) where type = 'earn';
create index points_txn_customer on public.points_txn (customer_id, created_at desc);
comment on table public.points_txn is 'SRS POINTS_TXN: ledger; customer.points_balance always equals its sum';

/* ============================================================
   PROMOTION_REDEMPTION (addition)
   ============================================================ */

create table public.promotion_redemption (
  redemption_id  bigint      generated always as identity primary key,
  promotion_id   text        not null references public.promotion (promotion_id),
  customer_id    uuid        references public.customer (customer_id) on delete set null,
  order_id       uuid        not null unique references public.orders (order_id) on delete cascade,
  created_at     timestamptz not null default now()
);
create index promotion_redemption_lookup on public.promotion_redemption (promotion_id, customer_id);
comment on table public.promotion_redemption is 'Uses of a promotion; deleted when the order is cancelled so the use is given back (TBD-12)';

/* ============================================================
   NOTIFICATION / RESPONSE_TEMPLATE
   ============================================================ */

create table public.response_template (
  template_id     smallint    generated always as identity primary key,
  event           public.template_event not null unique,
  audience        public.template_audience not null default 'customer',
  name            text        not null,
  title           text        not null,
  channel         public.message_channel not null,
  body            text        not null,
  enabled         boolean     not null default true,
  -- FR-ART-06 / IR-07
  is_critical     boolean     not null default false,
  critical_reason text,
  last_edited_by  uuid        references public.staff_user (staff_id) on delete set null,
  last_edited_by_name text,
  last_edited_at  timestamptz not null default now(),
  -- IR-07: critical templates are always on
  constraint critical_always_enabled check (not is_critical or enabled),
  -- FR-ART-03: no empty text
  constraint body_not_empty check (length(trim(body)) > 0 and length(trim(title)) > 0),
  -- FR-ART-02: 160 characters for push
  constraint push_length check (channel <> 'push' or length(body) <= 160),
  -- FR-ART-03: only the known variables
  constraint known_variables check (
    regexp_replace(body, '\{(customer_name|order_number|pickup_time|cafe_name|reason|item_name)\}', '', 'g') !~ '[{}]'
  )
);
comment on table public.response_template is 'SRS RESPONSE_TEMPLATE: customer messages per order event and internal staff alerts';

create table public.notification (
  notification_id  uuid        primary key default gen_random_uuid(),
  customer_id      uuid        not null references public.customer (customer_id) on delete cascade,
  template_id      smallint    references public.response_template (template_id) on delete set null,
  order_id         uuid        references public.orders (order_id) on delete set null,
  title            text        not null,
  body             text        not null,
  -- FR-TRK-07: deep link to the order, reward or promotion
  deep_link        text        not null,
  channel          public.message_channel not null default 'in_app',
  pushed_at        timestamptz,
  read_at          timestamptz,
  created_at       timestamptz not null default now()
);
create index notification_customer on public.notification (customer_id, created_at desc);
comment on table public.notification is 'SRS NOTIFICATION: kept 90 days (SRS 3.8)';

/* ============================================================
   AUTOMATED_ORDER
   ============================================================ */

create table public.automated_order (
  automated_order_id  uuid        primary key default gen_random_uuid(),
  cafe_id             smallint    not null references public.store_settings (settings_id),
  -- AS-08 / TBD-07: e.g. "Recurring order", "Office pre-order", an integrated channel
  source              text        not null,
  rule                text        not null,
  customer_id         uuid        references public.customer (customer_id) on delete set null,
  customer_name       text        not null,
  customer_mobile     text,
  fulfillment         public.fulfillment_type not null default 'pickup',
  -- [{"item_id":"latte","options":["Hot · 12 oz"],"quantity":1}]
  contents            jsonb       not null check (jsonb_typeof(contents) = 'array'),
  state               public.automated_order_state not null default 'queued',
  failure_reason      text,
  -- FR-AOM-03: read-only system response, staff only (IR-03)
  system_response     text,
  error_code          text,
  customer_message    text,
  retries             integer     not null default 0 check (retries >= 0),
  -- FR-AOM-03: processing timeline [{"label":"Rule fired","at":"..."}]
  timeline            jsonb       not null default '[]' check (jsonb_typeof(timeline) = 'array'),
  -- FR-AOM-05
  linked_order_id     uuid        unique references public.orders (order_id) on delete set null,
  converted_by        uuid        references public.staff_user (staff_id) on delete set null,
  converted_at        timestamptz,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  constraint failed_has_reason check (state <> 'failed' or failure_reason is not null)
);
create index automated_order_state on public.automated_order (cafe_id, state, created_at desc);
comment on table public.automated_order is 'SRS AUTOMATED_ORDER: system-created orders and processing log (FR-AOM-01 to 05)';

/* ============================================================
   AUDIT_LOG / LOGIN_ATTEMPT (additions)
   ============================================================ */

create table public.audit_log (
  audit_id    bigint      generated always as identity primary key,
  actor_id    uuid,
  actor_type  public.actor_type not null,
  action      text        not null,
  entity      text        not null,
  entity_id   text        not null,
  before      jsonb,
  after       jsonb,
  created_at  timestamptz not null default now()
);
create index audit_log_entity on public.audit_log (entity, entity_id, created_at desc);
comment on table public.audit_log is 'NFR-SEC-06: staff status changes, cancellations, template and settings edits, with user and time';

create table public.login_attempt (
  identifier    text        not null,       -- normalized mobile number, email or username
  audience      public.login_audience not null,
  fail_count    integer     not null default 0 check (fail_count >= 0),
  locked_until  timestamptz,
  updated_at    timestamptz not null default now(),
  primary key (audience, identifier)
);
comment on table public.login_attempt is 'FR-ACC-07 / FR-STF-01 sign-in lockout. Read and written only by server functions.';
