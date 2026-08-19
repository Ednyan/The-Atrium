import { useState } from 'react'
import { supabase } from '../lib/supabase'
import { openExternalUrl } from '../lib/openExternal'
import { checkDisplayName, startContribution } from '../lib/donate'
import { rememberPendingContribution } from '../lib/pendingContribution'

interface ContributePanelProps {
  onClose: () => void
  // Called once checkout has been opened, so the caller can record that the
  // appeal was answered by contributing rather than dismissed.
  onStarted?: () => void
}

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

  const presets = monthly ? PRESETS_MONTHLY : PRESETS_ONE_TIME

  // Checked as it's typed, so nobody discovers their chosen name was refused
  // only after paying. The same rules run again on the server, which is the
  // one that counts -- this is courtesy, not enforcement.
  const nameProblem = checkDisplayName(displayName)

  const chosenAmount = customAmount.trim() ? Number(customAmount.replace(',', '.')) : amount
  const amountValid = Number.isFinite(chosenAmount) && chosenAmount >= 1

  const contribute = async () => {
    if (!amountValid || nameProblem) return
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
    <div className="fixed inset-0 bg-nier-black/85 flex items-center justify-center z-[10000300] pointer-events-auto" data-ui-element>
      <div className="bg-nier-blackLight border border-nier-border/40 p-6 max-w-md w-full mx-4 relative max-h-[85vh] overflow-y-auto">
        <div className="absolute top-0 left-0 w-4 h-4 border-l border-t border-nier-border/60" />
        <div className="absolute top-0 right-0 w-4 h-4 border-r border-t border-nier-border/60" />
        <div className="absolute bottom-0 left-0 w-4 h-4 border-l border-b border-nier-border/60" />
        <div className="absolute bottom-0 right-0 w-4 h-4 border-r border-b border-nier-border/60" />

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

        <input
          type="text"
          inputMode="decimal"
          value={customAmount}
          onChange={e => setCustomAmount(e.target.value)}
          placeholder="Or another amount"
          className="w-full px-4 py-2 bg-nier-black border border-nier-border/30 text-nier-bg text-sm tracking-wide placeholder-nier-bg/50 focus:border-nier-border/60 transition-colors mb-1"
        />
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
          onChange={e => setDisplayName(e.target.value)}
          placeholder="Leave empty to stay anonymous"
          maxLength={60}
          className="w-full px-4 py-2 bg-nier-black border border-nier-border/30 text-nier-bg text-sm tracking-wide placeholder-nier-bg/50 focus:border-nier-border/60 transition-colors"
        />
        {nameProblem ? (
          <p className="text-[9px] tracking-wider mt-2" style={{ color: '#FF6161' }}>{nameProblem}</p>
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
