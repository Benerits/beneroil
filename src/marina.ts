/**
 * MARİNA — Deniz Kıyısı Şubesi (lategame raporu §6.5)
 *
 * Raporun tezi: geç oyun büyümesi ARAÇ SAYISIYLA değil ₺/MÜŞTERİ ile yapılmalı, çünkü
 * geri bildirimlerin %22'si mobil ısınma. Marina bu ilkenin saf hâli — ekranda 6-10 tekne
 * (otoyolda 25-30 araç), ortalama satış ₺4.500 (otoyolda ₺233). Daha yüksek gelir,
 * daha az ekran kalabalığı.
 *
 * Bu dosya marinanın SAF MANTIĞIDIR: segmentler, ÖTV'siz yakıt defteri, bağlama
 * işletmesi, Mavi Bayrak ve risk olayları. Three.js bilmez → tamamı test edilebilir.
 * GameState bu fonksiyonları çağırır; marina dışı şubelerde hiçbiri devreye girmez.
 */
import { t } from './i18n'

// ---- 1) TEKNE SEGMENTLERİ (rapor §6.5.4) ----
export interface BoatSegment {
  id: string
  share: number        // geliş olasılığı
  min: number          // talep ₺ alt
  max: number          // talep ₺ üst
  margin: number       // marj oranı (ÖTV'siz balıkçıda düşük, jet ski'de yüksek)
  serviceSec: number   // servis süresi — kara istasyonundan çok daha uzun
  label: string
  /** Mavi Bayrak şartı: yalnız sertifikalı marinaya gelir */
  needsBlueFlag?: boolean
  /** duş/çamaşırhane yoksa gelmez (gulet mürettebatı) */
  needsShower?: boolean
  /** BÜYÜK TEKNE: rıhtıma yan yanaşamaz, gerçek yakıt iskelesi ister.
   *  Küçük tekneler (jet ski / sürat / balıkçı) rıhtım babalarına bağlanıp
   *  istasyonun kendi pompasından yakıt alır — bu yüzden şube ilk günden canlıdır. */
  needsFuelDock?: boolean
  /** ÖTV'siz yakıt defteri ibraz eder — oyuncu ONAYLA/REDDET kararı verir */
  logbook?: boolean
}

export const BOAT_SEGMENTS: BoatSegment[] = [
  { id: 'jetski', share: 0.24, min: 400, max: 800, margin: 0.35, serviceSec: 15, label: t('Jet ski / şişme bot') },
  { id: 'surat', share: 0.20, min: 1500, max: 3000, margin: 0.38, serviceSec: 25, label: t('Sürat teknesi') },
  { id: 'balikci', share: 0.20, min: 2000, max: 5000, margin: 0.12, serviceSec: 40, label: t('Balıkçı teknesi'), logbook: true },
  { id: 'yelkenli', share: 0.14, min: 2500, max: 6000, margin: 0.30, serviceSec: 50, label: t('Yelkenli'), needsFuelDock: true },
  { id: 'gulet', share: 0.10, min: 4000, max: 9000, margin: 0.28, serviceSec: 60, label: t('Gulet'), needsShower: true, needsFuelDock: true },
  { id: 'motoryat', share: 0.09, min: 6000, max: 12000, margin: 0.32, serviceSec: 70, label: t('Motor yat'), needsFuelDock: true },
  { id: 'superyat', share: 0.03, min: 25000, max: 60000, margin: 0.28, serviceSec: 150, label: t('Süperyat'), needsBlueFlag: true, needsFuelDock: true },
]

/** rapordaki "ortalama satış ≈ ₺4.500" iddiasının hesabı — testle kilitlenir */
export function averageTicket(segs: BoatSegment[]): number {
  const tot = segs.reduce((a, s) => a + s.share, 0)
  if (tot <= 0) return 0
  return segs.reduce((a, s) => a + s.share * (s.min + s.max) / 2, 0) / tot
}

