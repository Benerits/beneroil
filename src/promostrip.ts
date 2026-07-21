/**
 * BenelOil — "İstasyonunu bul" film şeridi (video için).
 * OYUNDAKİYLE AYNI istasyon çizimi (gerçek pompa/tank/bina) + oyunun izometrik ortho
 * açısı. İstasyonlar tek tek akıp geçer; İSİM YOK (KVKK). Aynı anda ~7 canlı → hafif.
 */
import * as THREE from 'three'
import { initStation, buildStation, StCfg } from './promostation'

interface St extends StCfg { name?: string; day: number; money: number }

const canvas = document.getElementById('c') as HTMLCanvasElement
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true })
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75))
renderer.setSize(innerWidth, innerHeight)
renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap
renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.05
const scene = new THREE.Scene()
scene.background = new THREE.Color(0x9fce78)

// oyunun izometrik ortho kamerası (CAM_ANGLES[0] = (1,2,1))
const camera = new THREE.OrthographicCamera()
const VIEW = 15 // ne kadar dünya-yüksekliği görünsün
function setFrustum() {
  const a = innerWidth / innerHeight
  camera.left = -VIEW * a; camera.right = VIEW * a; camera.top = VIEW; camera.bottom = -VIEW
  camera.near = -100; camera.far = 300; camera.updateProjectionMatrix()
}
setFrustum()
const dir = new THREE.Vector3(1, 2, 1).normalize().multiplyScalar(60)
camera.position.copy(dir); camera.up.set(0, 0, 1); camera.lookAt(0, 0, 1.5)

scene.add(new THREE.HemisphereLight(0xffffff, 0x88a06a, 0.95))
const sun = new THREE.DirectionalLight(0xfff2d8, 1.1); sun.position.set(6, -10, 16); sun.castShadow = true
sun.shadow.mapSize.set(1024, 1024); sun.shadow.camera.left = -20; sun.shadow.camera.right = 20; sun.shadow.camera.top = 20; sun.shadow.camera.bottom = -20
scene.add(sun)
const ground = new THREE.Mesh(new THREE.PlaneGeometry(400, 120), new THREE.MeshLambertMaterial({ color: 0x8fbf6e }))
ground.receiveShadow = true; scene.add(ground)

const statEl = document.getElementById('stat')!
function showDetail(s: St) {
  const facs = [['🛒', s.market], ['🚿', s.wash ? 1 : 0], ['🔧', s.oil ? 1 : 0], ['☕', s.coffee ? 1 : 0], ['🍽️', s.restaurant ? 1 : 0], ['🚚', s.truckpark ? 1 : 0], ['☀️', s.solar], ['☢️', s.smr ? 1 : 0], ['🔋', s.battery]]
    .filter(([, n]) => (n as number) > 0).map(([e]) => e).join(' ') || '—'
  statEl.innerHTML =
    `<div class="chip"><div class="k">GÜN</div><div class="v">${s.day}</div></div>`
    + `<div class="chip"><div class="k">KASA</div><div class="v red">₺${Math.round(s.money).toLocaleString('tr-TR')}</div></div>`
    + `<div class="chip"><div class="k">POMPA</div><div class="v">${s.pumps}</div></div>`
    + `<div class="chip"><div class="k">ŞARJ</div><div class="v">${s.ev}</div></div>`
    + `<div class="chip"><div class="k">TANK</div><div class="v">Sv.${s.tank + 1}</div></div>`
    + `<div class="chip fac"><div class="k">TESİSLER</div><div class="v">${facs}</div></div>`
}

async function boot() {
  await initStation()
  let stations: St[] = []
  try { stations = await (await fetch('/promo-stations.json')).json() } catch { /* boş */ }
  if (!stations.length) return
  stations.sort((a, b) => (b.day + b.money / 5000) - (a.day + a.money / 5000))
  const N = stations.length

  // istasyonlar dünya +Y'den -Y'ye akar (izometrik akış); merkez y=0
  const SPACING = 13, SPEED0 = 7
  const SLOTS = 7, FAR = (SLOTS / 2) * SPACING
  interface Slot { g: THREE.Group; idx: number; y: number }
  const slots: Slot[] = []
  let nextIdx = 0
  const make = (idx: number, y: number): Slot => { const g = buildStation(stations[idx], false); g.position.set(0, y, 0); scene.add(g); return { g, idx, y } }
  for (let i = 0; i < SLOTS; i++) { const idx = nextIdx++ % N; slots.push(make(idx, FAR - i * SPACING)) }

  let speed = SPEED0, paused = false, lastFocus = -1, prev = performance.now()
  function frame() {
    requestAnimationFrame(frame)
    const now = performance.now(); const dt = Math.min((now - prev) / 1000, 0.05); prev = now
    if (!paused) for (const sl of slots) {
      sl.y -= speed * dt; sl.g.position.y = sl.y
      if (sl.y < -FAR - SPACING) { sl.y += SLOTS * SPACING; scene.remove(sl.g); dispose(sl.g); const idx = nextIdx++ % N; const g = buildStation(stations[idx], false); g.position.set(0, sl.y, 0); scene.add(g); sl.g = g; sl.idx = idx }
    }
    let best = slots[0]; for (const sl of slots) if (Math.abs(sl.y) < Math.abs(best.y)) best = sl
    if (best.idx !== lastFocus) { lastFocus = best.idx; showDetail(stations[best.idx]) }
    renderer.render(scene, camera)
  }
  frame()
  addEventListener('keydown', ev => {
    if (ev.key === 'ArrowUp') speed = Math.min(26, speed + 2)
    if (ev.key === 'ArrowDown') speed = Math.max(2, speed - 2)
    if (ev.key === ' ') { ev.preventDefault(); paused = !paused }
  })
}
function dispose(g: THREE.Group) { g.traverse(o => { const m = o as THREE.Mesh; if ((m as any).isMesh) { m.geometry?.dispose?.(); const mm = m.material as any; (Array.isArray(mm) ? mm : [mm]).forEach((x: any) => x?.dispose?.()) } }) }
addEventListener('resize', () => { setFrustum(); renderer.setSize(innerWidth, innerHeight) })
boot()
