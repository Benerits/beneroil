/**
 * BenelOil — "İstasyonunu bul" film şeridi (video için).
 * İstasyonlar (gerçek save konfigleriyle, İSİM YOK/KVKK) soldan akıp geçer; her birinin
 * üstünde mini stat etiketi, merkezdekinin detaylı stat kartı. "Kendi istasyonunu buldun mu?"
 * Performans: aynı anda sadece ~9 istasyon canlı (geri dönüşümlü) → çok hafif.
 */
import * as THREE from 'three'

interface St {
  name: string; pumps: number; ev: number; market: number; toilet: number
  wash: boolean; oil: boolean; coffee: boolean; restaurant: boolean; truckpark: boolean
  solar: number; smr: boolean; battery: number; tank: number; sign: number; day: number; money: number
}
const RED = 0xd64545, RED_DARK = 0xb23434, CREAM = 0xf3ead4, CONCRETE = 0xb9bec4
const GREEN = 0x27a05a, ORANGE = 0xe8862e, BLUE = 0x2f6fed, TEAL = 0x1fa8bc, DARK = 0x39424e
const lam = (c: number) => new THREE.MeshLambertMaterial({ color: c })
const box = (w: number, d: number, h: number, c: number | THREE.Material, x: number, y: number, z: number, g: THREE.Group) => {
  const m = new THREE.Mesh(SHARED.box, typeof c === 'number' ? lam(c) : c); m.scale.set(w, d, h); m.position.set(x, y, z); g.add(m); return m
}
const SHARED = { box: new THREE.BoxGeometry(1, 1, 1), sph: new THREE.SphereGeometry(1, 12, 10), cyl: new THREE.CylinderGeometry(1, 1, 1, 10).rotateX(Math.PI / 2) }

const canvas = document.getElementById('c') as HTMLCanvasElement
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true })
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75))
renderer.setSize(window.innerWidth, window.innerHeight)
renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.05
const scene = new THREE.Scene()
scene.background = new THREE.Color(0xbfe0ef)
scene.fog = new THREE.Fog(0xbfe0ef, 55, 120)
const camera = new THREE.PerspectiveCamera(42, innerWidth / innerHeight, 0.5, 400)
camera.position.set(0, -15, 9); camera.lookAt(0, 0, 2.2)
scene.add(new THREE.HemisphereLight(0xffffff, 0x8a9a72, 1.0))
const sun = new THREE.DirectionalLight(0xfff2d8, 1.1); sun.position.set(0.4, -1, 1.3); scene.add(sun)
scene.add(new THREE.Mesh(new THREE.PlaneGeometry(600, 60), lam(0x8fbf6e)))

/** tek istasyonu konfigüre kur (grup, ~20 mesh) */
function buildStation(s: St): THREE.Group {
  const g = new THREE.Group()
  const np = Math.max(1, Math.min(7, s.pumps))
  box(6.4, 6.4, 0.24, CONCRETE, 0, 0, 0.12, g)
  const rowW = (np - 1) * 0.85
  for (let p = 0; p < np; p++) box(0.34, 0.5, 1.1, RED_DARK, -rowW / 2 + p * 0.85, -0.6, 0.55, g)
  const cw = Math.max(2.4, np * 0.95)
  box(cw, 2.6, 0.34, RED, 0, -0.6, 2.35, g); box(cw + 0.15, 2.75, 0.14, 0xffffff, 0, -0.6, 2.12, g)
  for (const [lx, ly] of [[cw / 2 - 0.3, 1], [-cw / 2 + 0.3, 1], [cw / 2 - 0.3, -1], [-cw / 2 + 0.3, -1]] as const) {
    const leg = new THREE.Mesh(SHARED.cyl, lam(CREAM)); leg.scale.set(0.12, 0.12, 2.3); leg.position.set(lx, -0.6 + ly, 1.15); g.add(leg)
  }
  box(1.7, 1.7, 1.8, CREAM, 2.0, 1.9, 0.9, g); box(1.95, 1.95, 0.25, RED, 2.0, 1.9, 1.9, g)
  const sh = 1.6 + s.sign * 0.7
  const pole = new THREE.Mesh(SHARED.cyl, lam(DARK)); pole.scale.set(0.1, 0.1, sh); pole.position.set(-2.6, -2.2, sh / 2); g.add(pole)
  box(0.16, 1.1, 0.85, RED, -2.6, -2.2, sh + 0.4, g)
  const spots: [number, number][] = [[-2, 1.9], [-2, 0.2], [2, 0.2], [-2, -1.9], [2, -1.9], [0, 2.4]]; let si = 0
  const put = (col: number, h = 1.2, w = 1.4) => { const [ox, oy] = spots[si++ % spots.length]; box(w, w, h, col, ox, oy, h / 2, g) }
  if (s.market > 0) put(0xe4c07a, 1.4 + s.market * 0.3, 1.9)
  if (s.restaurant) put(0xc0693a, 1.5, 1.7)
  if (s.wash) put(0x59b6d6, 1.1)
  if (s.oil) put(0x7a5230, 1.1)
  if (s.coffee) put(0x9a6b3f, 1.0, 1.1)
  if (s.toilet) put(0xdfe3e8, 1.0, 1.1)
  if (s.truckpark) put(0x6b7078, 0.5, 2.2)
  if (s.battery > 0) put(TEAL, 0.9, 1.0)
  if (s.smr) put(0xcfd4d9, 1.8, 1.6)
  for (let e = 0; e < Math.min(6, s.ev); e++) box(0.34, 0.34, 1.0, TEAL, 2.6, 1.0 - e * 0.6, 0.5, g)
  for (let sp = 0; sp < Math.min(6, s.solar); sp++) box(0.8, 0.06, 0.9, 0x2a3a66, -2.8 + (sp % 3) * 0.9, 2.6, 0.6, g)
  const tr = 0.34 + s.tank * 0.06
  for (const [ti, tc] of [[0, GREEN], [1, ORANGE], [2, BLUE]] as const) { const sp = new THREE.Mesh(SHARED.sph, lam(tc)); sp.scale.setScalar(tr); sp.position.set(2.9, -1.4 - ti * 0.8, tr + 0.3); g.add(sp) }
  return g
}

