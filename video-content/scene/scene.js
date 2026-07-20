// BenelOil — "Rafineri" tanıtım sahnesi v2: minimal/marka-diline uygun rafineri,
// belirgin gelip-yanaş-git tanker hareketi, z-fighting temizlendi.
// Deterministik: window.renderAt(t) her kareyi t (sn) üzerinden kurar.
import * as THREE from './three.module.js'

const W = 1080, H = 1080
const FUEL = { benzin: 0x27a05a, dizel: 0xe8862e, lpg: 0x2f6fed }
const FUEL_HEX = { benzin: '#27a05a', dizel: '#e8862e', lpg: '#2f6fed' }
const FUEL_LABEL = { benzin: 'BENZİN', dizel: 'DİZEL', lpg: 'LPG' }
// marka paleti
const RED = 0xd64545, RED2 = 0xc23b3b, CREAM = 0xf2efe6, CREAM2 = 0xf6f3ec
const CONCRETE = 0xbcc3ca, CONCRETE2 = 0xa2aab1, GRASS = 0x8cc06b, DARK = 0x2b2f33
const std = (c, o = {}) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.72, metalness: 0.08, ...o })

const renderer = new THREE.WebGLRenderer({ antialias: true, logarithmicDepthBuffer: true })
renderer.setSize(W, H); renderer.setPixelRatio(1)
renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap
renderer.outputColorSpace = THREE.SRGBColorSpace
document.body.appendChild(renderer.domElement)

const scene = new THREE.Scene()
scene.background = new THREE.Color(0xe3ecf2)
scene.fog = new THREE.Fog(0xe3ecf2, 75, 150)

// near/far: dar aralık = yüksek derinlik hassasiyeti → z-fighting biter
const camera = new THREE.PerspectiveCamera(38, W / H, 2, 200)

scene.add(new THREE.HemisphereLight(0xfff4e0, 0x9fb0a0, 0.68))
const sun = new THREE.DirectionalLight(0xfff1d8, 1.5)
sun.position.set(26, 42, 20); sun.castShadow = true
sun.shadow.mapSize.set(2048, 2048)
Object.assign(sun.shadow.camera, { left: -55, right: 55, top: 55, bottom: -55, near: 1, far: 150 })
sun.shadow.bias = -0.0003; sun.shadow.normalBias = 0.02
scene.add(sun)

// ---- zemin: temiz çim + tek dairesel beton alan ----
const grass = new THREE.Mesh(new THREE.CircleGeometry(120, 64), std(GRASS, { roughness: 1 }))
grass.rotation.x = -Math.PI / 2; grass.receiveShadow = true; scene.add(grass)
const apron = new THREE.Mesh(new THREE.CircleGeometry(22, 64), std(CONCRETE, { roughness: 0.95 }))
apron.rotation.x = -Math.PI / 2; apron.position.y = 0.03; apron.receiveShadow = true; scene.add(apron)
// ince kırmızı marka çizgisi (ayrı yükseklikte → çakışmaz)
const ring = new THREE.Mesh(new THREE.RingGeometry(21.3, 22, 64), std(RED))
ring.rotation.x = -Math.PI / 2; ring.position.y = 0.05; scene.add(ring)

function cyl(rt, rb, h, c, x, y, z, parent, seg = 28) {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, seg), typeof c === 'number' ? std(c) : c)
  m.position.set(x, y, z); m.castShadow = true; m.receiveShadow = true; parent.add(m); return m
}
function box(w, h, d, c, x, y, z, parent) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), typeof c === 'number' ? std(c) : c)
  m.position.set(x, y, z); m.castShadow = true; m.receiveShadow = true; parent.add(m); return m
}

// ============ MİNİMAL RAFİNERİ (merkez) ============
const refinery = new THREE.Group(); scene.add(refinery)

// temiz beton kaide (tek parça, yumuşak)
const pad = cyl(11, 11.4, 0.6, CONCRETE2, 0, 0.3, 0, refinery, 48)

