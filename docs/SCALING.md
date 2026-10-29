# Scaling the web app: tiers and costs

Rewritten 2026-10-23, now that the web app runs on Cloudflare
(docs/DECENTRALIZING.md, phase 10). Updated 2026-10-29: worker requests per
person measured on the live site and cut about sixfold, the tiers redone
from them. A plan to read when usage grows, or before spending money on the
web app.

**Recheck before buying.** Cloudflare's prices were checked on 2026-10-29
and are unchanged since late 2025; Resend's and Brevo's are as known then.
Usage per person is part measured, part estimate (below). The app's
Developers → Health shows every free-plan meter, today and over 30 days:
redo these tables from it once there's real traffic.

## What runs where

- **Cloudflare Pages**: the website, static and free at any size. The image
  proxy (`functions/api/proxy-image.js`) is a Pages Function and shares the
  Workers request allowance.
- **The rooms worker** (`workers/rooms`, rooms.digitalatrium.org):
  - Accounts, Google and email, in D1 (`atrium-people`). The page stretches
    a password (PBKDF2, 600,000 rounds) and the worker keeps a salted hash
    of that. Also there: sessions, the directory, invitations, Pinterest,
    bans, operators, settings, themes and visits.
  - Live rooms: one Durable Object per atrium. They use the WebSocket
    Hibernation API, so a room is billed only while it handles a message.
    A room carries live saves, presence, and the slow cursor for anyone not
    connected directly.
  - The hosted store (`/store/*`). It holds online atriums' sealed saves
    and files in R2, and their listing in D1. Each account gets 3 atriums
    and 50 MB, with at most 25 MB a file.
  - The public mirror (`/mirror/*`): public Drive atriums' files copied to
    R2 (up to 200 MB each), so visitors read them from us and not from
    Google.
  - Relay passes (Cloudflare TURN), capped at 800 GB a month
    (`RELAY_BUDGET_GB`).
  - Contributions (Stripe Checkout and its webhook), reports and mail, and
    the operator's Health.
- **Google Drive**: Drive atriums, kept in each person's own Drive, so their
  storage is never ours. API use is free up to 1,000,000 quota units a
  minute and 400 million a day per project.
- **The browser and the desktop app**: browser atriums and the desktop
  vault cost us nothing.
- **Mail** (`workers/rooms/src/mail.ts`) goes through Resend and Brevo.
  Resend's free plan allows 100 a day and 3,000 a month; Brevo's allows
  300 a day.
  - Sign-up and reset codes go by Resend alone. Brevo adds an Unsubscribe
    link to everything it sends, and one click would silently stop that
    address's later Brevo mail.
  - Mail that can wait goes by Brevo first, then Resend up to 80% of its
    day, so the rest of Resend's day is kept for codes.

## The usage model

- Monthly actives ≈ 3 × daily actives. People at the same moment, at the
  daily peak, ≈ 8% of daily actives.
- About 20% of people keep online (hosted) atriums, using about 10 MB each
  on average. The rest use Drive, the browser or the desktop.
- **About 15 worker requests a day** from each daily active person.
  Measured on the live site on 2026-10-29 with `wrangler tail`, one visit
  at a time, after that day's changes:
  - opening the atrium browser: 2 (signing in, with the directory's reads;
    then the cards' versions and one's own folder);
  - entering an atrium: 2 (its room, and one look at what changed while
    away), or 1 and the occasional Google renewal for a Drive atrium, whose
    files are Google's;
  - saving through the room, staying in an atrium with its room live, and
    coming back to the browser: nothing. Nothing is asked on a timer.
  - Besides: the Google sign-in renewed about hourly while Drive is used,
    saves stored every 2 minutes while someone edits an online atrium (below),
    files read the first time on a device, and the image proxy.

  A visit (open the browser, two atriums, a change, back) was 10 requests,
  where that morning it was about 30, and an atrium left open spent about
  150 an hour doing nothing.
- **About 12 Durable Object requests a day** each: a room for each atrium
  entered, and incoming messages (20 bill as one request). Owners and
  admins no longer keep a second connection at the atrium's door: asks to
  be let in are kept by the directory.
