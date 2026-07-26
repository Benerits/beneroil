import * as THREE from 'three'
import { t } from './i18n'
import { StaticLib, fitModel } from './models'
import { PARCEL_COLS, PARCEL_ROWS, FuelType } from './state'
import { LocationTheme, activeTheme } from './themes'
import type { Kit } from './kits'

// Koordinat sistemi: z yukarı, y sağa, x kameraya doğru.
// Ana arsa: x -6.5..5, y -10..10. Güney arsa y -24..-10, kuzey arsa y 10..24.
// Yol arsadan ayrı: arada yeşil bant (x 5..5.9) ve giriş/çıkış rampaları var.

export const ROAD_X = 7.9
export const LANE_NEAR = 6.95
export const LANE_FAR = 8.85
/** Karşı (yol karşısı) istasyonun kapı x'i — near kapı 4.2'nin ROAD_X etrafında aynası (15.8-4.2). */
export const FAR_GATE_X = 11.6
export const PUMP_SLOTS_POS = [
  new THREE.Vector3(1.8, -2.2, 0), new THREE.Vector3(1.8, 2.2, 0),
  new THREE.Vector3(1.8, -14, 0), new THREE.Vector3(1.8, -18, 0),
]
export const EV_SLOTS_POS = [
  new THREE.Vector3(1.8, 6.2, 0), new THREE.Vector3(1.8, 8.8, 0),
  new THREE.Vector3(1.8, -11.8, 0), new THREE.Vector3(1.8, -21.5, 0),
]
export const TANK_POS = new THREE.Vector3(-5.5, -6.5, 0)
/** araçların kullandığı giriş/çıkış rampaları */
export const APRON_IN_Y = -8
export const APRON_OUT_Y = 8
export const APRON_SOUTH_Y = -16

const lam = (color: number) => new THREE.MeshLambertMaterial({ color })

function glow(color: number, intensity: number) {
  return new THREE.MeshLambertMaterial({ color, emissive: color, emissiveIntensity: intensity })
}

function box(w: number, d: number, h: number, color: number, x: number, y: number, z: number, parent: THREE.Object3D,
             mat?: THREE.Material) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, d, h), mat ?? lam(color))
  m.position.set(x, y, z)
  m.castShadow = true
  m.receiveShadow = true
  parent.add(m)
  return m
}

function cyl(r: number, len: number, color: number, x: number, y: number, z: number, axis: 'x' | 'y' | 'z', parent: THREE.Object3D) {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, len, 16), lam(color))
  if (axis === 'x') m.rotation.z = Math.PI / 2
  if (axis === 'z') m.rotation.x = Math.PI / 2
  m.position.set(x, y, z)
  m.castShadow = true
  parent.add(m)
  return m
}


/** DENİZ DOKUSU — prosedürel, tileable (kenarları dikişsiz).
 *  Üç katman: derinlik gradyanı + iki farklı periyotta dalga bandı + parıltı benekleri.
 *  Sin/cos dalgaları TAM PERİYOT sayısıyla çizilir, böylece doku tekrarında dikiş olmaz.
 *  Dosya indirmez: oyuncuya ek bayt maliyeti yok. */
function waterTexture(px = 512, deep = '#12566e', shallow = '#2b8fa8'): THREE.CanvasTexture {
  const c = document.createElement('canvas')
  c.width = c.height = px
  const ctx = c.getContext('2d')!
  // 1) taban: derinden sığa dikey geçiş
  const g = ctx.createLinearGradient(0, 0, 0, px)
  g.addColorStop(0, deep); g.addColorStop(0.5, shallow); g.addColorStop(1, deep)
  ctx.fillStyle = g; ctx.fillRect(0, 0, px, px)
  // 2) dalga bantları — iki farklı frekans, tam periyot (dikişsiz tekrar)
  for (const [freq, amp, alpha, w] of [[3, 9, 0.16, 2.5], [7, 5, 0.10, 1.4]] as [number, number, number, number][]) {
    ctx.globalAlpha = alpha; ctx.strokeStyle = '#bfeaf5'; ctx.lineWidth = w
    for (let row = 0; row < 14; row++) {
      const y0 = (row / 14) * px
      ctx.beginPath()
      for (let x = 0; x <= px; x += 4) {
        const y = y0 + Math.sin((x / px) * Math.PI * 2 * freq + row * 1.7) * amp
        x === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)
      }
      ctx.stroke()
    }
  }
  // 3) parıltı benekleri — determinist (her açılışta aynı deniz)
  ctx.globalAlpha = 1
  for (let i = 0; i < 220; i++) {
    const r = (Math.sin(i * 12.9898) * 43758.5453) % 1
    const r2 = (Math.sin(i * 78.233) * 43758.5453) % 1
    const x = Math.abs(r) * px, y = Math.abs(r2) * px
    ctx.fillStyle = `rgba(255,255,255,${0.05 + Math.abs(r) * 0.09})`
    ctx.beginPath(); ctx.arc(x, y, 0.8 + Math.abs(r2) * 1.6, 0, Math.PI * 2); ctx.fill()
  }
  const tex = new THREE.CanvasTexture(c)
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping
  tex.colorSpace = THREE.SRGBColorSpace
  return tex
}

/** dir yönüne bakan (varsayılan +x), canvas'a çizilmiş pano */
function canvasPanel(w: number, h: number, px: number, py: number,
                     draw: (ctx: CanvasRenderingContext2D, W: number, H: number) => void,
                     dir?: THREE.Vector3): THREE.Mesh {
  const c = document.createElement('canvas')
  c.width = px; c.height = py
  draw(c.getContext('2d')!, px, py)
  const tex = new THREE.CanvasTexture(c)
  tex.colorSpace = THREE.SRGBColorSpace
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshLambertMaterial({ map: tex, transparent: true }))
  m.lookAt(dir ?? new THREE.Vector3(1, 0, 0))
  return m
}

/** koyu pill üstüne beyaz yazı — bina isim etiketi */
function labelSprite(text: string): THREE.Sprite {
  const c = document.createElement('canvas')
  c.width = 384; c.height = 96
  const ctx = c.getContext('2d')!
  let fs = 44
  ctx.font = `800 ${fs}px -apple-system, sans-serif`
  while (fs > 22 && ctx.measureText(text).width > 330) {
    fs -= 2
    ctx.font = `800 ${fs}px -apple-system, sans-serif`
  }
  const w = ctx.measureText(text).width + 56
  const x0 = (384 - w) / 2
  ctx.fillStyle = 'rgba(13, 18, 26, 0.88)'
  ctx.beginPath(); ctx.roundRect(x0, 14, w, 68, 34); ctx.fill()
  ctx.strokeStyle = 'rgba(255,255,255,0.16)'; ctx.lineWidth = 3; ctx.stroke()
  ctx.fillStyle = '#eef3f9'
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
  ctx.fillText(text, 192, 50)
  const tex = new THREE.CanvasTexture(c)
  tex.colorSpace = THREE.SRGBColorSpace
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, color: 0xdedede }))
  sp.scale.set(2.5, 0.62, 1)
  return sp
}

/** sarı para rozeti — tıklanınca kasaya toplanır */
function cashSprite(text: string, id: string): THREE.Sprite {
  const c = document.createElement('canvas')
  c.width = 320; c.height = 104
  const ctx = c.getContext('2d')!
  ctx.font = '800 52px -apple-system, sans-serif'
  const w = ctx.measureText(text).width + 92
  const x0 = (320 - w) / 2
  ctx.fillStyle = '#e8b62e'
  ctx.beginPath(); ctx.roundRect(x0, 10, w, 84, 42); ctx.fill()
  ctx.strokeStyle = '#a8791a'; ctx.lineWidth = 6; ctx.stroke()
  // jeton
  ctx.fillStyle = '#f7dd8a'
  ctx.beginPath(); ctx.arc(x0 + 42, 52, 26, 0, 7); ctx.fill()
  ctx.strokeStyle = '#a8791a'; ctx.lineWidth = 5; ctx.stroke()
  ctx.fillStyle = '#7a5510'
  ctx.font = '800 34px -apple-system, sans-serif'
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
  ctx.fillText('₺', x0 + 42, 54)
  ctx.fillStyle = '#3a2c05'
  ctx.font = '800 52px -apple-system, sans-serif'
  ctx.textAlign = 'left'
  ctx.fillText(text, x0 + 76, 55)
  const tex = new THREE.CanvasTexture(c)
  tex.colorSpace = THREE.SRGBColorSpace
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, color: 0xe2e2e2 }))
  sp.scale.set(2.3, 0.75, 1)
  sp.userData.cashFor = id
  return sp
}

/** kırmızı uyarı pill'i — tıklanınca tamir/bakım yapılır */
function warnSprite(text: string, maintId: string): THREE.Sprite {
  const c = document.createElement('canvas')
  c.width = 448; c.height = 104
  const ctx = c.getContext('2d')!
  let fs = 46
  ctx.font = `800 ${fs}px -apple-system, sans-serif`
  while (fs > 24 && ctx.measureText(text).width > 380) {
    fs -= 2
    ctx.font = `800 ${fs}px -apple-system, sans-serif`
  }
  const w = ctx.measureText(text).width + 60
  const x0 = (448 - w) / 2
  ctx.fillStyle = '#e5484d'
  ctx.beginPath(); ctx.roundRect(x0, 12, w, 80, 40); ctx.fill()
  ctx.fillStyle = '#fff'
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
  ctx.fillText(text, 224, 54)
  const tex = new THREE.CanvasTexture(c)
  tex.colorSpace = THREE.SRGBColorSpace
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, color: 0xe2e2e2 }))
  sp.scale.set(3.1, 0.72, 1)
  sp.userData.warnFor = maintId
  return sp
}

/** hafif benekli zemin dokusu (AI dokusu yüklenemezse yedek) */
function noiseTex(base: string, specks: [string, number][], repeat: number): THREE.Texture {
  const size = 256
  const c = document.createElement('canvas')
  c.width = c.height = size
  const ctx = c.getContext('2d')!
  ctx.fillStyle = base
  ctx.fillRect(0, 0, size, size)
  for (const [color, count] of specks) {
    ctx.fillStyle = color
    for (let i = 0; i < count; i++) {
      ctx.globalAlpha = 0.2 + Math.random() * 0.35
      const r = 0.6 + Math.random() * 1.8
      ctx.fillRect(Math.random() * size, Math.random() * size, r, r)
    }
  }
  ctx.globalAlpha = 1
  const t = new THREE.CanvasTexture(c)
  t.wrapS = t.wrapT = THREE.RepeatWrapping
  t.repeat.set(repeat, repeat)
  t.colorSpace = THREE.SRGBColorSpace
  return t
}

interface NightMat { mat: THREE.MeshLambertMaterial; day: number; night: number; owner: string }

function buildPumpMesh(nightMats: NightMat[]): THREE.Group {
  const g = new THREE.Group()
  box(0.8, 1.15, 0.1, 0x8f979e, 0, 0, 0.05, g)
  box(0.6, 0.95, 1.3, 0xe04848, 0, 0, 0.75, g)
  box(0.64, 0.99, 0.1, 0xc23b3b, 0, 0, 1.45, g)
  box(0.62, 0.97, 0.16, 0xf0f0ec, 0, 0, 0.5, g)
  box(0.05, 0.66, 0.46, 0x1c2530, 0.3, 0, 1.12, g)
  const screen = glow(0xa8dcf0, 0.55)
  box(0.03, 0.54, 0.34, 0xa8dcf0, 0.33, 0, 1.12, g, screen)
  nightMats.push({ mat: screen, day: 0.55, night: 0.95, owner: 'pump' })
  for (const [sy, c] of [[0.52, 0x2fa05a], [-0.52, 0xe8862e]] as const) {
    box(0.34, 0.08, 0.5, 0x2b2f33, 0, sy, 1.0, g)
    box(0.12, 0.1, 0.3, c, 0.12, sy, 1.05, g)
    cyl(0.03, 0.35, 0x23272b, -0.1, sy, 0.8, 'z', g)
  }
  return g
}

function buildTreeProc(x: number, y: number, scale: number, parent: THREE.Object3D) {
  const g = new THREE.Group()
  cyl(0.14, 0.9, 0x7a5738, 0, 0, 0.45, 'z', g)
  const f1 = new THREE.Mesh(new THREE.IcosahedronGeometry(0.85, 1), lam(0x5f9e4e))
  f1.position.z = 1.4; f1.castShadow = true; g.add(f1)
  const f2 = new THREE.Mesh(new THREE.IcosahedronGeometry(0.55, 1), lam(0x6fb35a))
  f2.position.set(0.25, 0.2, 1.95); f2.castShadow = true; g.add(f2)
  g.position.set(x, y, 0)
  g.scale.setScalar(scale)
  parent.add(g)
}

function buildLampProc(x: number, y: number, parent: THREE.Object3D) {
  const g = new THREE.Group()
  cyl(0.06, 3.0, 0x59616b, 0, 0, 1.5, 'z', g)
  box(0.5, 0.14, 0.08, 0x59616b, 0.28, 0, 3.0, g)
  box(0.3, 0.2, 0.1, 0xfff3c4, 0.5, 0, 2.97, g, glow(0xfff3c4, 1.0))
  g.position.set(x, y, 0)
  parent.add(g)
}

function stain(x: number, y: number, r: number, parent: THREE.Object3D) {
  const m = new THREE.Mesh(new THREE.CircleGeometry(r, 18),
    new THREE.MeshLambertMaterial({ color: 0x2b2f33, transparent: true, opacity: 0.16 }))
  m.position.set(x, y, 0.03)
  parent.add(m)
}

export interface Building {
  id: string
  name: string
  group: THREE.Object3D
  label: THREE.Sprite
  warn: THREE.Sprite | null
  warnText: string | null
  cash: THREE.Sprite | null
  cashText: string | null
  labelZ: number
}

export class World {
  scene = new THREE.Scene()
  stationName = t('BENZİNLİK')
  private priceView: [number, number, number, number] = [10, 9, 6, 0]
  buildings: Building[] = []
  private closedFlag = false
  private signLevel = 0
  private signGroup: THREE.Group | null = null
  private lightRedLamp: THREE.Mesh | null = null
  private lightGreenLamp: THREE.Mesh | null = null
  private lightLast: boolean | null = null
  /** trafik ışığı görselini mekanikle senkronla (main her karede çağırır — durum
   *  değişmediyse materyale DOKUNMAZ, gereksiz GPU yazımı olmasın) */
  setTrafficLight(red: boolean) {
    if (this.lightLast === red) return
    this.lightLast = red
    const rm = this.lightRedLamp?.material as THREE.MeshLambertMaterial | undefined
    const gm = this.lightGreenLamp?.material as THREE.MeshLambertMaterial | undefined
    if (rm) { rm.color.setHex(red ? 0xff4d4d : 0x5a1e1e); rm.emissive.setHex(red ? 0x991111 : 0x000000) }
    if (gm) { gm.color.setHex(red ? 0x1e5a2a : 0x4dff7a); gm.emissive.setHex(red ? 0x000000 : 0x119933) }
  }
  /** aktif lokasyon teması — zemin/palet/topoloji tek kaynaktan (çoklu lokasyon temeli) */
  theme: LocationTheme = activeTheme('kasaba')
  private marketGroup: THREE.Group | null = null
  private market2Group: THREE.Group | null = null // karşı yaka marketi
  private toiletGroup: THREE.Group | null = null
  private batteryGroup: THREE.Group | null = null
  private tankGroup: THREE.Group
  private concreteMat: THREE.MeshLambertMaterial
  private nightMats: NightMat[] = []
  private nightLights: THREE.PointLight[] = []
  private steam: { mesh: THREE.Mesh; offset: number; drift: number }[] = []
  private steamT = 0
  private sun: THREE.DirectionalLight
  private hemi: THREE.HemisphereLight
  private grid: THREE.GridHelper
  private batteryPos = new THREE.Vector2(-2.5, 8.2)

  /** Şubeye özgü model kiti (otoyol sanayi, metropol ticari, marina deniz).
   *  null = bu şube ek paket istemiyor ya da indirilemedi → prosedürel sahneye düşülür. */
  constructor(private statics: StaticLib | null, themeId: LocationTheme['id'] = 'kasaba',
              private kit: Kit | null = null) {
    this.theme = activeTheme(themeId) // sahne kurulumu TEMADAN (şube değişince farklı zemin/gök)
    const s = this.scene
    s.background = new THREE.Color(this.theme.sky.day)

    this.hemi = new THREE.HemisphereLight(0xffffff, 0x8899aa, 1.1)
    s.add(this.hemi)
    const sun = new THREE.DirectionalLight(0xfff0d8, 2.2)
    this.sun = sun
    sun.position.set(18, -12, 26)
    sun.castShadow = true
    sun.shadow.mapSize.set(1024, 1024) // performans: geniş harita + yumuşak gölgede 1024 yeterli
    const cam = sun.shadow.camera
    cam.left = -55; cam.right = 55; cam.top = 55; cam.bottom = -55; cam.far = 140
    s.add(sun)

    // yerleştirme modu grid'i (1 birimlik kareler)
    this.grid = new THREE.GridHelper(110, 110, 0xffffff, 0xffffff)
    this.grid.rotation.x = Math.PI / 2
    this.grid.position.z = 0.04
    ;(this.grid.material as THREE.Material).transparent = true
    ;(this.grid.material as THREE.Material).opacity = 0.14
    this.grid.visible = false
    s.add(this.grid)

    // dokulu zeminler: nano banana PNG'leri; yüklenemezse prosedürel benek
    const aiGround = (url: string, rx: number, ry: number, fallback: THREE.Texture) => {
      const mat = new THREE.MeshLambertMaterial({ map: fallback })
      new THREE.TextureLoader().load(url, t => {
        t.wrapS = t.wrapT = THREE.RepeatWrapping
        t.repeat.set(rx, ry)
        t.colorSpace = THREE.SRGBColorSpace
        mat.map = t
        mat.needsUpdate = true
      }, undefined, () => {})
      return mat
    }
    // Zemin/palet TEMADAN okunur (lategame raporu §6.1): yeni lokasyon = yeni tema nesnesi.
    // Kasaba temasının değerleri bugünkü sahneyle BİREBİR — görünür değişiklik yok.
    const th = this.theme
    const grassMat = aiGround(th.ground.grass, 146, 159,
      noiseTex(th.ground.grassTint, [['#79a25e', 900], ['#93bd77', 900], ['#' + th.palette.vegetation.toString(16).padStart(6, '0'), 300]], 30))
    this.concreteMat = aiGround(th.ground.concrete, 2.5, 4.5,
      noiseTex(th.ground.concreteTint, [['#8d949c', 700], ['#a8afb7', 700], ['#7e858d', 200]], 8))
    const roadMat = aiGround(th.ground.road, 1.5, 84,
      noiseTex(th.ground.roadTint, [['#555c66', 800], ['#3f454c', 800], ['#606874', 200]], 6))

    // zemin geniş tutulur: mobilde en fazla uzaklaşıldığında bile kenarı görünüp arka plan (gök) sızmasın
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(2600, 2400), grassMat)
    ground.position.x = 8
    ground.receiveShadow = true
    s.add(ground)

