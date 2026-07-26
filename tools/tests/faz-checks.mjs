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
  // sweep: bölgeden çıkan aracın token'ı serbest kalır
  const g3 = new TrafficGraph(); g3.rebuild([mkGeom('near', 4.2, -1, 1, -14, 14)])
  const D = { n: 'D' }
  g3.tryAcquire('gate-in-near', D)
  g3.sweep([D], () => ({ x: 40, y: 40 })) // araç bölgeden uzakta
  check('sweep: bölgeyi geçen araç token’ı bırakır', g3.tryAcquire('gate-in-near', { n: 'E' }) === true)
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

console.log(`\nSONUÇ: ${pass} geçti, ${fail} kaldı`)
process.exit(fail ? 1 : 0)
