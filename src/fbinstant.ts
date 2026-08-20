/**
 * Facebook Instant Games (Meta) katmanı — TEK dosya, tek seam.
 *
 * TASARIM KARARI (bakım kolaylığı): main.ts 5000+ satır ve ~20 yerde `auth.loggedIn()`
 * ile kendi `/api` backend'ine konuşuyor. Bunları tek tek dallandırmak yerine burada
 * SADECE İKİ kanca kuruyoruz:
 *   1) localStorage'a sahte bir token yazıyoruz → `auth.loggedIn()` true döner, giriş
 *      ekranı (#authgate) kendiliğinden kalkar, bulut senkron akışı olduğu gibi çalışır.
 *   2) same-origin `/api/*` fetch'lerini yakalıyoruz → `/api/save` FBInstant player
 *      data'sına yazılır/okunur, geri kalan uçlar sessiz no-op olur.
 * Sonuç: main.ts ve auth.ts'e HİÇ dokunmuyoruz. Oyun mantığında yaptığın her düzeltme
 * iOS/web/Meta'ya birden gider.
 *
 * NEZP (Network Enabled Zero Permissions) notu: 1 Ağustos 2025'ten sonra açılan tüm
 * Instant Games'ler Zero Permissions ile çalışmak zorunda. Oyuncunun adı/fotoğrafı YOK,
 * kimlik = FBInstant.player.getID(). Shim ayrıca kendi backend'imize hiçbir istek
 * gitmemesini garanti eder — review yüzeyini küçültür.
 */

// ---- FBInstant SDK'nın kullandığımız kadarı (resmi tip paketi yok, minimal tanım) ----
interface AdInstance {
  getPlacementID(): string
  loadAsync(): Promise<void>
  showAsync(): Promise<void>
}
interface FBInstantSDK {
  initializeAsync(): Promise<void>
  setLoadingProgress(p: number): void
  startGameAsync(): Promise<void>
  getLocale(): string
  quit(): void
  player: {
    getID(): string | null
    getDataAsync(keys: string[]): Promise<Record<string, unknown>>
    setDataAsync(data: Record<string, unknown>): Promise<void>
    flushDataAsync(): Promise<void>
  }
  getInterstitialAdAsync(placementId: string): Promise<AdInstance>
  getRewardedVideoAsync(placementId: string): Promise<AdInstance>
  logEvent(name: string, value?: number, params?: Record<string, string>): void
}

function sdk(): FBInstantSDK | null {
  return (window as unknown as { FBInstant?: FBInstantSDK }).FBInstant ?? null
}

/** Bu oyuncunun bulutta kaydı var mı? (initInstant sonrası anlamlı)
 *  Yeni oyuncuda sürüm notları modalı gösterilmez — bkz. main-meta.ts */
export function isNewPlayer(): boolean { return cachedSave == null }

/** SDK yüklü mü (yalnız meta build'inde script enjekte edilir) */
export function hasInstant(): boolean { return !!sdk() }

// ---- Bulut kayıt: FBInstant player data ----
const SAVE_KEY = 'beneloil_save'   // oyun durumu (serializeState çıktısı)
const AT_KEY = 'beneloil_saved_at' // ISO zaman damgası (auth.ts'in updatedAt sözleşmesi)
const MAX_SAVE_BYTES = 900_000     // player data ~1MB sınırlı; öncesinde uyar

let cachedSave: unknown = null
let cachedAt: string | null = null

async function pullPlayerData(): Promise<void> {
  const fb = sdk(); if (!fb) return
  try {
    const d = await fb.player.getDataAsync([SAVE_KEY, AT_KEY])
    cachedSave = d[SAVE_KEY] ?? null
    cachedAt = (d[AT_KEY] as string) ?? null
  } catch { /* ilk açılış / ağ — misafir gibi sıfırdan başlar */ }
}

