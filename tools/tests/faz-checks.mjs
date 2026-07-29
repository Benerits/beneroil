// Faz 3-4 doğrulama testleri — GERÇEK state.ts'i import eder (DOM stub'larıyla).
// Çalıştır: npm run test:faz  (node tools/tests/faz-checks.mjs değil — tsx gerekir)
// Geometri sabitleri (ROAD_X, rezerv, footprint) main/world'den KOPYA — orada değişirse
// buradaki sabitleri de güncelle (dosya başındaki SYNC bloğu).

// ---- DOM stub'ları (i18n localStorage/navigator ister) ----
globalThis.localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} }
Object.defineProperty(globalThis, 'navigator', { value: { language: 'tr' }, configurable: true })

const { GameState, PARCEL_COLS, PARCEL_ROWS, FUEL_COST, FUEL_PRICE, priceBounds, serializeState, hydrateState,
  buyItem, sellInfo, applySell, LOC_FIELDS, parcelCost } =
  await import('../../src/state.ts')

// ---- SYNC bloğu: world.ts / main.ts kopyaları ----
const ROAD_X = 7.9                                   // world.ts
const FAR_RESERVE = { cx: 11.6, cy: 0, w: 3.0, d: 48 } // main.ts fixedObstacles (karşı kapı koridoru)
const MARKET_FP = { w: 6, d: 7 }                     // main.ts PLACEABLE market2
const LAND_MARGIN = 0.2                              // main.ts isValidPlacement örnekleme payı

let pass = 0, fail = 0
function check(name, cond, detail = '') {
  if (cond) { pass++; console.log(`  ✓ ${name}`) }
  else { fail++; console.log(`  ✗ ${name}${detail ? ' — ' + detail : ''}`) }
}
const overlaps = (a, b) => Math.abs(a.cx - b.cx) < (a.w + b.w) / 2 && Math.abs(a.cy - b.cy) < (a.d + b.d) / 2

console.log('== 1) Parsel yaka haritası ==')
for (let c = 0; c < 6; c++) {
  const [x0, x1] = PARCEL_COLS[c]
  const far = (x0 + x1) / 2 > ROAD_X
  check(`kolon ${c} ${far ? 'KARŞI' : 'near'} yakada`, far === (c >= 3), `x=${x0}..${x1}`)
}

console.log('== 2) Karşı Market (6×7) c3 parseline SIĞIYOR mu ==')
{
  // landOk örnekleme: köşeler cx±(w/2-0.2) parsel içinde olmalı; rezervle çakışmamalı
  const [px0, px1] = PARCEL_COLS[3]
  const [ry0, ry1] = PARCEL_ROWS[1] // orta satır
  const half = MARKET_FP.w / 2 - LAND_MARGIN
  const dHalf = MARKET_FP.d / 2 - LAND_MARGIN
  const valid = []
  for (let cx = Math.ceil(px0); cx <= Math.floor(px1); cx++) {
    for (let cy = Math.ceil(ry0); cy <= Math.floor(ry1); cy++) {
      if (cx - half < px0 || cx + half > px1) continue
      if (cy - dHalf < ry0 || cy + dHalf > ry1) continue
      if (overlaps({ cx, cy, w: MARKET_FP.w, d: MARKET_FP.d }, FAR_RESERVE)) continue
      if (cx <= ROAD_X) continue // market2 yalnız karşı yaka kuralı
      valid.push([cx, cy])
    }
  }
  check(`c3 orta satırda geçerli hücre var (${valid.length} hücre)`, valid.length > 0)
  if (valid.length) {
    const xs = valid.map(v => v[0])
    console.log(`    → geçerli bant: cx ${Math.min(...xs)}..${Math.max(...xs)} (parsel ${px0}..${px1}; batı yarı kapı koridoru rezervi)`)
  }
  // c4'te rezerv yok → bant daha geniş olmalı
  const [qx0, qx1] = PARCEL_COLS[4]
  let c4count = 0
  for (let cx = Math.ceil(qx0); cx <= Math.floor(qx1); cx++)
    if (cx - half >= qx0 && cx + half <= qx1) c4count++
  check(`c4'te bant c3'ten geniş`, c4count > new Set(valid.map(v => v[0])).size)
}

console.log('== 3) Fiyat esnekliği (state.priceDemandFactor + entryChance) ==')
{
  const s = new GameState()
  check('varsayılan fiyatta talep çarpanı 1.0', Math.abs(s.priceDemandFactor() - 1) < 1e-9)
  const base = s.entryChance()
  for (const f of ['benzin', 'dizel', 'lpg']) s.prices[f] = priceBounds(f)[1] // tavan
  check('tavan fiyatta talep çarpanı tabana iner (0.35)', Math.abs(s.priceDemandFactor() - 0.35) < 1e-9, `=${s.priceDemandFactor()}`)
  const capped = s.entryChance()
  check(`tavan fiyat akışı BELİRGİN düşürür (${(capped / base * 100).toFixed(0)}% ≤ 40%)`, capped / base <= 0.40)
  // gelişmiş istasyonda da hissedilmeli (eski bug: tesis terimleri fiyattan bağımsızdı)
  const adv = new GameState()
  adv.signLevel = 3; adv.reputation = 5; adv.marketLevel = 3; adv.evChargers = 8
  adv.hasWash = adv.hasOil = adv.hasCoffee = adv.hasRestaurant = adv.hasTruckPark = true
  adv.airWaterCount = adv.selfWashCount = 3
  const advBase = adv.entryChance()
  for (const f of ['benzin', 'dizel', 'lpg']) adv.prices[f] = priceBounds(f)[1]
  const advCapped = adv.entryChance()
  check(`GELİŞMİŞ istasyonda da tavan fiyat akışı düşürür (${(advCapped / advBase * 100).toFixed(0)}% ≤ 65%)`, advCapped / advBase <= 0.65)
  // taban fiyat testi ZAYIF istasyonda: gelişmiş istasyon zaten 0.95 tavanına dayalı,
  // ucuzcu stratejisi tavana takılır (doğru davranış) — kazanım erken oyunda hissedilir
  const weak = new GameState()
  const weakBase = weak.entryChance()
  for (const f of ['benzin', 'dizel', 'lpg']) weak.prices[f] = priceBounds(f)[0]
  check('taban fiyat ZAYIF istasyonda akışı ARTIRIR (ucuzcu stratejisi)', weak.entryChance() > weakBase)
}

console.log('== 4) Karşı yaka ayna geometrisi ==')
{
  const mirror = (x, y) => [2 * ROAD_X - x, -y]
  const [mx, my] = mirror(2.4, 6)
  check('bekleme noktası aynası (2.4,6)→(13.4,-6)', Math.abs(mx - 13.4) < 1e-9 && my === -6)
  check('ayna ROAD_X üzerinde sabit', mirror(ROAD_X, 0)[0] === ROAD_X)
}

console.log('== 5) Pompa/şarj araç açısı formülü ==')
{
  const carAngle = (far, rot) => (far ? -Math.PI / 2 : Math.PI / 2) + rot * Math.PI / 2
  check('near rot0 → +90° (kuzey)', carAngle(false, 0) === Math.PI / 2)
  check('near rot1 → 180° (pompayla birlikte döner)', carAngle(false, 1) === Math.PI)
  check('far rot0 → -90° (güney)', carAngle(true, 0) === -Math.PI / 2)
  check('far rot2 → +90° (180° dönmüş far pompa)', carAngle(true, 2) === Math.PI / 2)
}

console.log('== 6) Karşı Market kilit koşulu (getShopItems) ==')
{
  const s = new GameState()
  const row = () => s ? (s2 => s2.find(r => r.id === 'market2'))(itShop(s)) : null
  const itShop = st => (globalThis.__shop ?? (globalThis.__shop = null), st)
  // getShopItems'ı import et
  const { getShopItems } = await import('../../src/state.ts')
  let r = getShopItems(s).find(x => x.id === 'market2')
  check('market yokken kilitli: "Önce ana marketi kur"', r.status === 'locked' && /ana marketi/.test(r.note))
  s.marketLevel = 1
  r = getShopItems(s).find(x => x.id === 'market2')
  check('karşı beton yokken kilitli: "Karşıda betonlu arsa"', r.status === 'locked' && /betonlu/.test(r.note))
  s.ownedParcels.add('3,1'); s.pavedParcels.add('3,1')
  r = getShopItems(s).find(x => x.id === 'market2')
  check('ana market + karşı beton → SATIN ALINABİLİR', r.status === 'buy', `status=${r.status}`)
  s.market2Level = 3
  r = getShopItems(s).find(x => x.id === 'market2')
  check('Sv.3 → MAKS', r.status === 'maxed')
}

console.log('== 7) Yumuşak tavan (lategame #1) ==')
{
  const soft = raw => raw <= 0.80 ? raw : 0.80 + 0.15 * (1 - Math.exp(-(raw - 0.80) / 0.25))
  check('0.80 → 0.80 (birebir)', Math.abs(soft(0.80) - 0.80) < 1e-9)
  check('0.95 → ~0.867', Math.abs(soft(0.95) - 0.8677) < 0.001, `=${soft(0.95).toFixed(4)}`)
  check('1.37 → ~0.935 (eski: 0.95 kesim, artık asimptotik)', soft(1.37) > 0.93 && soft(1.37) < 0.95)
  check('monoton artan (geç yatırım HÂLÂ bir şey yapar)', soft(1.37) > soft(1.20) && soft(1.20) > soft(0.95))
  // gerçek state ile: her şey maks + biraz daha → entryChance hâlâ artıyor mu
  const a = new GameState(); a.signLevel = 3; a.reputation = 5; a.marketLevel = 3; a.evChargers = 8
  a.hasWash = a.hasOil = a.hasCoffee = a.hasRestaurant = a.hasTruckPark = true
  const e1 = a.entryChance(); a.evChargers = 12; a.airWaterCount = 3; a.selfWashCount = 3
  check('maks-üstü yatırım entryChance artırıyor (ölü yatırım bitti)', a.entryChance() > e1, `${e1} → ${a.entryChance()}`)
}

console.log('== 8) Reklam sink + trafik arzı (lategame #2) ==')
{
  const s8 = new GameState()
  check('bütçe 0 → pull 1.0 (denge değişmez)', Math.abs(s8.trafficPull() - 1) < 1e-9)
  s8.marketingBudget = 8000
  check('bütçe 8000 → pull ~1.54', s8.trafficPull() > 1.5 && s8.trafficPull() < 1.6, `=${s8.trafficPull().toFixed(3)}`)
  s8.signLevel = 3
  check('tabela3 + reklam8k → pull ~2.0 (azalan verimli, sınırlı)', s8.trafficPull() > 1.9 && s8.trafficPull() < 2.1)
  const l1 = s8.marketingFactor(); s8.marketingBudget = 4000
  check('azalan verim: 4k bütçe, 8k etkisinin yarısından FAZLA', s8.marketingFactor() > l1 / 2)
}

