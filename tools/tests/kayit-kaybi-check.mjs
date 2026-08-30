/**
 * KAYIT KAYBI TESTİ — "yapılarım/param bir anda gitti" kümesinin regresyon ağı.
 *
 * NEDEN VAR (canlı oyuncu raporları, 13–29 Ağu):
 *   · "market ve bazı tesisler YENİ ARSA ALINCA ortadan kayboluyor. 2 defa geldi başıma"
 *   · "bir anda ilk istasyonumdaki ofis ve pompalar harici assetlerim kayboldu"
 *   · "Binalarımın yarısı bir anda silindi?"
 *   · "tuvalet mapimde buga girdi allah rızası için silin ya"
 *   · "başka şubeye gittim geldim, marina arsalarımın sayısı düşmüş, iade de olmadı"
 *
 * ÖLÇÜLEN KÖK NEDENLER (hepsi canlı DB kanıtıyla):
 *  1) KREDİ HACZİ YANLIŞ ŞUBEYİ YIKIYORDU. `loan` ŞİRKET alanı ama teminat id'leri
 *     ('market', 'toilet'…) ŞUBE bazlı. Kasabada rehin verilip çevre yolunda temerrüde
 *     düşülünce çevre yolunun binaları siliniyordu. Fix: Loan.loc (ADDITIVE) + haciz
 *     yalnız o şubede; şube bilinmiyorsa haciz YOK, banka ortaklığına düşülür.
 *  2) DEVİR (handover) krediyi/ortaklığı sıfırlamıyordu → canlıda devir yapmış 136 hesap
 *     artık var olmayan binaları gösteren bayat teminat listesi taşıyordu.
 *  3) Biten kredi ('done') yalnız active=false yapıyordu; teminat listesi kayıtta kalıyordu
 *     (canlıda 140 hesap).
 *  4) SUNUCU marina bağlama tablosunda 'karsi' (Karşı Kıyı Parkı) YOKTU → alınan her yer
 *     ilk kayıtta siliniyordu (canlıda 102 marina oyuncusunun hiçbirinde yoktu), ayrıca
 *     bağlama 60 / kışlama 120 tavanı meşru oyuncuyu kırpıyordu (33 + 6 hesap tavanda).
 *  5) rebuildFromState() İDEMPOTENT DEĞİLDİ: dolu istasyonda 28 binanın 19'u ikizleniyor,
 *     eski gövde sahnede tıklanamaz enkaz olarak kalıyordu ("tuvalet mapimde buga girdi").
 *
 * Test EZBER YAPMAZ: gerçek buyItem / serializeState / hydrateState / switchLoc / handover
 * yollarından geçer, tarayıcı bölümünde de gerçek sahneyi yeniden kurar.
 *
 * Kullanım:  npm run dev -- --port 5311   →   npm run test:kayitkaybi
 *            (dev sunucu yoksa tarayıcı bölümü ATLANIR, node bölümü yine koşar)
 */
globalThis.localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} }
Object.defineProperty(globalThis, 'navigator', { value: { language: 'tr' }, configurable: true })

import { readFileSync } from 'node:fs'

const {
  GameState, hydrateState, serializeState, buyItem, LOC_FIELDS, parcelKey,
} = await import('../../src/state.ts')
const { BERTH_KINDS } = await import('../../src/marina.ts')

let pass = 0, fail = 0
const check = (n, c, d = '') => { c ? (pass++, console.log('  ✓ ' + n)) : (fail++, console.log(`  ✗ ${n}${d ? ' — ' + d : ''}`)) }
const layout = () => ({ placedPos: {}, placedRot: {}, placedRects: [] })
const roundTrip = s => { const d = new GameState(); hydrateState(d, JSON.parse(JSON.stringify(serializeState(s)))); return d }

