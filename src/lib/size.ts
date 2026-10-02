// A size in bytes as people read one: in B, KB, MB or GB, whichever it has
// reached, with the unit as the language writes it (Intl -- Mo in French, МБ
// in Russian).
const SIZE_UNITS = ['byte', 'kilobyte', 'megabyte', 'gigabyte'] as const
export function formatSize(bytes: number, language: string): string {
  let value = Math.max(0, bytes)
  let unit = 0
  while (value >= 1024 && unit < SIZE_UNITS.length - 1) {
    value /= 1024
    unit++
  }
  return new Intl.NumberFormat(language, {
    style: 'unit', unit: SIZE_UNITS[unit], unitDisplay: 'short',
    maximumFractionDigits: unit === 0 ? 0 : unit === 3 ? 2 : 1,
  }).format(value)
}
