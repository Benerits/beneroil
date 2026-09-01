/**
 * KONVEYÖR / BLOK KURALI TESTİ (kuyruk + gelen omurga)
 *
 * KÖKEN: Twitter'da iki oyuncu bağımsız aynı çözümü önerdi, oyun sahibi benimsedi —
 * konveyör bant / blok sinyalizasyonu: araç, önündeki BÖLÜM boşalmadan ilerleyemez.
 * Canlı telemetri (2.707 olay/19 saat): olayların %96'sı iç içe+yığılma; en büyük
 * küme (22x) TEK POMPALI gün-1 istasyonunda kuyruk başı (replay #2647: 4 bekleyen +
 * 1 serviste, burun buruna). Kök: slotlar arası geçişte öndekine mesafe kapısı yoktu.
 *
 * BU TEST NEYİ KANITLAR:
 *  1) Kaynak: kural gerçekten kodda (terfi kapısı + omurga bloğu + 30 sn sigortası).
 *  2) Headless sim (deterministik tohum):
 *     · DURAN kuyruk çifti HİÇBİR karede < 2.5 değil + < 2.66 oranı ~0 (hedef metrik;
 *       yanaşma ANINDAKİ hareketli araç manevradır, duran dizi 2.55 tabanını korur),
 *     · terfi zinciri DETERMİNİSTİK: aynı tohum, iki koşu → aynı dizilim,
 *     · 30 sn kilitlenme kapısı ÇALIŞIYOR (bozuk pompa senaryosunda blok kasıtlı
 *       kilitlenir, kapı açılır, araç yoluna devam eder — buharlaşma yine 0).
 *  3) Tarayıcı (GERÇEK sahne): tek pompalı istasyonda rush altında canlı ölçüm.
 *     PORT TARANIR, SUNUCU YOKSA HATA — sessiz atlama YASAK; boş kümeden geçen
 *     iddia YASAK; ?full=1'de ÖNCE #gguest'e basılır (misafir kapısı açıkken
 *     guestPaused entryChance'i 0 yapar, ölçüm boş geçer).
 *
 * Kullanım:  npm run dev -- --port 5399   →   npx tsx tools/tests/konveyor-check.mjs
 */
globalThis.localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} }
Object.defineProperty(globalThis, 'navigator', { value: { language: 'tr' }, configurable: true })
const noopCtx = new Proxy({}, { get: (_t, k) => (k === 'measureText' ? () => ({ width: 10 }) : () => undefined), set: () => true })
globalThis.document = { createElement: () => ({ width: 0, height: 0, getContext: () => noopCtx }) }
// DETERMİNİST tohum — traffic-load.mjs ile aynı PRNG (aynı senaryo → aynı akış)
let __seed = 0
const __rnd = () => { __seed = (__seed * 1103515245 + 12345) & 0x7fffffff; return __seed / 0x7fffffff }
Math.random = __rnd

import { readFileSync } from 'node:fs'
const THREE = await import('three')
const { CarManager, Car } = await import('../../src/cars.ts')
const { GameState, FUEL_PRICE } = await import('../../src/state.ts')

let pass = 0, fail = 0
const check = (n, c, d = '') => { c ? (pass++, console.log('  ✓ ' + n)) : (fail++, console.log(`  ✗ ${n}${d ? ' — ' + d : ''}`)) }

// ───────────────────────────────────────── 1) KAYNAK: KURAL KODDA MI
console.log('== 1) Kaynak denetimi: konveyör kuralı yerinde ==')
const cars = readFileSync(new URL('../../src/cars.ts', import.meta.url), 'utf8')
check('blok sabitleri tanımlı (BLOK_MESAFE / BLOK_DUR / BLOK_KILIT_SN)',
  /const BLOK_MESAFE = 3\b/.test(cars) && /const BLOK_DUR = 2\.2\b/.test(cars) && /const BLOK_KILIT_SN = 30\b/.test(cars))
