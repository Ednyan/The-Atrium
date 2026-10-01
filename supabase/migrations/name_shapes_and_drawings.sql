-- Shapes and drawings saved before they were numbered carry a placeholder as
-- their name: a shape "shape content" (or nothing), a drawing "freehand
-- drawing". They're named as new ones are (lib/traceNames placeholderNames,
-- which names a desktop vault's and an imported file's the same way):
--
--   a shape   Shape N, or Path N for a path, numbered in its atrium
--   a drawing Stroke N in a group, numbered within it; Drawing N on its own
--
-- each after the highest number of that name already there, oldest first.
-- A drawing known only by its placeholder -- its picture a data URL, none of
-- its strokes kept -- keeps it: renamed, the app would no longer know it as a
-- drawing.
--
-- Safe to run twice: only placeholders are renamed, and none are left.

-- Shapes and paths.
with unnamed as (
  select id, lobby_id, created_at, coalesce(shape_type, '') = 'path' as is_path
  from public.traces
  where type = 'shape' and coalesce(btrim(content), '') in ('', 'shape content')
),
top as (
  select lobby_id, coalesce(shape_type, '') = 'path' as is_path,
    max((case when coalesce(shape_type, '') = 'path'
      then substring(content from '^Path ([0-9]{1,9})$')
      else substring(content from '^Shape ([0-9]{1,9})$') end)::int) as n
  from public.traces
  where type = 'shape'
  group by 1, 2
),
numbered as (
  select u.id, u.is_path,
    coalesce(top.n, 0) + row_number() over (partition by u.lobby_id, u.is_path order by u.created_at, u.id) as n
  from unnamed u
  left join top on top.lobby_id = u.lobby_id and top.is_path = u.is_path
)
update public.traces t
set content = case when numbered.is_path then 'Path ' else 'Shape ' end || numbered.n
from numbered
where t.id = numbered.id;

-- Drawings: strokes in a group, numbered within it.
with unnamed as (
  select id, layer_id, created_at
  from public.traces
  where type = 'image' and content = 'freehand drawing' and layer_id is not null
    and (stroke_data is not null or media_url ~ '(^|/)drawing_[^/?#]*\.png([?#]|$)')
),
top as (
  select layer_id, max(substring(content from '^Stroke ([0-9]{1,9})$')::int) as n
  from public.traces
  where layer_id is not null
  group by 1
),
numbered as (
  select u.id, coalesce(top.n, 0) + row_number() over (partition by u.layer_id order by u.created_at, u.id) as n
  from unnamed u
  left join top on top.layer_id = u.layer_id
)
update public.traces t
set content = 'Stroke ' || numbered.n
from numbered
where t.id = numbered.id;

-- Drawings on their own, numbered in their atrium among its groups' names too.
with unnamed as (
  select id, lobby_id, created_at
  from public.traces
  where type = 'image' and content = 'freehand drawing' and layer_id is null
    and (stroke_data is not null or media_url ~ '(^|/)drawing_[^/?#]*\.png([?#]|$)')
),
names as (
  select lobby_id, content as name from public.traces
  union all
  select lobby_id, name from public.layers
),
top as (
  select lobby_id, max(substring(name from '^Drawing ([0-9]{1,9})$')::int) as n
  from names
  group by 1
),
numbered as (
  select u.id, coalesce(top.n, 0) + row_number() over (partition by u.lobby_id order by u.created_at, u.id) as n
  from unnamed u
  left join top on top.lobby_id = u.lobby_id
)
update public.traces t
set content = 'Drawing ' || numbered.n
from numbered
where t.id = numbered.id;
