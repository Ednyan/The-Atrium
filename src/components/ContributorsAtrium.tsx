import { useEffect, useMemo, useRef, useState } from 'react'
import { packBoxesAroundCenter } from '../lib/binPack'
import {
  getCachedContributions,
  startContributionsRefresh,
  type Contributor,
  type ContributionsData,
} from '../lib/contributions'

interface ContributorsAtriumProps {
  onClose: () => void
  onContribute: () => void
}

// The people who paid for this, drawn as an atrium of their own.
//
// A list would have been less work and would have said the same facts. This is
// the same gesture the app is built on -- things placed in a space you move
// through rather than stacked in a column -- turned on the people who keep it
// running. It is the one page here that exists to honour rather than to inform.
//
// Built as ordinary DOM inside a transformed container rather than with Pixi:
// there are tens of contributions, not thousands, and a canvas renderer would
// mean reimplementing text, selection and hit-testing for no gain.

// What a contribution is drawn in. Bands rather than a gradient, so the legend
// can name them and someone can find their own.
const TIERS = [
  { min: 50, label: '50+', color: '#FF8A3D', glow: 'rgba(255,138,61,0.30)' },
  { min: 25, label: '25 – 49', color: '#E8C15A', glow: 'rgba(232,193,90,0.26)' },
  { min: 10, label: '10 – 24', color: '#9AD4C4', glow: 'rgba(154,212,196,0.22)' },
  { min: 5, label: '5 – 9', color: '#A8B6D9', glow: 'rgba(168,182,217,0.20)' },
  { min: 0, label: '1 – 4', color: '#CBCBCB', glow: 'rgba(203,203,203,0.16)' },
]

const tierFor = (amount: number) => TIERS.find(tier => amount >= tier.min) ?? TIERS[TIERS.length - 1]

const formatDate = (iso: string) => {
  const date = new Date(iso)
  return Number.isNaN(date.getTime())
    ? ''
    : date.toLocaleDateString(undefined, { month: 'short', year: 'numeric' })
}

