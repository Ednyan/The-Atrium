# The documentation

Written 2026-10-30, from the app's own text (`src/locales/en.ts`) and code, so it
lists what's really there. [arranging/frames.md](arranging/frames.md) is the first
article and the model for the rest.

## How it's organized

Three levels: **section > topic > article**. Each section is a folder, each
article a file: `docs/help/<section>/<id>.md`. The tree below is the one list of
what exists and where it goes; the help search and the AI both follow it.

Articles ship with the app, for the help search. They're translated
once the English has settled: 60 articles in 11 languages isn't worth doing twice.

## How to write an article

**Straight to the point.** People come for the information. Professional and
plain: no praise for the tool, no scene-setting, no "powerful" or "seamlessly".
If a sentence doesn't help someone do the thing, cut it.

**As visual as possible, and never vague.** A picture for every concept and a table
when there are choices. Under each picture, the exact steps and what happens. After
reading, someone must be able to do it without guessing.

- Open with one or two sentences saying what it is, then a picture.
- Steps by what the person wants ("A frame around traces you've placed"), not by
  menu.
- On-screen names exactly as in `en.ts`, in bold. Keys in bold too.
- Say what surprises: what gets resized, what stays behind.
- Real screenshots and small diagrams, in `images/`, named `<id>-<what>.png`.
- Every claim tried in the running app first. Notes go out of date: Frames'
  key was 8, not the 9 they said.

**Written for the AI too**, since AI answers will be built on these:

- **Front matter on every article:** `id`, `title`, `section`, `summary` (one
  sentence), `keywords` (including the words people would search for, not only
  ours), `where`, `works_on`, `related` (ids), `video`.
- **Good to know** lists the limits. It's how search and the AI can say something
  isn't possible, rather than guess.
- **Related** links each article to its neighbours and says why you'd go there,
  and when to use one over the other. A link to an article not written yet is fine.
- One topic in one place: link to it rather than explaining it twice.

## The tree

**Video** marks what's hard to explain without seeing it. **Order 1** is written
first. Web and Desktop mean only there; no mark means both.

### 1. Getting started (`getting-started/`)

| Article | Covers | Order | Video |
|---|---|---|---|
| [`what-is-an-atrium`](getting-started/what-is-an-atrium.md) | **Written.** Atriums, traces, how the pieces fit | 1 | Yes |
| `first-atrium` | Make one, bring things in, arrange, share | 1 | Yes |
| [`where-atriums-live`](getting-started/where-atriums-live.md) | **Written.** This browser, the Atrium's cloud, Google Drive, the desktop vault; differences, limits | 1 | |
| `accounts` | Email, Google, no account; username against display name | 2 | |
| `atrium-browser` | Your atriums, shared, public; cards or list; join by ID; settings without going in | 2 | |
| `web-or-desktop` | What each does, moving between them | 2 | |
| `install-desktop` | Windows, macOS, Linux; first-launch warnings; updates | 2 | |

### 2. Moving around (`moving-around/`)

| Article | Covers | Order | Video |
|---|---|---|---|
| [`moving-around`](moving-around/moving-around.md) | **Written.** Pan, zoom, Move the view (H), recenter (Shift+1), 100% (0), coordinates | 1 | Yes |
| [`keyboard-shortcuts`](moving-around/keyboard-shortcuts.md) | **Written.** Every key, one page | 1 | |
| `minimap-and-view` | Minimap, off-screen arrows, fade at the edge, hide UI, fullscreen | 3 | |
| `locations-and-presenting` | Saved views, locking, presentation mode, export as slides or web page | 2 | Yes |
| `phones-and-tablets` | The bar along the foot, what changes with touch | 3 | |

### 3. Bringing things in (`bringing-things-in/`)

**3.1 The tools**

| Article | Covers | Order | Video |
|---|---|---|---|
| `quick-bar` | The tools, armed or instant, reorder it, More | 1 | Yes |
| `drop-and-paste` | Files, folders, links, the clipboard; several at once; square or circle layout | 1 | Yes |
| [`templates`](bringing-things-in/templates.md) | **Written.** The sidebar, folders, placing one, quick slots | 1 | |

**3.2 Words, shapes and drawing**

| Article | Covers | Order | Video |
|---|---|---|---|
| `text` | Box or plain, sizing, fonts, your own fonts, alignment, inline editing | 1 | |
| `shapes` | The five shapes, fill, outline, corners, a label | 2 | |
| `paths-and-arrows` | Drawing, points, elbows, arrowheads, Shift to snap to a border | 2 | Yes |
| `drawing` | Brushes, eraser, your own brushes, Edit Drawing, Split into Strokes, Rasterize | 2 | Yes |

**3.3 Pictures and media**

