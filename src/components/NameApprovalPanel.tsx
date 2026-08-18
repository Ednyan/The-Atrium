import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'

interface NameApprovalPanelProps {
  onClose: () => void
}

interface PendingName {
  id: string
  display_name: string
  kind: string
  name_approved: boolean
  name_rejected_reason: string | null
  created_at: string
}

// Approving the names contributors chose.
//
// Only the operator ever sees the button that opens this, but that is
// presentation. The Edge Function behind it re-checks who is asking on every
// single request, because a hidden button is not a permission -- anyone can
// call the URL. If this component were somehow rendered for someone else, they
// would get a list of nothing and a 403 for every action.
export default function NameApprovalPanel({ onClose }: NameApprovalPanelProps) {
  const [entries, setEntries] = useState<PendingName[] | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [error, setError] = useState('')

  const call = async (action: string, id?: string, reason?: string) => {
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
      body: JSON.stringify({ action, id, reason }),
    })

    const body = await response.json().catch(() => null)
    if (!response.ok) throw new Error(body?.error || 'Request failed')
    return body
  }

  const load = () => {
    call('list')
      .then(body => setEntries(body.entries ?? []))
      .catch(e => { setError(e.message); setEntries([]) })
  }

  useEffect(load, [])

  const decide = async (entry: PendingName, approve: boolean) => {
    setBusyId(entry.id)
    setError('')
    try {
      if (approve) {
        await call('approve', entry.id)
      } else {
        const reason = window.prompt(`Why can't "${entry.display_name}" be shown?\n\nThis is emailed to the contributor.`)
        // Cancelled, as distinct from an empty reason.
        if (reason === null) { setBusyId(null); return }
        await call('reject', entry.id, reason)
      }
      load()
    } catch (e: any) {
      setError(e.message)
    } finally {
      setBusyId(null)
    }
  }

  const waiting = (entries ?? []).filter(e => !e.name_approved && !e.name_rejected_reason)
  const decided = (entries ?? []).filter(e => e.name_approved || e.name_rejected_reason)

  return (
    <div className="fixed inset-0 bg-nier-black/80 flex items-center justify-center z-[10000200] pointer-events-auto" data-ui-element>
      <div className="bg-nier-blackLight border border-nier-border/40 p-6 max-w-lg w-full mx-4 relative max-h-[85vh] overflow-y-auto">
        <div className="absolute top-0 left-0 w-4 h-4 border-l border-t border-nier-border/60" />
        <div className="absolute top-0 right-0 w-4 h-4 border-r border-t border-nier-border/60" />
        <div className="absolute bottom-0 left-0 w-4 h-4 border-l border-b border-nier-border/60" />
        <div className="absolute bottom-0 right-0 w-4 h-4 border-r border-b border-nier-border/60" />

        <div className="flex items-center gap-3 mb-5">
          <div className="w-1.5 h-1.5 rotate-45 border border-nier-border/60" />
          <h3 className="text-nier-bg tracking-[0.15em] uppercase">Contributor Names</h3>
        </div>

        {entries === null && (
          <p className="text-nier-bg/70 text-[10px] tracking-wider uppercase">Loading…</p>
        )}

        {entries !== null && waiting.length === 0 && (
          <p className="text-nier-bg/70 text-[10px] tracking-wider uppercase mb-4">Nothing waiting.</p>
        )}

        <div className="space-y-2">
          {waiting.map(entry => (
            <div key={entry.id} className="bg-nier-black border border-nier-border/20 p-3 flex justify-between items-center gap-3">
              <div className="min-w-0">
                <div className="text-nier-bg text-sm tracking-wide truncate">{entry.display_name}</div>
                <div className="text-[9px] text-nier-bg/70 tracking-wider uppercase mt-1">
                  {entry.kind === 'monthly' ? 'Monthly' : 'One-off'} · {new Date(entry.created_at).toLocaleDateString()}
                </div>
              </div>
              <div className="flex gap-2 shrink-0">
                <button
                  type="button"
                  disabled={busyId === entry.id}
                  onClick={() => decide(entry, true)}
                  className="px-3 py-2 bg-nier-bg text-nier-black text-[10px] tracking-[0.1em] uppercase hover:bg-nier-bgDark transition-colors disabled:opacity-30"
                >
                  Approve
                </button>
                <button
                  type="button"
                  disabled={busyId === entry.id}
                  onClick={() => decide(entry, false)}
                  className="px-3 py-2 border border-nier-border/40 text-nier-bg/80 text-[10px] tracking-[0.1em] uppercase hover:text-nier-bg hover:border-nier-border/60 transition-colors disabled:opacity-30"
                >
                  Reject
                </button>
              </div>
            </div>
          ))}
        </div>

        {decided.length > 0 && (
          <div className="mt-5">
            <div className="flex items-center gap-2 mb-2">
              <span className="text-nier-bg/80 text-[9px] tracking-[0.2em] uppercase">Decided</span>
              <div className="flex-1 h-[1px] bg-gradient-to-r from-nier-border/30 to-transparent" />
            </div>
            <div className="space-y-1">
              {decided.map(entry => (
                <div key={entry.id} className="flex items-center justify-between gap-3 text-[10px]">
                  <span className="text-nier-bg/80 truncate">{entry.display_name}</span>
                  <span className={entry.name_approved ? 'text-green-400 shrink-0' : 'text-nier-bg/70 shrink-0'}>
                    {entry.name_approved ? 'Shown' : 'Rejected'}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {error && (
          <div className="bg-red-900/20 border border-red-500/40 p-3 mt-4">
            <p className="text-red-400 text-[10px] tracking-wide">{error}</p>
          </div>
        )}

        <button
          type="button"
          onClick={onClose}
          className="w-full mt-5 py-2 border border-nier-border/30 text-nier-bg/80 text-[10px] tracking-[0.15em] uppercase hover:border-nier-border/60 hover:text-nier-bg transition-colors"
        >
          Close
        </button>
      </div>
    </div>
  )
}
