-- A text trace's own name in the Layer panel: Text 1, Text 2, ... as groups
-- are Group 1, Group 2. Other traces are named by their title (content), which
-- is also the label beside them; a text trace's content is its text, which
-- renaming mustn't touch, so it gets a name of its own.
--
-- Run before the web build that uses it deploys: every trace save carries
-- layer_name, and without the column Postgres refuses them. Safe to run twice:
-- only unnamed text traces are named.

alter table public.traces add column if not exists layer_name text;

-- Existing text traces numbered in each atrium, oldest first.
with numbered as (
  select id, row_number() over (partition by lobby_id order by created_at, id) as n
  from public.traces
  where type = 'text' and layer_name is null
)
update public.traces t
set layer_name = 'Text ' || numbered.n
from numbered
where t.id = numbered.id;
