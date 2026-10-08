-- Where a trace's light comes from: a point at its middle (as it always has,
-- and what none means), all of its shape, or its border.
--
-- Saves leave the column out while a trace hasn't chosen, so the web build
-- works before this is run; choosing needs it. Safe to run twice.

alter table public.traces
  add column if not exists light_emit text
  check (light_emit in ('center', 'shape', 'border'));