async function writePlayerData(save: unknown): Promise<string> {
  const fb = sdk()
  const at = new Date().toISOString()
  cachedSave = save; cachedAt = at
  if (!fb) return at
  const size = JSON.stringify(save ?? null).length
  if (size > MAX_SAVE_BYTES) console.warn(`[fbinstant] save ${size}B — player data 1MB sınırına yakın`)
  try { await fb.player.setDataAsync({ [SAVE_KEY]: save, [AT_KEY]: at }) } catch { /* sonraki flush'ta tekrar dener */ }
  return at
}

// ---- /api/* shim: oyunun backend çağrıları Meta'da hiç ağa çıkmaz ----
function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

async function handleApi(path: string, init?: RequestInit): Promise<Response> {
  const method = (init?.method ?? 'GET').toUpperCase()
  if (path === '/api/save') {
    // Shim SENKRON kuruluyor ama bulut kaydı ASENKRON geliyor. main.ts açılışta
    // /api/save'i çağırıyor; el sıkışma bitmeden cevaplarsak oyuncunun kaydı "yok"
    // görünür ve sıfırdan başlar. Bu yüzden burada bekliyoruz.
    await ready.catch(() => {})
    if (method === 'GET') {
      // auth.pullSave() sözleşmesi: { save, updatedAt, verifyRequired, emailVerified }
      return json({ save: cachedSave, updatedAt: cachedAt, verifyRequired: false, emailVerified: true })
    }
    if (method === 'POST') {
      let save: unknown = null
      try { save = JSON.parse(String(init?.body ?? '{}')).save } catch { /* bozuk gövde → boş kayıt yazma */ }
      if (save == null) return json({ updatedAt: cachedAt })
      return json({ updatedAt: await writePlayerData(save) })
    }
  }
  // /api/config: reklam anahtarları meta build'inde derleme zamanından gelir (bkz. ads.ts),
  // sosyal giriş/RevenueCat yok → boş config yeterli.
  if (path === '/api/config') return json({})
  // metric / visit / stats / leaderboard / feedback / appeal / guest-ping: Meta'da yok.
  return json({})
}

function installApiShim(): void {
  const origFetch = window.fetch.bind(window)
  window.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    let u: URL
    try {
      const raw = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
      u = new URL(raw, location.href)
    } catch { return origFetch(input as RequestInfo, init) }
    // SADECE kendi origin'imizdeki /api/*. ORIGIN KONTROLÜ HAYATİ:
    // FBInstant SDK'sı da https://www.facebook.com/api/graphql/ gibi adreslere gidiyor —
    // yalnız pathname'e bakınca Meta'nın kendi trafiğini yutuyor, el sıkışma tamamlanmıyor
    // ve oyun sonsuza dek yükleme maskesinde kalıyor. (Canlıda tam olarak bu oldu.)
    if (u.origin !== location.origin || !u.pathname.startsWith('/api/')) {
      return origFetch(input as RequestInfo, init)
    }
    return handleApi(u.pathname, init)
  }
}

// ---- Meta'da anlamsız olan UI'ı gizle ----
/** elemanı ve (varsa) hemen üstündeki başlık/açıklama satırını gizler */
function hideWithLabel(id: string): void {
  const el = document.getElementById(id)
  if (!el) return
  const row = el.closest('.row') ?? el
  const prev = row.previousElementSibling
  if (prev && (prev.tagName === 'LABEL' || prev.classList.contains('sd'))) (prev as HTMLElement).style.display = 'none'
  const prev2 = prev?.previousElementSibling
  if (prev2 && prev2.tagName === 'LABEL' && prev?.classList.contains('sd')) (prev2 as HTMLElement).style.display = 'none'
  ;(row as HTMLElement).style.display = 'none'
}

function applyMetaUiTweaks(): void {
  // Hesap yönetimi: Meta'da kimlik FBInstant player ID — e-posta/şifre/çıkış/hesap silme yok.
  // (Veri silme talebi Meta'nın data deletion callback'i üzerinden gelir.)
  for (const id of ['accbox', 'delaccbtn', 'set-feedback', 'notifbtn', 'of-store']) hideWithLabel(id)
  document.getElementById('authgate')?.remove() // token yazdık ama garantiye al
}

