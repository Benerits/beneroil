/**
 * ARAYÜZ · SES · MOBİL TESTİ — J, K, H grupları.
 *
 *  #1020 "bir şeye tıkladığımızda sol altta çıkıyor, onu direkt onun üstünde popup
 *        olarak çıkarsak daha güzel olur"      → kart seçilen yapıya tutunuyor
 *  #1035 "arkada çalması için türkçe şarkı"    → lisanslı şarkı paketleyemiyoruz; melodi
 *        tek pentatonikten çıkıp makam dizilerine (hicaz/nihavend) açıldı
 *  #1057 "dizel jeneratörünün sesi çok yüksek" → kazanç üçte birine indi
 *  #1076 "mobilde görünen ofis grubu neden web pc'de görünmüyor" → masaüstü Ofis butonu
 */
import { readFileSync } from 'node:fs'
let hata = 0
const bekle = (k, ad) => { console.log(`${k ? '✅' : '❌'} ${ad}`); if (!k) hata++ }
const oku = f => readFileSync(new URL('../../' + f, import.meta.url), 'utf8')
const html = oku('index.html'), ana = oku('src/main.ts'), ui = oku('src/ui.ts'), ses = oku('src/audio.ts')

// ── #1020 bilgi kartı yapının üstünde ──
bekle(/anchorInfoCard\(\)/.test(ui), 'kart konumlandırıcı (anchorInfoCard) var')
bekle(/setCardAnchor\(p: \{ x: number; y: number \} \| null\)/.test(ui), 'dışarıdan tutunma noktası verilebiliyor')
bekle(/const dar = window\.matchMedia\('\(max-width: 820px\)'\)\.matches/.test(ui),
  'mobilde CSS alt-sheet düzeni korunuyor (parmağın altında kart açılmıyor)')
bekle(/if \(y < g\) y = Math\.min\(this\.cardAnchor\.y \+ 24/.test(ui),
  'üstte yer yoksa kart yapının ALTINA düşüyor (ekran dışına taşmıyor)')
bekle(/x = Math\.max\(g, Math\.min\(x, window\.innerWidth - k\.width - g\)\)/.test(ui),
  'kart yatayda ekran içine kelepçeleniyor')
bekle(/this\.cardAnchor = null/.test(ui), 'kart kapanınca tutunma noktası bırakılıyor')
bekle(/function binaEkranNoktasi\(id: string\)/.test(ana), 'yapının ekran koordinatı hesaplanıyor')
bekle(/if \(p\.z > 1\) return null/.test(ana), 'kamera arkasındaki yapı için konum üretilmiyor')
bekle(/if \(selectedBuilding && ui\.buildingCardVisible\) ui\.setCardAnchor/.test(ana),
  'kamera kaydıkça kart yapıyla birlikte kayıyor')

// ── #1076 masaüstü ofis butonu ──
bekle(/id="officebtn"/.test(html), 'masaüstü HUD\'ında Ofis butonu var')
bekle(/#closebtn, #orderbtn, #shopbtn, #accbtn, #officebtn \{ display: none !important; \}/.test(html),
  'mobilde gizleniyor (orada navbar zaten var — çift buton olmuyor)')
bekle(/getElementById\('officebtn'\)\?\.addEventListener\('click', \(\) => openSection\('office'\)\)/.test(ana),
  'buton ofis panelini açıyor (mobil navbar ile AYNI akış)')
bekle(/getElementById\('questchip'\)\?\.addEventListener\('click', \(\) => \{\s*openSection\('office'\)/.test(ana),
  'görev rozeti de aynı openSection akışını kullanıyor (is-on değil, show sınıfı)')

// ── #1057 jeneratör sesi ──
const dz = ses.match(/gain\.gain\.linearRampToValueAtTime\(([\d.]+), ctx\.currentTime \+ 0\.8\)/)
bekle(!!dz, 'dizel jeneratör kazancı okunabiliyor')
if (dz) {
  const v = Number(dz[1])
  bekle(v <= 0.02, `jeneratör kazancı ${v} (eskiden 0.055 — üçte birine indi)`)
  bekle(v > 0, 'tamamen susturulmadı: gürültü mekaniği (EV müşterisini kaçırma) duruyor')
}

// ── #1035 müzik çeşitliliği ──
bekle(/const DIZILER: number\[\]\[\]/.test(ses), 'birden fazla melodi dizisi tanımlı')
bekle(/hicaz/.test(ses) && /nihavend/.test(ses), 'Türk müziği dizileri (hicaz, nihavend) var')
const diz = ses.match(/const DIZILER: number\[\]\[\] = \[([\s\S]*?)\n    \]/)
bekle(diz && (diz[1].match(/\[/g) || []).length >= 4, 'en az 4 dizi var')
bekle(/const dizi = \(bar: number\) => DIZILER\[Math\.floor\(bar \/ 8\) % DIZILER\.length\]/.test(ses),
  'dizi 8 barda bir değişiyor — aynı ezgi sonsuza dek tekrarlanmıyor')
bekle(/\[0, 3, 5, 7, 10, 12\]/.test(ses), 'eski pentatonik dizi korundu (mevcut his bozulmadı)')
bekle(!/PENTA/.test(ses), 'tek sabit dizi kalıntısı temizlendi')

console.log(hata ? `\n${hata} HATA` : '\nARAYÜZ · SES · MOBİL TEMİZ')
process.exit(hata ? 1 : 0)
