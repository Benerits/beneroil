/**
 * BenelOil — "1000 istasyon" tanıtım sahnesi (video çekimi için).
 * Gerçek oyuncu save'lerinden (public/promo-stations.json) her istasyon kendi
 * konfigürasyonuyla (pompa/tesis/EV/tabela/tank) çizilir. İSİM YOK (KVKK).
 * En gelişmiş oyuncular MERKEZDE (phyllotaxis: rank0=merkez → dışa). Kamera kuş-
 * bakışından merkeze sinematik zoom yapar → teşekkür plakası + konfeti.
 * Performans: her parça türü tek InstancedMesh → ~12 draw call, 60fps akar.
 */
import * as THREE from 'three'

interface St {
  name: string; pumps: number; ev: number; market: number; toilet: number
  wash: boolean; oil: boolean; coffee: boolean; restaurant: boolean; truckpark: boolean
  solar: number; smr: boolean; battery: number; tank: number; sign: number; day: number; money: number
}

const RED = 0xd64545, RED_DARK = 0xb23434, CREAM = 0xf3ead4, CONCRETE = 0xb9bec4
const GREEN = 0x27a05a, ORANGE = 0xe8862e, BLUE = 0x2f6fed, TEAL = 0x1fa8bc, DARK = 0x39424e

const canvas = document.getElementById('c') as HTMLCanvasElement
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true })
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75))
renderer.setSize(window.innerWidth, window.innerHeight)
renderer.toneMapping = THREE.ACESFilmicToneMapping
renderer.toneMappingExposure = 1.05

const scene = new THREE.Scene()
scene.background = new THREE.Color(0xbfe0ef) // açık gökyüzü
scene.fog = new THREE.Fog(0xbfe0ef, 340, 950) // uzaklaşınca 1000 istasyon görünür kalsın, sadece çok uzak zarifçe silinsin

const camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.5, 2000)

scene.add(new THREE.HemisphereLight(0xffffff, 0x8a9a72, 0.95))
const sun = new THREE.DirectionalLight(0xfff2d8, 1.15)
sun.position.set(0.5, -1, 1.4)
scene.add(sun)

// zemin (çimen)
const ground = new THREE.Mesh(new THREE.CircleGeometry(700, 64), new THREE.MeshLambertMaterial({ color: 0x8fbf6e }))
scene.add(ground)

// ---- yardımcı: bir InstancedMesh'e transform + renk yığmak için ----
const dummy = new THREE.Object3D()
class Batch {
  m: THREE.InstancedMesh; n = 0; colored: boolean
  constructor(geo: THREE.BufferGeometry, mat: THREE.Material, count: number, colored = false) {
    this.m = new THREE.InstancedMesh(geo, mat, Math.max(1, count))
    this.colored = colored
    if (colored) this.m.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(Math.max(1, count) * 3), 3)
    scene.add(this.m)
  }
  add(x: number, y: number, z: number, sx: number, sy: number, sz: number, rotZ = 0, color?: number) {
    dummy.position.set(x, y, z); dummy.scale.set(sx, sy, sz); dummy.rotation.set(0, 0, rotZ)
    dummy.updateMatrix(); this.m.setMatrixAt(this.n, dummy.matrix)
    if (this.colored && color !== undefined) this.m.setColorAt(this.n, tmpCol.setHex(color))
    this.n++
  }
  finish() { this.m.count = this.n; this.m.instanceMatrix.needsUpdate = true; if (this.m.instanceColor) this.m.instanceColor.needsUpdate = true }
}
const tmpCol = new THREE.Color()

// paylaşılan geometriler
const G = {
  box: new THREE.BoxGeometry(1, 1, 1),
  cyl: new THREE.CylinderGeometry(1, 1, 1, 10).rotateX(Math.PI / 2), // z ekseni boyunca
  sphere: new THREE.SphereGeometry(1, 12, 10),
}
const lam = (c: number) => new THREE.MeshLambertMaterial({ color: c })

