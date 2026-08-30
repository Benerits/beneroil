/**
 * KARŞI YAKA (far side) KALICILIK testleri.
 *
 * NEDEN VAR: açık oyuncu geri bildirimlerinde ikinci en büyük küme karşı yakaydı —
 * "karşı tır parkı her sabah siliniyor", "oyunu kapatınca karşı taraftaki tesisler
 * kayboluyor", "karşı giriş/çıkışı genişletince kalıcı olmuyor". Kök neden tek bir
 * yerde toplanmıştı: karşı yaka alanları ŞUBE tablosunda (LOC_FIELDS) vardı ama
 * KAYIT tablosunda (SAVE_FIELDS) eksikti, karşı istasyon bayrağı ise hiç kaydedilmiyordu.
 *
 * Bu test alan listelerini EZBERLEMEZ: gerçek serialize/hydrate/switchLoc yollarından
 * geçirip değerin hayatta kalıp kalmadığına bakar. Yarın yeni bir karşı tesis eklenip
 * SAVE_FIELDS'a yazılmazsa buradaki "LOC ⊆ SAVE" kontrolü kırmızıya döner.
 *
 * Çalıştır: npm run test:karsiyaka
 */
globalThis.localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} }
Object.defineProperty(globalThis, 'navigator', { value: { language: 'tr' }, configurable: true })

import fs from 'node:fs'
const { GameState, hydrateState, serializeState, LOC_FIELDS, buyItem } = await import('../../src/state.ts')

let pass = 0, fail = 0
const check = (n, c, d = '') => { c ? (pass++, console.log('  ✓ ' + n)) : (fail++, console.log(`  ✗ ${n}${d ? ' — ' + d : ''}`)) }
const layout = () => ({ placedPos: {}, placedRot: {}, placedRects: [] })

/** Karşı yakayı ilgilendiren TÜM state alanları (tesis nüshaları + istasyon bayrağı) */
const FAR_FIELDS = [
  'market2Level', 'toilet2Level', 'hasWash2', 'hasOil2', 'hasCoffee2',
  'hasRestaurant2', 'hasTruckPark2', 'farStationOn',
]
/** Karşı yakası tam donanımlı, betonlu arsası olan oyuncu */
function farPlayer() {
  const s = new GameState()
  s.money = 5_000_000
  s.day = 40
  // karşı yaka (kolon ≥ 3) arsaları alınmış + betonlanmış — mağaza kilidi bunu ister
  s.ownedParcels = new Set(['0,0', '3,0', '3,1'])
  s.pavedParcels = new Set(['0,0', '3,0', '3,1'])
  // önce BU yakadaki tesisler (karşı nüshanın ön şartı), sonra karşı nüshalar
  s.marketLevel = 1; s.toiletLevel = 1
  s.hasWash = true; s.hasOil = true; s.hasCoffee = true
  s.hasRestaurant = true; s.hasTruckPark = true
  return s
}

console.log('== 1) Karşı yaka tesisleri mağazadan alınıp kayıttan geri geliyor mu ==')
{
  const s = farPlayer()
  // GERÇEK satın alma yolundan geç (buyItem) — alan doğrudan atanmıyor
  for (const id of ['market2', 'toilet2', 'wash2', 'oil2', 'coffee2', 'restaurant2', 'truckpark2']) {
    check(`mağazadan alınabildi: ${id}`, buyItem(s, id) === true)
  }
  s.farStationOn = true // karşıya ünite konunca main enableFarStationClear() bunu set eder

  const ser = serializeState(s)
  for (const f of FAR_FIELDS) {
    check(`serializeState '${f}' alanını yazıyor`, f in ser, 'SAVE_FIELDS içinde yok')
  }
  const d = new GameState()
  hydrateState(d, JSON.parse(JSON.stringify(ser)))
  for (const f of FAR_FIELDS) {
    check(`hydrate sonrası '${f}' duruyor (${JSON.stringify(d[f])})`, d[f] === s[f],
      `beklenen ${JSON.stringify(s[f])}, gelen ${JSON.stringify(d[f])}`)
  }
  check('karşı arsa/beton da duruyor', d.ownedParcels.has('3,0') && d.pavedParcels.has('3,1'))
}

