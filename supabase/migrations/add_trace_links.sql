-- Connections between traces: a thread from one trace's centre to another's,
-- drawn under both, like the edges between graphify's nodes.
--
-- Scoped exactly as traces are: anyone who can open the atrium can see them,
-- only those who can edit it can make, change or remove them. A connection
-- goes when either of its traces does (on delete cascade), and with its
-- atrium.
--
-- One per pair of traces, whichever way round: A->B and B->A would be the
-- same thread drawn twice. Direction is what `arrow` is for --
-- 'none', 'forward' (from_trace -> to_trace), 'back' (to_trace -> from_trace)
-- or 'both'.
--
-- color null means "the border colour of the trace it comes from", followed
-- as that changes; a colour set on the connection itself overrides it.
--
-- Run in the SQL editor BEFORE the web build that uses it deploys. Safe to
-- run twice.

create table if not exists public.trace_links (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  lobby_id uuid not null references public.lobbies(id) on delete cascade,
  from_trace uuid not null references public.traces(id) on delete cascade,
  to_trace uuid not null references public.traces(id) on delete cascade,
  arrow text not null default 'none' check (arrow in ('none', 'forward', 'back', 'both')),
  color text,
  width real not null default 2 check (width > 0 and width <= 40),
  label text check (label is null or char_length(label) <= 80),
  check (from_trace <> to_trace)
);

create unique index if not exists trace_links_pair_idx
  on public.trace_links (least(from_trace, to_trace), greatest(from_trace, to_trace));
create index if not exists trace_links_lobby_idx on public.trace_links (lobby_id);

alter table public.trace_links enable row level security;

drop policy if exists "Trace links scoped to accessible lobby (select)" on public.trace_links;
create policy "Trace links scoped to accessible lobby (select)" on public.trace_links
  for select using (public.user_can_access_lobby(lobby_id));

drop policy if exists "Trace links scoped to editable lobby (insert)" on public.trace_links;
create policy "Trace links scoped to editable lobby (insert)" on public.trace_links
  for insert with check (public.user_can_edit_lobby(lobby_id));

drop policy if exists "Trace links scoped to editable lobby (update)" on public.trace_links;
create policy "Trace links scoped to editable lobby (update)" on public.trace_links
  for update using (public.user_can_edit_lobby(lobby_id)) with check (public.user_can_edit_lobby(lobby_id));

drop policy if exists "Trace links scoped to editable lobby (delete)" on public.trace_links;
create policy "Trace links scoped to editable lobby (delete)" on public.trace_links
  for delete using (public.user_can_edit_lobby(lobby_id));

-- Live for everyone in the atrium. Full replica identity so a deletion still
-- carries lobby_id, which the subscription filters on.
alter table public.trace_links replica identity full;
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'trace_links'
  ) then
    alter publication supabase_realtime add table public.trace_links;
  end if;
end $$;
