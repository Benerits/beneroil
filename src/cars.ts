import * as THREE from 'three'
import { t } from './i18n'
import { FuelType, FUEL_LABEL, FUEL_PRICE, CarSegment } from './state'
import { LaneNetwork, StationGeom, UnitPoint, ParkPoint, ParkLane, Pt, Rect, QUEUE_GATE_CLEAR } from './traffic-graph'
import { ROAD_X, LANE_NEAR, LANE_FAR, FAR_GATE_X, PUMP_SLOTS_POS, EV_SLOTS_POS, TANK_POS, APRON_IN_Y, APRON_OUT_Y, APRON_SOUTH_Y } from './world'
import { yolBul, engelleriAyarla, segmentDikdortgeniKesiyor } from './yol-bul'

const CAR_COLORS = [0x5b8def, 0xe25b5b, 0xf2c14e, 0x62b56b, 0x9a7bd0, 0xe8e6e1, 0x4a5560, 0x53b8a7, 0xef8b4e]
const CAR_SPEED = 7
/** Tekne hız çarpanı: büyüdükçe yavaşlar (süperyat neredeyse üçte bir hızda manevra yapar).
 *  'yok' = kara aracı → 1, yani kara davranışı BİREBİR korunur. */
const BOAT_SPEED: Record<string, number> = {
  yok: 1, jetski: 0.7, surat: 0.62, balikci: 0.5, yelkenli: 0.45, gulet: 0.4, motoryat: 0.42, superyat: 0.32,
}
const DEMAND_AMOUNTS = [100, 150, 200, 250, 300, 400]
const DECISION_Y = -26 // yakın şeritte istasyona girme kararının verildiği nokta

/**
 * ── KONVEYÖR / BLOK KURALI (kuyruk + gelen omurga) ──
 * Twitter'da iki oyuncu bağımsız aynı çözümü önerdi, oyun sahibi benimsedi: konveyör
 * bant / blok sinyalizasyonu — araç, önündeki BÖLÜM boşalmadan ilerleyemez. Bu bir
 * PAZARLIK/REZERVASYON DEĞİL (o mimari bir kez silindi, ölçümle): tek taraflı bir
 * doluluk kapısı. Yalnız AYNI hattın araçlarına bakılır; çapraz akış (yol transiti,
 * UNIT_CLEAR yakın-geçişi, karşı akış) bloğa dahil DEĞİLDİR — dahil edilse kilitlenme
 * doğardı.
 * ÇIKIŞ OMURGASI DA KAPSAMDA (1 Eyl): kural başta bilerek yalnız GİRİŞ tarafındaydı;
 * sonraki faz analizi (400 olay) kalan iç içe kütlesinin bir ayağını leaving ailesinde
 * gösterdi — aynı giden omurga kolonunda peş peşe çıkan araçlar birbirinin içinden
 * akıyordu (lab ölçümü: leaving çifti min 0.00). Aynı kalıp DAR kapsamla çıkışa
 * uygulandı: yalnız leaving fazı + aynı xOut kolonu; kapıdan çıkmış (yolda) araçlar
 * hariç. Zincirin başı her zaman serbest aktığı için kilitlenme yine üretilemez.
 * KAPI AĞZI DA KAPSAMDA (2 Eyl): "kapıdan çıkmış hariç" kör noktaydı — yola katılım
 * boşluğu kuralı kapı ağzındaki öndekini 0.15'e düşürünce arkası üstüne biniyordu
 * (canlı yığılma olaylarının %60'ı; lab T8 161/333 çift < 1.8). Kapsam: xOut–şerit
 * bandı; öndeki yalnız 45° koni + aynı yön (farklı rotadan yan yana gelen iki araç
 * karşılıklı beklemesin — ölçüldü, T11 muaf 6). Bkz. konveyorBlok/kapiAgzinda.
 * Canlı telemetri gerekçesi (2.707 olay/19 saat): olayların %96'sı iç içe+yığılma,
 * en büyük küme (22x) tek pompalı gün-1 istasyonunda kuyruk başı; replay #2647'de
 * 4 bekleyen + 1 serviste burun buruna. Kök: slotlar arası geçişte mesafe kapısı yoktu.
 */
/** Öndekine bu mesafede fren başlar; kuyruk terfisi de bu eşiği bekler. */
const BLOK_MESAFE = 3.0
/** Tam duruş eşiği (yumuşak fren 3.0 → 2.2 arasında mesafeyle orantılı). */
const BLOK_DUR = 2.2
/** AYRIK ZAMAN TAŞMA PAYI: kare adımı kaba (testte dt=0.1, 0.7 birim/kare) — orantılı
 *  fren tek karede eşiğin altına taşabiliyor. Adım, araç öndekine bu mesafeden daha
 *  fazla yaklaşamayacak şekilde ayrıca kırpılır → ardışık çift HİÇBİR karede 2.5'in
 *  altına inmez (hedef metrik: görsel iç içelik biter, gövde 2.66'ya pay kalır). */
const BLOK_TABAN = 2.55
/** Kilitlenme koruması: blok yüzünden bu kadar sn ilerleyemeyen aracın kapısı otomatik
 *  açılır (kural yalnız O ARAÇ için askıya alınır) — buharlaşma/kalıcı sıkışan 0 kalır. */
const BLOK_KILIT_SN = 30

/**
 * ── İLERLEME BEKÇİSİ (kalıcı sıkışmaya MUTLAK garanti) ──
 * Neden gerekti: son çare katmanı (`evaporate`/`recoverStuck`) bilerek silindi çünkü
 * müşteriyi SESSİZCE yok ediyordu. Ama silinince geriye HİÇBİR sigorta kalmadı:
 * `driving`/`toPark`/`leaving` fazlarının zaman aşımı yok, `parked` de öyle. Katı
 * cismin dibinde ya da varılamayan bir hedefe kilitlenen araç sonsuza dek kalıyor ve
 * tuttuğu kaynağı (kuyruk slotu, pompa yuvası, otopark yeri, tır yeri) hiç bırakmıyor.
 * Canlı telemetri bunu ölçtü: 14 saatte 2.781 olay, tek başına ≥45 sn kıpırdamayan
 * `leaving`/`driving`/`toPark` araçları ve bir noktada 20 araçlık `leaving` yığını.
 *
 * Bu bekçi eski katmandan İKİ noktada ayrılır ve fark kasıtlıdır:
 *   1. SESSİZ SİLME YOK. Araç sahnede kalır, çıkışa sürer; servis edilmemiş müşteri
 *      görünür kayıp olarak (onCarLost) sayılır. Oyuncu ne olduğunu GÖRÜR.
 *   2. HER KURTARMA SAYILIR. kurtarmaStats + telemetri ('kurtarma' olayı) — sayı
 *      artıyorsa rota katmanında gerçek bir kusur var demektir, saklanamaz.
 * Hedef: yol bulma (A*) indiğinde bu sayaç 0 kalmalı. Sıfır kalmayacaksa bile araç
 * kilitli kalmaz — garanti burada, teşhis sayaçta.
 */
/** T1: bu kadar süre ilerleme yoksa rota YENİDEN kurulur (araç başına en fazla 6 sn'de bir) */
const BEKCI_ROTA_SN = 6
/** T2: son gerçek ilerlemeden bu kadar sonra KURTARMA (kaynakları bırak, hayalet çıkış) */
const BEKCI_KURTARMA_SN = 30
/** otoparka/tır parkına gidiş kapağı: bu süre içinde yerine varamayan araç yeri işgal
 *  etmeye devam edemez (main.ts'teki yağ değişimi körüğü kapağıyla AYNI ölçü) */
const BEKCI_PARK_SN = 45
/** "gerçek ilerleme" eşiği (birim): araç NİHAİ hedefine bu kadar yaklaştıysa ilerliyordur.
 *  ÖLÇÜ NEDEN "YER DEĞİŞTİRME" DEĞİL: sıkışmanın en sinsi biçimi araç DURMADAN dönerken
 *  hiçbir yere varamamasıdır (katı cismin dibinde reaktif kaçış manevrası). Yer değiştirme
 *  ölçüsü o aracı "ilerliyor" sayardı — ölçüldü: T9'da 45 sn'de 76 birim yol yapıp park
 *  yerine varamayan araçlar. Nihai hedefe yaklaşma ölçüsü onları görür; yavaş sürünen
 *  sağlıklı araç ise biriktirerek eşiği geçer (eşik kare başına değil, KÜMÜLATİF). */
const BEKCI_ILERLEME = 0.5

export type CarPhase = 'transit' | 'driving' | 'waiting' | 'atPump' | 'toPark' | 'parked' | 'leaving' | 'gone'
export type CarKind = 'fuel' | 'ev'
/** EV müşterisinin şarj bulamayıp gitme nedeni (tryEnter → onEvTurnedAway) */
export type EvKacisNedeni = 'kapali' | 'bozuk' | 'molaci' | 'molaci-personelli'
export type BodyKind = 'sedan' | 'hatch' | 'suv'

const lam = (color: number) => new THREE.MeshLambertMaterial({ color })

function shapeFrom(points: [number, number][]): THREE.Shape {
  const s = new THREE.Shape()
  s.moveTo(points[0][0], points[0][1])
  for (let i = 1; i < points.length; i++) s.lineTo(points[i][0], points[i][1])
  s.closePath()
  return s
}

interface CarSpec {
  body: [number, number][]
  cabin: [number, number][]
  width: number
  wheelR: number
  wheelX: number
  front: number
  rear: number
}

const SPECS: Record<BodyKind, CarSpec> = {
  sedan: {
    body: [[-1.25, 0.2], [1.22, 0.2], [1.34, 0.35], [1.3, 0.62], [-1.22, 0.68], [-1.32, 0.45]],
    cabin: [[0.55, 0.66], [0.28, 1.05], [-0.45, 1.08], [-0.85, 0.68]],
    width: 1.1, wheelR: 0.27, wheelX: 0.8, front: 1.34, rear: -1.32,
  },
  hatch: {
    body: [[-1.0, 0.2], [1.0, 0.2], [1.12, 0.35], [1.08, 0.6], [-1.02, 0.68], [-1.1, 0.4]],
    cabin: [[0.4, 0.64], [0.15, 1.05], [-0.68, 1.06], [-0.96, 0.66]],
    width: 1.05, wheelR: 0.25, wheelX: 0.62, front: 1.12, rear: -1.1,
  },
  suv: {
    body: [[-1.2, 0.28], [1.2, 0.28], [1.32, 0.45], [1.28, 0.75], [-1.22, 0.8], [-1.3, 0.5]],
    cabin: [[0.5, 0.78], [0.3, 1.25], [-0.82, 1.28], [-1.08, 0.8]],
    width: 1.2, wheelR: 0.31, wheelX: 0.8, front: 1.32, rear: -1.3,
  },
}

function extrude(points: [number, number][], width: number, color: number): THREE.Mesh {
  const geo = new THREE.ExtrudeGeometry(shapeFrom(points), {
    depth: width, bevelEnabled: true, bevelThickness: 0.05, bevelSize: 0.05, bevelSegments: 2, steps: 1,
  })
  geo.translate(0, 0, -width / 2)
  const m = new THREE.Mesh(geo, lam(color))
  m.rotation.x = Math.PI / 2
  // GÖLGE YOK (30 Ağu): gölge haritası dondurulduğu için hareketli gölge yerinde kalırdı.
  m.castShadow = false
  return m
}


/** TEKNE GÖVDESİ (marina, rapor §6.5) — prosedürel; Kenney Watercraft Kit gelince
 *  buradaki üretici modelle değiştirilir, çağıranlar aynı kalır.
 *  Boy segmentle ölçeklenir: jet ski küçük ve hızlı, süperyat uzun ve ağır. */
export type BoatKind = 'jetski' | 'surat' | 'balikci' | 'yelkenli' | 'gulet' | 'motoryat' | 'superyat'
const BOAT_SPEC: Record<BoatKind, { len: number; beam: number; hull: number; deck: number; mast: boolean }> = {
  jetski:   { len: 1.5, beam: 0.7, hull: 0x2f6fed, deck: 0xe8e8ec, mast: false },
  surat:    { len: 2.6, beam: 1.0, hull: 0xffffff, deck: 0x2b3a4a, mast: false },
  balikci:  { len: 3.2, beam: 1.3, hull: 0x2f8f6a, deck: 0xd8cba8, mast: false },
  yelkenli: { len: 3.6, beam: 1.1, hull: 0xf2f2f0, deck: 0x35507a, mast: true },
  gulet:    { len: 4.6, beam: 1.5, hull: 0x8a6438, deck: 0xe7dcc2, mast: true },
  motoryat: { len: 5.2, beam: 1.6, hull: 0xf7f7f5, deck: 0x1f3346, mast: false },
  superyat: { len: 8.0, beam: 2.1, hull: 0xfafafa, deck: 0x11202e, mast: false },
}

/** Segment → Kenney watercraft modeli (kits.ts manifestiyle BİREBİR aynı adlar) */
export const BOAT_MODEL: Record<BoatKind, string> = {
  jetski: 'boat-speed-a', surat: 'boat-speed-f', balikci: 'boat-fishing-small',
  yelkenli: 'boat-sail-a', gulet: 'boat-house-c', motoryat: 'boat-tow-a',
  superyat: 'ship-ocean-liner-small',
}
/** Segment → dünya boyu (birim). Süperyat jet ski'nin ~5 katı: ölçek farkı GÖRÜNMELİ. */
export const BOAT_LEN: Record<BoatKind, number> = {
  jetski: 1.6, surat: 2.8, balikci: 3.4, yelkenli: 3.8, gulet: 4.8, motoryat: 5.6, superyat: 8.5,
}

export function buildBoatMesh(kind: BoatKind): THREE.Group {
  const g = new THREE.Group()
  const sp = BOAT_SPEC[kind]
  const mat = (c: number) => new THREE.MeshLambertMaterial({ color: c })
  // gövde: burnu sivri kutu (dört köşeli kutudan farkı burun daralması)
  const hull = new THREE.Mesh(new THREE.BoxGeometry(sp.len, sp.beam, sp.beam * 0.55), mat(sp.hull))
  hull.position.z = sp.beam * 0.28
  hull.castShadow = false
  g.add(hull)
  const bow = new THREE.Mesh(new THREE.ConeGeometry(sp.beam * 0.5, sp.len * 0.32, 4), mat(sp.hull))
  bow.rotation.z = -Math.PI / 2
  bow.rotation.y = Math.PI / 4
  bow.position.set(sp.len * 0.63, 0, sp.beam * 0.28)
  g.add(bow)
  // güverte üst yapısı
  const cabin = new THREE.Mesh(new THREE.BoxGeometry(sp.len * 0.34, sp.beam * 0.72, sp.beam * 0.5), mat(sp.deck))
  cabin.position.set(-sp.len * 0.08, 0, sp.beam * 0.72)
  g.add(cabin)
  if (sp.mast) {
    const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.06, sp.len * 1.15, 6), mat(0xdcdcd6))
    mast.rotation.x = Math.PI / 2
    mast.position.set(0, 0, sp.len * 0.62)
    g.add(mast)
  }
  return g
}

export function buildCarMesh(kind: BodyKind, color: number): THREE.Group {
  const g = new THREE.Group()
  const spec = SPECS[kind]
  g.add(extrude(spec.body, spec.width, color))
  g.add(extrude(spec.cabin, spec.width * 0.78, 0x394c60))
  const tire = new THREE.CylinderGeometry(spec.wheelR, spec.wheelR, 0.2, 16)
  const hub = new THREE.CylinderGeometry(spec.wheelR * 0.45, spec.wheelR * 0.45, 0.22, 10)
  for (const wx of [spec.wheelX, -spec.wheelX]) for (const wy of [spec.width / 2, -spec.width / 2]) {
    const t = new THREE.Mesh(tire, lam(0x22262a))
    t.position.set(wx, wy, spec.wheelR)
    t.castShadow = false
    g.add(t)
    const h = new THREE.Mesh(hub, lam(0xc8ccd0))
    h.position.set(wx, wy, spec.wheelR)
    g.add(h)
  }
  const bumpZ = kind === 'suv' ? 0.38 : 0.3
  for (const x of [spec.front - 0.02, spec.rear + 0.02]) {
    const b = new THREE.Mesh(new THREE.BoxGeometry(0.1, spec.width * 0.92, 0.14), lam(0x2e343a))
    b.position.set(x, 0, bumpZ)
    g.add(b)
  }
  const lightZ = kind === 'suv' ? 0.6 : 0.5
  for (const sy of [0.32, -0.32]) {
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.16, 0.1),
      new THREE.MeshLambertMaterial({ color: 0xfff2c9, emissive: 0xfff2c9, emissiveIntensity: 0.5 }))
    head.position.set(spec.front, sy * spec.width, lightZ)
    g.add(head)
    const tail = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.14, 0.09),
      new THREE.MeshLambertMaterial({ color: 0xd64545, emissive: 0xd64545, emissiveIntensity: 0.4 }))
    tail.position.set(spec.rear, sy * spec.width, lightZ + 0.04)
    g.add(tail)
  }
  return g
}

function liveSprite(text: string, accent: string): { sp: THREE.Sprite; set: (t: string) => void } {
  const c = document.createElement('canvas')
  c.width = 512; c.height = 192
  const ctx = c.getContext('2d')!
  const draw = (t: string) => {
    ctx.clearRect(0, 0, 512, 192)
    ctx.fillStyle = 'rgba(255,255,255,0.96)'
    ctx.strokeStyle = accent
    ctx.lineWidth = 14
    ctx.beginPath()
    ctx.roundRect(8, 8, 496, 176, 40)
    ctx.fill(); ctx.stroke()
    ctx.fillStyle = '#1c2530'
    let fs = 76
    ctx.font = `800 ${fs}px -apple-system, sans-serif`
    while (fs > 34 && ctx.measureText(t).width > 448) {
      fs -= 4
      ctx.font = `800 ${fs}px -apple-system, sans-serif`
    }
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
    ctx.fillText(t, 256, 100)
  }
  // dolum sırasında (set): gerçek pompa gibi dijital LCD — koyu ekran + parlayan monospace rakamlar
  const drawDigital = (t: string) => {
    ctx.clearRect(0, 0, 512, 192)
    // koyu LCD ekran (hafif dikey gradyan + ince çerçeve)
    const g = ctx.createLinearGradient(0, 0, 0, 192)
    g.addColorStop(0, '#15271e'); g.addColorStop(1, '#0a130f')
    ctx.fillStyle = g
    ctx.lineWidth = 8
    ctx.beginPath(); ctx.roundRect(10, 10, 492, 172, 34)
    ctx.fill()
    ctx.strokeStyle = '#334339'; ctx.stroke()
    let fs = 80
    ctx.font = `700 ${fs}px "SF Mono", Menlo, "Courier New", monospace`
    while (fs > 34 && ctx.measureText(t).width > 444) { fs -= 4; ctx.font = `700 ${fs}px "SF Mono", Menlo, "Courier New", monospace` }
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
    // renkli halo (glow)
    ctx.shadowColor = accent; ctx.shadowBlur = 28
    ctx.fillStyle = accent
    ctx.fillText(t, 256, 100)
    ctx.shadowBlur = 14; ctx.fillText(t, 256, 100)
    ctx.shadowBlur = 0
    // parlak çekirdek — segmentlerin yanan kısmı gibi okunur
    ctx.fillStyle = 'rgba(238,255,247,0.94)'
    ctx.fillText(t, 256, 100)
  }
  draw(text)
  const tex = new THREE.CanvasTexture(c)
  tex.colorSpace = THREE.SRGBColorSpace
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, color: 0xdedede }))
  sp.scale.set(2.6, 0.98, 1)
  return { sp, set: (t: string) => { drawDigital(t); tex.needsUpdate = true } }
}

function textSprite(text: string, accent: string): THREE.Sprite {
  const c = document.createElement('canvas')
  c.width = 512; c.height = 192
  const ctx = c.getContext('2d')!
  ctx.fillStyle = 'rgba(255,255,255,0.96)'
  ctx.strokeStyle = accent
  ctx.lineWidth = 14
  ctx.beginPath()
  ctx.roundRect(8, 8, 496, 176, 40)
  ctx.fill(); ctx.stroke()
  ctx.fillStyle = '#1c2530'
  let fs = 76
  ctx.font = `800 ${fs}px -apple-system, sans-serif`
  while (fs > 34 && ctx.measureText(text).width > 448) {
    fs -= 4
    ctx.font = `800 ${fs}px -apple-system, sans-serif`
  }
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
  ctx.fillText(text, 256, 100)
  const tex = new THREE.CanvasTexture(c)
  tex.colorSpace = THREE.SRGBColorSpace
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, color: 0xdedede }))
  sp.scale.set(2.6, 0.98, 1)
  return sp
}

// EMOJİ DOKU ÖNBELLEĞİ: duygu göstergesi artık her müşteride kademe kademe değişiyor,
// yani emojiSprite() saniyede onlarca kez çağrılabiliyor. Her çağrıda canvas + texture
// üretmek GPU'ya yeni doku yüklemek demek — aynı emoji için doku tek kez üretilir.
// (Dokular paylaşıldığı için sprite atılırken ASLA dispose edilmez.)
const EMOJI_TEX = new Map<string, THREE.Texture>()
function emojiTexture(emoji: string): THREE.Texture {
  let tex = EMOJI_TEX.get(emoji)
  if (tex) return tex
  const c = document.createElement('canvas')
  c.width = 128; c.height = 128
  const ctx = c.getContext('2d')!
  ctx.font = '100px -apple-system, sans-serif'
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
  ctx.fillText(emoji, 64, 70)
  tex = new THREE.CanvasTexture(c)
  tex.colorSpace = THREE.SRGBColorSpace
  EMOJI_TEX.set(emoji, tex)
  return tex
}

// ÖN ISITMA: oyunda kullanılan emoji kümesi sabit ve küçük. Dokular ilk müşteride
// değil, yönetici kurulurken üretilir — (1) canlıda ilk 😡'de canvas+doku yükleme
// takılması olmaz, (2) three.js her doku için uuid çekerken Math.random tüketir;
// tohumlu testlerde "ilk koşuda ortaya çıkan yeni emoji" RNG akışını kaydırıp aynı
// tohumla iki koşuyu ayrıştırıyordu (otopark-cikis-check 3c ile ölçüldü).
// Yeni emoji eklersen buraya da ekle (main.ts emojiFor + moodEmoji + taç/pırıltı).
const TUM_EMOJI = ['😐', '😠', '😡', '👑', '✨', '🤩', '😄', '🙂', '😒']
export function emojiDokulariniIsit() { for (const e of TUM_EMOJI) emojiTexture(e) }

function emojiSprite(emoji: string): THREE.Sprite {
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: emojiTexture(emoji), depthTest: false }))
  sp.scale.set(1.15, 1.15, 1)
  return sp
}

// ── SABIR GÖSTERGESİ EŞİKLERİ (Faz 1) ──
// Çubuk ancak müşteri huzursuzlanınca belirir: her aracın üstünde sürekli bar olsa
// sahne okunmaz hale gelir ve gösterge anlamını yitirir. Duygu kademeleri de aynı
// eşiklere oturur, böylece renk ve yüz aynı hikâyeyi anlatır.
export const SABIR_GOSTER = 0.65   // bu oranın altında çubuk + yüz belirir
const SABIR_AMBER = 0.42           // sarı: "acele et"
const SABIR_KIRMIZI = 0.20         // kırmızı + nabız: "son uyarı"
/** sabır oranından duygu emojisi — eşik dışında null (yüz gösterilmez) */
function moodEmoji(frac: number): string | null {
  if (frac >= SABIR_GOSTER) return null
  if (frac >= SABIR_AMBER) return '😐'
  if (frac >= SABIR_KIRMIZI) return '😠'
  return '😡'
}

import { ModelLib, cloneModel, CAR_FILES, fitModel } from './models'

// ================== ROTA ÖNBELLEĞİ ==================
// NEDEN: istasyon yerleşimi (Car.solids) yalnız oyuncu bina kurunca/taşıyınca değişir, ama
// aynı rota (kuyruk→pompa, pompa→çıkış, kapı→pompa) saniyede onlarca kez baştan
// temizleniyordu. Aynı (başlangıç, ara noktalar, pad) üçlüsünün temizlenmiş sonucu burada
// saklanır; yerleşim imzası değişince tamamı boşalır (Car.solids setter'ı).
const rotaOnbellek = new Map<string, { yol: THREE.Vector3[]; kopuk: boolean }>()
// Taşarsa komple boşalt: LRU tutmaya değmez, zaten her yerleşim değişiminde sıfırlanıyor.
// Sınır, yol üzerindeki SÜREKLİ değişen başlangıç noktalarının anahtarı şişirmesine karşı.
const ROTA_ONBELLEK_MAX = 1200
/** ara noktalar yerleşimden türer → 0.1 ızgara yeter (ucuz anahtar: sayı birleştirme) */
const q10 = (v: number) => Math.round(v * 10)
/** aracın anlık konumu SÜREKLİ değişir → 0.5 ızgara, yoksa her çağrı ıska olurdu */
const q2 = (v: number) => Math.round(v * 2)

