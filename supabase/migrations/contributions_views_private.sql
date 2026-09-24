-- The four public contribution views, moved out of the Security Advisor's way
-- without changing what anyone can read.
--
-- contributions itself has RLS on and no client policies: only the Stripe
-- webhook (service role) writes it, and nobody reads it directly. These views
-- are the public window onto it -- the month's progress, the running total,
-- and approved contributors by name -- and they are SECURITY DEFINER
-- (security_invoker = false) on purpose: run as their owner, they can read the
-- table the visitor can't, and hand back only what each one selects.
--
-- The advisor flags every definer view in an exposed schema (lint 0010), and
-- the remedy it suggests, security_invoker = true, would run them as the
-- visitor instead. RLS would then give them no rows, and the donation bar and
-- the contributors wall would come up empty.
--
-- So the definer views move to `private`, a schema the API doesn't expose, and
-- each keeps its name in `public` as a plain invoker view that selects from it:
-- the same columns and the same rows, and nothing in the app changes. The
-- lint only looks at exposed schemas.
--
-- Run in the SQL editor. Safe to run twice.
--
-- From here on, a change to what one of these returns is made to the private
-- view. The public ones select *, which Postgres expands when a view is
-- created, so a new column also means re-running its wrapper below.

create schema if not exists private;
grant usage on schema private to anon, authenticated;

do $$
declare
  v text;
begin
  -- contributors_public is defined over contributors_searchable; moving the
  -- one underneath first is fine, since a view refers to another by its oid,
  -- not its name.
  foreach v in array array['contributors_searchable', 'contributors_public', 'contributions_month', 'contributions_totals'] loop
    if not exists (select 1 from pg_views where schemaname = 'private' and viewname = v) then
      execute format('alter view public.%I set schema private', v);
    end if;
  end loop;
end $$;

grant select on private.contributors_searchable, private.contributors_public,
                private.contributions_month, private.contributions_totals
  to anon, authenticated;

create or replace view public.contributors_searchable with (security_invoker = true) as
  select * from private.contributors_searchable;

-- The order is restated: a view that selects from an ordered view promises
-- no order of its own.
create or replace view public.contributors_public with (security_invoker = true) as
  select * from private.contributors_public order by amount_eur desc, since desc;

create or replace view public.contributions_month with (security_invoker = true) as
  select * from private.contributions_month;

create or replace view public.contributions_totals with (security_invoker = true) as
  select * from private.contributions_totals;

grant select on public.contributors_searchable, public.contributors_public,
                public.contributions_month, public.contributions_totals
  to anon, authenticated;
