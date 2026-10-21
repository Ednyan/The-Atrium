# Scaling the web app: tiers, costs, and moving off Supabase

Written 2026-10-19. A plan to read when usage grows, or before spending
money on the web app. Two paths are costed side by side: **A**, keep
Supabase for what it does today; **B**, move everything to Cloudflare.

**Recheck before buying.** Prices are list prices as known in late 2025
(Cloudflare, Supabase, Resend). Google Drive's billing above its free
threshold is announced but not yet priced. Usage per person is an
estimate (below); the Cloudflare and Supabase dashboards give the real
numbers, and these tables should be redone from them.

## The usage model

- Monthly actives ≈ 3 × daily actives. People at the same moment, at the
  daily peak ≈ 8% of daily actives.
- About 20% of people use cloud atriums (email accounts). The rest use
  atriums kept in their Google Drive or in their browser, which cost us
  nothing to store.
- A daily active person makes about 30 requests a day to the rooms worker
  (sign-in, staying signed in, the directory, entering a room, the relay
  pass, the public list) and the site's image proxy (a Pages Function,
  same allowance).
- About 20 Durable Object requests a day each: entering rooms, and
  incoming room messages (live saves, presence), 20 messages counting as
  one request. The rooms use the WebSocket Hibernation API, so a room is
  billed for run time only while it handles a message.
- About 15% of people can't connect directly and go through the relay,
  at about 15 MB an hour of cursors and laser.
- Someone editing a cloud atrium writes about 100 rows a day; opening one
  reads all of its rows.

| Tier | Daily active | Monthly active | At once | Path A (Supabase) | Path B (all Cloudflare) |
|---|---|---|---|---|---|
| 0, today | ~2,000 | ~6,000 | ~300 | $0 | $0 |
| 1 | 10,000 | 30,000 | ~1,000 | ~$70 | ~$27 |
| 2 | 50,000 | 150,000 | ~4,000 | ~$190–400 | ~$75–280 |
| 3 | 150,000 | 500,000 | ~12,000 | ~$600–1,100 | ~$475–975 |
| 4 | 300,000 | 1,000,000 | ~25,000 | ~$1,600–2,600 | ~$1,150–2,150 |

The ranges are mostly the relay: full quality, cursor updates batched
over it (about a third of the bytes), or today's 800 GB cap, past which
those 15% get a cursor every few seconds through the room instead.

## What each service does today

- **Cloudflare**
  - The website: static files on Pages, free at any size.
  - The rooms worker (`workers/rooms`): Google sign-in and staying signed
    in, the directory in D1 (accounts, invitations, Google grants,
    Pinterest, bans, public atriums), live rooms as Durable Objects, relay
    passes, feedback and mail.
  - The relay (TURN), capped at 800 GB a month.
  - The image proxy (`functions/api/proxy-image.js`).
- **Supabase**
  - Email/password accounts: Supabase Auth.
  - Cloud atriums: Postgres tables `lobbies`, `traces`, `layers`,
    `trace_links`, `lobby_locations`, `lobby_access_lists`,
    `lobby_sessions`, `lobby_visits`, `profiles`, `special_themes`, with
    row-level security.
  - Their files and previews, in Storage.
  - Their live changes, through Realtime.
  - RPCs, among them `can_user_join_lobby`, `get_lobby_size_bytes`,
    `lobby_has_password`, `get_user_lobby_count`,
    `transfer_lobby_ownership`, `is_platform_admin`, `email_for_sign_in`,
    `username_taken`, `account_for_google`, `account_for_email`, and
    Pinterest's for email accounts.
  - Edge Functions: `delete-account`, `ban-account`,
    `request-deletion-code`, `send-welcome`, `send-feedback`,
    `relay-pass`, the Pinterest ones, and Stripe's
    (`create-contribution`, `contribution-status`, `stripe-webhook`,
    `moderate-contributors`). Several are already duplicated in the
    worker for Google accounts.
- **Google Drive**: Drive atriums, in each person's own Drive, so their
  storage is never ours. API use: 1,000,000 quota units a minute and
  400 million a day per project before billing.
- **Resend**: welcome, goodbye and feedback mail. Free: 100 a day,
  3,000 a month. A failed welcome never blocks a sign-up.

## The first walls, on the free plans

1. **Cloudflare Workers, 100,000 requests a day** (rooms worker and image
   proxy together, reset 00:00 UTC). At ~30 per person, about 2,000–3,000
   daily actives. Past it, until midnight UTC:
   - Google accounts can't sign in or stay signed in.
   - Rooms fail.
   - Drive atriums still sync through Google, and browser atriums don't
     notice.
2. **Durable Objects, 100,000 requests a day**: about the same point.
3. **Supabase Realtime, 200 connections at once**: people inside cloud
   atriums. Storage 1 GB, downloads 5 GB a month.
4. **Google Drive**: not a wall below Tier 3, but see "Code changes".

## Code changes, needed on either path

None cost money. Each cuts a bill or removes a wall.

