-- Per-trace toggle for the soft ambient drop shadow under the trace frame.
--
-- true (default): the existing "0 6px 16px rgba(0,0,0,0.68)" shadow plus its
-- inset highlight, which is what traces have always rendered with.
-- false: no shadow, leaving the trace flat against the canvas.
--
-- Defaults to true so existing traces are unchanged.

ALTER TABLE traces ADD COLUMN IF NOT EXISTS show_shadow BOOLEAN DEFAULT true;
