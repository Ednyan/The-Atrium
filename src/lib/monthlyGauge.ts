// The figures behind the monthly gauge, in one place.
//
// The same bar is drawn three times -- vertically in the margin of the welcome
// screen and the atrium browser, horizontally on the contributors wall and on
// the landing page -- and the three had already drifted: two rounded euros
// differently and the third phrased the total another way again. They are far
// enough apart visually that one component would be a worse answer than one
// source for the numbers and the wording.
//
// No money leaves this file. A gauge that names a sum turns a quiet ornament
// into a fundraising thermometer, and the figure it would print is nobody's
// business but the person paying the bills. What it says instead is how much of
// the month is covered, and how many people covered it -- which is the part
// that is actually about the reader.

import type { MonthlyProgress } from './contributions'
import { pluralCategory } from './i18n'
// From the catalogue rather than from i18n, which imports the type but does not
// re-export it.
import type { TranslationKey } from '../locales/en'

export interface GaugeFigures {
  // 0-100, already clamped. The fill, and the only number the bar itself means.
  percent: number
  count: number
}

// Null when there is nothing honest to draw: a machine that has never been
// online has no figures, and a bar reading zero is a claim rather than an
// absence.
export function gaugeFigures(month: MonthlyProgress | null): GaugeFigures | null {
  if (!month || month.goalCents <= 0) return null

  return {
    percent: Math.min(100, Math.round((month.totalCents / month.goalCents) * 100)),
    count: month.contributionCount,
  }
}

// Zero keeps its own sentence rather than being handed to the plural rule:
// "0 contributions" is arithmetic where "nobody yet" is the thing worth saying.
// Above zero the language picks its own form -- Russian wants three, and wants
// the first of them again at 21, which no amount of appending an s gets right.
export function contributionCountKey(count: number): TranslationKey {
  if (count === 0) return 'goal.noneYet'
  return ({
    one: 'goal.countOne',
    few: 'goal.countFew',
    many: 'goal.countMany',
  } as const)[pluralCategory(count)]
}
