/**
 * ORTA OYUN REHBERİ TESTİ — marka yıldızı, şube yolu ve baştan başlama.
 *
 * KÖK NEDEN (açık geri bildirim taraması): "öğrenilebilirlik" sanılan kayıtların büyük
 * kısmı ilk dakikaları DEĞİL orta oyunu anlatıyor:
 *   A) "Marka yıldızı / yeni şube nasıl açılır?" — 7 kayıt (#1003 #1144 #1174 #1257
 *      #1258 #653 #1264). #653: "6. yıldız için yer kalmadı, nasıl ilerleyeceğimi
 *      bilmiyorum". #1264: "yapacak bir şey kalmadı" — oysa şube sistemi orada duruyor.
 *   B) "Oyunu nasıl sıfırlarım?" — 6 kayıt (#77 #210 #228 #251 #305 #1195).
 *   C) Ruhsat/denetim, sözleşme cezası, kredi ne işe yarıyor — 4 kayıt (#453 #819
 *      #1217 #1208).
 *
 * Bilgi EKSİK DEĞİLDİ, GÖRÜNÜR DEĞİLDİ. Bu test üç şeyi kilitler:
 *   1) MATEMATİK: yıldız yolu hiçbir (yıldız, şube) kombinasyonunda TIKANMIYOR —
 *      yani #653 bir duvar değil bir görünürlük hatası. Duvar geri gelirse burada patlar.
 *   2) GÖRÜNÜRLÜK: rehber() ölü kod değil — HUD rozeti, bilgi kutusu, proaktif bildirim
 *      ve Şubeler panelinin tepe şeridi onu okuyor. Gerçek tarayıcıda ölçülür.
 *   3) SIFIRLAMA: çift onaylı, ne kaybedileceğini yazan ve MİSAFİRDE DE çalışan bir
 *      "Baştan Başla" var (eski akış misafir kaydını hiç silmiyordu).
 *
 * Kullanım: npx vite --port 5311 --strictPort  →  npm run test:rehber
 */
import { readFileSync } from 'node:fs'
import { chromium } from 'playwright-core'

const PORT = process.env.PORT ?? '5311'
let hata = 0
const bekle = (k, ad, ek = '') => { console.log(`${k ? '✅' : '❌'} ${ad}${ek ? ' · ' + ek : ''}`); if (!k) hata++ }
const oku = p => readFileSync(new URL('../../' + p, import.meta.url), 'utf8')
const tl = n => Math.round(n).toLocaleString('tr-TR')

globalThis.localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} }
Object.defineProperty(globalThis, 'navigator', { value: { language: 'tr' }, configurable: true })
const { GameState, BRANCH_EQUIP_CAP, ALL_LOCS } = await import('../../src/state.ts')

const main = oku('src/main.ts')
const html = oku('index.html')

// ═════════════════ 1) MATEMATİK: YILDIZ YOLU TIKANMIYOR (#653) ═════════════════
console.log('\n── 1) YILDIZ YOLU TIKANMIYOR (#653 ölçümü) ──')

/** Tek şubeye kurulabilen SINIRLI (tavanlı) kalemlerin tamamı. Sayısı sınırsız olan
 *  kalemler (lamba, panel, park…) BİLEREK katılmadı: eşiğin onlara ihtiyaç duymadan
 *  aşılabildiğini kanıtlamak istiyoruz. */
const doluSube = () => {
  const x = new GameState()
  x.pumps = 14; x.evChargers = 12; x.signLevel = 3; x.tankLevel = 3
  x.marketLevel = 3; x.market2Level = 3; x.toiletLevel = 2; x.toilet2Level = 2
  x.gridLevel = 2; x.batteryLevel = 6
  x.tankCounts = { benzin: 4, dizel: 4, lpg: 4 }
  x.hasWash = x.hasOil = x.hasCoffee = x.hasRestaurant = x.hasTruckPark = true
  x.hasWash2 = x.hasOil2 = x.hasCoffee2 = x.hasRestaurant2 = x.hasTruckPark2 = true
  x.hasSMR = x.hasDiesel = x.hasHotel = x.hasCleaner = x.wideGates = true
  return x
}
const subeTavani = doluSube().equipmentValue()
bekle(subeTavani > BRANCH_EQUIP_CAP,
  'tek şubeye kurulabilen ekipman, şube başına eşik tavanını AŞIYOR',
  `₺${tl(subeTavani)} > ₺${tl(BRANCH_EQUIP_CAP)}`)

