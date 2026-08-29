import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.tsx'
import ToastHost from './components/ToastHost.tsx'
import StartupFailure from './components/StartupFailure.tsx'
import './index.css'
import { localDbReady } from './lib/supabase'

const root = ReactDOM.createRoot(document.getElementById('root')!)

// Wait for local DB initialization before rendering (resolves instantly in web mode)
localDbReady.then(() => {
  root.render(
    <React.StrictMode>
      <App />
      {/* Sibling of App, not inside it: App returns a different screen from
          each of its many early returns, so there is no single place within
          it that stays mounted across every route. */}
      <ToastHost />
    </React.StrictMode>,
  )
}).catch((error) => {
  console.error('Failed to initialize Digital Atrium:', error)

  // A vault another session already has open is a normal thing to run into --
  // one fast user switch away on a shared machine -- so it gets a sentence
  // saying so, in the reader's own language, rather than the raw failure this
  // screen used to print for everything alike. VAULT_IN_USE is returned
  // verbatim by prepare_live_database precisely so it can be recognised here.
  const message = error instanceof Error ? error.message : String(error)
  const reason = message.includes('VAULT_IN_USE') ? 'vault-in-use' : 'unknown'

  root.render(
    <React.StrictMode>
      <StartupFailure reason={reason} detail={message} />
    </React.StrictMode>,
  )
})
