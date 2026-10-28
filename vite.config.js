import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

import { VitePWA } from 'vite-plugin-pwa'

export const WEB_DEVELOPMENT_CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "img-src 'self' data: blob: https:",
  "font-src 'self' data: https://fonts.gstatic.com",
  "connect-src 'self' http://localhost:3000 ws://localhost:3000 ws://127.0.0.1:3000 https: wss:",
  "worker-src 'self' blob:",
  "manifest-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-src 'none'",
].join('; ')

export const WEB_PRODUCTION_CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "img-src 'self' data: blob: https:",
  "font-src 'self' data: https://fonts.gstatic.com",
  "connect-src 'self' https: wss:",
  "worker-src 'self' blob:",
  "manifest-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-src 'none'",
].join('; ')

export function createWebCspPlugin() {
  return {
    name: 'unimate-web-csp',
    order: 'post',
    transformIndexHtml: {
      order: 'post',
      handler(html, context) {
        if (context.server) return html
        return html.replace(
          '<meta charset="UTF-8" />',
          `<meta charset="UTF-8" />\n    <meta http-equiv="Content-Security-Policy" content="${WEB_PRODUCTION_CSP}" />`,
        )
      },
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  server: {
    host: '127.0.0.1',
    port: 3000,
    strictPort: true,
    headers: {
      'Content-Security-Policy': WEB_DEVELOPMENT_CSP,
    },
  },
  plugins: [
    react(),
    createWebCspPlugin(),
    VitePWA({
      registerType: 'autoUpdate',
      workbox: {
        maximumFileSizeToCacheInBytes: 5 * 1024 * 1024
      },
      devOptions: {
        enabled: true
      },
      manifest: {
        name: 'UniMate',
        short_name: 'UniMate',
        description: 'Pusat Komando Mahasiswa',
        theme_color: '#4f46e5',
        icons: [
          {
            src: 'icon.png',
            sizes: '512x512',
            type: 'image/png'
          }
        ]
      }
    })
  ],
  build: {
    emptyOutDir: false,
  },
  base: './', // For Electron production builds
})

