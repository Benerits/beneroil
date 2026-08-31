/**
 * OFFLINE MÜDÜR TESTİ — oyuncu bildirimi: "3. level müdür offlineken kumbaraları
 * toplamıyor — yıkama, hava su vs onları da toplar hale getirir misin, hata var burada."
 *
 * ÖLÇÜLEN KÖK NEDEN (bu dosyanın 1. bölümü sayıyla gösterir):
 *   main.ts applyAwayEarnings() offline pencereyi kumbaralara YAZIYOR (addPending) ama
 *   HİÇ TOPLAMIYOR ve müdür seviyesine hiç bakmıyordu. Müdür yalnız oyun AÇIKKEN tur
 *   atıyor (state.managerTick → collectPending). İki kayıp birden:
 *     (1) müdürlü oyuncu dönüşte kumbaraları elle boşaltıyor — müdürün tek işi buyken,
 *     (2) PARA YANIYOR: addPending tavanı aşan kısmı %40 verimle alır, sert tavan cap×3.
 *         Oto yıkama 1,4 ₺/sn × 7200 sn = ₺10.080 üretir, kumbaraya en fazla ₺2.100 girer.
 *
 * FIX: state.offlineManagerRun() müdür turlarını SADIK biçimde simüle eder (tur süresi
 * MANAGER_TOUR_SEC — managerTick ile TEK kaynak), toplama collectPending'den geçer
 * (prestij + facLost temizliği online ile aynı yol). Müdürsüz / collect:false oyuncuda
 * kod yolu BİREBİR eskisi gibi.
 *
 * ANTİ-HİLE: main.ts OFFLINE_BUDGET sayacı, bir açılışta offline yollarla kasaya yazılan
 * toplamı sunucu jeton kovasının (server/index.js ALLOW_BURST) altında tutar.
 *
 * Bu test DEV SUNUCU İSTEMEZ: ölçüm, oyunun GERÇEK src/state.ts kodunu koşturarak
 * yapılır (tarayıcı katmanı ölçülen davranışa girmiyor). Kaynak seviyesi denetimleri
 * main.ts/i18n.ts/server/index.js dosyalarını okur.
 *
 * Çalıştır:  npm run test:offlinemudur
 */
globalThis.localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} }
Object.defineProperty(globalThis, 'navigator', { value: { language: 'tr' }, configurable: true })

import { readFileSync } from 'node:fs'
const { GameState, serializeState, hydrateState, MANAGER_TOUR_SEC } =
  await import('../../src/state.ts')

let pass = 0, fail = 0
const check = (n, c, d = '') => { c ? (pass++, console.log('  ✓ ' + n)) : (fail++, console.log(`  ✗ ${n}${d ? ' — ' + d : ''}`)) }
const oku = f => readFileSync(new URL('../../' + f, import.meta.url), 'utf8')
const fmt = n => '₺' + Math.round(n).toLocaleString('tr-TR')

// ─────────────────────────────────────────────────────────────────────────────
// Ortak kurulum: main.ts applyAwayEarnings'in kumbara listesi BİREBİR
// ─────────────────────────────────────────────────────────────────────────────
function gainsOf(s) {
  const g = []
  if (s.hasTruckPark) g.push(['truckpark', 'Tır parkı', 125 / 45])
  if (s.hasTruckPark2) g.push(['truckpark2', 'Karşı tır parkı', 125 / 45])
  if (s.hasSelfWash) g.push(['selfwash', 'Self yıkama', (45 / 35) * s.selfWashCount])
  if (s.hasWash) g.push(['wash', 'Oto yıkama', 1.4])
  if (s.hasAirWater) g.push(['airwater', 'Hava-Su', 0.5 * s.airWaterCount])
  return g
}
/** FİX ÖNCESİ davranış (git 67986e7 applyAwayEarnings kumbara bloğu) — referans */
function eskiDavranis(s, offSec) {
  for (const [id, name, rate] of gainsOf(s)) s.addPending(id, Math.round(rate * offSec), name)
  return { collected: 0, tours: 0 }
}
const kumbaraToplam = s => Object.values(s.pendingCash).reduce((a, v) => a + (v || 0), 0)
/** oyuncunun eline geçen toplam ₺: müdürün kasaya yazdığı + elle toplayacağı kumbara */
const eleGecen = (s, collected) => collected + Math.round(kumbaraToplam(s) * s.prestigeMult())

