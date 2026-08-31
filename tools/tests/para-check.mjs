/**
 * PARA KAYBI ve İADE TESTLERİ — "oyuncu güvenini yiyen" kayıtlar.
 *
 * Her blok bir CANLI oyuncu kaydına dayanır ve KIRMIZI-ÖNCE kanıtı verir: ilgili
 * düzeltmeyi geri alırsan buradaki kontrol düşer.
 *
 *   #1200 mehmet.acar@sardismarkets.me — arsadan vazgeçince para geri gelmedi
 *   #723  (İspanyolca)                 — tesisi iptal edince hem para hem tesis gitti
 *   #812  esatduzgun65@gmail.com       — karşı yaka ünitesinin parası gitti, ünite gelmedi
 *   #740                               — şarjdaki müşteri uğurlanınca para bırakmıyor
 *   #615  tembelligent@gmail.com       — yeterli dizel varken ihale başarısız + ceza
 *   #1239 ftheatral@gmail.com          — Sv.3 müdür reaktöre bakım yapmıyor
 *   #74 #330 #983 #1140 #1220          — kasadan para eriyor / geriye sayıyor
 *
 * Çalıştır: npm run test:para
 */
globalThis.localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} }
Object.defineProperty(globalThis, 'navigator', { value: { language: 'tr' }, configurable: true })

import fs from 'node:fs'
const {
  GameState, buyItem, sellInfo, applySell, serializeState, hydrateState,
  parcelKey, parcelCost, parcelBaseCost, SELL_REFUND, PAVE_COST, unitIndex,
} = await import('../../src/state.ts')

let pass = 0, fail = 0
const check = (n, c, d = '') => { c ? (pass++, console.log('  ✓ ' + n)) : (fail++, console.log(`  ✗ ${n}${d ? ' — ' + d : ''}`)) }
const tl = n => Math.round(n).toLocaleString('tr-TR')

// ─────────────────────────────────────────────────────────────────────────────
console.log('== #1200 · ARSADAN VAZGEÇME: para geri geliyor mu ==')
{
  const s = new GameState()
  s.money = 200_000
  // istasyon (0,1) zaten sahipli; komşu (0,0) alınır + betonlanır
  const once = s.money
  const bedel = parcelCost(0, 0, s)
  s.money -= bedel; s.ownedParcels.add(parcelKey(0, 0))
  s.money -= PAVE_COST; s.pavedParcels.add(parcelKey(0, 0))
  check(`arsa+beton alındı (-₺${tl(once - s.money)})`, s.ownedParcels.has('0,0') && s.isPaved(0, 0))

  const beklenen = Math.round((parcelBaseCost(0) + PAVE_COST) * SELL_REFUND)
  check(`iade bedeli hesaplanabiliyor: ₺${tl(s.parcelRefund(0, 0))}`, s.parcelRefund(0, 0) === beklenen,
    `beklenen ₺${tl(beklenen)}`)

  const kasaOnce = s.money
  const res = s.sellParcel(0, 0)
  check('arsa GERİ SATILABİLDİ (eskiden hiçbir yolu yoktu)', !!res)
  check(`para kasaya GERÇEKTEN döndü: +₺${tl(s.money - kasaOnce)}`, s.money - kasaOnce === beklenen)
  check('arsa mülkiyetten düştü', !s.ownedParcels.has('0,0'))
  check('beton kaydı da düştü (ödenmemiş betona vergi yazılmasın)', !s.pavedParcels.has('0,0'))

  // istasyon parseli satılamaz (kritik altyapı)
  check('istasyonun kurulu olduğu parsel satılamıyor', s.parcelRefund(0, 1) === 0 && s.sellParcel(0, 1) === null)

  // bağlantı bütünlüğü: aradaki arsayı satmak ada bırakmamalı
  const z = new GameState()
  z.money = 500_000
  for (const k of ['0,0', '1,1', '2,1']) z.ownedParcels.add(k)
  check('zincirin ORTASINDAKİ arsa satılamıyor (ada arsa oluşmaz)', z.sellParcel(1, 1) === null)
  check('zincirin UCUNDAKİ arsa satılabiliyor', !!z.sellParcel(2, 1))

  // Kayıt round-trip: satış kalıcı
  const d = new GameState()
  hydrateState(d, JSON.parse(JSON.stringify(serializeState(s))))
  check('satış sayfa yenilemesinden sonra da duruyor', !d.ownedParcels.has('0,0'))
}

