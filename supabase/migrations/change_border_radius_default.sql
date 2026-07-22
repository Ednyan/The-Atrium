-- Traces used to default to a rounded 8px border radius. New traces should
-- default to sharp corners (0) instead -- existing traces keep whatever
-- value they already have; this only changes what a future INSERT that
-- omits border_radius gets (the main creation path now sets it explicitly
-- too, see TracePanel.tsx, but this is a safety net for any path that doesn't).
ALTER TABLE public.traces ALTER COLUMN border_radius SET DEFAULT 0;
