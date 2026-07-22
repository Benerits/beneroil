import { t } from './i18n'
export type FuelType = 'benzin' | 'dizel' | 'lpg'

export const FUELS: FuelType[] = ['benzin', 'dizel', 'lpg']
export const FUEL_PRICE: Record<FuelType, number> = { benzin: 10, dizel: 9, lpg: 6 }
export const FUEL_LABEL: Record<FuelType, string> = { benzin: t('Benzin'), dizel: t('Dizel'), lpg: 'LPG' }
export const FUEL_COST: Record<FuelType, number> = { benzin: 6.5, dizel: 6, lpg: 4 }
/** her yeni hesabın açılış bakiyesi */
export const START_MONEY = 5000
/** satış fiyatı oyuncuya ait: [min, max] sınırları (alış sabit) */
export function priceBounds(f: FuelType): [number, number] {
  return [Math.ceil(FUEL_COST[f]), Math.round(FUEL_COST[f] * 2.2)]
}
export const ORDER_ETA = 25 // saniye
// Banka/kredi: aylık %3 faiz (1 taksit = 1 oyun günü), 12 taksit; teminat = varlık değerinin %50'si
export const LOAN_RATE = 0.03
export const ADVANCE_RATE = 0.05 // teminatsız avans: daha yüksek faiz (risk primi)
export const LOAN_TERMS = 12
export const PARTNER_SHARE = 0.25 // teminatsız borç ödenmezse banka günlük kârın %25'ine ortak olur
export type Loan = { active: boolean; principal: number; monthly: number; remaining: number; overdue: number; collateral: string[]; rate: number }
export type Partner = { active: boolean; remaining: number; share: number }
export const FILL_RATE = 7 // L/sn
export const SPILL_PENALTY_PER_L = 3
export const WRONG_FUEL_PENALTY = 300

export const TANK_CAPACITY = [800, 1500, 3000, 5000]
export const MAX_PUMPS = 8
export const MAX_EV = 8
export const BATTERY_CAP = [0, 100, 250, 600] // kWh
export const EV_PRICE_PER_KWH = 8
export const GRID_COST_PER_KWH = 3.5 // şebekeden çekilen her kWh faturalanır
export const DIESEL_GEN_FUEL_PER_S = 0.25 // jeneratör çalışırken tanktaki mazot tüketimi (L/sn)

const PUMP_COSTS = [0, 5000, 8000, 12000, 16000, 21000, 26000, 32000]
const SIGN_COSTS = [1500, 4000, 9000]
export const WIDEGATE_COST = 6000
/** pompacı: pompa başına bir kerelik işe alma ücreti. Satışın TAMAMI kasaya girer;
 *  pompacının tek "maliyeti" işe alma + oyuncunun bahşişten feragat etmesidir (manuel
 *  servis hâlâ bahşişle daha kârlı, ama pompacı yetişemediğin pompayı net kâra çevirir). */
export const POMPACI_HIRE = 800
export const EV_ATTENDANT_HIRE = 1000 // elektrikli şarjcı (pompacı muadili) işe alma bedeli
export const POMPACI_WAGE = 120       // pompacı GÜNLÜK yovmiyesi (her oyun günü kasadan)
export const EV_ATTENDANT_WAGE = 150  // şarjcı günlük yovmiyesi
const TANK_COSTS = [3000, 7000, 15000]
export const MAX_TANKS_PER_FUEL = 4
export const TANK_ADD_COSTS = [0, 6000, 12000, 20000] // index = mevcut adet → 2., 3., 4. tankın maliyeti
const MARKET_COSTS = [7000, 12000, 20000] // 3 seviye: kur → Sv.2 → Sv.3 (yerinde, aynı footprint)
const TOILET_COSTS = [2500, 5000]
const LAND_COST = 6000
const GRID_COSTS = [8000, 15000]
const BATTERY_COSTS = [5000, 9000, 16000]
const EV_COSTS = [6000, 10000, 14000, 18000, 22000, 27000, 32000, 38000]
const SOLAR_COST = 9000
const DIESELGEN_COST = 4000
const SMR_COST = 40000
// Arsa haritası: sütun 0 = istasyon kolonu, 1-2 batıya doğru; 3-5 yolun KARŞI tarafı (doğu).
// Satır 0 = güney, 1 = orta, 2 = kuzey. Toplam 2 blok × 3×3.
export const PARCEL_COLS: [number, number][] = [
  [-6.5, 5], [-18, -6.5], [-29.5, -18],
  [10.9, 22.4], [22.4, 33.9], [33.9, 45.4],
]
export const PARCEL_ROWS: [number, number][] = [[-24, -10], [-10, 10], [10, 24]]
export const PAVE_COST = 2500
export function parcelKey(c: number, r: number) { return `${c},${r}` }
/**
 * Dinamik arsa fiyatı: istasyon geliştikçe emlak değerlenir.
 * Az iş yapan çıplak istasyonda taban fiyat, dolu istasyonda katlanır.
 */
export function parcelCost(c: number, _r: number, s?: GameState) {
  const base = c === 0 ? 6000 : (c === 1 || c === 3) ? 9000 : 14000
  if (!s) return base
  const mult = Math.min(1 + 0.12 * s.developmentScore(), 2) // gelişmişlik zammı en fazla 2 katına çıkarır
  return Math.round(base * mult / 100) * 100
}
/** komşuluk: aynı blokta yan yana/alt alta; 0↔3 yol karşısı sayılır */
export function parcelsAdjacent(c1: number, r1: number, c2: number, r2: number): boolean {
  if (r1 === r2) {
    const sameBlock = (c1 < 3) === (c2 < 3)
    if (sameBlock && Math.abs(c1 - c2) === 1) return true
    if ((c1 === 0 && c2 === 3) || (c1 === 3 && c2 === 0)) return true // yolun karşısı
  }
  if (c1 === c2 && Math.abs(r1 - r2) === 1) return true
  return false
}

const WASH_COST = 8000
const OIL_COST = 12000
const COFFEE_COST = 7000
const RESTAURANT_COST = 15000
const TRUCKPARK_COST = 12000
const AIRWATER_COST = 1500
const SELFWASH_COST = 6000
const PARKING_COST = 1200
export const URANIUM_COST = 2500
export const URANIUM_ETA = 20 // saniye
const URANIUM_DRAIN_PER_S = 100 / 300 // tam yük ~5 dakika sürer

export class GameState {
  money = START_MONEY
  reputation = 3.0
  /** tabeladaki istasyon adı — hesaba bağlı, kayıtla gezer */
  stationName = t('BENELOIL')
  /** oyuncunun belirlediği satış fiyatları (alış FUEL_COST'ta sabit) */
  prices: Record<FuelType, number> = { ...FUEL_PRICE }

  /** yakıt türü başına ayrı yer altı tankı */
  tanks: Record<FuelType, number> = { benzin: 250, dizel: 150, lpg: 100 }
  /** yakıt türü başına ayrı sipariş/tanker takibi */
  loan: Loan = { active: false, principal: 0, monthly: 0, remaining: 0, overdue: 0, collateral: [], rate: LOAN_RATE }
  partner: Partner = { active: false, remaining: 0, share: PARTNER_SHARE } // banka ortaklığı (teminatsız temerrüt)
  wagesPaid = 0 // muhasebe: toplam ödenen yovmiye
  fuelSpent = 0 // muhasebe: toplam yakıt alım gideri
  /** muhasebe: son yakıt alımları (gün/yakıt/litre/tutar) — ofis geçmişi, son 40 kayıt */
  fuelLog: { day: number; f: FuelType; liters: number; cost: number }[] = []
  /** muhasebe: günlük yovmiye ödeme geçmişi (gün/tutar) — son 40 kayıt */
  wageLog: { day: number; amount: number }[] = []
  /** muhasebe: günlük satış cirosu (gün/ciro) — dönemsel satış/kâr için, son ~370 kayıt */
  salesLog: { day: number; rev: number }[] = []
  /** o günün başındaki toplam ciro (günlük satış = stats.revenue - dayStartRevenue) */
  dayStartRevenue = 0
  noAds = false // "Reklamları Kaldır" satın alındı mı (IAP) — interstitial gösterilmez
  orders: Record<FuelType, { pending: boolean; eta: number; arrived: boolean; delivering: boolean; amount: number }> = {
    benzin: { pending: false, eta: 0, arrived: false, delivering: false, amount: 0 },
    dizel: { pending: false, eta: 0, arrived: false, delivering: false, amount: 0 },
    lpg: { pending: false, eta: 0, arrived: false, delivering: false, amount: 0 },
  }

