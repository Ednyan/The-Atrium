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
        manualChunks: {
          'pixi': ['pixi.js'],
          'supabase': ['@supabase/supabase-js'],
          'react-vendor': ['react', 'react-dom'],
        },
      },
    },
  },
  optimizeDeps: {
    include: ['pixi.js', '@supabase/supabase-js'],
    exclude: ['@tauri-apps/api', '@tauri-apps/plugin-sql', '@tauri-apps/plugin-fs', '@tauri-apps/plugin-dialog', '@tauri-apps/plugin-shell'],
  },
})