let started = false
async function boot() {
  let stations: St[] = []
  try { stations = await (await fetch('/promo-stations.json')).json() } catch { /* boşsa demo */ }
  if (!stations.length) { for (let i = 0; i < 700; i++) stations.push({ name: '', pumps: 1 + (i % 6), ev: i % 4, market: i % 3, toilet: i % 2, wash: !!(i % 2), oil: !!(i % 3), coffee: !!(i % 2), restaurant: !!(i % 4), truckpark: !!(i % 3), solar: i % 3, smr: i % 50 === 0, battery: i % 3, tank: i % 4, sign: i % 4, day: 300 - (i % 300), money: 100000 - i * 100 }) }

  // gelişmişlik skoru → en gelişmiş MERKEZDE
  const score = (s: St) => s.day + s.pumps * 22 + s.ev * 20 + s.market * 18 + s.tank * 16 + s.sign * 10
    + (s.wash ? 15 : 0) + (s.oil ? 18 : 0) + (s.coffee ? 12 : 0) + (s.restaurant ? 22 : 0) + (s.truckpark ? 20 : 0)
    + (s.toilet ? 8 : 0) + s.solar * 12 + (s.smr ? 120 : 0) + s.battery * 10 + Math.min(200, s.money / 4000)
  stations.sort((a, b) => score(b) - score(a))
  // 1000'e tamamla (gerçek konfigleri döngüyle çoğalt) — daha dolu alan + yuvarlak "1000"
  const real = stations.length
  if (real > 0) while (stations.length < 1000) stations.push(stations[stations.length % real])
  const N = stations.length
  document.getElementById('t-count')!.textContent = N.toLocaleString('tr-TR')
  document.getElementById('t-sub')!.textContent = 'OYUNCUYA ULAŞTIK 🎉'

  // phyllotaxis (ayçiçeği) yerleşimi: rank0=merkez, dışa doğru dairesel
  const SP = 6.6 // istasyonlar arası sıkışıklık
  const GOLD = Math.PI * (3 - Math.sqrt(5))
  const pos: [number, number][] = []
  for (let i = 0; i < N; i++) { const r = SP * Math.sqrt(i + 0.6); const a = i * GOLD; pos.push([r * Math.cos(a), r * Math.sin(a)]) }
  const fieldR = SP * Math.sqrt(N)

  // parça-batch'leri (kabaca kapasite tahmini)
  const platform = new Batch(G.box, lam(CONCRETE), N)
  const canopy = new Batch(G.box, lam(RED), N)
  const canopyTrim = new Batch(G.box, lam(0xffffff), N)
  const legs = new Batch(G.cyl, lam(CREAM), N * 4)
  const pumpB = new Batch(G.box, lam(RED_DARK), N * 4)
  const kiosk = new Batch(G.box, lam(CREAM), N)
  const kioskRoof = new Batch(G.box, lam(RED), N)
  const detail = new Batch(G.box, new THREE.MeshLambertMaterial({ vertexColors: false }), N * 8, true) // tesis kutuları (renkli)
  const solarP = new Batch(G.box, lam(0x2a3a66), N * 3)
  const tankB = new Batch(G.sphere, new THREE.MeshLambertMaterial(), N * 3, true)
  const signPole = new Batch(G.cyl, lam(DARK), N)
  const signPanel = new Batch(G.box, lam(RED), N)

  for (let i = 0; i < N; i++) {
    const s = stations[i]; const [cx, cy] = pos[i]
    const np = Math.max(1, Math.min(7, s.pumps))
    // beton pad
    platform.add(cx, cy, 0.12, 6.4, 6.4, 0.24)
    // pompalar (bir sıra, merkezde)
    const rowW = (np - 1) * 0.85
    for (let p = 0; p < np; p++) pumpB.add(cx - rowW / 2 + p * 0.85, cy - 0.6, 0.55, 0.34, 0.5, 1.1)
    // kanopi (pompaların üstünde) + beyaz şerit + 4 ayak
    const cw = Math.max(2.4, np * 0.95)
    canopy.add(cx, cy - 0.6, 2.35, cw, 2.6, 0.34)
    canopyTrim.add(cx, cy - 0.6, 2.12, cw + 0.15, 2.75, 0.14)
    for (const [lx, ly] of [[cw / 2 - 0.3, 1.0], [-cw / 2 + 0.3, 1.0], [cw / 2 - 0.3, -1.0], [-cw / 2 + 0.3, -1.0]] as const)
      legs.add(cx + lx, cy - 0.6 + ly, 1.15, 0.12, 0.12, 2.3)
    // kiosk (mağaza binası, sağ arka)
    kiosk.add(cx + 2.0, cy + 1.9, 0.9, 1.7, 1.7, 1.8); kioskRoof.add(cx + 2.0, cy + 1.9, 1.9, 1.95, 1.95, 0.25)
    // tabela (pole + panel), yükseklik seviyeye göre
    const sh = 1.6 + s.sign * 0.7
    signPole.add(cx - 2.6, cy - 2.2, sh / 2, 0.1, 0.1, sh)
    signPanel.add(cx - 2.6, cy - 2.2, sh + 0.4, 0.16, 1.1, 0.85)
    // ---- tesisler: platform çevresine küçük renkli kutular ----
    const spots: [number, number][] = [[-2.0, 1.9], [-2.0, 0.2], [2.0, 0.2], [-2.0, -1.9], [2.0, -1.9], [0, 2.4]]
    let si = 0
    const put = (col: number, h = 1.2, w = 1.4) => { const [ox, oy] = spots[si % spots.length]; si++; detail.add(cx + ox, cy + oy, h / 2, w, w, h, 0, col) }
    if (s.market > 0) put(0xe4c07a, 1.4 + s.market * 0.3, 1.9)
    if (s.restaurant) put(0xc0693a, 1.5, 1.7)
    if (s.wash) put(0x59b6d6, 1.1)
    if (s.oil) put(0x7a5230, 1.1)
    if (s.coffee) put(0x9a6b3f, 1.0, 1.1)
    if (s.toilet) put(0xdfe3e8, 1.0, 1.1)
    if (s.truckpark) put(0x6b7078, 0.5, 2.2)
    if (s.battery > 0) put(0x2fa8bc, 0.9, 1.0)
    if (s.smr) put(0xcfd4d9, 1.8, 1.6)
    // EV şarj (teal küçük direkler)
    for (let e = 0; e < Math.min(6, s.ev); e++) detail.add(cx + 2.6, cy + 1.0 - e * 0.6, 0.5, 0.34, 0.34, 1.0, 0, TEAL)
    // güneş panelleri (eğik mavi levhalar)
    for (let sp = 0; sp < Math.min(6, s.solar); sp++) solarP.add(cx - 2.8 + (sp % 3) * 0.9, cy + 2.6, 0.6, 0.8, 0.06, 0.9)
    // yakıt tankları (küreler, renkli, tank seviyesine göre boyut)
    const tr = 0.34 + s.tank * 0.06
    for (const [ti, tc] of [[0, GREEN], [1, ORANGE], [2, BLUE]] as const) tankB.add(cx + 2.9, cy - 1.4 - ti * 0.8, tr + 0.3, tr, tr, tr, 0, tc)
  }
  for (const b of [platform, canopy, canopyTrim, legs, pumpB, kiosk, kioskRoof, detail, solarP, tankB, signPole, signPanel]) b.finish()

  document.getElementById('loading')!.style.display = 'none'
  runCinematic(fieldR)
}

