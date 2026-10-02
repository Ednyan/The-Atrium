-- Spreadsheets on the canvas: 'sheet' (one table, one sheet of a file) and
-- 'chart' (one chart from a file) join the trace types traces_type_check
-- allows. Their content is a JSON file the trace points at (media_url), as a
-- picture's is, so the row stays small.
--
-- Run before the web build that uses it deploys. Safe to run twice: the
-- constraint is dropped first and made again with the whole list.

ALTER TABLE public.traces DROP CONSTRAINT IF EXISTS traces_type_check;

ALTER TABLE public.traces ADD CONSTRAINT traces_type_check
  CHECK (type IN ('text', 'image', 'audio', 'video', 'embed', 'shape', 'document', 'frame', 'sheet', 'chart'));
