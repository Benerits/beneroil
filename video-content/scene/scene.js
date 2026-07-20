// BenelOil — "Rafineri" tanıtım sahnesi v3: SABİT perspektif, rafineri arka-sol köşede küçük,
// önünde kocaman yanaşma alanı, 3 şeritte gerçekçi gelip-yanaş-dol-çık tanker hareketi.
// Deterministik: window.renderAt(t) her kareyi t (sn) üzerinden kurar.
import * as THREE from './three.module.js'

const W = 1080, H = 1080
const FUEL = { benzin: 0x27a05a, dizel: 0xe8862e, lpg: 0x2f6fed }
const FUEL_HEX = { benzin: '#27a05a', dizel: '#e8862e', lpg: '#2f6fed' }
const FUEL_LABEL = { benzin: 'BENZİN', dizel: 'DİZEL', lpg: 'LPG' }
const RED = 0xd64545, RED2 = 0xc23b3b, CREAM = 0xf2efe6, CREAM2 = 0xf6f3ec
const CONCRETE = 0xbcc3ca, CONCRETE2 = 0xa2aab1, GRASS = 0x8cc06b, DARK = 0x2b2f33, ROAD = 0x4c545b
const std = (c, o = {}) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.72, metalness: 0.08, ...o })

const renderer = new THREE.WebGLRenderer({ antialias: true, logarithmicDepthBuffer: true })
renderer.setSize(W, H); renderer.setPixelRatio(1)
renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap
renderer.outputColorSpace = THREE.SRGBColorSpace
document.body.appendChild(renderer.domElement)

const scene = new THREE.Scene()
scene.background = new THREE.Color(0xe3ecf2)
scene.fog = new THREE.Fog(0xe3ecf2, 90, 175)

// SABİT kamera (yörünge yok) — oyun tarzı 3/4 izometrik açı
const camera = new THREE.PerspectiveCamera(34, W / H, 2, 260)
camera.position.set(46, 40, 52)
camera.lookAt(2, 1, 4)

scene.add(new THREE.HemisphereLight(0xfff4e0, 0x9fb0a0, 0.68))
const sun = new THREE.DirectionalLight(0xfff1d8, 1.5)
sun.position.set(30, 46, 24); sun.castShadow = true
sun.shadow.mapSize.set(2048, 2048)
Object.assign(sun.shadow.camera, { left: -70, right: 70, top: 70, bottom: -70, near: 1, far: 170 })
sun.shadow.bias = -0.0003; sun.shadow.normalBias = 0.02
scene.add(sun)

function cyl(rt, rb, h, c, x, y, z, parent, seg = 26) {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, seg), typeof c === 'number' ? std(c) : c)
  m.position.set(x, y, z); m.castShadow = true; m.receiveShadow = true; parent.add(m); return m
}
function box(w, h, d, c, x, y, z, parent) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), typeof c === 'number' ? std(c) : c)
  m.position.set(x, y, z); m.castShadow = true; m.receiveShadow = true; parent.add(m); return m
}
function plane(w, d, c, x, y, z, rotZ = 0) {
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, d), std(c, { roughness: 1 }))
  m.rotation.x = -Math.PI / 2; m.rotation.z = rotZ; m.position.set(x, y, z); m.receiveShadow = true; scene.add(m); return m
}

// ---- zemin ----
plane(300, 300, GRASS, 0, 0, 0)
// kocaman yanaşma alanı (apron) — önde/merkezde
const apron = plane(34, 30, CONCRETE, 3, 0.03, 4)
// apron kenarı kırmızı marka şeridi
{
  const edge = new THREE.Mesh(new THREE.RingGeometry(0, 1, 4), std(RED)) // placeholder yok; çerçeve çizgileri:
  edge.visible = false; scene.add(edge)
}
for (const [w, d, x, z] of [[34, 0.5, 3, -11], [34, 0.5, 3, 19], [0.5, 30, -14, 4], [0.5, 30, 20, 4]])
  plane(w, d, RED, x, 0.05, z)

