/**
 * GELİR HESABI & İTİBAR TESTİ — canlı oyuncu kayıtlarının ölçülebilir karşılıkları.
 *
 * A) ÇOKLU ÜNİTE TEK GELİR (#624 #661 #939 #1005 #1152)
 *    Ham gelir zaten adetle çarpılıyordu (25 Tem düzeltmesi), AMA kumbara TAVANI
 *    5/6 ünitede duruyordu. KIRMIZI-ÖNCE ÖLÇÜM (5 dk'da bir toplayan oyuncu):
 *      8 ünite → ünite başına ×0.79 · 12 ünite → ×0.66
 *    Yani 12. ünite tek ünitenin ancak 2/3'ünü kazandırıyordu. Tavan gelirle aynı
 *    doğrusal ölçeğe alındı; bu test o oranı kilitliyor.
 *
 * B) İTİBAR 5.0'DA DONUK (#67 #195 #250 #456 #578 #1025 #1111 #1115)
 *    İKİ ayrı kök neden ölçüldü:
 *      1) repMark (gün penceresi) KAYDA GİRMİYORDU → her yenilemeden sonra "bugün"
 *         ömür boyu toplamı sanılıyor, hedef 5.0'a çakılıyordu.
 *         KIRMIZI-ÖNCE: 2000 servis/40 kayıp geçmişi olan oyuncuda, 10 servis/10 kayıplık
 *         berbat bir gün repToday() = {2010, 50} okunuyor, hedef 4.83 (olması gereken 1.5),
 *         itibar 0.043 düşüyordu (olması gereken 0.30).
 *      2) Gün içi akış mutabakatı EZİYORDU: servis başına ~+0.10 vs günde en çok ±0.30.
 *         KIRMIZI-ÖNCE: %20 kayıplı günün -0.30 cezası, ertesi gün 4 müşteri servis
 *         edilince siliniyordu (5.000 → 4.700 → 5.000).
 *
 * C) KÂR MATEMATİĞİ (#1247 #1251 #570 #1204)
 *    Gün sonu raporu (main.ts:6311) gün KAPANIŞ bloğundan ÖNCE okunuyor, ama baz
 *    (dayStartMoney, main.ts:6494) bloktan SONRA yazılıyor. Aradaki yovmiye/OPEX/ruhsat/
 *    reklam/kredi/şube hareketleri HİÇBİR günün kârına girmiyor.
 *    KIRMIZI-ÖNCE ÖLÇÜM (10 gün): rapor ₺120.000 · gerçek kasa ₺99.140 · FARK ₺20.860 (%17).
 *    Bu testin C bölümü hem farkı hem DOĞRU sıralamanın tam eşitliğini ölçer.
 *
 * Çalıştır: npm run test:gelir
 */
globalThis.localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} }
Object.defineProperty(globalThis, 'navigator', { value: { language: 'tr' }, configurable: true })
import { readFileSync } from 'node:fs'
const { GameState, serializeState, hydrateState, SAYAC_KUMBARA_MAX, REP_OLAY_ESIK } =
  await import('../../src/state.ts')

let pass = 0, fail = 0
const check = (ad, ok, ek = '') => {
  if (ok) { pass++; console.log(`  ✓ ${ad}${ek ? ' ' + ek : ''}`) }
  else { fail++; console.log(`  ✗ ${ad}${ek ? ' ' + ek : ''}`) }
}
const yakin = (a, b, tol) => Math.abs(a - b) <= tol
/** deterministik tur: Math.random sabitlenir (ünite başı 30+15 = ₺45) */
const sabit = fn => { const r = Math.random; Math.random = () => 0.5; try { return fn() } finally { Math.random = r } }

// ══════════════════════════ A) SAYAÇLI YAPILARIN ÖLÇEĞİ ══════════════════════════
console.log('\n== A) SAYAÇLI YAPILAR: ne ölçeklenmeli, ne ölçeklenmemeli ==')

