# Scaling the web app: tiers and costs

Rewritten 2026-10-23, now that the web app runs on Cloudflare
(docs/DECENTRALIZING.md, phase 10). A plan to read when usage grows, or
before spending money on the web app.

**Recheck before buying.** Prices are list prices as known in late 2025
(Cloudflare, Resend, Brevo). Usage per person is an estimate (below). The
app's Developers → Health shows every free-plan meter, today and over 30
days: redo these tables from it once there's real traffic.

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
- **About 40 worker requests a day** from each daily active person:
  - signing in and staying signed in, the directory, entering a room, the
    relay pass, the public list, and the image proxy;
  - for online atriums, a look every 1–2 minutes, plus reading the files
    not yet in the browser.
- **About 20 Durable Object requests a day** each: entering rooms and
  incoming room messages (20 messages bill as one request).
- **Saves to online atriums** are the big unknown.
  - A save goes out after each 1.5 s pause (`QUIET_MS` in `lib/driveSync`).
    With the room live, which is whenever someone's inside, it goes
    through the room at once, and into the store with the others every 30 s
    (`KEEP_MS`).
  - Each stored save is one new file: one R2 write, and about 4 D1 rows
    written (its listing row, two indexes, and the write throttle).
  - Assumed: one person in ten edits an online atrium on a given day, for
    about 15 stored saves (about 150 before the 30 s batching).
  - Per daily active person, with uploads, sessions and throttles: about
    2.5 R2 writes and 20 D1 rows written a day.
- About 20 R2 reads a day each: files opened, and the mirror.
- About 15% of people can't connect directly and go through the relay, at
  about 15 MB an hour of cursors and laser.
- Mail ≈ 15% of monthly actives a month: sign-up codes, welcomes, resets
  and reports.

## Tiers at a glance

Workers Paid from Tier 1. Updated 2026-10-23 for the two changes made that
day: saves batched while the room is live, and relay cursors every 50 ms.
Before them, Tier 4 was about $1,750–3,200.

| Tier | Daily active | Monthly active | At once | Per month |
|---|---|---|---|---|
| 0, free plans | up to ~2,500 | ~7,500 | ~200 | $0 |
| 1 | 10,000 | 30,000 | ~800 | ~$8 |
| 2 | 50,000 | 150,000 | ~4,000 | ~$75–135 |
| 3 | 150,000 | 450,000 | ~12,000 | ~$350–550 |
| 4 | 300,000 | 900,000 | ~25,000 | ~$750–1,200 |

The ranges are mostly the relay:
- capped at today's 800 GB, which costs nothing (past the cap, the people
  it would carry get a slower cursor through the room);
- or the cap raised, at its cost with cursors every 50 ms (about a third of
  the bytes of every frame).

## The walls on the free plans

Daily limits reset at 00:00 UTC.

1. **Workers, 100,000 requests a day** (the worker and the image proxy
   together). At about 40 a person, that's about 2,500 daily actives, the
   first wall. Past it the worker answers nothing: no sign-in, no rooms,
   no online atriums, no public list. Browser and desktop atriums don't
   notice.
2. **D1, 100,000 rows written a day.** At about 20 a person, that's about
   5,000 daily actives. Past it, until midnight UTC, nothing that writes
   works:
   - signing in and staying signed in;
   - saves to online atriums;
   - invitations and settings.
3. **Durable Objects, 100,000 requests a day**, about 5,000 daily actives.
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
  - every 2 minutes when its room is live;
  - otherwise every minute for an online atrium, and every 20 s for a
    Drive atrium (`lookEvery` in `lib/driveSync`).

  This cuts Drive use about 6×, and our requests for online atriums.
- **The R2 mirror of public atriums.** Visitors read from us, so there's no
  Google robot check and no file locked for being read too often.
- **The atrium browser polls frugally**: the public list every 5 minutes,
  and Drive looks each minute while it's visible. Keep anything new that
  polls the worker this frugal.
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
- **Relay cursors every 50 ms** (2026-10-23, `RELAY_CURSOR_MS` in
  `lib/peers`). Over a relayed link, the latest position goes at most
  every 50 ms, and the playback fills in between. Direct links still send
  every frame. That's about a third of the relay's bytes.
- **Health** (Developers → Health) shows every meter here, today and over
  30 days, and whether each secret is set.

## Changes still to make

None cost money.

1. **A write throttle that doesn't write a D1 row on every write.** It's one
   of the 4 rows each stored save writes; it could be counted in memory or
   in the room instead. Small now that saves are batched: worth it past
   Tier 2.

## Costs per tier

**Workers Paid ($5 a month) includes:**
- Requests: 10M a month, then $0.30 a million. CPU: 30M ms, then $0.02 a
  million.
- Durable Objects: 1M requests, then $0.15 a million. 400,000 GB-s, then
  $12.50 a million.
- D1: 25 billion rows read and 50 million written a month, then $0.001
  and $1 a million. 5 GB stored, then $0.75 a GB.

**R2, on any plan:** 10 GB stored, then $0.015 a GB-month. 1M writes, then
$4.50 a million. 10M reads, then $0.36 a million. Downloads are free.

**Relay (TURN):** 1,000 GB a month free, then $0.05 a GB.

| Tier | Workers | DOs | D1 writes | R2 | Mail | Relay | Monitoring | Total |
|---|---|---|---|---|---|---|---|---|
| 1 | ~$6 | ~$1 | $0 | ~$1 | $0 | $0 | — | **~$8** |
| 2 | ~$23 | ~$6 | $0 | ~$24 | $20 | $0–35 | $26 opt. | **~$75–135** |
| 3 | ~$66 | ~$30 | ~$44 | ~$91 | $90 | $0–200 | $26 | **~$350–550** |
| 4 | ~$131 | ~$65 | ~$140 | ~$188 | ~$150 | $0–450 | ~$80 | **~$750–1,200** |

- **Relay**: about 5, 15 and 30 TB a month at Tiers 2–4 at full quality,
  about a third of that with cursors every 50 ms. The cap keeps it at $0;
  raised, it's the batched figure above.
- **Mail** volume and plan at each tier:
  - Tier 1, about 4,500 a month: fits the two free days.
  - Tier 2, about 22,500: Resend Pro ($20, 50,000 a month, no daily
    limit), with Brevo's free day as overflow.
  - Tier 3: Resend Scale ($90, 100,000).
  - Tier 4: about $150. Recheck both providers' paid plans then.
  - A third free provider (Mailjet, 200 a day) would add to the free days
    if wanted. It's one more entry in `PROVIDERS`.
- **Monitoring**: error tracking (Sentry Team at $26, Business at about
  $80). It's optional at Tier 2.
- **Password hashing** costs nothing: the page does it.

## When to upgrade: what to watch

Everything here except Drive is in Developers → Health.

| Meter | Do |
|---|---|
| Worker requests past ~70,000 a day | Workers Paid ($5) |
| D1 rows written past ~70,000 a day | Workers Paid ($5); then the write throttle change |
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
