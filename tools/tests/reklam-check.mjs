/**
 * ÖDÜLLÜ REKLAM v2 TESTİ (3 Eyl 2026) — istemci tarafı mekanikler ve "yapılmayacaklar".
 *
 * Kapsanan:
 *  · TAMİR SÜRE ALIR: para başlarken ödenir, ünite 60-120 sn bozuk kalır, süre bitince çalışır;
 *    "tamiri hızlandır" ödülü yalnız ÖDENMİŞ/süren tamiri bitirir (fail-closed), para iade etmez.
 *  · Murphy kaynağı: kasa boşken çıkan arıza 'murphy' damgalı → main.ts teklif GÖSTERMEZ.
 *  · Tanker hızlandır: yoldaki sipariş anında teslim; sipariş yoksa null (bedava litre yok).
 *  · Trafik artır: EKLEMELİ süre, entryChance ×1.6; event uzat: süren fırsat +60 sn.
 *  · Kurtarma koşulu: kasa+tank ~0 VE banka vermiyor; tutar dinamik (min. tanker bedeli − kasa).
 *  · Kayıt: repairs/brokenSource/trafikBoostUntil/adUse SAVE_FIELDS'ta (F5 tamiri bitirmez),
 *    kurcalanmış kayıt temizlenir, ünite satışında tamir sayacı doğru indekse taşınır.
 *  · YAPILMAYACAKLAR: interstitial yok, seri/VIP "kaybedersin" teklifleri yok, sabit tutarlı nakit yok,
 *    sunucu/istemci yerleşim listesi birebir.
 *
 * Kullanım: npx tsx tools/tests/reklam-check.mjs
 */
globalThis.localStorage = {
  _d: {}, getItem(k) { return this._d[k] ?? null },
  setItem(k, v) { this._d[k] = String(v) }, removeItem(k) { delete this._d[k] },
}
Object.defineProperty(globalThis, 'navigator', { value: { language: 'tr' }, configurable: true })
import { readFileSync } from 'node:fs'
const { GameState, hydrateState, serializeState, doMaintenance, getMaintenanceItems, applySell } = await import('../../src/state.ts')
const SAVE_FIELDS = Object.keys(serializeState(new GameState()))

let hata = 0
const bekle = (k, ad, ek = '') => { console.log(`${k ? '✅' : '❌'} ${ad}${ek ? ' · ' + ek : ''}`); if (!k) hata++ }
const oku = f => readFileSync(new URL('../../' + f, import.meta.url), 'utf8')

const main_ts = oku('src/main.ts')
const ads_ts = oku('src/ads.ts')
const reklam_ts = oku('src/reklam.ts')
const reklam_js = oku('server/reklam.js')

console.log('── TDZ REGRESYONU (canlı çöküş 3 Eyl 2026: "Cannot access before initialization") ──')
{
  // Modül üst düzeyindeki yükleme bloğu hediyeRituelBaslat()/offerOffline2x() çağırır; bunların
  // dokunduğu let/const'lar (adOffer, hediyeBekliyor, reklamAktif…) o bloktan ÖNCE tanımlı olmalı.
  const cagri = main_ts.indexOf('  hediyeRituelBaslat()')
  for (const ad of ['let adOffer', 'let hediyeBekliyor', 'let hediyeGecikmeT', 'let offlineTeklifVerildi', 'let askidaTeklif', 'const reklamAktif', 'const tlx', 'const AD_HEDIYE_GECIKME']) {
    const i = main_ts.search(new RegExp('^' + ad + '[ :]', 'm'))
    bekle(i > 0 && i < cagri, `${ad} yükleme bloğundan ÖNCE tanımlı`)
  }
}

