/**
 * TRAFİK OLAY KAYDI — "araçlar iç içe / sıkışıyor" şikâyetlerinin CANLI KANITI.
 *
 * NEDEN VAR: bu repoda trafik hakkında elimizde hiç oyuncu verisi yoktu. Ekran
 * görüntüsü geliyordu, sahneyi yeniden kuramıyorduk; her tur "acaba düzeldi mi"
 * diye tahmin yürütülüyordu. Artık istemci anomaliyi GÖRDÜĞÜ AN sahnenin tam
 * durumunu gönderiyor: her kayıt tek başına yeniden kurulabilir bir hata raporu.
 *
 * ÖLÇÜM NABZI: 1 sn (rAF değil — oyun döngüsünde dt biriktirilerek). Kare başına
 * O(n²) mesafe taraması yapılmaz; saniyede bir kez, en fazla ~80 araçla çalışır.
 *
 * GÖNDERİM DİSİPLİNİ (oyuncunun ağını ve sunucuyu yormaz):
 *   · oturum başına EN FAZLA 6 olay,
 *   · iki olay arasında EN AZ 90 sn (tür başına değil, TOPLAM),
 *   · aynı tür arka arkaya 2 kereden fazla gitmez (tek hata oturumu 6 slotu yemesin),
 *   · ?full=1 / ?promo (vitrin/tanıtım) modunda ASLA gönderilmez — vitrin verisi
 *     gerçek oyuncu ölçümünü kirletir.
 *
 * AYRICA: 5 dakikada bir TEK kompakt sayaç isteği (saatlik toplam → trend grafiği).
 * Olay kaydı TEŞHİS içindir, sayaç TREND için; ikisi birbirinin yerine geçmez.
 */

export type OlayTuru = 'icice' | 'sikisma' | 'yigilma' | 'kuyruk' | 'kurtarma'

/** snapshot'taki araç satırı: [x, y, phase, slotIndex, kind] */
export type OlayAracSatiri = [number, number, string, number, string]
/** snapshot'taki yapı satırı: [id, x, y, rot] */
export type OlayYapiSatiri = [string, number, number, number]

/** POST /api/trafik-olay gövdesi. ŞEMA SABİT — tools/trafik-analiz.mjs buna bakar. */
export interface TrafikOlay {
  k: OlayTuru
  day: number
  loc: string
  pumps: number
  ev: number
  cars: OlayAracSatiri[]
  slots: { pump: [number, number][]; ev: [number, number][] }
  yapi: OlayYapiSatiri[]
  /** TETİKLEYEN araçların `cars` içindeki indeksleri (sıkışan araçlar / süren iç içe çiftin
   *  iki üyesi). Analiz bunu okumadan önce "hangi araç?" sorusu tahminle cevaplanıyordu. */
  hedef?: number[]
  /** istemci bundle damgası (`<meta name="surum">`, index.html — dağıtım hash·saat). Dağıtım sonrası eski/yeni kodu ayırır. */
  v?: string
}

export interface OlayAraci {
  /** KARARLI kimlik (araç ömrü boyunca değişmez). Dizi indeksi kullanılamaz: araç
   *  dizisi her karede doğan/ölen araçla kayar, süre biriktiren sayaçlar hiç dolmazdı. */
  id: number
  x: number
  y: number
  phase: string
  slotIndex: number
  kind: string
  /** konveyör/blok freni şu an bu aracı KASITLI bekletiyor (Car.blokT > 0).
   *  Kural gereği duran araç arıza değildir — sıkışma sayacına girmez. Gerçek
   *  kilitlenme yine yakalanır: 30 sn sonra muafiyet freni bırakır, blokT sıfırlanır
   *  ve hâlâ kıpırdamayan araç sayaca döner. */
  frenli?: boolean
  /** BEKÇİ tarafından kurtarılmış (Car.hayalet): kaynakları bırakılmış, çıkışa tam hız
   *  giden araç. Kurtarma olayında `hedef` olarak işaretlenir — kilidin NEREDE olduğu
   *  ancak bu araçla anlaşılır (#5649: hedef [] → kurtarılan araç bulunamadı). */
  hayalet?: boolean
  /** yön (birim vektör; group.rotation.z'den). Yoksa çift dairesel eşikle ölçülür. */
  hx?: number
  hy?: number
}

