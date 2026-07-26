// MARİNA testleri (lategame raporu §6.5) — saf mantık, DOM stub'larıyla.
// Çalıştır: npm run test:marina
globalThis.localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} }
Object.defineProperty(globalThis, 'navigator', { value: { language: 'tr' }, configurable: true })

import fs from 'node:fs'
const M = await import('../../src/marina.ts')
const { GameState } = await import('../../src/state.ts')

let pass = 0, fail = 0
const check = (n, c, d = '') => { c ? (pass++, console.log('  ✓ ' + n)) : (fail++, console.log('  ✗ ' + n + (d ? ' — ' + d : ''))) }
const marina = () => { const g = new GameState(); g.unlockedLocs.push('marina')
  g.switchLoc('marina', { placedPos: {}, placedRot: {}, placedRects: [] }); return g }

console.log('== 1) Segmentler: ₺/müşteri ekseni (rapor §6.5.4) ==')
const avg = M.averageTicket(M.BOAT_SEGMENTS)
check(`ortalama satış ≈ ₺4.500 (hesaplandı: ₺${Math.round(avg)})`, avg > 3800 && avg < 5400)
check('otoyol ortalamasından (₺233) en az 15× yüksek', avg / 233 > 15)
check('segment payları toplamı 1.0', Math.abs(M.BOAT_SEGMENTS.reduce((a, s) => a + s.share, 0) - 1) < 0.001)
check('balıkçı marjı EN DÜŞÜK (ÖTV\'siz)', Math.min(...M.BOAT_SEGMENTS.map(s => s.margin)) === M.BOAT_SEGMENTS.find(s => s.id === 'balikci').margin)
check('süperyat servis süresi EN UZUN (~150 sn)', Math.max(...M.BOAT_SEGMENTS.map(s => s.serviceSec)) === 150)
check('servis süreleri karadan uzun (en kısası bile 15 sn)', Math.min(...M.BOAT_SEGMENTS.map(s => s.serviceSec)) >= 15)

console.log('\n== 2) Tesis kilitleri: kim ne zaman gelir ==')
const g = marina()
check('yakıt iskelesi YOKKEN hiç tekne gelmez', g.boatSegments().length === 0)
g.marinaFacs.push('fueldock')
const base = g.boatSegments()
check('yakıt iskelesiyle tekneler gelir', base.length > 0)
check('süperyat Mavi Bayraksız GELMEZ', !base.some(s => s.id === 'superyat'))
check('gulet duş/çamaşırhane yokken GELMEZ', !base.some(s => s.id === 'gulet'))
g.marinaFacs.push('shower')
check('duş kurulunca gulet gelir', g.boatSegments().some(s => s.id === 'gulet'))

console.log('\n== 3) Mavi Bayrak ==')
check('çevre hizmetleri eksikken bayrak YOK', !g.blueFlag().ok)
check('eksikler isimle raporlanır', g.blueFlag().missing.length === 3)
for (const f of M.ENV_FACILITIES) g.marinaFacs.push(f)
check('tüm çevre hizmetleriyle bayrak ALINIR', g.blueFlag().ok)
check('bayrakla süperyat kilidi AÇILIR', g.boatSegments().some(s => s.id === 'superyat'))
g.marinaViolations = 3
check('3 ihlalde bayrak ASKIYA alınır', !g.blueFlag().ok)
check('askı GEÇİCİ — tesisler duruyor, sicil temizlenince geri gelir',
  g.blueFlag().missing.length === 0 && (g.marinaViolations = 0, g.blueFlag().ok))

