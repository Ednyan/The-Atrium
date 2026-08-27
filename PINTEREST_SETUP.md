# Pinterest Integration Setup

One-time setup to make "Connect Pinterest" work. Web only for now.

## 1. Register a Pinterest app

1. Go to https://developers.pinterest.com and sign in.
2. Under **Apps**, create a new app (any name/description).
3. Open the app's settings. Copy the **App ID** (Client ID) and generate an **App secret** (Client Secret).
4. Under **Redirect URIs**, add exactly one value: **`https://the-atrium.pages.dev/`** (with the trailing slash). The app always sends the site root, whatever page you press Connect on, so this is the only URI to register.
5. Under **Scopes**, request: `boards:read`, `pins:read`, `user_accounts:read`. These are read-only and fall under Pinterest's Trial access tier -- no app review needed for personal use.

## 2. Frontend: Client ID

Add the App ID to `.env` (already has a placeholder line):

```
VITE_PINTEREST_CLIENT_ID=<your App ID>
```

This is safe to expose in the built frontend -- it's the public half of OAuth.

**`.env` only covers local dev.** Vite inlines `VITE_*` variables at BUILD time, and the deployed site is built by Cloudflare, so the variable has to exist there too:

1. Cloudflare dashboard → **Workers & Pages** → the `the-atrium` project.
2. **Settings** → **Environment variables** (newer dashboards call it *Variables and secrets*).
3. Add to **Production**: name `VITE_PINTEREST_CLIENT_ID`, value = your App ID. A plain variable is fine -- it is public by design, not a secret. Add it to **Preview** too if you want preview branches to work.
4. Save.
5. **Redeploy.** An existing deployment was built without the variable and will not pick it up: either push a commit, or go to **Deployments** → the latest one → **Retry deployment**.

To confirm it took: open the deployed site and check that Profile Settings shows **Connect Pinterest** rather than complaining the integration is not configured.

## 3. Database migration

Run `supabase/migrations/add_pinterest_integration.sql` in the Supabase SQL Editor (same as every other migration in this project).

## 4. Deploy the Edge Functions

The CLI is already linked (other functions in this project are deployed). Run these **from the repository root** -- deploying from anywhere else has previously shipped a function with a stale copy of `_shared`, which fails at boot while the CLI still reports success:

```bash
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

## Desktop

Desktop does not do its own OAuth. It has no Supabase account to hang a connection on and no https origin for Pinterest to redirect back to, so it borrows a web account's connection instead:

1. Web app → Profile Settings → **Link desktop app**. An eight-character code appears.
2. Desktop app → Profile Settings → Pinterest → type the code → **Link this app**.

The code lasts ten minutes and works once. What the desktop stores afterwards is an opaque link token that means only "read this account's Pinterest boards" -- Pinterest's own tokens never leave the server, and token refresh keeps happening there. Either end can cut it: **Disconnect** in the desktop app hands the token back, and disconnecting Pinterest on the web clears every linked install.

Needs the extra migration and function:

```bash
# Run in the Supabase SQL Editor:
#   supabase/migrations/add_pinterest_desktop_link.sql
npx supabase functions deploy pinterest-desktop-link
npx supabase functions deploy pinterest-api   # re-deploy: it now also accepts a link token
```

Both from the repository root, as above -- `pinterest-api` picks up the shared `_shared/desktopLink.ts` and the widened CORS header, and deploying from elsewhere ships a stale copy that boots and then fails.

## Known limitations
- **Trial access rate limits.** Pinterest's Trial tier caps request volume and monthly active users of your app. Fine for personal/small-scale use; a public release would need Pinterest's Standard access review.
- **Field names unverified against live data.** The board/pin field mappings in `src/lib/pinterest.ts` (`pickBestImage`, board thumbnail lookup) are written from Pinterest's v5 API docs but haven't been exercised against a real account yet -- first real test may surface a field-name mismatch that needs a small adjustment.
