// BenelOil — canlı rafineri sahnesi: gerçek truck-flat tanker asset'i, küre rafineri,
// ÇOKLU yakıt alma bölmesi (3 bay) + yerde asfalt çizgileri/park işaretleri (düzenli rampa).
// Gerçek zamanlı (rAF), OrbitControls ile serbest açı. Ekran kaydıyla video çek.
import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'

const RED = 0xd64545, RED2 = 0xc23b3b, CREAM = 0xf2efe6, CONCRETE2 = 0xa2aab1
const GRASS = 0x8cc06b, DARK = 0x2b2f33, ASPHALT = 0x565e66, WHITE = 0xf3f5f7, YELLOW = 0xe8b83a
const FUEL = { benzin: 0x27a05a, dizel: 0xe8862e, lpg: 0x2f6fed }
const std = (c, o = {}) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.72, metalness: 0.08, ...o })

const renderer = new THREE.WebGLRenderer({ antialias: true })
renderer.setSize(innerWidth, innerHeight); renderer.setPixelRatio(Math.min(devicePixelRatio, 2))
renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap
renderer.outputColorSpace = THREE.SRGBColorSpace
document.body.appendChild(renderer.domElement)

const scene = new THREE.Scene()
scene.background = new THREE.Color(0xe3ecf2)
scene.fog = new THREE.Fog(0xe3ecf2, 100, 200)

const camera = new THREE.PerspectiveCamera(38, innerWidth / innerHeight, 0.5, 400)
camera.position.set(30, 30, 46)
const controls = new OrbitControls(camera, renderer.domElement)
controls.target.set(0, 3, 5); controls.enableDamping = true; controls.dampingFactor = 0.08
controls.maxPolarAngle = Math.PI / 2.05

scene.add(new THREE.HemisphereLight(0xfff4e0, 0x9fb0a0, 0.68))
const sun = new THREE.DirectionalLight(0xfff1d8, 1.5)
sun.position.set(28, 46, 22); sun.castShadow = true
sun.shadow.mapSize.set(2048, 2048)
Object.assign(sun.shadow.camera, { left: -60, right: 60, top: 60, bottom: -60, near: 1, far: 160 })
sun.shadow.bias = -0.0003; sun.shadow.normalBias = 0.02
scene.add(sun)

function cyl(rt, rb, h, c, x, y, z, parent, seg = 28) {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, seg), typeof c === 'number' ? std(c) : c)
  m.position.set(x, y, z); m.castShadow = true; m.receiveShadow = true; parent.add(m); return m
}
function ground(w, d, c, x, y, z) {
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, d), std(c, { roughness: 1 }))
  m.rotation.x = -Math.PI / 2; m.position.set(x, y, z); m.receiveShadow = true; scene.add(m); return m
}
// düz işaret çizgisi (yol/park boyası)
function mark(w, d, color, x, z, rotY = 0) {
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, d), new THREE.MeshBasicMaterial({ color }))
  m.rotation.x = -Math.PI / 2; m.rotation.z = rotY; m.position.set(x, 0.06, z); scene.add(m); return m
}

// ---- zemin ----
ground(320, 320, GRASS, 0, 0, 0)
ground(72, 26, ASPHALT, 0, 0.03, 7)              // asfalt rampa
for (const [w, d, x, z] of [[72, 0.5, 0, -6], [72, 0.5, 0, 20], [0.5, 26, -36, 7], [0.5, 26, 36, 7]])
  mark(w, d, RED, x, z)                            // kırmızı çerçeve

// ============ KÜRE RAFİNERİ (arka) ============
const refinery = new THREE.Group(); refinery.position.set(0, 0, -3); scene.add(refinery)
cyl(15, 15.5, 0.5, CONCRETE2, 0, 0.25, -3, refinery, 56)
function sphereTank(x, z, R) {
  const cy = 0.5 + R + 1.4
  const sp = new THREE.Mesh(new THREE.SphereGeometry(R, 40, 28), std(CREAM, { metalness: 0.15, roughness: 0.5 }))
  sp.position.set(x, cy, z); sp.castShadow = true; sp.receiveShadow = true; refinery.add(sp)
  const ring = new THREE.Mesh(new THREE.TorusGeometry(R * 1.002, 0.15, 10, 44), std(RED))
  ring.rotation.x = Math.PI / 2; ring.position.set(x, cy, z); refinery.add(ring)
  cyl(R * 0.28, R * 0.34, 0.5, RED2, x, cy + R * 0.92, z, refinery, 12)
  for (let l = 0; l < 4; l++) { const a = l * Math.PI / 2 + Math.PI / 4; cyl(0.2, 0.24, cy - R + 0.3, CONCRETE2, x + Math.cos(a) * R * 0.62, (cy - R + 0.3) / 2 + 0.5, z + Math.sin(a) * R * 0.62, refinery, 8) }
}
sphereTank(-12, -6, 3.2); sphereTank(-2, -8, 3.6); sphereTank(9, -6, 3.0); sphereTank(3, -1, 2.5); sphereTank(-6, 0, 2.3)