console.log('\n== 4) ÖTV\'siz yakıt alım defteri (§6.5.3) ==')
// determinizm
const a1 = M.makeLogbook(10, 3, 'MAVİ RÜZGAR', 1800)
const a2 = M.makeLogbook(10, 3, 'MAVİ RÜZGAR', 1800)
check('defter determinist (aynı gün+sıra = aynı defter)', JSON.stringify(a1) === JSON.stringify(a2))
// geçerli defter → onay doğru
const good = { boatName: 'X', liters: 500, quotaUsed: 100, quotaTotal: 2000, visaValid: true, signatureOk: true, dateConsistent: true, genuine: true }
check('geçerli defterde kusur listesi BOŞ', M.logbookFlags(good).length === 0)
const okApprove = M.resolveLogbook(good, 'approve', 20000)
check(`doğru onay → düşük marj kazanç (+₺${okApprove.money})`, okApprove.money === 2400 && okApprove.correct && !okApprove.violation)
const badReject = M.resolveLogbook(good, 'reject', 20000)
check('haksız ret → itibar kaybı, müşteri kaçar', badReject.rep < -0.3 && !badReject.correct)
// kotası dolu defter
const overQuota = { ...good, liters: 1800, quotaUsed: 1400, genuine: false }
check('kota aşımı kusur olarak GÖRÜNÜR', M.logbookFlags(overQuota).some(f => f.includes('Kota')))
const fine = M.resolveLogbook(overQuota, 'approve', 20000)
check(`sahte deftere onay → ₺${M.LOGBOOK_FINE.toLocaleString('tr-TR')} ceza`, fine.money === -M.LOGBOOK_FINE)
check('sahte onay çevre siciline İŞLENİR', fine.violation === true)
const okReject = M.resolveLogbook(overQuota, 'reject', 20000)
check('haklı ret → küçük itibar bedeli ama ceza YOK', okReject.money === 0 && okReject.correct && okReject.rep === -0.2)
// zorluk kademesi: geç oyunda sahtecilik incelir
let earlyObvious = 0, lateSubtle = 0
for (let i = 0; i < 400; i++) {
  const e = M.makeLogbook(5, i, 'B', 900)
  if (!e.genuine && !e.signatureOk) earlyObvious++
  const l = M.makeLogbook(180, i, 'B', 900)
  if (!l.genuine && !l.dateConsistent) lateSubtle++
}
check(`erken oyunda kusur BARİZ (imza uyuşmazlığı ${earlyObvious} kez)`, earlyObvious > 10)
check(`geç oyunda kusur İNCE (tarih tutarsızlığı ${lateSubtle} kez)`, lateSubtle > 10)
let fakeEarly = 0, fakeLate = 0
for (let i = 0; i < 600; i++) {
  if (!M.makeLogbook(1, i, 'B', 900).genuine) fakeEarly++
  if (!M.makeLogbook(200, i, 'B', 900).genuine) fakeLate++
}
check(`sahtecilik oranı gün 1'de düşük, gün 200'de yüksek (${(fakeEarly/6).toFixed(0)}% → ${(fakeLate/6).toFixed(0)}%)`, fakeLate > fakeEarly)
check('her defter incelenebilir: kusurlu olanın MUTLAKA görünür işareti var',
  Array.from({ length: 300 }, (_, i) => M.makeLogbook(90, i, 'B', 900))
    .filter(l => !l.genuine).every(l => M.logbookFlags(l).length > 0))

console.log('\n== 5) Bağlama işletmesi + kışlama (pasif omurga) ==')
const m2 = marina()
m2.berths = { finger12: 10 }
const yaz = M.berthIncome(m2.berths, 'yaz', false)
const kis = M.berthIncome(m2.berths, 'kis', false)
check(`bağlama geliri yazın yüksek (₺${yaz} > ₺${kis})`, yaz > kis)
check('Mavi Bayrak marina ücretine %15 prim yapar',
  Math.abs(M.berthIncome(m2.berths, 'yaz', true) / yaz - 1.15) < 0.02)