console.log('── TAMİR SÜRE ALIR: para şimdi, ünite sonra ──')
{
  const s = new GameState()
  s.money = 10_000; s.pumps = 3; s.brokenPumps.add(1)
  const para0 = s.money
  bekle(doMaintenance(s, 'fix-pump-1'), 'tamir satın alındı')
  bekle(s.money === para0 - GameState.PUMP_FIX_COST, 'para hemen düştü (₺800)', `₺${para0 - s.money}`)
  bekle(s.brokenPumps.has(1), 'ünite HÂLÂ bozuk (tamir sürüyor)')
  const kalan = s.repairLeft('pump', 1)
  bekle(kalan >= GameState.REPAIR_MIN_SN && kalan <= GameState.REPAIR_MAX_SN, 'süre 60-120 sn arasında', `${Math.round(kalan)} sn`)
  const satir = getMaintenanceItems(s).find(r => r.id === 'fix-pump-1')
  bekle(satir && satir.disabled && satir.cost === 0, 'bakım satırı "tamir ediliyor" (kapalı, ikinci ödeme yok)')
  bekle(!doMaintenance(s, 'fix-pump-1') && s.money === para0 - GameState.PUMP_FIX_COST, 'süren tamire tekrar para alınmıyor')
  s.tickRepairs(kalan / 2)
  bekle(s.brokenPumps.has(1), 'yarı sürede hâlâ bozuk')
  s.tickRepairs(kalan)
  bekle(!s.brokenPumps.has(1) && s.repairLeft('pump', 1) === 0, 'süre dolunca çalışır, sayaç silindi')
  bekle(s.events.some(e => /tamir edildi/.test(e)), 'oyuncuya olay yazıldı')
}

console.log('\n── TAMİRİ HIZLANDIR (reklam #3): yalnız ödenmiş tamir, para iadesi yok ──')
{
  const s = new GameState()
  s.money = 5_000; s.evChargers = 2; s.brokenChargers.add(0)
  bekle(!s.adTamirHizlandir('charger', 0), 'ÖDENMEMİŞ arızada hızlandırma YOK (fail-closed: reklam bedava tamir değil)')
  bekle(s.brokenChargers.has(0), 'ünite bozuk kaldı')
  doMaintenance(s, 'fix-charger-0')
  const para = s.money
  bekle(s.adTamirHizlandir('charger', 0), 'ödenmiş tamir anında bitti')
  bekle(!s.brokenChargers.has(0) && s.repairLeft('charger', 0) === 0, 'ünite çalışıyor, sayaç yok')
  bekle(s.money === para, 'para İADE edilmedi (ödül = zaman, nakit değil)')
  bekle(!s.adTamirHizlandir('charger', 0), 'ikinci hızlandırma boş döner')
}

console.log('\n── MURPHY KAYNAĞI: kasa boşken çıkan arıza damgalanır ──')
{
  // Murphy: money < 1000 → stress 3; deterministik olsun diye zar sabitlenir
  const rnd = Math.random
  const s = new GameState(); s.pumps = 3; s.money = 500; s.day = 5; s.maintCare = 0
  Math.random = () => 0
  s.tick(0.5)
  Math.random = rnd
  const k = Object.keys(s.brokenSource)
  bekle(k.length >= 1 && s.brokenSource[k[0]] === 'murphy', 'kasa ₺500 iken arıza → kaynak "murphy"', JSON.stringify(s.brokenSource))
  const n = new GameState(); n.pumps = 3; n.money = 50_000; n.day = 5; n.maintCare = 0
  Math.random = () => 0
  n.tick(0.5)
  Math.random = rnd
  const kn = Object.keys(n.brokenSource)
  bekle(kn.length >= 1 && n.brokenSource[kn[0]] === 'normal', 'kasa doluyken arıza → kaynak "normal"', JSON.stringify(n.brokenSource))
  bekle(/kaynak === 'murphy'[\s\S]{0,400}continue/.test(main_ts), 'main.ts: Murphy arızasında tamir teklifi ATLANIYOR')
  bekle(/event: 'skip', network: 'murphy'/.test(main_ts), 'main.ts: atlanan Murphy teklifi telemetriye yazılıyor')
}

console.log('\n── TANKER HIZLANDIR (reklam #4): sipariş yoksa ödül yok ──')
{
  const s = new GameState()
  bekle(s.adTankerHizlandir() === null, 'sipariş yokken null (bedava litre yok)')
  s.money = 100_000; s.tanks.benzin = 0
  bekle(s.placeOrder('benzin'), 'sipariş verildi')
  const amount = s.orders.benzin.amount
  const f = s.adTankerHizlandir()
  bekle(f === 'benzin', 'yoldaki sipariş seçildi')
  bekle(!s.orders.benzin.pending && !s.orders.benzin.arrived && !s.orders.benzin.delivering, 'sipariş kapandı (tanker sahneye çıkmaz)')
  bekle(Math.abs(s.tanks.benzin - amount) < 1e-6, 'ödenen parti tanka girdi, fazlası yok', `${s.tanks.benzin} / ${amount}`)
}

