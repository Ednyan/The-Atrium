// Numbered default names: Group 1, Group 2 for groups, Text 1, Text 2 for text
// traces -- the lowest number whose name isn't already taken, compared without
// case. nameFor gives the name for a number, in the reader's language.

export function firstFreeName(taken: Iterable<string | null | undefined>, nameFor: (n: number) => string): string {
  const used = new Set(Array.from(taken, name => (name ?? '').trim().toLowerCase()))
  let n = 1
  while (used.has(nameFor(n).toLowerCase())) n++
  return nameFor(n)
}

// The next free name for a text trace among `traces`; `alsoTaken` for a batch
// being named before any of it exists.
export function nextTextName(
  traces: { type: string; layerName?: string | null }[],
  nameFor: (n: number) => string,
  alsoTaken: string[] = [],
): string {
  return firstFreeName([...traces.filter(t => t.type === 'text').map(t => t.layerName), ...alsoTaken], nameFor)
}

// The next free "Untitled N" among the titles of traces other than text ones
// (a text trace's content is its text, not a title).
export function nextUntitledName(
  traces: { type: string; content?: string | null }[],
  nameFor: (n: number) => string,
  alsoTaken: string[] = [],
): string {
  return firstFreeName([...traces.filter(t => t.type !== 'text').map(t => t.content), ...alsoTaken], nameFor)
}

// A name as it will show: whitespace run together, and blanks gone from the
// ends. A title of nothing but blanks is no title at all; it showed as an
// empty row.
//
// Blanks are more than whitespace. Pinterest's "invisible names" are Hangul
// fillers (U+3164) or the empty Braille cell (U+2800) -- letters and symbols
// as far as any check for text goes. \p{Default_Ignorable_Code_Point} has the
// fillers, zero-width spaces, joiners and variation selectors; inside a name
// those stay, since they hold emoji like the heart on fire together.
const BLANK = String.raw`\s\p{Default_Ignorable_Code_Point}\u2800`
const ALL_BLANK = new RegExp(`^[${BLANK}]*$`, 'u')
const BLANK_ENDS = new RegExp(`^[${BLANK}]+|[${BLANK}]+$`, 'gu')

export function cleanTitle(text: string | null | undefined): string {
  const title = text ?? ''
  return ALL_BLANK.test(title) ? '' : title.replace(/\s+/g, ' ').replace(BLANK_ENDS, '')
}

// A file's name without its extension: "Sunset.final.png" -> "Sunset.final".
export function fileTitle(fileName: string): string {
  return cleanTitle(fileName.replace(/\.[^./\\]+$/, ''))
}
