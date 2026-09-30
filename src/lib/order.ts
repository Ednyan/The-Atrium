// Stacking order: which trace is drawn over which.
//
// The atrium is one stack, as in Photoshop: groups, and traces in no group,
// side by side, so a loose trace can sit between two groups. Each of them has
// an order key placing it in that stack (topLevel); a trace in a group has one
// placing it among the group's traces. A key is a string that sorts between
// its neighbours, so putting something between two others means giving it a
// key between theirs: one write, whatever else is in the atrium. Nothing else
// is renumbered.
//
// It replaced a z-index of group*100 + position, where moving a group meant
// rewriting every trace inside it, reordering the groups rewrote every trace in
// the atrium one request at a time, and a group of more than 99 traces ran into
// the next group's numbers.
//
// The drawing order is worked out from the keys when it's needed (drawRanks):
// the stack from the bottom up, a group's traces in order where it stands.
//
// Until 2026-09-30 loose traces were a band of their own, "Ungrouped", drawn
// under every group, and keyed apart from the groups -- so an atrium from
// then has both starting from the same first key. flattenLegacyOrder lifts
// its groups above its loose traces, which is how it was drawn; it is done
// once (the web's make_layers_one_stack.sql, localDb at startup, and a file
// or vault mirror without layerOrder: 'flat' when it is read).
//
// The keys are fractional indexes, as Figma and Linear order things: base-62
// strings with an integer part whose length is given by its first character
// (a-z longer and larger, A-Z the negatives) and a fraction after it. This is
// David Greenspan's scheme, as published in the `fractional-indexing` package
// (CC0), written out here with its tests rather than added as a dependency.
//
// Compare keys with < and >, never localeCompare: the order is the digits'
// code points, and a locale would put "a" beside "A".

const DIGITS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz'
const ZERO = DIGITS[0]
const SMALLEST_INTEGER = 'A' + ZERO.repeat(26)

function midpoint(a: string, b: string | null): string {
  if (b !== null && a >= b) throw new Error(`${a} >= ${b}`)
  if (a.slice(-1) === ZERO || (b && b.slice(-1) === ZERO)) throw new Error('trailing zero')
  if (b) {
    // The common prefix, then the midpoint of what follows it.
    let n = 0
    while ((a[n] || ZERO) === b[n]) n++
    if (n > 0) return b.slice(0, n) + midpoint(a.slice(n), b.slice(n))
  }
  const digitA = a ? DIGITS.indexOf(a[0]) : 0
  const digitB = b !== null ? DIGITS.indexOf(b[0]) : DIGITS.length
  if (digitB - digitA > 1) return DIGITS[Math.round(0.5 * (digitA + digitB))]
  // The first digits are consecutive.
  if (b && b.length > 1) return b.slice(0, 1)
  return DIGITS[digitA] + midpoint(a.slice(1), null)
}

function integerLength(head: string): number {
  if (head >= 'a' && head <= 'z') return head.charCodeAt(0) - 97 + 2
  if (head >= 'A' && head <= 'Z') return 90 - head.charCodeAt(0) + 2
  throw new Error(`invalid order key head: ${head}`)
}

function integerPart(key: string): string {
  const length = integerLength(key[0])
  if (length > key.length) throw new Error(`invalid order key: ${key}`)
  return key.slice(0, length)
}

export function isValidOrderKey(key: string): boolean {
  try {
    if (key === SMALLEST_INTEGER) return false
    for (const c of key) if (!DIGITS.includes(c)) return false
    const i = integerPart(key)
    return key.slice(i.length).slice(-1) !== ZERO
  } catch {
    return false
  }
}

function incrementInteger(x: string): string | null {
  const [head, ...digits] = x.split('')
  let carry = true
  for (let i = digits.length - 1; carry && i >= 0; i--) {
    const d = DIGITS.indexOf(digits[i]) + 1
    if (d === DIGITS.length) digits[i] = ZERO
    else { digits[i] = DIGITS[d]; carry = false }
  }
  if (!carry) return head + digits.join('')
  if (head === 'Z') return 'a' + ZERO
  if (head === 'z') return null
  const h = String.fromCharCode(head.charCodeAt(0) + 1)
  if (h > 'a') digits.push(ZERO)
  else digits.pop()
  return h + digits.join('')
}

