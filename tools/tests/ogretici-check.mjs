/**
 * ÖĞRETİCİ TESTİ — "ne yapacağımı anlamadım" (açık geri bildirimlerde ~25 kayıt).
 *
 * KÖK NEDEN: 3 adımlık onboarding ZATEN vardı ama `tutActive()` içinde
 * `auth.loggedIn()` şartı arıyordu. Oyuna giriş kapısının kendisi MİSAFİR düğmesi
 * (#gguest) olduğundan öğretici, onu en çok gereken kitleye — hesapsız yeni oyuncuya —
 * hiç görünmüyordu. Üstelik atlanamıyor ve yeniden başlatılamıyordu.
 *
 * FİX: öğretici misafirde de çalışır, 5 BAĞLAMSAL ipucuna çıktı (her ipucu bir KARARI
 * gösterir, buton turu değil), ATLA düğmesiyle her an kapanır, durumu localStorage'da
 * (`benzinlik-ogretici`) tutulur — oyun KAYDINA yazılmaz — ve Ayarlar'dan yeniden başlar.
 *
 * Bu test oyunu MİSAFİR olarak sıfırdan açar (öğreticinin yaşadığı tek mod: ?full=1 ve
 * promo modunda kapalıdır), ipuçlarının doğru anda çıkıp çıkmadığını, atlanabildiğini ve
 * bir daha ÇIKMADIĞINI ölçer.
 *
 * Kullanım: npx vite --port 5311 --strictPort  →  npm run test:ogretici
 */
import { readFileSync } from 'node:fs'
import { chromium } from 'playwright-core'

const PORT = process.env.PORT ?? '5311'
let hata = 0
const bekle = (k, ad, ek = '') => { console.log(`${k ? '✅' : '❌'} ${ad}${ek ? ' · ' + ek : ''}`); if (!k) hata++ }

// ---------------------------------------------------------------- KOD DENETİMİ
console.log('── KOD DENETİMİ ──')
const main = readFileSync(new URL('../../src/main.ts', import.meta.url), 'utf8')
const html = readFileSync(new URL('../../index.html', import.meta.url), 'utf8')

// KÖK NEDEN NÖBETÇİSİ: giriş şartı bir daha eklenirse öğretici misafirde yine ölür.
const tutActiveBlok = main.match(/function tutActive\(\)[\s\S]*?\n}/)?.[0] ?? ''
bekle(!!tutActiveBlok, 'tutActive() tanımlı')
bekle(!/auth\.loggedIn\(\)/.test(tutActiveBlok),
  'öğretici GİRİŞ ŞARTI aramıyor (misafir de görüyor)')
bekle(/isFullMode/.test(tutActiveBlok) && /isPromoMode/.test(tutActiveBlok),
  'vitrin/promo modunda öğretici kapalı')

// Durum localStorage'da, kayıt formatında DEĞİL
bekle(/const TUT_KEY = 'benzinlik-ogretici'/.test(main), "öğretici durumu 'benzinlik-*' anahtarında")
bekle(/TUT_ESKI_KEY = 'beneloil-onboarded'/.test(main), 'eski anahtar korunuyor (görmüş oyuncuya tekrar gösterilmez)')
bekle(!/SAVE_FIELDS[\s\S]{0,400}ogretici/.test(main), 'öğretici alanı oyun KAYDINA yazılmıyor')

