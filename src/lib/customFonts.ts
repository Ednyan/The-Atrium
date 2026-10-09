// Custom fonts: drop a font file -- or a whole Google-Fonts-style family
// folder -- into src/assets/fonts. Each family becomes ONE Font Family
// dropdown entry, named after its folder (or the filename for a bare file),
// using the family's variable font when present (else its Regular weight).
// Bundled at build time via import.meta.glob, so there's no runtime directory
// listing (works on any host).
//
// Two patterns, both only ONE level deep: bare files directly in fonts/, and
// files at the ROOT of a family folder. Deliberately NOT recursive -- a Google
// Fonts download nests every individual weight under a static/ subfolder (54
// files for Roboto alone, 72 for Datatype), and bundling all of those would
// bloat the app for no benefit since the root-level variable font already
// covers every weight.
const CUSTOM_FONT_URL_MAP = import.meta.glob(
  [
    '../assets/fonts/*.{ttf,otf,woff,woff2,TTF,OTF,WOFF,WOFF2}',
    '../assets/fonts/*/*.{ttf,otf,woff,woff2,TTF,OTF,WOFF,WOFF2}',
    // Exclude italic files -- we only surface one (roman) entry per family, so
    // an eager glob would otherwise still emit every family's italic variable
    // font as a bundled asset for nothing. Italic text still works via the
    // textItalic toggle (browser-synthesized slant).
    '!../assets/fonts/**/*[Ii]talic*',
  ],
  { eager: true, query: '?url', import: 'default' }
) as Record<string, string>

// One entry per family. The name (dropdown label + @font-face family) is the
// family-folder name (or the bare filename), sanitized to alphanumerics/_/-.
export const CUSTOM_FONTS: { name: string; url: string }[] = (() => {
  const byFamily: Record<string, { file: string; url: string }[]> = {}
  for (const [path, url] of Object.entries(CUSTOM_FONT_URL_MAP)) {
    const rest = path.split('assets/fonts/')[1] ?? path
    const seg0 = rest.split('/')[0]
    const isBareFile = seg0.includes('.')
    const rawName = isBareFile ? seg0.replace(/\.[^.]+$/, '') : seg0
    const name = rawName.replace(/[^a-zA-Z0-9_-]/g, '_')
    const file = path.split('/').pop() || path
    ;(byFamily[name] ??= []).push({ file, url })
  }
  const isVariable = (f: string) => /variablefont|\[.*\]/i.test(f)
  const isItalic = (f: string) => /italic/i.test(f)
  const isRegular = (f: string) => /-regular\.|(^|[^a-z])regular\b/i.test(f)
  return Object.entries(byFamily)
    .map(([name, files]) => {
      const chosen =
        files.find(f => isVariable(f.file) && !isItalic(f.file)) ||
        files.find(f => isVariable(f.file)) ||
        files.find(f => isRegular(f.file) && !isItalic(f.file)) ||
        files.find(f => !isItalic(f.file)) ||
        files[0]
      return { name, url: chosen.url }
    })
    .sort((a, b) => a.name.localeCompare(b.name))
})()

// A bundled family's file, by the name text is set in -- for what has to
// carry the font with it, as an exported SVG does (lib/exportImage).
export const customFontUrl = (family: string) => CUSTOM_FONTS.find(font => font.name === family)?.url
