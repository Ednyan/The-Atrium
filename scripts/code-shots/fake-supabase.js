// What every past version of the Atrium talks to while code-shots photographs
// it: a stand-in for @supabase/supabase-js (each version made its client
// with createClient), swapped in by capture.mjs. One demo account, signed in
// or not; its atriums and the traces in one; the contributors as they stood
// on the day being shown. The driver puts all of it on window.__shots before
// the page's own code runs.
//
// Anything a version asks for that isn't here answers "nothing" rather than
// throwing, so an old screen draws as it did with an empty result.

const shots = window.__shots ?? {}
const db = shots.db ?? {}
const user = shots.signedIn ? shots.user : null
const session = user ? { access_token: 'demo', refresh_token: 'demo', token_type: 'bearer', expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, user } : null

// Something to chain from that never runs out of methods: any it doesn't
// know returns itself, and awaited it gives `result`.
function anything(result = { data: null, error: null }) {
  const target = { then: (ok, bad) => Promise.resolve(result).then(ok, bad) }
  const proxy = new Proxy(target, { get: (t, key) => (key in t ? t[key] : () => proxy) })
  return proxy
}

function query(table) {
  const filters = []
  let one = false, maybe = false, write = null, limit = null, order = null
  const builder = {
    select: () => proxy,
    insert: rows => { write = ['insert', rows]; return proxy },
    upsert: rows => { write = ['insert', rows]; return proxy },
    update: patch => { write = ['update', patch]; return proxy },
    delete: () => { write = ['delete']; return proxy },
    eq: (column, value) => { filters.push(row => row[column] === value); return proxy },
    neq: (column, value) => { filters.push(row => row[column] !== value); return proxy },
    in: (column, values) => { filters.push(row => values.includes(row[column])); return proxy },
    is: (column, value) => { filters.push(row => (row[column] ?? null) === value); return proxy },
    ilike: (column, pattern) => {
      const re = new RegExp('^' + String(pattern).replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/%/g, '.*') + '$', 'i')
      filters.push(row => re.test(String(row[column] ?? '')))
      return proxy
    },
    order: (column, options) => { order = [column, options?.ascending !== false]; return proxy },
    limit: n => { limit = n; return proxy },
    range: (from, to) => { limit = to - from + 1; return proxy },
    single: () => { one = true; return proxy },
    maybeSingle: () => { one = maybe = true; return proxy },
    then: (ok, bad) => Promise.resolve(run()).then(ok, bad),
  }
  const run = () => {
    const rows = (db[table] ??= [])
    if (write?.[0] === 'insert') {
      const added = [write[1]].flat().map(row => ({ id: crypto.randomUUID(), created_at: new Date().toISOString(), ...row }))
      rows.push(...added)
      return { data: one ? added[0] : added, error: null }
    }
    let found = rows.filter(row => filters.every(f => f(row)))
    if (write?.[0] === 'update') found.forEach(row => Object.assign(row, write[1]))
    if (write?.[0] === 'delete') db[table] = rows.filter(row => !found.includes(row))
    if (order) found = [...found].sort((a, b) => (a[order[0]] > b[order[0]] ? 1 : a[order[0]] < b[order[0]] ? -1 : 0) * (order[1] ? 1 : -1))
    if (limit != null) found = found.slice(0, limit)
    if (one) return found[0] ? { data: found[0], error: null } : { data: null, error: maybe ? null : { code: 'PGRST116', message: 'No rows' } }
    return { data: found, error: null, count: found.length }
  }
  const proxy = new Proxy(builder, { get: (t, key) => (key in t ? t[key] : () => proxy) })
  return proxy
}

const listeners = []
const auth = new Proxy({
  getSession: async () => ({ data: { session }, error: null }),
  getUser: async () => ({ data: { user }, error: null }),
  onAuthStateChange: callback => {
    listeners.push(callback)
    setTimeout(() => callback(session ? 'SIGNED_IN' : 'SIGNED_OUT', session), 0)
    return { data: { subscription: { unsubscribe() {} } } }
  },
  signOut: async () => ({ error: null }),
}, { get: (t, key) => (key in t ? t[key] : async () => ({ data: { user, session }, error: null })) })

function channel() {
  const self = new Proxy({
    on: () => self,
    subscribe: callback => { setTimeout(() => callback?.('SUBSCRIBED'), 0); return self },
    presenceState: () => ({}),
    unsubscribe: async () => 'ok',
    send: async () => 'ok',
    track: async () => 'ok',
  }, { get: (t, key) => (key in t ? t[key] : () => self) })
  return self
}

const storage = {
  from: () => new Proxy({
    getPublicUrl: path => ({ data: { publicUrl: /^(https?|data):/.test(path) ? path : `https://demo.invalid/${path}` } }),
    createSignedUrl: async path => ({ data: { signedUrl: path }, error: null }),
    list: async () => ({ data: [], error: null }),
  }, { get: (t, key) => (key in t ? t[key] : async () => ({ data: null, error: null })) }),
}

export function createClient() {
  return new Proxy({
    from: table => query(table),
    auth,
    storage,
    channel,
    removeChannel: async () => 'ok',
    removeAllChannels: async () => [],
    getChannels: () => [],
    // A question (can_user_join_lobby, is_...) is yes; a count, none yet.
    rpc: name => anything({ data: /^(can|is|has)_/.test(name) ? true : /count/.test(name) ? 0 : null, error: null }),
    functions: { invoke: async () => ({ data: null, error: { message: 'offline' } }) },
    realtime: { setAuth() {} },
  }, { get: (t, key) => (key in t ? t[key] : () => anything()) })
}

// Read straight over REST by some versions (the contributors wall): the
// same tables, as JSON.
const realFetch = window.fetch.bind(window)
window.fetch = async (input, init) => {
  const url = typeof input === 'string' ? input : input.url
  const rest = /^https:\/\/demo\.supabase\.co\/rest\/v1\/([^?]+)/.exec(url)
  if (rest) {
    const table = rest[1]
    const rows = db[table] ?? (/contribut/.test(table) ? db.contributors ?? [] : [])
    return new Response(JSON.stringify(rows), { status: 200, headers: { 'content-type': 'application/json' } })
  }
  if (/^https:\/\/demo\.(supabase\.co|invalid)\//.test(url)) return new Response('', { status: 404 })
  return realFetch(input, init)
}

// Anything else a version imports from the package.
export const SupabaseClient = Object
export const AuthError = Error
export default { createClient }
