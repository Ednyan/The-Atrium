import { useState, useEffect, useMemo } from 'react'

interface LandingPageProps {
  onGetStarted: () => void
}

export default function LandingPage({ onGetStarted }: LandingPageProps) {
  const [mousePos, setMousePos] = useState({ x: 0, y: 0 })

  // Memoize particle positions so they don't jitter on re-render
  const particles = useMemo(() => 
    [...Array(25)].map((_, i) => ({
      left: `${(i * 17 + 3) % 96}%`,
      top: `${(i * 23 + 5) % 94}%`,
      duration: 8 + (i * 1.5) % 6,
      delay: i * 0.5,
    })), []
  )

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      setMousePos({ x: e.clientX, y: e.clientY })
    }
    
    window.addEventListener('mousemove', handleMouseMove)
    return () => {
      window.removeEventListener('mousemove', handleMouseMove)
    }
  }, [])

  return (
    <div className="min-h-screen bg-nier-black text-nier-bg overflow-hidden">
      {/* Scanline overlay */}
      <div className="fixed inset-0 pointer-events-none opacity-[0.02] z-50"
        style={{
          backgroundImage: 'repeating-linear-gradient(0deg, transparent, transparent 2px, rgba(218, 212, 187, 0.1) 2px, rgba(218, 212, 187, 0.1) 4px)',
        }}
      />

      {/* Animated background grid */}
      <div 
        className="fixed inset-0 pointer-events-none opacity-10"
        style={{
          backgroundImage: `
            linear-gradient(rgba(218, 212, 187, 0.15) 1px, transparent 1px),
            linear-gradient(90deg, rgba(218, 212, 187, 0.15) 1px, transparent 1px)
          `,
          backgroundSize: '60px 60px',
          transform: `translate(${mousePos.x * 0.01}px, ${mousePos.y * 0.01}px)`,
          transition: 'transform 0.5s ease-out',
        }}
      />

      {/* Floating particles - memoized positions */}
      <div className="fixed inset-0 pointer-events-none overflow-hidden">
        {particles.map((particle, i) => (
          <div
            key={i}
            className="absolute w-1 h-1 bg-nier-border rounded-full opacity-0"
            style={{
              left: particle.left,
              top: particle.top,
              animation: `firefly ${particle.duration}s ease-in-out infinite`,
              animationDelay: `${particle.delay}s`,
            }}
          />
        ))}
      </div>

      {/* Main content - single screen, no scroll */}
      <div className="relative min-h-screen flex flex-col items-center justify-center px-6">
        {/* Corner brackets */}
        <div className="absolute top-8 left-8 w-16 h-16 border-l-2 border-t-2 border-nier-border/30" />
        <div className="absolute top-8 right-8 w-16 h-16 border-r-2 border-t-2 border-nier-border/30" />
        <div className="absolute bottom-8 left-8 w-16 h-16 border-l-2 border-b-2 border-nier-border/30" />
        <div className="absolute bottom-8 right-8 w-16 h-16 border-r-2 border-b-2 border-nier-border/30" />

        {/* Main title */}
        <div className="text-center max-w-3xl">
          <div className="flex items-center justify-center gap-4 mb-6">
            <div className="w-12 h-[1px] bg-gradient-to-r from-transparent to-nier-border/50" />
            <span className="text-nier-border/70 text-xs tracking-[0.3em] uppercase">Digital Collaboration Space</span>
            <div className="w-12 h-[1px] bg-gradient-to-l from-transparent to-nier-border/50" />
          </div>
          
          <h1 className="text-6xl md:text-8xl font-extralight tracking-wider mb-6">
            <span className="text-nier-border/60">THE</span>{' '}
            <span className="text-nier-bg">LOBBY</span>
          </h1>
          
          <p className="text-nier-border text-lg md:text-xl font-light tracking-wide mb-4">
            A shared digital canvas where teams collaborate in real-time.
          </p>
          <p className="text-nier-border/60 text-sm md:text-base font-light tracking-wide mb-12">
            Place ideas. Build together. Create meaning.
          </p>

          {/* Feature highlights */}
          <div className="flex flex-wrap justify-center gap-8 mb-12 text-xs tracking-[0.15em] uppercase text-nier-border/50">
            <div className="flex items-center gap-2">
              <div className="w-1.5 h-1.5 rotate-45 bg-nier-border/40" />
              <span>Real-time Canvas</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-1.5 h-1.5 rotate-45 bg-nier-border/40" />
              <span>Private Lobbies</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-1.5 h-1.5 rotate-45 bg-nier-border/40" />
              <span>Live Presence</span>
            </div>
          </div>

          {/* Diamond separator */}
          <div className="flex items-center justify-center gap-3 mb-12">
            <div className="w-2 h-2 rotate-45 border border-nier-border/40" />
            <div className="w-3 h-3 rotate-45 border border-nier-border/60 bg-nier-blackLight" />
            <div className="w-2 h-2 rotate-45 border border-nier-border/40" />
          </div>

          {/* CTA Button */}
          <button
            onClick={onGetStarted}
            className="group relative px-12 py-4 bg-transparent border border-nier-border/50 hover:border-nier-bg hover:bg-nier-bg/5 transition-all duration-300"
          >
            {/* Button corner accents */}
            <div className="absolute -top-1 -left-1 w-3 h-3 border-l border-t border-nier-border/60 group-hover:border-nier-bg transition-colors" />
            <div className="absolute -top-1 -right-1 w-3 h-3 border-r border-t border-nier-border/60 group-hover:border-nier-bg transition-colors" />
            <div className="absolute -bottom-1 -left-1 w-3 h-3 border-l border-b border-nier-border/60 group-hover:border-nier-bg transition-colors" />
            <div className="absolute -bottom-1 -right-1 w-3 h-3 border-r border-b border-nier-border/60 group-hover:border-nier-bg transition-colors" />
            
            <span className="text-sm tracking-[0.2em] uppercase text-nier-border group-hover:text-nier-bg transition-colors">
              ◇ Enter The Lobby
            </span>
          </button>

          {/* Subtext */}
          <p className="mt-8 text-nier-border/40 text-xs tracking-wider">
            Free to use • No credit card required
          </p>
        </div>

        {/* Bottom decorative line */}
        <div className="absolute bottom-20 left-1/2 -translate-x-1/2 flex items-center gap-4">
          <div className="w-16 h-[1px] bg-gradient-to-r from-transparent to-nier-border/30" />
          <div className="w-1 h-1 rotate-45 border border-nier-border/30" />
          <div className="w-16 h-[1px] bg-gradient-to-l from-transparent to-nier-border/30" />
        </div>
      </div>

      {/* CSS for firefly animation */}
      <style>{`
        @keyframes firefly {
          0% { opacity: 0; transform: translateY(0px) translateX(0px); }
          10% { opacity: 0.15; }
          30% { opacity: 0.3; transform: translateY(-20px) translateX(15px); }
          50% { opacity: 0.25; transform: translateY(-50px) translateX(-10px); }
          70% { opacity: 0.35; transform: translateY(-30px) translateX(25px); }
          90% { opacity: 0.1; transform: translateY(-10px) translateX(5px); }
          100% { opacity: 0; transform: translateY(0px) translateX(0px); }
        }
      `}</style>
    </div>
  )
}
