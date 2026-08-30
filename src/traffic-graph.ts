/**
 * REZERVASYON TABANLI TRAFİK ÇEKİRDEĞİ (trafik raporu §5)
 *
 * Sorun: rota üretimi serbest waypoint listesiydi, çakışmalar SONRADAN pazarlıkla
 * çözülüyordu (kafa-kafaya dodge, zincir döngü kırıcı, buharlaşma sigortası). Her yeni
 * istasyon aynı hata sınıfını tekrar üretiyordu (B1-B6).
 *
 * Çözüm: istasyonun darboğazları ÇAKIŞMA BÖLGESİ (zone) olarak modellenir. Bölgeler
 * `geom(station)`'dan TÜRETİLİR — yani yeni istasyon eklemek bedava, aynalama hatası
 * imkânsız. Araç bölgeye girmeden ÖNCE token rezerve eder; alamazsa bölge dışında
 * bekler. Kapasite dolu → araç ilerlemez → çakışma OLUŞMAZ.
 *
 * FIFO: her bölgede bekleme sırası vardır, en eski bekleyen ilk girer (açlık yok).
 * Bu dosya sahne/three.js bilmez: saf geometri + rezervasyon defteri (test edilebilir).
 */

/** Bölge = istasyonun darboğazı (kapı ağzı, ünite yaklaşma koridoru). Dikdörtgen + kapasite. */
export interface Zone {
  id: string
  cx: number
  cy: number
  w: number
  d: number
  capacity: number
  /** 'gate' = kapı ağzı: oradan GEÇEN herkes rezerve eder.
   *  'unit' = pompa/şarj yaklaşma koridoru: YALNIZ o üniteye giden (veya oradan ayrılan)
   *  araç rezerve eder. Koridordan sadece geçen aracı da bağlasaydık koridorlar zincir
   *  oluşturur, ters yönde ilerleyen iki araç karşılıklı kilitlenirdi. */
  kind: 'gate' | 'unit'
}

/** Ünitenin servis noktası (aracın durduğu yer) — bölge bundan türetilir. */
export interface UnitPoint {
  /** 'pump-3' / 'ev-1' — bölge kimliği bundan kurulur, cars.ts aynı kalıbı üretir */
  id: string
  x: number
  y: number
}

/** Apron seyir şeridinin kapıdan uzaklığı. entryPath (cars.ts) ile yaklaşma bölgesinin
 *  geometrisi AYNI sabiti kullanmalı — ayrışırsa bölge aracın geçmediği yere düşer. */
export const APRON_LANE_OFF = 1.75

export interface StationGeom {
  station: string
  gateX: number
  lane: number
  gateInY: number
  gateOutY: number
  sideSign: number // istasyonun yönü (near -1, far +1)
  dirY: number     // seyir yönü (near +1, far -1)
  wide: boolean    // geniş kapı alındı mı (kapasite 2)
  /** bu istasyonun pompa/şarj servis noktaları (yaklaşma bölgeleri bunlardan türer) */
  units?: UnitPoint[]
}

/** Bölge sınırına bu mesafede rezervasyon denenir (araç bölgeye girmeden önce durur). */
export const RESERVE_LOOKAHEAD = 2.6

/** Rezervasyon alıp bölgeye bu süre içinde GİRMEYEN araç token'ı bırakır (saniye).
 *  Yaklaşma mesafesi 2.6 birim; normal hızda ~1 sn sürer, 2.5 sn makul pay.
 *  KISA tutulur: kapasite-1 bölgede tıkanmış bir aracın uzun süre yer tutması, kuyruğu
 *  bekletip buharlaşma üretiyordu (yük testinde T3: 8 sn TTL ile buharlaşma 58).
 *  Token geri alınınca araç kuyruğun BAŞINA konur — sırasını çoktan beklemişti. */
export const RESERVE_TTL = 2.5

export class TrafficGraph {
  zones: Zone[] = []
  /** zoneId → içindeki/rezerve etmiş araçlar (ekleme sırası korunur) */
  private occ = new Map<string, Set<unknown>>()
  /** REZERVASYON YAŞI: token aldı ama bölgeye HENÜZ GİRMEDİ olan araçlar.
   *  Araç bölgeye girince kayıt silinir (artık "içeride"dir ve sweep onu çıkışta bırakır). */
  private pending = new Map<string, Map<unknown, number>>()
  /** zoneId → FIFO bekleme sırası (rezervasyon alamayanlar) */
  private waitQ = new Map<string, unknown[]>()
  /** telemetri: kaç kez rezervasyon reddedildi (bekleme = önlenmiş çakışma) */
  stats = { granted: 0, denied: 0 }

