/** Çalışma ortamı tespiti — mobil-özel davranışların tek kaynağı.
 *  Circular import olmadan hem main.ts hem ui.ts kullanabilsin diye ayrı modül. */

/** Capacitor native kabuk (iOS/Android) içinde mi çalışıyoruz? */
export function isNativePlatform(): boolean {
  const cap = (window as unknown as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor
  return !!cap?.isNativePlatform?.()
}

/** Statik varlık (public/) yolu.
 *  Web/iOS'ta bundle kökten servis edilir → '/kenney/x.glb' çalışır. Meta'da ise bundle
 *  sürüm klasöründen servis edilir (apps-<id>.fbsbx.com/instantgames/<id>/<v>/) ve mutlak
 *  yollar 404 verir. public/ altındaki HER varlık bu fonksiyondan geçmeli.
 *  BASE_URL: normal build'de '/', meta build'inde './' (vite.config.ts). */
export function asset(path: string): string {
  const base = (import.meta.env?.BASE_URL ?? '/').replace(/\/$/, '')
  return base + (path.startsWith('/') ? path : '/' + path)
}

/** Facebook Instant Games kabuğu içinde miyiz?
 *  FBInstant SDK script'i YALNIZ meta build'ine enjekte edilir (vite.config.ts, mode=meta),
 *  dolayısıyla varlığı tek başına güvenilir bir hedef göstergesi. */
export function isInstantGames(): boolean {
  return typeof (window as unknown as { FBInstant?: unknown }).FBInstant !== 'undefined'
}

/** MOBİL CİHAZ (telefon/tablet) — dokunmatik + dar ekran.
 *  Capacitor (iOS/Android uygulaması) ve mobil tarayıcı ikisini de kapsar. */
export function isMobileDevice(): boolean {
  if (typeof window === 'undefined') return false
  const cap = (window as unknown as { Capacitor?: { getPlatform?: () => string } }).Capacitor
  const plat = cap?.getPlatform?.()
  if (plat === 'ios' || plat === 'android') return true
  const ua = navigator.userAgent || ''
  const dokunmatik = (navigator.maxTouchPoints ?? 0) > 0
  return dokunmatik && (/iPhone|iPad|iPod|Android/i.test(ua) || Math.min(screen.width, screen.height) <= 820)
}

/** LIGHT MOD: post-processing/gölge/antialias kapalı, dokular küçük.
 *
 *  30 Ağu — MOBİL DE KAPSAMA ALINDI. Ölçüm: dolu istasyonda 971 ayrı mesh + 621 materyal
 *  çiziliyor ve gölge haritası her karede sıfırdan üretiliyordu; sahne fiilen iki kez
 *  çiziliyor. Oyuncu şikayetleri bunu doğruluyor: "şarj normal oyunlara göre aşırı
 *  derecede" (#739, iPhone), "iphone'da da mac air'de de inanılmaz ısı" (#752),
 *  "başlarda ısıtmıyordu şimdi baya ısınıyor" (#959). Ayrıca iPhone'da devicePixelRatio
 *  3 — 1.5'e sınırlamak bile ~740k piksel demek; LIGHT modda 1.0'a inince doldurma
 *  maliyeti 2.25× düşüyor.
 *
 *  Masaüstü tarayıcı görünümü AYNEN korunur. */
export function isLightMode(): boolean {
  return isInstantGames() || isMobileDevice()
}

/** Doku yolu. Light modda optimize edilmiş 512px JPEG'e yönlendirir
 *  (tools/optimize-textures.mjs üretir; 4,8 MB → 274 KB).
 *  Tekrarlayan zemin dokusu olduğu için çözünürlük düşüşü gözle ayırt edilmez. */
export function texture(path: string): string {
  if (isLightMode() && path.startsWith('/gen/ground_')) {
    return asset(path.replace('/gen/', '/gen/opt/').replace(/\.png$/, '.jpg'))
  }
  return asset(path)
}
