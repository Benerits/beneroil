/**
 * RAFİNERİ TESTİ — 40★ tavanına dayanan oyuncu için para batağı + tedarik gücü.
 *
 * NEDEN VAR: rafineri ŞİRKET seviyesinde bir tesis (şube alanı değil), üç kademe,
 * inşaat günlerle ilerler, alış fiyatı/kota/tanker hızına dokunur ve sunucu servet
 * denetimine (buildingValue) girer. Bu dokunuşların her biri ayrı bir "görünmez
 * özellik" ya da "param gitti" tuzağı. Test her koşuda kanıtlar:
 *
 *   1) KİLİT SIRASI: yıldız → şube → para; kademe atlanamaz, inşaattayken ikinci alınamaz.
 *   2) İNŞAAT: para PEŞİN düşer, gün dönüşünde ilerler, N. günde kademe gelir (bir kez).
 *   3) KADEME 1: alış −%12 (fiyat tahmini dahil), ortak hat kotası ×2.
 *   4) KADEME 2: kota Infinity → fill 0, kardeş şube AÇ KALMAZ; tanker süresi ×0.75.
 *   5) KADEME 3: "rafineri" tedarikçisi yalnız burada geçerli; fiyat ham petrolü izler.
 *   6) OPEX kademeyle artar; kademe 0'da sıfır.
 *   7) DEVİRDE KALIR ve devir eşiğine (companyEquipmentValue) SAYILMAZ.
 *   8) KAYIT: SAVE_FIELDS'te, hydrate clamp'leri bozuk değeri toparlar, eski kayıt çökmez.
 *   9) SUNUCU PARİTESİ: server/index.js REFINERY_COSTS birebir; buildingValue inşaat
 *      anında bedeli sayar (servet sıçraması yok); sanitizeSave clamp'ler.
 *  10) HARİTA: rafineriDugumu state ile tutarlı; hat metinleri Infinity'yi "∞" yazar.
 *
 * Çalıştır: npx tsx tools/tests/rafineri-check.mjs
 */
globalThis.localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} }
Object.defineProperty(globalThis, 'navigator', { value: { language: 'tr' }, configurable: true })

import fs from 'node:fs'
const {
  GameState, serializeState, hydrateState, checkAchievements, SUPPLIERS, FUELS,
  REFINERY_MAX, REFINERY_COSTS, REFINERY_OPEX, REFINERY_DAYS, REFINERY_DISCOUNT, REFINERY_ETA_MULT,
  REFINERY_REQ, REFINERY_NAMES, SUPPLY_LINE_QUOTA, SUPPLY_STARVE_MAX,
} = await import('../../src/state.ts')
const { rafineriDugumu, haritaHatlari, RAFINERI_ID } = await import('../../src/harita.ts')

const src = fs.readFileSync(new URL('../../server/index.js', import.meta.url), 'utf8')
const block = src.slice(src.indexOf('const clamp = '), src.indexOf('function sanitizeSave'))
const { buildingValue } = new Function(block + '; return { buildingValue }')()
const sanBlock = src.slice(src.indexOf('const clamp = '), src.indexOf('// ---- hız limitleri'))
const { sanitizeSave } = new Function(sanBlock + '; return { sanitizeSave }')()

let pass = 0, fail = 0
const check = (n, c, d = '') => { c ? (pass++, console.log('  ✓ ' + n)) : (fail++, console.log(`  ✗ ${n}${d ? ' — ' + d : ''}`)) }
const yakin = (a, b, eps = 1e-6) => Math.abs(a - b) <= eps

/** 40★, 5 açık şube, bol para — rafineri için "hazır" şirket */
const hazir = (stars = 40, money = 1_000_000_000) => {
  const s = new GameState()
  s.brandStars = stars; s.money = money; s.day = 200
  s.unlockLoc('cevreyolu'); s.unlockLoc('otoyol'); s.unlockLoc('marina'); s.unlockLoc('metropol')
  s.money = money
  return s
}
/** gün dönüşü — main.ts gün sonu bloğunun state kısmı */
const gunGec = s => { const lv = s.refineryDayTurn(); s.day++; return lv }

