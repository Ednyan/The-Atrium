import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import {
  SEED_PRESETS,
  clearSeededContributors,
  seedContributors,
} from '../lib/seedContributors'

interface NameApprovalPanelProps {
  onClose: () => void
  // How many fake contributors are currently drawn on the wall behind this,
  // and how to tell it that the number changed.
  seededCount: number
  onSeedChanged: () => void
}

interface Entry {
  id: string
  display_name: string
  kind: string
  name_approved: boolean
  name_rejected_reason: string | null
  hidden: boolean
  refunded: boolean
  settled_eur_cents: number
  created_at: string
}

// Moderating the contributors wall.
//
// Only the operator ever sees the button that opens this, but that is
// presentation. The Edge Function behind it re-establishes who is asking on
// every single request, because a hidden button is not a permission -- anyone
// can call the URL. If this were somehow rendered for someone else they would
// get an empty list and a 403 for every action.
const DECIDED_SHOWN = 15

const euros = (cents: number) => Math.round((cents ?? 0) / 100)

// Case and accents removed, for deciding whether two names would be taken for
// each other by someone reading the wall.
const fold = (value: string) =>
  value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim()

const formatDate = (iso: string) =>
  new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' })

// For a date input, which wants exactly this and nothing else.
const toDateInput = (iso: string) => {
  const date = new Date(iso)
  return Number.isNaN(date.getTime()) ? '' : date.toISOString().slice(0, 10)
}

