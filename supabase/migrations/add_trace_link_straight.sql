-- A thread can be drawn straight instead of hanging in a curve (its menu's
-- Line setting). Curved stays the default.
--
-- Run before the web build that uses it deploys: every thread save carries
-- straight, and without the column Postgres refuses them. Safe to run twice.

alter table public.trace_links
  add column if not exists straight boolean not null default false;
