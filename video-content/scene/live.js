// BenelOil — canlı rafineri sahnesi: gerçek oyun tanker asset'i (truck-flat.glb + tank),
// küre şeklinde rafineri, sıralı gerçekçi tanker hareketi (gel → yanaş → dol → git).
// Gerçek zamanlı (requestAnimationFrame). OrbitControls ile açıyı kendin ayarla, ekran kaydı al.
import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'

const RED = 0xd64545, RED2 = 0xc23b3b, CREAM = 0xf2efe6, CREAM2 = 0xf6f3ec
const CONCRETE = 0xbcc3ca, CONCRETE2 = 0xa2aab1, GRASS = 0x8cc06b, DARK = 0x2b2f33, ROAD = 0x4c545b
const FUEL = { benzin: 0x27a05a, dizel: 0xe8862e, lpg: 0x2f6fed }
const std = (c, o = {}) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.72, metalness: 0.08, ...o })

const renderer = new THREE.WebGLRenderer({ antialias: true })
renderer.setSize(innerWidth, innerHeight); renderer.setPixelRatio(Math.min(devicePixelRatio, 2))
renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap
renderer.outputColorSpace = THREE.SRGBColorSpace
document.body.appendChild(renderer.domElement)

const scene = new THREE.Scene()
scene.background = new THREE.Color(0xe3ecf2)
scene.fog = new THREE.Fog(0xe3ecf2, 95, 190)

const camera = new THREE.PerspectiveCamera(38, innerWidth / innerHeight, 0.5, 400)
camera.position.set(34, 26, 40)
const controls = new OrbitControls(camera, renderer.domElement)
controls.target.set(0, 3, 4); controls.enableDamping = true; controls.dampingFactor = 0.08
controls.maxPolarAngle = Math.PI / 2.05

scene.add(new THREE.HemisphereLight(0xfff4e0, 0x9fb0a0, 0.68))
const sun = new THREE.DirectionalLight(0xfff1d8, 1.5)
sun.position.set(28, 44, 22); sun.castShadow = true
sun.shadow.mapSize.set(2048, 2048)
Object.assign(sun.shadow.camera, { left: -60, right: 60, top: 60, bottom: -60, near: 1, far: 160 })
sun.shadow.bias = -0.0003; sun.shadow.normalBias = 0.02
scene.add(sun)

function cyl(rt, rb, h, c, x, y, z, parent, seg = 28) {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, seg), typeof c === 'number' ? std(c) : c)
  m.position.set(x, y, z); m.castShadow = true; m.receiveShadow = true; parent.add(m); return m
}
function ground(w, d, c, x, y, z, rotY = 0) {
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, d), std(c, { roughness: 1 }))
  m.rotation.x = -Math.PI / 2; m.rotation.z = rotY; m.position.set(x, y, z); m.receiveShadow = true; scene.add(m); return m
}

// ---- zemin + apron + yol ----
ground(320, 320, GRASS, 0, 0, 0)
ground(40, 34, CONCRETE, 0, 0.03, 8)                 // yanaşma alanı
for (const [w, d, x, z] of [[40, 0.5, 0, -9], [40, 0.5, 0, 25], [0.5, 34, -20, 8], [0.5, 34, 20, 8]])
  ground(w, d, RED, x, 0.05, z)
ground(120, 9, ROAD, 0, 0.02, 22)                    // ön yol (tankerler buradan gelir/gider)

// ============ KÜRE RAFİNERİ ============
// büyük küresel tanklar (oyunun küre tankı diliyle) — arka merkez
const refinery = new THREE.Group(); refinery.position.set(0, 0, -4); scene.add(refinery)
cyl(11, 11.5, 0.6, CONCRETE2, 0, 0.3, 0, refinery, 48)
function sphereTank(x, z, R, band) {
  const cy = 0.6 + R + 1.6
  const sp = new THREE.Mesh(new THREE.SphereGeometry(R, 40, 28), std(CREAM, { metalness: 0.15, roughness: 0.5 }))
  sp.position.set(x, cy, z); sp.castShadow = true; sp.receiveShadow = true; refinery.add(sp)
  // ekvator kırmızı bant (kürenin biraz dışında ince tor)
  const ring = new THREE.Mesh(new THREE.TorusGeometry(R * 1.002, 0.16, 10, 44), std(RED))
  ring.rotation.x = Math.PI / 2; ring.position.set(x, cy, z); refinery.add(ring)
  // tepe kapağı
  cyl(R * 0.28, R * 0.34, 0.5, RED2, x, cy + R * 0.92, z, refinery, 12)
  // bacaklar
  for (let l = 0; l < 4; l++) { const a = l * Math.PI / 2 + Math.PI / 4; cyl(0.2, 0.24, cy - R + 0.4, CONCRETE2, x + Math.cos(a) * R * 0.62, (cy - R + 0.4) / 2 + 0.6, z + Math.sin(a) * R * 0.62, refinery, 8) }
  if (band) { /* opsiyonel */ }
  return { x, z, R, cy }
}
sphereTank(-6.5, -1, 3.4)
sphereTank(6.5, -1.5, 3.8)
sphereTank(-1, 4.5, 2.9)
sphereTank(4, 6, 2.4)
// bağlantı boruları
for (const [x, z] of [[-3, 1], [3, 2]]) { const p = cyl(0.22, 0.22, 12, 0xb8bdc2, x, 1.2, z, refinery); p.rotation.z = Math.PI / 2 }

