// Whether the signed-in account is the platform's operator -- Red Puer
// (is_platform_admin, add_platform_admin.sql). Never on the desktop, which has
// no account; false when signed out, offline, or the function isn't there.

import { isDesktop, supabase } from './supabase'

export async function checkPlatformAdmin(): Promise<boolean> {
  if (isDesktop || !supabase) return false
  try {
    const { data } = await (supabase as any).rpc('is_platform_admin')
    return data === true
  } catch {
    return false
  }
}
