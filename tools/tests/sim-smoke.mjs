// Headless araç simülasyonu smoke testi — "araçlar görünmüyor" triage'ı.
// Gerçek cars.ts + three.js ile 90 sanal saniye koşar: spawn, giriş, pompaya varış sayılır.
globalThis.localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} }
Object.defineProperty(globalThis, 'navigator', { value: { language: 'tr' }, configurable: true })
// canvas tabanlı sprite'lar (sabır barı, balon) için minimal document stub'u
const noopCtx = new Proxy({}, {
  get: (_t, k) => (k === 'measureText' ? () => ({ width: 10 }) : () => undefined),
  set: () => true,
})
globalThis.document = { createElement: () => ({ width: 0, height: 0, getContext: () => noopCtx }) }
const THREE = await import('three')
const { CarManager } = await import('../../src/cars.ts')
const { GameState, FUEL_PRICE } = await import('../../src/state.ts')

const scene = new THREE.Scene()
const state = new GameState()
const pumpSlots = [new THREE.Vector3(-1.8, -4, 0)]
const opts = {
  pumpCount: () => 1, evCount: () => 0,
  pumpSlot: i => pumpSlots[i] ?? pumpSlots[0], evSlot: () => new THREE.Vector3(0, 0, 0),
  pumpAngle: () => 0, evAngle: () => 0,
  gateInY: () => -14, gateOutY: () => 14,
  entryChance: () => state.entryChance(),
  evShare: () => 0,
  prices: () => FUEL_PRICE,
  isPumpBroken: () => false, isChargerBroken: () => false,
  parkSpots: () => [], truckSpots: () => [],
  extraObstacles: () => [],
  wideGates: () => false,
  onCarReady: c => { arrived++ },
  onCarLost: () => { lost++ },
  farActive: () => false, farGateInY: () => 8, farGateOutY: () => -8,
}
let arrived = 0, lost = 0
const mgr = new CarManager(scene, null, opts)
let spawnedMax = 0
for (let t = 0; t < 900; t++) { // 90 sn @ dt=0.1
  mgr.update(0.1)
  spawnedMax = Math.max(spawnedMax, mgr.cars.length)
}
const transit = mgr.cars.filter(c => c.phase === 'transit').length
const visible = mgr.cars.filter(c => Math.abs(c.group.position.y) < 45).length
console.log(`90 sn sonunda: toplam=${mgr.cars.length} (tepe ${spawnedMax}), transit=${transit}, görünür=${visible}, pompaya varan=${arrived}, kaçan=${lost}`)
const ok = spawnedMax >= 5 && arrived >= 1
console.log(ok ? '✓ SPAWN + GİRİŞ + POMPAYA VARIŞ ÇALIŞIYOR (mantık sağlam)' : '✗ SİMÜLASYON KIRIK — spawn/pompa akışı bozulmuş!')
process.exit(ok ? 0 : 1)
