-- traces_type_check still lists only the original types, so a 'button' row is
-- rejected with:
--   new row for relation "traces" violates check constraint "traces_type_check"
--
-- I previously claimed this constraint no longer existed, based on a probe
-- insert that came back complaining about position_x instead. That was a bad
-- test: the row violated NOT NULL on position_x, Postgres reported that first,
-- and the type check was never reached. A probe has to be valid in every
-- respect except the thing being tested, or it proves nothing.
--
-- Recreated with the full list rather than dropped. On the desktop side the
-- equivalent constraint was removed, because SQLite can't alter a CHECK
-- without rebuilding the whole table and there is exactly one local user
-- writing to it. Here the table is shared and altering a constraint is one
-- statement, so the integrity is worth keeping.
--
-- 'document' is included now, ahead of the desktop PDF trace that will use it,
-- so that feature doesn't need its own migration. A type nothing writes yet
-- costs nothing.

ALTER TABLE public.traces DROP CONSTRAINT IF EXISTS traces_type_check;

ALTER TABLE public.traces ADD CONSTRAINT traces_type_check
  CHECK (type IN ('text', 'image', 'audio', 'video', 'embed', 'shape', 'button', 'document'));
