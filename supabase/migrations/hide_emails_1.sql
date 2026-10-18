-- Every account's email was readable by anyone: profiles is public (its
-- SELECT policy is USING (true), for names and colours), and it held a copy
-- of the email. Emails are Auth's own (auth.users); this takes profiles'
-- copy out of every use, in two steps:
--
--   1. this file: what replaces the copy, added beside it;
--   2. hide_emails_2.sql: the copy dropped -- once the app and the
--      send-welcome function that no longer read it are live.
--
-- Run this first, then deploy (the web app, and send-welcome), then step 2.
-- Safe to run twice.

create extension if not exists pgcrypto with schema extensions;

-- ---------------------------------------------------------------- signing in by username

-- Someone signing in with a username and password gets that account's email
-- -- to sign in with, through Auth as before -- only if the password is the
-- account's. Anyone else learns nothing, and a username with many wrong tries
-- rests for 15 minutes (its email sign-in is unaffected). Counted only for
-- usernames that exist, so guessing names can't grow the count.
create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

create table if not exists private.sign_in_attempts (
  username text primary key,
  failures integer not null default 0,
  locked_until timestamptz
);

create or replace function public.email_for_sign_in(p_username text, p_password text)
returns text
language plpgsql
volatile
security definer
set search_path = public, auth, extensions, private
as $$
declare
  v_key text := lower(trim(coalesce(p_username, '')));
  v_user uuid;
  v_email text;
  v_hash text;
  v_locked timestamptz;
begin
  select id into v_user from public.profiles where lower(username) = v_key;
  if v_user is null then
    return null;
  end if;

  select locked_until into v_locked from private.sign_in_attempts where username = v_key;
  if v_locked is not null and v_locked > now() then
    raise exception 'too_many_attempts';
  end if;
  -- A rest that's over: counted afresh.
  if v_locked is not null then
    delete from private.sign_in_attempts where username = v_key;
  end if;

  select email, encrypted_password into v_email, v_hash from auth.users where id = v_user;
  -- Auth keeps passwords as bcrypt; an account with none (made with Google)
  -- signs in with Google.
  if v_hash is not null and v_hash like '$2%' and extensions.crypt(p_password, v_hash) = v_hash then
    delete from private.sign_in_attempts where username = v_key;
    return v_email;
  end if;

  insert into private.sign_in_attempts as a (username, failures) values (v_key, 1)
  on conflict (username) do update
    set failures = a.failures + 1,
        locked_until = case when a.failures + 1 >= 10 then now() + interval '15 minutes' else null end;
  return null;
end
$$;

revoke all on function public.email_for_sign_in(text, text) from public;
grant execute on function public.email_for_sign_in(text, text) to anon, authenticated;

-- ---------------------------------------------------------------- the welcome email

-- send-welcome asks whether anyone at an address was welcomed already (see
-- add_welcome_email.sql): answered from Auth's emails, for the server alone.
create or replace function public.address_already_welcomed(p_email text)
returns boolean
language sql
stable
security definer
set search_path = public, auth
as $$
  select exists (
    select 1 from public.profiles p join auth.users u on u.id = p.id
    where lower(u.email) = lower(p_email) and p.welcome_email_sent_at is not null
  )
$$;

revoke all on function public.address_already_welcomed(text) from public, anon, authenticated;
grant execute on function public.address_already_welcomed(text) to service_role;

-- ---------------------------------------------------------------- new accounts

-- The column stays until step 2, empty from now on: new profiles no longer
-- copy the email. handle_new_user as add_username_chosen.sql made it, but for
-- that.
alter table public.profiles alter column email drop not null;

create or replace function public.handle_new_user()
returns trigger
security definer
set search_path = public
language plpgsql
as $$
declare
  supplied_name text;
  raw_name text;
  base_name text;
  candidate text;
  suffix int := 0;
  was_chosen boolean;
begin
  supplied_name := new.raw_user_meta_data->>'username';
  was_chosen := supplied_name is not null;

  raw_name := coalesce(
    supplied_name,
    new.raw_user_meta_data->>'full_name',
    new.raw_user_meta_data->>'name',
    split_part(coalesce(new.email, ''), '@', 1)
  );

  -- Strip anything username_format rejects, then enforce username_length.
  base_name := regexp_replace(coalesce(raw_name, ''), '[^a-zA-Z0-9_]', '', 'g');
  base_name := left(base_name, 20);

  if char_length(base_name) < 3 then
    base_name := 'user_' || substring(new.id::text, 1, 8);
  end if;

  candidate := base_name;

  while suffix < 50 loop
    begin
      insert into public.profiles (id, username, display_name, username_chosen)
      values (new.id, candidate, candidate, was_chosen);
      return new;
    exception
      when unique_violation then
        suffix := suffix + 1;
        candidate := left(base_name, 20 - char_length(suffix::text)) || suffix::text;
      when others then
        raise log 'handle_new_user failed for %: %', new.id, sqlerrm;
        return new;
    end;
  end loop;

  raise log 'handle_new_user exhausted username attempts for %', new.id;
  return new;
end;
$$;
