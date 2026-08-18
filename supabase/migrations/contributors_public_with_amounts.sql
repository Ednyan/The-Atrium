-- Rebuilds contributors_public as one row per contribution rather than one per
-- person, and includes the amount.
--
-- The original deliberately hid amounts: who gave most is not something this
-- app should rank. The contributors page changes that on purpose -- each
-- contribution is drawn as a trace showing the name, what was given and when,
-- coloured by size, the way an atrium shows its own traces. That only works if
-- the amount is there.
--
-- Worth being clear about what it costs: a one euro contribution now sits
-- visibly beside a fifty euro one. The consent text where someone chooses their
-- name says so, which it has to -- agreeing to be named is not agreeing to have
-- a figure attached.
--
-- Still nothing that isn't already public by intent: no email, no user id, no
-- Stripe identifiers, and only names a person has approved.

CREATE OR REPLACE VIEW public.contributors_public
WITH (security_invoker = false) AS
  SELECT
    trim(display_name) AS display_name,
    -- Euros, rounded. Cents on a wall of names is noise, and the page groups
    -- by size rather than reporting exact figures.
    round(settled_eur_cents / 100.0)::int AS amount_eur,
    kind = 'monthly' AS is_monthly,
    created_at
  FROM public.contributions
  WHERE livemode
    AND name_approved
    AND NOT refunded
    AND display_name IS NOT NULL
  ORDER BY created_at ASC;

GRANT SELECT ON public.contributors_public TO anon, authenticated;

COMMENT ON VIEW public.contributors_public IS 'One row per approved, live, unrefunded contribution: the name chosen, the euro amount, whether it is monthly, and when. Drives the contributors page.';
