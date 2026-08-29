// What the window shows when the vault could not be opened.
//
// main.tsx renders the app from localDbReady.then(...), so before this existed
// a rejection rendered nothing at all: a white window, with the real reason
// only in a console nobody has open. That was tolerable while the only way to
// fail was a corrupt database, which is rare. A vault held by another session
// is not rare -- it is one fast user switch away -- so it needs a screen.
//
// Deliberately standalone. It cannot assume the database opened, so it reaches
// for nothing that depends on one, and it is rendered instead of App rather
// than inside it.

import { useTranslation } from '../lib/i18n'

export default function StartupFailure({ reason, detail }: {
  reason: 'vault-in-use' | 'unknown'
  detail?: string
}) {
  const { t } = useTranslation()
  const inUse = reason === 'vault-in-use'

  return (
    <div className="fixed inset-0 bg-nier-black flex items-center justify-center p-6">
      <div className="relative max-w-lg w-full border border-nier-border/40 bg-nier-blackLight p-8">
        <div className="absolute top-0 left-0 w-6 h-6 border-l border-t border-nier-border/60" />
        <div className="absolute top-0 right-0 w-6 h-6 border-r border-t border-nier-border/60" />
        <div className="absolute bottom-0 left-0 w-6 h-6 border-l border-b border-nier-border/60" />
        <div className="absolute bottom-0 right-0 w-6 h-6 border-r border-b border-nier-border/60" />

        <div className="flex items-center gap-3 mb-5">
          <div className="w-1.5 h-1.5 rotate-45 border border-nier-border/60" />
          <h1 className="text-nier-strong text-sm tracking-[0.15em] uppercase">
            {inUse ? t('startup.inUseTitle') : t('startup.failedTitle')}
          </h1>
        </div>

        <p className="text-nier-bg/80 text-[0.85rem] leading-relaxed tracking-wide mb-6">
          {inUse ? t('startup.inUseBody') : t('startup.failedBody')}
        </p>

        {/* Only for the unknown case. "Another session has it" is the whole
            explanation; pasting an error code under it would just make a clear
            sentence look like a crash. */}
        {!inUse && detail && (
          <p className="text-nier-bg/45 text-[0.7rem] leading-relaxed tracking-wide mb-6 break-words">
            {detail}
          </p>
        )}

        <button
          onClick={() => window.location.reload()}
          className="w-full py-2 border border-nier-border/50 text-nier-bg/85 text-[10px] tracking-[0.15em] uppercase hover:border-nier-border hover:text-nier-bg transition-colors"
        >
          {t('startup.retry')}
        </button>
      </div>
    </div>
  )
}
