-- A person's own atrium themes, kept with their account.
--
-- Made in the Atrium Themes panel from whichever theme they were looking at,
-- named, and marked light or dark -- the light/dark switch goes to the last
-- theme of that kind someone used. Three on the web; the desktop keeps twelve
-- in its own vault (lib/localDb). An array of
--   { id, name, mode: 'light' | 'dark', values: ThemeSettings }
-- written whole by the client (lib/customThemes), which keeps it to its limit.
--
-- profiles already has RLS: a person updates only their own row, so only they
-- can change these. Themes are no secret; nothing else is needed.
--
-- Safe to run twice.

alter table public.profiles
  add column if not exists custom_themes jsonb not null default '[]'::jsonb;

comment on column public.profiles.custom_themes is
  'The person''s own atrium themes: [{ id, name, mode: light|dark, values: ThemeSettings }], at most 3 (lib/customThemes). Written whole by the client.';
