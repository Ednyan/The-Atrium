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
export default function RichText({ text, className = '', onEmphasisClick }: {
  text: string
  // The class applied to the emphasised (*...*) runs. Defaults to the app's
  // orange. Code (`...`) runs are always monospace and never take this class.
  className?: string
  // Makes the emphasised runs activatable, for a sentence where the phrase
  // carrying the weight is also the way somewhere else.
  //
  // Deliberately not a third marker. The marker set is two because a third
  // starts turning this into a formatting language, and a link is not a third
  // kind of span anyway -- it is the same emphasised phrase, in a place where
  // it happens to lead somewhere. A caller that passes this owns the whole
  // string, so it can write the sentence with exactly one emphasised run and
  // know which one it is getting.
  //
  // A real <button> rather than a span with a click handler, so it can be
  // reached by keyboard and announced as something that does something.
  onEmphasisClick?: () => void
}) {
  // Split on whichever kind of span comes first at each point, so *emphasis*
  // and `code` can appear in either order and don't have to be balanced
  // against each other -- only against their own kind.
  const parts = text.split(/(\*[^*]+\*|`[^`]+`)/g)

  return (
    <>
      {parts.map((part, index) => {
        if (part.startsWith('*') && part.endsWith('*') && part.length > 1) {
          if (onEmphasisClick) {
            return (
              <button
                key={index}
                type="button"
                onClick={onEmphasisClick}
                className={className || 'support-orange font-medium'}
              >
                {part.slice(1, -1)}
              </button>
            )
          }
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
