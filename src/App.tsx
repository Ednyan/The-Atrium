import { useState } from 'react'
import LobbyScene from './components/LobbyScene'
import WelcomeScreen from './components/WelcomeScreen'
import { useGameStore } from './store/gameStore'

function App() {
  const { username } = useGameStore()
  const [hasEntered, setHasEntered] = useState(false)

  const handleEnter = () => {
    setHasEntered(true)
  }

  if (!hasEntered || !username) {
    return <WelcomeScreen onEnter={handleEnter} />
  }

  return <LobbyScene />
}

export default App