export default function NameApprovalPanel({ onClose, seededCount, onSeedChanged }: NameApprovalPanelProps) {
  const [entries, setEntries] = useState<Entry[] | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  // The one being rejected, and the one being edited. Separate because they are
  // different conversations with the operator.
  const [rejecting, setRejecting] = useState<Entry | null>(null)
  const [editing, setEditing] = useState<Entry | null>(null)
  const [deleting, setDeleting] = useState<Entry | null>(null)
  const [messaging, setMessaging] = useState<Entry | null>(null)

  const call = async (action: string, body: Record<string, unknown> = {}) => {
    const baseUrl = import.meta.env.VITE_SUPABASE_URL
    const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY
    const { data: { session } } = await supabase!.auth.getSession()

    const response = await fetch(`${baseUrl}/functions/v1/moderate-contributors`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: anonKey,
        // The caller's own token, not the anon key: this is what the function
        // reads to work out who is asking.
        Authorization: `Bearer ${session?.access_token ?? anonKey}`,
      },
      body: JSON.stringify({ action, ...body }),
    })

    const result = await response.json().catch(() => null)
    if (!response.ok) throw new Error(result?.error || 'Request failed')
    return result
  }

  const load = () => {
    call('list')
      .then(body => setEntries(body.entries ?? []))
      .catch(e => { setError(e.message); setEntries([]) })
  }

  useEffect(load, [])

  const run = async (id: string, work: () => Promise<any>) => {
    setBusyId(id)
    setError('')
    setNotice('')
    try {
      const result = await work()
      if (result?.refundError) setError(`Refund failed: ${result.refundError}`)
      else if (result?.refunded) setNotice('Rejected, and the contribution was refunded.')
      load()
    } catch (e: any) {
      setError(e.message)
    } finally {
      setBusyId(null)
    }
  }

  // A refunded contribution is out of every public view already, so asking the
  // operator to approve or hide it is asking about something that can never
  // appear. It gets its own section instead: still here, because the row is the
  // local record that money arrived and went back -- what makes the totals
  // reconcilable against Stripe, and what stops a redelivered webhook counting
  // the payment twice. Delete is available there for anyone who wants it gone
  // regardless.
  const all = entries ?? []
  const waiting = all.filter(e => !e.name_approved && !e.name_rejected_reason && !e.refunded)
  const shown = all.filter(e => e.name_approved && !e.refunded)
  const refunded = all.filter(e => e.refunded)
  const decidedAll = all.filter(e => e.name_rejected_reason && !e.refunded)
  const decided = decidedAll.slice(0, DECIDED_SHOWN)

  // Two people who choose the same name become one trace with their amounts
  // added together -- the wall groups by the name, because most contributors
  // have no account to be told apart by. That is a decision made here, at
  // approval, or not at all: once both are on the wall there is no undoing the
  // merge without editing one of them.
  //
  // So the collision is put in front of the operator instead of being left to
  // be noticed. Exact matches are the ones that actually merge; near matches
  // are flagged separately because two traces reading "Ana" and "ana" are a
  // different problem -- not merged, just indistinguishable.
  const exactWall = new Set(shown.map(e => e.display_name.trim()))
  const looseWall = new Map(shown.map(e => [fold(e.display_name), e.display_name] as const))

  const collisionFor = (entry: Entry): string | null => {
    const trimmed = entry.display_name.trim()
    if (exactWall.has(trimmed)) {
      return `"${trimmed}" is already on the wall. Approving this merges the two into one trace with both amounts added together.`
    }

    const near = looseWall.get(fold(entry.display_name))
    if (near) return `Nearly identical to "${near}", already on the wall.`

    // Two still waiting, which is the same collision one step earlier.
    const twin = waiting.find(other => other.id !== entry.id && fold(other.display_name) === fold(entry.display_name))
    if (twin) return 'Another contribution is waiting under this same name.'

    return null
  }

  return (
    <div className="modal-backdrop fixed inset-0 bg-nier-black/80 flex items-center justify-center z-[10000200] pointer-events-auto" data-ui-element>
      <div className="bg-nier-blackLight border border-nier-border/40 p-6 max-w-xl w-full mx-4 relative max-h-[85vh] overflow-y-auto">
        <div className="absolute top-0 left-0 w-4 h-4 border-l border-t border-nier-border/60" />
        <div className="absolute top-0 right-0 w-4 h-4 border-r border-t border-nier-border/60" />
        <div className="absolute bottom-0 left-0 w-4 h-4 border-l border-b border-nier-border/60" />
        <div className="absolute bottom-0 right-0 w-4 h-4 border-r border-b border-nier-border/60" />

        <div className="flex items-center gap-3 mb-5">
          <div className="w-1.5 h-1.5 rotate-45 border border-nier-border/60" />
          <h3 className="text-nier-bg tracking-[0.15em] uppercase">Contributor Names</h3>
        </div>

        {entries === null && <p className="text-nier-bg/70 text-[10px] tracking-wider uppercase">Loading…</p>}

        {/* Waiting on a decision */}
        {entries !== null && (
          <>
            <SectionHeading label="Waiting" count={waiting.length} />
            {waiting.length === 0 && (
              <p className="text-nier-bg/70 text-[10px] tracking-wider uppercase mb-4">Nothing waiting.</p>
            )}
            <div className="space-y-2 mb-5">
              {waiting.map(entry => (
                <Row key={entry.id} entry={entry} warning={collisionFor(entry)}>
                  <Action
                    label="Approve"
                    primary
                    disabled={busyId === entry.id}
                    onClick={() => run(entry.id, () => call('approve', { id: entry.id }))}
                  />
                  <Action label="Write" disabled={busyId === entry.id} onClick={() => setMessaging(entry)} />
                  <Action label="Reject" disabled={busyId === entry.id} onClick={() => setRejecting(entry)} />
                </Row>
              ))}
            </div>
          </>
        )}

        {/* On the wall */}
        {shown.length > 0 && (
          <>
            <SectionHeading label="On the wall" count={shown.length} />
            <div className="space-y-2 mb-5">
              {shown.map(entry => (
                <Row key={entry.id} entry={entry}>
                  <Action
                    label={entry.hidden ? 'Unhide' : 'Hide'}
                    disabled={busyId === entry.id}
                    onClick={() => run(entry.id, () => call(entry.hidden ? 'unhide' : 'hide', { id: entry.id }))}
                  />
                  <Action label="Edit" disabled={busyId === entry.id} onClick={() => setEditing(entry)} />
                  <Action label="Delete" danger disabled={busyId === entry.id} onClick={() => setDeleting(entry)} />
                </Row>
              ))}
            </div>
          </>
        )}

        {/* Refunded: a record, not a decision */}
        {refunded.length > 0 && (
          <>
            <SectionHeading label="Refunded" count={refunded.length} />
            <div className="space-y-2 mb-5">
              {refunded.map(entry => (
                <Row key={entry.id} entry={entry}>
                  <Action label="Delete" danger disabled={busyId === entry.id} onClick={() => setDeleting(entry)} />
                </Row>
              ))}
            </div>
          </>
        )}

        {/* Rejected, most recent first */}
        {decidedAll.length > 0 && (
          <>
            <SectionHeading
              label="Rejected"
              count={decidedAll.length > DECIDED_SHOWN ? `${DECIDED_SHOWN} of ${decidedAll.length}` : decidedAll.length}
            />
            <div className="space-y-1">
              {decided.map(entry => (
                <div key={entry.id} className="flex items-center justify-between gap-3 text-[10px]">
                  <span className="text-nier-bg/80 truncate">{entry.display_name}</span>
                  <span className="text-nier-bg/70 shrink-0">
                    {entry.refunded ? 'Rejected · refunded' : 'Rejected'}
                  </span>
                </div>
              ))}
            </div>
          </>
        )}

        {notice && (
          <div className="bg-nier-black border border-nier-border/20 p-3 mt-4">
            <p className="text-green-400 text-[10px] tracking-wide">{notice}</p>
          </div>
        )}
        {error && (
          <div className="bg-red-900/20 border border-red-500/40 p-3 mt-4">
            <p className="text-red-400 text-[10px] tracking-wide">{error}</p>
          </div>
        )}

        {/* Filling the wall up, to see how it behaves with a crowd on it.

            These are generated in this browser and drawn only here. They are
            not rows in the contributions table, deliberately: that table is
            what the money is reconciled against, and inventing entries in it
            would put fictional people on the public wall now and leave the
            totals wrong forever if one were ever missed. Nobody else sees
            these, and Clear removes them completely. */}
        <div className="mt-6 pt-4 border-t border-nier-border/20">
          <SectionHeading
            label="Preview"
            count={seededCount > 0 ? `${seededCount} false` : ''}
          />
          <p className="text-nier-bg/70 text-[9px] tracking-wider leading-relaxed mb-3">
            Fills the wall with false donations across every rank, so the layout
            can be judged with a crowd on it. Local to this browser, marked as
            false on every trace, and invisible to everyone else.
          </p>
          <div className="flex gap-2">
            {SEED_PRESETS.map(count => (
              <button
                key={count}
                type="button"
                onClick={() => { seedContributors(count); onSeedChanged() }}
                className="flex-1 py-2 border border-nier-border/30 text-nier-bg/80 text-[10px] tracking-[0.15em] uppercase hover:border-nier-border/60 hover:text-nier-bg transition-colors"
              >
                {count}
              </button>
            ))}
            <button
              type="button"
              onClick={() => { clearSeededContributors(); onSeedChanged() }}
              disabled={seededCount === 0}
              className="flex-1 py-2 border text-[10px] tracking-[0.15em] uppercase transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
              style={{ borderColor: 'rgba(255,97,97,0.4)', color: '#FF6161' }}
            >
              Clear
            </button>
          </div>
        </div>

        <button
          type="button"
          onClick={onClose}
          className="w-full mt-5 py-2 border border-nier-border/30 text-nier-bg/80 text-[10px] tracking-[0.15em] uppercase hover:border-nier-border/60 hover:text-nier-bg transition-colors"
        >
          Close
        </button>
      </div>

      {messaging && (
        <MessageDialog
          entry={messaging}
          onCancel={() => setMessaging(null)}
          onSend={text => {
            const target = messaging
            setMessaging(null)
            run(target.id, async () => {
              await call('message', { id: target.id, message: text })
              setNotice('Message sent.')
            })
          }}
        />
      )}

      {rejecting && (
        <RejectDialog
          entry={rejecting}
          onCancel={() => setRejecting(null)}
          onSend={(reason, refund) => {
            const target = rejecting
            setRejecting(null)
            run(target.id, () => call('reject', { id: target.id, reason, refund }))
          }}
        />
      )}

      {editing && (
        <EditDialog
          entry={editing}
          onCancel={() => setEditing(null)}
          onSave={patch => {
            const target = editing
            setEditing(null)
            run(target.id, () => call('edit', { id: target.id, ...patch }))
          }}
        />
      )}

      {deleting && (
        <ConfirmDelete
          entry={deleting}
          onCancel={() => setDeleting(null)}
          onConfirm={() => {
            const target = deleting
            setDeleting(null)
            run(target.id, () => call('delete', { id: target.id }))
          }}
        />
      )}
    </div>
  )
}

