# Decentralizing the Atrium

**Planned 2026-10-12. Phase 1 live; phase 3's room live for everyone (2026-10-14).**

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

## Free at any size, and what can't be (2026-10-14)

The rule: whatever can be free for any number of people is free for
everyone. Whatever grows a bill with use, and has no free way round it, is
for the paid plan only. Every free path degrades rather than breaks when a
free allowance runs out.

**Storage, by where an atrium lives**

| Where | Who can open it | Free at any size? | Ceiling, and what happens past it |
|---|---|---|---|
| The PC (desktop vault) | the owner; others by exported file | Yes: the owner's disk | None for us |
| The browser (phase 7) | the owner; others live while the owner's tab is open, or by exported file | Yes: the owner's browser | None for us. Browsers may clear it unless persistent storage is granted |
| The owner's Google Drive | anyone it's shared with, any time | Yes, up to the app's daily Drive budget | Our app has 400 million quota units a day, for all its users together. Above that, Google plans to bill; prices due later in 2026, with 90 days' notice. Estimate below |
| Our cloud (Supabase or Cloudflare) | anyone, any time | **No**: storage and downloads grow the bill | Paid plan. Existing free cloud atriums keep their limits |

**Drive's daily budget, estimated.** The costs per call are: checking for a
change, 5 units; downloading a file, 200; saving, 50. Assume an hour a day
of use, checking every 5 seconds, a save a minute, and a fresh atrium's
pictures downloaded once and then cached. That's about 11,000 units per
person, so roughly **35,000 people a day** before the threshold. The
assumptions that make this hold:
- Saves reach people online over direct connections (phase 2), so Drive
  downloads are only for whoever wasn't there.
- Pictures are cached in the browser after their first download.
- Change checks read metadata only (files.get or changes.list), never the
  files.

Two more limits: 1 TB of downloads a day per app, and a public file
downloaded very often can be locked for about a day (unofficial reports).
Popular public atriums are mirrored to R2 (phase 8).

**Live presence**

| Part | Free at any size? | Ceiling, and what happens past it |
|---|---|---|
| Cursors and laser between people connected directly | Yes: no server carries them | None |
| The introduction and the roster (who's here) | **Not on Supabase**: 200 connections at once, for the whole app, and 2 million messages a month | Move it (phase 3). Cloudflare Durable Objects (free plan: 100,000 requests a day, with 20 WebSocket messages counted as one; past the limit, requests fail rather than bill). Public Nostr relays (the approach Trystero takes) as the free fallback, with no server of ours |
| The relay, for the 10–20% of pairs that can't connect directly, and for "Hide my IP address" | Up to Cloudflare's 1,000 GB a month | Capped at 800 GB (built). Past it, those people get a cursor every few seconds through the channel. Sending fewer, batched updates over the relay only would stretch the allowance about three times. A paid plan could guarantee the relay |

**Free relays elsewhere** are small: Metered's Open Relay (20 GB a month on
its own page, 500 MB on another), ExpressTURN (about 100 GB, unconfirmed),
Turnix (10 GB), Xirsys (0.5 GB). Running our own relay on Oracle Cloud's
Always Free tier gives 10 TB a month of outbound traffic, but it's a server
to keep alive, and Oracle reclaims instances it judges idle.

**Sharing an atrium that lives only in a browser** needs no server while
its owner is there: guests are introduced (through the free introducers
above), connect directly, and get the atrium from the owner's browser. Once
the owner's tab closes, nobody can reach it. Available any time means Drive
or the paid cloud.

**Small central things that stay**, all within free tiers:
- the list of public atriums (tiny rows in Supabase);
- their pictures (R2: 10 GB stored and 10 million reads a month free, with
  no download fees);
- bans;
- relay passes;
- accounts. Google sign-in costs us nothing, and Supabase Auth covers 50,000
  monthly users.

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
  through the channel. A pair that hasn't connected in 15 seconds, on either
  side, waits 30 seconds before trying again.
- **A link counts only while it carries something.** With nothing else to
  send, each side says "still here" every 2 seconds. Nothing heard for 5
  seconds and that person's Supabase copies are used again; nothing for 20
  (from a side that sends "still here") and the link is made again. A link
  that breaks without closing -- a browser quirk, a network that stops
  passing data -- can make someone slow, never silent. (Firefox once left
  the answering side's link unmarked as open: one person then reached the
  other by neither path. Fixed, and this guards the whole class.)
