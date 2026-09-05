/**
 * RAFİNERİ SAHNESİ — oyuncunun ZİYARET ettiği 3B tesis (5 Eyl 2026, Oğuz: "rafineri bi
 * lokasyon olsun ve oraya gidebilelim, 3b olarak görünsün, çalışırken animasyon olsun,
 * geliştikçe geliştiğini görelim").
 *
 * NEDEN ŞUBE (LocId) DEĞİL: `unlockedLocs.length` oyunda 10+ yerde "şube sayısı"
 * demek (prestij eşiği, "beş şubeyi aç" başarımı, kasa toplama, rakip, ortak hat) ve
 * `baseLoc('rafineri')` sessizce 'kasaba' döner. Rafineriyi LocId yapmak bunların hepsini
 * kırardı. Bunun yerine ziyaret bir SAHNE MODUDUR: aynı canvas, aynı kamera, aynı HUD;
 * yalnız çizilen sahne değişir. İstasyon arkada çalışmaya devam eder (müşteri, gün,
 * müdür). `activeLoc` değişmez, kayıt formatı değişmez, sunucuya bir şey gitmez.
 *
 * KADEMELER (state.refineryLevel):
 *   0  boş arsa: çit, tabela "RAFİNERİ ARSASI", kazıklar
 *   1  Damıtma Ünitesi: büyük baca + 2 orta baca + işlem binası + 2 küçük tank + alev bacası → DUMAN
 *   2  Depolama Terminali: 3 büyük tank + su kulesi + kontrol binası + boru köprüsü
 *   3  Tanker Filosu: dolum rampası + konteynerler + TANKERLER (tesisten çıkıp yola koyulur)
 * İnşaat sürerken (refineryDaysLeft>0) sıradaki kademenin parçaları ilerlemeye göre yerden
 * YÜKSELİR (parça parça belirir), vinç kolu döner, iskele durur. Gün dönünce ilerleme artar
 * → oyuncu her ziyarette tesisin büyüdüğünü görür.
 *
 * MODELLER: Kenney city-kit-industrial (repoda: public/kenney/industrial + industrial2).
 * Her kit kendi colormap'iyle kendi klasöründe (bkz. models.ts loadStatics notu). Model
 * inmezse her parça için prosedürel yedek var — sahne hiçbir koşulda boş kalmaz.
 */
import * as THREE from 'three'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { asset } from './platform'
import { fitModel, cloneModel, type ModelLib } from './models'
import { REFINERY_MAX, REFINERY_NAMES } from './state'
import { t } from './i18n'

/** Rafineri sahnesinin gök renkleri: sanayi puslu gündüz, koyu lacivert gece */
export const RAFINERI_GOK = { day: 0xb9c9d6, night: 0x0f1826 }
/** Tankerlerin aktığı iç yol (y sabit, x boyunca) — kamera (+x,+y) tarafından bakar, yol ÖNDE */
export const RAF_YOL_Y = 11
/** Dolum rampasının x konumu — tanker burada durur */
export const RAF_RAMPA_X = 0

const MODELLER: Record<string, string> = {
  bacaBuyuk: 'industrial/chimney-large',
  bacaOrta: 'industrial/chimney-medium',
  bacaKucuk: 'industrial/chimney-small',
  bacaTemel: 'industrial/chimney-basic',
  tankKucuk: 'industrial/detail-tank',
  islemBinasi: 'industrial/building-l',
  kontrolBinasi: 'industrial/building-f',
  depoBinasi: 'industrial/building-q',
  tankBuyuk: 'industrial2/detail-tank-large',
  suKulesi: 'industrial2/water-tower',
  konteynerA: 'industrial2/shipping-container-a',
  konteynerB: 'industrial2/shipping-container-b',
}
type ModelAdi = keyof typeof MODELLER

/** Kenney Y-up/+Z-ileri → oyun z-yukarı/+x-ileri (models.ts / kits.ts ile aynı dönüşüm) */
function donustur(scene: THREE.Group): THREE.Group {
  scene.rotation.x = Math.PI / 2
  const mid = new THREE.Group()
  mid.rotation.z = Math.PI / 2
  mid.add(scene)
  const proto = new THREE.Group()
  proto.add(mid)
  proto.traverse(o => {
    if ((o as THREE.Mesh).isMesh) {
      o.castShadow = true
      o.receiveShadow = true
      const mat = (o as THREE.Mesh).material as THREE.MeshStandardMaterial
      if (mat?.map) mat.map.colorSpace = THREE.SRGBColorSpace
    }
  })
  return proto
}

