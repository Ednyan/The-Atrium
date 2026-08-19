// The contributors list and the monthly goal bar, cached so the desktop app
// keeps working with no connection at all.
//
// Two things make this its own module rather than a couple of supabase calls.
//
// First, it cannot go through `supabase`. On desktop that is the SQLite shim
// (see lib/localDb), which has never heard of these tables and whose query
// builder would throw rather than return an error -- taking down whatever
// called it. So this talks to the REST endpoint directly, the same way on both
// platforms, and the shim is never involved.
//
// Second, the desktop app is meant to work offline. Nothing here is ever
// awaited to render: the last values are read from local storage immediately,
// and a refresh happens in the background when there's a network to do it on.
// A donor list is not worth a spinner, and is worth even less as an error.

const REFRESH_INTERVAL_MS = 60 * 60 * 1000 // hourly while the app is open
const CACHE_KEY = 'atrium_contributions_cache_v2'
// The v1 shape stored every contributor as an object with full property names,
// which at ten thousand rows was most of a megabyte of the word "displayName".
const LEGACY_CACHE_KEYS = ['atrium_contributions_cache_v1']

// If a full cache won't fit, store fewer rather than none. Ordered largest
// first, so what survives is what the wall would draw nearest the middle.
const CACHE_STEPS = [Infinity, 6000, 3000, 1200, 400]
const REQUEST_TIMEOUT_MS = 8000

export interface Contributor {
  displayName: string
  // Everything this person has given, in euros. Decides both the colour and
  // how near the centre of the page they sit.
  amountEur: number
  // Has ever subscribed. Decides the gradient, which every monthly contributor
  // carries whether or not the subscription is still running.
  isMonthly: boolean
  // Is subscribed right now. Decides the light, and whether a rate is shown at
  // all. Derived from how recently a monthly payment landed, so a cancelled
  // card, a failed one and a deliberate cancellation all read the same.
  monthlyActive: boolean
  // Their current monthly rate, when they have one. Null for one-off givers.
  monthlyEur: number | null
  // When they first gave, which is what "since" means on a monthly trace.
  since: string
  contributionCount: number
  // Whether any of what they gave was a one-off. Someone who has both a
  // subscription and a one-off is a third kind of contributor, and the wall
  // draws them as one.
  hasOneTime: boolean
  // How much of the total was one-off, in euros.
  oneTimeEur: number
  // What they gave inside each window, in euros. Null when the view predates
  // these columns, which is how the range filter knows to stay hidden rather
  // than silently emptying the wall.
  amount7d: number | null
  amount30d: number | null
  amount365d: number | null
  // Set only on locally generated previews (see lib/seedContributors). Never
  // arrives from the server, and is what makes a fake trace say so on the wall.
  isSeed?: boolean
  // Found by searching past the wall's 2000-row cap: still a contributor, just
  // one the page has no room to draw until somebody asks for them by name.
  isBeyondWall?: boolean
}

export interface MonthlyProgress {
  totalCents: number
  goalCents: number
  contributionCount: number
}

export interface ContributionsData {
  contributors: Contributor[]
  month: MonthlyProgress | null
  // When this was last successfully fetched. Null means it never has been --
  // a fresh install that has not yet been online.
  fetchedAt: number | null
}

const EMPTY: ContributionsData = { contributors: [], month: null, fetchedAt: null }

// Baked in at build time. Absent from desktop release builds until the workflow
// passes them, which is why every path here tolerates having no endpoint at all
// rather than treating it as a failure worth reporting.
const REST_URL = import.meta.env.VITE_SUPABASE_URL
const ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY

// Contributors are stored as arrays rather than objects.
//
// This is the desktop app's whole offline copy of the wall, and at ten thousand
// contributors the property names alone were about a megabyte -- the same eight
// words repeated ten thousand times. Positional rows cut the stored size by
// three quarters, which is the difference between comfortably inside the
// origin's storage budget and quietly failing to write at all one day.
//
// The order below is the format. It cannot be reordered without changing
// CACHE_KEY, which is what the version suffix is for.
const encode = (data: ContributionsData, limit: number) =>
  JSON.stringify({
    rows: data.contributors.slice(0, limit).map(person => [
      person.displayName,
      person.amountEur,
      person.isMonthly ? 1 : 0,
      person.monthlyEur ?? 0,
      person.since,
      person.contributionCount,
      person.hasOneTime ? 1 : 0,
      person.oneTimeEur,
      person.monthlyActive ? 1 : 0,
      person.amount7d,
      person.amount30d,
      person.amount365d,
    ]),
    month: data.month,
    fetchedAt: data.fetchedAt,
  })