// ─────────────────────────────────────────────────────────────────────────────
console.log('\n── 1) KİLİT SIRASI ──')
{
  const s = new GameState()
  s.money = 1_000_000_000
  let c = s.canBuildRefinery()
  check('yeni oyuncu: kademe 1 kilitli, sebep YILDIZ', !c.ok && c.reason === 'yildiz' && c.level === 1 && c.stars === REFINERY_REQ[0].stars, JSON.stringify(c))
  s.brandStars = 20
  c = s.canBuildRefinery()
  check('20★ ama tek şube: sebep ŞUBE (3 gerekir)', !c.ok && c.reason === 'sube' && c.locs === 3, JSON.stringify(c))
  s.unlockLoc('cevreyolu'); s.unlockLoc('otoyol'); s.money = 1_000
  c = s.canBuildRefinery()
  check('3 şube, kasa boş: sebep PARA', !c.ok && c.reason === 'para' && c.cost === REFINERY_COSTS[0], JSON.stringify(c))
  check('startRefinery kilitliyken FALSE ve para düşmez', s.startRefinery() === false && s.money === 1_000 && s.refineryDaysLeft === 0)
  s.money = REFINERY_COSTS[0]
  c = s.canBuildRefinery()
  check('20★ · 3 şube · ₺60M: kademe 1 alınabilir (6 gün)', c.ok && c.level === 1 && c.days === REFINERY_DAYS[0])
  check('kademe merdiveni 20/30/40★ · 3/5/5 şube', REFINERY_REQ.map(r => `${r.stars}/${r.locs}`).join(' ') === '20/3 30/5 40/5')
  check('bedeller ₺60M/100M/160M · süreler 6/8/10 gün', REFINERY_COSTS.join() === '60000000,100000000,160000000' && REFINERY_DAYS.join() === '6,8,10')
  check('kademe adları 3 ve boş değil', REFINERY_NAMES.length === REFINERY_MAX && REFINERY_NAMES.every(n => n.length > 3))
}

// ─────────────────────────────────────────────────────────────────────────────
console.log('\n── 2) İNŞAAT: peşin para, günle ilerleme, tek tamamlanma ──')
{
  const s = hazir()
  const once = s.money
  check('kademe 1 başladı', s.startRefinery() === true)
  check('para PEŞİN düştü (₺60M)', s.money === once - REFINERY_COSTS[0])
  check('kademe hâlâ 0, inşaat 6 gün', s.refineryLevel === 0 && s.refineryDaysLeft === REFINERY_DAYS[0])
  check('inşaattayken ikinci kademe alınamaz (sebep insaat)', s.canBuildRefinery().reason === 'insaat' && s.startRefinery() === false)
  check('ilerleme 0 → gün geçince artar', s.refineryProgress() === 0 && (gunGec(s), s.refineryProgress() > 0))
  let tamam = 0, tamamGun = -1
  for (let i = 0; i < 12; i++) { const lv = gunGec(s); if (lv > 0) { tamam++; tamamGun = i } }
  check('kademe TAM BİR KEZ tamamlandı (refineryDayTurn bir kez >0 döner)', tamam === 1, `tamam=${tamam}`)
  check('6. günde tamamlandı (ilk gün + 5)', tamamGun === REFINERY_DAYS[0] - 2, `i=${tamamGun}`)
  check('kademe 1 · daysLeft 0 · ilerleme 0', s.refineryLevel === 1 && s.refineryDaysLeft === 0 && s.refineryProgress() === 0)
  check('kademe 2 için 30★ yeterli değil → 40★ sahibiyiz, 5 şube var: alınabilir (₺100M, 8 gün)',
    s.canBuildRefinery().ok && s.canBuildRefinery().level === 2 && s.canBuildRefinery().days === 8)
  check('inşaat yokken refineryDayTurn 0 döner ve hiçbir şeyi bozmaz', gunGec(s) === 0 && s.refineryLevel === 1)
}

