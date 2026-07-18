import { defineConfig } from 'vite'

export default defineConfig({
  build: { target: 'es2022' }, // top-level await (model preload) için
  esbuild: { target: 'es2022' },
})
