import { supabase, isDesktop } from './supabase'

// Answers one question: is this user entering this atrium on operator
// privilege rather than membership? That is the single condition for entering
// invisibly, and it's asked from several places (presence, active_lobby_id
// writes, the HUD indicator), so it lives here rather than being re-derived.
//
// Invisibility is not just the presence channel. The atrium browser computes
// its player counts by counting profiles rows with active_lobby_id = <lobby>,
// so a suppressed presence broadcast alone would still show "1 person here"
// in an atrium nobody is supposed to see the operator in. Callers that write
// active_lobby_id must check this first.
//
// Ordering matters for cost: is_platform_admin() is checked first and returns
// false immediately for everyone else, so ordinary users never pay for the
// second call.
export async function isGhostEntry(lobbyId: string): Promise<boolean> {
  // Desktop has no Supabase, one local user, and nobody to be invisible from.
  if (!supabase || !lobbyId || isDesktop) return false

  try {
    const { data: isAdmin } = await (supabase as any).rpc('is_platform_admin')
    if (!isAdmin) return false

    const { data: hasMemberAccess } = await (supabase as any).rpc('user_has_member_access', {
      p_lobby_id: lobbyId,
    })
    // Strict false, not falsy: a null from a failed call must not be read as
    // "not a member" and silently hide someone who should be visible.
    return hasMemberAccess === false
  } catch {
    // Functions not deployed yet, or offline: behave as a normal user.
    return false
  }
}