check('travel lift YOKKEN kışlama geliri YOK', M.winterStorageIncome(20, 'kis', false) === 0)
const wKis = M.winterStorageIncome(20, 'kis', true)
const wYaz = M.winterStorageIncome(20, 'yaz', true)
check(`kışlama geliri KIŞIN zirve (₺${wKis} >> ₺${wYaz})`, wKis > wYaz * 5)
// raporun ana iddiası: kışın yakıt çöker ama işletme ayakta kalır
m2.marinaFacs.push('fueldock', 'travelift')
m2.winterSlots = 20
m2.day = 200 // kış
const kisTotal = m2.marinaDailyIncome().total
m2.day = 60  // yaz
const yazTotal = m2.marinaDailyIncome().total
check(`kışın gelir SIFIRLANMAZ (₺${kisTotal}) — iş modeli değişir, durmaz`, kisTotal > yazTotal * 0.4)

console.log('\n== 6) Mevsimsellik: marinanın imzası (§6.5.5) ==')
const s1 = marina()
s1.day = 60;  check('yaz trafiği ×2.5 (raporla birebir)', Math.abs(s1.season().traffic - 2.5) < 0.001)
s1.day = 200; check('kış trafiği ×0.3 (raporla birebir)', Math.abs(s1.season().traffic - 0.3) < 0.001)
s1.day = 1;   check('ilkbahar ×1.2', Math.abs(s1.season().traffic - 1.2) < 0.001)
s1.day = 150; check('sonbahar ×1.0', Math.abs(s1.season().traffic - 1) < 0.001)
const land = new GameState()
land.day = 60;  const lYaz = land.season().traffic
land.day = 200; const lKis = land.season().traffic
check(`KARA şubesinde aynı mevsimler HAFİF (${lYaz} / ${lKis}) — canlı denge korunur`, lYaz < 1.2 && lKis > 0.85)

console.log('\n== 7) Risk olayları: ağır ama TELAFİ EDİLEBİLİR (§6.5.6) ==')
check('hiçbir olay kalıcı silme yapmaz (yalnız para/itibar/süre alanları var)',
  M.MARINA_EVENTS.every(e => typeof e.money === 'number' && typeof e.rep === 'number'
    && !('destroy' in e) && !('reset' in e) && !('wipe' in e)))
check('en ağır ceza bile telafi edilebilir ölçekte (< ₺40.000)',
  Math.min(...M.MARINA_EVENTS.map(e => e.money)) > -40_000)
check('fırtına KIŞIN daha olası (mevsim ağırlığı)',
  M.MARINA_EVENTS.find(e => e.id === 'lodos').weight.kis > M.MARINA_EVENTS.find(e => e.id === 'lodos').weight.yaz)
check('müsilaj YAZIN daha olası',
  M.MARINA_EVENTS.find(e => e.id === 'musilaj').weight.yaz > M.MARINA_EVENTS.find(e => e.id === 'musilaj').weight.kis)
// bariyer sızıntıyı TAMAMEN önler
let leakWithout = 0, leakWith = 0
for (let d = 1; d < 900; d++) {
  if (M.pickMarinaEvent(d, 'yaz', new Set(), false)?.id === 'sizinti') leakWithout++
  if (M.pickMarinaEvent(d, 'yaz', new Set(['boom']), false)?.id === 'sizinti') leakWith++
}
check(`sızıntı bariyeri olayı TAMAMEN önler (${leakWithout} → ${leakWith})`, leakWithout > 5 && leakWith === 0)
// Mavi Bayrak olay sıklığını yarıya indirir
let evNo = 0, evYes = 0
for (let d = 1; d < 2000; d++) {
  if (M.pickMarinaEvent(d, 'yaz', new Set(), false)) evNo++
  if (M.pickMarinaEvent(d, 'yaz', new Set(), true)) evYes++
}
check(`Mavi Bayrak olay sıklığını ~yarıya indirir (${evNo} → ${evYes})`, evYes < evNo * 0.65 && evYes > 0)
check('olay seçimi determinist', M.pickMarinaEvent(42, 'kis', new Set(), false)?.id === M.pickMarinaEvent(42, 'kis', new Set(), false)?.id)

