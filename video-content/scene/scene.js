// BenelOil — "Rafineri" tanıtım sahnesi. Deterministik: window.renderAt(t) her kareyi
// t (saniye) üzerinden kurar, böylece kare kare render + ffmpeg ile pürüzsüz video olur.
import * as THREE from './three.module.js'

const W = 1080, H = 1080            // Twitter kare video
const FUEL = { benzin: 0x27a05a, dizel: 0xe8862e, lpg: 0x2f6fed }
const lam = (c) => new THREE.MeshLambertMaterial({ color: c })
const std = (c, opts = {}) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.7, metalness: 0.1, ...opts })

const renderer = new THREE.WebGLRenderer({ antialias: true })
renderer.setSize(W, H)
renderer.setPixelRatio(1)
renderer.shadowMap.enabled = true
renderer.shadowMap.type = THREE.PCFSoftShadowMap
renderer.outputColorSpace = THREE.SRGBColorSpace
document.body.appendChild(renderer.domElement)

const scene = new THREE.Scene()
scene.background = new THREE.Color(0xdfe7ee)
scene.fog = new THREE.Fog(0xdfe7ee, 60, 120)

const camera = new THREE.PerspectiveCamera(38, W / H, 0.1, 300)

// ---- ışık ----
scene.add(new THREE.HemisphereLight(0xfff4e0, 0x9fb0a0, 0.65))
const sun = new THREE.DirectionalLight(0xfff1d8, 1.55)
sun.position.set(24, 40, 18)
sun.castShadow = true
sun.shadow.mapSize.set(2048, 2048)
const sc = sun.shadow.camera
sc.left = -55; sc.right = 55; sc.top = 55; sc.bottom = -55; sc.near = 1; sc.far = 140
sun.shadow.bias = -0.0004
scene.add(sun)

// ---- zemin (çim + merkezi beton) ----
const grass = new THREE.Mesh(new THREE.CircleGeometry(120, 64), std(0x8bbf6a, { roughness: 1 }))
grass.rotation.x = -Math.PI / 2; grass.receiveShadow = true; scene.add(grass)

const apron = new THREE.Mesh(new THREE.CircleGeometry(26, 64), std(0xb9c0c7, { roughness: 0.95 }))
apron.rotation.x = -Math.PI / 2; apron.position.y = 0.02; apron.receiveShadow = true; scene.add(apron)
const apronRing = new THREE.Mesh(new THREE.RingGeometry(25, 26, 64), std(0xd64545))
apronRing.rotation.x = -Math.PI / 2; apronRing.position.y = 0.03; scene.add(apronRing)

// 4 yöne uzanan asfalt yollar
for (let i = 0; i < 4; i++) {
  const road = new THREE.Mesh(new THREE.PlaneGeometry(7, 90), std(0x4c545b, { roughness: 1 }))
  road.rotation.x = -Math.PI / 2; road.position.y = 0.015
  road.rotation.z = i * Math.PI / 2
  const dir = new THREE.Vector3(0, 0, 1).applyAxisAngle(new THREE.Vector3(0, 1, 0), i * Math.PI / 2)
  road.position.addScaledVector(dir, 45)
  road.receiveShadow = true; scene.add(road)
}

function cyl(rt, rb, h, c, x, y, z, parent, cast = true) {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, 24), typeof c === 'number' ? std(c) : c)
  m.position.set(x, y, z); m.castShadow = cast; m.receiveShadow = true; parent.add(m); return m
}
function box(w, h, d, c, x, y, z, parent) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), typeof c === 'number' ? std(c) : c)
  m.position.set(x, y, z); m.castShadow = true; m.receiveShadow = true; parent.add(m); return m
}

// ============ DEV RAFİNERİ (merkez) ============
const refinery = new THREE.Group()
scene.add(refinery)

// beton kaide
const pad = new THREE.Mesh(new THREE.CylinderGeometry(14, 14.6, 0.7, 48), std(0x9aa2a9, { roughness: 1 }))
pad.position.y = 0.35; pad.castShadow = true; pad.receiveShadow = true; refinery.add(pad)

