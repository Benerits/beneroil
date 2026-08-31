/**
 * KAYIP BİNA TESTİ — "parasını verdiğim tesis ortadan kayboldu" kümesinin regresyon ağı.
 *
 * CANLI RAPORLAR:
 *   · #1239 "market ve bazı tesisler YENİ ARSA ALINCA ortadan kayboluyor, 2 defa geldi başıma"
 *   · #459  "2 inşaat hariç TÜM bloklar silindi"
 *   · #812  "karşı yakaya self yıkama parası gitti, ünite hiç gelmedi"
 *
 * ÖLÇÜLEN KÖK NEDEN (tarayıcı probu, ?full=1):
 *   Kayıtta SAYAÇ duruyor ama KONUM (placedPos) yoksa, rebuildFromState sayılabilir
 *   tesislerin HER örneğini world.buildX'in AYNI varsayılan noktasına kuruyordu:
 *     selfwash×4 → (-10.5,-6.5) · solar×3 → (-4,-20) · parking×3 · lamp×3 · airwater×3
 *   yani 16 ünitenin 11'i gövde gövdeye binip GÖRÜNMEZ (ve tıklanamaz → satılamaz,
 *   taşınamaz) hale geliyordu. Hemen ardından konumlariSabitle() bu AYNI koordinatı
 *   placedPos'a yazıp persist ediyordu → kayıp KALICI oluyordu.
 *   Konum boşluğu canlıda ölçülmüş bir durumdur (main.ts notu: karşı yaka tesislerinin
 *   ~%14'ünde konum alanı boştu) — yani bu yol teorik değil.
 *
 * FIX (fail-closed): hiçbir yapı SİLİNMEZ. Sayaç ↔ sahne tutmuyorsa yapı geri kurulur
 * (eksikYapilariGeriGetir); üst üste binen nüsha sahipli en yakın BOŞ noktaya taşınır
 * (ustUsteBinenleriAyir). Yer bulunamazsa yapı olduğu yerde bırakılır — asla yok edilmez.
 *
 * Kullanım:  npm run dev -- --port 5399   →   npm run test:kayipbina
 *            (dev sunucu yoksa tarayıcı bölümü ATLANIR, node bölümü yine koşar)
 */
globalThis.localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} }
Object.defineProperty(globalThis, 'navigator', { value: { language: 'tr' }, configurable: true })

import { readFileSync } from 'node:fs'

const {
  GameState, hydrateState, serializeState, buyItem, LOC_FIELDS, parcelKey,
} = await import('../../src/state.ts')

let pass = 0, fail = 0
const check = (n, c, d = '') => { c ? (pass++, console.log('  ✓ ' + n)) : (fail++, console.log(`  ✗ ${n}${d ? ' — ' + d : ''}`)) }
const layout = () => ({ placedPos: {}, placedRot: {}, placedRects: [] })
const roundTrip = s => { const d = new GameState(); hydrateState(d, JSON.parse(JSON.stringify(serializeState(s)))); return d }

/** tesis SAYAÇLARI (yıpranma gibi zamanla değişen alanlar hariç) */
const BINA_ALANLARI = LOC_FIELDS.filter(k => k !== 'wear' && k !== 'solarDirt' && k !== 'smrWear')
const sayim = s => Object.fromEntries(BINA_ALANLARI.map(k => [k, JSON.stringify(s[k] ?? null)]))
const dusenler = (once, sonra) => Object.keys(once).filter(k => sonra[k] !== once[k])

/** her tesisten birden çok örneği olan, arsaları alınmış oyuncu */
function doluOyuncu() {
  const s = new GameState()
  s.money = 500_000_000
  s.day = 80
  for (let c = 0; c < 3; c++) for (let r = 0; r < 3; r++) { s.ownedParcels.add(parcelKey(c, r)); s.pavedParcels.add(parcelKey(c, r)) }
  for (const id of ['pump', 'sign', 'tank', 'market', 'toilet', 'grid', 'battery', 'evcharger',
                    'dieselgen', 'wash', 'oil', 'coffee', 'restaurant', 'truckpark', 'hotel']) {
    if (!buyItem(s, id)) throw new Error('kurulum başarısız: ' + id)
  }
  // sayılabilir tesisler: çoklu örnek (çakışma/kayıp bunlarda ölçüldü)
  for (let i = 0; i < 4; i++) buyItem(s, 'selfwash')
  for (let i = 0; i < 3; i++) { buyItem(s, 'solar'); buyItem(s, 'parking'); buyItem(s, 'airwater'); buyItem(s, 'lamp') }
  return s
}