// ─────────────────────────────────────────────────────────────────────────────
console.log('\n── 3) KADEME 1: alış −%12, ortak hat kotası ×2 ──')
{
  const s = hazir()
  s.unlockLoc('otoyol-2'); s.money = 1_000_000_000
  s.switchLoc('otoyol', { placedPos: {}, placedRot: {}, placedRects: [] })
  const fiyat0 = s.buyPrice('benzin'), kota0 = s.supplyQuota()
  check('hat kurulu, kota sonlu (taban ≥ 9.000 L)', Number.isFinite(kota0) && kota0 >= SUPPLY_LINE_QUOTA)
  s.refineryLevel = 1
  check('alış fiyatı −%12 (yuvarlama payıyla)', yakin(s.buyPrice('benzin'), Math.round(fiyat0 * (1 - REFINERY_DISCOUNT) * 100) / 100, 0.011),
    `${fiyat0} → ${s.buyPrice('benzin')}`)
  check('refineryDiscount() = 0.12', s.refineryDiscount() === REFINERY_DISCOUNT)
  check('fiyat tahmini de indirimli (metin↔formül ayrışmasın)', s.priceForecast('benzin').every((p, i) => yakin(p, s.buyPriceAt(s.day + i, 'benzin'))))
  check('ortak hat kotası ×2', s.supplyQuota() === kota0 * 2, `${kota0} → ${s.supplyQuota()}`)
  check('tanker süresi kademe 1\'de DEĞİŞMEZ', s.supplierEtaMult() === 1)
  check('OPEX ₺40.000/gün', s.refineryOpex() === 40_000)
}

// ─────────────────────────────────────────────────────────────────────────────
console.log('\n── 4) KADEME 2: kota kalkar, kardeş aç kalmaz, tanker ×0.75 ──')
{
  const s = hazir()
  s.unlockLoc('otoyol-2'); s.money = 1_000_000_000
  s.switchLoc('otoyol', { placedPos: {}, placedRot: {}, placedRects: [] })
  s.refineryLevel = 2
  check('supplyQuota Infinity', s.supplyQuota() === Infinity)
  check('supplyRemaining Infinity (arayüz "sınırsız" yazar)', s.supplyRemaining() === Infinity)
  // dev sipariş: normal kotayı kat kat aşan kullanım
  s.supplyUsed.otoyol = 500_000
  check('supplyFill 0 (bölme NaN üretmez)', s.supplyFill() === 0)
  // kardeş şube (otoyol-2) müdürlü ve kazanıyor → aç kalmamalı
  s.locSnapshots['otoyol-2'] = { ...(s.locSnapshots['otoyol-2'] ?? {}), managerLevel: 2, pumps: 4, salesLog: Array.from({ length: 10 }, (_, i) => ({ day: s.day - i, rev: 20_000 })) }
  const once = s.money
  const out = s.accrueBranchVaults()
  const kardes = out.find(o => o.loc === 'otoyol-2')
  check('kardeş şube aç KALMADI (starved=false) ve tam netini aldı', !kardes || (kardes.starved === false && kardes.added > 0), JSON.stringify(kardes))
  check('gün dönüşü supplyUsed sıfırlandı', Object.keys(s.supplyUsed).length === 0)
  check('tanker süresi ×0.75', yakin(s.supplierEtaMult(), REFINERY_ETA_MULT))
  s.supplier = 'hizli'
  check('tedarikçi çarpanıyla ÇARPILIR (hizli × 0.75)', yakin(s.supplierEtaMult(), SUPPLIERS.hizli.etaMult * REFINERY_ETA_MULT))
  s.supplier = 'standart'
  check('alış indirimi kademe 2\'de de −%12', s.refineryDiscount() === REFINERY_DISCOUNT)
  check('OPEX ₺70.000/gün', s.refineryOpex() === 70_000)
  void once
}