// damıtma kuleleri (yüksek ince kuleler, krem + kırmızı bantlar)
const towerDefs = [[-4, 13, 1.3], [0.5, 17, 1.6], [4.2, 11, 1.15], [-1.8, 9.5, 1.0]]
const flames = []
for (const [x, h, r] of towerDefs) {
  cyl(r, r * 1.08, h, 0xf2efe6, x, 0.7 + h / 2, -3, refinery)
  for (let b = 0; b < 3; b++) cyl(r * 1.02, r * 1.02, 0.5, 0xd64545, x, 1.6 + b * (h / 3.2), -3, refinery, false)
  cyl(r * 0.55, r * 0.7, 0.8, 0x8f979e, x, 0.7 + h + 0.4, -3, refinery) // tepe başlık
}

// büyük depolama tankları (geniş silindirler, beyaz + kırmızı tavan)
const tankDefs = [[-9, 3.4, 4.2], [8.5, 3.8, 4.6], [-8.5, 3.0, -8], [9, 3.2, -7.5]]
for (const [x, r, z] of tankDefs) {
  cyl(r, r, 5.2, 0xf4f2ec, x, 2.7 + 0.7, z, refinery)
  const top = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.5, r, 1.1, 24), std(0xd64545))
  top.position.set(x, 0.7 + 5.2 + 0.5, z); top.castShadow = true; refinery.add(top)
}

// küresel LPG tankları (bacaklı küreler — oyunun küre tankı estetiği)
for (const [x, z] of [[0, 8.5], [5, 7]]) {
  const R = 2.4
  const sp = new THREE.Mesh(new THREE.SphereGeometry(R, 28, 20), std(0xeef0f2, { metalness: 0.2, roughness: 0.5 }))
  sp.position.set(x, 0.7 + R + 1.6, z); sp.castShadow = true; refinery.add(sp)
  cyl(R * 0.9, R, 0.4, 0x2f6fed, x, 0.7 + R + 1.6, z, refinery, false)
  for (let l = 0; l < 4; l++) {
    const a = l * Math.PI / 2 + Math.PI / 4
    cyl(0.18, 0.18, 1.7, 0x7f878e, x + Math.cos(a) * R * 0.6, 0.7 + 0.85, z + Math.sin(a) * R * 0.6, refinery)
  }
}

// flare bacası + alev
const stack = cyl(0.7, 0.9, 20, 0xcf5a3a, 11.5, 0.7 + 10, -9, refinery)
const flame = new THREE.Mesh(new THREE.ConeGeometry(1.0, 3.2, 16),
  new THREE.MeshBasicMaterial({ color: 0xffb03a }))
flame.position.set(11.5, 0.7 + 20 + 1.4, -9); refinery.add(flame)
const flameCore = new THREE.Mesh(new THREE.ConeGeometry(0.5, 1.8, 12), new THREE.MeshBasicMaterial({ color: 0xffe08a }))
flameCore.position.copy(flame.position); flameCore.position.y -= 0.3; refinery.add(flameCore)
const flareLight = new THREE.PointLight(0xffa03a, 2.2, 30); flareLight.position.copy(flame.position); refinery.add(flareLight)

// borular (kuleler ile tankları bağlar) + merkez bina
box(3.6, 3.2, 3.6, 0xe9e4d8, 0, 0.7 + 1.6, 2.5, refinery)
box(4.0, 0.5, 4.0, 0xc23b3b, 0, 0.7 + 3.4, 2.5, refinery)
for (const [x, z] of [[-6, 0], [6, 0], [0, 5]]) {
  const pipe = cyl(0.22, 0.22, 12, 0xb8bdc2, x, 0.7 + 0.9, z, refinery)
  pipe.rotation.z = Math.PI / 2
}

