/**
 * SAHNE EKRAN GÖRÜNTÜSÜ ALICI (geliştirici aracı — oyuna dahil değil)
 *
 * Sahne tasarımını körlemesine yapmayı bitirir: `npm run dev` açıkken her şubeyi
 * gerçek oyunda kurar, misafir kaydını enjekte eder, arayüzü gizler ve PNG alır.
 *
 *   npm run dev -- --port 5199
 *   node tools/shot/shoot.mjs [şube...]          (varsayılan: dört şube)
 *   PORT=5199 OUT=/tmp/shots ZOOM=0.62 node tools/shot/shoot.mjs marina
 *
 * ZOOM: kameranın zoom değeri (0.62 = en uzak, 1 = varsayılan, 2.6 = en yakın).
 * PAN:  "x,y" — kamerayı kaydırır (varsayılan 0,0).
 */
import { chromium } from 'playwright-core'
import { mkdirSync } from 'node:fs'

const PORT = process.env.PORT ?? '5199'
const OUT = process.env.OUT ?? '/tmp/shots'
const ZOOM = Number(process.env.ZOOM ?? 1)
const LOCS = process.argv.slice(2).length ? process.argv.slice(2)
  : ['otoyol', 'cevreyolu', 'marina', 'metropol']
mkdirSync(OUT, { recursive: true })

const ALL_PARCELS = []
for (let c = 0; c < 6; c++) for (let r = 0; r < 3; r++) ALL_PARCELS.push(`${c},${r}`)
const guestSave = loc => ({
  money: 75_000_000, reputation: 4.7, day: 73,
  unlockedLocs: ['kasaba', 'cevreyolu', 'otoyol', 'marina', 'metropol'],
  activeLoc: loc,
  tanks: { benzin: 250, dizel: 800, lpg: 800 },
  ownedParcels: ALL_PARCELS, pavedParcels: ALL_PARCELS,
})

const b = await chromium.launch({ channel: 'chrome' })
const page = await b.newPage({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 2 })
page.on('console', m => {
  const s = m.text()
  if (m.type() === 'error' && !/Failed to load resource/.test(s)) console.log('  [console]', s.slice(0, 200))
})

for (const loc of LOCS) {
  await page.addInitScript(save => {
    localStorage.setItem('benzinlik-guest', JSON.stringify({ s: save, at: 1 }))
    localStorage.setItem('beneloil-loc', save.activeLoc)
    localStorage.setItem('benzinlik-guest-joined', '1')
  }, guestSave(loc))
  await page.goto(`http://localhost:${PORT}/`, { waitUntil: 'domcontentloaded' })
  // gate → misafir → kayıt teşviki → "yine de misafir devam"
  await page.waitForTimeout(900)
  await page.locator('#gguest').click().catch(() => {})
  await page.waitForTimeout(900)
  await page.getByText(/Continue as guest anyway|Yine de misafir olarak devam/i)
    .first().click().catch(() => {})
  await page.waitForTimeout(600)
  await page.locator('#gguest').click().catch(() => {})
  await page.waitForTimeout(5500)   // kit indirme + ilk kareler

  // arayüzü tamamen gizle: yalnız sahne kalsın
  await page.addStyleTag({ content: `body > *:not(#app) { display:none !important }
    .backdrop, .modal, .hud, .navbar, #panel, #infocard { display:none !important }` })
  // kamerayı istenen uzaklığa getir (wheel handler window üzerinde dinliyor)
  const steps = Math.round(Math.log(ZOOM) / 0.0012 / -1000)
  for (let i = 0; i < 40; i++) {
    await page.evaluate(d => window.dispatchEvent(new WheelEvent('wheel', { deltaY: d })),
      steps > 0 ? -1000 : 1000)
    if (i % 8 === 7) await page.waitForTimeout(30)
  }
  await page.evaluate(z => {
    // kaba adımlardan sonra tam değere otur
    const ev = n => window.dispatchEvent(new WheelEvent('wheel', { deltaY: n }))
    for (let i = 0; i < 200; i++) ev(z > 1 ? -20 : 20)
  }, ZOOM)
  await page.waitForTimeout(900)
  const f = `${OUT}/${loc}.png`
  await page.screenshot({ path: f })
  console.log('✓', f)
}
await b.close()
