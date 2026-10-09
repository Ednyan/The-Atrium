-- Special themes: the developer's themes for an occasion, each with a window
-- of the year (month-day to month-day, every year, both days included; it may
-- run over the new year) in which a new atrium starts in it. Everyone sees
-- them with the presets. Made in the app's Developers > Special themes, by the
-- platform operator alone (is_platform_admin, add_platform_admin.sql).
--
-- Read by anyone, the desktop app included (over REST, with the anon key).
-- Written only by the operator: the policies below check is_platform_admin().
--
-- Safe to run twice.

create table if not exists public.special_themes (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 40),
  mode text not null default 'dark' check (mode in ('light', 'dark')),
  theme_settings jsonb not null default '{}'::jsonb,
  starts_on text not null check (starts_on ~ '^(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$'),
  ends_on text not null check (ends_on ~ '^(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.special_themes enable row level security;

drop policy if exists "Special themes are read by anyone" on public.special_themes;
create policy "Special themes are read by anyone"
  on public.special_themes for select
  to anon, authenticated
  using (true);

drop policy if exists "Special themes are made by the operator" on public.special_themes;
create policy "Special themes are made by the operator"
  on public.special_themes for insert
  to authenticated
  with check (public.is_platform_admin());

drop policy if exists "Special themes are changed by the operator" on public.special_themes;
create policy "Special themes are changed by the operator"
  on public.special_themes for update
  to authenticated
  using (public.is_platform_admin())
  with check (public.is_platform_admin());

drop policy if exists "Special themes are removed by the operator" on public.special_themes;
create policy "Special themes are removed by the operator"
  on public.special_themes for delete
  to authenticated
  using (public.is_platform_admin());

grant select on public.special_themes to anon, authenticated;
grant insert, update, delete on public.special_themes to authenticated;

-- The first: Spooky, for Halloween. A violet-black room, a pumpkin-orange dot
-- grid, ember particles, fallen leaves, cracks and stardust in violet on the
-- ground, and a photo of pumpkins and candles at night over the whole view,
-- faint, drifting with it (public/themes/spooky.webp, public domain). Kept as
-- it is if it's been changed since (do nothing).
insert into public.special_themes (id, name, mode, starts_on, ends_on, theme_settings)
values (
  '5b0c7a1e-0000-4000-8000-000000000031',
  'Spooky',
  'dark',
  '10-15',
  '11-01',
  '{
    "backgroundColor": "#0e0a14",
    "gridStyle": "dots",
    "gridEnabled": true,
    "gridColor": "#ff7b1c",
    "gridOpacity": 0.22,
    "gridLineSpacing": 44,
    "particlesEnabled": true,
    "particleColor": "#ff9440",
    "particleOpacity": 0.75,
    "particleDensity": 1.6,
    "groundEnabled": true,
    "groundElements": ["leaf", "crack", "stardust"],
    "groundColor": "#8a4fd1",
    "groundOpacity": 0.3,
    "groundDensity": 0.35,
    "groundScale": 1.1,
    "groundScaleRange": 0.45,
    "groundPattern": "random",
    "groundSpacing": 220,
    "groundRotation": 1,
    "backgroundImage": "/themes/spooky.webp",
    "backgroundImageEnabled": true,
    "backgroundImageFill": true,
    "backgroundImageOpacity": 0.35,
    "backgroundImageScale": 1,
    "backgroundParallaxEnabled": true,
    "backgroundParallax": 0.5
  }'::jsonb
)
on conflict (id) do nothing;
