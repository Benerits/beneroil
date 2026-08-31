/**
 * DEVİR SONRASI KUMBARA TESTİ (#1250) — "oto yıkama ve tır parkı hariç diğerlerinin
 * kumbarası ASLA birikmiyor".
 *
 * ÖLÇÜLEN KÖK NEDEN (tarayıcı probu, ?full=1, müdür KAPALI, aynı istasyon, 3'er dk):
 *
 *     tesis          pompacı VAR   pompacı YOK
 *     market            ₺740/dk        ₺0/dk
 *     restoran          ₺559/dk        ₺0/dk
 *     oto yıkama        ₺237/dk        ₺0/dk
 *     kahveci           ₺206/dk        ₺0/dk
 *     hava-su            ₺17/dk        ₺0/dk
 *     tır parkı         ₺276/dk      ₺204/dk   ← PASİF
 *     otel              ₺339/dk      ₺291/dk   ← PASİF
 *     self yıkama        ₺58/dk       ₺64/dk   ← PASİF
 *
 * Tır parkı / self yıkama / otel kumbarası state.tick() zamanlayıcısından dolar.
 * DİĞER HEPSİ aracın pompada SERVİS EDİLMESİNİ bekler (concludeService →
 * facilityVisits / vehicleServices). handover() `autoPumps`/`autoChargers`'ı KOŞULSUZ
 * siliyordu → pompada kimse kalmıyor → araç servis edilmiyor → müşteri kaynaklı her
 * kumbara ₺0'da donuyor, pasif olanlar dolmaya devam ediyor. Oyuncunun tarif ettiği
 * seçicilik BİREBİR bu. Üstelik devir raporu "Devraldığın kadro" yazıp tersini söylüyordu.
 *
 * FIX: devir, pompacısı olan oyuncunun pompacısını ayakta kalan tek pompada KORUR
 * (miras, bağış değil). Devir yapmış MEVCUT kayıtlar devirKadroOnar() ile TEK SEFER
 * onarılır. Rapora "· pompacı" satırı eklendi.
 *
 * Kullanım:  npm run dev -- --port 5399   →   node tools/tests/devir-kumbara-check.mjs
 *            (dev sunucu YOKSA test HATA verir — atlanan ölçüm geçmiş sayılmaz)
 */
globalThis.localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} }
Object.defineProperty(globalThis, 'navigator', { value: { language: 'tr' }, configurable: true })

const { GameState, serializeState, hydrateState, devirKadroOnar } =
  await import('../../src/state.ts')

let pass = 0, fail = 0
const check = (n, c, d = '') => { c ? (pass++, console.log('  ✓ ' + n)) : (fail++, console.log(`  ✗ ${n}${d ? ' — ' + d : ''}`)) }

/** Devir eşiğini geçen gerçekçi istasyon */
const buyuk = () => {
  const x = new GameState()
  x.pumps = 14; x.evChargers = 12; x.signLevel = 3; x.tankLevel = 3
  x.marketLevel = 3; x.market2Level = 3; x.toiletLevel = 2; x.toilet2Level = 2
  x.gridLevel = 2; x.batteryLevel = 6; x.solarCount = 6
  x.airWaterCount = 3; x.selfWashCount = 3; x.parkingCount = 8; x.lampCount = 6
  x.tankCounts = { benzin: 4, dizel: 4, lpg: 4 }
  x.hasWash = x.hasOil = x.hasCoffee = x.hasRestaurant = x.hasTruckPark = true
  x.hasWash2 = x.hasOil2 = x.hasCoffee2 = x.hasRestaurant2 = x.hasTruckPark2 = true
  x.hasSMR = x.hasDiesel = x.hasHotel = x.hasCleaner = x.wideGates = true
  x.day = 120; x.money = 50_000
  x.salesLog = Array.from({ length: 30 }, (_, i) => ({ day: 120 - i, rev: 9000 }))
  return x
}
const roundTrip = s => { const d = new GameState(); hydrateState(d, JSON.parse(JSON.stringify(serializeState(s)))); return d }