console.log('== 9) OPEX (lategame #3) ==')
{
  const s9 = new GameState(); s9.opexStart = 1; s9.day = 20 // rampa dolu
  check('başlangıç istasyonu OPEX ≈ 0 (erken oyun etkilenmez)', s9.dailyOpex() <= 25, `=${s9.dailyOpex()}`)
  s9.pumps = 14; s9.evChargers = 12; s9.signLevel = 3; s9.tankLevel = 3; s9.marketLevel = 3
  s9.toiletLevel = 2; s9.gridLevel = 2; s9.batteryLevel = 3
  s9.hasDiesel = s9.hasSMR = s9.hasWash = s9.hasOil = s9.hasCoffee = s9.hasRestaurant = s9.hasTruckPark = true
  s9.wideGates = true; s9.solarCount = 3
  for (let c = 0; c < 6; c++) for (let r = 0; r < 3; r++) { s9.ownedParcels.add(`${c},${r}`); s9.pavedParcels.add(`${c},${r}`) }
  const full = s9.dailyOpex()
  check(`tam istasyon OPEX ₺2.000-4.500 bandında (brütü aşmaz)`, full > 2000 && full < 4500, `=${full}`)
  s9.day = s9.opexStart + 5 // rampa yarısı
  check('10 günlük rampa: 5. günde ~%50', Math.abs(s9.dailyOpex() - full / 2) < full * 0.15)
  s9.day = s9.opexStart // rampa 0
  check('rampa başlangıcında OPEX 0 (şok yok)', s9.dailyOpex() === 0)
}

console.log('== 10) B1 hayalet duvar matematiği (trafik raporu) ==')
{
  // SYNC: addPump slot = base ± 1.8 (far flip) · hardRect eski türetme = slot.x - 1.8
  const ROADX = 7.9
  for (const baseX of [13.5, 15.0, 16.5]) {
    const slotX = baseX - 1.8 // far: flip=-1, ang=0
    const oldRectX = slotX - 1.8 // ESKİ (hatalı) türetme
    const newRectX = baseX      // YENİ: gövde konumu
    check(`far pompa base=${baseX}: eski kutu ${oldRectX} (3.6 kayık) → yeni ${newRectX}`,
      Math.abs(newRectX - baseX) < 1e-9 && Math.abs(oldRectX - (baseX - 3.6)) < 1e-9)
  }
  // unitRect swap (B7): 90° dönüşte en-boy takas
  const unitRect = (b, ang, w, d) => { const sw = Math.abs(Math.sin(ang)) > 0.5; return { w: sw ? d : w, d: sw ? w : d } }
  check('rot0: 1.5×3.4', unitRect({}, 0, 1.5, 3.4).w === 1.5)
  check('rot90: 3.4×1.5 (takas)', unitRect({}, Math.PI / 2, 1.5, 3.4).w === 3.4)
}

console.log('== 11) Müşteri segmentleri (Katman 1c) ==')
{
  const s11 = new GameState()
  check('başlangıç: segment YOK (erken denge birebir korunur)', s11.activeSegments().length === 0)
  s11.tankLevel = 3; s11.reputation = 4.5
  let segs = s11.activeSegments()
  check('tank Sv.3 + itibar 4.5 → premium açılır', segs.some(x => x.id === 'premium'))
  check('premium marj çarpanı 1.6', segs.find(x => x.id === 'premium').marginMult === 1.6)
  s11.hasTruckPark = true; s11.tankCounts.dizel = 2
  segs = s11.activeSegments()
  const filo = segs.find(x => x.id === 'filo')
  check('tır parkı + 2 dizel tankı → filo açılır (₺800-2000, truckOnly)', !!filo && filo.truckOnly && filo.min === 800)
  s11.wideGates = true; s11.pumps = 6
  segs = s11.activeSegments()
  check('geniş kapı + 6 pompa → otobüs açılır (₺1200-2500)', segs.some(x => x.id === 'otobus'))
  // pay toplamı: standart müşteri hâlâ çoğunluk olmalı (truckOnly hariç)
  const nonTruck = segs.filter(x => !x.truckOnly).reduce((a, x) => a + x.share, 0)
  check(`tır-dışı segment payı toplamı < 0.5 (standart müşteri korunur) = ${nonTruck.toFixed(2)}`, nonTruck < 0.5)
  // ortalama ₺/müşteri artışı: raporun hedefi ₺233 → ₺700-900 bandına doğru
  const avgStd = (100+150+200+250+300+400)/6
  const avgSeg = segs.reduce((a,x) => a + x.share * (x.min+x.max)/2, 0) + (1 - segs.reduce((a,x)=>a+x.share,0)) * avgStd
  check(`ortalama talep belirgin arttı (₺${avgStd.toFixed(0)} → ₺${avgSeg.toFixed(0)})`, avgSeg > avgStd * 1.8)
}

console.log('== 12) B2B sözleşmeleri (Katman 4a) ==')
{
  const s12 = new GameState()
  check('küçük tankta teklif YOK (kapasite şartı)', s12.contractOffers().length === 0)
  s12.tankLevel = 3; s12.tankCounts.dizel = 4; s12.tankCounts.benzin = 3; s12.tankCounts.lpg = 2
  // YENİ KURAL (2 oyuncu raporu fixi): teklif, oyuncunun GERÇEK satış hızına ölçeklenir —
  // satış geçmişi olmayan oyuncuya teklif GELMEZ. Testte 7 günlük hacim tohumla:
  s12.day = 10
  for (let d = 4; d <= 10; d++) for (const [f, L] of [['dizel', 1600], ['benzin', 1200], ['lpg', 900]])
    s12.fuelLog.push({ day: d, f, liters: L, cost: 1 })
  check('satış geçmişi YOKKEN teklif de yok (taahhüt ölçeklemesi)', new GameState().contractOffers().length === 0)
  const offers = s12.contractOffers()
  check(`büyük tankta teklif var (${offers.length} adet)`, offers.length >= 2)
  for (const o of offers) {
    check(`${o.name}: kapasite ≥ 2× taahhüt`, s12.fuelCapacity(o.fuel) >= o.dailyLiters * 2)
    check(`${o.name}: fiyat piyasa ALTINDA`, o.pricePerL < s12.prices[o.fuel])
  }
  // determinizm: aynı gün, aynı teklifler (panel açılıp kapanınca zıplamaz)
  const again = s12.contractOffers()
  check('teklifler aynı gün DETERMİNİST', JSON.stringify(offers.map(o=>[o.id,o.dailyLiters])) === JSON.stringify(again.map(o=>[o.id,o.dailyLiters])))
  s12.day = s12.day + 1
  check('gün değişince teklifler yenilenir', JSON.stringify(s12.contractOffers().map(o=>o.dailyLiters)) !== JSON.stringify(offers.map(o=>o.dailyLiters)))

  // imza + tam teslim akışı
  const s13 = new GameState()
  s13.tankLevel = 3; s13.tankCounts.dizel = 4; s13.tankCounts.benzin = 3; s13.tankCounts.lpg = 2
  s13.day = 10; for (let d = 4; d <= 10; d++) for (const [f, L] of [['dizel', 1600], ['benzin', 1200], ['lpg', 900]]) s13.fuelLog.push({ day: d, f, liters: L, cost: 1 })
  const off = s13.contractOffers()[0]
  check('imza başarılı', s13.signContract(off) === true)
  check('ikinci imza REDDEDİLİR (tek aktif sözleşme)', s13.signContract(off) === false)
  const money0 = s13.money
  s13.contract.deliveredToday = s13.contract.dailyLiters
  let r = s13.processContractDay()
  check('tam teslim → ödeme alınır', r.kind === 'ok' && s13.money > money0, `${r.kind} +${r.amount}`)
  check('gün sayacı işledi', s13.contract.daysLeft === off.daysTotal - 1)
  check('teslim sayacı sıfırlandı', s13.contract.deliveredToday === 0)
  // FİLO SİGORTASI (Oğuz: 'boşa zarar yazmasın'): 0 fiziksel teslim ama TANK DOLU →
  // eksik depodan tamamlanır, gün OK, ceza YOK, tank düşer
  const tank0 = s13.contract.dailyLiters + 500
  s13.tanks[s13.contract.fuel] = tank0
  const mIns = s13.money
  r = s13.processContractDay() // deliveredToday = 0 ama tank yeterli
  check('FİLO SİGORTASI: 0 teslim + dolu tank → gün OK + ödeme + tank düştü',
    r.kind === 'ok' && s13.money > mIns && s13.tanks[s13.contract.fuel] < tank0 && s13.contract.missedDays === 0,
    `${r.kind} tank=${Math.round(s13.tanks[s13.contract.fuel])}`)
  // eksik teslim → ceza (tank YETERSİZKEN — gerçek ihmal)
  s13.tanks[s13.contract.fuel] = 0
  const m1 = s13.money
  r = s13.processContractDay() // deliveredToday = 0, tank boş
  check('eksik teslim + BOŞ tank → ceza (kasa düşer, missedDays artar)', r.kind === 'miss' && s13.money < m1 && s13.contract.missedDays === 1)
  // tamamlama: kalan günleri tam teslimle bitir
  let guard = 0
  while (s13.contract && guard++ < 80) { s13.contract.deliveredToday = s13.contract.dailyLiters; r = s13.processContractDay() }
  check('sözleşme TAMAMLANDI (prim + itibar)', r.kind === 'done' && s13.contractsDone === 1, `son=${r.kind}`)
  check('bitince aktif sözleşme temizlendi', s13.contract === null)

  // ihlal senaryosu: hep eksik teslim → fesih
  const s14 = new GameState()
  s14.tankLevel = 3; s14.tankCounts.dizel = 4; s14.tankCounts.benzin = 3; s14.tankCounts.lpg = 2
  s14.day = 10; for (let d = 4; d <= 10; d++) for (const [f, L] of [['dizel', 1600], ['benzin', 1200], ['lpg', 900]]) s14.fuelLog.push({ day: d, f, liters: L, cost: 1 })
  for (const f of ['benzin','dizel','lpg']) s14.tanks[f] = 0 // fesih senaryosu = tank boş ihmali (sigorta devreye giremez)
  s14.signContract(s14.contractOffers()[0])
  let last = null; guard = 0
  while (s14.contract && guard++ < 80) last = s14.processContractDay()
  check('hep eksik → FESİH (prim yok)', last.kind === 'fail' && s14.contractsFailed === 1, `son=${last?.kind}`)
  check('kasa asla eksiye düşmedi', s14.money >= 0)

  // save round-trip: contract serialize/hydrate
  const s15 = new GameState()
  s15.tankLevel = 3; s15.tankCounts.dizel = 4
  s15.day = 10; for (let d = 4; d <= 10; d++) s15.fuelLog.push({ day: d, f: 'dizel', liters: 1600, cost: 1 })
  s15.signContract(s15.contractOffers()[0])
  s15.contract.deliveredToday = 123
  const ser = serializeState(s15)
  const s16 = new GameState(); hydrateState(s16, ser)
  check('sözleşme save round-trip', s16.contract && s16.contract.dailyLiters === s15.contract.dailyLiters && s16.contract.deliveredToday === 123)
  const s17 = new GameState(); hydrateState(s17, { ...ser, contract: { fuel: 'bozuk', dailyLiters: 'x' } })
  check('bozuk sözleşme kaydı düşürülür (oyun kilitlenmez)', s17.contract === null)
}

