// One's own profile, whichever kind of account is signed in (lib/signedIn):
// what the profile screens show and change, and one's own atrium themes. An
// existing account's is its Supabase profile -- always the cloud's
// (cloudClient), never a browser atrium's copy of it. A Google account's is
// its entry in the directory (lib/people): the name public, its colour and
// themes private there, as its email is (docs/DECENTRALIZING.md, phase 6).
import { cloudClient, isDesktop } from './supabase'
import { workerAccount } from './signedIn'
import { myEntry } from './people'

export interface MyProfile { username: string; displayName: string; color: string | null; nameChangedAt: number | null }

// A display name changes once in this long on the web (the directory holds
// Google accounts to it too); the desktop's, freely.
const NAME_EVERY_DAYS = 15
const DAY_MS = 24 * 60 * 60 * 1000

export async function loadMyProfile(userId: string): Promise<MyProfile | null> {
  if (workerAccount()) {
    const entry = await myEntry()
    return { username: entry.username ?? '', displayName: entry.display_name || entry.username || '', color: entry.settings?.player_color ?? null, nameChangedAt: entry.name_changed_at ?? null }
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
  if (workerAccount()) {
    await myEntry({
      ...(change.displayName !== undefined ? { display_name: change.displayName } : {}),
      ...(change.color ? { settings: { player_color: change.color } } : {}),
    })
    return
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
  // Who's who for Drive atriums (lib/people) says the new name too.
  if (change.displayName !== undefined && !isDesktop) void myEntry({ display_name: change.displayName }).catch(() => {})
}

/** One's own atrium themes (lib/customThemes), as stored -- unchecked. */
export async function loadMyThemes(userId: string): Promise<unknown> {
  if (workerAccount()) return (await myEntry()).settings?.custom_themes ?? []
  if (!cloudClient) return []
  const { data, error } = await (cloudClient.from('profiles') as any).select('custom_themes').eq('id', userId).maybeSingle()
  if (error) throw error
  return data?.custom_themes ?? []
}
export async function saveMyThemes(userId: string, themes: unknown[]): Promise<void> {
  if (workerAccount()) {
    await myEntry({ settings: { custom_themes: themes } })
    return
  }
  if (!cloudClient) throw new Error('Not signed in')
  const { error } = await (cloudClient.from('profiles') as any).update({ custom_themes: themes }).eq('id', userId)
  if (error) throw error
}
