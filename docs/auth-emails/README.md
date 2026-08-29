# Auth email templates

The mail Supabase Auth sends — confirm your account, reset your password.
These are **not** sent by any code in this repo. Supabase sends them itself,
from templates stored in the dashboard, so the files here are the source of
truth that the dashboard is a copy of. Edit the file, paste it in.

Everything else the atrium sends — the welcome, contributor notes, feedback
reports — goes through `supabase/functions/_shared/atriumEmail.ts` and needs
none of this.

## Where each one goes

Dashboard → **Authentication** → **Emails** → **Templates**.

| File | Template |
| --- | --- |
| `confirm-signup.html` | Confirm signup |
| `reset-password.html` | Reset password |

Paste the whole file into the **Message body** box and save. The subject line
is a separate field above it:

- Confirm signup → `Confirm your account`
- Reset password → `Reset your password`

The other templates in that list — Invite user, Magic Link, Change Email
Address, Reauthentication — are left at Supabase's defaults on purpose. The
app triggers none of them (`AuthScreen.tsx` calls only `signUp` and
`resetPasswordForEmail`), so nobody receives them, and a styled template for
mail that never sends is a thing to keep in sync for nothing. If a flow is
ever added, copy `confirm-signup.html` and change the heading, the body and
the button.

## Things worth knowing before editing

**`{{ .ConfirmationURL }}` is the link.** It appears twice in each file — the
button and the pasteable URL underneath. Change one, change both. Supabase
offers other variables (`{{ .Token }}`, `{{ .Email }}`, `{{ .SiteURL }}`);
the six-digit `{{ .Token }}` is deliberately not used, because the app has
nowhere to type a code and an instruction that cannot be followed is worse
than no instruction.

**These are English only.** Supabase stores one template per type, and the
sending happens inside Auth with no idea what language the person was
reading. The welcome email *is* translated into all eleven, because the app
sends that one itself and can say. Nothing can be done here short of
replacing Auth's mail with our own function — worth it eventually, not worth
it yet.

**Expiry is described vaguely on purpose.** "Only for a short while" rather
than a number, because the real duration is an Auth setting that can change
underneath this text. If it's pinned and you want the number, it's
Authentication → Emails → the OTP expiry field.

**The styling is inline and table-based**, matching `atriumEmail.ts` for the
same reason: Gmail drops `<style>` blocks when it clips a long message and
Outlook renders through Word. Keep new rules on the elements they affect.

## The sender address

Separate setting, and the one that actually breaks sign-up if it's wrong:
**Authentication → Emails → SMTP Settings**. That is where the "from" address
on these two messages is configured — not in any file here.

It must be on a domain verified in Resend. `mail.scenefoundry.studio` must
not be deleted from Resend until this has been moved to
`mail.digitalatrium.org` and a real sign-up has been tested, or account
confirmation fails silently.

## Checking a change

There is no preview that renders like a real client. Send yourself a real
one: sign up with an address you can read (a `+tag` alias works), and use
Reset password on it afterwards. Look at it on a phone too — the card is
560px and the button is sized to be hit with a thumb.