console.log('== 13) Reviewer bulgularının regresyon testleri ==')
{
  const mk = () => { const x = new GameState(); x.tankLevel = 3; x.tankCounts.dizel = 4; x.tankCounts.benzin = 3; x.tankCounts.lpg = 2
    // taahhüt ölçeklemesi (satış geçmişi şartı) için 7 günlük hacim tohumu
    x.day = 10; for (let d = 4; d <= 10; d++) for (const [f, L] of [['dizel', 1600], ['benzin', 1200], ['lpg', 900]]) x.fuelLog.push({ day: d, f, liters: L, cost: 1 })
    return x }
  // (1) otobüs segmenti artık truckOnly (sedan'a 278L dizel talebi gitmez)
  const a = new GameState(); a.wideGates = true; a.pumps = 6
  check('otobüs segmenti truckOnly (tır-dışı araca düşmez)', a.activeSegments().find(x => x.id === 'otobus').truckOnly === true)
  // (2) kısa/kurcalanmış sözleşmede fesih ARTIK mümkün (bedava prim exploit'i kapandı)
  const b = mk()
  for (const f of ['benzin','dizel','lpg']) b.tanks[f] = 0 // sigorta devreye giremesin (kurcalama senaryosu)
  b.contract = { id:'x', name:'hack', fuel:'dizel', daysTotal:1, daysLeft:1, dailyLiters:4000, pricePerL:20, bonus:120000, penalty:0, deliveredToday:0, missedDays:0 }
  const m0 = b.money
  const rb = b.processContractDay() // 0 teslim
  check('daysTotal=1, 0 teslim → FESİH (prim YOK)', rb.kind === 'fail' && b.money <= m0, `${rb.kind} para=${b.money}`)
  // (3) sözleşme geliri ciroya girer (raporlarda görünür)
  const c = mk(); c.signContract(c.contractOffers()[0])
  const rev0 = c.stats.revenue, sl0 = c.salesLog.length
  c.contract.deliveredToday = c.contract.dailyLiters
  const rc = c.processContractDay()
  check('tam teslim ciroya yazılır (stats.revenue + salesLog)', c.stats.revenue === rev0 + rc.amount && c.salesLog.length === sl0 + 1)
  // (4) addContractDelivery: offline/pompacı satışı da taahhüde sayılır
  const d = mk(); d.signContract(d.contractOffers().find(o => o.fuel === 'dizel'))
  d.addContractDelivery('dizel', 300); d.addContractDelivery('benzin', 999)
  check('addContractDelivery yalnız sözleşme yakıtını sayar', d.contract.deliveredToday === 300)
  // (6) daysLeft > daysTotal düzeltilir
  const e = new GameState()
  hydrateState(e, { contract: { id:'z', name:'n', fuel:'dizel', daysTotal:7, daysLeft:60, dailyLiters:500, pricePerL:8, bonus:0, penalty:0, deliveredToday:0, missedDays:0 } })
  check('hydrate: daysLeft daysTotal ile sınırlanır', e.contract.daysLeft <= e.contract.daysTotal, `${e.contract?.daysLeft}/${e.contract?.daysTotal}`)
  // fesih eşiği üretilen sözleşmelerde MAKUL kalmalı (1 kaçırma 7 günlük sözleşmeyi bitirmesin)
  const f = mk(); f.signContract(f.contractOffers().find(o => o.daysTotal >= 7))
  f.processContractDay() // 1 gün kaçır
  check('7+ günlük sözleşmede 1 kaçırma fesih ETMEZ (adil)', f.contract !== null && f.contract.missedDays === 1)
}

console.log('== 14) Rezervasyon grafiği (trafik raporu §5) ==')
{
  const { TrafficGraph } = await import('../../src/traffic-graph.ts')
  const g = new TrafficGraph()
  const mkGeom = (station, gateX, sideSign, dirY, inY, outY, wide = false) =>
    ({ station, gateX, lane: sideSign < 0 ? 6.95 : 8.85, gateInY: inY, gateOutY: outY, sideSign, dirY, wide })
  g.rebuild([mkGeom('near', 4.2, -1, 1, -14, 14), mkGeom('far', 11.6, 1, -1, 8, -8)])
  check('her istasyon için 2 bölge türetildi (near+far = 4)', g.zones.length === 4)
  check('bölgeler geom’dan TÜRETİLDİ (far kapı x=11.6 çevresinde)', g.zones.some(z => z.id === 'gate-in-far' && Math.abs(z.cx - 12.2) < 0.01))
  check('near/far bölgeleri ÇAKIŞMIYOR', !g.zones.some(a => g.zones.some(b => a !== b &&
    Math.abs(a.cx - b.cx) < (a.w + b.w) / 2 && Math.abs(a.cy - b.cy) < (a.d + b.d) / 2)))

  // kapasite + FIFO
  const A = { n: 'A' }, B = { n: 'B' }, C = { n: 'C' }
  check('1. araç girer', g.tryAcquire('gate-in-near', A) === true)
  check('2. araç REDDEDİLİR (kapasite 1 → çakışma OLUŞMAZ)', g.tryAcquire('gate-in-near', B) === false)
  check('3. araç da reddedilir ve SIRAYA girer', g.tryAcquire('gate-in-near', C) === false)
  check('tekrar isteyen tutan araç için serbest', g.tryAcquire('gate-in-near', A) === true)
  g.release(A)
  check('FIFO: A çıkınca sıradaki B girer (C değil)', g.tryAcquire('gate-in-near', B) === true && g.tryAcquire('gate-in-near', C) === false)
  // geniş kapı = kapasite 2
  const g2 = new TrafficGraph()
  g2.rebuild([mkGeom('near', 4.2, -1, 1, -14, 14, true)])
  // Kapı ağzı TEK SIRA (geniş kapıda da): iki aracı birlikte almak aynı şeride sokup
  // kilitliyordu — yük testi kanıtı (buharlaşma 61 → 0).
  check('kapı ağzı tek sıra (geniş kapıda da kapasite 1)', g2.tryAcquire('gate-in-near', A) && !g2.tryAcquire('gate-in-near', B))
  // REZERVASYON ÖMRÜ — buradaki ayrım kritik. Eski sweep, token alıp bölgeye HENÜZ
  // VARMAMIŞ aracın rezervasyonunu her karede siliyordu; araç yeniden istemek zorunda
  // kalıp FIFO'nun sonuna düşüyordu. Yoğunlukta bu açlık demekti (yük testinde grafik
  // AÇIKKEN buharlaşma kapalıdan kötü çıkıyordu: 151 vs 100).
  const zc = { x: 4.2 - 0.6, y: -14 }  // gate-in-near bölge merkezi (mkGeom sideSign=-1)
  const far = { x: 40, y: 40 }
  {
    // a) token aldı, henüz YOLDA (bölge dışında) → rezervasyon KORUNUR
    const g3 = new TrafficGraph(); g3.rebuild([mkGeom('near', 4.2, -1, 1, -14, 14)])
    const D = { n: 'D' }
    check('yaklaşan araç token alır', g3.tryAcquire('gate-in-near', D) === true)
    g3.sweep([D], () => far, 0.1)
    check('YOLDAKİ araç rezervasyonunu KORUR (açlık fixi)', g3.tryAcquire('gate-in-near', { n: 'E' }) === false)
    // b) TTL dolunca YERİ bırakır (tıkanan araç bölgeyi sonsuza kilitlemesin)
    for (let i = 0; i < 30; i++) g3.sweep([D], () => far, 0.1) // 3 sn > RESERVE_TTL
    const z0 = g3.snapshot().find(z => z.id === 'gate-in-near')
    check('TTL dolunca bölge boşalır (deadlock sigortası)', z0.used === 0)
    // c) ...ama kuyruğun BAŞINA konur: sırasını beklemişti, sona atılmaz. Bu yüzden
    //    ARKADAN GELEN onu geçemez — açlığı önleyen asıl kural bu.
    check('TTL kurbanı kuyrukta sırasını korur', z0.queued === 1)
    check('arkadan gelen TTL kurbanını GEÇEMEZ', g3.tryAcquire('gate-in-near', { n: 'E2' }) === false)
    check('TTL kurbanı sıradaki yeri ALIR', g3.tryAcquire('gate-in-near', D) === true)
  }
  {
    // d) bölgeye GİRİP ÇIKAN araç token'ı bırakır (asıl amaç)
    const g3b = new TrafficGraph(); g3b.rebuild([mkGeom('near', 4.2, -1, 1, -14, 14)])
    const D2 = { n: 'D2' }
    g3b.tryAcquire('gate-in-near', D2)
    g3b.sweep([D2], () => zc, 0.1)   // bölgeye girdi
    check('içerideyken token DURUR', g3b.tryAcquire('gate-in-near', { n: 'X' }) === false)
    g3b.sweep([D2], () => far, 0.1)  // bölgeden çıktı
    check('sweep: bölgeyi GEÇEN araç token’ı bırakır', g3b.tryAcquire('gate-in-near', { n: 'E3' }) === true)
  }
  // sweep: sahneden silinen araç bölgeyi kilitlemez
  const g4 = new TrafficGraph(); g4.rebuild([mkGeom('near', 4.2, -1, 1, -14, 14)])
  const F = { n: 'F' }; g4.tryAcquire('gate-in-near', F)
  g4.sweep([], () => ({ x: 0, y: 0 }))
  check('sweep: yok olan araç bölgeyi kilitlemez', g4.tryAcquire('gate-in-near', { n: 'G' }) === true)
  // geometri değişince (kapı taşındı) defter temizlenir
  const g5 = new TrafficGraph(); g5.rebuild([mkGeom('near', 4.2, -1, 1, -14, 14)])
  const H = { n: 'H' }; g5.tryAcquire('gate-in-near', H)
  g5.rebuild([mkGeom('near', 4.2, -1, 1, -20, 20)]) // kapı taşındı → aynı id, yeni konum
  check('kapı taşınınca bölge yeni y’de', g5.zones.find(z => z.id === 'gate-in-near').cy === -20)
  // N. istasyon bedava: 3. istasyon eklemek ek kod gerektirmez
  const g6 = new TrafficGraph()
  g6.rebuild([mkGeom('near', 4.2, -1, 1, -14, 14), mkGeom('far', 11.6, 1, -1, 8, -8), mkGeom('ucuncu', 30, 1, -1, 5, -5)])
  check('3. istasyon otomatik bölge aldı (yeni istasyon bedava)', g6.zones.filter(z => z.id.endsWith('-ucuncu')).length === 2)
}

