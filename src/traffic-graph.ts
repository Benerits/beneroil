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
      // 3) APRON KORİDORU — DENENDİ VE GERİ ALINDI (ölçümle).
      // SimCity klonundaki node-occupancy fikrini apron'a uyarlamayı denedim: kapı ile
      // pompa hattı arasına kapasite-2'lik tek bir rezervasyon bölgesi. ÖLÇÜM (aynı
      // tohum, çarpışma AÇIK): T1 servis 268 → 154, T2 384 → 238, T3'te kalıcı sıkışan 1.
      // NEDEN OLMADI: SimCity'de her node KÜÇÜK ve ÇOK (karo başına 4-12), araç yalnız
      // bir sonraki adımı rezerve eder. Apron'u TEK büyük bölge yapınca tüm istasyon içi
      // trafik 2 araca sınırlanıyor — rezervasyon akışı düzenlemek yerine boğuyor.
      // DOĞRU UYARLAMA (yapılacak): apron'u tek bölge değil, POMPA BAŞINA küçük yaklaşma
      // bölgelerine bölmek. O zaman araç yalnız gideceği pompanın önünü rezerve eder,
      // diğer şeritler serbest kalır. Bu ciddi bir refactor; ölçüm altyapısı hazır.
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
