# Plans: a free plan and a paid one

Researched 2026-10-29, before any charging code: what the Atrium could charge and what
it gives for free. Costs per person come from docs/SCALING.md.

**Recheck before deciding.** Competitors' prices come from their pricing pages or
price trackers, which sometimes disagree. Stripe's fees are as published for Portugal.

## The short answer

- **€4 a month or €40 a year.** Infrastructure doesn't set the price: a free person costs
  about €0.001 a month. Value and the market do: comparable tools charge $6-12.
- **Sell the paid plan on features, not storage.**
- The business and tax side is kept outside this public repository.

## The plans (decided 2026-10-29, price changed 2026-10-31)

| | Free | Paid |
|---|---|---|
| Cloud atriums (hosted; public or shared) | 1 | 10 |
| Cloud space, across them | 50 MB | 5 GB |
| A file, at most | 25 MB (as today) | 200 MB (video) |
| Mirror of one's public Drive atriums | 100 MB | 1 GB |
| Drive, browser and desktop atriums, live rooms | unlimited | unlimited |
| Digital Atrium templates | yes | yes |
| Your own templates, folders, across devices | no | yes |
| Donation reminders | yes | no |
| Price | — | €4 a month, or €40 a year |

- **Developers > Plans** shows this to the operator (`src/components/PlansTool.tsx`,
  `src/lib/plans.ts`). Nothing limits or charges anyone yet.
- **Not to sell:** the Pinterest import stays free (docs/PINTEREST.md).
- In a shared or public atrium, each person's files count against their own space,
  whatever their plan.
- 50 MB is today's amount, so nobody already using it goes over. Anyone with more
  than 1 cloud atrium keeps them all but can't make another, and the same when a
  subscription ends.
- Worth adding as it's built: a supporter mark.

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

## What a free person costs

About €0.001 a month: docs/SCALING.md's tiers come to $0.0004–0.0012 per
monthly user, all services together (requests, rooms, D1, mail, relay,
monitoring). Storage is a sliver of it: 10 MB, even full, is €0.00015 a
month; 50 MB, €0.00075. The free cloud space can be set by what makes people
want more, not by what it costs.

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

## Building it

Once the numbers are chosen:
1. A plan on each account in D1, with when it ends. `/contributions/mine` then
   also answers `paidUntil`, which already silences the donation card.
2. A subscription; its webhook sets and clears the plan.
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
- [Stripe's prices for Portugal](https://stripe.com/en-pt/pricing)
- [Paddle's seller terms, summarised](https://fungies.io/paddle-review-2026)
- [Stripe Managed Payments](https://stripe.com/en-pl/managed-payments)
- [Stripe Billing's 0.7%](https://usagebox.com/articles/stripe-billing-fees-2026-the-07-percent-math)
- [Stripe Tax pricing](https://support.stripe.com/questions/understanding-stripe-tax-pricing)
- [EU VAT OSS threshold (Taxually)](https://www.taxually.com/blog/eu-vat-oss-ioss-distance-selling-2026)
- [Merchant of record fees compared](https://aliteq.com/cheapest-merchant-of-record)
- [Lemon Squeezy vs Polar vs Paddle](https://www.buildmvpfast.com/blog/lemon-squeezy-vs-polar-paddle-merchant-of-record-2026)
