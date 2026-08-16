import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useGameStore } from '../store/gameStore'
import { mapRowToTrace } from '../hooks/useTraces'
import { packBoxesAroundCenter, scaleToDisplayBox, getDefaultTraceBoxSize } from '../lib/binPack'
import { getTraceBaseZIndex } from '../lib/layerZIndex'
import {
  fetchPinterestBoards,
  fetchPinterestBoardPins,
  type PinterestBoard,
  type PinterestPin,
} from '../lib/pinterest'

interface PinterestImportPanelProps {
  onClose: () => void
  lobbyId: string
  worldCenter: { x: number; y: number }
  packingShape: 'square' | 'circle'
  activeLayerId: string | null
}

type Step = 'boards' | 'pins-loading' | 'confirm' | 'importing' | 'done' | 'error'

export default function PinterestImportPanel({ onClose, lobbyId, worldCenter, packingShape, activeLayerId }: PinterestImportPanelProps) {
  const { userId, username, traces, addTrace } = useGameStore()
  const [step, setStep] = useState<Step>('boards')
  const [boards, setBoards] = useState<PinterestBoard[]>([])
  const [boardsLoading, setBoardsLoading] = useState(true)
  const [selectedBoard, setSelectedBoard] = useState<PinterestBoard | null>(null)
  const [pins, setPins] = useState<PinterestPin[]>([])
  const [pinsFetched, setPinsFetched] = useState(0)
  const [importDone, setImportDone] = useState(0)
  const [errorMessage, setErrorMessage] = useState('')

  useEffect(() => {
    loadBoards()
  }, [])

  const loadBoards = async () => {
    setBoardsLoading(true)
    setErrorMessage('')
    try {
      const result = await fetchPinterestBoards()
      setBoards(result)
    } catch (err: any) {
      setErrorMessage(err.message || 'Failed to load Pinterest boards')
      setStep('error')
    } finally {
      setBoardsLoading(false)
    }
  }

  const handleSelectBoard = async (board: PinterestBoard) => {
    setSelectedBoard(board)
    setStep('pins-loading')
    setPinsFetched(0)
    setErrorMessage('')
    try {
      const result = await fetchPinterestBoardPins(board.id, (fetchedSoFar) => setPinsFetched(fetchedSoFar))
      setPins(result)
      setStep('confirm')
    } catch (err: any) {
      setErrorMessage(err.message || 'Failed to load pins from that board')
      setStep('error')
    }
  }

  const handleImport = async () => {
    if (!supabase || pins.length === 0) return
    setStep('importing')
    setImportDone(0)

    try {
      // One box size per pin, using its real aspect ratio when Pinterest
      // reported dimensions (falls back to the standard embed box otherwise),
      // then laid out with the same bin-packing used for multi-file
      // drops/pastes so a big board doesn't just cascade diagonally.
      const sizes = pins.map(p =>
        p.imageWidth && p.imageHeight
          ? scaleToDisplayBox({ width: p.imageWidth, height: p.imageHeight })
          : getDefaultTraceBoxSize('embed')
      )
      const offsets = packBoxesAroundCenter(sizes, 24, packingShape)

      let baseLayerZIndex = 0
      let existingInLayer = 0
      if (activeLayerId && supabase) {
        const { data } = await supabase.from('layers').select('z_index').eq('id', activeLayerId).single()
        baseLayerZIndex = getTraceBaseZIndex((data as any)?.z_index ?? 0)
        existingInLayer = traces.filter(t => t.layerId === activeLayerId).length
      }

      const rows = pins.map((pin, i) => ({
        user_id: userId,
        username,
        type: 'embed',
        content: pin.title || pin.description || '',
        position_x: worldCenter.x + offsets[i].x,
        position_y: worldCenter.y + offsets[i].y,
        media_url: pin.imageUrl,
        link_url: pin.pinUrl,
        width: sizes[i].width,
        height: sizes[i].height,
        scale: 1.0,
        rotation: 0.0,
        lobby_id: lobbyId,
        show_description: false,
        show_filename: false,
        ...(activeLayerId ? { layer_id: activeLayerId, z_index: baseLayerZIndex + existingInLayer + i + 1 } : {}),
      }))

      // Bulk insert in chunks -- Postgrest can take one big array insert, but
      // chunking keeps any single request small and lets the progress bar
      // move instead of appearing to hang on one huge call.
      const CHUNK_SIZE = 50
      for (let i = 0; i < rows.length; i += CHUNK_SIZE) {
        const chunk = rows.slice(i, i + CHUNK_SIZE)
        const { data, error } = await supabase.from('traces').insert(chunk as any).select()
        if (error) {
          console.error('[PinterestImportPanel] bulk insert error:', error)
          setErrorMessage(error.message || 'Failed to import some pins')
          setStep('error')
          return
        }
        for (const row of data ?? []) {
          addTrace(mapRowToTrace(row))
        }
        setImportDone(prev => prev + chunk.length)
      }

      setStep('done')
    } catch (err: any) {
      setErrorMessage(err.message || 'Failed to import pins')
      setStep('error')
    }
  }

  return (
    <div
      data-ui-element="true"
      className="fixed inset-0 bg-nier-black/80 flex items-center justify-center z-[10000100] p-4"
      onClick={step !== 'importing' ? onClose : undefined}
    >
      <div
        className="bg-nier-blackLight border border-nier-border/40 max-w-2xl w-full max-h-[90vh] relative flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="absolute top-0 left-0 w-6 h-6 border-l border-t border-nier-border/60" />
        <div className="absolute top-0 right-0 w-6 h-6 border-r border-t border-nier-border/60" />
        <div className="absolute bottom-0 left-0 w-6 h-6 border-l border-b border-nier-border/60" />
        <div className="absolute bottom-0 right-0 w-6 h-6 border-r border-b border-nier-border/60" />

        <div className="flex justify-between items-center px-6 py-4 border-b border-nier-border/20">
          <div className="flex items-center gap-3">
            <div className="w-1.5 h-1.5 rotate-45 border border-nier-border/60" />
            <h2 className="text-lg text-white tracking-[0.15em] uppercase">Import from Pinterest</h2>
          </div>
          {step !== 'importing' && (
            <button
              onClick={onClose}
              className="w-8 h-8 flex items-center justify-center border border-nier-border/30 text-nier-bg/80 hover:text-nier-bg hover:border-nier-border/60 transition-colors"
            >
              ×
            </button>
          )}
        </div>

        <div className="overflow-y-auto p-6 flex-1 min-h-0">
          {step === 'boards' && (
            <>
              {boardsLoading ? (
                <p className="text-nier-bg/75 text-xs tracking-wider text-center py-8">Loading your boards...</p>
              ) : boards.length === 0 ? (
                <p className="text-nier-bg/75 text-xs tracking-wider text-center py-8">No boards found on this Pinterest account.</p>
              ) : (
                <div className="grid grid-cols-3 gap-3">
                  {boards.map(board => (
                    <button
                      key={board.id}
                      onClick={() => handleSelectBoard(board)}
                      className="border border-nier-border/30 hover:border-nier-border/60 transition-colors text-left overflow-hidden bg-nier-black"
                    >
                      <div className="w-full aspect-square bg-nier-border/10 flex items-center justify-center overflow-hidden">
                        {board.thumbnailUrl ? (
                          <img src={board.thumbnailUrl} alt="" className="w-full h-full object-cover" />
                        ) : (
                          <span className="text-nier-bg/50 text-2xl">◇</span>
                        )}
                      </div>
                      <div className="p-2">
                        <p className="text-nier-bg text-[11px] tracking-wide truncate">{board.name}</p>
                        <p className="text-nier-bg/70 text-[9px] tracking-wider">{board.pinCount} pins</p>
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </>
          )}

          {step === 'pins-loading' && (
            <div className="py-12 text-center">
              <p className="text-nier-bg text-sm tracking-wider mb-2">Fetching pins from "{selectedBoard?.name}"...</p>
              <p className="text-nier-bg/70 text-xs tracking-wider">{pinsFetched} pins found so far</p>
            </div>
          )}

          {step === 'confirm' && selectedBoard && (
            <div className="py-8 text-center space-y-4">
              <p className="text-nier-bg text-sm tracking-wider">
                Import {pins.length} pin{pins.length === 1 ? '' : 's'} from "{selectedBoard.name}"?
              </p>
              <p className="text-nier-bg/70 text-xs tracking-wider">
                Each pin becomes an embed trace, laid out around your current view. Pins whose image fails to hotlink show as a link card back to the original pin instead.
              </p>
              <div className="flex gap-2 justify-center pt-2">
                <button
                  onClick={handleImport}
                  className="px-6 py-2 bg-nier-bg text-nier-black text-[10px] tracking-[0.15em] uppercase hover:bg-nier-bgDark transition-colors"
                >
                  Import {pins.length} Pins
                </button>
                <button
                  onClick={() => { setStep('boards'); setSelectedBoard(null); setPins([]) }}
                  className="px-6 py-2 border border-nier-border/30 text-nier-bg/80 text-[10px] tracking-[0.15em] uppercase hover:border-nier-border/60 hover:text-nier-bg transition-colors"
                >
                  Back
                </button>
              </div>
            </div>
          )}

          {step === 'importing' && (
            <div className="py-12 text-center">
              <p className="text-nier-bg text-sm tracking-wider mb-3">Importing pins...</p>
              <p className="text-nier-bg/70 text-xs tracking-wider mb-3">{importDone} / {pins.length}</p>
              <div className="w-64 h-[3px] bg-nier-border/10 overflow-hidden mx-auto">
                <div
                  className="h-full bg-nier-bg transition-all"
                  style={{ width: `${pins.length ? (importDone / pins.length) * 100 : 0}%` }}
                />
              </div>
            </div>
          )}

          {step === 'done' && (
            <div className="py-12 text-center space-y-4">
              <p className="text-nier-bg text-sm tracking-wider">✓ Imported {importDone} pins</p>
              <button
                onClick={onClose}
                className="px-6 py-2 bg-nier-bg text-nier-black text-[10px] tracking-[0.15em] uppercase hover:bg-nier-bgDark transition-colors"
              >
                Done
              </button>
            </div>
          )}

          {step === 'error' && (
            <div className="py-12 text-center space-y-4">
              <p className="text-nier-red text-sm tracking-wider">{errorMessage}</p>
              <button
                onClick={onClose}
                className="px-6 py-2 border border-nier-border/30 text-nier-bg/80 text-[10px] tracking-[0.15em] uppercase hover:border-nier-border/60 hover:text-nier-bg transition-colors"
              >
                Close
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
