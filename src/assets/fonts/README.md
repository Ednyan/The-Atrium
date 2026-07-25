# Custom fonts

Add fonts here to make them available in a trace's **Font Family** dropdown
(Customize panel), labeled `<name> (Custom)`. Two ways to add them:

- **A whole family folder** (e.g. a Google Fonts download): just drop the
  folder in as-is. Each folder becomes **one** dropdown entry named after the
  folder, using the family's variable font if present, otherwise its Regular
  weight. Any `static/` subfolder of individual weights is intentionally
  ignored, so the build stays small.
- **A bare font file** dropped directly in this folder: becomes one entry
  named after the filename.

Notes:

- **Supported formats:** `.ttf`, `.otf`, `.woff`, `.woff2`.
- **The entry name** is the folder (or file) name, with non-alphanumeric
  characters replaced by `_` — e.g. `Playfair Display` → `Playfair_Display`.
- Fonts are bundled at **build time** via `import.meta.glob` in
  `TraceOverlay.tsx` (no runtime directory listing — works on any host).
  After adding fonts, rebuild: `npm run build` (web) and `npm run tauri:build`
  (desktop). They won't show up in an already-built app until you rebuild.