  pumps = 1
  signLevel = 0
  tankLevel = 0
  /** yakıt başına fiziksel tank adedi (kapasite çarpanı) — additive, eski kayıtta default 1 */
  tankCounts: Record<FuelType, number> = { benzin: 1, dizel: 1, lpg: 1 }
  marketLevel = 0
  toiletLevel = 0

  // elektrik
  gridLevel = 0
  evChargers = 0
  batteryLevel = 0
  /** oyuncunun belirlediği elektrik satış fiyatı (₺/kWh) */
  elecPrice = EV_PRICE_PER_KWH
  /** tuvalet kullanım ücreti (0 = ücretsiz) */
  toiletFee = 0
  /** otomatik şarj açık olan üniteler */
  autoChargers = new Set<number>()
  /** pompacı çalıştırılan pompalar: yanaşan araç doğru yakıtla otomatik dolar */
  autoPumps = new Set<number>()
  /** geniş giriş/çıkış: araçlar kapılardan ikili sıra girip çıkar */
  wideGates = false
  /** tesis bazında bugünkü ciro (gün dönümünde sıfırlanır) */
  facDaily: Record<string, number> = {}
  /** tesis bazında ömür boyu ciro (istatistik için, sıfırlanmaz) */
  facTotal: Record<string, number> = {}
  /** ömür boyu istatistikler */
  stats = {
    served: 0, lost: 0, kwh: 0, revenue: 0,
    liters: { benzin: 0, dizel: 0, lpg: 0 } as Record<FuelType, number>,
  }
  battery = 0 // kWh
  solarCount = 0
  get hasSolar() { return this.solarCount > 0 }
  hasDiesel = false
  hasSMR = false
  hasWash = false
  hasOil = false
  hasCoffee = false
  hasRestaurant = false
  hasTruckPark = false
  airWaterCount = 0
  selfWashCount = 0
  get hasAirWater() { return this.airWaterCount > 0 }
  get hasSelfWash() { return this.selfWashCount > 0 }
  parkingCount = 0
  get hasParking() { return this.parkingCount > 0 }
  /** istasyon kapalı: yeni müşteri girmez, itibar etkilenmez (bakım molası) */
  closed = false
  /** jeton mantığı: self servis tesislerin üstünde biriken para (tıkla-topla) */
  pendingCash: Record<string, number> = {}
  private truckTimer = 45
  private selfWashTimer = 30

  // arsa sistemi: 3×3 = 9 parsel; istasyon (0,1) baştan sahipli ve betonlu
  ownedParcels = new Set<string>([parcelKey(0, 1)])
  pavedParcels = new Set<string>([parcelKey(0, 1)])

  // ilerleme / bağlılık
  day = 1
  dayStartMoney = START_MONEY
  achievements = new Set<string>()
  lastLoginDate = ''
  loginStreak = 0
  dailyDate = ''
  dailyServed = 0
  dailyDone = false
  /** süreli fırsat: cheapFuel = yakıt maliyeti %50, rush = müşteri patlaması */
  promo: { type: 'cheapFuel' | 'rush'; until: number } | null = null
  private promoTimer = 150

  owns(c: number, r: number) { return this.ownedParcels.has(parcelKey(c, r)) }
  isPaved(c: number, r: number) { return this.pavedParcels.has(parcelKey(c, r)) }
  /** eski kilitler bu getter'ları kullanır: sahip + zemin döşeli sayılır */
  get landSouth() { return this.pavedParcels.has(parcelKey(0, 0)) }
  get landNorth() { return this.pavedParcels.has(parcelKey(0, 2)) }
  get landWest() { return this.pavedParcels.has(parcelKey(1, 1)) }
  get anyLand() { return this.ownedParcels.size > 1 }

  /** istasyonun ne kadar geliştiği (arsa fiyatlarını şişirir) */
  developmentScore(): number {
    return (this.pumps - 1) + this.evChargers + this.signLevel + this.tankLevel
      + this.marketLevel + this.toiletLevel + this.gridLevel + this.batteryLevel
      + [this.hasSolar, this.hasDiesel, this.hasSMR, this.hasWash, this.hasOil, this.hasCoffee,
         this.hasRestaurant, this.hasTruckPark, this.hasAirWater, this.hasSelfWash, this.hasParking]
        .filter(Boolean).length
  }

  parcelAdjacentToOwned(c: number, r: number): boolean {
    for (const key of this.ownedParcels) {
      const [oc, or] = key.split(',').map(Number)
      if (parcelsAdjacent(c, r, oc, or)) return true
    }
    return false
  }

  // bakım / arıza
  solarDirt = 0 // 0..1
  smrWear = 0 // 0..1
  /** bakım özeni: her bakım/tamir artırır, zamanla azalır; yüksekken arıza olasılığı düşer */
  maintCare = 0
  uranium = 0 // % 0..100
  uraniumPending = false
  uraniumEta = 0
  brokenPumps = new Set<number>()
  brokenChargers = new Set<number>()
  /** tick sırasında biriken olay mesajları (main toast'a çevirir) */
  events: string[] = []
  exploded = false

  get tankCapacity() { return TANK_CAPACITY[this.tankLevel] }
  /** yakıt başına kapasite = seviye kapasitesi (CANLI/main ile birebir; per-fuel adet devre dışı — save uyumu) */
  fuelCapacity(f: FuelType): number { return TANK_CAPACITY[this.tankLevel] * this.tankCounts[f] }
  get batteryCapacity() { return BATTERY_CAP[this.batteryLevel] }

  /** elektrik fiyatının EV müşteri talebine etkisi (1.0 = nötr) */
  evPriceFactor() {
    const r = (this.elecPrice - EV_PRICE_PER_KWH) / EV_PRICE_PER_KWH
    return Math.min(1.25, Math.max(0.5, 1.05 - 0.55 * r))
  }

  /** jeneratör şu an gürültü yapıyor mu */
  dieselRunning() {
    return this.hasDiesel && this.tanks.dizel > 0 && this.batteryLevel > 0
      && this.battery < this.batteryCapacity - 0.01
  }

  /** şebekeden gelen kWh/sn (faturalı taban) */
  gridRate() {
    return this.gridLevel >= 1 ? 2 * (this.gridLevel >= 2 ? 1.3 : 1) : 0
  }
  /** BEDAVA üretim kWh/sn: güneş + reaktör + jeneratör (altyapı Sv.2 bonusu dahil) */
  freeRate() {
    let r = 0
    if (this.solarCount > 0) r += 3 * this.solarCount * (1 - 0.7 * this.solarDirt)
    if (this.dieselRunning()) r += 7
    if (this.hasSMR && this.uranium > 0) r += 15
    if (this.gridLevel >= 2) r *= 1.3 // altyapı bonusu bedava üretimi de güçlendirir
    return r
  }
  /** anlık toplam üretim gücü kWh/sn (bedava + şebeke) */
  genRate() { return this.freeRate() + this.gridRate() }