// 3 damıtma kulesi — krem gövde, kırmızı tepe başlık, TEK belirgin kırmızı bant (net offset)
const towers = [[-3.5, 12, 1.25], [0, 15.5, 1.5], [3.6, 10, 1.1]]
for (const [x, h, r] of towers) {
  const base = 0.6
  cyl(r, r * 1.05, h, CREAM, x, base + h / 2, -2.5, refinery)
  // bant: gövdeden belirgin dışarıda (r+0.12) → z-fight yok
  const band = cyl(r + 0.12, r + 0.12, 0.7, RED, x, base + h * 0.62, -2.5, refinery)
  // tepe başlık (koni değil, temiz kubbe)
  const cap = new THREE.Mesh(new THREE.SphereGeometry(r * 0.95, 20, 12, 0, Math.PI * 2, 0, Math.PI / 2), std(RED2))
  cap.position.set(x, base + h, -2.5); cap.castShadow = true; refinery.add(cap)
}

// 3 depolama tankı — krem gövde, kırmızı kubbe çatı (çatı gövdeden yukarıda başlar)
const tanks = [[-8, 3.2, 4], [8.2, 3.6, 3.5], [0, 3.0, 8.5]]
for (const [x, r, z] of tanks) {
  const bodyH = 5, base = 0.6
  cyl(r, r, bodyH, CREAM2, x, base + bodyH / 2, z, refinery)
  // kubbe çatı: yarım küre, gövde tepesinin ÜSTÜNDE (çakışmaz)
  const dome = new THREE.Mesh(new THREE.SphereGeometry(r, 24, 14, 0, Math.PI * 2, 0, Math.PI / 2), std(RED))
  dome.position.set(x, base + bodyH, z); dome.castShadow = true; dome.receiveShadow = true; refinery.add(dome)
  cyl(r * 1.02, r * 1.02, 0.25, CONCRETE, x, base + 0.12, z, refinery) // taban halkası
}

// 2 LPG küresi — temiz (bantsız), bacaklı
for (const [x, z] of [[-4.5, -7], [4.5, -7.5]]) {
  const R = 2.3, base = 0.6, cy = base + R + 1.5
  const sp = new THREE.Mesh(new THREE.SphereGeometry(R, 30, 22), std(0xeef1f4, { metalness: 0.25, roughness: 0.45 }))
  sp.position.set(x, cy, z); sp.castShadow = true; sp.receiveShadow = true; refinery.add(sp)
  for (let l = 0; l < 4; l++) {
    const a = l * Math.PI / 2 + Math.PI / 4
    cyl(0.16, 0.2, 1.6, CONCRETE2, x + Math.cos(a) * R * 0.62, base + 0.8, z + Math.sin(a) * R * 0.62, refinery, 8)
  }
}

// flare bacası + alev (tek, temiz)
cyl(0.65, 0.85, 18, RED2, 10.5, 0.6 + 9, -8, refinery, 16)
const flame = new THREE.Mesh(new THREE.ConeGeometry(0.95, 3, 16), new THREE.MeshBasicMaterial({ color: 0xffb03a }))
flame.position.set(10.5, 0.6 + 18 + 1.3, -8); scene.add(flame)
const flameCore = new THREE.Mesh(new THREE.ConeGeometry(0.48, 1.7, 12), new THREE.MeshBasicMaterial({ color: 0xffe58f }))
flameCore.position.copy(flame.position); flameCore.position.y -= 0.35; scene.add(flameCore)
const flareLight = new THREE.PointLight(0xffa838, 2, 26); flareLight.position.copy(flame.position); scene.add(flareLight)

// merkez kontrol binası (küçük, marka rengi) + tek temiz boru
box(3.2, 2.8, 3.2, CREAM, 0, 0.6 + 1.4, 2, refinery)
box(3.5, 0.4, 3.5, RED, 0, 0.6 + 2.9, 2, refinery)

