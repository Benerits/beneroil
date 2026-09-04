/**
 * ŞUBE ÇİFTLEME TESTİ — "aynı türden ikinci şube" (oyuncu talebi)
 *
 * NEDEN VAR: kopya şube kopyala-yapıştır OLMAMALI. Oyun sahibinin kuralı net —
 * "her kopyanın KENDİ KISITI olsun, kopyala-yapıştır değil FARKLI PROBLEM".
 * Bu test kısıtların GERÇEKTEN farklı olduğunu SAYIYLA kanıtlar (bedel/OPEX/trafik),
 * ve çiftlemenin kayıt/geçiş/servet hattını bozmadığını doğrular.
 *
 * Çalıştır: npm run test:subeciftleme
 */
globalThis.localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} }
Object.defineProperty(globalThis, 'navigator', { value: { language: 'tr' }, configurable: true })
const fs = await import('node:fs')
const {
  GameState, serializeState, hydrateState,
  ALL_LOCS, BASE_LOCS, COPY_LOCS, BRANCH_COPIES, baseLoc, isCopyLoc, themeFor,
  SUPPLY_LINE_QUOTA, SUPPLY_USED_MAX,
} = await import('../../src/state.ts')

// Sunucu servet fonksiyonlarını server/index.js'ten CANLI çıkar (kopya sürüklenmesi olmasın)
const src = fs.readFileSync(new URL('../../server/index.js', import.meta.url), 'utf8')
const block = src.slice(src.indexOf('const clamp = '), src.indexOf('function sanitizeSave'))
const srvFns = new Function(block + '; return { buildingValue, snapshotsValue, maxIncomeRate, burstCap, VALID_LOCS }')()
const { buildingValue, snapshotsValue, burstCap } = srvFns
// sanitizeSave gövdesi ayrı çıkarılır (VALID_LOC listesi + snapshot clamp'leri onun içinde)
const sanBlock = src.slice(src.indexOf('const clamp = '), src.indexOf('// ---- hız limitleri'))
const { sanitizeSave } = new Function(sanBlock + '; return { sanitizeSave }')()
const wealth = ser => (Number(ser.money) || 0) + buildingValue(ser) + snapshotsValue(ser)

let pass = 0, fail = 0
const check = (n, c, d = '') => { c ? (pass++, console.log('  ✓ ' + n)) : (fail++, console.log(`  ✗ ${n}${d ? ' — ' + d : ''}`)) }
const layout = () => ({ placedPos: {}, placedRot: {}, placedRects: [] })
const tl = n => Math.round(n).toLocaleString('tr-TR')

// ─────────────────────────────────────────────────────────────────────────────
console.log('\n── 1) ŞUBE ÇİFTLEME VAR MI ──')
check('4 kopya şube tanımlı (cevreyolu-2 / otoyol-2 / marina-2 / metropol-2)',
  COPY_LOCS.length === 4 && ['cevreyolu-2', 'otoyol-2', 'marina-2', 'metropol-2'].every(x => COPY_LOCS.includes(x)),
  JSON.stringify(COPY_LOCS))
check('toplam 9 şube (5 taban + 4 kopya)', ALL_LOCS.length === 9 && BASE_LOCS.length === 5)
check('baseLoc kopyayı tabana indirir', baseLoc('otoyol-2') === 'otoyol' && baseLoc('kasaba') === 'kasaba')
check('bilinmeyen id güvenli tabana düşer (çökmez)', baseLoc('atlantis-7') === 'kasaba')
check('isCopyLoc yalnız kopyalara TRUE', isCopyLoc('metropol-2') === true && isCopyLoc('metropol') === false)

// Kopya teması SAHNE kimliğini korumalı: world.ts th.id'ye bakıp doku/siluet kuruyor.
for (const c of COPY_LOCS) {
  check(`${c} teması sahne kimliğini koruyor (theme.id === ${baseLoc(c)})`, themeFor(c).id === baseLoc(c))
  check(`${c} adı tabandan FARKLI (arayüzde ayırt edilir)`, themeFor(c).name !== themeFor(baseLoc(c)).name,
    themeFor(c).name)
}

