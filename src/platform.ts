/** Çalışma ortamı tespiti — mobil-özel davranışların tek kaynağı.
 *  Circular import olmadan hem main.ts hem ui.ts kullanabilsin diye ayrı modül. */

/** Capacitor native kabuk (iOS/Android) içinde mi çalışıyoruz? */
export function isNativePlatform(): boolean {
  const cap = (window as unknown as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor
  return !!cap?.isNativePlatform?.()
}
