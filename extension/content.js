// Bridges the extension to the page.
//
// A content script shares the page's DOM but not its JavaScript world, so it
// cannot call into the app directly. window.postMessage is the crossing, and
// it is targeted at this page's own origin rather than '*' so the message
// cannot be read by an embedded frame from somewhere else.

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type !== 'atrium-send-image') {
    return false
  }

  if (!/^https?:\/\//i.test(message.url || '')) {
    sendResponse({ ok: false, reason: 'That image address is not one the atrium can load.' })
    return false
  }

  window.postMessage(
    { source: 'atrium-extension', kind: 'image', url: message.url },
    window.location.origin,
  )

  // Says the message was delivered to the page, not that a trace was made --
  // the page decides that, and will say so itself if it cannot.
  sendResponse({ ok: true })
  return false
})
