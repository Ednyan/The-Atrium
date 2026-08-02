import { useEffect, useState } from 'react'
import {
  getDatabaseIntegrityError,
  listVaultMirrors,
  restoreAtriumFromMirror,
  type VaultMirror,
} from '../lib/localDb'

interface VaultRecoveryPanelProps {
  onClose: () => void
  onRestored: () => void
}

// Rebuilds atriums from the per-atrium mirrors in the vault.
//
// Exists because the mirrors were a copy nothing could read back -- so a
// damaged database meant losing traces that were, in fact, sitting on disk the
// whole time. It's the reason the duplicated media in the vault is worth its
// space.
export default function VaultRecoveryPanel({ onClose, onRestored }: VaultRecoveryPanelProps) {
  const [mirrors, setMirrors] = useState<VaultMirror[] | null>(null)
  const [busyPath, setBusyPath] = useState<string | null>(null)
  const [result, setResult] = useState<string>('')
  const [error, setError] = useState<string>('')

  const integrityError = getDatabaseIntegrityError()

  const load = () => {
    listVaultMirrors()
      .then(setMirrors)
      .catch(e => { setError(e?.message || String(e)); setMirrors([]) })
  }
  useEffect(load, [])

  const restore = async (mirror: VaultMirror) => {
    setBusyPath(mirror.snapshotPath)
    setError('')
    setResult('')
    try {
      const r = await restoreAtriumFromMirror(mirror.snapshotPath)
      setResult(
        `Restored "${r.lobbyName}" — ${r.traces} traces, ${r.layers} layers, ${r.mediaFiles} files` +
        (r.mediaMissing > 0 ? `, ${r.mediaMissing} files missing` : ''),
      )
      load()
      onRestored()
    } catch (e: any) {
      setError(e?.message || String(e))
    } finally {
      setBusyPath(null)
    }
  }

  return (
    <div className="fixed inset-0 bg-nier-black/80 flex items-center justify-center z-[10000200] pointer-events-auto">
      <div className="bg-nier-blackLight border border-nier-border/40 p-6 max-w-lg w-full mx-4 relative max-h-[85vh] overflow-y-auto">
        <div className="absolute top-0 left-0 w-4 h-4 border-l border-t border-nier-border/60" />
        <div className="absolute top-0 right-0 w-4 h-4 border-r border-t border-nier-border/60" />
        <div className="absolute bottom-0 left-0 w-4 h-4 border-l border-b border-nier-border/60" />
        <div className="absolute bottom-0 right-0 w-4 h-4 border-r border-b border-nier-border/60" />

        <div className="flex items-center gap-3 mb-5">
          <div className="w-1.5 h-1.5 rotate-45 border border-nier-border/60" />
          <h3 className="text-nier-bg tracking-[0.15em] uppercase">Restore From Vault</h3>
        </div>

        {integrityError && (
          <div className="bg-red-900/20 border border-red-500/40 p-3 mb-4">
            <p className="text-red-400 text-[10px] tracking-wider uppercase mb-1">Database damaged</p>
            <p className="text-red-300/80 text-[10px] tracking-wide leading-relaxed">
              {integrityError}. Atriums below can be rebuilt from their vault copies.
            </p>
          </div>
        )}

        <p className="text-nier-border/70 text-xs tracking-wide mb-4 leading-relaxed">
          Every atrium is mirrored in your vault as a folder with its own files. Anything
          missing from the app can be rebuilt from here.
        </p>

        {mirrors === null && (
          <p className="text-nier-border/50 text-[10px] tracking-wider uppercase">Reading vault…</p>
        )}

        {mirrors?.length === 0 && (
          <p className="text-nier-border/50 text-[10px] tracking-wider uppercase">No atrium copies found.</p>
        )}

        <div className="space-y-2">
          {mirrors?.map(mirror => (
            <div
              key={mirror.snapshotPath}
              className="bg-nier-black border border-nier-border/20 p-3 flex justify-between items-center gap-3"
            >
              <div className="min-w-0">
                <div className="text-nier-bg text-sm tracking-wide truncate">{mirror.lobbyName}</div>
                <div className="flex gap-3 mt-1 text-[9px] text-nier-border/50 tracking-wider uppercase">
                  <span>{mirror.traceCount} traces</span>
                  <span>{mirror.layerCount} layers</span>
                  {mirror.syncedAt && <span>{new Date(mirror.syncedAt).toLocaleDateString()}</span>}
                </div>
                {/* The distinction that matters: one of these is a recovery,
                    the other would be a duplicate. */}
                <div className={`text-[9px] tracking-wider uppercase mt-1 ${mirror.missingFromDatabase ? 'text-amber-400' : 'text-nier-border/40'}`}>
                  {mirror.missingFromDatabase ? 'Missing from the app' : 'Already in the app — restores as a copy'}
                </div>
              </div>
              <button
                type="button"
                onClick={() => restore(mirror)}
                disabled={busyPath !== null}
                className="px-3 py-2 border border-nier-border/40 text-nier-bg text-[10px] tracking-[0.1em] uppercase hover:bg-nier-bg hover:text-nier-black transition-colors disabled:opacity-30 disabled:cursor-not-allowed shrink-0"
              >
                {busyPath === mirror.snapshotPath ? 'Restoring…' : 'Restore'}
              </button>
            </div>
          ))}
        </div>

        {result && (
          <div className="bg-nier-black border border-nier-border/20 p-3 mt-4">
            <p className="text-green-400 text-[10px] tracking-wider">{result}</p>
          </div>
        )}
        {error && (
          <div className="bg-red-900/20 border border-red-500/40 p-3 mt-4">
            <p className="text-red-400 text-[10px] tracking-wide">{error}</p>
          </div>
        )}

        <button
          type="button"
          onClick={onClose}
          className="w-full mt-5 py-2 border border-nier-border/30 text-nier-border text-[10px] tracking-[0.15em] uppercase hover:border-nier-border/60 hover:text-nier-bg transition-colors"
        >
          Close
        </button>
      </div>
    </div>
  )
}
