/**
 * AI RAKİP İSTASYON (lategame raporu Katman 4d)
 *
 * Raporun gerekçesi: *"Şehir 2+'de yol karşısında AI rakip: fiyat savaşı, pazar payı
 * yüzdesi, kampanya karşılığı. Bu, fiyat kaldıracına GERÇEK bir anlam verir."*
 *
 * Bugün fiyat tek yönlü bir kaldıraç: düşür → daha çok müşteri, yükselt → daha az.
 * Rakip gelince fiyat bir MÜZAKEREYE dönüşür — rakip senin fiyatına tepki verir,
 * sen onunkine. Pazar payı iki tarafın kararlarının bileşkesi olur.
 *
 * Tasarım kısıtları:
 *  · Rakip YALNIZ ikinci şubeden sonra çıkar (rapor: "Katman 1-3 tamamlanmadan başlanmamalı").
 *  · Kasabada rakip YOK — kasaba müdavim/itibar şubesi olarak kalmalı, kimliği bozulmamalı.
 *  · Rakip asla oyuncuyu OYUNDAN ATAMAZ: pazar payının tabanı var (müdavimler + itibar).
 *  · Tamamen determinist: aynı gün + aynı fiyat = aynı tepki (test edilebilir).
 *
 * Bu dosya saf mantıktır; Three.js bilmez.
 */
import { t } from './i18n'

export interface RivalState {
  /** rakibin şu anki ortalama fiyatı (₺/L) */
  price: number
  /** rakibin gücü 0..1 — yatırım yaptıkça büyür, sen pazar aldıkça küçülür */
  strength: number
  /** rakibin aktif kampanyası varsa kaç gün kaldı */
  promoDays: number
  /** son karar günü (günde bir kez tepki verir) */
  lastDay: number
  /** rakibin açıldığı gün — etkisi buradan itibaren KADEMELİ devreye girer */
  since?: number
}

/** Rakip açıldığı gün trafiği yarıya indirseydi bu hak edilmemiş bir şok olurdu.
 *  Etkisi RAMP_DAYS gün boyunca kademeli devreye girer: "karşıya inşaat başladı,
 *  müşteriler yavaş yavaş oraya alışıyor". Oyuncunun tepki verecek zamanı olur. */
export const RIVAL_RAMP_DAYS = 10

/** Rakibin o günkü ETKİ oranı 0..1 (açılış rampası). */
export function rivalRamp(r: RivalState, day: number): number {
  const since = r.since ?? day
  return Math.max(0, Math.min(1, (day - since) / RIVAL_RAMP_DAYS))
}

/** Pazar payının rampayla yumuşatılmış hâli — entryChance bunu kullanır. */
export function effectiveShare(share: number, r: RivalState, day: number): number {
  return 1 - (1 - share) * rivalRamp(r, day)
}

/** Rakip ZAYIF doğar ve zamanla güçlenir. Yarı güçle doğsaydı, ikinci şubesini yeni açan
 *  oyuncunun akışı belirdiği an yarıya inerdi — hak edilmemiş bir şok. Böyle oyuncu önce
 *  önde başlar, rakip kendi kararlarıyla büyür. */
export function freshRival(basePrice: number, day = 1): RivalState {
  return { price: Number(basePrice.toFixed(2)), strength: 0.3, promoDays: 0, lastDay: 0, since: day }
}

/** Rakibin kişiliği: agresif fiyat kırar, kurumsal fiyatı korur. Şubeye göre sabit. */
export type RivalKind = 'agresif' | 'kurumsal'
export function rivalKindFor(locId: string): RivalKind {
  // Otoyolda kurumsal zincir (fiyat esnekliği düşük, marka oynar),
  // çevre yolu/metropolde agresif bağımsız (fiyat savaşı yeri).
  return locId === 'otoyol' ? 'kurumsal' : 'agresif'
}

export const RIVAL_NAME: Record<RivalKind, string> = {
  agresif: t('ŞİMŞEK PETROL'),
  kurumsal: t('ANADOLU ENERJİ'),
}

/**
 * PAZAR PAYI — iki istasyonun fiyat ve çekiciliğinin bileşkesi.
 *
 * Yumuşak bir logit: fiyat farkı büyüdükçe pay kayar ama asla 0/1'e gitmez.
 * `loyalty` (müdavim + itibar) oyuncunun TABANIdır — rakip ne yaparsa yapsın
 * bu tabanın altına inilmez. Raporun "rakip oyuncuyu oyundan atamaz" kuralı.
 */