// ---- 2) MARİNA TESİSLERİ ----
/** Kurulabilir marina tesisleri. `env` olanlar Mavi Bayrak şartıdır. */
export const MARINA_FACILITIES = {
  fueldock:  { cost: 180_000, label: t('Yakıt İskelesi'), env: false },
  chandlery: { cost: 90_000, label: t('Denizci Malzemecisi'), env: false },
  shower:    { cost: 60_000, label: t('Duş & Çamaşırhane'), env: false },
  clubhouse: { cost: 220_000, label: t('Yat Kulübü / Sahil Restoranı'), env: false },
  icebait:   { cost: 45_000, label: t('Buz & Yem Satışı'), env: false },
  travelift: { cost: 900_000, label: t('Travel Lift (Tekne Asansörü)'), env: false },
  pumpout:   { cost: 120_000, label: t('Atık Su Tahliyesi'), env: true },
  wasteoil:  { cost: 70_000, label: t('Atık Yağ Toplama'), env: true },
  boom:      { cost: 95_000, label: t('Yakıt Sızıntı Bariyeri'), env: true },
} as const
export type MarinaFacId = keyof typeof MARINA_FACILITIES

export const ENV_FACILITIES: MarinaFacId[] = (Object.keys(MARINA_FACILITIES) as MarinaFacId[])
  .filter(k => MARINA_FACILITIES[k].env)

// ---- 3) BAĞLAMA İŞLETMESİ (pasif gelir omurgası) ----
/** Parmak iskele: tekne boyuna göre yer. Uzun yer pahalı ama az müşteri alır. */
export const BERTH_KINDS = {
  buoy:   { cost: 12_000, daily: 120, label: t('Şamandıra') },        // ucuz, servis erişimi zayıf
  finger8:  { cost: 40_000, daily: 420, label: t('Parmak İskele 8m') },
  finger12: { cost: 75_000, daily: 780, label: t('Parmak İskele 12m') },
  finger18: { cost: 140_000, daily: 1_500, label: t('Parmak İskele 18m') },
  mega:   { cost: 600_000, daily: 7_500, label: t('Süperyat Mevkisi') },
} as const
export type BerthKind = keyof typeof BERTH_KINDS

/** Bağlama gelirleri: doluluk mevsime bağlıdır (kışın yazlık tekne gitmez, kışlama gelir). */
export function berthIncome(
  berths: Record<string, number>,
  seasonId: string,
  blueFlag: boolean,
): number {
  // Kışın bağlama doluluğu düşer AMA kışlama sözleşmesi devreye girer (§6.5.5):
  // "kışın tekne trafiği çöker ama kışlama ve bakım geliri zirve yapar".
  const occ = seasonId === 'yaz' ? 0.95 : seasonId === 'kis' ? 0.55 : 0.75
  let v = 0
  for (const [k, n] of Object.entries(berths)) {
    const b = BERTH_KINDS[k as BerthKind]
    if (b) v += b.daily * n * occ
  }
  return Math.round(v * (blueFlag ? 1.15 : 1)) // Mavi Bayrak: marina ücretine %15 prim
}

/** Karada kışlama: yalnız travel lift varken ve KIŞIN anlamlı (rapor: kışın ekmek kapısı). */
export function winterStorageIncome(capacity: number, seasonId: string, hasLift: boolean): number {
  if (!hasLift || capacity <= 0) return 0
  const rate = seasonId === 'kis' ? 1 : seasonId === 'ilkbahar' ? 0.45 : 0.1
  return Math.round(capacity * 900 * rate)
}

// ---- 4) MAVİ BAYRAK (rapor §6.5.6) ----
export interface BlueFlagState { ok: boolean; missing: MarinaFacId[]; reason: string }

/** Tüm çevre hizmetleri + temizlik varsa kazanılır. Etkisi: itibar +0.5, süperyat kilidi
 *  açılır, denetim sıklığı yarıya iner, marina ücretine %15 prim. */
export function blueFlagStatus(facs: Set<string>, violations: number): BlueFlagState {
  const missing = ENV_FACILITIES.filter(f => !facs.has(f))
  if (missing.length) {
    return { ok: false, missing, reason: t('Eksik çevre hizmeti: {0}', missing.map(m => MARINA_FACILITIES[m].label).join(', ')) }
  }
  // İhlal geçmişi bayrağı GEÇİCİ olarak düşürür — kalıcı silme YOK (raporun kritik kuralı).
  if (violations >= 3) return { ok: false, missing: [], reason: t('Çevre ihlali kaydın var — bayrak askıda') }
  return { ok: true, missing: [], reason: t('Mavi Bayrak geçerli') }
}

// ---- 5) ÖTV'SİZ YAKIT ALIM DEFTERİ (rapor §6.5.3 — marinanın en özgün mekaniği) ----
/** Ticari tekne vergi muafiyetli deniz yakıtı alabilir; defter ibraz eder.
 *  Oyuncu İNCELE → ONAYLA / REDDET kararı verir. Yanlış karar pahalıdır. */
