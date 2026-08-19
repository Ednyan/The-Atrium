-- Telling apart the three kinds of contributor.
--
-- The wall already knew whether someone had ever given monthly. It did not know
-- whether they had *also* given a one-off, and those are three different people
-- worth drawing differently: someone who gave once, someone who subscribes, and
-- someone who did both.
--
-- Until now the third became indistinguishable from the second -- is_monthly is
-- a bool_or, so a single subscription payment turned the whole trace purple and
-- erased the rank they had reached by giving. A person who gave 80 euros once
-- and then subscribed at 3 a month read as an ordinary monthly supporter.
--
-- Replaced rather than dropped: CREATE OR REPLACE VIEW can append columns to the
-- end of a view, and appending is all this does. Nothing existing moves, so the
-- grants stay and clients built against the old shape keep working unchanged --
-- which matters here, because installed desktop apps are exactly that.

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
    count(*)::int AS contribution_count,

    -- New, appended. Whether any of this was a one-off, and how much of it was.
    --
    -- Both, rather than only the flag: the rank a trace is drawn at could
    -- reasonably be read from either the total or the one-off part alone, and
    -- having the number here means that decision can change in the client
    -- without another migration.
    bool_or(kind = 'one_time') AS has_one_time,
    round(coalesce(sum(settled_eur_cents) FILTER (WHERE kind = 'one_time'), 0) / 100.0)::int AS one_time_eur
  FROM public.contributions
  WHERE livemode
    AND name_approved
    AND NOT refunded
    AND display_name IS NOT NULL
  GROUP BY trim(display_name)
  -- The cap is about the payload, not the drawing. How many traces are on
  -- screen is decided by the zoom -- roughly 90 at 1:1 and 1400 zoomed all the
  -- way out, whatever the cap is -- so raising this does not put more elements
  -- in the document, it only makes the spiral wider. What it does cost is the
  -- download and the copy the desktop app keeps for working offline: ten
  -- thousand rows is about 1.7 MB of each.
  --
  -- Nothing is deleted either way. Every contribution stays in the table and in
  -- every total, the wall shows the largest first and, among equals, the most
  -- recent, and anyone past the end is still found by name through
  -- contributors_searchable.
  ORDER BY sum(settled_eur_cents) DESC, max(created_at) DESC
  LIMIT 10000;

COMMENT ON VIEW public.contributors_public IS 'One row per approved contributor: everything they have given, their monthly rate if any, whether they also gave one-off, and when they started. Capped at 10000, largest first.';