// ============ TANKERLER (4 yön) ============
function makeTanker(fuel) {
  const g = new THREE.Group()
  const cab = box(1.9, 2.0, 2.0, 0xd64545, 2.6, 1.3, 0, g)
  box(1.5, 1.1, 1.7, 0x243244, 2.75, 1.55, 0, g) // ön cam
  const tank = new THREE.Mesh(new THREE.CylinderGeometry(1.15, 1.15, 4.6, 22), std(0xdfe3e6, { metalness: 0.15 }))
  tank.rotation.z = Math.PI / 2; tank.position.set(-0.7, 1.55, 0); tank.castShadow = true; g.add(tank)
  // dolum seviyesi göstergesi: tank içinde yakıt renginde büyüyen silindir
  const fill = new THREE.Mesh(new THREE.CylinderGeometry(1.0, 1.0, 4.4, 22), std(FUEL[fuel], { emissive: FUEL[fuel], emissiveIntensity: 0.15 }))
  fill.rotation.z = Math.PI / 2; fill.position.set(-0.7, 1.55, 0); fill.scale.y = 0.001; g.add(fill)
  box(5.4, 0.5, 1.5, 0x2b2f33, 0.1, 0.55, 0, g) // şasi
  for (const wx of [2.4, 0.2, -1.8]) for (const wz of [0.85, -0.85]) {
    const w = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.42, 0.3, 16), lam(0x1e2226))
    w.rotation.x = Math.PI / 2; w.position.set(wx, 0.42, wz); g.add(w)
  }
  // talep balonu (yakıt renkli pill + litre) — oyunun istek balonu diline uygun
  const bub = makeBubble(fuel)
  bub.position.set(0.2, 4.3, 0); g.add(bub)
  g.userData = { fill, bubble: bub, fuel }
  return g
}

// canvas doku balonu: üstte yakıt-renkli başlık + litre, altta ✓ (doldu)
function makeBubble(fuel) {
  const cv = document.createElement('canvas'); cv.width = 320; cv.height = 200
  const ctx = cv.getContext('2d')
  const tex = new THREE.CanvasTexture(cv); tex.anisotropy = 4
  const spr = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true }))
  spr.scale.set(4.6, 2.9, 1)
  spr.userData = { cv, ctx, tex, fuel }
  return spr
}
const FUEL_HEX = { benzin: '#27a05a', dizel: '#e8862e', lpg: '#2f6fed' }
const FUEL_LABEL = { benzin: 'BENZİN', dizel: 'DİZEL', lpg: 'LPG' }
function drawBubble(spr, litersText, done) {
  const { cv, ctx, tex, fuel } = spr.userData
  ctx.clearRect(0, 0, cv.width, cv.height)
  // gövde
  ctx.fillStyle = '#fffdf7'; ctx.strokeStyle = '#0d1420'; ctx.lineWidth = 6
  roundRect(ctx, 12, 12, 296, 128, 26); ctx.fill(); ctx.stroke()
  // kuyruk
  ctx.beginPath(); ctx.moveTo(140, 138); ctx.lineTo(170, 138); ctx.lineTo(150, 172); ctx.closePath()
  ctx.fillStyle = '#fffdf7'; ctx.fill(); ctx.stroke()
  if (done) {
    ctx.fillStyle = '#27a05a'; ctx.font = '800 90px system-ui, sans-serif'
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('✓', 160, 74)
  } else {
    // yakıt pill
    ctx.fillStyle = FUEL_HEX[fuel]; roundRect(ctx, 34, 30, 252, 44, 22); ctx.fill()
    ctx.fillStyle = '#fff'; ctx.font = '800 30px system-ui, sans-serif'
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(FUEL_LABEL[fuel], 160, 53)
    // litre
    ctx.fillStyle = '#0d1420'; ctx.font = '800 46px system-ui, sans-serif'
    ctx.fillText(litersText, 160, 110)
  }
  tex.needsUpdate = true
}
function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath(); ctx.moveTo(x + r, y)
  ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r)
  ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath()
}

