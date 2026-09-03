/**
 * ÖDÜLLÜ REKLAM YERLEŞİMLERİ — istemci tarafı (3 Eyl 2026, reklam stratejisi v2).
 *
 * Her yerleşimin TEK KAPISI `runPlacement(id, ...)`:
 *   1) sunucudan BİLET al (/api/ads/ticket) → yerleşim açık mı, tavan dolu mu, ödül NE KADAR
 *      (para ödülleri sunucuda kesilir: bütçe = aktif gelirin %30'u; teklif ÖNCE ve NET yazılır)
 *   2) videoyu göster (src/ads.ts) — bilet id'si SSV customData olarak sağlayıcıya gider
 *   3) /api/ads/claim → sunucu SSV'yi görmüşse ödül; görmediyse kısa süre bekle (poll)
 *   4) sonuç: { granted, amount } — EFEKT yerleşimlerinde etkiyi çağıran uygular,
 *      PARA yerleşimlerinde kasaya ekleme yine çağıranda (sunucu ad_credit ile hile frenine ekledi)
 *
 * PREMIUM ("Reklamları kaldır" IAP): A/B yerleşimleri (gün2×, offline2×, tamir, tanker)
 * OTOMATİK ve reklamsız; C/D (event, premium müşteri, trafik, kurtarma) videosuz tetiklenir.
 * İkisi de yine bilet+claim'den geçer → tavanlar premium'da da geçerli.
 *
 * MİSAFİR / META (sunucu hesabı yok): "yerel mod" — yalnız EFEKT yerleşimleri, tavanlar
 * kayıttaki adUse sayacıyla (UTC günü). PARA yerleşimleri hesaba bağlıdır (SSV hesapsız
 * olmaz) → misafir gün sonu 2×'i görmez, bunun yerine "kaydol" mesajı çıkar.
 */
import { adsEnabled, adsPlatform, adsProvider, isPremium, onAdRevenue, rewardedReady, setAdUserId, showRewarded, type AdResult } from './ads'
import { api, loggedIn } from './auth'
import { isInstantGames } from './platform'

export type PlacementId = 'gun2x' | 'offline2x' | 'tamir' | 'tanker' | 'event' | 'premium' | 'trafik' | 'kurtarma'
export type PlacementKind = 'money' | 'effect'
/** Sunucu server/reklam.js PLACEMENT_DEFAULTS ile BİREBİR (id + tür + varsayılan tavan). */
export const PLACEMENTS: Record<PlacementId, { kind: PlacementKind; cap: number; premium: 'auto' | 'novideo' }> = {
  gun2x:     { kind: 'money',  cap: 3, premium: 'auto' },
  offline2x: { kind: 'money',  cap: 4, premium: 'auto' },
  tamir:     { kind: 'effect', cap: 6, premium: 'auto' },
  tanker:    { kind: 'effect', cap: 3, premium: 'auto' },
  event:     { kind: 'effect', cap: 2, premium: 'novideo' },
  premium:   { kind: 'effect', cap: 3, premium: 'novideo' },
  trafik:    { kind: 'effect', cap: 2, premium: 'novideo' },
  kurtarma:  { kind: 'money',  cap: 1, premium: 'novideo' },
}
export const PLACEMENT_IDS = Object.keys(PLACEMENTS) as PlacementId[]

export interface PlacementState { enabled: boolean; cap: number; used: number; left: number; kind: PlacementKind; premium: 'auto' | 'novideo' }
export interface AdState {
  uid: string; premium: boolean; day: string; ratio: number
  budget: { gain7: number; ad7: number; left: number }
  placements: Record<PlacementId, PlacementState>
  pending: { ticket: string; placement: PlacementId; amount: number; meta: Record<string, unknown> | null }[]
  nofillLeft: number
}
export interface RunResult { granted: boolean; amount: number; reason?: string; watched: boolean; meta?: Record<string, unknown> | null }
export interface Ticket { ok: boolean; ticket?: string; amount: number; premium?: boolean; premiumMode?: 'auto' | 'novideo'; reason?: string }

let cache: AdState | null = null
let cacheAt = 0
let syncing: Promise<AdState | null> | null = null
/** Geç gelen ödüller (SSV gecikti, oyuncu ekranı kapattı): main.ts efekti/parayı uygular. */
let grantCb: ((placement: PlacementId, amount: number, meta: Record<string, unknown> | null) => void) | null = null
export function onLateGrant(cb: typeof grantCb) { grantCb = cb }

