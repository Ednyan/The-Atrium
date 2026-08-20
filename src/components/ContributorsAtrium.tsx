import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createWheelGestures } from '../lib/canvasGestures'
import { useLandingTheme } from '../lib/useLandingTheme'
import { supabase, isDesktop } from '../lib/supabase'
import NameApprovalPanel from './NameApprovalPanel'
import ThemeToggle from './ThemeToggle'
import DonateButton, { DONATE_CUT } from './DonateButton'
import {
  getCachedContributions,
  searchContributors,
  startContributionsRefresh,
  type Contributor,
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
  // The name they asked to be listed under. Empty for an anonymous gift, in
  // which case the thanks simply does not use one.
  thanksName?: string
}

// Slow enough to feel like an arrival rather than a notification.
const THANKS_FADE_MS = 900

// The rush.
//
// All of one colour, and that colour is the interface's own foreground -- bone
// on a dark screen, ink on a light one. Not pure white or pure black, and not
// the rank colours either: they have to become the background, and a
// background made of six colours is a mess rather than a moment.
//
// The screen turning is the hearts arriving, so the wash underneath is the
// same colour and ramps as they mass. A hundred and ten glyphs cannot
// literally tile a screen; a hundred and ten glyphs over a colour that is
// filling in behind them reads as though they did, which is the effect.
//
// Fixed positions and timings: a rush that reshuffled itself on every render
// would flicker rather than flow.
const RUSH_COUNT = 360
const RUSH = Array.from({ length: RUSH_COUNT }, (_, index) => {
  // A golden-ratio walk across the width, so no two neighbours land on each
  // other and the pattern never repeats at any count.
  const left = (index * 61.803) % 100
  const lateness = index / RUSH_COUNT

  return {
    left,
    delay: Math.round(lateness * 1150 + (index % 9) * 35),
    // The late ones are slower as well as bigger, which is what stops the
    // whole thing reading as a single sheet moving up the screen.
    duration: 1500 + Math.round(lateness * 900) + (index % 7) * 90,
    // Thirty pixels to nearly two hundred and forty. The ones that arrive last
    // are the size of a hand, and they are what actually closes the screen --
    // a rush of small hearts is a shower, and a shower does not fill anything.
    size: 30 + Math.round(lateness * 170) + (index % 6) * 12,
    drift: ((index % 13) - 6) * 11,
    // How far up it goes. Early ones leave the screen; late ones stop inside
    // it and stay, which is the difference between passing through and
    // filling up -- the tank has to hold what falls into it.
    rise: 128 - Math.round(lateness * 78),
    opacity: 0.45 + lateness * 0.55,
  }
})

// The order things arrive in. The wash and the rush run together; the name
// lands once the screen is its own colour, and the rest follows it.
// The message waits for the screen to finish turning. It used to land while
// the fill was still arriving, so the words faded up through a colour that was
// itself still fading -- two things resolving at once, neither finished.
const THANKS_NAME_MS = 2300
const THANKS_NOTE_MS = 3150
const THANKS_HINT_MS = 4400

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
// Each rank in two inks.
//
// The dark set is built to glow on near-black. On paper every one of them
// lands between 1.4 and 2.3 against the background -- readable in the sense
// that a watermark is readable. The light set keeps each hue and its
// saturation and drops the lightness until it clears 4.8:1, which is the
// difference between a wall of names and a wall of suggestions.
// Each rank in two inks, and on paper the ink for lines is not the ink for
// words.
//
// Text has to clear 4.5:1 to be read. A border does not: it is a graphical
// object, where the threshold is 3:1, and holding lines to the text figure was
// dragging every rank about sixty percent darker than it needed to be -- which
// is why the wall looked like its brightness had been turned down. Lines sit
// at 3:1 and are drawn thicker to earn it; names stay at their own figure.
const TIERS = [
  { min: 50, label: '€50 and above', color: '#FF8A3D', light: '#B24700', lightLine: '#E85C00', glow: 'rgba(255,138,61,0.30)' },
  { min: 25, label: '€25 – €49', color: '#E8C15A', light: '#826312', lightLine: '#AA8218', glow: 'rgba(232,193,90,0.26)' },
  { min: 10, label: '€10 – €24', color: '#9AD4C4', light: '#317462', lightLine: '#40967E', glow: 'rgba(154,212,196,0.22)' },
  { min: 5, label: '€5 – €9', color: '#A8B6D9', light: '#4A66AA', lightLine: '#7188C1', glow: 'rgba(168,182,217,0.20)' },
  { min: 0, label: '€1 – €4', color: '#CBCBCB', light: '#676767', lightLine: '#888888', glow: 'rgba(203,203,203,0.16)' },
]

