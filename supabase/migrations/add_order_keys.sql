-- Stacking order by order keys (see src/lib/order.ts).
--
-- A trace's order_key places it among the traces of its own group (or among
-- the ungrouped ones); a group's places it among the atrium's groups. Moving
-- either is then one row, where the old z_index -- group * 100 + position --
-- meant rewriting every trace in every group that moved.
--
-- Run before the web build that uses it deploys: every trace save carries
-- order_key, and without the column Postgres refuses them. Safe to run twice:
-- only rows without a key are given one.

alter table public.traces add column if not exists order_key text;
alter table public.layers add column if not exists order_key text;

-- New groups no longer give a z_index; it stays for older exports.
alter table public.layers alter column z_index set default 0;

-- Existing rows keyed from where they are now: "c" and three base-62 digits of
-- their rank, which sort the same way the ranks do and are valid keys to put
-- new ones between (up to 238,328 in one group).
with ranked as (
  select id,
         row_number() over (partition by lobby_id, layer_id order by z_index, created_at, id) - 1 as n
  from public.traces
  where order_key is null
)
update public.traces t
set order_key = 'c'
  || substr('0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz', ((r.n / 3844) % 62)::int + 1, 1)
  || substr('0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz', ((r.n / 62) % 62)::int + 1, 1)
  || substr('0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz', (r.n % 62)::int + 1, 1)
from ranked r
where t.id = r.id;

with ranked as (
  select id,
         row_number() over (partition by lobby_id order by z_index, created_at, id) - 1 as n
  from public.layers
  where order_key is null
)
update public.layers l
set order_key = 'c'
  || substr('0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz', ((r.n / 3844) % 62)::int + 1, 1)
  || substr('0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz', ((r.n / 62) % 62)::int + 1, 1)
  || substr('0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz', (r.n % 62)::int + 1, 1)
from ranked r
where l.id = r.id;
