/**
 * BETON İDEMPOTANSI + ZEMİN DECAL MERDİVENİ + DEKOR LAMBA HAVUZU — #1279 #1236 #1239 turu.
 *
 * (1) #1279 "2. istasyonda yerdeki beton otoparkların üstünde gözüküyor": otopark/tır parkı
 *     pedi (z 0.02) parsel derz çizgisiyle (z 0.02, y = ±5k) AYNI z'deydi → derz pedin
 *     üstünden geçiyordu. Ped PED_Z (0.04), çizgileri PED_CIZGI_Z (0.05).
 * (2) rebuildFromState her ünite satışında AYNI World üstünde tekrar koşar → paveParcel
 *     ikinci kez lot/derz/bordür/lamba eklemesin; markOwned betonlu parsele kazık dikmesin.
 * (3) Dekoratif sokak lambaları da PointLight ekliyordu (parsel 0,0/0,2 + kapı taşıma) →
 *     ışık sayısı değişince tüm shader'lar derleniyordu. Havuzdan alınır, sayı sabit.
 * (4) Havuz sırası: lampPoolAl → lampPoolBirak aynı sahibin ampul materyalini siliyordu;
 *     ampul kaydı havuzdan SONRA yapılmalı — gece ampul yanmalı.
 *
 * Kullanım: npx tsx tools/tests/beton-tekrar-check.mjs   (dev sunucu 5311)
 */
globalThis.localStorage = { _d: {}, getItem(k) { return this._d[k] ?? null }, setItem(k, v) { this._d[k] = String(v) }, removeItem(k) { delete this._d[k] } }
Object.defineProperty(globalThis, 'navigator', { value: { language: 'tr' }, configurable: true })
import { readFileSync } from 'node:fs'
import { chromium } from 'playwright-core'
const { GameState, serializeState } = await import('../../src/state.ts')

let hata = 0
const bekle = (k, ad, ek = '') => { console.log(`${k ? '✅' : '❌'} ${ad}${ek ? ' · ' + ek : ''}`); if (!k) hata++ }
const oku = f => readFileSync(new URL('../../' + f, import.meta.url), 'utf8')

console.log('── KOD ──')
const world = oku('src/world.ts')
bekle(/export const PED_Z = 0\.04/.test(world) && /export const PED_CIZGI_Z = 0\.05/.test(world), 'PED_Z 0.04 / PED_CIZGI_Z 0.05 tanımlı')
bekle(!/pad\.position\.z = 0\.02(?!\d)/.test(world), 'hiçbir ped artık 0.02’de değil (derzle aynı z)')
bekle(/private pavedLots = new Set<string>\(\)/.test(world) && /if \(this\.pavedLots\.has\(`\$\{c\},\$\{r\}`\)\) return/.test(world), 'paveParcel idempotent (pavedLots)')
bekle(/if \(this\.ownedMarks\.has\(key\) \|\| this\.pavedLots\.has\(key\)\) return/.test(world), 'markOwned betonlu/işaretli parseli atlar')
bekle(!/const light = new THREE\.PointLight\(0xffd9a0, 0, 18, 1\.7\)\n\s+light\.position\.set\(x \+ 0\.6, y, 3\.2\)/.test(world), 'placeLamp yeni PointLight kurmuyor')
bekle(/static readonly LAMP_POOL = 10/.test(world), 'havuz 10 (6 oyuncu + 4 dekor)')