// ─────────────────────────────────────────────────────────────────────────────
console.log('\n── 2) AÇILIŞ AKIŞI: taban olmadan kopya YOK ──')
{
  const s = new GameState()
  s.money = 5_000_000_000; s.brandStars = 40
  check('taban şube kapalıyken kopya açılamaz (reason=taban)',
    s.canUnlockLoc('otoyol-2').ok === false && s.canUnlockLoc('otoyol-2').reason === 'taban')
  check('kopya gerçekten açılamaz', s.unlockLoc('otoyol-2') === false)
  s.unlockLoc('cevreyolu'); s.unlockLoc('otoyol')
  check('taban açıksa kopya açılabilir', s.canUnlockLoc('otoyol-2').ok === true, s.canUnlockLoc('otoyol-2').reason)
  check('aynı türden İKİNCİ şube AÇILDI', s.unlockLoc('otoyol-2') === true && s.unlockedLocs.includes('otoyol-2'))
  check('aynı kopya ikinci kez açılamaz', s.unlockLoc('otoyol-2') === false)
  check('5 şube sınırı kalktı — 9 şubeye kadar', ALL_LOCS.every(l => l === 'kasaba' || s.unlockLoc(l) || s.unlockedLocs.includes(l))
    && s.unlockedLocs.length === 9, String(s.unlockedLocs.length))
}

// ─────────────────────────────────────────────────────────────────────────────
console.log('\n── 3) EKSEN 1 — ARTAN BEDEL (her kopya tabanından PAHALI) ──')
{
  for (const c of COPY_LOCS) {
    const b = baseLoc(c)
    // aynı "açık şube sayısı" altında karşılaştır: fark SALT kopya zammından gelsin
    const s = new GameState()
    s.unlockedLocs = ['kasaba', b]
    const cTaban = s.branchUnlockCost(b)
    const cKopya = s.branchUnlockCost(c)
    const kat = cKopya / cTaban
    check(`${c} bedeli tabanın ${kat.toFixed(2)}× katı (₺${tl(cTaban)} → ₺${tl(cKopya)})`, kat >= 2.5 && kat <= 5)
    check(`${c} marka yıldızı şartı daha yüksek (${themeFor(b).unlock.stars}★ → ${themeFor(c).unlock.stars}★)`,
      themeFor(c).unlock.stars > themeFor(b).unlock.stars)
  }
  // üstel değil ama hissedilir: açık şube sayısı arttıkça mevcut BRANCH_COST_STEP de ekleniyor
  const az = new GameState(); az.unlockedLocs = ['kasaba', 'cevreyolu']
  const cok = new GameState(); cok.unlockedLocs = ['kasaba', 'cevreyolu', 'otoyol', 'marina', 'metropol']
  check(`çok şubeli oyuncuda kopya daha da pahalı (₺${tl(az.branchUnlockCost('cevreyolu-2'))} → ₺${tl(cok.branchUnlockCost('cevreyolu-2'))})`,
    cok.branchUnlockCost('cevreyolu-2') > az.branchUnlockCost('cevreyolu-2'))
}

