// Fake contributors, for looking at the wall with something on it.
//
// A wall with four names on it tells you nothing about what a wall with three
// hundred does: whether the spiral still reads, whether the tiers are
// distinguishable, whether culling keeps up while panning, whether the goal bar
// looks right when the month is over target. This makes that view available on
// demand.
//
// Generated here and never written to the database. The contributions table is
// the record that money arrived -- what the totals are reconciled against and
// what stops a replayed webhook counting a payment twice -- and seeding it with
// invented rows would put fictional people on the live public wall, then leave
// the accounts permanently wrong if a single one survived the cleanup. These
// exist in this browser, for whoever turned them on, and nowhere else.
//
// Every seeded trace is labelled on the wall. Unlabelled fakes are how a
// screenshot ends up somewhere it shouldn't.

import type { Contributor } from './contributions'

const KEY = 'atrium_seeded_contributors_v1'

export const SEED_PRESETS = [50, 600, 10000]

// Small, fast, and repeatable -- the same seed gives the same wall, so a layout
// problem spotted once can be looked at again instead of being reshuffled away.
function mulberry32(seed: number) {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = Math.imul(state ^ (state >>> 15), 1 | state)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

// Deliberately uneven: short handles, full names, and a few long enough to test
// the width clamp and the truncation behind it.
const FIRST = [
  'Ana', 'Bruno', 'Carla', 'Diogo', 'Eva', 'Filipe', 'Gabriela', 'Hugo', 'Inês',
  'João', 'Katia', 'Luís', 'Mariana', 'Nuno', 'Olívia', 'Pedro', 'Quim', 'Rita',
  'Sofia', 'Tiago', 'Ursula', 'Vasco', 'Wen', 'Xavier', 'Yara', 'Zé',
  'Aiko', 'Bao', 'Chen', 'Dmitri', 'Elif', 'Fatima', 'Giulia', 'Hassan', 'Ivan',
  'Jonas', 'Klara', 'Lars', 'Mei', 'Noor', 'Oskar', 'Priya', 'Rafael', 'Sanne',
  'Tomas', 'Ulrik', 'Valeria', 'Wiktor', 'Yusuf', 'Zofia',
]

const LAST = [
  'Silva', 'Costa', 'Pereira', 'Almeida', 'Ferreira', 'Rocha', 'Nunes',
  'Marques', 'Carvalho', 'Teixeira', 'Novak', 'Kowalski', 'Andersson',
  'Nakamura', 'Okafor', 'Rossi', 'Dubois', 'Müller', 'Ivanov', 'Haddad',
]

const HANDLES = [
  'pixelwright', 'quiet_room', 'atlas', 'moth', 'lowtide', 'nullptr', 'ferrovia',
  'blue_hour', 'cartograph', 'sundial', 'inkwell', 'longwave', 'thirdfloor',
  'papermill', 'anonimo', 'the_archivist', 'saudade', 'vhs', 'orbital',
]

// One of each shape, so the wall is not three hundred of the same silhouette.
function makeName(random: () => number, index: number): string {
  const roll = random()
  if (roll < 0.34) {
    return HANDLES[Math.floor(random() * HANDLES.length)] + (index % 3 === 0 ? String(index) : '')
  }
  if (roll < 0.78) {
    return `${FIRST[Math.floor(random() * FIRST.length)]} ${LAST[Math.floor(random() * LAST.length)]}`
  }
  if (roll < 0.92) {
    return FIRST[Math.floor(random() * FIRST.length)]
  }
  // The long ones, which are the interesting case for the layout.
  return `${FIRST[Math.floor(random() * FIRST.length)]} ${LAST[Math.floor(random() * LAST.length)]}-${LAST[Math.floor(random() * LAST.length)]}`
}

// Weighted the way real giving is: mostly small, thinning out upward. Every
// tier is represented, because a legend that names five bands wants five bands
// on screen to be judged against.
function makeAmount(random: () => number): number {
  const roll = random()
  if (roll < 0.40) return 1 + Math.floor(random() * 4)     // 1-4
  if (roll < 0.65) return 5 + Math.floor(random() * 5)     // 5-9
  if (roll < 0.86) return 10 + Math.floor(random() * 15)   // 10-24
  if (roll < 0.95) return 25 + Math.floor(random() * 25)   // 25-49
  return 50 + Math.floor(random() * 120)                   // 50+
}

interface SeedState {
  count: number
  seed: number
}

function read(): SeedState | null {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw)
    if (typeof parsed?.count !== 'number' || parsed.count <= 0) return null
    return { count: parsed.count, seed: Number(parsed.seed) || 1 }
  } catch {
    return null
  }
}