const istasyon = (mgr, { collect = true, stars = 0 } = {}) => {
  const s = new GameState()
  s.pumps = 6; s.marketLevel = 2
  s.hasWash = true; s.hasOil = true; s.hasCoffee = true; s.hasRestaurant = true
  s.hasTruckPark = true; s.selfWashCount = 4; s.airWaterCount = 2
  s.managerLevel = mgr; s.managerPolicy = { ...s.managerPolicy, collect }
  s.brandStars = stars; s.day = 60; s.money = 40_000
  return s
}
const SURELER = [[600, '10 dk'], [3600, '1 saat'], [7200, '2 saat']]
const SENARYO = [
  ['müdürsüz (Sv.0)', () => istasyon(0)],
  ['müdür Sv.1', () => istasyon(1)],
  ['müdür Sv.3', () => istasyon(3)],
  ['Sv.3 · collect:false', () => istasyon(3, { collect: false })],
  ['Sv.3 · 10★ prestij', () => istasyon(3, { stars: 10 })],
]

// ══════════════════════════════ 1) ÖLÇÜM TABLOSU ══════════════════════════════
console.log('\n== 1) ÖLÇÜM: yoklukta toplam kazanç — FİX ÖNCESİ vs SONRASI ==')
console.log('   (kaynak: gerçek src/state.ts; "eriyen" = kumbara tavanı yüzünden yok olan ciro)\n')
console.log('  ' + 'senaryo'.padEnd(22) + 'süre'.padEnd(8) + 'üretilen'.padEnd(11)
  + 'ÖNCE ele geçen'.padEnd(16) + 'ÖNCE eriyen'.padEnd(13)
  + 'SONRA ele geçen'.padEnd(17) + 'SONRA eriyen')
const olcum = {}
for (const [ad, mk] of SENARYO) {
  for (const [sec, sad] of SURELER) {
    const a = mk(); eskiDavranis(a, sec)
    const b = mk(); const r = b.offlineManagerRun(gainsOf(b), sec, Infinity)
    const uretilen = gainsOf(a).reduce((t, [, , rate]) => t + Math.round(rate * sec), 0)
    const rec = {
      uretilen,
      onceEl: eleGecen(a, 0), onceEriyen: a.lostTotal(),
      sonraEl: eleGecen(b, r.collected), sonraEriyen: b.lostTotal(),
      mudurKasa: r.collected, tur: r.tours,
    }
    olcum[`${ad}|${sec}`] = rec
    console.log('  ' + ad.padEnd(22) + sad.padEnd(8) + fmt(uretilen).padEnd(11)
      + fmt(rec.onceEl).padEnd(16) + fmt(rec.onceEriyen).padEnd(13)
      + fmt(rec.sonraEl).padEnd(17) + fmt(rec.sonraEriyen)
      + (rec.mudurKasa ? `   [müdür ${rec.tur} tur → kasa ${fmt(rec.mudurKasa)}]` : ''))
  }
}

// ══════════════════════════ 2) MÜDÜRSÜZ: HİÇBİR ŞEY DEĞİŞMEDİ ══════════════════════════
console.log('\n== 2) MÜDÜRSÜZ oyuncuda davranış DEĞİŞMEDİ ==')
for (const [sec, sad] of SURELER) {
  const a = istasyon(0); eskiDavranis(a, sec)
  const b = istasyon(0); const r = b.offlineManagerRun(gainsOf(b), sec, Infinity)
  check(`Sv.0 · ${sad}: kumbaralar birebir aynı`,
    JSON.stringify(a.pendingCash) === JSON.stringify(b.pendingCash),
    `${JSON.stringify(a.pendingCash)} vs ${JSON.stringify(b.pendingCash)}`)
  check(`Sv.0 · ${sad}: kasaya TEK KURUŞ yazılmadı (elle toplanacak)`,
    r.collected === 0 && r.tours === 0 && b.money === a.money)
  check(`Sv.0 · ${sad}: taşma kaybı da aynı (denge kaymadı)`, a.lostTotal() === b.lostTotal())
}

