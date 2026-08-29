# Being found in search

Written when the site was close to invisible to a search engine. Most of it has
since been done, so this is now two lists: what is in place, and what is left.

The short version of the whole document: the on-page work is finished and it was
never the hard part. What decides whether anyone finds this is links from
elsewhere, and no file in this repo can produce one.

---

## The constraint that shapes everything

The app routes on the fragment: `#/browse`, `#/contributors`, `#/desktop`.
Google has ignored fragments for indexing since 2015 — `digitalatrium.org/#/browse`
and `digitalatrium.org/` are the same URL to a crawler.

So there is exactly **one indexable page**, no matter how many screens the app
has, plus `privacy.html` and `terms.html`. That is fine for an app rather than a
blog, but it means the one page has to do all the work, and it makes the title,
the description and the social card disproportionately important.

Google does run JavaScript, so the landing page is read eventually — the English
catalogue is bundled rather than fetched, so the text is there once React
renders. But rendering is a second, slower pass, and everything deciding how the
result *looks* in the list is static metadata.

---

## In place

- **A custom domain.** `digitalatrium.org`. This was the largest single
  improvement available: `pages.dev` is on the Public Suffix List, so a
  subdomain of it inherits no authority at all. See `CHANGING_THE_DOMAIN.md`.
- **Title, description, canonical** in `index.html`. The description is kept
  near 155 characters, which is roughly where Google truncates.
- **Open Graph and Twitter cards**, with `og:image:width`/`height`/`alt` so a
  chat client can reserve the space instead of reflowing under a bare link.
- **`og-card.png`**, 1200×630, built by `scripts/make-og-image.mjs`. This
  replaced `glass_dome.png`, which is 2780×2503 — very nearly square, and so
  cropped to its middle by every client that shows a large card.
- **JSON-LD** (`WebApplication`), so the category and the price are stated
  rather than inferred.
- **`robots.txt` and `sitemap.xml`** in `public/`, listing only real URLs. The
  `#/` routes are deliberately absent; they are not pages.
- **A `<noscript>` block** with real prose, which is what the first crawl pass
  and a visitor without JavaScript both get.
- **Descriptions and canonicals on `privacy.html` and `terms.html`** — the only
  prose on the site readable without running any JavaScript.

---

## Left to do

### 1. Links from elsewhere

This is the part no file here can do, and it is what actually decides ranking. A
new domain with no inbound links ranks nowhere however clean its markup is.

The honest routes: show it where people collect visual references and talk about
tools for doing it. A demo video does far more than a link, because the thing is
visual and does not explain itself in a sentence.

Everything below this line is worth less than this item.

### 2. Search Console and Bing Webmaster Tools

- **Google Search Console** — add the property, verify by DNS TXT record,
  submit the sitemap, then *URL Inspection → Request indexing* on the homepage.
  It is the only way to see what Google actually thinks, including how it
  renders the page.
- **Bing Webmaster Tools** — can import straight from Search Console. Bing feeds
  DuckDuckGo, which is worth more than its market share suggests here.

Expect days to weeks, and read nothing into the first fortnight.

### 3. A real screenshot for the card

`og-card.png` is the mark on the app's ground. Honest, correctly shaped, and
says little. A screenshot of a populated atrium would say what the product is in
the one place people actually look at it — a link pasted into a chat.

Drop-in: save it over `public/og-card.png` at 1200×630, under 1 MB, and change
nothing else.

### 4. A `www` → apex redirect

The DNS record exists and is proxied, but nothing redirects. `canonical` already
points at the apex, so this is tidiness rather than a duplicate-content problem.
A Cloudflare redirect rule does it.

### 5. Consider what `_redirects` is doing

`public/_redirects` is `/* /index.html 200`, so **every** path returns the app
with a 200 — `/nonsense` included. Those are soft 404s, and Google dislikes
them.

It is also probably unnecessary. Routing is entirely on the hash (`parseRoute`
reads only `window.location.hash`), and every OAuth callback returns to `/`
(`getPinterestRedirectUri` is `origin + '/'`; Supabase uses the site URL). So no
path other than `/` and the two `.html` files needs to resolve.

Left alone deliberately: the gain is theoretical, since Google only indexes URLs
it discovers and nothing links to a phantom path, while the risk is a live
routing change on a deployed site. If it is ever changed, test both sign-in
flows and the desktop Pinterest link before believing it.

### 6. Prerendering

The shell renders empty, so the first crawl pass depends on the `<noscript>`
block and everything else waits for the render pass. Prerendering the landing
page to static HTML at build time (`vite-plugin-prerender` or similar) would fix
that properly.

Worth doing only if the domain and metadata have not moved anything after a
couple of months. It is real complexity for a second-order gain.

---

## Not worth your time

- **Meta keywords.** Ignored by every search engine since roughly 2009.
- **Submitting to directories.** Either useless or actively harmful.
- **BIMI**, if the goal is a logo beside the sender in Gmail. It needs DMARC at
  enforcement plus a VMC or CMC certificate — hundreds to well over a thousand
  a year, and a VMC needs a registered trademark.
- **Anything sold as "SEO services"** for a project this size.