function SectionHeading({ label, count }: { label: string; count: number | string }) {
  return (
    <div className="flex items-center gap-2 mb-2">
      <span className="text-nier-bg/80 text-[9px] tracking-[0.2em] uppercase">{label}</span>
      <div className="flex-1 h-[1px] bg-gradient-to-r from-nier-border/30 to-transparent" />
      <span className="text-nier-bg/70 text-[9px] tracking-wider">{count}</span>
    </div>
  )
}

function Row({ entry, children, warning }: { entry: Entry; children: React.ReactNode; warning?: string | null }) {
  return (
    <div
      className="bg-nier-black border p-3"
      style={{ borderColor: warning ? 'rgba(232,193,90,0.45)' : 'rgba(203,203,203,0.2)' }}
    >
    <div className="flex justify-between items-center gap-3">
      <div className="min-w-0">
        <div className="text-nier-bg text-sm tracking-wide truncate">
          {entry.display_name}
          {entry.hidden && <span className="text-nier-bg/70 text-[9px] uppercase tracking-wider ml-2">hidden</span>}
          {entry.refunded && <span className="text-red-400/80 text-[9px] uppercase tracking-wider ml-2">refunded</span>}
        </div>
        <div className="text-[9px] text-nier-bg/70 tracking-wider uppercase mt-1">
          €{euros(entry.settled_eur_cents)} · {entry.kind === 'monthly' ? 'Monthly' : 'One-off'} · {formatDate(entry.created_at)}
        </div>
      </div>
      <div className="flex gap-2 shrink-0">{children}</div>
    </div>

      {/* Amber rather than red: nothing has gone wrong, and approving anyway is
          a legitimate answer. It is a thing to know before deciding, not a
          refusal. */}
      {warning && (
        <p className="text-[9px] tracking-wider leading-relaxed mt-2 pt-2 border-t border-nier-border/15" style={{ color: '#E8C15A' }}>
          {warning}
        </p>
      )}
    </div>
  )
}