  /** Bölgeleri istasyon geometrisinden TÜRET — her istasyon aynı kalıbı alır. */
  rebuild(geoms: StationGeom[]) {
    this.zones = []
    for (const g of geoms) {
      // KAPASİTE HER ZAMAN 1: kapı ağzı fiziksel olarak TEK SIRA. gateInOff/gateOutOff
      // deterministik tek şerit verdiği için (geniş kapıda bile) iki aracı birlikte içeri
      // almak onları aynı şeride sokup kilitliyordu — yük testinde buharlaşma 61 → 0.
      // Geniş kapının faydası giriş/çıkış AYRIMI, aynı ağızda paralellik değil.
      const cap = 1
      // 1) Kapı GİRİŞ ağzı: şerit ↔ kapı arası + kapı derinliği (üç akımın kesiştiği nokta)
      this.zones.push({
        id: `gate-in-${g.station}`, kind: 'gate',
        cx: g.gateX + g.sideSign * 0.6, cy: g.gateInY,
        w: 3.6, d: 4.6, capacity: cap,
      })
      // 2) Kapı ÇIKIŞ ağzı: birleşme bölgesi. Kapasite 2 — çıkış ağzı apron tarafında daha
      // derin (bir araç şeride katılırken arkadaki kapıda hazır bekleyebilir); 1 verilince
      // çıkış kuyruğu apron'a taşıyordu.
      this.zones.push({
        id: `gate-out-${g.station}`, kind: 'gate',
        cx: g.gateX + g.sideSign * 0.6, cy: g.gateOutY,
        w: 3.6, d: 4.6, capacity: 2,
      })
    }
    // 3) POMPA/ŞARJ YAKLAŞMA BÖLGELERİ.
    // ÖNCE DENENEN VE GERİ ALINAN: apron'un tamamı için TEK kapasite-2 bölge. Ölçüm
    // (aynı tohum, çarpışma AÇIK): T1 servis 268 → 154, T2 384 → 238. Neden olmadı:
    // SimCity klonunda node'lar KÜÇÜK ve ÇOK; apron'u tek bölge yapmak tüm istasyon içi
    // trafiği 2 araca sınırlar — akışı düzenlemek yerine boğar.
    // DOĞRU UYARLAMA (bu blok): her ünitenin ÖNÜNDEKİ dar koridor ayrı bölge, kapasite 1.
    // Araç yalnız GİDECEĞİ ünitenin koridorunu rezerve eder (kind='unit' filtresi), diğer
    // şeritler serbest kalır. Kazanımı: bir üniteden AYRILAN araçla oraya GÖNDERİLEN araç
    // (sendToSlot pompa boşalır boşalmaz tetikleniyor) aynı dar koridora birlikte girmez.
    // Kapı bölgeleri ÖNCE eklenir: zoneAt ilk eşleşeni döndürür, çakışmada kapı kazanır.
    for (const g of geoms) {
      const units = [...(g.units ?? [])].sort((a, b) => a.y - b.y)
      const laneX = g.gateX + g.sideSign * APRON_LANE_OFF
      for (let i = 0; i < units.length; i++) {
        const u = units[i]
        // DERİNLİK komşu üniteye taşmasın: oyuncu üniteleri sık dizebiliyor (yük testinde
        // 1.5 birim aralık). Üst üste binen bölgeler zoneAt'te birbirini gölgeler ve
        // doluluk defterini tutarsızlaştırır.
        const gapPrev = i > 0 ? u.y - units[i - 1].y : 99
        const gapNext = i < units.length - 1 ? units[i + 1].y - u.y : 99
        const d = Math.max(1.1, Math.min(2.4, Math.min(gapPrev, gapNext) - 0.15))
        // kapı ağzına denk gelen üniteyi ATLA — o alanı zaten kapı bölgesi yönetiyor
        // (kapı bölgesi derinliği 4.6 → yarısı 2.3).
        if (Math.abs(u.y - g.gateInY) < 2.3 + d / 2) continue
        if (Math.abs(u.y - g.gateOutY) < 2.3 + d / 2) continue
        // Koridor: seyir şeridinden ünitenin servis noktasına. Pay 1.6 → araç gövdesini
        // kapsar ama bekleme kuyruğu (kapı+0.8) ve çıkış koridoru (kapı+0.45) DIŞARIDA
        // kalır; onları kapsasaydı bekleyen araç ünite koridorunu ömür boyu tutardı.
        this.zones.push({
          id: `unit-${g.station}-${u.id}`, kind: 'unit',
          cx: (laneX + u.x) / 2, cy: u.y,
          w: Math.abs(laneX - u.x) + 1.6, d, capacity: 1,
        })
      }
    }
    // artık var olmayan bölgelerin defterini temizle (istasyon kapandı/kapı taşındı)
    const live = new Set(this.zones.map(z => z.id))
    for (const id of [...this.occ.keys()]) if (!live.has(id)) this.occ.delete(id)
    for (const id of [...this.waitQ.keys()]) if (!live.has(id)) this.waitQ.delete(id)
    for (const id of [...this.pending.keys()]) if (!live.has(id)) this.pending.delete(id)
  }