const BIRIM_KUTU = new THREE.BoxGeometry(1, 1, 1)
const BIRIM_SILINDIR = new THREE.CylinderGeometry(1, 1, 1, 16)
const matKese = new Map<number, THREE.MeshLambertMaterial>()
function lam(color: number) {
  let m = matKese.get(color)
  if (!m) { m = new THREE.MeshLambertMaterial({ color }); matKese.set(color, m) }
  return m
}
function kutu(w: number, d: number, h: number, color: number, x: number, y: number, z: number, parent: THREE.Object3D, mat?: THREE.Material) {
  const m = new THREE.Mesh(BIRIM_KUTU, mat ?? lam(color))
  m.scale.set(w, d, h); m.position.set(x, y, z)
  m.castShadow = true; m.receiveShadow = true
  parent.add(m)
  return m
}
function silindir(r: number, len: number, color: number, x: number, y: number, z: number, axis: 'x' | 'y' | 'z', parent: THREE.Object3D) {
  const m = new THREE.Mesh(BIRIM_SILINDIR, lam(color))
  m.scale.set(r, len, r)
  if (axis === 'x') m.rotation.z = Math.PI / 2
  if (axis === 'z') m.rotation.x = Math.PI / 2
  m.position.set(x, y, z)
  m.castShadow = true
  parent.add(m)
  return m
}
function pano(w: number, h: number, px: number, py: number,
              ciz: (ctx: CanvasRenderingContext2D, W: number, H: number) => void, dir = new THREE.Vector3(1, 1, 0)): THREE.Mesh {
  const c = document.createElement('canvas')
  c.width = px; c.height = py
  ciz(c.getContext('2d')!, px, py)
  const tex = new THREE.CanvasTexture(c)
  tex.colorSpace = THREE.SRGBColorSpace
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshLambertMaterial({ map: tex, transparent: true }))
  m.lookAt(dir.clone().normalize())
  return m
}
/** benekli zemin dokusu (dosya indirmez) */
function benekDoku(taban: string, benek: [string, number][], tekrar: number): THREE.CanvasTexture {
  const c = document.createElement('canvas'); c.width = c.height = 256
  const ctx = c.getContext('2d')!
  ctx.fillStyle = taban; ctx.fillRect(0, 0, 256, 256)
  let seed = 7
  const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647 }
  for (const [renk, adet] of benek) {
    ctx.fillStyle = renk
    for (let i = 0; i < adet; i++) { const s = 1 + rnd() * 3; ctx.fillRect(rnd() * 256, rnd() * 256, s, s) }
  }
  const tex = new THREE.CanvasTexture(c)
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping
  tex.repeat.set(tekrar, tekrar)
  tex.colorSpace = THREE.SRGBColorSpace
  return tex
}

interface Duman { mesh: THREE.Mesh; offset: number; drift: number; bx: number; by: number; bz: number; hiz: number }
interface Tankerci { g: THREE.Group; x: number; bekle: number; durdu: boolean; hiz: number }
interface GeceMat { mat: THREE.MeshLambertMaterial; day: number; night: number }

export class RafineriSahnesi {
  readonly scene = new THREE.Scene()
  private sun: THREE.DirectionalLight
  private hemi: THREE.HemisphereLight
  private lib: Partial<Record<ModelAdi, THREE.Group | null>> = {}
  /** modeller indi mi — inmeden kur() prosedürel yedeklerle kurar, inince yeniden kurar */
  private hazir = false
  readonly yukleme: Promise<void>
  private yapi = new THREE.Group()
  private duman: Duman[] = []
  private dumanT = 0
  private alev: THREE.Mesh | null = null
  private alevIsik: THREE.PointLight
  private alevT = 0
  private fenerler: THREE.MeshLambertMaterial[] = []
  private fenerT = 0
  private vincKol: THREE.Object3D | null = null
  private tankerler: Tankerci[] = []
  private geceMat: GeceMat[] = []
  private lambaIsik: THREE.PointLight[] = []
  /** en son kurulan durum — aynıysa kur() iş yapmaz */
  private kuruluAnahtar = ''

  constructor(private modelLib: ModelLib | null) {
    const s = this.scene
    s.background = new THREE.Color(RAFINERI_GOK.day)
    this.hemi = new THREE.HemisphereLight(0xffffff, 0x8899aa, 1.1)
    s.add(this.hemi)
    this.sun = new THREE.DirectionalLight(0xfff0d8, 2.2)
    this.sun.position.set(18, -12, 26)
    this.sun.castShadow = true
    this.sun.shadow.mapSize.set(1024, 1024)
    const cam = this.sun.shadow.camera
    cam.left = -55; cam.right = 55; cam.top = 55; cam.bottom = -55; cam.far = 140
    s.add(this.sun)
    // ışık sayısı SABİT (shader yeniden derlenmesin): alev + 4 direk lambası baştan sahnede
    this.alevIsik = new THREE.PointLight(0xff9a3c, 0, 14, 1.6)
    this.alevIsik.position.set(-17, -2, 5.6)
    s.add(this.alevIsik)
    for (const [x, y] of [[-19, 13], [19, 13], [-19, -12], [19, -12]]) {
      const l = new THREE.PointLight(0xffd9a0, 0, 18, 1.7)
      l.position.set(x, y, 3.6)
      s.add(l)
      this.lambaIsik.push(l)
    }
    s.add(this.yapi)
    this.zemin()
    this.yukleme = this.yukle()
  }

  private async yukle() {
    const loader = new GLTFLoader()
    const girisler = Object.entries(MODELLER) as [ModelAdi, string][]
    await Promise.all(girisler.map(([ad, yol]) =>
      loader.loadAsync(asset(`/kenney/${yol}.glb`))
        .then(g => { this.lib[ad] = donustur(g.scene as unknown as THREE.Group) })
        .catch(() => { this.lib[ad] = null })))
    this.hazir = true
    this.kuruluAnahtar = '' // modeller indi → bir sonraki kur() gerçek modellerle yeniden kurar
  }

