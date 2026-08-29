-- Remembering that somebody has already been welcomed.
--
-- The welcome is sent by an Edge Function the app calls once a confirmed user
-- arrives, rather than by a database trigger on auth.users. Two reasons:
--
--   1. "Confirmed" happens differently depending on how somebody signed up.
--      A Google sign-in is confirmed the instant the row is inserted; an email
--      sign-up is confirmed later, by an UPDATE, when they click the link. A
--      trigger has to catch both transitions, and catching them means firing
--      HTTP out of Postgres -- pg_net, a stored service key, and a failure
--      mode that is invisible from the app.
--   2. The moment somebody actually arrives is a better moment to greet them
--      than the moment a column changed. It is also the moment the app knows
--      what language they read.
--
-- The cost is that somebody who confirms and never opens the app is never
-- welcomed, which seems the right way round: a greeting for a person who did
-- not come back is a greeting nobody wanted.
--
-- This column is what makes the send happen once. The function checks it,
-- sends, then stamps it -- so a reload, a second device, or a retry after a
-- half-failure cannot produce a second copy.

alter table public.profiles
  add column if not exists welcome_email_sent_at timestamptz;

comment on column public.profiles.welcome_email_sent_at is
  'When the welcome email went out. Null means it has not been sent. Set by the send-welcome Edge Function, which refuses to send twice.';

-- Nobody but the function needs to see or set this. profiles already has RLS
-- with the app's own policies on it; the service role the function uses
-- bypasses them, and no client policy grants this column, so a browser can
-- neither read the timestamp nor forge it.
