-- Fix: layers were never scoped to a specific lobby/atrium, so every group
-- ever created by any user in any atrium was loaded into every atrium's
-- Layer panel (see src/components/LayerPanel.tsx). This adds lobby_id and
-- backfills existing rows on a best-effort basis.

ALTER TABLE public.layers
ADD COLUMN IF NOT EXISTS lobby_id uuid REFERENCES public.lobbies(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS layers_lobby_id_idx ON public.layers(lobby_id);

-- Backfill: a layer can only be unambiguously assigned to a lobby if every
-- trace currently pointing at it (traces.layer_id) agrees on one lobby_id.
-- Layers with no referencing traces, or with traces spanning more than one
-- lobby (only possible because of the bug this migration fixes), are left
-- with lobby_id = NULL and will simply stop appearing in any Layer panel.
-- This is intentional — do not auto-delete them here, since a human should
-- review genuinely ambiguous cases before removing anything.
WITH unambiguous_layer_lobby AS (
  SELECT layer_id, MIN(lobby_id::text)::uuid AS lobby_id
  FROM public.traces
  WHERE layer_id IS NOT NULL AND lobby_id IS NOT NULL
  GROUP BY layer_id
  HAVING COUNT(DISTINCT lobby_id) = 1
)
UPDATE public.layers l
SET lobby_id = u.lobby_id
FROM unambiguous_layer_lobby u
WHERE l.id = u.layer_id AND l.lobby_id IS NULL;

COMMENT ON COLUMN public.layers.lobby_id IS 'Atrium this layer/group belongs to. NULL rows are orphaned (pre-fix data with no unambiguous lobby) and are intentionally excluded from every Layer panel query.';
