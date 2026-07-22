/**
 * BenelOil — TPS EV promo (Twitter için).
 * Oyunun gerçek assetleri: Kenney EV arabası (race-future) kıvrımlı yolda arkadan (TPS)
 * kovalanır; yol kenarında ağaçlar, evler, "BENELOIL · x KM" tabelaları; kırmızı orta şerit.
 * Sonunda 6-parselli dolu istasyona (buildEstate) girip EV şarja yanaşır → kahraman çekim.
 */
import * as THREE from 'three'
import { initStation, buildEstate, ESTATE_CAR_STOP } from './promostation'
import { loadStatics, fitModel } from './models'
import { buildCarMesh } from './cars'

const canvas = document.getElementById('c') as HTMLCanvasElement
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true })
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75))
renderer.setSize(innerWidth, innerHeight)
renderer.shadowMap.enabled = true
renderer.shadowMap.type = THREE.PCFSoftShadowMap
renderer.toneMapping = THREE.ACESFilmicToneMapping
renderer.toneMappingExposure = 1.06

const scene = new THREE.Scene()
scene.background = new THREE.Color(0xbfe6f2)
scene.fog = new THREE.Fog(0xbfe6f2, 55, 165)

const camera = new THREE.PerspectiveCamera(52, innerWidth / innerHeight, 0.5, 500)
camera.up.set(0, 0, 1)
camera.position.set(0, -130, 8)

// ---- ışık ----
scene.add(new THREE.HemisphereLight(0xffffff, 0x8fae72, 0.95))
const sun = new THREE.DirectionalLight(0xfff2d8, 1.15)
sun.position.set(30, -20, 60); sun.castShadow = true
sun.shadow.mapSize.set(2048, 2048)
const sc = sun.shadow.camera as THREE.OrthographicCamera
sc.left = -60; sc.right = 60; sc.top = 60; sc.bottom = -60; sc.near = 1; sc.far = 220
scene.add(sun)

// ---- zemin (çimen) ----
const ground = new THREE.Mesh(new THREE.PlaneGeometry(600, 600), new THREE.MeshLambertMaterial({ color: 0x86c06a }))
ground.receiveShadow = true; scene.add(ground)

const lam = (c: number) => new THREE.MeshLambertMaterial({ color: c })
const box = (w: number, d: number, h: number, c: number, x: number, y: number, z: number, rz = 0) => {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, d, h), lam(c))
  m.position.set(x, y, z); m.rotation.z = rz; m.castShadow = true; return m
}

// ---- kıvrımlı yol eğrisi (araç −Y'den +Y'ye, estate girişine varır) ----
const roadPts = [
  new THREE.Vector3(0, -128, 0), new THREE.Vector3(11, -108, 0), new THREE.Vector3(-9, -88, 0),
  new THREE.Vector3(12, -68, 0), new THREE.Vector3(-7, -48, 0), new THREE.Vector3(4, -32, 0),
  new THREE.Vector3(0, -23, 0), new THREE.Vector3(0, -18, 0),
].map(v => v.clone())
const curve = new THREE.CatmullRomCurve3(roadPts, false, 'catmullrom', 0.5)
const ROAD_W = 3.8

// yol şeridi (asfalt) — eğri boyunca üçgen şerit
function buildRoad(): void {
  const N = 260
  const pos: number[] = [], idx: number[] = []
  const up = new THREE.Vector3(0, 0, 1)
  for (let i = 0; i <= N; i++) {
    const u = i / N
    const p = curve.getPointAt(u)
    const tg = curve.getTangentAt(u)
    const perp = new THREE.Vector3().crossVectors(tg, up).normalize()
    const l = p.clone().addScaledVector(perp, ROAD_W)
    const r = p.clone().addScaledVector(perp, -ROAD_W)
    pos.push(l.x, l.y, 0.03, r.x, r.y, 0.03)
    if (i < N) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2) }
  }
  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  geo.setIndex(idx); geo.computeVertexNormals()
  const road = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ color: 0x33383e }))
  road.receiveShadow = true; scene.add(road)
  // kenar bordürleri (açık gri ince şeritler)
  for (const side of [1, -1]) {
    const cp: number[] = [], ci: number[] = []
    for (let i = 0; i <= N; i++) {
      const u = i / N, p = curve.getPointAt(u), tg = curve.getTangentAt(u)
      const perp = new THREE.Vector3().crossVectors(tg, up).normalize()
      const a = p.clone().addScaledVector(perp, side * ROAD_W)
      const b = p.clone().addScaledVector(perp, side * (ROAD_W + 0.35))
      cp.push(a.x, a.y, 0.05, b.x, b.y, 0.05)
      if (i < N) { const k = i * 2; ci.push(k, k + 1, k + 2, k + 1, k + 3, k + 2) }
    }
    const cg = new THREE.BufferGeometry()
    cg.setAttribute('position', new THREE.Float32BufferAttribute(cp, 3)); cg.setIndex(ci); cg.computeVertexNormals()
    scene.add(new THREE.Mesh(cg, lam(0xd8dbde)))
  }
  // KIRMIZI orta şerit — kesikli
  const len = curve.getLength()
  const dash = 2.2, gap = 1.8, step = dash + gap
  for (let s = 0; s < len; s += step) {
    const u = s / len, u2 = Math.min(1, (s + dash) / len)
    const p = curve.getPointAt(u), tg = curve.getTangentAt(u)
    const mid = p.clone().addScaledVector(tg, dash / 2)
    const m = box(dash, 0.28, 0.02, 0xd64545, mid.x, mid.y, 0.06, Math.atan2(tg.y, tg.x))
    scene.add(m); void u2
  }
}