// Monthly support has its own colour rather than a place in the amount scale.
// It isn't a bigger version of a one-off gift, it's a different kind of thing --
// someone who has decided to keep paying - and the wall should be able to say
// that at a glance rather than only through the pulse.
const MONTHLY_TIER = {
  min: 0,
  label: 'Monthly',
  color: '#C77DFF',
  light: '#7B2CD6',
  lightLine: '#B859FF',
  glow: 'rgba(199,125,255,0.28)',
}

// Which of the two a tier is drawn in. Read from the resolved theme rather
// than from a media query, so the manual switch works as well as the machine's.
type Tier = { color: string; light: string; lightLine: string; glow: string }
// For words.
const inkOf = (tier: Tier, light: boolean) => (light ? tier.light : tier.color)
// For borders, the running light, and anything else that is a line rather than
// a letter.
const lineOf = (tier: Tier, light: boolean) => (light ? tier.lightLine : tier.color)

// #RRGGBB at an opacity, for the unlit border.
const withAlpha = (hex: string, alpha: number) => {
  const value = parseInt(hex.slice(1), 16)
  return `rgba(${(value >> 16) & 255}, ${(value >> 8) & 255}, ${value & 255}, ${alpha})`
}

// What is left of a monthly trace's border where the light isn't. Present
// enough to keep the box a box, faint enough that the light passing over it is
// the thing you see.
const UNLIT = 0.22

// One lap of a trace's border. Slow: this is meant to be noticed in passing
// rather than watched, and a wall of them moving quickly is a wall that will
// not let you read anything else on it.
const RHYTHM_MS = 7000

// The light, as a comet rather than a dash.
//
// SVG can't fade a stroke along its own path -- a gradient on a stroke runs
// across the shape's box, not around it -- so the tail is drawn as segments,
// each one a little further behind and a little dimmer than the one in front.
// Nine of them covering just under a third of the perimeter.
//
// They are offset by animation-delay rather than by their dash pattern: one
// keyframe set drives all of them, and a segment made to start later in the
// cycle simply sits further back on the path.
//
// Every delay is normalised to be negative (see delayFor). A positive delay
// makes the browser wait before starting, and a trace that has just come back
// into view would sit dark for up to a few seconds first -- which is exactly
// what culling does to it every time it crosses the edge of the screen.
const TAIL_SEGMENTS = 9
const TAIL_SEGMENT_LENGTH = 3.5 // in the 100 units pathLength normalises to

// Butt caps, not round: round ones overhang each join, and two translucent
// segments overlapping would draw a bright seam at every one.
const TAIL = Array.from({ length: TAIL_SEGMENTS }, (_, index) => ({
  index,
  // Eased so the head stays bright for a moment before falling away, rather
  // than dimming linearly from the first segment.
  opacity: Math.pow(1 - index / TAIL_SEGMENTS, 1.6),
  // The head is furthest through the cycle, so it leads.
  lagMs: (TAIL_SEGMENTS - 1 - index) * (TAIL_SEGMENT_LENGTH / 100) * RHYTHM_MS,
}))

// Where in its cycle a segment starts, always expressed as a negative delay.
//
// An animation is periodic, so any phase can be written as a head start
// somewhere in the previous lap -- and a negative delay begins already in
// progress rather than waiting. It means a trace scrolled back into view is
// lit the instant it mounts instead of standing dark until its turn came round.
const delayFor = (order: number, lagMs: number) => {
  const raw = (order % 7) * 600 - lagMs
  const phase = ((raw % RHYTHM_MS) + RHYTHM_MS) % RHYTHM_MS
  return phase - RHYTHM_MS
}

// The rank someone has reached, by everything they have given.
//
// The total rather than the one-off part of it, because position on this page
// is decided by the total -- a trace coloured for one rank while sitting in
// another would read as a mistake rather than as information.
const rankFor = (person: { amountEur: number }) =>
  TIERS.find(tier => person.amountEur >= tier.min) ?? TIERS[TIERS.length - 1]