  private inside(z: Zone, x: number, y: number, pad = 0): boolean {
    return Math.abs(x - z.cx) <= z.w / 2 + pad && Math.abs(y - z.cy) <= z.d / 2 + pad
  }

  /**
   * Verilen noktadaki bölge (varsa). pad ile "yaklaşma" alanı genişletilebilir.
   * `mineUnit`: ünite bölgeleri için filtre — null ise hiçbir ünite bölgesi görünmez
   * (araç oradan yalnızca GEÇİYOR), '*' ise hepsi görünür (araç o koridorda duruyor),
   * bir kimlik verilirse yalnız o ünite görünür. Bu filtre olmasaydı koridorlar zincir
   * kurar, ters yönde ilerleyen iki araç karşılıklı kilitlenirdi.
   */
  zoneAt(x: number, y: number, pad = 0, mineUnit: string | null = null): Zone | null {
    for (const z of this.zones) {
      if (z.kind === 'unit' && mineUnit !== '*' && z.id !== mineUnit) continue
      if (this.inside(z, x, y, pad)) return z
    }
    return null
  }

  /** Araç bu bölgeyi tutuyor mu */
  holds(zoneId: string, car: unknown): boolean {
    return this.occ.get(zoneId)?.has(car) ?? false
  }

  /**
   * Bölgeye girme izni: kapasite varsa VE FIFO sırasında öndeyse verilir.
   * Zaten tutuyorsa true (yeniden istemek serbest — her karede çağrılabilir).
   */
  /** Araç bölgenin İÇİNDEYSE token'ı koşulsuz ver (defter tutarlılığı; deadlock üretmez).
   *  Tahkim GİRİŞTE yapılır — içeride tutmaya çalışmak kilitlenme demektir. */
  forceAcquire(zoneId: string, car: unknown) {
    let set = this.occ.get(zoneId)
    if (!set) { set = new Set(); this.occ.set(zoneId, set) }
    set.add(car)
    this.pending.get(zoneId)?.delete(car) // içeride: "bekleyen rezervasyon" değil
    const q = this.waitQ.get(zoneId)
    if (q) { const i = q.indexOf(car); if (i >= 0) q.splice(i, 1) }
  }

  tryAcquire(zoneId: string, car: unknown): boolean {
    const z = this.zones.find(x => x.id === zoneId)
    if (!z) return true // bölge yok (ör. istasyon kapalı) → serbest geç
    let set = this.occ.get(zoneId)
    if (!set) { set = new Set(); this.occ.set(zoneId, set) }
    if (set.has(car)) return true
    let q = this.waitQ.get(zoneId)
    if (!q) { q = []; this.waitQ.set(zoneId, q) }
    if (set.size >= z.capacity) {
      if (!q.includes(car)) q.push(car) // FIFO sırasına gir
      this.stats.denied++
      return false
    }
    // kapasite var: sırada BENDEN ÖNCE bekleyen varsa ona yol ver (açlık önleme)
    const idx = q.indexOf(car)
    if (q.length > 0 && idx !== 0) {
      if (idx < 0) q.push(car)
      this.stats.denied++
      return false
    }
    if (idx === 0) q.shift()
    set.add(car)
    // yeni rezervasyon: araç henüz bölge DIŞINDA — sweep bunu TTL boyunca korur
    let pend = this.pending.get(zoneId)
    if (!pend) { pend = new Map(); this.pending.set(zoneId, pend) }
    if (!pend.has(car)) pend.set(car, 0)
    this.stats.granted++
    return true
  }