// ─────────────────────────────────────────────────────────────────────────────
console.log('\n== #1200 · SUNUCU SENKRONU: arsa satışı servet SIÇRATMIYOR ==')
{
  const src = fs.readFileSync(new URL('../../server/index.js', import.meta.url), 'utf8')
  const block = src.slice(src.indexOf('const clamp = '), src.indexOf('function sanitizeSave'))
  const { buildingValue } = new Function(block + '; return { buildingValue }')()
  const varlik = st => (Number(serializeState(st).money) || 0) + buildingValue(serializeState(st))

  // en pahalı parsel (kolon 2/5 = ₺14.000 taban) + beton — en kötü durum
  const s = new GameState()
  s.money = 500_000
  for (const k of ['1,1', '2,1']) { s.ownedParcels.add(k); s.pavedParcels.add(k) }
  const w0 = varlik(s)
  s.sellParcel(2, 1)
  const w1 = varlik(s)
  check(`satış sonrası sunucu servetindeki değişim ₺${tl(w1 - w0)} (artış YOK)`, w1 <= w0,
    'iade sunucunun parsel değerinden büyük — meşru oyuncu anti-cheat kırpmasına takılır')
  check('istemci gerçekten para aldı (satış anlamlı)', s.money > 500_000 - 0)
}

// ─────────────────────────────────────────────────────────────────────────────
console.log('\n== #723 · İPTAL/UYGULANAMAYAN SATIN ALMA: para kasadan ÇIKMIYOR ==')
{
  // Reaktör enkazı varken reaktör satın alınamaz. Eski akış parayı ÖNCE düşüyordu.
  const s = new GameState()
  s.money = 500_000
  s.gridLevel = 2
  s.smrWreck = true
  const once = s.money
  const ok = buyItem(s, 'smr')
  check('enkaz varken reaktör satın alınamıyor', ok === false)
  check(`reddedilen satın almada kasa AYNEN duruyor (₺${tl(s.money)})`, s.money === once,
    `₺${tl(once - s.money)} buharlaştı`)
  check('reaktör de kurulmadı (hem para hem tesis gitmedi)', s.hasSMR === false)

  // FAIL-CLOSED ASIL KANITI: 'land' ve 'pave' katalogda `status:'buy'` satırlarıdır ama
  // buyItem'ın switch'inde KARŞILIĞI YOKTUR (parsel yolu ayrı çalışır). Eski akış parayı
  // en başta düşüp `default: return false` ile dönüyordu → kasa boşalır, hiçbir şey olmaz.
  for (const id of ['land', 'pave', 'boyle-bir-sey-yok']) {
    const b = new GameState()
    b.money = 500_000
    b.ownedParcels.add(parcelKey(0, 0)) // 'pave' satırının kilidi açılsın
    const p0 = b.money
    const ok = buyItem(b, id)
    check(`'${id}' satın alınamıyor`, ok === false)
    check(`'${id}' reddedildi → kasa AYNEN duruyor (₺${tl(b.money)})`, b.money === p0,
      `₺${tl(p0 - b.money)} buharlaştı: para düştü, karşılığında hiçbir şey gelmedi`)
  }

  // Karşıtı: geçerli satın alma parayı DÜŞÜYOR ve tesisi KURUYOR (fail-closed abartılmadı)
  const g = new GameState()
  g.money = 500_000
  const g0 = g.money
  check('geçerli satın alma başarılı', buyItem(g, 'market') === true)
  check(`geçerli satın almada para düştü (-₺${tl(g0 - g.money)})`, g.money < g0)
  check('tesis kuruldu', g.marketLevel === 1)
}

