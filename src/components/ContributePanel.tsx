import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { openExternalUrl } from '../lib/openExternal'
import SupportCreatorCard from './SupportCreatorCard'
import { openContributors } from '../lib/contributorsRoute'
import { DONATE_CUT } from './DonateButton'
import { useTranslation } from '../lib/i18n'
import { useCurrency, currencyByCode, minorPerUnit, isAllowedStep } from '../lib/currency'
import CurrencyToggle from './CurrencyToggle'
import { checkDisplayName, startContribution } from '../lib/donate'
import { rememberPendingContribution } from '../lib/pendingContribution'
import { getCachedContributions, refreshContributions } from '../lib/contributions'

interface ContributePanelProps {
  onClose: () => void
  // Called once checkout has been opened, so the caller can record that the
  // appeal was answered by contributing rather than dismissed.
  onStarted?: () => void
}

// Case and accents folded: "ines" and "Inês" are the same name to anyone
// reading the wall, and warning about one but not the other would be arbitrary.
const fold = (value: string) =>
  value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim()


// Choosing an amount, and where to send it.
//
// Checkout is Stripe's own page, opened in a browser: the app never touches a
// card number, a Stripe key, or anything that would make this screen worth
// attacking. All it does is ask for three things and hand them to the Edge
// Function that builds the session.
export default function ContributePanel({ onClose, onStarted }: ContributePanelProps) {
  const { t } = useTranslation()
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

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
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

  // Names already on the wall, so a collision is caught here rather than by the
  // operator after the money has arrived.
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
  const [wallNames, setWallNames] = useState<Set<string>>(new Set())
  useEffect(() => {
    const load = (names: string[]) => setWallNames(new Set(names.map(fold)))
    load(getCachedContributions().contributors.map(c => c.displayName))
    // Then the current list, since a cache from last week is exactly when this
    // would be wrong. Failure is silent: the check is a courtesy, and the panel
    // must still work with no network.
    void refreshContributions().then(fresh => {
      if (fresh) load(fresh.contributors.map(c => c.displayName))
    })
  }, [])

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

  const contribute = async () => {
    if (!amountValid || nameProblem) return

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

  return (
    <div
      className="modal-backdrop fixed inset-0 bg-nier-black/85 flex items-center justify-center z-[10000300] p-4 overflow-y-auto pointer-events-auto"
      data-ui-element
      onClick={onClose}
    >
      {/* Two cards, dealt from one.

          They arrive stacked in the middle with Support on top, hold for a
          beat so it can be read as the thing being offered, then part -- which
          is what says there was a second card there all along rather than two
          panels appearing at once. Side by side only where there is room; on a
          narrow screen they stack, Support first, and the deal is dropped
          because there is nowhere to deal to. */}
      <div className="flex flex-col items-center gap-5 w-full max-w-md lg:max-w-[58rem]">
        {/* Equal heights: the pair is one object, and one card ending two
            inches above the other made it look like two panels that happened
            to be next to each other. Each still scrolls inside itself once the
            row hits 85vh. */}
        <div
          className="flex flex-col lg:flex-row lg:items-stretch justify-center gap-5 w-full"
          onClick={event => event.stopPropagation()}
        >
        <SupportCreatorCard />

        <div className="donate-card-right donate-card bg-nier-blackLight border p-6 w-full lg:max-w-md relative max-h-[85vh] overflow-y-auto">
        <div className="corner absolute top-0 left-0 w-4 h-4 border-l border-t" />
        <div className="corner absolute top-0 right-0 w-4 h-4 border-r border-t" />
        <div className="corner absolute bottom-0 left-0 w-4 h-4 border-l border-b" />
        <div className="corner absolute bottom-0 right-0 w-4 h-4 border-r border-b" />

        {/* The question, asked before any money moves.

            Two people under one name become one trace with both amounts added
            together, and there is no account behind most contributions to tell
            them apart. Caught here it costs a question; caught after the
            payment it costs an email, a reply, and a name that was wrong on the
            wall in the meantime.

            Deliberately not a refusal. Donating again under the name you
            already used is the ordinary case, and the whole point is that only
            the contributor knows which of the two this is. */}
        {confirmingCollision && (
          <div className="absolute inset-0 bg-nier-blackLight z-10 p-6 overflow-y-auto">
            <div className="flex items-center gap-3 mb-5">
              <div className="w-1.5 h-1.5 rotate-45 border" style={{ borderColor: '#FF6161' }} />
              <h3 className="tracking-[0.15em] uppercase" style={{ color: '#FF6161' }}>
                {t('donate.collisionTitle')}
              </h3>
            </div>

            <p className="text-sm tracking-wide leading-relaxed font-bold mb-4" style={{ color: '#FF6161' }}>
              {t('donate.collisionWho', { name: displayName.trim() })}
            </p>

            <p className="text-nier-bg/80 text-sm tracking-wide leading-relaxed mb-6">
              {t('donate.collisionWhy')}
            </p>

            <button
              type="button"
              onClick={() => { setCollisionAccepted(true); setConfirmingCollision(false) }}
              className="w-full py-3 bg-nier-bg text-nier-black text-xs tracking-[0.15em] uppercase hover:bg-nier-strong transition-colors"
            >
              {t('donate.collisionYes')}
            </button>
            <p className="text-nier-bg/70 text-xs tracking-wider mt-2 mb-5 leading-relaxed">
              {t('donate.collisionYesNote')}
            </p>

            <button
              type="button"
              onClick={() => { setConfirmingCollision(false); setDisplayName('') }}
              className="w-full py-3 border text-xs tracking-[0.15em] uppercase transition-colors"
              style={{ borderColor: 'rgba(255,97,97,0.5)', color: '#FF6161' }}
            >
              {t('donate.collisionNo')}
            </button>
            <p className="text-nier-bg/70 text-xs tracking-wider mt-2 leading-relaxed">
              {t('donate.collisionNoNote')}
            </p>
          </div>
        )}

        {/* What paying gets you, before being asked to pay.

            This sat under the submit button, on the argument that an outcome
            belongs next to the action that causes it. But there it reads as a
            footnote to a decision already made: by the time anyone reached it
            they had picked an amount and typed a name, and the reason for
            doing either was still further down the card. Above the heading it
            is the invitation rather than the receipt -- here is what your name
            joins, and then the form that joins it. */}
        <div className="support-well border p-4 mb-5">
          <p className="text-nier-bg/75 text-xs tracking-wide leading-relaxed mb-3">
            {t('support.wall')}
          </p>
          <button
            type="button"
            onClick={() => {
              onClose()
              openContributors(window.location.hash.replace(/^#/, '') || '/welcome')
            }}
            className="support-action w-full py-2.5 border text-[11px] tracking-[0.15em] uppercase"
            style={{ clipPath: DONATE_CUT }}
          >
            ◇ {t('support.seeWall')}
          </button>
        </div>

        <div className="flex items-center gap-3 mb-5">
          <div className="byline-mark w-2 h-2 rotate-45" />
          <h3 className="support-orange tracking-[0.15em] uppercase">{t('donate.heading')}</h3>
          <div className="support-rule flex-1 h-px" />
        </div>

        {/* One-off or monthly */}
        <div className="flex gap-2 mb-5">
          {[false, true].map(isMonthly => (
            <button
              key={String(isMonthly)}
              type="button"
              onClick={() => { setMonthly(isMonthly); setCustomAmount('') }}
              className={`flex-1 py-2 text-xs tracking-[0.15em] uppercase border transition-colors ${
                monthly === isMonthly
                  ? 'donate-chosen'
                  : 'border-nier-border/30 text-nier-bg/80 hover:border-nier-border/60 hover:text-nier-bg'
              }`}
            >
              {isMonthly ? t('donate.monthlyOption') : t('donate.oneOff')}
            </button>
          ))}
        </div>

        {/* The picker sits on the Amount row rather than at the top of the
            panel, because it is part of choosing the amount: the presets under
            it are denominated by it and change when it does. */}
        <div className="flex items-end justify-between gap-3 mb-2">
          <label className="block text-nier-bg/80 text-xs tracking-[0.15em] uppercase">{t('donate.amount')}</label>
          <CurrencyToggle />
        </div>
        <div className="flex gap-2 mb-3">
          {presets.map(preset => (
            <button
              key={preset}
              type="button"
              onClick={() => { setAmount(preset); setCustomAmount('') }}
              className={`flex-1 py-2 text-sm tracking-wider border transition-colors ${
                !customAmount.trim() && selected === preset
                  ? 'donate-chosen'
                  : 'border-nier-border/30 text-nier-bg/80 hover:border-nier-border/60 hover:text-nier-bg'
              }`}
            >
              {format(preset, { whole: true })}
            </button>
          ))}
        </div>

        {/* The symbol sits inside the field rather than in the placeholder, so
            it is still there once something has been typed over it. A bare
            number in a box that takes money reads as unfinished.

            The table's symbol, not Intl's: this one has to sit to the LEFT of
            a field whatever the language, where Intl would put it after the
            number in French and leave the field labelled with nothing. */}
        <div className="relative mb-1">
          <span className="absolute left-4 top-1/2 -translate-y-1/2 text-nier-bg/70 text-sm pointer-events-none">
            {money.symbol}
          </span>
          <input
            type="text"
            inputMode="decimal"
            value={customAmount}
            onChange={e => setCustomAmount(e.target.value)}
            placeholder={t('donate.otherAmount')}
            className={`w-full pr-4 py-2 bg-nier-black border border-nier-border/30 text-nier-bg text-sm tracking-wide placeholder-nier-bg/50 focus:border-nier-border/60 transition-colors ${
              money.symbol.length > 1 ? 'pl-14' : 'pl-9'
            }`}
          />
        </div>
        {customAmount.trim() && !amountValid && (
          <p className="text-xs tracking-wider mb-2" style={{ color: '#FF6161' }}>
            {t('donate.minimum', { amount: format(money.min, { whole: true }) })}
          </p>
        )}

        {/* "Optional" answers whether you have to fill it in, not what
            happens if you do. The question mark carries the rest, on hover
            over either the label or the field -- and gets out of the way the
            moment somebody starts typing, because an explanation floating
            over the thing you are doing is in the way rather than helpful. */}
        <div className="name-field relative mt-4" data-typing={nameFocused ? 'true' : 'false'}>
          <label
            htmlFor="donate-display-name"
            className="flex items-center gap-1.5 text-nier-bg/80 text-xs tracking-[0.15em] uppercase mb-2 w-fit"
          >
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
            className="w-full px-4 py-2 bg-nier-black border border-nier-border/30 text-nier-bg text-sm tracking-wide placeholder-nier-bg/50 focus:border-nier-border/60 transition-colors"
          />
          <span className="name-bubble" id="donate-display-name-help" role="tooltip">
            <span>
              {t('donate.nameHelp')}
              <span className="name-bubble-note">{t('donate.nameHelpNote')}</span>
            </span>
          </span>
        </div>
        {nameProblem ? (
          <p className="text-xs tracking-wider mt-2" style={{ color: '#FF6161' }}>
            {t(nameProblem.key, nameProblem.key === 'donate.errNameLength' ? { max: nameProblem.max } : undefined)}
          </p>
        ) : taken ? (
          <p className="text-xs tracking-wide mt-2 font-bold leading-relaxed" style={{ color: 'rgb(var(--c-danger))' }}>
            {t('donate.takenShort', { name: displayName.trim() })}
          </p>
        ) : (
          // Four sentences became one line.
          //
          // Everything the old copy said was true and none of it was needed
          // before paying: that a person checks the name matters at the moment
          // it is refused, not now, and the refusal email says so itself.
          // "Leave empty to stay anonymous" is the only part that changes what
          // somebody does next, and the field's own placeholder already says
          // it -- so this says the one thing the placeholder cannot.
          <p className="text-nier-bg/70 text-xs tracking-wide mt-2 leading-relaxed">
            {t('donate.nameChecked')}
          </p>
        )}

        {error && (
          <div className="bg-red-900/20 border border-red-500/40 p-3 mt-4">
            <p className="text-red-400 text-xs tracking-wide">{error}</p>
          </div>
        )}

        <button
          type="button"
          onClick={contribute}
          disabled={busy || !amountValid || !!nameProblem || !supabase}
          className="donate-commit w-full mt-5 py-3 text-xs tracking-[0.15em] uppercase disabled:opacity-30 disabled:cursor-not-allowed"
        >
          {/* Exact, not rounded like the preset buttons above: this one names
              what is about to be charged, and "Donate $8" over a typed 7.50 is
              a button that misstates the amount it is taking. */}
          {busy ? t('donate.opening') : t(monthly ? 'donate.submitMonthly' : 'donate.submit', { amount: format(Number.isFinite(chosenMinor) ? chosenMinor : 0) })}
        </button>

        {/* Was a paragraph listing every payment method by name, which nobody
            reads and Stripe's own page shows a second later anyway. What
            remains answers the real hesitation: who takes the card, and
            whether monthly can be stopped. */}
        <p className="text-nier-bg/70 text-xs tracking-wide mt-3 leading-relaxed">
          {t('donate.stripeNote')}
        </p>

        </div>
        </div>

        {/* Under both cards rather than inside one of them. It closes the
            whole thing, so belonging to either card was a small lie about
            what it does. */}
        <button
          type="button"
          onClick={onClose}
          className="px-10 py-2.5 border border-nier-border/40 text-nier-bg/80 text-xs tracking-[0.18em] uppercase hover:border-nier-border/70 hover:text-nier-strong transition-colors"
          style={{ clipPath: DONATE_CUT, backgroundColor: 'rgb(var(--c-ground) / 0.6)' }}
        >
          {t('common.close')}
        </button>
      </div>
    </div>
  )
}