  tick(dt: number) {
    for (const f of FUELS) {
      const o = this.orders[f]
      if (o.pending) {
        o.eta -= dt
        if (o.eta <= 0) {
          o.pending = false
          o.arrived = true
        }
      }
    }
    // batarya şarjı
    if (this.batteryLevel > 0 && this.battery < this.batteryCapacity) {
      const before = this.battery
      const free = this.freeRate(), grid = this.gridRate(), total = free + grid
      this.battery = Math.min(this.batteryCapacity, this.battery + total * dt)
      const added = this.battery - before
      // ŞEBEKE yalnız BEDAVA üretimin (solar/reaktör/jeneratör) KARŞILAMADIĞI payı faturalar.
      // Solar üretimi şebeke tabanını (2 kWh/sn) karşılıyorsa fatura 0 → "solar var santral çekmiyor".
      if (added > 0 && total > 0) {
        const billedRate = Math.max(0, grid - free)
        if (billedRate > 0) this.money -= added * (billedRate / total) * GRID_COST_PER_KWH
      }
      if (this.dieselRunning()) {
        this.tanks.dizel = Math.max(0, this.tanks.dizel - DIESEL_GEN_FUEL_PER_S * dt)
      }
    }
    // kirlenme / yıpranma
    if (this.hasSolar && this.solarDirt < 1) {
      const before = this.solarDirt
      this.solarDirt = Math.min(1, this.solarDirt + 0.0045 * dt)
      if (before < 0.6 && this.solarDirt >= 0.6) this.events.push(t('🧽 Güneş panelleri iyice kirlendi, üretim düşüyor!'))
    }
    // uranyum: sipariş takibi + üretim sırasında tükenme
    if (this.uraniumPending) {
      this.uraniumEta -= dt
      if (this.uraniumEta <= 0) {
        this.uraniumPending = false
        this.uranium = 100
        this.events.push(t('☢️ Uranyum teslim edildi — reaktör tam güçte!'))
      }
    }
    if (this.hasSMR && this.uranium > 0 && this.batteryLevel > 0 && this.battery < this.batteryCapacity) {
      const before = this.uranium
      this.uranium = Math.max(0, this.uranium - URANIUM_DRAIN_PER_S * dt)
      if (before > 20 && this.uranium <= 20) this.events.push(t('☢️ Uranyum azalıyor! Yeni çubuk sipariş et.'))
      if (before > 0 && this.uranium === 0) this.events.push(t('🚨 Uranyum bitti — reaktör üretimi DURDU!'))
    }
    if (this.hasSMR) {
      const before = this.smrWear
      this.smrWear = Math.min(1, this.smrWear + 0.004 * dt)
      if (before < 0.5 && this.smrWear >= 0.5) this.events.push(t('☢️ Reaktör bakım istiyor!'))
      if (before < 0.75 && this.smrWear >= 0.75) this.events.push(t('🚨 REAKTÖR KRİTİK! Hemen bakım yap yoksa patlayacak!'))
      if (this.smrWear > 0.7 && Math.random() < dt * 0.012 * (this.smrWear - 0.7) / 0.3) {
        this.exploded = true
      }
    }
    // süreli fırsatlar
    if (this.promo && Date.now() > this.promo.until) {
      this.events.push(this.promo.type === 'cheapFuel' ? t('Yakıt indirimi sona erdi.') : t('Müşteri patlaması sona erdi.'))
      this.promo = null
    }
    if (!this.promo) {
      this.promoTimer -= dt
      if (this.promoTimer <= 0) {
        this.promoTimer = 240 + Math.random() * 120
        const type = Math.random() < 0.5 ? 'cheapFuel' as const : 'rush' as const
        this.promo = { type, until: Date.now() + 60_000 }
        this.events.push(type === 'cheapFuel'
          ? t('FIRSAT: 60 saniye boyunca yakıt siparişi YARI FİYAT!')
          : t('FIRSAT: 60 saniye müşteri patlaması — pompalara koş!'))
      }
    }

    // pasif gelirler
    if (this.hasTruckPark) {
      this.truckTimer -= dt
      if (this.truckTimer <= 0) {
        this.truckTimer = 35 + Math.random() * 20
        const m = 90 + Math.floor(Math.random() * 70)
        this.addPending('truckpark', m, t('Tır parkı'))
      }
    }
    if (this.hasSelfWash) {
      this.selfWashTimer -= dt
      if (this.selfWashTimer <= 0) {
        this.selfWashTimer = 25 + Math.random() * 20
        const m = (30 + Math.floor(Math.random() * 30)) * this.selfWashCount
        this.addPending('selfwash', m, t('Self yıkama'))
      }
    }

    // bakım özeni zamanla azalır
    this.maintCare = Math.max(0, this.maintCare - 0.0004 * dt)

    // rastgele arızalar — seyrek; para azken (Murphy) artar, bakım özeni yüksekken düşer
    const stress = this.graceActive ? 1 : this.money < 1000 ? 3 : this.money < 3000 ? 2 : 1
    const care = 1 - 0.65 * this.maintCare
    const brokenCount = this.brokenPumps.size + this.brokenChargers.size
    if (brokenCount < 2) {
      for (let i = 0; i < this.pumps; i++) {
        if (!this.brokenPumps.has(i) && Math.random() < (dt / 3600) * stress * care) {
          this.brokenPumps.add(i)
          this.events.push(t('🔧 Pompa #{0} arıza yaptı! Üstüne tıklayıp karttan tamir et.', i + 1))
          break
        }
      }
      for (let i = 0; i < this.evChargers; i++) {
        if (!this.brokenChargers.has(i) && Math.random() < (dt / 4200) * stress * care) {
          this.brokenChargers.add(i)
          this.events.push(t('🔌 Şarj ünitesi #{0} arızalandı!', i + 1))
          break
        }
      }
    }
  }

  /** yoldan geçen bir aracın istasyona girme olasılığı */
  /** kâr marjı müşteri iştahını belirler: ucuzsan akın, kazıkçıysan kaçış */
  priceDemandFactor(): number {
    let sum = 0
    for (const f of FUELS) {
      const baseMargin = FUEL_PRICE[f] - FUEL_COST[f]
      sum += (this.prices[f] - FUEL_COST[f]) / baseMargin
    }
    const factor = sum / FUELS.length // 1 = varsayılan marj
    return Math.min(1.3, Math.max(0.5, 1.3 - 0.3 * factor))
  }

  entryChance() {
    if (this.closed) return 0
    const boost = (this.promo?.type === 'rush' ? 1.5 : 1) * this.priceDemandFactor()
    const c = boost * (0.32 + 0.1 * this.signLevel + 0.05 * (this.reputation - 3))
      + 0.04 * this.marketLevel + 0.02 * this.toiletLevel + 0.02 * this.evChargers
      + (this.hasWash ? 0.03 : 0) + (this.hasOil ? 0.03 : 0)
      + (this.hasCoffee ? 0.02 : 0) + (this.hasRestaurant ? 0.03 : 0)
      + (this.hasTruckPark ? 0.02 : 0) + 0.02 * Math.min(this.airWaterCount, 3)
      + 0.02 * Math.min(this.selfWashCount, 3)
    return Math.min(0.95, Math.max(0.08, c))
  }

