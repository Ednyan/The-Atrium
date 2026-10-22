// One's own profile, whichever kind of account is signed in (lib/signedIn):
// what the profile screens show and change, and one's own atrium themes --
// one's entry in the directory (lib/people), the name public, the colour and
// themes private there, as one's email is (docs/DECENTRALIZING.md, phase 6).
// An existing account's Supabase profile is taken in there the first time
// (phase 10, step 6); until the cutover each change is copied back to it too,
// as its sign-in still reads it (App). The desktop's is its vault's.
import { cloudClient, isDesktop } from './supabase'
import { workerAccount } from './signedIn'
import { myEntry } from './people'

export interface MyProfile { username: string; displayName: string; color: string | null; nameChangedAt: number | null }

// A display name changes once in this long on the web (the directory holds
// Google accounts to it too); the desktop's, freely.
const NAME_EVERY_DAYS = 15
const DAY_MS = 24 * 60 * 60 * 1000

export async function loadMyProfile(userId: string): Promise<MyProfile | null> {
  if (!isDesktop) {
    const entry = await myEntry().catch(() => null)
    if (entry?.username || workerAccount()) {
      if (!entry) return null
      return { username: entry.username ?? '', displayName: entry.display_name || entry.username || '', color: entry.settings?.player_color ?? null, nameChangedAt: entry.name_changed_at ?? null }
    }
  }
  if (!cloudClient) return null
  const { data } = await (cloudClient.from('profiles') as any)
    .select('username, display_name, display_name_last_changed, player_color')
    .eq('id', userId)
    .maybeSingle()
  if (!data) return null
  const changed = data.display_name_last_changed ? Date.parse(data.display_name_last_changed) : NaN
  return { username: data.username, displayName: data.display_name || data.username, color: data.player_color ?? null, nameChangedAt: Number.isFinite(changed) ? changed : null }
}

/** Days until the display name may change again: 0, now (never changed, or
 *  on the desktop). From when it was changed, or when it may be again. */
export function daysUntilNameChange(changedAt: number | null, nextAt = changedAt === null ? null : changedAt + NAME_EVERY_DAYS * DAY_MS): number {
  if (isDesktop || nextAt === null) return 0
  return Math.max(0, Math.ceil((nextAt - Date.now()) / DAY_MS))
}

/** The name and colour changed as asked. A name changed too soon is refused
 *  (`NAME_TOO_SOON`, with `until`). */
export async function saveMyProfile(userId: string, change: { displayName?: string; color?: string }): Promise<void> {
  if (!isDesktop) {
    await myEntry({
      ...(change.displayName !== undefined ? { display_name: change.displayName } : {}),
      ...(change.color ? { settings: { player_color: change.color } } : {}),
    })
    if (workerAccount()) return
  }
  if (!cloudClient) throw new Error('Not signed in')
  const update: Record<string, unknown> = { updated_at: new Date().toISOString() }
  if (change.color) update.player_color = change.color
  if (change.displayName !== undefined) {
    update.display_name = change.displayName
    // The desktop's name is its username too.
    if (isDesktop) update.username = change.displayName
    else update.display_name_last_changed = new Date().toISOString()
  }
  const { error } = await (cloudClient.from('profiles') as any).update(update).eq('id', userId)
  if (error) throw error
}

/** One's own atrium themes (lib/customThemes), as stored -- unchecked. */
export async function loadMyThemes(userId: string): Promise<unknown> {
  if (!isDesktop) {
    const entry = await myEntry().catch(() => null)
    if (workerAccount()) return entry?.settings?.custom_themes ?? []
    // An existing account's, once taken in; until then (or if they couldn't be), Supabase's.
    if (entry?.settings?.custom_themes !== undefined) return entry.settings.custom_themes
  }
  if (!cloudClient) return []
  const { data, error } = await (cloudClient.from('profiles') as any).select('custom_themes').eq('id', userId).maybeSingle()
  if (error) throw error
  return data?.custom_themes ?? []
}
export async function saveMyThemes(userId: string, themes: unknown[]): Promise<void> {
  if (!isDesktop) {
    await myEntry({ settings: { custom_themes: themes } })
    if (workerAccount()) return
  }
  if (!cloudClient) throw new Error('Not signed in')
  const { error } = await (cloudClient.from('profiles') as any).update({ custom_themes: themes }).eq('id', userId)
  if (error) throw error
}