// A1 — HAM hasılat (kumbara tavanından bağımsız) tam doğrusal olmalı
const hamSelfwash = n => sabit(() => {
  const s = new GameState(); s.selfWashCount = n
  for (let i = 0; i < 3600; i++) s.tick(1)
  return s.facTotal['selfwash'] ?? 0
})
const h1 = hamSelfwash(1)
check(`self yıkama ×1 ham hasılat üretiyor (₺${h1})`, h1 > 0)
for (const n of [2, 3, 5, 8, 12]) {
  const hn = hamSelfwash(n)
  check(`self yıkama ×${n} ham hasılat tam ${n} katı (₺${hn})`, yakin(hn / h1, n, 0.01))
}

// A2 — ASIL ÖLÇÜT: KASAYA GİREN para. Kumbara tavanı gelirle aynı ölçekte büyümezse
//      fazlası %40 verimle erir ve "ünite ekledim gelir artmadı" şikâyeti doğar.
const netSelfwash = (n, aralik) => sabit(() => {
  const s = new GameState(); s.selfWashCount = n; s.money = 0
  for (let i = 0; i < 3600; i++) { s.tick(1); if (i % aralik === aralik - 1) s.collectPending('selfwash') }
  s.collectPending('selfwash')
  return Math.round(s.money)
})
for (const aralik of [60, 300, 600]) {
  const t1 = netSelfwash(1, aralik)
  for (const n of [3, 5, 8, 12]) {
    const tn = netSelfwash(n, aralik)
    const oran = tn / t1 / n
    check(`${aralik}sn'de bir toplayan oyuncu: ×${n} ünite, ünite başına ×${oran.toFixed(2)} (₺${tn})`,
      yakin(oran, 1, 0.02))
  }
}

// A3 — kumbara tavanı gelirle AYNI oranda (sınıf yorumunun kendi kuralı)
const capOf = (alan, id, n) => { const s = new GameState(); s[alan] = n; return s.pendingCap(id) }
for (const [alan, id] of [['selfWashCount', 'selfwash'], ['parkingCount', 'parking']]) {
  const c1 = capOf(alan, id, 1)
  check(`${id}: kumbara tavanı ${SAYAC_KUMBARA_MAX} üniteye kadar doğrusal (₺${c1} → ₺${capOf(alan, id, SAYAC_KUMBARA_MAX)})`,
    capOf(alan, id, SAYAC_KUMBARA_MAX) === c1 * SAYAC_KUMBARA_MAX)
  check(`${id}: tavan suistimal freniyle sınırlı (${SAYAC_KUMBARA_MAX} üstü büyümüyor)`,
    capOf(alan, id, SAYAC_KUMBARA_MAX + 40) === capOf(alan, id, SAYAC_KUMBARA_MAX))
}

// A3b — HAVA-SU TEKİL KUMBARA (2 Eyl): anahtar ünite başına ('airwater#k'), tavan ünite
//       başına SABİT; toplam kapasite (pendingCapTotal) adetle doğrusal, 12 freni yok.
{
  const s = new GameState(); s.airWaterCount = 5
  check(`hava-su: ünite tavanı sabit (₺${s.pendingCap('airwater')} = ₺${s.pendingCap('airwater#4')})`,
    s.pendingCap('airwater') === s.pendingCap('airwater#4'))
  check('hava-su: ünite anahtarları adet kadar', s.airWaterUnitIds().join() === 'airwater,airwater#1,airwater#2,airwater#3,airwater#4')
  const tek = new GameState(); tek.airWaterCount = 1
  const on3 = new GameState(); on3.airWaterCount = 13
  check(`hava-su: toplam kapasite adetle doğrusal, 13 ünitede de (₺${on3.pendingCapTotal()} = 13 × ₺${tek.pendingCapTotal()})`,
    on3.pendingCapTotal() === 13 * tek.pendingCapTotal())
  // ciro raporu TÜR bazında: ünite anahtarına yazılan para facTotal['airwater']'da toplanır
  s.addPending('airwater#3', 15, 'Hava-su'); s.addPending('airwater', 15, 'Hava-su')
  check('hava-su: ünite kumbaraları ayrı, ciro raporu tek kalemde',
    s.pendingCash['airwater#3'] === 15 && s.pendingCash['airwater'] === 15 && s.facTotal['airwater'] === 30 && !s.facTotal['airwater#3'])
}

