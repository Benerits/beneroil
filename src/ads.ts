/**
 * Reklam SAĞLAYICI katmanı (3 Eyl 2026, reklam stratejisi v2) — yalnız REWARDED.
 *
 * Interstitial/zorunlu reklam YOK (ürün kararı): oyuncunun önüne aniden reklam çıkmaz,
 * her reklam "izle → kazan" teklifidir. Bu dosya SADECE "videoyu göster, sonucu söyle" işini
 * yapar; yerleşimler, tavanlar, bilet/SSV akışı src/reklam.ts'te.
 *
 * Üç hedef:
 *  - NATIVE (iOS/Android, Capacitor): AppLovin MAX — uygulama içi `AppLovinMax` plugin'i
 *    (beneloil-ios / beneloil-android repolarında Swift/Kotlin). SDK anahtarı ve ad unit
 *    id'leri sunucudan gelir (/api/config → ads.applovin). AdMob KALDIRILDI.
 *  - WEB: Google AdSense H5 Games Ads (Ad Placement API), ADSENSE_PUB verilirse.
 *    Sunucu-taraflı doğrulama (SSV) yoktur; sunucu web ödüllerini ayrı damgayla sayar.
 *  - META (Facebook Instant Games): FBInstant rewarded (bkz. fbinstant.ts).
 */
import { isNativePlatform, isInstantGames } from './platform'
import { instantAdsEnabled, instantRewardedReady, showInstantRewarded } from './fbinstant'

/** Bir gösterim denemesinin sonucu. 'nofill' = reklam yoktu (ödül yine verilir, sunucu sınırlı). */
export type AdResult = 'reward' | 'dismiss' | 'nofill' | 'error' | 'none'
export type AdProvider = 'applovin' | 'adsense' | 'fbinstant' | null
export type AdPlatform = 'ios' | 'android' | 'web' | 'fb'

type AdBreakFn = (opts: Record<string, unknown>) => void
declare global {
  interface Window {
    adsbygoogle: unknown[]
    adBreak?: AdBreakFn
    adConfig?: (opts: Record<string, unknown>) => void
  }
}

export interface AppLovinCfg { sdkKey: string; iosRewarded?: string | null; androidRewarded?: string | null }
export interface AdsCfg { adsensePub?: string | null; applovin?: AppLovinCfg | null; test?: boolean; userId?: string | null }
export interface AdRevenue { placement: string; revenue: number; networkName: string; precision: string }

let webClient: string | null = null
let native = false
let plugin: any = null            // window.Capacitor.Plugins.AppLovinMax
let adUnitId = ''                 // bu platformun rewarded ad unit'i
let premium = false               // "Reklamları kaldır" satın alındı
let nativeReady = false           // rewardedLoaded geldi, rewardedHidden/LoadFailed ile düşer
let nativeNetwork = ''
let pendingShow: { resolve: (r: AdResult) => void; rewarded: boolean; placement: string } | null = null
let revenueCb: ((r: AdRevenue) => void) | null = null
let nativeInitError = ''          // teşhis için (Ayarlar > reklam durumu)

function capPlugin(name: string): any {
  return (window as unknown as { Capacitor?: { Plugins?: Record<string, any> } }).Capacitor?.Plugins?.[name] ?? null
}

export function adsPlatform(): AdPlatform {
  if (isInstantGames()) return 'fb'
  if (isNativePlatform()) return ((window as any).Capacitor?.getPlatform?.() ?? 'ios') === 'android' ? 'android' : 'ios'
  return 'web'
}
export function adsProvider(): AdProvider {
  if (isInstantGames()) return instantAdsEnabled() ? 'fbinstant' : null
  if (native) return plugin && adUnitId ? 'applovin' : null
  return webClient ? 'adsense' : null
}
export function adsEnabled(): boolean { return adsProvider() !== null }
export function setPremium(v: boolean) { premium = v }
export function isPremium(): boolean { return premium }
/** Gelir telemetrisi (impression-level, MAX'ten): reklam.ts sunucuya iletir. */
export function onAdRevenue(cb: (r: AdRevenue) => void) { revenueCb = cb }
export function adsDiagnostic(): string {
  return `provider=${adsProvider() ?? 'yok'} platform=${adsPlatform()} ready=${rewardedReady()}${nativeInitError ? ' err=' + nativeInitError : ''}`
}

const WEB_ADSENSE = false

