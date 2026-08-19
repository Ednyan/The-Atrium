-- Everyone, for searching -- including the ones the wall has no room to draw.
--
-- contributors_public stops at 2000 rows because that is roughly what can be
-- drawn and panned without the page turning to treacle. The rule for who falls
-- off is the least unfair one available -- smallest first, then oldest -- but it
-- still means someone who gave 3 euros in 2019 eventually stops appearing, and
-- from where they are sitting that is indistinguishable from having been
-- removed.
--
-- They were never removed. Every contribution is still in the table and still in
-- every total. This view is the same aggregation with no limit on it, queried by
-- name and a handful of rows at a time, so that searching finds them and the
-- page can say so.
--
-- Public for the same reason the capped one is: it is a list of names people
-- asked to be listed under. The cap was about what a browser can draw, never
-- about what anyone is allowed to know.

CREATE OR REPLACE VIEW public.contributors_searchable
WITH (security_invoker = false) AS
  SELECT
    trim(display_name) AS display_name,
    round(sum(settled_eur_cents) / 100.0)::int AS amount_eur,
    bool_or(kind = 'monthly') AS is_monthly,
    round(max(settled_eur_cents) FILTER (WHERE kind = 'monthly') / 100.0)::int AS monthly_eur,
    min(created_at) AS since,
    count(*)::int AS contribution_count,
    bool_or(kind = 'one_time') AS has_one_time,
    round(coalesce(sum(settled_eur_cents) FILTER (WHERE kind = 'one_time'), 0) / 100.0)::int AS one_time_eur
  FROM public.contributions
  WHERE livemode
    AND name_approved
    AND NOT refunded
    AND display_name IS NOT NULL
  GROUP BY trim(display_name);

GRANT SELECT ON public.contributors_searchable TO anon, authenticated;

COMMENT ON VIEW public.contributors_searchable IS 'Every approved contributor, uncapped, for name search. Same shape as contributors_public, which is this with a 2000-row limit for drawing.';