function readCache(): ContributionsData {
  try {
    const raw = localStorage.getItem(CACHE_KEY)
    if (!raw) return EMPTY
    const parsed = JSON.parse(raw)
    return {
      contributors: Array.isArray(parsed.rows)
        ? parsed.rows.map((row: any[]) => ({
            displayName: String(row[0] ?? ''),
            amountEur: Number(row[1]) || 0,
            isMonthly: row[2] === 1,
            monthlyEur: Number(row[3]) || null,
            since: String(row[4] ?? ''),
            contributionCount: Number(row[5]) || 1,
            hasOneTime: row[6] === 1,
            oneTimeEur: Number(row[7]) || 0,
            monthlyActive: row[8] === 1,
            amount7d: row[9] ?? null,
            amount30d: row[10] ?? null,
            amount365d: row[11] ?? null,
          }))
        : [],
      month: parsed.month ?? null,
      fetchedAt: typeof parsed.fetchedAt === 'number' ? parsed.fetchedAt : null,
    }
  } catch {
    return EMPTY
  }
}

function writeCache(data: ContributionsData) {
  try {
    for (const key of LEGACY_CACHE_KEYS) localStorage.removeItem(key)
  } catch {
    // Storage disabled entirely. The loop below will find that out too.
  }

  // Storing fewer contributors is a worse cache; storing none is no offline
  // wall at all. A quota that the whole list won't fit into is not a reason to
  // keep nothing, so this steps down until something does.
  for (const limit of CACHE_STEPS) {
    try {
      localStorage.setItem(CACHE_KEY, encode(data, limit))
      return
    } catch {
      // Almost certainly the quota. Try a smaller slice.
    }
  }

  // Nothing fitted, so whatever is already stored stays: stale and real beats
  // empty. Not an error worth reporting -- the page works online regardless.
}

async function getJson(path: string, signal: AbortSignal): Promise<any> {
  const response = await fetch(`${REST_URL}/rest/v1/${path}`, {
    headers: { apikey: ANON_KEY, Authorization: `Bearer ${ANON_KEY}` },
    signal,
  })
  if (!response.ok) throw new Error(`${response.status}`)
  return response.json()
}

// Enough to find yourself among namesakes, few enough that a search never
// pours hundreds of traces onto a wall that was not drawn to hold them.
const SEARCH_LIMIT = 40

function toContributor(row: any): Contributor {
  return {
    displayName: String(row.display_name ?? ''),
    amountEur: Number(row.amount_eur) || 0,
    isMonthly: !!row.is_monthly,
    // Absent on a view that predates the subscription-state migration. Reading
    // that as "not running" is the safe way round: the trace keeps its gradient
    // and simply doesn't claim an active subscription.
    monthlyActive: row.monthly_active === true,
    monthlyEur: row.monthly_eur == null ? null : Number(row.monthly_eur) || 0,
    // Kept as a calendar date. The wall shows a day, never a time, and the
    // rest of an ISO timestamp was a fifth of the offline cache.
    since: String(row.since ?? '').slice(0, 10),
    contributionCount: Number(row.contribution_count) || 1,
    // Absent on the older view shape, which reads as "no one-off known" -- and
    // draws exactly as the wall did before these columns existed.
    hasOneTime: row.has_one_time === true,
    oneTimeEur: Number(row.one_time_eur) || 0,
    amount7d: row.amount_7d == null ? null : Number(row.amount_7d) || 0,
    amount30d: row.amount_30d == null ? null : Number(row.amount_30d) || 0,
    amount365d: row.amount_365d == null ? null : Number(row.amount_365d) || 0,
  }
}

