import * as THREE from 'three'
import { t } from './i18n'
import { StaticLib, fitModel } from './models'
import { PARCEL_COLS, PARCEL_ROWS, FuelType, PARK_YER } from './state'
export { PARK_YER }
import { LocationTheme, activeTheme } from './themes'
import type { Kit } from './kits'
import { asset, texture, isLightMode } from './platform'
import { SCENE_PLANS, type Placement } from './scenery'
import { parkHavuzuAyikla } from './traffic-graph'

// Koordinat sistemi: z yukarı, y sağa, x kameraya doğru.
// Ana arsa: x -6.5..5, y -10..10. Güney arsa y -24..-10, kuzey arsa y 10..24.
// Yol arsadan ayrı: arada yeşil bant (x 5..5.9) ve giriş/çıkış rampaları var.

export const ROAD_X = 7.9

/**
 * OTOPARK ÖLÇÜLERİ — "araçlar üst üste biniyor" (#107 #139 #198 #252 #320).
 * Park aralığı 1.02 birimdi; araç genişlikleri 1.05 / 1.10 / 1.20 olduğu için araçlar
 * fiziksel olarak yan yana sığmıyordu. En geniş araç 1.20 → aralık 1.25 (pay dahil).
 * Park noktaları hem çizim hem de trafik tarafından parkYerX() ile TEK KAYNAKTAN
 * okunur; ikisi ayrı hesaplanırsa araç çizginin üstüne park eder.
 */
// KAPASİTE GERÇEĞE ÇEKİLDİ (1 Eyl, canlı telemetri): 1,25 aralıklı 4 şerit,
// gövdesi ~1,3 olan araçları FİZİKSEL BİNDİRMEYLE park ettiriyordu — canlıdaki
// parked+parked 240 çiftlik kümenin kaynağı buydu. Ayak izi DEĞİŞMEDİ (ped 5,0):
// 2 yer x 2,5 aralık. Çizgi, kapasite rozeti ve park noktası aynı sabitlerden
// türediği için üçü artık aynı gerçeği söylüyor (4 şerit çizip 2'sine izin veren
// yalancı görsel de böylece doğmadı). Gelir adet bazlı — ekonomi etkilenmez.
export const PARK_ARALIK = 2.5
export const PARK_PAD_W = PARK_YER * PARK_ARALIK        // 5.0
export const parkYerX = (i: number) => -PARK_PAD_W / 2 + PARK_ARALIK * (i + 0.5)
export const LANE_NEAR = 6.95
export const LANE_FAR = 8.85
/** Karşı (yol karşısı) istasyonun kapı x'i — near kapı 4.2'nin ROAD_X etrafında aynası (15.8-4.2). */
export const FAR_GATE_X = 11.6
/**
 * POMPA / ŞARJ VARSAYILAN ARAÇ YUVALARI — 8 AYRI NOKTA (ölçülmüş yığılma fixi).
 *
 * ÖLÇÜM (canlı sahne probu, ?full=1, 4 pompa): `world.pumpSlots` 8 kayıtlıydı ama
 * tablo yalnız 4 giriş içeriyordu; 5..8. slot `?? PUMP_SLOTS_POS[3]` ile AYNI noktaya
 * ((1.8,−18)) düşüyordu. Aynı hata EV tarafında da vardı (5..8 → (1.8,−21.5)).
 * Sonuç: konumu OLMAYAN her ünite (kayıtta placedPos boşsa — canlıda tesislerin
 * ~%14'ünde bu alan boştu) üst üste doğuyor, o slotların TÜM araçları tek noktada
 * iç içe geçiyordu. Oyuncunun ekranda gördüğü "pompa önünde 4-5 araç iç içe, alttaki
 * pompalar boş" görüntüsü buydu.
 *
 * TABLO NE TUTAR: ARAÇ YUVASININ (aracın durduğu nokta) dünya koordinatı.
 * Ünite gövdesi buradan türer: pompa gövdesi yuvanın 1.8, şarj gövdesi 1.1 batısında.
 * (Eski kod tablodan yalnız .y okuyup gövde x'ini 0 / 0.7 diye SABİT yazıyordu; ilk dört
 *  girişte sonuç birebir aynı — 1.8−1.8=0, 1.8−1.1=0.7 — ama artık ikinci bir kolon
 *  tanımlanabiliyor, tek kolona 8 ünite ≥3 birim aralıkla sığmıyordu.)
 *
 * YENİ NOKTALARIN SEÇİM KURALI:
 *  · kendi tablosundaki HER noktadan ≥ 3.0 birim uzak (araç gövdesi 2.66; en yakın çift 3.12),
 *  · yol (x 5.6..10.2) ve KUYRUK/servis şeridi (fixedObstacles: x 2.05..3.55 ve 3.3..5.3)
 *    dışında — yuva x'i en fazla 1.8, ikinci kolon −0.6,
 *  · varsayılan ofis (−5,4.5), tank (−5.05,−6.05), tabela (4,−11.5) ve kapı
 *    dikdörtgenleriyle çakışmaz,
 *  · sahibi olunabilir parsellerin içinde (ana arsa y −10..10, güney y −24..−10).
 * İkinci kolon (x −0.6) güneyde mevcut kolonun ARASINA kaydırılmış (Δx 2.4 · Δy 2.0
 * → 3.12 birim): iki kolon da kapı koridorunun batısında kalır, şeride girmez.
 *
 * NOT: bu tablo yalnız KONUMU OLMAYAN ünite için kullanılır (yeni kurulum ya da kaydı
 * bozulmuş oyuncu). Oyuncunun elle yerleştirdiği ünite placedPos'tan gelir, buraya
 * asla düşmez. Kalan çakışmalar (ör. varsayılan tuvalet/market noktası) yeniden
 * kurulumdaki AYRIŞTIRMA geçişiyle (main.ts uniteleriAyristir) temizlenir.
 */
export const PUMP_SLOTS_POS = [
  new THREE.Vector3(1.8, -2.2, 0), new THREE.Vector3(1.8, 2.2, 0),
  new THREE.Vector3(1.8, -14, 0), new THREE.Vector3(1.8, -18, 0),
  // ↓ yeni: 5..8. pompa. İlk dördü DEĞİŞMEDİ (mevcut kayıtlar birebir korunur).
  new THREE.Vector3(1.8, -6.2, 0),    // ana arsa, pompa-0 ile şarj-2 arasındaki boşluk
  new THREE.Vector3(-0.6, -9.6, 0),   // ikinci kolon (gövde x −2.4)
  new THREE.Vector3(-0.6, -16, 0),    // güney: pompa-2 ile pompa-3 arasına kaydırılmış
  new THREE.Vector3(-0.6, -20, 0),
]
export const EV_SLOTS_POS = [
  // 0 numaralı yuva 6.2 → 5.7 kaydırıldı (TEK değişen eski giriş, 0.5 birim). Gerekçe:
  // 6.2 ile 8.8 arası 2.6 idi, yani ayrıştırma eşiğinin (2.8) ALTINDA — tablo kendi
  // kuralını çiğniyordu ve onarım geçişi HER kayıtta boş yere tetiklenirdi. 8.8 sabit
  // kaldı: gövdesi kuzey parsel sınırına (y=10) dayanıyor, yukarı kaydırmak yeni
  // oyuncunun 2. şarj ünitesini "arsan yok" diye elle yerleştirmeye düşürürdü.
  new THREE.Vector3(1.8, 5.7, 0), new THREE.Vector3(1.8, 8.8, 0),
  new THREE.Vector3(1.8, -11.8, 0), new THREE.Vector3(1.8, -21.5, 0),
  // ↓ yeni: 5..8. şarj ünitesi
  new THREE.Vector3(-0.6, 3.6, 0),    // ikinci kolon, ana arsa
  new THREE.Vector3(-0.6, 11.6, 0),   // kuzey arsa
  new THREE.Vector3(1.8, 16.4, 0),    // kuzey arsa: varsayılan tuvalet ile SMR arası boşluk
  new THREE.Vector3(-0.6, 20.6, 0),
]
/** Aynı türden iki ünite yuvasının izin verilen EN KISA mesafesi. Altına düşen çift
 *  yeniden kurulumda ayrıştırılır (main.ts uniteleriAyristir). Araç gövdesi 2.66. */
export const SLOT_MIN_ARA = 2.8
/** Pompa gövdesinin araç yuvasına uzaklığı (yuva gövdenin doğusunda). */
export const PUMP_SLOT_OFF = 1.8
/** Şarj ünitesi gövdesinin araç yuvasına uzaklığı. */
export const EV_SLOT_OFF = 1.1
/**
 * Tablodan i. varsayılan yuvayı verir. TABLO TAŞMASI ARTIK YIĞMAZ: eskiden taşan indeks
 * `?? tablo[3]` ile son girişe düşüyor, N adet ünite TEK noktada üst üste doğuyordu.
 * Tablo 8 girişli olduğu için normalde taşma yok; yine de fail-safe olarak taşan indeks
 * son girişten güneye doğru SLOT_MIN_ARA aralıkla açılır (asla aynı noktaya düşmez).
 */
function varsayilanYuva(tablo: THREE.Vector3[], i: number): THREE.Vector3 {
  const v = tablo[i]
  if (v) return v.clone()
  const son = tablo[tablo.length - 1]
  return new THREE.Vector3(son.x, son.y - SLOT_MIN_ARA * (i - tablo.length + 1), 0)
}
export const TANK_POS = new THREE.Vector3(-5.5, -6.5, 0)
/** araçların kullandığı giriş/çıkış rampaları */
export const APRON_IN_Y = -8
export const APRON_OUT_Y = 8
export const APRON_SOUTH_Y = -16

/**
 * PERFORMANS — MATERYAL PAYLAŞIMI (30 Ağu, ölçüme dayalı).
 *
 * Ölçüm: dolu istasyonda sahnede 621 BENZERSİZ materyal vardı. Oysa palet dar (~15 renk);
 * aynı kırmızıdan onlarca ayrı MeshLambertMaterial nesnesi üretiliyordu. Her materyal
 * ayrı shader bağlama + uniform yüklemesi demek — bu maliyet CPU tarafında ve oyuncuların
 * "işlemci fullde çalışıyor" (#105), "iyi bilgisayarım var ama 30fps altında" (#813)
 * şikayetlerinin doğrudan sebebi.
 *
 * Artık renk başına TEK materyal paylaşılıyor. DİKKAT: paylaşılan materyalin opacity/color
 * alanı tek tek değiştirilemez — hayalet/seçim gibi yerler zaten kendi clone'unu yapıyor.
 * Gece ışığı için kullanılan glow() ayrı kalır (her biri kendi emissive'ini animasyonlar).
 */
const matKese = new Map<number, THREE.MeshLambertMaterial>()
const lam = (color: number) => {
  let m = matKese.get(color)
  if (!m) { m = new THREE.MeshLambertMaterial({ color }); matKese.set(color, m) }
  return m
}

/**
 * GEOMETRİ PAYLAŞIMI: ölçümde 911 benzersiz geometri çıktı. box()/cyl() her çağrıda yeni
 * BufferGeometry üretiyordu; oysa hepsi birim küp/silindirin ölçeklenmiş hâli. Tek geometri
 * paylaşılıp mesh.scale ile boyutlandırılıyor — bellek ve GC baskısı düşüyor, ayrıca
 * geometri paylaşan mesh'ler ileride InstancedMesh'e çevrilmeye hazır hâle geliyor.
 */
const BIRIM_KUTU = new THREE.BoxGeometry(1, 1, 1)
const silindirKese = new Map<string, THREE.CylinderGeometry>()
const birimSilindir = (segment: number) => {
  const k = `s${segment}`
  let g = silindirKese.get(k)
  if (!g) { g = new THREE.CylinderGeometry(1, 1, 1, segment); silindirKese.set(k, g) }
  return g
}
// Silo çatısı: birim koni de aynı mantıkla paylaşılır (tank her seviye atlayışında yeniden
// kurulduğu için burada geometri üretmek onlarca çöp BufferGeometry demek olurdu).
const koniKese = new Map<string, THREE.ConeGeometry>()
const birimKoni = (segment: number) => {
  const k = `k${segment}`
  let g = koniKese.get(k)
  if (!g) { g = new THREE.ConeGeometry(1, 1, segment); koniKese.set(k, g) }
  return g
}
/** Saydam gövde materyali — lam() gibi RENK BAŞINA TEK nesne.
 *  Tank her yükseltmede/taşımada yeniden kurulduğu için inline materyal üretmek
 *  her seferinde 3 yeni shader bağlaması (ve eski materyalde sızıntı) demekti. */
const saydamKese = new Map<number, THREE.MeshLambertMaterial>()
const saydam = (color: number) => {
  let m = saydamKese.get(color)
  if (!m) {
    m = new THREE.MeshLambertMaterial({ color, transparent: true, opacity: 0.26, depthWrite: false })
    saydamKese.set(color, m)
  }
  return m
}

function glow(color: number, intensity: number) {
  return new THREE.MeshLambertMaterial({ color, emissive: color, emissiveIntensity: intensity })
}

// Paylaşılan birim geometri + scale: her kutu için ayrı BufferGeometry üretilmiyor.
function box(w: number, d: number, h: number, color: number, x: number, y: number, z: number, parent: THREE.Object3D,
             mat?: THREE.Material) {
  const m = new THREE.Mesh(BIRIM_KUTU, mat ?? lam(color))
  m.scale.set(w, d, h)
  m.position.set(x, y, z)
  m.castShadow = true
  m.receiveShadow = true
  parent.add(m)
  return m
}

