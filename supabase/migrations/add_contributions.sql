-- Donations, and the two public things they drive: the contributors list and
-- the progress bar on the welcome screen.
--
-- One row per completed payment, written only by the Stripe webhook using the
-- service role. Nothing here is insertable or updatable from the client -- an
-- amount the browser could write is an amount anyone can invent, and both the
-- list and the bar are only worth showing if they can't be faked.

CREATE TABLE IF NOT EXISTS public.contributions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Cents, never a float: 1.15 isn't representable in binary floating point and
  -- money that drifts is worse than money that's awkward to read.
  amount_cents integer NOT NULL CHECK (amount_cents > 0),
  currency text NOT NULL DEFAULT 'eur',

  -- 'one_time' or 'monthly'. A monthly supporter writes one row per successful
  -- charge, so the bar counts what actually arrived rather than what was
  -- promised.
  kind text NOT NULL DEFAULT 'one_time' CHECK (kind IN ('one_time', 'monthly')),

  -- Who to thank, as they asked to be thanked. Null means they chose not to
  -- appear -- which is not the same as an empty string, and is why this is
  -- nullable rather than defaulted.
  display_name text CHECK (display_name IS NULL OR char_length(trim(display_name)) BETWEEN 1 AND 40),

  -- A name is checked automatically when it's typed, then by a person before it
  -- goes on the welcome screen. Nothing reaches the public list on the strength
  -- of the automatic check alone: it catches the obvious and is not a substitute
  -- for looking.
  name_approved boolean NOT NULL DEFAULT false,
  name_rejected_reason text,

  -- Nullable on purpose: donating shouldn't require an account, and the
  -- contributor may not have one. Set when the payment can be tied to a user.
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,

  -- Where to write if a chosen name can't be published. From Stripe, not from
  -- the client.
  contact_email text,

  -- Stripe's own id, unique so a webhook delivered twice -- which Stripe does
  -- by design, and which is the normal case rather than the exception -- can't
  -- count the same payment twice.
  stripe_event_id text UNIQUE,
  stripe_payment_id text,

  -- Refunds and chargebacks. Kept as a row rather than deleted, so the history
  -- stays honest, and excluded from every public total below.
  refunded boolean NOT NULL DEFAULT false,

  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS contributions_created_at_idx ON public.contributions (created_at DESC);
CREATE INDEX IF NOT EXISTS contributions_public_idx ON public.contributions (name_approved, refunded);

ALTER TABLE public.contributions ENABLE ROW LEVEL SECURITY;

-- No policies for anon or authenticated at all. With RLS on and nothing
-- granted, the table is unreadable and unwritable from the client; the service
-- role bypasses RLS and is what the webhook uses. Everything public goes
-- through the two views below instead, so a column added here later can't
-- accidentally become public by being added to a SELECT policy nobody re-read.

-- What the welcome screen shows: approved names and nothing else. No amounts --
-- who gave the most is not a thing this app should publish, and knowing it
-- isn't why anyone reads the list.
CREATE OR REPLACE VIEW public.contributors_public
WITH (security_invoker = false) AS
  SELECT
    trim(display_name) AS display_name,
    -- A monthly supporter is one entry, not one per charge.
    bool_or(kind = 'monthly') AS is_monthly,
    min(created_at) AS first_contributed_at
  FROM public.contributions
  WHERE name_approved
    AND NOT refunded
    AND display_name IS NOT NULL
  GROUP BY trim(display_name)
  ORDER BY min(created_at) ASC;

-- The bar. Net of refunds, and per currency, since adding euros to dollars
-- would be a number that means nothing.
CREATE OR REPLACE VIEW public.contributions_totals
WITH (security_invoker = false) AS
  SELECT
    currency,
    sum(amount_cents)::bigint AS total_cents,
    count(*)::bigint AS contribution_count
  FROM public.contributions
  WHERE NOT refunded
  GROUP BY currency;

GRANT SELECT ON public.contributors_public TO anon, authenticated;
GRANT SELECT ON public.contributions_totals TO anon, authenticated;

COMMENT ON TABLE public.contributions IS 'One row per completed donation. Written only by the Stripe webhook (service role); read publicly only through contributors_public and contributions_totals.';