  /** Sipariş miktar çarpanı (× 800L parti). 1 = minimum (en düşük tank hacmi); + ile full'e kadar step. */
  orderQty: Record<FuelType, number> = { benzin: 1, dizel: 1, lpg: 1 }
  orderMaxQty(f: FuelType) { return Math.max(1, Math.ceil((this.fuelCapacity(f) - this.tanks[f]) / TANK_CAPACITY[0])) }
  adjustOrderQty(f: FuelType, d: number) { this.orderQty[f] = Math.min(this.orderMaxQty(f), Math.max(1, this.orderQty[f] + d)) }
  /** Sipariş miktarı = çarpan × 800L, kalan boşlukla capli. Min 800L (level-1 hacmi), full'e kadar step'lenebilir. */
  orderNeed(f: FuelType) { return Math.floor(Math.min(this.orderQty[f] * TANK_CAPACITY[0], this.fuelCapacity(f) - this.tanks[f])) }
  orderCost(f: FuelType) {
    const disc = this.promo?.type === 'cheapFuel' ? 0.5 : 1
    return Math.ceil(this.orderNeed(f) * FUEL_COST[f] * disc)
  }

  canOrder(f: FuelType) {
    const o = this.orders[f]
    return !o.pending && !o.arrived && !o.delivering && this.orderNeed(f) >= 100 && this.money >= this.orderCost(f)
  }

  placeOrder(f: FuelType) {
    if (!this.canOrder(f)) return false
    const cost = this.orderCost(f)
    this.money -= cost
    this.fuelSpent += cost // muhasebe
    this.fuelLog.push({ day: this.day, f, liters: this.orderNeed(f), cost })
    if (this.fuelLog.length > 40) this.fuelLog.shift()
    this.orders[f].pending = true
    this.orders[f].eta = ORDER_ETA
    this.orders[f].amount = this.orderNeed(f) // teslimatta bu kadar eklenecek (parti miktarı)
    return true
  }

  deliverFuel(f: FuelType) {
    // sipariş edilen partiyi ekle (tam doldurma değil); kapasiteyi aşma
    const add = this.orders[f].amount || this.orderNeed(f)
    this.tanks[f] = Math.min(this.fuelCapacity(f), this.tanks[f] + add)
    this.orders[f].amount = 0
  }

  // ---- Banka / kredi ----
  /** teminat değeri = varlığın %50 iade (market) değeri */
  collateralValue(id: string): number { return sellInfo(this, id)?.refund ?? 0 }
  /** teminat gösterilebilir varlıklar (demirbaş=pompa/tank hariç; her tesis türü tek kalem) */
  eligibleCollateral(): { id: string; label: string; value: number }[] {
    const c: [string, string][] = [
      ['market', t('Market')], ['toilet', t('Tuvalet')], ['battery', t('Batarya Deposu')],
      ['wash', t('Oto Yıkama')], ['oil', t('Yağ Değişimi')], ['coffee', t('Kahveci')],
      ['restaurant', t('Restoran')], ['truckpark', t('Tır Parkı')], ['dieselgen', t('Jeneratör')], ['smr', t('Reaktör')],
    ]
    if (this.evChargers > 0) c.push([`charger#${this.evChargers - 1}`, t('DC Şarj')])
    if (this.solarCount > 0) c.push([`solar#${this.solarCount - 1}`, t('Güneş Santrali')])
    if (this.parkingCount > 0) c.push([`parking#${this.parkingCount - 1}`, t('Otopark')])
    if (this.selfWashCount > 0) c.push([`selfwash#${this.selfWashCount - 1}`, t('Self Yıkama')])
    if (this.airWaterCount > 0) c.push([`airwater#${this.airWaterCount - 1}`, t('Hava-Su Ünitesi')])
    const out: { id: string; label: string; value: number }[] = []
    for (const [id, label] of c) { const v = this.collateralValue(id); if (v > 0) out.push({ id, label, value: v }) }
    return out
  }
  /** günlük toplam yovmiye (pompacı + şarjcı) — her oyun günü kasadan çekilir */
  dailyWages(): number { return this.autoPumps.size * POMPACI_WAGE + this.autoChargers.size * EV_ATTENDANT_WAGE }
  loanMonthly(principal: number, rate = LOAN_RATE): number {
    const n = LOAN_TERMS
    return Math.ceil(principal * rate / (1 - Math.pow(1 + rate, -n)))
  }
  /** teminatsız avans limiti — herkes çekebilir; itibar + oyun günüyle küçük ölçüde büyür */
  advanceLimit(): number {
    return Math.min(6000, Math.round((800 + this.reputation * 500 + Math.min(this.day, 25) * 120) / 100) * 100)
  }
  takeLoan(principal: number, collateral: string[], rate = LOAN_RATE): boolean {
    if (this.loan.active || this.partner.active || principal <= 0) return false
    const p = Math.round(principal)
    this.loan = { active: true, principal: p, monthly: this.loanMonthly(p, rate), remaining: LOAN_TERMS, overdue: 0, collateral: [...collateral], rate }
    this.money += p
    return true
  }
  /** teminatsız avans (asset gerekmez, küçük, yüksek faiz) */
  takeAdvance(principal: number): boolean {
    return this.takeLoan(Math.min(principal, this.advanceLimit()), [], ADVANCE_RATE)
  }
  loanPayoff(): number { return this.loan.active ? this.loan.monthly * this.loan.remaining : 0 }
  repayLoanFull(): boolean {
    if (!this.loan.active || this.money < this.loanPayoff()) return false
    this.money -= this.loanPayoff(); this.loan = { active: false, principal: 0, monthly: 0, remaining: 0, overdue: 0, collateral: [], rate: LOAN_RATE }
    return true
  }
  /** her oyun günü çağrılır: taksiti kasadan tahsil et; üst üste 2 gecikme + para yetmezse 'seize' (haczi/ortaklığı çağıran yapar) */
  processLoanDay(): 'done' | 'seize' | 'warn' | 'ok' | null {
    const l = this.loan
    if (!l.active) return null
    l.overdue += 1
    while (l.overdue > 0 && l.remaining > 0 && this.money >= l.monthly) {
      this.money -= l.monthly; l.remaining -= 1; l.overdue -= 1
    }
    if (l.remaining <= 0) { l.active = false; return 'done' }
    if (l.overdue >= 2) return 'seize'
    if (l.overdue === 1) return 'warn'
    return 'ok'
  }
  /** teminatsız temerrüt: banka istasyona ortak olur (kalan borç × 1.3'ü kâr payından tahsil edilir) */
  startPartnership() {
    const debt = Math.max(1, this.loan.monthly * this.loan.remaining)
    this.partner = { active: true, remaining: Math.round(debt * 1.3), share: PARTNER_SHARE }
    this.loan = { active: false, principal: 0, monthly: 0, remaining: 0, overdue: 0, collateral: [], rate: LOAN_RATE }
  }
  /** gün sonu: ortaklık aktifse günlük kârdan payı al; borç bitince ortaklık sona erer. Döner: 'ended' | 'cut' | null */
  applyPartnerCut(dayProfit: number): { kind: 'ended' | 'cut'; amount: number } | null {
    if (!this.partner.active) return null
    const cut = Math.min(this.partner.remaining, Math.max(0, Math.round(dayProfit * this.partner.share)))
    if (cut > 0) { this.money -= cut; this.partner.remaining -= cut }
    if (this.partner.remaining <= 0) { this.partner = { active: false, remaining: 0, share: PARTNER_SHARE }; return { kind: 'ended', amount: cut } }
    return { kind: 'cut', amount: cut }
  }
  /** ortaklığı peşin kapat (kalan borç payını öde) */
  buyoutPartner(): boolean {
    if (!this.partner.active || this.money < this.partner.remaining) return false
    this.money -= this.partner.remaining
    this.partner = { active: false, remaining: 0, share: PARTNER_SHARE }
    return true
  }

