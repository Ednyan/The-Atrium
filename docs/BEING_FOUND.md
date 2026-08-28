# Being found in search

Right now the site is close to invisible to a search engine, and it is not
because of anything difficult. Four things are missing, three of them are files
you can write in an afternoon, and the fourth is the custom domain.

---

## What a crawler currently gets

This is the entire `index.html` that ships:

```html
<title>Digital Atrium</title>
<link rel="icon" ...>
<meta name="viewport" ...>
...
<div id="root"></div>
```

No description. No Open Graph tags, so a link pasted into Discord, WhatsApp or
Twitter shows a bare URL with no title, image or summary. No `robots.txt`, no
`sitemap.xml`. And an empty `<div>` where the page should be.

Google does run JavaScript, so the landing page *will* eventually be read — the
English catalogue is bundled rather than fetched, so the text is there once
React renders. But rendering is a second, slower pass for the crawler, and
everything that decides how your result *looks* in the list is metadata that
does not exist yet.

### The hash router matters here

The app routes on the fragment: `#/browse`, `#/contributors`, `#/desktop`.
Google has ignored fragments for indexing since 2015 — `example.com/#/browse`
and `example.com/` are the same URL to a crawler.

So there is exactly **one indexable page**, no matter how many screens the app
has. That is fine — it is an app, not a blog — but it means the one page has to
do all the work, and it makes the title, description and social card
disproportionately important.

---

## In order of value

### 1. A custom domain

`*.pages.dev` is a shared domain owned by Cloudflare, used by hundreds of
thousands of projects, many of them abandoned or spam. Search engines treat
subdomains of a shared host with suspicion and rank them poorly; `pages.dev` is
also on the Public Suffix List, which means your subdomain inherits no
authority from the parent at all.

A domain you own is the single largest improvement available, and everything
below works better once it exists. See `CHANGING_THE_DOMAIN.md`.

### 2. Metadata in `index.html`

Cheap, static, and entirely under your control. Roughly:

```html
<title>The Digital Atrium — an infinite canvas for your references</title>
<meta name="description" content="Collect images, video, PDFs and links on an
  infinite shared canvas. Build a room of your references and let others walk
  through it." />
<link rel="canonical" href="https://your-domain/" />

<meta property="og:type" content="website" />
<meta property="og:title" content="The Digital Atrium" />
<meta property="og:description" content="An infinite canvas for the things you
  want to keep." />
<meta property="og:image" content="https://your-domain/atrium-mark.png" />
<meta property="og:url" content="https://your-domain/" />

<meta name="twitter:card" content="summary_large_image" />
```

The description is what appears under your title in the results, and the
`og:image` is what people see when they share the link. Both are currently
blank. Use a real screenshot of a populated atrium for the image, not the logo —
1200×630, under 1 MB.

Note the description is a *sentence a person reads*, not keywords. Keyword
stuffing has been actively penalised for over a decade.

### 3. `robots.txt` and `sitemap.xml`

Two small files in `public/`, which Cloudflare Pages serves as-is.

```
# public/robots.txt
User-agent: *
Allow: /
Sitemap: https://your-domain/sitemap.xml
```

```xml
<!-- public/sitemap.xml -->
<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url><loc>https://your-domain/</loc><priority>1.0</priority></url>
  <url><loc>https://your-domain/privacy.html</loc><priority>0.3</priority></url>
  <url><loc>https://your-domain/terms.html</loc><priority>0.3</priority></url>
</urlset>
```

Only real URLs belong here. Do not list the `#/` routes; they are not pages.

`privacy.html` and `terms.html` are genuine static files and are worth listing —
they are also the only prose on the site a crawler can read without running any
JavaScript.

### 4. Tell the search engines it exists

- **Google Search Console** — add the property, verify by DNS TXT record (the
  domain is yours, so this is the easy method), submit the sitemap, then use
  *URL Inspection → Request indexing* on the homepage. This is the only way to
  see what Google actually thinks of the site, including how it renders it.
- **Bing Webmaster Tools** — same idea, and it can import straight from Search
  Console. Bing also feeds DuckDuckGo, which is worth more than its market
  share suggests for a tool like this.

Expect days to weeks before anything appears, and do not read anything into the
first fortnight.

### 5. Something static for the crawler to read

Optional, and more work than the rest. The shell renders empty, so the first
crawl pass sees nothing and everything depends on the render pass.

The cheap version is a `<noscript>` block in `index.html` with a paragraph or
two of real prose about what the atrium is. It costs nothing, is honest — it is
what a visitor without JavaScript should see anyway — and gives the crawler
something on the first pass.

The thorough version is prerendering the landing page to static HTML at build
time (`vite-plugin-prerender` or similar). Worth doing only if the metadata and
the domain have not moved the needle after a couple of months.

### 6. Links from elsewhere

This is the part no file in this repo can do, and it is what actually decides
ranking. A new domain with no inbound links ranks nowhere regardless of how
clean its markup is.

The honest routes for a project like this: show it where people collect visual
references and talk about tools for it. A demo video does far more than a link,
because the thing is visual and does not explain itself in a sentence.

---

## Not worth your time

- **Meta keywords.** Ignored by every search engine since roughly 2009.
- **Submitting to directories.** Either useless or actively harmful.
- **Anything sold as "SEO services" for a project this size.** The four steps
  above are the whole of it.

---

## A reasonable order

1. Buy the domain and point Pages at it.
2. Add the metadata, `robots.txt` and `sitemap.xml` in the same commit.
3. Verify in Search Console, submit the sitemap, request indexing.
4. Wait a month before judging anything.
5. Then consider prerendering, and start on links.

Steps 2 and 3 are perhaps an hour of work together. Step 1 is the one that
matters most.