const kur = () => {
  const s = new GameState()
  s.money = 5_000_000; s.pumps = 2; s.marketLevel = 1; s.tankLevel = 1
  s.ownedParcels = new Set(['0,1', '1,1']); s.pavedParcels = new Set(['0,1', '1,1'])
  s.tutorialDone = true; s.lampCount = 1; s.parkingCount = 2
  // parking#1 y=−14 → ped −15.55..−12.45, derz y=−15 pedin altından geçer (#1279 kayıt kalıbı)
  const placedPos = { sign: [3, -20], lamp: [-4, 8], tank: [-5, -8], gatein: [4.2, -9], market: [-2, -2], office: [-1, 7], gateout: [4.2, 13], parking: [-12, 5], 'parking#1': [-12, 0] }
  const placedRects = [
    { id: 'tank', cx: -5, cy: -8, w: 2, d: 2 }, { id: 'office', cx: -1, cy: 7, w: 5, d: 5.5 },
    { id: 'sign', cx: 3, cy: -20, w: 1.8, d: 1.8 }, { id: 'market', cx: -2, cy: -2, w: 6, d: 7 },
    { id: 'lamp', cx: -4, cy: 8, w: 1.2, d: 1.2 }, { id: 'parking', cx: -12, cy: 5, w: 8, d: 3.4 }, { id: 'parking#1', cx: -12, cy: 0, w: 8, d: 3.4 },
  ]
  return JSON.stringify({ s: serializeState(s), at: Date.now(), placedPos, placedRot: {}, placedRects })
}
const PORT = process.env.PORT ?? '5311'
const b = await chromium.launch({ channel: 'chrome' })
const p = await (await b.newContext({ viewport: { width: 1280, height: 800 } })).newPage()
const hatalar = []
p.on('pageerror', e => hatalar.push(String(e).slice(0, 200)))
await p.addInitScript(({ payload }) => { localStorage.setItem('benzinlik-guest', payload); localStorage.setItem('benzinlik-guest-joined', '1'); localStorage.setItem('benzinlik-music', '0') }, { payload: kur() })
await p.goto(`http://localhost:${PORT}/`, { waitUntil: 'domcontentloaded' })
await p.waitForTimeout(7000)
let hazir = false
for (let i = 0; i < 20 && !hazir; i++) {
  hazir = await p.evaluate(() => { document.getElementById('gguest')?.click(); document.querySelectorAll('.backdrop.show').forEach(x => x.classList.remove('show')); return typeof window.__dbg === 'object' && window.__dbg.state.parkingCount === 2 }).catch(() => false)
  if (!hazir) await p.waitForTimeout(800)
}
bekle(hazir, 'kayıt misafir olarak açıldı')
await p.waitForTimeout(1500)

const sayim = () => p.evaluate(() => {
  const d = window.__dbg; const sc = d.world.scene
  let isik = 0, lot = 0, derz = 0, bordur = 0, kazik = 0
  sc.traverse(o => {
    if (o.isPointLight) isik++
    if (!o.isMesh || !o.geometry) return
    const g = o.geometry
    if (g.type === 'PlaneGeometry' && g.parameters.width === 11.5 && (g.parameters.height === 14 || g.parameters.height === 20)) lot++
    if (g.type === 'PlaneGeometry' && g.parameters.height === 0.06) derz++
    if (g.type === 'BoxGeometry' && Math.abs(o.scale.z - 0.13) < 1e-6 && (Math.abs(o.scale.x - 0.18) < 1e-6 || Math.abs(o.scale.y - 0.18) < 1e-6)) bordur++
    if (g.type === 'CylinderGeometry' && (Math.abs(g.parameters.height - 0.65) < 1e-6 || Math.abs(o.scale.y - 0.65) < 1e-6 || Math.abs(o.scale.z - 0.65) < 1e-6)) kazik++
  })
  const n = d.world.buildings.length
  return { isik, lot, derz, bordur, kazik, n }
})

console.log('\n── CANLI 1: otopark pedi derzin ÜSTÜNDE ──')
const ped = await p.evaluate(() => {
  const d = window.__dbg
  const out = {}
  for (const bld of d.world.buildings) {
    if (!bld.id.startsWith('parking')) continue
    const zs = []
    bld.group.traverse(o => { if (o.isMesh && o.geometry?.type === 'PlaneGeometry') zs.push(+o.position.z.toFixed(3)) })
    out[bld.id] = { pedZ: Math.min(...zs), cizgiZ: Math.max(...zs) }
  }
  let derzZ = null
  d.world.scene.traverse(o => { if (o.isMesh && o.geometry?.type === 'PlaneGeometry' && o.geometry.parameters.height === 0.06) derzZ = +o.position.z.toFixed(3) })
  return { out, derzZ }
})
bekle(ped.derzZ === 0.02, 'derz çizgisi 0.02', `${ped.derzZ}`)
bekle(Object.values(ped.out).every(v => v.pedZ >= ped.derzZ + 0.019), 'her otopark pedi derzden ≥0.02 yukarıda', JSON.stringify(ped.out))
bekle(Object.values(ped.out).every(v => v.cizgiZ > v.pedZ), 'park çizgileri pedin üstünde')