export interface Logbook {
  boatName: string
  liters: number
  quotaUsed: number
  quotaTotal: number
  visaValid: boolean
  signatureOk: boolean
  dateConsistent: boolean
  /** gerçekte geçerli mi (oyuncu bunu GÖRMEZ; ipuçlarından çıkarır) */
  genuine: boolean
}

export const LOGBOOK_FINE = 50_000      // sahte/kotası dolu deftere onay → denetimde ceza
export const LOGBOOK_MARGIN = 0.12      // ÖTV'siz satışın marjı (düşük ama hacim yüksek)

/** Determinist defter üretimi (gün + sıra numarası tohumlu → tekrar üretilebilir, test edilebilir).
 *  Zorluk kademeli: erken oyunda sahtecilik apaçık, geç oyunda inceliyor. */
export function makeLogbook(day: number, seq: number, boatName: string, liters: number): Logbook {
  const rnd = (k: number) => {
    const x = Math.sin((day * 37 + seq * 101 + k * 17) * 12.9898) * 43758.5453
    return x - Math.floor(x)
  }
  // sahtecilik oranı gün 1'de %15, gün 200'de %40'a çıkar
  const fakeRate = Math.min(0.4, 0.15 + day * 0.00125)
  const fake = rnd(1) < fakeRate
  // İnceliğin kademesi: erken oyunda TEK ve bariz kusur, geç oyunda tek ince kusur.
  const subtle = day > 60
  const quotaTotal = 2000
  let quotaUsed = Math.floor(rnd(2) * 1200)
  let visaValid = true, signatureOk = true, dateConsistent = true
  if (fake) {
    const which = Math.floor(rnd(3) * 3)
    if (which === 0) quotaUsed = quotaTotal - Math.floor(liters * (subtle ? 0.92 : 0.4)) // kota yetmez
    else if (which === 1) visaValid = false
    else if (which === 2) { if (subtle) dateConsistent = false; else signatureOk = false }
  }
  return { boatName, liters, quotaUsed, quotaTotal, visaValid, signatureOk, dateConsistent, genuine: !fake }
}

/** Defterin oyuncuya GÖRÜNEN kusurları — İNCELE ekranında listelenir. */
export function logbookFlags(lb: Logbook): string[] {
  const f: string[] = []
  if (lb.quotaUsed + lb.liters > lb.quotaTotal) f.push(t('Kota yetersiz: {0}/{1} L kullanılmış, {2} L isteniyor', lb.quotaUsed, lb.quotaTotal, lb.liters))
  if (!lb.visaValid) f.push(t('Vize süresi dolmuş'))
  if (!lb.signatureOk) f.push(t('İmza uyuşmuyor'))
  if (!lb.dateConsistent) f.push(t('Tarih tutarsızlığı var'))
  return f
}

export type LogbookChoice = 'approve' | 'reject'
export interface LogbookOutcome {
  money: number       // anında para etkisi (ceza negatif)
  rep: number         // itibar etkisi
  violation: boolean  // çevre/uyum siciline işlenir mi
  msg: string
  correct: boolean    // oyuncu doğru kararı verdi mi (istatistik/öğretim için)
}

/** Kararın sonucu. Rapor tablosu birebir:
 *   doğru onay   → düşük marj, yüksek hacim, müdavim ticari müşteri
 *   yanlış onay  → sonraki denetimde ₺50.000 ceza + ruhsat askı riski
 *   haklı ret    → müşteri kızar (itibar −0.2) ama güvendesin
 *   haksız ret   → ticari müşteri bir daha gelmez (itibar −0.35) */
export function resolveLogbook(lb: Logbook, choice: LogbookChoice, saleValue: number): LogbookOutcome {
  const valid = lb.genuine && logbookFlags(lb).length === 0
  if (choice === 'approve') {
    if (valid) {
      return { money: Math.round(saleValue * LOGBOOK_MARGIN), rep: 0.05, violation: false, correct: true,
        msg: t('📄 Defter onaylandı — ÖTV\'siz satış yapıldı (+₺{0} marj)', Math.round(saleValue * LOGBOOK_MARGIN)) }
    }
    return { money: -LOGBOOK_FINE, rep: -0.5, violation: true, correct: false,
      msg: t('🚫 Sahte deftere onay verdin — denetimde ₺{0} ceza kesildi!', LOGBOOK_FINE.toLocaleString('tr-TR')) }
  }
  // REDDET
  if (!valid) {
    return { money: 0, rep: -0.2, violation: false, correct: true,
      msg: t('✅ Kusurlu defteri reddettin — müşteri kızdı ama sen güvendesin.') }
  }
  return { money: 0, rep: -0.35, violation: false, correct: false,
    msg: t('❌ Geçerli defteri reddettin — bu ticari müşteri bir daha gelmeyecek.') }
}

