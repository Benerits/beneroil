/**
 * ŞERİT AĞI — ÖNCEDEN HESAPLANMIŞ TRAFİK (mimari karar, oyun sahibi)
 *
 * NEDEN DEĞİŞTİ (eski dosyanın tamamı silindi):
 * Burada REZERVASYON GRAFİĞİ vardı: kapı ağzı/ünite koridoru "çakışma bölgesi" olarak
 * modelleniyor, araç bölgeye girmeden token alıyor, alamazsa BEKLİYORDU. Token + FIFO
 * kuyruğu + TTL + açlık önleme + sweep... hepsi tek bir varsayımın türeviydi:
 * "araçlar aynı fiziksel alanı paylaşacak, o yüzden müzakere etmeliler".
 *
 * Oyun sahibinin kararı bu varsayımı KALDIRDI: "Yapılar place edildiğinde çok düzgün bir
 * path çizilmeli ve arabalar bunu kullanmalı. Gerekirse birbirinin içinden geçsinler ama
 * bu yollar öyle hesaplanmalı ki kesinlikle düzgün, açık şekilde takip edilebilsin.
 * Dinamikten ziyade AKICILIK istiyorum."
 *
 * Sektör kanıtı aynı yöne işaret ediyor: SimCity 2013 her aracı ajan olarak müzakere
 * ettirdi ve tıkanmaları hiç çözemedi; Planet Coaster (bir tycoon) kalabalığı flow field
 * ile akıtır, ajan müzakeresiyle değil. Bu bir TYCOON: trafik mekanik değil, DEKOR + tempo.
 *
 * YENİ MODEL: yerleşim değiştiğinde (bina kurulur/taşınır/döner, şube açılır) istasyon
 * başına ŞERİT AĞI bir kez hesaplanır. Şeritler GEOMETRİK OLARAK AYRIK: gelen akış ile
 * giden akış farklı x kolonlarında, her ünitenin kendi yaklaşma kolu var. Araç şeride
 * girer ve sonuna kadar akar; kimse kimseyi beklemez, çünkü bekleyecek bir çakışma yok.
 *
 * Bu dosya sahne/three.js bilmez: saf geometri (test edilebilir, ucuz, deterministik).
 */

/** Ünitenin servis noktası (aracın durduğu yer). Şerit uçları BUNDAN türer —
 *  world.pumpSlots / world.evSlots API'si tek kaynak, elle aynalama yok. */
export interface UnitPoint {
  /** 'pump-3' / 'ev-1' */
  id: string
  x: number
  y: number
}

export interface StationGeom {
  station: string
  gateX: number
  lane: number
  gateInY: number
  gateOutY: number
  sideSign: number // istasyonun yönü (near -1, far +1)
  dirY: number     // seyir yönü (near +1, far -1)
  wide: boolean    // geniş kapı alındı mı
  /** bu istasyonun pompa/şarj servis noktaları */
  units?: UnitPoint[]
  /** MARİNA: şeritler suda kalmalı, tekne boyu araçtan kat kat büyük */
  water?: boolean
}

/** ARACIN YARI GENİŞLİĞİ + PAY. Şerit ekseni ile ÜNİTEDE DURAN aracın merkezi arasında
 *  en az bu kadar mesafe bırakılır; yoksa akan araç duran aracın gövdesine biner.
 *  1.05 seçildi: yük testinde "iç içe" ölçütü merkez mesafesi < 1.0 olarak sayılıyor. */
export const UNIT_CLEAR = 1.05
/** GELEN ve GİDEN omurga arasındaki mesafe. İki akım aynı kolonda olmasın diye. */
export const LANE_SEP = 1.05
/** Çıkış omurgasının kapıya en yakın olabileceği derinlik. NEGATİF OLABİLİR: kapı hattı
 *  (gateX) ile yol kenarı bordürü (world.buildRoadEdge, x=5.02 / karşı yakada aynası)
 *  arasında ~0.8 birimlik rampa şeridi var ve orası SAHANIN İÇİ. Dar avlularda çıkış
 *  omurgasını oraya taşımak, iki şeridi ayrık tutmanın tek yolu (bordürü ASLA aşmaz). */