// ═══════════════════════ 3) collect:false: OYUNCUNUN KARARINA SAYGI ═══════════════════════
console.log('\n== 3) collect:false seçen oyuncuda davranış DEĞİŞMEDİ ==')
for (const lvl of [1, 2, 3]) {
  const a = istasyon(lvl, { collect: false }); eskiDavranis(a, 7200)
  const b = istasyon(lvl, { collect: false }); const r = b.offlineManagerRun(gainsOf(b), 7200, Infinity)
  check(`Sv.${lvl} collect:false · müdür HİÇ toplamadı`, r.collected === 0 && r.tours === 0)
  check(`Sv.${lvl} collect:false · kumbaralar eski davranışla aynı`,
    JSON.stringify(a.pendingCash) === JSON.stringify(b.pendingCash))
}

// ══════════════════════ 4) MÜDÜRLÜ: TOPLADI + TAVAN KAYBI ERİDİ ══════════════════════
console.log('\n== 4) MÜDÜRLÜ oyuncuda kumbaralar TOPLANDI, tavan kaybı bitti ==')
for (const lvl of [1, 2, 3]) {
  const b = istasyon(lvl)
  const para0 = b.money
  const r = b.offlineManagerRun(gainsOf(b), 7200, Infinity)
  const a = istasyon(lvl); eskiDavranis(a, 7200)
  check(`Sv.${lvl} · müdür offline tur attı`, r.tours > 0, `tur=${r.tours}`)
  check(`Sv.${lvl} · tur sayısı MANAGER_TOUR_SEC ile birebir`,
    r.tours === Math.floor(7200 / MANAGER_TOUR_SEC[lvl]), `beklenen=${Math.floor(7200 / MANAGER_TOUR_SEC[lvl])} gerçek=${r.tours}`)
  check(`Sv.${lvl} · para KASAYA yazıldı (kumbarada beklemiyor)`,
    b.money === para0 + r.collected && r.collected > 0, `+${fmt(r.collected)}`)
  check(`Sv.${lvl} · YIKAMA kumbarası da toplandı (oyuncunun şikâyeti)`,
    (b.pendingCash.wash ?? 0) < a.pendingCash.wash)
  check(`Sv.${lvl} · HAVA-SU kumbarası da toplandı`,
    (b.pendingCash.airwater ?? 0) < a.pendingCash.airwater)
  check(`Sv.${lvl} · SELF YIKAMA + TIR PARKI da toplandı`,
    (b.pendingCash.selfwash ?? 0) < a.pendingCash.selfwash
    && (b.pendingCash.truckpark ?? 0) < a.pendingCash.truckpark)
  check(`Sv.${lvl} · tavan kaybı ${fmt(a.lostTotal())} → ${fmt(b.lostTotal())}`,
    b.lostTotal() < a.lostTotal() * 0.02 && a.lostTotal() > 1000)
  check(`Sv.${lvl} · ele geçen toplam BÜYÜDÜ (${fmt(eleGecen(a, 0))} → ${fmt(eleGecen(b, r.collected))})`,
    eleGecen(b, r.collected) > eleGecen(a, 0) * 2)
  // BEDAVA PARA YOK: ödenen ≈ üretilen ciro. Tolerans = collectPending'in TUR BAŞINA
  // ₺ yuvarlaması (online müdür turunda da birebir aynı; toplama başına en fazla 0,5 ₺).
  const uretilen7200 = gainsOf(b).reduce((t, [, , rt]) => t + rt * 7200, 0)
  const tolerans = r.tours * gainsOf(b).length * 0.5
  check(`Sv.${lvl} · toplanan, ÜRETİLEN ciroyu AŞMIYOR (bedava para yok)`,
    eleGecen(b, r.collected) <= uretilen7200 + tolerans,
    `${fmt(eleGecen(b, r.collected))} vs üretilen ${fmt(uretilen7200)} (±${fmt(tolerans)})`)
  check(`Sv.${lvl} · yuvarlama sapması %0,5'in altında`,
    Math.abs(eleGecen(b, r.collected) - uretilen7200) / uretilen7200 < 0.005,
    `${((eleGecen(b, r.collected) / uretilen7200 - 1) * 100).toFixed(3)}%`)
}
// tur süresi seviyeyle kısalıyor → daha sık toplama (uydurulmuş formül yok)
{
  const t1 = istasyon(1).offlineManagerRun(gainsOf(istasyon(1)), 7200, Infinity).tours
  const t3 = istasyon(3).offlineManagerRun(gainsOf(istasyon(3)), 7200, Infinity).tours
  check('Sv.3 müdür Sv.1\'den DAHA SIK tur atıyor (managerTick formülü)', t3 > t1, `${t1} vs ${t3}`)
  check('MANAGER_TOUR_SEC managerTick içinde kullanılıyor (kopya formül yok)',
    /const turSuresi = this\.managerTourSec\(\)/.test(oku('src/state.ts'))
    && !/\[45, 45, 32, 22\]\[Math\.min\(3, this\.managerLevel\)\]/.test(oku('src/state.ts')))
}
// kısa pencere: müdür turunu tamamlayamaz → eski davranış
{
  const b = istasyon(3)
  const r = b.offlineManagerRun(gainsOf(b), 20, Infinity) // tur 22 sn
  check('tur süresinden KISA yoklukta müdür toplamaz (yarım tur ödenmez)', r.collected === 0 && r.tours === 0)
}

