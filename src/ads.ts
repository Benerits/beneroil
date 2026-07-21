/**
 * Reklam katmanı — İKİ hedef:
 *  - NATIVE (iOS/Android, Capacitor): Google AdMob (@capacitor-community/admob plugin).
 *    Gerçek ad-unit ID'leri /api/config → ads.admob ile gelir; yoksa Google resmi TEST
 *    reklamları kullanılır (demo çalışır, sen sonra gerçek key'leri girersin).
 *  - WEB: Google AdSense H5 Games Ads (Ad Placement API), ADSENSE_PUB verilirse.
 *
 * Interstitial pacing (game-ads-pacing skill): grace (gün 3+), oturum ısınması (90 sn),
 * min ara (150 sn), oturum başına cap, KAYIP günde gösterme, premium'da hiç gösterme.
 * Rewarded (fırsatlar): opt-in, sınırsız, gün 1'den — "reklam = değer" hissi.
 */
import { isNativePlatform } from './platform'

// --- Google resmi TEST ad unit'leri (gerçek key'ler gelene dek demo) ---
const TEST_UNITS = {
  ios: { interstitial: 'ca-app-pub-3940256099942544/4411468910', rewarded: 'ca-app-pub-3940256099942544/1712485313' },
  android: { interstitial: 'ca-app-pub-3940256099942544/1033173712', rewarded: 'ca-app-pub-3940256099942544/5224354917' },
}

type AdBreakFn = (opts: Record<string, unknown>) => void
declare global {
  interface Window {
    adsbygoogle: unknown[]
    adBreak?: AdBreakFn
    adConfig?: (opts: Record<string, unknown>) => void
  }
}

interface AdMobCfg { iosInterstitial?: string; iosRewarded?: string; androidInterstitial?: string; androidRewarded?: string; testMode?: boolean }

let webClient: string | null = null
let native = false
let admob: any = null
let admobCfg: { interstitial: string; rewarded: string; test: boolean } | null = null
let premium = false // remove-ads satın alındıysa interstitial gösterilmez

function capPlugin(name: string): any {
  return (window as unknown as { Capacitor?: { Plugins?: Record<string, any> } }).Capacitor?.Plugins?.[name] ?? null
}

export function adsEnabled(): boolean { return !!webClient || !!admob }
export function setPremium(v: boolean) { premium = v }

/** Reklam altyapısını başlat. cfg: sunucu /api/config'ten (adsense pub + admob unit'leri). */
export async function initAds(cfg: { adsensePub?: string; admob?: AdMobCfg; test?: boolean } = {}) {
  native = isNativePlatform()
  if (native) {
    const AdMob = capPlugin('AdMob')
    if (!AdMob) return // plugin kurulu değil (iOS repo'da @capacitor-community/admob gerekir) → sessiz no-op
    admob = AdMob
    const isIos = ((window as any).Capacitor?.getPlatform?.() ?? 'ios') === 'ios'
    const useTest = cfg.test ?? cfg.admob?.testMode ?? !((isIos ? cfg.admob?.iosInterstitial : cfg.admob?.androidInterstitial))
    admobCfg = {
      interstitial: (isIos ? cfg.admob?.iosInterstitial : cfg.admob?.androidInterstitial) || (isIos ? TEST_UNITS.ios.interstitial : TEST_UNITS.android.interstitial),
      rewarded: (isIos ? cfg.admob?.iosRewarded : cfg.admob?.androidRewarded) || (isIos ? TEST_UNITS.ios.rewarded : TEST_UNITS.android.rewarded),
      test: useTest,
    }
    try {
      await admob.initialize({ initializeForTesting: useTest })
      await prepareInterstitial()
      await prepareRewarded()
    } catch { admob = null }
    return
  }
  // WEB: AdSense H5
  if (!cfg.adsensePub || webClient) return
  webClient = cfg.adsensePub
  const s = document.createElement('script')
  s.async = true
  s.src = `https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${webClient}`
  s.crossOrigin = 'anonymous'
  if (cfg.test) s.dataset.adbreakTest = 'on'
  s.dataset.adFrequencyHint = '150s'
  document.head.appendChild(s)
  window.adsbygoogle = window.adsbygoogle || []
  window.adBreak = (o) => window.adsbygoogle.push(o)
  window.adConfig = (o) => window.adsbygoogle.push(o)
  window.adConfig({ preloadAdBreaks: 'on', sound: 'on' })
}