- **Saves to online atriums** are the big unknown.
  - A save goes out after each 1.5 s pause (`QUIET_MS` in `lib/driveSync`).
    With the room live, which is whenever someone's inside, it goes
    through the room at once, and into the store with the others every 2
    minutes (`KEEP_MS`; every 30 s before 2026-10-29).
  - Each stored save is one new file: one R2 write, and about 3 D1 rows
    written (its listing row and two indexes). The write throttle adds its
    own row once every ten writes.
  - Assumed: one person in ten edits an online atrium on a given day, for
    about 15 stored saves at 30 s (about 150 before any batching). At 2
    minutes it's about 4, so the R2 and D1 figures in the table, made at
    30 s, are on the high side.
  - Per daily active person, with uploads, sessions and throttles: about
    2.5 R2 writes and 15 D1 rows written a day. (20 before 2026-10-29:
    visits are now sent once a sitting, nothing is written to one's profile
    unchanged, and an invitation's secret is cleared once.)
- About 20 R2 reads a day each: files opened, and the mirror.
- About 15% of people can't connect directly and go through the relay, at
  about 15 MB an hour of cursors and laser.
- Mail ≈ 15% of monthly actives a month: sign-up codes, welcomes, resets
  and reports.

## Tiers and costs

Per month, at list prices. Workers Paid ($5) from Tier 1. Redone 2026-10-29
from about 15 worker requests, 15 D1 rows and 12 DO requests a day per daily
active person (above); R2, mail and the relay are as on 2026-10-23.

| Tier | Daily active | Monthly active | At once | Workers (requests, CPU) | Durable Objects (rooms) | D1 (database) | R2 (files) | Mail | Relay (TURN) | Monitoring | **Total a month** |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 0, free plans | up to ~6,000 | ~18,000 | ~500 | $0 | $0 | $0 | <$1 | $0 | $0 | — | **<$1** |
| 1 | 10,000 | 30,000 | ~800 | $5 | ~$1 | $0 | ~$1 | $0 | $0 | — | **~$7** |
| 2 | 50,000 | 150,000 | ~4,000 | ~$10 | ~$4 | $0 | ~$24 | $20 | $0–35 | $0–26 | **~$60–120** |
| 3 | 150,000 | 450,000 | ~12,000 | ~$26 | ~$25 | ~$22 | ~$91 | $90 | $0–200 | $26 | **~$280–480** |
| 4 | 300,000 | 900,000 | ~25,000 | ~$50 | ~$54 | ~$90 | ~$188 | ~$150 | $0–450 | ~$80 | **~$610–1,060** |

Before 2026-10-29 (about 40 worker requests and 20 D1 rows a person) the
free plans ended near 2,500 daily actives, and the totals were about $8,
$75–135, $350–550 and $750–1,200.

- **Workers** is the $5 plan itself up to Tier 1; past 10M requests a month
  (about 22,000 daily actives) it's $0.30 a million, and CPU (about 3 ms a
  request) past 30M ms.
- **Durable Objects**: requests past 1M a month, and duration. Rooms use
  the WebSocket Hibernation API, so a room is billed only while it handles
  a message.