  /** tesis geliri: doğrudan kasaya + günlük ciroya işlenir */
  facEarn(id: string, amt: number) {
    this.money += amt
    this.facDaily[id] = (this.facDaily[id] ?? 0) + amt
    this.facTotal[id] = (this.facTotal[id] ?? 0) + amt
  }

  /** tesise para biriktir (kumbara dolarsa haber ver) */
  /** Kumbara hacmi tesisin gelişmişliğine göre büyür (getiriyle AYNI oranda):
   *  market seviyeyle, self-yıkama/hava-su/otopark adetle; tek-seviyeli tesisler
   *  gelir düzeylerine göre sabit. Böylece geliştirilen market daha çok biriktirir. */
  pendingCap(id: string): number {
    switch (id) {
      case 'market': return 600 * Math.max(1, this.marketLevel)                          // gelir ×level → cap ×level
      case 'toilet': return 500 * Math.max(1, this.toiletLevel)                          // seviyeyle büyür
      case 'selfwash': return 400 * Math.min(5, Math.max(1, this.selfWashCount))
      case 'airwater': return 250 * Math.min(6, Math.max(1, this.airWaterCount))
      case 'parking': return 300 * Math.min(6, Math.max(1, this.parkingCount))
      case 'truckpark': return 1200   // pasif yüksek kazanan
      case 'restaurant': return 1200  // ₺80-160/ziyaret
      case 'oil': return 1000         // ₺150-250/servis
      case 'wash': return 700         // ₺60-120/yıkama
      case 'coffee': return 500       // düşük getiri
      default: return 600
    }
  }

  addPending(id: string, amt: number, name: string) {
    this.facDaily[id] = (this.facDaily[id] ?? 0) + amt
    this.facTotal[id] = (this.facTotal[id] ?? 0) + amt
    const cap = this.pendingCap(id)
    const cur = this.pendingCash[id] ?? 0
    this.pendingCash[id] = Math.min(cap, cur + amt)
    if (cur < cap && this.pendingCash[id] >= cap) {
      this.events.push(t('{0} kumbarası doldu — üstüne tıklayıp topla!', name))
    }
  }

  collectPending(id: string): number {
    const amt = Math.round(this.pendingCash[id] ?? 0)
    if (amt > 0) {
      this.money += amt
      delete this.pendingCash[id]
    }
    return amt
  }

  // ---- Ofis muhasebe yardımcıları ----
  private pendingTotal(): number { return Object.values(this.pendingCash).reduce((a, v) => a + (v || 0), 0) }
  /** Aktif (toplam varlık): kasa + kumbaralar + satılabilir ekipman değeri */
  assets(): number { return this.money + this.pendingTotal() + this.eligibleCollateral().reduce((a, c) => a + c.value, 0) }
  /** Net işletme sermayesi = likit varlık (kasa+kumbara) − kısa vadeli borç (kalan kredi) */
  netWorkingCapital(): number { return this.money + this.pendingTotal() - (this.loan.active ? this.loan.remaining : 0) }
  /** son N güne ait satış cirosu */
  salesInPeriod(days: number): number { const s = this.day - days; return this.salesLog.filter(x => x.day > s).reduce((a, x) => a + x.rev, 0) }
  /** son N güne ait yakıt alım gideri */
  fuelCostInPeriod(days: number): number { const s = this.day - days; return this.fuelLog.filter(x => x.day > s).reduce((a, x) => a + x.cost, 0) }
  /** son N güne ait yovmiye gideri */
  wagesInPeriod(days: number): number { const s = this.day - days; return this.wageLog.filter(x => x.day > s).reduce((a, x) => a + x.amount, 0) }

  /** yeni oyuncu koruması: ilk 2 gün cezalar yumuşar (ilerleme HIZLANMAZ, sadece erken ölüm sarmalı kırılır) */
  get graceActive() { return this.day <= 2 }

  addRep(d: number) {
    if (this.graceActive && d < 0) d *= 0.5 // grace: itibar cezaları yarı
    const floor = this.graceActive ? 2.5 : 0 // grace: itibar 2.5 altına düşmez (trafik çökmesin)
    this.reputation = Math.max(floor, Math.min(5, this.reputation + d))
  }
}

// ---- İnşaat kataloğu ----

export interface ShopRow {
  id: string
  icon: string
  title: string
  desc: string
  /** öne çıkan sayısal değer rozeti */
  stat: string
  cost: number | null
  status: 'buy' | 'locked' | 'maxed'
  note: string
}

