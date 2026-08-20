import { defineConfig, type Plugin } from 'vite'

/**
 * mode=meta → Facebook Instant Games bundle'ı (tek kaynak, ayrı hedef).
 * Yaptıkları:
 *  - giriş noktasını src/main-meta.ts'e çevirir (FBInstant init bitmeden oyun yüklenmez)
 *  - FBInstant SDK'yı head'e enjekte eder — SDK Facebook CDN'inden GELMEK ZORUNDA,
 *    bundle'a gömülemez (platform kuralı)
 *  - dış ağ bağımlılıklarını (Google Fonts) düşürür: NEZP altında dış istek istemiyoruz
 *  - mutlak '/x' varlık yollarını göreliye çevirir; bundle kökten değil sürüm
 *    klasöründen servis ediliyor (apps-<id>.fbsbx.com/instantgames/<id>/<v>/)
 *  - yasal linkleri barındırılan tam URL'lere çevirir (iframe içinde '/terms' anlamsız)
 */
const LEGAL_BASE = 'https://petrol.benerits.com'
const FBINSTANT_SDK = 'https://connect.facebook.net/en_US/fbinstant.8.0.js'

function metaHtml(): Plugin {
  return {
    name: 'beneloil-meta-html',
    transformIndexHtml: {
      order: 'pre',
      handler(html: string) {
        return html
          // 1) yasal linkler: barındırılan tam URL
          .replace(/href="\/(terms|privacy)"/g, `href="${LEGAL_BASE}/$1.html"`)
          // 2) mutlak varlık yolları → göreli ('/src/' giriş noktası hariç, onu Vite çözüyor)
          .replace(/(href|src)="\/(?!src\/)/g, '$1="./')
          // 3) dış font isteği yok — sistem fontuna düşer (bkz. tools/build-meta.mjs notu)
          .replace(/[ \t]*<link rel="preconnect"[^>]*>\n?/g, '')
          .replace(/[ \t]*<link href="https:\/\/fonts\.googleapis\.com[^>]*>\n?/g, '')
          // 4) FBInstant SDK — oyun modülünden ÖNCE yüklenmeli
          .replace('</head>', `  <script src="${FBINSTANT_SDK}"></script>\n</head>`)
          // 5) giriş noktası
          .replace('<script type="module" src="/src/main.ts"></script>',
                   '<script type="module" src="/src/main-meta.ts"></script>')
      },
    },
  }
}

export default defineConfig(({ mode }) => {
  const meta = mode === 'meta'
  return {
    base: meta ? './' : '/',
    plugins: meta ? [metaHtml()] : [],
    build: {
      target: 'es2022', // top-level await (model preload, main-meta) için
      outDir: meta ? 'dist-meta' : 'dist',
      emptyOutDir: true,
    },
    esbuild: { target: 'es2022' },
    server: {
      // /api hedefi: env ile ayarlanabilir (varsayılan lokal node). Uzak backend'e karşı
      // geliştirmek için: API_TARGET=https://petrol-dev.benerits.com npm run dev
      proxy: {
        '/api': { target: process.env.API_TARGET || 'http://localhost:8787', changeOrigin: true, secure: true },
      },
    },
  }
})
