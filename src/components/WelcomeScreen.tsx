import { useState } from 'react'
import { useGameStore } from '../store/gameStore'

interface WelcomeScreenProps {
  onEnter: () => void
}

export default function WelcomeScreen({ onEnter }: WelcomeScreenProps) {
  const [inputValue, setInputValue] = useState('')
  const { setUsername, setUserId } = useGameStore()

  const handleEnter = () => {
    if (inputValue.trim()) {
      const userId = `user_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
      setUsername(inputValue.trim())
      setUserId(userId)
      onEnter()
    }
  }

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleEnter()
    }
  }

  return (
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

        {/* Input */}
        <div className="space-y-4">
          <input
            type="text"
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            onKeyPress={handleKeyPress}
            placeholder="Enter your display name..."
            maxLength={20}
            className="w-full px-4 py-3 bg-lobby-muted border-2 border-lobby-accent/30 rounded-lg text-lobby-light placeholder-lobby-light/40 focus:outline-none focus:border-lobby-accent transition-colors"
            autoFocus
          />
          
          <button
            onClick={handleEnter}
            disabled={!inputValue.trim()}
            className="w-full px-6 py-3 bg-lobby-accent hover:bg-lobby-accent/80 disabled:bg-lobby-accent/30 text-lobby-light font-semibold rounded-lg transition-all transform hover:scale-105 disabled:scale-100 disabled:cursor-not-allowed"
          >
            Enter the Lobby
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
  )
}