// ─────────────────────────────────────────────────────────────────────────────
console.log('\n── 5) KADEME 3: Rafineri Filosu tedarikçisi ──')
{
  const s = hazir()
  check('SUPPLIERS.rafineri tanımlı (0.70× fiyat, 0.55× süre)', SUPPLIERS.rafineri && SUPPLIERS.rafineri.priceMult === 0.70 && SUPPLIERS.rafineri.etaMult === 0.55)
  s.supplier = 'rafineri'
  check('kademe 0-2\'de "rafineri" seçili olsa bile filo GEÇERSİZ: çarpan 1, fiyat piyasa',
    s.usesRefineryFleet() === false && s.supplierMult() === 1 && s.supplierEtaMult() === 1)
  s.refineryLevel = 2
  check('kademe 2: filo yok, terminal hızı var (×0.75)', s.usesRefineryFleet() === false && yakin(s.supplierEtaMult(), REFINERY_ETA_MULT))
  s.refineryLevel = 3
  check('kademe 3 + rafineri seçili: filo GEÇERLİ', s.usesRefineryFleet() === true && s.supplierMult() === 0.70)
  check('filoda alış indirimi uygulanmaz (ham petrol fiyatı kendi başına)', s.refineryDiscount() === 0)
  const crude = FUELS.map(f => s.crudeIndex(s.day, f))
  check('crudeIndex pozitif ve makul (0.5..2.2)', crude.every(c => c > 0.5 && c < 2.2), crude.join())
  // ham petrol endeksi piyasadan FARKLI bir seri: 60 günde en az birkaç gün piyasayı aşar, çoğunda altında kalır
  let ust = 0, alt = 0
  for (let d = 0; d < 60; d++) {
    const ham = s.buyPriceAt(s.day + d, 'benzin') * 0.70
    s.supplier = 'standart'; s.refineryLevel = 0
    const piyasa = s.buyPriceAt(s.day + d, 'benzin')
    s.supplier = 'rafineri'; s.refineryLevel = 3
    if (ham > piyasa) ust++; else alt++
  }
  check('60 günde filo çoğunlukla ucuz ama bazı günler piyasayı AŞAR (risk gerçek)', alt > ust && ust >= 1, `ucuz ${alt} · pahalı ${ust}`)
  check('tanker süresi 0.55 × 0.75', yakin(s.supplierEtaMult(), 0.55 * REFINERY_ETA_MULT))
  check('OPEX ₺110.000/gün · daha kademe yok (max)', s.refineryOpex() === 110_000 && s.canBuildRefinery().reason === 'max')
  {
    const a = hazir(); a.refineryLevel = 1; checkAchievements(a)
    check('başarım "refinery" kademe 1\'de düşer, "refinery-fleet" düşmez', a.achievements.has('refinery') && !a.achievements.has('refinery-fleet'))
    a.refineryLevel = 3; checkAchievements(a)
    check('başarım "refinery-fleet" kademe 3\'te düşer', a.achievements.has('refinery-fleet'))
  }
}

// ─────────────────────────────────────────────────────────────────────────────
console.log('\n── 6) OPEX tablosu ──')
{
  const s = new GameState()
  const seri = [0, 1, 2, 3].map(l => { s.refineryLevel = l; return s.refineryOpex() })
  check('kademe 0/1/2/3 → ₺0/40k/70k/110k', seri.join() === REFINERY_OPEX.join() && REFINERY_OPEX.join() === '0,40000,70000,110000', seri.join())
}

