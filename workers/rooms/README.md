# atrium-rooms

The room each atrium's people meet in: who's here, the introductions for
direct connections, the slow cursor and laser for anyone not connected
directly, and kick notices. It's a Cloudflare Worker with a Durable Object
per atrium (`src/index.ts`), and the web app's `src/lib/rooms.ts` is the other
end. Without it, or whenever it can't be reached, the app uses the Supabase
presence channel as before. See docs/DECENTRALIZING.md, phase 3.

## Deploy (once)

From this folder:

```sh
npm install
npx wrangler login                       # opens the browser: allow
npx wrangler secret put SUPABASE_URL     # https://<project>.supabase.co
npx wrangler secret put SUPABASE_ANON_KEY
npx wrangler deploy
```

`wrangler.toml` puts it on `rooms.digitalatrium.org`, which needs the
digitalatrium.org zone to be in the same Cloudflare account. Wrangler creates
the DNS record itself. If the zone lives elsewhere, comment out the
`[[routes]]` lines: it then deploys to `atrium-rooms.<account>.workers.dev`.

Then set `ROOM_URL` in `src/lib/rooms.ts` to `wss://rooms.digitalatrium.org` (or
the workers.dev address) and deploy the web app.

## Try it before everyone does

In a browser's console, on the live site:

```js
localStorage['atrium.rooms'] = 'wss://rooms.digitalatrium.org' // this browser only
localStorage['atrium.rooms'] = 'off'                            // Supabase only
delete localStorage['atrium.rooms']                            // back to the default
```

## Locally

`.dev.vars` holds the two values for `wrangler dev`. The scratchpad tests
point them at a stand-in for Supabase Auth.

## Free plan

100,000 requests a day, where each WebSocket message in counts as a twentieth
of one. Past that, requests fail; nothing is billed, and the app falls back to
Supabase. Sockets hibernate between messages, so idle rooms cost nothing.