// 4 yön docking bay: kısa beton şerit (uzun yol yok → merkez çakışması yok)
const BAYS = [0, Math.PI / 2, Math.PI, 3 * Math.PI / 2]
for (const ang of BAYS) {
  const bay = new THREE.Mesh(new THREE.PlaneGeometry(6, 16), std(CONCRETE, { roughness: 1 }))
  bay.rotation.x = -Math.PI / 2; bay.rotation.z = ang; bay.position.y = 0.02
  const dir = new THREE.Vector3(Math.sin(ang), 0, Math.cos(ang))
  bay.position.addScaledVector(dir, 18); bay.receiveShadow = true; scene.add(bay)
}

// ============ TANKERLER ============
function makeTanker(fuel) {
  const g = new THREE.Group()
  box(1.9, 2.0, 2.0, RED, 2.6, 1.3, 0, g)
  box(1.45, 1.05, 1.7, 0x243244, 2.78, 1.55, 0, g)
  const tank = new THREE.Mesh(new THREE.CylinderGeometry(1.15, 1.15, 4.6, 24), std(0xe2e6e9, { metalness: 0.15 }))
  tank.rotation.z = Math.PI / 2; tank.position.set(-0.7, 1.55, 0); tank.castShadow = true; g.add(tank)
  const fill = new THREE.Mesh(new THREE.CylinderGeometry(1.04, 1.04, 4.5, 24), std(FUEL[fuel], { emissive: FUEL[fuel], emissiveIntensity: 0.18 }))
  fill.rotation.z = Math.PI / 2; fill.position.set(-0.7, 1.55, 0); fill.scale.set(0.001, 1, 0.001); g.add(fill)
  box(5.4, 0.5, 1.45, DARK, 0.1, 0.55, 0, g)
  const wheels = []
  for (const wx of [2.4, 0.1, -1.9]) for (const wz of [0.82, -0.82]) {
    const w = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.42, 0.28, 16), std(0x1e2226, { roughness: 0.9 }))
    w.rotation.x = Math.PI / 2; w.position.set(wx, 0.42, wz); g.add(w); wheels.push(w)
  }
  const bub = makeBubble(fuel); bub.position.set(0.2, 4.4, 0); g.add(bub)
  g.userData = { fill, bubble: bub, fuel, wheels }
  return g
}

function makeBubble(fuel) {
  const cv = document.createElement('canvas'); cv.width = 320; cv.height = 200
  const tex = new THREE.CanvasTexture(cv.getContext('2d').canvas); tex.anisotropy = 8
  const spr = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, depthWrite: false, transparent: true }))
  spr.scale.set(4.6, 2.9, 1); spr.userData = { cv, ctx: cv.getContext('2d'), tex, fuel }
  return spr
}
function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath(); ctx.moveTo(x + r, y)
  ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r)
  ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath()
}
function drawBubble(spr, litersText, done) {
  const { cv, ctx, tex, fuel } = spr.userData
  ctx.clearRect(0, 0, cv.width, cv.height)
  ctx.fillStyle = '#fffdf7'; ctx.strokeStyle = '#0d1420'; ctx.lineWidth = 6
  roundRect(ctx, 12, 12, 296, 128, 26); ctx.fill(); ctx.stroke()
  ctx.beginPath(); ctx.moveTo(140, 138); ctx.lineTo(170, 138); ctx.lineTo(150, 172); ctx.closePath()
  ctx.fillStyle = '#fffdf7'; ctx.fill(); ctx.stroke()
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
  if (done) {
    ctx.fillStyle = '#27a05a'; ctx.font = '800 92px system-ui, sans-serif'; ctx.fillText('✓', 160, 74)
  } else {
    ctx.fillStyle = FUEL_HEX[fuel]; roundRect(ctx, 34, 30, 252, 44, 22); ctx.fill()
    ctx.fillStyle = '#fff'; ctx.font = '800 30px system-ui, sans-serif'; ctx.fillText(FUEL_LABEL[fuel], 160, 53)
    ctx.fillStyle = '#0d1420'; ctx.font = '800 46px system-ui, sans-serif'; ctx.fillText(litersText, 160, 110)
  }
  tex.needsUpdate = true
}