// ═════════════════════ 5) PRESTİJ ÇARPANI TEK YOLDAN (çifte çarpma yok) ═════════════════════
console.log('\n== 5) Prestij çarpanı TEK yoldan (collectPending) uygulanıyor ==')
{
  const s0 = istasyon(3, { stars: 0 })
  const c0 = s0.offlineManagerRun(gainsOf(s0), 7200, Infinity).collected
  const s10 = istasyon(3, { stars: 10 })
  const c10 = s10.offlineManagerRun(gainsOf(s10), 7200, Infinity).collected
  const mult = GameState.prestigeMultFor(10)
  const oran = c10 / c0
  check(`10★ oranı = prestigeMult (${mult}) — kare (${(mult * mult).toFixed(2)}) DEĞİL`,
    Math.abs(oran - mult) < 0.02, `ölçülen oran=${oran.toFixed(3)}`)
  check('0★ oyuncuda çarpan etkisiz (×1)',
    Math.abs(c0 / gainsOf(s0).reduce((t, [, , r]) => t + r * 7200, 0) - 1) < 0.01)
  check('toplama TEK KAPIDAN: offlineManagerRun collectPending çağırıyor',
    /offlineManagerRun[\s\S]{0,2200}?this\.collectPending\(id\)/.test(oku('src/state.ts')))
  check('offlineManagerRun kendi başına prestigeMult UYGULAMIYOR (çifte çarpma freni)',
    !/offlineManagerRun[\s\S]{0,2200}?prestigeMult\(\)/.test(oku('src/state.ts')))
}

