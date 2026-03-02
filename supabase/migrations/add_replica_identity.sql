-- Enable REPLICA IDENTITY FULL on traces table for Supabase Realtime DELETE events
-- This ensures that DELETE events include the full row data (including lobby_id for filtering)
ALTER TABLE traces REPLICA IDENTITY FULL;

-- Also enable for other tables that might need realtime updates
ALTER TABLE lobbies REPLICA IDENTITY FULL;
ALTER TABLE profiles REPLICA IDENTITY FULL;
