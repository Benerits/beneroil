/**
 * OTOPARK TESTİ — "araçlar üst üste biniyor" (#107 #139 #198 #252 #320, 5 ayrı oyuncu).
 *
 * KÖK NEDEN (ölçüldü): park yeri aralığı 1.02 birimdi, araç genişlikleri 1.05 / 1.10 / 1.20.
 * Yani araçlar fiziksel olarak yan yana SIĞMIYORDU. Oyuncular bunu otoparkı döndürünce
 * fark ettiği için "yön değişince bozuluyor" sanılıyordu; aslında her zaman böyleydi.
 *
 * Ayrıca çizim ve trafik park noktalarını AYRI hesaplıyordu (world.ts'te iki farklı
 * "-1.53 + i * 1.02" ifadesi). Artık tek kaynak: parkYerX().
 */
import { readFileSync } from 'node:fs'
let hata = 0
const bekle = (k, ad, ek = '') => { console.log(`${k ? '✅' : '❌'} ${ad}${ek ? ' · ' + ek : ''}`); if (!k) hata++ }
const oku = f => readFileSync(new URL('../../' + f, import.meta.url), 'utf8')
const world = oku('src/world.ts'), cars = oku('src/cars.ts'), main = oku('src/main.ts')

// ── araç genişlikleri koddan okunur (kaynak: cars.ts SPEC tablosu) ──
const genislikler = [...cars.matchAll(/width:\s*([\d.]+)/g)].map(m => Number(m[1])).filter(w => w > 0.5 && w < 3)
const enGenis = Math.max(...genislikler)
console.log(`  araç genişlikleri: ${genislikler.join(' / ')} → en geniş ${enGenis}`)

// ── park aralığı ──
const arl = world.match(/export const PARK_ARALIK = ([\d.]+)/)
bekle(!!arl, 'PARK_ARALIK sabiti tanımlı')
const aralik = arl ? Number(arl[1]) : 0
bekle(aralik > enGenis, `park aralığı (${aralik}) en geniş araçtan (${enGenis}) BÜYÜK — araçlar sığıyor`,
  `pay ${(aralik - enGenis).toFixed(2)} birim`)
bekle(aralik >= 1.2, `aralık makul (${aralik} ≥ 1.20)`)

// ── tek kaynak: çizim ve trafik aynı fonksiyondan okuyor ──
bekle(/export const parkYerX = \(i: number\)/.test(world), 'park noktası tek fonksiyondan hesaplanıyor')
bekle(/box\(0\.72, 0\.13, 0\.1, 0xd8dbde, parkYerX\(i\)/.test(world),
  'stoperler parkYerX() kullanıyor (çizim)')
bekle(/const lx = parkYerX\(i\)/.test(world), 'trafik park noktaları parkYerX() kullanıyor')
bekle(!/-1\.53 \+ i \* 1\.02/.test(world), 'eski elle yazılmış aralık kalmamış')

// ── pad ve footprint aralıkla tutarlı ──
const yer = Number((world.match(/export const PARK_YER = (\d+)/) || [])[1] || 0)
const padW = yer * aralik
bekle(/export const PARK_PAD_W = PARK_YER \* PARK_ARALIK/.test(world),
  `pad genişliği aralıktan türüyor (${yer} yer × ${aralik} = ${padW.toFixed(1)})`)
const fp = main.match(/parking: \(\) => \(\{ w: ([\d.]+), d: ([\d.]+) \}\)/)
bekle(!!fp && Number(fp[1]) >= padW, `yerleştirme alanı pad'i kapsıyor (footprint ${fp?.[1]} ≥ pad ${padW.toFixed(1)})`)

// ── park açısı otoparkın dönüşünü izliyor (döndürme şikayetinin ikinci yarısı) ──
bekle(/rot: g\.rotation\.z - Math\.PI \/ 2/.test(world),
  'park açısı otoparkın rotasyonundan türüyor (araç yan park etmiyor)')
bekle(/car\.group\.rotation\.z = sp\.rot/.test(cars), 'araç park ederken o açıya oturuyor')
bekle(/applyMatrix4\(g\.matrixWorld\)/.test(world),
  'park noktaları dünya matrisiyle dönüyor (otopark döndürülünce noktalar da döner)')

// ── R tuşu keşfedilebilirliği (#918 "hangi harfle döndürülüyor") ──
bekle(/R tuşu ya da ⟳ DÖNDÜRÜR/.test(main), 'yerleştirme ipucunda R tuşu yazıyor')
const html = oku('index.html')
bekle(/title="Döndür \(R tuşu\)"/.test(html), 'döndür butonunun ipucunda R yazıyor')
bekle(/>R<\/span>/.test(html), 'döndür butonunun üstünde R harfi görünüyor')

console.log(hata ? `\n${hata} HATA` : '\nOTOPARK & DÖNDÜRME TEMİZ')
process.exit(hata ? 1 : 0)
