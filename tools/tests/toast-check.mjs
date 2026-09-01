/**
 * BİLDİRİM (TOAST) TESTİ — ~20 oyuncu geri bildirimi:
 *   "bildirimler çok hızlı kayboluyor", "üst üste yığılıp ekranı kaplıyor",
 *   "önemli olan spam içinde gözden kaçıyor", "tıklanamıyor", "ses spam'i".
 *
 * NEDEN GERÇEK TARAYICI: yığılma tavanı, "×N" birleştirme ve tıklayınca kapanma yalnız
 * canlı DOM'da görülür; kod denetimi bunların ÇALIŞTIĞINI kanıtlamaz.
 *
 * Kullanım: npm run dev -- --port 5311  →  node tools/tests/toast-check.mjs
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { chromium, devices } from 'playwright-core'

const PORT = process.env.PORT ?? '5311'
let hata = 0
const bekle = (k, ad, ek = '') => { console.log(`${k ? '✅' : '❌'} ${ad}${ek ? ' · ' + ek : ''}`); if (!k) hata++ }
const oku = p => readFileSync(new URL('../../' + p, import.meta.url), 'utf8')

// ───────────────────────── KOD DENETİMİ ─────────────────────────
console.log('── KOD DENETİMİ ──')
const ui = oku('src/ui.ts'), ses = oku('src/audio.ts'), html = oku('index.html')

bekle(/toast\(msg: string, kind: 'good' \| 'bad' \| '' = '', silent = false/.test(ui),
  'ui.toast() İMZASI KORUNDU (msg, kind, silent) — yüzlerce çağrı yeri bozulmadı')
bekle(/private readonly toastMax = [34]\b/.test(ui), 'ekranda aynı anda en fazla 3-4 toast tavanı var')
bekle(/toastSure\(/.test(ui) && /kind === 'good' \? \d+ : \d+/.test(ui),
  'süre önem derecesine göre hesaplanıyor (sıradan kısa, good/bad daha uzun)')
bekle(/text\.length \* \d+/.test(ui), 'süre metin uzunluğuna göre uzuyor (okumaya vakit kalsın)')
bekle(/this\.toastLive\.find\(x => x\.base === text\)/.test(ui),
  'aynı mesaj TÜM ekrandakilerle karşılaştırılıp birleştiriliyor (yalnız sonuncuyla değil)')
bekle(/×\$\{ayni\.n\}/.test(ui), 'birleşen toast "×N" sayacı gösteriyor')
bekle(/addEventListener\('click',[\s\S]{0,120}?toastKapat\(rec\)/.test(ui),
  'toast tıklanınca kapanıyor (click → toastKapat)')
bekle(/find\(x => !x\.onemli\)/.test(ui),
  'tavan dolunca önce SIRADAN toast düşüyor, önemli olan ekranda kalıyor')
bekle(/audio\.toastSfx\(kind\)/.test(ui) && !/audio\.cash\(\)\s*\n?\s*else if \(kind === 'bad'\) audio\.bad\(\)/.test(ui),
  'toast sesi doğrudan cash()/bad() değil, kapılı toastSfx() üzerinden')
bekle(/sonToastSes/.test(ses) && /toastSfx\(/.test(ses),
  'audio.ts içinde "son çalma zamanı" kapısı var (ses spam kapalı)')
bekle(/simdi - this\.sonToastSes < kapi/.test(ses), 'kapı süresi dolmadan ikinci ses ÇALINMIYOR')
bekle(/\.toast\.imp/.test(html), 'önemli toast için ayrı görsel stil (.imp) var')
bekle(/pointer-events: auto/.test(html), 'toast tıklamayı yakalıyor (kapsayıcı none, toast auto)')
bekle(/prefers-reduced-motion[\s\S]{0,160}\.toast/.test(html), 'prefers-reduced-motion animasyonu kapatıyor')
// 2 Eyl (#1297 #1299 #1305 #1308 #1310): kapatılabilir bildirim, ömür tavanı, sönen seri rozeti
bekle(/toastMod === 'onemli' && !vurgulu\) return/.test(ui) && /id="toastmodbtn"/.test(html),
  '"Yalnız önemli" modu var: sıradan toast ekrana çıkmıyor, ayarlarda düğmesi var')
bekle(/rec\.dogum \+ this\.toastOmurMs - Date\.now\(\)/.test(ui),
  'birleştirme süreyi sonsuza dek tazeleyemiyor (toplam ömür tavanı)')
bekle(/addEventListener\('pointerup'[\s\S]{0,160}?toastKapat\(rec\)/.test(ui),
  'toast pointerup ile de kapanıyor (mobilde click yutulsa bile)')
const main = oku('src/main.ts')
bekle(/state\.comboBosSn >= COMBO_SONME_SN\) \{ state\.combo = 0/.test(main) && /state\.comboBosSn = 0\n/.test(main),
  'SERİ rozeti servis durunca sönüyor (comboBosSn ≥ COMBO_SONME_SN → combo 0)')
bekle(/id="combobadge" style="display:none; position:fixed; right:/.test(html) && /id="combobadge"[^>]*z-index:20;/.test(html),
  'SERİ rozeti ortada değil (sağ sütun), panellerin ALTINDA (z 20 < kart 25)')

// ───────────────────────── GERÇEK TARAYICI ─────────────────────────
console.log('\n── GERÇEK TARAYICI ──')
const b = await chromium.launch({ channel: 'chrome' })
const ctx = await b.newContext({ viewport: { width: 1280, height: 800 } })
const p = await ctx.newPage()
const konsolHata = []
p.on('pageerror', e => konsolHata.push(String(e).slice(0, 200)))

await p.addInitScript(() => {
  localStorage.setItem('benzinlik-guest-joined', '1')
  localStorage.setItem('benzinlik-music', '0')
})
await p.goto(`http://localhost:${PORT}/?full=1`, { waitUntil: 'domcontentloaded' })
await p.waitForTimeout(9000)

// MİSAFİR KAPISINI GEÇ. (offsetParent İŞE YARAMAZ: kapı position:fixed → offsetParent null.)
async function kapiyiGec() {
  for (let i = 0; i < 12; i++) {
    const temiz = await p.evaluate(() => {
      document.getElementById('gguest')?.click()
      document.querySelectorAll('.backdrop.show').forEach(x => x.classList.remove('show'))
      const gate = document.getElementById('authgate')
      const gizli = !gate || getComputedStyle(gate).display === 'none'
      return gizli && document.querySelectorAll('.backdrop.show').length === 0
    }).catch(() => false)
    if (temiz) return true
    await p.waitForTimeout(900)
  }
  return false
}
/** Oyun bulut senkronunda kendini yenileyebiliyor (main.ts location.reload) — o anda
 *  çalışan evaluate "execution context destroyed" ile patlıyordu. Yenilenirse kapıyı
 *  tekrar geçip adımı tekrarlıyoruz; test navigasyona dayanıklı. */
