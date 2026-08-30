/**
 * MARİNA DERİNLİĞİ TESTİ — "marina sığ hissediyor" (Oğuz, 30 Ağu 2026).
 *
 * TEŞHİS: marinanın TÜM gelirleri pasifti (bağlama, kışlama, tesis) — parçalar
 * birbirinden habersizdi ve oyuncunun verecek kararı yoktu.
 *
 * EKLENEN BAĞLANTILAR:
 *  · TERSANE KUYRUĞU — marinanın tek aktif karar noktası. Kapasite = kışlama kızakları
 *    (winterSlots) ve travel lift şart: böylece lift → kışlama → bakım TEK ZİNCİR olur.
 *    İş akışı KIŞIN zirve yapar, yani sezon ritmi mekaniğe bağlanır.
 *  · ÜYELİK — yat kulübü varsa bağlama yerlerinin bir kısmı üyeye döner; KIŞIN da gelen
 *    sabit gelir, sezon çöküşünü (yaz %95 → kış %55 doluluk) yumuşatır.
 *
 * Kullanım: npx tsx tools/tests/marina-check.mjs
 */
globalThis.localStorage = {
  _d: {}, getItem(k) { return this._d[k] ?? null },
  setItem(k, v) { this._d[k] = String(v) }, removeItem(k) { delete this._d[k] },
}
Object.defineProperty(globalThis, 'navigator', { value: { language: 'tr' }, configurable: true })
import { readFileSync } from 'node:fs'
const { GameState, hydrateState, serializeState } = await import('../../src/state.ts')
const { refitDemand, pickRefitJob, membershipIncome, REFIT_KINDS } = await import('../../src/marina.ts')

let hata = 0
const bekle = (k, ad, ek = '') => { console.log(`${k ? '✅' : '❌'} ${ad}${ek ? ' · ' + ek : ''}`); if (!k) hata++ }
const oku = f => readFileSync(new URL('../../' + f, import.meta.url), 'utf8')

/** marina şubesinde, travel lift + kızak + bağlama kurulu bir oyun durumu */
const kurMarina = (winterSlots = 6, kulup = true) => {
  const s = new GameState()
  s.unlockedLocs = ['kasaba', 'marina']
  s.activeLoc = 'marina'
  s.marinaFacs = ['travelift', 'pumpout', 'wasteoil', 'boom', ...(kulup ? ['clubhouse'] : [])]
  s.winterSlots = winterSlots
  s.berths = { finger8: 6, finger12: 4, mega: 1 }
  return s
}

console.log('── ZİNCİR: travel lift → kışlama → tersane ──')
const s = kurMarina()
bekle(s.isMarina, 'marina şubesi aktif')
bekle(s.refitCapacity() === 6, 'kızak kapasitesi kışlama yuvalarından geliyor', `${s.refitCapacity()}`)

const liftsiz = kurMarina()
liftsiz.marinaFacs = liftsiz.marinaFacs.filter(f => f !== 'travelift')
bekle(liftsiz.refitCapacity() === 0, 'travel lift YOKSA tersane hiç çalışmaz (zincirin ilk halkası)')

const kizaksiz = kurMarina(0)
bekle(kizaksiz.refitCapacity() === 0, 'kızak yoksa kapasite 0')

console.log('\n── SEZON RİTMİ: kışın iş zirve ──')
const talep = {}
for (const sid of ['yaz', 'sonbahar', 'kis', 'ilkbahar']) talep[sid] = refitDemand(sid, 11) // 11 bağlama yeri
console.log('  ', JSON.stringify(talep))
bekle(talep.kis > talep.yaz, 'kışın gelen iş yazdan FAZLA (tekneler karaya çıkar)',
  `kış ${talep.kis} > yaz ${talep.yaz}`)
bekle(talep.yaz > 0, 'yazın da iş var (sistem yılın üçte birinde ölmüyor)', `yaz ${talep.yaz}`)
bekle(talep.kis >= talep.sonbahar && talep.sonbahar >= talep.yaz, 'talep eğrisi tutarlı')
bekle(refitDemand('kis', 0) === 0, 'bağlama yoksa iş de gelmez')

