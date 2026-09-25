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

// A file's name without its extension: "Sunset.final.png" -> "Sunset.final".
export function fileTitle(fileName: string): string {
  return fileName.replace(/\.[^./\\]+$/, '').trim()
}