function Action({ label, onClick, disabled, primary, danger }: {
  label: string
  onClick: () => void
  disabled?: boolean
  primary?: boolean
  danger?: boolean
}) {
  const base = 'px-3 py-2 text-[10px] tracking-[0.1em] uppercase transition-colors disabled:opacity-30'
  const style = primary
    ? 'bg-nier-bg text-nier-black hover:bg-nier-bgDark'
    : danger
      ? 'border border-red-500/40 text-red-400 hover:border-red-500/70'
      : 'border border-nier-border/40 text-nier-bg/80 hover:text-nier-bg hover:border-nier-border/60'
  return (
    <button type="button" onClick={onClick} disabled={disabled} className={`${base} ${style}`}>
      {label}
    </button>
  )
}

// Rejecting a name, with the message that goes with it.
//
// A window.prompt was doing this, which gave no room to think about wording
// someone is going to read, and no way to refund at the same time. A name that
// can't be published is often a contribution nobody wants to keep, and making
// that a second errand in another system is how it gets forgotten.
// Writing to a contributor without deciding anything about them yet.
//
// The row stays exactly where it is. That is the point: the common case is a
// name already taken, where the right move is to ask for another one rather
// than reject someone for being second.
function MessageDialog({ entry, onCancel, onSend }: {
  entry: Entry
  onCancel: () => void
  onSend: (message: string) => void
}) {
  const [message, setMessage] = useState('')

  // The message that gets written over and over, offered rather than retyped.
  // Editable afterwards -- it is a starting point, not a form letter.
  const nameTaken = [
    `Someone is already listed on the contributors wall as "${entry.display_name.trim()}".`,
    '',
    'The wall shows one trace per name, so two people sharing one would appear as a single contributor with both amounts added together — which would misrepresent you both.',
    '',
    'Could you reply with another name you would like to be shown under? Anything that tells you apart is enough. Your contribution is unaffected and still counts toward the month either way.',
  ].join('\n')

  return (
    <Dialog title="Write to this contributor" onCancel={onCancel}>
      <p className="text-nier-bg/80 text-xs tracking-wide leading-relaxed mb-4">
        <span className="text-nier-bg">{entry.display_name}</span> — €{euros(entry.settled_eur_cents)},{' '}
        {formatDate(entry.created_at)}
      </p>

      <div className="flex items-center justify-between mb-2 gap-3">
        <label className="text-nier-bg/80 text-[9px] tracking-[0.15em] uppercase">Message</label>
        <button
          type="button"
          onClick={() => setMessage(nameTaken)}
          className="text-nier-bg/70 hover:text-nier-bg text-[9px] tracking-[0.15em] uppercase transition-colors"
        >
          ◇ Name already taken
        </button>
      </div>
      <textarea
        value={message}
        onChange={e => setMessage(e.target.value)}
        rows={8}
        placeholder="Written to the contributor, so write it to them."
        className="w-full px-4 py-2 bg-nier-black border border-nier-border/30 text-nier-bg text-sm tracking-wide placeholder-nier-bg/50 focus:border-nier-border/60 transition-colors resize-none"
      />

      <p className="text-nier-bg/70 text-[9px] tracking-wider mt-2 leading-relaxed">
        Sent to the address Stripe collected for this payment — the only one there is,
        since donating needs no account. Replies reach thedigitalatrium@gmail.com.
        Nothing about the name is decided by sending this; the row stays waiting.
      </p>

      <div className="flex flex-col sm:flex-row gap-2 mt-5">
        <button
          type="button"
          onClick={() => onSend(message.trim())}
          disabled={message.trim().length === 0}
          className="flex-1 py-3 bg-nier-bg text-nier-black text-[10px] tracking-[0.15em] uppercase hover:bg-nier-bgDark transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
        >
          Send
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="flex-1 py-3 border border-nier-border/30 text-nier-bg/80 text-[10px] tracking-[0.15em] uppercase hover:border-nier-border/60 hover:text-nier-bg transition-colors"
        >
          Cancel
        </button>
      </div>
    </Dialog>
  )
}