export const EXIT_DEPTH_MIN = -0.6
/** Gelen omurganın kapıya en yakın olabileceği derinlik (çok dar avluda taban). */
export const IN_DEPTH_MIN = 0.5
/** Gelen omurga avlunun derinliklerine kaçmasın (ünite çok batıdaysa) */
export const IN_DEPTH_MAX = 2.6

/** Kuyruk slotları: kapıdan içeri ilk slot ve slot aralığı (araç boyu 2.66 + pay). */
export const QUEUE_BASE = 3.4
export const QUEUE_STEP = 2.9
/** MARİNA: süperyat 8.5 birim — tekne kuyruğu araç aralığıyla iç içe girerdi. */
export const QUEUE_BASE_WATER = 4
export const QUEUE_STEP_WATER = 9
export const QUEUE_X_WATER = 6.9
/** Kuyruk kapının EN FAZLA bu kadar gerisine uzayabilir (avlunun içinde, çitin dibinde).
 *  Daha uzunu sahayı taşar; oradan sonrası kapasite değil, "giremeyen müşteri"dir. */
export const QUEUE_TAIL_MAX = 17

/** GERİYE DÖNÜK: ünite yokken (henüz pompa kurulmamış) kullanılan varsayılan apron ofseti. */
export const APRON_LANE_OFF = 1.75

export interface Pt { x: number; y: number }

/** Bir istasyonun ÖNCEDEN HESAPLANMIŞ şerit ağı. */
export interface StationLanes {
  station: string
  gateX: number
  gateInY: number
  gateOutY: number
  lane: number
  sideSign: number
  dirY: number
  /** GELEN omurga (kapı → üniteler) x kolonu */
  xIn: number
  /** GİDEN omurga (üniteler → çıkış kapısı) x kolonu */
  xOut: number
  /** kuyruk slotları — gelen omurga üzerinde SABİT noktalar (araç slota kayar) */
  queue: Pt[]
}

export class LaneNetwork {
  private byStation = new Map<string, StationLanes>()
  /** hata ayıklama katmanı (?traffic=1) için şerit dikdörtgenleri */
  zones: { id: string; cx: number; cy: number; w: number; d: number; capacity: number }[] = []
  /** telemetri: kaç araç şeride yerleşti / kaçı yer bulamadı (kapasite baskısı).
   *  Eski `granted/denied` adları KORUNDU (traffic-debug.ts arayüzü). */
  stats = { granted: 0, denied: 0 }

