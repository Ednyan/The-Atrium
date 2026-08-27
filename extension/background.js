// The extension's whole job: take what you right-clicked and hand it to an
// atrium tab that is already open and already signed in.
//
// Nothing is uploaded from here and no credentials live here. The page does
// the work, because the page already knows who you are and which atrium you
// are looking at -- which is also why this needs a tab open, and says so
// plainly when there isn't one rather than failing quietly.

const ATRIUM_ORIGIN = 'https://the-atrium.pages.dev'

const MENUS = [
  { id: 'send-image', title: 'Send image to atrium', contexts: ['image'] },
  { id: 'send-link', title: 'Send link to atrium', contexts: ['link'] },
  { id: 'send-selection-text', title: 'Send selection to atrium as text', contexts: ['selection'] },
  // Offered alongside the text one rather than instead of it: a selected
  // address is often wanted as a live embed, but not always -- sometimes the
  // address IS the thing you want to read.
  { id: 'send-selection-embed', title: 'Send selection to atrium as embed', contexts: ['selection'] },
]

chrome.runtime.onInstalled.addListener(() => {
  // Recreated rather than added to: an update that runs this twice would
  // otherwise fail on a duplicate id and leave no menu at all.
  chrome.contextMenus.removeAll(() => {
    for (const menu of MENUS) chrome.contextMenus.create(menu)
  })
})

function notify(message) {
  chrome.notifications.create({
    type: 'basic',
    iconUrl: 'icon.png',
    title: 'Send to Atrium',
    message,
  })
}

const isWebUrl = (value) => /^https?:\/\//i.test(value || '')

// What the page should be asked to make, from what was clicked.
function payloadFor(info) {
  switch (info.menuItemId) {
    case 'send-image':
      // data: and blob: images belong to the page that made them and mean
      // nothing anywhere else, so there is no point sending one.
      if (!isWebUrl(info.srcUrl)) {
        return { error: 'That image has no web address the atrium could load.' }
      }
      return { kind: 'image', url: info.srcUrl }

    case 'send-link':
      if (!isWebUrl(info.linkUrl)) {
        return { error: 'That link does not go anywhere the atrium can reach.' }
      }
      return { kind: 'embed', url: info.linkUrl }

    case 'send-selection-text': {
      const text = (info.selectionText || '').trim()
      if (!text) return { error: 'Nothing was selected.' }
      return { kind: 'text', text }
    }

    case 'send-selection-embed': {
      // Only the selection itself, trimmed -- no attempt to find a URL buried
      // in a sentence. Guessing which of several addresses was meant is worse
      // than saying plainly that this one is not an address.
      const text = (info.selectionText || '').trim()
      if (!isWebUrl(text)) {
        return { error: 'That selection is not a web address. Send it as text instead.' }
      }
      return { kind: 'embed', url: text }
    }

    default:
      return null
  }
}

chrome.contextMenus.onClicked.addListener(async (info) => {
  const payload = payloadFor(info)
  if (!payload) return
  if (payload.error) {
    notify(payload.error)
    return
  }

  const tabs = await chrome.tabs.query({ url: `${ATRIUM_ORIGIN}/*` })
  if (tabs.length === 0) {
    notify('Open your atrium in a tab first, then try again.')
    return
  }

  // The most recently used atrium tab, which is the one you were last looking
  // at -- a better guess than the first one the browser happens to list.
  const target = tabs.reduce((best, candidate) =>
    (candidate.lastAccessed ?? 0) > (best.lastAccessed ?? 0) ? candidate : best)

  try {
    const result = await chrome.tabs.sendMessage(target.id, { type: 'atrium-send', payload })
    if (result?.ok === false) {
      notify(result.reason || 'The atrium tab could not accept that.')
      return
    }
    notify('Sent to your atrium.')
  } catch {
    // sendMessage throws when no content script is listening -- typically a
    // tab that was open before the extension was installed.
    notify('Could not reach the atrium tab. Reload it and try again.')
  }
})