// 4 tanker: yön açısı, yakıt, istenen litre, faz kayması
const LANES = [
  { ang: 0,            fuel: 'dizel',  liters: 24000, phase: 0.0 },
  { ang: Math.PI / 2,  fuel: 'benzin', liters: 18000, phase: 2.0 },
  { ang: Math.PI,      fuel: 'lpg',    liters: 12000, phase: 4.0 },
  { ang: 3 * Math.PI / 2, fuel: 'benzin', liters: 30000, phase: 6.0 },
]
const CYCLE = 8.0            // her tankerin tam döngüsü (sn)
const DOCK = 17             // rafineriye yanaşma mesafesi
const FAR = 70              // yoldan geliş/gidiş mesafesi
const tankers = LANES.map(l => {
  const tk = makeTanker(l.fuel); scene.add(tk); return { tk, ...l }
})
// hortum (dolum sırasında rafineriden tankere)
function makeHose() {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, 1, 10), std(0x1e2226))
  m.visible = false; scene.add(m); return m
}
const hoses = tankers.map(makeHose)

function laneDir(ang) { return new THREE.Vector3(Math.sin(ang), 0, Math.cos(ang)) }

// tanker döngü durumu: t'ye göre pozisyon + dolum + balon
function updateTanker(idx, t) {
  const T = tankers[idx]
  const dir = laneDir(T.ang)
  const lt = ((t + T.phase) % CYCLE + CYCLE) % CYCLE  // 0..CYCLE
  const g = T.tk
  const { fill, bubble } = g.userData
  let dist, filling = false, done = false
  if (lt < 2.0) {                    // yanaşma
    const k = lt / 2.0
    dist = FAR + (DOCK - FAR) * easeOut(k)
  } else if (lt < 5.0) {             // dolum (dokta bekler)
    dist = DOCK; filling = true
  } else if (lt < 5.6) {             // doldu ✓
    dist = DOCK; done = true
  } else {                           // ayrılış
    const k = (lt - 5.6) / (CYCLE - 5.6)
    dist = DOCK + (FAR - DOCK) * easeIn(k); done = true
  }
  g.position.copy(dir).multiplyScalar(dist)
  // kabin rafineriye dönük dursun (yanaşırken içeri, ayrılırken dışarı)
  const facing = lt < 5.6 ? Math.atan2(-dir.x, -dir.z) : Math.atan2(dir.x, dir.z)
  g.rotation.y = facing + Math.PI / 2

  // dolum ilerlemesi
  let p = 0
  if (lt >= 2.0 && lt < 5.0) p = (lt - 2.0) / 3.0
  else if (lt >= 5.0) p = 1
  fill.scale.y = Math.max(0.001, p)
  fill.scale.z = Math.max(0.001, p)

  // balon: dolarken canlı litre; dolunca ✓
  const litersNow = Math.round(T.liters * p / 100) * 100
  drawBubble(bubble, `${litersNow.toLocaleString('tr-TR')} L`, p >= 1 && lt >= 5.0)

  // hortum
  const hose = hoses[idx]
  if (filling) {
    hose.visible = true
    const from = dir.clone().multiplyScalar(13.5).setY(2.2)
    const to = g.position.clone().add(dir.clone().multiplyScalar(1.2)).setY(1.6)
    const mid = from.clone().add(to).multiplyScalar(0.5); mid.y -= 0.4
    hose.position.copy(mid)
    hose.scale.y = from.distanceTo(to)
    hose.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), to.clone().sub(from).normalize())
  } else hose.visible = false
}

function easeOut(k) { return 1 - Math.pow(1 - k, 3) }
function easeIn(k) { return k * k * k }

// ============ ana render ============
window.__ready = false
window.renderAt = function (t) {
  // kamera: yavaş yörünge + hafif nefes
  const az = -0.5 + t * 0.045
  const rad = 52, hgt = 34
  camera.position.set(Math.sin(az) * rad, hgt + Math.sin(t * 0.3) * 1.2, Math.cos(az) * rad)
  camera.lookAt(0, 8.5, 0)

  // flare alev titreşimi
  const fl = 1 + Math.sin(t * 11) * 0.12 + Math.sin(t * 23) * 0.06
  flame.scale.set(1, fl, 1); flameCore.scale.set(1, fl * 1.05, 1)
  flareLight.intensity = 2.0 + Math.sin(t * 17) * 0.5

  for (let i = 0; i < tankers.length; i++) updateTanker(i, t)
  renderer.render(scene, camera)
}
window.renderAt(0)
window.__ready = true