// ============ 3 YÜKLEME BÖLMESİ (bay) + gantry + çizgiler ============
const BAYS = [{ x: -13 }, { x: 0 }, { x: 13 }]
const FILL_Z = 5
const HALF = 4.2                     // bölme yarı genişliği
// gantry: her bölmenin arkasından öne uzanan kol + dolum başlığı
const gantry = new THREE.Group(); scene.add(gantry)
for (const b of BAYS) {
  cyl(0.35, 0.42, 6.5, CREAM, b.x - 2.6, 3.25, FILL_Z - 3, gantry, 10)      // dikme (bölme arkası)
  const arm = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.55, 4.2), std(RED)); arm.position.set(b.x - 2.6, 5.8, FILL_Z - 1); arm.castShadow = true; gantry.add(arm)
  const head = new THREE.Mesh(new THREE.BoxGeometry(0.6, 1.0, 0.6), std(RED2)); head.position.set(b.x - 2.6, 5.0, FILL_Z); gantry.add(head)
}
const hoses = BAYS.map(() => { const m = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 1, 8), std(DARK)); m.visible = false; scene.add(m); return m })

// ---- yer çizgileri: ana şerit + bölme kutuları + sarı dolum bölgesi + oklar ----
const LANE_Z = 15                    // ana sürüş şeridi
mark(72, 0.28, WHITE, 0, LANE_Z - 3.2)                 // şerit üst kenar
mark(72, 0.28, WHITE, 0, LANE_Z + 3.2)                 // şerit alt kenar
for (let x = -32; x <= 32; x += 4.5) mark(2.4, 0.24, WHITE, x, LANE_Z)   // orta kesik çizgi
for (const b of BAYS) {
  // bölme dikdörtgeni (arka + iki yan; ön şeride açık)
  mark(2 * HALF, 0.26, WHITE, b.x, FILL_Z - 3.6)                          // arka kenar
  mark(0.26, 8.2, WHITE, b.x - HALF, FILL_Z + 0.5)                        // sol kenar
  mark(0.26, 8.2, WHITE, b.x + HALF, FILL_Z + 0.5)                        // sağ kenar
  // sarı dolum bölgesi kutusu
  for (const [w, d, dx, dz] of [[3.4, 0.24, 0, -1.6], [3.4, 0.24, 0, 1.6], [0.24, 3.4, -1.6, 0], [0.24, 3.4, 1.6, 0]])
    mark(w, d, YELLOW, b.x + dx, FILL_Z + dz)
}
// ana şeritte yön okları (sola akış): chevron'lar
for (let x = -26; x <= 26; x += 13) { mark(1.8, 0.24, WHITE, x - 0.6, LANE_Z - 0.7, Math.PI / 4); mark(1.8, 0.24, WHITE, x - 0.6, LANE_Z + 0.7, -Math.PI / 4) }

// ============ TANKER (gerçek oyun asset'i) ============
let tankerProto = null
const FUEL_KEYS = ['benzin', 'dizel', 'lpg']
function buildTanker(baseModel, fuel) {
  const g = new THREE.Group()
  g.add(baseModel.clone(true))
  const tint = fuel === 'benzin' ? 0xa8d6b8 : fuel === 'dizel' ? 0xe3c49b : 0xaccdf0
  const tank = new THREE.Mesh(new THREE.CylinderGeometry(0.52, 0.52, 2.0, 24), std(tint))
  tank.rotation.x = Math.PI / 2; tank.position.set(0, 0.9, -0.35); tank.castShadow = true; g.add(tank)
  const fillMesh = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.5, 1.96, 24), std(FUEL[fuel], { emissive: FUEL[fuel], emissiveIntensity: 0.25 }))
  fillMesh.rotation.x = Math.PI / 2; fillMesh.position.copy(tank.position); fillMesh.scale.set(0.001, 1, 0.001); g.add(fillMesh)
  const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.13, 0.18, 10), std(0x8f979e)); cap.position.set(0, 1.42, -0.1); g.add(cap)
  g.scale.setScalar(2.1); g.userData = { fillMesh }
  return g
}

// ---- her tankerin kendi yolu (bölmeye sapar): giriş → şerit → bölme → dolum → şerit → çıkış ----
const V = (x, z) => new THREE.Vector3(x, 0, z)
function bayCurve(b) {
  const bx = BAYS[b].x, ez = [17, 14.5, 12][b]     // ayrı giriş şeritleri (üst üste binmesin)
  return new THREE.CatmullRomCurve3([
    V(40, ez), V(bx + 11, LANE_Z), V(bx + 4, 10), V(bx, FILL_Z),   // index 3 = DUR (dolum)
    V(bx - 4, 10), V(bx - 11, LANE_Z), V(-40, ez),
  ], false, 'catmullrom', 0.5)
}
const FACE = 0
const tankers = []
const bayBusy = [false, false, false]
let spawnCd = 0, spawnPtr = 0

