-- Function to calculate the actual storage size of all traces in a lobby
-- Returns size in bytes (approximate, based on JSON representation of each row)
CREATE OR REPLACE FUNCTION get_lobby_size_bytes(p_lobby_id UUID)
RETURNS BIGINT
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(SUM(octet_length(row_to_json(t)::text)), 0)::BIGINT
  FROM traces t
  WHERE t.lobby_id = p_lobby_id;
$$;