// ─────────────────────────────────────────────────────────────────────────────
console.log('\n== #812 · SATIN ALINAN ÜNİTE GERÇEKTEN KURULUYOR + geri satılabiliyor ==')
{
  // Karşı yakası betonlu oyuncu: karşı yaka tesisleri + sayılabilir üniteler
  const s = new GameState()
  s.money = 3_000_000
  s.ownedParcels = new Set(['0,1', '0,0', '3,0', '3,1'])
  s.pavedParcels = new Set(['0,1', '0,0', '3,0', '3,1'])
  s.marketLevel = 1; s.toiletLevel = 1
  s.hasWash = true; s.hasOil = true; s.hasCoffee = true; s.hasRestaurant = true; s.hasTruckPark = true
  s.gridLevel = 1; s.batteryLevel = 1

  // her satın alma: para düşer VE sayaç/bayrak artar (hiçbiri sessizce yutulmaz)
  const KALEMLER = [
    ['selfwash', () => s.selfWashCount],
    ['selfwash', () => s.selfWashCount],
    ['airwater', () => s.airWaterCount],
    ['parking', () => s.parkingCount],
    ['market2', () => s.market2Level],
    ['toilet2', () => s.toilet2Level],
    ['wash2', () => (s.hasWash2 ? 1 : 0)],
    ['truckpark2', () => (s.hasTruckPark2 ? 1 : 0)],
    ['evcharger', () => s.evChargers],
    ['pump', () => s.pumps],
  ]
  for (const [id, oku] of KALEMLER) {
    const p0 = s.money, n0 = oku()
    const ok = buyItem(s, id)
    check(`${id}: para gitti (-₺${tl(p0 - s.money)}) → ünite GELDİ (${n0} → ${oku()})`,
      ok && s.money < p0 && oku() === n0 + 1,
      ok ? 'sayaç artmadı: para gitti ünite gelmedi' : 'satın alma reddedildi')
  }

  // Geri satış: pompa/şarj sahne id BİÇİMİYLE ('pump-3' / 'charger-0') satılabilmeli.
  // (Bina kartı bu biçimi gönderiyor; eski sellInfo yalnız 'pump#3' tanıyordu ve
  //  "Yık — iade" düğmesi pompa/şarjda HİÇ görünmüyordu.)
  check(`sahne biçimi 'pump-${s.pumps - 1}' satılabilir görünüyor`, !!sellInfo(s, `pump-${s.pumps - 1}`))
  check(`teminat biçimi 'pump#${s.pumps - 1}' de satılabilir görünüyor`, !!sellInfo(s, `pump#${s.pumps - 1}`))
  check(`sahne biçimi 'charger-${s.evChargers - 1}' satılabilir görünüyor`, !!sellInfo(s, `charger-${s.evChargers - 1}`))
  check('unitIndex iki biçimi de çözüyor', unitIndex('charger-2', 'charger') === 2 && unitIndex('charger#2', 'charger') === 2)
  check('unitIndex yanlış eşleşme yapmıyor', unitIndex('truckpark2', 'pump') === null && unitIndex('selfwash#1', 'charger') === null)

  const p1 = s.money, n1 = s.evChargers
  const iade = applySell(s, `charger-${s.evChargers - 1}`)
  check(`şarj ünitesi yıkıldı → İADE geldi (+₺${tl(s.money - p1)})`,
    iade !== null && s.money > p1 && s.evChargers === n1 - 1)

  // karşı yaka tesisi de yıkılınca iade veriyor (hem para hem tesis gitmez)
  const p2 = s.money
  const iade2 = applySell(s, 'wash2')
  check(`karşı oto yıkama yıkıldı → iade +₺${tl(s.money - p2)}`,
    iade2 !== null && s.money - p2 === iade2 && s.hasWash2 === false)
}

