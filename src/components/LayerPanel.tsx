import { useState, useEffect, useRef } from 'react'
import { supabase } from '../lib/supabase'
import { useGameStore } from '../store/gameStore'
import { useTranslation, pluralCategory } from '../lib/i18n'
import type { Layer, Trace } from '../types/database'
import { drawRanks, inOrder, isValidOrderKey, keyAt, keysBetween, keysOnTop, type Ordered } from '../lib/order'
import { feelSpring, feelStep } from '../lib/dragFeel'
import { panelDrop, type PanelDropTarget } from '../lib/panelDrop'
import { nextTextName } from '../lib/traceNames'
import { mapRowToLayer, reloadLayers } from '../hooks/useLayers'
import { mapRowToTrace } from '../hooks/useTraces'
import { queueLayerChange } from '../lib/layerQueue'
import { buildTraceInsertRow } from '../lib/traceInsert'
import { useClampedMenuPosition } from '../hooks/useClampedMenuPosition'

const UNGROUPED_DROP_TARGET = '__ungrouped__'

// Each trace type's mark in the list.
const TYPE_GLYPH: Record<string, string> = { text: '◇', image: '◻', audio: '♪', video: '▷', embed: '⬡' }

// Something lifted off the list -- a row being dragged, or the card of a trace
// carried in from the canvas. It follows a point on the drag spring (lib/
// dragFeel), trailing, leaning and settling as a trace does on the canvas;
// land() sends it somewhere to settle and fade, drop() just fades it.
// onFrame runs each frame while it's held (the list's edge scrolling).
function liftCard(card: HTMLElement, at: { x: number; y: number; width: number; height: number }, strength: number, onFrame?: () => void) {
  Object.assign(card.style, {
    position: 'fixed',
    left: `${at.x}px`,
    top: `${at.y}px`,
    width: `${at.width}px`,
    height: `${at.height}px`,
    margin: '0',
    zIndex: '10000200',
    opacity: '0.88',
    pointerEvents: 'none',
    boxShadow: '0 10px 28px rgb(0 0 0 / 0.45)',
    transition: 'opacity 160ms ease',
  })
  document.body.appendChild(card)
  const spring = feelSpring(at.x, at.y, at.width, at.height, strength)
  let target = { x: at.x, y: at.y }
  let landed: (() => void) | null = null
  let last = performance.now()
  let raf = requestAnimationFrame(tick)
  function tick(now: number) {
    const dt = Math.min(now - last, 48)
    last = now
    if (!landed) onFrame?.()
    const drawn = strength ? feelStep(spring, target.x, target.y, dt) : { ox: 0, oy: 0, lean: 0, moving: false }
    card.style.left = `${target.x}px`
    card.style.top = `${target.y}px`
    card.style.transform = `translate(${drawn.ox}px, ${drawn.oy}px) rotate(${drawn.lean}rad)`
    if (landed && !drawn.moving) {
      fade()
      landed()
      return
    }
    raf = requestAnimationFrame(tick)
  }
  function fade() {
    cancelAnimationFrame(raf)
    card.style.opacity = '0'
    window.setTimeout(() => card.remove(), 160)
  }
  return {
    follow(x: number, y: number) { target = { x, y } },
    land(x: number, y: number, done: () => void = () => {}) { target = { x, y }; landed = done },
    drop() { fade() },
  }
}

// Where a dragged row would land: position `index` among the others in
// `layerId` (bottom to top; for a group, among the groups), shown by a line --
// or, with no line, into a group's header, lit up.
type DropSlot = {
  layerId: string | null
  index: number
  line: { left: number; top: number; width: number } | null
}

// Module scope on purpose. Defined inside LayerPanel's render body, this would
// be a brand-new component type on every render, so React would unmount and
// remount each button rather than update it. LayerPanel calls useGameStore()
// with no selector, so it re-renders on any store change -- including the local
// player's `position`, which updates on every mouse move. The button therefore
// got replaced between mousedown and mouseup and no click event ever fired,
// making the whole menu look dead.
function MenuItem({ label, onClick, danger, disabled, busy, hint }: {
  label: string
  onClick: () => void
  danger?: boolean
  disabled?: boolean
  // Set while a duplicate/insert round-trip is in flight, so a second click
  // can't kick off a duplicate of the duplicate.
  busy?: boolean
  hint?: string
}) {
  return (
    <button
      disabled={disabled || busy}
      onClick={onClick}
      className={`w-full text-left px-3 py-1.5 text-sm tracking-wider transition-colors disabled:opacity-30 disabled:cursor-not-allowed ${
        danger ? 'text-red-400/80 hover:bg-red-900/30 hover:text-red-300' : 'text-nier-strong hover:bg-nier-blackLight'
      }`}
      title={hint}
    >
      {label}
    </button>
  )
}

interface LayerPanelProps {
  lobbyId: string
  onClose: () => void
  selectedTraceId?: string | null
  // Mirrors TraceOverlay's own multi-selection (shift-click, area-select),
  // so every multi-selected trace/group highlights here too, not just the
  // single selectedTraceId.
  multiSelectedTraceIds?: string[]
  // Close this panel and open the customize UI for these traces -- one trace
  // opens its own panel, several open batch edit. The panel closes because the
  // two overlap on screen, and because having asked to customize something you
  // are done with the list you found it in.
  onCustomize?: (traceIds: string[]) => void
  // Replace the whole multi-selection. The panel could only ever read the
  // selection, which meant the one place that lists every trace by name was
  // the one place you could not build a selection out of them.
  onSetSelection?: (traceIds: string[]) => void
  onSelectTrace?: (traceId: string) => void
  onGoToTrace?: (traceId: string) => void
  // The layer group new traces should be created into. Clicking a group
  // header sets this (and selects all its traces); clicking it again, or the
  // Ungrouped section, clears it back to null.
  activeLayerId?: string | null
  onSetActiveLayer?: (layerId: string | null) => void
  onSelectGroupTraces?: (traceIds: string[]) => void
  // Frames the camera on a whole set of traces at once (Go to Group), as
  // opposed to onGoToTrace which centers a single one at the current zoom.
  onGoToTraces?: (traceIds: string[]) => void
  // Mirrors LobbyScene's canEdit (per lobbies.edit_permission_mode). Server
  // enforcement lives in RLS (user_can_edit_lobby on layers/traces); this
  // hides the mutating controls (create/rename/delete group, reordering,
  // moving traces between groups) for a user whose writes would be
  // rejected anyway. Viewing/selecting is unaffected.
  canEdit?: boolean
}

