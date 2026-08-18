import { useEffect, useState } from 'react'
import PortalLoop from './PortalLoop'
import { refreshContributions, getCachedContributions, type ContributionsData } from '../lib/contributions'

interface ContributedScreenProps {
  onContinue: () => void
}

// Where Stripe sends someone back to after paying.
//
// Deliberately says thank you and nothing else -- no receipt, no amount, no
// confirmation of what was charged. Stripe emails all of that, and it knows,
// whereas this page only knows that a browser arrived at a URL. Repeating
// figures it hasn't verified would be inventing them.
//
// It refreshes the totals rather than reading the cache, because the one moment
// a contributor genuinely wants to see the bar move is this one.
export default function ContributedScreen({ onContinue }: ContributedScreenProps) {
  const [data, setData] = useState<ContributionsData>(() => getCachedContributions())

  useEffect(() => {
    // Delayed methods settle later, so the bar may not have moved yet. That's
    // fine: nothing here claims it has.
    refreshContributions().then(fresh => { if (fresh) setData(fresh) })
  }, [])

  const month = data.month

  return (
    <div className="fixed inset-0 bg-nier-black flex items-center justify-center font-mono px-4 overflow-hidden">
      <div className="w-full max-w-md flex flex-col items-center text-center">
        <PortalLoop className="mx-auto h-[clamp(5rem,20vh,11rem)]" playbackRate={0.6} />

        <div className="flex items-center gap-4 mt-2 mb-6">
          <div className="w-10 h-[1px] bg-gradient-to-r from-transparent to-nier-border/50" />
          <span className="text-nier-bg text-[11px] tracking-[0.4em] uppercase">Thank you</span>
          <div className="w-10 h-[1px] bg-gradient-to-l from-transparent to-nier-border/50" />
        </div>

        <p className="text-nier-bg/80 text-xs tracking-wide leading-relaxed mb-2">
          Your contribution keeps the atrium running and the work going. Stripe has
          emailed you a receipt.
        </p>

        <p className="text-nier-bg/70 text-[10px] tracking-wide leading-relaxed mb-6">
          If you asked to be listed, your name appears on the contributors page once
          it has been checked.
        </p>

        {month && month.goalCents > 0 && (
          <div className="w-full mb-8">
            <div className="flex items-baseline justify-between mb-1">
              <span className="text-[9px] text-nier-bg/70 tracking-[0.2em] uppercase">This month</span>
              <span className="text-[9px] text-nier-bg/70 tracking-wider">
                {Math.round(month.totalCents / 100)} / {Math.round(month.goalCents / 100)} €
              </span>
            </div>
            <div className="h-[3px] bg-nier-black border border-nier-border/30 overflow-hidden">
              <div
                className="h-full bg-nier-bg/80 transition-all duration-700 ease-out"
                style={{ width: `${Math.min(100, (month.totalCents / month.goalCents) * 100)}%` }}
              />
            </div>
          </div>
        )}

        <button
          type="button"
          onClick={onContinue}
          className="w-full py-3 border border-nier-border/60 text-nier-bg text-xs tracking-[0.2em] uppercase transition-all hover:bg-nier-bg hover:text-nier-black hover:border-nier-bg"
        >
          Back to the Atrium
        </button>
      </div>
    </div>
  )
}
