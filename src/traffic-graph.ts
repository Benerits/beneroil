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

/** Bölge = istasyonun darboğazı (kapı ağzı, iç koridor). Dikdörtgen + kapasite. */
export interface Zone {
  id: string
  cx: number
  cy: number
  w: number
  d: number
  capacity: number
}

export interface StationGeom {
  station: string
  gateX: number
  lane: number
  gateInY: number
  gateOutY: number
  sideSign: number // istasyonun yönü (near -1, far +1)
  dirY: number     // seyir yönü (near +1, far -1)
  wide: boolean    // geniş kapı alındı mı (kapasite 2)
}

/** Bölge sınırına bu mesafede rezervasyon denenir (araç bölgeye girmeden önce durur). */
export const RESERVE_LOOKAHEAD = 2.6

export class TrafficGraph {
  zones: Zone[] = []
  /** zoneId → içindeki/rezerve etmiş araçlar (ekleme sırası korunur) */
  private occ = new Map<string, Set<unknown>>()
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
        id: `gate-in-${g.station}`,
        cx: g.gateX + g.sideSign * 0.6, cy: g.gateInY,
        w: 3.6, d: 4.6, capacity: cap,
      })
      // 2) Kapı ÇIKIŞ ağzı: birleşme bölgesi. Kapasite 2 — çıkış ağzı apron tarafında daha
      // derin (bir araç şeride katılırken arkadaki kapıda hazır bekleyebilir); 1 verilince
      // çıkış kuyruğu apron'a taşıyordu.
      this.zones.push({
        id: `gate-out-${g.station}`,
        cx: g.gateX + g.sideSign * 0.6, cy: g.gateOutY,
        w: 3.6, d: 4.6, capacity: 2,
      })
    }
    // artık var olmayan bölgelerin defterini temizle (istasyon kapandı/kapı taşındı)
    const live = new Set(this.zones.map(z => z.id))
    for (const id of [...this.occ.keys()]) if (!live.has(id)) this.occ.delete(id)
    for (const id of [...this.waitQ.keys()]) if (!live.has(id)) this.waitQ.delete(id)
  }

  private inside(z: Zone, x: number, y: number, pad = 0): boolean {
    return Math.abs(x - z.cx) <= z.w / 2 + pad && Math.abs(y - z.cy) <= z.d / 2 + pad
  }

  /** Verilen noktadaki bölge (varsa). pad ile "yaklaşma" alanı genişletilebilir. */
  zoneAt(x: number, y: number, pad = 0): Zone | null {
    for (const z of this.zones) if (this.inside(z, x, y, pad)) return z
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
    this.stats.granted++
    return true
  }

  /** Aracın tuttuğu TÜM bölgeleri ve sıra kayıtlarını bırak (çıkış/silinme/kurtarma). */
  release(car: unknown) {
    for (const set of this.occ.values()) set.delete(car)
    for (const q of this.waitQ.values()) {
      const i = q.indexOf(car)
      if (i >= 0) q.splice(i, 1)
    }
  }

  /** Yalnız belirli bölgeyi bırak (araç bölgeden çıktı). */
  releaseZone(zoneId: string, car: unknown) {
    this.occ.get(zoneId)?.delete(car)
    const q = this.waitQ.get(zoneId)
    if (q) { const i = q.indexOf(car); if (i >= 0) q.splice(i, 1) }
  }

  /**
   * Her karede çağrılır: rezervasyonu olan ama artık bölge içinde OLMAYAN araçların
   * token'ını bırakır (bölgeyi geçti → sıradaki girebilir). `pos` araç konumunu verir.
   */
  sweep(cars: Iterable<unknown>, pos: (car: unknown) => { x: number; y: number }) {
    const alive = new Set(cars)
    for (const [zoneId, set] of this.occ) {
      const z = this.zones.find(x => x.id === zoneId)
      for (const car of [...set]) {
        if (!alive.has(car)) { set.delete(car); continue } // araç sahneden gitti
        if (!z) { set.delete(car); continue }
        const p = pos(car)
        // çıkışta küçük bir tolerans: bölgeden tamamen ayrılınca bırak (titreme olmasın)
        if (!this.inside(z, p.x, p.y, 0.5)) set.delete(car)
      }
    }
    for (const [zoneId, q] of this.waitQ) {
      this.waitQ.set(zoneId, q.filter(c => alive.has(c)))
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
