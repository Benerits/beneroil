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
import { readFileSync, writeFileSync, mkdirSync, readdirSync, rmSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
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
// BAYAT KAYIT TEMİZLİĞİ (öğrenildi): çöken koşuların .webm artıkları kalıyor ve
// aşağıdaki 'ilk webm'i al' seçimi ESKİ videoyu paketliyordu. Koşu başında süpür.
for (const f of readdirSync(tmpDir)) if (f.endsWith('.webm')) rmSync(join(tmpDir, f), { force: true })
const b = await chromium.launch({ channel: 'chrome' })
const ctx = await b.newContext({
  viewport: { width: W, height: H },
  deviceScaleFactor: 2,
  reducedMotion: 'no-preference',
  hasTouch: true,
})
// KAYIT: Playwright recordVideo DEĞİL — o, sürülen sayfadan FARKLI (bayat) bir kompozitör
// yüzeyini yakalayabiliyor (yaşandı: evaluate+screenshot doğru sahneyi görürken video eski
// sahneyi gösterdi). CDP Page.startScreencast, captureScreenshot ile AYNI boru hattı —
// kareleri jpg olarak toplarız, ffmpeg'e record sonunda muxlanır (make.mjs).
// TEMİZ ÇEKİM GÜVENCESİ (reload'a dayanıklı): misafir akışı sayfayı yeniden yükleyebiliyor,
// addStyleTag uçuyordu. addInitScript HER yüklenişte çalışır: misafir bayrağı + auth kapısı,
// "Neler Yeni" modalı ve kayıt CTA'sını bastıran kalıcı stil.
await ctx.addInitScript(() => {
  try {
    localStorage.setItem('benzinlik-guest-joined', '1')
    localStorage.setItem('beneloil-lang', 'tr')
  } catch { /* boş */ }
  const inject = () => {
    // "Neler Yeni" + kayıt CTA'sı çekimde görünmesin. AUTH KAPISI GİZLENMEZ:
    // gizlenirse buton tıklanamıyor ve oyun guestPaused donmasında kalıyor (öğrenildi).
    const st = document.createElement('style')
    st.textContent = '#newswrap, #guestcta, #panel { display: none !important }' // panel: müşteri kartı ekranın yarısını kaplıyordu
    document.head.appendChild(st)
    // OTO-MİSAFİR: kapı her açıldığında (ilk açılış + ₺10k teaser'ı) AYNI KAREDE
    // "Misafir devam"a bas → oyun hiç durmaz, kapı ekranda belirmeden kapanır.
    const arm = () => {
      const gate = document.getElementById('authgate')
      const btn = () => document.getElementById('gguest')
      if (!gate) return void setTimeout(arm, 200)
      const clickIfOpen = () => { if (gate.style.display === 'flex') btn()?.click() }
      new MutationObserver(clickIfOpen).observe(gate, { attributes: true, attributeFilter: ['style'] })
      const iv = setInterval(clickIfOpen, 250) // gözlemciyi ıskalayan ilk açılış için emniyet
      setTimeout(() => clearInterval(iv), 20000)
    }
    arm()
    // ---- OVERLAY MOTORU: yazı/animasyon katmanı TARAYICIDA render edilir ----
    // (ffmpeg drawtext çöpe: Baloo 2 + emoji + ₺ + spring animasyonlar burada bedava)
    const css = document.createElement('style')
    css.textContent = `
      .ov { position:fixed; left:50%; transform:translateX(-50%); z-index:2147483000;
        font-family:'Baloo 2',-apple-system,sans-serif; text-align:center; pointer-events:none;
        white-space:pre-line; line-height:1.16 }
      .ov-hook { top:72px; background:linear-gradient(180deg,#e05656,#d64545); color:#fff;
        font-weight:800; font-size:30px; padding:14px 20px; border-radius:20px;
        border-bottom:5px solid #a83636; box-shadow:0 10px 30px rgba(0,0,0,.35); max-width:86% }
      .ov-cap { bottom:200px; color:#fff; font-weight:800; font-size:31px;
        -webkit-text-stroke:1.2px #14203a;
        text-shadow:0 3px 0 #14203a,0 0 18px rgba(0,0,0,.45); max-width:90% }
      .ov-badge { top:44%; background:#ffd93b; color:#7a1d1d; font-weight:800; font-size:34px;
        padding:12px 24px; border-radius:999px; border-bottom:5px solid #d9a916;
        box-shadow:0 12px 34px rgba(0,0,0,.4) }
      .ov-wm { top:14px; left:auto; right:14px; transform:none; color:#fff; font-weight:800;
        font-size:15px; opacity:.9; text-shadow:0 2px 6px rgba(0,0,0,.6) }
      .ov-end { inset:0; left:0; transform:none; background:rgba(10,16,26,.62); width:100%;
        height:100%; display:flex; flex-direction:column; align-items:center; justify-content:center; gap:14px }
      .ov-end .t { font-family:'Baloo 2',sans-serif; font-weight:800; font-size:64px; color:#fff;
        text-shadow:0 4px 0 #d64545, 0 12px 40px rgba(0,0,0,.5) }
      .ov-end .u { font-family:'Baloo 2',sans-serif; font-weight:800; font-size:26px; color:#fff;
        background:linear-gradient(180deg,#e05656,#d64545); padding:12px 26px; border-radius:16px;
        border-bottom:5px solid #a83636 }`
    document.head.appendChild(css)
    // rAF animatörü: CSS keyframe'leri kayıt ortamında ilerlemiyor (compositor saati donuk),
    // oyunun kendi rAF'ı ise akıyor — animasyonları JS'le süreriz.
    const tween = (ms, fn, done) => {
      const t0 = performance.now()
      const step = now => { const p = Math.min(1, (now - t0) / ms); fn(p); p < 1 ? requestAnimationFrame(step) : done && done() }
      requestAnimationFrame(step)
    }
    const easeBack = p => { const c1 = 1.70158, c3 = c1 + 1; return 1 + c3 * Math.pow(p - 1, 3) + c1 * Math.pow(p - 1, 2) }
    window.__overlay = spec => {
      const d = document.createElement('div')
      const baseTf = (spec.kind === 'end' || spec.kind === 'wm') ? '' : 'translateX(-50%)'
      if (spec.kind === 'end') {
        d.className = 'ov ov-end'
        d.innerHTML = `<div class="t"></div><div class="u"></div>`
        d.querySelector('.t').textContent = spec.title || 'BENELOIL'
        d.querySelector('.u').textContent = spec.sub || 'beneloil.com'
        d.style.opacity = '0'
        document.body.appendChild(d)
        tween(450, p => { d.style.opacity = String(p) })
        const t = d.querySelector('.t'), u = d.querySelector('.u')
        tween(550, p => { t.style.transform = `scale(${Math.max(0.01, easeBack(p))})` })
        setTimeout(() => tween(550, p => { u.style.transform = `scale(${Math.max(0.01, easeBack(p))})` }), 150)
      } else {
        d.className = 'ov ov-' + (spec.kind || 'cap')
        d.textContent = spec.text || ''
        if (spec.size) d.style.fontSize = spec.size + 'px'
        if (spec.y) d.style.bottom = spec.y + 'px'
        document.body.appendChild(d)
        if (spec.kind !== 'wm') {
          d.style.opacity = '0'
          tween(480, p => {
            d.style.opacity = String(Math.min(1, p * 3))
            d.style.transform = `${baseTf} scale(${Math.max(0.01, easeBack(p))})`
          }, spec.kind === 'badge' ? () => {
            // rozet: pop sonrası kısa sallanma
            tween(1400, p => { d.style.transform = `${baseTf} rotate(${Math.sin(p * Math.PI * 6) * 2.2 * (1 - p)}deg)` })
          } : null)
        }
      }
      if (spec.dur) setTimeout(() => tween(280, p => { d.style.opacity = String(1 - p) }, () => d.remove()), spec.dur * 1000)
      return true
    }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', inject)
  else inject()
})
const page = await ctx.newPage()
page.on('load', () => console.log('[sayfa-yeniden-yuklendi]', new Date().toISOString().slice(17, 23)))
await page.goto(`http://localhost:${PORT}/?full=1`, { waitUntil: 'domcontentloaded' })
// olası kapı kalıntıları için tıklama yedekleri (görünmüyorsa sessizce geçer)
await page.waitForTimeout(1200)
await page.locator('#gguest').click().catch(() => {})
await page.waitForTimeout(700)
await page.getByText(/Continue as guest anyway|Yine de misafir olarak devam/i).first().click().catch(() => {})
await page.waitForTimeout(RECIPE.warmupMs ?? 6000) // kit + vitrin kurulumu + ilk trafik
// KAYIT BAŞLANGICI: navigasyonlar bittikten SONRA bağlan — reload öncesi bağlanan
// oturum eski renderer hedefini kaydediyordu (hayalet sahne bug'ı, yaşandı).
const cdp = await ctx.newCDPSession(page)
const frames = [] // { t: saniye, i: dosya indeksi }
let fIdx = 0
cdp.on('Page.screencastFrame', ev => {
  writeFileSync(join(tmpDir, `f-${String(fIdx).padStart(6, '0')}.jpg`), Buffer.from(ev.data, 'base64'))
  frames.push({ t: ev.metadata.timestamp, i: fIdx })
  fIdx++
  cdp.send('Page.screencastFrameAck', { sessionId: ev.sessionId }).catch(() => {})
})
await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 88, everyNthFrame: 1 })
const snap = async tag => console.log(`[state:${tag}]`, JSON.stringify(await page.evaluate(() => {
  const s = window.__dbg?.state
  return s ? { money: Math.round(s.money), benzin: Math.round(s.tanks.benzin), pumps: s.pumps, auto: s.autoPumps.size, served: s.stats?.served } : { dbg: false }
}).catch(e => ({ err: String(e).slice(0, 80) }))))
await snap('warmup-sonu')

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
    case 'eval': // serbest kanca: tarif JS'i sayfada yeni Function olarak koşulur (çok satır güvenli).
      // Promise dönerse BEKLENİR (kamera takibi / "araç varana dek" gibi süreli sahneler için).
      await page.evaluate(code => { const r = new Function(code)(); return r && typeof r.then === 'function' ? r.then(() => undefined) : undefined }, step.js); break
    case 'overlay': {
      const n = await page.evaluate(sp => { window.__overlay(sp); return document.querySelectorAll('.ov').length }, step)
      console.log('[overlay]', step.kind, '→ DOM .ov sayısı:', n)
      if (process.env.OVDEBUG && step.kind === 'hook') {
        const cs = await page.evaluate(() => {
          const d = document.querySelector('.ov-hook')
          if (!d) return { yok: true }
          const c = getComputedStyle(d)
          return { opacity: c.opacity, display: c.display, vis: c.visibility, anim: c.animationName,
                   transform: c.transform.slice(0, 40), rect: d.getBoundingClientRect().toJSON() }
        })
        console.log('[hook-stil]', JSON.stringify(cs))
        await page.screenshot({ path: '/tmp/rec-hook.png' })
      }
      break
    }
    case 'endcard': await page.evaluate(sp => window.__overlay({ kind: 'end', ...sp }), step); break
  }
}