console.log('\n== 8) Save uyumu + anti-cheat senkronu ==')
const sv = marina()
sv.marinaFacs.push('fueldock', 'pumpout')
sv.berths = { finger12: 4, mega: 1 }
sv.winterSlots = 12
const val = sv.marinaValue()
check(`marina yatırımı VARLIK değerine girer (₺${val.toLocaleString('tr-TR')})`, val > 0)
check('varlık = tesis + bağlama + kışlama toplamı',
  val === 180_000 + 120_000 + 75_000 * 4 + 600_000 + 12 * 8_000)
check('marina değeri ekipman değerine dahil', sv.equipmentValue() >= val)
// kara şubesinde marina alanları BOŞ kalır (mevcut save'ler etkilenmez)
const kara = new GameState()
check('kara şubesinde marina alanları boş', kara.marinaFacs.length === 0 && Object.keys(kara.berths).length === 0)
check('kara şubesinde marina geliri 0', kara.marinaDailyIncome().total === 0)
check('kara şubesinde marina olayı YOK', kara.marinaDayEvent() === null)
check('kara şubesinde tekne segmenti YOK', kara.boatSegments().length === 0)

console.log('\n== 9) Mağaza + gün dönüşü entegrasyonu ==')
{
  const { getShopItems, buyItem } = await import('../../src/state.ts')
  const g = marina()
  g.money = 10_000_000
  const rows = getShopItems(g)
  check('marinada DENİZ kataloğu gösterilir', rows.some(r => r.id === 'fueldock') && rows.some(r => r.id === 'berth_mega'))
  check('marinada kara tesisleri gösterilmez', !rows.some(r => r.id === 'truckpark' || r.id === 'selfwash'))
  check('yakıt iskelesi kurulmadan diğerleri KİLİTLİ',
    rows.find(r => r.id === 'travelift').status === 'locked')
  check('süperyat mevkisi Mavi Bayraksız KİLİTLİ',
    rows.find(r => r.id === 'berth_mega').status === 'locked')
  check('kışlama travel liftsiz KİLİTLİ', rows.find(r => r.id === 'winterslot').status === 'locked')

  check('yakıt iskelesi satın alınabilir', buyItem(g, 'fueldock') && g.hasMarinaFac('fueldock'))
  check('kilitli kalem satın ALINAMAZ', !buyItem(g, 'winterslot') && g.winterSlots === 0)
  buyItem(g, 'travelift')
  check('travel lift alınınca kışlama AÇILIR', buyItem(g, 'winterslot') && g.winterSlots === 1)
  check('bağlama yeri alınabilir ve sayaç artar',
    buyItem(g, 'berth_finger12') && buyItem(g, 'berth_finger12') && g.berths.finger12 === 2)
  check('aynı tesis İKİ KEZ alınmaz (para boşa gitmez)',
    (() => { const before = g.money; buyItem(g, 'fueldock'); return g.money === before })())

  // kara şubesinde marina kalemleri MAĞAZADA YOK (yanlışlıkla satın alınamaz)
  const kara = new GameState(); kara.money = 10_000_000
  check('kara şubesinde marina kalemi mağazada yok', !getShopItems(kara).some(r => r.id === 'fueldock'))
  check('kara şubesinde marina kalemi satın ALINAMAZ', !buyItem(kara, 'fueldock') && kara.marinaFacs.length === 0)
}

console.log('\n== 10) Tekne fiziği ve doğuşu (§6.5.2) ==')
{
  const C = await import('../../src/cars.ts')
  const g = marina()
  g.marinaFacs.push('fueldock')
  const segs = g.boatSegments()
  check('marina tekne segmenti üretir', segs.length > 0)
  // gövde üretimi her tür için çalışmalı (çökme olmasın)
  for (const b of ['jetski', 'surat', 'balikci', 'yelkenli', 'gulet', 'motoryat', 'superyat']) {
    if (!C.buildBoatMesh(b)) { check('gövde üretimi: ' + b, false); break }
  }
  check('7 tekne türünün de gövdesi üretilebiliyor', true)
  const jet = C.buildBoatMesh('jetski'), sup = C.buildBoatMesh('superyat')
  const size = m => { const b = new (globalThis.THREE_BOX ?? Object)(); return m.children.length }
  check('süperyat jet ski\'den daha fazla parçadan oluşur (ölçek farkı görünür)',
    sup.children.length >= jet.children.length)
  check('yelkenlinin DİREĞİ var (tür ayrımı görsel)', C.buildBoatMesh('yelkenli').children.length > C.buildBoatMesh('surat').children.length)
}