export interface OlayBaglam {
  /** sahnedeki TÜM araçlar (gone hariç) */
  cars: () => OlayAraci[]
  pumpSlots: () => { x: number; y: number }[]
  evSlots: () => { x: number; y: number }[]
  /** placedPos + placedRot'tan türetilmiş yapı listesi */
  yapi: () => OlayYapiSatiri[]
  gun: () => number
  loc: () => string
  pompa: () => number
  sarj: () => number
  /** kuyruk slotlarının hepsi dolu mu */
  kuyrukDolu: () => boolean
  /** içeri hiç giremeyen (turned away) müşteri sayacı — ARTIYORSA kapasite tıkalı */
  giremeyen: () => number
  /** BEKÇİ KURTARMA sayacı (CarManager.kurtarmaStats.kurtarma) — ARTIYORSA bir araç
   *  kalıcı sıkışmıştı ve son çare sigortası devreye girdi. Sağlıklı oturumda HİÇ artmaz;
   *  arttığı an sahnenin tam durumu gönderilir, çünkü kök neden ancak orada görülür. */
  kurtarma: () => number
}

/** İÇ İÇE eşiği (yön bilinmiyorsa): merkez mesafesi bunun altındaki çift üst üste sayılır. */
export const ICICE_MESAFE = 2.15
/** Araç ayak izi (cars.ts CAR_SPECS: front+rear ≈ 2.66, width ≤ 1.2). Yönü bilinen çiftte
 *  ölçüm YÖNLÜ: boyuna < ARAC_BOY ve enine < ARAC_EN (iki aracın çerçevesinden birinde).
 *  Neden (2 Eyl, canlı 0853 bundle'ı): dairesel 2.15 eşiği yan yana şeritteki araçları
 *  (servis şeridi 5.6 ↔ transit 7, enine 1.4, aynı hızda → SÜREKLİ) ve 1.4 aralıkla park
 *  etmiş araçları "iç içe" sayıyordu — saatlik iç içe olaylarının 3/4'ü buydu. Enine 1.4
 *  > 1.2: gövdeler değmiyor, oyuncu üst üste görmüyor. */
/** 2.66 değil 2.15: tasarımın "tam duruş" aralığı BLOK_DUR=2.2 (cars.ts) — ardışık
 *  araçlar kural gereği 2.2'de durabilir, o aralık olay olmasın (eski dairesel eşikle
 *  de değildi). Canlı 1033 bundle'ı: 2.5 ile ilk 11 olayın 4'ü 2.2–2.5 aralıklı düzenli
 *  kolon takipçisiydi. Lab'ın "gözle üst üste" ölçütü 1.6 (traffic-load) — 2.15 onun
 *  üstünde bir pay bırakır; 1.6–2.15 arası "burun buruna" sayılır, kolon dışı yola
 *  katılan çiftlerin (kapsam dışı) izini sürmek için. */
export const ARAC_BOY = 2.15
/** 1.2 değil 1.0: gelen/giden omurgalar tasarım gereği LANE_SEP=1.05 aralıkla yan yana
 *  akar (traffic-graph.ts); duran kuyruk + yanında bekleyen giden araç olay olmasın. */
export const ARAC_EN = 1.0
function ustUste(a: OlayAraci, b: OlayAraci): boolean {
  const dx = b.x - a.x, dy = b.y - a.y
  const cerceve = (hx: number, hy: number) =>
    Math.abs(dx * hx + dy * hy) < ARAC_BOY && Math.abs(dx * hy - dy * hx) < ARAC_EN
  const aY = a.hx != null && a.hy != null, bY = b.hx != null && b.hy != null
  if (!aY && !bY) return dx * dx + dy * dy < ICICE_MESAFE * ICICE_MESAFE
  return (aY && cerceve(a.hx!, a.hy!)) || (bY && cerceve(b.hx!, b.hy!))
}
/** iç içe durumu bu kadar SÜRERSE olay sayılır (anlık kesişme değil) */
export const ICICE_SURE = 2
/** hareketsizlik eşiği (sn) — bu süre boyunca yer değiştirmeyen SÜRÜŞ fazındaki araç */
export const SIKISMA_SURE = 45
/** hareketsiz sayılmak için kare başına izin verilen en büyük yer değiştirme (birim) */
const SIKISMA_TOLERANS = 0.12
/** yığılma: bu yarıçaptaki daire içinde ... — KONVEYÖR TABANININ ALTINDA (cars.ts
 *  BLOK_TABAN 2.55): 2.55 aralıkla düzgün akan kolon yığılma değildir. 3'tü: 8 pompalı
 *  istasyonda 2.7 aralıklı çıkış kolonu + 1.05 yanındaki giriş kolonu her nabızda 4'ü
 *  buluyordu (0853 bundle'ında 22 olayın 22'si bu, hepsi düzenli akış). */
