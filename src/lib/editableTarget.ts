// Whether a keystroke is going into a text field, and so is not a shortcut.
//
// This test existed four times, written four slightly different ways -- a raw
// `instanceof HTMLInputElement` here, a `tagName === 'INPUT'` there -- and
// every one of them counted a focused slider as typing. A range keeps focus
// after you drag it, so adjusting brush width or smoothing silently disabled
// undo, redo, Enter, Delete and Escape until something else was clicked. The
// buttons carried on working, which is what made it look like the shortcuts
// had broken rather than that focus had moved.
//
// One copy now, so fixing it once fixes it everywhere. It is the kind of check
// that gets rewritten from memory at each new call site precisely because it
// looks too small to share.

// Inputs that hold focus but swallow no typing. A keystroke aimed at one of
// these is not a keystroke aimed at a text field.
const NON_TEXT_INPUT_TYPES = new Set([
  'range', 'checkbox', 'radio', 'button', 'submit', 'reset', 'color', 'file', 'image',
])

export function isEditableTarget(target: EventTarget | null): boolean {
  const element = target as HTMLElement | null
  if (!element) return false
  if (element.isContentEditable) return true

  // closest() rather than a tag check on the target itself: the event can land
  // on something inside a contenteditable, or on a wrapper within a field.
  const field = element.closest?.(
    'input, textarea, select, [contenteditable=""], [contenteditable="true"], [role="textbox"]',
  )
  if (!field) return false
  if (field instanceof HTMLInputElement && NON_TEXT_INPUT_TYPES.has(field.type)) return false
  return true
}