// ──────────────────────────────────────── 1) DEVİR POMPACIYI ARTIK YOK ETMİYOR
console.log('\n== 1) Devir: pompacı MİRASI ==')
{
  const s = buyuk()
  s.autoPumps = new Set([0, 1, 2, 3, 4])
  s.autoChargers = new Set([0, 1])
  check('devir öncesi devir mümkün', s.canHandover())
  s.handover()
  check('devir SONRASI pompada pompacı VAR (müşteri kumbaraları dolabilir)',
    s.autoPumps.size > 0, `autoPumps=${[...s.autoPumps]}`)
  check('pompacı ayakta kalan pompaya (index 0) oturur', s.autoPumps.has(0) && s.pumps > 0,
    `pumps=${s.pumps}`)
  check('miras BAĞIŞ DEĞİL: tek pompaya tek pompacı (denge kaymaz)', s.autoPumps.size === 1)
  check('şarj ünitesi kalmadığı için şarjcı devrolmaz', s.autoChargers.size === 0)
}
{
  // hiç pompacısı olmayan oyuncu devirden pompacı KAZANMAZ — bu bir bağış değil, miras
  const s = buyuk()
  s.autoPumps = new Set(); s.autoChargers = new Set()
  s.handover()
  check('pompacısı OLMAYAN oyuncu devirde pompacı KAZANMAZ', s.autoPumps.size === 0)
}

// ──────────────────────────────────────── 2) MEVCUT BOZUK KAYITLAR KENDİLİĞİNDEN DÜZELİR
console.log('\n== 2) Eski (bozuk) kayıt onarımı — TEK SEFER ==')
{
  // eski devir kodunun bıraktığı durum: devretmiş + müdür var + HİÇ pompacı yok
  const bozuk = buyuk()
  bozuk.brandStars = 2; bozuk.managerLevel = 1; bozuk.staffLevel = 1
  bozuk.autoPumps = new Set(); bozuk.autoChargers = new Set()
  const kayit = JSON.parse(JSON.stringify(serializeState(bozuk)))
  check('eski kayıtta onarım bayrağı YOK (ADDITIVE)', kayit.devirKadroOnarildi === false || kayit.devirKadroOnarildi === undefined)

  const y = new GameState()
  hydrateState(y, kayit)
  check('bozuk kayıt yüklenince pompacı geri geliyor', y.autoPumps.size > 0, `autoPumps=${[...y.autoPumps]}`)
  check('onarım bayrağı yazıldı', y.devirKadroOnarildi === true)
  check('oyuncuya SEBEBİ söyleniyor (sessiz onarım yok)',
    y.events.some(e => e.includes('pompac')), JSON.stringify(y.events))

  // TEK SEFER: oyuncu pompacısını kovarsa bir daha zorla işe alınmaz
  y.autoPumps = new Set()
  const y2 = roundTrip(y)
  check('onarım TEKRARLANMAZ (oyuncu pompacısını kovabilir)', y2.autoPumps.size === 0)
  check('bayrak round-trip’te korunuyor', y2.devirKadroOnarildi === true)
}
{
  // İMZA DAR: devretmemiş / zaten pompacısı olan oyuncuya DOKUNULMAZ
  const hic = new GameState()
  check('hiç devretmemiş oyuncuya dokunulmaz', devirKadroOnar(hic) === false)
  const varOlan = buyuk()
  varOlan.brandStars = 1; varOlan.managerLevel = 1; varOlan.autoPumps = new Set([0])
  check('zaten pompacısı olan oyuncuya dokunulmaz', devirKadroOnar(varOlan) === false)
  const mudursuz = buyuk()
  mudursuz.brandStars = 1; mudursuz.managerLevel = 0; mudursuz.autoPumps = new Set()
  check('devrin verdiği müdürü olmayan kayda dokunulmaz', devirKadroOnar(mudursuz) === false)
}
{
  // eski kayıt (alan hiç yok) ÇÖKMEDEN yüklenir
  const eski = JSON.parse(JSON.stringify(serializeState(buyuk())))
  delete eski.devirKadroOnarildi
  delete eski.brandStars
  delete eski.handoverCount
  let crashed = null
  try { const z = new GameState(); hydrateState(z, eski) } catch (e) { crashed = e.message }
  check('alanı OLMAYAN eski kayıt çökmeden yükleniyor', crashed === null, crashed ?? '')
}

