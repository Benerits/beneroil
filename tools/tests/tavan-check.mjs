/**
 * TAVAN DÜRÜSTLÜĞÜ TESTİ — "sınırsız kurulur" diyen ama aslında tavanlı satırlar.
 *
 * ÖNCESİ (gerçek oyuncu parası yanıyordu):
 *  · Hava-Su satırı "sınırsız kurulur" diyordu ama gelir main.ts'te `Math.min(6, adet)`
 *    ile çarpılıyordu → 7. ünite tam parasına satılıp ₺0 kazandırıyordu. Üstelik kodun
 *    kendi yorumu "pendingCap'in min(6) ölçeğiyle aynı tavan" diyordu; kumbara tavanı
 *    SAYAC_KUMBARA_MAX=12'ye çıkarılınca bu hizalama sessizce bozulmuştu.
 *  · Sokak Lambası satırı "sınırsız kurulur, +itibar" diyordu ama katkı 0.30'da
 *    doyuyordu → 9. lamba ₺2.500'e sıfır getiri.
 *  · Gün raporu "kâr ₺X" derken kumbaradaki toplanmamış parayı hiç anmıyordu; oyuncu
 *    tesislerin kazandığını görüp raporda bulamayınca "para kayboluyor" diyordu.
 *
 * BU TEST metin ile formülün bir daha ayrışmamasını bekçiliyor.
 *
 * Kullanım: npx tsx tools/tests/tavan-check.mjs
 */
globalThis.localStorage = {
  _d: {}, getItem(k) { return this._d[k] ?? null },
  setItem(k, v) { this._d[k] = String(v) }, removeItem(k) { delete this._d[k] },
}
Object.defineProperty(globalThis, 'navigator', { value: { language: 'tr' }, configurable: true })
import { readFileSync } from 'node:fs'
const { GameState, getShopItems, SAYAC_KUMBARA_MAX, LAMP_REP_PER, LAMP_REP_CAP, LAMP_REP_MAX_COUNT }
  = await import('../../src/state.ts')

let hata = 0
const bekle = (k, ad, ek = '') => { console.log(`${k ? '✅' : '❌'} ${ad}${ek ? ' · ' + ek : ''}`); if (!k) hata++ }
const oku = f => readFileSync(new URL('../../' + f, import.meta.url), 'utf8')
const main_ts = oku('src/main.ts')
const state_ts = oku('src/state.ts')
const satir = (s, id) => getShopItems(s).find(r => r.id === id)

console.log('── HAVA-SU: GELİR TAVANI KUMBARA TAVANIYLA AYNI ──')
bekle(!/Math\.min\(6, state\.airWaterCount\)/.test(main_ts),
  'gelir çarpanında sabit 6 KALMADI (kumbara tavanıyla ayrışan sayı)')
bekle(/Math\.min\(SAYAC_KUMBARA_MAX, state\.airWaterCount\)/.test(main_ts),
  'gelir çarpanı SAYAC_KUMBARA_MAX\'tan türetiliyor', `tavan ${SAYAC_KUMBARA_MAX}`)
// tek sabitten türeme: kumbara tavanı ile gelir tavanı artık tanım gereği eşit
const s = new GameState()
s.airWaterCount = SAYAC_KUMBARA_MAX
const kumbaraTavan = s.pendingCap('airwater')
s.airWaterCount = SAYAC_KUMBARA_MAX + 4
bekle(s.pendingCap('airwater') === kumbaraTavan,
  'kumbara tavanı da aynı noktada duruyor (ikisi hizalı)')

console.log('\n── MAĞAZA METNİ TAVANI SÖYLÜYOR ──')
const s2 = new GameState()
s2.airWaterCount = 2
const air = satir(s2, 'airwater')
bekle(!!air, 'hava-su satırı mağazada var')
bekle(!/sınırsız/i.test(air?.desc ?? ''), 'hava-su artık "sınırsız" DEMİYOR', air?.desc?.slice(0, 60))
bekle((air?.desc ?? '').includes(String(SAYAC_KUMBARA_MAX)),
  'hava-su metninde gerçek tavan yazıyor', String(SAYAC_KUMBARA_MAX))
