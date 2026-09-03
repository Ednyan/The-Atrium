# The Digital Atrium

A collaborative infinite canvas. Collect images, video, PDFs, links and notes,
arrange them in space rather than in a list, and let other people walk through
what you built.

Ships as a web app and as a desktop app from one React codebase:

- **Web** — <https://digitalatrium.org>, on Cloudflare Pages, with Supabase
  behind it.
- **Desktop** — a Tauri app with a local SQLite vault, so an atrium can live on
  a disk and never touch a server. Windows, macOS and Linux.

## The source is public. It is not open source.

This repository is readable so that anybody can see what the app does with
their data. **No licence to use, copy, modify or redistribute it is granted.**
See [LICENSE](LICENSE), which is the only statement about this that counts.

It said MIT for a long time -- in a badge, in a footer, and in `package.json`
-- which was left over from a different program that occupied this repository
before the Atrium did. It was never true of this code.

## Layout

| | |
|---|---|
| `src/` | The React app, shared by both platforms |
| `src/lib/supabase.ts` | Exports `isDesktop`; swaps the Supabase client for the local one |
| `src/lib/localDb.ts` | The desktop SQLite shim, with the same `.from()` shape |
| `src-tauri/` | The desktop shell, in Rust |
| `supabase/functions/` | Edge Functions -- contributions, mail, Pinterest |
| `supabase/migrations/` | Schema, applied by hand in the dashboard |
| `extension/` | The browser extension that sends a page to an atrium |

`CLAUDE.md` carries the working notes that matter before changing anything:
what the desktop shim does not implement, how migrations are applied, and how
a desktop release is published.

## Building

```bash
npm install
npm run dev          # web, on :5173
npm run tauri:dev    # desktop
```

Verify with `npx tsc --noEmit -p tsconfig.json`, then `npm run build`.
`npm run tauri:build` for the desktop bundle.

Publishing a desktop update is its own process, with a signing key that cannot
be regenerated. It is written down in [RELEASING.md](RELEASING.md) and should
be read before the first release rather than during it.

## Reporting something

Bug reports and suggestions are welcome, as issues or through the feedback
panel in the app. Pull requests are not being accepted: the licence above means
there is no arrangement under which a contribution could be merged.