async function calis(ad, fn) {
  for (let d = 0; d < 3; d++) {
    try {
      await kapiyiGec()   // arada yenilenip misafir kapısı geri gelmiş olabilir (tıklamayı bloklar)
      return await fn()
    } catch (e) {
      if (!/context was destroyed|Target (page|closed)|navigation|Timeout/i.test(String(e))) throw e
      console.log(`   ↻ sayfa yenilendi, "${ad}" tekrar deneniyor`)
      await p.waitForLoadState('domcontentloaded').catch(() => {})
      await p.waitForTimeout(9000)
      await kapiyiGec()
      await p.waitForTimeout(2500)
    }
  }
  throw new Error(ad + ': sayfa sürekli yenileniyor')
}

await kapiyiGec()
bekle(await p.evaluate(() => {
  const g = document.getElementById('authgate')
  return !g || getComputedStyle(g).display === 'none'
}), 'misafir kapısı geçildi')
await p.waitForTimeout(2500)

bekle(await p.evaluate(() => typeof window.__toast === 'function'), 'test kancası (window.__toast) hazır')

// 1) ARKA ARKAYA 10 FARKLI TOAST → tavanı aşmamalı
const adet = await calis('yığılma tavanı', async () => {
  await p.evaluate(() => {
    document.getElementById('toasts').innerHTML = ''
    for (let i = 0; i < 10; i++) window.__toast('Bildirim denemesi ' + i, '', true)
  })
  await p.waitForTimeout(250)
  return p.evaluate(() => document.querySelectorAll('#toasts .toast').length)
})
bekle(adet <= 4 && adet > 0, 'ekranda aynı anda 4\'ten fazla toast YOK', `${adet} adet (10 tetiklendi)`)