s2.airWaterCount = SAYAC_KUMBARA_MAX
bekle(/tavan/i.test(satir(s2, 'airwater')?.desc ?? ''),
  'tavana ulaşınca metin AÇIKÇA uyarıyor (boşa para yok)')

const s3 = new GameState()
s3.lampCount = 2
const lamp = satir(s3, 'lamp')
bekle(!/sınırsız/i.test(lamp?.desc ?? ''), 'lamba artık "sınırsız" DEMİYOR', lamp?.desc?.slice(0, 60))
bekle((lamp?.desc ?? '').includes(String(LAMP_REP_MAX_COUNT)),
  'lamba metninde itibar tavanı yazıyor', `${LAMP_REP_MAX_COUNT} lamba`)
s3.lampCount = LAMP_REP_MAX_COUNT
bekle(/doldu/i.test(satir(s3, 'lamp')?.desc ?? ''), 'tavan dolunca metin bunu söylüyor')

console.log('\n── LAMBA SABİTLERİ METİNLE TUTARLI ──')
bekle(LAMP_REP_PER * LAMP_REP_MAX_COUNT >= LAMP_REP_CAP,
  'metinde yazan adet tavanı GERÇEKTEN dolduruyor',
  `${LAMP_REP_PER}×${LAMP_REP_MAX_COUNT} = ${(LAMP_REP_PER * LAMP_REP_MAX_COUNT).toFixed(2)} ≥ ${LAMP_REP_CAP}`)
bekle(LAMP_REP_PER * (LAMP_REP_MAX_COUNT - 1) < LAMP_REP_CAP,
  'bir eksiği tavanı DOLDURMUYOR (sayı fazla büyük yazılmamış)')
bekle(/Math\.min\(LAMP_REP_CAP, LAMP_REP_PER \* this\.lampCount\)/.test(state_ts),
  'decorRep sabitlerden türüyor (metin ↔ formül tek kaynak)')
const l = new GameState()
l.lampCount = LAMP_REP_MAX_COUNT
const doymus = l.decorRep()
l.lampCount = LAMP_REP_MAX_COUNT + 10
bekle(l.decorRep() === doymus, 'tavandan sonra itibar GERÇEKTEN artmıyor (metin doğru)')
bekle(doymus > new GameState().decorRep(), 'tavana kadar itibar GERÇEKTEN artıyor (metin doğru)')

console.log('\n── GÜN RAPORU: TOPLANMAMIŞ KUMBARA AYRICA SÖYLENİYOR ──')
bekle(/Kumbaralarda ₺\{0\} toplanmayı bekliyor/.test(main_ts),
  'rapor bekleyen kumbara tutarını yazıyor')
bekle(/DAHİL DEĞİL/.test(main_ts), 'kâra dahil OLMADIĞI açıkça yazıyor')
// yalnız para varken çıkmalı — boş kumbarada gereksiz mesaj olmasın
bekle(/if \(kumbara > 0\)/.test(main_ts), 'bekleyen para yokken mesaj çıkmıyor')

console.log('\n── DENGE BOZULMADI ──')
// tavanları AÇIKLADIK, kaldırmadık: itibar hâlâ lambayla sınırsız şişirilemiyor
bekle(LAMP_REP_CAP <= 0.30, 'lamba itibar tavanı YÜKSELTİLMEDİ', `${LAMP_REP_CAP}`)
const eski = new GameState()
bekle(eski.decorRep() === 0, 'lambasız/dekorsuz oyuncuda hiçbir değişiklik yok')

console.log(hata ? `\n${hata} HATA` : '\nTAVAN DÜRÜSTLÜĞÜ TEMİZ')
process.exit(hata ? 1 : 0)