// ─────────────────────────────────────────────────────────────────────────────
console.log('\n── 4) EKSEN 2 — HER KOPYANIN KENDİ KISITI (ölçülmüş fark) ──')
{
  // (a) METROPOL II: daha yüksek KİRA/OPEX
  const kur = loc => {
    const s = new GameState()
    s.unlockedLocs = ['kasaba', baseLoc(loc), loc]
    s.activeLoc = loc
    s.day = 200; s.opexStart = 1
    s.pumps = 8; s.marketLevel = 3; s.evChargers = 4; s.tankLevel = 3
    s.ownedParcels = new Set(['0,0', '1,0', '2,0'])
    return s
  }
  const m1 = kur('metropol'), m2 = kur('metropol-2')
  const o1 = m1.dailyOpex(), o2 = m2.dailyOpex()
  check(`Metropol II günlük OPEX daha yüksek: ₺${tl(o1)} → ₺${tl(o2)} (×${(o2 / o1).toFixed(2)})`, o2 > o1 * 1.5)
  check(`Metropol II arsa daha pahalı ve daha AZ (parsel tavanı ${themeFor('metropol').features.land.maxParcels} → ${themeFor('metropol-2').features.land.maxParcels}, `
    + `fiyat ×${themeFor('metropol').features.land.priceMult} → ×${themeFor('metropol-2').features.land.priceMult})`,
    themeFor('metropol-2').features.land.maxParcels < themeFor('metropol').features.land.maxParcels
    && themeFor('metropol-2').features.land.priceMult > themeFor('metropol').features.land.priceMult)
  check('Metropol II parselLimit gerçekten daha dar', m2.parcelLimit() < m1.parcelLimit(),
    `${m2.parcelLimit()} vs ${m1.parcelLimit()}`)

  // (b) ÇEVRE YOLU II: daha DÜŞÜK taban trafik, daha YÜKSEK marj
  const c1 = themeFor('cevreyolu').econ, c2 = themeFor('cevreyolu-2').econ
  const trafikFark = (1 - c2.entryBase / c1.entryBase) * 100
  check(`Çevre Yolu II taban trafiği %${trafikFark.toFixed(0)} DÜŞÜK (${c1.entryBase} → ${c2.entryBase})`,
    c2.entryBase < c1.entryBase * 0.85)
  check(`Çevre Yolu II fiyat esnekliği DÜŞÜK = marj yüksek (${c1.priceElasticity} → ${c2.priceElasticity})`,
    c2.priceElasticity < c1.priceElasticity * 0.75)
  // marj farkı DAVRANIŞTA da görünmeli: aynı zamda kaybedilen müşteri daha az
  const zam = loc => {
    const s = new GameState(); s.unlockedLocs = ['kasaba', baseLoc(loc), loc]; s.activeLoc = loc
    const ucuz = s.entryChance()
    for (const f of ['benzin', 'dizel', 'lpg']) s.prices[f] = s.prices[f] * 1.25
    return s.entryChance() / ucuz
  }
  const zc1 = zam('cevreyolu'), zc2 = zam('cevreyolu-2')
  check(`Çevre Yolu II'de %25 zam daha az müşteri kaçırıyor (kalan pay ${(zc1 * 100).toFixed(0)}% → ${(zc2 * 100).toFixed(0)}%)`,
    zc2 > zc1)

  // (c) OTOYOL II: rakip AYNI ÇIKIŞTA — güçlü doğar
  const oto2 = new GameState()
  oto2.unlockedLocs = ['kasaba', 'otoyol', 'otoyol-2']; oto2.activeLoc = 'otoyol-2'; oto2.day = 12
  const oto1 = new GameState()
  oto1.unlockedLocs = ['kasaba', 'otoyol']; oto1.activeLoc = 'otoyol'; oto1.day = 12
  oto1.rivalDayTurn(); oto2.rivalDayTurn()
  check(`Otoyol II rakibi GÜÇLÜ doğuyor (güç ${oto1.rival.strength} → ${oto2.rival.strength})`,
    oto2.rival && oto1.rival && oto2.rival.strength > oto1.rival.strength * 1.5)
  check('Otoyol II rakibi kurumsal zincir (taban otoyolla aynı kişilik)', oto2.rivalKind() === 'kurumsal')
  const p1 = oto1.marketShare(), p2 = oto2.marketShare()
  check(`Otoyol II'de pazar payın daha düşük başlıyor (%${(p1 * 100).toFixed(0)} → %${(p2 * 100).toFixed(0)})`, p2 < p1)
  check(`Otoyol II yavaşlama şeridi daha KISA (${themeFor('otoyol').features.highway.rampCap} → ${themeFor('otoyol-2').features.highway.rampCap} araç)`,
    themeFor('otoyol-2').features.highway.rampCap < themeFor('otoyol').features.highway.rampCap)

  // (d) MARİNA II: dış liman — daha çok tekne, daha pahalı kadro, DAR rıhtım
  const ma1 = themeFor('marina'), ma2 = themeFor('marina-2')
  check(`Marina II trafiği daha yüksek (${ma1.econ.entryBase} → ${ma2.econ.entryBase}) ama kadro daha pahalı (×${ma1.econ.wageMult} → ×${ma2.econ.wageMult})`,
    ma2.econ.entryBase > ma1.econ.entryBase && ma2.econ.wageMult > ma1.econ.wageMult)
  check(`Marina II rıhtımı DAR: tank kapasitesi ×${ma1.features.tankCapMult} → ×${ma2.features.tankCapMult}, tank sayısı ${ma1.features.maxTanksPerFuel} → ${ma2.features.maxTanksPerFuel}`,
    ma2.features.tankCapMult < ma1.features.tankCapMult && ma2.features.maxTanksPerFuel < ma1.features.maxTanksPerFuel)
  const marS = new GameState()
  marS.unlockedLocs = ['kasaba', 'marina', 'marina-2']; marS.activeLoc = 'marina-2'
  check('Marina II hâlâ SU şubesi (tekne trafiği korunur)', marS.isMarina === true)

  // (e) KOPYALARIN HİÇBİRİ TABANIN AYNISI DEĞİL — kopyala-yapıştır freni
  for (const c of COPY_LOCS) {
    const a = themeFor(baseLoc(c)), b = themeFor(c)
    const eksen = ['entryBase', 'priceElasticity', 'repWeight', 'signWeight', 'tipRate', 'wageMult']
      .filter(k => a.econ[k] !== b.econ[k]).length
      + (BRANCH_COPIES[c].opexMult !== 1 ? 1 : 0)
      + (JSON.stringify(a.features ?? {}) !== JSON.stringify(b.features ?? {}) ? 1 : 0)
    check(`${c}: tabandan ${eksen} eksende ayrışıyor (en az 2 şart)`, eksen >= 2)
  }
}

