# The Digital Atrium

A collaborative infinite canvas. Collect images, video, sound, PDFs, slide
decks, spreadsheets, links and notes, arrange them in space rather than in a
list, draw and connect them, and let other people walk through what you built,
live, with their cursors beside yours.

- **Web:** <https://digitalatrium.org>
- **Desktop:** Windows, macOS and Linux, from
  [Releases](https://github.com/Ednyan/The-Atrium/releases/latest). The app
  updates itself.
- **How the code grew:** <https://digitalatrium.org/code-history/>, every
  stage of the codebase as a graph, from the first commit to today.

## Where an atrium lives

The person who makes an atrium decides where it's kept, and the same app reads
all four:

| | |
|---|---|
| **On your computer** | The desktop app keeps atriums in a local vault (SQLite and plain files). They never touch a server. |
| **In your browser** | The same vault in the browser's private storage. No account needed. |
| **In your Google Drive** | Encrypted before it leaves the browser, shared by link. Google holds only sealed files; the key is in the link. |
| **Online** | Hosted on the site's own storage, for atriums that should stay up without anyone's computer on. |

People in the same atrium see each other's cursors and laser over direct,
encrypted connections between their browsers (WebRTC), and each other's saves
the moment they're made.

## Built with

One React and TypeScript codebase for both platforms. The canvas is PixiJS
under a DOM layer for the traces. The desktop shell is Tauri, in Rust. The
site is on Cloudflare: Pages for the app, and a Worker (`workers/rooms`) with
D1, R2 and Durable Objects for accounts, hosted atriums, live rooms and mail.

Supabase was the original backend. Almost everything has moved off it, and
the last step is described in `docs/DECENTRALIZING.md`.

## The source is public. It is not open source.

This repository is readable so that anybody can see what the app does with
their data. **No licence to use, copy, modify or redistribute it is granted.**
See [LICENSE](LICENSE), which is the only statement about this that counts.

It said MIT for a long time, in a badge, in a footer and in `package.json`.
That was left over from a different program that occupied this repository
before the Atrium did. It was never true of this code.

## Layout

| | |
|---|---|
| `src/` | The React app, shared by both platforms |
| `src/lib/supabase.ts` | Exports `isDesktop`; swaps in the local data client where an atrium is local |
| `src/lib/localDb.ts` | The vault: SQLite behind the same `.from()` shape as the online client |
| `src-tauri/` | The desktop shell, in Rust |
| `workers/rooms/` | The Cloudflare Worker: accounts, hosted atriums, live rooms, contributions, mail |
| `supabase/` | The original backend's functions and migrations, being retired |
| `extension/` | The browser extension that sends a page to an atrium |
| `tests/` | Unit tests (`npm test`) |
| `scripts/` | Release, asset and code-history tooling |
| `docs/` | Plans and decisions: decentralizing, scaling, the domain, being found |

`CLAUDE.md` holds the working notes that matter before changing anything:
what the desktop vault does not implement, how migrations are applied, and
how a desktop release is published.

## Building

```bash
npm install
npm run dev          # web, on :5173
npm run tauri:dev    # desktop
npm test             # unit tests
```

Verify with `npx tsc --noEmit -p tsconfig.json`, then `npm run build`. Use
`npm run tauri:build` for the desktop bundle.

The site deploys from the `desktop` branch. Publishing a desktop update is its
own process, with a signing key that cannot be regenerated. It is written down
in [RELEASING.md](RELEASING.md) and should be read before the first release,
not during it.

## Reporting something

Bug reports and suggestions are welcome, as issues or through the feedback
panel in the app. Pull requests are not being accepted: the licence above means
there is no arrangement under which a contribution could be merged.