    if (th.lane.barrier) {
      // ---- OTOYOL (rapor §6.4): 2×3 şerit, ORTA BARİYER, ramp şeritleri ----
      // Yol daha geniş: şerit sayısı temadan (count=3) → toplam genişlik ~4.6 * count/1.6
      const extra = new THREE.Mesh(new THREE.PlaneGeometry(3.4, 220), roadMat)
      extra.position.set(ROAD_X - 3.6, 0, 0.009); s.add(extra)   // near yönü ek şeritler
      const extra2 = new THREE.Mesh(new THREE.PlaneGeometry(3.4, 220), roadMat)
      extra2.position.set(ROAD_X + 3.6, 0, 0.009); s.add(extra2) // karşı yön ek şeritler
      // orta bariyer (new-jersey): karşıya geçiş fiziksel olarak YOK
      const barrier = new THREE.Mesh(new THREE.BoxGeometry(0.55, 220, 0.85), lam(0xd6d2c6))
      barrier.position.set(ROAD_X, 0, 0.42); s.add(barrier)
      // YAVAŞLAMA + HIZLANMA şeridi: apron boyunca yola paralel ek asfalt bandı
      const gi = APRON_IN_Y, go = APRON_OUT_Y
      const decel = new THREE.Mesh(new THREE.PlaneGeometry(2.2, th.lane.rampLength), roadMat)
      decel.position.set(ROAD_X - 3.0, gi - th.lane.rampLength / 2 + 2, 0.012); s.add(decel)
      const accel = new THREE.Mesh(new THREE.PlaneGeometry(2.2, th.lane.rampLength + 4), roadMat)
      accel.position.set(ROAD_X - 3.0, go + (th.lane.rampLength + 4) / 2 - 2, 0.012); s.add(accel)
      // ramp kenar çizgileri (kesikli değil: sürekli, çıkış/giriş şeridi işareti)
      for (const [cy, len] of [[gi - th.lane.rampLength / 2 + 2, th.lane.rampLength], [go + (th.lane.rampLength + 4) / 2 - 2, th.lane.rampLength + 4]] as [number, number][]) {
        const line = new THREE.Mesh(new THREE.PlaneGeometry(0.12, len), lam(0xe8e4d8))
        line.position.set(ROAD_X - 4.1, cy, 0.02); s.add(line)
      }
      // yüksek direkli aydınlatma (12 m) — otoyol imzası, instanced
      const poleN = 9
      const poles = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.13, 0.16, 11, 8), lam(0x6a7078), poleN)
      const pm = new THREE.Matrix4()
      for (let i = 0; i < poleN; i++) {
        pm.makeRotationX(Math.PI / 2)
        pm.setPosition(ROAD_X + 5.6, -88 + i * 22, 5.5)
        poles.setMatrixAt(i, pm)
      }
      poles.instanceMatrix.needsUpdate = true; s.add(poles)
      // gürültü bariyeri (karşı yakada duvar)
      const wall = new THREE.Mesh(new THREE.BoxGeometry(0.4, 220, 3.2), lam(0x9aa1a9))
      wall.position.set(ROAD_X + 7.4, 0, 1.6); s.add(wall)
      this.buildIndustrialDistrict(s)
      // uzak dağ silüeti (sanayinin de arkasında, en uzak katman)
      for (let i = 0; i < 5; i++) {
        const mt = new THREE.Mesh(new THREE.ConeGeometry(14 + i * 3, 10 + i * 2, 5), lam(0x8a94a0))
        mt.rotation.x = Math.PI / 2
        mt.position.set(ROAD_X + 78 + i * 7, -70 + i * 34, 5); s.add(mt)
      }
    }

    // ---- MARİNA: DENİZ SAHNESİ ----
    // Kara trafiğinin birebir izomorfu (rapor §6.5.2): şerit → seyir kanalı, kapı →
    // liman ağzı, apron → iç havuz, pompa slotu → yakıt iskelesi, otopark → parmak iskele.
    // Geometri aynı kaldığı için rezervasyon grafiği tek satır değişmeden çalışır.
    if (th.lane.kind === 'water') this.buildMarinaScene(s)

    if (th.features?.urban) {
      // ---- TRAFİK IŞIĞI (mekanik: kırmızıda giriş şansı ×boost) ----
      const tl = th.features.trafficLight
      const ly = tl?.y ?? -19
      const poleX = ROAD_X - 2.6
      cyl(0.11, 5.2, 0x50565e, poleX, ly, 2.6, 'z', s)          // direk
      cyl(0.09, 2.4, 0x50565e, poleX + 1.2, ly, 5.1, 'x', s)     // konsol kol
      const box = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.42, 1.15), lam(0x22262b))
      box.position.set(poleX + 2.3, ly, 4.9); s.add(box)
      // lambalar: referansları saklanır, mekanikle senkron yanar (setTrafficLight)
      const mk = (color: number, dz: number) => {
        const m = new THREE.Mesh(new THREE.SphereGeometry(0.13, 10, 8), new THREE.MeshLambertMaterial({ color, emissive: 0x000000 }))
        m.position.set(poleX + 2.13, ly, 4.9 + dz); s.add(m); return m
      }
      this.lightRedLamp = mk(0x5a1e1e, 0.38)
      this.lightGreenLamp = mk(0x1e5a2a, -0.38)
      // yaya geçidi (zebra) — yaya müşterinin geldiği yer
      for (let i = 0; i < 7; i++) {
        const stripe = new THREE.Mesh(new THREE.PlaneGeometry(0.42, 4.4), lam(0xf0efe8))
        stripe.position.set(ROAD_X - 2.0 + i * 0.62, ly - 3.4, 0.023)
        stripe.rotation.z = Math.PI / 2
        s.add(stripe)
      }
      // ---- KALDIRIM + KENTSEL SİLUET (arka planda blok apartmanlar) ----
      const kerb = new THREE.Mesh(new THREE.PlaneGeometry(1.5, 220), lam(0xc9c5ba))
      kerb.position.set(ROAD_X - 3.1, 0, 0.018); s.add(kerb)
      let seed = 7
      const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff }
      const blockN = 17
      const inst = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), lam(0x8d949c), blockN)
      const m4 = new THREE.Matrix4()
      for (let i = 0; i < blockN; i++) {
        const h = 6 + rnd() * 14, w = 5 + rnd() * 4, d = 7 + rnd() * 3
        m4.makeScale(w, d, h)
        m4.setPosition(ROAD_X + 13 + rnd() * 5, -90 + i * 11, h / 2)
        inst.setMatrixAt(i, m4)
      }
      inst.instanceMatrix.needsUpdate = true
      s.add(inst)
    }

    const lot = new THREE.Mesh(new THREE.PlaneGeometry(11.5, 20), this.concreteMat)
    lot.position.set(-0.75, 0, 0.015)
    lot.receiveShadow = true
    s.add(lot)
    this.paveJoints(-6.5, 5, -10, 10)
    this.kerbs.set('0,1:W', box(0.25, 20.4, 0.16, 0xd8dbde, -6.55, 0, 0.08, s))

    // yol (arada yeşil bant kalır) + şerit çizgileri
    // gidiş-geliş yol: çift sarı orta çizgi + şerit içi beyaz kesikler + kenar çizgileri
    // yol uzatıldı (100→220): zoom-out yapınca yolun bittiği görünmesin
    // 4 ŞERİTLİ YOL: servis şeridi tanımlıysa koridor genişler (x 4.9..10.9).
    // Bir yanda çim bandı, diğer yanda karşı parsel (10.9) sınır — bu 6.0 birim,
    // 0.6 refüjle birlikte yön başına iki adet 1.35'lik şerit demek.
    // SU ŞUBESİ (marina): asfalt/refüj/şerit HİÇ çizilmez — yolun yerini seyir kanalı alır.
    // Bu blok atlanmazsa denizin üstünde asfalt şerit görünüyordu.
    const isWater = th.lane.kind === 'water'
    const roadW = th.lane.service ? 6.0 : 4.6
    if (!isWater) {
      const road = new THREE.Mesh(new THREE.PlaneGeometry(roadW, 220), roadMat)
      road.position.set(ROAD_X, 0, 0.01)
      road.receiveShadow = true
      s.add(road)
    }
    if (th.lane.median && !isWater) {
      // ---- KENTSEL YOL (çevre yolu/metropol): orta REFÜJ + şerit çizgileri (rapor §6.3) ----
      // Refüj: yeşil bant + bordür; karşıya geçiş görsel olarak da ayrılır.
      const medW = th.lane.service ? 0.6 : 0.9
      const median = new THREE.Mesh(new THREE.PlaneGeometry(medW, 220), lam(th.palette.vegetation))
      median.position.set(ROAD_X, 0, 0.022); s.add(median)
      for (const off of [-(medW / 2 + 0.05), medW / 2 + 0.05]) {
        const kerb = new THREE.Mesh(new THREE.PlaneGeometry(0.14, 220), lam(0xd8d4c8))
        kerb.position.set(ROAD_X + off, 0, 0.024); s.add(kerb)
      }
      // Refüj ağaçları + kesikli şerit çizgileri INSTANCED (mobil ısınma şikâyeti %22 —
      // 150+ ayrı mesh yerine 3 draw call). Determinist yerleşim, sahne kalabalıklaşmaz.
      const mkInst = (geo: THREE.BufferGeometry, mat: THREE.Material, n: number, place: (m: THREE.Matrix4, i: number) => void) => {
        const inst = new THREE.InstancedMesh(geo, mat, n)
        const m4 = new THREE.Matrix4()
        for (let i = 0; i < n; i++) { place(m4, i); inst.setMatrixAt(i, m4) }
        inst.instanceMatrix.needsUpdate = true
        s.add(inst)
      }
      const treeN = 17
      mkInst(new THREE.CylinderGeometry(0.09, 0.09, 1.1, 8), lam(0x6b4a2f), treeN, (m, i) => {
        m.makeRotationX(Math.PI / 2); m.setPosition(ROAD_X, -96 + i * 12, 0.55)
      })
      mkInst(new THREE.SphereGeometry(0.62, 8, 6), lam(th.palette.vegetation), treeN, (m, i) => {
        m.makeTranslation(ROAD_X, -96 + i * 12, 1.5)
      })
      // ŞERİT AYIRICI KESİKLER: 4 şeritli yolda her yönün İKİ şeridi arasına, tek
      // şeritlide eski konumlarına. Konum temadan türer, elle sabit yok.
      const dashPerLane = 44
      const dashOff = th.lane.service
        ? [ROAD_X - 2.32, ROAD_X + 2.32]   // 4 şerit: yön başına iki şeridin arası
        : [ROAD_X - 1.15, ROAD_X + 1.15]   // tek şerit (mevcut görünüm)
      mkInst(new THREE.PlaneGeometry(0.08, 2.4), lam(0xe8e4d8), dashPerLane * dashOff.length, (m, i) => {
        const k = i % dashPerLane
        m.makeTranslation(dashOff[Math.floor(i / dashPerLane)], -107 + k * 5, 0.021)
      })
      // ---- METROPOL: TİCARİ DOKU (rapor §6.6) ----
      // Çevre yolu alçak kentsel doku; metropol ticaret merkezi. Kit varsa gerçek
      // binalar, yoksa prosedürel kutu siluete düşülür (oyun her hâlde kurulur).
      if (th.id === 'metropol') this.buildCommercialDistrict(s)
      else if (th.id === 'cevreyolu') this.buildRingRoadDistrict(s)
    } else if (!isWater) {
      for (const off of [-0.1, 0.1]) {
        const center = new THREE.Mesh(new THREE.PlaneGeometry(0.09, 220), lam(0xe0b13e))
        center.position.set(ROAD_X + off, 0, 0.022)
        s.add(center)
      }
    }
    // kenar çizgileri asfalt kenarına oturur (yol genişleyince onlar da kayar)
    const edgeOff = (th.lane.service ? 6.0 : 4.6) / 2 - 0.14
    for (const off of isWater ? [] : [-edgeOff, edgeOff]) {
      const edgeLine = new THREE.Mesh(new THREE.PlaneGeometry(0.11, 220), lam(0xe8e4d8))
      edgeLine.position.set(ROAD_X + off, 0, 0.02)
      s.add(edgeLine)
    }
    // Şerit içi kesikler — YALNIZ refüjsüz (kasaba) yolda. Refüjlü yollar kendi
    // instanced kesiklerini yukarıda çiziyor; ikisi birden çizilirse çizgiler çakışır.
    if (!th.lane.median && !isWater) {
      for (let y = -108; y < 109; y += 5) {
        for (const off of [-1.1, 1.1]) {
          const dash = new THREE.Mesh(new THREE.PlaneGeometry(0.13, 1.5), lam(0xd9d5c9))
          dash.position.set(ROAD_X + off, y, 0.02)
          s.add(dash)
        }
      }
    }


    this.buildOffice()
    this.buildGate('in')
    this.buildGate('out')

    // ana yakıt tankı (küre) + borular
    this.tankGroup = new THREE.Group()
    s.add(this.tankGroup)
    this.buildTankCluster(0)
    this.register('tank', t('YAKIT TANKI'), this.tankGroup, 3.8)

    // çevre
    this.placeTree(-9.5, -13, 1.2)
    this.placeTree(-10.5, 2, 1.0)
    // ---- ÇEVRE SÜSÜ: ağaç / taş / çiçek / lamba ----
    // SU ŞUBESİNDE (marina) HİÇBİRİ ÇİZİLMEZ: bunların x≈12 konumları marinada
    // seyir kanalının içine düşüyordu — denizin ortasında ağaç ve çiçek beliriyordu.
    if (!isWater) {
      this.placeTree(-8.5, 12.5, 1.3)
      this.placeTree(-9, 20, 1.0)
      this.placeTree(12.4, -16, 1.1)
      this.placeTree(12.7, 9, 1.2)
      this.placeTree(12.1, 22, 1.0)
      // lambalar yol-istasyon arasındaki yeşil bantta (araç rotalarının tamamen dışında)
      this.placeLamp(5.45, -5.5)
      this.placeLamp(5.45, 5.5)
      stain(1.9, -1.6, 0.45, s)
      stain(1.5, -3.0, 0.3, s)
      stain(2.2, 2.8, 0.4, s)
      stain(-2.5, 6.5, 0.5, s)

      // çim dokusuna hayat: taşlar ve çiçekler
      const rockGeo = new THREE.IcosahedronGeometry(0.22, 0)
      const rockMat = lam(0x9aa1a9)
      for (const [rx, ry, rs] of [[-8.2, -16.5, 1], [-10.8, 7.6, 1.3], [12.6, -12.2, 0.9], [13.4, 15.8, 1.1],
        [-8.9, 16.8, 0.8], [12.1, 2.3, 1.2], [-11.6, -5.2, 1]] as const) {
        const rock = new THREE.Mesh(rockGeo, rockMat)
        rock.position.set(rx, ry, 0.12 * rs)
        rock.scale.set(rs, rs, rs * 0.6)
        rock.rotation.z = rx * 2.1
        rock.castShadow = true
        s.add(rock)
        this.decor.push({ obj: rock, x: rx, y: ry })
      }
      const flowerColors = [0xe8e6e1, 0xf2c14e, 0xe08bb0]
      for (const [fx, fy] of [[-9.8, -11.4], [-8.4, 14.2], [12.9, -17.6], [11.8, 12.4], [-11.2, 1.2],
        [13.6, 6.7], [-9.1, 22.4], [12.3, 20.2], [-10.4, -20.8]] as const) {
        const fm = lam(flowerColors[Math.floor((fx * fy * 7.13 % 1 + 1) * 3) % 3])
        for (let k = 0; k < 3; k++) {
          const p = new THREE.Mesh(new THREE.SphereGeometry(0.09, 6, 5), fm)
          p.position.set(fx + Math.sin(k * 2.4 + fx) * 0.5, fy + Math.cos(k * 1.9 + fy) * 0.5, 0.09)
          s.add(p)
          this.decor.push({ obj: p, x: p.position.x, y: p.position.y })
        }
      }
    }

    if (!th.features?.urban && !isWater) this.buildCountryside()
    this.setSign(0)
    this.addPump(0)
  }

  /** çevre dolgusu: tarlalar, bağ-bahçe, balyalar, çitler, gölet */
  private buildCountryside() {
    const s = this.scene
    const soil = lam(0x8a6b45)
    const soilDark = lam(0x775a39)
    const crop = lam(0x5f9e4e)
    const vine = lam(0x4a7d3f)

    const field = (cx: number, cy: number, w: number, d: number, planted: boolean) => {
      const base = new THREE.Mesh(new THREE.PlaneGeometry(w, d), soil)
      base.position.set(cx, cy, 0.012)
      base.receiveShadow = true
      s.add(base)
      for (let fy = -d / 2 + 0.8; fy < d / 2 - 0.4; fy += 1.6) {
        const furrow = new THREE.Mesh(new THREE.PlaneGeometry(w - 0.8, 0.55), soilDark)
        furrow.position.set(cx, cy + fy, 0.018)
        s.add(furrow)
        if (planted) {
          for (let fx = -w / 2 + 1.2; fx < w / 2 - 0.8; fx += 1.5) {
            const p = new THREE.Mesh(new THREE.SphereGeometry(0.28, 6, 5), crop)
            p.position.set(cx + fx, cy + fy, 0.24)
            p.scale.z = 0.75
            s.add(p)
          }
        }
      }
      // ahşap çit (yol tarafı hariç çevre)
      const rail = lam(0x8a6a48)
      for (const [rx, ry, rw, rd] of [
        [cx, cy + d / 2, w, 0.14], [cx, cy - d / 2, w, 0.14],
        [cx - w / 2, cy, 0.14, d], [cx + w / 2, cy, 0.14, d],
      ] as const) {
        const m = new THREE.Mesh(new THREE.BoxGeometry(rw, rd, 0.1), rail)
        m.position.set(rx, ry, 0.42)
        s.add(m)
      }
      for (let px = -w / 2; px <= w / 2; px += 3) {
        cyl(0.07, 0.5, 0x77593c, cx + px, cy - d / 2, 0.25, 'z', s)
        cyl(0.07, 0.5, 0x77593c, cx + px, cy + d / 2, 0.25, 'z', s)
      }
    }

    // bağ: sıra sıra asma
    const vineyard = (cx: number, cy: number, rows: number, len: number) => {
      for (let r0 = 0; r0 < rows; r0++) {
        const ry = cy + r0 * 2 - rows
        for (let vx = -len / 2; vx < len / 2; vx += 1.3) {
          const v = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.35, 0.9), vine)
          v.position.set(cx + vx, ry, 0.45)
          v.castShadow = true
          s.add(v)
        }
      }
    }

    // meyve bahçesi
    const orchard = (cx: number, cy: number, cols: number, rows: number) => {
      for (let a = 0; a < cols; a++) for (let b = 0; b < rows; b++) {
        this.placeTree(cx + a * 3.4, cy + b * 3.4, 0.85 + ((a * 7 + b * 3) % 4) * 0.08)
      }
    }

    // saman balyaları
    const bales = (cx: number, cy: number, n: number) => {
      for (let i = 0; i < n; i++) {
        const bale = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.55, 0.9, 12), lam(0xd9b86a))
        bale.rotation.z = Math.PI / 2
        bale.position.set(cx + i * 1.9 + (i % 2) * 0.5, cy + (i % 2) * 1.4, 0.55)
        bale.castShadow = true
        s.add(bale)
      }
    }

    // gölet
    const pond = (cx: number, cy: number, r: number) => {
      const w = new THREE.Mesh(new THREE.CircleGeometry(r, 26), lam(0x5f9fc4))
      w.position.set(cx, cy, 0.014)
      w.scale.y = 0.72
      s.add(w)
      const rim = new THREE.Mesh(new THREE.RingGeometry(r, r + 0.5, 26), lam(0xc9bfa5))
      rim.position.set(cx, cy, 0.013)
      rim.scale.y = 0.72
      s.add(rim)
      for (let i = 0; i < 5; i++) {
        const rock = new THREE.Mesh(new THREE.IcosahedronGeometry(0.3, 0), lam(0x9aa1a9))
        rock.position.set(cx + Math.cos(i * 1.9) * (r + 0.4), cy + Math.sin(i * 1.9) * (r + 0.4) * 0.72, 0.2)
        rock.castShadow = true
        s.add(rock)
      }
    }

    // yerleşim: parseller x -29.5..45.4 / y -24..24, yol x 5.6..10.2 — hepsi dışarıda
    field(-42, 10, 16, 11, true)
    field(-41, -13, 14, 10, false)
    field(57, -4, 15, 12, true)
    field(20, 34, 18, 10, false)
    field(-8, -34, 18, 10, true)
    field(34, -34, 14, 9, false)
    vineyard(-42, 30, 4, 14)
    vineyard(56, 18, 3, 12)
    orchard(48, 28, 3, 3)
    orchard(-52, -30, 4, 2)
    orchard(-56, 16, 2, 4)
    bales(-38, -25.5, 4)
    bales(52, -20, 3)
    pond(-36, -30 + 60, 4) // kuzeybatı gölet (y=30)
    pond(30, -30, 3.2)
  }

  /** oyuncu fiyat değiştirince tabela güncellenir */
  setPrices(benzin: number, dizel: number, lpg: number, elec = 0) {
    this.priceView = [benzin, dizel, lpg, elec]
    this.setSign(this.signLevel)
  }

  /** istasyon kapalı/açık — tabela yeniden çizilir */
  setClosed(v: boolean) {
    this.closedFlag = v
    this.setSign(this.signLevel)
  }

  // ---- kayıt / etiket / uyarı ----

  private register(id: string, name: string, group: THREE.Object3D, labelZ: number) {
    const label = labelSprite(name)
    label.position.z = labelZ
    label.visible = false // isim sadece bina seçilince görünür
    group.add(label)
    group.userData.buildingId = id
    this.buildings.push({ id, name, group, label, warn: null, warnText: null, cash: null, cashText: null, labelZ })
  }

  /** seçili binanın isim etiketini gösterir, diğerlerini gizler */
  setSelected(id: string | null) {
    for (const b of this.buildings) b.label.visible = b.id === id
  }

  /** binaya gece yanan sıcak pencere ışıkları ekler */
  private facadeLights(g: THREE.Object3D, positions: [number, number, number][], w = 0.9, h = 0.55) {
    for (const [x, y, z] of positions) {
      const m = glow(0xffd989, 0.03)
      const p = new THREE.Mesh(new THREE.PlaneGeometry(w, h), m)
      p.lookAt(new THREE.Vector3(1, 0, 0))
      p.position.set(x, y, z)
      g.add(p)
      this.nightMats.push({ mat: m, day: 0.03, night: 1.05, owner: 'bldg' })
    }
  }

  /** 0 = gündüz, 1 = gece — ışıklar geceleri yanar */
  setNight(f: number) {
    this.sun.intensity = 2.2 - 1.55 * f
    this.sun.color.setHex(f > 0.5 ? 0xb8c8ff : 0xfff0d8)
    this.hemi.intensity = 1.1 - 0.5 * f
    const day = new THREE.Color(this.theme.sky.day)   // gökyüzü de temadan (kasaba: aynı renk)
    const night = new THREE.Color(this.theme.sky.night)
    ;(this.scene.background as THREE.Color).copy(day.lerp(night, f))
    for (const n of this.nightMats) {
      n.mat.emissiveIntensity = n.day + (n.night - n.day) * f
    }
    for (const l of this.nightLights) l.intensity = 17 * f
  }

  showGrid(v: boolean) {
    this.grid.visible = v
  }

  /** her kare çağrılır: buhar animasyonu vb. */
  update(dt: number) {
    // MARİNA: deniz katmanları kayar — dokular RepeatWrapping olduğu için sonsuz akar
    for (const l of this.seaLayers) {
      l.tex.offset.x = (l.tex.offset.x + l.sx * dt) % 1
      l.tex.offset.y = (l.tex.offset.y + l.sy * dt) % 1
    }
    if (this.marinaFoam) {
      this.foamT += dt
      ;(this.marinaFoam.material as THREE.MeshBasicMaterial).opacity = 0.30 + 0.14 * Math.sin(this.foamT * 0.9)
    }
    this.steamT += dt
    for (const p of this.steam) {
      const t = (this.steamT * 0.3 + p.offset) % 1
      p.mesh.position.set(p.drift * t, p.drift * t * 0.6, 4.8 + t * 2.4)
      const sc = 0.55 + t * 1.1
      p.mesh.scale.setScalar(sc)
      ;(p.mesh.material as THREE.MeshLambertMaterial).opacity = 0.7 * (1 - t)
    }
  }

  private unregister(id: string) {
    this.buildings = this.buildings.filter(b => b.id !== id)
  }

  /** kumbara rozetleri: id → tutar; tıklanınca toplanır */
  syncCash(list: Map<string, number>) {
    for (const b of this.buildings) {
      // Kumbara TÜR bazlı tek kasadır ('selfwash') ama kopya binalar 'selfwash#1' id'li —
      // BASE id ile eşle: rozet TÜM ünitelerde görünür, HERHANGİ birine tıklamak ortak kasayı
      // toplar. ('3 self yıkamadan 1'i para veriyor' şikayetinin fixi — para hep birikiyordu,
      // sadece ilk ünitede gösteriliyordu.)
      const base = b.id.split('#')[0]
      const amt = list.get(base)
      const text = amt ? `₺${Math.round(amt)}` : null
      if (text && b.cashText !== text) {
        if (b.cash) b.group.remove(b.cash)
        b.cash = cashSprite(text, base)
        b.cash.position.z = b.labelZ + 0.85
        b.group.add(b.cash)
        b.cashText = text
      } else if (!text && b.cash) {
        b.group.remove(b.cash)
        b.cash = null
        b.cashText = null
      }
    }
  }

  /** main her karede çağırır: id → uyarı metni (tıklanınca maintId tetiklenir) */
  syncWarnings(list: Map<string, { text: string; maintId: string }>) {
    for (const b of this.buildings) {
      const want = list.get(b.id)
      if (want && b.warnText !== want.text) {
        if (b.warn) b.group.remove(b.warn)
        b.warn = warnSprite(want.text, want.maintId)
        b.warn.position.z = b.labelZ + 0.8
        b.group.add(b.warn)
        b.warnText = want.text
      } else if (!want && b.warn) {
        b.group.remove(b.warn)
        b.warn = null
        b.warnText = null
      }
    }
  }

  private makeApron(y: number, x = 5.5) {
    const apron = new THREE.Mesh(new THREE.PlaneGeometry(1.3, this.wideGates ? 6.2 : 3.4), this.concreteMat)
    apron.position.set(x, y, 0.014)
    apron.receiveShadow = true
    this.scene.add(apron)
    return apron
  }

  /** yol kenarı bordürü + rampalar: kapılar nereye taşınırsa boşluk oraya gelir */
  private roadEdgeMeshes: THREE.Object3D[] = []
  private buildRoadEdge() {
    for (const o of this.roadEdgeMeshes) this.scene.remove(o)
    this.roadEdgeMeshes = []
    // bordür kaplanan cepheler: istasyon şeridi + betonlanmış kuzey/güney parseller
    const ranges: [number, number][] = [[-10, 10]]
    if (this.isPavedFn(0, 0)) ranges.push([-24, -10])
    if (this.isPavedFn(0, 2)) ranges.push([10, 24])
    const gapHalf = this.wideGates ? 3.2 : 1.75
    const gaps = [this.gateIn.y, this.gateOut.y]
      .map(y => [y - gapHalf, y + gapHalf] as [number, number])
      .sort((a, b) => a[0] - b[0])
    for (const [ra, rb] of ranges) {
      const segs: [number, number][] = []
      let cursor = ra
      for (const [g0, g1] of gaps) {
        if (g1 < ra || g0 > rb) continue
        if (g0 > cursor) segs.push([cursor, Math.min(g0, rb)])
        cursor = Math.max(cursor, g1)
      }
      if (cursor < rb) segs.push([cursor, rb])
      for (const [a, b] of segs) {
        if (b - a < 0.3) continue
        this.roadEdgeMeshes.push(box(0.18, b - a, 0.14, 0xd8dbde, 5.02, (a + b) / 2, 0.07, this.scene))
      }
    }
    this.roadEdgeMeshes.push(this.makeApron(this.gateIn.y))
    this.roadEdgeMeshes.push(this.makeApron(this.gateOut.y))
    // karşı istasyon rampaları (yol karşısı, x≈10.3 = 5.5'in ROAD_X aynası)
    if (this.farStationOn) {
      this.roadEdgeMeshes.push(this.makeApron(this.gateIn2.y, 10.3))
      this.roadEdgeMeshes.push(this.makeApron(this.gateOut2.y, 10.3))
    }
  }

  /** Saydam küre tank + içeride yakıt seviyesi (kırpma düzlemiyle alttan dolar). Dönen mesh = iç sıvı.
   *  KONUM/BOYUT (x,y yarıçap R) CANLI/main ile BİREBİR → footprint aynı, komşu binalarla çakışmaz. */
  private addSphereTank(x: number, y: number, R: number, color: number): THREE.Mesh {
    const g = new THREE.Group()
    const centerZ = R + 0.55           // küre merkezi main ile aynı yükseklikte
    const fillR = R * 0.9
    const shell = new THREE.Mesh(new THREE.SphereGeometry(R, 24, 18),
      new THREE.MeshLambertMaterial({ color, transparent: true, opacity: 0.42, depthWrite: false }))
    shell.position.z = centerZ
    shell.castShadow = true
    g.add(shell)
    // iç sıvı: yatay düzlemle kırpılır → alttan yukarı dolar (%50 = yarım küre)
    const plane = new THREE.Plane(new THREE.Vector3(0, 0, -1), centerZ - fillR)
    const fillMat = lam(color)
    fillMat.clippingPlanes = [plane]
    fillMat.clipShadows = true
    const fill = new THREE.Mesh(new THREE.SphereGeometry(fillR, 24, 18), fillMat)
    fill.position.z = centerZ
    fill.castShadow = true
    g.add(fill)
    const cap = new THREE.Mesh(new THREE.CircleGeometry(1, 28),
      new THREE.MeshLambertMaterial({ color, side: THREE.DoubleSide }))
    cap.position.z = centerZ - fillR
    cap.visible = false
    g.add(cap)
    fill.userData = { plane, cap, fillR, centerZ }
    // ayaklar/valf — main ile aynı yerleşim (footprint korunur)
    for (const [lx, ly] of [[0.6, 0.6], [0.6, -0.6], [-0.6, 0.6], [-0.6, -0.6]] as const) {
      cyl(0.09, R + 0.35, 0x8f979e, lx * (R / 1.15), ly * (R / 1.15), (R + 0.35) / 2, 'z', g)
    }
    cyl(0.05, 0.45, 0x8f979e, 0, 0, R * 2 + 0.6, 'z', g)
    g.position.set(x, y, 0)
    this.tankGroup.add(g)
    return fill
  }

  /** KONUMLAR CANLI/main ile BİREBİR (spots, level+1 küre, R) → footprint aynı, eski save'lerle çakışmaz.
   *  Görsel: saydam + içeride yakıt seviyesi. Küreler yakıtlara eşlenir (benzin/dizel/lpg döngüsel). */
  buildTankCluster(level: number) {
    this.tankLevelNow = level
    this.tankFillMeshes = { benzin: [], dizel: [], lpg: [] }
    for (const ch of [...this.tankGroup.children]) {
      if (!(ch as THREE.Sprite).isSprite) this.tankGroup.remove(ch)
    }
    this.tankGroup.position.set(this.tankAnchor.x, this.tankAnchor.y, 0)
    const R = 0.4 + level * 0.04
    const colors: Record<FuelType, number> = { benzin: 0x27a05a, dizel: 0xe8862e, lpg: 0x2f6fed }
    // 3 yakıt HER ZAMAN görünür (benzin/dizel/lpg) — üçgen dizilim, her biri kendi doluluk seviyesini gösterir.
    // Konumlar [0..0.9] aralığında kaldığı için footprint (4 hücre) + taşıma çapası (moveTank) BİREBİR korunur.
    const layout: [FuelType, number, number][] = [
      ['dizel', 0, 0.9],     // arka-sol
      ['lpg', 0.9, 0.9],     // arka-sağ
      ['benzin', 0.45, 0],   // ön-orta
    ]
    for (const [f, x, y] of layout) {
      const fill = this.addSphereTank(x, y, R, colors[f])
      this.tankFillMeshes[f].push(fill)
    }
  }

  /** Her yakıtın doluluk oranıyla (0..1) sıvı seviyesini alttan yukarı ayarlar. */
  updateTankFill(ratios: Record<FuelType, number>) {
    for (const f of ['benzin', 'dizel', 'lpg'] as FuelType[]) {
      const r = Math.max(0, Math.min(1, ratios[f] || 0))
      for (const m of this.tankFillMeshes[f]) {
        const ud = m.userData as { plane: THREE.Plane; cap: THREE.Mesh; fillR: number; centerZ: number }
        if (!ud?.plane) continue
        const surfaceZ = ud.centerZ + ud.fillR * (2 * r - 1)
        ud.plane.constant = surfaceZ
        m.visible = r > 0.001
        const crossR = ud.fillR * Math.sqrt(Math.max(0, 1 - (2 * r - 1) ** 2))
        ud.cap.visible = r > 0.02 && r < 0.99
        ud.cap.position.z = surfaceZ
        ud.cap.scale.setScalar(Math.max(0.0001, crossR))
      }
    }
  }

  /** tank kümesini taşı (merkezden çapaya çevirir) */
  moveTank(center: THREE.Vector2) {
    this.tankAnchor.set(center.x - 0.45, center.y - 0.45)
    this.buildTankCluster(this.tankLevelNow)
  }

  private placeTree(x: number, y: number, scale: number) {
    const proto = scale >= 1.1 ? this.statics?.treeLarge : (this.statics?.treeSmall ?? this.statics?.treeLarge)
    if (proto) {
      const t = fitModel(proto, 1.6 * scale, 'z')
      t.position.set(x, y, 0)
      t.rotation.z = ((x * 7.3 + y * 3.1) % (Math.PI * 2))
      t.traverse(m => { m.castShadow = true })
      this.scene.add(t)
      this.decor.push({ obj: t, x, y })
    } else {
      const g = new THREE.Group()
      buildTreeProc(0, 0, scale, g)
      g.position.set(x, y, 0)
      this.scene.add(g)
      this.decor.push({ obj: g, x, y })
    }
  }

  // sokak lambaları izlenir → kapı (giriş/çıkış) üzerine gelince kaldırılabilir
  private lamps: { x: number; y: number; group: THREE.Group; bulbMat: THREE.Material; light: THREE.PointLight }[] = []
  private placeLamp(x: number, y: number) {
    const lg = new THREE.Group()
    if (this.statics?.lamp) {
      const l = fitModel(this.statics.lamp, 3.4, 'z')
      l.position.set(x, y, 0)
      l.rotation.z = Math.PI
      l.traverse(m => { m.castShadow = true })
      lg.add(l)
    } else {
      buildLampProc(x, y, lg)
    }
    // gece yanan ampul + gerçek ışık kaynağı
    const bulbMat = glow(0xfff3c4, 0.05)
    const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.12, 10, 8), bulbMat)
    bulb.position.set(x + 0.6, y, 3.0)
    lg.add(bulb)
    this.nightMats.push({ mat: bulbMat, day: 0.05, night: 1.3, owner: 'lamp' })
    const light = new THREE.PointLight(0xffd9a0, 0, 18, 1.7)
    light.position.set(x + 0.6, y, 3.2)
    lg.add(light)
    this.nightLights.push(light)
    this.scene.add(lg)
    this.lamps.push({ x, y, group: lg, bulbMat, light })
  }

  /** kapı yerleştirilen y'ye yakın sokak lambasını kaldır (giriş/çıkış üstünde lamba kalmasın) */
  removeLampNear(y: number, dy = 2.6) {
    this.lamps = this.lamps.filter(l => {
      if (Math.abs(l.y - y) > dy) return true
      this.scene.remove(l.group)
      this.nightMats = this.nightMats.filter(m => m.mat !== l.bulbMat)
      this.nightLights = this.nightLights.filter(li => li !== l.light)
      return false
    })
  }


  /** OTOYOL ÇEVRESİ — SANAYİ BÖLGESİ (Kenney city-kit-industrial)
   *
   *  Otoyol dinlenme tesisinin çevresi boş çayır değil, organize sanayi olmalı: depolar,
   *  bacalar, tanklar. Yerleşim DETERMİNİST (rastgele değil) — sahne her açılışta aynı
   *  görünür, oyuncu "burası benim otoyolum" diye tanır.
   *
   *  Kit yoksa (indirilemedi/eski istemci) blok sessizce atlanır: sahne prosedürel
   *  hâliyle kurulur, oyun durmaz.
   */

  /** MARİNA SAHNESİ — ada üstünde istasyon, çevresi açık deniz.
   *
   *  Su iki katmanlı: taban doku yavaş, üst katman ters yönde ve daha hızlı kayar.
   *  İkisinin girişimi tek dokuyla elde edilemeyen "canlı deniz" hissini verir; ikisi de
   *  aynı prosedürel dokuyu kullandığı için ek indirme yok.
   */
  /** MARİNA — ADA ÜSTÜNDE İSTASYON, ÇEVRESİ AÇIK DENİZ
   *
   *  Kullanıcının şartı: "denizin ortasında bir benzin istasyonundasın, adanın kenarına
   *  kurulu, sana yanaşan tekneler geliyor". Araba YOK (cars.ts waterOnly).
   *
   *  ADA GEOMETRİSİ determinist: yuvarlatılmış dikdörtgen + dışa dalgalanma. DOĞU YÜZÜ
   *  BİLEREK DÜZ (x=5.30) — orası mühendislik ürünü rıhtım, organik kıyı değil.
   *  Ada tamamen çekirdek bantta: x -21.8..5.3, y -26.1..26.1. Ada yüzeyi z=0'da kalır;
   *  yükseltilseydi tüm bina/tekne yerleşimi bozulurdu.
   */
  private buildMarinaScene(s: THREE.Scene) {
    const K = this.kit
    const lam2 = (c: number) => new THREE.MeshLambertMaterial({ color: c })

    // ---- 1) DENİZ: iki kayan katman (prosedürel doku, ek indirme yok) ----
    const texA = waterTexture(512, '#0f4a60', '#2b8fa8')
    const texB = waterTexture(512, '#12566e', '#3aa3bd')
    texA.repeat.set(9, 9); texB.repeat.set(5, 5)
    const seaA = new THREE.Mesh(new THREE.PlaneGeometry(300, 300), new THREE.MeshLambertMaterial({ map: texA }))
    seaA.position.set(4, 0, 0.002); s.add(seaA)
    const seaB = new THREE.Mesh(new THREE.PlaneGeometry(300, 300),
      new THREE.MeshBasicMaterial({ map: texB, transparent: true, opacity: 0.34, depthWrite: false }))
    seaB.position.set(4, 0, 0.004); s.add(seaB)
    this.seaLayers = [{ tex: texA, sx: 0.010, sy: 0.006 }, { tex: texB, sx: -0.017, sy: 0.011 }]

    // ---- 2) ADA: katmanlı, doğu yüzü düz rıhtım ----
    const X0 = -20.60, X1 = 5.30, Y0 = -24.90, Y1 = 24.90, RW = 3.6, RE = 0.4
    const islePoly = (off: number): THREE.Vector2[] => {
      const pts: THREE.Vector2[] = []
      const N = 72
      for (let i = 0; i < N; i++) {
        const t = (i / N) * Math.PI * 2
        // yuvarlatılmış dikdörtgen (süper-elips benzeri) parametrik kenar
        const cx = (X0 + X1) / 2, cy = (Y0 + Y1) / 2
        const hx = (X1 - X0) / 2, hy = (Y1 - Y0) / 2
        const c = Math.cos(t), sn = Math.sin(t)
        const k = 4 // köşe yuvarlaklığı
        const px = cx + hx * Math.sign(c) * Math.pow(Math.abs(c), 2 / k)
        const py = cy + hy * Math.sign(sn) * Math.pow(Math.abs(sn), 2 / k)
        // dışa determinist dalgalanma — DOĞU segmentinde sıfır (düz rıhtım)
        const east = px > X1 - 1.5
        const w = east ? 0
          : Math.max(0, 1.20 * (0.5 + 0.5 * Math.sin(3 * t + 1.1)) * (0.55 + 0.45 * Math.sin(7 * t + 2.4)))
        const nx = (px - cx) / hx, ny = (py - cy) / hy
        const nl = Math.hypot(nx, ny) || 1
        let X = px + (nx / nl) * (w + off), Y = py + (ny / nl) * (w + off)
        if (X > X1) X = X1                       // doğu yüzü asla taşmaz
        pts.push(new THREE.Vector2(X, Y))
      }
      return pts
    }
    const layer = (off: number, color: number, z: number, opacity = 1) => {
      const shape = new THREE.Shape(islePoly(off))
      const mat = opacity < 1
        ? new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false })
        : lam2(color)
      const m = new THREE.Mesh(new THREE.ShapeGeometry(shape), mat)
      m.position.z = z
      m.receiveShadow = opacity >= 1
      s.add(m)
      return m
    }
    layer(3.6, 0x5fb9cf, 0.006, 0.50)            // sığlık
    const foam = layer(1.9, 0xffffff, 0.008, 0.42) // köpük halkası (nefes alır)
    this.marinaFoam = foam
    layer(1.2, 0xd9c9a2, 0.010)                  // kum
    layer(0.35, 0x8e8878, 0.012)                 // kaya kuşağı
    layer(0, 0x7fa85f, 0.014)                    // ada yüzeyi (istasyon burada)

    // ---- 3) RIHTIM ve YAKIT GÜVERTESİ ----
    const dock = new THREE.Mesh(new THREE.BoxGeometry(2.20, 38, 0.22), lam2(0xa8875c))
    dock.position.set(4.20, 0, 0.14); dock.castShadow = true; s.add(dock)

    const inst = (geo: THREE.BufferGeometry, mat: THREE.Material, n: number,
                  place: (m: THREE.Matrix4, i: number) => void) => {
      const im = new THREE.InstancedMesh(geo, mat, n)
      const m4 = new THREE.Matrix4()
      for (let i = 0; i < n; i++) { place(m4, i); im.setMatrixAt(i, m4) }
      im.instanceMatrix.needsUpdate = true
      im.castShadow = true
      s.add(im)
    }
    // baba (bollard) dizisi — rıhtım boyunca
    inst(new THREE.CylinderGeometry(0.13, 0.16, 0.5, 6), lam2(0x3c4046), 20, (m, i) => {
      m.makeRotationX(Math.PI / 2); m.setPosition(5.05, -19 + i * 2, 0.25)
    })

    // ---- 4) SEYİR KANALI ŞAMANDIRALARI: kırmızı iskele (10.40) / yeşil sancak (17.20) ----
    const buoyAt = (name: string, x: number, ys: number[], fallback: number) => {
      const proto = K?.[name]
      for (const y of ys) {
        if (proto) { const g = fitModel(proto, 1.4, 'z'); g.position.set(x, y, 0); s.add(g) }
        else {
          const c = new THREE.Mesh(new THREE.ConeGeometry(0.34, 1.2, 7), lam2(fallback))
          c.rotation.x = -Math.PI / 2; c.position.set(x, y, 0.6); s.add(c)
        }
      }
    }
    const ys = [-22, -14, -6, 2, 10, 18]
    buoyAt('buoy', 10.40, ys, 0xd44b4b)
    buoyAt('buoy-flag', 17.20, ys.map(y => y + 4), 0x3fae5f)

    // ---- 5) MİSAFİR PONTONLARI + ANA PONTON + DALGAKIRAN ----
    inst(new THREE.BoxGeometry(5.6, 1.1, 0.26), lam2(0xa8875c), 5,
      (m, i) => m.setPosition(19.8, -16 + i * 8, 0.13))
    const main = new THREE.Mesh(new THREE.BoxGeometry(1.20, 40, 0.30), lam2(0x9b7f56))
    main.position.set(23.20, 0, 0.15); main.castShadow = true; s.add(main)
    const mole = new THREE.Mesh(new THREE.BoxGeometry(1.80, 44, 1.60), lam2(0x8d8577))
    mole.position.set(25.60, 0, 0.80); mole.castShadow = true; s.add(mole)
    for (const [my, col] of [[-22.5, 0xd44b4b], [22.5, 0x3fae5f]] as [number, number][]) {
      const l = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.36, 2.2, 8), lam2(col))
      l.rotation.x = Math.PI / 2; l.position.set(25.60, my, 2.4); s.add(l)
    }

    // ---- 6) LİMAN DOKUSU: bağlı tekneler, römorkör, konteyner, rampa ----
    const place = (name: string, len: number, x: number, y: number, rot = 0, axis: 'x' | 'y' | 'z' = 'x') => {
      const proto = K?.[name]
      if (!proto) return
      const g = fitModel(proto, len, axis)
      g.position.set(x, y, 0); g.rotation.z = rot
      s.add(g)
    }
    place('boat-tug-a', 3.6, 20.6, -20.0, Math.PI / 2)     // römorkör, pontona bağlı
    place('boat-row-large', 2.2, 20.2, -12.2, Math.PI / 2)
    place('boat-row-large', 2.0, 20.2, 4.2, Math.PI / 2)
    place('ramp', 2.4, 6.6, -21.5, 0, 'y')                 // denize indirme rampası
    for (const [n, x, y] of [['cargo-container-a', 1.2, -19.4], ['cargo-container-b', 1.2, -17.0],
                             ['cargo-pile-a', -1.6, -18.6]] as [string, number, number][])
      place(n, 2.6, x, y, 0, 'y')
    // arka planda geçen kargo gemisi — ölçek hissi (bant kenarı, bilerek)
    place('ship-cargo-b', 13, 34, -30, Math.PI)

    // ---- 7) DOĞAL KIYI: satın alınamayan şeritte çam ve kaya (ada kenarını yumuşatır) ----
    inst(new THREE.ConeGeometry(0.9, 2.6, 6), lam2(0x4f7f52), 9, (m, i) => {
      m.makeRotationX(-Math.PI / 2)
      const t = i / 9 * Math.PI * 2
      m.setPosition(-19.4 + Math.sin(t * 1.7) * 1.4, -22 + i * 5.4, 1.3)
    })
    inst(new THREE.IcosahedronGeometry(0.5, 0), lam2(0x8e8878), 12, (m, i) => {
      const t = i / 12 * Math.PI * 2
      m.setPosition(-20.2 + Math.cos(t * 2.3) * 1.6, -25 + i * 4.3, 0.25)
    })
  }

  private buildIndustrialDistrict(s: THREE.Scene) {
    const K = this.kit
    const lam2 = (c: number) => new THREE.MeshLambertMaterial({ color: c })
    const put = (name: string, h: number, x: number, y: number, rot = 0) => {
      const proto = K?.[name]
      if (!proto) return false
      const g = fitModel(proto, h, 'z')
      g.position.set(x, y, 0)
      g.rotation.z = rot
      s.add(g)
      return true
    }
    // ---- Doğu: sanayi sitesi (gürültü bariyerinin ardı) ----
    put('building-q', 4.5, 22.60, -20.60)        // güney çapası, en geniş hangar
    put('building-s', 4.0, 19.50, -9.60)         // yola paralel uzun-alçak depo: sanayinin yol cephesi
    put('chimney-large', 5.5, 18.80, -2.60)      // dikey silo
    put('chimney-large', 5.5, 18.80, 0.90)       // ikiz silo → tank çiftliği okur
    put('detail-tank', 2.2, 23.20, -3.60)        // yatık LPG tankı (araba boyunda detay)
    put('building-l', 7.0, 24.00, 3.00)          // KAHRAMAN fabrika, istasyonun tam karşısı
    put('chimney-medium', 13, 26.00, 9.00)       // sanayi imzası; y=+9 TAVAN (üstü istasyonu keser)
    // ---- Batı: TIR garajı ve lojistik (ekranda istasyonun arkası) ----
    put('building-s', 4.0, -12.90, -24.00, Math.PI / 2)
    put('building-t', 4.5, -23.50, -21.00)
    put('building-f', 9.0, -24.00, -7.00)        // batı ufkunun tek yüksek kütlesi
    put('chimney-medium', 10, -20.00, -14.50)
    // ---- Arka plan (yalnız uzaklaşınca görünür, sert tavan x ≤ 42) ----
    put('chimney-medium', 15, 31.00, -16.00)
    put('chimney-medium', 13, 33.00, 9.00)
    put('building-c', 7.0, 33.50, -6.50)
    put('chimney-medium', 11, 32.00, 16.00)

    // ---- TIR PARKI: InstancedMesh (GLB kopyalamak 20 draw call olurdu, bu 3) ----
    const inst = (geo: THREE.BufferGeometry, mat: THREE.Material, n: number,
                  place: (m: THREE.Matrix4, i: number) => void, colors?: number[]) => {
      const im = new THREE.InstancedMesh(geo, mat, n)
      const m4 = new THREE.Matrix4()
      for (let i = 0; i < n; i++) {
        place(m4, i); im.setMatrixAt(i, m4)
        if (colors) im.setColorAt(i, new THREE.Color(colors[i % colors.length]))
      }
      im.instanceMatrix.needsUpdate = true
      if (im.instanceColor) im.instanceColor.needsUpdate = true
      im.castShadow = true
      s.add(im)
    }
    const TRUCK_Y = [-20.4, -17.9, -15.4, -12.9]
    const PALET = [0xe8e4d8, 0xd6d2c6, 0xc46a3a, 0x4d6fa3]
    inst(new THREE.BoxGeometry(5.60, 2.10, 2.35), lam2(0xffffff), 4,
      (m, i) => m.setPosition(-14.80, TRUCK_Y[i], 1.35), PALET)
    inst(new THREE.BoxGeometry(2.30, 2.05, 2.60), lam2(0xffffff), 4,
      (m, i) => m.setPosition(-10.55, TRUCK_Y[i], 1.30), PALET)
    inst(new THREE.CylinderGeometry(0.42, 0.42, 0.30, 8), lam2(0x22262a), 24, (m, i) => {
      const t = Math.floor(i / 6), k = i % 6
      m.makeRotationX(Math.PI / 2)
      m.setPosition(-17.2 + (k % 3) * 2.6 + (k < 3 ? 0 : 6.4), TRUCK_Y[t] + (k < 3 ? -0.95 : 0.95), 0.42)
    })
    inst(new THREE.PlaneGeometry(8.60, 0.14), lam2(0xe8e4d8), 5,
      (m, i) => m.setPosition(-13.5, -21.65 + i * 2.5, 0.02))

    // ---- Yol imzası: direkler, bariyer, korkuluk, çit, çalı (hepsi instanced) ----
    inst(new THREE.CylinderGeometry(0.13, 0.16, 11, 8), lam2(0x6a7078), 9, (m, i) => {
      m.makeRotationX(Math.PI / 2); m.setPosition(13.90, -52 + i * 13, 5.5)
    })
    inst(new THREE.BoxGeometry(1.60, 0.35, 0.22), lam2(0x8d949c), 9,
      (m, i) => m.setPosition(12.90, -52 + i * 13, 10.60))
    inst(new THREE.BoxGeometry(0.55, 0.30, 3.80), lam2(0x9aa1a9), 16,
      (m, i) => m.setPosition(15.80, -30 + i * 4, 1.90))
    inst(new THREE.BoxGeometry(0.12, 0.12, 0.75), lam2(0xb9bec4), 24,
      (m, i) => m.setPosition(13.40, -46 + i * 4, 0.38))
    inst(new THREE.CylinderGeometry(0.05, 0.05, 0.90, 5), lam2(0xe8e4d8), 24, (m, i) => {
      m.makeRotationX(Math.PI / 2); m.setPosition(3.75, -28 + i * 2.4, 0.45)
    })
    inst(new THREE.CylinderGeometry(0.08, 0.08, 2.20, 6), lam2(0x8d949c), 17, (m, i) => {
      m.makeRotationX(Math.PI / 2); m.setPosition(16.80, -28 + i * 3.5, 1.10)
    })
    inst(new THREE.ConeGeometry(0.50, 1.10, 5), lam2(this.theme.palette.vegetation), 20, (m, i) => {
      m.makeRotationX(-Math.PI / 2); m.setPosition(16.30, -28 + i * 2.95, 0.55)
    })
  }

  /** METROPOL — TİCARİ DOKU (Kenney city-kit-commercial)
   *
   *  Yerleşim kamera bandına göre: batı duvarı YÜKSEK (x -7.8 cephe hattı), doğu duvarı
   *  bilinçli ALÇAK (H ≤ 7). Sebep üslup değil gölge: doğuya konan yüksek bina karşı
   *  istasyonun üstüne y-2H uzunluğunda gölge atıyor; H=7'de gölge parselin doğu ucunda
   *  kalıyor, H=14 olsaydı karşı istasyonu tamamen yutardı.
   *
   *  Kuzeye gittikçe yükselme de zorunluluk: yükseklik bütçesi Hmax ≈ 14.2 + 0.20x + 0.40y.
   */
  private buildCommercialDistrict(s: THREE.Scene) {
    const K = this.kit
    if (!K) { this.buildBlockSkyline(s); return }
    const lam2 = (c: number) => new THREE.MeshLambertMaterial({ color: c })
    let placed = 0
    const put = (name: string, h: number, x: number, y: number, rot = 0) => {
      const proto = K[name]
      if (!proto) return
      const g = fitModel(proto, h, 'z')
      g.position.set(x, y, 0); g.rotation.z = rot
      s.add(g); placed++
    }
    // ---- Batı duvarı: bitişik nizam, kuzeye doğru yükselen siluet ----
    put('building-k', 4.5, -9.24, -19.50)
    put('building-n', 6.5, -10.19, -13.00)
    put('building-skyscraper-e', 9.8, -9.29, -5.50)   // portre telefonda görünen tek kule
    put('building-h', 6.0, -9.85, 1.50, Math.PI / 2)  // alçak ara-dolgu: kule ritmini kırar
    put('building-skyscraper-b', 15.5, -10.15, 8.50)
    put('building-skyscraper-c', 13.0, -10.01, 15.00) // N5'ten alçak → düz tepe hattı olmaz
    put('building-skyscraper-d', 20.5, -10.40, 22.00) // imza kule
    put('building-c', 4.2, -17.00, -16.50)            // ara sokağın karşı cephesi
    // ---- Doğu duvarı: ALÇAK tutuldu (gölge kısıtı) ----
    put('building-k', 7.0, 25.64, 4.00)
    put('building-k', 5.6, 25.60, 14.00)
    put('building-n', 5.5, 25.42, 22.50)
    put('building-h', 6.0, 25.45, -5.00)

    // ---- Siluet: low-detail-building-c × 11, TEK InstancedMesh (1 draw call) ----
    // Model 0.50×0.50×2.25 kare kesit; düzgün OLMAYAN ölçekle çeşitlilik bedava gelir,
    // bu yüzden fitModel kullanılmaz.
    const sil = K['low-detail-building-c']
    if (sil) {
      const geo: THREE.BufferGeometry[] = []
      sil.traverse(o => { if ((o as THREE.Mesh).isMesh) geo.push((o as THREE.Mesh).geometry) })
      const SIL: [number, number, number, number, number][] = [
        [5.0, 5.0, 13.5, -17.50, 13.00], [5.5, 5.5, 12.0, -17.80, 5.50],
        [5.0, 6.0, 9.5, -18.00, -2.50], [5.5, 5.0, 6.5, -17.60, -9.50],
        [5.5, 5.5, 9.5, -24.50, 1.50], [5.0, 5.5, 6.6, -24.80, -6.50],
        [5.5, 5.0, 3.4, -25.00, -14.50], [5.0, 5.0, 9.0, 31.50, 20.50],
        [4.5, 5.0, 8.0, 30.00, 27.00], [5.0, 5.0, 6.0, 25.90, -13.50],
        [5.0, 5.5, 7.5, 25.90, -21.00],
      ]
      if (geo.length) {
        const im = new THREE.InstancedMesh(geo[0], lam2(0x8b94a1), SIL.length)
        const m4 = new THREE.Matrix4()
        SIL.forEach(([ex, ey, h, x, y], i) => {
          m4.makeScale(ex / 0.5, ey / 0.5, h / 2.25)
          m4.setPosition(x, y, 0)
          im.setMatrixAt(i, m4)
        })
        im.instanceMatrix.needsUpdate = true
        im.castShadow = true
        s.add(im); placed++
      }
    }

    // ---- SOKAK DOKUSU: metropolün çevre yolundan asıl ayrıştığı yer ----
    const strip = (w: number, d: number, x: number, y: number, c: number, z = 0.02) => {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(w, d), lam2(c))
      m.position.set(x, y, z); s.add(m)
    }
    strip(1.30, 54, -7.15, 0, 0xd8d4c8)     // kaldırım (batı)
    strip(0.70, 54, 10.55, 0, 0xd8d4c8)     // kaldırım (doğu)
    strip(2.00, 46, -14.00, 2.0, 0x9aa1a9)  // ara sokak
    for (const bx of [-6.62, 10.18]) {
      const k = new THREE.Mesh(new THREE.BoxGeometry(0.12, 54, 0.10), lam2(0xc9c5ba))
      k.position.set(bx, 0, 0.05); s.add(k)
    }
    // şemsiyeler ve tenteler — tek tek GLB yerine instanced (draw call disiplini)
    const instFrom = (proto: THREE.Group | null | undefined, h: number,
                      pts: [number, number][], zOff = 0) => {
      if (!proto) return
      const fit = fitModel(proto, h, 'z')
      const geos: THREE.BufferGeometry[] = []
      let mat: THREE.Material | null = null
      fit.traverse(o => {
        if ((o as THREE.Mesh).isMesh) { geos.push((o as THREE.Mesh).geometry); mat ??= (o as THREE.Mesh).material as THREE.Material }
      })
      if (!geos.length || !mat) return
      const im = new THREE.InstancedMesh(geos[0], mat, pts.length)
      const m4 = new THREE.Matrix4()
      pts.forEach(([x, y], i) => { m4.makeTranslation(x, y, zOff); im.setMatrixAt(i, m4) })
      im.instanceMatrix.needsUpdate = true
      s.add(im); placed++
    }
    instFrom(K['detail-parasol-a'], 1.15,
      [-21, -17.5, -11, -5, 0.5, 6.5, 12.5, 18, 24].map(y => [-7.00, y] as [number, number]))
    instFrom(K['detail-parasol-a'], 0.9,
      [-20, -16, 14, 18, 22].map(y => [10.55, y] as [number, number]))
    // Tente YALNIZ batı duvarının doğuya bakan cephesinde: kameradan yalnız +x/+y yüzler görünür
    instFrom(K['detail-awning'], 1.1,
      [-21.5, -17.5, -15.0, -11.2, -5.5, 0.6, 2.4, 7.2, 9.8, 14.0, 16.0, 20.6, 23.4]
        .map(y => [-7.65, y] as [number, number]), 1.2)

    if (placed === 0) this.buildBlockSkyline(s)
  }

  /** ÇEVRE YOLU — ŞEHİR ÇEPERİ (Kenney city-kit-commercial, alçak doku)
   *
   *  Bu şube eskiden HİÇ model indirmiyordu ve yolun iki yanı bomboştu. Metropolden
   *  ayrışması gerekiyor: orası yoğun şehir, burası çeper — alçak strip mall, toplu
   *  konut slabı, otobüs durağı, yaya bariyeri.
   *
   *  Cephe hatları: doğu x=14.60 (rot π, cephe yola bakar) · batı x=-18.80 (rot 0).
   *  Parsele denk gelen binalar `decor`'a kaydedilir → oyuncu o parseli betonlayınca
   *  kendiliğinden silinir (kasabadaki ağaç/taş ile aynı mekanizma).
   */
  private buildRingRoadDistrict(s: THREE.Scene) {
    const K = this.kit
    const lam2 = (c: number) => new THREE.MeshLambertMaterial({ color: c })
    const put = (name: string, h: number, x: number, y: number, rot: number, onParcel: boolean) => {
      const proto = K?.[name]
      if (!proto) return
      const g = fitModel(proto, h, 'z')
      g.position.set(x, y, 0); g.rotation.z = rot
      s.add(g)
      if (onParcel) this.decor.push({ obj: g, x, y })   // parsel betonlanınca silinsin
    }
    const P = Math.PI
    // ---- Doğu şerit: strip mall (cephe yola bakar) ----
    put('building-c', 4.2, 17.17, -20.40, P, true)   // ışığın ve zebranın karşısı
    put('building-c', 4.2, 17.17, -15.00, P, true)   // aynı model bilerek: strip mall tekrarlıdır
    put('building-i', 6.2, 17.00, -4.60, P, true)    // pompaların tam karşısı = görsel çıpa
    put('building-f', 6.8, 16.97, 2.40, P, true)
    put('building-c', 4.2, 17.17, 13.40, P, true)
    put('building-i', 5.8, 16.85, 19.60, P, true)
    // ---- Batı: çeper konutları ----
    put('building-i', 6.2, -21.20, -18.50, 0, true)
    put('low-detail-building-wide-b', 8.6, -20.67, -5.50, 0, true) // toplu konut slabı: istasyonun fonu
    put('building-f', 8.4, -21.35, 4.60, 0, true)
    put('building-c', 4.2, -21.37, 15.00, 0, true)
    put('low-detail-building-k', 7.8, -25.40, 20.00, 0, true)
    // ---- Kalıcılar: parsel dışında (y<-24 / y>24), asla silinmez ----
    put('low-detail-building-wide-b', 7.4, 16.21, -28.20, P, false)
    put('low-detail-building-e', 9.0, 20.60, -32.50, 0, false)
    put('low-detail-building-k', 7.8, 21.20, -28.80, 0, false)
    put('building-i', 4.8, 16.46, 28.50, P, false)   // kuzeydoğu = kameranın omzu → TEK ve ALÇAK
    put('building-c', 5.0, -22.05, -30.00, 0, false)
    put('low-detail-building-wide-b', 7.4, -20.90, 28.60, 0, false)
    put('low-detail-building-e', 9.0, -24.60, 33.00, 0, false)

    // ---- YAYA ALTYAPISI: yalnız DOĞU yakası (batıda fiziksel yer yok — arsa x=5'te bitiyor) ----
    const inst = (geo: THREE.BufferGeometry, mat: THREE.Material, n: number,
                  place: (m: THREE.Matrix4, i: number) => void) => {
      const im = new THREE.InstancedMesh(geo, mat, n)
      const m4 = new THREE.Matrix4()
      for (let i = 0; i < n; i++) { place(m4, i); im.setMatrixAt(i, m4) }
      im.instanceMatrix.needsUpdate = true
      s.add(im)
    }
    // kaldırım
    const walk = new THREE.Mesh(new THREE.PlaneGeometry(1.70, 120), lam2(0xc9c5ba))
    walk.position.set(11.80, 0, 0.019); s.add(walk)
    // ZEBRA: 7 ayrı mesh yerine tek düzlem + çizgili canvas (1 draw call)
    const zc = document.createElement('canvas')
    zc.width = 128; zc.height = 96
    const zx = zc.getContext('2d')!
    zx.clearRect(0, 0, 128, 96)
    zx.fillStyle = '#f2efe6'
    for (let i = 0; i < 7; i++) zx.fillRect(4 + i * 17.5, 0, 10, 96)
    const ztex = new THREE.CanvasTexture(zc)
    ztex.colorSpace = THREE.SRGBColorSpace
    const zebra = new THREE.Mesh(new THREE.PlaneGeometry(6.00, 4.50),
      new THREE.MeshLambertMaterial({ map: ztex, transparent: true }))
    zebra.position.set(7.90, -22.40, 0.023); s.add(zebra)
    // yaya bariyeri: çevre yolunun en tanınabilir öğesi. Zebra hizasında BOŞLUK var.
    const railY: number[] = []
    for (let y = -40; y <= 40; y += 1.35) if (y < -24.6 || y > -20.2) railY.push(y)
    inst(new THREE.CylinderGeometry(0.045, 0.045, 0.95, 6), lam2(0xb9bec4), railY.length, (m, i) => {
      m.makeRotationX(Math.PI / 2); m.setPosition(11.06, railY[i], 0.48)
    })
    inst(new THREE.BoxGeometry(0.05, 1.35, 0.10), lam2(0xb9bec4), railY.length,
      (m, i) => m.setPosition(11.06, railY[i], 0.86))
    // otobüs durakları — y<-24 / y>24 seçildi ki parsel alınsa da KALSIN (kamu alanı)
    for (const by of [-25.40, 25.40]) {
      const proto = K?.['detail-overhang-wide']
      if (proto) { const g = fitModel(proto, 3.2, 'y'); g.position.set(12.35, by, 0.95); s.add(g) }
      for (const dy of [-1.4, 1.4]) {
        const post = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 2.4, 6), lam2(0x8d949c))
        post.rotation.x = Math.PI / 2
        post.position.set(12.62, by + dy, 1.2); s.add(post)
      }
      const bench = new THREE.Mesh(new THREE.BoxGeometry(0.45, 2.4, 0.42), lam2(0xa8875c))
      bench.position.set(12.9, by, 0.21); s.add(bench)
    }
    // dükkân otoparkı (strip mall'ın zemin ayağı) + park çizgileri
    const roadMat2 = lam2(0x41474e)
    for (const [py, pl] of [[-17.7, 9.8], [-1.3, 11.4], [16.45, 10.5]] as [number, number][]) {
      const lot = new THREE.Mesh(new THREE.PlaneGeometry(1.95, pl), roadMat2)
      lot.position.set(13.63, py, 0.017); s.add(lot)
    }
    const lineY: number[] = []
    for (let y = -22.6; y <= 21.7; y += 1.3) lineY.push(y)
    inst(new THREE.PlaneGeometry(1.95, 0.09), lam2(0xe8e4d8), lineY.length,
      (m, i) => m.setPosition(13.63, lineY[i], 0.018))
  }

  /** Kit yokken kullanılan prosedürel kutu silueti (eski davranış — hiç boş sahne kalmaz) */
  private buildBlockSkyline(s: THREE.Scene) {
    const th = this.theme
    const mk = (geo: THREE.BufferGeometry, mat: THREE.Material, n: number, place: (m: THREE.Matrix4, i: number) => void) => {
      const inst = new THREE.InstancedMesh(geo, mat, n)
      const m4 = new THREE.Matrix4()
      for (let i = 0; i < n; i++) { place(m4, i); inst.setMatrixAt(i, m4) }
      inst.instanceMatrix.needsUpdate = true
      s.add(inst)
    }
    const lam2 = (c: number) => new THREE.MeshLambertMaterial({ color: c })
    mk(new THREE.BoxGeometry(1, 1, 1), lam2(0x6d7683), 26, (m, i) => {
      const side = i % 2 === 0 ? -1 : 1
      const k = Math.floor(i / 2)
      const h = 16 + 11 * Math.abs(Math.sin(i * 1.7)) + 7 * Math.abs(Math.sin(i * 0.53))
      const w = 5 + 2.4 * Math.abs(Math.sin(i * 2.3))
      m.makeScale(w, w, h)
      m.setPosition(ROAD_X + side * (34 + (k % 3) * 11), -84 + k * 13.5, h / 2)
    })
    void th
  }

  private placePlanter(x: number, y: number) {
    if (!this.statics?.planter) return
    const p = fitModel(this.statics.planter, 1.3)
    p.position.set(x, y, 0)
    this.scene.add(p)
  }

  private ownedMarks = new Map<string, THREE.Group>()
  /** dinamik servis noktaları: pompa/şarj taşınınca araçlar yeni yere gelir */
  pumpSlots: THREE.Vector3[] = Array.from({ length: 8 }, (_, i) => (PUMP_SLOTS_POS[i] ?? PUMP_SLOTS_POS[3]).clone())
  /** pompa/şarj oyuncu açıları (rad) — araç slotta bu açıyla hizalanır (döndürülmüş ünitede yan durma fixi) */
  pumpAngles: number[] = []
  evAngles: number[] = []
  /** pompa/şarj GÖVDE konumları — çarpışma kutuları slottan geriye türetilmez (karşı yakada
   *  türetme 3.6 birim kayıyordu: hayalet duvar kapı koridorunun üstüne geliyordu, B1) */
  pumpBase: THREE.Vector2[] = []
  evBase: THREE.Vector2[] = []
  evSlots: THREE.Vector3[] = Array.from({ length: 8 }, (_, i) => (EV_SLOTS_POS[i] ?? EV_SLOTS_POS[3]).clone())
  tankAnchor = new THREE.Vector2(TANK_POS.x, TANK_POS.y)
  /** taşınabilir giriş/çıkış noktaları (yol kenarı şeridi) */
  /** MARİNA DENİZİ: iki doku katmanı ters yönde ve farklı hızda kayar.
   *  Girişimleri tek dokuyla elde edilemeyen canlı dalga hissini verir. */
  private seaLayers: { tex: THREE.Texture; sx: number; sy: number }[] = []
  /** marina köpük halkası — nefes alır (kıyıda dalga hissi) */
  private marinaFoam: THREE.Mesh | null = null
  private foamT = 0
  gateIn = new THREE.Vector2(4.2, APRON_IN_Y)
  gateOut = new THREE.Vector2(4.2, APRON_OUT_Y)
  /** karşı istasyon kapıları — far araç GÜNEYE gittiği için giriş yukarıda (+y), çıkış aşağıda (-y):
   *  near'ın (ROAD_X,0) etrafında 180° dönmüşü. Yalnızca karşı parsel claim'lenince kurulur. */
  gateIn2 = new THREE.Vector2(FAR_GATE_X, APRON_OUT_Y)
  gateOut2 = new THREE.Vector2(FAR_GATE_X, APRON_IN_Y)
  farStationOn = false
  /** Karşıya ilk pompa/şarj konunca otomatik giriş-çıkış kapılarını kurar (bir kez).
   *  inY/outY: çağıran (main) mevcut karşı-yapılardan KAÇAN boş y'leri geçirir → kapı build üstüne binmez. */
  enableFarStation(inY = APRON_OUT_Y, outY = APRON_IN_Y) {
    if (this.farStationOn) return
    this.farStationOn = true
    this.buildGate('in', new THREE.Vector2(FAR_GATE_X, inY), 'far')
    this.buildGate('out', new THREE.Vector2(FAR_GATE_X, outY), 'far')
  }
  /** geniş giriş/çıkış: kapı ağzı, rampa ve bordür boşluğu büyür */
  wideGates = false
  setWideGates(on: boolean) {
    if (this.wideGates === on) return
    this.wideGates = on
    this.buildGate('in')
    this.buildGate('out') // buildGate bordürü de yeniden kurar
  }
  private tankLevelNow = 0
  private tankFillMeshes: Record<FuelType, THREE.Mesh[]> = { benzin: [], dizel: [], lpg: [] }

  /** beton derzleri: hepsi YOLA DİK (x ekseni boyunca), dünya gridine hizalı —
   *  komşu betonlarda çizgi aynı hizada devam eder, bütünlük bozulmaz */
  private paveJoints(x0: number, x1: number, y0: number, y1: number) {
    const SPACING = 5
    const yStart = Math.ceil((y0 + 0.5) / SPACING) * SPACING
    for (let y = yStart; y <= y1 - 0.5; y += SPACING) {
      const joint = new THREE.Mesh(new THREE.PlaneGeometry(x1 - x0 - 0.4, 0.06), lam(0x7e858d))
      joint.position.set((x0 + x1) / 2, y, 0.02)
      this.scene.add(joint)
    }
  }
  /** arsa kenarı bordürleri: komşu betonlanınca aradaki otomatik kalkar */
  private kerbs = new Map<string, THREE.Mesh>()
  /** main bağlar: parsel betonlu mu? */
  isPavedFn: (c: number, r: number) => boolean = () => false
  /** arsalara denk gelebilecek doğal dekor (ağaç/taş/çiçek) — beton dökülünce temizlenir */
  private decor: { obj: THREE.Object3D; x: number; y: number }[] = []

  /** satın alınan (henüz betonsuz) arsayı ahşap kazık + ip sınırla işaretle */
  markOwned(c: number, r: number) {
    if (!PARCEL_COLS[c] || !PARCEL_ROWS[r]) return // sınır dışı parsel: crash koruması
    const [x0, x1] = PARCEL_COLS[c]
    const [y0, y1] = PARCEL_ROWS[r]
    const g = new THREE.Group()
    const rope = new THREE.MeshLambertMaterial({ color: 0xe0b13e })
    const stake = (px: number, py: number) => cyl(0.07, 0.65, 0x8a6a48, px, py, 0.32, 'z', g)
    // köşe + ara kazıklar
    const xs: number[] = []
    for (let x = x0 + 0.3; x <= x1 - 0.29; x += (x1 - x0 - 0.6) / 3) xs.push(x)
    const ys: number[] = []
    for (let y = y0 + 0.3; y <= y1 - 0.29; y += (y1 - y0 - 0.6) / 3) ys.push(y)
    for (const x of xs) { stake(x, y0 + 0.3); stake(x, y1 - 0.3) }
    for (const y of ys) { stake(x0 + 0.3, y); stake(x1 - 0.3, y) }
    // gergin ip (ince sarı şerit)
    const line = (px: number, py: number, w: number, d: number) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, d, 0.03), rope)
      m.position.set(px, py, 0.55)
      g.add(m)
    }
    line((x0 + x1) / 2, y0 + 0.3, x1 - x0 - 0.6, 0.05)
    line((x0 + x1) / 2, y1 - 0.3, x1 - x0 - 0.6, 0.05)
    line(x0 + 0.3, (y0 + y1) / 2, 0.05, y1 - y0 - 0.6)
    line(x1 - 0.3, (y0 + y1) / 2, 0.05, y1 - y0 - 0.6)
    // köşede küçük t("SAHİBİNDEN ALINDI") kazığı yerine tabela çivisi
    const plate = canvasPanel(1.1, 0.5, 220, 100, (ctx, w, h) => {
      ctx.fillStyle = '#f5f4ef'; ctx.beginPath(); ctx.roundRect(0, 0, w, h, 14); ctx.fill()
      ctx.strokeStyle = '#27a05a'; ctx.lineWidth = 7; ctx.stroke()
      ctx.fillStyle = '#27a05a'; ctx.font = '800 36px -apple-system, sans-serif'
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
      ctx.fillText('ARSAN', w / 2, h / 2 + 2)
    })
    plate.position.set(x0 + 0.6, y0 + 0.9, 0.9)
    g.add(plate)
    this.scene.add(g)
    this.ownedMarks.set(`${c},${r}`, g)
  }

  /** arsaya beton döşe (yapı kurmanın ön şartı) — kazık/ip sınırları kaldırılır */
  paveParcel(c: number, r: number) {
    if (!PARCEL_COLS[c] || !PARCEL_ROWS[r]) return // sınır dışı parsel: crash koruması
    const mark = this.ownedMarks.get(`${c},${r}`)
    if (mark) {
      this.scene.remove(mark)
      this.ownedMarks.delete(`${c},${r}`)
    }
    {
      const [dx0, dx1] = PARCEL_COLS[c]
      const [dy0, dy1] = PARCEL_ROWS[r]
      this.decor = this.decor.filter(d => {
        const inside = d.x >= dx0 && d.x <= dx1 && d.y >= dy0 && d.y <= dy1
        if (inside) this.scene.remove(d.obj)
        return !inside
      })
    }
    const [x0, x1] = PARCEL_COLS[c]
    const [y0, y1] = PARCEL_ROWS[r]
    const w = x1 - x0, d = y1 - y0
    const lot = new THREE.Mesh(new THREE.PlaneGeometry(w, d), this.concreteMat)
    lot.position.set((x0 + x1) / 2, (y0 + y1) / 2, 0.015)
    lot.receiveShadow = true
    this.scene.add(lot)
    // beton derz çizgileri: dünya-hizalı ↗ çaprazlar, komşu betonlarla kesintisiz
    this.paveJoints(x0, x1, y0, y1)
    // çevre bordürü: yola bakan kenarlar hariç; betonlu komşuya bakan kenarda
    // bordür KONMAZ ve komşunun o kenardaki bordürü de sökülür (kesintisiz beton)
    const kerbKey = (cc: number, rr: number, e: string) => `${cc},${rr}:${e}`
    const findCol = (edgeX: number, side: 0 | 1): number | null => {
      for (let i = 0; i < PARCEL_COLS.length; i++) {
        if (Math.abs(PARCEL_COLS[i][side] - edgeX) < 0.01) return i
      }
      return null
    }
    const addKerbEdge = (e: 'N' | 'S' | 'W' | 'E') => {
      let mesh: THREE.Mesh
      if (e === 'W') mesh = box(0.18, d - 0.1, 0.13, 0xd8dbde, x0 + 0.1, (y0 + y1) / 2, 0.065, this.scene)
      else if (e === 'E') mesh = box(0.18, d - 0.1, 0.13, 0xd8dbde, x1 - 0.1, (y0 + y1) / 2, 0.065, this.scene)
      else if (e === 'S') mesh = box(w - 0.1, 0.18, 0.13, 0xd8dbde, (x0 + x1) / 2, y0 + 0.1, 0.065, this.scene)
      else mesh = box(w - 0.1, 0.18, 0.13, 0xd8dbde, (x0 + x1) / 2, y1 - 0.1, 0.065, this.scene)
      this.kerbs.set(kerbKey(c, r, e), mesh)
    }
    const tryEdge = (e: 'N' | 'S' | 'W' | 'E', nb: [number, number] | null, opp: string, roadFacing: boolean) => {
      if (roadFacing) return
      if (nb && this.isPavedFn(nb[0], nb[1])) {
        const nk = this.kerbs.get(kerbKey(nb[0], nb[1], opp))
        if (nk) {
          this.scene.remove(nk)
          this.kerbs.delete(kerbKey(nb[0], nb[1], opp))
        }
        return
      }
      addKerbEdge(e)
    }
    const wc = findCol(x0, 1) // batımdaki komşu (onun doğu kenarı = benim batım)
    const ec = findCol(x1, 0) // doğumdaki komşu
    tryEdge('W', wc !== null ? [wc, r] : null, 'E', c === 3)
    tryEdge('E', ec !== null ? [ec, r] : null, 'W', c === 0)
    tryEdge('N', r < 2 ? [c, r + 1] : null, 'S', false)
    tryEdge('S', r > 0 ? [c, r - 1] : null, 'N', false)
    // istasyon kolonunun yol tarafı: dinamik bordür kapı boşluklarını kendisi açar
    // Marinada yol yok: lamba yol kenarına değil ADANIN içine konur (5.45 suya düşüyordu),
    // bordür/kapı boşluğu da çizilmez.
    const wet = this.theme.lane.kind === 'water'
    if (c === 0 && r === 0) {
      this.placeLamp(wet ? 4.2 : 5.45, -20)
      if (!wet) this.buildRoadEdge()
    } else if (c === 0 && r === 2) {
      this.placeLamp(wet ? 4.2 : 5.45, 19)
      if (!wet) this.buildRoadEdge()
    }
  }

  /** yerleştirmede seçilen yöne döndür (90° adımlar) */
  rotateBuilding(id: string, rot: number) {
    const b = this.buildings.find(x => x.id === id)
    if (b) (b.group as THREE.Group).rotation.z = rot * Math.PI / 2
  }

  /** istasyon giriş/çıkış kapısı — oyuncu yerini belirler, trafik buna uyar */
  buildGate(kind: 'in' | 'out', pos?: THREE.Vector2, side: 'near' | 'far' = 'near') {
    const far = side === 'far'
    const id = (kind === 'in' ? 'gatein' : 'gateout') + (far ? '2' : '')
    const v = far ? (kind === 'in' ? this.gateIn2 : this.gateOut2) : (kind === 'in' ? this.gateIn : this.gateOut)
    if (pos) v.set(far ? FAR_GATE_X : 4.2, pos.y)
    this.removeBuildingGroup(id)
    const g = new THREE.Group()
    const pad = new THREE.Mesh(new THREE.PlaneGeometry(2.6, this.wideGates ? 6.2 : 3.4), lam(0x565e66))
    pad.position.z = 0.024
    pad.receiveShadow = true
    g.add(pad)
    // yön oku: giriş istasyona, çıkış yola bakar. Near istasyon batıda (in→-x); far istasyon doğuda → ok tersine döner.
    const dir = (kind === 'in' ? -1 : 1) * (far ? -1 : 1)
    const shaft = new THREE.Mesh(new THREE.PlaneGeometry(1.0, 0.34), lam(0xe8e4d8))
    shaft.position.set(-dir * 0.35, 0, 0.03)
    g.add(shaft)
    const tri = new THREE.Shape()
    tri.moveTo(0, -0.5); tri.lineTo(0.62, 0); tri.lineTo(0, 0.5); tri.closePath()
    const tip = new THREE.Mesh(new THREE.ShapeGeometry(tri), lam(0xe8e4d8))
    tip.position.set(dir * 0.15, 0, 0.03)
    if (dir < 0) tip.rotation.z = Math.PI
    g.add(tip)
    // mini tabela
    cyl(0.05, 1.5, 0x8f979e, 0, 1.45, 0.75, 'z', g)
    const label = canvasPanel(1.3, 0.44, 220, 76, (ctx, cw, ch) => {
      ctx.fillStyle = kind === 'in' ? '#27a05a' : '#d64545'
      ctx.beginPath(); ctx.roundRect(0, 0, cw, ch, 14); ctx.fill()
      ctx.fillStyle = '#fff'; ctx.font = '800 44px -apple-system, sans-serif'
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
      ctx.fillText(kind === 'in' ? t('GİRİŞ') : t('ÇIKIŞ'), cw / 2, ch / 2 + 2)
    })
    label.position.set(0, 1.45, 1.62)
    g.add(label)
    g.position.set(v.x, v.y, 0)
    this.scene.add(g)
    this.register(id, kind === 'in' ? t('GİRİŞ') : t('ÇIKIŞ'), g, 2.1)
    this.buildRoadEdge()
  }

  /** ofis binası — taşınabilir (düzenleme modu) */
  buildOffice(pos?: THREE.Vector2) {
    const at = pos ?? new THREE.Vector2(-5.0, 4.5)
    const officeGroup = new THREE.Group()
    let officeFx = 1.7 // cephe x'i (girişin oturacağı yüz)
    if (this.statics?.office) {
      const o = fitModel(this.statics.office, 4.4)
      o.traverse(m => { m.castShadow = true })
      officeGroup.add(o)
      officeFx = new THREE.Box3().setFromObject(o).max.x
    } else {
      box(3.2, 4.2, 2.4, 0xdfd8c8, 0, 0, 1.2, officeGroup)
      box(3.4, 4.4, 0.25, 0x9c5b3c, 0, 0, 2.5, officeGroup)
    }
    // zemin kat girişi: basamak + çerçeveli cam kapı + kırmızı saçak + yan camlar
    box(0.55, 1.7, 0.1, 0xb8bec4, officeFx + 0.32, 0, 0.05, officeGroup) // alt basamak
    box(0.34, 1.35, 0.2, 0xc7ccd1, officeFx + 0.2, 0, 0.1, officeGroup)  // üst basamak
    box(0.1, 1.2, 1.7, 0x39424e, officeFx + 0.02, 0, 0.95, officeGroup)   // kapı çerçevesi
    box(0.04, 0.95, 1.5, 0x9fb0b8, officeFx + 0.01, 0, 0.92, officeGroup)  // füme cam kapı (gömülü)
    box(0.03, 0.06, 1.4, 0x39424e, officeFx + 0.05, 0, 0.92, officeGroup)  // kapı ortası çıta
    // saçak + direkler
    box(0.95, 1.9, 0.1, 0xd64545, officeFx + 0.42, 0, 1.98, officeGroup)
    box(0.99, 1.94, 0.05, 0xb23434, officeFx + 0.42, 0, 2.05, officeGroup)
    cyl(0.05, 1.95, 0x8f979e, officeFx + 0.82, -0.85, 0.98, 'z', officeGroup)
    cyl(0.05, 1.95, 0x8f979e, officeFx + 0.82, 0.85, 0.98, 'z', officeGroup)
    // zemin kat yan pencereleri: küçük, gömülü, füme — cephe sakinledi
    for (const wy of [-1.45, 1.45]) {
      box(0.06, 0.62, 0.72, 0x39424e, officeFx, wy, 1.05, officeGroup)
      box(0.04, 0.5, 0.6, 0x9fb0b8, officeFx - 0.01, wy, 1.05, officeGroup)
    }
    // saçak üstü OFİS plakası
    const officePlate = canvasPanel(1.0, 0.38, 220, 84, (ctx, w, h) => {
      ctx.fillStyle = '#d64545'; ctx.beginPath(); ctx.roundRect(0, 0, w, h, 14); ctx.fill()
      ctx.fillStyle = '#fff'; ctx.font = '800 52px -apple-system, sans-serif'
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
      ctx.fillText('OFİS', w / 2, h / 2 + 2)
    })
    officePlate.position.set(officeFx + 0.9, 0, 2.28)
    officeGroup.add(officePlate)
    // kapı yanı yeşillikler
    for (const by of [-1.2, 1.2]) {
      const bush = new THREE.Mesh(new THREE.IcosahedronGeometry(0.26, 1), lam(0x6fb35a))
      bush.position.set(officeFx + 0.55, by, 0.26)
      bush.castShadow = true
      officeGroup.add(bush)
      box(0.4, 0.4, 0.18, 0x9c5b3c, officeFx + 0.55, by, 0.09, officeGroup)
    }
    officeGroup.position.set(at.x, at.y, 0)
    this.facadeLights(officeGroup, [[officeFx + 0.01, -0.9, 2.6], [officeFx + 0.01, 0.9, 2.6]])
    this.scene.add(officeGroup)
    this.register('office', t('OFİS'), officeGroup, 5.6)
    cyl(0.22, 0.6, 0x3f6f56, 1.7, 2.3, 0.3, 'z', officeGroup)

  }

  /** kart görselleri için özel örnek modeller (build fonksiyonu olmayan kalemler) */
  thumbSource(id: string): THREE.Group | null {
    if (id === 'sign' && this.signGroup) {
      const g = this.signGroup.clone(true)
      g.position.set(0, 0, 0)
      return g
    }
    if (id === 'tank') {
      const g = this.tankGroup.clone(true)
      g.position.set(0, 0, 0)
      g.traverse(o => { if ((o as THREE.Sprite).isSprite) o.visible = false })
      return g
    }
    if (id === 'grid') {
      const g = new THREE.Group()
      cyl(0.1, 3.6, 0x59616b, 0, 0, 1.8, 'z', g)
      box(1.7, 0.13, 0.13, 0x59616b, 0, 0, 3.2, g)
      box(1.2, 0.11, 0.11, 0x59616b, 0, 0, 2.6, g)
      for (const sx of [-0.6, 0.6]) cyl(0.04, 0.5, 0x2b2f33, sx, 0, 2.95, 'z', g)
      box(0.5, 0.35, 0.7, 0xc7ccd1, 0, 0, 0.35, g)
      return g
    }
    if (id === 'land' || id === 'pave') {
      const g = new THREE.Group()
      const mat = id === 'land' ? lam(0x86b06a) : this.concreteMat
      const tile = new THREE.Mesh(new THREE.BoxGeometry(4.4, 4.4, 0.3), mat)
      tile.position.z = 0.15
      tile.castShadow = true
      g.add(tile)
      if (id === 'land') {
        buildTreeProc(1.1, 1.1, 0.7, g)
        const board = new THREE.Mesh(new THREE.BoxGeometry(0.1, 1.2, 0.7), lam(0xf0f0ec))
        board.position.set(-1, -1, 0.95)
        g.add(board)
        cyl(0.06, 0.7, 0x8a6a48, -1, -1, 0.55, 'z', g)
      } else {
        for (const k of [-1.1, 0, 1.1]) box(4.2, 0.06, 0.02, 0x7e858d, 0, k, 0.31, g)
      }
      return g
    }
    return null
  }

  /** yerleştirme önizlemesi: az önce kurulan binayı kayıttan düşüp grubunu döndürür */
  detachPreview(id: string): THREE.Group | null {
    const b = this.buildings.find(x => x.id === id)
    if (!b) return null
    this.buildings = this.buildings.filter(x => x.id !== id)
    if (id === 'smr') {
      this.steam = this.steam.filter(s => {
        let o: THREE.Object3D | null = s.mesh.parent
        while (o) { if (o === b.group) return false; o = o.parent }
        return true
      })
    }
    return b.group as THREE.Group
  }

  /** taşıma için: kayıtlı binayı sahneden kaldır */
  removeBuildingGroup(id: string) {
    const b = this.buildings.find(x => x.id === id)
    if (!b) return
    this.scene.remove(b.group as THREE.Group)
    this.unregister(id)
    if (id === 'smr') this.steam = []
    if (id === 'market') this.marketGroup = null
    if (id === 'market2') this.market2Group = null
    if (id === 'toilet') this.toiletGroup = null
    if (id === 'battery') this.batteryGroup = null
  }

  addPump(index: number, at?: THREE.Vector2, rot = 0) {
    const base = at ?? new THREE.Vector2(0, PUMP_SLOTS_POS[Math.min(index, 3)].y)
    // Karşı (yol karşısı) istasyonda araç kapıya BATIDAN yanaşır → araç yuvası pompanın batısında, ünite 180° döner.
    // Charger kalıbı: araç yanaşma slotu AÇIYLA birlikte döner — araç hep nozül tarafına yanaşır.
    const far = base.x > ROAD_X
    const ang = rot * Math.PI / 2
    const flip = far ? -1 : 1
    this.pumpSlots[index] = new THREE.Vector3(base.x + Math.cos(ang) * 1.8 * flip, base.y + Math.sin(ang) * 1.8, 0)
    this.pumpAngles[index] = ang // araç pompanın uzun eksenine paralel dursun (yan durma fixi)
    this.pumpBase[index] = base.clone()
    const g = new THREE.Group()
    box(1.7, 3.4, 0.2, 0xc7ccd1, 0, 0, 0.1, g)
    box(1.75, 3.45, 0.05, 0xe0b13e, 0, 0, 0.02, g)
    cyl(0.09, 0.55, 0xe0b13e, 0, -1.5, 0.45, 'z', g)
    cyl(0.09, 0.55, 0xe0b13e, 0, 1.5, 0.45, 'z', g)
    const p = buildPumpMesh(this.nightMats)
    p.position.z = 0.2
    g.add(p)
    g.position.set(base.x, base.y, 0)
    // EV şarj ile aynı kalıp: oyuncu açısı + karşı-istasyon 180° flip BİRLEŞİR.
    // (Önceden yalnız far→PI vardı, sonra rebuild'deki generic rotateBuilding bunu EZİYOR,
    //  reload sonrası karşı pompalar yanlış yöne bakıyordu. Artık rot burada otoriter.)
    g.rotation.z = rot * Math.PI / 2 + (far ? Math.PI : 0) // nozül araç tarafına baksın
    this.scene.add(g)
    this.register(`pump-${index}`, t('POMPA #{0}', index + 1), g, 2.5)
  }

  movePump(index: number, at: THREE.Vector2, rot = 0) {
    this.removeBuildingGroup(`pump-${index}`)
    this.addPump(index, at, rot)
  }

  addEvCharger(index: number, at?: THREE.Vector2, rot = 0) {
    const base = at ?? new THREE.Vector2(0.7, EV_SLOTS_POS[Math.min(index, 3)].y)
    // Araç yanaşma noktası varsayılan sağda (+1.1). Ünite döndükçe bu offset de döner,
    // böylece araç her zaman ünitenin şarj kablosu tarafından yanaşır.
    const ang = rot * Math.PI / 2
    // karşı istasyonda yanaşma batıdan (araç yuvası batıda) — x ofseti terslenir
    const evFlip = base.x > ROAD_X ? -1 : 1
    this.evSlots[index] = new THREE.Vector3(base.x + Math.cos(ang) * 1.1 * evFlip, base.y + Math.sin(ang) * 1.1, 0)
    this.evAngles[index] = ang // araç ünitenin açısına paralel dursun
    this.evBase[index] = base.clone()
    const g = new THREE.Group()
    const pad = new THREE.Mesh(new THREE.PlaneGeometry(3.2, 1.9), new THREE.MeshLambertMaterial({
      color: 0x2f8fd6, transparent: true, opacity: 0.28,
    }))
    pad.position.set(1.1, 0, 0.025)
    g.add(pad)
    box(1.0, 1.6, 0.14, 0xc7ccd1, 0, 0, 0.07, g)
    box(0.35, 0.55, 1.5, 0xf0f0ec, 0, 0, 0.85, g)
    const stripe = glow(0x35c7d6, 0.8)
    box(0.37, 0.57, 0.22, 0x35c7d6, 0, 0, 1.35, g, stripe)
    this.nightMats.push({ mat: stripe, day: 0.8, night: 1.15, owner: 'charger' })
    box(0.04, 0.34, 0.3, 0x1c2530, 0.19, 0, 1.0, g)
    cyl(0.03, 0.5, 0x23272b, 0.15, 0.3, 0.6, 'z', g)
    box(0.1, 0.08, 0.2, 0x35c7d6, 0.15, 0.3, 0.35, g)
    g.position.set(base.x, base.y, 0)
    // karşı istasyonda mesh 180° döner → pad/kablo (yerel +1.1) batıya bakar, batıdaki araç yuvasıyla simetrik
    g.rotation.z = ang + (base.x > ROAD_X ? Math.PI : 0)
    this.scene.add(g)
    this.register(`charger-${index}`, t('DC ŞARJ #{0}', index + 1), g, 2.3)
  }

  moveCharger(index: number, at: THREE.Vector2, rot = 0) {
    this.removeBuildingGroup(`charger-${index}`)
    this.addEvCharger(index, at, rot)
  }

  setStationName(name: string) {
    this.stationName = (name.trim() || t('BENZİNLİK')).toLocaleUpperCase('tr-TR').slice(0, 14)
    this.setSign(this.signLevel)
  }

  signPos = new THREE.Vector2(4.0, -11.5) // taşınabilir tabela konumu
  setSign(level: number, pos?: THREE.Vector2) {
    this.signLevel = level
    if (pos) this.signPos.copy(pos)
    if (this.signGroup) { this.scene.remove(this.signGroup); this.unregister('sign') }
    const g = new THREE.Group()
    const H = [2.4, 3.2, 4.2, 5.4][level]
    const pw = [1.5, 1.9, 2.4, 3.0][level]
    const ph = [1.6, 2.0, 2.4, 2.8][level]
    box(level >= 2 ? 0.9 : 0.5, 0.24, H, 0x39424e, 0, 0, H / 2, g)
    this.nightMats = this.nightMats.filter(n => n.owner !== 'sign')
    let backMat: THREE.Material
    if (level >= 1) {
      const gm = glow(level >= 3 ? 0xd64545 : 0xf0f0ec, level >= 2 ? 0.35 : 0.05)
      this.nightMats.push({ mat: gm, day: level >= 2 ? 0.35 : 0.05, night: 0.9, owner: 'sign' })
      backMat = gm
    } else {
      backMat = lam(0xf0f0ec)
    }
    box(pw + 0.1, 0.2, ph + 0.1, 0, 0, 0, H + ph / 2, g, backMat)
    const drawFace = (ctx: CanvasRenderingContext2D, W: number, H2: number) => {
      ctx.fillStyle = '#f5f4ef'; ctx.fillRect(0, 0, W, H2)
      ctx.fillStyle = '#d64545'; ctx.fillRect(0, 0, W, 84)
      ctx.fillStyle = '#fff'
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
      let fs = 44
      ctx.font = `800 ${fs}px -apple-system, sans-serif`
      while (fs > 16 && ctx.measureText(this.stationName).width > W - 16) {
        fs -= 2
        ctx.font = `800 ${fs}px -apple-system, sans-serif`
      }
      ctx.fillText(this.stationName, W / 2, 44)
      const hasElec = this.priceView[3] > 0
      const rows: [string, string, string][] = [
        [t('BENZİN'), this.priceView[0].toFixed(1), '#1c2530'],
        [t('DİZEL'), this.priceView[1].toFixed(1), '#1c2530'],
        [t('LPG'), this.priceView[2].toFixed(1), '#1c2530'],
      ]
      if (hasElec) rows.push(['kWh', this.priceView[3].toFixed(1), '#2b7fb8'])
      const rowFs = hasElec ? 26 : 29
      const y0 = hasElec ? 112 : 122
      const dy = hasElec ? 38 : 46
      ctx.font = `700 ${rowFs}px -apple-system, sans-serif`
      rows.forEach(([label, val, col], i) => {
        ctx.fillStyle = col
        ctx.textAlign = 'left'; ctx.fillText(label, 18, y0 + dy * i)
        ctx.textAlign = 'right'; ctx.fillText(val, W - 18, y0 + dy * i)
      })
      if (this.closedFlag) {
        ctx.fillStyle = '#d64545'
        ctx.fillRect(0, 238, W, 50)
        ctx.fillStyle = '#fff'; ctx.font = '800 32px -apple-system, sans-serif'
        ctx.textAlign = 'center'; ctx.fillText('KAPALI', W / 2, 263)
      } else if (level >= 1) {
        ctx.fillStyle = '#27a05a'; ctx.font = '700 26px -apple-system, sans-serif'
        ctx.textAlign = 'center'; ctx.fillText(t('★ 7/24 AÇIK ★'), W / 2, 262)
      }
    }
    for (const sy of [1, -1]) {
      const panel = canvasPanel(pw, ph, 256, 288, drawFace, new THREE.Vector3(0, sy, 0))
      panel.position.set(0, sy * 0.12, H + ph / 2)
      g.add(panel)
    }
    if (level >= 3) box(pw + 0.3, 0.22, 0.18, 0xe0b13e, 0, 0, H + ph + 0.15, g)
    // Görünmez tıklama hedefi: ince+yüksek tabela mobilde raycast'i ıskalıyordu; tüm gövdeyi kaplayan
    // saydam kutu (çizilmez ama raycast edilir) sayesinde tabelaya güvenle tıklanır (fiyat panelini açar).
    const hit = new THREE.Mesh(
      new THREE.BoxGeometry(pw + 0.7, 1.5, H + ph),
      new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false }),
    )
    hit.position.set(0, 0, (H + ph) / 2)
    g.add(hit)
    g.position.set(this.signPos.x, this.signPos.y, 0)
    this.scene.add(g)
    this.signGroup = g
    this.register('sign', t('TABELA'), g, H + ph + 0.6) // tıklanabilir + etiketli (taşınabilir)
  }

  buildMarket(level: number, pos?: THREE.Vector2, regId: 'market' | 'market2' = 'market') {
    // market2 = karşı yaka marketi (varsayılan konum near'ın ROAD_X etrafında aynası)
    const at = pos ?? (regId === 'market2' ? new THREE.Vector2(2 * ROAD_X + 3.8, -15.5) : new THREE.Vector2(-3.8, 15.5))
    const cur = regId === 'market2' ? this.market2Group : this.marketGroup
    if (cur) { this.scene.remove(cur); this.unregister(regId) }
    const g = new THREE.Group()
    const proto = level >= 2 ? (this.statics?.market2 ?? this.statics?.market1) : this.statics?.market1
    let H = level >= 2 ? 3.0 : 2.5
    if (proto) {
      const b = fitModel(proto, level >= 2 ? 7.0 : 4.6)
      const bb = new THREE.Box3().setFromObject(b)
      H = bb.max.z
      b.traverse(m => { m.castShadow = true })
      g.add(b)
    } else {
      const W = level >= 2 ? 5.5 : 4.2
      const D = level >= 2 ? 7.5 : 5.0
      box(W, D, H, 0xe8e2d4, 0, 0, H / 2, g)
      box(W + 0.3, D + 0.3, 0.25, 0x8a5a3c, 0, 0, H + 0.12, g)
    }
    const sign = canvasPanel(2.6, 0.6, 420, 100, (ctx, w, h) => {
      ctx.fillStyle = '#d64545'; ctx.beginPath(); ctx.roundRect(0, 0, w, h, 18); ctx.fill()
      ctx.fillStyle = '#fff'; ctx.font = '800 58px -apple-system, sans-serif'
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
      ctx.fillText(t('MARKET'), w / 2, h / 2 + 2)
    })
    sign.position.set(level >= 2 ? 1.7 : 1.4, 0, H + 0.35)
    g.add(sign)
    if (level >= 3) box(3.0, 0.5, 0.18, 0xe0b13e, level >= 2 ? 1.7 : 1.4, 0, H + 0.74, g) // Sv.3: altın şerit (premium)
    const fx = level >= 2 ? 2.3 : 1.6
    this.facadeLights(g, [[fx, -1.1, 1.0], [fx, 1.1, 1.0]], 1.2, 0.8)
    g.position.set(at.x, at.y, 0)
    this.scene.add(g)
    if (regId === 'market2') this.market2Group = g
    else this.marketGroup = g
    this.register(regId, t('MARKET'), g, H + 1.0)
  }

  buildToilet(level: number, pos?: THREE.Vector2, regId = 'toilet') {
    const at = pos ?? (regId.endsWith('2')
      ? new THREE.Vector2(2 * ROAD_X - (2.0), -(12.8))
      : new THREE.Vector2(2.0, 12.8))
    if (regId === 'toilet') { if (this.toiletGroup) { this.scene.remove(this.toiletGroup); this.unregister('toilet') } }
    else this.unregister(regId)
    const g = new THREE.Group()
    let H = level >= 2 ? 2.4 : 2.1
    if (this.statics?.toilet) {
      const b = fitModel(this.statics.toilet, level >= 2 ? 3.4 : 2.6)
      const bb = new THREE.Box3().setFromObject(b)
      H = bb.max.z
      b.traverse(m => { m.castShadow = true })
      g.add(b)
    } else {
      const W = level >= 2 ? 2.8 : 2.1
      const D = level >= 2 ? 3.4 : 2.6
      box(W, D, H, level >= 2 ? 0x9fc4b8 : 0xa8bfd0, 0, 0, H / 2, g)
    }
    const sign = canvasPanel(0.9, 0.5, 180, 100, (ctx, w, h) => {
      ctx.fillStyle = '#2f6fed'; ctx.beginPath(); ctx.roundRect(0, 0, w, h, 16); ctx.fill()
      ctx.fillStyle = '#fff'; ctx.font = '800 56px -apple-system, sans-serif'
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
      ctx.fillText('WC', w / 2, h / 2 + 2)
    })
    sign.position.set(1.0, 0, H + 0.3)
    g.add(sign)
    this.facadeLights(g, [[1.05, 0, 1.0]], 0.6, 0.4)
    if (level >= 2) {
      const bush = new THREE.Mesh(new THREE.IcosahedronGeometry(0.35, 1), lam(0x6fb35a))
      bush.position.set(1.4, -1.6, 0.3); bush.castShadow = true; g.add(bush)
      const bush2 = bush.clone(); bush2.position.y = 1.6; g.add(bush2)
    }
    g.position.set(at.x, at.y, 0)
    this.scene.add(g)
    if (regId === 'toilet') this.toiletGroup = g
    this.register(regId, t('TUVALET'), g, H + 0.85)
  }

  upgradeTankVisual(level: number) {
    this.buildTankCluster(level)
  }

  buildBattery(level: number, pos?: THREE.Vector2) {
    if (pos) this.batteryPos.copy(pos)
    if (this.batteryGroup) { this.scene.remove(this.batteryGroup); this.unregister('battery') }
    const g = new THREE.Group()
    const colors = [0x3f8f5f, 0x3f6f8f, 0xb08a3f]
    for (let i = 0; i < level; i++) {
      box(2.2, 1.3, 1.15, colors[i], 0, 0, 0.6 + i * 1.2, g)
      for (let k = -2; k <= 2; k++) box(2.24, 0.05, 1.1, 0x2b2f33, 0, k * 0.28, 0.6 + i * 1.2, g)
      // yan yüzde büyük pil işareti — ne olduğu uzaktan belli olsun
      const battDecal = canvasPanel(1.0, 1.0, 160, 160, (ctx, w, h) => {
        ctx.fillStyle = 'rgba(255,255,255,0.92)'
        ctx.beginPath(); ctx.arc(w / 2, h / 2, w / 2 - 8, 0, 7); ctx.fill()
        ctx.font = '96px -apple-system, sans-serif'
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
        ctx.fillText('🔋', w / 2, h / 2 + 8)
      })
      battDecal.position.set(1.14, 0, 0.62 + i * 1.2)
      g.add(battDecal)
      // ön yüze şarj çubukları
      const barsDecal = canvasPanel(0.8, 0.5, 160, 100, (ctx, w, h) => {
        ctx.fillStyle = '#0f1a14'
        ctx.beginPath(); ctx.roundRect(0, 0, w, h, 14); ctx.fill()
        for (let b = 0; b < 4; b++) {
          ctx.fillStyle = b < 3 ? '#37c97e' : 'rgba(255,255,255,0.25)'
          ctx.fillRect(14 + b * 34, 18, 24, h - 36)
        }
      }, new THREE.Vector3(0, -1, 0))
      barsDecal.position.set(0, -0.68, 0.62 + i * 1.2)
      g.add(barsDecal)
    }
    const warn = canvasPanel(0.9, 0.45, 180, 90, (ctx, w, h) => {
      ctx.fillStyle = '#e0b13e'; ctx.beginPath(); ctx.roundRect(0, 0, w, h, 12); ctx.fill()
      ctx.fillStyle = '#1c2530'; ctx.font = '800 40px -apple-system, sans-serif'
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
      ctx.fillText('⚡ DEPO', w / 2, h / 2)
    })
    warn.position.set(1.13, 0, 0.9)
    g.add(warn)
    g.position.set(this.batteryPos.x, this.batteryPos.y, 0)
    this.scene.add(g)
    this.batteryGroup = g
    this.register('battery', t('BATARYA DEPOSU'), g, level * 1.2 + 1.1)
  }

  buildSolar(side: 'north' | 'south', pos?: THREE.Vector2, regId = 'solar') {
    const g = new THREE.Group()
    for (let r = 0; r < 2; r++) for (let c = 0; c < 3; c++) {
      const p = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 1.1),
        new THREE.MeshLambertMaterial({ color: 0x1e3a5f, side: THREE.DoubleSide }))
      p.position.set(-1 + r * 2.0, -2.4 + c * 2.4, 0.75)
      p.rotation.y = -0.55
      p.castShadow = true
      g.add(p)
      box(0.08, 0.08, 0.55, 0x8f979e, -1 + r * 2.0, -2.4 + c * 2.4, 0.28, g)
    }
    box(0.7, 0.5, 0.5, 0x59616b, 1.6, 2.6, 0.25, g)
    const at = pos ?? new THREE.Vector2(-4, side === 'south' ? -20 : 20)
    g.position.set(at.x, at.y, 0)
    this.scene.add(g)
    this.register(regId, t('GÜNEŞ SANTRALİ'), g, 2.4)
  }

  buildDiesel(pos?: THREE.Vector2) {
    const at = pos ?? new THREE.Vector2(-5.7, -9.2)
    const g = new THREE.Group()
    box(1.3, 0.9, 0.9, 0xe0b13e, 0, 0, 0.5, g)
    box(1.34, 0.94, 0.12, 0x2b2f33, 0, 0, 1.0, g)
    cyl(0.06, 0.6, 0x59616b, 0.4, 0.25, 1.3, 'z', g)
    box(0.3, 0.2, 0.25, 0x2b2f33, -0.4, 0, 1.1, g)
    g.position.set(at.x, at.y, 0)
    this.scene.add(g)
    this.register('dieselgen', t('JENERATÖR'), g, 2.2)
  }

  buildWash(pos?: THREE.Vector2, regId = 'wash') {
    const at = pos ?? (regId.endsWith('2')
      ? new THREE.Vector2(2 * ROAD_X - (-4.7), -(-12.6))
      : new THREE.Vector2(-4.7, -12.6))
    const g = new THREE.Group()
    // tünel yıkama: iki yan duvar + tonozlu çatı, iki ucu açık
    box(0.3, 4.6, 2.4, 0x8fb8d8, 1.85, 0, 1.2, g)
    box(0.3, 4.6, 2.4, 0x8fb8d8, -1.85, 0, 1.2, g)
    box(4.0, 4.6, 0.28, 0x2f6fed, 0, 0, 2.62, g)
    const arch = new THREE.Mesh(new THREE.CylinderGeometry(2.0, 2.0, 4.4, 20, 1, true, 0, Math.PI),
      new THREE.MeshLambertMaterial({ color: 0x7ec8e3, side: THREE.DoubleSide, transparent: true, opacity: 0.55 }))
    arch.position.z = 2.55
    arch.rotation.z = Math.PI / 2
    arch.scale.set(1, 1, 0.45)
    g.add(arch)
    // dalga şeridi duvarlarda
    box(0.06, 4.6, 0.3, 0x2f6fed, 2.02, 0, 1.7, g)
    box(0.06, 4.6, 0.3, 0x2f6fed, -2.02, 0, 1.7, g)
    // içerideki fırçalar (renkli silindirler) + üst rulo
    cyl(0.42, 2.0, 0xd64545, 1.1, -0.7, 1.15, 'z', g)
    cyl(0.42, 2.0, 0x2f6fed, -1.1, -0.7, 1.15, 'z', g)
    cyl(0.42, 2.0, 0xe0b13e, 1.1, 0.9, 1.15, 'z', g)
    cyl(0.42, 2.0, 0x37c97e, -1.1, 0.9, 1.15, 'z', g)
    cyl(0.38, 2.8, 0xe8e6e1, 0, 0, 2.1, 'x', g)
    // köpük baloncukları + giriş paspası
    for (const [bx, by, bz, br] of [[1.2, 2.0, 0.35, 0.22], [0.6, 2.25, 0.2, 0.16], [-0.9, 2.1, 0.3, 0.19]] as const) {
      const bub = new THREE.Mesh(new THREE.SphereGeometry(br, 10, 8),
        new THREE.MeshLambertMaterial({ color: 0xffffff, transparent: true, opacity: 0.85 }))
      bub.position.set(bx, by, bz)
      g.add(bub)
    }
    const puddle = new THREE.Mesh(new THREE.CircleGeometry(1.4, 20),
      new THREE.MeshLambertMaterial({ color: 0x7ec8e3, transparent: true, opacity: 0.3 }))
    puddle.position.set(0, 2.9, 0.03)
    g.add(puddle)
    const sign = canvasPanel(3.2, 0.6, 460, 90, (ctx, w, h) => {
      ctx.fillStyle = '#2f6fed'; ctx.beginPath(); ctx.roundRect(0, 0, w, h, 18); ctx.fill()
      ctx.fillStyle = '#fff'; ctx.font = '800 52px -apple-system, sans-serif'
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
      ctx.fillText(t('🚿 OTO YIKAMA'), w / 2, h / 2 + 2)
    })
    sign.position.set(2.1, 0, 2.25)
    g.add(sign)
    this.facadeLights(g, [[2.02, -1.6, 1.1]], 0.7, 0.5)
    g.position.set(at.x, at.y, 0)
    this.scene.add(g)
    this.register(regId, t('OTO YIKAMA'), g, 3.6)
  }

  buildCoffee(pos?: THREE.Vector2, regId = 'coffee') {
    const at = pos ?? (regId.endsWith('2')
      ? new THREE.Vector2(2 * ROAD_X - (-9.5), -(3))
      : new THREE.Vector2(-9.5, 3))
    const g = new THREE.Group()
    box(2.8, 2.8, 2.3, 0xe8dcc8, 0, 0, 1.15, g)
    box(3.0, 3.0, 0.2, 0x7a5738, 0, 0, 2.4, g)
    box(0.05, 1.2, 1.0, 0x7ec8e3, 1.41, -0.5, 1.1, g)
    box(0.05, 0.7, 1.5, 0x5b4632, 1.41, 0.8, 0.75, g)
    // tente
    for (let i = 0; i < 4; i++) box(0.5, 0.7, 0.06, i % 2 ? 0x7a5738 : 0xf0f0ec, 1.6, -1.05 + i * 0.7, 1.85, g)
    const sign = canvasPanel(1.9, 0.5, 320, 84, (ctx, w, h) => {
      ctx.fillStyle = '#7a5738'; ctx.beginPath(); ctx.roundRect(0, 0, w, h, 16); ctx.fill()
      ctx.fillStyle = '#fff'; ctx.font = '800 50px -apple-system, sans-serif'
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
      ctx.fillText(t('☕ KAHVE'), w / 2, h / 2 + 2)
    })
    sign.position.set(1.55, 0, 2.05)
    g.add(sign)
    this.facadeLights(g, [[1.44, -0.5, 1.2]], 0.9, 0.6)
    g.position.set(at.x, at.y, 0)
    this.scene.add(g)
    this.register(regId, t('KAHVECİ'), g, 3.0)
  }

  buildRestaurant(pos?: THREE.Vector2, regId = 'restaurant') {
    const at = pos ?? (regId.endsWith('2')
      ? new THREE.Vector2(2 * ROAD_X - (-13.5), -(5))
      : new THREE.Vector2(-13.5, 5))
    const g = new THREE.Group()
    box(4.8, 5.4, 2.8, 0xdfd0b8, 0, 0, 1.4, g)
    box(5.0, 5.6, 0.25, 0x9c3b3b, 0, 0, 2.9, g)
    box(0.05, 3.6, 1.2, 0x7ec8e3, 2.41, 0, 1.3, g)
    box(0.05, 0.9, 1.7, 0x5b4632, 2.41, 2.1, 0.85, g)
    // kırmızı-beyaz tente
    for (let i = 0; i < 6; i++) box(0.6, 0.85, 0.07, i % 2 ? 0xd64545 : 0xf0f0ec, 2.65, -2.15 + i * 0.86, 2.15, g)
    // baca
    cyl(0.14, 0.8, 0x8f979e, -1.6, -1.8, 3.2, 'z', g)
    const sign = canvasPanel(3.2, 0.6, 480, 90, (ctx, w, h) => {
      ctx.fillStyle = '#9c3b3b'; ctx.beginPath(); ctx.roundRect(0, 0, w, h, 18); ctx.fill()
      ctx.fillStyle = '#fff'; ctx.font = '800 50px -apple-system, sans-serif'
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
      ctx.fillText(t('🍽️ RESTORAN'), w / 2, h / 2 + 2)
    })
    sign.position.set(2.55, 0, 2.55)
    g.add(sign)
    this.facadeLights(g, [[2.44, -1.3, 1.4], [2.44, 1.0, 1.4]], 1.1, 0.7)
    g.position.set(at.x, at.y, 0)
    this.scene.add(g)
    this.register(regId, t('RESTORAN'), g, 3.6)
  }

  buildTruckPark(pos?: THREE.Vector2) {
    const at = pos ?? new THREE.Vector2(-12.5, -4.5)
    const g = new THREE.Group()
    const pad = new THREE.Mesh(new THREE.PlaneGeometry(7.6, 5.6), lam(0x565e66))
    pad.position.z = 0.02
    pad.receiveShadow = true
    g.add(pad)
    for (let i = 0; i < 4; i++) {
      const line = new THREE.Mesh(new THREE.PlaneGeometry(6.4, 0.12), lam(0xe8e4d8))
      line.position.set(0, -2.1 + i * 1.4, 0.03)
      g.add(line)
    }
    const sign = canvasPanel(2.6, 0.55, 420, 84, (ctx, w, h) => {
      ctx.fillStyle = '#39424e'; ctx.beginPath(); ctx.roundRect(0, 0, w, h, 16); ctx.fill()
      ctx.fillStyle = '#fff'; ctx.font = '800 48px -apple-system, sans-serif'
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
      ctx.fillText(t('🚛 TIR PARKI'), w / 2, h / 2 + 2)
    })
    sign.position.set(3.9, 0, 1.8)
    g.add(sign)
    cyl(0.08, 1.8, 0x59616b, 3.9, 0, 0.9, 'z', g)
    g.position.set(at.x, at.y, 0)
    this.scene.add(g)
    this.register('truckpark', t('TIR PARKI'), g, 2.6)
  }

  buildSelfWash(pos?: THREE.Vector2, regId = 'selfwash') {
    const at = pos ?? new THREE.Vector2(-10.5, -6.5)
    const g = new THREE.Group()
    // iki açık bölmeli self yıkama
    for (const by of [-1.5, 1.5]) {
      box(0.25, 0.25, 2.2, 0x8f979e, 2.0, by - 1.4, 1.1, g)
      box(0.25, 0.25, 2.2, 0x8f979e, -2.0, by - 1.4, 1.1, g)
      box(0.25, 0.25, 2.2, 0x8f979e, 2.0, by + 1.4, 1.1, g)
      box(0.25, 0.25, 2.2, 0x8f979e, -2.0, by + 1.4, 1.1, g)
      // bölme arası duvar + köpük tabancası
      box(0.2, 2.9, 1.6, 0x9fc8e8, 0, by, 0.8, g)
      cyl(0.05, 1.0, 0xe0b13e, 1.6, by, 1.2, 'z', g)
      box(0.25, 0.15, 0.2, 0xd64545, 1.6, by, 1.8, g)
    }
    box(4.6, 6.4, 0.25, 0x2f6fed, 0, 0, 2.35, g) // ortak çatı
    // jeton/köpük otomatı
    box(0.5, 0.7, 1.3, 0xe0b13e, -2.6, 0, 0.75, g)
    box(0.52, 0.72, 0.12, 0x2b2f33, -2.6, 0, 1.45, g)
    const sign = canvasPanel(2.9, 0.55, 460, 84, (ctx, w, h) => {
      ctx.fillStyle = '#2f8fd6'; ctx.beginPath(); ctx.roundRect(0, 0, w, h, 16); ctx.fill()
      ctx.fillStyle = '#fff'; ctx.font = '800 44px -apple-system, sans-serif'
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
      ctx.fillText(t('🧽 SELF YIKAMA'), w / 2, h / 2 + 2)
    })
    sign.position.set(2.35, 0, 2.7)
    g.add(sign)
    this.facadeLights(g, [[0.12, -1.5, 1.3], [0.12, 1.5, 1.3]], 0.7, 0.4)
    g.position.set(at.x, at.y, 0)
    this.scene.add(g)
    this.register(regId, t('SELF YIKAMA'), g, 3.4)
  }

  buildParking(pos?: THREE.Vector2, regId = 'parking') {
    const at = pos ?? new THREE.Vector2(0.4, -0.2)
    const g = new THREE.Group()
    const pad = new THREE.Mesh(new THREE.PlaneGeometry(4.5, 3.1), lam(0x6b7480))
    pad.position.z = 0.02
    pad.receiveShadow = true
    g.add(pad)
    // çizgili park yerleri (4 kapasite, kompakt)
    for (let i = 0; i <= 4; i++) {
      const line = new THREE.Mesh(new THREE.PlaneGeometry(0.11, 2.8), lam(0xe8e4d8))
      line.position.set(-2.04 + i * 1.02, 0, 0.03)
      g.add(line)
    }
    for (let i = 0; i < 4; i++) {
      box(0.62, 0.13, 0.1, 0xd8dbde, -1.53 + i * 1.02, -1.2, 0.05, g) // teker stoperi
    }
    g.position.set(at.x, at.y, 0)
    this.scene.add(g)
    this.register(regId, t('OTOPARK'), g, 2.2)
  }

  /** yerleştirilen otoparkın dünya park noktaları: pozisyon + yanaşma (stage) + park AÇISI.
   *  Açı otoparkın rotasyonundan türetilir — döndürülen otoparkta araç artık YAN park etmez;
   *  stage noktası girişin önünde (yerel +Y) — araç nereye konursa konsun kendi önünden yanaşır. */
  getParkingSpots(): { id: string; pos: THREE.Vector3; stage: THREE.Vector3; rot: number }[] {
    const spots: { id: string; pos: THREE.Vector3; stage: THREE.Vector3; rot: number }[] = []
    for (const b of this.buildings) {
      if (!(b.id === 'parking' || b.id.startsWith('parking#'))) continue
      const g = b.group as THREE.Group
      g.updateMatrixWorld(true)
      for (let i = 0; i < 4; i++) {
        const lx = -1.53 + i * 1.02
        spots.push({
          id: `${b.id}:${i}`, // KARARLI KİMLİK (B4) — bina taşınsa da yer kimliği değişmez
          pos: new THREE.Vector3(lx, -0.1, 0).applyMatrix4(g.matrixWorld),
          stage: new THREE.Vector3(lx, 2.4, 0).applyMatrix4(g.matrixWorld),
          rot: g.rotation.z - Math.PI / 2, // stoper yerel -Y'de → burun stopere bakar
        })
      }
    }
    return spots
  }

  /** tır parkı: park noktası + manevra (yanaşma) noktası çiftleri */
  getTruckSpots(): { spot: THREE.Vector3; stage: THREE.Vector3 }[] {
    const b = this.buildings.find(x => x.id === 'truckpark')
    if (!b) return []
    const g = b.group as THREE.Group
    g.updateMatrixWorld(true)
    return [-1.4, 0, 1.4].map(ly => ({
      spot: new THREE.Vector3(0, ly, 0).applyMatrix4(g.matrixWorld),
      stage: new THREE.Vector3(5.4, ly, 0).applyMatrix4(g.matrixWorld),
    }))
  }

  /** OYUNCUNUN KURDUĞU sokak lambası — kapı yerleştirince silinen dekoratif lambalardan
   *  farklı olarak KAYITLIDIR: tıklanır, taşınır, satılır (#358, #679-1 "tüm lambaları
   *  yok ettim, nasıl geri ekleyeceğim"). Karşı yakaya da kurulabilir (#835). */
  buildStreetLamp(pos?: THREE.Vector2, regId = 'lamp') {
    const at = pos ?? new THREE.Vector2(-6.5, 6)
    const g = new THREE.Group()
    if (this.statics?.lamp) {
      const l = fitModel(this.statics.lamp, 3.4, 'z')
      l.rotation.z = Math.PI
      l.traverse(m => { m.castShadow = true })
      g.add(l)
    } else {
      buildLampProc(0, 0, g)
    }
    const bulbMat = glow(0xfff3c4, 0.05)
    const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.12, 10, 8), bulbMat)
    bulb.position.set(0.6, 0, 3.0)
    g.add(bulb)
    this.nightMats.push({ mat: bulbMat, day: 0.05, night: 1.3, owner: regId })
    const light = new THREE.PointLight(0xffd9a0, 0, 18, 1.7)
    light.position.set(0.6, 0, 3.2)
    g.add(light)
    this.nightLights.push(light)
    g.position.set(at.x, at.y, 0)
    this.scene.add(g)
    this.register(regId, t('SOKAK LAMBASI'), g, 3.4)
  }

  buildAirWater(pos?: THREE.Vector2, regId = 'airwater') {
    const at = pos ?? new THREE.Vector2(-4.5, 0.2)
    const g = new THREE.Group()
    box(1.0, 1.4, 0.12, 0xc7ccd1, 0, 0, 0.06, g)
    box(0.55, 0.7, 1.4, 0x37c97e, 0, 0, 0.82, g)
    box(0.57, 0.72, 0.1, 0x2b8f5c, 0, 0, 1.55, g)
    cyl(0.035, 0.7, 0x23272b, 0.3, 0.42, 0.7, 'z', g)
    cyl(0.035, 0.7, 0x2f6fed, 0.3, -0.42, 0.7, 'z', g)
    const sign = canvasPanel(1.1, 0.4, 220, 74, (ctx, w, h) => {
      ctx.fillStyle = '#37c97e'; ctx.beginPath(); ctx.roundRect(0, 0, w, h, 14); ctx.fill()
      ctx.fillStyle = '#06281a'; ctx.font = '800 40px -apple-system, sans-serif'
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
      ctx.fillText(t('HAVA · SU'), w / 2, h / 2 + 2)
    })
    sign.position.set(0.31, 0, 1.85)
    g.add(sign)
    g.position.set(at.x, at.y, 0)
    this.scene.add(g)
    this.register(regId, t('HAVA-SU ÜNİTESİ'), g, 2.3)
  }

  buildOil(pos?: THREE.Vector2, regId = 'oil') {
    const at = pos ?? (regId.endsWith('2')
      ? new THREE.Vector2(2 * ROAD_X - (-4.7), -(-16.8))
      : new THREE.Vector2(-4.7, -16.8))
    const g = new THREE.Group()
    box(3.4, 3.0, 2.4, 0xb8bec4, 0, 0, 1.2, g)
    box(3.6, 3.2, 0.22, 0x39424e, 0, 0, 2.5, g)
    box(0.06, 2.2, 1.7, 0x4a5560, 1.71, 0, 0.85, g) // garaj kapısı
    for (let k = 0; k < 4; k++) box(0.02, 2.2, 0.06, 0x39424e, 1.75, 0, 0.3 + k * 0.42, g)
    // yağ varilleri
    cyl(0.3, 0.8, 0x2b2f33, 0.9, -1.9, 0.4, 'z', g)
    cyl(0.3, 0.8, 0xe0b13e, 0.25, -1.95, 0.4, 'z', g)
    cyl(0.3, 0.8, 0x2b2f33, 0.55, -1.6, 1.15, 'z', g)
    const sign = canvasPanel(2.9, 0.55, 480, 90, (ctx, w, h) => {
      ctx.fillStyle = '#e0b13e'; ctx.beginPath(); ctx.roundRect(0, 0, w, h, 18); ctx.fill()
      ctx.fillStyle = '#1c2530'; ctx.font = '800 50px -apple-system, sans-serif'
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
      ctx.fillText('🔧 YAĞ DEĞİŞİMİ', w / 2, h / 2 + 2)
    })
    sign.position.set(1.85, 0, 2.15)
    g.add(sign)
    this.facadeLights(g, [[1.74, 0, 1.6]], 1.4, 0.4)
    g.position.set(at.x, at.y, 0)
    this.scene.add(g)
    this.register(regId, t('YAĞ DEĞİŞİMİ'), g, 3.3)
  }

  buildSMR(side: 'north' | 'south', pos?: THREE.Vector2) {
    const g = new THREE.Group()
    // hiperboloit soğutma kulesi
    const pts: THREE.Vector2[] = []
    for (let i = 0; i <= 16; i++) {
      const t = i / 16
      const z = t * 4.6
      const r = 0.95 * Math.sqrt(1 + Math.pow((z - 3.2) / 1.9, 2))
      pts.push(new THREE.Vector2(r, z))
    }
    const tower = new THREE.Mesh(new THREE.LatheGeometry(pts, 30),
      new THREE.MeshLambertMaterial({ color: 0xe8e6e1, side: THREE.DoubleSide }))
    tower.rotation.x = Math.PI / 2
    tower.castShadow = true
    g.add(tower)
    // kule içi su yüzeyi (üstten bakınca içi boş görünmesin)
    const water = new THREE.Mesh(new THREE.CircleGeometry(1.05, 24), lam(0x2e4a66))
    water.position.z = 3.9
    g.add(water)
    // hareketli buhar (update() içinde yükselir/kaybolur)
    for (let i = 0; i < 4; i++) {
      const puff = new THREE.Mesh(new THREE.SphereGeometry(0.45, 12, 10),
        new THREE.MeshLambertMaterial({ color: 0xffffff, transparent: true, opacity: 0.7 }))
      puff.position.set(0, 0, 4.8)
      g.add(puff)
      this.steam.push({ mesh: puff, offset: i / 4, drift: (Math.random() - 0.5) * 0.6 })
    }
    // reaktör çekirdek binası
    const dome = new THREE.Mesh(new THREE.SphereGeometry(0.7, 18, 12, 0, Math.PI * 2, 0, Math.PI / 2), lam(0xdfe3e8))
    dome.position.set(2.2, -0.8, 0.9)
    dome.castShadow = true
    g.add(dome)
    cyl(0.7, 0.9, 0xdfe3e8, 2.2, -0.8, 0.45, 'z', g)
    box(1.0, 0.7, 0.7, 0x59616b, 2.2, 0.9, 0.35, g)
    const sign = canvasPanel(0.7, 0.7, 128, 128, (ctx, w, h) => {
      ctx.fillStyle = '#e0b13e'; ctx.beginPath(); ctx.arc(w / 2, h / 2, w / 2 - 4, 0, 7); ctx.fill()
      ctx.font = '70px -apple-system, sans-serif'
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
      ctx.fillText('☢️', w / 2, h / 2 + 4)
    })
    sign.position.set(2.92, -0.8, 0.9)
    g.add(sign)
    const at = pos ?? new THREE.Vector2(1.8, side === 'south' ? -20.5 : 20.5)
    g.position.set(at.x, at.y, 0)
    this.scene.add(g)
    this.register('smr', t('REAKTÖR'), g, 7.0)
  }
}