// Eşik tablosu: her (devir sayısı × şube sayısı) hücresinde eşik ulaşılabilir mi?
let tikali = []
for (let hc = 0; hc <= 12; hc++) {
  for (let locs = 1; locs <= 4; locs++) {
    const s = new GameState()
    s.handoverCount = hc
    s.unlockedLocs = ALL_LOCS.slice(0, locs)
    const esik = s.handoverThreshold()
    if (esik > subeTavani * locs) tikali.push(`${hc} devir × ${locs} şube: ₺${tl(esik)} > ₺${tl(subeTavani * locs)}`)
  }
}
bekle(tikali.length === 0,
  'HİÇBİR (devir × şube) kombinasyonunda eşik ulaşılamaz değil',
  tikali.length ? tikali.slice(0, 3).join(' | ') : '13×4 = 52 hücre tarandı')

// #653'ün TAM senaryosu: 5 yıldız, 2 şube. Oyuncu "yer kalmadı" diyor.
{
  const s = new GameState()
  s.brandStars = 5; s.handoverCount = 5
  s.unlockedLocs = ['kasaba', 'cevreyolu']
  const esik = s.handoverThreshold()
  bekle(esik <= subeTavani * 2,
    '#653 senaryosu (5★ · 2 şube): eşik iki şubeye KURULABİLİR',
    `eşik ₺${tl(esik)} ≤ ulaşılabilir ₺${tl(subeTavani * 2)}`)
  // Çıkış yolu 2: kopya şube tam da 5★'da açılıyor — oyuncu bunu görmüyordu.
  s.money = 99_000_000
  const kopya = s.canUnlockLoc('cevreyolu-2')
  bekle(kopya.ok && kopya.stars === 5,
    '#653 senaryosunda ÇIKIŞ VAR: Çevre Yolu II tam 5★’da açılabiliyor',
    `${kopya.stars}★ · ₺${tl(kopya.cash)}`)
}

// ═════════════════ 2) REHBER MODELİ (tek kaynak) ═════════════════
console.log('\n── 2) REHBER MODELİ ──')
{
  const s = new GameState()
  bekle(typeof s.rehber === 'function', 'GameState.rehber() var (tek gerçek kaynak)')
  const r = s.rehber()
  for (const k of ['stars', 'equip', 'threshold', 'remaining', 'pct', 'ready',
                   'engel', 'tavanda', 'yerDoldu', 'bosSube', 'acilabilir', 'hedef', 'yildizAcar'])
    bekle(k in r, `rehber().${k} dönüyor`)
  bekle(r.hedef && r.hedef.name === 'Çevre Yolu',
    'yeni oyuncunun HEDEFİ en yakın şube (Çevre Yolu)', r.hedef ? `${r.hedef.name} · ${r.hedef.stars}★` : '—')
  bekle(r.hedef && r.hedef.starsLeft === 2, 'hedefe kalan yıldız SAYIYLA veriliyor')

  // Kilitli TABANI olmayan kopya satırları rehberden düşer (gürültü olmasın)
  bekle(!r.acilabilir.some(x => x.id.endsWith('-2')) && !(r.hedef?.id ?? '').endsWith('-2'),
    'tabanı kapalı kopya şubeler rehberde gösterilmiyor')

  // Devir hazır olunca ready=true ve yıldızın AÇACAĞI şube adıyla biliniyor
  const b = new GameState()
  b.brandStars = 1; b.handoverCount = 0
  b.pumps = 14; b.evChargers = 12; b.batteryLevel = 6; b.hasHotel = true
  const r2 = b.rehber()
  bekle(r2.ready === true, 'eşik dolunca rehber ready=true diyor', `₺${tl(r2.equip)} / ₺${tl(r2.threshold)}`)
  bekle(r2.yildizAcar.some(x => x.name === 'Çevre Yolu'),
    'sıradaki yıldızın AÇACAĞI şube adıyla biliniyor (2★ → Çevre Yolu)')

  // Kredi/ortaklık yıldızı durdurur → engel alanı bunu söyler
  const k = new GameState()
  k.loan = { ...k.loan, active: true }
  bekle(k.rehber().engel === 'kredi', 'açık kredi rehberde engel olarak görünüyor')
}