  /** Sabit çevre: çim, çit dışı toprak, ağaçsız sanayi ufku yok (sahne odak: tesis) */
  private zemin() {
    const s = this.scene
    const cim = new THREE.Mesh(new THREE.PlaneGeometry(180, 180),
      new THREE.MeshLambertMaterial({ map: benekDoku('#7f9f60', [['#6f8f52', 900], ['#93b070', 600]], 24) }))
    cim.position.z = -0.03; cim.receiveShadow = true
    s.add(cim)
    // iç yol: tankerlerin aktığı asfalt şerit (çitin iki kapısından geçer)
    const yol = new THREE.Mesh(new THREE.PlaneGeometry(120, 4.4), lam(0x4a5058))
    yol.position.set(0, RAF_YOL_Y, 0.005); yol.receiveShadow = true
    s.add(yol)
    for (let x = -58; x < 60; x += 4) kutu(2.0, 0.12, 0.01, 0xe8e2c8, x, RAF_YOL_Y, 0.012, s)
    // direk lambaları (4 köşe) — geceleri yanar
    for (const l of this.lambaIsik) {
      const { x, y } = l.position
      silindir(0.09, 3.6, 0x4a5058, x, y, 1.8, 'z', s)
      const ampul = new THREE.MeshLambertMaterial({ color: 0xfff2c8, emissive: 0xffd989, emissiveIntensity: 0.05 })
      const a = new THREE.Mesh(new THREE.SphereGeometry(0.22, 10, 8), ampul)
      a.position.set(x, y, 3.65); s.add(a)
      this.geceMat.push({ mat: ampul, day: 0.05, night: 1.4 })
    }
  }

  /** Kademe + inşaat durumuna göre tesisi kur. Aynı durumda tekrar çağrılması bedavadır. */
  kur(seviye: number, insaatIlerleme: number) {
    const lvl = Math.max(0, Math.min(REFINERY_MAX, seviye | 0))
    const p = insaatIlerleme > 0 && lvl < REFINERY_MAX ? Math.max(0.02, Math.min(1, insaatIlerleme)) : 0
    const anahtar = `${lvl}:${p.toFixed(3)}:${this.hazir ? 1 : 0}`
    if (anahtar === this.kuruluAnahtar) return false
    this.kuruluAnahtar = anahtar
    this.sok()
    const y = this.yapi
    // çit + kapılar (her kademede)
    this.cit(y)
    if (lvl === 0 && p === 0) { this.bosArsa(y); return true }
    // beton plaka (kademe ≥1 ya da inşaat başladı)
    const beton = new THREE.Mesh(new THREE.PlaneGeometry(46, 30),
      new THREE.MeshLambertMaterial({ map: benekDoku('#9aa1a9', [['#8b929a', 700], ['#a9b0b7', 500]], 10) }))
    beton.position.set(0, -1, 0.01); beton.receiveShadow = true
    y.add(beton)
    this.tabela(y, t('BENELOIL RAFİNERİ'), lvl > 0 ? REFINERY_NAMES[lvl - 1] : t('İNŞAAT SAHASI'))
    const kademeler = [this.damitma, this.depolama, this.filo]
    for (let i = 0; i < lvl; i++) kademeler[i].call(this, y, 1)
    if (p > 0) {
      const g = new THREE.Group(); y.add(g)
      kademeler[lvl].call(this, g, p)
      this.insaatSahasi(g, lvl)
    }
    return true
  }

  private sok() {
    for (const o of [...this.yapi.children]) this.yapi.remove(o)
    this.duman = []; this.alev = null; this.fenerler = []; this.vincKol = null; this.tankerler = []
    // direk lambaları geceMat'te kalır (zemin'de kuruldu); yapıya ait olanları at
    this.geceMat = this.geceMat.slice(0, this.lambaIsik.length)
  }

  private model(ad: ModelAdi, hedef: number, eksen: 'x' | 'y' | 'z'): THREE.Group | null {
    const proto = this.lib[ad]
    return proto ? fitModel(proto, hedef, eksen) : null
  }

  /** İNŞAAT İLERLEMESİ: parçalar sırayla belirir; sıradaki parça yerden yükselir (scale.z) */
  private parcaAc(parcalar: THREE.Object3D[], p: number) {
    if (p >= 1) return
    const n = parcalar.length
    parcalar.forEach((o, i) => {
      const baslangic = i / n
      const yerel = (p - baslangic) * n
      if (yerel <= 0) { o.visible = false; return }
      o.visible = true
      o.scale.z *= Math.max(0.08, Math.min(1, yerel))
    })
  }

