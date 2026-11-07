-- MEGS' Cafe: reference data
-- The SRS baselines (Appendix A.2) and the prototype's samples. Every value here is data, so the cafe
-- can change it without an app release (NFR-MNT-01, NFR-MNT-02). Items marked TBD await confirmation.

/* ----- STORE_SETTINGS: the one location served at launch ----- */
insert into public.store_settings (cafe_name, opening_hours, default_prep_minutes, delivery_eta_minutes, delivery_enabled, delivery_fee)
values (
  'MEGS'' Cafe',
  -- Sunday first, Asia/Manila
  (select jsonb_agg(jsonb_build_object('open', '07:00', 'close', '21:00', 'closed', false)) from generate_series(1, 7)),
  10,
  35,
  true,
  2500  -- AS-02 / TBD-05: flat ₱25
);

/* ----- TIER (AS-04, TBD-02: thresholds and Loyal discount are working assumptions) ----- */
insert into public.tier (name, rank, discount_pct, qualify_orders, qualify_days, description, is_default) values
  ('Regular', 1, 5.00, null, null, 'Every member starts here. 5% off every order.', true),
  ('Loyal',   2, 10.00, 10, 90, 'Complete 10 orders in 90 days. 10% off every order. (TBD-02)', false);

/* ----- RESPONSE_TEMPLATE (FR-ART-01, FR-ART-06) ----- */
insert into public.response_template (event, audience, name, title, channel, body, is_critical, critical_reason, last_edited_by_name) values
  ('order_received',          'customer', 'Order received',          'We got your order',        'in_app', 'Hi {customer_name}, we got order #{order_number}. We will let you know when the cafe accepts it.', false, null, 'MEGS setup'),
  ('order_accepted',          'customer', 'Order accepted',          'Order accepted',           'push',   'Order #{order_number} is accepted. Ready in about {pickup_time}.', true, 'Customers need to know the cafe has their order.', 'MEGS setup'),
  ('order_preparing',         'customer', 'Preparing',               'Preparing your order',     'in_app', 'We''re preparing order #{order_number}.', false, null, 'MEGS setup'),
  ('order_ready_pickup',      'customer', 'Order ready (pickup)',    'Your order is ready',      'push',   'Order #{order_number} is ready at the counter. See you at {cafe_name}!', true, 'Customers need to know when to collect.', 'MEGS setup'),
  ('order_ready_delivery',    'customer', 'Order ready (delivery)',  'Your order is on the way', 'push',   'Order #{order_number} is on its way to you.', true, 'Customers need to know their order is on the way.', 'MEGS setup'),
  ('order_completed',         'customer', 'Order completed',         'Thanks! Enjoy.',           'in_app', 'Order #{order_number} is complete. Your points have been added.', false, null, 'MEGS setup'),
  ('order_cancelled_cafe',    'customer', 'Cancelled by cafe',       'Order cancelled',          'push',   'Sorry {customer_name}, we had to cancel order #{order_number}: {reason}.', true, 'Customers must hear when the cafe cancels.', 'MEGS setup'),
  ('order_cancelled_customer','customer', 'Cancelled by customer',   'Order cancelled',          'push',   'You cancelled order #{order_number}.', false, null, 'MEGS setup'),
  ('order_delayed',           'customer', 'Order delayed',           'Taking a bit longer',      'push',   'Order #{order_number} is taking a bit longer. New estimate: about {pickup_time}.', true, 'Customers need the new estimate.', 'MEGS setup'),
  ('item_unavailable',        'customer', 'Item unavailable',        'An item ran out',          'push',   'Sorry, {item_name} ran out for order #{order_number}. The cafe will contact you.', false, null, 'MEGS setup'),
  ('payment_failed',          'customer', 'Payment failed',          'Payment didn''t go through','push',  'Payment for order #{order_number} didn''t go through. You haven''t been charged.', false, null, 'MEGS setup'),
  -- FR-ART-07: internal staff alerts, listed separately
  ('staff_new_order',         'staff',    'New order',               'New order',                'in_app', 'New order #{order_number} from {customer_name}.', false, null, 'MEGS setup'),
  ('staff_automation_failed', 'staff',    'Automated order failed',  'Automated order failed',   'in_app', 'An automated order for {customer_name} failed: {reason}.', false, null, 'MEGS setup'),
  ('staff_order_waiting',     'staff',    'Order waiting',           'Order waiting',            'in_app', 'Order #{order_number} has been waiting for {pickup_time}.', false, null, 'MEGS setup');

