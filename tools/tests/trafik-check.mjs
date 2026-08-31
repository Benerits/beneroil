/**
 * ARAÇ / TRAFİK / MÜŞTERİ TESTİ — I grubu (5 şikayet).
 *
 *  #1028 "istasyonda alan olmasına rağmen pompa doluysa sıradaki araç GİRİŞ ALANINDA
 *        bekliyor, içeri gelmiyor"  → iç bekleme koridoru 4 yuvadan 8'e çıktı.
 *  #1019 "toplu olarak sarjcı ve pompacı tutabilsek" + "karşı dükkanlar ters duruyor"
 *  #1023 "elektrikli araba sayısı çok az gibi"
 *  #1009 / #1039 sıkışma: traffic-load.mjs zaten A/B ölçüyor; burada regresyon çiti.
 */
globalThis.localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} }
Object.defineProperty(globalThis, 'navigator', { value: { language: 'tr' }, configurable: true })
const { GameState } = await import('../../src/state.ts')
import { readFileSync } from 'node:fs'
let hata = 0
const bekle = (k, ad) => { console.log(`${k ? '✅' : '❌'} ${ad}`); if (!k) hata++ }

const cars = readFileSync(new URL('../../src/cars.ts', import.meta.url), 'utf8')
const dunya = readFileSync(new URL('../../src/world.ts', import.meta.url), 'utf8')
const ana = readFileSync(new URL('../../src/main.ts', import.meta.url), 'utf8')
const html = readFileSync(new URL('../../index.html', import.meta.url), 'utf8')

// ── #1028: iç bekleme koridoru (kuyruk İÇERİDE) ──
// Sabit WAIT_OFFSETS dizisi kalktı: kuyruk slotları şerit ağından TÜRETİLİYOR.
const grafik = readFileSync(new URL('../../src/traffic-graph.ts', import.meta.url), 'utf8')
const qn = grafik.match(/const qn = g\.wide \? (\d+) : (\d+)/)
bekle(!!qn && Number(qn[2]) >= 8, `iç kuyruk slotu ${qn ? qn[2] : '?'} (dar kapı) / ${qn ? qn[1] : '?'} (geniş kapı)`)
// KUYRUK SIRALAMASI: slot 0 = SIRANIN BAŞI ve akış yönünde EN İLERİDEKİ nokta; kuyruk
// oradan kapıya doğru GERİ dizilir. Ters dizilseydi yeni gelen her araç, önündeki
// sıranın gövdesinden geçerek arkaya giderdi (ölçüldü: T8'de 174 iç içe çift).
bekle(/const y = capa - g\.dirY \* i \* step/.test(grafik),
  'kuyruk slotları BAŞTAN GERİYE diziliyor (kimse kimseyi geçmiyor)')
// MARİNA: tekne boyu (süperyat 8.5 birim) araç aralığına sığmaz — su şubesi 4 geniş slot.
bekle(/QUEUE_STEP_WATER = 9/.test(grafik), 'marina kuyruk aralığı tekne boyuna göre (9 birim)')
bekle(/g\.water \? 4 : qn/.test(grafik), 'su şubesinde 4 slot (tekneler iç içe girmiyor)')
bekle(/private waitSlotCount\(st: 'near' \| 'far'\)/.test(cars),
  'yuva sayısı şubeye göre hesaplanıyor (waitSlotCount)')
bekle(/for \(let i = 0; i < this\.waitSlotCount\(car\.station\); i\+\+\)/.test(cars),
  'yuva arama döngüsü şube farkındalıklı (marinada 5. tekne üst üste binmiyor)')

// ── #1019a: toplu personel alımı ──
bekle(/id="of-staff"/.test(html), 'Ofis › Özet\'te Personel bölümü var')
bekle(/of-hire-pumps/.test(ana) && /of-hire-chargers/.test(ana), 'toplu pompacı/şarjcı butonları var')
bekle(/function topluIseAl\(tur: 'pump' \| 'charger'\)/.test(ana), 'toplu işe alım işlevi mevcut')
bekle(/getElementById\('of-staff'\)\?\.addEventListener/.test(ana),
  'butonlar her render\'da yeniden yazıldığı için dinleyici SABİT kapsayıcıda (delegasyon)')
