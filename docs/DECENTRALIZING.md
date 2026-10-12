# Decentralizing the Atrium

**Planned 2026-10-12. Phase 1 live; not yet tried across two different networks.**

The web version runs on Supabase's free tier, and its four limits are that
tier's ceilings divided between everyone who uses it:

| Limit people feel | Where it comes from (Supabase Free) |
|---|---|
| 3 atriums, 10 MB each | 1 GB file storage, 500 MB database, 5 GB egress a month, for the whole project |
| Live presence | 200 realtime connections at once, and **100 realtime messages a second for the whole project** |
| Account creation | 50,000 monthly active users |
| Permanence online | All atriums live in one central store with the limits above |

The message limit is why other people's cursors move so rarely today:
`usePresence` sends a cursor at most **once every 5 seconds**, and only after
42 units of movement. The laser sends 20 batches a second, so a few people
using it at once would reach the project-wide cap.

This plan removes those ceilings without paid services. It moves the work
that grows with users onto the users' own devices and their own Google
storage. It is built in phases. Each phase ships on its own behind a switch,
and the current system keeps working underneath as the fallback until the
next phase has proved itself.

## The target

- **Live: direct connections between browsers** (WebRTC data channels).
  Cursors, the laser, and saves reaching everyone online. WebRTC encrypts
  every data channel by design, so nothing in between can read or alter what
  flows. No server carries the traffic.
- **Lasting: the owner's Google Drive.** An atrium becomes a folder in its
  owner's Drive. The app asks only for `drive.file` (files it creates or that
  the user picks) and `drive.appdata` (a hidden folder for settings). Google
  classes both as non-sensitive, so there's no security assessment. The limit
  is the owner's own 15 GB. Sharing is Drive's own sharing, and Google
  enforces it.
- **Identity: Sign in with Google.** Google carries the cost of accounts and
  of fighting bots. Supabase Auth remains for existing accounts and for
  publishing to the public list.
- **What stays central is small:**
  - the introduction between browsers (a couple of messages per pair, then
    nothing);
  - the list of public atriums and their pictures;
  - the list of banned accounts;
  - minting short-lived relay credentials.
- **Fallbacks stay:** Supabase cloud atriums as they are today. Local-only
  atriums for anyone without Google, using the desktop vault's design in the
  browser. The current realtime path wherever a direct connection can't be
  made (see Risks).

## Ground rules for every phase

1. **Additive.** Nothing existing is removed in the phase that adds its
   replacement. The new path runs beside the old one, and the old one is used
   whenever the new one isn't available or fails.
2. **Behind a switch,** with a kill switch that turns it off without a release
   for anyone who needs it gone. Gradual: testers first, then everyone.
3. **A gate before the next phase:** what has to be measured or true first.
4. **Schema changes follow the project's migration rules** (hand-applied,
   idempotent, before the web deploy).
5. **Each phase leaves the code better if the plan stops there.**

## Phase 1: live cursors and laser over direct connections

**Status: live (2026-10-12).** Works between real devices on one network;
two different networks not yet tried. Code: `lib/peers.ts` (the
connections), `usePresence` (the introductions), `lib/playback.ts` (when to
show what arrives), `RemoteCursors` and `lib/laser` (the drawing).

**Why first:** it needs no storage, no Google setup and no data migration. It
is entirely additive, and it fixes something everyone sees: cursors that jump
every 5 seconds become live.

**How it works**
- **The introduction** goes through the atrium's existing presence channel
  (`usePresence`), as one message each way per pair. Each browser waits until
  it knows all its own addresses and sends them in one message (no trickle
  ICE), so a connection costs two realtime messages and nothing after.
- **Who starts:** in each pair, the person whose user id sorts first sends the
  offer, so two offers never cross.
- **Addresses** come from Google's public STUN server. No relay yet; see 1b.
- **The channel** is unordered, with no retransmits. A cursor position or
  laser batch overtaken on the way is dropped, never waited for.