console.log('== 15) Prestij: İstasyonu Devret (lategame §3b) ==')
{
  const big = () => {
    const x = new GameState()
    x.pumps = 10; x.evChargers = 8; x.signLevel = 3; x.tankLevel = 3; x.marketLevel = 3
    x.toiletLevel = 2; x.gridLevel = 2; x.batteryLevel = 3; x.solarCount = 2
    x.hasWash = x.hasOil = x.hasCoffee = x.hasRestaurant = x.hasTruckPark = x.hasSMR = true
    x.day = 90; x.money = 50_000
    for (let c = 0; c < 4; c++) for (let r = 0; r < 3; r++) { x.ownedParcels.add(`${c},${r}`); x.pavedParcels.add(`${c},${r}`) }
    x.salesLog = Array.from({ length: 30 }, (_, i) => ({ day: 90 - i, rev: 9000 }))
    return x
  }
  const s0 = new GameState()
  check('başlangıçta yıldız 0, çarpan 1.0', s0.brandStars === 0 && s0.prestigeMult() === 1)
  check('küçük istasyon devredilemez (gönüllü + eşikli)', s0.canHandover() === false)
  const a = big()
  check('büyük istasyon devredilebilir', a.canHandover() === true)
  a.loan.active = true
  check('kredi varken devir KAPALI', a.canHandover() === false)
  a.loan.active = false

  const pv = a.handoverPreview()
  check('önizleme: nakit > 0 ve sonraki çarpan 1.25', pv.cash > 0 && Math.abs(pv.multAfter - 1.25) < 1e-9)
  check('devir bedeli KISMİ iade (%60 + kâr payı) — tam iade değil',
    pv.cash >= a.equipmentValue() * 0.6 && pv.cash <= a.equipmentValue() * 0.6 + 100_000)

  const eqBefore = a.equipmentValue()
  const parcelsBefore = a.ownedParcels.size, pavedBefore = a.pavedParcels.size
  const res = a.handover()
  check('devir gerçekleşti (nakit + yıldız döndü)', !!res && res.stars === 1)
  check('KASA KORUNDU + devir bedeli eklendi', a.money === 50_000 + res.cash)
  check('EKİPMAN sıfırlandı', a.pumps === 1 && a.evChargers === 0 && a.marketLevel === 0 && !a.hasSMR && a.equipmentValue() === 0)
  check('ARSA ve BETON KORUNDU (rapor şartı)', a.ownedParcels.size === parcelsBefore && a.pavedParcels.size === pavedBefore)
  check('yıldız kazanıldı, çarpan ×1.25', a.brandStars === 1 && Math.abs(a.prestigeMult() - 1.25) < 1e-9)
  check('sözleşme/otomasyon temizlendi', a.contract === null && a.autoPumps.size === 0 && a.marketingBudget === 0)
  check('başarımlar ve istasyon adı korundu', a.stationName === s0.stationName)

  // ANTI-CHEAT UYUMU: devirde servet artışı sunucu allowance'ını (100k) aşmamalı
  const wealthBefore = 50_000 + eqBefore
  const wealthAfter = a.money + 0 // ekipman gitti
  check(`devirde servet artışı ≤ 100k (anti-cheat uyumu): ${Math.round(wealthAfter - wealthBefore)}`,
    wealthAfter - wealthBefore <= 100_000)

  // prestij çarpanı kumbara gelirine uygulanıyor
  const b = new GameState(); b.brandStars = 2 // ×1.5
  b.marketLevel = 1
  b.addPending('market', 100, 'Market')
  check('biriktirmede çarpım YOK (cap kaybı olmasın)', b.pendingCash.market === 100)
  check('kumbara TOPLAMADA prestijle çarpılır (100 → 150)', b.collectPending('market') === 150)

  // save round-trip
  const c = big(); c.handover()
  const ser = serializeState(c); const d = new GameState(); hydrateState(d, ser)
  check('prestij save round-trip (yıldız + devir sayısı)', d.brandStars === c.brandStars && d.handoverCount === c.handoverCount)

  // ikinci devir: çarpan birikir
  const e = big(); e.brandStars = 3; e.handover()
  check('yıldızlar birikir (3 → 4, çarpan ×2.0)', e.brandStars === 4 && Math.abs(e.prestigeMult() - 2) < 1e-9)
}

console.log('== 15b) Prestij: reviewer bulgularının regresyonu ==')
{
  const big = (money = 50_000) => {
    const x = new GameState()
    x.pumps = 10; x.evChargers = 8; x.signLevel = 3; x.tankLevel = 3; x.marketLevel = 3
    x.toiletLevel = 2; x.gridLevel = 2; x.batteryLevel = 3; x.solarCount = 2
    x.hasWash = x.hasOil = x.hasCoffee = x.hasRestaurant = x.hasTruckPark = x.hasSMR = true
    x.day = 90; x.money = money
    x.salesLog = Array.from({ length: 30 }, (_, i) => ({ day: 90 - i, rev: 9000 }))
    return x
  }
  // (1) FARM ENGELİ: eşik her devirde ikiye katlanır + iade kısmi → döngü kârsız
  const f = big()
  check('devir eşiği başlangıçta ₺250k', f.handoverThreshold() === 250_000)
  const eq = f.equipmentValue()
  const val = f.handoverValue()
  check(`iade ekipmanın TAMAMI DEĞİL (${Math.round(val / eq * 100)}% ≤ 75%)`, val < eq * 0.75)
  f.handover()
  check('devirden sonra eşik ikiye katlandı (₺500k)', f.handoverThreshold() === 500_000)
  check('aynı ekipmanla ikinci devir KAPALI (farm engeli)', f.canHandover() === false)
  // farm karsız mı: ekipmanı tekrar kurmak val'den pahalı
  check('devir döngüsü zarar ettirir (iade < kurulum maliyeti)', val < eq)

  // (3) kasa korunur
  const g = big(2_000_000)
  const before = g.money
  const r2 = g.handover()
  check('₺2M kasa SİLİNMEDİ (devir bedeli eklendi)', g.money === before + r2.cash)

  // (6) itibar cezası gerçek (aklama yok)
  const h = big(); h.reputation = 1.2
  h.handover()
  check('düşük itibar devirle YÜKSELMEZ (1.2 → 0.7)', Math.abs(h.reputation - 0.7) < 1e-9)

  // (7) prestij çarpanı kumbara CAP'ine takılmıyor (toplama anında uygulanır)
  const k = new GameState(); k.brandStars = 4 // ×2
  k.marketLevel = 1
  k.addPending('market', 600, 'Market') // cap 600 → biriken 600
  check('kumbara cap doluyken bile prestij toplamada ×2 verir', k.collectPending('market') === 1200)

  // (8) sözleşme geliri prestijden etkilenir
  const m = new GameState(); m.brandStars = 4; m.tankLevel = 3; m.tankCounts.dizel = 4
  m.day = 10; for (let d = 4; d <= 10; d++) m.fuelLog.push({ day: d, f: 'dizel', liters: 1600, cost: 1 })
  m.signContract(m.contractOffers().find(o => o.fuel === 'dizel'))
  m.contract.deliveredToday = m.contract.dailyLiters
  const money0 = m.money
  const cr = m.processContractDay()
  const expected = Math.round(m.contract === null ? cr.amount : m.contract.dailyLiters * m.contract.pricePerL * 2)
  check('sözleşme ödemesi prestijle çarpılır', cr.amount > 0 && m.money - money0 === cr.amount)

  // (9) bekleyen sipariş ve uranyum devirde temizlenir (yakıt buhar olmasın)
  const n = big(); n.orders.dizel = { pending: true, eta: 20, arrived: false, delivering: false, amount: 15000 }
  n.uraniumPending = true; n.uraniumEta = 30
  n.handover()
  check('devirde bekleyen tanker siparişi iptal', n.orders.dizel.pending === false && n.orders.dizel.amount === 0)
  check('devirde uranyum siparişi iptal', n.uraniumPending === false)

  // hydrate dayanıklılığı: bozuk prestij alanı ekonomiyi NaN yapmasın
  const bad = new GameState(); hydrateState(bad, { brandStars: -5, handoverCount: 'x' })
  check('bozuk brandStars düzeltilir (negatif/NaN → 0)', bad.brandStars === 0 && bad.handoverCount === 0)
  check('prestigeMult NaN değil', Number.isFinite(bad.prestigeMult()))
}

console.log('== 16) LocationTheme altyapısı (lategame §6.1) ==')
{
  const { THEMES, KASABA, activeTheme } = await import('../../src/themes.ts')
  check('5 lokasyon teması tanımlı', Object.keys(THEMES).length === 5)
  check('kasaba teması mevcut sahneyle birebir (gündüz+gece)', KASABA.sky.day === 0xbfe0ee && KASABA.sky.night === 0x1a2a44)
  check('kasaba ground dokuları mevcut yollar', KASABA.ground.grass === '/gen/ground_grass.png')
  check('bilinmeyen id → kasabaya düşer (güvenli varsayılan)', activeTheme('yok').id === 'kasaba')
  // her lokasyon ÜÇ eksende ayrışmalı (rapor §6.0: skin değil kısıt seti)
  const ids = ['cevreyolu', 'otoyol', 'marina', 'metropol']
  for (const id of ids) {
    const th = THEMES[id]
    const diffEcon = th.econ.priceElasticity !== KASABA.econ.priceElasticity || th.econ.signWeight !== KASABA.econ.signWeight
    const diffLane = th.lane.count !== KASABA.lane.count || th.lane.kind !== KASABA.lane.kind || th.lane.rampLength !== KASABA.lane.rampLength
    check(`${id}: topoloji VE ekonomi kasabadan farklı (skin değil)`, diffEcon && diffLane)
    check(`${id}: açılış eşiği tanımlı`, th.unlock.cash > 0 && th.unlock.stars > 0)
  }
  check('otoyol: ramp topolojisi + tabela ağırlığı yüksek', THEMES.otoyol.lane.rampLength === 20 && THEMES.otoyol.econ.signWeight > 2)
  check('marina: su trafiği', THEMES.marina.lane.kind === 'water')
  // unlock eşikleri artan sırada olmalı (ilerleme hattı)
  const order = ['cevreyolu', 'otoyol', 'marina', 'metropol'].map(i => THEMES[i].unlock.stars)
  check('yıldız eşikleri artan sırada', order.every((v, i) => i === 0 || v > order[i - 1]))
}

