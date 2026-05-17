import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { ViteImageOptimizer } from 'vite-plugin-image-optimizer'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react({
      babel: {
        plugins: [['babel-plugin-react-compiler']],
      },
    }),
    ViteImageOptimizer({
      jpg: { quality: 75, progressive: true },
      jpeg: { quality: 75, progressive: true },
      png: { compressionLevel: 5 },
    }),
  ],
  build: {
    chunkSizeWarningLimit: 1000,
    rollupOptions: {
      external: ['chart.js/auto'],
      output: {
        manualChunks: {
          // Core React runtime — tiny, cached forever
          'vendor-react': ['react', 'react-dom', 'react-router-dom'],
          // Firebase — large but rarely changes
          'vendor-firebase': ['firebase/app', 'firebase/firestore', 'firebase/auth', 'firebase/storage', 'firebase/app-check'],
          // Excel export library
          'vendor-xlsx': ['xlsx-js-style'],
          // Animation library
          'vendor-framer': ['framer-motion'],
        },
      },
    },
  },
})