// ─────────────────────────────────────────────────────────────────────────────
console.log('\n== #740 · ŞARJDAKİ MÜŞTERİ: teslim edilen kWh HER HÂLÜKÂRDA faturalanıyor ==')
{
  const s = new GameState()
  s.money = 10_000
  s.elecPrice = 8
  const p0 = s.money
  const paid = s.settleCharge(42.5, false)
  check(`42.5 kWh tahsil edildi: +₺${tl(paid)}`, paid === Math.round(42.5 * 8))
  check('para kasaya girdi', s.money - p0 === paid)
  check('ciro istatistiğine yazıldı', s.stats.revenue === paid && Math.abs(s.stats.kwh - 42.5) < 1e-9)
  check('günlük ciro (görev sayacı) da arttı', s.dailyRevenue === paid)

  // karşı yaka ayrımı (#317) da tek kapıdan geçiyor
  const f = new GameState()
  f.elecPrice = 8
  f.settleCharge(10, true)
  check('karşı yaka geliri yaka sayacına yazılıyor', f.sideDaily.far > 0 && f.sideDaily.near === 0)

  // 0 kWh teslim edilmişse para YOK (uğurlama bedava para basmasın)
  const z = new GameState()
  const z0 = z.money
  check('0 kWh teslimde tahsilat yok', z.settleCharge(0) === 0 && z.money === z0)

  // main.ts'teki uğurlama yolu gerçekten bu kapıdan geçiyor mu (statik kilit)
  const main = fs.readFileSync(new URL('../../src/main.ts', import.meta.url), 'utf8')
  const blok = main.slice(main.indexOf('ui.onDismiss = car =>'), main.indexOf('ui.onCleanWindows'))
  check('ui.onDismiss teslim edilen kWh için settleCharge çağırıyor',
    /settleCharge\(/.test(blok), 'uğurlama yolu hâlâ parasız — #740 geri geldi')
  check('tamamlanan şarj da aynı kapıdan geçiyor (tek doğru kaynak)',
    /const revenue = state\.settleCharge\(c\.demandKwh/.test(main))
}

// ─────────────────────────────────────────────────────────────────────────────
console.log('\n== #615 · YETERLİ YAKITLA İHALE BAŞARILI SAYILIYOR ==')
{
  const ihale = () => ({
    id: 'kargo-1', name: 'Kargo Filosu', fuel: 'dizel', daysTotal: 7, daysLeft: 7,
    dailyLiters: 900, pricePerL: 9, bonus: 6800, penalty: 8100, deliveredToday: 0, missedDays: 0,
  })

  // (a) KISMİ STOK: eksik 900 L, tankta 880 L → eskiden HİÇ teslim edilmiyordu
  {
    const s = new GameState()
    s.money = 100_000; s.tankLevel = 3
    s.tanks.dizel = 880
    s.contract = ihale()
    const p0 = s.money
    const r = s.processContractDay()
    check(`tankta 880 L varken 900 L taahhüt → ${r.kind} (ceza yok)`, r.kind === 'ok',
      `sonuç ${r.kind}; kasa ${tl(s.money - p0)}`)
    check(`ödeme yapıldı: +₺${tl(s.money - p0)}`, s.money > p0)
    check('yakıt gerçekten depodan çekildi', s.tanks.dizel < 880)
  }

  // (b) ŞUBE KÖRLÜĞÜ: dizel BAŞKA şubede — sözleşme ŞİRKET kalemi
  {
    const s = new GameState()
    s.money = 100_000; s.tankLevel = 3
    s.unlockedLocs = ['kasaba', 'otoyol']
    s.activeLoc = 'otoyol'
    s.tanks.dizel = 0                              // otoyol tankı kuru
    s.locSnapshots['kasaba'] = { f: {}, tanks: { benzin: 0, dizel: 5000, lpg: 0 } }
    check('şirket geneli dizel görülüyor', s.companyFuel('dizel') === 5000)
    s.contract = ihale()
    const p0 = s.money
    const r = s.processContractDay()
    check(`kasabada 5.000 L dizel varken otoyolda gün kapanışı → ${r.kind}`, r.kind === 'ok',
      'şube körlüğü geri geldi: "yeterli dizel varken ceza"')
    check(`ceza kesilmedi, ödeme geldi (+₺${tl(s.money - p0)})`, s.money > p0)
    check('yakıt kardeş şubeden çekildi', s.locSnapshots['kasaba'].tanks.dizel === 5000 - 900)
  }

  // (c) KARŞITI: yakıt GERÇEKTEN yoksa ceza kesilmeye devam ediyor (denge korunur)
  {
    const s = new GameState()
    s.money = 100_000; s.tankLevel = 3
    s.tanks.dizel = 0
    s.contract = ihale()
    const p0 = s.money
    const r = s.processContractDay()
    check(`stok sıfırken hâlâ eksik teslim sayılıyor → ${r.kind}`, r.kind === 'miss')
    check(`ceza kasadan çıktı (-₺${tl(p0 - s.money)})`, s.money < p0)
    check('ceza gider defterine YAZILDI (görünmez gider kalmadı)',
      s.dayCosts.some(c => c.amount === 8100), JSON.stringify(s.dayCosts))
  }
}

// ─────────────────────────────────────────────────────────────────────────────
console.log('\n== #1239 · Sv.3 MÜDÜR REAKTÖRE BAKIM YAPIYOR ==')
{
  const kur = (opts = {}) => {
    const s = new GameState()
    s.managerLevel = 3
    s.hasSMR = true
    s.smrWear = 0.9
    s.uranium = 100
    s.money = 50_000
    Object.assign(s, opts)
    return s
  }
  const tur = s => { for (let i = 0; i < 30; i++) s.tick(1) } // Sv.3 turu 22 sn

  // (a) düz durum
  {
    const s = kur()
    tur(s)
    check(`bakım yapıldı: yıpranma %90 → %${Math.round(s.smrWear * 100)}`, s.smrWear < 0.5)
  }
  // (b) oyuncu ARIZA TAMİRİNİ kapatmış — reaktör bakımı yine de yapılmalı
  //     (mağaza "Sv.3 müdür bakımı üstlenir" diye SÖZ VERİYOR; vaat ihlali olmamalı)
  {
    const s = kur()
    s.managerPolicy = { ...s.managerPolicy, fixBroken: false }
    tur(s)
    check(`arıza tamiri KAPALIYKEN de reaktör bakımı yapıldı (%${Math.round(s.smrWear * 100)})`,
      s.smrWear < 0.5, 'reaktör bakımı hâlâ fixBroken talimatına bağlı — #1239 geri geldi')
  }
  // (c) BÜTÇE SIRASI: kasa kıtken felaket riskli kalem pompadan ÖNCE gelmeli
  {
    const s = kur({ money: 2_000, pumps: 4 })
    s.brokenPumps = new Set([1, 2])
    tur(s)
    check(`kıt kasada (₺2.000) önce REAKTÖR bakıldı (%${Math.round(s.smrWear * 100)})`,
      s.smrWear < 0.5, 'pompa tamirleri kasayı yiyip reaktörü bakımsız bıraktı')
  }
  // (d) uranyum siparişi de arıza tamiri talimatından bağımsız
  {
    const s = kur({ uranium: 5 })
    s.managerPolicy = { ...s.managerPolicy, fixBroken: false }
    tur(s)
    check('arıza tamiri kapalıyken de uranyum sipariş edildi', s.uraniumPending === true)
  }
  // (e) KARŞITI: müdürsüz istasyonda bakım OLMUYOR (otomasyonun bedeli korunuyor)
  {
    const s = kur({ managerLevel: 0 })
    tur(s)
    check('müdürsüz istasyonda reaktör bakımsız kalıyor (denge korunuyor)', s.smrWear >= 0.9)
  }
  // (f) Sv.3 patlamazlık garantisi hâlâ ayakta
  {
    const s = kur({ money: 0 })       // parası yok → bakım yapamaz
    for (let i = 0; i < 400; i++) s.tick(1)
    check('Sv.3 müdür varken reaktör PATLAMIYOR (garanti)', s.exploded === false)
    check('bakım yapılamadıysa oyuncu UYARILIYOR (sessiz kalmıyor)',
      s.events.some(e => /reakt/i.test(e)), s.events.slice(-4).join(' | '))
  }
}

// ─────────────────────────────────────────────────────────────────────────────
console.log('\n== KASADAN PARA ERİMESİ · gün gideri dökümü = GERÇEK kesinti ==')
{
  const s = new GameState()
  s.money = 300_000
  s.dayCosts = []
  const p0 = s.money

  // gün dönüşünün gerçek gider kalemleri, gerçek fonksiyonlarla
  s.autoPumps = new Set([0, 1]); s.autoChargers = new Set([0])
  s.managerLevel = 2; s.hasCleaner = true
  s.spend('Yovmiye', s.dailyWages())
  s.pumps = 6; s.marketLevel = 3; s.day = 40; s.opexStart = 0
  s.spend('İşletme gideri', s.dailyOpex())
  s.spend('İşletme ruhsatı', s.licenseFee())
  s.marketingBudget = 3_000
  s.spend('Reklam kampanyası', 3_000)
  s.takeLoan(50_000, [])                 // kredi kasaya para EKLER (gider değil)
  const kasaKrediSonrasi = s.money
  s.processLoanDay()                     // taksit → gider defterine yazılmalı
  s.partner = { active: true, remaining: 40_000, share: 0.25 }
  s.applyPartnerCut(20_000)              // banka kâr payı → gider

  const dusus = kasaKrediSonrasi - s.money + (p0 - (kasaKrediSonrasi - 50_000))
  // daha basit ve kesin ölçü: defter toplamı == (başlangıç + kredi anaparası) - kasa
  const gercek = (p0 + 50_000) - s.money
  check(`gider dökümü toplamı ₺${tl(s.dayCostTotal())} = gerçek kesinti ₺${tl(gercek)}`,
    Math.abs(s.dayCostTotal() - gercek) <= 1,
    `fark ₺${tl(gercek - s.dayCostTotal())} — GÖRÜNMEZ gider var (dusus=${tl(dusus)})`)
  check(`döküm en az 6 kalem gösteriyor (${s.dayCosts.map(c => c.kind).join(', ')})`, s.dayCosts.length >= 6)
  check('kredi taksiti dökümde', s.dayCosts.some(c => /kredi/i.test(c.kind)))
  check('banka ortağı payı dökümde', s.dayCosts.some(c => /orta[kğ]/i.test(c.kind)))
  check('ruhsat dökümde', s.dayCosts.some(c => /ruhsat/i.test(c.kind)))

  // kasa asla eksiye inmiyor (negatif kasa sipariş bütçe-fit'ini bozuyordu)
  const k = new GameState()
  k.money = 100
  const odenen = k.spend('Yovmiye', 5_000)
  check(`kasa yetmezse yalnız kasadaki kadar ödeniyor (₺${tl(odenen)}) ve eksiye inmiyor`,
    k.money === 0 && odenen === 100)

  // SAVE UYUMU: döküm ADDITIVE alan — kayıttan geri gelir, bozuk veri paneli çökertmez
  const d = new GameState()
  hydrateState(d, JSON.parse(JSON.stringify(serializeState(s))))
  check('gider dökümü sayfa yenilemesinden sonra da duruyor',
    d.dayCosts.length === s.dayCosts.length && d.dayCostTotal() === s.dayCostTotal())
  const eski = new GameState()
  hydrateState(eski, { money: 50_000, day: 12, pumps: 3 })   // alanı OLMAYAN eski kayıt
  check('alanı olmayan ESKİ kayıt çökmüyor, boş dökümle açılıyor',
    Array.isArray(eski.dayCosts) && eski.dayCosts.length === 0)
  const bozuk = new GameState()
  hydrateState(bozuk, { dayCosts: [{ kind: 5, amount: 'x' }, null, { kind: 'a', amount: -9 }, { kind: 'b', amount: 12 }] })
  check('kurcalanmış döküm süzülüyor (yalnız geçerli kalem kalır)',
    bozuk.dayCosts.length === 1 && bozuk.dayCosts[0].amount === 12, JSON.stringify(bozuk.dayCosts))

  // main.ts gün dönüşü GERÇEKTEN spend()'den geçiyor mu (statik kilit)
  const main = fs.readFileSync(new URL('../../src/main.ts', import.meta.url), 'utf8')
  const bas = main.indexOf('// gün dönümü: günlük kâr raporu')
  const son = main.indexOf('prevCycleT = cycleT', bas)
  const gun = main.slice(bas, son)
  check('gün dönüşünde ham `state.money -=` kalmadı (her gider deftere yazılıyor)',
    !/state\.money\s*(-=|=\s*Math\.max\(0,\s*state\.money\s*-)/.test(gun),
    gun.split('\n').filter(l => /state\.money\s*(-=|=\s*Math\.max\(0,\s*state\.money\s*-)/.test(l)).join(' // '))
  check('gün raporu gider dökümünü gösteriyor', /dayCostTotal\(\)/.test(gun))
  check('raporlanan kâr GERÇEK kasa değişimi (net) — uydurma sayı yok',
    /const net = Math\.round\(state\.money - state\.dayStartMoney\)/.test(gun))
}

console.log(`\nSONUÇ: ${pass} geçti, ${fail} kaldı`)
process.exit(fail ? 1 : 0)
