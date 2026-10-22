import { useEffect, useState, useMemo, useRef, lazy, Suspense, type ReactNode } from 'react'
import { supabase, isDesktop } from '../lib/supabase'
import { copyLobbyId } from '../lib/clipboard'
import VaultRecoveryPanel from './VaultRecoveryPanel'
import { useGameStore, useGamePick } from '../store/gameStore'
import { showToast } from '../lib/toast'
import DriveConnection from './DriveConnection'
import ImportAtrium from './ImportAtrium'
import ConfirmBox, { ConfirmButtons } from './ConfirmBox'
import KeptWhere, { type Where } from './KeptWhere'
import { hasDriveToken, loadGoogleSignIn } from '../lib/drive'
import { HOSTED_MARK, hostedStore, isHostedId } from '../lib/hostedStore'
import { anotherAccountsDriveAtrium, askToJoin, lookAtDriveAtrium, leaveDriveAtrium, makeWorkingCopy, createDriveAtrium, declineInvitation, deleteDriveAtrium, driveProblem, ensureSignedIn, inviteIn, driveCard, isDriveAtrium, isDriveOwner, isDriveViewer, isHostedAtrium, joinDriveAtrium, keepInDrive, moveHostedToDrive, myInvitations, readInvite, rosterVersion, rowFromRoster, viewPublicAtrium, type Invitation, type JoinStep } from '../lib/driveSync'
import { publicAtriums, publicPreviewUrl } from '../lib/people'
import DriveSettings from './DriveSettings'
import { LobbyManagement } from './LobbyManagement'
import { ReportFeedbackModal } from './ReportFeedbackModal'
import DownloadAtriumPanel, { type DownloadableAtrium } from './DownloadAtriumPanel'
import ContributePanel from './ContributePanel'
import DonateButton, { DONATE_CUT } from './DonateButton'
import ThemeToggle from './ThemeToggle'
import MonthlyGoalColumn from './MonthlyGoalColumn'
import { startingAtriumTheme } from '../lib/atriumThemePresets'
import { themeOf } from '../lib/customThemes'
import { defaultPresetFor } from '../lib/tracePresets'
import { seasonalThemeNow } from '../lib/specialThemes'
import { resolveThemeNow } from '../lib/useLandingTheme'
import { openContributors } from '../lib/contributorsRoute'
import { useTranslation } from '../lib/i18n'
import { getCachedContributions, startContributionsRefresh, type ContributionsData } from '../lib/contributions'

const ExportDatabase = lazy(() => import('./ExportDatabase'))
// Phase 4's Drive test (components/DriveSpike): the platform operator's alone.
const DriveSpike = lazy(() => import('./DriveSpike'))
import type { Lobby } from '../types/database'
import { sortByLastVisited, mergeRemoteVisits } from '../lib/recentAtriums'
import { browserAtriumIds, browserEngine, clientFor, forgetBrowserAtrium, leaveBrowserAtrium, rememberBrowserAtrium, vaultProblem } from '../lib/browserAtriums'
import { checkPlatformAdmin } from '../lib/platformAdmin'
import { Check } from './ShapeStyleControls'
import type { PreviewDetail } from '../lib/atriumPreview'
import { googleOpen } from '../lib/drive'
import { googleAccount, workerAccount } from '../lib/signedIn'

// An atrium in the browser's lists, the same in each (AtriumCard), two to a
// row where there's room.
const ROW_GRID = 'grid gap-3 sm:grid-cols-2'
const ROW = 'bg-nier-black border border-nier-border/20 p-4 hover:border-nier-border/40 transition-colors'
const ROW_BUTTON = 'px-3 py-2 border border-nier-border/30 text-nier-bg/80 text-xs tracking-[0.1em] uppercase hover:border-nier-border/60 hover:text-nier-bg transition-colors'
const ROW_ENTER = 'px-4 py-2 bg-nier-bg text-nier-black text-xs tracking-[0.1em] uppercase hover:bg-nier-strong transition-colors'

// An atrium's picture on its card (lib/atriumPreview) -- read from the vault
// first, on desktop -- and the atrium's mark on its grid where there isn't
// one yet. Edge to edge across the top of the card.
function AtriumPreview({ url }: { url?: string | null }) {
  const [src, setSrc] = useState<string | null>(null)
  useEffect(() => {
    if (!url) { setSrc(null); return }
    if (!url.startsWith('local://')) { setSrc(url); return }
    let live = true
    void import('../lib/localDb').then(m => m.resolveLocalUrl(url)).then(resolved => { if (live) setSrc(resolved.startsWith('local://') ? null : resolved) })
    return () => { live = false }
  }, [url])
  return (
    <div className="relative -mx-4 -mt-4 mb-3 aspect-[16/10] overflow-hidden border-b border-nier-border/20 bg-nier-blackLight">
      {src ? (
        <img src={src} alt="" loading="lazy" decoding="async" className="absolute inset-0 w-full h-full object-cover" onError={() => setSrc(null)} />
      ) : (
        <div
          aria-hidden="true"
          className="absolute inset-0 grid place-items-center"
          style={{ backgroundImage: 'linear-gradient(rgb(var(--c-fg) / 0.06) 1px, transparent 1px), linear-gradient(90deg, rgb(var(--c-fg) / 0.06) 1px, transparent 1px)', backgroundSize: '24px 24px' }}
        >
          <span
            className="w-10 h-10 bg-nier-bg/20"
            style={{ WebkitMaskImage: 'url(/atrium-mark.png)', maskImage: 'url(/atrium-mark.png)', WebkitMaskSize: 'contain', maskSize: 'contain', WebkitMaskRepeat: 'no-repeat', maskRepeat: 'no-repeat', WebkitMaskPosition: 'center', maskPosition: 'center' }}
          />
        </div>
      )}
    </div>
  )
}

// What an atrium is, as its card says: where it's kept (`where`), one's part
// in it (`strong`), and the rest.
interface CardTag { label: string; where?: boolean; strong?: boolean }
interface CardAction { label: string; onClick: () => void; danger?: boolean; disabled?: boolean; pressed?: boolean }
const TAG = 'px-1.5 py-0.5 border text-[10px] tracking-[0.12em] uppercase'

// An atrium on the browser's lists, the same card in each: its picture, its
// name, what it is as tags, Enter and at most one other thing in sight (its
// settings), the rest under ⋯.
function AtriumCard({ name, renaming, preview, tags, busy, onEnter, enterLabel, enterDisabled, side, menu, moreLabel }: {
  name: string
  renaming?: ReactNode
  preview?: string | null
  tags: CardTag[]
  busy?: string | null
  onEnter: () => void
  enterLabel: string
  enterDisabled?: boolean
  side?: CardAction
  menu: CardAction[]
  moreLabel: string
}) {
  return (
    <div className={`${ROW} group`}>
      <AtriumPreview url={preview} />
      <div className="flex flex-col gap-3">
        <div className="min-w-0">
          {renaming ?? <h4 className="text-nier-bg text-sm tracking-wide break-words">{name}</h4>}
          <div className="flex flex-wrap gap-1.5 mt-2">
            {tags.map((tag, i) => (
              <span key={i} className={`${TAG} ${tag.where ? 'border-nier-border/40 text-nier-bg/85' : tag.strong ? 'border-nier-bg/60 text-nier-strong' : 'border-nier-border/25 text-nier-bg/65'}`}>
                {tag.where && '◇ '}{tag.label}
              </span>
            ))}
          </div>
          {busy && <p role="status" className="mt-2 text-nier-bg text-[11px] tracking-[0.12em] uppercase">◇ {busy}</p>}
        </div>
        <div className="flex items-center gap-2">
          <button onClick={onEnter} disabled={enterDisabled} className={`${ROW_ENTER} disabled:opacity-40`}>{enterLabel}</button>
          {side && (
            <button onClick={side.onClick} disabled={side.disabled} aria-pressed={side.pressed} className={`${ROW_BUTTON} disabled:opacity-40 ${side.pressed ? 'border-nier-border/70 text-nier-bg' : ''}`}>
              {side.label}
            </button>
          )}
          <div className="flex-1" />
          <CardMenu items={menu} label={moreLabel} />
        </div>
      </div>
    </div>
  )
}

