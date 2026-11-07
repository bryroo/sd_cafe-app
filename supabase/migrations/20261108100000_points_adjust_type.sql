-- A points adjustment (staff or demo correction), in addition to SRS 3.4.7's earn, redeem and restore.
-- On its own: Postgres can't use a new enum value in the transaction that adds it.
alter type public.points_txn_type add value if not exists 'adjust';