// ============ MİNİMAL RAFİNERİ — arka-sol köşe, küçük ============
const refinery = new THREE.Group(); refinery.position.set(-19, 0, -13); scene.add(refinery)
const pad = cyl(7.5, 7.9, 0.5, CONCRETE2, 0, 0.25, 0, refinery, 40)
// 3 küçük damıtma kulesi
for (const [x, h, r, z] of [[-2.5, 9, 0.95, -1], [0.5, 12, 1.15, -2], [3.2, 7.5, 0.85, -0.5]]) {
  cyl(r, r * 1.05, h, CREAM, x, 0.5 + h / 2, z, refinery)
  cyl(r + 0.1, r + 0.1, 0.55, RED, x, 0.5 + h * 0.62, z, refinery)
  const cap = new THREE.Mesh(new THREE.SphereGeometry(r * 0.95, 18, 10, 0, Math.PI * 2, 0, Math.PI / 2), std(RED2))
  cap.position.set(x, 0.5 + h, z); cap.castShadow = true; refinery.add(cap)
}
// 2 depolama tankı (kırmızı kubbe)
for (const [x, r, z] of [[-4.5, 2.4, 3], [4.5, 2.2, 3.5]]) {
  cyl(r, r, 4.2, CREAM2, x, 0.5 + 2.1, z, refinery)
  const dome = new THREE.Mesh(new THREE.SphereGeometry(r, 22, 12, 0, Math.PI * 2, 0, Math.PI / 2), std(RED))
  dome.position.set(x, 0.5 + 4.2, z); dome.castShadow = true; refinery.add(dome)
}
// 1 LPG küresi
{
  const R = 1.9, cyc = 0.5 + R + 1.2
  const sp = new THREE.Mesh(new THREE.SphereGeometry(R, 26, 18), std(0xeef1f4, { metalness: 0.25, roughness: 0.45 }))
  sp.position.set(0, cyc, 5.5); sp.castShadow = true; refinery.add(sp)
  for (let l = 0; l < 4; l++) { const a = l * Math.PI / 2 + Math.PI / 4; cyl(0.14, 0.17, 1.3, CONCRETE2, Math.cos(a) * R * 0.6, 0.5 + 0.65, 5.5 + Math.sin(a) * R * 0.6, refinery, 8) }
}
// flare
cyl(0.5, 0.65, 13, RED2, 6, 0.5 + 6.5, -1, refinery, 14)
const flame = new THREE.Mesh(new THREE.ConeGeometry(0.7, 2.2, 14), new THREE.MeshBasicMaterial({ color: 0xffb03a }))
flame.position.set(-19 + 6, 0.5 + 13 + 1, -13 - 1); scene.add(flame)
const flameCore = new THREE.Mesh(new THREE.ConeGeometry(0.35, 1.3, 10), new THREE.MeshBasicMaterial({ color: 0xffe58f }))
flameCore.position.copy(flame.position); flameCore.position.y -= 0.25; scene.add(flameCore)
const flareLight = new THREE.PointLight(0xffa838, 1.6, 22); flareLight.position.copy(flame.position); scene.add(flareLight)

// ============ DOLUM GANTRYSİ — apron'un iç (rafineriye bakan) kenarında 3 kol ============
// dünya koordinatında dock noktaları (apron üstünde), rafineri kolu -x'te
const DOCKS = [
  { x: -6, z: -3, fuel: 'dizel',  liters: 24000, phase: 0.0 },
  { x: -6, z: 5,  fuel: 'benzin', liters: 18000, phase: 3.4 },
  { x: -6, z: 13, fuel: 'lpg',    liters: 12000, phase: 6.8 },
]
const gantry = new THREE.Group(); scene.add(gantry)
box(1.0, 0.8, 24, CREAM2, -10.5, 5.4, 5, gantry) // üst kiriş (duvar değil, açık gantry)
for (const zEnd of [-6, 16]) cyl(0.22, 0.26, 5.4, CONCRETE2, -10.5, 2.7, zEnd, gantry, 8) // uç dikmeler
for (const d of DOCKS) {
  box(5, 0.6, 0.6, RED, -8, 5.4, d.z, gantry)         // yatay kol dock üstüne uzanır
  cyl(0.2, 0.24, 5.4, CONCRETE2, -10.5, 2.7, d.z, gantry, 8) // dikme
  box(0.65, 1.0, 0.65, RED2, d.x + 0.3, 4.7, d.z, gantry)    // dolum başlığı
}

