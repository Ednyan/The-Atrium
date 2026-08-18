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
const CACHE_KEY = 'atrium_contributions_cache_v1'
const REQUEST_TIMEOUT_MS = 8000

export interface Contributor {
  displayName: string
  // Everything this person has given, in euros. Decides both the colour and
  // how near the centre of the page they sit.
  amountEur: number
  isMonthly: boolean
  // Their current monthly rate, when they have one. Null for one-off givers.
  monthlyEur: number | null
  // When they first gave, which is what "since" means on a monthly trace.
  since: string
  contributionCount: number
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

function readCache(): ContributionsData {
  try {
    const raw = localStorage.getItem(CACHE_KEY)
    if (!raw) return EMPTY
    const parsed = JSON.parse(raw)
    return {
      contributors: Array.isArray(parsed.contributors) ? parsed.contributors : [],
      month: parsed.month ?? null,
      fetchedAt: typeof parsed.fetchedAt === 'number' ? parsed.fetchedAt : null,
    }
  } catch {
    return EMPTY
  }
}

function writeCache(data: ContributionsData) {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(data))
  } catch {
    // A full or disabled local store costs a cache, not the feature.
  }
}

async function getJson(path: string, signal: AbortSignal): Promise<any> {
  const response = await fetch(`${REST_URL}/rest/v1/${path}`, {
    headers: { apikey: ANON_KEY, Authorization: `Bearer ${ANON_KEY}` },
    signal,
  })
  if (!response.ok) throw new Error(`${response.status}`)
  return response.json()
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
      getJson('contributors_public?select=display_name,amount_eur,is_monthly,monthly_eur,since,contribution_count', controller.signal),
      getJson('contributions_month?select=total_cents,goal_cents,contribution_count', controller.signal),
    ])

    const month = monthRows?.[0]
    const data: ContributionsData = {
      contributors: (contributorRows ?? []).map((row: any) => ({
        displayName: String(row.display_name ?? ''),
        amountEur: Number(row.amount_eur) || 0,
        isMonthly: !!row.is_monthly,
        monthlyEur: row.monthly_eur == null ? null : Number(row.monthly_eur) || 0,
        since: String(row.since ?? ''),
        contributionCount: Number(row.contribution_count) || 1,
      })).filter((c: Contributor) => c.displayName.length > 0),
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
