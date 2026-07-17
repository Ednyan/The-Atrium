# Pinterest Integration Setup

One-time setup to make "Connect Pinterest" work. Web only for now.

## 1. Register a Pinterest app

1. Go to https://developers.pinterest.com and sign in.
2. Under **Apps**, create a new app (any name/description).
3. Open the app's settings. Copy the **App ID** (Client ID) and generate an **App secret** (Client Secret).
4. Under **Redirect URIs**, add your production URL exactly as the app serves it (e.g. `https://digital-lobby.pages.dev/` or your custom domain). This must match byte-for-byte what `window.location.origin + window.location.pathname` resolves to when a user clicks "Connect Pinterest" -- if unsure, open the deployed app and copy the address bar's URL up to (not including) any `#` hash.
5. Under **Scopes**, request: `boards:read`, `pins:read`, `user_accounts:read`. These are read-only and fall under Pinterest's Trial access tier -- no app review needed for personal use.

## 2. Frontend: Client ID

Add the App ID to `.env` (already has a placeholder line):

```
VITE_PINTEREST_CLIENT_ID=<your App ID>
```

This is safe to expose in the built frontend -- it's the public half of OAuth. Redeploy the web app after setting it.

## 3. Database migration

Run `supabase/migrations/add_pinterest_integration.sql` in the Supabase SQL Editor (same as every other migration in this project).

## 4. Deploy the Edge Functions

This project has no Edge Functions deployed yet, so the Supabase CLI needs to be linked once:

```bash
npx supabase login
npx supabase link --project-ref <your-project-ref>   # found in the Supabase dashboard URL
npx supabase functions deploy pinterest-oauth-exchange
npx supabase functions deploy pinterest-api
```

## 5. Set the Edge Function secrets

The Client Secret must **never** go in `.env` or any committed file -- it only lives here:

```bash
npx supabase secrets set PINTEREST_CLIENT_ID=<your App ID>
npx supabase secrets set PINTEREST_CLIENT_SECRET=<your App secret>
```

(`SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are auto-provided to every Edge Function already -- nothing to set for those.)

## 6. Test it

1. Open the web app, sign in, open **Profile Settings** → **Connect Pinterest**.
2. Approve on Pinterest's consent screen. You should land back in the app with a "Pinterest connected as @username!" confirmation.
3. Inside an atrium (with edit permission), the HUD should now show an **Import from Pinterest** button. Pick a board and import.

## Also deployed alongside this: account deletion

Profile Settings' "Delete Account" button (web only) depends on two things that ship in this same batch of files but aren't Pinterest-specific:

```bash
# Run in the Supabase SQL Editor:
#   supabase/migrations/add_account_deletion_support.sql
npx supabase functions deploy delete-account
```

No new secrets needed for this one -- it only uses the already-auto-injected service role key.

## Known limitations

- **Web only.** Desktop (Tauri) OAuth needs a custom URL scheme + deep-link plugin this app doesn't have configured yet -- the "Connect Pinterest" section is hidden entirely on desktop.
- **Trial access rate limits.** Pinterest's Trial tier caps request volume and monthly active users of your app. Fine for personal/small-scale use; a public release would need Pinterest's Standard access review.
- **Field names unverified against live data.** The board/pin field mappings in `src/lib/pinterest.ts` (`pickBestImage`, board thumbnail lookup) are written from Pinterest's v5 API docs but haven't been exercised against a real account yet -- first real test may surface a field-name mismatch that needs a small adjustment.
