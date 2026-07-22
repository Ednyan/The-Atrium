-- get_lobby_size_bytes only ever summed the JSON-serialized ROW size of
-- each trace -- for an image/video/audio trace, media_url is just a short
-- URL string (~100 bytes), so the actual uploaded file in Supabase Storage
-- (which can be megabytes) never counted toward the atrium's size limit at
-- all. This folds in the real Storage object size for any trace whose
-- media_url points at this project's own "traces" bucket.
--
-- media_url is a full public Storage URL
-- (.../storage/v1/object/public/traces/<name>), so the actual stored object
-- is found by matching the tail of that URL against storage.objects.name --
-- this works whether the upload path is just the bare filename (the web
-- upload convention) or has a folder prefix like <lobbyId>/<filename>
-- (the desktop convention), without needing to know which one was used.
--
-- Also switched from LANGUAGE sql to plpgsql: a SECURITY DEFINER sql
-- function is eligible for planner inlining, which can silently run under
-- the CALLER's privileges/RLS instead of the definer's -- see
-- fix_lobby_admin_recursion.sql for the incident that established this as a
-- hard rule for this project's SECURITY DEFINER functions.
CREATE OR REPLACE FUNCTION public.get_lobby_size_bytes(p_lobby_id uuid)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
STABLE
AS $$
DECLARE
  row_bytes bigint;
  media_bytes bigint;
BEGIN
  SELECT COALESCE(SUM(octet_length(row_to_json(t)::text)), 0)
  INTO row_bytes
  FROM public.traces t
  WHERE t.lobby_id = p_lobby_id;

  SELECT COALESCE(SUM((o.metadata->>'size')::bigint), 0)
  INTO media_bytes
  FROM public.traces t
  JOIN storage.objects o
    ON o.bucket_id = 'traces'
   AND (
     o.name = substring(t.media_url FROM '[^/]+$')
     OR o.name LIKE '%/' || substring(t.media_url FROM '[^/]+$')
   )
  WHERE t.lobby_id = p_lobby_id
    AND t.media_url LIKE '%/storage/v1/object/public/traces/%';

  RETURN row_bytes + media_bytes;
END;
$$;

COMMENT ON FUNCTION public.get_lobby_size_bytes IS 'Approximate storage usage for an atrium: JSON row size of every trace, plus the real Supabase Storage object size for any trace whose media_url points at this project''s own traces bucket.';
