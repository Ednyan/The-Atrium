-- Cleans up after the button trace type, which was replaced by the Clickable
-- option on ordinary traces.
--
-- Run add_trace_clickable.sql and add_trace_link_url.sql first -- this uses
-- both columns.
--
-- Two leftovers:
--
-- 1. Any rows of type 'button'. There may be none: the type was rejected by
--    traces_type_check until add_button_and_document_trace_types.sql was
--    applied, so a button could only have been saved in the window between
--    running that and this. Nothing renders type 'button' any more, so such a
--    row would sit in the atrium invisible but still counting toward its
--    limits.
--
--    They're converted rather than deleted. A button was a label and a link,
--    which is exactly a text trace with Clickable on -- so it keeps working,
--    with its own label and destination, instead of disappearing along with
--    whatever the user wrote.
--
-- 2. 'button' in the type constraint, now that nothing can create one.
--    'document' stays: the desktop PDF trace will use it.

UPDATE public.traces
SET type = 'text',
    is_clickable = (link_url IS NOT NULL AND link_url <> ''),
    -- Buttons drew their own frame, so they were created with these off. As a
    -- text trace it would otherwise render as bare floating text.
    show_border = true,
    show_background = true
WHERE type = 'button';

ALTER TABLE public.traces DROP CONSTRAINT IF EXISTS traces_type_check;

ALTER TABLE public.traces ADD CONSTRAINT traces_type_check
  CHECK (type IN ('text', 'image', 'audio', 'video', 'embed', 'shape', 'document'));
