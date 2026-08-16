import { t } from './i18n'
import {
  BOAT_SEGMENTS, BERTH_KINDS, MARINA_FACILITIES, berthIncome, winterStorageIncome,
  blueFlagStatus, pickMarinaEvent, type BerthKind, type MarinaFacId, type BoatSegment,
} from './marina'
import {
  freshRival, marketShare, rivalDecide, rivalKindFor, updateStrength, effectiveShare, rivalRamp, RIVAL_NAME,
  type RivalState,
} from './rival'
import { THEMES, LocationTheme } from './themes'
export type FuelType = 'benzin' | 'dizel' | 'lpg'

export const FUELS: FuelType[] = ['benzin', 'dizel', 'lpg']
export const FUEL_PRICE: Record<FuelType, number> = { benzin: 10, dizel: 9, lpg: 6 }
export type LocId = 'kasaba' | 'cevreyolu' | 'otoyol' | 'marina' | 'metropol'

/** Şubeye AİT (lokasyon-bazlı) alanlar. Bunun dışındaki her şey şirket seviyesidir:
 *  money, day, reputation, stats, loan, partner, brandStars, contract, marketingBudget… */
export const LOC_FIELDS = [
  'pumps', 'pumpSpeedLevel', 'signLevel', 'tankLevel', 'marketLevel', 'market2Level', 'toiletLevel', 'toilet2Level',
  'hasWash2', 'hasOil2', 'hasCoffee2', 'hasRestaurant2', 'managerLevel', 'staffLevel',
  'insurance', 'decorLevel', 'wear', 'gridLevel', 'lampCount',
  'marinaFacs', 'berths', 'winterSlots', 'marinaViolations', 'rival',
  'evChargers', 'batteryLevel', 'battery', 'elecPrice', 'toiletFee', 'solarCount',
  'hasDiesel', 'hasSMR', 'hasWash', 'hasOil', 'hasCoffee', 'hasRestaurant', 'hasTruckPark', 'hasTruckPark2',
  'airWaterCount', 'selfWashCount', 'parkingCount', 'solarDirt', 'smrWear', 'uranium',
  'uraniumPending', 'uraniumEta', 'closed', 'wideGates', 'smrWreck',
] as const

/** Şube anlık görüntüsü: ekipman alanları + tank/parsel/kumbara/otomasyon kümeleri */
export interface LocSnapshot {
  f: Record<string, unknown>
  tanks: Record<string, number>
  tankCounts: Record<string, number>
  prices: Record<string, number>
  pendingCash: Record<string, number>
  /** EXPLOIT FİXİ (Oğuz): sipariş ŞUBEYE bağlıdır — küçük şubede verilen ucuz
   *  sipariş ana şubenin 20k deposunu dolduruyordu. Eski snapshot'larda alan yok
   *  → applyLoc fresh (sipariş yok) uygular. */
  orders?: Record<string, { pending: boolean; eta: number; arrived: boolean; delivering: boolean; amount: number }>
  orderQty?: Record<string, number>
  /** şube ekipman değeri (devir eşiği ŞİRKET GENELİ sayar — companyEquipmentValue) */
  equipVal?: number
  ownedParcels: string[]
  pavedParcels: string[]
  autoPumps: number[]
  autoChargers: number[]
  brokenPumps: number[]
  brokenChargers: number[]
  placedPos: Record<string, [number, number]>
  placedRot: Record<string, number>
  placedRects: unknown[]
}

/** B2B sözleşmesi (lategame raporu Katman 4a): taahhüt edilen günlük hacim, piyasa altı
 *  fiyat, tamamlama bonusu, eksik teslimde ceza. Mevcut tank/tanker sistemini anlamlı kılar. */
export interface Contract {
  id: string
  name: string
  fuel: FuelType
  daysTotal: number
  daysLeft: number
  dailyLiters: number   // günlük taahhüt (L)
  pricePerL: number     // sözleşme fiyatı (piyasa altı)
  bonus: number         // tamamlanınca
  penalty: number       // eksik teslim edilen her gün için
  deliveredToday: number
  missedDays: number
}

/** Müşteri segmenti tanımı (lategame raporu Katman 1c) — activeSegments() üretir, Car kullanır. */
export interface CarSegment {
  id: string
  share: number      // gelme olasılığı (toplam < 1 kalmalı; kalanı standart müşteri)
  min: number        // talep ₺ alt sınır
  max: number        // talep ₺ üst sınır
  marginMult: number // satış marjı çarpanı (premium = daha yüksek kâr)
  fuel?: FuelType    // segment belirli yakıt istiyorsa
  truckOnly?: boolean
  label: string
}

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
/** POMPA HIZI GELİŞTİRMESİ (Oğuz: "dolum hızı parayla artırılabilir olsun") —
 *  Sv.1 +%25, Sv.2 +%50, Sv.3 +%80. Amorti ~4-6 dk (denge kuralı: 3-5 dk erken,
 *  5-10 dk geç oyun) — hız müşteri/dk demek, fiyat ona göre kademeli. */
export const PUMPSPEED_COSTS = [16_000, 38_000, 75_000]
export const PUMPSPEED_MULT = [1, 1.25, 1.5, 1.8]
export const SPILL_PENALTY_PER_L = 3
export const WRONG_FUEL_PENALTY = 300

export const TANK_CAPACITY = [800, 1500, 3000, 5000]
/** yakıt siparişi −/+ adımı (L) — min tankta bile birden çok kademe olmalı */
export const ORDER_STEP = 200
export const MAX_PUMPS = 14
export const MAX_EV = 12
/** ŞUBE BAŞINA KURULABİLİR EKİPMAN TAVANI — devir eşiği bunun üstüne ÇIKAMAZ.
 *  Ölçüm (30 Tem, canlı save'ler): full kurulu şube kasaba ₺1.761.500 · çevreyolu
 *  ₺1.689.100 · otoyol ₺1.721.300. Tavanı ölçülen maksimumun ALTINA (₺1.5M) sabitliyoruz
 *  ki eşik her zaman payla ulaşılabilir kalsın — "eşiğe erişilemiyor" kilidi bir daha
 *  oluşamasın. Yıldız farmının freni burada değil, artan şube açma bedelinde. */
export const BRANCH_EQUIP_CAP = 1_500_000
/** Her yeni şubenin bedel çarpanı: açık şube başına ×1.25 (bileşik).
 *  Devir eşiği tavanı şube sayısıyla büyüdüğü için tavanı yükseltmenin TEK yolu şube
 *  açmak — bedeli artan yapmak devir-çiftliğini parayla frenler.
 *  KALİBRASYON (30 Tem, canlı veri): 3 şubeli 15 oyuncunun medyan nakdi ₺2,87M. 1.4'te
 *  marina ₺9,8M (medyanın 3,4 katı) normal ilerleyen oyuncuyu da cezalandırıyordu →
 *  1.25 ile ₺7,81M. Farmın asıl freni zaten eşik tavanı + tavan devrinde %60→%30 kırpma;
 *  şube bedeli üçüncü katman, tek başına duvar olmamalı.
 *  Bedeller: çevreyolu ₺500k · otoyol ₺2,5M · marina ₺7,81M · metropol ₺23,44M */
export const BRANCH_COST_STEP = 1.25
// Batarya deposu kademeleri. Sv.3 (600 kWh) geç oyunda yetmiyordu: 12 şarj ünitesi
// dolu kapasiteyi dakikalar içinde boşaltıyor, güneş/reaktör üretimi biriktiremiyordu.
// Üç kademe eklendi; artış hızlanıyor ama fiyat daha hızlı artıyor (kWh başına maliyet
// her kademede yükselir → sınırsız depo sömürüsü yok).
export const BATTERY_CAP = [0, 100, 250, 600, 1200, 2400, 4500] // kWh
export const EV_PRICE_PER_KWH = 8
export const GRID_COST_PER_KWH = 3.5 // şebekeden çekilen her kWh faturalanır
export const DIESEL_GEN_FUEL_PER_S = 0.25 // jeneratör çalışırken tanktaki mazot tüketimi (L/sn)

const PUMP_COSTS = [0, 5000, 8000, 12000, 16000, 21000, 26000, 32000, 40000, 50000, 62000, 76000, 92000, 110000]
const SIGN_COSTS = [1500, 4000, 9000]
export const WIDEGATE_COST = 6000
/** pompacı: pompa başına bir kerelik işe alma ücreti. Satışın TAMAMI kasaya girer;
 *  pompacının tek "maliyeti" işe alma + oyuncunun bahşişten feragat etmesidir (manuel
 *  servis hâlâ bahşişle daha kârlı, ama pompacı yetişemediğin pompayı net kâra çevirir). */
