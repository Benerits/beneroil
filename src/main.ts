import * as THREE from 'three'
import { World, PUMP_SLOTS_POS, EV_SLOTS_POS, TANK_POS } from './world'
import { Car, CarManager, Tanker } from './cars'
import { UI, BuildingCard } from './ui'
import {
  FuelType, FUELS, FUEL_LABEL, FUEL_PRICE, GameState, FILL_RATE, SPILL_PENALTY_PER_L, WRONG_FUEL_PENALTY, GRID_COST_PER_KWH,
  EV_PRICE_PER_KWH, TANK_CAPACITY, URANIUM_COST, PARCEL_COLS, PARCEL_ROWS, PAVE_COST, FUEL_COST, priceBounds,
  parcelKey, parcelCost, buyItem, doMaintenance, getShopItems, serializeState, hydrateState, checkAchievements,
  POMPACI_HIRE, EV_ATTENDANT_HIRE, POMPACI_WAGE, EV_ATTENDANT_WAGE, PARTNER_SHARE, ADVANCE_RATE, LOAN_RATE, sellInfo, applySell,
} from './state'
import { loadModels, loadStatics } from './models'
import { isNativePlatform } from './platform'
import { t, lang, setLang, translateDom } from './i18n'
import { audio } from './audio'
import * as auth from './auth'
import { initAds, adsEnabled, interstitial, rewarded, rewardedReady, setPremium, beginAdSession, mayShowInterstitial } from './ads'
import { PRODUCTS, initStore, purchase, restore, storeAvailable } from './store'
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js'
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js'
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js'
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js'

THREE.Object3D.DEFAULT_UP.set(0, 0, 1) // z yukarı

// ---- ÖNCE GİRİŞ: hesap yoksa oyun motoru hiç başlamaz ----
{
  // misafir modu YOK: vitrin (?full) dahil her şey giriş ister
  const gated = !localStorage.getItem('benzinlik-token')
  if (gated) {
    const gate = document.getElementById('authgate') as HTMLDivElement
    gate.style.display = 'flex'
    gate.classList.add('solid')
    translateDom() // giriş ekranı metinlerini seçili dile çevir
    const gErr = document.getElementById('agerr') as HTMLDivElement
    const gEmail = document.getElementById('gemail') as HTMLInputElement
    const gPass = document.getElementById('gpass') as HTMLInputElement
    const wire = (id: string, path: string) => {
      (document.getElementById(id) as HTMLButtonElement).addEventListener('click', async () => {
        gErr.textContent = ''
        try {
          const res = await fetch(path, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ email: gEmail.value, password: gPass.value, lang }),
          })
          const d = await res.json().catch(() => ({}))
          if (!res.ok) throw new Error(d.error ?? t('Sunucuya ulaşılamadı.'))
          localStorage.setItem('benzinlik-token', d.token)
          localStorage.setItem('benzinlik-email', d.email)
          location.reload()
        } catch (err) {
          gErr.textContent = (err as Error).message
        }
      })
    }
    fetch('/api/visit', { method: 'POST' }).catch(() => {}) // ziyaret say (istatistik)
    // canlı oyuncu sayacı — kayıt öncesi sosyal kanıt (FOMO)
    fetch('/api/stats').then(r => r.json()).then(st => {
      const box = document.getElementById('livecount') as HTMLDivElement
      const pl = document.getElementById('lc-players') as HTMLSpanElement
      if (st && typeof st.players === 'number' && st.players > 0) {
        pl.textContent = st.players.toLocaleString('tr-TR')
        box.style.display = 'block'
        if (st.online > 1) {
          ;(document.getElementById('lc-online') as HTMLSpanElement).textContent = String(st.online)
          ;(document.getElementById('lc-online-wrap') as HTMLSpanElement).style.display = 'inline'
        }
      }
    }).catch(() => {})
    wire('glogin', '/api/login')
    wire('gregister', '/api/register')
    ;(document.getElementById('gforgot') as HTMLButtonElement).addEventListener('click', async () => {
      gErr.textContent = ''
      const em = gEmail.value.trim().toLowerCase()
      if (!/^\S+@\S+\.\S+$/.test(em)) { gErr.textContent = t('Önce e-postanı yaz, sonra Şifremi unuttum’a bas.'); return }
      try {
        await fetch('/api/request-reset', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: em, lang }) })
        gErr.style.color = '#2b8a4a'
        gErr.textContent = t('Şifre sıfırlama bağlantısı gönderildi (kayıtlıysa). Mailini kontrol et.')
      } catch { gErr.textContent = t('Gönderilemedi, sonra tekrar dene.') }
    })
    gPass.addEventListener('keydown', e => {
      if (e.key === 'Enter') (document.getElementById('glogin') as HTMLButtonElement).click()
    })

    // ---- Sosyal giriş: Google + Apple (web GIS/AppleJS · Capacitor-iOS native plugin) ----
    const loadScript = (src: string) => new Promise<void>((resolve, reject) => {
      if (document.querySelector(`script[src="${src}"]`)) return resolve()
      const s = document.createElement('script'); s.src = src; s.async = true
      s.onload = () => resolve(); s.onerror = () => reject(new Error('script'))
      document.head.appendChild(s)
    })
    const oauthSubmit = async (provider: 'google' | 'apple', idToken: string, email?: string) => {
      gErr.style.color = ''; gErr.textContent = ''
      try {
        const res = await fetch(`/api/auth/${provider}`, {
          method: 'POST', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ idToken, email }),
        })
        const d = await res.json().catch(() => ({}))
        if (!res.ok) throw new Error(d.error ?? t('Giriş başarısız.'))
        localStorage.setItem('benzinlik-token', d.token)
        localStorage.setItem('benzinlik-email', d.email)
        location.reload()
      } catch (err) { gErr.textContent = (err as Error).message }
    }
    const setupOAuth = async () => {
      let cfg: { googleClientId?: string; appleServicesId?: string } = {}
      try { cfg = await (await fetch('/api/config')).json() } catch { /* config yoksa sosyal giriş gizli kalır */ }
      const box = document.getElementById('ag-oauth') as HTMLDivElement
      const cap = (window as unknown as { Capacitor?: { isNativePlatform?: () => boolean; Plugins?: Record<string, any> } }).Capacitor
      const isNative = isNativePlatform()
      let any = false
      // Capacitor-iOS: @capgo/capacitor-social-login login öncesi initialize ister (bir kez).
      // iOS Google client id + Apple native aud (bundle id) — ikisi de public değer.
      let socialInited = false
      const initSocial = async (P: Record<string, any>) => {
        if (socialInited || !P.SocialLogin?.initialize) return
        await P.SocialLogin.initialize({
          google: { iOSClientId: '80997572914-8ihbi46csk9ngog7ec1oe2ssb3c08t5e.apps.googleusercontent.com' },
          apple: { clientId: 'com.benerits.beneloil' },
        })
        socialInited = true
      }
      // Google
      if (isNative && cap?.Plugins) {
        const btn = document.createElement('button')
        btn.className = 'btn'; btn.style.cssText = 'width:100%;justify-content:center'
        btn.textContent = t('Google ile devam et')
        btn.onclick = async () => {
          try {
            const P = cap.Plugins!
            if (P.SocialLogin) { await initSocial(P); const r = await P.SocialLogin.login({ provider: 'google', options: { scopes: ['email', 'profile'] } }); await oauthSubmit('google', r?.result?.idToken ?? r?.idToken) }
            else if (P.GoogleAuth) { const u = await P.GoogleAuth.signIn(); await oauthSubmit('google', u?.authentication?.idToken) }
            else gErr.textContent = 'Google plugin bulunamadı.'
          } catch (e) { gErr.textContent = (e as Error)?.message || t('Giriş başarısız.') }
        }
        document.getElementById('gbtn-google')!.appendChild(btn); any = true
      } else if (cfg.googleClientId) {
        try {
          await loadScript('https://accounts.google.com/gsi/client')
          const g = (window as unknown as { google: any }).google
          g.accounts.id.initialize({ client_id: cfg.googleClientId, callback: (resp: { credential: string }) => oauthSubmit('google', resp.credential) })
          g.accounts.id.renderButton(document.getElementById('gbtn-google'), { theme: 'outline', size: 'large', width: 300, text: 'continue_with', shape: 'pill' })
          any = true
        } catch { /* GIS yüklenemedi */ }
      }
      // Apple
      const aBtn = document.getElementById('gbtn-apple') as HTMLButtonElement
      if (isNative && cap?.Plugins) {
        aBtn.style.display = 'flex'
        aBtn.onclick = async () => {
          try {
            const P = cap.Plugins!
            if (P.SocialLogin) { await initSocial(P); const r = await P.SocialLogin.login({ provider: 'apple', options: { scopes: ['email', 'name'] } }); await oauthSubmit('apple', r?.result?.idToken ?? r?.identityToken) }
            else if (P.SignInWithApple) { const r = await P.SignInWithApple.authorize({ scopes: 'email name' }); await oauthSubmit('apple', r?.response?.identityToken) }
            else gErr.textContent = 'Apple plugin bulunamadı.'
          } catch (e) { gErr.textContent = (e as Error)?.message || t('Giriş başarısız.') }
        }
        any = true
      } else if (cfg.appleServicesId) {
        try {
          await loadScript('https://appleid.cdn-apple.com/appleauth/static/jsapi/appleid/1/en_US/appleid.auth.js')
          const AppleID = (window as unknown as { AppleID: any }).AppleID
          AppleID.auth.init({ clientId: cfg.appleServicesId, scope: 'name email', redirectURI: location.origin + '/', usePopup: true })
          aBtn.style.display = 'flex'
          aBtn.onclick = async () => {
            try { const data = await AppleID.auth.signIn(); await oauthSubmit('apple', data.authorization.id_token, data.user?.email) }
            catch (e) { if ((e as { error?: string })?.error !== 'popup_closed_by_user') gErr.textContent = t('Giriş başarısız.') }
          }
          any = true
        } catch { /* Apple JS yüklenemedi */ }
      }
      if (any) box.style.display = 'block'
    }
    setupOAuth()

    await new Promise(() => {}) // giriş yapılana dek modül burada durur
  }
}

const app = document.getElementById('app')!
const renderer = new THREE.WebGLRenderer({ antialias: true })
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5)) // performans: 2x retina yerine 1.5x yeterli
renderer.shadowMap.enabled = true
renderer.shadowMap.type = THREE.PCFSoftShadowMap
renderer.localClippingEnabled = true // küre tank sıvısı: yatay düzlemle alttan-yukarı dolum kırpması
renderer.toneMapping = THREE.ACESFilmicToneMapping
renderer.toneMappingExposure = 1.1
app.appendChild(renderer.domElement)

// Kamera: (1x, 2y, 1z) yönünden ortografik; tekerlek = zoom, sürükle = kaydır
const VIEW = 26
const camera = new THREE.OrthographicCamera()
// Harita açısı: birkaç hazır izometrik yön; oyuncu "açı" butonuyla döner.
const CAM_ANGLES = [
  new THREE.Vector3(1, 2, 1), new THREE.Vector3(1.6, 2, 0.5), new THREE.Vector3(0.5, 2.2, 1.6),
].map(v => v.normalize().multiplyScalar(42))
let camAngleIdx = 0
let camDir = CAM_ANGLES[camAngleIdx].clone()
let camX = 0
let camY = 0
let pinching = false // iki parmak zoom sırasında sürükle-kaydırma devre dışı

function updateCamera() {
  camera.position.set(camDir.x + camX, camDir.y + camY, camDir.z)
  camera.lookAt(camX, camY, 0)
}

function cycleCameraAngle() {
  camAngleIdx = (camAngleIdx + 1) % CAM_ANGLES.length
  camDir = CAM_ANGLES[camAngleIdx].clone()
  updateCamera()
}

let composer: EffectComposer | null = null

function resize() {
  const w = window.innerWidth, h = window.innerHeight
  renderer.setSize(w, h)
  composer?.setSize(w, h)
  const aspect = w / h
  camera.left = -VIEW * aspect / 2
  camera.right = VIEW * aspect / 2
  camera.top = VIEW / 2
  camera.bottom = -VIEW / 2
  camera.near = 0.1
  camera.far = 400 // zoom-out artınca (min 0.42) + uzun yol/geniş zemin kırpılmasın
  camera.updateProjectionMatrix()
}
window.addEventListener('resize', resize)
window.addEventListener('wheel', e => {
  // UI panellerinin üzerindeyken oyuna zoom geçirme (modal içinde scroll serbest)
  if ((e.target as HTMLElement).closest?.('.backdrop, .modal, #panel, #infocard, .hud, .navbar')) return
  camera.zoom = Math.min(2.6, Math.max(0.42, camera.zoom * Math.exp(-e.deltaY * 0.0012)))
  camera.updateProjectionMatrix()
}, { passive: true })

// ---- Mobil: iki parmak = kamera zoom (tekerlek yok) + sayfa zoom'unu engelle ----
let pinchStartDist = 0, pinchStartZoom = 1
const touchDist = (t: TouchList) => Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY)
window.addEventListener('touchstart', e => {
  if (e.touches.length === 2 && !(e.target as HTMLElement).closest?.('.backdrop, .modal, #panel, #infocard, .hud, .navbar, #authgate')) {
    pinching = true; pinchStartDist = touchDist(e.touches); pinchStartZoom = camera.zoom
  }
}, { passive: true })
window.addEventListener('touchmove', e => {
  if (pinching && e.touches.length === 2) {
    e.preventDefault()
    const d = touchDist(e.touches)
    if (pinchStartDist > 0) {
      camera.zoom = Math.min(2.6, Math.max(0.42, pinchStartZoom * (d / pinchStartDist)))
      camera.updateProjectionMatrix()
    }
  }
}, { passive: false })
window.addEventListener('touchend', e => { if (e.touches.length < 2) pinching = false }, { passive: true })
// iOS/WKWebView'in kendi pinch/çift-dokunuş zoom jestlerini kapat (UI kaymasın)
for (const ev of ['gesturestart', 'gesturechange', 'gestureend']) {
  document.addEventListener(ev, e => e.preventDefault(), { passive: false })
}

resize()
updateCamera()

// tarayıcı autoplay kuralı: ilk dokunuşta ses sistemini aç
window.addEventListener('pointerdown', () => audio.ensure(), { once: true })

// ---- Bildirim sistemi: arka planda önemli olayları haber ver (web + native), spam yapma ----
const notifCooldown = new Map<string, number>()
function capPlugins(): Record<string, any> | null {
  return (window as unknown as { Capacitor?: { Plugins?: Record<string, any> } }).Capacitor?.Plugins ?? null
}
/** Önemli olay bildirimi: sekme gizliyken (web) veya native'de fırlatılır; tag başına 60 sn throttle. */
function notifyIfHidden(text: string, tag = text.slice(0, 24)) {
  // ön planda web'de darlamayalım — toast zaten var; native'de yine de bildir (kullanıcı başka app'te olabilir)
  if (!document.hidden && !isNativePlatform()) return
  const now = Date.now()
  if ((notifCooldown.get(tag) ?? 0) > now) return
  notifCooldown.set(tag, now + 60_000)
  if (document.hidden) document.title = `(!) ${text.slice(0, 40)}`
  const title = world?.stationName ?? 'BenelOil'
  if ('Notification' in window && Notification.permission === 'granted') {
    try { new Notification(title, { body: text, tag }) } catch { /* mobil kısıt */ }
  }
  const P = capPlugins()
  if (isNativePlatform() && P?.LocalNotifications) {
    try { P.LocalNotifications.schedule({ notifications: [{ id: Math.floor(now % 2000000000), title, body: text }] }) } catch { /* yok say */ }
  }
}
/** Arka plana geçerken: yaklaşan tankerler için ETA'da native bildirim planla (WebView uykuda olsa bile ping gelir). */
function scheduleBackgroundReminders() {
  const P = capPlugins()
  if (!isNativePlatform() || !P?.LocalNotifications) return
  const notifs: any[] = []
  for (const tk of tankers) {
    const eta = state.orders[tk.fuel]?.eta ?? 0
    if (eta > 3) notifs.push({ id: 1_700_000_000 + tk.slot, title: world?.stationName ?? 'BenelOil',
      body: t('🚚 {0} tankeri istasyona ulaştı!', FUEL_LABEL[tk.fuel]), schedule: { at: new Date(Date.now() + eta * 1000) } })
  }
  if (notifs.length) { try { P.LocalNotifications.schedule({ notifications: notifs }) } catch { /* yok say */ } }
}
document.addEventListener('visibilitychange', () => {
  if (document.hidden) { scheduleBackgroundReminders(); return } // arka plana geçerken yaklaşan olayları planla
  document.title = `${world?.stationName ?? 'Benzinlik'} — Benzinlik`
  // odağa dönünce: başka cihaz save'i ilerlettiyse en güncele senkronla (ilerleme karışmasın)
  if (auth.loggedIn() && !syncedConflict) {
    auth.fetchUpdatedAt().then(ts => {
      const base = auth.lastUpdatedAt()
      if (ts && base && new Date(ts).getTime() > new Date(base).getTime() + 1000) { syncedConflict = true; onRemoteNewer() }
    }).catch(() => {})
  }
})

// Kenney modelleri (yüklenemezse prosedürele düşer)
const [modelLib, staticLib] = await Promise.all([loadModels(), loadStatics()])

const world = new World(staticLib)
const state = new GameState()
world.isPavedFn = (c, r) => state.isPaved(c, r)
let appConfig: any = null // /api/config yanıtı (RevenueCat key vb. lazy kullanım için)
const isPromoMode = new URLSearchParams(location.search).has('promo')
if (!isPromoMode) {
  const test = new URLSearchParams(location.search).has('adstest')
  beginAdSession()
  fetch('/api/config').then(r => r.json()).then(cfg => {
    appConfig = cfg
    // native → AdMob (config'te gerçek unit yoksa TEST reklamları); web → AdSense (adsClient varsa)
    initAds({ adsensePub: cfg.adsClient, admob: cfg.admob, test })
  }).catch(() => { initAds({ test }) })
}
let promoTick: ((dt: number) => void) | null = null
const ui = new UI()

// Alt navbar + uygulama-sheet (mobil): tüm bölümler tek 'openSection' üzerinden açılır.
// Sekme değişince diğer bölüm sheet'i kapanır → mobil-uygulama gibi sekmeli tek yüzey.
const NAV_WRAPS: Record<string, string> = { office: 'officewrap', build: 'shopwrap', order: 'fuelwrap', profile: 'accwrap' }
function openSection(sec: string) {
  // zaten bir sheet açıksa bu bir SEKME GEÇİŞİdir → yeniden slide-up animasyonu oynatma (flash olmasın)
  const wasOpen = Object.values(NAV_WRAPS).some(w => document.getElementById(w)?.classList.contains('show'))
  document.documentElement.classList.toggle('no-sheet-anim', wasOpen)
  for (const [s, w] of Object.entries(NAV_WRAPS)) if (s !== sec) document.getElementById(w)?.classList.remove('show')
  if (sec === 'office') openOfficePanel()
  else if (sec === 'build') document.getElementById('shopbtn')?.click()
  else if (sec === 'order') document.getElementById('orderbtn')?.click()
  else if (sec === 'profile') document.getElementById('accbtn')?.click()
  else if (sec === 'roadmap') ui.toast(t('Yol haritası yakında!'), '')
}
for (const elx of document.querySelectorAll<HTMLElement>('#navbar .navbtn, #sheettabs .stab')) {
  const sec = elx.id ? elx.id.replace('nav-', '') : elx.dataset.sec
  if (sec) elx.addEventListener('click', () => openSection(sec))
}
// Genişleyen FAB: ana buton menüyü aç/kapat; öğe seçilince veya dışarı dokununca kapanır.
const fabNav = document.getElementById('navbar')
document.getElementById('nav-fab')?.addEventListener('click', e => { e.stopPropagation(); fabNav?.classList.toggle('fab-open') })
for (const b of document.querySelectorAll<HTMLElement>('#navbar .navbtn')) b.addEventListener('click', () => fabNav?.classList.remove('fab-open'))
document.addEventListener('pointerdown', e => {
  if (fabNav?.classList.contains('fab-open') && !fabNav.contains(e.target as Node)) fabNav.classList.remove('fab-open')
})
// Açık nav-section'ı izle → sekme şeridini göster/gizle + aktif sekmeyi işaretle + alt navbar'ı gizle.
let sheetSyncQueued = false
function syncSheetTabs() {
  if (sheetSyncQueued) return
  sheetSyncQueued = true
  requestAnimationFrame(() => {
    sheetSyncQueued = false
    let active: string | null = null
    for (const [s, w] of Object.entries(NAV_WRAPS)) if (document.getElementById(w)?.classList.contains('show')) active = s
    const tabs = document.getElementById('sheettabs')
    document.getElementById('navbar')?.classList.toggle('hidden', !!active)
    tabs?.classList.toggle('show', !!active)
    tabs?.querySelectorAll<HTMLElement>('.stab').forEach(b => b.classList.toggle('on', b.dataset.sec === active))
    if (!active) document.documentElement.classList.remove('no-sheet-anim')
  })
}
const sheetObs = new MutationObserver(syncSheetTabs)
for (const w of Object.values(NAV_WRAPS)) {
  const e = document.getElementById(w); if (e) sheetObs.observe(e, { attributes: true, attributeFilter: ['class'] })
}
document.getElementById('anglebtn')?.addEventListener('click', () => cycleCameraAngle())

// Ofis muhasebe: son yakıt alımları (yeni→eski, en çok 8 kayıt)
const FUEL_DOT: Record<string, string> = { benzin: '#27a05a', dizel: '#e8862e', lpg: '#2f6fed' }
function accHistory(): string {
  if (!state.fuelLog.length) return `<div class="acc-sec">${t('Yakıt alım geçmişi')}</div><div class="acc-empty">${t('Henüz yakıt siparişi verilmedi.')}</div>`
  const rows = state.fuelLog.slice(-8).reverse().map(x =>
    `<div class="acc-row"><span class="acc-day">${t('Gün')} ${x.day}</span>`
    + `<span class="acc-fuel"><i style="background:${FUEL_DOT[x.f] ?? '#888'}"></i>${t(FUEL_LABEL[x.f])} ${x.liters.toLocaleString('tr-TR')}L</span>`
    + `<span class="acc-cost">-₺${Math.round(x.cost).toLocaleString('tr-TR')}</span></div>`).join('')
  return `<div class="acc-sec">${t('Yakıt alım geçmişi')}</div>${rows}`
}

