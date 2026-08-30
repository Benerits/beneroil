/**
 * ENGEL-FARKINDA ROTA TESTİ — oyuncu gözlemi: "araçlar önce pompaya doğru gidiyor,
 * sonra rotasını güncelliyorlar; en baştan çizseler".
 *
 * ÖNCESİ: entryPath 4 SABİT nokta döndürüyordu. Rota bina/pompa üstünden geçse bile
 * araç yola çıkıyor, 1.6 sn ilerleyemeyince `solidStuckT` reaktif kaçış noktası
 * ekliyordu — oyuncunun gördüğü "duruyor, sonra fikir değiştiriyor" davranışı buydu.
 *
 * SONRASI: rota KURULURKEN engeller biliniyor; kesişen segmentin etrafına baştan
 * ara nokta konuyor. A* değil çünkü engeller eksen hizalı dikdörtgen ve layout küçük —
 * segment/dikdörtgen kesişimi aynı sonucu deterministik ve kurulum maliyetsiz veriyor.
 */
import { readFileSync } from 'node:fs'
let hata = 0
const bekle = (k, ad, ek = '') => { console.log(`${k ? '✅' : '❌'} ${ad}${ek ? ' · ' + ek : ''}`); if (!k) hata++ }
const cars = readFileSync(new URL('../../src/cars.ts', import.meta.url), 'utf8')

console.log('── KOD ──')
bekle(/function segmentDikdortgeniKesiyor/.test(cars), 'segment/dikdörtgen kesişim testi var')
bekle(/function rotayiTemizle/.test(cars), 'rota temizleyici var')
bekle(/tur < [1-9]\b/.test(cars), 'yineleme SINIRLI (sonsuz döngü yok)')
bekle(/if \(!Car\.solids\.length \|\| yol\.length < 2\) return yol/.test(cars),
  'engel yoksa rota AYNEN dönüyor (sıfır maliyet)')
bekle(/if \(!Car\.solids\.length \|\| ham\.length === 0\) return ham/.test(cars),
  'önbellekli sarmalayıcı da engelsizken SIFIR maliyet')

// ── TÜM ROTALAR temizleyiciden geçiyor mu ──
// Eskiden yalnız entryPath temizleniyordu; oyuncu "arabalar pompalara takılıyor" dedi.
// Artık her anlamlı setPath çağrısı temizRota()'dan geçmeli. İSTİSNALAR:
//  · transit (yoldan geçen) araç — rotası zaten düz şerit
//  · tırın geri geri park manevrası ve yağ körüğüne giriş (ghostSolid) — kasıtlı
console.log('\n── TÜM ROTALAR ENGEL-FARKINDA MI ──')
const govde = cars.slice(cars.indexOf('export class CarManager'))
const setPathSatirlari = govde.split('\n')
  .map((l, i) => ({ l, i }))
  .filter(x => /\.setPath\(/.test(x.l))
const muaf = [
  /new THREE\.Vector3\(lx, -?44, 0\)/,   // transit: düz şerit
  /\[spot\.clone\(\)\]/,                 // tır: geri geri park manevrası
  /\[inside\.clone\(\)\]/,               // yağ körüğü içi: ghostSolid, duvar yok sayılır
  /hazir \?\? temizRota/,                // önden çizilmiş çıkış rotası (zaten temiz)
]
const kirli = setPathSatirlari.filter(x =>
  !/temizRota\(/.test(x.l) && !muaf.some(r => r.test(x.l)))
bekle(kirli.length === 0, 'her anlamlı setPath temizRota()\'dan geçiyor',
  kirli.length ? kirli.map(x => x.l.trim().slice(0, 60)).join(' | ') : `${setPathSatirlari.length} çağrı tarandı`)

// ── ÖNBELLEK ──
console.log('\n── ROTA ÖNBELLEĞİ ──')
bekle(/const rotaOnbellek = new Map/.test(cars), 'temizlenmiş rota önbelleği var')
bekle(/rotaOnbellek\.clear\(\)/.test(cars), 'yerleşim değişince önbellek boşalıyor')
bekle(/static set solids/.test(cars), 'Car.solids ataması yakalanıyor (imza + boşaltma)')
bekle(/static rotaCacheStats/.test(cars), 'önbellek isabet/ıska telemetrisi var')
bekle(/car\.cikisYolu = temizRota/.test(cars), 'çıkış rotası pompaya VARIRKEN önden çiziliyor')
bekle(/function rotaPadi/.test(cars) && /isTruck \? 1\.35/.test(cars),
  'pay araç genişliğine göre (tır daha geniş)')

// ── davranış: kesişim matematiği doğru mu ──
console.log('\n── KESİŞİM MATEMATİĞİ ──')
// YALNIZ kesişim fonksiyonunu al (THREE gerektirmez) — gövdesi kapanınca kes.
const bas = cars.indexOf('function segmentDikdortgeniKesiyor')
const src = cars.slice(bas, cars.indexOf('\n}\n', bas) + 3)
const js = src
  .replace(/: *number/g, '').replace(/: *boolean/g, '')
  .replace(/: *\{[^}]*\}/g, '')
const kesisiyor = new Function(js + '; return segmentDikdortgeniKesiyor')()

const kutu = { cx: 0, cy: 0, w: 4, d: 4 }   // -2..2 kare
bekle(kesisiyor(-5, 0, 5, 0, kutu, 0) === true, 'kutuyu ortadan geçen doğru KESİYOR')
bekle(kesisiyor(-5, 10, 5, 10, kutu, 0) === false, 'uzaktan geçen doğru kesmiyor')
bekle(kesisiyor(-5, 2.5, 5, 2.5, kutu, 0) === false, 'kenarın hemen dışından geçen kesmiyor (pad 0)')
bekle(kesisiyor(-5, 2.5, 5, 2.5, kutu, 1) === true, 'aynı doğru pad=1 ile KESİYOR (araç genişliği)')
bekle(kesisiyor(0, 0, 1, 1, kutu, 0) === true, 'kutunun İÇİNDEKİ segment kesişiyor')
bekle(kesisiyor(-5, -5, -4, -4, kutu, 0) === false, 'tamamen dışarıdaki segment kesmiyor')
bekle(kesisiyor(-5, -5, 5, 5, kutu, 0) === true, 'çapraz geçen doğru kesiyor')

console.log(hata ? `\n${hata} HATA` : '\nENGEL-FARKINDA ROTA TEMİZ')
process.exit(hata ? 1 : 0)