// ─────────────────────────────────────────────────────────────────────────────
console.log('\n── 5) EKSEN 3 — YENİ KARAR: PAYLAŞILAN TEDARİK HATTI ──')
{
  // Tek başına taban şube: kota YOK (eski davranış birebir korunur)
  const yalniz = new GameState()
  yalniz.unlockedLocs = ['kasaba', 'metropol']; yalniz.activeLoc = 'metropol'
  check('tek şube (kopya kapalı) → tedarik kotası YOK, eski davranış', yalniz.supplyLine() === null
    && yalniz.supplyRemaining() === Infinity)

  const s = new GameState()
  s.unlockedLocs = ['kasaba', 'metropol', 'metropol-2']; s.activeLoc = 'metropol-2'
  s.money = 50_000_000; s.tankLevel = 3
  s.locSnapshots['metropol'] = { f: { managerLevel: 3, staffLevel: 1, pumps: 10, marketLevel: 3, evChargers: 4, equipVal: 900_000 },
    autoPumps: [0, 1], autoChargers: [], equipVal: 900_000 }
  check('kopya + tabanı açık → ORTAK tedarik hattı kuruldu', s.supplyLine() === 'metropol')
  // KOTA TANK KAPASİTESİYLE BÜYÜR (canlı: 14 pompalı Çevre Yolu 5 gün üst üste tam 9.000 L'ye
  // yaslanmıştı — "ortak havuzdan yakıt bitince sıkıntı"). Burada tankLevel 3 ama sayaç 1 → 15.000 L.
  s.tankCounts = { benzin: 1, dizel: 1, lpg: 1 }
  check(`kota tank kapasitesi kadar (3×5.000 = 15.000 L ≥ taban ${SUPPLY_LINE_QUOTA})`, s.supplyQuota() === 15_000 && s.supplyRemaining() === 15_000)
  s.tankCounts = { benzin: 4, dizel: 4, lpg: 4 }
  check('tank ekleyince kota büyür (4 tank × 3 yakıt = 60.000 L)', s.supplyQuota() === 60_000)
  const kucuk = new GameState(); kucuk.unlockedLocs = ['kasaba', 'metropol', 'metropol-2']; kucuk.activeLoc = 'metropol-2'
  check(`küçük istasyonda taban kota ${SUPPLY_LINE_QUOTA} L korunur (2.400 L kapasite → taban)`, kucuk.supplyQuota() === SUPPLY_LINE_QUOTA)
  check('hattın kotası başlangıçta dolu', s.supplyRemaining() === s.supplyQuota())

  const kardesTam = s.branchNetPerDay('metropol').net
  // aktif şubede tankları doldur → hattı tüket
  let cekilen = 0
  for (const f of ['benzin', 'dizel', 'lpg']) {
    s.tanks[f] = 0; s.tankCounts[f] = 4
    s.orderQty[f] = 999
    const need = s.orderNeed(f)
    if (s.placeOrder(f)) cekilen += need
    s.orders[f] = { pending: false, eta: 0, arrived: false, delivering: false, amount: 0 }
  }
  check(`aktif şube hattan ${cekilen}L çekti (kota ${s.supplyQuota()}L)`, cekilen > 0)
  check(`hattan kalan düştü: ${s.supplyRemaining()}L`, s.supplyRemaining() < s.supplyQuota())

  // hattı tamamen tüket → kardeş şube AÇ KALIR ama SİPARİŞ KİLİTLENMEZ ("Kota Doldu" duvarı bitti)
  s.supplyUsed['metropol'] = s.supplyQuota()
  s.tanks.benzin = 0
  check('kota bitince aktif şube YİNE sipariş verebilir (duvar yok)', s.canOrder('benzin') === true && s.orderNeed('benzin') > 0)
  check('kota aşıldı: kalan 0, doluluk 1 (arayüz "aşıldı" der)', s.supplyRemaining() === 0 && s.supplyFill() === 1)
  const asimOnce = s.supplyUsed['metropol']
  check('aşım siparişi kayda geçer (bedel kardeşe yansır)', s.placeOrder('benzin') && s.supplyUsed['metropol'] > asimOnce)
  s.orders.benzin = { pending: false, eta: 0, arrived: false, delivering: false, amount: 0 }
  const paraOnce = s.money
  const sonuc = s.accrueBranchVaults()
  const kardesGercek = s.money - paraOnce
  check(`kardeş şube AÇ KALDI: potansiyel ₺${tl(kardesTam)} → gerçekleşen ₺${tl(kardesGercek)}`,
    kardesGercek > 0 && kardesGercek < kardesTam * 0.8)
  check('gün raporu "yakıtsız kaldı" bilgisini taşıyor', sonuc.some(x => x.loc === 'metropol' && x.starved === true))
  check('gün dönüşünde kota SIFIRLANDI (ertesi gün yeni karar)', s.supplyRemaining() === s.supplyQuota())

  // hattı hiç kullanmayan oyuncu tam geliri alır (ceza YOK)
  const t2 = new GameState()
  t2.unlockedLocs = ['kasaba', 'metropol', 'metropol-2']; t2.activeLoc = 'metropol-2'
  t2.locSnapshots['metropol'] = { f: { managerLevel: 3, staffLevel: 1, pumps: 10, marketLevel: 3, evChargers: 4, equipVal: 900_000 },
    autoPumps: [0, 1], autoChargers: [], equipVal: 900_000 }
  const p0 = t2.money; t2.accrueBranchVaults()
  check('hattı kullanmayan oyuncu TAM geliri alır (ceza yok)', Math.abs((t2.money - p0) - kardesTam) <= 1)
  check(`karar gerçekten ısırıyor: aynı gün fark ₺${tl(kardesTam - kardesGercek)}`, kardesTam - kardesGercek > 0)

  // FARKLI hatlar birbirini etkilemez (otoyol hattı metropol hattından bağımsız)
  const iki = new GameState()
  iki.unlockedLocs = ['kasaba', 'metropol', 'metropol-2', 'otoyol', 'otoyol-2']
  iki.activeLoc = 'metropol-2'
  iki.supplyUsed['metropol'] = iki.supplyQuota()
  check('hatlar bağımsız: metropol hattı bitse de otoyol hattı dolu',
    iki.supplyRemaining('otoyol-2') === iki.supplyQuota('otoyol-2'))
  // sunucu kırpma tavanı istemciyle BİREBİR (eski 9.000 kırpması büyüyen kotayı sessizce sıfırlardı)
  const srvMax = Number((src.match(/const SUPPLY_USED_MAX = ([\d_]+)/) ?? [])[1]?.replace(/_/g, ''))
  check(`sunucu SUPPLY_USED_MAX (${srvMax}) istemciyle aynı`, srvMax === SUPPLY_USED_MAX)
  check('sunucu supplyUsed kırpması SUPPLY_USED_MAX kullanıyor', /Math\.min\(SUPPLY_USED_MAX, Math\.round\(v\)\)/.test(src))
}