  private cit(y: THREE.Group) {
    const X = 23, Y = 15.5, h = 1.3
    const dik = (x0: number, y0: number, x1: number, y1: number) => {
      const len = Math.hypot(x1 - x0, y1 - y0)
      const g = new THREE.Group()
      g.position.set((x0 + x1) / 2, (y0 + y1) / 2, 0)
      g.rotation.z = Math.atan2(y1 - y0, x1 - x0)
      // tel örgü: yarı saydam koyu panel + üst boru
      const tel = new THREE.Mesh(new THREE.PlaneGeometry(len, h), new THREE.MeshLambertMaterial({ color: 0x9aa4ae, transparent: true, opacity: 0.35, side: THREE.DoubleSide }))
      tel.rotation.x = Math.PI / 2; tel.position.z = h / 2; g.add(tel)
      silindir(0.04, len, 0xcfd6dc, 0, 0, h, 'x', g)
      for (let d = -len / 2; d <= len / 2; d += 3) silindir(0.05, h, 0x8a949e, d, 0, h / 2, 'z', g)
      y.add(g)
    }
    dik(-X, -Y, X, -Y); dik(-X, Y, X, Y)
    // yolun geçtiği kapı boşlukları: doğu/batı çitte y=RAF_YOL_Y ± 2.6 aralığı açık
    for (const sx of [-X, X]) {
      dik(sx, -Y, sx, RAF_YOL_Y - 2.6); dik(sx, RAF_YOL_Y + 2.6, sx, Y)
      // kapı direkleri + bariyer kolu (açık)
      kutu(0.5, 0.5, 2.2, 0xd64545, sx, RAF_YOL_Y - 2.6, 1.1, y)
      kutu(0.5, 0.5, 2.2, 0xd64545, sx, RAF_YOL_Y + 2.6, 1.1, y)
      silindir(0.07, 2.2, 0xffffff, sx, RAF_YOL_Y + 2.6, 2.2 + 1.1, 'z', y)
    }
  }

  private bosArsa(y: THREE.Group) {
    const toprak = new THREE.Mesh(new THREE.PlaneGeometry(46, 30),
      new THREE.MeshLambertMaterial({ map: benekDoku('#b5a37a', [['#a4926a', 900], ['#c4b48c', 500], ['#8f9b6a', 300]], 8) }))
    toprak.position.set(0, -1, 0.01); toprak.receiveShadow = true
    y.add(toprak)
    // ölçüm kazıkları + kırmızı-beyaz şerit: "burası bir gün rafineri olacak"
    for (const [kx, ky] of [[-12, -8], [12, -8], [12, 5], [-12, 5]]) {
      silindir(0.06, 1.1, 0xe8e2c8, kx, ky, 0.55, 'z', y)
      kutu(0.3, 0.05, 0.2, 0xd64545, kx, ky, 1.0, y)
    }
    for (const [a, b] of [[[-12, -8], [12, -8]], [[12, -8], [12, 5]], [[12, 5], [-12, 5]], [[-12, 5], [-12, -8]]] as [number, number][][]) {
      const len = Math.hypot(b[0] - a[0], b[1] - a[1])
      const s = silindir(0.02, len, 0xd64545, (a[0] + b[0]) / 2, (a[1] + b[1]) / 2, 0.85, 'x', y)
      s.rotation.z = Math.atan2(b[1] - a[1], b[0] - a[0]) + Math.PI / 2
    }
    // birkaç çalı/ot öbeği (boş arsa hissi)
    for (const [bx, by, r] of [[-18, -10, 0.7], [17, 3, 0.55], [-6, -12, 0.5], [8, -13, 0.6], [-16, 6, 0.45]]) {
      const m = new THREE.Mesh(new THREE.SphereGeometry(r, 8, 6), lam(0x7c9a4e))
      m.position.set(bx, by, r * 0.6); m.scale.z = 0.7; y.add(m)
    }
    this.tabela(y, t('RAFİNERİ ARSASI'), t('BenelOil · haritadan kur'))
  }

  /** Giriş tabelası: krem zemin, kırmızı marka; ön-sağ köşe, kameraya dönük */
  private tabela(y: THREE.Group, ust: string, alt: string) {
    const g = new THREE.Group()
    g.position.set(19.5, 14.5, 0)
    silindir(0.12, 3.2, 0x4a5058, -0.6, 0.6, 1.6, 'z', g)
    silindir(0.12, 3.2, 0x4a5058, 0.6, -0.6, 1.6, 'z', g)
    const p = pano(4.6, 1.7, 512, 190, (ctx, W, H) => {
      ctx.fillStyle = '#faf6ec'; ctx.fillRect(0, 0, W, H)
      ctx.fillStyle = '#d64545'; ctx.fillRect(0, 0, W, 14)
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
      // metin panoya SIĞSIN: ölçüp gerekirse küçült (uzun EN/FR çeviriler taşmasın)
      const sigdir = (metin: string, px: number, agirlik: string) => {
        let f = px
        do { ctx.font = `${agirlik} ${f}px "Baloo 2", "Arial Black", sans-serif`; f -= 2 } while (ctx.measureText(metin).width > W * 0.92 && f > 14)
      }
      ctx.fillStyle = '#d64545'; sigdir(ust, 64, 'bold'); ctx.fillText(ust, W / 2, H * 0.42)
      ctx.fillStyle = '#5a5248'; sigdir(alt, 32, 'bold'); ctx.fillText(alt, W / 2, H * 0.78)
    })
    p.position.set(0, 0, 3.4)
    g.add(p)
    // gece: tabela alttan aydınlanır
    const isik = new THREE.MeshLambertMaterial({ color: 0xfff2c8, emissive: 0xffd989, emissiveIntensity: 0.03 })
    const bar = new THREE.Mesh(BIRIM_KUTU, isik); bar.scale.set(4.4, 0.15, 0.1); bar.position.set(0, 0, 2.5)
    g.add(bar)
    this.geceMat.push({ mat: isik, day: 0.03, night: 1.0 })
    y.add(g)
  }