/* ----- REWARD (TBD-01, TBD-13: sample catalog on the real menu, 120-400 pts) ----- */
insert into public.reward (reward_id, name, cost_pts, terms, eligible_items, goal_label, sort_order) values
  ('free-drink', 'Free any drink', 250,
    array['Valid for 30 days after you redeem it.', 'At checkout, the cheapest drink in your order is 100% off, any size.', 'One reward per order. Cannot be combined with another reward.'],
    '[{"label": "a drink", "kind": "drink"}]', 'a free drink', 1),
  ('free-pastry', 'Free snack', 120,
    array['Valid for 30 days after you redeem it.', 'At checkout, the cheapest snack in your order (fries, cheese con fries or nachos) is 100% off.', 'One reward per order. Cannot be combined with another reward.'],
    '[{"label": "a snack", "categories": ["snacks"]}]', 'a free snack', 2),
  ('drink-pastry', 'Free drink + snack', 400,
    array['Valid for 30 days after you redeem it.', 'At checkout, the cheapest drink and the cheapest snack in your order are 100% off.', 'One reward per order. Cannot be combined with another reward.'],
    '[{"label": "a drink", "kind": "drink"}, {"label": "a snack", "categories": ["snacks"]}]', 'a free drink and snack', 3),
  ('cold-brew', 'Free rice meal', 300,
    array['Valid for 30 days after you redeem it.', 'At checkout, the cheapest rice meal in your order is 100% off.', 'One reward per order. Cannot be combined with another reward.'],
    '[{"label": "a rice meal", "categories": ["rice-meals"]}]', 'a free rice meal', 4);

/* ----- PROMOTION (TBD-12, TBD-13). Dates are Asia/Manila. ----- */
insert into public.promotion (promotion_id, title, description, starts_at, ends_at, terms, rule, code, usage_limit, is_one_time, target_category_id, target_item_id, is_featured) values
  ('fries-with-rice-meal', 'Free plain fries with any rice meal',
    'Order any rice meal and get a serving of plain potato fries on us.',
    '2026-10-01 00:00+08', '2026-11-30 23:59:59+08',
    array['One free fries per rice meal.', 'Pickup and delivery.', 'Cannot be combined with another promotion.'],
    '{"type": "free_item_with", "free_item_id": "potato-fries-plain", "with_category_ids": ["rice-meals"]}',
    null, null, false, 'rice-meals', null, true),
  ('oat-swap', 'Free oat milk swap on coffee',
    'Switch any coffee-based drink to oat milk at no extra charge (usually +₱50).',
    '2026-10-01 00:00+08', '2026-11-15 23:59:59+08',
    array['Coffee-based drinks only.', 'Any size.', 'Cannot be combined with another promotion.'],
    '{"type": "free_option", "option_label": "Oat milk", "category_ids": ["espresso", "strong-coffee", "caramel"]}',
    null, null, false, 'espresso', null, false),
  ('matcha-22', '₱10 off any 22 oz matcha',
    'Every drink in the Matcha Series is ₱10 off in the 22 oz size.',
    '2026-10-01 00:00+08', '2026-11-10 23:59:59+08',
    array['Matcha Series, cold 22 oz only.', 'No limit per order.', 'Cannot be combined with another promotion.'],
    '{"type": "amount_off_option", "amount": 1000, "option_label": "Cold · 22 oz", "category_ids": ["matcha"]}',
    null, null, false, 'matcha', null, false),
  ('biscoff-launch', 'Biscoff Latte launch: ₱20 off',
    'Our new Biscoff Latte, ₱20 off in any size for its first week.',
    '2026-09-28 00:00+08', '2026-10-05 23:59:59+08',
    array['Biscoff Latte only.', 'One per order.', 'Cannot be combined with another promotion.'],
    '{"type": "amount_off_item", "amount": 2000, "item_ids": ["biscoff-latte"], "max_units": 1}',
    null, null, false, 'espresso', 'biscoff-latte', false),
  ('welcome-10', 'Welcome: 10% off your first order',
    'A thank-you for joining MEGS'' Cafe: 10% off your first order in the app.',
    '2026-01-01 00:00+08', '2027-12-31 23:59:59+08',
    array['First app order only.', 'Up to ₱100 off.', 'Cannot be combined with another promotion.'],
    '{"type": "percent_after_tier", "percent": 10, "max_discount": 10000, "first_order_only": true}',
    null, null, true, null, null, false),
  -- FR-CHK-05 / TBD-12: 10% off after the tier discount, minimum spend ₱200, once per customer
  ('promo-megs10', 'Promo MEGS10',
    '10% off your order after the Regular discount.',
    '2026-10-01 00:00+08', '2027-06-30 23:59:59+08',
    array['Minimum spend ₱200.', 'One use per customer.', 'Replaces the automatic offer.', 'Returned if the order is cancelled.'],
    '{"type": "percent_after_tier", "percent": 10, "min_spend": 20000}',
    'MEGS10', null, true, null, null, false);
