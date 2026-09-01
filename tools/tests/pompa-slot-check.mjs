/**
 * POMPA/ŞARJ YUVA TESTİ + TRAFİK OLAY KAYDI TESTİ
 *
 * ŞİKÂYET: "pompa önünde 4-5 araç İÇ İÇE, alttaki pompalar boş."
 *
 * ÖLÇÜLEN KÖK NEDEN (canlı sahne probu, ?full=1, 4 pompa):
 *   `world.pumpSlots` 8 kayıtlıydı ama `PUMP_SLOTS_POS` yalnız 4 giriş içeriyordu;
 *   taşan indeks `?? PUMP_SLOTS_POS[3]` ile son girişe düşüyordu → 5..8. yuvanın
 *   HEPSİ (1.8,−18) noktasındaydı. Aynı hata EV tarafında da vardı (→ (1.8,−21.5)).
 *   Yani KONUMU OLMAYAN her ünite (canlıda tesislerin ~%14'ünde placedPos boştu)
 *   üst üste doğuyor, o yuvaların TÜM araçları tek noktada iç içe geçiyordu.
 *   Pompa dağılımı EŞİTTİ — sorun dağıtımda değil, YUVA TABLOSUNDAYDI.
 *
 * FIX: tablo 8 ayrı noktaya çıktı (src/world.ts) + yeniden kurulumda AYRIŞTIRMA
 * geçişi (main.ts uniteleriAyristir) — fail-closed: hiçbir ünite silinmez, yalnız
 * en yakın BOŞ geçerli noktaya taşınır; konumu OLAN ünite kıpırdamaz.
 *
 * Kullanım:  npm run dev -- --port 5399   →   npm run test:pompaslot
 *            (dev sunucu yoksa test HATA ile biter — atlanan ölçüm geçmiş sayılmaz)
 */
globalThis.localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} }
Object.defineProperty(globalThis, 'navigator', { value: { language: 'tr' }, configurable: true })

import { readFileSync } from 'node:fs'

let pass = 0, fail = 0
const check = (n, c, d = '') => { c ? (pass++, console.log('  ✓ ' + n)) : (fail++, console.log(`  ✗ ${n}${d ? ' — ' + d : ''}`)) }
const uzak = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1])
/** kümedeki en yakın çift */
const enYakin = arr => {
  let m = Infinity, cift = null
  for (let i = 0; i < arr.length; i++) for (let j = i + 1; j < arr.length; j++) {
    const d = uzak(arr[i], arr[j])
    if (d < m) { m = d; cift = [i, j] }
  }
  return { d: m, cift }
}

// ───────────────────────────────────────── 1) VARSAYILAN TABLO: 8 AYRI NOKTA
console.log('\n== 1) Varsayılan yuva tabloları: 8 ayrı nokta, ≥ 2.8 birim aralık ==')
const { PUMP_SLOTS_POS, EV_SLOTS_POS, SLOT_MIN_ARA } = await import('../../src/world.ts')
{
  const p = PUMP_SLOTS_POS.map(v => [v.x, v.y])
  const e = EV_SLOTS_POS.map(v => [v.x, v.y])
  check('pompa tablosu 8 girişli', p.length === 8, String(p.length))
  check('şarj tablosu 8 girişli', e.length === 8, String(e.length))
  const pk = enYakin(p), ek = enYakin(e)
  check(`8 pompa yuvasının HEPSİ birbirinden ≥ 2.8 uzak (en yakın çift ${pk.d.toFixed(3)})`,
    pk.d >= 2.8, `#${pk.cift?.[0]} ↔ #${pk.cift?.[1]} = ${pk.d.toFixed(3)}`)
  check(`8 şarj yuvasının HEPSİ birbirinden ≥ 2.8 uzak (en yakın çift ${ek.d.toFixed(3)})`,
    ek.d >= 2.8, `#${ek.cift?.[0]} ↔ #${ek.cift?.[1]} = ${ek.d.toFixed(3)}`)
  check('ayrıştırma eşiği tablodan büyük değil (tablo kendi kuralını çiğnemiyor)',
    pk.d >= SLOT_MIN_ARA && ek.d >= SLOT_MIN_ARA)
  // İLK DÖRT POMPA GİRİŞİ DEĞİŞMEDİ — mevcut kayıtlarda pompa yerinden oynamasın
  const eskiPompa = [[1.8, -2.2], [1.8, 2.2], [1.8, -14], [1.8, -18]]
  check('pompa tablosunun ilk 4 girişi BİREBİR korunmuş (eski kayıtlar oynamıyor)',
    eskiPompa.every((v, i) => v[0] === p[i][0] && v[1] === p[i][1]), JSON.stringify(p.slice(0, 4)))
  // YOL ve KUYRUK ŞERİDİ: yuva x'i şeridin (2.05..3.55) ve yolun (5.6..10.2) dışında
  const seritte = v => (v[0] > 2.05 && v[0] < 3.55) || (v[0] > 3.3 && v[0] < 5.3) || (v[0] > 5.6 && v[0] < 10.2)
  check('hiçbir varsayılan yuva kuyruk/servis şeridinde ya da yolda değil',
    ![...p, ...e].some(seritte), [...p, ...e].filter(seritte).map(v => v.join(',')).join(' | '))
  // sahibi olunabilir arsa sınırları (ana x −6.5..5, y −24..24)
  const disarda = v => v[0] < -6.5 || v[0] > 5 || v[1] < -24 || v[1] > 24
  check('bütün varsayılan yuvalar sahibi olunabilir arsa sınırları içinde',
    ![...p, ...e].some(disarda), [...p, ...e].filter(disarda).map(v => v.join(',')).join(' | '))
  // TAŞMA FAIL-SAFE: 8'in ötesindeki indeks de üst üste binmemeli
  const { World } = await import('../../src/world.ts')
  check('taşan indeks fail-safe\'i kaynakta var (asla aynı noktaya düşmez)',
    typeof World === 'function'
    && /son\.y - SLOT_MIN_ARA \* \(i - tablo\.length \+ 1\)/.test(readFileSync(new URL('../../src/world.ts', import.meta.url), 'utf8')))
}