// Ofis: finansal durum → fiyatlar → müşteri&itibar → dönemsel satış/kâr → yakıt geçmişi
function openOfficePanel() {
  const card = buildingCard('office')
  const tl = (n: number) => Math.round(n).toLocaleString('tr-TR')
  const row = (k: string, v: string, cls = '') => `<div class="stat"><span class="k">${k}</span><span class="v ${cls}">${v}</span></div>`

  // 1) Finansal durum
  const nwc = state.netWorkingCapital()
  const fin = document.getElementById('of-financial')
  if (fin) fin.innerHTML =
    row(t('Aktif (varlık)'), `₺${tl(state.assets())}`, 'good')
    + row(t('Net işletme sermayesi'), `₺${tl(nwc)}`, nwc >= 0 ? '' : 'bad')
    + row(t('Kasa'), `₺${tl(state.money)}`)

  // 2) Yakıt satış fiyatları (+/-)
  const pricesEl = document.getElementById('of-prices')
  if (pricesEl && card?.priceRows) pricesEl.innerHTML = card.priceRows.map(r =>
    `<div class="prow"><span class="pl">${r.label}</span><span class="pc">${typeof r.cost === 'number' ? `alış ₺${r.cost}` : r.cost}</span>`
    + `<button class="btn pbtn" data-pf="${r.f}" data-pd="-0.5" ${r.canDown ? '' : 'disabled'}>−</button>`
    + `<span class="pv">₺${r.price.toFixed(1)}</span>`
    + `<button class="btn pbtn" data-pf="${r.f}" data-pd="0.5" ${r.canUp ? '' : 'disabled'}>+</button></div>`).join('')

  // 3) Müşteri & itibar
  const cust = document.getElementById('of-customer')
  if (cust) {
    const fx = Math.round((state.priceDemandFactor() - 1) * 100)
    cust.innerHTML =
      row(t('Müşteri etkisi'), `${fx >= 0 ? '+' : ''}${fx}%`, fx >= 0 ? 'good' : 'bad')
      + row(t('İtibar'), `${state.reputation.toFixed(1)} / 5`)
      + row(t('Toplam müşteri'), `${state.stats.served}`, 'good')
      + row(t('Kaçan müşteri'), `${state.stats.lost}`, state.stats.lost > state.stats.served / 4 ? 'bad' : '')
  }

  // 4) Dönemsel satış & faaliyet kârı (gün / ay=30g / yıl=365g)
  const sales = document.getElementById('of-sales')
  if (sales) {
    let html = `<div class="acc-cols acc-head"><span>${t('Dönem')}</span><span>${t('Satış')}</span><span>${t('Faaliyet kârı')}</span></div>`
    for (const [label, d] of [[t('Günlük'), 1], [t('Aylık'), 30], [t('Yıllık'), 365]] as [string, number][]) {
      const rev = state.salesInPeriod(d)
      const prof = rev - state.fuelCostInPeriod(d) - state.wagesInPeriod(d)
      html += `<div class="acc-cols"><span class="acc-plabel">${label}</span>`
        + `<span class="v good">₺${tl(rev)}</span>`
        + `<span class="v ${prof >= 0 ? 'good' : 'bad'}">₺${tl(prof)}</span></div>`
    }
    sales.innerHTML = html
  }

  // 5) Yakıt alım geçmişi
  const hist = document.getElementById('of-history')
  if (hist) hist.innerHTML = accHistory()

  document.getElementById('officewrap')?.classList.add('show')
}
document.getElementById('of-toggle')?.addEventListener('click', () => { document.getElementById('closebtn')?.click(); openOfficePanel() })
// Ofis fiyat yönetimi butonları officewrap içinde de çalışsın (bina kartıyla aynı handler)
document.getElementById('of-prices')?.addEventListener('click', e => {
  const btn = (e.target as HTMLElement).closest('button[data-pf]') as HTMLButtonElement | null
  if (btn) ui.onPriceChange(btn.dataset.pf as FuelType | 'elec', Number(btn.dataset.pd))
})
const isMobileView = () => window.matchMedia('(max-width: 680px)').matches

// Mobilde Profil + Ayarlar tek sheet: 2 alt-sekme (segmented control).
function activateSub(sub: string) {
  document.querySelectorAll<HTMLElement>('#accwrap .subtab').forEach(b => b.classList.toggle('on', b.dataset.sub === sub))
  document.querySelectorAll<HTMLElement>('#accwrap .subpane').forEach(p => { p.hidden = p.dataset.pane !== sub })
}
document.querySelectorAll<HTMLElement>('#accwrap .subtab').forEach(b => b.addEventListener('click', () => activateSub(b.dataset.sub!)))
if (isMobileView()) {
  // Ayarlar içeriğini setwrap'ten Profil sheet'inin "Ayarlar" paneline taşı (ID'ler korunur → wiring çalışır)
  const setBody = document.querySelector('#setwrap .mbody')
  const ayarlarPane = document.querySelector('#accwrap .subpane[data-pane="ayarlar"]')
  if (setBody && ayarlarPane) while (setBody.firstChild) ayarlarPane.appendChild(setBody.firstChild)
  // dişli (setbtn) → boş setwrap yerine Profil sheet'in Ayarlar sekmesi
  document.getElementById('setbtn')?.addEventListener('click', e => {
    e.stopImmediatePropagation(); openSection('profile'); activateSub('ayarlar')
  }, true)
  // Profil sekmesine basınca Profil alt-sekmesiyle başla
  document.getElementById('nav-profile')?.addEventListener('click', () => activateSub('profil'))
}

// ---- Banka / kredi ekranı ----
let bankSelected = new Set<string>()
function collateralLabel(id: string): string {
  return state.eligibleCollateral().find(e => e.id === id)?.label ?? id
}
function renderBank() {
  const body = document.getElementById('bank-body'); if (!body) return
  // 1) banka ortaklığı aktif (teminatsız temerrüt sonrası)
  if (state.partner.active) {
    body.innerHTML =
      `<div class="ofsec">${t('Banka Ortaklığı')}</div>`
      + `<div class="stat"><span class="k">${t('Kalan borç payı')}</span><span class="v bad">₺${state.partner.remaining.toLocaleString('tr-TR')}</span></div>`
      + `<div class="stat"><span class="k">${t('Günlük kâr payı')}</span><span class="v">%${Math.round(state.partner.share * 100)}</span></div>`
      + `<div class="sd" style="margin:8px 0 12px; color:var(--red)">${t('Teminatsız borcunu ödeyemedin — banka istasyona ortak oldu. Her gün kârının bir kısmı borç bitene dek bankaya gider. Peşin kapatabilirsin:')}</div>`
      + `<button class="btn good" id="bank-buyout" style="width:100%; justify-content:center">${t('Ortaklığı Kapat — ₺{0}', state.partner.remaining.toLocaleString('tr-TR'))}</button>`
    return
  }
  // 2) aktif kredi
  const l = state.loan
  if (l.active) {
    const unsec = l.collateral.length === 0
    body.innerHTML =
      `<div class="stat"><span class="k">${t('Anapara')}</span><span class="v">₺${l.principal.toLocaleString('tr-TR')}</span></div>`
      + `<div class="stat"><span class="k">${t('Aylık taksit')}</span><span class="v">₺${l.monthly.toLocaleString('tr-TR')}</span></div>`
      + `<div class="stat"><span class="k">${t('Kalan taksit')}</span><span class="v">${l.remaining} / 12</span></div>`
      + `<div class="stat"><span class="k">${t('Gecikme')}</span><span class="v ${l.overdue ? 'bad' : 'good'}">${l.overdue}</span></div>`
      + `<div class="sd" style="margin:9px 0 4px">${unsec ? t('Teminatsız avans') : t('Teminatların') + ': ' + l.collateral.map(collateralLabel).join(', ')}</div>`
      + `<div class="sd" style="margin:4px 0 12px; color:var(--red)">${unsec ? t('Ödenmezse banka istasyona ORTAK olur (kâr payından tahsil).') : t('Ödenmezse teminatların haczedilir.')}</div>`
      + `<button class="btn good" id="bank-payoff" style="width:100%; justify-content:center">${t('Erken Kapat — ₺{0}', state.loanPayoff().toLocaleString('tr-TR'))}</button>`
    return
  }
  // 3) teklif ekranı: teminatsız avans (herkes) + teminatlı kredi (asseti varsa)
  const advLimit = state.advanceLimit()
  const advMonthly = state.loanMonthly(advLimit, ADVANCE_RATE)
  let html =
    `<div class="ofsec">${t('Teminatsız Avans — asset gerekmez')}</div>`
    + `<div class="stat"><span class="k">${t('Tutar')}</span><span class="v">₺${advLimit.toLocaleString('tr-TR')}</span></div>`
    + `<div class="stat"><span class="k">${t('Aylık taksit')}</span><span class="v">₺${advMonthly.toLocaleString('tr-TR')}</span></div>`
    + `<div class="sd" style="margin:4px 0 10px">${t('aylık %5 · 12 taksit · ödenmezse banka istasyona ortak olur')}</div>`
    + `<button class="btn primary" id="bank-adv" style="width:100%; justify-content:center">${t('Avans Al — +₺{0}', advLimit.toLocaleString('tr-TR'))}</button>`
  const elig = state.eligibleCollateral()
  if (elig.length) {
    let total = 0
    const rows = elig.map(e => {
      const on = bankSelected.has(e.id); if (on) total += e.value
      return `<div class="prow"><span class="pl">${e.label}</span><span class="pc">${t('teminat')} ₺${e.value.toLocaleString('tr-TR')}</span>`
        + `<button class="btn pbtn bank-col${on ? ' good' : ''}" data-col="${e.id}">${on ? '✓' : '+'}</button></div>`
    }).join('')
    const monthly = total > 0 ? state.loanMonthly(total) : 0
    html += `<div class="ofsec" style="margin-top:16px">${t('Teminatlı Kredi — değerin %50si')}</div>${rows}`
      + `<div class="stat" style="margin-top:8px"><span class="k">${t('Kredi tutarı')}</span><span class="v">₺${total.toLocaleString('tr-TR')}</span></div>`
      + `<div class="stat"><span class="k">${t('Aylık taksit')}</span><span class="v">₺${monthly.toLocaleString('tr-TR')}</span></div>`
      + `<button class="btn primary" id="bank-take" style="width:100%; justify-content:center; margin-top:6px" ${total <= 0 ? 'disabled' : ''}>${t('Krediyi Al — +₺{0}', total.toLocaleString('tr-TR'))}</button>`
  }
  body.innerHTML = html
}
function openBank() {
  document.getElementById('officewrap')?.classList.remove('show') // ofis sheet'i kapat, bankayı normal alt-sheet olarak aç
  bankSelected = new Set()
  renderBank()
  document.getElementById('bankwrap')?.classList.add('show')
}
document.getElementById('of-bank')?.addEventListener('click', () => openBank())

// ---- Mağaza (IAP) ----
function renderStore() {
  const body = document.getElementById('store-body'); if (!body) return
  const avail = storeAvailable()
  let html = ''
  if (!avail) html += `<div class="sd" style="text-align:center; padding:6px 4px 12px; line-height:1.5">${t('Satın almalar yalnızca iOS uygulamasında aktiftir (web önizleme).')}</div>`
  html += PRODUCTS.map(p => {
    const owned = p.kind === 'noads' && state.noAds
    return `<div class="shoprow"><div class="sicon" style="color:#8a5cf6;background:#8a5cf61c;border-color:#8a5cf644"><svg class="ic"><use href="#${p.kind === 'noads' ? 'i-star' : 'i-coin'}"/></svg></div>`
      + `<div class="sinfo"><div class="st">${p.title}</div><div class="sd">${p.desc}</div></div>`
      + `<button class="btn sbuy ${p.kind === 'noads' ? 'primary' : 'good'} store-buy" data-pid="${p.id}" ${(!avail || owned) ? 'disabled' : ''}>${owned ? t('Sahipsin ✓') : p.price}</button></div>`
  }).join('')
  html += `<div class="row" style="margin-top:10px"><button class="btn" id="store-restore" style="flex:1; justify-content:center" ${avail ? '' : 'disabled'}>${t('Satın Alımları Geri Yükle')}</button></div>`
  body.innerHTML = html
}
async function openStore() {
  document.getElementById('officewrap')?.classList.remove('show')
  await initStore(appConfig?.revenuecatIos, auth.currentEmail())
  renderStore()
  document.getElementById('storewrap')?.classList.add('show')
}
async function grantProduct(id: string, transactionId?: string) {
  const p = PRODUCTS.find(x => x.id === id); if (!p) return
  if (p.kind === 'noads') {
    try { await auth.iapGrant(id, transactionId) } catch { /* offline: yine de yerelde aç */ }
    state.noAds = true; setPremium(true)
    ui.toast(t('✅ Reklamlar kaldırıldı — teşekkürler!'), 'good')
  } else if (p.kind === 'coins' && p.coins) {
    try { const r = await auth.iapGrant(id, transactionId); state.money = r.money; lastRemotePush = Date.now() }
    catch { state.money += p.coins }
    ui.toast(t('✅ +₺{0} kasana eklendi!', p.coins.toLocaleString('tr-TR')), 'good')
  }
  persist(); renderStore()
}
document.getElementById('of-store')?.addEventListener('click', () => openStore())
document.getElementById('storewrap')?.addEventListener('pointerdown', e => { if (e.target === e.currentTarget) (e.currentTarget as HTMLElement).classList.remove('show') })
document.getElementById('store-body')?.addEventListener('click', async e => {
  const buy = (e.target as HTMLElement).closest('button.store-buy') as HTMLButtonElement | null
  if (buy) {
    const pid = buy.dataset.pid!
    buy.disabled = true; buy.textContent = t('İşleniyor…')
    const r = await purchase(pid)
    if (r.ok) await grantProduct(pid, r.transactionId)
    else { ui.toast(t('Satın alma tamamlanamadı.'), 'bad'); renderStore() }
    return
  }
  if ((e.target as HTMLElement).closest('#store-restore')) {
    const ids = await restore()
    if (ids.includes('remove_ads')) await grantProduct('remove_ads')
    ui.toast(ids.length ? t('Satın alımlar geri yüklendi.') : t('Geri yüklenecek satın alma yok.'), ids.length ? 'good' : '')
  }
})
document.getElementById('bankwrap')?.addEventListener('pointerdown', e => {
  if (e.target === e.currentTarget) (e.currentTarget as HTMLElement).classList.remove('show')
})
document.getElementById('bank-body')?.addEventListener('click', e => {
  const tgt = e.target as HTMLElement
  const col = tgt.closest('button.bank-col') as HTMLElement | null
  if (col) { const id = col.dataset.col!; bankSelected.has(id) ? bankSelected.delete(id) : bankSelected.add(id); renderBank(); return }
  if (tgt.closest('#bank-take')) {
    let total = 0; for (const id of bankSelected) total += state.collateralValue(id)
    if (total > 0 && state.takeLoan(total, [...bankSelected])) {
      ui.toast(t('🏦 Kredi onaylandı — +₺{0} kasana geçti!', total.toLocaleString('tr-TR')), 'good')
      renderBank(); persist()
    }
    return
  }
  if (tgt.closest('#bank-adv')) {
    const amt = state.advanceLimit()
    if (state.takeAdvance(amt)) { ui.toast(t('🏦 Avans onaylandı — +₺{0} kasana geçti!', amt.toLocaleString('tr-TR')), 'good'); renderBank(); persist() }
    return
  }
  if (tgt.closest('#bank-payoff')) {
    if (state.repayLoanFull()) { ui.toast(t('🏦 Kredi kapatıldı — teminatların serbest!'), 'good'); renderBank(); persist() }
    else ui.toast(t('💸 Erken kapatmaya kasan yetmiyor.'), 'bad')
    return
  }
  if (tgt.closest('#bank-buyout')) {
    if (state.buyoutPartner()) { ui.toast(t('🏦 Ortaklık kapatıldı — istasyon tamamen senin!'), 'good'); renderBank(); persist() }
    else ui.toast(t('💸 Ortaklığı kapatmaya kasan yetmiyor.'), 'bad')
  }
})

/** Ödeme yapılamayınca teminatları haczet: binaları istasyondan kaldır (iade YOK), krediyi kapat. */
function seizeCollateral() {
  for (const id of [...state.loan.collateral]) {
    if (!sellInfo(state, id)) continue // zaten satılmış/kaldırılmış olabilir
    const refund = applySell(state, id) // state sayaçlarını düşürür + iade ekler
    if (refund) state.money -= refund   // haciz: iade geri alınır (banka borca karşılık alır)
    const base = id.split('#')[0]
    if (base === 'charger') cars.evictSlot('ev', Number(id.slice(8)))
    world.removeBuildingGroup(id)
    delete placedPos[id]; delete placedRot[id]
    const ri = placedRects.findIndex(r => r.id === id); if (ri >= 0) placedRects.splice(ri, 1)
  }
  state.loan = { active: false, principal: 0, monthly: 0, remaining: 0, overdue: 0, collateral: [], rate: LOAN_RATE }
  Car.solids = hardRects()
  ui.toast(t('🏦 Ödeme yapılamadı — teminatların HACZEDİLDİ ve istasyondan alındı!'), 'bad')
  if (selectedBuilding) refreshBuildingCard()
  persist()
}
document.getElementById('officewrap')?.addEventListener('pointerdown', e => {
  if (e.target === e.currentTarget) (e.currentTarget as HTMLElement).classList.remove('show')
})
ui.batteryKwh = () => state.battery
ui.attendantAt = car => car.slotIndex >= 0 &&
  (car.kind === 'ev' ? state.autoChargers.has(car.slotIndex) : state.autoPumps.has(car.slotIndex))
ui.feedbackContext = () => ({
  day: state.day, money: Math.round(state.money), pumps: state.pumps,
  rep: Number(state.reputation.toFixed(2)), ua: navigator.userAgent.slice(0, 120),
})
ui.tankerStatus = () => {
  const parts: string[] = []
  for (const f of FUELS) {
    const active = tankers.find(x => x.fuel === f)
    if (active) {
      if (active.t.unloading) parts.push(t('{0} · boşaltıyor', t(FUEL_LABEL[f])))
      else {
        const d = active.t.group.position.distanceTo(new THREE.Vector3(world.tankAnchor.x, world.tankAnchor.y, 0))
        parts.push(`${FUEL_LABEL[f]} · ${Math.max(1, Math.round(d))}m`)
      }
    } else if (state.orders[f].pending) {
      parts.push(`${FUEL_LABEL[f]} · ${Math.ceil(state.orders[f].eta)}s`)
    }
  }
  return parts
}
const tankers: { t: Tanker; fuel: FuelType; slot: number; age?: number; credited?: boolean }[] = []
let evTurnAwayT = 0
let exploding = false
let selectedBuilding: string | null = null
let cardRefreshT = 0

composer = new EffectComposer(renderer)
composer.addPass(new RenderPass(world.scene, camera))
composer.addPass(new UnrealBloomPass(new THREE.Vector2(window.innerWidth / 2, window.innerHeight / 2), 0.24, 0.4, 0.93)) // yarı çözünürlük bloom: gözle fark yok, kat kat hızlı
composer.addPass(new OutputPass())
composer.setSize(window.innerWidth, window.innerHeight)

const cars = new CarManager(world.scene, modelLib, {
  pumpCount: () => state.pumps,
  evCount: () => state.evChargers,
  entryChance: () => state.entryChance() * (isPromoMode ? 2.5 : 1),
  evShare: () => (state.evChargers > 0 ? Math.min(0.5, 0.15 + 0.09 * state.evChargers) * state.evPriceFactor() : 0),
  isPumpBroken: i => state.brokenPumps.has(i),
  isChargerBroken: i => state.brokenChargers.has(i),
  parkSpots: () => world.getParkingSpots(),
  extraObstacles: () => tankers.map(x => x.t.group.position),
  wideGates: () => state.wideGates,
  prices: () => state.prices,
  pumpSlot: i => world.pumpSlots[i],
  evSlot: i => world.evSlots[i],
  gateInY: () => world.gateIn.y,
  gateOutY: () => world.gateOut.y,
  truckSpots: () => world.getTruckSpots(),
  onTruckParked: () => {
    const fee = 40 + Math.round(Math.random() * 40)
    state.addPending('truckpark', fee, t('Tır parkı'))
    ui.toast(t('Tır park etti: ₺{0} kumbarada', fee), 'good', true)
  },
  onCarReady: car => { if (!ui.activeCar && !isAttendantCar(car)) ui.selectCar(car); tutStart() },
  onEvTurnedAway: () => {
    if (evTurnAwayT > 0) return
    evTurnAwayT = 4
    state.stats.lost++
    state.addRep(-0.3)
    audio.miss()
    ui.toast('EV müşterisi dolu (ama şarj etmeyen) üniteyi görüp KAÇTI — itibar düştü!', 'bad', true)
  },
  onCarLost: car => {
    state.stats.lost++
    ui.toast(t('Müşteri beklemekten sıkıldı ve gitti!'), 'bad', true)
    audio.miss()
    state.addRep(-0.2)
    if (ui.activeCar === car) ui.selectCar(nextServableCar())
  },
})

/** pompacı çalışan pompaya yanaşan araç: panel açılmaz, popup kalmaz (pompacı halleder) */
function isAttendantCar(car: Car): boolean {
  if (car.slotIndex < 0) return false
  // pompacı VEYA şarjcı devredeyse otomasyon halleder → panel/popup hiç açılmasın
  return car.kind === 'ev' ? state.autoChargers.has(car.slotIndex) : (car.kind === 'fuel' && state.autoPumps.has(car.slotIndex))
}
function nextServableCar(): Car | null {
  return cars.cars.find(c => c.phase === 'atPump' && !isAttendantCar(c)) ?? null
}

// ---- Pompa hortumları (her pompa bağımsız, her aracın kendi hortumu) ----
const hoses = new Map<Car, THREE.Group>()

function buildHose(car: Car): THREE.Group {
  const slot = car.slotIndex >= 0 ? world.pumpSlots[car.slotIndex] : car.group.position
  const bx = slot.x - 1.8
  const y = slot.y
  const start = new THREE.Vector3(bx + 0.3, y + 0.3, 1.3)
  const mid = new THREE.Vector3(bx + 0.85, y - 0.05, 0.5)
  const end = new THREE.Vector3(bx + 1.22, y - 0.35, 0.62)
  const curve = new THREE.QuadraticBezierCurve3(start, mid, end)
  const g = new THREE.Group()
  const tube = new THREE.Mesh(new THREE.TubeGeometry(curve, 24, 0.045, 8),
    new THREE.MeshLambertMaterial({ color: 0x23272b }))
  tube.castShadow = true
  g.add(tube)
  const tip = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.12, 0.24),
    new THREE.MeshLambertMaterial({ color: car.nozzle === 'benzin' ? 0x2fa05a : car.nozzle === 'dizel' ? 0xe8862e : 0x2f6fed }))
  tip.position.copy(end)
  tip.position.z += 0.12
  g.add(tip)
  world.scene.add(g)
  return g
}

