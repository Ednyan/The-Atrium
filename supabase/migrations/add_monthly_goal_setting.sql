-- The monthly goal, as a value rather than a literal in a view.
--
-- It was 5000::bigint written into contributions_month, so moving it meant
-- editing SQL, pasting it into the dashboard, and remembering that the view
-- exists in two migration files. A number the operator changes as the project's
-- costs change should not be a deployment.
--
-- One row, enforced by the primary key being a boolean that must be true. That
-- is the cheapest way to say "there is exactly one of these" in Postgres: a
-- second insert collides on the key rather than quietly creating a second set
-- of settings for the view to pick between.

create table if not exists public.atrium_settings (
  id boolean primary key default true,
  monthly_goal_cents bigint not null default 5000,
  updated_at timestamptz not null default now(),
  constraint atrium_settings_single_row check (id)
);

insert into public.atrium_settings (id) values (true)
  on conflict (id) do nothing;

comment on table public.atrium_settings is
  'Single-row settings for the whole atrium. Read by contributions_month; written only by the moderate-contributors Edge Function.';

-- No client policies, deliberately.
--
-- Nothing in a browser needs to read this directly: the goal reaches the app
-- through contributions_month, which is security_invoker = false and so runs as
-- its owner -- meaning the view can read this table while RLS keeps every
-- client out of it. And nothing in a browser may write it: the operator's edit
-- goes through the Edge Function, which checks platform_admins first.
alter table public.atrium_settings enable row level security;

-- The view, now reading the setting.
--
-- Everything else about it is unchanged, and the part worth not breaking is the
-- month filter: created_at >= date_trunc('month', now()) is what makes this
-- month's total this month's, rather than a running sum of everything ever
-- given. A euro last month and a euro this month is one euro here, which is the
-- whole point of a monthly gauge.
create or replace view public.contributions_month
with (security_invoker = false) as
  select
    date_trunc('month', now()) as month_start,
    (select monthly_goal_cents from public.atrium_settings where id) as goal_cents,
    coalesce(sum(settled_eur_cents), 0)::bigint as total_cents,
    count(*)::bigint as contribution_count
  from public.contributions
  where livemode
    and not refunded
    and created_at >= date_trunc('month', now());

grant select on public.contributions_month to anon, authenticated;