export class Car {
  group: THREE.Group
  kind: CarKind
  demandType: FuelType
  demandAmount: number
  demandLiters: number
  /** müşteri segmenti ('standart' = klasik) ve satış marjı çarpanı (premium yakıt) */
  segment = 'standart'
  marginMult = 1
  demandKwh: number
  maxPatience: number
  patience: number
  phase: CarPhase = 'transit'
  lane: 'near' | 'far' | null = null
  /** hangi istasyona servise geliyor: yakın (batı) ya da karşı (doğu). Trafik/servis geometrisi buna göre aynalanır. */
  station: 'near' | 'far' = 'near'
  wantsEnter = false
  /** pompacı servis etti (bahşiş pompacıya, ücret kesilir) */
  autoServed = false
  converted = false
  wantsMarket: boolean
  wantsToilet: boolean
  wantsWash: boolean
  wantsOil: boolean
  wantsCoffee: boolean
  wantsFood: boolean
  wantsAir: boolean
  filled = 0
  nozzle: FuelType | null = null
  targetAmount = 0
  /** pompa bu araca aktif dolum yapıyor (pompalar bağımsız çalışır) */
  filling = false
  /** FULLE modu: gizli depo ihtiyacına kadar doldurulur */
  fullMode = false
  /** müşteri özellikle t('FULLE') istiyor (tutar girilemez) */
  wantsFull = false
  /** EV: kademeli şarj sürüyor */
  charging = false
  chargedKwh = 0
  /** EV: şarjı bitti ama tesisleri gezmeye gitti — üniteyi işgal ediyor */
  squatting = false
  /** işgal süresi (sn) — şarjcı/müdür otomatik uğurlaması için sayar */
  squatT = 0
  /** tır/kamyonet mi (dizel ağırlıklı, tır parkını kullanır) */
  isTruck = false
  wantsTruckPark = false
  truckSlot = -1
  stayT = 0
  /** geri geri park manevrası sürüyor */
  reversing = false
  private solidStuckT = 0
  /** ÖNDEN ÇİZİLEN ÇIKIŞ ROTASI: araç pompaya VARIRKEN hesaplanır (arriveAtSlot).
   *  Oyun sahibi: "pompaya gelip sonra çıkış yolu aramasından ziyade baştan pathi ona
   *  göre çizse" — uğurlanınca hazır rota kullanılır, hesap için duraksama olmaz. */
  cikisYolu: THREE.Vector3[] | null = null
  /** hazır rotanın geçerlilik damgası: "yerleşim sürümü|hesaplandığı konum". Bina
   *  taşındıysa veya araç yerinden oynadıysa damga tutmaz → rota tazelenir. */
  cikisImza = ''
  truckStagePos: THREE.Vector3 | null = null
  /** aracın park ettiği ŞERİT (giriş kolu + çıkış kolu + koridor ağızları).
   *  Eski tek `parkStage` noktasının yerini aldı: çıkış artık GİRİŞTEN AYRI hattan
   *  yapılıyor, yani park etmeye gelenle çıkan kafa kafaya gelmiyor. */
  parkLane: ParkLane | null = null
  /** kararlı otopark yeri kimliği ('parking#2:1') — B4: indeksle takip bina taşınınca kayıyordu */
  parkId: string | null = null
  /** aracın gizli yakıt ihtiyacı (litre) — tipine göre: binek/SUV/kamyon */
  hiddenNeedL = 30
  /** araç-üstü dijital sayaç güncelleme throttle'ı (çok hızlı akmasın) */
  bubbleT = 0
  slotIndex = -1
  /** kuyruk slotu (yoksa -1). Slot SABİT bir şerit noktasıdır; sıra ilerleyince araç
   *  bir öndeki slota KAYAR (anlık ışınlanma değil, akıcı geçiş). */
  waitIndex = -1
  /**
   * ARTIK HİÇBİR KOD `true` YAPMAZ — şerit ağında araç durdurulmaz.
   * Alan yalnız `traffic-debug.ts` arayüzü (CarLike.hold) için duruyor; o dosya bu
   * görevin dokunma alanı dışında. Geri eklenmemeli: "bekleme" katmanı mimariden çıktı.
   */
  readonly hold = false
  /** ÖNDEKİ ARACA HIZ EŞİTLEME (1 = tam hız). Bu bir MÜZAKERE DEĞİL: araç durmaz,
   *  yalnız öndekinin hızını kopyalar. Kimse kimseyi beklemediği için kilitlenme üretemez. */
  speedScale = 1
  /** KONVEYÖR BLOĞU: bu karede uygulanan fren çarpanı (1 = serbest, 0 = kural gereği
   *  tam duruş). Kural duruşu bir KUSUR değildir: hardStuckT saymaz, akış örneklemesine
   *  girmez — aynen slotunda bekleyen araç gibi "sırasını bekliyor" sayılır. */
  blokFren = 1
  /** blok/terfi kapısı yüzünden ilerleyemeden geçen süre (sn) — kilitlenme sayacı */
  blokT = 0
  /** KİLİTLENME KAPISI AÇIK: konveyör kuralı yalnız BU ARAÇ için askıda. Araç mevcut
   *  bacağını bitirince (yol tükenince) kendiliğinden kapanır. */
  blokMuaf = false
  /** AKIŞ ÖLÇÜMÜ: aracın son karedeki hızı (nominal hızın oranı, 0..1). */
  hizOrani = 1
  /** duraksama süresi (sn) — hız nominalin %15'inin altındayken birikir.
   *  Eski adı korundu: traffic-debug.ts `hardStuckT` okuyor. */
  hardStuckT = 0
  /** KURTARILMIŞ ARAÇ: konveyör freni ve hız eşitlemesi bu araca ARTIK İŞLEMEZ.
   *  Kurtarma nadirdir (tasarım gereği); araç önünde ne varsa içinden geçerek çıkar —
   *  amaç güzel görünmek değil, tuttuğu kaynağı bırakıp sahneden GERÇEKTEN çıkmak. */
  hayalet = false
  /** BEKÇİ: son gerçek ilerlemeden bu yana geçen süre (sn) */
  bekciT = 0
  /** BEKÇİ ÇAPASI: nihai hedefe ULAŞILMIŞ EN KISA mesafe. İlerleme buna göre ölçülür —
   *  yani sayaç ancak araç "hiç görmediği kadar yakına" gelince sıfırlanır. */
  bekciMesafe = Infinity
  /** ölçünün ait olduğu nihai hedef (rotanın son noktası). Rota YENİLENİP hedef AYNI
   *  kaldıysa ölçü korunur: yoksa 6 sn'de bir rota kuran bekçi kendi ölçüsünü sıfırlar
   *  ve T2 hiç gelmezdi (ölçüldü — araç engelin dibinde sonsuza dek "yeniden rotalanıyor"). */
  private bekciHx = NaN
  private bekciHy = NaN
  /** T1 yeniden rotalama için araç başına bekleme (sn) — 6 sn'de birden sık rota kurulmaz */
  bekciRotaT = 0
  /** `toPark` fazında geçen toplam süre — park/tır yerine hiç varamayan araç kapağı */
  parkVarisT = 0
  private barsOn = false
  wrongFuelHandled = false
  beingServed = false

  private path: THREE.Vector3[] = []
  private onArrive: (() => void) | null = null
  private bubble: THREE.Sprite | null = null
  private patienceBg: THREE.Sprite
  private patienceFill: THREE.Sprite
  private feedback: THREE.Sprite | null = null
  private feedbackT = 0
  /** kayıp yazısının tek kullanımlık dokusu — sprite düşerken serbest bırakılır
   *  (emoji dokuları önbellekli ve paylaşımlı olduğu için onlar ASLA dispose edilmez) */
  private feedbackTex: THREE.Texture | null = null
  // DUYGU YÜZÜ (Faz 1): feedback'ten AYRI — feedback servis sonu tek atışlık tepki,
  // bu ise bekleyen müşterinin canlı ruh hali. Yalnız kademe değişince sprite yenilenir.
  private mood: THREE.Sprite | null = null
  private moodKey: string | null = null
  private nabizT = 0
  /** SABIR HIZI (Faz 2): kuyruk uzunluğu ve son dilim hızlanması bunu değiştirir.
   *  1 = normal. CarManager her karede bekleyen araçlar için tazeler. */
  sabirHizi = 1
  /** VIP MÜŞTERİ: nadir, yüksek tutarlı, SABRI KISA müşteri. Ödüllü reklamın
   *  bağlandığı kriz anını üretir — oyuncu büyük kazancı gözünün önünde kaybetmek üzeredir. */
  vip = false
  /** pompa önceliği: VIP kurtarıldığında kuyrukta öne geçer */
  oncelikli = false

  // cam temizleme (bahşiş şansını artırır) — diğer mekaniklerden bağımsız
  windowsCleaned = false
  private windowFx: THREE.Mesh | null = null
  private windowSpark: THREE.Sprite | null = null
  private windowFxT = 0

  private prices: Record<FuelType, number>
  /** aracın spawn anındaki fiyat snapshot'ı (ciro ve prim aynı temeli kullansın) */
  priceOf(f: FuelType): number { return this.prices[f] }

  /** MARİNA: bu bir tekne mi (görsel + fizik farkı). Kara şubelerinde hep null. */
  boat: BoatKind | null = null

  constructor(scene: THREE.Scene, lib: ModelLib | null, kind: CarKind, prices: Record<FuelType, number> = FUEL_PRICE,
              segments: CarSegment[] | null = null, boat: BoatKind | null = null,
              patienceMult = 1, vip = false) {
    this.kind = kind
    this.boat = boat
    this.prices = { ...prices }
    if (boat) {
      // MARİNA: gerçek tekne modeli (Kenney watercraft). Kit inmemişse prosedürel
      // gövdeye düşülür — sahne her hâlde kurulur, oyun durmaz.
      const proto = Car.boatKit?.[BOAT_MODEL[boat]] ?? null
      // 'x' = BOY ekseni: BOAT_LEN gerçek tekne boyudur (kiriş değil), ölçek farkı korunur
      this.group = proto ? fitModel(proto, BOAT_LEN[boat], 'x') : buildBoatMesh(boat)
      this.hiddenNeedL = Math.round((boat === 'superyat' ? 2200 : boat === 'motoryat' ? 900
        : boat === 'gulet' ? 700 : boat === 'balikci' ? 600 : boat === 'yelkenli' ? 300
        : boat === 'surat' ? 160 : 40) * (0.6 + Math.random() * 0.5))
      this.isTruck = false
    } else if (kind === 'ev') {
      if (lib?.evCar) {
        this.group = cloneModel(lib.evCar)
        // EV'ler tek renk gelmesin: gövdeyi rastgele tonla boya
        const EV_TINTS = [0xffffff, 0xffb9b9, 0xb9d4ff, 0xbdf5cd, 0xffe6a8, 0xe3c2ff, 0x9fe8f5]
        const tint = EV_TINTS[Math.floor(Math.random() * EV_TINTS.length)]
        this.group.traverse(o => {
          const m = o as THREE.Mesh
          if (m.isMesh && m.material) {
            m.material = (m.material as THREE.Material).clone()
            ;(m.material as THREE.MeshStandardMaterial).color?.setHex(tint)
          }
        })
      } else {
        this.group = buildCarMesh('hatch', 0x35c7d6)
      }
    } else if (lib && lib.cars.length > 0) {
      const idx = Math.floor(Math.random() * lib.cars.length)
      this.group = cloneModel(lib.cars[idx])
      const name = CAR_FILES[idx] ?? 'sedan'
      const cap = /van|delivery|truck/.test(name) ? 110 : /suv/.test(name) ? 65 : 45
      this.hiddenNeedL = Math.round(cap * (0.55 + Math.random() * 0.35))
      this.isTruck = /truck|delivery/.test(name)
    } else {
      const kinds: BodyKind[] = ['sedan', 'sedan', 'hatch', 'hatch', 'suv']
      const bk = kinds[Math.floor(Math.random() * kinds.length)]
      this.group = buildCarMesh(bk, CAR_COLORS[Math.floor(Math.random() * CAR_COLORS.length)])
      this.hiddenNeedL = Math.round((bk === 'suv' ? 65 : 45) * (0.55 + Math.random() * 0.35))
    }
    this.group.userData.car = this
    const fr = Math.random()
    this.demandType = this.isTruck && Math.random() < 0.85
      ? 'dizel'
      : fr < 0.4 ? 'benzin' : fr < 0.8 ? 'dizel' : 'lpg'
    // ---- MÜŞTERİ SEGMENTLERİ (lategame raporu Katman 1c): geç oyun büyümesi ARAÇ SAYISIYLA
    // değil ₺/MÜŞTERİ ile yapılır (mobil ısınma kısıtı). Segment kilitleri istasyonun
    // gelişmişliğiyle açılır; kilitli oyuncu için davranış BİREBİR eskisi gibi kalır.
    const seg = segments
    let picked: CarSegment | null = null
    if (seg && seg.length) {
      const roll = Math.random()
      let acc = 0
      for (const s of seg) {
        // TIR segmenti yalnız tır gövdeli araçta, otobüs de öyle (görsel tutarlılık)
        if (s.truckOnly && !this.isTruck) continue
        acc += s.share
        if (roll < acc) { picked = s; break }
      }
    }
    this.segment = picked?.id ?? 'standart'
    this.marginMult = picked?.marginMult ?? 1
    if (picked) {
      this.demandAmount = Math.round((picked.min + Math.random() * (picked.max - picked.min)) / 10) * 10
      if (picked.fuel) this.demandType = picked.fuel
    } else {
      this.demandAmount = DEMAND_AMOUNTS[Math.floor(Math.random() * DEMAND_AMOUNTS.length)]
    }
    this.demandLiters = this.demandAmount / this.prices[this.demandType]
    this.demandKwh = 20 + Math.floor(Math.random() * 9) * 5 // 20..60
    this.wantsFull = kind === 'fuel' && Math.random() < 0.10
    // FULLE isteyenler dolu depo boşaltır: ₺500-1000 arası (kusuratlı) yakıt alır
    if (this.wantsFull) this.hiddenNeedL = (250 + Math.random() * 250) / this.prices[this.demandType]
    // SABIR TABANI (Faz 2): eskiden 75 sn (EV 45) sabitti — oyuncuya "acele etme" izni
    // veriyordu. Taban indirildi; yeni oyuncu boğulmasın diye state.patienceMult()
    // ilk günlerde (gün ≤2 ×1.6, ≤5 ×1.3) süreyi uzatıyor.
    this.maxPatience = (kind === 'ev' ? 32 : 45) * patienceMult
    // VIP: tutar 4 KAT ama sabır YARI. Reklamsız da kazanılabilir (hızlı davranırsan) —
    // reklam yalnız kurtarmayı KOLAYLAŞTIRIR, tek yol olmaz.
    if (vip) {
      this.vip = true
      this.demandAmount = Math.round(this.demandAmount * 4 / 10) * 10
      this.demandKwh = Math.round(this.demandKwh * 3)
      this.demandLiters = this.demandAmount / this.prices[this.demandType]
      this.maxPatience *= 0.55
    }
    this.patience = this.maxPatience
    this.wantsMarket = Math.random() < 0.35
    this.wantsToilet = Math.random() < 0.12
    this.wantsWash = kind === 'fuel' && Math.random() < 0.25
    this.wantsOil = kind === 'fuel' && Math.random() < 0.12
    this.wantsCoffee = Math.random() < 0.3
    this.wantsFood = Math.random() < 0.18
    this.wantsAir = kind === 'fuel' && Math.random() < 0.2
    scene.add(this.group)

    // depthTest KAPALI olduğu için z farkı çizim sırasını belirlemiyor: dolgu, koyu
    // zeminin ALTINDA kalıp çubuk tamamen siyah görünüyordu. renderOrder sırayı
    // kesinleştirir (zemin önce, dolgu üstüne).
    const mkBar = (c: number, z: number, sira: number) => {
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({ color: c, depthTest: false }))
      sp.scale.set(1.5, 0.2, 1)
      sp.position.z = z
      sp.renderOrder = sira
      sp.visible = false
      this.group.add(sp)
      return sp
    }
    this.patienceBg = mkBar(0x1c2530, 2.0, 10)
    this.patienceFill = mkBar(0x4dc36b, 2.01, 11)
    // VIP işareti: sahnede AYRIŞSIN — oyuncu kalabalıkta bir bakışta seçebilmeli
    if (this.vip) {
      const tac = emojiSprite('👑')
      tac.scale.set(1.05, 1.05, 1)
      tac.position.z = 3.35
      tac.renderOrder = 14
      this.group.add(tac)
    }
  }

  get filledValue(): number {
    return this.nozzle ? this.filled * this.prices[this.nozzle] : 0
  }

  get patienceFrac(): number {
    return Math.max(0, this.patience) / this.maxPatience
  }

  /** SU ŞUBESİ: tekne hiçbir waypoint'te karaya/iskeleye (x < 6.5) çıkamaz.
   *  CarManager her karede günceller; kara şubelerinde null. */
  static waterMinX: number | null = null

  setPath(points: THREE.Vector3[], onArrive?: () => void) {
    this.path = points.map(p => p.clone())
    if (Car.waterMinX != null) for (const p of this.path) p.x = Math.max(p.x, Car.waterMinX)
    this.onArrive = onArrive ?? null
    // BEKÇİ ÖLÇÜSÜ yalnız HEDEF DEĞİŞTİYSE tazelenir; sayaç hiçbir durumda sıfırlanmaz.
    // (Aynı hedefe yeniden rota kurmak "ilerleme" değildir — kurtarma saati işlemeye
    //  devam etmeli, yoksa T1 kendi kendini besleyen sonsuz döngü olurdu.)
    const h = this.path.length ? this.path[this.path.length - 1] : null
    const degisti = !h || Number.isNaN(this.bekciHx) || Math.hypot(h.x - this.bekciHx, h.y - this.bekciHy) > 0.5
    this.bekciHx = h ? h.x : NaN
    this.bekciHy = h ? h.y : NaN
    if (degisti) this.bekciMesafe = this.hedefUzakligi()
  }

  showBars() { this.barsOn = true }

  hideBars() {
    this.barsOn = false
    this.patienceBg.visible = false
    this.patienceFill.visible = false
    // duygu yüzü de çubukla birlikte iner (servise alınan müşteri artık huzursuz değil)
    if (this.mood) { this.group.remove(this.mood); this.mood = null }
    this.moodKey = null
  }

  /** gidilen yönün birim vektörü (durunca null) */
  headingDir(): THREE.Vector3 | null {
    if (this.path.length === 0) return null
    const d = new THREE.Vector3().subVectors(this.path[0], this.group.position)
    d.z = 0
    return d.lengthSq() < 1e-6 ? null : d.normalize()
  }

  private bubbleSet: ((t: string) => void) | null = null

  showBubble() {
    if (this.bubble) return
    let made: { sp: THREE.Sprite; set: (t: string) => void }
    if (this.kind === 'ev') {
      made = liveSprite(`⚡ ${this.demandKwh} kWh`, '#35c7d6')
    } else {
      const accent = this.demandType === 'benzin' ? '#27a05a' : this.demandType === 'dizel' ? '#e8862e' : '#2f6fed'
      made = liveSprite(this.wantsFull
        ? t('FULLE {0}', FUEL_LABEL[this.demandType])
        : `₺${this.demandAmount} ${FUEL_LABEL[this.demandType]}`, accent)
    }
    this.bubble = made.sp
    this.bubbleSet = made.set
    this.bubble.position.z = 2.85
    this.group.add(this.bubble)
  }

  /** dolum/şarj sırasında balonu canlı sayaca çevirir */
  setCounter(t: string) { this.bubbleSet?.(t) }

  hideBubble() {
    if (this.bubble) { this.group.remove(this.bubble); this.bubble = null; this.bubbleSet = null }
  }

  showFeedback(emoji: string) {
    if (this.feedback) this.group.remove(this.feedback)
    this.feedback = emojiSprite(emoji)
    this.feedback.position.z = 2.6
    this.feedback.renderOrder = 13
    this.group.add(this.feedback)
    this.feedbackT = 2.5
  }

  /** KAYIP YAZISI (Faz 1): kaçan müşterinin götürdüğü parayı aracın üstünde yükselterek
   *  gösterir. Kayıp eskiden tek bir toast'tı; rakam görünmeyince acısı da yoktu. */
  showLoss(text: string) {
    if (this.feedback) this.group.remove(this.feedback)
    const c = document.createElement('canvas')
    c.width = 384; c.height = 128
    const ctx = c.getContext('2d')!
    ctx.font = '800 78px -apple-system, sans-serif'
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
    ctx.lineWidth = 10
    ctx.strokeStyle = 'rgba(255,255,255,.92)'
    ctx.strokeText(text, 192, 68)
    ctx.fillStyle = '#d64545'
    ctx.fillText(text, 192, 68)
    const tex = new THREE.CanvasTexture(c)
    tex.colorSpace = THREE.SRGBColorSpace
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true }))
    sp.scale.set(2.1, 0.7, 1)
    sp.position.z = 2.6
    sp.renderOrder = 13
    this.feedback = sp
    this.group.add(sp)
    this.feedbackT = 2.2
    // ÖNBELLEKSİZ tek kullanımlık doku: tutar her müşteride farklı, paylaşılamaz.
    // feedback düşerken temizlensin diye dokuyu sprite'a iliştiriyoruz.
    this.feedbackTex = tex
  }

  /** ön cam temizleme görsel efekti — yalnızca aracın ön camına (local +x) parlama/silme */
  cleanWindows() {
    this.windowsCleaned = true
    // önceki efekt kalıntısını temizle
    if (this.windowFx) { this.group.remove(this.windowFx); this.windowFx = null }
    if (this.windowSpark) { this.group.remove(this.windowSpark); this.windowSpark = null }
    // ön cam paneli: kabinin ön-üst yüzeyine oturur (local x≈0.4, z≈0.9 = cam yüksekliği)
    const geo = new THREE.PlaneGeometry(0.5, 0.78)
    const mat = new THREE.MeshBasicMaterial({
      color: 0xbfe3ff, transparent: true, opacity: 0,
      blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false,
    })
    const fx = new THREE.Mesh(geo, mat)
    fx.position.set(0.4, 0, 0.92)
    fx.renderOrder = 20
    this.group.add(fx)
    this.windowFx = fx
    const spark = emojiSprite('✨')
    spark.scale.setScalar(0.5)
    spark.position.set(0.4, -0.4, 1.15)
    spark.renderOrder = 21
    this.group.add(spark)
    this.windowSpark = spark
    this.windowFxT = 1.8
  }

  /** MARİNA tekne modelleri (şube kitinden gelir; yoksa prosedürel gövde kullanılır) */
  static boatKit: Record<string, THREE.Group | null> | null = null
  private static _solids: { cx: number; cy: number; w: number; d: number }[] = []
  /** yerleşim sürümü — Car.solids İÇERİĞİ değişince artar. Önden hesaplanmış çıkış
   *  rotaları bununla geçersizleşir (bina taşındıysa hazır rota artık geçerli değil). */
  static solidSurum = 0
  private static solidImza = 0
  /** rota önbelleği telemetrisi (debug katmanı + testler okur) */
  static rotaCacheStats = { hit: 0, miss: 0, flush: 0 }
  /** ana döngü her karede doldurur: sert engeller (pompa, bina...) */
  static get solids() { return Car._solids }
  static set solids(v: { cx: number; cy: number; w: number; d: number }[]) {
    Car._solids = v
    // UCUZ İMZA: main.ts her karede YENİ dizi atıyor (hardRects()), bu yüzden kimlik
    // karşılaştırması işe yaramaz — içerik gerçekten değiştiyse önbellek boşalır.
    // String kurmuyoruz: kare başına çöp üretmeyen FNV benzeri sayısal karma.
    let h = v.length | 0
    for (const r of v) {
      h = Math.imul(h ^ (r.cx * 977 | 0), 0x01000193)
      h = Math.imul(h ^ (r.cy * 977 | 0), 0x01000193)
      h = Math.imul(h ^ (r.w * 331 | 0) ^ (r.d * 331 | 0), 0x01000193)
    }
    if (h !== Car.solidImza) {
      Car.solidImza = h
      Car.solidSurum++
      rotaOnbellek.clear()
      Car.rotaCacheStats.flush++
    }
    // Yol bulucu KENDİ ızgarasını bu listeden kurar; sürüm değişmediyse ızgara korunur,
    // yalnız dizi referansı tazelenir (main.ts her karede YENİ dizi atıyor).
    engelleriAyarla(Car._solids, Car.solidSurum)
  }
  /** ÖLÇÜM: reaktif kaçış (1.6 sn kıpırdayamayıp engelin etrafından dolanma) kaç kez
   *  tetiklendi. Oyuncunun "arabalar pompalara takılıyor" dediği olayın SAYISAL karşılığı —
   *  rota temizliği çalışıyorsa bu sayı düşmeli. Testler/telemetri okur, oyunu etkilemez. */
  static reaktifKacis = 0
  /** ÖLÇÜM: kaç kez "hedefe HİÇ rota yok" durumu oluştu. Sessiz başarısızlığın
   *  sayısal karşılığı — sağlıklı bir yerleşimde 0 kalmalı, testler bunu denetler. */
  static rotaKopukSayac = 0
  /** bu aracın son rotası eksik/kirli mi (yol bulucu bile çözemedi) */
  rotaKopuk = false
  /** ÖLÇÜM: kuyruk slotu katı cismin İÇİNDE bulundu (şerit ağı elemesinden kaçan hâl).
   *  Sağlıklı yerleşimde 0'dır; patlarsa ağ ile katı cisim listesi ayrışmış demektir. */
  static katiIcindeSlot = 0
  /** yağ değişimi körüğü gibi BİNA İÇİNE sürüşlerde duvar çarpışmasını kapatır */
  ghostSolid = false
  // `stuckHits` / `softPassT` SİLİNDİ: "iki kez aynı yerde takılırsan araçlardan geç"
  // penceresiydi. Araçlar zaten birbirini engellemiyor (müzakere yok) → takılma yok.

  /** ARAÇ YOL ALIYOR MU (rotası var mı). Hız eşitlemesi yalnız HAREKET EDEN öndeki
   *  aracı dikkate alır: duran araç yol kenarı dekorudur, onu beklemek yasak. */
  get moving(): boolean { return this.path.length > 0 }
  /** güncel hedef nokta (yolun ilk noktası) — akış kuralları bacağı tanımak için okur */
  get hedefNokta(): THREE.Vector3 | null { return this.path[0] ?? null }
  get kalanNokta(): number { return this.path.length }

  /** BEKÇİ: hedefe KALAN ROTA UZUNLUĞU (araç → ilk nokta → … → son nokta).
   *  Kuş uçuşu DEĞİL (2 Eyl, fuzz ölçümü): çıkış rotası önce kapıya (hedeften UZAĞA)
   *  gider, sonra yol boyunca hedefe döner. Kuş uçuşu ölçüsü bu bacakta 30 sn boyunca
   *  "ilerleme yok" sayıyor, T1 aracı yoldan avluya geri rotalıyor (döngü), T2 de
   *  tam hızla giden aracı KURTARIYORDU (43 yerleşimde 709 sahte kurtarma; tohum 1'de
   *  60). Kalan rota uzunluğu her adımda azalır — kapıya giden bacak da ilerlemedir.
   *  Reaktif kaçışın başa eklediği ara nokta kalan uzunluğu ARTIRIR; ona yaklaşmak
   *  ancak eski en-iyiyi geçince ilerleme sayılır — engelin dibinde salınan araç
   *  yine yakalanır (en-iyi mesafe hiç düşmez).
   *  Rota boşsa Infinity — rotası tükenmiş ama fazı bitmemiş araç (ör. yolu yarıda
   *  kalan `leaving`) hiçbir yere gidemez; bekçi onu da saymalı. */
  hedefUzakligi(): number {
    const yol = this.path
    if (yol.length === 0) return Infinity
    const p = this.group.position
    let d = Math.hypot(yol[0].x - p.x, yol[0].y - p.y)
    for (let i = 1; i < yol.length; i++) d += Math.hypot(yol[i].x - yol[i - 1].x, yol[i].y - yol[i - 1].y)
    return d
  }

  /** BEKÇİ ÇAPASINI TAZELE: "ölçü buradan başlasın" (faz değişti / araç izlenmiyor). */
  bekciSifirla() {
    this.bekciT = 0
    this.bekciRotaT = 0
    this.bekciMesafe = this.hedefUzakligi()
    const h = this.path.length ? this.path[this.path.length - 1] : null
    this.bekciHx = h ? h.x : NaN
    this.bekciHy = h ? h.y : NaN
  }
  /** akış ölçümü: bu araç şu an "durmuş" sayılıyor mu (olay bazlı sayaç için) */
  durdu = false

  /** public sarmalayıcı — bekleme noktası üretimi katı cisimden kaçmak için kullanır (B5) */
  static isSolidAt(x: number, y: number): boolean { return Car.insideSolid(x, y) }

  private static insideSolid(x: number, y: number): boolean {
    for (const o of Car.solids) {
      if (Math.abs(x - o.cx) < o.w / 2 + 0.45 && Math.abs(y - o.cy) < o.d / 2 + 0.45) return true
    }
    return false
  }

  update(dt: number) {
    // AKIŞ ÖLÇÜMÜ: karenin başındaki konum — sonunda gerçek hız buradan çıkar.
    const p0x = this.group.position.x, p0y = this.group.position.y
    const nominal = CAR_SPEED * BOAT_SPEED[this.boat ?? 'yok'] * (this.reversing ? 0.45 : 1)
    if (this.path.length > 0) {
      const pos = this.group.position
      const target = this.path[0]
      const d = new THREE.Vector3().subVectors(target, pos)
      d.z = 0
      const dist = d.length()
      // MARİNA fizik farkı (rapor §6.5.2): tekneler DAHA YAVAŞ seyreder ve büyük tekne
      // daha ağır manevra yapar — yerleşim planlaması gerçekten önem kazanır.
      const step = CAR_SPEED * BOAT_SPEED[this.boat ?? 'yok'] * dt * this.speedScale * (this.reversing ? 0.45 : 1)
      if (dist <= step) {
        pos.copy(target)
        this.path.shift()
        if (this.path.length === 0 && this.onArrive) {
          const cb = this.onArrive
          this.onArrive = null
          cb()
        }
      } else {
        d.normalize()
        // sert engel: ileri adım bir objenin içine giriyorsa eksen eksen kaymayı dene.
        // ghostSolid: yağ değişimi körüğüne GİREN araç bina duvarını yok sayar —
        // yoksa kapıda sonsuza dek sürtünüp kalıyordu ("bugda kalıyor" raporu).
        const nx = pos.x + d.x * step
        const ny = pos.y + d.y * step
        let mx = pos.x, my = pos.y
        if (this.ghostSolid || !Car.insideSolid(nx, ny)) { mx = nx; my = ny }
        else if (Math.abs(d.x) > 0.01 && !Car.insideSolid(nx, pos.y)) { mx = nx } // duvar boyunca x'te kay
        else if (Math.abs(d.y) > 0.01 && !Car.insideSolid(pos.x, ny)) { my = ny } // duvar boyunca y'de kay
        // ikisi de tıkalıysa bu kare bekle (asla içinden geçme)
        const movedDist = Math.hypot(mx - pos.x, my - pos.y)
        const moved = movedDist > 1e-9
        pos.set(mx, my, pos.z)
        // engele takıldıysa say; 1.6 sn ilerleyemezse başka yönden dolaş
        if (movedDist < step * 0.25) this.solidStuckT += dt
        else this.solidStuckT = 0
        // ── REAKTİF KAÇIŞ: A* YENİDEN PLANLAMA (eski 14 ADAY SEZGİSELİ SİLİNDİ) ──
        // Eski hâli engelin etrafında 14 aday nokta deniyordu. İki ölümcül kusuru vardı:
        //   1) hiçbiri uymazsa HİÇBİR ŞEY olmuyordu → araç sonsuza dek orada kalıyordu,
        //   2) hedef waypoint'in KENDİSİ katı cismin içindeyse (döndürülmüş pompanın
        //      yuvası gibi) hiçbir aday oraya yaklaşamaz → 1.6 sn'de bir sonsuz döngü.
        // Artık gerçek bir yol araması yapılır ve erişilemez waypoint DÜŞÜRÜLÜR.
        // Hız sınırı korunuyor: solidStuckT sıfırlandığı için araç başına en fazla
        // 1.6 sn'de bir yeniden planlama koşar.
        if (this.solidStuckT > 1.6) {
          this.solidStuckT = 0
          Car.reaktifKacis++
          // Hedef waypoint gövdenin içindeyse ona ASLA varılamaz — atla (ama son
          // waypoint'i asla atma: onArrive geri çağrısının anlamı orada).
          let hi = 0
          while (hi < this.path.length - 1 && Car.insideSolid(this.path[hi].x, this.path[hi].y)) hi++
          const hedef = this.path[hi]
          const yol = yolBul(pos, hedef, rotaPadi(this)) ?? yolBul(pos, hedef, PAD_FIZIK)
          if (yol) {
            const kalan = this.path.slice(hi + 1)
            this.path = [...yol.map(p => new THREE.Vector3(p.x, p.y, 0)), ...kalan]
          } else if (hi < this.path.length - 1) {
            this.path.splice(0, hi + 1) // bu ara noktaya gidilemiyor: sıradakine yönel
          } else {
            // SON hedefe gidilemiyor: rotayı bozmuyoruz (onArrive korunur) ama sessiz
            // kalmıyoruz — ölçülebilir bir kusur olarak işaretlenir.
            if (!this.rotaKopuk) { this.rotaKopuk = true; Car.rotaKopukSayac++ }
          }
        }
        if (moved) {
          const yaw = Math.atan2(d.y, d.x) + (this.reversing ? Math.PI : 0)
          let diff = yaw - this.group.rotation.z
          while (diff > Math.PI) diff -= Math.PI * 2
          while (diff < -Math.PI) diff += Math.PI * 2
          this.group.rotation.z += diff * Math.min(1, dt * 8)
        }
      }
      // AKIŞ DÜZGÜNLÜĞÜ: yol almakta olan araç için gerçek hız / nominal hız.
      // Oyun sahibinin istediği şey ("akıcılık") burada ÖLÇÜLEBİLİR hale geliyor.
      const gitti = Math.hypot(this.group.position.x - p0x, this.group.position.y - p0y)
      this.hizOrani = dt > 0 && nominal > 0 ? Math.min(1, gitti / (nominal * dt)) : 1
      // KONVEYÖR DURUŞU SIKIŞMA DEĞİLDİR: blok kuralı gereği duran araç (blokFren < 0.15)
      // slotunda bekleyen araçla aynı statüde — kusur sayacı işlemez. Kuralın kendisi
      // kilitlenirse 30 sn kapısı (BLOK_KILIT_SN) açılır; kalıcı sıkışma yine imkânsız.
      if (this.hizOrani < 0.15 && this.blokFren >= 0.15) this.hardStuckT += dt
      else if (this.hizOrani >= 0.15) this.hardStuckT = Math.max(0, this.hardStuckT - dt * 3)
    } else {
      // hedefine varmış araç "duraksamış" sayılmaz (pompada bekleyen müşteri akış değil)
      this.hizOrani = 1
      this.hardStuckT = 0
    }

    if ((this.phase === 'waiting' || this.phase === 'atPump') && !this.beingServed) {
      this.patience -= dt * this.sabirHizi
    }

    // ── SABIR GÖSTERGESİ (Faz 1) ──
    // Eskiden çubuk her karede gizleniyordu ("sabır mekaniği görünmez işler"): geri sayım
    // dönüyor ama oyuncu ancak müşteri KAÇINCA haberdar oluyordu. Artık huzursuzluk
    // eşiğinden itibaren çubuk + yüz görünüyor; oyuncunun müdahale penceresi oluşuyor.
    const frac = this.patienceFrac
    const bekliyor = (this.phase === 'waiting' || this.phase === 'atPump') && !this.beingServed
    const goster = this.barsOn && bekliyor && frac < SABIR_GOSTER
    this.patienceBg.visible = goster
    this.patienceFill.visible = goster
    if (goster) {
      // Dolgu ORTADAN daralır (sola hizalı değil): sprite'ın local x'i 0 kaldığı için
      // araç dönerken çubuk kaymaz — yan park eden araçlarda bar aracın yanına kayıyordu.
      this.patienceFill.scale.x = 1.5 * Math.max(0.02, frac)
      const renk = frac >= SABIR_AMBER ? 0x4dc36b : frac >= SABIR_KIRMIZI ? 0xe0a02b : 0xd64545
      this.patienceFill.material.color.setHex(renk)
      // son dilimde nabız: göz çevresel görüşle bile yakalasın
      if (frac < SABIR_KIRMIZI) {
        this.nabizT += dt
        const n = 0.82 + 0.18 * Math.sin(this.nabizT * 9)
        this.patienceBg.material.opacity = n
        this.patienceFill.material.opacity = n
        this.patienceBg.material.transparent = true
        this.patienceFill.material.transparent = true
      } else if (this.patienceBg.material.opacity !== 1) {
        this.patienceBg.material.opacity = 1
        this.patienceFill.material.opacity = 1
      }
    }

    // ── DUYGU YÜZÜ: çubukla aynı eşiklerde, 😐 → 😠 → 😡 ──
    const istenenMood = goster ? moodEmoji(frac) : null
    if (istenenMood !== this.moodKey) {
      if (this.mood) { this.group.remove(this.mood); this.mood = null }
      this.moodKey = istenenMood
      if (istenenMood) {
        this.mood = emojiSprite(istenenMood)
        this.mood.scale.set(0.95, 0.95, 1)
        this.mood.position.z = 2.35
        this.mood.renderOrder = 12   // sabır çubuğunun (10/11) ÜSTÜNDE kalsın
        this.group.add(this.mood)
      }
    }

    if (this.feedback) {
      this.feedbackT -= dt
      this.feedback.position.z += dt * 0.3
      if (this.feedbackT <= 0) {
        this.group.remove(this.feedback)
        this.feedback = null
        if (this.feedbackTex) { this.feedbackTex.dispose(); this.feedbackTex = null }
      }
    }

    // cam temizleme silme/parlama animasyonu
    if (this.windowFx) {
      this.windowFxT -= dt
      const DUR = 1.8
      const p = Math.max(0, Math.min(1, 1 - this.windowFxT / DUR)) // 0→1
      const mat = this.windowFx.material as THREE.MeshBasicMaterial
      // iki silme geçişi + genel sönme: parlayan şerit araç boyunca kayar
      const wipe = Math.abs(Math.sin(p * Math.PI * 2))
      mat.opacity = wipe * 0.7 * (1 - p * 0.7)
      if (this.windowSpark) {
        const sm = this.windowSpark.material as THREE.SpriteMaterial
        this.windowSpark.position.y = -0.4 + p * 0.8 // cam boyunca yana süpürme
        sm.opacity = (1 - p) * 0.95
      }
      if (this.windowFxT <= 0) {
        this.group.remove(this.windowFx); this.windowFx = null
        if (this.windowSpark) { this.group.remove(this.windowSpark); this.windowSpark = null }
      }
    }
  }

  dispose(scene: THREE.Scene) {
    scene.remove(this.group)
    this.phase = 'gone'
  }
}

