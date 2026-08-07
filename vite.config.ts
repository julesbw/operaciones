import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig({
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          react: ['react', 'react-dom'],
          storage: ['dexie'],
          supabase: ['@supabase/supabase-js'],
        },
      },
    },
  },
  plugins: [
    react(),
    tailwindcss(),
  ],
})
