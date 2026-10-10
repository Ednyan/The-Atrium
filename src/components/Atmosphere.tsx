// The light from above and the dust drifting in it: the landing page's hall,
// and the welcome screen's, so the first screens of the app are the same room.
// Styled in index.css (.landing-skylight, .landing-mote); still, with no dust,
// for anyone who asked for less motion.

const MOTES = [...Array(24)].map((_, i) => ({
  left: `${28 + ((i * 37) % 44)}%`,
  size: 1 + (i % 3) * 0.7,
  duration: 18 + ((i * 7) % 13),
  delay: -((i * 2.3) % 30),
  drift: `${((i * 13) % 9) - 4}vw`,
}))

export default function Atmosphere() {
  return (
    <>
      <div aria-hidden="true" className="landing-skylight fixed inset-0 pointer-events-none" />
      <div aria-hidden="true" className="landing-dust fixed inset-0 pointer-events-none overflow-hidden">
        {MOTES.map((mote, i) => (
          <span
            key={i}
            className="landing-mote"
            style={{ left: mote.left, width: mote.size, height: mote.size, animationDuration: `${mote.duration}s`, animationDelay: `${mote.delay}s`, '--drift': mote.drift } as React.CSSProperties}
          />
        ))}
      </div>
    </>
  )
}
