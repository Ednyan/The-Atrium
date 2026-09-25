// Frames the video named in ?src=, for the desktop app on macOS and Linux --
// see throughRelay in src/lib/embedUrl.ts, which sends it here. From this page
// the player is sent the site's address as its Referer, which YouTube requires
// and a tauri:// page can't give.
//
// Only these hosts, over https: anything else is left unframed. The app keeps
// the same list (RELAYED_HOSTS); tests/embedUrl.test.ts checks the two agree.
const RELAYED_HOSTS = ['www.youtube.com', 'www.youtube-nocookie.com', 'player.vimeo.com']

;(() => {
  let url
  try {
    url = new URL(new URLSearchParams(location.search).get('src') || '')
  } catch {
    return
  }
  if (url.protocol !== 'https:' || !RELAYED_HOSTS.includes(url.hostname)) return
  const frame = document.createElement('iframe')
  frame.src = url.href
  frame.allow = 'accelerometer; autoplay; encrypted-media; gyroscope; picture-in-picture; fullscreen'
  frame.allowFullscreen = true
  frame.referrerPolicy = 'strict-origin-when-cross-origin'
  document.body.append(frame)
})()