// ───────────────────────────────────────── 2) KOD DENETİMİ: ONARIM YOLU YERİNDE
console.log('\n== 2) Kod denetimi: ayrıştırma + telemetri yolları ==')
const main = readFileSync(new URL('../../src/main.ts', import.meta.url), 'utf8')
const dunya = readFileSync(new URL('../../src/world.ts', import.meta.url), 'utf8')
const olayKod = readFileSync(new URL('../../src/trafik-olay.ts', import.meta.url), 'utf8')
const sunucu = readFileSync(new URL('../../server/index.js', import.meta.url), 'utf8')
{
  check('indeks kırpması (Math.min(index, 3)) KALKTI',
    !/PUMP_SLOTS_POS\[Math\.min\(index, 3\)\]/.test(dunya) && !/EV_SLOTS_POS\[Math\.min\(index, 3\)\]/.test(dunya))
  check('yuva tablosu taşmasında son girişe DÜŞÜLMÜYOR (?? tablo[3] silindi)',
    !/PUMP_SLOTS_POS\[i\] \?\? PUMP_SLOTS_POS\[3\]/.test(dunya) && !/EV_SLOTS_POS\[i\] \?\? EV_SLOTS_POS\[3\]/.test(dunya))
  check('ayrıştırma geçişi var', /function uniteleriAyristir\(\): number/.test(main))
  check('ayrıştırma yeniden kurulumdan çağrılıyor', /const yuva = uniteleriAyristir\(\)/.test(main))
  check('FAIL-CLOSED: yer bulunamazsa ünite yerinde bırakılıyor (silme yok)',
    /if \(!hedef\) \{ sabit\.push\(cur\); continue \}/.test(main))
  check('taşıma ünitenin KENDİ yolundan (movePump/moveCharger)',
    /world\.movePump\(i, gov, rot\)/.test(main) && /world\.moveCharger\(i, gov, rot\)/.test(main))
  check('onarım oyuncuya oturumda BİR KEZ bildiriliyor',
    /onarimBildirildi/.test(main) && /Üst üste binmiş \{0\} pompa\/şarj ünitesi ayrıştırıldı/.test(main))
  const i18n = readFileSync(new URL('../../src/i18n.ts', import.meta.url), 'utf8')
  check('bildirim metni EN+FR sözlükte',
    (i18n.match(/'Üst üste binmiş \{0\} pompa\/şarj ünitesi ayrıştırıldı — hiçbir şey silinmedi\.'/g) ?? []).length === 2)
  // ---- telemetri ----
  check('telemetri VİTRİN/TANITIM modunda kapalı kuruluyor',
    /trafikOlayKur\([\s\S]{0,3000}?\}, !isFullMode && !isPromoMode\)/.test(main))
  check('telemetri oyun döngüsünde (rAF değil) sayaçla tetikleniyor',
    /trafikOlayTick\(dt\)/.test(main) && /const NABIZ = 1/.test(olayKod))
  check('5 dakikalık kompakt sayaç throttle\'ı kaynakta',
    /SAYAC_ARALIK_SN = 300/.test(olayKod) && /sayacT >= SAYAC_ARALIK_SN/.test(olayKod))
  check('oturum tavanı 6 + olaylar arası 90 sn',
    /OTURUM_TAVANI = 6/.test(olayKod) && /OLAY_ARALIK_SN = 90/.test(olayKod))
  check('replay kancası var (__dbg.kayit.trafikSahnesi)', /trafikSahnesi\(snap: TrafikOlay\)/.test(main))
  // ---- sunucu ----
  check('sunucuda trafik olay tablosu (yeni tablo + indeks)',
    /CREATE TABLE IF NOT EXISTS benzinlik_trafficlog/.test(sunucu)
    && /CREATE INDEX IF NOT EXISTS benzinlik_trafficlog_kind_at/.test(sunucu))
  check('sunucuda /api/trafik-olay uç noktası', /url === '\/api\/trafik-olay' && req\.method === 'POST'/.test(sunucu))
  check('gövde > 16 KB → 413', /readRawLimited\(req, 16 \* 1024\)/.test(sunucu) && /json\(res, 413/.test(sunucu))
  check('dakikada IP başına 2 istek → 429',
    /rateLimit\('trafikolay:' \+ clientIp\(req\), 2, 60_000\)/.test(sunucu) && /json\(res, 429/.test(sunucu))
  check('saatlik sayaç kolonları stat_hourly\'de (YENİ TABLO AÇILMAMIŞ)',
    /trafik_icice int NOT NULL DEFAULT 0/.test(sunucu) && /trafik_sikisan int NOT NULL DEFAULT 0/.test(sunucu))
  check('sayaç kolon adları BEYAZ LİSTEDEN geçiyor (SQL enterpolasyonu güvenli)',
    /const STAT_TOPLAM_KOLON = new Set\(\['trafik_icice', 'trafik_sikisan', 'trafik_bekleyen', 'trafik_kurtarilan', 'trafik_ornek'\]\)/.test(sunucu))
  // BEKÇİ (kalıcı sıkışma sigortası): yeni olay türü + saatlik sayaç kolonu uçtan uca bağlı mı
  check("'kurtarma' olay türü sunucuda kabul ediliyor",
    /KINDS = new Set\(\['icice', 'sikisma', 'yigilma', 'kuyruk', 'kurtarma'\]\)/.test(sunucu))
  check('kurtarma sayacı saatlik trend kolonunda (trafik_kurtarilan)',
    /trafik_kurtarilan int NOT NULL DEFAULT 0/.test(sunucu) && /trafik_kurtarilan: n\(mb\.kurtarilan\)/.test(sunucu))
}

// ───────────────────────────────────── 3) TELEMETRİ MODÜLÜ: TETİK · THROTTLE · BOYUT
console.log('\n== 3) Trafik olay kaydı: tetikleyiciler, sınırlar, snapshot boyutu ==')
const olay = await import('../../src/trafik-olay.ts')
{
  const kur = (araclarFn, aktif = true) => {
    const gonderilen = []
    olay.trafikOlaySifirla()
    olay.trafikOlayKur({
      cars: araclarFn,
      pumpSlots: () => [{ x: 1.8, y: -2.2 }, { x: 1.8, y: 2.2 }],
      evSlots: () => [{ x: 1.8, y: 5.7 }],
      yapi: () => [['pump-0', 0.9, -2.2, 0], ['pump-1', 0.9, 2.2, 0]],
      gun: () => 42, loc: () => 'kasaba', pompa: () => 2, sarj: () => 1,
      kuyrukDolu: () => kuyruk, giremeyen: () => giremeyenN,
    }, aktif, (url, govde) => gonderilen.push({ url, govde }))
    return gonderilen
  }
  let kuyruk = false, giremeyenN = 0
  // VARSAYILAN FAZ 'waiting': kuyrukta duran araç HAREKETSİZ olması GEREKEN fazdadır,
  // yani sıkışma tetikleyicisini kirletmez. Sıkışma testi fazı açıkça 'driving' verir.
  const araba = (id, x, y, phase = 'waiting') => ({ id, x, y, phase, slotIndex: 0, kind: 'fuel' })
  /** yalnız olay kaydı istekleri (5 dakikalık sayaç isteği ayrı adrese gider) */
  const olaylar = g => g.filter(x => x.url === '/api/trafik-olay')
  const sur = (sn) => { for (let i = 0; i < sn; i++) olay.trafikOlayTick(1) }

  // 3a) İÇ İÇE: iki araç 1.0 birim mesafede, 3 sn boyunca
  {
    const g = kur(() => [araba(1, 0, 0), araba(2, 1, 0)])
    sur(1)
    check('iç içe: 1 sn sonra HENÜZ olay yok (anlık kesişme olay değil)', g.length === 0, String(g.length))
    sur(2)
    check('iç içe: >= 2 sn sürünce olay kuyruğa girdi', g.length === 1, JSON.stringify(g.map(x => x.govde.k)))
    check('olay türü icice', g[0]?.govde.k === 'icice', String(g[0]?.govde.k))
    check('olay /api/trafik-olay adresine gitti', g[0]?.url === '/api/trafik-olay', String(g[0]?.url))
    const o = g[0].govde
    check('şema alanları eksiksiz',
      o.day === 42 && o.loc === 'kasaba' && o.pumps === 2 && o.ev === 1
      && Array.isArray(o.cars) && Array.isArray(o.slots.pump) && Array.isArray(o.yapi),
      JSON.stringify(Object.keys(o)))
    check('araç satırı [x,y,phase,slotIndex,kind] biçiminde',
      o.cars[0].length === 5 && typeof o.cars[0][0] === 'number' && typeof o.cars[0][2] === 'string')
  }

  // 3b) 90 sn throttle
  {
    const g = kur(() => [araba(1, 0, 0), araba(2, 1, 0)])
    sur(3)
    check('throttle: ilk olay gitti', g.length === 1)
    sur(60)
    check('throttle: 60 sn sonra ikinci olay GİTMEDİ (< 90 sn)', g.length === 1, String(g.length))
    sur(35)
    check('throttle: 90 sn geçince yeni olay gitti', g.length === 2, String(g.length))
    sur(95)
    check('aynı tür arka arkaya 2 kereden fazla gitmiyor', olaylar(g).length === 2, String(olaylar(g).length))
  }

  // 3c) oturum tavanı 6 — türler dönüşümlü olsa da 6'yı aşmaz
  {
    let tik = 0
    const g = kur(() => {
      // türü sırayla değiştir: icice (2 araç yakın) ↔ yigilma (4 araç bir arada)
      tik++
      return (Math.floor(tik / 100) % 2 === 0)
        ? [araba(1, 0, 0), araba(2, 1, 0)]
        : [araba(3, 20, 20), araba(4, 21, 20), araba(5, 20, 21), araba(6, 21, 21)]
    })
    sur(1500)
    check('oturum tavanı: en fazla 6 olay gitti', olaylar(g).length <= 6 && olaylar(g).length > 0, String(olaylar(g).length))
    check('oturum tavanı tam 6\'da duruyor', olaylar(g).length === 6, String(olaylar(g).length))
  }

  // 3d) sıkışma: 45 sn hareketsiz + sürüş fazı
  {
    const g = kur(() => [araba(1, 3, 3, 'driving')])
    sur(44)
    check('sıkışma: 44 sn hareketsizlikte olay YOK', g.length === 0, String(g.length))
    sur(2)
    check('sıkışma: 45 sn sonra olay gitti', g.length === 1 && g[0].govde.k === 'sikisma', JSON.stringify(g.map(x => x.govde.k)))
  }
  {
    const g = kur(() => [araba(1, 3, 3, 'atPump')])
    sur(120)
    check('sıkışma: atPump/parked fazı sıkışma SAYILMIYOR', g.length === 0, JSON.stringify(g.map(x => x.govde.k)))
  }

  // 3e) yığılma: 3 birimlik dairede 4 araç (iç içe olmadan)
  {
    // dört araç bir aracın 3 birimlik çevresinde; ikili mesafeler 2.4 (> 2.15) →
    // iç içe DEĞİL, yalnız yığılma tetiklenmeli
    const g = kur(() => [araba(1, 0, 0), araba(2, 2.4, 0), araba(3, -2.4, 0), araba(4, 0, 2.4)])
    sur(3)
    check('yığılma: 3 birimlik dairede 4 araç olay üretti',
      g.length === 1 && g[0].govde.k === 'yigilma', JSON.stringify(g.map(x => x.govde.k)))
  }

  // 3f) kuyruk: slotlar dolu + giremeyen artıyor
  {
    kuyruk = true; giremeyenN = 0
    const g = kur(() => [araba(1, 0, 0), araba(2, 9, 9)])
    giremeyenN = 5
    sur(2)
    check('kuyruk: slotlar dolu + giremeyen artınca olay gitti',
      g.length === 1 && g[0].govde.k === 'kuyruk', JSON.stringify(g.map(x => x.govde.k)))
    kuyruk = false; giremeyenN = 0
  }

  // 3g) VİTRİN MODU: hiçbir istek çıkmıyor
  {
    const g = kur(() => [araba(1, 0, 0), araba(2, 1, 0)], false)
    sur(2000)
    check('VİTRİN/TANITIM modunda HİÇBİR istek çıkmıyor (fetch sayıcı 0)', g.length === 0, String(g.length))
  }

  // 3h) snapshot boyutu: 100 araçlı sahne < 8 KB
  {
    const yuz = Array.from({ length: 100 }, (_, i) => araba(i + 1, (i % 10) * 0.4, Math.floor(i / 10) * 0.4))
    const g = kur(() => yuz)
    sur(3)
    check('100 araçlı sahnede olay üretildi', g.length === 1, String(g.length))
    const boyut = new TextEncoder().encode(JSON.stringify(g[0].govde)).length
    check(`snapshot 100 araçla < 8 KB (${boyut} bayt)`, boyut < 8192, `${boyut} bayt`)
    check('araç konumları 1 ondalığa yuvarlanmış',
      g[0].govde.cars.every(c => Math.abs(c[0] * 10 - Math.round(c[0] * 10)) < 1e-9))
  }

  // 3i) 5 dakikalık kompakt sayaç
  {
    const g = kur(() => [araba(1, 0, 0, 'waiting'), araba(2, 1, 0, 'waiting')])
    sur(301)
    const sayaclar = g.filter(x => x.url === '/api/metric')
    check('5 dakikada BİR TEK kompakt sayaç isteği', sayaclar.length === 1, String(sayaclar.length))
    check('sayaç gövdesi kompakt {k:trafik, icice, sikisan, bekleyen}',
      sayaclar[0]?.govde.k === 'trafik' && typeof sayaclar[0]?.govde.icice === 'number'
      && typeof sayaclar[0]?.govde.sikisan === 'number' && typeof sayaclar[0]?.govde.bekleyen === 'number',
      JSON.stringify(sayaclar[0]?.govde))
  }
  olay.trafikOlaySifirla()
}

// ───────────────────────────────────────── 4) TARAYICI: GERÇEK SAHNE ÖLÇÜMÜ
// PORT SABİT DEĞİL, ARANIYOR + ATLAMA SESSİZ DEĞİL: bu bölüm testin ASIL kanıtı.
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
  fail++
} else {
  console.log(`\n(dev sunucu :${PORT})`)
  const { chromium } = await import('playwright-core')
  const b = await chromium.launch({ channel: 'chrome' })
  const p = await b.newPage()
  const hatalar = []
  p.on('pageerror', e => hatalar.push(e.message))
  await p.goto(`http://localhost:${PORT}/?full=1`, { waitUntil: 'load' })
  await p.waitForFunction(() => window.__dbg?.kayit, null, { timeout: 60_000 })

  console.log('\n== 4) Sahne: konumsuz kayıt · dokunulmazlık · idempotens ==')
  const r = await p.evaluate(() => {
    const d = window.__dbg, s = d.state, out = {}
    for (let c = 0; c < 3; c++) for (let rr = 0; rr < 3; rr++) d.kayit.arsaAl(c, rr)
    s.money = 5e8
    const yuvalar = () => ({
      pump: d.world.pumpSlots.slice(0, s.pumps).map(v => [+v.x.toFixed(3), +v.y.toFixed(3)]),
      ev: d.world.evSlots.slice(0, s.evChargers).map(v => [+v.x.toFixed(3), +v.y.toFixed(3)]),
    })
    d.place.rebuild()

    // --- 4a) KONUMSUZ kayıt (placedPos silinmiş) + 8 pompa / 8 şarj
    const temel = JSON.parse(JSON.stringify(d.kayit.yuk()))
    const bozuk = JSON.parse(JSON.stringify(temel))
    bozuk.placedPos = {}; bozuk.placedRot = {}; bozuk.placedRects = []
    bozuk.s.pumps = 8; bozuk.s.evChargers = 8
    d.kayit.yukle(bozuk)
    out.konumsuz = yuvalar()
    const pos = d.kayit.yuk().placedPos
    out.konumsuzPosPompa = Object.keys(pos).filter(k => k.startsWith('pump-')).sort()

    // --- 4b) YIĞILMIŞ kayıt: 5 pompanın HEPSİ aynı noktada (eski hatanın birebir hâli)
    const yigin = JSON.parse(JSON.stringify(temel))
    yigin.placedRects = []
    yigin.s.pumps = 8; yigin.s.evChargers = 4
    yigin.placedPos = { ...temel.placedPos }
    yigin.placedRot = { ...temel.placedRot }
    for (let i = 3; i < 8; i++) yigin.placedPos[`pump-${i}`] = [0.9, -18]
    d.kayit.yukle(yigin)
    out.yiginSonrasi = yuvalar()
    out.yiginPos = Object.fromEntries(Object.entries(d.kayit.yuk().placedPos).filter(([k]) => k.startsWith('pump-')))
    out.yiginBina = d.kayit.binalar().filter(x => x.startsWith('pump-')).sort()

    // --- 4c) DOKUNULMAZLIK: konumu OLAN, aralıklı yerleştirilmiş pompalar kıpırdamıyor
    const elle = JSON.parse(JSON.stringify(temel))
    elle.placedRects = []
    elle.s.pumps = 6; elle.s.evChargers = 2
    elle.placedPos = { ...temel.placedPos }
    const elleKonum = {
      'pump-0': [0.9, -2.2], 'pump-1': [0.9, 2.2], 'pump-2': [0.9, -14],
      'pump-3': [0.9, -18], 'pump-4': [-3, -6], 'pump-5': [-3, 6],
    }
    Object.assign(elle.placedPos, elleKonum)
    d.kayit.yukle(elle)
    const sonra = d.kayit.yuk().placedPos
    out.elleOynayan = Object.entries(elleKonum)
      .filter(([k, v]) => !sonra[k] || sonra[k][0] !== v[0] || sonra[k][1] !== v[1])
      .map(([k, v]) => `${k}: ${JSON.stringify(v)} → ${JSON.stringify(sonra[k])}`)
    out.elleYuva = yuvalar()

    // --- 4d) İDEMPOTENS: ikinci yeniden kurulum hiçbir yuvayı oynatmıyor
    const oncePos = JSON.stringify(d.kayit.yuk().placedPos)
    const onceYuva = JSON.stringify(yuvalar())
    d.place.rebuild()
    out.idempotentPos = JSON.stringify(d.kayit.yuk().placedPos) === oncePos
    out.idempotentYuva = JSON.stringify(yuvalar()) === onceYuva

    // --- 4e) ESKİ KAYIT (yeni alanlar yok) çökmeden yükleniyor
    let eskiHata = null
    try {
      d.kayit.yukle({ s: { money: 12345, day: 7, pumps: 2, evChargers: 1, marketLevel: 1 } })
    } catch (e) { eskiHata = String(e) }
    out.eskiHata = eskiHata
    out.eskiYuva = yuvalar()
    return out
  })

  const enY = arr => {
    let m = Infinity, c = null
    for (let i = 0; i < arr.length; i++) for (let j = i + 1; j < arr.length; j++) {
      const dd = Math.hypot(arr[i][0] - arr[j][0], arr[i][1] - arr[j][1])
      if (dd < m) { m = dd; c = [i, j] }
    }
    return { d: m, c }
  }
  const kp = enY(r.konumsuz.pump), ke = enY(r.konumsuz.ev)
  check(`KONUMSUZ kayıt: 8 pompa yuvası ayrı (en yakın çift ${kp.d.toFixed(3)})`, kp.d >= 2.8,
    `#${kp.c?.[0]}↔#${kp.c?.[1]} = ${kp.d.toFixed(3)} · ${JSON.stringify(r.konumsuz.pump)}`)
  check(`KONUMSUZ kayıt: 8 şarj yuvası ayrı (en yakın çift ${ke.d.toFixed(3)})`, ke.d >= 2.8,
    `#${ke.c?.[0]}↔#${ke.c?.[1]} = ${ke.d.toFixed(3)} · ${JSON.stringify(r.konumsuz.ev)}`)

  const yp = enY(r.yiginSonrasi.pump)
  check(`YIĞILMIŞ kayıt (5 pompa aynı noktada): ayrıştı (en yakın çift ${yp.d.toFixed(3)})`,
    yp.d >= 2.8, `${yp.d.toFixed(3)} · ${JSON.stringify(r.yiginSonrasi.pump)}`)
  check('YIĞILMIŞ kayıt: taşınan pompaların konumu KAYDA yazıldı',
    [3, 4, 5, 6, 7].every(i => Array.isArray(r.yiginPos[`pump-${i}`])),
    JSON.stringify(r.yiginPos))
  check('YIĞILMIŞ kayıt: hiçbir pompa silinmedi (8 pompanın 8\'i de SAHNEDE)',
    r.yiginBina.length === 8, r.yiginBina.join(', '))

  check('KONUMU OLAN pompalar KIPIRDAMIYOR (birebir koordinat)',
    r.elleOynayan.length === 0, r.elleOynayan.join(' | '))
  const ep = enY(r.elleYuva.pump)
  check(`elle yerleştirilmiş 6 pompanın yuvaları da ayrı (${ep.d.toFixed(3)})`, ep.d >= 2.8,
    JSON.stringify(r.elleYuva.pump))

  check('İDEMPOTENS: ikinci yeniden kurulum kaydı oynatmıyor', r.idempotentPos === true)
  check('İDEMPOTENS: ikinci yeniden kurulum yuvaları oynatmıyor', r.idempotentYuva === true)

  check('ESKİ kayıt (yeni alanlar yok) çökmüyor', r.eskiHata === null, String(r.eskiHata))
  check('ESKİ kayıtta yuvalar geçerli', r.eskiYuva.pump.length === 2 && r.eskiYuva.pump.every(v => isFinite(v[0])))

  // ─────────────────────── 5) RUSH ALTINDA 30 SN: POMPA FAZINDA İÇ İÇE ÇİFT = 0
  console.log('\n== 5) Rush altında 30 sn ölçüm: pompa fazındaki araçlarda iç içe çift ==')
  // TAZE SAYFA: 4. bölüm kasten BOZUK kayıtlarla oynadı (eski/eksik save dahil), o
  // durumdan trafik ölçmek anlamsız olurdu. Ayrıca MİSAFİR KAPISI kapatılır:
  // gate açıkken entryChance 0'dır (guestPaused) — yol canlı, istasyon ÖLÜ görünür,
  // ölçüm BOŞ KÜMEDEN geçerdi. Bu satır olmadan "iç içe 0" iddiası kanıt değildir.
  await p.goto(`http://localhost:${PORT}/?full=1`, { waitUntil: 'load' })
  await p.waitForFunction(() => window.__dbg?.kayit, null, { timeout: 60_000 })
  await p.evaluate(() => { document.getElementById('gguest')?.click() })
  await p.waitForTimeout(1200)
  await p.evaluate(() => {
    const d = window.__dbg, s = d.state
    for (let c = 0; c < 3; c++) for (let rr = 0; rr < 3; rr++) d.kayit.arsaAl(c, rr)
    s.money = 5e8
    const k = JSON.parse(JSON.stringify(d.kayit.yuk()))
    k.placedPos = {}; k.placedRot = {}; k.placedRects = []
    k.s.pumps = 8; k.s.evChargers = 8
    d.kayit.yukle(k)
    s.reputation = 5; s.signLevel = 3
    s.promo = { type: 'rush', until: Date.now() + 600_000 }   // müşteri patlaması
    // İKİ AYRI ÖLÇÜT — bilerek ayrıldı, çünkü FARKLI şeylerin kusurları:
    //  (a) ÜNİTEDE DURAN araçlar (atPump): oyuncunun şikâyet ettiği "pompa önünde
    //      4-5 araç iç içe" tam olarak budur. Ölçüt 2.15 (araç gövdesi 2.66'nın altı).
    //  (b) HER görünür çift < 1.0: şerit mimarisinin KENDİ garantisi (UNIT_CLEAR=1.05 —
    //      akan araç ünitede duranın gövdesine binmez). Akan araç duranın 1.05 yanından
    //      geçer; bu TASARIM, kusur değil — o yüzden akış çiftlerine 2.15 uygulanmaz.
    window.__olcum = { ornek: 0, pompaIcice: 0, agir: 0, enKotu: null, agirKotu: null,
                       enYakinPompa: Infinity, aracOrnek: 0, enKalabalik: 0 }
    window.__olcumTimer = setInterval(() => {
      const o = window.__olcum
      const gorunur = d.cars.cars.filter(x => x.phase !== 'gone' && x.phase !== 'transit')
      const duran = gorunur.filter(x => x.phase === 'atPump')
      o.ornek++
      o.aracOrnek += duran.length
      if (duran.length > o.enKalabalik) o.enKalabalik = duran.length
      const nokta = c => [+c.group.position.x.toFixed(1), +c.group.position.y.toFixed(1)]
      for (let i = 0; i < duran.length; i++) for (let j = i + 1; j < duran.length; j++) {
        const dd = Math.hypot(duran[i].group.position.x - duran[j].group.position.x,
                              duran[i].group.position.y - duran[j].group.position.y)
        if (dd < o.enYakinPompa) o.enYakinPompa = dd
        if (dd < 2.15 && !o.enKotu) o.enKotu = [+dd.toFixed(2), nokta(duran[i]), nokta(duran[j])]
        if (dd < 2.15) o.pompaIcice++
      }
      for (let i = 0; i < gorunur.length; i++) for (let j = i + 1; j < gorunur.length; j++) {
        const dd = Math.hypot(gorunur[i].group.position.x - gorunur[j].group.position.x,
                              gorunur[i].group.position.y - gorunur[j].group.position.y)
        if (dd < 1.0) {
          o.agir++
          if (!o.agirKotu) o.agirKotu = [gorunur[i].phase, gorunur[j].phase, +dd.toFixed(2),
            nokta(gorunur[i]), nokta(gorunur[j])]
        }
      }
    }, 250)
  })
  await p.waitForTimeout(30_000)
  const olcum = await p.evaluate(() => {
    clearInterval(window.__olcumTimer)
    const d = window.__dbg
    return { ...window.__olcum, arac: d.cars.cars.length,
      pompada: d.cars.cars.filter(x => x.phase === 'atPump').length }
  })
  check(`30 sn / ${olcum.ornek} örnek · sahnede ${olcum.arac} araç · pompada ${olcum.pompada}`, olcum.ornek > 50,
    `örnek ${olcum.ornek}`)
  // BOŞ KÜMEDEN GEÇEN İDDİA YASAK: ölçüm gerçekten pompa fazındaki araçları görmüş olmalı
  check(`ölçüm DOLU kümede yapıldı (en kalabalık kare ${olcum.enKalabalik} araç · toplam ${olcum.aracOrnek} örnek-araç)`,
    olcum.enKalabalik >= 4 && olcum.aracOrnek >= 100,
    `enKalabalik ${olcum.enKalabalik} · aracOrnek ${olcum.aracOrnek}`)
  check(`ÜNİTEDE DURAN araçlarda iç içe çift (<2.15) = 0 (en yakın çift ${isFinite(olcum.enYakinPompa) ? olcum.enYakinPompa.toFixed(2) : '—'})`,
    olcum.pompaIcice === 0, `${olcum.pompaIcice} çift · ${JSON.stringify(olcum.enKotu)}`)
  // AĞIR ÇAKIŞMA ORANI: araç-araç çarpışması mimari kararla YOK ("gerekirse birbirinin
  // içinden geçsinler"), bu yüzden akan araç yuvasına kıvrılırken bir kare boyunca
  // duranın 1 biriminin içine girebilir. Ölçüt bu yüzden MUTLAK sıfır değil, ORAN —
  // traffic-load.mjs ile aynı çıta (iç içe çift/kare ≤ 0.3). Regresyon (ör. yuvaların
  // yeniden üst üste binmesi) bu oranı anında ondalık basamaklarca yukarı iter.
  const agirOran = olcum.agir / Math.max(1, olcum.ornek)
  check(`ağır çakışma (<1.0) oranı ≤ 0.3 çift/kare (ölçülen ${agirOran.toFixed(3)})`,
    agirOran <= 0.3, `${olcum.agir} çift / ${olcum.ornek} kare · ${JSON.stringify(olcum.agirKotu)}`)

  // ─────────────────────── 6) REPLAY KANCASI
  console.log('\n== 6) Replay kancası: snapshot sahneye birebir kuruluyor ==')
  const rep = await p.evaluate(() => {
    const d = window.__dbg
    const snap = {
      k: 'icice', day: 12, loc: 'kasaba', pumps: 3, ev: 1,
      cars: [[1.8, -2.2, 'atPump', 0, 'fuel'], [1.9, -2.1, 'driving', 0, 'fuel'],
             [1.8, 2.2, 'atPump', 1, 'fuel'], [0.4, -6, 'waiting', -1, 'ev']],
      slots: { pump: [[1.8, -2.2], [1.8, 2.2], [1.8, -14]], ev: [[1.8, 5.7]] },
      yapi: [['pump-0', 0.9, -2.2, 0], ['pump-1', 0.9, 2.2, 0], ['pump-2', 0.9, -14, 0],
             ['charger-0', 1.2, 5.7, 0], ['tank', -5.5, -6.5, 0]],
    }
    const out = d.kayit.trafikSahnesi(snap)
    return { ...out, bekleneN: snap.cars.length,
      pompaSayisi: d.state.pumps, evSayisi: d.state.evChargers, gun: d.state.day,
      yuva: d.world.pumpSlots.slice(0, 3).map(v => [+v.x.toFixed(2), +v.y.toFixed(2)]) }
  })
  check(`replay: kuruldu === araç sayısı (${rep.kuruldu}/${rep.bekleneN})`, rep.kuruldu === rep.bekleneN,
    `${rep.kuruldu} vs ${rep.bekleneN}`)
  check('replay: sayaçlar snapshot\'tan geldi',
    rep.pompaSayisi === 3 && rep.evSayisi === 1 && rep.gun === 12,
    `pompa ${rep.pompaSayisi} · ev ${rep.evSayisi} · gün ${rep.gun}`)
  check('replay: yuvalar snapshot ile birebir',
    JSON.stringify(rep.yuva) === JSON.stringify([[1.8, -2.2], [1.8, 2.2], [1.8, -14]]),
    JSON.stringify(rep.yuva))
  check('replay: uyumsuz listesi dizi olarak dönüyor', Array.isArray(rep.uyumsuz), JSON.stringify(rep.uyumsuz))

  check('tur boyunca sayfa hatası yok', hatalar.length === 0, hatalar.slice(0, 2).join(' | '))
  await b.close()
}

console.log(`\n${fail === 0 ? '✅' : '❌'} pompa slot + trafik olay: ${pass} geçti, ${fail} kaldı`)
process.exit(fail === 0 ? 0 : 1)