// ---- Reklam (yalnız Instant Games) ----
// Placement ID'leri App Dashboard → Instant Games → Ads'ten gelir, derleme zamanı env ile girilir.
const INTERSTITIAL_ID = (import.meta.env?.VITE_FB_INTERSTITIAL_ID as string | undefined) ?? ''
const REWARDED_ID = (import.meta.env?.VITE_FB_REWARDED_ID as string | undefined) ?? ''

let interstitialAd: AdInstance | null = null
let rewardedAd: AdInstance | null = null

/** bir sonraki gösterim için reklamı önden yükler (Instant Games'te show öncesi load zorunlu).
 *  ADS_NO_FILL Türkiye gibi düşük talepli pazarlarda NORMAL — kalıcı hata değil, sonra tekrar
 *  denenir. Denemeler sınırlı: sonsuz döngü envanteri daha da kilitler (ADS_FREQUENT_LOAD). */
const retries = { interstitial: 0, rewarded: 0 }
const MAX_RETRY = 3
async function preload(kind: 'interstitial' | 'rewarded'): Promise<void> {
  const fb = sdk(); if (!fb) return
  const id = kind === 'interstitial' ? INTERSTITIAL_ID : REWARDED_ID
  if (!id) return
  try {
    const ad = kind === 'interstitial' ? await fb.getInterstitialAdAsync(id) : await fb.getRewardedVideoAsync(id)
    await ad.loadAsync()
    if (kind === 'interstitial') interstitialAd = ad; else rewardedAd = ad
    retries[kind] = 0
  } catch (e) {
    const code = (e as { code?: string })?.code ?? ''
    const transient = code === 'ADS_NO_FILL' || code === 'ADS_FREQUENT_LOAD' || code === 'RATE_LIMITED'
    if (transient && retries[kind] < MAX_RETRY) {
      retries[kind]++
      setTimeout(() => preload(kind), code === 'ADS_FREQUENT_LOAD' ? 60_000 : 30_000)
    }
    // kalıcı hata → reklam yok; rewardedReady() false döner, buton hiç görünmez
  }
}

export function instantAdsEnabled(): boolean { return hasInstant() && !!(INTERSTITIAL_ID || REWARDED_ID) }
export function instantRewardedReady(): boolean { return !!rewardedAd }

/** interstitial göster; bittiğinde (ya da gösterilemediyse) done() çağrılır */
export async function showInstantInterstitial(done?: () => void): Promise<void> {
  const ad = interstitialAd
  interstitialAd = null
  if (!ad) { preload('interstitial'); done?.(); return }
  try { await ad.showAsync() } catch { /* kullanıcı kapattı / envanter yok */ }
  preload('interstitial')
  done?.()
}

/** ödüllü reklam göster; sonuna kadar izlendiyse onReward() çalışır */
export async function showInstantRewarded(onReward: () => void, onDone?: (watched: boolean) => void): Promise<void> {
  const ad = rewardedAd
  rewardedAd = null
  if (!ad) { preload('rewarded'); onDone?.(false); return }
  let watched = false
  try { await ad.showAsync(); watched = true; onReward() } catch { /* atlandı → ödül yok */ }
  preload('rewarded')
  onDone?.(watched)
}

// ---- Açılış teşhisi ----
// Meta ortamında konsolu göremiyoruz (oyun bir iframe'in içinde, telefonda hiç göremiyoruz).
// Bu yüzden açılışın hangi adımda olduğunu DOĞRUDAN yükleme maskesine yazıyoruz:
// takılırsa ekran görüntüsü tek başına nerede öldüğünü söyler.
function diagEl(): HTMLElement | null {
  const boot = document.getElementById('boot')
  if (!boot) return null
  let d = document.getElementById('boot-diag')
  if (!d) {
    d = document.createElement('div')
    d.id = 'boot-diag'
    d.style.cssText = 'font-size:11px;font-weight:600;color:#8a94a0;font-family:ui-monospace,monospace;'
      + 'margin-top:10px;max-width:280px;text-align:center;word-break:break-word;line-height:1.5'
    boot.appendChild(d)
  }
  return d
}

