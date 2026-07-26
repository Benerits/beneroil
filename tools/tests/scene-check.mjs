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

console.log(`\nSONUÇ: ${pass} geçti, ${fail} kaldı`)
process.exit(fail ? 1 : 0)