// ── PROAKTİF BİLDİRİMİN TETİKLERİ ──
// Toast'ın kendisi vitrin modunda susturulduğu için (pazarlama ekran görüntüsü kirlenmesin)
// canlı tıklanarak ölçülemiyor. Bunun yerine toast'ı SÜREN KOŞULLAR gerçek GameState
// üzerinde ölçülüyor: yanlış koşul (hiç gelmeyen bildirim) ya da sürekli doğru koşul
// (spam) burada yakalanır.
console.log('\n── 2b) BİLDİRİM TETİKLERİ ──')
{
  // (1) "Şube açabilirsin": yıldız ve para yeterliyken acilabilir DOLU olmalı
  const a = new GameState()
  a.brandStars = 2; a.money = 600_000
  bekle(a.rehber().acilabilir.some(x => x.id === 'cevreyolu'),
    '2★ + yeterli para → "şube açabilirsin" tetiği doğuyor')
  // Parası yetmiyorsa tetik SUSMALI (yoksa açamayacağı şube için bildirim spam'i)
  const a2 = new GameState()
  a2.brandStars = 2; a2.money = 1_000
  bekle(a2.rehber().acilabilir.length === 0, 'para yetmiyorsa "şube açabilirsin" tetiği susuyor')

  // (2) "Son düzlük" eşiği: %80 ve üstünde uyarı, altında sessizlik
  const y = new GameState()
  y.handoverCount = 0                                    // eşik ₺250.000
  y.pumps = 10                                           // ₺210.000 = %84 (eşiği aşmadan)
  const rp = y.rehber()
  bekle(rp.pct >= 80 && !rp.ready, '"son düzlük" (%80+) tetiği yanıyor', `%${rp.pct}`)
  const y2 = new GameState()
  y2.pumps = 8                                           // ₺120.000 = %48
  bekle(y2.rehber().pct < 80, 'eşiğin uzağındayken "son düzlük" tetiği susuyor', `%${y2.rehber().pct}`)

  // (3) #653 "yer kalmadı" tetiği: eşik şube tavanında + yeni şube alınamıyor + eksik var.
  //     Doğru senaryoda YANMALI…
  const d = new GameState()
  d.brandStars = 5; d.handoverCount = 5; d.money = 0
  d.unlockedLocs = ['kasaba', 'cevreyolu']
  d.pumps = 14; d.evChargers = 12                        // eşiğin altında kalan bir kurulum
  const rd = d.rehber()
  bekle(rd.tavanda && rd.yerDoldu, '#653 tetiği doğru senaryoda yanıyor',
    `eşik ₺${tl(rd.threshold)} · kalan ₺${tl(rd.remaining)}`)
  bekle(rd.bosSube.includes('cevreyolu'),
    '#653 tetiği ÇIKIŞ YOLUNU adıyla veriyor (donatılacak şube)', rd.bosSube.join(','))
  //     …ama devir zaten hazırken YANMAMALI (oyuncu tıkanmadı, sadece butona basmadı)
  const h = new GameState()
  h.brandStars = 1; h.handoverCount = 0
  h.pumps = 14; h.evChargers = 12; h.batteryLevel = 6
  bekle(!h.rehber().yerDoldu, 'devir hazırken #653 tetiği YANMIYOR (yanlış alarm yok)')
}