// ---- kamera sinematiği: kuşbakışı (hepsi) → merkeze zoom → teşekkür ----
function runCinematic(fieldR: number) {
  // geniş açı 1000 istasyonun HEPSİNİ kadraja alacak kadar uzakta
  const wide = { pos: new THREE.Vector3(0, -fieldR * 1.35, fieldR * 1.5), look: new THREE.Vector3(0, 0, 2) }
  const mid = { pos: new THREE.Vector3(0, -fieldR * 0.5, fieldR * 0.55), look: new THREE.Vector3(0, 0, 3) }
  const close = { pos: new THREE.Vector3(0, -22, 14), look: new THREE.Vector3(0, -1, 3.5) }
  const HOLD = 2.4, ZOOM = 9.0, END = HOLD + ZOOM
  const tmpP = new THREE.Vector3(), tmpL = new THREE.Vector3()
  const thanks = document.getElementById('thanks')!
  let t0 = performance.now() / 1000, paused = false, pauseAt = 0, thanksShown = false

  function frame() {
    requestAnimationFrame(frame)
    const now = performance.now() / 1000
    const t = paused ? pauseAt : now - t0
    let phase: number
    if (t < HOLD) phase = 0
    else phase = Math.min(1, (t - HOLD) / ZOOM)
    const e = phase < 0.5 ? 2 * phase * phase : 1 - Math.pow(-2 * phase + 2, 2) / 2 // easeInOutQuad
    // iki kademeli lerp: close→mid→wide (YAKINDAN UZAĞA — sonda 1000 istasyon kadraja sığar)
    if (e < 0.5) { const k = e / 0.5; tmpP.lerpVectors(close.pos, mid.pos, k); tmpL.lerpVectors(close.look, mid.look, k) }
    else { const k = (e - 0.5) / 0.5; tmpP.lerpVectors(mid.pos, wide.pos, k); tmpL.lerpVectors(mid.look, wide.look, k) }
    camera.position.copy(tmpP); camera.lookAt(tmpL)
    // hafif sinematik yörünge dönüşü
    const orbit = 0.06 * Math.sin(t * 0.25)
    camera.position.x += Math.sin(orbit) * tmpP.length() * 0.02
    camera.lookAt(tmpL)

    if (t >= END - 0.2 && !thanksShown) { thanksShown = true; thanks.classList.add('show'); burstConfetti() }
    renderer.render(scene, camera)
  }
  frame()

  addEventListener('keydown', ev => {
    if (ev.key === 'r' || ev.key === 'R') { t0 = performance.now() / 1000; paused = false; thanksShown = false; thanks.classList.remove('show'); document.querySelectorAll('.confetti').forEach(c => c.remove()) }
    if (ev.key === ' ') { ev.preventDefault(); if (paused) { t0 = performance.now() / 1000 - pauseAt; paused = false } else { pauseAt = performance.now() / 1000 - t0; paused = true } }
  })
}

function burstConfetti() {
  const cols = ['#d64545', '#27a05a', '#e8862e', '#2f6fed', '#f0c04a', '#ffffff']
  for (let i = 0; i < 140; i++) {
    const c = document.createElement('div'); c.className = 'confetti'
    c.style.left = Math.random() * 100 + 'vw'
    c.style.background = cols[i % cols.length]
    c.style.transform = `rotate(${Math.random() * 360}deg)`
    document.body.appendChild(c)
    const dur = 2.6 + Math.random() * 2.2, delay = Math.random() * 0.8
    c.animate([
      { transform: `translateY(0) rotate(0deg)`, opacity: 1 },
      { transform: `translateY(110vh) rotate(${540 + Math.random() * 360}deg)`, opacity: 1 },
    ], { duration: dur * 1000, delay: delay * 1000, easing: 'cubic-bezier(.3,.1,.5,1)', fill: 'forwards' })
    setTimeout(() => c.remove(), (dur + delay) * 1000 + 200)
  }
}

addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight; camera.updateProjectionMatrix()
  renderer.setSize(window.innerWidth, window.innerHeight)
})

if (!started) { started = true; boot() }
