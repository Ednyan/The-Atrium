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
// swallowed into it.
const YOUTUBE = /(?:youtube\.com\/(?:watch\?v=|shorts\/|live\/)|youtu\.be\/)([^&?\s/]+)/
// Only Shorts, which are the vertical ones.
const YOUTUBE_SHORT = /youtube\.com\/shorts\//
// Drive file ids appear either after /d/ or as an id= query parameter,
// depending on which share dialog produced the link.
const DRIVE_FILE = /drive\.google\.com\/file\/d\/([\w-]+)/
const DRIVE_ID_PARAM = /drive\.google\.com\/(?:open|uc)\?(?:[^#]*&)?id=([\w-]+)/
const DRIVE_FOLDER = /drive\.google\.com\/drive\/(?:u\/\d+\/)?folders\/([\w-]+)/
// Docs, Sheets and Slides share a shape but not an embed path.
const GOOGLE_DOC = /docs\.google\.com\/(document|spreadsheets|presentation|forms)\/d\/(?:e\/)?([\w-]+)/

export function toEmbedUrl(rawUrl: string): string {
  const url = rawUrl.trim()
  if (!url) return rawUrl

  const youtube = url.match(YOUTUBE)
  if (youtube) return `https://www.youtube.com/embed/${youtube[1]}`

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

  // Slides and ordinary video keep the 16:9 default.
  if (/presentation|youtube|youtu\.be/.test(url)) return null

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