check('omurga bloğu her karede işliyor (konveyorBlok çağrısı)',
  /this\.konveyorBlok\(dt\)/.test(cars) && /private konveyorBlok\(dt: number\)/.test(cars))
check('terfi kapısı kuyrukIlerlet\'te (slot boş + öndekine mesafe ≥ BLOK_MESAFE)',
  /d < BLOK_MESAFE/.test(cars) && /occ\[i - 1\]\)/.test(cars))
check('karşı akış bloğa dahil DEĞİL (kilitlenme doğurmasın — heading zıtsa muaf)',
  /od\.x \* dir\.x \+ od\.y \* dir\.y < -0\.3\) continue/.test(cars))
check('30 sn kilitlenme kapısı var (blokMuaf) ve sayacı telemetriye düşüyor',
  /blokMuaf = true/.test(cars) && /blokStats/.test(cars))
check('kural duruşu hardStuckT SAYILMIYOR (bekleme ≠ sıkışma)',
  /this\.hizOrani < 0\.15 && this\.blokFren >= 0\.15\) this\.hardStuckT \+= dt/.test(cars))
// (tekne kapsam dışı ÇIKARKEN blokT'yi de sıfırlar: bayat sayaç, ilerleme bekçisini
//  o araç için sonsuza dek dondururdu — bkz. cars.ts "BLOKT BAYAT KALMASIN")
check('marina bloktan muaf (tekne boyu araç ölçeğinde değil)',
  /if \(c\.boat\) \{ c\.blokT = 0; continue \}/.test(cars))

// ───────────────────────────────────────── 2) HEADLESS SİM
// traffic-load.mjs'in kurulumunun sadeleşmiş hâli: tek pompa, yoğun giriş.
function kurSim({ pumps = 1, brokenPump = false, entryMul = 1.8, pullMul = 2.2, patience = 1 } = {}) {
  __seed = 20260901
  const scene = new THREE.Scene()
  const state = new GameState()
  state.pumps = pumps; state.evChargers = 0; state.wideGates = false
  state.signLevel = 3; state.reputation = 5; state.marketLevel = 3
  const pumpSlots = Array.from({ length: pumps }, (_, i) => new THREE.Vector3(2.4, -6 + (12 / pumps) * (i + 0.5), 0))
  let served = 0, turnedAway = 0
  const mgr = new CarManager(scene, null, {
    pumpCount: () => pumps, evCount: () => 0,
    pumpSlot: i => pumpSlots[Math.min(i, pumpSlots.length - 1)],
    evSlot: () => new THREE.Vector3(1.8, 6, 0),
    pumpAngle: () => 0, evAngle: () => 0,
    gateInY: () => -14, gateOutY: () => 14,
    entryChance: () => Math.min(1, state.entryChance() * entryMul), evShare: () => 0,
    prices: () => FUEL_PRICE, segments: () => state.activeSegments(),
    trafficPull: () => state.trafficPull() * pullMul,
    isPumpBroken: () => brokenPump, isChargerBroken: () => false,
    parkSpots: () => [], truckSpots: () => [], extraObstacles: () => [],
    wideGates: () => false,
    patienceMult: () => patience,
    onCarReady: c => { served++; c.phase = 'atPump' },
    onCarLost: () => {},
    onTurnedAway: () => { turnedAway++ },
  })
  Car.solids = []
  return { mgr, sayac: () => ({ served, turnedAway }) }
}

