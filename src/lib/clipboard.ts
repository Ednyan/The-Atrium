import { showToast } from './toast'

// Shared so the in-atrium HUD and the atrium browser stay consistent, and so
// the failure case is handled in one place rather than being forgotten in one
// of them.
export async function copyLobbyId(lobbyId: string) {
  try {
    await navigator.clipboard.writeText(lobbyId)
    showToast('Atrium ID copied')
  } catch {
    // writeText rejects on a denied permission or a non-secure context, and
    // the old code never awaited it -- so a failed copy still claimed success
    // and left the user pasting whatever was there before.
    showToast('Could not copy -- check clipboard permissions')
  }
}
