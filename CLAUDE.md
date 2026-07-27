# The Digital Atrium

Collaborative infinite-canvas app. Ships as a web app (Supabase) and a Tauri
desktop app (local SQLite vault), from one React codebase.

## Platform split

`src/lib/supabase.ts` exports `isDesktop`. Desktop swaps the real Supabase
client for `localClient` in `src/lib/localDb.ts` — a SQLite-backed shim with
the same `.from()/.storage/.rpc()` shape.

**The shim is not complete.** Its query builder implements `eq, neq, in,
ilike, order, limit, single, maybeSingle` — and nothing else. A missing method
throws a `TypeError` rather than returning an error, so it escapes
`if (error)` checks and takes down the whole calling function. This has caused
real bugs (`.contains()` broke the entire desktop atrium browser). Check the
shim before using a query method on a shared code path, and gate web-only
features on `!isDesktop`.

Desktop also has no `.functions`, so Edge Function calls are inherently
web-only.

## Releasing desktop updates

See **RELEASING.md**. Short version: bump the version, build with
`TAURI_SIGNING_PRIVATE_KEY` exported, run
`node scripts/make-release-manifest.mjs "notes"`, attach the `.exe`, `.sig`
and `latest.json` to a GitHub release.

The signing key lives at `C:\Users\Ednyan\Desktop\atrium-updater-keys\` and is
gitignored. It must never be regenerated — installed apps only trust updates
signed by the key already compiled into them.

## Conventions

- Trace edits are **deferred**: `markTraceChanged`/`markTraceDeleted` queue
  changes, and nothing hits the database until `saveAllChanges()`. Locations
  use the same working-copy + dirty-flag pattern.
- Schema changes need a migration in `supabase/migrations/` **applied before
  the web build deploys** — the save payload includes new columns immediately,
  so an unapplied migration makes Postgres reject every trace save.
- Desktop schema changes additionally need an additive `ALTER TABLE` in
  `localDb.ts` for existing vaults.
- Verify with `npx tsc --noEmit -p tsconfig.json` then `npm run build`.
  `npm run tauri:build` for desktop.