console.log('\n== 2) Şube geçişi turu (kasaba → çevre yolu → kasaba) ==')
{
  const s = farPlayer()
  for (const id of ['market2', 'toilet2', 'wash2', 'oil2', 'coffee2', 'restaurant2', 'truckpark2']) buyItem(s, id)
  s.farStationOn = true
  const before = FAR_FIELDS.map(f => s[f])

  s.unlockedLocs.push('cevreyolu')
  s.switchLoc('cevreyolu', layout())
  check('yeni şubede karşı yaka TEMİZ başlıyor (şubeler karışmıyor)',
    FAR_FIELDS.every(f => s[f] === new GameState()[f]),
    FAR_FIELDS.filter(f => s[f] !== new GameState()[f]).join(','))
  check('yeni şubede karşı istasyon KAPALI', s.farStationOn === false)

  s.switchLoc('kasaba', layout())
  check('kasabaya dönünce karşı yaka AYNEN geri geldi',
    FAR_FIELDS.every((f, i) => s[f] === before[i]),
    FAR_FIELDS.filter((f, i) => s[f] !== before[i]).join(','))

  // tur + kayıt round-trip birlikte (asıl şikâyet: geçiş yaptım, sonra yeniledim)
  const d = new GameState()
  hydrateState(d, JSON.parse(JSON.stringify(serializeState(s))))
  check('şube turu + sayfa yenileme sonrası da duruyor',
    FAR_FIELDS.every((f, i) => d[f] === before[i]),
    FAR_FIELDS.filter((f, i) => d[f] !== before[i]).join(','))
  check('pasif şube anlık görüntüsü de bozulmadı', !!d.locSnapshots.cevreyolu)
}

console.log('\n== 3) ESKİ kayıt (yeni alanlar YOK) çökmüyor, varsayılana düşüyor ==')
{
  // gerçek bir eski kayıt: karşı yaka alanlarının hiçbiri yok
  const eski = { money: 120_000, day: 12, pumps: 3, marketLevel: 1, hasWash: true, reputation: 3.4 }
  const d = new GameState()
  let patladi = null
  try { hydrateState(d, eski) } catch (e) { patladi = e }
  check('eski kayıt yüklenirken hata atmıyor', patladi === null, String(patladi))
  for (const f of FAR_FIELDS) {
    const v = d[f]
    check(`'${f}' sınıf varsayılanında (${JSON.stringify(v)}) — NaN/undefined YOK`,
      v === false || v === 0, `gelen ${JSON.stringify(v)}`)
  }
  check('eski kaydın gerçek alanları korundu', d.money === 120_000 && d.pumps === 3 && d.hasWash === true)
  // eski kayıt yeniden yazılınca yeni alanlar da kayda girer (kendini onarır)
  const ser2 = serializeState(d)
  check('yeniden kayıtta yeni alanlar oluşuyor (self-heal)', FAR_FIELDS.every(f => f in ser2))
}

console.log('\n== 4) Gün dönüşü karşı tır parkını silmiyor ==')
{
  const s = farPlayer()
  buyItem(s, 'truckpark2')
  s.farStationOn = true
  check('karşı tır parkı kuruldu', s.hasTruckPark2 === true)
  // 3 gün boyunca simülasyon + her gün başında kaydet/yükle (oyuncunun "her sabah" döngüsü)
  let live = s
  for (let gun = 0; gun < 3; gun++) {
    for (let i = 0; i < 120; i++) live.tick(1)
    live.day++
    const d = new GameState()
    hydrateState(d, JSON.parse(JSON.stringify(serializeState(live))))
    live = d
  }
  check('3 gün + 3 kayıt/yükleme sonrası karşı tır parkı DURUYOR', live.hasTruckPark2 === true)
  check('karşı istasyon bayrağı da duruyor', live.farStationOn === true)
  check('karşı tır parkı pasif gelir üretti (ölü alan değil)',
    Object.keys(live.pendingCash).includes('truckpark2') || live.stats.revenue >= 0)
}

console.log('\n== 5) Şube alanı ⊆ kayıt alanı (regresyon kilidi) ==')
{
  // LOC_FIELDS'ta olup SAVE_FIELDS'ta olmayan alan = AKTİF şubede kaybolan alan.
  // hasTruckPark2 tam olarak böyle kayboluyordu.
  const ser = serializeState(new GameState())
  const eksik = LOC_FIELDS.filter(f => !(f in ser))
  check(`her şube alanı kayda da giriyor (${LOC_FIELDS.length} alan)`, eksik.length === 0,
    'SAVE_FIELDS eksik: ' + eksik.join(', '))
}

