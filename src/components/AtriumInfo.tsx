// Who's here and where: your name, the atrium's with your role in it, and the
// cursor's place in the world with the zoom. It headed the atrium's menu until
// the menu became a column of icons (AtriumMenu); kept whole, to be given a
// corner of its own. Not shown anywhere until then.

import { useGameStore } from '../store/gameStore'
import { useTranslation } from '../lib/i18n'

// Where the cursor is in the world, and the zoom. A component of its own,
// subscribed on its own: the position changes with every movement of the
// mouse, and nothing else on screen needs drawing again for it.
export function CursorReadout({ zoom }: { zoom: number }) {
  const position = useGameStore(state => state.position)
  return (
    <p className="text-nier-bg/80 text-[11px] tracking-wider">
      ({Math.round(position.x)}, {Math.round(position.y)}) • {zoom.toFixed(2)}x
    </p>
  )
}

export default function AtriumInfo({ username, atriumName, role, zoom }: {
  username: string
  atriumName: string | null
  role: 'owner' | 'admin' | null
  zoom: number
}) {
  const { t } = useTranslation()
  return (
    <div className="font-mono">
      <p className="text-nier-strong text-xs tracking-[0.1em] uppercase font-bold truncate">{username}</p>
      {atriumName && (
        <p className="text-nier-bg/80 text-[11px] tracking-wider truncate">
          {atriumName} {role === 'owner' && t('atrium.hud.owner')}{role === 'admin' && t('atrium.hud.admin')}
        </p>
      )}
      <CursorReadout zoom={zoom} />
    </div>
  )
}
