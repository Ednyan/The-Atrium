-- Per-trace control over whether text scales with its box.
--
-- true (default): font size follows the trace's scale, so resizing the trace
-- resizes the text along with it.
-- false: font size is fixed regardless of the trace's scale -- resizing only
-- changes how much room the text has to reflow in.
--
-- Defaults to true to match the behavior already shipped for text traces.

ALTER TABLE traces ADD COLUMN IF NOT EXISTS text_scale_with_box BOOLEAN DEFAULT true;
