-- Step 2 of hiding everyone's email (hide_emails_1.sql): profiles' copy of
-- it, dropped -- and with it its index (add_profiles_email_index.sql).
--
-- Only once the web app and the send-welcome function that no longer read it
-- are live: an older page still open reads it for username sign-in, and
-- fails until it's reloaded.
--
-- Safe to run twice.

alter table public.profiles drop column if exists email;