/** Sipariş gelince tank dolduran tanker kamyonu */
export class Tanker {
  group: THREE.Group
  private path: THREE.Vector3[] = []
  private stayTimer = 0
  private blockedTime = 0
  private leaving = false
  done = false
  unloading = false

  // Kapı konumları CANLI okunur (snapshot değil): çıkış taşınırsa tanker eski
  // noktaya gidip dönmez — güncel çıkışa yönelir. (Oyuncu "trafik" şikayeti fixi.)
  private gateOutYFn: () => number
  constructor(scene: THREE.Scene, lib: ModelLib | null, fuel: FuelType = 'benzin', queueIdx = 0, target = new THREE.Vector3(TANK_POS.x, TANK_POS.y, 0), gateInY: () => number = () => APRON_IN_Y, gateOutY: () => number = () => APRON_OUT_Y) {
    this.gateOutYFn = gateOutY
    const inY = gateInY()
    const tint = fuel === 'benzin' ? 0xa8d6b8 : fuel === 'dizel' ? 0xe3c49b : 0xaccdf0
    // MARİNA: yakıt GEMİYLE gelir (Oğuz) — kara tankeri denizin üstünde yüzüyordu.
    // Car.waterMinX su şubesinde CarManager tarafından set edilir; tanker de ona bakar.
    const isWater = Car.waterMinX != null
    let g: THREE.Group
    if (isWater) {
      g = new THREE.Group()
      const proto = Car.boatKit?.['ship-cargo-a'] ?? Car.boatKit?.['ship-cargo-b']
      if (proto) g.add(fitModel(proto, 8.0, 'x'))
      else g.add(buildBoatMesh('motoryat'))
      // güvertede yakıt tankı: hangi yakıtın geldiği denizden de okunur
      const tank = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.55, 2.4, 14), lam(tint))
      tank.rotation.z = Math.PI / 2
      tank.position.set(-0.4, 0, 1.6)
      tank.castShadow = false
      g.add(tank)
    } else if (lib?.tankerBase) {
      g = new THREE.Group()
      g.add(cloneModel(lib.tankerBase))
      const tank = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.5, 1.5, 16), lam(tint))
      tank.rotation.z = Math.PI / 2
      tank.position.set(-0.55, 0, 0.95)
      tank.castShadow = false
      g.add(tank)
      const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 0.15, 10), lam(0x8f979e))
      cap.rotation.x = Math.PI / 2
      cap.position.set(-0.55, 0, 1.5)
      g.add(cap)
      g.scale.setScalar(1.5)
    } else {
      g = new THREE.Group()
      const cab = new THREE.Mesh(new THREE.BoxGeometry(1.4, 1.5, 1.5), lam(0xd64545))
      cab.position.set(1.9, 0, 0.95); cab.castShadow = false; g.add(cab)
      const tank = new THREE.Mesh(new THREE.CylinderGeometry(0.8, 0.8, 3.4, 18), lam(tint))
      tank.rotation.z = Math.PI / 2
      tank.position.set(-0.6, 0, 1.15); tank.castShadow = false; g.add(tank)
      const chassis = new THREE.Mesh(new THREE.BoxGeometry(4.6, 1.4, 0.3), lam(0x2b2f33))
      chassis.position.set(0, 0, 0.45); g.add(chassis)
      const wheelGeo = new THREE.CylinderGeometry(0.32, 0.32, 0.25, 14)
      for (const wx of [1.9, 0.2, -1.6]) for (const wy of [0.72, -0.72]) {
        const w = new THREE.Mesh(wheelGeo, lam(0x22262a))
        w.position.set(wx, wy, 0.32); g.add(w)
      }
    }
    if (isWater) {
      // ARKA İKMAL RIHTIMI (Oğuz): gemi adanın ARKASINDAN (kuzey açık deniz) gelir,
      // kıç rıhtıma (y≈-26) yanaşır, boşaltır, geldiği yoldan gider. Müşteri
      // trafiğiyle ve yanaşma bölgesiyle hiç kesişmez.
      const bayX = -10.5 + (queueIdx % 3) * 3.5
      g.position.set(bayX, -60, 0)
      scene.add(g)
      this.group = g
      this.path = [new THREE.Vector3(bayX, -27.2, 0)]
      return
    }
    // yakın şeritte gel: ROAD_X (yol ortası) iki şeridi de bloke edip karşı trafiği kilitliyordu
    g.position.set(LANE_NEAR, -44, 0)
    scene.add(g)
    this.group = g
    // tank nereye taşınırsa taşınsın: şeritten tank hizasına gel, en yakın kenara park et
    const parkY = target.y + [0, 2.4, -2.4][queueIdx % 3]
    const parkX = Math.min(Math.max(target.x + 3.2, 3.4), 4.0)
    this.path = [
      new THREE.Vector3(LANE_NEAR, inY - 3.5, 0),
      new THREE.Vector3(4.2, inY, 0),
      new THREE.Vector3(4.2, parkY, 0), // şerit boyunca hizaya
      new THREE.Vector3(parkX, parkY, 0), // en yakın kenardan boşaltım — içeri dalmaz
    ]
  }

  update(dt: number, isBlocked?: (pos: THREE.Vector3, dir: THREE.Vector3) => boolean): boolean {
    let delivered = false
    if (this.path.length > 0) {
      const pos = this.group.position
      const target = this.path[0]
      const d = new THREE.Vector3().subVectors(target, pos)
      const dist = d.length()
      const step = 8 * dt
      if (dist <= step) {
        pos.copy(target)
        this.path.shift()
        if (this.path.length === 0 && !this.leaving) {
          this.stayTimer = 4
          this.unloading = true
        }
      } else {
        d.normalize()
        // trafik nezaketi: önünde araç varsa tanker bekler (7 sn'den fazla sıkışırsa zorlar)
        if (this.blockedTime < 7 && isBlocked?.(pos, d)) {
          this.blockedTime += dt
          return delivered
        }
        if (this.blockedTime >= 7) this.blockedTime = Math.max(0, this.blockedTime - dt * 3)
        else this.blockedTime = 0
        pos.addScaledVector(d, step)
        this.group.rotation.z = Math.atan2(d.y, d.x)
      }
    } else if (!this.leaving) {
      this.stayTimer -= dt
      if (this.stayTimer <= 0) {
        delivered = true
        this.unloading = false
        this.leaving = true
        const outY = this.gateOutYFn() // canlı çıkış konumu (taşınmış olabilir)
        this.path = Car.waterMinX != null
          // MARİNA: gemi arka rıhtımdan geldiği yöne (kuzey açık deniz) döner
          ? [new THREE.Vector3(this.group.position.x, -60, 0)]
          : [
            new THREE.Vector3(4.2, this.group.position.y, 0), // düz doğuya, şeride çık
            new THREE.Vector3(4.2, outY, 0),                  // şerit boyunca GÜNCEL çıkışa
            new THREE.Vector3(LANE_NEAR, outY + 4, 0),
            new THREE.Vector3(LANE_NEAR, 44, 0),
          ]
      }
    } else {
      this.done = true
    }
    return delivered
  }
}

// KUYRUK SLOTLARI ARTIK BURADA DEĞİL: şerit ağından (traffic-graph.ts) türetiliyor.
// Eskiden WAIT_OFFSETS sabit dizisi vardı ve bekleme koridoru kapıdan 0.8 birim içerideydi;
// çıkış koridoru (0.45) ile arası 0.35 birimdi — bekleyen araçla çıkan araç aynı kolonda
// üst üste biniyordu. Şerit ağı slotları GELEN OMURGA üzerine koyar: tek sıra, çıkışla
// 1.05 birim ayrık.

// `segmentDikdortgeniKesiyor` ARTIK BURADA DEĞİL: yol-bul.ts'ten geliyor. Tek kopya
// olması ŞART — rota temizliğinin "temiz" dediğiyle yol bulucunun "temiz" dediği ölçüt
// birbirinden ayrılırsa doğrulama katmanı sessizce yalan söyler.

/** Nokta, şişirilmiş dikdörtgenin içinde mi (kaçınılmaz engel elemesi için). */
function noktaKutuda(p: THREE.Vector3, r: { cx: number; cy: number; w: number; d: number }, pad: number): boolean {
  return Math.abs(p.x - r.cx) <= r.w / 2 + pad && Math.abs(p.y - r.cy) <= r.d / 2 + pad
}

/** Aracın gövdesinin GERÇEKTEN çarptığı sınır (Car.insideSolid ile aynı ölçü, +pay). */
const PAD_FIZIK = 0.5
/** Konforlu pay ile rota bulunamazsa düşülen dar pay: "hiç rota yok" demektense
 *  dar ama duvara sürtmeyen bir rota üret. */
const PAD_DAR = 0.65

/** ENGEL KÜMESİ: verilen gövdeyle (pad'le şişirilmiş halde) çakışan komşuları yutarak büyür.
 *  NEDEN: pompa sırası 4.5 birim aralıkla dizilir ama gövdeler 3.4 derindir — pay eklenince
 *  aralarında boşluk KALMAZ, sıra tek bir DUVAR olur. Tek gövdenin kenarından dolaşmayı
 *  denemek boşunaydı (her aday komşu pompaya çarpıyordu); duvarın UCUNDAN dolaşmak gerekir. */
function engelKumesi(
  engel: { cx: number; cy: number; w: number; d: number },
  engeller: { cx: number; cy: number; w: number; d: number }[], pad: number,
): { cx: number; cy: number; w: number; d: number } {
  let minX = engel.cx - engel.w / 2 - pad, maxX = engel.cx + engel.w / 2 + pad
  let minY = engel.cy - engel.d / 2 - pad, maxY = engel.cy + engel.d / 2 + pad
  for (let tur = 0; tur < 4; tur++) {
    let buyudu = false
    for (const r of engeller) {
      const rminX = r.cx - r.w / 2 - pad, rmaxX = r.cx + r.w / 2 + pad
      const rminY = r.cy - r.d / 2 - pad, rmaxY = r.cy + r.d / 2 + pad
      if (rminX > maxX || rmaxX < minX || rminY > maxY || rmaxY < minY) continue // değmiyor
      if (rminX >= minX && rmaxX <= maxX && rminY >= minY && rmaxY <= maxY) continue // zaten içeride
      minX = Math.min(minX, rminX); maxX = Math.max(maxX, rmaxX)
      minY = Math.min(minY, rminY); maxY = Math.max(maxY, rmaxY)
      buyudu = true
    }
    if (!buyudu) break
  }
  // pad'i geri çıkar: dönen kutu "şişirilmemiş" biçimde, çağıran yine pad ekleyecek
  return { cx: (minX + maxX) / 2, cy: (minY + maxY) / 2, w: maxX - minX - 2 * pad, d: maxY - minY - 2 * pad }
}

/** Bir segmenti tıkayan engeli aşacak ara nokta adayı üret; yoksa null.
 *  DİRSEK adayları kritik: döndürülmüş pompaya yanaşma "önce hizasına çık, SONRA yanaş"
 *  hareketini ister; avludan otoparka geçiş de "önce pompa sırasının UCUNA git, sonra batıya
 *  dön" ister. Eski yalnız-yanal-orta-nokta üretimi ikisini de asla bulamıyordu. */