// A4 — SUNUCU SENKRONU: istemci sert tavanı (cap×3) sunucu clamp'ini aşmamalı
const srvSrc = readFileSync(new URL('../../server/index.js', import.meta.url), 'utf8')
const srvClamp = Number((srvSrc.match(/PENDING_HARD_CAP\s*=\s*([\d_]+)/) || [])[1]?.replace(/_/g, '') || 0)
check('sunucu PENDING_HARD_CAP sabiti okunabildi', srvClamp > 0, `=${srvClamp}`)
{
  const s = new GameState()
  s.marketLevel = 3; s.market2Level = 3; s.toiletLevel = 2; s.toilet2Level = 2
  s.selfWashCount = 99; s.airWaterCount = 99; s.parkingCount = 99
  const ids = ['market', 'market2', 'toilet', 'toilet2', 'selfwash', 'airwater', 'parking',
    'truckpark', 'truckpark2', 'hotel', 'restaurant', 'restaurant2', 'oil', 'oil2', 'wash', 'wash2', 'coffee', 'coffee2']
  const enBuyuk = Math.max(...ids.map(id => s.pendingCap(id) * 3))
  check(`istemci sert tavanı (₺${enBuyuk}) sunucu clamp'ini (₺${srvClamp}) AŞMIYOR`, enBuyuk <= srvClamp)
}

// A5 — güneş: ÜRETİM adetle doğrusal olmalı (kWh/sn)
{
  const rate = n => { const s = new GameState(); s.solarCount = n; return s.freeRate() }
  const r1 = rate(1)
  check(`güneş ×1 üretim ${r1} kWh/sn`, r1 > 0)
  check(`güneş ×3 üretim tam 3 katı (${rate(3)} kWh/sn)`, yakin(rate(3), r1 * 3, 1e-9))
  // …ama EKONOMİK değeri tüketimle sınırlıdır (fatura sıfırlanınca fazla panel kâr etmez).
  // Bu bir hata DEĞİL, fizik: ölçüldü → 1 saatlik fatura 0 panel ₺-25.200, 1 panel ₺-8.175,
  // 2 panel ₺-1.153, 3 panel ₺0. Testte kilitlenen şey: üretimin doğrusallığı.
  const fatura = n => sabit(() => {
    const s = new GameState(); s.solarCount = n; s.gridLevel = 1; s.batteryLevel = 1; s.money = 0
    for (let i = 0; i < 3600; i++) { s.battery = 0; s.tick(1) }
    return Math.round(s.money)
  })
  check(`her güneş paneli şebeke faturasını DÜŞÜRÜYOR (₺${fatura(0)} → ₺${fatura(1)} → ₺${fatura(2)})`,
    fatura(1) > fatura(0) && fatura(2) > fatura(1))
}

// A6 — pasif şube geliri de sayaçla doğrusal
{
  const gross = (alan, n) => {
    const s = new GameState(); s.unlockedLocs = ['kasaba', 'cevreyolu']; s.activeLoc = 'kasaba'
    s.locSnapshots['cevreyolu'] = { f: { managerLevel: 3, pumps: 2, [alan]: n }, autoPumps: [], autoChargers: [] }
    return s.branchNetPerDay('cevreyolu').gross
  }
  for (const alan of ['selfWashCount', 'airWaterCount', 'parkingCount']) {
    const b0 = gross(alan, 0), b1 = gross(alan, 1), b3 = gross(alan, 3)
    check(`şube geliri ${alan} ile doğrusal (₺${b0} → ₺${b1} → ₺${b3})`, yakin(b3 - b0, (b1 - b0) * 3, 2))
  }
}

