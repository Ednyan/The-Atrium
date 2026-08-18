-- Lets the operator take a contribution off the wall without erasing it.
--
-- Distinct from name_approved, which means "not yet judged" or "refused before
-- it ever appeared". Hidden means it was shown, and then taken down -- a
-- different fact, and one worth being able to reverse.
--
-- It still counts. The money arrived and the month's total is a record of what
-- arrived, not of whose name is currently displayed. Only the wall changes.
-- Removing the money is what delete is for, and delete removes the row.

ALTER TABLE public.contributions
  ADD COLUMN IF NOT EXISTS hidden boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.contributions.hidden IS 'Taken off the contributors wall by the operator after approval. Still counted in the totals -- the money arrived regardless of whether the name is shown.';

DROP VIEW IF EXISTS public.contributors_public;

CREATE VIEW public.contributors_public
WITH (security_invoker = false) AS
  SELECT
    trim(display_name) AS display_name,
    round(sum(settled_eur_cents) / 100.0)::int AS amount_eur,
    bool_or(kind = 'monthly') AS is_monthly,
    round(max(settled_eur_cents) FILTER (WHERE kind = 'monthly') / 100.0)::int AS monthly_eur,
    min(created_at) AS since,
    count(*)::int AS contribution_count
  FROM public.contributions
  WHERE livemode
    AND name_approved
    AND NOT hidden
    AND NOT refunded
    AND display_name IS NOT NULL
  GROUP BY trim(display_name)
  ORDER BY sum(settled_eur_cents) DESC, max(created_at) DESC
  LIMIT 2000;

GRANT SELECT ON public.contributors_public TO anon, authenticated;