// ══════════════ 6) SUNUCU ANTİ-HİLE: TOPLAM OFFLINE GELİR ALLOWANCE'IN ALTINDA ══════════════
console.log('\n== 6) Sunucu allowance karşılaştırması (server/index.js ile senkron) ==')
const srv = oku('server/index.js')
const sabit = (re, ad) => {
  const m = srv.match(re)
  if (!m) { check(`server/index.js içinde ${ad} bulundu`, false); return NaN }
  return Number(m[1].replace(/_/g, ''))
}
const ALLOW_BURST = sabit(/const ALLOW_BURST = ([\d_]+)/, 'ALLOW_BURST')
const BRANCH_VAULT_HARD = sabit(/const BRANCH_VAULT_HARD = ([\d_]+)/, 'BRANCH_VAULT_HARD')
const ana = oku('src/main.ts')
const OFFLINE_BUDGET = Number((ana.match(/const OFFLINE_BUDGET = ([\d_]+)/) ?? [, 'NaN'])[1].replace(/_/g, ''))
check('main.ts OFFLINE_BUDGET tanımlı', Number.isFinite(OFFLINE_BUDGET), String(OFFLINE_BUDGET))
check(`OFFLINE_BUDGET (${fmt(OFFLINE_BUDGET)}) sunucu kovasının (${fmt(ALLOW_BURST)}) ALTINDA`,
  OFFLINE_BUDGET < ALLOW_BURST)
check('güvenlik payı ≥ ₺50.000 (kova yarı doluyken de yer var)',
  ALLOW_BURST - OFFLINE_BUDGET >= 50_000, fmt(ALLOW_BURST - OFFLINE_BUDGET))
check('bütçe applyAwayEarnings içinde müdüre GERÇEKTEN uygulanıyor',
  /offlineManagerRun\(gains, offSec, Math\.max\(0, OFFLINE_BUDGET - offlineYazilan\)\)/.test(ana))
check('offline yollarının HEPSİ bütçe sayacına yazıyor (idle + yakıt + modal geliri + müdür)',
  (ana.match(/offlineYazilan \+= /g) ?? []).length >= 4,
  String((ana.match(/offlineYazilan \+= /g) ?? []).length))
check('şube kasası tavanı kovayı BÜYÜTÜYOR (çok şubelide bütçe daha da güvenli)',
  BRANCH_VAULT_HARD > 0 && /ALLOW_BURST \+ pasif \* BRANCH_VAULT_HARD/.test(srv))

/** server/index.js maxIncomeRate() kopyası — kova DOLUM hızı */
function maxIncomeRate(s) {
  const fac = (s.marketLevel > 0 ? s.marketLevel : 0) + (s.hasCoffee ? 1 : 0) + (s.hasRestaurant ? 1 : 0)
    + (s.hasWash ? 1 : 0) + (s.hasOil ? 1 : 0) + (s.hasTruckPark ? 1 : 0) + (s.hasTruckPark2 ? 1 : 0)
    + s.selfWashCount + s.airWaterCount * 0.5 + (s.hasSMR ? 2 : 0)
  const base = 1 + s.pumps * 1.2 + s.evChargers * 0.8 + fac * 0.6
  return Math.max(20, base * 8 * 3 * GameState.prestigeStarMult(Math.min(40, s.brandStars)))
}
console.log('')
for (const [ad, mk] of SENARYO) {
  const s = mk()
  const rate = maxIncomeRate(s)
  const b = mk(); const r = b.offlineManagerRun(gainsOf(b), 7200, OFFLINE_BUDGET)
  // 2 saatlik yoklukta kasaya yazılan EN KÖTÜ toplam: modal geliri (≤150k tavan) +
  // idle (≤4k) + pompacı yakıt satışı (≤6000 L) + müdür — hepsi OFFLINE_BUDGET'la sınırlı
  const yazilan = Math.min(OFFLINE_BUDGET, 150_000 + 4_000 + 6_000 * 15.4) + 0 // bütçe dışı kalemler
  const toplam = Math.min(OFFLINE_BUDGET, yazilan + r.collected)
  const kovaDolumu = Math.min(ALLOW_BURST, 7200 * rate) // 2 saatte biriken jeton (boş kovadan)
  check(`${ad}: offline yazılan ${fmt(toplam)} ≤ kova ${fmt(ALLOW_BURST)}`, toplam <= ALLOW_BURST)
  check(`${ad}: müdür hızı (${(r.collected / 7200).toFixed(1)} ₺/sn) kova dolum hızının (${rate.toFixed(0)} ₺/sn) ALTINDA`,
    r.collected / 7200 < rate, `kova 2 saatte ${fmt(kovaDolumu)} biriktirir`)
}
// bütçe FİİLEN kesiyor mu? (yüksek prestijli oyuncuda kesmeli — ölçümle kanıtla)
{
  const s = istasyon(3, { stars: 10 })
  const serbest = istasyon(3, { stars: 10 })
  const rs = serbest.offlineManagerRun(gainsOf(serbest), 7200, Infinity).collected
  const rb = s.offlineManagerRun(gainsOf(s), 7200, 100_000).collected
  check(`10★ oyuncuda bütçe FİİLEN kesiyor (serbest ${fmt(rs)} → bütçeli ${fmt(rb)})`,
    rs > 150_000 && rb <= 110_000 && rb > 90_000)
  check('bütçe dolunca kalan ciro YANMIYOR, kumbarada birikiyor (eski davranış)',
    kumbaraToplam(s) > 0)
}