const LANES = [
  { ang: 0,             fuel: 'dizel',  liters: 24000, phase: 0.0 },
  { ang: Math.PI / 2,   fuel: 'benzin', liters: 18000, phase: 2.25 },
  { ang: Math.PI,       fuel: 'lpg',    liters: 12000, phase: 4.5 },
  { ang: 3 * Math.PI / 2, fuel: 'benzin', liters: 30000, phase: 6.75 },
]
const CYCLE = 9.0, DOCK = 15.5, FAR = 62
const tankers = LANES.map(l => ({ tk: makeTanker(l.fuel), ...l }))
tankers.forEach(t => scene.add(t.tk))
const hoses = tankers.map(() => {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.14, 1, 8), std(DARK)); m.visible = false; scene.add(m); return m
})
const laneDir = (a) => new THREE.Vector3(Math.sin(a), 0, Math.cos(a))
const easeOut = (k) => 1 - Math.pow(1 - k, 3)
const easeIn = (k) => k * k * k

function updateTanker(idx, t) {
  const T = tankers[idx], dir = laneDir(T.ang), g = T.tk
  const { fill, bubble, wheels } = g.userData
  const lt = ((t + T.phase) % CYCLE + CYCLE) % CYCLE
  let dist, p = 0, done = false, filling = false, moving = false
  if (lt < 2.8) {                         // GELİŞ (uzaktan yanaşma)
    dist = FAR + (DOCK - FAR) * easeOut(lt / 2.8); moving = true
  } else if (lt < 6.0) {                  // YANAŞMA + DOLUM
    dist = DOCK; filling = true; p = (lt - 2.8) / 3.2
  } else if (lt < 6.7) {                  // DOLDU ✓
    dist = DOCK; p = 1; done = true
  } else {                                // GİDİŞ (yola çıkış)
    dist = DOCK + (FAR - DOCK) * easeIn((lt - 6.7) / (CYCLE - 6.7)); p = 1; done = true; moving = true
  }
  g.position.copy(dir).multiplyScalar(dist)
  const facing = lt < 6.7 ? Math.atan2(-dir.x, -dir.z) : Math.atan2(dir.x, dir.z)
  g.rotation.y = facing + Math.PI / 2

  fill.scale.set(Math.max(0.001, p), 1, Math.max(0.001, p))
  // tekerlek dönüşü (hareket ederken)
  const spin = moving ? -dist * 0.9 : (wheels[0].rotation.z || 0)
  for (const w of wheels) w.rotation.z = spin

  drawBubble(bubble, `${(Math.round(T.liters * p / 100) * 100).toLocaleString('tr-TR')} L`, p >= 1 && lt >= 6.0)

  const hose = hoses[idx]
  if (filling) {
    hose.visible = true
    const from = dir.clone().multiplyScalar(11.5).setY(2.0)
    const to = g.position.clone().add(dir.clone().multiplyScalar(1.1)).setY(1.55)
    hose.position.copy(from).add(to).multiplyScalar(0.5); hose.position.y -= 0.35
    hose.scale.y = from.distanceTo(to)
    hose.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), to.clone().sub(from).normalize())
  } else hose.visible = false
}

window.__ready = false
window.renderAt = function (t) {
  const az = -0.55 + t * 0.04
  const rad = 50, hgt = 33
  camera.position.set(Math.sin(az) * rad, hgt + Math.sin(t * 0.28) * 1.0, Math.cos(az) * rad)
  camera.lookAt(0, 8, 0)
  const fl = 1 + Math.sin(t * 11) * 0.11 + Math.sin(t * 23) * 0.05
  flame.scale.set(1, fl, 1); flameCore.scale.set(1, fl * 1.05, 1)
  flareLight.intensity = 1.8 + Math.sin(t * 17) * 0.4
  for (let i = 0; i < tankers.length; i++) updateTanker(i, t)
  renderer.render(scene, camera)
}
window.renderAt(0)
window.__ready = true
