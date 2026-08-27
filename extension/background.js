// The extension's whole job: take the address of the image you right-clicked
// and hand it to an atrium tab that is already open and already signed in.
//
// Nothing is uploaded from here and no credentials live here. The page does
// the work, because the page already knows who you are and which atrium you
// are looking at -- which is also why this needs a tab open, and says so
// plainly when there isn't one rather than failing quietly.

const ATRIUM_ORIGIN = 'https://the-atrium.pages.dev'
const MENU_ID = 'send-image-to-web-atrium'

chrome.runtime.onInstalled.addListener(() => {
  // Recreated rather than added to: an update that runs this twice would
  // otherwise fail on a duplicate id and leave no menu at all.
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: MENU_ID,
      title: 'Send to web atrium',
      contexts: ['image'],
    })
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

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId !== MENU_ID) return

  const url = info.srcUrl
  // data: and blob: images belong to the page that made them and mean nothing
  // anywhere else, so there is no point sending one.
  if (!url || !/^https?:\/\//i.test(url)) {
    notify("That image has no web address the atrium could load.")
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
    const result = await chrome.tabs.sendMessage(target.id, { type: 'atrium-send-image', url })
    if (result?.ok === false) {
      notify(result.reason || 'The atrium tab could not accept that image.')
      return
    }
    notify('Sent to your atrium.')
  } catch {
    // sendMessage throws when no content script is listening -- typically a
    // tab that was open before the extension was installed.
    notify('Could not reach the atrium tab. Reload it and try again.')
  }

  void tab
})
