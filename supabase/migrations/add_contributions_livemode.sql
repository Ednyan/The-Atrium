-- Adds contributions.livemode to a database where add_contributions.sql was
-- applied before that column existed.
--
-- Needed as its own file because re-running the original would not fix it:
-- CREATE TABLE IF NOT EXISTS sees the table and skips the whole definition, so
-- the missing column stays missing while the script reports success.
--
-- Without this the webhook inserts a column that isn't there, every payment
-- fails with a 500, and Stripe retries each one for days while nothing is ever
-- recorded. Safe to run on a database that already has the column.

ALTER TABLE public.contributions
  ADD COLUMN IF NOT EXISTS livemode boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.contributions.livemode IS 'Stripe live mode rather than test. One database sits behind both, so test payments write rows exactly like real ones; the public views count only live rows.';

-- The views were created without this filter, so they would count test
-- payments. CREATE OR REPLACE keeps their permissions.
CREATE OR REPLACE VIEW public.contributors_public
WITH (security_invoker = false) AS
  SELECT
    trim(display_name) AS display_name,
    bool_or(kind = 'monthly') AS is_monthly,
    min(created_at) AS first_contributed_at
  FROM public.contributions
  WHERE livemode
    AND name_approved
    AND NOT refunded
    AND display_name IS NOT NULL
  GROUP BY trim(display_name)
  ORDER BY min(created_at) ASC;

CREATE OR REPLACE VIEW public.contributions_month
WITH (security_invoker = false) AS
  SELECT
    date_trunc('month', now()) AS month_start,
    5000::bigint AS goal_cents,
    coalesce(sum(settled_eur_cents), 0)::bigint AS total_cents,
    count(*)::bigint AS contribution_count
  FROM public.contributions
  WHERE livemode
    AND NOT refunded
    AND created_at >= date_trunc('month', now());

CREATE OR REPLACE VIEW public.contributions_totals
WITH (security_invoker = false) AS
  SELECT
    coalesce(sum(settled_eur_cents), 0)::bigint AS total_cents,
    count(*)::bigint AS contribution_count
  FROM public.contributions
  WHERE livemode
    AND NOT refunded;

DROP INDEX IF EXISTS public.contributions_public_idx;
CREATE INDEX IF NOT EXISTS contributions_public_idx
  ON public.contributions (livemode, name_approved, refunded);

GRANT SELECT ON public.contributors_public TO anon, authenticated;
GRANT SELECT ON public.contributions_month TO anon, authenticated;
GRANT SELECT ON public.contributions_totals TO anon, authenticated;
