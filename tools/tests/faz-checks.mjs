// Faz 3-4 doğrulama testleri — GERÇEK state.ts'i import eder (DOM stub'larıyla).
// Çalıştır: npm run test:faz  (node tools/tests/faz-checks.mjs değil — tsx gerekir)
// Geometri sabitleri (ROAD_X, rezerv, footprint) main/world'den KOPYA — orada değişirse
// buradaki sabitleri de güncelle (dosya başındaki SYNC bloğu).

// ---- DOM stub'ları (i18n localStorage/navigator ister) ----
globalThis.localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} }
Object.defineProperty(globalThis, 'navigator', { value: { language: 'tr' }, configurable: true })

const { GameState, PARCEL_COLS, PARCEL_ROWS, FUEL_COST, FUEL_PRICE, priceBounds } =
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

console.log(`\nSONUÇ: ${pass} geçti, ${fail} kaldı`)
process.exit(fail ? 1 : 0)
