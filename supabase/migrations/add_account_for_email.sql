-- Which existing account has an email address -- asked by the Atrium's
-- worker alone (workers/rooms, src/people.ts), with an address Google has
-- verified for someone signing in with Google (docs/DECENTRALIZING.md,
-- phase 6). So a person who made an account with that address -- by email
-- and password, or with Google -- is pointed to it, rather than given a
-- second, empty one.
--
-- Nobody else can ask: it answers only with the worker's key, whose SHA-256
-- is kept here (private, readable by no one but this function). Anyone
-- without it gets nothing, so no address can be looked up. Only accounts
-- whose address is confirmed (or that signed up with a provider) count: an
-- abandoned, unconfirmed sign-up isn't someone's account to be sent to.
--
-- The key's hash is set separately, once (the line to run is given with the
-- worker's setup, never the key itself). Safe to run twice.

create extension if not exists pgcrypto with schema extensions;
create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

create table if not exists private.worker_keys (
  name text primary key,
  key_hash bytea not null
);

create or replace function public.account_for_email(p_email text, p_key text)
returns uuid
language sql
stable
security definer
set search_path = public, auth, extensions, private
as $$
  select u.id from auth.users u
  where exists (
      select 1 from private.worker_keys k
      where k.name = 'worker' and k.key_hash = extensions.digest(coalesce(p_key, ''), 'sha256')
    )
    and lower(u.email) = lower(p_email)
    and (u.email_confirmed_at is not null
         or exists (select 1 from auth.identities i where i.user_id = u.id and i.provider <> 'email'))
  order by u.created_at
  limit 1
$$;

revoke all on function public.account_for_email(text, text) from public;
grant execute on function public.account_for_email(text, text) to anon, authenticated;
