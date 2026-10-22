// Whether the signed-in account is the platform's operator -- Red Puer --
// as the Atrium's worker says (workers/rooms, people.ts isOperator: kept
// there, Supabase's add_platform_admin.sql vouching the first time), for any
// kind of account. Never on the desktop, which has no account; false when
// signed out or offline.

import { isDesktop } from './supabase'
import { toWorker } from './worker'

export async function checkPlatformAdmin(): Promise<boolean> {
  if (isDesktop) return false
  try {
    const { ok, answer } = await toWorker<{ operator?: boolean }>('/ops/operator', {}, true)
    return ok && answer?.operator === true
  } catch {
    return false
  }
}
