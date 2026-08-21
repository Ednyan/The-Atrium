import { useEffect, useState } from 'react'
import { useTranslation } from '../lib/i18n'
import type { TranslationKey } from '../locales/en'
import RichText from './RichText'

const REPO = 'Ednyan/The-Atrium'
const RELEASES_URL = `https://github.com/${REPO}/releases/latest`

interface Build {
  os: 'Windows' | 'macOS' | 'Linux'
  // Matches the asset filename the release actually carries. Absent means no
  // build is published for that platform yet, which is shown honestly rather
  // than linking somewhere broken.
  match?: RegExp
  noteKey: TranslationKey
  // What the operating system will say the first time, and what to do about
  // it. Shown only while that platform's button is under the pointer: three
  // paragraphs of caveats standing permanently under three buttons reads as
  // a list of reasons not to download anything.
  //
  // One catalogue key per platform, not per emphasised word. An earlier
  // version keyed only the bold lead-in ("On Windows,") and left the rest of
  // the sentence hardcoded -- which reads as English with a translated word
  // stuck on the front the moment another language is chosen. RichText
  // carries the whole sentence, with *emphasis* for the bold phrases and
  // `code` for the one literal, never-translated shell command.
  noteKeyText: TranslationKey
}

// Every platform is matched by asset filename against the latest release, so
// each button lights up on its own once a build for it exists and stays
// greyed out until then. That matters because the three are produced by
// separate CI runners (Tauri can't cross-compile), so a release can genuinely
// arrive with only some platforms present if one job fails.
const BUILDS: Build[] = [
  {
    os: 'Windows',
    match: /\.exe$/,
    noteKey: 'desktop.windows' as const,
    // Not Authenticode-signed -- the signing key this project has is the
    // updater's, which is a different thing entirely -- so SmartScreen shows
    // its blue screen on a build it has not seen before.
    noteKeyText: 'desktop.noteWindows' as const,
  },
  {
    os: 'macOS',
    match: /\.dmg$/,
    noteKey: 'desktop.macos' as const,
    noteKeyText: 'desktop.noteMacos' as const,
  },
  {
    os: 'Linux',
    match: /\.AppImage$/,
    noteKey: 'desktop.linux' as const,
    noteKeyText: 'desktop.noteLinux' as const,
  },
]

// Web vs desktop, drawn from what the code actually enforces rather than
// marketing: the atrium cap and size limit are both gated on !isDesktop, and
// Pinterest/Google sign-in are web-only because their OAuth needs a redirect
// the desktop shell can't receive.
// Keys rather than words, like the build list above it. `id` names the row
// so the three keys that make it up stay legible as a set.
const COMPARISON: Array<{ id: string; favours: 'web' | 'desktop' | 'both' }> = [
  { id: 'where', favours: 'both' },
  { id: 'count', favours: 'desktop' },
  { id: 'size', favours: 'desktop' },
  { id: 'images', favours: 'desktop' },
  { id: 'offline', favours: 'desktop' },
  { id: 'others', favours: 'web' },
  { id: 'share', favours: 'web' },
]

