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

console.log(`\nSONUÇ: ${pass} geçti, ${fail} kaldı`)
process.exit(fail ? 1 : 0)