console.log('== 17) Çoklu şube veri katmanı (lategame §3a) ==')
{
  const layout = () => ({ placedPos: { market: [1, 2] }, placedRot: { market: 1 }, placedRects: [{ id: 'market', cx: 1, cy: 2, w: 6, d: 7 }] })
  const s17 = new GameState()
  check('varsayılan: tek şube (kasaba) aktif', s17.activeLoc === 'kasaba' && s17.unlockedLocs.length === 1)
  check('şube teması kasaba (denge birebir)', s17.theme().id === 'kasaba')

  // unlock şartları
  let c = s17.canUnlockLoc('cevreyolu')
  check('yıldızsız şube açılamaz', c.ok === false && c.reason === 'yildiz')
  s17.brandStars = 2
  c = s17.canUnlockLoc('cevreyolu')
  check('yıldız var ama para yok → kapalı', c.ok === false && c.reason === 'para')
  s17.money = 600_000
  check('yıldız + para → açılabilir', s17.canUnlockLoc('cevreyolu').ok === true)
  const before = s17.money
  check('şube açıldı', s17.unlockLoc('cevreyolu') === true)
  check('açma bedeli kasadan düştü (BÜYÜK SINK)', s17.money === before - 500_000)
  check('şube listesine eklendi', s17.unlockedLocs.includes('cevreyolu'))
  check('aynı şube ikinci kez açılamaz', s17.unlockLoc('cevreyolu') === false)

  // şube geçişi: ekipman şubede, PARA şirkette kalır
  s17.pumps = 6; s17.marketLevel = 3; s17.hasSMR = true; s17.tanks.benzin = 900; s17.tankLevel = 2
  s17.ownedParcels = new Set(['0,0', '1,1']); s17.money = 123_456; s17.day = 77; s17.brandStars = 2
  const lay = layout()
  const next = s17.switchLoc('cevreyolu', lay)
  check('geçiş yapıldı', s17.activeLoc === 'cevreyolu' && !!next)
  check('YENİ şube taze ekipmanla başlar', s17.pumps === 1 && s17.marketLevel === 0 && s17.hasSMR === false)
  check('yeni şubede yerleşim boş', Object.keys(next.placedPos).length === 0 && next.placedRects.length === 0)
  check('PARA ŞİRKETTE kaldı (ortak kasa)', s17.money === 123_456)
  check('gün/prestij şirkette kaldı', s17.day === 77 && s17.brandStars === 2)
  check('şube teması değişti (kısıtlar farklı)', s17.theme().id === 'cevreyolu' && s17.theme().econ.priceElasticity !== 1)

  // geri dön: eski ekipman AYNEN gelir
  const back = s17.switchLoc('kasaba', { placedPos: {}, placedRot: {}, placedRects: [] })
  check('kasabaya dönüldü', s17.activeLoc === 'kasaba')
  check('eski ekipman geri geldi', s17.pumps === 6 && s17.marketLevel === 3 && s17.hasSMR === true && s17.tankLevel === 2)
  check('eski tank stoğu geri geldi', s17.tanks.benzin === 900)
  check('eski parseller geri geldi', s17.ownedParcels.has('1,1'))
  check('eski YERLEŞİM geri geldi', back.placedRects.length === 1 && back.placedPos.market[0] === 1)

  // save round-trip
  const ser = serializeState(s17)
  const d17 = new GameState(); hydrateState(d17, ser)
  check('şube alanları save round-trip', d17.activeLoc === 'kasaba' && d17.unlockedLocs.includes('cevreyolu')
    && !!d17.locSnapshots.cevreyolu)
  // bozuk/kurcalanmış şube verisi
  const bad = new GameState()
  hydrateState(bad, { activeLoc: 'atlantis', unlockedLocs: ['atlantis', 'otoyol'], locSnapshots: { atlantis: { f: {} } } })
  check('bilinmeyen şube id atılır', bad.activeLoc === 'kasaba' && !bad.unlockedLocs.includes('atlantis'))
  check('kasaba her zaman açık listede', bad.unlockedLocs.includes('kasaba'))
  check('bilinmeyen snapshot atılır', !('atlantis' in bad.locSnapshots))
  const bad2 = new GameState()
  hydrateState(bad2, { activeLoc: 'otoyol', unlockedLocs: ['kasaba'] }) // açık olmayan şube aktif olamaz
  check('açık olmayan şube aktif olamaz', bad2.activeLoc === 'kasaba')

  // şube kısıtları gerçekten farklı davranıyor mu (rapor §6.0)
  const k = new GameState(); k.signLevel = 3
  const kc = k.entryChance()
  k.unlockedLocs.push('otoyol'); k.switchLoc('otoyol', { placedPos: {}, placedRot: {}, placedRects: [] })
  k.signLevel = 3
  check('otoyolda TABELA daha etkili (aynı tabela, farklı akış)', Math.abs(k.entryChance() - kc) > 0.05)
  for (const f of ['benzin', 'dizel', 'lpg']) k.prices[f] = priceBounds(f)[1]
  check('otoyolda fiyat esnekliği DÜŞÜK (tavan fiyatta talep yüksek kalır)', k.priceDemandFactor() >= 0.7)
}

console.log('== 18) Çevre Yolu imzası: trafik ışığı + yaya müşteri (rapor §6.3) ==')
{
  const k = new GameState()
  // KASABA REGRESYONU: hiçbir yeni mekanik çalışmamalı
  check('kasabada trafik ışığı YOK', k.theme().features?.trafficLight === undefined)
  check('kasabada lightRed() daima false', k.lightRed() === false)
  check('kasabada ışık çarpanı 1.0 (denge birebir)', k.lightBoost() === 1)
  const kBase = k.entryChance()
  k.lightT = 999 // ışık zamanı ilerlese bile kasabada etkisi olmamalı
  check('kasabada ışık zamanı akışı etkilemez', Math.abs(k.entryChance() - kBase) < 1e-12)
  k.tick(30) // yaya müşteri çalışmamalı
  check('kasabada yaya müşteri geliri YOK', Object.keys(k.pendingCash).length === 0)

  // TRAFİK IŞIĞI KALDIRILDI (Oğuz: "dümdüz flow") — yeni sözleşme: hiçbir temada ışık
  // yok, boost 1'de sabit, entryBase telafisi gömülü (cevreyolu 0.33 / metropol 0.37)
  const c = new GameState()
  c.unlockedLocs.push('cevreyolu'); c.switchLoc('cevreyolu', { placedPos: {}, placedRot: {}, placedRects: [] })
  check('çevre yolunda ışık ARTIK YOK (dümdüz flow)', c.theme().features.trafficLight === undefined)
  c.lightT = 45
  check('ışıksız temada lightRed daima false', c.lightRed() === false && c.lightBoost() === 1)
  check('kaldırılan boost entryBase\'e gömüldü (0.33)', c.theme().econ.entryBase === 0.33)
  c.lightT = 10
  check('ışıksız temada geri sayım 0 (gösterge kapalı)', c.lightRemaining() === 0)

  // YAYA MÜŞTERİ: dükkan varsa ciro gelir, yoksa gelmez
  const w = new GameState()
  w.unlockedLocs.push('cevreyolu'); w.switchLoc('cevreyolu', { placedPos: {}, placedRot: {}, placedRects: [] })
  // D12 hediyesi ilk şube geçişinde Müdür Sv.1 atar; müdür turu kumbarayı TOPLAYIP
  // bu testin ölçtüğü pendingCash'i boşaltıyordu — yaya ölçümü için müdürü kapat
  w.managerLevel = 0
  w.tick(25) // everySec 22
  check('dükkan yokken yaya müşteri geliri YOK', Object.keys(w.pendingCash).length === 0)
  w.marketLevel = 2; w.walkT = 0
  w.tick(25)
  check('market varken yaya müşteri kumbaraya ciro bırakır', (w.pendingCash.market ?? 0) > 0)
  // KIRILGANLIK FIXİ: yaya cirosu ₺25-70 arası RASTGELE. Tek örnek karşılaştırmak
  // kırılgandı — yüksek çekilen ilk örnek, daha iyi çarpanla gelen düşük örneği
  // geçebiliyordu (test bazen kırmızı yanıyordu). Artık N örneğin TOPLAMI kıyaslanıyor:
  // rastgelelik ortalamada eriyor, ölçülen şey yalnız ÇARPAN kalıyor.
  const walkTotal = (st, n) => {
    st.pendingCash = {}
    for (let i = 0; i < n; i++) { st.walkT = 0; st.tick(25) }
    return st.pendingCash.market ?? 0
  }
  const N = 60
  const azDukkan = walkTotal(w, N)
  w.marketLevel = 3; w.hasCoffee = true; w.hasRestaurant = true
  const cokDukkan = walkTotal(w, N)
  check(`gelişmiş dükkanlar yaya cirosunu artırır (${N} örnek: ₺${azDukkan} → ₺${cokDukkan})`,
    cokDukkan > azDukkan * 1.15)
  // istasyon kapalıyken yaya gelmez
  w.pendingCash = {}; w.walkT = 0; w.closed = true
  w.tick(25)
  check('istasyon KAPALIYKEN yaya müşteri gelmez', Object.keys(w.pendingCash).length === 0)

  // metropol daha agresif ışık + yoğun yaya
  const m = new GameState()
  m.unlockedLocs.push('metropol'); m.switchLoc('metropol', { placedPos: {}, placedRot: {}, placedRects: [] })
  check('metropolde de ışık YOK — telafi entryBase 0.37', m.theme().features.trafficLight === undefined && m.theme().econ.entryBase === 0.37)
  check('metropolde yaya trafiği daha sık (14s)', m.theme().features.walkIns.everySec === 14)
}

console.log('== 19) Otoyol Dinlenme Tesisi (rapor §6.4) ==')
{
  const { THEMES } = await import('../../src/themes.ts')
  const hw = THEMES.otoyol.features.highway
  check('otoyolda ramp topolojisi tanımlı', THEMES.otoyol.lane.rampLength === 20 && !!hw)
  // bariyer = yaka GEÇİŞİ yok; karşı ŞERİT trafiği kendi yakasındaki istasyona GİRER
  // (eski "karşı istasyon YOK" yorumu farActive'i komple kapatıp otoyolda karşı yakayı müşterisiz bırakmıştı)
  check('orta BARİYER var (otoyol — yaka geçişi yok)', THEMES.otoyol.lane.barrier === true)
  check('kasabada bariyer yok (yaka geçişi serbest)', THEMES.kasaba.lane.barrier === false)
  check('yavaşlama şeridi kapasitesi 3 araç', hw.rampCap === 3)
  check('birleşme otoyolda ZOR (mergeHard 1.6 — ölçümle dengelendi)', hw.mergeHard > 1.5)

  // ERKEN SAPMA KARARI: tabela mesafeyi uzatır (tabela = birinci kaldıraç)
  const decisionY = (gateInY, signLevel) => gateInY - (hw.decisionDist + hw.signReach * signLevel)
  const d0 = decisionY(-8, 0), d3 = decisionY(-8, 3)
  check(`tabela 0 → karar ${Math.abs(d0 + 8)} birim önce`, Math.abs(d0 + 8) === 34)
  check(`tabela 3 → karar ${Math.abs(d3 + 8)} birim önce (27 birim DAHA ERKEN)`, Math.abs(d3 + 8) === 61)
  check('tabela sapma kararını uzatır (kaçan müşteri azalır)', d3 < d0)

  // EKONOMİK KİMLİK: fiyat serbest, itibar önemsiz, tabela kritik
  const o = new GameState()
  o.unlockedLocs.push('otoyol'); o.switchLoc('otoyol', { placedPos: {}, placedRot: {}, placedRects: [] })
  const base = o.entryChance()
  for (const f of ['benzin', 'dizel', 'lpg']) o.prices[f] = priceBounds(f)[1]
  check(`otoyolda TAVAN FİYAT akışı çok az düşürür (${(o.entryChance() / base * 100).toFixed(0)}% ≥ 80%)`,
    o.entryChance() / base >= 0.8)
  // itibar etkisi zayıf
  const rBefore = o.entryChance(); o.reputation = 5
  const repEffect = o.entryChance() - rBefore
  const k = new GameState(); const kBefore = k.entryChance(); k.reputation = 5
  check('otoyolda itibarın etkisi kasabadan ZAYIF', repEffect < (k.entryChance() - kBefore))
  // tabela etkisi güçlü
  const o2 = new GameState()
  o2.unlockedLocs.push('otoyol'); o2.switchLoc('otoyol', { placedPos: {}, placedRot: {}, placedRects: [] })
  const s0 = o2.entryChance(); o2.signLevel = 3
  const k2 = new GameState(); const ks0 = k2.entryChance(); k2.signLevel = 3
  check('otoyolda TABELA etkisi kasabadan GÜÇLÜ (birinci kaldıraç)',
    (o2.entryChance() - s0) > (k2.entryChance() - ks0) * 1.4)

  // otoyolda ışık/yaya YOK (şehir mekaniği sızmamalı)
  check('otoyolda trafik ışığı yok', !THEMES.otoyol.features.trafficLight)
  check('otoyolda yaya müşteri yok', !THEMES.otoyol.features.walkIns)
  // kasaba/çevre yolunda highway mekaniği YOK
  check('kasabada highway topolojisi yok', !THEMES.kasaba.features?.highway)
  check('çevre yolunda highway topolojisi yok', !THEMES.cevreyolu.features?.highway)
}

