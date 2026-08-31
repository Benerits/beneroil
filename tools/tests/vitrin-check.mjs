/**
 * VİTRİN MODU TESTİ — ?full=1'de araçlar istasyona GİRİYOR mu?
 *
 * BULUNAN HATA (tanıtım videosu çekerken çıktı): ?full=1 kasayı ₺10.000.000 yapıyor →
 * 'first-10k' başarımı anında açılıyor → misafir KAYIT KAPISI geri geliyor → guestPaused
 * tekrar true oluyor → entryChance 0 → araçlar istasyona HİÇ girmiyor.
 *
 * Ölçüldü (düzeltmeden önce): 8 aracın 8'i 30 saniye boyunca 'transit', pompada 0 araç.
 * Yani vitrin modunda çekilen HER ekran görüntüsü ve HER tanıtım videosu ölü bir istasyon
 * gösteriyordu — arabalar yalnız yoldan geçiyordu. rehberDuyur/rehberNabiz aynı gerekçeyle
 * zaten susturulmuştu; üç dönüşüm kapısında o koruma unutulmuştu.
 *
 * Sonrası: 15 sn'de 4, 25 sn'de 6 araç pompada.
 *
 * Kullanım:  npm run dev -- --port 5399   →   npx tsx tools/tests/vitrin-check.mjs
 */
import { chromium } from 'playwright-core'
import { readFileSync } from 'node:fs'

let pass = 0, fail = 0
const check = (ad, ok, ek = '') => { console.log(`  ${ok ? '✓' : '✗'} ${ad}${ek ? ' — ' + ek : ''}`); ok ? pass++ : fail++ }
const oku = f => readFileSync(new URL('../../' + f, import.meta.url), 'utf8')

console.log('== 1) Kaynak: üç dönüşüm kapısı da vitrinde susturulmuş mu ==')
const main_ts = oku('src/main.ts')
check('tek kaynak guard tanımlı', /const donusumKapisiKapali = \(\) => isFullMode \|\| isPromoMode/.test(main_ts))
// Tanım satırı `const donusumKapisiKapali = () =>` bu kalıba uymaz, yani sayılan şey
// yalnız ÇAĞRILAR. Üç kapı → üç çağrı. (İlk yazdığımda 4 beklemiştim; tanımı da
// sayacağımı sanmıştım — iddia yanlıştı, kod değil.)
const kapiSayisi = (main_ts.match(/donusumKapisiKapali\(\)/g) || []).length
check('üç kapının hepsinde çağrılıyor', kapiSayisi >= 3, `${kapiSayisi} çağrı`)
check('gün-eşiği kapısı korumalı', /function maybeGuestGate\(\) \{\s*\n\s*if \(donusumKapisiKapali\(\)\) return/.test(main_ts))
check('ilk-10k kapısı korumalı', /!donusumKapisiKapali\(\) && !auth\.loggedIn\(\) && !firstTenGateShown/.test(main_ts))
check('ilk-gün kapısı korumalı', /!donusumKapisiKapali\(\) && !auth\.loggedIn\(\) && state\.day === 2/.test(main_ts))

const PORTLAR = process.env.PORT ? [process.env.PORT] : ['5399', '5311', '5173', '5174']
let PORT = null
for (const p of PORTLAR) {
  try { if ((await fetch(`http://localhost:${p}/`, { signal: AbortSignal.timeout(1500) })).ok) { PORT = p; break } }
  catch { /* sıradaki */ }
}
if (!PORT) {
  console.log(`\n❌ dev sunucu bulunamadı (${PORTLAR.join(', ')}) — SAHNE ÖLÇÜMÜ KOŞMADI.`)
  console.log('   Bu bölüm testin asıl kanıtı; atlanırsa sonuç GEÇTİ sayılmaz.')
  console.log(`   Çalıştır: npm run dev -- --port ${PORTLAR[0]}`)
  process.exit(1)
}

console.log(`\n== 2) Sahne ölçümü (:${PORT}) — araçlar GERÇEKTEN pompaya varıyor mu ==`)
const b = await chromium.launch({ channel: 'chrome' })
const p = await (await b.newContext({ viewport: { width: 900, height: 1100 } })).newPage()
const hatalar = []
p.on('pageerror', e => hatalar.push(e.message))
await p.addInitScript(() => { localStorage.setItem('benzinlik-music', '0'); localStorage.setItem('benzinlik-sfx', '0') })
await p.goto(`http://localhost:${PORT}/?full=1`, { waitUntil: 'domcontentloaded' })
await p.waitForSelector('#app canvas', { timeout: 40000 })
await p.waitForTimeout(8000)

const kapiOnce = await p.evaluate(() => getComputedStyle(document.getElementById('authgate')).display)
await p.evaluate(() => document.getElementById('gguest')?.dispatchEvent(new MouseEvent('click', { bubbles: true })))
await p.waitForTimeout(2000)
const kapiSonra = await p.evaluate(() => getComputedStyle(document.getElementById('authgate')).display)
check('kapı başta gösteriliyor (misafir akışı bozulmadı)', kapiOnce === 'flex', kapiOnce)
check('kapı geçilince KAPALI kalıyor (geri açılmıyor)', kapiSonra === 'none', kapiSonra)

const olc = () => p.evaluate(() => {
  const c = window.__dbg.cars.cars
  const f = {}; c.forEach(x => { f[x.phase] = (f[x.phase] || 0) + 1 })
  return { toplam: c.length, pompada: f.atPump ?? 0, transit: f.transit ?? 0,
           kapi: getComputedStyle(document.getElementById('authgate')).display }
})
await p.waitForTimeout(16000)
const o1 = await olc()
console.log(`     t+18sn: ${JSON.stringify(o1)}`)
await p.waitForTimeout(10000)
const o2 = await olc()
console.log(`     t+28sn: ${JSON.stringify(o2)}`)

check('kapı ölçüm boyunca kapalı kaldı', o2.kapi === 'none', o2.kapi)
check('araç sayısı artıyor (yeni araç doğuyor)', o2.toplam > o1.toplam || o2.toplam >= 12,
  `${o1.toplam} → ${o2.toplam}`)
check('araçlar İSTASYONA GİRİYOR (pompada araç var)', o2.pompada > 0,
  `pompada ${o2.pompada} (hata varken hep 0 idi)`)
check('en az 3 araç aynı anda pompada (vitrin dolu görünüyor)', o2.pompada >= 3,
  `${o2.pompada} araç`)
check('araçların hepsi yoldan geçmiyor', o2.transit < o2.toplam,
  `${o2.transit}/${o2.toplam} transit`)
check('tur boyunca sayfa hatası yok', hatalar.length === 0, hatalar.slice(0, 2).join(' | '))

await b.close()
console.log(`\n${fail === 0 ? '✅' : '❌'} vitrin modu: ${pass} geçti, ${fail} kaldı`)
process.exit(fail === 0 ? 0 : 1)
