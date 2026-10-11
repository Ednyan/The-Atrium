// A phone's width: below Tailwind's sm, where the atrium lays its interface
// out for a thumb (LobbyScene) -- the tools along the foot, the view's buttons
// in the menu, panels as sheets (index.css, .docked-panel).

import { useSyncExternalStore } from 'react'

const QUERY = '(max-width: 639px)'

const subscribe = (changed: () => void) => {
  const query = window.matchMedia(QUERY)
  query.addEventListener('change', changed)
  return () => query.removeEventListener('change', changed)
}

export function useNarrow(): boolean {
  return useSyncExternalStore(subscribe, () => window.matchMedia(QUERY).matches, () => false)
}