/** YEREL MOD: hesap yok (misafir) veya Meta — sunucu bileti yok, yalnız efekt yerleşimleri. */
export function localMode(): boolean { return isInstantGames() || !loggedIn() }

// ---- yerel tavan sayacı (misafir/Meta): UTC günü + yerleşim başına sayı; kayda girer (main.ts adUse) ----
export interface AdUse { day: string; n: Partial<Record<PlacementId, number>> }
const utcDay = () => new Date().toISOString().slice(0, 10)
export function adUseToday(u: AdUse | null | undefined): AdUse {
  return u && u.day === utcDay() ? u : { day: utcDay(), n: {} }
}

export async function syncAdState(force = false): Promise<AdState | null> {
  if (localMode()) return null
  if (!force && cache && Date.now() - cacheAt < 60_000) return cache
  if (syncing) return syncing
  syncing = (async () => {
    try {
      const st = await api('/api/ads/state', 'GET') as unknown as AdState
      cache = st; cacheAt = Date.now()
      if (st.uid) setAdUserId(st.uid)
      // SSV geç geldiyse ödül burada yakalanır (oyuncu videodan sonra uygulamayı kapatmış olabilir)
      for (const p of st.pending || []) {
        try {
          const c = await api('/api/ads/claim', 'POST', { ticket: p.ticket, result: 'reward' }) as { granted?: boolean; amount?: number }
          if (c.granted) grantCb?.(p.placement, Number(c.amount) || 0, p.meta)
        } catch { /* sonraki senkronda */ }
      }
      return st
    } catch { return cache } finally { syncing = null }
  })()
  return syncing
}
export function adState(): AdState | null { return cache }

/** Bu yerleşim ŞU AN teklif edilebilir mi (buton çıkmadan önce ucuz kontrol; para/tavan kararı sunucuda). */
export function canOffer(id: PlacementId, adUse?: AdUse | null): boolean {
  const def = PLACEMENTS[id]
  if (localMode()) {
    if (def.kind === 'money') return false                       // para ödülü hesap ister
    if (!adsEnabled() || !rewardedReady()) return false
    const u = adUseToday(adUse)
    return (u.n[id] ?? 0) < def.cap
  }
  if (!isPremium() && (!adsEnabled() || !rewardedReady())) return false
  if (!cache) return true                                        // henüz senkron yok: sunucu karar verir
  const p = cache.placements?.[id]
  if (!p) return true
  return p.enabled && p.left > 0
}

function telemetry(placement: string, event: string, extra: Record<string, unknown> = {}) {
  fetch('/api/ads/telemetry', {
    method: 'POST', headers: { 'content-type': 'application/json', 'x-auth': localStorage.getItem('benzinlik-token') ?? '' },
    body: JSON.stringify({ placement, event, provider: adsProvider(), platform: adsPlatform(), ...extra }),
  }).catch(() => {})
}
onAdRevenue(r => telemetry(r.placement, 'revenue', { revenue: r.revenue, network: r.networkName }))
/** ölçüm (analiz E14): izlenen her rewarded reklam saatlik sayaca yazılır */
function countAdView() {
  fetch('/api/metric', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ k: 'ad_views' }) }).catch(() => {})
}

/** Bilet iste — teklif ETİKETİ için (tutar sunucuda kesilmiş hâliyle gelir). */
export async function requestTicket(id: PlacementId, amount = 0, meta: Record<string, unknown> | null = null): Promise<Ticket> {
  if (localMode()) return PLACEMENTS[id].kind === 'money' ? { ok: false, amount: 0, reason: 'login' } : { ok: true, amount: 0 }
  try {
    const r = await api('/api/ads/ticket', 'POST', { placement: id, amount, meta, provider: adsProvider(), platform: adsPlatform() }) as unknown as Ticket
    if (r.ok) {
      // sunucu tavan sayacını cache'te de ilerlet ki aynı dakikada ikinci teklif çıkmasın
      if (cache?.placements?.[id]) { const p = cache.placements[id]; p.left = Math.max(0, p.cap - (Number((r as any).used) || p.used)) }
    } else if (cache?.placements?.[id] && (r.reason === 'cap' || r.reason === 'disabled')) {
      cache.placements[id].left = 0
    }
    return r
  } catch (e) {
    return { ok: false, amount: 0, reason: (e as Error).message || 'net' }
  }
}

