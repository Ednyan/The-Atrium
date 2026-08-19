-- Telling a subscription that is running from one that has stopped.
--
-- Supersedes contributors_searchable.sql: run this instead, it creates both
-- views. contributors_public is now that view with an order and a limit on it,
-- so the two can't drift apart.
--
-- The problem it fixes: is_monthly was bool_or(kind = 'monthly'), which means
-- "has ever paid monthly" and never stops being true. Someone who cancelled in
-- 2026 kept a trace claiming they give 3 euros a month, with a light running
-- around it, for ever. Nothing recorded the cancellation because nothing could
-- -- customer.subscription.deleted was not handled, and the rows carry no
-- subscription id to match it against if it had been.
--
-- So it is derived from the payments instead, which turns out to be better than
-- the event would have been: a card that expires, a payment that fails until
-- Stripe gives up, and a deliberate cancellation all look identical here, and
-- all of them mean the same thing. It also works on rows already in the table,
-- which an event handler never could.
--
-- The cost is precision at the boundary. A subscription reads as running until
-- 40 days after its last payment -- a month, plus room for Stripe's retries --
-- so someone who cancels today keeps a running light for a few weeks. Nothing
-- about the money is affected: the monthly bar counts rows in the current
-- month, and a cancelled subscription simply stops writing them.

-- Monthly payments grouped into runs.
--
-- A gap of more than 40 days between two payments means the first subscription
-- ended and a second one began later. That matters because someone who
-- subscribes, stops, and comes back should read as giving their *new* rate
-- since their *new* start date, with everything from before counted as money
-- they have given rather than as part of what is running now.
CREATE OR REPLACE VIEW public.contributors_searchable
WITH (security_invoker = false) AS
WITH live AS (
  SELECT
    trim(display_name) AS name,
    kind,
    settled_eur_cents,
    created_at
  FROM public.contributions
  WHERE livemode
    AND name_approved
    AND NOT refunded
    AND display_name IS NOT NULL
),
monthly_marked AS (
  SELECT
    name,
    settled_eur_cents,
    created_at,
    CASE
      WHEN lag(created_at) OVER (PARTITION BY name ORDER BY created_at) IS NULL THEN 1
      WHEN created_at - lag(created_at) OVER (PARTITION BY name ORDER BY created_at) > interval '40 days' THEN 1
      ELSE 0
    END AS starts_run
  FROM live
  WHERE kind = 'monthly'
),
monthly_runs AS (
  SELECT
    name,
    settled_eur_cents,
    created_at,
    sum(starts_run) OVER (PARTITION BY name ORDER BY created_at) AS run
  FROM monthly_marked
),
-- The most recent run, and when it started and last collected.
latest_run AS (
  SELECT DISTINCT ON (name)
    name,
    started,
    last_paid
  FROM (
    SELECT name, run, min(created_at) AS started, max(created_at) AS last_paid
    FROM monthly_runs
    GROUP BY name, run
  ) runs
  ORDER BY name, last_paid DESC
),
-- What they pay now, which is the most recent monthly charge rather than the
-- largest one. Taking the largest meant someone who lowered their contribution
-- kept being shown at the old figure indefinitely.
current_rate AS (
  SELECT DISTINCT ON (name)
    name,
    settled_eur_cents AS rate_cents
  FROM monthly_runs
  ORDER BY name, created_at DESC
)
SELECT
  live.name AS display_name,

  -- Everything they have given, monthly and one-off alike. This is the only
  -- number that decides rank and position: a supporter who has paid 3 euros a
  -- month for two years has given 72 euros, and there is no reason that should
  -- count for less than 72 euros given at once.
  round(sum(live.settled_eur_cents) / 100.0)::int AS amount_eur,

  -- Has ever subscribed. Kept under its old name so that desktop apps built
  -- before this migration still colour these traces as monthly; what they lose
  -- is only the ability to tell running from ended.
  bool_or(live.kind = 'monthly') AS is_monthly,

  round(current_rate.rate_cents / 100.0)::int AS monthly_eur,

  -- For a running subscription, when *that* subscription began. Otherwise the
  -- first time they gave anything. Previously this was min() over everything,
  -- so a one-off in January followed by subscribing in August produced "3 euros
  -- a month since January" -- a sentence about a subscription that did not
  -- exist yet.
  CASE
    WHEN latest_run.last_paid > now() - interval '40 days' THEN latest_run.started
    ELSE min(live.created_at)
  END AS since,

  count(*)::int AS contribution_count,
  bool_or(live.kind = 'one_time') AS has_one_time,
  round(coalesce(sum(live.settled_eur_cents) FILTER (WHERE live.kind = 'one_time'), 0) / 100.0)::int AS one_time_eur,

  -- Appended. Whether a subscription is running right now, which is what
  -- decides if the light goes round the trace.
  coalesce(latest_run.last_paid > now() - interval '40 days', false) AS monthly_active
FROM live
LEFT JOIN latest_run ON latest_run.name = live.name
LEFT JOIN current_rate ON current_rate.name = live.name
GROUP BY live.name, current_rate.rate_cents, latest_run.started, latest_run.last_paid;

GRANT SELECT ON public.contributors_searchable TO anon, authenticated;

COMMENT ON VIEW public.contributors_searchable IS 'Every approved contributor, uncapped, for name search. contributors_public is this ordered and capped.';

-- The wall: the same rows, largest first, capped at what is worth downloading.
--
-- Defined in terms of the other one, so the aggregation is written once. Note
-- that SELECT * is expanded when the view is created, not when it is queried:
-- adding a column to contributors_searchable later means re-running this
-- statement too, which is why both live in one migration.
--
-- The cap is about the payload, not the drawing -- how many traces are on
-- screen is decided by the zoom -- and anyone past the end is still found by
-- name through the uncapped view above.
CREATE OR REPLACE VIEW public.contributors_public
WITH (security_invoker = false) AS
  SELECT *
  FROM public.contributors_searchable
  ORDER BY amount_eur DESC, since DESC
  LIMIT 10000;

GRANT SELECT ON public.contributors_public TO anon, authenticated;

COMMENT ON VIEW public.contributors_public IS 'One row per approved contributor: everything given, the current monthly rate if a subscription is running, and when it started. Capped at 10000, largest first.';