function decrementInteger(x: string): string | null {
  const [head, ...digits] = x.split('')
  let borrow = true
  for (let i = digits.length - 1; borrow && i >= 0; i--) {
    const d = DIGITS.indexOf(digits[i]) - 1
    if (d === -1) digits[i] = DIGITS.slice(-1)
    else { digits[i] = DIGITS[d]; borrow = false }
  }
  if (!borrow) return head + digits.join('')
  if (head === 'a') return 'Z' + DIGITS.slice(-1)
  if (head === 'A') return null
  const h = String.fromCharCode(head.charCodeAt(0) - 1)
  if (h < 'Z') digits.push(DIGITS.slice(-1))
  else digits.pop()
  return h + digits.join('')
}

// A key between a and b (null: no bound on that side). a must be below b.
export function keyBetween(a: string | null, b: string | null): string {
  if (a !== null && !isValidOrderKey(a)) throw new Error(`invalid order key: ${a}`)
  if (b !== null && !isValidOrderKey(b)) throw new Error(`invalid order key: ${b}`)
  if (a !== null && b !== null && a >= b) throw new Error(`${a} >= ${b}`)
  if (a === null) {
    if (b === null) return 'a' + ZERO
    const ib = integerPart(b)
    const fb = b.slice(ib.length)
    if (ib === SMALLEST_INTEGER) return ib + midpoint('', fb)
    if (ib < b) return ib
    const lower = decrementInteger(ib)
    if (lower === null) throw new Error('cannot go lower')
    return lower
  }
  if (b === null) {
    const ia = integerPart(a)
    const higher = incrementInteger(ia)
    return higher === null ? ia + midpoint(a.slice(ia.length), null) : higher
  }
  const ia = integerPart(a)
  const ib = integerPart(b)
  if (ia === ib) return ia + midpoint(a.slice(ia.length), b.slice(ib.length))
  const higher = incrementInteger(ia)
  if (higher === null) throw new Error('cannot go higher')
  return higher < b ? higher : ia + midpoint(a.slice(ia.length), null)
}

// n keys in order between a and b, spread so none of them is squeezed.
export function keysBetween(a: string | null, b: string | null, n: number): string[] {
  if (n <= 0) return []
  if (n === 1) return [keyBetween(a, b)]
  if (b === null) {
    const keys = [keyBetween(a, null)]
    while (keys.length < n) keys.push(keyBetween(keys[keys.length - 1], null))
    return keys
  }
  if (a === null) {
    const keys = [keyBetween(null, b)]
    while (keys.length < n) keys.unshift(keyBetween(null, keys[0]))
    return keys
  }
  const mid = Math.floor(n / 2)
  const c = keyBetween(a, b)
  return [...keysBetween(a, c, mid), c, ...keysBetween(c, b, n - mid - 1)]
}

// ---- Ordering things that have keys ----------------------------------------------------------------

export interface Ordered { id: string; orderKey?: string | null }

// Bottom to top. A thing without a key yet (one made by a version from before
// keys) goes above those with one, as a new thing would; ties -- the same key,
// reached by two people at once -- are broken by id, the same way everywhere.
export function compareOrder(a: Ordered, b: Ordered): number {
  const ka = a.orderKey ?? null, kb = b.orderKey ?? null
  if (ka !== kb) {
    if (ka === null) return 1
    if (kb === null) return -1
    return ka < kb ? -1 : 1
  }
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
}

export function inOrder<T extends Ordered>(items: T[]): T[] {
  return [...items].sort(compareOrder)
}

// Keys for n new things placed above everything in `items`.
export function keysOnTop(items: Ordered[], n = 1): string[] {
  let top: string | null = null
  for (const item of items) {
    const key = item.orderKey ?? null
    if (key !== null && isValidOrderKey(key) && (top === null || key > top)) top = key
  }
  return keysBetween(top, null, n)
}

// Keys for n new traces on top of a group's.
export function keysOnTopOfGroup(traces: Stackable[], layerId: string, n = 1): string[] {
  return keysOnTop(traces.filter(t => t.layerId === layerId), n)
}

// The order field for n new trace rows, in no group, on top of everything --
// what every place that makes traces puts in its insert, so nothing new lands
// hidden under what's already there. Pass the store's traces as they are now,
// so a batch made one at a time stacks.
export function newTraceOrderFields(traces: Stackable[], layers: Ordered[], n = 1) {
  return keysOnTop(topLevel(traces, layers), n).map(order_key => ({ order_key }))
}

// Where to put `moving` so that it lands at position `index` of `others`
// (bottom to top, not containing it): a key between the two it will sit
// between. Null when they share a key and nothing fits -- the caller re-keys
// the whole run with keysBetween(null, null, n) then, which is rare.
export function keyAt(others: Ordered[], index: number): string | null {
  return keysAt(others, index, 1)?.[0] ?? null
}

