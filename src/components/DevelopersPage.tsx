// Developers: the tools for building the atrium, for the platform's operator
// alone (lib/platformAdmin) -- reached from the welcome screen's Developers,
// on the web. One tool so far: Special themes (lib/specialThemes) -- the three
// built-in presets, made over or hidden, and the developer's own, each made
// here like a theme of one's own, named, marked light or dark, all year or
// given the days of the year it's shown, and hidden until it's ready. Nothing
// is written until Save; the database refuses anyone else's changes either way.

import { useEffect, useState } from 'react'
import { useTranslation } from '../lib/i18n'
import type { TranslationKey } from '../locales/en'
import { checkPlatformAdmin } from '../lib/platformAdmin'
import { deleteSpecialTheme, refOf, saveSpecialTheme, setSpecialThemeDraft, specialThemeDraft, useSpecialThemes, type SpecialTheme } from '../lib/specialThemes'
import { PRESETS, modeOf, writeView } from '../lib/customThemes'
import { Switch } from './Customization'
import { supabase } from '../lib/supabase'
import { useGameStore } from '../store/gameStore'
import { inSeason, monthDayOf } from '../lib/season'
import { MENU_ICONS, MenuIcon } from './AtriumMenu'
import { THEME_DEFAULTS, ThemeSections, ThemeTile, themeSwatch } from './ThemeCustomization'
import type { ThemeSettings } from '../types/database'

const TOOLS = [{ id: 'special-themes', name: 'developers.specialThemes', about: 'developers.specialThemesDesc' }] as const
type ToolId = typeof TOOLS[number]['id']

function Heading({ children }: { children: string }) {
  return (
    <div className="flex items-center gap-3 mb-4">
      <div className="w-1.5 h-1.5 rotate-45 border border-nier-border/60" />
      <h2 className="text-nier-strong text-xs tracking-[0.25em] uppercase">{children}</h2>
      <div className="flex-1 h-px bg-gradient-to-r from-nier-border/30 to-transparent" />
    </div>
  )
}

export default function DevelopersPage({ onBack, onEnterAtrium }: { onBack: () => void; onEnterAtrium?: (lobbyId: string) => void }) {
  const { t } = useTranslation()
  const [allowed, setAllowed] = useState<boolean | null>(null)
  // Back from looking around in a theme being made: straight to it.
  const [tool, setTool] = useState<ToolId | null>(() => (specialThemeDraft() ? 'special-themes' : null))
  useEffect(() => { void checkPlatformAdmin().then(setAllowed) }, [])
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || (e.target as HTMLElement | null)?.closest('input, textarea')) return
      if (tool) setTool(null)
      else onBack()
    }
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  }, [onBack, tool])

  return (
    <div data-developers-page="" className="fixed inset-0 overflow-y-auto bg-nier-black text-nier-bg font-mono">
      <div className="max-w-5xl mx-auto px-5 sm:px-10 py-8">
        <button
          type="button"
          onClick={() => (tool ? setTool(null) : onBack())}
          className="group flex items-center gap-2 text-[11px] tracking-[0.2em] uppercase text-nier-bg/70 hover:text-nier-strong transition-colors"
        >
          <span className="transition-transform group-hover:-translate-x-1">←</span>
          {t('common.back')}
        </button>

        <header className="mt-10 mb-10">
          <p className="text-nier-bg/60 text-sm tracking-[0.3em] uppercase">{t('developers.title')}</p>
          <h1 className="mt-2 text-3xl sm:text-4xl font-light tracking-[0.06em] uppercase text-nier-strong">
            {tool ? t('developers.specialThemes') : t('developers.tools')}
          </h1>
        </header>

        {allowed === null && <p className="text-nier-bg/60 text-xs tracking-wider">{t('developers.checking')}</p>}
        {allowed === false && <p data-developers-denied="" className="text-nier-bg/70 text-sm leading-relaxed">{t('developers.denied')}</p>}
        {allowed && !tool && (
          <section>
            <p className="text-nier-bg/75 text-sm leading-relaxed mb-6">{t('developers.lead')}</p>
            <div className="grid sm:grid-cols-2 gap-3">
              {TOOLS.map(({ id, name, about }) => (
                <button
                  key={id}
                  type="button"
                  data-developer-tool={id}
                  onClick={() => setTool(id)}
                  className="text-left border border-nier-border/30 hover:border-nier-border/70 p-4 transition-colors"
                >
                  <h3 className="text-nier-strong text-xs tracking-[0.2em] uppercase mb-2">◇ {t(name)}</h3>
                  <p className="text-nier-bg/75 text-xs leading-relaxed">{t(about)}</p>
                </button>
              ))}
            </div>
          </section>
        )}
        {allowed && tool === 'special-themes' && <SpecialThemesTool onEnterAtrium={onEnterAtrium} />}
      </div>
    </div>
  )
}