  /**
   * Yerleşimden ŞERİT AĞINI TÜRET. Yalnız yerleşim imzası değişince çağrılır —
   * kare başına DEĞİL (mobil performans kuralı).
   */
  rebuild(geoms: StationGeom[]) {
    this.byStation.clear()
    this.zones = []
    for (const g of geoms) {
      const units = g.units ?? []
      // ŞERİT DERİNLİKLERİ ÜNİTELERDEN TÜRER. "Derinlik" = kapıdan istasyonun içine mesafe.
      // En SIĞ ünite belirleyicidir: omurga ondan UNIT_CLEAR kadar uzakta kalmalı, yoksa
      // akan araç orada duran aracın üstünden geçer (oyuncunun gördüğü "iç içe" görüntü).
      let dUnit = Infinity
      for (const u of units) {
        const d = g.sideSign < 0 ? (g.gateX - u.x) : (u.x - g.gateX)
        if (d > 0.4 && d < dUnit) dUnit = d
      }
      if (!isFinite(dUnit)) dUnit = APRON_LANE_OFF + UNIT_CLEAR // henüz ünite yok
      const dIn = Math.min(IN_DEPTH_MAX, Math.max(IN_DEPTH_MIN, dUnit - UNIT_CLEAR))
      // Çıkış omurgası kapıya daha yakın: çıkan araç zaten kapıya gidiyor, gelen araç
      // ise avlunun içine. İkisi AYNI YÖNDE akar (near +y, far −y) — kafa kafaya İMKÂNSIZ.
      const dOut = Math.max(EXIT_DEPTH_MIN, dIn - LANE_SEP)
      const xIn = g.water ? QUEUE_X_WATER : g.gateX + g.sideSign * dIn
      const xOut = g.gateX + g.sideSign * dOut

      // ── KUYRUK = GELEN OMURGA ÜZERİNDE SABİT SLOTLAR ──
      // Ayrı bir "bekleme koridoru" YOK: avlu (kapı ↔ ünite hattı) fiziksel olarak iki
      // şerit genişliğinde. Üçüncü bir paralel şerit araçları 0.6 birim yan yana dizerdi —
      // tam da silmeye çalıştığımız iç içe geçme.
      //
      // SIRALAMA KRİTİK (ölçüldü): slot 0 = SIRANIN BAŞI ve akış yönünde EN İLERİDEKİ
      // nokta. Kuyruk oradan kapıya doğru GERİ dizilir. Böylece
      //   · yeni gelen araç en arkadaki boş slota girer → kimseyi GEÇMEZ,
      //   · pompaya gönderilen baş araç ileri gider → kimseyi GEÇMEZ,
      //   · sıra ilerleyince herkes bir ileri kayar → kimseyi GEÇMEZ.
      // Slot 0 önce, kapıdan SONRA gelen ilk ünitenin 2.6 birim gerisine çakılır: kuyruk
      // ünitelerin üstüne binmesin, ama boşuna da uzamasın. (Eski dizilim slot 0'ı kapıya
      // en yakın noktaya koyuyordu; yeni gelen her araç, kendinden önce sıraya girmiş
      // araçların GÖVDESİNDEN geçerek arkaya gidiyordu — yük testinde en büyük iç içe
      // kalemi buydu: T8'de 174 çift.)
      const qn = g.wide ? 10 : 8 // GENİŞ KAPININ YENİ FAYDASI: içeride daha çok araç bekler
      const base = g.water ? QUEUE_BASE_WATER : QUEUE_BASE
      const step = g.water ? QUEUE_STEP_WATER : QUEUE_STEP
      let capa = g.gateInY + g.dirY * base
      let enYakin = Infinity
      for (const u of units) {
        const ileri = (u.y - g.gateInY) * g.dirY // >0 → akış yönünde kapıdan sonra
        if (ileri > 1.5 && ileri < enYakin) { enYakin = ileri; capa = u.y - g.dirY * (step * 0.9) }
      }
      // çapa kapının gerisine düşmesin (araç kapıdan girer, geri geri gidemez)
      if ((capa - g.gateInY) * g.dirY < 1.5) capa = g.gateInY + g.dirY * 1.5
      const queue: Pt[] = []
      for (let i = 0; i < (g.water ? 4 : qn); i++) {
        const y = capa - g.dirY * i * step
        // KUYRUK ÇİTİN İÇİNDE KALSIN: kapının en fazla QUEUE_TAIL_MAX gerisine uzar,
        // sonrası kapasite değildir (yer bulamayan müşteri "giremeyen" olarak sayılır).
        if ((y - g.gateInY) * g.dirY < -QUEUE_TAIL_MAX) break
        queue.push({ x: xIn, y })
      }
      if (!queue.length) queue.push({ x: xIn, y: g.gateInY + g.dirY * base })

      const L: StationLanes = {
        station: g.station, gateX: g.gateX, gateInY: g.gateInY, gateOutY: g.gateOutY,
        lane: g.lane, sideSign: g.sideSign, dirY: g.dirY, xIn, xOut, queue,
      }
      this.byStation.set(g.station, L)

      // ---- hata ayıklama dikdörtgenleri (oyunu etkilemez) ----
      const ys = [g.gateInY, g.gateOutY, ...units.map(u => u.y), ...queue.map(q => q.y)]
      const y0 = Math.min(...ys) - 2, y1 = Math.max(...ys) + 2
      this.zones.push({ id: `in-${g.station}`, cx: xIn, cy: (y0 + y1) / 2, w: 0.5, d: y1 - y0, capacity: 1 })
      this.zones.push({ id: `out-${g.station}`, cx: xOut, cy: (y0 + y1) / 2, w: 0.5, d: y1 - y0, capacity: 1 })
      for (const u of units) {
        this.zones.push({ id: `arm-${g.station}-${u.id}`, cx: (xIn + u.x) / 2, cy: u.y,
          w: Math.abs(xIn - u.x), d: 0.4, capacity: 1 })
      }
    }
  }