export function getShopItems(s: GameState): ShopRow[] {
  const rows: ShopRow[] = []
  const row = (id: string, icon: string, title: string, stat: string, desc: string,
               cost: number | null, locked: string | null) => {
    if (cost === null) rows.push({ id, icon, title, desc, stat, cost: null, status: 'maxed', note: t('MAKS') })
    else if (locked) rows.push({ id, icon, title, desc, stat, cost, status: 'locked', note: locked })
    else rows.push({ id, icon, title, desc, stat, cost, status: 'buy', note: '' })
  }
  const hasUnpaved = s.ownedParcels.size > s.pavedParcels.size

  // arsa fiyatı konuma göre değişir (yakın ucuz, uzak/karşı pahalı) → tek sayı yerine ARALIK göster
  const pcMin = parcelCost(0, 0, s), pcMax = parcelCost(2, 0, s)
  row('land', 'i-land', t('Arsa Satın Al ({0}/18)', s.ownedParcels.size),
    `₺${pcMin.toLocaleString('tr-TR')}–${pcMax.toLocaleString('tr-TR')}`,
    t('Bitişik parsele tıkla (yol karşısına da geçebilirsin). Konuma göre fiyat değişir — yakın arsalar ucuz, uzak/karşı arsalar pahalı; istasyon geliştikçe artar. Seçince o parselin gerçek fiyatı görünür.'),
    s.ownedParcels.size >= 18 ? null : pcMin, null)
  row('pave', 'i-pave', t('Zemin Betonu'), t('arsa başı'),
    t('Çimen arsana beton döşe (yapı kurmak için şart, güneş paneli hariç)'),
    PAVE_COST, hasUnpaved ? null : t('Betonsuz arsan yok'))
  row('pump', 'i-fuel', t('Pompa #{0}', Math.min(s.pumps + 1, MAX_PUMPS)), t('+1 pompa'), t('Aynı anda bir müşteri daha alırsın'),
    s.pumps >= MAX_PUMPS ? null : PUMP_COSTS[s.pumps], null)
  row('sign', 'i-sign', t('Tabela Sv.{0}', Math.min(s.signLevel + 1, 3)), t('+%10 trafik'), t('Yoldan geçenlerin uğrama şansı artar'),
    s.signLevel >= 3 ? null : SIGN_COSTS[s.signLevel], null)
  row('widegate', 'i-land', t('Geniş Giriş-Çıkış'), t('2 şerit'),
    t('Kapı ağızları genişler: araçlar ikili sıra girip çıkar, kuyruk yola taşmaz'),
    s.wideGates ? null : WIDEGATE_COST, s.pumps >= 2 ? null : t('Önce 2. pompayı al'))
  row('tank', 'i-tank', t('Yakıt Tankı'), s.tankLevel >= 3 ? `${TANK_CAPACITY[3]}L` : `${TANK_CAPACITY[s.tankLevel + 1]}L`,
    t('Depo büyür (tüm yakıtlar), daha seyrek sipariş verirsin'),
    s.tankLevel >= 3 ? null : TANK_COSTS[s.tankLevel], null)
  // Yakıt başına ek tank: SADECE kapasiteyi büyütür (×adet), görsel/footprint DEĞİŞMEZ (yer kaplamaz).
  for (const f of FUELS) {
    if (s.tankCounts[f] < MAX_TANKS_PER_FUEL)
      row(`tankadd-${f}`, 'i-tank', t('Ek {0} Tankı ({1}/{2})', FUEL_LABEL[f], s.tankCounts[f] + 1, MAX_TANKS_PER_FUEL),
        `+${TANK_CAPACITY[s.tankLevel]}L`,
        t('Yalnızca {0} deposunu {1}L büyütür — yer kaplamaz, daha seyrek sipariş.', FUEL_LABEL[f], TANK_CAPACITY[s.tankLevel]),
        TANK_ADD_COSTS[s.tankCounts[f]], null)
  }
  row('airwater', 'i-air', s.airWaterCount ? t('Hava-Su Ünitesi ({0})', s.airWaterCount) : t('Hava-Su Ünitesi'), '+₺10-20',
    t('Lastik havası ve su — ucuz ama müşteri çeker (sınırsız kurulur)'), AIRWATER_COST, null)
  row('parking', 'i-parking', s.parkingCount ? t('Otopark ({0})', s.parkingCount) : t('Otopark'), t('+4 araç'),
    t('Çizgili park alanı — müşteriler park edip tesisleri kullanır (sınırsız kurulur)'), PARKING_COST, null)

  row('market', 'i-market', s.marketLevel === 0 ? t('Market') : t('Market Sv.{0}', s.marketLevel + 1), `+₺${25 * (s.marketLevel + 1)}-${60 * (s.marketLevel + 1)}`,
    t('Müşteriler ekstra alışveriş yapar. Yerinde yükselir (aynı yer), gelir seviyeyle artar.'),
    s.marketLevel >= 3 ? null : MARKET_COSTS[s.marketLevel], null)
  row('toilet', 'i-toilet', s.toiletLevel === 0 ? t('Tuvalet') : t('Tuvalet Sv.2'), t('+moral'),
    t('Müşteri memnuniyetini ve itibarı artırır'),
    s.toiletLevel >= 2 ? null : TOILET_COSTS[s.toiletLevel], null)
  row('wash', 'i-wash', t('Oto Yıkama'), '+₺60-120', t("Müşterilerin ~%25'i araç yıkatır, ekstra gelir"),
    s.hasWash ? null : WASH_COST, null)
  row('oil', 'i-oil', t('Yağ Değişimi'), '+₺150-250', t("Müşterilerin ~%12'si yağ değiştirtir, güçlü ek gelir"),
    s.hasOil ? null : OIL_COST, null)
  row('selfwash', 'i-selfwash', s.selfWashCount ? t('Self Yıkama ({0})', s.selfWashCount) : t('Self Yıkama'), '+₺30-60/dk',
    t('Araçlar kendisi yıkar; gelir kurulum sayısıyla artar (sınırsız)'), SELFWASH_COST, null)
  row('coffee', 'i-coffee', t('Kahveci'), '+₺20-45', t('Yolcular kahve molası verir'),
    s.hasCoffee ? null : COFFEE_COST, null)
  row('restaurant', 'i-food', t('Restoran'), '+₺80-160', t('Uzun yol müşterisi yemek molası verir'),
    s.hasRestaurant ? null : RESTAURANT_COST, null)
  row('truckpark', 'i-truck', t('Tır Parkı'), '+₺90-160/dk', t('Tırcılar konaklar — düzenli pasif gelir'),
    s.hasTruckPark ? null : TRUCKPARK_COST, null)

  // elektrik zinciri (teknoloji sırası korunur, arsa şartı yok)
  row('grid', 'i-bolt', t('Elektrik Altyapısı Sv.{0}', Math.min(s.gridLevel + 1, 2)),
    s.gridLevel === 0 ? t('temel') : t('+%30 üretim'),
    s.gridLevel === 0 ? t('Şarj ve enerji yapılarının önünü açar') : t('Tüm üretimi güçlendirir, yeni yapılar açılır'),
    s.gridLevel >= 2 ? null : GRID_COSTS[s.gridLevel], null)
  row('battery', 'i-batt', t('Batarya Deposu Sv.{0}', Math.min(s.batteryLevel + 1, 3)),
    `${BATTERY_CAP[Math.min(s.batteryLevel + 1, 3)]} kWh`,
    t('Üretilen elektriği biriktirir, araçlar buradan anında şarj olur'),
    s.batteryLevel >= 3 ? null : BATTERY_COSTS[s.batteryLevel],
    s.gridLevel < 1 ? t('Elektrik altyapısı gerekli') : null)
  row('evcharger', 'i-charger', t('DC Şarj Ünitesi #{0}', Math.min(s.evChargers + 1, MAX_EV)), t('+1 ünite'),
    t('Elektrikli araç müşterileri gelmeye başlar; ünite arttıkça EV trafiği artar'),
    s.evChargers >= MAX_EV ? null : EV_COSTS[s.evChargers],
    s.gridLevel < 1 ? t('Elektrik altyapısı gerekli')
      : s.batteryLevel < 1 ? t('Önce batarya deposu kur') : null)
  row('solar', 'i-solar', s.solarCount ? t('Güneş Santrali ({0})', s.solarCount) : t('Güneş Santrali'), '+3 kWh/sn',
    t('Bedava üretim — ama kirlenir, düzenli temizlik ister (sınırsız kurulur)'),
    SOLAR_COST,
    s.gridLevel < 1 ? t('Elektrik altyapısı gerekli') : null)
  row('dieselgen', 'i-gen', t('Dizel Jeneratör'), t('+7 kWh/sn'),
    t('Tanktan mazot yakar — gürültüsü şarjdaki müşterileri kaçırır'),
    s.hasDiesel ? null : DIESELGEN_COST,
    s.gridLevel < 1 ? t('Elektrik altyapısı gerekli') : null)
  row('smr', 'i-reactor', t('Modüler Reaktör'), t('+15 kWh/sn'),
    t('Dev üretim — bakımsız kalırsa PATLAR, her şey sıfırlanır'),
    s.hasSMR ? null : SMR_COST,
    s.gridLevel < 2 ? t('Altyapı Sv.2 gerekli') : null)

  return rows
}

// ---- Bakım & Onarım ----

export interface MaintRow {
  id: string
  icon: string
  title: string
  cost: number
  urgent: boolean
  disabled: boolean
}

export function getMaintenanceItems(s: GameState): MaintRow[] {
  const rows: MaintRow[] = []
  if (s.hasSolar) {
    rows.push({
      id: 'clean-solar', icon: 'i-clean',
      title: t('Panel Temizliği (kir %{0})', Math.round(s.solarDirt * 100)),
      cost: 300, urgent: s.solarDirt > 0.6, disabled: s.solarDirt < 0.15,
    })
  }
  if (s.hasSMR) {
    rows.push({
      id: 'maint-smr', icon: 'i-reactor',
      title: t('Reaktör Bakımı (yıpranma %{0})', Math.round(s.smrWear * 100)),
      cost: 1500, urgent: s.smrWear > 0.6, disabled: s.smrWear < 0.1,
    })
    rows.push({
      id: 'order-uranium', icon: 'i-uranium',
      title: s.uraniumPending
        ? `Uranyum yolda (${Math.ceil(s.uraniumEta)}sn)`
        : t('Uranyum Siparişi (%{0} kaldı)', Math.round(s.uranium)),
      cost: URANIUM_COST, urgent: s.uranium <= 15 && !s.uraniumPending,
      disabled: s.uraniumPending || s.uranium > 60,
    })
  }
  for (const i of s.brokenPumps) {
    rows.push({ id: `fix-pump-${i}`, icon: 'i-wrench', title: t('Pompa #{0} Tamiri', i + 1), cost: 800, urgent: true, disabled: false })
  }
  for (const i of s.brokenChargers) {
    rows.push({ id: `fix-charger-${i}`, icon: 'i-wrench', title: t('Şarj #{0} Tamiri', i + 1), cost: 1000, urgent: true, disabled: false })
  }
  return rows
}