// A 'MM-DD' as the browser's date picker shows it: in this year.
const asDate = (monthDay: string) => `${new Date().getFullYear()}-${monthDay}`
const shortDate = (monthDay: string, language: string) =>
  new Date(`${asDate(monthDay)}T12:00:00`).toLocaleDateString(language, { month: 'short', day: 'numeric' })

function SpecialThemesTool({ onEnterAtrium }: { onEnterAtrium?: (lobbyId: string) => void }) {
  const { t, language } = useTranslation()
  const themes = useSpecialThemes()
  const userId = useGameStore(state => state.userId)
  // What's being changed: a copy, written by Save. `isNew` until it has been;
  // `opened`, as it was opened (a preset not made over is saved nowhere).
  // Kept for the session while it has changes (lib/specialThemes), for the
  // atrium entered to look around in it, and for coming back.
  const [draft, setDraft] = useState<SpecialTheme | null>(() => specialThemeDraft()?.theme ?? null)
  const [isNew, setIsNew] = useState(() => specialThemeDraft()?.isNew ?? false)
  const [opened, setOpened] = useState<SpecialTheme | null>(null)
  // Where to look around: one of your own atriums.
  const [atriums, setAtriums] = useState<{ id: string; name: string }[]>([])
  const [atriumId, setAtriumId] = useState('')
  useEffect(() => {
    if (!supabase || !userId) return
    void (supabase.from('lobbies') as any).select('id,name').eq('owner_user_id', userId).order('name').then(({ data }: { data: { id: string; name: string }[] | null }) => {
      setAtriums(data ?? [])
      setAtriumId(id => id || data?.[0]?.id || '')
    })
  }, [userId])
  const enter = () => {
    if (!draft || !atriumId || !onEnterAtrium) return
    // Kept for the visit even unchanged, for the atrium's way back here.
    setSpecialThemeDraft({ theme: draft, isNew, base: themes.find(theme => theme.id === draft.id) ?? null })
    writeView(atriumId, refOf(draft))
    onEnterAtrium(atriumId)
  }
  const [status, setStatus] = useState<string | null>(null)
  const stored = draft ? themes.find(theme => theme.id === draft.id) ?? null : null
  // A new special theme has changes from the start; a preset not made over
  // yet has none until it's changed.
  const changed = !!draft && ((isNew && !draft.preset) || JSON.stringify(stored ?? opened) !== JSON.stringify(draft))
  useEffect(() => setSpecialThemeDraft(draft && changed ? { theme: draft, isNew, base: stored } : null), [draft, isNew, changed, stored])
  const today = new Date()

  const open = (theme: SpecialTheme, fresh = false) => {
    if (changed && !window.confirm(t('developers.discard'))) return
    setDraft(theme)
    setOpened(theme)
    setIsNew(fresh)
    setStatus(null)
  }
  // A new one starts hidden: nobody sees it until it's ready.
  const make = () => {
    const week = new Date(today.getTime() + 7 * 86_400_000)
    open({ id: crypto.randomUUID(), name: t('developers.newThemeName'), mode: 'dark', values: { ...THEME_DEFAULTS }, startsOn: monthDayOf(today), endsOn: monthDayOf(week), hidden: true }, true)
  }
  // A built-in preset: your version of it, or -- not made over yet -- the
  // code's, ready to be.
  const presetRow = (id: string) => themes.find(theme => theme.preset === id)
  const openPreset = (preset: typeof PRESETS[number]) => {
    const row = presetRow(preset.id)
    if (row) open(row)
    else open({ id: crypto.randomUUID(), name: t(preset.nameKey as TranslationKey), mode: modeOf(preset.values), values: { ...preset.values }, startsOn: null, endsOn: null, hidden: false, preset: preset.id }, true)
  }
  const presetName = (theme: SpecialTheme) => {
    const preset = PRESETS.find(p => p.id === theme.preset)
    return preset ? t(preset.nameKey as TranslationKey) : theme.name
  }
  const specials = themes.filter(theme => !theme.preset)
  const change = (patch: Partial<SpecialTheme>) => draft && setDraft({ ...draft, ...patch })
  const setValue = (patch: Partial<ThemeSettings>) => draft && setDraft({ ...draft, values: { ...draft.values, ...patch } })

  const save = async () => {
    if (!draft) return
    const name = draft.name.trim()
    if (!name) { setStatus(t('developers.needsName')); return }
    setStatus(t('atrium.theme.saving'))
    const error = await saveSpecialTheme({ ...draft, name })
    setStatus(error ?? t('atrium.theme.saved'))
    if (!error) { setDraft({ ...draft, name }); setOpened({ ...draft, name }); setIsNew(false) }
  }
  // A special theme deleted; a preset put back as it was built.
  const remove = async () => {
    if (!draft) return
    if (isNew) { setDraft(null); return }
    if (!window.confirm(t(draft.preset ? 'developers.confirmReset' : 'developers.confirmDelete', { name: presetName(draft) }))) return
    const error = await deleteSpecialTheme(draft.id)
    if (error) setStatus(error)
    else setDraft(null)
  }

  return (
    <section data-special-themes="" className="grid md:grid-cols-[minmax(0,1fr)_22rem] gap-8 items-start">
      <div>
        <Heading>{t('developers.presets')}</Heading>
        <p className="text-nier-bg/70 text-xs leading-relaxed mb-5">{t('developers.presetsDesc')}</p>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mb-10">
          {PRESETS.map(preset => {
            const row = presetRow(preset.id)
            return (
              <div key={preset.id} data-preset-theme={preset.id} className="space-y-1.5">
                <ThemeTile
                  testId={preset.ref}
                  name={t(preset.nameKey as TranslationKey)}
                  values={row?.values ?? preset.values}
                  mode={row?.mode ?? modeOf(preset.values)}
                  selected={draft?.preset === preset.id}
                  onPick={() => openPreset(preset)}
                />
                <p className="text-[10px] tracking-wider text-nier-bg/65">
                  {row ? t('developers.madeOver') : t('developers.builtIn')}
                  {row?.hidden && <span className="ml-2 text-nier-strong">◇ {t('developers.hidden')}</span>}
                </p>
              </div>
            )
          })}
        </div>

        <Heading>{t('developers.specialThemes')}</Heading>
        <p className="text-nier-bg/70 text-xs leading-relaxed mb-5">{t('developers.specialThemesDesc')}</p>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          {specials.map(theme => (
            <div key={theme.id} data-special-theme={theme.id} className="space-y-1.5">
              <ThemeTile
                testId={`special:${theme.id}`}
                name={theme.name}
                values={theme.values}
                mode={theme.mode}
                selected={draft?.id === theme.id}
                onPick={() => open(theme)}
              />
              <p className="text-[10px] tracking-wider text-nier-bg/65">
                {theme.startsOn && theme.endsOn ? `${shortDate(theme.startsOn, language)} – ${shortDate(theme.endsOn, language)}` : t('developers.allYear')}
                {theme.hidden
                  ? <span className="ml-2 text-nier-strong">◇ {t('developers.hidden')}</span>
                  : inSeason(theme, today) && <span className="ml-2 text-nier-strong">◆ {t('developers.inSeason')}</span>}
              </p>
            </div>
          ))}
          <button
            type="button"
            data-special-theme-new=""
            onClick={make}
            className="h-[4.6rem] border border-dashed border-nier-border/40 hover:border-nier-border/80 text-nier-bg/70 hover:text-nier-strong text-[10px] tracking-[0.12em] uppercase transition-colors"
          >
            + {t('developers.newTheme')}
          </button>
        </div>
        {specials.length === 0 && <p className="mt-4 text-nier-bg/55 text-xs">{t('developers.none')}</p>}

        {draft && (
          <div className="mt-8">
            <Heading>{t('developers.preview')}</Heading>
            <div data-special-preview="" className="h-56 border border-nier-border/30" style={themeSwatch(draft.values, 22)} />
          </div>
        )}
      </div>

      {draft && (
        <div data-special-editor="" className="border border-nier-border/30 p-4 space-y-4 md:sticky md:top-6">
          {/* A preset keeps its name, in every language. */}
          {draft.preset ? (
            <p data-special-name="" className="text-nier-strong text-sm tracking-[0.1em] uppercase">{presetName(draft)}</p>
          ) : (
            <input
              data-special-name=""
              value={draft.name}
              onChange={e => change({ name: e.target.value.slice(0, 40) })}
              aria-label={t('developers.name')}
              placeholder={t('developers.name')}
              className="w-full bg-nier-black text-nier-bg border border-nier-border/30 px-3 py-2 font-mono text-sm focus:outline-none focus:border-nier-border/60"
            />
          )}
          <div className="flex gap-2">
            {(['light', 'dark'] as const).map(mode => (
              <button
                key={mode}
                type="button"
                data-special-mode={mode}
                aria-pressed={draft.mode === mode}
                onClick={() => change({ mode })}
                className={`flex-1 flex items-center justify-center gap-2 px-2 py-2 text-[10px] tracking-[0.12em] uppercase border transition-colors ${
                  draft.mode === mode ? 'bg-nier-bg text-nier-black border-nier-bg' : 'border-nier-border/30 text-nier-bg/80 hover:border-nier-border/60'
                }`}
              >
                <MenuIcon d={mode === 'light' ? MENU_ICONS.sun : MENU_ICONS.moon} size={13} />
                {mode === 'light' ? t('theme.light') : t('theme.dark')}
              </button>
            ))}
          </div>
          {/* Ready, but kept from everyone until it's shown. */}
          <Switch
            testId="special-hidden"
            label={t('developers.hidden')}
            hint={t('developers.hiddenHint')}
            on={draft.hidden}
            onChange={hidden => change({ hidden })}
          />

          {/* When it's out: all year, or a window of the year (a preset is
              always all year). */}
          {!draft.preset && (
            <Switch
              testId="special-all-year"
              label={t('developers.allYear')}
              hint={t('developers.allYearHint')}
              on={!draft.startsOn}
              onChange={allYear => {
                const week = new Date(today.getTime() + 7 * 86_400_000)
                change(allYear ? { startsOn: null, endsOn: null } : { startsOn: monthDayOf(today), endsOn: monthDayOf(week) })
              }}
            />
          )}
          {draft.startsOn && draft.endsOn && (
            <div>
              <p className="text-nier-strong text-xs tracking-[0.1em] uppercase mb-2">{t('developers.window')}</p>
              <div className="grid grid-cols-2 gap-2">
                {([['startsOn', 'developers.from'], ['endsOn', 'developers.to']] as const).map(([field, label]) => (
                  <label key={field} className="block text-[10px] tracking-[0.12em] uppercase text-nier-bg/70">
                    {t(label)}
                    <input
                      type="date"
                      data-special-date={field}
                      value={asDate(draft[field]!)}
                      onChange={e => { if (e.target.value) change({ [field]: e.target.value.slice(5) }) }}
                      className="mt-1 w-full bg-nier-black text-nier-bg border border-nier-border/30 px-2 py-1.5 font-mono text-xs focus:outline-none focus:border-nier-border/60"
                    />
                  </label>
                ))}
              </div>
              <p className="mt-2 text-nier-bg/55 text-[0.7rem] leading-relaxed">{t('developers.everyYear')}</p>
            </div>
          )}

          {/* In it, at full size: one of your atriums, seen in this theme as
              it is now -- saved or not, hidden or not, for you alone. */}
          {onEnterAtrium && atriums.length > 0 && (
            <div className="space-y-2">
              <div className="flex gap-2">
                <select
                  data-special-atrium=""
                  value={atriumId}
                  onChange={e => setAtriumId(e.target.value)}
                  aria-label={t('developers.enterIn')}
                  className="min-w-0 flex-1 bg-nier-black text-nier-bg border border-nier-border/30 px-2 py-1.5 font-mono text-xs focus:outline-none focus:border-nier-border/60"
                >
                  {atriums.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
                </select>
                <button
                  type="button"
                  data-special-enter=""
                  onClick={enter}
                  className="shrink-0 px-3 border border-nier-border/40 text-nier-strong text-[10px] tracking-[0.12em] uppercase hover:border-nier-bg transition-colors"
                >
                  {t('developers.enter')}
                </button>
              </div>
              <p className="text-nier-bg/55 text-[0.7rem] leading-relaxed">{t('developers.enterHint')}</p>
            </div>
          )}

          <ThemeSections shown={{ ...THEME_DEFAULTS, ...draft.values }} setValue={setValue} lobbyId="developers" />

          <div className="flex items-center gap-2 pt-1">
            <span data-special-status="" className="min-w-0 flex-1 truncate text-nier-bg/70 text-[10px] tracking-wider">
              {status ?? (changed ? t('developers.unsaved') : '')}
            </span>
            {/* Deleted, or -- a preset -- put back as it was built; one not
                made over has nothing to put back. */}
            {!(draft.preset && isNew) && (
              <button
                type="button"
                data-special-delete=""
                onClick={() => { void remove() }}
                aria-label={draft.preset ? t('developers.reset') : t('common.delete')}
                title={draft.preset ? t('developers.reset') : t('common.delete')}
                className="px-2.5 py-2 border border-nier-border/30 hover:border-red-500/60 transition-colors"
                style={{ color: 'rgb(var(--c-danger))' }}
              >
                <MenuIcon d={draft.preset ? 'M4 4v5h5M4.6 9a8 8 0 1 1 -.6 4' : 'M4 7h16M10 11v6M14 11v6M5 7l1 12a2 2 0 0 0 2 2h8a2 2 0 0 0 2 -2l1 -12M9 7v-3a1 1 0 0 1 1 -1h4a1 1 0 0 1 1 1v3'} size={14} />
              </button>
            )}
            <button
              type="button"
              data-special-save=""
              onClick={() => { void save() }}
              disabled={!changed}
              className="shrink-0 px-3 py-2 bg-nier-bg text-nier-black text-[10px] tracking-[0.15em] uppercase hover:bg-nier-strong transition-colors disabled:opacity-40 disabled:cursor-default"
            >
              {t('developers.save')}
            </button>
          </div>
        </div>
      )}
    </section>
  )
}
