/**
 * ŞUBE AĞI HARİTASI TESTİ
 *
 * NEDEN VAR: harita bir VİTRİN değil, karar ekranı. Karar ekranının tek görevi
 * GERÇEĞİ göstermek. Kavram prototipinde 14 uydurma düğüm, rakip yayılması ve
 * bölge bonusu vardı — hiçbirinin oyunda karşılığı yok. Bu test haritanın
 * uydurmaya geri kaymadığını her koşuda kanıtlar:
 *
 *   1) DÜĞÜM SAYISI = GERÇEK ŞUBE SAYISI (ALL_LOCS). Fazladan düğüm yok.
 *   2) DEĞERLER themes.ts'ten geliyor (entryBase/elasticity/rep/sign birebir eşit).
 *   3) BEDEL state.branchUnlockCost() ile birebir (artan çarpan dahil).
 *   4) KİLİTLİ/AÇIK durumu unlockedLocs + canUnlockLoc ile tutarlı.
 *   5) KENARLAR yalnız GERÇEK ortak tedarik hatları (taban↔kopya, 4 çift).
 *   6) ESKİ KAYIT ÇÖKMÜYOR: harita alanlarını hiç bilmeyen save yüklenip çiziliyor.
 *   7) UYDURMA MEKANİK YOK: kaynakta rakip yayılması / bölge bonusu izi kalmamış.
 *   8) Canlı tarayıcıda oyun içinde AÇILIYOR ve 9 düğüm çiziliyor (açık + koyu tema).
 *
 * Çalıştır: npx vite --port 5311 --strictPort  →  npx tsx tools/tests/harita-check.mjs
 */
globalThis.localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} }
Object.defineProperty(globalThis, 'navigator', { value: { language: 'tr' }, configurable: true })

import { readFileSync } from 'node:fs'
const {
  GameState, serializeState, hydrateState, ALL_LOCS, BASE_LOCS, COPY_LOCS,
  themeFor, isCopyLoc, baseLoc, SUPPLY_LINE_QUOTA,
} = await import('../../src/state.ts')
const { haritaDugumleri, haritaHatlari, HARITA_KONUM } = await import('../../src/harita.ts')
const { THEMES } = await import('../../src/themes.ts')

let pass = 0, fail = 0
const check = (n, c, d = '') => { c ? (pass++, console.log('  ✓ ' + n)) : (fail++, console.log(`  ✗ ${n}${d ? ' — ' + d : ''}`)) }
const oku = p => readFileSync(new URL('../../' + p, import.meta.url), 'utf8')

// ─────────────────────────────────────────────────────────────────────────────
console.log('\n── 1) DÜĞÜM SAYISI = GERÇEK ŞUBE SAYISI ──')
const s = new GameState()
const dug = haritaDugumleri(s)
check(`düğüm sayısı ALL_LOCS ile aynı (${ALL_LOCS.length})`, dug.length === ALL_LOCS.length,
  `harita ${dug.length}, state ${ALL_LOCS.length}`)
check('düğüm id\'leri BİREBİR ALL_LOCS (hayali düğüm yok)',
  dug.map(d => d.id).join(',') === ALL_LOCS.join(','), dug.map(d => d.id).join(','))
check('5 taban + 4 kopya', dug.filter(d => !d.kopya).length === BASE_LOCS.length
  && dug.filter(d => d.kopya).length === COPY_LOCS.length)
check('her düğümün tahtada bir yeri var (konumsuz düğüm yok)',
  ALL_LOCS.every(id => Array.isArray(HARITA_KONUM[id])))
check('konumlar tahta sınırları içinde (0..1000 × 0..660, plaka payıyla)',
  ALL_LOCS.every(id => {
    const [x, y] = HARITA_KONUM[id]
    return x >= 40 && x <= 960 && y >= 40 && y <= 600
  }))
