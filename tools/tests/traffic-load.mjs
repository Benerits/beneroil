// TRAFİK YÜK TESTİ (trafik raporu §6.2 T1+T2): yoğun yerleşim, 10 dakika, kilitlenme 0.
// Rezervasyon grafiğinin gerçek kazanımını ölçer: buharlaşma (evapStats) = trafik sağlığı.
globalThis.localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} }
Object.defineProperty(globalThis, 'navigator', { value: { language: 'tr' }, configurable: true })
const noopCtx = new Proxy({}, { get: (_t, k) => (k === 'measureText' ? () => ({ width: 10 }) : () => undefined), set: () => true })
globalThis.document = { createElement: () => ({ width: 0, height: 0, getContext: () => noopCtx }) }
// DETERMİNİST: seed'li PRNG — aynı senaryo her koşuda aynı sonucu verir (A/B anlamlı olsun)
let __seed = 0
const __rnd = () => { __seed = (__seed * 1103515245 + 12345) & 0x7fffffff; return __seed / 0x7fffffff }
Math.random = __rnd
const { readFileSync } = await import('node:fs')
const THREE = await import('three')
const { CarManager } = await import('../../src/cars.ts')
const { GameState, FUEL_PRICE } = await import('../../src/state.ts')

const ROAD_X = 7.9

