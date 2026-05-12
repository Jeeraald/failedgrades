import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react({
      babel: {
        plugins: [['babel-plugin-react-compiler']],
      },
    }),
  ],
  build: {
    // Drop console.debug and console.log in production bundles so debug
    // output (which can expose internal data) is never shipped to end users.
    // console.warn and console.error are kept for operational visibility.
    esbuild: {
      drop: [],
      pure: ['console.debug', 'console.log'],
    },
  },
})