async function claim(ticket: string, result: 'reward' | 'nofill' | 'web' | 'premium'): Promise<{ granted: boolean; amount: number; pending?: boolean; reason?: string; meta?: Record<string, unknown> | null }> {
  const c = await api('/api/ads/claim', 'POST', { ticket, result }) as any
  return { granted: !!c.granted, amount: Number(c.amount) || 0, pending: !!c.pending, reason: c.reason || c.error, meta: c.meta ?? null }
}

/**
 * Yerleşimi ÇALIŞTIR: bilet → video → claim. Çağıran ödülü/efekti `granted` ise uygular.
 * opts.ticket: etiket için önceden alınmış bilet (tutar zaten biliniyor).
 * opts.adUse: yerel modda tavan sayacı (çağıran kaydeder; burada ilerletilir).
 */
export async function runPlacement(id: PlacementId, opts: { amount?: number; meta?: Record<string, unknown> | null; ticket?: Ticket; adUse?: AdUse } = {}): Promise<RunResult> {
  const def = PLACEMENTS[id]
  // ---- YEREL MOD (misafir/Meta): sunucu yok, efekt yerleşimi, video şart ----
  if (localMode()) {
    if (def.kind === 'money') return { granted: false, amount: 0, reason: 'login', watched: false }
    const u = adUseToday(opts.adUse)
    if ((u.n[id] ?? 0) >= def.cap) return { granted: false, amount: 0, reason: 'cap', watched: false }
    telemetry(id, 'start')
    const r = await showRewarded(id, '')
    if (r === 'reward' || r === 'nofill') {
      // fill yoksa ödül yine verilir (oyuncu cezalandırılmaz); yerelde de günlük tavan korur
      if (opts.adUse) { opts.adUse.day = u.day; opts.adUse.n = u.n; u.n[id] = (u.n[id] ?? 0) + 1 }
      if (r === 'reward') countAdView()
      telemetry(id, r === 'reward' ? 'complete' : 'nofill')
      return { granted: true, amount: 0, watched: r === 'reward', reason: r === 'nofill' ? 'nofill' : undefined }
    }
    telemetry(id, r === 'dismiss' ? 'abort' : 'error')
    return { granted: false, amount: 0, reason: r, watched: false }
  }
  // ---- SUNUCU MODU ----
  const tk = opts.ticket ?? await requestTicket(id, opts.amount ?? 0, opts.meta ?? null)
  if (!tk.ok || !tk.ticket) return { granted: false, amount: 0, reason: tk.reason || 'ticket', watched: false }
  try {
    // PREMIUM: reklamsız ödül — sunucu noAds'i kendisi doğrular
    if (tk.premium || isPremium()) {
      const c = await claim(tk.ticket, 'premium')
      return { granted: c.granted, amount: c.amount, reason: c.reason, watched: false, meta: c.meta }
    }
    telemetry(id, 'start')
    const r: AdResult = await showRewarded(id, tk.ticket)
    if (r === 'dismiss') { telemetry(id, 'abort'); return { granted: false, amount: 0, reason: 'dismiss', watched: false } }
    if (r === 'none') return { granted: false, amount: 0, reason: 'none', watched: false }
    if (r === 'nofill' || r === 'error') {
      telemetry(id, r)
      const c = await claim(tk.ticket, 'nofill')   // sunucu günde 2 ile sınırlar ([ad-nofill] reward-granted)
      return { granted: c.granted, amount: c.amount, reason: c.granted ? 'nofill' : c.reason, watched: false, meta: c.meta }
    }
    // r === 'reward'
    countAdView(); telemetry(id, 'complete')
    if (adsPlatform() === 'web') {
      const c = await claim(tk.ticket, 'web')       // AdSense: SSV yok, sunucu 'web' damgasıyla sayar
      return { granted: c.granted, amount: c.amount, reason: c.reason, watched: true, meta: c.meta }
    }
    // native: SSV callback'i sağlayıcıdan sunucuya gider — genelde 1-3 sn; 15 sn'ye kadar bekle
    for (let i = 0; i < 10; i++) {
      const c = await claim(tk.ticket, 'reward')
      if (c.granted) return { granted: true, amount: c.amount, watched: true, meta: c.meta }
      if (!c.pending) return { granted: false, amount: 0, reason: c.reason || 'claim', watched: true }
      await new Promise(res => setTimeout(res, 1500))
    }
    // SSV hâlâ yok: ödül kaybolmaz — bir sonraki syncAdState() 'pending' listesinden alır (onLateGrant)
    return { granted: false, amount: 0, reason: 'ssv-late', watched: true }
  } catch (e) {
    return { granted: false, amount: 0, reason: (e as Error).message || 'net', watched: false }
  }
}