// Downloads for the desktop build, with the link resolved from the latest
// GitHub release at runtime so it never points at a stale version. Falls back
// to the releases page if the API is unreachable or rate-limited, which is
// still a working route to the download.
export default function DesktopAppSection() {
  const { t } = useTranslation()
  const [version, setVersion] = useState<string | null>(null)
  const [assets, setAssets] = useState<Record<string, string>>({})
  // Which download button the pointer (or focus) is on, and so which
  // first-launch note is showing.
  const [hoveredOs, setHoveredOs] = useState<Build['os'] | null>(null)
  // Which note the block is showing. It follows hoveredOs but never goes back
  // to null, so the note stays legible while the block collapses under it.
  const [noteOs, setNoteOs] = useState<Build['os'] | null>(null)

  useEffect(() => {
    if (hoveredOs) setNoteOs(hoveredOs)
  }, [hoveredOs])

  const noteOpen = !!hoveredOs && !!assets[hoveredOs]

  useEffect(() => {
    let cancelled = false
    fetch(`https://api.github.com/repos/${REPO}/releases/latest`)
      .then(r => (r.ok ? r.json() : null))
      .then(release => {
        if (cancelled || !release) return
        setVersion(release.tag_name)
        const found: Record<string, string> = {}
        for (const build of BUILDS) {
          if (!build.match) continue
          const asset = (release.assets || []).find((a: any) => build.match!.test(a.name))
          if (asset) found[build.os] = asset.browser_download_url
        }
        setAssets(found)
      })
      .catch(() => { /* fall back to the releases page link below */ })
    return () => { cancelled = true }
  }, [])

  return (
    <div className="max-w-3xl w-full mx-auto" data-reveal>
      <div className="flex items-center gap-3 mb-10">
        <div className="w-3 h-3 rotate-45 border" style={{ borderColor: `rgb(var(--c-silver) / 0.67)`, boxShadow: `0 0 10px rgb(var(--c-silver) / 0.27)` }} />
        <h2 className="text-3xl md:text-4xl font-extralight tracking-[0.15em] uppercase text-nier-strong">
          {t('desktop.title')}
        </h2>
        <div className="flex-1 h-px bg-gradient-to-r from-nier-border/40 to-transparent" />
      </div>

      <p className="text-nier-bg/80 text-base md:text-lg leading-relaxed mb-3">
        {t('desktop.lead')}
      </p>
      <p className="text-nier-bg/75 text-base leading-relaxed mb-8">
        {t('desktop.fit')}
      </p>

      {/* Downloads */}
      <div className="grid sm:grid-cols-3 gap-3 mb-3">
        {BUILDS.map(build => {
          const url = assets[build.os]
          // Availability follows the actual release contents, not a hardcoded
          // list, so a platform whose CI job failed doesn't offer a dead link.
          const available = !!url
          return (
            <a
              key={build.os}
              href={available ? (url || RELEASES_URL) : undefined}
              target={available ? '_blank' : undefined}
              rel={available ? 'noopener noreferrer' : undefined}
              onMouseEnter={() => setHoveredOs(build.os)}
              onMouseLeave={() => setHoveredOs(current => (current === build.os ? null : current))}
              // Focus as well as hover, so the note is reachable by keyboard
              // rather than being a mouse-only piece of the page.
              onFocus={() => setHoveredOs(build.os)}
              onBlur={() => setHoveredOs(current => (current === build.os ? null : current))}
              className={`border p-4 text-center transition-colors ${
                available
                  ? 'border-nier-border/40 hover:border-nier-bg hover:bg-nier-bg/5 cursor-pointer'
                  : 'border-nier-border/15 opacity-50 cursor-default'
              }`}
            >
              <div className="text-nier-bg text-base tracking-[0.1em] uppercase mb-1">
                {available ? '↓ ' : ''}{build.os}
              </div>
              <div className="text-nier-bg/70 text-xs tracking-wider">
                {available ? t(build.noteKey) : t('desktop.unavailable')}
              </div>
            </a>
          )
        })}
      </div>

      {/* None of the three builds is code-signed -- that means a paid Apple
          Developer account and an Authenticode certificate -- so each
          operating system greets the first launch with something that reads
          like the app is broken. Saying so up front turns a scary dead end
          into a known extra click.

          Reserving the space for a note nobody is looking at left a hole
          under the buttons, so the block collapses instead: a grid row
          animating between 0fr and 1fr, which is the one way to transition to
          a height you do not know in advance. The margin lives inside the
          collapsing part, so it goes with it.

          noteOs trails hoveredOs and never returns to null, so the text is
          still there to be seen on the way down rather than disappearing the
          instant the pointer leaves. */}
      <div
        className="grid"
        style={{
          gridTemplateRows: noteOpen ? '1fr' : '0fr',
          transition: 'grid-template-rows 220ms ease',
        }}
        aria-hidden={!noteOpen}
      >
        <div className="overflow-hidden min-h-0">
          <div
            className="border border-nier-border/25 bg-nier-black/40 p-3 mb-4 transition-opacity duration-200"
            style={{ opacity: noteOpen ? 1 : 0 }}
          >
            <p className="text-nier-bg/80 text-xs tracking-wider leading-relaxed">
              {(() => {
                const build = BUILDS.find(b => b.os === noteOs)
                return build ? <RichText text={t(build.noteKeyText)} className="text-nier-bg" /> : null
              })()}
            </p>
          </div>
        </div>
      </div>

      <p className="text-nier-bg/70 text-xs tracking-wider mb-10">
        {version ? `Latest release ${version} · ` : ''}
        <a
          href={RELEASES_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="hover:text-nier-bg/80 transition-colors underline decoration-nier-border/20"
        >
          {t('desktop.allReleases')}
        </a>
        {' · '}Updates install themselves once you're running it.
      </p>

      {/* Comparison */}
      <div className="border border-nier-border/25">
        <div className="grid grid-cols-3 border-b border-nier-border/25 bg-nier-black/40">
          <div className="p-3 text-nier-bg/70 text-xs tracking-[0.15em] uppercase" />
          <div className="p-3 text-xs tracking-[0.15em] uppercase text-center" style={{ color: `rgb(var(--c-sky) / 0.8)` }}>{t('desktop.web')}</div>
          <div className="p-3 text-xs tracking-[0.15em] uppercase text-center" style={{ color: `rgb(var(--c-emerald) / 0.8)` }}>{t('desktop.desktop')}</div>
        </div>
        {COMPARISON.map((row, i) => (
          <div
            key={row.id}
            className={`grid grid-cols-3 text-sm ${i % 2 === 0 ? 'bg-nier-black/20' : ''}`}
          >
            <div className="p-3 text-nier-bg/80">{t(`compare.feature.${row.id}` as TranslationKey)}</div>
            <div className={`p-3 text-center ${row.favours === 'web' ? 'text-nier-bg' : 'text-nier-bg/70'}`}>
              {t(`compare.web.${row.id}` as TranslationKey)}
            </div>
            <div className={`p-3 text-center ${row.favours === 'desktop' ? 'text-nier-bg' : 'text-nier-bg/70'}`}>
              {t(`compare.desktop.${row.id}` as TranslationKey)}
            </div>
          </div>
        ))}
      </div>

      <p className="text-nier-bg/70 text-sm leading-relaxed mt-6">
        {t('desktop.moveBetween')}
      </p>
    </div>
  )
}