console.log('\n── TRAFİK ARTIR (#7) ve EVENT UZAT (#5) ──')
{
  const s = new GameState()
  s.reputation = 3; s.day = 5
  const e0 = s.entryChance()
  s.adTrafikArtir()
  bekle(s.trafikBoostActive, 'trafik ödülü aktif')
  const e1 = s.entryChance()
  bekle(e1 > e0 && Math.abs(e1 / e0 - GameState.TRAFIK_BOOST_MULT) < 0.05 || e1 >= 0.8, 'giriş şansı ×1.6 (yumuşak tavana kadar)', `${e0.toFixed(3)} → ${e1.toFixed(3)}`)
  const until1 = s.trafikBoostUntil
  s.adTrafikArtir()
  bekle(s.trafikBoostUntil - until1 >= GameState.TRAFIK_BOOST_SN * 1000 - 5, 'ikinci izleme süreyi EKLİYOR (yutmuyor)')
  bekle(SAVE_FIELDS.includes('trafikBoostUntil'), 'trafik damgası kayda giriyor (F5 yakmaz)')
  bekle(/kuyrukDoluMu\(\) \? t\('kuyruk dolu/.test(main_ts), 'main.ts: kuyruk doluyken trafik teklifi kapalı')

  const p = new GameState()
  bekle(p.adEventUzat() === 'basladi' && p.promo && p.promo.until > Date.now() + 55_000, 'fırsat yokken 60 sn fırsat başlar')
  const u = p.promo.until
  bekle(p.adEventUzat() === 'uzadi' && p.promo.until === u + 60_000, 'süren fırsat +60 sn uzar')
}

console.log('\n── KURTARMA (#8): koşul sıkı, tutar dinamik ──')
{
  const s = new GameState()
  bekle(s.kurtarmaTutari() === 0, 'başlangıç kasasıyla (₺5.000) kurtarma YOK')
  s.money = 100; for (const f of Object.keys(s.tanks)) s.tanks[f] = 0
  bekle(s.kurtarmaTutari() === 0, 'kasa+tank sıfır ama BANKA hâlâ avans veriyor → kurtarma yok')
  s.loan = { ...s.loan, active: true, principal: 5000, monthly: 600, remaining: 8 }
  const tutar = s.kurtarmaTutari()
  bekle(tutar > 0, 'kredi altında + kasa/tank sıfır → kurtarma teklifi', `₺${tutar}`)
  // en ucuz yakıtın 200 L partisi − kasa
  let best = Infinity
  for (const f of Object.keys(s.tanks)) best = Math.min(best, Math.ceil(200 * s.buyPrice(f) * s.supplierMult()))
  bekle(tutar === Math.max(0, best - 100), 'tutar = en ucuz 200 L parti − kasa (SABİT TUTAR DEĞİL)', `${tutar} vs ${best - 100}`)
  s.money = 1_600
  bekle(s.kurtarmaTutari() === 0, 'kasada ₺1.600 varken kurtarma yok')
  s.money = 100; s.tanks.benzin = 500
  bekle(s.kurtarmaTutari() === 0, 'tankta 500 L varken kurtarma yok (satacak malı var)')
  bekle(/placement === 'kurtarma'[\s\S]{0,300}money\) \|\| 0\) > KURTARMA_MAX[\s\S]{0,80}'not-broke'/.test(reklam_js), 'sunucu kurtarmayı kasaya göre ayrıca doğruluyor (not-broke)')
}

