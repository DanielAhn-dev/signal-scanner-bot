import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Proxy /api to local backend (vercel dev default port 3000)
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      // forward any /api requests to local backend
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true,
        secure: false,
        ws: false
      }
    }
  }
})