// ═════════════════════════ 7) SAVE UYUMU: ESKİ KAYIT ÇÖKMÜYOR ═════════════════════════
console.log('\n== 7) Save uyumu: yalnız EKLE, eski kayıt çökmüyor ==')
{
  // müdür alanlarının HİÇBİRİ olmayan eski kayıt
  const eski = { money: 12_000, day: 9, pumps: 3, hasWash: true, airWaterCount: 2, selfWashCount: 1, hasTruckPark: true }
  const s = new GameState()
  let patladi = null
  try {
    hydrateState(s, eski)
    const r = s.offlineManagerRun(gainsOf(s), 7200, OFFLINE_BUDGET)
    check('eski kayıt yüklendi, müdürsüz davranış (toplama YOK)', r.collected === 0 && r.tours === 0)
    check('eski kayıtta kumbaralar yine doluyor', kumbaraToplam(s) > 0)
  } catch (e) { patladi = e }
  check('eski kayıt yüklenirken ÇÖKME yok', !patladi, patladi?.message)
}
{
  // müdürlü kayıt: serialize → hydrate turu davranışı korumalı
  const a = istasyon(3)
  const b = new GameState(); hydrateState(b, JSON.parse(JSON.stringify(serializeState(a))))
  const ra = a.offlineManagerRun(gainsOf(a), 7200, OFFLINE_BUDGET)
  const rb = b.offlineManagerRun(gainsOf(b), 7200, OFFLINE_BUDGET)
  check('serialize→hydrate turundan sonra müdür AYNI parayı topluyor', ra.collected === rb.collected,
    `${ra.collected} vs ${rb.collected}`)
  // müdür alanları ZATEN kayıt listelerinde — fix yeni alan eklemediği için
  // "SAVE_FIELDS'a eklemeyi unutma" tuzağına (hasTruckPark2 vakası) hiç girilmiyor
  const durum = oku('src/state.ts')
  const alanListesi = durum.slice(durum.indexOf('const SAVE_FIELDS = ['))
  check('managerLevel + managerPolicy zaten SAVE_FIELDS içinde (yeni alan gerekmedi)',
    /'managerLevel'/.test(alanListesi) && /'managerPolicy'/.test(alanListesi))
  // offlineManagerRun gövdesi: HİÇBİR alana yazmıyor (yalnız addPending/collectPending
  // çağırıyor) → kayda yeni alan girmiyor, "SAVE_FIELDS'a eklemeyi unutma" riski YOK
  const govde = durum.slice(durum.indexOf('offlineManagerRun(gains:'),
    durum.indexOf('/** MÜDÜR TURU: seviyeye göre'))
  check('offlineManagerRun gövdesi bulundu', govde.length > 200 && govde.length < 2000, String(govde.length))
  check('fix YENİ kalıcı alan eklemedi (gövdede `this.x =` ataması yok)',
    !/this\.[a-zA-Z]+\s*(=[^=]|\+=|-=)/.test(govde))
}