function RejectDialog({ entry, onCancel, onSend }: {
  entry: Entry
  onCancel: () => void
  onSend: (reason: string, refund: boolean) => void
}) {
  const [reason, setReason] = useState('')

  return (
    <Dialog title="Reject this name" onCancel={onCancel}>
      <p className="text-nier-bg/80 text-xs tracking-wide leading-relaxed mb-4">
        <span className="text-nier-bg">{entry.display_name}</span> — €{euros(entry.settled_eur_cents)},{' '}
        {formatDate(entry.created_at)}
      </p>

      <label className="block text-nier-bg/80 text-[9px] tracking-[0.15em] uppercase mb-2">
        Why it can't be shown
      </label>
      <textarea
        value={reason}
        onChange={e => setReason(e.target.value)}
        rows={4}
        placeholder="Written to the contributor, so write it to them."
        className="w-full px-4 py-2 bg-nier-black border border-nier-border/30 text-nier-bg text-sm tracking-wide placeholder-nier-bg/50 focus:border-nier-border/60 transition-colors resize-none"
      />

      <p className="text-nier-bg/70 text-[9px] tracking-wider mt-2 leading-relaxed">
        Emailed to the address Stripe collected. Their contribution still counts unless
        you refund it.
      </p>

      <div className="flex flex-col sm:flex-row gap-2 mt-5">
        <button
          type="button"
          onClick={() => onSend(reason.trim(), false)}
          className="flex-1 py-3 bg-nier-bg text-nier-black text-[10px] tracking-[0.15em] uppercase hover:bg-nier-bgDark transition-colors"
        >
          Send
        </button>
        <button
          type="button"
          onClick={() => onSend(reason.trim(), true)}
          disabled={entry.refunded}
          className="flex-1 py-3 border border-red-500/50 text-red-400 text-[10px] tracking-[0.15em] uppercase hover:border-red-500/80 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
        >
          {entry.refunded ? 'Already refunded' : 'Send & refund'}
        </button>
      </div>
    </Dialog>
  )
}