function syncHoses() {
  for (const c of cars.cars) {
    const need = c.kind === 'fuel' && c.phase === 'atPump' && !!c.nozzle && !c.wrongFuelHandled
    if (need && !hoses.has(c)) hoses.set(c, buildHose(c))
    else if (!need && hoses.has(c)) { world.scene.remove(hoses.get(c)!); hoses.delete(c) }
  }
  for (const [c, g] of hoses) {
    if (c.phase !== 'atPump' || !cars.cars.includes(c)) {
      world.scene.remove(g)
      hoses.delete(c)
    }
  }
}

// ---- Memnuniyet, tesis ziyaretleri ve yayalar ----

interface Visit {
  buildingId: string
  revenue: () => number
  toastMsg: (m: number) => string
  score: number
}

/** araç park edip yayanın yürüyerek ziyaret edeceği tesisler */
function facilityVisits(car: Car): Visit[] {
  const v: Visit[] = []
  if (car.wantsMarket && state.marketLevel > 0) {
    v.push({ buildingId: 'market', revenue: () => Math.round((25 + Math.random() * 35) * state.marketLevel), toastMsg: m => t('🛒 Market alışverişi: +₺{0}', m), score: 0.2 })
  }
  if (car.wantsToilet && state.toiletLevel > 0) {
    const fee = state.toiletFee
    v.push({
      buildingId: 'toilet',
      revenue: () => fee,
      toastMsg: mm => t('🚻 Tuvalet ücreti: +₺{0}', mm),
      score: 0.15 * state.toiletLevel - (fee > 0 ? 0.03 + fee * 0.012 : 0),
    })
  }
  if (car.wantsCoffee && state.hasCoffee) {
    v.push({ buildingId: 'coffee', revenue: () => Math.round(20 + Math.random() * 25), toastMsg: m => t('☕ Kahve satışı: +₺{0}', m), score: 0.15 })
  }
  if (car.wantsFood && state.hasRestaurant) {
    v.push({ buildingId: 'restaurant', revenue: () => Math.round(80 + Math.random() * 80), toastMsg: m => t('🍽️ Restoran hesabı: +₺{0}', m), score: 0.25 })
  }
  return v
}

/** olmayan tesisi arayan müşterinin hayal kırıklığı */
function missingPenalty(car: Car): number {
  let d = 0
  if (car.wantsToilet && state.toiletLevel === 0) { d -= 0.8; ui.toast('🚻 Müşteri tuvalet arıyordu, bulamadı!', 'bad') }
  if (car.wantsMarket && state.marketLevel === 0) d -= 0.3
  if (car.wantsCoffee && !state.hasCoffee) d -= 0.1
  if (car.wantsFood && !state.hasRestaurant) d -= 0.1
  if (car.wantsWash && !state.hasWash) d -= 0.25
  if (car.wantsOil && !state.hasOil) d -= 0.15
  return d
}

/** araç servisleri (yıkama, yağ, hava-su) — park gerektirmez */
function vehicleServices(car: Car): number {
  let d = 0
  if (car.wantsWash && state.hasWash) {
    const m = Math.round(60 + Math.random() * 60)
    state.addPending('wash', m, t('Oto yıkama')); d += 0.2
    ui.toast(t('Araç yıkandı: ₺{0} kumbarada', m), 'good')
  }
  if (car.wantsOil && state.hasOil) {
    const m = Math.round(150 + Math.random() * 100)
    state.addPending('oil', m, t('Yağ değişimi')); d += 0.25
    ui.toast(t('🔧 Yağ değişimi: +₺{0} kumbarada', m), 'good')
  }
  if (car.wantsAir && state.hasAirWater) {
    const m = Math.round(10 + Math.random() * 10)
    state.addPending('airwater', m, 'Hava-su'); d += 0.1
  }
  return d
}

// yaya sistemi
interface Walker {
  g: THREE.Group
  queue: { p: THREE.Vector3; wait: number }[]
  wait: number
  done: () => void
}
const walkers: Walker[] = []
/** tesis adı (kumbara etiketi için) */
function facName(id: string): string {
  return ({ market: t('Market'), toilet: t('Tuvalet'), coffee: t('Kahveci'), restaurant: t('Restoran'), oil: t('Yağ değişimi') } as Record<string, string>)[id] ?? id
}
const pendingVisits = new Map<Car, { visits: Visit[]; score: number; started: boolean }>()

function personMesh(): THREE.Group {
  const g = new THREE.Group()
  const SHIRTS = [0xd66a5b, 0x5b8def, 0x62b56b, 0xe0b13e, 0x9a7bd0]
  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.16, 0.5, 10),
    new THREE.MeshLambertMaterial({ color: SHIRTS[Math.floor(Math.random() * SHIRTS.length)] }))
  body.rotation.x = Math.PI / 2
  body.position.z = 0.32
  body.castShadow = true
  g.add(body)
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.11, 10, 8),
    new THREE.MeshLambertMaterial({ color: 0xf0c8a0 }))
  head.position.z = 0.68
  g.add(head)
  return g
}

function spawnWalkerFor(car: Car, data: { visits: Visit[]; score: number; squat?: boolean }) {
  const start = car.group.position.clone().add(new THREE.Vector3(0.8, -0.6, 0))
  start.z = 0
  const stops = data.visits
    .map(v => world.buildings.find(b => b.id === v.buildingId))
    .filter(b => !!b)
    .map(b => {
      const p = b!.group.position.clone()
      p.x += 1.9; p.z = 0
      return p
    })
  const g = personMesh()
  g.position.copy(start)
  world.scene.add(g)
  const queue = stops.map(p => ({ p, wait: 1.4 }))
  queue.push({ p: start.clone(), wait: 0 })
  walkers.push({
    g, queue, wait: 0,
    done: () => {
      let score = data.score
      for (const v of data.visits) {
        const m = v.revenue()
        if (m > 0) { state.addPending(v.buildingId, m, facName(v.buildingId)); ui.toast(v.toastMsg(m), 'good') }
        score += v.score
      }
      state.addRep((score - 3.3) * 0.08)
      car.showFeedback(emojiFor(score))
      if (!data.squat) cars.releaseCar(car) // işgalci: oyuncu GÖNDER diyene kadar kalır
      pendingVisits.delete(car)
    },
  })
}

function updateWalkers(dt: number) {
  for (let i = walkers.length - 1; i >= 0; i--) {
    const w = walkers[i]
    if (w.wait > 0) { w.wait -= dt; continue }
    const target = w.queue[0]
    if (!target) {
      world.scene.remove(w.g)
      walkers.splice(i, 1)
      w.done()
      continue
    }
    const d = new THREE.Vector3().subVectors(target.p, w.g.position)
    d.z = 0
    const dist = d.length()
    const step = 2.4 * dt
    if (dist <= step) {
      w.g.position.copy(target.p)
      w.wait = target.wait
      w.queue.shift()
    } else {
      d.normalize()
      w.g.position.addScaledVector(d, step)
      w.g.rotation.z = Math.atan2(d.y, d.x)
    }
  }
}

function emojiFor(score: number): string {
  return score >= 4.5 ? '😍' : score >= 3.5 ? '🙂' : score >= 2.5 ? '😐' : '😡'
}

// ---- Servis akışı (yakıt) ----

ui.onNozzle = (car, type: FuelType) => {
  car.nozzle = type
  tutAdvance(2)
}

ui.onStart = (car, amount) => {
  car.targetAmount = amount
  car.filling = true
  car.beingServed = true
  audio.clunk()
  tutAdvance(3)
}

ui.onStartFull = car => {
  // FULLE: gizli depo ihtiyacına kadar bas — ne tutacağı sonda belli olur
  car.fullMode = true
  car.filling = true
  car.beingServed = true
  tutAdvance(3)
  audio.clunk()
}

/** servis bitti: skoru bağla, tesis ziyareti varsa otoparka çek, yoksa uğurla */
function trackDaily() {
  state.dailyServed++
  if (!state.dailyDone && state.dailyServed >= 15) {
    state.dailyDone = true
    state.money += 1000
    ui.toast('GÜNLÜK GÖREV TAMAM: 15 müşteri — ödül +₺1.000!', 'good', true)
    audio.achieve()
  } else if (!state.dailyDone && state.dailyServed % 5 === 0) {
    ui.toast(t('Günlük görev: {0}/15 müşteri', state.dailyServed), '', true)
  }
}

function concludeService(car: Car, score: number) {
  if (car.isTruck && state.hasTruckPark && car.phase === 'atPump' && Math.random() < 0.45) {
    trackDaily()
    state.addRep((score - 3.3) * 0.1)
    car.showFeedback(emojiFor(score))
    car.hideBubble()
    car.filling = false
    car.beingServed = false
    if (ui.activeCar === car) ui.selectCar(nextServableCar())
    if (cars.sendTruckToParkFromPump(car)) return
    cars.releaseCar(car)
    return
  }
  trackDaily()
  score += missingPenalty(car) + vehicleServices(car)
  const visits = facilityVisits(car)
  if (visits.length > 0 && cars.sendToParking(car)) {
    pendingVisits.set(car, { visits, score, started: false })
    ui.toast(t('🅿️ Müşteri aracını otoparka çekti, tesisleri kullanacak.'), '')
  } else {
    // otopark doluysa ziyaret gelirleri yine gelsin (hızlı mod)
    for (const v of visits) {
      const m = v.revenue()
      if (m > 0) { state.addPending(v.buildingId, m, facName(v.buildingId)); ui.toast(v.toastMsg(m), 'good') }
      score += v.score
    }
    state.addRep((score - 3.3) * 0.08)
    car.showFeedback(emojiFor(score))
    cars.releaseCar(car)
  }
  if (ui.activeCar === car) ui.selectCar(nextServableCar())
}

function finishSale(car: Car) {
  const revenue0 = Math.min(car.filledValue, car.demandAmount)
  let revenue = revenue0
  const spill = Math.max(0, car.filled - car.demandLiters)
  let score = 3.5

  if (car.patienceFrac > 0.6) score += 0.5
  else if (car.patienceFrac < 0.25) score -= 1

  if (spill > 1) {
    // ufak taşmalar dert değil; anlamlı döküntüye anlamlı ceza
    const penalty = Math.max(5, Math.round(spill * SPILL_PENALTY_PER_L))
    state.money -= penalty
    score -= 0.8
    ui.toast(t('Taşan yakıt cezası: -₺{0}', penalty), 'bad')
  } else if (car.autoServed && car.filledValue >= car.demandAmount - 10) {
    score += 0.6 // pompacı düzgün doldurur ama bahşiş ona kalır
  } else if (car.filledValue >= car.demandAmount - 10) {
    // temiz camlar bahşişi ikiye katlar ve memnuniyeti artırır
    const tip = Math.round(revenue0 * (car.windowsCleaned ? 0.2 : 0.1))
    revenue += tip
    score += car.windowsCleaned ? 1.1 : 0.8
    ui.toast(t('Bahşiş: +₺{0}', tip), 'good')
  } else if (car.windowsCleaned && Math.random() < 0.5) {
    // dolum tam olmasa da temiz cama nezaket bahşişi (bahşiş olasılığını artırır)
    const tip = Math.max(1, Math.round(revenue0 * 0.05))
    revenue += tip
    score += 0.2
    ui.toast(t('Temiz camlara bahşiş: +₺{0}', tip), 'good')
  } else {
    score -= 0.6 // eksik dolum: sessiz, sadece memnuniyet düşer
  }

  // pompacı satışı: gelirin TAMAMI kasaya girer (kesinti yok). Oyuncu yalnızca bahşişten
  // feragat eder. Pozitif toast göster — eskiden sadece kesinti görünüp "hep zarar" sanılıyordu.
  if (car.autoServed && revenue0 > 0) {
    ui.toast(t('🧑‍🔧 Pompacı sattı: +₺{0}', Math.round(revenue)), 'good', true)
  }
  state.money += revenue
  state.stats.served++
  state.stats.revenue += revenue
  if (car.nozzle) state.stats.liters[car.nozzle] += car.filled
  car.filling = false
  concludeService(car, score)
}

function wrongFuel(car: Car) {
  car.wrongFuelHandled = true
  car.filling = false
  const wfPenalty = state.graceActive ? 100 : WRONG_FUEL_PENALTY // grace: yeni oyuncu daha az cezalanır
  state.money -= wfPenalty
  state.addRep(-0.4)
  ui.toast(t('🚨 {0} isteyen araca {1} bastın! -{2} ₺', FUEL_LABEL[car.demandType], FUEL_LABEL[car.nozzle!], wfPenalty), 'bad')
  car.showFeedback('😡')
  cars.releaseCar(car)
  if (ui.activeCar === car) ui.selectCar(nextServableCar())
}

// ---- EV şarj ----

ui.onDismiss = car => {
  if (car.squatting) {
    car.squatting = false
    cars.releaseCar(car)
    ui.toast('Molacı uğurlandı — şarj yeri boşaldı.', 'good')
    if (ui.activeCar === car) ui.selectCar(nextServableCar())
    return
  }
  if (car.phase !== 'atPump' || car.filling || car.filled > 0) return
  state.addRep(-0.1)
  car.showFeedback('😐')
  ui.toast('Müşteri kibarca gönderildi.', '')
  cars.releaseCar(car)
  if (ui.activeCar === car) ui.selectCar(nextServableCar())
}

ui.onCleanWindows = car => {
  if (car.phase !== 'atPump' || car.windowsCleaned) return
  car.cleanWindows()
  ui.toast(t('Ön cam pırıl pırıl — bahşiş şansı arttı! ✨'), 'good')
}

/** batarya deposu seviyesine göre araca akış hızı (kWh/sn) */
const DISCHARGE_RATE = [0, 15, 25, 40]

function startCharging(car: Car, auto = false) {
  if (car.phase !== 'atPump' || car.charging || car.squatting) return
  if (state.dieselRunning() && Math.random() < 0.35) {
    car.demandKwh = Math.ceil(car.demandKwh / 2)
    ui.toast('🔊 Jeneratör gürültüsünden rahatsız — yarısı kadar şarj isteyecek!', 'bad')
  }
  car.charging = true
  car.beingServed = true
  if (auto) ui.toast('Otomatik şarj başladı.', '', true)
  else if (state.battery < 1) ui.toast('Depo şu an boş — üretim geldikçe şarj yavaş akacak.', '')
}

ui.onChargeEV = car => startCharging(car)

/** kademeli EV şarjı: depo → araç akışı */
function tickEvCharging(dt: number) {
  const cap = DISCHARGE_RATE[state.batteryLevel] || 0
  for (const c of cars.cars) {
    if (!c.charging) continue
    if (c.phase !== 'atPump') { c.charging = false; continue }
    if (c.slotIndex >= 0 && state.brokenChargers.has(c.slotIndex)) {
      c.charging = false
      ui.toast(t('Şarj ünitesi arızalandı — şarj durdu, tamir gerekli.'), 'bad')
      notifyIfHidden(t('🔧 Şarj ünitesi arızalandı — tamir gerekli!'), 'ariza-sarj')
      cars.releaseCar(c)
      continue
    }
    const need = c.demandKwh - c.chargedKwh
    const give = Math.min(need, cap * dt, state.battery)
    state.battery = Math.max(0, state.battery - give)
    c.chargedKwh += give
    c.setCounter(`⚡ ${Math.floor(c.chargedKwh)}/${c.demandKwh} kWh`)
    if (c.chargedKwh >= c.demandKwh - 0.001) {
      c.charging = false
      const revenue = Math.round(c.demandKwh * state.elecPrice)
      state.money += revenue
      state.stats.served++
      state.stats.kwh += c.demandKwh
      state.stats.revenue += revenue
      let score = 4.5
      if (c.patienceFrac < 0.4) score -= 1.5
      ui.toast(t('⚡ {0} kWh şarj tamamlandı: +₺{1}', c.demandKwh, revenue), 'good')
      const anyFacility = state.marketLevel > 0 || state.toiletLevel > 0 || state.hasCoffee || state.hasRestaurant
      if (anyFacility && Math.random() < 0.12) {
        // işgalci: aracı ünitede bırakıp tesislere gidiyor — GÖNDER'e basılana dek yer dolu
        c.squatting = true
        c.beingServed = true
        c.setCounter('MOLADA · GÖNDER →')
        const visits = facilityVisits(c)
        spawnWalkerFor(c, { visits, score, squat: true })
        ui.toast(t('⚡ Molacı üniteyi tutuyor — göndermek için araca dokun 👆'), 'bad')
      } else {
        concludeService(c, score)
      }
    }
  }
}

// ---- Sipariş, inşaat, bakım ----

ui.onOrderFuel = f => {
  const o = state.orders[f]
  if (o.pending || o.delivering) { ui.toast(t('{0} tankeri zaten yolda — teslimatı bekle.', FUEL_LABEL[f]), ''); return }
  if (state.placeOrder(f)) ui.toast(t('{0} tankeri yola çıktı!', FUEL_LABEL[f]), 'good')
  else ui.toast('Sipariş verilemedi (tank dolu ya da para yetmiyor).', 'bad')
}
ui.onOrderQty = (f, d) => { state.adjustOrderQty(f, d) } // −/+ sipariş miktarı (fneed sonraki karede güncellenir)

/** satın alma sonrası sahnedeki görsel karşılığını kurar */
function buildVisual(id: string, pos?: THREE.Vector2) {
  const base = id.split('#')[0]
  if (base.startsWith('pump-') && pos) {
    world.addPump(parseInt(base.slice(5)), new THREE.Vector2(pos.x - 0.9, pos.y))
    return
  }
  if (base.startsWith('charger-') && pos) {
    world.addEvCharger(parseInt(base.slice(8)), new THREE.Vector2(pos.x - 0.5, pos.y))
    return
  }
  if (base.startsWith('tankadd-')) {
    world.upgradeTankVisual(state.tankLevel, state.tankCounts) // yakıta özel yeni tank belirir
    return
  }
  switch (base) {
    case 'pump': world.addPump(state.pumps - 1); break
    case 'sign': world.setSign(state.signLevel, pos); break
    case 'widegate': world.setWideGates(true); break
    case 'tank': world.upgradeTankVisual(state.tankLevel, state.tankCounts); break
    case 'market': world.buildMarket(state.marketLevel, pos); break
    case 'toilet': world.buildToilet(state.toiletLevel, pos); break
    case 'battery': world.buildBattery(state.batteryLevel, pos); break
    case 'evcharger': world.addEvCharger(state.evChargers - 1); break
    case 'solar': world.buildSolar(state.landSouth ? 'south' : 'north', pos, id); break
    case 'dieselgen': world.buildDiesel(pos); break
    case 'smr': world.buildSMR(state.landNorth ? 'north' : 'south', pos); break
    case 'wash': world.buildWash(pos); break
    case 'oil': world.buildOil(pos); break
    case 'coffee': world.buildCoffee(pos); break
    case 'restaurant': world.buildRestaurant(pos); break
    case 'truckpark': world.buildTruckPark(pos); break
    case 'airwater': world.buildAirWater(pos, id); break
    case 'selfwash': world.buildSelfWash(pos, id); break
    case 'parking': world.buildParking(pos, id); break
    case 'office': world.buildOffice(pos); break
  }
}

// ---- Grid'e yerleştirme modu ----

interface Footprint { w: number; d: number; grass?: boolean }
const PLACEABLE: Record<string, (forMove: boolean) => Footprint> = {
  market: () => ({ w: 6, d: 7 }), // 3 seviyede de AYNI footprint (yerinde yükselir, yıkmak gerekmez)
  toilet: () => ({ w: 3, d: 4 }),
  battery: () => ({ w: 3, d: 2 }),
  solar: () => ({ w: 5, d: 7, grass: true }),
  dieselgen: () => ({ w: 2, d: 2 }),
  smr: () => ({ w: 6, d: 5 }),
  wash: () => ({ w: 4.5, d: 5 }),
  oil: () => ({ w: 4, d: 4 }),
  coffee: () => ({ w: 3.2, d: 3.2 }),
  restaurant: () => ({ w: 5.5, d: 6 }),
  truckpark: () => ({ w: 8, d: 6 }),
  airwater: () => ({ w: 1.6, d: 2 }),
  selfwash: () => ({ w: 5.5, d: 7 }),
  parking: () => ({ w: 4.6, d: 3.2 }),
  office: () => ({ w: 5, d: 5.5 }),
  sign: () => ({ w: 1.8, d: 1.8, grass: true }), // tabela taşınabilir (çimen üstüne de konabilir)
}

interface Rect { cx: number; cy: number; w: number; d: number }
const placedRects: (Rect & { id: string })[] = []
const placedPos: Record<string, [number, number]> = {}
const groundPlane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0)

// ---- Kayıt sistemi ----

let lastRemotePush = 0
// Buluttan kayıt YÜKLENEMEDİYSE (ağ/sunucu hatası) hiçbir kayıt gönderilmez —
// taze bir oturumun ilerlemiş bulut kaydını EZMESİNİ önler (override koruması).
let cloudBlocked = false

function savePayload() {
  return { s: serializeState(state), placedPos, placedRot, placedRects, at: Date.now() }
}

// ---- Çoklu cihaz senkronu ----
let syncing = false
let syncedConflict = false
/** Save'i sunucuya yaz; başka cihaz daha yeni yazmışsa (409) en güncele senkronla. */
async function syncSave() {
  if (syncing || cloudBlocked || !auth.loggedIn()) return
  syncing = true
  try {
    const r = await auth.pushSave(savePayload())
    if (r.conflict && !syncedConflict) { syncedConflict = true; onRemoteNewer() }
  } catch { /* ağ hatası: sessiz geç */ } finally { syncing = false }
}
/** başka cihaz daha yeni oynadı → clobber etme, en güncel ilerlemeye temiz reload ile senkronla */
function onRemoteNewer() {
  ui.toast(t('🔄 Başka bir cihazda oynanmış — en güncel ilerlemeye senkronlanıyor…'), '')
  setTimeout(() => location.reload(), 1400)
}

