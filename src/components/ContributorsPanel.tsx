import { useEffect, useState } from 'react'
import {
  getCachedContributions,
  startContributionsRefresh,
  type ContributionsData,
} from '../lib/contributions'

interface ContributorsPanelProps {
  onClose: () => void
}

const formatEuros = (cents: number) =>
  (cents / 100).toLocaleString(undefined, { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 })

// Who has supported the atrium, and what this month has raised.
//
// Opens from the welcome screen alongside Profile Settings. Reads the cache
// first and refreshes behind it, so it opens instantly and works with no
// connection -- a desktop app that can't show a donor list offline would be a
// strange thing, and this is the least important panel in the app to make
// anyone wait for.
export default function ContributorsPanel({ onClose }: ContributorsPanelProps) {
  const [data, setData] = useState<ContributionsData>(() => getCachedContributions())

  useEffect(() => startContributionsRefresh(setData), [])

  const monthly = data.contributors.filter(c => c.isMonthly)
  const oneTime = data.contributors.filter(c => !c.isMonthly)
  const month = data.month

  return (
    <div className="fixed inset-0 bg-nier-black/80 flex items-center justify-center z-[10000200] pointer-events-auto" data-ui-element>
      <div className="bg-nier-blackLight border border-nier-border/40 p-6 max-w-lg w-full mx-4 relative max-h-[85vh] overflow-y-auto">
        <div className="absolute top-0 left-0 w-4 h-4 border-l border-t border-nier-border/60" />
        <div className="absolute top-0 right-0 w-4 h-4 border-r border-t border-nier-border/60" />
        <div className="absolute bottom-0 left-0 w-4 h-4 border-l border-b border-nier-border/60" />
        <div className="absolute bottom-0 right-0 w-4 h-4 border-r border-b border-nier-border/60" />

        <div className="flex items-center gap-3 mb-5">
          <div className="w-1.5 h-1.5 rotate-45 border border-nier-border/60" />
          <h3 className="text-nier-bg tracking-[0.15em] uppercase">Contributors</h3>
        </div>

        <p className="text-nier-bg/80 text-xs tracking-wide mb-5 leading-relaxed">
          The Digital Atrium is made and paid for by one person. Contributions cover the
          database, email and domain it runs on, and the time that goes into it.
        </p>

        {month && <MonthlyGoal month={month} />}

        {data.contributors.length === 0 ? (
          <p className="text-nier-bg/70 text-[10px] tracking-wider uppercase">
            {data.fetchedAt === null
              ? 'Nothing to show yet — this list appears once the app has been online.'
              : 'No contributors listed yet.'}
          </p>
        ) : (
          <div className="space-y-5">
            <NameList title="Monthly" names={monthly} />
            <NameList title="One-off" names={oneTime} />
          </div>
        )}

        <p className="text-nier-bg/70 text-[9px] tracking-wider mt-5 leading-relaxed">
          Names appear here only when someone asked them to, and are checked before
          they show.
        </p>

        <button
          type="button"
          onClick={onClose}
          className="w-full mt-5 py-2 border border-nier-border/30 text-nier-bg/80 text-[10px] tracking-[0.15em] uppercase hover:border-nier-border/60 hover:text-nier-bg transition-colors"
        >
          Close
        </button>
      </div>
    </div>
  )
}

// The bar. Fills toward the month's goal, and keeps filling past it rather than
// stopping at the edge -- passing a goal should look like passing it.
function MonthlyGoal({ month }: { month: NonNullable<ContributionsData['month']> }) {
  const reached = month.goalCents > 0 && month.totalCents >= month.goalCents
  const percent = month.goalCents > 0
    ? Math.min(100, (month.totalCents / month.goalCents) * 100)
    : 0

  return (
    <div className="mb-6">
      <div className="flex items-baseline justify-between mb-2">
        <span className="text-nier-bg/80 text-[9px] tracking-[0.2em] uppercase">This month</span>
        <span className="text-nier-bg text-[10px] tracking-wider">
          {formatEuros(month.totalCents)}
          <span className="text-nier-bg/70"> / {formatEuros(month.goalCents)}</span>
        </span>
      </div>

      <div className="h-2 bg-nier-black border border-nier-border/30 overflow-hidden">
        <div
          className="h-full bg-nier-bg transition-[width] duration-700 ease-out"
          style={{ width: `${percent}%` }}
        />
      </div>

      {reached && (
        <p className="text-nier-bg/80 text-[9px] tracking-wider uppercase mt-2">
          ◇ This month is covered — thank you
        </p>
      )}
    </div>
  )
}

function NameList({ title, names }: { title: string; names: { displayName: string }[] }) {
  if (names.length === 0) return null

  return (
    <div>
      <div className="flex items-center gap-2 mb-2">
        <span className="text-nier-bg/80 text-[9px] tracking-[0.2em] uppercase">{title}</span>
        <div className="flex-1 h-[1px] bg-gradient-to-r from-nier-border/30 to-transparent" />
        <span className="text-nier-bg/70 text-[9px] tracking-wider">{names.length}</span>
      </div>
      <div className="flex flex-wrap gap-x-3 gap-y-1">
        {names.map(person => (
          <span key={person.displayName} className="text-nier-bg text-[11px] tracking-wide">
            {person.displayName}
          </span>
        ))}
      </div>
    </div>
  )
}
