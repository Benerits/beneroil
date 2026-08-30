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
bekle(/return rotayiTemizle\(ham\)/.test(cars), 'giriş rotası temizleyiciden geçiyor')
bekle(/tur < 2/.test(cars), 'yineleme SINIRLI (sonsuz döngü yok)')
bekle(/if \(!Car\.solids\.length \|\| yol\.length < 2\) return yol/.test(cars),
  'engel yoksa rota AYNEN dönüyor (sıfır maliyet)')

// ── davranış: kesişim matematiği doğru mu ──
console.log('\n── KESİŞİM MATEMATİĞİ ──')
const src = cars.slice(cars.indexOf('function segmentDikdortgeniKesiyor'),
                       cars.indexOf('export interface CarManagerOpts'))
const js = src
  .replace(/: *number/g, '').replace(/: *boolean/g, '').replace(/: *THREE\.Vector3\[\]/g, '')
  .replace(/: *\{[^}]*\}/g, '').replace(/pad = 1\.0/, 'pad = 1.0')
  .replace(/const cikti: THREE\.Vector3\[\]/g, 'const cikti')
  .replace(/const yeni: THREE\.Vector3\[\] =/g, 'const yeni =')
  .replace(/const adaylar[\s\S]*?\n/, 'const adaylar = []\n')   // Vector3 gerektiren kısmı atla
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
