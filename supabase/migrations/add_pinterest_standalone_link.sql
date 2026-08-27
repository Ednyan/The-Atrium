-- Pinterest on desktop without an Atrium account.
--
-- The first version of desktop linking borrowed a web account's connection,
-- which meant a desktop-only user had to create an account purely to reach
-- their own Pinterest boards. Pinterest does not care whether we know who they
-- are -- the only reason an account was involved is that the existing table is
-- keyed by one.
--
-- So a connection can now belong to nobody: the OAuth happens in the system
-- browser, on a page that requires no login, and the resulting tokens are
-- stored against a row that the desktop install's link token points at.
--
-- The consequence, stated where it will be read: a standalone connection has
-- no account behind it, so it can only be revoked from the desktop app holding
-- it, or from Pinterest's own connected-apps settings. There is nowhere to log
-- in and revoke it.

CREATE TABLE IF NOT EXISTS pinterest_standalone_connections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  access_token text NOT NULL,
  refresh_token text,
  token_expires_at timestamptz,
  pinterest_username text,
  connected_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE pinterest_standalone_connections ENABLE ROW LEVEL SECURITY;

-- Same posture as pinterest_connections: only the Edge Functions, holding the
-- service-role key, ever touch this. Stated rather than implied.
CREATE POLICY "No direct client access" ON pinterest_standalone_connections
  FOR ALL USING (false) WITH CHECK (false);

-- Pairings and links can now point at either kind of connection.
ALTER TABLE pinterest_desktop_pairings
  ADD COLUMN IF NOT EXISTS standalone_id uuid
    REFERENCES pinterest_standalone_connections(id) ON DELETE CASCADE;

ALTER TABLE pinterest_desktop_links
  ADD COLUMN IF NOT EXISTS standalone_id uuid
    REFERENCES pinterest_standalone_connections(id) ON DELETE CASCADE;

-- user_id was NOT NULL when an account was the only possibility.
ALTER TABLE pinterest_desktop_pairings ALTER COLUMN user_id DROP NOT NULL;
ALTER TABLE pinterest_desktop_links ALTER COLUMN user_id DROP NOT NULL;

-- Exactly one owner, never both and never neither. Without this a row with two
-- owners would resolve to whichever branch the code happened to check first,
-- which is the kind of ambiguity that only shows up once it is a bug.
ALTER TABLE pinterest_desktop_pairings
  DROP CONSTRAINT IF EXISTS pinterest_desktop_pairings_one_owner;
ALTER TABLE pinterest_desktop_pairings
  ADD CONSTRAINT pinterest_desktop_pairings_one_owner
  CHECK ((user_id IS NULL) <> (standalone_id IS NULL));

ALTER TABLE pinterest_desktop_links
  DROP CONSTRAINT IF EXISTS pinterest_desktop_links_one_owner;
ALTER TABLE pinterest_desktop_links
  ADD CONSTRAINT pinterest_desktop_links_one_owner
  CHECK ((user_id IS NULL) <> (standalone_id IS NULL));

-- Deleting the last link to a standalone connection leaves tokens behind that
-- nothing can ever reach again. This clears them, which matters because they
-- are live Pinterest credentials rather than inert rows.
CREATE OR REPLACE FUNCTION public.prune_orphaned_pinterest_standalone()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF OLD.standalone_id IS NOT NULL THEN
    DELETE FROM public.pinterest_standalone_connections sc
    WHERE sc.id = OLD.standalone_id
      AND NOT EXISTS (
        SELECT 1 FROM public.pinterest_desktop_links dl
        WHERE dl.standalone_id = OLD.standalone_id
      )
      AND NOT EXISTS (
        SELECT 1 FROM public.pinterest_desktop_pairings dp
        WHERE dp.standalone_id = OLD.standalone_id
      );
  END IF;
  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS prune_standalone_after_link_delete ON pinterest_desktop_links;
CREATE TRIGGER prune_standalone_after_link_delete
  AFTER DELETE ON pinterest_desktop_links
  FOR EACH ROW EXECUTE FUNCTION public.prune_orphaned_pinterest_standalone();

-- A pairing that expires unredeemed leaves the same orphan behind.
DROP TRIGGER IF EXISTS prune_standalone_after_pairing_delete ON pinterest_desktop_pairings;
CREATE TRIGGER prune_standalone_after_pairing_delete
  AFTER DELETE ON pinterest_desktop_pairings
  FOR EACH ROW EXECUTE FUNCTION public.prune_orphaned_pinterest_standalone();