| Article | Covers | Order | Video |
|---|---|---|---|
| `pictures` | Formats, GIFs, crop, flip, reset | 1 | |
| `exr-grading` | View transform, colour space, exposure, presets, LUTs | 3 | Yes |
| `video-and-sound` | Files and YouTube/Vimeo; controls; spatial sound; sound bars | 2 | |
| `embeds-and-links` | Pasting links, several at once, interaction on and off, iframes, what can't be framed, Convert to Image | 1 | |

**3.4 Documents and data**

| Article | Covers | Order | Video |
|---|---|---|---|
| `pdf-and-slides` | Paging, Extract Pages, PowerPoint | 2 | |
| `spreadsheets-and-charts` | Reading, editing cells, charts | 2 | Yes |
| `live-files` | Desktop. Following a file, stopping | 3 | |

**3.5 From elsewhere**

| Article | Covers | Order | Video |
|---|---|---|---|
| `pinterest-import` | Connecting, importing a board, the mark, disconnecting | 2 | |
| `browser-extension` | Installing it, sending things to the atrium | 3 | |

### 4. Arranging (`arranging/`)

**4.1 Selecting and moving**

| Article | Covers | Order | Video |
|---|---|---|---|
| `selecting` | Select, direct select, area, lasso, Shift and Ctrl, Select submenu | 1 | Yes |
| `move-resize-rotate` | Handles, grid snap, snap angles, Reset Rotation and Aspect | 1 | |
| `copy-duplicate-delete` | Copy, paste, duplicate, between atriums, ask before deleting | 2 | |
| `undo-and-saving` | Undo depth, Save, Don't Save, Auto-save, leaving with changes | 1 | |

**4.2 Organizing**

| Article | Covers | Order | Video |
|---|---|---|---|
| [`frames`](arranging/frames.md) | **Written.** | 1 | Yes |
| `groups-and-layers` | The Layers panel, groups, Move to Group, lock, go to | 1 | Yes |
| `stacking-order` | What's on top and how to change it | 2 | |
| `tidying-up` | Reorganize Selected, rectangular or rounded | 3 | |

**4.3 Connecting**

| Article | Covers | Order | Video |
|---|---|---|---|
| `connections` | Threads: making, label, line style, arrows, ends | 2 | Yes |
| `clickable-traces` | Clickable, the link, the hover button to turn it off | 3 | |

### 5. Making it look right (`making-it-look-right/`)

| Article | Covers | Order | Video |
|---|---|---|---|
| `customization-panel` | Sections and switches, presets, your own footer buttons | 1 | Yes |
| `batch-edit` | Changing many at once, mixed values | 2 | |
| `colours-and-palette` | Your palette, I to take a colour, copy and paste style | 2 | |
| `light-glow-effects` | Light, emit from, pulse, soft shadow, Colour (look) | 3 | Yes |
| `atrium-themes` | Presets, your own, grid, particles, background picture, parallax, ground | 2 | Yes |

### 6. Working together (`working-together/`)

| Article | Covers | Order | Video |
|---|---|---|---|
| `sharing` | Link, ID, invitation; why browser and desktop atriums can't be linked | 1 | |
| `people-and-roles` | Owner, admin, editor, viewer; who can edit; allowed, blocked, kicked; transfer | 2 | |
| `public-atriums` | What public means, each kind of atrium | 2 | |
| `drive-atriums` | Encrypted, by link; members; asking to join; bringing back deleted traces | 2 | |
| `live-together` | Cursors, name tags, laser, Hide My IP | 3 | Yes |

### 7. Keeping and moving (`keeping-and-moving/`)

| Article | Covers | Order | Video |
|---|---|---|---|
| `export` | .atrium, PNG, SVG, web page; selection or whole | 2 | |
| `import` | A new atrium or into this one; what can't come along | 2 | |
| `storage-and-limits` | Usage, what counts, making room, a full Drive | 1 | |
| `moving-atriums` | Put online, Move to my Drive, offline copy, held atriums | 2 | |
| `desktop-vault` | Desktop. The folder, changing it, Store Embeds Locally, Restore From Vault | 2 | |
| `overlay-mode` | Desktop. On top, click-through, opacity, transparent, exit keys | 2 | Yes |

### 8. Your account and settings (`account-and-settings/`)

| Article | Covers | Order | Video |
|---|---|---|---|
| `preferences` | User Preferences, one by one: how you work, moving, seeing, sound, animations | 2 | |
| `profile-and-account` | Name, cursor colour, password, signing in on desktop, delete account | 3 | |
| `language-and-theme` | The 11 languages, light and dark | 3 | |

### 9. Help and support (`help-and-support/`)

| Article | Covers | Order | Video |
|---|---|---|---|
| [`report-or-suggest`](help-and-support/report-or-suggest.md) | **Written.** Reporting a problem, suggesting a feature | 1 | |
| `when-something-breaks` | Won't load, a missing file, an embed refuses, can't save, can't sign in | 2 | |
| `supporting-the-atrium` | Donating, monthly, the contributors wall | 3 | |

## Left out on purpose

Developers' tools, Health, bans, the names panel: only the operator sees them.
