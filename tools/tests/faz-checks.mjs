// Faz 3-4 doğrulama testleri — GERÇEK state.ts'i import eder (DOM stub'larıyla).
// Çalıştır: npm run test:faz  (node tools/tests/faz-checks.mjs değil — tsx gerekir)
// Geometri sabitleri (ROAD_X, rezerv, footprint) main/world'den KOPYA — orada değişirse
// buradaki sabitleri de güncelle (dosya başındaki SYNC bloğu).

// ---- DOM stub'ları (i18n localStorage/navigator ister) ----
globalThis.localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} }
Object.defineProperty(globalThis, 'navigator', { value: { language: 'tr' }, configurable: true })

const { GameState, PARCEL_COLS, PARCEL_ROWS, FUEL_COST, FUEL_PRICE, priceBounds, serializeState, hydrateState } =
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
  check(`GELİŞMİŞ istasyonda da tavan fiyat akışı düşürür (${(advCapped / advBase * 100).toFixed(0)}% ≤ 50%)`, advCapped / advBase <= 0.50)
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
  const off = s13.contractOffers()[0]
  check('imza başarılı', s13.signContract(off) === true)
  check('ikinci imza REDDEDİLİR (tek aktif sözleşme)', s13.signContract(off) === false)
  const money0 = s13.money
  s13.contract.deliveredToday = s13.contract.dailyLiters
  let r = s13.processContractDay()
  check('tam teslim → ödeme alınır', r.kind === 'ok' && s13.money > money0, `${r.kind} +${r.amount}`)
  check('gün sayacı işledi', s13.contract.daysLeft === off.daysTotal - 1)
  check('teslim sayacı sıfırlandı', s13.contract.deliveredToday === 0)
  // eksik teslim → ceza
  const m1 = s13.money
  r = s13.processContractDay() // deliveredToday = 0
  check('eksik teslim → ceza (kasa düşer, missedDays artar)', r.kind === 'miss' && s13.money < m1 && s13.contract.missedDays === 1)
  // tamamlama: kalan günleri tam teslimle bitir
  let guard = 0
  while (s13.contract && guard++ < 80) { s13.contract.deliveredToday = s13.contract.dailyLiters; r = s13.processContractDay() }
  check('sözleşme TAMAMLANDI (prim + itibar)', r.kind === 'done' && s13.contractsDone === 1, `son=${r.kind}`)
  check('bitince aktif sözleşme temizlendi', s13.contract === null)

  // ihlal senaryosu: hep eksik teslim → fesih
  const s14 = new GameState()
  s14.tankLevel = 3; s14.tankCounts.dizel = 4; s14.tankCounts.benzin = 3; s14.tankCounts.lpg = 2
  s14.signContract(s14.contractOffers()[0])
  let last = null; guard = 0
  while (s14.contract && guard++ < 80) last = s14.processContractDay()
  check('hep eksik → FESİH (prim yok)', last.kind === 'fail' && s14.contractsFailed === 1, `son=${last?.kind}`)
  check('kasa asla eksiye düşmedi', s14.money >= 0)

  // save round-trip: contract serialize/hydrate
  const s15 = new GameState()
  s15.tankLevel = 3; s15.tankCounts.dizel = 4
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
  const mk = () => { const x = new GameState(); x.tankLevel = 3; x.tankCounts.dizel = 4; x.tankCounts.benzin = 3; x.tankCounts.lpg = 2; return x }
  // (1) otobüs segmenti artık truckOnly (sedan'a 278L dizel talebi gitmez)
  const a = new GameState(); a.wideGates = true; a.pumps = 6
  check('otobüs segmenti truckOnly (tır-dışı araca düşmez)', a.activeSegments().find(x => x.id === 'otobus').truckOnly === true)
  // (2) kısa/kurcalanmış sözleşmede fesih ARTIK mümkün (bedava prim exploit'i kapandı)
  const b = mk()
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

console.log(`\nSONUÇ: ${pass} geçti, ${fail} kaldı`)
process.exit(fail ? 1 : 0)