  get(station: string): StationLanes | null { return this.byStation.get(station) ?? null }

  /** kuyruk slotu sayısı (yerleşimden gelir; geniş kapı daha çok slot verir) */
  queueCount(station: string): number { return this.byStation.get(station)?.queue.length ?? 0 }

  /** kuyruk slotunun DÜNYA konumu */
  slot(station: string, i: number): Pt | null {
    const L = this.byStation.get(station)
    if (!L || !L.queue.length) return null
    return L.queue[Math.min(i, L.queue.length - 1)]
  }

  /** Yoldan kapı ağzına: banket üzerinden yaklaşma (şerit trafiği yanından akar). */
  private gateApproach(L: StationLanes): Pt[] {
    return [
      { x: (L.lane + L.gateX) / 2, y: L.gateInY - L.dirY * 3.4 },
      { x: L.gateX, y: L.gateInY },
      { x: L.xIn, y: L.gateInY },
    ]
  }

  /**
   * GİRİŞ ŞERİDİ: yol → kapı → gelen omurga → ünitenin hizası → ünite kolu.
   * Tek bir akış; ortada karar/müzakere yok.
   */
  entryPath(station: string, target: Pt, fromRoad = true): Pt[] {
    const L = this.byStation.get(station)
    if (!L) return [target]
    const out: Pt[] = fromRoad ? this.gateApproach(L) : []
    out.push({ x: L.xIn, y: target.y })  // omurga boyunca ünitenin hizasına
    out.push({ x: target.x, y: target.y }) // KOL: yalnız bu üniteye ait dik yaklaşma
    return out
  }

  /** KUYRUK ŞERİDİ: yol → kapı → gelen omurga → i. slot. */
  queuePath(station: string, i: number, fromRoad = true): Pt[] {
    const L = this.byStation.get(station)
    if (!L) return []
    const s = this.slot(station, i)
    if (!s) return []
    const out: Pt[] = fromRoad ? this.gateApproach(L) : []
    out.push({ x: L.xIn, y: s.y })
    return out
  }

  /**
   * ÇIKIŞ ŞERİDİ: ünite → giden omurga (dik kol) → çıkış kapısı → yola katılma.
   * Giden omurga gelenden AYRI kolonda: çıkan araç kuyruğun içinden geçmez.
   */
  exitPath(station: string, from: Pt): Pt[] {
    const L = this.byStation.get(station)
    if (!L) return []
    return [
      { x: L.xOut, y: from.y },                       // kol: giden omurgaya çık
      { x: L.xOut, y: L.gateOutY },                   // omurga boyunca çıkış kapısına
      { x: L.gateX, y: L.gateOutY },                  // kapı ağzı
      { x: L.lane, y: L.gateOutY + L.dirY * 4 },      // yola katıl
      { x: L.lane, y: L.dirY * 44 },                  // ve git
    ]
  }

  /** doluluk raporu (yalnız hata ayıklama katmanı okur) */
  snapshot(): { id: string; used: number; capacity: number; queued: number }[] {
    return this.zones.map(z => ({ id: z.id, used: 0, capacity: z.capacity, queued: 0 }))
  }
}