async function prepareInterstitial() {
  if (!admob || !admobCfg) return
  try { await admob.prepareInterstitial({ adId: admobCfg.interstitial, isTesting: admobCfg.test }) } catch { /* yok say */ }
}
async function prepareRewarded() {
  if (!admob || !admobCfg) return
  try { await admob.prepareRewardVideoAd({ adId: admobCfg.rewarded, isTesting: admobCfg.test }) } catch { /* yok say */ }
}

// ---- Interstitial pacing policy (pure-ish; game-ads-pacing skill) ----
const GRACE_DAY = 3        // gün 3'e kadar hiç interstitial (oyuncu bağlanana dek)
const WARMUP_MS = 90_000   // oturum başı ilk 90 sn interstitial yok
const MIN_GAP_MS = 150_000 // interstitial'lar arası en az 2.5 dk
const SESSION_CAP = 4      // oturum başına en fazla
let sessionStart = Date.now()
let lastInterstitialAt = 0
let shownThisSession = 0
export function beginAdSession() { sessionStart = Date.now(); shownThisSession = 0; lastInterstitialAt = 0 }
/** interstitial gösterilebilir mi? (gün, kâr mı) — KAYIP günde ve grace/warmup/cap/gap içinde gösterme */
export function mayShowInterstitial(day: number, won: boolean): boolean {
  if (premium || !adsEnabled()) return false
  const now = Date.now()
  if (day < GRACE_DAY) return false
  if (!won) return false // frustrasyonu paraya çevirme: zarar günü reklamsız
  if (now - sessionStart < WARMUP_MS) return false
  if (now - lastInterstitialAt < MIN_GAP_MS) return false
  if (shownThisSession >= SESSION_CAP) return false
  return true
}

/** doğal mola (gün sonu) interstitial — policy'yi uygula, uygunsa göster */
export function interstitial(name: string, opts: { day: number; won: boolean }, done?: () => void) {
  if (!mayShowInterstitial(opts.day, opts.won)) { done?.(); return }
  lastInterstitialAt = Date.now(); shownThisSession++
  if (native && admob) {
    admob.showInterstitial().catch(() => {}).finally(() => { prepareInterstitial(); done?.() })
    return
  }
  if (webClient && window.adBreak) { window.adBreak({ type: 'next', name, adBreakDone: () => done?.() }); return }
  done?.()
}

/** Ödüllü reklam (fırsatlar): oyuncu isterse izler → ödül. onDone(watched). */
export function rewarded(name: string, onReward: () => void, onDone?: (watched: boolean) => void) {
  if (native && admob) {
    let ok = false
    // capacitor-community/admob: rewarded ödülü event ile gelir; basitleştirilmiş akış
    admob.addListener?.('onRewardedVideoAdReward', () => { ok = true })
    admob.showRewardVideoAd().then((r: any) => {
      if (r?.type || ok) { ok = true; onReward() }
      onDone?.(ok)
    }).catch(() => onDone?.(false)).finally(() => prepareRewarded())
    return
  }
  if (webClient && window.adBreak) {
    let viewed = false
    window.adBreak({
      type: 'reward', name,
      beforeReward: (showAdFn: () => void) => showAdFn(),
      adViewed: () => { viewed = true; onReward() },
      adDismissed: () => { viewed = false },
      adBreakDone: () => onDone?.(viewed),
    })
    return
  }
  onDone?.(false)
}

/** rewarded reklam hazır mı (buton göstermek için) — native'de her zaman dene, web'de client varsa */
export function rewardedReady(): boolean { return adsEnabled() }