// ─────────────────────────────────────────────────────────────────────────────
console.log('\n── 6) KAYIT/YÜKLEME TURU + ŞUBE GEÇİŞİ (snapshot karışmıyor) ──')
{
  const s = new GameState()
  s.money = 60_000_000; s.brandStars = 40; s.day = 300
  for (const l of ['cevreyolu', 'otoyol', 'otoyol-2']) s.unlockLoc(l)
  // TABAN otoyola geç, oraya 9 pompa kur
  s.switchLoc('otoyol', layout())
  s.pumps = 9; s.signLevel = 3
  // KOPYAYA geç, oraya 3 pompa kur
  s.switchLoc('otoyol-2', layout())
  check('kopyaya geçişte TEMİZ şube geldi (tabanın ekipmanı sızmadı)', s.pumps === 1 && s.signLevel === 0,
    `pumps=${s.pumps} sign=${s.signLevel}`)
  s.pumps = 3; s.signLevel = 1
  s.switchLoc('otoyol', layout())
  check('tabana dönünce KENDİ ekipmanı geri geldi', s.pumps === 9 && s.signLevel === 3, `pumps=${s.pumps}`)
  s.switchLoc('otoyol-2', layout())
  check('kopyaya dönünce KENDİ ekipmanı geri geldi', s.pumps === 3 && s.signLevel === 1, `pumps=${s.pumps}`)

  // kayıt turu
  const ser = serializeState(s)
  const s2 = new GameState()
  hydrateState(s2, JSON.parse(JSON.stringify(ser)))
  check('kayıt turu: kopya açık listede kaldı', s2.unlockedLocs.includes('otoyol-2'))
  check('kayıt turu: aktif şube kopya', s2.activeLoc === 'otoyol-2')
  check('kayıt turu: kopyanın ekipmanı aynı', s2.pumps === 3 && s2.signLevel === 1)
  check('kayıt turu: tabanın snapshot\'ı ayrı duruyor', s2.locSnapshots['otoyol']?.f?.pumps === 9)
  check('kayıt turu: aktif şube snapshot\'ta YOK (çift sayım freni)', !s2.locSnapshots['otoyol-2'])
  s2.switchLoc('otoyol', layout())
  check('yüklemeden sonra geçiş turu da doğru', s2.pumps === 9)
}