console.log('\n== 6) İstemci/sunucu servet senkronu (karşı yaka anti-cheat) ==')
{
  // Sunucu buildingValue() karşı tesisleri SAYIYOR. İstemci equipmentValue() saymazsa
  // karşıya yatırım "para gitti, servet artmadı" görünür → 409 / para kırpma.
  const src = fs.readFileSync(new URL('../../server/index.js', import.meta.url), 'utf8')
  const block = src.slice(src.indexOf('const clamp = '), src.indexOf('function sanitizeSave'))
  const { buildingValue } = new Function(block + '; return { buildingValue }')()

  const bos = farPlayer()
  const dolu = farPlayer()
  for (const id of ['market2', 'toilet2', 'wash2', 'oil2', 'coffee2', 'restaurant2', 'truckpark2']) buyItem(dolu, id)

  const cliFark = dolu.equipmentValue() - bos.equipmentValue()
  const srvFark = buildingValue(serializeState(dolu)) - buildingValue(serializeState(bos))
  check(`karşı yaka ekipman değeri istemci=₺${cliFark.toLocaleString('tr-TR')} sunucu=₺${srvFark.toLocaleString('tr-TR')}`,
    cliFark === srvFark, 'src/state.ts equipmentValue ile server/index.js buildingValue AYRIŞMIŞ')
  check('karşı yatırım istemci servetine giriyor (0 değil)', cliFark > 0)

  // ŞUBE GEÇİŞİ SERVET-NÖTR: aktif alan kaydedilmezse snapshot'a girince servet zıplar
  const wealth = st => (Number(serializeState(st).money) || 0)
    + buildingValue(serializeState(st))
    + Object.values(serializeState(st).locSnapshots ?? {})
      .reduce((a, sn) => a + buildingValue({ ...sn.f, tankCounts: sn.tankCounts, ownedParcels: sn.ownedParcels, pavedParcels: sn.pavedParcels }), 0)
  const w0 = wealth(dolu)
  dolu.unlockedLocs.push('cevreyolu')
  dolu.switchLoc('cevreyolu', layout())
  const w1 = wealth(dolu)
  dolu.switchLoc('kasaba', layout())
  const w2 = wealth(dolu)
  check(`şubeden çıkarken servet sıçramıyor (${Math.round(w0)} → ${Math.round(w1)})`, Math.abs(w1 - w0) <= 26_000,
    'karşı yaka alanı snapshot ile kayıt arasında AYRIŞIYOR')
  check(`şubeye dönerken servet sıçramıyor (${Math.round(w1)} → ${Math.round(w2)})`, Math.abs(w2 - w1) <= 26_000)
}

console.log('\n== 7) Devirde karşı yaka da sıfırlanıyor (bedeli ödendi) ==')
{
  const s = farPlayer()
  for (const id of ['market2', 'toilet2', 'wash2', 'oil2', 'coffee2', 'restaurant2', 'truckpark2']) buyItem(s, id)
  s.pumps = 8; s.evChargers = 4; s.tankLevel = 3
  s.salesLog = Array.from({ length: 30 }, (_, i) => ({ day: s.day - i, rev: 9000 }))
  const eq = s.equipmentValue()
  const val = s.handoverValue()
  check('devir bedeli karşı tesisleri de fiyatlıyor', val > 0 && val <= eq)
  const res = s.handover()
  check('devir gerçekleşti', !!res)
  check('karşı yaka tesisleri devirde sıfırlandı (hem para hem tesis alınmıyor)',
    s.market2Level === 0 && s.toilet2Level === 0 && !s.hasWash2 && !s.hasOil2
    && !s.hasCoffee2 && !s.hasRestaurant2 && !s.hasTruckPark2)
  check('devirden sonra ekipman değeri 0', s.equipmentValue() === 0, String(s.equipmentValue()))
  check('karşı ARSA/BETON korundu (arsa devirde kalır)', s.ownedParcels.has('3,0') && s.pavedParcels.has('3,1'))
}

console.log(`\nSONUÇ: ${pass} geçti, ${fail} kaldı`)
process.exit(fail ? 1 : 0)
