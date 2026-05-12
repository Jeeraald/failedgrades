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
  // Mark console.debug/log as pure (side-effect-free) so esbuild can tree-shake
  // them out of production bundles. console.warn/error are kept for visibility.
  esbuild: {
    pure: ['console.debug', 'console.log'],
  },
})
