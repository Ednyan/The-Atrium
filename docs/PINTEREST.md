# Pinterest: what the import may do

Written 2026-10-30, before any of it is built. The Atrium's app was approved
for Pinterest's **Standard access** on 2026-10-13 (email from the Pinterest
Developer Platform, pinbot@account.pinterest.com). Approval is for the app as
it was described in the review; it doesn't set aside the Developer
Guidelines, which apply whether or not the Atrium is paid for.

**Not legal advice.** This is a reading of Pinterest's published rules. Before
charging for the Atrium: a lawyer reads this and the site's terms, and
Pinterest confirms the use in writing (the message at the end).

## What the import does today

- Connects with read-only scopes, `boards:read,pins:read,user_accounts:read`;
  the tokens stay in the worker (`src/lib/pinterest.ts`, workers/rooms).
- Imports a board as a group of embed traces, one per pin
  (`src/components/PinterestImportPanel.tsx`): the pin's image address
  (`media_url`, i.pinimg.com), the pin's own page (`link_url`, a link back
  to Pinterest), and its title as the trace's name.
- Those traces are kept like any others: in the vault, in Drive, or in the
  hosted store; shown in shared and public atriums; mirrored for public
  Drive atriums (`workers/rooms/src/mirror.ts`).
- On desktop, **Convert to image** downloads the picture into the vault
  (`src/lib/traceConvert.ts`, Rust `download_remote_image`); from there it
  can be uploaded with the atrium like any picture.
- A pin can be cropped and given a Look filter, like any embed.
- Nothing on the canvas says a pin came from Pinterest (the mark appears
  only in the connection panel and on the welcome screen).

## Where that meets Pinterest's rules

From the [Developer Guidelines](https://policy.pinterest.com/en/developer-guidelines):

| Rule | Quote | The Atrium |
|---|---|---|
| No storing | "you may not store any information accessed through any Pinterest Materials including the API … call the API each time you need to access information" (except an account whose holder has expressly granted access) | Keeps each pin's image address, link and title in the atrium. Arguably within the exception (people import their own boards after granting access); unclear for keeping them for good |
| No new content | "Not create new content from Pins that can be distributed on your app or service" | A public atrium made of pins comes close |
| Attribution | "Link Pins back to their source on Pinterest" and "make sure it's clear that the content comes from Pinterest" | Links back (yes); no mark on the canvas (no) |
| Don't obscure | "Not cover or obscure content from Pinterest", such as by applying filters to Pins | Crop and Look apply to pins |
| Consent | No actions on users' behalf without their knowledge and consent | Import is the person's own choice, board by board (yes) |
| Paid apps | No rule against charging for an app | Fine; but don't sell Pinterest content or make the import a paid feature |

The clearest conflict is **Convert to image** on a pin: a copy of Pinterest's
image, kept, and possibly uploaded where others see it.

The realistic consequence of ignoring this is Pinterest revoking the app's
API access, not a lawsuit.

## Copyright, apart from Pinterest

Most pins are other people's work; API access gives neither the Atrium nor
its users any right to the images.
- A private copy on someone's own disk, for reference, is like saving an
  image from a browser: low risk for them, and a tool maker is generally not
  answerable for users' private copies.
- The risk is in **hosting and showing**: pictures in cloud or public
  atriums, the public mirror. That is true of any picture people upload,
  not only pins.
- Needed for any hosted picture: a notice-and-takedown process. The site's
  terms already give an email for copyright concerns (`public/terms.html`).
  In the EU, the Digital Services Act's notice-and-action rules for hosting
  services; with US users, a DMCA designated agent registered with the US
  Copyright Office (about $6) for its safe harbour.

## To do

In order; none of it built yet.

1. **Ask Pinterest in writing** (the message below); keep the answer here.
2. **A Pinterest mark on every imported pin** on the canvas, linking to the
   pin. Tell imported pins apart by `link_url` on pinterest.com/pin (or an
   explicit marker set by the import).
3. **No Convert to image for imported pins** -- or, if Pinterest allows a
   local copy: local only, never uploaded to cloud or public atriums, never
   mirrored.
4. **Public atriums and pins**: until Pinterest says otherwise, a public
   atrium shows an imported pin as a card linking to the pin (or not at
   all), not the picture.
5. **No Look filter or crop on imported pins**, unless Pinterest says it's
   fine.
6. **Keep the import free**, and out of the paid plan's selling points
   (docs/PLANS.md).
7. **Terms and takedown**: a lawyer reviews `public/terms.html` and
   `public/privacy.html` (Pinterest data named in the privacy policy);
   register a DMCA agent once there are US users paying; a short takedown
   page or section with the copyright email and what happens after a
   report (operator bans and deletion already exist in the worker).
8. **Tokens**: disconnecting Pinterest deletes the stored tokens (check it
   does), and the privacy policy says what is kept and for how long.

## The message to Pinterest

To Pinterest's developer support, from the account that owns the app:

> Hello. Our app, The Digital Atrium (approved for Standard access on
> 13 October 2026), is a canvas for visual references, on the web and as a
> desktop app. With the boards:read and pins:read scopes, a person can import
> one of their own boards into one of their atriums. Each Pin becomes a
> picture on the canvas showing the Pin's image from Pinterest's servers and
> linking back to the Pin on Pinterest.
>
> We'd like to confirm that the following is within the Developer Guidelines,
> in particular "you may not store any information accessed through any
> Pinterest Materials":
> 1. Keeping each imported Pin's image URL, title and link in the person's
>    atrium, so it's still there the next time they open it.
> 2. Showing those Pins to people the owner has shared the atrium with, or in
>    an atrium they've made public, always linked back to the Pin.
> 3. On our desktop app, letting the person save a copy of a Pin's image to
>    their own computer for private reference.
> 4. Letting the person crop a Pin or adjust its colours on their canvas.
>
> We plan to offer a paid plan for the app itself; the Pinterest import would
> stay free. If any of these isn't allowed, we'll change it. Thank you.

## Sources

- [Pinterest Developer Guidelines](https://policy.pinterest.com/en/developer-guidelines)
- [Pinterest Business Terms of Service](https://business.pinterest.com/business-terms-of-service/)
- [Pinterest developer community: using Pinterest images and permission](https://community.pinterest.biz/t/inquiry-about-using-pinterest-images-and-obtaining-official-permission/39124.md)
