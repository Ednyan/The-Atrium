import { useEffect, useState } from 'react'
import { useTranslation } from '../lib/i18n'
import { heldList, holdAtrium, type Held, type Remaining } from '../lib/held'
import { toWorker } from '../lib/worker'
import { Brackets, Heading } from './landing/parts'

const BUTTON = 'px-3 py-1.5 border border-nier-border/30 text-nier-bg/80 text-[10px] tracking-[0.15em] uppercase hover:border-nier-border/70 hover:text-nier-strong transition-colors disabled:opacity-30'

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="relative">
      <Brackets inset="-0.35rem" />
      <div className="border border-nier-border/30 p-5 sm:p-6" style={{ backgroundColor: 'rgb(var(--c-ground) / 0.75)' }}>
        <Heading>{title}</Heading>
        {children}
      </div>
    </section>
  )
}

/** Developers > Cloud atriums: what's still in Supabase, held for its owners
 *  in one press (lib/held), one atrium and one file at a time, each said as
 *  it goes; and what's held, waiting for its owner's next visit. */
export default function CloudAtriumsTool() {
  const { t, language } = useTranslation()
  const [list, setList] = useState<{ remaining: Remaining[]; held: Held[] } | null>(null)
  const [error, setError] = useState('')
  const [running, setRunning] = useState(false)
  const [progress, setProgress] = useState('')
  const [log, setLog] = useState<string[]>([])
  const load = () => heldList().then(setList, e => setError(e.message))
  useEffect(() => { void load() }, [])

  // Every existing account's profile taken in by the worker (step 6): each is
  // as it signs in anyway; this is for those who haven't. Asked again, only
  // those not taken in yet are.
  const [profiles, setProfiles] = useState('')
  const copyProfiles = async () => {
    setRunning(true)
    setProfiles('')
    try {
      const { ok, answer } = await toWorker<{ profiles: number; taken: number; error?: string }>('/people/profiles', {}, true)
      setProfiles(ok ? t('cloud.profilesDone', { count: answer!.profiles, taken: answer!.taken }) : `✕ ${answer?.error ?? t('names.requestFailed')}`)
    } catch (e: any) {
      setProfiles(`✕ ${e.message}`)
    } finally {
      setRunning(false)
    }
  }

  const day = (at: number | string) => new Date(at).toLocaleDateString(language, { day: 'numeric', month: 'short', year: 'numeric' })
  const owned = (list?.remaining ?? []).filter(atrium => atrium.owner_user_id)

  const holdAll = async () => {
    if (!owned.length || !window.confirm(t('cloud.confirm', { count: owned.length }))) return
    setRunning(true)
    setLog([])
    for (const atrium of owned) {
      setProgress(t('cloud.holding', { name: atrium.name, done: 0, of: '…' }))
      try {
        const { files, gone } = await holdAtrium(atrium.id, (done, of) => setProgress(t('cloud.holding', { name: atrium.name, done, of })))
        setLog(lines => [...lines, `✓ ${t('cloud.heldOne', { name: atrium.name, files })}${gone ? ` · ${t('cloud.gone', { count: gone })}` : ''}`])
      } catch (e: any) {
        setLog(lines => [...lines, `✕ ${t('cloud.failed', { name: atrium.name, reason: e.message })}`])
      }
    }
    setProgress('')
    setRunning(false)
    await load()
  }

  return (
    <div data-cloud-tool="" className="space-y-8 max-w-4xl mx-auto">
      {error && <p role="alert" className="text-xs" style={{ color: 'rgb(var(--c-danger))' }}>{error}</p>}
      <Panel title={t('cloud.remaining')}>
        {!list ? (
          <p className="text-nier-bg/65 text-xs">{t('common.loading')}…</p>
        ) : list.remaining.length === 0 ? (
          <p className="text-nier-bg/70 text-xs">{t('cloud.noneLeft')}</p>
        ) : (
          <>
            <ul className="space-y-1.5 text-xs max-h-72 overflow-y-auto mb-5">
              {list.remaining.map(atrium => (
                <li key={atrium.id} data-remaining={atrium.id} className="flex justify-between gap-3 border-t border-nier-border/15 pt-1.5">
                  <span className="text-nier-strong truncate">{atrium.name}</span>
                  <span className="text-nier-bg/60 shrink-0">
                    {atrium.owner_user_id ? day(atrium.created_at) : t('cloud.noOwner')}
                  </span>
                </li>
              ))}
            </ul>
            <button type="button" onClick={() => void holdAll()} disabled={running || !owned.length} className="landing-cta px-5 py-3 text-[11px] tracking-[0.2em] uppercase disabled:opacity-50">
              {t('cloud.holdAll', { count: owned.length })}
            </button>
          </>
        )}
        {progress && <p role="status" className="mt-4 text-nier-bg/80 text-xs">{progress}</p>}
        {log.length > 0 && (
          <ul className="mt-4 space-y-1 text-[11px] text-nier-bg/80">
            {log.map((line, i) => <li key={i}>{line}</li>)}
          </ul>
        )}
      </Panel>

      <Panel title={t('cloud.profiles')}>
        <p className="text-nier-bg/75 text-xs leading-relaxed mb-4">{t('cloud.profilesHint')}</p>
        <button type="button" onClick={() => void copyProfiles()} disabled={running} className={BUTTON}>{t('cloud.copyProfiles')}</button>
        {profiles && <p role="status" className="mt-3 text-nier-bg/80 text-xs">{profiles}</p>}
      </Panel>

      <Panel title={t('cloud.held')}>
        {!list ? null : list.held.length === 0 ? (
          <p className="text-nier-bg/70 text-xs">{t('cloud.noneHeld')}</p>
        ) : (
          <ul className="space-y-1.5 text-xs">
            {list.held.map(atrium => (
              <li key={atrium.lobby_id} data-held={atrium.lobby_id} className="flex justify-between gap-3 border-t border-nier-border/15 pt-1.5">
                <span className="text-nier-strong truncate">{atrium.name}</span>
                <span className="text-nier-bg/60 shrink-0">
                  {atrium.released_at ? t('cloud.heldAt', { date: day(atrium.released_at) }) : t('cloud.unfinished')}
                </span>
              </li>
            ))}
          </ul>
        )}
        <button type="button" onClick={() => void load()} disabled={running} className={`mt-5 ${BUTTON}`}>{t('ops.refresh')}</button>
      </Panel>
    </div>
  )
}
