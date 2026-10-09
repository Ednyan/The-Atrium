// Atrium Themes: what you see the atrium in, and themes of your own.
//
// Docked on the right as the Customization panel is, over no backdrop, so the
// atrium changes behind it as a theme is picked (lib/customThemes): the
// atrium's own theme, a preset, or one of yours -- for you alone, and light or
// dark set to match. Your own are made from whichever theme is showing, into
// an empty slot (three on the web, twelve on the desktop), then named, marked
// light or dark, and changed here; each change is kept with your account. An
// owner or admin can save what's showing as the atrium's theme, for everyone.

import { useEffect, useRef, useState } from 'react'
import { isDesktop, supabase } from '../lib/supabase'
import { uploadTraceFile } from '../lib/traceUpload'
import { resolveLocalStreamUrl } from '../lib/localMedia'
import type { Lobby, ThemeSettings } from '../types/database'
import { useTranslation } from '../lib/i18n'
import type { TranslationKey } from '../locales/en'
import { useGameStore } from '../store/gameStore'
import { firstFreeName } from '../lib/traceNames'
import { CUSTOM_THEME_LIMIT, PRESETS, gridStyleOf, modeOf, rememberLast, setCustomThemes, themeModeOf, themeOf, useCustomThemes, type CustomTheme, type ThemeMode, type ThemeRef } from '../lib/customThemes'
import { useLandingTheme } from '../lib/useLandingTheme'
import { CustomizationPanel, Section } from './Customization'
import { MENU_ICONS, MenuIcon } from './AtriumMenu'
import { Check, ColourField, Slider } from './ShapeStyleControls'
import { GROUND_DEFAULTS, GROUND_ELEMENTS, groundSrc, isBuiltIn } from '../lib/ground'

// What a theme has when it doesn't say: the room's defaults (LobbyScene).
const DEFAULTS: ThemeSettings = {
  gridColor: '#3b82f6', gridOpacity: 0.2, gridEnabled: true, gridLineSpacing: 50, backgroundColor: '#0a0a0f',
  particlesEnabled: true, particleColor: '#ffffff', particleOpacity: 0.6, particleDensity: 1,
  groundEnabled: false, ...GROUND_DEFAULTS,
}