export const POMPACI_HIRE = 800
export const EV_ATTENDANT_HIRE = 1000 // elektrikli şarjcı (pompacı muadili) işe alma bedeli
// KATMAN 2b sink'leri (rapor: "her musluğun bir gideri olmalı")
export const INSURANCE_DAILY = 0.0004      // varlık değerinin binde 0.4'ü / gün
export const LICENSE_PERIOD = 30           // ruhsat yenileme aralığı (oyun günü)
export const LAMP_COST = 2_500 // sokak lambası (dekoratif; gece görünürlük + küçük itibar)
export const DECOR_COSTS = [15_000, 40_000, 90_000] // dekorasyon kademeleri (itibar +0.15/kademe)
export const RENEW_RATIO = 0.6             // ekipman yenileme = alış değerinin %60'ı
// MÜDÜR (rapor §7 #5): kademeli otomasyon — Sv.1 kumbara toplar, Sv.2 + panel temizler,
// Sv.3 + arıza tamir eder. Yovmiyesi pasif geliri "aktifin %30'unu geçmesin" kuralına göre.
export const MANAGER_COSTS = [18_000, 34_000, 60_000]   // Sv.1/2/3 kurulum
export const MANAGER_WAGES = [0, 400, 750, 1_200]       // index = seviye, günlük yovmiye
// PERSONEL EĞİTİMİ (rapor §7 #7): pompacı/şarjcı kademesi — hız, bahşiş, hata oranı
export const STAFF_TRAIN_COSTS = [12_000, 26_000, 48_000] // Sv.1→2, 2→3, 3→4
export const POMPACI_WAGE = 120       // pompacı GÜNLÜK yovmiyesi (her oyun günü kasadan)
export const EV_ATTENDANT_WAGE = 150  // şarjcı günlük yovmiyesi
export const TANK_COSTS = [3000, 7000, 15000]
export const MAX_TANKS_PER_FUEL = 4
export const TANK_ADD_COSTS = [0, 6000, 12000, 20000] // index = mevcut adet → 2., 3., 4. tankın maliyeti
const MARKET_COSTS = [7000, 12000, 20000] // 3 seviye: kur → Sv.2 → Sv.3 (yerinde, aynı footprint)
const TOILET_COSTS = [2500, 5000]
const LAND_COST = 6000
const GRID_COSTS = [8000, 15000]
const BATTERY_COSTS = [5000, 9000, 16000, 34000, 72000, 155000]
const EV_COSTS = [6000, 10000, 14000, 18000, 22000, 27000, 32000, 38000, 46000, 56000, 68000, 82000]
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
  // METROPOL (§6.6): şehirde arsa pahalı. Kasabada çarpan yok → mevcut denge korunur.
  const land = s.theme().features?.land?.priceMult ?? 1
  return Math.round(base * mult * land / 100) * 100
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
  /** günlük muhasebe defteri. profit/near/far ADDITIVE alanlardır: eski save'lerdeki
   *  kayıtlarda bulunmaz, okuyucu `?? 0` ile karşılar (geriye dönük uyumlu). */
  salesLog: { day: number; rev: number; profit?: number; near?: number; far?: number }[] = []
  /** o günün başındaki toplam ciro (günlük satış = stats.revenue - dayStartRevenue) */
  dayStartRevenue = 0
  noAds = false // "Reklamları Kaldır" satın alındı mı (IAP) — interstitial gösterilmez
  orders: Record<FuelType, { pending: boolean; eta: number; arrived: boolean; delivering: boolean; amount: number }> = {
    benzin: { pending: false, eta: 0, arrived: false, delivering: false, amount: 0 },
    dizel: { pending: false, eta: 0, arrived: false, delivering: false, amount: 0 },
    lpg: { pending: false, eta: 0, arrived: false, delivering: false, amount: 0 },
  }

  pumps = 1
  pumpSpeedLevel = 0
  signLevel = 0
  tankLevel = 0
  /** yakıt başına fiziksel tank adedi (kapasite çarpanı) — additive, eski kayıtta default 1 */
  tankCounts: Record<FuelType, number> = { benzin: 1, dizel: 1, lpg: 1 }
  marketLevel = 0
  market2Level = 0 // karşı yaka marketi (yol karşısı istasyon için — save'e ADDITIVE alan)
  // B8: karşı yaka tesis NÜSHALARI (ADDITIVE). Kural: aynı tip tesisten YAKA BAŞINA 1 adet.
  // Böylece karşı istasyon "yarım" kalmıyor; sessiz gelir/servis kaybı biter.
  toilet2Level = 0
  hasWash2 = false
  hasOil2 = false
  hasCoffee2 = false
  hasRestaurant2 = false
  hasTruckPark2 = false // karşı yaka tır parkı (tek kurulumlu tesislerin karşı nüshası — Oğuz)
  marketingBudget = 0 // günlük reklam bütçesi ₺ (0-8000) — trafik arz+talep sink'i (ADDITIVE)
  opexStart = 0 // OPEX rampasının başladığı oyun günü (ilk yüklemede atanır — ADDITIVE)
  /** aktif B2B sözleşmesi (ADDITIVE alan; null = yok) — geç oyunun karar motoru */
  contract: Contract | null = null
  contractsDone = 0 // tamamlanan sözleşme sayısı (ADDITIVE)
  contractsFailed = 0
  /** Aktif şube ve açılmış şubeler — ADDITIVE alanlar (eski save: yalnız kasaba). */
  activeLoc: LocId = 'kasaba'
  unlockedLocs: LocId[] = ['kasaba']
  /** Pasif şubelerin EKİPMAN anlık görüntüleri (şube değişince buraya yazılır/okunur).
   *  Para, gün, itibar, prestij, kredi, sözleşme ŞİRKET seviyesinde kalır (tek kasa). */
  locSnapshots: Partial<Record<LocId, LocSnapshot>> = {}

  /** MARKA YILDIZI (prestij): kalıcı gelir çarpanı verir. 'reset' değil 'DEVRET' —
   *  save silinme travması tazeyken reset kelimesi kullanılmaz (rapor uyarısı). ADDITIVE. */
  brandStars = 0
  handoverCount = 0 // kaç kez devredildi (ADDITIVE)
  /** MÜDÜR seviyesi 0-3 (0 = yok). Kumbara toplama → bakım → tamir otomasyonu. ADDITIVE */
  managerLevel = 0
  /** PERSONEL eğitimi seviyesi 1-4: dolum hızı, bahşiş şansı, yanlış yakıt riski. ADDITIVE */
  staffLevel = 1
  managerT = 0 // runtime: müdür tur sayacı
  /** SEZON (Katman 4c): yaz 90 / sonbahar 45 / kış 90 / ilkbahar 45 gün — tekrarlanır.
   *  Bitişli koleksiyon tuzağına düşmez; her yıl döner. */
  season(): { id: 'yaz' | 'sonbahar' | 'kis' | 'ilkbahar'; name: string; traffic: number; dayInSeason: number; length: number } {
    const cycle = 270
    let d = ((this.day - 1) % cycle + cycle) % cycle
    // İKİ AYRI EĞRİ — tek çarpanla türetilmiyor, çünkü marina eğrisi ASİMETRİK
    // (yaz +%150, kış −%70) ve aynı çarpanla kara şubesini de yumuşatmak imkânsız.
    //  · MARİNA: rapor §6.5.5 tablosuyla birebir. Kışın tekne trafiği çöker ama kışlama
    //    ve tersane geliri zirve yapar — oyuncu iki farklı işletme modeli öğrenir.
    //  · KARA: ±%13 bandı. Bilerek hafif: canlı oyuncuların dengesi mevsimle sarsılmamalı.
    // Döngü İLKBAHARDA başlar → gün 1 çarpanı ~1.04, yani bugünkü denge korunur.
    const water = this.theme().lane.kind === 'water'
    const defs: [typeof this.seasonIdCache, string, number, number][] = water
      ? [['ilkbahar', t('İlkbahar'), 1.2, 45], ['yaz', t('Yaz'), 2.5, 90],
         ['sonbahar', t('Sonbahar'), 1.0, 45], ['kis', t('Kış'), 0.3, 90]]
      : [['ilkbahar', t('İlkbahar'), 1.04, 45], ['yaz', t('Yaz'), 1.13, 90],
         ['sonbahar', t('Sonbahar'), 1.0, 45], ['kis', t('Kış'), 0.87, 90]]
    for (const [id, name, traffic, length] of defs) {
      if (d < length) return { id: id as 'yaz', name, traffic, dayInSeason: d + 1, length }
      d -= length
    }
    return { id: 'ilkbahar', name: t('İlkbahar'), traffic: 1, dayInSeason: 1, length: 45 }
  }
  private seasonIdCache: 'yaz' | 'sonbahar' | 'kis' | 'ilkbahar' = 'yaz'

  /** PİYASA (Katman 4b): alış fiyatı günlük ±%15 dalgalanır. Determinist (gün-seed) →
   *  panel açılıp kapandıkça zıplamaz, 7 günlük TAHMİN gösterilebilir. Stoklama strateji olur. */
  marketIndex(day = this.day, f: FuelType = 'benzin'): number {
    const k = { benzin: 0, dizel: 1, lpg: 2 }[f]
    const x = Math.sin((day + 1) * 12.9898 + k * 78.233) * 43758.5453
    const r = x - Math.floor(x)                    // 0..1 determinist
    const slow = Math.sin(day / 9 + k)             // yavaş trend
    return 1 + 0.15 * (0.6 * (r * 2 - 1) + 0.4 * slow)  // ~0.85..1.15
  }
  /** güncel alış fiyatı (piyasa dalgalanmalı) */
  buyPrice(f: FuelType): number {
    return Math.round(FUEL_COST[f] * this.marketIndex(this.day, f) * 100) / 100
  }
  /** 7 günlük tahmin (grafik/karar için) */
  priceForecast(f: FuelType): number[] {
    return Array.from({ length: 7 }, (_, i) => Math.round(FUEL_COST[f] * this.marketIndex(this.day + i, f) * 100) / 100)
  }
  /** SİGORTA: primi ödenirse felaket/arıza maliyeti yarıya iner (ADDITIVE) */
  insurance = false
  /** RUHSAT: 30 günde bir yenilenir; ödenmezse itibar cezası (ADDITIVE) */
  licenseDueDay = 30
  /** DEKORASYON seviyesi 0-3: gelir etkisi ~0, itibar +küçük — klasik "parayı göster" sink'i */
  decorLevel = 0
  /** oyuncunun kurduğu sokak lambası adedi (#358/#679: yok edilen lambalar geri konabilsin) */
  lampCount = 0
  // ---- MARİNA (rapor §6.5) — hepsi ADDITIVE, kara şubelerinde hep boş kalır ----
  /** kurulu marina tesisleri (fueldock, pumpout, travelift…) */
  marinaFacs: string[] = []
  /** bağlama yerleri: tür → adet */
  berths: Record<string, number> = {}
  /** karada kışlama kapasitesi (tekne adedi) */
  winterSlots = 0
  /** çevre/uyum sicili — 3 ihlalde Mavi Bayrak askıya alınır (GEÇİCİ, kalıcı silme yok) */
  marinaViolations = 0
  /** AI RAKİP (Katman 4d) — yalnız ikinci şubeden sonra, kasaba HARİÇ. null = rakip yok */
  rival: RivalState | null = null
  /** doğru/yanlış defter kararı sayacı (öğretici geri bildirim için) */
  logbookOk = 0
  logbookBad = 0
  /** EKİPMAN YAŞLANMASI: 0-1 arası yıpranma; %100'de verim -%40, yenileme maliyeti */
  wear = 0
  managerResult: { collected: number; cleaned: boolean; fixed: number; ordered: number } | null = null
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
  /** #317 "karşı yaka geliri ayrı görünsün": günün cirosunun yaka dağılımı (runtime, save'e yazılmaz) */
  sideDaily = { near: 0, far: 0 }
  /** karşı yaka gelirini kaydet — main.ts satış/tesis yollarından çağrılır */
  addSideRevenue(far: boolean, amt: number) {
    if (amt > 0) this.sideDaily[far ? 'far' : 'near'] += amt
  }
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
  /** patlamış reaktör enkazı — temizlenene dek yeni reaktör kurulamaz (SAVE/LOC alanı) */
  smrWreck = false
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
  private truck2Timer = 45
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

  /** ALAN KITLIĞI (§6.6): bu şubede kaç parsel alınabilir (yoksa sınırsız) */
  parcelLimit(): number | null { return this.theme().features?.land?.maxParcels ?? null }
  /** Parsel sınırı doldu mu — arsa satın alma yolunda kontrol edilir */
  parcelLimitReached(): boolean {
    const lim = this.parcelLimit()
    return lim !== null && this.ownedParcels.size >= lim
  }
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
  fuelCapacity(f: FuelType): number {
    // MARİNA: kapasite çarpanı (tekne talebi araçların katbekat üstünde)
    return TANK_CAPACITY[this.tankLevel] * this.tankCounts[f] * (this.theme().features?.tankCapMult ?? 1)
  }
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
  /** GÜNEŞ FAKTÖRÜ 0..1 — main her karede gün döngüsünden yazar (gece 0, şafak/akşam
   *  rampa, gündüz 1). Kaydedilmez; batarya deposuna gündüz depola-gece harca değeri katar. */
  sunFactor = 1
  /** BEDAVA üretim kWh/sn: güneş + reaktör + jeneratör (altyapı Sv.2 bonusu dahil) */
  freeRate() {
    let r = 0
    if (this.solarCount > 0) r += 3 * this.solarCount * (1 - 0.7 * this.solarDirt) * this.sunFactor
    if (this.dieselRunning()) r += 7
    if (this.hasSMR && this.uranium > 0) r += 15
    if (this.gridLevel >= 2) r *= 1.3 // altyapı bonusu bedava üretimi de güçlendirir
    return r
  }
  /** anlık toplam üretim gücü kWh/sn (bedava + şebeke) */
  genRate() { return this.freeRate() + this.gridRate() }

  tick(dt: number) {
    // ---- ÇEVRE YOLU: ışık döngüsü + yaya müşteri (kasabada features yok → hiç çalışmaz) ----
    const feat = this.theme().features
    if (feat?.trafficLight) this.lightT += dt
    if (feat?.walkIns && !this.closed) {
      this.walkT += dt
      if (this.walkT >= feat.walkIns.everySec) {
        this.walkT = 0
        // yaya geçidinden gelen müşteri: ARAÇSIZ market/kafe cirosu (yakıt yok)
        const hasShop = this.marketLevel > 0 || this.hasCoffee || this.hasRestaurant
        if (hasShop) {
          const w = feat.walkIns
          const base = w.min + Math.random() * (w.max - w.min)
          const mult = 1 + 0.3 * this.marketLevel + (this.hasCoffee ? 0.2 : 0) + (this.hasRestaurant ? 0.3 : 0)
          const id = this.marketLevel > 0 ? 'market' : this.hasCoffee ? 'coffee' : 'restaurant'
          this.addPending(id, Math.round(base * mult), t('Yaya müşteri'))
          this.events.push(t('Yaya müşteri alışveriş yaptı (yol karşısından geldi)'))
        }
      }
    }
    this.managerResult = this.managerTick(dt) // müdür otomasyonu (varsa)
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
      // 0.0045 → 0.0015: paneller ~4 oyun-gününde kirlenir (eski hâli 1,5 günde
      // sıfırlıyordu — "paneller çok hızlı kirleniyor" şikâyeti, 29 Tem)
      // 0.0015 → 0.0005: paneller absürt hızlı kirleniyordu (18 şikayet + GES uzmanı 'panel her gün yıkanmaz')
      this.solarDirt = Math.min(1, this.solarDirt + 0.0005 * dt)
      if (before < 0.6 && this.solarDirt >= 0.6) this.events.push(t('Güneş panelleri iyice kirlendi, üretim düşüyor!'))
    }
    // uranyum: sipariş takibi + üretim sırasında tükenme
    if (this.uraniumPending) {
      this.uraniumEta -= dt
      if (this.uraniumEta <= 0) {
        this.uraniumPending = false
        this.uranium = 100
        this.events.push(t('Uranyum teslim edildi — reaktör tam güçte!'))
      }
    }
    if (this.hasSMR && this.uranium > 0 && this.batteryLevel > 0 && this.battery < this.batteryCapacity) {
      const before = this.uranium
      this.uranium = Math.max(0, this.uranium - URANIUM_DRAIN_PER_S * dt)
      if (before > 20 && this.uranium <= 20) this.events.push(t('Uranyum azalıyor! Yeni çubuk sipariş et.'))
      if (before > 0 && this.uranium === 0) this.events.push(t('Uranyum bitti — reaktör üretimi DURDU!'))
    }
    if (this.hasSMR) {
      const before = this.smrWear
      // 0.004 → 0.0012: eski hız ~4 dakikada kritiğe çıkıyordu — bakım koşuşturması
      // oyunculuk değil tuzaktı ("reaktör kayboluyor" = login sonrası hızlı patlama).
      this.smrWear = Math.min(1, this.smrWear + 0.0012 * dt)
      if (before < 0.5 && this.smrWear >= 0.5) this.events.push(t('Reaktör bakım istiyor!'))
      if (before < 0.75 && this.smrWear >= 0.75) this.events.push(t('REAKTÖR KRİTİK! Hemen bakım yap yoksa patlayacak!'))
      // Sv.3 MÜDÜR GARANTİSİ (Oğuz: "Sv.3 müdür varken patlamasını istemeyiz"):
      // müdür tesiste OLDUĞU sürece patlama zarı hiç atılmaz — parası o an yetmese
      // bile ilk bulduğu parayla bakımı yapar, felaket ancak müdürsüz ihmalde yaşanır.
      if (this.managerLevel < 3 && this.smrWear > 0.7
        && Math.random() < dt * 0.012 * (this.smrWear - 0.7) / 0.3) {
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
    if (this.hasTruckPark2) {
      this.truck2Timer -= dt
      if (this.truck2Timer <= 0) {
        this.truck2Timer = 35 + Math.random() * 20
        const m = 90 + Math.floor(Math.random() * 70)
        this.addPending('truckpark2', m, t('Karşı tır parkı'))
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
    // EKİPMAN YAŞLANMASI (Katman 2b): ünite sayısıyla orantılı, ~1 oyun gününde %1.5
    const units = this.pumps + this.evChargers + this.solarCount + (this.hasSMR ? 3 : 0)
    this.wear = Math.min(1, this.wear + dt * 0.000055 * Math.max(1, units))

    // rastgele arızalar — seyrek; para azken (Murphy) artar, bakım özeni yüksekken düşer
    const stress = this.graceActive ? 1 : this.money < 1000 ? 3 : this.money < 3000 ? 2 : 1
    // eğitimli personel arıza riskini düşürür (rapor §7 #7: hata oranı iyileşir)
    const care = (1 - 0.65 * this.maintCare) * this.staffErrorMult()
    const brokenCount = this.brokenPumps.size + this.brokenChargers.size
    if (brokenCount < 2) {
      for (let i = 0; i < this.pumps; i++) {
        if (!this.brokenPumps.has(i) && Math.random() < (dt / 3600) * stress * care) {
          this.brokenPumps.add(i)
          this.events.push(t('Pompa #{0} arıza yaptı! Üstüne tıklayıp karttan tamir et.', i + 1))
          break
        }
      }
      for (let i = 0; i < this.evChargers; i++) {
        if (!this.brokenChargers.has(i) && Math.random() < (dt / 4200) * stress * care) {
          this.brokenChargers.add(i)
          this.events.push(t('Şarj ünitesi #{0} arızalandı!', i + 1))
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
    // ESNEKLİK (feedback: 'fiyatı tavana çektim müşteri aynı'): eski eğri tavanda talebi
    // yalnız %6 düşürüyordu — hissedilmiyordu. Yeni: varsayılanda 1.0 (denge değişmez),
    // tavan fiyatta ~%32 daha az müşteri, taban fiyatta %35 daha çok (ucuzcu istasyon stratejisi).
    // Fiyat esnekliği ŞUBEYE göre: otoyolda alternatif yok (0.25 → fiyat serbest),
    // metropolde alternatif bol (1.6 → fiyat kritik). Kasaba 1.0: mevcut denge korunur.
    const el = this.theme().econ.priceElasticity
    const demand = factor <= 1 ? 1 + 0.35 * el * (1 - factor) : 1 - 1.6 * el * (factor - 1)
    // Taban/tavan da şubeye göre: kasabada (el=1) 0.35/1.35 → MEVCUT DENGE BİREBİR korunur.
    // Otoyolda taban yüksek (fiyat esnek değil), metropolde düşük (alternatif bol).
    const floor = Math.min(0.9, Math.max(0.15, 0.35 / el))
    return Math.min(1 + 0.35 * el, Math.max(floor, demand))
  }

  entryChance() {
    if (this.closed) return 0
    // ışık çarpanı: kırmızıda sıkışan sürücü istasyona giriyor (çevre yolu/metropol imzası)
    // sezon çarpanı (Katman 4c): yaz tatili trafiği, kış düşüşü — tekrarlanabilir döngü
    const priceF = this.priceDemandFactor()
    const boost = (this.promo?.type === 'rush' ? 1.5 : 1) * priceF * this.lightBoost() * this.season().traffic
    // Şube kısıtları temadan: taban çekicilik, tabela ve itibar AĞIRLIĞI şubeye göre değişir
    // (kasabada itibar belirleyici, otoyolda tabela; kasaba değerleri 1.0 → denge değişmez).
    const th = this.theme()
    const c = th.econ.entryBase + 0.1 * th.econ.signWeight * this.signLevel
      + 0.05 * th.econ.repWeight * (this.reputation + this.decorRep() - 3)
      + 0.04 * this.marketLevel + 0.02 * this.toiletLevel + 0.02 * this.evChargers
      + (this.hasWash ? 0.03 : 0) + (this.hasOil ? 0.03 : 0)
      + (this.hasCoffee ? 0.02 : 0) + (this.hasRestaurant ? 0.03 : 0)
      + (this.hasTruckPark ? 0.02 : 0) + 0.02 * Math.min(this.airWaterCount, 3)
      + 0.02 * Math.min(this.selfWashCount, 3)
    // Fiyat esnekliği TÜM akışı çarpar. Eskiden yalnız taban terimi çarpıyordu —
    // gelişmiş istasyonda tesis terimleri fiyattan bağımsız kalınca tavan fiyat
    // trafiği neredeyse hiç düşürmüyordu ("fiyat bir şey değiştirmiyor", #374 #414 #124).
    // Varsayılan fiyatta çarpan 1.0 → mevcut denge değişmez; tavanda ~%65 az müşteri.
    const raw = (c + 0.10 * this.marketingFactor()) * boost
    // YUMUŞAK TAVAN (lategame raporu Kusur #1): eski sert 0.95 kesimi ₺122k'dan sonraki
    // HER yatırımı trafiğe ölü kılıyordu ("yaptım ama bir şey değişmedi"). 0.80'e kadar
    // birebir; üstü azalan verimle 0.95'e asimptotik — geç yatırımlar hâlâ hissedilir.
    const ent = raw <= 0.80 ? raw : 0.80 + 0.15 * (1 - Math.exp(-(raw - 0.80) / 0.25))

    // MÜDAVİM MÜŞTERİ (rapor §6.2 — KASABA İMZASI)
    // Müdavim, akışa EKLENEN müşteri DEĞİLDİR; akışın FİYATA DUYARSIZ payıdır.
    // (Eklemeli modellenince kasabada trafik bir anda ~%30 şişiyordu: hem mevcut dengeyi
    //  bozar hem trafik sistemini kapasite sınırına iterdi — yük testinde ölçüldü.)
    // Varsayılan fiyatta priceF = 1 olduğu için toplam AYNI kalır; asıl etki fiyat
    // yükseldiğinde görülür: sadık taban kaçmaz. Kasabada "itibar biriktir, fiyatı
    // sonra rahat kullan" stratejisi böyle anlam kazanır.
    const sh = this.regularsShare()
    const withReg = sh <= 0 ? ent
      : ent * (1 - sh) + Math.min(0.98, priceF > 0.0001 ? ent / priceF : ent) * sh

    // AI RAKİP (Katman 4d): yoldan geçen trafiğin bir kısmını rakip alır. Fiyat kaldıracı
    // burada GERÇEK anlam kazanır — rakipten pahalıysan akış ona kayar, ucuzsan sana gelir.
    // Rakip yokken çarpan 1 → kasabada ve tek şubeli oyuncuda hiçbir şey değişmez.
    // Rampa: rakibin etkisi 10 günde kademeli devreye girer (açılış şoku yok).
    const share = this.rival ? effectiveShare(this.marketShare(), this.rival, this.day) : 1
    return Math.max(0.05, withReg * share)
  }

  /** Müşterilerin ne kadarı müdavim (0..share). Yalnız teması izin veren şubede (kasaba). */
  regularsShare(): number {
    const r = this.theme().features?.regulars
    if (!r || this.closed) return 0
    const rep = this.reputation + this.decorRep()
    if (rep <= r.repFloor) return 0
    // itibarın tavana ne kadar yaklaştığı (repFloor→5.0 arası 0→1)
    return r.share * Math.min(1, (rep - r.repFloor) / (5 - r.repFloor))
  }

  // ---- ÇOKLU ŞUBE (lategame raporu §3a: ORTAK ŞİRKET KASASI + şube bazlı P&L) ----
  /** Aktif şubenin ekipmanını anlık görüntüye çevir (yerleşim tabloları main.ts'ten gelir) */
  captureLoc(layout: { placedPos: Record<string, [number, number]>; placedRot: Record<string, number>; placedRects: unknown[] }): LocSnapshot {
    const f: Record<string, unknown> = {}
    for (const k of LOC_FIELDS) f[k] = (this as any)[k]
    return {
      f,
      tanks: { ...this.tanks }, tankCounts: { ...this.tankCounts }, prices: { ...this.prices },
      pendingCash: { ...this.pendingCash },
      orders: JSON.parse(JSON.stringify(this.orders)),
      orderQty: { ...this.orderQty },
      equipVal: this.equipmentValue(),
      ownedParcels: [...this.ownedParcels], pavedParcels: [...this.pavedParcels],
      autoPumps: [...this.autoPumps], autoChargers: [...this.autoChargers],
      brokenPumps: [...this.brokenPumps], brokenChargers: [...this.brokenChargers],
      placedPos: JSON.parse(JSON.stringify(layout?.placedPos ?? {})),
      placedRot: { ...(layout?.placedRot ?? {}) },
      placedRects: JSON.parse(JSON.stringify(layout?.placedRects ?? [])),
    }
  }
  /** Anlık görüntüyü aktif şube olarak yükle; yerleşim tablolarını döndürür (main.ts uygular) */
  applyLoc(sn: LocSnapshot | null): { placedPos: Record<string, [number, number]>; placedRot: Record<string, number>; placedRects: unknown[] } {
    const fresh = new GameState()
    const src = sn?.f ?? {}
    for (const k of LOC_FIELDS) (this as any)[k] = (k in src) ? (src as any)[k] : (fresh as any)[k]
    const copyRec = (dst: Record<string, number>, from: Record<string, number> | undefined, def: Record<string, number>) => {
      for (const k of Object.keys(dst)) dst[k] = Number(from?.[k] ?? def[k]) || 0
    }
    copyRec(this.tanks as unknown as Record<string, number>, sn?.tanks, fresh.tanks as unknown as Record<string, number>)
    copyRec(this.tankCounts as unknown as Record<string, number>, sn?.tankCounts, fresh.tankCounts as unknown as Record<string, number>)
    copyRec(this.prices as unknown as Record<string, number>, sn?.prices, fresh.prices as unknown as Record<string, number>)
    this.pendingCash = { ...(sn?.pendingCash ?? {}) }
    // sipariş ŞUBEYE bağlı: bu şubede bekleyen tanker varsa döner, yoksa temiz başlar
    for (const f of Object.keys(this.orders) as FuelType[]) {
      const so = sn?.orders?.[f]
      // 'delivering' iken şube değişirse tanker nesnesi yok olur → 'arrived' olarak
      // dön; ana döngü bu şubeye dönüldüğünde yeni tanker spawn edip teslim eder.
      this.orders[f] = so
        ? { pending: !!so.pending && !so.arrived && !so.delivering,
            eta: Number(so.eta) || 0,
            arrived: !!so.arrived || !!so.delivering,
            delivering: false, amount: Math.max(0, Number(so.amount) || 0) }
        : { pending: false, eta: 0, arrived: false, delivering: false, amount: 0 }
      this.orderQty[f] = Number(sn?.orderQty?.[f] ?? fresh.orderQty[f]) || fresh.orderQty[f]
    }
    this.ownedParcels = new Set(sn?.ownedParcels ?? fresh.ownedParcels)
    this.pavedParcels = new Set(sn?.pavedParcels ?? fresh.pavedParcels)
    this.autoPumps = new Set(sn?.autoPumps ?? [])
    this.autoChargers = new Set(sn?.autoChargers ?? [])
    this.brokenPumps = new Set(sn?.brokenPumps ?? [])
    this.brokenChargers = new Set(sn?.brokenChargers ?? [])
    return {
      placedPos: sn?.placedPos ? JSON.parse(JSON.stringify(sn.placedPos)) : {},
      placedRot: sn?.placedRot ? { ...sn.placedRot } : {},
      placedRects: sn?.placedRects ? JSON.parse(JSON.stringify(sn.placedRects)) : [],
    }
  }
  /** Şube değiştir: mevcut şube saklanır, hedef şube yüklenir. Para/gün/prestij ŞİRKETTE kalır. */
  switchLoc(to: LocId, layout: { placedPos: Record<string, [number, number]>; placedRot: Record<string, number>; placedRects: unknown[] }) {
    if (to === this.activeLoc || !this.unlockedLocs.includes(to)) return null
    this.locSnapshots[this.activeLoc] = this.captureLoc(layout)
    const next = this.applyLoc(this.locSnapshots[to] ?? null)
    delete this.locSnapshots[to] // aktif şube snapshot'ta DURMAZ (çift sayım = anti-cheat 409)
    this.activeLoc = to
    // D12 (analiz): İLK kasaba-dışı şubeye İLK geçişte Müdür Sv.1 HEDİYE — yeni şubeyi
    // işletmeye başlama eşiğini düşürür (bir kez; yovmiyesi normal işler)
    if (!this.firstBranchGift && to !== 'kasaba' && this.managerLevel === 0) {
      this.firstBranchGift = true
      this.managerLevel = 1
      this.giftToast = t('İlk şube hediyesi: bu şubeye Müdür Sv.1 atandı — kumbara + yakıt siparişi otomatik!')
    }
    return next
  }
  /** D12: tek seferlik ilk-şube hediyesi verildi mi (ADDITIVE save alanı) */
  firstBranchGift = false
  /** main gösterip sıfırlar */
  giftToast: string | null = null
  /** ŞUBE AÇMA BEDELİ: temanın taban bedeli × ARTAN çarpan (açık şube başına ×1.4).
   *  Devir eşiği tavanı = şube × ₺1.5M olduğu için tavanı yükseltmenin tek yolu yeni
   *  şube açmak; bedeli bileşik artan yapmak yıldız farmını parayla frenler.
   *  Taban bedeller temada, çarpan tek yerde — yeni tema eklenince otomatik uygulanır. */
  branchUnlockCost(id: LocId): number {
    const base = THEMES[id]?.unlock.cash ?? 0
    if (base <= 0) return 0
    const owned = Math.max(1, this.unlockedLocs.length)
    return Math.round(base * Math.pow(BRANCH_COST_STEP, owned - 1) / 10_000) * 10_000
  }
  /** Şube açma bedeli/şartı temadan gelir (artan nakit + marka yıldızı) */
  canUnlockLoc(id: LocId): { ok: boolean; cash: number; stars: number; reason: string } {
    const th = THEMES[id]
    if (!th) return { ok: false, cash: 0, stars: 0, reason: 'yok' }
    const cash = this.branchUnlockCost(id)
    if (this.unlockedLocs.includes(id)) return { ok: false, cash, stars: th.unlock.stars, reason: 'acik' }
    if (this.brandStars < th.unlock.stars) return { ok: false, cash, stars: th.unlock.stars, reason: 'yildiz' }
    if (this.money < cash) return { ok: false, cash, stars: th.unlock.stars, reason: 'para' }
    return { ok: true, cash, stars: th.unlock.stars, reason: '' }
  }
  /** Şubeyi aç (bedeli kasadan düşer — büyük bir SINK) */
  unlockLoc(id: LocId): boolean {
    const c = this.canUnlockLoc(id)
    if (!c.ok) return false
    this.money -= c.cash
    this.unlockedLocs.push(id)
    return true
  }
  /** Aktif şubenin teması — ekonomik kısıtlar buradan okunur */
  theme(): LocationTheme { return THEMES[this.activeLoc] ?? THEMES.kasaba }

  // ─────────────────────────────────────────────────────────────────────────
  // ŞUBE MÜDÜRÜ — PASİF ŞUBE İŞLETMESİ
  //
  // SORUN: şube açmak ₺500.000–12.000.000 arası bir sink ama oyuncu bir şubeden
  // ayrıldığı anda o şube TAMAMEN DONUYORDU. Beş şubesi olan oyuncu dördünü boşa
  // yatırım olarak taşıyordu; "şubeye müdür atayabilmeliyim, gelir gider yakıt
  // siparişine o baksın" isteği tam bu boşluğu tarif ediyor.
  //
  // ÇÖZÜM: `managerLevel` zaten ŞUBE BAZLI bir alan (LOC_FIELDS içinde). Artık
  // pasif şubede de çalışıyor: gün dönüşünde müdürü olan her şube kendi net gelirini
  // (ciro − yovmiye − yakıt) şube kasasına yazıyor. Oyuncu dönüp topluyor.
  //
  // NEDEN AKTİF OYNAMAKTAN KÖTÜ: verim en iyi seviyede %85. Aktif oynamak her zaman
  // kârlı; müdür "gitme cezasını" kaldırır, oyunu oynamanın yerini almaz.
  //
  // NEDEN KASA TAVANLI: tavan dolunca birikim durur. Böylece (a) oyuncunun geri dönmesi
  // için sebep kalır, (b) 200 gün uzakta kalıp tek seferde on milyon toplanamaz —
  // bu aynı zamanda sunucunun jeton kovasını (ALLOW_BURST) patlatmayı da engeller.

  /** seviye → verim (0 = müdür yok). Aktif oynamanın hep üstünde kalması BİLİNÇLİ. */
  static readonly BRANCH_MANAGER_EFF = [0, 0.45, 0.65, 0.85]
  /** seviye → şube kasası tavanı. Yüksek seviye daha uzun süre uzak kalmayı satar. */
  static readonly BRANCH_VAULT_DAYS = [0, 2, 3, 5]
  /** mutlak tavan: tek toplamada sunucunun izin verdiği sıçramanın (₺260.000) altında */
  static readonly BRANCH_VAULT_HARD = 220_000

  /** Şube kasaları: pasif şubelerin biriken net geliri (ADDITIVE save alanı). */
  branchVault: Partial<Record<LocId, number>> = {}

  /**
   * Bir şube anlık görüntüsünün müdürlü GÜNLÜK NET geliri.
   *
   * Simülasyon YOK — ekipmandan türetilir. Sebep: pasif şubeyi gerçekten simüle etmek
   * (trafik, kuyruk, fiyat) hem pahalı hem de sunucu tarafında doğrulanamaz. Ekipman
   * tablosu ise save'de duruyor ve sunucu aynı tabloyla üst sınırı hesaplayabiliyor.
   */
  branchNetPerDay(loc: LocId): { gross: number; wage: number; net: number; level: number } {
    const sn = this.locSnapshots[loc]
    const f = (sn?.f ?? {}) as Record<string, unknown>
    const num = (k: string) => { const v = f[k]; return typeof v === 'number' && isFinite(v) ? v : 0 }
    const yes = (k: string) => f[k] === true
    const level = Math.max(0, Math.min(3, Math.round(num('managerLevel'))))
    if (level <= 0) return { gross: 0, wage: 0, net: 0, level: 0 }

    // Birim başı günlük brüt (kara şubesi ölçümlerinden: pompa ~₺1.400/gün aktif oyunda)
    let gross = num('pumps') * 1400 + num('evChargers') * 900
      + num('marketLevel') * 500 + num('market2Level') * 500
      + (yes('hasRestaurant') ? 1200 : 0) + (yes('hasRestaurant2') ? 1200 : 0)
      + (yes('hasCoffee') ? 600 : 0) + (yes('hasCoffee2') ? 600 : 0)
      + (yes('hasWash') ? 700 : 0) + (yes('hasWash2') ? 700 : 0)
      + (yes('hasOil') ? 400 : 0) + (yes('hasOil2') ? 400 : 0)
      + (yes('hasTruckPark2') ? 850 : 0)
      + (yes('hasTruckPark') ? 900 : 0)
      + num('selfWashCount') * 250 + num('airWaterCount') * 120 + num('parkingCount') * 90
    // MARİNA: bağlama/kışlama pasif omurgadır, müdürsüz de mantıklı ama müdür tahsil eder
    const berths = f['berths']
    if (berths && typeof berths === 'object') {
      gross += berthIncome(berths as Record<string, number>, this.season().id, false)
    }
    if (Array.isArray(f['marinaFacs'])) gross += (f['marinaFacs'] as string[]).length * 800

    // şubenin kendi teması: otoyol hacimli, kasaba küçük (temanın entryBase'i ölçek verir)
    const th = THEMES[loc]
    const themeMult = th ? th.econ.entryBase / THEMES.kasaba.econ.entryBase : 1
    gross = Math.round(gross * themeMult * GameState.BRANCH_MANAGER_EFF[level] * this.prestigeMult())
    // Yovmiye: müdürün kendi maaşı + o şubede otomatiğe bağlı pompacı/şarjcı kadrosu.
    // Pasif şubede kadro sayısı snapshot'ta küme olarak duruyor (autoPumps/autoChargers).
    const staffMul = 1 + 0.35 * (Math.max(1, Math.round(num('staffLevel'))) - 1)
    const crew = (sn?.autoPumps?.length ?? 0) * POMPACI_WAGE + (sn?.autoChargers?.length ?? 0) * EV_ATTENDANT_WAGE
    // pasif şube yovmiyesi de tema çarpanına tabi (marina kadrosu pahalı)
    const wm = th?.econ.wageMult ?? 1
    const wage = Math.round((MANAGER_WAGES[level] + Math.round(crew * staffMul)) * wm)
    return { gross, wage, net: Math.max(0, gross - wage), level }
  }

  /** Şube kasası tavanı (gün sayısı × günlük net, mutlak tavanla kırpılmış) */
  branchVaultCap(loc: LocId): number {
    const d = this.branchNetPerDay(loc)
    if (d.level <= 0) return 0
    return Math.min(GameState.BRANCH_VAULT_HARD, d.net * GameState.BRANCH_VAULT_DAYS[d.level])
  }

  /**
   * Gün dönüşünde pasif şubelerin kasasını doldur. Aktif şube DAHİL DEĞİL
   * (orada gelir zaten anlık işliyor; iki kez sayılırsa anti-cheat 409 verir).
   */
  accrueBranchVaults(): { loc: LocId; added: number; full: boolean }[] {
    const out: { loc: LocId; added: number; full: boolean }[] = []
    for (const loc of this.unlockedLocs) {
      if (loc === this.activeLoc) continue
      const d = this.branchNetPerDay(loc)
      if (d.level <= 0 || d.net <= 0) continue
      const cap = this.branchVaultCap(loc)
      const cur = this.branchVault[loc] ?? 0
      const next = Math.min(cap, cur + d.net)
      const added = Math.round(next - cur)
      this.branchVault[loc] = Math.round(next)
      if (added > 0 || next >= cap) out.push({ loc, added, full: next >= cap - 1 })
    }
    return out
  }

  /** Şube kasalarını kasaya aktar. Toplanan tutarı döndürür. */
  collectBranchVaults(only?: LocId): number {
    let total = 0
    for (const [k, v] of Object.entries(this.branchVault)) {
      if (only && k !== only) continue
      const amt = Math.max(0, Math.round(Number(v) || 0))
      if (amt <= 0) continue
      total += amt
      this.branchVault[k as LocId] = 0
    }
    if (total > 0) {
      this.money += total
      this.stats.revenue += total
    }
    return total
  }

  /** Toplanmayı bekleyen toplam (HUD/ofis göstergesi) */
  branchVaultTotal(): number {
    return Object.values(this.branchVault).reduce((a, v) => a + (Number(v) || 0), 0)
  }

  // ---- ÇEVRE YOLU İMZASI: trafik ışığı + yaya müşteri (rapor §6.3) ----
  /** ışık döngüsü içindeki saniye (runtime; kaydedilmez) */
  lightT = 0
  /** yaya müşteri sayacı (runtime) */
  walkT = 0
  /** ışık şu an KIRMIZI mı — kırmızıda istasyon önü kuyruk olur, giriş şansı fırlar */
  lightRed(): boolean {
    const tl = this.theme().features?.trafficLight
    if (!tl) return false
    return this.lightT % (tl.greenSec + tl.redSec) >= tl.greenSec
  }
  /** kırmızı ışığın bitmesine kalan saniye (HUD göstergesi için) */
  lightRemaining(): number {
    const tl = this.theme().features?.trafficLight
    if (!tl) return 0
    const p = this.lightT % (tl.greenSec + tl.redSec)
    return p >= tl.greenSec ? Math.ceil(tl.greenSec + tl.redSec - p) : Math.ceil(tl.greenSec - p)
  }
  /** ışık çarpanı: kırmızıda giriş şansı ×boost (yalnız ışıklı şubelerde) */
  lightBoost(): number {
    const tl = this.theme().features?.trafficLight
    return tl && this.lightRed() ? tl.boost : 1
  }

  // ---- PRESTİJ: İSTASYONU DEVRET (lategame raporu §3b) ----
  /** Marka yıldızı geliri kalıcı çarpar (satış + kumbara). 4 yıldız = 2× gelir. */
  /** AZALAN VERİM (devir-çiftliği freni, 30 Tem): ilk 10★ +%25, 11-20★ +%10, 21★+ +%5.
   *  Erken/orta oyun birebir aynı; 40★'lık farm hesabı ×11 → ×4.5'a iner. */
  static prestigeMultFor(s: number): number {
    s = Math.max(0, s)
    return 1 + 0.25 * Math.min(s, 10) + 0.10 * Math.min(Math.max(s - 10, 0), 10) + 0.05 * Math.max(s - 20, 0)
  }
  prestigeMult(): number { return GameState.prestigeMultFor(this.brandStars) }
  /** Bir sonraki devir için gereken kurulu ekipman değeri — her yıldızda İKİYE KATLANIR
   *  (Idle Miner kalıbı: her kademe daha pahalı). Farm döngüsünü matematiksel olarak kapatır.
   *  TAVAN 8M (oyuncu raporu: tek şubenin sınırlı kalemleri ~₺1.63M — ×2 katlama bir yerde
   *  fiziksel imkânsıza dönüyordu). Eşik artık ŞİRKET GENELİ ekipmana bakar (aşağıda). */
  handoverThreshold(): number {
    // İKİ AŞAMALI EŞİK + SERT ULAŞILABİLİRLİK TAVANI (v5).
    // v3'ün ×1.35 yumuşak artışı bile fiziği aşıyordu: tek şubenin KURULABİLİR maksimum
    // ekipmanı ~₺1.4M (tüm kalemler full) — 2 şubeyle 6. yıldız ₺3.65M istiyordu, yani
    // İMKÂNSIZDI. Üstelik kilit: Otoyol 6★ ister, 6. yıldız da otoyolsuz alınamıyordu.
    // Kural: eşik hiçbir zaman "şube sayısı × ₺1.5M"i AŞAMAZ — tavana dayanınca yeni
    // şube açılana dek orada bekler (her yıldız yine devirle sıfırdan kurulum ister;
    // grind sürer, duvar sürmez).
    //
    // 30 TEM REGRESYONU GERİ ALINDI: devir-çiftliği freni olarak eklenen
    // "tavan × 1.15^overCap" tırmanışı eşiği FİZİKSEL MAKSİMUMUN ÜSTÜNE çıkarıyordu
    // (6 devir + 3 şube → ₺5,95M isterken 3 şubeye en fazla ~₺5,17M kurulabiliyor).
    // Sonuç kalıcı kilitti: 4. şube 9★ ister, 7★ alınamadığı için şube de açılamıyordu.
    // Fren artık eşikte değil ŞUBE AÇMA BEDELİNDE (bkz. branchUnlockCost) — tavanı
    // yükseltmenin tek yolu şube açmak ve o bedel her şubede artıyor.
    const locs = Math.max(1, this.unlockedLocs.length)
    const soft = 1_200_000 * locs
    // Oğuz kalibrasyonu: şube başına ₺1.5M kesin kurulabiliyor (ölçülen gerçek tavan
    // ~₺1.72M olduğu için her zaman pay kalır → eşik ulaşılamaz hale GELEMEZ).
    const reachable = BRANCH_EQUIP_CAP * locs
    let t = 250_000
    for (let i = 0; i < this.handoverCount; i++) t = t < soft ? Math.min(t * 2, Math.max(soft, t * 1.35)) : t * 1.35
    // aşağı yuvarla: yuvarlama eşiği tavanın ÜSTÜNE taşımasın
    return Math.min(reachable, 8_000_000, Math.floor(t / 10_000) * 10_000)
  }
  /** eşik ULAŞILABİLİR tavanda mı — tavan devri satış bedelini kırpar (farm freni) */
  handoverAtCap(): boolean {
    return this.handoverThreshold() >= BRANCH_EQUIP_CAP * Math.max(1, this.unlockedLocs.length)
  }
  /** ŞİRKET GENELİ kurulu ekipman: aktif şube + pasif şubelerin snapshot'taki değeri.
   *  MANTIK HATASI FİXİ: eşik tek şubeden karşılanamıyordu (maks ~1.6M sınırlı kalem);
   *  çoklu şube çağında devir doğal olarak şirket ölçeğinde — yeni şube donatmak yıldız
   *  yolunu açar. Eski snapshot'larda equipVal yok → 0 sayılır, şubeye girince güncellenir. */
  companyEquipmentValue(): number {
    let v = this.equipmentValue()
    for (const sn of Object.values(this.locSnapshots)) v += Math.max(0, Math.round(Number(sn?.equipVal) || 0))
    return v
  }
  /** Devir bedeli: ekipmanın %60'ı (yıkım iadesi %50, devir biraz daha iyi) + son 30 günün
   *  ortalama kârının 10 katı (≤100k). TAM iade DEĞİL — devir gerçek bir maliyet taşır,
   *  yoksa "kur-devret-kur" sonsuz para/yıldız farmı olur. Arsa/beton korunduğu için sayılmaz. */
  handoverValue(): number {
    const profit30 = Math.max(0, this.salesInPeriod(30) - this.fuelCostInPeriod(30) - this.wagesInPeriod(30))
    const perDay = profit30 / Math.min(30, Math.max(1, this.day))
    // TAVAN DEVRİ: satış katsayısı %60 → %30 (farm freni #3) — "bedava rebuild" kapanır,
    // normal ilerlemedeki devirler aynen %60 alır.
    const coef = this.handoverAtCap() ? 0.3 : 0.6
    return Math.round(this.equipmentValue() * coef + Math.min(100_000, perDay * 10))
  }
  /** Devir şartı: eşik ekipman + borçsuzluk (gönüllü, asla zorunlu değil). */
  canHandover(): boolean {
    return this.companyEquipmentValue() >= this.handoverThreshold() && !this.loan.active && !this.partner.active
  }
  /** Devirden sonraki büyüme önizlemesi (rapor: ZORUNLU gösterilmeli) */
  handoverPreview(): { cash: number; starsAfter: number; multAfter: number; multNow: number } {
    return {
      cash: this.handoverValue(), starsAfter: this.brandStars + 1,
      multAfter: GameState.prestigeMultFor(this.brandStars + 1), multNow: this.prestigeMult(),
    }
  }
  /** DEVRET: ekipman gider, ARSA/BETON ve marka yıldızları KALIR, kasaya devir bedeli girer. */
  handover(): { cash: number; stars: number } | null {
    if (!this.canHandover()) return null
    const cash = this.handoverValue()
    // ekipman sıfırlanır (arsa/beton, isim, başarımlar, sözleşme sayaçları korunur)
    this.pumps = 1; this.evChargers = 0; this.signLevel = 0; this.tankLevel = 0
    this.marketLevel = 0; this.market2Level = 0; this.toiletLevel = 0
    this.gridLevel = 0; this.batteryLevel = 0; this.battery = 0
    this.solarCount = 0; this.airWaterCount = 0; this.selfWashCount = 0; this.parkingCount = 0; this.lampCount = 0
    this.marinaFacs = []; this.berths = {}; this.winterSlots = 0; this.marinaViolations = 0
    this.hasDiesel = false; this.hasSMR = false; this.smrWreck = false; this.hasWash = false; this.hasOil = false
    this.hasCoffee = false; this.hasRestaurant = false; this.hasTruckPark = false
    this.wideGates = false; this.uranium = 0; this.smrWear = 0; this.solarDirt = 0
    for (const f of FUELS) { this.tankCounts[f] = 1; this.tanks[f] = 0 }
    this.brokenPumps.clear(); this.brokenChargers.clear()
    for (const f of FUELS) this.orders[f] = { pending: false, eta: 0, arrived: false, delivering: false, amount: 0 }
    this.uraniumPending = false; this.uraniumEta = 0
    this.dayStartMoney = this.money + cash // gün sonu raporu uydurma sayı göstermesin
    this.autoPumps.clear(); this.autoChargers.clear()
    this.pendingCash = {}
    this.contract = null
    this.marketingBudget = 0
    this.brandStars++
    this.handoverCount++
    this.money += cash // KASA KORUNUR (oyuncunun parası kendi); bina değeri düştüğü için servet zaten azalır
    // (6) itibar cezası gerçek olmalı: eski Math.max(3, …) düşük itibarı YÜKSELTİYORDU (aklama)
    this.reputation = Math.max(0, this.reputation - 0.5)
    return { cash, stars: this.brandStars }
  }

  // ---- B2B SÖZLEŞMELERİ (lategame raporu Katman 4a) ----
  /** Sözleşme teklifleri: gün + kapasiteye göre ölçeklenir. Şart: ilgili yakıt kapasitesi
   *  taahhüdün en az 2 katı olmalı (yoksa oyuncu kendini batırır). Deterministik değil —
   *  gün numarasından türetilir ki panel açılıp kapandıkça teklif zıplamasın. */
  /** Bir yakıtın TAHMİNİ günlük satış hacmi (L) — son 7 günün alım litresinden
   *  (orta vadede alınan ≈ satılan). İhale taahhütleri buna ölçeklenir. */
  estDailySales(f: FuelType): number {
    const s = this.day - 7
    const lit = this.fuelLog.filter(x => x.f === f && x.day > s).reduce((a, x) => a + x.liters, 0)
    return Math.round(lit / 7)
  }

  contractOffers(): Contract[] {
    const out: Contract[] = []
    const seedBase = this.day * 7919
    const rnd = (i: number) => { const x = Math.sin(seedBase + i * 1.37) * 10000; return x - Math.floor(x) }
    const TEMPLATES: { id: string; name: string; fuel: FuelType; days: number; lit: number; disc: number }[] = [
      { id: 'kargo', name: t('Kargo Filosu'), fuel: 'dizel', days: 7, lit: 900, disc: 0.90 },
      { id: 'belediye', name: t('Belediye Otobüs Filosu'), fuel: 'dizel', days: 15, lit: 1800, disc: 0.88 },
      { id: 'taksi', name: t('Taksi Durağı'), fuel: 'benzin', days: 10, lit: 700, disc: 0.92 },
      { id: 'santiye', name: t('İnşaat Şantiyesi'), fuel: 'lpg', days: 8, lit: 500, disc: 0.90 },
      { id: 'kooperatif', name: t('Tarım Kooperatifi'), fuel: 'dizel', days: 12, lit: 1300, disc: 0.89 },
    ]
    for (let i = 0; i < TEMPLATES.length; i++) {
      const tpl = TEMPLATES[i]
      const cap = this.fuelCapacity(tpl.fuel)
      // DENGE FİXİ (2 oyuncu raporu: "ihale aldım, kimse almıyor, ceza yiyorum"):
      // şablon litresi oyuncunun GERÇEK satış hızına bakmıyordu — 900L/gün dizel
      // taahhüdü kasaba hacmiyle imkânsızdı, sözleşme ceza tuzağına dönüyordu.
      // Taahhüt artık tahmini günlük satışın ~%60'ıyla SINIRLI; o yakıtı neredeyse
      // hiç satmayan oyuncuya o teklif HİÇ gösterilmez.
      const est = this.estDailySales(tpl.fuel)
      if (est < 120) continue
      const tplDaily = Math.round(tpl.lit * (0.85 + rnd(i) * 0.4) / 50) * 50
      const daily = Math.max(100, Math.min(tplDaily, Math.round(est * 0.6 / 50) * 50))
      if (cap < daily * 2) continue // kapasite şartı: taahhüdün 2 katı depo gerekir
      const pricePerL = Math.round(this.prices[tpl.fuel] * tpl.disc * 10) / 10
      const gross = daily * tpl.days * pricePerL
      out.push({
        id: `${tpl.id}-${this.day}`, name: tpl.name, fuel: tpl.fuel,
        daysTotal: tpl.days, daysLeft: tpl.days, dailyLiters: daily, pricePerL,
        bonus: Math.round(gross * 0.12 / 100) * 100,   // tamamlama primi ≈ cironun %12'si
        penalty: Math.round(daily * pricePerL * 0.9 / 100) * 100, // eksik gün cezası ≈ günlük ciro
        deliveredToday: 0, missedDays: 0,
      })
    }
    return out
  }
  /** sözleşme taahhüdüne teslim ekle — TÜM satış yolları (aktif, pompacı, offline) buradan geçer */
  addContractDelivery(f: FuelType, liters: number) {
    if (this.contract && this.contract.fuel === f && liters > 0) this.contract.deliveredToday += liters
  }
  /** sözleşmeyi imzala (aktif sözleşme varken imzalanmaz) */
  signContract(c: Contract): boolean {
    if (this.contract) return false
    this.contract = { ...c, daysLeft: c.daysTotal, deliveredToday: 0, missedDays: 0 }
    return true
  }
  /** İHALE FESHİ (2 oyuncu isteği: "iptal edemiyorum, ceza tuzağı"): tek seferlik
   *  cayma bedeli = 2 günlük ceza; itibar -0.2. Kalan günlerin cezasından her zaman ucuz. */
  cancelContract(): { fee: number } | null {
    const c = this.contract
    if (!c) return null
    const fee = Math.min(this.money, c.penalty * 2)
    this.money -= fee
    this.addRep(-0.2)
    this.contract = null
    return { fee }
  }
  /** Gün dönümünde çağrılır: taahhüdü kapat, gelir/ceza uygula, süreyi işlet.
   *  Döner: oyuncuya gösterilecek olay ('ok' | 'miss' | 'done' | 'fail') + tutar. */
  processContractDay(): { kind: 'none' | 'ok' | 'miss' | 'done' | 'fail'; amount: number; name: string } {
    const c = this.contract
    if (!c) return { kind: 'none', amount: 0, name: '' }
    // FİLO SİGORTASI (E2E kanıtı: yoğun istasyonda filo araçları kapıdan dönebiliyor
    // ve taahhüt fiziksel trafikle ASLA garanti edilemiyor): gün sonunda eksik kalan
    // litre, TANKTA YAKIT OLDUĞU SÜRECE depodan toplu filo alımıyla tamamlanır.
    // Ceza yalnız gerçek ihmalde (tank yetersiz) yazılır — "boşa zarar" imkânsız.
    {
      const short = Math.max(0, c.dailyLiters - c.deliveredToday)
      if (short > 0 && this.tanks[c.fuel] >= short) {
        this.tanks[c.fuel] -= short
        c.deliveredToday += short
      }
    }
    // TOLERANS (oyuncu raporu: "depom yeterli, yine ceza"): yuvarlamalar (₺→L çevrimi,
    // filo payları) taahhüdü 2-5 litre eksik bırakabiliyordu — %95 doluluk TAM sayılır.
    const delivered = Math.min(c.deliveredToday, c.dailyLiters)
    const target = c.dailyLiters * 0.95
    let amount = 0
    let kind: 'ok' | 'miss' = 'ok'
    if (delivered >= target) {
      amount = Math.round(c.dailyLiters * c.pricePerL * this.prestigeMult())
      this.money += amount
      this.stats.revenue += amount // ciro raporlarında görünsün (ofis: Satış & Faaliyet Kârı)
      this.salesLog.push({ day: this.day, rev: amount })
      if (this.salesLog.length > 370) this.salesLog.shift()
    } else {
      // eksik teslim: teslim edilen kadar ödeme + gün cezası
      const paid = Math.round(delivered * c.pricePerL * this.prestigeMult())
      amount = paid - c.penalty
      this.money = Math.max(0, this.money + amount)
      if (paid > 0) {
        this.stats.revenue += paid
        this.salesLog.push({ day: this.day, rev: paid })
        if (this.salesLog.length > 370) this.salesLog.shift()
      }
      c.missedDays++
      kind = 'miss'
    }
    c.deliveredToday = 0
    c.daysLeft--
    if (c.daysLeft <= 0) {
      // %25 (yukarı yuvarlı) gün kaçırıldıysa fesih. '>' + floor kombinasyonu kısa
      // sözleşmelerde fesih'i İMKANSIZ kılıyordu (kurcalanmış save ile bedava prim).
      const failed = c.missedDays >= Math.max(1, Math.ceil(c.daysTotal * 0.25))
      const name = c.name
      if (failed) { this.contractsFailed++; this.contract = null; return { kind: 'fail', amount: 0, name } }
      const bonusPaid = Math.round(c.bonus * this.prestigeMult())
      this.money += bonusPaid
      this.stats.revenue += bonusPaid
      this.contractsDone++
      this.addRep(0.3)
      this.contract = null
      return { kind: 'done', amount: c.bonus, name }
    }
    return { kind, amount, name: c.name }
  }

  /** AÇIK MÜŞTERİ SEGMENTLERİ (lategame raporu Katman 1c) — ₺/müşteri ekseni.
   *  Kilitler istasyonun gelişmişliğine bağlı; hiçbiri açık değilse talep klasik kalır
   *  (erken oyun dengesi HİÇ değişmez). Toplam pay < 1 olmalı (kalanı standart müşteri). */
  activeSegments(): CarSegment[] {
    const out: CarSegment[] = []
    // Premium yakıt: dolu tank + iyi itibar → yüksek tutar, YÜKSEK MARJ
    if (this.tankLevel >= 3 && this.reputation >= 4.3) {
      out.push({ id: 'premium', share: 0.18, min: 300, max: 600, marginMult: 1.6, label: t('Premium yakıt müşterisi') })
    }
    // Filo/TIR: tır parkı + güçlü dizel kapasitesi → çok yüksek hacim, normal marj
    if (this.hasTruckPark && this.tankCounts.dizel >= 2) {
      out.push({ id: 'filo', share: 0.55, min: 800, max: 2000, marginMult: 1, fuel: 'dizel', truckOnly: true, label: t('Filo aracı') })
    }
    // Otobüs/servis: geniş kapı + 6+ pompa (akış planlaması gerektirir)
    if (this.wideGates && this.pumps >= 6) {
      out.push({ id: 'otobus', share: 0.10, min: 1200, max: 2500, marginMult: 1, fuel: 'dizel', truckOnly: true, label: t('Servis / otobüs') })
    }
    return out
  }

  /** Reklam bütçesi → 0..1 etki (azalan verim). Trafik ARZI ve talebe birlikte etkir
   *  (lategame raporu #2: parayı doğrudan talebe çeviren, sınırsız-anlamlı sink). */
  marketingFactor(): number {
    return 1 - Math.exp(-Math.max(0, this.marketingBudget) / 3500)
  }
  /** yol trafiği arz çarpanı: tabela + reklam (1.0 .. ~2.0) — cars spawn aralığını böler */
  trafficPull(): number {
    return 1 + 0.15 * this.signLevel + 0.6 * this.marketingFactor()
  }

  /** Varlığa bağlı işletme gideri (lategame raporu #3): amortisman + emlak vergisi.
   *  Yovmiye AYRI kalemde kalır (çifte sayım yok); şebeke faturası canlı kesiliyor.
   *  opexStart'tan itibaren 10 günde %0→%100 rampalanır (enflasyon şoku yok). */
  dailyOpex(): number {
    const ramp = Math.min(1, Math.max(0, (this.day - this.opexStart) / 10))
    if (ramp <= 0) return 0
    return Math.round(0.002 * (this.equipmentValue() + this.landValue()) * ramp) + this.insuranceDaily()
  }
  /** kurulu ekipman+tesis alış değeri (sunucu buildingValue ile aynı felsefe, istemce tablolarından) */
  equipmentValue(): number {
    const sum = (arr: number[], k: number) => arr.slice(0, Math.max(0, Math.min(arr.length, Math.floor(k) || 0))).reduce((a, b) => a + b, 0)
    let v = 0
    v += sum(PUMP_COSTS, this.pumps)
    v += sum(SIGN_COSTS, this.signLevel) + sum(TANK_COSTS, this.tankLevel)
    v += sum(MARKET_COSTS, this.marketLevel) + sum(MARKET_COSTS, this.market2Level)
    v += sum(TOILET_COSTS, this.toiletLevel) + sum(GRID_COSTS, this.gridLevel)
    v += sum(BATTERY_COSTS, this.batteryLevel) + sum(EV_COSTS, this.evChargers)
    for (const f of FUELS) v += sum(TANK_ADD_COSTS, this.tankCounts[f])
    v += SOLAR_COST * this.solarCount + AIRWATER_COST * this.airWaterCount
    v += SELFWASH_COST * this.selfWashCount + PARKING_COST * this.parkingCount
    if (this.hasDiesel) v += DIESELGEN_COST
    if (this.hasSMR) v += SMR_COST
    if (this.hasWash) v += WASH_COST
    if (this.hasOil) v += OIL_COST
    v += LAMP_COST * this.lampCount
    v += this.marinaValue()
    if (this.hasCoffee) v += COFFEE_COST
    if (this.hasRestaurant) v += RESTAURANT_COST
    if (this.hasTruckPark) v += TRUCKPARK_COST
    if (this.wideGates) v += WIDEGATE_COST
    return v
  }
  /** sahip olunan arsaların taban değeri (düşük tahmin — vergi matrahı) */
  landValue(): number {
    return this.ownedParcels.size * LAND_COST + this.pavedParcels.size * PAVE_COST
  }

  /** Sipariş miktar çarpanı (× ORDER_STEP litre parti). 1 = minimum; + ile full'e kadar step. */
  // Varsayılan 999 = "FULL doldur" (orderNeed zaten boşlukla min'ler).
  // Adım 800L'ydi — başlangıç tankı (800L) için maks çarpan 1 çıkıyor, −/+ HİÇBİR ŞEY
  // yapmıyordu ("butonlar çalışmıyor" şikâyeti, 7 feedback). 200L adım: min tankta 4 kademe,
  // erken oyuncu parası kadar yakıt alabilir (kısmi siparişin asıl amacı).
  orderQty: Record<FuelType, number> = { benzin: 999, dizel: 999, lpg: 999 }
  orderMaxQty(f: FuelType) { return Math.max(1, Math.ceil((this.fuelCapacity(f) - this.tanks[f]) / ORDER_STEP)) }
  adjustOrderQty(f: FuelType, d: number) {
    const cur = Math.min(this.orderQty[f], this.orderMaxQty(f)) // 999 sentinelini önce gerçek maks'a indir (ilk − tıklaması ölü olmasın)
    this.orderQty[f] = Math.min(this.orderMaxQty(f), Math.max(1, cur + d))
  }
  /** elle litre girişi (B4 — 10 istek): litre → 200L partiye yuvarlanır, MAX ile sınırlanır */
  setOrderLiters(f: FuelType, liters: number) {
    if (!isFinite(liters)) return
    this.orderQty[f] = Math.min(this.orderMaxQty(f), Math.max(1, Math.round(liters / ORDER_STEP)))
  }
  /** Sipariş miktarı = çarpan × 800L; kalan boşluk VE cüzdanla capli.
   *  Bütçe-fit: FULL doldurma parası yetmiyorsa miktar otomatik paranın yettiğine iner —
   *  büyük tanklı oyuncu 'tanker çağıramıyor' kalmaz (buton asla salt fiyat yüzünden kilitlenmez). */
  orderNeed(f: FuelType) {
    const disc = this.promo?.type === 'cheapFuel' ? 0.5 : 1
    const affordable = Math.max(0, Math.floor(this.money / (this.buyPrice(f) * disc)) - 1) // -1: ceil yuvarlaması para üstüne çıkmasın
    return Math.floor(Math.max(0, Math.min(this.orderQty[f] * ORDER_STEP, this.fuelCapacity(f) - this.tanks[f], affordable)))
  }
  orderCost(f: FuelType) {
    const disc = this.promo?.type === 'cheapFuel' ? 0.5 : 1
    return Math.ceil(this.orderNeed(f) * this.buyPrice(f) * disc) // piyasa fiyatı (Katman 4b)
  }

  canOrder(f: FuelType) {
    const o = this.orders[f]
    return !o.pending && !o.arrived && !o.delivering && this.orderNeed(f) >= 100 && this.money >= this.orderCost(f)
  }

  placeOrder(f: FuelType) {
    if (!this.canOrder(f)) return false
    // KRİTİK: need/cost parayı düşmeden ÖNCE ve BİR KEZ hesaplanır. (Bug: para düştükten
    // sonra orderNeed yeniden çağrılıyordu → bütçe-fit cap yüzünden amount ~0'a iniyordu;
    // 'param gitti ama yakıt gelmedi' şikayetinin kökü.)
    const need = this.orderNeed(f)
    const cost = this.orderCost(f)
    this.money -= cost
    this.fuelSpent += cost // muhasebe
    this.fuelLog.push({ day: this.day, f, liters: need, cost })
    if (this.fuelLog.length > 40) this.fuelLog.shift()
    this.orders[f].pending = true
    this.orders[f].eta = ORDER_ETA
    this.orders[f].amount = need // teslimatta bu kadar eklenecek (parti miktarı)
    return true
  }

  deliverFuel(f: FuelType) {
    // sipariş edilen partiyi ekle (tam doldurma değil); kapasiteyi aşma.
    // EXPLOIT FİXİ: eski `|| this.orderNeed(f)` fallback'i, amount'u kaybolmuş
    // (eski kayıt / şube değişimi) siparişlerde AKTİF şubenin TÜM ihtiyacını
    // BEDAVA dolduruyordu — küçük şubede 4k öde, ana şubede 20k litre al.
    // Ödenmemiş litre eklenmez: amount yoksa teslimat boş kapanır.
    const add = Math.max(0, this.orders[f].amount || 0)
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
  dailyWages(): number {
    // eğitimli personel daha pahalı (her seviye +%35), müdür ayrı kalem.
    // MARİNA (Oğuz): yovmiye çarpanı 1.6 — defter inceleyen ehliyetli kadro pahalı,
    // şubeyi çevirmek karada olduğu kadar kolay değil.
    const staffMul = 1 + 0.35 * (this.staffLevel - 1)
    const wm = this.theme().econ.wageMult ?? 1
    return Math.round((Math.round((this.autoPumps.size * POMPACI_WAGE + this.autoChargers.size * EV_ATTENDANT_WAGE) * staffMul)
      + MANAGER_WAGES[Math.min(3, this.managerLevel)]) * wm)
  }
  /** EKİPMAN YAŞLANMASI: yıpranma arttıkça verim düşer (%100'de -%40) */
  wearEfficiency(): number { return 1 - 0.4 * Math.min(1, Math.max(0, this.wear)) }
  /** yenileme bedeli: ekipman değerinin %60'ı × yıpranma */
  renewCost(): number { return Math.round(this.equipmentValue() * RENEW_RATIO * Math.min(1, this.wear)) }
  /** ekipmanı yenile (yıpranma sıfırlanır) */
  renewEquipment(): number | null {
    const c = this.renewCost()
    if (c <= 0 || this.money < c) return null
    this.money -= c; this.wear = 0
    return c
  }
  /** sigortalıysa hasar/ceza yarıya iner (rapor 2b) */
  damageMult(): number { return this.insurance ? 0.5 : 1 }
  /** SİGORTA günlük primi (varlığa bağlı) */
  insuranceDaily(): number { return this.insurance ? Math.round((this.equipmentValue() + this.landValue()) * INSURANCE_DAILY) : 0 }
  /** RUHSAT bedeli (30 günde bir, varlıkla ölçekli) */
  licenseFee(): number { return Math.round(8_000 + (this.equipmentValue() + this.landValue()) * 0.004) }
  /** dekorasyonun itibar katkısı */
  decorRep(): number { return 0.15 * this.decorLevel + Math.min(0.30, 0.04 * this.lampCount) }

  // ---- AI RAKİP İSTASYON (Katman 4d) ----
  /** Rakip bu şubede olabilir mi? Kasabada ASLA (müdavim/itibar kimliği bozulmasın),
   *  ve yalnız oyuncu ikinci şubeyi açtıktan sonra (rapor: Katman 1-3 bitmeden başlama). */
  rivalAllowed(): boolean {
    return this.activeLoc !== 'kasaba' && this.unlockedLocs.length >= 2
  }
  rivalKind() { return rivalKindFor(this.activeLoc) }
  /** rakibin etkisi ne kadar devrede (0..1) — arayüzde "yerleşiyor" göstergesi */
  rivalRamp() { return this.rival ? rivalRamp(this.rival, this.day) : 0 }
  rivalName() { return RIVAL_NAME[this.rivalKind()] }

  /** Oyuncunun SADIK TABANI: müdavim payı + itibar. Rakip bunun altına indiremez. */
  private loyaltyFloor(): number {
    return Math.min(0.45, this.regularsShare() + 0.04 * Math.max(0, this.reputation - 3))
  }
  /** Oyuncunun çekiciliği 0..1 — tesis/tabela/itibar bileşkesi (rakibin strength'iyle kıyaslanır) */
  private myAppeal(): number {
    const c = 0.08 * this.signLevel + 0.06 * this.marketLevel + 0.04 * this.evChargers / 3
      + 0.06 * Math.max(0, this.reputation - 3) + (this.hasWash ? 0.04 : 0) + (this.hasRestaurant ? 0.05 : 0)
      + 0.10 * this.marketingFactor()
    return Math.max(0.1, Math.min(0.95, 0.35 + c))
  }
  /** ortalama satış fiyatım (rakiple kıyas için) */
  private avgPrice(): number {
    const f = FUELS
    return f.reduce((a, x) => a + this.prices[x], 0) / f.length
  }

  /** Pazar payım (0..1). Rakip yoksa 1. */
  marketShare(): number {
    if (!this.rival) return 1
    return marketShare(this.avgPrice(), this.rival, this.loyaltyFloor(), this.myAppeal())
  }

  /** Gün dönüşü: rakip tepki verir. Dönen mesaj varsa oyuncuya gösterilir. */
  rivalDayTurn(): string {
    if (!this.rival) {
      // koşullar oluştuysa rakip SAHNEYE ÇIKAR (bir kez)
      if (this.rivalAllowed()) {
        this.rival = freshRival(this.avgPrice(), this.day)
        return t('Yol karşısına {0} açıldı — artık fiyat bir MÜZAKERE. Pazar payını ofisten izle.', this.rivalName())
      }
      return ''
    }
    if (this.rival.promoDays > 0) this.rival.promoDays--
    const share = this.marketShare()
    const floor = FUELS.reduce((a, x) => a + this.buyPrice(x), 0) / FUELS.length
    const mv = rivalDecide(this.rival, this.rivalKind(), this.day, this.avgPrice(), share, floor)
    this.rival.price = mv.price
    this.rival.promoDays = mv.promoDays
    this.rival.strength = updateStrength(this.rival, share)
    this.rival.lastDay = this.day
    return mv.msg
  }

  // ---- MARİNA (rapor §6.5) ----
  /** bu şube marina mı (tema su ise) */
  get isMarina() { return this.theme().lane.kind === 'water' }
  hasMarinaFac(id: MarinaFacId) { return this.marinaFacs.includes(id) }

  /** MAVİ BAYRAK: tüm çevre hizmetleri kurulu + sicil temiz. İtibar +0.5, süperyat kilidi,
   *  denetim sıklığı yarı, marina ücretine %15 prim. */
  blueFlag() { return blueFlagStatus(new Set(this.marinaFacs), this.marinaViolations) }

  /** Marinaya gelen tekne segmentleri — tesis kısıtlarına göre süzülür (rapor §6.5.4).
   *  Süperyat YALNIZ Mavi Bayrak varsa, gulet duş/çamaşırhane varsa gelir. */
  /**
   * Şu an gelebilecek tekne sınıfları.
   *
   * BUG DÜZELTMESİ (Oğuz: "hiç yanaşan tekne görmedim"): eskiden koşul
   * `!hasMarinaFac('fueldock')` ise BOŞ liste dönüyordu. cars.ts tarafında
   * `if (!boatSeg && waterOnly) return` olduğu için ₺5.000.000 ödeyip marinayı açan
   * oyuncu, ₺180.000'lik yakıt iskelesini de kurana kadar TAMAMEN ÖLÜ bir şube
   * görüyordu — hiçbir uyarı da yoktu.
   *
   * Yeni kural: küçük tekneler (jet ski / sürat / balıkçı) rıhtıma yan yanaşıp
   * istasyonun kendi pompasından yakıt alır → şube ilk günden çalışır. Yakıt iskelesi
   * artık "çalıştırma şartı" değil, BÜYÜK TEKNE KİLİDİ: yelkenli, gulet, motoryat ve
   * süperyat yalnız iskele varken gelir. Yatırımın değeri korunuyor, ölü şube bitiyor.
   */
  boatSegments(): BoatSegment[] {
    if (!this.isMarina) return []
    const dock = this.hasMarinaFac('fueldock')
    const bf = this.blueFlag().ok
    return BOAT_SEGMENTS.filter(s =>
      (!s.needsFuelDock || dock)
      && (!s.needsBlueFlag || bf)
      && (!s.needsShower || this.hasMarinaFac('shower')))
  }

  /** Tekne segmentlerini araç segmenti biçimine çevir — TUTAR buradan geçer.
   *  cars.ts hem modeli hem parayı bu listeden alır; ayrışırsa süperyat araba
   *  parası öder (bu bug oyunda vardı ve marinanın gerekçesini yok ediyordu).
   *  marginMult: BoatSegment.margin oranı 0.30'a normalize edilir → balıkçının
   *  ÖTV'siz düşük marjı (0.12 → 0.40×), sürat teknesinin yüksek marjı (0.38 → 1.27×). */
  boatCarSegments(): CarSegment[] {
    return this.boatSegments().map(b => ({
      id: b.id,
      share: b.share,
      min: b.min,
      max: b.max,
      marginMult: Math.round((b.margin / 0.30) * 100) / 100,
      // Deniz motorini: balıkçı ÖTV defteri dizel üzerinden işliyor
      ...(b.id === 'balikci' || b.id === 'gulet' || b.id === 'motoryat' || b.id === 'superyat'
          ? { fuel: 'dizel' as FuelType } : {}),
      label: b.label,
    }))
  }

  /** Bağlama + kışlama günlük geliri (pasif omurga). Gün dönüşünde kasaya eklenir. */
  marinaDailyIncome(): { berth: number; winter: number; total: number } {
    if (!this.isMarina) return { berth: 0, winter: 0, total: 0 }
    const sid = this.season().id
    const berth = berthIncome(this.berths, sid, this.blueFlag().ok)
    const winter = winterStorageIncome(this.winterSlots, sid, this.hasMarinaFac('travelift'))
    return { berth, winter, total: berth + winter }
  }

  /** Günlük risk olayı (determinist). Kalıcı silme YOK — para/itibar/bayrak, hepsi telafi edilebilir. */
  marinaDayEvent() {
    if (!this.isMarina) return null
    return pickMarinaEvent(this.day, this.season().id, new Set(this.marinaFacs), this.blueFlag().ok)
  }

  /** Marina yatırımlarının varlık değeri — sunucu servet tavanıyla senkron tutulmalı */
  marinaValue(): number {
    let v = 0
    for (const f of this.marinaFacs) v += (MARINA_FACILITIES as Record<string, { cost: number }>)[f]?.cost ?? 0
    for (const [k, n] of Object.entries(this.berths)) v += (BERTH_KINDS[k as BerthKind]?.cost ?? 0) * n
    v += this.winterSlots * 8_000
    return v
  }

  /** personel eğitimi etkileri (rapor §7 #7): dolum hızı, bahşiş, hata riski */
  staffFillMult(): number { return 1 + 0.12 * (this.staffLevel - 1) }   // Sv.4 → +%36 hız
  /** pompa donanım hızı çarpanı (personel çarpanıyla ÇARPILARAK uygulanır) */
  pumpSpeedMult(): number { return PUMPSPEED_MULT[Math.max(0, Math.min(3, this.pumpSpeedLevel))] }
  staffTipBonus(): number { return 0.05 * (this.staffLevel - 1) }        // bahşiş oranına eklenir

  /** MÜDAVİM BAHŞİŞİ (§6.2): kasabada tanıdık esnafa cömert davranılır. Müşterilerin
   *  müdavim payı kadar, o şubenin `tip` çarpanı bahşişe yansır — beklenen değer olarak
   *  uygulanır (araç bazında "müdavim mi" durumu tutmaya gerek kalmaz, save'e alan eklenmez). */
  regularsTipMult(): number {
    const r = this.theme().features?.regulars
    if (!r) return 1
    const sh = this.regularsShare()
    return 1 + (r.tip - 1) * sh
  }
  staffErrorMult(): number { return Math.max(0.25, 1 - 0.25 * (this.staffLevel - 1)) } // arıza/hata riski

  /** MÜDÜR TURU: seviyeye göre kumbara toplar, panel temizler, arıza tamir eder.
   *  Dönen liste oyuncuya rapor edilir (toast). tick()'ten çağrılır. */
  managerTick(dt: number): { collected: number; cleaned: boolean; fixed: number; ordered: number } | null {
    if (this.managerLevel <= 0) return null
    this.managerT += dt
    if (this.managerT < 45) return null // 45 sn'de bir tur (gün ≈ 160 sn)
    this.managerT = 0
    let collected = 0
    for (const id of Object.keys(this.pendingCash)) collected += this.collectPending(id)
    // YAKIT SİPARİŞİ (Oğuz: "müdür yakıt siparişini versin") — Sv.1'den itibaren:
    // tank %20'nin altına düşen her yakıt için sipariş verir (bütçe elveriyorsa)
    let ordered = 0
    for (const f of FUELS) {
      if (this.tanks[f] < this.fuelCapacity(f) * 0.20 && this.canOrder(f)) {
        if (this.placeOrder(f)) ordered++
      }
    }
    // Sv.3 FIRSATÇILIK (Oğuz: "yüksek seviye müdür yakıt indirimini kullanabilsin"):
    // %50 alış indirimi sürerken beklemez — %80 doluluğun altındaki her tankı fulller
    if (this.managerLevel >= 3 && this.promo?.type === 'cheapFuel') {
      for (const f of FUELS) {
        if (this.tanks[f] < this.fuelCapacity(f) * 0.80 && this.canOrder(f)) {
          if (this.placeOrder(f)) ordered++
        }
      }
    }
    let cleaned = false
    if (this.managerLevel >= 2 && this.hasSolar && this.solarDirt > 0.35 && this.money >= 300) {
      this.money -= 300; this.solarDirt = 0; this.maintCare = Math.min(1, this.maintCare + 0.1); cleaned = true
    }
    let fixed = 0
    if (this.managerLevel >= 3) {
      for (const i of [...this.brokenPumps]) {
        if (this.money < 800) break
        this.money -= 800; this.brokenPumps.delete(i); fixed++
      }
      for (const i of [...this.brokenChargers]) {
        if (this.money < 1000) break
        this.money -= 1000; this.brokenChargers.delete(i); fixed++
      }
      // REAKTÖR BAKIMI (oyuncu: "Sv.3 müdürüm varken reaktör patladı") — müdür pompa
      // tamir edip reaktöre bakmıyordu. %50 yıpranmada bakımı öder, patlama yaşanmaz.
      if (this.hasSMR && this.smrWear >= 0.5 && this.money >= 1500) {
        this.money -= 1500; this.smrWear = 0; fixed++
      }
    }
    return (collected > 0 || cleaned || fixed > 0 || ordered > 0) ? { collected, cleaned, fixed, ordered } : null
  }
  /** müdürü işten çıkar (Oğuz: oyuncular istiyor) — tazminat yok, yovmiye anında kesilir */
  fireManager(): boolean {
    if (this.managerLevel <= 0) return false
    this.managerLevel = 0
    return true
  }
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
    // YUVARLAK KARŞILAŞTIRMA (oyuncu raporu "bakiye olmasına rağmen çekmiyor bazen"):
    // kasa küsuratlı birikiyor; ekran ₺120.000 gösterirken gerçek 119.999,6 olabiliyor
    // ve ödeme görünmez kuruş farkıyla reddediliyordu.
    const payoff = this.loanPayoff()
    if (!this.loan.active || Math.round(this.money) < Math.round(payoff)) return false
    this.money = Math.max(0, this.money - payoff)
    this.loan = { active: false, principal: 0, monthly: 0, remaining: 0, overdue: 0, collateral: [], rate: LOAN_RATE }
    return true
  }
  /** her oyun günü çağrılır: taksiti kasadan tahsil et; üst üste 2 gecikme + para yetmezse 'seize' (haczi/ortaklığı çağıran yapar) */
  processLoanDay(): 'done' | 'seize' | 'warn' | 'ok' | null {
    const l = this.loan
    if (!l.active) return null
    l.overdue += 1
    // 0,5₺ tolerans: küsuratlı kasa görünür bakiye yeterken taksidi düşürmüyordu
    while (l.overdue > 0 && l.remaining > 0 && this.money >= l.monthly - 0.5) {
      this.money = Math.max(0, this.money - l.monthly); l.remaining -= 1; l.overdue -= 1
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
    if (!this.partner.active || Math.round(this.money) < Math.round(this.partner.remaining)) return false
    this.money = Math.max(0, this.money - this.partner.remaining)
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
      case 'market2': return 600 * Math.max(1, this.market2Level)                        // karşı market — aynı ölçek
      case 'toilet2': return 500 * Math.max(1, this.toilet2Level)
      case 'wash2': return 700
      case 'oil2': return 1000
      case 'coffee2': return 500
      case 'restaurant2': return 1200
      case 'toilet': return 500 * Math.max(1, this.toiletLevel)                          // seviyeyle büyür
      case 'selfwash': return 400 * Math.min(5, Math.max(1, this.selfWashCount))
      case 'airwater': return 250 * Math.min(6, Math.max(1, this.airWaterCount))
      case 'parking': return 300 * Math.min(6, Math.max(1, this.parkingCount))
      case 'truckpark': return 1200   // pasif yüksek kazanan
      case 'truckpark2': return 1200
      case 'restaurant': return 1200  // ₺80-160/ziyaret
      case 'oil': return 1000         // ₺150-250/servis
      case 'wash': return 700         // ₺60-120/yıkama
      case 'coffee': return 500       // düşük getiri
      default: return 600
    }
  }

  /** TAŞMA KAYBI — bu turda kumbara tavanı yüzünden eriyen ciro (gün sonu raporunda gösterilir) */
  facLost: Record<string, number> = {}

  /** Kumbaraya para biriktir.
   *
   *  #193 "restoran cirosu 0" / #423 "market kasaya eklemiyor" KÖK NEDENİ: eskiden tavanı
   *  aşan ciro `Math.min(cap, ...)` ile SESSİZCE siliniyordu. Ofis raporu (facDaily) tam
   *  tutarı yazdığı için oyuncu "ciro var ama para yok" görüyordu — haklı olarak bug diyordu.
   *
   *  Yeni davranış: tavana kadar %100, tavanın üstünde %40 verimle DEVAM eder (sert tavan
   *  3× cap). Yani hiçbir şey tamamen buharlaşmaz ama ihmal etmek yine cezalı — müdür
   *  otomasyonu (§7 #5) ve sık toplama değerini korur. Kayıp artık GÖRÜNÜR. */
  addPending(id: string, amt: number, name: string) {
    this.facDaily[id] = (this.facDaily[id] ?? 0) + amt
    this.facTotal[id] = (this.facTotal[id] ?? 0) + amt
    const cap = this.pendingCap(id)
    const hard = cap * 3
    const cur = this.pendingCash[id] ?? 0
    // tavana kadar tam, sonrası kısılmış verim
    const toFull = Math.max(0, cap - cur)
    const full = Math.min(amt, toFull)
    const over = amt - full
    const next = Math.min(hard, cur + full + over * 0.4)
    const gained = next - cur
    if (amt - gained >= 1) this.facLost[id] = (this.facLost[id] ?? 0) + (amt - gained)
    this.pendingCash[id] = next
    if (cur < cap && next >= cap) {
      this.events.push(t('{0} kumbarası doldu — tıklayıp topla, yoksa ciro erimeye başlar!', name))
    } else if (cur >= hard - 1 && amt > 0) {
      this.events.push(t('{0} kumbarası TIKA BASA dolu — gelen ciro kayboluyor!', name))
    }
  }

  /** gün sonu raporu için: tavan yüzünden eriyen toplam ciro */
  lostTotal(): number { return Object.values(this.facLost).reduce((a, v) => a + (v || 0), 0) }

  collectPending(id: string): number {
    // Prestij çarpanı TOPLAMA anında uygulanır — biriktirme sırasında uygulanınca kumbara
    // cap'i fazlayı çöpe atıyordu (yıldızın kumbara gelirine etkisi sıfır kalıyordu).
    const amt = Math.round((this.pendingCash[id] ?? 0) * this.prestigeMult())
    if (amt > 0) {
      this.money += amt
      delete this.pendingCash[id]
      delete this.facLost[id]
    }
    return amt
  }

  // ---- Ofis muhasebe yardımcıları ----
  /** kurulu tesislerin toplam kumbara kapasitesi — müdür kilidinin ölçütü */
  pendingCapTotal(): number {
    let v = 0
    for (const id of ['market', 'market2', 'toilet', 'toilet2', 'wash', 'wash2', 'oil', 'oil2',
      'coffee', 'coffee2', 'restaurant', 'restaurant2', 'truckpark', 'truckpark2', 'selfwash', 'airwater', 'parking']) {
      const has = (id === 'market' && this.marketLevel > 0) || (id === 'market2' && this.market2Level > 0)
        || (id === 'toilet' && this.toiletLevel > 0) || (id === 'toilet2' && this.toilet2Level > 0)
        || (id === 'wash' && this.hasWash) || (id === 'wash2' && this.hasWash2)
        || (id === 'oil' && this.hasOil) || (id === 'oil2' && this.hasOil2)
        || (id === 'coffee' && this.hasCoffee) || (id === 'coffee2' && this.hasCoffee2)
        || (id === 'restaurant' && this.hasRestaurant) || (id === 'restaurant2' && this.hasRestaurant2)
        || (id === 'truckpark' && this.hasTruckPark) || (id === 'truckpark2' && this.hasTruckPark2) || (id === 'selfwash' && this.selfWashCount > 0)
        || (id === 'airwater' && this.airWaterCount > 0) || (id === 'parking' && this.parkingCount > 0)
      if (has) v += this.pendingCap(id)
    }
    return v
  }

  private pendingTotal(): number { return Object.values(this.pendingCash).reduce((a, v) => a + (v || 0), 0) }
  /** İŞLETME SERMAYESİ (Oğuz tanımı): tanktaki akaryakıtın SATIŞ fiyatıyla değeri —
   *  stok, satılınca kasaya dönecek para olarak okunur */
  workingCapital(): number { return FUELS.reduce((a, f) => a + this.tanks[f] * this.prices[f], 0) }
  /** AKTİF (Oğuz tanımı): kasa + işletme sermayesi + inşaattan elde edilenler (kurulu ekipman) */
  assets(): number { return this.money + this.workingCapital() + this.equipmentValue() }
  /** (eski gösterge — panelde artık kullanılmıyor, banka tarafı için duruyor) */
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

  // ---- İTİBAR MUTABAKATI (#456 + #216-4: "itibar 5.0'a çıkıyor, ne olursa olsun düşmüyor") ----
  // KÖK NEDEN: itibar ömür boyu BİRİKİMDİ. Servis edilen her müşteri +0.06..+0.14 veriyor,
  // kaybedilen -0.2; yüzlerce servise karşı birkaç kayıp olunca değer 5.0'a çakılıp donuyordu.
  // ÇÖZÜM: her gün sonunda itibar, O GÜNÜN hizmet kalitesine doğru çekilir. Artık 5.0'da
  // kalmak için kayıpsız gün gerekir; istasyonu ihmal etmek itibarı gerçekten düşürür.
  private repMark = { served: 0, lost: 0 }
  /** son mutabakatın yönü — arayüzde ok göstermek için (+1 arttı, -1 düştü, 0 sabit) */
  repTrend = 0

  /** gün dönüşünde çağrılır: itibarı günün hizmet kalitesine yaklaştırır (en çok ±0.30/gün) */
  reconcileReputation(): { target: number; delta: number } {
    const served = this.stats.served - this.repMark.served
    const lost = this.stats.lost - this.repMark.lost
    this.repMark = { served: this.stats.served, lost: this.stats.lost }
    const total = served + lost
    let target: number
    if (total < 3) {
      // Neredeyse hiç müşteri görmeyen gün: unutulma. İtibar yavaşça 3.0'a doğru aşınır.
      target = 3.0
    } else {
      // Kayıp oranı tek ölçüt: kayıpsız gün 5.0, %10 kayıp ~4.3, %25 kayıp ~3.1, %50+ kayıp 1.5
      target = Math.max(1, 5 - (lost / total) * 7)
    }
    const raw = (target - this.reputation) * 0.35
    const delta = Math.max(-0.30, Math.min(0.30, raw)) // şok yok: mevcut save'ler kademeli oturur
    const before = this.reputation
    this.addRep(delta)
    this.repTrend = this.reputation > before + 0.004 ? 1 : this.reputation < before - 0.004 ? -1 : 0
    return { target, delta: this.reputation - before }
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

/** Marina tesis açıklamaları — mağazada ne işe yaradığı görünsün (rapor §6.5.3) */
const MARINA_DESC: Record<string, string> = {
  fueldock: t('YAKIT SATIŞ İZNİ + iskele dolum donanımı. Marinanın ilk yatırımı: bunu kurmadan tekne gelmez, tank/pompa/market kilitli kalır. Bir kez kurulur.'),
  chandlery: t('Halat, can yeleği, olta, harita. Marketin deniz muadili — sepet tutarı 3 katı.'),
  shower: t('Duş & çamaşırhane. Gulet mürettebatı için ZORUNLU — yoksa gulet uğramaz.'),
  clubhouse: t('Yat kulübü / sahil restoranı. Akşam saatlerinde zirve yapar.'),
  icebait: t('Buz & yem. Sabah balıkçı akınında talep patlar.'),
  travelift: t('Tekne asansörü. Karaya çekme-indirme ve KARADA KIŞLAMA gelirinin kilidi.'),
  pumpout: t('Atık su tahliyesi. Kurmazsan tekneler denize basar, ceza SANA yazılır.'),
  wasteoil: t('Atık yağ toplama. Çevre denetiminde aranır.'),
  boom: t('Yakıt sızıntı bariyeri. Sızıntı olayını TAMAMEN önler.'),
}

export function getShopItems(s: GameState): ShopRow[] {
  const rows: ShopRow[] = []
  const row = (id: string, icon: string, title: string, stat: string, desc: string,
               cost: number | null, locked: string | null) => {
    if (cost === null) rows.push({ id, icon, title, desc, stat, cost: null, status: 'maxed', note: t('MAKS') })
    else if (locked) rows.push({ id, icon, title, desc, stat, cost, status: 'locked', note: locked })
    else rows.push({ id, icon, title, desc, stat, cost, status: 'buy', note: '' })
  }
  // MARİNA ŞUBESİ: kara tesisleri yerine deniz kataloğu (rapor §6.5.3). Kara şubelerinde
  // bu blok hiç çalışmaz — mevcut mağaza birebir aynı kalır.
  if (s.isMarina) {
    for (const [id, f] of Object.entries(MARINA_FACILITIES)) {
      const owned = s.hasMarinaFac(id as MarinaFacId)
      const envNote = f.env ? t('Mavi Bayrak şartı') : ''
      row(id, f.env ? 'i-star' : 'i-market', f.label,
        owned ? t('KURULU') : `₺${f.cost.toLocaleString('tr-TR')}`,
        MARINA_DESC[id] ?? envNote, owned ? null : f.cost,
        id === 'fueldock' || s.hasMarinaFac('fueldock') ? null : t('Önce Yakıt İskelesi kur'))
    }
    for (const [id, b] of Object.entries(BERTH_KINDS)) {
      const n = s.berths[id] ?? 0
      row('berth_' + id, 'i-parking', n ? t('{0} ({1})', b.label, String(n)) : b.label,
        t('+₺{0}/gün', b.daily.toLocaleString('tr-TR')),
        t('Bağlama yeri kirala — tekne boyuna göre yer, mevsimlik doluluk.'),
        b.cost, id === 'mega' && !s.blueFlag().ok ? t('Mavi Bayrak gerekli') : null)
    }
    row('winterslot', 'i-parking', s.winterSlots ? t('Karada Kışlama ({0})', String(s.winterSlots)) : t('Karada Kışlama'),
      t('+₺900/gün (kışın)'), t('Tekneyi karaya çek, kışı geçirsin — kışın en büyük gelir kalemi.'),
      8_000, s.hasMarinaFac('travelift') ? null : t('Önce Travel Lift kur'))
    // 2. POMPA (Oğuz: "2 tane pompaya izin verelim marinada") — iskele boyu sınırlı: maks 2
    row('pump', 'i-fuel', t('İskele Pompası #{0}', Math.min(s.pumps + 1, 2)), t('+1 pompa'),
      t('İskeleye ikinci dolum noktası — aynı anda iki tekne alırsın.'),
      s.pumps >= 2 ? null : PUMP_COSTS[s.pumps],
      s.hasMarinaFac('fueldock') ? null : t('Önce Yakıt İskelesi kur'))
    // DEPO (Oğuz: "marinada tanka tıklayıp seviye artırılabilmeli") — kara ile aynı
    row('tank', 'i-tank', t('Yakıt Tankı'), s.tankLevel >= 3 ? `${TANK_CAPACITY[3]}L` : `${TANK_CAPACITY[s.tankLevel + 1]}L`,
      t('Depo büyür (tüm yakıtlar), daha seyrek sipariş verirsin'),
      s.tankLevel >= 3 ? null : TANK_COSTS[s.tankLevel],
      s.hasMarinaFac('fueldock') ? null : t('Önce Yakıt İskelesi kur'))
    // EK TANKLAR (Oğuz: "limitleri çok artırabilmeliyim") — yakıt başına 8 tanka kadar;
    // 4'ten sonrası kademeli pahalılaşır (kapasite ×3 çarpanıyla birleşince devasa depo)
    for (const f of FUELS) {
      const maxT = s.theme().features?.maxTanksPerFuel ?? MAX_TANKS_PER_FUEL
      if (s.tankCounts[f] < maxT) {
        const n = s.tankCounts[f]
        const addCost = n < TANK_ADD_COSTS.length ? TANK_ADD_COSTS[n] : 20_000 + (n - 3) * 15_000
        row(`tankadd-${f}`, 'i-tank', t('Ek {0} Tankı ({1}/{2})', FUEL_LABEL[f], n + 1, maxT),
          `+${TANK_CAPACITY[s.tankLevel] * (s.theme().features?.tankCapMult ?? 1)}L`,
          t('Yalnızca {0} deposunu {1}L büyütür — yer kaplamaz, daha seyrek sipariş.', FUEL_LABEL[f], TANK_CAPACITY[s.tankLevel] * (s.theme().features?.tankCapMult ?? 1)),
          addCost, s.hasMarinaFac('fueldock') ? null : t('Önce Yakıt İskelesi kur'))
      }
    }
    // POMPA HIZI marinada da geçerli (iskele pompaları)
    row('pumpspeed', 'i-fuel', s.pumpSpeedLevel === 0 ? t('Hızlı Dolum Sistemi') : t('Hızlı Dolum Sv.{0}', Math.min(3, s.pumpSpeedLevel + 1)),
      s.pumpSpeedLevel >= 3 ? t('+%80 hız') : `+%${[25, 50, 80][s.pumpSpeedLevel]} ${t('dolum hızı')}`,
      t('Yüksek debili pompa donanımı: dolum hızlanır, aynı sürede daha çok müşteri bitirirsin. Tüm pompalara uygulanır.'),
      s.pumpSpeedLevel >= 3 ? null : PUMPSPEED_COSTS[s.pumpSpeedLevel],
      s.hasMarinaFac('fueldock') ? null : t('Önce Yakıt İskelesi kur'))
    // MARKET (Oğuz: "marinaya market koyabilelim") — kara marketiyle aynı mekanik
    row('market', 'i-market', s.marketLevel === 0 ? t('Market') : t('Market Sv.{0}', s.marketLevel + 1),
      `+₺${25 * (s.marketLevel + 1)}-${60 * (s.marketLevel + 1)}`,
      t('Tekneciler ekstra alışveriş yapar. Yerinde yükselir, gelir seviyeyle artar.'),
      s.marketLevel >= 3 ? null : MARKET_COSTS[s.marketLevel],
      s.hasMarinaFac('fueldock') ? null : t('Önce Yakıt İskelesi kur'))
    // MÜDÜR marinada da: kumbara + yakıt siparişi + pasif şube işletmesi
    row('manager', 'i-gear',
      s.managerLevel === 0 ? t('Müdür Tut') : t('Müdür Sv.{0}', Math.min(3, s.managerLevel + 1)),
      s.managerLevel === 0 ? t('kumbara + yakıt siparişi') : s.managerLevel === 1 ? t('+ panel temizliği') : t('+ arıza tamiri'),
      t('Müdür 45 saniyede bir turlar: Sv.1 tüm kumbaraları toplar, Sv.2 güneş panellerini temizler, Sv.3 arızaları tamir eder. AYRICA sen başka şubedeyken bu şubeyi İŞLETİR: günlük net geliri şube kasasına yazar (Sv.1 %45, Sv.2 %65, Sv.3 %85 verim; kasa dolunca birikme durur). Yovmiyesi vardır.'),
      s.managerLevel >= 3 ? null : MANAGER_COSTS[s.managerLevel],
      s.pendingCapTotal() >= 1200 || s.managerLevel > 0 ? null : t('Önce gelir getiren tesisler kur'))
    return rows
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
  row('pumpspeed', 'i-fuel', s.pumpSpeedLevel === 0 ? t('Hızlı Dolum Sistemi') : t('Hızlı Dolum Sv.{0}', Math.min(3, s.pumpSpeedLevel + 1)),
    s.pumpSpeedLevel >= 3 ? t('+%80 hız') : `+%${[25, 50, 80][s.pumpSpeedLevel]} ${t('dolum hızı')}`,
    t('Yüksek debili pompa donanımı: dolum hızlanır, aynı sürede daha çok müşteri bitirirsin. Tüm pompalara uygulanır.'),
    s.pumpSpeedLevel >= 3 ? null : PUMPSPEED_COSTS[s.pumpSpeedLevel], null)
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
  row('lamp', 'i-star', s.lampCount ? t('Sokak Lambası ({0})', s.lampCount) : t('Sokak Lambası'), t('+itibar'),
    t('Gece aydınlatması — istasyon güvenli görünür (sınırsız kurulur, taşınır, satılır)'), LAMP_COST, null)
  row('parking', 'i-parking', s.parkingCount ? t('Otopark ({0})', s.parkingCount) : t('Otopark'), t('+4 araç'),
    t('Çizgili park alanı — müşteriler park edip tesisleri kullanır (sınırsız kurulur)'), PARKING_COST, null)

  row('market', 'i-market', s.marketLevel === 0 ? t('Market') : t('Market Sv.{0}', s.marketLevel + 1), `+₺${25 * (s.marketLevel + 1)}-${60 * (s.marketLevel + 1)}`,
    t('Müşteriler ekstra alışveriş yapar. Yerinde yükselir (aynı yer), gelir seviyeyle artar.'),
    s.marketLevel >= 3 ? null : MARKET_COSTS[s.marketLevel], null)
  // Karşı yaka marketi: yol karşısı istasyonun müşterileri yakadan çıkmadan alışveriş yapsın
  // ("karşıya market kuramıyoruz" — 5 feedback). Ana market + karşıda betonlu arsa şart.
  {
    const hasFarPaved = [...s.pavedParcels].some(k => Number(String(k).split(',')[0]) >= 3)
    row('market2', 'i-market', s.market2Level === 0 ? t('Karşı Market') : t('Karşı Market Sv.{0}', s.market2Level + 1),
      `+₺${25 * (s.market2Level + 1)}-${60 * (s.market2Level + 1)}`,
      t('Yol karşısındaki istasyonun müşterileri için ikinci market — karşı yakaya kurulur, yerinde yükselir.'),
      s.market2Level >= 3 ? null : MARKET_COSTS[s.market2Level],
      s.marketLevel < 1 ? t('Önce ana marketi kur') : hasFarPaved ? null : t('Karşıda betonlu arsa gerekli'))
  }
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
  // ---- B8: karşı yaka nüshaları (yalnız karşıda betonlu arsa varken görünür) ----
  {
    const hasFarPaved = [...s.pavedParcels].some(k => Number(String(k).split(',')[0]) >= 3)
    const far = (id: string, icon: string, title: string, stat: string, desc: string, cost: number | null, need: boolean) =>
      row(id, icon, title, stat, desc, cost, !need ? t('Önce bu yakadaki tesisi kur')
        : hasFarPaved ? null : t('Karşıda betonlu arsa gerekli'))
    far('toilet2', 'i-toilet', s.toilet2Level === 0 ? t('Karşı Tuvalet') : t('Karşı Tuvalet Sv.2'), t('+moral'),
      t('Yol karşısı istasyon için tuvalet — karşı yakanın müşterileri kullanır.'),
      s.toilet2Level >= 2 ? null : TOILET_COSTS[s.toilet2Level], s.toiletLevel > 0)
    far('wash2', 'i-wash', t('Karşı Oto Yıkama'), '+₺60-120',
      t('Karşı yakadaki müşteriler araç yıkatır.'), s.hasWash2 ? null : WASH_COST, s.hasWash)
    far('oil2', 'i-oil', t('Karşı Yağ Değişimi'), '+₺150-250',
      t('Karşı yakada yağ değişimi hizmeti.'), s.hasOil2 ? null : OIL_COST, s.hasOil)
    far('coffee2', 'i-coffee', t('Karşı Kahveci'), '+₺20-45',
      t('Karşı yakadaki yolcular kahve molası verir.'), s.hasCoffee2 ? null : COFFEE_COST, s.hasCoffee)
    far('restaurant2', 'i-food', t('Karşı Restoran'), '+₺80-160',
      t('Karşı yakada yemek molası.'), s.hasRestaurant2 ? null : RESTAURANT_COST, s.hasRestaurant)
    far('truckpark2', 'i-truck', t('Karşı Tır Parkı'), '+₺90-160/dk',
      t('Karşı yakada tırcılar konaklar — düzenli pasif gelir.'), s.hasTruckPark2 ? null : TRUCKPARK_COST, s.hasTruckPark)
  }

  // ---- KATMAN 2b SİNK'LERİ: sigorta, dekorasyon, ekipman yenileme ----
  row('insurance', 'i-star', s.insurance ? t('Sigorta: AKTİF') : t('Sigorta Yaptır'),
    s.insurance ? t('hasar yarı') : t('günlük prim'),
    t('Arıza, patlama ve ceza maliyetleri YARIYA iner. Günlük primi varlığınla ölçeklenir.'),
    s.insurance ? null : 5_000, null)
  row('decor', 'i-star', s.decorLevel === 0 ? t('Peyzaj & Dekorasyon') : t('Dekorasyon Sv.{0}', Math.min(3, s.decorLevel + 1)),
    t('+{0} itibar', (0.15 * Math.min(3, s.decorLevel + 1)).toFixed(2)),
    t('Çiçeklik, aydınlatma, marka renkleri — gelir etkisi yok ama itibar ve görüntü kazandırır.'),
    s.decorLevel >= 3 ? null : DECOR_COSTS[s.decorLevel], null)
  if (s.wear > 0.25) {
    row('renew', 'i-wrench', t('Ekipman Yenileme (yıpranma %{0})', Math.round(s.wear * 100)),
      t('verim +%{0}', Math.round((1 - s.wearEfficiency()) * 100)),
      t('Yıpranan ünitelerin verimi düşer. Yenileme yıpranmayı sıfırlar.'),
      s.renewCost(), null)
  }

  // ---- MÜDÜR + PERSONEL EĞİTİMİ (geç oyun otomasyonu, raporun 5. ve 7. öncelikleri) ----
  row('manager', 'i-gear',
    s.managerLevel === 0 ? t('Müdür Tut') : t('Müdür Sv.{0}', Math.min(3, s.managerLevel + 1)),
    s.managerLevel === 0 ? t('kumbara + yakıt siparişi') : s.managerLevel === 1 ? t('+ panel temizliği') : t('+ arıza tamiri'),
    t('Müdür 45 saniyede bir turlar: Sv.1 tüm kumbaraları toplar, Sv.2 güneş panellerini temizler, Sv.3 arızaları tamir eder. AYRICA sen başka şubedeyken bu şubeyi İŞLETİR: günlük net geliri şube kasasına yazar (Sv.1 %45, Sv.2 %65, Sv.3 %85 verim; kasa dolunca birikme durur). Yovmiyesi vardır.'),
    s.managerLevel >= 3 ? null : MANAGER_COSTS[s.managerLevel],
    s.pendingCapTotal() >= 1200 || s.managerLevel > 0 ? null : t('Önce gelir getiren tesisler kur'))
  row('train', 'i-star', t('Personel Eğitimi Sv.{0}', Math.min(4, s.staffLevel + 1)),
    t('+%12 hız, +bahşiş'),
    t('Pompacı/şarjcı kademesi: dolum hızı, bahşiş şansı ve hata direnci artar — ama yovmiye de artar.'),
    s.staffLevel >= 4 ? null : STAFF_TRAIN_COSTS[s.staffLevel - 1],
    s.autoPumps.size + s.autoChargers.size > 0 ? null : t('Önce pompacı/şarjcı tut'))

  row('grid', 'i-bolt', t('Elektrik Altyapısı Sv.{0}', Math.min(s.gridLevel + 1, 2)),
    s.gridLevel === 0 ? t('temel') : t('+%30 üretim'),
    s.gridLevel === 0 ? t('Şarj ve enerji yapılarının önünü açar') : t('Tüm üretimi güçlendirir, yeni yapılar açılır'),
    s.gridLevel >= 2 ? null : GRID_COSTS[s.gridLevel], null)
  const battMax = BATTERY_CAP.length - 1
  const battNext = Math.min(s.batteryLevel + 1, battMax)
  row('battery', 'i-batt', t('Batarya Deposu Sv.{0}', battNext),
    `${BATTERY_CAP[battNext].toLocaleString('tr-TR')} kWh`,
    s.batteryLevel >= 3
      ? t('Yüksek kapasite: çok sayıda şarj ünitesini aynı anda besler')
      : t('Üretilen elektriği biriktirir, araçlar buradan anında şarj olur'),
    s.batteryLevel >= battMax ? null : BATTERY_COSTS[s.batteryLevel],
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
    t('Dev üretim — bakımsız kalırsa PATLAR, her şey sıfırlanır. Sv.3 müdür bakımı üstlenir.'),
    s.hasSMR ? null : SMR_COST,
    s.smrWreck ? t('Önce radyoaktif enkazı temizlet') : s.gridLevel < 2 ? t('Altyapı Sv.2 gerekli') : null)

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
  // D12 (analiz): çoklu şube hedefini görünür kılan başarım
  ['chain', t('Zincir başladı — İkinci şuben açık!'), s => s.unlockedLocs.length >= 2],
]

export function checkAchievements(s: GameState) {
  for (const [id, title, cond] of ACHIEVEMENTS) {
    if (!s.achievements.has(id) && cond(s)) {
      s.achievements.add(id)
      s.events.push(t('Başarım: {0}', title))
    }
  }
}

// ---- Kayıt ----

const SAVE_FIELDS = [
  'money', 'reputation', 'stationName', 'pumps', 'pumpSpeedLevel', 'signLevel', 'tankLevel', 'marketLevel', 'market2Level', 'toiletLevel',
  'toilet2Level', 'hasWash2', 'hasOil2', 'hasCoffee2', 'hasRestaurant2',
  'gridLevel', 'evChargers', 'batteryLevel', 'battery', 'elecPrice', 'toiletFee', 'solarCount', 'hasDiesel', 'hasSMR',
  'hasWash', 'hasOil', 'hasCoffee', 'hasRestaurant', 'hasTruckPark', 'airWaterCount', 'selfWashCount', 'parkingCount',
  'solarDirt', 'smrWear', 'smrWreck', 'uranium', 'uraniumPending', 'uraniumEta', 'day', 'dayStartMoney', 'dayStartRevenue', 'closed',
  'lastLoginDate', 'loginStreak', 'dailyDate', 'dailyServed', 'dailyDone', 'maintCare', 'wideGates', 'loan', 'partner',
  'wagesPaid', 'fuelSpent', 'noAds', 'marketingBudget', 'opexStart', 'contractsDone', 'contractsFailed', 'brandStars', 'handoverCount', 'managerLevel', 'staffLevel', 'insurance', 'licenseDueDay', 'decorLevel', 'wear', 'lampCount', 'firstBranchGift',
  'marinaFacs', 'berths', 'winterSlots', 'marinaViolations', 'logbookOk', 'logbookBad', 'rival',
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
  out.contract = s.contract ? { ...s.contract } : null // aktif B2B sözleşmesi (ADDITIVE)
  // ÇOKLU ŞUBE (ADDITIVE): aktif şube + açık şubeler + pasif şube anlık görüntüleri.
  // Eski istemci bu alanları yok sayar; eski save'de alan yoksa tek şube (kasaba) davranışı.
  out.activeLoc = s.activeLoc
  out.unlockedLocs = [...s.unlockedLocs]
  out.locSnapshots = JSON.parse(JSON.stringify(s.locSnapshots))
  // ŞUBE MÜDÜRÜ (ADDITIVE): pasif şubelerin biriken kasası. Eski istemci yok sayar.
  out.branchVault = { ...s.branchVault }
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
      const o = (data.orders as Record<string, { pending?: boolean; eta?: number; arrived?: boolean; delivering?: boolean; amount?: number }>)[f]
      if (o) {
        s.orders[f].eta = Math.min(60, Math.max(0, Number(o.eta) || 0))
        // EXPLOIT FİXİ: amount restore edilmiyordu → 0 kalıp deliverFuel'daki eski
        // fallback aktif şubenin tüm ihtiyacını bedava ekliyordu. Ödenen parti
        // miktarı artık kayıttan döner (üst sınır: tek partide max 60k).
        s.orders[f].amount = Math.min(60_000, Math.max(0, Number(o.amount) || 0))
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
  // aktif sözleşme: alanlar doğrulanır (bozuk/eski kayıt sözleşmeyi düşürür, oyun kilitlenmez)
  const ct = data.contract as Contract | null | undefined
  if (ct && typeof ct === 'object' && FUELS.includes(ct.fuel as FuelType)
      && Number.isFinite(ct.dailyLiters) && Number.isFinite(ct.daysLeft) && ct.daysLeft > 0) {
    s.contract = {
      id: String(ct.id ?? 'c'), name: String(ct.name ?? '—'), fuel: ct.fuel as FuelType,
      daysTotal: Math.max(1, Math.min(60, Math.round(Number(ct.daysTotal) || 7))),
      daysLeft: Math.max(1, Math.min(Math.max(1, Math.min(60, Math.round(Number(ct.daysTotal) || 7))), Math.round(Number(ct.daysLeft)))),
      dailyLiters: Math.max(50, Math.min(20000, Math.round(Number(ct.dailyLiters)))),
      pricePerL: Math.max(1, Math.min(40, Number(ct.pricePerL) || 8)),
      bonus: Math.max(0, Math.min(5_000_000, Math.round(Number(ct.bonus) || 0))),
      penalty: Math.max(0, Math.min(500_000, Math.round(Number(ct.penalty) || 0))),
      deliveredToday: Math.max(0, Number(ct.deliveredToday) || 0),
      missedDays: Math.max(0, Math.round(Number(ct.missedDays) || 0)),
    }
  } else s.contract = null
  // ÇOKLU ŞUBE: bilinmeyen/bozuk id'ler atılır, aktif şube her zaman AÇIK listede olur
  const VALID: LocId[] = ['kasaba', 'cevreyolu', 'otoyol', 'marina', 'metropol']
  if (Array.isArray(data.unlockedLocs)) {
    const list = (data.unlockedLocs as string[]).filter(x => VALID.includes(x as LocId)) as LocId[]
    s.unlockedLocs = list.includes('kasaba') ? list : ['kasaba', ...list]
  }
  if (typeof data.activeLoc === 'string' && VALID.includes(data.activeLoc as LocId)) {
    s.activeLoc = s.unlockedLocs.includes(data.activeLoc as LocId) ? data.activeLoc as LocId : 'kasaba'
  }
  // ŞUBE KASALARI (ADDITIVE): sayıya zorla + tavanla kırp (bozuk/kurcalanmış save koruması)
  if (data.branchVault && typeof data.branchVault === 'object' && !Array.isArray(data.branchVault)) {
    const bv: Partial<Record<LocId, number>> = {}
    for (const [k, v] of Object.entries(data.branchVault as Record<string, unknown>)) {
      if (!VALID.includes(k as LocId)) continue
      const n = Number(v)
      if (!isFinite(n) || n <= 0) continue
      bv[k as LocId] = Math.min(GameState.BRANCH_VAULT_HARD, Math.round(n))
    }
    s.branchVault = bv
  }
  if (data.locSnapshots && typeof data.locSnapshots === 'object' && !Array.isArray(data.locSnapshots)) {
    const out: Partial<Record<LocId, LocSnapshot>> = {}
    for (const [k, v] of Object.entries(data.locSnapshots as Record<string, LocSnapshot>)) {
      if (VALID.includes(k as LocId) && v && typeof v === 'object') out[k as LocId] = v
    }
    s.locSnapshots = out
  }
  // güvenlik: aktif şube snapshot'ta DURAMAZ (çift sayım → sunucu servet hesabı şişer)
  delete s.locSnapshots[s.activeLoc]
  // prestij alanları: bozuk save NaN/negatif getirirse tüm ekonomi NaN olur, '★'.repeat crash
  s.brandStars = Math.max(0, Math.min(40, Math.round(Number(s.brandStars) || 0)))
  s.handoverCount = Math.max(0, Math.min(40, Math.round(Number(s.handoverCount) || 0)))
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
  // MARİNA: bağlama yeri (dinamik id) ve tesisler
  if (id.startsWith('berth_')) { const k = id.slice('berth_'.length); s.berths[k] = (s.berths[k] ?? 0) + 1; return true }
  if (id in MARINA_FACILITIES) { if (!s.marinaFacs.includes(id)) s.marinaFacs.push(id); return true }
  switch (id) {
    case 'pump': s.pumps++; break
    case 'pumpspeed': s.pumpSpeedLevel++; break
    case 'sign': s.signLevel++; break
    case 'widegate': s.wideGates = true; break
    case 'tank': s.tankLevel++; break
    case 'market': s.marketLevel++; break
    case 'insurance': s.insurance = true; break
    case 'decor': s.decorLevel++; break
    case 'renew': s.wear = 0; break
    case 'manager': s.managerLevel++; break
    case 'train': s.staffLevel++; break
    case 'market2': s.market2Level++; break
    case 'toilet2': s.toilet2Level++; break
    case 'wash2': s.hasWash2 = true; break
    case 'oil2': s.hasOil2 = true; break
    case 'coffee2': s.hasCoffee2 = true; break
    case 'restaurant2': s.hasRestaurant2 = true; break
    case 'toilet': s.toiletLevel++; break
    case 'grid': s.gridLevel++; break
    case 'battery': s.batteryLevel++; break
    case 'evcharger': s.evChargers++; break
    case 'solar': s.solarCount++; break
    case 'dieselgen': s.hasDiesel = true; break
    case 'smr':
      if (s.smrWreck) { s.money += item.cost; return false } // para ÖNCE düşüldü — iade et (satır notu zaten kilitler, bu çift emniyet)
      s.hasSMR = true; s.uranium = 100; break
    case 'wash': s.hasWash = true; break
    case 'oil': s.hasOil = true; break
    case 'coffee': s.hasCoffee = true; break
    case 'restaurant': s.hasRestaurant = true; break
    case 'truckpark': s.hasTruckPark = true; break
    case 'truckpark2': s.hasTruckPark2 = true; break
    case 'airwater': s.airWaterCount++; break
    case 'lamp': s.lampCount++; break
    case 'winterslot': s.winterSlots++; break
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
    case 'market2': return s.market2Level > 0 ? { refund: half(MARKET_COSTS.slice(0, s.market2Level).reduce((a, b) => a + b, 0)) } : null
    case 'toilet2': return s.toilet2Level > 0 ? { refund: half(TOILET_COSTS.slice(0, s.toilet2Level).reduce((a, b) => a + b, 0)) } : null
    case 'wash2': return s.hasWash2 ? { refund: half(WASH_COST) } : null
    case 'oil2': return s.hasOil2 ? { refund: half(OIL_COST) } : null
    case 'coffee2': return s.hasCoffee2 ? { refund: half(COFFEE_COST) } : null
    case 'restaurant2': return s.hasRestaurant2 ? { refund: half(RESTAURANT_COST) } : null
    case 'toilet': return s.toiletLevel > 0 ? { refund: half(TOILET_COSTS.slice(0, s.toiletLevel).reduce((a, b) => a + b, 0)) } : null
    case 'battery': return s.batteryLevel > 0 ? { refund: half(BATTERY_COSTS.slice(0, s.batteryLevel).reduce((a, b) => a + b, 0)) } : null
    case 'wash': return s.hasWash ? { refund: half(WASH_COST) } : null
    case 'oil': return s.hasOil ? { refund: half(OIL_COST) } : null
    case 'coffee': return s.hasCoffee ? { refund: half(COFFEE_COST) } : null
    case 'restaurant': return s.hasRestaurant ? { refund: half(RESTAURANT_COST) } : null
    case 'truckpark': return s.hasTruckPark ? { refund: half(TRUCKPARK_COST) } : null
    case 'truckpark2': return s.hasTruckPark2 ? { refund: half(TRUCKPARK_COST) } : null
    case 'dieselgen': return s.hasDiesel ? { refund: half(DIESELGEN_COST) } : null
    case 'smr': return s.hasSMR ? { refund: half(SMR_COST) } : null
    case 'solar': return s.solarCount > 0 ? { refund: half(SOLAR_COST) } : null // 2c: herhangi bir örnek satılabilir
    case 'parking': return s.parkingCount > 0 ? { refund: half(PARKING_COST) } : null // 2c: herhangi bir örnek satılabilir
    case 'selfwash': return s.selfWashCount > 0 ? { refund: half(SELFWASH_COST) } : null // 2c: herhangi bir örnek satılabilir
    case 'airwater': return s.airWaterCount > 0 ? { refund: half(AIRWATER_COST) } : null // 2c: herhangi bir örnek satılabilir
    case 'lamp': return s.lampCount > 0 ? { refund: half(LAMP_COST) } : null
    // 2c: geri kalan yapılar da satılabilir (ölü sermaye geri döner, yeniden planlama strateji olur)
    case 'sign': return s.signLevel > 0 ? { refund: half(SIGN_COSTS.slice(0, s.signLevel).reduce((a, b) => a + b, 0)) } : null
    case 'grid': return s.gridLevel > 0 && s.evChargers === 0 && s.batteryLevel === 0 && !s.hasSMR && s.solarCount === 0 && !s.hasDiesel
      ? { refund: half(GRID_COSTS.slice(0, s.gridLevel).reduce((a, b) => a + b, 0)) } : null
    case 'widegate': return s.wideGates ? { refund: half(WIDEGATE_COST) } : null
    default: return null // tank/office: kritik altyapı, satılmaz
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
    case 'market2': s.market2Level = 0; break
    case 'toilet2': s.toilet2Level = 0; break
    case 'wash2': s.hasWash2 = false; break
    case 'oil2': s.hasOil2 = false; break
    case 'coffee2': s.hasCoffee2 = false; break
    case 'restaurant2': s.hasRestaurant2 = false; break
    case 'sign': s.signLevel = 0; break
    case 'grid': s.gridLevel = 0; break
    case 'widegate': s.wideGates = false; break
    case 'toilet': s.toiletLevel = 0; break
    case 'battery': s.batteryLevel = 0; s.battery = 0; break
    case 'wash': s.hasWash = false; break
    case 'oil': s.hasOil = false; break
    case 'coffee': s.hasCoffee = false; break
    case 'restaurant': s.hasRestaurant = false; break
    case 'truckpark': s.hasTruckPark = false; break
    case 'truckpark2': s.hasTruckPark2 = false; break
    case 'dieselgen': s.hasDiesel = false; break
    case 'smr': s.hasSMR = false; s.uranium = 0; s.smrWear = 0; break
    case 'solar': s.solarCount--; break
    case 'parking': s.parkingCount--; break
    case 'selfwash': s.selfWashCount--; break
    case 'airwater': s.airWaterCount--; break
    case 'lamp': s.lampCount--; break
  }
  return info.refund
}
