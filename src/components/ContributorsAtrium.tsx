import { useEffect, useMemo, useRef, useState } from 'react'
import { createWheelGestures } from '../lib/canvasGestures'
import { supabase, isDesktop } from '../lib/supabase'
import NameApprovalPanel from './NameApprovalPanel'
import {
  getCachedContributions,
  startContributionsRefresh,
  type ContributionsData,
} from '../lib/contributions'

interface ContributorsAtriumProps {
  onClose: () => void
  onContribute: () => void
  // Arriving back from checkout. Thanks is shown over the wall rather than on a
  // page of its own, so the first thing a new contributor sees is the thing
  // they have just joined.
  thanks?: boolean
}

// Long enough to be read and felt, short enough not to be in the way of the
// page it is covering.
const THANKS_FADE_MS = 900
const THANKS_HOLD_MS = 2600

// The people who paid for this, drawn as an atrium of their own.
//
// A list would have been less work and would have said the same facts. This is
// the same gesture the app is built on -- things placed in a space you move
// through rather than stacked in a column -- turned on the people who keep it
// running. It is the one page here that exists to honour rather than to inform.
//
// Built as ordinary DOM inside a transformed container rather than with Pixi.
// Up to two thousand traces exist, but only what fits on screen is rendered, so
// the document holds dozens at a time -- a canvas renderer would mean
// reimplementing text and hit-testing to draw fewer elements than a settings
// screen.

// What a contribution is drawn in. Bands rather than a gradient, so the legend
// can name them and someone can find their own.
const TIERS = [
  { min: 50, label: '€50 and above', color: '#FF8A3D', glow: 'rgba(255,138,61,0.30)' },
  { min: 25, label: '€25 – €49', color: '#E8C15A', glow: 'rgba(232,193,90,0.26)' },
  { min: 10, label: '€10 – €24', color: '#9AD4C4', glow: 'rgba(154,212,196,0.22)' },
  { min: 5, label: '€5 – €9', color: '#A8B6D9', glow: 'rgba(168,182,217,0.20)' },
  { min: 0, label: '€1 – €4', color: '#CBCBCB', glow: 'rgba(203,203,203,0.16)' },
]

// Monthly support has its own colour rather than a place in the amount scale.
// It isn't a bigger version of a one-off gift, it's a different kind of thing --
// someone who has decided to keep paying - and the wall should be able to say
// that at a glance rather than only through the pulse.
const MONTHLY_TIER = {
  min: 0,
  label: 'Monthly',
  color: '#C77DFF',
  glow: 'rgba(199,125,255,0.28)',
}

const tierFor = (person: { amountEur: number; isMonthly: boolean }) =>
  person.isMonthly
    ? MONTHLY_TIER
    : TIERS.find(tier => person.amountEur >= tier.min) ?? TIERS[TIERS.length - 1]

// Written out in full. "06" is a field in a database; "18 June 2026" is a date
// someone gave money on, and this page is the one place that difference
// matters.
const formatDate = (iso: string) => {
  const date = new Date(iso)
  return Number.isNaN(date.getTime())
    ? ''
    : date.toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' })
}

