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
const THREE = await import('three')
const { CarManager } = await import('../../src/cars.ts')
const { GameState, FUEL_PRICE } = await import('../../src/state.ts')

const ROAD_X = 7.9
function run(label, { pumps, evs, far, wide, minutes = 10, graph = true, quiet = false, highway = null }) {
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
  let served = 0, lost = 0, rampLost = 0
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
    onRampFull: () => { rampLost++ },
  })
  // servis simülasyonu: pompaya varan araç 6 sn sonra uğurlanır (gerçek oyun temposu)
  const busy = new Map()
  const steps = minutes * 60 * 10
  for (let i = 0; i < steps; i++) {
    mgr.update(0.1)
    for (const c of mgr.cars) {
      if (c.phase === 'atPump' && !busy.has(c)) busy.set(c, i + 60)
    }
    for (const [c, until] of [...busy]) {
      if (i >= until) { busy.delete(c); if (c.phase === 'atPump') mgr.releaseCar(c) }
    }
  }
  const st = mgr.evapStats, gs = mgr.graph.stats
  if (process.env.DIAG) {
    const byPhase = {}
    for (const c of mgr.cars) { const k = `${c.phase}${c.hardStuckT > 3 ? '*STUCK' : ''}`; byPhase[k] = (byPhase[k] || 0) + 1 }
    console.log('   tanı: araç fazları', JSON.stringify(byPhase), 'zone:', JSON.stringify(mgr.graph.snapshot()))
    const st3 = mgr.cars.filter(c => c.hardStuckT > 3).slice(0, 4)
      .map(c => `${c.phase}@(${c.group.position.x.toFixed(1)},${c.group.position.y.toFixed(1)}) slot=${c.slotIndex} wait=${c.waitIndex} tok=${c.waitingForToken} hold=${c.hold}`)
    if (st3.length) console.log('   sıkışanlar:', st3.join(' | '))
  }
  const stuck = mgr.cars.filter(c => c.hardStuckT > 3).length
  if (!quiet) console.log(`${label}: servis=${served} kayıp=${lost}${highway ? ' rampKayıp=' + rampLost : ''} | buharlaşma=${st.total} (near ${st.near}/far ${st.far}) | ` +
    `rezervasyon: verildi ${gs.granted}, beklendi ${gs.denied} | kalıcı sıkışan=${stuck}`)
  return { st, stuck, served, rampLost }
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
if (stuckOn > stuckOff) { console.log('✗ grafik kalıcı sıkışmayı artırıyor'); fail++ }
else console.log(`✓ kalıcı sıkışan ${stuckOff} → ${stuckOn}`)
if (servOn < servOff * 0.95) { console.log('✗ grafik servis hacmini düşürüyor'); fail++ }
else console.log(`✓ servis hacmi ${servOff} → ${servOn}`)
console.log(fail === 0 ? '\n✓ YÜK TESTİ GEÇTİ (deterministik, A/B kanıtlı)' : `\n✗ ${fail} kriter başarısız`)
process.exit(fail ? 1 : 0)
