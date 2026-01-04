import { useState, useMemo } from 'react'
import { useGameStore } from '../store/gameStore'
import ProfileSettings from './ProfileSettings'

interface WelcomeScreenProps {
  onEnter: () => void
}

export default function WelcomeScreen({ onEnter }: WelcomeScreenProps) {
  const [showSettings, setShowSettings] = useState(false)
  const [isHovered, setIsHovered] = useState<string | null>(null)
  const { username } = useGameStore()

  // Memoize particle positions (fireflies)
  const particles = useMemo(() => 
    [...Array(15)].map((_, i) => ({
      left: `${(i * 17 + 3) % 96}%`,
      top: `${(i * 23 + 5) % 94}%`,
      duration: 8 + (i * 1.5) % 6,
      delay: i * 0.5,
    })), []
  )

  // Memoize background rectangles (trace-like elements)
  const backgroundRects = useMemo(() => 
    [...Array(10)].map((_, i) => ({
      left: `${(i * 19 + 7) % 90}%`,
      top: `${(i * 31 + 12) % 85}%`,
      width: 30 + (i * 17) % 80,
      height: 15 + (i * 13) % 40,
      rotation: (i * 7) % 15 - 7,
      delay: i * 0.3,
    })), []
  )

  return (
    <>
      <div className="w-full h-full bg-nier-black flex items-center justify-center relative overflow-hidden">
        {/* Scanline effect */}
        <div className="absolute inset-0 pointer-events-none opacity-[0.02] z-40"
          style={{
            backgroundImage: 'repeating-linear-gradient(0deg, transparent, transparent 2px, rgba(218, 212, 187, 0.1) 2px, rgba(218, 212, 187, 0.1) 4px)',
          }}
        />

        {/* Animated background grid */}
        <div 
          className="absolute inset-0 pointer-events-none opacity-10"
          style={{
            backgroundImage: `
              linear-gradient(rgba(218, 212, 187, 0.15) 1px, transparent 1px),
              linear-gradient(90deg, rgba(218, 212, 187, 0.15) 1px, transparent 1px)
            `,
            backgroundSize: '60px 60px',
          }}
        />

        {/* Background rectangles (trace-like elements) */}
        <div className="absolute inset-0 pointer-events-none overflow-hidden">
          {backgroundRects.map((rect, i) => (
            <div
              key={i}
              className="absolute border border-nier-border/[0.08] bg-nier-border/[0.02]"
              style={{
                left: rect.left,
                top: rect.top,
                width: rect.width,
                height: rect.height,
                transform: `rotate(${rect.rotation}deg)`,
                animation: `rectFloat ${12 + i % 5}s ease-in-out infinite`,
                animationDelay: `${rect.delay}s`,
              }}
            >
              {i % 3 === 0 && (
                <>
                  <div className="absolute -top-px -left-px w-2 h-2 border-l border-t border-nier-border/20" />
                  <div className="absolute -bottom-px -right-px w-2 h-2 border-r border-b border-nier-border/20" />
                </>
              )}
            </div>
          ))}
        </div>

        {/* Floating particles (fireflies) */}
        <div className="absolute inset-0 pointer-events-none overflow-hidden">
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
        
        {/* Corner brackets decoration */}
        <div className="absolute top-8 left-8 w-16 h-16 border-l border-t border-nier-border/30" />
        <div className="absolute top-8 right-8 w-16 h-16 border-r border-t border-nier-border/30" />
        <div className="absolute bottom-8 left-8 w-16 h-16 border-l border-b border-nier-border/30" />
        <div className="absolute bottom-8 right-8 w-16 h-16 border-r border-b border-nier-border/30" />

        <div className="text-center space-y-12 p-8 max-w-lg relative z-10">
          {/* Title */}
          <div className="space-y-4">
            <div className="flex items-center justify-center gap-4 mb-2">
              <div className="w-12 h-[1px] bg-gradient-to-r from-transparent to-nier-border/60" />
              <span className="text-nier-border/60 text-[10px] tracking-[0.3em] uppercase">Welcome to the</span>
              <div className="w-12 h-[1px] bg-gradient-to-l from-transparent to-nier-border/60" />
            </div>
            <h1 className="text-4xl md:text-5xl text-white tracking-[0.3em] uppercase font-light">
              DIGITAL ATRIUM
            </h1>
            <p className="text-nier-border text-xs tracking-[0.2em] uppercase">
              A quiet space for creative presence
            </p>
          </div>

          {/* Diamond separator */}
          <div className="flex items-center justify-center gap-3">
            <div className="w-20 h-[1px] bg-gradient-to-r from-transparent to-nier-border/40" />
            <div className="w-2 h-2 rotate-45 border border-nier-border/60" />
            <div className="w-20 h-[1px] bg-gradient-to-l from-transparent to-nier-border/40" />
          </div>

          {/* Welcome message */}
          <div className="space-y-6">
            <p className="text-nier-bg/80 text-sm tracking-wide">
              User: <span className="text-nier-bg border-b border-nier-border/40 pb-0.5">{username}</span>
            </p>
            
            {/* Enter Button */}
            <button
              onClick={onEnter}
              onMouseEnter={() => setIsHovered('enter')}
              onMouseLeave={() => setIsHovered(null)}
              className="relative w-full py-4 border border-nier-border/60 text-nier-bg text-xs tracking-[0.2em] uppercase transition-all duration-300 hover:bg-nier-bg hover:text-nier-black hover:border-nier-bg group"
            >
              <span className="relative z-10">Enter the Atrium</span>
              {/* Animated brackets on hover */}
              <span className={`absolute left-2 top-1/2 -translate-y-1/2 text-nier-border transition-all duration-300 ${isHovered === 'enter' ? 'opacity-100 translate-x-0' : 'opacity-0 -translate-x-2'}`}>[</span>
              <span className={`absolute right-2 top-1/2 -translate-y-1/2 text-nier-border transition-all duration-300 ${isHovered === 'enter' ? 'opacity-100 translate-x-0' : 'opacity-0 translate-x-2'}`}>]</span>
            </button>

            {/* Settings Button */}
            <button
              onClick={() => setShowSettings(true)}
              onMouseEnter={() => setIsHovered('settings')}
              onMouseLeave={() => setIsHovered(null)}
              className="relative w-full py-3 border border-nier-border/30 text-nier-border text-xs tracking-[0.15em] uppercase transition-all duration-300 hover:border-nier-border/60 hover:text-nier-bg"
            >
              <span className="relative z-10">◇ Profile Settings</span>
            </button>
          </div>

          {/* Info */}
          <div className="text-[10px] text-nier-border/50 space-y-2 tracking-wider uppercase">
            <p>◦ Drag to navigate the space</p>
            <p>◦ Click to leave traces</p>
            <p>◦ Share presence with others</p>
          </div>

          {/* Version/footer */}
          <div className="absolute -bottom-8 left-1/2 -translate-x-1/2 text-[9px] text-nier-border/30 tracking-[0.2em]">
            v.1.0.0
          </div>
        </div>

        {/* CSS for animations */}
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
          
          @keyframes rectFloat {
            0%, 100% { opacity: 0.6; transform: rotate(var(--rotation, 0deg)) translateY(0px); }
            50% { opacity: 0.9; transform: rotate(var(--rotation, 0deg)) translateY(-10px); }
          }
        `}</style>
      </div>

      {showSettings && <ProfileSettings onClose={() => setShowSettings(false)} />}
    </>
  )
}
