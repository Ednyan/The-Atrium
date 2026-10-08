-- A line's style -- solid, dashed or dotted -- for a trace's border, a
-- shape's outline, a path, and a connection (lib/strokeStyle). None is solid.
--
-- Saves leave the column out while a trace or thread has no style of its own,
-- so the web build works before this is run; choosing a style needs it.
-- Safe to run twice.

alter table public.traces
  add column if not exists stroke_style text
  check (stroke_style in ('solid', 'dashed', 'dotted'));

alter table public.trace_links
  add column if not exists stroke_style text
  check (stroke_style in ('solid', 'dashed', 'dotted'));
