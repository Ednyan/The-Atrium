-- Whether a username is an existing account's (docs/DECENTRALIZING.md,
-- phase 6). Accounts made with Google live in the Atrium's own directory
-- (workers/rooms, src/people.ts), not here; the directory asks this before
-- giving one a username, so no Google account takes an existing account's.
-- `p_except`: an existing account claiming its own.
--
-- Says yes or no, nothing else -- usernames are shown to everyone in an
-- atrium anyway. Callable without signing in: the directory asks with the
-- anon key.
--
-- Safe to run twice.

create or replace function public.username_taken(p_username text, p_except uuid default null)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where lower(username) = lower(p_username)
      and (p_except is null or id <> p_except)
  )
$$;

grant execute on function public.username_taken(text, uuid) to anon, authenticated;
