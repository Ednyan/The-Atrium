-- "Clickable" on a trace: left-clicking it opens a link.
--
-- Available on text, embed and shape traces from the Customize panel. The URL
-- itself reuses traces.link_url (see add_trace_link_url.sql, which this
-- depends on) -- it is already the generic click-through destination, and a
-- second URL column would just be a second thing to keep in step.
--
-- The toggle is its own column rather than being inferred from link_url being
-- non-empty, so turning clickability off doesn't throw away the address. Same
-- reason every other trace toggle (show_border, enable_interaction) is stored
-- rather than derived.

ALTER TABLE public.traces
  ADD COLUMN IF NOT EXISTS is_clickable boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.traces.is_clickable IS 'When true, left-clicking the trace opens link_url. Set from the Customize panel on text/embed/shape traces.';
