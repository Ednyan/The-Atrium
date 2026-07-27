import { useEffect, useState } from 'react'

const REPO = 'Ednyan/The-Atrium'
const RELEASES_URL = `https://github.com/${REPO}/releases/latest`

const ACCENT = {
  silver: '#D9D9D9',
  emerald: '#7FD1A6',
  sky: '#7FB6D9',
} as const

interface Build {
  os: 'Windows' | 'macOS' | 'Linux'
  // Matches the asset filename the release actually carries. Absent means no
  // build is published for that platform yet, which is shown honestly rather
  // than linking somewhere broken.
  match?: RegExp
  note: string
}

// Every platform is matched by asset filename against the latest release, so
// each button lights up on its own once a build for it exists and stays
// greyed out until then. That matters because the three are produced by
// separate CI runners (Tauri can't cross-compile), so a release can genuinely
// arrive with only some platforms present if one job fails.
const BUILDS: Build[] = [
  { os: 'Windows', match: /\.exe$/, note: 'Windows 10 or later' },
  { os: 'macOS', match: /\.dmg$/, note: 'Apple Silicon & Intel' },
  { os: 'Linux', match: /\.AppImage$/, note: 'AppImage, most distros' },
]

// Web vs desktop, drawn from what the code actually enforces rather than
// marketing: the atrium cap and size limit are both gated on !isDesktop, and
// Pinterest/Google sign-in are web-only because their OAuth needs a redirect
// the desktop shell can't receive.
const COMPARISON: Array<{ feature: string; web: string; desktop: string; favours: 'web' | 'desktop' | 'both' }> = [
  { feature: 'Where atriums live', web: 'In the cloud', desktop: 'A folder on your disk', favours: 'both' },
  { feature: 'Number of atriums', web: 'Up to 3', desktop: 'Unlimited', favours: 'desktop' },
  { feature: 'Size per atrium', web: '10 MB', desktop: 'Unlimited', favours: 'desktop' },
  { feature: 'Images', web: 'Hosted links', desktop: 'Straight off your computer', favours: 'desktop' },
  { feature: 'Works offline', web: 'No', desktop: 'Yes', favours: 'desktop' },
  { feature: 'Others can join you', web: 'Yes, live', desktop: 'Solo', favours: 'web' },
  { feature: 'Share a link', web: 'Yes', desktop: 'Export a file', favours: 'web' },
]

// Downloads for the desktop build, with the link resolved from the latest
// GitHub release at runtime so it never points at a stale version. Falls back
// to the releases page if the API is unreachable or rate-limited, which is
// still a working route to the download.
export default function DesktopAppSection() {
  const [version, setVersion] = useState<string | null>(null)
  const [assets, setAssets] = useState<Record<string, string>>({})

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
        <div className="w-3 h-3 rotate-45 border" style={{ borderColor: `${ACCENT.silver}AA`, boxShadow: `0 0 10px ${ACCENT.silver}44` }} />
        <h2 className="text-2xl md:text-3xl font-extralight tracking-[0.15em] uppercase text-white">
          Desktop App
        </h2>
        <div className="flex-1 h-px bg-gradient-to-r from-nier-border/40 to-transparent" />
      </div>

      <p className="text-nier-border text-sm md:text-base leading-relaxed mb-3">
        The same atrium, running on your own machine. Your references live in a
        folder you control, images come straight off your drive instead of
        needing somewhere to host them, and nothing is capped.
      </p>
      <p className="text-nier-border/60 text-sm leading-relaxed mb-8">
        It's the better fit for a big personal reference library. The web version
        is the better fit for anything you want other people in.
      </p>

      {/* Downloads */}
      <div className="grid sm:grid-cols-3 gap-3 mb-4">
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
              className={`border p-4 text-center transition-colors ${
                available
                  ? 'border-nier-border/40 hover:border-nier-bg hover:bg-nier-bg/5 cursor-pointer'
                  : 'border-nier-border/15 opacity-50 cursor-default'
              }`}
            >
              <div className="text-nier-bg text-sm tracking-[0.1em] uppercase mb-1">
                {available ? '↓ ' : ''}{build.os}
              </div>
              <div className="text-nier-border/50 text-[10px] tracking-wider">
                {available ? build.note : 'Not available yet'}
              </div>
            </a>
          )
        })}
      </div>

      <p className="text-nier-border/40 text-[10px] tracking-wider mb-10">
        {version ? `Latest release ${version} · ` : ''}
        <a
          href={RELEASES_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="hover:text-nier-border/70 transition-colors underline decoration-nier-border/20"
        >
          All releases
        </a>
        {' · '}Updates install themselves once you're running it.
      </p>

      {/* Comparison */}
      <div className="border border-nier-border/25">
        <div className="grid grid-cols-3 border-b border-nier-border/25 bg-nier-black/40">
          <div className="p-3 text-nier-border/50 text-[9px] tracking-[0.15em] uppercase" />
          <div className="p-3 text-[9px] tracking-[0.15em] uppercase text-center" style={{ color: `${ACCENT.sky}CC` }}>Web</div>
          <div className="p-3 text-[9px] tracking-[0.15em] uppercase text-center" style={{ color: `${ACCENT.emerald}CC` }}>Desktop</div>
        </div>
        {COMPARISON.map((row, i) => (
          <div
            key={row.feature}
            className={`grid grid-cols-3 text-xs ${i % 2 === 0 ? 'bg-nier-black/20' : ''}`}
          >
            <div className="p-3 text-nier-border/70">{row.feature}</div>
            <div className={`p-3 text-center ${row.favours === 'web' ? 'text-nier-bg' : 'text-nier-border/50'}`}>
              {row.web}
            </div>
            <div className={`p-3 text-center ${row.favours === 'desktop' ? 'text-nier-bg' : 'text-nier-border/50'}`}>
              {row.desktop}
            </div>
          </div>
        ))}
      </div>

      <p className="text-nier-border/50 text-xs leading-relaxed mt-6">
        You can move between them: download an atrium from the web and import it
        into the desktop app, or upload a local one when you want to share it.
      </p>
    </div>
  )
}