// ---- 6) RİSK OLAYLARI (rapor §6.5.6) ----
// KRİTİK TASARIM KURALI: marina olayları HİÇBİR ZAMAN kalıcı silme yapmaz. SMR patlaması
// "her şey sıfırlanır" hissiyle rage-quit üretmişti. Buradaki hasar ağır ama telafi edilebilir:
// para cezası, itibar kaybı, Mavi Bayrak'ın GEÇİCİ kaybı. Hepsi geri kazanılır.
export interface MarinaEvent {
  id: string
  label: string
  /** mevsime göre ağırlık (0 = o mevsimde olmaz) */
  weight: Record<string, number>
  money: number
  rep: number
  /** kaç gün süren etki (0 = anlık) */
  days: number
  /** hangi tesis varsa tamamen önlenir */
  preventedBy?: MarinaFacId
  msg: string
}

export const MARINA_EVENTS: MarinaEvent[] = [
  { id: 'sizinti', label: t('Yakıt sızıntısı'), weight: { yaz: 1, sonbahar: 1, kis: 0.6, ilkbahar: 1 },
    money: -35_000, rep: -0.6, days: 0, preventedBy: 'boom',
    msg: t('🛢️ Yakıt sızıntısı! Bariyer yoktu, denize yayıldı — ceza kesildi.') },
  { id: 'lodos', label: t('Lodos / fırtına'), weight: { yaz: 0.3, sonbahar: 1.4, kis: 2.2, ilkbahar: 1.1 },
    money: -18_000, rep: -0.25, days: 1,
    msg: t('🌊 Lodos vurdu — bağlantısı zayıf tekneler hasar gördü, tazminat ödendi.') },
  { id: 'suruklenme', label: t('Sürüklenen tekne'), weight: { yaz: 0.4, sonbahar: 1, kis: 1.6, ilkbahar: 0.8 },
    money: -22_000, rep: -0.3, days: 0,
    msg: t('⚓ Bir tekne sürüklenip diğerine çarptı — zincirleme hasar.') },
  { id: 'denetim', label: t('Denetim'), weight: { yaz: 1, sonbahar: 1, kis: 1, ilkbahar: 1 },
    money: 0, rep: 0, days: 0,
    msg: t('🚫 Denetim geldi — belgelerin düzgündü, sorunsuz geçti.') },
  { id: 'musilaj', label: t('Deniz kirliliği'), weight: { yaz: 0.7, sonbahar: 0.3, kis: 0.1, ilkbahar: 0.4 },
    money: 0, rep: -0.4, days: 20, preventedBy: 'pumpout',
    msg: t('🦑 Müsilaj basdı — turistik tekne trafiği 20 gün düşük kalacak.') },
]

/** Determinist olay seçimi (gün tohumlu). Mavi Bayrak denetim/olay sıklığını YARIYA indirir. */
export function pickMarinaEvent(day: number, seasonId: string, facs: Set<string>, blueFlag: boolean): MarinaEvent | null {
  const x = Math.sin(day * 78.233) * 43758.5453
  const r = x - Math.floor(x)
  const base = blueFlag ? 0.06 : 0.12 // günlük olay olasılığı
  if (r > base) return null
  const pool = MARINA_EVENTS.filter(e => (e.weight[seasonId] ?? 0) > 0 && !(e.preventedBy && facs.has(e.preventedBy)))
  if (!pool.length) return null
  const tot = pool.reduce((a, e) => a + (e.weight[seasonId] ?? 0), 0)
  const y = Math.sin(day * 12.9898 + 4.1) * 43758.5453
  let pick = (y - Math.floor(y)) * tot
  for (const e of pool) {
    pick -= e.weight[seasonId] ?? 0
    if (pick <= 0) return e
  }
  return pool[pool.length - 1]
}