function trySpawn(dt) {
  spawnCd -= dt
  if (!tankerProto || spawnCd > 0) return
  // sıradaki boş bölmeyi bul
  let bay = -1
  for (let k = 0; k < 3; k++) { const b = (spawnPtr + k) % 3; if (!bayBusy[b]) { bay = b; break } }
  if (bay < 0) return
  spawnPtr = (bay + 1) % 3
  const curve = bayCurve(bay)
  let uFill = 0.5; for (let i = 0, best = 1e9; i <= 240; i++) { const u = i / 240, d = curve.getPointAt(u).distanceTo(V(BAYS[bay].x, FILL_Z)); if (d < best) { best = d; uFill = u } }
  const obj = buildTanker(tankerProto, FUEL_KEYS[spawnPtr % 3])
  scene.add(obj)
  tankers.push({ obj, bay, curve, uFill, u: 0, state: 'approach', fillT: 0, speed: 0 })
  bayBusy[bay] = true
  spawnCd = 1.5
}

function place(t) {
  const u = Math.min(1, Math.max(0, t.u))
  const p = t.curve.getPointAt(u), tan = t.curve.getTangentAt(u)
  t.obj.position.set(p.x, 0, p.z)
  t.obj.rotation.y = Math.atan2(tan.x, tan.z) + FACE
}

const clock = new THREE.Clock()
function animate() {
  const dt = Math.min(0.05, clock.getDelta())
  trySpawn(dt)
  for (let i = 0; i < tankers.length; i++) {
    const t = tankers[i]
    if (t.state === 'approach') {
      const remain = Math.max(0, t.uFill - t.u)
      const desired = Math.min(0.11, remain * 1.5)
      t.speed += (desired - t.speed) * Math.min(1, dt * 5)
      t.u = Math.min(t.uFill, t.u + t.speed * dt)
      if (t.u >= t.uFill - 0.0015) { t.u = t.uFill; t.speed = 0; t.state = 'fill'; t.fillT = 0 }
      place(t)
    } else if (t.state === 'fill') {
      t.fillT += dt
      const p = Math.min(1, t.fillT / 3.2); t.obj.userData.fillMesh.scale.set(p, 1, p)
      if (t.fillT >= 3.8) { t.state = 'leave'; t.speed = 0; bayBusy[t.bay] = false }  // bölme boşaldı, sıradaki gelebilir
    } else {
      const desired = Math.min(0.15, 0.03 + (t.u - t.uFill) * 0.5)
      t.speed += (desired - t.speed) * Math.min(1, dt * 5)
      t.u += t.speed * dt
      place(t)
      if (t.u >= 0.999) { scene.remove(t.obj); tankers.splice(i, 1); i-- }
    }
  }
  // hortumlar: dolan bölmelere iner
  for (let b = 0; b < 3; b++) {
    const f = tankers.find(t => t.bay === b && t.state === 'fill')
    const h = hoses[b]
    if (f) {
      h.visible = true
      const from = new THREE.Vector3(BAYS[b].x - 2.6, 4.6, FILL_Z)
      const to = new THREE.Vector3(f.obj.position.x, 1.7, f.obj.position.z)
      h.position.copy(from).add(to).multiplyScalar(0.5)
      h.scale.y = from.distanceTo(to)
      h.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), to.clone().sub(from).normalize())
    } else h.visible = false
  }
  controls.update()
  renderer.render(scene, camera)
  requestAnimationFrame(animate)
}

// ---- ağaçlar (oyunun Kenney asset'leri) ----
const TREE_SPOTS = [
  [-30, -12, 4.0, 0], [-40, 4, 3.4, 1], [30, -14, 4.2, 0], [42, 4, 4.0, 0],
  [-42, -4, 3.4, 1], [40, 18, 3.2, 0], [-20, 24, 3.6, 0], [16, 24, 3.2, 1], [-4, 26, 4.2, 0],
]
function placeTrees(proto, small) {
  const box = new THREE.Box3().setFromObject(proto), h = box.max.y - box.min.y
  for (const [x, z, s, sm] of TREE_SPOTS) {
    if (!!sm !== small) continue
    const g = proto.clone(true); g.traverse(o => { if (o.isMesh) o.castShadow = true })
    const s2 = s / Math.max(0.001, h); g.scale.setScalar(s2)
    g.rotation.y = (x * 13 + z * 7) % 6.28; g.position.set(x, -box.min.y * s2, z); scene.add(g)
  }
}

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); renderer.setSize(innerWidth, innerHeight)
})

const loader = new GLTFLoader()
const loadGlb = (url) => new Promise((res, rej) => loader.load(url, g => res(g.scene), undefined, rej))
Promise.all([
  loadGlb('./truck-flat.glb'),
  loadGlb('./env/tree-large.glb').catch(() => null),
  loadGlb('./env/tree-small.glb').catch(() => null),
]).then(([truck, treeL, treeS]) => {
  truck.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true } })
  const box = new THREE.Box3().setFromObject(truck); truck.position.y -= box.min.y
  tankerProto = truck
  if (treeL) placeTrees(treeL, false)
  if (treeS) placeTrees(treeS, true)
  animate()
}).catch(err => { console.error('asset yüklenemedi', err); animate() })
