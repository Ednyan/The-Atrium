// Shared CORS headers for Edge Functions called directly from the browser.
// Wide open (not locked to a specific origin) since these functions are
// already gated by requiring a valid Supabase user JWT -- the origin header
// isn't a meaningful trust boundary here, just needs to not block the
// browser's preflight.
export const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