check('iki düğüm ÜST ÜSTE değil (en yakın çift > 80 birim)', (() => {
  let min = Infinity
  for (let i = 0; i < ALL_LOCS.length; i++) for (let j = i + 1; j < ALL_LOCS.length; j++) {
    const a = HARITA_KONUM[ALL_LOCS[i]], b = HARITA_KONUM[ALL_LOCS[j]]
    min = Math.min(min, Math.hypot(a[0] - b[0], a[1] - b[1]))
  }
  return min > 80
})())

// ─────────────────────────────────────────────────────────────────────────────
console.log('\n── 2) DEĞERLER themes.ts\'TEN GELİYOR ──')
for (const d of dug) {
  const th = themeFor(d.id)
  const esit = d.econ.entryBase === th.econ.entryBase
    && d.econ.priceElasticity === th.econ.priceElasticity
    && d.econ.repWeight === th.econ.repWeight
    && d.econ.signWeight === th.econ.signWeight
    && d.econ.tipRate === th.econ.tipRate
  check(`${d.id}: kişilik değerleri temayla birebir`, esit,
    `harita ${JSON.stringify(d.econ)} · tema ${JSON.stringify(th.econ)}`)
  check(`${d.id}: ad temadan (themeFor.name)`, d.ad === th.name, `${d.ad} ≠ ${th.name}`)
}
// TABAN şubede tema nesnesi themes.ts'in TA KENDİSİ olmalı (türetme yok)
check('taban şubeler themes.ts nesnesini AYNEN kullanıyor',
  BASE_LOCS.every(b => themeFor(b) === THEMES[b]))
// Kopya kişiliği tabanından FARKLI olmalı — yoksa harita "aynı şeyi ikinci kez" gösterir
check('her kopyanın taban çekiciliği tabanından FARKLI (kopyala-yapıştır değil)',
  COPY_LOCS.every(c => themeFor(c).econ.entryBase !== themeFor(baseLoc(c)).econ.entryBase))

// ─────────────────────────────────────────────────────────────────────────────
console.log('\n── 3) BEDEL / YILDIZ ŞARTI GERÇEK ──')
for (const d of dug) {
  check(`${d.id}: bedel state.branchUnlockCost ile birebir`, d.bedel === s.branchUnlockCost(d.id),
    `${d.bedel} ≠ ${s.branchUnlockCost(d.id)}`)
  check(`${d.id}: yıldız şartı themeFor().unlock.stars`, d.yildizSart === themeFor(d.id).unlock.stars)
}
// Bedel açık şube sayısıyla ARTAR (BRANCH_COST_STEP) — harita anlık bedeli göstermeli
{
  const s2 = new GameState()
  const once = haritaDugumleri(s2).find(d => d.id === 'metropol').bedel
  s2.unlockedLocs = ['kasaba', 'cevreyolu', 'otoyol']
  const sonra = haritaDugumleri(s2).find(d => d.id === 'metropol').bedel
  check('bedel zincir büyüdükçe artıyor (harita ANLIK bedeli okuyor)', sonra > once,
    `${once} → ${sonra}`)
}

// ─────────────────────────────────────────────────────────────────────────────
console.log('\n── 4) KİLİTLİ / AÇIK DURUMU DOĞRU ──')
{
  const s3 = new GameState()
  let d3 = haritaDugumleri(s3)
  check('yeni oyunda YALNIZ kasaba aktif, diğer 8 düğüm açık değil',
    d3.filter(x => x.durum === 'aktif').map(x => x.id).join() === 'kasaba'
    && d3.filter(x => x.durum === 'acik').length === 0)
  check('kopyalar "önce tabanı" sebebiyle kilitli',
    COPY_LOCS.every(c => d3.find(x => x.id === c).sebep === 'taban'),
    d3.filter(x => x.kopya).map(x => `${x.id}:${x.sebep}`).join(' '))
  check('yıldızı olmayan oyuncuda otoyol "yildiz" sebebiyle kilitli',
    d3.find(x => x.id === 'otoyol').sebep === 'yildiz')

  // yıldız var, para yok → 'para'; para da var → 'firsat'
  s3.brandStars = 40
  d3 = haritaDugumleri(s3)
  check('yıldız yetince engel PARAYA döner', d3.find(x => x.id === 'otoyol').sebep === 'para')
  s3.money = 500_000_000
  d3 = haritaDugumleri(s3)
  check('para da yetince düğüm AÇILABİLİR (firsat) olur', d3.find(x => x.id === 'otoyol').durum === 'firsat')

  // gerçekten aç → 'acik'/'aktif'
  s3.unlockedLocs = ['kasaba', 'cevreyolu']
  s3.activeLoc = 'cevreyolu'
  d3 = haritaDugumleri(s3)
  check('açık ama uzaktaki şube "acik", bulunulan şube "aktif"',
    d3.find(x => x.id === 'kasaba').durum === 'acik' && d3.find(x => x.id === 'cevreyolu').durum === 'aktif')
  check('durum canUnlockLoc ile çelişmiyor',
    d3.every(x => (x.durum === 'firsat') === (s3.canUnlockLoc(x.id).ok)))
}

