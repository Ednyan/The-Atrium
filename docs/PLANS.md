# Plans: a free plan and a paid one

Researched 2026-10-29, before any code: what the Atrium could charge, what it
would give for free, and whether the paid plan carries the free one. The
costs come from docs/SCALING.md; read that first for what each person costs
and why.

**Recheck before deciding.** Competitors' prices come from their pricing
pages or from price trackers, which sometimes disagree; Stripe's fees are as
published for businesses in the EEA. None of this is tax advice: have an
accountant confirm the VAT section before launch.

## The short answer

- **€3 a month covers the running costs many times over.** One paying
  person leaves about €2.00 a month after VAT and fees; a free person costs
  about €0.001. One subscriber carries about 2,000 free people, so costs
  are covered once about 0.05% of people pay.
- **Infrastructure isn't what sets the price.** Value and the market do:
  comparable tools charge $6–12 a month for one person.
- **Recommended:** launch at €4 a month or €36 a year (€3 also works). Sell
  the paid plan on features, not storage.

## The plans as proposed

**Free**
- 1 cloud atrium, which can be public, and 10 MB of the cloud for the person.
- In a public atrium, each contributor's files count against their own
  10 MB, so it grows with the people adding to it. The hosted store already
  works this way: a new file belongs to whoever writes it
  (`workers/rooms/src/store.ts`, `owner = row?.owner ?? who.id`).
- Still free, and costing the Atrium almost nothing:
  - unlimited atriums in the person's own Google Drive (only their public
    atriums' mirror is ours to store);
  - browser and desktop atriums;
  - live rooms.

**Paid**
- 3 cloud atriums, public or shared, with 5 GB across them.
- Others can add to a shared or public atrium, on their own space.

Today's limits, for comparison: 3 atriums and 50 MB for everyone
(`QUOTA_MB`, `MOST_ATRIUMS` in `workers/rooms/src/store.ts`), 25 MB a file
(`MOST_FILE_BYTES`, `who.ts`), and 500 MB of mirror per public atriums'
owner (`MOST_MB`, `mirror.ts`).

## What similar tools charge

| Tool | Free plan | Paid, one person |
|---|---|---|
| Milanote (boards for creatives) | 100 notes, about 10 uploads | $9.99/mo yearly, $12.50 monthly |
| Miro | 3 editable boards | $8/mo yearly, $10 monthly |
| Excalidraw+ | excalidraw.com is free | $6/mo |
| Kosmik | trial only | $11.99/mo yearly, $14.99 monthly |
| FigJam | free starter plan | $3/mo per editor (yearly) |
| PureRef (closest to the overlay) | personal: pay what you want, $7 or $15 suggested, no minimum | commercial: $49 once, or $8–10/mo per seat |
| Eagle | 30-day trial | $29.95 once |
| Storage alone | — | Google One 100 GB $1.99/mo; iCloud+ 50 GB $0.99/mo |

At €3–4 the Atrium is the cheapest of these but for FigJam's editor seat.
Storage sells for $1–2 per 100 GB, so nobody pays the Atrium for gigabytes:
they pay for what the plan lets them do.

## How many people pay

| Product | Paying | Counted against |
|---|---|---|
| Canva | about 12% (31M of 265M) | monthly users |
| Dropbox | about 2.6% (18.08M of 700M) | registered accounts (2025 annual filing) |
| Notion | estimated 2–4% today | all users |
| Miro | about 0.4% (130,000 of 35M) | users; each customer is usually a team buying many seats |

- Benchmarks across 1,000+ self-serve products with a free plan: 3–5% is
  good, 6–8% great.
- Payers come with time. Evernote saw 0.5% of a month's new users pay in
  their first month, 8% after a year and 25% after five years.
- **Plan on 1%.** Anything above it is a bonus.

## What one paying person leaves

In euros, since Stripe settles the Atrium's payments in euros. An EU buyer,
VAT included in the price (about 21% on average; each country's own rate
applies). Stripe: 1.5% + €0.25 a payment (EEA cards; others cost more),
0.7% for subscriptions (Billing), 0.5% for Stripe Tax. Up to €0.15 a month
for the person's own use: 5 GB full (€0.075 in R2), saves, relay.

| Price | VAT | Payment fees | Left each month |
|---|---|---|---|
| €3 a month | €0.52 | €0.33 (11%) | ~€2.00 |
| €4 a month | €0.69 | €0.36 | ~€2.80 |
| €5 a month | €0.87 | €0.39 | ~€3.60 |
| €30 a year (€2.50 a month) | €0.43 | €0.09 (3.5%) | ~€1.83 |
| €3 through a merchant of record (5% + $0.50, tax handled) | €0.52 | ~€0.61 | ~€1.72 |

Stripe's fixed €0.25 is what hurts a small price: 11% of a €3 charge, 3.5%
of a yearly one. Offer the yearly plan whatever the price.

## What a free person costs

About €0.001 a month: docs/SCALING.md's tiers come to $0.0004–0.0012 per
monthly user, all services together (requests, rooms, D1, mail, relay,
monitoring). Storage is a sliver of it: 10 MB, even full, is €0.00015 a
month; 50 MB, €0.00075. The free cloud space can be set by what makes people
want more, not by what it costs.

## Sustainable? By tier, at €3 a month

