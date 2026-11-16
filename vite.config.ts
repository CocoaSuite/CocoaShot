import { defineConfig } from 'vite'

export default defineConfig({
  base: './',
  build: { outDir: 'dist', assetsDir: 'assets', chunkSizeWarningLimit: 4000, target: 'es2022' },
  worker: { format: 'es' },
  // The AVIF encoder finds its .wasm file next to itself; pre-bundling would move the code away from it.
  optimizeDeps: { exclude: ['@jsquash/avif'] },
  server: { port: 5190 }
})
