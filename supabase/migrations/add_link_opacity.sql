-- How opaque a connection is, line and arrowheads alike.
--
-- Threads were drawn with their line at three quarters and their arrowheads
-- solid, so the two never matched; now both take this one value, set from the
-- thread's menu. It starts at three quarters, as the lines have always been.
--
-- Run before the web build that uses it deploys: every thread save sends it.
-- Safe to run twice.

alter table public.trace_links
  add column if not exists opacity real not null default 0.75
  check (opacity >= 0 and opacity <= 1);