function showCloudBlockOverlay() {
  if (document.getElementById('cloudblock')) return
  const o = document.createElement('div')
  o.id = 'cloudblock'
  o.style.cssText = 'position:fixed;inset:0;z-index:99999;background:#0d1420f2;display:flex;'
    + 'align-items:center;justify-content:center;padding:24px;backdrop-filter:blur(4px)'
  o.innerHTML = `<div style="max-width:420px;text-align:center;color:#eaf1fb;font-family:system-ui,sans-serif">
    <div style="font-size:44px;margin-bottom:8px">☁️⚠️</div>
    <div style="font-size:20px;font-weight:800;margin-bottom:10px">${t('Buluta bağlanılamadı')}</div>
    <div style="font-size:14px;line-height:1.5;color:#b8c6da;margin-bottom:20px">${t('İlerlemeni korumak için oyun durduruldu. Kaydın güvende — hiçbir şey silinmedi. Bağlantı gelince yenile.')}</div>
    <button id="cloudblock-retry" style="padding:12px 22px;font-size:15px;font-weight:700;border:0;border-radius:12px;background:#2f6fed;color:#fff;cursor:pointer">${t('Yenile')}</button>
  </div>`
  document.body.appendChild(o)
  ;(document.getElementById('cloudblock-retry') as HTMLButtonElement).addEventListener('click', () => location.reload())
}

function showBanOverlay(reason: string) {
  if (document.getElementById('banblock')) return
  cloudBlocked = true // tüm kayıt + oyun + WS reconnect durur
  try { liveWs?.close() } catch {}
  localStorage.removeItem('benzinlik-token')
  const o = document.createElement('div')
  o.id = 'banblock'
  o.style.cssText = 'position:fixed;inset:0;z-index:100000;background:#1a0d0df5;display:flex;'
    + 'align-items:center;justify-content:center;padding:24px;backdrop-filter:blur(5px)'
  o.innerHTML = `<div style="max-width:420px;text-align:center;color:#f4e9e9;font-family:system-ui,sans-serif">
    <div style="font-size:46px;margin-bottom:8px">🚫</div>
    <div style="font-size:20px;font-weight:800;margin-bottom:10px">${t('Hesabın askıya alındı')}</div>
    <div style="font-size:14px;line-height:1.5;color:#d8b8b8;margin-bottom:20px">${reason || t('Kurallar ihlal edildi.')}</div>
    <button id="banblock-ok" style="padding:12px 22px;font-size:15px;font-weight:700;border:0;border-radius:12px;background:#c9433b;color:#fff;cursor:pointer">${t('Tamam')}</button>
  </div>`
  document.body.appendChild(o)
  ;(document.getElementById('banblock-ok') as HTMLButtonElement).addEventListener('click', () => location.reload())
}

function showVerifyGate() {
  if (document.getElementById('verifygate')) return
  cloudBlocked = true // doğrulanana dek kayıt/oyun/WS durur
  const email = auth.currentEmail() || ''
  const o = document.createElement('div')
  o.id = 'verifygate'
  o.style.cssText = 'position:fixed;inset:0;z-index:99998;background:#0d1420f7;display:flex;align-items:center;justify-content:center;padding:20px;overflow:auto;font-family:system-ui,sans-serif'
  o.innerHTML = `<div style="max-width:400px;width:100%;text-align:center;color:#eaf1fb">
    <div style="font-size:44px;margin-bottom:6px">📧</div>
    <div style="font-size:20px;font-weight:800;margin-bottom:8px">${t('E-postanı doğrula')}</div>
    <div style="font-size:14px;line-height:1.5;color:#b8c6da;margin-bottom:16px"><b>${email}</b> ${t('adresine doğrulama bağlantısı gönderdik. Mailindeki linke tıkla, sonra Kontrol Et’e bas.')}</div>
    <button id="vg-check" style="width:100%;padding:12px;border:0;border-radius:10px;background:#27a05a;color:#fff;font-weight:700;font-size:15px;cursor:pointer;margin-bottom:8px">${t('Doğruladım — Kontrol Et')}</button>
    <button id="vg-resend" style="width:100%;padding:11px;border:1px solid #33465f;border-radius:10px;background:#12233d;color:#eaf1fb;font-size:14px;cursor:pointer;margin-bottom:14px">${t('Doğrulama mailini tekrar gönder')}</button>
    <div style="border-top:1px solid #22344d;padding-top:14px">
      <div style="font-size:12px;color:#8ea0b5;margin-bottom:6px">${t('Yanlış e-posta mı? Değiştir:')}</div>
      <input id="vg-email" type="email" placeholder="yeni@eposta.com" style="width:100%;box-sizing:border-box;padding:10px;border-radius:8px;border:1px solid #33465f;background:#12233d;color:#fff;margin-bottom:6px">
      <button id="vg-change" style="width:100%;padding:10px;border:0;border-radius:8px;background:#2f6fed;color:#fff;font-weight:600;cursor:pointer">${t('E-postayı değiştir & yeniden gönder')}</button>
    </div>
    <button id="vg-logout" style="margin-top:14px;background:none;border:0;color:#8ea0b5;font-size:12px;cursor:pointer;text-decoration:underline">${t('Çıkış yap')}</button>
    <p id="vg-msg" style="color:#4fd18a;font-size:13px;margin-top:10px;min-height:16px"></p>
  </div>`
  document.body.appendChild(o)
  const msg = document.getElementById('vg-msg') as HTMLParagraphElement
  document.getElementById('vg-check')!.addEventListener('click', () => location.reload())
  document.getElementById('vg-resend')!.addEventListener('click', async () => {
    msg.textContent = t('Gönderiliyor...')
    try { await auth.sendVerify(); msg.textContent = t('Mail gönderildi ✓ Gelen kutunu kontrol et.') } catch { msg.textContent = t('Gönderilemedi, biraz sonra dene.') }
  })
  document.getElementById('vg-change')!.addEventListener('click', async () => {
    const ne = (document.getElementById('vg-email') as HTMLInputElement).value.trim()
    if (!/^\S+@\S+\.\S+$/.test(ne)) { msg.textContent = t('Geçerli bir e-posta gir.'); return }
    msg.textContent = t('Değiştiriliyor...')
    try { await auth.changeEmail(ne); msg.textContent = t('E-posta değişti ✓ Yeni adrese doğrulama gönderildi.'); setTimeout(() => location.reload(), 1500) }
    catch (e) { msg.textContent = (e as Error).message }
  })
  document.getElementById('vg-logout')!.addEventListener('click', () => { auth.logout(); location.reload() })
}

function persist() {
  if (isFullMode || isPromoMode || cloudBlocked) return
  // tek gerçek kaynak SQL: yerel kopya tutulmaz, eski veri asla hortlamaz.
  // syncSave çoklu cihaz çakışmasını (409) ele alır — başka cihaz ilerlettiyse senkronlar.
  if (auth.loggedIn() && Date.now() - lastRemotePush > 5_000) {
    lastRemotePush = Date.now()
    syncSave()
  }
}

let loadedSaveAt = 0

function applySaveData(d: Record<string, unknown>) {
  loadedSaveAt = Number(d.at ?? 0)
  hydrateState(state, (d.s ?? {}) as Record<string, unknown>)
  setPremium(state.noAds) // remove-ads satın alındıysa interstitial kapalı
  Object.assign(placedPos, (d.placedPos ?? {}) as Record<string, [number, number]>)
  Object.assign(placedRot, (d.placedRot ?? {}) as Record<string, number>)
  if (Array.isArray(d.placedRects)) placedRects.push(...(d.placedRects as (Rect & { id: string })[]).filter(r => r.id !== 'gatein' && r.id !== 'gateout'))
}

/**
 * Offline (arka plan) gelir: oyuncu yokken geçen süre kadar pasif kazanç.
 * İstasyonun gelişmişliğine göre ₺/sn hız × süre × verim (aktif oyundan düşük).
 * En fazla 6 saat + ₺150.000 tavan. İstasyon kapalıysa gelir yok.
 * Anti-cheat uyumlu: income ≤ 150k, sunucu allowance'ı (50k + elapsed×600) hep kapsar.
 */
function applyOfflineEarnings() {
  if (state.closed || !loadedSaveAt) return
  const elapsedSec = (Date.now() - loadedSaveAt) / 1000
  if (elapsedSec < 120) return // <2 dk: anlamsız
  const capped = Math.min(elapsedSec, 6 * 3600) // en fazla 6 saat
  const facilities = (state.marketLevel > 0 ? state.marketLevel : 0)
    + (state.hasCoffee ? 1 : 0) + (state.hasRestaurant ? 1 : 0) + (state.hasWash ? 1 : 0)
    + (state.hasOil ? 1 : 0) + (state.hasTruckPark ? 1 : 0) + state.selfWashCount + (state.hasSMR ? 2 : 0)
  const ratePerSec = 1 + state.pumps * 1.2 + state.evChargers * 0.8 + facilities * 0.6
  const income = Math.min(150_000, Math.round(ratePerSec * capped * 0.4)) // %40 offline verim
  if (income < 50) return
  state.money += income
  showOfflineModal(income, elapsedSec)
}

/** "Tekrar hoş geldin — yokken istasyonun kazandı" modalı (oyunun krem/kırmızı dili) */
function showOfflineModal(income: number, elapsedSec: number) {
  const h = Math.floor(elapsedSec / 3600), m = Math.floor((elapsedSec % 3600) / 60)
  const dur = h > 0 ? `${h} sa ${m} dk` : `${m} dk`
  const o = document.createElement('div')
  o.style.cssText = 'position:fixed;inset:0;z-index:99997;background:#0d1420cc;display:flex;align-items:center;justify-content:center;padding:22px;font-family:var(--font,system-ui)'
  o.innerHTML =
    `<div style="background:linear-gradient(180deg,#fdfaf2,#f1ebdb);border:2px solid #e0d4bd;border-bottom-width:7px;border-radius:22px;padding:22px 26px;max-width:340px;width:100%;text-align:center;box-shadow:0 24px 60px rgba(10,14,20,.5)">`
    + `<div style="font-size:44px;line-height:1">🏭💤</div>`
    + `<div style="font-size:22px;font-weight:800;color:#1e2a36;margin:8px 0 2px">Tekrar hoş geldin!</div>`
    + `<div style="font-size:13px;font-weight:700;color:#7a6152">${dur} yoktun — istasyonun senin için çalıştı ⛽</div>`
    + `<div style="font-size:34px;font-weight:800;color:#2fa05a;margin:14px 0 2px">+₺${income.toLocaleString('tr-TR')}</div>`
    + `<div style="font-size:11px;font-weight:700;color:#9aa4b0;margin-bottom:16px">kasana eklendi</div>`
    + `<button id="off-ok" style="width:100%;padding:12px;border-radius:14px;border:2px solid #b03535;border-bottom-width:4px;background:linear-gradient(180deg,#e05656,#d64545);color:#fff;font-weight:800;font-size:16px;cursor:pointer">Devam et 🚀</button>`
    + `</div>`
  document.body.appendChild(o)
  const close = () => o.remove()
  o.querySelector('#off-ok')?.addEventListener('click', close)
  o.addEventListener('click', e => { if (e.target === o) close() })
}

/** kayıttan gelen state'e göre sahneyi yeniden kurar */
function rebuildFromState() {
  const validParcel = (c: number, r: number) => Number.isInteger(c) && Number.isInteger(r) && c >= 0 && c < PARCEL_COLS.length && r >= 0 && r < PARCEL_ROWS.length
  for (const key of state.ownedParcels) {
    const [c, r] = key.split(',').map(Number)
    if ((c === 0 && r === 1) || !validParcel(c, r)) continue // sınır dışı / bozuk parsel atlanır
    world.markOwned(c, r)
  }
  for (const key of state.pavedParcels) {
    const [c, r] = key.split(',').map(Number)
    if ((c === 0 && r === 1) || !validParcel(c, r)) continue
    world.paveParcel(c, r)
  }
  const pvv = (id: string) => (placedPos[id] ? new THREE.Vector2(placedPos[id][0], placedPos[id][1]) : undefined)
  for (let i = 1; i < state.pumps; i++) {
    const sp = pvv(`pump-${i}`)
    world.addPump(i, sp ? new THREE.Vector2(sp.x - 0.9, sp.y) : undefined)
  }
  for (let i = 0; i < state.evChargers; i++) {
    const sp = pvv(`charger-${i}`)
    // Kayıtlı açıyla kur → araç yanaşma slotu da doğru hesaplanır (rotateBuilding slot güncellemez).
    world.addEvCharger(i, sp ? new THREE.Vector2(sp.x - 0.5, sp.y) : undefined, placedRot[`charger-${i}`] ?? 0)
  }
  world.setSign(state.signLevel, placedPos.sign ? new THREE.Vector2(placedPos.sign[0], placedPos.sign[1]) : undefined)
  if (state.wideGates) world.setWideGates(true)
  world.upgradeTankVisual(state.tankLevel, state.tankCounts) // seviye + yakıt-başına adet
  const pv = (id: string) => (placedPos[id] ? new THREE.Vector2(placedPos[id][0], placedPos[id][1]) : undefined)
  if (state.marketLevel > 0) world.buildMarket(state.marketLevel, pv('market'))
  if (state.toiletLevel > 0) world.buildToilet(state.toiletLevel, pv('toilet'))
  if (state.batteryLevel > 0) world.buildBattery(state.batteryLevel, pv('battery'))
  for (let i = 0; i < state.solarCount; i++) {
    const iid = i === 0 ? 'solar' : `solar#${i}`
    world.buildSolar(state.landSouth ? 'south' : 'north', pv(iid), iid)
  }
  if (state.hasDiesel) world.buildDiesel(pv('dieselgen'))
  if (state.hasSMR) world.buildSMR(state.landNorth ? 'north' : 'south', pv('smr'))
  if (state.hasWash) world.buildWash(pv('wash'))
  if (state.hasOil) world.buildOil(pv('oil'))
  if (state.hasCoffee) world.buildCoffee(pv('coffee'))
  if (state.hasRestaurant) world.buildRestaurant(pv('restaurant'))
  if (state.hasTruckPark) world.buildTruckPark(pv('truckpark'))
  for (let i = 0; i < state.airWaterCount; i++) {
    const iid = i === 0 ? 'airwater' : `airwater#${i}`
    world.buildAirWater(pv(iid), iid)
  }
  for (let i = 0; i < state.selfWashCount; i++) {
    const iid = i === 0 ? 'selfwash' : `selfwash#${i}`
    world.buildSelfWash(pv(iid), iid)
  }
  for (let i = 0; i < state.parkingCount; i++) {
    const iid = i === 0 ? 'parking' : `parking#${i}`
    world.buildParking(pv(iid), iid)
  }
  if (placedPos.office) {
    world.removeBuildingGroup('office')
    world.buildOffice(pv('office'))
  }
  if (placedPos.gatein) world.buildGate('in', pv('gatein'))
  if (placedPos.gateout) world.buildGate('out', pv('gateout'))
  {
    const s0 = placedPos['pump-0']
    if (s0) world.movePump(0, new THREE.Vector2(s0[0] - 0.9, s0[1]))
  }
  if (placedPos.tank) world.moveTank(new THREE.Vector2(placedPos.tank[0], placedPos.tank[1]))
  // charger'lar yukarıda açılarıyla (slot dahil) kuruldu; burada atlanır.
  for (const [id, rot] of Object.entries(placedRot)) if (!id.startsWith('charger-')) world.rotateBuilding(id, rot)
  world.setClosed(state.closed)
}

/** araçların ASLA içinden geçemeyeceği katı objeler (fiziksel gövdeler) */
function hardRects(): { cx: number; cy: number; w: number; d: number }[] {
  const r: { cx: number; cy: number; w: number; d: number }[] = []
  for (let i = 0; i < state.pumps; i++) {
    const s = world.pumpSlots[i]
    r.push({ cx: s.x - 1.8, cy: s.y, w: 1.5, d: 3.4 })
  }
  for (let i = 0; i < state.evChargers; i++) {
    const s = world.evSlots[i]
    r.push({ cx: s.x - 1.1, cy: s.y, w: 0.9, d: 1.4 })
  }
  r.push({ cx: world.tankAnchor.x + 0.45, cy: world.tankAnchor.y + 0.45, w: 2.2, d: 2.2 })
  const of = world.buildings.find(b => b.id === 'office')
  if (of) r.push({ cx: of.group.position.x, cy: of.group.position.y, w: 4.2, d: 4.6 })
  for (const p of placedRects) {
    if (p.id.startsWith('parking') || p.id === 'gatein' || p.id === 'gateout') continue
    if (p.id.startsWith('pump-') || p.id.startsWith('charger-') || p.id === 'tank' || p.id === 'truckpark') continue
    r.push({ cx: p.cx, cy: p.cy, w: p.w, d: p.d })
  }
  return r
}

function fixedObstacles(skipId = ''): Rect[] {
  const r: Rect[] = [
    { cx: 4.3, cy: 0, w: 2.0, d: 48 },       // servis şeridi (araç yolu, daraltıldı)
    { cx: 4.0, cy: -11.5, w: 2.4, d: 3.4 },  // tabela
  ]
  if (skipId !== 'tank')
    r.push({ cx: world.tankAnchor.x + 0.45, cy: world.tankAnchor.y + 0.45, w: 2.0, d: 2.0 })
  if (skipId !== 'office') {
    const of = world.buildings.find(b => b.id === 'office')
    if (of) r.push({ cx: of.group.position.x, cy: of.group.position.y, w: 4.6, d: 5.0 })
  }
  for (let i = 0; i < state.pumps; i++) {
    if (skipId === `pump-${i}`) continue
    const s = world.pumpSlots[i]
    r.push({ cx: s.x - 0.9, cy: s.y, w: 4.4, d: 4.0 })
  }
  for (let i = 0; i < state.evChargers; i++) {
    if (skipId === `charger-${i}`) continue
    const s = world.evSlots[i]
    r.push({ cx: s.x - 0.6, cy: s.y, w: 4.0, d: 2.6 })
  }
  return r
}

function overlaps(a: Rect, b: Rect): boolean {
  return Math.abs(a.cx - b.cx) < (a.w + b.w) / 2 && Math.abs(a.cy - b.cy) < (a.d + b.d) / 2
}

let placing: {
  id: string; w: number; d: number; grass: boolean; move: boolean
  root: THREE.Group; planeMat: THREE.MeshBasicMaterial
  valid: boolean; cx: number; cy: number; rot: number
} | null = null
const placedRot: Record<string, number> = {}

/** yerleştirme için silik model önizlemesi üretir */
function makePreview(id: string): THREE.Group | null {
  let g: THREE.Group | null = null
  const existing = world.buildings.find(b => b.id === id)
  if (existing) {
    g = (existing.group as THREE.Group).clone(true)
  } else {
    // binayı gerçekten kur, kayıttan düşüp hayalet olarak kullan
    const bump = id === 'market' ? 'marketLevel' : id === 'toilet' ? 'toiletLevel' : id === 'battery' ? 'batteryLevel' : null
    if (bump) (state as any)[bump]++
    buildVisual(id, new THREE.Vector2(0, 0))
    if (bump) (state as any)[bump]--
    g = world.detachPreview(id)
  }
  if (!g) return null
  g.position.set(0, 0, 0)
  g.rotation.z = 0
  g.traverse(o => {
    if ((o as THREE.Sprite).isSprite) { o.visible = false; return }
    const m = o as THREE.Mesh
    if (m.isMesh && m.material) {
      const mats = Array.isArray(m.material) ? m.material : [m.material]
      const clones = mats.map(x => {
        const c = (x as THREE.Material).clone()
        c.transparent = true
        ;(c as THREE.Material & { opacity: number }).opacity = 0.45
        c.depthWrite = false
        return c
      })
      m.material = (Array.isArray(m.material) ? clones : clones[0]) as THREE.Material
      m.castShadow = false
      m.receiveShadow = false
    }
  })
  return g
}

// ---- Kart görselleri: gerçek 3D modellerin PNG render'ları ----
let thumbRenderer: THREE.WebGLRenderer | null = null
const thumbCache = new Map<string, string>()

function thumbKey(id: string): string {
  if (id === 'market') return `market-${Math.min(state.marketLevel + 1, 2)}`
  if (id === 'toilet') return `toilet-${Math.min(state.toiletLevel + 1, 2)}`
  if (id === 'battery') return `battery-${Math.min(state.batteryLevel + 1, 3)}`
  if (id === 'sign') return `sign-${Math.min(state.signLevel, 3)}`
  return id
}

function buildThumbSubject(id: string): THREE.Group | null {
  const special = world.thumbSource(id)
  if (special) return special
  // bina sahnede zaten varsa görseli KOPYASINDAN üret — gerçek binaya asla dokunma
  const existing = world.buildings.find(b => b.id === id)
  if (existing) {
    const g = (existing.group as THREE.Group).clone(true)
    g.position.set(0, 0, 0)
    g.rotation.z = 0
    return g
  }
  if (id === 'pump') {
    if (state.pumps >= 4) {
      const ex = world.buildings.find(b => b.id.startsWith('pump-'))
      if (ex) { const g = (ex.group as THREE.Group).clone(true); g.position.set(0, 0, 0); return g }
    }
    world.addPump(state.pumps)
    const g = world.detachPreview(`pump-${state.pumps}`)
    if (g) world.scene.remove(g)
    return g
  }
  if (id === 'evcharger') {
    if (state.evChargers >= 4) {
      const ex = world.buildings.find(b => b.id.startsWith('charger-'))
      if (ex) { const g = (ex.group as THREE.Group).clone(true); g.position.set(0, 0, 0); return g }
    }
    world.addEvCharger(state.evChargers)
    const g = world.detachPreview(`charger-${state.evChargers}`)
    if (g) world.scene.remove(g)
    return g
  }
  if (id in PLACEABLE) {
    const bump = id === 'market' ? 'marketLevel' : id === 'toilet' ? 'toiletLevel' : id === 'battery' ? 'batteryLevel' : null
    let orig = 0
    if (bump) {
      orig = (state as any)[bump]
      ;(state as any)[bump] = Math.min(orig + 1, id === 'battery' ? 3 : 2)
    }
    buildVisual(id, new THREE.Vector2(0, 0))
    if (bump) (state as any)[bump] = orig
    const g = world.detachPreview(id)
    if (g) world.scene.remove(g)
    return g
  }
  return null
}