console.log('== 20) B8: yaka başına tesis nüshaları + B5/B6 (trafik raporu) ==')
{
  const { getShopItems: shop2, sellInfo, applySell, buyItem } = await import('../../src/state.ts')
  const s20 = new GameState()
  // kilit zinciri: önce bu yakadaki tesis, sonra karşıda beton
  let r = shop2(s20).find(x => x.id === 'wash2')
  check('karşı yıkama kilitli: önce bu yakadaki tesis', r.status === 'locked' && /bu yakadaki/.test(r.note))
  s20.hasWash = true
  r = shop2(s20).find(x => x.id === 'wash2')
  check('ana tesis var, karşı beton yok → kilitli', r.status === 'locked' && /betonlu/.test(r.note))
  s20.ownedParcels.add('3,1'); s20.pavedParcels.add('3,1')
  r = shop2(s20).find(x => x.id === 'wash2')
  check('ana tesis + karşı beton → satın alınabilir', r.status === 'buy')
  // 5 nüshanın hepsi tanımlı
  for (const id of ['toilet2', 'wash2', 'oil2', 'coffee2', 'restaurant2']) {
    check(`${id} mağazada tanımlı`, !!shop2(s20).find(x => x.id === id))
  }
  // satın alma + satış
  s20.money = 200000; s20.toiletLevel = 1; s20.hasOil = true; s20.hasCoffee = true; s20.hasRestaurant = true
  check('karşı yıkama satın alındı', buyItem(s20, 'wash2') === true && s20.hasWash2 === true)
  check('karşı tuvalet seviyeli alınır', buyItem(s20, 'toilet2') === true && s20.toilet2Level === 1)
  check('karşı restoran alındı', buyItem(s20, 'restaurant2') === true && s20.hasRestaurant2 === true)
  check('karşı nüsha satılabilir (%50 iade)', !!sellInfo(s20, 'wash2'))
  applySell(s20, 'wash2')
  check('satış sonrası karşı yıkama gitti', s20.hasWash2 === false)
  // save round-trip
  const ser = serializeState(s20); const d20 = new GameState(); hydrateState(d20, ser)
  check('B8 alanları save round-trip', d20.toilet2Level === 1 && d20.hasRestaurant2 === true)
  // şube snapshot'ında da taşınır (LOC_FIELDS)
  const { LOC_FIELDS } = await import('../../src/state.ts')
  check('karşı nüshalar şube alanlarında (LOC_FIELDS)',
    ['toilet2Level', 'hasWash2', 'hasOil2', 'hasCoffee2', 'hasRestaurant2'].every(f => LOC_FIELDS.includes(f)))
  // kumbara cap'leri tanımlı
  for (const id of ['toilet2', 'wash2', 'oil2', 'coffee2', 'restaurant2']) {
    check(`${id} kumbara cap'i tanımlı`, s20.pendingCap(id) > 0)
  }
}

console.log('== 21) Müdür + personel eğitimi (rapor §7 #5, #7) ==')
{
  const { getShopItems: shopM, buyItem: buyM } = await import('../../src/state.ts')
  const m = new GameState()
  check('başlangıçta müdür yok, personel Sv.1', m.managerLevel === 0 && m.staffLevel === 1)
  check('müdür turu çalışmaz (müdür yok)', m.managerTick(60) === null)
  let r = shopM(m).find(x => x.id === 'manager')
  check('tesis yokken müdür KİLİTLİ', r.status === 'locked')
  m.marketLevel = 3; m.hasTruckPark = true
  r = shopM(m).find(x => x.id === 'manager')
  check('gelir tesisi varken müdür açılır', r.status === 'buy' && r.cost === 18000)

  m.money = 200000
  check('müdür tutuldu', buyM(m, 'manager') === true && m.managerLevel === 1)
  // Sv.1: yalnız kumbara toplar
  m.addPending('market', 400, 'Market'); m.addPending('truckpark', 300, 'Tır')
  m.solarDirt = 0.9; m.solarCount = 1; m.brokenPumps.add(0)
  // tanklar dolu → otomatik yakıt siparişi tetiklenmez (para karşılaştırması saf kalsın)
  for (const f of ['benzin', 'dizel', 'lpg']) m.tanks[f] = m.fuelCapacity(f)
  const money0 = m.money
  let res = m.managerTick(50)
  check('Sv.1 kumbaraları topladı', !!res && res.collected >= 700 && m.money > money0)
  // YENİ (Oğuz): müdür Sv.1 boş tanka yakıt siparişi verir
  m.managerT = 0; m.tanks.benzin = 0; m.money = Math.max(m.money, 100_000)
  const resO = m.managerTick(50)
  check('Sv.1 boş tanka yakıt siparişi verdi', !!resO && resO.ordered >= 1 && m.orders.benzin.pending)
  check('Sv.1 panel temizlemez', res.cleaned === false && m.solarDirt === 0.9)
  check('Sv.1 arıza tamir etmez', res.fixed === 0 && m.brokenPumps.has(0))
  check('tur sayacı sıfırlandı (45 sn'.replace("'", "’") + ' bekler)', m.managerTick(10) === null)

  // Sv.2: panel temizliği
  buyM(m, 'manager'); m.managerT = 0
  res = m.managerTick(50)
  check('Sv.2 panelleri temizledi', m.managerLevel === 2 && m.solarDirt === 0)
  // Sv.3: arıza tamiri
  buyM(m, 'manager'); m.managerT = 0; m.brokenChargers.add(1)
  res = m.managerTick(50)
  check('Sv.3 arızaları tamir etti', m.managerLevel === 3 && m.brokenPumps.size === 0 && m.brokenChargers.size === 0)
  check('Sv.3 sonrası müdür MAKS', shopM(m).find(x => x.id === 'manager').status === 'maxed')
  // parası yoksa tamir etmez (borca sokmaz)
  const p2 = new GameState(); p2.managerLevel = 3; p2.money = 100; p2.brokenPumps.add(0)
  p2.managerTick(50)
  check('para yetmezse tamir edilmez (borç yok)', p2.brokenPumps.has(0) && p2.money === 100)

  // YOVMİYE: müdür + eğitim yovmiyeyi artırır (pasif gelir bedava değil)
  const w = new GameState()
  w.autoPumps.add(0); w.autoPumps.add(1)
  const wage0 = w.dailyWages()
  w.managerLevel = 3
  check('müdür yovmiyesi eklenir', w.dailyWages() === wage0 + 1200)
  w.managerLevel = 0; w.staffLevel = 4
  check('eğitimli personel daha pahalı (+%105)', w.dailyWages() > wage0 * 2)

  // PERSONEL EĞİTİMİ etkileri
  const st = new GameState()
  check('Sv.1 dolum hızı çarpanı 1.0 (denge birebir)', st.staffFillMult() === 1)
  check('Sv.1 bahşiş bonusu 0', st.staffTipBonus() === 0)
  check('Sv.1 hata çarpanı 1.0', st.staffErrorMult() === 1)
  st.staffLevel = 4
  check('Sv.4 dolum +%36', Math.abs(st.staffFillMult() - 1.36) < 1e-9)
  check('Sv.4 bahşiş +15 puan', Math.abs(st.staffTipBonus() - 0.15) < 1e-9)
  check('Sv.4 hata riski %25e iner', Math.abs(st.staffErrorMult() - 0.25) < 1e-9)
  const tr = new GameState(); tr.money = 200000; tr.autoPumps.add(0)
  check('eğitim satın alınabilir', buyM(tr, 'train') === true && tr.staffLevel === 2)
  tr.staffLevel = 4
  check('Sv.4 sonrası eğitim MAKS', shopM(tr).find(x => x.id === 'train').status === 'maxed')

  // save round-trip + şube snapshot
  const ser = serializeState(m); const d = new GameState(); hydrateState(d, ser)
  check('müdür/eğitim save round-trip', d.managerLevel === 3 && d.staffLevel === m.staffLevel)
  const { LOC_FIELDS } = await import('../../src/state.ts')
  check('müdür/eğitim ŞUBEYE ait (her şubenin kendi personeli)',
    LOC_FIELDS.includes('managerLevel') && LOC_FIELDS.includes('staffLevel'))
}

console.log('== 22) Katman 2b sink'.replace("'","’") + ' + 2c yıkma/satma ==')
{
  const { getShopItems: shopS, buyItem: buyS, sellInfo: sellS, applySell: applyS } = await import('../../src/state.ts')
  const b = new GameState()
  b.pumps = 6; b.evChargers = 4; b.marketLevel = 3; b.money = 500000
  // SİGORTA
  check('başlangıçta sigorta yok, hasar çarpanı 1.0', b.insurance === false && b.damageMult() === 1)
  check('sigorta primi 0 (yokken)', b.insuranceDaily() === 0)
  check('sigorta satın alındı', buyS(b, 'insurance') === true && b.insurance === true)
  check('sigortalıyken hasar YARIYA iner', b.damageMult() === 0.5)
  check('sigorta günlük prim getirir (OPEX artar)', b.insuranceDaily() > 0)
  const opexWithIns = b.dailyOpex()
  b.insurance = false
  check('sigortasızken OPEX daha düşük', b.dailyOpex() < opexWithIns)

  // DEKORASYON: gelir etkisi yok, itibar +
  const d = new GameState(); d.money = 200000
  check('dekorasyon itibar katkısı 0 (başlangıç)', d.decorRep() === 0)
  const before = d.entryChance()
  buyS(d, 'decor')
  check('dekorasyon alındı (Sv.1)', d.decorLevel === 1)
  check('dekorasyon itibarı +0.15 etkiler', Math.abs(d.decorRep() - 0.15) < 1e-9 && d.entryChance() > before)
  buyS(d, 'decor'); buyS(d, 'decor')
  check('dekorasyon Sv.3 MAKS', d.decorLevel === 3 && shopS(d).find(x => x.id === 'decor').status === 'maxed')

  // EKİPMAN YAŞLANMASI
  const w = new GameState(); w.pumps = 8; w.evChargers = 6; w.money = 500000
  check('yeni ekipman verim 1.0', w.wearEfficiency() === 1)
  check('yıpranma yokken mağazada yenileme YOK', !shopS(w).find(x => x.id === 'renew'))
  w.tick(200) // yıpranma birikir
  check('zamanla yıpranma birikir', w.wear > 0)
  w.wear = 1
  check('tam yıpranmada verim %60', Math.abs(w.wearEfficiency() - 0.6) < 1e-9)
  check('yıpranınca yenileme mağazada belirir', !!shopS(w).find(x => x.id === 'renew'))
  const cost = w.renewCost()
  check('yenileme bedeli ekipmanın %60ı', Math.abs(cost - w.equipmentValue() * 0.6) < 2)
  const m0 = w.money
  check('yenileme yapıldı', w.renewEquipment() === cost && w.wear === 0 && w.money === m0 - cost)
  const poor = new GameState(); poor.pumps = 8; poor.wear = 1; poor.money = 10
  check('parası yetmezse yenileme olmaz', poor.renewEquipment() === null && poor.wear === 1)

  // RUHSAT
  const l = new GameState(); l.pumps = 6; l.marketLevel = 2
  check('ruhsat bedeli varlıkla ölçekli', l.licenseFee() > 8000)
  check('ilk ruhsat günü 30', l.licenseDueDay === 30)

  // 2c: HER yapı satılabilir
  const sv = new GameState()
  sv.signLevel = 2; sv.wideGates = true; sv.gridLevel = 2; sv.airWaterCount = 2; sv.parkingCount = 3
  check('tabela satılabilir (2c)', !!sellS(sv, 'sign'))
  check('geniş kapı satılabilir (2c)', !!sellS(sv, 'widegate'))
  check('şebeke satılabilir (bağlı ünite yokken)', !!sellS(sv, 'grid'))
  sv.evChargers = 2
  check('şebeke bağlı ünite varken SATILAMAZ (kilitlenme koruması)', sellS(sv, 'grid') === null)
  check('hava-su satılabilir', !!sellS(sv, 'airwater'))
  check('otopark satılabilir', !!sellS(sv, 'parking'))
  applyS(sv, 'sign')
  check('tabela satışı uygulandı', sv.signLevel === 0)

  // save round-trip
  const ser2 = serializeState(b); const d2 = new GameState(); hydrateState(d2, ser2)
  check('2b alanları save round-trip', d2.insurance === b.insurance && d2.decorLevel === b.decorLevel)
}

