// Asking for the welcome email, once somebody with a confirmed account is
// actually here.
//
// The app does not decide whether to send. It only says "this session has
// arrived"; the send-welcome function checks the account is confirmed, checks
// nobody has been welcomed already, and stamps the profile before it sends. So
// this can be called freely -- on every sign-in, on every page load, twice by
// accident -- and at most one message goes out.
//
// The flag below is not what makes that safe; it just avoids a pointless
// round trip on a page that establishes its session twice, which App does.
//
// Desktop has no Functions endpoint (see the platform split in CLAUDE.md), and
// a desktop vault has no account to welcome, so it never asks.

import { supabase, isDesktop } from './supabase'
import { currentLanguage } from './i18n'

let asked = false

export async function maybeSendWelcome(): Promise<void> {
  if (asked || isDesktop) return
  if (!supabase || typeof supabase.functions?.invoke !== 'function') return
  asked = true

  try {
    await supabase.functions.invoke('send-welcome', {
      // The language the interface is in. The function falls back to English
      // for anything it does not have copy for, rather than guessing from an
      // IP address -- which would be a guess about a country, not a language.
      body: { language: currentLanguage() },
    })
  } catch {
    // A welcome that failed to send is not worth interrupting a sign-in for.
    // The stamp on the profile means it will not be retried, which is the
    // right trade: a missed greeting is a small loss, two greetings is the
    // kind of thing people notice and mention.
  }
}
