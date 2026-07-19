/**
 * Reklam katmanı — Google AdSense H5 Games Ads (Ad Placement API).
 * Sunucu /api/config'te ADSENSE_PUB verirse aktifleşir; verilmezse tüm çağrılar sessiz no-op.
 * ?adstest=1 ile sahte test reklamları (onay beklemeden akış denenir).
 */

type AdBreakFn = (opts: Record<string, unknown>) => void

let client: string | null = null
let ready = false

declare global {
  interface Window {
    adsbygoogle: unknown[]
    adBreak?: AdBreakFn
    adConfig?: (opts: Record<string, unknown>) => void
  }
}

export function adsEnabled(): boolean {
  return !!client
}

export function initAds(pubId: string, test = false) {
  if (client) return
  client = pubId
  const s = document.createElement('script')
  s.async = true
  s.src = `https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${pubId}`
  s.crossOrigin = 'anonymous'
  if (test) s.dataset.adbreakTest = 'on'
  s.dataset.adFrequencyHint = '120s' // ara reklamlar arası en az 2 dk
  document.head.appendChild(s)
  window.adsbygoogle = window.adsbygoogle || []
  window.adBreak = (o: Record<string, unknown>) => window.adsbygoogle.push(o)
  window.adConfig = (o: Record<string, unknown>) => window.adsbygoogle.push(o)
  window.adConfig({
    preloadAdBreaks: 'on',
    sound: 'on',
    onReady: () => { ready = true },
  })
}

/** doğal mola noktasında ara reklam (gün sonu gibi) — asla oynanışı bölmez */
export function interstitial(name: string, done?: () => void) {
  if (!client || !window.adBreak) { done?.(); return }
  window.adBreak({
    type: 'next',
    name,
    adBreakDone: () => done?.(),
  })
}

/**
 * Ödüllü reklam: oyuncu İSTERSE izler, izlerse ödül verilir.
 * available: reklam hazır olduğunda çağrılır (buton göstermek için)
 */
export function rewarded(
  name: string,
  onReward: () => void,
  onDone?: (watched: boolean) => void,
) {
  if (!client || !window.adBreak) { onDone?.(false); return }
  let viewed = false
  window.adBreak({
    type: 'reward',
    name,
    beforeReward: (showAdFn: () => void) => showAdFn(),
    adViewed: () => { viewed = true; onReward() },
    adDismissed: () => { viewed = false },
    adBreakDone: () => onDone?.(viewed),
  })
}

export function adsReady(): boolean {
  return ready
}