export default function ContributorsAtrium({ onClose, onContribute, thanks = false }: ContributorsAtriumProps) {
  const [data, setData] = useState<ContributionsData>(() => getCachedContributions())
  useEffect(() => startContributionsRefresh(setData), [])

  // Fades up over the wall, holds, fades away, and leaves the smaller note
  // behind -- the part that answers "so where is my name?".
  const [thanksVisible, setThanksVisible] = useState(false)
  const [thanksDone, setThanksDone] = useState(!thanks)
  useEffect(() => {
    if (!thanks) return
    // Next frame, so the element paints at zero before it starts moving.
    const up = requestAnimationFrame(() => setThanksVisible(true))
    const down = setTimeout(() => setThanksVisible(false), THANKS_FADE_MS + THANKS_HOLD_MS)
    const finish = setTimeout(() => setThanksDone(true), THANKS_FADE_MS * 2 + THANKS_HOLD_MS)
    return () => {
      cancelAnimationFrame(up)
      clearTimeout(down)
      clearTimeout(finish)
    }
  }, [thanks])

  // The operator moderates this page, so their action here is approving the
  // names on it -- not donating to themselves. One button in one place, and
  // which one depends on who is looking.
  //
  // Presentation only: the endpoint behind the panel re-establishes who is
  // asking on every request. Web only, since it needs a signed-in Supabase
  // session and the desktop app has none.
  const [isOperator, setIsOperator] = useState(false)
  const [showNameApproval, setShowNameApproval] = useState(false)
  useEffect(() => {
    if (isDesktop || !supabase) return
    let cancelled = false
    ;(supabase as any)
      .rpc('is_platform_admin')
      .then(({ data: allowed }: { data: boolean | null }) => {
        if (!cancelled) setIsOperator(allowed === true)
      })
      .catch(() => { /* signed out, or not deployed: stay hidden */ })
    return () => { cancelled = true }
  }, [])

  // Where the view is looking. Kept in state rather than a ref because the
  // whole page is one transform -- there is no per-frame animation to protect,
  // and a re-render per drag frame is cheap for a few dozen elements.
  const [offset, setOffset] = useState({ x: 0, y: 0 })
  const [zoom, setZoom] = useState(1)
  const dragRef = useRef<{ x: number; y: number; startX: number; startY: number } | null>(null)
  const [dragging, setDragging] = useState(false)
  const [legendOpen, setLegendOpen] = useState(true)

  // The same reading an atrium uses -- shared, so a mouse zooms, two fingers
  // pan and a pinch zooms here exactly as they do on the canvas.
  const gestures = useMemo(() => createWheelGestures(), [])

  // Refs as well as state: the wheel listener is attached once and would
  // otherwise close over the values from the render that attached it.
  const offsetRef = useRef(offset)
  const zoomRef = useRef(zoom)
  useEffect(() => { offsetRef.current = offset }, [offset])
  useEffect(() => { zoomRef.current = zoom }, [zoom])

  useEffect(() => {
    const onWheel = (event: WheelEvent) => {
      // Non-passive, so the page itself never scrolls underneath and a pinch
      // doesn't reach the browser's own zoom.
      event.preventDefault()

      if (gestures.classify(event) === 'pan') {
        // Screen-space, so two fingers moving an inch move the view an inch
        // whatever the zoom -- the same rule the atrium pans by.
        setOffset(current => ({ x: current.x - event.deltaX, y: current.y - event.deltaY }))
        return
      }

      const nextZoom = Math.max(0.25, Math.min(2.5, zoomRef.current * (1 + gestures.zoomDelta(event))))

      // Zoom toward the cursor rather than the centre: the thing under the
      // pointer is the thing being looked at, and it should stay put.
      const pointer = {
        x: event.clientX - window.innerWidth / 2,
        y: event.clientY - window.innerHeight / 2,
      }
      const world = {
        x: (pointer.x - offsetRef.current.x) / zoomRef.current,
        y: (pointer.y - offsetRef.current.y) / zoomRef.current,
      }
      setOffset({ x: pointer.x - world.x * nextZoom, y: pointer.y - world.y * nextZoom })
      setZoom(nextZoom)
    }

    window.addEventListener('wheel', onWheel, { passive: false })
    return () => window.removeEventListener('wheel', onWheel)
  }, [gestures])

  // Keyboard zoom, matching the atrium's: +/- to step, 0 to reset.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === '+' || event.key === '=') {
        event.preventDefault()
        setZoom(current => Math.min(2.5, current * 1.12))
      } else if (event.key === '-' || event.key === '_') {
        event.preventDefault()
        setZoom(current => Math.max(0.25, current / 1.12))
      } else if (event.key === '0') {
        event.preventDefault()
        setZoom(1)
        setOffset({ x: 0, y: 0 })
      } else if (event.key === 'Escape') {
        onClose()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  // Placed on a phyllotaxis spiral, sorted by what each person has given.
  //
  // The bin-packer used elsewhere sorts by area, which would have ordered this
  // wall by how long someone's name is. Here position means one thing: the
  // largest contributions sit at the centre and it opens outward from there.
  //
  // The spiral is the arrangement seeds take on a sunflower head -- radius
  // growing as the square root of the index, each step turned by the golden
  // angle. It fills space evenly with no clustering and no gaps, needs no
  // collision checks, and is O(n), which is what makes two thousand of them
  // viable at all.
  const placed = useMemo(() => {
    const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5))
    const SPACING = 132

    return [...data.contributors]
      .sort((a, b) => b.amountEur - a.amountEur || b.since.localeCompare(a.since))
      .map((person, index) => {
        const radius = SPACING * Math.sqrt(index)
        const angle = index * GOLDEN_ANGLE
        return {
          person,
          x: Math.cos(angle) * radius,
          y: Math.sin(angle) * radius * 0.72, // flattened: screens are wider than they are tall
          width: Math.max(150, Math.min(300, 84 + person.displayName.length * 10)),
        }
      })
  }, [data.contributors])

  // Only what can be seen is rendered. Two thousand absolutely positioned
  // elements is a lot to keep in a document, and all but a few dozen are off
  // screen at any moment -- this is the difference between a page that pans
  // smoothly and one that stutters on a laptop.
  const [viewport, setViewport] = useState({ width: window.innerWidth, height: window.innerHeight })
  useEffect(() => {
    const onResize = () => setViewport({ width: window.innerWidth, height: window.innerHeight })
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  const visible = useMemo(() => {
    const margin = 240
    const halfWidth = viewport.width / 2 + margin
    const halfHeight = viewport.height / 2 + margin
    return placed.filter(({ x, y }) =>
      Math.abs(x * zoom + offset.x) < halfWidth && Math.abs(y * zoom + offset.y) < halfHeight)
  }, [placed, offset, viewport, zoom])

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
          backgroundSize: `${80 * zoom}px ${80 * zoom}px`,
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
          style={{ transform: `translate(${offset.x}px, ${offset.y}px) scale(${zoom})`, transformOrigin: '0 0' }}
        >
          {visible.map(({ person, x, y, width }, index) => {
            const tier = tierFor(person)
            return (
              <div
                key={`${person.displayName}-${index}`}
                className="absolute px-4 py-3"
                style={{
                  left: x,
                  top: y,
                  width,
                  transform: 'translate(-50%, -50%)',
                  border: `1px solid ${tier.color}`,
                  boxShadow: `0 0 24px ${tier.glow}`,
                  background: 'rgba(25,25,25,0.72)',
                  // Ongoing support is still happening; a slow breath says that
                  // where a label would only state it. Staggered so the wall
                  // shimmers rather than pulsing in unison.
                  animation: person.isMonthly ? `contributor-breath 3.6s ease-in-out ${(index % 7) * 0.4}s infinite` : undefined,
                }}
              >
                <div className="text-[13px] tracking-wide truncate" style={{ color: tier.color }}>
                  {person.displayName}
                </div>
                <div className="flex items-baseline justify-between mt-1 gap-2">
                  <span className="text-[10px] tracking-wider whitespace-nowrap" style={{ color: tier.color, opacity: 0.85 }}>
                    {person.isMonthly && person.monthlyEur
                      ? `€${person.monthlyEur} / month`
                      : `€${person.amountEur}`}
                  </span>
                  <span className="text-[9px] tracking-wider uppercase text-nier-bg/70 whitespace-nowrap">
                    {person.isMonthly ? `since ${formatDate(person.since)}` : formatDate(person.since)}
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
          Everyone who keeps this running. Drag to move, scroll or pinch to zoom.
        </p>
      </div>

      <button
        type="button"
        onClick={onClose}
        className="absolute top-6 right-6 px-4 py-2 border border-nier-border/40 text-nier-bg/80 text-[10px] tracking-[0.15em] uppercase hover:border-nier-border/60 hover:text-nier-bg transition-colors"
      >
        ← Back
      </button>

      {/* Bottom left, where an atrium keeps its controls.

          Every rank is listed, not only the ones currently on the wall. The
          legend answers "what would mine look like?" as much as "what am I
          seeing?", and hiding the ranks nobody has reached yet hides exactly
          the ones worth knowing about.

          Collapsible because it is reference, not commentary: useful once,
          then in the way of the space it sits over. */}
      <div className="absolute bottom-6 left-6">
        <button
          type="button"
          onClick={() => setLegendOpen(open => !open)}
          className="flex items-center gap-2 text-nier-bg/70 hover:text-nier-bg text-[9px] tracking-[0.2em] uppercase transition-colors"
        >
          <span
            className="inline-block transition-transform duration-200"
            style={{ transform: legendOpen ? 'rotate(45deg)' : 'rotate(0deg)' }}
          >
            ◇
          </span>
          Donation ranks
        </button>

        {legendOpen && (
          <div className="mt-2 space-y-1">
            {TIERS.map(tier => (
              <div key={tier.label} className="flex items-center gap-2">
                <span className="w-3 h-[1px]" style={{ background: tier.color }} />
                <span className="text-[9px] tracking-wider" style={{ color: tier.color }}>{tier.label}</span>
              </div>
            ))}
            <div className="flex items-center gap-2 pt-1">
              <span
                className="w-3 h-[1px]"
                style={{ background: MONTHLY_TIER.color, animation: 'contributor-breath 3.6s ease-in-out infinite' }}
              />
              <span className="text-[9px] tracking-wider" style={{ color: MONTHLY_TIER.color }}>
                {MONTHLY_TIER.label}
              </span>
            </div>
          </div>
        )}
      </div>

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

      {/* Bottom right, where an atrium keeps Leave a Trace: the one action this
          page offers.
          
          White rather than the top tier's orange. The traces are the colourful
          thing here and the button should not compete with the people it is
          about -- white on black is loud enough in a room this dark. The orange
          belongs on the landing page, where it has a whole section to carry.
          
          An operator gets the moderation button in the same place instead.
          Approving names is their action on this page; donating to themselves
          is not, and showing both would make the important one harder to
          find. */}
      <button
        type="button"
        onClick={isOperator ? () => setShowNameApproval(true) : onContribute}
        className="absolute bottom-6 right-6 px-7 py-4 bg-nier-bg text-nier-black text-[11px] tracking-[0.2em] uppercase transition-transform hover:scale-[1.04] active:scale-[0.99]"
        style={{ boxShadow: '0 0 28px rgba(203,203,203,0.22), 0 0 64px rgba(203,203,203,0.12)' }}
      >
        <span className="absolute top-0 left-0 w-3 h-3 border-l border-t border-nier-black/40" />
        <span className="absolute top-0 right-0 w-3 h-3 border-r border-t border-nier-black/40" />
        <span className="absolute bottom-0 left-0 w-3 h-3 border-l border-b border-nier-black/40" />
        <span className="absolute bottom-0 right-0 w-3 h-3 border-r border-b border-nier-black/40" />
        {isOperator ? '◇ Contributor Names' : '◇ Donate'}
      </button>

      {/* The thanks itself: large, centred, over everything, and gone on its
          own. Nothing to dismiss -- a contributor should not have to close a
          message thanking them. */}
      {thanks && !thanksDone && (
        <div
          className="absolute inset-0 flex items-center justify-center pointer-events-none"
          style={{
            opacity: thanksVisible ? 1 : 0,
            transition: `opacity ${THANKS_FADE_MS}ms ease-in-out`,
            background: 'radial-gradient(ellipse 60% 50% at 50% 50%, rgba(25,25,25,0.92), rgba(25,25,25,0.55) 70%, transparent)',
          }}
        >
          <div className="text-center px-6">
            <div className="flex items-center justify-center gap-5 mb-5">
              <div className="w-16 h-[1px] bg-gradient-to-r from-transparent to-nier-border/60" />
              <div className="w-2 h-2 rotate-45 border border-nier-border/70" />
              <div className="w-16 h-[1px] bg-gradient-to-l from-transparent to-nier-border/60" />
            </div>
            <h2 className="text-nier-bg text-[clamp(2rem,7vw,4.5rem)] font-extralight tracking-[0.3em] uppercase">
              Thank you
            </h2>
          </div>
        </div>
      )}

      {/* Stays after the thanks has gone, because it answers a question the
          contributor is about to have: their name is not on the wall yet. */}
      {thanks && (
        <div
          className="absolute top-1/2 left-1/2 -translate-x-1/2 translate-y-[3.5rem] max-w-md px-6 text-center pointer-events-none"
          style={{
            opacity: thanksDone ? 1 : 0,
            transition: `opacity ${THANKS_FADE_MS}ms ease-in-out`,
          }}
        >
          <p className="text-nier-bg/80 text-xs tracking-wide leading-relaxed">
            If you chose a name, it appears here beside the others once it has been
            checked. Stripe has emailed you a receipt.
          </p>
        </div>
      )}

      {showNameApproval && <NameApprovalPanel onClose={() => setShowNameApproval(false)} />}
    </div>
  )
}
