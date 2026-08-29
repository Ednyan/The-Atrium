# Moving to a custom domain

**In progress.** The domain is `digitalatrium.org`; the site was previously at
`https://the-atrium.pages.dev`, which still serves and now shows a notice
pointing at the new address.

**The code half is done** — the constant, the tooltips in every catalogue, both
extension manifests, the metadata and the moved notice. What remains is the
four consoles at the bottom of this page, which no commit can reach.

The short version: the code barely knows its own address, so that edit was
small. The work is in the consoles, and the one thing that can actually hurt is
that installed desktop apps carry the old address compiled into them.

Steps 1–3 can all be live at once with both domains working, which is what
makes this safe.

---

## What the code knows

Almost nothing. Auth redirects, the Pinterest OAuth redirect URI and the
`postMessage` origin checks all read `window.location.origin`, so they follow
the domain by themselves. Stripe's return URLs come from an environment
variable, not from source.

These are the only places the name is written down:

| File | What |
|---|---|
| `src/lib/creatorLinks.ts` | `ATRIUM_WEBSITE` — one constant |
| `src/locales/*.ts` (×8) | `welcome.websiteTitle` spells the domain out in a tooltip |
| `extension/manifest.json` | `host_permissions` and content-script `matches` |
| `extension/manifest.firefox.json` | the same, **plus the extension id — see below** |
| `PINTEREST_SETUP.md`, `extension/README.md` | documentation |

`ATRIUM_WEBSITE` is used twice, both in the desktop app: the "website" button
on the welcome screen, and the Pinterest connect link that opens
`<site>/#/link-pinterest` in a browser.

### Do not change the Firefox extension id

`send-to-atrium@the-atrium.pages.dev` in `manifest.firefox.json` is an
identifier that happens to look like an address. Nothing resolves it. Changing
it makes the browser treat the result as a **different extension**, so everyone
who installed it keeps the old one and never sees an update. Leave it exactly
as it is, whatever the site is called.

---

## What lives outside the repo

### 1. Cloudflare Pages

Workers & Pages → the `the-atrium` project → Custom domains → add the new
domain, follow the DNS instructions. The old `pages.dev` address keeps working;
Cloudflare serves both.

### 2. Supabase → Authentication → URL Configuration

- **Site URL** — the new address.
- **Redirect URLs** — add the new address. Keep the old one listed until the
  desktop apps have caught up.

Miss this and sign-in, Google OAuth and password reset all fail — the redirect
comes back to an address Supabase refuses. This is the most common way a domain
move breaks a site.

Google's own console usually needs nothing: Google redirects to Supabase's
`/auth/v1/callback`, not to your site, so it never learns your domain. Worth
confirming, not worth rewriting in advance.

### 3. Pinterest → your app → Redirect URIs

The app sends its own origin, whatever page you press Connect on. So Pinterest
must know the new root, with the trailing slash.

**Register both** while both domains are live. An installed desktop app opens
the *old* address to connect Pinterest, which then sends the *old* origin — so
removing it early breaks Pinterest for everyone who has not updated. See
`PINTEREST_SETUP.md`.

### 4. Supabase → Edge Functions → Secrets

```
npx supabase secrets set SITE_URL="https://the-new-domain"
```

`create-contribution` builds Stripe's `success_url` and `cancel_url` from this.
Without it, a donor pays and gets returned to the old domain.

Stripe's webhook endpoint is a Supabase function URL and is unaffected.

### 5. The browser extension

Update both manifests, repack, and resubmit to the Chrome Web Store and AMO.
Add the new host permission **without removing the old one** at first, so the
extension keeps working on both while the review sits in a queue.

---

## Resend, which is a separate question

Contribution emails are sent from:

```
The Atrium <contributions@mail.scenefoundry.studio>
```

— set in `supabase/functions/moderate-contributors/index.ts`, with
`reply_to: thedigitalatrium@gmail.com`.

**Note that this is already a different domain from the site**, and that is
deliberate rather than an oversight. Resend can only send from a domain it has
verified, because that is what it can sign with DKIM. A Gmail address cannot be
a sending identity, and mail claiming to come from one fails Gmail's own DMARC
policy and gets dropped.

So **changing the site's domain does not require changing this.** The email
domain and the website domain are independent, and the current arrangement
works.

If you want them to match anyway — and there is a real argument for it, since
mail from a domain the reader has never heard of looks like phishing — the
sequence is:

1. Resend → Domains → add the new domain (or a `mail.` subdomain of it).
2. Add the DKIM, SPF and DMARC records Resend gives you to the new domain's DNS.
3. Wait for verification.
4. Only then change `RESEND_FROM` and redeploy the function.

Do not change the constant before the domain verifies. Resend will refuse the
send, and contributor emails fail silently from the operator's point of view —
the panel reports success because the row was written; only the mail is gone.

`reply_to` is a plain mailbox and needs no verification, so
`thedigitalatrium@gmail.com` can stay or change freely. It is also named in the
`names.write.note` string in all eight locale files, so change it there too if
it ever moves.

---

## The trap: installed desktop apps

`ATRIUM_WEBSITE` is a build-time constant. Every copy of the desktop app that
is already installed has the **old** address compiled in, and will keep using
it until its owner takes an update.

Therefore:

- **Keep the old domain alive and redirecting** for at least one or two release
  cycles after the move.
- **Keep the old Pinterest redirect URI registered** for the same period.
- Ship a desktop release carrying the new constant, and give it time to spread.

The updater itself is unaffected — it reads `latest.json` from GitHub, which has
nothing to do with the site's domain.

---

## Order of operations

- [x] Buy the domain.
- [ ] **Add it in Cloudflare Pages** and confirm it serves the site. Namecheap
      is the registrar; the least friction is moving the nameservers to
      Cloudflare, which makes the apex domain work without needing ALIAS
      records. Pages will keep serving `the-atrium.pages.dev` alongside it.
- [ ] **Supabase → Authentication → URL Configuration.** Set Site URL to the
      new domain and add it to Redirect URLs. Keep the old one listed. Skipping
      this breaks sign-in, Google OAuth and password reset.
- [ ] **Pinterest → your app → Redirect URIs.** Add `https://digitalatrium.org/`
      with the trailing slash. Keep the old one: an installed desktop app opens
      the *old* address to connect, which then sends the *old* origin.
- [ ] **`npx supabase secrets set SITE_URL="https://digitalatrium.org"`**, then
      redeploy the Edge Functions **from the repo root** or they ship a stale
      `_shared`. Without it a donor pays and is returned to the old domain.
- [x] Change `ATRIUM_WEBSITE`, the `welcome.websiteTitle` strings in all ten
      catalogues, the canonical and Open Graph metadata, `robots.txt` and
      `sitemap.xml`.
- [x] Show a notice on the old domain, exempting `#/link-pinterest`.
- [ ] **Cut a desktop release** so installed apps start learning the new
      address. Until they do, they open the old one.
- [x] Add the new host to both extension manifests, keeping the old.
- [ ] **Repack and resubmit the extension** to the Chrome Web Store and AMO.
- [ ] Optionally move the Resend sending domain — verify it there *first*.
- [ ] **Verify in Google Search Console** (DNS TXT is easiest now the domain is
      yours), submit the sitemap, and request indexing. See `BEING_FOUND.md`.
- [ ] Months later, once the desktop fleet has updated: retire the old domain
      and drop the old Pinterest URI and Supabase redirect URL.

Nothing in the steps above breaks the old domain, so there is no cutover moment
to get wrong.

---

See also: `BEING_FOUND.md` — a custom domain is also the single biggest thing
you can do for search visibility, and the reasons are set out there.
