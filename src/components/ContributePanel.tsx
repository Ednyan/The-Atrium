import { useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import { openExternalUrl } from '../lib/openExternal'
import { openContributors } from '../lib/contributorsRoute'
import DonateButton from './DonateButton'
import RichText from './RichText'
import ConnectTiles from './ConnectTiles'
import { Brackets } from './landing/parts'
import { useTranslation } from '../lib/i18n'
import { useLandingTheme } from '../lib/useLandingTheme'
import { useCurrency, currencyByCode, minorPerUnit, isAllowedStep } from '../lib/currency'
import CurrencyToggle from './CurrencyToggle'
import { checkDisplayName, startContribution } from '../lib/donate'
import { rememberPendingContribution } from '../lib/pendingContribution'
import { getCachedContributions, refreshContributions, type MonthlyProgress } from '../lib/contributions'
import { contributionCountKey, gaugeFigures } from '../lib/monthlyGauge'
import { currentRoutePath } from '../lib/route'

interface ContributePanelProps {
  onClose: () => void
  // Called once checkout has been opened, so the caller can record that the
  // appeal was answered by contributing rather than dismissed.
  onStarted?: () => void
}

// Case and accents folded: "ines" and "Inês" are the same name to anyone
// reading the wall, and warning about one but not the other would be arbitrary.
const fold = (value: string) =>
  value.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim()

/** This month against its goal, as the landing page's support chapter says
 *  it: the share funded, the light's level, how many gave -- or, with no
 *  figure to show, that people keep it standing. */
export function MonthLevel({ month }: { month: MonthlyProgress | null }) {
  const { t } = useTranslation()
  const figures = gaugeFigures(month)
  if (!figures) return <p className="text-xs tracking-[0.15em] uppercase text-nier-bg/70">{t('landing.support.keptStanding')}</p>
  return (
    <>
      <div className="flex items-baseline justify-between gap-4 mb-3">
        <span className="text-xs tracking-[0.2em] uppercase text-nier-bg/70">{t('landing.support.thisMonth')}</span>
        <span className="text-sm tracking-wider text-nier-strong tabular-nums whitespace-nowrap">{t('goal.funded', { percent: figures.percent })}</span>
      </div>
      {/* The light's level: how much of the month is kept lit. */}
      <div className="h-[3px] overflow-hidden" style={{ backgroundColor: 'rgb(var(--c-fg) / 0.12)' }}>
        <div className="h-full transition-[width] duration-700 ease-out landing-light-fill" style={{ width: `${figures.percent}%` }} />
      </div>
      <p className="text-xs tracking-[0.15em] uppercase text-nier-bg/70 mt-3">
        {t(contributionCountKey(figures.count), { count: figures.count })}
      </p>
    </>
  )
}

// A label as the landing page's chapters have one: a diamond in its light,
// the name, and a rule drawn out from it.
function RoomLabel({ children, id }: { children: string; id?: string }) {
  return (
    <div className="flex items-center gap-4 text-xs tracking-[0.3em] uppercase">
      <span aria-hidden="true" className="landing-lit w-2.5 h-2.5 rotate-45 shrink-0 border" />
      <h2 id={id} className="text-nier-strong">{children}</h2>
      <span aria-hidden="true" className="donate-rule h-px flex-1 max-w-[16rem]" />
    </div>
  )
}

// One choice of several, as the landing page's bento lays its cells out: the
// chosen one lit from above.
function Choice({ chosen, onPick, children, className = '' }: { chosen: boolean; onPick: () => void; children: React.ReactNode; className?: string }) {
  return (
    <button type="button" aria-pressed={chosen} onClick={onPick} className={`donate-choice py-2.5 tracking-[0.15em] ${className}`}>
      {children}
    </button>
  )
}

// Choosing an amount, and where to send it -- a room in the landing page's
// light: who is asking and why on one side, the form on the other.
//
// Checkout is Stripe's own page, opened in a browser: the app never touches a
// card number, a Stripe key, or anything that would make this screen worth
// attacking. All it does is ask for three things and hand them to the Edge
// Function that builds the session.
export default function ContributePanel({ onClose, onStarted }: ContributePanelProps) {
  const { t } = useTranslation()
  // The landing page's own theme, wherever this opens -- the welcome screen,
  // the atrium browser, the contributors wall -- as the wall does.
  const theme = useLandingTheme()
  // Every amount below this line is in MINOR units -- cents, or whole yen for
  // a currency with no minor unit. Units would have read more naturally and
  // would have needed a * 100 somewhere, which is exactly the multiply that
  // charges a yen donor a hundred times what they chose.
  const { currency, format } = useCurrency()
  const money = currencyByCode(currency)
  const per = minorPerUnit(currency)
  // Whether the name field is being typed in, which is when the explanation
  // beside it should get out of the way.
  const [nameFocused, setNameFocused] = useState(false)

  // Keys stay in the room while it's open: Escape closes it, Tab goes round it.
  const room = useRef<HTMLDivElement>(null)
  useEffect(() => {
    room.current?.focus()
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
      if (event.key !== 'Tab' || !room.current) return
      const stops = [...room.current.querySelectorAll<HTMLElement>('a[href], button:not([disabled]), input, [tabindex]:not([tabindex="-1"])')]
      if (!stops.length) return
      const first = stops[0], last = stops[stops.length - 1]
      if (event.shiftKey && (document.activeElement === first || document.activeElement === room.current)) { event.preventDefault(); last.focus() }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus() }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onClose])
  const [monthly, setMonthly] = useState(false)
  const [amount, setAmount] = useState<number | null>(null)
  const [customAmount, setCustomAmount] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  // The month, and the names already on the wall -- so a collision is caught
  // here rather than by the operator after the money has arrived.
  //
  // The wall groups by name -- most contributors have no account to be told
  // apart by -- so two people under one name become a single trace with both
  // amounts added together. Discovering that afterwards means writing to
  // someone to ask them to change it, and the answer arrives days later if at
  // all. Asking before paying costs one question.
  //
  // Only approved names are public, so a name still waiting on approval cannot
  // be checked against. That gap is the operator's to close, and is why the
  // check at approval exists as well as this one.
  const [contributions, setContributions] = useState(getCachedContributions)
  useEffect(() => {
    // Then the current figures, since a cache from last week is exactly when
    // this would be wrong. Failure is silent: the check is a courtesy, and the
    // panel must still work with no network.
    void refreshContributions().then(fresh => { if (fresh) setContributions(fresh) })
  }, [])
  const wallNames = new Set(contributions.contributors.map(c => fold(c.displayName)))

  // Shown when they have typed a name someone else is already using, and again
  // as a question if they try to go ahead with it anyway.
  const [confirmingCollision, setConfirmingCollision] = useState(false)
  const [collisionAccepted, setCollisionAccepted] = useState(false)

  // A preset chosen in one currency is not a preset in the next -- 500 is a
  // sensible yen button and a strange euro one -- so changing currency drops
  // back to the default rather than carrying a number across.
  useEffect(() => { setAmount(null) }, [currency])

  const presets = monthly ? money.presetsMonthly : money.presets
  // The second preset is the default, which is where 5 euros used to be. Left
  // null until something is chosen rather than held as a number, so switching
  // currency does not leave a yen amount selected in dollars.
  const selected = amount ?? presets[1]

  // Checked as it's typed, so nobody discovers their chosen name was refused
  // only after paying. The same rules run again on the server, which is the
  // one that counts -- this is courtesy, not enforcement.
  const nameProblem = checkDisplayName(displayName)

  // The field is typed in units, because that is how people write money. It
  // becomes minor units here and stays that way.
  const typed = Number(customAmount.replace(',', '.'))
  const chosenMinor = customAmount.trim()
    ? (Number.isFinite(typed) ? Math.round(typed * per) : NaN)
    : selected
  const amountValid = Number.isFinite(chosenMinor)
    && chosenMinor >= money.min
    && chosenMinor <= money.max
    // HUF only, and checked here as well as on the server so the field says so
    // rather than the checkout page failing to open.
    && isAllowedStep(chosenMinor, currency)

  const taken = displayName.trim().length > 0 && wallNames.has(fold(displayName))
  const canGo = !busy && amountValid && !nameProblem && !!supabase

  const contribute = async () => {
    if (!canGo) return

    // Asked once. Answering "that was me" is a real answer and must not be
    // asked again on the next attempt.
    if (taken && !collisionAccepted) {
      setConfirmingCollision(true)
      return
    }

    setBusy(true)
    setError('')

    const result = await startContribution({
      amountCents: chosenMinor,
      monthly,
      displayName: displayName.trim(),
      currency,
    })

    if ('error' in result) {
      setError(result.error)
      setBusy(false)
      return
    }

    // Written down before the browser opens, so the app can find out how this
    // went. Checkout happens somewhere it cannot see -- another tab on web, a
    // whole other application on desktop -- and without this the app would
    // never learn that anyone donated at all.
    rememberPendingContribution(result.sessionId, displayName.trim())

    openExternalUrl(result.url)
    onStarted?.()
    onClose()
  }

  const field = 'w-full bg-transparent border border-nier-border/30 text-nier-bg py-2.5 text-sm tracking-wide placeholder-nier-bg/45 focus:border-nier-border/70 transition-colors'

  return (
    <div
      data-landing-theme={theme.resolved}
      className="donate-room fixed inset-0 z-[10000300] overflow-y-auto pointer-events-auto"
      data-ui-element
      data-lenis-prevent
      onClick={onClose}
    >
      {/* The one light, from above, as over the landing page's hall. */}
      <div aria-hidden="true" className="landing-skylight fixed inset-0 pointer-events-none" />

      <button
        type="button"
        onClick={onClose}
        aria-label={t('common.close')}
        className="fixed top-5 right-5 z-10 w-10 h-10 border border-nier-border/40 text-nier-bg/80 hover:text-nier-strong hover:border-nier-border/80 transition-colors"
        style={{ backgroundColor: 'rgb(var(--c-ground) / 0.7)' }}
      >
        ×
      </button>

      <div
        ref={room}
        role="dialog"
        aria-modal="true"
        aria-labelledby="donate-room-title"
        tabIndex={-1}
        onClick={event => event.stopPropagation()}
        className="relative max-w-[1100px] mx-auto px-5 sm:px-10 py-16 md:py-20 min-h-full flex items-center outline-none"
      >
        <div className="w-full grid md:grid-cols-[minmax(0,6fr)_minmax(0,5fr)] gap-12 md:gap-16 items-center">
          {/* Who is asking, and what it pays for -- before being asked. */}
          <div className="donate-rise-left">
            <RoomLabel>{t('support.title')}</RoomLabel>
            <p className="mt-8 text-[clamp(1.1rem,1.55vw,1.4rem)] font-extralight leading-[1.5] text-nier-strong text-pretty">
              <RichText text={t('support.who')} className="donate-emphasis" />
            </p>
            <p className="mt-6 text-nier-bg/75 leading-relaxed text-pretty">
              <RichText text={t('support.costs')} className="donate-emphasis" />
            </p>
            <p className="mt-4 text-nier-bg/75 leading-relaxed text-pretty">
              <RichText text={t('support.ask')} className="donate-emphasis" />
            </p>
            <h3 className="mt-10 mb-4 text-xs tracking-[0.2em] uppercase text-nier-bg/70">{t('support.connect')}</h3>
            <ConnectTiles columns={2} />
          </div>

          {/* The form, framed as the support chapter's panel is. */}
          <div className="donate-rise-right relative">
            <Brackets />
            <div className="relative border border-nier-border/30 p-6 sm:p-8" style={{ backgroundColor: 'rgb(var(--c-ground) / 0.75)' }}>
              {/* The question, asked before any money moves.

                  Two people under one name become one trace with both amounts
                  added together, and there is no account behind most
                  contributions to tell them apart. Caught here it costs a
                  question; caught after the payment it costs an email, a
                  reply, and a name that was wrong on the wall in the meantime.

                  Deliberately not a refusal. Donating again under the name you
                  already used is the ordinary case, and the whole point is
                  that only the contributor knows which of the two this is. */}
              {confirmingCollision && (
                <div className="absolute inset-0 z-10 p-6 sm:p-8 overflow-y-auto" style={{ backgroundColor: 'rgb(var(--c-ground))' }}>
                  <div className="flex items-center gap-4 text-xs tracking-[0.3em] uppercase mb-6" style={{ color: 'rgb(var(--c-danger))' }}>
                    <span aria-hidden="true" className="w-2.5 h-2.5 rotate-45 shrink-0 border" style={{ borderColor: 'currentColor' }} />
                    <h3>{t('donate.collisionTitle')}</h3>
                  </div>
                  <p className="text-lg font-extralight leading-snug mb-4" style={{ color: 'rgb(var(--c-danger))' }}>
                    {t('donate.collisionWho', { name: displayName.trim() })}
                  </p>
                  <p className="text-nier-bg/80 text-sm leading-relaxed mb-6">{t('donate.collisionWhy')}</p>
                  <button
                    type="button"
                    onClick={() => { setCollisionAccepted(true); setConfirmingCollision(false) }}
                    className="donate-confirm w-full py-3 text-xs tracking-[0.18em] uppercase"
                  >
                    {t('donate.collisionYes')}
                  </button>
                  <p className="text-nier-bg/70 text-xs tracking-wide mt-2 mb-5 leading-relaxed">{t('donate.collisionYesNote')}</p>
                  <button
                    type="button"
                    onClick={() => { setConfirmingCollision(false); setDisplayName('') }}
                    className="w-full py-3 border text-xs tracking-[0.18em] uppercase transition-colors"
                    style={{ borderColor: 'rgb(var(--c-danger) / 0.5)', color: 'rgb(var(--c-danger))' }}
                  >
                    {t('donate.collisionNo')}
                  </button>
                  <p className="text-nier-bg/70 text-xs tracking-wide mt-2 leading-relaxed">{t('donate.collisionNoNote')}</p>
                </div>
              )}

              <MonthLevel month={contributions.month} />

              {/* What paying gets you -- here is what your name joins -- and
                  then the form that joins it. */}
              <p className="mt-6 text-nier-bg/75 text-sm leading-relaxed text-pretty">{t('support.wall')}</p>
              <button
                type="button"
                onClick={() => {
                  onClose()
                  openContributors(currentRoutePath() || '/welcome')
                }}
                className="landing-link mt-1 text-xs tracking-[0.18em] uppercase"
              >
                {t('support.seeWall')} <span aria-hidden="true">→</span>
              </button>

              <div className="mt-7 mb-6 h-px" style={{ backgroundColor: 'rgb(var(--c-fg) / 0.14)' }} />

              <h3 id="donate-room-title" className="sr-only">{t('donate.heading')}</h3>

              {/* One-off or monthly */}
              <div className="donate-bento grid grid-cols-2 mb-6">
                {[false, true].map(isMonthly => (
                  <Choice key={String(isMonthly)} chosen={monthly === isMonthly} onPick={() => { setMonthly(isMonthly); setCustomAmount('') }} className="text-xs uppercase">
                    {isMonthly ? t('donate.monthlyOption') : t('donate.oneOff')}
                  </Choice>
                ))}
              </div>

              {/* The picker sits on the Amount row rather than at the top of
                  the panel, because it is part of choosing the amount: the
                  presets under it are denominated by it and change when it
                  does. */}
              <div className="flex items-end justify-between gap-3 mb-3">
                <label htmlFor="donate-other-amount" className="block text-nier-bg/70 text-xs tracking-[0.2em] uppercase">{t('donate.amount')}</label>
                <CurrencyToggle />
              </div>
              <div className="donate-bento grid grid-cols-4 mb-3">
                {presets.map(preset => (
                  <Choice key={preset} chosen={!customAmount.trim() && selected === preset} onPick={() => { setAmount(preset); setCustomAmount('') }} className="text-sm tabular-nums">
                    {format(preset, { whole: true })}
                  </Choice>
                ))}
              </div>

              {/* The symbol sits inside the field rather than in the
                  placeholder, so it is still there once something has been
                  typed over it. The table's symbol, not Intl's: this one has
                  to sit to the LEFT of a field whatever the language. */}
              <div className="relative">
                <span className="absolute left-4 top-1/2 -translate-y-1/2 text-nier-bg/70 text-sm pointer-events-none">{money.symbol}</span>
                <input
                  id="donate-other-amount"
                  type="text"
                  inputMode="decimal"
                  value={customAmount}
                  onChange={e => setCustomAmount(e.target.value)}
                  placeholder={t('donate.otherAmount')}
                  className={`${field} pr-4 ${money.symbol.length > 1 ? 'pl-14' : 'pl-9'}`}
                />
              </div>
              {customAmount.trim() && !amountValid && (
                <p className="text-xs tracking-wide mt-2" style={{ color: 'rgb(var(--c-danger))' }}>
                  {t('donate.minimum', { amount: format(money.min, { whole: true }) })}
                </p>
              )}

              {/* "Optional" answers whether you have to fill it in, not what
                  happens if you do. The question mark carries the rest, on
                  hover over either the label or the field -- and gets out of
                  the way the moment somebody starts typing. */}
              <div className="name-field relative mt-6" data-typing={nameFocused ? 'true' : 'false'}>
                <label htmlFor="donate-display-name" className="flex items-center gap-1.5 text-nier-bg/70 text-xs tracking-[0.2em] uppercase mb-3 w-fit">
                  {t('donate.nameLabel')} — {t('donate.nameOptional')}
                  <span className="name-hint-mark" aria-hidden="true">?</span>
                </label>
                <input
                  id="donate-display-name"
                  type="text"
                  value={displayName}
                  onChange={e => { setDisplayName(e.target.value); setCollisionAccepted(false) }}
                  onFocus={() => setNameFocused(true)}
                  onBlur={() => setNameFocused(false)}
                  placeholder={t('donate.namePlaceholder')}
                  maxLength={60}
                  aria-describedby="donate-display-name-help"
                  className={`${field} px-4`}
                />
                <span className="name-bubble" id="donate-display-name-help" role="tooltip">
                  <span>
                    {t('donate.nameHelp')}
                    <span className="name-bubble-note">{t('donate.nameHelpNote')}</span>
                  </span>
                </span>
              </div>
              {nameProblem ? (
                <p className="text-xs tracking-wide mt-2" style={{ color: 'rgb(var(--c-danger))' }}>
                  {t(nameProblem.key, nameProblem.key === 'donate.errNameLength' ? { max: nameProblem.max } : undefined)}
                </p>
              ) : taken ? (
                <p className="text-xs tracking-wide mt-2 font-bold leading-relaxed" style={{ color: 'rgb(var(--c-danger))' }}>
                  {t('donate.takenShort', { name: displayName.trim() })}
                </p>
              ) : (
                <p className="text-nier-bg/65 text-xs tracking-wide mt-2 leading-relaxed">{t('donate.nameChecked')}</p>
              )}

              {error && (
                <p className="mt-5 border p-3 text-xs tracking-wide" style={{ borderColor: 'rgb(var(--c-danger) / 0.45)', color: 'rgb(var(--c-danger))' }}>{error}</p>
              )}

              {/* The landing page's own Donate button. Exact, not rounded like
                  the presets: it names what is about to be charged, and
                  "Donate $8" over a typed 7.50 misstates it. */}
              <DonateButton
                onClick={contribute}
                disabled={!canGo}
                label={busy ? t('donate.opening') : t(monthly ? 'donate.submitMonthly' : 'donate.submit', { amount: format(Number.isFinite(chosenMinor) ? chosenMinor : 0) })}
                tooltip={false}
                wrapperClassName="w-full mt-7"
                className="w-full py-3.5 text-xs"
              />

              {/* Who takes the card, and whether monthly can be stopped. */}
              <p className="text-nier-bg/65 text-xs tracking-wide mt-3 leading-relaxed">{t('donate.stripeNote')}</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