function araNokta(
  a: THREE.Vector3, b: THREE.Vector3,
  engel: { cx: number; cy: number; w: number; d: number },
  engeller: { cx: number; cy: number; w: number; d: number }[], pad: number,
): THREE.Vector3 | null {
  const U = engelKumesi(engel, engeller, pad)
  const e = 0.35 // kenardan minik ek pay: teğet geçip yeniden takılmasın
  const yU = U.cy + U.d / 2 + pad + e, yA = U.cy - U.d / 2 - pad - e // duvarın kuzey/güney ucu
  const xD = U.cx + U.w / 2 + pad + e, xB = U.cx - U.w / 2 - pad - e // duvarın doğu/batı ucu
  const ox = (a.x + b.x) / 2, oy = (a.y + b.y) / 2
  const adaylar = [
    new THREE.Vector3(a.x, b.y, 0), new THREE.Vector3(b.x, a.y, 0),   // basit dirsekler
    new THREE.Vector3(a.x, yU, 0), new THREE.Vector3(a.x, yA, 0),     // kendi kolonunda duvarın ucuna
    new THREE.Vector3(b.x, yU, 0), new THREE.Vector3(b.x, yA, 0),     // hedefin kolonunda duvarın ucuna
    new THREE.Vector3(xD, a.y, 0), new THREE.Vector3(xB, a.y, 0),
    new THREE.Vector3(xD, b.y, 0), new THREE.Vector3(xB, b.y, 0),
    new THREE.Vector3(ox, yU, 0), new THREE.Vector3(ox, yA, 0),       // yanal orta nokta (eski davranış)
    new THREE.Vector3(xD, oy, 0), new THREE.Vector3(xB, oy, 0),
  ]
  // DOLANMA BÜTÇESİ: rotayı temizlemek uğruna aracı istasyonun öbür ucundan dolaştırmak
  // müşteriyi sabırsızlandırıp SERVİSİ düşürür. Bütçeyi aşan aday reddedilir; o durumda
  // eski davranış (reaktif kaçış) devrede kalır — kötü ama en azından hızlı.
  const dogrudan = a.distanceTo(b)
  const butce = dogrudan * 1.9 + 5
  return adaylar
    // ara nokta KATI CİSMİN İÇİNDE olamaz (duvarın köşesi başka kutuya düşerse araç binaya sürer)
    .filter(c => !Car.solids.some(r => noktaKutuda(c, r, 0.15)))
    .map(c => ({ c, u: c.distanceTo(a) + c.distanceTo(b) }))
    .filter(x => x.u <= butce)
    .sort((m, n) => m.u - n.u)
    .find(x => !engeller.some(r =>
      segmentDikdortgeniKesiyor(a.x, a.y, x.c.x, x.c.y, r, pad)
      || segmentDikdortgeniKesiyor(x.c.x, x.c.y, b.x, b.y, r, pad)))?.c ?? null
}

/** Rotayı engellerden ARINDIR: kesişen her segmentin etrafına ara nokta koyar.
 *  Sınırlı yineleme (2 tur) — çözemezse mevcut reaktif kaçış zaten devrede kalır. */
function rotayiTemizle(yol: THREE.Vector3[], pad = 1.0): THREE.Vector3[] {
  if (!Car.solids.length || yol.length < 2) return yol
  // KAÇINILMAZ ENGELLERİ ELE: aracın yanaştığı pompanın GÖVDESİ yuvanın hemen dibindedir;
  // araç çıkışta da kendi pompasının dibinden yola koyulur. Onun etrafından "dolaşmaya"
  // çalışmak anlamsız detour üretir.
  // ÖLÇÜT FİZİKSEL PAY: konfor payıyla eleseydik, yalnızca yakınından geçen gövdeler de
  // sessizce görmezden gelinirdi — döndürülmüş pompaya yanaşma tam bu yüzden düzelmiyordu
  // (yaklaşma noktası şişirilmiş zarfın içinde kalıyor, gövde listeden düşüyordu).
  const bas = yol[0], son = yol[yol.length - 1]
  const engeller = Car.solids.filter(r => !noktaKutuda(bas, r, PAD_FIZIK) && !noktaKutuda(son, r, PAD_FIZIK))
  if (!engeller.length) return yol
  // İKİ KADEMELİ PAY: önce konforlu pay (araç genişliği), o boşluk yoksa fiziksel sınır.
  const kademeler = pad > PAD_DAR ? [pad, PAD_DAR] : [pad]
  let cikti = yol
  // 3 TUR: bir ara nokta koyunca ortaya çıkan yeni bacaklar da taranır (duvarın ucundan
  // dolaşmak çoğu zaman İKİ dirsek ister: önce sıranın ucuna, sonra batıya).
  for (let tur = 0; tur < 3; tur++) {
    const yeni: THREE.Vector3[] = [cikti[0]]
    let degisti = false
    for (let i = 1; i < cikti.length; i++) {
      const a = cikti[i - 1], b = cikti[i]
      for (const p of kademeler) {
        const engel = engeller.find(r => segmentDikdortgeniKesiyor(a.x, a.y, b.x, b.y, r, p))
        if (!engel) break // bu kademede zaten temiz — daha darına inmeye gerek yok
        const iyi = araNokta(a, b, engel, engeller, p)
        if (iyi) { yeni.push(iyi); degisti = true; break }
      }
      yeni.push(b)
    }
    cikti = yeni
    if (!degisti) break
  }
  return cikti
}

/**
 * ROTA DOĞRULAMA + A* ONARIMI — "sessiz başarısızlık" katmanının kapatılması.
 *
 * `rotayiTemizle` sezgiseldir: çözemezse KİRLİ rotayı sessizce döndürür. O rotanın
 * kirli bacağına giren araç `Car.insideSolid` duvarına toslar ve orada kalır — canlı
 * telemetrideki en büyük kusur sınıfı buydu (#4403: 180° döndürülmüş pompaların
 * yuvası çıkış omurgasının ters yanında; düz çıkış bacağı gövdeyi kesiyor).
 *
 * Burada HER bacak (başlangıç→ilk dahil) FİZİKSEL payla denetlenir; kesen bacak
 * gerçek yol bulucunun çıktısıyla değiştirilir. Pay kademeleri: konforlu → dar →
 * fiziksel. Hiçbiri bulamazsa bacak olduğu gibi bırakılır ve `kopuk` işaretlenir.
 *
 * KAÇINILMAZ GÖVDELER: aracın yanaştığı pompanın gövdesi yuvanın DİBİNDEDİR; rotanın
 * ilk/son noktasını içine alan cisimlerden "kaçınmak" anlamsızdır (yuvaya hiç varılamaz).
 * Bunlar denetim kümesinden çıkarılır — eski `rotayiTemizle` ile aynı ölçüt.
 */
function rotayiDogrula(yol: THREE.Vector3[], pad: number): { yol: THREE.Vector3[]; kopuk: boolean } {
  if (!Car.solids.length || yol.length < 2) return { yol, kopuk: false }
  const bas = yol[0], son = yol[yol.length - 1]
  const denet = Car.solids.filter(r => !noktaKutuda(bas, r, PAD_FIZIK) && !noktaKutuda(son, r, PAD_FIZIK))
  if (!denet.length) return { yol, kopuk: false }
  const kirli = (a: THREE.Vector3, b: THREE.Vector3) =>
    denet.some(r => segmentDikdortgeniKesiyor(a.x, a.y, b.x, b.y, r, PAD_FIZIK))
  const cikti: THREE.Vector3[] = [yol[0]]
  let kopuk = false
  for (let i = 1; i < yol.length; i++) {
    const a = cikti[cikti.length - 1], b = yol[i]
    if (!kirli(a, b)) { cikti.push(b); continue }
    let onarildi = false
    // PAY KADEMELERİ: önce konfor (araç genişliği), sonra dar, en son fiziksel sınır.
    // "Hiç rota yok" demektense duvara sürtmeyen dar rota üretilir.
    for (const p of [pad, PAD_DAR, PAD_FIZIK]) {
      const bacak = yolBul(a, b, p)
      if (!bacak) continue
      const noktalar = bacak.map(q => new THREE.Vector3(q.x, q.y, 0))
      // ONAY ŞARTI: onarılmış bacakların HEPSİ temiz olmalı. (A* çıktısının ilk/son
      // bacağı kaçınılmaz gövdeye değebilir; `denet` zaten onları dışlıyor.)
      let onceki = a, tamam = true
      for (const n of noktalar) { if (kirli(onceki, n)) { tamam = false; break } onceki = n }
      if (!tamam) continue
      for (const n of noktalar) cikti.push(n)
      onarildi = true
      break
    }
    if (!onarildi) { kopuk = true; cikti.push(b) } // en iyi çaba: hedef semantiği bozulmaz
  }
  return { yol: cikti, kopuk }
}

/** Rota temizliği için aracın yarı genişliği + emniyet payı.
 *  TIR/kamyonet gövdesi binekten belirgin geniştir: sabit 1.0 pay ile tır, binek için
 *  yeterli olan boşluğa dalıp pompaya sürtüyordu (oyuncu: "arabalar pompalara takılıyor").
 *  MARİNA: pay teknenin GENİŞLİĞİNDEN (beam) türer — süperyat jet ski gibi manevra yapamaz. */
function rotaPadi(car: Car): number {
  if (car.boat) return Math.max(1.0, BOAT_SPEC[car.boat].beam / 2 + 0.55)
  return car.isTruck ? 1.35 : 1.0
}

/** ENGEL-FARKINDA ROTA (önbellekli). Aracın MEVCUT konumundan başlayarak ham waypoint
 *  listesini temizler; başlangıç noktası dönen listede yer almaz (setPath'e verilir).
 *
 *  Neden başlangıç da hesaba katılıyor: ölçümde çıkış rotalarının kirliliğinin TAMAMI
 *  "aracın bulunduğu yer → ilk waypoint" bacağındaydı (araç pompadan çıkarken KOMŞU
 *  pompanın gövdesini kesiyordu). Eski rotayiTemizle yalnız waypoint'ler ARASINI
 *  tarıyordu, o yüzden bu bacağı hiç görmüyordu. */
function temizRota(car: Car, ham: THREE.Vector3[]): THREE.Vector3[] {
  if (!Car.solids.length || ham.length === 0) return ham
  const pad = rotaPadi(car)
  // SAF ANAHTAR (determinizm): başlangıç, anahtardaki yuvarlanmış konumun KENDİSİDİR.
  // Tam konumla hesaplayıp kaba anahtara yazınca isabet "komşu konumdan hesaplanmış"
  // rotayı döndürüyor, sonuç önbelleğin doluluğuna bağlı kalıyordu (aynı tohum → farklı
  // koşu). Dönen liste başlangıcı içermez; ilk bacak ≤0.35 sapar, fiziksel pay bunu örter.
  const p0 = { x: q2(car.group.position.x) / 2, y: q2(car.group.position.y) / 2 }
  // UCUZ ANAHTAR: yalnız sayı birleştirme. Ara noktalar yerleşimden türediği için 0.1
  // ızgarada birebir tekrar eder; aracın anlık konumu sürekli değiştiğinden 0.5 ızgara.
  let anahtar = pad + '|' + q2(p0.x) + ',' + q2(p0.y)
  for (const p of ham) anahtar += '|' + q10(p.x) + ',' + q10(p.y)
  const hazir = rotaOnbellek.get(anahtar)
  if (hazir) {
    Car.rotaCacheStats.hit++
    // KOPUKLUK ARACIN ÖZELLİĞİ: önbellekten gelse bile o araca işaretlenir, yoksa
    // "ölçülebilir olsun" şartı önbellek isabetlerinde sessizce kaybolurdu.
    car.rotaKopuk = hazir.kopuk
    if (hazir.kopuk) Car.rotaKopukSayac++
    return hazir.yol
  }
  Car.rotaCacheStats.miss++
  const tam = [new THREE.Vector3(p0.x, p0.y, 0), ...ham]
  // 1) SEZGİSEL TEMİZLİK (ucuz, çoğu vakayı çözer ve rotayı KISA tutar)
  const kaba = rotayiTemizle(tam, pad)
  // 2) DOĞRULAMA + A* ONARIMI: sezgiselin bıraktığı KİRLİ bacak varsa gerçek yol
  //    buluculla değiştirilir. Buradan çıkan rotanın hiçbir bacağı (kaçınılmaz gövdeler
  //    dışında) katı cisim kesmez — ya da kopuk=true ile ölçüme düşer.
  const { yol: dogru, kopuk } = rotayiDogrula(kaba, pad)
  // KOPYALA: ham noktalar dünyadan gelen CANLI vektörler olabilir (pompa yuvası gibi);
  // önbellekte referans tutulursa ünite taşınınca saklı rota sessizce bozulurdu.
  const temiz = dogru.slice(1).map(p => p.clone())
  if (rotaOnbellek.size >= ROTA_ONBELLEK_MAX) rotaOnbellek.clear()
  rotaOnbellek.set(anahtar, { yol: temiz, kopuk })
  car.rotaKopuk = kopuk
  if (kopuk) Car.rotaKopukSayac++
  return temiz
}


export interface CarManagerOpts {
  pumpCount: () => number
  evCount: () => number
  entryChance: () => number
  evShare: () => number
  isPumpBroken: (i: number) => boolean
  isChargerBroken: (i: number) => boolean
  /** yerleştirilmiş otoparkın park noktaları (yoksa boş) */
  parkSpots: () => { id: string; pos: THREE.Vector3; stage: THREE.Vector3; rot: number }[]
  /** araçların kaçınacağı ek engeller (ör. tanker) */
  extraObstacles: () => THREE.Vector3[]
  /** geniş giriş/çıkış satın alındı mı — kapılardan ikili sıra geçilir */
  wideGates: () => boolean
  /** güncel satış fiyatları (oyuncu belirler) */
  prices: () => Record<FuelType, number>
  /** dinamik servis noktaları — pompa/şarj taşınınca değişir */
  pumpSlot: (i: number) => THREE.Vector3
  evSlot: (i: number) => THREE.Vector3
  /** taşınabilir giriş/çıkış kapı y koordinatları */
  gateInY: () => number
  gateOutY: () => number
  /** karşı (yol karşısı) istasyon aktif mi — açıksa karşı şeritten servis trafiği başlar */
  farActive?: () => boolean
  /** MARİNA: bekleme yuvaları suda kalsın (tekne rıhtım tahtasına çıkmaz) */
  isWater?: () => boolean
  /** aktif B2B sözleşmesi — FİLO ARAÇLARI garantili gelir (oyuncu raporu:
   *  "ihale aldım, kimse gelmiyor") */
  contract?: () => { fuel: FuelType; dailyLiters: number } | null
  /** ünitenin oyuncu açısı (rad) — araç slotta bu açıyla hizalanır */
  pumpAngle?: (i: number) => number
  evAngle?: (i: number) => number
  /** ÜNİTE GÖVDESİ (main.ts unitRect ile birebir) — şerit ağı 180° dönmüş ünitede
   *  kolu gövdenin ucundan dolaştırabilsin diye gövdeyi BİLMEK zorunda. Verilmezse
   *  kollar hep düz çizilir (eski davranış). */
  unitRect?: (kind: 'pump' | 'ev', i: number) => Rect | null
  /** trafik arz çarpanı (tabela+reklam; 1.0..~2.0) — spawn aralığını böler, transit cap'i büyütür */
  trafficPull?: () => number
  /** açık müşteri segmentleri (₺/müşteri ekseni) — kilitliyse null/boş, davranış klasik kalır */
  segments?: () => CarSegment[]
  /** MARİNA: gelen tekne segmentleri — TAM veri (tutar dahil).
   *  Boş dizi = kara şubesi, tekne doğmaz.
   *  DİKKAT: tutar da buradan gelir. Eskiden yalnız {id,share} geliyordu ve para
   *  activeSegments()'ten (KARA segmentlerinden) alınıyordu; süperyat sıradan araba
   *  parası ödüyordu. Marinanın "az müşteri, yüksek tutar" gerekçesi oyunda YOKTU. */
  boats?: () => CarSegment[]
  /** SU ŞUBESİ (marina): yalnız tekne doğar, araba ASLA doğmaz. */
  waterOnly?: () => boolean
  /** 4 ŞERİTLİ YOL: istasyona girecek araçların kullandığı servis şeridi x'i.
   *  undefined = tek şeritli yol (mevcut davranış). */
  serviceLane?: () => { near: number; far: number } | undefined
  // `carsPassThrough` ve `graphEnabled` SİLİNDİ (mimari karar). Araç-araç çarpışması
  // artık HİÇ YOK — oyun sahibi açıkça istedi: "gerekirse birbirinin içinden geçsinler".
  // Şeritler ayrık olduğu için pratikte zaten binmiyorlar. `graphEnabled` rezervasyon
  // grafiğinin acil kapatma valfiydi; grafik silindi, valfin kapatacağı bir şey yok.
  /** trafik ışığı durumu (çevre yolu/metropol): kırmızıda ışık hattında kuyruk oluşur */
  trafficLight?: () => { red: boolean; y: number } | null
  /** OTOYOL topolojisi: erken sapma kararı + ramp kapasitesi + zor birleşme */
  highway?: () => { decisionDist: number; rampCap: number; mergeHard: number; signReach: number; signLevel: number } | null
  /** yavaşlama şeridi dolu → müşteri otobana geri döndü (kayıp sayacı) */
  onRampFull?: () => void
  /** karşı istasyon kapı y'leri (far araç güneye gittiği için giriş +y / çıkış -y) */
  farGateInY?: () => number
  farGateOutY?: () => number
  /** şarj bulamayıp giden EV müşterisi — neden: boş ünitenin önü kapalı / arızalı /
   *  molacı (personelli = şarjcı/müdür zaten uğurlayacak) */
  onEvTurnedAway?: (neden: EvKacisNedeni) => void
  /** ünitede şarjcı var mı (molacıyı 8 sn'de kendisi uğurlar) */
  hasChargerStaff?: (i: number) => boolean
  /** tır parkı noktaları (park + manevra noktası) */
  truckSpots: () => { spot: THREE.Vector3; stage: THREE.Vector3 }[]
  /** tır park ücreti tahsilatı */
  onTruckParked?: (car: Car) => void
  onCarReady: (car: Car) => void
  onCarLost: (car: Car) => void
  /** SABIR ÇARPANI (Faz 2): yeni oyuncuya daha uzun sabır. Verilmezse 1 (nötr). */
  patienceMult?: () => number
  /** VIP MÜŞTERİ olasılığı (0..1). Verilmezse VIP hiç doğmaz. */
  vipChance?: () => number
  /** VIP sahneye girdi — ödüllü reklam teklifi burada tetiklenir */
  onVip?: (car: Car) => void
  /** kuyruk dolu olduğu için içeri hiç giremeyen müşteri (kaçandan AYRI sayılır) */
  onTurnedAway?: () => void
}

export class CarManager {
  cars: Car[] = []
  private nearTimer = 1
  private farTimer = 2.5
  private pumpOcc: (Car | null)[] = Array(16).fill(null)
  private evOcc: (Car | null)[] = Array(16).fill(null)
  // B4: otopark işgali KARARLI KİMLİKLE (Map) — pozisyon indeksi bina taşınınca/yıkılınca
  // kayıyordu ("sadece bir otopark kullanılıyor", "araçlar üst üste biniyor", 38 kayıt)
  private parkOcc = new Map<string, Car>()
  /** ŞERİT AĞI: yerleşim değişince BİR KEZ hesaplanan ayrık koridorlar.
   *  Alan adı `graph` KORUNDU (main.ts hata ayıklama bağlantısı) ama içerik artık
   *  rezervasyon defteri değil, önceden çizilmiş yollar. */
  graph = new LaneNetwork()
  private graphKey = ''
  private waitOcc: (Car | null)[] = []
  private waitOccFar: (Car | null)[] = []
  /** SAVUNMA KATMANI: katı cismin içinde ölçülen kuyruk slotları (ağ yeniden kurulunca sıfırlanır) */
  private katiSlotNear = new Set<number>()
  private katiSlotFar = new Set<number>()
  /** AKIŞ DÜZGÜNLÜĞÜ TELEMETRİSİ (yeni metrik, oyun sahibinin istediği şey).
   *  ort = ortalama hız oranı, sapma = varyans, duraklama = "durdu" olayı sayısı. */
  flowStats = { orneklem: 0, toplam: 0, kareToplam: 0, duraklama: 0, duraklamaKare: 0 }
  /** KONVEYÖR TELEMETRİSİ: durusSn = kural gereği duruşta geçen toplam araç-saniye,
   *  muaf = 30 sn kilitlenme kapısının kaç kez açıldığı. Sağlıklı akışta muaf 0'dır;
   *  patlarsa kural bir yerde kalıcı blok üretiyor demektir (testler okur). */
  /** cikis* alanları ÇIKIŞ omurgası konveyörünün ayrı defteri (1 Eyl) — giriş metrikleri
   *  eski koşularla kıyaslanabilir kalsın diye tek kaleme karıştırılmadı. */
  blokStats = { durusSn: 0, muaf: 0, cikisDurusSn: 0, cikisMuaf: 0, katilimYavas: 0 }
  /** BEKÇİ TELEMETRİSİ (blokStats'ın kardeşi): yenidenRota = T1'de kaç kez rota
   *  yeniden kuruldu, kurtarma = T2/park kapağında kaç araç kurtarıldı, kurtarmaFaz =
   *  hangi fazda. SAĞLIKLI TRAFİKTE İKİSİ DE 0'DIR; sıfırdan farklıysa rota katmanında
   *  gerçek bir kusur var demektir (testler ve canlı telemetri bunu okur). */
  kurtarmaStats: { yenidenRota: number; kurtarma: number; kurtarmaFaz: Record<string, number> }
    = { yenidenRota: 0, kurtarma: 0, kurtarmaFaz: {} }
  /** ölçüm kancası: sayaçları sıfırla (A/B koşumları ve testler için) */
  kurtarmaSifirla() { this.kurtarmaStats = { yenidenRota: 0, kurtarma: 0, kurtarmaFaz: {} } }
  /** akış özeti: ortalama hız oranı + standart sapma (0 = kusursuz akış) */
  get flow() {
    const n = Math.max(1, this.flowStats.orneklem)
    const ort = this.flowStats.toplam / n
    const varyans = Math.max(0, this.flowStats.kareToplam / n - ort * ort)
    return { ort, sapma: Math.sqrt(varyans), duraklama: this.flowStats.duraklama,
      durmaOrani: this.flowStats.duraklamaKare / n }
  }

  // İstasyon tarafı: yakın (varsayılan, x=4.2 kapı + LANE_NEAR servis şeridi). Karşı istasyon
  // için ikinci CarManager farklı gateX/serveLane ile kurulacak — bu parametreleme mevcut
  // (yakın) istasyonu HİÇ değiştirmez (varsayılanlar = eski sabit değerler).
  constructor(private scene: THREE.Scene, private lib: ModelLib | null,
              private opts: CarManagerOpts,
              private gateX = 4.2, private serveLane = LANE_NEAR) {
    // Emoji dokuları burada, ilk müşteriden önce üretilir (bkz. emojiDokulariniIsit).
    if (typeof document !== 'undefined') emojiDokulariniIsit()
  }