const BUILD_ID = (import.meta.env?.VITE_BUILD_ID as string | undefined) ?? 'dev'
const stages: string[] = [`v${BUILD_ID}`]
/** açılış adımını ekrana yaz (v<build> · adım1 › adım2 › …) */
export function bootStage(name: string): void {
  stages.push(name)
  const d = diagEl(); if (d) d.textContent = stages.join(' › ')
}

/** açılışı öldüren hatayı ekranda göster — sessiz ölüm yok */
export function bootError(e: unknown): void {
  const msg = e instanceof Error ? `${e.name}: ${e.message}` : String(e)
  sdk()?.logEvent?.('boot_error')
  const d = diagEl()
  if (d) {
    d.style.color = '#b3402f'
    d.textContent = `${stages.join(' › ')}\n⛔ ${msg}`
    d.style.whiteSpace = 'pre-wrap'
  }
  console.error('[boot]', e)
}

/** yakalanmamış hatalar da maskeye düşsün (chunk 404, CSP, parse hatası…) */
export function installBootDiagnostics(): void {
  window.addEventListener('error', ev => {
    const t = ev.target as HTMLElement | null
    if (t && (t.tagName === 'SCRIPT' || t.tagName === 'LINK')) {
      bootError(new Error(`kaynak yüklenemedi: ${(t as HTMLScriptElement).src || (t as HTMLLinkElement).href}`))
    } else if (ev.error) bootError(ev.error)
  }, true)
  window.addEventListener('unhandledrejection', ev => bootError(ev.reason))
}

// ---- WebGL güvenliği ----
/** Cihaz WebGL çalıştırabiliyor mu? Instant Games mobil ağırlıklı ve iframe içinde —
 *  destek yoksa oyun sonsuza dek yükleme maskesinde kalıyordu (canlı veride 62 vaka). */
export function webglSupported(): boolean {
  try {
    const c = document.createElement('canvas')
    return !!(c.getContext('webgl2') || c.getContext('webgl'))
  } catch { return false }
}

/** WebGL yoksa yükleme maskesini anlamlı bir mesajla değiştir (sonsuz spinner yerine). */
export function showWebglFailure(): void {
  const fb = sdk()
  fb?.logEvent('webgl_unsupported')
  const boot = document.getElementById('boot')
  if (!boot) return
  const tr = (localStorage.getItem('beneloil-lang') ?? 'tr') === 'tr'
  boot.innerHTML = `<div style="max-width:280px;text-align:center;font-family:system-ui,sans-serif;color:#2b3440">
    <div style="font-weight:800;font-size:17px;margin-bottom:10px">BenelOil</div>
    <div style="font-size:13.5px;line-height:1.5;color:#8a94a0">${tr
      ? 'Bu cihaz oyunun ihtiyaç duyduğu 3D grafiği (WebGL) desteklemiyor. Başka bir cihazda ya da tarayıcıda dener misin?'
      : 'This device does not support the 3D graphics (WebGL) the game needs. Please try another device or browser.'}</div>
  </div>`
}

/** Bağlam kaybını yakala. iframe içinde arka plana atılan sekmelerde sık olur;
 *  yakalanmazsa siyah ekran kalır ve oyuncu oyunu kapatır. */
export function guardContextLoss(canvas: HTMLCanvasElement): void {
  canvas.addEventListener('webglcontextlost', e => {
    e.preventDefault() // preventDefault OLMADAN bağlam geri gelmez
    sdk()?.logEvent('webgl_context_lost')
    console.warn('[fbinstant] WebGL bağlamı kayboldu — geri yükleme bekleniyor')
  })
  canvas.addEventListener('webglcontextrestored', () => {
    sdk()?.logEvent('webgl_context_restored')
    location.reload() // sahne kaynakları gitti; temiz yeniden başlatma en güvenlisi
  })
}