/** deterministik koşu: her karede kuyruk çifti ölçülür + dizilim transkripti tutulur */
function kosu(saniye, opts) {
  const { mgr, sayac } = kurSim(opts)
  const busy = new Map()
  let ord = 0
  const dizilim = []          // kuyruk kompozisyonu değişince kaydedilir (terfi zinciri izi)
  let sonDizilim = ''
  let ciftMin = Infinity, ciftSert = 0, ciftYakin = 0, ciftOrnek = 0, zirve = 0
  const adim = saniye * 10
  for (let i = 0; i < adim; i++) {
    mgr.update(0.1)
    for (const c of mgr.cars) {
      if (c.__ord === undefined) c.__ord = ord++
      if (c.phase === 'atPump' && !busy.has(c)) busy.set(c, i + 60)
    }
    for (const [c, until] of [...busy]) {
      if (i >= until) { busy.delete(c); if (c.phase === 'atPump') mgr.releaseCar(c) }
    }
    const L = mgr.graph.get('near')
    if (L) {
      // iki segment: ANA hat (xIn kolonu) + BANKET (yol omuzu). Çift, ikisi de aynı
      // segmentteyken ölçülür; kapı manevrasındaki araç o an kolon dışıdır (aşağı bkz.)
      const spillX = L.spillStart < L.queue.length ? L.queue[L.spillStart].x : null
      const hat = c => Math.abs(c.group.position.x - L.xIn) < 0.6 ? 'ana'
        : (spillX != null && Math.abs(c.group.position.x - spillX) < 0.6 ? 'banket' : null)
      const q = mgr.cars.filter(c => c.station === 'near' && c.waitIndex >= 0
        && (c.phase === 'waiting' || c.phase === 'driving') && hat(c))
        .sort((a, b) => a.waitIndex - b.waitIndex)
      if (q.length > zirve) zirve = q.length
      for (let k = 1; k < q.length; k++) {
        if (hat(q[k]) !== hat(q[k - 1])) continue
        const A = q[k - 1], B = q[k]
        const d = Math.hypot(A.group.position.x - B.group.position.x,
                             A.group.position.y - B.group.position.y)
        ciftOrnek++
        if (d < ciftMin) ciftMin = d
        if (d < 2.66) ciftYakin++
        // SERT ihlal = DURAN çift < 2.5 (oyuncunun gördüğü iç içe duran kuyruk).
        // Slota yanaşma ANINDA hareket hâlindeki araç komşusunun 2.2-2.5 yanından
        // geçebilir (manevra); duran dizide ise konveyör 2.55 tabanını garanti eder.
        const durA = Math.hypot(A.group.position.x - (A.__lx ?? NaN), A.group.position.y - (A.__ly ?? NaN)) < 0.02
        const durB = Math.hypot(B.group.position.x - (B.__lx ?? NaN), B.group.position.y - (B.__ly ?? NaN)) < 0.02
        if (d < 2.5 && durA && durB) {
          ciftSert++
          if (process.env.DIAG) {
            console.log(`  SERT t=${(i/10).toFixed(1)} d=${d.toFixed(2)} A#${A.__ord} w${A.waitIndex} ${A.phase}@(${A.group.position.x.toFixed(2)},${A.group.position.y.toFixed(2)})mv${A.moving?1:0}f${A.blokFren.toFixed(1)} B#${B.__ord} w${B.waitIndex} ${B.phase}@(${B.group.position.x.toFixed(2)},${B.group.position.y.toFixed(2)})mv${B.moving?1:0}f${B.blokFren.toFixed(1)}`)
            for (const o of mgr.cars) { if (o.phase==='gone') continue
              const dd = Math.hypot(o.group.position.x-A.group.position.x,o.group.position.y-A.group.position.y)
              if (dd < 6) console.log(`    çevre #${o.__ord} w${o.waitIndex} s${o.slotIndex} ${o.phase}@(${o.group.position.x.toFixed(2)},${o.group.position.y.toFixed(2)})mv${o.moving?1:0}f${o.blokFren.toFixed(1)}`) }
          }
        }
      }
      const imza = q.map(c => `${c.__ord}@${c.waitIndex}`).join(',')
      if (imza !== sonDizilim) { sonDizilim = imza; dizilim.push(`${i}:${imza}`) }
    }
    for (const c of mgr.cars) { c.__lx = c.group.position.x; c.__ly = c.group.position.y }
  }
  // konum karması: iki koşunun BİREBİR aynı yerde bittiğinin kanıtı
  let hash = 0
  for (const c of mgr.cars) {
    hash = (hash * 31 + Math.round(c.group.position.x * 10)) | 0
    hash = (hash * 31 + Math.round(c.group.position.y * 10)) | 0
  }
  const stuck = mgr.cars.filter(c => c.hardStuckT > 3).length
  return { ...sayac(), ciftMin, ciftSert, ciftYakin, ciftOrnek, zirve, dizilim, hash,
    stuck, evap: mgr.evapStats.total, muaf: mgr.blokStats.muaf, mgr }
}

