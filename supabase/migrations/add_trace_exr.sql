-- A picture made from an EXR keeps its original and how it's shown (src/lib/
-- exr.ts ExrGrade): the original .exr's address, the view transform, input
-- colour space, exposure, brightness, contrast and a LUT, if one is used. The
-- picture itself is still an ordinary PNG; this is what it's graded again
-- from.
--
-- Run before the web build that uses it deploys: an EXR placed is written with
-- it, and without the column Postgres refuses that trace (no other trace sends
-- it). Safe to run twice.

alter table public.traces add column if not exists exr jsonb;
