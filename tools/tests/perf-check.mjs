/**
 * PERFORMANS REGRESYON TESTİ — 30 Ağu optimizasyonları geri gelmesin.
 *
 * Ölçüm (canlı sürüm, dolu istasyon): 971 mesh · 621 materyal · 911 geometri, üstüne
 * gölge haritası her karede sıfırdan çiziliyordu → sahne fiilen İKİ KEZ çiziliyor.
 * Oyuncu kanıtı: "işlemci neredeyse fullde" (#105), "iyi bilgisayarım var ama 30fps
 * altında" (#813), "iphone'da da mac air'de de inanılmaz ısı" (#752), "başlarda
 * ısıtmıyordu şimdi baya ısınıyor" (#959).
 *
 * Bu test kodun o hâle geri dönmediğini doğrular. Sayısal ölçüm için: tools/_perf.mjs
 */
import { readFileSync } from 'node:fs'
let hata = 0
const bekle = (k, ad, ek = '') => { console.log(`${k ? '✅' : '❌'} ${ad}${ek ? ' · ' + ek : ''}`); if (!k) hata++ }
const oku = f => readFileSync(new URL('../../' + f, import.meta.url), 'utf8')
const main = oku('src/main.ts'), world = oku('src/world.ts'), cars = oku('src/cars.ts'), plat = oku('src/platform.ts')

// ── 1) GÖLGE DONDURMA (en yüksek kazançlı adım) ──
bekle(/renderer\.shadowMap\.autoUpdate = false/.test(main),
  'gölge haritası dondurulmuş (her kare yeniden çizilmiyor)')
bekle(/renderer\.shadowMap\.needsUpdate = true/.test(main),
  'ilk karede gölge bir kez çiziliyor')
bekle(/function golgeTazele\(\)/.test(main),
  'sahne değişiminde gölgeyi tazeleyen yardımcı var')
const tazeSayisi = (main.match(/golgeTazele\(\)/g) || []).length
bekle(tazeSayisi >= 5, `gölge tazeleme sahne değişimlerine bağlı (${tazeSayisi} çağrı)`)
for (const [fn, ad] of [['buildVisual', 'yapı kurulunca'], ['removeBuildingVisual', 'yapı yıkılınca'],
                        ['rebuildFromState', 'şube/kayıt yüklenince']]) {
  const i = main.indexOf(`function ${fn}(`)
  bekle(i > 0 && main.slice(i, i + 400).includes('golgeTazele()'), `${ad} gölge tazeleniyor`)
}

// ── 2) HAREKETLİ NESNE GÖLGE VERMEZ (donmuş haritada hayalet gölge kalmasın) ──
bekle(!/castShadow = true/.test(cars),
  'araçlar/tekneler gölge vermiyor (donmuş haritada gölge yerinde kalırdı)')

// ── 3) MATERYAL PAYLAŞIMI (621 → ~220) ──
bekle(/const matKese = new Map<number, THREE\.MeshLambertMaterial>\(\)/.test(world),
  'materyal önbelleği var')
bekle(/let m = matKese\.get\(color\)/.test(world),
  'lam() aynı renkte AYNI materyali paylaşıyor')
bekle(!/const lam = \(color: number\) => new THREE\.MeshLambertMaterial/.test(world),
  'her çağrıda yeni materyal üreten eski hâl geri gelmemiş')

// ── 4) GEOMETRİ PAYLAŞIMI (911 → ~619) ──
bekle(/const BIRIM_KUTU = new THREE\.BoxGeometry\(1, 1, 1\)/.test(world),
  'birim kutu geometrisi paylaşılıyor')
bekle(/const birimSilindir = \(segment: number\)/.test(world),
  'birim silindir geometrisi paylaşılıyor')
bekle(/new THREE\.Mesh\(BIRIM_KUTU, mat \?\? lam\(color\)\)/.test(world),
  'box() paylaşılan geometri + scale kullanıyor')
bekle(!/new THREE\.Mesh\(new THREE\.BoxGeometry\(w, d, h\)/.test(world),
  'box() her çağrıda yeni geometri üretmiyor')
bekle(/new THREE\.Mesh\(birimSilindir\(16\), lam\(color\)\)/.test(world),
  'cyl() paylaşılan geometri + scale kullanıyor')

// ── 5) MOBİLDE LIGHT MOD (bloom/AA/gölge kapalı, pixelRatio 1) ──
bekle(/export function isMobileDevice\(\)/.test(plat), 'mobil cihaz tespiti var')
bekle(/return isInstantGames\(\) \|\| isMobileDevice\(\)/.test(plat),
  'LIGHT mod mobili de kapsıyor (eskiden yalnız Meta Instant Games)')
bekle(/cap\?\.getPlatform\?\.\(\)/.test(plat) && /plat === 'ios' \|\| plat === 'android'/.test(plat),
  'Capacitor (iOS/Android uygulaması) tanınıyor')
bekle(/LIGHT \? 1 : 1\.5/.test(main),
  'LIGHT modda pixelRatio 1.0 (iPhone dpr=3 → doldurma maliyeti 2.25x düşer)')
bekle(/antialias: !LIGHT/.test(main), 'LIGHT modda antialias kapalı')
bekle(/shadowMap\.enabled = !LIGHT/.test(main), 'LIGHT modda gölge kapalı')

// ── 6) WEBGL GUARD korunuyor (merge sırasında kaybolmasın) ──
bekle(/function showWebGLFailure/.test(main), 'WebGL hata ekranı duruyor')
bekle(/catch \(err\) \{\s*\n\s*showWebGLFailure\(err\)/.test(main), 'renderer kurulumu guard içinde')

console.log(hata ? `\n${hata} HATA` : '\nPERFORMANS TEMİZ')
process.exit(hata ? 1 : 0)
