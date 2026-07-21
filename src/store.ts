/**
 * Uygulama içi satın alma (IAP) altyapısı — RevenueCat.
 *  - NATIVE (iOS): @revenuecat/purchases-capacitor üzerinden gerçek satın alma.
 *    Kurulum (sende): 1) RevenueCat panelinde iOS app + public SDK key → sunucuda
 *    REVENUECAT_IOS_KEY env. 2) App Store Connect'te ürünler PRODUCTS ID'leriyle
 *    (remove_ads non-consumable, coins_* consumable). 3) RC panelinde ürünleri ekle
 *    (remove_ads için 'remove_ads' entitlement önerilir). Key yoksa butonlar devre dışı.
 *  - WEB: IAP yok → satın alma devre dışı (yalnız uygulamada).
 *
 * Efektler (reklam kaldır / nakit) TAM implemente; yalnız RC key + ASC ürünleri sende.
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

// RevenueCat Capacitor plugin (@revenuecat/purchases-capacitor) → window.Capacitor.Plugins.Purchases
function rc(): any {
  return (window as unknown as { Capacitor?: { Plugins?: Record<string, any> } }).Capacitor?.Plugins?.Purchases ?? null
}

/** IAP kullanılabilir mi (native + RevenueCat plugin kurulu) */
export function storeAvailable(): boolean {
  return isNativePlatform() && !!rc()
}

let configured = false
let rcProducts: any[] = [] // RevenueCat StoreProduct nesneleri (satın almada gerekli)

/**
 * RevenueCat'i başlat + ürünleri gerçek App Store fiyatlarıyla yükle.
 * apiKey = /api/config → revenuecatIos (RevenueCat public SDK key). Yoksa sessizce pas geçer.
 * RevenueCat panelinde ürün ID'leri PRODUCTS ile birebir aynı olmalı; remove_ads non-consumable,
 * coins_* consumable. (Efektleri oyun uyguluyor; RC yalnız ödeme + doğrulama katmanı.)
 */
export async function initStore(apiKey?: string | null): Promise<void> {
  if (configured) return
  const P = rc()
  if (!P || !apiKey) return
  configured = true
  try {
    await P.configure({ apiKey })
    const res = await P.getProducts({ productIdentifiers: PRODUCTS.map(p => p.id) })
    rcProducts = res?.products ?? []
    for (const rp of rcProducts) {
      const local = PRODUCTS.find(p => p.id === rp.identifier)
      if (local && rp.priceString) local.price = rp.priceString
    }
  } catch { /* yok say — butonlar varsayılan fiyatla kalır */ }
}

async function productFor(productId: string): Promise<any | null> {
  let p = rcProducts.find(x => x.identifier === productId)
  if (p) return p
  try { // henüz yüklenmediyse tek ürünü çek
    const res = await rc()?.getProducts({ productIdentifiers: [productId] })
    p = (res?.products ?? [])[0]
    if (p) rcProducts.push(p)
  } catch { /* yok */ }
  return p ?? null
}

/**
 * Satın alma (RevenueCat). Temiz başarıda true → çağıran efekti uygular (grantProduct).
 * Kullanıcı iptal ederse / hata olursa false. Plugin yoksa false (buton zaten devre dışı).
 */
export async function purchase(productId: string): Promise<boolean> {
  const P = rc()
  if (!P) return false
  const product = await productFor(productId)
  if (!product) return false
  try {
    const r = await P.purchaseStoreProduct({ product })
    // hata fırlatmadıysa satın alındı; iptalde plugin hata fırlatır (aşağıda yakalanır)
    return !r?.userCancelled
  } catch { return false } // userCancelled dahil tüm hatalar → efekt verme
}

/**
 * Satın almaları geri yükle (App Store zorunluluğu — non-consumable remove_ads için).
 * RevenueCat customerInfo.allPurchasedProductIdentifiers'tan sahip olunan ID'leri döner.
 */
export async function restore(): Promise<string[]> {
  const P = rc()
  if (!P) return []
  try {
    const r = await P.restorePurchases()
    const ci = r?.customerInfo ?? r
    const ids = new Set<string>(ci?.allPurchasedProductIdentifiers ?? [])
    // entitlement adı panelde farklı olabilir → aktif entitlement'ları da remove_ads say
    const active = ci?.entitlements?.active ?? {}
    if (active['remove_ads'] || active['no_ads'] || active['premium']) ids.add('remove_ads')
    return [...ids]
  } catch { return [] }
}
