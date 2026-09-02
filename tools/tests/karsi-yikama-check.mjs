/**
 * KARŞI YIKAMANIN TONOZU + 60 FPS TAVANI — #1249 (talhamundan, 30 Ağu).
 *
 * "yıkamaların çatıları gitmiş": tonoz yarım silindiri (θ 0..π + rotation.z π/2) tünelin
 * +y ucuna yan yatmış bir kapaktı; yakın yakada arkada kaldığından çatı gibi okunuyordu,
 * karşı yakada 180° dönünce (farFlip) öne, girişin altına düşüp kayboldu. Şimdi eksen y,
 * kavis +z — her iki yakada tonoz tünelin ÜSTÜNDE (dünya bbox'ıyla ölçülür).
 * "MacBook çok ısınıyor": 120 Hz ekranda bloom zinciri 120/sn çalışıyordu → çizim 60/sn.
 *
 * Kullanım: npx tsx tools/tests/karsi-yikama-check.mjs   (dev sunucu 5311'de çalışıyor olmalı)
 */
globalThis.localStorage = {
  _d: {}, getItem(k) { return this._d[k] ?? null },
  setItem(k, v) { this._d[k] = String(v) }, removeItem(k) { delete this._d[k] },
}
Object.defineProperty(globalThis, 'navigator', { value: { language: 'tr' }, configurable: true })
import { readFileSync } from 'node:fs'
import { chromium } from 'playwright-core'
const { GameState, serializeState } = await import('../../src/state.ts')

let hata = 0
const bekle = (k, ad, ek = '') => { console.log(`${k ? '✅' : '❌'} ${ad}${ek ? ' · ' + ek : ''}`); if (!k) hata++ }
const oku = f => readFileSync(new URL('../../' + f, import.meta.url), 'utf8')

console.log('── KOD ──')
const world = oku('src/world.ts'), main = oku('src/main.ts')
const washFn = world.slice(world.indexOf('buildWash(pos?'), world.indexOf('buildCoffee(pos?'))
bekle(/CylinderGeometry\(2\.0, 2\.0, 4\.4, 20, 1, true, -Math\.PI \/ 2, Math\.PI\)/.test(washFn), 'tonoz θ −π/2..π/2 (kavis +z)')
bekle(!/arch\.rotation\.z/.test(washFn), 'tonoz artık z ekseninde döndürülmüyor (eksen = tünel yönü y)')
bekle(/if \(now - sonCizim < 15\.5\) return/.test(main), 'renderFrame 60 fps tavanı')

// ── CANLI: kasaba, tüm parseller; yakın yıkama (−16,20) + karşı yıkama (38,21) ──
const kur = () => {
  const s = new GameState()
  s.money = 5_000_000_000; s.pumps = 3; s.marketLevel = 1; s.tankLevel = 1; s.day = 90
  s.hasWash = true; s.hasWash2 = true
  const all = []; for (let c = 0; c < 6; c++) for (let r = 0; r < 3; r++) all.push(`${c},${r}`)
  s.ownedParcels = new Set(all); s.pavedParcels = new Set(all)
  s.tutorialDone = true; s.farStationOn = true
  const placedPos = { sign: [3, -20], tank: [-5, -8], gatein: [4.2, -9], market: [-2, -2], office: [-1, 7], gateout: [4.2, 13],
    'pump-0': [-2, -14], 'pump-1': [-2, 14], 'pump-2': [20, 2], gatein2: [11.6, 18], gateout2: [11.6, -20],
    wash: [-16, 20], wash2: [38, 21] }
  const placedRects = [
    { id: 'tank', cx: -5, cy: -8, w: 2, d: 2 }, { id: 'office', cx: -1, cy: 7, w: 5, d: 5.5 },
    { id: 'sign', cx: 3, cy: -20, w: 1.8, d: 1.8 }, { id: 'market', cx: -2, cy: -2, w: 6, d: 7 },
    { id: 'pump-0', cx: -2, cy: -14, w: 4.4, d: 4 }, { id: 'pump-1', cx: -2, cy: 14, w: 4.4, d: 4 }, { id: 'pump-2', cx: 20, cy: 2, w: 4.4, d: 4 },
    { id: 'wash', cx: -16, cy: 20, w: 4.5, d: 5 }, { id: 'wash2', cx: 38, cy: 21, w: 4.5, d: 5 },
  ]
  return JSON.stringify({ s: serializeState(s), at: Date.now(), placedPos, placedRot: {}, placedRects })
}
const PORT = process.env.PORT ?? '5311'
const b = await chromium.launch({ channel: 'chrome' })
const ctx = await b.newContext({ viewport: { width: 1280, height: 800 } })
const p = await ctx.newPage()
const hatalar = []
p.on('pageerror', e => hatalar.push(String(e).slice(0, 200)))
await p.addInitScript(({ payload }) => {
  localStorage.setItem('benzinlik-guest', payload)
  localStorage.setItem('benzinlik-guest-joined', '1')
  localStorage.setItem('benzinlik-music', '0')
}, { payload: kur() })
const hazir = async () => {
  for (let i = 0; i < 20; i++) {
    const ok = await p.evaluate(() => {
      document.getElementById('gguest')?.click()
      document.querySelectorAll('.backdrop.show').forEach(x => x.classList.remove('show'))
      const g = document.getElementById('authgate')
      return (!g || getComputedStyle(g).display === 'none') && typeof window.__dbg === 'object' && window.__dbg.state.day === 90
    }).catch(() => false)
    if (ok) return true
    await p.waitForTimeout(800)
  }
  return false
}
await p.goto(`http://localhost:${PORT}/`, { waitUntil: 'domcontentloaded' })
await p.waitForTimeout(7000)
bekle(await hazir(), 'kayıt misafir olarak açıldı')
await p.waitForTimeout(2000)

