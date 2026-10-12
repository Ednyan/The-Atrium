-- A frame that lays out what it holds by itself, Pinterest-style
-- (Trace.frameArrange; src/lib/frames.ts masonry). Null: as it's put.
--
-- Run by hand in the SQL editor, before the web build that saves it deploys.
-- Safe to run twice.

alter table public.traces add column if not exists frame_arrange text;

alter table public.traces drop constraint if exists traces_frame_arrange_check;
alter table public.traces add constraint traces_frame_arrange_check
  check (frame_arrange is null or frame_arrange in ('masonry'));