// 2) AYNI MESAJ 5 KEZ → tek satır + "×5"
const tekrar = await calis('tekrar birleştirme', async () => {
  await p.evaluate(() => {
    document.querySelectorAll('#toasts .toast').forEach(n => n.remove())
    for (let i = 0; i < 5; i++) window.__toast('Tank azaldı', 'bad', true)
  })
  await p.waitForTimeout(250)
  return p.evaluate(() => {
    const n = [...document.querySelectorAll('#toasts .toast')]
    return { adet: n.length, yazi: n.map(x => x.textContent).join(' | ') }
  })
})
bekle(tekrar.adet === 1, 'aynı mesaj 5 kez gelince TEK satır kalıyor', `${tekrar.adet} satır`)
bekle(/×\s?[35]/.test(tekrar.yazi), 'tekrar sayacı görünüyor (×3 / ×5)', tekrar.yazi)

// 3) ÖNEMLİ AYRIŞMASI: 'bad' toast .imp sınıfı alıyor, sıradan almıyor
const onem = await calis('önem ayrımı', () => p.evaluate(() => {
  document.querySelectorAll('#toasts .toast').forEach(n => n.remove())
  window.__toast('Kritik uyari mesaji', 'bad', true)
  window.__toast('Siradan bilgi mesaji', '', true)
  const n = [...document.querySelectorAll('#toasts .toast')]
  return { bad: n[0]?.classList.contains('imp'), duz: n[1]?.classList.contains('imp') }
}))
bekle(onem.bad === true && onem.duz === false, "'bad' görsel olarak ayrışıyor (.imp), sıradan bilgi geride")

// 4) SÜRE: sıradan toast eski 3.5 sn'de kayboluyordu ("okumaya vakit kalmıyor")
const sureOk = await calis('görünme süresi', async () => {
  await p.evaluate(() => {
    document.querySelectorAll('#toasts .toast').forEach(n => n.remove())
    window.__toast('Yakit indirimi basladi, pompalara akin var', 'good', true)
  })
  await p.waitForTimeout(4200)
  return p.evaluate(() => document.querySelectorAll('#toasts .toast').length === 1)
})
bekle(sureOk, "4.2 sn sonra hâlâ ekranda (eski 3.5 sn'de kaybolurdu)")

// 5) TIKLAYINCA KAPANIYOR
const kapandi = await calis('tıkla-kapat', async () => {
  await p.evaluate(() => {
    document.querySelectorAll('#toasts .toast').forEach(n => n.remove())
    window.__toast('Tiklayip kapat', '', true)
  })
  await p.waitForTimeout(150)
  await p.click('#toasts .toast', { timeout: 8000 })   // GERÇEK fare tıklaması
  await p.waitForTimeout(200)
  return p.evaluate(() => document.querySelectorAll('#toasts .toast').length)
})
bekle(kapandi === 0, 'toast GERÇEK fare tıklamasıyla kapanıyor', `kalan: ${kapandi}`)

// 6) TAVAN + ÖNEMLİ KORUMASI: önce bir uyarı, sonra 5 sıradan bilgi → uyarı hayatta kalmalı
const korundu = await calis('önemli koruması', () => p.evaluate(() => {
  document.querySelectorAll('#toasts .toast').forEach(n => n.remove())
  window.__toast('ONEMLI UYARI kalmali', 'bad', true)
  for (let i = 0; i < 5; i++) window.__toast('Gecici bilgi ' + i, '', true)
  return [...document.querySelectorAll('#toasts .toast')].some(n => n.textContent.includes('ONEMLI UYARI'))
}))
bekle(korundu, 'spam yağmurunda ÖNEMLİ toast ekranda kaldı')

// 7) TIKLANABİLİR TOAST, KAYIT BUTONUNU YEMESİN: toast kolonu sol-alttaki
//    "Şimdi Kayıt Ol" (#guestcta) butonunun üstüne binmemeli.
const cakisma = await calis('guestcta çakışması', () => p.evaluate(() => {
  document.querySelectorAll('#toasts .toast').forEach(n => n.remove())
  const cta = document.getElementById('guestcta')
  cta.style.display = 'flex'
  window.__toast('Yerlesim denemesi', '', true)
  const t = document.querySelector('#toasts .toast').getBoundingClientRect()
  const c = cta.getBoundingClientRect()
  return !(t.left < c.right && t.right > c.left && t.top < c.bottom && t.bottom > c.top)
}))
bekle(cakisma, 'toast kolonu "Şimdi Kayıt Ol" butonunun üstüne binmiyor (tıklama yenmiyor)')

// ekran görüntüsü: karışık bir yığın nasıl duruyor
await calis('ekran görüntüsü', () => p.evaluate(() => {
  document.querySelectorAll('#toasts .toast').forEach(n => n.remove())
  window.__toast('Yakit indirimi: benzin 2 gun boyunca ucuz!', 'good', true)
  window.__toast('Tank azaldi - siparis ver', 'bad', true)
  window.__toast('Otomatik sarj basladi.', '', true)
  window.__toast('Otomatik sarj basladi.', '', true)
  window.__toast('Otomatik sarj basladi.', '', true)
}))
await p.waitForTimeout(400)
writeFileSync(new URL('../../.toast-son-kare.png', import.meta.url), await p.screenshot())

