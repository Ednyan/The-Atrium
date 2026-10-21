-- Contributions added by hand, and whether a contribution's money counts.
--
-- The operator can add a contribution by hand (moderate-contributors, 'add'):
-- a payment that came some other way, or a name for someone whose payment
-- arrived without one. The second is the reason this column exists. That
-- person's money is already in the month, on an anonymous row; their name
-- goes on the wall as a new row carrying what they gave, and that row must
-- not put the same money on the bar a second time.
--
-- So: counts_toward_goal. True for everything Stripe writes, and by default.
-- False keeps a row's money out of the month and the all-time totals -- the
-- two places money is added up -- while the wall still shows the name with
-- its amount, as it shows anyone's.
--
-- Added by hand is not a column: it is a row with no stripe_event_id, which
-- every webhook-written row has.
--
-- Safe to run twice.

alter table public.contributions
  add column if not exists counts_toward_goal boolean not null default true;

-- The two views that add money up, redefined with the new filter -- wherever
-- they live. contributions_views_private.sql moves them into the `private`
-- schema behind invoker wrappers in `public`; if it has been run, the definer
-- views are there, otherwise still in `public`. Same columns either way, so
-- the wrappers (select * from private.…) keep working untouched.
do $$
declare
  home text := case
    when exists (select 1 from pg_views where schemaname = 'private' and viewname = 'contributions_month') then 'private'
    else 'public'
  end;
begin
  execute format($view$
    create or replace view %I.contributions_month
    with (security_invoker = false) as
      select
        date_trunc('month', now()) as month_start,
        (select monthly_goal_cents from public.atrium_settings where id) as goal_cents,
        coalesce(sum(settled_eur_cents), 0)::bigint as total_cents,
        count(*)::bigint as contribution_count
      from public.contributions
      where livemode
        and not refunded
        and counts_toward_goal
        and created_at >= date_trunc('month', now())
  $view$, home);

  execute format($view$
    create or replace view %I.contributions_totals
    with (security_invoker = false) as
      select
        coalesce(sum(settled_eur_cents), 0)::bigint as total_cents,
        count(*)::bigint as contribution_count
      from public.contributions
      where livemode
        and not refunded
        and counts_toward_goal
  $view$, home);

  execute format('grant select on %I.contributions_month, %I.contributions_totals to anon, authenticated', home, home);
end $$;