| Tier | Monthly users | Running cost | Payers to cover it | Left if 0.25% pay | Left if 1% pay |
|---|---|---|---|---|---|
| 1 | 30,000 | ~$7 | 4 | ~€140 | ~€590 |
| 2 | 150,000 | $60–120 | 30–60 | ~€630 | ~€2,900 |
| 3 | 450,000 | $280–480 | 140–240 | ~€1,800 | ~€8,500 |
| 4 | 900,000 | $610–1,060 | 300–530 | ~€3,400 | ~€17,000 |

Not counted: income tax, an accountant, refunds, and disputed payments
(Stripe's dispute fee can be more than a subscription).

A line for the plans page that's true at these numbers: "each subscriber
keeps about 2,000 free atriums running".

## The paid plan's features

Storage alone won't sell it; these cost the Atrium little:
- more cloud atriums, and more space (20 GB full costs $0.30 a month);
- bigger files, video among them (25 MB a file today);
- no relay limit for their rooms;
- a bigger mirror for their public Drive atriums;
- a supporter badge (the contribution wall already exists).

The mirror budget becomes part of each plan: 100 MB free and 1 GB paid, say,
in place of today's 500 MB for everyone.

## Changing today's limits

Today everyone has 50 MB and 3 atriums. For anyone over the new free limits
when they arrive: keep their files and atriums, pause new uploads until
they're back under, and give a grace period. The same when a subscription
ends.

## Taxes and payments

- **Inside the EU**, for a seller based there: up to €10,000 a year of sales
  to consumers in *other* EU countries, the seller's own country's VAT
  applies. Past it, each buyer's country's rate, declared in one quarterly
  return through the EU's One-Stop Shop (OSS). Stripe Tax works out the tax
  (0.5%); it doesn't file the returns.
- **Outside the EU**, each country has its own rules.
- **A merchant of record** sells on the Atrium's behalf and files all the
  tax: Paddle and Lemon Squeezy 5% + $0.50 (Lemon Squeezy adds 1.5% for
  cards outside the US, 0.5% for subscriptions), Creem 3.9% + $0.40, Polar
  from 4% + $0.40, Stripe Managed Payments 3.5% on top of Stripe's fees. At
  €3 a month, the fixed fee alone takes about 12–16%.
- **Recommended:** start with Stripe, which the contributions already use
  (`workers/rooms/src/contributions.ts`), with Stripe Tax and the yearly
  plan. Reconsider a merchant of record if sales outside the EU grow.

## Building it

Once the numbers are chosen:
1. A plan on each account in D1, with when it ends.
2. A Stripe subscription through the Checkout the contributions use; its
   webhook sets and clears the plan.
3. The limits read from the plan: cloud space, cloud atriums, file size,
   mirror budget, relay.
4. A plans page, and the plan shown in the account's settings.
5. A migration of anyone over the new free limits, as above.

## Sources

Competitors:
- [Milanote (Capterra)](https://www.capterra.com/p/165790/Milanote/pricing/)
- [Miro (Capterra)](https://capterra.com/p/128955/Miro/pricing/)
- [Excalidraw+](https://plus.excalidraw.com/pricing)
- [FigJam (CostBench)](https://www.costbench.com/software/diagramming/figjam/)
- [Kosmik (Toolradar)](https://toolradar.com/tools/kosmik/pricing)
- [PureRef](https://www.pureref.com/download.php)
- [Eagle](https://de.eagle.cool/blog/post/best-tool-to-organize-media-assets)
- [Google One vs iCloud+](https://subtracker.io/compare/google-one-vs-icloud)

Who pays:
- [Canva (TechCrunch)](https://techcrunch.com/2026/02/18/canva-gets-to-4b-in-revenue-as-llm-referral-traffic-rises/)
- [Dropbox 10-K FY2025](https://www.sec.gov/Archives/edgar/data/1467623/000146762326000008/dbx-20251231.htm)
- [Notion pricing breakdown](https://www.willingnesstopay.com/podcast/pricing-package-unpacked-why-notion-pricing-works-better-than-most-saas-companies)
- [Evernote's cohorts (Sixteen Ventures)](https://sixteenventures.com/classical-freemium-doesnt-exist-at-scale)
- [Lenny's Newsletter](https://lennysnewsletter.com/p/what-is-a-good-free-to-paid-conversion)
- [Miro (Sacra)](https://sacra.com/chat/h/41709844-438e-46a9-a009-5c004e2da936/)

Fees and tax:
- [Stripe EEA pricing](https://support.stripe.com/questions/pricing-updates-for-businesses-based-in-the-european-economic-area-(eea))
- [Stripe Billing's 0.7%](https://usagebox.com/articles/stripe-billing-fees-2026-the-07-percent-math)
- [Stripe Tax pricing](https://support.stripe.com/questions/understanding-stripe-tax-pricing)
- [EU VAT OSS threshold (Taxually)](https://www.taxually.com/blog/eu-vat-oss-ioss-distance-selling-2026)
- [Merchant of record fees compared](https://aliteq.com/cheapest-merchant-of-record)
- [Lemon Squeezy vs Polar vs Paddle](https://www.buildmvpfast.com/blog/lemon-squeezy-vs-polar-paddle-merchant-of-record-2026)
