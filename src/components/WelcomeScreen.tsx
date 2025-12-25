import { useState } from 'react'
import { useGameStore } from '../store/gameStore'
import ProfileSettings from './ProfileSettings'

interface WelcomeScreenProps {
  onEnter: () => void
}

export default function WelcomeScreen({ onEnter }: WelcomeScreenProps) {
  const [showSettings, setShowSettings] = useState(false)
  const [isHovered, setIsHovered] = useState<string | null>(null)
  const { username } = useGameStore()

  return (
    <>
      <div className="w-full h-full bg-nier-black flex items-center justify-center relative overflow-hidden">
        {/* Scanline effect */}
        <div className="absolute inset-0 pointer-events-none opacity-[0.03]"
          style={{
            backgroundImage: 'repeating-linear-gradient(0deg, transparent, transparent 2px, rgba(218, 212, 187, 0.1) 2px, rgba(218, 212, 187, 0.1) 4px)',
          }}
        />
        
        {/* Corner brackets decoration */}
        <div className="absolute top-8 left-8 w-16 h-16 border-l border-t border-nier-border/30" />
        <div className="absolute top-8 right-8 w-16 h-16 border-r border-t border-nier-border/30" />
        <div className="absolute bottom-8 left-8 w-16 h-16 border-l border-b border-nier-border/30" />
        <div className="absolute bottom-8 right-8 w-16 h-16 border-r border-b border-nier-border/30" />

        <div className="text-center space-y-12 p-8 max-w-lg relative">
          {/* Title */}
          <div className="space-y-4">
            <div className="flex items-center justify-center gap-4 mb-2">
              <div className="w-12 h-[1px] bg-gradient-to-r from-transparent to-nier-border/60" />
              <span className="text-nier-border/60 text-[10px] tracking-[0.3em] uppercase">Welcome to</span>
              <div className="w-12 h-[1px] bg-gradient-to-l from-transparent to-nier-border/60" />
            </div>
            <h1 className="text-4xl md:text-5xl text-nier-bg tracking-[0.3em] uppercase font-light">
              THE LOBBY
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
              <span className="relative z-10">Enter the Lobby</span>
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
            <p>◦ Right-click to leave traces</p>
            <p>◦ Share presence with others</p>
          </div>

          {/* Version/footer */}
          <div className="absolute -bottom-8 left-1/2 -translate-x-1/2 text-[9px] text-nier-border/30 tracking-[0.2em]">
            v.1.0.0
          </div>
        </div>
      </div>

      {showSettings && <ProfileSettings onClose={() => setShowSettings(false)} />}
    </>
  )
}
