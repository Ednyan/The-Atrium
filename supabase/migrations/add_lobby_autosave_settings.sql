-- Move autosave from a per-browser global preference (localStorage in
-- ProfileSettings.tsx) to an atrium-wide policy the owner configures once in
-- the Manage Atrium panel, applying to every collaborator's client while
-- they're in that atrium.

ALTER TABLE public.lobbies
  ADD COLUMN IF NOT EXISTS autosave_enabled boolean DEFAULT false NOT NULL,
  ADD COLUMN IF NOT EXISTS autosave_interval_seconds integer DEFAULT 60 NOT NULL
    CHECK (autosave_interval_seconds >= 10 AND autosave_interval_seconds <= 600);

COMMENT ON COLUMN public.lobbies.autosave_enabled IS 'Whether clients in this atrium should periodically auto-save pending trace changes.';
COMMENT ON COLUMN public.lobbies.autosave_interval_seconds IS 'Minimum seconds between autosaves, if autosave_enabled.';