- **Presence blips don't break links.** Supabase's presence snapshot can miss
  someone for a moment. A connection is let go of only when they leave, when
  their side closes, or at the 20-second reconcile, never on a single sync
  event. Dropping on those used to rebuild every link on each presence
  change, stalling cursors and lasers for a moment each time.
- **The console says how each person reaches you,** once per change:
  `[atrium] Ben: connected directly`, `... connected through the relay`, or
  `... through Supabase (cursor every few seconds)`. With
  `localStorage['atrium.p2p.debug'] = '1'`, every offer, answer and the
  reason each connection ends are logged too.
- **Fewest servers:** with a relay pass, Cloudflare's STUN replaces Google's,
  and of the relay's ports only UDP 3478 and TLS 443 are used (Firefox slows
  its search past four).
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

**Status: built (2026-10-14).** The slow cursor goes through the channel only
while somebody here isn't connected directly *both ways*. Each side's "still
here" now also says whether it hears the other (`ok`), and `reaches()` needs
both. A link broken one way therefore costs a few seconds, not silence. In the
harness, with one side's sends dropped, its cursor came through the channel
after 8 s.

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

**Step 1, built (2026-10-14): the room.** `workers/rooms` is a Cloudflare
Worker with a Durable Object per atrium. It carries what the Supabase presence
channel did: who's here, the introductions, the slow cursor and laser, and kick
notices. `src/lib/rooms.ts` makes it look like that channel to `usePresence`,
and is that channel whenever the room can't be had:
- none configured, or the desktop app;
- signed out;
- unreachable at first;
- lost and not back after three tries (the free plan's day spent, say).

The room checks each sign-in token with Supabase Auth once per connection and
stamps every message with its real sender, so a cursor or an introduction
can't claim to be someone else's (today's channel can't tell).

**Deployed 2026-10-14** on `rooms.digitalatrium.org` (workers/rooms/README.md).
Tried by the user in Firefox and Chrome against each other: presence,
"connected directly", and live cursors and laser all through the room. The
first try was blocked by the site's own CSP (`connect-src`), and Firefox's
throw from the WebSocket constructor then escaped the fallback. Both fixed.
Harness, through a local room (`wrangler dev`):
- pairs, four people, two tabs on one account, hiding, and the delay
  (27 ms cursor, 42 ms laser) are all as on Supabase;
- unreachable from the start, it falls back at once;
- stopped mid-visit, it falls back after 13 s, and the direct link never
  noticed.

**What step 1 doesn't do yet:** the 200-connection ceiling counts connections,
and the atrium's live save updates (traces, layers, links, locations) still
subscribe through Supabase, which holds the connection open anyway. Step 1
lifts the presence *message* caps (2 million a month, 100 a second).

**Step 2, built (2026-10-14): live saves through the room** (`lib/liveChanges`).
Every write the web app makes goes through one `fetch`: lib/supabase hands
supabase-js a wrapper. Each write that succeeds on traces, layers, links or
locations is announced in the room: which rows by id, read from the
request's id filter or body, or the whole table when the write didn't say.
A trace's deletion also announces its links, which the database deletes with
it (on delete cascade).
- **Hearing:** others read those rows again, from their own atrium only, one
  read at a time per table, and apply them with the table's own code. Edits
  not yet saved there, and deletions queued there, are left alone.
- **Choosing the path:** `liveTable` picks per atrium. The room while it has
  one (joining, live, or back after a drop). Supabase's change feed, as
  before, when there's no room, or the room was given up on. The desktop app
  has no room, so it's unchanged.
- **The database stays the record:** an announcement only says where to look,
  and reads still go through its rules.

With the room up, a visitor opens **no Supabase realtime channel at all**:
- presence goes through the room;
- live saves go through the room.

**That lifts the 200-connections ceiling.** Harness, two people through a local
room:

| Ana's action | Seen at Ben's after |
|---|---|
| a new trace | 51 ms |
| a saved move | 1 ms |
| a whole-table change | 6 ms |
| a deletion | 1 ms |
| a location | 55 ms |
| a link | 3 ms |

Ben's unsaved edit survived Ana's save of the same trace. With the room
unreachable, or none configured, all four Supabase feeds open as before.

**The first save wins** (the user's rule, 2026-10-15). Someone else's save of
a trace you've changed but not saved replaces your change; only what you change
after it counts. A deletion you haven't saved is undone too.
- While your own save of that trace is under way, theirs is left alone. Yours
  lands after it and is the record. The trace is read again once your save is
  done, so both sides show what the database kept.
- A whole-table read can't tell which rows they changed, so it leaves your
  unsaved changes alone.
- Supabase's feed (the fallback) can't tell your own save's echo from someone
  else's, so it keeps the old rule there.

**A save arrives whole.** A save writes one request per row. Writes within
120 ms of each other (1.5 s at most) are announced as one, and applied in one
store update (`receiveTraces`). A group of 30 moved traces arrives in a single
step, about 170 ms after the save.

**Known gap:** a write by someone whose room couldn't be reached isn't
announced. The others see it on their next visit.

**Rollout:** tried by the user between Firefox and Chrome (2026-10-15), then on
for everyone (`VIA_ROOM_BY_DEFAULT`). `localStorage['atrium.livesaves'] =
'feed'` turns it off in one browser.

**Later, the original idea:**
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

**The spike, built (2026-10-16).** `lib/drive` and the panel
`components/DriveSpike`, shown with `localStorage['atrium.drivespike'] =
'on'`. The Google Cloud project is `digitalatriumdrive`, apart from the
Supabase login's; the domain is verified. The client id and the key come from
the build (`VITE_GOOGLE_CLIENT_ID`, `VITE_GOOGLE_API_KEY`).

**Firefox 157, first run (2026-10-16):**

| Step | Time |
|---|---|
| Sign in (popup, consent) | works |
| Folder + `atrium.json` | 2.3 s |
| List + read a 25-byte file | 1.4 s (the read alone 0.9 s) |
| 30 saves at once | all saved, no rate limits, 1.2–1.6 s each, 2.1 s in all |
| Change check (metadata only) | 0.25–0.43 s, average 0.29 s |
| 4 MB file | up 3.8 s, down 1.9 s |
| Hidden app folder | works |
| Sharing by address | works |
| Picker | works once the key also allows `https://docs.google.com/*` and the Picker API |

What it means: **a save takes about 1.4 s to land in Drive**, and someone
polling sees it a check (0.3 s) and a read (0.9 s) later. So Drive is the
record, not the live path. Live stays with the room: announce the save, or
carry its content (phase 2's idea), so people online see it at once, with
Drive behind it for whoever comes later. Third-party cookies: Firefox blocks
them by default, and sign-in worked.

**The Picker with a second account (Chrome 155): picking a folder gives
the folder, not what's in it.** Under `drive.file`, the second account saw
none of the 30 files in `saves/`, and only the folder it had just picked in
the atrium's folder. Each person reaches only the files they made or picked
one by one. So phase 5's shared folder of everyone's saves doesn't work as
written: nobody could read anyone else's files. Chrome's sign-in works.

**Then, by id (2026-10-16), as the second account:**

| File | With their own permission | With the app's key alone |
|---|---|---|
| `atrium.json`, shared with them as editor | 404 | 404 |
| `link-test.json`, shared "anyone with the link" | 404 | **read** |

So the free way for collaborators to read each other's files is Drive's
"anyone with the link" plus the app's key, with the ids passed through the
room and the atrium's own file. Each person still writes only files they
made. The catch: a file shared by link is readable by anyone who gets its
id. Encrypting the files, with the key travelling in the invite link's `#`
part (which never reaches a server), would keep them private.

**And a folder shared by link (2026-10-16):** a file made in it afterwards,
never shared itself, is read by link with the key (40 bytes, 1.1–1.3 s), and
the folder is listed with the key (0.36 s). So one shared folder per person
is enough: their saves inherit it, and others find new ones by listing it.

Still to run: Safari, and the desktop apps, which need their own sign-in.

## Phase 5: Drive atriums (opt-in, new atriums only)

**Rewritten 2026-10-16 after the phase 4 spike.** Under `drive.file`, a
collaborator can't read your files even when you've shared them with them;
only files shared "anyone with the link" can be read, with the app's key.
The user chose to share by link, encrypted.

**Encrypted, by link.**
- Each atrium has a random AES-GCM key, made in the owner's browser.
- Every file the atrium writes to Drive is encrypted with it, pictures
  included. Google, Cloudflare and anyone who finds a file id see only
  ciphertext.
- The key travels in the invite link's `#` part, which browsers never send
  to a server. Each member keeps it in their own `drive.appdata` and in the
  browser.
- Removing someone means a new key and the atrium re-encrypted (the app does
  it). Until then, they can still read what they already had.

**Where it lives.**
- **The working copy is a browser atrium** (phase 7): the app reads and
  writes it as it does now, and a sync module carries saves to and from
  Drive. Nothing else in the app needs to know where the atrium is kept.
- **The owner's folder:** the head file (name, theme, members and their
  folders, the latest snapshot), snapshots, and the owner's own saves.
- **Each member's folder:** in their own Drive, shared by link. One file per
  save, named by its hybrid logical clock (time, counter, user), and their
  pictures, by content hash.
- **Finding new saves:** list each member's folder with the key, then read
  what's new. Confirmed by the spike: files inherit their folder's link
  sharing, and the folder lists with the key alone.
- **Joining:** the invite link names the head file. The first time, the
  guest picks it once in the Picker (shown only that file). That gives them
  write access to it under `drive.file`, so they can add their folder to the
  members.

**Merging.** Per row, the latest change wins, by its clock, so a wrong system
clock can't reorder edits. Deletions are kept as tombstones until
compaction. The owner's app folds saves into a new snapshot now and then.

**Live.** Through the room, as now, but carrying the save itself (encrypted)
rather than only its ids, since Drive takes about 2.5 s to show a save to
someone polling. Drive is the record for whoever wasn't there.

**Build order, each step testable:**
1. The encryption and the file format, with the merge (unit tests).
2. Making a Drive atrium, and saves going up.
3. Opening one, and saves coming down.
4. Invites and joining.
5. Members and roles (below), before media, since it changes the format.
6. Live through the room.
7. Pictures and other media, encrypted, cached in the browser.
8. Compaction.

**Members and roles (decided 2026-10-16).** The user chose: only people who
have been added get in, and admins work as in cloud atriums. Built before
media, because it changes the file format.

- **Google decides who may change the member list.** The list
  (`atrium.roster`) is a file in the owner's folder. Only the owner and the
  admins may write it: it's shared with each admin's Google account as an
  editor, with re-sharing turned off. It's readable by link, and it holds no
  email addresses.
- **Keys:** each person has an encryption key pair, kept in their own
  Google account's hidden app folder (`drive.appdata`), so every device they
  sign in on has it. The atrium's key is encrypted for each member, in the
  roster. Every sealed file records which key generation sealed it.
- **The invite link carries no key,** only which roster to read. Anyone
  with it sees the atrium's name, and nothing of what's in it.
- **Joining is a request.** It's made one of two ways:
  - through a mailbox file (`atrium.mailbox`) that the owner or an admin
    shared with the person's Google address ("add someone"). Google lets only
    them write it, so it's approved automatically by the next owner's or
    admin's app that looks;
  - through the room, while an owner or admin is there to approve it.

  Approval adds them to the roster and encrypts every key generation for
  them.
- **Roles:**
  - viewers' saves are ignored;
  - editors' are taken;
  - admins also approve, remove and block, and add people;
  - the owner also promotes admins and deletes.
- **Removing someone** writes a roster without them and a new key
  generation, encrypted for everyone else. Their saves after that are
  ignored, and they can't read anything new (what they already had, they
  keep). **Blocking** also refuses their requests from then on.
- **Leave** (a member) removes it from that browser. **Delete** (the owner)
  removes its folder from Drive, and it closes for everyone.
- **Not protected:** who's present in the room. Its id is in the roster, so
  anyone with the link and an account could see names and cursors (never
  content).

**Built so far (2026-10-16), for testers behind the Drive switch:**
- Steps 1–4: `lib/driveFormat` (sealing, the clock, the merge, the diff),
  `lib/driveSync` (create, the sync, invites, joining), the third place in
  Create, Share on the card, the Join prompt.
- Step 6: a Drive atrium has its room (`isSharedLocal`), so presence,
  cursors and the laser work as in the cloud. Each save goes through the room
  sealed, and those in it take it at once (157 ms in the harness). One too
  big for a room message names its file, which is read at once. The 20 s
  look stays, for whoever wasn't there. Joining shows its steps, and the
  atrium says when it's bringing saves in from Drive.
- The sync brings others' saves down before sending its own: the first save
  wins, and a fresh copy is filled before it's compared.
- Google's sign-in lasts an hour and needs a click to renew. Until it's
  renewed, saves wait in the browser and a button asks to reconnect;
  reading carries on without it.
- **Staying signed in (2026-10-16, the user's choice).** A browser asks
  Google once, in the code flow. The rooms worker holds the app's client
  secret, turns the code into a renewal grant, and hands it back sealed
  (bound to the account; only the worker can open it). The browser keeps
  the grant, and the worker renews the pass with it each hour: no window, no
  button. That's one plain request an hour per person saving, on the
  worker's free 100,000 a day. Without the secret, or when renewing fails,
  the button asks as before. While the consent screen is in Testing, Google
  ends grants after 7 days.
- **Google's robot check (seen 2026-10-16):** after an open atrium had
  downloaded its head every 20 s for a while, Google answered every
  anonymous download from this network with "automated queries" for about
  ten minutes. Reading details and listing folders stayed allowed. In a
  browser this shows as "Failed to fetch". Now the head is downloaded only
  when its version moves, and saves only when new, so an idle atrium
  downloads nothing. **The risk that remains:** many people behind one
  network (a school, an office) all downloading at once. The room carrying
  saves to those online (step 6) is what keeps downloads to catching up.
- Members and roles (c2c340d), as designed above, with these details:
  - people are added by Atrium username;
  - each person's public key and folder are in their profile
    (`add_drive_identity.sql`);
  - the roster is `atrium.roster` (plain JSON, no content);
  - every sealed file starts with its key generation.

  Tested: inviting, letting in, removing with a new generation, blocking,
  viewers, and deleting (scratchpad `drivemembers`).
- **Invitations (9ce8942).** The user asked that joining not wait on the
  owner, and not need a link, and chose to let invited people in at once.
  - Adding someone puts an invitation in their atrium browser
    (`add_drive_invites.sql`).
  - Someone without a key pair is let in at once by a one-off secret that
    only their invitation carries. The roster holds the key sealed with it.
    The next owner's or admin's look lets them in by their key pair, and the
    secret is then deleted.
  - Removing anyone cancels the secrets still standing.
  - The trade-off, accepted: until that look, the Atrium's own database
    holds something that opens the atrium.
- "Keep in Google Drive" turns any browser atrium into a Drive atrium.
- **Pictures and other files (step 7).**
  - Each file goes up sealed, before the save that first needs it, into a
    `files` folder inside its sender's atrium folder, so the folder of saves
    that's listed at every look stays small.
  - The save carries a `media` row (the file's local address → its Drive
    id), merged like any other row.
  - A file comes down once, into the browser's vault at its own address,
    and is never downloaded again. The trace waits for it rather than
    showing it missing (lib/vaultWrites).
  - A file that arrives after its trace (it failed to go at first) shows
    once it's in. One that fails to come is tried again at later looks, each
    wait longer (up to 10 minutes), since Google's robot check passes.
  - Files over 5 MB go up as a resumable upload. Folder listings now read
    every page (Drive gives 1,000 files a page).
  - Tested: scratchpad `drivemedia`.
  - Not tested against the real Google Drive yet: the resumable upload's
    answer (its `Location` header, read across origins).
- **Compaction (step 8).**
  - The owner's app folds every save it has read into one sealed snapshot,
    `atrium.snapshot` in the owner's folder. The snapshot lists the save
    files it holds.
  - It does so once 100 saves aren't in a snapshot, and at most every 30
    minutes, since everyone in the atrium downloads each new one.
  - Readers notice a new snapshot by its version in the owner's folder
    listing, which they already make, so that costs no extra call. They read
    it before the saves, and skip the saves it holds. A joiner reads the
    snapshot and only the saves after it.
  - Each writer's app removes its own saves once a snapshot holds them, 50
    at each look. A save found gone (404) was folded, and comes with the
    snapshot.
  - Deletions are carried for 30 days, then dropped from snapshots.
  - Only the owner compacts: an atrium whose owner never returns keeps
    growing.
  - Tested: scratchpad `drivecompact` (105 saves → a snapshot of 100, the
    folded saves removed, and a fresh copy from the snapshot plus 8 saves).
- **Roles inside the atrium (2026-10-17).**
  - The roster's owner, admins and whether one may edit are written into
    each copy's atrium row, and no save carries them. So the atrium shows
    the right owner and admins, and a viewer gets no edit controls.
  - Changes to the atrium's own row (its name, its theme) are taken only
    from its owner and admins, and only they send them.
  - Saves through the room are taken only from someone whose saves are
    taken. The room says who sent each one: not a viewer, nor someone
    removed, who may still hold a key.
  - Atrium Settings opens the members panel. Share gives the invite link, or
    for an atrium kept only in this browser, saving it as a file.
- **Asking to be let in.**
  - Someone with the invite link who isn't added can ask. Their page says
    so through the atrium's room every 15 s while it waits.
  - An owner or admin inside sees "X asks to join", with Let in (as an
    editor) and Not now. The name is as the room knows the sender, not as
    claimed.
  - Once let in, the asker's page enters by itself.
  - Tested: scratchpad `driveroles` (room stack), `driveui`, `drivejoinui`.

**Unchanged:** Supabase atriums and browser atriums. "Move this atrium to
my Drive" comes later.

**Gate:** a two-person edit session on a Drive atrium survives:
- simultaneous saves;
- one person offline and rejoining;
- 200 MB of media.

## Phase 6: accounts with Google first

**Decided 2026-10-17: the full plan.** New accounts are Google accounts with
no Supabase account at all. Supabase Auth stays for existing accounts and the
public list. Contributions already need no account.

**What a Supabase account carries today, and where it goes:**
- **Who someone is,** to the rooms worker: a Supabase sign-in. Google
  accounts get the worker's own sign-in instead (step 1).
- **Their public profile:** username, display name, and Drive's public key
  and folder. This moves to a directory on Cloudflare (D1), for everyone, so
  a Google account and a Supabase account can add each other (step 2).
- **Drive invitations** (`drive_invites`): also to the directory (step 2).
- **Their own settings:** colour, custom themes. Google accounts keep them
  in their Google Drive's hidden app folder (step 5).
- **Server functions:** Pinterest, feedback, the welcome mail, account
  deletion, the relay pass. They move to the worker for Google accounts
  (step 6).
- **Cloud atriums** stay Supabase's, for existing accounts: paid later.

**Build order, each step testable, nothing breaks existing accounts:**
1. **Identity from the worker.**
   - "Continue with Google" is the code flow the Drive sign-in already uses,
     with `openid email profile`.
   - The worker reads who it is from Google's own answer (the ID token). The
     account's id is a UUID made from Google's id for the person (v5), so the
     app can't choose it.
   - The worker signs short sessions (an hour, HMAC) that it checks itself:
     the rooms accept them without asking Supabase.
   - The renewal grant is the lasting sign-in, bound to the account.
2. **The directory** (D1, free: 5 GB, 5 M rows read and 100 k written a
   day).
   - Accounts: id, username (unique, also against Supabase's), display
     name, Drive key and folder. Email is kept private.
   - Invitations, as `drive_invites` was.
   - Reached through the worker with either kind of sign-in.
3. **The app's account.** One notion of who's signed in, either kind. Sign-in
   leads with Google, with a username chosen in the directory, and the
   session comes back on reload from the grant.
4. **Drive and browser atriums for Google accounts:** finding people,
   inviting, letting in, and the rooms, all through the directory and the
   worker's sessions.
5. **Settings in Drive:** display name, colour and custom themes in the app
   folder.
6. **Server functions on the worker:** relay pass, feedback, deletion,
   Pinterest.
7. **Linking and bans:**
   - an existing account linked to a Google sign-in, keeping its id;
   - banned account ids, checked by the directory and the rooms.

**Built so far (2026-10-17):**
- **Steps 1, 2 and 4 are live for everyone.** The worker signs Google
  accounts in, and the directory (D1 `atrium-people`) holds usernames,
  Drive keys and folders, and invitations. Drive atriums find people there.
  Existing accounts publish themselves as they sign in, and can claim only
  their own Supabase username.
- **Step 3 is for testers only** (`localStorage['atrium.drivespike']='on'`).
  "Continue with Google" makes a Google account, chooses a username in the
  directory, comes back after a reload from its grant, and has browser and
  Drive atriums but no cloud ones.
  - An existing account's Google is linked as it connects Drive. Signing in
    with that Google afresh points to the existing account ("Signed up with
    Google before October 2026?") rather than making a second one.
  - Not yet for Google accounts: profile settings (name, colour), Pinterest,
    feedback, deletion (steps 5-6).
  - Usernames for Google accounts need `add_username_taken.sql` run.

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

**Built (2026-10-15).**
- **The engine:** `lib/browserPlatform` + `lib/browserVault.worker` run the
  desktop's database in the page (sqlite-wasm 3.53, SAH pool), and
  `lib/localPlatform` picks Tauri or the browser. One tab holds the vault (Web
  Locks); a second tab is told it's open elsewhere.
- **Side by side:** `lib/browserAtriums` keeps which atriums are the
  browser's. Inside one, the data client is the engine's (`switchDataClient`)
  and `isLocalData` is true; leaving waits for every write before switching
  back. A browser atrium's data never goes to the cloud. That includes its
  preview, which is made through the client of the atrium it was taken in.
- **The atrium browser:** browser atriums are listed with the cloud's under
  Your Atriums, marked "In this browser", without Copy ID or Settings. "Create"
  asks where to keep the new one, and past the cloud's three it can only go in
  the browser. The count shows cloud atriums only.
- **No account needed:** "Continue without an account" on the sign-in page.
  The guest (one id per browser) sees this browser's atriums only, and is
  asked to sign in for anything shared. Signing in ends guest mode; the
  browser's atriums stay, owned by whoever uses this browser.
- **Not losing work:** making a browser atrium asks the browser to keep its
  storage (`navigator.storage.persist()`). Export lists browser atriums first,
  for guests too, with their files inside the file.
- **Import** asks where to keep the new atrium too, and guests can import.
  Into the browser, files kept in our cloud are copied in, so the copy stands
  on its own. Size: 14 MB into the cloud, 512 MB into the browser.
- **Moving between the two** is export then import, for now. A one-step
  "Move" can come later.

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
| The introducer runs out first | Supabase's free tier: 200 connections at once for the whole app, 2 million messages a month | Phase 3 moves introductions and the roster to Durable Objects (fail closed past 100,000 requests a day), with public Nostr relays as fallback |
| Someone burns the Drive budget on purpose | Drive's quota is the app's, and anyone signed in through it spends from it | Lower the per-person-per-minute quota in Google Cloud; watch the daily total |
| Everyone-to-everyone gets heavy | Data-only meshes go far beyond video's ~4, but no measured number | Measure in phase 1; a partial mesh in phase 3 |
| Popular Drive files get locked | Third-party reports; threshold unpublished | R2 mirror (phase 8) |
| Google bills Drive past a threshold | Since May 2026 Drive counts quota units: 1,000,000 a minute per app, 325,000 per person, and a daily threshold of 400 million per app that can't be raised. Billing above it is planned, with details later in 2026 and 90 days' notice | Cache media, check for changes by metadata, send saves directly (phase 2); a per-person daily budget in the app; keep the local and Supabase paths alive |
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
- Checked 2026-10-14: [Drive API usage limits (quota units, the daily threshold)](https://developers.google.com/workspace/drive/api/guides/limits), [Drive release notes (May 2026)](https://developers.google.com/workspace/drive/release-notes), [Supabase pricing (realtime: 200 connections, 2 M messages)](https://supabase.com/pricing), [Durable Objects pricing (free plan)](https://developers.cloudflare.com/durable-objects/platform/pricing), [Open Relay](https://www.metered.ca/tools/openrelay/), [free TURN list](https://gist.github.com/sagivo/3a4b2f2c7ac6e1b5267c2f1f59ac6c6b), [Oracle Always Free](https://www.oracle.com/cloud/free/), [Trystero](https://npmjs.com/package/trystero)