bekle(/if \(state\.money < bedel\) \{ atlanan\+\+; continue \}/.test(ana),
  'para yetmeyince eksiye düşmüyor, atlananı bildiriyor')

// ── #1019b: karşı yaka dükkanları ──
bekle(/private farFlip\(g: THREE\.Object3D\)/.test(dunya), 'karşı yaka dönüş yardımcısı (farFlip) var')
bekle(/rotation\.z = rot \* Math\.PI \/ 2 \+ this\.farFlip\(b\.group\)/.test(dunya),
  'oyuncu binayı döndürse de karşı yaka flip\'i KAYBOLMUYOR')
bekle(/this\.theme\.lane\.kind === 'water'\) return 0/.test(dunya),
  'marinada flip uygulanmıyor (adanın yol karşısı yok)')
bekle(/&& this\.farFlip\(group\)\)/.test(dunya), 'kurulum anında da doğru yöne bakıyor')

// ── #1023: EV payı ──
const ev = ana.match(/evShare: \(\) => \(state\.evChargers > 0 \? Math\.min\(([\d.]+), ([\d.]+) \+ ([\d.]+) \* state\.evChargers\)/)
bekle(!!ev, 'evShare formülü okunabiliyor')
if (ev) {
  const [, tavan, taban, adim] = ev.map(Number)
  bekle(taban >= 0.20, `EV tabanı %${Math.round(taban * 100)} (eskiden %15)`)
  bekle(adim >= 0.11, `ünite başı katkı %${Math.round(adim * 100)} (eskiden %9)`)
  bekle(tavan >= 0.55, `tavan %${Math.round(tavan * 100)} (eskiden %50)`)
  const s = new GameState()
  const pay = n => Math.min(tavan, taban + adim * n) * s.evPriceFactor()
  bekle(pay(1) > 0.20, `1 şarj ünitesiyle akışın %${Math.round(pay(1) * 100)}'i EV`)
  bekle(pay(4) > pay(1), `4 ünitede %${Math.round(pay(4) * 100)} — yatırım sahnede görünüyor`)
  bekle(pay(99) <= tavan * 1.26, 'tavan korunuyor — istasyon tamamen EV\'ye dönmüyor')
}

// ── regresyon çiti: sıkışma sigortaları yerinde mi (#1009 / #1039) ──
// ── regresyon çiti: ŞERİT AĞI mimarisi (ajan müzakeresi GERİ GELMESİN) ──
// Aşağıdaki katmanlar bilerek silindi. Biri geri eklenirse bu test düşer ve gerekçeyi
// yeniden okumaya zorlar: hepsi "araç bekletildi → kilitlendi" zincirinin panzehiriydi.
// Yorumlarda ADLARI GEÇİYOR (bilerek: neden silindiklerini anlatıyorlar) — bu yüzden
// kontrol YORUMSUZ kaynak üzerinde yapılır, yoksa kendi açıklamamız testi düşürürdü.
const yorumsuz = t => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')
const carsKod = yorumsuz(cars)
const yasak = ['softPassT', 'stuckHits', 'recoverStuck', 'dodgeRight', 'evaporate(',
  'rampBusy', 'stationCrowdFactor(', 'gorselAyrim', 'tryAcquire', 'waitingForToken']
for (const y of yasak) bekle(!carsKod.includes(y), `müzakere katmanı geri gelmemiş: ${y}`)
bekle(/LaneNetwork/.test(cars), 'şerit ağı (LaneNetwork) kullanılıyor')
bekle(/kuyrukIlerlet/.test(cars), 'kuyruk sabit slotlarda İLERLİYOR (araç slota kayar)')
bekle(/speedScale = Math\.min\(c\.speedScale, Math\.max\(0\.3/.test(cars),
  'hız eşitlemesi tabanı 0 DEĞİL (kimse durmaz → kilitlenme imkânsız)')
const serit = readFileSync(new URL('../../src/traffic-graph.ts', import.meta.url), 'utf8')
bekle(!/tryAcquire|RESERVE_TTL|waitQ/.test(yorumsuz(serit)), 'rezervasyon defteri silinmiş')
bekle(/UNIT_CLEAR/.test(serit) && /LANE_SEP/.test(serit), 'şerit ayrıklığı sabitlerle garanti')

console.log(hata ? `\n${hata} HATA` : '\nTRAFİK TEMİZ')
process.exit(hata ? 1 : 0)
