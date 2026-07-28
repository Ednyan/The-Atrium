import { useEffect, useState } from 'react'
import { TOAST_EVENT } from '../lib/toast'

interface Toast {
  id: number
  message: string
}

const VISIBLE_MS = 2600

// Mounted once at the App root so every screen gets confirmations without
// each one owning its own copy of this.
export default function ToastHost() {
  const [toasts, setToasts] = useState<Toast[]>([])

  useEffect(() => {
    let nextId = 0
    const timers: number[] = []

    const handle = (e: Event) => {
      const message = (e as CustomEvent).detail
      if (typeof message !== 'string' || !message) return

      const id = nextId++
      setToasts(prev => [...prev, { id, message }])
      timers.push(
        window.setTimeout(() => {
          setToasts(prev => prev.filter(t => t.id !== id))
        }, VISIBLE_MS)
      )
    }

    window.addEventListener(TOAST_EVENT, handle)
    return () => {
      window.removeEventListener(TOAST_EVENT, handle)
      // Otherwise a pending dismissal fires against an unmounted host.
      timers.forEach(clearTimeout)
    }
  }, [])

  if (toasts.length === 0) return null

  return (
    <div
      className="fixed bottom-8 left-1/2 -translate-x-1/2 z-[500] flex flex-col items-center gap-2"
      // Purely informational, so it must never intercept a click meant for
      // the canvas underneath it.
      style={{ pointerEvents: 'none' }}
    >
      {toasts.map(toast => (
        <div
          key={toast.id}
          className="relative bg-nier-blackLight border border-nier-border/40 px-6 py-3 animate-nier-toast"
        >
          {/* Corner brackets, matching the app's other panels */}
          <div className="absolute top-0 left-0 w-3 h-3 border-l border-t border-nier-border/60" />
          <div className="absolute top-0 right-0 w-3 h-3 border-r border-t border-nier-border/60" />
          <div className="absolute bottom-0 left-0 w-3 h-3 border-l border-b border-nier-border/60" />
          <div className="absolute bottom-0 right-0 w-3 h-3 border-r border-b border-nier-border/60" />
          <div className="flex items-center gap-3">
            <div className="w-1.5 h-1.5 rotate-45 border border-nier-border/60 shrink-0" />
            <p className="text-nier-bg text-[10px] tracking-[0.15em] uppercase whitespace-nowrap">
              {toast.message}
            </p>
          </div>
        </div>
      ))}
    </div>
  )
}
