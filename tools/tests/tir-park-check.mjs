/**
 * TIR PARKI TESTİ — "karşı tır parkı atanamıyor" (#269 #1249).
 *
 * BULUNAN HATA: world.getTruckSpots() YALNIZ 'truckpark' id'li binayı arıyordu ve
 * bulamayınca BOŞ dizi dönüyordu. Karşı yaka tır parkı 'truckpark2' olarak kayıtlı —
 * yani hiç park yeri üretmiyordu, tır oraya ASLA yanaşamıyordu. Oyuncu karşı tır
 * parkının parasını ödüyor, bina duruyor, tır parkı olarak hiç işlev görmüyordu.
 *
 * NEDEN TESTLER YAKALAMADI: karsi-yaka-check "karşı tır parkı pasif gelir üretti"
 * diyordu — ama ölçtüğü şey state.tick() geliriydi, tırlar değil. Yeşil bir test,
 * çalışmayan bir özelliği örtüyordu.
 *
 * cars.ts tarafı ZATEN hazırdı (yaka eşleşmesi + yol aynalaması yazılı); eksik olan
 * tek şey beslenecek noktalardı.
 *
 * Kullanım:  npm run dev -- --port 5399   →   npx tsx tools/tests/tir-park-check.mjs
 */
import { chromium } from 'playwright-core'
import { readFileSync } from 'node:fs'

let pass = 0, fail = 0
const check = (ad, ok, ek = '') => { console.log(`  ${ok ? '✓' : '✗'} ${ad}${ek ? ' — ' + ek : ''}`); ok ? pass++ : fail++ }
const oku = f => readFileSync(new URL('../../' + f, import.meta.url), 'utf8')

console.log('== 1) Kaynak: para DOĞRU kumbaraya yazılıyor mu ==')
const main_ts = oku('src/main.ts')
check('onTruckParked artık koşulsuz truckpark\'a yazmıyor',
  !/onTruckParked: \(\) => \{\s*const fee[\s\S]{0,120}?addPending\('truckpark',/.test(main_ts))
check('park eden tırın YAKASINA bakılıyor', /car\.station === 'far' && state\.hasTruckPark2/.test(main_ts))
check('karşı yakada truckpark2 kumbarasına yazılıyor',
  /addPending\(karsi \? 'truckpark2' : 'truckpark'/.test(main_ts))
const world_ts = oku('src/world.ts')
check('getTruckSpots iki binayı da geziyor', /for \(const id of \['truckpark', 'truckpark2'\]\)/.test(world_ts))

const PORTLAR = process.env.PORT ? [process.env.PORT] : ['5399', '5311', '5173', '5174']
let PORT = null
for (const p of PORTLAR) {
  try { if ((await fetch(`http://localhost:${p}/`, { signal: AbortSignal.timeout(1500) })).ok) { PORT = p; break } }
  catch { /* sıradaki */ }
}
if (!PORT) {
  console.log(`\n❌ dev sunucu bulunamadı (${PORTLAR.join(', ')}) — SAHNE ÖLÇÜMÜ KOŞMADI.`)
  console.log('   Bu bölüm testin asıl kanıtı; atlanırsa sonuç GEÇTİ sayılmaz.')
  console.log(`   Çalıştır: npm run dev -- --port ${PORTLAR[0]}`)
  process.exit(1)
}

const b = await chromium.launch({ channel: 'chrome' })
const p = await b.newPage()
const hatalar = []
p.on('pageerror', e => hatalar.push(e.message))
// ?full=1 her şeyi kurulu başlatır — iki tır parkı da sahnede olur
await p.goto(`http://localhost:${PORT}/?full=1`, { waitUntil: 'domcontentloaded' })
await p.waitForFunction(() => !!window.__dbg?.world?.getTruckSpots, null, { timeout: 30000 })
await p.waitForTimeout(2500)

console.log('\n== 2) Sahne: iki yakada da park yeri var mı ==')
// ?full=1 KARŞI YAKA tesislerinin hiçbirini kurmuyor (bilinçli vitrin tercihi) —
// o yüzden karşı tır parkını test kendisi kuruyor. Vitrini teste uydurmak yanlış olurdu.
const r = await p.evaluate(async () => {
  const K = window.__dbg.kayit
  const d = K.yuk()
  d.s.hasTruckPark = true
  d.s.hasTruckPark2 = true
  K.yukle(d)
  await new Promise(res => setTimeout(res, 600))
  const w = window.__dbg.world, s = window.__dbg.state
  const binalar = w.buildings.map(x => x.id).filter(x => String(x).startsWith('truckpark'))
  const spots = w.getTruckSpots().map(x => ({ id: x.id, x: x.spot.x, y: x.spot.y, sx: x.stage.x }))
  return { binalar, spots, hasTP: s.hasTruckPark, hasTP2: s.hasTruckPark2 }
})
check('kurulum: iki tır parkı da açık', r.hasTP === true && r.hasTP2 === true,
  `yakın=${r.hasTP} karşı=${r.hasTP2}`)
check('iki tır parkı da sahnede', r.binalar.includes('truckpark') && r.binalar.includes('truckpark2'),
  r.binalar.join(', '))
check('park yeri üretiliyor', r.spots.length > 0, `${r.spots.length} nokta`)
const yakin = r.spots.filter(s => s.id === 'truckpark')
const karsi = r.spots.filter(s => s.id === 'truckpark2')
check('BU yaka için park yeri var', yakin.length === 3, `${yakin.length} nokta`)
check('KARŞI yaka için park yeri var (eskiden 0 idi)', karsi.length === 3, `${karsi.length} nokta`)

console.log('\n== 3) Noktalar gerçekten ayrı yakalarda mı ==')
// cars.ts yaka eşleşmesini spot.x > ROAD_X ile yapıyor; iki küme farklı tarafta olmalı.
// BOŞ KÜMEDE ORTALAMA ALMIYORUZ: ilk sürümde Math.max(1, len) bölmesi yüzünden karşı
// yakada 0 nokta varken ortalama 0 çıkıyor ve "x konumları farklı" kendiliğinden
// geçiyordu — hiçbir şey kanıtlamayan yeşil bir kontroldü.
if (!yakin.length || !karsi.length) {
  check('yaka karşılaştırması yapılabildi', false,
    `bu yaka ${yakin.length} · karşı ${karsi.length} nokta — küme boşken karşılaştırma anlamsız`)
} else {
  const ortY = yakin.reduce((a, s) => a + s.x, 0) / yakin.length
  const ortK = karsi.reduce((a, s) => a + s.x, 0) / karsi.length
  check('iki kümenin x konumu farklı', Math.abs(ortY - ortK) > 1,
    `bu yaka x≈${ortY.toFixed(1)} · karşı x≈${ortK.toFixed(1)}`)
  check('karşı yaka noktaları BU yakanın sağında', ortK > ortY,
    `${ortY.toFixed(1)} → ${ortK.toFixed(1)}`)
}
check('her noktanın kimliği var (para doğru kumbaraya gitsin)',
  r.spots.every(s => s.id === 'truckpark' || s.id === 'truckpark2'))

console.log('\n== 4) Sayfa sağlığı ==')
check('tur boyunca sayfa hatası yok', hatalar.length === 0, hatalar.slice(0, 2).join(' | '))

await b.close()
console.log(`\n${fail === 0 ? '✅' : '❌'} tır parkı: ${pass} geçti, ${fail} kaldı`)
process.exit(fail === 0 ? 0 : 1)
