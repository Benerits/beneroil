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

/** LIGHT MOD: Meta'da post-processing/gölge/antialias kapalı, dokular küçük.
 *  Instant Games düşük seviye Android'de bir iframe içinde çalışıyor — bloom + gölge
 *  en olası donma/çökme sebebi. Web ve iOS mevcut görünümünü aynen korur. */
export function isLightMode(): boolean {
  return isInstantGames()
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
