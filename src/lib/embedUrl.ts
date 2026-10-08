// Turns a link someone pasted into the URL an iframe can actually show.
//
// Applied when the embed is rendered rather than when it's created, so the
// trace keeps the original link the user pasted -- that's what the
// click-through and the link-card fallback want, and it means existing traces
// start working without touching stored data.
//
// Every conversion here is idempotent: an already-embeddable URL passes
// through unchanged, so running this twice is harmless.

// Shorts and live carry the id in the path rather than in ?v=, and neither
// form can be framed as it stands -- youtube.com/shorts/ID refuses to embed and
// shows nothing. The id is the same id, so all four shapes fold into the one
// /embed/ URL that works.
//
// The id stops at a slash as well as at ? and &, or a trailing segment would be
// swallowed into it. v= is found wherever it sits in the query: links copied
// from the app or the mobile site put something before it (?feature=share&v=,
// ?app=desktop&v=), and those were left unconverted -- a blank frame.
const YOUTUBE = /(?:youtube\.com\/(?:watch\?(?:[^#\s]*&)?v=|shorts\/|live\/)|youtu\.be\/)([^&?#\s/]+)/
// Only Shorts, which are the vertical ones.
const YOUTUBE_SHORT = /youtube\.com\/shorts\//
// Drive file ids appear either after /d/ or as an id= query parameter,
// depending on which share dialog produced the link.
const DRIVE_FILE = /drive\.google\.com\/file\/d\/([\w-]+)/
const DRIVE_ID_PARAM = /drive\.google\.com\/(?:open|uc)\?(?:[^#]*&)?id=([\w-]+)/
const DRIVE_FOLDER = /drive\.google\.com\/drive\/(?:u\/\d+\/)?folders\/([\w-]+)/
// Docs, Sheets and Slides share a shape but not an embed path.
const GOOGLE_DOC = /docs\.google\.com\/(document|spreadsheets|presentation|forms)\/d\/(?:e\/)?([\w-]+)/
// A SoundCloud page -- a track, a playlist (/sets/), a profile -- refuses to
// be framed; SoundCloud's player takes the page's address and plays it. Its
// player (w.soundcloud.com) is left alone.
const SOUNDCLOUD = /^https?:\/\/(?:www\.|m\.|on\.)?soundcloud\.com\/[^\s]+/i
const SOUNDCLOUD_LIST = /soundcloud\.com(?:\/|%2F)[^\s]*(?:\/|%2F)(?:sets|playlists)(?:\/|%2F)/i

// A YouTube video's id, from any of its addresses -- a watch page, a short,
// youtu.be, or the player toEmbedUrl makes of them.
export function youtubeId(url: string): string | null {
  return url.match(YOUTUBE)?.[1] ?? url.match(/youtube(?:-nocookie)?\.com\/embed\/([^?#/\s]+)/)?.[1] ?? null
}

export function toEmbedUrl(rawUrl: string): string {
  const url = rawUrl.trim()
  if (!url) return rawUrl

  const youtube = url.match(YOUTUBE)
  if (youtube) return `https://www.youtube.com/embed/${youtube[1]}`

  if (SOUNDCLOUD.test(url)) return `https://w.soundcloud.com/player/?url=${encodeURIComponent(url.split(/[?#]/)[0])}`

  // Already an embeddable Google URL -- leave it alone rather than risk
  // rewriting a link the user deliberately crafted.
  if (/\/(preview|embed|embeddedfolderview)\b/.test(url) && /google\.com/.test(url)) {
    return url
  }

  const driveFile = url.match(DRIVE_FILE) ?? url.match(DRIVE_ID_PARAM)
  if (driveFile) return `https://drive.google.com/file/d/${driveFile[1]}/preview`

  const folder = url.match(DRIVE_FOLDER)
  if (folder) return `https://drive.google.com/embeddedfolderview?id=${folder[1]}#grid`

  const doc = url.match(GOOGLE_DOC)
  if (doc) {
    const [, kind, id] = doc
    // Slides uses /embed; the others use /preview. Forms is /viewform, since
    // a form has no preview mode and /preview just 404s.
    if (kind === 'presentation') return `https://docs.google.com/presentation/d/${id}/embed`
    if (kind === 'forms') return `https://docs.google.com/forms/d/e/${id}/viewform?embedded=true`
    return `https://docs.google.com/${kind}/d/${id}/preview`
  }

  return url
}

// A starting box that suits what's being embedded.
//
// Embeds default to 16:9, which is right for video and slides and wrong for
// everything else -- a Drive PDF or a Google Doc in a 16:9 box is a page
// letterboxed into a strip. The iframe itself fills whatever box the trace
// has (it's width and height 100%, not the fixed pixel height a web page
// would use), so this only decides where the trace starts; it stays freely
// resizable afterwards.
export function defaultEmbedBox(rawUrl: string): { width: number; height: number } | null {
  const url = rawUrl.trim()

  // A Short is shot vertically, so a 16:9 box gives it two black pillars and a
  // postage stamp between them. Roughly 9:16 instead, at about the height the
  // page-shaped embeds below use.
  if (YOUTUBE_SHORT.test(url)) return { width: 338, height: 600 }

  // An ordinary video at YouTube's own embed size. The 16:9 default is only
  // 300 wide, where YouTube switches to its mini player: the title bar and
  // overlays cover most of the picture and the controls are crowded out.
  if (/youtube\.com|youtu\.be/.test(url)) return { width: 560, height: 315 }

  // SoundCloud's player as SoundCloud sizes it: a strip for a track, taller
  // for a playlist's list.
  if (/soundcloud\.com/.test(url)) return { width: 560, height: SOUNDCLOUD_LIST.test(url) ? 450 : 166 }

  // Slides keep the 16:9 default.
  if (/presentation/.test(url)) return null

  // Documents, spreadsheets and Drive files are usually pages: A4-ish
  // portrait, matching the size PDF traces are created at.
  if (/docs\.google\.com\/(document|spreadsheets|forms)/.test(url)) return { width: 424, height: 600 }
  if (/drive\.google\.com\/file\//.test(url)) return { width: 424, height: 600 }

  // A folder listing is a grid, so it wants breadth more than height.
  if (/drive\.google\.com\/(drive\/|embeddedfolderview)/.test(url)) return { width: 500, height: 360 }

  return null
}

// True when a URL is a Google embed, which the renderer needs to know because
// Drive refuses to be framed unless the file is shared with "anyone with the
// link" -- a blank frame there is a permissions problem, not a broken link,
// and saying so saves a lot of guessing.
export function isGoogleEmbed(url: string): boolean {
  return /(?:drive|docs)\.google\.com/.test(url)
}

// Videos, framed for the desktop app on macOS and Linux.
//
// There the app's pages are tauri://localhost, and a page with no http(s)
// address sends no Referer with the frames it loads. YouTube now refuses to
// play without one -- "Error 153, video player configuration error" -- so
// embedded videos showed and would not play on a Mac. Framed from a page on the
// site (public/embed/), the player is sent the site's address instead. Windows
// serves the app from http://tauri.localhost, and the web from the site itself,
// so neither needs it.
//
// The page frames only these hosts, and names them itself: the two lists are
// checked against each other in tests/embedUrl.test.ts.
export const EMBED_RELAY = 'https://digitalatrium.org/embed/'
export const RELAYED_HOSTS = ['www.youtube.com', 'www.youtube-nocookie.com', 'player.vimeo.com']

export function throughRelay(embedUrl: string): string {
  try {
    const url = new URL(embedUrl)
    if (url.protocol !== 'https:' || !RELAYED_HOSTS.includes(url.hostname)) return embedUrl
    return `${EMBED_RELAY}?src=${encodeURIComponent(url.href)}`
  } catch {
    return embedUrl
  }
}

// Every web link in `text`: http(s) ones as they're written, and a bare
// address (example.com/page) given its https. In the order they appear.
export function linksIn(text: string): string[] {
  const found: string[] = []
  for (const word of text.split(/\s+/)) {
    const candidate = /^https?:\/\//i.test(word) ? word : /^[\w-]+(\.[\w-]+)*\.[a-z]{2,}(\/\S*)?$/i.test(word) ? `https://${word}` : null
    if (!candidate) continue
    try {
      const url = new URL(candidate)
      if (url.protocol === 'http:' || url.protocol === 'https:') found.push(candidate)
    } catch { /* not a link */ }
  }
  return found
}

// What can be embedded from what someone pasted. A site's embed code
// (SoundCloud's, YouTube's: <iframe src="..."></iframe>, often with credit
// links after it) is read for where its frames point, and only that is kept
// -- the code itself is never run, which is what would make it dangerous: a
// frame's address goes into the atrium's own sandboxed frame like any link.
// Anything else: every link in it (linksIn).
export function embedSourcesIn(text: string): string[] {
  if (!/<iframe\b/i.test(text)) return linksIn(text)
  const sources: string[] = []
  for (const match of text.matchAll(/<iframe\b[^>]*?\ssrc\s*=\s*(["'])(.*?)\1/gis)) {
    const src = match[2].trim().replace(/&amp;/g, '&')
    try {
      const url = new URL(src.startsWith('//') ? `https:${src}` : src)
      if (url.protocol === 'http:' || url.protocol === 'https:') sources.push(url.href)
    } catch { /* not an address */ }
  }
  return sources
}
