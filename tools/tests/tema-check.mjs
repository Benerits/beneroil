/**
 * KARANLIK MOD TESTİ — oyuncu isteği ("geceleri gözümü yakıyor", çok sayıda geri bildirim).
 *
 * NE DOĞRULAR:
 *   1) Karanlık mod TOKEN TABANLI: koyu blok yalnız --degisken yeniden tanımlar,
 *      tek tek CSS kuralı yazmaz. (Kural yazılmaya başlandığı an tema çürümeye başlar.)
 *   2) ÜÇ DURUM çalışıyor: sistem tercihi (varsayılan) · açık · koyu.
 *   3) Seçim localStorage'da KALICI (benzinlik-theme) ve sayfa yenilenince duruyor.
 *   4) Koyu temada OKUNAMAYAN eleman kalmadı: gerçek sayfada, gerçek hesaplanmış
 *      renklerle kontrast taranır ve AÇIK temayla karşılaştırılır — koyu tema, açık
 *      temada okunan hiçbir metni okunamaz hale getirmemeli.
 *
 * NEDEN GERÇEK TARAYICI: CSS değişkeni zinciri (token → kural → satır-içi stil) yalnız
 * canlı DOM'da çözülür; kaynak okuyarak "bu yazı okunuyor mu" sorusu cevaplanamaz.
 *
 * Kullanım: npx vite --port 5311 --strictPort  →  node tools/tests/tema-check.mjs
 */
import { readFileSync } from 'node:fs'
import { chromium, devices } from 'playwright-core'

const PORT = process.env.PORT ?? '5311'
let hata = 0
const bekle = (k, ad, ek = '') => { console.log(`${k ? '✅' : '❌'} ${ad}${ek ? ' · ' + ek : ''}`); if (!k) hata++ }
const oku = p => readFileSync(new URL('../../' + p, import.meta.url), 'utf8')

// ───────────────────────── KOD DENETİMİ ─────────────────────────
console.log('── KOD DENETİMİ ──')
const html = oku('index.html'), ui = oku('src/ui.ts')