// A card's other actions, under ⋯: closed by a choice, a click elsewhere, or Escape.
function CardMenu({ items, label }: { items: CardAction[]; label: string }) {
  const [open, setOpen] = useState(false)
  const box = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const away = (event: PointerEvent) => { if (!box.current?.contains(event.target as Node)) setOpen(false) }
    const key = (event: KeyboardEvent) => { if (event.key === 'Escape') setOpen(false) }
    document.addEventListener('pointerdown', away)
    document.addEventListener('keydown', key)
    return () => { document.removeEventListener('pointerdown', away); document.removeEventListener('keydown', key) }
  }, [open])
  if (!items.length) return null
  return (
    <div ref={box} className="relative">
      <button onClick={() => setOpen(!open)} aria-label={label} title={label} aria-haspopup="menu" aria-expanded={open} className={`${ROW_BUTTON} px-3 tracking-normal`}>⋯</button>
      {open && (
        <div role="menu" className="absolute right-0 top-full mt-1 z-20 min-w-[12rem] bg-nier-blackLight border border-nier-border/40 py-1 shadow-lg">
          {items.map(item => (
            <button
              key={item.label}
              role="menuitem"
              disabled={item.disabled}
              onClick={() => { setOpen(false); item.onClick() }}
              className={`block w-full text-left px-3 py-2 text-xs tracking-[0.1em] uppercase disabled:opacity-40 transition-colors ${item.danger ? 'text-red-400 hover:bg-nier-red/20' : 'text-nier-bg/85 hover:bg-nier-bg/10 hover:text-nier-bg'}`}
            >
              {item.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

interface LobbyWithOwner extends Lobby {
  ownerUsername?: string
  playerCount?: number
  // Kept in this browser (lib/browserAtriums), not the cloud -- and maybe in
  // Google Drive too (lib/driveSync).
  inBrowser?: boolean
  inDrive?: boolean
  // A public Drive atrium, as the directory lists it (phase 8): its roster.
  publicRoster?: string
}

// A lobbies row as the lists show it.
const asLobby = (lobby: any): LobbyWithOwner => ({
  id: lobby.id,
  name: lobby.name,
  ownerUserId: lobby.owner_user_id,
  passwordHash: null,
  maxPlayers: lobby.max_players,
  isPublic: lobby.is_public,
  createdAt: lobby.created_at,
  updatedAt: lobby.updated_at,
  adminUserIds: lobby.admin_user_ids ?? [],
  editPermissionMode: lobby.edit_permission_mode ?? 'all',
  previewUrl: lobby.preview_url ?? null,
  previewAt: lobby.preview_at ?? null,
})

interface LobbyBrowserProps {
  onJoinLobby: (lobbyId: string, password?: string) => void
  onClose: () => void
  /** Without an account: this browser's atriums only. */
  guest?: boolean
  onSignIn?: () => void
}

export function LobbyBrowser({ onJoinLobby, onClose, guest = false, onSignIn }: LobbyBrowserProps) {
  const { t } = useTranslation()
  const [lobbies, setLobbies] = useState<LobbyWithOwner[]>([])
  // Everyone's public Drive atriums (phase 8), shown to anyone, a guest too.
  const [publicDrive, setPublicDrive] = useState<LobbyWithOwner[]>([])
  const [userLobbies, setUserLobbies] = useState<LobbyWithOwner[]>([])
  // Lobbies the current user administers but doesn't own -- admins get the
  // same in-atrium management permissions (whitelist/blacklist/editors/
  // settings, everything except the owner-only Admins tab) from the browser
  // too, without needing to enter the atrium first.
  const [adminLobbies, setAdminLobbies] = useState<LobbyWithOwner[]>([])
  const [browserLobbies, setBrowserLobbies] = useState<LobbyWithOwner[]>([])
  // Yours, wherever they're kept: last opened first. One in both is a move to
  // Drive not finished (lib/moveToDrive): shown as the cloud's, to finish.
  const yours = useMemo(() => {
    const inCloud = new Set(userLobbies.map(lobby => lobby.id))
    return sortByLastVisited([...browserLobbies.filter(lobby => !inCloud.has(lobby.id)), ...userLobbies], lobby => lobby.id)
  }, [browserLobbies, userLobbies])
  useEffect(() => {
    const landed = (e: Event) => {
      const { lobbyId, url, at } = (e as CustomEvent<PreviewDetail>).detail
      const update = (list: LobbyWithOwner[]) => list.map(l => (l.id === lobbyId ? { ...l, previewUrl: url, previewAt: at } : l))
      setUserLobbies(update); setAdminLobbies(update); setLobbies(update); setBrowserLobbies(update)
    }
    window.addEventListener('atrium:preview', landed)
    return () => window.removeEventListener('atrium:preview', landed)
  }, [])
  const [loading, setLoading] = useState(true)
  const [showCreateLobby, setShowCreateLobby] = useState(false)
  const [managingLobbyId, setManagingLobbyId] = useState<string | null>(null)
  const [showJoinById, setShowJoinById] = useState(false)
  const [lobbyIdInput, setLobbyIdInput] = useState('')
  const [newLobbyName, setNewLobbyName] = useState('')
  const [newLobbyPassword, setNewLobbyPassword] = useState('')
  const [newLobbyIsPublic, setNewLobbyIsPublic] = useState(true)
  // Where the new atrium is kept: this browser -- and Drive, or the Atrium's
  // cloud (phase 10, the hosted store), too. On the web every new atrium
  // starts in the browser, as its working copy.
  const [newWhere, setNewWhere] = useState<Where>('cloud')
  const browserChoice = !isDesktop
  // Drive atriums: for anyone signed in, where Google sign-in is set up.
  const canDrive = googleOpen && !guest
  // Signed in with Google -- a Google account, or an existing account with
  // its Google -- whose new atriums are kept in Drive by default (phase 9).
  const [withGoogle, setWithGoogle] = useState(() => !!googleAccount())
  // A guest, or a Google account (phase 6): no atriums in Supabase -- those
  // are an existing account's, until they move to the Atrium's cloud.
  const noCloud = guest || !!workerAccount()
  // Atriums in the Atrium's cloud: for anyone signed in (phase 10).
  const canHost = !isDesktop && !guest
  // One's atriums in the cloud, of the three one may have: hosted ones, and
  // any still in Supabase.
  const [ownedCloud, setOwnedCloud] = useState(0)
  const [selectedLobbyId, setSelectedLobbyId] = useState<string | null>(null)
  const [passwordInput, setPasswordInput] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [canCreateMore, setCanCreateMore] = useState(true)
  const [editingLobbyId, setEditingLobbyId] = useState<string | null>(null)
  const [editingLobbyName, setEditingLobbyName] = useState('')
  const [searchQuery, setSearchQuery] = useState('')
  const [joinByIdError, setJoinByIdError] = useState<string | null>(null)
  const [joinByIdLoading, setJoinByIdLoading] = useState(false)
  // Resolved once per browser load (see loadLobbies) and reused by both join
  // paths, so the operator isn't asked for a password it doesn't need. This is
  // presentation only -- can_user_join_lobby is what actually grants entry,
  // and it already lets the operator through before reaching the password
  // check. Faking this flag locally would only skip a prompt, not a gate.
  const [isOperator, setIsOperator] = useState(false)
  const [showImport, setShowImport] = useState(false)
  const [showDownload, setShowDownload] = useState(false)
  // Desktop's export. Same .atrium file the web's download produces, written
  // through a folder picker rather than the browser's download machinery.
  const [showExport, setShowExport] = useState(false)
  const [showVaultRecovery, setShowVaultRecovery] = useState(false)
  const [showContribute, setShowContribute] = useState(false)
  // Cache first, refreshed behind: the line below the sections is drawn on the
  // first frame and works offline, like the one on the welcome screen.
  const [contributions, setContributions] = useState<ContributionsData>(() => getCachedContributions())
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null)
  // A cloud atrium moved to its owner's Drive (lib/moveToDrive): asked first,
  // as a deletion is -- it ends with one.
  const [moveConfirmId, setMoveConfirmId] = useState<string | null>(null)
  const [isFullscreen, setIsFullscreen] = useState(false)
  const [vaultPath, setVaultPath] = useState<string | null>(null)
  const [showReportForm, setShowReportForm] = useState(false)
  const { username } = useGamePick('username')
  const [vaultBusy, setVaultBusy] = useState(false)
  const [vaultError, setVaultError] = useState<string | null>(null)

  const toggleFullscreen = async () => {
    if (isDesktop) {
      const { getCurrentWindow } = await import('@tauri-apps/api/window')
      const win = getCurrentWindow()
      const current = await win.isFullscreen()
      await win.setFullscreen(!current)
      setIsFullscreen(!current)
    } else {
      if (!document.fullscreenElement) {
        await document.documentElement.requestFullscreen()
        setIsFullscreen(true)
      } else {
        await document.exitFullscreen()
        setIsFullscreen(false)
      }
    }
  }

  // Memoize particle positions (fireflies)
  const particles = useMemo(() => 
    [...Array(15)].map((_, i) => ({
      left: `${(i * 17 + 3) % 96}%`,
      top: `${(i * 23 + 5) % 94}%`,
      duration: 8 + (i * 1.5) % 6,
      delay: i * 0.5,
    })), []
  )

  // Memoize background rectangles (trace-like elements)
  const backgroundRects = useMemo(() => 
    [...Array(10)].map((_, i) => ({
      left: `${(i * 19 + 7) % 90}%`,
      top: `${(i * 31 + 12) % 85}%`,
      width: 30 + (i * 17) % 80,
      height: 15 + (i * 13) % 40,
      rotation: (i * 7) % 15 - 7,
      delay: i * 0.3,
    })), []
  )

  // Initial load and clear active_lobby_id (user is browsing, not in a lobby)
  useEffect(() => {
    const clearAndLoad = async () => {
      // The cloud's client again, if a browser atrium was just left.
      await leaveBrowserAtrium()
      // Clear user's active_lobby_id since they're in the browser (not in a lobby)
      if (supabase) {
        const { data: { user } } = await supabase.auth.getUser()
        if (user) {
          await (supabase
            .from('profiles') as any)
            .update({ active_lobby_id: null })
            .eq('id', user.id)
        }
      }
      
      loadLobbies()
      checkCanCreateLobby()
    }
    
    clearAndLoad()
  }, [])

  useEffect(() => startContributionsRefresh(setContributions), [])

  // An invite to a Drive atrium, arrived in the address's # (lib/driveSync):
  // read by link, then offered -- or, already joined here, simply opened.
  const [invite, setInvite] = useState<{ rosterId: string; lobbyId: string; name: string; owner: string } | null>(null)
  const inviteNow = useRef(invite)
  inviteNow.current = invite
  const [joining, setJoining] = useState<JoinStep | 'opening' | 'waiting' | null>(null)
  const [joinNote, setJoinNote] = useState('')
  // Not added: they can ask an owner or admin in the atrium to let them in.
  const [askable, setAskable] = useState(false)
  // Looked for as the browser opens, and again whenever the # changes: a link
  // pasted here, on this very page, changes only that and reloads nothing.
  useEffect(() => {
    const look = () => {
      const found = inviteIn(location.hash)
      if (!found || !canDrive) return
      history.replaceState(null, '', location.pathname)
      readInvite(found)
        .then(about => (isDriveAtrium(about.lobbyId) ? onJoinLobby(about.lobbyId) : (setJoinNote(''), setInvite({ rosterId: found, ...about }))))
        .catch(err => setError(driveProblem(err)))
    }
    look()
    window.addEventListener('hashchange', look)
    return () => window.removeEventListener('hashchange', look)
  }, [])
  // In by an invitation: its working copy, filled by the first sync
  // (lib/driveSync, down first), and kept in this browser.
  const keepJoined = async (lobbyId: string, name: string, me: string) => {
    await browserEngine()
    await makeWorkingCopy(lobbyId, { name, ...(rowFromRoster(lobbyId, me) ?? { owner_user_id: me }), is_public: false, max_players: 50 })
    rememberBrowserAtrium(lobbyId)
  }
  const joinInvite = async (asked = invite, ask = false) => {
    if (!asked) return
    setJoinNote('')
    setAskable(false)
    setJoining('signIn')
    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) throw new Error(t('browser.errNotAuthenticated'))
      const me = { id: user.id, name: username || 'You' }
      let result = await joinDriveAtrium(asked.rosterId, me, setJoining)
      // Added, and let in by the next owner's or admin's app to look -- or
      // not added, asking an owner or admin in the atrium (its room): the
      // roster's version watched, while this stays open, and the join asked
      // again only once it moves (a download every few seconds is what
      // Google's robot check answers).
      const outside = () => result.state === 'waiting' || (ask && result.state === 'notAdded')
      if (outside()) {
        setJoining('waiting')
        setJoinNote(result.state === 'notAdded'
          ? t('browser.drive.asked', { owner: asked.owner })
          : t(result.why === 'otherAccount' ? 'browser.drive.waitingAccount' : 'browser.drive.waiting', { owner: asked.owner }))
        const stopAsking = result.state === 'notAdded' ? askToJoin(asked.lobbyId) : () => {}
        try {
          let version = await rosterVersion(asked.rosterId)
          while (outside() && inviteNow.current?.rosterId === asked.rosterId) {
            await new Promise(wait => setTimeout(wait, 10_000))
            const now = await rosterVersion(asked.rosterId)
            if (now !== version) {
              version = now
              result = await joinDriveAtrium(asked.rosterId, me)
            }
          }
        } finally {
          stopAsking()
        }
      }
      if (result.state === 'in') {
        setJoining('opening')
        await keepJoined(result.lobbyId, asked.name, user.id)
        setInvite(null)
        onJoinLobby(result.lobbyId)
      } else if (result.state === 'notAdded') {
        const { data: profile } = await (supabase.from('profiles') as any).select('username').eq('id', user.id).maybeSingle()
        setJoinNote(t('browser.drive.notAdded', { owner: asked.owner, username: profile?.username ?? username }))
        setAskable(true)
      } else if (result.state === 'blocked') {
        setJoinNote(t('browser.drive.blockedHere'))
      }
    } catch (err) {
      setJoinNote(driveProblem(err))
    } finally {
      setJoining(null)
    }
  }

  // An atrium into Google Drive, from its card: one kept in this browser, kept
  // there too; a cloud one moved there (lib/moveToDrive), the original
  // deleted once Drive has all of it. Google's window first, while the click
  // counts.
  const [converting, setConverting] = useState<string | null>(null)
  const intoDrive = async (lobby: { id: string; name: string }, how: (me: { id: string; name: string }) => Promise<void>) => {
    setConverting(lobby.id)
    try {
      await ensureSignedIn()
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) throw new Error(t('browser.errNotAuthenticated'))
      await how({ id: user.id, name: username || 'You' })
    } catch (err) {
      setError(driveProblem(err))
    } finally {
      setConverting(null)
    }
  }
  const toDrive = (lobby: LobbyWithOwner) => intoDrive(lobby, async me => {
    await keepInDrive(lobby.id, lobby.name, me)
    await loadBrowserLobbies()
  })
  // One's cloud atriums, moved into the Atrium's own cloud by themselves as one
  // comes in (phase 10, step 5): each as "Move to my Drive" moves one
  // (lib/moveToDrive), its people with it, one at a time, its card saying so.
  // One that won't go stays in the cloud, safe, and is tried again on the next
  // visit -- not again on this one.
  // ponytail: no lock across devices -- the owner's two browsers opening in the
  // same seconds could each move it (two hosted copies, nothing lost); a lock
  // needs a compare-and-set the hosted store hasn't got. Add one if it happens.
  // Those held for one by the Atrium since (lib/held: the operator holds
  // what's left in Supabase for owners who hadn't come back) come in the
  // same way, after.
  // One that can't come back yet -- no room for it in one's hosted space --
  // is shown as waiting (heldWaiting), why, and what else it can do.
  const triedMoving = useRef(new Set<string>())
  const [heldWaiting, setHeldWaiting] = useState<{ id: string; name: string; reason: string }[]>([])
  const moveToHosted = async (owned: { id: string; name: string }[], me: { id: string; name: string }) => {
    const { moveToDrive, restoreHeld } = await import('../lib/moveToDrive')
    await moveIn(owned, me, (id, who) => moveToDrive(id, who, true))
    const held = await (await import('../lib/held')).myHeld().catch(() => [])
    await moveIn(held.map(lobby => ({ id: lobby.lobby_id, name: lobby.name })), me, restoreHeld,
      (lobby, reason) => setHeldWaiting(shown => [...shown.filter(one => one.id !== lobby.id), { ...lobby, reason }]))
  }
  // A held one again, by hand: into one's hosted space, or into one's Drive.
  const bringBack = async (lobby: { id: string; name: string }, toDrive: boolean) => {
    setConverting(lobby.id)
    try {
      if (toDrive) await ensureSignedIn()
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) throw new Error(t('browser.errNotAuthenticated'))
      await (await import('../lib/moveToDrive')).restoreHeld(lobby.id, { id: user.id, name: username || 'You' }, !toDrive)
      setHeldWaiting(shown => shown.filter(one => one.id !== lobby.id))
      showToast(t(toDrive ? 'browser.drive.moved' : 'browser.cloud.moved', { name: lobby.name }))
      void loadLobbies()
      void checkCanCreateLobby()
    } catch (err) {
      setHeldWaiting(shown => shown.map(one => (one.id === lobby.id ? { ...one, reason: driveProblem(err) } : one)))
    } finally {
      setConverting(null)
    }
  }
  // Kept as a file, whatever happens to it here: still held after.
  const downloadHeld = async (lobby: { id: string; name: string }) => {
    setConverting(lobby.id)
    try {
      const [{ heldAtriumFile }, { saveFile, fileNameOf }] = await Promise.all([import('../lib/held'), import('../lib/fileSave')])
      await saveFile(await heldAtriumFile(lobby.id), `${fileNameOf(lobby.name)}.atrium`, { name: 'Atrium', extensions: ['atrium'] })
    } catch (err) {
      setHeldWaiting(shown => shown.map(one => (one.id === lobby.id ? { ...one, reason: driveProblem(err) } : one)))
    } finally {
      setConverting(null)
    }
  }
  const moveIn = async (lobbies: { id: string; name: string }[], me: { id: string; name: string }, move: (id: string, me: { id: string; name: string }) => Promise<void>,
    onFail?: (lobby: { id: string; name: string }, reason: string) => void) => {
    const waiting = lobbies.filter(lobby => !triedMoving.current.has(lobby.id))
    if (!waiting.length) return
    waiting.forEach(lobby => triedMoving.current.add(lobby.id))
    let moved = 0
    for (const lobby of waiting) {
      setConverting(lobby.id)
      try {
        await move(lobby.id, me)
        moved++
        showToast(t('browser.cloud.moved', { name: lobby.name }))
      } catch (err) {
        console.warn('[cloud] not moved yet:', lobby.id, err)
        if (onFail) onFail(lobby, driveProblem(err))
        else setError(t('browser.cloud.notMoved', { name: lobby.name, reason: driveProblem(err) }))
      }
    }
    setConverting(null)
    if (moved) { void loadLobbies(); void checkCanCreateLobby() }
  }
  const moveLobby = (lobby: LobbyWithOwner) => intoDrive(lobby, async me => {
    if (isHostedAtrium(lobby.id)) await moveHostedToDrive(lobby.id, me)
    else await (await import('../lib/moveToDrive')).moveToDrive(lobby.id, me)
    showToast(t('browser.drive.moved', { name: lobby.name }))
    loadLobbies()
    checkCanCreateLobby()
  })

  // A Drive atrium's settings, from its card (components/DriveSettings).
  const [driveSettingsId, setDriveSettingsId] = useState<string | null>(null)
  const [myId, setMyId] = useState('')
  useEffect(() => {
    void supabase?.auth.getUser().then(({ data }: any) => {
      setMyId(data?.user?.id ?? '')
      setWithGoogle(!!googleAccount() || (data?.user?.app_metadata?.providers ?? []).includes('google'))
    })
  }, [])

  // Invitations to Drive atriums: shown here, no link needed (lib/driveSync).
  const [invitations, setInvitations] = useState<Invitation[]>([])
  // One's invitations -- to Drive atriums and the Atrium's cloud's alike. Those
  // that join by themselves (one's cloud atrium moved, its people with it --
  // the worker vouched for them) are joined quietly, once a visit; one that
  // can't be (Drive to connect first, say) stays in the list, to join by hand.
  const triedJoining = useRef(new Set<string>())
  const lookForInvitations = () => {
    if (!myId || !(canHost || canDrive)) return
    void myInvitations().then(async found => {
      let joined = 0
      for (const one of found.filter(one => one.auto && !triedJoining.current.has(one.roster))) {
        triedJoining.current.add(one.roster)
        try {
          const result = await joinDriveAtrium(one.roster, { id: myId, name: username || 'You' })
          if (result.state === 'in') { await keepJoined(result.lobbyId, one.name, myId); joined++ }
        } catch (error) {
          console.warn('[drive] joining by itself:', error)
        }
      }
      setInvitations(joined ? await myInvitations() : found)
      if (joined) void loadBrowserLobbies()
    }).catch(() => {})
  }
  useEffect(lookForInvitations, [myId])

  useEffect(() => {
    if (!isDesktop) return

    let cancelled = false

    import('../lib/localDb')
      .then(async ({ getVaultBasePath }) => {
        const path = await getVaultBasePath()
        if (!cancelled) {
          setVaultPath(path)
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setVaultError(err instanceof Error ? err.message : t('browser.vaultLoadError'))
        }
      })

    return () => {
      cancelled = true
    }
  }, [])
  
  // Refresh player counts every 10 minutes
  useEffect(() => {
    const refreshInterval = setInterval(async () => {
      if (!supabase) return
      
      // Refresh player counts for all lobbies
      const refreshCounts = async (currentLobbies: LobbyWithOwner[]): Promise<LobbyWithOwner[]> => {
        if (currentLobbies.length === 0) return currentLobbies
        
        const updated = await Promise.all(currentLobbies.map(async (lobby) => {
          const { count } = await (supabase!
            .from('profiles')
            .select('id', { count: 'exact', head: true })
            .eq('active_lobby_id', lobby.id) as any)
          
          const newCount = count || 0
          // Only update if count changed
          if (newCount !== lobby.playerCount) {
            return { ...lobby, playerCount: newCount }
          }
          return lobby
        }))
        return updated
      }
      
      setLobbies(prev => {
        refreshCounts(prev).then(updated => {
          if (JSON.stringify(updated) !== JSON.stringify(prev)) {
            setLobbies(updated)
          }
        })
        return prev
      })
      
      setUserLobbies(prev => {
        refreshCounts(prev).then(updated => {
          if (JSON.stringify(updated) !== JSON.stringify(prev)) {
            setUserLobbies(updated)
          }
        })
        return prev
      })
    }, 30 * 1000) // 30 seconds
    
    return () => clearInterval(refreshInterval)
  }, [])

  // Atriums kept in this browser, from its engine -- not opened at all while
  // there are none.
  // A Drive atrium opened without Drive connected: Drive asked for on this
  // click (Google's window, while the click counts) -- closed, not opened.
  const enterBrowserLobby = async (lobby: { id: string; inDrive?: boolean }) => {
    // Drive asked for, if need be -- not to read a public atrium, which needs none.
    if (lobby.inDrive && !isDriveViewer(lobby.id) && !isHostedAtrium(lobby.id) && !hasDriveToken()) {
      try {
        await ensureSignedIn()
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err))
        return
      }
    }
    onJoinLobby(lobby.id)
  }

  // Drive atriums one's out of -- removed, blocked, or deleted by their owner,
  // as each one's roster says -- let go of: off the list, the copy here gone
  // (lib/driveSync, leaveDriveAtrium), and said. Those one's in, their
  // owner's latest picture taken along the way.
  const letGoOfEnded = async (lobbies: { id: string; name: string }[]) => {
    // The account, or this browser's guest (a public atrium's viewer).
    const me = useGameStore.getState().userId
    if (!me) return
    for (const lobby of lobbies) {
      const standing = await lookAtDriveAtrium(lobby.id, me)
      if (!standing || standing === 'in') continue
      await leaveDriveAtrium(lobby.id, standing === 'deleted').catch(error => console.warn('[drive] letting go of', lobby.id, error))
      setBrowserLobbies(shown => shown.filter(shownLobby => shownLobby.id !== lobby.id))
      showToast(t(standing === 'deleted' ? 'browser.drive.deletedBy' : standing === 'private' ? 'browser.drive.notPublic' : 'browser.drive.removedFrom', { name: lobby.name }))
    }
  }

  // Public Drive atriums (phase 8), as the directory lists them.
  const loadPublicDrive = async () => {
    if (isDesktop) return
    const listed = await publicAtriums().catch(error => { console.warn('[drive] the public atriums:', error); return [] })
    setPublicDrive(listed.map(atrium => ({
      ...asLobby({ id: atrium.lobby_id, name: atrium.name, owner_user_id: atrium.owner, is_public: true, max_players: 50 }),
      ownerUsername: atrium.owner_name ?? '', inDrive: true, publicRoster: atrium.roster, previewUrl: publicPreviewUrl(atrium),
    })))
  }
  // While the browser's open: Drive atriums looked at again each minute --
  // their owners' latest pictures taken, those one's out of let go (Google's
  // quota, a few metadata reads each) -- and the public list every fifth:
  // that's the Atrium's own server, whose free day is 100,000 requests for
  // everyone together. Not while the page is hidden.
  useEffect(() => {
    if (isDesktop) return
    let minutes = 0
    const every = window.setInterval(() => {
      if (document.visibilityState !== 'visible') return
      void loadBrowserLobbies()
      if (++minutes % 5 === 0) void loadPublicDrive()
    }, 60_000)
    return () => window.clearInterval(every)
  }, [])
  // Into one to look at it: already one's own, or read already, as any of
  // one's own; else read as its viewer (lib/driveSync), its working copy made here.
  const [openingPublic, setOpeningPublic] = useState<string | null>(null)
  const viewPublic = async (lobby: LobbyWithOwner) => {
    if (isDriveAtrium(lobby.id)) return enterBrowserLobby(lobby)
    const me = useGameStore.getState().userId
    if (!me || !lobby.publicRoster) return
    setOpeningPublic(lobby.id)
    try {
      const lobbyId = await viewPublicAtrium(lobby.publicRoster, me)
      rememberBrowserAtrium(lobbyId)
      onJoinLobby(lobbyId)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      if (message === 'NOT_PUBLIC' || /Drive 404/.test(message)) setPublicDrive(shown => shown.filter(shownLobby => shownLobby.id !== lobby.id))
      setError(message === 'NOT_PUBLIC' ? t('browser.drive.notPublic', { name: lobby.name })
        : /Drive 404/.test(message) ? t('browser.drive.deletedBy', { name: lobby.name })
          : message === 'BLOCKED' ? t('browser.drive.blockedFrom', { name: lobby.name })
            : driveProblem(err))
    } finally {
      setOpeningPublic(null)
    }
  }

  const loadBrowserLobbies = async () => {
    // Another account's Drive atriums on this browser aren't this one's.
    const ids = isDesktop ? [] : browserAtriumIds().filter(id => !anotherAccountsDriveAtrium(id))
    if (ids.length === 0) { setBrowserLobbies([]); return }
    try {
      const { localClient } = await browserEngine()
      const { data, error } = await localClient.from('lobbies').select('*').in('id', ids)
      if (error) throw error
      setBrowserLobbies((data ?? []).map((lobby: any) => ({ ...asLobby(lobby), inBrowser: true, inDrive: isDriveAtrium(lobby.id) })))
      void letGoOfEnded((data ?? []).filter((lobby: any) => isDriveAtrium(lobby.id)))
    } catch (err) {
      const problem = vaultProblem(err)
      setError(problem ? t(problem) : t('browser.errLoadLobbies', { message: String(err) }))
    }
  }

  const loadLobbies = async () => {
    if (!supabase) return
    void loadBrowserLobbies()
    void loadPublicDrive()

    setLoading(true)
    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user || noCloud) {
        setLoading(false)
        return
      }

      // The platform operator browses every atrium, so it skips the
      // public + whitelisted pair below and asks for the lot.
      //
      // RLS alone was never enough here: it governs which rows are *readable*,
      // while this function decides which rows are *requested*. Widening the
      // lobbies SELECT policy for the operator therefore changed nothing
      // visible until this query stopped filtering on is_public itself.
      const isPlatformAdmin = await checkPlatformAdmin()
      setIsOperator(isPlatformAdmin)

      let publicLobbies: any[] = []
      let privateLobbies: any[] = []

      if (isPlatformAdmin) {
        const { data: everyLobby, error: everyError } = await supabase
          .from('lobbies')
          .select('*')
          .order('created_at', { ascending: false })

        if (everyError) throw everyError
        publicLobbies = everyLobby || []
      } else {
        // Load public lobbies
        const { data: publicData, error: publicError } = await supabase
          .from('lobbies')
          .select('*')
          .eq('is_public', true)
          .order('created_at', { ascending: false })

        if (publicError) throw publicError
        publicLobbies = publicData || []

        // Load private lobbies where user is whitelisted
        const { data: whitelistEntries, error: whitelistError } = await (supabase
          .from('lobby_access_lists')
          .select('lobby_id')
          .eq('user_id', user.id)
          .eq('list_type', 'whitelist') as any)

        if (whitelistError) throw whitelistError

        const whitelistedLobbyIds = whitelistEntries?.map((entry: any) => entry.lobby_id) || []

        if (whitelistedLobbyIds.length > 0) {
          const { data: privateLobbyData, error: privateError } = await (supabase
            .from('lobbies')
            .select('*')
            .in('id', whitelistedLobbyIds)
            .eq('is_public', false) as any)

          if (!privateError) {
            privateLobbies = privateLobbyData || []
          }
        }
      }

      // Load user's own lobbies
      const { data: ownedLobbies, error: ownedError } = await supabase
        .from('lobbies')
        .select('*')
        .eq('owner_user_id', user.id)
        .order('created_at', { ascending: false })

      if (ownedError) throw ownedError

      // Get usernames and player counts
      // Most recently opened first, falling back to the newest-first order the
      // query already returned for anything never opened here. The query still
      // asks for created_at DESC, which is both that fallback and what a fresh
      // install sees.
      //
      // The merge runs first so a browser signing in for the first time gets
      // the order from the account rather than an empty one. It is awaited
      // because sorting before it lands would show the wrong order and then
      // reshuffle the list under the pointer; on desktop it returns at once.
      await mergeRemoteVisits()
      const enrichedOwned = await enrichLobbiesWithData(
        sortByLastVisited(ownedLobbies || [], lobby => lobby.id),
      )
      setUserLobbies(enrichedOwned)
      // Into the Atrium's own cloud, by themselves (phase 10). The desktop's
      // are its vault's: nowhere to move.
      if (!isDesktop && canHost) void moveToHosted(ownedLobbies ?? [], { id: user.id, name: username || 'You' })

      // Load lobbies the user administers but doesn't own -- these get the
      // same "Manage" affordance as owned atriums (just without the
      // owner-only Admins tab), so an admin doesn't have to enter the
      // atrium first to change its settings/whitelist/blacklist/editors.
      //
      // Web only. Administering someone else's atrium is inherently a
      // multi-user idea, and desktop's single local user owns everything in
      // its own vault, so there's nothing for this to find there. It also
      // uses .contains(), which the desktop SQLite shim doesn't implement --
      // that threw a TypeError rather than returning an error, so it escaped
      // the adminError check below and aborted loadLobbies entirely, leaving
      // the browser empty and showing "contains is not a function" instead of
      // the user's own local atriums.
      //
      // Wrapped defensively as well as gated: this list is supplementary, and
      // failing to load it should never take the whole browser down with it.
      if (!isDesktop) {
        try {
          const { data: adminLobbyData, error: adminError } = await (supabase
            .from('lobbies') as any)
            .select('*')
            .contains('admin_user_ids', [user.id])
            .neq('owner_user_id', user.id)
            .order('created_at', { ascending: false })

          if (!adminError) {
            const enrichedAdmin = await enrichLobbiesWithData(adminLobbyData || [])
            setAdminLobbies(enrichedAdmin)
          }
        } catch (adminErr) {
          console.error('Error loading administered atriums:', adminErr)
        }
      }

      // Combine public and whitelisted private lobbies, remove duplicates
      const allLobbies = [...publicLobbies, ...privateLobbies]
      const uniqueLobbies = Array.from(new Map(allLobbies.map(lobby => [lobby.id, lobby])).values())
      const enrichedPublic = await enrichLobbiesWithData(uniqueLobbies)
      setLobbies(enrichedPublic)
    } catch (err: any) {
      console.error('Error loading lobbies:', err)
      setError(t('browser.errLoadLobbies', { message: err?.message || t('browser.errUnknown') }))
    } finally {
      setLoading(false)
    }
  }

  const enrichLobbiesWithData = async (lobbies: any[]): Promise<LobbyWithOwner[]> => {
    if (!supabase || lobbies.length === 0) return []

    const enriched = await Promise.all(lobbies.map(async (lobby) => {
      // Get owner username
      const { data: profile } = await (supabase!
        .from('profiles')
        .select('username')
        .eq('id', lobby.owner_user_id)
        .single() as any)
      
      // Get player count
      const { count } = await (supabase!
        .from('profiles')
        .select('id', { count: 'exact', head: true })
        .eq('active_lobby_id', lobby.id) as any)

      // Check if lobby has password (using RPC since password_hash may not be visible to non-owners)
      const { data: hasPassword } = await (supabase as any).rpc('lobby_has_password', {
        p_lobby_id: lobby.id
      })

      return {
        ...asLobby(lobby),
        passwordHash: hasPassword ? 'protected' : null, // Use hasPassword from RPC instead of raw password_hash
        ownerUsername: profile?.username || 'Unknown',
        playerCount: count || 0,
      }
    }))

    return enriched
  }

  const checkCanCreateLobby = async () => {
    if (!supabase) return

    if (isDesktop) {
      setCanCreateMore(true)
      return
    }
    if (!canHost) {
      setCanCreateMore(false)
      return
    }
    // Hosted ones (the worker counts them), and those not moved from Supabase yet.
    const hosted = await hostedStore.usage().catch(() => null)
    let legacy = 0
    if (!noCloud) {
      const { data: { user } } = await supabase.auth.getUser()
      const { data } = user ? await (supabase as any).rpc('get_user_lobby_count', { p_user_id: user.id }) : { data: 0 }
      legacy = typeof data === 'number' ? data : 0
    }
    const owned = (hosted?.atriums ?? 0) + legacy
    setOwnedCloud(owned)
    setCanCreateMore(owned < (hosted?.most ?? 3))
  }

  // One atrium per press: a second press while the first is still being made
  // -- Google's window, Drive's folders, some seconds -- does nothing (the
  // ref, as two presses can come before the button greys), and the button
  // says what's under way.
  const [creating, setCreating] = useState(false)
  const creatingNow = useRef(false)
  const createLobby = async () => {
    if (!supabase || creatingNow.current) return
    if (newLobbyName.length < 3) {
      setError(t('browser.errNameLength'))
      return
    }
    creatingNow.current = true
    setCreating(true)
    try {
      // Google's window first, while the click that asked still counts -- or,
      // for the Atrium's cloud, one's sign-in.
      if (canDrive && newWhere === 'drive') await ensureSignedIn()
      else if (canHost && newWhere === 'cloud') {
        if (!canCreateMore) throw new Error(t('browser.errLimitReached'))
        await ensureSignedIn(HOSTED_MARK)
      }
      // Kept in this browser (lib/browserAtriums), or the cloud's.
      const client = browserChoice ? (await browserEngine()).localClient : supabase
      const { data: { user } } = await client.auth.getUser()
      if (!user) throw new Error('Not authenticated')

      // The special theme in season (Spooky around Halloween), if one is;
      // otherwise a bright room for somebody working in a bright interface,
      // and a dark one otherwise. Only the starting point -- the theme is
      // editable from inside the atrium, and this decides nothing that cannot
      // be changed. The preset as the developer has it, if they've made it over.
      const light = resolveThemeNow() === 'light'
      const startingTheme = (await seasonalThemeNow())?.values
        ?? themeOf(`preset:${defaultPresetFor(light).id}`, null, []) ?? startingAtriumTheme(light)

      // Nobody else reaches one kept in the browser: no password, not listed.
      const { data, error } = await (client
        .from('lobbies') as any)
        .insert({
          name: newLobbyName,
          owner_user_id: user.id,
          password_hash: browserChoice ? null : newLobbyPassword || null,
          is_public: !browserChoice && newLobbyIsPublic,
          max_players: 50,
          theme_settings: startingTheme,
        })
        .select()
        .single()

      if (error) throw error
      if (browserChoice) rememberBrowserAtrium(data.id)
      // In Drive too (lib/driveSync), or the Atrium's cloud -- or, if that
      // won't have it, not at all.
      const keptAlso = canDrive && newWhere === 'drive' ? 'drive' : canHost && newWhere === 'cloud' ? 'hosted' : null
      if (keptAlso) {
        try {
          await createDriveAtrium(data.id, newLobbyName, { id: user.id, name: username || 'You' }, keptAlso === 'hosted')
          if (keptAlso === 'hosted') void checkCanCreateLobby()
        } catch (driveError) {
          await (client.from('lobbies') as any).delete().eq('id', data.id)
          forgetBrowserAtrium(data.id)
          throw driveError
        }
      }

      // Join the newly created lobby
      onJoinLobby(data.id)
      setShowCreateLobby(false)
      setNewLobbyName('')
      setNewLobbyPassword('')
      setNewLobbyIsPublic(true)
    } catch (err: any) {
      console.error('Error creating lobby:', err)
      const problem = vaultProblem(err)
      setError(problem ? t(problem) : err.message ? driveProblem(err) : t('browser.errCreateLobby'))
    } finally {
      creatingNow.current = false
      setCreating(false)
    }
  }

  const handleJoinClick = async (lobby: LobbyWithOwner) => {
    if (!supabase) return
    
    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return

      // Check user's access status for this lobby
      const { data: accessStatus, error: accessError } = await (supabase as any).rpc('get_user_lobby_access_status', {
        p_lobby_id: lobby.id,
        p_user_id: user.id
      })

      console.log('Access status:', accessStatus, 'Error:', accessError)

      // If blacklisted, show error
      if (accessStatus === 'blacklisted') {
        setError(t('browser.errBlockedEnter'))
        return
      }

      // Owner or admin always skip the password -- everyone else (including
      // a plain whitelisted user, who can enter a private atrium but still
      // isn't trusted with its password) falls through to the password
      // check below like a normal visitor would.
      // The platform operator skips it too. Prompting would be theatre: the
      // server grants it entry either way, so the prompt could only be
      // answered wrongly and refused by a client that had already decided to
      // let it in.
      if (accessStatus === 'owner' || accessStatus === 'admin' || isOperator) {
        onJoinLobby(lobby.id)
        return
      }

      // Check if lobby has password - use RPC or fallback to lobby.passwordHash
      const { data: hasPassword, error: pwError } = await (supabase as any).rpc('lobby_has_password', {
        p_lobby_id: lobby.id
      })

      console.log('Has password RPC result:', hasPassword, 'Error:', pwError)

      // Use RPC result, or fallback to lobby.passwordHash if RPC fails
      const needsPassword = hasPassword === true || (pwError && lobby.passwordHash)

      if (needsPassword) {
        // Show password prompt
        console.log('Showing password prompt')
        setPasswordInput('') // Clear any previous input
        setSelectedLobbyId(lobby.id)
      } else {
        // No password required, join directly
        console.log('Joining directly (no password)')
        onJoinLobby(lobby.id)
      }
    } catch (err) {
      console.error('Error checking lobby access:', err)
      setError(t('browser.errCheckAccess'))
    }
  }

  const handlePasswordSubmit = () => {
    if (selectedLobbyId) {
      onJoinLobby(selectedLobbyId, passwordInput)
      setPasswordInput('')
      setSelectedLobbyId(null)
    }
  }

  // Handle Join by ID with proper access checks
  const handleJoinById = async () => {
    if (!supabase || !lobbyIdInput.trim()) return
    
    const lobbyId = lobbyIdInput.trim()
    setJoinByIdError(null)
    setJoinByIdLoading(true)
    
    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) {
        setJoinByIdError(t('browser.errNotAuthenticated'))
        setJoinByIdLoading(false)
        return
      }

      // First check if lobby exists
      const { data: lobby, error: lobbyError } = await (supabase as any)
        .from('lobbies')
        .select('id, name')
        .eq('id', lobbyId)
        .single()
      
      if (lobbyError || !lobby) {
        setJoinByIdError(t('browser.errAtriumNotFound'))
        setJoinByIdLoading(false)
        return
      }

      // Check user's access status for this lobby
      const { data: accessStatus } = await (supabase as any).rpc('get_user_lobby_access_status', {
        p_lobby_id: lobbyId,
        p_user_id: user.id
      })

      // If blacklisted, show error
      if (accessStatus === 'blacklisted') {
        setJoinByIdError(t('browser.errBlockedJoin'))
        setJoinByIdLoading(false)
        return
      }

      // Owner, admin or the platform operator always skip the password -- a
      // plain whitelisted user can still enter a private atrium by ID, but
      // falls through to the password check below like anyone else would.
      if (accessStatus === 'owner' || accessStatus === 'admin' || isOperator) {
        setShowJoinById(false)
        setLobbyIdInput('')
        setJoinByIdLoading(false)
        onJoinLobby(lobbyId)
        return
      }

      // Check if lobby has password
      const { data: hasPassword } = await (supabase as any).rpc('lobby_has_password', {
        p_lobby_id: lobbyId
      })

      if (hasPassword) {
        // Close join by ID modal and show password prompt
        setShowJoinById(false)
        setLobbyIdInput('')
        setJoinByIdLoading(false)
        setPasswordInput('')
        setSelectedLobbyId(lobbyId)
      } else {
        // No password required, join directly
        setShowJoinById(false)
        setLobbyIdInput('')
        setJoinByIdLoading(false)
        onJoinLobby(lobbyId)
      }
    } catch (err) {
      console.error('Error joining by ID:', err)
      setJoinByIdError(t('browser.errJoinFailed'))
      setJoinByIdLoading(false)
    }
  }

  const deleteLobby = async (lobbyId: string) => {
    if (!supabase) return

    try {
      // A Drive atrium's owner deletes it from Drive, for everyone (Google's
      // window first, while the click counts); anyone else leaves it.
      if (isDriveAtrium(lobbyId)) {
        if (isDriveOwner(lobbyId)) {
          await ensureSignedIn(lobbyId)
          await deleteDriveAtrium(lobbyId)
        }
        await leaveDriveAtrium(lobbyId)
      } else {
        const { error } = await (await clientFor(lobbyId))
          .from('lobbies')
          .delete()
          .eq('id', lobbyId)
        if (error) throw error
        forgetBrowserAtrium(lobbyId)
      }
      // Left, it's under "Shared with you" again.
      lookForInvitations()

      loadLobbies()
      checkCanCreateLobby()
    } catch (err) {
      console.error('Error deleting lobby:', err)
      setError(t('browser.errDeleteLobby'))
    } finally {
      setDeleteConfirmId(null)
    }
  }

  // The public list: the cloud's, with an account that has it, and Drive's,
  // for anyone -- the search applied, and none of one's own: those are under
  // Your Atriums.
  const shownPublic = [...(noCloud ? [] : lobbies), ...publicDrive].filter(lobby =>
    lobby.ownerUserId !== myId && !yours.some(own => own.id === lobby.id) && lobby.name.toLowerCase().includes(searchQuery.toLowerCase()))

  // An atrium's card (AtriumCard) in `list`: what it is, and what can be done
  // with it there.
  const cardFor = (lobby: LobbyWithOwner, list: 'yours' | 'admin' | 'public') => {
    const drive = lobby.inDrive && !lobby.publicRoster ? driveCard(lobby.id) : null
    const viewer = !!drive?.viewer
    const cloud = !lobby.inBrowser && !lobby.publicRoster
    const mine = list === 'yours'
    const tags: CardTag[] = []
    if (lobby.publicRoster) {
      tags.push({ label: t(isHostedId(lobby.publicRoster) ? 'browser.tag.cloud' : 'browser.inDrive'), where: true })
      if (lobby.ownerUsername) tags.push({ label: t('browser.tag.by', { name: lobby.ownerUsername }) })
    } else if (lobby.inDrive) {
      tags.push({ label: t(isHostedAtrium(lobby.id) ? 'browser.tag.cloud' : 'browser.inDrive'), where: true })
      if (viewer) {
        tags.push({ label: t('browser.public') }, { label: t('browser.tag.viewOnly'), strong: true })
        if (drive?.owner) tags.push({ label: t('browser.tag.by', { name: drive.owner }) })
      } else {
        if (drive?.role) tags.push({ label: t(`browser.drive.role.${drive.role}`), strong: true })
        if (drive?.role !== 'owner' && drive?.owner) tags.push({ label: t('browser.tag.sharedBy', { name: drive.owner }) })
        if (drive?.isPublic) tags.push({ label: t('browser.public') })
      }
    } else if (lobby.inBrowser) {
      tags.push({ label: t('browser.inBrowser'), where: true })
    } else {
      if (!isDesktop) tags.push({ label: t('browser.tag.cloud'), where: true })
      if (list === 'admin') tags.push({ label: t('browser.admin'), strong: true })
      if (list === 'public' && lobby.ownerUsername) tags.push({ label: t('browser.tag.by', { name: lobby.ownerUsername }) })
      tags.push({ label: lobby.isPublic ? t(isDesktop ? 'browser.localPublic' : 'browser.public') : t(isDesktop ? 'browser.localPrivate' : list === 'public' ? 'browser.whitelisted' : 'browser.private') })
      if (lobby.passwordHash) tags.push({ label: t('browser.secured') })
      tags.push({ label: t('browser.usersCount', { count: lobby.playerCount ?? 0, max: lobby.maxPlayers }) })
    }
    // In sight beside Enter: its settings, one window whichever kind it is
    // (components/AtriumSettingsParts) -- a Drive atrium's for anyone in it,
    // a cloud one's for its owner and admins.
    const side: CardAction | undefined = lobby.inDrive && !lobby.publicRoster && !viewer
      ? { label: t('browser.manage'), onClick: () => setDriveSettingsId(lobby.id) }
      : cloud && list !== 'public' ? { label: t('browser.manage'), onClick: () => setManagingLobbyId(lobby.id) } : undefined
    const menu: CardAction[] = [
      ...(mine && !viewer ? [{ label: t('browser.rename'), onClick: () => { setEditingLobbyId(lobby.id); setEditingLobbyName(lobby.name) } }] : []),
      ...(mine && lobby.inBrowser && !lobby.inDrive && canDrive ? [{ label: t('browser.drive.convert'), disabled: converting !== null, onClick: () => void toDrive(lobby) }] : []),
      // Into one's own Drive: one's cloud atrium, or one's hosted one.
      ...(mine && canDrive && (cloud ? lobby.ownerUserId === myId : !!lobby.inDrive && isHostedAtrium(lobby.id) && isDriveOwner(lobby.id))
        ? [{ label: t('browser.drive.move'), disabled: converting !== null, onClick: () => setMoveConfirmId(lobby.id) }] : []),
      ...(cloud ? [{ label: t('browser.copyId'), onClick: () => copyLobbyId(lobby.id) }] : []),
      // Someone else's Drive atrium is left, not deleted: it isn't theirs to delete.
      ...(mine ? [{ label: lobby.inDrive && !isDriveOwner(lobby.id) ? t('browser.drive.leave') : t('common.delete'), danger: true, onClick: () => setDeleteConfirmId(lobby.id) }] : []),
    ]
    const renaming = editingLobbyId === lobby.id ? (
      <div className="flex items-center gap-2">
        <input
          type="text"
          value={editingLobbyName}
          onChange={(e) => setEditingLobbyName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') renameLobby(lobby.id, editingLobbyName)
            else if (e.key === 'Escape') { setEditingLobbyId(null); setEditingLobbyName('') }
          }}
          className="min-w-0 flex-1 bg-nier-blackLight border border-nier-border/40 text-nier-bg px-2 py-1 text-sm tracking-wide focus:border-nier-border/60 transition-colors"
          autoFocus
          maxLength={50}
        />
        <button onClick={() => renameLobby(lobby.id, editingLobbyName)} className="text-nier-bg/75 hover:text-nier-bg text-xs">✓</button>
        <button onClick={() => { setEditingLobbyId(null); setEditingLobbyName('') }} className="text-nier-bg/75 hover:text-nier-bg text-xs">✕</button>
      </div>
    ) : undefined
    return (
      <AtriumCard
        key={lobby.id}
        name={lobby.name}
        renaming={renaming}
        preview={lobby.previewUrl}
        tags={tags}
        busy={converting === lobby.id ? t(lobby.inBrowser ? 'browser.drive.converting' : 'browser.drive.moving') : null}
        onEnter={() => (lobby.publicRoster ? void viewPublic(lobby) : lobby.inBrowser ? void enterBrowserLobby(lobby) : handleJoinClick(lobby))}
        enterLabel={openingPublic === lobby.id ? t('browser.drive.opening') : t('browser.enter')}
        enterDisabled={!!lobby.publicRoster && openingPublic !== null}
        side={side}
        menu={menu}
        moreLabel={t('browser.more')}
      />
    )
  }

  const chooseVaultFolder = async () => {
    if (!isDesktop) return

    setVaultError(null)
    setVaultBusy(true)

    try {
      const { chooseVaultFolder } = await import('../lib/localDb')
      const nextVaultPath = await chooseVaultFolder('Choose Digital Atrium Vault Folder')
      if (nextVaultPath) setVaultPath(nextVaultPath)
    } catch (err) {
      setVaultError(err instanceof Error ? err.message : t('browser.vaultUpdateError'))
    } finally {
      setVaultBusy(false)
    }
  }

  const renameLobby = async (lobbyId: string, newName: string) => {
    if (!supabase || !newName.trim()) return
    
    try {
      const { error } = await ((await clientFor(lobbyId))
        .from('lobbies') as any)
        .update({ name: newName.trim() })
        .eq('id', lobbyId)

      if (error) throw error

      // Update local state for user lobbies
      const renamed = (list: LobbyWithOwner[]) => list.map(l => (l.id === lobbyId ? { ...l, name: newName.trim() } : l))
      setUserLobbies(renamed)
      setBrowserLobbies(renamed)
      // Also update the available servers list
      setLobbies(prev => prev.map(l => 
        l.id === lobbyId ? { ...l, name: newName.trim() } : l
      ))
      setEditingLobbyId(null)
      setEditingLobbyName('')
    } catch (err) {
      console.error('Error renaming lobby:', err)
      setError(t('browser.errRenameLobby'))
    }
  }

  if (loading) {
    return (
      <div className="screen-rise fixed inset-0 bg-nier-black flex items-center justify-center z-50 font-mono px-4">
        <div className="relative px-[5vw] sm:px-10 py-[3vw] sm:py-6">
          <div className="absolute top-0 left-0 w-[2vw] sm:w-4 h-[2vw] sm:h-4 border-t border-l border-nier-bg/40" />
          <div className="absolute top-0 right-0 w-[2vw] sm:w-4 h-[2vw] sm:h-4 border-t border-r border-nier-bg/40" />
          <div className="absolute bottom-0 left-0 w-[2vw] sm:w-4 h-[2vw] sm:h-4 border-b border-l border-nier-bg/40" />
          <div className="absolute bottom-0 right-0 w-[2vw] sm:w-4 h-[2vw] sm:h-4 border-b border-r border-nier-bg/40" />
          <p className="text-nier-strong text-[clamp(9px,2.5vw,13px)] tracking-[0.25em] uppercase mb-4 text-center">{t('browser.loadingTitle')}</p>
          <div className="w-[40vw] sm:w-48 h-[3px] bg-nier-bg/15 overflow-hidden mx-auto">
            <div className="h-full bg-nier-bg/80 animate-nier-slide" />
          </div>
          <p className="text-nier-bg/75 text-[clamp(7px,1.8vw,10px)] tracking-[0.2em] uppercase mt-3 text-center">◇ {t('common.pleaseWait')}</p>
        </div>
      </div>
    )
  }

  return (
    <div className="screen-rise fixed inset-0 bg-nier-black flex items-center justify-center z-50 p-4">
      {/* In the margin beside the panel rather than inside it, where it was
          competing for width with the list of atriums. */}
      <MonthlyGoalColumn
        month={contributions.month}
        onOpen={() => openContributors('/browse')}
      />

      {/* Scanline overlay */}
      <div className="absolute inset-0 pointer-events-none opacity-[0.02] z-40"
        style={{
          backgroundImage: 'repeating-linear-gradient(0deg, transparent, transparent 2px, rgba(203, 203, 203, 0.1) 2px, rgba(203, 203, 203, 0.1) 4px)',
        }}
      />

      {/* Animated background grid */}
      <div 
        className="absolute inset-0 pointer-events-none opacity-10"
        style={{
          backgroundImage: `
            linear-gradient(rgba(203, 203, 203, 0.15) 1px, transparent 1px),
            linear-gradient(90deg, rgba(203, 203, 203, 0.15) 1px, transparent 1px)
          `,
          backgroundSize: '60px 60px',
        }}
      />

      {/* Background rectangles (trace-like elements) */}
      <div className="absolute inset-0 pointer-events-none overflow-hidden">
        {backgroundRects.map((rect, i) => (
          <div
            key={i}
            className="absolute border border-nier-border/[0.08] bg-nier-border/[0.02]"
            style={{
              left: rect.left,
              top: rect.top,
              width: rect.width,
              height: rect.height,
              transform: `rotate(${rect.rotation}deg)`,
              animation: `rectFloat ${12 + i % 5}s ease-in-out infinite`,
              animationDelay: `${rect.delay}s`,
            }}
          />
        ))}
      </div>

      {/* Floating particles (fireflies) */}
      <div className="absolute inset-0 pointer-events-none overflow-hidden">
        {particles.map((particle, i) => (
          <div
            key={i}
            className="absolute w-1 h-1 bg-nier-border rounded-full opacity-0"
            style={{
              left: particle.left,
              top: particle.top,
              animation: `firefly ${particle.duration}s ease-in-out infinite`,
              animationDelay: `${particle.delay}s`,
            }}
          />
        ))}
      </div>
      
      <div className="bg-nier-blackLight border border-nier-border/40 max-w-4xl w-full max-h-[90vh] overflow-hidden flex flex-col relative z-10">
        {/* Corner brackets */}
        <div className="absolute top-0 left-0 w-6 h-6 border-l border-t border-nier-border/60" />
        <div className="absolute top-0 right-0 w-6 h-6 border-r border-t border-nier-border/60" />
        <div className="absolute bottom-0 left-0 w-6 h-6 border-l border-b border-nier-border/60" />
        <div className="absolute bottom-0 right-0 w-6 h-6 border-r border-b border-nier-border/60" />

        {/* Header */}
        <div className="p-4 sm:p-6 border-b border-nier-border/20">
          <div className="flex flex-wrap justify-between items-center gap-x-4 gap-y-3">
            <div>
              {/* Was eighteen pixels of the same extralight uppercase as the
                  labels under it, which made the screen one continuous
                  whisper. A heading should be able to be looked past; this one
                  could only be read. */}
              <div className="flex items-center gap-3">
                <div className="w-2 h-2 rotate-45 border border-nier-border/60" />
                <h2 className="text-xl sm:text-2xl text-nier-strong tracking-[0.08em] uppercase font-normal leading-none">
                  {t('browser.title')}
                </h2>
              </div>
              <p className="text-nier-bg/70 text-xs tracking-[0.18em] uppercase ml-5 mt-1.5">{t('browser.selectDestination')}</p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {/* First in the row, before the window controls: those are things
                  you do to the browser, and this is not one of them. */}
              <ThemeToggle />
              <DonateButton onClick={() => setShowContribute(true)} className="mr-1" />
              <button
                onClick={toggleFullscreen}
                className="w-8 h-8 flex items-center justify-center border border-nier-border/30 text-nier-bg/80 hover:text-nier-bg hover:border-nier-border/60 transition-colors"
                title={isFullscreen ? t('browser.exitFullscreen') : t('atrium.fullscreen')}
              >
                {isFullscreen ? '⊡' : '⊞'}
              </button>
              <button
                onClick={loadLobbies}
                disabled={loading}
                className="px-3 h-8 flex items-center justify-center gap-2 border border-nier-border/30 text-nier-bg/80 text-xs tracking-[0.1em] uppercase hover:text-nier-bg hover:border-nier-border/60 transition-colors disabled:opacity-50"
              >
                <span className={loading ? 'animate-spin' : ''}>↻</span>
                <span className="hidden sm:inline">{t('browser.refresh')}</span>
              </button>
              <button
                onClick={onClose}
                className="w-8 h-8 flex items-center justify-center border border-nier-border/30 text-nier-bg/80 hover:text-nier-bg hover:border-nier-border/60 transition-colors"
              >
                ×
              </button>
            </div>
          </div>
          {isDesktop && (
            <div className="mt-4 border border-nier-border/20 bg-nier-black/60 px-4 py-3">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0">
                  <div className="text-nier-bg/80 text-xs tracking-[0.15em] uppercase mb-1">{t('browser.vault')}</div>
                  <p className="text-nier-bg/80 text-xs tracking-wide break-all">
                    {vaultPath || t('browser.vaultPreparing')}
                  </p>
                  <p className="text-nier-bg/70 text-xs tracking-wide mt-2">
                    {t('browser.vaultDescription')}
                  </p>
                </div>
                <button
                  onClick={chooseVaultFolder}
                  disabled={vaultBusy}
                  className="px-3 h-8 shrink-0 flex items-center justify-center border border-nier-border/30 text-nier-bg/80 text-xs tracking-[0.1em] uppercase hover:text-nier-bg hover:border-nier-border/60 transition-colors disabled:opacity-50"
                >
                  {vaultBusy ? t('browser.vaultSyncing') : t('browser.vaultChangeFolder')}
                </button>
              </div>
              {vaultError && (
                <p className="text-xs tracking-wide mt-3" style={{ color: '#FF6161' }}>{vaultError}</p>
              )}
            </div>
          )}
          {error && (
            <div className="mt-4 text-xs tracking-wide border border-nier-red/40 bg-nier-red/10 px-4 py-2" style={{ color: '#FF6161' }}>
              ⚠ {error}
            </div>
          )}
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6 space-y-8">
          {invitations.length > 0 && !invite && (
            <section className="border border-nier-border/40 p-5 space-y-3">
              <h3 className="text-nier-strong text-sm tracking-[0.15em] uppercase">{t('browser.drive.invitations')}</h3>
              <ul className="space-y-2">
                {invitations.map(invitation => (
                  <li key={invitation.id} className="flex flex-wrap items-center gap-3">
                    <span className="flex-1 min-w-[10rem] text-nier-bg text-sm">
                      {invitation.name}
                      <span className="block text-nier-bg/60 text-xs">{t('browser.drive.from', { name: invitation.from })}{invitation.at && ` · ${new Date(invitation.at).toLocaleString()}`}</span>
                    </span>
                    <button
                      onClick={() => {
                        const asked = { rosterId: invitation.roster, lobbyId: invitation.lobbyId, name: invitation.name, owner: invitation.from }
                        setJoinNote('')
                        setInvite(asked)
                        void joinInvite(asked).finally(lookForInvitations)
                      }}
                      className={ROW_ENTER}
                    >
                      {t('browser.drive.join')}
                    </button>
                    <button onClick={() => void declineInvitation(invitation.id).then(lookForInvitations)} className={ROW_BUTTON}>{t('browser.drive.decline')}</button>
                  </li>
                ))}
              </ul>
            </section>
          )}
          {invite && (
            <section className="border border-nier-border/40 p-5 space-y-3">
              <h3 className="text-nier-strong text-sm tracking-[0.15em] uppercase">{t('browser.drive.joinTitle', { name: invite.name })}</h3>
              <p className="text-nier-bg/75 text-xs leading-relaxed">{t('browser.drive.joinHint')}</p>
              {joinNote && <p className="text-nier-bg text-xs leading-relaxed">{joinNote}</p>}
              {joining ? (
                // Some seconds, most of them Google's: said as they pass.
                <div role="status">
                  {joining !== 'waiting' && <p className="text-nier-bg text-xs tracking-[0.12em] uppercase mb-2">◇ {t(`browser.drive.step.${joining}`)}</p>}
                  <div className="w-48 h-[3px] bg-nier-bg/15 overflow-hidden">
                    <div className="h-full bg-nier-bg/80 animate-nier-slide" />
                  </div>
                  {joining === 'waiting' && <button onClick={() => setInvite(null)} className={`${ROW_BUTTON} mt-3`}>{t('common.cancel')}</button>}
                </div>
              ) : (
                <div className="flex gap-2">
                  {askable
                    ? <button onClick={() => void joinInvite(invite, true)} className={ROW_ENTER}>{t('browser.drive.ask')}</button>
                    : <button onClick={() => void joinInvite()} className={ROW_ENTER}>{t('browser.drive.join')}</button>}
                  <button onClick={() => setInvite(null)} className={ROW_BUTTON}>{t('common.cancel')}</button>
                </div>
              )}
            </section>
          )}
          {/* Google Drive: connected or not, and the way to change it. */}
          {canDrive && myId && <DriveConnection buttonClass={`${ROW_BUTTON} disabled:opacity-40`} />}
          {/* Create Lobby */}
          <section>
            <div className="flex items-center gap-2 mb-4">
              <span className="text-nier-bg/80 text-xs tracking-[0.15em] uppercase">{t('browser.createNew')}</span>
              <div className="flex-1 h-[1px] bg-gradient-to-r from-nier-border/30 to-transparent" />
            </div>

            {showCreateLobby ? (
              <div className="bg-nier-black border border-nier-border/30 p-5 space-y-4">
                <div>
                  <label className="block text-nier-bg/80 text-xs tracking-[0.15em] uppercase mb-2">{t('browser.nameLabel')}</label>
                  <input
                    type="text"
                    // The form only exists while showCreateLobby is on, so this
                    // mounts fresh each time and focuses on opening. Naming the
                    // atrium is the one thing everyone does here, and it was a
                    // click away for no reason.
                    autoFocus
                    value={newLobbyName}
                    onChange={(e) => setNewLobbyName(e.target.value)}
                    placeholder={t('browser.namePlaceholder')}
                    className="w-full bg-nier-blackLight border border-nier-border/30 text-nier-bg px-4 py-2 text-sm tracking-wide placeholder-nier-bg/50 focus:border-nier-border/60 transition-colors"
                    maxLength={50}
                  />
                </div>
                {/* A guest's only go in the browser. */}
                {!isDesktop && !guest && (
                  <KeptWhere
                    where={newWhere}
                    canCloud={canCreateMore}
                    noCloud={!canHost}
                    canDrive={canDrive}
                    onChange={where => {
                      setNewWhere(where)
                      if (where === 'drive') void loadGoogleSignIn().catch(() => {})
                    }}
                  />
                )}
                {!browserChoice && (
                <div>
                  <label className="block text-nier-bg/80 text-xs tracking-[0.15em] uppercase mb-2">{t('browser.passwordOptional')}</label>
                  <input
                    type="password"
                    value={newLobbyPassword}
                    onChange={(e) => setNewLobbyPassword(e.target.value)}
                    placeholder={t('browser.passwordPlaceholder')}
                    className="w-full bg-nier-blackLight border border-nier-border/30 text-nier-bg px-4 py-2 text-sm tracking-wide placeholder-nier-bg/50 focus:border-nier-border/60 transition-colors"
                  />
                </div>
                )}
                {!browserChoice && <Check checked={newLobbyIsPublic} label={isDesktop ? t('browser.localPublicLabel') : t('browser.publicLabel')} onChange={setNewLobbyIsPublic} />}
                <div className="flex gap-3 pt-2">
                  {/* The cut corner every committing action wears. */}
                  <button
                    onClick={createLobby}
                    disabled={creating}
                    aria-busy={creating}
                    className="flex-1 py-2.5 text-xs tracking-[0.18em] uppercase font-medium transition-transform hover:scale-[1.02] active:scale-[0.99] disabled:opacity-60 disabled:cursor-wait disabled:hover:scale-100"
                    style={{ background: 'rgb(var(--c-accent))', color: 'rgb(var(--c-ground))', clipPath: DONATE_CUT }}
                  >
                    {creating ? `◇ ${t(newWhere === 'drive' ? 'browser.drive.converting' : 'transfer.import.creating')}` : t('browser.createCommit')}
                  </button>
                  <button
                    onClick={() => setShowCreateLobby(false)}
                    disabled={creating}
                    className="px-4 py-2 disabled:opacity-40 border border-nier-border/30 text-nier-bg/80 text-xs tracking-[0.1em] uppercase hover:border-nier-border/60 hover:text-nier-bg transition-colors"
                  >
                    {t('common.cancel')}
                  </button>
                </div>
              </div>
            ) : (
              // Filled, like the Enter button on every atrium below it: the
              // fill is the foreground ink and the label is the page, so it
              // inverts with the theme rather than sitting in it. Outlined,
              // it was the quietest thing on a screen whose whole purpose is
              // getting you into an atrium -- including a new one.
              // A new atrium is kept in Drive by default for whoever's signed
              // in with Google (phase 9), in the Atrium's cloud otherwise,
              // within its three -- in the browser alone past them.
              <button
                onClick={() => {
                  setNewWhere(canDrive && withGoogle ? 'drive' : canHost && canCreateMore ? 'cloud' : 'browser')
                  setShowCreateLobby(true)
                }}
                className="w-full py-3 bg-nier-bg text-nier-black text-xs tracking-[0.18em] uppercase font-medium hover:bg-nier-strong transition-colors"
                style={{ clipPath: DONATE_CUT }}
              >
                ◇ {t('browser.create')}
              </button>
            )}
          </section>

          {/* Held for one, not back yet: why, and what it can do instead */}
          {heldWaiting.length > 0 && (
            <section data-held-waiting="">
              <div className="flex items-baseline gap-3 mb-4">
                <span className="text-nier-strong text-xs tracking-[0.22em] uppercase">{t('browser.held.title')}</span>
                <div className="flex-1 h-[1px] bg-gradient-to-r from-nier-border/30 to-transparent" />
              </div>
              <div className="space-y-3">
                {heldWaiting.map(lobby => {
                  const button = 'px-3 py-2 border border-nier-border/40 text-nier-bg/85 text-[10px] tracking-[0.15em] uppercase hover:border-nier-border/80 hover:text-nier-strong transition-colors disabled:opacity-40'
                  return (
                    <div key={lobby.id} data-held={lobby.id} className="border border-nier-border/40 p-4" style={{ backgroundColor: 'rgb(var(--c-ground) / 0.6)' }}>
                      <div className="flex items-center gap-2 mb-2 min-w-0">
                        <span className="text-nier-strong text-sm truncate">{lobby.name}</span>
                        <span className="shrink-0 px-1.5 py-0.5 border border-nier-border/40 text-[9px] tracking-[0.15em] uppercase text-nier-bg/70">{t('browser.held.tag')}</span>
                      </div>
                      <p className="text-nier-bg/75 text-xs leading-relaxed">{t('browser.held.why')}</p>
                      <p className="text-nier-bg/90 text-[11px] leading-relaxed mt-1.5"><span aria-hidden="true" style={{ color: 'rgb(var(--c-amber))' }}>△</span> {lobby.reason}</p>
                      <div className="flex flex-wrap gap-2 mt-3">
                        <button type="button" disabled={converting !== null} onClick={() => void bringBack(lobby, false)} className={button}>
                          {converting === lobby.id ? `${t('common.loading')}…` : t('browser.held.again')}
                        </button>
                        {canDrive && <button type="button" disabled={converting !== null} onClick={() => void bringBack(lobby, true)} className={button}>{t('browser.drive.move')}</button>}
                        <button type="button" disabled={converting !== null} onClick={() => void downloadHeld(lobby)} className={button}>{t('browser.held.download')}</button>
                      </div>
                    </div>
                  )
                })}
              </div>
            </section>
          )}

          {/* Your Atriums */}
          {yours.length > 0 && (
            <section>
              <div className="flex items-baseline gap-3 mb-4">
                <span className="text-nier-bg/40 text-xs tracking-[0.1em] tabular-nums">01</span>
                <span className="text-nier-strong text-xs tracking-[0.22em] uppercase">{t('browser.yours')}</span>
                <div className="flex-1 h-[1px] bg-gradient-to-r from-nier-border/30 to-transparent" />
                {/* The three is a web limit, and was written into the
                    markup rather than read from anywhere. A desktop vault has
                    no such limit -- checkCanCreateLobby returns early there --
                    so showing "2/3" told desktop users they were running out
                    of something they cannot run out of. */}
                {/* The cloud's, of its three; those kept in the browser aren't counted. */}
                <span className="text-nier-bg/70 text-xs tabular-nums">
                  {isDesktop || guest ? yours.length : `${ownedCloud}/3`}
                </span>
              </div>
              <div className={ROW_GRID}>
                {yours.map(lobby => cardFor(lobby, 'yours'))}
              </div>
            </section>
          )}

          {/* Atriums you administer (but don't own) -- same management
              permissions as the owner, minus the owner-only Admins tab */}
          {adminLobbies.length > 0 && (
            <section>
              <div className="flex items-center gap-2 mb-4">
                <span className="text-nier-bg/80 text-xs tracking-[0.15em] uppercase">{t('browser.administeredAtriums')}</span>
                <div className="flex-1 h-[1px] bg-gradient-to-r from-nier-border/30 to-transparent" />
              </div>
              <div className={ROW_GRID}>
                {adminLobbies.map(lobby => cardFor(lobby, 'admin'))}
              </div>
            </section>
          )}

          {/* Everything that moves an atrium in or out of this installation,
              in one place. Export used to be desktop's odd one out, reachable
              only from the welcome screen -- so getting an atrium out meant
              leaving the browser, while getting one in happened here. They're
              the same job seen from two directions, and this is where someone
              is already standing when they think of either. */}
          {(
            <section>
              <div className="flex items-center gap-2 mb-4">
                <span className="text-nier-bg/80 text-xs tracking-[0.15em] uppercase">
                  {isDesktop ? t('browser.importExportRestore') : t('browser.importExport')}
                </span>
                <div className="flex-1 h-[1px] bg-gradient-to-r from-nier-border/30 to-transparent" />
              </div>
              {/* Side by side: they're directions of one operation, and stacking
                  them read as unrelated actions. Three across on desktop is
                  still comfortable at this panel width. */}
              <div className="flex gap-2">
                <button
                  onClick={() => setShowImport(true)}
                  className="flex-1 py-3 border border-nier-border/30 text-nier-bg/80 text-xs tracking-[0.15em] uppercase hover:border-nier-border/60 hover:text-nier-bg transition-colors"
                >
                  ◇ {t('browser.importJson')}
                </button>

                {/* Same format on both platforms, different machinery: the web
                    downloads a file, desktop writes one to a chosen folder. */}
                <button
                  onClick={() => (isDesktop ? setShowExport(true) : setShowDownload(true))}
                  className="flex-1 py-3 border border-nier-border/30 text-nier-bg/80 text-xs tracking-[0.15em] uppercase hover:border-nier-border/60 hover:text-nier-bg transition-colors"
                >
                  ◇ {t('browser.exportJson')}
                </button>

                {/* Desktop only: rebuilds an atrium from the copy kept in the
                    vault. Sits with import/export because it's the same idea --
                    getting an atrium back in -- and because that's where
                    someone goes looking when one has gone missing. */}
                {isDesktop && (
                  <button
                    onClick={() => setShowVaultRecovery(true)}
                    className="flex-1 py-3 border border-nier-border/30 text-nier-bg/80 text-xs tracking-[0.15em] uppercase hover:border-nier-border/60 hover:text-nier-bg transition-colors"
                  >
                    ◇ {t('browser.restoreVault')}
                  </button>
                )}
              </div>
            </section>
          )}

          {/* Public Atriums -- for a guest, what an account adds, and the
              public Drive atriums anyone may look at. */}
          {guest && (
            <section className="border border-nier-border/20 p-5 flex flex-wrap items-center gap-4">
              <p className="flex-1 min-w-[14rem] text-nier-bg/80 text-xs tracking-wide leading-relaxed">{t('browser.guestNote')}</p>
              <button onClick={onSignIn} className={ROW_ENTER}>{t('auth.logIn')}</button>
            </section>
          )}
          {noCloud && publicDrive.length === 0 ? null : (
          <section>
            <div className="flex flex-wrap items-center gap-2 mb-4">
              <span className="text-nier-bg/40 text-xs tracking-[0.1em] tabular-nums">02</span>
              <span className="text-nier-strong text-xs tracking-[0.22em] uppercase">{t('browser.availableAtriums')}</span>
              <div className="flex-1 h-[1px] bg-gradient-to-r from-nier-border/30 to-transparent" />
              <span className="text-nier-bg/70 text-xs">{t('browser.found', { count: shownPublic.length })}</span>
              {!noCloud && (
                <button
                  onClick={() => setShowJoinById(true)}
                  className="px-3 py-1 border border-nier-border/30 text-nier-bg/80 text-xs tracking-[0.1em] uppercase hover:border-nier-border/60 hover:text-nier-bg transition-colors ml-2"
                >
                  {t('browser.joinById')}
                </button>
              )}
            </div>
            
            {/* Search Bar */}
            <div className="mb-4">
              <div className="relative">
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder={t('browser.searchPlaceholder')}
                  className="w-full bg-nier-black border border-nier-border/30 text-nier-bg px-4 py-2 text-sm tracking-wide placeholder-nier-bg/50 focus:border-nier-border/60 transition-colors pr-10"
                />
                {searchQuery && (
                  <button
                    onClick={() => setSearchQuery('')}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-nier-bg/70 hover:text-nier-bg transition-colors"
                  >
                    ×
                  </button>
                )}
              </div>
            </div>
            
            <div className={ROW_GRID}>
              {shownPublic.length === 0 ? (
                <div className="sm:col-span-2 text-nier-bg/70 text-center py-12 text-xs tracking-wider uppercase">
                  {searchQuery ? t('browser.noMatch') : t('browser.noneAvailable')}
                </div>
              ) : (
                shownPublic.map(lobby => cardFor(lobby, 'public'))
              )}
            </div>
          </section>
          )}

          {googleOpen && isOperator && <Suspense fallback={null}><DriveSpike /></Suspense>}
        </div>
      </div>

      {/* Atrium settings, without going in: a Drive atrium's, or a cloud one's -- the same window. */}
      {driveSettingsId && <DriveSettings lobbyId={driveSettingsId} me={myId} onClose={() => { setDriveSettingsId(null); void loadBrowserLobbies() }} />}
      {managingLobbyId && (() => {
        const ownedMatch = userLobbies.find(l => l.id === managingLobbyId)
        const managedLobby = ownedMatch ?? adminLobbies.find(l => l.id === managingLobbyId)
        if (!managedLobby) return null
        return (
          <LobbyManagement
            lobby={managedLobby}
            isOwner={!!ownedMatch}
            onClose={() => setManagingLobbyId(null)}
            onUpdate={loadLobbies}
          />
        )
      })()}

      {/* Password Modal */}
      {selectedLobbyId && (
        <div className="modal-backdrop fixed inset-0 bg-nier-black/80 flex items-center justify-center z-[100]">
          <div className="bg-nier-blackLight border border-nier-border/40 p-6 max-w-md w-full mx-4 relative">
            <div className="absolute top-0 left-0 w-4 h-4 border-l border-t border-nier-border/60" />
            <div className="absolute top-0 right-0 w-4 h-4 border-r border-t border-nier-border/60" />
            <div className="absolute bottom-0 left-0 w-4 h-4 border-l border-b border-nier-border/60" />
            <div className="absolute bottom-0 right-0 w-4 h-4 border-r border-b border-nier-border/60" />
            
            <h3 className="text-nier-bg tracking-[0.15em] uppercase mb-4">◇ {t('browser.passwordRequired')}</h3>
            <input
              type="password"
              value={passwordInput}
              onChange={(e) => setPasswordInput(e.target.value)}
              onKeyPress={(e) => e.key === 'Enter' && handlePasswordSubmit()}
              placeholder={t('browser.passwordFieldPlaceholder')}
              autoComplete="new-password"
              className="w-full bg-nier-black border border-nier-border/30 text-nier-bg px-4 py-3 text-sm tracking-wide placeholder-nier-bg/50 focus:border-nier-border/60 transition-colors mb-4"
              autoFocus
            />
            <div className="flex gap-3">
              <button
                onClick={handlePasswordSubmit}
                className="flex-1 py-2 bg-nier-bg text-nier-black text-xs tracking-[0.15em] uppercase hover:bg-nier-strong transition-colors"
              >
                {t('browser.enter')}
              </button>
              <button
                onClick={() => {
                  setSelectedLobbyId(null)
                  setPasswordInput('')
                }}
                className="px-4 py-2 border border-nier-border/30 text-nier-bg/80 text-xs tracking-[0.1em] uppercase hover:border-nier-border/60 hover:text-nier-bg transition-colors"
              >
                {t('common.cancel')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Join by ID Modal */}
      {showJoinById && (
        <div className="modal-backdrop fixed inset-0 bg-nier-black/80 flex items-center justify-center z-[100]">
          <div className="bg-nier-blackLight border border-nier-border/40 p-6 max-w-md w-full mx-4 relative">
            <div className="absolute top-0 left-0 w-4 h-4 border-l border-t border-nier-border/60" />
            <div className="absolute top-0 right-0 w-4 h-4 border-r border-t border-nier-border/60" />
            <div className="absolute bottom-0 left-0 w-4 h-4 border-l border-b border-nier-border/60" />
            <div className="absolute bottom-0 right-0 w-4 h-4 border-r border-b border-nier-border/60" />
            
            <h3 className="text-nier-bg tracking-[0.15em] uppercase mb-2">◇ {t('browser.joinById')}</h3>
            <p className="text-nier-bg/75 text-xs tracking-wider mb-4">
              {t('browser.joinByIdDescription')}
            </p>
            {joinByIdError && (
              <div className="text-xs mb-3 bg-red-400/10 border border-red-400/30 px-3 py-2" style={{ color: '#FF6161' }}>
                {joinByIdError}
              </div>
            )}
            <input
              type="text"
              value={lobbyIdInput}
              onChange={(e) => {
                setLobbyIdInput(e.target.value)
                setJoinByIdError(null)
              }}
              onKeyPress={(e) => e.key === 'Enter' && lobbyIdInput && handleJoinById()}
              placeholder={t('browser.idPlaceholder')}
              autoComplete="off"
              className="w-full bg-nier-black border border-nier-border/30 text-nier-bg px-4 py-3 text-sm tracking-wide placeholder-nier-bg/50 focus:border-nier-border/60 transition-colors mb-4 font-mono"
              autoFocus
            />
            <div className="flex gap-3">
              <button
                onClick={handleJoinById}
                disabled={!lobbyIdInput || joinByIdLoading}
                className="flex-1 py-2 bg-nier-bg text-nier-black text-xs tracking-[0.15em] uppercase hover:bg-nier-strong transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
              >
                {joinByIdLoading ? t('browser.checking') : t('browser.enter')}
              </button>
              <button
                onClick={() => {
                  setShowJoinById(false)
                  setLobbyIdInput('')
                  setJoinByIdError(null)
                }}
                className="px-4 py-2 border border-nier-border/30 text-nier-bg/80 text-xs tracking-[0.1em] uppercase hover:border-nier-border/60 hover:text-nier-bg transition-colors"
              >
                {t('common.cancel')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* A deletion asked first -- and a move to Drive, which ends in one */}
      {moveConfirmId && (() => {
        const lobby = yours.find(shown => shown.id === moveConfirmId)
        return lobby && (
          <ConfirmBox title={t('browser.drive.moveTitle')} onCancel={() => setMoveConfirmId(null)}>
            <p className="text-nier-bg/75 text-xs tracking-wider mb-6">{t('browser.drive.moveConfirm', { name: lobby.name })}</p>
            <ConfirmButtons cancel={t('common.cancel')} confirm={t('browser.drive.move')} onCancel={() => setMoveConfirmId(null)} onConfirm={() => { setMoveConfirmId(null); void moveLobby(lobby) }} />
          </ConfirmBox>
        )
      })()}
      {deleteConfirmId && (() => {
        const leaving = isDriveAtrium(deleteConfirmId) && !isDriveOwner(deleteConfirmId)
        return (
          <ConfirmBox title={leaving ? t('browser.drive.leave') : t('browser.deleteAtrium')} onCancel={() => setDeleteConfirmId(null)}>
            <p className="text-nier-bg/75 text-xs tracking-wider mb-6">
              {!isDriveAtrium(deleteConfirmId) ? t('browser.deleteConfirm') : isDriveViewer(deleteConfirmId) ? t('browser.drive.viewerLeaveConfirm') : leaving ? t('browser.drive.leaveConfirm') : t('browser.drive.deleteConfirm')}
            </p>
            <ConfirmButtons cancel={t('common.cancel')} confirm={leaving ? t('browser.drive.leave') : t('common.delete')} onCancel={() => setDeleteConfirmId(null)} onConfirm={() => void deleteLobby(deleteConfirmId)} />
          </ConfirmBox>
        )
      })()}

      {/* Import Atrium Modal */}
      {showImport && (
        <ImportAtrium
          canCloud={canHost && canCreateMore}
          onClose={() => setShowImport(false)}
          onImported={() => { loadLobbies(); checkCanCreateLobby(); }}
        />
      )}

      {showContribute && <ContributePanel onClose={() => setShowContribute(false)} />}

      {showVaultRecovery && (
        <VaultRecoveryPanel
          onClose={() => setShowVaultRecovery(false)}
          onRestored={() => { loadLobbies(); checkCanCreateLobby(); }}
        />
      )}

      {/* Lazily loaded, as it is on the welcome screen: it pulls in the whole
          local database layer, which most visits to this browser never need. */}
      {showExport && (
        <Suspense fallback={null}>
          <ExportDatabase onClose={() => setShowExport(false)} />
        </Suspense>
      )}

      {/* Download picker. Owned and administered atriums first (the ones the
          user is most likely to want), then public ones, de-duplicated since
          an owned atrium that's also public appears in both lists. */}
      {showDownload && (
        <DownloadAtriumPanel
          onClose={() => setShowDownload(false)}
          atriums={(() => {
            const seen = new Set<string>()
            const out: DownloadableAtrium[] = []
            const add = (list: LobbyWithOwner[], access: DownloadableAtrium['access']) => {
              for (const l of list) {
                if (seen.has(l.id)) continue
                seen.add(l.id)
                out.push({ id: l.id, name: l.name, ownerUsername: l.ownerUsername, access })
              }
            }
            add(browserLobbies, 'browser')
            add(userLobbies, 'owner')
            add(adminLobbies, 'admin')
            add(lobbies, 'public')
            return out
          })()}
        />
      )}

      {/* Report a problem / suggest a feature */}
      <button
        onClick={() => setShowReportForm(true)}
        className="fixed bottom-4 left-1/2 -translate-x-1/2 z-[150] pointer-events-auto text-nier-bg/75 hover:text-nier-bg/75 text-xs font-mono tracking-[0.1em] uppercase underline decoration-gray-700 hover:decoration-gray-400 transition-colors"
      >
        {t('browser.reportProblem')}
      </button>
      {showReportForm && (
        <ReportFeedbackModal
          onClose={() => setShowReportForm(false)}
          username={username}
        />
      )}

      {/* CSS for animations */}
      <style>{`
        @keyframes firefly {
          0% { opacity: 0; transform: translateY(0px) translateX(0px); }
          10% { opacity: 0.15; }
          30% { opacity: 0.3; transform: translateY(-20px) translateX(15px); }
          50% { opacity: 0.25; transform: translateY(-50px) translateX(-10px); }
          70% { opacity: 0.35; transform: translateY(-30px) translateX(25px); }
          90% { opacity: 0.1; transform: translateY(-10px) translateX(5px); }
          100% { opacity: 0; transform: translateY(0px) translateX(0px); }
        }
        
        @keyframes rectFloat {
          0%, 100% { opacity: 0.6; transform: rotate(var(--rotation, 0deg)) translateY(0px); }
          50% { opacity: 0.9; transform: rotate(var(--rotation, 0deg)) translateY(-10px); }
        }
      `}</style>
    </div>
  )
}