// ─────────────────────────────────────────────────────────────────────────────
console.log('\n── 7) ESKİ KAYIT GÜVENLİĞİ (hydrate "alan varsa" korumalı) ──')
{
  // (a) çoklu şube alanı OLMAYAN eski kayıt
  const eski = new GameState(); eski.pumps = 4
  const ser = serializeState(eski)
  delete ser.activeLoc; delete ser.unlockedLocs; delete ser.locSnapshots; delete ser.supplyUsed
  const y = new GameState()
  hydrateState(y, ser)
  check('eski kayıt (şube alanı yok) → tek şube kasaba, çökme yok',
    y.activeLoc === 'kasaba' && y.unlockedLocs.length === 1 && y.pumps === 4)
  check('eski kayıtta tedarik hattı YOK (yeni mekanik eskiyi ısırmaz)', y.supplyLine() === null)

  // (b) BİLİNMEYEN şube id'si (ileri sürüm / kurcalanmış) — çökmemeli
  const bad = new GameState()
  hydrateState(bad, { activeLoc: 'otoyol-9', unlockedLocs: ['kasaba', 'otoyol-2', 'atlantis-2', 'otoyol-3'],
    locSnapshots: { 'otoyol-2': { f: { pumps: 5 } }, 'atlantis-2': { f: { pumps: 99 } } },
    branchVault: { 'otoyol-2': 1000, 'atlantis-2': 999999 } })
  check('bilinmeyen şube id atıldı, geçerli kopya KALDI',
    bad.unlockedLocs.includes('otoyol-2') && !bad.unlockedLocs.includes('atlantis-2')
    && !bad.unlockedLocs.includes('otoyol-3'))
  check('bilinmeyen aktif şube kasabaya düştü (çökme yok)', bad.activeLoc === 'kasaba')
  check('bilinmeyen snapshot/kasa atıldı', !bad.locSnapshots['atlantis-2'] && !bad.branchVault['atlantis-2'])
  check('geçerli kopya snapshot\'ı korundu', bad.locSnapshots['otoyol-2']?.f?.pumps === 5)

  // (c) ESKİ İSTEMCİ simülasyonu: kopya id'lerini tanımayan sürüm listeyi süzer, çökmez
  const eskiSurumVALID = ['kasaba', 'cevreyolu', 'otoyol', 'marina', 'metropol']
  const kopyali = { activeLoc: 'metropol-2', unlockedLocs: ['kasaba', 'metropol', 'metropol-2'] }
  const suzulmus = kopyali.unlockedLocs.filter(x => eskiSurumVALID.includes(x))
  check('eski istemci kopyayı süzer ama kasabayı/tabanı kaybetmez (çökmez)',
    suzulmus.length === 2 && suzulmus.includes('metropol'))
}