  /** KADEME 1 — Damıtma Ünitesi (arka-sol). p<1 ise inşaat ilerlemesi. */
  private damitma(y: THREE.Group, p: number) {
    const parcalar: THREE.Object3D[] = []
    const ekle = (o: THREE.Object3D | null, x: number, yy: number) => { if (!o) return; o.position.set(x, yy, o.position.z); y.add(o); parcalar.push(o) }
    // işlem binası
    ekle(this.model('islemBinasi', 8, 'x') ?? (() => { const g = new THREE.Group(); kutu(8, 5, 3.2, 0xb9c0c8, 0, 0, 1.6, g); kutu(7.6, 4.6, 0.3, 0x6b7480, 0, 0, 3.35, g); return g })(), -8, -2)
    // DAMITMA KOLONLARI: Kenney chimney-medium ince/şeritli — "rafineri kulesi" okunur.
    // chimney-large geniş bir soğutma kulesi; 9 birimde kadrajı yutuyordu → 5.5, arka köşe.
    ekle(this.model('bacaOrta', 8.4, 'z') ?? (() => { const g = new THREE.Group(); silindir(0.55, 8.4, 0xdfe3e8, 0, 0, 4.2, 'z', g); return g })(), -9.5, -9)
    ekle(this.model('bacaOrta', 6.2, 'z') ?? (() => { const g = new THREE.Group(); silindir(0.45, 6.2, 0xdfe3e8, 0, 0, 3.1, 'z', g); return g })(), -6.8, -10)
    ekle(this.model('bacaTemel', 5.0, 'z') ?? (() => { const g = new THREE.Group(); silindir(0.4, 5, 0xdfe3e8, 0, 0, 2.5, 'z', g); return g })(), -12.2, -6)
    // soğutma kulesi (chimney-large) — beyaz buhar buradan
    ekle(this.model('bacaBuyuk', 5.5, 'z') ?? (() => { const g = new THREE.Group(); silindir(1.4, 5.5, 0xb9c0c8, 0, 0, 2.75, 'z', g); return g })(), -16, -10)
    // iki küçük tank
    ekle(this.model('tankKucuk', 2.6, 'z') ?? (() => { const g = new THREE.Group(); silindir(1.0, 2.6, 0xdfe3e8, 0, 0, 1.3, 'z', g); return g })(), -1.5, -7.5)
    ekle(this.model('tankKucuk', 2.6, 'z') ?? (() => { const g = new THREE.Group(); silindir(1.0, 2.6, 0xdfe3e8, 0, 0, 1.3, 'z', g); return g })(), -1.5, -4)
    // alev bacası (küçük) + boru hattı bina→tanklar
    ekle(this.model('bacaKucuk', 5.2, 'z') ?? (() => { const g = new THREE.Group(); silindir(0.28, 5.2, 0xcfd6dc, 0, 0, 2.6, 'z', g); return g })(), -17, -2)
    const borular = new THREE.Group()
    silindir(0.14, 5.5, 0xc9a24a, -3.2, -5.6, 1.4, 'x', borular)
    silindir(0.14, 3.6, 0xc9a24a, -1.5, -5.75, 1.4, 'y', borular)
    for (const bx of [-5.5, -3]) silindir(0.06, 1.4, 0x6b7480, bx, -5.6, 0.7, 'z', borular)
    ekle(borular, 0, 0)
    this.parcaAc(parcalar, p)
    if (p < 1) return
    // ÇALIŞIYOR: duman + alev + tepe fenerleri
    this.dumanEkle(y, -9.5, -9, 8.4, 5, 0.34, 0xd8d8dc)   // kolon: gri duman
    this.dumanEkle(y, -16, -10, 5.5, 6, 0.6, 0xffffff)    // soğutma kulesi: beyaz buhar
    this.dumanEkle(y, -6.8, -10, 6.2, 3, 0.26, 0xd8d8dc)
    const alevMat = new THREE.MeshLambertMaterial({ color: 0xffb347, emissive: 0xff7a1a, emissiveIntensity: 1.6, transparent: true, opacity: 0.9 })
    this.alev = new THREE.Mesh(new THREE.ConeGeometry(0.34, 1.3, 10), alevMat)
    this.alev.rotation.x = Math.PI / 2 // tepe yukarı
    this.alev.position.set(-17, -2, 5.2 + 0.65)
    y.add(this.alev)
    this.fener(y, -9.5, -9, 8.45)
    this.pencereler(y, [[-3.95, -3.2, 1.6], [-3.95, -0.8, 1.6], [-3.95, -3.2, 2.6], [-3.95, -0.8, 2.6]])
  }