/** Tam donanımlı, iki şubeli, arsaları alınmış oyuncu */
function zenginOyuncu() {
  const s = new GameState()
  s.money = 20_000_000
  s.day = 60
  for (const k of ['0,0', '0,2', '1,0', '1,1', '1,2', '3,0', '3,1']) { s.ownedParcels.add(k); s.pavedParcels.add(k) }
  for (const id of ['pump', 'sign', 'tank', 'market', 'toilet', 'grid', 'battery', 'evcharger',
                    'solar', 'dieselgen', 'wash', 'oil', 'coffee', 'restaurant', 'truckpark',
                    'hotel', 'airwater', 'lamp', 'selfwash', 'parking']) {
    if (!buyItem(s, id)) throw new Error('kurulum başarısız: ' + id)
  }
  for (const id of ['market2', 'toilet2', 'wash2', 'oil2', 'coffee2', 'restaurant2', 'truckpark2']) buyItem(s, id)
  return s
}
/** Kaydın "bina sayımı": her tesisin sayaç/bayrak değeri (kaybı tek tek yakalar) */
const BINA_ALANLARI = LOC_FIELDS.filter(k => k !== 'wear' && k !== 'solarDirt' && k !== 'smrWear')
const sayim = s => Object.fromEntries(BINA_ALANLARI.map(k => [k, JSON.stringify(s[k] ?? null)]))
function farkliOlanlar(a, b) {
  const A = sayim(a), B = sayim(b)
  return Object.keys(A).filter(k => A[k] !== B[k])
}

// ─────────────────────────────────────────────────────────── 1) ARSA → KAYIT → YÜKLEME
console.log('\n== 1) Arsa satın al → kaydet → yükle: hiçbir yapı/parsel kaybolmuyor ==')
{
  const s = zenginOyuncu()
  const oncekiSayim = sayim(s)
  const oncekiParsel = [...s.ownedParcels].sort().join('|')

  // YENİ ARSA (raporun tam senaryosu): sahip ol + betonla
  s.ownedParcels.add(parcelKey(2, 1)); s.pavedParcels.add(parcelKey(2, 1))
  s.ownedParcels.add(parcelKey(4, 1)); s.pavedParcels.add(parcelKey(4, 1))

  const d = roundTrip(s)
  const kayip = Object.keys(oncekiSayim).filter(k => sayim(d)[k] !== oncekiSayim[k])
  check('arsa alımı hiçbir tesisi düşürmedi', kayip.length === 0, kayip.join(', '))
  check('yeni parseller kayıttan geri geldi',
    d.ownedParcels.has('2,1') && d.ownedParcels.has('4,1') && d.pavedParcels.has('2,1') && d.pavedParcels.has('4,1'))
  check('eski parseller duruyor', oncekiParsel.split('|').every(k => d.ownedParcels.has(k)))
  check('parsel sayısı birebir', d.ownedParcels.size === s.ownedParcels.size,
    `${d.ownedParcels.size} ≠ ${s.ownedParcels.size}`)
}

// ─────────────────────────────────────────────────── 2) ŞUBE GEÇİŞİ + ARSA → KAYIP YOK
console.log('\n== 2) Arsa al → şube değiştir → geri dön: tesis/parsel kaybı yok ==')
{
  const s = zenginOyuncu()
  s.unlockedLocs = ['kasaba', 'cevreyolu']
  s.ownedParcels.add('2,1'); s.pavedParcels.add('2,1')
  const kasabaSayim = sayim(s)
  const kasabaParsel = [...s.ownedParcels].sort().join('|')

  s.switchLoc('cevreyolu', layout())
  check('şube değişti', s.activeLoc === 'cevreyolu')
  const ara = roundTrip(s)           // pasif şube snapshot'ı da kayıttan geçsin
  ara.switchLoc('kasaba', layout())
  check('kasabaya dönünce TÜM tesisler yerinde',
    Object.keys(kasabaSayim).every(k => sayim(ara)[k] === kasabaSayim[k]),
    Object.keys(kasabaSayim).filter(k => sayim(ara)[k] !== kasabaSayim[k]).join(', '))
  check('kasabaya dönünce parseller yerinde', [...ara.ownedParcels].sort().join('|') === kasabaParsel,
    `${[...ara.ownedParcels].sort().join('|')} ≠ ${kasabaParsel}`)
}