console.log('\n── KAYIT: tamir F5 ile bitmez, kurcalanmış kayıt temizlenir, ünite satışında taşınır ──')
{
  const s = new GameState()
  s.money = 10_000; s.pumps = 4; s.brokenPumps.add(2); s.brokenSource['pump-2'] = 'murphy'
  doMaintenance(s, 'fix-pump-2')
  const kalan = s.repairLeft('pump', 2)
  const data = JSON.parse(JSON.stringify(serializeState(s)))
  const y = new GameState(); hydrateState(y, data)
  bekle(Math.abs(y.repairLeft('pump', 2) - kalan) < 1e-6 && y.brokenPumps.has(2), 'yüklenen kayıtta tamir sayacı ve arıza korunuyor')
  bekle(y.brokenSource['pump-2'] === 'murphy', 'arıza kaynağı korunuyor')
  for (const f of ['repairs', 'brokenSource', 'trafikBoostUntil', 'adUse']) bekle(SAVE_FIELDS.includes(f), `SAVE_FIELDS: ${f}`)

  const k = new GameState()
  hydrateState(k, { ...data, repairs: { 'pump-2': 99_999, 'hack': 5, 'charger-0': -3 }, brokenSource: { 'pump-2': 'x', 'pump-1': 'normal' }, trafikBoostUntil: 'abc', adUse: 'yok' })
  bekle(k.repairs['pump-2'] === GameState.REPAIR_MAX_SN && !('hack' in k.repairs) && !('charger-0' in k.repairs), 'kurcalanmış tamir sayaçları kırpıldı/atıldı', JSON.stringify(k.repairs))
  bekle(!('pump-2' in k.brokenSource) && k.brokenSource['pump-1'] === 'normal', 'bilinmeyen kaynak değeri atıldı')
  bekle(k.trafikBoostUntil === 0 && k.adUse.day === '' && typeof k.adUse.n === 'object', 'bozuk trafik damgası/adUse varsayılana döndü')

  // eski kayıt: alanlar yok → çökme yok, boş
  const e = new GameState(); hydrateState(e, { money: 1000, day: 3 })
  bekle(Object.keys(e.repairs).length === 0 && Object.keys(e.brokenSource).length === 0 && e.trafikBoostUntil === 0, 'eski kayıt (alanlar yok) temiz yükleniyor')

  // ünite satışı: son pompanın sayacı tıklanan indekse taşınır
  const t = new GameState(); t.money = 50_000; t.pumps = 4
  t.brokenPumps.add(3); t.brokenSource['pump-3'] = 'normal'; doMaintenance(t, 'fix-pump-3')
  const k3 = t.repairLeft('pump', 3)
  const r = applySell(t, 'pump#1')
  bekle(r !== null && t.pumps === 3, 'pompa satıldı')
  bekle(Math.abs(t.repairLeft('pump', 1) - k3) < 1e-6 && t.repairLeft('pump', 3) === 0 && t.brokenPumps.has(1) && !t.brokenPumps.has(3), 'tamir sayacı ve arıza son üniteden tıklanan indekse taşındı', JSON.stringify(t.repairs))
}