function getThumbnail(id: string): string | null {
  const key = thumbKey(id)
  const hit = thumbCache.get(key)
  if (hit) return hit
  const subject = buildThumbSubject(id)
  if (!subject) return null
  subject.traverse(o => { if ((o as THREE.Sprite).isSprite) o.visible = false })
  if (!thumbRenderer) {
    thumbRenderer = new THREE.WebGLRenderer({ alpha: true, antialias: true, preserveDrawingBuffer: true })
    thumbRenderer.setSize(300, 300)
    thumbRenderer.toneMapping = THREE.ACESFilmicToneMapping
    thumbRenderer.toneMappingExposure = 1.15
  }
  const sc = new THREE.Scene()
  sc.add(new THREE.HemisphereLight(0xffffff, 0x8899aa, 1.35))
  const sun = new THREE.DirectionalLight(0xfff0d8, 2.4)
  sun.position.set(8, -5, 11)
  sc.add(sun)
  sc.add(subject)
  const bb = new THREE.Box3().setFromObject(subject)
  const center = bb.getCenter(new THREE.Vector3())
  const size = bb.getSize(new THREE.Vector3())
  const r = Math.max(size.x, size.y, size.z) * 0.56 + 0.35
  const cam = new THREE.OrthographicCamera(-r * 1.05, r * 1.05, r * 1.05, -r * 1.05, 0.1, 200)
  cam.up.set(0, 0, 1)
  cam.position.copy(center).add(new THREE.Vector3(1, 2, 1).normalize().multiplyScalar(40))
  cam.lookAt(center)
  thumbRenderer.render(sc, cam)
  const url = thumbRenderer.domElement.toDataURL('image/png')
  thumbCache.set(key, url)
  sc.remove(subject)
  return url
}
ui.getThumb = getThumbnail

/** ayak izi hücre çizgileri — kareler net görünsün */
function footprintGrid(w: number, d: number): THREE.LineSegments {
  const pts: number[] = []
  const hw = w / 2, hd = d / 2
  for (let x = -hw; x <= hw + 0.001; x += 1) pts.push(x, -hd, 0.07, x, hd, 0.07)
  for (let y = -hd; y <= hd + 0.001; y += 1) pts.push(-hw, y, 0.07, hw, y, 0.07)
  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3))
  return new THREE.LineSegments(geo,
    new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.85, depthWrite: false }))
}
let zoneMode: { kind: 'land' | 'pave'; ghost: THREE.Mesh; c: number; r: number; valid: boolean } | null = null

function parcelAt(x: number, y: number): [number, number] | null {
  for (let c = 0; c < PARCEL_COLS.length; c++) for (let r = 0; r < PARCEL_ROWS.length; r++) {
    const [x0, x1] = PARCEL_COLS[c]
    const [y0, y1] = PARCEL_ROWS[r]
    if (x >= x0 && x <= x1 && y >= y0 && y <= y1) return [c, r]
  }
  return null
}

function landOk(x: number, y: number, grassOk: boolean): boolean {
  const p = parcelAt(x, y)
  if (!p) return false
  if (!state.owns(p[0], p[1])) return false
  return grassOk || state.isPaved(p[0], p[1])
}

function isValidPlacement(p: Rect, skipId: string, grassOk: boolean): boolean {
  // servis ekipmanı (pompa/şarj/tank) yol karşısına kurulamaz — araçlar oraya giremiyor
  if (/^(pump-|charger-)/.test(skipId) || skipId === 'tank') {
    const pc = parcelAt(p.cx, p.cy)
    if (pc && pc[0] >= 3) return false
  }
  for (const sx of [-1, 0, 1]) for (const sy of [-1, 0, 1]) {
    if (!landOk(p.cx + sx * (p.w / 2 - 0.2), p.cy + sy * (p.d / 2 - 0.2), grassOk)) return false
  }
  for (const o of fixedObstacles(skipId)) if (overlaps(p, o)) return false
  for (const o of placedRects) if (o.id !== skipId && overlaps(p, o)) return false
  return true
}

function makeGhost(w: number, d: number): THREE.Mesh {
  const ghost = new THREE.Mesh(new THREE.PlaneGeometry(w, d),
    new THREE.MeshBasicMaterial({ color: 0x37c97e, transparent: true, opacity: 0.42, depthTest: false }))
  ghost.position.z = 0.06
  world.scene.add(ghost)
  return ghost
}

function footprintOf(id: string, move = false): { w: number; d: number; grass?: boolean } | null {
  id = id.split('#')[0]
  if (id.startsWith('pump-')) return { w: 4.4, d: 4.0 }
  if (id.startsWith('charger-')) return { w: 4.0, d: 2.6 }
  if (id === 'tank') return { w: 2.0, d: 2.0 }
  if (id === 'gatein' || id === 'gateout') return { w: 2.6, d: 3.4, grass: true }
  return id in PLACEABLE ? PLACEABLE[id](move) : null
}

function startPlacement(id: string, move = false) {
  cancelPlacement()
  const f = footprintOf(id, move)
  if (!f) return
  const root = new THREE.Group()
  const planeMat = new THREE.MeshBasicMaterial({ color: 0x37c97e, transparent: true, opacity: 0.22, depthWrite: false })
  const plane = new THREE.Mesh(new THREE.PlaneGeometry(f.w, f.d), planeMat)
  plane.position.z = 0.05
  root.add(plane)
  root.add(footprintGrid(f.w, f.d))
  const preview = makePreview(id)
  if (preview) root.add(preview)
  world.scene.add(root)
  placing = { id, w: f.w, d: f.d, grass: !!f.grass, move, root, planeMat, valid: false, cx: 0, cy: 0, rot: placedRot[id] ?? 0 }
  root.rotation.z = placing.rot * Math.PI / 2
  world.showGrid(true)
  ui.closeShop()
  ui.hideBuildingCard()
  const mc = document.getElementById('movectl'); if (mc) mc.style.display = 'block'
  repositionPlacing(placing.cx, placing.cy) // ilk geçerlilik/renk
  ui.toast(move
    ? t('Taşıma modu: yön butonları ya da dokun · ⟳ döndür · ✓ yerleştir')
    : t('Yerleştirme modu: yön butonları ya da dokun · ⟳ döndür · ✓ yerleştir'), '')
}

function startZoneMode(kind: 'land' | 'pave') {
  cancelPlacement()
  zoneMode = { kind, ghost: makeGhost(1, 1), c: -1, r: -1, valid: false }
  world.showGrid(true)
  ui.closeShop()
  ui.toast(kind === 'land'
    ? t('🏞️ Arsa seçimi: bitişik parsele tıkla (₺6-14 bin) · ESC iptal')
    : t('🧱 Zemin seçimi: betonlanacak arsana tıkla · ESC iptal'), '')
}

function cancelPlacement() {
  const mc = document.getElementById('movectl'); if (mc) mc.style.display = 'none'
  const zc = document.getElementById('zonecost'); if (zc) zc.style.display = 'none'
  if (placing) {
    world.scene.remove(placing.root)
    placing = null
  }
  if (zoneMode) {
    world.scene.remove(zoneMode.ghost)
    zoneMode = null
  }
  world.showGrid(false)
}

/** taşımayı uygula — pompa/şarj/tank özel, kalanlar buildVisual */
function applyDynamicMove(id: string, cx: number, cy: number) {
  if (id.startsWith('pump-')) {
    const n = parseInt(id.slice(5))
    cars.evictSlot('fuel', n) // slottaki araç eski koordinatta asılı kalmasın
    world.movePump(n, new THREE.Vector2(cx - 0.9, cy))
  }
  else if (id.startsWith('charger-')) {
    const n = parseInt(id.slice(8))
    cars.evictSlot('ev', n)
    world.moveCharger(n, new THREE.Vector2(cx - 0.5, cy), placedRot[`charger-${n}`] ?? 0) // taşırken açıyı koru
  }
  else if (id === 'tank') world.moveTank(new THREE.Vector2(cx, cy))
  else if (id === 'gatein') { world.buildGate('in', new THREE.Vector2(cx, cy)); cars.rerouteForGates() }
  else if (id === 'gateout') { world.buildGate('out', new THREE.Vector2(cx, cy)); cars.rerouteForGates() }
  else {
    world.removeBuildingGroup(id)
    buildVisual(id, new THREE.Vector2(cx, cy))
  }
}

// yerleştirmedeki nesneyi (x,y)'ye taşı + geçerlilik/renk güncelle (pointer + mobil butonlar ortak)
function repositionPlacing(x: number, y: number) {
  if (!placing) return
  if (placing.id === 'gatein' || placing.id === 'gateout') {
    placing.cx = 4.2
    placing.cy = Math.max(-24, Math.min(24, Math.round(y)))
    placing.root.position.set(placing.cx, placing.cy, 0)
    const otherY = placing.id === 'gatein' ? world.gateOut.y : world.gateIn.y
    placing.valid = Math.abs(placing.cy - otherY) >= 5
  } else {
    placing.cx = Math.round(x)
    placing.cy = Math.round(y)
    placing.root.position.set(placing.cx, placing.cy, 0)
    const odd = placing.rot % 2 === 1
    const eff = { cx: placing.cx, cy: placing.cy, w: odd ? placing.d : placing.w, d: odd ? placing.w : placing.d }
    placing.valid = isValidPlacement(eff, placing.id, placing.grass)
  }
  placing.planeMat.color.setHex(placing.valid ? 0x37c97e : 0xec5b5b)
  placing.planeMat.opacity = placing.valid ? 0.22 : 0.34
}
// mobil: yön butonlarıyla 1 birim kaydır (sürükleme zor)
function nudgePlacing(dx: number, dy: number) {
  if (!placing) return
  repositionPlacing((placing.cx || 0) + dx, (placing.cy || 0) + dy)
}

function confirmPlacement() {
  const p = placing!
  if (p.move) {
    applyDynamicMove(p.id, p.cx, p.cy)
    ui.toast(t('Taşındı!'), 'good')
  } else {
    const purchaseId = p.id.startsWith('pump-') ? 'pump'
      : p.id.startsWith('charger-') ? 'evcharger'
      : p.id.split('#')[0]
    if (!buyItem(state, purchaseId)) {
      ui.toast(t('💸 Para yetmiyor!'), 'bad')
      cancelPlacement()
      return
    }
    buildVisual(p.id, new THREE.Vector2(p.cx, p.cy))
    buyToast(p.id.split('#')[0].replace(/^pump-\d+$/, 'pump').replace(/^charger-\d+$/, 'evcharger'))
  }
  if (p.id.startsWith('charger-')) {
    // Charger döndürülebilir: pozisyon + açı + araç yanaşma slotu birlikte kurulur.
    const idx = Number(p.id.slice('charger-'.length))
    world.moveCharger(idx, new THREE.Vector2(p.cx, p.cy), p.rot)
  } else if (!p.id.startsWith('pump-') && p.id !== 'tank' && p.id !== 'gatein' && p.id !== 'gateout') {
    world.rotateBuilding(p.id, p.rot)
  }
  placedPos[p.id] = [p.cx, p.cy]
  placedRot[p.id] = p.rot
  const i = placedRects.findIndex(r => r.id === p.id)
  if (i >= 0) placedRects.splice(i, 1)
  if (p.id !== 'gatein' && p.id !== 'gateout') {
    const odd = p.rot % 2 === 1
    placedRects.push({ id: p.id, cx: p.cx, cy: p.cy, w: odd ? p.d : p.w, d: odd ? p.w : p.d })
  }
  cancelPlacement()
  persist()
}

function confirmZone() {
  const z = zoneMode!
  const key = parcelKey(z.c, z.r)
  if (z.kind === 'land') {
    const cost = parcelCost(z.c, z.r, state)
    if (state.money < cost) { ui.toast(t('💸 Para yetmiyor!'), 'bad'); return }
    state.money -= cost
    state.ownedParcels.add(key)
    world.markOwned(z.c, z.r)
    ui.toast(t('🏞️ Arsa satın alındı (-₺{0}) — yapı için Zemin Betonu döşe.', cost.toLocaleString('tr-TR')), 'good')
  } else {
    if (state.money < PAVE_COST) { ui.toast(t('💸 Para yetmiyor!'), 'bad'); return }
    state.money -= PAVE_COST
    state.pavedParcels.add(key)
    world.paveParcel(z.c, z.r)
    ui.toast('🧱 Zemin betonlandı — artık yapı kurabilirsin!', 'good')
  }
  cancelPlacement()
  persist()
}

window.addEventListener('keydown', e => {
  if (e.key === 'Escape') cancelPlacement()
  if ((e.key === 'r' || e.key === 'R') && placing) {
    if (placing.id.startsWith('pump-') || placing.id === 'tank' || placing.id === 'gatein' || placing.id === 'gateout') {
      ui.toast('Bu ünitenin yönü sabittir (araç yanaşması) — sadece yerini seçebilirsin.', '')
      return
    }
    placing.rot = (placing.rot + 1) % 4
    placing.root.rotation.z = placing.rot * Math.PI / 2
  }
})
renderer.domElement.addEventListener('contextmenu', e => { e.preventDefault(); cancelPlacement() })

const COUNTABLE: Record<string, () => number> = {
  parking: () => state.parkingCount,
  solar: () => state.solarCount,
  selfwash: () => state.selfWashCount,
  airwater: () => state.airWaterCount,
}

/** varsayılan slot sahipli+betonlu ve boş mu? değilse alım yerleştirme moduna düşer
 *  (kaçak arazi bug'ı: 3-4. pompa/şarj varsayılan slotları güney parseline (0,0) düşüyor,
 *  oyuncu orayı almamışsa oyun sahipsiz araziye kuruyordu) */
function defaultSlotFree(kind: 'pump' | 'evcharger'): boolean {
  const i = kind === 'pump' ? state.pumps : state.evChargers
  const y = (kind === 'pump' ? PUMP_SLOTS_POS : EV_SLOTS_POS)[Math.min(i, 3)].y
  const p = kind === 'pump'
    ? { cx: 0.9, cy: y, w: 4.4, d: 4.0 }
    : { cx: 0.5, cy: y, w: 4.0, d: 2.6 }
  // arazi yasal mı? (tam isValidPlacement değil: varsayılan yerleşim tabela gibi sabit
  // engellerle tasarım gereği köşeden kesişir, onlar sorun değil)
  for (const sx of [-1, 0, 1]) for (const sy of [-1, 0, 1]) {
    if (!landOk(p.cx + sx * (p.w / 2 - 0.2), p.cy + sy * (p.d / 2 - 0.2), false)) return false
  }
  const skip = kind === 'pump' ? `pump-${i}` : `charger-${i}`
  for (const o of placedRects) if (o.id !== skip && overlaps(p, o)) return false
  return true
}

ui.onBuy = id => {
  audio.click()
  if (id === 'land' || id === 'pave') {
    startZoneMode(id)
    return
  }
  const item0 = getShopItems(state).find(r => r.id === id)
  if (id in COUNTABLE) {
    if (!item0 || item0.status !== 'buy' || state.money < (item0.cost ?? Infinity)) return
    const n = COUNTABLE[id]()
    startPlacement(n === 0 ? id : `${id}#${n}`)
    return
  }
  if (id === 'pump' && (state.pumps >= 4 || !defaultSlotFree('pump'))) {
    if (!item0 || item0.status !== 'buy' || state.money < (item0.cost ?? Infinity)) return
    startPlacement(`pump-${state.pumps}`)
    return
  }
  if (id === 'evcharger' && (state.evChargers >= 4 || !defaultSlotFree('evcharger'))) {
    if (!item0 || item0.status !== 'buy' || state.money < (item0.cost ?? Infinity)) return
    startPlacement(`charger-${state.evChargers}`)
    return
  }
  // seviye tabanlı tesisler (batarya/market/tuvalet) İLK kuruluşta yerleştirilir; yükseltme YERİNDE olur (yıkmak gerekmez)
  const inPlaceUpgrade = (id === 'battery' && state.batteryLevel > 0)
    || (id === 'market' && state.marketLevel > 0)
    || (id === 'toilet' && state.toiletLevel > 0)
  const needsPlacement = id in PLACEABLE && !inPlaceUpgrade
  if (needsPlacement) {
    if (!item0 || item0.status !== 'buy' || state.money < (item0.cost ?? Infinity)) return
    startPlacement(id)
    return
  }
  if (!buyItem(state, id)) return
  buildVisual(id, placedPos[id] ? new THREE.Vector2(placedPos[id][0], placedPos[id][1]) : undefined) // yükseltmede AYNI konumda kur
  buyToast(id)
  persist()
  if (selectedBuilding) refreshBuildingCard()
}

ui.onMove = id => {
  if (!footprintOf(id)) return
  startPlacement(id, true)
}

ui.onSell = id => {
  if (!sellInfo(state, id)) return
  const refund = applySell(state, id)
  if (refund === null) return
  const base = id.split('#')[0]
  // servis noktasındaki aracı serbest bırak, sonra görseli kaldır
  if (base === 'pump') cars.evictSlot('fuel', Number(id.slice(5)))
  else if (base === 'charger') cars.evictSlot('ev', Number(id.slice(8)))
  world.removeBuildingGroup(id)
  delete placedPos[id]
  delete placedRot[id]
  const ri = placedRects.findIndex(r => r.id === id)
  if (ri >= 0) placedRects.splice(ri, 1)
  audio.build()
  ui.toast(t('🧨 Yıkıldı — yatırımın yarısı iade: +₺{0}', refund.toLocaleString('tr-TR')), 'good', true)
  selectedBuilding = null
  world.setSelected(null)
  ui.hideBuildingCard()
  Car.solids = hardRects()
  persist()
}

function buyToast(id: string) {
  audio.build()
  switch (id) {
    case 'pump': ui.toast(`⛽ Pompa #${state.pumps} kuruldu!`, 'good'); break
    case 'sign': ui.toast('🪧 Tabela büyüdü — daha çok müşteri gelecek!', 'good'); break
    case 'widegate': ui.toast(t('🛣️ Giriş-çıkış genişledi — araçlar ikili sıra girip çıkıyor!'), 'good'); break
    case 'tank': ui.toast(`🛢️ Tank kapasitesi: ${state.tankCapacity}L`, 'good'); break
    case 'market': ui.toast('🛒 Market açıldı!', 'good'); break
    case 'toilet': ui.toast('🚻 Tuvalet hizmete girdi!', 'good'); break
    case 'grid': ui.toast(t('⚡ Elektrik altyapısı Sv.{0} kuruldu!', state.gridLevel), 'good'); break
    case 'battery': ui.toast('🔋 Batarya deposu kuruldu — üretim biriktikçe dolacak.', 'good'); break
    case 'evcharger': syncSignPrices(); ui.toast('🔌 DC şarj ünitesi kuruldu!', 'good'); break
    case 'solar': ui.toast('☀️ Güneş santrali kuruldu. ⚠️ Paneller zamanla kirlenir!', 'good'); break
    case 'dieselgen': ui.toast('🛠️ Jeneratör kuruldu. ⚠️ Gürültüsü EV müşterilerini kaçırabilir!', 'good'); break
    case 'smr': ui.toast('☢️ Reaktör devrede! ⚠️ BAKIMI ASLA AKSATMA — patlarsa her şey gider!', 'bad'); break
    case 'wash': ui.toast('🚿 Oto yıkama açıldı — müşteriler araç yıkatacak!', 'good'); break
    case 'oil': ui.toast('🔧 Yağ değişim istasyonu açıldı!', 'good'); break
    case 'coffee': ui.toast('☕ Kahveci açıldı!', 'good'); break
    case 'restaurant': ui.toast('🍽️ Restoran açıldı — yolcular yemek molası verecek!', 'good'); break
    case 'truckpark': ui.toast('🚛 Tır parkı açıldı — düzenli konaklama geliri!', 'good'); break
    case 'airwater': ui.toast('💨 Hava-su ünitesi kuruldu!', 'good'); break
    case 'selfwash': ui.toast('🧽 Self yıkama açıldı — köpük ve su otomatik satılacak!', 'good'); break
    case 'parking': ui.toast('🅿️ Otopark açıldı — müşteriler park edip tesisleri gezebilecek!', 'good'); break
  }
}

// 🧪 FULL / vitrin modu: ?full=1 ile her şey kurulu başlar
const isFullMode = new URLSearchParams(location.search).has('full')
let saveLoaded = false
if (!isFullMode && !isPromoMode && auth.loggedIn()) {
  try {
    const remote = await auth.pullSave()
    if (remote) {
      applySaveData(remote as Record<string, unknown>)
      saveLoaded = true
      ui.toast(t('Bulut kaydı yüklendi — Gün {0} ({1})', state.day, auth.currentEmail() ?? ''), 'good', true)
      applyOfflineEarnings() // yokken geçen süre kadar pasif gelir
    }
  } catch {
    // Bulut kaydı yüklenemedi: TAZE oturumla oynamaya izin verme — yoksa
    // ilerlemiş bulut kaydının üstüne yazılır. Oyunu kilitle, kayıt gönderme.
    cloudBlocked = true
    showCloudBlockOverlay()
  }
}
if (cloudBlocked) await new Promise(() => {}) // oyun motoru burada durur, hiç kayıt gitmez
// e-posta doğrulama kapısı: doğrulanmadan oyuna devam edilemez
if (!isFullMode && !isPromoMode && auth.needsVerify()) {
  showVerifyGate()
  await new Promise(() => {}) // doğrulanana dek motor durur
}
if (saveLoaded) rebuildFromState()
else if (!isFullMode && !isPromoMode) ui.toast('Sıfırdan başlıyorsun — hayırlı olsun patron!', 'good', true)
// eski yerel kayıt kalıntılarını temizle (artık her şey SQL'de)
for (const key of Object.keys(localStorage)) {
  if (key.startsWith('benzinlik-save-v1')) localStorage.removeItem(key)
}
// sekme kapanırken son durumu buluta yaz
window.addEventListener('pagehide', () => {
  if (isFullMode || !auth.loggedIn()) return
  fetch('/api/save', {
    method: 'POST',
    keepalive: true,
    headers: { 'content-type': 'application/json', 'x-auth': localStorage.getItem('benzinlik-token') ?? '' },
    body: JSON.stringify({ save: savePayload() }),
  }).catch(() => {})
})
translateDom() // HUD + statik metinleri çevir
;(document.getElementById('lang-tr') as HTMLButtonElement).classList.toggle('good', lang === 'tr')
;(document.getElementById('lang-en') as HTMLButtonElement).classList.toggle('good', lang === 'en')
;(document.getElementById('lang-tr') as HTMLButtonElement).addEventListener('click', () => setLang('tr'))
;(document.getElementById('lang-en') as HTMLButtonElement).addEventListener('click', () => setLang('en'))
ui.syncAccount(auth.currentEmail())