export const YIGILMA_YARICAP = 2.4
/** ... bu kadar araç varsa olay */
export const YIGILMA_ADET = 4
/** SÜRÜŞ fazları — atPump/parked/waiting HAREKETSİZ OLMASI GEREKEN fazlardır, sayılmaz.
 *  (oyunun faz adları: transit·driving·waiting·atPump·toPark·parked·leaving·gone;
 *   'toPump'/'toSlot' bu motorda 'driving' adıyla tek fazda toplanır) */
const SURUS_FAZLARI = new Set(['driving', 'toPark', 'leaving'])

/** oturum tavanı ve aralıklar */
export const OTURUM_TAVANI = 6
export const OLAY_ARALIK_SN = 90
export const AYNI_TUR_ARKA_ARKAYA = 2
/** kompakt sayaç gönderim aralığı (sn) */
export const SAYAC_ARALIK_SN = 300

const NABIZ = 1

type Gonderici = (url: string, govde: unknown) => void
const varsayilanGonderici: Gonderici = (url, govde) => {
  try {
    fetch(url, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify(govde),
    }).catch(() => {})
  } catch { /* ölçüm asla oyunu etkilemesin */ }
}

let ctx: OlayBaglam | null = null
let aktif = false
let gonder: Gonderici = varsayilanGonderici

let nabizBirikim = 0
let gecenSn = 0                       // oturum saati (sn)
let sonOlayT = -Infinity
let gonderilen = 0
let sonTur: OlayTuru | null = null
let sonTurArtArda = 0
/** iç içe çift → biriken süre; anahtar "a|b" (küçük araç kimliği önce) */
const iciceSure = new Map<string, number>()
/** araç kimliği → son konum + hareketsiz süre */
const durgun = new Map<number, { x: number; y: number; sn: number }>()
let sonGiremeyen = 0
/** son nabızda okunan kurtarma sayacı (fark = bu nabızda kurtarılan araç) */
let sonKurtarma = 0
/** 5 dakikalık kompakt sayaç birikimi */
let sayacT = 0
const sayac = { icice: 0, sikisan: 0, bekleyen: 0, kurtarilan: 0, ornek: 0 }
/** test kancası: gönderilen olayların yerel kaydı */
const gonderilenler: TrafikOlay[] = []

/** Modülü kur. `aktifMi` false ise (vitrin/tanıtım modu) HİÇBİR istek çıkmaz. */
export function trafikOlayKur(baglam: OlayBaglam, aktifMi: boolean, gondericiOverride?: Gonderici) {
  ctx = baglam
  aktif = aktifMi
  if (gondericiOverride) gonder = gondericiOverride
}

/** test/ölçüm kancası: sayaçları sıfırla */
export function trafikOlaySifirla() {
  nabizBirikim = 0; gecenSn = 0; sonOlayT = -Infinity; gonderilen = 0
  sonTur = null; sonTurArtArda = 0; sonGiremeyen = 0; sonKurtarma = 0; sayacT = 0
  iciceSure.clear(); durgun.clear(); gonderilenler.length = 0
  sayac.icice = 0; sayac.sikisan = 0; sayac.bekleyen = 0; sayac.kurtarilan = 0; sayac.ornek = 0
}

/** test/ölçüm kancası: modülün durumu */
export function trafikOlayDurum() {
  return {
    aktif, gonderilen, sonTur, sonTurArtArda, gecenSn,
    sonOlaydanBeri: gecenSn - sonOlayT,
    olaylar: gonderilenler.slice(),
    sayac: { ...sayac },
  }
}

const yuvarla = (v: number) => Math.round(v * 10) / 10

/** oyun döngüsünden her karede çağrılır; içeride 1 sn'lik nabza indirger */
export function trafikOlayTick(dt: number) {
  if (!ctx) return
  gecenSn += dt
  nabizBirikim += dt
  sayacT += dt
  if (nabizBirikim < NABIZ) return
  const adim = nabizBirikim
  nabizBirikim = 0
  const araclar = ctx.cars()
  olcum(araclar, adim)
  if (sayacT >= SAYAC_ARALIK_SN) { sayacGonder(); sayacT = 0 }
}