1. **Poll Drive less while the room is connected.** Do it before Tier 3,
   which it's required for. An open Drive atrium checks Drive every 20 s
   (`LOOK_MS` in `lib/driveSync`): about 75 units a minute per person, so
   ~12,000 people at once reach the 1,000,000-a-minute limit. The room
   already announces saves (`drive-save`), so every 2 minutes is enough
   while it's connected. That cuts Drive use about 6×, and keeps Tier 4
   under the 400M units a day where billing would start.
2. **Batch cursor updates over the relay**, before Tier 2: about a third
   of the relay's bytes.
3. **Move cloud atrium files to R2**, before Tier 2 on path A (Supabase
   bills about $0.09 a GB downloaded; R2 downloads are free). Part of
   path B anyway.
4. **The R2 mirror for popular public atriums** (phase 8's last part), by
   Tier 3. It also keeps people on one network off Google's robot check,
   which anonymous Drive downloads can trigger for about 10 minutes.
5. **The atrium browser's own polling**, already trimmed: the public
   list every 5 minutes, Drive atrium looks each minute while visible.
   Keep anything new that polls the worker this frugal.

---

## Path A: keep Supabase

### Tier 1: 10,000 daily (~$70/month)

| Upgrade | Why | Cost/month |
|---|---|---|
| Cloudflare Workers Paid | 10M requests a month included; the free 100k a day is the first wall | $5 |
| Durable Objects | ~6M requests, 1M included | ~$1 |
| Supabase Pro | Cloud atriums past 1 GB and 200 at once | $25 |
| Supabase Small compute | More queries | $15 |
| Supabase downloads | ~300 GB, 250 GB included | ~$5 |
| Resend Pro | Past 3,000 mails a month | $20 |
| Relay | ~1 TB, Cloudflare's first 1,000 GB free | $0 |

### Tier 2: 50,000 daily (~$190–400/month)

| Upgrade | Why | Cost/month |
|---|---|---|
| Workers requests and CPU | ~45M requests | ~$18 |
| Durable Objects | ~30M requests, run time | ~$6 |
| Supabase Pro, Medium compute, +1,000 realtime connections | ~800 in cloud atriums at once | ~$95 |
| R2 for cloud atrium files | Instead of ~$110 of Supabase downloads | ~$3 |
| Resend Pro | ~22,000 mails | $20 |
| Relay | ~5 TB: $200 full, ~$35 batched, $0 capped | $0–200 |
| Error monitoring (Sentry Team), optional | | $26 |

### Tier 3: 150,000 daily, 12,000 at once (~$600–1,100/month)

| Upgrade | Why | Cost/month |
|---|---|---|
| Workers | ~135M requests | ~$50 |
| Durable Objects | ~90M requests | ~$30 |
| Supabase Pro, Large compute, realtime, storage | ~2,400 in cloud atriums at once | ~$170 |
| R2: cloud files and the public mirror | | ~$25 |
| Resend Scale | ~75,000 mails | $90 |
| Relay | ~15 TB: $700 full, ~$200 batched | $200–700 |
| Sentry Team | | $26 |

### Tier 4: 1,000,000 monthly, 25,000 at once (~$1,600–2,600/month)

| Upgrade | Why | Cost/month |
|---|---|---|
| Workers | ~270M requests | ~$100 |
| Durable Objects | ~180M requests, run time | ~$65 |
| Supabase Pro, XL compute, 5,000 realtime connections | | ~$280 |
| Supabase sign-ins past 100,000 a month | ~200,000 email accounts at $0.00325 each | ~$325 |
| R2 | ~1 TB, mirror reads | ~$90 |
| Resend | ~150,000 mails | ~$150 |
| Relay | ~30 TB: $1,450 full, ~$450 batched | $450–1,450 |
| Monitoring (Sentry Business) | | ~$80 |

---

## Path B: everything on Cloudflare

### What replaces what

| Supabase today | On Cloudflare |
|---|---|
| Auth for email accounts | The worker (built, phase 10 step 4). Accounts in D1, as Google accounts already are, with kind `email`. The page stretches the password (PBKDF2, 600,000 rounds) and the worker keeps a salted SHA-256 of that: the free plan's 10 ms of CPU a request can't hash passwords itself. Confirmation and reset codes mailed by Resend. Sessions are the worker's own `a1.` sessions, renewed from a renewal token. Existing accounts' credentials are copied as they sign in (no bcrypt export). |
| Postgres tables of cloud atriums | **Each cloud atrium kept by its own room**: the atrium's Durable Object, which is already its live room, keeps its rows in its own SQLite storage. Recommended form: the same as Drive atriums (`lib/driveSync`, `lib/driveFormat`), with the room as the store instead of Drive. A working copy in the browser (the phase 7 engine), saves sent to the room, which merges them, keeps them, and passes them on. Most of the code exists. |
| Row-level security | The room's own checks: the roster, roles, passwords. Authorization written in code, reviewed as carefully as the policies were. |
| Storage | R2, at the same paths. Free downloads. |
| Realtime | The rooms. A DO holds thousands of WebSockets; no per-connection fee. |
| `profiles`, settings, themes | D1 `accounts` (`settings` already holds a Google account's). |
| `lobby_access_lists`, admins, passwords, sizes, counts | The atrium's roster in its DO, and small D1 tables where something must be listed across atriums (an account's cloud atriums, the public list). |
| Edge Functions | Worker routes. relay, feedback, Pinterest, Google deletion and bans are already there. To port: email-account deletion and its code, welcome for email accounts, and Stripe (`create-contribution`, `contribution-status`, `stripe-webhook` with WebCrypto signature checks, `moderate-contributors`). |
| `is_platform_admin`, `platform_admins` | A D1 table; the worker's `isOperator`. |
| `app_changes` markers, `special_themes`, `lobby_visits`, `lobby_sessions` | D1, or the browser where they're per person. |
| Backups | D1 and Durable Object SQLite keep 30 days of point-in-time recovery. R2 has none, so a scheduled copy of what matters. |

What doesn't change: Drive atriums, browser atriums, the desktop app (its
vault never used Supabase), Google sign-in.

