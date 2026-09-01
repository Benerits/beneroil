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

/**
 * OTOPARK YERİ — park noktası (x,y) + otoparkın KENDİ yanaşma noktası (sx,sy).
 * world.getParkingSpots() ile aynı kaynak; şerit ağı bunlardan koridor türetir.
 */
export interface ParkPoint {
  /** 'parking:2' / 'parking#3:0' — nokta öncesi kısım OTOPARK BİNASININ kimliği */
  id: string
  x: number
  y: number
  /** stage (yanaşma) noktası — otoparkın yerel +Y cephesi */
  sx: number
  sy: number
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
  /** bu istasyonun (yakanın) park yerleri */
  parks?: ParkPoint[]
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
// KUYRUK ARALIĞI — TELEMETRİYLE BULUNDU, YÜK TESTİYLE SEÇİLDİ (1 Eyl).
// Canlı olay kayıtları (2.707 olay/19 saat): olayların %96'sı iç içe/yığılma ve en
// büyük küme tek pompalı gün-1 istasyonunda kuyruk başı sıkışması (22x). Kök: aralık
// 2,9 - gövde 2,66 = 0,24 pay, tampon tampona. 3,5'e çıkarmak İKİ korkuyu da boşa
// çıkardı (yük testi): toplam servis 1285→1326 (+%3,2), geri çevrilen 58→35.
// Yanaşma pürüzsüzleşince slot devri hızlanıyor — dar dizilim gelire de zarar veriyormuş.
export const QUEUE_STEP = 3.5
/** MARİNA: süperyat 8.5 birim — tekne kuyruğu araç aralığıyla iç içe girerdi. */
export const QUEUE_BASE_WATER = 4
export const QUEUE_STEP_WATER = 9
export const QUEUE_X_WATER = 6.9
/** Kuyruk kapının EN FAZLA bu kadar gerisine uzayabilir (avlunun içinde, çitin dibinde).
 *  Daha uzunu sahayı taşar; oradan sonrası kapasite değil, "giremeyen müşteri"dir.
 *  (Konveyör kuralından beri yalnız MARİNA kuyruğu için geçerli — kara kuyruğunun
 *  taşması artık BANKET segmentine gider, aşağıya bak.) */
export const QUEUE_TAIL_MAX = 17
/**
 * ── BANKET (TAŞMA) KUYRUĞU — KONVEYÖR KURALININ GEOMETRİ AYAĞI ──
 * ANA kuyruk hattı kapının İÇİNDE, gelen omurga üzerindedir ve kapı ağzında biter
 * (QUEUE_GATE_CLEAR). Eskiden taşan slotlar aynı kolonda kapının GERİSİNE uzuyordu;
 * ölçülen sonuç (T10 tanı koşusu): o slota atanan araç hatta KAPIDAN girip önündeki
 * dizinin İÇİNDEN geriye sürmek zorundaydı — konveyör yönüne ters, ya iç içe geçiyor
 * (canlı telemetrideki %96'lık küme) ya da blok kuralıyla yolun ORTASINDA kalıyordu.
 * Yeni model gerçek istasyondaki gibi: sığmayan kuyruk KAPIDAN ÖNCE, yol omuzunda
 * bekler. Banket hattı araçların geldiği yönle AYNI yönde akar → araç kuyruğa hep
 * ARKADAN katılır, kimse kimsenin içinden geçmez; ilerleme tek yönlü konveyördür.
 */
/** Ana kuyruk slotu kapı ağzına en fazla bu kadar yaklaşır (kapı ağzında araç durmaz —
 *  giren herkes o noktadan geçiyor; eski dizilimde tam ağızda duran slot 0.35'lik
 *  burun buruna geçişler üretiyordu). */
export const QUEUE_GATE_CLEAR = 1.2
/** Banket kuyruğunun kapıya (giriş ağzına) mesafe tabanı. 2.4 ölçülerek seçildi:
 *  3.4 (sahneleme noktasının üstü) banket başını kapıdan gereksiz uzaklaştırıyor ve
 *  banket→ana hat aktarımının yolunu uzatıyordu (pompa o kadar boş bekliyor — T2/T3
 *  servisinde ölçülür kayıp). 2.4 ayrıca sahneleme noktasını (kapı−3.4) iki slotun
 *  ORTASINA düşürür: kapıya dönen araç banketteki araçların üstünden değil arasından geçer. */
export const SPILL_BASE = 2.4
/** Banket kuyruğu haritanın dışına taşmasın (yol ±44'e kadar, karar noktaları ±26). */
export const SPILL_MAX_Y = 38

/** GERİYE DÖNÜK: ünite yokken (henüz pompa kurulmamış) kullanılan varsayılan apron ofseti. */
export const APRON_LANE_OFF = 1.75

/**
 * OTOPARK KORİDORU — giriş ve çıkış hattı arası mesafe. LANE_SEP ile aynı gerekçe:
 * park etmeye GİDEN araç ile parktan ÇIKAN araç aynı çizgide olursa kafa kafaya gelir.
 * Otoparkta bu daha da kritik: koridor bir çıkmaz sokaktır, kaçacak yer yoktur.
 */
export const PARK_AISLE_SEP = 1.05
/** Koridorun slot dizisinin ötesine uzadığı pay — araç dönüşünü koridorun UCUNDA yapar,
 *  slotların hizasında değil (yoksa dönüş yayı komşu slottaki aracın üstünden geçer). */
export const PARK_END_PAD = 1.7
/** Koridor/kol temizlik taraması: bu adımla nokta nokta örneklenir (araç yarı boyu altı). */
const PARK_TARAMA = 0.35

export interface Pt { x: number; y: number }

/**
 * BİR PARK YERİNİN ÖNCEDEN ÇİZİLMİŞ YOLU.
 * Giriş: entry → inArm → spot.   Çıkış: spot → outArm → exit → istasyon çıkış şeridi.
 * inArm/outArm hatları PARK_AISLE_SEP kadar ayrık → koridorda kafa kafaya gelme yok.
 */
export interface ParkLane {
  id: string
  spot: Pt
  /** giriş koridorunda bu slotun hizası (koldan slota dik iniş buradan başlar) */
  inArm: Pt
  /** çıkış koridorunda bu slotun hizası */
  outArm: Pt
  /** giriş koridorunun ağzı (araç koridora BURADAN girer) */
  entry: Pt
  /** çıkış koridorunun ağzı (araç koridordan BURADAN çıkar) */
  exit: Pt
  /** +1 stage cephesinden, −1 ters cepheden yanaşma. Park AÇISI buna göre 180° döner. */
  side: number
}

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
  /** kuyruk slotları — gelen omurga üzerinde SABİT noktalar (araç slota kayar).
   *  spillStart'tan itibaren BANKET slotları: kapıdan önce, yol omuzunda. */
  queue: Pt[]
  /** bu indeksten itibaren slotlar BANKET (taşma) segmentinde — kapının DIŞINDA.
   *  queue.length'e eşitse banket yok (marina hep böyle). */
  spillStart: number
  /** KULLANILABİLİR park yerleri (yolu katı cisimle kapalı olanlar burada YOKTUR) */
  parks: ParkLane[]
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
  rebuild(geoms: StationGeom[], blocked?: (x: number, y: number) => boolean) {
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
        // MARİNA: kuyruk çitin içinde kalsın — kapının en fazla QUEUE_TAIL_MAX gerisi.
        if (g.water && (y - g.gateInY) * g.dirY < -QUEUE_TAIL_MAX) break
        // KARA: ana hat kapı ağzında BİTER (konveyör kuralı). Kapı ağzına/gerisine slot
        // koymak, oraya atanan aracı önündeki dizinin içinden geçmeye zorluyordu — o
        // slotlar artık BANKET segmentine gider (aşağıda).
        if (!g.water && (y - g.gateInY) * g.dirY < QUEUE_GATE_CLEAR) break
        queue.push({ x: xIn, y })
      }
      // ── BANKET (TAŞMA) SEGMENTİ: sığmayan slotlar kapıdan ÖNCE, yol omuzunda ──
      // Omuz kolonu kapı yaklaşmasının sahneleme noktasıyla aynı x'te: araç yoldan
      // gelirken zaten oradan geçiyor, kuyruğa ARKADAN katılır (konveyör yönü korunur).
      const spillStart = queue.length
      if (!g.water) {
        const xs = (g.lane + g.gateX) / 2
        for (let k = 0; queue.length < qn; k++) {
          const y = g.gateInY - g.dirY * (SPILL_BASE + k * step)
          if (Math.abs(y) > SPILL_MAX_Y) break
          queue.push({ x: xs, y })
        }
      }
      if (!queue.length) queue.push({ x: xIn, y: g.gateInY + g.dirY * base })