// ────────────────────────────────────────────────── 1) ARSA ALIMI TESİS DÜŞÜRMÜYOR
console.log('\n== 1) Arsa alımı sonrası HİÇBİR tesis sayacı düşmüyor ==')
{
  const s = doluOyuncu()
  const once = sayim(s)
  const oncekiParselSayisi = s.ownedParcels.size
  // yeni arsa (raporun tam senaryosu): sahiplen + betonla, karşı yaka dahil
  for (const [c, r] of [[3, 0], [3, 1], [0, 0]]) { s.ownedParcels.add(parcelKey(c, r)); s.pavedParcels.add(parcelKey(c, r)) }
  const dusen = dusenler(once, sayim(s))
  check('arsa alımı hiçbir sayacı düşürmedi', dusen.length === 0, dusen.join(', '))
  check('parsel sayısı arttı', s.ownedParcels.size > oncekiParselSayisi)
  check('self yıkama sayacı 4', s.selfWashCount === 4, String(s.selfWashCount))
}

// ─────────────────────────────────────────────── 2) KAYDET → YÜKLE: BİREBİR KORUNUYOR
console.log('\n== 2) Kaydet→yükle turunda tesis sayaçları birebir korunuyor ==')
{
  const s = doluOyuncu()
  for (const [c, r] of [[3, 0], [3, 1]]) { s.ownedParcels.add(parcelKey(c, r)); s.pavedParcels.add(parcelKey(c, r)) }
  const once = sayim(s)
  const d = roundTrip(s)
  const dusen = dusenler(once, sayim(d))
  check('tur sonrası tüm sayaçlar aynı', dusen.length === 0, dusen.join(', '))
  check('parseller birebir', [...d.ownedParcels].sort().join('|') === [...s.ownedParcels].sort().join('|'))
  // iki tur üst üste (otomatik kayıt döngüsü) da aşındırmamalı
  const d2 = roundTrip(roundTrip(d))
  check('üst üste üç tur sonrası hâlâ aynı', dusenler(once, sayim(d2)).length === 0)
}

// ───────────────────────────────────────── 3) PARSEL GEOMETRİSİ DEĞİŞİNCE BİNA DURUYOR
console.log('\n== 3) Parsel geometrisi değişince bina YOK EDİLMİYOR ==')
{
  const s = doluOyuncu()
  const once = sayim(s)
  // arsa geri satışı: geometri küçülüyor (state binaları bilmez — sayaçlara dokunmamalı)
  const satis = s.sellParcel(2, 2)
  check('arsa geri satılabildi', satis !== null && satis.refund > 0)
  check('arsa satışı hiçbir tesis sayacını düşürmedi', dusenler(once, sayim(s)).length === 0,
    dusenler(once, sayim(s)).join(', '))
  // beton kaldırılan/eklenen parsel de sayaçlara dokunmamalı
  s.pavedParcels.delete(parcelKey(1, 0))
  check('beton değişimi sayaçlara dokunmuyor', dusenler(once, sayim(s)).length === 0)
  const d = roundTrip(s)
  check('geometri değişiminden sonraki kayıt turu da temiz', dusenler(once, sayim(d)).length === 0)
}

// ──────────────────────────────────────────── 4) ŞUBE GEÇİŞİ: KARŞI YAKA + SAYILABİLİRLER
console.log('\n== 4) Şube geçişi turu: karşı yaka üniteleri ve çoklu örnekler korunuyor ==')
{
  const s = doluOyuncu()
  for (const [c, r] of [[3, 0], [3, 1]]) { s.ownedParcels.add(parcelKey(c, r)); s.pavedParcels.add(parcelKey(c, r)) }
  for (const id of ['market2', 'toilet2', 'wash2', 'oil2', 'coffee2', 'restaurant2', 'truckpark2']) buyItem(s, id)
  s.farStationOn = true
  const once = sayim(s)
  s.unlockedLocs = ['kasaba', 'cevreyolu']
  s.switchLoc('cevreyolu', layout())
  const ara = roundTrip(s)
  ara.switchLoc('kasaba', layout())
  const dusen = dusenler(once, sayim(ara))
  check('kasabaya dönünce TÜM tesisler yerinde', dusen.length === 0, dusen.join(', '))
  check('karşı istasyon bayrağı korunuyor', ara.farStationOn === true)
  check('self yıkama ×4 korunuyor', ara.selfWashCount === 4, String(ara.selfWashCount))
}