// ---- Dil ----
/** Meta'daki oyuncu dilini oyunun diline bağla.
 *  i18n.ts modül yüklenirken localStorage'ı okur; initInstant main'den ÖNCE çalıştığı için
 *  anahtarı burada yazmak yeterli — i18n.ts'e dokunmuyoruz. Oyuncu kendi seçtiyse ezilmez. */
function applyLocale(fb: FBInstantSDK): void {
  const LANG_KEY = 'beneloil-lang'
  if (localStorage.getItem(LANG_KEY)) return
  const loc = (fb.getLocale() ?? '').toLowerCase()
  const l = loc.startsWith('tr') ? 'tr' : loc.startsWith('fr') ? 'fr' : 'en'
  localStorage.setItem(LANG_KEY, l)
}

// ---- Açılış ----
/**
 * Oyun modülü import edilmeden ÖNCE çağrılır (src/main-meta.ts).
 * Sıra: initializeAsync → bulut kaydı çek → shim + token → startGameAsync.
 *
 * NOT (v1 tercihi): FB'nin yükleme ekranını erken kapatıp oyunun kendi #boot maskesini
 * gösteriyoruz. Gerçek asset ilerlemesini setLoadingProgress'e bağlamak main.ts'te bir
 * kanca ister; v2'de yapılacak.
 */
const HANDSHAKE_TIMEOUT_MS = 10_000
let ready: Promise<void> = Promise.resolve()

/**
 * SENKRON açılış. main.ts import edilmeden ÖNCE, aynı chunk içinde çalışır.
 *
 * NEDEN SENKRON: eskiden `await initInstant()` sonrası main DİNAMİK import ediliyordu.
 * Instant Games ortamında o chunk isteği başarısız oldu (ekranda: "kaynak yüklenemedi:
 * .../assets/main-*.js") ve oyun hiç açılmadı. Artık dinamik import YOK — her şey tek
 * chunk, main statik import ediliyor. Ordering şöyle korunuyor:
 *   - token/dil BURADA senkron yazılıyor (main modül gövdesi bunlara bakarak açılıyor)
 *   - bulut kaydı asenkron geliyor; /api/save shim'i `ready`'yi bekliyor
 */
export function bootInstantSync(): void {
  installBootDiagnostics()
  bootStage('boot')
  const fb = sdk()
  if (!fb) { bootStage('sdk-yok'); return } // meta build'i değil

  // auth.loggedIn() true olsun → giriş ekranı kendiliğinden kalkar.
  // Değer sabit, player ID'yi beklemeye gerek yok.
  localStorage.setItem('benzinlik-token', 'fbinstant')
  applyLocale(fb)     // getLocale() init'ten önce null dönebilir → i18n navigator'a düşer
  installApiShim()    // senkron: main açılışta /api/save çağırıyor
  bootStage('sdk')

  // El sıkışma ASLA oyunu kilitlememeli (fail-open): takılsa bile oyun yüklenmiş olur,
  // yalnız bulut kaydı/reklam gelmez. Sonsuz yükleme maskesinden iyidir.
  ready = withTimeout(handshake(fb), HANDSHAKE_TIMEOUT_MS, 'FBInstant el sıkışması')
    .catch(e => { console.error('[fbinstant]', e); fb.logEvent?.('handshake_timeout') })
}

async function handshake(fb: FBInstantSDK): Promise<void> {
  await fb.initializeAsync()
  await pullPlayerData()
  localStorage.setItem('benzinlik-email', `fb:${fb.player.getID() ?? 'anon'}`)
  fb.setLoadingProgress(100)
  await fb.startGameAsync()
  applyMetaUiTweaks()
  preload('interstitial'); preload('rewarded')
}

function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, rej) => setTimeout(() => rej(new Error(`${label} ${ms}ms içinde bitmedi`)), ms)),
  ])
}
