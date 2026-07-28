import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.tsx'
import ToastHost from './components/ToastHost.tsx'
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

  root.render(
    <React.StrictMode>
      <div className="min-h-screen bg-[#1f1f1f] text-white flex items-center justify-center p-6">
        <div className="max-w-xl w-full border border-white/20 bg-black/40 p-6 space-y-3">
          <h1 className="text-sm tracking-[0.2em] uppercase">Digital Atrium Failed To Start</h1>
          <p className="text-sm text-white/70 leading-relaxed">
            Desktop initialization failed before the app could render.
          </p>
          <pre className="text-xs text-red-300 whitespace-pre-wrap break-words bg-black/40 p-3 border border-red-500/20">
            {error instanceof Error ? error.message : String(error)}
          </pre>
        </div>
      </div>
    </React.StrictMode>,
  )
})