// ---- "BENELOIL · x KM" yol tabelası (canvas texture) ----
function kmSignTexture(top: string, bottom: string): THREE.Texture {
  const c = document.createElement('canvas'); c.width = 512; c.height = 256
  const x = c.getContext('2d')!
  x.fillStyle = '#fdfaf2'; x.fillRect(0, 0, 512, 256)
  x.strokeStyle = '#d8cbb3'; x.lineWidth = 16; x.strokeRect(8, 8, 496, 240)
  x.textAlign = 'center'; x.fillStyle = '#d64545'
  x.font = '800 92px "Baloo 2", system-ui, sans-serif'
  x.fillText(top, 256, 108)
  x.fillStyle = '#1e2a36'; x.font = '800 74px "Baloo 2", system-ui, sans-serif'
  x.fillText(bottom, 256, 200)
  const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 4
  return tex
}
function placeKmSign(u: number, side: number, top: string, bottom: string): void {
  const p = curve.getPointAt(u), tg = curve.getTangentAt(u)
  const perp = new THREE.Vector3().crossVectors(tg, new THREE.Vector3(0, 0, 1)).normalize()
  const base = p.clone().addScaledVector(perp, side * (ROAD_W + 2.6))
  const g = new THREE.Group()
  // direk (dikey)
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.13, 3.6, 8), lam(0x565e66))
  pole.rotation.x = Math.PI / 2; pole.position.z = 1.8; pole.castShadow = true; g.add(pole)
  // panel — dikey duran çift taraflı düzlem (arka panel yok → çıkıntı olmaz)
  const panel = new THREE.Mesh(new THREE.PlaneGeometry(3.3, 1.65),
    new THREE.MeshBasicMaterial({ map: kmSignTexture(top, bottom), side: THREE.DoubleSide }))
  panel.rotation.x = Math.PI / 2; panel.position.z = 3.2; g.add(panel)
  g.position.copy(base)
  g.rotation.z = Math.atan2(tg.y, tg.x) // yola paralel; çift taraflı olduğu için her yönden okunur
  scene.add(g)
}

// ---- prosedürel low-poly ev ----
const HOUSE_COLS = [0xe6c98a, 0xd9a97a, 0xc9b58e, 0xbcd0a6, 0xe0b6a0]
const ROOF_COLS = [0xb5563f, 0x8a4b3a, 0xd64545, 0x6b7a8a]
function placeHouse(x: number, y: number, seed: number): void {
  const g = new THREE.Group()
  const w = 2.4 + (seed % 2), d = 2.4 + ((seed >> 1) % 2), h = 2.2 + (seed % 2) * 0.5
  const col = HOUSE_COLS[seed % HOUSE_COLS.length], roof = ROOF_COLS[seed % ROOF_COLS.length]
  g.add(box(w, d, h, col, 0, 0, h / 2))
  const r = new THREE.Mesh(new THREE.ConeGeometry(Math.max(w, d) * 0.78, 1.5, 4), lam(roof))
  r.rotation.x = Math.PI / 2; r.rotation.z = Math.PI / 4; r.position.z = h + 0.75; r.castShadow = true; g.add(r)
  g.add(box(0.6, 0.05, 1.1, 0x6b4a33, 0, -d / 2 - 0.02, 0.55)) // kapı
  g.position.set(x, y, 0); g.rotation.z = (seed % 4) * 0.3
  scene.add(g)
}

