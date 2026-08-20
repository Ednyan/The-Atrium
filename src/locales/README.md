# Translating The Digital Atrium

English lives in `en.ts` and is the source of truth. Every other language is a
partial copy of it.

## Adding a language

Two steps.

1. Copy `en.ts` to `<code>.ts`, translate the values, and export it as the
   default:

   ```ts
   import type { Catalogue } from './en'

   const es: Catalogue = {
     'common.cancel': 'Cancelar',
     // ...
   }

   export default es
   ```

2. Register the loader in `src/lib/i18n.ts`:

   ```ts
   const loaders = {
     es: () => import('../locales/es'),
   }
   ```

That is all. The picker shows the language, the catalogue is fetched as its own
chunk when somebody chooses it, and nothing else in the app has to know.

## Rules for whoever does the translating

**A missing key is fine.** Anything absent falls back to the English string, so
a catalogue can be delivered a section at a time and the app stays usable
throughout. Never leave a key with an empty string — that renders as nothing.
Delete the line instead.

**`{braces}` are values the app fills in.** `'Welcome back, {name}'` must keep
its `{name}` somewhere in the sentence. Moving it is expected — word order
differs — dropping it is a bug that shows up as a missing name.

**Do not translate these.** They are names, not words:

| Term | Why |
|---|---|
| The Digital Atrium | The product's name |
| Atrium | Used as the name of the thing you make, not the architectural feature. "Enter the Atrium" is a place, not a room type. |
| Trace | The app's word for an item on the canvas. It is a coined term here; translating it to "trail" or "mark" loses that it is a noun with a specific meaning. |
| Markerboard, Abyss, Soft Sepia | Names of trace presets |
| Pinterest, Imgur, Stripe, SoundCloud | Third parties |

**The voice matters.** The English copy is deliberately plain and unhurried —
"Free to enter, and kept standing by the people who use it" — and it is not
marketing language. Prefer the natural version in your language over a literal
one. If a sentence only works in English, write the sentence that does the same
job instead of the one that says the same words.

**Length is a constraint.** Much of this interface is small type in tight
buttons. German and Russian run roughly 30% longer than English; where a string
is a button label, shorter is better than complete. The keys under `common.*`
and `atrium.*` are the ones most likely to be sitting in a fixed-width control.

## What is deliberately not translated

The privacy policy and terms of service stay in English. They are legal
documents written by one person, and a translated version that says something
subtly different is a worse outcome than an English one everybody can compare.
The chrome around them follows the app's language; the documents themselves do
not.

Error messages that come back from Supabase or the browser also stay in English
unless the code catches them individually. There are about 48 such places.