console.log('\n── İŞ ÜRETİMİ DETERMİNİST (F5 ile kumar oynanamaz) ──')
const a1 = pickRefitJob(40, 0), a2 = pickRefitJob(40, 0)
bekle(a1.kind === a2.kind && a1.ucret === a2.ucret, 'aynı gün+indeks aynı işi üretiyor',
  `${a1.kind} ₺${a1.ucret}`)
const b1 = pickRefitJob(41, 0)
bekle(b1.kind !== a1.kind || b1.ucret !== a1.ucret, 'farklı gün farklı iş üretiyor')
bekle(Object.keys(REFIT_KINDS).includes(a1.kind), 'üretilen iş türü tanımlı', a1.kind)
bekle(a1.gun >= 1 && a1.ucret > 0, 'iş süresi ve ücreti geçerli', `${a1.gun} gün / ₺${a1.ucret}`)

console.log('\n── KAPASİTE KARARI ACITIYOR ──')
const k = kurMarina(2)          // yalnız 2 kızak
// KIŞA SABİTLE: yazın talep düşük olduğu için rastgele gün seçmek ret yolunu sessizce
// atlatıyordu. Sezonu arayarak buluyoruz — test "denenemedi" diye geçmemeli.
k.day = 1
while (k.season().id !== 'kis' && k.day < 300) k.day++
k.rollRefitOffers()
const gelen = k.refitOffers.length
bekle(gelen > 0, 'KIŞIN gün başında iş teklifi geliyor', `${gelen} teklif · sezon ${k.season().name}`)
// kapasiteyi doldur
let kabul = 0
while (k.refitFree() > 0 && k.refitOffers.length > 0) { if (k.acceptRefit(0).ok) kabul++ }
bekle(kabul === Math.min(2, gelen), 'kızak kadar iş kabul edilebiliyor', `${kabul} iş`)
if (gelen > kabul) {
  const r = k.acceptRefit(0)
  bekle(!r.ok && r.reason === 'kapasite', 'kızak dolunca yeni iş REDDEDİLİYOR (karar acıtır)')
} else {
  bekle(false, 'kışın teklif kapasiteyi aşmalı (ret yolu denenebilmeli)', `${gelen} teklif / 2 kızak`)
}

console.log('\n── İŞ TESLİMİ ÖDÜYOR ──')
const t2 = kurMarina(4)
t2.money = 100_000
t2.refitJobs = [{ kind: 'karina', daysLeft: 1, fee: 15_000 }, { kind: 'boya', daysLeft: 3, fee: 46_000 }]
const rep0 = t2.reputation
const r1 = t2.processRefitDay()
bekle(r1.biten === 1 && r1.kazanc === 15_000, '1 günlük iş bitti ve ödendi', `+₺${r1.kazanc}`)
bekle(t2.money === 115_000, 'kazanç kasaya yazıldı', `₺${t2.money}`)
bekle(t2.reputation > rep0, 'teslim edilen iş itibar getiriyor')
bekle(t2.refitJobs.length === 1 && t2.refitJobs[0].daysLeft === 2, 'uzun iş kızakta ilerliyor')
const r2 = t2.processRefitDay()
bekle(r2.biten === 0, '2 gün kalan iş henüz bitmedi')
t2.processRefitDay()
bekle(t2.refitJobs.length === 0 && t2.refitEarned === 61_000, 'tüm işler tamamlandı',
  `toplam ₺${t2.refitEarned}, ${t2.refitDone} iş`)

console.log('\n── ÜYELİK: kış gelirini stabilize ediyor ──')
const uyeli = kurMarina(4, true), uyesiz = kurMarina(4, false)
const mu = membershipIncome(uyeli.berths, true, false)
bekle(mu.uye > 0 && mu.gelir > 0, 'yat kulübü varsa üye ve aidat geliri var',
  `${mu.uye} üye / ₺${mu.gelir}`)
bekle(membershipIncome(uyesiz.berths, false, false).gelir === 0, 'kulüp yoksa üyelik geliri YOK')
bekle(membershipIncome(uyeli.berths, true, true).uye > mu.uye, 'Mavi Bayrak sadakati artırıyor')

