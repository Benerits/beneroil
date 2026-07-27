// SAHNE KURULUM testleri — "kit geldi ama sahneye hiç bina konmadı" sınıfını yakalar.
// Kaynak koddan yerleşim mantığını çıkarıp DETERMİNİZM ve SINIR kontrolü yapar.
// Çalıştır: npm run test:scene
import fs from 'node:fs'
import path from 'node:path'
const ROOT = new URL('../../', import.meta.url).pathname
const world = fs.readFileSync(path.join(ROOT, 'src/world.ts'), 'utf8')
const kits = fs.readFileSync(path.join(ROOT, 'src/kits.ts'), 'utf8')

// Metot gövdesini SIRAYA GÖRE dilimle. Dosyadaki tanım sırası:
// buildMarinaScene → buildIndustrialDistrict → buildCommercialDistrict →
// buildRingRoadDistrict → buildBlockSkyline. Yanlış sıra boş dilim verir ve
// test sessizce yanlış sonuç üretir (ilk sürümde tam bu oldu).
const ORDER = ['buildMarinaScene', 'buildIndustrialDistrict', 'buildCommercialDistrict',
               'buildRingRoadDistrict', 'buildBlockSkyline']
const body = (name) => {
  const i = ORDER.indexOf(name)
  const a = world.indexOf(`private ${name}(`)
  const b = i + 1 < ORDER.length ? world.indexOf(`private ${ORDER[i + 1]}(`) : world.length
  if (a < 0 || b <= a) throw new Error(`gövde dilimlenemedi: ${name}`)
  return world.slice(a, b)
}
const industrial = body('buildIndustrialDistrict')
const commercial = body('buildCommercialDistrict')
const ring = body('buildRingRoadDistrict')
const marina = body('buildMarinaScene')

let pass = 0, fail = 0
const check = (n, c, d = '') => { c ? (pass++, console.log('  ✓ ' + n)) : (fail++, console.log(`  ✗ ${n}${d ? ' — ' + d : ''}`)) }

console.log('== 1) Sahneler kite bağlı ve yedekli ==')
check('otoyol sanayi bölgesi çağrılıyor', /this\.buildIndustrialDistrict\(s\)/.test(world))
check('metropol ticari doku çağrılıyor', /this\.buildCommercialDistrict\(s\)/.test(world))
// Yerleşim artık VERİ (src/scenery.ts) ve tek yerleştirici var: placePlan().
// Kural kontrolü framing-check.mjs'de; burada YALNIZ bağlantı ve yedek yolu ölçülüyor.
check('tek yerleştirici: placePlan kite null-korumalı bakıyor',
  /placePlan\([\s\S]{0,240}if \(!K\) return 0/.test(world))
check('placePlan eksik modeli atlıyor (tek model düşerse sahne kurulur)',
  /const proto = K\[p\.model\]\s*\n\s*if \(!proto\) continue/.test(world))
check('metropol: hiç model yerleşmediyse PROSEDÜREL siluete düşüyor',
  /if \(placed === 0\) \{ this\.buildBlockSkyline\(s\); return \}/.test(world))
check('üç kara sahnesi de kendi planını okuyor',
  /SCENE_PLANS\.otoyol/.test(world) && /SCENE_PLANS\.metropol/.test(world)
  && /SCENE_PLANS\.cevreyolu/.test(world) && /SCENE_PLANS\.marina/.test(world))
check('KALDIRILDI: prosedürel gri kutu siluet artık urban blokta YOK',
  !/blockN = 17/.test(world))

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
check('sanayi yerleşiminde Math.random YOK', !/Math\.random/.test(industrial))
check('ticari yerleşimde Math.random YOK', !/Math\.random/.test(commercial))
check('yerleşim planı determinist (scenery.ts sabit koordinat, Math.random yok)',
  !/Math\.random/.test(fs.readFileSync(path.join(ROOT, 'src/scenery.ts'), 'utf8')))

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

console.log('\n== 6b) ÇEVRE YOLU sahnesi ==')
check('çevre yolu sahnesi çağrılıyor', /th\.id === 'cevreyolu'\) this\.buildRingRoadDistrict/.test(world))
check('parsele denk gelen binalar decor\'a kaydediliyor (betonlanınca silinsin)',
  /if \(p\.parcel\) this\.decor\.push/.test(world))
check('yaya bariyerinde zebra hizasında BOŞLUK var', /y < -24\.6 \|\| y > -20\.2/.test(ring))
check('zebra TEK draw call (7 mesh değil, çizgili canvas)', /CanvasTexture/.test(ring))
// KUZEY DURAĞI KALDIRILDI (Oğuz: kameranın önü açık kalsın) — yalnız güney durağı, parsel dışında
check('otobüs durağı parsel DIŞINDA (kamu alanı, silinmez)', /\[-25\.40\]/.test(ring))
check('yerleşim determinist', !/Math\.random/.test(ring))