// ---- Canlı kanal (WebSocket): anlık bakiye / bildirim / hot-fix / reload ----
function applyLivePatch(p: Record<string, unknown>) {
  if (typeof p.money === 'number') state.money = p.money
  const tanks = p.tanks as Record<string, number> | undefined
  if (tanks) for (const f of Object.keys(tanks)) if (f in state.tanks) (state.tanks as Record<string, number>)[f] = Number(tanks[f])
  const orders = p.orders as Record<string, unknown> | undefined
  if (orders) for (const f of Object.keys(orders)) {
    const o = (state.orders as Record<string, { pending: boolean; eta: number; arrived: boolean; delivering: boolean }>)[f]
    if (o) { o.pending = false; o.arrived = false; o.delivering = false; o.eta = 0 }
  }
  persist()
}
let liveWs: WebSocket | null = null
let liveRetry = 0
function connectLive() {
  if (isFullMode || isPromoMode || cloudBlocked || !auth.loggedIn()) return
  const token = localStorage.getItem('benzinlik-token')
  if (!token) return
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:'
  try { liveWs = new WebSocket(`${proto}//${location.host}/ws?token=${encodeURIComponent(token)}`) } catch { return }
  liveWs.onopen = () => { liveRetry = 0 }
  liveWs.onmessage = ev => {
    let m: { type?: string; [k: string]: unknown }
    try { m = JSON.parse(ev.data) } catch { return }
    if (m.type === 'balance') {
      state.money = Number(m.money) || state.money
      ui.toast(String(m.toast || t('Bakiye güncellendi')), 'good', true)
    } else if (m.type === 'notify') {
      const title = String(m.title || 'BenelOil'), body = String(m.body || '')
      ui.toast(body ? `${title} — ${body}` : title, 'good')
      try { if ('Notification' in window && Notification.permission === 'granted') new Notification(title, { body }) } catch {}
    } else if (m.type === 'patch') {
      applyLivePatch((m.patch as Record<string, unknown>) || {})
      ui.toast(t('Kayıt güncellendi ✓'), 'good', true)
    } else if (m.type === 'reload') {
      ui.toast(t('Güncelleme uygulanıyor…'), '', true)
      setTimeout(() => location.reload(), 800)
    } else if (m.type === 'ban') {
      showBanOverlay(String(m.reason || ''))
    }
  }
  const reconnect = () => {
    liveWs = null
    if (isFullMode || isPromoMode || cloudBlocked) return
    liveRetry = Math.min(liveRetry + 1, 6)
    setTimeout(connectLive, 1000 * liveRetry) // 1..6 sn backoff
  }
  liveWs.onclose = reconnect
  liveWs.onerror = () => { try { liveWs?.close() } catch {} }
}
connectLive()

// ---- Mobil taşıma: yön butonları (sürükleme zor) ----
{
  const mc = document.getElementById('movectl')
  if (mc) {
    for (const b of mc.querySelectorAll<HTMLButtonElement>('[data-nudge]')) {
      b.addEventListener('click', () => {
        const d = b.dataset.nudge
        nudgePlacing(d === 'right' ? 1 : d === 'left' ? -1 : 0, d === 'up' ? 1 : d === 'down' ? -1 : 0)
      })
    }
    document.getElementById('mv-rot')?.addEventListener('click', () => {
      if (!placing) return
      placing.rot = (placing.rot + 1) % 4
      placing.root.rotation.z = placing.rot * Math.PI / 2
      repositionPlacing(placing.cx, placing.cy) // döndürünce yeniden doğrula
    })
    document.getElementById('mv-ok')?.addEventListener('click', () => {
      if (placing && placing.valid) confirmPlacement()
      else ui.toast(t('Buraya yerleştirilemez — kırmızıysa başka yere taşı.'), 'bad')
    })
    document.getElementById('mv-cancel')?.addEventListener('click', () => cancelPlacement())
  }
}

// ---- Onboarding: ilk oturum 3 adım rehberi (yeni oyuncu kafası karışmasın) ----
let tutStep = 0
const tutEl = document.getElementById('tuthint') as HTMLDivElement | null
function tutActive() {
  return !isFullMode && !isPromoMode && auth.loggedIn() && !localStorage.getItem('beneloil-onboarded')
    && state.day <= 1 && (state.stats.served || 0) === 0
}
function tutStart() {
  if (tutStep !== 0 || !tutEl || !tutActive()) return
  tutStep = 1
  tutEl.innerHTML = t('👋 Hoş geldin patron! İlk müşterin geldi — panelde ne istediğine bak ve <b>o renkteki tabancayı</b> seç.')
  tutEl.style.display = 'block'
}
function tutAdvance(to: number) {
  if (tutStep === 0 || !tutEl) return
  if (to === 2 && tutStep < 2) {
    tutStep = 2
    tutEl.innerHTML = t('Tabanca seçildi ✓ Şimdi <b>tutar gir</b> ya da <b>FULLE</b> bas, sonra <b>BAŞLAT</b>.')
  } else if (to === 3 && tutStep < 3) {
    tutStep = 3
    localStorage.setItem('beneloil-onboarded', '1')
    tutEl.innerHTML = t('🎉 İlk satışın! İpucu: <b>🧼 cam temizle</b> = daha çok bahşiş. Büyümek için <b>🛒 mağazadan</b> pompa/tesis al, <b>🏢 ofisten</b> fiyatı ayarla.')
    setTimeout(() => { if (tutEl) tutEl.style.display = 'none' }, 9000)
  }
}
/** onboarding ipucunu kapat — pompacı işi devraldığında (manuel servis olmayacak) takılı kalmasın */
function tutDismiss() {
  if (!tutEl || tutStep >= 3) return
  tutStep = 3
  localStorage.setItem('beneloil-onboarded', '1')
  tutEl.style.display = 'none'
}

// oyun içi canlı t("OYUNDA") sayacı — 60 sn'de bir tazelenir (sosyal kanıt)
function refreshOnline() {
  if (isPromoMode) return
  fetch('/api/stats').then(r => r.json()).then(st => {
    if (st && typeof st.online === 'number' && st.online > 1) {
      const chip = document.getElementById('onlinechip') as HTMLDivElement
      ;(document.getElementById('hud-online') as HTMLSpanElement).textContent = String(st.online)
      chip.style.display = 'flex'
    }
  }).catch(() => {})
}
refreshOnline()
setInterval(refreshOnline, 60_000)

// ---- Zorunlu giriş kapısı: hesap yoksa oyun oynanmaz ----
async function doLogin(email: string, pass: string) {
  await auth.login(email, pass)
  location.reload()
}
async function doRegister(email: string, pass: string) {
  await auth.register(email, pass)
  location.reload()
}

document.getElementById('authgate')?.remove()
{

  // ---- Günlük giriş bonusu + seri + görev sıfırlama ----
  const today = new Date().toISOString().slice(0, 10)
  if (!isFullMode && state.lastLoginDate !== today) {
    const yest = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10)
    const continued = state.lastLoginDate === yest
    const lapsed = !!state.lastLoginDate && !continued // önceden oynamış ama araya boşluk girmiş
    state.loginStreak = continued ? state.loginStreak + 1 : 1
    state.lastLoginDate = today
    const bonus = 250 + 250 * Math.min(state.loginStreak, 7)
    state.money += bonus
    ui.toast(t('Günlük giriş bonusu: +₺{0} (seri: {1} gün)', bonus, state.loginStreak), 'good', true)
    audio.achieve()
    // geri dönüş kancası: lapsed oyuncuya "seni özledik" bonusu (seriyi cezalandırmadan geri çeker)
    if (lapsed) {
      state.money += 1000
      ui.toast(t('Tekrar hoş geldin patron! Dönüş hediyesi: +₺1.000 🎁'), 'good', true)
    }
    state.dailyDate = today
    state.dailyServed = 0
    state.dailyDone = false
    persist()
  }
  if (state.dailyDate !== today) {
    state.dailyDate = today
    state.dailyServed = 0
    state.dailyDone = false
  }

  // ---- Offline kazanç raporu: sen yokken tesisler çalıştı ----
  if (!isFullMode && loadedSaveAt > 0) {
    const offSec = Math.min((Date.now() - loadedSaveAt) / 1000, 7200) // en fazla 2 saatlik birikim
    if (offSec > 90) {
      let total = 0
      // kumbaralı tesisler (topla-hook'u): tır parkı, self yıkama, oto yıkama, hava-su
      const gains: [string, string, number][] = []
      if (state.hasTruckPark) gains.push(['truckpark', t('Tır parkı'), 125 / 45])
      if (state.hasSelfWash) gains.push(['selfwash', t('Self yıkama'), (45 / 35) * state.selfWashCount])
      if (state.hasWash) gains.push(['wash', t('Oto yıkama'), 1.4])
      if (state.hasAirWater) gains.push(['airwater', t('Hava-Su'), 0.5 * state.airWaterCount])
      for (const [id, name, rate] of gains) {
        const amt = Math.round(rate * offSec)
        state.addPending(id, amt, name)
        total += Math.min(amt, 600)
      }
      // per-müşteri tesisler: küçük düz idle gelir, doğrudan kasaya (topla-cap'li, ilerlemeyi bozmaz)
      let idleCash = 0
      if (state.marketLevel > 0) idleCash += 0.8 * state.marketLevel * offSec
      if (state.hasCoffee) idleCash += 0.6 * offSec
      if (state.hasRestaurant) idleCash += 1.2 * offSec
      if (state.hasOil) idleCash += 0.9 * offSec
      idleCash = Math.min(Math.round(idleCash), 4000) // idle tavanı
      if (idleCash > 0) { state.money += idleCash; total += idleCash }
      if (total > 0) {
        ui.toast(t('Sen yokken tesislerin çalıştı: ~₺{0} kazandın — kumbaraları topla!', total.toLocaleString('tr-TR')), 'good', true)
        audio.cash()
      }
    }
  }
}

ui.onLogin = async (email, pass) => {
  try {
    await auth.login(email, pass)
    location.reload()
  } catch (err) {
    ui.toast((err as Error).message, 'bad')
  }
}
ui.onRegister = async (email, pass) => {
  try {
    await auth.register(email, pass)
    location.reload()
  } catch (err) {
    ui.toast((err as Error).message, 'bad')
  }
}
ui.onLogout = () => {
  auth.logout()
  location.href = '/' // doğrudan giriş ekranına dön (misafir modu yok)
}
if (isFullMode) {
  for (const key of ['0,0', '0,2', '1,1']) {
    const [c, r] = key.split(',').map(Number)
    state.ownedParcels.add(key)
    state.pavedParcels.add(key)
    world.markOwned(c, r)
    world.paveParcel(c, r)
  }
  const FULL_ORDER = [
    'pump', 'pump', 'pump', 'sign', 'sign', 'sign', 'widegate',
    'tank', 'tank', 'tank', 'market', 'market', 'toilet', 'toilet', 'grid', 'grid',
    'battery', 'battery', 'battery', 'evcharger', 'evcharger', 'evcharger', 'evcharger',
    'solar', 'dieselgen', 'smr', 'wash', 'oil',
    'airwater', 'selfwash', 'coffee', 'restaurant', 'truckpark', 'parking',
  ]
  state.money = 10_000_000
  for (const id of FULL_ORDER) {
    if (buyItem(state, id)) buildVisual(id)
  }
  state.money = 50_000
  for (const f of FUELS) state.tanks[f] = state.fuelCapacity(f)
  state.battery = state.batteryCapacity
  ui.toast('🧪 FULL MOD: her şey kurulu — sürükleyerek gez, tekerlekle yaklaş!', 'good')
}

ui.onMaint = id => {
  if (id === 'open-order') { ui.hideBuildingCard(); openSection('order'); return } // tanka tıkla → yakıt siparişi
  if (id.startsWith('auto-pump-')) {
    const i = parseInt(id.slice(10))
    if (state.autoPumps.has(i)) {
      state.autoPumps.delete(i)
      ui.toast(t('Pompa #{0}: pompacı işten çıktı — dolum yine sende.', i + 1), '')
    } else {
      if (state.money < POMPACI_HIRE) {
        ui.toast(t('💸 Para yetmiyor — pompacı işe alma ₺{0}.', POMPACI_HIRE.toLocaleString('tr-TR')), 'bad')
        return
      }
      state.money -= POMPACI_HIRE
      state.autoPumps.add(i)
      audio.build()
      ui.toast(t('🧑‍🔧 Pompa #{0}: pompacı işe alındı — doğru yakıtı kendisi doldurur, satışın tamamı kasada. Yalnızca bahşiş pompacının.', i + 1), 'good')
    }
    refreshBuildingCard()
    persist()
    return
  }
  if (id.startsWith('auto-charger-')) {
    const i = parseInt(id.slice(13))
    if (state.autoChargers.has(i)) {
      state.autoChargers.delete(i)
      ui.toast(t('DC Şarj #{0}: şarjcı işten çıktı — şarjı yine sen yaparsın.', i + 1), '')
    } else {
      if (state.money < EV_ATTENDANT_HIRE) {
        ui.toast(t('💸 Para yetmiyor — şarjcı işe alma ₺{0}.', EV_ATTENDANT_HIRE.toLocaleString('tr-TR')), 'bad')
        return
      }
      state.money -= EV_ATTENDANT_HIRE
      state.autoChargers.add(i)
      ui.toast(t('⚡ DC Şarj #{0}: şarjcı işe alındı — EV sormadan şarj olur, gelir tamamen senin!', i + 1), 'good')
    }
    refreshBuildingCard()
    persist()
    return
  }
  if (id === 'toilet-fee') {
    state.toiletFee = state.toiletFee === 0 ? 5 : state.toiletFee === 5 ? 10 : 0
    ui.toast(state.toiletFee === 0 ? t('Tuvalet artık ücretsiz.') : t('Tuvalet ücreti: ₺{0}', state.toiletFee), 'good')
    refreshBuildingCard()
    persist()
    return
  }
  if (doMaintenance(state, id)) {
    if (id === 'clean-solar') ui.toast('🧽 Paneller tertemiz, üretim tam güçte!', 'good')
    else if (id === 'maint-smr') ui.toast('☢️ Reaktör bakımı yapıldı, güvendesin.', 'good')
    else if (id === 'order-uranium') ui.toast('☢️ Uranyum siparişi verildi — özel konvoy yolda!', 'good')
    else ui.toast('🔧 Tamir edildi, tekrar hizmette!', 'good')
    if (selectedBuilding) refreshBuildingCard()
  } else {
    ui.toast('💸 Bunun için yeterli para yok!', 'bad')
  }
}

ui.onCardClose = () => {
  selectedBuilding = null
  world.setSelected(null)
}

ui.onReset = async () => {
  if (auth.loggedIn()) await auth.pushSave(null).catch(() => {})
  location.reload()
}

ui.onToggleClosed = () => {
  state.closed = !state.closed
  world.setClosed(state.closed)
  ui.toast(state.closed
    ? t('İstasyon KAPALI — yeni müşteri girmez, itibar etkilenmez. Bakım için rahatsın.')
    : t('İstasyon tekrar AÇIK — bekleriz!'), state.closed ? '' : 'good')
  persist()
}

// ---- İstasyon adı ----
const nameInput = document.getElementById('stname') as HTMLInputElement

function applyStationName(name: string, silent = false) {
  world.setStationName(name)
  state.stationName = world.stationName // hesaba bağlı: bulut kaydıyla gezer
  nameInput.value = world.stationName
  document.title = `${world.stationName} — Benzinlik`
  if (!silent) {
    ui.toast(t('Tabela güncellendi: {0}', world.stationName), 'good')
    persist()
  }
}

// eski tarayıcı-geneli isim kaydından hesaba göç (bir kereye mahsus)
const legacyName = localStorage.getItem('benzinlik-station-name')
applyStationName(
  state.stationName && state.stationName !== t('BENZİNLİK')
    ? state.stationName
    : (legacyName && legacyName !== 'OPET' ? legacyName : t('BENELOIL')),
  true,
)
ui.onRename = name => applyStationName(name)

// kâr marjı ayarı (ofis kartından): alış sabit, satışı oyuncu belirler
function syncSignPrices() {
  world.setPrices(state.prices.benzin, state.prices.dizel, state.prices.lpg,
    state.evChargers > 0 ? state.elecPrice : 0)
}
syncSignPrices()
ui.onPriceChange = (f, delta) => {
  if (f === 'elec') {
    state.elecPrice = Math.min(18, Math.max(4, Math.round((state.elecPrice + delta) * 2) / 2))
    syncSignPrices()
  } else {
    const [lo, hi] = priceBounds(f)
    state.prices[f] = Math.min(hi, Math.max(lo, Math.round((state.prices[f] + delta) * 2) / 2))
    syncSignPrices()
  }
  refreshBuildingCard()
  if (document.getElementById('officewrap')?.classList.contains('show')) openOfficePanel() // ofis fiyat satırlarını canlı güncelle
  persist()
}

// ---- Bina bilgi kartları ----