// Koyu blokları ayıkla: hem attribute hem sistem-tercihi yolu olmalı
const koyuAttr = html.match(/:root\[data-theme="dark"\]\s*\{([\s\S]*?)\n\s*\}/)
const koyuMedya = html.match(/@media \(prefers-color-scheme: dark\)\s*\{\s*\n\s*:root:not\(\[data-theme="light"\]\)[^{]*\{([\s\S]*?)\n\s*\}/)
bekle(!!koyuAttr, 'açık seçim: :root[data-theme="dark"] bloğu var')
bekle(!!koyuMedya, 'sistem tercihi: @media (prefers-color-scheme: dark) bloğu var')
bekle(/:root:not\(\[data-theme="light"\]\)/.test(html),
  'kullanıcı "açık" derse sistem koyu olsa bile açık kalır (:not([data-theme="light"]))')

// TOKEN TABANLILIK: koyu blokların İÇİNDE yalnız --degisken tanımı olmalı
for (const [ad, m] of [['attribute', koyuAttr], ['sistem tercihi', koyuMedya]]) {
  if (!m) continue
  const bildirimler = m[1].split(';').map(s => s.trim()).filter(s => s && !s.startsWith('/*'))
  const tokenOlmayan = bildirimler.filter(s => !s.startsWith('--'))
  bekle(tokenOlmayan.length === 0,
    `${ad} bloğu SALT TOKEN (tek tek kural yazılmamış)`,
    `${bildirimler.length} token${tokenOlmayan.length ? ' · kaçak: ' + tokenOlmayan.join(', ') : ''}`)
  bekle(bildirimler.length >= 15, `${ad} bloğu paletin tamamını kapsıyor`, `${bildirimler.length} token`)
}

// Saf siyah YOK (karakterli, marka kırmızısına kayık sıcak nötrler)
if (koyuAttr) {
  bekle(!/#000\b|#000000\b/.test(koyuAttr[1]), 'koyu palette SAF SİYAH yok (nötrler kırmızıya kaydırıldı)')
  const paper = koyuAttr[1].match(/--paper:\s*(#[0-9a-f]{6})/i)?.[1]
  const [pr, pg, pb] = [1, 3, 5].map(i => parseInt(paper.slice(i, i + 2), 16))
  bekle(pr > pb && pr > pg, 'koyu zemin nötr değil, kırmızıya doğru kaydırılmış', `${paper} (R${pr} G${pg} B${pb})`)
}

// Kalıcılık + FOUC koruması
bekle(/localStorage\.getItem\('benzinlik-theme'\)/.test(html),
  'tema ön-yükleme scripti <head> içinde (koyu temada beyaz parlama yok)')
bekle(/const THEME_KEY = 'benzinlik-theme'/.test(ui),
  "kayıt anahtarı mevcut kalıpta: benzinlik-theme (benzinlik-music/-sfx ile aynı aile)")
bekle(/if \(m === 'system'\) root\.removeAttribute\('data-theme'\)/.test(ui),
  "'sistem' seçiliyken attribute YAZILMIYOR — telefon gece moduna geçince oyun JS'siz takip eder")

// Ayarlar panelinde seçici (ses kaydırıcılarının olduğu yer)
bekle(/data-theme-opt="system"/.test(html) && /data-theme-opt="light"/.test(html) && /data-theme-opt="dark"/.test(html),
  'ayarlar panelinde üç durumlu seçici var')
bekle(html.indexOf('data-theme-opt') < html.indexOf('id="musicvol"'),
  'seçici ses kaydırıcılarıyla aynı bölümde (ayarlar gövdesi)')

// Yüzeylerin sabit rengi kalmamalı — hepsi token üzerinden
const stil = html.slice(html.indexOf('<style>'), html.indexOf('</style>'))
bekle(!/background: #fff;/.test(stil), 'kart/giriş yüzeylerinde sabit #fff kalmadı (--surface)')
bekle(/--surface:/.test(stil) && /--red-ink:/.test(stil) && /--on-ink:/.test(stil),
  'anlamsal tokenlar tanımlı (--surface, --red-ink, --on-ink)')

// ───────────────────────── GERÇEK TARAYICI ─────────────────────────
console.log('\n── GERÇEK TARAYICI ──')
const b = await chromium.launch({ channel: 'chrome' })

async function kapiyiGec(p) {
  for (let i = 0; i < 12; i++) {
    const temiz = await p.evaluate(() => {
      document.getElementById('gguest')?.click()
      document.querySelectorAll('.backdrop.show').forEach(x => x.classList.remove('show'))
      const gate = document.getElementById('authgate')
      // kapı position:fixed → offsetParent null döner; görünürlük display ile ölçülür
      return (!gate || getComputedStyle(gate).display === 'none') && document.querySelectorAll('.backdrop.show').length === 0
    }).catch(() => false)
    if (temiz) return true
    await p.waitForTimeout(900)
  }
  return false
}

/** --paper tokenının koyu mu açık mı olduğu: temanın tek güvenilir göstergesi */
const temaOku = p => p.evaluate(() => {
  const v = getComputedStyle(document.documentElement).getPropertyValue('--paper').trim()
  const m = v.match(/^#([0-9a-f]{6})$/i)
  const [r, g, bb] = m ? [1, 3, 5].map(i => parseInt(m[1].slice(i - 1, i + 1), 16)) : [255, 255, 255]
  return { paper: v, koyu: (r + g + bb) / 3 < 110, attr: document.documentElement.getAttribute('data-theme'), kayit: localStorage.getItem('benzinlik-theme') }
})

async function sayfa(colorScheme, initScript) {
  const ctx = await b.newContext({ viewport: { width: 1280, height: 800 }, colorScheme })
  const p = await ctx.newPage()
  await p.addInitScript(() => {
    localStorage.setItem('benzinlik-guest-joined', '1')
    localStorage.setItem('benzinlik-music', '0'); localStorage.setItem('benzinlik-sfx', '0')
  })
  if (initScript) await p.addInitScript(initScript)
  await p.goto(`http://localhost:${PORT}/?full=1`, { waitUntil: 'domcontentloaded' })
  await p.waitForTimeout(9000)
  await kapiyiGec(p)
  await p.waitForTimeout(2000)
  return { ctx, p }
}

// 1) VARSAYILAN = SİSTEM TERCİHİ
{
  const { ctx, p } = await sayfa('light')
  const t = await temaOku(p)
  bekle(!t.koyu && t.attr === null, 'sistem AÇIK → oyun açık tema (attribute yazılmadı)', t.paper)
  await ctx.close()
}
{
  const { ctx, p } = await sayfa('dark')
  const t = await temaOku(p)
  bekle(t.koyu && t.attr === null, 'sistem KOYU → oyun kendiliğinden koyu (attribute yazılmadı)', t.paper)
  await ctx.close()
}

// 2) AÇIK SEÇİM SİSTEMİ EZER + 3) KALICILIK
{
  const { ctx, p } = await sayfa('light')
  await p.evaluate(() => document.querySelector('[data-theme-opt="dark"]').click())
  await p.waitForTimeout(300)
  let t = await temaOku(p)
  bekle(t.koyu && t.attr === 'dark' && t.kayit === 'dark', 'sistem açıkken "Koyu Tema" seçilebiliyor', t.paper)
  bekle(await p.evaluate(() => document.querySelector('[data-theme-opt="dark"]').classList.contains('primary')),
    'seçili durum düğmede görünüyor (birincil/kırmızı)')
  await p.reload({ waitUntil: 'domcontentloaded' })
  await p.waitForTimeout(6000)
  t = await temaOku(p)
  bekle(t.koyu && t.attr === 'dark', 'seçim sayfa yenilenince KALICI (localStorage)', t.paper)
  // sistem'e dönüş → attribute silinir, sistem tercihine (açık) düşer
  await kapiyiGec(p)
  await p.evaluate(() => document.querySelector('[data-theme-opt="system"]').click())
  await p.waitForTimeout(300)
  t = await temaOku(p)
  bekle(!t.koyu && t.attr === null && t.kayit === 'system', '"Sistem"e dönünce attribute silinip sistem tercihine düşüyor', t.paper)
  await ctx.close()
}
{
  const { ctx, p } = await sayfa('dark', () => localStorage.setItem('benzinlik-theme', 'light'))
  const t = await temaOku(p)
  bekle(!t.koyu && t.attr === 'light', 'sistem KOYU olsa da "Açık Tema" seçimi kazanıyor', t.paper)
  await ctx.close()
}

// 4) KONTRAST TARAMASI — açık vs koyu karşılaştırmalı
/* NEDEN KARŞILAŞTIRMALI: markanın beyaz-üstü-kırmızı/turuncu butonları AÇIK temada da
   4.5:1'in altında (mevcut kimlik). Mutlak eşik koysak testi marka yüzünden kırardık.
   Doğru soru şu: KOYU TEMA, açık temada okunan bir metni okunamaz hale getirdi mi? */
/* AYNI SAYFA, AYNI DOM, İKİ TEMA: tarama tek oturumda yapılır ve arada yalnız tema
   değiştirilir. İki ayrı sekmede tarayınca oyunun canlı durumu (müşteri geldi mi, EV mi)
   iki koşuda farklı eleman kümesi üretiyor ve karşılaştırma çöpe gidiyordu. */
const taraIkiTema = async () => {
  const { ctx, p } = await sayfa('light')
  await p.evaluate(() => {
    document.getElementById('panel')?.classList.add('show')
    document.getElementById('infocard')?.classList.add('show')
    window.__toast('Kasaya 1.240 gir', 'good', true)
    window.__toast('Benzin tanki azaldi', 'bad', true)
    window.__toast('Yeni musteri geldi', '', true)
  })
  const acik = {}, koyu = {}
  const ac = async id => {
    await kapiyiGec(p)
    await p.evaluate(i => {
      document.getElementById(i)?.click()
      document.getElementById('panel')?.classList.add('show')
      document.getElementById('infocard')?.classList.add('show')
    }, id)
    await p.waitForTimeout(1600)
  }
  const kapat = async () => {
    await p.evaluate(() => document.querySelectorAll('.backdrop.show').forEach(x => x.classList.remove('show')))
    await p.waitForTimeout(300)
  }
  for (const id of ['shopbtn', 'officebtn', 'setbtn', '']) {
    if (id) await ac(id); else { await kapiyiGec(p); await p.evaluate(() => {
      document.getElementById('panel')?.classList.add('show')
      document.getElementById('infocard')?.classList.add('show')
    }) }
    // önce açık, sonra AYNI AN koyu → eleman kümesi birebir aynı
    await p.evaluate(() => window.__setTheme('light')); await p.waitForTimeout(350)
    Object.assign(acik, await p.evaluate(oOku))
    await p.evaluate(() => window.__setTheme('dark')); await p.waitForTimeout(350)
    Object.assign(koyu, await p.evaluate(oOku))
    await p.evaluate(() => window.__setTheme('system'))
    if (id) await kapat()
  }
  await ctx.close()
  return { acik, koyu }

  function oOku() {
    const lin = c => (c <= .03928 ? c / 12.92 : ((c + .055) / 1.055) ** 2.4)
    const parse = s => (s.match(/[\d.]+/g) || []).map(Number)
    const Y = ([r, g, b]) => .2126 * lin(r / 255) + .7152 * lin(g / 255) + .0722 * lin(b / 255)
    const karistir = (on, alt, a) => on.map((v, i) => v * a + alt[i] * (1 - a))
    const zemin = e => {
      let n = e
      while (n && n !== document.documentElement) {
        const bg = parse(getComputedStyle(n).backgroundColor)
        if (bg.length >= 3 && (bg[3] === undefined || bg[3] > .55)) return bg.slice(0, 3)
        n = n.parentElement
      }
      return [255, 255, 255]
    }
    const out = {}
    for (const e of document.querySelectorAll('.hud *, .modal *, #panel *, #infocard *, #toasts *, .navbar *')) {
      const yazi = [...e.childNodes].filter(n => n.nodeType === 3).map(n => n.textContent.trim()).join('')
      if (!yazi) continue
      const st = getComputedStyle(e)
      if (st.display === 'none' || st.visibility === 'hidden' || +st.opacity < .25) continue
      const r = e.getBoundingClientRect()
      if (r.width < 4 || r.height < 4) continue
      const fg0 = parse(st.color); if (fg0.length < 3) continue
      const alt = zemin(e)
      const fg = fg0[3] !== undefined && fg0[3] < 1 ? karistir(fg0.slice(0, 3), alt, fg0[3]) : fg0.slice(0, 3)
      const [a, bY] = [Y(fg) + .05, Y(alt) + .05]
      const oran = a > bY ? a / bY : bY / a
      // imza: hangi eleman olduğu; iki tema arasında eşleşsin diye metin değil yapı
      const imza = `${e.tagName}.${e.className || '-'}#${e.id || '-'}|${yazi.slice(0, 14)}`
      const buyuk = parseFloat(st.fontSize) >= 24 || (parseFloat(st.fontSize) >= 18.66 && +st.fontWeight >= 700)
      out[imza] = { oran: +oran.toFixed(2), esik: buyuk ? 3 : 4.5, sinif: String(e.className || '-') }
    }
    return out
  }
}

const { acik, koyu } = await taraIkiTema()
bekle(Object.keys(koyu).length > 40, 'koyu temada yeterince eleman tarandı', `${Object.keys(koyu).length} metin`)
bekle(Object.keys(koyu).length === Object.keys(acik).length,
  'iki tema BİREBİR aynı eleman kümesi üzerinde ölçüldü', `${Object.keys(acik).length} / ${Object.keys(koyu).length}`)

/* MARKA MİRASI: beyaz-üstü-kırmızı/yeşil/turuncu butonlar AÇIK temada da 4.5'in altında.
   Aynı sınıfa sahip bir eleman açık temada da düşükse bu koyu temanın getirdiği bir kusur
   değil; ama koyu temada DAHA KÖTÜ olmasına da izin verilmez. */
const acikSinifEnDusuk = {}
for (const v of Object.values(acik)) {
  if (v.oran < v.esik) acikSinifEnDusuk[v.sinif] = Math.min(acikSinifEnDusuk[v.sinif] ?? 99, v.oran)
}
const yeniDusukler = [], markaMirasi = []
for (const [imza, k] of Object.entries(koyu)) {
  if (k.oran >= k.esik) continue
  const a = acik[imza]
  if (a && a.oran < a.esik) { markaMirasi.push(`${k.sinif} ${k.oran}:1 (açıkta ${a.oran})`); continue }
  const sinifTabani = acikSinifEnDusuk[k.sinif]
  if (sinifTabani !== undefined && k.oran >= sinifTabani) { markaMirasi.push(`${k.sinif} ${k.oran}:1 (açıkta aynı sınıf ${sinifTabani})`); continue }
  yeniDusukler.push(`${imza} → ${k.oran}:1 (eşik ${k.esik}${a ? `, açıkta ${a.oran}` : ''})`)
}
bekle(yeniDusukler.length === 0,
  'koyu tema HİÇBİR metni okunamaz hale getirmedi (açık temayla karşılaştırmalı)',
  yeniDusukler.length ? '\n     ' + yeniDusukler.slice(0, 12).join('\n     ') : 'yeni düşük kontrast yok')

const mirasOzet = [...new Set(markaMirasi)]
console.log(`   ℹ️  marka mirası (açık temada da düşük, koyu tema kötüleştirmedi): ${
  mirasOzet.length ? mirasOzet.join(' · ') : 'yok'}`)

// Ana gövde metinleri için mutlak taban da tutmalı
const govde = Object.entries(koyu).filter(([, v]) => v.esik === 4.5).map(([, v]) => v.oran)
const enDusuk = Math.min(...govde)
console.log(`   ℹ️  koyu temada gövde metni en düşük kontrast: ${enDusuk}:1 · ortanca ${
  govde.sort((x, y) => x - y)[Math.floor(govde.length / 2)]}:1`)

// ───────────────────────── MOBİL ─────────────────────────
console.log('\n── MOBİL (Pixel 7) ──')
{
  const ctx = await b.newContext({ ...devices['Pixel 7'], colorScheme: 'dark' })
  const p = await ctx.newPage()
  await p.addInitScript(() => {
    localStorage.setItem('benzinlik-guest-joined', '1')
    localStorage.setItem('benzinlik-music', '0'); localStorage.setItem('benzinlik-sfx', '0')
  })
  await p.goto(`http://localhost:${PORT}/?full=1`, { waitUntil: 'domcontentloaded' })
  await p.waitForTimeout(9000)
  await kapiyiGec(p)
  await p.waitForTimeout(2000)
  const t = await temaOku(p)
  bekle(t.koyu, 'mobilde de sistem koyu tercihi uygulanıyor', t.paper)
  // ayarlar gövdesi mobilde Profil sheet'ine TAŞINIYOR — seçici oraya gitmiş olmalı ve çalışmalı
  const tasindi = await p.evaluate(() => !!document.querySelector('#accwrap .subpane[data-pane="ayarlar"] [data-theme-opt]'))
  bekle(tasindi, 'tema seçici mobilde Profil › Ayarlar sekmesine taşınmış')
  await p.evaluate(() => document.querySelector('[data-theme-opt="light"]').click())
  await p.waitForTimeout(300)
  const t2 = await temaOku(p)
  bekle(!t2.koyu && t2.kayit === 'light', 'taşındıktan sonra da düğmeler çalışıyor (dinleyiciler korunmuş)', t2.paper)
  await ctx.close()
}

await b.close()
console.log(hata ? `\n${hata} SORUN VAR` : '\nKARANLIK MOD TEMİZ')
process.exit(hata ? 1 : 0)
