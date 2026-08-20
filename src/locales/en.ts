// English, and the source of truth.
//
// Every other language is a partial copy of this file: its type defines what a
// key is, so a typo in a t() call is a compile error rather than a blank
// button, and a key missing from a translation falls back to the English here
// rather than showing the key itself. That fallback is what makes translating
// this app safe to do a surface at a time -- a half-finished language reads as
// a half-translated app, never a broken one.
//
// Keys are namespaced by where the words appear: `welcome.*` is the welcome
// screen, `browser.*` the atrium browser, `common.*` anything that shows up in
// several places. Keep them greppable -- the key should be enough to find the
// screen without running the app.
//
// {braces} are filled in by t(key, { ... }). A translator moving them around
// inside the sentence is expected; dropping one is a bug.

export const en = {
  // ------------------------------------------------------------ everywhere
  'common.cancel': 'Cancel',
  'common.save': 'Save',
  'common.close': 'Close',
  'common.back': 'Back',
  'common.delete': 'Delete',
  'common.confirm': 'Confirm',
  'common.loading': 'Loading',
  'common.copy': 'Copy',
  'common.copied': 'Copied',
  'common.language': 'Language',
  'common.theme': 'Theme',

  // -------------------------------------------------------- welcome screen
  'welcome.enter': 'Enter the Atrium',
  'welcome.settings': 'Profile Settings',
  'welcome.contributors': 'Contributors',
  'welcome.language': 'Language',
  'welcome.about': 'About',
  'welcome.fullscreen': 'Fullscreen',
  'welcome.windowed': 'Windowed',
  'welcome.logOut': 'Log Out',
  'welcome.exit': 'Exit Application',
  'welcome.useBrowserLanguage': "Use my browser's",

  // -------------------------------------------------------- atrium browser
  'browser.title': 'Atriums',
  'browser.create': 'Create New Atrium',
  'browser.createCommit': 'Create Atrium',
  'browser.enter': 'Enter',
  'browser.copyId': 'Copy Atrium ID',
  'browser.yours': 'Your Atriums',
  'browser.public': 'Public Atriums',
  'browser.empty': 'No atriums yet',
  'browser.nameLabel': 'Name',
  'browser.namePlaceholder': 'Enter name...',
  'browser.secured': 'Secured',

  // ---------------------------------------------------------- in an atrium
  'atrium.save': 'Save Changes',
  'atrium.saving': 'Saving',
  'atrium.saved': 'Saved',
  'atrium.leave': 'Leave Atrium',
  'atrium.hideUi': 'Hide UI',
  'atrium.showUi': 'Show UI',
  'atrium.fullscreen': 'Fullscreen',
  'atrium.draw': 'Draw',
  'atrium.locations': 'Locations',
  'atrium.layers': 'Layers',
  'atrium.customize': 'Customize',
  'atrium.batchEdit': 'Batch Edit ({count})',

  // ------------------------------------------------------------- donating
  'donate.tooltip': 'Support the creator',
  'donate.heading': 'Donate',
  'support.title': 'Support the creator',
  'support.who': 'The Digital Atrium is made and kept running by one person: Eduardo Paranhos, a 3D artist who got tired of hoarding reference images across scattered folders and built the thing he wanted instead.',
  'support.costs': "It stands on things that are paid for every month -- the database your atriums live in, the domain above it and more. Left unpaid it stops.",
  'support.ask': 'Donating keeps the lights on and the work going. Even €1 helps, and it is what decides whether the next thing gets built.',
  'support.wall': 'Every contribution puts a name on the contributors wall — a room of its own, built out of the people holding this place up.',
  'support.seeWall': 'See the wall',
  'support.connect': 'Connect with me',
  'support.website': 'Website',
  'support.websiteNote': 'Portfolio and work',
  'support.instagram': 'Instagram',
  'support.instagramNote': 'Pictures of things',
  'support.youtube': 'Youtube',
  'support.youtubeNote': 'Videos',
  'support.email': 'Email',
  'support.emailNote': 'Say something',

  // --------------------------------------------------------- the front page
  'landing.nav.preview': 'Preview',
  'landing.nav.support': 'Support Me',
  'landing.nav.creator': 'The Creator',
  'landing.nav.about': 'About',
  'landing.nav.limitations': 'Limitations',
  'landing.nav.desktop': 'Desktop App',
  'landing.nav.navigation': 'Navigation',
  'landing.madeBy': 'Made by',
  'landing.aboutCreator': 'About the creator',
  'landing.donate': 'Donate',
  'landing.enter': 'Enter The Atrium',
  'landing.continue': 'Continue to Atrium',
  'landing.connect': 'Connect with me',
  'landing.privacy': 'Privacy Policy',
  'landing.terms': 'Terms of Service',
} as const

export type TranslationKey = keyof typeof en
export type Catalogue = Partial<Record<TranslationKey, string>>
