// Font size, the way a word processor does it: a box you can type any size
// into, and a list of the usual ones beside it.
//
// It replaced a number input, whose spinner arrows stepped one point at a
// time, and which reset to 16 the moment the field was cleared to type a new
// value -- parseInt("") is NaN, and NaN || 16 is 16.
//
// Not a native <datalist>: that filters its list to what is already typed, so
// with 24 in the box the list shows 24 and nothing else.

import { useEffect, useRef, useState } from 'react'

const PRESETS = [8, 9, 10, 11, 12, 14, 16, 18, 20, 24, 28, 32, 36, 48, 60, 72, 96, 120, 144, 200]

export default function FontSizeField({ value, onChange, min = 8, max = 200, placeholder }: {
  value: number
  onChange: (size: number) => void
  min?: number
  max?: number
  placeholder?: string
}) {
  // What is in the box while it is being typed. Only a finished number is
  // applied, so clearing the field to retype does not snap anything.
  const [draft, setDraft] = useState(String(value))
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)

  useEffect(() => { setDraft(String(value)) }, [value])

  useEffect(() => {
    if (!open) return
    const onPointerDown = (event: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onPointerDown)
    return () => document.removeEventListener('mousedown', onPointerDown)
  }, [open])

  const commit = (raw: string) => {
    const size = Math.round(Number(raw.replace(',', '.')))
    if (!Number.isFinite(size) || raw.trim() === '') {
      setDraft(String(value))
      return
    }
    const clamped = Math.min(max, Math.max(min, size))
    setDraft(String(clamped))
    if (clamped !== value) onChange(clamped)
  }

  const choose = (size: number) => {
    setOpen(false)
    setDraft(String(size))
    if (size !== value) onChange(size)
  }

  return (
    <div ref={rootRef} className="relative flex">
      <input
        type="text"
        inputMode="numeric"
        value={draft}
        onChange={e => setDraft(e.target.value.replace(/[^\d.,]/g, ''))}
        onBlur={() => commit(draft)}
        onKeyDown={e => {
          if (e.key === 'Enter') { commit(draft); setOpen(false) }
          if (e.key === 'Escape') { setDraft(String(value)); setOpen(false) }
          if (e.key === 'ArrowDown' && !open) setOpen(true)
        }}
        placeholder={placeholder}
        className="flex-1 min-w-0 bg-nier-black text-nier-bg border border-nier-border/30 border-r-0 px-3 py-2 font-mono text-sm focus:outline-none focus:border-nier-border/60"
      />
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
        className="px-3 bg-nier-black border border-nier-border/30 text-nier-bg/70 hover:text-nier-strong hover:border-nier-border/60 transition-colors text-[10px]"
      >
        ▾
      </button>

      {open && (
        <div
          role="listbox"
          // The list scrolls; the canvas under the panel must not.
          onWheel={e => e.stopPropagation()}
          className="panel-in absolute left-0 right-0 top-[calc(100%+4px)] z-[10] max-h-56 overflow-y-auto border border-nier-border/40 py-1"
          style={{ backgroundColor: 'rgb(var(--c-surface))' }}
        >
          {PRESETS.filter(size => size >= min && size <= max).map(size => (
            <button
              key={size}
              type="button"
              role="option"
              aria-selected={size === value}
              // mousedown, not click: click comes after the input's blur, which
              // would commit the typed draft first and briefly apply the wrong size.
              onMouseDown={e => { e.preventDefault(); choose(size) }}
              className={`w-full px-3 py-1.5 text-left font-mono text-sm transition-colors flex items-center justify-between ${
                size === value ? 'text-nier-strong bg-nier-bg/10' : 'text-nier-bg/80 hover:text-nier-strong hover:bg-nier-bg/5'
              }`}
            >
              <span>{size}</span>
              {size === value && <span className="text-[10px]">◇</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
