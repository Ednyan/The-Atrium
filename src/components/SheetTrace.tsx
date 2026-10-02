// What a sheet or chart trace shows: its file (lib/spreadsheet), drawn by
// lib/sheetDraw. A chart is drawn whole, at its box's size. A sheet is drawn a
// block of rows at a time, and only the blocks near the screen -- a
// spreadsheet of thousands of rows costs what's in view.

import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from '../lib/i18n'
import { chartSvg, sheetFile, sheetRows, sheetSvg } from '../lib/sheetDraw'
import { baseSizeOf } from '../lib/traceGeometry'
import type { ChartData, SheetData } from '../lib/spreadsheet'
import type { Trace } from '../types/database'

const BLOCK = 40
// Fills its box, however the box is stretched.
const FILL = 'absolute left-0 w-full [&>svg]:w-full [&>svg]:h-full [&>svg]:block'

export default function SheetTrace({ trace }: { trace: Trace }) {
  const { t, language } = useTranslation()
  // Undefined while it's read; null when it can't be.
  const [data, setData] = useState<SheetData | ChartData | null | undefined>(undefined)
  useEffect(() => {
    const url = trace.mediaUrl
    if (!url) { setData(null); return }
    let live = true
    const load = () => void sheetFile(url).then(d => { if (live) setData(d) })
    setData(undefined)
    load()
    // A file still being written to the vault is read again once it's there.
    const written = (e: Event) => { if ((e as CustomEvent).detail?.localUrl === url) load() }
    window.addEventListener('atrium:vault-write-complete', written)
    return () => { live = false; window.removeEventListener('atrium:vault-write-complete', written) }
  }, [trace.mediaUrl])

  const size = baseSizeOf(trace)
  const chart = useMemo(
    () => (data?.kind === 'chart' ? chartSvg(data, size.width, size.height, 1, language) : ''),
    [data, size.width, size.height, language],
  )

  if (!data) {
    return (
      <div className="w-full h-full bg-white flex items-center justify-center pointer-events-none select-none">
        <span className="text-black/40 text-[10px] tracking-wider uppercase">
          {data === null ? t('atrium.sheet.unreadable') : t('atrium.controls.rendering')}
        </span>
      </div>
    )
  }
  if (data.kind === 'chart') {
    return <div className={`${FILL} top-0 h-full pointer-events-none select-none`} dangerouslySetInnerHTML={{ __html: chart }} />
  }
  const rows = sheetRows(data)
  return (
    <div className="w-full h-full relative bg-white overflow-hidden pointer-events-none select-none">
      {Array.from({ length: Math.ceil(rows / BLOCK) }, (_, i) => (
        <SheetBlock key={i} data={data} from={i * BLOCK} to={Math.min(rows, (i + 1) * BLOCK)} rows={rows} />
      ))}
    </div>
  )
}

// Rows `from` to `to`, drawn while they're on screen or near it.
function SheetBlock({ data, from, to, rows }: { data: SheetData; from: number; to: number; rows: number }) {
  const ref = useRef<HTMLDivElement>(null)
  const [near, setNear] = useState(false)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const observer = new IntersectionObserver(([entry]) => setNear(entry.isIntersecting), { rootMargin: '50%' })
    observer.observe(el)
    return () => observer.disconnect()
  }, [])
  const markup = useMemo(() => (near ? sheetSvg(data, from, to) : ''), [near, data, from, to])
  return (
    <div
      ref={ref}
      className={FILL}
      style={{ top: `${(from / rows) * 100}%`, height: `${((to - from) / rows) * 100}%` }}
      dangerouslySetInnerHTML={{ __html: markup }}
    />
  )
}