// ──────────────────────────────────────── 3) PASİF/AKTİF AYRIMI KODDA DURUYOR MU
console.log('\n== 3) Gelir yolları: pasif vs müşteri kaynaklı ==')
{
  const s = new GameState()
  s.hasTruckPark = true; s.hasHotel = true; s.selfWashCount = 2
  s.reputation = 4
  s.truckTimer = 0.01; s.hotelTimer = 0.01; s.selfWashTimer = 0.01
  s.managerLevel = 0 // müdür kumbaraları boşaltmasın
  s.autoPumps = new Set() // POMPACI YOK — pasif gelir bundan ETKİLENMEMELİ
  for (let i = 0; i < 40; i++) s.tick(2)
  check('tır parkı kumbarası pompacısız da dolar (PASİF)', (s.pendingCash.truckpark ?? 0) > 0)
  check('otel kumbarası pompacısız da dolar (PASİF)', (s.pendingCash.hotel ?? 0) > 0)
  check('self yıkama kumbarası pompacısız da dolar (PASİF)', (s.pendingCash.selfwash ?? 0) > 0)
  check('müşteri kaynaklı tesisler pompacısız BOŞ (kök nedenin imzası)',
    !(s.pendingCash.market > 0) && !(s.pendingCash.wash > 0) && !(s.pendingCash.oil > 0),
    JSON.stringify(s.pendingCash))
}
{
  // kumbara tavanı hiçbir tesiste 0 değil (gelir kapısı tavan yüzünden kapanmasın)
  const s = new GameState()
  s.brandStars = 5
  const hepsi = ['market', 'market2', 'toilet', 'toilet2', 'wash', 'wash2', 'oil', 'oil2',
    'coffee', 'coffee2', 'restaurant', 'restaurant2', 'truckpark', 'truckpark2',
    'hotel', 'selfwash', 'airwater', 'parking']
  const sifir = hepsi.filter(id => s.pendingCap(id) <= 0)
  check('devirden sonra hiçbir tesisin kumbara tavanı 0 değil', sifir.length === 0, sifir.join(','))
}