/** bir nabız: tetikleyicileri değerlendirir, gerekirse olay gönderir */
function olcum(araclar: OlayAraci[], adim: number) {
  const gorunur = araclar.filter(c => c.phase !== 'gone')
  // ── iç içe çiftler (SÜRE ŞARTIYLA) ──
  // Anlık kesişme olay DEĞİLDİR: iki araç birbirinin içinden geçerken bir kare boyunca
  // yakın görünür. Oyuncunun şikâyet ettiği şey SÜREN iç içelik — bu yüzden çift başına
  // süre birikir ve ancak ICICE_SURE'yi aşınca olay sayılır.
  const buNabiz = new Set<string>()
  let iciceCift = 0
  for (let i = 0; i < gorunur.length; i++) {
    for (let j = i + 1; j < gorunur.length; j++) {
      if (!ustUste(gorunur[i], gorunur[j])) continue
      iciceCift++
      const a = gorunur[i].id, b = gorunur[j].id
      buNabiz.add(a < b ? `${a}|${b}` : `${b}|${a}`)
    }
  }
  for (const k of [...iciceSure.keys()]) if (!buNabiz.has(k)) iciceSure.delete(k)
  let iciceSurdu = false
  const hedefId = new Set<number>()
  for (const k of buNabiz) {
    const su = (iciceSure.get(k) ?? 0) + adim
    iciceSure.set(k, su)
    if (su >= ICICE_SURE) { iciceSurdu = true; for (const t of k.split('|')) hedefId.add(Number(t)) }
  }

  // ── kalıcı sıkışma ──
  let sikisan = 0
  const sikisanId = new Set<number>()
  const goruldu = new Set<number>()
  for (let i = 0; i < gorunur.length; i++) {
    const c = gorunur[i]
    if (!SURUS_FAZLARI.has(c.phase)) continue
    const id = c.id
    goruldu.add(id)
    const onceki = durgun.get(id)
    if (!onceki) { durgun.set(id, { x: c.x, y: c.y, sn: 0 }); continue }
    const yol = Math.hypot(c.x - onceki.x, c.y - onceki.y)
    // fren altındaki bekleyiş = tasarım, arıza değil → süre biriktirme, tazele
    if (yol > SIKISMA_TOLERANS || c.frenli) durgun.set(id, { x: c.x, y: c.y, sn: 0 })
    else {
      const sn = onceki.sn + adim
      durgun.set(id, { x: onceki.x, y: onceki.y, sn })
      if (sn >= SIKISMA_SURE) { sikisan++; sikisanId.add(id) }
    }
  }
  for (const k of [...durgun.keys()]) if (!goruldu.has(k)) durgun.delete(k)

  // ── yığılma: 3 birimlik daire içinde >= 4 SÜRÜŞ fazında araç ──
  // Yalnız sürüş fazları (2 Eyl): canlı yığılma olaylarının yarıdan fazlası duran araçtı —
  // otoparkta 2.5 aralıkla park etmiş 3 araç + park eden 1, ya da kuyruk (waiting) +
  // yanından geçen transit. Hepsi tasarım gereği yakın; olay "hareket eden araçlar üst
  // üste yığıldı" demeli. Bundle 202609020818 sonrası yığılma oranı bu yüzden düşer —
  // taban karşılaştırmasında (trafik-analiz / Monitor) iç içe kalemine bak, o değişmedi.
  let yigilma = false
  const suren = gorunur.filter(c => SURUS_FAZLARI.has(c.phase))
  for (let i = 0; i < suren.length && !yigilma; i++) {
    let n = 1
    for (let j = 0; j < suren.length; j++) {
      if (i === j) continue
      const dx = suren[i].x - suren[j].x, dy = suren[i].y - suren[j].y
      if (dx * dx + dy * dy <= YIGILMA_YARICAP * YIGILMA_YARICAP) n++
    }
    if (n >= YIGILMA_ADET) yigilma = true
  }

  // ── kuyruk tıkalı: tüm slotlar dolu VE giremeyen sayısı artıyor ──
  const giremeyen = ctx!.giremeyen()
  const kuyruk = ctx!.kuyrukDolu() && giremeyen > sonGiremeyen
  sonGiremeyen = giremeyen

  // ── KURTARMA: bekçi bir aracı kilitten çıkardı (bkz. cars.ts BEKCI_*) ──
  // Sayaç TOPLAMDIR; fark alınır. `?.` bilerek: ölçüm modülü hiçbir koşulda oyunu
  // düşüremez — eksik bağlam veren eski/çıplak kurulumlarda (testler) 0 sayılır.
  const kurtarmaTop = ctx!.kurtarma?.() ?? 0
  const kurtarilan = Math.max(0, kurtarmaTop - sonKurtarma)
  sonKurtarma = kurtarmaTop

  // saatlik trend sayacı (olay gönderilsin ya da gönderilmesin birikir)
  sayac.icice += iciceCift
  sayac.sikisan += sikisan
  sayac.bekleyen += gorunur.filter(c => c.phase === 'waiting').length
  sayac.kurtarilan += kurtarilan
  sayac.ornek++

  // ÖNCELİK: KURTARMA > kalıcı sıkışma > iç içe > yığılma > kuyruk (en hafifi).
  // KURTARMA en üstte, çünkü 'sikisma' bir GÖZLEMDİR ("araç 45 sn kıpırdamadı"),
  // kurtarma ise KANITTIR: rota katmanı kilidi çözemedi, son çare sigortası çekti.
  // O anın sahnesi kök nedeni içerir — başka hiçbir kayıt onun yerini tutmaz.
  const tur: OlayTuru | null = kurtarilan > 0 ? 'kurtarma'
    : sikisan > 0 ? 'sikisma'
    : iciceSurdu ? 'icice'
    : yigilma ? 'yigilma'
    : kuyruk ? 'kuyruk'
    : null
  if (tur) {
    const idler = tur === 'sikisma' ? sikisanId
      : tur === 'icice' ? hedefId
      : tur === 'kurtarma' ? new Set(gorunur.filter(c => c.hayalet).map(c => c.id))
      : null
    const hedef = idler ? gorunur.map((c, i) => idler.has(c.id) ? i : -1).filter(i => i >= 0) : []
    olayGonder(tur, gorunur, hedef)
  }
}