  /** KADEME 2 — Depolama Terminali (arka-sağ) */
  private depolama(y: THREE.Group, p: number) {
    const parcalar: THREE.Object3D[] = []
    const ekle = (o: THREE.Object3D | null, x: number, yy: number) => { if (!o) return; o.position.set(x, yy, o.position.z); y.add(o); parcalar.push(o) }
    const tankYedek = () => { const g = new THREE.Group(); silindir(1.9, 4.2, 0xe4e8ec, 0, 0, 2.1, 'z', g); silindir(1.95, 0.25, 0xd64545, 0, 0, 3.9, 'z', g); return g }
    ekle(this.model('tankBuyuk', 4.2, 'z') ?? tankYedek(), 6, -9)
    ekle(this.model('tankBuyuk', 4.2, 'z') ?? tankYedek(), 11, -9)
    ekle(this.model('tankBuyuk', 4.2, 'z') ?? tankYedek(), 8.5, -3.5)
    ekle(this.model('suKulesi', 6.5, 'z') ?? (() => { const g = new THREE.Group(); silindir(0.1, 5, 0x6b7480, 0, 0, 2.5, 'z', g); silindir(1.1, 1.6, 0x9fd47f, 0, 0, 5.8, 'z', g); return g })(), 16, -1)
    ekle(this.model('kontrolBinasi', 4.5, 'x') ?? (() => { const g = new THREE.Group(); kutu(4.5, 3.5, 2.4, 0xb9c0c8, 0, 0, 1.2, g); return g })(), 14, 4.5)
    // boru köprüsü: damıtmadan tank çiftliğine (x −1 → +5, y −5.6)
    const kopru = new THREE.Group()
    silindir(0.16, 6.5, 0xc9a24a, 2.2, -5.9, 2.2, 'x', kopru)
    silindir(0.12, 6.5, 0x9aa4ae, 2.2, -5.4, 2.2, 'x', kopru)
    for (const bx of [0.2, 2.2, 4.2]) { silindir(0.07, 2.2, 0x6b7480, bx, -5.9, 1.1, 'z', kopru); silindir(0.07, 2.2, 0x6b7480, bx, -5.4, 1.1, 'z', kopru) }
    ekle(kopru, 0, 0)
    this.parcaAc(parcalar, p)
    if (p < 1) return
    this.fener(y, 6, -9, 4.25); this.fener(y, 11, -9, 4.25); this.fener(y, 8.5, -3.5, 4.25)
    this.pencereler(y, [[16.3, 3.6, 1.2], [16.3, 5.4, 1.2]])
  }

  /** KADEME 3 — Tanker Filosu (ön şerit): dolum rampası + konteynerler + tankerler */
  private filo(y: THREE.Group, p: number) {
    const parcalar: THREE.Object3D[] = []
    const ekle = (o: THREE.Object3D | null, x: number, yy: number) => { if (!o) return; o.position.set(x, yy, o.position.z); y.add(o); parcalar.push(o) }
    // dolum rampası: 4 direk + çelik çatı + kırmızı kolonlar, yolun (y=11) üstünde
    const rampa = new THREE.Group()
    for (const [dx, dy] of [[-4.5, -2.6], [4.5, -2.6], [-4.5, 2.6], [4.5, 2.6]]) kutu(0.35, 0.35, 4.2, 0xd64545, dx, dy, 2.1, rampa)
    kutu(11, 6.4, 0.18, 0x6b7480, 0, 0, 4.3, rampa)                 // çelik çatı (koyu, ince)
    for (const dx of [-4.5, -1.5, 1.5, 4.5]) kutu(0.16, 6.4, 0.22, 0x8a949e, dx, 0, 4.5, rampa) // makaslar
    kutu(11.2, 0.25, 0.45, 0xd64545, 0, -3.2, 4.1, rampa)
    kutu(11.2, 0.25, 0.45, 0xd64545, 0, 3.2, 4.1, rampa)
    // çatı tabelası: BENELOIL (marka kırmızısı)
    const rt = pano(5.2, 0.9, 520, 90, (ctx, W, H) => {
      ctx.fillStyle = '#d64545'; ctx.fillRect(0, 0, W, H)
      ctx.fillStyle = '#faf6ec'; ctx.font = 'bold 62px "Baloo 2", "Arial Black", sans-serif'
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('BENELOIL', W / 2, H / 2)
    })
    rt.position.set(0, 3.25, 4.95); rampa.add(rt)
    // dolum kolları (sarı borular çatıdan sarkar)
    for (const dx of [-2.5, 0, 2.5]) { silindir(0.1, 1.8, 0xc9a24a, dx, 0, 3.7, 'z', rampa); silindir(0.1, 1.2, 0xc9a24a, dx, -0.6, 2.8, 'y', rampa) }
    ekle(rampa, RAF_RAMPA_X, RAF_YOL_Y)
    // konteyner yığını (ön-sağ, yolun arkasında)
    const kA = this.model('konteynerA', 4.2, 'x'), kB = this.model('konteynerB', 4.2, 'x')
    const kontYedek = (renk: number) => { const g = new THREE.Group(); kutu(4.2, 1.7, 1.75, renk, 0, 0, 0.875, g); return g }
    ekle(kA ?? kontYedek(0xd64545), 13, 6.5)
    ekle(kB ?? kontYedek(0x3d7cc9), 13, 4.4)
    const ust = this.model('konteynerA', 4.2, 'x') ?? kontYedek(0x9fd47f); if (ust) ust.position.z = 1.75
    ekle(ust, 13, 5.45)
    // depo binası (yolun batı ucu, çit içi)
    ekle(this.model('depoBinasi', 6, 'x') ?? (() => { const g = new THREE.Group(); kutu(6, 4, 2.8, 0xb9c0c8, 0, 0, 1.4, g); return g })(), -15, 6)
    // park çizgileri
    const park = new THREE.Group()
    for (const px of [-8, -5.2, -2.4]) kutu(0.12, 4.0, 0.01, 0xe8e2c8, px, 5.5, 0.02, park)
    ekle(park, 0, 0)
    this.parcaAc(parcalar, p)
    if (p < 1) return
    this.pencereler(y, [[-11.95, 5.2, 1.4], [-11.95, 6.8, 1.4]])
    // TANKERLER: iki araç, ters fazda — doğudan gelir, rampada durur, batıdan çıkar.
    // Başlangıç konumları GÖRÜNÜR bölgede (biri 4 sn içinde rampaya varır, biri çıkışta):
    // uzakta (x=48/108) doğsalar oyuncu sahneye girip 9 sn boyunca boş yol görüyordu.
    for (let i = 0; i < 2; i++) {
      const g = this.tankerMesh(i === 0 ? 0xa8d6b8 : 0xe3c49b)
      g.rotation.z = Math.PI // batıya (−x) gider; model +x ileri
      const x0 = i === 0 ? 22 : -14
      g.position.set(x0, RAF_YOL_Y, 0)
      y.add(g)
      this.tankerler.push({ g, x: x0, bekle: 0, durdu: i === 1, hiz: 5.5 })
    }
  }