/** istasyon üstü mini stat etiketi (₺ · gün · pompa) — canvas sprite */
function statSprite(s: St): THREE.Sprite {
  const c = document.createElement('canvas'); c.width = 320; c.height = 96
  const x = c.getContext('2d')!
  x.fillStyle = '#faf6ec'; x.strokeStyle = '#d8cbb3'; x.lineWidth = 6
  roundRect(x, 6, 6, 308, 84, 20); x.fill(); x.stroke()
  x.textAlign = 'center'; x.textBaseline = 'middle'
  x.fillStyle = '#d64545'; x.font = '800 40px "Baloo 2", sans-serif'
  x.fillText(`₺${Math.round(s.money).toLocaleString('tr-TR')}`, 160, 34)
  x.fillStyle = '#5a6470'; x.font = '800 26px "Baloo 2", sans-serif'
  x.fillText(`Gün ${s.day}  ·  ⛽${s.pumps}  ·  ⚡${s.ev}`, 160, 70)
  const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false }))
  sp.scale.set(5.2, 1.56, 1); return sp
}
function roundRect(x: CanvasRenderingContext2D, a: number, b: number, w: number, h: number, r: number) {
  x.beginPath(); x.moveTo(a + r, b); x.arcTo(a + w, b, a + w, b + h, r); x.arcTo(a + w, b + h, a, b + h, r)
  x.arcTo(a, b + h, a, b, r); x.arcTo(a, b, a + w, b, r); x.closePath()
}

const statEl = document.getElementById('stat')!
function showDetail(s: St) {
  const facs = [['🛒', s.market], ['🚿', s.wash ? 1 : 0], ['🔧', s.oil ? 1 : 0], ['☕', s.coffee ? 1 : 0], ['🍽️', s.restaurant ? 1 : 0], ['🚚', s.truckpark ? 1 : 0], ['☀️', s.solar], ['☢️', s.smr ? 1 : 0]]
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
  let stations: St[] = []
  try { stations = await (await fetch('/promo-stations.json')).json() } catch { /* boş */ }
  if (!stations.length) return
  // gün + gelişmişliğe göre sırala (tutarlı akış)
  stations.sort((a, b) => (b.day + b.money / 5000) - (a.day + a.money / 5000))
  const N = stations.length

  const SPACING = 11, SPEED0 = 8
  const SLOTS = Math.ceil((innerWidth / innerHeight) * 20 / SPACING) + 4 // ekrana sığacak kadar + tampon
  const RIGHT = (SLOTS / 2) * SPACING
  interface Slot { g: THREE.Group; label: THREE.Sprite; idx: number; x: number }
  const slots: Slot[] = []
  let nextIdx = 0
  for (let i = 0; i < SLOTS; i++) {
    const idx = nextIdx++ % N; const s = stations[idx]
    const g = buildStation(s); const label = statSprite(s); label.position.set(0, -0.6, 4.6); g.add(label)
    g.position.set(RIGHT - i * SPACING, 0, 0); scene.add(g)
    slots.push({ g, label, idx, x: g.position.x })
  }
  let speed = SPEED0, paused = false, lastFocus = -1
  let prev = performance.now()
  function frame() {
    requestAnimationFrame(frame)
    const now = performance.now(); const dt = Math.min((now - prev) / 1000, 0.05); prev = now
    if (!paused) for (const sl of slots) {
      sl.x -= speed * dt; sl.g.position.x = sl.x
      if (sl.x < -RIGHT - 2) { // geri dönüşüm: sağa taşı + sonraki istasyon
        sl.x += SLOTS * SPACING; const idx = nextIdx++ % N; const s = stations[idx]
        scene.remove(sl.g); disposeGroup(sl.g)
        const g = buildStation(s); const label = statSprite(s); label.position.set(0, -0.6, 4.6); g.add(label)
        g.position.set(sl.x, 0, 0); scene.add(g); sl.g = g; sl.label = label; sl.idx = idx
      }
    }
    // merkeze en yakın istasyonun detayını göster
    let best = slots[0]; for (const sl of slots) if (Math.abs(sl.x) < Math.abs(best.x)) best = sl
    if (best.idx !== lastFocus) { lastFocus = best.idx; showDetail(stations[best.idx]) }
    renderer.render(scene, camera)
  }
  frame()
  addEventListener('keydown', ev => {
    if (ev.key === 'ArrowUp') speed = Math.min(30, speed + 2)
    if (ev.key === 'ArrowDown') speed = Math.max(2, speed - 2)
    if (ev.key === ' ') { ev.preventDefault(); paused = !paused }
  })
}
function disposeGroup(g: THREE.Group) {
  g.traverse(o => { const m = o as THREE.Mesh; if (m.material) { const mm = m.material as THREE.Material & { map?: THREE.Texture }; mm.map?.dispose?.(); (m.material as THREE.Material).dispose?.() } })
}
addEventListener('resize', () => { camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); renderer.setSize(innerWidth, innerHeight) })
boot()
