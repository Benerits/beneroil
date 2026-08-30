/** Tank silosunun seviyeye göre görüntüsünü yakalar (mobil-check.mjs kalıbı + ?full=1 __dbg köprüsü). */
import { writeFileSync } from 'node:fs'
import { chromium } from 'playwright-core'

const PORT = process.env.PORT ?? '5311'
const OUT = process.env.OUT ?? '/private/tmp/claude-502/-Users-benerits-Desktop-benerits-beneroil/9297bd4c-6569-4729-806b-9f0640d6fc10/scratchpad'

const b = await chromium.launch({ channel: 'chrome' })
const ctx = await b.newContext({ viewport: { width: 1100, height: 800 } })
const p = await ctx.newPage()
const hatalar = []
p.on('pageerror', e => hatalar.push(String(e).slice(0, 300)))
p.on('console', m => { if (m.type() === 'error' && !/Failed to load resource|favicon|api\//.test(m.text())) hatalar.push(m.text().slice(0, 300)) })

await p.addInitScript(() => { localStorage.setItem('benzinlik-music', '0') })
await p.goto(`http://localhost:${PORT}/?full=1`, { waitUntil: 'domcontentloaded' })
await p.waitForFunction(() => !!window.__dbg?.world, null, { timeout: 60000 })
await p.waitForTimeout(7000)
// açılış modallarını + TÜM DOM arayüzünü gizle: sadece 3B sahne kalsın
for (let i = 0; i < 6; i++) {
  const temiz = await p.evaluate(() => {
    document.getElementById('gguest')?.click()
    document.querySelectorAll('.backdrop.show').forEach(x => x.classList.remove('show'))
    const g = document.getElementById('authgate')
    return (!g || getComputedStyle(g).display === 'none') && document.querySelectorAll('.backdrop.show').length === 0
  })
  if (temiz) break
  await p.waitForTimeout(700)
}
await p.evaluate(() => {
  for (const el of Array.from(document.body.children)) {
    if (!el.querySelector?.('canvas') && el.tagName !== 'CANVAS') el.style.display = 'none'
  }
  document.querySelectorAll('#authgate,.backdrop,#hud,.hud,.topbar,.toolbar').forEach(e => e.style.display = 'none')
})

const rapor = []
for (const lv of [0, 1, 2, 3]) {
  const bilgi = await p.evaluate((lv) => {
    const d = window.__dbg
    d.world.upgradeTankVisual(lv)
    d.world.updateTankFill({ benzin: 0.85, dizel: 0.45, lpg: 0.12 })
    const a = d.world.tankAnchor
    d.cine.setCam(a.x + 0.45, a.y + 0.45, 2.4)
    const g = d.world.tankGroup
    let mesh = 0, maxZ = 0
    g.traverse(o => {
      if (o.isMesh) {
        mesh++
        o.updateWorldMatrix(true, false)
        const box = new (window.__dbg.world.scene.constructor === Object ? Object : Object)()
        void box
      }
    })
    // gövde yüksekliği: ilk tankın çocuklarının en yüksek z'si
    for (const t of g.children) {
      if (t.isGroup) for (const c of t.children) maxZ = Math.max(maxZ, c.position.z + (c.scale?.y ?? 0) / 2)
    }
    return { seviye: lv, tankGrup: g.children.length, mesh, maxZ: +maxZ.toFixed(2) }
  }, lv)
  await p.waitForTimeout(1200)
  const png = await p.screenshot({ clip: { x: 330, y: 80, width: 480, height: 420 } })
  writeFileSync(`${OUT}/silo-lv${lv}.png`, png)
  rapor.push({ ...bilgi, kb: Math.round(png.length / 1024) })
}
console.log(JSON.stringify(rapor, null, 1))
console.log('HATALAR:', hatalar.slice(0, 4))
await b.close()
