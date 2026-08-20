// Emphasis inside a translated string.
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
// Deliberately the only markup there is. A second one would be a formatting
// language, and this is a paragraph on a card.

export default function RichText({ text, className = '' }: {
  text: string
  // The class applied to the emphasised runs. Defaults to the app's orange.
  className?: string
}) {
  const parts = text.split(/\*([^*]+)\*/g)

  return (
    <>
      {parts.map((part, index) =>
        // Odd indices are what sat between a pair of asterisks.
        index % 2 === 1
          ? (
            <span key={index} className={className || 'support-orange font-medium'}>
              {part}
            </span>
          )
          : part,
      )}
    </>
  )
}