// ═══════════════════════ 8) OYUNCUYA SÖYLENİYOR (metin + i18n) ═══════════════════════
console.log('\n== 8) Oyuncu ne olduğunu GÖRÜYOR (modal + i18n EN/FR) ==')
const ANAHTARLAR = [
  'Müdürün yokken kumbaraları topladı: +₺{0}',
  'Sen yokken tesislerin çalıştı: ~₺{0} — müdürün kumbaraları topladı.',
]
const i18n = oku('src/i18n.ts')
for (const k of ANAHTARLAR) {
  const kaçıs = k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const hit = [...i18n.matchAll(new RegExp(`'${kaçıs}':`, 'g'))].length
  check(`i18n: '${k.slice(0, 34)}…' hem EN hem FR sözlüğünde`, hit === 2, `bulunan=${hit}`)
}
check('yeni i18n satırları TEK TIRNAK kullanıyor (TS1117 çakışması yok)',
  !ANAHTARLAR.some(k => i18n.includes(`"${k}"`)))
check('offline modalı müdür satırını basabiliyor (managerCash parametresi)',
  /function showOfflineModal\(income: number, elapsedSec: number, soldL = 0, managerCash = 0\)/.test(ana))
check('modal ZATEN açıksa satır sonradan ekleniyor (modal applyAwayEarnings\'ten ÖNCE açılıyor)',
  /offlineModalKutu[\s\S]{0,400}?querySelector\('#off-ok'\)\?\.before\(satir\)/.test(ana))
check('modal kapanınca referans bırakılmıyor (kaçak DOM yok)',
  /const close = \(\) => \{ offlineModalKutu = null; o\.remove\(\) \}/.test(ana))
