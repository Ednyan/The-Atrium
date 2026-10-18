-- Which existing account signed up with a Google account (docs/DECENTRALIZING.md,
-- phase 6). Before "Continue with Google" makes a new Google account, the
-- Atrium's worker (workers/rooms, src/people.ts) asks this with Google's id
-- for the person -- from Google's own answer, so only someone signed in as
-- that Google account can ask for it -- and points them to the account they
-- already have instead of making them a second, empty one.
--
-- Answers by Google's id only, never by email: nobody can look anyone up
-- with an address. Callable without signing in: the worker asks with the
-- anon key.
--
-- Safe to run twice.

create or replace function public.account_for_google(p_google_id text)
returns uuid
language sql
stable
security definer
set search_path = public, auth
as $$
  select user_id from auth.identities
  where provider = 'google'
    and (provider_id = p_google_id or identity_data ->> 'sub' = p_google_id)
  limit 1
$$;

revoke all on function public.account_for_google(text) from public;
grant execute on function public.account_for_google(text) to anon, authenticated;