// ─────────────────────────────────────────────────────────────────────────────
console.log('\n── 5) KENARLAR = GERÇEK ORTAK TEDARİK HATLARI ──')
{
  const s4 = new GameState()
  const h4 = haritaHatlari(s4)
  check('4 hat (her taban↔kopya çifti için bir tane)', h4.length === COPY_LOCS.length, `${h4.length}`)
  check('kasaba hiçbir hatta YOK (kopyası yok)', h4.every(h => h.taban !== 'kasaba'))
  check('yeni oyunda hiçbir hat KURULU değil', h4.every(h => !h.aktif))
  check('her hattın uçları gerçek LocId', h4.every(h => ALL_LOCS.includes(h.taban) && ALL_LOCS.includes(h.kopya)
    && isCopyLoc(h.kopya) && baseLoc(h.kopya) === h.taban))

  s4.unlockedLocs = ['kasaba', 'otoyol', 'otoyol-2']
  const h5 = haritaHatlari(s4)
  const oto = h5.find(h => h.taban === 'otoyol')
  check('taban+kopya açılınca hat KURULU görünür', oto.aktif && h5.filter(h => h.aktif).length === 1)
  check('kurulu hatta kota state.supplyRemaining ile birebir',
    oto.kalan === Math.round(s4.supplyRemaining('otoyol')) && oto.kalan === SUPPLY_LINE_QUOTA)
  s4.supplyUsed = { otoyol: 4_500 }
  const h6 = haritaHatlari(s4).find(h => h.taban === 'otoyol')
  check('kota kullanımı state.supplyFill ile birebir', Math.abs(h6.doluluk - 0.5) < 1e-9 && h6.kalan === 4_500,
    `doluluk ${h6.doluluk} · kalan ${h6.kalan}`)
}

// ─────────────────────────────────────────────────────────────────────────────
console.log('\n── 6) ESKİ KAYIT ÇÖKMÜYOR (ADDITIVE) ──')
{
  // Harita HİÇBİR yeni state alanı eklemiyor; kanıtı: haritayı bilmeyen bir kayıt
  // yüklenip çizildiğinde de hata yok ve serileşme alanı değişmemiş olmalı.
  const eski = { money: 250_000, day: 12, reputation: 3.4, pumps: 2, unlockedLocs: ['kasaba'], activeLoc: 'kasaba' }
  const s5 = new GameState()
  let patladi = null
  try {
    hydrateState(s5, eski)
    const d5 = haritaDugumleri(s5)
    const h7 = haritaHatlari(s5)
    check('harita alanı bilmeyen kayıt yüklendi ve çizildi', d5.length === ALL_LOCS.length && h7.length === 4)
    check('eski kayıtta tek şube → 1 aktif, 8 kilitli', d5.filter(x => x.durum === 'aktif').length === 1
      && d5.filter(x => x.durum === 'kilit').length === 8)
  } catch (e) { patladi = e }
  check('hydrateState + harita çizimi hata vermedi', !patladi, String(patladi))

  // serileşme yüzeyi büyümemiş olmalı (harita kayda hiçbir alan EKLEMEZ)
  const ref = new GameState()
  const anahtarlar = Object.keys(serializeState(ref))
  check('harita serileşmeye yeni alan EKLEMEDİ (haritaya ait anahtar yok)',
    !anahtarlar.some(k => /harita|map/i.test(k)), anahtarlar.filter(k => /harita|map/i.test(k)).join())

  // kurcalanmış/ileri sürüm kaydı: bilinmeyen loc id haritayı düşürmemeli
  const s6 = new GameState()
  hydrateState(s6, { unlockedLocs: ['kasaba', 'mars-kolonisi', 'otoyol'], activeLoc: 'mars-kolonisi' })
  const d6 = haritaDugumleri(s6)
  check('bilinmeyen şube id\'li kayıt haritayı düşürmüyor',
    d6.length === ALL_LOCS.length && d6.some(x => x.durum === 'aktif'))
}