console.log('\n── CANLI 2: satış → rebuildFromState tekrar koşar; beton/derz/bordür/ışık SAYISI değişmez ──')
const once = await sayim()
await p.evaluate(() => { window.__dbg.sec('parking'); window.__dbg.ui.onSell('parking') })
await p.waitForTimeout(500)
const sonra = await sayim()
bekle(sonra.n === once.n - 1, 'bir otopark yıkıldı', `${once.n}→${sonra.n}`)
for (const k of ['isik', 'lot', 'derz', 'bordur', 'kazik']) bekle(sonra[k] === once[k], `${k} sayısı sabit`, `${once[k]}→${sonra[k]}`)
// bir tur daha: rebuild doğrudan
await p.evaluate(() => window.__dbg.place.rebuild())
const sonra2 = await sayim()
for (const k of ['lot', 'derz', 'bordur', 'isik']) bekle(sonra2[k] === once[k], `ikinci rebuild sonrası ${k} sabit`, `${once[k]}→${sonra2[k]}`)

console.log('\n── CANLI 3: arsa alımı (0,0 → dekor lamba) ışık sayısını DEĞİŞTİRMEZ; kazık→beton temiz ──')
await p.evaluate(() => window.__dbg.kayit.arsaAl(0, 0, false))
const kazikli = await sayim()
bekle(kazikli.kazik > sonra2.kazik, 'betonsuz arsa kazıklandı', `${sonra2.kazik}→${kazikli.kazik}`)
await p.evaluate(() => window.__dbg.kayit.arsaAl(0, 0, true))
const betonlu = await sayim()
bekle(betonlu.kazik === sonra2.kazik, 'beton dökülünce kazıklar kalktı', `${kazikli.kazik}→${betonlu.kazik}`)
bekle(betonlu.lot === sonra2.lot + 1, 'bir lot eklendi', `${sonra2.lot}→${betonlu.lot}`)
bekle(betonlu.isik === once.isik, 'ışık sayısı arsa alımında SABİT (dekor lamba havuzdan)', `${once.isik}→${betonlu.isik}`)
const havuz = await p.evaluate(() => window.__dbg.world.lampPoolDurum())
bekle(havuz.includes('dekor:5.45,-20') && havuz.includes('lamp'), 'havuzda dekor lamba + oyuncu lambası', JSON.stringify(havuz))
await p.evaluate(() => window.__dbg.place.rebuild())
const tekrar = await sayim()
bekle(tekrar.lot === betonlu.lot && tekrar.isik === betonlu.isik && tekrar.kazik === betonlu.kazik, 'rebuild sonrası (0,0 dahil) sayılar sabit', JSON.stringify(tekrar))
bekle((await p.evaluate(() => window.__dbg.world.lampPoolDurum())).filter(x => x === 'dekor:5.45,-20').length === 1, 'dekor lamba havuzda tek sahip (kopya yok)')

console.log('\n── CANLI 4: gece ampuller yanıyor (havuz sırası) ──')
const gece = await p.evaluate(async () => {
  const d = window.__dbg
  d.saat(0.75)
  await new Promise(r => setTimeout(r, 1200))
  const out = {}
  for (const bld of d.world.buildings) {
    if (!bld.id.startsWith('lamp')) continue
    bld.group.traverse(o => { if (o.isMesh && o.geometry?.type === 'SphereGeometry') out[bld.id] = +o.material.emissiveIntensity.toFixed(2) })
  }
  let isikli = 0
  d.world.scene.traverse(o => { if (o.isPointLight && o.intensity > 0) isikli++ })
  return { out, isikli }
})
bekle(Object.values(gece.out).every(v => v > 0.5), 'oyuncu lambası ampulü gece parlıyor', JSON.stringify(gece.out))
bekle(gece.isikli >= 4, 'gece yanan PointLight ≥ 4 (dekor ±5.5, −20 + oyuncu)', `${gece.isikli}`)

bekle(hatalar.length === 0, 'sayfa hatası yok', hatalar.join(' | '))
await b.close()
console.log(hata ? `\n❌ ${hata} kontrol düştü` : '\n✅ beton/decal/dekor-lamba kontrolleri geçti')
process.exit(hata ? 1 : 0)