  // ---- Çift istasyon: karşı (far) istasyon, near'ın (ROAD_X,0) etrafında 180° dönmüşüdür.
  // Her yol {gateX, lane, dirY (seyir yönü), sideSign (istasyon yönü)} ile sistematik aynalanır.
  // Karşı pompa/şarj yoksa hiçbir far kod yolu tetiklenmez → near davranışı BİREBİR korunur.
  private geom(st: 'near' | 'far') {
    // 4 ŞERİTLİ YOL: istasyon trafiğinin şeridi SERVİS şerididir — giriş yolu, çıkış
    // birleşmesi ve yol verme hesabı hep bu şeride göre kurulur. Geçiş trafiği kendi
    // (iç) şeridinde akar ve kapılarla hiç etkileşmez. Servis şeridi yoksa tek şeritli
    // yol: değerler eskisiyle BİREBİR aynı kalır.
    const svc = this.opts.serviceLane?.()
    if (st === 'far') return {
      gateX: FAR_GATE_X, lane: svc?.far ?? LANE_FAR, dirY: -1, sideSign: 1,
      gateInY: this.opts.farGateInY?.() ?? APRON_OUT_Y,
      gateOutY: this.opts.farGateOutY?.() ?? APRON_IN_Y,
    }
    return {
      gateX: this.gateX, lane: svc?.near ?? this.serveLane, dirY: 1, sideSign: -1,
      gateInY: this.opts.gateInY(), gateOutY: this.opts.gateOutY(),
    }
  }
  /** Kuyruk slotu: ŞERİT AĞINDAN gelir (gelen omurga üzerinde sabit nokta).
   *  Katı cisme (oyuncunun koyduğu bina) denk gelirse şerit boyunca kayar. */
  private waitSpotAt(i: number, st: 'near' | 'far'): THREE.Vector3 {
    const G = this.geom(st)
    const s = this.graph.slot(st, i)
    const x = s ? s.x : G.gateX + G.sideSign * 0.8
    const y0 = s ? s.y : G.gateInY + G.dirY * (3.4 + i * 2.9)
    let y = y0
    for (let k = 0; k < 6 && Car.isSolidAt(x, y); k++) y += G.dirY * 1.4
    // İKİNCİ SİGORTA (şerit ağı slotu ZATEN eliyor — bu, ağın göremediği bir katı cisim
    // için savunma): kaçış başarısızsa araç KATI CİSMİN İÇİNE oturtulmaz. Eskiden döngü
    // biter ve gövdenin içindeki nokta aynen dönerdi; araç oraya sürüp gövdeye biniyor,
    // arkasındaki bütün kuyruk kilitleniyordu. Artık slot KAPALI işaretlenir (bir daha
    // kimseye verilmez) ve araç kapı ağzındaki temiz noktaya çekilir.
    if (Car.isSolidAt(x, y)) {
      Car.katiIcindeSlot++
      this.katiSlotlarFor(st).add(i)
      y = G.gateInY + G.dirY * QUEUE_GATE_CLEAR
    }
    return new THREE.Vector3(x, y, 0)
  }
  /** o yakada KATI CİSME denk geldiği ölçülen (bir daha dağıtılmayacak) kuyruk slotları */
  private katiSlotlarFor(st: 'near' | 'far') { return st === 'far' ? this.katiSlotFar : this.katiSlotNear }
  /** Pt → Vector3 (şerit ağı three.js bilmez, dönüşüm burada) */
  private v(p: Pt): THREE.Vector3 { return new THREE.Vector3(p.x, p.y, 0) }
  private vs(ps: Pt[]): THREE.Vector3[] { return ps.map(p => this.v(p)) }
  /** Bu istasyonun pompa/şarj servis noktaları — yaklaşma bölgeleri bunlardan TÜRETİLİR
   *  (elle aynalama yok: ünite taşınınca bölge de taşınır). */
  private unitPoints(st: 'near' | 'far'): UnitPoint[] {
    const out: UnitPoint[] = []
    for (let i = 0; i < this.opts.pumpCount(); i++) {
      const s = this.opts.pumpSlot(i)
      if (s && this.pumpStation(i) === st) {
        out.push({ id: `pump-${i}`, x: s.x, y: s.y, rect: this.opts.unitRect?.('pump', i) ?? undefined })
      }
    }
    for (let i = 0; i < this.opts.evCount(); i++) {
      const s = this.opts.evSlot(i)
      if (s && this.evStation(i) === st) {
        out.push({ id: `ev-${i}`, x: s.x, y: s.y, rect: this.opts.unitRect?.('ev', i) ?? undefined })
      }
    }
    return out
  }
  /** Bu yakanın park yerleri — otopark da ŞERİT AĞINA girer (pompa kolu kalıbının aynısı).
   *  Yaka filtresi burada: near müşteri karşı yakadaki otoparka gitmez (yolu dik keserdi). */
  private parkPoints(st: 'near' | 'far'): ParkPoint[] {
    const out: ParkPoint[] = []
    for (const s of this.opts.parkSpots()) {
      if ((s.pos.x > ROAD_X) !== (st === 'far')) continue
      out.push({ id: s.id, x: s.pos.x, y: s.pos.y, sx: s.stage.x, sy: s.stage.y })
    }
    return out
  }
  private waitOccFor(st: 'near' | 'far') { return st === 'far' ? this.waitOccFar : this.waitOcc }
  /** YERLEŞTİRME REZERVLERİ: hesaplanmış şeritlerin dikdörtgenleri (main.ts fixedObstacles okur) */
  laneRezervleri() { return this.graph.laneRezervleri() }
  /** ÜNİTEYE ARAÇ ULAŞABİLİYOR MU (bina kartı / HUD uyarısı okur) */
  uniteErisilebilir(st: 'near' | 'far', kind: 'pump' | 'ev', i: number) {
    return this.graph.unitErisilebilir(st, kind, i)
  }
  /** o şubede kaç kuyruk slotu var — şerit ağından gelir (geniş kapı 10, dar 8, marina 4) */
  private waitSlotCount(st: 'near' | 'far') {
    return this.graph.queueCount(st) || (this.opts.isWater?.() && st === 'near' ? 4 : 8)
  }
  /** pompa/şarj bu istasyona mı ait — konuma göre (yol karşısı = far) */
  // İKİNCİ SİGORTA: slot yoksa (sayım/sahne uyuşmazlığı) çökmek yerine 'near' say.
  // Tek başına main.ts'teki kırpma yeterli; bu, ileride başka bir yol sayımı bozarsa
  // oyunun tamamen donmasını engelliyor.
  private pumpStation(i: number): 'near' | 'far' { return (this.opts.pumpSlot(i)?.x ?? 0) > ROAD_X ? 'far' : 'near' }
  private evStation(i: number): 'near' | 'far' { return (this.opts.evSlot(i)?.x ?? 0) > ROAD_X ? 'far' : 'near' }
  /** istasyonda servis edecek en az bir pompa/şarj var mı — yoksa müşteri girip sonsuza dek beklemesin */
  private stationHasEquipment(st: 'near' | 'far'): boolean {
    for (let i = 0; i < this.opts.pumpCount(); i++) if (this.pumpStation(i) === st) return true
    for (let i = 0; i < this.opts.evCount(); i++) if (this.evStation(i) === st) return true
    return false
  }
  /** ARAÇ TİPİNE göre ekipman var mı — benzinli araç şarj-only istasyona girip
   *  sonsuza dek bekliyordu ("normal arabalar giriyor, hareket etmeden bekliyor" şikâyeti) */
  private stationHasEquipmentFor(kind: 'fuel' | 'ev', st: 'near' | 'far'): boolean {
    // ERİŞİLEMEZ ÜNİTE EKİPMAN SAYILMAZ: yoksa müşteri "burada pompa var" diye içeri
    // girip asla servis edilemeyeceği bir kuyrukta sabrını tüketirdi.
    if (kind === 'ev') {
      for (let i = 0; i < this.opts.evCount(); i++) {
        if (this.evStation(i) === st && this.graph.unitErisilebilir(st, 'ev', i)) return true
      }
      return false
    }
    for (let i = 0; i < this.opts.pumpCount(); i++) {
      if (this.pumpStation(i) === st && this.graph.unitErisilebilir(st, 'pump', i)) return true
    }
    return false
  }

  // ---- 3.3 Uniform grid (çarpışma taraması O(n²) → O(n)) ----
  // Hücre boyu, tarama menzilinden (ileri 3.6) büyük seçilir ki 3×3 komşuluk yetsin.
  private static readonly CELL = 4.0
  private carGrid = new Map<number, Car[]>()
  private static cellKey(x: number, y: number): number {
    // dünya ±48 birim → hücre indisi ±12; 512 taban çakışmasız tamsayı anahtar verir
    const gx = Math.floor(x / CarManager.CELL) + 256
    const gy = Math.floor(y / CarManager.CELL) + 256
    return gx * 512 + gy
  }
  private rebuildCarGrid() {
    for (const list of this.carGrid.values()) list.length = 0 // dizileri yeniden kullan (çöp üretme)
    for (const c of this.cars) {
      if (c.phase === 'gone') continue
      const k = CarManager.cellKey(c.group.position.x, c.group.position.y)
      let list = this.carGrid.get(k)
      if (!list) { list = []; this.carGrid.set(k, list) }
      list.push(c)
    }
  }
  private neighborBuf: Car[] = []
  /** (x,y) çevresindeki 3×3 hücrede bulunan araçlar — dönen dizi YENİDEN KULLANILIR
   *  (çağıran, sonucu saklamadan aynı karede tüketmeli) */
  private neighbors(x: number, y: number, ring = 1): Car[] {
    const out = this.neighborBuf
    out.length = 0
    const gx = Math.floor(x / CarManager.CELL), gy = Math.floor(y / CarManager.CELL)
    for (let i = -ring; i <= ring; i++) {
      for (let j = -ring; j <= ring; j++) {
        const list = this.carGrid.get((gx + i + 256) * 512 + (gy + j + 256))
        if (list) for (const c of list) out.push(c)
      }
    }
    return out
  }

  update(dt: number) {
    // SU ŞUBESİ: tüm waypoint'ler suda kalsın (iskele doğu kenarı 5.3 + pay)
    Car.waterMinX = this.opts.isWater?.() ? 6.5 : null

    // ── SABIR HIZI (Faz 2): baskı artık duruma göre tırmanıyor ──
    // 1) Kuyruk kalabalıksa herkes daha çabuk sinirlenir (sosyal baskı): oyuncu yığılmayı
    //    dağıtmazsa kayıp zinciri başlar — "zamana karşı yarış" hissini bu üretiyor.
    // 2) Son dilimde tüketim hızlanır: çubuk kızardıktan sonra süre GERÇEKTEN daralır,
    //    yani kırmızı bir tehdit, dekoratif bir renk değil.
    {
      const bekleyen = this.cars.reduce((n, c) =>
        n + ((c.phase === 'waiting' || c.phase === 'atPump') && !c.beingServed ? 1 : 0), 0)
      const kuyrukCarpani = bekleyen >= 6 ? 1.35 : bekleyen >= 4 ? 1.2 : 1
      for (const c of this.cars) {
        c.sabirHizi = kuyrukCarpani * (c.patienceFrac < SABIR_KIRMIZI ? 1.4 : 1)
      }
    }
    // ---- ŞERİT AĞI: yerleşim İMZASI değişince BİR KEZ hesaplanır (kare başına DEĞİL).
    // Kapı taşındı / pompa kuruldu-döndürüldü / karşı şube açıldı → şeritler geom()'dan
    // yeniden TÜRETİLİR. Aynalama elle yazılmadığı için "near'da doğru, far'da bozuk"
    // hata sınıfı imkânsız. İmza aynı kaldığı sürece hiçbir hesap yapılmaz (mobil).
    const stationsNow: StationGeom[] = ['near', 'far']
      .filter(st => st === 'near' || (this.opts.farActive?.() ?? false))
      .map(st => {
        const G = this.geom(st as 'near' | 'far')
        return { station: st, gateX: G.gateX, lane: G.lane, gateInY: G.gateInY, gateOutY: G.gateOutY,
          sideSign: G.sideSign, dirY: G.dirY, wide: this.opts.wideGates(),
          units: this.unitPoints(st as 'near' | 'far'),
          parks: this.parkPoints(st as 'near' | 'far'),
          water: (this.opts.isWater?.() ?? false) && st === 'near' }
      })
    // İMZAYA KATI CİSİM SÜRÜMÜ DE GİRER: otopark koridorları katı cisimlere göre elenir
    // (kapalı slot listeye girmez), yani oyuncu pompayı/binayı taşıyınca koridorlar
    // yeniden hesaplanmalı. Sürüm sayacı yalnız yerleşim değişince artar (kare başına DEĞİL).
    const key = stationsNow.map(g => `${g.station}:${g.gateX}:${g.gateInY}:${g.gateOutY}:${g.wide}:${g.water}`
      + `:${(g.units ?? []).map(u => `${u.id}@${u.x.toFixed(1)},${u.y.toFixed(1)}`).join(',')}`
      + `:${(g.parks ?? []).map(p => `${p.id}@${p.x.toFixed(1)},${p.y.toFixed(1)}>${p.sx.toFixed(1)},${p.sy.toFixed(1)}`).join(',')}`).join('|')
      + '|s' + Car.solidSurum
    if (key !== this.graphKey) {
      this.graphKey = key
      this.graph.rebuild(stationsNow, (x, y) => Car.isSolidAt(x, y))
      // yerleşim değişti → "katı içinde" damgaları düşer (oyuncu binayı taşımış olabilir)
      this.katiSlotNear.clear()
      this.katiSlotFar.clear()
    }

    // yoldan geçen trafik
    this.nearTimer -= dt
    this.farTimer -= dt
    const transitCount = this.cars.filter(c => c.phase === 'transit').length
    // spawn noktası doluysa bekle (üst üste doğmasınlar)
    const spawnClear = (lane: 'near' | 'far') => !this.cars.some(c =>
      c.phase === 'transit' && c.lane === lane && Math.abs(c.group.position.y) > 35)
    // trafik ARZI artık gelişmişliğe bağlı (lategame raporu Kusur #2): tabela + reklam
    // bütçesi yol trafiğini çoğaltır — sabit arz, gelir tavanını yapısal kılıyordu.
    const pull = this.opts.trafficPull?.() ?? 1
    const cap = 18 + Math.round(8 * (pull - 1))
    // MARİNA YOĞUNLUK FRENİ (Oğuz: "müşteri çok yoğun, azaltalım") — tekneler
    // araçtan kat kat büyük tutar bırakır; aynı doğum temposu marinayı boğuyordu.
    const waterMul = this.opts.waterOnly?.() ? 1.7 : 1
    if (this.nearTimer <= 0 && transitCount < cap) {
      if (spawnClear('near')) {
        this.spawnTransit('near')
        this.nearTimer = (1.5 + Math.random() * 1.8) * waterMul / pull
      } else this.nearTimer = 0.5
    }
    if (this.farTimer <= 0 && transitCount < cap) {
      if (spawnClear('far')) {
        this.spawnTransit('far')
        this.farTimer = (2.0 + Math.random() * 2.4) * waterMul / pull
      } else this.farTimer = 0.5
    }
    // ---- FİLO ARAÇLARI (ihale fixi 2. adım): sözleşme aktifken müşteri GARANTİLİ gelir.
    // Gün ~160 sn → ~20 sn'de bir filo aracı; her biri taahhüdün ~1/8'ini alır.
    // Organik satış üstüne biner → taahhüt dolabilir; oyuncu filoyu GÖZLE görür.
    const ct = this.opts.contract?.()
    if (ct && !this.opts.waterOnly?.()) {
      this.fleetTimer -= dt
      const fleetOn = this.cars.filter(c => c.segment === 'filo' && c.phase !== 'gone').length
      if (this.fleetTimer <= 0 && fleetOn < 3 && spawnClear('near')) {
        this.fleetTimer = 20
        this.spawnFleet(ct)
      }
    }

    // ══════════════════════════════════════════════════════════════════════════════
    // AKIŞ KATMANI — MÜZAKERE YOK (mimari karar: önceden hesaplanmış şerit ağı)
    //
    // SİLİNEN KATMANLAR ve NEDEN ARTIK GEREKSİZLER (lütfen GERİ EKLEMEYİN):
    //  · Araç-araç çarpışma taraması + `hold`: şeritler GEOMETRİK OLARAK AYRIK. İki araç
    //    aynı noktada olmasın diye müzakere etmiyorlar; zaten aynı noktaya gelmiyorlar.
    //    Nadir çakışma, akıcılık için ödenen ucuz bedel (oyun sahibinin açık kararı).
    //  · `dodgeRight` (sağdan kaçış) + kafa-kafaya tahkimi: kafa kafaya karşılaşma artık
    //    İMKÂNSIZ — gelen omurgada herkes kapıdan uzaklaşır, giden omurgada herkes çıkışa
    //    yaklaşır. Zıt yönlü iki araç aynı kolonda bulunamaz.
    //  · Zincir döngü kırıcı (A→B→C→A): döngü ancak BEKLEYEN araçlarla kurulur. Kimse
    //    beklemediği için döngü kurulamaz.
    //  · Yol verme (`yieldT`) + "nazik şerit": çıkış ağzı kendi kolonunda ve şeride
    //    katılma noktası giriş kuyruğundan uzakta; beklemeye gerek kalmadı.
    //  · Rezervasyon/token kapısı: bölge kapasitesi kavramı yok — şerit zaten tek sıra.
    //  · Kurtarma merdiveni (`watchT`/`stuckHits`/`softPassT`/`overrideT`/`recoverStuck`):
    //    hepsi "araç bekletildi ve kilitlendi" durumunun panzehiriydi. Kaynak yok.
    //  · `evaporate`: sıkışanı SESSİZCE siliyordu (oyuncu görmüyor, biz sayamıyorduk).
    //    Sıkışma üretecek mekanizma kalmadı; sigortaya da gerek yok.
    //  · `stationCrowdFactor` (kalabalık freni): kapasiteyi artık kuyruk slotu sayısı
    //    belirliyor. Yer yoksa müşteri KARAR NOKTASINDA yoluna devam eder (onTurnedAway),
    //    avluda birikmez. Frenin işi kilitlenmeyi önlemekti — kilitlenme kalmadı.
    //  · `gorselAyrim`: duran araç trafik hesabından çıkarıldığı için gerekmişti; şeritler
    //    ayrık olduğundan yamalayacak bir üst üste binme kalmadı (ölçüldü, bkz. rapor).
    // ══════════════════════════════════════════════════════════════════════════════

    // TEK İSTİSNA — HIZ EŞİTLEME (müzakere DEĞİL): aynı şeritte öndeki HAREKET EDEN araca
    // yaklaşan araç onun hızını KOPYALAR. Taban hız 0 değil 0.3'tür; yani kimse kimseyi
    // beklemez, sadece yavaşlar → kilitlenme matematiksel olarak üretilemez.
    for (const c of this.cars) c.speedScale = 1
    this.rebuildCarGrid()
    for (const c of this.cars) {
      if (c.phase === 'gone' || c.phase === 'atPump' || c.phase === 'parked' || c.phase === 'waiting') continue
      if (c.hayalet) continue // kurtarılan araç kimseyi beklemez: çıkana kadar tam hız
      const dir = c.headingDir()
      if (!dir) continue
      const cp = c.group.position
      const lenC = c.boat ? BOAT_LEN[c.boat] : 0
      for (const o of this.neighbors(cp.x, cp.y, c.boat ? 3 : 1)) {
        if (o === c || o.phase === 'gone' || !o.moving) continue
        // DURAN araç yol kenarı dekorudur: onu takip etmek "bekleme" olurdu.
        // BANKET KUYRUĞU da kuyruk-dışı trafik için dekordur: giriş sahneleme noktası
        // banket hattının üstünden geçer; şarja/pompaya giden araç kayan banket aracını
        // takip edince şarj ünitesi yol boyunca REZERVE bekliyordu (T2'de ölçülür servis
        // kaybı). Kuyruk üyeleri banketi zaten konveyör bloğuyla takip ediyor.
        if (c.waitIndex < 0 && o.waitIndex >= 0 && this.graph.isSpillSlot(o.station, o.waitIndex)) continue
        const dx = o.group.position.x - cp.x, dy = o.group.position.y - cp.y
        const forward = dx * dir.x + dy * dir.y
        const lenO = o.boat ? BOAT_LEN[o.boat] : 0
        // minimum takip mesafesi: gövde boyu + pay (marinada tekne boyuyla ölçeklenir)
        const sep = (lenC || lenO) ? (lenC + lenO) / 2 + 1.4 : 2.6
        if (forward < 0.2 || forward > sep * 1.6) continue
        const lx = dx - dir.x * forward, ly = dy - dir.y * forward
        if (lx * lx + ly * ly > 1.21) continue // başka şeritte → hiç ilgilenmez
        // TABAN, AYNI YÖNDE HAREKET EDEN öndekinin GERÇEK hızının altına inebilir (2 Eyl):
        // sabit 0.3 tabanı, ışıkta 0.22'ye yavaşlayan ya da konveyörle frenlenen öndekinin
        // ÜSTÜNE BİNDİRİYORDU (telemetri: leaving+transit 528, transit+transit 481 olay).
        // Kilitlenmezlik korunur: taban yalnız AYNI YÖNDE ve GERÇEKTEN HAREKET EDEN
        // (hız ≥ 0.15) öndeki için düşer — karşı akış ve DURAN öndeki (konveyör freni)
        // için 0.3 aynen kalır: burun buruna kilit yine imkânsız, kuyruğun yanından
        // geçen kapsam-dışı araç (EV, otopark) yine beklemez (T8 ölçümü korunur).
        const od = o.headingDir()
        const ayniYon = od ? od.x * dir.x + od.y * dir.y > 0.5 : false
        const taban = ayniYon && o.hizOrani >= 0.15 ? Math.min(0.3, o.hizOrani) : 0.3
        // ORANTI DEĞİL, ARALIK (2 Eyl, canlı 1054/1133: transit+transit 1.4–2.0, leaving+
        // transit 1.2–2.2): eski `forward / sep` öndekinin hızıyla ORANTILI aralığa
        // oturuyordu — 0.35'e yavaşlamış öndekinin 0.9 arkasına, kapıdan 0.15'le sürünerek
        // katılanın 0.4 arkasına kadar sokuluyordu. Şimdi hız, aralığın ARAÇ BOYU (2.2 =
        // BLOK_DUR) üstündeki payıyla ölçeklenir: aralık 2.2'ye inince taban hıza düşer,
        // taban = öndekinin hızı olduğundan aralık orada SABİTLENİR (ölçüm: T8/T9 ÇIKIŞ
        // ve KORİDOR min'leri değişmez, yol çiftleri ≥2.2). Kilitlenmezlik aynen: taban
        // hiç 0 değil, DURAN/karşı öndeki için 0.3.
        const bos = sep - 0.4
        c.speedScale = Math.min(c.speedScale, Math.max(taban, (forward - bos) / (sep - bos)))
      }
    }
    this.yolaKatilimBoslugu()
    // Sahnedeki fiziksel engeller (tanker vb.) YAVAŞLATIR ama DURDURMAZ.
    for (const c of this.cars) {
      if (c.phase === 'gone' || c.phase === 'atPump' || c.phase === 'parked') continue
      if (c.hayalet) continue // kurtarılan araç engelin de içinden geçer (ghostSolid)
      const dir = c.headingDir()
      if (!dir) continue
      for (const ob of this.opts.extraObstacles()) {
        const dx = ob.x - c.group.position.x, dy = ob.y - c.group.position.y
        const forward = dx * dir.x + dy * dir.y
        if (forward < 0.2 || forward > 3.8) continue
        const lx = dx - dir.x * forward, ly = dy - dir.y * forward
        if (lx * lx + ly * ly < 2.25) { c.speedScale = Math.min(c.speedScale, 0.35); break }
      }
    }

    // ---- TRAFİK IŞIĞI (çevre yolu/metropol): kırmızıda yol trafiği YAVAŞLAR.
    // Eskiden `hold = true` ile TAM DURUYORDU ve arkasını kilitliyordu. Tempo göstergesi
    // olarak yavaşlama yeterli — trafik burada mekanik değil, dekor.
    const tl = this.opts.trafficLight?.()
    if (tl && tl.red) {
      for (const c of this.cars) {
        if (c.phase !== 'transit') continue
        const dirY = c.lane === 'far' ? -1 : 1
        const dist = (tl.y - c.group.position.y) * dirY
        if (dist > 0 && dist < 3.2) c.speedScale = Math.min(c.speedScale, 0.22)
      }
    }

    // ---- KONVEYÖR BLOĞU (gelen omurga): öndeki bölüm boşalmadan ilerleme yok ----
    // Hız eşitlemesinden FARKI: eşitleme yalnız HAREKET EDEN öndekini kopyalar (taban
    // 0.3, kimse durmaz); blok ise kuyruk/omurga hattında DURAN öndekine karşı da
    // işler ve 2.2'de TAM durdurur. Kilitlenme üretmemesi üç sınırla garanti:
    //  1. KAPSAM: yalnız kuyruk üyeleri (waitIndex) + omurga üzerindeki pompa yolcuları.
    //     Çıkış omurgası, kollar (arm), transit, otopark/tır trafiği ve MARİNA hariç.
    //  2. KARŞI AKIŞ MUAF: burun buruna gelen iki araç birbirini BEKLEMEZ, yanından/
    //     içinden geçer (UNIT_CLEAR yakın-geçiş tasarımı) — karşılıklı fren = kilit olurdu.
    //  3. 30 SN KAPISI: yine de ilerleyemeyen aracın kuralı yalnız o araç için askıya
    //     alınır (blokMuaf) — buharlaşma/kalıcı sıkışan 0 kalır.
    this.konveyorBlok(dt)

    // ---- KUYRUK İLERLEMESİ: slotlar SABİT, araç bir öndeki slota KAYAR ----
    // Oyun sahibi: "Araç slota kayar, sırası gelince bir sonraki slota kayar. Kuyruk
    // ilerlemesi anlık değil, akıcı." Ön slot boşalınca araç oraya AKAR (ışınlanmaz).
    this.kuyrukIlerlet('near', dt)
    if (this.opts.farActive?.()) this.kuyrukIlerlet('far', dt)

    // giriş kararı — yakın şeritte y>-26'da, karşı şeritte (araç güneye gider) y<+26'da.
    // OTOYOL (rapor §6.4): karar çok daha ERKEN verilir (tesisten decisionDist birim önce)
    // ve tabela bu mesafeyi UZATIR — tabela burada birinci kaldıraç. Karar noktasında
    // yavaşlama şeridi DOLUYSA araç otobana geri döner = KAÇAN MÜŞTERİ (yeni kayıp türü).
    const hw = this.opts.highway?.()
    for (const car of this.cars) {
      if (car.phase !== 'transit' || car.converted) continue
      const gateInY = this.opts.gateInY()
      const dist = hw ? hw.decisionDist + hw.signReach * hw.signLevel : 0
      // KARAR NOKTASI KUYRUĞUN KUYRUĞUNDAN ÖNCE (2 Eyl): banket slotları yol omuzunda
      // kapıdan geriye SPILL_MAX_Y'ye kadar uzar (8 slotta −33.9). Sabit −26'da karar veren
      // araca ARKASINDA kalan slot atanıyor, araç banket kolonunda geri dönüp gelenlerle
      // burun buruna geliyordu (karşı akış muaf → 2.25'lik duran çift; T8'de ölçüldü).
      // Karar, en uzak slotun 4 birim gerisinden önce verilir: atanan slot HEP ileridedir.
      const Lk = this.graph.get(car.lane === 'near' ? 'near' : 'far')
      const kuyrukSonu = Lk && Lk.queue.length ? Lk.queue[Lk.queue.length - 1].y : null
      const decisionY = hw ? gateInY - dist
        : (kuyrukSonu != null ? Math.min(DECISION_Y, kuyrukSonu - 4) : DECISION_Y)
      // KARŞI ŞERİT (otoyol fixi #2, oyuncu: "karşı tarafa ne yapsam müşteri gelmiyor"):
      // karar noktası KENDİ kapısından dist önce olmalı (araç güneye gider → kapının
      // kuzeyi). Eski kod near kapısından −|y| türetiyordu; o nokta yolun sonundan da
      // güneyde kaldığından karşı şeritte tryEnter HİÇ tetiklenmiyordu.
      const farDecisionY = hw ? (this.opts.farGateInY?.() ?? APRON_OUT_Y) + dist
        : (kuyrukSonu != null ? Math.max(-DECISION_Y, kuyrukSonu + 4) : -DECISION_Y)
      const atDecision = car.lane === 'near'
        ? car.group.position.y > decisionY
        : car.group.position.y < farDecisionY
      if (!atDecision) continue
      car.converted = true
      if (!car.wantsEnter) continue
      if (hw) {
        // yavaşlama şeridi kuyruğu: kapasite dolu → giremez, otobana devam (kayıp)
        // Yavaşlama şeridi kapasitesi APRON'DAKİ TÜM manevra trafiğini kapsar (slot ayırmış
        // olsun olmasın). Eskiden yalnız slotsuzlar sayılıyordu → apron'a 9 araç birikip
        // fiziksel sıkışma/buharlaşma üretiyordu; şerit dolunca araç OTOBANA DÖNMELİ.
        // APRON YAKINLIK FİLTRESİ ("sürekli şerit doldu" spam fixi): karar spawn anında
        // verildiğinden 60+ birim uzaktaki sürücüler de sayılıyor ve 3'lük kapasiteyi
        // işgal ediyordu. Kapasite yalnız GERÇEKTEN apron/ramp bölgesindeki (kapıya
        // ±24 birim) manevra trafiğini sayar.
        const G2 = this.geom(car.station)
        const inRamp = this.cars.filter(o => o !== car && o.station === car.station
          && (o.phase === 'driving' || o.phase === 'waiting')
          && Math.abs(o.group.position.y - G2.gateInY) < 24).length
        if (inRamp >= hw.rampCap) { this.opts.onRampFull?.(); continue }
      }
      this.tryEnter(car)
    }

    // bekleyen yakıt müşterilerini boş (ve sağlam) pompaya yolla — pompanın istasyonuyla eşleşen müşteri
    for (let i = 0; i < this.opts.pumpCount(); i++) {
      const st0 = this.pumpStation(i)
      // ERİŞİLEMEZ ÜNİTE = BOZUK ÜNİTE (aynı kapı): kolu katı cisimle kapalıysa araç
      // oraya gönderilmez. Eskiden gönderiliyor ve gövdenin dibinde sonsuza dek bekliyordu.
      if (this.pumpOcc[i] || this.opts.isPumpBroken(i)
          || !this.graph.unitErisilebilir(st0, 'pump', i)) continue
      const st = st0
      const uygun = (c: Car) => c.station === st && c.waitIndex >= 0 && c.slotIndex === -1 && c.patience > 0
        && (c.phase === 'waiting' || c.phase === 'driving')
      // ÖNCELİK: reklamla kurtarılan VIP kuyrukta öne geçer (teklifin somut karşılığı).
      // ONUN DIŞINDA POMPAYA HEP KUYRUK BAŞI GİDER (en küçük waitIndex) — eskiden dizi
      // sırası kullanılıyordu ve ORTADAKİ araç seçilebiliyordu: önündeki dizinin içinden
      // pompaya sürüyor, konveyör bloğuna takılıp pompayı dakikalarca boş bırakıyordu
      // (T10 tanı koşusunda servis bu yüzden çökmüştü). VIP yine öne geçer; öndekilerin
      // arasından geçerken bloğa takılırsa 30 sn kapısı açar — nadir, kabul edilen bedel.
      let waiting = this.cars.find(c => c.oncelikli && uygun(c)) ?? null
      if (!waiting) {
        for (const c of this.cars) {
          if (uygun(c) && (!waiting || c.waitIndex < waiting.waitIndex)) waiting = c
        }
      }
      if (waiting) this.sendToSlot(waiting, i)
    }

    for (const car of this.cars) {
      if (car.truckSlot >= 0 && car.phase === 'parked') {
        car.stayT -= dt
        if (car.stayT <= 0) this.leaveTruckPark(car)
      }
      // SIKIŞMA BEKÇİSİ VE BUHARLAŞMA SİGORTASI SİLİNDİ.
      // NEDEN ARTIK GEREKSİZ: ikisi de "araç bekletildi → kilitlendi" zincirinin
      // panzehiriydi. Şerit ağında araç hiç durdurulmuyor (taban hız 0.3), şeritler
      // ayrık ve kafa kafaya karşılaşma imkânsız → kilitlenecek bir durum üretilemiyor.
      // `evaporate` özellikle zararlıydı: sıkışan müşteriyi SESSİZCE siliyordu, oyuncu
      // kaybı görmüyor, biz de sayamıyorduk. Artık her müşteri ya servis edilir, ya
      // sabrı biter (görünür kayıp), ya da karar noktasında yoluna devam eder.
      car.update(dt)
      // İLERLEME BEKÇİSİ: sıkışan araç için TEK garanti noktası (bkz. BEKCI_* sabitleri).
      // car.update'ten SONRA çağrılır ki bu karenin gerçek yer değiştirmesi ölçülsün.
      this.bekci(car, dt)
      // AKIŞ DÜZGÜNLÜĞÜ ÖRNEKLEMESİ (yeni metrik): yalnız YOL ALMASI gereken araçlar.
      // KONVEYÖR DURUŞU HARİÇ: kural gereği sırasını bekleyen araç (blokFren < 0.15)
      // "akış kusuru" değildir — slotunda bekleyen araç nasıl sayılmıyorsa bu da sayılmaz.
      // (Kuralın kendisi kalıcı blok üretirse blokStats.muaf patlar; testler onu okur.)
      const movingPhase = car.phase === 'transit' || car.phase === 'driving'
        || car.phase === 'leaving' || car.phase === 'toPark'
      if (movingPhase && car.moving && car.blokFren >= 0.15) {
        const f = this.flowStats
        f.orneklem++
        f.toplam += car.hizOrani
        f.kareToplam += car.hizOrani * car.hizOrani
        if (car.hizOrani < 0.15) {
          f.duraklamaKare++
          if (!car.durdu) { f.duraklama++; car.durdu = true }
        } else car.durdu = false
      } else car.durdu = false
      if ((car.phase === 'waiting' || car.phase === 'atPump') && car.patience <= 0 && !car.beingServed) {
        car.showFeedback('😡')
        this.releaseCar(car)
        this.onLost(car)
      }
    }

    // GÖRSEL AYRIM (gorselAyrim) SİLİNDİ — ÖLÇÜLDÜ, gereksiz.
    // Görevi "duran araç trafikten çıkarıldığı için üst üste binen gövdeleri itmek"ti.
    // Yük testinde iç içe geçme AKIŞ / YERLEŞİM diye ayrıştırıldı: akış kaynaklı kalem
    // şerit ayrıklığıyla zaten 0.04–0.23 çift/kare'ye indi (eşik 0.3). Geriye kalan
    // kalem, iki DURAN aracın komşu ünitelerde yan yana olmasıdır — gorselAyrim onu
    // zaten düzeltmiyordu (atPump/atPump çiftini bilerek atlıyordu, nozül hizası bozulmasın
    // diye). Yani yama, kalan sorunun panzehiri değildi; kaynağı yok olunca kendisi de gitti.

    this.cars = this.cars.filter(c => {
      if (c.phase === 'gone') return false
      if ((c.phase === 'transit' || c.phase === 'leaving') && Math.abs(c.group.position.y) > 42.5) {
        c.dispose(this.scene)
        return false
      }
      // MARİNA TEMİZLİĞİ (Oğuz: "marinada neden arabalar var"): su şubesinde tekne
      // olmayan her araç anında kaldırılır — save yüklenmeden önceki karelerde
      // kara varsayılanıyla doğmuş arabalar denizde yüzüyordu.
      if (this.opts.waterOnly?.() && !c.boat) {
        c.dispose(this.scene)
        return false
      }
      return true
    })
  }

