import type { ReactNode } from 'react'
import { useTranslation } from '../lib/i18n'

// A notice over everything, its corners marked, dismissed with its button:
// its title, and what it says. Red, a `warning`.
export default function NoticeCard({ title, warning = false, onDismiss, children }: { title: string; warning?: boolean; onDismiss: () => void; children: ReactNode }) {
  const { t } = useTranslation()
  const corner = warning ? 'border-red-600' : 'border-nier-border/50'
  return (
    <div className="fixed inset-0 z-[10000200] bg-nier-black/80 flex items-center justify-center pointer-events-auto">
      <div className={`bg-nier-blackLight border p-6 relative ${corner}`} style={{ maxWidth: '360px' }}>
        <div className={`absolute top-0 left-0 w-4 h-4 border-l border-t ${corner} pointer-events-none`} />
        <div className={`absolute top-0 right-0 w-4 h-4 border-r border-t ${corner} pointer-events-none`} />
        <div className={`absolute bottom-0 left-0 w-4 h-4 border-l border-b ${corner} pointer-events-none`} />
        <div className={`absolute bottom-0 right-0 w-4 h-4 border-r border-b ${corner} pointer-events-none`} />

        <h3 className="text-nier-strong font-mono text-sm tracking-[0.15em] uppercase mb-4 text-center">
          <span className={`mr-2 ${warning ? 'text-red-500' : 'text-nier-bg/70'}`}>◇</span>
          {title}
        </h3>
        {children}
        <button
          onClick={onDismiss}
          autoFocus
          className="w-full bg-nier-bg hover:bg-nier-strong text-nier-black font-mono text-xs tracking-[0.15em] uppercase py-2.5 px-4 transition-all"
        >
          {t('common.okay')}
        </button>
      </div>
    </div>
  )
}