// ISINMA KOŞUSU (determinizm ön şartı): three.js her nesneye Math.random ile uuid
// üretir ve emoji/doku önbellekleri MODÜL seviyesindedir — İLK koşu dokuları üretip
// paylaşılan tohumlu akıştan fazladan çekiliş yapar, ikinci koşu önbellekten okur.
// Yani soğuk ve sıcak önbellekle AYNI tohum farklı akış verir (ölçüldü). Isınma turu
// önbellekleri doldurur; asıl A/B koşuları birebir aynı koşullarda başlar.
kosu(60, {})

console.log('\n== 2a) Tek pompa yoğun: kuyruk çifti hiçbir karede < 2.5 değil ==')
const a = kosu(300, {})
check(`ölçüm DOLU kümede (${a.ciftOrnek} çift-kare · kuyruk zirvesi ${a.zirve} araç · servis ${a.served})`,
  a.ciftOrnek >= 500 && a.zirve >= 4, `çift ${a.ciftOrnek} · zirve ${a.zirve}`)
check(`DURAN kuyruk çifti HİÇBİR karede < 2.5 değil (tüm çiftlerde min ${isFinite(a.ciftMin) ? a.ciftMin.toFixed(2) : '—'})`,
  a.ciftSert === 0, `${a.ciftSert} karede duran çift < 2.5`)
check(`kuyrukta < 2.66 oranı ~0 (%${(100 * a.ciftYakin / Math.max(1, a.ciftOrnek)).toFixed(2)} ≤ %1)`,
  a.ciftYakin <= a.ciftOrnek * 0.01, `${a.ciftYakin}/${a.ciftOrnek}`)
check('kalıcı sıkışan 0 · buharlaşma 0', a.stuck === 0 && a.evap === 0, `sıkışan ${a.stuck} · buharlaşma ${a.evap}`)
check('sağlıklı akışta 30 sn kapısı hiç açılmadı (muaf 0)', a.muaf === 0, `muaf ${a.muaf}`)

console.log('\n== 2b) Determinizm: aynı tohum, iki koşu → aynı terfi dizilimi ==')
const b = kosu(300, {})
check(`terfi zinciri deterministik: dizilim transkripti birebir aynı (${a.dizilim.length} kayıt)`,
  a.dizilim.length > 20 && a.dizilim.join('|') === b.dizilim.join('|'),
  `A ${a.dizilim.length} vs B ${b.dizilim.length} kayıt`)
check('son kare konum karması aynı (araçlar aynı yerde bitti)', a.hash === b.hash,
  `${a.hash} vs ${b.hash}`)
check('sayaçlar aynı (servis/giremeyen)', a.served === b.served && a.turnedAway === b.turnedAway,
  `servis ${a.served}/${b.served} · giremeyen ${a.turnedAway}/${b.turnedAway}`)