  private tankerMesh(tint: number): THREE.Group {
    const g = new THREE.Group()
    if (this.modelLib?.tankerBase) {
      g.add(cloneModel(this.modelLib.tankerBase))
      const tank = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.5, 1.5, 16), lam(tint))
      tank.rotation.z = Math.PI / 2; tank.position.set(-0.55, 0, 0.95); g.add(tank)
      g.scale.setScalar(1.5)
    } else {
      kutu(1.4, 1.5, 1.5, 0xd64545, 1.9, 0, 0.95, g)
      const tank = new THREE.Mesh(new THREE.CylinderGeometry(0.8, 0.8, 3.4, 18), lam(tint))
      tank.rotation.z = Math.PI / 2; tank.position.set(-0.6, 0, 1.15); g.add(tank)
      kutu(4.6, 1.4, 0.3, 0x2b2f33, 0, 0, 0.45, g)
    }
    return g
  }

  /** İnşaat sahası: vinç (kolu döner), iskele kafesi, "İNŞAAT" pankartı — sıradaki kademenin bölgesinde */
  private insaatSahasi(y: THREE.Group, kademe: number) {
    const merkez: [number, number][] = [[-8, -5], [10, -5], [0, 7]]
    const [cx, cy] = merkez[kademe] ?? [0, 0]
    // vinç
    const vinc = new THREE.Group()
    kutu(1.6, 1.6, 0.4, 0xd64545, 0, 0, 0.2, vinc)
    silindir(0.22, 9, 0xf2c94c, 0, 0, 4.5, 'z', vinc)
    const kol = new THREE.Group(); kol.position.z = 9
    silindir(0.14, 9, 0xf2c94c, 3.2, 0, 0, 'x', kol)
    kutu(1.2, 0.6, 0.6, 0x4a5058, -1.6, 0, 0, kol)
    silindir(0.03, 3.5, 0x22262a, 6.5, 0, -1.8, 'z', kol)
    kutu(0.6, 0.6, 0.6, 0x9aa4ae, 6.5, 0, -3.8, kol)
    vinc.add(kol)
    vinc.position.set(cx + 6, cy + 3, 0)
    y.add(vinc)
    kol.name = 'vincKol'
    this.vincKol = kol
    // iskele: sarı boru kafes (ince silindirler)
    const isk = new THREE.Group()
    for (const [ix, iy] of [[-3, -2], [3, -2], [3, 2], [-3, 2]]) silindir(0.05, 3.6, 0xf2c94c, ix, iy, 1.8, 'z', isk)
    for (const z of [1.2, 2.4, 3.6]) { silindir(0.04, 6, 0xf2c94c, 0, -2, z, 'x', isk); silindir(0.04, 6, 0xf2c94c, 0, 2, z, 'x', isk); silindir(0.04, 4, 0xf2c94c, -3, 0, z, 'y', isk); silindir(0.04, 4, 0xf2c94c, 3, 0, z, 'y', isk) }
    isk.position.set(cx - 4, cy + 4, 0)
    y.add(isk)
    // pankart
    const pk = pano(3.6, 1.1, 420, 128, (ctx, W, H) => {
      ctx.fillStyle = '#f2c94c'; ctx.fillRect(0, 0, W, H)
      ctx.fillStyle = '#22262a'; ctx.font = 'bold 60px "Baloo 2", "Arial Black", sans-serif'
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
      ctx.fillText(t('İNŞAAT'), W / 2, H / 2)
    })
    pk.position.set(cx + 1, cy + 7, 1.6); y.add(pk)
    silindir(0.06, 2.2, 0x4a5058, cx - 0.6, cy + 6.4, 1.1, 'z', y)
    silindir(0.06, 2.2, 0x4a5058, cx + 2.6, cy + 7.6, 1.1, 'z', y)
  }

  private dumanEkle(y: THREE.Group, bx: number, by: number, bz: number, adet: number, r: number, renk = 0xe8e8ec) {
    for (let i = 0; i < adet; i++) {
      const puff = new THREE.Mesh(new THREE.SphereGeometry(r, 12, 10),
        new THREE.MeshLambertMaterial({ color: renk, transparent: true, opacity: 0.6 }))
      puff.castShadow = false
      puff.position.set(bx, by, bz)
      y.add(puff)
      this.duman.push({ mesh: puff, offset: i / adet, drift: (Math.random() - 0.5) * 0.8, bx, by, bz, hiz: 0.22 + Math.random() * 0.08 })
    }
  }
  /** tepe feneri: kırmızı yanıp söner (uçak ikaz lambası) */
  private fener(y: THREE.Group, x: number, yy: number, z: number) {
    const m = new THREE.MeshLambertMaterial({ color: 0xff4040, emissive: 0xff2020, emissiveIntensity: 0.4 })
    const f = new THREE.Mesh(new THREE.SphereGeometry(0.16, 8, 6), m)
    f.position.set(x, yy, z + 0.2); y.add(f)
    this.fenerler.push(m)
  }
  /** cephe pencereleri: gündüz sönük, gece sıcak sarı */
  private pencereler(y: THREE.Group, konum: [number, number, number][]) {
    for (const [x, yy, z] of konum) {
      const m = new THREE.MeshLambertMaterial({ color: 0xffd989, emissive: 0xffd989, emissiveIntensity: 0.03 })
      const p = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 0.55), m)
      p.lookAt(new THREE.Vector3(1, 0, 0)); p.position.set(x, yy, z)
      y.add(p)
      this.geceMat.push({ mat: m, day: 0.03, night: 1.05 })
    }
  }

  /** 0 gündüz … 1 gece (World.setNight ile aynı sözleşme) */
  setNight(f: number) {
    this.sun.intensity = 2.2 - 1.55 * f
    this.sun.color.setHex(f > 0.5 ? 0xb8c8ff : 0xfff0d8)
    this.hemi.intensity = 1.1 - 0.5 * f
    ;(this.scene.background as THREE.Color).copy(new THREE.Color(RAFINERI_GOK.day).lerp(new THREE.Color(RAFINERI_GOK.night), f))
    for (const n of this.geceMat) n.mat.emissiveIntensity = n.day + (n.night - n.day) * f
    for (const l of this.lambaIsik) l.intensity = 17 * f
  }

  /** her kare: duman, alev, fener, vinç, tankerler */
  update(dt: number) {
    this.dumanT += dt
    for (const d of this.duman) {
      const tt = (this.dumanT * d.hiz + d.offset) % 1
      d.mesh.position.set(d.bx + d.drift * tt * 2, d.by + d.drift * tt, d.bz + tt * 3.2)
      const sc = 0.6 + tt * 1.6
      d.mesh.scale.setScalar(sc)
      ;(d.mesh.material as THREE.MeshLambertMaterial).opacity = 0.62 * (1 - tt)
    }
    if (this.alev) {
      this.alevT += dt
      const f = 0.85 + 0.25 * Math.sin(this.alevT * 17) + 0.12 * Math.sin(this.alevT * 41)
      this.alev.scale.set(f, 0.8 + 0.5 * Math.abs(Math.sin(this.alevT * 9)), f)
      this.alevIsik.intensity = 4 + 3 * Math.abs(Math.sin(this.alevT * 13))
    } else this.alevIsik.intensity = 0
    if (this.fenerler.length) {
      this.fenerT += dt
      const on = (this.fenerT % 1.4) < 0.18
      for (const m of this.fenerler) m.emissiveIntensity = on ? 2.4 : 0.15
    }
    if (this.vincKol) this.vincKol.rotation.z += dt * 0.18
    // tankerler: +x'ten gelir, rampada durur (dolum), −x'e çıkar, uzakta tekrar doğar
    for (const tk of this.tankerler) {
      if (tk.bekle > 0) { tk.bekle -= dt; continue }
      if (!tk.durdu && tk.x > RAF_RAMPA_X && tk.x - tk.hiz * dt <= RAF_RAMPA_X) {
        tk.x = RAF_RAMPA_X; tk.durdu = true; tk.bekle = 4.5
      } else {
        tk.x -= tk.hiz * dt
        if (tk.x < -42) { tk.x = 42; tk.durdu = false; tk.bekle = 2 + Math.random() * 3 }
      }
      tk.g.position.x = tk.x
    }
  }
}