function buildingCard(id: string): BuildingCard | null {
  id = id.split('#')[0]
  const rate = state.genRate()
  if (id.startsWith('pump-')) {
    const i = Number(id.slice(5))
    const broken = state.brokenPumps.has(i)
    return {
      icon: 'i-fuel', name: t('Pompa #{0}', i + 1),
      desc: t('Benzin ve dizel dolumu. Müşterinin istediği yakıtı ve tutarı sen girersin — yanlış tabanca cezalıdır.'),
      stats: [
        [t('Durum'), broken ? t('ARIZALI') : t('Çalışıyor'), broken ? 'bad' : 'good'],
        [t('Dolum hızı'), t('{0} L/sn', FILL_RATE)],
        [t('Pompacı'), state.autoPumps.has(i) ? t('ÇALIŞIYOR (gelir senin)') : t('YOK'), state.autoPumps.has(i) ? 'good' : undefined],
        [t('Yovmiye'), t('₺{0}/gün', POMPACI_WAGE), state.autoPumps.has(i) ? 'bad' : undefined],
        [t('Benzin'), `₺${state.prices.benzin}/L`],
        [t('Dizel'), `₺${state.prices.dizel}/L`],
      ],
      action: broken
        ? { label: '🔧 Tamir Et — ₺800', maintId: `fix-pump-${i}` }
        : state.autoPumps.has(i)
          ? { label: t('🧑‍🔧 Pompacıyı işten çıkar'), maintId: `auto-pump-${i}` }
          : { label: t('🧑‍🔧 Pompacı Tut — ₺{0} + ₺{1}/gün', POMPACI_HIRE.toLocaleString('tr-TR'), POMPACI_WAGE), maintId: `auto-pump-${i}` },
    }
  }
  if (id.startsWith('charger-')) {
    const i = Number(id.slice(8))
    const broken = state.brokenChargers.has(i)
    return {
      icon: 'i-charger', name: t('DC Şarj #{0}', i + 1),
      desc: t('Elektrikli araçlar batarya deposundan anında şarj olur. Depoda yeterli kWh yoksa müşteri bekler.'),
      stats: [
        [t('Durum'), broken ? t('ARIZALI') : t('Çalışıyor'), broken ? 'bad' : 'good'],
        [t('Şarj süresi'), t('Anında')],
        [t('Şarjcı'), state.autoChargers.has(i) ? t('ÇALIŞIYOR (gelir senin)') : t('YOK'), state.autoChargers.has(i) ? 'good' : undefined],
        [t('Yovmiye'), t('₺{0}/gün', EV_ATTENDANT_WAGE), state.autoChargers.has(i) ? 'bad' : undefined],
        [t('Satış'), `₺${state.elecPrice}/kWh`],
      ],
      action: broken
        ? { label: '🔧 Tamir Et — ₺1.000', maintId: `fix-charger-${i}` }
        : state.autoChargers.has(i)
          ? { label: t('🧑‍🔧 Şarjcıyı işten çıkar'), maintId: `auto-charger-${i}` }
          : { label: t('🧑‍🔧 Şarjcı Tut — ₺{0} + ₺{1}/gün', EV_ATTENDANT_HIRE.toLocaleString('tr-TR'), EV_ATTENDANT_WAGE), maintId: `auto-charger-${i}` },
    }
  }
  switch (id) {
    case 'office': {
      const fx = Math.round((state.priceDemandFactor() - 1) * 100)
      return {
        icon: 'i-office', name: t('Ofis — Fiyat Yönetimi'),
        desc: t('Alış fiyatı sabittir; satış fiyatını sen belirlersin. Marjı açtıkça litre başı kazanç artar ama müşteri kaçar.'),
        stats: [
          [t('Müşteri etkisi'), `${fx >= 0 ? '+' : ''}${fx}%`, fx >= 0 ? 'good' : 'bad'],
          [t('İtibar'), state.reputation.toFixed(1)],
          [t('Toplam müşteri'), `${state.stats.served}`, 'good'],
          [t('Kaçan müşteri'), `${state.stats.lost}`, state.stats.lost > state.stats.served / 4 ? 'bad' : ''],
          [t('Benzin satışı'), `${Math.round(state.stats.liters.benzin)} L`],
          [t('Dizel satışı'), `${Math.round(state.stats.liters.dizel)} L`],
          [t('LPG satışı'), `${Math.round(state.stats.liters.lpg)} L`],
          [t('Elektrik satışı'), `${Math.round(state.stats.kwh)} kWh`],
          ['Toplam ciro', `₺${Math.round(state.stats.revenue).toLocaleString('tr-TR')}`, 'good'],
        ],
        priceRows: [
          ...(['benzin', 'dizel', 'lpg'] as FuelType[]).map(f => {
            const [lo, hi] = priceBounds(f)
            return {
              f: f as FuelType | 'elec', label: FUEL_LABEL[f], price: state.prices[f], cost: FUEL_COST[f] as number | string,
              canDown: state.prices[f] > lo, canUp: state.prices[f] < hi,
            }
          }),
          {
            f: 'elec' as FuelType | 'elec', label: 'Elektrik (kWh)', price: state.elecPrice, cost: 'santralden',
            canDown: state.elecPrice > 4, canUp: state.elecPrice < 18,
          },
        ],
      }
    }
    case 'gatein': {
      const wg = getShopItems(state).find(r => r.id === 'widegate')
      return {
        icon: 'i-move', name: t('Giriş Kapısı'),
        desc: t('Müşteriler ve tankerler istasyona buradan girer. Taşı butonuyla yol kenarında istediğin yere al — trafik akışı kendini uyarlar.'),
        stats: [
          [t('Genişlik'), state.wideGates ? t('Geniş · 2 şerit') : t('Tek şerit'), state.wideGates ? 'good' : ''],
          ['Kural', t('Çıkışla arası en az 5 birim')]],
        buy: (!state.wideGates && wg && wg.status === 'buy' && wg.cost !== null)
          ? { label: t('🛣️ Geniş Giriş-Çıkış — ₺{0}', wg.cost.toLocaleString('tr-TR')), id: 'widegate' }
          : undefined,
      }
    }
    case 'gateout': {
      const wg = getShopItems(state).find(r => r.id === 'widegate')
      return {
        icon: 'i-move', name: t('Çıkış Kapısı'),
        desc: t('Araçlar istasyondan buradan çıkıp yola karışır. Taşı butonuyla yerini belirle.'),
        stats: [
          [t('Genişlik'), state.wideGates ? t('Geniş · 2 şerit') : t('Tek şerit'), state.wideGates ? 'good' : ''],
          ['Kural', t('Girişle arası en az 5 birim')]],
        buy: (!state.wideGates && wg && wg.status === 'buy' && wg.cost !== null)
          ? { label: t('🛣️ Geniş Giriş-Çıkış — ₺{0}', wg.cost.toLocaleString('tr-TR')), id: 'widegate' }
          : undefined,
      }
    }
    case 'sign':
      return {
        icon: 'i-sign', name: t('Tabela'),
        desc: t('Yoldan geçenlerin uğrama şansını artırır. Taşı butonuyla yerini değiştirebilirsin.'),
        stats: [
          [t('Seviye'), `${state.signLevel + 1}/4`],
          [t('Trafik etkisi'), `+%${state.signLevel * 10}`, state.signLevel > 0 ? 'good' : ''],
        ],
      }
    case 'tank':
      return {
        icon: 'i-tank', name: t('Yakıt Tankı'),
        desc: t('Sattığın benzin ve dizel buradan çıkar. Bitirmeden tanker siparişi vermeyi unutma.'),
        stats: [
          [t('Benzin'), `${Math.round(state.tanks.benzin)} / ${state.fuelCapacity('benzin')}L`, state.tanks.benzin < state.fuelCapacity('benzin') * 0.15 ? 'bad' : ''],
          [t('Dizel'), `${Math.round(state.tanks.dizel)} / ${state.fuelCapacity('dizel')}L`, state.tanks.dizel < state.fuelCapacity('dizel') * 0.15 ? 'bad' : ''],
          [t('LPG'), `${Math.round(state.tanks.lpg)} / ${state.fuelCapacity('lpg')}L`, state.tanks.lpg < state.fuelCapacity('lpg') * 0.15 ? 'bad' : ''],
          ['Kapasite seviyesi', `${state.tankLevel + 1}/4 (maks ${TANK_CAPACITY[3]}L)`],
        ],
        action: { label: t('🛢️ Yakıt Siparişi Ver'), maintId: 'open-order' },
      }
    case 'battery':
      return {
        icon: 'i-batt', name: 'Batarya Deposu',
        desc: t('Santrallerin ürettiği elektriği biriktirir. Elektrikli araçlar buradan anında şarj alır.'),
        stats: [
          [t('Dolu'), `${Math.floor(state.battery)} / ${state.batteryCapacity} kWh`],
          [t('Üretim'), t('+{0} kWh/sn (şebeke dahil)', state.genRate().toFixed(1)), 'good'],
          [t('Şebeke maliyeti'), `₺${GRID_COST_PER_KWH}/kWh`, 'bad'],
          [t('Araca akış'), `${[0, 15, 25, 40][state.batteryLevel]} kWh/sn`],
          [t('Üretim'), `+${rate.toFixed(1)} kWh/sn`, rate > 0 ? 'good' : ''],
          [t('Seviye'), `${state.batteryLevel}/3`],
        ],
      }
    case 'market':
      return {
        icon: 'i-market', name: `Market Sv.${state.marketLevel}`,
        desc: t('Müşterilerin bir kısmı içeri girip alışveriş yapar — ekstra gelir ve memnuniyet.'),
        stats: [
          [t('Müşteri harcaması'), `₺${25 * state.marketLevel}-${60 * state.marketLevel}`],
          [t('Uğrama oranı'), '~%35'],
        ],
      }
    case 'toilet':
      return {
        icon: 'i-toilet', name: `Tuvalet Sv.${state.toiletLevel}`,
        desc: t('Yol yorgunları için. Ücret koyarsan gelir gelir ama memnuniyet biraz düşer.'),
        stats: [
          ['Moral etkisi', `+${Math.max(0, 0.15 * state.toiletLevel - (state.toiletFee > 0 ? 0.03 + state.toiletFee * 0.012 : 0)).toFixed(2)} puan`, 'good'],
          [t('Kullanım ücreti'), state.toiletFee === 0 ? t('Ücretsiz') : `₺${state.toiletFee}`, state.toiletFee > 0 ? 'good' : ''],
        ],
        action: { label: t('Ücreti Değiştir ({0} → {1})', state.toiletFee === 0 ? t('Ücretsiz') : '₺' + state.toiletFee, state.toiletFee === 0 ? '₺5' : state.toiletFee === 5 ? '₺10' : t('Ücretsiz')), maintId: 'toilet-fee' },
      }
    case 'solar': {
      const net = 3 * (1 - 0.7 * state.solarDirt) * (state.gridLevel >= 2 ? 1.3 : 1)
      return {
        icon: 'i-solar', name: t('Güneş Santrali'),
        desc: t('Bedava elektrik üretir ama paneller kirlendikçe verim düşer. Ara sıra temizlik yaptır.'),
        stats: [
          [t('Üretim'), `+${net.toFixed(1)} kWh/sn`, net < 1 ? 'bad' : 'good'],
          [t('Kirlilik'), `%${Math.round(state.solarDirt * 100)}`, state.solarDirt > 0.6 ? 'bad' : ''],
        ],
        action: state.solarDirt >= 0.15 ? { label: '🧽 Temizle — ₺300', maintId: 'clean-solar' } : undefined,
      }
    }
    case 'dieselgen':
      return {
        icon: 'i-gen', name: t('Dizel Jeneratör'),
        desc: t('Tanktan mazot yakarak elektrik üretir. Çalışırken gürültüsü şarjdaki müşterileri rahatsız eder.'),
        stats: [
          [t('Üretim'), `+7 kWh/sn`],
          [t('Yakıt tüketimi'), '0.25 L/sn'],
          [t('Durum'), state.dieselRunning() ? t('ÇALIŞIYOR 🔊') : 'Beklemede', state.dieselRunning() ? 'bad' : 'good'],
        ],
      }
    case 'wash':
      return {
        icon: 'i-wash', name: t('Oto Yıkama'),
        desc: t('Yakıt alan müşterilerin bir kısmı çıkışta aracını yıkatır.'),
        stats: [
          [t('Hizmet ücreti'), '₺60-120'],
          [t('Kullanım oranı'), '~%25'],
        ],
      }
    case 'coffee':
      return {
        icon: 'i-coffee', name: t('Kahveci'),
        desc: t('Park eden müşteriler kahve molası verir.'),
        stats: [[t('Satış'), '₺20-45'], [t('Uğrama oranı'), '~%30']],
      }
    case 'restaurant':
      return {
        icon: 'i-food', name: t('Restoran'),
        desc: t('Uzun yol müşterisi park edip yemek yer — yüksek hesap öder.'),
        stats: [['Hesap', '₺80-160'], [t('Uğrama oranı'), '~%18']],
      }
    case 'truckpark':
      return {
        icon: 'i-truck', name: t('Tır Parkı'),
        desc: t('Tırcılar konaklar; sen hiçbir şey yapmadan düzenli gelir akar.'),
        stats: [['Pasif gelir', '₺90-160 / ~45sn'], ['Trafik etkisi', '+%2']],
      }
    case 'airwater':
      return {
        icon: 'i-air', name: t('Hava-Su Ünitesi'),
        desc: t('Lastik havası ve su. Küçük gelir ama müşteri çeker.'),
        stats: [['Hizmet', '₺10-20'], [t('Kullanım'), '~%20']],
      }
    case 'selfwash':
      return {
        icon: 'i-selfwash', name: t('Self Yıkama'),
        desc: t('Araçlar bölmelere girip kendileri yıkar; köpük ve su otomatik satılır.'),
        stats: [['Pasif gelir', '₺30-60 / ~35sn'], ['Trafik etkisi', '+%2']],
      }
    case 'parking':
      return {
        icon: 'i-parking', name: t('Otopark'),
        desc: t('Servisi biten müşteriler buraya park edip market, tuvalet, kahveci ve restoranı gezer.'),
        stats: [['Kapasite', t('4 araç')], ['Doluluk', `${cars.cars.filter(c => c.phase === 'parked' || c.phase === 'toPark').length}/4`]],
      }
    case 'oil':
      return {
        icon: 'i-oil', name: t('Yağ Değişimi'),
        desc: t('Bakım vakti gelen araçlar burada yağ değiştirir — en kârlı yan hizmet.'),
        stats: [
          [t('Hizmet ücreti'), '₺150-250'],
          [t('Kullanım oranı'), '~%12'],
        ],
      }
    case 'smr': {
      const risk = state.smrWear > 0.7 ? t('YÜKSEK ☠️') : state.smrWear > 0.5 ? 'Orta' : t('Düşük')
      const producing = state.uranium > 0
      let action: BuildingCard['action']
      if (state.smrWear >= 0.5) action = { label: t('☢️ Bakım Yap — ₺1.500'), maintId: 'maint-smr' }
      else if (!state.uraniumPending && state.uranium <= 60) action = { label: t('🟢 Uranyum Sipariş Et — ₺{0}', URANIUM_COST.toLocaleString('tr-TR')), maintId: 'order-uranium' }
      else if (state.smrWear >= 0.1) action = { label: t('☢️ Bakım Yap — ₺1.500'), maintId: 'maint-smr' }
      return {
        icon: 'i-reactor', name: t('Modüler Reaktör'),
        desc: t('En güçlü enerji kaynağı. Uranyumla çalışır, yıprandıkça patlama riski artar — bakımı ASLA aksatma.'),
        stats: [
          [t('Üretim'), producing ? `+${(15 * (state.gridLevel >= 2 ? 1.3 : 1)).toFixed(1)} kWh/sn` : 'DURDU (uranyum yok)', producing ? 'good' : 'bad'],
          ['Uranyum', state.uraniumPending ? `Yolda (${Math.ceil(state.uraniumEta)}sn)` : `%${Math.round(state.uranium)}`, state.uranium <= 20 && !state.uraniumPending ? 'bad' : ''],
          [t('Yıpranma'), `%${Math.round(state.smrWear * 100)}`, state.smrWear > 0.5 ? 'bad' : ''],
          ['Patlama riski', risk, state.smrWear > 0.7 ? 'bad' : state.smrWear > 0.5 ? '' : 'good'],
        ],
        action,
      }
    }
  }
  return null
}

function refreshBuildingCard() {
  if (!selectedBuilding) return
  const card = buildingCard(selectedBuilding)
  if (!card) return
  const facId = selectedBuilding.split('#')[0]
  if (['market', 'toilet', 'wash', 'oil', 'coffee', 'restaurant', 'truckpark', 'selfwash', 'airwater'].includes(facId)) {
    card.stats.push([t('Bugünkü ciro'), `₺${Math.round(state.facDaily[facId] ?? 0).toLocaleString('tr-TR')}`, 'good'])
  }
  // karttan doğrudan yükseltme: ilgili mağaza kalemi alınabilir durumdaysa buton koy
  const shopId = selectedBuilding.startsWith('pump-') ? 'pump'
    : selectedBuilding.startsWith('charger-') ? 'evcharger'
    : selectedBuilding
  const row = getShopItems(state).find(r => r.id === shopId)
  if (row && row.status === 'buy' && row.cost !== null) {
    card.buy = { label: `${row.title} — ₺${row.cost.toLocaleString('tr-TR')}`, id: shopId }
  }
  if (footprintOf(selectedBuilding)) {
    card.move = { label: t('Taşı'), id: selectedBuilding }
  }
  const si = sellInfo(state, selectedBuilding)
  if (si) card.sell = { label: t('🧨 Yık — +₺{0}', si.refund.toLocaleString('tr-TR')), id: selectedBuilding }
  ui.showBuildingCard(card)
}

// ---- Ödüllü reklam: izle → müşteri patlaması ----
const adBtn = document.getElementById('adbtn') as HTMLButtonElement
const adBtnLabel = adBtn.querySelector('span') as HTMLSpanElement
let adCooldown = 120 // ilk fırsat: 2. dakika (baştan değil, biraz ilerleyince)
// fırsat-temelli ödüllü reklam teklifi (tycoon tarzı): müşteri patlaması VEYA gün kârını 2x
let adOffer: { kind: 'rush' | 'double'; profit: number } = { kind: 'rush', profit: 0 }
let doubleOfferT = 0 // 2x teklifi ekranda kalma süresi

function showAdOffer(kind: 'rush' | 'double', profit = 0) {
  adOffer = { kind, profit }
  adBtnLabel.textContent = kind === 'double'
    ? t('🎬 Reklam İzle: Günü 2x Yap (+₺{0})', profit.toLocaleString('tr-TR'))
    : t('🎬 Reklam İzle: Müşteri Patlaması')
  adBtn.style.display = 'flex'
}
adBtn.addEventListener('click', () => {
  adBtn.disabled = true
  const offer = adOffer
  rewarded(offer.kind === 'double' ? 'gun-2x' : 'musteri-patlamasi',
    () => {
      if (offer.kind === 'double') {
        state.money += offer.profit
        ui.toast(t('🎬 Günün kârı 2 katına çıktı: +₺{0}!', offer.profit.toLocaleString('tr-TR')), 'good')
      } else {
        state.promo = { type: 'rush', until: Date.now() + 90_000 }
        ui.toast(t('MÜŞTERİ PATLAMASI! 90 saniye yoğun akın — pompalara koş!'), 'good')
      }
      audio.achieve(); persist()
    },
    watched => {
      adBtn.disabled = false
      adBtn.style.display = 'none'
      doubleOfferT = 0
      if (adOffer.kind === 'rush') adCooldown = watched ? 420 : 90 // izlediyse 7 dk, vazgeçtiyse 1.5 dk sonra tekrar
    })
})
/** gün sonu 2x-kâr fırsatı (kârlı gün + reklam varsa) — kısa süre görünür */
function offerDoubleProfit(profit: number) {
  if (!adsEnabled() || isFullMode || isPromoMode || profit <= 0) return
  showAdOffer('double', profit)
  doubleOfferT = 22 // 22 sn içinde izlemezsen kaçar
}

function tickAdOffer(dt: number) {
  if (!adsEnabled() || isFullMode || isPromoMode) return
  // 2x teklifi süreli
  if (doubleOfferT > 0) {
    doubleOfferT -= dt
    if (doubleOfferT <= 0 && adOffer.kind === 'double') { adBtn.style.display = 'none'; adCooldown = 60 }
    return
  }
  if (adCooldown > 0) { adCooldown -= dt; return }
  // periyodik müşteri-patlaması teklifi: promosyon yokken
  if (!state.promo && state.day >= 1 && adBtn.style.display === 'none') showAdOffer('rush')
  if (state.promo && adOffer.kind === 'rush' && adBtn.style.display !== 'none') {
    adBtn.style.display = 'none'; adCooldown = 300
  }
}

// ---- Düzenleme modu: tıkla-taşı ----
let editMode = false
const editBtn = document.getElementById('editbtn') as HTMLButtonElement
editBtn.addEventListener('click', () => {
  editMode = !editMode
  editBtn.classList.toggle('danger', editMode)
  cancelPlacement()
  ui.toast(editMode
    ? t('✏️ Düzenleme AÇIK — binaya dokun ve taşı')
    : t('Düzenleme modu kapandı.'), '')
})

// ---- Girdi: sürükle-kaydır + tıkla-seç ----
const raycaster = new THREE.Raycaster()
const pointer = new THREE.Vector2()
let downX = 0, downY = 0, lastX = 0, lastY = 0, isDown = false, isDrag = false

let grabPoint: THREE.Vector3 | null = null

/** arsa/beton hayaletini verilen zemin noktasına göre günceller — hem hover hem
 *  dokunuş anında çağrılır (mobilde hover yok; valid'i tıklamada hesaplamazsak
 *  ilk dokunuşlar boşa gider, "3-4 tıklamada alınıyor" bug'ı) */
function updateZoneAt(x: number, y: number) {
  if (!zoneMode) return
  const pc = parcelAt(x, y)
  if (!pc) return
  const [c, r] = pc
  zoneMode.c = c; zoneMode.r = r
  const [x0, x1] = PARCEL_COLS[c]
  const [y0, y1] = PARCEL_ROWS[r]
  zoneMode.ghost.scale.set(x1 - x0 - 0.3, y1 - y0 - 0.3, 1)
  zoneMode.ghost.position.set((x0 + x1) / 2, (y0 + y1) / 2, 0.06)
  zoneMode.valid = zoneMode.kind === 'land'
    ? !state.owns(c, r) && state.parcelAdjacentToOwned(c, r) && state.money >= parcelCost(c, r, state)
    : state.owns(c, r) && !state.isPaved(c, r) && state.money >= PAVE_COST
  ;(zoneMode.ghost.material as THREE.MeshBasicMaterial).color.setHex(zoneMode.valid ? 0x37c97e : 0xec5b5b)
  // canlı fiyat + durum etiketi (karşı/uzak arsalar pahalı — sürpriz olmasın)
  const zc = document.getElementById('zonecost')
  if (zc) {
    const cost = zoneMode.kind === 'land' ? parcelCost(c, r, state) : PAVE_COST
    const across = c >= 3 ? t(' · yol karşısı') : ''
    zc.style.display = 'block'
    zc.textContent = `${zoneMode.kind === 'land' ? t('Arsa') : t('Beton')}: ₺${cost.toLocaleString('tr-TR')}${across}${zoneMode.valid ? ' ✓' : ' ✗'}`
    zc.style.color = zoneMode.valid ? 'var(--green-dark)' : 'var(--red)'
  }
}

/** ekran (client) koordinatını canvas'a göre NDC'ye çevir — safe-area/offset varken mobilde kayma olmaz */
function toNDC(clientX: number, clientY: number) {
  const r = renderer.domElement.getBoundingClientRect()
  pointer.set(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1)
}
function groundPointAt(clientX: number, clientY: number): THREE.Vector3 | null {
  toNDC(clientX, clientY)
  raycaster.setFromCamera(pointer, camera)
  const pt = new THREE.Vector3()
  return raycaster.ray.intersectPlane(groundPlane, pt) ? pt : null
}

renderer.domElement.addEventListener('pointerdown', e => {
  // kamera kaydırma yalnızca sol tuşla; sağ tık sadece iptal işidir
  if (e.button !== 0) { isDown = false; return }
  isDown = true; isDrag = false
  downX = lastX = e.clientX
  downY = lastY = e.clientY
  grabPoint = groundPointAt(e.clientX, e.clientY)
})
window.addEventListener('pointermove', e => {
  // yerleştirme / arsa seçim hayaleti imleci takip eder
  if (placing || zoneMode) {
    toNDC(e.clientX, e.clientY)
    raycaster.setFromCamera(pointer, camera)
    const pt = new THREE.Vector3()
    if (raycaster.ray.intersectPlane(groundPlane, pt)) {
      if (placing) {
        repositionPlacing(pt.x, pt.y)
      } else if (zoneMode) {
        updateZoneAt(pt.x, pt.y)
      }
    }
  }
  if (!isDown) return
  if (pinching) { isDown = false; isDrag = false; grabPoint = null; return } // pinch sırasında pan yok
  // sol tuş bırakılmış ama pointerup kaçmışsa (ör. sağ tık menüsü araya girdi) sürüklemeyi kes
  if ((e.buttons & 1) === 0) { isDown = false; isDrag = false; grabPoint = null; return }
  lastX = e.clientX; lastY = e.clientY
  if (Math.abs(e.clientX - downX) + Math.abs(e.clientY - downY) > 8) isDrag = true
  if (isDrag && grabPoint) {
    // kavrama: bastığın zemin noktası imlecin altında kalsın
    const cur = groundPointAt(e.clientX, e.clientY)
    if (cur) {
      camX = Math.max(-34, Math.min(50, camX + grabPoint.x - cur.x))
      camY = Math.max(-26, Math.min(26, camY + grabPoint.y - cur.y))
      updateCamera()
    }
  }
})
window.addEventListener('pointerup', e => {
  if (!isDown) return
  isDown = false
  // parmak biraz kaysa da dokunuş sayılır (8px eşiği mobilde tıklamaları yutuyordu)
  const tapDist = Math.abs(e.clientX - downX) + Math.abs(e.clientY - downY)
  if ((isDrag && tapDist > 12) || e.target !== renderer.domElement) return
  if (placing) {
    if (e.button === 0) {
      // mobilde hover yok: dokunuş önce hayaleti konumlandırır, aynı yere ikinci
      // dokunuş (ya da ✓) onaylar — eski konumda yanlışlıkla yerleştirme olmaz
      const prevX = placing.cx, prevY = placing.cy
      const pt = groundPointAt(e.clientX, e.clientY)
      if (pt) repositionPlacing(pt.x, pt.y)
      if (placing && Math.abs(placing.cx - prevX) + Math.abs(placing.cy - prevY) > 0.5) return
      if (placing.valid) confirmPlacement()
      else ui.toast('🚫 Buraya yerleştiremezsin — sahipli ve betonlu alana koy.', 'bad')
    }
    return
  }
  if (zoneMode) {
    if (e.button === 0) {
      // geçerlilik dokunuş noktasından taze hesaplanır (hover'a güvenme)
      const pt = groundPointAt(e.clientX, e.clientY)
      if (pt) updateZoneAt(pt.x, pt.y)
      if (zoneMode.valid) confirmZone()
      else if (zoneMode.kind === 'land') {
        const { c, r } = zoneMode
        const cost = parcelCost(c, r, state)
        ui.toast(c < 0 ? t('Bir parsele tıkla.')
          : state.owns(c, r) ? 'Bu arsa zaten senin.'
          : !state.parcelAdjacentToOwned(c, r) ? t('Bitişik değil — önce aradaki arsayı almalısın.')
          : `Para yetmiyor: bu arsa ₺${cost.toLocaleString('tr-TR')}, kasada ₺${Math.floor(state.money).toLocaleString('tr-TR')} var.`, 'bad')
      } else {
        const { c, r } = zoneMode
        ui.toast(c < 0 ? t('Bir parsele tıkla.')
          : !state.owns(c, r) ? t('Bu arsa senin değil — önce satın al.')
          : state.isPaved(c, r) ? 'Bu arsa zaten betonlu.'
          : `Para yetmiyor: beton ₺${PAVE_COST.toLocaleString('tr-TR')}.`, 'bad')
      }
    }
    return
  }
  handleClick(e)
})

