import { useState } from 'react'
import { supabase } from '../lib/supabase'

interface ChooseUsernameScreenProps {
  userId: string
  email: string
  onComplete: (username: string) => void
}

// Shown when someone is signed in but has no usable username yet -- i.e. after
// a first Google sign-in. Google supplies an email but nothing that works as a
// username, so this is where they pick one.
//
// It also doubles as the recovery path for a missing profile row. The
// on_auth_user_created trigger is supposed to create one, but it swallows its
// own errors (EXCEPTION WHEN others THEN RAISE LOG), so a failed insert left
// the user authenticated with no profile -- and since every screen past login
// needs a profile, they silently bounced back to the homepage with no error.
// Creating the row here means sign-in no longer depends on that trigger having
// worked.
export default function ChooseUsernameScreen({ userId, email, onComplete }: ChooseUsernameScreenProps) {
  const [username, setUsername] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  // Mirrors the DB's own constraints (username_length, username_format) so the
  // failure is explained here rather than coming back as a constraint violation.
  const validate = (value: string): string | null => {
    if (value.length < 3) return 'Username must be at least 3 characters'
    if (value.length > 20) return 'Username must be 20 characters or fewer'
    if (!/^[a-zA-Z0-9_]+$/.test(value)) return 'Only letters, numbers and underscores'
    return null
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!supabase || loading) return

    const trimmed = username.trim()
    const invalid = validate(trimmed)
    if (invalid) {
      setError(invalid)
      return
    }

    setError('')
    setLoading(true)
    try {
      const { data: taken } = await (supabase
        .from('profiles') as any)
        .select('id')
        .ilike('username', trimmed)
        .maybeSingle()

      // A row belonging to this same user is fine -- that's just re-running
      // the step. Anyone else's is a genuine clash.
      if (taken && taken.id !== userId) {
        setError('Username already taken')
        setLoading(false)
        return
      }

      // upsert, not insert: the trigger may or may not have produced a row, and
      // this screen has to work either way.
      const { error: upsertError } = await (supabase
        .from('profiles') as any)
        .upsert({
          id: userId,
          username: trimmed,
          display_name: trimmed,
          email,
          // Marks the name as deliberately picked, so this screen doesn't
          // reappear on the next sign-in.
          username_chosen: true,
        }, { onConflict: 'id' })

      if (upsertError) throw upsertError

      onComplete(trimmed)
    } catch (err: any) {
      console.error('Failed to set username:', err)
      setError(err?.message || 'Could not save that username')
      setLoading(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-nier-black flex items-center justify-center z-50 p-4 font-mono">
      <div className="bg-nier-blackLight border border-nier-border/40 w-full max-w-sm p-8 relative">
        <div className="absolute top-0 left-0 w-4 h-4 border-l border-t border-nier-border/60" />
        <div className="absolute top-0 right-0 w-4 h-4 border-r border-t border-nier-border/60" />
        <div className="absolute bottom-0 left-0 w-4 h-4 border-l border-b border-nier-border/60" />
        <div className="absolute bottom-0 right-0 w-4 h-4 border-r border-b border-nier-border/60" />

        <div className="flex items-center gap-3 mb-1">
          <div className="w-1.5 h-1.5 rotate-45 border border-nier-border/60" />
          <h2 className="text-nier-bg tracking-[0.15em] uppercase text-sm">Choose a Username</h2>
        </div>
        <p className="text-nier-bg/75 text-[10px] tracking-[0.1em] uppercase ml-5 mb-6">
          One last step
        </p>

        <p className="text-nier-bg/80 text-[11px] tracking-wide mb-3">
          Signed in as <span className="text-nier-bg break-all">{email}</span>. Pick the name
          others will see on your traces.
        </p>

        {/* Called out before the input, not after: usernames are permanent, and
            burying that under the field is how people end up stuck with a typo. */}
        <div className="border border-nier-border/30 bg-nier-black/60 px-3 py-2 mb-5">
          <p className="text-nier-bg/80 text-[10px] tracking-wide">
            ⚠ Your username is <span className="text-nier-bg">permanent</span> and can't be
            changed later. Your display name can.
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <input
            type="text"
            value={username}
            onChange={(e) => { setUsername(e.target.value); setError('') }}
            autoFocus
            maxLength={20}
            placeholder="username"
            className="w-full bg-nier-black border border-nier-border/30 text-nier-bg px-4 py-3 text-sm tracking-wide placeholder-nier-bg/50 focus:border-nier-border/60 focus:outline-none transition-colors"
          />
          <p className="text-nier-bg/70 text-[9px] tracking-wider uppercase">
            3-20 characters, letters/numbers/underscores
          </p>

          {error && (
            <div className="border border-nier-red/40 bg-nier-red/10 px-4 py-3 text-nier-bg/80 text-xs tracking-wide">
              ⚠ {error}
            </div>
          )}

          <button
            type="submit"
            disabled={loading || !username.trim()}
            className="w-full py-3 bg-nier-bg text-nier-black text-xs tracking-[0.15em] uppercase transition-all hover:bg-nier-strong disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {loading ? '◇ Saving...' : 'Continue'}
          </button>
        </form>
      </div>
    </div>
  )
}
