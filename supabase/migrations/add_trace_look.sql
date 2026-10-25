-- Any picture's colour other than an EXR's -- exposure, brightness, contrast
-- (src/lib/traceLook.ts TraceLook) -- drawn over it, not into its file.
--
-- Only an atrium still kept in Supabase needs it; a trace sends the column only
-- once its look has been set, so every other trace saves without it. Safe to
-- run twice.

alter table public.traces add column if not exists look jsonb;
