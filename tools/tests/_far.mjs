import { chromium } from 'playwright-core'
const b = await chromium.launch({ channel: 'chrome' })
const p = await b.newPage({ viewport: { width: 1400, height: 900 } })
await p.goto('http://localhost:5311/?full=1', { waitUntil: 'domcontentloaded' })
await p.waitForTimeout(11000)
for (let i = 0; i < 8; i++) {
  const ok = await p.evaluate(() => { document.getElementById('gguest')?.click()
    document.querySelectorAll('.backdrop.show').forEach(x => x.classList.remove('show'))
    const g = document.getElementById('authgate'); return !g || getComputedStyle(g).display === 'none' })
  if (ok) break; await p.waitForTimeout(900)
}
// karşı istasyona kamera
await p.evaluate(() => { window.__dbg?.cine?.setCam?.(12.5, 0, 1.5) })
await p.waitForTimeout(25000)
await p.screenshot({ path: '/tmp/far.png' })
console.log(await p.evaluate(() => {
  const w = window.__dbg.world
  return { gateIn2: [w.gateIn2.x, w.gateIn2.y], gateOut2: [w.gateOut2.x, w.gateOut2.y],
           farAcik: w.farStationOn, pompaX: w.pumpSlots.slice(0,4).map(v=>+v.x.toFixed(1)) }
}))
await b.close()
