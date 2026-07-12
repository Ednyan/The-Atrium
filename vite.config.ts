import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    port: 3000,
    open: !process.env.TAURI_ENV_FAMILY, // Don't auto-open browser when running in Tauri
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
    rollupOptions: {
      output: {
        // Vite 8's Rolldown-based bundler requires manualChunks to be a
        // function; the static object form (id -> chunk map) it replaced
        // errored with "manualChunks is not a function".
        manualChunks: (id: string) => {
          if (id.includes('pixi.js')) return 'pixi'
          if (id.includes('@supabase/supabase-js')) return 'supabase'
          if (id.includes('node_modules/react-dom') || id.includes('node_modules/react/')) return 'react-vendor'
        },
      },
    },
  },
  optimizeDeps: {
    include: ['pixi.js', '@supabase/supabase-js'],
    exclude: ['@tauri-apps/api', '@tauri-apps/plugin-sql', '@tauri-apps/plugin-fs', '@tauri-apps/plugin-dialog', '@tauri-apps/plugin-shell'],
  },
})
