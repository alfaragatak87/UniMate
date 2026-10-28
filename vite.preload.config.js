import { defineConfig } from 'vite'
import { fileURLToPath } from 'node:url'

const preloadEntry = fileURLToPath(new URL('./electron/preload.cjs', import.meta.url))

export default defineConfig({
  build: {
    copyPublicDir: false,
    emptyOutDir: false,
    minify: false,
    outDir: 'dist',
    rollupOptions: {
      input: preloadEntry,
      external: ['electron'],
      output: {
        codeSplitting: false,
        entryFileNames: 'electron-preload.cjs',
        format: 'cjs',
      },
    },
  },
})