// ─────────────────────────────────────────────────────── 5) ESKİ KAYIT ÇÖKMEDEN YÜKLENİR
console.log('\n== 5) Eski kayıt (yeni alanlar yok) çökmeden yükleniyor ==')
{
  const eski = { money: 12345, day: 7, pumps: 2, marketLevel: 1, selfWashCount: 2, ownedParcels: ['0,1', '0,0'] }
  let s = null, hata = null
  try { s = new GameState(); hydrateState(s, eski) } catch (e) { hata = e }
  check('eski kayıt hydrate ediliyor', hata === null, String(hata))
  check('eski kayıttaki sayaçlar geldi', s && s.marketLevel === 1 && s.selfWashCount === 2 && s.pumps === 2)
  check('bilinmeyen yeni alanlar varsayılana düşüyor (crash yok)',
    s && s.farStationOn === false && s.hasTruckPark2 === false)
  check('eski kayıt yeniden serialize edilebiliyor', (() => { try { serializeState(s); return true } catch { return false } })())
  // tamamen boş kayıt da çökmemeli
  let bosHata = null
  try { hydrateState(new GameState(), {}) } catch (e) { bosHata = e }
  check('boş kayıt çökmüyor', bosHata === null, String(bosHata))
}

// ───────────────────────────────────────────────────────────── 6) KOD DENETİMİ
console.log('\n== 6) Kod denetimi: onarım yolları yerinde ==')
{
  const main = readFileSync(new URL('../../src/main.ts', import.meta.url), 'utf8')
  check('sayaç↔sahne mutabakatı var (eksik yapı geri kuruluyor)',
    /function eksikYapilariGeriGetir\(\): number/.test(main) && /function beklenenYapiIdleri\(\): string\[\]/.test(main))
  check('üst üste binen nüshalar ayrılıyor', /function ustUsteBinenleriAyir\(\): number/.test(main))
  check('onarım rebuildFromState içinden çağrılıyor',
    /konumlariSabitle\(\)\s*\n\s*binaOnarimi\(\)/.test(main)
    && /const onarilan = eksikYapilariGeriGetir\(\)/.test(main)
    && /const ayrilan = ustUsteBinenleriAyir\(\)/.test(main))
  check('FAIL-CLOSED: yer bulunamazsa yapı yerinde bırakılıyor (silme yok)',
    /if \(!hedef\) \{ yerlesik\.push/.test(main))
  check('onarım oyuncuya BİR KEZ bildiriliyor', /onarimBildirildi/.test(main)
    && /Kayıtta kaybolmuş \{0\} tesis bulundu/.test(main))
  const i18n = readFileSync(new URL('../../src/i18n.ts', import.meta.url), 'utf8')
  check('bildirim metni EN+FR sözlükte',
    (i18n.match(/'Kayıtta kaybolmuş \{0\} tesis bulundu ve istasyona geri kondu — hiçbir şey silinmedi\.'/g) ?? []).length === 2)
}

// ──────────────────────────────────────────────── 7) TARAYICI: GERÇEK SAHNE ÖLÇÜMÜ
// PORT SABİT DEĞİL, ARANIYOR + ATLAMA ARTIK SESSİZ DEĞİL.
// Bu bölüm testin ASIL kanıtı (16 ünite gerçekten ayrı ayrı görünüyor mu). Tek bir
// sabit porta bağlıyken, dev sunucu başka portta açıksa bölüm atlanıyor ve test yine
// "✅ 0 kaldı" diyordu — yani en önemli ölçüm koşmadan yeşil rapor çıkıyordu.
// Bugün aynı kalıp üç kez çıktı (web-smoke hiç koşmuyordu, ui-check listesi bayattı).
// Artık: yaygın portlar taranıyor, hiçbiri yoksa test HATA ile bitiyor — atlanan
// ölçüm geçmiş sayılmaz.
const PORTLAR = process.env.PORT ? [process.env.PORT] : ['5399', '5173', '5174']
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
  console.log('\n== 7) Sahne ölçümü: bozuk kayıt · karşı yaka · arsa alımı ==')
  const { chromium } = await import('playwright-core')
  const b = await chromium.launch({ channel: 'chrome' })
  const p = await b.newPage()
  const hatalar = []
  p.on('pageerror', e => hatalar.push(e.message))
  await p.goto(`http://localhost:${PORT}/?full=1`, { waitUntil: 'load' })
  await p.waitForFunction(() => window.__dbg?.kayit, null, { timeout: 60_000 })

  const r = await p.evaluate(() => {
    const d = window.__dbg, s = d.state, out = {}
    const konumlar = () => {
      const m = {}
      for (const b of d.world.buildings) {
        const g = b.group
        ;(m[`${g.position.x.toFixed(2)},${g.position.y.toFixed(2)}`] ||= []).push(b.id)
      }
      return m
    }
    const ustUste = () => Object.values(konumlar()).filter(v => v.length > 1).map(v => v.join('+'))

    // oyuncu arsalarını almış (yer var)
    for (let c = 0; c < 3; c++) for (let rr = 0; rr < 3; rr++) d.kayit.arsaAl(c, rr)
    s.money = 50_000_000

    // --- 7a) SAĞLAM kayıt: yeniden kurulum hiçbir şeyi oynatmıyor / kaybetmiyor
    // (ilk kurulum konumlariSabitle ile eksik alanları DOLDURUR — ölçüm ondan sonra başlar)
    d.place.rebuild()
    const saglam = JSON.parse(JSON.stringify(d.kayit.yuk()))
    const oncekiBinalar = d.kayit.binalar().slice()
    const oncekiPos = JSON.stringify(d.kayit.yuk().placedPos)
    d.place.rebuild()
    out.saglamEksik = oncekiBinalar.filter(x => !d.kayit.binalar().includes(x))
    out.saglamPosDegisti = JSON.stringify(d.kayit.yuk().placedPos) !== oncekiPos
    out.saglamUstUste = ustUste()

    // --- 7b) BOZUK kayıt: sayaç var, konum yok
    const bozuk = JSON.parse(JSON.stringify(saglam))
    bozuk.placedPos = {}; bozuk.placedRot = {}; bozuk.placedRects = []
    bozuk.s.selfWashCount = 4; bozuk.s.solarCount = 3; bozuk.s.parkingCount = 3
    bozuk.s.lampCount = 3; bozuk.s.airWaterCount = 3
    const t0 = performance.now()
    d.kayit.yukle(bozuk)
    out.onarimMs = Math.round(performance.now() - t0)
    const bekle = (n, base) => { const a = []; for (let i = 0; i < n; i++) a.push(i === 0 ? base : `${base}#${i}`); return a }
    const beklenen = [...bekle(4, 'selfwash'), ...bekle(3, 'solar'), ...bekle(3, 'parking'),
                      ...bekle(3, 'lamp'), ...bekle(3, 'airwater')]
    const varOlan = new Set(d.kayit.binalar())
    out.bozukEksik = beklenen.filter(x => !varOlan.has(x))
    out.bozukUstUste = ustUste()
    const pos2 = d.kayit.yuk().placedPos
    out.bozukKonumsuz = beklenen.filter(x => !pos2[x])

    // --- 7c) İDEMPOTENS: ikinci yeniden kurulum hiçbir şeyi bir daha oynatmamalı
    const posA = JSON.stringify(d.kayit.yuk().placedPos)
    d.place.rebuild()
    out.idempotent = JSON.stringify(d.kayit.yuk().placedPos) === posA
    out.idempotentUstUste = ustUste()

    // --- 7d) SAYAÇ VAR / BİNA SAHNEDEN SİLİNMİŞ → geri geliyor mu
    d.world.removeBuildingGroup('market')
    d.world.removeBuildingGroup('selfwash#2')
    d.place.rebuild()
    out.geriGelen = ['market', 'selfwash#2'].filter(x => d.kayit.binalar().includes(x))

    // --- 7e) KARŞI YAKA: ünite karşı yakada kuruluyor ve orada kalıyor
    for (const [c, rr] of [[3, 0], [3, 1], [3, 2]]) d.kayit.arsaAl(c, rr)
    const oncekiSayac = s.selfWashCount
    d.place.start(`selfwash#${s.selfWashCount}`)
    let nokta = null
    for (const y of [-16, -12, -6, 0, 6, 12, 16, -20, 20]) {
      for (let x = 13; x <= 21 && !nokta; x++) { d.place.at(x, y); const g = d.place.ghost(); if (g?.valid) nokta = [g.cx, g.cy] }
      if (nokta) break
    }
    out.karsiNokta = nokta
    if (nokta) { d.place.at(nokta[0], nokta[1]); d.place.confirm() } else d.place.cancel()
    const karsiId = `selfwash#${s.selfWashCount - 1}`
    out.karsiSayacArtti = s.selfWashCount - oncekiSayac
    out.karsiKayit = d.kayit.yuk().placedPos[karsiId] ?? null
    d.kayit.yukle(JSON.parse(JSON.stringify(d.kayit.yuk())))
    const gercek = d.place.real(karsiId)
    out.karsiReloadX = gercek ? gercek.bx : null
    out.karsiSahnede = !!gercek

    // --- 7f) ARSA ALIMI: hiçbir yapı kaybolmuyor
    const oncesi = d.kayit.binalar().slice()
    d.kayit.arsaAl(2, 1); d.kayit.arsaAl(1, 2)
    d.place.rebuild()
    out.arsaSonrasiEksik = oncesi.filter(x => !d.kayit.binalar().includes(x))
    out.arsaSonrasiUstUste = ustUste()
    return out
  })

  check('SAĞLAM kayıt: yeniden kurulumda yapı kaybı yok', r.saglamEksik.length === 0, r.saglamEksik.join(', '))
  check('SAĞLAM kayıt: onarım mevcut konumları OYNATMIYOR', r.saglamPosDegisti === false)
  check('SAĞLAM kayıt: üst üste binen yapı yok', r.saglamUstUste.length === 0, r.saglamUstUste.join(' | '))

  check('BOZUK kayıt (sayaç var, konum yok): her ünite sahnede', r.bozukEksik.length === 0, r.bozukEksik.join(', '))
  check('BOZUK kayıt: HİÇBİR ünite üst üste binmiyor (16 ünite ayrı ayrı görünür)',
    r.bozukUstUste.length === 0, r.bozukUstUste.join(' | '))
  check('BOZUK kayıt: onarılan konumlar kayda yazıldı', r.bozukKonumsuz.length === 0, r.bozukKonumsuz.join(', '))
  check(`onarım makul sürede (${r.onarimMs} ms)`, r.onarimMs < 4000, `${r.onarimMs} ms`)

  check('İDEMPOTENS: ikinci yeniden kurulum yapıları bir daha oynatmıyor', r.idempotent === true)
  check('İDEMPOTENS: ikinci turda da üst üste binme yok', r.idempotentUstUste.length === 0,
    r.idempotentUstUste.join(' | '))

  check('sayaç var ama bina sahneden silinmiş → GERİ GELİYOR (fail-closed)',
    r.geriGelen.length === 2, r.geriGelen.join(', '))

  check('karşı yakada geçerli yerleşim noktası bulunuyor', !!r.karsiNokta, 'karşı yakaya ünite konulamıyor')
  check('karşı yaka alımı sayacı artırıyor', r.karsiSayacArtti === 1, String(r.karsiSayacArtti))
  check('karşı yaka ünitesinin konumu KAYDA yazılıyor', !!r.karsiKayit, String(r.karsiKayit))
  check('karşı yaka ünitesi yeniden kurulumda KARŞI YAKADA doğuyor',
    r.karsiSahnede && r.karsiReloadX > 10.9, `x=${r.karsiReloadX}`)

  check('ARSA ALINCA hiçbir yapı kaybolmadı', r.arsaSonrasiEksik.length === 0, r.arsaSonrasiEksik.join(', '))
  check('ARSA ALINCA üst üste binme oluşmadı', r.arsaSonrasiUstUste.length === 0, r.arsaSonrasiUstUste.join(' | '))
  check('tur boyunca sayfa hatası yok', hatalar.length === 0, hatalar.slice(0, 2).join(' | '))
  await b.close()
}

console.log(`\n${fail === 0 ? '✅' : '❌'} kayıp bina: ${pass} geçti, ${fail} kaldı`)
process.exit(fail === 0 ? 0 : 1)
