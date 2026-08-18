-- One row per contributor rather than per payment.
--
-- Per-payment was wrong in both directions. Someone giving 5 euros a month
-- became twelve identical traces within a year, so the wall filled with
-- duplicates of the most loyal people -- the opposite of honouring them. And
-- three separate one-off gifts from the same person are one relationship, not
-- three entries competing with each other.
--
-- So everything a name has given is summed into a single trace. A monthly
-- supporter also carries their rate and the date they started, because "5 euros
-- a month since March" says something a running total doesn't.
--
-- Grouped by the name itself, which is the only identity here: contributing
-- needs no account, so there is no user id to group by for most rows. Two
-- different people choosing the same name would merge, which is a real
-- limitation and an acceptable one -- names are approved by hand, and that is
-- the moment to notice a collision.

CREATE OR REPLACE VIEW public.contributors_public
WITH (security_invoker = false) AS
  SELECT
    trim(display_name) AS display_name,
    -- Everything they have given, in euros.
    round(sum(settled_eur_cents) / 100.0)::int AS amount_eur,
    bool_or(kind = 'monthly') AS is_monthly,
    -- The current monthly rate, taken as the largest monthly charge: a rate
    -- that has changed should read as the one they are on now, and nobody
    -- lowers a contribution and expects the old figure shown.
    round(max(settled_eur_cents) FILTER (WHERE kind = 'monthly') / 100.0)::int AS monthly_eur,
    min(created_at) AS since,
    count(*)::int AS contribution_count
  FROM public.contributions
  WHERE livemode
    AND name_approved
    AND NOT refunded
    AND display_name IS NOT NULL
  GROUP BY trim(display_name)
  -- The cap keeps the page drawable. Nothing is deleted -- every contribution
  -- stays in the table and in the totals -- but the wall shows the largest
  -- first and, among equals, the most recent. Small and old is what falls off
  -- the end, which is the least unfair rule available when something has to.
  ORDER BY sum(settled_eur_cents) DESC, max(created_at) DESC
  LIMIT 2000;

GRANT SELECT ON public.contributors_public TO anon, authenticated;

COMMENT ON VIEW public.contributors_public IS 'One row per approved contributor: everything they have given, their monthly rate if any, and when they started. Capped at 2000, largest first.';
