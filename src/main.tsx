import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.tsx'
import './index.css'
import { localDbReady } from './lib/supabase'

// Wait for local DB initialization before rendering (resolves instantly in web mode)
localDbReady.then(() => {
  ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  )
})
