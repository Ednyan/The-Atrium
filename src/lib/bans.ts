// Bans, the platform's operator's (Developers page, components/BansTool).
// The ban is the worker's -- everything it runs refuses the account
// (workers/rooms, people.ts) -- and an existing account's is Supabase's too,
// so it can't sign in there (supabase/functions/ban-account). Both, in that
// order; a step that fails says so, and asking again finishes it.
import { cloudClient } from './supabase'
import { toWorker } from './worker'

export interface Ban { account: string; username: string | null; kind: 'google' | 'supabase'; reason: string | null; at: number }

async function ask<T>(what: 'ban' | 'unban' | 'bans', body: object = {}): Promise<T> {
  const { ok, answer } = await toWorker<T & { error?: string }>(`/people/${what}`, body, true)
  if (!ok) throw new Error(answer?.error || 'The directory refused it')
  return answer as T
}

// An existing account's Supabase half.
async function inSupabase(action: 'ban' | 'unban', id: string): Promise<void> {
  const { data, error } = await cloudClient.functions.invoke('ban-account', { body: { action, id } })
  if (error || data?.error) throw new Error(data?.error || error?.message || 'Supabase refused it')
}

export const listBans = () => ask<Ban[]>('bans')

export async function banAccount(username: string, reason: string): Promise<void> {
  const banned = await ask<{ account: string; kind: Ban['kind'] }>('ban', { username, reason })
  if (banned.kind === 'supabase') await inSupabase('ban', banned.account)
}

export async function unbanAccount(ban: Ban): Promise<void> {
  await ask('unban', { account: ban.account })
  if (ban.kind === 'supabase') await inSupabase('unban', ban.account)
}