// A7 — TASARIM KARARI: ÇEKİCİLİK ünite sayısıyla doğrusal ARTMAMALI.
// 3 self yıkama 3 kat GELİR üretir (A1/A2) ama istasyonu 3 kat çekici YAPMAZ —
// yoldan geçen sürücü için "yıkama var mı" ikili bir sorudur. Kasıtlı 3 ünite tavanı;
// bu test onu KİLİTLER ki körlemesine doğrusallaştırılmasın.
{
  const ent = (alan, n) => { const s = new GameState(); s[alan] = n; return s.entryChance() }
  for (const alan of ['selfWashCount', 'airWaterCount']) {
    check(`${alan}: 1→3 ünite çekiciliği artırıyor`, ent(alan, 3) > ent(alan, 1))
    check(`${alan}: 3 ünite üstü çekicilik ARTMIYOR (kasıtlı azalan verim)`,
      yakin(ent(alan, 8), ent(alan, 3), 1e-9))
  }
  // Otopark çekicilik vermez (kapasite yapısıdır: ünite başına 4 park yeri, world.ts)
  check('otopark çekiciliğe etki ETMEZ (kapasite yapısı — tasarım)', yakin(ent('parkingCount', 6), ent('parkingCount', 0), 1e-9))
  // Lamba itibarı dekoratif doygunluğa uğrar (0.30 tavan ≈ 7.5 lamba)
  const dec = n => { const s = new GameState(); s.lampCount = n; return s.decorRep() }
  check(`lamba itibar katkısı doyuyor (×8 ${dec(8).toFixed(2)} = ×20 ${dec(20).toFixed(2)})`, yakin(dec(8), dec(20), 1e-9))
}

// ══════════════════════════ B) İTİBAR ══════════════════════════
console.log('\n== B) İTİBAR: hem düşebilmeli hem çıkabilmeli ==')

// main.ts'teki gerçek oranlar: servis +(score-3.3)*0.08 ≈ +0.096 · kaçan müşteri -0.2
function gunOyna(s, servis, kayip) {
  const n = servis + kayip
  for (let i = 0; i < n; i++) {
    if (i % n < servis) { s.stats.served++; s.addRep(0.096) }
    else { s.stats.lost++; s.addRep(-0.2) }
  }
}

// B1 — DENGE KORUNUMU: kayıpsız oynayan oyuncu hâlâ 5.0'a çıkar (hiçbir şey değişmedi)
{
  const s = new GameState(); s.day = 10; s.reputation = 4.0
  gunOyna(s, 100, 0)
  check('kayıpsız gün itibarı hâlâ 5.00 yapıyor (mevcut denge korunuyor)', yakin(s.reputation, 5, 1e-9), `= ${s.reputation.toFixed(2)}`)
}

// B2 — DONUKLUK BİTTİ: müşteri kaybeden oyuncu 5.0'da kalamaz, günün hedefine oturur
for (const [oran, hedef] of [[0.03, 4.79], [0.10, 4.30], [0.20, 3.60]]) {
  const s = new GameState(); s.day = 10; s.reputation = 5
  const kayip = Math.round(100 * oran)
  for (let g = 0; g < 5; g++) { gunOyna(s, 100 - kayip, kayip); s.reconcileReputation() }
  check(`%${Math.round(oran * 100)} kayıp → itibar 5.0'da DONMUYOR, hedefe oturuyor (${s.reputation.toFixed(2)} ≈ ${hedef})`,
    yakin(s.reputation, hedef, 0.05))
}

// B3 — CEZA KALICI: kötü günün ardından birkaç müşteri servis etmek cezayı SİLMEZ
{
  const s = new GameState(); s.day = 10; s.reputation = 5
  gunOyna(s, 80, 20); s.reconcileReputation()
  const sonra = s.reputation
  check(`kötü gün itibarı gerçekten düşürdü (5.00 → ${sonra.toFixed(2)})`, sonra < 4.2)
  gunOyna(s, 4, 0)
  check('4 müşteri servis etmek cezayı SİLMİYOR (eski hata: 5.00\'a geri fırlıyordu)', s.reputation < 4.2, `= ${s.reputation.toFixed(2)}`)
}

// B4 — GERİ ÇIKABİLİYOR: düzelen hizmet itibarı yükseltir (mekanik tek yönlü değil)
{
  const s = new GameState(); s.day = 10; s.reputation = 5
  gunOyna(s, 80, 20); s.reconcileReputation()
  const dip = s.reputation
  for (let g = 0; g < 4; g++) { gunOyna(s, 100, 0); s.reconcileReputation() }
  check(`hizmet düzelince itibar geri çıkıyor (${dip.toFixed(2)} → ${s.reputation.toFixed(2)})`, s.reputation > dip + 0.5)
}

