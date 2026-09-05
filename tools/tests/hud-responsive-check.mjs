/**
 * HUD DUYARLILIK TESTİ — "küçük ekranda üst üste binen butonlar" (oyuncu + Oğuz, 5 Eyl 2026).
 *
 * KÖK NEDEN: mobilde (≤680px) yakıt rayı `#fuelrail` position:fixed ile top:48px'e
 * çivilenmişti — "gösterge rozetleri + butonlar tek satıra sığar" varsayımıyla. 360–414px
 * portrede sığmıyor: eylem butonları ikinci satıra sarıyor ve tam rayın altına giriyordu
 * (360px'te 4, 390/414px'te 8 ikili kesişim; marka/görev rozeti sarınca onlar da).
 *
 * ÇÖZÜM (yalnız CSS/markup): butonlar `#hudacts` kapsayıcısında (masaüstünde
 * display:contents → yerleşim birebir aynı), ray akışa alındı; `.spacer` satır kırıcı.
 * Rozetler üstte serbest sarar, altında sol ray + sağda saran buton ızgarası. Flex akışında
 * olduğu için çakışma YAPISAL olarak imkânsız — bu test onu ölçerek garanti eder.
 *
 * ÖLÇÜM: HUD'daki görünür rozet/butonların getBoundingClientRect'leri; ikili kesişim = 0,
 * viewport dışına taşma = 0, buton dokunma hedefi ≥ 40px. Masaüstünde (1280) HUD alt
 * sınırı sabit kalmalı (regresyon: masaüstü görünümü değişmez).
 *
 * Dev sunucu gerekir (test:all'a EKLİ DEĞİL):
 *   npm run dev -- --port 5377   →   PORT=5377 npm run test:hud
 */
import { chromium } from 'playwright-core'

const PORT = process.env.PORT ?? '5377'
let hata = 0
const bekle = (k, ad, ek = '') => { console.log(`${k ? '✅' : '❌'} ${ad}${ek ? ' · ' + ek : ''}`); if (!k) hata++ }

const VIEWPORTS = [
  { ad: '360×740 portre', w: 360, h: 740, mobil: true },
  { ad: '390×844 portre', w: 390, h: 844, mobil: true },
  { ad: '414×896 portre', w: 414, h: 896, mobil: true },
  { ad: '740×360 yatay', w: 740, h: 360, mobil: true },
  { ad: '667×375 yatay (SE)', w: 667, h: 375, mobil: true },
  { ad: '768×1024 tablet', w: 768, h: 1024, mobil: true },
  { ad: '1280×800 masaüstü', w: 1280, h: 800, mobil: false },
]
// 'taze' = ilk gün HUD'ı; 'dolu' = rozetler sarmış, reklam butonu + batarya + marka açık (en kalabalık hâl)
const SENARYOLAR = ['taze', 'dolu']

