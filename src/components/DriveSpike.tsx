import { useEffect, useState } from 'react'
import {
  createFolder, driveRetries, fileInfo, listFolder, loadGoogleSignIn, pickFolder, readFile, shareWith, whoAmI, writeFile,
} from '../lib/drive'

// Phase 4's spike (docs/DECENTRALIZING.md): what Drive does for atriums, step
// by step, timed, with a log to send back. A developer's tool, behind
// localStorage['atrium.drivespike'] = 'on', so in English only.
const FOLDER_KEY = 'atrium.drivespike.folder'
const json = (value: unknown) => new Blob([JSON.stringify(value)], { type: 'application/json' })
const at = () => performance.now()

export default function DriveSpike() {
  const [log, setLog] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const [folder, setFolder] = useState<string | null>(() => localStorage.getItem(FOLDER_KEY))
  const [email, setEmail] = useState('')
  useEffect(() => { void loadGoogleSignIn().catch(() => {}) }, [])

  const say = (line: string) => setLog(lines => [...lines, `${new Date().toLocaleTimeString()}  ${line}`])
  const step = (name: string, run: () => Promise<string>) => async () => {
    setBusy(true)
    const start = at(), retriesBefore = driveRetries
    try {
      const result = await run()
      say(`✓ ${name}: ${result} (${Math.round(at() - start)} ms${driveRetries > retriesBefore ? `, ${driveRetries - retriesBefore} retried` : ''})`)
    } catch (error) {
      say(`✗ ${name}: ${error instanceof Error ? error.message : String(error)}`)
    } finally {
      setBusy(false)
    }
  }
  const needFolder = () => {
    if (!folder) throw new Error('make the test folder first')
    return folder
  }

  const steps: [string, () => Promise<string>][] = [
    ['Sign in with Google', async () => {
      const me = await whoAmI()
      return `${me.displayName} <${me.emailAddress}>, on ${navigator.userAgent.match(/(Firefox|Edg|Chrome|Safari)\/[\d.]+/)?.[0] ?? navigator.userAgent}`
    }],
    ['Make a test atrium folder', async () => {
      const made = await createFolder(`Atrium test ${new Date().toLocaleString()}`)
      await writeFile('atrium.json', json({ version: 1, traces: [] }), { parent: made.id })
      localStorage.setItem(FOLDER_KEY, made.id)
      setFolder(made.id)
      return `${made.name} (${made.id})`
    }],
    ['Read it back', async () => {
      const files = await listFolder(needFolder())
      const snapshot = files.find(file => file.name === 'atrium.json')
      if (!snapshot) return `no atrium.json among ${files.length} files`
      const start = at()
      const text = await (await readFile(snapshot.id)).text()
      return `${files.length} files listed; atrium.json read in ${Math.round(at() - start)} ms (${text.length} bytes)`
    }],
    ['Burst: 30 saves at once', async () => {
      const saves = await createFolder('saves', needFolder())
      const times: number[] = []
      const results = await Promise.allSettled(Array.from({ length: 30 }, async (_, i) => {
        const start = at()
        await writeFile(`${String(i).padStart(4, '0')}.json`, json({ seq: i, traces: [{ id: crypto.randomUUID(), x: i }] }), { parent: saves.id })
        times.push(at() - start)
      }))
      const failed = results.filter(r => r.status === 'rejected') as PromiseRejectedResult[]
      times.sort((a, b) => a - b)
      return `${30 - failed.length}/30 saved; each ${Math.round(times[0] ?? 0)}–${Math.round(times[times.length - 1] ?? 0)} ms, median ${Math.round(times[times.length >> 1] ?? 0)}${failed.length ? `; first failure: ${String(failed[0].reason?.message ?? failed[0].reason).slice(0, 160)}` : ''}`
    }],
    ['Change checks: 10 in a row', async () => {
      const files = await listFolder(needFolder())
      const snapshot = files.find(file => file.name === 'atrium.json')
      if (!snapshot) throw new Error('no atrium.json')
      const times: number[] = []
      for (let i = 0; i < 10; i++) { const start = at(); await fileInfo(snapshot.id); times.push(at() - start) }
      return `each ${Math.round(Math.min(...times))}–${Math.round(Math.max(...times))} ms, average ${Math.round(times.reduce((a, b) => a + b) / times.length)}`
    }],
    ['Media: 4 MB up and down', async () => {
      const bytes = new Uint8Array(4 * 1024 * 1024)
      for (let i = 0; i < bytes.length; i += 65536) crypto.getRandomValues(bytes.subarray(i, i + 65536))
      let start = at()
      const file = await writeFile('media-test.bin', new Blob([bytes], { type: 'application/octet-stream' }), { parent: needFolder() })
      const up = at() - start
      start = at()
      const back = await readFile(file.id)
      return `up ${Math.round(up)} ms, down ${Math.round(at() - start)} ms, ${back.size === bytes.length ? 'same size' : `size differs: ${back.size}`}`
    }],
    ['Settings in the hidden app folder', async () => {
      const written = await writeFile('settings.json', json({ theme: 'test', at: Date.now() }), { parent: 'appDataFolder' })
      const back = JSON.parse(await (await readFile(written.id)).text())
      return `written and read back (at ${back.at})`
    }],
    ['Open a folder shared with me (Picker)', async () => {
      const picked = await pickFolder()
      if (!picked) return 'nothing picked'
      const files = await listFolder(picked.id)
      const readable: string[] = []
      for (const file of files.filter(f => !f.mimeType?.includes('folder')).slice(0, 3)) {
        try { await readFile(file.id); readable.push(file.name) } catch (error) { readable.push(`${file.name} ✗ ${String(error).slice(0, 80)}`) }
      }
      return `${picked.name}: ${files.length} items visible; read: ${readable.join(', ') || 'none tried'}`
    }],
  ]

  return (
    <section className="border border-dashed border-nier-border/40 p-5 space-y-3 font-mono">
      <div className="text-nier-strong text-xs tracking-[0.22em] uppercase">Drive test (phase 4)</div>
      <p className="text-nier-bg/70 text-xs leading-relaxed">
        Run the steps in order. Each one is timed. Then copy the log and send it. For the Picker step, share the test folder with your second account
        first (below), then sign in here as that account in another browser.
      </p>
      <div className="flex flex-wrap gap-2">
        {steps.map(([name, run]) => (
          <button key={name} disabled={busy} onClick={step(name, run)} className="px-3 py-2 border border-nier-border/30 text-nier-bg/80 text-xs hover:border-nier-border/60 hover:text-nier-bg disabled:opacity-40">
            {name}
          </button>
        ))}
      </div>
      <div className="flex flex-wrap gap-2 items-center">
        <input value={email} onChange={e => setEmail(e.target.value)} placeholder="second account's Gmail" className="flex-1 min-w-[12rem] bg-nier-blackLight border border-nier-border/30 text-nier-bg px-3 py-2 text-xs" />
        <button disabled={busy || !email.includes('@')} onClick={step(`Share the test folder with ${email}`, async () => { await shareWith(needFolder(), email.trim(), 'writer'); return 'shared as editor; Google emails them' })} className="px-3 py-2 border border-nier-border/30 text-nier-bg/80 text-xs hover:border-nier-border/60 disabled:opacity-40">
          Share as editor
        </button>
      </div>
      <pre className="bg-nier-black border border-nier-border/20 p-3 text-[11px] text-nier-bg/80 whitespace-pre-wrap max-h-72 overflow-y-auto">{log.join('\n') || 'Nothing yet.'}</pre>
      <button onClick={() => void navigator.clipboard.writeText(log.join('\n'))} className="px-3 py-2 border border-nier-border/30 text-nier-bg/80 text-xs hover:border-nier-border/60">
        Copy the log
      </button>
    </section>
  )
}