// n keys, in order, for things landing together at position `index` of
// `others`; null as keyAt.
export function keysAt(others: Ordered[], index: number, n: number): string[] | null {
  const sorted = inOrder(others)
  const below = index > 0 ? sorted[index - 1]?.orderKey ?? null : null
  const above = index < sorted.length ? sorted[index]?.orderKey ?? null : null
  if (below !== null && !isValidOrderKey(below)) return null
  if (above !== null && !isValidOrderKey(above)) return null
  if (below !== null && above !== null && below >= above) return null
  return keysBetween(below, above, n)
}

// Keys for rows from before order keys (an older export), which carry only a
// number: in each group (by `groupOf`), in the order of their numbers.
export function keysFromNumbers<T>(rows: T[], numberOf: (row: T) => number, groupOf: (row: T) => string | null = () => null): Map<T, string> {
  const groups = new Map<string | null, T[]>()
  for (const row of rows) {
    const group = groupOf(row)
    const list = groups.get(group)
    if (list) list.push(row)
    else groups.set(group, [row])
  }
  const keys = new Map<T, string>()
  for (const list of groups.values()) {
    const sorted = [...list].sort((a, b) => numberOf(a) - numberOf(b))
    keysBetween(null, null, sorted.length).forEach((key, i) => keys.set(sorted[i], key))
  }
  return keys
}

// ---- The drawing order ---------------------------------------------------------------------------

export interface Stackable extends Ordered { layerId?: string | null }

// The group a trace is in, or null when it's in none -- or in one that isn't
// known (deleted, or not loaded yet), which it's drawn as.
export function groupIdOf(trace: Stackable, layers: Ordered[]): string | null {
  return trace.layerId && layers.some(l => l.id === trace.layerId) ? trace.layerId : null
}

// The stack: every group, and every trace in none -- the things ordered among
// each other. The groups first, then the loose traces; inOrder() it to stack it.
export function topLevel<T extends Stackable, L extends Ordered>(traces: T[], layers: L[]): (T | L)[] {
  const known = new Set(layers.map(l => l.id))
  return [...layers, ...traces.filter(t => !t.layerId || !known.has(t.layerId))]
}

// What a trace is ordered among, not counting itself: its group's other
// traces, or -- in none -- the rest of the stack, groups included.
export function siblingsOf<T extends Stackable, L extends Ordered>(trace: T, traces: T[], layers: L[]): (T | L)[] {
  const group = groupIdOf(trace, layers)
  const pool = group ? traces.filter(t => t.layerId === group) : topLevel(traces, layers)
  return pool.filter(s => s.id !== trace.id)
}

// Each trace's place in the drawing order, 1 at the bottom: the stack from the
// bottom up, a group's traces in order where the group stands.
export function drawRanks(traces: Stackable[], layers: Ordered[]): Map<string, number> {
  const known = new Set(layers.map(l => l.id))
  const byGroup = new Map<string, Stackable[]>()
  for (const trace of traces) {
    if (!trace.layerId || !known.has(trace.layerId)) continue
    const list = byGroup.get(trace.layerId)
    if (list) list.push(trace)
    else byGroup.set(trace.layerId, [trace])
  }
  const ranks = new Map<string, number>()
  let rank = 0
  for (const item of inOrder(topLevel(traces, layers))) {
    if (known.has(item.id)) {
      for (const trace of inOrder(byGroup.get(item.id) ?? [])) ranks.set(trace.id, ++rank)
    } else {
      ranks.set(item.id, ++rank)
    }
  }
  return ranks
}

// An atrium keyed before the stack (see the top): new keys that lift its
// groups, in their order, above every loose trace -- and give a loose trace
// with no key yet one just under the groups, where it was drawn. Empty when
// there's nothing to lift (no groups, or no loose traces).
export function flattenLegacyOrder(traces: Stackable[], layers: Ordered[]): { traces: Map<string, string>; layers: Map<string, string> } {
  const known = new Set(layers.map(l => l.id))
  const loose = traces.filter(t => !t.layerId || !known.has(t.layerId))
  const out = { traces: new Map<string, string>(), layers: new Map<string, string>() }
  if (layers.length === 0 || loose.length === 0) return out
  let top: string | null = null
  for (const t of loose) {
    const k = t.orderKey ?? null
    if (k !== null && isValidOrderKey(k) && (top === null || k > top)) top = k
  }
  const unkeyed = loose.filter(t => !t.orderKey || !isValidOrderKey(t.orderKey)).sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
  const groups = inOrder(layers)
  const keys = keysBetween(top, null, unkeyed.length + groups.length)
  unkeyed.forEach((t, i) => out.traces.set(t.id, keys[i]))
  groups.forEach((g, i) => out.layers.set(g.id, keys[unkeyed.length + i]))
  return out
}
