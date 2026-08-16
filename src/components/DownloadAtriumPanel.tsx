import { useState, useMemo } from 'react'
import { downloadAtrium } from '../lib/atriumDownload'

export interface DownloadableAtrium {
  id: string
  name: string
  ownerUsername?: string
  // How this atrium is reachable, shown as a chip so the reason it's in the
  // list is visible rather than implied.
  access: 'owner' | 'admin' | 'public'
}

interface DownloadAtriumPanelProps {
  atriums: DownloadableAtrium[]
  onClose: () => void
}

const ACCESS_LABEL: Record<DownloadableAtrium['access'], string> = {
  owner: 'Owned',
  admin: 'Admin',
  public: 'Public',
}

// Picks an atrium to download as a .atrium.json for the desktop app. Sits
// beside Import in the browser so the two directions of the same transfer
// are in one place, rather than the download hiding inside an atrium the
// user has to enter first.
export default function DownloadAtriumPanel({ atriums, onClose }: DownloadAtriumPanelProps) {
  const [query, setQuery] = useState('')
  const [busyId, setBusyId] = useState<string | null>(null)
  const [status, setStatus] = useState('')
  const [error, setError] = useState('')

  // Matches name, owner, or id -- id because that's what gets pasted around
  // when sharing an atrium, so it's a natural thing to search by.
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return atriums
    return atriums.filter(a =>
      a.name.toLowerCase().includes(q) ||
      (a.ownerUsername ?? '').toLowerCase().includes(q) ||
      a.id.toLowerCase().includes(q)
    )
  }, [atriums, query])

  const handleDownload = async (atrium: DownloadableAtrium) => {
    if (busyId) return
    setBusyId(atrium.id)
    setError('')
    setStatus('Preparing...')
    try {
      const result = await downloadAtrium(atrium.id, setStatus)
      setStatus(`✓ "${atrium.name}" — ${result.traceCount} traces, ${result.layerCount} layers, ${result.locationCount} locations (${result.sizeMB} MB)`)
    } catch (err: any) {
      console.error('Atrium download failed:', err)
      setError(err?.message || 'Download failed')
      setStatus('')
    } finally {
      setBusyId(null)
    }
  }

  return (
    <div className="fixed inset-0 bg-nier-black/80 flex items-center justify-center z-[100] p-4" onClick={onClose}>
      <div
        className="bg-nier-blackLight border border-nier-border/40 max-w-lg w-full max-h-[80vh] flex flex-col relative"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="absolute top-0 left-0 w-4 h-4 border-l border-t border-nier-border/60 pointer-events-none" />
        <div className="absolute top-0 right-0 w-4 h-4 border-r border-t border-nier-border/60 pointer-events-none" />
        <div className="absolute bottom-0 left-0 w-4 h-4 border-l border-b border-nier-border/60 pointer-events-none" />
        <div className="absolute bottom-0 right-0 w-4 h-4 border-r border-b border-nier-border/60 pointer-events-none" />

        <div className="p-6 pb-4">
          <div className="flex items-center justify-between mb-1">
            <div className="flex items-center gap-3">
              <div className="w-1.5 h-1.5 rotate-45 border border-nier-border/60" />
              <h2 className="text-nier-bg tracking-[0.15em] uppercase text-sm">Download Atrium</h2>
            </div>
            <button
              onClick={onClose}
              className="w-7 h-7 flex items-center justify-center border border-nier-border/30 text-nier-bg/80 hover:text-nier-bg hover:border-nier-border/60 transition-colors"
            >
              ×
            </button>
          </div>
          <p className="text-nier-bg/70 text-[10px] tracking-[0.1em] uppercase ml-5 mb-4">
            Save as a file you can import into the desktop app
          </p>

          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by name, owner or ID..."
            className="w-full bg-nier-black border border-nier-border/30 text-nier-bg px-3 py-2 text-xs tracking-wide placeholder-nier-bg/50 focus:border-nier-border/60 focus:outline-none transition-colors"
          />
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto px-6 pb-4 space-y-2">
          {filtered.length === 0 && (
            <p className="text-nier-bg/70 text-xs tracking-wider text-center py-8">
              {atriums.length === 0 ? 'No atriums available to download.' : 'Nothing matches that search.'}
            </p>
          )}
          {filtered.map(atrium => (
            <div
              key={atrium.id}
              className="border border-nier-border/25 bg-nier-black/40 p-3 flex items-center justify-between gap-3"
            >
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="text-nier-bg text-xs tracking-wide truncate">{atrium.name}</span>
                  <span className="text-[8px] tracking-[0.15em] uppercase px-1.5 py-px border border-nier-border/30 text-nier-bg/75 shrink-0">
                    {ACCESS_LABEL[atrium.access]}
                  </span>
                </div>
                <div className="text-nier-bg/70 text-[9px] tracking-wider mt-1 truncate">
                  {atrium.ownerUsername ? `${atrium.ownerUsername} · ` : ''}{atrium.id.slice(0, 8)}
                </div>
              </div>
              <button
                onClick={() => handleDownload(atrium)}
                disabled={!!busyId}
                className="px-3 py-1.5 border border-nier-border/30 text-nier-bg/80 text-[9px] tracking-[0.15em] uppercase hover:border-nier-border/60 hover:text-nier-bg transition-colors disabled:opacity-30 disabled:cursor-not-allowed shrink-0"
              >
                {busyId === atrium.id ? '...' : '↓ Download'}
              </button>
            </div>
          ))}
        </div>

        {(status || error) && (
          <div className="px-6 pb-5">
            {status && <p className="text-nier-bg/80 text-[10px] tracking-wider">{status}</p>}
            {error && <p className="text-[10px] tracking-wider" style={{ color: '#FF6161' }}>⚠ {error}</p>}
          </div>
        )}
      </div>
    </div>
  )
}