// ─────────────────────────────────────────────────────────────────────────────
console.log('\n── 8) SUNUCU UYUMU: servet + anti-cheat kopyaları SAYIYOR ──')
{
  const s = new GameState()
  s.money = 2_000_000_000; s.brandStars = 40; s.day = 400
  for (const l of ['cevreyolu', 'otoyol', 'otoyol-2', 'metropol', 'metropol-2']) {
    check(`${l} açıldı (sunucu turu için)`, s.unlockLoc(l) === true, JSON.stringify(s.canUnlockLoc(l)))
  }
  s.switchLoc('otoyol-2', layout())
  s.pumps = 10; s.marketLevel = 3; s.evChargers = 6; s.managerLevel = 3
  s.switchLoc('metropol-2', layout())
  s.pumps = 8; s.marketLevel = 3; s.managerLevel = 3

  const ser = serializeState(s)
  const once = wealth(ser)
  const temiz = sanitizeSave({ s: JSON.parse(JSON.stringify(ser)) })
  check('sunucu kopya şubeleri kayıttan SİLMİYOR',
    temiz.s.unlockedLocs.includes('otoyol-2') && temiz.s.unlockedLocs.includes('metropol-2'),
    JSON.stringify(temiz.s.unlockedLocs))
  check('sunucu aktif kopya şubeyi kasabaya düşürmüyor', temiz.s.activeLoc === 'metropol-2')
  check('sunucu kopya snapshot\'ını koruyor', !!temiz.s.locSnapshots['otoyol-2'])
  const sonra = wealth(temiz.s)
  check(`istemci/sunucu servet uyumu: ₺${tl(once)} ≈ ₺${tl(sonra)} (kırpma yok)`, Math.abs(once - sonra) < 1)
  check('kopya şubenin ekipmanı servete GİRİYOR (yoksa anti-cheat meşru oyuncuyu kırpar)',
    snapshotsValue(temiz.s) > 0)

  // kova tavanı 5 şubede sabitlenmemeli — 9 şubede daha büyük olmalı
  const bes = { unlockedLocs: ['kasaba', 'cevreyolu', 'otoyol', 'marina', 'metropol'] }
  const dokuz = { unlockedLocs: [...ALL_LOCS] }
  check(`anti-cheat kovası şube sayısıyla büyüyor (5 şube ₺${tl(burstCap(bes))} → 9 şube ₺${tl(burstCap(dokuz))})`,
    burstCap(dokuz) > burstCap(bes))

  // marina-2 tank clamp'i tabanla aynı SINIFTA olmalı (kayıt kaybı olmasın)
  const mar = { s: { unlockedLocs: ['kasaba', 'marina', 'marina-2'], activeLoc: 'kasaba',
    locSnapshots: { 'marina-2': { f: { pumps: 2, tankLevel: 3 }, tankCounts: { benzin: 6, dizel: 6, lpg: 6 },
      tanks: { benzin: 30000, dizel: 30000, lpg: 30000 } } } } }
  const marT = sanitizeSave(mar)
  check('marina-2 snapshot\'ı marina tank limitleriyle temizleniyor (6 tank hayatta)',
    marT.s.locSnapshots['marina-2'].tankCounts.benzin === 6,
    String(marT.s.locSnapshots['marina-2'].tankCounts.benzin))
}

