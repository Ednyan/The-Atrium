-- Short-lived codes that confirm somebody meant to delete their account.
--
-- Why this replaced the password check entirely, for everybody:
--
-- The password check was sound but only existed for half the accounts. Google
-- accounts have no password, so they had no second proof at all -- anyone at an
-- unlocked machine could delete one irreversibly with a click. Adding codes
-- only for those accounts would have left two paths to audit forever; a code
-- for everybody is one path, and one path is the one that stays correct.
--
-- It is not a downgrade for accounts that do have a password. A code proves
-- control of the mailbox, and anyone with the mailbox could already reset the
-- password and take the account outright. The code is the same proof the rest
-- of the account's security already rests on, asked at the one moment nothing
-- can be undone.
--
-- One row per user, so requesting a code replaces the one before it. That makes
-- "only the newest code works" fall out of the schema rather than out of a
-- query somebody has to remember to write, and bounds the table by the number
-- of accounts.
--
-- The code itself is never stored -- only a SHA-256 of user id and code. A
-- readable code sitting in a table would mean anybody who could read that table
-- could delete any account that had asked, which is precisely the position the
-- check exists to prevent.

create table if not exists public.account_deletion_codes (
  user_id uuid primary key references auth.users(id) on delete cascade,
  code_hash text not null,
  expires_at timestamptz not null,
  -- Counted so a six-digit code cannot simply be ground through. Unlike the
  -- password it replaces, this IS a brute-force surface: a million
  -- possibilities is nothing to a script that already holds the session.
  attempts integer not null default 0,
  created_at timestamptz not null default now()
);

comment on table public.account_deletion_codes is
  'One live deletion code per account. Written and read only by the request-deletion-code and delete-account Edge Functions, via the service role.';

-- Nothing in a browser has any business here: not reading a hash, not resetting
-- an attempt counter, not extending an expiry. RLS on with no policies at all
-- means the service role the functions use is the only way in -- the same shape
-- the contributions table uses.
alter table public.account_deletion_codes enable row level security;
