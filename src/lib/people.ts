// The Atrium's directory of who's who (workers/rooms, src/people.ts): someone
// found by username, their Drive key and folder, and the invitations to
// atriums kept in Google Drive. One place for every kind of account
// (docs/DECENTRALIZING.md, phase 6), reached with one's sign-in.

import { accountToken } from './signedIn'
import { workerUrl } from './rooms'

/** What anyone may know of someone: never their email. */
export interface Person { id: string; username: string | null; display_name: string | null; drive_key: JsonWebKey | null; drive_root: string | null }
export interface InvitationRow {
  id: string; from_user: string; from_name: string | null; roster: string; lobby_id: string; name: string; secret: string | null; created_at: number
}

async function ask<T>(what: string, body: object = {}): Promise<T> {
  const token = await accountToken()
  if (!token) throw new Error('NOT_SIGNED_IN')
  // A plain request (a string body, no headers of its own): no preflight.
  const response = await fetch(`${workerUrl()}/people/${what}`, { method: 'POST', body: JSON.stringify({ ...body, token }) })
  const answer = await response.json().catch(() => null)
  if (!response.ok) throw new Error(answer?.error === 'taken' ? 'USERNAME_TAKEN' : `The directory said ${answer?.error ?? response.status}`)
  return answer as T
}

type Settable = Partial<Pick<Person, 'username' | 'display_name' | 'drive_key' | 'drive_root'>>
/** One's own entry, changed as asked: one's email shown to oneself alone. */
export const myEntry = (set?: Settable) => ask<Person & { kind: string; email: string | null }>('me', set ? { set } : {})
export const personNamed = async (username: string): Promise<Person | null> => (await ask<Person[]>('find', { username }))[0] ?? null
export const peopleByIds = (ids: string[]): Promise<Person[]> => (ids.length ? ask<Person[]>('find', { ids }) : Promise.resolve([]))

export const sendInvitation = (invitation: { to: string; roster: string; lobby_id: string; name: string; secret: string | null }) => ask('invite', invitation)
export const invitationsToMe = () => ask<InvitationRow[]>('invites')
/** One's invitation's secret gone, the invitation kept. */
export const clearSecret = (roster: string) => ask('clear', { roster })
/** By whom it's to or from: by its id, or by whom and which atrium. */
export const withdrawInvitation = (which: { id: string } | { to: string; roster: string }) => ask('uninvite', which)

/** An existing account's name, in the directory -- where others find it to
 *  add it to a Drive atrium. Once a visit; a username already someone
 *  else's there stays theirs. */
let published = ''
export function publishAccount(id: string, username: string, displayName: string | null): void {
  if (published === `${id}/${username}/${displayName}`) return
  published = `${id}/${username}/${displayName}`
  void myEntry({ username, display_name: displayName }).catch(error => console.info('[atrium] the directory:', error instanceof Error ? error.message : error))
}