function EditDialog({ entry, onCancel, onSave }: {
  entry: Entry
  onCancel: () => void
  onSave: (patch: { displayName: string; amountEur: number; createdAt: string }) => void
}) {
  const [displayName, setDisplayName] = useState(entry.display_name ?? '')
  const [amount, setAmount] = useState(String(euros(entry.settled_eur_cents)))
  const [date, setDate] = useState(toDateInput(entry.created_at))

  return (
    <Dialog title="Edit contribution" onCancel={onCancel}>
      <label className="block text-nier-bg/80 text-[9px] tracking-[0.15em] uppercase mb-2">Name</label>
      <input
        value={displayName}
        onChange={e => setDisplayName(e.target.value)}
        className="w-full px-4 py-2 bg-nier-black border border-nier-border/30 text-nier-bg text-sm tracking-wide focus:border-nier-border/60 transition-colors mb-4"
      />

      <label className="block text-nier-bg/80 text-[9px] tracking-[0.15em] uppercase mb-2">Amount (€)</label>
      <input
        value={amount}
        onChange={e => setAmount(e.target.value)}
        inputMode="decimal"
        className="w-full px-4 py-2 bg-nier-black border border-nier-border/30 text-nier-bg text-sm tracking-wide focus:border-nier-border/60 transition-colors mb-4"
      />

      <label className="block text-nier-bg/80 text-[9px] tracking-[0.15em] uppercase mb-2">Date</label>
      <input
        type="date"
        value={date}
        onChange={e => setDate(e.target.value)}
        className="w-full px-4 py-2 bg-nier-black border border-nier-border/30 text-nier-bg text-sm tracking-wide focus:border-nier-border/60 transition-colors"
      />

      <p className="text-nier-bg/70 text-[9px] tracking-wider mt-3 leading-relaxed">
        Changes what this app shows, not what Stripe recorded. Editing an amount makes
        the bar disagree with the money that actually arrived.
      </p>

      <button
        type="button"
        onClick={() => onSave({ displayName, amountEur: Number(amount.replace(',', '.')), createdAt: date })}
        className="w-full mt-5 py-3 bg-nier-bg text-nier-black text-[10px] tracking-[0.15em] uppercase hover:bg-nier-bgDark transition-colors"
      >
        Save
      </button>
    </Dialog>
  )
}

function ConfirmDelete({ entry, onCancel, onConfirm }: {
  entry: Entry
  onCancel: () => void
  onConfirm: () => void
}) {
  return (
    <Dialog title="Delete this contribution" onCancel={onCancel}>
      <p className="text-nier-bg/80 text-xs tracking-wide leading-relaxed">
        <span className="text-nier-bg">{entry.display_name}</span> — €{euros(entry.settled_eur_cents)},{' '}
        {formatDate(entry.created_at)}
      </p>
      <p className="text-nier-bg/80 text-xs tracking-wide leading-relaxed mt-3">
        This removes the row from the database entirely: off the wall, and out of the
        totals. It cannot be undone from here, and no money moves — Stripe keeps its own
        record either way.
      </p>
      <p className="text-nier-bg/70 text-[9px] tracking-wider mt-3 leading-relaxed">
        To take a name down without losing the contribution, use Hide.
      </p>

      <div className="flex gap-2 mt-5">
        <button
          type="button"
          onClick={onCancel}
          className="flex-1 py-3 border border-nier-border/40 text-nier-bg/80 text-[10px] tracking-[0.15em] uppercase hover:text-nier-bg transition-colors"
        >
          Keep it
        </button>
        <button
          type="button"
          onClick={onConfirm}
          className="flex-1 py-3 bg-red-900/40 border border-red-500/60 text-red-300 text-[10px] tracking-[0.15em] uppercase hover:bg-red-900/60 transition-colors"
        >
          Delete permanently
        </button>
      </div>
    </Dialog>
  )
}

function Dialog({ title, children, onCancel }: {
  title: string
  children: React.ReactNode
  onCancel: () => void
}) {
  return (
    <div className="modal-backdrop fixed inset-0 bg-nier-black/85 flex items-center justify-center z-[10000400]" data-ui-element>
      <div className="bg-nier-blackLight border border-nier-border/40 p-6 max-w-md w-full mx-4 relative max-h-[85vh] overflow-y-auto">
        <div className="absolute top-0 left-0 w-4 h-4 border-l border-t border-nier-border/60" />
        <div className="absolute bottom-0 right-0 w-4 h-4 border-r border-b border-nier-border/60" />

        <div className="flex items-center gap-3 mb-5">
          <div className="w-1.5 h-1.5 rotate-45 border border-nier-border/60" />
          <h3 className="text-nier-bg tracking-[0.15em] uppercase">{title}</h3>
        </div>

        {children}

        <button
          type="button"
          onClick={onCancel}
          className="w-full mt-3 py-2 text-nier-bg/70 text-[10px] tracking-[0.15em] uppercase hover:text-nier-bg transition-colors"
        >
          Cancel
        </button>
      </div>
    </div>
  )
}
