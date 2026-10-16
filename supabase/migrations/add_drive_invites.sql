-- Drive atriums' invitations (docs/DECENTRALIZING.md, phase 5, members).
--
-- When someone is added to a Drive atrium, the invitation shows in their
-- atrium browser -- no link needed -- and they can enter at once, even with
-- the owner away. For someone who has never used a Drive atrium (no key pair
-- yet to encrypt the atrium's key to), `secret` is a one-off key that opens
-- it: readable only by them and whoever invited them, and cleared by their
-- app once an owner's or admin's app has let them in properly. Someone with a
-- key pair already is let in at once, and their invitation carries no secret.
--
-- The atrium's contents are never here: only which atrium (its roster file in
-- Google Drive), its name, and who invited whom.
--
-- Safe to run twice.

create table if not exists public.drive_invites (
  id uuid primary key default gen_random_uuid(),
  to_user uuid not null references auth.users (id) on delete cascade,
  from_user uuid not null references auth.users (id) on delete cascade,
  roster text not null,
  lobby_id text not null,
  name text not null,
  secret text,
  created_at timestamptz not null default now(),
  unique (to_user, roster)
);

create index if not exists idx_drive_invites_to_user on public.drive_invites (to_user);

alter table public.drive_invites enable row level security;

drop policy if exists "Drive invites are seen by whom they're to and from" on public.drive_invites;
create policy "Drive invites are seen by whom they're to and from"
  on public.drive_invites for select
  using (auth.uid() = to_user or auth.uid() = from_user);

drop policy if exists "Drive invites are made by their sender" on public.drive_invites;
create policy "Drive invites are made by their sender"
  on public.drive_invites for insert
  with check (auth.uid() = from_user);

drop policy if exists "Drive invites are changed by their sender" on public.drive_invites;
create policy "Drive invites are changed by their sender"
  on public.drive_invites for update
  using (auth.uid() = from_user)
  with check (auth.uid() = from_user);

drop policy if exists "Drive invites are removed by whom they're to and from" on public.drive_invites;
create policy "Drive invites are removed by whom they're to and from"
  on public.drive_invites for delete
  using (auth.uid() = to_user or auth.uid() = from_user);

-- Whom it's to may change it too -- their app clears the secret once they're
-- let in properly, and keeps the invitation, so an atrium they've left in one
-- browser is under "Shared with you" to open again. It's theirs alone.
drop policy if exists "Drive invites are cleared by whom they're to" on public.drive_invites;
create policy "Drive invites are cleared by whom they're to"
  on public.drive_invites for update
  using (auth.uid() = to_user)
  with check (auth.uid() = to_user);