const b = await chromium.launch({ channel: 'chrome' })
for (const vp of VIEWPORTS) for (const sen of SENARYOLAR) {
  const ctx = await b.newContext({
    viewport: { width: vp.w, height: vp.h }, deviceScaleFactor: 1, isMobile: vp.mobil, hasTouch: vp.mobil,
    userAgent: vp.mobil
      ? 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1'
      : undefined,
  })
  const p = await ctx.newPage()
  await p.addInitScript((sen) => {
    localStorage.setItem('benzinlik-guest-joined', '1')
    localStorage.setItem('benzinlik-music', '0')
    if (sen === 'dolu') {
      localStorage.setItem('benzinlik-guest', JSON.stringify({
        money: 1_234_567, day: 128, reputation: 4.6, pumps: 6, evChargers: 2, marketLevel: 2,
        loginStreak: 5, unlockedLocs: ['kasaba', 'otoyol'], activeLoc: 'otoyol',
        tanks: { benzin: 800, dizel: 800, lpg: 800 },
      }))
    }
  }, sen)
  await p.goto(`http://localhost:${PORT}/`, { waitUntil: 'domcontentloaded' })
  await p.waitForTimeout(3000)
  // misafir kapısı + açılış modalları (fixed elemanlarda offsetParent null → display ile ölç)
  for (let i = 0; i < 10; i++) {
    const temiz = await p.evaluate(() => {
      document.getElementById('gguest')?.click()
      document.querySelectorAll('.backdrop.show').forEach(x => x.classList.remove('show'))
      const gate = document.getElementById('authgate')
      return (!gate || getComputedStyle(gate).display === 'none') && document.querySelectorAll('.backdrop.show').length === 0
    })
    if (temiz) break
    await p.waitForTimeout(700)
  }
  await p.waitForTimeout(1200)
  if (sen === 'dolu') {
    await p.evaluate(() => {
      for (const id of ['streak-chip', 'hud-light-chip', 'markachip', 'battchip']) {
        const e = document.getElementById(id); if (e) e.style.display = 'flex'
      }
      const ad = document.getElementById('adbtn'); if (ad) ad.style.display = 'flex'
      const m = document.getElementById('money'); if (m) m.textContent = '1.234.567'
    })
    await p.waitForTimeout(250)
  }
  const o = await p.evaluate(() => {
    const W = innerWidth, H = innerHeight
    const gorunur = (el) => {
      const cs = getComputedStyle(el)
      if (cs.display === 'none' || cs.visibility === 'hidden' || +cs.opacity === 0) return false
      const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0
    }
    const hud = document.querySelector('.hud')
    const ogeler = [...hud.querySelectorAll(':scope > .chip, :scope > button, #fuelrail > .chip, #hudacts > button')]
      .filter(gorunur).map(el => {
        const r = el.getBoundingClientRect()
        return { ad: el.id || el.getAttribute('data-bilgi') || el.className, x: r.left, y: r.top, r: r.right, b: r.bottom,
          w: r.width, h: r.height, buton: el.tagName === 'BUTTON' }
      })
    const kesisim = []
    for (let i = 0; i < ogeler.length; i++) for (let j = i + 1; j < ogeler.length; j++) {
      const a = ogeler[i], c = ogeler[j]
      const ox = Math.min(a.r, c.r) - Math.max(a.x, c.x), oy = Math.min(a.b, c.b) - Math.max(a.y, c.y)
      if (ox > 0.5 && oy > 0.5) kesisim.push(`${a.ad}×${c.ad}`)
    }
    const tasma = ogeler.filter(q => q.x < -0.5 || q.y < -0.5 || q.r > W + 0.5 || q.b > H + 0.5).map(q => q.ad)
    const kucuk = ogeler.filter(q => q.buton && (q.w < 40 || q.h < 40)).map(q => `${q.ad} ${q.w}×${q.h}`)
    const butonlar = ogeler.filter(q => q.buton).length
    return { n: ogeler.length, butonlar, kesisim, tasma, kucuk, hudAlt: Math.max(...ogeler.map(q => q.b)) }
  })
  const etiket = `${vp.ad} / ${sen}`
  bekle(o.n >= 10 && o.butonlar >= 5, `${etiket}: HUD öğeleri ölçüldü`, `${o.n} öğe, ${o.butonlar} buton`)
  bekle(o.kesisim.length === 0, `${etiket}: ikili kesişim = 0`, o.kesisim.join(', '))
  bekle(o.tasma.length === 0, `${etiket}: viewport dışına taşma = 0`, o.tasma.join(', '))
  if (vp.w <= 680) bekle(o.kucuk.length === 0, `${etiket}: mobil buton dokunma hedefi ≥ 40px`, o.kucuk.join(', '))
  // masaüstü yerleşimi DEĞİŞMEZ: iki sıra (göstergeler + butonlar) 115px'te biter (dolu: marka satırı ile 184)
  if (vp.w === 1280) bekle(Math.abs(o.hudAlt - (sen === 'taze' ? 115 : 184)) < 1.5, `${etiket}: masaüstü HUD alt sınırı sabit`, `${o.hudAlt}px`)
  await ctx.close()
}
await b.close()
console.log(hata ? `\n❌ ${hata} hata` : '\n✅ HUD hiçbir viewport\'ta üst üste binmiyor')
process.exit(hata ? 1 : 0)