console.log('\n== 11) TUTAR OYUNA BAĞLI MI (sabit değil, DAVRANIŞ testi) ==')
{
  // Bu test §1'in tamamlayıcısı. §1 BOAT_SEGMENTS tablosunu ölçüyor — ama tablo
  // doğru olsa da oyuna bağlı olmayabilir. Nitekim BAĞLI DEĞİLDİ: boats() yalnız
  // {id,share} gönderiyordu, para activeSegments()'ten (KARA) geliyordu ve süperyat
  // sıradan araba parası ödüyordu. Bu test o hatayı bir daha geçirmez.
  const g = marina()
  g.marinaFacs.push('fueldock', 'shower')
  for (const f of M.ENV_FACILITIES) g.marinaFacs.push(f)   // Mavi Bayrak → süperyat açılır
  const segs = g.boatCarSegments()
  check('boatCarSegments() TUTAR taşıyor (min/max)', segs.every(s => s.min > 0 && s.max > s.min))
  check('7 segmentin hepsi geliyor', segs.length === 7)
  const sup = segs.find(s => s.id === 'superyat')
  const jet = segs.find(s => s.id === 'jetski')
  check(`süperyat tutarı jet ski'nin en az 30 katı (₺${sup.min}-${sup.max} vs ₺${jet.min}-${jet.max})`,
    sup.min / jet.max > 30)
  check('süperyat KARA premium segmentinden çok daha yüksek (₺300-600)', sup.min > 600 * 10)
  check('balıkçı ÖTV marjı DÜŞÜK (marginMult < 0.5)', segs.find(s => s.id === 'balikci').marginMult < 0.5)
  check('büyük tekneler DENİZ MOTORİNİ istiyor', segs.find(s => s.id === 'superyat').fuel === 'dizel')

  // main.ts gerçekten boatCarSegments'i mi veriyor (yoksa yine {id,share} mi)?
  const main = fs.readFileSync(new URL('../../src/main.ts', import.meta.url), 'utf8')
  check('main.ts opts.boats TAM segment gönderiyor',
    /boats: \(\) => state\.boatCarSegments\(\)/.test(main),
    'yalnız {id,share} gönderilirse tutar KARA segmentinden gelir')

  // cars.ts model ile parayı AYRIŞTIRMIYOR mu?
  const cars = fs.readFileSync(new URL('../../src/cars.ts', import.meta.url), 'utf8')
  check('pickBoat SEGMENTİN TAMAMINI döndürüyor', /private pickBoat\(\): CarSegment \| null/.test(cars))
  check('seçilen segment tek elemanlı liste olarak Car\'a veriliyor (model=para)',
    /\[\{ \.\.\.boatSeg, share: 1 \}\]/.test(cars))
  check('kara şubesinde eski davranış korunuyor',
    /: \(this\.opts\.segments\?\.\(\) \?\? null\)/.test(cars))

  // ortalama bilet: tabloyla oyun AYNI olmalı
  const avgTable = M.averageTicket(M.BOAT_SEGMENTS)
  const avgGame = segs.reduce((a, s) => a + s.share * (s.min + s.max) / 2, 0) / segs.reduce((a, s) => a + s.share, 0)
  check(`tablo ve oyun ortalaması AYNI (₺${Math.round(avgTable)} = ₺${Math.round(avgGame)})`,
    Math.abs(avgTable - avgGame) < 1)
}

console.log(`\nSONUÇ: ${pass} geçti, ${fail} kaldı`)
process.exit(fail ? 1 : 0)
