import { showToast } from './toast'
import { t } from './i18n'

// Text to the clipboard, saying so -- or saying it couldn't. writeText rejects
// on a denied permission or a non-secure context; not awaited, as it once
// wasn't, a failed copy still claimed success and left the user pasting
// whatever was there before.
export async function copyText(text: string, copied: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    showToast(copied)
    return true
  } catch {
    showToast(t('share.copyFailed'))
    return false
  }
}

// Shared by the atrium browser and the atrium's Share panel.
export const copyLobbyId = (lobbyId: string) => copyText(lobbyId, t('share.idCopied'))
