// Who's signed in, as the Atrium's worker knows them (docs/DECENTRALIZING.md,
// phase 6): for now an account of Supabase's, by its sign-in.

import { cloudClient } from './supabase'

/** The token the worker knows one by -- the directory, the rooms. */
export async function accountToken(): Promise<string | null> {
  const session = (await cloudClient?.auth.getSession())?.data.session
  return session?.access_token ?? null
}
