import { useEffect, useState } from 'react'
import { isDesktop } from '../lib/supabase'

// The welcome screen and the atrium browser, and nowhere else. Inside an
// atrium it would be one more thing floating over somebody's canvas, and on
// the landing page it is a build number on what is otherwise a website.
//
// Read from the hash rather than passed down, because this is mounted at the
// root -- outside the component that knows the route -- so that it survives
// navigation instead of remounting on every screen change.
const SHOWN_ON = ['/welcome', '/browse']

function onAllowedRoute() {
  try {
    return SHOWN_ON.includes(window.location.hash.slice(1) || '/')
  } catch {
    return false
  }
}

// Desktop-only build version, in the bottom-left corner of the two screens
// that are the app standing still.
//
// Read from Tauri at runtime rather than from package.json, so it reflects the
// binary actually running -- which is the point once the app can update itself
// underneath you. A hardcoded string would keep claiming the version the
// frontend was built at, even after an update swapped the executable.
export default function AppVersionBadge() {
  const [version, setVersion] = useState<string | null>(null)
  const [visible, setVisible] = useState(onAllowedRoute)

  useEffect(() => {
    if (!isDesktop) return
    const onHashChange = () => setVisible(onAllowedRoute())
    window.addEventListener('hashchange', onHashChange)
    return () => window.removeEventListener('hashchange', onHashChange)
  }, [])

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

  if (!isDesktop || !version || !visible) return null

  return (
    <div className="fixed bottom-3 left-4 z-[10000600] pointer-events-none select-none">
      <span className="font-mono text-[9px] tracking-[0.2em] uppercase text-nier-bg/70">
        v{version}
      </span>
    </div>
  )
}