  /** Aracın tuttuğu TÜM bölgeleri ve sıra kayıtlarını bırak (çıkış/silinme/kurtarma). */
  release(car: unknown) {
    for (const set of this.occ.values()) set.delete(car)
    for (const pend of this.pending.values()) pend.delete(car)
    for (const q of this.waitQ.values()) {
      const i = q.indexOf(car)
      if (i >= 0) q.splice(i, 1)
    }
  }

  /** Yalnız belirli bölgeyi bırak (araç bölgeden çıktı). */
  releaseZone(zoneId: string, car: unknown) {
    this.occ.get(zoneId)?.delete(car)
    this.pending.get(zoneId)?.delete(car)
    const q = this.waitQ.get(zoneId)
    if (q) { const i = q.indexOf(car); if (i >= 0) q.splice(i, 1) }
  }

  /**
   * Her karede çağrılır: rezervasyonu olan ama artık bölge içinde OLMAYAN araçların
   * token'ını bırakır (bölgeyi geçti → sıradaki girebilir). `pos` araç konumunu verir.
   */
  sweep(cars: Iterable<unknown>, pos: (car: unknown) => { x: number; y: number }, dt = 0) {
    const alive = new Set(cars)
    for (const [zoneId, set] of this.occ) {
      const z = this.zones.find(x => x.id === zoneId)
      let pend = this.pending.get(zoneId)
      for (const car of [...set]) {
        if (!alive.has(car) || !z) { set.delete(car); pend?.delete(car); continue }
        const p = pos(car)
        if (this.inside(z, p.x, p.y, 0.5)) {
          // araç bölgeye GİRDİ: artık bekleyen rezervasyon değil, gerçek işgalci
          pend?.delete(car)
          continue
        }
        // Bölge DIŞINDA. İki hal ayrılır — eskiden ayrılmıyordu ve KUSUR buydu:
        //  a) token'ı olup henüz VARMAMIŞ araç: rezervasyonu KORUNUR. (Eski kod bunu her
        //     karede siliyordu; araç yeniden istemek zorunda kalıp FIFO'nun SONUNA düşüyordu.
        //     Yoğunlukta bu açlık demekti: yük testinde 787 verildi / 4550 reddedildi ve
        //     grafik açıkken buharlaşma grafiksizden KÖTÜ çıkıyordu.)
        //  b) girip ÇIKMIŞ araç: bölgeyi geçti, token bırakılır (sıradaki girsin).
        if (!pend) { pend = new Map(); this.pending.set(zoneId, pend) }
        const age = pend.get(car)
        if (age === undefined) { set.delete(car); continue } // (b) içeriden çıktı
        if (age >= RESERVE_TTL) {
          // (a) rezerve etti ama gelemedi (önü tıkalı) → yeri bırak, AMA sıradaki hakkını koru:
          // kuyruğun BAŞINA konur. Sona atılsaydı yoğunlukta hiç giremezdi (açlık).
          set.delete(car); pend.delete(car)
          let q = this.waitQ.get(zoneId)
          if (!q) { q = []; this.waitQ.set(zoneId, q) }
          if (!q.includes(car)) q.unshift(car)
          continue
        }
        pend.set(car, age + dt)
      }
      if (pend) for (const car of [...pend.keys()]) if (!set.has(car)) pend.delete(car)
    }
    for (const [zoneId, q] of this.waitQ) {
      this.waitQ.set(zoneId, q.filter(c => alive.has(c)))
    }
    for (const [zoneId, pend] of this.pending) {
      if (!this.occ.has(zoneId)) this.pending.delete(zoneId)
    }
  }

  /** doluluk raporu (debug/telemetri) */
  snapshot(): { id: string; used: number; capacity: number; queued: number }[] {
    return this.zones.map(z => ({
      id: z.id,
      used: this.occ.get(z.id)?.size ?? 0,
      capacity: z.capacity,
      queued: this.waitQ.get(z.id)?.length ?? 0,
    }))
  }
}