// ÖLÇÜM: üyelik gelirin ne kadarını taşıyor ve KIŞIN ayakta mı kalıyor?
// (İlk sürümde "sezon uçurumunu kapatır" diye test ediyordum — ölçüm bunu YALANLADI:
//  kış/yaz oranı zaten ~%90, çünkü kışlama geliri uçurumu kapatıyor. Testi gerçeğe
//  uydurdum: üyeliğin işi sezon düzleştirmek değil, kulüp yatırımına karşılık vermek.)
const yazGelir = (() => { uyeli.day = 1; return uyeli.marinaDailyIncome() })()
const kisGelir = (() => { uyeli.day = 1 + 135; return uyeli.marinaDailyIncome() })()
const uyesizKis = (() => { uyesiz.day = 1 + 135; return uyesiz.marinaDailyIncome() })()
console.log(`   üyelik payı — yaz %${Math.round(yazGelir.uyelik / yazGelir.total * 100)}`
  + ` · kış %${Math.round(kisGelir.uyelik / kisGelir.total * 100)}`)
bekle(kisGelir.uyelik > 0, 'kışın da aidat geliyor (bağlama boşalsa bile)', `₺${kisGelir.uyelik}`)
bekle(kisGelir.uyelik === yazGelir.uyelik, 'aidat sezondan BAĞIMSIZ (sabit omurga)')
bekle(kisGelir.total > uyesizKis.total, 'kulüp yatırımı kışın somut gelir farkı yaratıyor',
  `₺${Math.round(kisGelir.total - uyesizKis.total)}/gün fazla`)
bekle(kisGelir.uyelik / kisGelir.total > 0.1, 'aidat anlamlı bir pay (>%10) — süs değil',
  `%${Math.round(kisGelir.uyelik / kisGelir.total * 100)}`)

console.log('\n── SAVE UYUMLULUĞU ──')
const state_ts = oku('src/state.ts')
bekle(/'refitJobs', 'refitDone', 'refitEarned'/.test(state_ts), 'tersane alanları SAVE_FIELDS\'ta')
bekle(!/'refitOffers'/.test(state_ts.match(/const SAVE_FIELDS = \[[\s\S]*?\] as const/)?.[0] ?? ''),
  'günlük teklifler KAYDA GİRMİYOR (gün içi karar, F5 ile yenilenmemeli)')

const eski = { money: 500_000, day: 88, reputation: 4.1, pumps: 6,
               stats: { served: 500, lost: 20, kwh: 0, revenue: 1000 } }
const s3 = new GameState()
hydrateState(s3, eski)
bekle(Array.isArray(s3.refitJobs) && s3.refitJobs.length === 0, 'ESKİ kayıt: tersane boş diziyle açılıyor (çökmüyor)')
bekle(s3.refitDone === 0 && s3.refitEarned === 0, 'eksik tersane sayaçları 0')
bekle(s3.money === 500_000 && s3.day === 88, 'eski kayıt değerleri korunuyor')
bekle(s3.refitCapacity() === 0, 'kara şubesinde tersane kapasitesi 0 (marina dışı etkilenmiyor)')
const tekrar = serializeState(s3)
bekle(Array.isArray(tekrar.refitJobs), 'tersane tekrar kaydediliyor')

// kara şubesi hiç etkilenmemeli
const kara = new GameState()
bekle(kara.marinaDailyIncome().total === 0, 'kara şubesinde marina geliri 0 (regresyon yok)')
bekle(kara.processRefitDay().biten === 0, 'kara şubesinde tersane işlemiyor')

console.log('\n── ARAYÜZ BAĞLANTISI ──')
const main = oku('src/main.ts'), html = oku('index.html')
bekle(/data-oftab="tersane"/.test(html), 'Ofis\'te Tersane sekmesi var')
bekle(/data-ofpane="tersane"/.test(html), 'Tersane paneli var')
bekle(/tab\.style\.display = marinaMi \? '' : 'none'/.test(main), 'sekme yalnız marinada görünüyor')
bekle(/state\.acceptRefit\(Number\(btn\.dataset\.refit\)\)/.test(main), 'Kabul butonu bağlı')
bekle(/state\.processRefitDay\(\)/.test(main), 'gün dönüşünde işler işleniyor')
bekle(/state\.rollRefitOffers\(\)/.test(main), 'gün başında yeni teklifler geliyor')
bekle(/Kulüp aidatı/.test(main), 'üyelik geliri ayrı raporlanıyor')

console.log(hata ? `\n${hata} HATA` : '\nMARİNA DERİNLİĞİ TEMİZ')
process.exit(hata ? 1 : 0)
