import { useEffect, useState } from 'react'
import { isDesktop } from '../lib/supabase'

// Desktop-only build version, pinned top-right.
//
// Read from Tauri at runtime rather than from package.json, so it reflects the
// binary actually running -- which is the point once the app can update itself
// underneath you. A hardcoded string would keep claiming the version the
// frontend was built at, even after an update swapped the executable.
export default function AppVersionBadge() {
  const [version, setVersion] = useState<string | null>(null)

  useEffect(() => {
    if (!isDesktop) return
    let cancelled = false
    // Dynamic import: the Tauri API has no business in the web bundle.
    import('@tauri-apps/api/app')
      .then(({ getVersion }) => getVersion())
      .then(v => { if (!cancelled) setVersion(v) })
      .catch(() => { /* leave it hidden rather than showing a wrong number */ })
    return () => { cancelled = true }
  }, [])

  if (!isDesktop || !version) return null

  return (
    <div className="fixed top-3 right-4 z-[10000600] pointer-events-none select-none">
      <span className="font-mono text-[9px] tracking-[0.2em] uppercase text-nier-border/40">
        v{version}
      </span>
    </div>
  )
}
