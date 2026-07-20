import { defineConfig } from 'vite'

export default defineConfig({
  build: { target: 'es2022' }, // top-level await (model preload) için
  esbuild: { target: 'es2022' },
  server: {
    // /api hedefi: env ile ayarlanabilir (varsayılan lokal node). Uzak backend'e karşı
    // geliştirmek için: API_TARGET=https://petrol-dev.benerits.com npm run dev
    proxy: {
      '/api': { target: process.env.API_TARGET || 'http://localhost:8787', changeOrigin: true, secure: true },
    },
  },
})
