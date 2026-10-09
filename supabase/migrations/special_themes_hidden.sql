-- Special themes, more of them (lib/specialThemes):
--
--   hidden   kept from everyone, whatever the day, until the developer shows
--            it -- a theme ready ahead of its release.
--   all year a theme with no window (starts_on and ends_on both null): shown
--            with the presets every day; new atriums never start in it.
--   preset   the developer's version of one of the three built-in presets
--            (sepia, abyss, markerboard): its look, or its being hidden, in
--            place of the one in the code. One row each at most.
--
-- A theme with a window is now shown to people only in it (the app does
-- that); before, special themes were offered all year.
--
-- Run this BEFORE the web build that asks for these columns deploys: the
-- app's query names them, and a query naming a column that isn't there fails,
-- leaving everyone with their last copy of the list.
--
-- Safe to run twice.

alter table public.special_themes add column if not exists hidden boolean not null default false;
alter table public.special_themes add column if not exists preset text;

alter table public.special_themes alter column starts_on drop not null;
alter table public.special_themes alter column ends_on drop not null;

-- A window is whole or not there at all.
alter table public.special_themes drop constraint if exists special_themes_window_whole;
alter table public.special_themes add constraint special_themes_window_whole
  check ((starts_on is null) = (ends_on is null));

-- Only the three presets there are, a preset all year, and one row each.
alter table public.special_themes drop constraint if exists special_themes_preset_known;
alter table public.special_themes add constraint special_themes_preset_known
  check (preset is null or (preset in ('sepia', 'abyss', 'markerboard') and starts_on is null));
create unique index if not exists special_themes_one_per_preset
  on public.special_themes (preset) where preset is not null;
