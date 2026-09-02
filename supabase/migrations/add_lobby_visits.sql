-- When each person last opened each atrium, so the browser can list the ones
-- they actually use first.
--
-- Web only. The desktop app keeps the same information in localStorage on the
-- machine, which is what was asked for and is also what the SQLite shim can
-- manage: writing this needs an upsert, and the shim implements insert and
-- nothing resembling it. Every query against this table is behind
-- `if (!isDesktop)`.
--
-- One row per person per atrium, replaced in place rather than appended to.
-- A visit log would grow without bound to answer a question that only ever
-- concerns the latest entry.

create table if not exists public.lobby_visits (
  user_id uuid not null references auth.users(id) on delete cascade,
  lobby_id uuid not null references public.lobbies(id) on delete cascade,
  visited_at timestamptz not null default now(),

  -- Both halves of the identity, which is also the conflict target the upsert
  -- names. Deleting the atrium or the account takes the row with it.
  primary key (user_id, lobby_id)
);

-- The only query this table serves: everything for one person, newest first.
create index if not exists lobby_visits_user_recent_idx
  on public.lobby_visits (user_id, visited_at desc);

alter table public.lobby_visits enable row level security;

-- Nobody sees anybody else's, and nobody writes a row in somebody else's name.
-- Written as drop-then-create because these files are applied by hand, more
-- than once, and `create policy` has no `if not exists`.
drop policy if exists "Read own atrium visits" on public.lobby_visits;
create policy "Read own atrium visits"
  on public.lobby_visits for select
  using (auth.uid() = user_id);

drop policy if exists "Record own atrium visits" on public.lobby_visits;
create policy "Record own atrium visits"
  on public.lobby_visits for insert
  with check (auth.uid() = user_id);

drop policy if exists "Update own atrium visits" on public.lobby_visits;
create policy "Update own atrium visits"
  on public.lobby_visits for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- Deliberately no delete policy. Nothing in the app deletes a visit, and the
-- foreign keys already remove rows when the atrium or the account goes.