export default function ContributorsAtrium({ onClose, onContribute }: ContributorsAtriumProps) {
  const [data, setData] = useState<ContributionsData>(() => getCachedContributions())
  useEffect(() => startContributionsRefresh(setData), [])

  // Where the view is looking. Kept in state rather than a ref because the
  // whole page is one transform -- there is no per-frame animation to protect,
  // and a re-render per drag frame is cheap for a few dozen elements.
  const [offset, setOffset] = useState({ x: 0, y: 0 })
  const dragRef = useRef<{ x: number; y: number; startX: number; startY: number } | null>(null)
  const [dragging, setDragging] = useState(false)

  // Laid out with the same packer the atrium uses for a multi-file drop, so
  // this reads as the same kind of space rather than a grid pretending to be
  // one. Recomputed only when the contributions change, never while panning.
  const placed = useMemo(() => {
    const contributors = data.contributors
    if (contributors.length === 0) return [] as { person: Contributor; x: number; y: number; width: number }[]

    const boxes = contributors.map(person => ({
      // Wider for longer names, taller never: these are one-line traces.
      width: Math.max(150, Math.min(320, 78 + person.displayName.length * 11)),
      height: 74,
    }))
    const offsets = packBoxesAroundCenter(boxes, 46, 'circle')

    return contributors.map((person, index) => ({
      person,
      x: offsets[index].x,
      y: offsets[index].y,
      width: boxes[index].width,
    }))
  }, [data.contributors])

  const onPointerDown = (event: React.PointerEvent) => {
    if ((event.target as HTMLElement).closest('button')) return
    dragRef.current = { x: offset.x, y: offset.y, startX: event.clientX, startY: event.clientY }
    setDragging(true)
    ;(event.currentTarget as HTMLElement).setPointerCapture(event.pointerId)
  }

  const onPointerMove = (event: React.PointerEvent) => {
    const drag = dragRef.current
    if (!drag) return
    setOffset({
      x: drag.x + (event.clientX - drag.startX),
      y: drag.y + (event.clientY - drag.startY),
    })
  }

  const endDrag = () => {
    dragRef.current = null
    setDragging(false)
  }

  const month = data.month
  const usedTiers = TIERS.filter(tier => placed.some(({ person }) => tierFor(person.amountEur) === tier))

  return (
    <div className="fixed inset-0 bg-nier-black overflow-hidden font-mono select-none" data-ui-element>
      {/* Scanlines and grid, so this reads as the same material as an atrium. */}
      <div
        className="absolute inset-0 pointer-events-none opacity-[0.04]"
        style={{
          backgroundImage:
            'repeating-linear-gradient(0deg, transparent, transparent 2px, rgba(203,203,203,0.14) 2px, rgba(203,203,203,0.14) 4px)',
        }}
      />
      <div
        className="absolute inset-0 pointer-events-none opacity-[0.05]"
        style={{
          backgroundImage:
            'linear-gradient(rgba(203,203,203,0.5) 1px, transparent 1px), linear-gradient(90deg, rgba(203,203,203,0.5) 1px, transparent 1px)',
          backgroundSize: '80px 80px',
          backgroundPosition: `${offset.x}px ${offset.y}px`,
        }}
      />

      {/* The space itself */}
      <div
        className={dragging ? 'absolute inset-0 cursor-grabbing' : 'absolute inset-0 cursor-grab'}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
      >
        <div
          className="absolute left-1/2 top-1/2"
          style={{ transform: `translate(${offset.x}px, ${offset.y}px)` }}
        >
          {placed.map(({ person, x, y, width }, index) => {
            const tier = tierFor(person.amountEur)
            return (
              <div
                key={`${person.displayName}-${person.contributedAt}-${index}`}
                className="absolute px-4 py-3"
                style={{
                  left: x,
                  top: y,
                  width,
                  transform: 'translate(-50%, -50%)',
                  border: `1px solid ${tier.color}`,
                  boxShadow: `0 0 24px ${tier.glow}`,
                  background: 'rgba(25,25,25,0.72)',
                }}
              >
                <div className="text-[13px] tracking-wide truncate" style={{ color: tier.color }}>
                  {person.displayName}
                </div>
                <div className="flex items-baseline justify-between mt-1">
                  <span className="text-[10px] tracking-wider" style={{ color: tier.color, opacity: 0.85 }}>
                    €{person.amountEur}{person.isMonthly ? ' / month' : ''}
                  </span>
                  <span className="text-[9px] tracking-wider uppercase text-nier-bg/70">
                    {formatDate(person.contributedAt)}
                  </span>
                </div>
              </div>
            )
          })}

          {placed.length === 0 && (
            <div className="absolute -translate-x-1/2 -translate-y-1/2 text-center w-[320px]">
              <p className="text-nier-bg/80 text-xs tracking-wide leading-relaxed">
                {data.fetchedAt === null
                  ? 'This atrium fills once the app has been online.'
                  : 'Nobody here yet. The first name on this wall could be yours.'}
              </p>
            </div>
          )}
        </div>
      </div>

      {/* Title, top left, out of the way of the space */}
      <div className="absolute top-6 left-6 pointer-events-none">
        <div className="flex items-center gap-3">
          <div className="w-1.5 h-1.5 rotate-45 border border-nier-border/60" />
          <h1 className="text-nier-bg text-sm tracking-[0.25em] uppercase">Contributors</h1>
        </div>
        <p className="text-nier-bg/70 text-[10px] tracking-wide mt-2 max-w-xs leading-relaxed">
          Everyone who keeps this running. Drag to move through the space.
        </p>
      </div>

      <button
        type="button"
        onClick={onClose}
        className="absolute top-6 right-6 px-4 py-2 border border-nier-border/40 text-nier-bg/80 text-[10px] tracking-[0.15em] uppercase hover:border-nier-border/60 hover:text-nier-bg transition-colors"
      >
        ← Back
      </button>

      {/* Legend, bottom left, where an atrium keeps its controls */}
      {usedTiers.length > 0 && (
        <div className="absolute bottom-6 left-6 pointer-events-none">
          <div className="text-nier-bg/70 text-[9px] tracking-[0.2em] uppercase mb-2">Contribution</div>
          <div className="space-y-1">
            {usedTiers.map(tier => (
              <div key={tier.label} className="flex items-center gap-2">
                <span className="w-3 h-[1px]" style={{ background: tier.color }} />
                <span className="text-[9px] tracking-wider" style={{ color: tier.color }}>€{tier.label}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* The month, bottom centre, where an atrium shows its usage */}
      {month && month.goalCents > 0 && (
        <div className="absolute bottom-6 left-1/2 -translate-x-1/2 w-[min(420px,60vw)] pointer-events-none">
          <div className="flex items-baseline justify-between mb-1">
            <span className="text-[9px] text-nier-bg/70 tracking-[0.2em] uppercase">This month</span>
            <span className="text-[9px] text-nier-bg/80 tracking-wider">
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

      {/* Contribute, bottom right, where an atrium keeps Leave a Trace */}
      <button
        type="button"
        onClick={onContribute}
        className="absolute bottom-6 right-6 px-5 py-3 bg-nier-bg text-nier-black text-[10px] tracking-[0.15em] uppercase hover:bg-nier-bgDark transition-colors"
      >
        ◇ Contribute
      </button>
    </div>
  )
}