- **Sending:** the cursor every frame it moves, stamped with the moment the
  pointer was there on the sender's clock. Every pointer sample counts: the
  store's own throttle (2 world units or 50 ms, for what redraws the
  position) once held back slow movements and the last steps before
  stopping. Laser batches every frame to those connected directly; for anyone
  who isn't, the batches since the last are gathered into one Supabase message
  every 250 ms (4 a second, where it was 20) and played a quarter of a second
  behind.
- **Playback:** what arrives is shown by the sender's clock, as late as the
  slowest arrival of the last second, but never more than 150 ms behind the
  quickest. Motion plays back as evenly as it was made, through a jittery
  network, with the least delay that allows (`lib/playback.ts`).
- **Drawing:** remote cursors are moved every frame from a plain map, never
  through React state. `TraceOverlay` subscribes to `otherUsers`, so a store
  update per cursor message would redraw every trace for every move.
- **Who can connect:** each person's presence says whether they can
  (`link`), so nobody makes an offer to a browser without WebRTC.
- **At most 16 direct connections** per person; anyone past that is reached
  through the channel. A pair that fails waits 30 seconds before trying again.
- **The online list** marks the people connected directly (a green diamond).
- **The roster** (who's here, names, colours) stays on Supabase presence,
  unchanged.

**What doesn't change:**
- The Supabase cursor broadcast keeps running for everyone, every 5 seconds,
  until 1c.
- The laser goes through Supabase only while someone here isn't directly
  connected, and then 4 messages a second per person pointing. With everyone
  connected, a laser costs no realtime messages.
- Receivers ignore the Supabase copy from someone they're directly connected
  to.
- Ghost mode connects to no one. Being kicked closes every connection.

**Switch:** on where `RTCPeerConnection` exists. Under Profile → People in
the room → "Hide my IP address", anyone can connect only through the relay
instead (1b), or through the channel while there's no relay pass. It takes
effect at once. The setting is stored as `localStorage['atrium.p2p'] = 'off'`.

**Security:** the trust boundary is the same as today, since only people
already in the atrium's channel can introduce themselves. Two known limits:
- **IP addresses:** directly connected people can see each other's. The
  introductions go to the whole atrium channel, so anyone in the atrium can
  read the address of anyone who connects directly (the same people a full
  mesh connects to anyway). With "Hide my IP address" on, a person's
  introductions carry only the relay's address (1b), or none at all.
- **Spoofed senders:** the introduction carries the sender's user id unchecked,
  exactly as today's broadcasts do. Someone already in the atrium could spoof
  another person's cursor, no more than today.

**Test:**
1. Two harness tabs, with a channel that crosses tabs (`BroadcastChannel`):
   live cursors, the laser, a leave closing its connection, and the kill
   switch. **Done.**
2. Two real browsers on different networks: home and mobile hotspot, then an
   office or university network. **Still to do.**

**Harness results** (headless Edge, tabs of one browser):

| What | Result |
|---|---|
| A pair connecting | 0.32 s, two realtime messages |
| A cursor arriving | 0–46 ms (every 5 s before) |
| Four people | all 6 pairs connected, 12 messages in all; no laser through Supabase |
| One of four without WebRTC | the other three connect (6 messages, none to the fourth); the fourth still gets every cursor and laser through the channel |
| Someone leaving | their connection closes |

**Delay** from the sender's pointer to the other screen (harness; a second
run holds each message back a random 0–40 ms, as a phone network does):

| | First version | Now | Now, with 0–40 ms jitter (first version) |
|---|---|---|---|
| Cursor | 65 ms, moving in pulses | 27 ms | 56 ms (85 ms) |
| Laser | 109 ms | 42 ms | 70 ms (123 ms) |

The laser figures include the sender's own smoothing of the line, which they
see too.

Tabs of one browser share a machine, so this says nothing about getting
through routers. That is what test 2 is for.

**Gate for phase 2:**
- the share of pairs that connect directly (expected 80–90% without a relay);
- latency;
- CPU with five people moving;
- Supabase messages per minute, before and after.

### 1b: the relay, last resort and IP shield

**Status: built (2026-10-13), waiting for the Cloudflare key.**

The order, for each pair:
1. **Directly,** whenever the two networks allow it. Nothing goes through the
   relay; ICE tries every address and prefers direct ones.
