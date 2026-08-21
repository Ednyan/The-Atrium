// Emphasis -- and literal, untranslatable code -- inside a translated string.
//
// The alternative was splitting every sentence that needed a coloured phrase
// into three keys -- before, highlight, after -- which makes the catalogue
// unreadable and forces a translator to keep the emphasis in the same place
// English put it. Word order differs; the phrase carrying the weight in a
// sentence differs with it.
//
// So the marker travels inside the string. *Like this.* A translator moves the
// asterisks to whatever their language leans on, and the key stays one
// sentence they can read.
//
// One more marker than there used to be. `Like this` is a second, distinct
// kind of span: a literal shell command or filename that must never be
// translated and reads better in monospace -- not a phrase to emphasise, a
// value to copy. Two markers is the line; a third would be a formatting
// language, and this is a paragraph on a card.
export default function RichText({ text, className = '' }: {
  text: string
  // The class applied to the emphasised (*...*) runs. Defaults to the app's
  // orange. Code (`...`) runs are always monospace and never take this class.
  className?: string
}) {
  // Split on whichever kind of span comes first at each point, so *emphasis*
  // and `code` can appear in either order and don't have to be balanced
  // against each other -- only against their own kind.
  const parts = text.split(/(\*[^*]+\*|`[^`]+`)/g)

  return (
    <>
      {parts.map((part, index) => {
        if (part.startsWith('*') && part.endsWith('*') && part.length > 1) {
          return (
            <span key={index} className={className || 'support-orange font-medium'}>
              {part.slice(1, -1)}
            </span>
          )
        }
        if (part.startsWith('`') && part.endsWith('`') && part.length > 1) {
          return (
            <span key={index} className="font-mono">
              {part.slice(1, -1)}
            </span>
          )
        }
        return part
      })}
    </>
  )
}