// ÜRETİM AYARINI KODDAN OKU — test ile üretim ayrışmasın.
// main.ts: carsPassThrough: () => !has('collide')  → varsayılan passThrough = TRUE
//          carsPassThrough: () =>  has('nocollide') → varsayılan passThrough = FALSE
const __main = readFileSync(new URL('../../src/main.ts', import.meta.url), 'utf8')
const __m = __main.match(/carsPassThrough: \(\) => (!?)new URLSearchParams/)
if (!__m) throw new Error('carsPassThrough üretim varsayılanı okunamadı — test/üretim hizası kırıldı')
const PROD_PASS_THROUGH = process.env.FORCE_COLLIDE ? false : __m[1] === '!'
console.log(`üretim ayarı: çarpışma ${PROD_PASS_THROUGH ? 'KAPALI' : 'AÇIK'} (main.ts'ten okundu)`)
function run(label, { pumps, evs, far, wide, minutes = 10, graph = true, quiet = false, highway = null, service = null, passThrough = PROD_PASS_THROUGH }) {
  __seed = 20260726 // her senaryo AYNI tohumla başlar → A/B birebir karşılaştırılabilir
  const scene = new THREE.Scene()
  const state = new GameState()
  state.pumps = pumps; state.evChargers = evs; state.wideGates = wide
  state.signLevel = 3; state.reputation = 5; state.marketLevel = 3
  // pompa/şarj slotları: yarısı near, far ise diğer yarısı karşı yakada
  // Slotlar KAPI BÖLGELERİNDEN uzak bir bantta yayılır (oyundaki PUMP_SLOTS_POS gibi):
  // near kapılar ±14, far kapılar ±8 → slot bandı |y| ≤ 6 seçildi ki bölge çakışması olmasın.
  const lay = (n, i, band) => {
    const half = far ? Math.ceil(n / 2) : n
    const step = (2 * band) / Math.max(1, half)
    return { onFar: far && i >= half, y: -band + (i % half) * step + step / 2 }
  }
  const pumpSlots = Array.from({ length: pumps }, (_, i) => {
    const { onFar, y } = lay(pumps, i, 6)
    return onFar ? new THREE.Vector3(2 * ROAD_X - 2.4, -y, 0) : new THREE.Vector3(2.4, y, 0)
  })
  const evSlots = Array.from({ length: evs }, (_, i) => {
    const { onFar, y } = lay(evs, i, 5)
    return onFar ? new THREE.Vector3(2 * ROAD_X - 1.8, -y, 0) : new THREE.Vector3(1.8, y, 0)
  })
  let served = 0, lost = 0, rampLost = 0, svcSpawns = 0
  // görsel çakışma sayaçları (oyuncunun ekranda gördüğü "iç içe geçme")
  let cakisma = 0, cakismaAgir = 0, cakismaOrnek = 0
  const mgr = new CarManager(scene, null, {
    pumpCount: () => pumps, evCount: () => evs,
    pumpSlot: i => pumpSlots[Math.min(i, pumpSlots.length - 1)],
    evSlot: i => evSlots[Math.min(i, Math.max(0, evSlots.length - 1))] ?? new THREE.Vector3(1.8, 6, 0),
    pumpAngle: () => 0, evAngle: () => 0,
    gateInY: () => -14, gateOutY: () => 14,
    entryChance: () => state.entryChance(), evShare: () => (evs ? 0.35 : 0),
    prices: () => FUEL_PRICE, segments: () => state.activeSegments(),
    trafficPull: () => state.trafficPull(),
    isPumpBroken: () => false, isChargerBroken: () => false,
    parkSpots: () => [], truckSpots: () => [], extraObstacles: () => [],
    wideGates: () => wide,
    onCarReady: c => { served++; setTimeout(() => {}, 0); c.phase = 'atPump' },
    onCarLost: () => { lost++ },
    farActive: () => far, farGateInY: () => 8, farGateOutY: () => -8,
    graphEnabled: () => graph,
    highway: () => highway,
    serviceLane: () => service,
    carsPassThrough: () => passThrough,
    onRampFull: () => { rampLost++ },
  })
  // servis simülasyonu: pompaya varan araç 6 sn sonra uğurlanır (gerçek oyun temposu)
  const busy = new Map()
  const steps = minutes * 60 * 10
  const seen = new WeakSet()
  for (let i = 0; i < steps; i++) {
    mgr.update(0.1)
    if (service) for (const c of mgr.cars) {
      if (seen.has(c)) continue
      seen.add(c)
      const x = c.group.position.x
      if (Math.abs(x - service.near) < 0.2 || Math.abs(x - service.far) < 0.2) svcSpawns++
    }
    for (const c of mgr.cars) {
      if (c.phase === 'atPump' && !busy.has(c)) busy.set(c, i + 60)
    }
    // ── GÖRSEL ÇAKIŞMA: gövdeleri üst üste binen araç çifti (oyuncunun ŞİKÂYET ETTİĞİ şey) ──
    // Örnekleme: her 30 karede bir (her karede O(n²) taramak testi yavaşlatır).
    if (i % 30 === 0) {
      const gorunur = mgr.cars.filter(c => c.phase !== 'gone' && c.phase !== 'transit')
      for (let a = 0; a < gorunur.length; a++) {
        for (let b = a + 1; b < gorunur.length; b++) {
          const A = gorunur[a], B = gorunur[b]
          const dx = A.group.position.x - B.group.position.x
          const dy = A.group.position.y - B.group.position.y
          // 1.6 birim: iki aracın gövdesi bu mesafenin altındaysa gözle ÜST ÜSTE görünür
          if (dx * dx + dy * dy < 1.6 * 1.6) {
            cakisma++
            if (dx * dx + dy * dy < 1.0 * 1.0) cakismaAgir++   // içine girmiş
          }
        }
      }
      cakismaOrnek++
    }
    for (const [c, until] of [...busy]) {
      if (i >= until) { busy.delete(c); if (c.phase === 'atPump') mgr.releaseCar(c) }
    }
  }
  const st = mgr.evapStats, gs = mgr.graph.stats
  // örnek başına ortalama çakışan çift — mutlak sayı örnekleme sayısına bağlı olmasın
  const cakOrt = cakismaOrnek ? (cakisma / cakismaOrnek) : 0
  const cakAgirOrt = cakismaOrnek ? (cakismaAgir / cakismaOrnek) : 0
  if (process.env.DIAG) {
    const byPhase = {}
    for (const c of mgr.cars) { const k = `${c.phase}${c.hardStuckT > 3 ? '*STUCK' : ''}`; byPhase[k] = (byPhase[k] || 0) + 1 }
    console.log('   tanı: araç fazları', JSON.stringify(byPhase), 'zone:', JSON.stringify(mgr.graph.snapshot()))
    const st3 = mgr.cars.filter(c => c.hardStuckT > 3).slice(0, 4)
      .map(c => `${c.phase}@(${c.group.position.x.toFixed(1)},${c.group.position.y.toFixed(1)}) slot=${c.slotIndex} wait=${c.waitIndex} tok=${c.waitingForToken} hold=${c.hold}`)
    if (st3.length) console.log('   sıkışanlar:', st3.join(' | '))
  }
  // Kurallı bekleme (rezervasyon kuyruğu / yol verme) sıkışma değildir — yalnız
  // GERÇEKTEN takılmış araçlar sayılır (aksi halde grafik kuyruğu "sıkışma" görünür).
  const stuck = mgr.cars.filter(c => c.hardStuckT > 3 && !c.waitingForToken).length
  if (!quiet) console.log(`${label}: servis=${served} kayıp=${lost}${highway ? ' rampKayıp=' + rampLost : ''} | buharlaşma=${st.total} (near ${st.near}/far ${st.far}) | ` +
    `rezervasyon: verildi ${gs.granted}, beklendi ${gs.denied} | kalıcı sıkışan=${stuck} | ` +
    `ÇAKIŞMA ort ${cakOrt.toFixed(1)} çift/kare (içiçe ${cakAgirOrt.toFixed(1)})`)
  // servis şeridinde doğan araç sayısı — "şerit gerçekten kullanılıyor mu" kanıtı
  return { st, stuck, served, rampLost, laneUse: svcSpawns, cakisma: cakOrt, cakismaAgir: cakAgirOrt }
}