// ─────────────────────────────────────────────────────────────────────────────
console.log('\n── 7) UYDURMA MEKANİK YOK ──')
{
  const src = oku('src/harita.ts')
  // Prototipte olup oyunda karşılığı OLMAYAN mekanikler haritaya geri sızmamalı.
  const govde = src.slice(src.indexOf('export const HARITA_VIEWBOX')) // baştaki açıklama bloğu hariç
  // Düğüm SAHİPLİĞİ diye bir kavram yok: durum yalnız unlockedLocs/activeLoc'tan gelir.
  // (BRANCH_COPIES.rivalStrength GERÇEK bir alan — rozet olarak gösterilmesi serbest;
  //  yasak olan, düğümün "rakibe geçmesi" gibi olmayan bir mekaniği canlandırmak.)
  check('düğüm sahipliği / rakibe geçme YOK',
    !/\bowner\b|sahip\s*[[:=]|rakibe geç|rivalSpread|rakipYayil/i.test(govde))
  check('rakip yalnız BRANCH_COPIES.rivalStrength\'ten okunuyor (başka rakip mantığı yok)',
    (govde.match(/rival/gi) ?? []).every(() => true)
    && /sp\?\.rivalStrength/.test(govde) && !/freshRival|marketShare|rivalDecide/.test(govde))
  check('bölge kontrol bonusu YOK', !/REGION|bolgeKontrol|bölge bonus|%12/i.test(govde))
  check('ikmal deposu / km maliyeti YOK', !/DEPOT|depoKm|ikmalKur/i.test(govde))
  check('haritada rastgelelik yok (Math.random / rng)', !/Math\.random|mulberry/i.test(src))
  // Düğüm sayısı sabit yazılmamalı — ALL_LOCS'tan gelmeli
  check('düğüm listesi ALL_LOCS.map ile üretiliyor (sabit dizi değil)', /ALL_LOCS\.map/.test(src))

  const html = oku('index.html')
  check('harita modalı index.html\'de (mapwrap)', /id="mapwrap"/.test(html))
  check('5 şube sembolü sprite\'a eklendi', ['kasaba', 'cevreyolu', 'otoyol', 'marina', 'metropol']
    .every(k => html.includes(`id="i-loc-${k}"`)))
  // Emoji YASAK (ui-signage-design §1). '★' emoji değil, oyunun her yerinde kullanılan
  // marka yıldızı tipografisidir (bkz. .pz-stars) — muaf.
  check('haritada EMOJİ yok (tabela dili: sadece SVG sembol)',
    !/[\u{1F300}-\u{1FAFF}\u{FE0F}\u{2700}-\u{27BF}]/u.test(src),
    (src.match(/[\u{1F300}-\u{1FAFF}\u{FE0F}\u{2700}-\u{27BF}]/gu) ?? []).join(' '))

  // TEMA TOKENLARI: harita CSS'i sabit renk yazmamalı (karanlık mod token tabanlı)
  const blok = html.slice(html.indexOf('/* ═══ ŞUBE AĞI HARİTASI ═══'), html.indexOf('/* MESAJ KUTUSU (#1018) */'))
  check('harita CSS bloğu bulundu', blok.length > 500)
  const sabitler = [...blok.matchAll(/#[0-9a-fA-F]{3,8}\b/g)].map(m => m[0])
  // #fff yalnız KIRMIZI/YEŞİL DOLGU üstündeki yazı için serbest (paletin diğer yerlerindeki kalıp)
  const kacak = sabitler.filter(c => c.toLowerCase() !== '#fff')
  check('harita CSS\'inde sabit renk yok (yalnız token + #fff dolgu-üstü yazı)',
    kacak.length === 0, kacak.join(' '))
  check('harita CSS\'i koyu tema için AYRI kural yazmamış (token yeterli)',
    !/prefers-color-scheme|data-theme/.test(blok))
}

// ─────────────────────────────────────────────────────────────────────────────
console.log('\n── 8) OYUN İÇİNDE AÇILIYOR (canlı tarayıcı, açık + koyu tema) ──')
{
  const { chromium } = await import('playwright-core')
  const PORT = process.env.PORT ?? '5311'
  const b = await chromium.launch({ channel: 'chrome' })
  try {
    for (const tema of ['light', 'dark']) {
      const p = await b.newPage({ viewport: { width: 1360, height: 900 } })
      const hatalar = []
      p.on('pageerror', e => hatalar.push(String(e).slice(0, 160)))
      // MİSAFİR KAYDI: applySaveData {s:{…}} bekler ve ?full=1 vitrin modunda kayıt HİÇ
      // yüklenmez — o yüzden düz URL + sarmalanmış gövde (yoksa tek şubeli Gün-1 açılır).
      await p.addInitScript(t => {
        localStorage.setItem('benzinlik-theme', t)
        localStorage.setItem('benzinlik-guest', JSON.stringify({ at: Date.now(), s: {
          money: 40_000_000, day: 90, reputation: 4.6, brandStars: 12,
          unlockedLocs: ['kasaba', 'cevreyolu', 'otoyol', 'otoyol-2'], activeLoc: 'kasaba',
          pumps: 4, marketLevel: 2, managerLevel: 2, tanks: { benzin: 5000, dizel: 5000, lpg: 5000 },
        } }))
        localStorage.setItem('beneloil-loc', 'kasaba')
        localStorage.setItem('benzinlik-guest-joined', '1')
        localStorage.setItem('benzinlik-music', '0'); localStorage.setItem('benzinlik-sfx', '0')
      }, tema)
      await p.goto(`http://localhost:${PORT}/`, { waitUntil: 'domcontentloaded' })
      await p.waitForTimeout(9000)
      // misafir kapısı: tema-check ile aynı kalıp (kapı position:fixed → display ile ölç)
      for (let i = 0; i < 12; i++) {
        const temiz = await p.evaluate(() => {
          document.getElementById('gguest')?.click()
          document.querySelectorAll('.backdrop.show').forEach(x => x.classList.remove('show'))
          const g2 = document.getElementById('authgate')
          return (!g2 || getComputedStyle(g2).display === 'none')
        }).catch(() => false)
        if (temiz) break
        await p.waitForTimeout(900)
      }
      await p.waitForTimeout(1500)

      // TIKLAMALAR JS ile GÖNDERİLİR: misafir kapısı (#authgate) sayfa üstünde saydam
      // kalabiliyor ve playwright'ın isabet testini düşürüyor. Olay yolu aynı.
      const tikla = sel => p.evaluate(s2 => {
        const el = document.querySelector(s2)
        if (!el) return false
        el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
        return true
      }, sel)
      await tikla('#locbtn')
      await p.waitForTimeout(300)
      check(`[${tema}] HUD şube menüsünde harita satırı var`,
        await p.evaluate(() => !!document.querySelector('#locmenu button[data-qloc="__harita"]')))
      await tikla('#locmenu button[data-qloc="__harita"]')
      await p.waitForTimeout(700)

      const g = await p.evaluate(() => ({
        acik: document.getElementById('mapwrap')?.classList.contains('show'),
        acikSube: document.querySelectorAll('#hmap .hn-acik, #hmap .hn-aktif').length,
        dugum: document.querySelectorAll('#hmap .hn').length,
        hat: document.querySelectorAll('#hmap .hl').length,
        cip: document.querySelectorAll('#h-chips .hchip').length,
        aksiyon: !!document.querySelector('#h-side .hact'),
        zemin: document.querySelectorAll('#hmap .hz path, #hmap .hz ellipse').length,
        etiket: [...document.querySelectorAll('#hmap .hn-label')].map(e => e.textContent),
      }))
      check(`[${tema}] harita HUD şube menüsünden açıldı`, g.acik === true)
      check(`[${tema}] tahtada ${ALL_LOCS.length} düğüm çizildi`, g.dugum === ALL_LOCS.length, `${g.dugum}`)
      // kayıttaki 4 açık şube tahtada da açık görünmeli (durum GERÇEK kayıttan geliyor)
      check(`[${tema}] kayıttaki 4 açık şube tahtada açık`, g.acikSube === 4, `${g.acikSube}`)
      check(`[${tema}] kurulu hat + kesikli hat çizgileri var`, g.hat >= 4, `${g.hat}`)
      check(`[${tema}] üst şerit 4 gösterge`, g.cip === 4)
      check(`[${tema}] detay kartında aksiyon butonu var`, g.aksiyon)
      check(`[${tema}] arka plan dokusu çizildi (kıyı/topografya/yol)`, g.zemin >= 12, `${g.zemin} öğe`)
      check(`[${tema}] etiketler gerçek şube adları`,
        g.etiket.length === ALL_LOCS.length && g.etiket.every(e => e && e.length > 1), g.etiket.join(' | '))

      // OKUNABİLİRLİK: düğüm etiketi zemine karşı görünür olmalı (koyu temada da)
      const kontrast = await p.evaluate(() => {
        const say = s => { const m = getComputedStyle(document.querySelector(s)); return [m.fill, m.stroke] }
        const board = getComputedStyle(document.querySelector('.hboard')).backgroundColor
        return { etiket: say('#hmap .hn-label'), board }
      })
      check(`[${tema}] etiket dolgusu ile konturu FARKLI (kâğıt kontur okunurluğu)`,
        kontrast.etiket[0] !== kontrast.etiket[1], JSON.stringify(kontrast))
      check(`[${tema}] konsol hatası yok`, hatalar.length === 0, hatalar.join(' | '))

      // ── İKİNCİ GİRİŞ: Ofis › Şubeler'in başındaki buton ──
      await p.evaluate(() => document.getElementById('mapwrap')?.classList.remove('show'))
      await tikla('#officebtn')
      await p.waitForTimeout(600)
      await tikla('#oftabs .tab[data-oftab="buyume"]')
      await p.waitForTimeout(400)
      await tikla('#of-map')
      await p.waitForTimeout(700)
      check(`[${tema}] Ofis › Şubeler butonundan da açılıyor`, await p.evaluate(() =>
        document.getElementById('mapwrap')?.classList.contains('show') === true
        && document.getElementById('officewrap')?.classList.contains('show') === false))

      // ── ŞUBE AÇMA HARİTADAN (arayüz kanıtı; TAM bedel kanıtı §9'da) ──
      const sayiOku = s2 => Number(String(s2).replace(/[^\d]/g, ''))
      const ilkSayi = s2 => Number(String(s2).match(/\d+/)?.[0] ?? NaN)
      const hedef = await p.evaluate(() => {
        const n = document.querySelector('#hmap .hn-firsat')
        if (!n) return null
        n.dispatchEvent(new MouseEvent('click', { bubbles: true }))
        return n.dataset.hloc
      })
      check(`[${tema}] tahtada açılabilir (yeşil kesikli) şube var`, !!hedef, String(hedef))
      if (hedef) {
        await p.waitForTimeout(400)
        const once = await p.evaluate(() => ({
          para: document.getElementById('money')?.textContent ?? '',
          sube: document.querySelector('#h-chips .hchip:nth-child(2) .hcv')?.textContent ?? '',
          btn: document.querySelector('#h-side [data-hunlock]')?.textContent ?? '',
        }))
        const bedel = sayiOku(once.btn)
        check(`[${tema}] aksiyon butonu bedeli yazıyor`, bedel > 0, once.btn)
        await p.evaluate(() => document.querySelector('#h-side [data-hunlock]')
          ?.dispatchEvent(new MouseEvent('click', { bubbles: true })))
        await p.waitForTimeout(600)
        const sonra = await p.evaluate(id => ({
          para: document.getElementById('money')?.textContent ?? '',
          sube: document.querySelector('#h-chips .hchip:nth-child(2) .hcv')?.textContent ?? '',
          acik: document.querySelector(`#hmap .hn[data-hloc="${id}"]`)?.classList.contains('hn-acik'),
        }), hedef)
        check(`[${tema}] haritadan şube açıldı (${hedef}) — tahta anında tazelendi`, sonra.acik === true)
        check(`[${tema}] şube sayacı arttı`, ilkSayi(sonra.sube) === ilkSayi(once.sube) + 1,
          `${once.sube} → ${sonra.sube}`)
      }
      await p.close()
    }
    // ─────────────────────────────────────────────────────────────────────────
    console.log('\n── 9) HARİTADAN ŞUBE AÇMA = MEVCUT EKONOMİ YOLU ──')
    // Kanıt kasadan TAM state.branchUnlockCost kadar düşmesidir. state'e ancak
    // ?full=1 debug kancasıyla ulaşılıyor (misafir kaydı orada yüklenmez; şartları
    // doğrudan state üzerinden kuruyoruz — ölçtüğümüz şey zaten AKIŞ, kayıt değil).
    const p2 = await b.newPage({ viewport: { width: 1360, height: 900 } })
    const h2 = []
    p2.on('pageerror', e => h2.push(String(e).slice(0, 160)))
    await p2.addInitScript(() => {
      localStorage.setItem('benzinlik-music', '0'); localStorage.setItem('benzinlik-sfx', '0')
    })
    await p2.goto(`http://localhost:${PORT}/?full=1`, { waitUntil: 'domcontentloaded' })
    await p2.waitForTimeout(9000)
    const eko = await p2.evaluate(() => {
      const s2 = window.__dbg.state
      s2.money = 400_000_000; s2.brandStars = 40           // şartları karşıla
      document.getElementById('locbtn').dispatchEvent(new MouseEvent('click', { bubbles: true }))
      document.querySelector('#locmenu button[data-qloc="__harita"]')
        .dispatchEvent(new MouseEvent('click', { bubbles: true }))
      const n = document.querySelector('#hmap .hn-firsat')
      if (!n) return { hata: 'firsat düğüm yok' }
      n.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      const btn = document.querySelector('#h-side [data-hunlock]')
      if (!btn) return { hata: 'aç butonu yok' }
      const id = btn.dataset.hunlock
      const bedel = s2.branchUnlockCost(id), oncePara = s2.money, onceSayi = s2.unlockedLocs.length
      btn.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      return { id, bedel, dusen: oncePara - s2.money, artan: s2.unlockedLocs.length - onceSayi,
               acik: s2.unlockedLocs.includes(id) }
    })
    check('haritadan şube açıldı', !eko.hata && eko.acik === true && eko.artan === 1, eko.hata ?? JSON.stringify(eko))
    check('kasadan TAM state.branchUnlockCost düştü (ikinci ekonomi yolu YOK)',
      !eko.hata && eko.dusen === eko.bedel && eko.bedel > 0, `düşen ${eko.dusen} · bedel ${eko.bedel}`)
    check('şube açma sırasında konsol hatası yok', h2.length === 0, h2.join(' | '))
    await p2.close()
  } finally { await b.close() }
}

console.log(`\n${fail === 0 ? '✅' : '❌'} harita-check: ${pass} geçti, ${fail} kaldı`)
process.exit(fail === 0 ? 0 : 1)
