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

export type OlayTuru = 'icice' | 'sikisma' | 'yigilma' | 'kuyruk'

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
}

/** İÇ İÇE eşiği: merkez mesafesi bunun altındaki çift gözle üst üste görünür. */
export const ICICE_MESAFE = 2.15
/** iç içe durumu bu kadar SÜRERSE olay sayılır (anlık kesişme değil) */
export const ICICE_SURE = 2
/** hareketsizlik eşiği (sn) — bu süre boyunca yer değiştirmeyen SÜRÜŞ fazındaki araç */
export const SIKISMA_SURE = 45
/** hareketsiz sayılmak için kare başına izin verilen en büyük yer değiştirme (birim) */
const SIKISMA_TOLERANS = 0.12
/** yığılma: bu yarıçaptaki daire içinde ... */
export const YIGILMA_YARICAP = 3
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
/** 5 dakikalık kompakt sayaç birikimi */
let sayacT = 0
const sayac = { icice: 0, sikisan: 0, bekleyen: 0, ornek: 0 }
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
  sonTur = null; sonTurArtArda = 0; sonGiremeyen = 0; sayacT = 0
  iciceSure.clear(); durgun.clear(); gonderilenler.length = 0
  sayac.icice = 0; sayac.sikisan = 0; sayac.bekleyen = 0; sayac.ornek = 0
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
      const dx = gorunur[i].x - gorunur[j].x, dy = gorunur[i].y - gorunur[j].y
      if (dx * dx + dy * dy >= ICICE_MESAFE * ICICE_MESAFE) continue
      iciceCift++
      const a = gorunur[i].id, b = gorunur[j].id
      buNabiz.add(a < b ? `${a}|${b}` : `${b}|${a}`)
    }
  }
  for (const k of [...iciceSure.keys()]) if (!buNabiz.has(k)) iciceSure.delete(k)
  let iciceSurdu = false
  for (const k of buNabiz) {
    const su = (iciceSure.get(k) ?? 0) + adim
    iciceSure.set(k, su)
    if (su >= ICICE_SURE) iciceSurdu = true
  }

  // ── kalıcı sıkışma ──
  let sikisan = 0
  const goruldu = new Set<number>()
  for (let i = 0; i < gorunur.length; i++) {
    const c = gorunur[i]
    if (!SURUS_FAZLARI.has(c.phase)) continue
    const id = c.id
    goruldu.add(id)
    const onceki = durgun.get(id)
    if (!onceki) { durgun.set(id, { x: c.x, y: c.y, sn: 0 }); continue }
    const yol = Math.hypot(c.x - onceki.x, c.y - onceki.y)
    if (yol > SIKISMA_TOLERANS) durgun.set(id, { x: c.x, y: c.y, sn: 0 })
    else {
      const sn = onceki.sn + adim
      durgun.set(id, { x: onceki.x, y: onceki.y, sn })
      if (sn >= SIKISMA_SURE) sikisan++
    }
  }
  for (const k of [...durgun.keys()]) if (!goruldu.has(k)) durgun.delete(k)

  // ── yığılma: 3 birimlik daire içinde >= 4 araç ──
  let yigilma = false
  for (let i = 0; i < gorunur.length && !yigilma; i++) {
    let n = 1
    for (let j = 0; j < gorunur.length; j++) {
      if (i === j) continue
      const dx = gorunur[i].x - gorunur[j].x, dy = gorunur[i].y - gorunur[j].y
      if (dx * dx + dy * dy <= YIGILMA_YARICAP * YIGILMA_YARICAP) n++
    }
    if (n >= YIGILMA_ADET) yigilma = true
  }

  // ── kuyruk tıkalı: tüm slotlar dolu VE giremeyen sayısı artıyor ──
  const giremeyen = ctx!.giremeyen()
  const kuyruk = ctx!.kuyrukDolu() && giremeyen > sonGiremeyen
  sonGiremeyen = giremeyen

  // saatlik trend sayacı (olay gönderilsin ya da gönderilmesin birikir)
  sayac.icice += iciceCift
  sayac.sikisan += sikisan
  sayac.bekleyen += gorunur.filter(c => c.phase === 'waiting').length
  sayac.ornek++

  // ÖNCELİK: kalıcı sıkışma en ağır kusur, kuyruk en hafifi
  const tur: OlayTuru | null = sikisan > 0 ? 'sikisma'
    : iciceSurdu ? 'icice'
    : yigilma ? 'yigilma'
    : kuyruk ? 'kuyruk'
    : null
  if (tur) olayGonder(tur, gorunur)
}

/** kapı bekçisi: tavan + aralık + aynı tür tekrarı. Geçerse snapshot'ı yollar. */
function olayGonder(tur: OlayTuru, araclar: OlayAraci[]): boolean {
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
    bekleyen: Math.round(sayac.bekleyen), ornek,
  }
  sayac.icice = 0; sayac.sikisan = 0; sayac.bekleyen = 0; sayac.ornek = 0
  if (!aktif || ornek <= 0) return
  gonder('/api/metric', paket)
}