function cyl(r: number, len: number, color: number, x: number, y: number, z: number, axis: 'x' | 'y' | 'z', parent: THREE.Object3D) {
  // birim silindir (r=1, h=1) → yarıçap XZ'de, uzunluk Y'de ölçeklenir
  const m = new THREE.Mesh(birimSilindir(16), lam(color))
  m.scale.set(r, len, r)
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

/**
 * ÇAM/SERVİ — üç kademeli, gövdeli.
 *
 * Eskisi tek `ConeGeometry(0.5, 1.1, 5)` idi ve izometrik açıdan aşağı bakan bir OK
 * gibi görünüyordu ("ters koni şeklindeki ağaçlar güzel değil" — haklı şikâyet).
 * Üç azalan koni + görünür gövde silüeti ağaca çeviriyor; 5 kenarlı düşük poligon
 * bütçesi korunuyor (kule başına 3 mesh, hepsi instanced çağıranda birleşiyor).
 */
function buildPineProc(scale: number, dark: number, light: number): THREE.Group {
  const g = new THREE.Group()
  cyl(0.075, 0.55, 0x6b4f34, 0, 0, 0.27, 'z', g)
  const tier = (r: number, h: number, z: number, c: number) => {
    const m = new THREE.Mesh(new THREE.ConeGeometry(r, h, 7), lam(c))
    m.rotation.x = -Math.PI / 2
    m.position.z = z
    m.castShadow = true
    g.add(m)
  }
  tier(0.62, 1.05, 0.95, dark)
  tier(0.47, 0.90, 1.55, light)
  tier(0.30, 0.70, 2.10, light)
  g.scale.setScalar(scale)
  return g
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
  private steam: { mesh: THREE.Mesh; offset: number; drift: number; bx: number; by: number; bz: number }[] = []
  private steamT = 0
  /** RÜZGÂR TÜRBİNİ kanatları — update()'te döner. Hız state'ten gelen rüzgâra bağlı;
   *  durgun havada yavaşlar, böylece üretimin değişkenliği EKRANDA da görünür. */
  private blades: { mesh: THREE.Object3D; id: string; eksen?: THREE.Vector3 }[] = []
  windSpin = 1
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
      new THREE.TextureLoader().load(texture(url), t => {
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
      // NEAR yönü ek şeridi KALDIRILDI (Oğuz: "benzinlik otoyola taşmış gibi") —
      // eski tam-boy şerit x 2.6..6.0'a yayılıp istasyon ön sahasının (x≤5.0) ALTINA
      // giriyordu; forecourt asfalta karışıyordu. Yerine aşağıda OTOKORKULUK geldi:
      // istasyon/otoyol sınırı fiziksel olarak okunur, rampalar bağlantıyı taşır.
      // YAN YOL KALDIRILDI (Oğuz): karşı yön ek şeridi x 9.8..13.2'ye taşıp
      // karşı yakadaki CLAIMLENEBİLİR parsellerin (kolon 3, x ≥ 10.9) üstüne biniyordu.
      // OTOKORKULUK: yol ile istasyon arası, kapı penceresi (|y|<13) açık — W-profil ray + dikme
      for (const [y0, y1] of [[-110, -13], [13, 110]] as [number, number][]) {
        const len = y1 - y0
        const rail = new THREE.Mesh(new THREE.BoxGeometry(0.10, len, 0.30), lam(0xb9bec4))
        rail.position.set(5.32, (y0 + y1) / 2, 0.62); s.add(rail)
        const postN = Math.floor(len / 4)
        this.instAt(s, new THREE.BoxGeometry(0.10, 0.10, 0.62), lam(0x8d949c), postN,
          (m, i) => m.setPosition(5.32, y0 + 2 + i * 4, 0.31))
      }
      // orta bariyer (new-jersey): karşıya geçiş fiziksel olarak YOK
      const barrier = new THREE.Mesh(new THREE.BoxGeometry(0.55, 220, 0.85), lam(0xd6d2c6))
      barrier.position.set(ROAD_X, 0, 0.42); s.add(barrier)
      // RAMPA ASFALTLARI KALDIRILDI (Oğuz: "yan yolu kaldıralım") — yavaşlama/
      // hızlanma şeridi görselleri istasyon önünde ikinci bir yol gibi okunuyordu.
      // onRampFull mekaniği (kapasite) DURUYOR; yalnız görsel bant gitti.
      // yüksek direkli aydınlatma (12 m) — otoyol imzası, instanced.
      // x 13.5 claim kolonunda: direkler yalnız |y| > 24'te (parseller açık).
      const HPOLE_Y = [-88, -66, -44, 44, 66, 88]
      const poles = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.13, 0.16, 11, 8), lam(0x6a7078), HPOLE_Y.length)
      const pm = new THREE.Matrix4()
      for (let i = 0; i < HPOLE_Y.length; i++) {
        pm.makeRotationX(Math.PI / 2)
        pm.setPosition(ROAD_X + 5.6, HPOLE_Y[i], 5.5)
        poles.setMatrixAt(i, pm)
      }
      poles.instanceMatrix.needsUpdate = true; s.add(poles)
      // GÜRÜLTÜ BARİYERİ — eskiden 220 birim uzunluğunda TEK gri kütleydi (0.4×220×3.2)
      // ve karşı yakayı boydan boya kapatan bir duvar gibi okunuyordu. Şimdi panelli:
      // 2.35 yükseklik (K2 sınırının altı), panel aralarında dikme, hafif renk kırılması.
      // Otoyol imzası duruyor, manzara duvarı gitti.
      // CLAIM PENCERESİ (Oğuz): x 15.3 karşı yakadaki 3. kolonun içi — paneller yalnız
      // |y| > 24'te; 9 parsellik bant tamamen açık kalır.
      const PANEL = [0xa6adb4, 0x9aa1a9, 0xb0b7bd]
      const PANEL_Y: number[] = []
      for (let y = -110; y <= 110; y += 5) if (Math.abs(y) > 24) PANEL_Y.push(y)
      this.instAt(s, new THREE.BoxGeometry(0.26, 4.6, 2.35), lam(0xffffff), PANEL_Y.length,
        (m, i) => m.setPosition(ROAD_X + 7.4, PANEL_Y[i], 1.18), PANEL)
      this.instAt(s, new THREE.BoxGeometry(0.40, 0.30, 2.55), lam(0x767d85), PANEL_Y.length,
        (m, i) => m.setPosition(ROAD_X + 7.4, PANEL_Y[i] - 2.5, 1.28))
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
      // ---- TRAFİK IŞIĞI: yalnız temada TANIMLIYSA çizilir (Oğuz: ışıklar kaldırıldı —
      // "dümdüz flow"; direk urban bayrağıyla ışıksız şubede de dikiliyordu) ----
      const tl = th.features.trafficLight
      if (tl) {
        const ly = tl.y
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
      }
      // YAYA ÇİZGİSİ KALDIRILDI (Oğuz: "yolun ortasında dikine çizgi — gereği yok").
      // 7 şerit aynı y'de yan yana dizilince zebra değil tek uzun çizgi görünüyordu;
      // çevre yolundaki gerçek zebra (canvas dokulu) ayrı ve duruyor.
      // ---- KALDIRIM ----
      // KALDIRILDI: buraya 17 adet 5×7×20'lik düz gri kutu koyan "kentsel siluet"
      // vardı. İki hatası birdendi: (1) x 20.9..25.9 aralığı oyuncunun satın
      // alabileceği 3. ve 4. parsel kolonuydu — arsa görsel olarak kapalıydı;
      // (2) karşı yaka kameraya YAKIN taraftır, 20 birimlik kütle ekranın yarısını
      // yiyordu. Yerine `scenery.ts` planları geldi: karşı yaka alçak, yüksek kütle
      // batıda. Kural artık `npm run test:framing` ile ölçülüyor.
      const kerb = new THREE.Mesh(new THREE.PlaneGeometry(1.5, 220), lam(0xc9c5ba))
      kerb.position.set(ROAD_X - 3.1, 0, 0.018); s.add(kerb)
    }

    const lot = new THREE.Mesh(new THREE.PlaneGeometry(11.5, 20), this.concreteMat)
    lot.position.set(-0.75, 0, 0.015)
    lot.receiveShadow = true
    s.add(lot)

    // ---- KARŞI ŞUBE ARSASI (Oğuz: "yolun karşısına şube açılabilecek boşluk olsun,
    // zemin dokusu ASLA benzinlik arsasıyla aynı olmasın — sınırlar belli olsun") ----
    // Kasabadaki çim boşluğun kentsel karşılığı: col-3 parseli (x 10.9..22.4) üzerinde
    // STABİLİZE dokulu, kesikli turuncu çerçeveli "satılık arsa" plakası. Kasaba zaten
    // çim (dokunma), marina su (yok). Oyuncu karşıya pompa kurunca beton bunu örter.
    if (th.lane.kind !== 'water' && th.id !== 'kasaba') {
      const farLotMat = aiGround('/gen/ground_gravel.png', 5.5, 10,
        noiseTex('#c0b296', [['#b3a68c', 800], ['#cbbfa2', 800], ['#a2957b', 300]], 10))
      ;(farLotMat as THREE.MeshLambertMaterial).color = new THREE.Color(0xd9d0ba) // tabandan AÇIK — arsa ayrışır
      const farLot = new THREE.Mesh(new THREE.PlaneGeometry(10.4, 46.5), farLotMat)
      farLot.position.set(17.1, 0, 0.013) // x 11.9..22.3 · y -23.25..23.25 (kanal 11.6'ya taşmaz)
      farLot.receiveShadow = true
      s.add(farLot)
      // kesikli çerçeve (satılık/imar hissi) — instanced, 2 draw call
      const dashMat = lam(0xe0a33c)
      const perSide = 16
      this.instAt(s, new THREE.PlaneGeometry(1.6, 0.16), dashMat, perSide * 2, (m, i) => {
        const k = i % perSide
        m.setPosition(12.4 + k * (9.6 / (perSide - 1)), i < perSide ? -23.1 : 23.1, 0.017)
      })
      this.instAt(s, new THREE.PlaneGeometry(0.16, 1.6), dashMat, perSide * 2, (m, i) => {
        const k = i % perSide
        m.setPosition(i < perSide ? 12.05 : 22.15, -22 + k * (44 / (perSide - 1)), 0.017)
      })
    }
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
    // ASFALT GENİŞLİĞİ ŞERİT SAYISINDAN TÜRER (#1075 "Otoyol eklenmiş ama tek şerit,
    // en az çift şerit olması iyi olur"): eskiden yalnızca 'service' bandı olan temalar
    // (çevre yolu/metropol) geniş çiziliyordu; otoyol lane.count = 3 olmasına rağmen
    // kasaba yoluyla AYNI 4.6 birimlik tek şeritli asfaltı alıyordu.
    const seritSayisi = Math.max(1, th.lane.count ?? 1)
    // 3+ şeritte 6.8 birimde duruyoruz: karşı yaka kapısı FAR_GATE_X = 11.6'da ve
    // asfaltın kenarı (ROAD_X + 3.4 = 11.3) onun altında kalmalı — yoksa kapı pedi
    // asfaltın üstüne biniyor.
    const roadW = th.lane.service ? 6.0 : seritSayisi >= 3 ? 6.8 : seritSayisi === 2 ? 6.0 : 4.6
    if (!isWater) {
      const road = new THREE.Mesh(new THREE.PlaneGeometry(roadW, 220), roadMat)
      road.position.set(ROAD_X, 0, 0.01)
      road.receiveShadow = true
      s.add(road)
      // ARSA ↔ ASFALT BOŞLUĞU (#1030 "2. haritada ortada çimler vs kaldı"): arsa x=5.0'da
      // bitiyor, asfalt tema genişliğine göre başlıyor. Kentsel temalarda arada açıklanamayan
      // ince bir ÇİM ŞERİDİ kalıyordu. Kasabada bu bant BİLEREK duruyor (kır istasyonu
      // imzası); diğerlerinde beton payla kapatılır.
      const asfaltBasi = ROAD_X - roadW / 2
      if (th.id !== 'kasaba' && asfaltBasi > 5.0) {
        const pay = new THREE.Mesh(new THREE.PlaneGeometry(asfaltBasi - 5.0 + 0.12, 220), this.concreteMat)
        pay.position.set((5.0 + asfaltBasi) / 2, 0, 0.014)
        pay.receiveShadow = true
        s.add(pay)
      }
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
      // Yön başına (count-1) ayırıcı: 3 şeritli otoyolda her yönde iki kesikli çizgi.
      const yariGen = roadW / 2, medYari = medW / 2
      const seritGen = (yariGen - medYari) / seritSayisi
      const dashOff: number[] = th.lane.service
        ? [ROAD_X - 2.32, ROAD_X + 2.32]   // 4 şerit: yön başına iki şeridin arası
        : seritSayisi === 1
        ? [ROAD_X - 1.15, ROAD_X + 1.15]   // tek şerit (kasaba görünümü — değişmedi)
        : (() => {
            const o: number[] = []
            for (let i = 1; i < seritSayisi; i++) {
              o.push(ROAD_X - medYari - seritGen * i, ROAD_X + medYari + seritGen * i)
            }
            return o
          })()
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
    const edgeOff = roadW / 2 - 0.14
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

    // KIR DOLGUSU YALNIZ KASABAYA: tarla, bağ, saman balyası ve gölet otoyolun
    // sanayi kuşağında yanlış okunuyordu (ekran görüntülerinde asfaltın yanında
    // üzüm bağı görünüyordu). Otoyolun çevresi artık scenery.ts planından geliyor.
    if (th.id === 'kasaba') this.buildCountryside()
    this.dressForecourt()
    this.setSign(0)
    this.addPump(0)
    // ANA ARAZİ GÜVENCESİ (Oğuz: "ana arazimizin üzerinde ASLA olmamalı") —
    // hangi builder ne serpiştirmiş olursa olsun istasyon lotu (kolon 0, satır 1)
    // dekor içermez. Load'daki markOwned/paveParcel bu lotu atladığı için tek sigorta bu.
    this.clearDecorRect(-6.6, 5.1, -10.3, 10.3)
  }

  /**
   * ŞUBEYE ÖZEL ÖN SAHA (forecourt) DONANIMI
   *
   * Oğuz: "benzinlik yerleşimi bütün hepsinde aynı görünüyor... bu bir tema değişikliği
   * değil, her birini tek tek değiştirmek gerek." Haklı: şubeler arasında YALNIZ zemin
   * rengi ve çevre değişiyordu, istasyonun kendisi bire bir aynıydı.
   *
   * TASARIM KISITI: pompa yuvaları (x=1.8), apronlar (y=±8, −16) ve kapılar (x=4.2)
   * ARAÇ ROTASIDIR. Buraya hacimli nesne konursa trafik kilitlenir. Bu yüzden kural:
   *   · x ∈ [-0.5, 4.0] bandına YALNIZ z ≤ 0.035 yer boyası konur (çarpışma yok),
   *   · hacimli donanım batı şeridine (x ≤ -5.6) ve yol-arsa yeşil bandına (x ≥ 5.1) gider.
   * Böylece her şube görsel olarak ayrışıyor, trafik grafiği tek satır bile değişmiyor.
   */
  private dressForecourt() {
    const s = this.scene
    const id = this.theme.id
    const paint = (w: number, d: number, x: number, y: number, c: number, rot = 0) => {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(w, d), lam(c))
      m.position.set(x, y, 0.032); m.rotation.z = rot; s.add(m)
    }
    const prop = (g: THREE.Object3D, x: number, y: number) => {
      g.position.set(x, y, g.position.z)
      g.traverse(o => { o.castShadow = true })
      s.add(g)
      this.decor.push({ obj: g, x, y })
    }
    const crate = (w: number, d: number, h: number, c: number, x: number, y: number, z: number) => {
      const m = new THREE.Mesh(BIRIM_KUTU, lam(c))   // paylaşılan geometri + scale
      m.scale.set(w, d, h)
      m.position.set(x, y, z); m.castShadow = true
      return m
    }

    if (id === 'otoyol') {
      // TIR ÖLÇEĞİ: geniş manevra boyası, lastik istifi, varil paleti, yükseklik sınırı çubuğu
      // Chevron taraması ANA ARSANIN İÇİNDE kalmalı: ilk sürümde y -19..-10 bandına
      // konmuştu ve oyuncu güney parseli betonlamadan çıplak toprağın üstünde yüzüyordu.
      for (let i = 0; i < 6; i++) paint(2.4, 0.32, 3.10, -8.6 + i * 1.3, 0xe4c24a, Math.PI / 4)
      paint(7.6, 0.16, -2.00, -9.40, 0xe8e4d8)
      const tyres = new THREE.Group()
      for (let i = 0; i < 6; i++) {
        const tr = new THREE.Mesh(new THREE.CylinderGeometry(0.44, 0.44, 0.26, 10), lam(0x22262a))
        tr.rotation.x = Math.PI / 2
        tr.position.set((i % 2) * 0.95, 0, 0.14 + Math.floor(i / 2) * 0.27)
        tyres.add(tr)
      }
      prop(tyres, -6.05, 3.40)
      const pallet = new THREE.Group()
      pallet.add(crate(1.5, 1.1, 0.14, 0xa8875c, 0, 0, 0.07))
      for (let i = 0; i < 4; i++)
        pallet.add(crate(0.34, 0.34, 0.52, i % 2 ? 0xd8a33a : 0x3f6f9e,
          -0.42 + (i % 2) * 0.84, -0.28 + Math.floor(i / 2) * 0.56, 0.40))
      prop(pallet, -6.10, -1.60)
      // yükseklik sınırı çubuğu (otoyol istasyonlarının imzası)
      const gantry = new THREE.Group()
      gantry.add(crate(0.16, 0.16, 4.4, 0xd6d2c6, 0, -1.9, 2.2))
      gantry.add(crate(0.16, 0.16, 4.4, 0xd6d2c6, 0, 1.9, 2.2))
      gantry.add(crate(0.22, 4.0, 0.26, 0xd64545, 0, 0, 4.3))
      // y=-8 apronun tam ağzıydı ve gabari kirişi fiyat tabelasının önünden geçiyordu
      // (dev ekran görüntüsünde görüldü). -13.4 hem tabelayı hem giriş kapısını temizler.
      prop(gantry, 5.35, -13.40)
    } else if (id === 'cevreyolu') {
      // ŞEHİR ÇEPERİ: boyalı park cepleri, çöp kovaları, alçak çit, bisiklet demiri
      for (let i = 0; i < 6; i++) paint(2.3, 0.11, -5.05, 11.2 + i * 1.9, 0xe8e4d8)
      paint(2.4, 11.6, -5.05, 15.9, 0x6f767d)
      for (const [bx, by] of [[-6.15, 6.20], [-6.15, -4.60]] as [number, number][]) {
        const bin = new THREE.Group()
        bin.add(crate(0.46, 0.46, 0.82, 0x3d6b43, 0, 0, 0.41))
        bin.add(crate(0.52, 0.52, 0.08, 0x2c4a30, 0, 0, 0.86))
        prop(bin, bx, by)
      }
      this.instAt(s, new THREE.SphereGeometry(0.36, 7, 5), lam(0x5f8a52), 16,
        (m, i) => m.setPosition(-6.95, -9.0 + i * 1.25, 0.3))
      const rack = new THREE.Group()
      for (let i = 0; i < 4; i++) {
        const u = new THREE.Mesh(new THREE.TorusGeometry(0.28, 0.035, 6, 12, Math.PI), lam(0x8f979e))
        u.rotation.y = Math.PI / 2
        u.position.set(0, -0.7 + i * 0.47, 0.28)
        rack.add(u)
      }
      prop(rack, -5.85, 1.90)
    } else if (id === 'metropol') {
      // SIKIŞIK ŞEHİR: babalar, saksılar, EV yer işareti, arnavut şerit
      this.instAt(s, new THREE.CylinderGeometry(0.09, 0.11, 0.7, 8), lam(0x3c4046), 18, (m, i) => {
        m.makeRotationX(Math.PI / 2); m.setPosition(4.62, -12 + i * 1.5, 0.35)
      })
      for (const [px, py] of [[-6.10, 8.60], [-6.10, 4.20], [-6.10, -0.20], [-6.10, -4.60]] as [number, number][]) {
        const pl = this.statics?.planter ? fitModel(this.statics.planter, 0.9, 'z') : null
        if (pl) prop(pl, px, py)
        else {
          const g = new THREE.Group()
          g.add(crate(0.8, 0.8, 0.36, 0xb9b3a4, 0, 0, 0.18))
          g.add(crate(0.62, 0.62, 0.22, 0x4d7a52, 0, 0, 0.44))
          prop(g, px, py)
        }
      }
      // EV park boyası (yeşil kare + beyaz artı) KALDIRILDI — Oğuz: çıkışın orada
      // anlamsız "üzerinde + olan yeşil bir şey" olarak okunuyordu
      paint(1.10, 22, -6.05, 0, 0x9aa1a9)       // arnavut kaldırım şeridi
    } else if (this.theme.lane.kind === 'water') {
      // MARİNA: ahşap güverte, koç boynuzu, cankurtaran, balık kasası — ASFALT DEĞİL
      // AHŞAP GÜVERTE: yakıt apronunun tamamı. x=3.6'ya konulan ilk sürüm görünmedi —
      // rıhtım kutusu (x 3.1..5.3, z 0.25) üstünü kapatıyordu; ölçüldü ve batıya alındı.
      // Yalnız yer boyası (z=0.030) olduğu için araç/tekne rotasına dokunmuyor.
      const deck = new THREE.Mesh(new THREE.PlaneGeometry(3.5, 30), lam(0xa8875c))
      deck.position.set(1.25, 0, 0.030); s.add(deck)
      this.instAt(s, new THREE.PlaneGeometry(3.46, 0.07), lam(0x8d6f47), 30,
        (m, i) => m.setPosition(1.25, -14.5 + i, 0.033))
      // koç boynuzu (cleat) dizisi
      this.instAt(s, new THREE.BoxGeometry(0.34, 0.12, 0.14), lam(0x2f3338), 10,
        (m, i) => m.setPosition(4.42, -13.5 + i * 3, 0.10))
      // cankurtaran halkası direkleri
      for (const ry of [-9.0, 0.0, 9.0]) {
        const g = new THREE.Group()
        g.add(crate(0.10, 0.10, 1.3, 0xe8e4d8, 0, 0, 0.65))
        const ring = new THREE.Mesh(new THREE.TorusGeometry(0.30, 0.075, 6, 14), lam(0xd64545))
        ring.rotation.y = Math.PI / 2
        ring.position.set(0.04, 0, 1.15)
        g.add(ring)
        prop(g, 5.30, ry)
      }
      // balık kasası istifi ve ağ yığını
      const stack = new THREE.Group()
      for (let i = 0; i < 5; i++)
        stack.add(crate(0.7, 0.5, 0.24, i % 2 ? 0x3f8fa8 : 0xd9d5c9, 0, 0, 0.12 + i * 0.25))
      prop(stack, -6.10, -5.20)
      const net = new THREE.Mesh(new THREE.SphereGeometry(0.55, 8, 6), lam(0x6f7a5c))
      net.scale.set(1, 1, 0.45); net.position.z = 0.24
      prop(net, -6.05, 6.40)
    }
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
    // GÖLET YERLEŞİMİ — ölçüldü, iki çakışma vardı:
    //  · (30,-30) gölet, (34,-34) tarlasının ÇİTİNİN İÇİNDE kalıyordu (oyuncu bildirdi).
    //    Kaldırıldı: o köşede zaten tarla var, gölete gerek yok.
    //  · (-36,30) gölet, (-42,30) bağıyla kesişiyordu (bu henüz görülmemişti).
    //    Kaldırılmadı, bağın dışına taşındı — yoksa haritada hiç gölet kalmıyordu.
    // Dekor kutuları: tarla w×d, bağ ~(satır×2,2)×(sütun×1,2), gölet 2(r+0,5) çapında
    // ve y'de 0,72 basık. Yeni yer eklerken bu kutular kesişmemeli.
    pond(-28, 30, 4)
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
    // karşı yakada kurulan tesis daha ilk karede doğru yöne baksın (pompa/şarj kendi
    // flip'ini zaten hesaplıyor, onları ellemiyoruz)
    if (!id.startsWith('pump-') && !id.startsWith('charger-')
        && (group as THREE.Group).rotation.z === 0 && this.farFlip(group)) {
      (group as THREE.Group).rotation.z = Math.PI
    }
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
      p.mesh.position.set(p.bx + p.drift * t, p.by + p.drift * t * 0.6, p.bz + t * 2.4)
      const sc = 0.55 + t * 1.1
      p.mesh.scale.setScalar(sc)
      ;(p.mesh.material as THREE.MeshLambertMaterial).opacity = 0.7 * (1 - t)
    }
    // kanatlar: dönüş hızı rüzgâra orantılı (state.windFactor → main her karede yazar)
    if (this.blades.length) {
      const w = 2.4 * Math.max(0.12, this.windSpin)
      // EKSEN — OYUNCUNUN TARİFİ BİREBİR: yükseklik z, dönüş DÜNYA Y'sinde (üstten
      // bakışta önceki yanlış eksene 90° dik olan). Yerel eksen TAHMİN EDİLMİYOR:
      // convert() sarmalayıcıları + fitModel yüzünden düğümün yerel çerçevesi iç içe
      // dönüşlerin arkasında — iki kez yanlış tahmin edildi (y: atlıkarınca, z: yine
      // yanlış düzlem). Dünya Y'si kanatların yerel uzayına BİR KEZ çevrilir (henüz
      // hiç dönmemişken) ve saklanır; spin kendi ekseni etrafında olduğu için bu
      // eksen sonsuza dek geçerli kalır. Türbin ry ile döndürülse de doğru.
      for (const b of this.blades) {
        if (!b.eksen) {
          b.mesh.updateWorldMatrix(true, false)
          const q = b.mesh.getWorldQuaternion(new THREE.Quaternion()).invert()
          b.eksen = new THREE.Vector3(0, 1, 0).applyQuaternion(q).normalize()
        }
        b.mesh.rotateOnAxis(b.eksen, w * dt)
      }
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

  /** SİLO TANK — seviye arttıkça YUKARI büyür, TABAN ALANI SABİT KALIR.
   *
   *  NEDEN böyle: yükseltmede tankın çapını büyütmek footprint'i (2.0×2.0, main'deki
   *  footprintOf/hardRects tablosu) taşırdı; komşu binalarla çakışma ve eski save'lerde
   *  "yerleştirilemedi" hatası çıkardı. Bu yüzden yarıçap SABİT, her seviye gövdeye bir
   *  segment ekler: gerçek bir yakıt silosu gibi kuşaklarla üst üste yükselir.
   *
   *  Yakıt gövdenin TOPLAM yüksekliğine göre alttan yukarı dolar; ölçekleme ile yapılır
   *  (kırpma düzlemi DEĞİL) — eski kırpma yöntemi lam() önbelleğindeki PAYLAŞILAN materyale
   *  clippingPlanes yazıyordu, yani aynı renkteki başka nesneler de kırpılma riski taşıyordu.
   *
   *  @param seg gövde segment sayısı (tank seviyesi + 1) */
  private addSiloTank(x: number, y: number, R: number, seg: number, color: number): THREE.Mesh {
    const g = new THREE.Group()
    const hafif = isLightMode()
    const RAD = hafif ? 10 : 20        // mobilde radyal segment yarıya iner (fill+kabuk+çatı×3 tank)
    const SEG_H = 0.58                 // bir stack'in yüksekliği
    const TABAN_Z = 0.16               // beton kaide
    const H = SEG_H * seg              // gövdenin toplam yüksekliği
    const METAL = 0x9aa3ab, KOYU = 0x6d757c
    // paylaşılan birim silindir + scale (ayrı BufferGeometry üretilmez)
    const sil = (r: number, h: number, z: number, mat: THREE.Material, rad = RAD) => {
      const m = new THREE.Mesh(birimSilindir(rad), mat)
      m.scale.set(r, h, r)
      m.rotation.x = Math.PI / 2
      m.position.z = z
      m.castShadow = true
      g.add(m)
      return m
    }
    // 1) kaide: silo yere basıyor görünsün (eski küre tankın 4 ayağı yerine)
    sil(R * 1.16, TABAN_Z, TABAN_Z / 2, lam(KOYU), 12)
    // 2) saydam gövde NÖTR CAM RENGİ: yakıt rengini kabuğa vermek dolu/boş farkını
    //    yutuyordu (her silo baştan aşağı renkli görünüyordu). Kabuk cam, içindeki sıvı
    //    renkli → seviye tek bakışta okunuyor. Hangi yakıt olduğunu çatı+kuşak rengi söyler.
    sil(R, H, TABAN_Z + H / 2, saydam(0xdde3e8))
    // 3) yakıt: opak iç silindir, updateTankFill ile alttan yukarı ölçeklenir
    const fillR = R * 0.88
    const fill = sil(fillR, 0.001, TABAN_Z, lam(color))
    fill.userData = { fillR, baseZ: TABAN_Z + 0.02, bodyH: H - 0.04 }
    // 4) KUŞAKLAR: her segment ekinde ince bir ring — "kaç seviye" gözle sayılabilir olsun
    for (let i = 0; i <= seg; i++) {
      const kalin = i === 0 || i === seg      // alt/üst kuşak biraz daha belirgin
      sil(R * (kalin ? 1.1 : 1.07), kalin ? 0.1 : 0.07, TABAN_Z + i * SEG_H,
        lam(i === seg ? color : kalin ? KOYU : METAL), 12)
    }
    // 5) konik çatı + havalandırma borusu — silo siluetini tamamlar; çatı yakıt renginde
    //    (cam gövde nötr olduğu için yakıt kimliğini buradan okuyoruz)
    const cati = new THREE.Mesh(birimKoni(RAD), lam(color))
    cati.scale.set(R * 1.1, 0.34, R * 1.1)
    cati.rotation.x = Math.PI / 2
    cati.position.z = TABAN_Z + H + 0.17
    cati.castShadow = true
    g.add(cati)
    cyl(0.05, 0.3, METAL, 0, 0, TABAN_Z + H + 0.48, 'z', g)
    // 6) yan merdiven: ölçek hissi verir (mobilde atlanır — 3 tank × ~10 mesh eder)
    if (!hafif) {
      for (const sy of [-0.1, 0.1]) cyl(0.022, H, KOYU, -R * 1.02, sy, TABAN_Z + H / 2, 'z', g)
      for (let z = TABAN_Z + 0.25; z < TABAN_Z + H; z += 0.3) cyl(0.016, 0.2, KOYU, -R * 1.02, 0, z, 'y', g)
    }
    g.position.set(x, y, 0)
    this.tankGroup.add(g)
    return fill
  }

  /** KONUMLAR CANLI/main ile BİREBİR (üçgen dizilim, sabit R) → footprint 2.0×2.0 aynı kalır,
   *  eski save'lerle çakışma çıkmaz. Seviye YALNIZCA yüksekliği (segment sayısını) değiştirir. */
  buildTankCluster(level: number) {
    this.tankLevelNow = level
    this.tankFillMeshes = { benzin: [], dizel: [], lpg: [] }
    for (const ch of [...this.tankGroup.children]) {
      if (!(ch as THREE.Sprite).isSprite) this.tankGroup.remove(ch)
    }
    this.tankGroup.position.set(this.tankAnchor.x, this.tankAnchor.y, 0)
    // R SABİT: en geniş parça (kaide, R*1.16) ile en uzak konum toplandığında bile
    // 2.0 birimlik footprint aşılmaz → yerleşim/çakışma sistemi hiç etkilenmez.
    const R = 0.42
    const seg = Math.max(1, Math.min(4, level + 1))   // Sv.0 → 1 stack, her seviye +1 (state'te yeni alan YOK)
    const colors: Record<FuelType, number> = { benzin: 0x27a05a, dizel: 0xe8862e, lpg: 0x2f6fed }
    // 3 yakıt HER ZAMAN görünür (benzin/dizel/lpg) — üçgen dizilim, her biri kendi doluluk seviyesini gösterir.
    // Konumlar [0..0.9] aralığında kaldığı için footprint (4 hücre) + taşıma çapası (moveTank) BİREBİR korunur.
    const layout: [FuelType, number, number][] = [
      ['dizel', 0, 0.9],     // arka-sol
      ['lpg', 0.9, 0.9],     // arka-sağ
      ['benzin', 0.45, 0],   // ön-orta
    ]
    for (const [f, x, y] of layout) {
      const fill = this.addSiloTank(x, y, R, seg, colors[f])
      this.tankFillMeshes[f].push(fill)
    }
  }

  /** Her yakıtın doluluk oranıyla (0..1) sıvı seviyesini alttan yukarı ayarlar.
   *  ARAYÜZ DEĞİŞMEDİ; seviye artık silonun TOPLAM yüksekliğine oranlanır. */
  updateTankFill(ratios: Record<FuelType, number>) {
    for (const f of ['benzin', 'dizel', 'lpg'] as FuelType[]) {
      const r = Math.max(0, Math.min(1, ratios[f] || 0))
      for (const m of this.tankFillMeshes[f]) {
        const ud = m.userData as { fillR: number; baseZ: number; bodyH: number }
        if (!ud?.bodyH) continue
        const h = Math.max(0.001, ud.bodyH * r)
        m.scale.set(ud.fillR, h, ud.fillR)   // silindir ekseni Y; rotation.x ile dünya Z'sine bakar
        m.position.z = ud.baseZ + h / 2
        m.visible = r > 0.004
      }
    }
  }

  /** tank kümesini taşı (merkezden çapaya çevirir) */
  moveTank(center: THREE.Vector2) {
    this.tankAnchor.set(center.x - 0.45, center.y - 0.45)
    this.buildTankCluster(this.tankLevelNow)
  }

  /** CLAIMLENEBİLİR PARSEL YEŞİLİ (Oğuz: "arsaların üstüne bina değil ağaç falan koy") —
   *  her ağaç placeTree → decor'a girer, arsa betonlanınca otomatik silinir.
   *  Koordinatlar iki yakaya dağılı; yol koridoru (x 4..11.6) ve istasyon lotu boş. */
  private parcelGreen() {
    const PTS: [number, number, number][] = [
      // BATI yakası parselleri (x -29..-8)
      [-9.5, -18, 1.1], [-14.5, -13, 0.9], [-21, -19.5, 1.2], [-26.5, -6, 1.0],
      [-13, 6.5, 1.1], [-22.5, 12, 0.9], [-9, 21, 1.0], [-17.5, 21.5, 1.2], [-27, 19, 0.9],
      [-25, 2, 1.1], [-11, -5, 0.9],
      // DOĞU yakası parselleri (x 12.5..40) — şube arsası (kolon 3) kenarları seyrek
      [13.5, -20.5, 1.0], [21, -14, 0.9], [25.5, -20.5, 1.0], [31.5, -9, 1.1],
      [37.5, -17, 1.0], [14, 9, 0.9], [20.5, 16.5, 0.9], [27.5, 6, 1.2],
      [33.5, 17, 1.0], [39.5, 3, 0.9], [25, 21.5, 1.1], [36, 21, 0.9],
    ]
    for (const [x, y, k] of PTS) this.placeTree(x, y, k)
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
        // dışa determinist dalgalanma — DOĞU segmentinde sıfır (düz rıhtım).
        // Oğuz: "ada fazla düzgün" → genlik büyüdü + üç harmonik: loblar ve girinti
        // hissi (dalgalanma hep DIŞA doğru — kıyıdaki rıhtım/ağaç/kaya yerleşimi bozulmaz)
        const east = px > X1 - 1.5
        const w = east ? 0
          : Math.max(0, 2.1 * (0.5 + 0.5 * Math.sin(2 * t + 0.8)) * (0.40 + 0.60 * Math.sin(5 * t + 2.1))
              + 1.3 * Math.pow(Math.max(0, Math.sin(9 * t + 4.2)), 2)
              + 0.5 * Math.sin(13 * t + 0.5))
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

    // ---- 2b) UYDU ADACIKLAR (Oğuz: referans görsel — takımada hissi) ----
    // Parsel bandının ve seyir şeritlerinin DIŞINDA, salt dekor.
    const islet = (cx: number, cy: number, r: number, seed: number) => {
      const poly = (off: number): THREE.Vector2[] => {
        const pts: THREE.Vector2[] = []
        for (let i = 0; i < 26; i++) {
          const t = (i / 26) * Math.PI * 2
          const w = 1 + 0.34 * Math.sin(3 * t + seed) + 0.18 * Math.sin(7 * t + seed * 2.3)
          pts.push(new THREE.Vector2(cx + Math.cos(t) * (r * w + off), cy + Math.sin(t) * (r * w + off)))
        }
        return pts
      }
      const ring = (off: number, color: number, z: number, opacity = 1) => {
        const mat = opacity < 1
          ? new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false })
          : lam2(color)
        const m = new THREE.Mesh(new THREE.ShapeGeometry(new THREE.Shape(poly(off))), mat)
        m.position.z = z; s.add(m)
      }
      ring(2.0, 0x5fb9cf, 0.006, 0.50)  // sığlık
      ring(0.7, 0xd9c9a2, 0.010)        // kum
      ring(0, 0x7fa85f, 0.014)          // çim
      this.placeTree(cx + 0.6, cy - 0.4, 0.9)
      if (r > 2) this.placeTree(cx - 0.9, cy + 0.7, 1.1)
    }
    islet(-28.0, -33.5, 2.6, 1.7)
    islet(-25.5, 35.5, 1.9, 4.1)

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

    // ---- 4) SEYİR KANALI ŞAMANDIRALARI: kırmızı iskele / yeşil sancak ----
    // Eskiden 6+6 = 12 şamandıra vardı ve 1.4 birim boyla yarım araba büyüklüğündeydi;
    // kanal şamandıra ormanına dönüşüyordu. Şimdi 4+4, 0.95 birim: kanalı işaretler,
    // manzarayı kapatmaz.
    const buoyAt = (name: string, x: number, ys: number[], fallback: number) => {
      const proto = K?.[name]
      for (const y of ys) {
        if (proto) { const g = fitModel(proto, 0.95, 'z'); g.position.set(x, y, 0); s.add(g) }
        else {
          const c = new THREE.Mesh(new THREE.ConeGeometry(0.28, 1.0, 7), lam2(fallback))
          c.rotation.x = -Math.PI / 2; c.position.set(x, y, 0.5); s.add(c)
        }
      }
    }
    // kırmızı sıra 10.4: YANAŞMA bölgesinin dış sınırı (trafik giremez);
    // yeşil sıra 17.8: gelen (15.2) / çıkan (20.4) şeritlerinin ORTA ayırıcısı
    buoyAt('buoy', 10.40, [-19, -6, 7, 20], 0xd44b4b)
    buoyAt('buoy-flag', 17.80, [-14, -1, 12, 25], 0x3fae5f)

    // ---- 5) MİSAFİR PONTONLARI + ANA PONTON + DALGAKIRAN ----
    // Pontonlar ana iskelenin (23.2) KISA parmakları — batı ucu 21.7, çıkış
    // şeridi (20.4) temiz kalır
    inst(new THREE.BoxGeometry(3.2, 1.1, 0.26), lam2(0xa8875c), 5,
      (m, i) => m.setPosition(23.30, -16 + i * 8, 0.13))
    const main = new THREE.Mesh(new THREE.BoxGeometry(1.20, 40, 0.30), lam2(0x9b7f56))
    main.position.set(23.20, 0, 0.15); main.castShadow = true; s.add(main)
    const mole = new THREE.Mesh(new THREE.BoxGeometry(1.80, 44, 1.60), lam2(0x8d8577))
    mole.position.set(25.60, 0, 0.80); mole.castShadow = true; s.add(mole)
    for (const [my, col] of [[-22.5, 0xd44b4b], [22.5, 0x3fae5f]] as [number, number][]) {
      const l = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.36, 2.2, 8), lam2(col))
      l.rotation.x = Math.PI / 2; l.position.set(25.60, my, 2.4); s.add(l)
    }

    // ---- 6) LİMAN DOKUSU + ADA DEKORU (plan: scenery.ts MARINA_PLAN) ----
    this.placePlan(SCENE_PLANS.marina, s)
    // denize indirme rampası (kit modeli yoksa da olsun diye elle)
    const slip = new THREE.Mesh(new THREE.BoxGeometry(3.2, 4.6, 0.10), lam2(0xb8b2a4))
    slip.position.set(3.10, -21.60, 0.06); s.add(slip)

    // ---- 7) ADAYI YAŞATAN DETAY ----
    // Ada 26×50 birimlik boş yeşil bir lekeydi. Oğuz'un kısıtı gereği ÜSTÜNE
    // YERLEŞİLEBİLİR YAPI KONMUYOR; onun yerine peyzaj: sahil patikası, kayalık,
    // çam kuşağı, güney burnunda fener. Hepsi dekor, hiçbiri parsel yemiyor.

    // sahil patikası — adanın batı kavsini takip eden açık renkli şerit
    const pathPts: THREE.Vector2[] = []
    for (let i = 0; i <= 26; i++) {
      const t = -1 + (i / 26) * 2               // -1..1
      const yy = t * 21.5
      const xx = -17.6 + 6.2 * (1 - t * t) * 0.55
      pathPts.push(new THREE.Vector2(xx, yy))
    }
    const pathGeo = new THREE.BufferGeometry()
    {
      const verts: number[] = []
      for (let i = 0; i < pathPts.length - 1; i++) {
        const a0 = pathPts[i], a1 = pathPts[i + 1]
        const dx = a1.x - a0.x, dy = a1.y - a0.y
        const L = Math.hypot(dx, dy) || 1
        const nx = (-dy / L) * 0.55, ny = (dx / L) * 0.55
        verts.push(a0.x + nx, a0.y + ny, 0.016, a0.x - nx, a0.y - ny, 0.016, a1.x + nx, a1.y + ny, 0.016)
        verts.push(a1.x + nx, a1.y + ny, 0.016, a0.x - nx, a0.y - ny, 0.016, a1.x - nx, a1.y - ny, 0.016)
      }
      pathGeo.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3))
      // NORMAL ZORUNLU: normalsiz geometri Lambert altında SİYAH çıkıyor ve ekranın
      // yarısını yutuyordu (ilk denemede marina sahnesi kapkara oldu).
      pathGeo.computeVertexNormals()
    }
    const pathMesh = new THREE.Mesh(pathGeo, lam2(0xd8cdb2))
    s.add(pathMesh)

    // kayalık kuşak — ada kenarını yumuşatır (satın alınamayan şeritte)
    inst(new THREE.IcosahedronGeometry(0.55, 0), lam2(0x8e8878), 16, (m, i) => {
      const t = (i / 16) * Math.PI * 2
      const k = 0.7 + 0.5 * ((i * 7) % 3) / 2
      m.makeScale(k, k, k * 0.65)
      m.setPosition(-19.4 + Math.cos(t * 2.3) * 1.9, -23 + i * 2.95, 0.24 * k)
    })

    // ÇAM KUŞAĞI: adanın kuzey ve batı kavsinde, düzgün üç kademeli çam
    const pines: [number, number, number][] = []
    for (let i = 0; i < 11; i++) {
      const t = i / 10
      pines.push([-18.2 + Math.sin(t * 3.4) * 1.6, -20 + i * 4.0, 1.05 + (i % 3) * 0.14])
    }
    for (let i = 0; i < 5; i++) pines.push([-12.0 + i * 2.4, 22.4 - (i % 2) * 1.3, 0.95])
    this.pineBelt(s, pines, 0x3c6b48, 0x4e8455)

    // ada çalıları — çimin dokusunu kırar (tek instanced küre kümesi)
    inst(new THREE.SphereGeometry(0.5, 7, 5), lam2(0x5e8a52), 18, (m, i) => {
      const t = (i * 2.399)
      m.setPosition(-14.5 + Math.cos(t) * 4.4, -16 + i * 1.85, 0.4)
    })

    // ---- ARKA İKMAL RIHTIMI (Oğuz): tanker gemisi adanın arkasına yanaşır ----
    const quay = new THREE.Mesh(new THREE.BoxGeometry(11.0, 2.0, 0.5), lam2(0x8d8577))
    quay.position.set(-7.0, -25.40, 0.25); quay.castShadow = true; s.add(quay)
    // babalar (gemi bağlama)
    inst(new THREE.CylinderGeometry(0.11, 0.13, 0.5, 8), lam2(0x2f3438), 6, (m, i) => {
      m.makeRotationX(Math.PI / 2); m.setPosition(-11.6 + i * 1.9, -26.10, 0.55)
    })
    // kıyıya inen ikmal borusu + vana — yakıt buradan tanklara akar
    const pipe = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.15, 3.4, 10), lam2(0xb3402f))
    pipe.position.set(-7.0, -23.3, 0.32); s.add(pipe) // eksen +y (kıyıya dik)
    const valve = new THREE.Mesh(new THREE.SphereGeometry(0.28, 10, 8), lam2(0xd6d2c6))
    valve.position.set(-7.0, -21.6, 0.42); s.add(valve)

    // ---- ADA HAVASI (Oğuz) ----
    // KUMSAL DAİRELERİ KALDIRILDI: çim düzlemiyle z-fight yapıp zoom'da
    // "varla yok arası" titriyorlardı (Oğuz ekran görüntüsüyle işaretledi).
    // Ada havasını ağaçlar + kıyı çizgisi + fener taşıyor.
    // ada ağaçları — placeTree → decor: parsel claim'lenirse otomatik silinir
    const ISLAND_TREES: [number, number, number][] = [
      [-12.0, -19.0, 1.0], [-16.0, -9.0, 1.2], [-11.0, -3.0, 0.9], [-17.0, 3.0, 1.0],
      [-10.5, 10.0, 1.1], [-13.0, 19.5, 0.9], [-18.0, -15.5, 0.9], [-9.0, -11.0, 1.0],
      [-9.5, 16.0, 0.9], [-15.5, 9.5, 1.1],
    ]
    for (const [tx, ty, tk] of ISLAND_TREES) this.placeTree(tx, ty, tk)

    // GÜNEY BURNU FENERİ: adanın tek dikey aksanı (h 5.2 — istasyonu örtmez, K3 içi)
    const twr = new THREE.Group()
    const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.62, 0.86, 4.2, 10), lam2(0xf0ece2))
    shaft.rotation.x = Math.PI / 2; shaft.position.z = 2.1; shaft.castShadow = true; twr.add(shaft)
    const band = new THREE.Mesh(new THREE.CylinderGeometry(0.66, 0.72, 0.9, 10), lam2(0xd44b4b))
    band.rotation.x = Math.PI / 2; band.position.z = 2.55; twr.add(band)
    const lampMat = glow(0xfff3c4, 0.08)
    const gallery = new THREE.Mesh(new THREE.CylinderGeometry(0.48, 0.48, 0.75, 10), lampMat)
    gallery.rotation.x = Math.PI / 2; gallery.position.z = 4.6; twr.add(gallery)
    const cap = new THREE.Mesh(new THREE.ConeGeometry(0.56, 0.7, 10), lam2(0x3c4046))
    cap.rotation.x = -Math.PI / 2; cap.position.z = 5.3; twr.add(cap)
    // Konum ÖLÇÜLDÜ: (-14.6,-22.2) varsayılan zoom'da ekranın üstünde kalıyordu
    // (sy ≈ 15 > 13). Kuzeybatı kıyısı hem görünür hem fener için doğru yer.
    twr.position.set(-15.00, 17.00, 0)
    s.add(twr)
    // fener CLAIMLENEBİLİR parselde (kolon 1, satır 2) — arsa betonlanırsa kalkar
    this.decor.push({ obj: twr, x: -15.00, y: 17.00 })
    this.nightMats.push({ mat: lampMat, day: 0.08, night: 1.6, owner: 'lighthouse' })
    const fl = new THREE.PointLight(0xffe6b0, 0, 22, 1.6)
    fl.position.set(-15.00, 17.00, 4.6); s.add(fl)
    this.nightLights.push(fl)
  }

  /**
   * PLANDAN YERLEŞTİRİCİ — üç kara şubesinin ortak omurgası.
   *
   * Yerleşim artık `scenery.ts` içinde VERİ. Buradaki iş yalnız o veriyi sahneye
   * dökmek: modeli ölçekle, döndür, koy; `parcel: true` olanları `decor`'a kaydet ki
   * oyuncu o arsayı betonlayınca bina gerçekten kalksın (kasabadaki ağaç/taş ile aynı
   * mekanizma). Kit inmediyse hiçbir şey konmaz ama sahne yine kurulur.
   *
   * @returns yerleşen model sayısı (0 ise çağıran yedek siluete düşer)
   */
  private placePlan(plan: Placement[], s: THREE.Scene): number {
    const K = this.kit
    if (!K) return 0
    let n = 0
    for (const p of plan) {
      const proto = K[p.model]
      if (!proto) continue
      const g = fitModel(proto, p.h, p.axis ?? 'z')
      g.position.set(p.x, p.y, 0)
      g.rotation.z = p.rot ?? 0
      s.add(g)
      if (p.parcel) this.decor.push({ obj: g, x: p.x, y: p.y })
      n++
    }
    return n
  }

  /** instanced yardımcı — üç sahnede de aynı kalıp (draw call disiplini) */
  private instAt(s: THREE.Scene, geo: THREE.BufferGeometry, mat: THREE.Material, n: number,
                 place: (m: THREE.Matrix4, i: number) => void, colors?: number[]) {
    if (n <= 0) return
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

  /**
   * ÇAM KUŞAĞI — instanced. `buildPineProc` geometrisini bir kez üretip N kez basar.
   * Ağaçlar parsel bandındaysa `decor`'a girmez (instanced tek nesne; tek tek
   * silinemez) — bu yüzden çağıranlar ağaçları HER ZAMAN parsel dışına koyar.
   */
  private pineBelt(s: THREE.Scene, pts: [number, number, number][], dark = 0x3f6f4a, light = 0x548a58) {
    if (!pts.length) return
    // ÖNCE KENNEY AĞACI: `city/suburban/tree-large` her şubede zaten yüklü ve gövdesiyle
    // tepesiyle düzgün duruyor. Prosedürel çam yalnız o model inmediyse devreye girer.
    // (İlk denemede prosedürel kademeli koni kullanıldı; kademeler arası boşluk
    // "uçan tabak" gibi görünüyordu — ekran görüntüsüyle görüldü ve terk edildi.)
    const proto = this.statics?.treeLarge
      ? fitModel(this.statics.treeLarge, 2.5, 'z')
      : buildPineProc(1, dark, light)
    proto.updateMatrixWorld(true)
    // Mesh'in YEREL dönüşümü (koni -90° X + z ötelemesi) geometriye PİŞİRİLİR.
    // Pişirilmezse instanced kopyalarda koniler yana yatıyor — ilk denemede oldu.
    const parts: { g: THREE.BufferGeometry; m: THREE.Material }[] = []
    proto.traverse(o => {
      const me = o as THREE.Mesh
      if (!me.isMesh) return
      const g = me.geometry.clone()
      g.applyMatrix4(me.matrixWorld)
      parts.push({ g, m: me.material as THREE.Material })
    })
    const m4 = new THREE.Matrix4()
    for (const { g, m } of parts) {
      const im = new THREE.InstancedMesh(g, m, pts.length)
      pts.forEach(([x, y, k], i) => {
        m4.makeScale(k, k, k)
        m4.setPosition(x, y, 0)
        im.setMatrixAt(i, m4)
      })
      im.instanceMatrix.needsUpdate = true
      im.castShadow = true
      s.add(im)
    }
  }

  /** OTOYOL — ağır sanayi kuşağı (plan: scenery.ts OTOYOL_PLAN) */
  private buildIndustrialDistrict(s: THREE.Scene) {
    const lam2 = (c: number) => new THREE.MeshLambertMaterial({ color: c })
    this.placePlan(SCENE_PLANS.otoyol, s)

    // TIR PARKI KALDIRILDI (Oğuz: "konteynere benzeyen yapılar kalkabilir") —
    // dorse kutuları (turuncu/mavi, 5.6×2.1) ekranda konteyner istifi gibi okunuyordu.
    // Batı sırtı artık çam kuşağı + santral silüetine kalıyor.

    // KONTEYNER İSTİFİ KALDIRILDI (Oğuz: "konteynere benzeyen yapılar kalkabilir") —
    // 8'li istif x 23.4..26.4'te karşı şube arsasının komşu parseline oturuyordu.
    // Kantar güney kenara alındı (|y| > 26): karşı yaka ŞUBE ARSASI artık tamamen boş.
    const scalePad = new THREE.Mesh(new THREE.PlaneGeometry(3.6, 9.0), lam2(0x4a5057))
    scalePad.position.set(14.60, -31.50, 0.018); s.add(scalePad)
    const hut = new THREE.Mesh(new THREE.BoxGeometry(1.6, 2.0, 2.2), lam2(0xd9d5c9))
    hut.position.set(17.20, -31.50, 1.10); hut.castShadow = true; s.add(hut)

    // ---- YOL İMZASI: yüksek direkler — YALNIZ parsel bandı dışında (|y| ≥ 26).
    // x 12.8 claimlenebilir 3. kolonun içinde; direk arsanın ortasından çıkmasın.
    const POLE_Y = [-52, -39, -26, 26, 39, 52]
    this.instAt(s, new THREE.CylinderGeometry(0.13, 0.16, 11, 8), lam2(0x6a7078), POLE_Y.length, (m, i) => {
      m.makeRotationX(Math.PI / 2); m.setPosition(12.80, POLE_Y[i], 5.5)
    })
    this.instAt(s, new THREE.BoxGeometry(1.60, 0.35, 0.22), lam2(0x8d949c), POLE_Y.length,
      (m, i) => m.setPosition(11.90, POLE_Y[i], 10.60))
    const BOLL_Y: number[] = []
    for (let y = -46; y <= 70; y += 4) if (Math.abs(y) > 24) BOLL_Y.push(y)
    this.instAt(s, new THREE.BoxGeometry(0.12, 0.12, 0.75), lam2(0xb9bec4), BOLL_Y.length,
      (m, i) => m.setPosition(12.20, BOLL_Y[i], 0.38))
    // REFÜJ ÇALISI KALDIRILDI (Oğuz ekranıyla): x=3.6 istasyon LOTUNUN içiydi —
    // arsa genişleyince çalı sırası benzinliğin ortasında kalıyordu.
    this.parcelGreen()

    // ---- ÇAM KUŞAĞI: yol boyu, parsel bandının DIŞINDA (|y| > 25) ----
    const pines: [number, number, number][] = []
    for (let i = 0; i < 9; i++) pines.push([13.40 + (i % 2) * 1.1, -27 - i * 3.1, 0.95 + (i % 3) * 0.12])
    for (let i = 0; i < 9; i++) pines.push([13.40 + (i % 2) * 1.1, 27 + i * 3.1, 0.95 + (i % 3) * 0.12])
    this.pineBelt(s, pines, 0x4a6d47, 0x5f8a52)
  }

  /** METROPOL — ticari merkez (plan: scenery.ts METROPOL_PLAN)
   *
   *  Batı duvarı yüksek ve camlı (ekranın SAĞI, derinlikte geri → istasyonu örtmez);
   *  karşı yaka bilinçli olarak zemin kat: alçak dükkân sırası + otopark + tente.
   *  Eski 5×5×13.5 gri kutu siluetinin yerini bu ikili aldı.
   */
  private buildCommercialDistrict(s: THREE.Scene) {
    const K = this.kit
    const lam2 = (c: number) => new THREE.MeshLambertMaterial({ color: c })
    const placed = this.placePlan(SCENE_PLANS.metropol, s)
    if (placed === 0) { this.buildBlockSkyline(s); return }

    // ---- SOKAK DOKUSU: metropolün çevre yolundan asıl ayrıştığı yer ----
    const strip = (w: number, d: number, x: number, y: number, c: number, z = 0.02) => {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(w, d), lam2(c))
      m.position.set(x, y, z); s.add(m)
    }
    // BATI YAYA SOKAĞI + ARA SOKAK + KARŞI YAKA OTOPARKI KALDIRILDI (Oğuz):
    // hepsi claimlenebilir parsellerin (x -29.5..45.4, |y| ≤ 24) üstüne boya basıyordu.
    // Kule duvarı x ≤ -31'e taşındı; dükkânlar ve önü kuzey/güney bantlarında.
    strip(9.20, 1.9, 21.00, -26.25, 0x4a5057)  // güney bandı dükkân önü otoparkı
    // (kuzey bandı dükkânları kaldırıldı — kameranın önü açık; otoparkı da yok)
    const k = new THREE.Mesh(new THREE.BoxGeometry(0.12, 54, 0.10), lam2(0xc9c5ba))
    k.position.set(-6.62, 0, 0.05); s.add(k)   // istasyon lotu batı bordürü
    // otopark çizgileri (güney bandında, dikey)
    this.instAt(s, new THREE.PlaneGeometry(0.10, 1.9), lam2(0xe8e4d8), 8,
      (m, i) => m.setPosition(17.20 + i * 1.25, -26.25, 0.021))
    this.parcelGreen()

    // ---- ŞEMSİYE ve TENTE: tek tek GLB yerine instanced ----
    const instFrom = (proto: THREE.Group | null | undefined, h: number,
                      pts: [number, number][], zOff = 0) => {
      if (!proto || !pts.length) return
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
      s.add(im)
    }
    // Şemsiyeler GÜNEY dükkân önlerinde (kuzey = kameranın önü, boş)
    instFrom(K?.['detail-parasol-a'], 1.15,
      [[14.5, -26.6], [21.0, -26.6], [27.5, -26.6], [34.0, -26.6]] as [number, number][])
    // Tente batı kule duvarının (x ≤ -31) doğuya bakan cephesinde
    instFrom(K?.['detail-awning'], 1.1,
      [-21.5, -17.5, -15.0, -11.2, -5.5, 0.6, 2.4, 7.2, 9.8, 14.0, 16.0, 20.6, 23.4]
        .map(y => [-30.70, y] as [number, number]), 1.2)

    // ---- SOKAK AĞACI: kaldırımda, parsel dışı bantlarda ----
    const pines: [number, number, number][] = []
    for (let i = 0; i < 7; i++) pines.push([12.30, -26.5 - i * 3.4, 0.85])
    for (let i = 0; i < 7; i++) pines.push([12.30, 26.5 + i * 3.4, 0.85])
    this.pineBelt(s, pines, 0x3d6b43, 0x4f8250)
  }

  /** ÇEVRE YOLU — SANAYİ SİTESİ ÇEPERİ (plan: scenery.ts CEVREYOLU_PLAN)
   *
   *  Oğuz'un tarifi: çevre yolu kenarına endüstri kitinden serpiştirilmiş küçük
   *  yapılar. Otoyol da aynı kiti kullanır ama ÖLÇEK ayrıştırır: orada 16 birimlik
   *  baca ve santral, burada 4-6 birimlik atölye sırası. Aynı paket, başka şehir.
   *
   *  Yaya altyapısı çevre yolunun imzası: kaldırım, zebra, bariyer, otobüs durağı.
   */
  private buildRingRoadDistrict(s: THREE.Scene) {
    const K = this.kit
    const lam2 = (c: number) => new THREE.MeshLambertMaterial({ color: c })
    this.placePlan(SCENE_PLANS.cevreyolu, s)

    // KARŞI-YAKA ALTYAPI GRUBU (Oğuz ekranı: claim'li arsada bariyer kalıyordu):
    // kaldırım + yaya bariyeri col-3 arsasının içinde — karşı yakadan İLK arsa
    // alınır alınmaz grup KOMPLE kalkar (instanced'lar tek tek silinemez).
    const farInfra = new THREE.Group()
    s.add(farInfra)
    this.farSideInfra = farInfra
    // kaldırım (yol koridorunun DIŞINDA: x ≥ 11.9)
    const walk = new THREE.Mesh(new THREE.PlaneGeometry(1.70, 120), lam2(0xc9c5ba))
    walk.position.set(12.10, 0, 0.019); farInfra.add(walk)
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
    // zebra hizası AÇIK + karşı şube kapı penceresi (|y| < 13) AÇIK — 2. şube alınınca
    // tekne/araç girişi bariyere çarpmasın
    for (let y = -40; y <= 40; y += 1.35) if ((y < -24.6 || y > -20.2) && Math.abs(y) > 13) railY.push(y)
    this.instAt(farInfra as unknown as THREE.Scene, new THREE.CylinderGeometry(0.045, 0.045, 0.95, 6), lam2(0xb9bec4), railY.length, (m, i) => {
      m.makeRotationX(Math.PI / 2); m.setPosition(11.76, railY[i], 0.48)
    })
    this.instAt(farInfra as unknown as THREE.Scene, new THREE.BoxGeometry(0.05, 1.35, 0.10), lam2(0xb9bec4), railY.length,
      (m, i) => m.setPosition(11.76, railY[i], 0.86))
    // otobüs durağı — yalnız GÜNEYDE (kuzey kameranın önü, açık kalır)
    for (const by of [-25.40]) {
      const proto = K?.['building-s']
      if (proto) { const g = fitModel(proto, 2.6, 'z'); g.position.set(13.60, by, 0); g.rotation.z = Math.PI; s.add(g) }
      const bench = new THREE.Mesh(new THREE.BoxGeometry(0.45, 2.4, 0.42), lam2(0xa8875c))
      bench.position.set(12.9, by, 0.21); s.add(bench)
    }
    // dükkân otoparkı (atölye sırasının zemin ayağı) + park çizgileri
    const roadMat2 = lam2(0x41474e)
    // DÜKKÂN OTOPARKI BOYALARI TAMAMEN KALDIRILDI (Oğuz: "claim olmayan toprakta
    // park yeri kalmış, görüntüsüne gerek yok") — çizgili şerit sahipsiz duruyordu.
    void roadMat2
    // (eski batı atölye beton şeridi kaldırıldı — atölyeler batı uzağa taşındı, parsel temiz)
    this.parcelGreen()

    // ---- ÇAM KUŞAĞI: kaldırım arkası, parsel dışı ----
    const pines: [number, number, number][] = []
    for (let i = 0; i < 8; i++) pines.push([12.60, -27 - i * 3.2, 0.9 + (i % 2) * 0.15])
    for (let i = 0; i < 8; i++) pines.push([12.60, 27 + i * 3.2, 0.9 + (i % 2) * 0.15])
    this.pineBelt(s, pines, 0x466b41, 0x5c854f)
  }

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
  pumpSlots: THREE.Vector3[] = Array.from({ length: 8 }, (_, i) => varsayilanYuva(PUMP_SLOTS_POS, i))
  /** pompa/şarj oyuncu açıları (rad) — araç slotta bu açıyla hizalanır (döndürülmüş ünitede yan durma fixi) */
  pumpAngles: number[] = []
  evAngles: number[] = []
  /** pompa/şarj GÖVDE konumları — çarpışma kutuları slottan geriye türetilmez (karşı yakada
   *  türetme 3.6 birim kayıyordu: hayalet duvar kapı koridorunun üstüne geliyordu, B1) */
  pumpBase: THREE.Vector2[] = []
  evBase: THREE.Vector2[] = []
  evSlots: THREE.Vector3[] = Array.from({ length: 8 }, (_, i) => varsayilanYuva(EV_SLOTS_POS, i))
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
    // karşı şube arsası: üstündeki doğal dekor (ağaç vs.) kalkar — tesis sahasında ağaç bitmez
    this.clearDecorRect(10.9, 22.4, -12.0, 12.0)
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
    // KARŞI YAKA DA GENİŞLER (oyuncu raporu: "karşı giriş/çıkışı genişletince kalıcı
    // olmuyor, mağaza MAKS diyor"). Geniş kapı ŞUBE genelinde tek bir satın alma; ama
    // yalnız near kapılar yeniden kuruluyordu, karşı kapılar hep dar kalıyordu. Kapı
    // ağzı/rampa/bordür boşluğu buildGate içinde this.wideGates'ten okunduğu için
    // karşı kapıları MEVCUT y'lerinde yeniden kurmak yetiyor.
    if (this.farStationOn) {
      this.buildGate('in', this.gateIn2.clone(), 'far')
      this.buildGate('out', this.gateOut2.clone(), 'far')
    }
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
  /** KARŞI-YAKA altyapısı (kaldırım + yaya bariyeri, col-3 içinde) — instanced olduğundan
   *  tek tek silinemez; karşı yakadan İLK arsa alınınca grup komple kalkar (Oğuz raporu) */
  farSideInfra: THREE.Group | null = null

  /** Dikdörtgen içindeki TÜM dekoru sahneden sil (Oğuz: "arazi claimlenmişse
   *  objeler dinamik kalkmalı"). Claim, beton, karşı şube ve load hepsi bunu kullanır. */
  clearDecorRect(dx0: number, dx1: number, dy0: number, dy1: number) {
    this.decor = this.decor.filter(d => {
      const inside = d.x >= dx0 && d.x <= dx1 && d.y >= dy0 && d.y <= dy1
      if (inside) this.scene.remove(d.obj)
      return !inside
    })
  }

  /** satın alınan (henüz betonsuz) arsayı ahşap kazık + ip sınırla işaretle */
  markOwned(c: number, r: number) {
    if (!PARCEL_COLS[c] || !PARCEL_ROWS[r]) return // sınır dışı parsel: crash koruması
    const [x0, x1] = PARCEL_COLS[c]
    const [y0, y1] = PARCEL_ROWS[r]
    // CLAIM ANINDA dekor kalkar (eskiden yalnız betonda kalkıyordu — satın alınmış
    // kahverengi arsada ağaçlar dikili kalıyordu)
    this.clearDecorRect(x0, x1, y0, y1)
    // karşı yakadan arsa alındıysa bariyer/kaldırım bandı komple kalkar
    if (c >= 3 && this.farSideInfra) { this.scene.remove(this.farSideInfra); this.farSideInfra = null }
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
      this.clearDecorRect(dx0, dx1, dy0, dy1)
      if (c >= 3 && this.farSideInfra) { this.scene.remove(this.farSideInfra); this.farSideInfra = null }
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
  /** KARŞI YAKA DÖNÜŞÜ (#1019 "karşı dükkanlar ters duruyor"): tesisler yola göre
   *  AYNALANIP konumlanıyor ama açıları dönmüyordu — vitrin/tente/kapı karşı istasyonun
   *  içine değil, dışarı bakıyordu. Pompalarda bu düzeltme vardı (far → +PI), dükkanlarda
   *  yoktu. Flip'i rotateBuilding'e gömüyoruz: oyuncu binayı döndürse de kaybolmuyor. */
  private farFlip(g: THREE.Object3D) {
    // marinada "yol karşısı" diye bir şey yok — ada tek parça; flip yalnız kara şubelerinde
    if (this.theme.lane.kind === 'water') return 0
    return g.position.x > ROAD_X ? Math.PI : 0
  }

  rotateBuilding(id: string, rot: number) {
    const b = this.buildings.find(x => x.id === id)
    if (b) (b.group as THREE.Group).rotation.z = rot * Math.PI / 2 + this.farFlip(b.group)
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
    // YÖN OKU — İKİ KEZ AYNALAMA HATASI (oyun sahibi: "karşı istasyonun giriş çıkış
    // oklarının yeri yanlış gibi"). Burada ok karşı yaka için `(far ? -1 : 1)` ile elle
    // ters çevriliyordu; AMA aşağıdaki register() zaten ROAD_X'in doğusundaki her grubu
    // 180° döndürüyor (farFlip). İki aynalama üst üste binince ok TAM TERSİNE dönüyordu:
    // ölçüldü — araçlar karşı GİRİŞ kapısından (y=+8) içeri girerken (36→180 örnek,
    // hepsi `driving`) oradaki ok yolu gösteriyordu; çıkış kapısında da tersi.
    // Ayrıca 180° dönüş "GİRİŞ"/"ÇIKIŞ" tabelasını da çeviriyor, panel kameraya SIRTINI
    // dönüyordu (ekran görüntüsünde karşı kapıda yalnız çıplak direk görünüyor).
    // ÇÖZÜM: aynalama TEK KAYNAKTA (farFlip) kalsın. Ok yerel eksende hesaplanır:
    // giriş istasyona (−x), çıkış yola (+x) bakar; karşı yakada grubun kendisi dönerek
    // ikisini de doğru dünya yönüne çevirir. Tabela ise yerelde ters kurulur ki
    // dönüşten sonra yine kameraya (+x) baksın.
    const dir = kind === 'in' ? -1 : 1
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
    }, far ? new THREE.Vector3(-1, 0, 0) : undefined) // karşı yakada grup 180° dönecek → yerelde ters kur
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
    if (id.startsWith('wind')) this.blades = this.blades.filter(x => x.id !== id)
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
    if (id.startsWith('wind')) this.blades = this.blades.filter(x => x.id !== id)
    if (id === 'market') this.marketGroup = null
    if (id === 'market2') this.market2Group = null
    if (id === 'toilet') this.toiletGroup = null
    if (id === 'battery') this.batteryGroup = null
  }

  addPump(index: number, at?: THREE.Vector2, rot = 0) {
    const isWater = this.theme.lane.kind === 'water'
    // MARİNA (Oğuz: "pompayı deniz sınırına çekelim, gemiler tahtaya çıkmasın"):
    // varsayılan pompa RIHTIM hattına (x≈4.0) kurulur; tekne yuvası her koşulda SUDA
    // (ada doğu kıyısı 5.3 + tekne payı → x ≥ 6.6). Tekne iskeleye BORDALAR, karaya çıkmaz.
    // VARSAYILAN GÖVDE = tablo yuvası − 1.8 (yuva gövdenin doğusunda). Eskiden burada
    // gövde x'i 0 diye SABİT yazılı, y ise `[Math.min(index,3)]` ile 3'e KIRPILIYORDU:
    // konumu olmayan 4.,5.,6.,7. pompa aynı (0,−18) noktasında doğup üst üste biniyordu.
    const dv = varsayilanYuva(PUMP_SLOTS_POS, index)
    const base = at ?? new THREE.Vector2(isWater ? 4.0 : dv.x - PUMP_SLOT_OFF, dv.y)
    // Karşı (yol karşısı) istasyonda araç kapıya BATIDAN yanaşır → araç yuvası pompanın batısında, ünite 180° döner.
    // Charger kalıbı: araç yanaşma slotu AÇIYLA birlikte döner — araç hep nozül tarafına yanaşır.
    const far = base.x > ROAD_X
    const ang = rot * Math.PI / 2
    // Araç yuvası ünitenin GÖRSEL yönüyle (rot + far-flip) birlikte döner. Önceden flip
    // yalnız X bileşenine uygulanıyordu; karşı yakada 90°/270° döndürülen pompada yuva
    // nozülün TERS tarafına düşüyor, araç pompanın arkasına yanaşıyordu.
    const dir = ang + (far ? Math.PI : 0)
    this.pumpSlots[index] = new THREE.Vector3(base.x + Math.cos(dir) * 1.8, base.y + Math.sin(dir) * 1.8, 0)
    if (isWater) this.pumpSlots[index].x = Math.max(this.pumpSlots[index].x, 6.6) // yuva SUDA kalır
    // ARAÇ AÇISI DA FLIP'LENİR (dir, ang değil). Yuva konumu yukarıda far-flip ile
    // hesaplanıyordu ama açı flip'siz kalıyordu → karşı yakada araç yuvaya doğru gelip
    // 180° TERS park ediyordu (burnu pompanın aksi yönüne bakıyor). Yakın yakada dir === ang,
    // yani mevcut davranış birebir korunuyor; yalnız karşı yaka düzeliyor.
    this.pumpAngles[index] = dir
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
    // pompadaki ile aynı gerekçe: gövde = tablo yuvası − 1.1, indeks KIRPILMAZ
    const dv = varsayilanYuva(EV_SLOTS_POS, index)
    const base = at ?? new THREE.Vector2(dv.x - EV_SLOT_OFF, dv.y)
    // Araç yanaşma noktası varsayılan sağda (+1.1). Ünite döndükçe bu offset de döner,
    // böylece araç her zaman ünitenin şarj kablosu tarafından yanaşır.
    const ang = rot * Math.PI / 2
    // karşı istasyonda yanaşma batıdan — flip TÜM ofsete uygulanır (yalnız X'e değil),
    // yoksa 90°/270° döndürülmüş karşı şarjda araç pad'in ters tarafına yanaşıyordu
    const evDir = ang + (base.x > ROAD_X ? Math.PI : 0)
    this.evSlots[index] = new THREE.Vector3(base.x + Math.cos(evDir) * 1.1, base.y + Math.sin(evDir) * 1.1, 0)
    // pompadaki ile aynı gerekçe: yuva evDir ile dönüyorsa açı da evDir olmalı,
    // yoksa karşı yakadaki araç şarj ünitesine ters yanaşır
    this.evAngles[index] = evDir
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
        ctx.fillText('', w / 2, h / 2 + 8)
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
      ctx.fillText('DEPO', w / 2, h / 2)
    })
    warn.position.set(1.13, 0, 0.9)
    g.add(warn)
    g.position.set(this.batteryPos.x, this.batteryPos.y, 0)
    this.scene.add(g)
    this.batteryGroup = g
    this.register('battery', t('BATARYA DEPOSU'), g, level * 1.2 + 1.1)
  }

  /** GÜNEŞ SANTRALİ — Kenney city-kit-industrial v2 panel dizisi (industrial2 kiti).
   *  Model yüklenemezse eski kutu-geometri paneller yedek olarak kurulur; sahne
   *  asla boş kalmaz (kit indirilemeyen bağlantıda oyun yine oynanır). */
  buildSolar(side: 'north' | 'south', pos?: THREE.Vector2, regId = 'solar') {
    const g = new THREE.Group()
    if (this.statics?.solarPanel) {
      // SEYREK DİZİLİM (oyuncu: "çok kalabalık, seyreltip kaba görünüşten sıyır").
      // Önce hazır '-group' öbeği kullanılıyordu: her öbek zaten bir sürü panel
      // içeriyor, üç tanesi yan yana gelince tarla gibi tıkanıyordu.
      // Artık TEK panel (alçak profilli landscape) × 2 sıra × 3 sütun, aralarında
      // çim görünecek kadar boşluk. Ayak izi (5×7) değişmedi.
      // ÖLÇÜ İKİ KEZ AYARLANDI: önce grup modeli (kalabalık), sonra tek panel 1,45
      // (bu sefer uzaktan görünmez oldu). 1,9 aradaki nokta: yakında ince ve eğik
      // duruyor, oyun mesafesinden "santral" olarak okunuyor.
      const SIRA = 2, SUTUN = 3, PANEL = 1.9, ARA_X = 2.3, ARA_Y = 2.7
      for (let r = 0; r < SIRA; r++) for (let c = 0; c < SUTUN; c++) {
        const m = fitModel(this.statics.solarPanel, PANEL)
        m.position.set((r - (SIRA - 1) / 2) * ARA_X, (c - (SUTUN - 1) / 2) * ARA_Y, 0)
        g.add(m)
      }
      // inverter kabini — panellerin ölçeğine göre küçük tutuldu
      box(0.45, 0.35, 0.4, 0x59616b, 2.1, 2.9, 0.2, g)
    } else {
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
    }
    const at = pos ?? new THREE.Vector2(-4, side === 'south' ? -20 : 20)
    g.position.set(at.x, at.y, 0)
    this.scene.add(g)
    this.register(regId, t('GÜNEŞ SANTRALİ'), g, 2.4)
  }

  /** RÜZGÂR TÜRBİNİ — Kenney windmill.glb; 'blades' düğümü ayrı, update()'te döner.
   *  Türün kuralı gereği görünür iz bırakır: uzun mast sahnede uzaktan seçilir. */
  buildWind(pos?: THREE.Vector2, regId = 'wind') {
    const g = new THREE.Group()
    let blades: THREE.Object3D | null = null
    if (this.statics?.windmill) {
      const m = fitModel(this.statics.windmill, 8.4, 'z')
      m.traverse(o => { if (o.name === 'blades') blades = o })
      g.add(m)
    } else {
      // yedek: direk + göbek (kanatsız da olsa yapı görünür kalsın)
      cyl(0.16, 7.4, 0xe8e6e1, 0, 0, 3.7, 'z', g)
      box(0.5, 0.5, 0.5, 0xdfe3e8, 0, 0, 7.5, g)
    }
    // beton kaide: modelin tabanı zeminde yüzmesin
    cyl(0.75, 0.16, 0x9aa2ab, 0, 0, 0.08, 'z', g)
    const at = pos ?? new THREE.Vector2(-8.5, -20)
    g.position.set(at.x, at.y, 0)
    this.scene.add(g)
    if (blades) this.blades.push({ mesh: blades as THREE.Object3D, id: regId })
    this.register(regId, t('RÜZGÂR TÜRBİNİ'), g, 9.2)
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
      ctx.fillText(t('OTO YIKAMA'), w / 2, h / 2 + 2)
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
      ctx.fillText(t('KAHVE'), w / 2, h / 2 + 2)
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
      ctx.fillText(t('RESTORAN'), w / 2, h / 2 + 2)
    })
    sign.position.set(2.55, 0, 2.55)
    g.add(sign)
    this.facadeLights(g, [[2.44, -1.3, 1.4], [2.44, 1.0, 1.4]], 1.1, 0.7)
    g.position.set(at.x, at.y, 0)
    this.scene.add(g)
    this.register(regId, t('RESTORAN'), g, 3.6)
  }

  buildTruckPark(pos?: THREE.Vector2, regId = 'truckpark') {
    const at = pos ?? (regId === 'truckpark2' ? new THREE.Vector2(16.5, -4.5) : new THREE.Vector2(-12.5, -4.5))
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
      ctx.fillText(t('TIR PARKI'), w / 2, h / 2 + 2)
    })
    sign.position.set(3.9, 0, 1.8)
    g.add(sign)
    cyl(0.08, 1.8, 0x59616b, 3.9, 0, 0.9, 'z', g)
    g.position.set(at.x, at.y, 0)
    this.scene.add(g)
    this.register(regId, t('TIR PARKI'), g, 2.6)
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
      ctx.fillText(t('SELF YIKAMA'), w / 2, h / 2 + 2)
    })
    sign.position.set(2.35, 0, 2.7)
    g.add(sign)
    this.facadeLights(g, [[0.12, -1.5, 1.3], [0.12, 1.5, 1.3]], 0.7, 0.4)
    g.position.set(at.x, at.y, 0)
    this.scene.add(g)
    this.register(regId, t('SELF YIKAMA'), g, 3.4)
  }

  /** MARİNA TESİSLERİ — 7 oyuncu raporu: "yat klübü sahil rest açtım ama gözükmüyor",
   *  "neredeyse bina yok", "marina daha hiç olmamış". Tesisler yalnızca bir listede
   *  string olarak duruyordu; ₺220.000 ödenen yat kulübünün sahnede hiçbir izi yoktu.
   *  Artık her tesisin kendi yapısı var: adanın batı bandında sabit yuvalar (parsel
   *  yemez, mevcut yapı yerleşimiyle çakışmaz), tıklanınca ismi görünür. */
  private static readonly MARINA_FAC_SLOTS: Record<string, [number, number]> = {
    clubhouse: [-16.8, 13.5],
    chandlery: [-17.2, 7.2],
    shower:    [-17.2, 1.4],
    icebait:   [-17.2, -4.2],
    wasteoil:  [-17.2, -10.0],
    travelift: [1.20, -20.20],
    fueldock:  [3.40, -12.60],
    pumpout:   [3.40, -16.60],
    boom:      [7.40, 2.00],
  }

  buildMarinaFac(id: string, pos?: THREE.Vector2) {
    const slot = World.MARINA_FAC_SLOTS[id]
    if (!slot) return
    const at = pos ?? new THREE.Vector2(slot[0], slot[1])
    const g = new THREE.Group()
    let ad = id, labelZ = 3.0

    const tabela = (metin: string, renk: string, w: number, z: number) => {
      const sg = canvasPanel(w, w * 0.28, Math.round(w * 150), Math.round(w * 42), (ctx, cw, ch) => {
        ctx.fillStyle = renk; ctx.beginPath(); ctx.roundRect(0, 0, cw, ch, 16); ctx.fill()
        ctx.fillStyle = '#fff'; ctx.font = `800 ${Math.round(ch * 0.58)}px -apple-system, sans-serif`
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
        ctx.fillText(metin, cw / 2, ch / 2 + 2)
      })
      sg.position.set(0, 0, z)
      g.add(sg)
    }

    switch (id) {
      case 'clubhouse': {                                  // yat kulübü / sahil restoranı
        ad = t('YAT KULÜBÜ')
        box(6.2, 5.0, 3.0, 0xf1e6d2, 0, 0, 1.5, g)         // ana kütle
        box(6.6, 5.4, 0.26, 0x2f6b8f, 0, 0, 3.13, g)       // lacivert saçak
        box(3.4, 3.0, 1.4, 0xf7f0e2, 0, 0, 3.95, g)        // üst kat / seyir salonu
        box(3.6, 3.2, 0.2, 0x2f6b8f, 0, 0, 4.75, g)
        box(0.06, 3.6, 1.3, 0x8ed0e8, 3.14, 0, 1.7, g)     // deniz manzara camı
        // deniz tarafı teras + korkuluk
        const teras = new THREE.Mesh(new THREE.PlaneGeometry(2.6, 5.0), lam(0xd7c39c))
        teras.position.set(4.6, 0, 0.03); teras.receiveShadow = true; g.add(teras)
        for (let i = 0; i < 7; i++) cyl(0.06, 0.75, 0xf5f1e6, 5.85, -2.3 + i * 0.77, 0.38, 'z', g)
        cyl(0.09, 5.0, 0xf5f1e6, 5.85, 0, 0.74, 'y', g)
        cyl(0.10, 4.6, 0xe8e2d2, -2.4, 2.0, 2.3, 'z', g)   // gönder
        box(0.9, 0.04, 0.6, 0xd64545, -1.95, 2.0, 4.2, g)  // flama
        tabela(t('YAT KULÜBÜ'), '#2f6b8f', 3.4, 5.35)
        this.facadeLights(g, [[3.16, -1.2, 1.8], [3.16, 1.2, 1.8]], 1.0, 0.7)
        labelZ = 6.0
        break
      }
      case 'chandlery': {                                  // denizci malzemecisi
        ad = t('MALZEMECİ')
        box(4.0, 3.4, 2.4, 0xe3d9c6, 0, 0, 1.2, g)
        box(4.3, 3.7, 0.22, 0x9c3b3b, 0, 0, 2.51, g)
        box(0.06, 2.2, 1.1, 0x8ed0e8, 2.04, 0, 1.35, g)
        for (let i = 0; i < 5; i++) box(0.55, 0.7, 0.06, i % 2 ? 0x9c3b3b : 0xf3efe4, 2.30, -1.4 + i * 0.7, 1.95, g)
        cyl(0.16, 1.5, 0xb7bfc6, -1.5, -1.4, 0.75, 'z', g) // dışarıda halat makarası
        cyl(0.42, 0.30, 0xd8b168, -1.5, -1.4, 1.55, 'z', g)
        tabela(t('MALZEMECİ'), '#9c3b3b', 2.4, 2.95)
        this.facadeLights(g, [[2.06, 0, 1.35]], 0.9, 0.6)
        labelZ = 3.5
        break
      }
      case 'shower': {                                     // duş & çamaşırhane
        ad = t('DUŞ & ÇAMAŞIR')
        box(3.6, 2.8, 2.3, 0xdfe6e8, 0, 0, 1.15, g)
        box(3.9, 3.1, 0.2, 0x4f7f92, 0, 0, 2.4, g)
        box(0.06, 0.8, 1.4, 0x6f7c84, 1.84, -0.8, 0.85, g) // kapı
        box(0.06, 0.8, 1.4, 0x6f7c84, 1.84, 0.8, 0.85, g)
        cyl(0.55, 1.1, 0xc9d2d6, -1.0, 0, 3.05, 'z', g)    // çatı su deposu
        // buhar bacası
        cyl(0.12, 0.7, 0x9aa4ab, 1.2, 1.0, 2.85, 'z', g)
        tabela(t('DUŞ'), '#4f7f92', 2.0, 2.85)
        this.facadeLights(g, [[1.86, -0.8, 1.0], [1.86, 0.8, 1.0]], 0.6, 0.45)
        labelZ = 3.9
        break
      }
      case 'icebait': {                                    // buz & yem satışı
        ad = t('BUZ & YEM')
        box(2.6, 2.2, 1.9, 0xeaf2f5, 0, 0, 0.95, g)
        box(2.9, 2.5, 0.2, 0x3f8fb0, 0, 0, 2.0, g)
        box(0.06, 1.3, 0.9, 0x8ed0e8, 1.34, 0, 1.15, g)    // vitrin
        box(1.0, 0.9, 0.7, 0xcfe6ef, -1.5, 0.5, 0.35, g)   // dışarıdaki buz sandığı
        tabela(t('BUZ & YEM'), '#3f8fb0', 1.8, 2.45)
        this.facadeLights(g, [[1.36, 0, 1.15]], 0.7, 0.5)
        labelZ = 3.0
        break
      }
      case 'wasteoil': {                                   // atık yağ toplama
        ad = t('ATIK YAĞ')
        const pad = new THREE.Mesh(new THREE.PlaneGeometry(3.4, 2.6), lam(0x8b8577))
        pad.position.z = 0.02; pad.receiveShadow = true; g.add(pad)
        for (const [dx, dy] of [[-0.8, -0.6], [0.1, -0.6], [-0.8, 0.6], [0.1, 0.6]] as [number, number][])
          cyl(0.36, 1.1, 0x3c6b3f, dx, dy, 0.55, 'z', g)   // varil dizisi
        box(0.12, 2.6, 1.0, 0xb9b2a2, 1.5, 0, 0.5, g)      // sızıntı seti
        tabela(t('ATIK YAĞ'), '#3c6b3f', 1.7, 1.75)
        labelZ = 2.3
        break
      }
      case 'travelift': {                                  // tekne asansörü (portal vinç)
        ad = t('TRAVEL LIFT')
        for (const dy of [-2.4, 2.4]) {
          cyl(0.20, 4.6, 0xf0a93b, -1.6, dy, 2.3, 'z', g)  // ayaklar
          cyl(0.20, 4.6, 0xf0a93b, 1.6, dy, 2.3, 'z', g)
          box(0.30, 0.30, 0.30, 0x3c4046, -1.6, dy, 0.15, g)
          box(0.30, 0.30, 0.30, 0x3c4046, 1.6, dy, 0.15, g)
        }
        cyl(0.22, 3.4, 0xf0a93b, -1.6, 0, 4.6, 'y', g)     // yan kirişler
        cyl(0.22, 3.4, 0xf0a93b, 1.6, 0, 4.6, 'y', g)
        cyl(0.22, 3.4, 0xf0a93b, 0, -2.4, 4.6, 'x', g)     // enine kirişler
        cyl(0.22, 3.4, 0xf0a93b, 0, 2.4, 4.6, 'x', g)
        for (const dy of [-1.1, 1.1]) {                    // askı kolanları
          box(0.10, 0.36, 2.2, 0x2f3439, -1.6, dy, 3.4, g)
          box(0.10, 0.36, 2.2, 0x2f3439, 1.6, dy, 3.4, g)
          box(3.3, 0.36, 0.14, 0x2f3439, 0, dy, 2.35, g)
        }
        labelZ = 5.6
        break
      }
      case 'fueldock': {                                   // yakıt iskelesi kulübesi
        ad = t('YAKIT İSKELESİ')
        box(2.4, 2.4, 2.2, 0xf1e6d2, 0, 0, 2.1 / 2 + 0.24, g)  // güverte üstünde
        const guverte = new THREE.Mesh(new THREE.PlaneGeometry(3.4, 5.2), lam(0xa8875c))
        guverte.position.z = 0.24; guverte.receiveShadow = true; g.add(guverte)
        box(2.7, 2.7, 0.2, 0xd64545, 0, 0, 2.44, g)
        box(0.06, 1.4, 1.0, 0x8ed0e8, 1.24, 0, 1.44, g)
        cyl(0.22, 1.3, 0xd64545, 0.6, -1.9, 0.89, 'z', g)  // yakıt tabancası standı
        cyl(0.22, 1.3, 0x3f8fb0, -0.6, -1.9, 0.89, 'z', g)
        tabela(t('YAKIT'), '#d64545', 1.7, 2.85)
        this.facadeLights(g, [[1.26, 0, 1.44]], 0.7, 0.5)
        labelZ = 3.4
        break
      }
      case 'pumpout': {                                    // atık su tahliyesi
        ad = t('ATIK SU TAHLİYESİ')
        const guverte = new THREE.Mesh(new THREE.PlaneGeometry(2.6, 3.0), lam(0xa8875c))
        guverte.position.z = 0.24; guverte.receiveShadow = true; g.add(guverte)
        cyl(0.55, 1.7, 0x4f8f6a, 0, 0, 1.10, 'z', g)       // tahliye ünitesi
        box(1.0, 0.8, 0.5, 0xdfe6e8, 0, -1.0, 0.49, g)     // pompa kutusu
        cyl(0.07, 1.6, 0x2f3439, 0.55, 0.6, 1.6, 'y', g)   // hortum kolu
        tabela(t('ATIK SU'), '#4f8f6a', 1.5, 2.30)
        labelZ = 2.9
        break
      }
      case 'boom': {                                       // yakıt sızıntı bariyeri (suda)
        ad = t('SIZINTI BARİYERİ')
        for (let i = 0; i < 14; i++) {
          const c = cyl(0.22, 1.15, i % 2 ? 0xf0a93b : 0xe8e2d2, 0, -7.5 + i * 1.15, 0.16, 'y', g)
          c.castShadow = false
        }
        box(0.10, 16.2, 0.06, 0x3c4046, 0, 0, 0.30, g)     // üst halat
        labelZ = 1.4
        break
      }
    }
    g.position.set(at.x, at.y, 0)
    this.scene.add(g)
    this.register('mfac-' + id, ad, g, labelZ)
  }

  /** İSKELE BÜYÜMESİ — "iskeleler büyümüyor" (#1074): satın alınan bağlama yerleri
   *  sahnede görünmüyordu. Her tür kendi görselini alır ve sayı arttıkça uzar. */
  private berthGroup: THREE.Group | null = null
  updateBerthVisual(berths: Record<string, number>) {
    if (this.berthGroup) { this.scene.remove(this.berthGroup); this.berthGroup = null }
    const g = new THREE.Group()
    const lam2 = (c: number) => new THREE.MeshLambertMaterial({ color: c })
    const n = (k: string) => Math.max(0, Math.round(berths[k] ?? 0))

    // parmak iskeleler: ana pontonun (x 23.2) batı yakasına, boya göre üç uzunlukta
    const parmak = (adet: number, uzunluk: number, y0: number, renk: number) => {
      for (let i = 0; i < adet; i++) {
        const y = y0 + i * 2.3
        if (y > 21 || y < -21) break                       // dalgakıran/fener bandına taşma
        const m = new THREE.Mesh(new THREE.BoxGeometry(uzunluk, 0.85, 0.24), lam2(renk))
        m.position.set(22.55 - uzunluk / 2, y, 0.13); m.castShadow = true; g.add(m)
        const b = new THREE.Mesh(new THREE.CylinderGeometry(0.10, 0.12, 0.42, 6), lam2(0x3c4046))
        b.rotation.x = Math.PI / 2
        b.position.set(22.55 - uzunluk, y, 0.34); g.add(b)
      }
    }
    parmak(n('finger8'), 2.6, -18.0, 0xa8875c)
    parmak(n('finger12'), 3.8, -6.5, 0x9b7f56)
    parmak(n('finger18'), 5.2, 6.0, 0x8d6f49)

    // şamandıralar: açık suda dizi
    for (let i = 0; i < n('buoy'); i++) {
      const y = -20 + (i % 18) * 2.4, x = 28.5 + Math.floor(i / 18) * 2.2
      const s2 = new THREE.Mesh(new THREE.SphereGeometry(0.34, 10, 8), lam2(0xe8e2d2))
      s2.position.set(x, y, 0.24); g.add(s2)
      const t2 = new THREE.Mesh(new THREE.ConeGeometry(0.16, 0.5, 6), lam2(0xd64545))
      t2.rotation.x = Math.PI / 2; t2.position.set(x, y, 0.72); g.add(t2)
    }
    // karşı kıyı parkı: doğu kıyısında bağlama babaları dizisi
    for (let i = 0; i < n('karsi'); i++) {
      const y = -16 + (i % 16) * 2.1
      const m = new THREE.Mesh(new THREE.BoxGeometry(1.6, 1.7, 0.22), lam2(0xb0a48c))
      m.position.set(-22.6, y, 0.13); g.add(m)
      const b = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.14, 0.46, 6), lam2(0x3c4046))
      b.rotation.x = Math.PI / 2; b.position.set(-23.1, y, 0.36); g.add(b)
    }
    // süperyat mevkisi: dalgakıranın iç yüzünde uzun, geniş rıhtım
    for (let i = 0; i < n('mega'); i++) {
      const y = -14 + (i % 5) * 7.5
      const m = new THREE.Mesh(new THREE.BoxGeometry(1.5, 6.6, 0.30), lam2(0x8d8577))
      m.position.set(24.45, y, 0.16); m.castShadow = true; g.add(m)
      for (let k = 0; k < 3; k++) {
        const l = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.09, 1.5, 6), lam2(0xe8e2d2))
        l.rotation.x = Math.PI / 2; l.position.set(24.45, y - 2.4 + k * 2.4, 0.9); g.add(l)
      }
    }
    if (g.children.length === 0) return
    this.scene.add(g)
    this.berthGroup = g
  }

  /** YOL KENARI OTELİ (#1011 "otel ekleyebilirsin") — tır parkının üst ligi: iki katlı
   *  konaklama bloğu, giriş saçağı, ışıklı tabela. Gece pencereleri yanar. */
  buildHotel(pos?: THREE.Vector2, regId = 'hotel') {
    const at = pos ?? new THREE.Vector2(-14.5, -12.5)
    const g = new THREE.Group()
    box(6.4, 9.0, 5.2, 0xeee3cd, 0, 0, 2.6, g)              // ana blok (2 kat)
    box(6.8, 9.4, 0.28, 0x9c3b3b, 0, 0, 5.34, g)            // saçak
    box(6.6, 0.16, 0.20, 0xd8cdb4, 0, 0, 2.62, g)           // kat ayrım silmesi
    // oda pencereleri: iki kat × dört oda, deniz/yol tarafına bakar
    const isik: [number, number, number][] = []
    for (let kat = 0; kat < 2; kat++) {
      for (let i = 0; i < 4; i++) {
        const py = -3.2 + i * 2.1, pz = 1.5 + kat * 2.5
        box(0.06, 1.3, 1.0, 0x8ed0e8, 3.24, py, pz, g)
        isik.push([3.26, py, pz])
      }
    }
    // giriş: kanopi + iki direk + basamak
    box(2.6, 3.0, 0.22, 0x9c3b3b, 4.5, 0, 3.0, g)
    cyl(0.12, 3.0, 0xd8cdb4, 5.6, -1.3, 1.5, 'z', g)
    cyl(0.12, 3.0, 0xd8cdb4, 5.6, 1.3, 1.5, 'z', g)
    box(1.8, 2.6, 0.14, 0xcfc6b0, 4.6, 0, 0.07, g)
    box(0.06, 1.8, 2.1, 0x6f5a3f, 3.24, 0, 1.05, g)         // giriş kapısı
    // çatı üstü ışıklı tabela
    const tab = canvasPanel(3.6, 0.86, 520, 124, (ctx, cw, ch) => {
      ctx.fillStyle = '#9c3b3b'; ctx.beginPath(); ctx.roundRect(0, 0, cw, ch, 20); ctx.fill()
      ctx.fillStyle = '#fff'; ctx.font = '800 62px -apple-system, sans-serif'
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
      ctx.fillText(t('OTEL'), cw / 2, ch / 2 + 2)
    })
    tab.position.set(0, 0, 6.1)
    g.add(tab)
    cyl(0.09, 0.9, 0xb7ae99, 0, 0, 5.65, 'z', g)            // tabela direği
    this.facadeLights(g, isik, 0.9, 0.65)
    g.position.set(at.x, at.y, 0)
    this.scene.add(g)
    this.register(regId, t('OTEL'), g, 7.0)
  }

  buildParking(pos?: THREE.Vector2, regId = 'parking') {
    // VARSAYILAN KONUM POMPA GÖVDESİNİN İÇİNDEYDİ (ölçüldü): otopark (0.4,−0.2), pad
    // derinliği 3.1 → y∈[−1.75,1.35]; pompa gövdesi y∈[0.05,4.35]. Çakışma yüzünden
    // 4 park yerinden İKİSİ fiziksel olarak erişilemezdi — oyuncu 4 yer parası ödeyip
    // 2'sini kullanıyordu. Şerit ağı artık kapalı slota araç göndermiyor (kilitlenme yok)
    // ama boş durmaları da kayıp. Varsayılan güneye alındı; pompa hattıyla 0.5 birim boşluk.
    // ESKİ KAYITLAR ETKİLENMEZ: taşınmış otoparkın konumu placedPos'tan gelir (pos dolu).
    //
    // İKİNCİ TAŞIMA (1 Eyl, 2-yatak ızgarasıyla ÖLÇÜLDÜ): (0.4,−2.0) varsayılanında
    // batı yatağı x=−0.85'e düşüyor — pompa-0 gövdesinin GÜVENLİ PAYLI zarfının
    // (insideSolid: gövde 0.75 + 0.45 pay = |x|<1.2) İÇİNDE. Yatak MERKEZİ katı
    // sayıldığından hiçbir yanaşma açısı/cephe onu kurtaramaz (iki cephe de denendi,
    // arka koridor da pompa zarfını kesiyor) → şerit ağı yatağı doğru şekilde eliyor,
    // varsayılan otopark TEK yatakla kalıyordu (canlı ölçüm: parkLanesOf=1, park eden 0).
    // Aynı kalıp: varsayılan GÜNEYE taşındı (0.4,−5.6) — pad pompa-0 gövdesinin (alt
    // sınır y=−3.9) altına iner, İKİ yatak da arka cepheden (güney koridoru) açılır;
    // yataklar pompa ARAÇ yuvasından (1.8,−2.2) 3.5 birim uzakta, iç içe görüntü yok.
    // (Canlı A/B ölçümü: (0.4,−5.6) → 2 şerit, eş zamanlı 2 park ✓; eski (0.4,−2.0) →
    //  1 şerit. 8 pompalı salt-varsayılan kayıtta pompa-4 gövdesi (0,−6.2) batı yatağı
    //  yine kapatır — o yerleşimde pompa fiilen pedin dibinde durur, eleme dürüsttür.)
    const at = pos ?? new THREE.Vector2(0.4, -5.6)
    const g = new THREE.Group()
    const pad = new THREE.Mesh(new THREE.PlaneGeometry(PARK_PAD_W, 3.1), lam(0x6b7480))
    pad.position.z = 0.02
    pad.receiveShadow = true
    g.add(pad)
    // çizgili park yerleri — aralık PARK_ARALIK, araç genişliğinden geniş (bkz. sabit)
    for (let i = 0; i <= PARK_YER; i++) {
      const line = new THREE.Mesh(new THREE.PlaneGeometry(0.11, 2.8), lam(0xe8e4d8))
      line.position.set(-PARK_PAD_W / 2 + i * PARK_ARALIK, 0, 0.03)
      g.add(line)
    }
    for (let i = 0; i < PARK_YER; i++) {
      box(0.72, 0.13, 0.1, 0xd8dbde, parkYerX(i), -1.2, 0.05, g) // teker stoperi
    }
    g.position.set(at.x, at.y, 0)
    this.scene.add(g)
    this.register(regId, t('OTOPARK'), g, 2.2)
  }

  /** yerleştirilen otoparkın dünya park noktaları: pozisyon + yanaşma (stage) + park AÇISI.
   *  Açı otoparkın rotasyonundan türetilir — döndürülen otoparkta araç artık YAN park etmez;
   *  stage noktası girişin önünde (yerel +Y) — araç nereye konursa konsun kendi önünden yanaşır.
   *
   *  NOKTA HAVUZU TEKLİĞİ (1 Eyl, canlı telemetri: parked+parked 240 / toPark+toPark 124):
   *  TÜM otoparkların noktaları tek havuzda toplanır ve birbirine PARK_NOKTA_AYRIK'tan
   *  yakın düşenler ELENİR (parkHavuzuAyikla — gerekçe traffic-graph.ts'te). Çizgili yer
   *  ÇİZİMİ ve oyuncunun yerleşimi DEĞİŞMEZ; yalnız trafiğin park ettiği nokta kümesi
   *  ayrışır. Rozet/atama/şerit ağı hepsi BU listeden beslendiği için kapasite de
   *  gerçek sayıyı gösterir. */
  getParkingSpots(): { id: string; pos: THREE.Vector3; stage: THREE.Vector3; rot: number }[] {
    const spots: { id: string; pos: THREE.Vector3; stage: THREE.Vector3; rot: number }[] = []
    for (const b of this.buildings) {
      if (!(b.id === 'parking' || b.id.startsWith('parking#'))) continue
      const g = b.group as THREE.Group
      g.updateMatrixWorld(true)
      for (let i = 0; i < PARK_YER; i++) {
        const lx = parkYerX(i)          // çizimle AYNI kaynak (bkz. PARK_ARALIK)
        spots.push({
          id: `${b.id}:${i}`, // KARARLI KİMLİK (B4) — bina taşınsa da yer kimliği değişmez
          pos: new THREE.Vector3(lx, -0.1, 0).applyMatrix4(g.matrixWorld),
          stage: new THREE.Vector3(lx, 2.4, 0).applyMatrix4(g.matrixWorld),
          rot: g.rotation.z - Math.PI / 2, // stoper yerel -Y'de → burun stopere bakar
        })
      }
    }
    return parkHavuzuAyikla(spots)
  }

  /** tır parkı: park noktası + manevra (yanaşma) noktası çiftleri */
  /** HER İKİ YAKANIN tır park yerleri.
   *
   *  #269 #1249 "karşı tır parkı atanamıyor": burası yalnız 'truckpark' id'li binayı
   *  arıyor, bulamayınca BOŞ dizi dönüyordu. Karşı yaka tır parkı 'truckpark2' olarak
   *  kayıtlı — yani hiç park yeri üretmiyordu ve tır oraya ASLA yanaşamıyordu. Oyuncu
   *  karşı tır parkının parasını ödüyor, bina duruyor, ama tır parkı olarak hiç işlev
   *  görmüyordu (yalnız tick() pasif geliri geliyordu, o yüzden testlerde "gelir üretti"
   *  diye yeşil görünüyordu — ölçülen şey tırlar değildi).
   *  cars.ts tarafı zaten hazırdı: yaka eşleşmesi ve yol aynalaması yazılıydı, yalnız
   *  beslenecek nokta yoktu. */
  getTruckSpots(): { spot: THREE.Vector3; stage: THREE.Vector3; id: string }[] {
    const out: { spot: THREE.Vector3; stage: THREE.Vector3; id: string }[] = []
    for (const id of ['truckpark', 'truckpark2']) {
      const b = this.buildings.find(x => x.id === id)
      if (!b) continue
      const g = b.group as THREE.Group
      g.updateMatrixWorld(true)
      for (const ly of [-1.4, 0, 1.4]) {
        out.push({
          spot: new THREE.Vector3(0, ly, 0).applyMatrix4(g.matrixWorld),
          stage: new THREE.Vector3(5.4, ly, 0).applyMatrix4(g.matrixWorld),
          id,
        })
      }
    }
    return out
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
      ctx.fillText('YAĞ DEĞİŞİMİ', w / 2, h / 2 + 2)
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
    // REAKTÖR — SADECE KENNEY PARÇALARI (oyuncu kararı): elde yapılan hiperboloit
    // soğutma kulesi ve içindeki su yüzeyi KALDIRILDI, yerine İKİ BACA geldi.
    // Silueti artık kitin geri kalanıyla aynı dilde: iki baca + muhafaza tankı.
    // Buhar (parçacık, asset değil) korunuyor ama artık BÜYÜK BACANIN tepesinden
    // çıkıyor — tesisin çalıştığı uzaktan görünsün, sahne cansız kalmasın.
    const bacaYuksek = 5.2, bacaAlcak = 3.9
    if (this.statics?.reactorStack) {
      const b1 = fitModel(this.statics.reactorStack, bacaYuksek, 'z')
      b1.position.set(0, -0.9, 0)
      g.add(b1)
      const b2 = fitModel(this.statics.reactorStack, bacaAlcak, 'z')
      b2.position.set(0.15, 1.2, 0)
      g.add(b2)
    } else {
      // yedek: kit inmezse iki silindir — yapı yine iki bacalı okunur
      cyl(0.62, bacaYuksek, 0xdfe3e8, 0, -0.9, bacaYuksek / 2, 'z', g)
      cyl(0.52, bacaAlcak, 0xdfe3e8, 0.15, 1.2, bacaAlcak / 2, 'z', g)
    }
    // muhafaza tankı (Kenney detail-tank-large)
    if (this.statics?.reactorTank) {
      const tank = fitModel(this.statics.reactorTank, 2.0, 'z')
      tank.position.set(2.3, -0.4, 0)
      g.add(tank)
    } else {
      cyl(0.9, 1.6, 0xdfe3e8, 2.3, -0.4, 0.8, 'z', g)
    }
    // hareketli buhar — büyük bacanın ağzından (update() içinde yükselir/kaybolur)
    for (let i = 0; i < 4; i++) {
      const puff = new THREE.Mesh(new THREE.SphereGeometry(0.34, 12, 10),
        new THREE.MeshLambertMaterial({ color: 0xffffff, transparent: true, opacity: 0.7 }))
      puff.position.set(0, -0.9, bacaYuksek)
      g.add(puff)
      this.steam.push({ mesh: puff, offset: i / 4, drift: (Math.random() - 0.5) * 0.5,
                        bx: 0, by: -0.9, bz: bacaYuksek })
    }
    const at = pos ?? new THREE.Vector2(1.8, side === 'south' ? -20.5 : 20.5)
    g.position.set(at.x, at.y, 0)
    this.scene.add(g)
    this.register('smr', t('REAKTÖR'), g, 7.0)
  }

  /** PATLAMIŞ REAKTÖR ENKAZI (Oğuz: "enkazı para karşılığı kaldırabilelim") — kavruk
   *  kule kütüğü + moloz + tehlike şeridi. Temizlenene dek yeni reaktör kurulamaz. */
  buildSMRWreck(side: 'north' | 'south', pos?: THREE.Vector2) {
    const g = new THREE.Group()
    // yıkık soğutma kulesi: alt 1/3'ü kalmış, kavruk
    const stump = new THREE.Mesh(new THREE.CylinderGeometry(1.30, 1.05, 1.7, 14, 1, true),
      new THREE.MeshLambertMaterial({ color: 0x4b4a46, side: THREE.DoubleSide }))
    stump.rotation.x = Math.PI / 2
    stump.position.z = 0.85
    g.add(stump)
    const rim = new THREE.Mesh(new THREE.TorusGeometry(1.28, 0.09, 8, 14),
      new THREE.MeshLambertMaterial({ color: 0x2c2b28 }))
    rim.position.z = 1.7
    g.add(rim)
    // moloz yığını
    for (let i = 0; i < 8; i++) {
      const b = new THREE.Mesh(new THREE.BoxGeometry(0.45 + (i % 3) * 0.22, 0.4, 0.3),
        new THREE.MeshLambertMaterial({ color: i % 2 ? 0x6b675f : 0x54514b }))
      const ang = (i / 8) * Math.PI * 2
      b.position.set(Math.cos(ang) * (1.6 + (i % 2) * 0.5), Math.sin(ang) * (1.5 + (i % 3) * 0.4), 0.16)
      b.rotation.z = ang * 1.7
      b.castShadow = true
      g.add(b)
    }
    // sarı-siyah tehlike şeridi (yerde çember)
    const tape = new THREE.Mesh(new THREE.RingGeometry(2.4, 2.62, 24),
      new THREE.MeshLambertMaterial({ color: 0xe0b13e }))
    tape.position.z = 0.02
    g.add(tape)
    // radyasyon uyarı tabelası
    const sign = canvasPanel(1.2, 0.8, 240, 160, (ctx, w, h) => {
      ctx.fillStyle = '#e0b13e'; ctx.beginPath(); ctx.roundRect(0, 0, w, h, 14); ctx.fill()
      ctx.fillStyle = '#1c2530'; ctx.font = '800 40px -apple-system, sans-serif'
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
      ctx.fillText(t('RADYASYON'), w / 2, h / 2 - 26)
      ctx.font = '750 30px -apple-system, sans-serif'
      ctx.fillText(t('GİRİLMEZ'), w / 2, h / 2 + 30)
    })
    sign.position.set(2.4, -1.6, 0.9)
    g.add(sign)
    const at = pos ?? new THREE.Vector2(1.8, side === 'south' ? -20.5 : 20.5)
    g.position.set(at.x, at.y, 0)
    this.scene.add(g)
    this.register('smrwreck', t('REAKTÖR ENKAZI'), g, 2.4)
  }
}