console.log('\n── CANLI: tonoz iki yakada da tünelin üstünde ──')
const r = await p.evaluate(() => {
  const d = window.__dbg
  const olc = id => {
    const bld = d.world.buildings.find(b => b.id === id); if (!bld) return null
    const g = bld.group; g.updateMatrixWorld(true)
    let arch = null
    g.traverse(o => { if (o.isMesh && o.geometry?.type === 'CylinderGeometry' && o.material?.transparent && Math.abs(o.material.opacity - 0.55) < 0.01) arch = o })
    if (!arch) return { id, arch: null }
    const pos = arch.geometry.attributes.position; const v = [0, 0, 0]
    let minX = 1e9, maxX = -1e9, minY = 1e9, maxY = -1e9, minZ = 1e9, maxZ = -1e9
    const e = arch.matrixWorld.elements
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i)
      const wx = e[0] * x + e[4] * y + e[8] * z + e[12], wy = e[1] * x + e[5] * y + e[9] * z + e[13], wz = e[2] * x + e[6] * y + e[10] * z + e[14]
      minX = Math.min(minX, wx); maxX = Math.max(maxX, wx); minY = Math.min(minY, wy); maxY = Math.max(maxY, wy); minZ = Math.min(minZ, wz); maxZ = Math.max(maxZ, wz)
    }
    const f = n => +n.toFixed(2)
    return { id, gx: g.position.x, gy: g.position.y, rz: f(g.rotation.z), x: [f(minX), f(maxX)], y: [f(minY), f(maxY)], z: [f(minZ), f(maxZ)] }
  }
  return { near: olc('wash'), far: olc('wash2') }
})
for (const [ad, m] of [['yakın', r.near], ['karşı', r.far]]) {
  bekle(m && m.x && Math.abs((m.x[0] + m.x[1]) / 2 - m.gx) < 0.05 && Math.abs(m.x[1] - m.x[0] - 4) < 0.1, `${ad} yıkama tonozu x'te tünele ortalı (±2)`, JSON.stringify(m))
  bekle(m && m.y && Math.abs((m.y[0] + m.y[1]) / 2 - m.gy) < 0.05 && Math.abs(m.y[1] - m.y[0] - 4.4) < 0.1, `${ad} tonoz tünel boyunca (4,4 birim, ortalı)`)
  bekle(m && m.z && m.z[0] >= 2.5 && m.z[1] >= 3.4, `${ad} tonoz ÇATIDA (z 2,55..3,45)`, m && JSON.stringify(m.z))
}
bekle(r.near && r.far && Math.abs(r.far.rz) > 3 && r.near.rz === 0, 'karşı yıkama 180° dönük (farFlip) — tonoz yine üstte')

bekle(hatalar.length === 0, 'sayfa hatası yok', hatalar.join(' | '))
await b.close()
console.log(hata ? `\n❌ ${hata} kontrol düştü` : '\n✅ karşı yıkama kontrolleri geçti')
process.exit(hata ? 1 : 0)
