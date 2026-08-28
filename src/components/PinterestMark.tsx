// Pinterest's mark, drawn in one colour.
//
// currentColor rather than Pinterest red, because everywhere it appears here it
// sits in a row of monochrome glyphs that take the theme's foreground -- a
// single brand-red dot among them would read as an error state rather than a
// logo. The shape is what identifies it; the colour is the atrium's.
export default function PinterestMark({ className = '' }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden="true"
      className={className}
    >
      <path d="M12 2a10 10 0 0 0-3.65 19.31c-.09-.78-.17-1.98.03-2.83.19-.79 1.2-5.02 1.2-5.02s-.3-.61-.3-1.51c0-1.42.82-2.48 1.85-2.48.87 0 1.29.66 1.29 1.44 0 .88-.56 2.19-.85 3.41-.24 1.02.51 1.85 1.52 1.85 1.83 0 3.23-1.93 3.23-4.71 0-2.46-1.77-4.18-4.29-4.18-2.92 0-4.64 2.19-4.64 4.46 0 .88.34 1.83.76 2.35.08.1.1.19.07.29-.08.32-.25.98-.28 1.12-.05.19-.15.23-.35.14-1.28-.6-2.08-2.46-2.08-3.96 0-3.22 2.34-6.18 6.75-6.18 3.54 0 6.3 2.52 6.3 5.9 0 3.52-2.22 6.35-5.3 6.35-1.03 0-2.01-.54-2.34-1.18l-.64 2.43c-.23.89-.85 2-1.27 2.68A10 10 0 1 0 12 2z" />
    </svg>
  )
}