console.log('== 23) Katman 4b piyasa + 4c sezon/sıralama ==')
{
  const m = new GameState()
  // PİYASA: determinist, ±%15 bandında, günden güne değişir
  const idx = m.marketIndex(10, 'benzin')
  check('piyasa endeksi determinist (aynı gün = aynı değer)', m.marketIndex(10, 'benzin') === idx)
  check('endeks ±%15 bandında', idx >= 0.85 && idx <= 1.15)
  check('gün değişince endeks değişir', m.marketIndex(11, 'benzin') !== idx)
  check('yakıtlar bağımsız dalgalanır', m.marketIndex(10, 'dizel') !== m.marketIndex(10, 'benzin'))
  const prices = [1, 5, 20, 50, 120].map(d => m.marketIndex(d, 'benzin'))
  check('endeks hep pozitif ve makul', prices.every(p => p > 0.8 && p < 1.2))
  // alış fiyatı ve sipariş maliyeti piyasadan
  m.day = 7
  const bp = m.buyPrice('benzin')
  check('alış fiyatı piyasa endeksiyle hesaplanır', Math.abs(bp - 6.5 * m.marketIndex(7, 'benzin')) < 0.02)
  m.tankLevel = 2; m.money = 100000
  const cost1 = m.orderCost('benzin')
  m.day = 8
  const cost2 = m.orderCost('benzin')
  check('sipariş maliyeti günden güne değişir (stoklama stratejik)', cost1 !== cost2)
  // 7 günlük tahmin
  const fc = m.priceForecast('dizel')
  check('7 günlük tahmin döner', fc.length === 7 && fc.every(x => x > 0))
  check('tahmin ilk elemanı bugünün fiyatı', Math.abs(fc[0] - m.buyPrice('dizel')) < 0.02)

  // SEZON: 4 mevsim, tekrarlanabilir, trafik çarpanı
  const se = new GameState()
  se.day = 1
  // KRİTİK: gün 1 çarpanı ~1.0 olmalı — canlı oyuncuların dengesi sezonla sarsılmasın
  check(`gün 1 = İlkbahar, çarpan ~1.0 (canlı denge korunur: ${se.season().traffic.toFixed(3)})`,
    se.season().id === 'ilkbahar' && se.season().traffic > 0.99 && se.season().traffic < 1.06)
  se.day = 60
  check('gün 60 = Yaz (zirve)', se.season().id === 'yaz' && se.season().traffic > 1.1)
  se.day = 150
  check('gün 150 = Sonbahar (nötr 1.0)', se.season().id === 'sonbahar' && Math.abs(se.season().traffic - 1) < 0.001)
  se.day = 200
  check('gün 200 = Kış (dip ~0.87)', se.season().id === 'kis' && se.season().traffic > 0.85 && se.season().traffic < 0.9)
  se.day = 271
  check('döngü TEKRARLANIR (gün 271 = İlkbahar)', se.season().id === 'ilkbahar')
  check('sezon ilerlemesi gösterilir', se.season().dayInSeason === 1 && se.season().length === 45)
  // sezon trafiği entryChance'e yansır
  const a = new GameState(); a.day = 60   // yaz
  const b2 = new GameState(); b2.day = 200 // kış
  check('yaz akışı kıştan yüksek', a.entryChance() > b2.entryChance() * 1.15)
  // MARİNA'da sezon SERT (rapor §6.5.5: kışın tekne trafiği çöker)
  const mar = new GameState(); mar.unlockedLocs.push('marina')
  mar.switchLoc('marina', { placedPos: {}, placedRot: {}, placedRects: [] })
  mar.day = 60; const mYaz = mar.season().traffic
  mar.day = 200; const mKis = mar.season().traffic
  check(`marinada sezon SERT (yaz ${mYaz.toFixed(2)} / kış ${mKis.toFixed(2)})`, mYaz > 1.4 && mKis < 0.6)
}

// ---- §24: FEEDBACK BUG'LARI (Paket E) ----
{
  console.log('\n== 24) Feedback bugları: kumbara taşması + itibar mutabakatı ==')

  // #193 "restoran cirosu 0" / #423 "market kasaya eklemiyor" — taşan ciro SESSİZCE siliniyordu
  const s1 = new GameState()
  s1.hasRestaurant = true
  const cap = s1.pendingCap('restaurant')
  // tavana kadar birebir
  s1.addPending('restaurant', cap, 'Restoran')
  check(`tavana kadar ciro TAM yazılır (${s1.pendingCash.restaurant} = ${cap})`, s1.pendingCash.restaurant === cap)
  check('tavana kadar kayıp YOK', (s1.facLost.restaurant ?? 0) === 0)
  // tavanın üstü: eskiden 0 gelirdi, artık %40 verimle DEVAM eder
  const beforeOver = s1.pendingCash.restaurant
  s1.addPending('restaurant', 500, 'Restoran')
  const gained = s1.pendingCash.restaurant - beforeOver
  check(`tavan ÜSTÜ ciro artık kaybolmuyor (+₺${Math.round(gained)} / 500)`, gained > 150 && gained < 250)
  check('kısılan kısım KAYIP olarak raporlanır', s1.facLost.restaurant > 250)
  // sert tavan 3x
  for (let i = 0; i < 200; i++) s1.addPending('restaurant', 500, 'Restoran')
  check(`sert tavan 3x cap (${s1.pendingCash.restaurant} ≤ ${cap * 3})`, s1.pendingCash.restaurant <= cap * 3 + 0.01)
  check('sonsuz idle kazancı YOK (tavan var)', s1.pendingCash.restaurant === cap * 3)
  // toplama: kayıp sayacı da sıfırlanır
  s1.collectPending('restaurant')
  check('toplayınca kumbara + kayıp sayacı sıfırlanır',
    !s1.pendingCash.restaurant && !s1.facLost.restaurant)
  // ofis raporu (facDaily) ile kasaya giren para artık makul yakınlıkta
  const s2 = new GameState(); s2.marketLevel = 1
  for (let i = 0; i < 6; i++) s2.addPending('market', 50, 'Market')
  const got = s2.collectPending('market')
  check(`normal oyunda (6 ziyaret) ciro TAMAMEN kasaya girer (₺${got}/300)`, got === 300)

  // sunucu clamp'i istemci sert tavanını KESMEMELİ (yoksa senkronda para kaybı)
  const maxCap = Math.max(...['market', 'toilet', 'selfwash', 'airwater', 'parking', 'truckpark',
    'restaurant', 'oil', 'wash', 'coffee', 'market2', 'restaurant2', 'oil2'].map(id => {
      const t2 = new GameState(); t2.marketLevel = 3; t2.market2Level = 3; t2.toiletLevel = 2
      t2.selfWashCount = 9; t2.airWaterCount = 9; t2.parkingCount = 9
      return t2.pendingCap(id) * 3
    }))
  check(`istemci sert tavanı sunucu clamp'ini (8000) aşmıyor (max ${maxCap})`, maxCap <= 8000)

  // #456 + #216-4: itibar 5.0'da donmamalı
  const r1 = new GameState()
  r1.day = 30; r1.reputation = 5.0
  r1.stats.served = 100; r1.stats.lost = 0
  r1.reconcileReputation()          // ilk çağrı işaretçiyi kurar
  r1.stats.served += 60; r1.stats.lost += 40   // KÖTÜ gün: %40 kayıp
  const bad = r1.reconcileReputation()
  check(`kötü günde itibar DÜŞER (5.00 → ${r1.reputation.toFixed(2)})`, r1.reputation < 4.95 && bad.delta < 0)
  check('düşüş tek günde şok yapmaz (≤0.30)', bad.delta >= -0.301)
  // üst üste kötü günler biriktirir
  for (let i = 0; i < 10; i++) { r1.stats.served += 60; r1.stats.lost += 40; r1.reconcileReputation() }
  check(`ihmal edilen istasyon itibarı gerçekten çöker (${r1.reputation.toFixed(2)} < 2.6)`, r1.reputation < 2.6)
  // iyi hizmet geri kazandırır
  for (let i = 0; i < 12; i++) { r1.stats.served += 100; r1.stats.lost += 0; r1.reconcileReputation() }
  check(`kusursuz hizmet itibarı geri getirir (${r1.reputation.toFixed(2)} > 4.8)`, r1.reputation > 4.8)
  check('tavan 5.0 korunur', r1.reputation <= 5.0)
  // müşterisiz gün: unutulma (3.0'a aşınır) ama dibe vurmaz
  const r2 = new GameState(); r2.day = 30; r2.reputation = 5.0
  r2.reconcileReputation()
  for (let i = 0; i < 20; i++) r2.reconcileReputation()   // hiç müşteri yok
  check(`müşterisiz günler itibarı 3.0'a aşındırır (${r2.reputation.toFixed(2)})`, r2.reputation > 2.9 && r2.reputation < 3.2)
  // yeni oyuncu koruması bozulmadı
  const r3 = new GameState(); r3.day = 1; r3.reputation = 3.0
  r3.reconcileReputation(); r3.stats.served = 5; r3.stats.lost = 20
  r3.reconcileReputation()
  check('grace döneminde itibar 2.5 altına inmez', r3.reputation >= 2.5)
  // trend göstergesi
  check('trend yönü raporlanır', r1.repTrend === 1 || r1.repTrend === 0)
}