/** index.html `<meta name="surum">` (vite.config surumMeta). Testlerde (DOM yok) tanımsız. */
function surumDamgasi(): string | undefined {
  if (typeof document === 'undefined') return undefined
  return document.querySelector('meta[name="surum"]')?.getAttribute('content') ?? undefined
}

/** kapı bekçisi: tavan + aralık + aynı tür tekrarı. Geçerse snapshot'ı yollar. */
function olayGonder(tur: OlayTuru, araclar: OlayAraci[], hedef: number[] = []): boolean {
  if (!aktif) return false
  if (gonderilen >= OTURUM_TAVANI) return false
  if (gecenSn - sonOlayT < OLAY_ARALIK_SN) return false
  if (tur === sonTur && sonTurArtArda >= AYNI_TUR_ARKA_ARKAYA) return false
  const c = ctx!
  const olay: TrafikOlay = {
    k: tur,
    day: c.gun(),
    loc: c.loc(),
    pumps: c.pompa(),
    ev: c.sarj(),
    cars: araclar.map(a => [yuvarla(a.x), yuvarla(a.y), a.phase, a.slotIndex, a.kind] as OlayAracSatiri),
    slots: {
      pump: c.pumpSlots().map(v => [yuvarla(v.x), yuvarla(v.y)] as [number, number]),
      ev: c.evSlots().map(v => [yuvarla(v.x), yuvarla(v.y)] as [number, number]),
    },
    yapi: c.yapi(),
    hedef,
    v: surumDamgasi(),
  }
  sonOlayT = gecenSn
  gonderilen++
  sonTurArtArda = tur === sonTur ? sonTurArtArda + 1 : 1
  sonTur = tur
  gonderilenler.push(olay)
  gonder('/api/trafik-olay', olay)
  return true
}

/** 5 dakikalık kompakt sayaç (saatlik toplanır → trend). Olay kaydından BAĞIMSIZ. */
function sayacGonder() {
  const ornek = sayac.ornek
  const paket = {
    k: 'trafik',
    icice: Math.round(sayac.icice), sikisan: Math.round(sayac.sikisan),
    bekleyen: Math.round(sayac.bekleyen), kurtarilan: Math.round(sayac.kurtarilan), ornek,
  }
  sayac.icice = 0; sayac.sikisan = 0; sayac.bekleyen = 0; sayac.kurtarilan = 0; sayac.ornek = 0
  if (!aktif || ornek <= 0) return
  gonder('/api/metric', paket)
}
