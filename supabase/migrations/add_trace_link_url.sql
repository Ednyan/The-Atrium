-- traces.link_url on its own, without the rest of the Pinterest work.
--
-- The column was introduced by add_pinterest_integration.sql, which has never
-- been applied to this database. It isn't actually Pinterest-specific: it is a
-- generic click-through URL for a trace, read by TraceOverlay for any embed,
-- and written by traceInsert/traceSave whenever a trace has one. Pinterest is
-- simply the only feature that currently sets it.
--
-- Splitting it out so the click-through column can exist without creating
-- pinterest_connections and its RLS policies before that integration is
-- approved and in use.
--
-- OPTIONAL, and here is the honest scope of what it buys:
--   - Desktop -> web import no longer silently drops link_url. The importer
--     handles the missing column on its own now (it detects the rejection,
--     drops the column and retries), so imports succeed either way -- this is
--     what preserves the link values instead of discarding them.
--   - Nothing else on the web currently writes link_url, because nothing but
--     Pinterest sets it yet. So this breaks nothing and fixes nothing else
--     today; it is here so the column exists before something needs it.
--
-- The full add_pinterest_integration.sql remains unapplied and should be run
-- when Pinterest is actually approved. It uses IF NOT EXISTS for this same
-- column, so running it later is safe even after this migration.

ALTER TABLE public.traces
  ADD COLUMN IF NOT EXISTS link_url text;

COMMENT ON COLUMN public.traces.link_url IS 'Generic click-through URL for a trace (e.g. the source page behind an embed). Not Pinterest-specific.';