export default function LayerPanel({ lobbyId, onClose, selectedTraceId, multiSelectedTraceIds, onCustomize, onSetSelection, onSelectTrace, onGoToTrace, activeLayerId, onSetActiveLayer, onSelectGroupTraces, onGoToTraces, canEdit = true }: LayerPanelProps) {
  const { t } = useTranslation()
  const multiSelectedSet = new Set(multiSelectedTraceIds ?? [])
  const { traces, username, userId, addTrace, removeTrace } = useGameStore()
  // The atrium's groups, from the store (hooks/useLayers loads and keeps them).
  // Changes read useGameStore.getState().layers instead: queued behind another
  // (lib/layerQueue), they run after this render's copy is out of date.
  const layers = useGameStore(s => s.layers)
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set())
  // The group (or Ungrouped) a dragged trace would drop into, lit up.
  const [dropTargetId, setDropTargetId] = useState<string | null>(null)
  // What is being dragged, and where it would land (see beginRowDrag).
  const [rowDrag, setRowDrag] = useState<{ kind: 'group' | 'trace'; ids: string[] } | null>(null)
  const [dropSlot, setDropSlot] = useState<DropSlot | null>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  // The group whose name is being edited in place (double-click, or Rename).
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [renameDraft, setRenameDraft] = useState('')
  // True while a drag-reorder is being persisted, so we can show a small
  // spinner -- the DB round-trip (plus realtime settling) can take a moment.
  const [isReordering, setIsReordering] = useState(false)
  // Lets the selected-trace effect below scroll the right row into view
  // without any CSS-selector escaping concerns (trace ids are plain UUIDs,
  // but this avoids relying on that).
  const traceRowRefs = useRef<Map<string, HTMLDivElement>>(new Map())
  const setTraceRowRef = (traceId: string) => (el: HTMLDivElement | null) => {
    if (el) traceRowRefs.current.set(traceId, el)
    else traceRowRefs.current.delete(traceId)
  }
  // Dialog state for create/rename/delete (replaces prompt/confirm which don't work in Tauri)
  const [dialogMode, setDialogMode] = useState<'create' | 'delete' | null>(null)
  const [dialogInput, setDialogInput] = useState('')
  const [dialogTargetId, setDialogTargetId] = useState<string | null>(null)

  // Right-click menu for rows. `kind` decides which actions apply -- groups
  // and traces share the menu component but expose different items, and a
  // grouped trace gets Ungroup while an ungrouped one doesn't.
  const [rowMenu, setRowMenu] = useState<
    { x: number; y: number; kind: 'group' | 'trace'; id: string } | null
  >(null)
  const rowMenuRef = useRef<HTMLDivElement>(null)
  const rowMenuPos = useClampedMenuPosition(rowMenuRef, rowMenu?.x ?? 0, rowMenu?.y ?? 0)
  // Whether the Move to Group flyout is open (its own state so the flyout
  // closes when the menu is re-opened elsewhere).
  // Where a shift-range starts. Set by every plain or additive click, so the
  // range runs from the last row touched rather than from whatever the canvas
  // happens to consider selected.
  const [rangeAnchor, setRangeAnchor] = useState<string | null>(null)
  const [moveToGroupOpen, setMoveToGroupOpen] = useState(false)
  // Where the Move to Group flyout hangs, and the grace period before it
  // closes. Both copied deliberately from the canvas menu's Reorganize flyout
  // (TraceOverlay) so the two behave identically -- a submenu that opens on
  // hover in one place and expands in place in the other is two answers to the
  // same question.
  const [moveToGroupRect, setMoveToGroupRect] = useState<{ top: number; left: number; right: number } | null>(null)
  const moveToGroupCloseTimer = useRef<number | null>(null)

  const openMoveToGroup = (e: React.MouseEvent<HTMLElement>) => {
    if (moveToGroupCloseTimer.current) window.clearTimeout(moveToGroupCloseTimer.current)
    const rect = e.currentTarget.getBoundingClientRect()
    setMoveToGroupRect({ top: rect.top, left: rect.left, right: rect.right })
    setMoveToGroupOpen(true)
  }
  const keepMoveToGroupOpen = () => {
    if (moveToGroupCloseTimer.current) window.clearTimeout(moveToGroupCloseTimer.current)
  }
  const scheduleCloseMoveToGroup = () => {
    if (moveToGroupCloseTimer.current) window.clearTimeout(moveToGroupCloseTimer.current)
    moveToGroupCloseTimer.current = window.setTimeout(() => setMoveToGroupOpen(false), 200)
  }
  const [isBusy, setIsBusy] = useState(false)

  // Which traces a row-menu action applies to.
  //
  // Dragging one trace out of a multi-selection has always taken the whole
  // selection with it; the menu moved only the row it was opened on, so the
  // same intent gave two different results depending on how it was expressed.
  // Right-clicking a row that is NOT part of the selection still acts on that
  // row alone, which is what pointing at something means.
  const rowTraceTargets = (traceId: string): string[] =>
    multiSelectedSet.has(traceId) && multiSelectedSet.size > 1
      ? Array.from(multiSelectedSet)
      : [traceId]

  const openRowMenu = (e: React.MouseEvent, kind: 'group' | 'trace', id: string) => {
    e.preventDefault()
    e.stopPropagation()
    setMoveToGroupOpen(false)
    setRowMenu({ x: e.clientX, y: e.clientY, kind, id })
  }
  const closeRowMenu = () => {
    setRowMenu(null)
    setMoveToGroupOpen(false)
  }

  // Dismiss on any outside click, Escape, or scroll -- a fixed-position menu
  // would otherwise hang in place while the list scrolls underneath it.
  useEffect(() => {
    if (!rowMenu) return
    const onDown = (e: MouseEvent) => {
      if (!(e.target as HTMLElement)?.closest?.('[data-layer-row-menu]')) closeRowMenu()
    }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') closeRowMenu() }
    window.addEventListener('mousedown', onDown)
    window.addEventListener('keydown', onKey)
    window.addEventListener('scroll', closeRowMenu, true)
    return () => {
      window.removeEventListener('mousedown', onDown)
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('scroll', closeRowMenu, true)
    }
  }, [rowMenu])

  const createGroup = () => {
    if (!supabase) {
      alert('Supabase not initialized')
      return
    }
    setDialogMode('create')
    setDialogInput('')
    setDialogTargetId(null)
  }

  // ---- Order (lib/order): one key per move ----------------------------------

  // A group's traces, bottom to top.
  const groupBottomUp = (layerId: string | null) =>
    inOrder(useGameStore.getState().traces.filter(t => (t.layerId ?? null) === layerId))

  // A trace's new place (and group, if given): shown at once, then written.
  // A refusal puts back the trace as it was.
  const writeTraceKey = async (trace: Trace, orderKey: string, layerId?: string | null) => {
    if (!supabase) return
    const store = useGameStore.getState()
    const before = store.traces.find(t => t.id === trace.id) ?? trace
    const moved = layerId === undefined ? { orderKey } : { orderKey, layerId }
    store.addTrace({ ...before, ...moved })
    const update: Record<string, unknown> = { order_key: orderKey }
    if (layerId !== undefined) update.layer_id = layerId
    const { error } = await (supabase.from('traces') as any).update(update).eq('id', trace.id)
    if (error) {
      console.error('Error moving trace:', error)
      useGameStore.getState().addTrace(before)
    }
  }

  // A group's new place: shown at once, then written. .select() so a refusal
  // can't pass for success -- RLS doesn't raise on a forbidden UPDATE, the row
  // just isn't matched -- and on one, the groups are read back as they are.
  const writeLayerKey = async (layer: Layer, orderKey: string) => {
    if (!supabase) return
    useGameStore.getState().putLayer({ ...layer, orderKey })
    const { data, error } = await (supabase.from('layers') as any)
      .update({ order_key: orderKey }).eq('id', layer.id).select('id')
    if (error || !Array.isArray(data) || data.length === 0) {
      console.error('Error moving group:', error ?? 'no row updated -- gone, or write access denied')
      await reloadLayers(lobbyId)
    }
  }

  // n keys for position `index` among `others` (bottom to top), in order.
  // Should the two they go between share a key there's no room, and the
  // others are re-keyed in their order first -- rare, and the only move that
  // writes more than the moved rows.
  const keysAmong = async <T extends Ordered>(others: T[], index: number, n: number, write: (item: T, key: string) => Promise<void>) => {
    let sorted = inOrder(others)
    const bound = (i: number) => (i >= 0 && i < sorted.length ? sorted[i].orderKey ?? null : null)
    const fits = (below: string | null, above: string | null) =>
      (below === null || isValidOrderKey(below)) && (above === null || isValidOrderKey(above)) &&
      (below === null || above === null || below < above)
    if (!fits(bound(index - 1), bound(index))) {
      const fresh = keysBetween(null, null, sorted.length)
      for (let i = 0; i < sorted.length; i++) await write(sorted[i], fresh[i])
      sorted = sorted.map((item, i) => ({ ...item, orderKey: fresh[i] }))
    }
    return keysBetween(bound(index - 1), bound(index), n)
  }
  const keyAmong = async <T extends Ordered>(others: T[], index: number, write: (item: T, key: string) => Promise<void>) =>
    (await keysAmong(others, index, 1, write))[0]

  // On top of the other groups. Two people doing this at the same moment may
  // pick the same key; the tie is broken by id, the same way for everyone.
  const doCreateGroupNow = async (name: string) => {
    if (!supabase || !name.trim() || !canEdit) return

    const [orderKey] = keysOnTop(useGameStore.getState().layers)
    const { data, error } = await (supabase.from('layers') as any).insert({
      name: name.trim(),
      order_key: orderKey,
      is_group: true,
      user_id: username,
      lobby_id: lobbyId,
    }).select()

    if (error) {
      alert(`Failed to create group: ${error.message}`)
      return
    }
    const created = Array.isArray(data) ? data[0] : data
    if (created) useGameStore.getState().putLayer(mapRowToLayer(created))
  }

  const deleteGroup = (layerId: string) => {
    if (!supabase) return
    setDialogMode('delete')
    setDialogTargetId(layerId)
  }

  // Traces deleted from here, gone from the canvas as well, with their threads.
  // The group delete removed them from the database only, so on desktop --
  // which has no realtime to report it -- they stayed on screen. Threads: the
  // web's foreign keys delete them with the trace, desktop's database has
  // none, so they are deleted here for both (the web doesn't mind).
  const forgetDeletedTraces = async (traceIds: string[]) => {
    if (!supabase || traceIds.length === 0) return
    const gone = new Set(traceIds)
    const store = useGameStore.getState()
    const threads = store.links.filter(l => gone.has(l.from) || gone.has(l.to)).map(l => l.id)
    for (const id of traceIds) store.removeTrace(id)
    for (const id of threads) store.dropLink(id)
    if (threads.length > 0) await (supabase.from('trace_links') as any).delete().in('id', threads)
  }

  const doDeleteGroupNow = async (layerId: string) => {
    if (!supabase || !canEdit) return
    const groupTraceIds = getTracesForLayer(layerId).map(t => t.id)

    // Delete all traces in this group
    const { error: tracesError } = await supabase
      .from('traces')
      .delete()
      .eq('layer_id', layerId)

    if (tracesError) {
      return
    }
    await forgetDeletedTraces(groupTraceIds)

    // Delete the group
    const { error } = await supabase.from('layers').delete().eq('id', layerId)

    if (error) {
      console.error('Error deleting group:', error)
      return
    }

    // activeLayerId now persists independently of canvas selection (see
    // LobbyScene's comment on where it used to be cleared) -- but it must
    // still be cleared here, otherwise it'd keep pointing at a group that no
    // longer exists and new traces would silently try to target it.
    if (layerId === activeLayerId) {
      onSetActiveLayer?.(null)
    }

    await reloadLayers(lobbyId)
  }

  // Deletes a single trace directly (grouped or ungrouped) -- previously the
  // only way to remove a trace from the Layer panel was to delete its entire
  // group, which took every other trace in it down too.
  const doDeleteTraceNow = async (traceId: string) => {
    if (!supabase || !canEdit) return

    const { error } = await supabase.from('traces').delete().eq('id', traceId)

    if (error) {
      console.error('Error deleting trace:', error)
      return
    }

    await forgetDeletedTraces([traceId])
  }

  // Renamed where it's shown, as in Photoshop: double-click the group (or
  // Rename in its menu), type, Enter. Escape or an empty name keeps the old one.
  //
  // A trace's name is its title -- "Description / Title" in its customize
  // panel, and the label shown beside it -- so it is one name wherever it
  // appears, and renaming it here is editing that. A text trace's content is
  // its text, so it has a name of its own instead (layer_name: Text 1, ...).
  const nameOf = (trace: Trace) => (trace.type === 'text' ? trace.layerName ?? '' : trace.content)
  const startRename = (id: string, current: string) => {
    if (!canEdit) return
    setRenameDraft(current)
    setRenamingId(id)
  }
  const finishRename = (commit: boolean) => {
    const id = renamingId
    const name = renameDraft.trim()
    setRenamingId(null)
    if (!commit || !id) return
    const layer = layers.find(l => l.id === id)
    if (layer) {
      if (name && name !== layer.name) void doRenameGroup(id, name)
      return
    }
    const trace = useGameStore.getState().traces.find(t => t.id === id)
    if (!trace || name === nameOf(trace)) return
    // A text trace keeps a name: emptied, it keeps the one it had.
    if (trace.type === 'text') {
      if (name) void doRenameTrace(id, { layerName: name })
    } else {
      void doRenameTrace(id, { content: name })
    }
  }

  // What a trace's row says: its name, or the start of its title.
  const rowLabel = (trace: Trace) =>
    (trace.type === 'text' && trace.layerName) || trace.content.substring(0, 20) || t('atrium.layers.untitled')

  // The field a name is edited in, in place of the label.
  const renameField = (maxLength?: number) => (
    <input
      autoFocus
      value={renameDraft}
      maxLength={maxLength}
      onChange={(e) => setRenameDraft(e.target.value)}
      onFocus={(e) => e.currentTarget.select()}
      onBlur={() => finishRename(true)}
      onKeyDown={(e) => {
        e.stopPropagation()
        if (e.key === 'Enter') finishRename(true)
        if (e.key === 'Escape') finishRename(false)
      }}
      onClick={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
      className="w-0 min-w-0 flex-1 bg-nier-black border border-nier-border/60 text-nier-strong text-xs tracking-wide px-1 py-0.5 outline-none"
    />
  )

  // A trace's name (a text trace's) or title (anything else), from here: shown
  // at once, then written.
  const doRenameTraceNow = async (traceId: string, name: { layerName: string } | { content: string }) => {
    if (!supabase || !canEdit) return
    const before = useGameStore.getState().traces.find(t => t.id === traceId)
    if (!before) return
    useGameStore.getState().addTrace({ ...before, ...name })
    const column = 'layerName' in name ? { layer_name: name.layerName } : { content: name.content }
    const { error } = await (supabase.from('traces') as any).update(column).eq('id', traceId)
    if (error) {
      console.error('Error renaming trace:', error)
      useGameStore.getState().addTrace(before)
    }
  }

  const doRenameGroupNow = async (layerId: string, newName: string) => {
    if (!supabase || !newName.trim() || !canEdit) return

    const { error } = await (supabase.from('layers') as any)
      .update({ name: newName.trim() })
      .eq('id', layerId)

    if (error) {
      console.error('Error renaming group:', error)
      return
    }

    await reloadLayers(lobbyId)
  }

  // Deletes the group but keeps its traces, moving them out to Ungrouped.
  // Separate from doDeleteGroup, which takes the contents down with it --
  // as a one-click menu item that needed to be an explicit, distinct choice
  // rather than the only meaning of "Delete".
  const doDeleteGroupKeepTracesNow = async (layerId: string) => {
    if (!supabase || !canEdit) return

    const groupTraces = getTracesForLayer(layerId)
    if (groupTraces.length > 0) {
      await moveTracesToLayerNow(groupTraces.map(t => t.id), null)
    }

    const { error } = await supabase.from('layers').delete().eq('id', layerId)
    if (error) {
      console.error('Error deleting group:', error)
      return
    }

    if (layerId === activeLayerId) onSetActiveLayer?.(null)
    await reloadLayers(lobbyId)
  }

  // Copies a group and everything in it into a brand-new group, so the copies
  // are independently groupable rather than piling into the original (which is
  // what duplicating the traces alone would do -- they inherit layer_id).
  const duplicateGroupNow = async (layerId: string) => {
    if (!supabase || !canEdit || !userId) return
    const groups = inOrder(useGameStore.getState().layers)
    const at = groups.findIndex(l => l.id === layerId)
    if (at === -1) return
    const source = groups[at]

    setIsBusy(true)
    try {
      // Just above the original.
      const orderKey = keyAt(groups, at + 1) ?? keysOnTop(groups)[0]
      const { data: created, error: layerError } = await (supabase.from('layers') as any)
        .insert({
          name: `${source.name} copy`,
          order_key: orderKey,
          is_group: true,
          user_id: userId,
          lobby_id: lobbyId,
        })
        .select()
        .single()

      if (layerError || !created) {
        console.error('Error duplicating group:', layerError)
        return
      }
      useGameStore.getState().putLayer(mapRowToLayer(created))

      // The copies keep their keys: a key orders a trace within its group, so
      // the same keys in the new group are the same order.
      const sourceTraces = groupBottomUp(layerId)
      if (sourceTraces.length > 0) {
        const rows = sourceTraces.map(trace => ({
          ...buildTraceInsertRow(trace, userId, username, lobbyId, 0, 0),
          layer_id: created.id,
        }))
        const { data: inserted, error: tracesError } = await (supabase.from('traces') as any).insert(rows).select()
        if (tracesError) {
          console.error('Error duplicating group traces:', tracesError)
        } else if (Array.isArray(inserted)) {
          // Onto the canvas too. Left to realtime, which desktop doesn't have,
          // the copies only appeared once the atrium was opened again.
          for (const row of inserted) useGameStore.getState().addTrace(mapRowToTrace(row))
        }
      }
    } finally {
      setIsBusy(false)
    }
  }

  const duplicateSingleTraceNow = async (traceId: string) => {
    if (!supabase || !canEdit || !userId) return
    const trace = useGameStore.getState().traces.find(t => t.id === traceId)
    if (!trace) return

    setIsBusy(true)
    try {
      // Just above the original, in its group -- and the same 20px nudge the
      // canvas duplicate uses, so the copy doesn't hide exactly behind it.
      const group = groupBottomUp(trace.layerId ?? null)
      const at = group.findIndex(t => t.id === traceId)
      const orderKey = keyAt(group, at + 1) ?? keysOnTop(group)[0]
      const layerName = trace.type === 'text'
        ? nextTextName(useGameStore.getState().traces, n => t('atrium.layers.numberedText', { n }))
        : trace.layerName ?? null
      const row = { ...buildTraceInsertRow(trace, userId, username, lobbyId, 20, 20), order_key: orderKey, layer_name: layerName }
      const { data, error } = await (supabase.from('traces') as any).insert(row).select().single()
      if (error || !data) {
        console.error('Error duplicating trace:', error)
        return
      }
      addTrace({ ...trace, id: data.id, x: trace.x + 20, y: trace.y + 20, createdAt: data.created_at, orderKey, layerName })
    } finally {
      setIsBusy(false)
    }
  }

  const setTraceLockedNow = async (traceId: string, locked: boolean) => {
    if (!supabase || !canEdit) return
    const { error } = await (supabase.from('traces') as any)
      .update({ is_locked: locked })
      .eq('id', traceId)
    if (error) {
      console.error('Error updating lock:', error)
      return
    }
    const trace = useGameStore.getState().traces.find(t => t.id === traceId)
    if (trace) {
      removeTrace(traceId)
      addTrace({ ...trace, isLocked: locked })
    }
  }

  // Whether a trace can be clicked at all.
  //
  // Reachable from the canvas menu already, but not from the list -- which is
  // the awkward way round, because the traces people want to make
  // click-through are backgrounds, and a background is precisely the thing
  // that is hard to right-click on the canvas without hitting something in
  // front of it. From here it can be done to a whole group at once.
  const setTracesIgnoreClicksNow = async (traceIds: string[], ignore: boolean) => {
    if (!supabase || !canEdit || traceIds.length === 0) return

    for (const traceId of traceIds) {
      const { error } = await (supabase.from('traces') as any)
        .update({ ignore_clicks: ignore })
        .eq('id', traceId)
      if (error) {
        console.error('Error updating clicks:', error)
        continue
      }
      const trace = useGameStore.getState().traces.find(t => t.id === traceId)
      if (trace) addTrace({ ...trace, ignoreClicks: ignore })
    }
  }

  // Whether an embed can be used in place, rather than only looked at.
  //
  // Embeds render with pointer-events off by default, so a click selects the
  // trace instead of reaching the page inside it -- which is right for a wall
  // of videos and wrong for the one you want to actually play. The toggle
  // existed on the canvas menu only, and an interactive embed is exactly the
  // trace that is awkward to right-click, because the pointer goes into the
  // iframe rather than to the trace under it.
  const setTracesEnableInteractionNow = async (traceIds: string[], enabled: boolean) => {
    if (!supabase || !canEdit || traceIds.length === 0) return

    for (const traceId of traceIds) {
      const { error } = await (supabase.from('traces') as any)
        .update({ enable_interaction: enabled })
        .eq('id', traceId)
      if (error) {
        console.error('Error updating interaction:', error)
        continue
      }
      const trace = useGameStore.getState().traces.find(t => t.id === traceId)
      if (trace) addTrace({ ...trace, enableInteraction: enabled })
    }
  }

  // Traces to position `index` among the rest of a group (bottom to top),
  // moved into it if they're elsewhere, in the order they were drawn in: one
  // write each.
  const moveTracesToNow = async (traceIds: string[], layerId: string | null, index: number) => {
    if (!supabase || !canEdit || traceIds.length === 0) return
    const store = useGameStore.getState()
    if (layerId !== null && !store.layers.some(l => l.id === layerId)) return
    const idSet = new Set(traceIds)
    const ranks = drawRanks(store.traces, store.layers)
    const moving = store.traces
      .filter(t => idSet.has(t.id))
      .sort((a, b) => (ranks.get(a.id) ?? 0) - (ranks.get(b.id) ?? 0))
    const others = groupBottomUp(layerId).filter(t => !idSet.has(t.id))
    const keys = await keysAmong(others, index, moving.length, (t, key) => writeTraceKey(t, key))
    setIsReordering(true)
    try {
      for (let i = 0; i < moving.length; i++) {
        await writeTraceKey(moving[i], keys[i], (moving[i].layerId ?? null) !== layerId ? layerId : undefined)
      }
    } finally {
      setIsReordering(false)
    }
  }

  // Into a group (or Ungrouped, for null), on top of it. Those already in it
  // stay where they are.
  const moveTracesToLayerNow = async (traceIds: string[], layerId: string | null) => {
    const traces = useGameStore.getState().traces
    const outside = traceIds.filter(id => (traces.find(t => t.id === id)?.layerId ?? null) !== layerId)
    if (outside.length === 0) return
    const idSet = new Set(outside)
    await moveTracesToNow(outside, layerId, groupBottomUp(layerId).filter(t => !idSet.has(t.id)).length)
  }
  const moveTraceToLayerNow = (traceId: string, layerId: string | null) => moveTracesToLayerNow([traceId], layerId)

  // One step up or down its group, past its neighbour: one write.
  const moveTraceWithinLayerNow = async (traceId: string, layerId: string | null, direction: 'up' | 'down') => {
    if (!supabase || !canEdit) return
    const group = groupBottomUp(layerId)
    const index = group.findIndex(t => t.id === traceId)
    const target = direction === 'up' ? index + 1 : index - 1
    if (index === -1 || target < 0 || target >= group.length) return
    const others = group.filter(t => t.id !== traceId)
    const orderKey = await keyAmong(others, target, (t, key) => writeTraceKey(t, key))
    setIsReordering(true)
    try {
      await writeTraceKey(group[index], orderKey)
    } finally {
      setIsReordering(false)
    }
  }

  // A group to position `index` among the others (bottom to top): one write.
  const moveGroupToNow = async (layerId: string, index: number) => {
    if (!supabase || !canEdit) return
    const groups = inOrder(useGameStore.getState().layers)
    const at = groups.findIndex(l => l.id === layerId)
    if (at === -1 || at === index) return
    setIsReordering(true)
    try {
      const orderKey = await keyAmong(groups.filter(l => l.id !== layerId), index, (l, key) => writeLayerKey(l, key))
      await writeLayerKey(groups[at], orderKey)
    } finally {
      setIsReordering(false)
    }
  }

  // ---- Dragging rows -----------------------------------------------------------
  //
  // A row -- a group, or a trace along with the rest of the selection when
  // it's part of one -- is picked up from anywhere on it and dropped between
  // two others, where a bright bar shows it will land. That includes above the
  // top one and below the bottom one, which dropping onto a row (taking its
  // place) couldn't express. A trace dropped on a group's header goes into
  // that group, on top, and the header lights up to say so.
  //
  // Pointer events, not the browser's drag-and-drop, which can only drag a
  // fixed picture of the row. This lifts a copy of the row that trails the
  // pointer, leans and settles on the same spring as a trace on the canvas
  // (lib/dragFeel), and on release flies to where it landed.

  // Where a drag at clientY would land (null: nowhere).
  const findDropSlot = (kind: 'group' | 'trace', ids: string[], clientY: number): DropSlot | null => {
    const list = listRef.current
    if (!list) return null
    const moving = new Set(ids)
    const rectOf = (el: HTMLElement) => el.getBoundingClientRect()

    if (kind === 'group') {
      // Between groups: before the first whose middle is below the pointer.
      const cards = Array.from(list.querySelectorAll<HTMLElement>('[data-group-card]'))
        .filter(el => !moving.has(el.dataset.groupCard!))
      if (cards.length === 0) return null
      let before = cards.findIndex(el => { const r = rectOf(el); return clientY < r.top + r.height / 2 })
      if (before === -1) before = cards.length
      const r = rectOf(cards[Math.min(before, cards.length - 1)])
      return {
        layerId: null,
        index: cards.length - before,
        line: { left: r.left, top: before < cards.length ? r.top - 3 : r.bottom + 1, width: r.width },
      }
    }

    // Onto a header: into that group (or Ungrouped), on top.
    for (const header of Array.from(list.querySelectorAll<HTMLElement>('[data-group-header], [data-ungrouped-header]'))) {
      const r = rectOf(header)
      if (clientY >= r.top && clientY <= r.bottom) {
        const layerId = header.dataset.groupHeader ?? null
        return { layerId, index: groupBottomUp(layerId).filter(t => !moving.has(t.id)).length, line: null }
      }
    }
    // Otherwise above or below the nearest row.
    let nearest: HTMLElement | null = null
    let distance = Infinity
    for (const row of Array.from(list.querySelectorAll<HTMLElement>('[data-row-trace]'))) {
      if (moving.has(row.dataset.rowTrace!)) continue
      const r = rectOf(row)
      const d = clientY < r.top ? r.top - clientY : clientY > r.bottom ? clientY - r.bottom : 0
      if (d < distance) { distance = d; nearest = row }
    }
    if (!nearest) return null
    const r = rectOf(nearest)
    const below = clientY > r.top + r.height / 2
    const layerId = nearest.dataset.rowLayer || null
    const topFirst = getTracesForLayer(layerId).filter(t => !moving.has(t.id))
    const before = topFirst.findIndex(t => t.id === nearest!.dataset.rowTrace) + (below ? 1 : 0)
    return {
      layerId,
      index: topFirst.length - before,
      line: { left: r.left, top: below ? r.bottom + 1 : r.top - 3, width: r.width },
    }
  }

  // The list scrolls under a drag held near its top or bottom edge; returns
  // whether it did, since what's under the pointer changes with it.
  const scrollListNear = (clientY: number) => {
    const list = listRef.current
    if (!list) return false
    const r = list.getBoundingClientRect()
    const edge = 36
    const push = clientY < r.top + edge ? -(r.top + edge - clientY) : clientY > r.bottom - edge ? clientY - (r.bottom - edge) : 0
    if (push) list.scrollTop += push * 0.35
    return push !== 0
  }

  // Shows (or clears) where a drag would land.
  //
  // Held over a closed group's header for a moment, a dragged trace opens it,
  // so it can be placed among what's inside -- as folders spring open in
  // Finder and Photoshop. 600ms: long enough not to open everything passed
  // over on the way somewhere else.
  const SPRING_OPEN_MS = 600
  const springOpen = useRef<{ layerId: string; timer: number } | null>(null)
  const expandedRef = useRef(expandedGroups)
  expandedRef.current = expandedGroups
  const showSlot = (slot: DropSlot | null) => {
    setDropSlot(slot)
    setDropTargetId(slot && !slot.line ? slot.layerId ?? UNGROUPED_DROP_TARGET : null)
    const over = slot && !slot.line ? slot.layerId : null
    if (springOpen.current?.layerId === over) return
    if (springOpen.current) window.clearTimeout(springOpen.current.timer)
    springOpen.current = null
    if (over && !expandedRef.current.has(over)) {
      springOpen.current = {
        layerId: over,
        timer: window.setTimeout(() => {
          springOpen.current = null
          setExpandedGroups(prev => new Set(prev).add(over))
        }, SPRING_OPEN_MS),
      }
    }
  }

  // Where a dropped card settles: on the bar, or on the header it went into.
  const landingFor = (slot: DropSlot, height: number): { x: number; y: number } | null => {
    if (slot.line) return { x: slot.line.left, y: slot.line.top - height / 2 }
    const header = listRef.current?.querySelector<HTMLElement>(
      slot.layerId ? `[data-group-header="${CSS.escape(slot.layerId)}"]` : '[data-ungrouped-header]')
    const r = header?.getBoundingClientRect()
    return r ? { x: r.left, y: r.top } : null
  }

  const dragStrength = () => useGameStore.getState().dragBounce / 100

  const beginRowDrag = (e: React.PointerEvent<HTMLElement>, kind: 'group' | 'trace', id: string) => {
    if (!canEdit || e.button !== 0 || renamingId) return
    if ((e.target as HTMLElement).closest('button, input, textarea')) return
    const row = e.currentTarget
    const pointerId = e.pointerId
    const start = { x: e.clientX, y: e.clientY }
    const origin = row.getBoundingClientRect()
    const grab = { x: start.x - origin.left, y: start.y - origin.top }
    const ids = kind === 'trace' && multiSelectedSet.has(id) && multiSelectedSet.size > 1 ? Array.from(multiSelectedSet) : [id]

    let pointer = start
    let slot: DropSlot | null = null
    let card: ReturnType<typeof liftCard> | null = null

    const lift = () => {
      const ghost = row.cloneNode(true) as HTMLElement
      const style = getComputedStyle(row)
      Object.assign(ghost.style, {
        fontFamily: style.fontFamily,
        color: style.color,
        background: 'rgb(var(--c-ground))',
        // A group's border is its card's, which isn't copied with the header.
        border: kind === 'group' ? '1px solid rgb(var(--c-fg) / 0.45)' : style.border,
      })
      card = liftCard(ghost, { x: origin.left, y: origin.top, width: origin.width, height: origin.height }, dragStrength(), () => {
        if (scrollListNear(pointer.y)) showSlot(slot = findDropSlot(kind, ids, pointer.y))
      })
      row.style.opacity = '0.3'
      setRowDrag({ kind, ids })
    }

    const move = (ev: PointerEvent) => {
      if (ev.pointerId !== pointerId) return
      pointer = { x: ev.clientX, y: ev.clientY }
      if (!card) {
        if (Math.hypot(pointer.x - start.x, pointer.y - start.y) < 5) return
        lift()
      }
      card!.follow(pointer.x - grab.x, pointer.y - grab.y)
      showSlot(slot = findDropSlot(kind, ids, pointer.y))
    }

    const end = (ev: PointerEvent) => {
      if (ev.pointerId !== pointerId) return
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', end)
      window.removeEventListener('pointercancel', end)
      if (!card) return // a click, left to onClick
      // The click that follows this release isn't one.
      const swallow = (ce: MouseEvent) => { ce.stopPropagation(); ce.preventDefault() }
      window.addEventListener('click', swallow, { capture: true, once: true })
      window.setTimeout(() => window.removeEventListener('click', swallow, { capture: true }), 0)

      showSlot(null)
      const dropped = ev.type === 'pointerup' ? slot : null
      if (dropped) {
        if (kind === 'group') void moveGroupTo(ids[0], dropped.index)
        else void moveTracesTo(ids, dropped.layerId, dropped.index)
      }
      // Settles where it landed -- or, dropped nowhere, back where it came from.
      const back = row.getBoundingClientRect()
      const to = (dropped && landingFor(dropped, origin.height)) || { x: back.left, y: back.top }
      card.land(to.x, to.y, () => {
        row.style.opacity = ''
        setRowDrag(null)
      })
    }

    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', end)
    window.addEventListener('pointercancel', end)
  }

  // A trace carried in from the canvas (lib/panelDrop): a card of it under the
  // pointer, placed like a dragged row -- between rows, or into a group. The
  // canvas keeps the trace where the drag started meanwhile.
  const carried = useRef<{ card: ReturnType<typeof liftCard>; pointerY: number } | null>(null)
  const carryCard = (ids: string[]) => {
    const traces = useGameStore.getState().traces
    const first = traces.find(t => t.id === ids[0])
    const card = document.createElement('div')
    card.className = 'bg-nier-black border border-nier-border/60 px-2 flex items-center gap-2 text-xs font-mono text-nier-strong'
    // The picture itself where the canvas has one to borrow, else its mark.
    const picture = document.querySelector<HTMLImageElement>(`[data-trace-id="${CSS.escape(ids[0])}"] img`)
    if (picture?.src) {
      const thumb = document.createElement('img')
      thumb.src = picture.src
      thumb.className = 'w-6 h-6 object-cover shrink-0'
      card.appendChild(thumb)
    } else {
      const mark = document.createElement('span')
      mark.className = 'text-nier-bg/70'
      mark.textContent = TYPE_GLYPH[first?.type ?? ''] ?? '◇'
      card.appendChild(mark)
    }
    const name = document.createElement('span')
    name.className = 'truncate tracking-wide'
    name.textContent = first ? rowLabel(first) : t('atrium.layers.untitled')
    card.appendChild(name)
    if (ids.length > 1) {
      const more = document.createElement('span')
      more.className = 'ml-auto text-nier-bg/70'
      more.textContent = `+${ids.length - 1}`
      card.appendChild(more)
    }
    return card
  }
  // Under the pointer, but kept inside the panel's list.
  const cardLeft = (x: number) => {
    const list = listRef.current?.getBoundingClientRect()
    if (!list) return x - 20
    const width = list.width - 16
    return Math.max(list.left + 8, Math.min(x - 20, list.right - width - 8))
  }
  // Read through a ref: the panel registers once, and these change each render.
  const carryRef = useRef<Omit<PanelDropTarget, 'rect'>>({ hover: () => {}, drop: () => false, leave: () => {} })
  carryRef.current = {
    hover(ids, x, y) {
      if (!canEdit) return
      if (!carried.current) {
        const width = (listRef.current?.clientWidth ?? 280) - 16
        carried.current = {
          pointerY: y,
          card: liftCard(carryCard(ids), { x: cardLeft(x), y: y - 18, width, height: 36 }, dragStrength(), () => {
            if (carried.current && scrollListNear(carried.current.pointerY)) showSlot(findDropSlot('trace', ids, carried.current.pointerY))
          }),
        }
        setRowDrag({ kind: 'trace', ids })
      }
      carried.current.pointerY = y
      carried.current.card.follow(cardLeft(x), y - 18)
      showSlot(findDropSlot('trace', ids, y))
    },
    drop(ids, _x, y) {
      const c = carried.current
      carried.current = null
      if (!c) return false
      const slot = canEdit ? findDropSlot('trace', ids, y) : null
      showSlot(null)
      if (!slot) {
        c.card.drop()
        setRowDrag(null)
        return false
      }
      void moveTracesTo(ids, slot.layerId, slot.index)
      const to = landingFor(slot, 36)
      if (to) c.card.land(to.x, to.y, () => setRowDrag(null))
      else { c.card.drop(); setRowDrag(null) }
      return true
    },
    leave() {
      const c = carried.current
      carried.current = null
      c?.card.drop()
      showSlot(null)
      setRowDrag(null)
    },
  }
  useEffect(() => {
    const target = {
      rect: () => panelRef.current?.getBoundingClientRect() ?? null,
      hover: (ids: string[], x: number, y: number) => carryRef.current.hover(ids, x, y),
      drop: (ids: string[], x: number, y: number) => carryRef.current.drop(ids, x, y),
      leave: () => carryRef.current.leave(),
    }
    panelDrop.current = target
    return () => {
      if (panelDrop.current === target) panelDrop.current = null
      carryRef.current.leave()
    }
  }, [])

  // From the latest set, not this render's: two quick toggles each started from
  // the same copy, and only the last one counted.
  const toggleGroup = (groupId: string) => {
    setExpandedGroups(prev => {
      const next = new Set(prev)
      if (next.has(groupId)) next.delete(groupId)
      else next.add(groupId)
      return next
    })
  }

  // Auto-expands whatever group contains the selected trace and scrolls its
  // row into view -- but ONLY once per selection: on a genuine selection
  // change (e.g. clicking a trace on canvas) or the first time this effect
  // sees a given selected trace (which covers the panel being freshly opened
  // while a trace is already selected).
  //
  // Crucially, everything is gated behind a "have we already handled THIS
  // selectedTraceId" ref, so we do NOT fight the user afterwards: once we've
  // expanded + scrolled for a selection, they're free to collapse that group
  // or scroll away, and reorders (which mutate `traces`) won't re-trigger it
  // either. We only mark a selection handled once its trace actually exists
  // in `traces`, so a panel that mounts before traces load still fires once
  // they arrive.
  const handledSelectionRef = useRef<string | null>(null)
  useEffect(() => {
    if (!selectedTraceId) {
      handledSelectionRef.current = null
      return
    }
    if (handledSelectionRef.current === selectedTraceId) return
    const selectedTrace = useGameStore.getState().traces.find(t => t.id === selectedTraceId)
    if (!selectedTrace) return // traces not loaded yet; try again when they are
    handledSelectionRef.current = selectedTraceId
    // Expand the containing group if it's collapsed (one-shot -- if the user
    // later collapses it again we leave it be).
    if (selectedTrace.layerId && !expandedGroups.has(selectedTrace.layerId)) {
      setExpandedGroups(prev => new Set(prev).add(selectedTrace.layerId!))
    }
    const raf = requestAnimationFrame(() => {
      traceRowRefs.current.get(selectedTraceId)?.scrollIntoView({ block: 'center', behavior: 'smooth' })
    })
    return () => cancelAnimationFrame(raf)
  }, [selectedTraceId, traces, expandedGroups])

  // One place up or down among the groups: one write.
  const moveLayerByOne = async (layer: Layer, direction: 'up' | 'down') => {
    if (!supabase || !canEdit) return
    // As it is now, not as it was when clicked: a change queued ahead of
    // this one may have moved it.
    const groups = inOrder(useGameStore.getState().layers)
    const index = groups.findIndex(l => l.id === layer.id)
    const target = direction === 'up' ? index + 1 : index - 1
    if (index === -1 || target < 0 || target >= groups.length) return
    const others = groups.filter(l => l.id !== layer.id)
    const orderKey = await keyAmong(others, target, (l, key) => writeLayerKey(l, key))
    await writeLayerKey(groups[index], orderKey)
  }
  const moveLayerUpNow = (layer: Layer) => moveLayerByOne(layer, 'up')
  const moveLayerDownNow = (layer: Layer) => moveLayerByOne(layer, 'down')

  // What the buttons, menus, drops and dialogs call: each change through the
  // queue, so one never starts while another is part-way through. The ...Now
  // versions above run directly, for use inside a change.
  const queued = <A extends unknown[]>(change: (...args: A) => Promise<unknown>) =>
    (...args: A) => queueLayerChange(() => change(...args))
  const doCreateGroup = queued(doCreateGroupNow)
  const doDeleteGroup = queued(doDeleteGroupNow)
  const doDeleteTrace = queued(doDeleteTraceNow)
  const doRenameGroup = queued(doRenameGroupNow)
  const doRenameTrace = queued(doRenameTraceNow)
  const doDeleteGroupKeepTraces = queued(doDeleteGroupKeepTracesNow)
  const duplicateGroup = queued(duplicateGroupNow)
  const duplicateSingleTrace = queued(duplicateSingleTraceNow)
  const setTraceLocked = queued(setTraceLockedNow)
  const setTracesIgnoreClicks = queued(setTracesIgnoreClicksNow)
  const setTracesEnableInteraction = queued(setTracesEnableInteractionNow)
  const moveTraceToLayer = queued(moveTraceToLayerNow)
  const moveTracesToLayer = queued(moveTracesToLayerNow)
  const moveTraceWithinLayer = queued(moveTraceWithinLayerNow)
  const moveTracesTo = queued(moveTracesToNow)
  const moveGroupTo = queued(moveGroupToNow)
  const moveLayerUp = queued(moveLayerUpNow)
  const moveLayerDown = queued(moveLayerDownNow)

  // Get traces for a specific layer
  const getTracesForLayer = (layerId: string | null) => {
    return groupBottomUp(layerId).reverse() // top of the group first
  }

  // Get ungrouped traces, sorted the same way grouped traces are (highest
  // z-index first) so the rendered order matches what moveTraceToPosition /
  // moveTraceWithinLayer reason about -- otherwise reordering within the
  // ungrouped section appears to do nothing.
  const ungroupedTraces = getTracesForLayer(null)

  // Every trace row that is currently on screen, top to bottom, in the order
  // the panel draws them: each expanded group's traces, then the ungrouped.
  //
  // Collapsed groups are left out on purpose. A range drawn between two
  // visible rows should select what lies between them on screen -- sweeping in
  // a dozen traces hidden inside a folded group would be a selection nobody
  // made and nobody can see.
  const visibleTraceOrder: string[] = []
  for (const orderLayer of layers) {
    if (!expandedGroups.has(orderLayer.id)) continue
    for (const layerTrace of getTracesForLayer(orderLayer.id)) visibleTraceOrder.push(layerTrace.id)
  }
  for (const looseTrace of ungroupedTraces) visibleTraceOrder.push(looseTrace.id)

  // What is selected right now, as a list.
  //
  // A single selection lives in selectedTraceId and never reaches
  // multiSelectedTraceIds, so ctrl-clicking a second row has to start from it
  // -- otherwise the first trace silently drops out of the selection it was
  // supposed to be joining.
  const currentSelection = (): string[] => {
    if (multiSelectedSet.size > 0) return Array.from(multiSelectedSet)
    return selectedTraceId ? [selectedTraceId] : []
  }

  // Click, ctrl/cmd-click and shift-click, as a list is expected to behave.
  //
  // Plain click still selects one and nothing else, which is what the panel
  // has always done and what most clicks mean.
  const handleTraceRowClick = (e: React.MouseEvent, traceId: string) => {
    const additive = e.ctrlKey || e.metaKey

    if (e.shiftKey && onSetSelection) {
      const anchor = rangeAnchor ?? selectedTraceId
      const from = anchor ? visibleTraceOrder.indexOf(anchor) : -1
      const to = visibleTraceOrder.indexOf(traceId)
      // An anchor inside a group that has since been collapsed is no longer on
      // screen, so there is no range to draw. Falls through to a plain select
      // rather than guessing at one.
      if (from !== -1 && to !== -1) {
        const [lo, hi] = from <= to ? [from, to] : [to, from]
        onSetSelection(visibleTraceOrder.slice(lo, hi + 1))
        return
      }
    }

    if (additive && onSetSelection) {
      const next = new Set(currentSelection())
      // Toggling, so ctrl-clicking a selected row takes it out again.
      if (next.has(traceId)) next.delete(traceId)
      else next.add(traceId)
      setRangeAnchor(traceId)
      onSetSelection(Array.from(next))
      return
    }

    setRangeAnchor(traceId)
    // Through onSetSelection rather than onSelectTrace, so this clears the
    // others.
    //
    // onSelectTrace only sets which single trace is selected; the
    // multi-selection lives elsewhere and was left standing, so after
    // shift-picking six rows a plain click on a seventh gave seven selected
    // traces and no way to get back to one except by clicking the canvas.
    // Selecting one thing has to be able to mean only that thing.
    if (onSetSelection) onSetSelection([traceId])
    else onSelectTrace?.(traceId)
  }

  // The groups, top first.
  const sortedLayers = inOrder(layers).reverse()
  const allItems = sortedLayers.map(l => ({ type: 'layer' as const, data: l }))

  return (
    <div
      ref={panelRef}
      data-ui-element="true"
      className="layer-panel panel-in-right fixed w-80 border-2 border-nier-bg shadow-2xl overflow-hidden flex flex-col z-[10000100] pointer-events-auto"
      style={{ 
        backgroundColor: 'rgb(var(--c-ground) / 0.98)',
        top: '80px',
        right: '16px',
        height: 'calc(100vh - 160px)'
      }}
    >
      {/* Corner brackets */}
      <div className="absolute top-0 left-0 w-4 h-4 border-l border-t border-nier-bg pointer-events-none" />
      <div className="absolute top-0 right-0 w-4 h-4 border-r border-t border-nier-bg pointer-events-none" />
      <div className="absolute bottom-0 left-0 w-4 h-4 border-l border-b border-nier-bg pointer-events-none" />
      <div className="absolute bottom-0 right-0 w-4 h-4 border-r border-b border-nier-bg pointer-events-none" />
      
      {/* Header */}
      <div className="bg-nier-black border-b border-nier-border/40 p-3 flex justify-between items-center">
        <div className="flex items-center gap-2">
          <div className="w-1.5 h-1.5 rotate-45 border border-gray-400" />
          <h2 className="text-sm text-nier-strong tracking-[0.15em] uppercase">{t('atrium.layers.title')}</h2>
          {isReordering && (
            <span
              className="w-3 h-3 border border-nier-border/50 border-t-white rounded-full animate-spin"
              title={t('atrium.layers.updatingOrder')}
            />
          )}
        </div>
        <div className="flex gap-2">
          {canEdit && (
          <button
            onClick={createGroup}
            className="atrium-chip px-3 py-1 text-xs tracking-wider uppercase"
            title={t('atrium.layers.createGroup')}
          >
            + {t('atrium.layers.addGroup')}
          </button>
          )}
          <button
            onClick={onClose}
            className="text-nier-bg/70 hover:text-nier-strong text-lg w-6 h-6 flex items-center justify-center transition-colors"
          >
            ×
          </button>
        </div>
      </div>

      {/* Where a dragged row would land: a bright bar in the gap. */}
      {dropSlot?.line && (
        <div
          className="fixed pointer-events-none"
          style={{
            left: dropSlot.line.left - 4,
            top: dropSlot.line.top - 1,
            width: dropSlot.line.width + 8,
            height: 4,
            // Above the dragged row, which sits right where the pointer is.
            zIndex: 10000250,
            borderRadius: 2,
            background: 'rgb(var(--c-fg))',
            boxShadow: '0 0 10px rgb(var(--c-fg) / 0.8), 0 0 2px rgb(var(--c-fg))',
          }}
        />
      )}

      {/* Layer list */}
      <div ref={listRef} className="flex-1 overflow-y-auto p-2 space-y-1">
        {allItems.map((item) => {
          const layer = item.data as Layer
          const layerTraces = getTracesForLayer(layer.id)
          const isExpanded = expandedGroups.has(layer.id)
          
          // Check if this layer can move up or down
          const layerIndex = sortedLayers.findIndex(l => l.id === layer.id)
          const canMoveUp = layerIndex > 0 // Not already at top (highest z-index)
          const canMoveDown = layerIndex < sortedLayers.length - 1 // Not already at bottom (lowest z-index)
          
          // Check if any/all traces in this group are selected
          const hasSelectedTrace = layerTraces.some(t => t.id === selectedTraceId || multiSelectedSet.has(t.id))
          const isGroupFullySelected = layerTraces.length > 0 && layerTraces.every(t => t.id === selectedTraceId || multiSelectedSet.has(t.id))
          const isActiveLayer = activeLayerId === layer.id
          // "Hard selected" (all traces in the group actually selected on
          // canvas, via the diamond icon) gets the amber/yellow treatment;
          // merely focusing the group (soft selection, via its name) or
          // having only some of its traces selected gets blue instead.
          const isHardSelected = isGroupFullySelected

          return (
            <div
              key={layer.id}
              className={`border transition-all ${
                // A static bg-nier-blackLight/80 used to always be present in the
                // base classes here alongside this, which -- since Tailwind
                // resolves same-specificity background-color utilities by
                // stylesheet order, not by className order -- could win over
                // this conditional background regardless of state. Folding
                // the default background into the final else branch below
                // (so only ever one bg-* class is present at a time) makes
                // the highlight actually visible.
                isHardSelected
                  ? 'border-amber-400 bg-amber-900/20 ring-1 ring-amber-400/60'
                  : (isActiveLayer || hasSelectedTrace)
                  ? 'border-blue-400 bg-blue-900/20'
                  : dropTargetId === layer.id
                    ? 'border-emerald-400 bg-emerald-900/20'
                    : 'border-nier-border/40 bg-nier-blackLight/80'
              }`}
              data-group-card={layer.id}
            >
              {/* Group header */}
              <div
                data-group-header={layer.id}
                className="p-2 flex items-center justify-between hover:bg-nier-blackLight/50 cursor-pointer select-none"
                onContextMenu={(e) => openRowMenu(e, 'group', layer.id)}
                onPointerDown={(e) => beginRowDrag(e, 'group', layer.id)}
                onDoubleClick={(e) => {
                  if ((e.target as HTMLElement).closest('button')) return
                  startRename(layer.id, layer.name)
                }}
              >
                <div
                  className="flex items-center gap-1 flex-1 min-w-0"
                  title={t('atrium.layers.groupRowHint')}
                >
                  {canEdit && (
                    // Drawn from divs, not a font glyph (a braille-pattern
                    // grip character here previously) -- whether that glyph
                    // actually renders depends on the system/webview's font
                    // fallback for a fairly obscure Unicode block, so it may
                    // have been invisible (and un-grabbable) for some users,
                    // which looked like drag-reordering not working at all.
                    <span
                      className="grid grid-cols-2 gap-[2px] px-1.5 py-1 cursor-grab active:cursor-grabbing group/grip"
                      style={{ userSelect: 'none' }}
                      onClick={(e) => e.stopPropagation()}
                      title={t('common.dragReorder')}
                    >
                      {Array.from({ length: 6 }).map((_, i) => (
                        <span
                          key={i}
                          className="w-[3px] h-[3px] rounded-full bg-gray-500 group-hover/grip:bg-gray-300 pointer-events-none"
                          style={{ userSelect: 'none' }}
                        />
                      ))}
                    </span>
                  )}
                  <span
                    className="text-nier-bg/70 text-xs px-1 cursor-pointer"
                    onClick={(e) => {
                      e.stopPropagation()
                      toggleGroup(layer.id)
                    }}
                  >
                    {isExpanded ? '▼' : '▶'}
                  </span>
                  <div
                    className="flex items-center gap-2 flex-1 min-w-0 cursor-pointer"
                    onClick={() => {
                      // Just focuses the group as the target for new traces --
                      // does NOT select its traces on the canvas. That's the
                      // diamond icon's job (below), kept as a separate click
                      // target so opening/targeting a group doesn't yank the
                      // user's current canvas selection out from under them.
                      if (isActiveLayer) {
                        onSetActiveLayer?.(null)
                      } else {
                        onSetActiveLayer?.(layer.id)
                      }
                    }}
                  >
                    <span
                      className={`text-xs ${isHardSelected ? 'text-amber-400' : 'text-nier-bg/70'} hover:text-amber-300`}
                      title={t('atrium.layers.selectGroup')}
                      onClick={(e) => {
                        e.stopPropagation()
                        if (isGroupFullySelected) {
                          onSelectGroupTraces?.([])
                        } else {
                          onSelectGroupTraces?.(layerTraces.map(t => t.id))
                          onSetActiveLayer?.(layer.id)
                        }
                      }}
                    >
                      {isHardSelected ? '◆' : '◇'}
                    </span>
                    {renamingId === layer.id ? (
                      renameField(60)
                    ) : (
                      <span className="text-nier-strong text-xs tracking-wide">{layer.name}</span>
                    )}
                    <span className="text-nier-bg/80 text-xs">({layerTraces.length})</span>
                    {isActiveLayer && (
                      <span className={`text-xs tracking-wider uppercase ${isHardSelected ? 'text-amber-400' : 'text-blue-400'}`}>{t('atrium.layers.target')}</span>
                    )}
                  </div>
                </div>
                <div className="flex gap-1">
                  <button
                    onClick={(e) => {
                      e.stopPropagation()
                      moveLayerUp(layer)
                    }}
                    disabled={!canMoveUp}
                    className={`text-xs px-2 py-1 ${canMoveUp ? 'text-nier-bg/70 hover:text-nier-strong cursor-pointer' : 'text-gray-700 cursor-not-allowed'}`}
                    title={canMoveUp ? t('atrium.layers.moveUp') : t('atrium.layers.alreadyAtTop')}
                  >
                    ▲
                  </button>
                  <button
                    onClick={(e) => {
                      e.stopPropagation()
                      moveLayerDown(layer)
                    }}
                    disabled={!canMoveDown}
                    className={`text-xs px-2 py-1 ${canMoveDown ? 'text-nier-bg/70 hover:text-nier-strong cursor-pointer' : 'text-gray-700 cursor-not-allowed'}`}
                    title={canMoveDown ? t('atrium.layers.moveDown') : t('atrium.layers.alreadyAtBottom')}
                  >
                    ▼
                  </button>
                  {/* Rename moved to the right-click menu, along with the rest
                      of the group actions -- the header row was running out of
                      space as features accumulated. */}
                  <button
                    onClick={(e) => openRowMenu(e, 'group', layer.id)}
                    className="text-nier-bg/70 hover:text-nier-strong text-xs px-2 py-1"
                    title={t('atrium.layers.moreActions')}
                  >
                    ⋯
                  </button>
                </div>
              </div>

              {/* Traces in group */}
              {isExpanded && (
                <div className="pl-6 pr-2 pb-2 space-y-1">
                  {layerTraces.map((trace) => (
                    <div
                      key={trace.id}
                      ref={setTraceRowRef(trace.id)}
                      className={`bg-nier-black border p-2 flex items-center justify-between text-xs transition-all cursor-pointer select-none hover:bg-nier-blackLight ${
                        dropTargetId === trace.id
                          ? 'border-emerald-400 bg-emerald-900/20'
                          : trace.id === selectedTraceId || multiSelectedSet.has(trace.id)
                          ? 'border-blue-400 bg-blue-900/30'
                          : 'border-nier-border/40'
                      }`}
                      data-row-trace={trace.id}
                      data-row-layer={trace.layerId ?? ''}
                      onPointerDown={(e) => beginRowDrag(e, 'trace', trace.id)}
                      onDoubleClick={(e) => {
                        if ((e.target as HTMLElement).closest('button')) return
                        startRename(trace.id, nameOf(trace))
                      }}
                      onContextMenu={(e) => openRowMenu(e, 'trace', trace.id)}
                      onClick={(e) => {
                        handleTraceRowClick(e, trace.id)
                      }}
                    >
                      <div className="flex items-center gap-2 flex-1 min-w-0">
                        {canEdit && (
                          <span
                            className="grid grid-cols-2 gap-[2px] px-1 py-0.5 cursor-grab active:cursor-grabbing group/tgrip shrink-0"
                            style={{ userSelect: 'none' }}
                            onClick={(e) => e.stopPropagation()}
                            title={t('common.dragReorder')}
                          >
                            {Array.from({ length: 6 }).map((_, i) => (
                              <span
                                key={i}
                                className="w-[3px] h-[3px] rounded-full bg-gray-600 group-hover/tgrip:bg-gray-300 pointer-events-none"
                                style={{ userSelect: 'none' }}
                              />
                            ))}
                          </span>
                        )}
                        <span className="text-nier-bg/70 text-xs">
                          {TYPE_GLYPH[trace.type] ?? ''}
                        </span>
                        {renamingId === trace.id ? renameField() : (
                          <span className="text-nier-strong/80 truncate tracking-wide">{rowLabel(trace)}</span>
                        )}
                        {trace.illuminate && <span className="text-yellow-400 text-xs" title={t('atrium.layers.emitsLight')}>★</span>}
                      </div>
                      <div className="flex items-center gap-1">
                        <button
                          onClick={(e) => {
                            e.stopPropagation()
                            moveTraceWithinLayer(trace.id, trace.layerId ?? null, 'up')
                          }}
                          disabled={layerTraces.findIndex(t => t.id === trace.id) === 0}
                          className={`text-xs px-1.5 py-0.5 ${layerTraces.findIndex(t => t.id === trace.id) === 0 ? 'text-gray-700 cursor-not-allowed' : 'text-nier-bg/70 hover:text-nier-strong'}`}
                          title={t('atrium.layers.moveUpInGroup')}
                        >
                          ▲
                        </button>
                        <button
                          onClick={(e) => {
                            e.stopPropagation()
                            moveTraceWithinLayer(trace.id, trace.layerId ?? null, 'down')
                          }}
                          disabled={layerTraces.findIndex(t => t.id === trace.id) === layerTraces.length - 1}
                          className={`text-xs px-1.5 py-0.5 ${layerTraces.findIndex(t => t.id === trace.id) === layerTraces.length - 1 ? 'text-gray-700 cursor-not-allowed' : 'text-nier-bg/70 hover:text-nier-strong'}`}
                          title={t('atrium.layers.moveDownInGroup')}
                        >
                          ▼
                        </button>
                        <button
                          onClick={(e) => {
                            e.stopPropagation()
                            onGoToTrace?.(trace.id)
                          }}
                          className="text-nier-bg/70 hover:text-nier-strong text-xs px-1.5 py-0.5 hover:bg-gray-600 transition-colors"
                          title={t('atrium.layers.goToTrace')}
                        >
                          →
                        </button>
                        <button
                          onClick={(e) => {
                            e.stopPropagation()
                            if (multiSelectedSet.has(trace.id) && multiSelectedSet.size > 1) {
                              moveTracesToLayer(Array.from(multiSelectedSet), null)
                            } else {
                              moveTraceToLayer(trace.id, null)
                            }
                          }}
                          className="text-nier-bg/80 hover:text-nier-bg/80 text-xs px-1.5 py-0.5"
                          title={t('atrium.layers.removeFromGroup')}
                        >
                          ↗
                        </button>
                        <button
                          onClick={(e) => {
                            e.stopPropagation()
                            doDeleteTrace(trace.id)
                          }}
                          className="text-red-400/60 hover:text-red-400 text-xs px-1.5 py-0.5"
                          title={t('atrium.layers.deleteTrace')}
                        >
                          ×
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )
        })}

        {/* Ungrouped traces */}
        {(ungroupedTraces.length > 0 || rowDrag?.kind === 'trace') && (
          <div
            className={`border p-2 transition-all ${
              !activeLayerId
                ? 'border-amber-400 bg-amber-900/10 ring-1 ring-amber-400/60'
                : dropTargetId === UNGROUPED_DROP_TARGET ? 'border-emerald-400 bg-emerald-900/20' : 'border-nier-border/40 bg-nier-black/50'
            }`}
          >
            {/* Same soft/hard split as a group header: clicking the label
                only targets Ungrouped for new traces, and the diamond is what
                selects its traces on canvas. This section used to do both at
                once from a single click, so there was no way to target it
                without also yanking the current canvas selection away. */}
            {(() => {
              const isUngroupedFullySelected = ungroupedTraces.length > 0 &&
                ungroupedTraces.every(t => t.id === selectedTraceId || multiSelectedSet.has(t.id))
              return (
                <div data-ungrouped-header className="flex items-center gap-2 mb-2">
                  <span
                    className={`text-xs cursor-pointer ${isUngroupedFullySelected ? 'text-amber-400' : 'text-nier-bg/70'} hover:text-amber-300`}
                    title={t('atrium.layers.selectUngrouped')}
                    onClick={(e) => {
                      e.stopPropagation()
                      if (isUngroupedFullySelected) {
                        onSelectGroupTraces?.([])
                      } else {
                        onSelectGroupTraces?.(ungroupedTraces.map(t => t.id))
                        onSetActiveLayer?.(null)
                      }
                    }}
                  >
                    {isUngroupedFullySelected ? '◆' : '◇'}
                  </span>
                  <span
                    className="text-nier-bg/70 text-xs tracking-[0.15em] uppercase cursor-pointer hover:text-gray-200"
                    title={t('atrium.layers.setUngroupedTarget')}
                    onClick={() => onSetActiveLayer?.(null)}
                  >
                    {t('atrium.layers.ungrouped')}
                  </span>
                  {!activeLayerId && (
                    <span className={`text-xs tracking-wider uppercase ${isUngroupedFullySelected ? 'text-amber-400' : 'text-blue-400'}`}>{t('atrium.layers.target')}</span>
                  )}
                </div>
              )
            })()}
            <div className="space-y-1">
              {ungroupedTraces.map((trace) => (
                <div
                  key={trace.id}
                  ref={setTraceRowRef(trace.id)}
                  className={`bg-nier-black border p-2 flex items-center justify-between text-xs transition-all cursor-pointer select-none hover:bg-nier-blackLight ${
                    dropTargetId === trace.id
                      ? 'border-emerald-400 bg-emerald-900/20'
                      : trace.id === selectedTraceId || multiSelectedSet.has(trace.id)
                      ? 'border-blue-400 bg-blue-900/30'
                      : 'border-nier-border/40'
                  }`}
                  data-row-trace={trace.id}
                  data-row-layer={trace.layerId ?? ''}
                  onPointerDown={(e) => beginRowDrag(e, 'trace', trace.id)}
                  onDoubleClick={(e) => {
                    if ((e.target as HTMLElement).closest('button')) return
                    startRename(trace.id, nameOf(trace))
                  }}
                  onContextMenu={(e) => openRowMenu(e, 'trace', trace.id)}
                  onClick={(e) => {
                    handleTraceRowClick(e, trace.id)
                  }}
                >
                  <div className="flex items-center gap-2 flex-1 min-w-0">
                    {canEdit && (
                      <span
                        className="grid grid-cols-2 gap-[2px] px-1 py-0.5 cursor-grab active:cursor-grabbing group/tgrip shrink-0"
                        style={{ userSelect: 'none' }}
                        onClick={(e) => e.stopPropagation()}
                        title={t('common.dragReorder')}
                      >
                        {Array.from({ length: 6 }).map((_, i) => (
                          <span
                            key={i}
                            className="w-[3px] h-[3px] rounded-full bg-gray-600 group-hover/tgrip:bg-gray-300 pointer-events-none"
                            style={{ userSelect: 'none' }}
                          />
                        ))}
                      </span>
                    )}
                    <span className="text-nier-bg/70 text-xs">
                      {TYPE_GLYPH[trace.type] ?? ''}
                    </span>
                    {renamingId === trace.id ? renameField() : (
                      <span className="text-nier-strong/80 truncate tracking-wide">{rowLabel(trace)}</span>
                    )}
                    {trace.illuminate && <span className="text-yellow-400 text-xs" title={t('atrium.layers.emitsLight')}>★</span>}
                  </div>
                  <div className="flex items-center gap-1">
                    <button
                      onClick={(e) => {
                        e.stopPropagation()
                        moveTraceWithinLayer(trace.id, null, 'up')
                      }}
                      disabled={ungroupedTraces.findIndex(t => t.id === trace.id) === 0}
                      className={`text-xs px-1.5 py-0.5 ${ungroupedTraces.findIndex(t => t.id === trace.id) === 0 ? 'text-gray-700 cursor-not-allowed' : 'text-nier-bg/70 hover:text-nier-strong'}`}
                      title={t('atrium.layers.moveUp')}
                    >
                      ▲
                    </button>
                    <button
                      onClick={(e) => {
                        e.stopPropagation()
                        moveTraceWithinLayer(trace.id, null, 'down')
                      }}
                      disabled={ungroupedTraces.findIndex(t => t.id === trace.id) === ungroupedTraces.length - 1}
                      className={`text-xs px-1.5 py-0.5 ${ungroupedTraces.findIndex(t => t.id === trace.id) === ungroupedTraces.length - 1 ? 'text-gray-700 cursor-not-allowed' : 'text-nier-bg/70 hover:text-nier-strong'}`}
                      title={t('atrium.layers.moveDown')}
                    >
                      ▼
                    </button>
                    <button
                      onClick={(e) => {
                        e.stopPropagation()
                        onGoToTrace?.(trace.id)
                      }}
                      className="text-nier-bg/70 hover:text-nier-strong text-xs px-1.5 py-0.5 hover:bg-gray-600 transition-colors"
                      title={t('atrium.layers.goToTrace')}
                    >
                      →
                    </button>
                    {/* The "Move to..." dropdown that used to sit here is now
                        the right-click menu's Move to Group flyout. */}
                    <button
                      onClick={(e) => {
                        e.stopPropagation()
                        doDeleteTrace(trace.id)
                      }}
                      className="text-red-400/60 hover:text-red-400 text-xs px-1.5 py-0.5"
                      title={t('atrium.layers.deleteTrace')}
                    >
                      ×
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Row right-click menu. Fixed-positioned against the viewport (the
          panel itself scrolls), flipped back on-screen when opened near an
          edge so items never land outside the window. */}
      {rowMenu && canEdit && (() => {
        const isGroup = rowMenu.kind === 'group'
        const layer = isGroup ? layers.find(l => l.id === rowMenu.id) : null
        const trace = !isGroup ? traces.find(t => t.id === rowMenu.id) : null
        if (isGroup && !layer) return null
        if (!isGroup && !trace) return null

        const groupTraces = isGroup ? getTracesForLayer(rowMenu.id) : []
        const menuTargets = isGroup ? [] : rowTraceTargets(rowMenu.id)
        // Opened leftwards when there is not enough room to the right. Without
        // this the flyout would run off the edge whenever the menu is near it,
        // which is the reason this was an in-place expander to begin with.
        const flyoutOnLeft = moveToGroupRect
          ? moveToGroupRect.right + 180 > window.innerWidth
          : false
        const isExpanded = isGroup ? expandedGroups.has(rowMenu.id) : false
        const MENU_WIDTH = 190

        return (
          <div
            ref={rowMenuRef}
            data-layer-row-menu
            className="panel-in fixed bg-nier-black border border-nier-border/50 shadow-xl z-[10000400] py-1 max-h-[90vh] overflow-y-auto"
            // Position comes from the measured element (see
            // useClampedMenuPosition). The estimated heights that used to be
            // here -- 300 for a group, 260 for a trace -- were guesses, and
            // the menu's real height varies with which entries apply.
            style={{ left: rowMenuPos.x, top: rowMenuPos.y, width: MENU_WIDTH }}
            onContextMenu={(e) => e.preventDefault()}
            // Delegated close: an item's own onClick runs first, then bubbles
            // here. Saves threading a close call through every item, and a
            // disabled button doesn't emit a click at all so it can't close
            // the menu by accident. The Move to Group toggle stops propagation
            // since it expands in place rather than completing an action.
            onClick={closeRowMenu}
          >
            <div className="px-3 py-1 text-xs tracking-[0.15em] uppercase text-nier-bg/80 truncate border-b border-nier-border/30 mb-1">
              {isGroup ? layer!.name : (trace!.content.substring(0, 18) || t('atrium.layers.untitled'))}
            </div>

            {isGroup ? (
              <>
                {/* A group has no appearance of its own -- it is a name, an
                    order and a visibility -- so customizing one means
                    customizing what is in it. Empty groups have nothing to
                    open, which is why this is off rather than hidden: the
                    entry stays where the eye expects it between one group and
                    the next. */}
                <MenuItem
                  label={
                    groupTraces.length > 1
                      ? `${t('atrium.menu.customize')} (${groupTraces.length})`
                      : t('atrium.menu.customize')
                  }
                  onClick={() => onCustomize?.(groupTraces.map(gt => gt.id))}
                  disabled={groupTraces.length === 0}
                />
                {/* Ignoring clicks, for the whole group.
                    Offered as whichever direction is not already true of all of
                    them: a group where anything is still clickable offers to
                    stop it, and only a group that is entirely click-through
                    offers to undo that. Mixed groups therefore settle in one
                    press rather than toggling half of them each time. */}
                <MenuItem
                  label={
                    groupTraces.some(gt => !gt.ignoreClicks)
                      ? t('atrium.menu.ignoreClicks')
                      : t('atrium.menu.enableClicks')
                  }
                  onClick={() => setTracesIgnoreClicks(
                    groupTraces.map(gt => gt.id),
                    groupTraces.some(gt => !gt.ignoreClicks),
                  )}
                  disabled={groupTraces.length === 0}
                />
                <MenuItem label={t('atrium.layers.duplicateGroup')} onClick={() => duplicateGroup(rowMenu.id)} busy={isBusy} />
                <MenuItem label={t('common.rename')} onClick={() => startRename(rowMenu.id, layer!.name)} />
                <MenuItem
                  label={isExpanded ? t('atrium.layers.collapse') : t('atrium.layers.expand')}
                  onClick={() => toggleGroup(rowMenu.id)}
                />
                <MenuItem
                  label={t('atrium.layers.selectAllTraces')}
                  onClick={() => {
                    onSelectGroupTraces?.(groupTraces.map(t => t.id))
                    onSetActiveLayer?.(rowMenu.id)
                  }}
                  disabled={groupTraces.length === 0}
                />
                <MenuItem
                  label={t('atrium.layers.goToGroup')}
                  onClick={() => onGoToTraces?.(groupTraces.map(t => t.id))}
                  disabled={groupTraces.length === 0}
                  hint={t('atrium.layers.goToGroupHint')}
                />
                <div className="h-[1px] bg-nier-blackLight my-1" />
                <MenuItem
                  label={t('atrium.layers.ungroupAll')}
                  onClick={() => moveTracesToLayer(groupTraces.map(t => t.id), null)}
                  disabled={groupTraces.length === 0}
                  hint={t('atrium.layers.ungroupAllHint')}
                />
                <MenuItem
                  label={t('atrium.layers.lockAll')}
                  onClick={() => { groupTraces.forEach(t => setTraceLocked(t.id, true)) }}
                  disabled={groupTraces.length === 0}
                />
                <MenuItem
                  label={t('atrium.layers.unlockAll')}
                  onClick={() => { groupTraces.forEach(t => setTraceLocked(t.id, false)) }}
                  disabled={groupTraces.length === 0}
                />
                <div className="h-[1px] bg-nier-blackLight my-1" />
                <MenuItem
                  label={t('atrium.layers.deleteGroupOnly')}
                  onClick={() => doDeleteGroupKeepTraces(rowMenu.id)}
                  danger
                  hint={t('atrium.layers.deleteGroupOnlyHint')}
                />
                <MenuItem
                  label={t(({
                    one: 'atrium.layers.deleteWithTraces.one',
                    few: 'atrium.layers.deleteWithTraces.few',
                    many: 'atrium.layers.deleteWithTraces.many',
                  } as const)[pluralCategory(groupTraces.length)], { count: groupTraces.length })}
                  onClick={() => deleteGroup(rowMenu.id)}
                  danger
                  hint={t('atrium.layers.deleteWithTracesHint')}
                />
              </>
            ) : (
              <>
                <MenuItem label={t('common.duplicate')} onClick={() => duplicateSingleTrace(rowMenu.id)} busy={isBusy} />
                <MenuItem label={t('common.rename')} onClick={() => startRename(rowMenu.id, nameOf(trace!))} />
                <MenuItem label={t('common.select')} onClick={() => onSelectTrace?.(rowMenu.id)} />
                <MenuItem label={t('atrium.layers.goToTrace')} onClick={() => onGoToTrace?.(rowMenu.id)} />
                {/* Acts on the whole selection when the row is part of one,
                    like Move to Group below -- several traces open batch edit
                    rather than one panel per trace. */}
                <MenuItem
                  label={
                    menuTargets.length > 1
                      ? `${t('atrium.menu.customize')} (${menuTargets.length})`
                      : t('atrium.menu.customize')
                  }
                  onClick={() => onCustomize?.(menuTargets)}
                />
                <MenuItem
                  label={trace!.isLocked ? t('atrium.layers.unlock') : t('atrium.layers.lock')}
                  onClick={() => setTraceLocked(rowMenu.id, !trace!.isLocked)}
                  hint={trace!.isLocked ? t('atrium.layers.allowInteract') : t('atrium.layers.preventInteract')}
                />
                <MenuItem
                  label={trace!.ignoreClicks ? t('atrium.menu.enableClicks') : t('atrium.menu.ignoreClicks')}
                  onClick={() => setTracesIgnoreClicks(menuTargets, !trace!.ignoreClicks)}
                />
                {/* Embeds only: nothing else has a page inside it to interact
                    with, and offering the toggle on an image would be a
                    control that does nothing. */}
                {trace!.type === 'embed' && (
                  <MenuItem
                    label={trace!.enableInteraction ? t('atrium.menu.disableInteraction') : t('atrium.menu.enableInteraction')}
                    onClick={() => setTracesEnableInteraction(
                      menuTargets.filter(id => traces.find(tr => tr.id === id)?.type === 'embed'),
                      !trace!.enableInteraction,
                    )}
                  />
                )}
                <div className="h-[1px] bg-nier-blackLight my-1" />
                {/* Inline flyout rather than a hover submenu -- the panel is
                    narrow and a side flyout would open off-screen as often as
                    not. */}
                <div
                  className="relative"
                  onMouseEnter={openMoveToGroup}
                  onMouseLeave={scheduleCloseMoveToGroup}
                >
                  <button
                    onClick={(e) => e.stopPropagation()}
                    className="w-full text-left px-3 py-1.5 text-sm tracking-wider text-nier-strong hover:bg-nier-blackLight flex items-center justify-between"
                  >
                    {/* The count, when this will move more than the row it was
                        opened on. A bare number in brackets rather than a second
                        phrasing of the label: it needs no translating, and the
                        alternative is somebody moving eleven traces because the
                        menu only mentioned one. */}
                    <span>
                      {t('atrium.layers.moveToGroup')}
                      {menuTargets.length > 1 && <span className="text-nier-bg/80"> ({menuTargets.length})</span>}
                    </span>
                    <span className="text-nier-bg/70 text-[9px]">▶</span>
                  </button>
                  {moveToGroupOpen && moveToGroupRect && (
                    <div
                      className="fixed w-max max-w-[220px] max-h-60 overflow-y-auto flex flex-col bg-nier-black border border-nier-border/60 shadow-2xl py-1 z-[10000101]"
                      style={
                        flyoutOnLeft
                          ? { top: moveToGroupRect.top, right: window.innerWidth - moveToGroupRect.left + 1 }
                          : { top: moveToGroupRect.top, left: moveToGroupRect.right + 1 }
                      }
                      onMouseEnter={keepMoveToGroupOpen}
                      onMouseLeave={scheduleCloseMoveToGroup}
                    >
                      {layers.length === 0 && (
                        <div className="px-4 py-1.5 text-xs text-nier-bg/80 italic whitespace-nowrap">{t('atrium.layers.noGroups')}</div>
                      )}
                      {layers.map(l => (
                        <button
                          key={l.id}
                          // Off only when every target is already in there --
                          // with a mixed selection there is still work to do.
                          disabled={menuTargets.every(id => (traces.find(tr => tr.id === id)?.layerId ?? null) === l.id)}
                          onClick={() => { moveTracesToLayer(menuTargets, l.id); closeRowMenu() }}
                          className="px-4 py-1.5 text-left text-xs tracking-wider text-nier-strong hover:bg-nier-blackLight disabled:opacity-30 disabled:cursor-not-allowed truncate"
                        >
                          {l.name}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
                {menuTargets.some(id => traces.find(tr => tr.id === id)?.layerId) && (
                  <MenuItem
                    label={
                      menuTargets.length > 1
                        ? `${t('atrium.layers.ungroup')} (${menuTargets.length})`
                        : t('atrium.layers.ungroup')
                    }
                    onClick={() => moveTracesToLayer(menuTargets, null)}
                    hint={t('atrium.layers.ungroupHint')}
                  />
                )}
                <div className="h-[1px] bg-nier-blackLight my-1" />
                <MenuItem label={t('common.delete')} onClick={() => doDeleteTrace(rowMenu.id)} danger />
              </>
            )}
          </div>
        )
      })()}

      {/* Dialog for create/rename/delete */}
      {dialogMode && (
        <div className="absolute inset-0 bg-nier-black/70 flex items-center justify-center z-50">
          <div className="bg-nier-black border-2 border-nier-bg p-4 w-64">
            <div className="absolute top-0 left-0 w-3 h-3 border-l border-t border-nier-bg pointer-events-none" />
            <div className="absolute top-0 right-0 w-3 h-3 border-r border-t border-nier-bg pointer-events-none" />
            <div className="absolute bottom-0 left-0 w-3 h-3 border-l border-b border-nier-bg pointer-events-none" />
            <div className="absolute bottom-0 right-0 w-3 h-3 border-r border-b border-nier-bg pointer-events-none" />

            {dialogMode === 'delete' ? (
              <>
                <p className="text-nier-strong text-xs tracking-[0.15em] uppercase mb-4">
                  {t('atrium.layers.deleteGroupConfirm')}
                </p>
                <div className="flex gap-2">
                  <button
                    onClick={() => {
                      if (dialogTargetId) doDeleteGroup(dialogTargetId)
                      setDialogMode(null)
                    }}
                    className="flex-1 bg-red-900 hover:bg-red-700 text-nier-strong py-1.5 text-xs tracking-wider uppercase transition-colors"
                  >
                    {t('common.delete')}
                  </button>
                  <button
                    onClick={() => setDialogMode(null)}
                    className="flex-1 border border-nier-border/40 hover:border-nier-bg text-nier-strong py-1.5 text-xs tracking-wider uppercase transition-colors"
                  >
                    {t('common.cancel')}
                  </button>
                </div>
              </>
            ) : (
              <>
                <p className="text-nier-strong text-xs tracking-[0.15em] uppercase mb-3">
                  {t('atrium.layers.newGroupTitle')}
                </p>
                <input
                  autoFocus
                  type="text"
                  value={dialogInput}
                  onChange={(e) => setDialogInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && dialogInput.trim()) {
                      doCreateGroup(dialogInput)
                      setDialogMode(null)
                    }
                    if (e.key === 'Escape') setDialogMode(null)
                  }}
                  className="w-full bg-nier-black border border-nier-border/40 text-nier-strong text-xs px-3 py-2 mb-3 focus:border-nier-bg focus:outline-none tracking-wider"
                  placeholder={t('atrium.layers.groupNamePlaceholder')}
                />
                <div className="flex gap-2">
                  <button
                    onClick={() => {
                      if (dialogInput.trim()) {
                        doCreateGroup(dialogInput)
                      }
                      setDialogMode(null)
                    }}
                    className="flex-1 bg-white hover:bg-nier-bg text-black py-1.5 text-xs tracking-wider uppercase transition-colors"
                  >
                    {t('common.create')}
                  </button>
                  <button
                    onClick={() => setDialogMode(null)}
                    className="flex-1 border border-nier-border/40 hover:border-nier-bg text-nier-strong py-1.5 text-xs tracking-wider uppercase transition-colors"
                  >
                    {t('common.cancel')}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
