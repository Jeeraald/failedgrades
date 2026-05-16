import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import viteImagemin from 'vite-plugin-imagemin'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react({
      babel: {
        plugins: [['babel-plugin-react-compiler']],
      },
    }),
    viteImagemin({
      mozjpeg: { quality: 75, progressive: true },
      optipng: { optimizationLevel: 5 },
      svgo: { plugins: [{ name: 'removeViewBox', active: false }] },
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
