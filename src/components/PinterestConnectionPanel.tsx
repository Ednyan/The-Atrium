import { useEffect, useState } from 'react'
import { isDesktop } from '../lib/supabase'
import { useTranslation } from '../lib/i18n'
import {
  disconnectPinterest,
  getPinterestConnectionStatus,
  initiatePinterestConnect,
  isPinterestConfigured,
} from '../lib/pinterest'
import { redeemPinterestPairingCode } from '../lib/pinterestDesktop'
import { openExternalUrl } from '../lib/openExternal'
import { ATRIUM_WEBSITE } from '../lib/creatorLinks'
import { showToast } from '../lib/toast'
import PinterestMark from './PinterestMark'

// Connecting Pinterest, as a screen of its own.
//
// It used to be a section inside Profile Settings, several scrolls down among
// the username and the cursor colour -- which is a reasonable place for a
// setting and a poor one for a feature nobody knows exists yet. It has its own
// row on the welcome screen now.
export default function PinterestConnectionPanel({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation()
  const [checking, setChecking] = useState(true)
  const [connected, setConnected] = useState(false)
  const [username, setUsername] = useState<string | null>(null)
  const [disconnecting, setDisconnecting] = useState(false)
  const [codeInput, setCodeInput] = useState('')
  const [linkBusy, setLinkBusy] = useState(false)
  const [linkError, setLinkError] = useState<string | null>(null)

  const loadStatus = async () => {
    setChecking(true)
    const { connected: isConnected, username: name } = await getPinterestConnectionStatus()
    setConnected(isConnected)
    setUsername(name)
    setChecking(false)
  }

  useEffect(() => {
    void loadStatus()
  }, [])

  const handleLink = async () => {
    setLinkBusy(true)
    setLinkError(null)
    try {
      await redeemPinterestPairingCode(codeInput)
      setCodeInput('')
      await loadStatus()
      showToast(t('profile.pinterestLinkedToast'))
    } catch (error: any) {
      setLinkError(error?.message || t('profile.pinterestCodeFailed'))
    } finally {
      setLinkBusy(false)
    }
  }

  const handleDisconnect = async () => {
    setDisconnecting(true)
    try {
      await disconnectPinterest()
      setConnected(false)
      setUsername(null)
    } finally {
      setDisconnecting(false)
    }
  }

  return (
    <div
      data-ui-element="true"
      className="modal-backdrop fixed inset-0 bg-nier-black/80 flex items-center justify-center z-[10000] p-4"
      onClick={onClose}
    >
      <div
        className="bg-nier-blackLight border border-nier-border/40 max-w-md w-full max-h-[90vh] relative flex flex-col"
        onClick={event => event.stopPropagation()}
      >
        <div className="absolute top-0 left-0 w-5 h-5 border-l border-t border-nier-border/60" />
        <div className="absolute top-0 right-0 w-5 h-5 border-r border-t border-nier-border/60" />
        <div className="absolute bottom-0 left-0 w-5 h-5 border-l border-b border-nier-border/60" />
        <div className="absolute bottom-0 right-0 w-5 h-5 border-r border-b border-nier-border/60" />

        <div className="flex justify-between items-center gap-3 px-6 pt-6 pb-4 shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            <PinterestMark className="w-4 h-4 shrink-0 text-nier-bg/80" />
            <h2 className="text-lg text-nier-strong tracking-[0.15em] uppercase truncate">
              {t('profile.pinterest')}
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={t('common.close')}
            className="w-8 h-8 shrink-0 flex items-center justify-center border border-nier-border/30 text-nier-bg/80 hover:text-nier-bg hover:border-nier-border/60 transition-colors"
          >
            ×
          </button>
        </div>

        <div className="px-6 pb-6 overflow-y-auto flex-1 min-h-0 space-y-3">
          {checking ? (
            <p className="text-nier-bg/70 text-[0.8rem] leading-relaxed tracking-wide">
              {t('profile.pinterestChecking')}
            </p>
          ) : connected ? (
            <>
              <div className="border border-nier-border/40 bg-nier-border/10 px-3 py-2 text-nier-bg text-[0.8rem] leading-relaxed tracking-wide">
                ✓ {username ? t('profile.pinterestConnectedAs', { name: username }) : t('profile.pinterestConnectedPlain')}
              </div>
              <button
                type="button"
                onClick={handleDisconnect}
                disabled={disconnecting}
                className="w-full py-2 border border-nier-red/40 text-nier-bg/80 text-xs tracking-[0.1em] uppercase hover:bg-nier-red/20 hover:text-nier-bg transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
              >
                {disconnecting ? t('profile.pinterestDisconnecting') : t('profile.pinterestDisconnect')}
              </button>
            </>
          ) : isDesktop ? (
            <>
              <p className="text-nier-bg/70 text-[0.8rem] leading-relaxed tracking-wide">
                {t('profile.pinterestDesktopHow')}
              </p>
              <button
                type="button"
                onClick={() => openExternalUrl(`${ATRIUM_WEBSITE}/#/link-pinterest`)}
                className="w-full py-2 border border-nier-border/40 text-nier-bg/80 text-xs tracking-[0.1em] uppercase hover:border-nier-border/70 hover:text-nier-strong transition-colors"
              >
                {t('profile.pinterestOpenBrowser')} ↗
              </button>
              <input
                type="text"
                value={codeInput}
                onChange={event => setCodeInput(event.target.value.toUpperCase())}
                placeholder="XXXXXXXX"
                maxLength={12}
                spellCheck={false}
                autoComplete="off"
                className="w-full px-3 py-2 bg-nier-black border border-nier-border/40 text-nier-bg text-sm tracking-[0.3em] uppercase text-center focus:outline-none focus:border-nier-border/70"
              />
              {linkError && (
                <p className="text-nier-red text-[0.8rem] leading-relaxed tracking-wide">{linkError}</p>
              )}
              <button
                type="button"
                onClick={handleLink}
                disabled={linkBusy || codeInput.replace(/[^A-Z0-9]/g, '').length < 8}
                className="w-full py-2 bg-nier-bg text-nier-black text-xs tracking-[0.1em] uppercase hover:bg-nier-strong transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
              >
                {linkBusy ? t('profile.pinterestLinking') : t('profile.pinterestLinkApp')}
              </button>
            </>
          ) : (
            <button
              type="button"
              onClick={initiatePinterestConnect}
              disabled={!isPinterestConfigured()}
              className="w-full py-2 bg-nier-bg text-nier-black text-xs tracking-[0.1em] uppercase hover:bg-nier-strong transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
            >
              {t('profile.pinterestConnect')}
            </button>
          )}

          <p className="text-nier-bg/70 text-[0.8rem] leading-relaxed tracking-wide">
            {t('profile.pinterestNote')}
          </p>
        </div>
      </div>
    </div>
  )
}
