-- Per-location lock for saved camera views.
--
-- The "set to current view" button sits directly beside "fly here" in the
-- locations list and overwrites a saved framing with no confirmation step --
-- so a misclick silently destroys a view that may have been carefully
-- composed. Locking disables that one action.
--
-- Rename and delete are deliberately still allowed on a locked location: both
-- already go through a confirmation dialog, so they aren't the accident this
-- is guarding against, and a lock that blocks everything would just be
-- another thing to keep toggling off.
--
-- MUST BE APPLIED BEFORE THE WEB BUILD DEPLOYS. saveLocationChanges starts
-- sending is_locked as soon as the new client ships, and Postgres rejects an
-- insert naming a column that doesn't exist -- which would fail every
-- location save, not just locked ones.

ALTER TABLE public.lobby_locations
  ADD COLUMN IF NOT EXISTS is_locked boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.lobby_locations.is_locked IS 'When true, the stored camera cannot be overwritten by "set to current view". Rename/delete are unaffected.';