// ───────────────────────────────────────────────────────── 3) HACİZ ŞUBE SINIRINDA DURUR
console.log('\n== 3) Kredi haczi YALNIZ kredinin alındığı şubede ==')
{
  const s = zenginOyuncu()
  s.unlockedLocs = ['kasaba', 'cevreyolu']
  const teminat = s.eligibleCollateral().map(x => x.id)
  check('teminat gösterilebilir kalem var', teminat.length > 0)
  check('kredi alındı', s.takeLoan(100_000, teminat) === true)
  check('kredi ALINDIĞI ŞUBEYİ kaydediyor (Loan.loc)', s.loan.loc === 'kasaba', String(s.loan.loc))

  const d = roundTrip(s)
  check('loan.loc kayıttan sağ çıkıyor', d.loan.loc === 'kasaba', String(d.loan.loc))

  d.switchLoc('cevreyolu', layout())
  d.money = 0
  let sonuc = null
  for (let i = 0; i < 3 && sonuc !== 'seize'; i++) sonuc = d.processLoanDay()
  check('başka şubede temerrüt "seize" veriyor', sonuc === 'seize', String(sonuc))
  check('haciz o şubede UYGULANAMAZ (loan.loc ≠ activeLoc)', d.loan.loc !== d.activeLoc,
    `loc=${d.loan.loc} aktif=${d.activeLoc}`)

  // Eski kayıt (loc alanı yok) da güvenli tarafa düşmeli
  const eski = roundTrip(s)
  delete eski.loan.loc
  const e2 = new GameState()
  hydrateState(e2, JSON.parse(JSON.stringify(serializeState(eski))))
  check('eski kayıtta loc undefined kalıyor (haciz yolu ortaklığa düşer)', e2.loan.loc === undefined)
  const bozuk = roundTrip(s)
  bozuk.loan.loc = 'uzay-ussu'
  const b2 = new GameState()
  hydrateState(b2, JSON.parse(JSON.stringify(serializeState(bozuk))))
  check('bozuk loc hydrate\'te düşürülüyor', b2.loan.loc === undefined, String(b2.loan.loc))
}

// ─────────────────────────────────────────── 4) BAYAT TEMİNAT LİSTESİ (devir / biten kredi)
console.log('\n== 4) Devir ve biten kredi bayat teminat listesi bırakmıyor ==')
{
  const s = zenginOyuncu()
  s.takeLoan(60_000, s.eligibleCollateral().map(x => x.id))
  check('kredi aktif', s.loan.active === true && s.loan.collateral.length > 0)
  s.money = 10_000_000
  let n = 0
  while (s.loan.active && n++ < 40) s.processLoanDay()
  check('kredi bitti', s.loan.active === false)
  check('biten kredi teminat listesini TEMİZLİYOR', s.loan.collateral.length === 0,
    JSON.stringify(s.loan.collateral))
  check('biten kredi principal/monthly sıfırlıyor', s.loan.principal === 0 && s.loan.monthly === 0)
}
{
  const s = zenginOyuncu()
  s.loan = { active: false, principal: 90_100, monthly: 9052, remaining: 0, overdue: 0,
             collateral: ['market', 'toilet', 'battery'], rate: 0.03, loc: 'kasaba' } // canlıdaki bayat hâl
  s.partner = { active: false, remaining: 4200, share: 0.25 }
  s.brandStars = 1
  // devir eşiğini garantiye al (ekipmanı kabart)
  for (let i = 0; i < 30; i++) buyItem(s, 'parking')
  s.money = 50_000_000
  while (!s.canHandover() && s.equipmentValue() < 20_000_000) { if (!buyItem(s, 'evcharger') && !buyItem(s, 'solar')) break }
  const res = s.canHandover() ? s.handover() : null
  check('devir yapılabildi', res !== null, 'eşik sağlanamadı')
  if (res) {
    check('devir krediyi TAMAMEN sıfırlıyor',
      s.loan.active === false && s.loan.collateral.length === 0 && s.loan.principal === 0,
      JSON.stringify(s.loan))
    check('devir banka ortaklığını da sıfırlıyor', s.partner.active === false && s.partner.remaining === 0)
  }
}

