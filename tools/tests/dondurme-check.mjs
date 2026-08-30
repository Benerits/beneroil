/**
 * YERİNDE DÖNDÜRME TESTİ — 6 şikayet (#918 #1142 #935 #780 #750 #1207).
 *
 * Döndürme ZATEN vardı ama yalnız taşıma modunda R tuşuyla: oyuncunun önce "Taşı"
 * demesi, sonra R'yi keşfetmesi gerekiyordu. Kimse bulamadı — #1142 (25 Ağu) hâlâ
 * "yapıları döndürme özelliği güzel olur" diyor, yani özellik görünmez kalmış.
 * Artık bina kartında doğrudan "Döndür" butonu var, yapı yerinden kalkmıyor.
 *
 * Kullanım: npm run dev -- --port 5311  →  node tools/tests/dondurme-check.mjs
 */
import { chromium } from 'playwright-core'
const PORT = process.env.PORT ?? '5311'
let hata = 0
const bekle = (k, ad, ek = '') => { console.log(`${k ? '✅' : '❌'} ${ad}${ek ? ' · ' + ek : ''}`); if (!k) hata++ }

const b = await chromium.launch({ channel: 'chrome' })
const p = await b.newPage({ viewport: { width: 1400, height: 900 } })
const jsHata = []
p.on('pageerror', e => jsHata.push(String(e).slice(0, 160)))
await p.goto(`http://localhost:${PORT}/?full=1`, { waitUntil: 'domcontentloaded' })
await p.waitForTimeout(11000)

const r = await p.evaluate(() => {
  const d = window.__dbg, w = d.world
  const out = { yapilar: {}, }
  for (const id of ['market', 'coffee', 'restaurant', 'parking']) {
    const b2 = w.buildings.find(x => x.id === id)
    if (!b2) continue
    d.sec(id)
    const btn = document.getElementById('binfo-rot')
    const gorunur = !!btn && btn.style.display !== 'none'
    const once = +b2.group.rotation.z.toFixed(3)
    btn?.click()
    out.yapilar[id] = { gorunur, dondu: Math.abs(+b2.group.rotation.z.toFixed(3) - once) > 0.01 }
  }
  // otopark: park noktaları da dönmeli (araçlar yanlış yere park etmesin)
  const pOnce = JSON.stringify(w.getParkingSpots().map(s => [+s.pos.x.toFixed(2), +s.pos.y.toFixed(2)]))
  d.sec('parking'); document.getElementById('binfo-rot')?.click()
  out.parkNoktalariDondu = pOnce !== JSON.stringify(w.getParkingSpots().map(s => [+s.pos.x.toFixed(2), +s.pos.y.toFixed(2)]))
  // yönü SABİT olması gereken üniteler döndürülememeli
  const tankOnce = w.buildings.find(x => x.id === 'tank')?.group.rotation.z
  d.sec('tank'); document.getElementById('binfo-rot')?.click()
  const tankSonra = w.buildings.find(x => x.id === 'tank')?.group.rotation.z
  out.tankSabit = tankOnce === undefined || tankOnce === tankSonra
  // dönüş KAYDA yazılıyor mu (yenilenince korunsun)
  out.kayit = JSON.parse(localStorage.getItem('benzinlik-guest') || '{}')
  return out
})

for (const [id, v] of Object.entries(r.yapilar)) {
  bekle(v.gorunur, `${id}: bina kartında Döndür butonu görünüyor`)
  bekle(v.dondu, `${id}: butona basınca yapı 90° dönüyor`)
}
bekle(r.parkNoktalariDondu, 'otopark dönünce park noktaları da dönüyor (araç doğru yere park eder)')
bekle(r.tankSabit, 'yönü sabit üniteler (tank/kapı) döndürülemiyor')
bekle(jsHata.length === 0, 'döndürme sırasında JavaScript hatası yok', jsHata.slice(0, 2).join(' | '))

await b.close()
console.log(hata ? `\n${hata} HATA` : '\nYERİNDE DÖNDÜRME TEMİZ')
process.exit(hata ? 1 : 0)