### Migration, in order

1. **Email accounts into D1** beside Google accounts: sign up, confirm,
   sign in, reset, delete, sessions. Import Supabase's users (ids kept, so
   everything keyed by user id holds). The two kinds then share every
   path in the worker.
2. **Cloud atriums into their rooms**: the room's SQLite store and the
   browser working copy with sync, by the Drive format. Copy each existing
   atrium's rows (same ids) and files (to R2, as `lib/moveToDrive` does
   for Drive). Cut over atrium by atrium, or all at a quiet hour; Supabase
   stays read-only meanwhile.
3. **The remaining functions** to worker routes (Stripe last, tested
   against Stripe's test mode).
4. **The app off the Supabase client**: `lib/supabase` and
   `switchDataClient` simplify to the browser engine and the worker.
   Desktop is unaffected.
5. **A month with Supabase read-only** as a backup, then cancel.

Rough size: several focused sessions. Accounts and cloud atriums are the
two big pieces; the rest is ports of code that mostly exists.

**Trade-offs**
- One vendor, one bill, one account system, no per-user sign-in fee, no
  200/500 realtime cap, no project pausing.
- But: authorization moves from SQL policies into code we must review
  ourselves.
- R2 has no point-in-time recovery: back it up.
- Everything sits with Cloudflare. A Cloudflare outage takes the whole web
  app down, where today Supabase and Cloudflare fail separately.

### Costs on path B

All of Cloudflare's allowances below come with Workers Paid ($5):
- Requests: 10M a month.
- Durable Objects: 1M requests a month.
- D1 and DO SQLite: 25 billion rows read and 50 million written a month,
  then $0.001 per million read and $1 per million written; 5 GB stored,
  then $0.20 a GB.
- R2: 10 GB stored, then $0.015 a GB; downloads free.

| Tier | Workers | DOs (requests, run time) | Cloud atrium rows (writes, storage) | R2 | Resend | Relay | Monitoring | Total |
|---|---|---|---|---|---|---|---|---|
| 1 | $5 | ~$1 | $0 (~6M writes) | <$1 | $20 | $0 | — | **~$27** |
| 2 | ~$18 | ~$6 | ~$5 (~30M writes, ~30 GB) | ~$2 | $20 | $0–200 | $26 opt. | **~$75–280** |
| 3 | ~$50 | ~$30 | ~$57 (~90M writes, ~90 GB) | ~$20 | $90 | $200–700 | $26 | **~$475–975** |
| 4 | ~$105 | ~$65 | ~$165 (~180M writes, ~180 GB) | ~$90 | ~$200 | $450–1,450 | ~$80 | **~$1,150–2,150** |

Resend is a little higher than on path A, since it now also sends
sign-up, reset and deletion mails for email accounts. Password hashing
costs a few dollars of CPU at Tier 4.

**Savings against path A:** about $45 a month at Tier 1, rising to about
$450 at Tier 4. The biggest single difference is Supabase's per-user
sign-in fee at Tier 4, which path B doesn't have.

---

## When to upgrade: what to watch

| Signal (where) | Do |
|---|---|
| Worker requests regularly past ~70,000 a day (Cloudflare dashboard, Workers) | Workers Paid ($5) |
| DO requests past ~70,000 a day | Same plan covers it |
| Supabase storage near 1 GB, or realtime near 200 at once (path A) | Supabase Pro |
| Relay near its 800 GB cap (`RELAY_BUDGET_GB`, the worker) | Batch cursor updates; then raise the cap if the cost is wanted |
| Resend near 100 a day | Resend Pro |
| Drive quota use past ~50% of 1,000,000 a minute (Google Cloud console, Drive API quotas) | The polling change, if not done |
| Many "Google is busy" reports for public atriums | The R2 mirror |

## Recommendation

- Spend nothing until the first wall is near.
- Workers Paid ($5) is the first and most effective step on both paths.
- If the web app is meant to grow past a few thousand people a day, path
  B is cheaper at every tier and removes Supabase's caps. Its cost is
  engineering time. A good moment is before email-account cloud atriums
  hold much data, since every atrium added now is one more to move later.
