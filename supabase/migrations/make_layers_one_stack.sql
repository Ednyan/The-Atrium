-- Groups and loose traces as one stack (see src/lib/order.ts).
--
-- Until now a trace in no group was ordered only among the other loose
-- traces, all of them drawn under every group, and a group only among the
-- groups -- both counted from the same first key. Now they are one stack, as
-- in Photoshop, so a loose trace can sit between two groups, and new traces go
-- on top of all of it.
--
-- For every atrium to look as it did, its groups are lifted above its loose
-- traces: each group gets a key above the highest loose trace's, in the
-- groups' order, and a loose trace with no valid key one just under the groups,
-- where it was drawn. flattenLegacyOrder in order.ts does the same for desktop
-- vaults and older files. A trace whose group no longer exists counts as
-- loose, as the app draws it.
--
-- Run before the web build that uses it deploys. Safe to run twice: it notes
-- itself in app_changes and does nothing once noted -- which matters, because
-- lifting the groups again would lift them over loose traces people have put
-- above them since.

create table if not exists public.app_changes (
  name text primary key,
  done_at timestamptz not null default now()
);
-- Nobody's to read or write it from the app; the SQL editor bypasses this.
alter table public.app_changes enable row level security;

do $$
begin
  if exists (select 1 from public.app_changes where name = 'flat_layers') then
    raise notice 'flat_layers: already done';
    return;
  end if;

  with loose as (
    select t.id, t.lobby_id, t.order_key as k
    from public.traces t
    where not exists (select 1 from public.layers g where g.id = t.layer_id and g.lobby_id = t.lobby_id)
  ),
  -- isValidOrderKey: base-62 digits, an integer part as long as its first
  -- character says (a-z: 2 to 27, A-Z: 27 down to 2), and a fraction not
  -- ending in 0.
  checked as (
    select id, lobby_id, k,
      k is not null
        and k collate "C" ~ '^[0-9A-Za-z]+$'
        and k <> 'A' || repeat('0', 26)
        and case
              when ascii(k) between 97 and 122 then length(k) >= ascii(k) - 95 and (length(k) = ascii(k) - 95 or right(k, 1) <> '0')
              when ascii(k) between 65 and 90 then length(k) >= 92 - ascii(k) and (length(k) = 92 - ascii(k) or right(k, 1) <> '0')
              else false
            end as valid
    from loose
  ),
  -- Atriums with both groups and loose traces, and the top loose key in each.
  -- 'a0' (the first key) when none of them has a valid key.
  stacks as (
    select c.lobby_id, coalesce(max(c.k collate "C") filter (where c.valid), 'a0') as top
    from checked c
    where exists (select 1 from public.layers g where g.lobby_id = c.lobby_id)
    group by c.lobby_id
  ),
  -- Keys above `top`: it with a fraction added, which sorts after it. 'M' for
  -- the unkeyed loose traces, then 'V' for the groups, then three digits of
  -- their rank, the last never 0 -- in order up to 234,484 of each.
  unkeyed as (
    select c.id, s.top, row_number() over (partition by c.lobby_id order by c.id::text collate "C") - 1 as r
    from checked c join stacks s on s.lobby_id = c.lobby_id
    where not c.valid
  ),
  groups as (
    select g.id, s.top,
      row_number() over (partition by g.lobby_id order by (g.order_key is null), g.order_key collate "C", g.id::text collate "C") - 1 as r
    from public.layers g join stacks s on s.lobby_id = g.lobby_id
  ),
  lifted_traces as (
    update public.traces t
    set order_key = u.top || 'M'
      || substr('0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz', ((u.r / 3782) % 62)::int + 1, 1)
      || substr('0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz', ((u.r / 61) % 62)::int + 1, 1)
      || substr('0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz', (u.r % 61)::int + 2, 1)
    from unkeyed u
    where t.id = u.id
    returning 1
  )
  update public.layers l
  set order_key = g.top || 'V'
    || substr('0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz', ((g.r / 3782) % 62)::int + 1, 1)
    || substr('0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz', ((g.r / 61) % 62)::int + 1, 1)
    || substr('0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz', (g.r % 61)::int + 2, 1)
  from groups g
  where l.id = g.id;

  insert into public.app_changes (name) values ('flat_layers');
end $$;
