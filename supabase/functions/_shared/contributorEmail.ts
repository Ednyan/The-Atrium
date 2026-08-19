// The look of mail sent to contributors.
//
// These were plain text, which is fine for a receipt and wrong for the two
// things they actually are: a thank-you, and a request. They arrive in an inbox
// beside every other message somebody gets, and the atrium's own surfaces are
// the reason anyone recognises it -- so the mail is built out of the same
// pieces. Near-black ground, bone text, one monospace face, hairlines instead
// of boxes, and the diamond.
//
// Written as tables with inline styles, because email is not the web. Gmail
// discards a <style> block when it clips a long message, Outlook renders
// through Word, and neither flexbox nor grid can be relied on anywhere. Every
// rule that matters is therefore on the element it affects.
//
// A plain-text alternative goes with every message. Some people read mail that
// way on purpose, and a client that shows the HTML as source is worse than one
// that never had it.

const BG = '#191919'
const CARD = '#1f1f1f'
const LINE = '#3a3a3a'
const TEXT = '#CBCBCB'
const BODY = '#B5B5B5'
const MUTED = '#8F8F8F'
const ACCENT = '#FF8A3D'

const MONO = "Consolas, Monaco, 'Lucida Console', 'Courier New', monospace"

// Contributor names and whatever the operator typed both end up here, and both
// are text somebody else wrote. Escaped rather than trusted.
const escapeHtml = (value: string) =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')

export interface ContributorEmail {
  heading: string
  // Blank lines separate paragraphs, which is how people write in a textarea
  // and not something they should have to think about.
  body: string
  // Set apart from the message: a reason given, or a name being quoted back.
  quote?: string
  footnote?: string
}

export function renderContributorEmail({ heading, body, quote, footnote }: ContributorEmail): {
  html: string
  text: string
} {
  const paragraphs = body
    .split(/\n\s*\n/)
    .map(part => part.trim())
    .filter(Boolean)

  const paragraphHtml = paragraphs
    .map(part =>
      `<p style="margin:0 0 16px;font-family:${MONO};font-size:14px;line-height:1.75;color:${BODY};">` +
      // Single newlines inside a paragraph are deliberate line breaks.
      escapeHtml(part).replace(/\n/g, '<br />') +
      `</p>`)
    .join('')

  const quoteHtml = quote
    ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:4px 0 20px;">
         <tr>
           <td style="width:2px;background:${ACCENT};"></td>
           <td style="padding:2px 0 2px 16px;font-family:${MONO};font-size:13px;line-height:1.7;color:${TEXT};">
             ${escapeHtml(quote).replace(/\n/g, '<br />')}
           </td>
         </tr>
       </table>`
    : ''

  const footnoteHtml = footnote
    ? `<div style="height:1px;background:${LINE};margin:26px 0 16px;line-height:1px;font-size:0;">&nbsp;</div>
       <p style="margin:0;font-family:${MONO};font-size:11px;line-height:1.8;color:${MUTED};">
         ${escapeHtml(footnote).replace(/\n/g, '<br />')}
       </p>`
    : ''

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="color-scheme" content="dark" />
<meta name="supported-color-schemes" content="dark" />
<title>${escapeHtml(heading)}</title>
</head>
<body style="margin:0;padding:0;background:${BG};">
  <!-- Shown in the inbox list under the subject, and nowhere else. -->
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;">${escapeHtml(paragraphs[0] ?? '')}</div>

  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${BG};padding:32px 16px;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:${CARD};border:1px solid ${LINE};">

          <tr>
            <td style="padding:30px 34px 0;">
              <div style="font-family:${MONO};font-size:10px;letter-spacing:3px;text-transform:uppercase;color:${MUTED};">
                The Digital Atrium
              </div>
              <div style="height:1px;background:${LINE};margin:20px 0 24px;line-height:1px;font-size:0;">&nbsp;</div>
              <div style="font-family:${MONO};font-size:15px;letter-spacing:2px;text-transform:uppercase;color:${TEXT};">
                <span style="color:${ACCENT};">&#9671;</span>&nbsp;&nbsp;${escapeHtml(heading)}
              </div>
            </td>
          </tr>

          <tr>
            <td style="padding:24px 34px 30px;">
              ${paragraphHtml}
              ${quoteHtml}
              ${footnoteHtml}
            </td>
          </tr>

        </table>

        <p style="max-width:560px;margin:16px auto 0;font-family:${MONO};font-size:10px;line-height:1.7;color:#6a6a6a;text-align:center;">
          Sent because you contributed to The Digital Atrium.
        </p>
      </td>
    </tr>
  </table>
</body>
</html>`

  // Sections separated by blank lines, which is what makes plain text readable
  // at all. Built by joining rather than by including empty strings, because
  // the obvious version filtered out the very blanks it was inserting.
  const sections = ['THE DIGITAL ATRIUM', heading.toUpperCase(), paragraphs.join('\n\n')]
  if (quote) sections.push(quote.split('\n').map(line => `  ${line}`).join('\n'))
  if (footnote) sections.push(`--\n${footnote}`)
  const text = sections.join('\n\n')

  return { html, text }
}
