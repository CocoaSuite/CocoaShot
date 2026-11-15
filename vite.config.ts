import { defineConfig } from 'vite'

export default defineConfig({
  base: './',
  build: { outDir: 'dist', assetsDir: 'assets', chunkSizeWarningLimit: 4000, target: 'es2022' },
  worker: { format: 'es' },
  server: { port: 5190 }
})