// ───────────────────────────────────────────── 5) SUNUCU ↔ İSTEMCİ MARİNA TABLO SENKRONU
console.log('\n== 5) Sunucu marina tabloları istemciyle senkron (sessiz silme yok) ==')
{
  const srv = readFileSync(new URL('../../server/index.js', import.meta.url), 'utf8')
  const berthTablo = srv.match(/const BERTH_COST = \{([^}]*)\}/)?.[1] ?? ''
  const srvBerths = [...berthTablo.matchAll(/(\w+)\s*:/g)].map(m => m[1])
  for (const k of Object.keys(BERTH_KINDS)) {
    check(`sunucu BERTH_COST '${k}' anahtarını tanıyor`, srvBerths.includes(k),
      'clampMarina bilinmeyen anahtarı SİLER — oyuncunun aldığı yer yok olur')
  }
  const berthCap = Number(srv.match(/out\[k\] = clamp\(s\.berths\[k\], 0, (\d+), 0\)/)?.[1] ?? 0)
  check('bağlama tavanı meşru oyuncuyu kırpmıyor (≥1000)', berthCap >= 1000, `tavan=${berthCap}`)
  const winterCap = Number((srv.match(/s\.winterSlots = clamp\(s\.winterSlots, 0, ([\d_]+), 0\)/)?.[1] ?? '0').replace(/_/g, ''))
  check('kışlama tavanı meşru oyuncuyu kırpmıyor (≥5000)', winterCap >= 5000, `tavan=${winterCap}`)
}

// ──────────────────────────────────── 6) MARİNA ALIMLARI KAYITTAN GERİ GELİYOR (uçtan uca)
console.log('\n== 6) Marina bağlama/kışlama alımları kayıttan geri geliyor ==')
{
  const s = new GameState()
  s.activeLoc = 'marina'; s.unlockedLocs = ['kasaba', 'marina']
  s.money = 500_000_000
  // ön şartlar: mega mevki Mavi Bayrak (çevre tesisleri), kışlama Travel Lift ister
  for (const fid of ['fueldock', 'travelift', 'pumpout', 'wasteoil', 'boom']) buyItem(s, fid)
  for (const k of Object.keys(BERTH_KINDS)) {
    for (let i = 0; i < 3; i++) buyItem(s, 'berth_' + k)
  }
  for (let i = 0; i < 200; i++) buyItem(s, 'winterslot')
  const oncekiBerths = JSON.stringify(s.berths)
  const oncekiWinter = s.winterSlots
  const d = roundTrip(s)
  check('bağlama türlerinin HEPSİ kayıttan geri geldi', JSON.stringify(d.berths) === oncekiBerths,
    `${JSON.stringify(d.berths)} ≠ ${oncekiBerths}`)
  check('kışlama kızak sayısı korunuyor', d.winterSlots === oncekiWinter, `${d.winterSlots} ≠ ${oncekiWinter}`)
  check('istemci bağlama/kışlamada sınır koymuyor (sunucu tavanı buna göre olmalı)',
    oncekiWinter === 200 && Object.values(s.berths).every(v => v === 3))
}

// ────────────────────────────────────────────────── 7) KOD DENETİMİ: kalıcılık invariantları
console.log('\n== 7) Kod denetimi ==')
{
  const main = readFileSync(new URL('../../src/main.ts', import.meta.url), 'utf8')
  check('haciz şube kontrolünden geçiyor (loan.loc === activeLoc)',
    /const ayniSube = state\.loan\.loc === state\.activeLoc/.test(main)
    && /state\.loan\.collateral\.length && ayniSube\) seizeCollateral\(\)/.test(main))
  check('yeniden kurulum ikiz bina üretmiyor (tekilKur)',
    /function tekilKur\(id: string, kur: \(\) => void\)/.test(main)
    && (main.match(/tekilKur\(/g) ?? []).length >= 20)
  const st = readFileSync(new URL('../../src/state.ts', import.meta.url), 'utf8')
  check('SAVE_FIELDS loan alanını taşıyor (loc ADDITIVE olarak içinde)', /'loan'/.test(st))
}