// ─────────────────────────────────────────────────────────────────────────────
console.log('\n── 7) DEVİRDE KALIR, eşiğe SAYILMAZ ──')
{
  const x = new GameState()
  x.pumps = 14; x.evChargers = 12; x.signLevel = 3; x.tankLevel = 3
  x.marketLevel = 3; x.market2Level = 3; x.toiletLevel = 2; x.toilet2Level = 2
  x.gridLevel = 2; x.batteryLevel = 6; x.solarCount = 6
  x.airWaterCount = 3; x.selfWashCount = 3; x.parkingCount = 8; x.lampCount = 6
  x.tankCounts = { benzin: 4, dizel: 4, lpg: 4 }
  x.hasWash = x.hasOil = x.hasCoffee = x.hasRestaurant = x.hasTruckPark = true
  x.hasWash2 = x.hasOil2 = x.hasCoffee2 = x.hasRestaurant2 = x.hasTruckPark2 = true
  x.hasSMR = x.hasDiesel = x.hasHotel = x.hasCleaner = x.wideGates = true
  x.day = 120; x.money = 50_000
  x.salesLog = Array.from({ length: 30 }, (_, i) => ({ day: 120 - i, rev: 9000 }))
  const eqOnce = x.companyEquipmentValue()
  x.refineryLevel = 2; x.refineryDaysLeft = 3
  check('rafineri companyEquipmentValue\'yu DEĞİŞTİRMEZ (devir eşiği farmı yok)', x.companyEquipmentValue() === eqOnce)
  check('devir mümkün', x.canHandover())
  const r = x.handover()
  check('devir gerçekleşti, pompalar sıfırlandı', !!r && x.pumps === 1)
  check('rafineri kademesi ve inşaatı DEVİRDEN SONRA DURUYOR', x.refineryLevel === 2 && x.refineryDaysLeft === 3)
}

// ─────────────────────────────────────────────────────────────────────────────
console.log('\n── 8) KAYIT: SAVE_FIELDS + hydrate clamp + eski kayıt ──')
{
  check('refineryLevel/refineryDaysLeft kayda GİRİYOR', 'refineryLevel' in serializeState(hazir()) && 'refineryDaysLeft' in serializeState(hazir()))
  const s = hazir(); s.refineryLevel = 2; s.refineryDaysLeft = 5
  const ser = serializeState(s)
  const s2 = new GameState(); hydrateState(s2, JSON.parse(JSON.stringify(ser)))
  check('serialize → hydrate birebir', s2.refineryLevel === 2 && s2.refineryDaysLeft === 5)
  const bozuk = { ...ser, refineryLevel: 9, refineryDaysLeft: 999 }
  const s3 = new GameState(); hydrateState(s3, bozuk)
  check('bozuk kayıt: kademe ≤ 3, kademe max ise inşaat 0', s3.refineryLevel === REFINERY_MAX && s3.refineryDaysLeft === 0)
  const bozuk2 = { ...ser, refineryLevel: -4, refineryDaysLeft: 'abc' }
  const s4 = new GameState(); hydrateState(s4, bozuk2)
  check('negatif/NaN → 0', s4.refineryLevel === 0 && s4.refineryDaysLeft === 0)
  const eski = { ...ser }; delete eski.refineryLevel; delete eski.refineryDaysLeft
  const s5 = new GameState(); hydrateState(s5, eski)
  check('rafineri alanı olmayan ESKİ kayıt çökmez, kademe 0', s5.refineryLevel === 0 && s5.refineryDaysLeft === 0 && s5.refineryOpex() === 0)
  check('eski kayıtta kota eskisi gibi sonlu', s5.unlockLoc('cevreyolu-2') !== undefined && Number.isFinite(s5.supplyQuota('cevreyolu')) )
}