// How a trace is drawn. Two questions decide it, and they are separate.
//
// Has this person ever subscribed? That decides the gradient: their rank on one
// side, purple on the other. It stays true once it is true, because it is a
// fact about them rather than about this month.
//
// Are they subscribed right now? That decides the light. A trace with a light
// running around it is saying "this is still happening", and it should stop
// saying that when it stops being true.
//
// Rank is decided by everything given, monthly and one-off alike. There is no
// reason 3 euros a month for two years should count for less than 72 euros
// given at once, and separating the two was making the page argue that it did.
function drawFor(person: { amountEur: number; isMonthly: boolean; monthlyActive: boolean }, light: boolean) {
  const rankTier = rankFor(person)
  const rank = { ...rankTier, color: inkOf(rankTier, light) }
  const rankLine = lineOf(rankTier, light)
  const monthly = { ...MONTHLY_TIER, color: inkOf(MONTHLY_TIER, light) }
  const monthlyLine = lineOf(MONTHLY_TIER, light)

  if (person.isMonthly) {
    return {
      nameColor: rank.color,
      metaColor: monthly.color,
      glow: MONTHLY_TIER.glow,
      // A gradient border needs border-image; border-color takes one colour and
      // that is the whole problem here. Drawn faint when a light runs over it,
      // and at full strength when nothing will.
      borderImage: person.monthlyActive
        ? `linear-gradient(135deg, ${withAlpha(rankLine, UNLIT)} 0%, ${withAlpha(rankLine, UNLIT)} 35%, ${withAlpha(monthlyLine, UNLIT)} 100%) 1`
        : `linear-gradient(135deg, ${rankLine} 0%, ${rankLine} 35%, ${monthlyLine} 100%) 1`,
      borderColor: undefined as string | undefined,
      // The light is the border, at full strength: the same gradient, defined
      // once per rank in the page's <defs> and referenced by every trace at
      // that rank.
      runnerStroke: person.monthlyActive ? `url(#contributor-run-${TIERS.indexOf(rankTier)})` : undefined,
      // The gradient's own colours can't light a drop-shadow, which takes one
      // colour. The rank's is the half that would otherwise be hardest to read
      // against the purple glow already around the box.
      runnerGlow: rankLine,
    }
  }

  // Nothing runs around a one-off trace, so its border carries itself.
  return {
    nameColor: rank.color,
    metaColor: rank.color,
    glow: rank.glow,
    borderImage: undefined as string | undefined,
    borderColor: rankLine,
    runnerStroke: undefined as string | undefined,
    runnerGlow: undefined as string | undefined,
  }
}

// Written out in full. "06" is a field in a database; "18 June 2026" is a date
// someone gave money on, and this page is the one place that difference
// matters.
const formatDate = (iso: string) => {
  // "2026-08-19" parses as UTC midnight, which renders as the 18th for anyone
  // west of Greenwich. Read as a local calendar date instead, so everybody sees
  // the day the contribution is recorded against rather than their timezone's
  // opinion of it.
  const dayOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso)
  const date = dayOnly
    ? new Date(Number(dayOnly[1]), Number(dayOnly[2]) - 1, Number(dayOnly[3]))
    : new Date(iso)

  return Number.isNaN(date.getTime())
    ? ''
    : date.toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' })
}

// How far back the wall is looking.
//
// "All" is not a range among four, it is the wall's real subject -- everyone
// who ever kept this running -- and the others are questions asked of it. So
// the control names it first and returns to it.
const RANGES = [
  { id: 'all', label: 'All time' },
  { id: 'year', label: 'Last year' },
  { id: 'month', label: 'Last month' },
  { id: 'week', label: 'Last week' },
] as const

type RangeId = (typeof RANGES)[number]['id']

// What somebody gave inside the chosen window. Null means the view has no
// window columns yet, which is different from having given nothing.
const givenIn = (person: Contributor, range: RangeId): number | null => {
  if (range === 'all') return person.amountEur
  if (range === 'week') return person.amount7d
  if (range === 'month') return person.amount30d
  return person.amount365d
}

// Case and accents folded, so searching is about the name rather than about
// reproducing it exactly.
const normalise = (value: string) =>
  value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim()