2. **Through the relay** when they don't (a strict network), and always for
   someone with "Hide my IP address" on: only their connections use it
   (`iceTransportPolicy: 'relay'`), so the others see Cloudflare's address.
3. **Through the presence channel** (a cursor every few seconds) when there's
   no relay pass: the budget is spent, or the relay isn't set up.

**The relay:** Cloudflare's TURN, 1,000 GB a month free, then $0.05 per GB.
The TURN key must stay on a server, so `supabase/functions/relay-pass` hands
out passes (12 hours, signed-in people only). The browser keeps its pass for
as long as it lasts (`localStorage['atrium.relay']`), and a refusal for an
hour, so it's about two invocations per person a day, against 500,000 free a
month. An answer is waited for 4 seconds at most before connecting without
one.

**The cap:** before each pass, the function asks Cloudflare's analytics
(GraphQL, `callsTurnUsageAdaptiveGroups`, egress) how much the account's
relay sent over the last 31 days. That window covers any billing month. Past
`RELAY_BUDGET_GB` (800 by default) it refuses, and so on any doubt: a secret
missing, or the usage unknown. The margin covers passes already out and the
analytics' delay. A hidden person whose pass can't be renewed goes back to
the channel and tells the others.


**Setup (the user):**
1. Cloudflare dashboard → Realtime → TURN → create a key: its id and API
   token.