// ---- dolum kolu (dock üstünde) ----
const DOCK = new THREE.Vector3(0, 0, 9)   // tankerlerin duracağı nokta (apron'da, rafineri önü)
const gantry = new THREE.Group(); scene.add(gantry)
cyl(0.35, 0.4, 6, CREAM2, -3.4, 3, 9, gantry, 10)          // dikme
const arm = new THREE.Mesh(new THREE.BoxGeometry(4.2, 0.5, 0.5), std(RED)); arm.position.set(-1.4, 5.4, 9); arm.castShadow = true; gantry.add(arm)
const nozzleHead = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.9, 0.6), std(RED2)); nozzleHead.position.set(0.4, 4.7, 9); gantry.add(nozzleHead)
const hose = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.11, 1, 8), std(DARK)); hose.visible = false; scene.add(hose)

// ---- ağaçlar: oyunun gerçek Kenney asset'leri (yüklenince yerleştirilir) ----
// [x, z, ölçek, küçük mü]
const TREE_SPOTS = [
  [-28, -10, 4.2, 0], [-33, 6, 3.4, 1], [28, -12, 4.0, 0], [34, 4, 4.4, 0],
  [-24, 19, 3.0, 1], [24, 19, 3.6, 0], [-2, -26, 4.6, 0], [12, -24, 3.2, 1],
  [-36, -2, 3.6, 0], [36, 16, 3.0, 1], [-14, 26, 3.4, 0], [16, 27, 3.2, 1],
]
function placeTrees(proto, small) {
  for (const [x, z, s, sm] of TREE_SPOTS) {
    if (!!sm !== small) continue
    const box = new THREE.Box3().setFromObject(proto)
    const g = proto.clone(true)
    g.traverse(o => { if (o.isMesh) { o.castShadow = true } })
    const h = box.max.y - box.min.y
    const s2 = s / Math.max(0.001, h)
    g.scale.setScalar(s2)
    g.rotation.y = (x * 13 + z * 7) % 6.28   // deterministik çeşitlilik
    g.position.set(x, -box.min.y * s2, z)    // tabanı zemine otur
    scene.add(g)
  }
}

// ============ TANKER (gerçek oyun asset'i: truck-flat.glb + tank) ============
let tankerProto = null // yüklenince dolar
const FUEL_KEYS = ['benzin', 'dizel', 'lpg']

function buildTanker(baseModel, fuel) {
  // oyundaki mantık: truck-flat gövdesi + üstüne silindir tank + kapak (scale 1.5)
  const g = new THREE.Group()
  const truck = baseModel.clone(true)
  g.add(truck)
  // tanker varili: truck'ın UZUNLUK ekseni (+Z) boyunca yatay silindir, yatağın üstünde
  const tint = fuel === 'benzin' ? 0xa8d6b8 : fuel === 'dizel' ? 0xe3c49b : 0xaccdf0
  const tank = new THREE.Mesh(new THREE.CylinderGeometry(0.52, 0.52, 2.0, 24), std(tint))
  tank.rotation.x = Math.PI / 2; tank.position.set(0, 0.9, -0.35); tank.castShadow = true; g.add(tank)
  const fillMesh = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.5, 1.96, 24), std(FUEL[fuel], { emissive: FUEL[fuel], emissiveIntensity: 0.25 }))
  fillMesh.rotation.x = Math.PI / 2; fillMesh.position.copy(tank.position); fillMesh.scale.set(0.001, 1, 0.001); g.add(fillMesh)
  const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.13, 0.18, 10), std(0x8f979e)); cap.position.set(0, 1.42, -0.1); g.add(cap)
  g.scale.setScalar(2.1)
  g.userData = { fillMesh }
  return g
}