let evCar: THREE.Group | null = null
async function boot() {
  await initStation()

  buildRoad()
  scene.add(buildEstate())

  // yol kenarı: ağaçlar + evler (eğri boyunca örnekle) — estate yakınını (y>-34) boş bırak
  const statics = await loadStatics().catch(() => null)
  const up = new THREE.Vector3(0, 0, 1)
  const treeL = statics?.treeLarge, treeS = statics?.treeSmall
  const len = curve.getLength()
  for (let s = 8; s < len - 20; s += 10) {
    const u = s / len
    const p = curve.getPointAt(u), tg = curve.getTangentAt(u)
    const perp = new THREE.Vector3().crossVectors(tg, up).normalize()
    for (const side of [1, -1]) {
      const seed = Math.floor(s * 7 + (side > 0 ? 3 : 11))
      const off = ROAD_W + 5 + (seed % 3) * 1.5
      const at = p.clone().addScaledVector(perp, side * off)
      if (at.y > -40) continue // NİHAİ konuma göre: estate + koridoru boş bırak
      if (seed % 5 < 3) { // ağaç (küçük)
        const proto = (seed % 2 && treeS) ? treeS : treeL
        if (proto) { const tm = fitModel(proto, 1.6 + (seed % 3) * 0.4); tm.position.set(at.x, at.y, 0); tm.rotation.z = seed; scene.add(tm) }
      } else { // ev (çok daha dışarı, arka planda)
        const at2 = p.clone().addScaledVector(perp, side * (off + 12 + (seed % 4)))
        if (at2.y > -40) continue
        placeHouse(at2.x, at2.y, seed)
      }
    }
  }

  // "BENELOIL · x KM" tabelaları
  placeKmSign(0.24, 1, 'BENELOIL', '1 KM →')
  placeKmSign(0.52, -1, 'BENELOIL', '500 M →')
  placeKmSign(0.78, 1, 'BENELOIL ⚡', '100 M →')

  // EV araba — oyunun GERÇEK elektrikli aracı (prosedürel cyan hatch, buildCarMesh)
  evCar = buildCarMesh('hatch', 0x35c7d6)
  evCar.traverse(o => { if ((o as THREE.Mesh).isMesh) o.castShadow = true })
  scene.add(evCar)

  document.getElementById('loading')?.remove()
  start()
}

// ---- animasyon: TPS kovalama + estate girişi + kahraman çekim ----
const DRIVE = 9.5   // sn: yolu kat et
const PULL = 2.2    // sn: estate'e yanaş + dur
const HERO = 3.5    // sn: kahraman çekim
const TOTAL = DRIVE + PULL + HERO + 1.4
let clock = new THREE.Clock()
const tmpP = new THREE.Vector3(), tmpT = new THREE.Vector3(), camGoal = new THREE.Vector3(), lookGoal = new THREE.Vector3()

function easeInOut(x: number): number { return x < 0.5 ? 2 * x * x : 1 - Math.pow(-2 * x + 2, 2) / 2 }

const forceT = parseFloat(new URLSearchParams(location.search).get('t') || '')
function frame() {
  requestAnimationFrame(frame)
  const t = isFinite(forceT) ? forceT : clock.getElapsedTime() % TOTAL
  if (!evCar) { renderer.render(scene, camera); return }

  const roadEnd = curve.getPointAt(1)
  if (t < DRIVE) {
    // yolu kat et
    const u = easeInOut(Math.min(1, t / DRIVE))
    curve.getPointAt(u, tmpP); curve.getTangentAt(u, tmpT).normalize()
    evCar.position.set(tmpP.x, tmpP.y, 0)
    evCar.rotation.z = Math.atan2(tmpT.y, tmpT.x)
    // TPS: aracın arkasında + üstünde (yakın kovalama, yakın dekoru aşmak için biraz yüksek)
    camGoal.copy(tmpP).addScaledVector(tmpT, -7); camGoal.z = 4.3
    lookGoal.copy(tmpP).addScaledVector(tmpT, 4.5); lookGoal.z = 1.0
    camera.position.lerp(camGoal, 0.16)
    camera.lookAt(lookGoal)
    showText(false)
  } else if (t < DRIVE + PULL) {
    // estate'e yanaş: yol sonundan EV şarj durağına
    const k = easeInOut((t - DRIVE) / PULL)
    tmpP.lerpVectors(roadEnd, ESTATE_CAR_STOP, k)
    evCar.position.set(tmpP.x, tmpP.y, 0)
    evCar.rotation.z = Math.PI / 2 // +Y'ye (estate'e) bak
    camGoal.set(-7, -25, 6.5)
    camera.position.lerp(camGoal, 0.09)
    camera.lookAt(0, -9, 2)
    showText(false)
  } else if (t < DRIVE + PULL + HERO) {
    // kahraman çekim: estate'e yakın + yüksek (ağaçların üstünden bakar)
    const k = easeInOut((t - DRIVE - PULL) / HERO)
    evCar.position.copy(ESTATE_CAR_STOP); evCar.rotation.z = Math.PI / 2
    camGoal.set(-2 + k * 4, -26 + k * 3, 17 + k * 5)
    camera.position.lerp(camGoal, 0.06)
    camera.lookAt(0, 1, 2)
    showText(true)
  } else {
    // kısa bekleme → döngü
    camera.lookAt(0, -1, 2.5)
  }
  renderer.render(scene, camera)
}

let textShown = false
function showText(on: boolean) {
  if (on === textShown) return
  textShown = on
  document.getElementById('promo-text')?.classList.toggle('show', on)
}

function start() { clock = new THREE.Clock(); frame() }
addEventListener('keydown', e => { if (e.key === 'r' || e.key === 'R') clock = new THREE.Clock() })
addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix()
  renderer.setSize(innerWidth, innerHeight)
})
boot()
