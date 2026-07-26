// SAHNE KURULUM testleri — "kit geldi ama sahneye hiç bina konmadı" sınıfını yakalar.
// Kaynak koddan yerleşim mantığını çıkarıp DETERMİNİZM ve SINIR kontrolü yapar.
// Çalıştır: npm run test:scene
import fs from 'node:fs'
import path from 'node:path'
const ROOT = new URL('../../', import.meta.url).pathname
const world = fs.readFileSync(path.join(ROOT, 'src/world.ts'), 'utf8')
const kits = fs.readFileSync(path.join(ROOT, 'src/kits.ts'), 'utf8')

let pass = 0, fail = 0
const check = (n, c, d = '') => { c ? (pass++, console.log('  ✓ ' + n)) : (fail++, console.log(`  ✗ ${n}${d ? ' — ' + d : ''}`)) }

console.log('== 1) Sahneler kite bağlı ve yedekli ==')
check('otoyol sanayi bölgesi çağrılıyor', /this\.buildIndustrialDistrict\(s\)/.test(world))
check('metropol ticari doku çağrılıyor', /this\.buildCommercialDistrict\(s\)/.test(world))
check('sanayi: kit yoksa sessizce atlanıyor (oyun durmaz)',
  /buildIndustrialDistrict[\s\S]{0,300}if \(!K\) return/.test(world))
check('metropol: kit yoksa PROSEDÜREL siluete düşüyor (boş sahne kalmaz)',
  /buildCommercialDistrict[\s\S]{0,300}if \(!K\) \{ this\.buildBlockSkyline\(s\); return \}/.test(world))
check('metropol: kit geldi ama hiç model yerleşmediyse de yedeğe düşüyor',
  /if \(placed === 0\) this\.buildBlockSkyline\(s\)/.test(world))

