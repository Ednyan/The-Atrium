import { useEffect, useRef, useState } from 'react'
import { isDesktop } from '../lib/supabase'

// How often to re-check once the app is running. The check is a single small
// HTTPS request for a JSON manifest, so hourly is cheap; it also fails
// silently offline and simply tries again next hour.
const CHECK_INTERVAL_MS = 60 * 60 * 1000

type Phase = 'idle' | 'available' | 'downloading' | 'ready' | 'error'

interface PendingUpdate {
  version: string
  notes?: string
  // The plugin's Update handle. Typed loosely so this file doesn't need the
  // updater types at build time on web, where the module is never imported.
  handle: any
}

// Desktop self-update. Checks once at startup and then hourly, and offers a
// one-click download-install-relaunch.
//
// Renders nothing on web: browsers get new code on refresh, and the updater
// plugin doesn't exist there. Every import of the Tauri modules is dynamic
// for the same reason -- a static import would pull them into the web bundle.
export default function UpdateChecker() {
  const [pending, setPending] = useState<PendingUpdate | null>(null)
  const [phase, setPhase] = useState<Phase>('idle')
  const [progress, setProgress] = useState(0)
  const [error, setError] = useState('')
  const [dismissed, setDismissed] = useState(false)
  // Guards against a scheduled check firing while a download is in flight and
  // replacing the handle mid-install.
  const busyRef = useRef(false)

  useEffect(() => {
    if (!isDesktop) return

    let cancelled = false

    const check = async () => {
      if (cancelled || busyRef.current) return
      try {
        const { check: checkUpdate } = await import('@tauri-apps/plugin-updater')
        const update = await checkUpdate()
        if (cancelled || !update) return
        setPending({ version: update.version, notes: update.body, handle: update })
        setPhase('available')
        // A new version supersedes a dismissal -- dismissing 1.1 shouldn't
        // hide 1.2.
        setDismissed(false)
      } catch (err) {
        // Offline, GitHub unreachable, no release yet: all normal states for
        // a background check, so they stay in the console rather than the UI.
        console.warn('Update check failed:', err)
      }
    }

    check()
    const timer = setInterval(check, CHECK_INTERVAL_MS)
    // Also re-check when the machine comes back online, so someone who was
    // offline at launch doesn't wait up to an hour.
    window.addEventListener('online', check)

    return () => {
      cancelled = true
      clearInterval(timer)
      window.removeEventListener('online', check)
    }
  }, [])

  const install = async () => {
    if (!pending || busyRef.current) return
    busyRef.current = true
    setPhase('downloading')
    setProgress(0)
    setError('')

    try {
      let downloaded = 0
      let total = 0
      await pending.handle.downloadAndInstall((event: any) => {
        if (event.event === 'Started') {
          total = event.data?.contentLength ?? 0
        } else if (event.event === 'Progress') {
          downloaded += event.data?.chunkLength ?? 0
          if (total > 0) setProgress(Math.min(100, Math.round((downloaded / total) * 100)))
        } else if (event.event === 'Finished') {
          setProgress(100)
        }
      })

      setPhase('ready')
      // Relaunch rather than exiting: the installer has already replaced the
      // binary on disk, so this comes back up on the new version.
      const { relaunch } = await import('@tauri-apps/plugin-process')
      await relaunch()
    } catch (err: any) {
      console.error('Update failed:', err)
      setError(err?.message || String(err))
      setPhase('error')
      busyRef.current = false
    }
  }

  if (!isDesktop || !pending || dismissed) return null

  return (
    <div className="fixed bottom-4 right-4 z-[10000500] font-mono pointer-events-auto">
      <div className="bg-black border-2 border-white p-4 w-72 relative shadow-2xl">
        <div className="absolute top-0 left-0 w-3 h-3 border-l border-t border-white pointer-events-none" />
        <div className="absolute top-0 right-0 w-3 h-3 border-r border-t border-white pointer-events-none" />
        <div className="absolute bottom-0 left-0 w-3 h-3 border-l border-b border-white pointer-events-none" />
        <div className="absolute bottom-0 right-0 w-3 h-3 border-r border-b border-white pointer-events-none" />

        <p className="text-white text-[11px] tracking-[0.15em] uppercase mb-1">
          <span className="text-gray-400 mr-1.5">◇</span>Update Available
        </p>
        <p className="text-gray-400 text-[10px] tracking-wider mb-3">
          Version {pending.version}
        </p>

        {pending.notes && phase === 'available' && (
          <p className="text-gray-300 text-[9px] tracking-wide mb-3 max-h-16 overflow-y-auto whitespace-pre-line">
            {pending.notes}
          </p>
        )}

        {phase === 'downloading' && (
          <div className="mb-3">
            <div className="h-1 bg-gray-800 border border-gray-700 overflow-hidden">
              <div className="h-full bg-white/80 transition-all duration-200" style={{ width: `${progress}%` }} />
            </div>
            <p className="text-gray-300 text-[9px] tracking-wider mt-1">
              {progress > 0 ? `Downloading ${progress}%` : 'Starting download...'}
            </p>
          </div>
        )}

        {phase === 'ready' && (
          <p className="text-gray-400 text-[9px] tracking-wider mb-3">Restarting...</p>
        )}

        {phase === 'error' && (
          <p className="text-[9px] tracking-wider mb-3" style={{ color: '#FF6161' }}>
            ⚠ {error}
          </p>
        )}

        {(phase === 'available' || phase === 'error') && (
          <div className="flex gap-2">
            <button
              onClick={install}
              className="flex-1 bg-white hover:bg-gray-200 text-black py-1.5 text-[10px] tracking-wider uppercase transition-colors"
            >
              {phase === 'error' ? 'Retry' : 'Update Now'}
            </button>
            <button
              onClick={() => setDismissed(true)}
              className="flex-1 border border-gray-600 hover:border-white text-white py-1.5 text-[10px] tracking-wider uppercase transition-colors"
            >
              Later
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
