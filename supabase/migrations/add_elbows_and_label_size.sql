-- Elbows, and a size for connection labels.
--
-- 1. trace_links.label_size: the label's text size in world units, so it
--    grows and shrinks with the view like the thread it's on (it was a fixed
--    size on screen, so it loomed larger the further out you zoomed).
-- 2. trace_links.elbow: the thread drawn as an elbow -- straight runs and
--    right-angle turns, routed between its two traces -- rather than a curve
--    or a line. trace_links.elbow_at: where its middle run sits between the
--    two ends, 0 at the start and 1 at the end; it can be dragged past either.
-- 3. traces.path_curve_type may be 'elbow' too. Its check was made with the
--    column, unnamed, so every check on the column is found and dropped first.
--
-- Run before the web build that uses them deploys: every thread save sends
-- the new columns, and a path set to Elbow sends its curve type. Safe to run
-- twice.

alter table public.trace_links
  add column if not exists label_size real not null default 12
  check (label_size > 0 and label_size <= 200);

alter table public.trace_links
  add column if not exists elbow boolean not null default false;

alter table public.trace_links
  add column if not exists elbow_at real not null default 0.5
  check (elbow_at >= -5 and elbow_at <= 6);

do $$
declare
  c record;
begin
  for c in
    select conname from pg_constraint
    where conrelid = 'public.traces'::regclass
      and contype = 'c'
      and pg_get_constraintdef(oid) ilike '%path_curve_type%'
  loop
    execute format('alter table public.traces drop constraint %I', c.conname);
  end loop;
end $$;

alter table public.traces add constraint traces_path_curve_type_check
  check (path_curve_type in ('straight', 'bezier', 'elbow'));
