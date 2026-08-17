/**
 * OYUN KAYDI — TikTok/Shorts için dikey (9:16) gameplay yakalar.
 *
 * `?full=1` vitrin modunda tam kurulu istasyonu mobil viewport'ta (540×960) açar,
 * tarifteki senaryo adımlarını (zoom, pan, rush, patlama...) oynatır ve
 * Playwright'ın yerleşik video kaydıyla webm üretir. Vite dev sunucusunu kendisi
 * başlatır (PORT env ile mevcut bir sunucuya da bağlanabilir).
 *
 *   node tools/tiktok/record.mjs <recipe.json> <cikis.webm>
 */
import { chromium } from 'playwright-core'
import { spawn } from 'node:child_process'
import { readFileSync, mkdirSync, renameSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'

const RECIPE = JSON.parse(readFileSync(process.argv[2], 'utf8'))
const OUT = process.argv[3] || '/tmp/tiktok-raw.webm'
const PORT = process.env.PORT || '5203'
const W = 540, H = 960 // mobil CSS kırılımı (≤620) → oyunun gerçek mobil arayüzü

// ---- vite dev (gerekirse) ----
let vite = null
async function ensureServer() {
  const up = async () => (await fetch(`http://localhost:${PORT}/`).then(r => r.ok).catch(() => false))
  if (await up()) return
  vite = spawn('npx', ['vite', '--port', PORT], { stdio: 'ignore', detached: false })
  for (let i = 0; i < 60; i++) { if (await up()) return; await new Promise(r => setTimeout(r, 500)) }
  throw new Error('vite açılmadı')
}

await ensureServer()
const tmpDir = join(dirname(OUT), 'pw-video-tmp')
mkdirSync(tmpDir, { recursive: true })
const b = await chromium.launch({ channel: 'chrome' })
const ctx = await b.newContext({
  viewport: { width: W, height: H },
  deviceScaleFactor: 2,
  // KAYIT BOYUTU = VIEWPORT (birebir): büyük verilirse Playwright sayfayı köşeye koyup
  // gri dolgu basıyor. 1080×1920'ye yükseltmeyi ffmpeg yapar (make.mjs scale).
  recordVideo: { dir: tmpDir, size: { width: W, height: H } },
  hasTouch: true,
})
// TEMİZ ÇEKİM GÜVENCESİ (reload'a dayanıklı): misafir akışı sayfayı yeniden yükleyebiliyor,
// addStyleTag uçuyordu. addInitScript HER yüklenişte çalışır: misafir bayrağı + auth kapısı,
// "Neler Yeni" modalı ve kayıt CTA'sını bastıran kalıcı stil.
await ctx.addInitScript(() => {
  try {
    localStorage.setItem('benzinlik-guest-joined', '1')
    localStorage.setItem('beneloil-lang', 'tr')
  } catch { /* boş */ }
  const inject = () => {
    const st = document.createElement('style')
    st.textContent = '#authgate, #newswrap, #guestcta { display: none !important }'
    document.head.appendChild(st)
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', inject)
  else inject()
})
const page = await ctx.newPage()
await page.goto(`http://localhost:${PORT}/?full=1`, { waitUntil: 'domcontentloaded' })
// olası kapı kalıntıları için tıklama yedekleri (görünmüyorsa sessizce geçer)
await page.waitForTimeout(1200)
await page.locator('#gguest').click().catch(() => {})
await page.waitForTimeout(700)
await page.getByText(/Continue as guest anyway|Yine de misafir olarak devam/i).first().click().catch(() => {})
await page.waitForTimeout(RECIPE.warmupMs ?? 6000) // kit + vitrin kurulumu + ilk trafik

// ---- senaryo adımları ----
const wheel = async (n, dy) => { for (let i = 0; i < n; i++) { await page.mouse.wheel(0, dy); await page.waitForTimeout(30) } }
const drag = async (x0, y0, x1, y1, ms) => {
  await page.mouse.move(x0, y0); await page.mouse.down()
  const steps = Math.max(8, Math.floor(ms / 30))
  for (let i = 1; i <= steps; i++) {
    await page.mouse.move(x0 + (x1 - x0) * i / steps, y0 + (y1 - y0) * i / steps)
    await page.waitForTimeout(ms / steps)
  }
  await page.mouse.up()
}
for (const step of RECIPE.steps ?? []) {
  switch (step.do) {
    case 'wait': await page.waitForTimeout(step.ms); break
    case 'zoom': await wheel(step.n ?? 10, step.dy ?? -240); break     // dy<0 yaklaş
    case 'pan': await drag(step.from[0], step.from[1], step.to[0], step.to[1], step.ms ?? 900); break
    case 'rush': // müşteri patlaması etkinliğini tetikle (rozet + jingle + yoğun trafik)
      await page.evaluate(sec => { window.__dbg.state.promo = { type: 'rush', until: Date.now() + sec * 1000 } }, step.sec ?? 60)
      break
    case 'cheapFuel':
      await page.evaluate(sec => { window.__dbg.state.promo = { type: 'cheapFuel', until: Date.now() + sec * 1000 } }, step.sec ?? 60)
      break
    case 'money': await page.evaluate(m => { window.__dbg.state.money = m }, step.amount ?? 1_000_000); break
    case 'eval': await page.evaluate(step.js); break                   // serbest kanca (dikkatli kullan)
  }
}

await page.waitForTimeout(300)
await ctx.close() // videoyu diske yazar
await b.close()
if (vite) vite.kill()
const produced = readdirSync(tmpDir).find(f => f.endsWith('.webm'))
if (!produced) throw new Error('video üretilmedi')
renameSync(join(tmpDir, produced), OUT)
console.log(`✓ ${OUT}`)
