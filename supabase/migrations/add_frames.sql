-- Frames: a trace type that holds other traces and carries them when it moves
-- (src/lib/frames.ts).
--
-- Two changes, both safe to run again:
--
-- 1. 'frame' joins the trace types traces_type_check allows. The list is the
--    one retire_button_trace_type.sql left, plus 'frame'.
--
-- 2. traces.frame_id: the frame a trace is in, null for none. No foreign key,
--    like layer_id: a deleted frame leaves its traces pointing at nothing,
--    which the app reads as no frame, so undoing the delete brings the frame
--    back holding what it held. Imports carry it to the new ids themselves.
--
-- Run BEFORE the web build that ships frames deploys: every trace save sends
-- frame_id, and without the column Postgres refuses the whole save.

ALTER TABLE public.traces DROP CONSTRAINT IF EXISTS traces_type_check;

ALTER TABLE public.traces ADD CONSTRAINT traces_type_check
  CHECK (type IN ('text', 'image', 'audio', 'video', 'embed', 'shape', 'document', 'frame'));

ALTER TABLE public.traces ADD COLUMN IF NOT EXISTS frame_id uuid;

COMMENT ON COLUMN public.traces.frame_id IS 'The frame (a trace of type frame) this trace is in; null for none';

CREATE INDEX IF NOT EXISTS traces_frame_id_idx ON public.traces (frame_id) WHERE frame_id IS NOT NULL;
