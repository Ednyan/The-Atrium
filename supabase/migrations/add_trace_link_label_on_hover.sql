-- A thread's label shows always, unless it's set to show only on hover.
--
-- Run before the web build that saves this column deploys: every thread save
-- carries it, and without the column Postgres refuses them. Safe to run twice.

alter table public.trace_links
  add column if not exists label_on_hover boolean not null default false;