// ──────────────────────────────────────── 4) TARAYICI: GERÇEK GELİR ÖLÇÜMÜ
// Bu bölüm testin ASIL kanıtı. Dev sunucu yoksa SESSİZCE ATLANMAZ — HATA verir.
const PORTLAR = process.env.PORT ? [process.env.PORT] : ['5399', '5311', '5173', '5174']
let PORT = null
for (const p of PORTLAR) {
  try { if ((await fetch(`http://localhost:${p}/`, { signal: AbortSignal.timeout(1500) })).ok) { PORT = p; break } }
  catch { /* sıradaki */ }
}
if (!PORT) {
  console.log(`\n❌ dev sunucu bulunamadı (${PORTLAR.join(', ')}) — GELİR ÖLÇÜMÜ KOŞMADI.`)
  console.log('   Bu bölüm testin asıl kanıtı; atlanırsa sonuç GEÇTİ sayılmaz.')
  console.log(`   Çalıştır: npm run dev -- --port ${PORTLAR[0]}`)
  fail++
} else {
  const SURE = Number(process.env.SURE ?? 120)
  console.log(`\n== 4) Tarayıcı gelir ölçümü (:${PORT}, ${SURE} sn × 2 kol) ==`)
  const { chromium } = await import('playwright-core')

  // MİSAFİR KAPISI oyunu DONDURUYOR (ilk-10k / gün-2 dönüşüm kapıları). Kapı açık
  // kalırsa state.tick HİÇ koşmaz ve ölçüm "her şey sıfır" diye YANLIŞ NEGATİF verir
  // (bu tuzağa ölçüm yazılırken bilfiil düşüldü). Watcher kapıyı anında kapatır.
  const GATE_WATCHER = () => {
    window.__gateHits = 0
    setInterval(() => {
      const g = document.getElementById('authgate')
      if (g && getComputedStyle(g).display !== 'none') {
        const btn = document.getElementById('gguest')
        if (btn && getComputedStyle(btn).display !== 'none') { window.__gateHits++; btn.click() }
      }
    }, 200)
  }
  const MUSTERI = ['market', 'coffee', 'restaurant', 'wash', 'oil', 'airwater']
  const PASIF = ['truckpark', 'hotel', 'selfwash']

  /** pompaci=true → fix sonrası devir durumu; false → hatanın bıraktığı durum */
  async function olc(pompaci) {
    const b = await chromium.launch({ channel: 'chrome' })
    const p = await b.newPage()
    const hatalar = []
    p.on('pageerror', e => hatalar.push(e.message))
    await p.goto(`http://localhost:${PORT}/?full=1`, { waitUntil: 'load' })
    await p.waitForFunction(() => window.__dbg?.kayit, null, { timeout: 60_000 })
    await p.evaluate(GATE_WATCHER)
    await p.waitForTimeout(600)

    const kur = await p.evaluate((pompaci) => {
      const d = window.__dbg, s = d.state
      // GERÇEK DEVİR (state tarafı) + main.ts'in yerleşim temizliği + reload.
      // Devir ÖNCESİ oyuncunun pompacısı VAR (full mod kimseyi işe almıyor) — mirasın
      // ölçülebilmesi için gerçek oyuncu durumu kurulur.
      s.money = 500_000_000
      for (let i = 0; i < s.pumps; i++) s.autoPumps.add(i)
      const res = s.handover()
      const mirasPompaci = s.autoPumps.size // devrin BIRAKTIĞI kadro (yükleme onarımından ÖNCE)
      const save = JSON.parse(JSON.stringify(d.kayit.yuk()))
      const KEEP = new Set(['gatein', 'gateout', 'office', 'tank'])
      for (const k of Object.keys(save.placedPos)) if (!KEEP.has(k)) delete save.placedPos[k]
      for (const k of Object.keys(save.placedRot)) if (!KEEP.has(k)) delete save.placedRot[k]
      save.placedRects = save.placedRects.filter(x => KEEP.has(x.id))
      d.kayit.yukle(save)
      // oyuncu tesisleri yeniden kuruyor
      s.pumps = 4; s.signLevel = 3; s.tankLevel = 3
      s.marketLevel = 2; s.toiletLevel = 2; s.gridLevel = 2; s.batteryLevel = 3
      s.evChargers = 4; s.solarCount = 1; s.hasDiesel = true
      s.hasWash = true; s.hasOil = true; s.airWaterCount = 1; s.selfWashCount = 1
      s.hasCoffee = true; s.hasRestaurant = true; s.hasTruckPark = true
      s.hasHotel = true; s.parkingCount = 1; s.wideGates = true
      d.place.rebuild()
      // ÖLÇÜM ŞARTI: müdür KAPALI (yoksa kumbaraları boşaltır, ölçüm okunmaz)
      s.managerLevel = 0
      if (!pompaci) s.autoPumps = new Set() // hatanın bıraktığı durumu yeniden üret
      else for (let i = 0; i < s.pumps; i++) s.autoPumps.add(i)
      s.money = 10_000_000
      for (const f of Object.keys(s.tanks)) s.tanks[f] = s.fuelCapacity(f)
      s.battery = s.batteryCapacity
      s.pendingCash = {}; s.facTotal = {}; s.facDaily = {}; s.facLost = {}
      window.__t0 = performance.now()
      return { mirasPompaci, stars: res?.stars ?? 0 }
    }, pompaci)

    await p.waitForTimeout(SURE * 1000)
    const r = await p.evaluate(() => {
      const s = window.__dbg.state
      const dk = (performance.now() - window.__t0) / 60000
      const gelir = {}
      for (const [k, v] of Object.entries(s.facTotal)) gelir[k] = Math.round(v / dk)
      return { dk: +dk.toFixed(2), gelir, kumbara: JSON.parse(JSON.stringify(s.pendingCash)), kapi: window.__gateHits }
    })
    r.kur = kur
    r.hatalar = hatalar
    await b.close()
    return r
  }

  const varr = await olc(true)
  const yok = await olc(false)

  console.log(`\n  | tesis | pompacı VAR ₺/dk | pompacı YOK ₺/dk |`)
  console.log('  |---|---:|---:|')
  for (const f of [...MUSTERI, ...PASIF]) console.log(`  | ${f} | ${varr.gelir[f] ?? 0} | ${yok.gelir[f] ?? 0} |`)
  console.log(`  (${varr.dk} dk · misafir kapısı ${varr.kapi}/${yok.kapi} kez kapatıldı)\n`)

  // ÖLÇÜM GERÇEKTEN KOŞTU MU? (koşmayan ölçüm geçen ölçüm değildir)
  const pasifVar = PASIF.reduce((a, f) => a + (varr.gelir[f] ?? 0), 0)
  check('ölçüm GERÇEKTEN koştu (pasif gelir akıyor)', pasifVar > 0,
    `pasif=${pasifVar} — simülasyon durmuşsa tüm ölçüm anlamsızdır`)
  check('sayfa hatası yok', varr.hatalar.length === 0 && yok.hatalar.length === 0,
    [...varr.hatalar, ...yok.hatalar].join(' | '))

  // ASIL İDDİA: devir artık pompacıyı yok etmiyor
  check('devir SONRASI pompacı miras kaldı (tarayıcıda, gerçek handover)',
    varr.kur.mirasPompaci > 0, `mirasPompaci=${varr.kur.mirasPompaci}`)

  const musteriVar = MUSTERI.reduce((a, f) => a + (varr.gelir[f] ?? 0), 0)
  const musteriYok = MUSTERI.reduce((a, f) => a + (yok.gelir[f] ?? 0), 0)
  const kazananVar = MUSTERI.filter(f => (varr.gelir[f] ?? 0) > 0)
  check('devir sonrası MÜŞTERİ kaynaklı kumbaralar doluyor', musteriVar > 0, `₺${musteriVar}/dk`)
  check('en az 3 müşteri tesisi kazanıyor (tek tesise bağlı yanlış pozitif değil)',
    kazananVar.length >= 3, kazananVar.join(','))
  check('müşteri geliri pasif gelirden bağımsız olarak var',
    musteriVar > 0 && pasifVar > 0, `müşteri=${musteriVar} pasif=${pasifVar}`)

  // KÖK NEDENİN REGRESYON AĞI: pompacı yokken tam olarak oyuncunun tarif ettiği tablo
  const pasifYok = PASIF.reduce((a, f) => a + (yok.gelir[f] ?? 0), 0)
  check('POMPACISIZ: müşteri kumbaraları ₺0 (kök neden hâlâ bu)', musteriYok === 0, `₺${musteriYok}/dk`)
  check('POMPACISIZ: pasif kumbaralar yine de dolar (oyuncunun gördüğü seçicilik)',
    pasifYok > 0, `₺${pasifYok}/dk`)
  const bosVar = MUSTERI.filter(f => !((varr.gelir[f] ?? 0) > 0))
  console.log(`  (bilgi) pompacı varken kazanmayan müşteri tesisi: ${bosVar.join(',') || 'yok'}`)
}

console.log(`\nSONUÇ: ${pass} geçti, ${fail} kaldı`)
process.exit(fail ? 1 : 0)