// ---- yol: CatmullRom eğrisi (spawn → yanaşma → DOCK → çıkış → despawn) ----
const PATH = new THREE.CatmullRomCurve3([
  new THREE.Vector3(38, 0, 22),
  new THREE.Vector3(20, 0, 18),
  new THREE.Vector3(8, 0, 12),
  DOCK.clone(),                       // duracağı nokta (index 3)
  new THREE.Vector3(-8, 0, 12),
  new THREE.Vector3(-20, 0, 18),
  new THREE.Vector3(-38, 0, 22),
], false, 'catmullrom', 0.5)
// arc-length parametreleme (getPointAt/getTangentAt = uniform hız); DOCK'a en yakın u'yu bul
let U_DOCK = 0.5
for (let i = 0, best = 1e9; i <= 240; i++) { const u = i / 240, d = PATH.getPointAt(u).distanceTo(DOCK); if (d < best) { best = d; U_DOCK = u } }
const GAP = 7.5 / PATH.getLength()   // tankerler arası MİN mesafe → üst üste binmez
let FACE = 0                          // truck-flat ön yüzü +Z → tanjant yönüne dönsün

// tanker durumları + sıralı spawner
const tankers = []
let spawnIdx = 0
function trySpawn() {
  if (!tankerProto) return
  // tek sıra: spawn noktası (en son gelen) yeterince açılınca yenisini gönder
  const last = tankers[tankers.length - 1]
  if (last && last.u < GAP * 2.4) return
  if (tankers.length >= 5) return
  const fuel = FUEL_KEYS[spawnIdx++ % 3]
  const obj = buildTanker(tankerProto, fuel)
  scene.add(obj)
  tankers.push({ obj, u: 0, state: 'approach', fillT: 0, speed: 0 })
}

function placeOnPath(t) {
  const u = Math.min(1, Math.max(0, t.u))
  const p = PATH.getPointAt(u), tan = PATH.getTangentAt(u)
  t.obj.position.set(p.x, 0, p.z)
  t.obj.rotation.y = Math.atan2(tan.x, tan.z) + FACE
}

const clock = new THREE.Clock()
function animate() {
  const dt = Math.min(0.05, clock.getDelta())
  trySpawn()
  // önden arkaya işle: her tanker öndekinden en az GAP kadar geride kalır (üst üste binmez)
  for (let i = 0; i < tankers.length; i++) {
    const t = tankers[i], ahead = tankers[i - 1]
    const cap = ahead ? ahead.u - GAP : Infinity       // öndeki tankerin bıraktığı sınır
    if (t.state === 'approach') {
      const target = Math.min(U_DOCK, cap)
      const remain = Math.max(0, target - t.u)
      const desired = Math.min(0.10, remain * 1.5)      // hedefe yaklaşınca yavaşla (fren)
      t.speed += (desired - t.speed) * Math.min(1, dt * 5)
      t.u = Math.min(target, t.u + t.speed * dt)
      if (t.u >= U_DOCK - 0.0015) { t.u = U_DOCK; t.speed = 0; t.state = 'fill'; t.fillT = 0 }
      placeOnPath(t)
    } else if (t.state === 'fill') {
      t.fillT += dt
      t.obj.userData.fillMesh.scale.set(Math.min(1, t.fillT / 3.2), 1, Math.min(1, t.fillT / 3.2))
      if (t.fillT >= 3.8) { t.state = 'leave'; t.speed = 0 }
    } else { // leave — hızlanarak çık, yine öndekiyle mesafeyi koru
      const target = Math.min(1, ahead ? ahead.u - GAP : 1)
      const desired = Math.min(0.14, 0.03 + (t.u - U_DOCK) * 0.5)
      t.speed += (desired - t.speed) * Math.min(1, dt * 5)
      t.u = Math.min(target, t.u + t.speed * dt)
      placeOnPath(t)
      if (t.u >= 0.999) { scene.remove(t.obj); tankers.splice(i, 1); i-- }
    }
  }
  // dolum hortumu: dolan tankere iner
  const filling = tankers.find(t => t.state === 'fill')
  if (filling) {
    hose.visible = true
    const from = new THREE.Vector3(0.4, 4.4, 9)
    const to = new THREE.Vector3(filling.obj.position.x - 0.9, 1.7, filling.obj.position.z)
    hose.position.copy(from).add(to).multiplyScalar(0.5)
    hose.scale.y = from.distanceTo(to)
    hose.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), to.clone().sub(from).normalize())
  } else hose.visible = false

  controls.update()
  renderer.render(scene, camera)
  requestAnimationFrame(animate)
}

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix()
  renderer.setSize(innerWidth, innerHeight)
})

// assetleri yükle (tanker + oyunun ağaçları), sonra döngüyü başlat
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
