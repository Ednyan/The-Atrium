import { useTranslation } from '../lib/i18n'

export type Where = 'cloud' | 'browser' | 'drive'

// Where a new atrium is kept, chosen as it's made or imported: the cloud's
// (shared, three at most), this browser's (lib/browserAtriums), or -- for
// testers, behind the Drive switch -- Google Drive too (lib/driveSync).
export default function KeptWhere({ where, canCloud, canDrive = false, onChange }: { where: Where; canCloud: boolean; canDrive?: boolean; onChange: (where: Where) => void }) {
  const { t } = useTranslation()
  const places: Where[] = canDrive ? ['cloud', 'browser', 'drive'] : ['cloud', 'browser']
  const label = { cloud: t('browser.online'), browser: t('browser.inBrowser'), drive: t('browser.inDrive') }
  const hint = { cloud: canCloud ? t('browser.onlineHint') : t('browser.limitReached'), browser: t('browser.inBrowserHint'), drive: t('browser.inDriveHint') }
  return (
    <div>
      <label className="block text-nier-bg/80 text-xs tracking-[0.15em] uppercase mb-2">{t('browser.keptWhere')}</label>
      <div className={`grid grid-cols-2 gap-2 ${canDrive ? 'sm:grid-cols-3' : ''}`}>
        {places.map(place => (
          <button
            key={place}
            type="button"
            onClick={() => onChange(place)}
            disabled={place === 'cloud' && !canCloud}
            aria-pressed={where === place}
            className={`p-3 text-left border transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${where === place ? 'border-nier-bg text-nier-bg' : 'border-nier-border/30 text-nier-bg/70 hover:border-nier-border/60'}`}
          >
            <span className="block text-xs tracking-[0.12em] uppercase">{label[place]}</span>
            <span className="block mt-1 text-[11px] tracking-wide text-nier-bg/60">{hint[place]}</span>
          </button>
        ))}
      </div>
    </div>
  )
}
