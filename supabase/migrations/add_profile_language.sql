-- The language a person reads, remembered.
--
-- The welcome email could get away without this: it is sent the moment somebody
-- arrives, so the app can simply say what language it is showing. Nothing else
-- can. A message sent later -- a note from an operator, an account-deletion
-- code, anything yet to be written -- goes out with no browser attached to ask,
-- and English is a poor guess for somebody who has been reading Korean.
--
-- Guessing from an IP address is worse than storing it: that is a guess about a
-- country, and country is not language.
--
-- Written once, at first arrival, and not updated when somebody switches the
-- interface afterwards. "The language they signed up in" is a stable fact;
-- following the toggle would mean mail changing language because of a setting
-- somebody flipped to look at something once.
--
-- Null is expected and means "we never saw one" -- every account created before
-- this column existed. Senders fall back to English rather than failing.

alter table public.profiles
  add column if not exists language text;

comment on column public.profiles.language is
  'Interface language at first arrival (e.g. en, pt-PT, ja). Null for accounts predating the column; senders fall back to English. Set once by the send-welcome Edge Function, never overwritten.';