export default function ContributorsAtrium({ onClose, onContribute, thanks = false, thanksName = '' }: ContributorsAtriumProps) {
  // The wall follows the same light or dark choice the website does. It is a
  // page people are sent to from a browser, not a surface inside the app.
  const theme = useLandingTheme()
  const isLight = theme.resolved === 'light'

  const [data, setData] = useState<ContributionsData>(() => getCachedContributions())
  useEffect(() => startContributionsRefresh(setData), [])

  // Fades up over the wall and stays there. It used to time itself out, which
  // meant reading speed decided whether a contributor got the message -- and
  // the one sentence that actually answers "so where is my name?" could be gone
  // before it was looked at. It leaves when the person is done with it.
  // Replayable, so the operator can watch it without paying for it again.
  const [replay, setReplay] = useState(0)
  const showingThanks = thanks || replay > 0
  // A replay with no name would show the anonymous version, which is not the
  // one the operator is checking.
  const shownName = replay > 0 ? 'Test' : thanksName

  const [thanksVisible, setThanksVisible] = useState(false)
  const [thanksGone, setThanksGone] = useState(!thanks)
  const [stage, setStage] = useState<0 | 1 | 2 | 3>(0)
  const dismissTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (!showingThanks) return
    setThanksGone(false)
    setStage(0)
    // Next frame, so the element paints at zero before it starts moving.
    const up = requestAnimationFrame(() => setThanksVisible(true))
    const name = setTimeout(() => setStage(1), THANKS_NAME_MS)
    const note = setTimeout(() => setStage(2), THANKS_NOTE_MS)
    const hint = setTimeout(() => setStage(3), THANKS_HINT_MS)
    return () => {
      cancelAnimationFrame(up)
      clearTimeout(name)
      clearTimeout(note)
      clearTimeout(hint)
      if (dismissTimer.current) clearTimeout(dismissTimer.current)
    }
  }, [showingThanks, replay])

  // Anywhere at all: the whole overlay is the target, so there is nothing to
  // aim at and no close button competing with the words.
  const dismissThanks = useCallback(() => {
    if (!showingThanks || thanksGone) return
    setThanksVisible(false)
    setStage(0)
    if (dismissTimer.current) clearTimeout(dismissTimer.current)
    // Unmounted only once it has finished fading, so the wall underneath
    // becomes draggable at the moment the message stops being visible.
    dismissTimer.current = setTimeout(() => {
      setThanksGone(true)
      setReplay(0)
    }, THANKS_FADE_MS)
  }, [showingThanks, thanksGone])

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

  // The window the wall is showing, and whether the control for it is worth
  // offering at all -- a view without the window columns cannot answer.
  const [range, setRange] = useState<RangeId>('all')
  const [rangeOpen, setRangeOpen] = useState(false)

  // Leaving is a move, like arriving was. Without it the wall arrived softly
  // and vanished instantly, which reads as two different doors.
  const [leaving, setLeaving] = useState(false)
  const closeWithTransition = () => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) { onClose(); return }
    setLeaving(true)
    setTimeout(onClose, 210)
  }

  // Finding yourself, on a wall that can hold two thousand people.
  //
  // Scrolling until your own name happens to pass under the cursor is not
  // finding it. Matching dims everything else and moves the view onto the hit,
  // which is the only way this scales past a screenful.
  const [query, setQuery] = useState('')
  const [matchIndex, setMatchIndex] = useState(0)

  // Contributors the wall has no room for.
  //
  // The page draws the largest 2000 and drops the smallest and oldest past
  // that. Nothing about them was deleted -- they are in the table and in every
  // total -- but from where they are sitting, not being on the wall looks
  // exactly like having been removed. So a search asks the server as well as
  // the page, and anyone it turns up is drawn for as long as the search lasts.
  const [beyondWall, setBeyondWall] = useState<Contributor[]>([])

  useEffect(() => {
    const needle = query.trim()
    if (needle.length < 2) {
      setBeyondWall([])
      return
    }

    // Debounced: this is a request per search, not per keystroke.
    let cancelled = false
    const timer = setTimeout(() => {
      void searchContributors(needle).then(found => {
        if (!cancelled) setBeyondWall(found)
      })
    }, 350)

    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [query])

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

    // Only the ones not already on the wall. A search matches the local list
    // first, and the server answers without knowing what was drawn -- so most
    // of what comes back is usually already here.
    const drawn = new Set(data.contributors.map(person => normalise(person.displayName)))
    const extra = beyondWall
      .filter(person => !drawn.has(normalise(person.displayName)))
      .map(person => ({ ...person, isBeyondWall: true }))

    // Seeded people are sorted in among the real ones rather than appended, so
    // the arrangement being judged is the arrangement that would happen. The
    // same sort puts the beyond-the-wall ones out at the rim, which is exactly
    // where they would have been if there had been room -- they are past the
    // cap because they are the smallest, and small is what the rim is.
    const everyone = [...data.contributors, ...seeded, ...extra]

    // A window rebuilds the wall rather than dimming part of it. Somebody who
    // gave 200 euros two years ago and 5 last week belongs at the rim of "last
    // week" -- showing them at their lifetime size would answer a question
    // nobody asked. So the amount is replaced by what they gave inside the
    // window, and everything downstream -- rank, colour, position -- follows
    // from that one substitution.
    const showing = range === 'all'
      ? everyone
      : everyone
          .map(person => ({ person, given: givenIn(person, range) ?? 0 }))
          .filter(entry => entry.given > 0)
          .map(entry => ({ ...entry.person, amountEur: entry.given }))

    return showing
      .sort((a, b) => b.amountEur - a.amountEur || b.since.localeCompare(a.since))
      .map((person, index) => {
        const radius = SPACING * Math.sqrt(index)
        const angle = index * GOLDEN_ANGLE
        return {
          person,
          x: Math.cos(angle) * radius,
          y: Math.sin(angle) * radius * 0.72, // flattened: screens are wider than they are tall
          // Position in the whole wall, which does not change as the view
          // moves. Used for React's key and for the animation's stagger --
          // both of which were being taken from the index within the *culled*
          // list, so panning renumbered every trace, changed its key, and
          // remounted it. The running light restarted on every pointer move
          // and looked like it had stopped.
          order: index,
          // Folded once here rather than on every keystroke. At ten thousand
          // traces, normalising the whole wall per character typed costs about
          // 3ms; reading a string that was already folded costs half of one.
          folded: normalise(person.displayName),
        }
      })
  }, [data.contributors, seeded, beyondWall, range])

  // Accents folded and case ignored: someone typing "ines" should find "Inês",
  // and a person who put an accent in their name should not have to remember
  // exactly where. Substring rather than prefix, because people search for the
  // part of their name they think is distinctive.
  const matches = useMemo(() => {
    const needle = normalise(query)
    if (!needle) return []
    return placed.filter(item => item.folded.includes(needle))
  }, [placed, query])

  // Names rather than indices, so the dimming survives the culling that decides
  // what is in the document at any moment.
  // For the counter. Only the ones actually being drawn because of the search.
  const beyondCount = useMemo(
    () => matches.filter(item => (item.person as Contributor).isBeyondWall).length,
    [matches],
  )

  const matchedNames = useMemo(() => new Set(matches.map(item => item.folded)), [matches])

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
    // Generous, because leaving the document is not free here: a trace that
    // unmounts loses its running light and starts a fresh lap when it returns.
    // Holding a screen's worth on each side means ordinary panning stops
    // crossing that boundary at all.
    const margin = 460
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
  // Older caches and older views have no window columns. Offering a control
  // that would empty the wall is worse than not offering it.
  const rangeAvailable = useMemo(
    () => data.contributors.some(person => person.amount30d !== null) || seeded.length > 0,
    [data.contributors, seeded],
  )

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
    <div
      className={`fixed inset-0 bg-nier-black overflow-hidden font-mono select-none ${leaving ? 'screen-recede' : 'screen-rise'}`}
      data-landing-theme={theme.resolved}
      data-ui-element
    >
      {/* One gradient per rank, for the light that runs around a contributor
          who both subscribes and has given one-off. Defined once here rather
          than inside every trace: a url(#id) stroke resolves against the whole
          document, and the alternative was a duplicate definition per box. */}
      <svg aria-hidden="true" style={{ position: 'absolute', width: 0, height: 0 }}>
        <defs>
          {TIERS.map((tier, index) => (
            <linearGradient key={tier.label} id={`contributor-run-${index}`} x1="0" y1="0" x2="1" y2="1">
              <stop offset="0%" stopColor={lineOf(tier, isLight)} />
              <stop offset="35%" stopColor={lineOf(tier, isLight)} />
              <stop offset="100%" stopColor={lineOf(MONTHLY_TIER, isLight)} />
            </linearGradient>
          ))}
        </defs>
      </svg>

      {/* Scanlines and grid, so this reads as the same material as an atrium. */}
      <div
        className="absolute inset-0 pointer-events-none opacity-[0.04]"
        style={{
          backgroundImage:
            'repeating-linear-gradient(0deg, transparent, transparent 2px, rgb(var(--c-fg) / 0.14) 2px, rgb(var(--c-fg) / 0.14) 4px)',
        }}
      />
      <div
        className="absolute inset-0 pointer-events-none opacity-[0.05]"
        style={{
          backgroundImage:
            'linear-gradient(rgb(var(--c-fg) / 0.5) 1px, transparent 1px), linear-gradient(90deg, rgb(var(--c-fg) / 0.5) 1px, transparent 1px)',
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
          {visible.map(({ person, x, y, order, folded }) => {
            const draw = drawFor(person, isLight)
            const dimmed = query.trim().length > 0 && !matchedNames.has(folded)
            return (
              <div
                key={`${person.isSeed ? 's' : person.isBeyondWall ? 'b' : 'r'}|${person.displayName}`}
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
                  // A hairline was thinner than these needed to be in either
                  // room. On paper the weight is what earns the lighter line
                  // its 3:1; on black it simply reads as a made thing rather
                  // than a drawn outline.
                  border: '1.5px solid',
                  borderColor: draw.borderColor,
                  borderImage: draw.borderImage,
                  boxShadow: `0 0 24px ${draw.glow}`,
                  background: 'rgb(var(--c-surface) / 0.86)',
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
                {person.monthlyActive && !dimmed && (
                  <svg
                    className="absolute inset-0 w-full h-full pointer-events-none"
                    style={{ overflow: 'visible' }}
                    aria-hidden="true"
                  >
                    {TAIL.map(segment => (
                      <rect
                        key={segment.index}
                        x="0"
                        y="0"
                        width="100%"
                        height="100%"
                        fill="none"
                        stroke={draw.runnerStroke}
                        strokeWidth={2.75}
                        strokeLinecap="butt"
                        opacity={segment.opacity}
                        pathLength={100}
                        strokeDasharray={`${TAIL_SEGMENT_LENGTH} ${100 - TAIL_SEGMENT_LENGTH}`}
                        style={{
                          animation: `contributor-run ${RHYTHM_MS}ms linear ${delayFor(order, segment.lagMs)}ms infinite`,
                          // Only the head is lit. Nine shadows per trace, on
                          // every monthly trace on screen, is a lot of blur to
                          // ask for and the tail is too faint to show one.
                          filter: segment.index === 0
                            ? `drop-shadow(0 0 5px ${withAlpha(draw.runnerGlow ?? MONTHLY_TIER.color, 0.75)})`
                            : undefined,
                        }}
                      />
                    ))}
                  </svg>
                )}

                <div className="text-[13px] tracking-wide truncate" style={{ color: draw.nameColor }}>
                  {person.displayName}
                </div>
                {/* Labelled, always. An unmarked fake is how a screenshot ends
                    up somewhere it shouldn't. */}
                {person.isSeed && (
                  <div className="text-[11px] tracking-[0.2em] uppercase mt-1" style={{ color: '#FF6161' }}>
                    False donation
                  </div>
                )}
                {/* Answers the question this trace exists to answer: it is
                    still counted, it is just past what the page can draw. */}
                {person.isBeyondWall && (
                  <div className="text-[11px] tracking-[0.2em] uppercase mt-1 text-nier-bg/70">
                    Still counted · found by search
                  </div>
                )}
                <div className="flex flex-wrap items-baseline justify-between mt-1 gap-x-2">
                  {/* The total leads, always, because the total is what put
                      this trace where it is. A running subscription adds its
                      rate after it -- one number saying what they have given,
                      one saying what they are still giving. */}
                  <span className="text-xs tracking-wider whitespace-nowrap" style={{ color: draw.metaColor, opacity: 0.85 }}>
                    €{person.amountEur}
                    {person.monthlyActive && person.monthlyEur ? ` + €${person.monthlyEur} / month` : ''}
                  </span>
                  <span className="text-xs tracking-wider uppercase text-nier-bg/70 whitespace-nowrap">
                    {person.monthlyActive ? `since ${formatDate(person.since)}` : formatDate(person.since)}
                  </span>
                </div>
              </div>
            )
          })}

          {placed.length === 0 && (
            <div className="absolute -translate-x-1/2 -translate-y-1/2 text-center w-[320px]">
              <p className="text-nier-bg/80 text-xs tracking-wide leading-relaxed">
                {range !== 'all'
                  ? 'Nobody contributed in this period.'
                  : data.fetchedAt === null
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
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-nier-bg/70 text-sm pointer-events-none">
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
          <p className="text-center text-xs tracking-[0.15em] uppercase mt-2 text-nier-bg/70">
            {matches.length === 0
              ? 'Nobody here by that name'
              : matches.length === 1
                ? 'One match'
                : `${matchIndex + 1} of ${matches.length} — Enter for the next`}
            {beyondCount > 0 && ` · ${beyondCount} beyond the wall`}
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
          <span className="text-xs tracking-[0.2em] uppercase" style={{ color: '#FF6161' }}>
            Preview — {seeded.length} false donations, visible only to you
          </span>
        </div>
      )}

      {/* Title, top left, out of the way of the space */}
      <div className="absolute top-6 left-6 pointer-events-none">
        <div className="flex items-center gap-3">
          <div className="w-1.5 h-1.5 rotate-45 border border-nier-border/60" />
          <h1 className="text-nier-strong text-xl tracking-[0.12em] uppercase font-normal leading-none">Contributors</h1>
        </div>
        <p className="text-nier-bg/70 text-xs tracking-wide mt-2 max-w-xs leading-relaxed">
          Everyone who keeps this running. Drag to move, scroll or pinch to zoom.
        </p>
      </div>

      <div className="absolute top-6 right-6 flex items-center gap-2">
        {/* Shaped like the donation ranks in the other corner: a diamond that
            turns, and a list that appears under it. One idiom for "this panel
            opens", used twice. */}
        {rangeAvailable && (
          <div className="relative">
            <button
              type="button"
              onClick={() => setRangeOpen(open => !open)}
              className="cut-corner flex items-center justify-center gap-2 h-[2.125rem] px-4 border border-nier-border/40 text-nier-bg/80 hover:text-nier-strong hover:border-nier-border/70 text-[11px] tracking-[0.15em] uppercase transition-colors leading-none"
              style={{ backgroundColor: 'rgb(var(--c-ground) / 0.94)' }}
            >
              <span
                className="inline-block transition-transform duration-200"
                style={{ transform: rangeOpen ? 'rotate(45deg)' : 'rotate(0deg)' }}
              >
                ◇
              </span>
              {RANGES.find(entry => entry.id === range)?.label}
            </button>

            {rangeOpen && (
              <div className="absolute right-0 mt-1 w-full min-w-[9.5rem] border border-nier-border/40 bg-nier-black">
                {RANGES.map(entry => (
                  <button
                    key={entry.id}
                    type="button"
                    onClick={() => { setRange(entry.id); setRangeOpen(false) }}
                    className={`block w-full text-left px-4 py-2 text-[11px] tracking-[0.15em] uppercase transition-colors ${
                      entry.id === range
                        ? 'text-nier-strong bg-nier-bg/10'
                        : 'text-nier-bg/70 hover:text-nier-bg hover:bg-nier-bg/5'
                    }`}
                  >
                    {entry.label}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        <ThemeToggle />
        <button
          type="button"
          onClick={closeWithTransition}
          className="cut-corner inline-flex items-center justify-center h-[2.125rem] px-4 border border-nier-border/40 text-nier-bg/80 text-[11px] tracking-[0.15em] uppercase hover:border-nier-border/70 hover:text-nier-strong transition-colors leading-none"
          style={{ backgroundColor: 'rgb(var(--c-ground) / 0.94)' }}
        >
          ← Back
        </button>
      </div>

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
          className="flex items-center gap-2 text-nier-bg/70 hover:text-nier-bg text-xs tracking-[0.2em] uppercase transition-colors"
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
                <span className="w-3 h-[2px]" style={{ background: lineOf(tier, isLight) }} />
                <span className="text-xs tracking-wider" style={{ color: inkOf(tier, isLight) }}>{tier.label}</span>
              </div>
            ))}
            {/* Not a rank. Every contributor is placed by what they have
                given, monthly included -- these two say what the purple half of
                a border means, and whether it is still happening. */}
            <div className="flex items-center gap-2 pt-1">
              <span
                className="w-3 h-[2px]"
                style={{
                  background: `linear-gradient(90deg, ${withAlpha(inkOf(MONTHLY_TIER, isLight), UNLIT)} 0%, ${withAlpha(inkOf(MONTHLY_TIER, isLight), UNLIT)} 40%, ${inkOf(MONTHLY_TIER, isLight)} 50%, ${withAlpha(inkOf(MONTHLY_TIER, isLight), UNLIT)} 60%, ${withAlpha(inkOf(MONTHLY_TIER, isLight), UNLIT)} 100%)`,
                  backgroundSize: '300% 100%',
                  animation: `contributor-run-line ${RHYTHM_MS}ms linear infinite`,
                }}
              />
              <span className="text-xs tracking-wider" style={{ color: inkOf(MONTHLY_TIER, isLight) }}>
                Monthly, running
              </span>
            </div>
            <div className="flex items-center gap-2">
              <span
                className="w-3 h-[2px]"
                style={{ background: `linear-gradient(90deg, ${inkOf(TIERS[TIERS.length - 1], isLight)}, ${inkOf(MONTHLY_TIER, isLight)})` }}
              />
              <span className="text-xs tracking-wider" style={{ color: inkOf(MONTHLY_TIER, isLight) }}>
                Monthly, ended
              </span>
            </div>
          </div>
        )}
      </div>

      {/* The month, bottom centre, where an atrium shows its usage */}
      {month && month.goalCents > 0 && (
        <div className="absolute bottom-6 left-1/2 -translate-x-1/2 w-[min(420px,60vw)] pointer-events-none">
          <div className="flex items-baseline justify-between mb-1">
            <span className="text-xs text-nier-bg/70 tracking-[0.2em] uppercase">This month</span>
            <span className="text-xs text-nier-bg/80 tracking-wider">
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
      {isOperator ? (
        <button
          type="button"
          onClick={() => setShowNameApproval(true)}
          className="absolute bottom-6 right-6 px-7 py-4 text-[11px] tracking-[0.2em] uppercase font-medium transition-transform hover:scale-[1.03] active:scale-[0.99]"
          style={{ background: 'rgb(var(--c-accent))', color: 'rgb(var(--c-ground))', clipPath: DONATE_CUT }}
        >
          ◇ Contributor Names
        </button>
      ) : (
        // The same button it is everywhere else, hearts and all. It was
        // hand-built here and had drifted into a different shape from the one
        // on every other screen.
        // Positioned by a wrapper rather than by classes handed to the button.
        // Its own padding classes and the ones passed in both landed in the
        // same class list, and which won was decided by the stylesheet's order
        // rather than by intent -- which is what threw it out of line.
        <div className="absolute bottom-6 right-6">
          <DonateButton onClick={onContribute} className="px-9 py-4 text-xs tracking-[0.22em]" />
        </div>
      )}

      {/* The thanks: large, centred, over everything, and staying until it is
          dismissed. It holds both halves of the message together -- the thank
          you, and the answer to "so where is my name?" -- because they are one
          thought, and splitting them across a timer meant the second half
          arrived only after the first had gone.

          The whole overlay takes the click. Nothing to aim at, and no close
          button standing beside the words competing with them. */}
      {showingThanks && !thanksGone && (
        <div
          className="absolute inset-0 overflow-hidden cursor-pointer"
          onPointerDown={dismissThanks}
          style={{
            opacity: thanksVisible ? 1 : 0,
            transition: `opacity ${THANKS_FADE_MS}ms ease-in-out`,
          }}
        >
          {/* The wash. The wall does not dim behind the message, it is covered
              by the room's own colour -- so what you are looking at stops being
              a wall with something over it and becomes a single held moment. */}
          <div
            className="absolute inset-0 thanks-wash"
            style={{ background: 'rgb(var(--c-fg))' }}
          />

          {/* The rush, over the wash rather than under it: hearts arriving into
              an empty room read as coming to you, where hearts behind a screen
              of colour read as something happening elsewhere. */}
          {RUSH.map((heart, index) => (
            <span
              key={index}
              className="absolute thanks-heart select-none"
              style={{
                left: `${heart.left}%`,
                bottom: '-12vh',
                fontSize: heart.size,
                lineHeight: 1,
                color: 'rgb(var(--c-fg))',
                opacity: 0,
                ['--rush-drift' as string]: `${heart.drift}px`,
                ['--rush-rise' as string]: `${heart.rise}vh`,
                ['--rush-opacity' as string]: heart.opacity,
                animation: `thanks-rush ${heart.duration}ms cubic-bezier(0.32, 0, 0.6, 1) ${heart.delay}ms both`,
              }}
            >
              ♥
            </span>
          ))}

          <div className="relative h-full flex items-center justify-center">
            <div className="text-center px-6 max-w-xl">
              <div
                className="flex items-center justify-center gap-5 mb-6"
                style={{ opacity: stage >= 1 ? 1 : 0, transition: 'opacity 700ms ease-out' }}
              >
                <div className="w-16 h-[1px]" style={{ background: 'linear-gradient(90deg, transparent, rgb(var(--c-ground) / 0.55))' }} />
                <div className="w-2 h-2 rotate-45 border" style={{ borderColor: 'rgb(var(--c-ground) / 0.7)' }} />
                <div className="w-16 h-[1px]" style={{ background: 'linear-gradient(90deg, rgb(var(--c-ground) / 0.55), transparent)' }} />
              </div>

              {/* Named, when they gave one. "Thank you" is a sentiment; "Thank
                  you, Ana" is addressed to somebody -- and the name they chose
                  is the one thing about this they picked themselves. */}
              {/* In the ground colour, because by the time it lands the screen
                  is the foreground one. The whole thing has inverted. */}
              <h2
                className="text-[clamp(2rem,7vw,4.5rem)] font-extralight tracking-[0.3em] uppercase leading-[1.05]"
                style={{
                  color: 'rgb(var(--c-ground))',
                  opacity: stage >= 1 ? 1 : 0,
                  transform: stage >= 1 ? 'translateY(0)' : 'translateY(14px)',
                  transition: 'opacity 900ms ease-out, transform 900ms cubic-bezier(0.22, 1, 0.36, 1)',
                }}
              >
                Thank you
                {shownName && (
                  <span
                    className="block text-[clamp(1.4rem,4.5vw,2.8rem)] tracking-[0.16em] mt-3 font-normal"
                    style={{ color: 'rgb(var(--c-ground))' }}
                  >
                    {shownName}
                  </span>
                )}
              </h2>

              <p
                className="text-sm tracking-wide leading-relaxed mt-9"
                style={{
                  color: 'rgb(var(--c-ground) / 0.85)',
                  opacity: stage >= 2 ? 1 : 0,
                  transform: stage >= 2 ? 'translateY(0)' : 'translateY(8px)',
                  transition: 'opacity 800ms ease-out, transform 800ms cubic-bezier(0.22, 1, 0.36, 1)',
                }}
              >
                {shownName
                  ? 'Your name joins the wall once a person has checked it — usually within 48 hours. Stripe has emailed you a receipt.'
                  : 'Your contribution is counted. Stripe has emailed you a receipt.'}
              </p>

              <p
                className="text-xs tracking-[0.2em] uppercase mt-12"
                style={{
                  color: 'rgb(var(--c-ground) / 0.7)',
                  opacity: stage >= 3 ? 1 : 0,
                  transition: 'opacity 700ms ease-out',
                }}
              >
                Click anywhere to hide the message
              </p>
            </div>
          </div>
        </div>
      )}

      {showNameApproval && (
        <NameApprovalPanel
          onClose={() => setShowNameApproval(false)}
          seededCount={seededCount()}
          onSeedChanged={refreshSeeded}
          onPlayThanks={() => { setShowNameApproval(false); setReplay(count => count + 1) }}
        />
      )}
    </div>
  )
}
