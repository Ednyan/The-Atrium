// Bridges the extension to the page.
//
// A content script shares the page's DOM but not its JavaScript world, so it
// cannot call into the app directly. window.postMessage is the crossing, and
// it is targeted at this page's own origin rather than '*' so the message
// cannot be read by an embedded frame from somewhere else.

const TEXT_LIMIT = 5000

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type !== 'atrium-send') {
    return false
  }

  const payload = message.payload || {}
  const outgoing = { source: 'atrium-extension', kind: payload.kind }

  if (payload.kind === 'image' || payload.kind === 'embed') {
    if (!/^https?:\/\//i.test(payload.url || '')) {
      sendResponse({ ok: false, reason: 'That address is not one the atrium can load.' })
      return false
    }
    outgoing.url = payload.url
  } else if (payload.kind === 'text') {
    const text = (payload.text || '').trim()
    if (!text) {
      sendResponse({ ok: false, reason: 'Nothing was selected.' })
      return false
    }
    // Trimmed here as well as in the app: no reason to hand a whole article
    // across the boundary when only this much of it will be kept.
    outgoing.text = text.slice(0, TEXT_LIMIT)
  } else {
    sendResponse({ ok: false, reason: 'Unrecognised request.' })
    return false
  }

  window.postMessage(outgoing, window.location.origin)

  // Says the message was delivered to the page, not that a trace was made --
  // the page decides that, and will say so itself if it cannot.
  sendResponse({ ok: true })
  return false
})