check('modal yoksa toast\'a düşüyor (misafir yolu sessiz kalmıyor)',
  /else \{\s*ui\.toast\(metin, 'good', true\)/.test(ana))

// ═══════════════════════ 9) main.ts KABLOSU ═══════════════════════
console.log('\n== 9) applyAwayEarnings gerçekten müdürü çağırıyor ==')
check('kumbara bloğu artık offlineManagerRun üzerinden yürüyor',
  /const mudur = state\.offlineManagerRun\(gains, offSec,/.test(ana))
check('eski "topla-yok" döngüsü kaldırıldı',
  !/for \(const \[id, name, rate\] of gains\) \{\s*const amt = Math\.round\(rate \* offSec\)\s*state\.addPending/.test(ana))
check('müdür toplaması kasaya + toplam rapora giriyor',
  /if \(mudur\.collected > 0\) \{\s*offlineYazilan \+= mudur\.collected\s*total \+= mudur\.collected/.test(ana))
check('müdürsüzde eski ₺600\'lük gösterim korunuyor',
  /for \(const \[, , rate\] of gains\) total \+= Math\.min\(Math\.round\(rate \* offSec\), 600\)/.test(ana))

// ══════════════ 10) CANLI TARAYICI: kod GERÇEK bundle'da da çalışıyor mu ══════════════
// Node ölçümü src/state.ts'i doğrudan koşturur; bu bölüm aynı kodun tarayıcı derlemesinde
// de çalıştığını kanıtlar (import zinciri, i18n/DOM guard'ları, minify sonrası davranış).
// DEV SUNUCU YOKSA TEST HATA VERİR — atlanan ölçüm geçmiş sayılmaz.
const PORTLAR = process.env.PORT ? [process.env.PORT] : ['5399', '5173', '5174']
let PORT = null
for (const p of PORTLAR) {
  try { if ((await fetch(`http://localhost:${p}/`, { signal: AbortSignal.timeout(1500) })).ok) { PORT = p; break } }
  catch { /* sıradaki */ }
}
if (!PORT) {
  console.log(`\n❌ dev sunucu bulunamadı (${PORTLAR.join(', ')}) — CANLI DOĞRULAMA KOŞMADI.`)
  console.log('   Bu bölüm testin kanıtının parçası; atlanırsa sonuç GEÇTİ sayılmaz.')
  console.log(`   Çalıştır: npm run dev -- --port ${PORTLAR[0]}`)
  process.exit(1)
}
console.log(`\n== 10) Canlı tarayıcı doğrulaması (:${PORT}, ?full=1) ==`)
{
  const { chromium } = await import('playwright-core')
  const b = await chromium.launch({ channel: 'chrome' })
  const p = await b.newPage()
  const hatalar = []
  p.on('pageerror', e => hatalar.push(e.message))
  await p.goto(`http://localhost:${PORT}/?full=1`, { waitUntil: 'domcontentloaded' })
  await p.waitForFunction(() => !!window.__dbg?.state, null, { timeout: 30000 })
  await p.waitForTimeout(2000)
  const r = await p.evaluate(() => {
    const s = window.__dbg.state
    const g = []
    if (s.hasTruckPark) g.push(['truckpark', 'Tır parkı', 125 / 45])
    if (s.hasSelfWash) g.push(['selfwash', 'Self yıkama', (45 / 35) * s.selfWashCount])
    if (s.hasWash) g.push(['wash', 'Oto yıkama', 1.4])
    if (s.hasAirWater) g.push(['airwater', 'Hava-Su', 0.5 * s.airWaterCount])
    const olcum = mgr => {
      for (const [id] of g) delete s.pendingCash[id]
      s.facLost = {}
      s.managerLevel = mgr
      s.managerPolicy = { ...s.managerPolicy, collect: true }
      const para0 = s.money
      const res = s.offlineManagerRun(g, 7200, 200_000)
      const kumbara = g.reduce((a, [id]) => a + (s.pendingCash[id] || 0), 0)
      return { ...res, kasaArtisi: s.money - para0, kumbara, eriyen: s.lostTotal() }
    }
    const yok = olcum(0)
    const sv3 = olcum(3)
    return { tesis: g.length, yok, sv3, tur: s.managerTourSec() }
  })
  await b.close()
  check('sayfa hatası yok', hatalar.length === 0, hatalar[0])
  check('ölçüm GERÇEKTEN koştu (kumbaralı tesis var)', r.tesis >= 3, `tesis=${r.tesis}`)
  check('tarayıcıda müdürsüz: kasaya para YAZILMIYOR, kumbara doluyor',
    r.yok.kasaArtisi === 0 && r.yok.kumbara > 0 && r.yok.eriyen > 0,
    JSON.stringify(r.yok))
  check('tarayıcıda Sv.3 müdür: kumbaralar TOPLANDI, kasaya yazıldı',
    r.sv3.kasaArtisi > 0 && r.sv3.tours === Math.floor(7200 / 22) && r.sv3.kasaArtisi === r.sv3.collected,
    JSON.stringify(r.sv3))
  check(`tarayıcıda tavan kaybı bitti (${fmt(r.yok.eriyen)} → ${fmt(r.sv3.eriyen)})`,
    r.sv3.eriyen < r.yok.eriyen * 0.02)
  check('tarayıcıda müdürlü kazanç müdürsüzden BÜYÜK',
    r.sv3.kasaArtisi + r.sv3.kumbara > (r.yok.kumbara) * 2,
    `${fmt(r.sv3.kasaArtisi + r.sv3.kumbara)} vs ${fmt(r.yok.kumbara)}`)
  check('tarayıcıda tur süresi Sv.3 = 22 sn (MANAGER_TOUR_SEC)', r.tur === 22, String(r.tur))
}

console.log(`\n${fail === 0 ? '✅' : '❌'} offline-müdür: ${pass} geçti, ${fail} kaldı`)
process.exit(fail === 0 ? 0 : 1)