await snap('steps-sonu')
await cdp.send('Page.stopScreencast').catch(() => {})
await page.waitForTimeout(200)
await ctx.close()
await b.close()
if (vite) vite.kill()
if (frames.length < 30) throw new Error(`çok az kare: ${frames.length}`)
console.log(`[kareler] ${frames.length} adet, ${(frames[frames.length - 1].t - frames[0].t).toFixed(1)}s`)
// concat listesi: her karenin gerçek süresiyle (değişken fps → ffmpeg sabit 30fps'e örnekler)
const t0 = frames[0].t
let lst = ''
for (let k = 0; k < frames.length; k++) {
  const dur = k < frames.length - 1 ? frames[k + 1].t - frames[k].t : 1 / 30
  lst += `file 'f-${String(frames[k].i).padStart(6, '0')}.jpg'\nduration ${Math.max(0.001, dur).toFixed(4)}\n`
}
lst += `file 'f-${String(frames[frames.length - 1].i).padStart(6, '0')}.jpg'\n`
writeFileSync(join(tmpDir, 'list.txt'), lst)
const FF = process.env.FFMPEG || 'ffmpeg'
execFileSync(FF, ['-y', '-f', 'concat', '-safe', '0', '-i', join(tmpDir, 'list.txt'),
  '-fps_mode', 'cfr', '-r', '30', '-c:v', 'libx264', '-preset', 'fast', '-crf', '18', '-pix_fmt', 'yuv420p', OUT],
  { stdio: 'ignore' })
for (const f of readdirSync(tmpDir)) rmSync(join(tmpDir, f), { force: true })
console.log(`✓ ${OUT} (${frames.length} kare)`)
