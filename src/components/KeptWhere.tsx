import { useTranslation } from '../lib/i18n'

// Where a new atrium is kept, chosen as it's made or imported: the cloud's
// (shared, three at most) or this browser's (lib/browserAtriums).
export default function KeptWhere({ inBrowser, canCloud, onChange }: { inBrowser: boolean; canCloud: boolean; onChange: (inBrowser: boolean) => void }) {
  const { t } = useTranslation()
  return (
    <div>
      <label className="block text-nier-bg/80 text-xs tracking-[0.15em] uppercase mb-2">{t('browser.keptWhere')}</label>
      <div className="grid grid-cols-2 gap-2">
        {[false, true].map(here => (
          <button
            key={String(here)}
            type="button"
            onClick={() => onChange(here)}
            disabled={!here && !canCloud}
            aria-pressed={inBrowser === here}
            className={`p-3 text-left border transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${inBrowser === here ? 'border-nier-bg text-nier-bg' : 'border-nier-border/30 text-nier-bg/70 hover:border-nier-border/60'}`}
          >
            <span className="block text-xs tracking-[0.12em] uppercase">{here ? t('browser.inBrowser') : t('browser.online')}</span>
            <span className="block mt-1 text-[11px] tracking-wide text-nier-bg/60">
              {here ? t('browser.inBrowserHint') : canCloud ? t('browser.onlineHint') : t('browser.limitReached')}
            </span>
          </button>
        ))}
      </div>
    </div>
  )
}
