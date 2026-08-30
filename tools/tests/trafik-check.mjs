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

// ── #1028: iç bekleme koridoru ──
const off = cars.match(/const WAIT_OFFSETS = \[([^\]]+)\]/)
const sayilar = off ? off[1].split(',').map(x => Number(x.trim())) : []
bekle(sayilar.length >= 8, `iç bekleme yuvası ${sayilar.length} (eskiden 4 — kuyruk artık İÇERİDE)`)
bekle(sayilar.every((v, i) => i === 0 || v > sayilar[i - 1]), 'yuvalar kapıdan içeri doğru artan sırada')
bekle(new Set(sayilar).size === sayilar.length, 'iki yuva aynı noktaya düşmüyor')
// MERGE (30 Ağu): yuva sayısı artık ŞUBEYE GÖRE. Kara 8 yuva (bu fix), marina 4 —
// tekne boyu (süperyat 8.5 birim) 8 yuvaya sığmıyor, sabit 8 kullanılsaydı 5+ tekne
// aynı offsete binip "tekneler iç içe giriyor" bugu geri gelirdi.
bekle(/private waitSlotCount\(st: 'near' \| 'far'\)/.test(cars),
  'yuva sayısı şubeye göre hesaplanıyor (waitSlotCount)')
bekle(/WAIT_OFFSETS_WATER\.length : WAIT_OFFSETS\.length/.test(cars),
  'su şubesi kendi yuva sayısını kullanıyor (tekne kuyruğu korunuyor)')
bekle(/cap = Math\.max\(1, idx\.length \+ this\.waitSlotCount\(st\)\)/.test(cars),
  'istasyon kapasitesi bekleme yuvalarını sayıyor — dolu sanılıp müşteri geri çevrilmiyor')
bekle(/for \(let i = 0; i < this\.waitSlotCount\(car\.station\); i\+\+\)/.test(cars),
  'yuva arama döngüsü de şube farkındalıklı (marinada 5. tekne üst üste binmiyor)')

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
bekle(/softPassT/.test(cars), 'sıkışma bekçisi (softPassT) duruyor')
bekle(/stuckHits/.test(cars), 'üst üste sıkışma sayacı duruyor')
bekle(/rampBusy/.test(cars), 'giriş rampası tek araç kuralı duruyor (apron kilitlenmesin)')

console.log(hata ? `\n${hata} HATA` : '\nTRAFİK TEMİZ')
process.exit(hata ? 1 : 0)
