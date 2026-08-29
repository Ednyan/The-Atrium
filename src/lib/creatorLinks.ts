// Where else to find the person who made this, in one place.
//
// The same four links were written out in the landing page's Connect band and
// again in the Support card, and were about to be written a third time for the
// welcome screen's creator panel. A URL that lives in three files is a URL
// that gets changed in two of them.

export interface CreatorLink {
  // Matches the catalogue keys `support.<key>` (the label) and
  // `support.<key>Note` (the line under it), so the list carries no English.
  key: 'website' | 'instagram' | 'youtube' | 'email'
  url: string
}

export const CREATOR_LINKS: CreatorLink[] = [
  { key: 'website', url: 'https://mindeformer.wixstudio.com/mindeformer' },
  { key: 'instagram', url: 'https://www.instagram.com/red.puer/' },
  { key: 'youtube', url: 'https://www.youtube.com/@mindeformer' },
  { key: 'email', url: 'mailto:thedigitalatrium@gmail.com' },
]

// The website, for the desktop app to point at.
//
// Not hardcoded anywhere else in the app, and written once here so that the
// day a custom domain replaces this one it is a single edit rather than a
// search. The desktop build has no address bar of its own, so this is the only
// way somebody inside it reaches the site.
export const ATRIUM_WEBSITE = 'https://digitalatrium.org'
