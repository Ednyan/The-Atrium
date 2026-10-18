// Whether the signed-in account is the platform's operator -- Red Puer
// (is_platform_admin, add_platform_admin.sql). Never on the desktop, which has
// no account; false when signed out, offline, or the function isn't there.

import { cloudClient, isDesktop } from './supabase'

// The account's, so always asked of the cloud: inside a browser atrium,
// `supabase` is its engine, which has no such function.
export async function checkPlatformAdmin(): Promise<boolean> {
  if (isDesktop || !cloudClient) return false
  try {
    const { data } = await (cloudClient as any).rpc('is_platform_admin')
    return data === true
  } catch {
    return false
  }
}
