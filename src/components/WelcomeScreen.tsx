import { useState } from 'react'
import { useGameStore } from '../store/gameStore'
import ProfileSettings from './ProfileSettings'

interface WelcomeScreenProps {
  onEnter: () => void
}

export default function WelcomeScreen({ onEnter }: WelcomeScreenProps) {
  const [showSettings, setShowSettings] = useState(false)
  const { username } = useGameStore()

  return (
    <>
      <div className="w-full h-full bg-gradient-to-br from-lobby-darker via-lobby-dark to-lobby-muted flex items-center justify-center">
        <div className="text-center space-y-8 p-8 max-w-md">
          {/* Title */}
          <div className="space-y-4">
            <h1 className="text-4xl md:text-5xl font-bold text-lobby-accent animate-pulse">
              THE LOBBY
            </h1>
            <p className="text-lobby-light/80 text-sm md:text-base">
              A quiet, ambient space for creative presence
            </p>
          </div>

          {/* Welcome message */}
          <div className="space-y-4">
            <p className="text-white text-lg">
              Welcome, <span className="text-lobby-accent font-semibold">{username}</span>
            </p>
            
            <button
              onClick={onEnter}
              className="w-full px-6 py-3 bg-lobby-accent hover:bg-lobby-accent/80 text-lobby-light font-semibold rounded-lg transition-all transform hover:scale-105"
            >
              Enter the Lobby
            </button>

            <button
              onClick={() => setShowSettings(true)}
              className="w-full px-6 py-3 bg-lobby-muted border-2 border-lobby-accent/30 hover:border-lobby-accent text-lobby-light font-semibold rounded-lg transition-all"
            >
              ⚙️ Profile Settings
            </button>
          </div>

          {/* Info */}
          <div className="text-xs text-lobby-light/50 space-y-2">
            <p>• Click to move around</p>
            <p>• Leave traces and messages</p>
            <p>• Share the space with others</p>
          </div>
        </div>
      </div>

      {showSettings && <ProfileSettings onClose={() => setShowSettings(false)} />}
    </>
  )
}