let fail = 0
const SC = [
  ['T1 near 8 pompa + 8 şarj', { pumps: 8, evs: 8, far: false, wide: true }],
  ['T2 KARŞI YAKA tam istasyon', { pumps: 8, evs: 8, far: true, wide: true }],
  ['T3 dar kapı (kapasite 1)', { pumps: 6, evs: 4, far: true, wide: false }],
]
console.log('--- GRAFİK AÇIK ---')
const on = SC.map(([n, c]) => [n, run(n, { ...c, graph: true })])
console.log('--- OTOYOL (ramp/merge — grafiğin sınavı) ---')
const HW = { decisionDist: 34, rampCap: 3, mergeHard: 1.6, signReach: 9, signLevel: 2 }
const t4 = run('T4 otoyol 6 pompa, dar kapı', { pumps: 6, evs: 4, far: false, wide: false, graph: true, highway: HW })
if (t4.stuck > 12) { console.log(`✗ T4: kalıcı sıkışan çok (${t4.stuck})`); fail++ }
else console.log(`✓ T4: kalıcı sıkışan ${t4.stuck}`)
if (t4.st.total > 3) { console.log(`✗ T4: buharlaşma ${t4.st.total} (hedef ≤3)`); fail++ }
else console.log(`✓ T4: buharlaşma ${t4.st.total}`)
if (t4.served < 60) { console.log(`✗ T4: servis çok az (${t4.served}) — ramp akmıyor`); fail++ }
else console.log(`✓ T4: servis ${t4.served} · ramp kaybı ${t4.rampLost} (apron kapasitesi baskısı)`)

// T5: DAR APRON — ramp kapasitesi dolmalı ve "kaçan müşteri" mekaniği çalışmalı
const t5 = run('T5 otoyol DAR apron (2 pompa)', { pumps: 2, evs: 0, far: false, wide: false, graph: true, highway: HW })
if (t5.rampLost <= 0) { console.log('✗ T5: ramp hiç dolmadı — kaçan müşteri mekaniği ÇALIŞMIYOR'); fail++ }
else console.log(`✓ T5: yavaşlama şeridi doldu, ${t5.rampLost} müşteri otobana döndü (apron kapasitesi baskısı GERÇEK)`)
if (t5.st.total > 3) { console.log(`✗ T5: buharlaşma ${t5.st.total}`); fail++ }
else console.log(`✓ T5: buharlaşma ${t5.st.total} (kayıp kuyruk değil, KARAR noktasında)`)

// ---- T6: ÇEVRE YOLU 4 ŞERİT ----
// İddia: istasyona girecek araç SERVİS şeridinde (istasyona yakın olan) akarsa,
// geçiş trafiğini kesmez → tıkanma ve buharlaşma AZALIR, servis hacmi ARTAR.
// Aynı yerleşim iki kez koşulur: tek şerit (bugünkü) vs 4 şerit.
console.log('--- ÇEVRE YOLU: 4 ŞERİT KIYASI (aynı tohum, aynı yerleşim) ---')
const SVC = { near: 5.58, far: 10.23 }
const t6a = run('T6a tek şerit  ', { pumps: 8, evs: 8, far: true, wide: true, graph: true })
const t6b = run('T6b 4 ŞERİT    ', { pumps: 8, evs: 8, far: true, wide: true, graph: true, service: SVC })
const prob = r => r.st.total + r.stuck
console.log(`A/B 4 şerit: sorun ${prob(t6a)} → ${prob(t6b)} · servis ${t6a.served} → ${t6b.served}`)
if (t6b.served < t6a.served * 0.95) {
  console.log(`✗ T6: 4 şerit servis hacmini düşürdü (${t6a.served} → ${t6b.served})`); fail++
} else console.log(`✓ T6: servis hacmi korundu/arttı (${t6a.served} → ${t6b.served})`)
if (prob(t6b) > prob(t6a) * 1.1) {
  console.log(`✗ T6: 4 şerit tıkanmayı ARTIRDI (${prob(t6a)} → ${prob(t6b)})`); fail++
} else console.log(`✓ T6: tıkanma artmadı (${prob(t6a)} → ${prob(t6b)})`)
// servis şeridi gerçekten KULLANILIYOR mu (yoksa sessizce görmezden gelinmiş olabilir)
if (t6b.laneUse === undefined || t6b.laneUse <= 0) {
  console.log('✗ T6: servis şeridi hiç kullanılmadı — bağlantı kopuk'); fail++
} else console.log(`✓ T6: servis şeridinde ${t6b.laneUse} araç doğdu (şerit gerçekten kullanılıyor)`)

