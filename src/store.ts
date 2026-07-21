/**
 * Uygulama içi satın alma (IAP) altyapısı.
 *  - NATIVE (iOS): Capacitor IAP plugin'i üzerinden gerçek satın alma.
 *    (iOS repo'da @capacitor-community/in-app-purchases veya RevenueCat kurulur;
 *     ürün ID'leri App Store Connect'te tanımlanır. Kod plugin'i otomatik bulur,
 *     yoksa satın alma butonları "yakında" olarak devre dışı kalır.)
 *  - WEB: IAP yok → satın alma devre dışı (yalnız uygulamada).
 *
 * Efektler (reklam kaldır / nakit) TAM implemente; yalnız plugin+key katmanı sende.
 */
import { isNativePlatform } from './platform'

export interface Product {
  id: string
  title: string
  desc: string
  kind: 'noads' | 'coins'
  coins?: number
  price: string // App Store'dan gerçek fiyat gelene dek gösterilecek varsayılan
}

// App Store Connect'te bu ID'lerle ürün tanımla (com.benerits.beneloil.*)
export const PRODUCTS: Product[] = [
  { id: 'remove_ads', title: 'Reklamları Kaldır', desc: 'Gün sonu reklamları tamamen kapanır. Ödüllü fırsat reklamları (istersen) kalır.', kind: 'noads', price: '₺49,99' },
  { id: 'coins_5k', title: '5.000 ₺ Nakit', desc: 'Kasana anında +5.000 ₺.', kind: 'coins', coins: 5000, price: '₺14,99' },
  { id: 'coins_20k', title: '20.000 ₺ Nakit', desc: 'Kasana anında +20.000 ₺.', kind: 'coins', coins: 20000, price: '₺39,99' },
  { id: 'coins_75k', title: '75.000 ₺ Nakit', desc: 'Kasana anında +75.000 ₺ — en avantajlı paket.', kind: 'coins', coins: 75000, price: '₺99,99' },
]

function iapPlugin(): any {
  const P = (window as unknown as { Capacitor?: { Plugins?: Record<string, any> } }).Capacitor?.Plugins
  return P?.InAppPurchases ?? P?.Purchases ?? P?.CdvPurchase ?? null
}

/** IAP kullanılabilir mi (native + plugin kurulu) */
export function storeAvailable(): boolean {
  return isNativePlatform() && !!iapPlugin()
}

let inited = false
/** Store'u başlat + ürünleri (gerçek fiyatlarıyla) yükle. Plugin yoksa sessiz. */
export async function initStore(): Promise<void> {
  if (inited) return
  const P = iapPlugin()
  if (!P) return
  inited = true
  try {
    // @capacitor-community/in-app-purchases şeması (gerekirse iOS repo'da uyarlanır)
    if (P.getProducts) {
      const res = await P.getProducts({ productIds: PRODUCTS.map(p => p.id) })
      const list = res?.products ?? res ?? []
      for (const rp of list) {
        const local = PRODUCTS.find(p => p.id === (rp.id ?? rp.productId))
        if (local && (rp.price ?? rp.priceString)) local.price = rp.price ?? rp.priceString
      }
    }
  } catch { /* yok say */ }
}

/**
 * Satın alma. Başarılıysa true döner → çağıran efekti uygular (grantEffect).
 * Plugin yoksa false (buton zaten devre dışı olmalı).
 */
export async function purchase(productId: string): Promise<boolean> {
  const P = iapPlugin()
  if (!P) return false
  try {
    const fn = P.purchaseProduct ?? P.purchase ?? P.order
    if (!fn) return false
    const r = await fn.call(P, { productId })
    // başarı sinyali plugin'e göre değişir; hata fırlatmadıysa satın alındı say
    return r?.transaction?.transactionState !== 'failed' && r?.responseCode !== 'error'
  } catch { return false }
}

/** Satın almaları geri yükle (App Store zorunluluğu — non-consumable remove_ads için). */
export async function restore(): Promise<string[]> {
  const P = iapPlugin()
  if (!P) return []
  try {
    const fn = P.restorePurchases ?? P.restore
    if (!fn) return []
    const r = await fn.call(P)
    const items = r?.purchases ?? r?.transactions ?? r ?? []
    return items.map((x: any) => x.productId ?? x.id).filter(Boolean)
  } catch { return [] }
}