/** Reklam altyapısını başlat. cfg: sunucu /api/config'ten (adsense pub + applovin anahtarları). */
export async function initAds(cfg: AdsCfg = {}) {
  // META: reklamlar FBInstant SDK'sından, placement id'ler derleme zamanı env'iyle (fbinstant.ts)
  if (isInstantGames()) return
  native = isNativePlatform()
  if (native) {
    const P = capPlugin('AppLovinMax')
    if (!P) { nativeInitError = 'plugin-yok'; return }      // eski kabuk (AdMob dönemi) → reklam yok, sessiz
    const al = cfg.applovin
    if (!al?.sdkKey) { nativeInitError = 'sdkkey-yok'; return }
    adUnitId = (adsPlatform() === 'android' ? al.androidRewarded : al.iosRewarded) || ''
    if (!adUnitId) { nativeInitError = 'adunit-yok'; return }
    plugin = P
    try {
      P.addListener('rewardedLoaded', (e: any) => { nativeReady = true; nativeNetwork = String(e?.networkName ?? '') })
      P.addListener('rewardedLoadFailed', () => { nativeReady = false })
      P.addListener('rewardedDisplayed', () => { nativeReady = false })
      P.addListener('rewardedDisplayFailed', () => { nativeReady = false; settle('error') })
      P.addListener('rewardedReward', () => { if (pendingShow) pendingShow.rewarded = true })
      P.addListener('rewardedHidden', () => { settle(pendingShow?.rewarded ? 'reward' : 'dismiss') })
      P.addListener('rewardedRevenue', (e: any) => {
        revenueCb?.({ placement: String(e?.placement ?? pendingShow?.placement ?? ''), revenue: Number(e?.revenue) || 0,
          networkName: String(e?.networkName ?? ''), precision: String(e?.revenuePrecision ?? '') })
      })
      // ATT YOK: izin istemiyoruz, izlemiyoruz → App Privacy 'Tracking: No', NSUserTrackingUsageDescription gerekmez.
      await P.initialize({ sdkKey: al.sdkKey, userId: cfg.userId ?? undefined, verbose: !!cfg.test })
      await P.loadRewarded({ adUnitId })
    } catch (e) {
      nativeInitError = String((e as Error)?.message ?? e)
      plugin = null
    }
    return
  }
  // WEB: AdSense H5 — KAPALI (4 Eyl 2026): tarayıcıda hiçbir reklam yüzeyi yok (reklam.ts canOffer /
  // main.ts reklamAktif web'de false), o yüzden script de yüklenmez. Geri açmak için WEB_ADSENSE=true.
  if (!WEB_ADSENSE || !cfg.adsensePub || webClient) return
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

/** SSV {USER_ID} makrosu: sunucunun verdiği takma ad (e-posta DEĞİL). Giriş sonrası çağrılır. */
export async function setAdUserId(uid: string) {
  if (!native || !plugin) return
  try { await plugin.setUserId({ userId: uid }) } catch { /* yok say */ }
}

function settle(r: AdResult) {
  const p = pendingShow
  pendingShow = null
  p?.resolve(r)
}

/** rewarded reklam hazır mı (buton göstermek için). Native'de plugin yüklemeyi tamamladıysa. */
export function rewardedReady(): boolean {
  if (isInstantGames()) return instantRewardedReady()
  if (native) return !!plugin && nativeReady
  return !!webClient
}

/**
 * Ödüllü videoyu göster. customData = sunucu bileti (SSV {CUSTOM_DATA} makrosu).
 * Reklam yoksa 'nofill' döner — oyuncu cezalandırılmaz, ödül kararı sunucuda (reklam.ts).
 */
export function showRewarded(placement: string, customData: string): Promise<AdResult> {
  if (premium) return Promise.resolve('none')
  if (isInstantGames()) {
    if (!instantRewardedReady()) return Promise.resolve('nofill')
    return new Promise(resolve => {
      let got = false
      showInstantRewarded(() => { got = true }, watched => resolve(got || watched ? 'reward' : 'dismiss'))
    })
  }
  if (native) {
    if (!plugin || !adUnitId) return Promise.resolve('none')
    if (!nativeReady) { plugin.loadRewarded({ adUnitId }).catch(() => {}); return Promise.resolve('nofill') }
    if (pendingShow) return Promise.resolve('error')
    return new Promise<AdResult>(resolve => {
      pendingShow = { resolve, rewarded: false, placement }
      // 90 sn içinde hidden gelmezse (plugin/SDK takıldı) askıda kalma
      const timer = setTimeout(() => { if (pendingShow?.resolve === resolve) settle('error') }, 90_000)
      plugin.showRewarded({ adUnitId, placement, customData }).then((r: any) => {
        if (r && r.shown === false) { clearTimeout(timer); settle('nofill') }
      }).catch(() => { clearTimeout(timer); settle('error') })
    })
  }
  if (webClient && window.adBreak) {
    return new Promise(resolve => {
      let viewed = false, shown = false
      window.adBreak!({
        type: 'reward', name: placement,
        beforeReward: (showAdFn: () => void) => { shown = true; showAdFn() },
        adViewed: () => { viewed = true },
        adDismissed: () => { viewed = false },
        adBreakDone: () => resolve(viewed ? 'reward' : shown ? 'dismiss' : 'nofill'),
      })
    })
  }
  return Promise.resolve('none')
}