      const L: StationLanes = {
        station: g.station, gateX: g.gateX, gateInY: g.gateInY, gateOutY: g.gateOutY,
        lane: g.lane, sideSign: g.sideSign, dirY: g.dirY, xIn, xOut, queue,
        // fallback slotu (yalnız marina/boş yerleşim) ana hatta sayılır
        spillStart: g.water ? queue.length : Math.min(spillStart, queue.length),
        parks: this.parkLanes(g, blocked),
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
      for (const p of L.parks) {
        this.zones.push({ id: `park-${g.station}-${p.id}`, cx: (p.inArm.x + p.spot.x) / 2,
          cy: (p.inArm.y + p.spot.y) / 2, w: 0.5, d: 0.5, capacity: 1 })
      }
    }
  }

  /**
   * OTOPARK ŞERİTLERİ — pompa/şarj kolu kalıbının OTOPARKA UYGULANMIŞ hâli.
   *
   * NEDEN VAR (ölçülmüş hata): otopark şerit ağının DIŞINDAYDI. Rota elle yazılmış üç
   * noktaydı (sabit bir x kolonu → stage → park yeri) ve "stage" noktası oyuncunun
   * yerleşimine göre bir POMPA GÖVDESİNİN İÇİNE düşebiliyordu. Oyunun VARSAYILAN
   * yerleşiminde tam olarak bu oluyor: otopark (0.4,−0.2), pompalar (0,±2.2) — 4 park
   * yerinden ikisinin hem yanaşma noktası hem park noktası pompa gövdesinin çarpışma
   * zarfının içinde kalıyor. Araç oraya asla varamıyor, gövdenin dibinde kilitleniyor;
   * arkasından gelenler de aynı noktaya yığılıyor. Oyuncunun gördüğü "araçlar üst üste,
   * park yerleri boş" görüntüsü buydu (ölçüm: kalıcı sıkışan 1, otopark bölgesinde
   * 1.43 çakışma çift/kare).
   *
   * YENİ MODEL — üç kural:
   *  1. TEK YÖNLÜ KORİDOR: giriş hattı ve çıkış hattı PARK_AISLE_SEP kadar ayrı iki
   *     paralel çizgi. Koridor çıkmaz sokaktır; aynı çizgide iki yön kafa kafaya gelir.
   *  2. SLOT BAŞINA KOL: koridordan park yerine dik iniş. Kol yalnız o slota aittir
   *     (parkOcc zaten slot başına tek araç tutar).
   *  3. KAPALIYSA YOK SAYILIR: yolu ya da park noktası katı cisimle kapalı olan slot
   *     listeye HİÇ GİRMEZ. Araç ulaşamayacağı yere gönderilmez → kilitlenme imkânsız.
   *     (Oyuncu otoparkı taşıdığında slotlar kendiliğinden geri gelir.)
   */
  private parkLanes(g: StationGeom, blocked?: (x: number, y: number) => boolean): ParkLane[] {
    const parks = g.parks ?? []
    if (!parks.length) return []
    const bos = (x: number, y: number) => !blocked || !blocked(x, y)
    /** iki nokta arası hat temiz mi (nokta nokta tara) */
    const hatBos = (a: Pt, b: Pt) => {
      const len = Math.hypot(b.x - a.x, b.y - a.y)
      const n = Math.max(1, Math.ceil(len / PARK_TARAMA))
      for (let i = 0; i <= n; i++) {
        if (!bos(a.x + (b.x - a.x) * i / n, a.y + (b.y - a.y) * i / n)) return false
      }
      return true
    }
    // OTOPARK BİNASINA GÖRE GRUPLA: koridor bir binanın slot dizisinden türer
    const lots = new Map<string, ParkPoint[]>()
    for (const p of parks) {
      const lot = p.id.includes(':') ? p.id.slice(0, p.id.lastIndexOf(':')) : p.id
      const list = lots.get(lot)
      if (list) list.push(p); else lots.set(lot, [p])
    }
    const out: ParkLane[] = []
    for (const list of lots.values()) {
      // n = park yerinden yanaşma noktasına bakan birim vektör (otoparkın "ön cephesi"),
      // u = slot dizisinin yönü. İkisi dik; otopark döndürülse de birlikte dönerler.
      const p0 = list[0]
      const d0 = Math.hypot(p0.sx - p0.x, p0.sy - p0.y)
      if (d0 < 0.2) continue // bozuk veri: yanaşma noktası park yerinin üstünde
      const n = { x: (p0.sx - p0.x) / d0, y: (p0.sy - p0.y) / d0 }
      const u = { x: -n.y, y: n.x }
      // slotları koridor ekseni boyunca sırala (dizinin uçlarını bulmak için)
      const sirali = list
        .map(p => ({ p, t: (p.x - p0.x) * u.x + (p.y - p0.y) * u.y }))
        .sort((a, b) => a.t - b.t)
      const kaydir = (p: Pt, along: number, off: number): Pt =>
        ({ x: p.x + u.x * along + n.x * off, y: p.y + u.y * along + n.y * off })
      const derinlik = (p: Pt) => g.sideSign < 0 ? (g.gateX - p.x) : (p.x - g.gateX)

      // İKİ CEPHE DENENİR: önce otoparkın kendi ön cephesi (+1), kapalıysa arka cephe (−1).
      // Arka cepheden yanaşan araç 180° ters park eder — açı ParkLane.side ile taşınır.
      let best: ParkLane[] = []
      for (const side of [1, -1]) {
        const inOff = side * d0
        const outOff = side * (d0 + PARK_AISLE_SEP)
        const tMin = sirali[0].t - PARK_END_PAD, tMax = sirali[sirali.length - 1].t + PARK_END_PAD
        const uclar = [tMin, tMax].map(t => ({
          t, gir: kaydir(p0, t, inOff), cik: kaydir(p0, t, outOff),
        })).filter(e => bos(e.gir.x, e.gir.y) && bos(e.cik.x, e.cik.y))
        if (!uclar.length) continue
        // Koridor ORTADAN kapalı olabilir (oyuncu otoparkı pompa sırasının dibine kurmuş).
        // Her uçtan koridoru tarayıp NEREYE KADAR açık olduğunu bul; slot yalnız kendi
        // tarafındaki ağızdan servis edilir. Kapalı bölge iki tarafı fiziksel olarak
        // ayırdığı için karşılıklı iki araç aynı koridor parçasına HİÇ giremez.
        const menzil = uclar.map(e => {
          let ok = e.t
          const yon = e.t === tMin ? 1 : -1
          for (let s = 0; s <= (tMax - tMin) / PARK_TARAMA; s++) {
            const t = e.t + yon * s * PARK_TARAMA
            const gp = kaydir(p0, t, inOff), cp = kaydir(p0, t, outOff)
            if (!bos(gp.x, gp.y) || !bos(cp.x, cp.y)) break
            ok = t
          }
          return { ...e, ok, yon }
        })
        // Koridor BAŞTAN SONA açıksa tek ağız kullanılır (kapıya yakın olan): tek yönlü
        // akış en yalın hâliyle korunur. Kapalıysa her uç kendi tarafına hizmet eder.
        const tamAcik = menzil.some(e => e.yon > 0 && e.ok >= tMax - 1e-6)
          && menzil.some(e => e.yon < 0 && e.ok <= tMin + 1e-6)
        const agizlar = tamAcik
          ? [menzil.slice().sort((a, b) => derinlik(a.gir) - derinlik(b.gir))[0]]
          : menzil
        const aday: ParkLane[] = []
        for (const { p, t } of sirali) {
          const inArm = kaydir(p0, t, inOff)
          const outArm = kaydir(p0, t, outOff)
          if (!bos(p.x, p.y) || !bos(inArm.x, inArm.y) || !bos(outArm.x, outArm.y)) continue
          if (!hatBos(inArm, p)) continue        // kol: koridordan park yerine
          if (!hatBos(p, outArm)) continue       // kol: park yerinden çıkış koridoruna
          // bu slota hizmet edebilecek ağızlardan KAPIYA EN YAKIN olanı
          const uc = agizlar
            .filter(e => e.yon > 0 ? t <= e.ok : t >= e.ok)
            .filter(e => hatBos(e.gir, inArm) && hatBos(outArm, e.cik))
            .sort((a, b) => derinlik(a.gir) - derinlik(b.gir))[0]
          if (!uc) continue
          aday.push({ id: p.id, spot: { x: p.x, y: p.y }, inArm, outArm,
            entry: uc.gir, exit: uc.cik, side })
        }
        if (aday.length > best.length) best = aday
        if (best.length === list.length) break // bu cephe tam açık, ötekini denemeye gerek yok
      }
      out.push(...best)
    }
    return out
  }

  /** bu yakanın KULLANILABİLİR park şeritleri (yolu kapalı slotlar listede yoktur) */
  parkLanesOf(station: string): ParkLane[] { return this.byStation.get(station)?.parks ?? [] }

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

  /** KUYRUK ŞERİDİ: yol → kapı → gelen omurga → i. slot.
   *  BANKET slotu için kapıdan İÇERİ GİRİLMEZ: araç yol omuzunda, kapının önünde
   *  bekler (taşma kuyruğu). Omuz hattı geliş yönüyle aynı yönde akar — araç kuyruğa
   *  hep arkadan katılır, önündeki dizinin içinden geçmek imkânsızdır. */
  queuePath(station: string, i: number, fromRoad = true): Pt[] {
    const L = this.byStation.get(station)
    if (!L) return []
    const s = this.slot(station, i)
    if (!s) return []
    if (Math.min(i, L.queue.length - 1) >= L.spillStart) return [{ x: s.x, y: s.y }]
    const out: Pt[] = fromRoad ? this.gateApproach(L) : []
    out.push({ x: L.xIn, y: s.y })
    return out
  }

  /** BANKETTEN ANA HATTA TERFİ YOLU: omuz → kapı ağzı → gelen omurga → hedef slot.
   *  Düz çizgi çitin köşesinden geçerdi; terfi kapıdan yapılır. */
  spillPromotePath(station: string, i: number): Pt[] {
    const L = this.byStation.get(station)
    const s = this.slot(station, i)
    if (!L || !s) return s ? [s] : []
    return [{ x: L.gateX, y: L.gateInY }, { x: L.xIn, y: L.gateInY }, { x: L.xIn, y: s.y }]
  }

  /** i. slot banket segmentinde mi (kapının dışında, yol omuzunda) */
  isSpillSlot(station: string, i: number): boolean {
    const L = this.byStation.get(station)
    return !!L && Math.min(i, L.queue.length - 1) >= L.spillStart
  }

  /**
   * ÇIKIŞ ŞERİDİ: ünite → giden omurga (dik kol) → çıkış kapısı → yola katılma.
   * Giden omurga gelenden AYRI kolonda: çıkan araç kuyruğun içinden geçmez.
   */
  exitPath(station: string, from: Pt): Pt[] {
    const L = this.byStation.get(station)
    if (!L) return []
    // KAPI AĞZI NOKTASI SADECE İLERİDEYSE EKLENİR.
    // Giden omurga (xOut) dar avluda kapı hattının YOL TARAFINA düşebiliyor
    // (EXIT_DEPTH_MIN negatif — bkz. sabit). O durumda {gateX, gateOutY} aracın
    // ARKASINDA kalıyordu: araç kapıya varmışken 0.3 birim GERİ, avlunun içine
    // dönüyor, sonra yola çıkıyordu. Ekranda kapı ağzında küçük bir "S" kıvrımı,
    // ölçümde gereksiz yol. Her iki yakada da simetrik olarak oluyordu.
    const dOut = L.sideSign * (L.xOut - L.gateX) // kapıdan avlunun içine derinlik
    const yol: Pt[] = [
      { x: L.xOut, y: from.y },                       // kol: giden omurgaya çık
      { x: L.xOut, y: L.gateOutY },                   // omurga boyunca çıkış kapısına
    ]
    if (dOut > 0.1) yol.push({ x: L.gateX, y: L.gateOutY }) // kapı ağzı (yalnız ileriyse)
    yol.push(
      { x: L.lane, y: L.gateOutY + L.dirY * 4 },      // yola katıl
      { x: L.lane, y: L.dirY * 44 },                  // ve git
    )
    return yol
  }

  /** OTOPARK GİRİŞ ŞERİDİ: koridor ağzı → slotun hizası → park yeri.
   *  Aracın bulunduğu yerden koridor ağzına kadar olan bacak çağıranın işi (engel-farkında
   *  temizlikten geçer); ağızdan SONRASI önceden hesaplanmıştır ve temizdir. */
  parkEntryPath(lane: ParkLane): Pt[] { return [lane.entry, lane.inArm, lane.spot] }

  /** OTOPARK ÇIKIŞ ŞERİDİ: çıkış koridoru → ağız → istasyonun giden omurgası → kapı → yol.
   *  Giriş koridoruna HİÇ girmez (PARK_AISLE_SEP kadar ayrık), yani park etmeye gelen
   *  araçla kafa kafaya gelmesi geometrik olarak imkânsız. */
  parkExitPath(station: string, lane: ParkLane): Pt[] {
    return [lane.outArm, lane.exit, ...this.exitPath(station, lane.exit)]
  }

  /** doluluk raporu (yalnız hata ayıklama katmanı okur) */
  snapshot(): { id: string; used: number; capacity: number; queued: number }[] {
    return this.zones.map(z => ({ id: z.id, used: 0, capacity: z.capacity, queued: 0 }))
  }
}