console.log('\n== 6) MARİNA sahnesi ==')
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
check('ADA var (yuvarlatılmış dikdörtgen + dalgalanma)', /islePoly/.test(marina))
check('ada BEŞ katmanlı (sığlık+köpük+kum+kaya+çim)', (marina.match(/^\s+(const foam = )?layer\(/gm) || []).length === 5)
check('kıyı çizgisi DETERMİNİST (her açılışta aynı ada)', !/Math\.random/.test(marina))
  check('doğu yüzü DÜZ rıhtım (organik kıyı değil)', /if \(X > X1\) X = X1/.test(marina))
  check('köpük halkası nefes alıyor', /marinaFoam/.test(world))
check('dış dalgakıran + fenerler', /const mole = /.test(marina) && /0xd44b4b/.test(marina))
check('kırmızı/yeşil fener (denizcilik kuralı)', /0xd44b4b/.test(marina) && /0x3fae5f/.test(marina))
check('yakıt güvertesi + babalar var', /const dock = /.test(marina) && /bollard|CylinderGeometry\(0\.13/.test(marina))
check('şamandıra: kırmızı iskele / yeşil sancak ayrımı (denizcilik kuralı)',
  /buoyAt\('buoy', 10\.40/.test(marina) && /buoyAt\('buoy-flag', 17\.20/.test(marina))
const scenery = fs.readFileSync(path.join(ROOT, 'src/scenery.ts'), 'utf8')
check('römorkör + bağlı tekne + kargo gemisi (plan içinde)',
  /boat-tug-a/.test(scenery) && /boat-row-large/.test(scenery) && /ship-cargo-b/.test(scenery))
check('ADA ÜSTÜNDE tekne YOK — hepsi suda (x > 11.6)', (() => {
  const seg = scenery.slice(scenery.indexOf('MARINA_PLAN'))
  const rows = [...seg.matchAll(/model: '(boat|ship)[^']*', h: [\d.]+, x: (-?[\d.]+)/g)]
  return rows.length > 0 && rows.every(m => Number(m[2]) > 11.6)
})())
check('adanın tek dikey aksanı fener (yükseklik ≤ 6)', /GÜNEY BURNU FENERİ|fener/i.test(world))
check('ada patikası normalli (normalsiz geometri SİYAH çıkıyordu)',
  /pathGeo\.computeVertexNormals\(\)/.test(world))

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

console.log('\n== 8) GÖRÜNÜRLÜK: her öğe kamera bandında mı ==')
// Ölçüm (oyunun kendi kamera matematiğiyle): çekirdek x -28..28, y -27..27;
// varsayılan görüş ±35/±39; ±56 ötesi HİÇBİR açıda görünmez.
// Bu test o bandı kilitler — sahneye ölü bölgeye öğe konursa kırılır.
const CEK = 28, GORUS = 40, OLU = 56
function coords(src, label) {
  const bad = [], far = []
  // put(...)/place(...) çağrılarındaki (x, y) argümanları
  for (const m of src.matchAll(/\b(?:put|place)\('[^']+',\s*[\d.]+,\s*(-?[\d.]+),\s*(-?[\d.]+)/g)) {
    const x = +m[1], y = +m[2]
    if (Math.abs(x) > OLU || Math.abs(y) > OLU) bad.push(`(${x},${y})`)
    else if (Math.abs(x) > CEK || Math.abs(y) > CEK) far.push(`(${x},${y})`)
  }
  // setPosition(x, y, z) — instanced yerleşimler (sabit sayı olanlar)
  for (const m of src.matchAll(/setPosition\((-?[\d.]+),\s*(-?[\d.]+)/g)) {
    const x = +m[1], y = +m[2]
    if (Math.abs(x) > OLU || Math.abs(y) > OLU) bad.push(`inst(${x},${y})`)
  }
  check(`${label}: ÖLÜ BÖLGEDE (±${OLU}) öğe yok`, bad.length === 0, bad.slice(0, 6).join(' '))
  if (far.length) console.log(`      ↳ ${far.length} öğe arka plan bandında (±${CEK}..${OLU}) — bilinçli`)
  return far.length
}
coords(industrial, 'otoyol')
coords(commercial, 'metropol')
coords(ring, 'çevre yolu')
coords(marina, 'marina')
// marina adası çekirdek bantta mı (koordinatlar koddan)
const X1 = +(marina.match(/X1 = (-?[\d.]+)/) || [])[1]
const X0 = +(marina.match(/X0 = (-?[\d.]+)/) || [])[1]
const Y1 = +(marina.match(/Y1 = (-?[\d.]+)/) || [])[1]
check(`marina adası çekirdek bantta (x ${X0}..${X1}, y ±${Y1})`,
  Math.abs(X0) < CEK && Math.abs(X1) < CEK && Math.abs(Y1) < CEK)
check('ada doğu kenarı ana arsanın (x=5) hemen dışında — rıhtım', X1 > 5 && X1 < 6)

console.log(`\nSONUÇ: ${pass} geçti, ${fail} kaldı`)
process.exit(fail ? 1 : 0)