export function marketShare(myPrice: number, rival: RivalState, loyalty: number, myAppeal: number): number {
  const rp = rival.promoDays > 0 ? rival.price * 0.94 : rival.price // kampanyada efektif fiyat düşer
  // fiyat farkının payı: her ₺1 fark ≈ %18 pay kayması (esnek ama uçuk değil)
  const diff = (rp - myPrice) * 0.18
  // rakibin gücü kendi çekiciliği; oyuncunun tesisleri myAppeal ile gelir
  const pull = diff + (myAppeal - rival.strength) * 0.35
  const raw = 1 / (1 + Math.exp(-pull * 3))
  // TABAN: rakip oyuncuyu OYUNDAN ATAMAZ (raporun denge kuralı).
  // 0.08 mutlak taban — sadakati sıfır, fiyatı uçuk oyuncu bile tamamen kurumaz;
  // istasyonu düzeltip geri dönebilir. Üstüne müdavim/itibar sadakati eklenir.
  const floor = Math.max(0.08, Math.min(0.45, loyalty))
  return Math.max(floor, Math.min(0.95, raw))
}

/**
 * Rakibin GÜNLÜK KARARI. Determinist (gün tohumlu) — aynı durum aynı tepkiyi verir.
 * Agresif rakip pay kaybedince fiyat kırar; kurumsal rakip fiyatını korur, kampanya açar.
 */
export interface RivalMove {
  kind: 'kes' | 'zam' | 'kampanya' | 'bekle'
  price: number
  promoDays: number
  msg: string
}

export function rivalDecide(
  r: RivalState, kind: RivalKind, day: number, myPrice: number, myShare: number, floorPrice: number,
): RivalMove {
  const x = Math.sin(day * 91.7 + (kind === 'agresif' ? 1.3 : 4.7)) * 43758.5453
  const rnd = x - Math.floor(x)
  const name = RIVAL_NAME[kind]
  // rakip pay kaybediyorsa (oyuncunun payı yüksekse) tepki verir
  const losing = myShare > 0.58
  const winning = myShare < 0.42

  if (losing) {
    if (kind === 'agresif' && r.price > floorPrice + 0.3) {
      // maliyetin altına İNMEZ: rakip de kâr etmek zorunda (sonsuz dip sarmalı yok)
      const cut = Math.min(0.5, r.price - floorPrice - 0.2)
      const np = Number((r.price - cut).toFixed(2))
      return { kind: 'kes', price: np, promoDays: r.promoDays,
        msg: t('⚔️ {0} fiyat kırdı: ₺{1}/L — pazar payını geri almaya çalışıyor!', name, np.toFixed(2)) }
    }
    if (r.promoDays <= 0 && rnd < 0.5) {
      return { kind: 'kampanya', price: r.price, promoDays: 5,
        msg: t('📣 {0} kampanya başlattı — 5 gün boyunca daha çekici olacak.', name) }
    }
    return { kind: 'bekle', price: r.price, promoDays: r.promoDays, msg: '' }
  }
  if (winning && rnd < 0.35) {
    // rahatça kazanıyorsa marjını yükseltir — oyuncuya nefes alanı açar (denge valfi)
    const np = Number((r.price + 0.25).toFixed(2))
    return { kind: 'zam', price: np, promoDays: r.promoDays,
      msg: t('💰 {0} rahatladı ve zam yaptı: ₺{1}/L — senin için fırsat!', name, np.toFixed(2)) }
  }
  return { kind: 'bekle', price: r.price, promoDays: r.promoDays, msg: '' }
}

/** Rakibin gücü zamanla değişir: sürekli kaybediyorsa zayıflar, kazanıyorsa güçlenir. */
export function updateStrength(r: RivalState, myShare: number): number {
  const drift = myShare > 0.58 ? -0.012 : myShare < 0.42 ? 0.010 : 0
  return Math.max(0.15, Math.min(0.95, r.strength + drift))
}

/** Oyuncunun pazar payı özeti — arayüzde gösterilir. */
export function shareLabel(share: number): string {
  const pct = Math.round(share * 100)
  if (pct >= 70) return t('Pazara HÂKİMSİN (%{0})', String(pct))
  if (pct >= 55) return t('Öndesin (%{0})', String(pct))
  if (pct >= 45) return t('Başa baş (%{0})', String(pct))
  return t('Geridesin (%{0})', String(pct))
}