- **D1** is rows written past 50M a month, and storage past 5 GB.
- **R2** bills from the first unit past its free allowance, on any plan:
  storage past 10 GB (Tier 0's few cents), writes past 1M a month, reads
  past 10M.
- **The ranges** are the relay and monitoring. The relay is capped at
  800 GB a month, which costs nothing; past the cap, the people it would
  carry get a slower cursor through the room. Raised, it's about 5, 15 and
  30 TB a month at Tiers 2–4 at full quality, a third of that with cursors
  every 50 ms (the figure above). Monitoring is optional at Tier 2.

## The walls on the free plans

Daily limits reset at 00:00 UTC.

1. **Workers, 100,000 requests a day** (the worker and the image proxy
   together). At about 15 a person, that's about 6,500 daily actives.
   Past it the worker answers nothing: no sign-in, no rooms, no online
   atriums, no public list. Browser and desktop atriums don't notice.
   Visitors to the landing page count too: each view reads the
   contribution wall (see Changes still to make).
2. **D1, 100,000 rows written a day.** At about 15 a person, that's about
   6,500 daily actives too: the two walls now come together. Past it,
   until midnight UTC, nothing that writes works:
   - signing in and staying signed in;
   - saves to online atriums;
   - invitations and settings.
3. **Durable Objects, 100,000 requests a day**, about 8,000 daily actives.
   Rooms fail, and saves are then stored at once, as without a room.
4. **CPU, 10 ms a request.** This isn't a daily wall: any request that runs
   past it fails. Typical use is well under it (Health shows p50 and p99).
   The worker is minified to keep cold starts short.
5. **D1's size, 500 MB a database** (Health: database size).
6. **R2 is billed, not a wall.** It's enabled with a card on file, so past
   its monthly free allowance it bills from the first unit over, on any
   Workers plan. The allowance is 10 GB stored, 1M writes and 10M reads.
   At about 75 writes a person a month, writes pass 1M at about 13,000
   daily actives. Storage passes 10 GB at about 1,700: pennies a GB.
7. **Mail, 400 a day**: Resend 100 and Brevo 300, with Resend also limited
   to 3,000 a month.
   - Codes go by Resend alone: up to 100 a day, and at least 20 even when
     everything else is spent.
   - On an even day this lasts to about 27,000 daily actives.
   - Sign-ups come in bursts (a post, a launch). A burst of more than about
     100 codes in a day is the real limit, before the 400.
8. **The relay never bills.** Past 800 GB in 31 days it gives no more
   passes, and those people's cursors go through the room instead. That's
   slower, and costs a few more DO requests.
9. **Google Drive** isn't a wall below Tier 4, now that an atrium with a
   live room looks every 2 minutes rather than every 20 s.

## Changes made for scale

- **Looking less.** How often an atrium checks for changes:
  - with its room live, never on a clock: as it opens, and as the room
    comes back after a gap (every save is told through the room, which
    holds what's sent while it reconnects);
  - otherwise every minute for an online atrium, and every 20 s for a
    Drive atrium (`lookEvery` in `lib/driveSync`);
  - never while the app is behind other windows or minimised.
- **The R2 mirror of public atriums.** Visitors read from us, so there's no
  Google robot check and no file locked for being read too often.
- **Nothing on a clock for what a reload shows** (2026-10-29). The atrium
  browser's cards, invitations and public list, the cards' player counts,
  the special themes and the contribution wall are asked as their screen
  opens, or on a reload, not on a timer. Keep anything new this way: a
  timer that reaches the worker is kept only where correctness needs it
  (an atrium's looks without its room, sign-in renewals).
- **A screen's reads in one request** (2026-10-29, `lib/worker`):
  - reads wait for a 250 ms pause (700 ms at most) and go together in one
    `/batch`, up to 32 at once;
  - a screen's start is held and sent together (`holdReads`): signing in
    brings the first screen's directory reads (`askAhead`), and the atrium
    browser's cards, versions and one's own folder go in one more;
  - the directory's answers are kept for the visit (30 minutes at most),
    and a write forgets only what it changes;
  - an atrium's opening look asks its roster's version and its writers'
    folders, known from before, in one round.
- **Asking to be let in is one request, kept** (2026-10-29). It was a
  socket at the atrium's door saying so every 15 s, and every owner and
  admin inside kept a socket there to hear it. Now the directory keeps the
  ask a fortnight, and an owner's or admin's app reads it as it opens the
  atrium.
- **Saves stored every 2 minutes while the room is live** (2026-10-29,
  `KEEP_MS`), not every 30 s: a quarter of the store writes -- requests, R2
  writes and D1 rows -- while someone edits. Someone opening the atrium
  with nobody in its room sees edits up to 2 minutes late.
- **Writes only when something changed**: one's name and Drive key, one's
  hosted folder, an invitation's secret, the visits (once a sitting).
- **Mail through two free providers, codes first.**
- **Throttles where one person could spend everyone's day:**
  - store writes: 3,000 an hour an account;
  - reports: 5 an hour a network, 30 an hour in all;
  - codes: 8 a day an account, and 40 tries;
  - Checkout: 30 an hour a network.

  The free Cloudflare rate-limiting rule (100 requests per 10 s per IP,
  file traffic and Stripe's webhook excepted) bounds floods. Only Workers
  Paid lifts the daily budget.
- **The worker is minified** (225 → 154 KB). Cold starts are shorter, and
  they were the CPU spikes.
- **Saves batched while the room is live** (2026-10-23, `KEEP_MS`).
  - Each save still reaches everyone in the room at once, and is stored
    with the others every 30 s. It's stored sooner when the room drops,
    the page is hidden or closed, or the sync stops.
  - What's waiting is kept in the vault, so a page closed meanwhile stores
    it on its next visit.
  - About 10× fewer D1 rows and R2 writes.
  - Older apps ignore the live message and take the stored file, up to
    30 s later.
- **The write throttle counted ten at a time** (2026-10-25, `allowedWrite`
  in `workers/rooms/src/people.ts`). It used to write its D1 row on every
  store write; now each instance holds up to nine and adds them together,
  so the hourly limit (3,000 an account) is off by at most nine an instance.
- **Relay cursors every 50 ms** (2026-10-23, `RELAY_CURSOR_MS` in
  `lib/peers`). Over a relayed link, the latest position goes at most
  every 50 ms, and the playback fills in between. Direct links still send
  every frame. That's about a third of the relay's bytes.
- **Health** (Developers → Health) shows every meter here, today and over
  30 days, and whether each secret is set.

## Changes still to make

Each would lower the requests further; none is needed below Tier 1.

1. **Public, same-for-everyone reads as files.** The contribution wall on
   the landing page, the special themes and the public atrium list are the
   same for every visitor, and each view is a worker request. The worker
   could write each as a file in R2 when it changes, served from the
   bucket's own domain: R2 reads (10M a month free, then $0.36 a million)
   instead of Workers requests. Landing visitors would then cost nothing,
   which matters at a launch, when visitors far outnumber users.
2. **Files straight from R2.** An online atrium's files and saves, and
   public atriums' mirrored files, are read "by anyone, by id" through the
   worker: a request each, the first time on each device. Served from the
   bucket's own domain by the same unguessable ids, they'd cost R2 reads
   instead. Same trust as now: the files are sealed, and only an id finds
   them.
Both need a second R2 bucket, public, with a domain of its own: the files
bucket also holds the cloud atriums held for their owners (`held/`),
unsealed, which must never be readable by id.

## The prices behind the table

List prices, checked 2026-10-29.

**Workers Paid ($5 a month) includes:**
- Requests: 10M a month, then $0.30 a million. CPU: 30M ms, then $0.02 a
  million.
- Durable Objects: 1M requests, then $0.15 a million. 400,000 GB-s, then
  $12.50 a million. Incoming WebSocket messages bill 20 to a request.
- D1: 25 billion rows read and 50 million written a month, then $0.001
  and $1 a million. 5 GB stored, then $0.75 a GB.

**R2, on any plan:** 10 GB stored, then $0.015 a GB-month. 1M writes, then
$4.50 a million. 10M reads, then $0.36 a million. Downloads are free.

**Relay (TURN):** 1,000 GB a month free, then $0.05 a GB.

**Mail**, volume and plan at each tier:
- Tier 1, about 4,500 a month: fits the two free days.
- Tier 2, about 22,500: Resend Pro ($20, 50,000 a month, no daily limit),
  with Brevo's free day as overflow.
- Tier 3: Resend Scale ($90, 100,000).
- Tier 4: about $150. Recheck both providers' paid plans then.
- A third free provider (Mailjet, 200 a day) would add to the free days if
  wanted. It's one more entry in `PROVIDERS`.

**Monitoring**: error tracking (Sentry Team at $26, Business at about $80).
It's optional at Tier 2.

**Password hashing** costs nothing: the page does it.

## When to upgrade: what to watch

Everything here except Drive is in Developers → Health.

| Meter | Do |
|---|---|
| Worker requests past ~70,000 a day | Workers Paid ($5) |
| D1 rows written past ~70,000 a day | Workers Paid ($5) |
| Rooms (DO requests) past ~70,000 a day | The same plan covers it |
| CPU p99 near 10 ms | Find the route in the worker's logs; Workers Paid allows 30 s |
| Database size near 500 MB | Workers Paid (10 GB a database) |
| Files written past 1M a month | Nothing needed: R2 bills a few dollars past it |
| Relay near 800 GB | Raise `RELAY_BUDGET_GB` if the cost is wanted |
| Resend at 80 a day most days, or the Brevo meter climbing | A paid mail plan (Resend Pro, $20) |
| Drive quota past ~50% of 1,000,000 a minute (Google Cloud console, Drive API quotas) | Drive atriums look less often still |
| Many "Google is busy" reports for public atriums | Check that the mirror holds them |

## Recommendation

- Spend nothing until a wall is near. Health shows how near.
- Workers Paid ($5) is the first purchase. It lifts the request, D1 and
  room walls together.
- Buy a paid mail plan around Tier 2, or the first week that mail gets
  held back.
- Raise the relay's cap only if the slower cursor past it is a problem.

## Trade-offs of one vendor

- One bill, one account system, no per-user sign-in fee and no cap on
  live connections.
- Authorization is our own code, in the worker's checks, so it has to be
  reviewed as such (security reviews 2026-10-22).
- D1 keeps 30 days of point-in-time recovery; R2 keeps none. If online
  atriums come to matter, back R2 up on a schedule.
- A Cloudflare outage takes down sign-in, rooms and online atriums together.
  Browser and desktop atriums keep working.