console.log('\n== 2c) 30 sn kilitlenme kapısı: elle kurulmuş kalıcı blok ==')
// Banket geometrisi doğal kilitlenmeyi ORTADAN KALDIRDI (bozuk pompa + sabır sonsuz
// senaryosunda bile herkes slotuna temiz ulaşıyor, blok hiç 30 sn'ye dayanmıyor) —
// kapıyı kanıtlamak için blok ELLE kurulur: ana omurgaya HİÇ kıpırdamayan bir araç
// (A) konur, arkasındaki kuyruk üyesi (B) hedefi A'nın ötesinde olacak şekilde
// sürülür. B 2.55'te durmalı, 30 sn sonra kapısı açılmalı, A'nın içinden geçip
// hedefe varmalı; buharlaşma/kalıcı sıkışan yine 0 kalmalı.
{
  const { mgr } = kurSim({})
  mgr.update(0.1) // şerit ağı kurulsun
  const L = mgr.graph.get('near')
  const yap = (w, y) => {
    const c = new Car(new THREE.Scene(), null, 'fuel')
    c.phase = 'waiting'; c.station = 'near'; c.waitIndex = w
    c.group.position.set(L.xIn, y, 0)
    mgr.cars.push(c)
    mgr['waitOcc'][w] = c
    return c
  }
  const A = yap(0, L.queue[0].y)            // slot 0'da HİÇ kıpırdamayan blokçu
  A.patience = 1e9
  const B = yap(1, L.queue[0].y - L.dirY * 6) // arkada; hedefi A'nın ÖTESİNDE
  B.patience = 1e9
  B.phase = 'driving'
  B.setPath([new THREE.Vector3(L.xIn, L.queue[0].y + L.dirY * 5, 0)])
  let durdu = false
  // VARIŞ ANI YAKALANIR (bitişte değil): B'nin rotası hedefte tükenir ama fikstürde
  // faz hâlâ 'driving' kalır (onArrive yok). İLERLEME BEKÇİSİ böyle bir aracı 6 sn
  // sonra kendi kuyruk slotuna yeniden rotalar — oyunda DOĞRU davranış (rotası
  // tükenmiş 'driving' araç tanımı gereği sıkışmıştır), fikstürde ise B'yi hedeften
  // geri götürür. İddia "hedefe VARDI" olduğu için varış anında ölçülür.
  let vardiAn = false
  for (let i = 0; i < 500; i++) {
    mgr.update(0.1)
    A.group.position.set(L.xIn, L.queue[0].y, 0) // A sabitlenir (kuyruk ilerletme dahil hiçbir şey oynatamaz)
    A.setPath([]); A.waitIndex = 0; mgr['waitOcc'][0] = A; A.phase = 'waiting'
    if (B.waitIndex !== 1) { B.waitIndex = 1; mgr['waitOcc'][1] = B }
    const gap = Math.hypot(B.group.position.x - A.group.position.x, B.group.position.y - A.group.position.y)
    if (i === 100) durdu = gap >= 2.4 && gap <= 3.2 && B.moving
    if ((B.group.position.y - (L.queue[0].y + L.dirY * 5)) * L.dirY >= -0.5) vardiAn = true
  }
  const vardi = vardiAn
  check('blok B\'yi öndekinin 2.4-3.2 bandında DURDURDU (10. sn kontrolü)', durdu,
    `gap ${Math.hypot(B.group.position.x - A.group.position.x, B.group.position.y - A.group.position.y).toFixed(2)}`)
  check(`kilitlenme kapısı ÇALIŞIYOR: ${mgr.blokStats.muaf} kez açıldı (kasıtlı kilitte açılması ŞART)`,
    mgr.blokStats.muaf > 0, 'blok 30 sn dolmasına rağmen kapı hiç açılmadı')
  check('kapısı açılan araç yoluna devam edip HEDEFE VARDI (kalıcı kilit yok)', vardi,
    `B @(${B.group.position.x.toFixed(2)},${B.group.position.y.toFixed(2)})`)
  check('buharlaşma yine 0 (sigorta sessiz silmeye dönüşmedi)', mgr.evapStats.total === 0,
    `buharlaşma ${mgr.evapStats.total}`)
  check('kalıcı sıkışan yine 0 (blok duruşu hardStuckT saymıyor)',
    mgr.cars.filter(x => x !== A && x.hardStuckT > 3).length === 0)
}
// AYRICA: bozuk pompa + sonsuz sabır DOĞAL senaryosu kilitlenme ÜRETMEMELİ
// (banket geometrisi sayesinde) — üretirse geometri gerilemiş demektir.
const c = kosu(150, { brokenPump: true, patience: 50 })
check('DOĞAL senaryoda (bozuk pompa) kilitlenme yok: kapı hiç gerekmedi (muaf 0)',
  c.muaf === 0, `muaf ${c.muaf} — banket geometrisi delinmiş`)