function handleClick(e: PointerEvent) {
  toNDC(e.clientX, e.clientY)
  raycaster.setFromCamera(pointer, camera)

  // 1) pompadaki araçlar
  const carGroups = cars.cars.filter(c => c.phase === 'atPump').map(c => c.group)
  const carHits = raycaster.intersectObjects(carGroups, true)
  if (carHits.length > 0) {
    let obj: THREE.Object3D | null = carHits[0].object
    while (obj && !obj.userData.car) obj = obj.parent
    if (obj?.userData.car) {
      const c = obj.userData.car as Car
      // molada elektrikli araç: tıklayınca direkt gönder (arıza pill'i gibi, panel/popup açılmadan)
      if (c.kind === 'ev' && c.squatting) ui.onDismiss(c)
      else ui.selectCar(c)
    }
    return
  }

  // 2) binalar (uyarı pill'i → direkt tamir; bina → bilgi kartı)
  const hits = raycaster.intersectObjects(world.buildings.map(b => b.group), true)
  if (hits.length > 0) {
    const cashFor = hits.find(h => h.object.userData.cashFor)?.object.userData.cashFor
    if (cashFor) {
      const amt = state.collectPending(cashFor)
      if (amt > 0) {
        audio.cash()
        ui.toast(t('+₺{0} toplandı!', amt), 'good', true)
        persist()
      }
      return
    }
    let obj: THREE.Object3D | null = hits[0].object
    while (obj && !obj.userData.buildingId) obj = obj.parent
    if (obj?.userData.buildingId) {
      const bid = obj.userData.buildingId as string
      if (editMode && footprintOf(bid)) {
        startPlacement(bid, true) // düzenleme: direkt taşıma
        return
      }
      selectedBuilding = bid
      world.setSelected(selectedBuilding)
      // Ofis binası → kapsamlı Ofis paneli (özet + fiyat yönetimi + banka). Mobil sheet / masaüstü ortalı modal.
      if (bid === 'office') { openSection('office'); return }
      refreshBuildingCard()
      return
    }
  }

  // 3) boşluğa tıklama → seçimi kapat
  selectedBuilding = null
  world.setSelected(null)
  ui.hideBuildingCard()
  // Mobilde: sahne boşluğuna dokunma servis panelini de kapatır (backdrop yok).
  // selectCar(null) mevcut "paneli kapat" kalıbı; doldurma sürerken activeCar zaten
  // null olduğundan (START'a basınca) doldurmayı etkilemez, müşteri sahnede kalır.
  if (isNativePlatform() && ui.activeCar) ui.selectCar(null)
}

// ---- Oyun döngüsü ----
const clock = new THREE.Clock()
// vitrin: ?night=1 gece ortasından başlatır (tanıtım çekimi / ekran görüntüsü)
let dayTime = new URLSearchParams(location.search).has('night') ? 100 : 0
let prevCycleT = 0
let achieveT = 2
let saveT = 5
const DAY_CYCLE = 160 // saniye: ~90sn gündüz, ~40sn gece

function nightFactor(t: number): number {
  if (t < 0.55) return 0
  if (t < 0.65) return (t - 0.55) / 0.1
  if (t < 0.9) return 1
  return 1 - (t - 0.9) / 0.1
}

function frame() {
  requestAnimationFrame(frame)
  // sekme/uygulama arka planda: hesaplama+render durur (pil/CPU tasarrufu, ısınma azalır).
  // dt zaten 0.05 ile capli → geri dönünce güvenli devam.
  if (document.hidden) { clock.getDelta(); return }
  const dt = Math.min(clock.getDelta(), 0.05)
  promoTick?.(dt)
  if (exploding) { composer!.render(); return }

  dayTime += dt
  world.setNight(nightFactor((dayTime % DAY_CYCLE) / DAY_CYCLE))

  state.tick(dt)
  cars.update(dt)
  world.updateTankFill({
    benzin: state.tanks.benzin / state.fuelCapacity('benzin'),
    dizel: state.tanks.dizel / state.fuelCapacity('dizel'),
    lpg: state.tanks.lpg / state.fuelCapacity('lpg'),
  })

  for (const msg of state.events.splice(0)) {
    if (msg.includes(t('Başarım'))) {
      ui.toast(msg, 'good', true)
      audio.achieve()
    } else if (msg.includes('FIRSAT')) {
      ui.toast(msg, 'good', true) // yakıt indirimi / müşteri patlaması = iyi haber
      notifyIfHidden(msg, 'firsat')
    } else {
      ui.toast(msg, 'bad')
      if (msg.includes(t('KRİTİK')) || msg.includes('doldu')) notifyIfHidden(msg, 'kritik')
    }
  }

  if (state.exploded) {
    exploding = true
    // SİGORTA: artık TÜM save silinmiyor — sadece reaktör gider + ağır ceza.
    // İstasyon ayakta kalır (rage-quit önleme). Riziko hâlâ ciddi: yarı kasa + itibar.
    state.exploded = false
    state.hasSMR = false
    state.smrWear = 0
    state.uranium = 0
    state.money = Math.max(0, Math.round(state.money * 0.5))
    state.addRep(-1)
    if (auth.loggedIn()) auth.pushSave(savePayload()).catch(() => {}) // hayatta kalan durum (WIPE YOK)
    audio.boom()
    ui.showBoom()
    setTimeout(() => location.reload(), 3500)
    return
  }

  // gün dönümü: günlük kâr raporu
  const cycleT = (dayTime % DAY_CYCLE) / DAY_CYCLE
  if (cycleT < prevCycleT) {
    state.day++
    const profit = Math.round(state.money - state.dayStartMoney)
    ui.toast(t('📅 Gün {0} bitti — {1}: ₺{2}', state.day - 1, profit >= 0 ? t('kâr') : t('zarar'), Math.abs(profit).toLocaleString('tr-TR')), profit >= 0 ? 'good' : 'bad')
    // günlük yovmiye (pompacı + şarjcı) — recurring gider
    const wages = state.dailyWages()
    if (wages > 0) { state.money -= wages; state.wagesPaid += wages; state.wageLog.push({ day: state.day, amount: wages }); if (state.wageLog.length > 40) state.wageLog.shift(); ui.toast(t('🧑‍🔧 Günlük yovmiye ödendi: -₺{0}', wages.toLocaleString('tr-TR')), '') }
    // kredi taksiti (aylık = 1 oyun günü)
    const loanRes = state.processLoanDay()
    if (loanRes === 'done') ui.toast(t('🏦 Kredi tamamen ödendi — teminatların serbest! 🎉'), 'good')
    else if (loanRes === 'warn') ui.toast(t('🏦 Kredi taksiti gecikti! Kasanı doldur — üst üste 2 gecikmede tahsilat/haciz gelir.'), 'bad')
    else if (loanRes === 'seize') {
      if (state.loan.collateral.length) seizeCollateral() // teminatlı → haciz
      else { state.startPartnership(); ui.toast(t('🏦 Borç ödenemedi — banka istasyona %{0} ORTAK oldu, kâr payından tahsil edilecek!', Math.round(PARTNER_SHARE * 100)), 'bad') }
    }
    // banka ortaklığı aktifse günlük kârdan payını al
    const pc = state.applyPartnerCut(profit)
    if (pc?.kind === 'ended') ui.toast(t('🏦 Banka payını tamamladı — ortaklık bitti, istasyon tamamen senin! 🎉'), 'good')
    else if (pc?.kind === 'cut' && pc.amount > 0) ui.toast(t('🏦 Banka ortağı kâr payı aldı: -₺{0}', pc.amount.toLocaleString('tr-TR')), '')
    if (document.getElementById('bankwrap')?.classList.contains('show')) renderBank()
    // dönemsel muhasebe: biten günün satış cirosunu kaydet
    const dayRev = Math.max(0, Math.round(state.stats.revenue - state.dayStartRevenue))
    state.salesLog.push({ day: state.day, rev: dayRev })
    if (state.salesLog.length > 370) state.salesLog.shift()
    state.dayStartRevenue = state.stats.revenue
    state.dayStartMoney = state.money
    state.facDaily = {}
    // gün sonu: policy interstitial'a izin veriyorsa forced reklam; vermiyorsa opt-in "günü 2x" fırsatı sun
    if (!isFullMode && !isPromoMode) {
      if (mayShowInterstitial(state.day, profit >= 0)) interstitial('gun-sonu', { day: state.day, won: profit >= 0 })
      else offerDoubleProfit(profit)
    }
    persist()
  }
  prevCycleT = cycleT

  // başarımlar + otomatik kayıt
  achieveT -= dt
  if (achieveT <= 0) {
    achieveT = 2
    checkAchievements(state)
  }
  saveT -= dt
  if (saveT <= 0) {
    saveT = 5
    persist()
  }

  // bina uyarı etiketleri
  const warns = new Map<string, { text: string; maintId: string }>()
  state.brokenPumps.forEach(i => warns.set(`pump-${i}`, { text: t('🔧 ARIZA · TAMİR ₺800'), maintId: `fix-pump-${i}` }))
  state.brokenChargers.forEach(i => warns.set(`charger-${i}`, { text: t('🔧 ARIZA · TAMİR ₺1.000'), maintId: `fix-charger-${i}` }))
  if (state.hasSolar && state.solarDirt >= 0.6) warns.set('solar', { text: t('🧽 TEMİZLİK ₺300'), maintId: 'clean-solar' })
  if (state.hasSMR && state.smrWear >= 0.5) {
    warns.set('smr', { text: state.smrWear > 0.75 ? t('🚨 BAKIM ŞART ₺1.500') : '☢️ BAKIM ₺1.500', maintId: 'maint-smr' })
  } else if (state.hasSMR && state.uranium <= 15 && !state.uraniumPending) {
    warns.set('smr', {
      text: state.uranium === 0 ? t('🚨 URANYUM BİTTİ · ₺2.500') : '🟢 URANYUM AZ · ₺2.500',
      maintId: 'order-uranium',
    })
  }
  world.syncWarnings(warns)
  const cashMap = new Map<string, number>()
  for (const [id, amt] of Object.entries(state.pendingCash)) if (amt >= 1) cashMap.set(id, amt)
  world.syncCash(cashMap)

  // seçili bina kartını canlı tut
  if (selectedBuilding && ui.buildingCardVisible) {
    cardRefreshT -= dt
    if (cardRefreshT <= 0) {
      refreshBuildingCard()
      cardRefreshT = 0.5
    }
  }

  // jeneratör gürültüsü EV sabrını tüketir
  if (state.dieselRunning()) {
    for (const c of cars.cars) {
      if (c.kind === 'ev' && !c.charging && (c.phase === 'atPump' || c.phase === 'waiting')) c.patience -= dt * 1.2
    }
  }

  for (const f of FUELS) {
    if (state.orders[f].arrived) {
      state.orders[f].arrived = false
      state.orders[f].delivering = true // tanker fiziksel yolda: teslim edene dek yeni sipariş yok
      const used = new Set(tankers.map(x => x.slot))
      let slot = 0
      while (used.has(slot)) slot++
      // kapılar taşınmış olabilir — tanker güncel giriş/çıkış rampalarını kullansın
      tankers.push({ t: new Tanker(world.scene, modelLib, f, slot, new THREE.Vector3(world.tankAnchor.x, world.tankAnchor.y, 0), () => world.gateIn.y, () => world.gateOut.y), fuel: f, slot })
    }
  }
  const blockedFor = (self: Tanker) => (pos: THREE.Vector3, dir: THREE.Vector3) => {
    const check = (p: THREE.Vector3, maxF: number, maxL: number) => {
      const rel = new THREE.Vector3().subVectors(p, pos)
      rel.z = 0
      const forward = rel.dot(dir)
      if (forward < 0.5 || forward > maxF) return false
      return rel.addScaledVector(dir, -forward).length() < maxL
    }
    for (const c of cars.cars) {
      if (c.phase !== 'gone' && check(c.group.position, 3.8, 1.6)) return true
    }
    // tanker de şeride çıkarken yaklaşan trafiğe yol verir
    if (pos.x > 3.8 && pos.x < 6.7 && dir.x > 0.3) {
      for (const c of cars.cars) {
        if (c.phase === 'transit' && c.lane === 'near'
          && c.group.position.y > pos.y - 12 && c.group.position.y < pos.y + 2) return true
      }
    }
    // tankerler birbirinin içinden GEÇMEZ: öndeki tanker varsa kuyrukta bekle
    for (const x of tankers) {
      if (x.t !== self && check(x.t.group.position, 5.2, 2.0)) return true
    }
    return false
  }
  for (let i = tankers.length - 1; i >= 0; i--) {
    const tk = tankers[i]
    const { t: tnk, fuel } = tk
    tk.age = (tk.age ?? 0) + dt
    if (tnk.update(dt, blockedFor(tnk)) && !tk.credited) {
      tk.credited = true
      state.orders[fuel].delivering = false
      state.deliverFuel(fuel)
      ui.toast(t('{0} tankı dolduruldu!', FUEL_LABEL[fuel]), 'good')
    }
    // teslimat sigortası: trafik tıkarsa bile 75 sn'de yakıt MUTLAKA teslim edilir
    if (!tk.credited && tk.age > 75) {
      tk.credited = true
      state.orders[fuel].delivering = false
      state.deliverFuel(fuel)
      ui.toast(t('{0} teslimatı gecikti — yakıt yine de teslim edildi.', FUEL_LABEL[fuel]), 'good')
      world.scene.remove(tnk.group)
      tankers.splice(i, 1)
      continue
    }
    if (tnk.done) {
      world.scene.remove(tnk.group)
      tankers.splice(i, 1)
    }
  }

  // pompalar bağımsız: dolumdaki HER araç aynı anda ilerler
  for (const c of [...cars.cars]) {
    // tabanca seçildiyse işlem başladı demektir: sabır donar, müşteri beklemeden gitmez
    if (c.phase === 'atPump' && c.kind === 'fuel') c.beingServed = c.filling || !!c.nozzle
    if (!(c.filling && c.kind === 'fuel' && c.phase === 'atPump' && c.nozzle && !c.wrongFuelHandled)) continue
    if (c.slotIndex >= 0 && state.brokenPumps.has(c.slotIndex)) {
      ui.toast(t('Pompa arızalandı — dolum yarıda kaldı, tamir gerekli.'), 'bad')
      notifyIfHidden(t('🔧 Pompa arızalandı — tamir gerekli!'), 'ariza-pompa')
      finishSale(c)
      continue
    }
    if (state.tanks[c.nozzle] <= 0) {
      ui.toast(t('{0} tankı boş kaldı! Satış yarım kaldı — sipariş ver.', t(FUEL_LABEL[c.nozzle])), 'bad')
      finishSale(c)
      continue
    }
    const amount = Math.min(FILL_RATE * dt, state.tanks[c.nozzle])
    c.filled += amount
    state.tanks[c.nozzle] -= amount
    c.bubbleT -= dt // sayaç ~9/sn güncellensin (her frame değil) — okunur, çok hızlı akmaz
    if (c.bubbleT <= 0) { c.bubbleT = 0.11; c.setCounter(`${c.filled.toFixed(1)}L · ₺${c.filledValue.toFixed(0)}`) }
    if (c.nozzle !== c.demandType && c.filled > 1.5) {
      wrongFuel(c)
    } else if (c.fullMode ? c.filled >= c.hiddenNeedL : c.filledValue >= c.targetAmount) {
      // Yalnızca GERÇEKTEN full isteyen müşteride talep = doldurulan (tam depo satışı) olur.
      // Belirli tutar isteyen müşteriyi FULLE'lemek exploit değil: gelir talep ile capli kalır + fazlası spill (ceza).
      if (c.fullMode && c.wantsFull) {
        c.demandAmount = Math.round(c.filledValue * 100) / 100
        c.demandLiters = c.filled
      }
      finishSale(c)
    }
  }

  // park etmiş araçların yayaları
  for (const [c, data] of pendingVisits) {
    if (c.phase === 'parked' && !data.started) {
      data.started = true
      spawnWalkerFor(c, data)
    }
  }
  updateWalkers(dt)

  world.update(dt)
  audio.setDiesel(state.dieselRunning() && !state.closed)
  audio.setPump(cars.cars.some(c => c.filling && c.phase === 'atPump' && !c.wrongFuelHandled))
  Car.solids = hardRects()
  evTurnAwayT = Math.max(0, evTurnAwayT - dt)
  tickAdOffer(dt)
  // otomatik şarj: işaretli ünitelere yanaşan EV kendiliğinden başlar
  for (const c of cars.cars) {
    if (c.kind === 'ev' && c.phase === 'atPump' && !c.charging && !c.squatting
      && c.chargedKwh === 0 && c.slotIndex >= 0 && state.autoChargers.has(c.slotIndex)) {
      startCharging(c, true)
    }
  }
  // pompacı: işaretli pompaya yanaşan araç doğru yakıtla kendiliğinden dolar,
  // hedef tutarda durur (dolum döngüsü finishSale'i çağırır)
  for (const c of cars.cars) {
    if (c.kind === 'fuel' && c.phase === 'atPump' && !c.filling && c.filled === 0
      && !c.wrongFuelHandled && !c.autoServed && c.slotIndex >= 0
      && state.autoPumps.has(c.slotIndex) && !state.brokenPumps.has(c.slotIndex)) {
      c.autoServed = true
      c.nozzle = c.demandType
      // müşterinin TALEBİNE kadar doldur; targetAmount ayarlanmazsa dolum döngüsü
      // ilk karede 0 litrede biterdi (pompacı benzin almadan yolluyordu → hep -₺30)
      if (c.wantsFull) c.fullMode = true
      else c.targetAmount = c.demandAmount
      c.filling = true
      c.beingServed = true
      if (Math.random() < 0.6) c.cleanWindows() // pompacı bazen camları da siler (rastgele) — oyuncunun işi değil
      tutDismiss() // pompacı devraldı → "hoşgeldin patron" ipucu takılı kalmasın
    }
  }
  tickEvCharging(dt)
  syncHoses()
  updateCamera()
  ui.update(state, dt)
  composer!.render()
}
frame()


// 🎬 REKLAM MODU (?promo=1): oyun kendi reklamını oynar — tek pompadan nükleer çağa.
if (isPromoMode) {
  state.money = 9000
  const fastAd = new URLSearchParams(location.search).has('fast')
  const T = fastAd ? 0.62 : 1
  const cap = document.createElement('div')
  cap.id = 'promocap'
  cap.style.cssText =
    'position:fixed;left:50%;transform:translateX(-50%);bottom:10%;z-index:60;max-width:94vw;' +
    "font-family:'Baloo 2',sans-serif;font-weight:800;color:#fff;text-align:center;" +
    'background:rgba(28,37,48,.9);padding:16px 30px;border-radius:22px;' +
    'border-bottom:5px solid #d64545;box-shadow:0 12px 34px rgba(0,0,0,.45);' +
    'font-size:min(6.6vw,80px);line-height:1.12;opacity:0;transition:opacity .4s;pointer-events:none'
  cap.style.transition = 'opacity .4s, transform .4s cubic-bezier(.34,1.56,.64,1)'
  cap.style.transform = 'translateX(-50%) scale(.9)'
  document.body.appendChild(cap)
  // geçiş flaşı: her beat'te yumuşak beyaz parlama
  const flash = document.createElement('div')
  flash.style.cssText = 'position:fixed;inset:0;background:#fff;opacity:0;z-index:55;' +
    'pointer-events:none;transition:opacity .12s'
  document.body.appendChild(flash)
  const say = (t: string) => {
    flash.style.opacity = '0.75'
    setTimeout(() => { flash.style.transition = 'opacity .55s'; flash.style.opacity = '0' }, 130)
    setTimeout(() => { flash.style.transition = 'opacity .12s' }, 750)
    cap.style.opacity = '0'
    cap.style.transform = 'translateX(-50%) scale(.9)'
    setTimeout(() => {
      cap.innerHTML = t
      cap.style.opacity = '1'
      cap.style.transform = 'translateX(-50%) scale(1)'
    }, 430)
  }
  const buy = (id: string) => {
    if (!buyItem(state, id)) { state.money += 500_000; buyItem(state, id) }
    buildVisual(id)
    try { audio.build() } catch { /* ses yoksa sessiz geç */ }
  }
  const beats: [number, () => void][] = [
    [1.0, () => say(t('KENDİ BENZİNLİĞİNİ KUR'))],
    [6.0, () => say(t('YAKIT SATMAYA BAŞLA'))],
    [13, () => { say(t('BÜYÜ VE GELİŞ')); buy('pump') }],
    [15, () => buy('pump')],
    [17, () => { buy('pump'); buy('sign') }],
    [19, () => { buy('sign'); buy('tank') }],
    [21.5, () => { say(t('MARKETİNİ AÇ, MÜŞTERİYİ TUT')); buy('market'); buy('toilet') }],
    [24, () => { buy('wash'); buy('coffee') }],
    [26.5, () => buy('market')],
    [29, () => { say(t('ELEKTRİĞE GEÇ')); buy('grid'); buy('battery') }],
    [31.5, () => { buy('evcharger'); buy('evcharger') }],
    [34, () => { buy('grid'); buy('evcharger') }],
    [37, () => { say(t('GÜNEŞ PANELLERİNİ KUR')); buy('solar') }],
    [40, () => { buy('airwater'); buy('selfwash') }],
    [43, () => { say(t('NÜKLEER ÇAĞA ADIM AT')); buy('smr') }],
    [49, () => say(t('KENDİ PETROL İSTASYONUNU İŞLET'))],
    [55, () => say(`<span style="color:#ffd24d">${t('ŞİMDİ OYNA')}</span>`)],
  ]
  let bi = 0
  let pt = 0
  promoTick = dt => {
    pt += dt
    while (bi < beats.length && pt >= beats[bi][0] * T) { beats[bi][1](); bi++ }
    // kasa reklam boyunca dolar — büyüme hissi
    state.money += dt * (1800 + pt * 160)
    // kamera: yakın plandan geniş plana süzülür
    camera.zoom = 1.85 - Math.min(1, pt / (46 * T)) * 1.02
    camera.updateProjectionMatrix()
    // müşteriler reklamda kendiliğinden karşılanır
    for (const c of cars.cars) {
      if (c.phase !== 'atPump') continue
      if (c.kind === 'fuel' && !c.filling && c.filled === 0 && !c.wrongFuelHandled) {
        c.nozzle = c.demandType
        c.fullMode = true
        c.filling = true
        c.beingServed = true
      } else if (c.kind === 'ev' && !c.charging && c.chargedKwh === 0 && !c.squatting) {
        startCharging(c, true)
      }
    }
  }
}
