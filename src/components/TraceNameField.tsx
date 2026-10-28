// A trace's name, in the customize panel's Arrange.
//
// A trace has one field for this -- `content` -- and the app called it three
// things: a shape's "Label", an image's "Description / Caption", an embed's
// "Description / Title". The layer panel shows the same field as the layer's
// name. So it is presented once, as the name, where a name belongs: first.
//
// A text trace's name is its text, which the Text box below already edits, so
// there it is shown and not editable -- two editors for one value would only
// raise the question of which one wins.

import { useLayoutEffect, useRef } from 'react'
import { Row } from './Customization'

export default function TraceNameField({ label, value, placeholder, maxLength, readOnly, onChange, onCommit }: {
  label: string
  value: string
  placeholder: string
  maxLength?: number
  readOnly?: boolean
  onChange: (value: string) => void
  onCommit: (value: string) => void
}) {
  const ref = useRef<HTMLTextAreaElement>(null)

  // Grows with the text instead of scrolling inside one line.
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${el.scrollHeight}px`
  }, [value])

  return (
    <Row label={label}>
      {readOnly ? (
        <p className="text-xs text-nier-strong tracking-[0.04em] leading-snug py-1.5 line-clamp-2 break-words">
          {value.trim() || <span className="text-nier-bg/35">{placeholder}</span>}
        </p>
      ) : (
        <textarea
          ref={ref}
          rows={1}
          value={value}
          maxLength={maxLength}
          placeholder={placeholder}
          onChange={e => onChange(e.target.value)}
          onBlur={e => onCommit(e.target.value)}
          onKeyDown={e => {
            // Enter finishes naming; Shift+Enter still breaks a line, so a
            // caption that already has one keeps it.
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              e.currentTarget.blur()
            }
          }}
          className="block w-full resize-none overflow-hidden bg-nier-black border border-nier-border/30 hover:border-nier-border/50 focus:border-nier-border/60 focus:outline-none px-2 py-[7px] text-xs text-nier-strong tracking-[0.04em] leading-snug placeholder-nier-bg/35 transition-colors"
        />
      )}
    </Row>
  )
}