  private onLost(car: Car) { this.opts.onCarLost(car) }

  /**
   * İLERLEME BEKÇİSİ — araç başına, kare başına. Kapsam: YOL ALMASI GEREKEN fazlar
   * (`driving`, `toPark`, `leaving`). Bu üç fazın zaman aşımı YOKTU; sabır yalnız
   * `waiting`/`atPump`'ta işlediği için buralarda kilitlenen araç sonsuza dek kalıyordu.
   *
   * MEŞRU DURUŞLAR KAPSAM DIŞI (kurtarma bir CEZA değil, son çaredir):
   *  · `waiting`/`atPump`/`parked`: durmaları GEREKİR (sabır ve stayT kendi saatlerini tutar),
   *  · konveyör freni (`blokT > 0` ve muafiyet henüz açılmamış): araç sırasını bekliyor —
   *    sayaç DONDURULUR, sıfırlanmaz (fren-bırak salınımı bekçiyi sonsuza dek
   *    sıfırlayabilirdi). Donma en fazla BLOK_KILIT_SN sürer: kural kendi kapısını açar,
   *    bekçi oradan devralır (tools/tests/bekci-check.mjs senaryo d bunu ölçer),
   *  · tanker `isBlocked` beklemesi: tanker Car değil (ayrı sınıf), bu döngüye hiç girmez.
   */
  private bekci(car: Car, dt: number) {
    const izlenen = car.phase === 'driving' || car.phase === 'toPark' || car.phase === 'leaving'
    if (car.phase !== 'toPark') car.parkVarisT = 0
    if (!izlenen) { car.bekciSifirla(); return }
    if (car.phase === 'toPark') car.parkVarisT += dt
    // KONVEYÖR KURALI TUTUYORSA sayaç DONAR (sıkışma değil, sırasını bekliyor). Muafiyet
    // AÇIKSA (blokMuaf) donma biter: kural o araç için askıya alındı, artık mazereti yok.
    // Donma KALICI OLAMAZ: blokT ya 30 sn'de muafiyete çıkar ya da kural kapsamından
    // çıkınca sıfırlanır — yani bekçinin garantisi en kötü ihtimalle 30 sn gecikir.
    if (car.blokT > 0 && !car.blokMuaf) return
    // İLERLEME = nihai hedefe, bugüne kadarki EN YAKIN mesafeden 0.5 birim daha yakın.
    // Uzaklaşmak sayacı bozmaz (manevra), yaklaşmak sıfırlar; dönüp durmak ise ilerleme
    // DEĞİLDİR — kalıcı sıkışmanın gerçek tanımı budur.
    const uzak = car.hedefUzakligi()
    if (uzak < car.bekciMesafe - BEKCI_ILERLEME) {
      car.bekciMesafe = uzak
      car.bekciT = 0
      car.bekciRotaT = 0
      return
    }
    car.bekciT += dt
    car.bekciRotaT = Math.max(0, car.bekciRotaT - dt)
    // PARK KAPAĞI: otoparka/tır parkına gidip de yerine varamayan araç, yavaşça
    // sürünüyor olsa bile yeri işgal ediyor — 45 sn'de yer serbest bırakılır.
    if (car.bekciT >= BEKCI_KURTARMA_SN || car.parkVarisT > BEKCI_PARK_SN) { this.kurtar(car); return }
    if (car.bekciT >= BEKCI_ROTA_SN && car.bekciRotaT <= 0) {
      car.bekciRotaT = BEKCI_ROTA_SN            // araç başına en fazla 6 sn'de bir
      this.yenidenRotala(car)
    }
  }

  /**
   * T1 — TEK YENİDEN ROTALAMA NOKTASI. Aracın GÜNCEL konumundan güncel hedefine
   * (faz + slotIndex/waitIndex/park kolu) rotayı baştan kurar. Şimdilik mevcut
   * üreticileri (entryPath/queuePath/parkEntryPath/cikisRotasi) kullanır; gerçek yol
   * bulma (A*, `yolBul`) indiğinde SADECE bu gövde değişir — çağıran (bekci) aynı kalır.
   * Sayaç artıyorsa: rota bir yerde geçilemez bir hedefe çıkıyor demektir.
   */
  private yenidenRotala(car: Car) {
    this.kurtarmaStats.yenidenRota++
    const p = car.group.position
    const G = this.geom(car.station)
    // hâlâ yol tarafındaysa kapıdan girmeli (düz çizgi çitten geçerdi)
    const yolda = (G.sideSign < 0 ? (G.gateX - p.x) : (p.x - G.gateX)) < -0.3
    if (car.phase === 'driving') {
      if (car.slotIndex >= 0) {
        const s = car.kind === 'ev' ? this.opts.evSlot(car.slotIndex) : this.opts.pumpSlot(car.slotIndex)
        car.setPath(temizRota(car, this.entryPath(s, car.station, yolda)), () => this.arriveAtSlot(car))
        return
      }
      if (car.waitIndex >= 0) {
        car.setPath(temizRota(car, this.queuePath(car.waitIndex, car.station, yolda)), () => { car.phase = 'waiting' })
        return
      }
    } else if (car.phase === 'toPark') {
      if (car.truckSlot >= 0) {
        const s = this.opts.truckSpots()[car.truckSlot]
        if (s) {
          car.reversing = false
          car.setPath(temizRota(car, [s.stage.clone()]), () => {
            car.reversing = true
            car.setPath([s.spot.clone()], () => {
              car.reversing = false
              car.phase = 'parked'
              car.stayT = 14 + Math.random() * 18
              this.opts.onTruckParked?.(car)
            })
          })
            return
        }
      }
      if (car.parkLane) {
        const lane = car.parkLane
        const sp = this.opts.parkSpots().find(s => s.id === lane.id)
        car.setPath(temizRota(car, this.vs(this.graph.parkEntryPath(lane))), () => {
          car.phase = 'parked'
          if (sp) car.group.rotation.z = sp.rot + (lane.side < 0 ? Math.PI : 0)
        })
        return
      }
      // YAĞ DEĞİŞİMİ KÖRÜĞÜ: hedefi (kapı ağzı + içerisi) CarManager bilmez, main.ts
      // sürüyor ve kendi 45 sn kapağı var. Rotasını burada EZMEYİZ; T2 yine korur.
      return
    }
    // kalan her durum (leaving ya da hedefsiz kalmış araç): çıkış şeridi baştan kurulur
    car.setPath(temizRota(car, this.cikisRotasi(car)))
  }

  /**
   * T2 — KURTARMA. Son çare, AMA SESSİZ DEĞİL: araç silinmez, tuttuğu HER kaynağı
   * bırakır (kuyruk slotu · pompa/şarj yuvası · otopark yeri · tır yeri) ve hayalet
   * olarak çıkışa sürer. Servis edilmemiş müşteri GÖRÜNÜR kayıptır (onCarLost).
   * Her çağrı sayılır (kurtarmaStats + 'kurtarma' telemetri olayı): yol bulma indikten
   * sonra bu sayaç 0 olmalı — ama sigortanın kendisi kalmalı, çünkü garanti odur.
   */
  private kurtar(car: Car) {
    const faz = car.phase
    this.kurtarmaStats.kurtarma++
    this.kurtarmaStats.kurtarmaFaz[faz] = (this.kurtarmaStats.kurtarmaFaz[faz] ?? 0) + 1
    // SERVİS EDİLMEMİŞ MÜŞTERİ: pompaya/kuyruğa giderken kilitlenen araç hiç yakıt
    // almadı. Sessizce yok olmaz — oyuncu parayı ve itibarı ekranda kaybeder.
    // (toPark/leaving fazındaki araç ya servis edilmiştir ya da kaybı zaten sayılmıştır.)
    const servissiz = faz === 'driving' && (car.slotIndex >= 0 || car.waitIndex >= 0)
      && car.filled === 0 && car.chargedKwh === 0 && !car.beingServed && !car.autoServed
    // TIR YERİ releaseCar'ın kapsamında değil (tır parkı ayrı defter) — önce o bırakılır.
    if (car.truckSlot >= 0) { this.truckOcc[car.truckSlot] = null; car.truckSlot = -1 }
    car.truckStagePos = null
    // parkLane sıfırlanır ki releaseCar otopark ÇIKIŞ koridorunu denemesin: o koridor da
    // tıkalı olabilir; kurtarılan araç doğrudan çıkış şeridine çıkar.
    car.parkLane = null
    car.reversing = false
    this.releaseCar(car)   // KANONİK bırakma: kuyruk slotu + pompa/şarj + otopark kaydı
    car.hayalet = true
    car.ghostSolid = true  // önündeki ne varsa içinden geçer — nadir, tasarım gereği
    car.blokMuaf = true
    car.blokT = 0
    car.speedScale = 1
    car.cikisYolu = null
    // rotanın son noktası |y| = 44 → despawn eşiği 42.5'i MUTLAKA geçer.
    car.setPath(this.cikisRotasi(car)) // HAYALET: engel tanımaz, temizRota gereksiz
    car.bekciSifirla()
    car.parkVarisT = 0
    if (servissiz) this.onLost(car)
  }


  /**
   * KONVEYÖR BLOĞU — gelen omurga/kuyruk hattında + GİDEN omurgada öndekine mesafe kapısı.
   * Araç, öndeki araca BLOK_MESAFE'den (3.0) fazla yaklaşınca mesafeyle orantılı
   * yavaşlar ve BLOK_DUR'da (2.2) tamamen durur. Kapsam bilerek dar (kilitlenme
   * doğmasın): GİRİŞTE yalnız kuyruk üyeleri + omurga ÜZERİNDEKİ pompa yolcuları,
   * ÇIKIŞTA (1 Eyl) yalnız giden omurga (xOut) kolonundaki leaving araçları fren yapar;
   * öndeki olarak da yalnız KENDİ hattının araçları sayılır (giriş hattı ile çıkış
   * hattı birbirini asla beklemez). atPump/arm/transit/otopark trafiği ve tekneler
   * (marina aralıkları kendi ölçeğinde) kapsam DIŞI.
   */
  /**
   * YOLA KATILIM BOŞLUĞU (2 Eyl): çıkış kapısından şeride katılan araç, şeritte
   * katılım noktasına YAKLAŞAN transit varsa boşluk bırakır. Telemetride
   * leaving+transit çakışmalarının kaynağı kapı ağzıydı: araç yola çıktığı anda
   * arkasından gelen transit onun üstüne biniyordu (transit öndekini 0.3 tabanla
   * kopyalar, kapıdan çıkan ise sıfırdan hızlanmaz — aynı karede yan yana).
   * KİLİTLENMEZLİK: (1) araç DURMAZ, 0.15'e iner (sürünür); (2) transit hiç
   * durmadığı ve doğuş aralığı sonlu olduğu için boşluk KESİN gelir; (3) katılan
   * araç henüz şerit dışında olduğundan transiti frenlemez → karşılıklı bekleme yok.
   * Kapsam yalnız `leaving` + rotasının güncel hedefi şerit katılım noktası olan
   * (x = şerit kolonu) ve henüz şerit kolonuna girmemiş araç.
   */
  private yolaKatilimBoslugu() {
    for (const c of this.cars) {
      if (c.phase !== 'leaving' || c.boat || c.kalanNokta < 2) continue
      const L = this.graph.get(c.station)
      if (!L) continue
      const hedef = c.hedefNokta
      if (!hedef) continue
      const cp = c.group.position
      // güncel bacak şeride katılım bacağı mı: hedef şerit kolonunda, araç henüz değil.
      // Kapsam sınırı 1.1 = takip kuralının yanal kapsamı (lx²+ly² ≤ 1.21): dışındayken
      // transit bu aracı görmez → araç sürünür, transit geçer; içine girince transit onu
      // öndeki sayar ve ARALIK kuralıyla takip eder → araç tam hızla katılır. Eski 0.6
      // sınırında 0.6–1.1 bandında İKİ kural aynı anda işliyordu: araç 0.15'le sürünür,
      // arkadaki transit de onu 0.15'le kopyalar — karşılıklı sürünme, aralık 1.5'te
      // donuyordu (ölçüldü T1: YOL min 1.50; canlı leaving+transit 1.2–2.2 sınıfı).
      if (Math.abs(hedef.x - L.lane) > 0.3 || Math.abs(cp.x - L.lane) < 1.1) continue
      let yaklasan = false
      // BOŞLUK KABULÜ (2 Eyl): sabit −1..7 penceresi yerine "katıldığımda arkamdaki
      // transit kaç birim geride kalır": ikisi de tam hızla, transit s − dc geride biter.
      // < sep+pay (3.2) kalacaksa sürün, yoksa git. Sabit 7 penceresi kolona 2 birim kala
      // bile sürünüyordu → transit dibine yetişip onu kopyalıyordu. Servis etkisi 6 tohum
      // ortalamasında gürültü sınırında (T1 307→301, T3 455→452).
      const dc = Math.hypot(hedef.x - cp.x, hedef.y - cp.y)
      for (const o of this.neighbors(L.lane, hedef.y, 2)) {
        if (o === c || o.phase !== 'transit' || o.lane !== c.lane) continue
        if (Math.abs(o.group.position.x - L.lane) > 0.6) continue
        // katılım noktasına akış yönünde uzaklık (eksi = noktayı az önce geçmiş)
        const s = (hedef.y - o.group.position.y) * L.dirY
        if (s > -1 && s < dc + 3.2) { yaklasan = true; break }
      }
      if (yaklasan) { c.speedScale = Math.min(c.speedScale, 0.15); this.blokStats.katilimYavas++ }
    }
  }

  /** kapı ağzı: çıkış kapısını geçmiş (akış yönünde), şeride henüz katılmamış leaving araç */
  /** X bandı ŞART: yalnız xOut kolonu ile şerit arasındaki bacak. Bant olmadan kapı
   *  hizasındaki otoparktan çıkan araçlar da kümeye giriyor, dik açıyla karşılaşan iki
   *  araç birbirini bekleyip 30 sn kapısını açıyordu (ölçüldü: T11 çıkış muaf 6). */
  private kapiAgzinda(c: Car, L: { gateOutY: number; dirY: number; lane: number; xOut: number }): boolean {
    const p = c.group.position
    const s = (p.y - L.gateOutY) * L.dirY
    if (s <= -0.5 || s >= 9 || Math.abs(p.x - L.lane) <= 0.6) return false
    const lo = Math.min(L.xOut, L.lane) - 0.6, hi = Math.max(L.xOut, L.lane) + 0.6
    return p.x > lo && p.x < hi
  }

  /** İki aracın ROTA KAVŞAĞI ve her birinin kavşağa İMZALI mesafesi. Kavşak: sonraki
   *  noktaları aynıysa o nokta; birinin sonraki noktası öbürünün ŞU ANKİ parçası (konum→
   *  hedef, GERİYE BLOK_MESAFE uzatılmış) üzerindeyse o nokta. Geriye uzatma: kavşağı az
   *  önce geçmiş araç da öndekidir — mesafesi eksi çıkar, arkadakinin boşluğu "kavşağa
   *  kalan + öbürünün geçtiği" olur, yani rota boyu gerçek aralık (ölçüldü: T11 kolon,
   *  sıradan gelen araç 0.3 önce geçmiş kolon aracının üstüne dönüyordu, min 0.00).
   *  İkisi de tutuyorsa sözlük sırasına göre küçüğü — iki araç da AYNI noktayı ve aynı
   *  sayıları bulsun (simetri şart; yoksa ikisi de kendini önde sayar). */
  private kavsak(cp: THREE.Vector3, ch: THREE.Vector3 | null, op: THREE.Vector3, oh: THREE.Vector3 | null): { kc: number, ko: number } | null {
    if (!ch || !oh) return null
    const kucuk = ch.x < oh.x || (ch.x === oh.x && ch.y < oh.y)
    if (Math.abs(ch.x - oh.x) < 0.3 && Math.abs(ch.y - oh.y) < 0.3) {
      const J = kucuk ? ch : oh
      return { kc: Math.hypot(J.x - cp.x, J.y - cp.y), ko: Math.hypot(J.x - op.x, J.y - op.y) }
    }
    // n noktasının a→b parçası üzerindeki imzalı konumu (a'dan itibaren; parça dışı → null)
    const uzerinde = (n: THREE.Vector3, a: THREE.Vector3, b: THREE.Vector3): number | null => {
      const sx = b.x - a.x, sy = b.y - a.y, L = Math.hypot(sx, sy)
      if (L < 0.05) return null
      const t = ((n.x - a.x) * sx + (n.y - a.y) * sy) / L
      if (t < -BLOK_MESAFE || t > L) return null
      const px = a.x + sx * t / L, py = a.y + sy * t / L
      return Math.hypot(n.x - px, n.y - py) <= 0.3 ? t : null
    }
    const tO = uzerinde(ch, op, oh)   // c'nin hedefi o'nun parçasında → kavşak ch
    const tC = uzerinde(oh, cp, ch)   // o'nun hedefi c'nin parçasında → kavşak oh
    const chSec = tO !== null && (tC === null || kucuk)
    if (chSec) return { kc: Math.hypot(ch.x - cp.x, ch.y - cp.y), ko: tO! }
    if (tC !== null) return { kc: tC, ko: Math.hypot(oh.x - op.x, oh.y - op.y) }
    return null
  }