// ═════════════════ 3) GÖRÜNÜRLÜK: rehber() ÖLÜ KOD DEĞİL ═════════════════
console.log('\n── 3) GÖRÜNÜRLÜK (kod denetimi) ──')
bekle(/state\.rehber\(\)/.test(main), 'main.ts state.rehber() okuyor (ölü kod değil)')
bekle(/id="markachip"[^>]*data-bilgi="marka"/.test(html), 'HUD marka rozeti var ve bilgi kutusuna bağlı')
bekle(/marka: \(\) => \(\{[^}]*rehberBilgiMetni\(\)/.test(main), 'rozete dokununca rehber metni açılıyor')
bekle(/function markaRozetiniTazele\(\)/.test(main) && /markaRozetiniTazele\(\); rehberNabiz\(\)/.test(main),
  'rozet + proaktif nabız oyun döngüsüne bağlı')
bekle(/let head = rehberSeridi\(\)/.test(main), 'Şubeler panelinin TEPESİNDE yol haritası şeridi var')
// KÖK NEDEN NÖBETÇİSİ: şerit `head =` ile ezilirse (eski hata) yol haritası kaybolur
bekle(!/\n\s+head = `<div class="prow"><span class="pl"><b>\$\{t\('Şube kasalarında/.test(main),
  'kasa satırı head’i EZMİYOR (müdür bloğu + yol haritası hayatta)')
// Proaktif bildirim kilometre taşları oyun KAYDINA yazılmaz
bekle(/const REHBER_KEY = 'benzinlik-rehber'/.test(main), 'rehber durumu localStorage’da (kayıt formatına dokunmaz)')
bekle(!/SAVE_FIELDS[\s\S]{0,400}rehber/.test(main), 'rehber alanı oyun KAYDINA yazılmıyor')
// #653 çıkış yolu metni gerçekten yazılıyor mu
bekle(/ŞİRKETİN TAMAMINA bakar/.test(main), '#653 çıkış yolu (şirket geneli ekipman) oyuncuya yazılıyor')

console.log('\n── 4) BAŞTAN BAŞLA (kod denetimi) ──')
bekle(/id="set-restart"/.test(html), 'Ayarlar’da "Baştan Başla" düğmesi var')
bekle(/id="restart-what"/.test(html), 'ne kaybedileceği düğmenin ÜSTÜNDE yazılı')
bekle(/id="resetbtn"[^>]*display:none/.test(html), 'eski #resetbtn gizli ama DOM’da (ui.ts dinleyicisi patlamasın)')
const sifirlaBlok = main.match(/async function oyunuSifirla\(\)[\s\S]*?\n}/)?.[0] ?? ''
bekle(!!sifirlaBlok, 'oyunuSifirla() tanımlı')
bekle(/auth\.pushSave\(null\)/.test(sifirlaBlok), 'sunucuda MEŞRU yol kullanılıyor (pushSave(null))')
// KÖK NEDEN NÖBETÇİSİ: eski akış misafir kaydını silmiyordu → reload’da oyun geri geliyordu
bekle(/auth\.clearGuest\(\)/.test(sifirlaBlok), 'MİSAFİR kaydı da siliniyor (eski hata: silinmiyordu)')
bekle(/SIFIRLA_PENCERE/.test(main) && /EMİN MİSİN\? Silmek için tekrar bas/.test(main),
  'ÇİFT ONAY var (tek tıkla silinmiyor)')
bekle(/localStorage\.removeItem\(TUT_KEY\)/.test(sifirlaBlok), 'baştan başlayan oyuncu öğreticiyi yeniden görür')

console.log('\n── 5) SİSTEM ÖN-UYARILARI (#453 #819 #1217 #1208) ──')
const uyariBlok = main.match(/function sistemOnUyarilari\(\)[\s\S]*?\n}/)?.[0] ?? ''
bekle(/ruhsat/.test(uyariBlok), 'ruhsat/denetim ilk kesintiden ÖNCE uyarıyor')
bekle(/sozlesme/.test(uyariBlok), 'sözleşme cezası İMZALAMADAN önce uyarıyor')
bekle(/rehberDuyur\('sistem:kredi'/.test(main), 'kredi riski banka açılınca uyarıyor')
bekle(/sistemOnUyarilari\(\)/.test(main.replace(uyariBlok, '')), 'ön-uyarılar gün dönümüne bağlı')

console.log('\n── 6) TEMA: sabit renk yok ──')
// Yeni rehber CSS'i token kullanmalı (karanlık mod bugün eklendi)
// Yorumlar ayıklanır: geri bildirim numaraları (#653) hex renk sanılmasın
const rehberCss = (html.match(/\.rh-strip \{[\s\S]*?\.rh-out \{[\s\S]*?\}/)?.[0] ?? '')
  .replace(/\/\*[\s\S]*?\*\//g, '')
bekle(!!rehberCss, 'rehber şeridi CSS’i var')
bekle(!/#[0-9a-f]{3,8}\b/i.test(rehberCss), 'rehber şeridinde SABİT RENK yok (hepsi token)')
bekle(/--gold-ink:/.test(html) && (html.match(/--gold-ink:/g) || []).length >= 3,
  'marka altını her üç temada da tanımlı (açık · sistem-koyu · seçili-koyu)')

// ═════════════════ 7) GERÇEK TARAYICI — ORTA OYUN GÖRÜNÜRLÜĞÜ ═════════════════
// Vitrin modu (?full=1) kullanılıyor: orta oyun durumu __dbg.state ile kurulabiliyor,
// yani "3 yıldızlı, iki şubeli oyuncu ne görüyor" sorusu gerçekten ölçülebiliyor.
console.log('\n── 7) CANLI OYUN: orta oyun görünürlüğü (?full=1) ──')
const b = await chromium.launch({ channel: 'chrome' })
const p = await b.newPage({ viewport: { width: 1440, height: 900 } })
const konsolHata = []
p.on('pageerror', e => konsolHata.push(String(e).slice(0, 200)))

await p.goto(`http://localhost:${PORT}/?full=1`, { waitUntil: 'domcontentloaded' })
await p.waitForTimeout(8000)
// Vitrin modunda da giriş kapısı çıkar ve kapı ARKASINDA oyun döngüsü DURUR (guestPaused);
// kapı geçilmeden hiçbir HUD güncellemesi ölçülemez. Üstelik vitrin kasası dolu olduğu
// için "ilk ₺10.000" kapısı hemen ardından BİR KEZ daha açılır — ikisini de geçmek gerekir.
// #gguest position:fixed → offsetParent ile ölçülmez, getComputedStyle şart.
const kapiAcikMi = () => p.evaluate(() => {
  const g = document.getElementById('authgate')
  const b = document.getElementById('gguest')
  return !!g && getComputedStyle(g).display !== 'none'
    && !!b && getComputedStyle(b).display !== 'none'
})
let fullKapi = false
for (let i = 0; i < 3; i++) {
  if (!(await kapiAcikMi())) break
  fullKapi = true
  await p.click('#gguest')
  await p.waitForTimeout(2500)
}
bekle(fullKapi && !(await kapiAcikMi()), 'vitrin modunda giriş kapıları geçildi (oyun döngüsü akıyor)')
await p.waitForTimeout(2500)
const stateVar = await p.evaluate(() => !!window.__dbg?.state)
bekle(stateVar, 'vitrin modu debug kancası açık (orta oyun senaryosu kurulabiliyor)')

// ORTA OYUN: 3 yıldız, iki şube, eşiğin ortasında. Rehberin asıl kitlesi tam burası.
await p.evaluate(() => {
  const s = window.__dbg.state
  s.brandStars = 3; s.handoverCount = 3; s.day = 42; s.money = 900_000
  if (!s.unlockedLocs.includes('cevreyolu')) s.unlockedLocs.push('cevreyolu')
})
await p.waitForTimeout(3000) // rehber nabzı 2 sn’de bir

// HUD rozeti görünür ve DOLU mu
const rozet = await p.evaluate(() => {
  const c = document.getElementById('markachip')
  if (!c || getComputedStyle(c).display === 'none') return null
  return {
    st: document.getElementById('hud-marka-st')?.textContent ?? '',
    pct: document.getElementById('hud-marka-pct')?.textContent ?? '',
    genislik: document.getElementById('hud-marka-fill')?.style.width ?? '',
  }
})
bekle(!!rozet, 'orta oyunda HUD marka rozeti GÖRÜNÜR')
bekle(!!rozet && /^\d+★$/.test(rozet.st), 'rozet yıldız sayısını yazıyor', rozet?.st)
bekle(!!rozet && (/^%\d+$/.test(rozet.pct) || rozet.pct === 'HAZIR'),
  'rozet sıradaki yıldıza ilerlemeyi yazıyor', rozet?.pct)

// Rozete dokununca bilgi kutusu: SAYI + ŞUBE ADI içermeli (aramadan anlaşılsın).
// GERÇEK FARE TIKLAMASI kullanılıyor, dispatchEvent DEĞİL: .hud kapsayıcısı
// pointer-events:none taşıyor ve rozetler <div> — data-bilgi rozetleri pointer-events'i
// geri almazsa oyuncu hiçbirine dokunamaz. (Ölçüldü: eski hâlinde tıklanamıyordu.)
const rozetNoktasi = await p.evaluate(() => {
  const r = document.getElementById('markachip').getBoundingClientRect()
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 }
})
const ustteki = await p.evaluate(({ x, y }) => {
  const e = document.elementFromPoint(x, y)
  return !!e && !!e.closest('#markachip')
}, rozetNoktasi)
bekle(ustteki, 'rozet GERÇEKTEN tıklanabilir (sahne canvas’ı üstünü kapatmıyor)')
await p.mouse.click(rozetNoktasi.x, rozetNoktasi.y)
await p.waitForTimeout(500)
const kutu = await p.evaluate(() => {
  const k = document.getElementById('chipinfo')
  return k && getComputedStyle(k).display !== 'none' ? k.textContent ?? '' : ''
})
bekle(!!kutu, 'rozete dokununca bilgi kutusu açılıyor')
bekle(/₺[\d.]+/.test(kutu), 'bilgi kutusunda SOMUT sayı var', kutu.slice(0, 80))
bekle(/Otoyol|Çevre Yolu|Marina|Metropol/.test(kutu), 'bilgi kutusu sıradaki ŞUBEYİ adıyla söylüyor')
await p.screenshot({ path: '.rehber-1-rozet.png' })

// Şubeler panelinin tepe şeridi: "3★ · sıradaki yıldıza ₺X kaldı → Y şubesi açılır"
await p.evaluate(() => document.getElementById('officebtn')?.click())
await p.waitForTimeout(700)
await p.evaluate(() => document.querySelector('#oftabs .tab[data-oftab="buyume"]')?.click())
await p.waitForTimeout(900)
const serit = await p.evaluate(() => document.querySelector('.rh-strip')?.textContent ?? '')
bekle(!!serit, 'Şubeler panelinin TEPESİNDE yol haritası şeridi var')
bekle(/★/.test(serit) && /₺[\d.]+/.test(serit), 'şerit yıldızı ve kalan tutarı SAYIYLA veriyor', serit.slice(0, 90))
bekle(/Otoyol|Çevre Yolu|Marina|Metropol/.test(serit), 'şerit sıradaki şubeyi adıyla söylüyor')
// Müdür bloğu şeridin ezilmesiyle kaybolmamalı (eski `head =` hatası)
const mudurVar = await p.evaluate(() => /Müdür/.test(document.getElementById('of-locations')?.textContent ?? ''))
bekle(mudurVar, 'yol haritası müdür bölümünü EZMİYOR')
await p.screenshot({ path: '.rehber-2-panel.png' })

// KOYU TEMA: aynı şerit koyu temada da okunur olmalı
await p.evaluate(() => document.documentElement.setAttribute('data-theme', 'dark'))
await p.waitForTimeout(500)
await p.screenshot({ path: '.rehber-3-panel-koyu.png' })
const koyuOk = await p.evaluate(() => {
  const e = document.querySelector('.rh-main')
  if (!e) return false
  const c = getComputedStyle(e).color
  return c !== 'rgba(0, 0, 0, 0)' && c !== 'transparent'
})
bekle(koyuOk, 'yol haritası koyu temada da renk alıyor (token tabanlı)')
await p.evaluate(() => document.documentElement.setAttribute('data-theme', 'light'))
await p.waitForTimeout(300)

// ═════════════════ 8) BAŞTAN BAŞLA — canlı, MİSAFİR oturumunda ═════════════════
// Misafir olarak ölçülüyor çünkü eski akışın öldüğü yer tam burasıydı: sıfırlama yalnız
// auth.pushSave(null) çağırıyordu; giriş yapmamış oyuncunun kaydı localStorage'daki
// 'benzinlik-guest' anahtarında durur ve HİÇ silinmezdi → sayfa yenilenince oyun geri
// gelirdi. Sıfırlamak isteyenlerin çoğu da hesapsız oyuncudur.
console.log('\n── 8) BAŞTAN BAŞLA (canlı, misafir) ──')
await p.goto(`http://localhost:${PORT}/`, { waitUntil: 'domcontentloaded' })
await p.evaluate(() => { try { localStorage.clear() } catch { /* boş */ } })
await p.goto(`http://localhost:${PORT}/`, { waitUntil: 'domcontentloaded' })
await p.waitForTimeout(6500)
// #gguest position:fixed → offsetParent ile ölçülmez, getComputedStyle şart
const kapiVar = await p.evaluate(() => {
  const g = document.getElementById('gguest')
  return !!g && getComputedStyle(g).display !== 'none'
})
if (kapiVar) await p.click('#gguest')
await p.waitForTimeout(6000) // misafir kaydının yazılmasını bekle
bekle(kapiVar, 'misafir kapısı (#gguest) göründü ve tıklandı')

const kayitVardi = await p.evaluate(() => !!localStorage.getItem('benzinlik-guest'))
bekle(kayitVardi, 'misafir kaydı localStorage’da duruyor (sıfırlanacak bir şey var)')
bekle(await p.evaluate(() => !!document.getElementById('set-restart')), '"Baştan Başla" düğmesi DOM’da')

// TEK TIK SİLMEMELİ (kaza koruması)
await p.evaluate(() => document.getElementById('set-restart')?.click())
await p.waitForTimeout(900)
const tekTiktanSonra = await p.evaluate(() => ({
  kayit: !!localStorage.getItem('benzinlik-guest'),
  etiket: document.getElementById('set-restart')?.textContent ?? '',
}))
bekle(tekTiktanSonra.kayit, 'TEK tık kaydı SİLMİYOR (kaza koruması)')
bekle(/EMİN MİSİN|ARE YOU SURE|CONFIRMES/i.test(tekTiktanSonra.etiket),
  'ilk tık düğmeyi onay moduna alıyor', tekTiktanSonra.etiket.slice(0, 40))

// İKİNCİ TIK SİLMELİ. reload sonrası da GERİ GELMEMELİ: location.reload() `pagehide`
// tetikler, o da misafir kaydını yeniden yazabilirdi (sifirlaniyor bayrağı bunu susturur).
await p.evaluate(() => document.getElementById('set-restart')?.click())
await p.waitForTimeout(4000)
const silindi = await p.evaluate(() => !localStorage.getItem('benzinlik-guest'))
bekle(silindi, 'İKİNCİ tık misafir kaydını SİLDİ ve reload onu geri yazmadı')

bekle(konsolHata.length === 0, 'sayfada JavaScript hatası yok', konsolHata.join(' | ').slice(0, 160))
await b.close()


// ── SOFTLOCK KİLİDİ (#1082) ──
// "İki pompam da arızalı, tamir parası yok" → oyun ilerletilemiyordu. Son çalışan
// ünite artık bozulmaz; denge aynı, yalnız çıkmaz sokak kapalı.
{
  const s = new GameState()
  s.pumps = 2; s.evChargers = 0; s.money = 0
  s.brokenPumps.add(0)
  // 60 oyun-saati boyunca zorla: ikinci pompa ASLA bozulmamalı
  for (let i = 0; i < 6000; i++) s.tick(0.036)
  bekle(s.brokenPumps.size < 2, 'son çalışan pompa bozulmuyor (softlock imkânsız)',
    `${s.brokenPumps.size}/2 arızalı`)
  bekle(s.pumps - s.brokenPumps.size >= 1, 'her zaman en az 1 çalışan ünite var')
}

console.log(hata === 0
  ? '\nREHBER TEMİZ — yıldız yolu tıkanmıyor, ilerleme görünür, sıfırlama çift onaylı ve misafirde de çalışıyor'
  : `\n${hata} KONTROL DÜŞTÜ`)
process.exit(hata === 0 ? 0 : 1)