// 7) "YALNIZ ÖNEMLİ" MODU: ayar düğmesine basınca sıradan toast çıkmıyor, 'bad' çıkıyor
const mod = await calis('yalnız önemli modu', async () => {
  await p.evaluate(() => {
    document.querySelectorAll('#toasts .toast').forEach(n => n.remove())
    document.getElementById('toastmodbtn').click()          // hepsi → onemli (onay toast'ı önemli, görünür)
    document.querySelectorAll('#toasts .toast').forEach(n => n.remove())
    window.__toast('Siradan bilgi sessiz', '', true)
    window.__toast('Kritik uyari gorunur', 'bad', true)
  })
  await p.waitForTimeout(200)
  const r = await p.evaluate(() => {
    const m = [...document.querySelectorAll('#toasts .toast')].map(n => n.textContent)
    const dugme = document.getElementById('toastmodbtn').textContent
    const saklanan = localStorage.getItem('benzinlik-toast')
    document.getElementById('toastmodbtn').click()          // geri: hepsi
    return { m, dugme, saklanan }
  })
  return r
})
bekle(mod.m.length === 1 && /Kritik/.test(mod.m[0]), '"Yalnız önemli" modunda sıradan toast ekrana ÇIKMADI, uyarı çıktı', mod.m.join(' | '))
bekle(/nemli|mportant/.test(mod.dugme) && mod.saklanan === 'onemli', 'düğme metni ve localStorage tercihi güncellendi', mod.dugme)

bekle(konsolHata.length === 0, 'konsol hatası yok', konsolHata[0] ?? '')

// ───────────────────────── MOBİL: "EKRANI KAPLIYOR" ─────────────────────────
// Şikayetin en sert hali mobilde: dar ekranda 5-6 toast sahnenin yarısını yiyordu.
console.log('\n── MOBİL YERLEŞİM ──')
const mctx = await b.newContext({ ...devices['Pixel 7'] })
const mp = await mctx.newPage()
await mp.addInitScript(() => {
  localStorage.setItem('benzinlik-guest-joined', '1')
  localStorage.setItem('benzinlik-music', '0')
})
await mp.goto(`http://localhost:${PORT}/?full=1`, { waitUntil: 'domcontentloaded' })
await mp.waitForTimeout(10000)
// Kapı ₺10.000 bonusundan sonra tekrar açılabiliyor → ölçümden hemen önce bir daha temizle
const mobKapi = async () => {
  for (let i = 0; i < 10; i++) {
    const temiz = await mp.evaluate(() => {
      document.getElementById('gguest')?.click()
      document.querySelectorAll('.backdrop.show').forEach(x => x.classList.remove('show'))
      const g = document.getElementById('authgate')
      return (!g || getComputedStyle(g).display === 'none') && document.querySelectorAll('.backdrop.show').length === 0
    }).catch(() => false)
    if (temiz) return true
    await mp.waitForTimeout(900)
  }
  return false
}
await mobKapi()
await mp.waitForTimeout(2500)
bekle(await mobKapi(), 'mobil: misafir kapısı kapalı (toast yığını görünür durumda)')
const mob = await mp.evaluate(() => {
  document.querySelectorAll('#toasts .toast').forEach(n => n.remove())
  window.__toast('Tank azaldi - hemen siparis ver yoksa musteri kacacak', 'bad', true)
  window.__toast('Yakit indirimi basladi, pompalara akin var', 'good', true)
  for (let i = 0; i < 4; i++) window.__toast('Musteri beklemekten sikildi ve gitti', '', true)
  const r = document.getElementById('toasts').getBoundingClientRect()
  return { oran: r.height / window.innerHeight, adet: document.querySelectorAll('#toasts .toast').length }
})
bekle(mob.adet <= 4, 'mobilde de tavan geçerli', `${mob.adet} toast`)
bekle(mob.oran < 0.34, 'toast yığını ekranın 1/3\'ünden azını kaplıyor', `%${Math.round(mob.oran * 100)}`)
writeFileSync(new URL('../../.toast-mobil.png', import.meta.url), await mp.screenshot())

await b.close()
console.log(hata ? `\n${hata} HATA` : '\nBİLDİRİMLER TEMİZ')
process.exit(hata ? 1 : 0)