  private konveyorBlok(dt: number) {
    for (const c of this.cars) {
      c.blokFren = 1
      // KURTARILAN ARAÇ KURAL DIŞI: tek işi sahneden çıkmak (kaynağı zaten bıraktı).
      if (c.hayalet) { c.blokT = 0; continue }
      // 30 sn kapısı açık: kural bu araç için askıda. Mevcut bacağını bitirince kapanır.
      if (c.blokMuaf) { if (!c.moving) { c.blokMuaf = false; c.blokT = 0 } continue }
      // ÇIKIŞ KAPSAMI (1 Eyl): leaving de bloğa girer — ama yalnız giden omurga kolonunda
      // (aşağıdaki kapsam filtresi). Faz analizi kanıtı ve kilitlenmezlik gerekçesi
      // dosya başındaki KONVEYÖR bloğunda.
      const cikista = c.phase === 'leaving'
      if (c.phase !== 'driving' && c.phase !== 'waiting' && !cikista) { c.blokT = 0; continue }
      // BLOKT BAYAT KALMASIN: sayaç "kural şu an ilerlememi engelliyor" demektir ve
      // bekçi bunu MEŞRU DURUŞ sayıp saatini dondurur. Kapsam dışına çıkan araçta eski
      // değer kalsaydı bekçi o araç için SONSUZA DEK donardı — yani kalıcı sıkışma
      // garantisi tek bir bayat sayı yüzünden delinirdi (ölçüldü, tanı koşusu).
      if (c.boat) { c.blokT = 0; continue }      // marina: tekne boyu araç ölçeğinde değil
      // slotunda duran araç frenlemez (terfi kapısı kuyrukIlerlet'te sayar — o yalnız
      // 'waiting' araçlar içindir; sürüş fazında duran araçta sayaç sıfırlanır)
      if (!c.moving) { if (c.phase !== 'waiting') c.blokT = 0; continue }
      const L = this.graph.get(c.station)
      if (!L) continue
      const cp = c.group.position
      const dir = c.headingDir()
      if (!dir) continue
      let agizda = false, koridorda = false
      if (cikista) {
        // ÇIKIŞ KAPSAMI: (a) GİDEN omurga (xOut) kolonunda omurga yönünde seyreden araç,
        // (b) KAPI AĞZI (2 Eyl): kapıdan çıkmış, şeride henüz katılmamış araç. (b) yoktu —
        // koldan omurgaya DÖNEN (yatay seyir) araçla birlikte kapsam dışıydı. Canlı yığılma
        // olaylarının (#4999, #5016) %60'ı buradaydı: yola katılım boşluğu kuralı öndekini
        // 0.15'e düşürünce arkadakiler onu beklemeden üstüne biniyordu (lab: T8 kapı ağzı
        // çiftlerinin %48'i < 1.8, min 0.49). Kilitlenmezlik: kapı ağzındaki öndeki HİÇ
        // durmaz (katılım kuralı sürünmeyi garanti eder), şeride girince kümeden çıkar.
        agizda = this.kapiAgzinda(c, L)
        // (c) KOLONA KATILAN (2 Eyl): sonraki noktası kolon üzerinde ve pencere içindeyse
        // (pompa kolundan / otopark sırasından yatay yanaşan araç) kapsamdadır — yalnız
        // kavşak kuralı işler (geometrik kural için kolon araçları yanaldır, dokunmaz).
        // Yoktu: katılan araç kolona girene dek görünmezdi, girdiği an ileri<0.2 → muaf →
        // kolondaki aracın üstüne dönüyordu (ölçüldü: T11 ÇIKIŞ kolon min 0.00/0.01).
        const h = c.hedefNokta
        const katilan = !!h && Math.abs(h.x - L.xOut) <= 0.6 && Math.hypot(h.x - cp.x, h.y - cp.y) <= BLOK_MESAFE + CAR_SPEED * dt
        if (!agizda && !katilan && (Math.abs(cp.x - L.xOut) > 0.6 || Math.abs(dir.y) < 0.7)) {
          // (d) İSTASYON İÇİ GİDEN BACAK (2 Eyl, canlı #5815): otopark çıkış koridorunda /
          // pompa kolunda kolona doğru seyreden araç da kapsamdadır — ama YALNIZ kavşak
          // kuralıyla (aşağıda `koridorda`: geometrik öndeki kuralı bu araç için işlemez).
          // Yoktu: iki lotun aracı aynı anda koridora çıkıp aynı hedefe kilit adımda
          // sürüyordu, ikisi tam aynı noktada (-3.7,18.6) kolona kadar üst üste (1054
          // bundle'ı: 12 iç içe olayının 5'i koridor/kol çiftleri, biri 0.00). Yoldaki
          // (hedefi şeritte olan) araç kapsam DIŞI kalır: transit kopyalama kuralıyla
          // çakışmasın. Kilitlenmezlik: kavşak sırası mesafe + kimlikle kesin, uzak
          // araç zaten fren penceresine girmez (boşluk = min(kavşağa kalan, kuş uçuşu)).
          if (!h || Math.abs(h.x - L.lane) <= 0.6) { c.blokT = 0; continue }
          koridorda = true
        }
      } else {
        const omurgada = Math.abs(cp.x - L.xIn) <= 0.6
        // KAPSAM: kuyruk üyesi (slota giden/kayan) her yerde; YAKIT pompası yolcusu YALNIZ
        // omurga boyunca seyrederken (kola dönen araç bloktan çıkar — kural 3: arm'de blok
        // yok). EV'ler kapsam DIŞI: şarj kuyruğu yok, EV omurgada yakıt kuyruğunun yanından
        // kendi koluna geçer — bloğa alınsa duran kuyruğun arkasında boşuna kilitlenirdi
        // (ölçüldü: T8 tanı koşusunda durusSn'nin büyük kalemi buydu).
        if (c.waitIndex < 0 && !(c.slotIndex >= 0 && c.kind === 'fuel' && omurgada && Math.abs(dir.y) >= 0.7)) { c.blokT = 0; continue }
      }
      // PENCERE ≥ TABAN + BİR ADIM (2 Eyl): 3.0 − 2.55 = 0.45, tam hız adımı ise 7·dt —
      // dt ≥ 0.065'te (yük testi 0.1; canlıda düşük fps) DURAN öndekine 3.06'dan tek
      // karede 2.36'ya iniliyordu: pencere dışındaki araç frensiz, adım kırpması hiç
      // çalışmıyordu (ölçüldü: T8 tohum 2/3 "konveyör kapısı delik"). Pencere adım
      // boyuyla büyür; kırpma o kareyi 2.55'te durdurur.
      const pencere = Math.max(BLOK_MESAFE, BLOK_TABAN + CAR_SPEED * dt)
      let gap = Infinity
      for (const o of this.neighbors(cp.x, cp.y, 1)) {
        if (o === c || o.phase === 'gone' || o.station !== c.station || o.boat) continue
        // öndeki olarak yalnız AYNI hattın araçları: girişte kuyruk üyeleri + omurgadaki
        // yolcular (atPump kendi kolunda UNIT_CLEAR kadar ayrıktır, bloğa girmez — kural 3);
        // çıkışta yalnız aynı xOut kolonundaki leaving araçlar (çapraz akış muaf kalır).
        let agizCifti = false
        if (cikista) {
          if (o.phase !== 'leaving') continue
          // ORTAK HEDEF NOKTASI (2 Eyl): iki leaving aracın SONRAKİ rota noktası aynıysa
          // sıra geometriyle değil ROTAYLA belirlenir — noktaya kalan yolu kısa olan
          // öndedir, fark < pencere ise arkadaki frenler. Neden: pompa kolundan/otopark
          // çıkışından giden kolona KATILAN araç kolon dışındayken kapsam dışıydı,
          // kolondaki araç da onu kolona girene dek öndeki saymıyordu → aynı anda
          // giren iki araç yan yana (ileri < 0.2, muaf) kalıyor, aynı hedefe kilit
          // adımda sürüp KALICI üst üste biniyordu (ölçüldü: T11 kapı ağzı min 0.00
          // 140 sn boyunca; canlı #5367 iki araç tam (2.7,21)'de). Kesin sıralama
          // (eşitlikte yaratılış kimliği) → çevrim imkânsız, koni/yön şartı gereksiz.
          // Bu çift için geometrik kural ÇALIŞMAZ (aynı çifte iki kural = çevrim kapısı).
          // KAVŞAK GENELLEMESİ (2 Eyl, T11 kolon min 0.01): ortak nokta yalnız "aynı sonraki
          // nokta" değil — bir aracın SONRAKİ noktası öbürünün ŞU ANKİ parçası (konum→hedef)
          // ÜZERİNDEYSE de aynı kavşaktır. Ölçüldü: otopark sırasından (x=…→4.5,11.6) gelen
          // araç pompa kolonundan (4.5,2.5→14) çıkan aracın parçasına dik giriyor; katılana
          // dek hedefleri farklı, kolona girdiği an ileri<0.2 (yan yana muaf) → üst üste.
          // Her iki taraf da AYNI kavşak noktasını seçmeli ki sıralama simetrik olsun:
          // adaylar sabit sırayla toplanır, birden fazlaysa sözlük sırasına göre en küçüğü.
          const op = o.group.position
          const kv = this.kavsak(cp, c.hedefNokta, op, o.hedefNokta)
          if (kv) {
            const fark = kv.kc - kv.ko
            const onde = fark > 0.02 || (fark > -0.02 && c.group.id > o.group.id)
            if (onde) {
              // BOŞLUK: öndeki kavşağı geçtiyse rota boyu aralık (kalan + geçtiği). Henüz
              // geçmediyse "kavşağa kalan" ile "kuş uçuşu"nun küçüğü — kavşağa DUR tabanından
              // yakın gelinmez, öndekine de sokulunmaz. ETA farkı (kc−ko) DEĞİL: dik katılımda
              // o fark kolona 2.7 uzaktaki aracı pompa başında durduruyordu, sonraki müşteri
              // slota giremiyordu (ölçüldü: T10 servis 144 → 129). Aynı hatta (kuş uçuşu =
              // kc−ko) eski davranış birebir kalır.
              const g = kv.ko <= 0 ? fark : Math.min(kv.kc, Math.hypot(op.x - cp.x, op.y - cp.y))
              if (g < gap) gap = g
            }
            continue
          }
          if (koridorda) continue // koridor/kol aracı için yalnız kavşak kuralı
          const oKolonda = Math.abs(o.group.position.x - L.xOut) <= 0.6
          if (!oKolonda && !this.kapiAgzinda(o, L)) continue
          agizCifti = agizda || !oKolonda
        } else {
          if (o.phase !== 'driving' && o.phase !== 'waiting') continue
          if (o.waitIndex < 0 && !(o.slotIndex >= 0 && Math.abs(o.group.position.x - L.xIn) <= 0.6)) continue
        }
        // KARŞI AKIŞ MUAF: burun buruna gelen araç beklenmez (bekle → karşılıklı kilit).
        // Yanından/içinden geçer — UNIT_CLEAR yakın-geçiş tasarımının devamı.
        const od = o.headingDir()
        if (od && od.x * dir.x + od.y * dir.y < -0.3) continue
        const dx = o.group.position.x - cp.x, dy = o.group.position.y - cp.y
        const ileri = dx * dir.x + dy * dir.y
        if (ileri < 0.2 || ileri > pencere) continue
        // yanal pencere 1.2: slota ÇAPRAZ yanaşan araçların (banket katılımı) izdüşümü
        // 0.9'u aşabiliyordu — ölçüldü: aynı anda katılan iki araç 2.2'ye sokuluyordu.
        // Öndeki kümesi zaten yalnız kuyruk/omurga araçları; komşu kolonlar (çıkış 1.05,
        // transit şeridi 1.37) öndeki KAPSAMINA girmediği için pencere onlara değmez.
        const lx = dx - dir.x * ileri, ly = dy - dir.y * ileri
        if (lx * lx + ly * ly > 1.44) continue
        // KAPI AĞZI ÇİFTİ: farklı rotalardan (kapı bacağı / otopark çıkışı) gelen iki araç
        // yan yana 0.9 aralıkla birbirini "öndeki" sayıp KARŞILIKLI bekliyordu (ölçüldü:
        // T11 çıkış muaf 6, min 0.00). Öndeki yalnız 45° koni içinde (ileri ≥ yanal) VE
        // aynı yöne seyreden (dot > 0.3) araçtır — iki koşul birlikte karşılıklı bekleme
        // geometrisini imkânsız kılar (koni karşılıklıysa rotalar ≥ 90° ayrışır, dot ≤ 0).
        if (agizCifti && (ileri * ileri < lx * lx + ly * ly || !od || od.x * dir.x + od.y * dir.y < 0.3)) continue
        if (ileri < gap) gap = ileri
      }
      if (gap < pencere) {
        // yumuşak fren: 3.0'da tam hız → 2.2'de sıfır, mesafeyle orantılı. Ek olarak
        // adım kırpılır: ayrık zaman adımı öndekine BLOK_TABAN'dan fazla yaklaştıramaz
        // (kaba dt tek karede eşiğin altına taşırmasın — ardışık çift 2.5'in altına inmez).
        const oran = Math.min(1, Math.max(0, (gap - BLOK_DUR) / (BLOK_MESAFE - BLOK_DUR)))
        const adimSiniri = dt > 0 ? Math.max(0, gap - BLOK_TABAN) / (CAR_SPEED * dt) : oran
        const f = Math.min(oran, adimSiniri)
        c.blokFren = f
        c.speedScale = Math.min(c.speedScale, f)
        if (f < 0.15) {
          if (cikista) this.blokStats.cikisDurusSn += dt
          else this.blokStats.durusSn += dt
          c.blokT += dt
          if (c.blokT >= BLOK_KILIT_SN) {
            c.blokMuaf = true
            if (cikista) this.blokStats.cikisMuaf++
            else this.blokStats.muaf++
          }
        } else c.blokT = 0
      } else c.blokT = 0
    }
  }

  /**
   * KUYRUK İLERLEMESİ — slotlar sabit, araç bir öndeki slota KAYAR.
   * Kuyruk şeridi GELEN OMURGA üzerindedir (tek sıra): ön slot boşalınca arkadaki araç
   * oraya akar. Bu bir müzakere değil, deterministik bir konveyör — beklemek yok, sıra var.
   * TERFİ KAPISI (konveyör kuralı 1): araç slot i-1'e ancak (a) slot BOŞSA ve (b) öndeki
   * araca dünya mesafesi ≥ BLOK_MESAFE ise kayar; değilse OLDUĞU SLOTTA bekler. Zincir
   * her tikte baştan sona TEK GEÇİŞTE çözülür (baştaki önce, arkası zincirle) —
   * deterministik, pazarlıksız. Eskiden kapı yoktu: birden çok araç aynı anda öne
   * kayınca kuyruk başında burun buruna geliyorlardı (canlı telemetrideki 22x küme).
   */
  /**
   * BANKET SIRA DÜZELTMESİ — fiziksel sıra ile indeks sırası ayrışırsa slotlar takas
   * edilir (pazarlık değil, defter düzeltmesi; deterministik).
   * NEDEN: banket kuyruğuna araç KARAR NOKTASINDAN katılır (near'da y=-26) ve derin
   * slotlar bu noktanın gerisinde kalabilir — araç slotuna GÜNEYE dönerek iner. Aynı
   * anda hat ilerliyorsa derin slottan terfi eden araç KUZEYE çıkar: ikisi aynı kolonda
   * burun buruna geçiyordu (ölçüldü: T8'de çift 0.04'e kadar düştü). İndeksleri fiziksel
   * sıraya göre yeniden dağıtınca herkesin hedefi KENDİ tarafında kalır, kimse kimseyle
   * kesişmez; kuyruk adaleti bozulmaz (aynı indeks kümesi aynı araç kümesinde kalır).
   */
  private banketSirala(st: 'near' | 'far') {
    const L = this.graph.get(st)
    if (!L || L.spillStart >= L.queue.length) return
    const occ = this.waitOccFor(st)
    const n = this.waitSlotCount(st)
    const xs = L.queue[L.spillStart].x
    const uyeler: Car[] = []
    // İNDEKS FİLTRESİ YOK, KONUM FİLTRESİ VAR: hat hızlı akarken bir banket aracının
    // indeksi ANA slot aralığına düşebilir (terfi zinciri fiziksel ilerlemesinden hızlı
    // koşar) — araç bedenen hâlâ bankettedir. Ölçüldü: böyle bir araç (w0, gövdesi
    // bankette) yeni katılanların arasında duvar oluyor, arkası 2.1'e sıkışıyordu.
    // Bankette DURAN herkes sıralamaya girer; ana kolondaki araçlar (2.13 uzakta) girmez.
    for (let i = 0; i < n; i++) {
      const c = occ[i]
      if (!c || c.phase === 'gone' || c.slotIndex >= 0) continue
      if (c.phase !== 'waiting' && c.phase !== 'driving') continue
      if (Math.abs(c.group.position.x - xs) > 1.2) continue // banket hattında değil
      uyeler.push(c)
    }
    if (uyeler.length < 2) return
    const indeksler = uyeler.map(c => c.waitIndex).sort((a, b) => a - b)
    // fiziksel sıra: akış yönünde en ilerideki (kapıya en yakın) araç en küçük indeksi alır
    const sirali = uyeler.slice().sort((a, b) => {
      const pa = (a.group.position.y - L.gateInY) * L.dirY
      const pb = (b.group.position.y - L.gateInY) * L.dirY
      return pb - pa || a.waitIndex - b.waitIndex
    })
    // önce TÜM üyelerin defter kaydı silinir, sonra yeni sıra yazılır — tek tek takas
    // ederken bir aracın kaydı diğerininkini ezebiliyordu (aynı hücreye iki yazım)
    for (const c of uyeler) occ[c.waitIndex] = null
    for (let r = 0; r < sirali.length; r++) {
      const car = sirali[r], hedef = indeksler[r]
      const degisti = car.waitIndex !== hedef
      car.waitIndex = hedef
      occ[hedef] = car
      if (degisti) {
        // hedef ANA slotsa kapıdan girilir (düz çizgi çitten geçerdi)
        const hedefNokta = this.waitSpotAt(hedef, st)
        const yol = hedef < L.spillStart
          ? [...this.vs(this.graph.spillPromotePath(st, hedef).slice(0, -1)), hedefNokta]
          : [hedefNokta]
        car.setPath(temizRota(car, yol), () => { car.phase = 'waiting' })
      }
    }
  }

  private kuyrukIlerlet(st: 'near' | 'far', dt: number) {
    this.banketSirala(st)
    const occ = this.waitOccFor(st)
    const n = this.waitSlotCount(st)
    let onde: Car | null = null // fiziksel öndeki: daha küçük indeksli SON dolu slotun aracı
    for (let i = 0; i < n; i++) {
      const car = occ[i]
      if (!car || car.phase === 'gone' || car.slotIndex >= 0) continue
      if (i > 0 && !occ[i - 1]) {
        const d = onde
          ? Math.hypot(car.group.position.x - onde.group.position.x,
                       car.group.position.y - onde.group.position.y)
          : Infinity
        if (!car.blokMuaf && !car.boat && d < BLOK_MESAFE) {
          // TERFİ KAPISI KAPALI: öndeki bölüm henüz boşalmadı — olduğu slotta bekler.
          // (Hareketsiz beklerken kilitlenme sayacı burada işler; hareket hâlindeyse
          //  konveyorBlok zaten sayıyor — çift sayım olmasın.)
          if (!car.moving) {
            car.blokT += dt
            if (car.blokT >= BLOK_KILIT_SN) { car.blokMuaf = true; this.blokStats.muaf++ }
          }
        } else {
          occ[i] = null
          occ[i - 1] = car
          car.waitIndex = i - 1
          car.blokT = 0
          // AKICI GEÇİŞ: ışınlanmaz, yeni slota sürer (faz 'waiting' kalır, sabır işler).
          // BANKETTEN ANA HATTA geçen araç kapıdan girer (düz çizgi çitten geçerdi).
          const hedef = this.waitSpotAt(i - 1, st)
          const kapidan = this.graph.isSpillSlot(st, i) && !this.graph.isSpillSlot(st, i - 1)
          const yol = kapidan
            ? [...this.vs(this.graph.spillPromotePath(st, i - 1).slice(0, -1)), hedef]
            : [hedef]
          car.setPath(temizRota(car, yol), () => { car.phase = 'waiting' })
        }
      }
      onde = car
    }
  }

  /** VIP KURTARMA (ödüllü reklam karşılığı): sabrı tazelenir ve kuyrukta öne geçer.
   *  Para vermez — ekonomiyi şişirmemek için ödül "fırsat"tır, "nakit" değil. */
  vipKurtar(car: Car) {
    car.patience = car.maxPatience
    car.oncelikli = true
  }

  // `stationCrowdFactor` SİLİNDİ (kalabalık freni). NEDEN ARTIK GEREKSİZ: görevi
  // "dolu istasyona akın olup apron kilitlenmesin" idi — yani bir KİLİTLENME önlemiydi.
  // Şerit ağında kilitlenme üretilemiyor; kapasite baskısı kuyruk slotu sayısıyla
  // (ve otoyolda yavaşlama şeridiyle) doğal olarak modelleniyor: yer yoksa müşteri
  // karar noktasında yoluna devam eder (onTurnedAway), avluda yığılmaz.

  /** MARİNA: gelen teknenin türünü segment paylarına göre seç (rapor §6.5.4).
   *  Kara şubelerinde `boats()` boş döner → hiç tekne doğmaz, davranış değişmez. */
  private pickBoat(): CarSegment | null {
    const segs = this.opts.boats?.() ?? []
    if (!segs.length) return null
    const tot = segs.reduce((a, b) => a + b.share, 0)
    let r = Math.random() * tot
    for (const b of segs) { r -= b.share; if (r <= 0) return b }
    return segs[segs.length - 1]
  }

  private fleetTimer = 6
  /** Sözleşme filosu: girişi ZORUNLU (entryChance zarı yok), yakıt/tutar sözleşmeden */
  private spawnFleet(ct: { fuel: FuelType; dailyLiters: number }) {
    const price = this.opts.prices()[ct.fuel]
    const L = Math.max(40, Math.ceil(ct.dailyLiters / 7)) // 8 araç × 1/7 ≈ %114 — yuvarlama asla eksik bırakmaz
    const seg: CarSegment[] = [{ id: 'filo', share: 1, min: L * price * 0.9, max: L * price * 1.1,
      marginMult: 1, fuel: ct.fuel, label: 'Filo' }]
    const car = new Car(this.scene, this.lib, 'fuel', this.opts.prices(), seg, null, this.opts.patienceMult?.() ?? 1)
    car.lane = 'near'; car.station = 'near'; car.phase = 'transit'
    car.wantsEnter = true
    const svc = this.opts.serviceLane?.()
    const lx = svc ? svc.near : LANE_NEAR
    car.group.position.set(lx, -40, 0)
    car.group.rotation.z = Math.PI / 2
    car.setPath([new THREE.Vector3(lx, 44, 0)])
    this.cars.push(car)
  }

  private spawnTransit(lane: 'near' | 'far') {
    const boatSeg = this.pickBoat()
    // MARİNA: denizin ortasına ARABA GELMEZ. Su şubesinde tekne segmenti yoksa
    // (henüz yakıt iskelesi kurulmadıysa) hiçbir şey doğmaz — eskiden pickBoat null
    // dönünce kod arabaya düşüyordu ve deniz haritasında araba beliriyordu.
    if (!boatSeg && this.opts.waterOnly?.()) return
    const boat = boatSeg ? (boatSeg.id as BoatKind) : null
    const isEv = !boat && Math.random() < this.opts.evShare()
    // Tekne varsa TUTAR da o segmentten gelir: tek elemanlı liste veriyoruz ki Car'ın
    // kendi zarı model ile parayı AYRIŞTIRMASIN (jet ski süperyat parası ödemesin).
    const segs = boatSeg ? [{ ...boatSeg, share: 1 }] : (this.opts.segments?.() ?? null)
    const vipOl = !boat && Math.random() < (this.opts.vipChance?.() ?? 0)
    const car = new Car(this.scene, this.lib, isEv ? 'ev' : 'fuel', this.opts.prices(), segs, boat, this.opts.patienceMult?.() ?? 1, vipOl)
    car.lane = lane
    car.phase = 'transit'
    // 4 ŞERİTLİ YOL (çevre yolu): giriş kararı şerit seçiminden ÖNCE verilir, çünkü
    // girecek araç SERVİS şeridinde (istasyona yakın olan) doğar, geçiş trafiği içeride
    // akar. Servis şeridi tanımlı değilse tek şerit — kasaba/otoyol davranışı BİREBİR aynı.
    const svc = this.opts.serviceLane?.()
    if (lane === 'near') {
      car.station = 'near'
      // KALABALIK FRENİ YOK (silindi): sürücü zaten istasyonun doluluğunu yoldan
      // BİLEMEZ. Niyet saf zardır; kapasite kararı kapıda verilir (tryEnter yer bulamazsa
      // onTurnedAway ile "giremeyen müşteri" sayılır). Fren yalnız kilitlenmeyi
      // önlemek için vardı ve arz eğrisini de sessizce kısıyordu.
      car.wantsEnter = Math.random() < this.opts.entryChance()
      // VIP yoldan geçip gitmez: nadir olduğu için oyuncu teklifi hiç görmezdi.
      if (car.vip) car.wantsEnter = true
      car.wantsTruckPark = car.isTruck && Math.random() < 0.4
      // SU ŞUBESİ: transit de SERVİS şeridini kullanır (Oğuz: "yanaşma yerinden
      // tekneler dümdüz geçmesin") — LANE_NEAR (6.95) iskelenin dibinden geçiyordu.
      const lx = this.opts.waterOnly?.() && svc ? svc.near
        : (svc && car.wantsEnter ? svc.near : LANE_NEAR)
      car.group.position.set(lx, -40, 0)
      car.group.rotation.z = Math.PI / 2
      car.setPath([new THREE.Vector3(lx, 44, 0)])
    } else {
      car.station = 'far'
      // karşı istasyon açık VE bu ARAÇ TİPİNE uygun karşı ekipman varsa girilir (tır parkı karşıda yok).
      // (Eski hali tipe bakmıyordu: yalnız şarj olan karşı istasyona benzinli araçlar girip
      //  bekleme noktasında sonsuza dek kalıyor, sabır bitince itibar yakıyordu.)
      if (this.opts.farActive?.() && this.stationHasEquipmentFor(isEv ? 'ev' : 'fuel', 'far')) {
        car.wantsEnter = Math.random() < this.opts.entryChance()
        car.wantsTruckPark = car.isTruck && Math.random() < 0.4 // B6: karşı yakada da tır parkı
      }
      const lx = this.opts.waterOnly?.() && svc ? svc.far
        : (svc && car.wantsEnter ? svc.far : LANE_FAR)
      car.group.position.set(lx, 40, 0)
      car.group.rotation.z = -Math.PI / 2
      car.setPath([new THREE.Vector3(lx, -44, 0)])
    }
    this.cars.push(car)
  }