check('bozuk pompada bile kuyruğun gerisi doldu (banket katılımı temiz)',
  c.mgr.cars.some(x => x.phase === 'waiting' && x.waitIndex >= 5),
  'arka slotlara kimse ulaşamadı')
check('buharlaşma yine 0', c.evap === 0, `buharlaşma ${c.evap}`)
check('kalıcı sıkışan yine 0', c.stuck === 0, `sıkışan ${c.stuck}`)
Car.solids = []

// ───────────────────────────────────────── 3) TARAYICI: GERÇEK SAHNE
// PORT SABİT DEĞİL, ARANIYOR + ATLAMA SESSİZ DEĞİL: bu bölüm kuralın CANLI kanıtı.
const PORTLAR = process.env.PORT ? [process.env.PORT] : ['5399', '5311', '5173', '5174']
let PORT = null
for (const prt of PORTLAR) {
  try { if ((await fetch(`http://localhost:${prt}/`, { signal: AbortSignal.timeout(1500) })).ok) { PORT = prt; break } }
  catch { /* sıradaki */ }
}
if (!PORT) {
  console.log(`\n❌ dev sunucu bulunamadı (${PORTLAR.join(', ')}) — CANLI SAHNE ÖLÇÜMÜ KOŞMADI.`)
  console.log('   Bu bölüm kuralın canlı kanıtı; atlanırsa sonuç GEÇTİ sayılmaz.')
  console.log(`   Çalıştır: npm run dev -- --port ${PORTLAR[0]}`)
  fail++
} else {
  console.log(`\n== 3) Canlı sahne (dev sunucu :${PORT}): tek pompa + rush, 30 sn ölçüm ==`)
  const { chromium } = await import('playwright-core')
  const brw = await chromium.launch({ channel: 'chrome' })
  const p = await brw.newPage()
  const hatalar = []
  p.on('pageerror', e => hatalar.push(e.message))
  await p.goto(`http://localhost:${PORT}/?full=1`, { waitUntil: 'load' })
  await p.waitForFunction(() => window.__dbg?.kayit, null, { timeout: 60_000 })
  // MİSAFİR KAPISI: ?full=1'de kapı açık gelir ve guestPaused entryChance'i 0 yapar —
  // kapıya BASMADAN trafik ölçmek boş kümeden geçmek olur (YASAK).
  await p.evaluate(() => { document.getElementById('gguest')?.click() })
  await p.waitForTimeout(1200)
  const giris = await p.evaluate(() => window.__dbg?.cars?.opts?.entryChance?.() ?? 0)
  check('misafir kapısı kapandı, giriş şansı > 0 (guestPaused tuzağı yok)', giris > 0, `entryChance ${giris}`)
  await p.evaluate(() => {
    const d = window.__dbg, s = d.state
    for (let cc = 0; cc < 3; cc++) for (let rr = 0; rr < 3; rr++) d.kayit.arsaAl(cc, rr)
    s.money = 5e8
    // GÜN-1 PROFİLİ (telemetrideki 22x küme): TEK pompa, şarj yok + rush yoğunluğu
    const k = JSON.parse(JSON.stringify(d.kayit.yuk()))
    k.placedPos = {}; k.placedRot = {}; k.placedRects = []
    k.s.pumps = 1; k.s.evChargers = 0
    d.kayit.yukle(k)
    s.reputation = 5; s.signLevel = 3
    s.promo = { type: 'rush', until: Date.now() + 600_000 }
    window.__kv = { ornek: 0, cift: 0, sert: 0, yakin: 0, min: Infinity, zirve: 0, enKotu: null }
    window.__kvTimer = setInterval(() => {
      const o = window.__kv
      const L = d.cars.graph.get('near')
      if (!L) return
      o.ornek++
      const spillX = L.spillStart < L.queue.length ? L.queue[L.spillStart].x : null
      const hat = x => Math.abs(x.group.position.x - L.xIn) < 0.6 ? 'ana'
        : (spillX != null && Math.abs(x.group.position.x - spillX) < 0.6 ? 'banket' : null)
      const q = d.cars.cars.filter(x => x.station === 'near' && x.waitIndex >= 0
        && (x.phase === 'waiting' || x.phase === 'driving') && hat(x))
        .sort((x, y) => x.waitIndex - y.waitIndex)
      if (q.length > o.zirve) o.zirve = q.length
      for (let i = 1; i < q.length; i++) {
        if (hat(q[i]) !== hat(q[i - 1])) continue
        const A = q[i - 1], B = q[i]
        const dd = Math.hypot(A.group.position.x - B.group.position.x,
                              A.group.position.y - B.group.position.y)
        o.cift++
        if (dd < o.min) o.min = dd
        if (dd < 2.66) o.yakin++
        // SERT = DURAN çift (son örnekten beri ~kıpırdamamış ikili) < 2.5
        const durA = Math.hypot(A.group.position.x - (A.__lx ?? NaN), A.group.position.y - (A.__ly ?? NaN)) < 0.05
        const durB = Math.hypot(B.group.position.x - (B.__lx ?? NaN), B.group.position.y - (B.__ly ?? NaN)) < 0.05
        if (dd < 2.5 && durA && durB) { o.sert++; if (!o.enKotu) o.enKotu = [+dd.toFixed(2), A.waitIndex, B.waitIndex] }
      }
      for (const c of d.cars.cars) { c.__lx = c.group.position.x; c.__ly = c.group.position.y }
    }, 250)
  })
  await p.waitForTimeout(30_000)
  const kv = await p.evaluate(() => {
    clearInterval(window.__kvTimer)
    const d = window.__dbg
    return { ...window.__kv, min: isFinite(window.__kv.min) ? window.__kv.min : null,
      muaf: d.cars.blokStats?.muaf ?? -1,
      bekleyen: d.cars.cars.filter(x => x.phase === 'waiting').length }
  })
  // BOŞ KÜMEDEN GEÇEN İDDİA YASAK: tek pompa + rush'ta kuyruk GERÇEKTEN dolmuş olmalı
  check(`ölçüm DOLU kümede (${kv.cift} çift-örnek · kuyruk zirvesi ${kv.zirve} · şu an bekleyen ${kv.bekleyen})`,
    kv.cift >= 40 && kv.zirve >= 3, `cift ${kv.cift} · zirve ${kv.zirve}`)
  check(`CANLI: DURAN kuyruk çifti hiçbir örnekte < 2.5 değil (tüm çiftlerde min ${kv.min ? kv.min.toFixed(2) : '—'})`,
    kv.sert === 0, `${kv.sert} örnek duran çift < 2.5 · en kötü ${JSON.stringify(kv.enKotu)}`)
  check(`CANLI: kuyrukta < 2.66 oranı ~0 (%${(100 * kv.yakin / Math.max(1, kv.cift)).toFixed(2)} ≤ %2)`,
    kv.yakin <= kv.cift * 0.02, `${kv.yakin}/${kv.cift}`)
  check('CANLI: 30 sn kapısı normal akışta açılmadı (muaf 0)', kv.muaf === 0, `muaf ${kv.muaf}`)
  check('tur boyunca sayfa hatası yok', hatalar.length === 0, hatalar.slice(0, 2).join(' | '))
  await brw.close()
}

console.log(`\n${fail === 0 ? '✅' : '❌'} konveyör/blok kuralı: ${pass} geçti, ${fail} kaldı`)
process.exit(fail === 0 ? 0 : 1)
