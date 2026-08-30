/**
 * MOBİL DUMAN TESTİ — "oyun açılıyor ama ekran bomboş" (oyuncu raporu, 30 Ağu 2026).
 *
 * KÖK NEDEN: LIGHT MOD (mobil) composer'ı HİÇ kurmuyor — bloom pass'i yok, ara render
 * target'ı yok. Ama üç render çağrısı `composer!.render()` ile doğrudan composer'a
 * gidiyordu. Mobilde composer null olduğu için İLK KAREDE TypeError atıp frame loop
 * ölüyordu: HUD (DOM) ekranda kalıyor, 3B sahne hiç çizilmiyor → boş mavi ekran.
 *
 * Masaüstü duman testi bunu ASLA yakalayamaz (orada composer kurulu). Bu yüzden mobil
 * kullanıcı ajanıyla ayrı bir test gerekiyor.
 *
 * Kullanım: npm run dev -- --port 5311  →  node tools/tests/mobil-check.mjs
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { chromium, devices } from 'playwright-core'

const PORT = process.env.PORT ?? '5311'
let hata = 0
const bekle = (k, ad, ek = '') => { console.log(`${k ? '✅' : '❌'} ${ad}${ek ? ' · ' + ek : ''}`); if (!k) hata++ }
const main = readFileSync(new URL('../../src/main.ts', import.meta.url), 'utf8')

console.log('── KOD DENETİMİ ──')
bekle(!/composer!\.render\(\)/.test(main),
  'hiçbir yerde composer!.render() YOK — LIGHT modda null olur, tüm render renderFrame() üzerinden gitmeli')
bekle(/function renderFrame\(\)/.test(main), 'güvenli render sarmalayıcısı var')
bekle(/if \(composer\) composer\.render\(\)\s*\n\s*else renderer\.render/.test(main),
  'renderFrame composer yoksa doğrudan renderer kullanıyor')

console.log('\n── GERÇEK MOBİL TARAYICI ──')
const b = await chromium.launch({ channel: 'chrome' })
// gerçek bir mobil cihaz profili: dokunmatik + mobil UA → isLightMode() TRUE olur
const ctx = await b.newContext({ ...devices['Pixel 7'] })
const p = await ctx.newPage()
const konsolHata = []
p.on('pageerror', e => konsolHata.push(String(e).slice(0, 200)))
p.on('console', m => {
  if (m.type() === 'error' && !/Failed to load resource|favicon|api\/metric|api\/visit/.test(m.text())) {
    konsolHata.push(m.text().slice(0, 200))
  }
})

// ilerlemiş oyuncu: raporu veren oyuncu gün 205'teydi — çok bina, çok araç
await p.addInitScript(() => {
  localStorage.setItem('benzinlik-guest', JSON.stringify({
    money: 801_144, day: 205, reputation: 4.4, pumps: 8, evChargers: 4, marketLevel: 3,
    hasWash: true, hasOil: true, hasCoffee: true, hasRestaurant: true, hasTruckPark: true,
    solarCount: 3, parkingCount: 2, lampCount: 4,
    unlockedLocs: ['kasaba'], activeLoc: 'kasaba',
    tanks: { benzin: 800, dizel: 800, lpg: 800 },
  }))
  localStorage.setItem('benzinlik-guest-joined', '1')
  localStorage.setItem('benzinlik-music', '0')
})
await p.goto(`http://localhost:${PORT}/`, { waitUntil: 'domcontentloaded' })
await p.waitForTimeout(12000)
// MİSAFİR KAPISINI ve AÇILIŞ MODALLARINI GEÇ.
// (offsetParent ile görünürlük ölçmek İŞE YARAMAZ: kapı position:fixed ve fixed
//  elemanlarda offsetParent her zaman null — ilk denemede döngü hiç tıklamamıştı.)
for (let i = 0; i < 10; i++) {
  const temiz = await p.evaluate(() => {
    document.getElementById('gguest')?.click()
    document.querySelectorAll('.backdrop.show').forEach(x => x.classList.remove('show'))
    const gate = document.getElementById('authgate')
    const gizli = !gate || getComputedStyle(gate).display === 'none'
    const modalVar = document.querySelectorAll('.backdrop.show').length > 0
    return gizli && !modalVar
  })
  if (temiz) break
  await p.waitForTimeout(900)
}
bekle(await p.evaluate(() => {
  const g = document.getElementById('authgate')
  return !g || getComputedStyle(g).display === 'none'
}), 'misafir kapısı geçildi (sahne görünür durumda)')
await p.waitForTimeout(6000)

// ── LIGHT mod gerçekten devrede mi ──
const mod = await p.evaluate(() => {
  const c = document.querySelector('canvas')
  return { canvasVar: !!c, en: c?.width ?? 0, boy: c?.height ?? 0 }
})
bekle(mod.canvasVar, 'canvas oluşturuldu', `${mod.en}×${mod.boy}`)

// ── ASIL KONTROL: sahne GERÇEKTEN çiziliyor mu ──
// Boş ekran hatasında canvas vardı ama hiç çizim yoktu. Ekran görüntüsünün renk
// çeşitliliğine bakıyoruz: tek düz renk = sahne çizilmemiş.
// BOŞ EKRAN ÖLÇÜTÜ: PNG sıkıştırması. Tek düz renkli ekran ~10-20 KB'a iner;
// çizilmiş izometrik sahne yüzlerce KB tutar. (readPixels burada işe YARAMAZ:
// preserveDrawingBuffer kapalı olduğu için kare dışında boş tampon döner —
// ilk denemede "1 renk" diyip yanlış alarm vermişti.)
const png = await p.screenshot()
const kb = Math.round(png.length / 1024)
writeFileSync(new URL('../../.mobil-son-kare.png', import.meta.url), png)
bekle(kb > 60, 'sahne ÇİZİLİYOR (ekran düz renk değil)', `${kb} KB ekran görüntüsü`)

// ── frame loop yaşıyor mu: oyun saati ilerlemeli ──
const saat1 = await p.evaluate(() => document.getElementById('hud-clock')?.textContent ?? '')
await p.waitForTimeout(6000)
const saat2 = await p.evaluate(() => document.getElementById('hud-clock')?.textContent ?? '')
bekle(saat1 !== '' && saat1 !== saat2, 'frame loop yaşıyor (oyun saati ilerliyor)', `${saat1} → ${saat2}`)

bekle(konsolHata.length === 0, 'mobilde konsol hatası yok', konsolHata[0] ?? '')

await b.close()
console.log(hata ? `\n${hata} HATA` : '\nMOBİL TEMİZ')
process.exit(hata ? 1 : 0)