// ─────────────────────────────────────────────────────────────────────────────
console.log('\n── 9) MEVCUT SİSTEMLERLE UYUM (müdür / kasa / devir) ──')
{
  const s = new GameState()
  s.money = 40_000_000; s.brandStars = 30
  for (const l of ['cevreyolu', 'cevreyolu-2']) s.unlockLoc(l)
  s.locSnapshots['cevreyolu-2'] = { f: { managerLevel: 2, staffLevel: 1, pumps: 6, marketLevel: 2, equipVal: 400_000 },
    autoPumps: [0], autoChargers: [], equipVal: 400_000 }
  const d = s.branchNetPerDay('cevreyolu-2')
  check(`kopya şubede MÜDÜR çalışıyor (Sv.${d.level}, günlük net ₺${tl(d.net)})`, d.level === 2 && d.net > 0)
  const p0 = s.money
  s.accrueBranchVaults()
  check('kopya şube geliri ortak kasaya akıyor', s.money > p0)
  check('kopya şubenin ekipmanı DEVİR eşiğine sayılıyor', s.companyEquipmentValue() >= 400_000)
  const tekSube = new GameState()
  check(`devir eşiği tavanı şube sayısıyla büyüyor (${tl(tekSube.handoverThreshold())} → ${tl(s.handoverThreshold())})`,
    s.handoverThreshold() >= tekSube.handoverThreshold())

  // KİRA: kopyanın pasif geliri de kira yer (kopya bedava para basmıyor)
  const t1 = new GameState(); t1.unlockedLocs = ['kasaba', 'metropol']
  t1.locSnapshots['metropol'] = { f: { managerLevel: 3, staffLevel: 1, pumps: 10, equipVal: 1_000_000 },
    autoPumps: [], autoChargers: [], equipVal: 1_000_000 }
  const t2 = new GameState(); t2.unlockedLocs = ['kasaba', 'metropol', 'metropol-2']
  t2.locSnapshots['metropol-2'] = { f: { managerLevel: 3, staffLevel: 1, pumps: 10, equipVal: 1_000_000 },
    autoPumps: [], autoChargers: [], equipVal: 1_000_000 }
  const n1 = t1.branchNetPerDay('metropol').net, n2 = t2.branchNetPerDay('metropol-2').net
  check(`aynı ekipmanla Metropol II daha AZ net bırakıyor (kira): ₺${tl(n1)} → ₺${tl(n2)}`, n2 < n1)
}

console.log(`\n${fail === 0 ? '✅' : '❌'} ŞUBE ÇİFTLEME: ${pass} geçti, ${fail} kaldı`)
process.exit(fail === 0 ? 0 : 1)