console.log('\n== 2) Manifest ile sahne aynı modelleri konuşuyor ==')
const kitFiles = {}
for (const m of kits.matchAll(/(\w+):\s*\{\s*dir:\s*'([^']+)',\s*files:\s*\[([\s\S]*?)\],\s*\}/g))
  kitFiles[m[1]] = [...m[3].matchAll(/'([^']+)'/g)].map(x => x[1])
const used = new Set()
for (const m of world.matchAll(/'((?:building|chimney|detail|low-detail|boat|ship|buoy|cargo)[a-z0-9-]*)'/g)) used.add(m[1])
const declared = new Set([...Object.values(kitFiles).flat()])
const missing = [...used].filter(u => !declared.has(u))
check(`sahnede kullanılan ${used.size} modelin hepsi manifestte`, missing.length === 0,
  'manifestte yok: ' + missing.slice(0, 8).join(' · '))

console.log('\n== 3) Yerleşim DETERMİNİST (her açılışta aynı sahne) ==')
// metot GÖVDESİNİ al — çağrı yeri tanımdan önce geçiyor, ona göre dilimlemek
// yol çizim kodunu inceler ve yanlış sonuç verir (ilk sürümde tam bunu yaptı).
const body = (name, until) =>
  world.slice(world.indexOf(`private ${name}(`), world.indexOf(`private ${until}(`))
const industrial = body('buildIndustrialDistrict', 'buildCommercialDistrict')
const commercial = body('buildCommercialDistrict', 'buildBlockSkyline')
check('sanayi yerleşiminde Math.random YOK', !/Math\.random/.test(industrial))
check('ticari yerleşimde Math.random YOK', !/Math\.random/.test(commercial))
check('sanayi seçimi indeks tabanlı (tekrar üretilebilir)', /\[\(i \* \d+ \+ row \* \d+\) %/.test(industrial))

console.log('\n== 4) Sanayi/ticari yapılar oyun alanını kapatmıyor ==')
// oyuncunun arsası x -29.5..5 (near) ve 10.9..45.4 (far); yol koridoru x 4.9..10.9
// sahne süsleri bu ikisinin DIŞINDA, yani |x - ROAD_X| yeterince büyük olmalı
const offsets = [...industrial.matchAll(/ROAD_X \+ (\d+(?:\.\d+)?)/g)].map(m => +m[1])
check(`sanayi en yakın yapı ROAD_X+${Math.min(...offsets)} (yol koridorunun dışında, ≥10)`,
  Math.min(...offsets) >= 10, `en yakın: +${Math.min(...offsets)}`)
const cOffsets = [...commercial.matchAll(/\((\d+(?:\.\d+)?) \+ \(k % \d+\)/g)].map(m => +m[1])
check(`ticari en yakın yapı ROAD_X±${Math.min(...cOffsets)} (yol dışında, ≥15)`,
  Math.min(...cOffsets) >= 15, `en yakın: ${Math.min(...cOffsets)}`)

console.log('\n== 5) Draw call disiplini ==')
const nFit = (industrial.match(/fitModel/g) || []).length + (commercial.match(/fitModel/g) || []).length
check(`sahne başına model örneği makul (${nFit} fitModel çağrı noktası, ≤8)`, nFit <= 8)
check('prosedürel yedek InstancedMesh kullanıyor (tek draw call)',
  /buildBlockSkyline[\s\S]{0,600}InstancedMesh/.test(world))

console.log('\n== 6) MARİNA sahnesi ==')
const marina = body('buildMarinaScene', 'buildIndustrialDistrict')
check('marina sahnesi su temasında çağrılıyor',
  /th\.lane\.kind === 'water'\) this\.buildMarinaScene\(s\)/.test(world))
check('deniz İKİ katmanlı (tek dokuyla elde edilemeyen dalga hissi)',
  /seaA/.test(marina) && /seaB/.test(marina) && /seaLayers = \[/.test(marina))
check('katmanlar TERS yönde kayıyor',
  /sx: 0\.\d+[\s\S]{0,80}sx: -0\.\d+/.test(marina))
check('su dokusu prosedürel üretiliyor (ek indirme yok)', /waterTexture\(512/.test(marina))
check('doku tekrar edebilir (RepeatWrapping)', /wrapS = tex\.wrapT = THREE\.RepeatWrapping/.test(world))
check('su her karede kayıyor (animasyon bağlı)',
  /for \(const l of this\.seaLayers\)[\s\S]{0,160}offset\.x/.test(world))
check('ADA var (dikdörtgen parsel değil, düzensiz kıyı)',
  /const isle = \(/.test(marina) && /wob/.test(marina))
check('ada ÜÇ katmanlı (kum + taş + çim)', (marina.match(/^\s+isle\(/gm) || []).length === 3)
check('kıyı çizgisi DETERMİNİST (her açılışta aynı ada)', !/Math\.random/.test(marina))
check('liman ağzı dalgakıranlarla daralıyor', /mole/.test(marina))
check('kırmızı/yeşil fener (denizcilik kuralı)', /0xd44b4b/.test(marina) && /0x3fae5f/.test(marina))
check('iskeleler + babalar var', /dockMat/.test(marina) && /piles/.test(marina))
check('şamandıra: kit varsa GERÇEK model, yoksa koni yedeği',
  /buoyProto/.test(marina) && /ConeGeometry/.test(marina))
check('arka planda kargo gemisi + römorkör', /ship-cargo-b/.test(marina) && /boat-tug-a/.test(marina))
check('iskelede konteyner (liman dokusu)', /cargo-container/.test(marina))

console.log('\n== 7) Tekneler gerçek modele bağlı ==')
const cars = fs.readFileSync(path.join(ROOT, 'src/cars.ts'), 'utf8')
check('segment → model eşlemesi var', /BOAT_MODEL: Record<BoatKind, string>/.test(cars))
check('7 tekne türünün hepsi eşlenmiş',
  ['jetski','surat','balikci','yelkenli','gulet','motoryat','superyat']
    .every(k => new RegExp(k + ":\\s*'").test(cars)))
const bm = cars.slice(cars.indexOf('BOAT_MODEL'), cars.indexOf('BOAT_LEN'))
const models = [...bm.matchAll(/'([a-z-]+)'/g)].map(m => m[1])
check(`eşlenen ${models.length} modelin hepsi manifestte`,
  models.every(m => declared.has(m)), 'manifestte yok: ' + models.filter(m => !declared.has(m)))
check('kit yoksa prosedürel gövdeye düşüyor', /proto \? fitModel[\s\S]{0,40}: buildBoatMesh/.test(cars))
const bl = cars.slice(cars.indexOf('BOAT_LEN'), cars.indexOf('export function buildBoatMesh'))
const lens = [...bl.matchAll(/:\s*([\d.]+)/g)].map(m => +m[1])
check(`süperyat jet ski'den belirgin BÜYÜK (${Math.min(...lens)} → ${Math.max(...lens)}, ≥4×)`,
  Math.max(...lens) / Math.min(...lens) >= 4)

console.log(`\nSONUÇ: ${pass} geçti, ${fail} kaldı`)
process.exit(fail ? 1 : 0)
