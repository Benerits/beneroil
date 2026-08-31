#!/usr/bin/env node
/**
 * Meta bundle'ı için duman testi — Instant Games ortamını YERELDE taklit eder.
 *   node tools/tests/meta-smoke.mjs        (önce: npm run build:meta)
 *
 * Neden gerekli: Meta'da bundle KÖKTEN DEĞİL, sürüm klasöründen servis edilir
 * (apps-<id>.fbsbx.com/instantgames/<id>/<v>/). Mutlak '/gen/...' yolları orada 404
 * verir ve bunu ancak yüklendikten sonra fark edersin. Bu test dist-meta'yı bilerek
 * bir alt yolda yayınlar ve gerçek FBInstant SDK'sını sahte bir sürümle değiştirir.
 *
 * Kontrol ettikleri: 404 var mı, konsol hatası var mı, oyun gerçekten açıldı mı,
 * bulut kaydı FBInstant player data'sına yazıldı mı.
 */
import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { extname, join, normalize } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright-core'

const ROOT = fileURLToPath(new URL('../..', import.meta.url))
const DIST = join(ROOT, 'dist-meta')
const PREFIX = '/instantgames/28009629811966224/1' // Meta'nın servis yoluna benzer alt yol

const MIME = {
  '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.glb': 'model/gltf-binary', '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2', '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg',
}

const missing = []
const server = createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x')
  let p = decodeURIComponent(url.pathname)
  if (!p.startsWith(PREFIX)) { missing.push(p); res.writeHead(404).end('outside bundle'); return }
  p = p.slice(PREFIX.length) || '/'
  if (p === '/') p = '/index.html'
  const file = join(DIST, normalize(p).replace(/^(\.\.[/\\])+/, ''))
  try {
    const buf = await readFile(file)
    res.writeHead(200, { 'content-type': MIME[extname(file)] ?? 'application/octet-stream' }).end(buf)
  } catch { missing.push(p); res.writeHead(404).end('not found') }
})
await new Promise(r => server.listen(0, r))
const base = `http://localhost:${server.address().port}${PREFIX}/`

// ---- sahte FBInstant: gerçek SDK isteği bununla karşılanır ----
const MOCK_SDK = `
window.__fbstore = {};
window.__fblog = [];
window.FBInstant = {
  initializeAsync: () => Promise.resolve(),
  setLoadingProgress: p => window.__fblog.push('progress:' + p),
  startGameAsync: () => { window.__fblog.push('start'); return Promise.resolve() },
  getLocale: () => 'tr_TR',
  quit: () => {},
  logEvent: () => {},
  player: {
    getID: () => 'mock-player-1',
    getDataAsync: keys => Promise.resolve(Object.fromEntries(keys.map(k => [k, window.__fbstore[k]]))),
    setDataAsync: d => {
      Object.assign(window.__fbstore, d); window.__fblog.push('setData');
      // GERCEK SDK gibi kendi ucuna istek at. Bu, shim KURULDUKTAN SONRA calisir —
      // shim origin'e bakmazsa Meta'nin kendi trafigini yutar. Canli hata tam buydu.
      return fetch('https://www.facebook.com/api/graphql/', {method:'POST'})
        .then(r => r.json()).then(j => { window.__sdkEaten = !(j && j.__real) })
        .catch(() => { window.__sdkEaten = true })
        .then(() => undefined)
    },
    flushDataAsync: () => Promise.resolve(),
  },
  // reklam envanteri yok senaryosu: butonlar gizli kalmalı, oyun çalışmalı
  getInterstitialAdAsync: () => Promise.reject(new Error('no inventory')),
  getRewardedVideoAsync: () => Promise.reject(new Error('no inventory')),
};
`

const browser = await chromium.launch({ channel: 'chrome' })
const page = await browser.newPage({ viewport: { width: 414, height: 896 }, isMobile: true })
const errors = []
const failed = []
page.on('console', m => { if (m.type() === 'error') errors.push(m.text()) })
page.on('pageerror', e => errors.push('pageerror: ' + e.message))
page.on('requestfailed', r => failed.push(r.url()))
page.on('response', r => { if (r.status() >= 400) failed.push(`${r.status()} ${r.url()}`) })
// TEK yönlendirici: SDK'yı sahtele, bundle dışına çıkan her isteği kaydet ve engelle.
// (Playwright'ta sonradan eklenen route öncekini gölgeler — bu yüzden hepsi burada.)
const external = []
await page.route('**', route => {
  const u = route.request().url()
  if (u.startsWith('https://www.facebook.com/api/')) {
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ __real: true }) }); return
  }
  if (u.startsWith('https://connect.facebook.net/')) {
    route.fulfill({ status: 200, contentType: 'text/javascript', body: MOCK_SDK }); return
  }
  if (u.startsWith(base) || u.startsWith('data:') || u.startsWith('blob:')) { route.continue(); return }
  external.push(u)
  route.abort()
})

await page.goto(base, { waitUntil: 'domcontentloaded' })
let ok = true
try {
  await page.waitForSelector('#app canvas', { timeout: 30_000 })
  await page.waitForFunction(() => !document.getElementById('boot'), null, { timeout: 30_000 })
} catch (e) {
  ok = false
  console.error('HATA: oyun açılmadı —', String(e).split('\n')[0])
}

const log = await page.evaluate(() => window.__fblog ?? [])
const gate = await page.evaluate(() => !!document.getElementById('authgate'))
const accbox = await page.evaluate(() => document.getElementById('accbox')?.style.display ?? 'yok')
await page.waitForTimeout(12_000) // 10 sn'lik otomatik bulut kaydını yakala
const stored = await page.evaluate(() => Object.keys(window.__fbstore ?? {}))

console.log('\n--- Meta duman testi ---')
console.log('servis yolu      :', base)
console.log('FBInstant akışı  :', log.join(' → ') || '(yok)')
console.log('giriş ekranı     :', gate ? 'HÂLÂ VAR ✗' : 'kaldırıldı ✓')
console.log('hesap kutusu     :', accbox === 'none' ? 'gizli ✓' : `${accbox} ✗`)
console.log('player data      :', stored.length ? stored.join(', ') + ' ✓' : 'YAZILMADI ✗')
console.log('404 / hatalı yanıt:', failed.length ? '\n  ' + [...new Set(failed)].join('\n  ') : 'yok ✓')
console.log('dış istek         :', external.length ? '\n  ' + [...new Set(external)].join('\n  ') : 'yok ✓')
console.log('konsol hatası     :', errors.length ? '\n  ' + errors.slice(0, 10).join('\n  ') : 'yok ✓')
const sdkEaten = await page.evaluate(() => window.__sdkEaten === true)
console.log('SDK trafiği       :', sdkEaten ? 'SHIM YUTTU ✗ — el sıkışma ölür' : 'shim dokunmadı ✓')

// --shot <yol>: gözle doğrulama için ekran görüntüsü (gizlenen UI, yerleşim)
const shotIdx = process.argv.indexOf('--shot')
if (shotIdx > -1) {
  const out = process.argv[shotIdx + 1] ?? join(ROOT, 'meta-smoke.png')
  await page.screenshot({ path: out })
  console.log('ekran görüntüsü  :', out)
}

await browser.close()
server.close()
const fail = !ok || gate || failed.length || errors.length || !stored.length || sdkEaten
console.log(fail ? '\n✗ BAŞARISIZ' : '\n✓ GEÇTİ')
process.exit(fail ? 1 : 0)