// The room's picture, under the grid: a link, or on the desktop a file of
// one's own (kept in the vault, as a dropped picture is). Shown small, with a
// way off.
function BackdropPicker({ lobbyId, value, onChange }: { lobbyId: string; value: string | undefined; onChange: (url: string | undefined) => void }) {
  const { t } = useTranslation()
  const userId = useGameStore(state => state.userId)
  const [link, setLink] = useState('')
  const [preview, setPreview] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  useEffect(() => {
    let live = true
    if (!value) { setPreview(null); return }
    void resolveLocalStreamUrl(value).then(url => { if (live) setPreview(url) })
    return () => { live = false }
  }, [value])
  const add = () => {
    const url = link.trim()
    if (!/^https?:/i.test(url)) return
    onChange(url)
    setLink('')
  }
  return (
    <div className="space-y-2">
      <label className="block text-nier-strong text-xs tracking-[0.1em] uppercase">{t('atrium.theme.backdrop')}</label>
      {value && (
        <div className="flex items-center gap-2">
          {preview && <span aria-hidden="true" className="w-14 h-9 shrink-0 border border-nier-border/30 bg-center bg-cover" style={{ backgroundImage: `url("${preview}")` }} />}
          <span className="flex-1 min-w-0 truncate text-[11px] text-nier-bg/70" title={value}>{value.split('/').pop()}</span>
          <button type="button" data-backdrop-remove="" onClick={() => onChange(undefined)} aria-label={t('atrium.theme.groundRemove')} className="shrink-0 w-6 h-6 border border-nier-border/30 hover:border-nier-border/60">✕</button>
        </div>
      )}
      <div className="flex gap-1.5">
        <input
          type="url"
          data-backdrop-link=""
          value={link}
          onChange={e => setLink(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') add() }}
          placeholder={t('atrium.theme.groundLink')}
          className="flex-1 min-w-0 bg-nier-black text-nier-bg border border-nier-border/30 px-2 py-1.5 font-mono text-xs focus:outline-none focus:border-nier-border/60"
        />
        <button type="button" onClick={add} className="shrink-0 px-3 border border-nier-border/40 text-nier-strong text-[10px] tracking-[0.12em] uppercase hover:border-nier-bg">{t('atrium.theme.groundAdd')}</button>
      </div>
      {/* The web can't take files from the computer yet. */}
      {isDesktop && userId && (
        <>
          <button type="button" onClick={() => fileRef.current?.click()} className="w-full py-1.5 border border-nier-border/40 text-nier-strong text-[10px] tracking-[0.12em] uppercase hover:border-nier-bg">
            {t('atrium.theme.backdropFile')}
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={async e => {
              const file = e.target.files?.[0]
              e.target.value = ''
              if (file) onChange(await uploadTraceFile(file, lobbyId, userId))
            }}
          />
        </>
      )}
    </div>
  )
}

// What's on the ground: each built-in element, shown in the panel's own ink
// (masked, as the elements are white), on or off; pictures of one's own by
// link, each with a way off.
function GroundPicker({ chosen, onChange }: { chosen: string[]; onChange: (chosen: string[]) => void }) {
  const { t } = useTranslation()
  const [link, setLink] = useState('')
  const toggle = (item: string) => onChange(chosen.includes(item) ? chosen.filter(c => c !== item) : [...chosen, item])
  const add = () => {
    const url = link.trim()
    if (!/^(https?:|local:)/i.test(url) || chosen.includes(url)) return
    onChange([...chosen, url])
    setLink('')
  }
  return (
    <div className="space-y-2">
      <div className="grid grid-cols-5 gap-1.5">
        {GROUND_ELEMENTS.map(id => {
          const mask = `url(${groundSrc(id)}) center / contain no-repeat`
          return (
            <button
              key={id}
              type="button"
              data-ground={id}
              aria-pressed={chosen.includes(id)}
              aria-label={t(`atrium.theme.ground.${id}` as TranslationKey)}
              title={t(`atrium.theme.ground.${id}` as TranslationKey)}
              onClick={() => toggle(id)}
              className={`aspect-square flex items-center justify-center border transition-colors ${
                chosen.includes(id) ? 'border-nier-bg bg-nier-bg/10 text-nier-strong' : 'border-nier-border/30 text-nier-bg/50 hover:border-nier-border/60'
              }`}
            >
              <span aria-hidden="true" className="w-3/4 h-3/4" style={{ backgroundColor: 'currentColor', mask, WebkitMask: mask }} />
            </button>
          )
        })}
      </div>
      {chosen.filter(item => !isBuiltIn(item)).map(url => (
        <div key={url} className="flex items-center gap-2 text-[11px] text-nier-bg/80">
          <span className="flex-1 min-w-0 truncate" title={url}>{url}</span>
          <button type="button" data-ground-remove="" onClick={() => toggle(url)} aria-label={t('atrium.theme.groundRemove')} className="shrink-0 w-6 h-6 border border-nier-border/30 hover:border-nier-border/60">✕</button>
        </div>
      ))}
      <div className="flex gap-1.5">
        <input
          type="url"
          data-ground-link=""
          value={link}
          onChange={e => setLink(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') add() }}
          placeholder={t('atrium.theme.groundLink')}
          className="flex-1 min-w-0 bg-nier-black text-nier-bg border border-nier-border/30 px-2 py-1.5 font-mono text-xs focus:outline-none focus:border-nier-border/60"
        />
        <button type="button" onClick={add} className="shrink-0 px-3 border border-nier-border/40 text-nier-strong text-[10px] tracking-[0.12em] uppercase hover:border-nier-bg">{t('atrium.theme.groundAdd')}</button>
      </div>
    </div>
  )
}

const rgba = (hex: string | undefined, alpha: number) => {
  const m = /^#?([0-9a-f]{6})$/i.exec((hex ?? '').trim())
  if (!m) return `rgba(128, 128, 128, ${alpha})`
  const n = parseInt(m[1], 16)
  return `rgba(${n >> 16}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`
}

// A theme as a tile: its floor ruled by its grid, its name, light or dark.
function ThemeTile({ name, about, values, mode, selected, onPick, testId }: {
  name: string
  about?: string
  values: ThemeSettings
  mode: ThemeMode
  selected: boolean
  onPick: () => void
  testId: string
}) {
  const v = { ...DEFAULTS, ...values }
  const gridStyle = gridStyleOf(values)
  const line = rgba(v.gridColor, Math.min(1, (gridStyle !== 'none' ? v.gridOpacity ?? 0.2 : 0) * (gridStyle === 'dots' ? 4 : 2.5)))
  return (
    <button
      type="button"
      data-theme-tile={testId}
      aria-pressed={selected}
      onClick={onPick}
      title={about ? `${name} — ${about}` : name}
      className={`text-left border transition-colors ${selected ? 'border-nier-bg ring-1 ring-nier-bg' : 'border-nier-border/30 hover:border-nier-border/70'}`}
    >
      <span
        className="block h-11"
        style={{
          backgroundColor: v.backgroundColor,
          backgroundImage: gridStyle === 'dots'
            ? `radial-gradient(circle, ${line} 1px, transparent 1.2px)`
            : `linear-gradient(to right, ${line} 1px, transparent 1px), linear-gradient(to bottom, ${line} 1px, transparent 1px)`,
          backgroundSize: '11px 11px',
        }}
      />
      <span className="flex items-center gap-1.5 px-2 py-1.5 text-[10px] tracking-[0.12em] uppercase text-nier-bg/85">
        <span className="min-w-0 flex-1 truncate">{name}</span>
        <span className="shrink-0 text-nier-bg/60" aria-label={mode}><MenuIcon d={mode === 'light' ? MENU_ICONS.sun : MENU_ICONS.moon} size={12} /></span>
      </span>
    </button>
  )
}

export function ThemeCustomization({ lobby, viewRef, onPick, canSaveForAtrium, onClose, onUpdate }: {
  lobby: Lobby
  // What you're seeing the atrium in, and how to see it in another.
  viewRef: ThemeRef
  onPick: (ref: ThemeRef) => void
  // Owners and admins: what's showing can become the atrium's theme.
  canSaveForAtrium: boolean
  onClose: () => void
  onUpdate: () => void
}) {
  const { t } = useTranslation()
  const { setTheme: setUiTheme } = useLandingTheme()
  const userId = useGameStore(state => state.userId)
  const customs = useCustomThemes()
  const atrium = lobby.themeSettings ?? null
  const shown: ThemeSettings = { ...DEFAULTS, ...(themeOf(viewRef, atrium, customs) ?? atrium ?? {}) }
  const mine = viewRef.startsWith('custom:') ? customs.find(c => `custom:${c.id}` === viewRef) ?? null : null
  const [status, setStatus] = useState<string | null>(null)

  const keep = (next: CustomTheme[]) => {
    if (userId) setCustomThemes(userId, next, () => setStatus(t('atrium.theme.yoursNotSaved')))
  }
  const change = (patch: Partial<CustomTheme>) => {
    if (mine) keep(customs.map(c => (c.id === mine.id ? { ...c, ...patch } : c)))
  }
  const setValue = (patch: Partial<ThemeSettings>) => mine && change({ values: { ...mine.values, ...patch } })

  // One of your own, from the theme that's showing.
  const makeTheme = () => {
    if (!userId || customs.length >= CUSTOM_THEME_LIMIT) return
    const theme: CustomTheme = {
      id: crypto.randomUUID(),
      name: firstFreeName(customs.map(c => c.name), n => t('atrium.theme.customName', { n })),
      mode: themeModeOf(viewRef, atrium, customs),
      values: shown,
    }
    keep([...customs, theme])
    onPick(`custom:${theme.id}`)
  }
  const deleteTheme = () => {
    if (!mine) return
    keep(customs.filter(c => c.id !== mine.id))
    onPick('atrium')
  }

  const saveForAtrium = async () => {
    if (!supabase) return
    setStatus(t('atrium.theme.saving'))
    const { data, error } = await ((supabase.from('lobbies') as any).update({ theme_settings: shown }).eq('id', lobby.id).select('theme_settings').single())
    if (error || !data) {
      setStatus(error ? (error.message || t('atrium.theme.saveFailed')) : t('atrium.theme.saveDenied'))
      return
    }
    setStatus(t('atrium.theme.saved'))
    window.setTimeout(() => setStatus(null), 2000)
    onUpdate()
  }

  return (
    <CustomizationPanel
      subtitle={t('atrium.hud.theme')}
      onClose={onClose}
      zIndex={9999}
      actions={(canSaveForAtrium || status) && (
        <div className="w-full flex items-center gap-2 px-1">
          <span className="min-w-0 flex-1 truncate text-nier-bg/70 text-[10px] tracking-wider">{status}</span>
          {canSaveForAtrium && (
            <button
              type="button"
              data-save-for-atrium=""
              onClick={() => { void saveForAtrium() }}
              disabled={viewRef === 'atrium'}
              title={viewRef === 'atrium' ? t('atrium.theme.isAtriums') : undefined}
              className="shrink-0 px-3 py-2 bg-nier-bg text-nier-black text-[10px] tracking-[0.15em] uppercase hover:bg-nier-strong transition-colors disabled:opacity-40 disabled:cursor-default"
            >
              {t('atrium.theme.saveForAtrium')}
            </button>
          )}
        </div>
      )}
    >
      <Section id="presets" title={t('atrium.theme.presets')}>
        <div className="grid grid-cols-2 gap-2">
          <ThemeTile testId="atrium" name={t('atrium.theme.atriumOwn')} values={atrium ?? {}} mode={modeOf(atrium)} selected={viewRef === 'atrium'} onPick={() => onPick('atrium')} />
          {PRESETS.map(preset => (
            <ThemeTile
              key={preset.ref}
              testId={preset.ref}
              name={t(preset.nameKey as TranslationKey)}
              about={t(preset.descKey as TranslationKey)}
              values={preset.values}
              mode={modeOf(preset.values)}
              selected={viewRef === preset.ref}
              onPick={() => onPick(preset.ref)}
            />
          ))}
        </div>
        <p className="text-nier-bg/55 text-[0.7rem] leading-relaxed tracking-wide">{t('atrium.theme.forYou')}</p>
      </Section>

      <Section id="mine" title={t('atrium.theme.yours', { count: customs.length, limit: CUSTOM_THEME_LIMIT })}>
        <div className="grid grid-cols-3 gap-2">
          {customs.map(theme => (
            <ThemeTile
              key={theme.id}
              testId={`custom:${theme.id}`}
              name={theme.name}
              values={theme.values}
              mode={theme.mode}
              selected={viewRef === `custom:${theme.id}`}
              onPick={() => onPick(`custom:${theme.id}`)}
            />
          ))}
          {/* The slots not made yet: crossed out, and pressed, a theme
              from the one showing. */}
          {Array.from({ length: CUSTOM_THEME_LIMIT - customs.length }, (_, i) => (
            <button
              key={`empty-${i}`}
              type="button"
              data-theme-slot=""
              onClick={makeTheme}
              disabled={!userId}
              title={t('atrium.theme.newTheme')}
              aria-label={t('atrium.theme.newTheme')}
              className="group relative h-[4.6rem] border border-dashed border-nier-border/40 hover:border-nier-border/80 transition-colors"
            >
              <svg className="absolute inset-0 w-full h-full text-nier-border/40 group-hover:opacity-0 transition-opacity" preserveAspectRatio="none" viewBox="0 0 100 100" aria-hidden="true">
                <line x1="0" y1="100" x2="100" y2="0" stroke="currentColor" strokeWidth="1" vectorEffect="non-scaling-stroke" />
              </svg>
              <span className="absolute inset-0 flex items-center justify-center text-nier-strong text-lg opacity-0 group-hover:opacity-100 transition-opacity">+</span>
            </button>
          ))}
        </div>

        {mine ? (
          <div className="space-y-3 pt-1">
            <input
              data-theme-name=""
              value={mine.name}
              onChange={e => change({ name: e.target.value.slice(0, 40) })}
              aria-label={t('atrium.customize.sectionName')}
              className="w-full bg-nier-black text-nier-bg border border-nier-border/30 px-3 py-2 font-mono text-sm focus:outline-none focus:border-nier-border/60"
            />
            <div className="flex gap-2">
              {(['light', 'dark'] as const).map(mode => (
                <button
                  key={mode}
                  type="button"
                  data-theme-mode={mode}
                  aria-pressed={mine.mode === mode}
                  // Marked light or dark: the interface goes with it, and it's
                  // the last of its kind.
                  onClick={() => { change({ mode }); rememberLast(mode, viewRef); setUiTheme(mode) }}
                  className={`flex-1 flex items-center justify-center gap-2 px-2 py-2 text-[10px] tracking-[0.12em] uppercase border transition-colors ${
                    mine.mode === mode ? 'bg-nier-bg text-nier-black border-nier-bg' : 'border-nier-border/30 text-nier-bg/80 hover:border-nier-border/60'
                  }`}
                >
                  <MenuIcon d={mode === 'light' ? MENU_ICONS.sun : MENU_ICONS.moon} size={13} />
                  {mode === 'light' ? t('theme.light') : t('theme.dark')}
                </button>
              ))}
              <button
                type="button"
                data-theme-delete=""
                onClick={deleteTheme}
                aria-label={t('common.delete')}
                title={t('common.delete')}
                className="px-2.5 border border-nier-border/30 hover:border-red-500/60 transition-colors"
                style={{ color: 'rgb(var(--c-danger))' }}
              >
                <MenuIcon d="M4 7h16M10 11v6M14 11v6M5 7l1 12a2 2 0 0 0 2 2h8a2 2 0 0 0 2 -2l1 -12M9 7v-3a1 1 0 0 1 1 -1h4a1 1 0 0 1 1 1v3" size={14} />
              </button>
            </div>
          </div>
        ) : (
          <p className="text-nier-bg/55 text-[0.7rem] leading-relaxed tracking-wide">
            {customs.length < CUSTOM_THEME_LIMIT ? t('atrium.theme.makeYourOwn') : t('atrium.theme.pickYours')}
          </p>
        )}
      </Section>

      {/* One of yours is changed here, and kept as it changes. */}
      {mine && (
        <>
          <Section id="grid" title={t('atrium.theme.theGrid')}>
            {/* None, lines or dots; gridEnabled kept in step, for what reads it. */}
            <div>
              <label className="block text-nier-strong text-xs tracking-[0.1em] uppercase mb-2">{t('atrium.theme.gridType')}</label>
              <div className="grid grid-cols-3 gap-2">
                {(['none', 'lines', 'dots'] as const).map(style => (
                  <button
                    key={style}
                    type="button"
                    data-grid-style={style}
                    aria-pressed={gridStyleOf(shown) === style}
                    onClick={() => setValue({ gridStyle: style, gridEnabled: style !== 'none' })}
                    className={`px-2 py-2 text-[10px] tracking-[0.1em] uppercase border transition-colors ${
                      gridStyleOf(shown) === style ? 'bg-nier-bg text-nier-black border-nier-bg' : 'bg-nier-black text-nier-bg border-nier-border/30 hover:border-nier-border/60'
                    }`}
                  >
                    {t(style === 'none' ? 'atrium.theme.gridNone' : style === 'lines' ? 'atrium.theme.gridLines' : 'atrium.theme.gridDots')}
                  </button>
                ))}
              </div>
            </div>
            <ColourField label={t('atrium.theme.colour')} value={shown.gridColor!} onChange={c => setValue({ gridColor: c })} />
            <Slider label={t('atrium.theme.gridOpacity', { value: Math.round((shown.gridOpacity ?? 0.2) * 100) })} min={0} max={1} step={0.05} value={shown.gridOpacity ?? 0.2} onChange={v => setValue({ gridOpacity: v })} />
            <Slider label={t('atrium.theme.gridSize', { value: shown.gridLineSpacing ?? 50 })} hint={t('atrium.theme.gridSizeHint')} min={10} max={200} step={5} value={shown.gridLineSpacing ?? 50} onChange={v => setValue({ gridLineSpacing: v })} />
          </Section>
          <Section id="room" title={t('atrium.theme.theRoom')}>
            <ColourField label={t('atrium.theme.colour')} value={shown.backgroundColor!} onChange={c => setValue({ backgroundColor: c })} />
            <BackdropPicker
              lobbyId={lobby.id}
              value={shown.backgroundImage}
              onChange={backgroundImage => setValue({ backgroundImage })}
            />
            {shown.backgroundImage && (
              <Check checked={shown.backgroundImageEnabled ?? true} label={t('atrium.theme.backdropOn')} onChange={on => setValue({ backgroundImageEnabled: on })} />
            )}
            {shown.backgroundImage && (shown.backgroundImageEnabled ?? true) && (
              <>
                <Slider label={t('atrium.theme.backdropOpacity', { value: Math.round((shown.backgroundImageOpacity ?? 1) * 100) })} min={0.05} max={1} step={0.05} value={shown.backgroundImageOpacity ?? 1} onChange={v => setValue({ backgroundImageOpacity: v })} />
                <Slider label={t('atrium.theme.backdropSize', { value: Math.round((shown.backgroundImageScale ?? 1) * 100) })} min={0.1} max={4} step={0.05} value={shown.backgroundImageScale ?? 1} onChange={v => setValue({ backgroundImageScale: v })} />
                <Check checked={shown.backgroundImageFill ?? false} label={t('atrium.theme.backdropFill')} hint={t('atrium.theme.backdropFillHint')} onChange={on => setValue({ backgroundImageFill: on })} />
                <Check checked={shown.backgroundParallaxEnabled ?? true} label={t('atrium.theme.backdropParallaxOn')} hint={t('atrium.theme.backdropParallaxOnHint')} onChange={on => setValue({ backgroundParallaxEnabled: on })} />
                {(shown.backgroundParallaxEnabled ?? true) && (
                  <Slider label={t('atrium.theme.backdropParallax', { value: Math.round((shown.backgroundParallax ?? 0.3) * 100) })} hint={t(shown.backgroundImageFill ? 'atrium.theme.backdropParallaxFillHint' : 'atrium.theme.backdropParallaxHint')} min={0} max={1} step={0.05} value={shown.backgroundParallax ?? 0.3} onChange={v => setValue({ backgroundParallax: v })} />
                )}
              </>
            )}
          </Section>
          <Section id="particles" title={t('atrium.theme.driftingParticles')}>
            <Check checked={shown.particlesEnabled ?? true} label={t('atrium.theme.enableParticles')} onChange={on => setValue({ particlesEnabled: on })} />
            {shown.particlesEnabled && (
              <>
                <ColourField label={t('atrium.theme.colour')} value={shown.particleColor!} onChange={c => setValue({ particleColor: c })} />
                <Slider label={t('atrium.theme.particleOpacity', { value: Math.round((shown.particleOpacity ?? 0.6) * 100) })} min={0} max={1} step={0.05} value={shown.particleOpacity ?? 0.6} onChange={v => setValue({ particleOpacity: v })} />
                <Slider label={t('atrium.theme.particleDensity', { value: (shown.particleDensity ?? 1).toFixed(1) })} hint={t('atrium.theme.particleDensityHint')} min={0.1} max={3} step={0.1} value={shown.particleDensity ?? 1} onChange={v => setValue({ particleDensity: v })} />
              </>
            )}
          </Section>
          <Section id="ground" title={t('atrium.theme.ground')}>
            {/* Turned on with a few to start from, so it shows at once. */}
            <Check
              checked={shown.groundEnabled ?? false}
              label={t('atrium.theme.groundOn')}
              hint={t('atrium.theme.groundOnHint')}
              onChange={on => setValue({ groundEnabled: on, ...(on && !shown.groundElements?.length ? { groundElements: ['pebbles', 'grass', 'moss'] } : {}) })}
            />
            {shown.groundEnabled && (
              <>
                <GroundPicker chosen={shown.groundElements ?? []} onChange={groundElements => setValue({ groundElements })} />
                <ColourField label={t('atrium.theme.colour')} value={shown.groundColor!} onChange={c => setValue({ groundColor: c })} />
                <p className="text-nier-bg/55 text-[0.7rem] leading-relaxed tracking-wide -mt-1">{t('atrium.theme.groundColourHint')}</p>
                <Slider label={t('atrium.theme.groundOpacity', { value: Math.round(shown.groundOpacity! * 100) })} min={0.05} max={1} step={0.05} value={shown.groundOpacity!} onChange={v => setValue({ groundOpacity: v })} />
                <Slider label={t('atrium.theme.groundSize', { value: Math.round(shown.groundScale! * 100) })} min={0.3} max={4} step={0.1} value={shown.groundScale!} onChange={v => setValue({ groundScale: v })} />
                <Slider label={t('atrium.theme.groundVariation', { value: Math.round(shown.groundScaleRange! * 100) })} min={0} max={0.9} step={0.05} value={shown.groundScaleRange!} onChange={v => setValue({ groundScaleRange: v })} />
                <div className="flex gap-2">
                  {(['random', 'grid'] as const).map(pattern => (
                    <button
                      key={pattern}
                      type="button"
                      data-ground-pattern={pattern}
                      aria-pressed={shown.groundPattern === pattern}
                      onClick={() => setValue({ groundPattern: pattern })}
                      className={`flex-1 px-2 py-2 text-[10px] tracking-[0.1em] uppercase border transition-colors ${
                        shown.groundPattern === pattern ? 'bg-nier-bg text-nier-black border-nier-bg' : 'bg-nier-black text-nier-bg border-nier-border/30 hover:border-nier-border/60'
                      }`}
                    >
                      {t(pattern === 'random' ? 'atrium.theme.groundScattered' : 'atrium.theme.groundRows')}
                    </button>
                  ))}
                </div>
                <Slider
                  label={t('atrium.theme.groundDensity', { value: Math.round(Math.min(1, shown.groundDensity!) * 100) })}
                  min={0.05} max={1} step={0.05} value={Math.min(1, shown.groundDensity!)}
                  onChange={v => setValue({ groundDensity: v })}
                />
                <Slider label={t('atrium.theme.groundSpacing', { value: shown.groundSpacing! })} min={60} max={600} step={10} value={shown.groundSpacing!} onChange={v => setValue({ groundSpacing: v })} />
                {shown.groundPattern !== 'grid' && (
                  <Slider label={t('atrium.theme.groundRotation', { value: Math.round(shown.groundRotation! * 100) })} min={0} max={1} step={0.05} value={shown.groundRotation!} onChange={v => setValue({ groundRotation: v })} />
                )}
              </>
            )}
          </Section>
        </>
      )}
    </CustomizationPanel>
  )
}
