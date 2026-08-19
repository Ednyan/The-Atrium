import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createWheelGestures } from '../lib/canvasGestures'
import { supabase, isDesktop } from '../lib/supabase'
import NameApprovalPanel from './NameApprovalPanel'
import {
  getCachedContributions,
  startContributionsRefresh,
  type ContributionsData,
} from '../lib/contributions'
import {
  getSeededContributors,
  seededCount,
  seededMonthCents,
} from '../lib/seedContributors'

interface ContributorsAtriumProps {
  onClose: () => void
  onContribute: () => void
  // Arriving back from checkout. Thanks is shown over the wall rather than on a
  // page of its own, so the first thing a new contributor sees is the thing
  // they have just joined.
  thanks?: boolean
}

// Slow enough to feel like an arrival rather than a notification.
const THANKS_FADE_MS = 900

// The hint to dismiss comes in a moment after the thanks has settled. Offering
// someone the exit in the same breath as the thank-you rather undercuts it.
const HINT_DELAY_MS = 1800

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

// The travelling light. Brighter than the border it runs over, or it would be
// invisible against it -- the same purple, lit.
const RUNNER_COLOR = '#EBC8FF'

// The rank someone has reached, by everything they have given.
//
// The total rather than the one-off part of it, because position on this page
// is decided by the total -- a trace coloured for one rank while sitting in
// another would read as a mistake rather than as information.
const rankFor = (person: { amountEur: number }) =>
  TIERS.find(tier => person.amountEur >= tier.min) ?? TIERS[TIERS.length - 1]

// How a trace is drawn, which depends on which of the three kinds of
// contributor it is.
//
// Someone who subscribes *and* has given one-off is not a monthly supporter
// with a footnote: purple alone would erase the rank they reached by giving,
// and their rank alone would hide that they are still giving. So the border
// carries both -- their rank on one side, purple on the other -- while the
// breath and the rate line stay purple, and the name keeps the rank's colour.
function drawFor(person: { amountEur: number; isMonthly: boolean; hasOneTime: boolean }) {
  const rank = rankFor(person)
  const both = person.isMonthly && person.hasOneTime

  if (both) {
    return {
      nameColor: rank.color,
      metaColor: MONTHLY_TIER.color,
      glow: MONTHLY_TIER.glow,
      // A gradient border needs border-image; border-color takes one colour and
      // that is the whole problem here.
      borderImage: `linear-gradient(135deg, ${rank.color} 0%, ${rank.color} 35%, ${MONTHLY_TIER.color} 100%) 1`,
      borderColor: undefined as string | undefined,
    }
  }

  const tier = person.isMonthly ? MONTHLY_TIER : rank
  return {
    nameColor: tier.color,
    metaColor: tier.color,
    glow: tier.glow,
    borderImage: undefined as string | undefined,
    borderColor: tier.color,
  }
}

// Written out in full. "06" is a field in a database; "18 June 2026" is a date
// someone gave money on, and this page is the one place that difference
// matters.
const formatDate = (iso: string) => {
  const date = new Date(iso)
  return Number.isNaN(date.getTime())
    ? ''
    : date.toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' })
}

// Case and accents folded, so searching is about the name rather than about
// reproducing it exactly.
const normalise = (value: string) =>
  value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim()

