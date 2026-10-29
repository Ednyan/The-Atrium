// The Atrium's directory of who's who (workers/rooms, src/people.ts): someone
// found by username, their Drive key and folder, and the invitations to
// atriums kept in Google Drive. One place for every kind of account
// (docs/DECENTRALIZING.md, phase 6), reached with one's sign-in.

import { toWorker } from './worker'
import { workerUrl } from './rooms'

/** What anyone may know of someone: never their email. */
export interface Person { id: string; username: string | null; display_name: string | null; drive_key: JsonWebKey | null; drive_root: string | null; hosted_root?: string | null }
/** A Google account's own settings, private to it (lib/profile). */
export interface Settings { player_color?: string; custom_themes?: unknown[] }
export interface InvitationRow {
  id: string; from_user: string; from_name: string | null; roster: string; lobby_id: string; name: string; secret: string | null; created_at: number
  auto?: number | null
}

async function ask<T>(what: string, body: object = {}): Promise<T> {
  const { ok, status, answer } = await toWorker(`/people/${what}`, body, true)
  if (answer?.error === 'taken') throw new Error('USERNAME_TAKEN')
  // A username's availability that couldn't be checked: never taken for free.
  if (answer?.error === 'check') throw new Error('USERNAME_CHECK')
  // A display name changed again too soon: when it may be.
  if (answer?.error === 'too soon') throw Object.assign(new Error('NAME_TOO_SOON'), { until: answer.until as number })
  if (!ok) throw new Error(`The directory said ${answer?.error ?? status}`)
  return answer as T
}

type Settable = Partial<Pick<Person, 'username' | 'display_name' | 'drive_key' | 'drive_root' | 'hosted_root'>> & { settings?: Settings }
/** One's own entry, changed as asked: one's email, settings and when one's
 *  name last changed shown to oneself alone. Settings given are merged in.
 *  `language`, the page's: a Google account's welcome, as it chooses its
 *  username, is in it. */
export const myEntry = (set?: Settable, language?: string) =>
  ask<Person & { kind: string; email: string | null; settings?: Settings; name_changed_at?: number | null }>('me', { ...(set ? { set } : {}), ...(language ? { language } : {}) })
export const personNamed = async (username: string): Promise<Person | null> => (await ask<Person[]>('find', { username }))[0] ?? null
export const peopleByIds = (ids: string[]): Promise<Person[]> => (ids.length ? ask<Person[]>('find', { ids }) : Promise.resolve([]))

/** Whether a username is free across every account -- the directory's and
 *  existing accounts', compared ignoring case -- asked without signing in (a
 *  sign-up has no account yet). `mine`: one's own account, whose own name is
 *  free to it. Null when it couldn't be asked: never taken for free. */
export async function usernameAvailable(username: string, mine?: string): Promise<boolean | null> {
  try {
    const { ok, answer } = await toWorker<{ available?: unknown }>('/people/available', { username, ...(mine ? { mine } : {}) })
    return ok && typeof answer?.available === 'boolean' ? answer.available : null
  } catch {
    return null
  }
}

export const sendInvitation = (invitation: { to: string; roster: string; lobby_id: string; name: string; secret: string | null; auto?: boolean }) => ask('invite', invitation)
export const invitationsToMe = () => ask<InvitationRow[]>('invites')
/** One's invitation's secret gone, the invitation kept. */
export const clearSecret = (roster: string) => ask('clear', { roster })
/** By whom it's to or from: by its id, or by whom and which atrium. */
export const withdrawInvitation = (which: { id: string } | { to: string; roster: string }) => ask('uninvite', which)

/** A Drive atrium listed as public (phase 8): where its roster is, which says
 *  whether it really is -- the listing only points. */
export interface PublicAtrium { lobby_id: string; roster: string; name: string; owner: string; owner_name: string | null; preview_at: number | null; updated_at: number }
/** Everyone's public Drive atriums, the newest first: asked by anyone, a guest too. */
export async function publicAtriums(): Promise<PublicAtrium[]> {
  const { ok, answer } = await toWorker<PublicAtrium[]>('/people/atriums')
  return ok && Array.isArray(answer) ? answer : []
}
/** Its card's picture, from the directory: a new address with each new one. */
export const publicPreviewUrl = (atrium: Pick<PublicAtrium, 'lobby_id' | 'preview_at'>) =>
  atrium.preview_at ? `${workerUrl()}/public/${atrium.lobby_id}.webp?v=${atrium.preview_at}` : null
/** One's own atrium listed, or its listing brought up to date: its name, and
 *  its picture (WebP, base64) if there's a new one. */
export const publishAtrium = (listing: { lobby_id: string; roster: string; name: string; preview?: string }) => ask('publish', listing)
export const unpublishAtrium = (lobbyId: string) => ask('unpublish', { lobby_id: lobbyId })

/** An existing account's name, in the directory -- where others find it to
 *  add it to a Drive atrium. Once a visit, and only if the directory doesn't
 *  have it so already (its entry is read at the page's start anyway): it was
 *  written on every visit, a request each. A username already someone else's
 *  there stays theirs. */
let published = ''
export function publishAccount(id: string, username: string, displayName: string | null): void {
  if (published === `${id}/${username}/${displayName}`) return
  published = `${id}/${username}/${displayName}`
  void (async () => {
    const entry = await myEntry().catch(() => null)
    if (entry && entry.username === username && (entry.display_name ?? null) === displayName) return
    await myEntry({ username, display_name: displayName })
  })().catch(error => console.info('[atrium] the directory:', error instanceof Error ? error.message : error))
}
