// A window of the year -- from a month and day to another, every year, both
// days included, and able to run over the new year -- and which of several a
// date falls in. For special themes (lib/specialThemes). Import-free, for the
// tests.

export interface Season {
  // 'MM-DD'
  startsOn: string
  endsOn: string
}

const MONTH_DAY = /^(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/
export const isMonthDay = (value: unknown): value is string => typeof value === 'string' && MONTH_DAY.test(value)
export const monthDayOf = (date: Date) =>
  `${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`

// The day of the year a 'MM-DD' is, in a year without a 29th of February.
const dayOf = (monthDay: string) => {
  const [m, d] = monthDay.split('-').map(Number)
  return Math.round((Date.UTC(2001, m - 1, d) - Date.UTC(2001, 0, 1)) / 86_400_000)
}

export function inSeason(season: Season, date: Date): boolean {
  const today = monthDayOf(date)
  return season.startsOn <= season.endsOn
    ? today >= season.startsOn && today <= season.endsOn
    : today >= season.startsOn || today <= season.endsOn
}

// Of several, the one `date` is in that began most recently -- an occasion
// inside a longer season wins -- or null.
export function seasonalTheme<T extends Season>(seasons: readonly T[], date: Date): T | null {
  const today = dayOf(monthDayOf(date))
  const since = (s: Season) => (today - dayOf(s.startsOn) + 365) % 365
  return seasons.filter(s => inSeason(s, date)).sort((a, b) => since(a) - since(b))[0] ?? null
}
