-- A thread runs from border to border by default; set, it runs on under its
-- traces to their centres instead (its menu's Ends setting).
--
-- Run before the web build that uses it deploys: every thread save carries
-- to_center, and without the column Postgres refuses them. Safe to run twice.

alter table public.trace_links
  add column if not exists to_center boolean not null default false;