console.log('\n── YAPILMAYACAKLAR ve sözleşmeler ──')
{
  bekle(!/interstitial\(/.test(main_ts) && !/export function interstitial/.test(ads_ts), 'interstitial/zorunlu reklam YOK')
  bekle(!/showAdOffer\('seri'|showAdOffer\('vip'|adSeriHak|adVipHak/.test(main_ts), '"seriyi kurtar / VIP\'yi tut" kayıp-tehdidi teklifleri YOK')
  bekle(!/admob/i.test(ads_ts.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '')), 'AdMob kod kalıntısı yok (AppLovin MAX)')
  bekle(/showRewarded\(id, tk\.ticket\)/.test(reklam_ts), 'bilet id\'si SSV customData olarak videoya gidiyor')
  bekle(/premium \|\| isPremium\(\)[\s\S]{0,200}claim\(tk\.ticket, 'premium'\)/.test(reklam_ts), 'premium ödülü sunucu claim\'inden geçiyor (tavan korunur)')
  bekle(/adEtiket[\s\S]*?'gun2x': return t\('Günü 2× yap: \+₺\{0\} · \{1\}', tlx\(o\.amount\)/.test(main_ts), 'etiket ödülü ÖNCE ve NET (sunucunun kestiği tutar) yazıyor')
  bekle(/amount = ticket\.amount/.test(main_ts), 'etiketteki tutar = sunucu biletinin tutarı (vaat ≠ verilen olmaz)')
  // sunucu ↔ istemci yerleşim listesi birebir
  const srvIds = [...reklam_js.matchAll(/^\s{2}(\w+):\s*\{ kind:/gm)].map(m => m[1])
  const cliIds = [...reklam_ts.matchAll(/^\s{2}(\w+):\s*\{ kind:/gm)].map(m => m[1])
  bekle(srvIds.length === 9 && JSON.stringify(srvIds) === JSON.stringify(cliIds), 'sunucu/istemci yerleşim listeleri birebir', `${srvIds.join(',')} | ${cliIds.join(',')}`)
  for (const id of srvIds) {
    const sv = new RegExp(`^\\s{2}${id}:\\s*\\{ kind:\\s*'(\\w+)',\\s*cap: (\\d+)`, 'm').exec(reklam_js)
    const cl = new RegExp(`^\\s{2}${id}:\\s*\\{ kind:\\s*'(\\w+)',\\s*cap: (\\d+)`, 'm').exec(reklam_ts)
    bekle(sv && cl && sv[1] === cl[1] && sv[2] === cl[2], `yerleşim ${id}: tür/tavan aynı`, `${sv?.[1]}/${sv?.[2]} vs ${cl?.[1]}/${cl?.[2]}`)
  }
  bekle(/ad_views/.test(reklam_ts), 'izlenen reklam ad_views metriğine yazılıyor')
}

console.log('\n── STRATEJİ v2.1 (3 Eyl 2026): zamanlama, askıya alma, günlük hediye ──')
{
  // 1) gün sonu 2× artık 22 sn'de kaçmıyor: ~yarım oyun günü (≥ 60 sn) görünür; offline2x ≥ 45 sn
  const sabit = (ad) => Number((new RegExp(`const ${ad} = (\\d+)`).exec(main_ts) || [])[1])
  bekle(sabit('AD_GUN2X_SURE') >= 60 && sabit('AD_GUN2X_SURE') <= 120, 'gün2× teklif süresi 60–120 sn', `${sabit('AD_GUN2X_SURE')} sn`)
  bekle(sabit('AD_OFFLINE2X_SURE') >= 45, 'offline2× teklif süresi ≥ 45 sn', `${sabit('AD_OFFLINE2X_SURE')} sn`)
  bekle(/teklifGoster\('gun2x'[^\n]*sure: AD_GUN2X_SURE/.test(main_ts) && /teklifGoster\('offline2x'[^\n]*sure: AD_OFFLINE2X_SURE/.test(main_ts), 'süre sabitleri gerçekten kullanılıyor')
  bekle(!/sure: 22\b/.test(main_ts), 'eski 22 sn sabiti kalmadı')
  // 2) izlenen videodan sonra nefes ≥ 45 sn (yorgunluk/eCPM); zaman aşımı ve premium-otomatik kısa kalır
  bekle(sabit('AD_IZLEME_NEFESI') >= 45 && /teklifKapat\(\)\n\s*adCooldown = AD_IZLEME_NEFESI/.test(main_ts), 'izleme sonrası nefes ≥ 45 sn', `${sabit('AD_IZLEME_NEFESI')} sn`)
  bekle(/adCooldown = 10/.test(main_ts) && /adCooldown = 5/.test(main_ts), 'zaman aşımı (10) ve premium-otomatik (5) kısa nefes korunuyor')
  // 3) askıya alma: acil efekt teklifi para teklifini kaybettirmez, kapanınca kalan süreyle geri gelir
  bekle(/askidaTeklif = \{ offer: adOffer, kalan: teklifT \}/.test(main_ts), 'acil teklif (tamir/tanker/kurtarma) para teklifini ASKIYA alır')
  bekle(/ACIL_TEKLIFLER[\s\S]*'tamir', 'tanker', 'kurtarma'/.test(main_ts) && /PARA_TEKLIFLERI[\s\S]*'gun2x', 'offline2x', 'hediye'/.test(main_ts), 'askıya alma yalnız acil efekt → para teklifi yönünde')
  bekle(/function teklifKapat\(\)[\s\S]{0,700}a\.kalan > 3[\s\S]{0,200}canOffer\(a\.offer\.id, state\.adUse\)[\s\S]{0,120}adOffer = a\.offer; teklifT = a\.kalan/.test(main_ts), 'kapanışta askıdaki teklif kalan süresiyle geri gelir (tavan yeniden kontrol edilir)')
  // 4) tamir taraması: buton meşgulse arıza İŞARETLENMEZ (teklif kaybolmaz)
  bekle(/function tamirTeklifleriniTara\(\) \{[\s\S]{0,900}if \(adBusy\) return[\s\S]{0,600}tamirTeklifEdildi\.add\(k\)/.test(main_ts), 'tamir teklifi: meşgul buton → işaretleme yok, sonraki taramada tekrar denenir')
  // 5) günlük hediye: hesaplı oyuncuya günde 1, oturum açılışında gecikmeli, tutar dinamik (kârın çeyreği, ≥ ₺500), panelden de erişilir
  bekle(/hediye:\s*\{ kind: 'money',\s*cap: 1/.test(reklam_ts) && /hediye:\s*\{ kind: 'money',\s*cap: 1/.test(reklam_js), 'hediye yerleşimi iki tarafta da para/günde 1')
  bekle(/placement === 'hediye'\) return Math\.min\(req, Math\.round\(rate \* 40\)\)/.test(reklam_js), 'sunucu hediyeyi tepe gelirin 40 sn\'siyle keser (SABİT TUTAR DEĞİL)')
  bekle(/function hediyeTutari[\s\S]{0,200}Math\.max\(500, Math\.round\(Math\.max\(0, son\) \* 0\.25\)\)/.test(main_ts), 'istemci tutarı = dünkü kârın %25\'i, en az ₺500')
  bekle(/if \(adLocalMode\(\)\) return Promise\.resolve\(false\)/.test(main_ts), 'misafire hediye teklifi yok (para ödülü hesap ister)')
  bekle(sabit('AD_HEDIYE_GECIKME') >= 8 && /hediyeGecikmeT <= 0 && !adOffer && !adBusy && adCooldown <= 0/.test(main_ts), 'hediye gecikmeli ve sahne boşken çıkar (offline raporunu ezmez)', `${sabit('AD_HEDIYE_GECIKME')} sn`)
  bekle(/case 'hediye': return t\('Günlük hediye: \+₺\{0\} · \{1\}'/.test(main_ts) && /case 'hediye':\n\s*state\.money \+= amount/.test(main_ts), 'hediye etiketi net tutarı yazar, ödül kasaya gider')
  bekle(/satir\('hediye', 'i-coin'/.test(main_ts) && /if \(id === 'hediye'\) \{[\s\S]{0,300}offerHediye\(\)/.test(main_ts), 'Ofis paneli hediye satırı: doğrudan video değil, bilet → sahne butonu (tutar görünür)')
  // 6) hedefler tek yerde ve rapor uçta
  bekle(/export const HEDEFLER = \{ viewsPerActivePerDay: 2\.5, optInRate: 0\.35, completeRate: 0\.55, softDailyMaxPerPlayer: 8 \}/.test(reklam_js), 'hedefler: 2,5 izlenme/aktif/gün · opt-in %35 · tamamlama %55 · yumuşak tavan 8')
  const capToplam = [...reklam_js.matchAll(/^\s{2}\w+:\s*\{ kind:\s*'\w+',\s*cap: (\d+)/gm)].reduce((a, m) => a + Number(m[1]), 0)
  bekle(capToplam <= 30, 'yerleşim tavanları toplamı ≤ 30/gün (sert üst sınır)', `${capToplam}`)
}

console.log('\n── WEB\'DE REKLAM YOK (4 Eyl 2026): teklifler yalnız Android/iOS ──')
{
  // Tek kapı: her yüzey (sahne butonu, askıda teklif, günlük hediye, Ofis › Fırsatlar) reklamAktif()'ten geçer;
  // o da tarayıcıda (adsPlatform()==='web') premium değilse false. Boş panelin "Fırsatlar" başlığı da gizlenir.
  bekle(/const reklamAktif = \(\) => !isFullMode && !isPromoMode && \(adsPlatform\(\) !== 'web' \|\| isPremium\(\)\)/.test(main_ts), 'reklamAktif web\'de kapalı (premium hariç)')
  bekle(/import \{[^}]*adsPlatform[^}]*\} from '\.\/ads'/.test(main_ts), 'main.ts adsPlatform\'u ./ads\'ten alıyor')
  for (const fn of ['teklifGoster', 'tickAdOffer', 'renderReklamPaneli']) {
    const i = main_ts.indexOf(`function ${fn}(`); const govde = main_ts.slice(i, i + 400)
    bekle(i > 0 && /reklamAktif\(\)/.test(govde), `${fn} reklamAktif() kapısından geçiyor`)
  }
  bekle(/if \(!reklamAktif\(\)\) \{ el\.innerHTML = ''; if \(baslik\) baslik\.style\.display = 'none'; return \}/.test(main_ts), 'Fırsatlar başlığı panel boşken gizli')
  bekle(/if \(adsPlatform\(\) === 'web' && !isPremium\(\)\) return false/.test(reklam_ts), 'reklam.ts canOffer web\'de false')
  bekle(/const WEB_ADSENSE = false/.test(ads_ts) && /if \(!WEB_ADSENSE \|\| !cfg\.adsensePub/.test(ads_ts), 'ads.ts tarayıcıda AdSense scriptini yüklemiyor')
  bekle(/body\.platform \|\| ''\) === 'web' && !premium\) return \{ code: 200, data: \{ ok: false, reason: 'platform' \} \}/.test(reklam_js), 'sunucu web biletini reddediyor (premium hariç)')
}

console.log(hata ? `\n❌ ${hata} HATA` : '\n✅ TÜM TESTLER GEÇTİ')
process.exit(hata ? 1 : 0)