// Rebuilt from the stored seed rather than stored as rows: three hundred
// objects is a lot of local storage to spend on something disposable, and this
// way the same seed always produces the same wall.
const amountEurTotal = (monthlyEur: number, months: number, oneTimeEur: number) =>
  monthlyEur * months + oneTimeEur

// A rough share of what somebody gave falling inside each window, based on when
// they started. Enough for the range filter to have something to filter.
const DAY_MS = 24 * 60 * 60 * 1000
function windowsFor(total: number, since: string, now: number) {
  const age = (now - new Date(since).getTime()) / DAY_MS
  const share = (days: number) => (age <= days ? total : Math.round(total * (days / Math.max(age, 1))))
  return { amount7d: share(7), amount30d: share(30), amount365d: share(365) }
}

function build({ count, seed }: SeedState): Contributor[] {
  const random = mulberry32(seed)
  const used = new Set<string>()
  const people: Contributor[] = []
  const now = Date.now()
  const DAY = 24 * 60 * 60 * 1000

  for (let index = 0; index < count; index++) {
    let name = makeName(random, index)
    // Two people with one name would merge into one trace, which is a real
    // behaviour of the wall but not the one being looked at here.
    while (used.has(name)) name = `${name}·${index}`
    used.add(name)

    const isMonthly = random() < 0.16
    const since = new Date(now - Math.floor(random() * 540) * DAY).toISOString()

    if (isMonthly) {
      const monthlyEur = [1, 2, 3, 5, 10][Math.floor(random() * 5)]
      const months = 1 + Math.floor(random() * 14)
      // Some of them gave once as well as subscribing.
      const hasOneTime = random() < 0.4
      const oneTimeEur = hasOneTime ? makeAmount(random) : 0
      // And some of them have stopped. Roughly a third, which is enough that
      // the preview shows both a wall of running lights and the still,
      // full-strength gradients of the people who used to give.
      const monthlyActive = random() > 0.33
      people.push({
        displayName: name,
        amountEur: monthlyEur * months + oneTimeEur,
        isMonthly: true,
        monthlyActive,
        monthlyEur,
        since,
        contributionCount: months + (hasOneTime ? 1 : 0),
        hasOneTime,
        oneTimeEur,
        ...windowsFor(amountEurTotal(monthlyEur, months, oneTimeEur), since, now),
        isSeed: true,
      })
    } else {
      const amountEur = makeAmount(random)
      people.push({
        displayName: name,
        amountEur,
        isMonthly: false,
        monthlyActive: false,
        monthlyEur: null,
        since,
        contributionCount: 1 + Math.floor(random() * 3),
        hasOneTime: true,
        oneTimeEur: amountEur,
        ...windowsFor(amountEur, since, now),
        isSeed: true,
      })
    }
  }

  return people
}

export function getSeededContributors(): Contributor[] {
  const state = read()
  return state ? build(state) : []
}

export function seededCount(): number {
  return read()?.count ?? 0
}

// A fresh seed each time, so pressing it twice gives a different wall rather
// than the same one again.
export function seedContributors(count: number) {
  try {
    localStorage.setItem(KEY, JSON.stringify({ count, seed: Date.now() % 100000 }))
  } catch {
    // Nothing to do: this is a preview tool, and it simply won't appear.
  }
}

export function clearSeededContributors() {
  try {
    localStorage.removeItem(KEY)
  } catch {
    // Same.
  }
}

// What the seeded rows would add to this month's total, so the goal bar can be
// looked at with a number on it. Only the ones dated inside the current month
// count, exactly as the real view counts them.
export function seededMonthCents(people: Contributor[]): number {
  const now = new Date()
  const month = now.getUTCMonth()
  const year = now.getUTCFullYear()

  return people.reduce((total, person) => {
    const since = new Date(person.since)
    if (Number.isNaN(since.getTime())) return total
    if (since.getUTCMonth() !== month || since.getUTCFullYear() !== year) return total
    return total + (person.isMonthly ? (person.monthlyEur ?? 0) : person.amountEur) * 100
  }, 0)
}