2. Cloudflare → My Profile → API Tokens → create a token with Account →
   Account Analytics → Read; and the account id (the dashboard's URL).
3. Supabase → Edge Functions → Secrets: `CF_TURN_KEY_ID`,
   `CF_TURN_KEY_TOKEN`, `CF_ACCOUNT_ID`, `CF_ANALYTICS_TOKEN`; optionally
   `RELAY_BUDGET_GB` (gigabytes over 31 days; `0` switches the relay off).
4. Deploy the function: `npx supabase functions deploy relay-pass`.

**Tested** with a local relay (node-turn) and two harness tabs:
- hiding, Ana's introductions carry only the relay's address;
- the link runs through the relay, and her cursor is live;
- with no pass, she sends no introductions and her cursor comes through the
  channel;
- a strict network (each side unable to use the other's direct addresses)
  connects through the relay, and with no pass falls back to the channel.

### 1c: stop the Supabase cursor broadcast for directly connected pairs

Once 1 has run in production for a while.

## Phase 2: saves reach everyone online directly

**Goal:** collaborators see a save the moment it's made, without waiting on
database change events. This prepares phase 5, where Drive can't push changes
to browsers at all.

**How:**
- After `saveAllChanges` succeeds, the saved batch (trace upserts and
  deletions, layers, links) goes to every directly connected peer, over a
  second, reliable and ordered data channel.
- Receivers apply it as they apply a database change event today, and
  de-duplicate when the same change also arrives from Supabase.

**Unchanged:** Supabase stays the record. A missed or late direct message
costs nothing, because the database event still arrives.

**Gate:**
- saves appear on others' screens in under 200 ms;
- no duplicates, and no resurrected deletions in a two-person editing session.

## Phase 3: presence without holding a server connection

**Goal:** the 200-connections ceiling becomes "200 people joining in the same
moment", not "200 online".

**How:**
- The roster moves onto the direct connections. Each peer announces its name
  and colour, and heartbeats it.
- The Supabase channel is opened to join (the introductions), kept only while
  someone new may arrive, and closed when idle.
- Kicking remains enforced by the server through the blacklist. The broadcast
  notice also goes over the direct connections.

**Risk: everyone connects to everyone.** That's comfortable for 10–20 people.
For a large public event, people would relay for each other (a partial mesh),
or such an atrium falls back to the server path.

**Gate:** a 10-person session across real networks works without the Supabase
channel held open.

## Phase 4: Google sign-in and a Drive spike (no user-facing change)

**Setup (the user, in Google Cloud):**
- a project and an OAuth client for the web origins and the desktop app;
- a consent screen, with brand verification (2–3 business days);
- scopes `openid email profile drive.file drive.appdata`;
- the Picker API with an API key.

**Spike, behind a developer flag:**
1. Sign in with Google Identity Services (the token model: short-lived access
   tokens and no refresh token in the browser; how silent renewal behaves is
   to be confirmed here).
2. Create an atrium folder in Drive, and write and read files in it.
3. Share it with a second account. The second account opens it once through
   the Google Picker: `drive.file` only reaches files the app created or the
   user picked.
4. Measure upload and download times for small JSON files and for media.
5. Check quotas and errors under bursts of saves (exponential back-off on
   403/429).
6. Check third-party-cookie behaviour. draw.io notes Drive connections failing
   when third-party cookies are blocked.

**Gate:** all of the above work in Chrome, Firefox and Safari, and in the
Windows (WebView2) and macOS (WKWebView) desktop apps.

## Phase 5: Drive atriums (opt-in, new atriums only)

**Format (a folder per atrium):**
- `atrium.json`: a snapshot (traces, layers, links, theme, a version).
- `saves/<userId>/<sequence>.json`: one small file per save, written only by
  that person. No two people ever write to the same file, so nothing is
  overwritten.
- `media/<sha256>.<ext>`: content-addressed, like the vault.
- `preview.webp`.

**Merging:**
- Per trace, the latest change wins. The order comes from a hybrid logical
  clock (time, counter, user id), so a wrong system clock can't reorder
  edits.
- Deletions are kept as tombstones until compaction.
- The owner's app folds saves into the snapshot now and then, so opening
  stays fast.

**Live:** phase 2's direct announcements. Anyone not connected checks the
folder every few seconds. Drive can't notify browsers itself; its push
notifications go to servers only.

**Sharing:**
- Drive's permissions: view or edit.
- A link that opens the atrium, where a first-time guest is taken through the
  Picker once.

**Media:** fetched through the API with the viewer's permission, then cached
locally (IndexedDB).

**Unchanged:** Supabase atriums. A "Move this atrium to my Drive" action comes
later, optional and reversible (export first).

**Gate:** a two-person edit session on a Drive atrium survives:
- simultaneous saves;
- one person offline and rejoining;
- 200 MB of media.

## Phase 6: accounts with Google first

- **Profiles** (name, colour, settings) live in `drive.appdata`.
- **Supabase Auth only where needed:** existing accounts, publishing an atrium
  to the public list, and contributions. That keeps monthly active users far
  below the free 50,000.
- **Linking:** an existing account can be linked to a Google identity.
- **Bans:** a list of banned Google account ids, checked by the public list and
  the introduction step.

## Phase 7: local atriums in the browser, for everyone else

- **The engine:** the desktop vault's design on the web, SQLite compiled to
  WebAssembly over the browser's private file system (OPFS).
- **The storage backend:** the `opfs-sahpool` VFS needs no special headers and
  works from Safari 16.4. The default OPFS VFS doesn't work below Safari 17.
- **Reuse:** it reuses the `localClient` shim, so the same code paths serve
  desktop and web.
- **Not losing work:** ask for persistent storage
  (`navigator.storage.persist()`) and keep the `.atrium` export prominent.
  Without persistence, browsers may clear site data under storage pressure.
- **Order:** independent of phases 4–6, so it can move earlier.

## Phase 8: public atriums at scale

- **Viewing:** a public atrium is "anyone with the link can view" in its
  owner's Drive. Viewers read it with the app's API key, so they don't need to
  sign in.
- **Popular files:** Drive locks a very popular shared file for about 24
  hours, at an unpublished threshold. Popular public atriums are mirrored to
  Cloudflare R2 (10 GB free, no download fees), or served by viewers who
  already have them.

## Phase 9: retiring the limits

- **New atriums default to Drive** for people signed in with Google, and to
  local otherwise.
- **Supabase atriums keep their limits,** with "Move to my Drive" offered.

## Risks

| Risk | What we know | Mitigation |
|---|---|---|
| Linux desktop has no WebRTC | WebKitGTK, which Tauri uses on Linux, lacks it without hacks; WebView2 and WKWebView have it | Nothing is lost today: desktop atriums are one person's, with no live presence. If the app ever joins shared atriums, Linux falls back to the presence channel, or a browser |
| Some networks block direct connections | Vendor estimates: 10–20% of sessions need a relay (no authoritative data) | 1b: Cloudflare TURN, 1,000 GB free |
| The relay bills past its free tier | $0.05 per GB after 1,000 GB a month; what happens without a card isn't documented | `relay-pass` refuses past 800 GB in the last 31 days, read from Cloudflare's analytics; those people fall back to the channel. A cursor moving every frame is about 8 KB/s, so 800 GB is ~28,000 hours of one hidden cursor moving non-stop |
| R2 needs a card on file | Secondhand reports: activating R2 asks for a payment method, though the free tier isn't charged | Pictures stay in Supabase Storage until its 5 GB of downloads a month gets tight |
| Brand review trips over supabase.co | Community reports: the sign-in callback is on Supabase's domain, which we can't prove we own | Drive gets its own Google Cloud project, whose only domain is digitalatrium.org |
| Everyone-to-everyone gets heavy | Data-only meshes go far beyond video's ~4, but no measured number | Measure in phase 1; a partial mesh in phase 3 |
| Popular Drive files get locked | Third-party reports; threshold unpublished | R2 mirror (phase 8) |
| Google changes billing or policy | The Drive API page announces billing details in 2026 (charges tied to egress above 1 TB a day per project) | Keep Supabase and local paths alive; watch the page |
| Token renewal UX | Browser tokens are short-lived | Measure in the phase 4 spike |
| Guest's first visit needs the Picker | `drive.file` requires it | One-time step, designed in phase 5 |
| Phones sleep background tabs | Direct connections drop | Reconnect on resume; the presence fallback stays |
| Moderation | Content in users' Drives isn't seen by the server | Reports with screenshots; bans by Google id |

## Sources

- Supabase limits: [Realtime limits](https://supabase.com/docs/guides/realtime/limits), [Realtime authorization](https://supabase.com/docs/guides/realtime/authorization), [pricing guide 2026 (jetadmin)](https://www.jetadmin.io/blog/supabase-pricing-2026-guide-to-plans-limits-and-real-world-costs/)
- Google: [Choose Drive API scopes](https://developers.google.com/workspace/drive/api/guides/api-specific-auth), [Drive API usage limits](https://developers.google.com/workspace/drive/api/guides/limits), [Picker](https://developers.google.com/picker/docs/), [Unverified apps](https://support.google.com/cloud/answer/7454865?hl=en), [Brand verification](https://developers.google.com/identity/protocols/oauth2/production-readiness/brand-verification), [OAuth app verification](https://support.google.com/cloud/answer/9110914), [custom thumbnails](https://developers.google.com/drive/api/guides/file-metadata), [Supabase: Login with Google](https://supabase.com/docs/guides/auth/social-login/auth-google), [a brand review stuck on the Supabase domain](https://discuss.google.dev/t/oauth-branding-verification-stuck-name-mismatch-due-to-supabase-callback-domain-no-trust-safety-email-received/389007)
- Cloudflare: [Realtime/TURN pricing](https://developers.cloudflare.com/realtime/pricing/), [TURN credentials](https://developers.cloudflare.com/realtime/turn/generate-credentials/), [R2 pricing](https://developers.cloudflare.com/r2/pricing), [Durable Objects pricing](https://developers.cloudflare.com/durable-objects/platform/pricing), [TURN FAQ](https://developers.cloudflare.com/realtime/turn/faq/), [R2 setup asking for a card (secondhand)](https://dev.to/leonwong282/the-complete-beginners-guide-to-cloudflare-r2-image-hosting-2025-2g4k)
- draw.io: [Cloud storage](https://drawio.com/blog/cloud-storage-diagrams), [Real-time collaboration](https://www.drawio.com/blog/real-time-collaboration-diagrams.html)
- WebRTC: [TURN share estimates (Twilio FAQ)](https://www.twilio.com/docs/api/stun-turn/faq), [Tauri WebRTC on Linux](https://github.com/tauri-apps/tauri/discussions/8426)
- Browser SQLite: [SQLite WASM persistence](https://sqlite.org/wasm/doc/tip/persistence.md)
