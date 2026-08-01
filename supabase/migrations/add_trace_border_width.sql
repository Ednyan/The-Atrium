-- Per-trace border thickness. The frame was hardcoded at 2px for every trace
-- that shows one, so border colour was adjustable but its weight wasn't.
--
-- Added for PDF traces, where a page needs a frame that reads against a light
-- background, but applied to every type that draws a border rather than being
-- special-cased -- a PDF-only thickness control would be an odd exception in
-- a panel where the neighbouring colour control is shared.
--
-- Defaults to 2 so existing traces render exactly as they do now.

ALTER TABLE public.traces
  ADD COLUMN IF NOT EXISTS border_width real NOT NULL DEFAULT 2;

COMMENT ON COLUMN public.traces.border_width IS 'Thickness in pixels of the trace frame drawn when show_border is on.';
