import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { openExternalUrl } from '../lib/openExternal'
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

const PRESETS_ONE_TIME = [3, 5, 10, 25]
const PRESETS_MONTHLY = [1, 3, 5, 10]

// Choosing an amount, and where to send it.
//
// Checkout is Stripe's own page, opened in a browser: the app never touches a
// card number, a Stripe key, or anything that would make this screen worth
// attacking. All it does is ask for three things and hand them to the Edge
// Function that builds the session.
export default function ContributePanel({ onClose, onStarted }: ContributePanelProps) {
  const [monthly, setMonthly] = useState(false)
  const [amount, setAmount] = useState(5)
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

  const presets = monthly ? PRESETS_MONTHLY : PRESETS_ONE_TIME

  // Checked as it's typed, so nobody discovers their chosen name was refused
  // only after paying. The same rules run again on the server, which is the
  // one that counts -- this is courtesy, not enforcement.
  const nameProblem = checkDisplayName(displayName)

  const chosenAmount = customAmount.trim() ? Number(customAmount.replace(',', '.')) : amount
  const amountValid = Number.isFinite(chosenAmount) && chosenAmount >= 1

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
      amountCents: Math.round(chosenAmount * 100),
      monthly,
      displayName: displayName.trim(),
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
    rememberPendingContribution(result.sessionId)

    openExternalUrl(result.url)
    onStarted?.()
    onClose()
  }

  return (
    <div className="modal-backdrop fixed inset-0 bg-nier-black/85 flex items-center justify-center z-[10000300] pointer-events-auto" data-ui-element>
      <div className="bg-nier-blackLight border border-nier-border/40 p-6 max-w-md w-full mx-4 relative max-h-[85vh] overflow-y-auto">
        <div className="absolute top-0 left-0 w-4 h-4 border-l border-t border-nier-border/60" />
        <div className="absolute top-0 right-0 w-4 h-4 border-r border-t border-nier-border/60" />
        <div className="absolute bottom-0 left-0 w-4 h-4 border-l border-b border-nier-border/60" />
        <div className="absolute bottom-0 right-0 w-4 h-4 border-r border-b border-nier-border/60" />

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
                That name is taken
              </h3>
            </div>

            <p className="text-sm tracking-wide leading-relaxed font-bold mb-4" style={{ color: '#FF6161' }}>
              Someone is already on the contributors wall as “{displayName.trim()}”.
            </p>

            <p className="text-nier-bg/80 text-xs tracking-wide leading-relaxed mb-6">
              The wall shows one trace per name. If you donate under this one, your
              amount is added to theirs and you appear as a single contributor — so
              please only continue if that earlier donation was yours.
            </p>

            <button
              type="button"
              onClick={() => { setCollisionAccepted(true); setConfirmingCollision(false) }}
              className="w-full py-3 bg-nier-bg text-nier-black text-[10px] tracking-[0.15em] uppercase hover:bg-nier-bgDark transition-colors"
            >
              Yes, that was me
            </button>
            <p className="text-nier-bg/70 text-[9px] tracking-wider mt-2 mb-5 leading-relaxed">
              Your donations are added together under the one name.
            </p>

            <button
              type="button"
              onClick={() => { setConfirmingCollision(false); setDisplayName('') }}
              className="w-full py-3 border text-[10px] tracking-[0.15em] uppercase transition-colors"
              style={{ borderColor: 'rgba(255,97,97,0.5)', color: '#FF6161' }}
            >
              No — I'll choose another name
            </button>
            <p className="text-nier-bg/70 text-[9px] tracking-wider mt-2 leading-relaxed">
              Takes you back to pick a name of your own.
            </p>
          </div>
        )}

        <div className="flex items-center gap-3 mb-5">
          <div className="w-1.5 h-1.5 rotate-45 border border-nier-border/60" />
          <h3 className="text-nier-bg tracking-[0.15em] uppercase">Donate</h3>
        </div>

        {/* One-off or monthly */}
        <div className="flex gap-2 mb-5">
          {[false, true].map(isMonthly => (
            <button
              key={String(isMonthly)}
              type="button"
              onClick={() => { setMonthly(isMonthly); setCustomAmount('') }}
              className={`flex-1 py-2 text-[10px] tracking-[0.15em] uppercase border transition-colors ${
                monthly === isMonthly
                  ? 'bg-nier-bg text-nier-black border-nier-bg'
                  : 'border-nier-border/30 text-nier-bg/80 hover:border-nier-border/60 hover:text-nier-bg'
              }`}
            >
              {isMonthly ? 'Monthly' : 'One-off'}
            </button>
          ))}
        </div>

        <label className="block text-nier-bg/80 text-[9px] tracking-[0.15em] uppercase mb-2">Amount</label>
        <div className="flex gap-2 mb-3">
          {presets.map(preset => (
            <button
              key={preset}
              type="button"
              onClick={() => { setAmount(preset); setCustomAmount('') }}
              className={`flex-1 py-2 text-[11px] tracking-wider border transition-colors ${
                !customAmount.trim() && amount === preset
                  ? 'bg-nier-bg text-nier-black border-nier-bg'
                  : 'border-nier-border/30 text-nier-bg/80 hover:border-nier-border/60 hover:text-nier-bg'
              }`}
            >
              €{preset}
            </button>
          ))}
        </div>

        {/* The euro sits inside the field rather than in the placeholder, so it
            is still there once something has been typed over it. A bare number
            in a box that takes money reads as unfinished. */}
        <div className="relative mb-1">
          <span className="absolute left-4 top-1/2 -translate-y-1/2 text-nier-bg/70 text-sm pointer-events-none">
            €
          </span>
          <input
            type="text"
            inputMode="decimal"
            value={customAmount}
            onChange={e => setCustomAmount(e.target.value)}
            placeholder="Another amount"
            className="w-full pl-9 pr-4 py-2 bg-nier-black border border-nier-border/30 text-nier-bg text-sm tracking-wide placeholder-nier-bg/50 focus:border-nier-border/60 transition-colors"
          />
        </div>
        {customAmount.trim() && !amountValid && (
          <p className="text-[9px] tracking-wider mb-2" style={{ color: '#FF6161' }}>
            The minimum is €1.
          </p>
        )}

        <label className="block text-nier-bg/80 text-[9px] tracking-[0.15em] uppercase mt-4 mb-2">
          Name for the contributors page — optional
        </label>
        <input
          type="text"
          value={displayName}
          onChange={e => { setDisplayName(e.target.value); setCollisionAccepted(false) }}
          placeholder="Leave empty to stay anonymous"
          maxLength={60}
          className="w-full px-4 py-2 bg-nier-black border border-nier-border/30 text-nier-bg text-sm tracking-wide placeholder-nier-bg/50 focus:border-nier-border/60 transition-colors"
        />
        {nameProblem ? (
          <p className="text-[9px] tracking-wider mt-2" style={{ color: '#FF6161' }}>{nameProblem}</p>
        ) : taken ? (
          <p className="text-[10px] tracking-wider mt-2 font-bold leading-relaxed" style={{ color: '#FF6161' }}>
            Someone is already listed as “{displayName.trim()}”. If that was you, carry
            on — otherwise please choose a different name.
          </p>
        ) : (
          <p className="text-nier-bg/70 text-[9px] tracking-wider mt-2 leading-relaxed">
            Shown with the total you've donated and the month you started. Checked by a
            person before it appears — if it's offensive, or can't be used for some
            other reason, you'll hear why by email. Leave it empty and your donation
            stays anonymous.
          </p>
        )}

        {error && (
          <div className="bg-red-900/20 border border-red-500/40 p-3 mt-4">
            <p className="text-red-400 text-[10px] tracking-wide">{error}</p>
          </div>
        )}

        <button
          type="button"
          onClick={contribute}
          disabled={busy || !amountValid || !!nameProblem || !supabase}
          className="w-full mt-5 py-3 bg-nier-bg text-nier-black text-[10px] tracking-[0.15em] uppercase hover:bg-nier-bgDark transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
        >
          {busy ? 'Opening…' : monthly ? `Donate €${chosenAmount || 0} monthly` : `Donate €${chosenAmount || 0}`}
        </button>

        <p className="text-nier-bg/70 text-[9px] tracking-wider mt-3 leading-relaxed">
          Payment is handled by Stripe, in your browser. Cards, PayPal, Apple Pay,
          Google Pay and local methods where they exist. Monthly can be cancelled
          any time from the receipt Stripe emails you.
        </p>

        <button
          type="button"
          onClick={onClose}
          className="w-full mt-4 py-2 border border-nier-border/30 text-nier-bg/80 text-[10px] tracking-[0.15em] uppercase hover:border-nier-border/60 hover:text-nier-bg transition-colors"
        >
          Close
        </button>
      </div>
    </div>
  )
}