// ---- oyuna benzer çevre: giriş yolu + ağaçlar + çit ----
// tankerlerin geldiği sağ-ön yol
plane(60, 9, ROAD, 34, 0.02, 20, -0.32)
function tree(x, z, s = 1) {
  const g = new THREE.Group()
  cyl(0.22 * s, 0.28 * s, 1.3 * s, 0x8a5a34, 0, 0.65 * s, 0, g, 6)
  const c1 = new THREE.Mesh(new THREE.ConeGeometry(1.15 * s, 1.9 * s, 8), std(0x4e9c50)); c1.position.y = 1.7 * s; c1.castShadow = true; g.add(c1)
  const c2 = new THREE.Mesh(new THREE.ConeGeometry(0.85 * s, 1.4 * s, 8), std(0x5cb35c)); c2.position.y = 2.5 * s; c2.castShadow = true; g.add(c2)
  g.position.set(x, 0, z); scene.add(g)
}
for (const [x, z, s] of [[-30, 8, 1.2], [-28, 20, 1], [-20, 24, 0.9], [26, -14, 1.1], [34, -8, 1], [40, 4, 1.2], [-34, -2, 1], [16, 30, 1], [30, 30, 0.9]]) tree(x, z, s)

// ============ TANKER ============
function makeTanker(fuel) {
  const g = new THREE.Group()
  box(1.95, 2.05, 2.05, RED, 2.6, 1.35, 0, g)
  box(1.5, 1.05, 1.75, 0x243244, 2.8, 1.6, 0, g)
  const tank = new THREE.Mesh(new THREE.CylinderGeometry(1.18, 1.18, 4.7, 24), std(0xe2e6e9, { metalness: 0.15 }))
  tank.rotation.z = Math.PI / 2; tank.position.set(-0.7, 1.6, 0); tank.castShadow = true; g.add(tank)
  const fill = new THREE.Mesh(new THREE.CylinderGeometry(1.06, 1.06, 4.6, 24), std(FUEL[fuel], { emissive: FUEL[fuel], emissiveIntensity: 0.18 }))
  fill.rotation.z = Math.PI / 2; fill.position.set(-0.7, 1.6, 0); fill.scale.set(0.001, 1, 0.001); g.add(fill)
  box(5.5, 0.5, 1.5, DARK, 0.1, 0.55, 0, g)
  const axles = []
  for (const wx of [2.5, 0.2, -1.9]) {
    const axle = new THREE.Group(); axle.position.set(wx, 0.42, 0)
    for (const wz of [0.85, -0.85]) {
      const w = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.42, 0.28, 16), std(0x1e2226, { roughness: 0.9 }))
      w.rotation.x = Math.PI / 2; w.position.z = wz; axle.add(w)
    }
    g.add(axle); axles.push(axle)
  }
  const bub = makeBubble(fuel); bub.position.set(0.2, 4.5, 0); g.add(bub)
  const body = new THREE.Group() // gövde eğimi (fren/kalkış nüansı) için sarmalayıcı
  g.userData = { fill, bubble: bub, axles }
  return g
}
function makeBubble(fuel) {
  const cv = document.createElement('canvas'); cv.width = 320; cv.height = 200
  const tex = new THREE.CanvasTexture(cv); tex.anisotropy = 8
  const spr = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, depthWrite: false, transparent: true }))
  spr.scale.set(4.8, 3.0, 1); spr.userData = { cv, ctx: cv.getContext('2d'), tex, fuel }
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
  if (done) { ctx.fillStyle = '#27a05a'; ctx.font = '800 92px system-ui, sans-serif'; ctx.fillText('✓', 160, 74) }
  else {
    ctx.fillStyle = FUEL_HEX[fuel]; roundRect(ctx, 34, 30, 252, 44, 22); ctx.fill()
    ctx.fillStyle = '#fff'; ctx.font = '800 30px system-ui, sans-serif'; ctx.fillText(FUEL_LABEL[fuel], 160, 53)
    ctx.fillStyle = '#0d1420'; ctx.font = '800 46px system-ui, sans-serif'; ctx.fillText(litersText, 160, 110)
  }
  tex.needsUpdate = true
}