// ---- Başarımlar ----

const ACHIEVEMENTS: [string, string, (s: GameState) => boolean][] = [
  ['first-10k', t('İlk ₺10.000 — Esnaf oldun!'), s => s.money >= 10000],
  ['rich-100k', '₺100.000 — Patron!', s => s.money >= 100000],
  ['five-star', t('5 yıldız itibar — Efsane istasyon!'), s => s.reputation >= 4.95],
  ['full-pumps', '4 pompa — Tam kadro!', s => s.pumps >= 4],
  ['electric-age', t('Elektrik çağı — İlk şarj ünitesi!'), s => s.evChargers >= 1],
  ['atomic', t('Atom karıncası — Reaktör kuruldu!'), s => s.hasSMR],
  ['landlord', t('Toprak ağası — 9 arsanın tamamı!'), s => s.ownedParcels.size >= 9],
  ['week-one', t('7. gün — Bir haftadır ayaktasın!'), s => s.day >= 7],
]

export function checkAchievements(s: GameState) {
  for (const [id, title, cond] of ACHIEVEMENTS) {
    if (!s.achievements.has(id) && cond(s)) {
      s.achievements.add(id)
      s.events.push(t('🏆 Başarım: {0}', title))
    }
  }
}

// ---- Kayıt ----

const SAVE_FIELDS = [
  'money', 'reputation', 'stationName', 'pumps', 'signLevel', 'tankLevel', 'marketLevel', 'toiletLevel',
  'gridLevel', 'evChargers', 'batteryLevel', 'battery', 'elecPrice', 'toiletFee', 'solarCount', 'hasDiesel', 'hasSMR',
  'hasWash', 'hasOil', 'hasCoffee', 'hasRestaurant', 'hasTruckPark', 'airWaterCount', 'selfWashCount', 'parkingCount',
  'solarDirt', 'smrWear', 'uranium', 'uraniumPending', 'uraniumEta', 'day', 'dayStartMoney', 'dayStartRevenue', 'closed',
  'lastLoginDate', 'loginStreak', 'dailyDate', 'dailyServed', 'dailyDone', 'maintCare', 'wideGates', 'loan', 'partner',
  'wagesPaid', 'fuelSpent', 'noAds',
] as const

export function serializeState(s: GameState): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const f of SAVE_FIELDS) out[f] = (s as any)[f]
  out.tanks = { ...s.tanks }
  out.tankCounts = { ...s.tankCounts }
  out.stats = { ...s.stats, liters: { ...s.stats.liters } }
  out.facDaily = { ...s.facDaily }
  out.facTotal = { ...s.facTotal }
  out.fuelLog = s.fuelLog.slice(-40)
  out.wageLog = s.wageLog.slice(-40)
  out.salesLog = s.salesLog.slice(-370)
  out.autoChargers = [...s.autoChargers]
  out.autoPumps = [...s.autoPumps]
  out.prices = { ...s.prices }
  out.orders = JSON.parse(JSON.stringify(s.orders)) // bekleyen tankerler F5'te kaybolmasın
  out.loan = { ...s.loan, collateral: [...s.loan.collateral] } // kredi durumu kayda girsin
  out.partner = { ...s.partner } // banka ortaklığı durumu
  out.pendingCash = { ...s.pendingCash }
  out.ownedParcels = [...s.ownedParcels]
  out.pavedParcels = [...s.pavedParcels]
  out.achievements = [...s.achievements]
  // arızalar da kayda girer — çıkış-giriş bedava tamir olmasın
  out.brokenPumps = [...s.brokenPumps]
  out.brokenChargers = [...s.brokenChargers]
  return out
}

export function hydrateState(s: GameState, data: Record<string, unknown>) {
  for (const f of SAVE_FIELDS) {
    if (f in data) (s as any)[f] = data[f]
  }
  // eski boolean kayıtları sayaca çevir
  if (data.hasSolar && !s.solarCount) s.solarCount = 1
  if (data.hasParking && !s.parkingCount) s.parkingCount = 1
  if (data.hasAirWater && !s.airWaterCount) s.airWaterCount = 1
  if (data.hasSelfWash && !s.selfWashCount) s.selfWashCount = 1
  if (data.tanks && typeof data.tanks === 'object') Object.assign(s.tanks, data.tanks)
  if (data.tankCounts && typeof data.tankCounts === 'object') Object.assign(s.tankCounts, data.tankCounts)
  if (data.facDaily && typeof data.facDaily === 'object') Object.assign(s.facDaily, data.facDaily)
  if (Array.isArray(data.fuelLog)) s.fuelLog = (data.fuelLog as any[]).filter(x => x && typeof x.cost === 'number').slice(-40)
  if (Array.isArray(data.wageLog)) s.wageLog = (data.wageLog as any[]).filter(x => x && typeof x.amount === 'number').slice(-40)
  if (Array.isArray(data.salesLog)) s.salesLog = (data.salesLog as any[]).filter(x => x && typeof x.rev === 'number').slice(-370)
  // eski kayıt (salesLog yok): ilk gün-sonunun tüm kümülatif ciroyu tek güne yazmasını önle
  if (!s.salesLog.length && !s.dayStartRevenue && s.stats.revenue > 0) s.dayStartRevenue = s.stats.revenue
  if (data.facTotal && typeof data.facTotal === 'object') Object.assign(s.facTotal, data.facTotal)
  if (Array.isArray(data.autoChargers)) s.autoChargers = new Set((data.autoChargers as number[]).filter(n => Number.isInteger(n)))
  if (Array.isArray(data.autoPumps)) s.autoPumps = new Set((data.autoPumps as number[]).filter(n => Number.isInteger(n)))
  const st = data.stats as { liters?: Record<string, number> } & Record<string, number> | undefined
  if (st && typeof st === 'object') {
    for (const k of ['served', 'lost', 'kwh', 'revenue'] as const) {
      if (typeof st[k] === 'number') s.stats[k] = st[k]
    }
    if (st.liters) Object.assign(s.stats.liters, st.liters)
  }
  if (data.orders && typeof data.orders === 'object') {
    for (const f of FUELS) {
      const o = (data.orders as Record<string, { pending?: boolean; eta?: number; arrived?: boolean; delivering?: boolean }>)[f]
      if (o) {
        s.orders[f].eta = Math.min(60, Math.max(0, Number(o.eta) || 0))
        // Tanker (fiziksel araç) kaydedilmez. 'delivering' (yolda) ya da 'arrived'
        // iken yenilenirse tanker nesnesi kaybolur ve teslimat asla tamamlanmazdı —
        // sipariş sonsuza dek "yolda" takılırdı. Bunları 'arrived' olarak geri yükle;
        // ana döngü yeni bir tanker spawn edip teslimatı tamamlar. Böylece takılı
        // kalmış kayıtlar da bir sonraki açılışta kendiliğinden düzelir.
        if (o.arrived || o.delivering) {
          s.orders[f].pending = false
          s.orders[f].arrived = true
          s.orders[f].delivering = false
        } else {
          // pending ama geri sayım bittiyse teslimata geçir; değilse pending kalsın
          s.orders[f].pending = !!o.pending && s.orders[f].eta > 0
          s.orders[f].arrived = !!o.pending && s.orders[f].eta <= 0
          s.orders[f].delivering = false
        }
      }
    }
  }
  if (data.prices && typeof data.prices === 'object') {
    Object.assign(s.prices, data.prices)
    for (const f of FUELS) {
      const [lo, hi] = priceBounds(f)
      s.prices[f] = Math.min(hi, Math.max(lo, Number(s.prices[f]) || FUEL_PRICE[f]))
    }
  }
  if (data.pendingCash && typeof data.pendingCash === 'object') s.pendingCash = { ...(data.pendingCash as Record<string, number>) }
  if (Array.isArray(data.ownedParcels)) s.ownedParcels = new Set(data.ownedParcels as string[])
  if (Array.isArray(data.pavedParcels)) s.pavedParcels = new Set(data.pavedParcels as string[])
  if (Array.isArray(data.achievements)) s.achievements = new Set(data.achievements as string[])
  if (Array.isArray(data.brokenPumps)) s.brokenPumps = new Set((data.brokenPumps as number[]).filter(n => Number.isInteger(n)))
  if (Array.isArray(data.brokenChargers)) s.brokenChargers = new Set((data.brokenChargers as number[]).filter(n => Number.isInteger(n)))
}

