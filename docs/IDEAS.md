# Ideas: help, templates, phone capture

Written 2026-10-30. Nothing here is built except where it says. The order is decided up to step 2; after that the user evaluates how the
rest should work.

1. Help search and suggestions, no AI (with the documentation under it).
2. Templates.
3. Later, to be evaluated: phone capture, AI answers.

## 1. Help and suggestions

**Documentation.** The tree of what to write, and how, is
[help/README.md](help/README.md); [help/arranging/frames.md](help/arranging/frames.md)
is the first article. The About page already has an empty Tutorials section waiting
(`about.tutorials`, `src/components/AboutPage.tsx`).

**Search. Built 2026-10-31.** `HelpPanel` searches and shows the articles, in the
page itself: no server, no requests, and the articles ship with the app. It opens
from the atrium menu, **?**, the atrium browser, the welcome screen and About.
Articles are in English for now, and the panel says so in other languages.

**Suggestions and reports: saved, not emailed. Built 2026-10-30.** The form
(`ReportFeedbackModal`) sends to `/feedback` (`workers/rooms/src/feedback.ts`) on
web and desktop, which writes one row to D1. **Feedback** in Developers lists
them, newest first: mark handled, delete, reply. It reads only when opened. One
request and a few rows per report; the hourly limits are 5 a network and 30 for
everyone. The mail app stays as the fallback if the worker can't be reached.

"Didn't find it? Suggest it" under the search results opens this same form,
with what was searched for filled in as the subject.

**AI answers, later.** On top of the articles and only from them, by Workers
AI (10,000 free neurons a day, then $0.011 per 1,000), with a limit per
person; plain search when the day's budget is out. A small model can't reliably
say what isn't implemented: it says "I can't find that, want to suggest it?".
Its one real gift is answering in all 11 languages from articles written once.

## 2. Templates: an inventory

The user's design (2026-10-30). A template is a trace, a selection or a group
saved to be used again; the inventory is where they live.

- **A sidebar**, opened from the top bar, docked where the other panels are.
  Templates are dragged from it onto the canvas.
- **Folders**, as on a computer, inside each other as deep as wanted: the person
  makes, renames, moves and deletes them.
- **"Digital Atrium" folder**: always there, can't be deleted or changed. Holds
  the templates made here, and new ones reach everyone without a release.
- **Quick slots**: a row of a few chosen templates at the foot of the sidebar,
  to drag from without opening a folder. Chosen as the Customization footer's
  buttons are (`PanelFooter`, `FooterChooser`).
- **Saving**: "Save as template" in the trace menu, or a selection dragged into
  a folder (`panelDrop` already carries a drag from the canvas into a panel).

**Free or paid (the user, 2026-10-30): custom templates are a paid feature.**
- Free: using the Digital Atrium folder.
- Paid: making and keeping your own, with folders and quick slots.

### How it's built

A template is a small `.atrium` file. That format already keeps pictures and
files inside it, and carries groups, frames and connections
(`atriumFileBlob`, `importIntoAtrium` in `src/lib/atriumFile.ts`). Dropping one
is an import at the point of the drop, as one undo step, with new ids.
- **Digital Atrium folder**: a list plus `.atrium` files in the public bucket
  (files.digitalatrium.org), fetched when the sidebar first opens, and cached.
  Costs almost nothing; no worker request.
- **A person's templates**: since they're paid, they belong to the account and
  follow it across devices, in its hosted space, counted against its 5 GB. The
  folders and quick slots are a small list in the account's app data
  (`/store/appdata`, 16 KB at most).

### Decisions made here

- **Up to 8 quick slots**, shared across the person's devices.
- **A drop keeps the size the template was saved at**, whatever the zoom, and
  lands centred on the pointer.
- **Dropped into a frame, it joins the frame**, as anything put down there does.

### Things to watch

- **The plans must exist first.** Custom templates need the paid plan's check
  (docs/PLANS.md, not built). The panel and the Digital Atrium folder don't, so
  they can ship first, with custom templates following the plans.
- **Files take room twice.** A template's pictures count once in the template
  and again in each cloud atrium it's dropped into. Say so in the size shown.
- **Desktop offline**: it keeps a copy of the person's templates, and uses them
  offline for as long as the plan's last known end date allows.
- **Pinterest**: a template holding pins would keep and reuse Pinterest's data,
  which docs/PINTEREST.md already questions. Leave pins out of saved templates
  until Pinterest answers.
- **Live files**: a live file's link to its original stays behind; a template
  is a copy.

## 3. Phone capture (to evaluate)

A very simple companion: a camera button and "Send to Atrium" from other apps;
what's sent waits in an Inbox. The closest thing today is the browser extension
(`extension/`), which sends text, embeds and images to the open atrium.

- **Start**: an installable web app (camera, paste a link). `share_target` in
  `public/site.webmanifest` adds the share menu on Android.
- **iPhone**: found no sign that Safari supports Web Share Target (WebKit bug
  194593; check current support first). The share sheet would then need a native
  app and Apple's $99 a year.
- **The Inbox as a tray of the account**, shown in whichever atrium is open and
  dragged out from there, rather than a stack on one canvas; choosing an atrium
  on the street is what the idea wants to avoid. It could be the same sidebar as
  the templates. Read when an atrium opens, no timer (no request clocks).
- **Where captures wait**: in the worker's private storage, compressed, deleted
  once collected or after about 30 days. They wouldn't be sealed like Drive
  atriums; decide whether that's acceptable.
- **Storage**: free space is 50 MB, which photos spend quickly.