// ---- T7: ARAÇ-ARAÇ ÇARPIŞMASI AÇIK vs KAPALI ----
// Ürün kararı: araçlar birbirinin içinden geçsin. Bu kıyas kararın bedelini ve
// kazancını RAKAMLA gösterir — en kalabalık senaryoda (karşı yaka tam istasyon).
console.log('--- ÇARPIŞMA: AÇIK vs KAPALI (aynı tohum) ---')
const cOn  = run('T7a çarpışma AÇIK ', { pumps: 8, evs: 8, far: true, wide: true, graph: true, passThrough: false })
const cOff = run('T7b çarpışma KAPALI', { pumps: 8, evs: 8, far: true, wide: true, graph: true, passThrough: true })
const pr = r => r.st.total + r.stuck
console.log(`A/B çarpışma: sorun ${pr(cOn)} → ${pr(cOff)} · servis ${cOn.served} → ${cOff.served}`)
if (cOff.served < cOn.served) { console.log(`✗ T7: çarpışmasız mod servisi DÜŞÜRDÜ (${cOn.served} → ${cOff.served})`); fail++ }
else console.log(`✓ T7: servis hacmi arttı (${cOn.served} → ${cOff.served})`)
if (pr(cOff) > 0) { console.log(`✗ T7: çarpışmasız modda hâlâ ${pr(cOff)} sorun var — kilitlenme başka yerden geliyor`); fail++ }
else console.log('✓ T7: tıkanma ve buharlaşma TAMAMEN sıfır (kilitlenme imkânsız)')

console.log('--- GRAFİK KAPALI (referans) ---')
const off = SC.map(([n, c]) => [n, run(n, { ...c, graph: false })])

console.log('\n--- KRİTERLER ---')
for (const [n, r] of on) {
  if (r.served < 80) { console.log(`✗ ${n}: servis çok az (${r.served})`); fail++ }
}
const sum = a => a.reduce((x, y) => x + y, 0)
const evapOn = sum(on.map(([, r]) => r.st.total)), evapOff = sum(off.map(([, r]) => r.st.total))
const stuckOn = sum(on.map(([, r]) => r.stuck)), stuckOff = sum(off.map(([, r]) => r.stuck))
const servOn = sum(on.map(([, r]) => r.served)), servOff = sum(off.map(([, r]) => r.served))
console.log(`A/B: buharlaşma ${evapOn} vs ${evapOff} · kalıcı sıkışan ${stuckOn} vs ${stuckOff} · servis ${servOn} vs ${servOff}`)
if (evapOn > evapOff * 0.6) { console.log('✗ grafik buharlaşmayı yeterince azaltmıyor (hedef ≥%40)'); fail++ }
else console.log(`✓ buharlaşma %${Math.round((1 - evapOn / Math.max(1, evapOff)) * 100)} azaldı`)
// DÜRÜST ÖLÇÜT: grafik kapalıyken araçlar BUHARLAŞIP yok oluyor, bu yüzden "sıkışan"
// az görünüyor. Karşılaştırma toplam sorun (kayıp + takılı) üzerinden yapılmalı.
const probOn = evapOn + stuckOn, probOff = evapOff + stuckOff
if (probOn > probOff * 0.8) { console.log(`✗ toplam sorun yeterince azalmadı (${probOn} vs ${probOff})`); fail++ }
else console.log(`✓ toplam sorun (kayıp+takılı) ${probOff} → ${probOn} (%${Math.round((1 - probOn / probOff) * 100)} az)`)
if (servOn < servOff * 0.95) { console.log('✗ grafik servis hacmini düşürüyor'); fail++ }
else console.log(`✓ servis hacmi ${servOff} → ${servOn}`)
console.log(fail === 0 ? '\n✓ YÜK TESTİ GEÇTİ (deterministik, A/B kanıtlı)' : `\n✗ ${fail} kriter başarısız`)
process.exit(fail ? 1 : 0)