// Beş bağlamsal ipucunun beşi de bağlı mı
for (const [re, ad] of [
  [/onCarReady: car => \{[^}]*tutStart\(\)/, '1. ipucu ilk MÜŞTERİ gelince (onCarReady)'],
  [/ui\.onNozzle = [\s\S]{0,120}tutAdvance\(2\)/, '2. ipucu TABANCA seçilince (onNozzle)'],
  [/ui\.onStart = [\s\S]{0,200}tutAdvance\(3\)/, '3. ipucu DOLUM başlayınca (onStart)'],
  [/function trackDaily[\s\S]{0,320}tutSatisTamam\(\)/, '4. ipucu SERVİS bitince (trackDaily)'],
  [/getElementById\('shopbtn'\)\?\.addEventListener\('click', \(\) => tutMagazaAcildi\(\)\)/, '5. ipucu MAĞAZA açılınca (shopbtn)'],
]) bekle(re.test(main), ad)
// 5. ipucu KUTUYLA değil TOAST'la verilir (mağaza açıkken kutu sekme şeridini örtüyordu)
bekle(/function tutMagazaAcildi\(\)[\s\S]*?ui\.toast\(/.test(main), '5. ipucu toast ile (mağaza modalını örtmez)')
// Öğretici hedef belirlemeyi GÜNLÜK GÖREVLERE devreder — yeni bir hedef sistemi icat etmez
bekle(/function tutMagazaAcildi\(\)[\s\S]*?günlük görevlere/.test(main), 'öğretici hedefi günlük görevlere devrediyor')

// Atlanabilirlik + yeniden başlatma
bekle(/getElementById\('tut-skip'\)\?\.addEventListener/.test(main), 'ATLA düğmesi bağlı')
bekle(/getElementById\('set-tutorial'\)\?\.addEventListener/.test(main), 'Ayarlar → yeniden başlat bağlı')
bekle(/id="tut-skip"/.test(html) && /id="tut-text"/.test(html), 'ipucu kutusunda metin + ATLA DOM’u var')
bekle(/id="set-tutorial"/.test(html), 'Ayarlar’da "Öğreticiyi Yeniden Başlat" düğmesi var')
// Öğretici oyunu DURDURMAMALI: kutu tıklamayı yutmasın, yalnız ATLA tıklanabilsin
bekle(/id="tuthint"[\s\S]{0,600}pointer-events:none/.test(html), 'ipucu kutusu sahneyi kilitlemiyor (pointer-events:none)')

// ---------------------------------------------------------------- CANLI OYUN
console.log('\n── CANLI OYUN (misafir, sıfırdan) ──')
const b = await chromium.launch({ channel: 'chrome' })
const p = await b.newPage({ viewport: { width: 1280, height: 800 } })
const konsolHata = []
p.on('pageerror', e => konsolHata.push(String(e).slice(0, 200)))

/** misafir oturumu aç ve MİSAFİR kapısından gir.
 *  sifirla=true YALNIZ ilk turda: localStorage bir kez temizlenir. (addInitScript ile
 *  temizlemek olmaz — her gezinmede çalışır ve "bir daha çıkmıyor" testini yok eder.) */
async function yeniOyun(sifirla = true) {
  if (sifirla) {
    await p.goto(`http://localhost:${PORT}/`, { waitUntil: 'domcontentloaded' })
    await p.evaluate(() => { try { localStorage.clear() } catch { /* boş */ } })
  }
  await p.goto(`http://localhost:${PORT}/`, { waitUntil: 'domcontentloaded' })
  await p.waitForTimeout(6500)
  // #gguest position:fixed → offsetParent ile ölçülmez, getComputedStyle kullan
  const gorunur = await p.evaluate(() => {
    const g = document.getElementById('gguest')
    return !!g && getComputedStyle(g).display !== 'none'
  })
  if (gorunur) await p.click('#gguest')
  await p.waitForTimeout(1500)
  return gorunur
}

/** ipucu kutusunun o anki hâli — display fixed olduğu için getComputedStyle şart */
const ipucu = () => p.evaluate(() => {
  const e = document.getElementById('tuthint')
  const t = document.getElementById('tut-text')
  return {
    acik: !!e && getComputedStyle(e).display !== 'none',
    metin: (t?.textContent ?? '').trim(),
    atlaGorunur: (() => { const s = document.getElementById('tut-skip'); return !!s && getComputedStyle(s).display !== 'none' })(),
  }
})

const kapiVar = await yeniOyun()
bekle(kapiVar, 'misafir kapısı (#gguest) göründü ve tıklandı')

// 1) İLK MÜŞTERİ → 1. ipucu kendiliğinden çıkmalı (oyuncu hiçbir şeye basmadan)
let s = { acik: false, metin: '' }
for (let i = 0; i < 40 && !s.acik; i++) { await p.waitForTimeout(1000); s = await ipucu() }
bekle(s.acik, '1. ipucu ilk müşteride kendiliğinden çıktı', s.metin.slice(0, 60))
bekle(/tabanca/i.test(s.metin), '1. ipucu KARAR gösteriyor: hangi tabanca?', s.metin.slice(0, 70))
bekle(s.atlaGorunur, 'ATLA düğmesi görünür (öğretici zorunlu değil)')
await p.screenshot({ path: '.ogretici-1.png' })

// 2) tabanca seç → 2. ipucu (ne kadar vereceğine karar)
const nozzleVar = await p.evaluate(() => {
  const n = [...document.querySelectorAll('#panel button, .nozzle, [data-nozzle]')]
    .find(e => getComputedStyle(e).display !== 'none' && /benzin|dizel|lpg|elektrik/i.test(e.textContent || ''))
  if (n) { n.click(); return true }
  return false
})
await p.waitForTimeout(900)
const s2 = await ipucu()
bekle(nozzleVar && /tutar|FULLE/i.test(s2.metin), '2. ipucu tabanca seçilince değişti', s2.metin.slice(0, 70))
await p.screenshot({ path: '.ogretici-2.png' })

// 3) ATLA → kutu kapanır ve anahtar yazılır
await p.click('#tut-skip')
await p.waitForTimeout(600)
const s3 = await ipucu()
bekle(!s3.acik, 'ATLA ipucu kutusunu kapattı')
bekle(await p.evaluate(() => localStorage.getItem('benzinlik-ogretici') === 'bitti'),
  "atlayınca 'benzinlik-ogretici' anahtarı yazıldı")

// 4) YENİDEN AÇILIŞTA BİR DAHA ÇIKMAMALI
await yeniOyun(false)
await p.waitForTimeout(12000)
const s4 = await ipucu()
bekle(!s4.acik, 'öğretici bir daha çıkmıyor (yeniden açılışta sessiz)')
await p.screenshot({ path: '.ogretici-3.png' })

// 5) AYARLAR → yeniden başlat: anahtar silinir
await p.evaluate(() => document.getElementById('set-tutorial')?.click())
await p.waitForTimeout(600)
bekle(await p.evaluate(() => !localStorage.getItem('benzinlik-ogretici') && !localStorage.getItem('beneloil-onboarded')),
  'Ayarlar → "Öğreticiyi Yeniden Başlat" durumu sıfırladı')

bekle(konsolHata.length === 0, 'sayfada JavaScript hatası yok', konsolHata.join(' | ').slice(0, 160))
await b.close()

console.log(hata === 0 ? '\nÖĞRETİCİ TEMİZ — ipuçları doğru anda çıkıyor, atlanabiliyor, tekrar etmiyor'
                       : `\n${hata} KONTROL DÜŞTÜ`)
process.exit(hata === 0 ? 0 : 1)