// ---- 3 şerit: her tanker kendi bezier yoluyla gelir-yanaşır-çıkar ----
// Yollar apron önünden (sağ-ön) dock'a kıvrılır. entry/ctrl/dock ve çıkış ctrl/exit.
const V = (x, z) => new THREE.Vector3(x, 0, z)
function bezier(p0, p1, p2, t) {
  const u = 1 - t
  return new THREE.Vector3(
    u * u * p0.x + 2 * u * t * p1.x + t * t * p2.x, 0,
    u * u * p0.z + 2 * u * t * p1.z + t * t * p2.z)
}
const LANES = DOCKS.map((d, i) => {
  const dock = V(d.x + 3.2, d.z)                 // tankerin duracağı nokta (başlık altında)
  const entry = V(40, 26 - i * 2)                // sağ-önden gelir (fan)
  const entryCtrl = V(16 + i * 3, d.z + 10)      // kıvrım kontrol noktası
  const exit = V(42, 22 - i * 4)                 // çıkışta sağ-öne
  const exitCtrl = V(18 - i * 2, d.z + 9)
  return { ...d, dock, entry, entryCtrl, exit, exitCtrl }
})
const CYCLE = 10.5, tankers = LANES.map(l => ({ tk: makeTanker(l.fuel), ...l }))
tankers.forEach(t => scene.add(t.tk))
const hoses = tankers.map(() => { const m = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.13, 1, 8), std(DARK)); m.visible = false; scene.add(m); return m })

const easeInOut = (k) => k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2
const easeOut = (k) => 1 - Math.pow(1 - k, 3)
const easeIn = (k) => k * k * k

function updateTanker(idx, t) {
  const T = tankers[idx], g = T.tk, { fill, bubble, axles } = g.userData
  const lt = ((t + T.phase) % CYCLE + CYCLE) % CYCLE
  let pos, tan, p = 0, done = false, filling = false, speed = 0
  if (lt < 3.2) {                                  // GELİŞ: entry→dock (yavaşlayarak)
    const k = easeOut(lt / 3.2), e = 0.02
    pos = bezier(T.entry, T.entryCtrl, T.dock, k)
    tan = bezier(T.entry, T.entryCtrl, T.dock, Math.min(1, k + e)).sub(pos)
    speed = (1 - k)  // yaklaşırken yavaşlar
  } else if (lt < 6.8) {                            // YANAŞMA + DOLUM
    pos = T.dock.clone(); const prev = bezier(T.entry, T.entryCtrl, T.dock, 0.98)
    tan = T.dock.clone().sub(prev); filling = true; p = (lt - 3.2) / 3.6
  } else if (lt < 7.4) {                            // DOLDU ✓
    pos = T.dock.clone(); const prev = bezier(T.entry, T.entryCtrl, T.dock, 0.98)
    tan = T.dock.clone().sub(prev); p = 1; done = true
  } else {                                          // ÇIKIŞ: dock→exit (hızlanarak)
    const k = easeIn((lt - 7.4) / (CYCLE - 7.4)), e = 0.02
    pos = bezier(T.dock, T.exitCtrl, T.exit, k)
    tan = bezier(T.dock, T.exitCtrl, T.exit, Math.min(1, k + e)).sub(pos)
    p = 1; done = true; speed = k
  }
  g.position.set(pos.x, 0, pos.z)
  if (tan.lengthSq() > 1e-5) g.rotation.y = Math.atan2(tan.x, tan.z)
  fill.scale.set(Math.max(0.001, p), 1, Math.max(0.001, p))
  // tekerlek dönüşü + hafif gövde iniş-kalkışı
  for (const ax of axles) ax.rotation.x -= speed * 0.35 + (speed > 0.01 ? 0.12 : 0)

  drawBubble(bubble, `${(Math.round(T.liters * p / 100) * 100).toLocaleString('tr-TR')} L`, p >= 1 && lt >= 6.8)

  const hose = hoses[idx]
  if (filling) {
    hose.visible = true
    const from = V(T.dock.x - 0.3, T.dock.z); from.y = 4.2
    const to = new THREE.Vector3(g.position.x - 0.7, 1.6, g.position.z)
    hose.position.copy(from).add(to).multiplyScalar(0.5)
    hose.scale.y = from.distanceTo(to)
    hose.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), to.clone().sub(from).normalize())
  } else hose.visible = false
}

window.__ready = false
window.renderAt = function (t) {
  const fl = 1 + Math.sin(t * 11) * 0.11 + Math.sin(t * 23) * 0.05
  flame.scale.set(1, fl, 1); flameCore.scale.set(1, fl * 1.05, 1)
  flareLight.intensity = 1.4 + Math.sin(t * 17) * 0.4
  for (let i = 0; i < tankers.length; i++) updateTanker(i, t)
  renderer.render(scene, camera)
}
window.renderAt(0)
window.__ready = true