const CONTRIBUTOR_COLUMNS = 'display_name,amount_eur,is_monthly,monthly_eur,since,contribution_count'
const CONTRIBUTOR_COLUMNS_KINDS = `${CONTRIBUTOR_COLUMNS},has_one_time,one_time_eur,monthly_active,amount_7d,amount_30d,amount_365d`

// Asks for the newer columns and falls back to the older shape if the view
// hasn't got them yet.
//
// PostgREST answers a request for a column that doesn't exist with an error,
// not by ignoring it -- so a client deployed before its migration was run would
// empty the wall rather than degrade. That ordering is easy to get wrong and
// expensive to notice, and the cost of not depending on it is one retry.
async function getContributors(signal: AbortSignal): Promise<any[]> {
  try {
    return await getJson(`contributors_public?select=${CONTRIBUTOR_COLUMNS_KINDS}`, signal)
  } catch {
    return await getJson(`contributors_public?select=${CONTRIBUTOR_COLUMNS}`, signal)
  }
}

// Fetches both views, writes the cache, and returns what it got. Resolves to
// null on any failure -- offline, blocked, no endpoint configured -- because
// every one of those means the same thing here: keep showing what we had.
export async function refreshContributions(): Promise<ContributionsData | null> {
  if (!REST_URL || !ANON_KEY) return null

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)

  try {
    const [contributorRows, monthRows] = await Promise.all([
      getContributors(controller.signal),
      getJson('contributions_month?select=total_cents,goal_cents,contribution_count', controller.signal),
    ])

    const month = monthRows?.[0]
    const data: ContributionsData = {
      contributors: (contributorRows ?? []).map(toContributor).filter((c: Contributor) => c.displayName.length > 0),
      month: month
        ? {
            // Postgres returns bigint as a string, since it doesn't fit a JS
            // number in the general case. These do, but they arrive as text.
            totalCents: Number(month.total_cents) || 0,
            goalCents: Number(month.goal_cents) || 0,
            contributionCount: Number(month.contribution_count) || 0,
          }
        : null,
      fetchedAt: Date.now(),
    }

    writeCache(data)
    return data
  } catch {
    return null
  } finally {
    clearTimeout(timeout)
  }
}

// Looking somebody up past the cap.
//
// contributors_public stops at 2000 rows because that is what can be drawn.
// contributors_searchable is the same aggregation with no limit, asked one
// narrow question at a time -- which is affordable in a way of downloading
// every contributor to search locally is not.
//
// Resolves to an empty list on any failure, including the view not existing
// yet. A search that quietly finds nothing extra is the same experience the
// page had before this, which is the right way to fail.
export async function searchContributors(query: string): Promise<Contributor[]> {
  const needle = query.trim()
  if (!REST_URL || !ANON_KEY || needle.length < 2) return []

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)

  try {
    // PostgREST reads * as the wildcard in an ilike, so the value is encoded
    // rather than interpolated -- a name with a comma or a dot in it would
    // otherwise be read as filter syntax.
    const pattern = encodeURIComponent(`*${needle}*`)
    const rows = await getJson(
      `contributors_searchable?select=${CONTRIBUTOR_COLUMNS_KINDS}&display_name=ilike.${pattern}&limit=${SEARCH_LIMIT}`,
      controller.signal,
    )
    return (rows ?? []).map(toContributor).filter((c: Contributor) => c.displayName.length > 0)
  } catch {
    return []
  } finally {
    clearTimeout(timeout)
  }
}

// What to show right now: whatever was last cached, with no waiting and no
// network. Safe to call before anything has ever been fetched.
export function getCachedContributions(): ContributionsData {
  return readCache()
}

// Refreshes on open, then hourly, then whenever the machine says it is back
// online -- the case that matters for a desktop app that was launched on a
// train. Returns a teardown for the caller's effect.
export function startContributionsRefresh(onUpdate: (data: ContributionsData) => void): () => void {
  let stopped = false

  const run = async () => {
    const fresh = await refreshContributions()
    if (fresh && !stopped) onUpdate(fresh)
  }

  void run()
  const interval = setInterval(run, REFRESH_INTERVAL_MS)
  window.addEventListener('online', run)

  return () => {
    stopped = true
    clearInterval(interval)
    window.removeEventListener('online', run)
  }
}
