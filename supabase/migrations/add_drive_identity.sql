-- Drive atriums (docs/DECENTRALIZING.md, phase 5, members and roles).
--
-- An atrium kept in Google Drive is readable by its members only: its key is
-- encrypted for each of them, with the public half of a key pair of their own.
-- Whoever adds someone needs that half, and the person's Drive folder for
-- atriums -- so both are here, in the profile they're added by.
--
-- Public by design, like the username beside them: a public key is meant to
-- be given out, and the folder's contents are encrypted. The private half of
-- the pair never leaves the person's own Google account (its hidden app
-- folder).
--
-- Null until the person first uses a Drive atrium. Each person writes their
-- own, under the profile's existing "Users can update own profile" policy.
--
-- Safe to run twice.

alter table public.profiles
  add column if not exists drive_key jsonb;

alter table public.profiles
  add column if not exists drive_root text;

comment on column public.profiles.drive_key is
  'Public half (JWK, ECDH P-256) of the key pair Drive atriums encrypt their key to. Null until first used.';
comment on column public.profiles.drive_root is
  'Id of the person''s Google Drive folder for atriums, shared by link; their saves to each Drive atrium are in a folder in it named by the atrium''s id.';
