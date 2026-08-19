-- Which subscription a monthly payment belongs to.
--
-- Two things were broken for want of this, and they are the same gap.
--
-- A renewal arrived as a brand new row with name_approved false, so every month
-- of every subscription came back to the moderation queue -- twelve approvals a
-- year for one person who was approved the first time. Worse, until each one
-- was approved it was invisible to the public views, so a supporter's total
-- stopped growing and, with the subscription-state view, they eventually read
-- as having stopped paying while they were still paying.
--
-- And renaming didn't survive. The operator edits a row, but the next invoice
-- writes display_name from the *subscription's* metadata, frozen at checkout --
-- so the following month arrived under the old name and, because the wall
-- groups by name, split one contributor into two traces with their money
-- divided between them.
--
-- With an id on the row, a renewal can find what came before it and carry the
-- decision forward: the name as it stands now, and whether it was approved.
-- The database becomes the record rather than a copy of Stripe's metadata.

ALTER TABLE public.contributions
  ADD COLUMN IF NOT EXISTS stripe_subscription_id text;

COMMENT ON COLUMN public.contributions.stripe_subscription_id IS 'The Stripe subscription this payment belongs to, for monthly rows. Lets a renewal inherit the name and the approval already given to the same subscription.';

-- The lookup a renewal does: newest row for this subscription.
CREATE INDEX IF NOT EXISTS contributions_subscription_idx
  ON public.contributions (stripe_subscription_id, created_at DESC)
  WHERE stripe_subscription_id IS NOT NULL;

-- Rows written before this column existed have no id, so the first renewal
-- after it ships finds nothing to inherit from and asks to be approved once
-- more. From that approval onward it carries itself. Nothing needs backfilling;
-- the cost is one extra approval per existing subscription, once.