// ─────────────────────────────────────────────────────────── 8) TARAYICI: GERÇEK SAHNE TURU
const PORT = process.env.PORT ?? '5311'
let sunucuVar = false
try { sunucuVar = (await fetch(`http://localhost:${PORT}/`, { signal: AbortSignal.timeout(1500) })).ok } catch { /* yok */ }
if (!sunucuVar) {
  console.log(`\n⚠ dev sunucu :${PORT} kapalı — sahne turu ATLANDI (npm run dev -- --port ${PORT})`)
} else {
  console.log('\n== 8) Sahne turu: arsa al → yeniden kur → kaydet → yükle (gerçek oyun) ==')
  const { chromium } = await import('playwright-core')
  const b = await chromium.launch({ channel: 'chrome' })
  const p = await b.newPage()
  const hatalar = []
  p.on('pageerror', e => hatalar.push(e.message))
  await p.goto(`http://localhost:${PORT}/?full=1`, { waitUntil: 'load' })
  await p.waitForFunction(() => window.__dbg?.kayit, null, { timeout: 60_000 })

  const r = await p.evaluate(() => {
    const d = window.__dbg
    const say = list => { const m = {}; for (const x of list) m[x] = (m[x] || 0) + 1; return m }
    const once = d.kayit.binalar()
    const oncePos = JSON.stringify(d.kayit.yuk().placedPos)

    d.kayit.arsaAl(2, 1)              // YENİ ARSA (raporun senaryosu) — sahip + beton
    const arsaSonrasi = d.kayit.binalar()

    d.place.rebuild()                 // reload'un sahne ayağı
    const kurSonrasi = d.kayit.binalar()

    const yuk = d.kayit.yuk()         // kaydet
    d.kayit.yukle(JSON.parse(JSON.stringify(yuk)))   // yükle + yeniden kur
    const yuklemeSonrasi = d.kayit.binalar()

    return {
      once: say(once), arsaSonrasi: say(arsaSonrasi), kurSonrasi: say(kurSonrasi),
      yuklemeSonrasi: say(yuklemeSonrasi), oncePos,
      kurPos: JSON.stringify(yuk.placedPos), sonPos: JSON.stringify(d.kayit.yuk().placedPos),
      n: once.length,
    }
  })
  const eksik = (a, b) => Object.keys(a).filter(k => (b[k] ?? 0) < a[k])
  const ikiz = m => Object.entries(m).filter(([, v]) => v > 1).map(([k, v]) => `${k}×${v}`)

  check(`sahnede yapı var (${r.n} bina)`, r.n >= 20)
  check('ARSA ALINCA hiçbir yapı kaybolmadı', eksik(r.once, r.arsaSonrasi).length === 0,
    eksik(r.once, r.arsaSonrasi).join(', '))
  check('YENİDEN KURULUNCA hiçbir yapı kaybolmadı', eksik(r.once, r.kurSonrasi).length === 0,
    eksik(r.once, r.kurSonrasi).join(', '))
  check('YENİDEN KURULUM İKİZ BİNA ÜRETMİYOR (hayalet enkaz yok)', ikiz(r.kurSonrasi).length === 0,
    ikiz(r.kurSonrasi).join(', '))
  check('KAYDET→YÜKLE sonrası hiçbir yapı kaybolmadı', eksik(r.once, r.yuklemeSonrasi).length === 0,
    eksik(r.once, r.yuklemeSonrasi).join(', '))
  check('KAYDET→YÜKLE sonrası ikiz bina yok', ikiz(r.yuklemeSonrasi).length === 0,
    ikiz(r.yuklemeSonrasi).join(', '))
  // konumlariSabitle() eksik konumları DOLDURUR (onarım) — ama var olan bir konumu ASLA
  // değiştirmemeli, yoksa yapı her açılışta yer değiştirir ("taşıdığım bina yerine dönüyor").
  {
    const eski = JSON.parse(r.oncePos), yeni = JSON.parse(r.kurPos)
    const degisen = Object.keys(eski).filter(k => JSON.stringify(eski[k]) !== JSON.stringify(yeni[k]))
    check('yeniden kurulum MEVCUT konumları değiştirmiyor', degisen.length === 0, degisen.join(', '))
  }
  check('konumlar ilk yeniden kurulumdan sonra SABİT (kaydet→yükle turunda oynamıyor)',
    r.kurPos === r.sonPos)
  check('tur boyunca sayfa hatası yok', hatalar.length === 0, hatalar.slice(0, 2).join(' | '))
  await b.close()
}

console.log(`\n${fail === 0 ? '✅' : '❌'} kayıt kaybı: ${pass} geçti, ${fail} kaldı`)
process.exit(fail === 0 ? 0 : 1)
