import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

// Proxy /api to local backend (vercel dev default port 3000)
export default defineConfig(({ mode }) => {
  const configDir = dirname(fileURLToPath(import.meta.url))
  const repoRoot = resolve(configDir, '..')
  const rootEnv = loadEnv(mode, repoRoot, '')
  const webEnv = loadEnv(mode, configDir, '')
  const env = {
    ...rootEnv,
    ...webEnv,
    ...process.env,
  }
  const readEnv = (...keys: string[]) => {
    for (const key of keys) {
      const value = env[key]
      if (typeof value === 'string' && value.length > 0) return value
    }
    return ''
  }

  return {
    plugins: [react()],
    define: {
      'import.meta.env.VITE_UI_READ_KEY': JSON.stringify(readEnv('VITE_UI_READ_KEY', 'UI_READ_KEY')),
      'import.meta.env.VITE_API_BASE': JSON.stringify(readEnv('VITE_API_BASE')),
      'import.meta.env.VITE_ALLOWED_CHAT_IDS': JSON.stringify(readEnv('VITE_ALLOWED_CHAT_IDS')),
      'import.meta.env.VITE_ALLOWED_CHAT_ID': JSON.stringify(readEnv('VITE_ALLOWED_CHAT_ID')),
      'import.meta.env.VITE_DEFAULT_TELEGRAM_CHAT_ID': JSON.stringify(readEnv('VITE_DEFAULT_TELEGRAM_CHAT_ID')),
      'import.meta.env.VITE_SUPABASE_URL': JSON.stringify(readEnv('VITE_SUPABASE_URL', 'SUPABASE_URL')),
      'import.meta.env.VITE_SUPABASE_ANON_KEY': JSON.stringify(readEnv('VITE_SUPABASE_ANON_KEY')),
      'import.meta.env.VITE_KAKAO_JS_KEY': JSON.stringify(readEnv('VITE_KAKAO_JS_KEY', 'KAKAO_JS_KEY')),
      'import.meta.env.VITE_SHARE_PUBLIC_ORIGIN': JSON.stringify(readEnv('VITE_SHARE_PUBLIC_ORIGIN', 'WEB_PUBLIC_ORIGIN', 'UI_PUBLIC_ORIGIN')),
    },
    test: {
      environment: 'jsdom',
      globals: true,
      setupFiles: ['./src/test/setup.ts'],
      include: ['src/**/*.{test,spec}.{ts,tsx}'],
    },
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
  }
})