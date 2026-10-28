// The code-history page's pictures of the app as it was (public/code-history/
// shots): for the last commit of each day there's history, that commit run
// as it stood -- checked out into a worktree of its own, served by Vite --
// and photographed in a headless Edge. Its front page, its welcome, its
// atrium browser, inside an atrium, and its contributors wall, as far as that
// day's app had them.
//
// Each version talks to fake-supabase.js instead of its backend: a demo
// account and atrium, and the real contributors wall (public on the site)
// cut to the people who had contributed by that day.
//
//   node scripts/code-shots/capture.mjs                every day not yet taken
//   node scripts/code-shots/capture.mjs 2026-08-15     those days only, again
//
//   node scripts/code-shots/capture.mjs --pick        only choose again
//
// Every day's pictures are kept, but only the days a screen changed look
// are published: each screen's picture is compared with the last one of it
// kept, and kept itself once it differs by more than CHANGE -- a new look,
// not a moved word. A slow drift is caught too, as it adds up against the
// last kept, not the day before.
//
// Everything it works in is kept under %LOCALAPPDATA%/atrium-code-shots, so a
// run stopped part-way goes on where it left off. The worktree borrows this
// repo's node_modules: every version is run on today's packages, which all
// of them have built on so far.

import { execFileSync, spawn } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync, symlinkSync, readdirSync, rmSync, copyFileSync } from 'node:fs'
import { join, resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { tmpdir } from 'node:os'
import { createHash } from 'node:crypto'

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const CACHE = join(process.env.LOCALAPPDATA ?? tmpdir(), 'atrium-code-shots')
const TREE = join(CACHE, 'tree')
const ENV = join(CACHE, 'env')
const RAW = join(CACHE, 'raw'), ALL = join(CACHE, 'all.json')
const OUT = join(REPO, 'public/code-history/shots')
const FAKE = join(REPO, 'scripts/code-shots/fake-supabase.js').replace(/\\/g, '/')
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'
const PORT = 5301, CDP = 9341
const WIDTH = 1440, HEIGHT = 900, SCALE = 2 / 3
const SCREENS = ['landing', 'welcome', 'browse', 'atrium', 'contributors']
// How different a screen must look from its last kept picture to be kept:
// one less the correlation of the two, small, blurred and grey -- how far
// the shapes moved, whatever the brightness. A mean difference barely moved
// for a whole redesign: these screens are mostly dark ground.
const CHANGE = Number(process.env.SHOTS_CHANGE ?? 0.25)
// An atrium's edges alone (see pick) are mostly its interface: less moves more.
const ATRIUM_CHANGE = 0.15
const correlation = (a, b) => {
  const mean = v => v.reduce((sum, x) => sum + x, 0) / v.length
  const ma = mean(a), mb = mean(b)
  let ab = 0, aa = 0, bb = 0
  for (let i = 0; i < a.length; i++) { const da = a[i] - ma, db = b[i] - mb; ab += da * db; aa += da * da; bb += db * db }
  return aa && bb ? ab / Math.sqrt(aa * bb) : 0
}
const sleep = ms => new Promise(r => setTimeout(r, ms))
const FAKE_HASH = createHash('sha256').update(readFileSync(FAKE)).digest('hex').slice(0, 10)
const git = (...args) => execFileSync('git', args, { cwd: REPO, encoding: 'utf8' }).trim()

// The days: each one's last commit on this branch.
function days() {
  const last = new Map()
  for (const line of git('log', '--format=%H %ct %cd', '--date=format-local:%Y-%m-%d').split('\n')) {
    const [hash, t, day] = line.split(' ')
    if (!last.has(day)) last.set(day, { hash, t: +t, day })
  }
  return [...last.values()].sort((a, b) => a.t - b.t)
}

function prepare() {
  mkdirSync(ENV, { recursive: true })
  mkdirSync(RAW, { recursive: true })
  mkdirSync(OUT, { recursive: true })
  writeFileSync(join(ENV, '.env'), 'VITE_SUPABASE_URL=https://demo.supabase.co\nVITE_SUPABASE_ANON_KEY=demo\n')
  if (!existsSync(TREE)) git('worktree', 'add', '--detach', TREE, 'HEAD')
  if (!existsSync(join(TREE, 'node_modules'))) symlinkSync(join(REPO, 'node_modules'), join(TREE, 'node_modules'), 'junction')
}

// The wall as it is, once: who contributed, and since when.
async function contributors() {
  const kept = join(CACHE, 'contributors.json')
  if (existsSync(kept)) return JSON.parse(readFileSync(kept, 'utf8'))
  const wall = await (await fetch('https://rooms.digitalatrium.org/contributions/wall')).json()
  writeFileSync(kept, JSON.stringify(wall.contributors ?? []))
  return wall.contributors ?? []
}

// The demo account, and its atrium: the references and notes of the
// landing's example atrium, in the oldest shape every version reads.
const DEMO = '00000000-0000-4000-8000-0000000000a1'
const USER = { id: '00000000-0000-4000-8000-00000000000u', email: 'visitor@digitalatrium.org', aud: 'authenticated', role: 'authenticated', user_metadata: { username: 'visitor' }, app_metadata: { provider: 'email' }, created_at: '2025-11-16T00:00:00Z' }
function demo(day, wall) {
  const at = '2025-11-16T12:00:00Z'
  // Around (400, 300), where an atrium's view opens.
  const trace = (id, type, x, y, extra) => ({
    id, lobby_id: DEMO, user_id: USER.id, username: 'visitor', type, content: '', position_x: x + 400, position_y: y + 300, scale: 1, rotation: 0,
    created_at: at, image_url: null, media_url: null, show_border: true, show_background: true, ...extra,
  })
  const photo = (id, pic, x, y, w, h) => trace(id, 'image', x, y, { image_url: `https://picsum.photos/id/${pic}/800/560`, media_url: `https://picsum.photos/id/${pic}/800/560`, width: w, height: h })
  const traces = [
    trace('t1', 'text', -260, -230, { content: 'Light from above', width: 360, height: 80, font_size: 36 }),
    trace('t2', 'text', -260, -170, { content: 'Look development for a short film', width: 360, height: 40 }),
    photo('p1', 1043, -330, 0, 300, 210), photo('p2', 1015, 0, 0, 300, 210), photo('p3', 1036, 330, 0, 300, 210),
    photo('p4', 1018, -165, 240, 300, 210), photo('p5', 1039, 165, 240, 300, 210),
    trace('t3', 'text', 300, -200, { content: 'Warm light through the tunnel; the orb is the only cold thing.', width: 300, height: 90 }),
  ]
  const lobby = (id, name, days) => ({ id, name, owner_user_id: USER.id, created_by: USER.id, is_public: true, max_players: 50, created_at: new Date(Date.parse(at) + days * 864e5).toISOString(), updated_at: at, theme_settings: null })
  return {
    signedIn: true,
    user: USER,
    db: {
      profiles: [{ id: USER.id, username: 'visitor', display_name: 'Visitor', created_at: at }],
      lobbies: [lobby(DEMO, 'Light from above', 0), lobby('00000000-0000-4000-8000-0000000000a2', 'Reference wall', 1), lobby('00000000-0000-4000-8000-0000000000a3', 'Storyboard 03', 2)],
      lobby_members: [{ lobby_id: DEMO, user_id: USER.id, role: 'owner', username: 'visitor' }],
      traces,
      layers: [], trace_links: [], lobby_locations: [], trace_groups: [],
      contributors: wall.filter(c => !c.since || c.since <= day),
    },
  }
}

// A minimal CDP client over one page.
async function page() {
  const target = await (await fetch(`http://127.0.0.1:${CDP}/json/new?about:blank`, { method: 'PUT' })).json()
  const ws = new WebSocket(target.webSocketDebuggerUrl)
  await new Promise(r => ws.addEventListener('open', r))
  let id = 0
  const waiting = new Map()
  ws.addEventListener('message', m => {
    const msg = JSON.parse(m.data)
    if (msg.id && waiting.has(msg.id)) { waiting.get(msg.id)(msg); waiting.delete(msg.id) }
    // An old alert or prompt would hold the page, and everything asked of it, for good.
    if (msg.method === 'Page.javascriptDialogOpening') send('Page.handleJavaScriptDialog', { accept: true, promptText: '' })
    if (process.env.SHOTS_DEBUG && (msg.method === 'Runtime.exceptionThrown' || (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') || msg.method === 'Page.javascriptDialogOpening')) {
      console.log('   page:', JSON.stringify(msg.params).slice(0, 300))
    }
  })
  const send = (method, params = {}) => Promise.race([
    new Promise(r => { const i = ++id; waiting.set(i, r); ws.send(JSON.stringify({ id: i, method, params })) }),
    sleep(20000).then(() => ({ error: 'timed out' })),
  ])
  const evaluate = async expression => (await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })).result?.result?.value
  const close = async () => { ws.close(); await fetch(`http://127.0.0.1:${CDP}/json/close/${target.id}`) }
  await send('Page.enable')
  await send('Runtime.enable')
  await send('Emulation.setDeviceMetricsOverride', { width: WIDTH, height: HEIGHT, deviceScaleFactor: 1, mobile: false })
  await send('Emulation.setFocusEmulationEnabled', { enabled: true })
  return { send, evaluate, close }
}

// In the page: press the first button or link whose words match.
const PRESS = `(re => { const el = [...document.querySelectorAll('button, a, [role=button]')].find(e => re.test((e.innerText || e.getAttribute('aria-label') || '').trim()) && e.offsetParent); el?.click(); return !!el })`

// How a version moves between screens: by path (lib/route), by hash, or by
// what's pressed.
function routing() {
  if (existsSync(join(TREE, 'src/lib/route.ts'))) return 'path'
  return /location\.hash/.test(readFileSync(join(TREE, 'src/App.tsx'), 'utf8')) ? 'hash' : 'state'
}

async function shoot(day, wall, routes) {
  const base = `http://127.0.0.1:${PORT}`
  const address = path => (routes === 'path' ? base + path : routes === 'hash' ? `${base}/#${path}` : `${base}/`)
  const taken = {}
  for (const screen of SCREENS) {
    const p = await page()
    try {
      const shots = { ...demo(day.day, wall), signedIn: screen !== 'landing' }
      // Nothing kept from another version, or another screen.
      await p.send('Storage.clearDataForOrigin', { origin: base, storageTypes: 'all' })
      await p.send('Page.addScriptToEvaluateOnNewDocument', { source: `window.__shots = ${JSON.stringify(shots)}; try { localStorage.setItem('atrium_language', 'en'); localStorage.setItem('atrium.minimap', 'off') } catch {}` })
      const to = { landing: '/', welcome: '/welcome', browse: '/browse', atrium: `/atrium/${DEMO}`, contributors: '/contributors' }[screen]
      await p.send('Page.navigate', { url: address(to) })
      for (let i = 0; i < 60 && (await p.evaluate('document.readyState')) !== 'complete'; i++) await sleep(250)
      await sleep(5000)
      // Before there were routes: the atriums are behind the welcome's Enter
      // (a name asked first, at the very start), and one is entered from them.
      if (routes === 'state' && (screen === 'browse' || screen === 'atrium')) {
        await p.evaluate(`(() => { const input = document.querySelector('input'); if (input && !input.value) { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, 'visitor'); input.dispatchEvent(new Event('input', { bubbles: true })) } return 1 })()`)
        await p.evaluate(`${PRESS}(/enter|join|start|continue/i)`)
        await sleep(2500)
        if (screen === 'atrium') {
          // Its card's own Join -- never the delete beside it.
          const joined = await p.evaluate(`(() => {
            let card = [...document.querySelectorAll('*')].find(e => e.children.length === 0 && /^Light from above$/.test(e.textContent.trim()))
            while (card && !card.querySelector('button')) card = card.parentElement
            const join = card && [...card.querySelectorAll('button')].find(b => /^(join|enter|open)/i.test(b.innerText.trim()))
            ;(join ?? card)?.click()
            return !!join
          })()`)
          if (process.env.SHOTS_DEBUG) console.log('  joined by its card:', joined, await p.evaluate(`(async () => { const t = await (await fetch('/@fs/${FAKE}')).text(); const lib = await (await fetch('/src/lib/supabase.ts')).text(); return 'served has rpc answers: ' + t.includes('(can|is|has)') + ' | lib imports: ' + (lib.match(/from ["'][^"']*supabase[^"']*["']/g) || []).join(', ') })()`))
          await sleep(6000)
        }
      }
      if (routes === 'state' && screen === 'contributors') continue
      const text = (await p.evaluate('document.body.innerText')) ?? ''
      const fits = {
        landing: true,
        welcome: true,
        browse: /Light from above/.test(text),
        atrium: !!(await p.evaluate(`!!document.querySelector('canvas') && document.querySelectorAll('img').length > 2`)),
        contributors: /contribut/i.test(text),
      }[screen]
      const shot = await p.send('Page.captureScreenshot', { format: 'webp', quality: 72, clip: { x: 0, y: 0, width: WIDTH, height: HEIGHT, scale: SCALE } })
      const name = `${day.day}-${screen}.webp`
      // One that isn't what it should be is kept aside, to see why.
      if (!fits) { mkdirSync(join(CACHE, 'rejected'), { recursive: true }); writeFileSync(join(CACHE, 'rejected', name), Buffer.from(shot.result.data, 'base64')); continue }
      writeFileSync(join(RAW, name), Buffer.from(shot.result.data, 'base64'))
      taken[screen] = name
    } finally {
      await p.close()
    }
  }
  return taken
}

// The days a screen changed look, published: their pictures copied out, the
// rest of what's published there removed, and the list of them written.
async function pick() {
  const all = existsSync(ALL) ? JSON.parse(readFileSync(ALL, 'utf8')) : []
  const p = await page()
  await p.evaluate(`window.look = async src => {
    const img = new Image(); img.src = src; await img.decode()
    const c = document.createElement('canvas'); c.width = 96; c.height = 60
    const g = c.getContext('2d'); g.filter = 'blur(1px) grayscale(1)'; g.drawImage(img, 0, 0, 96, 60)
    return [...g.getImageData(0, 0, 96, 60).data].filter((_, i) => i % 4 === 0)
  }; 1`)
  // Per screen, its pictures in order, each marked kept or not.
  const last = {}, kept = new Map()
  for (const [at, day] of all.entries()) {
    for (const [screen, file] of Object.entries(day.screens)) {
      if (!existsSync(join(RAW, file))) continue
      const pixels = await p.evaluate(`look('data:image/webp;base64,${readFileSync(join(RAW, file)).toString('base64')}')`)
      // Inside an atrium, its interface is round the edges and the middle is
      // the same demo atrium every day: a new toolbar is looked for there
      // alone, and a new way of drawing traces in the whole.
      const edges = pixels.filter((_, i) => { const x = i % 96, y = Math.floor(i / 96); return x < 12 || x >= 84 || y < 8 || y >= 52 })
      const before = last[screen]
      const whole = before ? 1 - correlation(pixels, before.pixels) : 1
      const edge = before ? 1 - correlation(edges, before.edges) : 1
      if (process.env.SHOTS_DEBUG) console.log(day.day, screen, whole.toFixed(3), edge.toFixed(3))
      if (whole > CHANGE || (screen === 'atrium' && edge > ATRIUM_CHANGE)) {
        last[screen] = { pixels, edges }
        // A look still settling over days in a row: its last day stands for it.
        const previous = kept.get(screen)?.at(-1)
        if (previous && previous.at === at - 1 && previous.at !== 0) kept.get(screen).pop()
        kept.set(screen, [...(kept.get(screen) ?? []), { at, file }])
      }
    }
  }
  const picked = all.map((day, at) => ({ ...day, screens: Object.fromEntries([...kept].flatMap(([screen, list]) => list.filter(k => k.at === at).map(k => [screen, k.file]))) }))
    .filter(day => Object.keys(day.screens).length)
  await p.close()
  const keep = new Set(picked.flatMap(day => Object.values(day.screens)))
  for (const file of readdirSync(OUT)) if (file.endsWith('.webp') && !keep.has(file)) rmSync(join(OUT, file))
  for (const file of keep) copyFileSync(join(RAW, file), join(OUT, file))
  writeFileSync(join(OUT, 'shots.json'), JSON.stringify(picked, null, 1))
  console.log(`published ${keep.size} pictures from ${picked.length} of ${all.length} days`)
}

const asked = process.argv.slice(2).filter(a => !a.startsWith('--'))
const onlyPick = process.argv.includes('--pick')
prepare()
const wall = await contributors()
const manifestPath = ALL
const manifest = existsSync(manifestPath) ? JSON.parse(readFileSync(manifestPath, 'utf8')) : []
const todo = onlyPick ? [] : days().filter(d => (asked.length ? asked.includes(d.day) : !manifest.some(m => m.day === d.day)))
console.log(`${todo.length} day(s) to take`)

const edge = spawn(EDGE, ['--headless=new', `--remote-debugging-port=${CDP}`, `--user-data-dir=${join(CACHE, 'edge')}`, '--autoplay-policy=no-user-gesture-required', '--mute-audio', `--window-size=${WIDTH},${HEIGHT}`], { stdio: 'ignore' })
for (let i = 0; i < 40; i++) { try { await fetch(`http://127.0.0.1:${CDP}/json/version`); break } catch { await sleep(250) } }
const { createServer } = await import('vite')
try {
  for (const day of todo) {
    execFileSync('git', ['checkout', '-q', '--force', '--detach', day.hash], { cwd: TREE })
    const config = ['vite.config.ts', 'vite.config.js'].map(f => join(TREE, f)).find(existsSync) ?? false
    let server
    // Tailwind reads its config, and the files it takes classes from, from
    // where it's run: here, they'd be today's.
    process.chdir(TREE)
    try {
      server = await createServer({
        // Every version pre-bundles supabase-js -- the stand-in, through the
        // alias -- so the bundles are kept per version of the stand-in.
        root: TREE, configFile: config, envDir: ENV, cacheDir: join(CACHE, 'vite-' + FAKE_HASH), logLevel: 'silent', clearScreen: false,
        // `open: false`: the oldest configs open a browser on the desktop.
        server: { port: PORT, strictPort: true, host: '127.0.0.1', open: false, fs: { strict: false }, hmr: false, watch: null },
        resolve: { alias: [{ find: /^@supabase\/supabase-js$/, replacement: FAKE }] },
        // The site's image proxy (functions/api/proxy-image.js), which some
        // versions show every web picture through: a dev server has none.
        plugins: [{
          name: 'code-shots-proxy',
          configureServer(dev) {
            dev.middlewares.use('/api/proxy-image', async (req, res) => {
              const address = new URL(req.url, 'http://x').searchParams.get('url')
              const answer = address ? await fetch(address).catch(() => null) : null
              if (!answer?.ok) { res.statusCode = 404; res.end(); return }
              res.setHeader('content-type', answer.headers.get('content-type') || 'image/jpeg')
              res.end(Buffer.from(await answer.arrayBuffer()))
            })
          },
        }],
      })
      await server.listen()
      const taken = await shoot(day, wall, routing())
      const entry = { day: day.day, t: day.t, hash: day.hash.slice(0, 7), screens: taken }
      const at = manifest.findIndex(m => m.day === day.day)
      if (at >= 0) manifest[at] = entry
      else manifest.push(entry)
      manifest.sort((a, b) => a.t - b.t)
      writeFileSync(manifestPath, JSON.stringify(manifest, null, 1))
      console.log(day.day, day.hash.slice(0, 7), Object.keys(taken).join(' ') || '(nothing)')
    } catch (error) {
      console.log(day.day, day.hash.slice(0, 7), 'failed:', String(error?.message ?? error).split('\n')[0])
    } finally {
      await server?.close()
      process.chdir(REPO)
    }
  }
  await pick()
} finally {
  if (edge.pid) try { execFileSync('taskkill', ['/F', '/T', '/PID', String(edge.pid)], { stdio: 'ignore' }) } catch {}
}
process.exit(0)