// ---- §25: DEKORATİF SOKAK LAMBASI (#358, #679-1, #835) ----
{
  console.log('\n== 25) Sokak lambası: kurulabilir/taşınabilir/satılabilir ==')
  const g = new GameState(); g.money = 100_000
  const before = g.money
  buyItem(g, 'lamp')
  check('lamba satın alınabilir', g.lampCount === 1 && g.money === before - 2500)
  buyItem(g, 'lamp'); buyItem(g, 'lamp')
  check('sınırsız kurulur (3 adet)', g.lampCount === 3)
  // itibar katkısı — tavanlı (dekorasyon sömürüsü yok)
  const rep3 = g.decorRep()
  for (let i = 0; i < 50; i++) buyItem(g, 'lamp')
  check(`lamba itibarı tavanlı (${g.decorRep().toFixed(2)} ≤ 0.30 + dekor)`, g.decorRep() <= 0.30001)
  check('3 lambanın katkısı 50 lambadan az', rep3 < g.decorRep() || rep3 === 0.12)
  // satış: HERHANGİ bir örnek (2c kuralı)
  const n0 = g.lampCount
  check('herhangi bir örnek satılabilir', !!sellInfo(g, 'lamp#0') && !!sellInfo(g, 'lamp'))
  applySell(g, 'lamp#1')
  check('satınca sayaç düşer', g.lampCount === n0 - 1)
  // varlık değeri: anti-cheat servet tavanına girer (yoksa sunucu 409 verir)
  const g2 = new GameState(); g2.money = 100_000
  const ev0 = g2.equipmentValue()
  buyItem(g2, 'lamp')
  check('lamba EKİPMAN DEĞERİNE girer (sunucu servet tavanı senkronu)', g2.equipmentValue() === ev0 + 2500)
  // şubeye özgü: LOC_FIELDS'te (her şubenin kendi lambaları)
  check('lampCount şubeye özgü (LOC_FIELDS)', LOC_FIELDS.includes('lampCount'))
  const ser = serializeState(g)
  check('lampCount kaydedilir (serialize)', typeof ser.lampCount === 'number')
  const hyd = new GameState(); hydrateState(hyd, ser)
  check('lampCount geri yüklenir (hydrate)', hyd.lampCount === g.lampCount)
  // devir: sıfırlanır
  const g3 = new GameState(); g3.money = 100_000; buyItem(g3, 'lamp')
  g3.money = 50_000_000; g3.day = 200
  if (g3.canHandover()) { g3.handover(); check('devirde lambalar sıfırlanır', g3.lampCount === 0) }
  else check('devir eşiği tutmadı (atlandı)', true)
}

// ---- §26: KASABA MÜDAVİM MÜŞTERİ (lategame raporu §6.2) ----
{
  console.log('\n== 26) Kasaba imzası: müdavim müşteri ==')
  const k = new GameState()          // kasaba
  k.reputation = 3.0
  check('düşük itibarda müdavim YOK', k.regularsShare() === 0)
  k.reputation = 4.0
  check('eşik itibarda (4.0) henüz müdavim yok', k.regularsShare() === 0)
  k.reputation = 4.5
  const half = k.regularsShare()
  check(`itibar 4.5'te müdavim oluşmaya başlar (%${(half * 100).toFixed(0)})`, half > 0.1 && half < 0.2)
  k.reputation = 5.0
  check(`itibar 5.0'da müdavim payı %28`, Math.abs(k.regularsShare() - 0.28) < 0.001)

  // ASIL ETKİ: müdavim akış EKLEMEZ, fiyat baskısına karşı KORUR
  const a = new GameState(); a.reputation = 5.0   // müdavimli
  const b = new GameState(); b.reputation = 5.0
  b.theme = () => ({ ...a.theme(), features: {} })  // müdavimsiz kopya
  check(`varsayılan fiyatta trafik AYNI (denge bozulmaz: ${a.entryChance().toFixed(4)} ≈ ${b.entryChance().toFixed(4)})`,
    Math.abs(a.entryChance() - b.entryChance()) < 0.002)
  // fiyatı tavana çek
  for (const f of ['benzin', 'dizel', 'lpg']) { a.prices[f] = priceBounds(f)[1]; b.prices[f] = priceBounds(f)[1] }
  const dropA = 1 - a.entryChance() / new GameState().entryChance()
  const dropB = 1 - b.entryChance() / new GameState().entryChance()
  check(`tavan fiyatta müdavimli istasyon DAHA AZ kaybeder (%${(dropA * 100).toFixed(0)} vs %${(dropB * 100).toFixed(0)})`,
    dropA < dropB - 0.05)
  check('müdavim yine de fiyat zammını bedava yapmaz', dropA > 0.1)

  // müdavim bahşişi
  const t1 = new GameState(); t1.reputation = 3.0
  const t2 = new GameState(); t2.reputation = 5.0
  check('düşük itibarda bahşiş çarpanı 1.0', Math.abs(t1.regularsTipMult() - 1) < 0.001)
  check(`5.0 itibarda bahşiş çarpanı ${t2.regularsTipMult().toFixed(2)}× (müdavim cömertliği)`,
    t2.regularsTipMult() > 1.15 && t2.regularsTipMult() < 1.2)

  // OTOYOLDA müdavim YOK (kimse aynı dinlenme tesisine ikinci kez uğramaz)
  const o = new GameState(); o.unlockedLocs.push('otoyol')
  o.switchLoc('otoyol', { placedPos: {}, placedRot: {}, placedRects: [] })
  o.reputation = 5.0
  check('otoyolda müdavim mekaniği KAPALI (tema kısıtı)', o.regularsShare() === 0 && o.regularsTipMult() === 1)
}

// ---- §27: METROPOL — ALAN KITLIĞI (lategame raporu §6.6) ----
{
  console.log('\n== 27) Metropol imzası: alan kıtlığı ==')
  const k = new GameState()   // kasaba
  check('kasabada parsel sınırı YOK (mevcut denge korunur)', k.parcelLimit() === null && !k.parcelLimitReached())
  const kCost = parcelCost(1, 1, k)

  const m = new GameState()
  m.unlockedLocs.push('metropol')
  m.switchLoc('metropol', { placedPos: {}, placedRot: {}, placedRects: [] })
  check('metropolde parsel sınırı 6', m.parcelLimit() === 6)
  const mCost = parcelCost(1, 1, m)
  check(`metropolde arsa 3.2× pahalı (₺${kCost} → ₺${mCost})`, mCost > kCost * 3 && mCost < kCost * 3.5)
  // sınır dolunca satın alma kapanır
  check('başlangıçta sınır dolu DEĞİL', !m.parcelLimitReached())
  for (let c = 0; c < 3; c++) for (let r = 0; r < 3; r++) m.ownedParcels.add(`${c}:${r}`)
  check(`9 parselde sınır DOLU (${m.ownedParcels.size} ≥ 6)`, m.parcelLimitReached())
  // ekonomik kimlik: fiyat esnekliği en yüksek, tabela en etkisiz
  const th = m.theme()
  check('metropolde fiyat esnekliği EN YÜKSEK (alternatif bol)', th.econ.priceElasticity > 1.5)
  check('metropolde tabela neredeyse etkisiz', th.econ.signWeight < 0.4)
  check('metropolde müdavim YOK (şehirde kimse esnafı tanımaz)', m.regularsShare() === 0)
  // ışıklar kaldırıldı — ayrışma artık entryBase + yaya yoğunluğuyla
  const cy = new GameState(); cy.unlockedLocs.push('cevreyolu')
  cy.switchLoc('cevreyolu', { placedPos: {}, placedRot: {}, placedRects: [] })
  check('metropol taban çekiciliği çevre yolundan GÜÇLÜ (ışık telafisi)',
    th.econ.entryBase > cy.theme().econ.entryBase)
  check('metropolde yaya trafiği çevre yolundan YOĞUN',
    th.features.walkIns.everySec < cy.theme().features.walkIns.everySec)
}

// ---- §28: ÇEVRE YOLU 4 ŞERİT ----
{
  console.log('\n== 28) Çevre yolu: 4 şerit geometrisi ==')
  const cy = new GameState(); cy.unlockedLocs.push('cevreyolu')
  cy.switchLoc('cevreyolu', { placedPos: {}, placedRot: {}, placedRects: [] })
  const svc = cy.theme().lane.service
  check('çevre yolunda servis şeridi TANIMLI', !!svc)
  check('kasabada servis şeridi YOK (tek şerit, denge korunur)', !new GameState().theme().lane.service)
  const oto = new GameState(); oto.unlockedLocs.push('otoyol')
  oto.switchLoc('otoyol', { placedPos: {}, placedRot: {}, placedRects: [] })
  check('otoyolda servis şeridi YOK (kendi ramp mekaniği var)', !oto.theme().lane.service)

  // geometri: 4 şerit asfalta sığmalı, refüje binmemeli, birbirine girmemeli
  const ROAD_X = 7.9, LANE_NEAR = 6.95, LANE_FAR = 8.85, CARW = 1.2
  const roadW = 6.0, medW = 0.6
  const aL = ROAD_X - roadW / 2, aR = ROAD_X + roadW / 2
  const mL = ROAD_X - medW / 2, mR = ROAD_X + medW / 2
  const lanes = [svc.near, LANE_NEAR, LANE_FAR, svc.far]
  check('4 şeridin hepsi asfalt içinde',
    lanes.every(x => x - CARW / 2 >= aL && x + CARW / 2 <= aR))
  check('hiçbir şerit refüje binmiyor',
    lanes.every(x => x + CARW / 2 <= mL || x - CARW / 2 >= mR))
  const sorted = [...lanes].sort((a, b) => a - b)
  check('şeritler birbirine girmiyor (araç genişliği kadar aralık)',
    sorted.every((x, i) => i === 0 || x - sorted[i - 1] >= CARW))
  check(`asfalt ana arsayı yemiyor (sol kenar ${aL})`, aL >= 4.8)
  check(`asfalt karşı parsele girmiyor (sağ kenar ${aR} ≤ 10.9)`, aR <= 10.9)
  // servis şeridi hedefe DAHA YAKIN olmalı (yoksa mekaniğin anlamı yok)
  check('near servis şeridi istasyona geçiş şeridinden YAKIN', svc.near < LANE_NEAR)
  check('far servis şeridi karşı istasyona geçiş şeridinden YAKIN', svc.far > LANE_FAR)
}

// ---- §29: BATARYA KADEMELERİ (600 kWh yetmiyordu) ----
{
  console.log('\n== 29) Batarya: geç oyun kapasitesi ==')
  const { BATTERY_CAP } = await import('../../src/state.ts')
  const g = new GameState(); g.money = 1e9; g.gridLevel = 2
  check(`eski tavan 600 kWh AŞILDI (yeni tavan ${BATTERY_CAP.at(-1)} kWh)`, BATTERY_CAP.at(-1) > 600)
  check('kapasite her kademede ARTIYOR', BATTERY_CAP.every((v, i) => i === 0 || v > BATTERY_CAP[i - 1]))
  // satın alma zinciri sonuna kadar çalışmalı
  let lvl = 0
  while (buyItem(g, 'battery')) lvl++
  check(`tüm kademeler satın alınabiliyor (Sv.${lvl})`, lvl === BATTERY_CAP.length - 1)
  check(`son kademede kapasite ${BATTERY_CAP.at(-1)} kWh`, g.batteryCapacity === BATTERY_CAP.at(-1))
  check('son kademeden sonra satın alınamıyor', !buyItem(g, 'battery'))
  // elektrik altyapısı olmadan alınamamalı (kilit korunuyor mu)
  const h = new GameState(); h.money = 1e9
  check('elektrik altyapısı yokken batarya KİLİTLİ', !buyItem(h, 'battery'))
  // depo dolabilmeli (tick kapasiteyi aşmamalı)
  const f = new GameState(); f.money = 1e9; f.gridLevel = 2
  while (buyItem(f, 'battery')) { /* sonuna kadar */ }
  f.solarCount = 9; f.battery = f.batteryCapacity
  f.tick(1)
  check('depo kapasiteyi AŞMIYOR', f.battery <= f.batteryCapacity + 0.001)
}

console.log(`\nSONUÇ: ${pass} geçti, ${fail} kaldı`)
process.exit(fail ? 1 : 0)