  // KAPI YARIM-ŞERİT OFSETLERİ (gateInOff/gateOutOff) SİLİNDİ. Geniş kapının işi
  // "aynı ağızdan iki araç" değil, GİRİŞ/ÇIKIŞ AYRIMIYDI; o ayrım artık şerit ağının
  // temeli. Geniş kapının yeni ve ölçülebilir faydası: içeride 8 yerine 10 kuyruk slotu.

  /** GİRİŞ ŞERİDİ (önceden hesaplanmış): yol → kapı → gelen omurga → ünite kolu.
   *  Ham nokta listesi döner; engel temizliği çağrı yerinde temizRota() ile yapılır. */
  private entryPath(p: THREE.Vector3, st: 'near' | 'far' = 'near', fromRoad = true): THREE.Vector3[] {
    return this.vs(this.graph.entryPath(st, { x: p.x, y: p.y }, fromRoad))
  }

  /** KUYRUK ŞERİDİ: yol → kapı → gelen omurga → i. sabit slot. */
  private queuePath(i: number, st: 'near' | 'far', fromRoad = true): THREE.Vector3[] {
    const raw = this.graph.queuePath(st, i, fromRoad)
    if (!raw.length) return [this.waitSpotAt(i, st)]
    const out = this.vs(raw)
    out[out.length - 1] = this.waitSpotAt(i, st) // katı cisim kaçışı slot noktasında yapılır
    return out
  }

  /** tıra boş tır parkı yeri bul ve gönder; başarılıysa true */
  sendTruckToPark(car: Car): boolean {
    // B6: tır parkı artık HER İKİ YAKADA çalışır — yollar geom() ile aynalanır.
    // Kural: tır yalnız KENDİ yakasındaki parka gider (yolu dik kesme yok, #269).
    const spots = this.opts.truckSpots()
    if (!spots.length) return false
    while (this.truckOcc.length < spots.length) this.truckOcc.push(null)
    let si = -1
    for (let i = 0; i < spots.length; i++) {
      if (this.truckOcc[i]) continue
      if ((spots[i].spot.x > ROAD_X) !== (car.station === 'far')) continue // yaka eşleşmesi
      // YOLU KAPALI YERE GÖNDERME (otoparkla aynı gerekçe): manevra ya da park noktası
      // katı cismin içinde kalıyorsa tır oraya asla varamaz, gövdenin dibinde kilitlenir.
      if (Car.isSolidAt(spots[i].stage.x, spots[i].stage.y)) continue
      if (Car.isSolidAt(spots[i].spot.x, spots[i].spot.y)) continue
      si = i; break
    }
    if (si < 0) return false
    this.truckOcc[si] = car
    car.truckSlot = si
    car.phase = 'toPark'
    const { spot, stage } = spots[si]
    car.truckStagePos = stage.clone()
    const GT = this.geom(car.station)
    const from = car.group.position
    const path: THREE.Vector3[] = []
    // yoldan geliyorsa kapıdan gir (yaka bağımsız: derinlik ölçütü)
    const depthNow = GT.sideSign < 0 ? (GT.gateX - from.x) : (from.x - GT.gateX)
    if (depthNow < -0.8) {
      path.push(new THREE.Vector3(GT.lane, GT.gateInY - GT.dirY * 3.5, 0))
      path.push(new THREE.Vector3(GT.gateX, GT.gateInY, 0))
    }
    // TIR PARKINA GİDİŞ DE OMURGADAN: eskiden kapının 0.2 birim içinden (gateX+0.2)
    // geçen ÜÇÜNCÜ bir kolon kullanılıyordu — o kolon giden omurganın (xOut) tam üstüne
    // düşüyor ve tır oradan ters yönde ilerliyordu; çıkan araçlarla kafa kafaya gelme
    // ihtimali doğuyordu. Artık GELEN omurga kullanılıyor (tır da giren trafiktir).
    const LN = this.graph.get(car.station)
    path.push(new THREE.Vector3(LN ? LN.xIn : GT.gateX + GT.sideSign * 0.8, stage.y, 0))
    path.push(stage.clone())
    // tır parkına gidiş TEMİZLENİR (tır payı geniş); geri geri yanaşma bacağı TEMİZLENMEZ:
    // o kasıtlı bir manevradır, park yerinin dibindeki engelden "kaçınmak" onu bozar.
    car.setPath(temizRota(car, path), () => {
      // manevra noktasına geldi: geri geri yanaş (cool kısım)
      car.reversing = true
      car.setPath([spot.clone()], () => {
        car.reversing = false
        car.phase = 'parked'
        car.stayT = 14 + Math.random() * 18
        this.opts.onTruckParked?.(car)
      })
    })
    return true
  }

  /** pompadaki tırı slotu boşaltarak tır parkına yollar */
  sendTruckToParkFromPump(car: Car): boolean {
    if (car.slotIndex >= 0) {
      if (car.kind === 'ev') this.evOcc[car.slotIndex] = null
      else this.pumpOcc[car.slotIndex] = null
      car.slotIndex = -1
    }
    return this.sendTruckToPark(car)
  }

  private leaveTruckPark(car: Car) {
    if (car.truckSlot >= 0) this.truckOcc[car.truckSlot] = null
    car.truckSlot = -1
    car.phase = 'leaving'
    const out: THREE.Vector3[] = []
    if (car.truckStagePos) out.push(car.truckStagePos.clone()) // önce ileri çık
    out.push(...this.cikisRotasi(car)) // sonra ÇIKIŞ ŞERİDİ (yakaya göre şerit ağından)
    car.truckStagePos = null
    car.setPath(temizRota(car, out)) // tır parkından ÇIKIŞ da engel-farkında
  }

  private truckOcc: (Car | null)[] = []

  /** kapı taşındı: rotası eski kapıdan geçen araçları güncel kapıya yönlendir.
   *  Yalnızca henüz istasyona girmemiş (yolda, x>5.5) ve çıkışa yönelmiş ama
   *  henüz yola çıkmamış (x<3.9) araçlar — apron ortasındakiler yerinde kalır. */
  /** Kapı/ünite taşınınca TÜM araçları yeni geometriye göre yeniden rotala.
   *  (B3: eski hali yalnız near'dı — oyuncu KARŞI kapıyı taşıyınca karşı yakadaki
   *  araçlar eski kapı koordinatına sürüp çite çakılıyor, buharlaşıyordu.)
   *  Tüm eşikler DERİNLİK (kapıdan istasyon içine mesafe) cinsinden — yaka bağımsız. */
  rerouteForGates() {
    // ŞERİT AĞI YENİDEN HESAPLANDI (update() imzayı görür): araçları YENİ şeritlere bindir.
    for (const c of this.cars) {
      const G = this.geom(c.station)
      const p = c.group.position
      // depth: kapıdan istasyonun içine doğru mesafe. Negatif = hâlâ yol tarafında.
      const depth = G.sideSign < 0 ? (G.gateX - p.x) : (p.x - G.gateX)
      const yolda = depth < -1.3
      if (c.phase === 'driving' && c.slotIndex >= 0) {
        const slot = c.kind === 'ev' ? this.opts.evSlot(c.slotIndex) : this.opts.pumpSlot(c.slotIndex)
        c.setPath(temizRota(c, this.entryPath(slot, c.station, yolda)), () => this.arriveAtSlot(c))
      } else if (c.phase === 'driving' && c.waitIndex >= 0) {
        c.setPath(temizRota(c, this.queuePath(c.waitIndex, c.station, yolda)), () => { c.phase = 'waiting' })
      } else if (c.phase === 'leaving' && depth > -1.3) {
        c.setPath(temizRota(c, this.cikisRotasi(c)))
      }
    }
  }

  private tryEnter(car: Car) {
    if (this.opts.entryChance() <= 0) return // istasyon kapalı: kimse girmez
    if (car.wantsTruckPark && car.truckSlot < 0 && this.sendTruckToPark(car)) return
    // `rampBusy` ("aynı anda tek araç girer") SİLİNDİ. Bir BEKLETME kuralıydı: apron
    // yığılmasını önlemek için girişi seri hale getiriyordu. Şerit ağında giriş şeridi
    // zaten tek sıra ve ünite kolları ayrık — araçlar peş peşe akabilir.
    const G = this.geom(car.station)
    const gy = G.gateInY
    if (car.kind === 'ev') {
      // giriş kapısına EN YAKIN boş şarj: herkes 0. slota hunilenmesin, koridor yolculuğu kısalsın
      let slot = -1; let bestD = Infinity
      for (let i = 0; i < this.opts.evCount(); i++) {
        if (this.evStation(i) !== car.station) continue // yalnız bu istasyonun şarjları
        if (this.evOcc[i] || this.opts.isChargerBroken(i)) continue
        if (!this.graph.unitErisilebilir(car.station, 'ev', i)) continue // kolu kapalı
        const d = Math.abs(this.opts.evSlot(i).y - gy)
        if (d < bestD) { bestD = d; slot = i }
      }
      if (slot < 0) {
        // NEDEN GİREMEDİ? (#1275 #1276 #1292 "boş yer varsa oraya geçsin, niye molacının
        // yüzünden kaçıyor / şarjcılarım başında"): eskiden herhangi bir molacı varsa
        // HER kaçış "molacı yüzünden" sayılıp itibar kesiliyordu — oysa boş ünite ÖNÜ
        // KAPALI (unitErisilebilir) ya da ARIZALI olduğu için görünmez kalmış olabilir.
        // Oyuncu boş üniteyi görüyor, mesaj molacıyı suçluyordu. Sebep ayrıştırılır;
        // molacı yalnız gerçekten TEK engelse ve onu uğurlayacak kimse yoksa cezadır.
        let kapali = 0, bozuk = 0, molaci = 0, personelli = 0
        for (let i = 0; i < this.opts.evCount(); i++) {
          if (this.evStation(i) !== car.station) continue
          const o = this.evOcc[i]
          if (o?.squatting) { molaci++; if (this.opts.hasChargerStaff?.(i)) personelli++; continue }
          if (o) continue
          if (this.opts.isChargerBroken(i)) { bozuk++; continue }
          if (!this.graph.unitErisilebilir(car.station, 'ev', i)) kapali++
        }
        const neden = kapali > 0 ? 'kapali' : bozuk > 0 ? 'bozuk'
          : molaci > 0 ? (personelli === molaci ? 'molaci-personelli' : 'molaci') : 'dolu'
        if (neden !== 'dolu') this.opts.onEvTurnedAway?.(neden)
        return // şarj yeri yok, yoluna devam
      }
      this.evOcc[slot] = car
      car.slotIndex = slot
      car.phase = 'driving'
      car.setPath(temizRota(car, this.entryPath(this.opts.evSlot(slot), car.station)), () => this.arriveAtSlot(car))
      car.showBars()
      return
    }
    // KUYRUK VARSA SIRAYA GİR (tek sıra kuralı): kuyruk gelen omurganın ÜZERİNDE.
    // Bekleyeni geçip boş pompaya dalmak, aracı kuyruğun gövdelerinin içinden geçirirdi.
    // Sıradaki araç zaten aynı karede boş pompaya gönderiliyor (aşağıdaki sendToSlot
    // döngüsü) — yani bu kural akışı YAVAŞLATMAZ, yalnız şeridi tek sıra tutar.
    const kuyruktaVar = this.waitOccFor(car.station).some(Boolean)
    // yakıt müşterisi — giriş kapısına EN YAKIN boş pompa (tek koridora hunilenme dağılır)
    let slot = -1; let bestD = Infinity
    for (let i = 0; i < this.opts.pumpCount(); i++) {
      if (this.pumpStation(i) !== car.station) continue // yalnız bu istasyonun pompaları
      if (this.pumpOcc[i] || this.opts.isPumpBroken(i)) continue
      if (!this.graph.unitErisilebilir(car.station, 'pump', i)) continue // kolu kapalı
      const d = Math.abs(this.opts.pumpSlot(i).y - gy)
      if (d < bestD) { bestD = d; slot = i }
    }
    if (slot >= 0 && !kuyruktaVar) {
      this.pumpOcc[slot] = car
      car.slotIndex = slot
      car.phase = 'driving'
      car.setPath(temizRota(car, this.entryPath(this.opts.pumpSlot(slot), car.station)), () => this.arriveAtSlot(car))
      car.showBars()
      this.graph.stats.granted++
      return
    }
    // emniyet: bu istasyonda HİÇ pompa yoksa (hepsi karşıda/başka tip) bekleme noktası alma —
    // asla gelmeyecek pompayı bekleyip sabır tüketme, yoluna devam et
    if (!this.stationHasEquipmentFor('fuel', car.station)) return
    // boş bekleme noktası REZERVE edilir; hiç yer yoksa araç girmez, yoluna gider
    const waitOcc = this.waitOccFor(car.station)
    let wi = -1
    const kapali = this.katiSlotlarFor(car.station)
    for (let i = 0; i < this.waitSlotCount(car.station); i++) {
      if (!waitOcc[i] && !kapali.has(i)) { wi = i; break }
    }
    if (wi >= 0) {
      waitOcc[wi] = car
      car.waitIndex = wi
      car.phase = 'driving'
      // BEKLEME NOKTASINA gidiş de temizlenir: iç bekleme koridoru pompa hattının
      // yanından geçer, oyuncu oraya bina koyduysa rota gövdenin üstünden geçiyordu.
      car.setPath(temizRota(car, this.queuePath(wi, car.station)), () => {
        car.phase = 'waiting'
      })
      car.showBars()
      this.graph.stats.granted++
      return
    }
    // KUYRUK DOLU: müşteri içeri HİÇ giremedi. Eski mimaride kalabalık freni bunu yolda
    // önlüyordu; artık karar kapıda veriliyor ve GÖRÜNÜR bir kayıp olarak sayılıyor.
    this.graph.stats.denied++
    this.opts.onTurnedAway?.()
  }

  private arriveAtSlot(car: Car) {
    car.phase = 'atPump'
    // araç, ünitenin OYUNCU AÇISINA paralel durur — eski sabit ±90° döndürülmüş
    // pompada/şarjda aracı hep yan gösteriyordu ("yönünü düzelttim, yan duruyor")
    const ang = car.kind === 'ev'
      ? (this.opts.evAngle?.(car.slotIndex) ?? 0)
      : (this.opts.pumpAngle?.(car.slotIndex) ?? 0)
    car.group.rotation.z = (car.station === 'far' ? -Math.PI / 2 : Math.PI / 2) + ang
    car.showBubble()
    // ÇIKIŞ ROTASINI ŞİMDİ ÇİZ (oyun sahibi: "pompaya gelip sonra çıkış yolu aramasından
    // ziyade BAŞTAN pathi ona göre çizse"). Araç yuvaya oturduğu anda çıkışı hazırdır;
    // uğurlanınca hesap yapmadan yola koyulur. Damga (yerleşim sürümü + konum) tutmazsa
    // releaseCar tazeler — bina taşınmışsa bayat rota kullanılmaz.
    car.cikisYolu = temizRota(car, this.cikisRotasi(car))
    car.cikisImza = this.cikisImzasi(car)
    if (car.vip) this.opts.onVip?.(car)
    this.opts.onCarReady(car)
  }

  /** ÇIKIŞ ŞERİDİ tek kaynaktan: hem varışta önden hesaplanır hem uğurlamada kullanılır.
   *  Şerit ağından gelir — GİDEN OMURGA gelen omurgadan ayrı kolonda olduğu için çıkan
   *  araç kuyruğun ve giren araçların içinden geçmez. */
  private cikisRotasi(car: Car): THREE.Vector3[] {
    const p = car.group.position
    return this.vs(this.graph.exitPath(car.station, { x: p.x, y: p.y }))
  }

  /** hazır çıkış rotasının geçerlilik damgası: yerleşim sürümü + aracın konumu (0.1 ızgara) */
  private cikisImzasi(car: Car): string {
    const p = car.group.position
    return Car.solidSurum + '|' + car.station + '|' + Math.round(p.x * 10) + ',' + Math.round(p.y * 10)
  }

  private sendToSlot(car: Car, slot: number) {
    if (car.waitIndex >= 0) {
      this.waitOccFor(car.station)[car.waitIndex] = null
      car.waitIndex = -1
    }
    this.pumpOcc[slot] = car
    car.slotIndex = slot
    car.phase = 'driving'
    const p = this.opts.pumpSlot(slot)
    // KUYRUK -> POMPA: araç normalde GELEN OMURGA üzerindedir (kuyruk slotu orada) →
    // rota omurga boyunca ünitenin hizasına, sonra ünite koluna. Yol tarafı bacağı yok.
    // İSTİSNA: araç hâlâ BANKETTEYSE (kapının dışında — ana hat hiç kurulamayan dar
    // yerleşim ya da tam terfi anı) kapıdan girmesi gerekir → fromRoad=true.
    const G2 = this.geom(car.station)
    const derinlik = G2.sideSign < 0 ? (G2.gateX - car.group.position.x) : (car.group.position.x - G2.gateX)
    car.setPath(temizRota(car, this.entryPath(p, car.station, derinlik < -0.3)), () => this.arriveAtSlot(car))
  }

  /** servis bitti, tesis kullanacak → otoparka çek. Otopark yok/dolu ise false. */
  sendToParking(car: Car): boolean {
    // YAKA EŞLEŞMESİ: araç yalnız KENDİ istasyonunun yakasındaki otoparka park eder.
    // Eski near-only kilit yerine yaka filtresi: near araç karşıya park etmeye gidemez
    // (yolu dik kesip çıkışı tıkıyordu), karşı müşteri de KARŞI yakadaki otoparkı
    // kullanabilir — karşı istasyon otopark+tesisle gerçek istasyon olur.
    const spots = this.opts.parkSpots()
    if (spots.length === 0) return false
    // ölü kayıtları temizle (otopark taşındı/yıkıldı → id artık yok)
    const live = new Set(spots.map(s => s.id))
    for (const id of [...this.parkOcc.keys()]) if (!live.has(id)) this.parkOcc.delete(id)
    // ŞERİT AĞINDAN SEÇ: yalnız YOLU AÇIK slotlar listede. Kapalı slota gönderilen araç
    // pompa gövdesinin dibinde sonsuza dek kilitleniyordu (bkz. traffic-graph parkLanes).
    const lane = this.graph.parkLanesOf(car.station).find(l => !this.parkOcc.has(l.id))
    if (!lane) return false
    const sp = spots.find(s => s.id === lane.id)
    if (!sp) return false
    // pompayı/şarjı hemen boşalt ki sıradaki müşteri girsin — slotIndex'i EZME (B4), ayrı alan
    if (car.slotIndex >= 0) {
      if (car.kind === 'ev') this.evOcc[car.slotIndex] = null
      else this.pumpOcc[car.slotIndex] = null
      car.slotIndex = -1
    }
    car.parkId = sp.id
    this.parkOcc.set(sp.id, car)
    car.phase = 'toPark'
    car.beingServed = false
    car.filling = false
    car.hideBubble()
    car.hideBars()
    // ÖNCEDEN ÇİZİLMİŞ OTOPARK ŞERİDİ: koridor ağzı → slotun hizası → park yeri.
    // Sabit "ön-sahneleme kolonu" (x=3.0) SİLİNDİ: gelen ve giden omurgaların ARASINDA
    // duran üçüncü bir kolondu, park etmeye giden araçlar orada iki şeridin içinden
    // rastgele yönde geçiyordu. Artık araç koridora ağzından girer, tek yönde akar.
    car.parkLane = lane
    car.setPath(temizRota(car, this.vs(this.graph.parkEntryPath(lane))), () => {
      car.phase = 'parked'
      // ters cepheden yanaştıysa burnu da ters yöne bakar (yoksa araç geri geri park etmiş gibi durur)
      car.group.rotation.z = sp.rot + (lane.side < 0 ? Math.PI : 0)
    })
    return true
  }

  /** YAĞ DEĞİŞİMİ KÖRÜĞÜ: araç garaj kapısından İÇERİ sürer (Oğuz: "arabalar yağ
   *  değişiminin içine girsinler"). Doluluk/ödül orkestrasyonu main'de (oilPending). */
  sendToOilBay(car: Car, entry: THREE.Vector3, inside: THREE.Vector3, rot: number): boolean {
    // OTOPARKLA AYNI KURAL: kapı ağzı katı cismin içinde kalıyorsa araç oraya varamaz —
    // gövdenin dibinde kilitlenir. Gönderme, çağıran hızlı akışa düşsün.
    if (Car.isSolidAt(entry.x, entry.y)) return false
    if (car.slotIndex >= 0) {
      if (car.kind === 'ev') this.evOcc[car.slotIndex] = null
      else this.pumpOcc[car.slotIndex] = null
      car.slotIndex = -1
    }
    car.phase = 'toPark'
    car.beingServed = false
    car.filling = false
    car.hideBubble()
    car.hideBars()
    // İKİ ETAP: kapıya kadar normal çarpışma (yoldaki binalardan geçmesin), kapı→içeri
    // ghostSolid ile duvar yok sayılır — yoksa araç kapıda sürtünüp kalıyordu.
    // SABİT ÖN-SAHNELEME KOLONU (x=3.0) SİLİNDİ: gelen (xIn) ve giden (xOut) omurgaların
    // ARASINDA duran üçüncü bir kolondu ve araç orada rastgele yönde ilerliyordu. Araç
    // zaten avlunun içinde; kapı ağzına doğrudan (engel-farkında) gider — hem daha kısa
    // hem de iki omurganın hiçbirini ters yönde kullanmıyor.
    car.setPath(temizRota(car, [entry.clone()]), () => {
      car.ghostSolid = true
      car.setPath([inside.clone()], () => {
        car.phase = 'parked'
        car.group.rotation.z = rot
      })
    })
    return true
  }

  /** otopark taşınınca/döndürülünce park etmiş araçları uğurla — eski açı/konumda
   *  asılı kalıp "döndürdüm ama araçlar hâlâ yan duruyor" görüntüsü yaratıyorlardı */
  evictParked() {
    for (const car of [...this.cars]) {
      if (car.truckSlot >= 0) continue
      if (car.phase === 'parked' || car.phase === 'toPark') this.releaseCar(car)
    }
  }

  /** slotta duran ya da slota sürmekte olan araçları uğurla (ünite taşınırken) */
  evictSlot(kind: 'fuel' | 'ev', i: number) {
    for (const car of [...this.cars]) {
      if (car.slotIndex !== i) continue
      if (kind === 'ev' ? car.kind !== 'ev' : car.kind === 'ev') continue
      if (car.phase === 'driving' || car.phase === 'atPump') this.releaseCar(car)
    }
  }

  /** buharlaşma telemetrisi (3.1): trafik sağlığının tek objektif metriği.
   *  Hedef: 10 dk tam yüklü oturumda total = 0. Testler ve debug için public. */
  evapStats = { total: 0, near: 0, far: 0 }
  /** hata ayıklama katmanı (?traffic=1) için salt-okuma erişimi */
  get graphRef() { return this.graph }

  // `evaporate` SİLİNDİ. Kalıcı sıkışmayı üretecek mekanizma (bekleme/rezervasyon/
  // yol verme) kalmadığı için son-çare silme sigortasına da gerek yok. evapStats
  // TELEMETRİ olarak duruyor ve HER ZAMAN 0 kalmalı: 0'dan farklıysa biri sessiz
  // müşteri silmeyi geri getirmiş demektir.
  //
  // `recoverStuck` SİLİNDİ. Görevi "2.2 sn kıpırdayamayan aracı ayır, katıdan çıkar,
  // rotasını tazele" idi — hepsi bekleme kaynaklı kilitlenmenin sonucuydu.

  releaseCar(car: Car) {
    if (car.waitIndex >= 0) {
      this.waitOccFor(car.station)[car.waitIndex] = null
      car.waitIndex = -1
    }
    const fromPark = car.phase === 'parked' || car.phase === 'toPark'
    if (car.parkId) { this.parkOcc.delete(car.parkId); car.parkId = null }
    if (car.slotIndex >= 0) {
      if (car.kind === 'ev') this.evOcc[car.slotIndex] = null
      else this.pumpOcc[car.slotIndex] = null
    }
    car.slotIndex = -1
    car.phase = 'leaving'
    car.beingServed = false
    car.filling = false
    car.hideBubble()
    car.hideBars()
    if (fromPark) {
      // OTOPARKTAN ÇIKIŞ: ÇIKIŞ koridorundan (girişten ayrı hat) ağza, oradan istasyonun
      // giden omurgasına. Önceden tek "stage" noktasından hem girilip hem çıkılıyordu:
      // aynı çizgide iki yön demekti, çıkmaz sokakta kafa kafaya gelmenin tarifi.
      const lane = car.parkLane
      car.parkLane = null
      const out = lane
        ? this.vs(this.graph.parkExitPath(car.station, lane))
        : this.cikisRotasi(car).slice(1)
      car.setPath(temizRota(car, out))
      car.cikisYolu = null
      return
    }
    // ÖNDEN ÇİZİLMİŞ ÇIKIŞ: araç pompaya varırken hesaplandı. Damga tutuyorsa (yerleşim
    // değişmedi + araç yerinden oynamadı) hesap YAPMADAN yola koyulur — oyuncunun
    // "önce pompaya gelip sonra çıkış yolu arıyor" dediği duraksama ortadan kalkar.
    const hazir = car.cikisYolu && car.cikisImza === this.cikisImzasi(car) ? car.cikisYolu : null
    car.cikisYolu = null
    car.setPath(hazir ?? temizRota(car, this.cikisRotasi(car)))
  }
}