export function doMaintenance(s: GameState, id: string): boolean {
  const item = getMaintenanceItems(s).find(r => r.id === id)
  if (!item || item.disabled || s.money < item.cost) return false
  s.money -= item.cost
  s.maintCare = Math.min(1, s.maintCare + 0.2) // düzenli bakım = daha az arıza
  if (id === 'clean-solar') s.solarDirt = 0
  else if (id === 'maint-smr') s.smrWear = 0
  else if (id === 'order-uranium') { s.uraniumPending = true; s.uraniumEta = URANIUM_ETA }
  else if (id.startsWith('fix-pump-')) s.brokenPumps.delete(Number(id.slice(9)))
  else if (id.startsWith('fix-charger-')) s.brokenChargers.delete(Number(id.slice(12)))
  return true
}

/** Satın alma dener; başarılıysa true. Görsel güncellemeleri çağıran taraf yapar. */
export function buyItem(s: GameState, id: string): boolean {
  const item = getShopItems(s).find(r => r.id === id)
  if (!item || item.status !== 'buy' || item.cost === null || s.money < item.cost) return false
  s.money -= item.cost
  // yakıt başına ek tank (dinamik id — switch'e girmeden ele alınır)
  if (id.startsWith('tankadd-')) { s.tankCounts[id.slice('tankadd-'.length) as FuelType]++; return true }
  switch (id) {
    case 'pump': s.pumps++; break
    case 'sign': s.signLevel++; break
    case 'widegate': s.wideGates = true; break
    case 'tank': s.tankLevel++; break
    case 'market': s.marketLevel++; break
    case 'toilet': s.toiletLevel++; break
    case 'grid': s.gridLevel++; break
    case 'battery': s.batteryLevel++; break
    case 'evcharger': s.evChargers++; break
    case 'solar': s.solarCount++; break
    case 'dieselgen': s.hasDiesel = true; break
    case 'smr': s.hasSMR = true; s.uranium = 100; break
    case 'wash': s.hasWash = true; break
    case 'oil': s.hasOil = true; break
    case 'coffee': s.hasCoffee = true; break
    case 'restaurant': s.hasRestaurant = true; break
    case 'truckpark': s.hasTruckPark = true; break
    case 'airwater': s.airWaterCount++; break
    case 'selfwash': s.selfWashCount++; break
    case 'parking': s.parkingCount++; break
    default: return false
  }
  return true
}

export const SELL_REFUND = 0.5 // yıkımda yatırımın yarısı geri döner

/** Bir binanın satılıp satılamayacağını ve iade tutarını döndürür (mutasyon yapmaz).
 *  Pompa/şarj/sayılabilir tesislerde yalnızca EN SON eklenen örnek satılabilir —
 *  böylece indeks boşluğu / yeniden numaralandırma gerekmez. null = satılamaz. */
export function sellInfo(s: GameState, id: string): { refund: number } | null {
  const base = id.split('#')[0]
  const inst = id.includes('#') ? Number(id.split('#')[1]) : 0
  const half = (c: number) => Math.round(c * SELL_REFUND)
  if (base === 'pump') {
    const i = Number(id.slice(5))
    if (s.pumps <= 1 || i !== s.pumps - 1) return null // en az 1 pompa kalmalı, sadece sonuncu
    return { refund: half(PUMP_COSTS[s.pumps - 1]) }
  }
  if (base === 'charger') {
    const i = Number(id.slice(8))
    if (s.evChargers <= 0 || i !== s.evChargers - 1) return null
    return { refund: half(EV_COSTS[s.evChargers - 1]) }
  }
  switch (base) {
    case 'market': return s.marketLevel > 0 ? { refund: half(MARKET_COSTS.slice(0, s.marketLevel).reduce((a, b) => a + b, 0)) } : null
    case 'toilet': return s.toiletLevel > 0 ? { refund: half(TOILET_COSTS.slice(0, s.toiletLevel).reduce((a, b) => a + b, 0)) } : null
    case 'battery': return s.batteryLevel > 0 ? { refund: half(BATTERY_COSTS.slice(0, s.batteryLevel).reduce((a, b) => a + b, 0)) } : null
    case 'wash': return s.hasWash ? { refund: half(WASH_COST) } : null
    case 'oil': return s.hasOil ? { refund: half(OIL_COST) } : null
    case 'coffee': return s.hasCoffee ? { refund: half(COFFEE_COST) } : null
    case 'restaurant': return s.hasRestaurant ? { refund: half(RESTAURANT_COST) } : null
    case 'truckpark': return s.hasTruckPark ? { refund: half(TRUCKPARK_COST) } : null
    case 'dieselgen': return s.hasDiesel ? { refund: half(DIESELGEN_COST) } : null
    case 'smr': return s.hasSMR ? { refund: half(SMR_COST) } : null
    case 'solar': return s.solarCount > 0 && inst === s.solarCount - 1 ? { refund: half(SOLAR_COST) } : null
    case 'parking': return s.parkingCount > 0 && inst === s.parkingCount - 1 ? { refund: half(PARKING_COST) } : null
    case 'selfwash': return s.selfWashCount > 0 && inst === s.selfWashCount - 1 ? { refund: half(SELFWASH_COST) } : null
    case 'airwater': return s.airWaterCount > 0 && inst === s.airWaterCount - 1 ? { refund: half(AIRWATER_COST) } : null
    default: return null // sign/tank/grid/widegate/office: yükseltme ya da kritik altyapı, satılmaz
  }
}

/** Satışı uygula: state sayaç/bayraklarını düşür, iadeyi ekle. Görsel kaldırmayı çağıran yapar. */
export function applySell(s: GameState, id: string): number | null {
  const info = sellInfo(s, id)
  if (!info) return null
  const base = id.split('#')[0]
  s.money += info.refund
  if (base === 'pump') { const i = s.pumps - 1; s.pumps--; s.brokenPumps.delete(i); s.autoPumps.delete(i) }
  else if (base === 'charger') { const i = s.evChargers - 1; s.evChargers--; s.brokenChargers.delete(i); s.autoChargers.delete(i) }
  else switch (base) {
    case 'market': s.marketLevel = 0; break
    case 'toilet': s.toiletLevel = 0; break
    case 'battery': s.batteryLevel = 0; s.battery = 0; break
    case 'wash': s.hasWash = false; break
    case 'oil': s.hasOil = false; break
    case 'coffee': s.hasCoffee = false; break
    case 'restaurant': s.hasRestaurant = false; break
    case 'truckpark': s.hasTruckPark = false; break
    case 'dieselgen': s.hasDiesel = false; break
    case 'smr': s.hasSMR = false; s.uranium = 0; s.smrWear = 0; break
    case 'solar': s.solarCount--; break
    case 'parking': s.parkingCount--; break
    case 'selfwash': s.selfWashCount--; break
    case 'airwater': s.airWaterCount--; break
  }
  return info.refund
}
