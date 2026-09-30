-- A drawing stroke's stroke, kept as it was drawn (src/lib/brushes.ts
-- StrokeData): its points, colour, width, brush, softness and seed, and each
-- eraser stroke taken out of it, in the trace's own box units. The picture
-- file stays as it is; this is what it's painted again from -- sharp at any
-- zoom, and in another colour, width, brush or softness.
--
-- Run before the web build that uses it deploys: new strokes are written with
-- it, and without the column Postgres refuses them. Safe to run twice.

alter table public.traces add column if not exists stroke_data jsonb;