export default function ContributorsAtrium({ onClose, onContribute, thanks = false }: ContributorsAtriumProps) {
  const [data, setData] = useState<ContributionsData>(() => getCachedContributions())
  useEffect(() => startContributionsRefresh(setData), [])

  // Fades up over the wall and stays there. It used to time itself out, which
  // meant reading speed decided whether a contributor got the message -- and
  // the one sentence that actually answers "so where is my name?" could be gone
  // before it was looked at. It leaves when the person is done with it.
  const [thanksVisible, setThanksVisible] = useState(false)
  const [thanksGone, setThanksGone] = useState(!thanks)
  const [hintVisible, setHintVisible] = useState(false)
  const dismissTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (!thanks) return
    // Next frame, so the element paints at zero before it starts moving.
    const up = requestAnimationFrame(() => setThanksVisible(true))
    const hint = setTimeout(() => setHintVisible(true), THANKS_FADE_MS + HINT_DELAY_MS)
    return () => {
      cancelAnimationFrame(up)
      clearTimeout(hint)
      if (dismissTimer.current) clearTimeout(dismissTimer.current)
    }
  }, [thanks])

  // Anywhere at all: the whole overlay is the target, so there is nothing to
  // aim at and no close button competing with the words.
  const dismissThanks = useCallback(() => {
    if (!thanks || thanksGone) return
    setThanksVisible(false)
    setHintVisible(false)
    if (dismissTimer.current) clearTimeout(dismissTimer.current)
    // Unmounted only once it has finished fading, so the wall underneath
    // becomes draggable at the moment the message stops being visible.
    dismissTimer.current = setTimeout(() => setThanksGone(true), THANKS_FADE_MS)
  }, [thanks, thanksGone])

  // The operator moderates this page, so their action here is approving the
  // names on it -- not donating to themselves. One button in one place, and
  // which one depends on who is looking.
  //
  // Presentation only: the endpoint behind the panel re-establishes who is
  // asking on every request. Web only, since it needs a signed-in Supabase
  // session and the desktop app has none.
  const [isOperator, setIsOperator] = useState(false)
  const [showNameApproval, setShowNameApproval] = useState(false)

  // Fake contributors, for seeing what this looks like with a crowd on it.
  // Local to this browser and switched on from the operator's own panel -- the
  // public wall never sees them (lib/seedContributors explains why they are not
  // rows in the database). Held in state so the two components stay in step.
  const [seeded, setSeeded] = useState(getSeededContributors)
  const refreshSeeded = () => setSeeded(getSeededContributors())
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

  // Finding yourself, on a wall that can hold two thousand people.
  //
  // Scrolling until your own name happens to pass under the cursor is not
  // finding it. Matching dims everything else and moves the view onto the hit,
  // which is the only way this scales past a screenful.
  const [query, setQuery] = useState('')
  const [matchIndex, setMatchIndex] = useState(0)

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
      // '+', '-' and '0' are zoom shortcuts on this page and characters in a
      // search box. While the box has focus it wins -- otherwise typing a name
      // with a digit in it zooms the page around.
      if ((event.target as HTMLElement)?.tagName === 'INPUT') return

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
        // While the thanks is up, Escape means "clear this", not "leave the
        // page I have just been sent to".
        if (!thanksGone) dismissThanks()
        else onClose()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose, dismissThanks, thanksGone])

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
    // Widened from 132 after the dual-contributor line ("+ €113 given") made
    // boxes wider: simulating three hundred traces with real text metrics put
    // 2-12% of them touching a neighbour at the old spacing, and under 1% here.
    // The wall is a quarter larger for it, which the search box pays for.
    const SPACING = 170

    // Seeded people are sorted in among the real ones rather than appended, so
    // the arrangement being judged is the arrangement that would happen.
    return [...data.contributors, ...seeded]
      .sort((a, b) => b.amountEur - a.amountEur || b.since.localeCompare(a.since))
      .map((person, index) => {
        const radius = SPACING * Math.sqrt(index)
        const angle = index * GOLDEN_ANGLE
        return {
          person,
          x: Math.cos(angle) * radius,
          y: Math.sin(angle) * radius * 0.72, // flattened: screens are wider than they are tall
        }
      })
  }, [data.contributors, seeded])

  // Accents folded and case ignored: someone typing "ines" should find "Inês",
  // and a person who put an accent in their name should not have to remember
  // exactly where. Substring rather than prefix, because people search for the
  // part of their name they think is distinctive.
  const matches = useMemo(() => {
    const needle = normalise(query)
    if (!needle) return []
    return placed.filter(item => normalise(item.person.displayName).includes(needle))
  }, [placed, query])

  // Names rather than indices, so the dimming survives the culling that decides
  // what is in the document at any moment.
  const matchedNames = useMemo(
    () => new Set(matches.map(item => normalise(item.person.displayName))),
    [matches],
  )

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

  // Puts a trace in the middle of the screen at the current zoom. The page is
  // one transform, so this is just the inverse of it.
  const focusOn = (index: number) => {
    const target = matches[index]
    if (!target) return
    setOffset({ x: -target.x * zoom, y: -target.y * zoom })
  }

  // A new search jumps to the best hit; Enter walks through the rest. Both live
  // here rather than in the input so the counter and the view can't disagree.
  useEffect(() => {
    setMatchIndex(0)
    if (matches.length > 0) {
      const first = matches[0]
      setOffset({ x: -first.x * zoom, y: -first.y * zoom })
    }
    // Deliberately not depending on zoom: re-centring every time someone zooms
    // would fight them for control of the view.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [matches])

  const nextMatch = () => {
    if (matches.length === 0) return
    const next = (matchIndex + 1) % matches.length
    setMatchIndex(next)
    focusOn(next)
  }

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

  // The goal bar counts the seeded month too, otherwise the one part of this
  // page that changes shape with the numbers is the one part a preview cannot
  // exercise. Synthesised when nothing has ever been fetched, so the bar can
  // still be looked at on a machine that has never been online.
  const seededCents = useMemo(() => seededMonthCents(seeded), [seeded])
  const month = useMemo(() => {
    if (!seededCents) return data.month
    const base = data.month ?? { totalCents: 0, goalCents: 5000, contributionCount: 0 }
    return {
      ...base,
      totalCents: base.totalCents + seededCents,
      contributionCount: base.contributionCount + seeded.length,
    }
  }, [data.month, seeded, seededCents])

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
          {visible.map(({ person, x, y }, index) => {
            const draw = drawFor(person)
            const dimmed = query.trim().length > 0 && !matchedNames.has(normalise(person.displayName))
            return (
              <div
                key={`${person.displayName}-${index}`}
                className="absolute px-4 py-3"
                style={{
                  left: x,
                  top: y,
                  // Sized by its contents rather than guessed from the length of
                  // the name. The guess only measured the name, so a long date
                  // underneath -- "19 de agosto de 2026", in whatever language
                  // the reader's machine speaks -- ran straight out of the box.
                  // The cap is where a name starts truncating, as before; the
                  // line beneath always fits inside it.
                  width: 'max-content',
                  maxWidth: 300,
                  transform: 'translate(-50%, -50%)',
                  opacity: dimmed ? 0.12 : 1,
                  transition: 'opacity 220ms ease-out',
                  border: '1px solid',
                  borderColor: draw.borderColor,
                  borderImage: draw.borderImage,
                  boxShadow: `0 0 24px ${draw.glow}`,
                  background: 'rgba(25,25,25,0.72)',
                  // The monthly animation lives on the border now (below),
                  // not on the box's opacity.
                }}
              >
                {/* Ongoing support, drawn as something still going: a light
                    running the perimeter, the way the snake moves.

                    Stopped while dimmed by a search. Movement is attention, and
                    a non-match is the one thing on the page that should not be
                    asking for any. Staggered so the wall has a current running
                    through it rather than everything moving in lockstep. */}
                {person.isMonthly && !dimmed && (
                  <svg
                    className="absolute inset-0 w-full h-full pointer-events-none"
                    style={{ overflow: 'visible' }}
                    aria-hidden="true"
                  >
                    <rect
                      x="0"
                      y="0"
                      width="100%"
                      height="100%"
                      fill="none"
                      stroke={RUNNER_COLOR}
                      strokeWidth="2"
                      strokeLinecap="round"
                      pathLength={100}
                      strokeDasharray="14 86"
                      style={{
                        animation: `contributor-run 3.6s linear ${(index % 7) * 0.45}s infinite`,
                        filter: `drop-shadow(0 0 4px ${MONTHLY_TIER.color})`,
                      }}
                    />
                  </svg>
                )}

                <div className="text-[13px] tracking-wide truncate" style={{ color: draw.nameColor }}>
                  {person.displayName}
                </div>
                {/* Labelled, always. An unmarked fake is how a screenshot ends
                    up somewhere it shouldn't. */}
                {person.isSeed && (
                  <div className="text-[8px] tracking-[0.2em] uppercase mt-1" style={{ color: '#FF6161' }}>
                    False donation
                  </div>
                )}
                <div className="flex flex-wrap items-baseline justify-between mt-1 gap-x-2">
                  <span className="text-[10px] tracking-wider whitespace-nowrap" style={{ color: draw.metaColor, opacity: 0.85 }}>
                    {person.isMonthly && person.monthlyEur
                      ? `€${person.monthlyEur} / month`
                      : `€${person.amountEur}`}
                    {/* The total, for someone whose trace otherwise shows only
                        a rate. Without it their one-off giving is in the sum
                        that placed them here and nowhere on the trace. */}
                    {person.isMonthly && person.hasOneTime && ` + €${person.amountEur} given`}
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

      {/* Search, top centre, above the wall it filters */}
      <div className="absolute top-6 left-1/2 -translate-x-1/2 w-[min(360px,70vw)]">
        <div className="relative">
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-nier-bg/70 text-[11px] pointer-events-none">
            ⌕
          </span>
          <input
            type="text"
            value={query}
            onChange={event => setQuery(event.target.value)}
            onKeyDown={event => {
              if (event.key === 'Enter') { event.preventDefault(); nextMatch() }
              if (event.key === 'Escape') { event.preventDefault(); setQuery('') }
            }}
            placeholder="Find a name"
            className="w-full pl-8 pr-4 py-2 bg-nier-black/80 border border-nier-border/30 text-nier-bg text-xs tracking-wide placeholder-nier-bg/50 focus:border-nier-border/60 focus:outline-none transition-colors"
          />
        </div>

        {query.trim().length > 0 && (
          <p className="text-center text-[9px] tracking-[0.15em] uppercase mt-2 text-nier-bg/70">
            {matches.length === 0
              ? 'Nobody here by that name'
              : matches.length === 1
                ? 'One match'
                : `${matchIndex + 1} of ${matches.length} — Enter for the next`}
          </p>
        )}
      </div>

      {/* Impossible to forget about. The count is the giveaway that the wall
          being looked at is not the wall anyone else sees. */}
      {seeded.length > 0 && (
        <div
          className="absolute top-[4.75rem] left-1/2 -translate-x-1/2 px-4 py-2 border pointer-events-none"
          style={{ borderColor: 'rgba(255,97,97,0.5)', background: 'rgba(255,97,97,0.08)' }}
        >
          <span className="text-[9px] tracking-[0.2em] uppercase" style={{ color: '#FF6161' }}>
            Preview — {seeded.length} false donations, visible only to you
          </span>
        </div>
      )}

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
                className="w-3 h-[2px]"
                style={{
                  background: `linear-gradient(90deg, ${MONTHLY_TIER.color} 0%, ${MONTHLY_TIER.color} 40%, ${RUNNER_COLOR} 50%, ${MONTHLY_TIER.color} 60%, ${MONTHLY_TIER.color} 100%)`,
                  backgroundSize: '300% 100%',
                  animation: 'contributor-run-line 3.6s linear infinite',
                }}
              />
              <span className="text-[9px] tracking-wider" style={{ color: MONTHLY_TIER.color }}>
                {MONTHLY_TIER.label}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <span
                className="w-3 h-[2px]"
                style={{
                  background: `linear-gradient(90deg, ${TIERS[TIERS.length - 1].color}, ${MONTHLY_TIER.color})`,
                }}
              />
              <span className="text-[9px] tracking-wider" style={{ color: MONTHLY_TIER.color }}>
                Monthly + one-off
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

      {/* The thanks: large, centred, over everything, and staying until it is
          dismissed. It holds both halves of the message together -- the thank
          you, and the answer to "so where is my name?" -- because they are one
          thought, and splitting them across a timer meant the second half
          arrived only after the first had gone.

          The whole overlay takes the click. Nothing to aim at, and no close
          button standing beside the words competing with them. */}
      {thanks && !thanksGone && (
        <div
          className="absolute inset-0 flex items-center justify-center cursor-pointer"
          onPointerDown={dismissThanks}
          style={{
            opacity: thanksVisible ? 1 : 0,
            transition: `opacity ${THANKS_FADE_MS}ms ease-in-out`,
            background: 'radial-gradient(ellipse 60% 50% at 50% 50%, rgba(25,25,25,0.92), rgba(25,25,25,0.55) 70%, transparent)',
          }}
        >
          <div className="text-center px-6 max-w-lg">
            <div className="flex items-center justify-center gap-5 mb-5">
              <div className="w-16 h-[1px] bg-gradient-to-r from-transparent to-nier-border/60" />
              <div className="w-2 h-2 rotate-45 border border-nier-border/70" />
              <div className="w-16 h-[1px] bg-gradient-to-l from-transparent to-nier-border/60" />
            </div>
            <h2 className="text-nier-bg text-[clamp(2rem,7vw,4.5rem)] font-extralight tracking-[0.3em] uppercase">
              Thank you
            </h2>
            <p className="text-nier-bg/80 text-xs tracking-wide leading-relaxed mt-8">
              If you chose a name, it appears here beside the others once it has been
              checked. Stripe has emailed you a receipt.
            </p>
            <p
              className="text-nier-bg/70 text-[9px] tracking-[0.2em] uppercase mt-12"
              style={{
                opacity: hintVisible ? 1 : 0,
                transition: `opacity ${THANKS_FADE_MS}ms ease-in-out`,
              }}
            >
              Click anywhere to hide the message
            </p>
          </div>
        </div>
      )}

      {showNameApproval && (
        <NameApprovalPanel
          onClose={() => setShowNameApproval(false)}
          seededCount={seededCount()}
          onSeedChanged={refreshSeeded}
        />
      )}
    </div>
  )
}