// ─────────────────────────────────────────────────────────────────────────────
console.log('\n── 9) SUNUCU PARİTESİ ──')
{
  const srvCosts = (src.match(/const REFINERY_COSTS = \[([^\]]+)\]/) ?? [])[1]?.split(',').map(x => Number(x.trim().replace(/_/g, '')))
  check('server REFINERY_COSTS istemciyle BİREBİR', Array.isArray(srvCosts) && srvCosts.join() === REFINERY_COSTS.join(), JSON.stringify(srvCosts))
  const srvMax = Number((src.match(/const REFINERY_MAX = (\d+)/) ?? [])[1])
  check('server REFINERY_MAX = 3', srvMax === REFINERY_MAX)
  const s = hazir()
  const base = buildingValue(serializeState(s))
  s.startRefinery()
  const insaat = buildingValue(serializeState(s))
  check('inşaat BAŞLARKEN servet bedeli sayar (para → bina; servet sıçraması yok)', insaat - base === REFINERY_COSTS[0], `${insaat - base}`)
  s.refineryLevel = 1; s.refineryDaysLeft = 0
  check('tamamlanınca değer AYNI kalır (ikinci sıçrama yok)', buildingValue(serializeState(s)) - base === REFINERY_COSTS[0])
  s.refineryLevel = 3
  check('kademe 3 = üç bedelin toplamı', buildingValue(serializeState(s)) - base === REFINERY_COSTS.reduce((a, b) => a + b, 0))
  s.refineryLevel = 3; s.refineryDaysLeft = 5 // imkânsız: max'ta inşaat — tavan aşılmasın
  check('max kademe + inşaat: değer 3 kademeyi AŞMAZ', buildingValue(serializeState(s)) - base === REFINERY_COSTS.reduce((a, b) => a + b, 0))
  const san = sanitizeSave({ s: { ...serializeState(s), refineryLevel: 7, refineryDaysLeft: 400 } }).s
  check('sanitizeSave clamp: kademe ≤ 3, gün ≤ 10', san.refineryLevel === 3 && san.refineryDaysLeft === 10, JSON.stringify([san.refineryLevel, san.refineryDaysLeft]))
  const san2 = sanitizeSave({ s: { ...serializeState(s), refineryLevel: -1, refineryDaysLeft: -9 } }).s
  check('sanitizeSave clamp: negatif → 0', san2.refineryLevel === 0 && san2.refineryDaysLeft === 0)
}

// ─────────────────────────────────────────────────────────────────────────────
console.log('\n── 10) HARİTA DÜĞÜMÜ ──')
{
  const s = new GameState(); s.money = 5_000
  let r = rafineriDugumu(s)
  check('RAFINERI_ID "rafineri", düğüm kilitli (yıldız)', RAFINERI_ID === 'rafineri' && r.seviye === 0 && !r.sonraki.ok && r.sonraki.reason === 'yildiz')
  const h = hazir(); h.startRefinery()
  r = rafineriDugumu(h)
  check('inşaat düğümde görünür (insaat=true, gunKaldi=6, ilerleme 0)', r.insaat && r.gunKaldi === 6 && r.ilerleme === 0)
  gunGec(h); r = rafineriDugumu(h)
  check('bir gün sonra ilerleme 1/6', yakin(r.ilerleme, 1 / 6))
  h.refineryLevel = 2; h.refineryDaysLeft = 0
  h.unlockLoc('otoyol-2'); h.money = 1e9
  const hat = haritaHatlari(h).find(x => x.taban === 'otoyol')
  check('kademe 2: hat kotasiz=true, kalan Infinity (metin "∞")', hat && hat.kotasiz && hat.kalan === Infinity)
  r = rafineriDugumu(h)
  check('düğüm: kotasiz=true, filo=false, opex 70k', r.kotasiz && !r.filo && r.opex === 70_000)
  h.refineryLevel = 3
  check('kademe 3: filo=true, sonraki=max', rafineriDugumu(h).filo && rafineriDugumu(h).sonraki.reason === 'max')
  // hatKapsam: harita.ts'te kalan Infinity için tl() değil lt() kullanılmalı (NaN/"∞" karışmasın)
  const hsrc = fs.readFileSync(new URL('../../src/harita.ts', import.meta.url), 'utf8')
  check('harita.ts kalan litreyi Infinity-güvenli yazar (lt(hat.kalan))', hsrc.includes('lt(hat.kalan)') && !hsrc.includes('tl(hat.kalan)'))
  check('index.html #i-loc-rafineri sembolü var', fs.readFileSync(new URL('../../index.html', import.meta.url), 'utf8').includes('id="i-loc-rafineri"'))
}

console.log(`\nSONUÇ: ${pass} geçti, ${fail} kaldı`)
process.exit(fail ? 1 : 0)