// B5 — AYRIK OLAY CEZASI hâlâ tam ısırıyor (çapa yalnız müşteri akışını sınırlar)
{
  const s = new GameState(); s.day = 10; s.reputation = 5
  gunOyna(s, 100, 0)                 // hedef 5.0, itibar 5.0
  const once = s.reputation
  s.addRep(-1)                       // reaktör patlaması (|d| > eşik → çapayı deler)
  check(`reaktör patlaması (-1) tam ısırıyor (${once.toFixed(2)} → ${s.reputation.toFixed(2)})`, yakin(s.reputation, 4, 1e-9))
  check('olay eşiği akış deltalarının (≤0.2) üstünde', REP_OLAY_ESIK >= 0.2)
}

// B6 — KAYIT: gün penceresi (repMark) kayda giriyor mu?
{
  const h = new GameState(); h.reputation = 5; h.day = 10
  h.stats.served = 2000; h.stats.lost = 40
  h.reconcileReputation()
  const data = JSON.parse(JSON.stringify(serializeState(h)))
  check('repMark serialize ediliyor', !!data.repMark && data.repMark.served === 2000)

  const yeni = new GameState(); hydrateState(yeni, data)
  yeni.stats.served += 10; yeni.stats.lost += 10
  const r1 = yeni.repToday()
  check(`yükleme sonrası "bugün" penceresi doğru (${r1.served} servis / ${r1.lost} kayıp)`, r1.served === 10 && r1.lost === 10)
  check(`hedef günün kalitesini yansıtıyor (${r1.target.toFixed(2)}, ömür boyu orandan gelen 4.83 DEĞİL)`, r1.target < 2)

  // ESKİ KAYIT (repMark alanı yok) — ADDITIVE geriye uyum: pencere yüklenen sayaçlara kurulur
  const eski = { ...data }; delete eski.repMark
  const y = new GameState(); hydrateState(y, eski)
  y.stats.served += 10; y.stats.lost += 10
  const r2 = y.repToday()
  check(`eski kayıt (repMark yok) da doğru pencere kuruyor (${r2.served}/${r2.lost})`, r2.served === 10 && r2.lost === 10)

  // kurcalanmış repMark negatif pencere üretmemeli
  const bozuk = { ...data, repMark: { served: 9e9, lost: -5 } }
  const z = new GameState(); hydrateState(z, bozuk)
  const r3 = z.repToday()
  check(`kurcalanmış repMark güvenli kırpılıyor (${r3.served}/${r3.lost})`, r3.served >= 0 && r3.lost >= 0)
}

// ══════════════════════════ C) GÜN SONU KÂR MUHASEBESİ ══════════════════════════
console.log('\n== C) KÂR: rapor ile kasadaki gerçek değişim ==')

/** main.ts:6300-6494 gün dönüşü sırasının birebir kopyası.
 *  bazErken=true → dayStartMoney kâr okunduktan HEMEN SONRA yazılır (ÖNERİLEN DÜZELTME). */
function gunDonusu(st, bazErken) {
  const kar = Math.round(st.money - st.dayStartMoney)   // main.ts:6311
  if (bazErken) st.dayStartMoney = st.money             // ÖNERİLEN: main.ts:6494 buraya taşınır
  const kasaOnce = st.money
  const wages = st.dailyWages(); if (wages > 0) st.money -= wages       // 6330
  st.processContractDay()                                               // 6333
  if (st.day >= st.licenseDueDay) {                                     // 6348
    const fee = st.licenseFee()
    if (st.money >= fee) { st.money -= fee; st.licenseDueDay = st.day + 30 }
    else { st.licenseDueDay = st.day + 3; st.addRep(-0.3) }
  }
  const opex = st.dailyOpex(); if (opex > 0) st.money = Math.max(0, st.money - opex)   // 6362
  if (st.marketingBudget > 0) st.money -= Math.min(st.marketingBudget, Math.max(0, Math.floor(st.money))) // 6368
  const vault = st.accrueBranchVaults().reduce((a, v) => a + v.added, 0) // 6428
  st.reconcileReputation()                                              // 6443
  st.processLoanDay()                                                   // 6451
  st.applyPartnerCut(kar)                                               // 6482
  if (!bazErken) st.dayStartMoney = st.money                            // MEVCUT: main.ts:6494
  return { kar, kapanisNet: Math.round(st.money - kasaOnce), wages, opex, vault }
}

const kurulum = () => {
  const s = new GameState()
  s.day = 20; s.opexStart = 1; s.licenseDueDay = 999999
  s.pumps = 4; s.evChargers = 2; s.marketLevel = 2
  s.hasWash = true; s.hasOil = true; s.hasRestaurant = true; s.hasTruckPark = true; s.hasHotel = true
  s.selfWashCount = 3; s.airWaterCount = 3
  s.autoPumps = new Set([0, 1]); s.autoChargers = new Set([0])
  s.money = 200_000; s.dayStartMoney = 200_000
  return s
}

// C1 — KUMBARA: toplanmamış gelir kâra SAYILMAMALI (kasaya girmediği için)
{
  const s = kurulum()
  const once = s.money
  s.addPending('selfwash', 900, 'sw'); s.addPending('hotel', 1500, 'otel')
  check('toplanmamış kumbara kasayı DEĞİŞTİRMİYOR (kâra sayılmıyor — doğru)', s.money === once)
  const alinan = s.collectPending('selfwash') + s.collectPending('hotel')
  check(`toplanınca kasaya giriyor (+₺${alinan})`, s.money === once + alinan && alinan > 0)
}

// C2 — MEVCUT SIRALAMA: gün kapanış bloğu hiçbir güne yazılmıyor
{
  const s = kurulum()
  s.money += 12_000                       // gün içi net satış
  const r = gunDonusu(s, false)
  check(`gün kapanışı kasayı gerçekten değiştiriyor (₺${r.kapanisNet}: yovmiye -${r.wages}, OPEX -${r.opex}, şube +${r.vault})`, r.kapanisNet !== 0)
  check(`RAPOR bu tutarı GÖRMÜYOR — rapor ₺${r.kar}, kasa hareketi ₺${12_000 + r.kapanisNet}`,
    r.kar !== 12_000 + r.kapanisNet)
}

// C3 — MUTABAKAT: mevcut sıralamada fark HER GÜN birikir; önerilen sıralamada fark
// sabit kalır (yalnız henüz raporlanmamış SON günün kapanış bloğu havada durur).
{
  const kos = (gun, bazErken) => {
    const s = kurulum(); const bas = s.money
    let rapor = 0, sonKapanis = 0
    for (let g = 0; g < gun; g++) { s.money += 12_000; const r = gunDonusu(s, bazErken); rapor += r.kar; sonKapanis = r.kapanisNet; s.day++ }
    return { fark: Math.round(rapor - (s.money - bas)), rapor, kasa: Math.round(s.money - bas), sonKapanis }
  }
  const a10 = kos(10, false), a30 = kos(30, false)
  const b10 = kos(10, true), b30 = kos(30, true)
  console.log(`  … MEVCUT sıralama    10 gün: rapor ₺${a10.rapor} · kasa ₺${a10.kasa} · FARK ₺${a10.fark}   |  30 gün: FARK ₺${a30.fark}`)
  console.log(`  … ÖNERİLEN sıralama  10 gün: rapor ₺${b10.rapor} · kasa ₺${b10.kasa} · FARK ₺${b10.fark}    |  30 gün: FARK ₺${b30.fark}`)
  check(`mevcut main.ts sıralaması kâr raporunu ŞİŞİRİYOR (10 günde ₺${a10.fark}) — main.ts:6494 düzeltmesi bekliyor`, a10.fark > 0)
  check(`mevcut sıralamada hata GÜN SAYISIYLA BÜYÜYOR (₺${a10.fark} → ₺${a30.fark})`, a30.fark > a10.fark * 2.5)
  check(`ÖNERİLEN düzeltmede hata BİRİKMİYOR (10 gün ₺${b10.fark} = 30 gün ₺${b30.fark})`, b10.fark === b30.fark)
  check(`kalan fark yalnız son günün henüz raporlanmamış kapanış bloğu (₺${-b30.sonKapanis})`, b30.fark === -b30.sonKapanis)
}

console.log(`\nSONUÇ: ${pass} geçti, ${fail} kaldı`)
process.exit(fail ? 1 : 0)
