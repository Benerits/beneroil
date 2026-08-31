import * as THREE from 'three'
import { World, ROAD_X, FAR_GATE_X, PUMP_SLOTS_POS, EV_SLOTS_POS, TANK_POS } from './world'
import { Car, CarManager, Tanker } from './cars'
import { UI, BuildingCard } from './ui'
import { injectNewsStyle, mountNewsButtons, maybeShowNews, pushLog } from './news'
import { TrafficDebug, trafficDebugOn } from './traffic-debug'
import { shareLabel } from './rival'
import { openLogbook } from './logbook-ui'
import { makeLogbook, resolveLogbook, logbookFlags, REFIT_KINDS, type MarinaFacId } from './marina'
import {
  FuelType, FUELS, FUEL_LABEL, FUEL_PRICE, GameState, FILL_RATE, SPILL_PENALTY_PER_L, WRONG_FUEL_PENALTY, GRID_COST_PER_KWH,
  EV_PRICE_PER_KWH, TANK_CAPACITY, URANIUM_COST, PARCEL_COLS, PARCEL_ROWS, PAVE_COST, FUEL_COST, priceBounds,
  parcelKey, parcelCost, buyItem, doMaintenance, getShopItems, serializeState, hydrateState, checkAchievements, SUPPLIERS,
  dailyQuests, claimDailyQuests, careerGoals,
  POMPACI_HIRE, EV_ATTENDANT_HIRE, POMPACI_WAGE, EV_ATTENDANT_WAGE, PARTNER_SHARE, ADVANCE_RATE, LOAN_RATE, sellInfo, applySell,
  unitIndex,
  LocId, MANAGER_COSTS, MANAGER_WAGES, TANK_COSTS, PUMPSPEED_COSTS,
  // ŞUBE ÇİFTLEME: kopya şubeler (otoyol-2 vb.) — tema/sahne TABAN id'den, ekonomi
  // türetilmiş temadan gelir (bkz. state.ts themeFor / BRANCH_COPIES).
  ALL_LOCS, BRANCH_COPIES, baseLoc, isCopyLoc, themeFor, SUPPLY_LINE_QUOTA,
} from './state'
// ŞUBE AĞI HARİTASI: yatırım tahtası (Ofis › Şubeler + HUD şube menüsünden açılır).
// Saf DOM modülü — state okur, aksiyonu buradaki MEVCUT akışlara geri çağırır.
import { haritaKur, haritaAc, haritaCiz, haritaAcikMi } from './harita'
import { loadModels, loadStatics, loadCharacters, fitCharacter } from './models'
import { loadKit, kitNeeded, kitReady, kitSize } from './kits'
import { isNativePlatform, isInstantGames, isLightMode, asset } from './platform'
import { guardContextLoss } from './fbinstant'
// NOT: tema artık doğrudan THEMES'ten değil state.themeFor()'dan okunur — kopya şubede
// (Otoyol II) taban temadan TÜRETİLMİŞ, kısıtları değişmiş nesne dönmeli.
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

// ---- Misafir (hesapsız) HEMEN oynar; kayıt/giriş gate'i yalnız gün-eşiğinde veya "Kaydet"le açılır ----
let showAuthGate: (headline?: string, hideGuestBtn?: boolean) => void = () => {}
let guestPaused = false // misafir donması: başlangıç login gate'inde + gün-eşiğinde oyun donar
// OTURUM SÜRESİ (analiz E14): oyun gerçekten oynanırken (kapı kapalı + sekme görünür)
// dakikada 1 sayaç — saatlik toplamı "toplam oynanan dakika"yı verir
setInterval(() => {
  if (!guestPaused && document.visibilityState === 'visible') {
    fetch('/api/metric', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ k: 'session_minutes' }) }).catch(() => {})
  }
}, 60_000)
{
  const gated = !localStorage.getItem('benzinlik-token')
  if (gated) {
    const gate = document.getElementById('authgate') as HTMLDivElement
    translateDom() // giriş ekranı metinlerini seçili dile çevir
    const gErr = document.getElementById('agerr') as HTMLDivElement
    const gEmail = document.getElementById('gemail') as HTMLInputElement
    const gPass = document.getElementById('gpass') as HTMLInputElement
    // kayıt/giriş/sosyal başarılı → varsa misafir ilerlemesini hesaba TAŞI, sonra yenile
    // KURAL: misafir kaydı YALNIZCA REGISTER'da hesaba taşınır. LOGIN'de ASLA dokunulmaz
    // (hesabın bulut kaydı otoriter → giriş yapınca kendi ilerlemeni bulursun, misafir Gün-1 ezmez).
    // OAuth yeni hesap AÇMIŞ olabilir → yalnız hesap TAZE ise taşı, doluysa dokunma.
    const afterAuth = async (mode: 'register' | 'login' | 'oauth') => {
      if (mode === 'register') localStorage.setItem(auth.REG_BONUS_KEY, '1') // gate register yolu (raw fetch) → bonus
      const g = auth.loadGuest()
      if (g) {
        try {
          if (mode === 'register') {
            await auth.pushSave(g) // yeni kayıt → misafir ilerlemesi hesaba taşınır
          } else if (mode === 'oauth') {
            const acc = await auth.pullSave() as { s?: { day?: number }; placedRects?: unknown[] } | null
            const accEmpty = !acc || ((acc.s?.day ?? 1) <= 1 && !(Array.isArray(acc.placedRects) && acc.placedRects.length > 0))
            if (accEmpty) {
              await auth.pushSave(g) // OAuth ile yeni açılan boş hesap → taşı
              localStorage.setItem(auth.REG_BONUS_KEY, '1') // OAuth ile YENİ hesap = kayıt → bonus
            }
          }
          // mode === 'login': ASLA push yok — misafir verisi atılır, hesaptan devam
          auth.clearGuest()
        } catch { /* ağ hatası: misafir verisi yerelde kalsın, sonraki girişte tekrar denenir */ }
      }
      location.reload()
    }
    const wire = (id: string, path: string, mode: 'register' | 'login') => {
      (document.getElementById(id) as HTMLButtonElement).addEventListener('click', async () => {
        gErr.textContent = ''
        try {
          const res = await fetch(path, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ email: gEmail.value, password: gPass.value, lang, guest: auth.hasGuest() }),
          })
          const d = await res.json().catch(() => ({}))
          if (!res.ok) {
            if (d.appeal) { showAppealOverlay(d.token); return } // izahat banı → savunma formu
            throw new Error(d.error ?? t('Sunucuya ulaşılamadı.'))
          }
          localStorage.setItem('benzinlik-token', d.token)
          localStorage.setItem('benzinlik-email', d.email)
          await afterAuth(mode)
        } catch (err) {
          gErr.textContent = (err as Error).message
        }
      })
    }
    // ziyaret sayacı — "misafir katıldı" push'u BURADA DEĞİL: sayfayı açan herkes için
    // bildirim gidiyordu; push artık oyuncu GERÇEKTEN misafir başlayınca (proceedGuest) gider.
    fetch('/api/visit', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({}) }).catch(() => {})
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
    wire('glogin', '/api/login', 'login')
    wire('gregister', '/api/register', 'register')
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
          body: JSON.stringify({ idToken, email, guest: auth.hasGuest() }),
        })
        const d = await res.json().catch(() => ({}))
        if (!res.ok) {
          if (d.appeal) { showAppealOverlay(d.token); return } // izahat banı → savunma formu
          throw new Error(d.error ?? t('Giriş başarısız.'))
        }
        localStorage.setItem('benzinlik-token', d.token)
        localStorage.setItem('benzinlik-email', d.email)
        await afterAuth('oauth')
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
          // Apple girişinde native aud = BUNDLE ID. Yeni Apple hesabına taşınırken
          // bundle com.benerits.beneloil → com.beneloil oldu; sunucudaki
          // APPLE_CLIENT_IDS de bu değeri içermeli (geçiş boyunca ikisi birden).
          apple: { clientId: 'com.beneloil' },
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
            else gErr.textContent = t('Google eklentisi bulunamadı.')
          } catch (e) { gErr.textContent = (e as Error)?.message || t('Giriş başarısız.') }
        }
        document.getElementById('gbtn-google')!.appendChild(btn); any = true
      } else if (cfg.googleClientId) {
        try {
          await loadScript('https://accounts.google.com/gsi/client')
          const g = (window as unknown as { google: any }).google
          g.accounts.id.initialize({ client_id: cfg.googleClientId, callback: (resp: { credential: string }) => oauthSubmit('google', resp.credential) })
          // Oyunun tasarım dilinde özel buton; GERÇEK GIS butonu üstünde görünmez katman
          // (tıklama ona düşer — GIS'in kendi stilleri kısıtlı olduğundan standart overlay tekniği)
          const gc = document.getElementById('gbtn-google') as HTMLDivElement
          gc.style.cssText = 'position:relative; overflow:hidden; border-radius:var(--r-md)'
          gc.innerHTML = `
            <button type="button" style="width:100%; padding:10px 14px; border-radius:var(--r-md);
              border:1.5px solid var(--edge); border-bottom:3px solid var(--edge); background:#fff; color:var(--ink);
              font-family:'Baloo 2',sans-serif; font-weight:800; font-size:14px; cursor:pointer;
              display:flex; align-items:center; justify-content:center; gap:8px">
              <svg width="17" height="17" viewBox="0 0 48 48"><path fill="#FFC107" d="M43.6 20.1H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.9 1.2 8 3l5.7-5.7C34 6.1 29.3 4 24 4 13 4 4 13 4 24s9 20 20 20 20-9 20-20c0-1.3-.1-2.6-.4-3.9z"/><path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.9 1.2 8 3l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"/><path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z"/><path fill="#1976D2" d="M43.6 20.1H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C41 35.4 44 30.2 44 24c0-1.3-.1-2.6-.4-3.9z"/></svg>
              <span>${t('Google ile devam et')}</span>
            </button>
            <div id="gis-real" style="position:absolute; inset:-4px; opacity:0.001; display:flex; justify-content:center; align-items:stretch"></div>`
          g.accounts.id.renderButton(document.getElementById('gis-real'), {
            theme: 'outline', size: 'large', text: 'continue_with', shape: 'rect',
            width: Math.min(400, Math.max(220, gc.clientWidth || 320)),
          })
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
            if (P.SocialLogin) {
              await initSocial(P)
              const r: any = await P.SocialLogin.login({ provider: 'apple', options: { scopes: ['email', 'name'] } })
              const tok = r?.result?.idToken ?? r?.result?.identityToken ?? r?.idToken ?? r?.identityToken
              if (!tok) throw new Error('no-token')
              await oauthSubmit('apple', tok)
            }
            else if (P.SignInWithApple) { const r = await P.SignInWithApple.authorize({ scopes: 'email name' }); await oauthSubmit('apple', r?.response?.identityToken) }
            else gErr.textContent = t('Apple eklentisi bulunamadı.')
          } catch (e) {
            // İPTAL sessizdir (kullanıcı sheet'i kapattı — iOS'un ham 1001 metni ekrana BASILMAZ);
            // gerçek hatalarda TR mesaj.
            const m = String((e as Error)?.message || '')
            if (!/cancel|canceled|cancelled|1001|iptal/i.test(m)) gErr.textContent = t('Giriş başarısız.')
          }
        }
        any = true
      } else if (false && cfg.appleServicesId) { // web'de Apple gizli — sadece iOS native
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

    // ---- MİSAFİR AKIŞI (TEK YER, başka if/else YOK) ----
    // 1) Gate HER açılışta gösterilir — localStorage'da misafir verisi olsa bile OTOMATİK başlatmaz.
    // 2) "Misafir olarak oyna/devam et" butonuna BASINCA oyun başlar (varsa yerel misafir kaydından).
    // 3) Login → hesap kaydından devam (409 conflict guard'ı bulut kaydını korur).
    //    Register → misafir verisi hesaba taşınır (afterAuth → pushSave + clearGuest).
    guestPaused = true
    const gGuestBtn = document.getElementById('gguest') as HTMLButtonElement
    const gGuestLbl = gGuestBtn.querySelector('span') ?? gGuestBtn
    const openGate = (headline?: string, hideGuestBtn?: boolean) => {
      // buton etiketi: yerel misafir kaydı varsa "devam et", yoksa "oyna"
      gGuestLbl.textContent = auth.hasGuest() ? t('Misafir olarak devam et') : t('Misafir olarak oyna')
      const gw = document.getElementById('gguest-wrap'); if (gw) gw.style.display = hideGuestBtn ? 'none' : 'block'
      // SEBEP belirgin banner'da: misafir neden kayıt olmalı — direkt login'e atılmış hissi vermesin
      const reason = document.getElementById('agreason') as HTMLDivElement | null
      if (reason) { reason.textContent = headline ?? ''; reason.style.display = headline ? 'block' : 'none' }
      gate.style.display = 'flex'
      gate.classList.add('solid')
      guestPaused = true
      // huni ölçümü: kapı kaç kez gösterildi (gate_converted ile oranı = başlama dönüşümü)
      fetch('/api/metric', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ k: 'gate_shown' }) }).catch(() => {})
      // C9 (analiz): DÖNÜŞ KARTI — yerel kayıttan müdürlü şube kasalarını oku;
      // birikmiş para varsa kapıda göster ("geri gelme sebebi" ilk bakışta)
      try {
        const g = auth.loadGuest() as { s?: { branchVault?: Record<string, number> } } | null
        const bv = g?.s?.branchVault
        const tot = bv ? Object.values(bv).reduce((a, b) => a + (Number(b) || 0), 0) : 0
        const card = document.getElementById('ag-vault') as HTMLDivElement | null
        if (card) {
          if (tot >= 100) {
            card.textContent = t('Sen yokken müdürlü şubelerin ₺{0} biriktirdi — girip topla!', Math.round(tot).toLocaleString('tr-TR'))
            card.style.display = 'block'
          } else card.style.display = 'none'
        }
      } catch { /* kart gösterilemezse kapı normal çalışır */ }
    }
    showAuthGate = openGate
    document.getElementById('boot')?.remove() // A5: yükleme maskesi — sahne hazır, kaldır
    openGate() // başta HEP göster
    const proceedGuest = () => {
      // ekibe "misafir katıldı" push'u: oyuncu GERÇEKTEN misafir başlayınca, cihaz başına 1 kez
      if (!localStorage.getItem('benzinlik-guest-joined')) {
        localStorage.setItem('benzinlik-guest-joined', '1')
        fetch('/api/visit', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ guest: true }) }).catch(() => {})
      }
      guestPaused = false
      gate.style.display = 'none'
      gate.classList.remove('solid')
      maybeGuestGate() // gün-eşiği zaten dolduysa (yenileyip dönen misafir) gate ANINDA geri açılır (kayıt zorunlu)
    }
    // A4 (huni analizi): kayıt-avantaj ARA MODALI KALDIRILDI — başlama akışına fazladan
    // tıklama ekliyordu; kayıt teklifi oyun İÇİ kancalarda (₺10k banner, gün-eşiği) sürüyor.
    gGuestBtn.addEventListener('click', () => {
      fetch('/api/metric', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ k: 'gate_converted' }) }).catch(() => {})
      proceedGuest()
    })
    // Oyun-içi "Şimdi Kayıt Ol" CTA (yalnız misafirken görünür) → gate'i yeniden açar
    const cta = document.getElementById('guestcta') as HTMLButtonElement
    cta.style.display = 'inline-flex'
    cta.addEventListener('click', () => openGate())
    // MİSAFİR modu: modül BURADA DURMAZ — oyun ardında hazır, butona basınca oynanır
  }
}

const app = document.getElementById('app')!
// LIGHT MOD (Meta/Instant Games): antialias + gölge + post-processing kapalı, pixelRatio 1.
// Instant Games düşük seviye Android'de iframe içinde çalışıyor; bloom ve PCFSoft gölge
// oradaki en pahalı iki iş. Web/iOS'ta hiçbir şey değişmez.
const LIGHT = isLightMode()

/**
 * WEBGL GUARD — 12 Ağu: "WebGL oluşturma hatası, oyun açılmıyor" şikâyetlerinin kökü.
 * three r178 WebGL1 fallback'ini KALDIRDI: context alınamazsa WebGLRenderer throw eder.
 * Bu satır modül ÜST SEVİYESİNDE olduğu için throw tüm modülü öldürüyordu → kullanıcı
 * bomboş ekran görüyor, hiçbir açıklama yok, hata sunucuya da ulaşmıyordu (ölçemiyorduk).
 * Tetikleyenler: donanım hızlandırma kapalı, eski/kara listedeki GPU, tarayıcının WebGL
 * context limiti (çok sekme), uzak masaüstü/VM. Artık sebep + çözüm gösteriliyor ve
 * olay webgl_fail sayacına yazılıyor, böylece kaç oyuncunun etkilendiğini görebiliyoruz.
 */
function showWebGLFailure(err: unknown): void {
  try {
    fetch('/api/metric', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ k: 'webgl_fail' }),
    }).catch(() => {})
  } catch { /* ölçüm asla ekranı engellemesin */ }
  const tr = String(navigator.language || '').toLowerCase().startsWith('tr')
  const msg = tr ? {
    h: 'Oyun bu cihazda açılamadı',
    p: 'Tarayıcın 3D grafik (WebGL) başlatamadı. Bu genellikle donanım hızlandırma kapalıyken ya da çok fazla sekme açıkken olur — cihazın yetersiz demek değil.',
    a: 'Diğer sekmeleri kapatıp sayfayı yenile',
    b: 'Tarayıcı ayarlarından donanım hızlandırmayı aç (Chrome: Ayarlar → Sistem)',
    c: 'Tarayıcını güncelle, ya da Chrome/Edge/Safari son sürümünü dene',
    r: 'Yeniden dene',
  } : {
    h: 'The game could not start on this device',
    p: 'Your browser could not start 3D graphics (WebGL). This usually happens when hardware acceleration is off or too many tabs are open — it does not mean your device is too old.',
    a: 'Close other tabs and reload the page',
    b: 'Turn on hardware acceleration (Chrome: Settings → System)',
    c: 'Update your browser, or try the latest Chrome/Edge/Safari',
    r: 'Try again',
  }
  const box = document.createElement('div')
  box.setAttribute('role', 'alert')
  box.style.cssText = 'position:fixed;inset:0;z-index:99999;display:flex;align-items:center;justify-content:center;padding:24px;background:#0f1216;color:#eef2f6;font:16px/1.55 system-ui,-apple-system,"Segoe UI",sans-serif;overflow:auto'
  const esc = (t: string) => t.replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c] as string))
  box.innerHTML = `<div style="max-width:520px">
    <h1 style="margin:0 0 12px;font-size:22px;font-weight:700;letter-spacing:-.01em">${esc(msg.h)}</h1>
    <p style="margin:0 0 16px;color:#b9c2cc">${esc(msg.p)}</p>
    <ul style="margin:0 0 20px;padding-left:20px;color:#b9c2cc">
      <li style="margin-bottom:6px">${esc(msg.a)}</li>
      <li style="margin-bottom:6px">${esc(msg.b)}</li>
      <li>${esc(msg.c)}</li>
    </ul>
    <button id="wglretry" style="padding:11px 20px;border:0;border-radius:8px;background:#2a78d6;color:#fff;font:inherit;font-weight:600;cursor:pointer">${esc(msg.r)}</button>
  </div>`
  document.body.appendChild(box)
  box.querySelector('#wglretry')?.addEventListener('click', () => location.reload())
  console.error('[webgl] renderer oluşturulamadı:', err)
}

// MERGE (30 Ağu): WebGL guard ile LIGHT mod BİRLİKTE. Guard, context alınamazsa boş ekran
// yerine sebebi gösteriyor; LIGHT mod ise Instant Games'te antialias/gölgeyi kapatıyor.
// İkisi farklı sorunları çözüyor, ayarlar guard'ın içine taşındı.
let renderer: THREE.WebGLRenderer
try {
  renderer = new THREE.WebGLRenderer({ antialias: !LIGHT, powerPreference: LIGHT ? 'low-power' : 'default' })
} catch (err) {
  showWebGLFailure(err)
  throw err // modül burada durur; ekran artık boş değil, sebebi yazıyor
}
renderer.setPixelRatio(Math.min(window.devicePixelRatio, LIGHT ? 1 : 1.5)) // performans: 2x retina yerine 1.5x yeterli
renderer.shadowMap.enabled = !LIGHT
renderer.shadowMap.type = THREE.PCFSoftShadowMap
/**
 * GÖLGE DONDURMA (30 Ağu — en yüksek kazançlı optimizasyon).
 *
 * autoUpdate açıkken sahnenin TAMAMI her karede iki kez çiziliyordu: bir gölge geçişi,
 * bir normal geçiş. Ölçüm: 971 mesh × 2. Oysa sahnenin %95'i hareketsiz — binalar,
 * ağaçlar, kayalar, tanklar, pompalar. Yalnız araçlar hareket ediyor ve onların gölgesi
 * bu ölçekte gözle takip edilmiyor.
 *
 * Artık gölge haritası yalnız SAHNE DEĞİŞTİĞİNDE bir kare güncelleniyor:
 * yapı kurulunca/taşınınca/yıkılınca, şube değişince, gün-gece geçişinde.
 * golgeTazele() bunu tetikler.
 */
renderer.shadowMap.autoUpdate = false
renderer.shadowMap.needsUpdate = true   // ilk kare: gölgeler bir kez çizilsin
renderer.localClippingEnabled = true // küre tank sıvısı: yatay düzlemle alttan-yukarı dolum kırpması
renderer.toneMapping = THREE.ACESFilmicToneMapping
renderer.toneMappingExposure = 1.1
app.appendChild(renderer.domElement)
if (isInstantGames()) guardContextLoss(renderer.domElement) // iframe'de bağlam kaybı sık

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
  // Ortho'da near NEGATİF olabilir: zoom-out'ta ekran-altına düşen zemin kamera düzleminin
  // "arkasında" kalır (t<0) — near=0.1 onu kırpıp gök rengini gösteriyordu (alt-mavi bug'ı).
  camera.near = -200
  camera.far = 400 // zoom-out artınca + uzun yol/geniş zemin kırpılmasın
  camera.updateProjectionMatrix()
}
window.addEventListener('resize', resize)
window.addEventListener('wheel', e => {
  // UI panellerinin üzerindeyken oyuna zoom geçirme (modal içinde scroll serbest)
  if ((e.target as HTMLElement).closest?.('.backdrop, .modal, #panel, #infocard, .hud, .navbar')) return
  camera.zoom = Math.min(2.6, Math.max(0.62, camera.zoom * Math.exp(-e.deltaY * 0.0012)))
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
      camera.zoom = Math.min(2.6, Math.max(0.62, pinchStartZoom * (d / pinchStartDist)))
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
      body: t('{0} tankeri istasyona ulaştı!', FUEL_LABEL[tk.fuel]), schedule: { at: new Date(Date.now() + eta * 1000) } })
  }
  // Tank bitmeye yakın bildirimi: pompacılar arka planda satmaya devam eder (offline satış) —
  // toplam stok %15'in altına ineceği anı hesapla, o dakikaya bildirim kur (2 saat cap).
  const attended = [...state.autoPumps].filter(i => !state.brokenPumps.has(i)).length // bozuk pompadaki pompacı satamaz
  if (attended > 0) {
    const totalStock = OFFLINE_FUELS.reduce((a, f) => a + Math.max(0, state.tanks[f]), 0)
    const totalCap = OFFLINE_FUELS.reduce((a, f) => a + state.fuelCapacity(f), 0)
    const rate = OFFLINE_LPS * attended // L/sn
    const lowAt = totalCap * 0.15
    if (totalStock > 0 && totalStock > lowAt) {
      const secs = (totalStock - lowAt) / rate
      if (secs < 7200) notifs.push({
        id: 1_800_000_001, title: world?.stationName ?? 'BenelOil',
        body: t('Tankların bitmek üzere — sipariş verme vakti!'),
        schedule: { at: new Date(Date.now() + Math.max(60, secs) * 1000) },
      })
    } else if (totalStock <= lowAt) {
      // zaten kritik: 1 dk sonra hatırlat (uygulamayı kapatırken görsün)
      notifs.push({ id: 1_800_000_001, title: world?.stationName ?? 'BenelOil',
        body: t('Tankların bitmek üzere — sipariş verme vakti!'), schedule: { at: new Date(Date.now() + 60_000) } })
    }
  }
  if (notifs.length) { try { P.LocalNotifications.schedule({ notifications: notifs }) } catch { /* yok say */ } }
}
let gizlendiT = 0
document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    gizlendiT = Date.now()
    scheduleBackgroundReminders() // arka plana geçerken yaklaşan olayları planla
    return
  }
  // ARKA PLAN TELAFİSİ (#1014/#1016): sekme kapalıyken oyun duruyor; dönüşte o süre
  // offline verimle ödenir. Reload gerekmiyor.
  if (gizlendiT) {
    const gecen = (Date.now() - gizlendiT) / 1000
    gizlendiT = 0
    if (gecen >= 120) {
      applyOfflineEarnings(gecen)
      // aynı süre bir de reload'da ödenmesin: kaydın zaman damgası ŞİMDİ sayılır
      loadedSaveAt = Date.now()
      persist()
    }
  }
  document.title = `${world?.stationName ?? 'Benzinlik'} — Benzinlik`
  // odağa dönünce: başka cihaz save'i ilerlettiyse en güncele senkronla (ilerleme karışmasın)
  if (auth.loggedIn() && !syncedConflict) {
    auth.fetchUpdatedAt().then(ts => {
      const base = auth.lastUpdatedAt()
      if (ts && base && new Date(ts).getTime() > new Date(base).getTime() + 1000) { syncedConflict = true; onRemoteNewer() }
    }).catch(() => {})
  }
})

// Sahne, save YÜKLENMEDEN kurulduğu için aktif şube ipucu localStorage'dan okunur
// (save otoriter kalır; uyuşmazlıkta aşağıda bir kez sessiz reload ile düzelir).
const LOC_HINT_KEY = 'beneloil-loc'
/** Kayıttaki gerçek şube id'si — KOPYA olabilir ('otoyol-2'). Save karşılaştırması bunu kullanır. */
const locHintSave = (localStorage.getItem(LOC_HINT_KEY) as LocId | null) ?? 'kasaba'
/** SAHNE/KİT id'si: kopya şube tabanıyla AYNI sahneyi kullanır (Otoyol II de bir otoyoldur).
 *  Kopya id'si sahne katmanına asla sızmaz — world.ts bilinmeyen id'de kasabaya düşerdi. */
const locHint = baseLoc(locHintSave)

// Kenney modelleri (yüklenemezse prosedürele düşer) + AKTİF ŞUBENİN kiti.
// Kit tembel: kasaba/çevre yolu oyuncusu tek bayt fazla indirmez (bkz. src/kits.ts).
// AÇILIŞ SİGORTASI (2 oyuncu raporu: "İstasyonun hazırlanıyor"da takılı kaldı):
// GLB fetch'lerinden biri ASILI kalır ya da REJECT ederse bu top-level await sonsuza
// dek bekliyor/ölüyordu — boot maskesi hiç kalkmıyordu. Kit yüklemesi artık açılışı
// KİLİTLEYEMEZ: 20 sn'de cevap yoksa veya hata varsa null ile devam edilir; sahne
// prosedürel fallback'lerle her durumda kurulur, eksik kit arkada önemsizdir.
const failSafe = <T,>(p: Promise<T | null>, ms = 20_000): Promise<T | null> =>
  Promise.race([p.catch(() => null), new Promise<null>(res => setTimeout(() => res(null), ms))])
const [modelLib, staticLib, branchKit] = await Promise.all([
  // ŞUBE ÇİFTLEME: kopya şube TABANIYLA AYNI sahneyi/kiti kullanır (Otoyol II de bir
  // otoyoldur). Kit ve tema daima taban id'den okunur; kopya id'si sahne katmanına
  // hiç sızmaz — yoksa world.ts bilinmeyen id'de kasaba sahnesine düşerdi.
  failSafe(loadModels()), failSafe(loadStatics()), failSafe(loadKit(locHint)),
])
const world = new World(staticLib, locHint, branchKit)
Car.boatKit = branchKit   // MARİNA: tekne modelleri kitten gelir (yoksa prosedürel gövde)
const state = new GameState()
world.isPavedFn = (c, r) => state.isPaved(c, r)
let parkInfoShown = 0
let rampFullT = 0 // otoyol: "şerit doldu" uyarısı spam olmasın
let lbLoading = false // leaderboard isteği tekrarlanmasın
let autoChargeShown = 0
let appConfig: any = null // /api/config yanıtı (RevenueCat key vb. lazy kullanım için)
const isPromoMode = new URLSearchParams(location.search).has('promo')
if (!isPromoMode) {
  const test = new URLSearchParams(location.search).has('adstest')
  beginAdSession()
  fetch('/api/config').then(r => r.json()).then(cfg => {
    appConfig = cfg
    // native → AdMob (config'te gerçek unit yoksa TEST reklamları); web → AdSense (adsClient varsa)
    initAds({ adsensePub: cfg.adsClient, admob: cfg.admob, test })
    // iOS v1: RevenueCat kurulu değilse Mağaza TAMAMEN gizli — reviewer boş/bozuk IAP ekranı
    // görmesin (2.1 riski). RC key env'e girince buton kendiliğinden geri gelir.
    if (isNativePlatform() && !cfg.revenuecatIos) {
      const b = document.getElementById('of-store'); if (b) (b as HTMLElement).style.display = 'none'
    }
  }).catch(() => { initAds({ test }) })
}
let promoTick: ((dt: number) => void) | null = null
const ui = new UI()
// BİLDİRİM GEÇMİŞİ (#465 kardeşi): toast 3 sn'de kayboluyor, kaçıran bir daha göremiyordu.
// toast'ı sarmalayıp her mesajı oyun günü damgasıyla loglarız — davranış değişmez.
{
  const origToast = ui.toast.bind(ui)
  ui.toast = (msg: string, kind: 'good' | 'bad' | '' = '', silent = false) => {
    try { pushLog(state?.day ?? 1, t(msg), kind) } catch { /* state henüz yoksa geç */ }
    origToast(msg, kind, silent)
  }
}
injectNewsStyle()

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
// MASAÜSTÜ OFİS BUTONU (#1076 "mobilde görünen ofis grubu neden web pc'de görünmüyor,
// şubeleri görmek istiyorum"): PC'de ofise yalnız 3B ofis binasına tıklayarak girilebiliyordu.
document.getElementById('officebtn')?.addEventListener('click', () => openSection('office'))
// MESAJ KUTUSU (#1018 "uyarıyı gözden kaçırdım, tekrar bakmam için bir mesaj kutusu olsun")
function mesajKutusuAc() {
  const liste = document.getElementById('inbox-list')
  if (liste) {
    const kayitlar = [...ui.inbox].reverse()
    liste.innerHTML = kayitlar.length
      ? kayitlar.map(m => {
          const dk = Math.floor((Date.now() - m.t) / 60000)
          const ne = dk < 1 ? t('az önce') : dk < 60 ? t('{0} dk önce', String(dk)) : t('{0} sa önce', String(Math.floor(dk / 60)))
          return `<div class="ibrow ${m.kind}"><span class="ibdot"></span>`
            + `<span class="ibtx">${m.text.replace(/[<>&]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c]!))}</span>`
            + `<span class="ibtm">${ne}</span></div>`
        }).join('')
      : `<div id="inbox-empty">${t('Henüz mesaj yok.')}</div>`
  }
  document.getElementById('inboxwrap')?.classList.add('show')
  ui.markInboxRead()
}
document.getElementById('inboxbtn')?.addEventListener('click', mesajKutusuAc)

// ── HUD BİLGİ BALONCUKLARI (Twitter #5, 29 Ağu: "Üst Bar'da bulunan itemlere
//    tıklandığında bilgi kutuları gelmeli") — her gösterge ne anlama geliyor,
//    değeri nereden geliyor, oyuncu ne yapabilir.
const CHIP_BILGI: Record<string, () => { baslik: string; metin: string }> = {
  gun: () => ({ baslik: t('Oyun Günü'), metin: t('Bir oyun günü 160 saniye sürer. Gün dönümünde kira/yovmiye kesilir, ihale teslimatı kapanır, şube müdürlerinin geliri kasana yazılır ve itibarın günün hizmet kalitesine göre güncellenir.') }),
  saat: () => ({ baslik: t('Saat'), metin: t('Gün 06:00\'da başlar. Gece trafiği azalır ama sokak lambaları ve tabela ışığı müşteri çeker; güneş panelleri yalnız gündüz üretir.') }),
  kasa: () => ({ baslik: t('Kasa'), metin: t('Elindeki nakit. Yakıt alımı, inşaat ve yovmiye buradan çıkar. Kumbaralarda bekleyen para HENÜZ kasada değildir — tesise tıklayıp toplaman gerekir.') }),
  itibar: () => {
    const r = state.repToday()
    const toplam = r.served + r.lost
    return { baslik: t('İtibar'), metin: t('Gün sonunda O GÜNÜN kayıp oranına göre güncellenir. Bugün: {0} servis, {1} kaçan. Gün sonu hedefi {2}. Kayıpsız gün 5.0\'a çeker; müşteri kaçırmak düşürür.',
      String(r.served), String(r.lost), r.target.toFixed(1)) + (toplam < 3 ? ' ' + t('Bugün neredeyse hiç müşteri görmedin — itibar yavaşça 3.0\'a doğru aşınır.') : '') }
  },
  yakit: () => ({ baslik: t('Yakıt Deposu'), metin: t('Tanktaki litre. Bitince o yakıtın müşterisi kaçar. Yakıt Siparişi ekranından tanker çağır — tedarikçi seçimin fiyatı ve teslim süresini değiştirir.') }),
  batarya: () => ({ baslik: t('Batarya'), metin: t('Depolanan elektrik (kWh). Şarj üniteleri buradan besleniyor. Güneş paneli gündüz doldurur, jeneratör dizelden üretir, şebeke sürekli akıtır.') }),
  seri: () => ({ baslik: t('Giriş Serisi'), metin: t('Üst üste kaç gün girdiğin. Seri uzadıkça günlük giriş bonusu büyür (₺500\'den ₺2.000\'e kadar). Bir gün atlarsan sıfırlanır.') }),
  isik: () => ({ baslik: t('Işık'), metin: t('Gece aydınlatman. Sokak lambası ve tabela seviyesi arttıkça gece müşteri akışı ve itibar artar.') }),
  // ORTA OYUN REHBERİ: "yıldızım kaç, sıradaki için ne gerek, o yıldız neyi açar, şube
  // nerede ve kaça" — dördünün de cevabı tek dokunuşta (bkz. rehberBilgiMetni).
  marka: () => ({ baslik: t('Marka Yıldızı'), metin: rehberBilgiMetni() }),
}
{
  const kutu = document.getElementById('chipinfo')
  const kapat = () => kutu?.classList.remove('show')
  document.addEventListener('click', e => {
    const chip = (e.target as HTMLElement).closest?.('.chip[data-bilgi]') as HTMLElement | null
    if (!chip || !kutu) { kapat(); return }
    e.stopPropagation()
    const veri = CHIP_BILGI[chip.dataset.bilgi!]?.()
    if (!veri) return
    kutu.innerHTML = `<b>${veri.baslik}</b>${veri.metin}`
    kutu.classList.add('show')
    // konum: chip'in altında, ekran içinde kelepçeli
    const r = chip.getBoundingClientRect()
    const k = kutu.getBoundingClientRect()
    kutu.style.left = `${Math.max(8, Math.min(r.left, window.innerWidth - k.width - 8))}px`
    kutu.style.top = `${Math.min(r.bottom + 8, window.innerHeight - k.height - 8)}px`
  })
}
// ═══════════════ ORTA OYUN REHBERİ — MARKA YILDIZI & ŞUBE YOLU ═══════════════
//
// KÖK NEDEN (açık geri bildirim taraması): "öğrenilebilirlik" sanılan kayıtların en
// büyük kümesi ilk dakikalar DEĞİL, orta oyun. 7 kayıt doğrudan "marka yıldızı / yeni
// şube nasıl açılır" diye soruyor (#1003 #1144 #1174 #1257 #1258 #653 #1264). #1264
// "yapacak bir şey kalmadı" diyor — oysa şube sistemi orada duruyor, oyuncu GÖREMİYOR.
//
// Bilgi eksik değildi, GÖRÜNÜR değildi: Ofis › Şubeler panelinin içinde, oyuncunun
// aramayı bilmesi gereken bir yerde duruyordu. Üç katman ekliyoruz, hepsi state.rehber()
// diye TEK kaynaktan okuyor (üç ayrı hesap = birbirini tutmayan üç metin):
//   1) HUD rozeti      — yıldız + sıradaki yıldıza yüzde, her an ekranda
//   2) Bilgi kutusu    — rozete dokununca: kaç kaldı, hangi şube açılacak, nereye gidilir
//   3) Proaktif toast  — oyuncu TIKANDIĞI anda kendiliğinden gelir, araması gerekmez
//
// Yeni sistem icat edilmedi: HUD bilgi kutuları (data-bilgi) ve toast zaten vardı.
const trY = (n: number) => Math.round(n).toLocaleString('tr-TR')

/** Rehberin şube satırını insan cümlesine çevirir: "Otoyol · 6★ · ₺2.000.000" */
function rehberSubeMetni(s: { name: string; stars: number; cash: number }): string {
  return `${s.name} · ${s.stars}★ · ₺${trY(s.cash)}`
}
/** Sıradaki yıldızın SOMUT karşılığı: "→ Otoyol şubesi açılır." */
function rehberYildizOdulu(r: ReturnType<GameState['rehber']>): string {
  const s = r.yildizAcar.length
    ? t('→ {0} şubesi açılır', r.yildizAcar.map(x => x.name).join(', '))
    : t('→ gelir çarpanın ve müşteri akışın kalıcı büyür')
  // Nokta kodda ekleniyor: bu parça hem cümle SONUNDA (HUD şeridi) hem cümle ORTASINDA
  // (bilgi kutusu, bildirim) kullanılıyor. Noktasız hâlinde iki cümle birbirine
  // yapışıyordu ("…kalıcı büyür Eşik ŞİRKETİN TAMAMINA bakar") — ekran görüntüsünde görüldü.
  return s + '.'
}

/**
 * ŞUBELER PANELİNİN TEPE ŞERİDİ — tek bakışta yol haritası:
 *   "3★ · sıradaki yıldıza ₺420.000 kaldı → Otoyol şubesi açılır"
 * Panelin altında zaten detaylı kartlar var; bu şerit oyuncunun aramadan görmesi
 * gereken TEK cümleyi en üste alır ve sıradaki EYLEMİ adıyla söyler.
 */
function rehberSeridi(): string {
  const r = state.rehber()
  const hedefSat = r.acilabilir.length
    ? `<div class="rh-do good">${t('ŞİMDİ AÇABİLİRSİN: {0}', r.acilabilir.map(rehberSubeMetni).join(' · '))}</div>`
    : r.hedef
      ? `<div class="rh-do">${r.hedef.starsLeft > 0
          ? t('Sıradaki şube: {0} — {1} yıldız daha', rehberSubeMetni(r.hedef), String(r.hedef.starsLeft))
          : t('Sıradaki şube: {0} — ₺{1} daha biriktir', rehberSubeMetni(r.hedef), trY(r.hedef.cashLeft))}</div>`
      : `<div class="rh-do">${t('Tüm şubeler açık — marka yıldızı biriktirmeye devam et.')}</div>`
  // ANA SATIR: yıldız · sıradaki yıldıza kalan · o yıldızın ne açacağı
  const ana = r.ready
    ? t('{0}★ · SIRADAKİ YILDIZ HAZIR {1}', String(r.stars), rehberYildizOdulu(r))
    : r.engel
      ? (r.engel === 'kredi'
          ? t('{0}★ · sıradaki yıldız kredin kapanana kadar bekliyor', String(r.stars))
          : t('{0}★ · sıradaki yıldız ortaklığın bitene kadar bekliyor', String(r.stars)))
      : t('{0}★ · sıradaki yıldıza ₺{1} kaldı {2}', String(r.stars), trY(r.remaining), rehberYildizOdulu(r))
  // #653 ÇIKIŞ YOLU: "yer kalmadı" hissindeki oyuncuya, arsası dolsa bile yolun açık
  // olduğunu ve nereden ilerleyeceğini yazar. Ölçüm: tek şubeye ₺1,96M kurulabiliyor,
  // eşik ise şube başına ₺1,5M — yol matematiksel olarak hiç tıkanmıyor.
  const cikis = r.yerDoldu
    ? `<div class="rh-out">${r.bosSube.length
        ? t('Arsan doldu diye tıkanmazsın: eşik ŞİRKETİN TAMAMINA bakar — {0} şubene kurduğun ekipman da bu çubuğu doldurur.', r.bosSube.map(id => themeFor(id).name).join(', '))
        : t('Arsan doldu diye tıkanmazsın: eşik ŞİRKETİN TAMAMINA bakar. Tavanı yükseltmenin yolu yeni şube açmak.')}</div>`
    : ''
  return `<div class="rh-strip"><div class="rh-main">${ana}</div>`
    + `<div class="pz-bar" style="margin:6px 0 5px"><div class="pz-fill" style="width:${r.ready ? 100 : r.pct}%"></div></div>`
    + `<div class="rh-num">₺${trY(r.equip)} / ₺${trY(r.threshold)} · %${r.pct}</div>`
    + hedefSat + cikis + `</div>`
}

/** HUD marka rozeti: yıldız sayısı + sıradaki yıldıza kalan yüzde. */
function markaRozetiniTazele() {
  const chip = document.getElementById('markachip')
  if (!chip) return
  const r = state.rehber()
  // NE ZAMAN GÖRÜNÜR: marka yıldızı ORTA OYUNUN konusu. 1. günün oyuncusunda HUD'ı
  // kalabalıklaştırmak yerine sistem anlam kazanınca açılır — yıldızı varsa, eşiğin
  // dörtte birine geldiyse ya da zaten ikinci şubesi varsa.
  const gorunur = r.stars > 0 || r.pct >= 25 || state.unlockedLocs.length > 1
  const disp = gorunur ? 'flex' : 'none'
  if (chip.style.display !== disp) chip.style.display = disp
  if (!gorunur) return
  const st = document.getElementById('hud-marka-st')
  const pct = document.getElementById('hud-marka-pct')
  const fill = document.getElementById('hud-marka-fill')
  const stTx = `${r.stars}★`
  // DEVİR HAZIRSA yüzde değil "HAZIR" yazar: %100 gördüğü hâlde ne yapacağını bilmeyen
  // oyuncu tam da bu raporun konusu (#653). Rozet eylemi söyler.
  const pctTx = r.ready ? t('HAZIR') : `%${r.pct}`
  if (st && st.textContent !== stTx) st.textContent = stTx
  if (pct && pct.textContent !== pctTx) pct.textContent = pctTx
  if (fill) fill.style.width = `${r.ready ? 100 : r.pct}%`
  chip.classList.toggle('marka-hazir', r.ready)
}

/** Rozete dokununca çıkan bilgi kutusunun gövdesi — dört sorunun da cevabı. */
function rehberBilgiMetni(): string {
  const r = state.rehber()
  const sat: string[] = []
  sat.push(t('Marka yıldızı KALICI güçtür: her yıldız gelir çarpanını, müşteri akışını ve devir sonrası kuruluş sermayeni büyütür. Yıldızlar hiç kaybolmaz.'))
  if (r.ready) {
    sat.push(t('ŞU AN {0}. yıldızı alabilirsin. {1}', String(r.stars + 1), rehberYildizOdulu(r)))
    sat.push(t('Nereden: Ofis › Şubeler › Marka & Devir → “İstasyonu Devret”.'))
  } else if (r.engel) {
    sat.push(r.engel === 'kredi'
      ? t('Sıradaki yıldız BEKLİYOR: açık kredin var. Kredi kapanmadan istasyon devredilemez.')
      : t('Sıradaki yıldız BEKLİYOR: aktif ortaklığın var. Ortaklık bitmeden istasyon devredilemez.'))
  } else {
    sat.push(t('{0}. yıldıza kalan: ₺{1} kurulu ekipman (₺{2} / ₺{3}, %{4}). {5}',
      String(r.stars + 1), trY(r.remaining), trY(r.equip), trY(r.threshold), String(r.pct), rehberYildizOdulu(r)))
    // ÇIKIŞ YOLU (#653 "yer kalmadı"): eşik ŞİRKET GENELİ ekipmana bakar. Arsası dolan
    // oyuncu tıkanmaz — başka şubesine kurduğu ekipman da bu barı doldurur.
    sat.push(t('Eşik ŞİRKETİN TAMAMINA bakar: başka şubene kurduğun ekipman da bu çubuğu doldurur. Arsan doldu diye tıkanmazsın.'))
  }
  if (r.acilabilir.length) {
    sat.push(t('ŞİMDİ AÇABİLECEĞİN ŞUBE: {0}. Ofis › Şubeler’den aç.',
      r.acilabilir.map(rehberSubeMetni).join(' · ')))
  } else if (r.hedef) {
    sat.push(r.hedef.starsLeft > 0
      ? t('Sıradaki şube: {0} — {1} yıldız daha gerekiyor.', rehberSubeMetni(r.hedef), String(r.hedef.starsLeft))
      : t('Sıradaki şube: {0} — ₺{1} daha biriktir.', rehberSubeMetni(r.hedef), trY(r.hedef.cashLeft)))
  } else {
    sat.push(t('Tüm şubeler açık — marka yıldızı biriktirmeye devam et.'))
  }
  return sat.join(' ')
}

// ---- PROAKTİF BİLDİRİM: oyuncu TIKANDIĞI anda haber gelir, araması gerekmez ----
// Durum localStorage'da tutulur (öğreticiyle aynı desen) — oyun KAYDINA yazılmaz, yani
// save şeması ve sunucu doğrulaması etkilenmez. Her kilometre taşı BİR KEZ duyurulur:
// tekrar eden toast bilgi değil gürültüdür.
const REHBER_KEY = 'benzinlik-rehber'
function rehberGorulen(): Set<string> {
  try { return new Set(JSON.parse(localStorage.getItem(REHBER_KEY) || '[]') as string[]) } catch { return new Set() }
}
function rehberDuyur(anahtar: string, mesaj: string, kind: 'good' | 'bad' | '' = 'good'): boolean {
  // Vitrin/promo modu SESSİZ olmalı (pazarlama ekran görüntüsü toast'la kirlenmesin).
  // Guard tek noktada: her çağrı yerine ayrı ayrı koymak birini unutmaya davetiye.
  if (isFullMode || isPromoMode) return false
  const g = rehberGorulen()
  if (g.has(anahtar)) return false
  g.add(anahtar)
  // son 60 kilometre taşı yeter (liste sonsuz büyümesin)
  try { localStorage.setItem(REHBER_KEY, JSON.stringify([...g].slice(-60))) } catch { /* kota */ }
  ui.toast(mesaj, kind, true) // yapışkan: mesaj kutusuna düşsün, oyuncu sonra tekrar okusun
  return true
}
/**
 * Rehber nabzı — birkaç saniyede bir bakar, DURUM DEĞİŞTİYSE tek bir toast atar.
 * Sıralama önemlidir: en eyleme dönük olan önce (aynı karede iki toast atmayız).
 */
let rehberT = 3 // saniye: rozet/bildirim nabzı (frame içinden sürülür)
function rehberNabiz() {
  if (isFullMode || isPromoMode || state.day < 2) return
  const r = state.rehber()
  // 1) DEVRE HAZIR — yıldızın kendisi burada kazanılıyor, en yüksek öncelik
  if (r.ready && rehberDuyur(`hazir:${r.stars}`,
    t('{0}. MARKA YILDIZI HAZIR: istasyonu devredebilirsin. {1} Ofis › Şubeler › Marka & Devir.',
      String(r.stars + 1), rehberYildizOdulu(r)))) return
  // 2) ŞUBE ALINABİLİR HÂLE GELDİ — "yeni şube nasıl açılır" sorusunun cevabı, sorulmadan
  for (const s of r.acilabilir) {
    if (rehberDuyur(`sube:${s.id}:${r.stars}`,
      t('YENİ ŞUBE AÇABİLİRSİN: {0} · ₺{1}. Ofis › Şubeler’den aç — ikinci istasyon ikinci gelir demek.',
        s.name, trY(s.cash)))) return
  }
  // 3) YER KALMADI HİSSİ (#653): eşik şube tavanında, yeni şube de alınamıyor. Oyuncu
  //    tıkandığını sanır. ÖLÇÜLDÜ (bkz. rehber-check): yol matematiksel olarak HİÇ
  //    tıkanmaz — tek şubeye kurulabilen tavan ₺1.96M, eşik ise şube başına ₺1.5M.
  //    Yani eksik olan yer değil, BİLGİ: eşik şirketin tamamına bakar ve pasif şubeye
  //    kurulan ekipman da sayar. İki somut çıkışı da adıyla yazıyoruz.
  if (r.yerDoldu) {
    const bos = r.bosSube.map(id => themeFor(id).name).join(', ')
    const hedefTx = r.hedef && r.hedef.starsLeft === 0
      ? ' ' + t('Ya da {0} şubesini aç: ₺{1} daha gerekiyor.', r.hedef.name, trY(r.hedef.cashLeft))
      : ''
    if (rehberDuyur(`yer:${r.stars}`, (bos
      ? t('Arsan doldu diye tıkanmadın: yıldız eşiği ŞİRKETİN TAMAMINA bakar — {0} şubene kurduğun ekipman da sayar (₺{1} kaldı).', bos, trY(r.remaining))
      : t('Arsan doldu diye tıkanmadın: yıldız eşiği ŞİRKETİN TAMAMINA bakar (₺{0} kaldı). Tavanı yükseltmenin yolu yeni şube açmak.', trY(r.remaining))
      ) + hedefTx, '')) return
  }
  // 4) EŞİĞE YAKLAŞTIN — hedefi görünür tutar ("son düzlük" bilgisi kararı hızlandırır)
  if (!r.ready && !r.engel && r.pct >= 80 && rehberDuyur(`yakin:${r.stars}`,
    t('Sıradaki marka yıldızına ₺{0} kaldı ({1}). {2}', trY(r.remaining), `%${r.pct}`, rehberYildizOdulu(r)), '')) return
}

// TEDARİKÇİ SEÇİMİ (#1067 "akaryakıt alımı için birkaç farklı marka satıcı olabilir"):
// gerçek marka adı kullanılmıyor (ticari marka) — kurgusal üç dağıtımcı, hız/fiyat takası.
document.getElementById('supplierrow')?.addEventListener('click', e => {
  const b = (e.target as HTMLElement).closest('button[data-sup]') as HTMLButtonElement | null
  if (!b) return
  const id = b.dataset.sup as keyof typeof SUPPLIERS
  if (!SUPPLIERS[id] || state.supplier === id) return
  state.supplier = id
  ui.toast(t('Tedarikçi: {0}', t(SUPPLIERS[id].label)), 'good')
  persist()
})

// HIZLI ŞUBE GEÇİŞİ (#1038 "ANASAYFADA MAPLER ARASINDA HIZLI GEÇİŞ OLSA SÜPER OLUR"):
// şube değiştirmek için Ofis › Şubeler'e girmek gerekiyordu. Artık HUD'dan tek dokunuş.
function subeMenusunuCiz() {
  const m = document.getElementById('locmenu')
  const btn = document.getElementById('locbtn')
  if (!m || !btn) return
  subeEtiketiniTazele() // kayıt sonrası ilk açılışta doğru şube adını yakalar
  const kasa = state.branchVaultTotal()
  m.innerHTML = state.unlockedLocs.map(id => {
    const th = themeFor(id)
    const aktif = id === state.activeLoc
    const kasaTutar = aktif ? 0 : Math.round(state.branchVault[id] ?? 0)
    const alt = aktif ? t('şu an buradasın')
      : kasaTutar > 0 ? t('kasada ₺{0} birikti', kasaTutar.toLocaleString('tr-TR'))
      : t('müdür kasası boş')
    return `<button data-qloc="${id}" class="${aktif ? 'cur' : ''}"${aktif ? ' disabled' : ''}>`
      + `<svg class="ic"><use href="#i-map"/></svg>`
      + `<span class="lm-tx">${th?.name ?? id}<span class="lm-sub">${alt}</span></span></button>`
  }).join('')
    // ŞUBE AĞI HARİTASI: bu menü "hangi şubedeyim"i çözüyor, harita "sıradaki para nereye"yi.
    + `<button data-qloc="__harita"><svg class="ic"><use href="#i-map"/></svg>`
      + `<span class="lm-tx">${t('Şube ağı haritası')}<span class="lm-sub">${t('bedeller, kişilikler, ortak hatlar')}</span></span></button>`
    // ŞUBE ÇİFTLEME: tavan 5 değil ALL_LOCS (5 taban + 4 kopya) — "yeni şube aç" bağlantısı
    // hepsi açılana kadar görünür kalır.
    + (state.unlockedLocs.length < ALL_LOCS.length
      ? `<button data-qloc="__ofis"><svg class="ic"><use href="#i-office"/></svg>`
        + `<span class="lm-tx">${t('Yeni şube aç…')}<span class="lm-sub">${t('Ofis › Şubeler')}</span></span></button>`
      : '')
  const r = btn.getBoundingClientRect()
  m.style.left = `${Math.max(8, Math.min(r.left, window.innerWidth - 240))}px`
  m.style.top = `${r.bottom + 8}px`
  if (kasa > 0) { /* kasa rozeti ayrı gösterilmiyor; alt satırlar zaten yazıyor */ }
}
/**
 * HUD butonundaki şube adı.
 *
 * BUG (çiftlemeyle ortaya çıktı, aslında eskiden beri var): bu satır MODÜL YÜKLENİRKEN
 * bir kez çalışıyordu — kayıt ise çok daha sonra uygulanıyor. Yani etiket her zaman
 * varsayılan şubeyi ("Kasaba") yazıyordu. Tek şubeli oyuncuda göze batmıyordu; artık
 * "Otoyol" ile "Otoyol II" aynı sahnede aynı görünüyor, oyuncunun HANGİ şubede olduğunu
 * yalnızca bu etiketten anlaması gerekiyor. Bu yüzden fonksiyona alındı ve kayıt
 * yüklendikten sonra + her şube menüsü açılışında tazeleniyor.
 */
function subeEtiketiniTazele() {
  const lbl = document.getElementById('loclabel')
  const ad = themeFor(state.activeLoc).name ?? state.activeLoc
  if (lbl && lbl.textContent !== ad) lbl.textContent = ad
}
subeEtiketiniTazele()
document.getElementById('locbtn')?.addEventListener('click', e => {
  e.stopPropagation()
  const m = document.getElementById('locmenu')
  if (!m) return
  if (m.classList.contains('show')) { m.classList.remove('show'); return }
  subeMenusunuCiz()
  m.classList.add('show')
})
document.getElementById('locmenu')?.addEventListener('click', e => {
  const b = (e.target as HTMLElement).closest('button[data-qloc]') as HTMLButtonElement | null
  if (!b) return
  const id = b.dataset.qloc!
  document.getElementById('locmenu')?.classList.remove('show')
  if (id === '__harita') { haritaAc(); return }
  if (id === '__ofis') { openSection('office'); document.querySelector<HTMLButtonElement>('#oftabs .tab[data-oftab="buyume"]')?.click(); return }
  subeyeGec(id as LocId)
})
// ŞUBE AĞI HARİTASI — iki giriş noktası: Ofis › Şubeler'in başındaki buton ve HUD şube menüsü.
// Aksiyonlar MEVCUT akışa bağlı: açma → subeAcIslemi (state.unlockLoc), geçiş → subeyeGec.
haritaKur({ state, onAc: id => subeAcIslemi(id), onGit: id => subeyeGec(id) })
document.getElementById('of-map')?.addEventListener('click', () => {
  document.getElementById('officewrap')?.classList.remove('show') // ofis sheet'i kapat (banka kalıbı)
  haritaAc()
})
document.addEventListener('click', () => document.getElementById('locmenu')?.classList.remove('show'))
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
/** 7 GÜNLÜK KÂR GRAFİĞİ — kütüphanesiz, saf DOM çubukları.
 *  Kâr `salesLog`'a gün sonunda yazılır; eski save'lerdeki kayıtlarda `profit` alanı yoktur
 *  (o günler "veri yok" olarak çizilir, sıfır sanılmasın diye soluk gösterilir). */
function sevenDayChart(): string {
  // Oyuncu raporu: "27. günü iki kere gösteriyor" — sözleşme (ihale) ödemeleri aynı
  // güne AYRI salesLog kaydı atıyor. Grafik gün bazında BİRLEŞTİRİR.
  const byDay = new Map<number, { day: number; rev: number; profit?: number }>()
  for (const e of state.salesLog) {
    const cur = byDay.get(e.day) ?? { day: e.day, rev: 0 }
    cur.rev += e.rev
    if (typeof e.profit === 'number') cur.profit = (cur.profit ?? 0) + e.profit
    byDay.set(e.day, cur)
  }
  const log = [...byDay.values()].sort((a, b) => a.day - b.day).slice(-7)
  if (log.length < 2) return `<div class="acc-note">${t('Grafik için en az 2 günlük veri gerekli.')}</div>`
  const vals = log.map(e => e.profit)
  const known = vals.filter((v): v is number => typeof v === 'number')
  if (!known.length) return ''
  const max = Math.max(1, ...known.map(Math.abs))
  const bars = log.map(e => {
    const v = e.profit
    if (typeof v !== 'number') {
      return `<div class="pchart-col" title="${t('Gün {0}: veri yok', e.day)}">`
        + `<div class="pchart-bar pchart-na" style="height:6%"></div>`
        + `<div class="pchart-day">${e.day}</div></div>`
    }
    const h = Math.max(4, Math.round(Math.abs(v) / max * 100))
    const cls = v >= 0 ? 'pchart-pos' : 'pchart-neg'
    return `<div class="pchart-col" title="${t('Gün {0}: ₺{1}', e.day, Math.round(v).toLocaleString('tr-TR'))}">`
      + `<div class="pchart-bar ${cls}" style="height:${h}%"></div>`
      + `<div class="pchart-day">${e.day}</div></div>`
  }).join('')
  const best = Math.max(...known), worst = Math.min(...known)
  return `<div class="acc-sub">${t('Son 7 günün kârı')}</div>`
    + `<div class="pchart">${bars}</div>`
    + `<div class="acc-note">${t('En iyi ₺{0} · en kötü ₺{1}',
        Math.round(best).toLocaleString('tr-TR'), Math.round(worst).toLocaleString('tr-TR'))}</div>`
}

/** #317 "karşı yakanın geliri ayrı görünsün" — bugünün cirosunun yaka dağılımı */
function sideSplitRow(): string {
  const n = Math.round(state.sideDaily.near), f = Math.round(state.sideDaily.far)
  if (n + f <= 0) return ''
  const pct = Math.round(f / (n + f) * 100)
  return `<div class="acc-sub">${t('Bugünkü ciro — yaka dağılımı')}</div>`
    + `<div class="acc-cols"><span class="acc-plabel">${t('Ana yaka')}</span>`
    + `<span class="v good">₺${n.toLocaleString('tr-TR')}</span><span class="v">${100 - pct}%</span></div>`
    + `<div class="acc-cols"><span class="acc-plabel">${t('Karşı yaka')}</span>`
    + `<span class="v good">₺${f.toLocaleString('tr-TR')}</span><span class="v">${pct}%</span></div>`
}

function openOfficePanel() {
  const card = buildingCard('office')
  const tl = (n: number) => Math.round(n).toLocaleString('tr-TR')
  const row = (k: string, v: string, cls = '') => `<div class="stat"><span class="k">${k}</span><span class="v ${cls}">${v}</span></div>`

  // ── TERSANE (yalnız marina) ──
  // Marina'nın tüm gelirleri pasifti; burası oyuncunun GERÇEKTEN karar verdiği yer:
  // kızak sınırlı, gelen her işi alamazsın, hangisini alacağın kâr/gün oranına bağlı.
  {
    const tab = document.querySelector<HTMLElement>('#oftabs .tab[data-oftab="tersane"]')
    const marinaMi = state.isMarina && state.refitCapacity() > 0
    if (tab) tab.style.display = marinaMi ? '' : 'none'
    if (marinaMi) {
      const cap = document.getElementById('of-refit-cap')
      if (cap) cap.innerHTML =
        row(t('Kızak kapasitesi'), `${state.refitJobs.length} / ${state.refitCapacity()}`,
          state.refitFree() > 0 ? 'good' : 'bad')
        + row(t('Teslim edilen iş'), String(state.refitDone))
        + row(t('Tersane kazancı'), `₺${tl(state.refitEarned)}`, 'good')
        + row(t('Sezon'), `${state.season().name} — ${t('kışın iş zirve yapar')}`)

      const off = document.getElementById('of-refit-offers')
      if (off) {
        off.innerHTML = state.refitOffers.length
          ? state.refitOffers.map((o, i) => {
              const k = (REFIT_KINDS as Record<string, { label: string }>)[o.kind]?.label ?? o.kind
              const gunluk = Math.round(o.ucret / o.gun)
              const alinabilir = state.refitFree() > 0
              return `<div class="stat"><span class="k">${k} · ${o.gun} ${t('gün')} · ₺${tl(gunluk)}/${t('gün')}</span>`
                + `<span class="v"><button class="btn ${alinabilir ? 'primary' : ''}" data-refit="${i}"`
                + `${alinabilir ? '' : ' disabled'} style="padding:5px 12px; font-size:13px">`
                + `₺${tl(o.ucret)} — ${alinabilir ? t('Kabul') : t('Kızak dolu')}</button></span></div>`
            }).join('')
          : `<div class="stat"><span class="k">${t('Şu an bekleyen iş yok — yeni işler gün başında gelir.')}</span></div>`
      }

      const jobs = document.getElementById('of-refit-jobs')
      if (jobs) {
        jobs.innerHTML = state.refitJobs.length
          ? state.refitJobs.map(j => {
              const k = (REFIT_KINDS as Record<string, { label: string }>)[j.kind]?.label ?? j.kind
              return row(k, `${j.daysLeft} ${t('gün kaldı')} · ₺${tl(j.fee)}`)
            }).join('')
          : `<div class="stat"><span class="k">${t('Kızaklar boş.')}</span></div>`
      }
    }
  }

  // 1) Finansal durum
  // Oğuz tanımları: Kasa = eldeki net · İşletme Sermayesi = tanktaki yakıt × satış
  // fiyatı (stok değeri) · Aktif = kasa + sermaye + inşaattan elde edilenler
  const wc = state.workingCapital()
  const fin = document.getElementById('of-financial')
  if (fin) fin.innerHTML =
    row(t('Aktif (varlık)'), `₺${tl(state.assets())}`, 'good')
    + row(t('İşletme Sermayesi (stok)'), `₺${tl(wc)}`)
    + row(t('Kasa'), `₺${tl(state.money)}`)
    + row(t('Günlük gider (yovmiye+OPEX+reklam)'), `₺${tl(state.dailyWages() + state.dailyOpex() + state.marketingBudget)}`, 'bad')
    // DÜN GERÇEKTE NE KESİLDİ (#74 #330 #983 #1140 #1220 "kasadan para eriyor"):
    // yukarıdaki satır bir TAHMİNDİR (ruhsat, kredi taksiti, ihale cezası, banka payı
    // yok). Aşağısı son gün dönüşünde kasadan çıkan GERÇEK kalemlerdir — oyuncunun
    // "para nereye gitti?" sorusunun tek dürüst cevabı.
    + (state.dayCosts.length
        ? row(t('Gün gideri dökümü (gerçekleşen)'), `₺${tl(state.dayCostTotal())}`, 'bad')
          + state.dayCosts.map(c => row(`· ${c.kind}`, `₺${tl(c.amount)}`, 'bad')).join('')
        : '')

  // 1a) PERSONEL — TOPLU İŞE ALIM (#1019 "toplu olarak sarjcı ve pompacı tutabilsek")
  // Tek tek her pompanın kartını açıp tıklamak 10 pompalı istasyonda 10 ayrı işlemdi.
  const stEl = document.getElementById('of-staff')
  if (stEl) {
    const bosPompa: number[] = []
    for (let i = 0; i < state.pumps; i++) if (!state.autoPumps.has(i)) bosPompa.push(i)
    const bosSarj: number[] = []
    for (let i = 0; i < state.evChargers; i++) if (!state.autoChargers.has(i)) bosSarj.push(i)
    const pMaliyet = bosPompa.length * POMPACI_HIRE
    const sMaliyet = bosSarj.length * EV_ATTENDANT_HIRE
    stEl.innerHTML =
      row(t('Pompacı'), `${state.autoPumps.size} / ${state.pumps}`)
      + row(t('Şarjcı'), `${state.autoChargers.size} / ${state.evChargers}`)
      + row(t('Günlük yovmiye'), `₺${tl(state.dailyWages())}`, 'bad')
      + `<div class="row" style="display:flex; gap:8px; margin-top:10px">`
      + `<button class="btn" id="of-hire-pumps" style="flex:1; justify-content:center"${bosPompa.length ? '' : ' disabled'}>`
      + `<svg class="ic"><use href="#i-fuel"/></svg><span>${bosPompa.length
          ? t('Tüm pompalara pompacı (₺{0})', tl(pMaliyet)) : t('Tüm pompalarda pompacı var')}</span></button>`
      + `</div>`
      + `<div class="row" style="display:flex; gap:8px; margin-top:8px">`
      + `<button class="btn" id="of-hire-chargers" style="flex:1; justify-content:center"${bosSarj.length ? '' : ' disabled'}>`
      + `<svg class="ic"><use href="#i-charger"/></svg><span>${state.evChargers === 0
          ? t('Önce DC şarj ünitesi kur') : bosSarj.length
          ? t('Tüm şarjlara şarjcı (₺{0})', tl(sMaliyet)) : t('Tüm şarjlarda şarjcı var')}</span></button>`
      + `</div>`
  }

  // 1b) GÖREVLER (#1004) ve KARİYER HEDEFLERİ (#1063)
  // Eskiden tek satırlık "15 müşteri" sayacıydı ve mobilde rozeti de gizliydi; oyuncular
  // "görev var gözüküyor ama yok gibi" diyordu. Artık günün üç görevi ilerleme çubuklu
  // listelenir, altında da sıradaki büyük hedefler durur ("amacım kalmadı" fixi).
  const qEl = document.getElementById('of-quests')
  if (qEl) {
    const qs = dailyQuests(state)
    qEl.innerHTML = qs.map(q => {
      const yuzde = Math.round(100 * q.have / q.need)
      return `<div class="qrow${q.done ? ' is-done' : ''}">`
        + `<svg class="ic"><use href="#${q.done ? 'i-check' : 'i-cal'}"/></svg>`
        + `<span class="qtxt"><span class="qlbl">${q.label}</span>`
        + `<span class="qbar"><i style="width:${yuzde}%"></i></span>`
        + `<span class="qnum">${q.have.toLocaleString('tr-TR')} / ${q.need.toLocaleString('tr-TR')}</span></span>`
        + `<span class="qrew">${q.done ? t('ALINDI') : `+₺${tl(q.reward)}`}</span></div>`
    }).join('')
      + `<div class="sd" style="padding:8px 2px 0; color:var(--muted); font-weight:700">`
      + `${t('Görevler her gün yenilenir. Ödül tamamlandığı anda kasaya geçer.')}</div>`
  }
  const gEl = document.getElementById('of-goals')
  if (gEl) {
    gEl.innerHTML = careerGoals(state).map(h => {
      const yuzde = Math.round(100 * h.have / h.need)
      return `<div class="qrow${h.done ? ' is-done' : ''}">`
        + `<svg class="ic"><use href="#${h.done ? 'i-check' : 'i-star'}"/></svg>`
        + `<span class="qtxt"><span class="qlbl">${h.label}</span>`
        + `<span class="qbar"><i style="width:${yuzde}%"></i></span>`
        + `<span class="qnum">${h.have.toLocaleString('tr-TR')} / ${h.need.toLocaleString('tr-TR')}</span></span></div>`
    }).join('')
  }

  // 2) Yakıt satış fiyatları (+/-)
  const pricesEl = document.getElementById('of-prices')
  if (pricesEl && card?.priceRows) {
    const flow = Math.round(state.priceDemandFactor() * 100)
    pricesEl.innerHTML = card.priceRows.map(r =>
      `<div class="prow"><span class="pl">${r.label}</span><span class="pc">${typeof r.cost === 'number' ? `alış ₺${r.cost}` : r.cost}</span>`
      + `<button class="btn pbtn" data-pf="${r.f}" data-pd="-0.5" ${r.canDown ? '' : 'disabled'}>−</button>`
      + `<span class="pv">₺${r.price.toFixed(1)}</span>`
      + `<button class="btn pbtn" data-pf="${r.f}" data-pd="0.5" ${r.canUp ? '' : 'disabled'}>+</button></div>`).join('')
      // fiyat-akış bağı GÖRÜNÜR: +/- bastıkça bu satır canlı değişir ("fiyat bir şey değiştirmiyor" hissinin ilacı)
      + `<div class="sd" style="text-align:center; padding:7px 4px 3px; font-weight:800; color:${flow >= 100 ? 'var(--green-dark)' : flow >= 70 ? 'var(--orange-dark)' : 'var(--red)'}">`
      + `<svg class="ic" style="vertical-align:-3px"><use href="#i-user"/></svg> ${t('Bu fiyatlarla müşteri akışı')}: %${flow}</div>`
  }

  // 3) Müşteri & itibar
  const cust = document.getElementById('of-customer')
  if (cust) {
    const fx = Math.round((state.priceDemandFactor() - 1) * 100)
    const evx = Math.round((state.evPriceFactor() - 1) * 100)
    cust.innerHTML =
      row(t('Yakıt müşteri etkisi'), `${fx >= 0 ? '+' : ''}${fx}%`, fx >= 0 ? 'good' : 'bad')
      + (state.evChargers > 0 ? row(t('EV müşteri etkisi'), `${evx >= 0 ? '+' : ''}${evx}%`, evx >= 0 ? 'good' : 'bad') : '')
      + row(t('İtibar'), `${state.reputation.toFixed(1)} / 5`
          + (state.repTrend > 0 ? ' ▲' : state.repTrend < 0 ? ' ▼' : ''),
          state.repTrend > 0 ? 'good' : state.repTrend < 0 ? 'bad' : '')
      // #1025: itibar gün sonunda BUGÜNÜN kayıp oranına çekilir; kayıpsız oynayanda
      // hedef zaten 5.0 olduğu için değer kıpırdamıyor ve sebebi hiçbir yerde yazmıyordu
      + (() => {
          const r = state.repToday()
          const toplam = r.served + r.lost
          const oran = toplam > 0 ? Math.round(100 * r.lost / toplam) : 0
          return row(t('Bugün servis / kaçan'), `${r.served} / ${r.lost}${toplam >= 3 ? ` (%${oran})` : ''}`,
              r.lost === 0 ? 'good' : oran > 10 ? 'bad' : '')
            + row(t('Gün sonu itibar hedefi'), r.target.toFixed(1),
                r.target > state.reputation + 0.05 ? 'good' : r.target < state.reputation - 0.05 ? 'bad' : '')
            + (toplam < 3
                ? `<div class="sd" style="padding:6px 2px; color:var(--muted); font-weight:700">${t('Bugün neredeyse hiç müşteri görmedin — itibar yavaşça 3.0\'a doğru aşınır.')}</div>`
                : r.lost === 0
                ? `<div class="sd" style="padding:6px 2px; color:var(--muted); font-weight:700">${t('Kayıpsız gün: itibar 5.0\'a doğru gidiyor. Düşmesi için müşteri kaçırman gerekir.')}</div>`
                : '')
        })()
      // §6.2 kasaba imzası: müdavim payı yalnız mekaniğin açık olduğu şubede görünür
      + (state.regularsShare() > 0
          ? row(t('Müdavim müşteri'), `%${Math.round(state.regularsShare() * 100)}`, 'good')
          : '')
      // Katman 4d: rakip varsa pazar payı ve rakip fiyatı görünür — fiyat kararının aynası
      + (state.rival
          ? row(t('Pazar payın'), shareLabel(state.marketShare()),
              state.marketShare() >= 0.55 ? 'good' : state.marketShare() < 0.45 ? 'bad' : '')
            + row(state.rivalName(), `₺${state.rival.price.toFixed(2)}/L`
                + (state.rival.promoDays > 0 ? t(' · kampanyada') : ''),
                state.rival.price < state.prices.benzin ? 'bad' : 'good')
          : '')
      + row(t('Toplam müşteri'), `${state.stats.served}`, 'good')
      + row(t('Kaçan müşteri'), `${state.stats.lost}`, state.stats.lost > state.stats.served / 4 ? 'bad' : '')
  }

  // 3y) SIRALAMA + SEZON (Katman 4c)
  // Sezon (Fiyat sekmesi): piyasa kararlarının bağlamı
  const sel = document.getElementById('of-season')
  if (sel) {
    const se = state.season()
    sel.innerHTML = row(t('Sezon'), `${se.name} (${se.dayInSeason}/${se.length})`, se.traffic >= 1.1 ? 'good' : se.traffic < 0.9 ? 'bad' : '')
      + row(t('Sezon trafiği'), `×${se.traffic.toFixed(2)}`, se.traffic >= 1.1 ? 'good' : se.traffic < 0.9 ? 'bad' : '')
  }

  // SIRALAMA — TAMAMEN ANONİM (KVKK): sunucu isim döndürmüyor, satırlar "Oyuncu #N".
  // Yalnız KENDİ satırın `me` işaretiyle geliyor ve "SEN" olarak vurgulanıyor.
  const lb = document.getElementById('of-leaderboard')
  if (lb) {
    lb.innerHTML = `<div class="sd" style="padding:4px">${t('Sıralama yükleniyor…')}</div>`
      + `<div id="lb-rows"></div>`
      + `<div class="acc-note">${t('Sıralama anonimdir — kimsenin istasyon adı gösterilmez.')}</div>`
    if (!lbLoading) {
      lbLoading = true
      fetch('/api/leaderboard', { headers: { 'x-auth': localStorage.getItem('benzinlik-token') ?? '' } })
        .then(r => r.json()).then(d => {
        const el = document.getElementById('lb-rows')
        if (!el || !Array.isArray(d.top)) return
        el.previousElementSibling?.remove()
        el.innerHTML = d.top.slice(0, 10).map((x: { rank: number; money: number; day: number; stars: number; me?: boolean }) =>
          `<div class="stat"><span class="k${x.me ? ' lb-me' : ''}">${x.rank}. `
          + `${x.me ? t('SEN') : t('Oyuncu #{0}', String(x.rank))}`
          + `${x.stars > 0 ? ` <span class="lb-star">${'★'.repeat(Math.min(5, x.stars))}</span>` : ''}</span>`
          + `<span class="v ${x.me ? 'good' : ''}">₺${Math.round(x.money).toLocaleString('tr-TR')} · ${t('G{0}', String(x.day))}</span></div>`).join('')
      }).catch(() => {
        const el = document.getElementById('lb-rows'); if (el) el.textContent = t('Sıralama alınamadı.')
      }).finally(() => { lbLoading = false })
    }
  }

  // 3z) ŞUBELER: aktif şube + açık şubeler arası geçiş + yeni şube açma (büyük SINK)
  const lel = document.getElementById('of-locations')
  if (lel) {
    // ŞUBE ÇİFTLEME: her taban şubenin hemen ALTINDA kendi kopyası listelenir
    // (Otoyol → Otoyol II). Kopya satırı YALNIZ tabanı açıkken görünür: kilitli
    // tabanın altında ikinci bir kilit göstermek paneli gürültüye çevirirdi.
    const order: LocId[] = ALL_LOCS
      .filter(id => !isCopyLoc(id) || state.unlockedLocs.includes(baseLoc(id)))
      .sort((a, b) => {
        const ai = ALL_LOCS.indexOf(baseLoc(a)), bi = ALL_LOCS.indexOf(baseLoc(b))
        return ai !== bi ? ai - bi : (isCopyLoc(a) ? 1 : 0) - (isCopyLoc(b) ? 1 : 0)
      })
    const vaultTotal = state.branchVaultTotal()
    // YOL HARİTASI EN ÜSTTE: yıldız · kalan · o yıldızın açacağı şube. Aşağıdaki kartlar
    // detayı zaten veriyordu ama oyuncu detayı okumadan önce YÖNÜ görmeli (#1264
    // "yapacak bir şey kalmadı" — oysa yol buradaydı, sadece görünmüyordu).
    let head = rehberSeridi()
    // ---- MÜDÜR (Oğuz: "müdür tutmayı ofise koyalım") — bu şubenin müdürü buradan ----
    {
      const mL = state.managerLevel
      const mLocked = mL === 0 && state.pendingCapTotal() < 1200
      const btn = mL >= 3 ? `<span class="pc">${t('MAKS')} · Sv.3</span>`
        : mLocked ? `<span class="pc" style="color:var(--muted)">${t('Önce gelir getiren tesisler kur')}</span>`
        : `<button class="btn sbuy good" id="of-hire-manager">${mL === 0 ? t('Müdür Tut') : t('Yükselt')} · ₺${tl(MANAGER_COSTS[mL])}</button>`
      const fireBtn = mL > 0 ? `<button class="btn sbuy" id="of-fire-manager" style="color:var(--red-dark)">${t('İşten Çıkar')}</button>` : ''
      head += `<div class="prow" style="flex-wrap:wrap"><span class="pl"><svg class="ic" style="vertical-align:-3px"><use href="#i-gear"/></svg> <b>${mL === 0 ? t('Müdür') : t('Müdür Sv.{0}', String(mL))}</b>${mL > 0 ? ` <span style="color:var(--muted);font-weight:650">· ${t('yovmiye ₺{0}/gün', String(MANAGER_WAGES[mL]))}</span>` : ''}</span>${btn}${fireBtn}`
        + `<div style="flex:1 0 100%;font-size:11.5px;font-weight:650;color:var(--muted);margin-top:3px">${t('45 sn’de bir tur: kumbaraları toplar + azalan tanklara yakıt siparişi verir; Sv.2 panel temizler; Sv.3 arıza tamir eder ve YAKIT İNDİRİMİ fırsatında tankları fulller. Sen başka şubedeyken şubeyi işletir — günlük net kazancı kasana otomatik yazılır.')}</div></div>`
      // ── MÜDÜR TALİMATLARI (#1145 "müdürün ne yapabileceğine biz karar vermeliyiz") ──
      if (mL > 0) {
        const pol = state.managerPolicy
        const anahtar = (k: string, etiket: string, acik: boolean, kilit = false) =>
          `<button class="btn mp-t${acik ? ' good' : ''}" data-mpol="${k}"${kilit ? ' disabled' : ''} `
          + `style="font-size:11px;padding:5px 9px;opacity:${kilit ? .45 : 1}">${acik ? '✓' : '○'} ${etiket}</button>`
        const esik = (v: number) =>
          `<button class="btn mp-t${pol.fuelAt === v ? ' good' : ''}" data-mpfuel="${v}" `
          + `style="font-size:11px;padding:5px 9px;min-width:42px">%${Math.round(v * 100)}</button>`
        head += `<div class="prow" style="flex-wrap:wrap; gap:5px; padding-top:2px">`
          + `<span class="pl" style="flex:1 0 100%; font-size:11.5px; color:var(--muted); font-weight:700">`
          + `${t('MÜDÜRE TALİMAT — neyi yapsın, ne zaman sipariş versin')}</span>`
          + anahtar('collect', t('Kumbara topla'), pol.collect)
          + anahtar('orderFuel', t('Yakıt sipariş et'), pol.orderFuel)
          + anahtar('cleanSolar', t('Panel temizle'), pol.cleanSolar, mL < 2)
          + anahtar('fixBroken', t('Arıza tamir et'), pol.fixBroken, mL < 3)
          + anahtar('buyUranium', t('Uranyum al'), pol.buyUranium, mL < 3)
          + anahtar('grabPromo', t('İndirimde stokla'), pol.grabPromo, mL < 3)
          + `<span style="flex:1 0 100%; font-size:11px; color:var(--muted); font-weight:700; margin-top:4px">`
          + `${t('Tank şu orana düşünce sipariş versin:')}</span>`
          + esik(0.10) + esik(0.20) + esik(0.35) + esik(0.50)
          + anahtar('fuelFull', pol.fuelFull ? t('Depoyu FULLE') : t('YARIM doldur'), pol.fuelFull)
          + `</div>`
      }
    }
    if (vaultTotal > 0) {
      // ESKİ HATA: burası `head =` idi ve ÜSTÜNDEKİ MÜDÜR BLOĞUNU siliyordu — yani
      // şube kasalarında para biriktiği anda "Müdür Tut" düğmesi ve müdür talimatları
      // panelden kayboluyordu. Tam da "şubemden para gelmiyor" diyen oyuncunun müdür
      // tutması gereken an. `+=` olmalı; artık yol haritası şeridi de üstte duruyor.
      head += `<div class="prow"><span class="pl"><b>${t('Şube kasalarında bekleyen')}</b></span>`
        + `<span class="pc">₺${tl(Math.round(vaultTotal))}</span>`
        + `<button class="btn sbuy good" id="of-collect-vaults">${t('Hepsini Topla')}</button></div>`
    }
    // PAYLAŞILAN TEDARİK HATTI UYARISI: kopya ile tabanı aynı depodan çekiyor. Oyuncu
    // kotayı GÖRMEDEN karar veremez — "neden kardeş şubem az kazandı?" sorusunun cevabı
    // burada, gün içinde, sayıyla duruyor.
    if (state.supplyLine()) {
      const kalan = Math.round(state.supplyRemaining())
      const dolu = Math.round(state.supplyFill() * 100)
      const kardes = state.unlockedLocs.find(l => l !== state.activeLoc && baseLoc(l) === state.supplyLine())
      head += `<div class="prow" style="flex-wrap:wrap"><span class="pl"><b>${t('Ortak tedarik hattı')}</b></span>`
        + `<span class="pc${dolu >= 50 ? ' bad' : ''}">${t('{0}L / {1}L kaldı', tl(kalan), tl(SUPPLY_LINE_QUOTA))}</span>`
        + `<div style="flex:1 0 100%;font-size:11.5px;font-weight:650;color:var(--muted);margin-top:3px">`
        + t('{0} ile {1} AYNI dağıtımcının bölge deposundan çekiyor. Bugün kotanın %{2}\'sini kullandın — hepsini burada harcarsan kardeş şube yarın aç kalır ve günlük neti düşer. Kota her gün dönüşünde tazelenir.',
            themeFor(state.activeLoc).name, kardes ? themeFor(kardes).name : themeFor(state.supplyLine()!).name, String(dolu))
        + `</div></div>`
    }
    lel.innerHTML = head + order.map(id => {
      const th = themeFor(id)
      const open = state.unlockedLocs.includes(id)
      const active = state.activeLoc === id
      // KOPYA ŞUBENİN KISIT ROZETİ: "ikinci nüsha aynısı değil" mesajı her satırda görünür
      const kisit = isCopyLoc(id)
        ? `<div style="flex:1 0 100%;font-size:11px;font-weight:700;color:var(--accent,#e8862e);margin-top:2px">⚑ ${BRANCH_COPIES[id].note}</div>`
        : ''
      if (active) {
        // AKTİF ŞUBE: müdür burada zaten anlık çalışıyor, kasa biriktirmez
        return `<div class="prow" style="flex-wrap:wrap"><span class="pl">`
          + `<svg class="ic" style="vertical-align:-3px"><use href="#i-map"/></svg> ${th.name}</span>`
          + `<span class="pc good">${t('AKTİF')}</span>${kisit}</div>`
      }
      if (open) {
        // PASİF ŞUBE: müdür var mı, günlük net ne, kasada ne birikti
        const d = state.branchNetPerDay(id)
        const vault = Math.round(state.branchVault[id] ?? 0) // eski birikim (göç bekliyor) — varsa Topla butonu görünür
        const note = d.level > 0
          ? t('Müdür Sv.{0} · günlük net ₺{1} — her gün dönüşünde kasana OTOMATİK eklenir',
              String(d.level), tl(d.net))
          // MÜDÜRSÜZ ŞUBE: kaybın SAYIYLA gösterilir. "2. şubemden para gelmiyor" diyen
          // oyuncuların çoğu müdür tutmamıştı; panel sebebi yazıyordu ama bedelini değil.
          : (() => {
              const tahmin = state.branchNetPerDay(id, 1)   // Sv.1 müdürle ne kazanırdı
              return tahmin.net > 0
                ? t('Müdür YOK — bu şube HİÇ kazanmıyor. Sv.1 müdür tutsan günlük ~₺{0} gelirdi (yovmiye düşülmüş). Şubeye git → Ofis › Şubeler.', tl(tahmin.net))
                : t('Müdür YOK — şube kapalı duruyor. Şubeye git, Ofis içindeki Şubeler sekmesinden müdür tut.')
            })()
        return `<div class="prow" style="flex-wrap:wrap"><span class="pl">${th.name}</span>`
          + (vault > 0 ? `<button class="btn sbuy good" data-collectloc="${id}">${t('Topla ₺{0}', tl(vault))}</button>` : '')
          + `<button class="btn sbuy" data-goloc="${id}">${t('Şubeye Git')}</button>`
          + `<div style="flex:1 0 100%;font-size:11.5px;font-weight:650;color:var(--muted);margin-top:3px">${note}</div>`
          + kisit
          + `</div>`
      }
      const c = state.canUnlockLoc(id)
      const note = c.reason === 'taban' ? t('Önce {0} şubesini aç', themeFor(baseLoc(id)).name)
        : c.reason === 'yildiz' ? t('{0} marka yıldızı gerekir', c.stars)
        : `₺${tl(c.cash)}`
      // D11 (analiz): "ne kadar kaldı" görünür hedef — kilitli şubede ilerleme çubuğu
      const pct = Math.min(100, Math.round((state.money / Math.max(1, c.cash)) * 100))
      // D13 (analiz): kilitli şubenin CANLI ÖNİZLEMESİ — merak yaratır ("marina vitrini")
      // kopya şubenin ayrı görseli YOK — tabanının vitrinini kullanır (aynı sahne)
      const thumb = `<div style="flex:1 0 100%;margin-top:6px"><img src="${asset(`/gen/loc-${baseLoc(id)}.jpg`)}?v=2" alt="" loading="lazy"`
        + `style="width:100%;max-height:110px;object-fit:cover;border-radius:8px;border:1.5px solid var(--edge);filter:saturate(.9)" `
        + `onerror="this.parentElement.style.display='none'"></div>`
      const prog = c.reason !== 'yildiz' && !c.ok
        ? `${thumb}<div style="flex:1 0 100%;margin-top:4px"><div class="pz-bar" style="height:6px"><div class="pz-fill" style="width:${pct}%"></div></div>`
          + `<div style="font-size:11px;font-weight:650;color:var(--muted);margin-top:2px">${t('₺{0} kaldı (%{1})', tl(Math.max(0, c.cash - state.money)), String(pct))}</div></div>`
        : thumb
      return `<div class="prow" style="flex-wrap:wrap"><span class="pl" style="color:var(--muted)">${th.name}</span>`
        + `<span class="pc">${note}</span>`
        + (c.ok ? `<button class="btn sbuy good" data-unlockloc="${id}">${t('Şube Aç')}</button>`
                : `<button class="btn sbuy" disabled>${t('Kilitli')}</button>`) + kisit + prog + `</div>`
    }).join('')
  }

  // 3a) PRESTİJ: marka yıldızı durumu + devir önizlemesi (rapor: önizleme ZORUNLU)
  const pel = document.getElementById('of-prestige')
  if (pel) {
    const pv = state.handoverPreview()
    // MARKA YILDIZI NEDİR? Oyuncular "yıldız" görüyor ama ne işe yaradığını anlamıyordu.
    // Artık üç soruyu da panel cevaplıyor: ne verir · nasıl kazanılır · ne kadar kaldı.
    const eq = state.companyEquipmentValue(), thr = state.handoverThreshold()
    const pct = Math.max(0, Math.min(100, Math.round(eq / Math.max(1, thr) * 100)))
    // KAZANÇ SATIRI: her eksen için "şimdi → devirden sonra". Belirsizlik prestiji öldürür;
    // oyuncu butona basmadan ÖNCE üç eksende ne kazanacağını sayıyla görmeli.
    const kz = (ad: string, val: string) => `<div class="pz-gline"><span>${ad}</span><b>${val}</b></div>`
    let html = `<div class="pz-card">`
      + `<div class="pz-top"><span class="pz-stars">${state.brandStars > 0 ? '★'.repeat(Math.min(10, state.brandStars)) : '☆'}</span>`
      + `<span class="pz-count">${t('{0} marka yıldızı', String(state.brandStars))}</span></div>`
      + `<div class="pz-what">${t('Marka yıldızı KALICI güçtür. Her devirde gelir çarpanın, müşteri akışın ve kuruluş sermayen büyür — sıfırdan başlarsın ama her turda daha hızlı. Yıldızlar hiç kaybolmaz.')}</div>`
      + `<div class="pz-now">${t('Şu anki kazancın')}: <b>×${pv.multNow.toFixed(2)}</b>`
      + (state.brandStars > 0 ? ` <span class="pz-gain">${t('(+%{0} her satıştan)', String(Math.round((pv.multNow - 1) * 100)))}</span>` : '')
      + (state.brandStars > 0 ? `<br>${t('Müşteri akışın')}: <b>×${pv.flowNow.toFixed(2)}</b>` : '')
      + `</div></div>`
      + (state.handoverCount > 0 ? row(t('Devredilen istasyon'), `${state.handoverCount}`) : '')

    if (state.canHandover()) {
      const kadroArtiyor = pv.crewAfter.manager > pv.crewNow.manager || pv.crewAfter.staff > pv.crewNow.staff
      html += `<div class="pz-ready">`
        + `<div class="pz-rtitle">${t('Devretmeye HAZIRSIN — {0}. marka yıldızı', String(pv.starsAfter))}</div>`
        + `<div class="pz-gains">`
        + kz(t('Kasana geçecek'), `+₺${tl(pv.total)}`)
        + (pv.seed > 0 ? kz(t('· kuruluş sermayesi'), `₺${tl(pv.seed)}`) : '')
        + kz(t('Gelir çarpanı'), `×${pv.multNow.toFixed(2)} → ×${pv.multAfter.toFixed(2)}`)
        + kz(t('Müşteri akışı'), `×${pv.flowNow.toFixed(2)} → ×${pv.flowAfter.toFixed(2)}`)
        + (kadroArtiyor
            ? kz(t('Devralacağın kadro'), `${t('Müdür Sv.{0}', String(pv.crewAfter.manager))} · ${t('Personel Sv.{0}', String(pv.crewAfter.staff))}`)
            : '')
        + `</div>`
        + `<span class="pz-fine">${t('Ekipman gider ama ARSALARIN VE BETONUN SENDE KALIR. Yeni istasyon kuruluş sermayesi ve eğitimli kadroyla açılır — aynı yolu baştan yürümezsin.')}</span>`
        + `</div><button class="btn warn" id="of-handover" style="width:100%;justify-content:center;margin-top:8px">`
        + (handoverArmed() ? t('EMİN MİSİN? Devretmek için tekrar bas') : t('İstasyonu Devret')) + `</button>`
    } else if (state.loan.active || state.partner.active) {
      html += `<div class="pz-lock">${t('Devir için önce kredi/ortaklık kapatılmalı.')}</div>`
    } else {
      // İLERLEME ÇUBUĞU: "ne kadar kaldı" sorusunun görsel cevabı
      // + HEDEF: sıradaki yıldızın ne getireceği burada da yazar (motivasyon eşik ÖNCESİNDE lazım).
      html += `<div class="pz-prog-head"><span>${t('Sonraki yıldıza')}</span>`
        + `<span class="pz-prog-num">₺${tl(eq)} / ₺${tl(thr)}</span></div>`
        + `<div class="pz-bar"><div class="pz-fill" style="width:${pct}%"></div></div>`
        + `<div class="pz-gains">`
        + kz(t('Gelir çarpanı'), `×${pv.multNow.toFixed(2)} → ×${pv.multAfter.toFixed(2)}`)
        + kz(t('Müşteri akışı'), `×${pv.flowNow.toFixed(2)} → ×${pv.flowAfter.toFixed(2)}`)
        + kz(t('· kuruluş sermayesi'), `₺${tl(GameState.prestigeSeedFor(pv.starsAfter))}`)
        + `</div>`
        + `<div class="pz-fine">${t('TÜM ŞUBELERİN kurulu ekipmanı ₺{0} değerine ulaşınca devir açılır — yeni şube donatmak da sayar. Eşik büyür ama şubelerine KURULABİLECEK toplamı asla aşmaz; tavana dayandıysa büyümesi için yeni şube açman gerekir.', tl(thr))}</div>`
    }
    pel.innerHTML = html
  }

  // 3b) B2B sözleşmeleri: aktif taahhüt durumu + imzalanabilir teklifler
  const cel = document.getElementById('of-contracts')
  if (cel) {
    const c = state.contract
    if (c) {
      const pct = Math.min(100, Math.round(c.deliveredToday / c.dailyLiters * 100))
      cel.innerHTML =
        `<div class="sd" style="font-weight:800;color:var(--ink);padding:2px 4px 6px">${c.name} · ${FUEL_LABEL[c.fuel]}</div>`
        + row(t('Günlük taahhüt'), `${Math.round(c.deliveredToday)} / ${c.dailyLiters} L (%${pct})`, pct >= 100 ? 'good' : 'bad')
        + row(t('Sözleşme fiyatı'), `₺${c.pricePerL}/L`)
        + row(t('Kalan gün'), `${c.daysLeft} / ${c.daysTotal}`)
        + row(t('Kaçırılan gün'), `${c.missedDays}`, c.missedDays > 0 ? 'bad' : '')
        + row(t('Tamamlama primi'), `₺${tl(c.bonus)}`, 'good')
        + row(t('Eksik gün cezası'), `₺${tl(c.penalty)}`, 'bad')
        + `<div class="sd" style="padding:4px 4px 0">${t('Filo sigortası: gün sonunda eksik kalan taahhüt, tankından otomatik tamamlanır — tankta yeterli yakıt tuttuğun sürece ceza YOK.')}</div>`
        // FESİH (oyuncu isteği ×2): ceza tuzağından çıkış — cayma bedeli 2 günlük ceza
        + `<button class="btn danger" id="of-cancel-contract" style="width:100%;justify-content:center;margin-top:8px">${t('Sözleşmeyi Feshet — cayma ₺{0} + itibar −0.2', tl(c.penalty * 2))}</button>`
    } else {
      const offers = state.contractOffers()
      if (!offers.length) {
        cel.innerHTML = `<div class="sd" style="padding:6px 4px">${t('Henüz sözleşme teklifi yok — teklifler DÜZENLİ sattığın yakıtlara gelir (son 7 günde günde 120L+ satış) ve deponun taahhüdün 2 katı olması gerekir.')}</div>`
      } else {
        cel.innerHTML = offers.map(o =>
          `<div class="prow" style="flex-wrap:wrap">`
          + `<span class="pl" style="flex:1 1 100%;font-weight:800">${o.name} · ${FUEL_LABEL[o.fuel]}</span>`
          + `<span class="pc" style="flex:1 1 100%">${t('{0} gün · günde {1}L · ₺{2}/L · prim ₺{3} · ceza ₺{4}', o.daysTotal, o.dailyLiters, o.pricePerL, tl(o.bonus), tl(o.penalty))}</span>`
          + `<span class="pc" style="flex:1 1 100%;color:var(--muted)">${t('Normal müşteri satışların taahhüde sayılır — tahmini günlük {0} satışın: ~{1}L', FUEL_LABEL[o.fuel], state.estDailySales(o.fuel))}</span>`
          + `<button class="btn sbuy good" data-sign="${o.id}" style="margin-top:4px">${t('İmzala')}</button></div>`).join('')
      }
    }
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
    html += sevenDayChart()
    html += sideSplitRow()
    sales.innerHTML = html
  }

  // 5) Yakıt alım geçmişi
  const hist = document.getElementById('of-history')
  if (hist) hist.innerHTML = accHistory()

  // İLK açılış ÖZET ile başlar; panel ZATEN AÇIKKEN yeniden çizim AKTİF SEKMEYİ KORUR.
  // (3 oyuncu raporu: fiyat değiştirince / Devret'e basınca "ana menüye atıyor" —
  //  devirde EMİN MİSİN butonu Özet'e dönüş yüzünden hiç görünmüyordu → sonsuz döngü.)
  const wasOpen = document.getElementById('officewrap')?.classList.contains('show') ?? false
  const keep = wasOpen
    ? ((document.querySelector('#oftabs .tab.active') as HTMLElement | null)?.dataset.oftab ?? 'ozet')
    : 'ozet'
  for (const t2 of document.querySelectorAll('#oftabs .tab')) t2.classList.toggle('active', (t2 as HTMLElement).dataset.oftab === keep)
  for (const pn of document.querySelectorAll<HTMLElement>('.ofpane')) pn.classList.toggle('is-on', pn.dataset.ofpane === keep)
  if (!wasOpen) { const ob = document.querySelector('#officewrap .mbody'); if (ob) ob.scrollTop = 0 }
  document.getElementById('officewrap')?.classList.add('show')
}
document.getElementById('of-toggle')?.addEventListener('click', () => { document.getElementById('closebtn')?.click(); openOfficePanel() })

// Ofis sekmeleri — mağaza modalıyla AYNI bileşen (.tabs/.tab). Panel tek uzun liste
// olarak taşacak kadar büyüdüğü için işe göre gruplandı: özet/fiyat/muhasebe/ihale/büyüme.
// TERSANE İŞ KABULÜ (delegasyon: panel her tazelemede yeniden çiziliyor)
document.getElementById('of-refit-offers')?.addEventListener('click', e => {
  const btn = (e.target as HTMLElement).closest<HTMLButtonElement>('[data-refit]')
  if (!btn) return
  const r = state.acceptRefit(Number(btn.dataset.refit))
  if (!r.ok) {
    ui.toast(r.reason === 'kapasite'
      ? t('Kızak dolu — önce bir iş teslim edilmeli.')
      : t('Bu iş artık yok.'), 'bad')
    return
  }
  audio.click?.()
  ui.toast(t('İş kızağa alındı.'), 'good')
  persist()
  openOfficePanel()
})

for (const tab of document.querySelectorAll<HTMLButtonElement>('#oftabs .tab')) {
  tab.addEventListener('click', () => {
    const id = tab.dataset.oftab
    for (const t2 of document.querySelectorAll('#oftabs .tab')) t2.classList.toggle('active', t2 === tab)
    for (const p of document.querySelectorAll<HTMLElement>('.ofpane')) p.classList.toggle('is-on', p.dataset.ofpane === id)
    const body = document.querySelector('#officewrap .mbody')
    if (body) body.scrollTop = 0   // yeni sekme baştan başlasın
  })
}

// Profil kartı: hero (istasyon+hesap) + istatistik/hesap bölümleri (ofis kartıyla aynı dil)
function renderProfile() {
  const tl = (n: number) => Math.round(n).toLocaleString('tr-TR')
  const row = (k: string, v: string, cls = '') => `<div class="stat"><span class="k">${k}</span><span class="v ${cls}">${v}</span></div>`
  const stEl = document.getElementById('pf-station'); if (stEl) stEl.textContent = state.stationName
  const emEl = document.getElementById('pf-email'); if (emEl) emEl.textContent = auth.currentEmail() ?? t('Misafir')
  const playH = state.day * 160 / 3600
  const stats = document.getElementById('pf-stats')
  if (stats) stats.innerHTML =
    row(t('Oyun günü'), `${state.day}`)
    + row(t('Oynama süresi'), playH >= 1 ? `${playH.toFixed(1)} sa` : `${Math.round(playH * 60)} dk`)
    + row(t('İtibar'), `${state.reputation.toFixed(1)} / 5`)
    + row(t('Toplam müşteri'), `${state.stats.served}`, 'good')
    + row(t('Kaçan müşteri'), `${state.stats.lost}`, state.stats.lost > state.stats.served / 4 ? 'bad' : '')
    + row(t('Toplam ciro'), `₺${tl(state.stats.revenue)}`, 'good')
  const acc = document.getElementById('pf-account')
  if (acc) acc.innerHTML =
    row(t('Giriş serisi'), `${state.loginStreak} gün`)
    + row(t('Başarımlar'), `${state.achievements.size} / 9`)
    + row(t('Günlük görev'), `${dailyQuests(state).filter(q => q.done).length}/3`)
    + `<div class="pf-synced"><svg class="ic" style="vertical-align:-3px"><use href="#i-cloud"/></svg> ${t('Kaydın buluta senkronlanıyor (10 sn)')}</div>`
}
// TOPLU PERSONEL ALIMI (#1019): parası yeten kadar alır, kalanı söyler
function topluIseAl(tur: 'pump' | 'charger') {
  const bedel = tur === 'pump' ? POMPACI_HIRE : EV_ATTENDANT_HIRE
  const kume = tur === 'pump' ? state.autoPumps : state.autoChargers
  const adet = tur === 'pump' ? state.pumps : state.evChargers
  let alinan = 0, atlanan = 0
  for (let i = 0; i < adet; i++) {
    if (kume.has(i)) continue
    if (state.money < bedel) { atlanan++; continue }
    state.money -= bedel
    kume.add(i)
    alinan++
  }
  if (alinan) {
    audio.build()
    ui.toast(tur === 'pump'
      ? t('{0} pompacı işe alındı (-₺{1})', String(alinan), (alinan * bedel).toLocaleString('tr-TR'))
      : t('{0} şarjcı işe alındı (-₺{1})', String(alinan), (alinan * bedel).toLocaleString('tr-TR')), 'good', true)
  }
  if (atlanan) ui.toast(t('{0} birim için para yetmedi — kasa dolunca tekrar dene.', String(atlanan)), 'bad')
  if (!alinan && !atlanan) ui.toast(t('Zaten hepsinde personel var.'), '')
  openOfficePanel()
  persist()
}
// butonlar her render'da yeniden yazılıyor → dinleyici SABİT kapsayıcıda (delegasyon)
document.getElementById('of-staff')?.addEventListener('click', e => {
  const el = e.target as HTMLElement
  if (el.closest('#of-hire-pumps')) topluIseAl('pump')
  else if (el.closest('#of-hire-chargers')) topluIseAl('charger')
})
document.getElementById('accbtn')?.addEventListener('click', renderProfile)
// GÖREV ROZETİ → Ofis › Görevler (mobilde rozet tek giriş kapısı)
document.getElementById('questchip')?.addEventListener('click', () => {
  openSection('office')
  document.querySelector<HTMLButtonElement>('#oftabs .tab[data-oftab="gorev"]')?.click()
})
// Ofis fiyat yönetimi butonları officewrap içinde de çalışsın (bina kartıyla aynı handler)
document.getElementById('of-prices')?.addEventListener('click', e => {
  const btn = (e.target as HTMLElement).closest('button[data-pf]') as HTMLButtonElement | null
  if (btn) ui.onPriceChange(btn.dataset.pf as FuelType | 'elec', Number(btn.dataset.pd))
})
// ŞUBE: geçiş ve açma
let locSwitching = false // şube geçişi başladı, reload bekleniyor (çift tıklama kilidi)
document.getElementById('of-locations')?.addEventListener('click', e => {
  // MÜDÜR TALİMATLARI: aç/kapa ve sipariş eşiği
  const mp = (e.target as HTMLElement).closest('[data-mpol]') as HTMLElement | null
  if (mp) {
    const k = mp.dataset.mpol as keyof typeof state.managerPolicy
    if (typeof state.managerPolicy[k] === 'boolean') {
      (state.managerPolicy[k] as boolean) = !state.managerPolicy[k]
      audio.click(); persist(); openOfficePanel()
    }
    return
  }
  const mf = (e.target as HTMLElement).closest('[data-mpfuel]') as HTMLElement | null
  if (mf) {
    state.managerPolicy.fuelAt = Number(mf.dataset.mpfuel)
    audio.click(); persist(); openOfficePanel()
    ui.toast(t('Müdür tank %{0} altına düşünce sipariş verecek.', String(Math.round(state.managerPolicy.fuelAt * 100))), 'good', true)
    return
  }
  // MÜDÜR TUT/YÜKSELT (ofisten) — mağazadaki satın alma akışının aynısı
  if ((e.target as HTMLElement).closest('#of-hire-manager')) {
    ui.onBuy('manager')
    openOfficePanel() // satır tazelensin (seviye/yovmiye değişti)
    return
  }
  // MÜDÜRÜ İŞTEN ÇIKAR — iki dokunuş (yanlışlıkla kovma olmasın)
  const fire = (e.target as HTMLElement).closest('#of-fire-manager') as HTMLButtonElement | null
  if (fire) {
    if (fire.dataset.armed !== '1') {
      fire.dataset.armed = '1'
      fire.textContent = t('Emin misin? Tekrar bas')
      setTimeout(() => { if (fire.isConnected) { fire.dataset.armed = ''; fire.textContent = t('İşten Çıkar') } }, 4000)
      return
    }
    if (state.fireManager()) {
      ui.toast(t('Müdür işten çıkarıldı — yovmiyesi kesildi. Kumbara/sipariş işleri yine sende.'), '', true)
      openOfficePanel(); persist()
    }
    return
  }
  const go = (e.target as HTMLElement).closest('button[data-goloc]') as HTMLButtonElement | null
  const un = (e.target as HTMLElement).closest('button[data-unlockloc]') as HTMLButtonElement | null
  // ŞUBE KASASI TOPLAMA — tek şube ya da hepsi
  const col = (e.target as HTMLElement).closest('button[data-collectloc]') as HTMLButtonElement | null
  const colAll = (e.target as HTMLElement).closest('#of-collect-vaults') as HTMLButtonElement | null
  if (col || colAll) {
    const got = state.collectBranchVaults(col ? (col.dataset.collectloc as LocId) : undefined)
    if (got > 0) {
      ui.toast(t('Şube kasası toplandı: +₺{0}', got.toLocaleString('tr-TR')), 'good')
      audio.achieve()
    }
    openOfficePanel(); persist()
    return
  }
  if (un) { subeAcIslemi(un.dataset.unlockloc as LocId); return }
  if (!go) return
  subeyeGec(go.dataset.goloc as LocId, go)
})

/**
 * ŞUBE AÇMA — TEK YOL. Ofis › Şubeler listesi de Şube Ağı Haritası da buraya girer.
 * Harita ikinci bir ekonomi yolu AÇMAZ: aynı state.unlockLoc(), aynı bedel, aynı
 * toast'lar, aynı kayıt. Haritanın yaptığı tek şey kararı GÖRÜNÜR kılmak.
 */
function subeAcIslemi(id: LocId) {
  if (!state.unlockLoc(id)) { ui.toast(t('Şube açma şartları sağlanmıyor.'), 'bad'); return }
  ui.toast(t('{0} şubesi açıldı! Şubeler bölümünden geçiş yapabilirsin.', themeFor(id).name), 'good', true)
  // KOPYA ŞUBE: oyuncu "aynısını ikinci kez aldım" sanmasın — kısıtı AÇILIŞ ANINDA söyle.
  if (isCopyLoc(id)) ui.toast(BRANCH_COPIES[id].note, '', true)
  audio.achieve(); openOfficePanel(); persist()
  if (haritaAcikMi()) haritaCiz()   // harita açıkken açıldıysa tahta anında tazelensin
}

/** Şube geçişi — hem Ofis › Şubeler butonları hem HUD hızlı geçiş menüsü buradan geçer
 *  (#1038 "anasayfada mapler arasında hızlı geçiş olsa süper olur"). */
function subeyeGec(id: LocId, go?: HTMLButtonElement) {
  // ÇİFT TIKLAMA KİLİDİ ("şubeye gidilemedi" raporu): push-confirmed reload 1.6-6 sn
  // (kit inişinde 12 sn) sürebiliyor; bu pencerede ikinci tıklama switchLoc'u
  // "zaten o şubedesin" durumuna düşürüp yanlış hata gösteriyordu.
  if (locSwitching) { ui.toast(t('Sahne yükleniyor — birkaç saniye…'), '', true); return }
  document.getElementById('mapwrap')?.classList.remove('show') // harita üstünde kalmasın
  // Şube değişimi: mevcut şubenin ekipmanı + YERLEŞİMİ saklanır, hedefin yüklenir.
  // Para/gün/itibar/prestij/kredi ŞİRKETTE kalır (tek kasa — rapor §3a kararı).
  const next = state.switchLoc(id, { placedPos, placedRot, placedRects })
  if (!next) { ui.toast(t('Şube değiştirilemedi.'), 'bad'); return }
  locSwitching = true
  if (go) { go.disabled = true; go.textContent = t('Yükleniyor…') }
  document.getElementById('locmenu')?.classList.remove('show')
  for (const k of Object.keys(placedPos)) delete placedPos[k]
  for (const k of Object.keys(placedRot)) delete placedRot[k]
  placedRects.length = 0
  Object.assign(placedPos, next.placedPos)
  Object.assign(placedRot, next.placedRot)
  placedRects.push(...(next.placedRects as typeof placedRects))
  localStorage.setItem(LOC_HINT_KEY, id) // reload'da sahne doğru temayla kurulsun
  ui.toast(t('{0} şubesine geçildi — sahne yükleniyor…', themeFor(id).name), 'good', true)
  if (state.giftToast) { ui.toast(state.giftToast, 'good', true); state.giftToast = null } // D12 hediyesi
  lastRemotePush = 0 // throttle'ı atla: şube değişimi reload'dan ÖNCE buluta yazılmalı
  persist()
  try { Car.solids = hardRects() } catch { /* karma state/sahne — reload zaten sıfırdan kurar */ }
  // PUSH-CONFIRMED RELOAD (devir kalıbıyla aynı): şube değişimi buluta YAZILDIĞI
  // doğrulanmadan reload atılmaz — yazım yarışı kaybedilince bulut eski şubede
  // kalıyor, her boot oyuncuyu eski şubeye döndürüyordu ("kasabaya geri dönmüyor").
  // 3 deneme + 6 sn tavan; kit indirme paralel yürür.
  const pushOk = (async () => {
    if (!auth.loggedIn()) return
    for (let i = 0; i < 3; i++) {
      try {
        const r = await auth.pushSave(savePayload()) as { kicked?: boolean; conflict?: boolean }
        if (!r.kicked && !r.conflict) return
      } catch { /* tekrar dene */ }
    }
  })()
  const pushCapped = Promise.race([pushOk, new Promise(r => setTimeout(r, 6000))])
  // Hedef şubenin model kitini reload'dan ÖNCE indir: sayfa yenilenince tarayıcı
  // önbellekten okur, oyuncu boş/prosedürel sahne görmez. İndirme başarısız olsa da
  // reload yine yapılır (sahne prosedürele düşer, oyun durmaz).
  const goReload = () => { pushCapped.finally(() => location.reload()) }
  // ŞUBE ÇİFTLEME: kopya şube TABANININ kitini kullanır (Otoyol II = otoyol modelleri).
  // Kit önbelleği taban id'de tutulduğu için kopya için İKİNCİ bir indirme YOKTUR;
  // mobil veri/ısınma maliyeti artmaz. İki dal ayrı duruyor çünkü kitNeeded/kitSize
  // yalnız taban id'lerini tanır (kits.ts MANIFEST taban anahtarlı).
  const kitId = baseLoc(id)
  if (kitNeeded(id) && !kitReady(id)) {
    ui.toast(t('{0} sahnesi indiriliyor ({1} model)…', themeFor(id).name, String(kitSize(id))), '')
    loadKit(id).catch(() => null).then(goReload)
    setTimeout(goReload, 12000) // ağ takılırsa oyuncuyu bekletme
  } else if (kitNeeded(kitId) && !kitReady(kitId)) {
    ui.toast(t('{0} sahnesi indiriliyor ({1} model)…', themeFor(id).name, String(kitSize(kitId))), '')
    loadKit(kitId).catch(() => null).then(goReload)
    setTimeout(goReload, 12000)
  } else setTimeout(goReload, 1600) // sahne temadan yeniden kurulsun
}

// PRESTİJ: İstasyonu Devret — iki aşamalı onay (geri dönüşü yok, gönüllü)
/** Devir raporu köprüsü: devir sayfayı yeniliyor, kazanç ekranı yenilemeden SONRA açılır. */
const DEVIR_RAPOR_KEY = 'beneloil-devir-rapor'
let handoverArmedAt = 0
const handoverArmed = () => Date.now() - handoverArmedAt < 6000
document.getElementById('of-prestige')?.addEventListener('click', e => {
  if (!(e.target as HTMLElement).closest('#of-handover')) return
  if (!handoverArmed()) {
    handoverArmedAt = Date.now()
    openOfficePanel() // metin render'dan gelir → panel yeniden çizilse de onay durumu KAYBOLMAZ
    return
  }
  handoverArmedAt = 0
  lastRemotePush = 0 // Oyuncu raporu ("2. devirde yıldız 1 kaldı"): reload'dan önce
                     // push throttle'a takılıp yıldız buluta yazılamıyordu — throttle'ı atla
  const res = state.handover()
  if (!res) { ui.toast(t('Devir şartları sağlanmıyor.'), 'bad'); return }
  // Yerleşim tablolarını da temizle: yoksa boşalan arsada GÖRÜNMEZ DUVARLAR kalır
  // (hardRects → Car.solids) ve oyuncu eski ayak izlerine yeni bina koyamaz.
  for (const k of Object.keys(placedPos)) if (k !== 'gatein' && k !== 'gateout' && k !== 'office' && k !== 'tank') delete placedPos[k]
  for (const k of Object.keys(placedRot)) if (k !== 'gatein' && k !== 'gateout' && k !== 'office' && k !== 'tank') delete placedRot[k]
  for (let i = placedRects.length - 1; i >= 0; i--) {
    const id = placedRects[i].id
    if (id !== 'gatein' && id !== 'gateout' && id !== 'office' && id !== 'tank') placedRects.splice(i, 1)
  }
  Car.solids = hardRects()
  // DEVİR RAPORU: sayfa hemen yenileniyor, toast kaybolur. Ne kazandığı yenilemeden
  // SONRA modal olarak gösterilsin ki "devrettim ama elime ne geçti?" boşluğu olmasın.
  // localStorage kullanılır — save şemasına YENİ ALAN GİRMEZ (sunucu doğrulaması bozulmaz).
  try {
    localStorage.setItem(DEVIR_RAPOR_KEY, JSON.stringify({
      stars: res.stars, cash: res.cash, seed: res.seed,
      mult: state.prestigeMult(), flow: state.prestigeFlow(),
      manager: state.managerLevel, staff: state.staffLevel,
    }))
  } catch { /* kota dolu olabilir — rapor kritik değil */ }
  ui.toast(t('İstasyon devredildi! Kasa: ₺{0} · {1}. Marka Yıldızı kazandın (gelir ×{2})',
    res.cash.toLocaleString('tr-TR'), res.stars, state.prestigeMult().toFixed(2)), 'good', true)
  audio.achieve()
  persist()
  // DEVİR KESİNLEŞTİRME (oyuncu raporları: "devrettim, yıldız gelmedi"):
  // sayfa, yıldız BULUTA YAZILMADAN yenilenmez. 3 deneme; çoklu-cihaz çatışması
  // veya kalıcı ağ hatasında reload İPTAL — state yerelde doğru, periyodik senkron
  // ilk fırsatta yazar. Misafirde yerel kayıt persist ile yazıldı, hemen yenilenir.
  ;(async () => {
    let ok = !auth.loggedIn()
    for (let i = 0; i < 3 && !ok; i++) {
      try {
        const r = await auth.pushSave(savePayload()) as { kicked?: boolean; conflict?: boolean }
        if (r?.kicked || r?.conflict) break // reload ETME — yıldızı ezdirme
        ok = true
      } catch { await new Promise(rs => setTimeout(rs, 1200)) }
    }
    if (ok) location.reload()
    else ui.toast(t('Devir kaydedildi — bulut eşitlemesi bekleniyor, sayfa otomatik yenilenecek. Elle yenileme!'), 'bad', true)
  })()
})

// B2B sözleşme imzalama
document.getElementById('of-contracts')?.addEventListener('click', e => {
  // FESİH: iki basışlı onay (yanlışlıkla tek tıkla feshedilmesin)
  if ((e.target as HTMLElement).closest('#of-cancel-contract')) {
    const b = document.getElementById('of-cancel-contract') as HTMLButtonElement
    if (b.dataset.armed !== '1') { b.dataset.armed = '1'; b.textContent = t('EMİN MİSİN? Feshetmek için tekrar bas'); return }
    const res = state.cancelContract()
    if (res) {
      ui.toast(t('Sözleşme feshedildi — cayma bedeli ₺{0} kesildi.', res.fee.toLocaleString('tr-TR')), 'bad', true)
      openOfficePanel(); persist()
    }
    return
  }
  const btn = (e.target as HTMLElement).closest('button[data-sign]') as HTMLButtonElement | null
  if (!btn) return
  const offer = state.contractOffers().find(o => o.id === btn.dataset.sign)
  if (!offer) { ui.toast(t('Teklif güncellendi — yeni listeye bak.'), 'bad'); openOfficePanel(); return }
  if (state.signContract(offer)) {
    ui.toast(t('{0} sözleşmesi imzalandı — günde {1}L {2} teslim et!', offer.name, offer.dailyLiters, FUEL_LABEL[offer.fuel]), 'good', true)
    openOfficePanel()
    persist()
  } else ui.toast(t('Zaten aktif bir sözleşmen var.'), 'bad')
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
      + `<div class="sd" style="margin:4px 0 12px; color:var(--red)">${
          unsec
            ? t('Taksit ÜST ÜSTE 2 GÜN ödenmezse banka istasyona ORTAK olur — borç bitene dek günlük kârının bir kısmı bankaya gider.')
            : t('Taksit ÜST ÜSTE 2 GÜN ödenmezse teminatların HACZEDİLİR ve geri alınamaz. Şu an risk altındaki değer: ₺{0}',
                l.collateral.reduce((a, id) => a + state.collateralValue(id), 0).toLocaleString('tr-TR'))
        }</div>`
      + (l.overdue > 0
          ? `<div class="sd" style="margin:-6px 0 12px; color:var(--red); font-weight:800">${
              t('⚠ {0} gün geciktin — {1} gün daha gecikirsen haciz gelir. Kasanda ₺{2} olmalı.',
                l.overdue, Math.max(1, 2 - l.overdue), l.monthly.toLocaleString('tr-TR'))
            }</div>`
          : '')
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
      // #445 (churn): oyuncu neyi riske attığını KREDİYİ ALIRKEN görmüyordu; sonra
      // binalarını kaybedip oyunu bırakıyordu. Riski işlemden ÖNCE, seçtiği binaların
      // adıyla söylüyoruz — sürpriz kayıp, oyuncunun bilerek aldığı riskten çok daha kötü.
      + `<div class="sd" style="margin:8px 0 4px; color:var(--red)">${
          total > 0
            ? t('RİSK: taksiti üst üste 2 gün ödeyemezsen seçtiğin {0} bankaya geçer ve GERİ ALINAMAZ.',
                elig.filter(e => bankSelected.has(e.id)).map(e => e.label).join(', '))
            : t('Teminat seç — ödeyemezsen seçtiğin binalar bankaya geçer.')
        }</div>`
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
    ui.toast(t('Reklamlar kaldırıldı — teşekkürler!'), 'good')
  } else if (p.kind === 'coins' && p.coins) {
    try { const r = await auth.iapGrant(id, transactionId); state.money = r.money; lastRemotePush = Date.now() }
    catch { state.money += p.coins }
    ui.toast(t('+₺{0} kasana eklendi!', p.coins.toLocaleString('tr-TR')), 'good')
  }
  persist(); renderStore()
}
document.getElementById('of-store')?.addEventListener('click', () => openStore())
// Ofisi Taşı (10 feedback'in isteği): ofise tıklama Ofis panelini açtığından Taşı'lı bina
// kartına hiç ulaşılamıyordu — panelden doğrudan taşıma moduna geçilir.
document.getElementById('of-move')?.addEventListener('click', () => {
  document.getElementById('officewrap')?.classList.remove('show')
  startPlacement('office', true)
})
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
      ui.toast(t('Kredi onaylandı — +₺{0} kasana geçti!', total.toLocaleString('tr-TR')), 'good')
      renderBank(); persist()
    }
    return
  }
  if (tgt.closest('#bank-adv')) {
    const amt = state.advanceLimit()
    if (state.takeAdvance(amt)) { ui.toast(t('Avans onaylandı — +₺{0} kasana geçti!', amt.toLocaleString('tr-TR')), 'good'); renderBank(); persist() }
    return
  }
  if (tgt.closest('#bank-payoff')) {
    if (state.repayLoanFull()) { ui.toast(t('Kredi kapatıldı — teminatların serbest!'), 'good'); renderBank(); persist() }
    else ui.toast(t('Erken kapatmaya kasan yetmiyor.'), 'bad')
    return
  }
  if (tgt.closest('#bank-buyout')) {
    if (state.buyoutPartner()) { ui.toast(t('Ortaklık kapatıldı — istasyon tamamen senin!'), 'good'); renderBank(); persist() }
    else ui.toast(t('Ortaklığı kapatmaya kasan yetmiyor.'), 'bad')
  }
})

/** Bir binanın GÖRSELİNİ + yerleşim kaydını kaldırır (state sayacı applySell ile zaten düşmüş olmalı).
 *  Sayılabilir tesislerde (solar/parking/selfwash/airwater) hangi örnek verilirse verilsin SON örneğin
 *  görseli kaldırılır — aksi halde ortadaki görsel silinip fazlalık bina sahnede "işlevsiz" kalır (#495).
 *  Satış ve HACİZ bu tek yoldan geçer; eskiden haciz kendi (eksik) kopyasını kullanıyordu. */
function removeBuildingVisual(id: string) {
  golgeTazele()
  const base = id.split('#')[0]
  // ÜNİTE ID BİÇİMİ: sahne 'pump-3' / 'charger-1' kullanır, teminat listesi 'pump#3' /
  // 'charger#1'. Haciz teminat biçimini gönderdiği için removeBuildingGroup sahnede
  // hiçbir şey bulamıyor ve haczedilen şarj ünitesi ekranda TIKLANAMAZ enkaz olarak
  // kalıyordu (state sayacı düşmüş, görsel duruyor). İki biçim de sahne id'sine çevrilir.
  const pi = unitIndex(id, 'pump')
  const ci = unitIndex(id, 'charger')
  if (pi !== null) cars.evictSlot('fuel', pi)
  else if (ci !== null) cars.evictSlot('ev', ci)
  const countable = COUNTABLE[base]?.()
  const target = pi !== null ? `pump-${pi}`
    : ci !== null ? `charger-${ci}`
    : (countable !== undefined)
      ? (countable === 0 ? base : `${base}#${countable}`)
      : id
  world.removeBuildingGroup(target)
  delete placedPos[target]
  delete placedRot[target]
  const ri = placedRects.findIndex(r => r.id === target)
  if (ri >= 0) placedRects.splice(ri, 1)
  // kaldırılan tesisin kumbarası da gitsin: yoksa yok olan binaya ait para toplanamaz halde kalır
  delete state.pendingCash[id]; delete state.pendingCash[target]
  delete state.facLost[id]; delete state.facLost[target]
}

/** Ödeme yapılamayınca teminatları haczet: binaları istasyondan kaldır (iade YOK), krediyi kapat. */
function seizeCollateral() {
  for (const id of [...state.loan.collateral]) {
    if (!sellInfo(state, id)) continue // zaten satılmış/kaldırılmış olabilir
    const refund = applySell(state, id) // state sayaçlarını düşürür + iade ekler
    if (refund) state.money -= refund   // haciz: iade geri alınır (banka borca karşılık alır)
    removeBuildingVisual(id)            // satışla AYNI yol (son-örnek eşlemesi + pompa tahliyesi) — #495
  }
  state.loan = { active: false, principal: 0, monthly: 0, remaining: 0, overdue: 0, collateral: [], rate: LOAN_RATE }
  Car.solids = hardRects()
  cars.rerouteForGates()
  golgeTazele() // haciz: yapılar alındı, gölge haritası tazelenmeli
  ui.toast(t('Ödeme yapılamadı — teminatların HACZEDİLDİ ve istasyondan alındı!'), 'bad')
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

// LIGHT MOD'da composer HİÇ kurulmaz → bloom pass'i yok, ara render target'ları yok.
if (!LIGHT) {
  composer = new EffectComposer(renderer)
  composer.addPass(new RenderPass(world.scene, camera))
  composer.addPass(new UnrealBloomPass(new THREE.Vector2(window.innerWidth / 2, window.innerHeight / 2), 0.24, 0.4, 0.93)) // yarı çözünürlük bloom: gözle fark yok, kat kat hızlı
  composer.addPass(new OutputPass())
  composer.setSize(window.innerWidth, window.innerHeight)
}
/** Tek kare çiz. Composer varsa post-processing zinciri, yoksa doğrudan render. */
function renderFrame() {
  if (composer) composer.render()
  else renderer.render(world.scene, camera)
}

const cars = new CarManager(world.scene, modelLib, {
  // SAHNEYLE SINIRLI SAYIM: state.pumps sahnedeki pompa sayısını AŞARSA pumpSlot(i)
  // undefined dönüyor ve trafik her karede "Cannot read properties of undefined (reading 'x')"
  // ile patlıyordu — oyun tamamen donuyor. Kayıt/sahne uyuşmazlığında (bulut kaydı world'ün
  // kurabildiğinden fazla pompa söylerse) çökmek yerine kurulmuş olanla devam et.
  pumpCount: () => Math.min(state.pumps, world.pumpSlots.length),
  evCount: () => Math.min(state.evChargers, world.evSlots.length),
  // misafir gate'i açıkken kimse İSTASYONA girmez (ilerleme donuk) ama yol trafiği akar
  // YOĞUN SAAT (Faz 2.2): sabah 07-09 ve akşam 17-19 doğal yığılma. Reklamla açılan
  // "müşteri patlaması"ndan AYRI ve her gün AYNI saatte tekrar eder — oyuncu güne
  // hazırlanmayı (depo doldur, pompacı tut) öğrensin diye öngörülebilir olması şart.
  entryChance: () => (guestPaused ? 0 : state.entryChance() * (isPromoMode ? 2.5 : 1) * (state.rushHour ? 1.8 : 1)),
  // EV PAYI (#1023 "elektrikli araba sayısı çok az gibi"): taban %15'ti ve tek şarj
  // ünitesiyle akışın ancak %16'sı EV oluyordu — oyuncu ₺'lik yatırımın karşılığını
  // sahnede göremiyordu. Taban %20, ünite başı katkı %11, tavan %60.
  evShare: () => (state.evChargers > 0 ? Math.min(0.60, 0.20 + 0.11 * state.evChargers) * state.evPriceFactor() : 0),
  isPumpBroken: i => state.brokenPumps.has(i),
  isChargerBroken: i => state.brokenChargers.has(i),
  parkSpots: () => world.getParkingSpots(),
  extraObstacles: () => tankers.map(x => x.t.group.position),
  wideGates: () => state.wideGates,
  prices: () => state.prices,
  pumpSlot: i => world.pumpSlots[i],
  evSlot: i => world.evSlots[i],
  pumpAngle: i => world.pumpAngles[i] ?? 0,
  evAngle: i => world.evAngles[i] ?? 0,
  trafficPull: () => (guestPaused ? 1 : state.trafficPull()),
  segments: () => state.activeSegments(),
  // MARİNA: tekne segmentleri (kara şubede boş dizi döner → tekne doğmaz)
  boats: () => state.boatCarSegments(),   // TUTAR da buradan gelir (bkz. boatCarSegments)
  // MARİNA: su şubesinde ARABA ASLA doğmaz — tekne yoksa hiçbir şey doğmaz.
  // KRİTİK: SAHNENİN temasına bakılır (world locHint ile kurulur) — state.theme()
  // save yüklenene kadar 'kasaba' döndüğünden denizde araba doğuyordu.
  waterOnly: () => world.theme.lane.kind === 'water',
  // 4 ŞERİTLİ YOL: istasyona girecek araçların servis şeridi (temadan)
  serviceLane: () => state.theme().lane.service,
  // Araçlar birbirinin içinden geçer (ölçüm: servis 267→363, tıkanma 41→0).
  // ?collide=1 ile eski davranış açılır.
  // ARAÇ-ARAÇ ÇARPIŞMASI YOK (mimari karar, oyun sahibi): "gerekirse birbirinin
  // içinden geçsinler ama yollar öyle hesaplanmalı ki düzgün takip edilebilsin".
  // `carsPassThrough` / `?nocollide` bayrağı SİLİNDİ — kapatılacak bir çarpışma
  // katmanı kalmadı. Ayrıklık artık ŞERİTLERİN GEOMETRİSİYLE sağlanıyor
  // (traffic-graph.ts: gelen omurga, giden omurga, ünite kolları).
  // ÖLÇÜM (yük testi, aynı tohum): servis 943 → 1285, kalıcı sıkışan 0, buharlaşma 0,
  // yığın senaryosunda apron zirvesi 48 → 13 araç.
  trafficLight: () => {
    const tl = state.theme().features?.trafficLight
    return tl ? { red: state.lightRed(), y: tl.y } : null
  },
  highway: () => {
    const hw = state.theme().features?.highway
    return hw ? { ...hw, signLevel: state.signLevel } : null
  },
  onRampFull: () => {
    // Yavaşlama şeridi doldu → müşteri otobana geri döndü. Otoyolun imza kayıp türü:
    // oyuncuyu APRON KAPASİTESİ yatırımına iter (rapor §6.4 kural 2).
    state.stats.lost++
    if (rampFullT <= 0) {
      rampFullT = 40 // 12 sn spam gibiydi (karşı yaka açılınca kayıplar arttı) — bilgi, alarm değil
      ui.toast(t('Yavaşlama şeridi doldu — müşteri otobana geri döndü! Kapasiteni büyüt.'), 'bad')
    }
  },
  gateInY: () => world.gateIn.y,
  gateOutY: () => world.gateOut.y,
  // Otoyolda orta BARİYER var: karşı yön fiziksel olarak erişilemez → karşı istasyon YOK
  // (rapor §6.4: bunun yerine ayna simetrik ikinci tesis ayrı yatırımdır).
  // OTOYOL FİXİ (Oğuz: "karşı yakaya araba gelmiyormuş"): bariyer YAKA GEÇİŞİNİ engeller,
  // karşı ŞERİTTEKİ aracın kendi yakasındaki istasyona girmesini değil. Eski `!barrier`
  // şartı otoyolda karşı istasyonu tamamen müşterisiz bırakıyordu (kuruluyor ama gelir 0).
  farActive: () => world.farStationOn,
  isWater: () => world.theme.lane.kind === 'water', // sahne teması (save gecikmesine dayanıklı)
  // FİLO: aktif ihale varsa garantili sözleşme araçları gelir
  contract: () => state.contract ? { fuel: state.contract.fuel, dailyLiters: state.contract.dailyLiters } : null,
  farGateInY: () => world.gateIn2.y,
  farGateOutY: () => world.gateOut2.y,
  truckSpots: () => world.getTruckSpots(),
  onTruckParked: () => {
    const fee = 40 + Math.round(Math.random() * 40)
    state.addPending('truckpark', fee, t('Tır parkı'))
    ui.toast(t('Tır park etti: ₺{0} kumbarada', fee), 'good', true)
  },
  onCarReady: car => { if (!ui.activeCar && !isAttendantCar(car)) autoSelect(car); tutStart() },
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
    // KAYBIN BEDELİ GÖRÜNÜR (Faz 1.4): eskiden tek bir toast vardı, rakam yoktu.
    // Müşterinin bırakacağı gerçek para aracın üstünde yükselerek gösteriliyor.
    const bedel = car.kind === 'ev' ? car.demandKwh * state.elecPrice : car.demandAmount
    state.stats.lostMoney += bedel
    state.dayLostCount++
    state.dayLostMoney += bedel
    car.showLoss(`−₺${Math.round(bedel).toLocaleString('tr-TR')}`)
    ekranFlasi()
    // SERİ KIRILIR (Faz 3.1): kaçan müşterinin bedeli artık soyut değil — biriktirdiğin
    // çarpanı da götürüyor. Kayıp acısının asıl kaynağı bu.
    // SERİ KURTARMA TEKLİFİ: oyunun en güçlü duygusal anı — kayıp taze ve oyuncu
    // kaybettiğinin değerini RAKAMLA biliyor. Teklif reddedilirse seri gerçekten gider.
    if (state.combo >= 3) {
      const mult = state.comboMult()
      ui.toast(t('Seri koptu! ×{0} çarpanı gitti.', mult.toFixed(2)), 'bad')
      // teklife bağlı durum SADECE teklif gerçekten ekrana geldiyse kurulur
      // (showAdOffer kendi içinde rewardedReady() kapısından geçiriyor)
      if (state.adSeriHak > 0 && adBtn.style.display === 'none' && showAdOffer('seri', mult)) {
        seriYedek = state.combo
        teklifT = 8
      }
    }
    state.combo = 0
    ui.toast(t('Müşteri beklemekten sıkıldı ve gitti!'), 'bad', true)
    audio.miss()
    state.addRep(-0.2)
    if (ui.activeCar === car) autoSelect(nextServableCar())
  },
  patienceMult: () => state.patienceMult(),
  // VIP OLASILIĞI: günde ~1-2 VIP. Hakkı bitmişse yine doğar (VIP'i reklama bağımlı
  // yapmıyoruz — hızlı oyuncu reklamsız da kazanır), sadece teklif çıkmaz.
  vipChance: () => (state.day >= 3 ? 0.035 : 0),
  onVip: car => {
    ui.toast(t('VIP MÜŞTERİ geldi — büyük sipariş, KISA sabır!'), 'good', true)
    audio.promo()
    if (state.adVipHak > 0 && adBtn.style.display === 'none' && showAdOffer('vip', car.demandAmount)) {
      vipAday = car
      teklifT = 12                     // teklif kısa ömürlü: kriz anı geçince anlamsızlaşır
    }
  },
  onTurnedAway: () => {
    // KUYRUK DOLU (Faz 2.3): içeri hiç giremeyen müşteri KAÇANDAN AYRI sayılır —
    // ikisi farklı sorunlar: biri "yavaşsın", diğeri "kapasiten yetmiyor".
    state.stats.turnedAway++
  },
  // MARİNA: kapı noktası SUDA (iskele x 3.1..5.3'ün doğusu) — tekne giriş/çıkış
  // path'i tahtaların üstünden geçmez. Kara şubelerinde eski kapı (4.2) aynen.
  // SAHNE teması: state.theme() kuruluş anında henüz 'kasaba' dönebiliyordu → 4.2
  // kalıp tekneler yine iskeleden geçerdi.
}, world.theme.lane.kind === 'water' ? 7.4 : 4.2)

// ---- Müşteri paneli otomatik açılma tercihi (35 feedback: "sürekli önüme çıkıyor") ----
// localStorage'da tutulur (save formatına DOKUNMAZ). Kapalıyken panel yalnız araca
// TIKLAYINCA açılır; yerleştirme/arsa modundayken tercih ne olursa olsun otomatik açılmaz.
const AUTOPANEL_KEY = 'beneloil-autopanel'
let autoPanelPref = localStorage.getItem(AUTOPANEL_KEY) !== '0'
export function setAutoPanel(on: boolean) { autoPanelPref = on; localStorage.setItem(AUTOPANEL_KEY, on ? '1' : '0') }
/** paneli OTOMATİK aç/geçir — tercih kapalıysa veya oyuncu inşaat/taşıma/arsa modundaysa açmaz */
function autoSelect(car: Car | null) {
  if (!autoPanelPref || placing || zoneMode) { if (ui.activeCar) ui.selectCar(null); return }
  ui.selectCar(car)
}

// ---- Karşı-yaka rehber banner'ı: arsa alınmış ama karşı istasyon aktif değil ----
// ~15 feedback "karşıya giriş-çıkış ekleyemiyorum" — kapıların İLK pompa/şarjla OTOMATİK
// geldiğini kimse bilmiyordu. Koşul sürdükçe görünür, ✕ ile oturumluk kapanır.
let farHintDismissed = false
function updateFarHint() {
  const box = document.getElementById('farhint'); if (!box) return
  const farParcels = [...state.ownedParcels].filter(k => Number(String(k).split(',')[0]) >= 3)
  if (farHintDismissed || farParcels.length === 0 || world.farStationOn) { box.style.display = 'none'; return }
  const anyPaved = farParcels.some(k => state.pavedParcels.has(k))
  const txt = document.getElementById('farhint-text')
  if (txt) txt.textContent = anyPaved
    ? t('Karşı arsan hazır! Pompa ya da şarj ünitesi kur — giriş-çıkış kapıları OTOMATİK gelir.')
    : t('Karşı arsana önce Zemin Betonu döşe, sonra pompa/şarj kur — kapılar OTOMATİK gelir.')
  box.style.display = 'block'
}
document.getElementById('farhint-x')?.addEventListener('click', () => {
  farHintDismissed = true
  const box = document.getElementById('farhint'); if (box) box.style.display = 'none'
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
  // karşı istasyonda araç pompanın batısında → hortum ters yöne (sign) uzanır
  const sign = car.station === 'far' ? -1 : 1
  const bx = slot.x - sign * 1.8
  const y = slot.y
  const start = new THREE.Vector3(bx + sign * 0.3, y + 0.3, 1.3)
  const mid = new THREE.Vector3(bx + sign * 0.85, y - 0.05, 0.5)
  const end = new THREE.Vector3(bx + sign * 1.22, y - 0.35, 0.62)
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
  // Yaya YOL KARŞISINA geçmez: ziyaret yalnız aracın KENDİ yakasındaki tesise.
  // (Eskiden yürüyerek otoyoldan geçiyor, araçlar yayaya çarpıp tıkanıyordu — 2 feedback.
  //  Yaka-duyarlı iki yönlü: karşı müşteri karşıya taşınmış tesisi kullanabilir.)
  const sameSide = (id: string) => {
    const b = world.buildings.find(x => x.id === id)
    return !b || (b.group.position.x > ROAD_X) === (car.station === 'far')
  }
  // market: aracın yakasındaki örnek seçilir (near→market, karşı→market2), geliri o örneğin seviyesiyle
  if (car.wantsMarket) {
    const mk = ([['market', state.marketLevel], ['market2', state.market2Level]] as [string, number][])
      .find(([mid, lvl]) => lvl > 0 && sameSide(mid))
    if (mk) {
      const [mid, lvl] = mk
      v.push({ buildingId: mid, revenue: () => Math.round((25 + Math.random() * 35) * lvl), toastMsg: m => t('Market alışverişi: +₺{0}', m), score: 0.2 })
    }
  }
  const pickFac = (base: string, has: boolean, has2: boolean): string | null => {
    if (has && sameSide(base)) return base
    if (has2 && sameSide(base + '2')) return base + '2'
    return null
  }
  const toiletId = pickFac('toilet', state.toiletLevel > 0, state.toilet2Level > 0)
  if (car.wantsToilet && toiletId) {
    const fee = state.toiletFee
    v.push({
      buildingId: toiletId,
      revenue: () => fee,
      toastMsg: mm => t('Tuvalet ücreti: +₺{0}', mm),
      score: 0.15 * state.toiletLevel - (fee > 0 ? 0.03 + fee * 0.012 : 0),
    })
  }
  const coffeeId = pickFac('coffee', state.hasCoffee, state.hasCoffee2)
  if (car.wantsCoffee && coffeeId) {
    v.push({ buildingId: coffeeId, revenue: () => Math.round(20 + Math.random() * 25), toastMsg: m => t('Kahve satışı: +₺{0}', m), score: 0.15 })
  }
  const foodId = pickFac('restaurant', state.hasRestaurant, state.hasRestaurant2)
  if (car.wantsFood && foodId) {
    v.push({ buildingId: foodId, revenue: () => Math.round(80 + Math.random() * 80), toastMsg: m => t('Restoran hesabı: +₺{0}', m), score: 0.25 })
  }
  return v
}

/** olmayan tesisi arayan müşterinin hayal kırıklığı */
function missingPenalty(car: Car): number {
  let d = 0
  if (car.wantsToilet && state.toiletLevel === 0) { d -= 0.8; ui.toast('Müşteri tuvalet arıyordu, bulamadı!', 'bad') }
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
  // yaka eşleşmesi: karşıya taşınmış tesis near müşteriden kazanamaz (görünmez gelir, #269),
  // karşı müşteri kendi yakasındaki üniteyi kullanır. Çok-üniteli tesiste herhangi bir
  // örnek aracın yakasındaysa hizmet verilir.
  const anyOnSide = (base: string) => world.buildings.some(x =>
    (x.id === base || x.id.startsWith(base + '#'))
    && (x.group.position.x > ROAD_X) === (car.station === 'far'))
  const washId = (state.hasWash && anyOnSide('wash')) ? 'wash' : (state.hasWash2 && anyOnSide('wash2')) ? 'wash2' : null
  if (car.wantsWash && washId) {
    const m = Math.round(60 + Math.random() * 60)
    state.addPending(washId, m, t('Oto yıkama')); d += 0.2
    ui.toast(t('Araç yıkandı: ₺{0} kumbarada', m), 'good')
  }
  const oilId = (state.hasOil && anyOnSide('oil')) ? 'oil' : (state.hasOil2 && anyOnSide('oil2')) ? 'oil2' : null
  if (car.wantsOil && oilId) {
    const m = Math.round(150 + Math.random() * 100)
    state.addPending(oilId, m, t('Yağ değişimi')); d += 0.25
    ui.toast(t('Yağ değişimi: +₺{0} kumbarada', m), 'good')
  }
  if (car.wantsAir && state.hasAirWater && anyOnSide('airwater')) {
    // adet çarpanı: çok üniteli istasyonda aynı anda birden çok araç kullanır (pendingCap'in
    // min(6) ölçeğiyle aynı tavan) — "2. üniteyi almanın anlamı yok" şikâyetinin fixi
    const m = Math.round(10 + Math.random() * 10) * Math.min(6, state.airWaterCount)
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
  return ({ market: t('Market'), market2: t('Karşı Market'), toilet2: t('Karşı Tuvalet'),
    wash2: t('Karşı Oto Yıkama'), oil2: t('Karşı Yağ Değişimi'), coffee2: t('Karşı Kahveci'), restaurant2: t('Karşı Restoran'), toilet: t('Tuvalet'), coffee: t('Kahveci'), restaurant: t('Restoran'), oil: t('Yağ değişimi') } as Record<string, string>)[id] ?? id
}
const pendingVisits = new Map<Car, { visits: Visit[]; score: number; started: boolean }>()
// yağ değişimi körüğü: tesis başına tek araç; araç içerideyken görünmez, ~5 sn sonra çıkar
const oilBusy = new Map<string, Car>()
const oilPending = new Map<Car, { bayId: string; score: number; t: number; started: boolean; exit: THREE.Vector3 }>()

// ---- POMPACI/ŞARJCI FİGÜRLERİ (Oğuz: "yovmiyeci varsa başına karakter koy") ----
// KENNEY MİNİ KARAKTERLER tembel yüklenir; inene kadar (veya inmezse) walker'larla
// aynı dilde prosedürel figür kullanılır. Rol, şapka rengiyle okunur:
// pompacı KIRMIZI, şarjcı TURKUAZ.
let charLib: THREE.Group[] | null = null
loadCharacters().then(l => { charLib = l }) // açılışı BLOKLAMAZ
function roleCap(uniform: number): THREE.Group {
  const g = new THREE.Group()
  const capTop = new THREE.Mesh(new THREE.CylinderGeometry(0.115, 0.115, 0.07, 10),
    new THREE.MeshLambertMaterial({ color: uniform }))
  capTop.rotation.x = Math.PI / 2; capTop.position.z = 0.03; g.add(capTop)
  const brim = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.1, 0.02),
    new THREE.MeshLambertMaterial({ color: uniform }))
  brim.position.set(0.12, 0, 0); g.add(brim)
  return g
}
function attendantMesh(kind: 'pump' | 'ev'): THREE.Group {
  const uniform = kind === 'pump' ? 0xd64545 : 0x1fa8bc
  if (charLib?.length) {
    const proto = charLib[kind === 'pump' ? 1 : 4] // male-b pompacı, female-b şarjcı
    const fig = fitCharacter(proto, 0.95)
    fig.traverse(m => { m.castShadow = true })
    // Kenney kafası prosedürel kafadan geniş → şapka büyütülür; figür yere indirildiği
    // için tepe noktası ~0.73 (fitCharacter yere-indirme payı sonrası)
    const cap = roleCap(uniform); cap.scale.setScalar(1.6); cap.position.z = 0.95; fig.add(cap)
    return fig
  }
  const g = new THREE.Group()
  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.16, 0.5, 10),
    new THREE.MeshLambertMaterial({ color: uniform }))
  body.rotation.x = Math.PI / 2; body.position.z = 0.32; body.castShadow = true; g.add(body)
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.11, 10, 8),
    new THREE.MeshLambertMaterial({ color: 0xf0c8a0 }))
  head.position.z = 0.68; g.add(head)
  const cap = roleCap(uniform); cap.position.z = 0.75; g.add(cap)
  return g
}
const attendantFigs = new Map<string, THREE.Group>()
// SERVİS GÖRSELİ: dolum sürerken pompadan araca sarkan hortum + pompacının elindeki
// tabanca tank noktasında ("tam depo doluyor gibi"). Araç kalkınca söküp figürü
// nöbet yerine döndürür. key → prop (hortum+tabanca) + hangi araca kurulduğu.
const serviceProps = new Map<string, { g: THREE.Group; car: Car }>()
function disposeProp(key: string) {
  const p = serviceProps.get(key)
  if (!p) return
  world.scene.remove(p.g)
  p.g.traverse(o => { const m = o as THREE.Mesh; m.geometry?.dispose?.() })
  serviceProps.delete(key)
}
const HOSE_MAT = new THREE.MeshLambertMaterial({ color: 0x2a2f36 })
// YALNIZ TABANCA — hortum ZATEN var (yukarıdaki hoses sistemi, araç başına pompadan
// uzanır). İkinci bir boru çizmek "2 boru görünüyor" hatası yarattı (Oğuz, 29 Tem).
function buildHoseProp(_from: THREE.Vector3, tank: THREE.Vector3, into: THREE.Vector3): THREE.Group {
  const g = new THREE.Group()
  // tabanca: dik tutamak + araca giren ağız
  const grip = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.07, 0.17), HOSE_MAT)
  grip.position.copy(tank).addScaledVector(into, -0.08); grip.position.z -= 0.05
  g.add(grip)
  const spout = new THREE.Mesh(new THREE.CylinderGeometry(0.028, 0.028, 0.16, 8), HOSE_MAT)
  spout.position.copy(tank)
  spout.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), into)
  g.add(spout)
  return g
}
function syncAttendants() {
  const want = new Map<string, { kind: 'pump' | 'ev'; bid: string; idx: number }>()
  for (const i of state.autoPumps) want.set(`p${i}`, { kind: 'pump', bid: `pump-${i}`, idx: i })
  for (const i of state.autoChargers) want.set(`c${i}`, { kind: 'ev', bid: `charger-${i}`, idx: i })
  for (const [key, fig] of attendantFigs) {
    if (!want.has(key)) { world.scene.remove(fig); attendantFigs.delete(key); disposeProp(key) }
  }
  for (const [key, w] of want) {
    const b = world.buildings.find(x => x.id === w.bid)
    if (!b) {
      // ünite sahnede yok (taşınıyor/yeniden kuruluyor) → figür SON pozunda DONUP
      // kalmasın ("şarjcı bugda kalıyor") — kaldır, ünite dönünce yeniden kurulur
      const ghost = attendantFigs.get(key)
      if (ghost) { world.scene.remove(ghost); attendantFigs.delete(key) }
      disposeProp(key)
      continue
    }
    // KONUM (Oğuz v3 — mor X kalibrasyonu): pompanın ekrandaki ÖN-SOL köşesi,
    // pad'in üstünde. v2'deki (-0.62,+0.34) ekranda ÜST-SAĞA düşmüştü; X'in yeri
    // bunun tersi yönde → dünya (+0.58, -0.42). Yükseklik aynı (z=0, pad'e basar).
    const bx = b.group.position.x, by = b.group.position.y
    const dx = 0.58, dy = -0.42
    let fig = attendantFigs.get(key)
    if (!fig) { fig = attendantMesh(w.kind); world.scene.add(fig); attendantFigs.set(key, fig) }
    // dolum var mı? kendi slotundaki araç pompada ve servis görüyor olmalı
    const serving = cars.cars.find(c =>
      (w.kind === 'ev' ? c.kind === 'ev' : c.kind !== 'ev')
      && c.slotIndex === w.idx && c.phase === 'atPump'
      && (c.filling || c.beingServed || c.charging)) // EV 'charging' kullanır, filling DEĞİL
    if (serving) {
      const cp = serving.group.position
      const toPump = new THREE.Vector3(bx - cp.x, by - cp.y, 0)
      if (toPump.lengthSq() > 0.001) toPump.normalize()
      // tank noktası: aracın pompaya bakan yan yüzü, kapak yüksekliği.
      // Yan mesafe araç tipine göre değişir (kamyon geniş!) → bbox'tan ölç.
      const bb = new THREE.Box3().setFromObject(serving.group)
      const halfW = Math.max(0.45, Math.min(1.1,
        (bb.getSize(new THREE.Vector3()).x * Math.abs(toPump.x) + bb.getSize(new THREE.Vector3()).y * Math.abs(toPump.y)) / 2))
      const tank = new THREE.Vector3(cp.x + toPump.x * (halfW + 0.03), cp.y + toPump.y * (halfW + 0.03), 0.52)
      // pompacı dar boşluğa sıkışmasın: tanktan araç boyunca çaprazda durur, yüzü tanka dönük
      const perp = new THREE.Vector3(-toPump.y, toPump.x, 0)
      fig.position.set(tank.x + toPump.x * 0.22 + perp.x * 0.5, tank.y + toPump.y * 0.22 + perp.y * 0.5, 0)
      fig.rotation.z = Math.atan2(tank.y - fig.position.y, tank.x - fig.position.x)
      // hortum+tabanca yalnız FİİLEN YAKIT dolarken; şarjcıya tabanca YOK (EV'de anlamsız),
      // ön serviste (cam silme vs.) el boş
      if (serving.filling && w.kind === 'pump') {
        const prev = serviceProps.get(key)
        if (!prev || prev.car !== serving) {
          disposeProp(key)
          const from = new THREE.Vector3(bx, by, 0.78) // hortumun pompadan çıktığı nokta
          const into = toPump.clone().negate() // ağız araca doğru
          const g = buildHoseProp(from, tank, into)
          world.scene.add(g)
          serviceProps.set(key, { g, car: serving })
        }
      } else disposeProp(key)
    } else {
      disposeProp(key)
      fig.position.set(bx + dx, by + dy, 0) // pompa taşınırsa figür de takip eder
      fig.rotation.z = Math.atan2(-dy, -dx) - Math.PI / 2 // tepeden 90° CW: nöbette yola/araca bakar, eli boş
    }
  }
}
setInterval(syncAttendants, 700)

function personMesh(): THREE.Group {
  // KENNEY MİNİ KARAKTER (yüklendiyse) — 6 çeşitten rastgele; inmediyse prosedürel
  if (charLib?.length) {
    const proto = charLib[Math.floor(Math.random() * charLib.length)]
    const fig = fitCharacter(proto, 0.9)
    fig.traverse(m => { m.castShadow = true })
    return fig
  }
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
      p.x += b!.group.position.x > ROAD_X ? -1.9 : 1.9 // yaklaşma yönü yakaya göre aynalanır
      p.z = 0
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

// SERVİS SONU TEPKİSİ (Faz 1): bu fonksiyon ilk POC commit'inden beri dört dalın
// DÖRDÜNDE de boş string döndürüyordu — yani müşteri memnuniyeti hiç görünmedi.
// Oyuncu iyi servisin karşılığını görmediği için hızlı olmanın anlamı da yoktu.
function emojiFor(score: number): string {
  return score >= 4.5 ? '🤩' : score >= 3.5 ? '😄' : score >= 2.5 ? '🙂' : '😒'
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
function gunlukSayaclariSifirla() {
  state.dailyServed = 0
  state.dailyDone = false
  state.dailyRevenue = 0
  state.dailyLiters = 0
  state.dailyCollected = 0
  state.dailyPerfect = 0
  state.dailyClaimed = []
}

function trackDaily(score = 0) {
  state.dailyServed++
  if (score >= 4.8) state.dailyPerfect++
  gorevOdulle()
  tutSatisTamam() // öğretici 4. ipucu: servis bitti, para kasada → "şimdi nereye yatırıyorsun?"
}

/** Tamamlanan günlük görevlerin ödülünü öder ve haber verir (#1004). Görev sayaçlarını
 *  değiştiren HER yerden çağrılır — ödül gecikmesin, oyuncu "görev yok gibi" demesin. */
function gorevOdulle() {
  const yeni = claimDailyQuests(state)
  for (const q of yeni) {
    ui.toast(t('GÖREV TAMAM: {0} — ödül +₺{1}', q.label, q.reward.toLocaleString('tr-TR')), 'good', true)
    audio.achieve()
  }
  if (yeni.length && dailyQuests(state).every(q => q.done)) {
    ui.toast(t('Günün üç görevi de bitti — yarın yenileri gelecek!'), 'good', true)
  }
}

// EKRAN FLAŞI (Faz 1.4): müşteri kaçınca ekranın kenarı bir anlığına kızarır.
// Toast'ı kaçıran oyuncu bile çevresel görüşle kaybı fark eder. Tek bir DOM düğümü
// yeniden kullanılır (her kayıpta yeni eleman yaratıp çöp bırakmaz) ve
// prefers-reduced-motion açıksa hiç oynatılmaz.
let flasEl: HTMLDivElement | null = null
function ekranFlasi() {
  if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return
  if (!flasEl) {
    flasEl = document.createElement('div')
    flasEl.style.cssText = 'position:fixed; inset:0; pointer-events:none; z-index:60; opacity:0;'
      + 'box-shadow: inset 0 0 90px 18px rgba(214,69,69,.62); transition: opacity .45s ease;'
    document.body.appendChild(flasEl)
  }
  const el = flasEl
  el.style.transition = 'none'
  el.style.opacity = '1'
  requestAnimationFrame(() => {
    el.style.transition = 'opacity .45s ease'
    el.style.opacity = '0'
  })
}

/** SERİ İLERLEMESİ (Faz 3.1): sabrı bol müşteriyi hızlı uğurlamak seriyi büyütür.
 *  Yavaş servis seriyi KIRMAZ (yalnız kaçan müşteri kırar) — ceza değil, ödül aracı. */
function comboIlerlet(car: Car, revenue: number) {
  if (car.patienceFrac < 0.6) return
  const oncekiMult = state.comboMult()
  state.combo++
  const yeniMult = state.comboMult()
  // PRİM ÜSTÜNE EKLENİR, geliri ÇARPMAZ: temel gelir çağıran yerde zaten kasaya yazıldı.
  // Böylece ekonomi dengesi tek noktadan (prim oranı) ayarlanabilir kalıyor.
  const prim = Math.round(revenue * (yeniMult - 1))
  if (prim > 0) {
    state.money += prim
    state.stats.revenue += prim
    state.dailyRevenue += prim
  }
  if (yeniMult > oncekiMult) {
    ui.toast(t('SERİ ×{0} — hızlı servis primi!', yeniMult.toFixed(2)), 'good')
    audio.combo(state.combo)
  }
}

function concludeService(car: Car, score: number, revenue = 0) {
  comboIlerlet(car, revenue)
  if (car.isTruck && state.hasTruckPark && car.phase === 'atPump' && Math.random() < 0.45) {
    trackDaily(score)
    state.addRep((score - 3.3) * 0.1)
    car.showFeedback(emojiFor(score))
    car.hideBubble()
    car.filling = false
    car.beingServed = false
    if (ui.activeCar === car) autoSelect(nextServableCar())
    if (cars.sendTruckToParkFromPump(car)) return
    cars.releaseCar(car)
    return
  }
  trackDaily(score)
  // YAĞ DEĞİŞİMİ DRIVE-IN (Oğuz: "arabalar yağ değişiminin içine girsinler"):
  // körük boşsa araç garaj kapısından içeri sürer, işi bitince kapıdan çıkar gider.
  // Körük dolu/tesis yoksa eski hızlı akış (vehicleServices anında öder) devam eder.
  const oilB = (car.wantsOil && !car.isTruck) ? world.buildings.find(x =>
    ((x.id === 'oil' && state.hasOil) || (x.id === 'oil2' && state.hasOil2))
    && ((x.group.position.x > ROAD_X) === (car.station === 'far'))) : undefined
  if (oilB && !oilBusy.has(oilB.id)) {
    car.wantsOil = false // ödül körük çıkışında — vehicleServices çifte ödemesin
    let localScore = score + missingPenalty(car) + vehicleServices(car) + 0.25
    for (const v of facilityVisits(car)) { // diğer tesis ziyaretleri hızlı modda ödensin
      const m = v.revenue()
      if (m > 0) { state.addPending(v.buildingId, m, facName(v.buildingId)); ui.toast(v.toastMsg(m), 'good') }
      localScore += v.score
    }
    const entry = oilB.group.localToWorld(new THREE.Vector3(3.4, 0, 0)); entry.z = 0
    const inside = oilB.group.localToWorld(new THREE.Vector3(-0.1, 0, 0)); inside.z = 0
    const rot = Math.atan2(inside.y - entry.y, inside.x - entry.x)
    if (cars.sendToOilBay(car, entry, inside, rot)) {
      oilBusy.set(oilB.id, car)
      oilPending.set(car, { bayId: oilB.id, score: localScore, t: 0, started: false, exit: entry.clone() })
      if (ui.activeCar === car) autoSelect(nextServableCar())
      return
    }
  }
  score += missingPenalty(car) + vehicleServices(car)
  const visits = facilityVisits(car)
  if (visits.length > 0 && cars.sendToParking(car)) {
    pendingVisits.set(car, { visits, score, started: false })
    if (parkInfoShown < 2) { parkInfoShown++; ui.toast(t('Müşteri aracını otoparka çekti, tesisleri kullanacak.'), '') } // eğitici: oturumda 2 kez yeter (bildirim spam fixi)
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
  if (ui.activeCar === car) autoSelect(nextServableCar())
}

/** defter kararı bekleyen tekneler (aynı tekneye iki kez sorulmasın) */
const logbookPending = new Set<Car>()
const BOAT_NAMES = ['MAVİ RÜZGAR', 'DENİZ YILDIZI', 'REİS', 'POYRAZ', 'KISMET', 'LODOS', 'MARTI', 'YAKAMOZ']
function boatName(car: Car): string {
  // determinist: aynı tekne hep aynı isimle anılır (araç kimliği üzerinden)
  const anyCar = car as unknown as { __bn?: string }
  if (!anyCar.__bn) anyCar.__bn = BOAT_NAMES[Math.floor(Math.random() * BOAT_NAMES.length)]
  return anyCar.__bn
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
    // eğitimli personel daha çok bahşiş alır; kasabada müdavim payı kadar ek cömertlik (§6.2)
    const tip = Math.round(revenue0 * ((car.windowsCleaned ? 0.2 : 0.1) + state.staffTipBonus()) * state.regularsTipMult())
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
    ui.toast(t('Pompacı sattı: +₺{0}', Math.round(revenue)), 'good', true)
  }
  // PREMIUM SEGMENT primi (Katman 1c): premium müşteri aynı litreye daha yüksek marj öder.
  // Marj = fiyat − alış; prim yalnız MARJ üzerine bindirilir (litre fiyatı bozulmaz).
  if (car.marginMult > 1 && car.nozzle) {
    const marginPerL = Math.max(0, car.priceOf(car.nozzle) - state.buyPrice(car.nozzle)) // piyasa alışına göre marj
    const bonus = Math.round(car.filled * marginPerL * (car.marginMult - 1))
    if (bonus > 0) {
      revenue += bonus
      ui.toast(t('Premium müşteri primi: +₺{0}', bonus), 'good')
    }
  }
  // MARKA YILDIZI (prestij) kalıcı gelir çarpanı — devir yatırımının geri dönüşü
  if (state.brandStars > 0) {
    const boost = Math.round(revenue * (state.prestigeMult() - 1))
    if (boost > 0) revenue += boost
  }
  // ---- ÖTV'SİZ YAKIT ALIM DEFTERİ (marina §6.5.3) ----
  // Balıkçı teknesi vergi muafiyetli yakıt için defter ibraz eder. Karar oyuncunun:
  // incele → onayla/reddet. Yanlış karar pahalı. Kara şubelerinde bu blok hiç çalışmaz.
  if (state.isMarina && car.boat === 'balikci' && !logbookPending.has(car)) {
    logbookPending.add(car)
    const lb = makeLogbook(state.day, state.stats.served, boatName(car), Math.max(50, Math.round(car.filled || 800)))
    const full = state.prices.dizel
    // POMPACI İNCELEMESİ (Oğuz: "defter incelemesini de pompacı yapsın") — bu pompada
    // pompacı çalışıyorsa defteri o inceler: görünür kusur varsa reddeder, yoksa onaylar.
    // Modal hiç açılmaz; sonuç toast'la raporlanır.
    if (car.slotIndex >= 0 && state.autoPumps.has(car.slotIndex)) {
      const choice = (lb.genuine && logbookFlags(lb).length === 0) ? 'approve' as const : 'reject' as const
      const out = resolveLogbook(lb, choice, revenue)
      state.money = Math.max(0, state.money + out.money)
      state.addRep(out.rep)
      if (out.violation) state.marinaViolations++
      if (out.correct) state.logbookOk++; else state.logbookBad++
      ui.toast(`${t('Pompacı defteri inceledi')} — ${out.msg}`, out.correct ? 'good' : 'bad')
      logbookPending.delete(car)
      persist()
      // openLogbook akışına GİRME — pompacı halletti
      state.money += revenue
      state.stats.served++
      state.stats.revenue += revenue
    state.dailyRevenue += revenue
      state.addSideRevenue(car.station === 'far', revenue)
      if (car.nozzle) state.addContractDelivery(car.nozzle, car.filled)
      if (car.nozzle) { state.stats.liters[car.nozzle] += car.filled; state.dailyLiters += car.filled }
      car.filling = false
      concludeService(car, score, revenue)
      return
    }
    openLogbook(lb, t('Balıkçı Teknesi'), state.buyPrice('dizel') * 1.08, full, (choice, inspected) => {
      const out = resolveLogbook(lb, choice, revenue)
      state.money = Math.max(0, state.money + out.money)
      state.addRep(out.rep)
      if (out.violation) state.marinaViolations++
      if (out.correct) state.logbookOk++; else state.logbookBad++
      ui.toast(out.msg, out.money < 0 || !out.correct ? 'bad' : 'good')
      if (!inspected && !out.correct) {
        ui.toast(t('İpucu: karar vermeden önce İNCELE — kusurlu defterin mutlaka görünür bir işareti olur.'), '')
      }
      logbookPending.delete(car)
      persist()
    })
  }
  state.money += revenue
  state.stats.served++
  state.stats.revenue += revenue
  state.dailyRevenue += revenue
  state.addSideRevenue(car.station === 'far', revenue) // #317: yaka bazlı ciro ayrımı
  // aktif sözleşme: bu satışın litresi taahhüde sayılır (yalnız sözleşmenin yakıtı)
  if (car.nozzle) state.addContractDelivery(car.nozzle, car.filled)
  if (car.nozzle) { state.stats.liters[car.nozzle] += car.filled; state.dailyLiters += car.filled }
  car.filling = false
  concludeService(car, score, revenue)
}

function wrongFuel(car: Car) {
  car.wrongFuelHandled = true
  car.filling = false
  const wfPenalty = Math.round((state.graceActive ? 100 : WRONG_FUEL_PENALTY) * state.damageMult()) // sigorta hasarı yarılar
  state.money -= wfPenalty
  state.addRep(-0.4)
  ui.toast(t('{0} isteyen araca {1} bastın! -{2} ₺', FUEL_LABEL[car.demandType], FUEL_LABEL[car.nozzle!], wfPenalty), 'bad')
  car.showFeedback('😡')
  cars.releaseCar(car)
  if (ui.activeCar === car) autoSelect(nextServableCar())
}

// ---- EV şarj ----

ui.onDismiss = car => {
  if (car.squatting) {
    car.squatting = false
    cars.releaseCar(car)
    ui.toast('Molacı uğurlandı — şarj yeri boşaldı.', 'good')
    if (ui.activeCar === car) autoSelect(nextServableCar())
    return
  }
  if (car.phase !== 'atPump' || car.filling || car.filled > 0) return
  // #740 (oyuncu: "şarjdaki müşteri uğurlanınca para bırakmıyor").
  // KÖK NEDEN: yukarıdaki kapı YAKIT alanlarına bakıyor (`filling`/`filled`). Şarjdaki
  // araçta bunlar hep 0/false olduğu için ELEKTRİKLİ araç bu kapıdan geçip parasız
  // gönderiliyordu — oysa kWh bataryadan araca AKARKEN depodan çoktan düşülmüştü
  // (tickEvCharging). Yani oyuncu hem elektriği hem de bedelini kaybediyordu.
  // Artık teslim edilen kWh her hâlükârda faturalanır; yalnız TALEBİ karşılanmamış
  // müşteri itibar cezası doğurur.
  const teslim = car.kind === 'ev' ? Math.max(0, car.chargedKwh || 0) : 0
  if (teslim > 0.05) {
    car.charging = false
    const paid = state.settleCharge(teslim, car.station === 'far')
    ui.toast(t('{0} kWh teslim edilmişti — +₺{1} tahsil edildi.', teslim.toFixed(1), paid.toLocaleString('tr-TR')), 'good')
  }
  state.addRep(-0.1)
  car.showFeedback('😐')
  if (teslim <= 0.05) ui.toast('Müşteri kibarca gönderildi.', '')
  cars.releaseCar(car)
  if (ui.activeCar === car) autoSelect(nextServableCar())
}

ui.onCleanWindows = car => {
  if (car.phase !== 'atPump' || car.windowsCleaned) return
  car.cleanWindows()
  ui.toast(t('Ön cam pırıl pırıl — bahşiş şansı arttı!'), 'good')
}

/** batarya deposu seviyesine göre araca akış hızı (kWh/sn) */
// Depodan araca akış hızı (kWh/sn) — kademeyle büyür. Yoksa 4500 kWh'lik depo
// 40 kWh/sn ile boşalır ve büyük yatırım hissedilmez.
const DISCHARGE_RATE = [0, 15, 25, 40, 60, 85, 120]

function startCharging(car: Car, auto = false) {
  if (car.phase !== 'atPump' || car.charging || car.squatting) return
  if (state.dieselRunning() && Math.random() < 0.35) {
    car.demandKwh = Math.ceil(car.demandKwh / 2)
    ui.toast('Jeneratör gürültüsünden rahatsız — yarısı kadar şarj isteyecek!', 'bad')
  }
  car.charging = true
  car.beingServed = true
  if (auto && autoChargeShown < 2) { autoChargeShown++; ui.toast('Otomatik şarj başladı.', '', true) } // eğitici: oturumda 2 kez
  else if (state.battery < 1) ui.toast('Depo şu an boş — üretim geldikçe şarj yavaş akacak.', '')
}

ui.onChargeEV = car => startCharging(car)

/** kademeli EV şarjı: depo → araç akışı */
function tickEvCharging(dt: number) {
  const cap = DISCHARGE_RATE[state.batteryLevel] || 0
  // MOLACI OTOMASYONU (25 şikayet): ünitede şarjcı varsa 8 sn'de, yoksa Sv.3 müdür
  // 25 sn'de molacıyı kendiliğinden uğurlar. Oyuncu istersa yine elle (daha erken) gönderebilir.
  for (const c of cars.cars) {
    if (!c.squatting) continue
    c.squatT += dt
    const hasStaff = c.slotIndex >= 0 && state.autoChargers.has(c.slotIndex)
    const limit = hasStaff ? 8 : (state.managerLevel >= 3 ? 25 : Infinity)
    if (c.squatT >= limit) {
      c.squatting = false
      cars.releaseCar(c)
      ui.toast(hasStaff ? t('Şarjcı molacıyı uğurladı — ünite boşaldı.') : t('Müdür molacıyı uğurladı — ünite boşaldı.'), 'good')
      if (ui.activeCar === c) autoSelect(nextServableCar())
    }
  }
  for (const c of cars.cars) {
    if (!c.charging) continue
    if (c.phase !== 'atPump') { c.charging = false; continue }
    if (c.slotIndex >= 0 && state.brokenChargers.has(c.slotIndex)) {
      const bozukSarj = c.slotIndex   // releaseCar slotu boşaltıyor → önce yakala
      c.charging = false
      ui.toast(t('Şarj ünitesi arızalandı — şarj durdu, tamir gerekli.'), 'bad')
      notifyIfHidden(t('Şarj ünitesi arızalandı — tamir gerekli!'), 'ariza-sarj')
      cars.releaseCar(c)
      teklifUcretsizTamir('charger', bozukSarj)
      continue
    }
    const need = c.demandKwh - c.chargedKwh
    const give = Math.min(need, cap * dt, state.battery)
    state.battery = Math.max(0, state.battery - give)
    c.chargedKwh += give
    c.setCounter(`${Math.floor(c.chargedKwh)}/${c.demandKwh} kWh`)
    if (c.chargedKwh >= c.demandKwh - 0.001) {
      c.charging = false
      // TAHSİLAT TEK KAPIDAN (state.settleCharge): tamamlanan şarj ile yarıda uğurlanan
      // araç aynı yoldan geçsin — #740'ta ikisi ayrıydı ve biri hiç ödeme yapmıyordu.
      // (Yaka bazlı ciro ayrımı #317 de artık o tek kapının içinde.)
      const revenue = state.settleCharge(c.demandKwh, c.station === 'far')
      state.stats.served++
      let score = 4.5
      if (c.patienceFrac < 0.4) score -= 1.5
      ui.toast(t('{0} kWh şarj tamamlandı: +₺{1}', c.demandKwh, revenue), 'good')
      const anyFacility = state.marketLevel > 0 || state.toiletLevel > 0 || state.hasCoffee || state.hasRestaurant
      if (anyFacility && Math.random() < 0.12) {
        // işgalci: aracı ünitede bırakıp tesislere gidiyor — GÖNDER'e basılana dek yer dolu
        c.squatting = true
        c.squatT = 0
        c.beingServed = true
        c.setCounter(t('MOLADA · GÖNDER →'))
        const visits = facilityVisits(c)
        spawnWalkerFor(c, { visits, score, squat: true })
        ui.toast(t('Molacı üniteyi tutuyor — göndermek için araca dokun'), 'bad')
      } else {
        concludeService(c, score, revenue)
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
ui.onOrderLiters = (f, liters) => { state.setOrderLiters(f, liters) } // elle litre girişi (B4)

/** Karşı kapının (x≈10.3–12.9 bandı) verilen y'de mevcut bir karşı-yapıyla çakışıp çakışmadığı */
function farGateBlockedAt(y: number): boolean {
  return placedRects.some(p => {
    if (p.id === 'gatein2' || p.id === 'gateout2') return false
    const px0 = p.cx - p.w / 2, px1 = p.cx + p.w / 2
    if (px1 < 10.3 || px0 > 12.9) return false // kapı x-bandıyla kesişmiyor
    return Math.abs(p.cy - y) < 1.9 + p.d / 2
  })
}
/** Tercih edilen y'den başlayıp mevcut karşı-yapıdan KAÇAN boş kapı y'si bul (avoidY'den ≥6 uzak) */
function clearFarGateY(prefY: number, avoidY: number | null): number {
  for (let step = 0; step <= 26; step += 2) {
    for (const y of (step === 0 ? [prefY] : [prefY + step, prefY - step])) {
      if (y < -22 || y > 22) continue
      if (avoidY !== null && Math.abs(y - avoidY) < 6) continue
      if (!farGateBlockedAt(y)) return y
    }
  }
  return prefY // temiz yer yok (çok nadir) — varsayılana düş
}
/** Karşı istasyonu, kapıları mevcut karşı-yapılardan kaçıran boş y'lere kurarak aç */
function enableFarStationClear() {
  if (world.farStationOn) return
  const inY = clearFarGateY(8, null)      // giriş üstte (+y), far araç güneye iner
  const outY = clearFarGateY(-8, inY)     // çıkış altta (-y), girişten ≥6 uzak
  world.enableFarStation(inY, outY)
  // KALICILIK (oyuncu raporu "karşı taraftaki kapılar kayboluyor"): bayrak artık kayda
  // giriyor — yenilemede karşı istasyon "karşıda pompa var mı" tahmininden değil,
  // state'ten geri gelir. Kapı y'lerini de HEMEN placedPos'a yazıyoruz: yoksa her
  // açılışta clearFarGateY yeniden hesaplıyor ve karşı yakaya yeni bina konunca
  // kapılar kendiliğinden kayıyordu ("kapılar yer değiştiriyor").
  state.farStationOn = true
  if (!placedPos.gatein2) placedPos.gatein2 = [FAR_GATE_X, inY]
  if (!placedPos.gateout2) placedPos.gateout2 = [FAR_GATE_X, outY]
}

/** satın alma sonrası sahnedeki görsel karşılığını kurar */
/** Sahne değişti: gölge haritasını BİR KARE güncelle (autoUpdate kapalı, bkz. renderer kurulumu). */
function golgeTazele() { renderer.shadowMap.needsUpdate = true }

function buildVisual(id: string, pos?: THREE.Vector2) {
  golgeTazele()
  const base = id.split('#')[0]
  // pos = footprint MERKEZİ; gövde ofseti açıyla döner (bkz. unitBodyPos)
  if (base.startsWith('pump-') && pos) {
    const rot = placedRot[id] ?? 0
    world.addPump(parseInt(base.slice(5)), unitBodyPos(base, pos.x, pos.y, rot), rot)
    return
  }
  if (base.startsWith('charger-') && pos) {
    const rot = placedRot[id] ?? 0
    world.addEvCharger(parseInt(base.slice(8)), unitBodyPos(base, pos.x, pos.y, rot), rot)
    return
  }
  if (base.startsWith('tankadd-')) {
    world.upgradeTankVisual(state.tankLevel) // yakıta özel yeni tank belirir
    return
  }
  // YERİNDE YÜKSELTMEDE İKİZ BİNA OLMASIN (bkz. tekilKur notu): world.buildToilet gibi
  // bazı kurucular ikinci çağrıda eski grubu SAHNEDE bırakıp yalnız kayıttan düşürüyordu
  // → karşı tuvalet Sv.2'ye çıkınca Sv.1 gövdesi haritada tıklanamaz enkaz olarak kalıyordu
  // ("tuvalet mapimde buga girdi"). Kayıtta olmayan id için no-op, yeni kurulumu etkilemez.
  // İSTİSNA (KENDİ GRUBUNU YÖNETENLER): tank tek bir kalıcı gruptur (buildTankCluster
  // yeniden REGISTER ETMEZ) — sökersek yakıt tankı büsbütün kaybolur. Tabela/geniş kapı/
  // pompa/şarj de kendi temizliğini yapar, dokunmuyoruz.
  if (!KENDI_TEMIZLEYEN.has(base)) world.removeBuildingGroup(id)
  switch (base) {
    case 'pump': world.addPump(state.pumps - 1); break
    case 'sign': world.setSign(state.signLevel, pos); break
    case 'widegate': world.setWideGates(true); break
    case 'tank': world.upgradeTankVisual(state.tankLevel); break
    case 'market': world.buildMarket(state.marketLevel, pos); break
    case 'market2': world.buildMarket(state.market2Level, pos, 'market2'); break
    case 'toilet2': world.buildToilet(state.toilet2Level, pos, 'toilet2'); break
    case 'wash2': world.buildWash(pos, 'wash2'); break
    case 'oil2': world.buildOil(pos, 'oil2'); break
    case 'coffee2': world.buildCoffee(pos, 'coffee2'); break
    case 'restaurant2': world.buildRestaurant(pos, 'restaurant2'); break
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
    case 'truckpark2': world.buildTruckPark(pos, 'truckpark2'); break
    case 'hotel': world.buildHotel(pos); break
    case 'airwater': world.buildAirWater(pos, id); break
    case 'lamp': world.buildStreetLamp(pos, id); break
    case 'selfwash': world.buildSelfWash(pos, id); break
    case 'parking': world.buildParking(pos, id); break
    case 'office': world.buildOffice(pos); break
    default:
      // MARİNA: tesis kurulunca ada üzerinde yapısı belirsin (7 rapor: "yat klübü
      // açtım ama gözükmüyor"). Bağlama yerleri de sahnede uzayan iskele olur.
      if (state.isMarina && state.hasMarinaFac(base as MarinaFacId)) world.buildMarinaFac(base, pos)
      else if (base.startsWith('berth_') || base === 'winterslot') world.updateBerthVisual(state.berths)
      break
  }
}

// ---- Grid'e yerleştirme modu ----

interface Footprint { w: number; d: number; grass?: boolean }
const PLACEABLE: Record<string, (forMove: boolean) => Footprint> = {
  market: () => ({ w: 6, d: 7 }), // 3 seviyede de AYNI footprint (yerinde yükselir, yıkmak gerekmez)
  market2: () => ({ w: 6, d: 7 }), // karşı yaka marketi — aynı footprint
  toilet2: () => ({ w: 3, d: 4 }),
  wash2: () => ({ w: 4.5, d: 5 }),
  oil2: () => ({ w: 4, d: 4 }),
  coffee2: () => ({ w: 3.2, d: 3.2 }),
  restaurant2: () => ({ w: 5.5, d: 6 }),
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
  truckpark2: () => ({ w: 8, d: 6 }), // karşı yaka tır parkı
  hotel: () => ({ w: 7, d: 10 }), // iki katlı blok + giriş kanopisi
  airwater: () => ({ w: 1.6, d: 2 }),
  lamp: () => ({ w: 1.2, d: 1.2, grass: true }), // dekoratif: çimen üstüne de konabilir
  selfwash: () => ({ w: 5.5, d: 7 }),
  parking: () => ({ w: 5.2, d: 3.2 }), // park aralığı genişledi (araçlar sığmıyordu)
  office: () => ({ w: 5, d: 5.5 }),
  sign: () => ({ w: 1.8, d: 1.8, grass: true }), // tabela taşınabilir (çimen üstüne de konabilir)
}

interface Rect { cx: number; cy: number; w: number; d: number }
const placedRects: (Rect & { id: string })[] = []
const placedPos: Record<string, [number, number]> = {}
const groundPlane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0)

// ---- Kayıt sistemi ----

let lastRemotePush = 0
let pendingPush: number | null = null // throttle penceresinde bekleyen garanti push (persist)
// Offline pompacı satışı sabitleri (applyOfflineEarnings + tank-düşük bildirimi aynı oranı kullanır)
const OFFLINE_FUELS = ['benzin', 'dizel', 'lpg'] as const
const OFFLINE_LPS = 0.3 // pompacı başına L/sn (~aktif temponun yarısı)

/** Oyuncu yokken (oyun kapalı VEYA sekme arka planda) geçen süreyi pasif kazanca çevirir:
 *  kumbaralı tesisler + idle tesis geliri + pompacı yakıt satışı. Açılıştaki offline raporla
 *  AYNI formül/tavanlar (90 sn eşik, 2 saat cap) — tek kaynaktan yürür ki dengeler ayrışmasın.
 *  Dönüş: oyuncuya yansıyan toplam ₺ (0 = işlemedi). */
function applyAwayEarnings(offSecRaw: number): number {
  if (isFullMode || state.closed) return 0
  const offSec = Math.min(offSecRaw, 7200) // en fazla 2 saatlik birikim
  if (offSec <= 90) return 0
  let total = 0
  // kumbaralı tesisler (topla-hook'u): tır parkı, self yıkama, oto yıkama, hava-su
  const gains: [string, string, number][] = []
  if (state.hasTruckPark) gains.push(['truckpark', t('Tır parkı'), 125 / 45])
  if (state.hasTruckPark2) gains.push(['truckpark2', t('Karşı tır parkı'), 125 / 45])
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
  // POMPACILI pompalar offline YAKIT SATAR: tank gerçekten azalır, satış kasaya girer.
  const attended = [...state.autoPumps].filter(i => !state.brokenPumps.has(i)).length // bozuk pompadaki pompacı satamaz
  if (attended > 0) {
    const totalStock = OFFLINE_FUELS.reduce((a, f) => a + Math.max(0, state.tanks[f]), 0)
    const toSell = Math.min(OFFLINE_LPS * attended * offSec, totalStock, 6000)
    if (toSell > 1 && totalStock > 0) {
      let fuelCash = 0
      for (const f of OFFLINE_FUELS) {
        const share = Math.max(0, state.tanks[f]) / totalStock
        const sell = Math.min(Math.max(0, state.tanks[f]), toSell * share)
        state.tanks[f] -= sell
        fuelCash += sell * state.prices[f]
        state.addContractDelivery(f, sell) // offline satış da taahhüde sayılır (yoksa otomasyon sözleşmeyi sabote ediyordu)
      }
      fuelCash = Math.round(fuelCash)
      state.money += fuelCash
      total += fuelCash
      ui.toast(t('Pompacıların sen yokken ~{0}L yakıt sattı (+₺{1}) — tank seviyelerine göz at!',
        Math.round(toSell).toLocaleString('tr-TR'), fuelCash.toLocaleString('tr-TR')), 'good', true)
    }
  }
  if (total > 0) {
    ui.toast(t('Sen yokken tesislerin çalıştı: ~₺{0} kazandın — kumbaraları topla!', total.toLocaleString('tr-TR')), 'good', true)
    audio.cash()
  }
  return total
}

// SEKME ARKA PLAN (Oğuz, 17 Ağu): oyun arka planda artık GERÇEKTEN akıyor (worker
// sürücüsü, frame döngüsünün sonunda) — dönüşte "kazanç yaz" telafisi KALDIRILDI (çifte
// ödeme olurdu). applyAwayEarnings yalnız SAYFA AÇILIŞINDA çalışır (tarayıcı kapalıyken).
// Buluttan kayıt YÜKLENEMEDİYSE (ağ/sunucu hatası) hiçbir kayıt gönderilmez —
// taze bir oturumun ilerlemiş bulut kaydını EZMESİNİ önler (override koruması).
let cloudBlocked = false
// Buluttan kayıt bu SAYFA oturumunda okundu mu? Okunmadıysa elimizdeki state hesabın
// gerçek ilerlemesi DEĞİLDİR (ör. gate'te login olup reload bekleyen taze sayfa) →
// hiçbir yazma yapılmaz. Bu bayrak olmadan pagehide/autosave hesabı gün-1'e düşürüyordu.
let cloudSynced = false
// "BAŞTAN BAŞLA" SÜRERKEN HER KAYIT YOLU SUSAR. Kritik: location.reload() `pagehide`
// tetikler, o da flushSaveNow() → auth.saveGuest() çağırır — yani yeni sildiğimiz misafir
// kaydı reload'un TAM İÇİNDE geri yazılırdı ve sıfırlama hiç olmamış gibi görünürdü.
let sifirlaniyor = false

function savePayload() {
  return { s: serializeState(state), placedPos, placedRot, placedRects, at: Date.now() }
}

// ---- Çoklu cihaz senkronu ----
let syncing = false
let syncedConflict = false
/** Save'i sunucuya yaz; başka cihaz daha yeni yazmışsa (409) en güncele senkronla. */
let saveFails = 0
async function syncSave() {
  if (syncing || cloudBlocked || auth.isKicked() || !auth.loggedIn() || !cloudSynced) return
  syncing = true
  try {
    const r = await auth.pushSave(savePayload())
    if (r.kicked) { showKickedOverlay(); return }
    if (r.conflict && !syncedConflict) { syncedConflict = true; onRemoteNewer() }
    saveFails = 0
  } catch {
    // Kayıt SESSİZCE düşmesin: üst üste başarısızlıkta oyuncuyu uyar (yoksa oyuncu
    // kaydettiğini sanıp çıkıyor ve ilerlemesini kaybediyor).
    if (++saveFails === 3) ui.toast(t('Bulut kaydı yapılamıyor — bağlantını kontrol et, ilerlemen kaydedilmiyor!'), 'bad', true)
  } finally { syncing = false }
}
// Tek-cihaz kilidi: başka cihaz oturumu devralınca burası duraklar (ilerleme güvende).
function showKickedOverlay() {
  cloudBlocked = true // kayıt + oyun + WS durur
  if (document.getElementById('kickedblock')) return
  const o = document.createElement('div')
  o.id = 'kickedblock'
  o.style.cssText = 'position:fixed;inset:0;z-index:99999;background:#1a0d0df5;display:flex;align-items:center;justify-content:center;padding:24px;backdrop-filter:blur(4px)'
  o.innerHTML = `<div style="max-width:420px;text-align:center;color:#eaf1fb;font-family:system-ui,sans-serif">
    <div style="font-size:44px;margin-bottom:8px"></div>
    <div style="font-size:20px;font-weight:800;margin-bottom:10px">${t('Başka cihazda açıldı')}</div>
    <div style="font-size:14px;line-height:1.5;color:#e0b8b8;margin-bottom:20px">${t('Bu hesap başka bir cihazda açıldığı için burada duraklatıldı. İlerlemen güvende — hiçbir şey silinmedi. Buradan devam etmek için yenile.')}</div>
    <button id="kicked-retry" style="padding:12px 22px;font-size:15px;font-weight:700;border:0;border-radius:12px;background:#d64545;color:#fff;cursor:pointer">${t('Buradan devam et (Yenile)')}</button>
  </div>`
  document.body.appendChild(o)
  document.getElementById('kicked-retry')?.addEventListener('click', () => location.reload())
}
auth.onKicked(showKickedOverlay)
/** başka cihaz daha yeni oynadı → clobber etme, en güncel ilerlemeye temiz reload ile senkronla */
function onRemoteNewer() {
  ui.toast(t('Başka bir cihazda oynanmış — en güncel ilerlemeye senkronlanıyor…'), '')
  setTimeout(() => location.reload(), 1400)
}

function showCloudBlockOverlay() {
  if (document.getElementById('cloudblock')) return
  const o = document.createElement('div')
  o.id = 'cloudblock'
  o.style.cssText = 'position:fixed;inset:0;z-index:99999;background:#0d1420f2;display:flex;'
    + 'align-items:center;justify-content:center;padding:24px;backdrop-filter:blur(4px)'
  o.innerHTML = `<div style="max-width:420px;text-align:center;color:#eaf1fb;font-family:system-ui,sans-serif">
    <div style="margin-bottom:8px"><svg width="44" height="44" viewBox="0 0 24 24" style="color:#b8c6da"><use href="#i-cloud"/></svg></div>
    <div style="font-size:20px;font-weight:800;margin-bottom:10px">${t('Buluta bağlanılamadı')}</div>
    <div style="font-size:14px;line-height:1.5;color:#b8c6da;margin-bottom:20px">${t('İlerlemeni korumak için oyun durduruldu. Kaydın güvende — hiçbir şey silinmedi. Bağlantı gelince yenile.')}</div>
    <button id="cloudblock-retry" style="padding:12px 22px;font-size:15px;font-weight:700;border:0;border-radius:12px;background:#2f6fed;color:#fff;cursor:pointer">${t('Yenile')}</button>
  </div>`
  document.body.appendChild(o)
  ;(document.getElementById('cloudblock-retry') as HTMLButtonElement).addEventListener('click', () => location.reload())
}

/** İZAHAT EKRANI: izahat-banlı hesap girişte bunu görür; savunması /api/appeal ile
 *  admin paneline düşer. TR/EN i18n'den gelir (Oğuz: "türkçe ve ingilizce dil desteği"). */
function showAppealOverlay(token?: string) {
  if (document.getElementById('appealblock')) return
  cloudBlocked = true // kayıt + oyun durur; tek kanal izahat formu
  try { liveWs?.close() } catch { /* kapalı olabilir */ }
  // Marka dili: tabela tarzı kırmızı başlık + BENELOIL rozeti, krem kart, Baloo 2
  // (Oğuz: "oyuna benzer şekilde tasarım yap, logo koy, font bizim sisteme benzesin")
  const o = document.createElement('div')
  o.id = 'appealblock'
  o.style.cssText = 'position:fixed;inset:0;z-index:100000;background:rgba(34,48,60,.58);display:flex;'
    + 'align-items:center;justify-content:center;padding:24px;backdrop-filter:blur(5px);overflow:auto;font-family:var(--font,"Baloo 2",sans-serif)'
  o.innerHTML = `<div style="max-width:420px;width:100%;background:var(--paper,#faf6ec);border-radius:18px;overflow:hidden;box-shadow:0 18px 50px rgba(15,22,30,.4);border-bottom:4px solid rgba(34,48,60,.2)">
    <div style="background:var(--red,#d64545);padding:18px 20px 16px;text-align:center;border-bottom:4px solid var(--red-dark,#b23434)">
      <div style="display:inline-block;background:var(--paper,#faf6ec);color:var(--red,#d64545);font-weight:800;letter-spacing:1.5px;padding:3px 16px;border-radius:999px;font-size:13px">BENELOIL</div>
      <div style="color:#fff;font-weight:800;font-size:19px;margin-top:10px">${t('Hesabın incelemede')}</div>
    </div>
    <div id="appeal-body" style="padding:18px 20px 20px">
      <div style="font-size:14px;line-height:1.55;color:var(--ink,#22303c);margin-bottom:14px">${t('Hesabınızda şüpheli gelir/gider dengesizliği tespit ettik, lütfen izahat veriniz.')}</div>
      <textarea id="appeal-msg" maxlength="2000" rows="6" placeholder="${t('İzahatını buraya yaz…')}"
        style="width:100%;box-sizing:border-box;padding:12px;border-radius:var(--r-md,13px);border:1.5px solid var(--edge,rgba(34,48,60,.32));background:#fff;color:var(--ink,#22303c);font-size:14px;font-family:var(--font,inherit);resize:vertical"></textarea>
      <div id="appeal-err" style="font-size:13px;color:var(--red-dark,#b23434);min-height:18px;margin:6px 0"></div>
      <button id="appeal-send" style="width:100%;padding:13px;border:0;border-radius:var(--r-md,13px);background:var(--green,#27a05a);border-bottom:3px solid var(--green-dark,#1d7c45);color:#fff;font-weight:800;font-size:15px;font-family:var(--font,inherit);cursor:pointer">${t('İzahat Gönder')}</button>
    </div>
  </div>`
  document.body.appendChild(o)
  const btn = document.getElementById('appeal-send') as HTMLButtonElement
  btn.addEventListener('click', async () => {
    const msg = (document.getElementById('appeal-msg') as HTMLTextAreaElement).value.trim()
    const errEl = document.getElementById('appeal-err') as HTMLDivElement
    errEl.textContent = ''
    if (msg.length < 10) { errEl.textContent = t('İzahat çok kısa — lütfen durumu açıklayın.'); return }
    btn.disabled = true
    try {
      const res = await fetch('/api/appeal', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-auth': token ?? localStorage.getItem('benzinlik-token') ?? '' },
        body: JSON.stringify({ message: msg }),
      })
      const d = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(d.error ?? t('Gönderilemedi, sonra tekrar dene.'))
      const body = document.getElementById('appeal-body')!
      body.innerHTML = `<div style="text-align:center;padding:6px 0 4px">
        <div style="font-size:18px;font-weight:800;color:var(--green-dark,#1d7c45);margin-bottom:8px">${t('İzahatın alındı')} ✓</div>
        <div style="font-size:14px;line-height:1.55;color:var(--ink,#22303c)">${t('Ekibimiz inceledikten sonra hesabınla ilgili karar e-postana bildirilecek.')}</div>
      </div>`
    } catch (e2) {
      btn.disabled = false
      errEl.textContent = (e2 as Error).message
    }
  })
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
    <div style="font-size:46px;margin-bottom:8px"></div>
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
    <div style="font-size:44px;margin-bottom:6px"></div>
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

// ---- Misafir eşiği: kayıtsız GUEST_MAX_DAY oyun günü serbest; sonra kayıt/giriş gate'i (deneme kapısı) ----
const GUEST_MAX_DAY = 5
let guestGateShown = false
let firstTenGateShown = false // ilk-10k dönüşüm kapısı oturumda 1 kez
function maybeGuestGate() {
  if (auth.loggedIn() || guestGateShown || state.day < GUEST_MAX_DAY) return
  guestGateShown = true
  guestPaused = true
  showAuthGate(t('Gün {0}’e ulaştın! Devam etmek için kaydol ya da Google/Apple ile gir — ilerlemen buluta taşınır, üstüne ₺2.500 bonus + günlük seri bonusu başlar.', GUEST_MAX_DAY), true)
}

function persist() {
  // SIFIRLAMA YARIŞI: "Baştan Başla" kaydı sildikten sonra sayfa yenilenene kadar
  // geçen ~yarım saniyede otomatik kayıt tetiklenirse silinen kaydı geri yazardı.
  if (isFullMode || isPromoMode || cloudBlocked || sifirlaniyor) return
  if (!auth.loggedIn()) { // MİSAFİR: ilerlemeyi YERELDE tut; gün-5'te kayıt gate'i aç
    auth.saveGuest(savePayload())
    maybeGuestGate()
    return
  }
  // giriş yapılmış: tek gerçek kaynak SQL. syncSave çoklu cihaz çakışmasını (409) ele alır.
  if (Date.now() - lastRemotePush > 5_000) {
    lastRemotePush = Date.now()
    syncSave()
  } else if (pendingPush === null) {
    // Throttle penceresine denk gelen değişiklik (ör. SATIN ALMA) askıda KALMASIN:
    // pencere kapanınca kesin bir push planla. Yoksa bir sonraki persist tetiğine kadar
    // hiç gönderilmiyordu — iOS'ta uygulama o arada kill edilirse son alışveriş kayboluyordu
    // ("ürün yok para gitmiş" şikâyetinin istemci ayağı; pagehide app-kill'de güvenilmez).
    pendingPush = window.setTimeout(() => {
      pendingPush = null
      lastRemotePush = Date.now()
      syncSave()
    }, 5_200 - (Date.now() - lastRemotePush))
  }
}

let loadedSaveAt = 0

function applySaveData(d: Record<string, unknown>) {
  loadedSaveAt = Number(d.at ?? 0)
  hydrateState(state, (d.s ?? {}) as Record<string, unknown>)
  // GÜVENLİ GİRİŞ (oyuncu: "reaktör ertesi gün kayboluyor" = login sonrası hızlı patlama):
  // sen yokken bakım ekibi reaktörü soğutmuş sayılır — oturum ASLA kritik yıpranmayla
  // başlamaz, reaktör offline'da ve girişin ilk dakikalarında patlayamaz.
  if (state.hasSMR && state.smrWear > 0.55) state.smrWear = 0.55
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
/** Yokken geçen süre kadar pasif gelir. Parametresiz çağrılınca kayıt zamanından, açık
 *  parametreyle sekme/uygulama arka planda kaldığı süreden hesaplar (#1014/#1016
 *  "oyun arka planda çalışmıyor, sekme değiştirsek duruyor"): oyun arka planda rAF'ı
 *  durduruyor (pil/ısınma kararı) ama dönüşte hiçbir telafi YOKTU — yalnız sayfa
 *  yeniden yüklenirse offline gelir işliyordu. */
function applyOfflineEarnings(gecenSn?: number) {
  if (state.closed) return
  if (gecenSn === undefined && !loadedSaveAt) return
  const elapsedSec = gecenSn ?? (Date.now() - loadedSaveAt!) / 1000
  if (elapsedSec < 120) return // <2 dk: anlamsız
  const capped = Math.min(elapsedSec, 6 * 3600) // en fazla 6 saat
  const facilities = (state.marketLevel > 0 ? state.marketLevel : 0)
    + (state.hasCoffee ? 1 : 0) + (state.hasRestaurant ? 1 : 0) + (state.hasWash ? 1 : 0)
    + (state.hasOil ? 1 : 0) + (state.hasTruckPark ? 1 : 0) + state.selfWashCount + (state.hasSMR ? 2 : 0)
  // YAKIT BURADA SATILMAZ (çifte satış fixi, oyuncu raporu "20,5 ton satılmış 50 bin gelmiş"):
  // offline yakıt satışı TEK yerden yürür — pompacılı pompalar bloğu (litre × gerçek fiyat,
  // tank stoğuyla sınırlı). Burası yalnız EV + tesislerin genel çalışma geliri.
  const ratePerSec = 1 + state.evChargers * 0.8 + facilities * 0.6
  const income = Math.min(150_000, Math.round(ratePerSec * capped * 0.4)) // %40 offline verim
  if (income < 50) return
  state.money += income
  showOfflineModal(income, elapsedSec, 0)
}

/** STEAM ANKETİ MODALI: hesap başına 1 kez. Cevap → save + sunucu metriği. */
function showSteamPoll() {
  if (state.steamPoll) return // başka cihazda bu arada cevaplanmış olabilir
  const o = document.createElement('div')
  o.style.cssText = 'position:fixed;inset:0;z-index:99996;background:#0d1420cc;display:flex;align-items:center;justify-content:center;padding:22px;font-family:var(--font,system-ui)'
  o.innerHTML =
    `<div style="background:linear-gradient(180deg,#fdfaf2,#f1ebdb);border:2px solid #e0d4bd;border-bottom-width:7px;border-radius:22px;padding:24px 26px;max-width:360px;width:100%;text-align:center;box-shadow:0 24px 60px rgba(10,14,20,.5)">`
    + `<div style="font-size:40px;line-height:1">🎮</div>`
    + `<div style="font-size:21px;font-weight:800;color:#1e2a36;margin:10px 0 4px">${t('Tek soru patron!')}</div>`
    + `<div style="font-size:14px;font-weight:700;color:#7a6152;line-height:1.5;margin-bottom:16px">${t('Steam kullanıyor musun? (BenelOil için yol haritamıza yön verecek — bir daha sormayacağız)')}</div>`
    + `<button id="sp-yes" style="width:100%;padding:13px;border-radius:14px;border:2px solid #1e5c2f;border-bottom-width:4px;background:linear-gradient(180deg,#35b563,#27a05a);color:#fff;font-weight:800;font-size:16px;cursor:pointer;margin-bottom:9px">${t('Evet, Steam kullanıyorum')}</button>`
    + `<button id="sp-no" style="width:100%;padding:13px;border-radius:14px;border:2px solid #b03535;border-bottom-width:4px;background:linear-gradient(180deg,#e05656,#d64545);color:#fff;font-weight:800;font-size:16px;cursor:pointer;margin-bottom:10px">${t('Hayır, kullanmıyorum')}</button>`
    + `<button id="sp-skip" style="background:none;border:none;font-size:12.5px;font-weight:700;color:#9aa4b0;cursor:pointer;text-decoration:underline">${t('Cevaplamak istemiyorum')}</button>`
    + `</div>`
  document.body.appendChild(o)
  const answer = (v: 'yes' | 'no' | 'skip') => {
    state.steamPoll = v
    persist()
    fetch('/api/metric', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ k: 'steam_' + v }) }).catch(() => {})
    o.remove()
    if (v !== 'skip') ui.toast(t('Teşekkürler patron! 🙏'), 'good')
  }
  o.querySelector('#sp-yes')?.addEventListener('click', () => answer('yes'))
  o.querySelector('#sp-no')?.addEventListener('click', () => answer('no'))
  o.querySelector('#sp-skip')?.addEventListener('click', () => answer('skip'))
}

/** "Tekrar hoş geldin — yokken istasyonun kazandı" modalı (oyunun krem/kırmızı dili) */
function showOfflineModal(income: number, elapsedSec: number, soldL = 0) {
  const h = Math.floor(elapsedSec / 3600), m = Math.floor((elapsedSec % 3600) / 60)
  const dur = h > 0 ? `${h} sa ${m} dk` : `${m} dk`
  const o = document.createElement('div')
  o.style.cssText = 'position:fixed;inset:0;z-index:99997;background:#0d1420cc;display:flex;align-items:center;justify-content:center;padding:22px;font-family:var(--font,system-ui)'
  o.innerHTML =
    `<div style="background:linear-gradient(180deg,#fdfaf2,#f1ebdb);border:2px solid #e0d4bd;border-bottom-width:7px;border-radius:22px;padding:22px 26px;max-width:340px;width:100%;text-align:center;box-shadow:0 24px 60px rgba(10,14,20,.5)">`
    + `<div style="font-size:44px;line-height:1"></div>`
    + `<div style="font-size:22px;font-weight:800;color:#1e2a36;margin:8px 0 2px">Tekrar hoş geldin!</div>`
    + `<div style="font-size:13px;font-weight:700;color:#7a6152">${dur} yoktun — istasyonun senin için çalıştı</div>`
    + `<div style="font-size:34px;font-weight:800;color:#2fa05a;margin:14px 0 2px">+₺${income.toLocaleString('tr-TR')}</div>`
    + `<div style="font-size:11px;font-weight:700;color:#9aa4b0;margin-bottom:${soldL > 0 ? 10 : 16}px">kasana eklendi</div>`
    + (soldL > 0
        ? `<div style="font-size:12.5px;font-weight:750;color:#5c6b76;background:#efe8d6;border-radius:12px;padding:9px 11px;margin-bottom:14px;line-height:1.45">`
          + t('{0} L yakıt satıldı — tank seviyelerine göz at.', soldL.toLocaleString('tr-TR'))
          + `</div>`
        : '')
    + `<button id="off-ok" style="width:100%;padding:12px;border-radius:14px;border:2px solid #b03535;border-bottom-width:4px;background:linear-gradient(180deg,#e05656,#d64545);color:#fff;font-weight:800;font-size:16px;cursor:pointer">Devam et</button>`
    + `</div>`
  document.body.appendChild(o)
  const close = () => o.remove()
  o.querySelector('#off-ok')?.addEventListener('click', close)
  o.addEventListener('click', e => { if (e.target === o) close() })
}

/**
 * HAYALET BİNA KORUMASI (oyuncu raporu: "tuvalet mapimde buga girdi allah rızası için
 * silin ya", "tesisteki kahveci yıkamacı vs. kayboldu geri gelmiyor").
 *
 * world.buildX() ailesinin çoğu (solar/wash/coffee/parking/tır parkı/karşı tuvalet…) aynı
 * id ile İKİNCİ kez çağrılınca eski grubu SAHNEDE BIRAKIP kayda ikinci bir satır ekliyor.
 * Ölçüm: dolu bir istasyonda rebuildFromState iki kez çalıştırıldığında 28 binanın 19'u
 * ikizleniyor. İkiz, `buildings` listesinde ikinci sırada kaldığı için ne seçilebiliyor
 * ne satılabiliyor ne taşınabiliyor (find/removeBuildingGroup hep İLKİNİ bulur) —
 * haritada sonsuza dek duran, tıklanamayan bir enkaz kalıyor.
 *
 * Çözüm: yeniden kurulan her id için ÖNCE eski grubu sök. world.ts'e dokunmadan,
 * kurulumun tek kapısı burası olduğu için tüm yollar (reload + yerinde yükseltme) kapanır.
 */
function tekilKur(id: string, kur: () => void) {
  world.removeBuildingGroup(id)
  kur()
}
/** Grubunu KENDİ yöneten (ya da hiç ayrı grubu olmayan) kurulum id'leri — bunları sökmek
 *  YARARSIZ ya da YIKICI olur (tank: tek kalıcı grup, buildTankCluster re-register etmez). */
const KENDI_TEMIZLEYEN = new Set(['tank', 'sign', 'widegate', 'pump', 'evcharger'])
/** DEVİR RAPORU: devirden sonraki ilk açılışta "ne kazandın" ekranı.
 *  NEDEN: devir sayfayı yeniliyor; oyuncu boş bir arsaya düşüp "ne oldu?" diyordu.
 *  Kalıcı kazançları (sermaye, çarpan, akış, kadro) SAYIYLA gösterip döngüyü kapatıyoruz. */
function maybeShowDevirModal() {
  let r: { stars?: number; cash?: number; seed?: number; mult?: number; flow?: number; manager?: number; staff?: number } | null = null
  try {
    const raw = localStorage.getItem(DEVIR_RAPOR_KEY)
    localStorage.removeItem(DEVIR_RAPOR_KEY) // tek sefer: bozuk veri de olsa bir daha denenmez
    if (raw) r = JSON.parse(raw)
  } catch { return }
  if (!r || typeof r.stars !== 'number') return
  const num = (v: unknown, d = 0) => (typeof v === 'number' && isFinite(v) ? v : d)
  const sat = (ad: string, val: string) =>
    `<div style="display:flex;justify-content:space-between;gap:10px;font-size:13px;font-weight:750;color:#3d4b58;padding:5px 0;border-top:1px solid #e5dcc8"><span>${ad}</span><b style="color:#2fa05a">${val}</b></div>`
  const o = document.createElement('div')
  o.style.cssText = 'position:fixed;inset:0;z-index:99997;background:#0d1420cc;display:flex;align-items:center;justify-content:center;padding:22px;font-family:var(--font,system-ui)'
  const yildiz = '★'.repeat(Math.min(10, Math.max(1, Math.round(num(r.stars, 1)))))
  o.innerHTML =
    `<div style="background:linear-gradient(180deg,#fdfaf2,#f1ebdb);border:2px solid #e0d4bd;border-bottom-width:7px;border-radius:22px;padding:22px 24px;max-width:360px;width:100%;text-align:center;box-shadow:0 24px 60px rgba(10,14,20,.5)">`
    + `<div style="font-size:26px;line-height:1;color:#d9a521;letter-spacing:-.04em">${yildiz}</div>`
    + `<div style="font-size:21px;font-weight:800;color:#1e2a36;margin:8px 0 2px">${t('{0}. marka yıldızı senin!', String(Math.round(num(r.stars, 1))))}</div>`
    + `<div style="font-size:12.5px;font-weight:700;color:#7a6152;margin-bottom:12px">${t('Bunlar KALICI — yeni istasyonun sıfırdan değil, buradan başlıyor.')}</div>`
    + `<div style="text-align:left">`
    + sat(t('Kasana geçti'), `+₺${Math.round(num(r.cash)).toLocaleString('tr-TR')}`)
    + (num(r.seed) > 0 ? sat(t('· kuruluş sermayesi'), `₺${Math.round(num(r.seed)).toLocaleString('tr-TR')}`) : '')
    + sat(t('Gelir çarpanı'), `×${num(r.mult, 1).toFixed(2)}`)
    + sat(t('Müşteri akışı'), `×${num(r.flow, 1).toFixed(2)}`)
    + (num(r.manager) > 0 || num(r.staff, 1) > 1
        ? sat(t('Devraldığın kadro'), `${t('Müdür Sv.{0}', String(Math.round(num(r.manager))))} · ${t('Personel Sv.{0}', String(Math.round(num(r.staff, 1))))}`)
        : '')
    + `</div>`
    + `<button id="devir-ok" style="width:100%;margin-top:16px;padding:12px;border-radius:14px;border:2px solid #b03535;border-bottom-width:4px;background:linear-gradient(180deg,#e05656,#d64545);color:#fff;font-weight:800;font-size:16px;cursor:pointer">${t('Yeni turu başlat')}</button>`
    + `</div>`
  document.body.appendChild(o)
  const close = () => o.remove()
  o.querySelector('#devir-ok')?.addEventListener('click', close)
  o.addEventListener('click', e => { if (e.target === o) close() })
  audio.achieve()
}

/** kayıttan gelen state'e göre sahneyi yeniden kurar */
function rebuildFromState() {
  golgeTazele()
  subeEtiketiniTazele() // kayıt uygulandı → HUD artık GERÇEK şubeyi yazar (bkz. fonksiyon notu)
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
    // Kayıtlı açıyla kur (charger gibi) → far-flip + oyuncu açısı birlikte, reload'da yön korunur.
    // placedPos footprint MERKEZİ; gövde ofseti açıyla döner (unitBodyPos) → reload'da yapı
    // yerleştirildiği yerde kalır, zıplamaz.
    const pr = placedRot[`pump-${i}`] ?? 0
    tekilKur(`pump-${i}`, () => world.addPump(i, sp ? unitBodyPos(`pump-${i}`, sp.x, sp.y, pr) : undefined, pr))
  }
  for (let i = 0; i < state.evChargers; i++) {
    const sp = pvv(`charger-${i}`)
    // Kayıtlı açıyla kur → araç yanaşma slotu da doğru hesaplanır (rotateBuilding slot güncellemez).
    const cr = placedRot[`charger-${i}`] ?? 0
    tekilKur(`charger-${i}`, () => world.addEvCharger(i, sp ? unitBodyPos(`charger-${i}`, sp.x, sp.y, cr) : undefined, cr))
  }
  // GENİŞ KAPI kapılardan ÖNCE uygulanır: buildGate kapı ağzı/rampa/bordür boşluğunu
  // this.wideGates'ten okur. Eskiden karşı kapılar bu satırdan önce kurulduğu için her
  // yenilemede DAR doğuyordu → "karşı giriş/çıkışı genişletince kalıcı olmuyor".
  if (state.wideGates) world.setWideGates(true)
  // Karşı istasyon üç yoldan açılır:
  //  (a) KAYITLI bayrak — asıl kaynak, bir kez açılan karşı istasyon bir daha kapanmaz;
  //  (b) karşıda duran pompa/şarj — bayraktan ÖNCEKİ kayıtların kendini onarması için;
  //  (c) karşıda tesis var ama kapı yok — karşı müşteri kapısız gelemediğinden o tesisler
  //      sessizce gelirsiz kalıyordu ("karşı yol giriş/çıkışı açılamıyor").
  const farByEquip = world.pumpSlots.slice(0, state.pumps).some(s => s.x > ROAD_X)
    || world.evSlots.slice(0, state.evChargers).some(s => s.x > ROAD_X)
  const farByFacility = state.market2Level > 0 || state.toilet2Level > 0 || state.hasWash2
    || state.hasOil2 || state.hasCoffee2 || state.hasRestaurant2 || state.hasTruckPark2
  if (state.farStationOn || farByEquip || farByFacility) {
    enableFarStationClear() // state.farStationOn'u da true'ya çeker (eski kayıt onarımı)
    // oyuncu karşı kapıları TAŞIDIYSA kayıtlı konumlarına geri kur
    if (placedPos.gatein2) world.buildGate('in', new THREE.Vector2(placedPos.gatein2[0], placedPos.gatein2[1]), 'far')
    if (placedPos.gateout2) world.buildGate('out', new THREE.Vector2(placedPos.gateout2[0], placedPos.gateout2[1]), 'far')
  }
  world.setSign(state.signLevel, placedPos.sign ? new THREE.Vector2(placedPos.sign[0], placedPos.sign[1]) : undefined)
  world.upgradeTankVisual(state.tankLevel) // seviye + yakıt-başına adet
  const pv = (id: string) => (placedPos[id] ? new THREE.Vector2(placedPos[id][0], placedPos[id][1]) : undefined)
  if (state.marketLevel > 0) tekilKur('market', () => world.buildMarket(state.marketLevel, pv('market')))
  if (state.market2Level > 0) tekilKur('market2', () => world.buildMarket(state.market2Level, pv('market2'), 'market2'))
  if (state.toilet2Level > 0) tekilKur('toilet2', () => world.buildToilet(state.toilet2Level, pv('toilet2'), 'toilet2'))
  if (state.hasWash2) tekilKur('wash2', () => world.buildWash(pv('wash2'), 'wash2'))
  if (state.hasOil2) tekilKur('oil2', () => world.buildOil(pv('oil2'), 'oil2'))
  if (state.hasCoffee2) tekilKur('coffee2', () => world.buildCoffee(pv('coffee2'), 'coffee2'))
  if (state.hasRestaurant2) tekilKur('restaurant2', () => world.buildRestaurant(pv('restaurant2'), 'restaurant2'))
  if (state.toiletLevel > 0) tekilKur('toilet', () => world.buildToilet(state.toiletLevel, pv('toilet')))
  if (state.batteryLevel > 0) tekilKur('battery', () => world.buildBattery(state.batteryLevel, pv('battery')))
  for (let i = 0; i < state.solarCount; i++) {
    const iid = i === 0 ? 'solar' : `solar#${i}`
    tekilKur(iid, () => world.buildSolar(state.landSouth ? 'south' : 'north', pv(iid), iid))
  }
  if (state.hasDiesel) tekilKur('dieselgen', () => world.buildDiesel(pv('dieselgen')))
  if (state.hasSMR) tekilKur('smr', () => world.buildSMR(state.landNorth ? 'north' : 'south', pv('smr')))
  else if (state.smrWreck) tekilKur('smrwreck', () => world.buildSMRWreck(state.landNorth ? 'north' : 'south', pv('smr'))) // patlama kalıntısı — aynı temelde
  if (state.hasWash) tekilKur('wash', () => world.buildWash(pv('wash')))
  if (state.hasOil) tekilKur('oil', () => world.buildOil(pv('oil')))
  if (state.hasCoffee) tekilKur('coffee', () => world.buildCoffee(pv('coffee')))
  if (state.hasRestaurant) tekilKur('restaurant', () => world.buildRestaurant(pv('restaurant')))
  if (state.hasTruckPark) tekilKur('truckpark', () => world.buildTruckPark(pv('truckpark')))
  if (state.hasTruckPark2) tekilKur('truckpark2', () => world.buildTruckPark(pv('truckpark2'), 'truckpark2'))
  if (state.hasHotel) tekilKur('hotel', () => world.buildHotel(pv('hotel')))
  for (let i = 0; i < state.airWaterCount; i++) {
    const iid = i === 0 ? 'airwater' : `airwater#${i}`
    tekilKur(iid, () => world.buildAirWater(pv(iid), iid))
  }
  for (let i = 0; i < state.lampCount; i++) {
    const iid = i === 0 ? 'lamp' : `lamp#${i}`
    tekilKur(iid, () => world.buildStreetLamp(pv(iid), iid))
  }
  for (let i = 0; i < state.selfWashCount; i++) {
    const iid = i === 0 ? 'selfwash' : `selfwash#${i}`
    tekilKur(iid, () => world.buildSelfWash(pv(iid), iid))
  }
  for (let i = 0; i < state.parkingCount; i++) {
    const iid = i === 0 ? 'parking' : `parking#${i}`
    tekilKur(iid, () => world.buildParking(pv(iid), iid))
  }
  if (state.isMarina) {
    for (const fid of state.marinaFacs) tekilKur('mfac-' + fid, () => world.buildMarinaFac(fid, pv('mfac-' + fid)))
    world.updateBerthVisual(state.berths)
  }
  if (placedPos.office) {
    world.removeBuildingGroup('office')
    world.buildOffice(pv('office'))
  }
  if (placedPos.gatein) { const g = pv('gatein'); if (g) { world.removeLampNear(g.y); world.buildGate('in', g) } }
  if (placedPos.gateout) { const g = pv('gateout'); if (g) { world.removeLampNear(g.y); world.buildGate('out', g) } }
  {
    const s0 = placedPos['pump-0']
    const r0 = placedRot['pump-0'] ?? 0
    if (s0) world.movePump(0, unitBodyPos('pump-0', s0[0], s0[1], r0), r0)
  }
  if (placedPos.tank) world.moveTank(new THREE.Vector2(placedPos.tank[0], placedPos.tank[1]))
  // charger + pump'lar yukarıda açılarıyla (far-flip dahil) kuruldu; burada ATLANIR
  // (aksi halde generic rotateBuilding far-flip'i ezerdi → karşı üniteler ters bakardı).
  for (const [id, rot] of Object.entries(placedRot))
    if (!id.startsWith('charger-') && !id.startsWith('pump-')) world.rotateBuilding(id, rot)
  world.setClosed(state.closed)
  konumlariSabitle()
}

/**
 * KONUM SABİTLEME (oyuncu raporu: "karşı tuvalet/tır parkı gir-çık yapınca yerine dönüyor").
 *
 * Bir yapı satın alınıp yerleştirildiğinde konumu placedPos'a yazılır. Ama yükseltme,
 * şube dönüşü ya da yarıda kalan yerleştirme gibi yollarda alan yazılmadan kalabiliyordu;
 * o zaman rebuildFromState yapıyı VARSAYILAN yerine koyuyor ve oyuncunun taşıdığı yer
 * kayboluyordu. Canlı kayıtlarda karşı yaka tesislerinin ~%14'ünde konum alanı boştu.
 *
 * Çözüm: yeniden kurulum bittikten sonra sahnedeki GERÇEK konumu placedPos'a yaz. Böylece
 * konumu olmayan yapılar bir defa sabitlenir ve bir daha yer değiştirmez; mevcut bozuk
 * kayıtlar da ilk açılışta kendini onarır.
 */
function konumlariSabitle() {
  let yazildi = 0
  for (const b of world.buildings) {
    const id = b.id
    if (!id || placedPos[id]) continue
    if (id.startsWith('pump-') || id.startsWith('charger-')) continue   // bunların kendi tabloları var
    const g = b.group as THREE.Object3D | undefined
    if (!g) continue
    const x = Number(g.position.x), y = Number(g.position.y)
    if (!isFinite(x) || !isFinite(y)) continue
    placedPos[id] = [x, y]
    yazildi++
  }
  if (yazildi) persist()   // onarım kalıcı olsun, bir dahaki açılışta tekrar gerekmesin
}

/** araçların ASLA içinden geçemeyeceği katı objeler (fiziksel gövdeler) */
/** ünitenin GERÇEK gövde dikdörtgeni — 90°/270° dönüşte en-boy takas (B7),
 *  gövde konumu world.pumpBase/evBase'ten (slottan geriye türetme karşı yakada
 *  3.6 birim kayıyordu: gerçek pompa korumasız + kapı koridorunda hayalet duvar, B1) */
function unitRect(base: { x: number; y: number }, ang: number, w: number, d: number) {
  const swap = Math.abs(Math.sin(ang)) > 0.5
  return { cx: base.x, cy: base.y, w: swap ? d : w, d: swap ? w : d }
}

function hardRects(): { cx: number; cy: number; w: number; d: number }[] {
  const r: { cx: number; cy: number; w: number; d: number }[] = []
  // GEÇİŞ ANI GÜVENLİĞİ ("otoyoldan kasabaya takılı kalıyor" fixi): switchLoc state'i
  // hedef şubeye çevirdiğinde sahne henüz eski şubedir — state.pumps sahnedeki slot
  // sayısını aşarsa pumpSlots[i] undefined olur, s.x TypeError'ı reload kurulmadan
  // handler'ı öldürüyordu. Eksik slot sessizce atlanır (reload zaten yeniden kurar).
  for (let i = 0; i < state.pumps; i++) {
    const b = world.pumpBase[i]
    if (b) r.push(unitRect(b, world.pumpAngles[i] ?? 0, 1.5, 3.4))
    else { const s = world.pumpSlots[i]; if (s) r.push({ cx: s.x - 1.8, cy: s.y, w: 1.5, d: 3.4 }) }
  }
  for (let i = 0; i < state.evChargers; i++) {
    const b = world.evBase[i]
    if (b) r.push(unitRect(b, world.evAngles[i] ?? 0, 0.9, 1.4))
    else { const s = world.evSlots[i]; if (s) r.push({ cx: s.x - 1.1, cy: s.y, w: 0.9, d: 1.4 }) }
  }
  r.push({ cx: world.tankAnchor.x + 0.45, cy: world.tankAnchor.y + 0.45, w: 2.2, d: 2.2 }) // CANLI/main ile birebir
  const of = world.buildings.find(b => b.id === 'office')
  if (of) r.push({ cx: of.group.position.x, cy: of.group.position.y, w: 4.2, d: 4.6 })
  for (const p of placedRects) {
    if (p.id.startsWith('parking') || p.id === 'gatein' || p.id === 'gateout') continue
    if (p.id.startsWith('pump-') || p.id.startsWith('charger-') || p.id === 'tank' || p.id === 'truckpark') continue
    // tabela DEKORATİF: araç engeli değil (yerleştirme kuralıyla tutarlı) — yol kenarına/kenara
    // konunca araçların takılıp trafiği kilitlemesi bitti (#352, #338)
    if (p.id === 'sign') continue
    r.push({ cx: p.cx, cy: p.cy, w: p.w, d: p.d })
  }
  return r
}

/** `lane: true` = ARAÇ KORİDORU (yol/şerit rezervi). Tabela bu rezervlere BAĞLI DEĞİLDİR:
 *  dekoratiftir ve hardRects() onu zaten araç engeli saymaz (#352/#338), yani şeride
 *  dikilse bile trafiği kilitleyemez. Bayrak sayesinde bunlar tek yerden elenebiliyor. */
function fixedObstacles(skipId = ''): (Rect & { lane?: boolean })[] {
  const r: (Rect & { lane?: boolean })[] = [
    { cx: 4.3, cy: 0, w: 2.0, d: 48, lane: true },  // servis şeridi (araç yolu, daraltıldı)
  ]
  // TABELA REZERVİ ARTIK SAHNEDEKİ TABELAYI TAKİP EDİYOR (ofis rezerviyle aynı kalıp).
  // NEDEN: burada tabelanın DOĞUM konumu (4.0, −11.5) SABİT yazılıydı ve skipId='sign'
  // olsa bile listeden düşmüyordu. İki ayrı şikâyetin de kökü buydu:
  //   1) "tabela taşınamıyor / kırmızı yanıyor" — tabela KENDİ EVİNDE kendi rezervine
  //      çarpıyordu; Taşı'ya basan oyuncu hiç kımıldatmadan ✓ diyemiyordu.
  //   2) "yerleşim artıkları" — tabela başka yere taşınsa bile doğduğu kare sonsuza dek
  //      dolu sayılıyor, oraya bir daha hiçbir şey konamıyordu.
  if (skipId !== 'sign') {
    const sg = world.buildings.find(b => b.id === 'sign')
    if (sg) r.push({ cx: sg.group.position.x, cy: sg.group.position.y, w: 2.4, d: 3.4 })
  }
  // karşı istasyon açıksa: otomatik giriş-çıkış + araç koridoru korunur (üstüne pompa/şarj konamaz)
  // Karşı istasyon kapı+araç koridoru: karşı parsel SAHİPLENİLİR SAHİPLENMEZ rezerve edilir
  // (ilk pompa aktivasyondan önce konduğundan, koruma o zaman da olmalı). Genişlik 3.0 → pompanın
  // araç yuvası (base−1.8) kapının yeterince DOĞUsuna düşer, araçlar temiz yol bulur.
  if (world.farStationOn || [...state.ownedParcels].some(k => +k.split(',')[0] >= 3))
    r.push({ cx: 11.6, cy: 0, w: 3.0, d: 48, lane: true })
  // 3.5: kapıdan pompalara giden İÇ KORİDOR + bekleme koridoru rezerve (oyuncu buraya
  // bina koyup kendi trafiğini kilitleyebiliyordu). Her iki yaka için simetrik.
  r.push({ cx: 4.2 - 1.4, cy: 0, w: 1.5, d: 44, lane: true })
  if (world.farStationOn || [...state.ownedParcels].some(k => +k.split(',')[0] >= 3))
    r.push({ cx: FAR_GATE_X + 1.4, cy: 0, w: 1.5, d: 44, lane: true })
  if (skipId !== 'tank') r.push({ cx: world.tankAnchor.x + 0.45, cy: world.tankAnchor.y + 0.45, w: 2.0, d: 2.0 }) // CANLI/main ile birebir
  if (skipId !== 'office') {
    const of = world.buildings.find(b => b.id === 'office')
    if (of) r.push({ cx: of.group.position.x, cy: of.group.position.y, w: 4.6, d: 5.0 })
  }
  // ünite rezervi = gövde + araç yuvası. Merkez, gövde ile slotun ORTA noktası —
  // her yakada ve her açıda doğru (eski slot-0.9 türetmesi karşı yakada 3.6 birim kayıktı, B1)
  for (let i = 0; i < state.pumps; i++) {
    if (skipId === `pump-${i}`) continue
    const b = world.pumpBase[i]; const s = world.pumpSlots[i]
    if (b) r.push(unitRect({ x: (b.x + s.x) / 2, y: (b.y + s.y) / 2 }, world.pumpAngles[i] ?? 0, 4.4, 4.0))
    else r.push({ cx: s.x - 0.9, cy: s.y, w: 4.4, d: 4.0 })
  }
  for (let i = 0; i < state.evChargers; i++) {
    if (skipId === `charger-${i}`) continue
    const b = world.evBase[i]; const s = world.evSlots[i]
    if (b) r.push(unitRect({ x: (b.x + s.x) / 2, y: (b.y + s.y) / 2 }, world.evAngles[i] ?? 0, 4.0, 2.6))
    else r.push({ cx: s.x - 0.6, cy: s.y, w: 4.0, d: 2.6 })
  }
  return r
}

function overlaps(a: Rect, b: Rect): boolean {
  return Math.abs(a.cx - b.cx) < (a.w + b.w) / 2 && Math.abs(a.cy - b.cy) < (a.d + b.d) / 2
}

let placing: {
  id: string; w: number; d: number; grass: boolean; move: boolean
  root: THREE.Group; planeMat: THREE.MeshBasicMaterial
  preview: THREE.Object3D | null // GÖVDE önizlemesi — dünya konumu ölçülebilsin (yerlesim-check)
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
    const bump = id === 'market' ? 'marketLevel' : id === 'market2' ? 'market2Level' : id === 'toilet' ? 'toiletLevel' : id === 'toilet2' ? 'toilet2Level' : id === 'battery' ? 'batteryLevel' : null
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
  if (id === 'market2') return `market-${Math.min(state.market2Level + 1, 2)}`
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
    const bump = id === 'market' ? 'marketLevel' : id === 'market2' ? 'market2Level' : id === 'toilet' ? 'toiletLevel' : id === 'toilet2' ? 'toilet2Level' : id === 'battery' ? 'batteryLevel' : null
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

/**
 * ARSA GERİ SATIŞI (#1200 mehmet.acar@sardismarkets.me "arsadan vazgeçince para geri
 * gelmedi, kredi yandı"). Oyunda arsayı geri satmanın HİÇBİR yolu yoktu: her bina %50
 * iadeyle yıkılabiliyorken arsa ölü sermayeydi, arsa için kredi çeken oyuncu taksitle
 * baş başa kalıyordu. Giriş noktası mevcut "Arsa Satın Al" aracı: aracı açıp KENDİ
 * arsana dokununca satış onayı çıkar (eskiden yalnız "Bu arsa zaten senin." derdi).
 */
/** Parselin sınırları içinde herhangi bir yapı var mı (varsa arsa satılamaz) */
function parselDoluMu(c: number, r: number): boolean {
  const [x0, x1] = PARCEL_COLS[c]
  const [y0, y1] = PARCEL_ROWS[r]
  const icinde = (x: number, y: number) => x > x0 && x < x1 && y > y0 && y < y1
  for (const p of placedRects) if (icinde(p.cx, p.cy)) return true
  // placedRects'te olmayan yapılar (varsayılan konumda duran pompa/ofis/tank) sahneden
  for (const b of world.buildings) {
    const g = b.group as THREE.Object3D
    if (g && icinde(g.position.x, g.position.y)) return true
  }
  for (let i = 0; i < state.pumps; i++) { const s = world.pumpSlots[i]; if (s && icinde(s.x, s.y)) return true }
  for (let i = 0; i < state.evChargers; i++) { const s = world.evSlots[i]; if (s && icinde(s.x, s.y)) return true }
  return false
}

/** Basit onay kutusu (ui.ts'e dokunmadan) — geri alınamaz para işlemleri için */
function onayKutusu(baslik: string, detay: string, onayLabel: string, onay: () => void) {
  const o = document.createElement('div')
  o.style.cssText = 'position:fixed;inset:0;z-index:99996;background:#0d1420cc;display:flex;align-items:center;justify-content:center;padding:22px;font-family:var(--font,system-ui)'
  o.innerHTML =
    `<div style="background:linear-gradient(180deg,#fdfaf2,#f1ebdb);border:2px solid #e0d4bd;border-bottom-width:7px;border-radius:20px;padding:20px 22px;max-width:340px;width:100%;text-align:center;box-shadow:0 24px 60px rgba(10,14,20,.5)">`
    + `<div style="font-size:18px;font-weight:800;color:#1e2a36;margin-bottom:6px"></div>`
    + `<div style="font-size:13px;font-weight:700;color:#7a6152;margin-bottom:14px"></div>`
    + `<div style="display:flex;gap:8px">`
    + `<button id="onay-hayir" style="flex:1;padding:11px;border-radius:12px;border:2px solid #b9ae98;border-bottom-width:4px;background:#efe8d8;color:#3d4b58;font-weight:800;font-size:14px;cursor:pointer"></button>`
    + `<button id="onay-evet" style="flex:1;padding:11px;border-radius:12px;border:2px solid #1f8049;border-bottom-width:4px;background:linear-gradient(180deg,#37c97e,#2fa05a);color:#fff;font-weight:800;font-size:14px;cursor:pointer"></button>`
    + `</div></div>`
  const kutu = o.firstElementChild as HTMLElement
  ;(kutu.children[0] as HTMLElement).textContent = baslik
  ;(kutu.children[1] as HTMLElement).textContent = detay
  const kapat = () => o.remove()
  document.body.appendChild(o)
  const hayir = o.querySelector('#onay-hayir') as HTMLElement
  const evet = o.querySelector('#onay-evet') as HTMLElement
  hayir.textContent = t('Vazgeç')
  evet.textContent = onayLabel
  hayir.addEventListener('click', kapat)
  evet.addEventListener('click', () => { kapat(); onay() })
  o.addEventListener('click', e => { if (e.target === o) kapat() })
}

/** Sahip olunan boş arsayı geri sat — onaylı */
function arsaSatSor(c: number, r: number) {
  const refund = state.parcelRefund(c, r)
  if (refund <= 0) { ui.toast(t('Bu arsa satılamaz (istasyonun kurulu olduğu parsel).'), 'bad'); return }
  if (parselDoluMu(c, r)) {
    ui.toast(t('Arsanın üstünde yapı var — önce yapıyı yık ya da taşı, sonra arsayı satabilirsin.'), 'bad')
    return
  }
  const betonlu = state.isPaved(c, r)
  onayKutusu(
    t('Arsayı geri sat?'),
    betonlu
      ? t('Arsa + zemin betonu elden çıkar, kasana +₺{0} girer. Yatırımın yarısı iade edilir.', refund.toLocaleString('tr-TR'))
      : t('Arsa elden çıkar, kasana +₺{0} girer. Yatırımın yarısı iade edilir.', refund.toLocaleString('tr-TR')),
    t('Sat +₺{0}', refund.toLocaleString('tr-TR')),
    () => {
      const res = state.sellParcel(c, r)
      if (!res) { ui.toast(t('Bu arsa satılamaz — kalan arsaların istasyonla bağlantısı kopar.'), 'bad'); return }
      cancelPlacement()
      audio.cash()
      ui.toast(t('Arsa satıldı — kasana +₺{0} girdi. Sahne tazeleniyor…', res.refund.toLocaleString('tr-TR')), 'good', true)
      persist()
      // SAHNE: kazık/ip ve beton world.ts'te sökülebilir bir şey değil (geri alma yok).
      // Şube geçişiyle AYNI kalıp: kayıt buluta yazıldıktan sonra sayfayı yenile —
      // yenilemede parsel çimene döner. Yenileme kaydı beklemeden yapılmaz, yoksa
      // oyuncu parayı kaybeder (sunucuda eski bakiye kalır).
      const push = auth.loggedIn() ? auth.pushSave(savePayload()).catch(() => null) : Promise.resolve(null)
      Promise.race([push, new Promise(r2 => setTimeout(r2, 6000))]).finally(() => location.reload())
    })
}

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

/** B8: karşı yaka nüshaları YALNIZ karşı yakaya kurulabilir (ziyaretler yaka-duyarlı) */
const FAR_ONLY = new Set(['market2', 'toilet2', 'wash2', 'oil2', 'coffee2', 'restaurant2', 'truckpark2'])

function isValidPlacement(p: Rect, skipId: string, grassOk: boolean): boolean {
  // Not: pompa/şarj/tank artık yol karşısına da konabilir (sahip olunan+betonlanmış karşı parsele).
  // İlk karşı pompa/şarj konunca karşı istasyon (otomatik giriş-çıkış + karşı şerit trafiği) aktive olur.
  // Sahiplik/beton kısıtı aşağıdaki landOk tarafından zaten uygulanır.
  // Karşı Market yalnız KARŞI yakaya kurulabilir (ziyaretler yaka-duyarlı; near'a kurulursa işlevsiz kalırdı)
  if (skipId.endsWith('2') && FAR_ONLY.has(skipId) && p.cx <= ROAD_X) return false
  for (const sx of [-1, 0, 1]) for (const sy of [-1, 0, 1]) {
    if (!landOk(p.cx + sx * (p.w / 2 - 0.2), p.cy + sy * (p.d / 2 - 0.2), grassOk)) return false
  }
  for (const o of fixedObstacles(skipId)) if (overlaps(p, o)) return false
  for (const o of placedRects) if (o.id !== skipId && overlaps(p, o)) return false
  return true
}

/** placedPos boşken taşımanın BAŞLANGIÇ noktası: sahnedeki yapının gerçek konumu.
 *  Pompa/şarj DIŞARIDA bırakılır — onlarda grup konumu GÖVDEdir, placedPos ise footprint
 *  MERKEZİdir (konumlariSabitle da tam bu yüzden onları atlıyor); karıştırmak yapıyı
 *  ofset kadar kaydırırdı. */
function sahnedekiKonum(id: string): [number, number] | null {
  if (id.startsWith('pump-') || id.startsWith('charger-')) return null
  const b = world.buildings.find(x => x.id === id)
  const g = b?.group as THREE.Object3D | undefined
  if (!g || !isFinite(g.position.x) || !isFinite(g.position.y)) return null
  return [g.position.x, g.position.y]
}

function makeGhost(w: number, d: number): THREE.Mesh {
  const ghost = new THREE.Mesh(new THREE.PlaneGeometry(w, d),
    new THREE.MeshBasicMaterial({ color: 0x37c97e, transparent: true, opacity: 0.42, depthTest: false }))
  ghost.position.z = 0.06
  world.scene.add(ghost)
  return ghost
}

/** Tank kümesinin GERÇEK footprint'i: 3 sütun (benzin/dizel/lpg) × yakıt-başına-adet satır.
 *  Adet arttıkça küme +y'de büyür → çarpışma kutusu da büyümeli (yoksa tanklar dışarı taşar). */
function footprintOf(id: string, move = false): { w: number; d: number; grass?: boolean } | null {
  id = id.split('#')[0]
  if (id.startsWith('pump-')) return { w: 4.4, d: 4.0 }
  if (id.startsWith('charger-')) return { w: 4.0, d: 2.6 }
  if (id === 'tank') return { w: 2.0, d: 2.0 } // CANLI/main ile birebir (save uyumu)
  if (id === 'gatein' || id === 'gateout' || id === 'gatein2' || id === 'gateout2') return { w: 2.6, d: 3.4, grass: true }
  return id in PLACEABLE ? PLACEABLE[id](move) : null
}

/** POMPA/ŞARJ GÖVDE OFSETİ — hayalet ile gerçek yerleşimin AYRIŞTIĞI nokta (tek doğru kaynak).
 *
 *  NEDEN: Bu iki ünitede gövde, footprint MERKEZİNDE durmaz; merkezin batısındadır
 *  (pompa 0.9, şarj 0.5 birim) — araç yuvası da simetrik olarak doğusunda. Yani footprint
 *  merkezi = gövde ile yuvanın ORTASI.
 *
 *  BUG: Hayalet bu ofseti DÖNEN root'un ÇOCUĞU olarak uyguluyordu (startPlacement:
 *  `preview.position.x = -0.9`), yani ofset hem oyuncunun açısıyla hem karşı-yaka
 *  180° flip'iyle birlikte dönüyordu. Buna karşılık commit (confirmPlacement),
 *  taşıma (applyDynamicMove), kurulum (buildVisual) ve reload (rebuildFromState)
 *  ofseti SABİT −x olarak uyguluyordu. Sonuç: pompa hayaletin gösterdiği yere değil
 *  1.27 birim (90°/270°) ya da 1.8 birim (180° ve KARŞI YAKA) uzağa oturuyordu.
 *  Şarjda commit ofseti hiç uygulamıyordu → reload'da 0.5 birim zıplıyordu.
 *
 *  ÇÖZÜM: ofset DÖNER. Böylece gövde+yuva ikilisi her açıda footprint'in içinde kalır,
 *  fixedObstacles'ın (gövde+yuva ortası) hesabı da footprint merkeziyle birebir tutar.
 *  SAVE UYUMU: placedPos hâlâ footprint MERKEZİNİ tutar — format değişmedi. Yaygın hâl
 *  olan "yakın yaka + rot 0" için sonuç eskisiyle BİREBİR aynı (cx-0.9); yalnız zaten
 *  bozuk olan döndürülmüş/karşı yaka üniteler oyuncunun gördüğü yere kayar. */
function unitBodyPos(id: string, cx: number, cy: number, rot: number): THREE.Vector2 {
  const b = id.split('#')[0]
  const off = b.startsWith('pump-') ? 0.9 : b.startsWith('charger-') ? 0.5 : 0
  if (!off) return new THREE.Vector2(cx, cy)
  // karşı yakada ünite 180° döner (world.addPump/addEvCharger far-flip'i) — hayalet de öyle döner
  const ang = rot * Math.PI / 2 + (cx > ROAD_X ? Math.PI : 0)
  const yuvarla = (v: number) => Math.round(v * 1e6) / 1e6 // cos(π/2)=6e-17 kirini temizle
  return new THREE.Vector2(yuvarla(cx - Math.cos(ang) * off), yuvarla(cy - Math.sin(ang) * off))
}

// ---- Rezerv görselleştirme: "yer boş ama kırmızı" şikâyetinin fixi ----
// Pompanın araç yuvası, servis şeridi, ofis çevresi gibi GÖRÜNMEZ rezervler yerleştirmeyi
// engelliyor ama oyuncu alanı boş görüyordu (#242, #341, #223). Yerleştirme modunda bu
// rezervler turuncu yarı saydam gösterilir — nereye kurulamayacağı artık belli.
let reserveOverlay: THREE.Group | null = null
function showReserves(skipId: string) {
  hideReserves()
  const g = new THREE.Group()
  for (const o of fixedObstacles(skipId)) {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(o.w, o.d),
      new THREE.MeshBasicMaterial({ color: 0xe8862e, transparent: true, opacity: 0.13, depthWrite: false }))
    m.position.set(o.cx, o.cy, 0.045)
    g.add(m)
  }
  world.scene.add(g)
  reserveOverlay = g
}
function hideReserves() {
  if (reserveOverlay) { world.scene.remove(reserveOverlay); reserveOverlay = null }
}
let reserveHintShown = false

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
  if (preview) {
    // pompa/şarj gövdesi footprint merkezinin BATISINDA kurulur; ofset root'un çocuğu olduğu
    // için AÇIYLA + karşı-yaka flip'iyle birlikte döner. Commit/reload tarafı da artık aynı
    // dönüşümü uyguluyor (unitBodyPos) → onaylanınca yapı hayaletin gösterdiği yere oturur.
    const off = unitBodyPos(id, 0, 0, 0) // rot=0/yakın yaka referansı: (-0.9,0) ya da (-0.5,0)
    preview.position.set(off.x, off.y, preview.position.z)
    root.add(preview)
  }
  world.scene.add(root)
  // TAŞIMA YAPININ BULUNDUĞU YERDEN BAŞLAR. Oyuncu raporu (#1008): "taşı diyince yerinden
  // kaldırıyor" — hayalet (0,0)'dan başladığı için yapı istasyonun ortasına zıplıyordu ve
  // sadece döndürmek isteyen oyuncu yerini kaybediyordu. Artık mevcut konum başlangıç noktası;
  // dokunmadan ⟳ + ✓ yapılırsa yapı yerinde kalır, yalnız yönü değişir.
  //
  // #1008 FİXİNİN AÇIK KALAN YARISI: placedPos yalnız (a) yerleştirme onayında ve
  // (b) rebuildFromState sonundaki konumlariSabitle() ile dolar. rebuildFromState ise
  // "kayıt YÜKLENDİYSE" çalışır — yani kaydı olmayan ilk oturumda ve ?full= vitrininde
  // hiç taşınmamış yapıların (tabela, ofis…) kaydı BOŞTUR. O hâlde hayalet yine (0,0)'a,
  // istasyonun tam ortasına düşüyordu: yapı yerinden kalkıyor, hayalet kırmızı yanıyor →
  // "tabela/ofis taşınamıyor". Kayıt boşsa SAHNEDEKİ gerçek konumu esas al.
  const mevcut = placedPos[id] ?? sahnedekiKonum(id)
  const bx = move && mevcut ? mevcut[0] : 0
  const by = move && mevcut ? mevcut[1] : 0
  placing = { id, w: f.w, d: f.d, grass: !!f.grass, move, root, planeMat, preview, valid: false, cx: bx, cy: by, rot: placedRot[id] ?? 0 }
  root.rotation.z = placing.rot * Math.PI / 2
  world.showGrid(true)
  showReserves(id) // görünmez rezervler (araç yolu/yuva) turuncu görünür — "boş ama kırmızı" bitti
  ui.closeShop()
  ui.hideBuildingCard()
  const mc = document.getElementById('movectl'); if (mc) mc.style.display = 'block'
  repositionPlacing(placing.cx, placing.cy) // mevcut konumda başlar: geçerlilik/renk hesaplanır
  ui.toast(move
    ? t('Taşıma modu: oklar/dokunuş taşır · R tuşu ya da ⟳ DÖNDÜRÜR · ✓ yerleştir')
    : t('Yerleştirme modu: oklar/dokunuş taşır · R tuşu ya da ⟳ DÖNDÜRÜR · ✓ yerleştir'), '')
  if (!reserveHintShown) {
    reserveHintShown = true
    ui.toast(t('Turuncu alanlar araç yolu/rezerv — oraya yapı kurulamaz.'), '', true)
  }
}

function startZoneMode(kind: 'land' | 'pave') {
  cancelPlacement()
  zoneMode = { kind, ghost: makeGhost(1, 1), c: -1, r: -1, valid: false }
  world.showGrid(true)
  ui.closeShop()
  // İPTAL butonu daha ilk dokunuştan ÖNCE görünsün (mobilde başka çıkış yolu yok)
  const zw = document.getElementById('zonecostwrap'); const zc = document.getElementById('zonecost')
  if (zw && zc) { zw.style.display = 'flex'; zc.style.color = 'var(--ink)'; zc.textContent = kind === 'land' ? t('Parsele dokun…') : t('Arsana dokun…') }
  ui.toast(kind === 'land'
    ? t('Arsa seçimi: bitişik parsele tıkla (₺6-14 bin) · ESC iptal')
    : t('Zemin seçimi: betonlanacak arsana tıkla · ESC iptal'), '')
}

function cancelPlacement() {
  hideReserves()
  const mc = document.getElementById('movectl'); if (mc) mc.style.display = 'none'
  const zc = document.getElementById('zonecostwrap'); if (zc) zc.style.display = 'none'
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
function applyDynamicMove(id: string, cx: number, cy: number, rot?: number) {
  // cx,cy = footprint MERKEZİ. Pompa/şarj gövdesi merkezin ofsetinde durur ve bu ofset
  // AÇIYLA DÖNER (unitBodyPos) — hayaletteki önizleme de aynı şekilde döndüğü için
  // yapı artık tam hayaletin gösterdiği noktaya oturur.
  if (id.startsWith('pump-')) {
    const n = parseInt(id.slice(5))
    const r = rot ?? placedRot[`pump-${n}`] ?? 0 // taşırken açıyı/far-flip'i koru
    cars.evictSlot('fuel', n) // slottaki araç eski koordinatta asılı kalmasın
    world.movePump(n, unitBodyPos(id, cx, cy, r), r)
  }
  else if (id.startsWith('charger-')) {
    const n = parseInt(id.slice(8))
    const r = rot ?? placedRot[`charger-${n}`] ?? 0 // taşırken açıyı koru
    cars.evictSlot('ev', n)
    world.moveCharger(n, unitBodyPos(id, cx, cy, r), r)
  }
  else if (id === 'tank') world.moveTank(new THREE.Vector2(cx, cy))
  else if (id === 'gatein') { world.removeLampNear(cy); world.buildGate('in', new THREE.Vector2(cx, cy)); cars.rerouteForGates() }
  else if (id === 'gateout') { world.removeLampNear(cy); world.buildGate('out', new THREE.Vector2(cx, cy)); cars.rerouteForGates() }
  else if (id === 'gatein2') { world.buildGate('in', new THREE.Vector2(cx, cy), 'far'); cars.rerouteForGates() }
  else if (id === 'gateout2') { world.buildGate('out', new THREE.Vector2(cx, cy), 'far'); cars.rerouteForGates() }
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
    placing.valid = Math.abs(placing.cy - otherY) >= 6 // 3.4: giriş/çıkış en az 6 birim ayrı
  } else if (placing.id === 'gatein2' || placing.id === 'gateout2') {
    // karşı kapı yol karşısı kenarda sabit x'te (FAR_GATE_X), yalnız y ayarlanır; diğer kapıdan ≥5 uzak + karşı-yapıya binmesin
    placing.cx = FAR_GATE_X
    placing.cy = Math.max(-22, Math.min(22, Math.round(y)))
    placing.root.position.set(placing.cx, placing.cy, 0)
    const otherY = placing.id === 'gatein2' ? world.gateOut2.y : world.gateIn2.y
    placing.valid = Math.abs(placing.cy - otherY) >= 6 && !farGateBlockedAt(placing.cy)
  } else if (placing.id === 'sign') {
    // Tabela dekoratif (araç engeli DEĞİL) → yol kenarına konabilir, sahiplik/beton aranmaz.
    // İstasyon çevresi + yol kenarı boyunca UZUN yerleştirme (yola çok uzaklaşmasın: cx≤6.5).
    placing.cx = Math.max(-11, Math.min(6.5, Math.round(x * 2) / 2))
    placing.cy = Math.max(-26, Math.min(26, Math.round(y))) // yol boyunca uzun
    placing.root.position.set(placing.cx, placing.cy, 0)
    const odd = placing.rot % 2 === 1
    const eff = { cx: placing.cx, cy: placing.cy, w: odd ? placing.d : placing.w, d: odd ? placing.w : placing.d }
    // yalnız BİNA/pompa üstüne binmesin (servis şeridi hariç — tabela şeritte araç engeli değil)
    // ANA YOL HARİÇ (#1032 "bug - tabela yola da dikiliyor"): servis şeridi serbest kaldı
    // ama ASFALTIN ORTASI değil. Yol bandı ROAD_X çevresinde ±2.6 birim; tabela artık
    // oraya dikilemiyor, kaldırım/refüj payı korunuyor.
    const yolBandi = Math.abs(eff.cx - ROAD_X) < 2.6 + eff.w / 2
    // ARAÇ ŞERİTLERİ TABELAYI BAĞLAMAZ (`lane` bayrağı). Eskiden yalnız İKİ şerit
    // KOORDİNAT EŞLEŞMESİYLE eleniyordu; kapı→pompa İÇ KORİDORU (cx≈2.8, 44 birim boyunda)
    // listede kalıyor ve yol kenarının TAMAMINI kırmızıya boyuyordu. Ölçüm: tabela yalnız
    // cx ≤ 1 aralığına, yani arsanın dibine konabiliyordu — yola bakan bir tabela için
    // anlamsız. Artık şerit rezervlerinin hepsi tek bayrakla düşüyor.
    placing.valid = !yolBandi
      && !placedRects.some(o => o.id !== 'sign' && overlaps(eff, o))
      && !fixedObstacles('sign').some(o => !o.lane && overlaps(eff, o))
  } else {
    placing.cx = Math.round(x)
    placing.cy = Math.round(y)
    placing.root.position.set(placing.cx, placing.cy, 0)
    // KARŞI YAKA ÖNİZLEME FLIP'İ (Oğuz: "yerleştirmeden önce ters görünüyor"): pompa/şarj
    // kurulunca far tarafta 180° döner (addPump/addEvCharger) — hayalet de AYNI kuralla
    // dönsün ki oyuncu koymadan önce gerçek yönü görsün.
    placing.root.rotation.z = placing.rot * Math.PI / 2 + (placingFarFlip() ? Math.PI : 0)
    const odd = placing.rot % 2 === 1
    const eff = { cx: placing.cx, cy: placing.cy, w: odd ? placing.d : placing.w, d: odd ? placing.w : placing.d }
    placing.valid = isValidPlacement(eff, placing.id, placing.grass)
  }
  placing.planeMat.color.setHex(placing.valid ? 0x37c97e : 0xec5b5b)
  placing.planeMat.opacity = placing.valid ? 0.22 : 0.34
}
/** pompa/şarj hayaleti karşı yakadaysa 180° döner (kurulumdaki far-flip ile birebir) */
function placingFarFlip(): boolean {
  return !!placing && (placing.id.startsWith('pump-') || placing.id.startsWith('charger-'))
    && placing.cx > ROAD_X
}
// mobil: yön butonlarıyla 1 birim kaydır (sürükleme zor)
function nudgePlacing(dx: number, dy: number) {
  if (!placing) return
  repositionPlacing((placing.cx || 0) + dx, (placing.cy || 0) + dy)
}

function confirmPlacement() {
  const p = placing!
  if (p.move) {
    applyDynamicMove(p.id, p.cx, p.cy, p.rot) // hayaletteki AÇIYLA taşı (eski açı değil)
    // otopark taşındı/döndü: park etmiş araçları uğurla — eski açı/konumda asılı kalmasınlar
    if (p.id.split('#')[0] === 'parking') cars.evictParked()
    ui.toast(t('Taşındı!'), 'good')
  } else {
    const purchaseId = p.id.startsWith('pump-') ? 'pump'
      : p.id.startsWith('charger-') ? 'evcharger'
      : p.id.split('#')[0]
    if (!buyItem(state, purchaseId)) {
      ui.toast(t('Para yetmiyor!'), 'bad')
      cancelPlacement()
      return
    }
    buildVisual(p.id, new THREE.Vector2(p.cx, p.cy))
    buyToast(p.id.split('#')[0].replace(/^pump-\d+$/, 'pump').replace(/^charger-\d+$/, 'evcharger'))
  }
  if (p.id.startsWith('charger-')) {
    // Charger döndürülebilir: pozisyon + açı + araç yanaşma slotu birlikte kurulur.
    // (Burada ofset HİÇ uygulanmıyordu: şarj cx'e kuruluyor ama reload cx-0.5'e kuruyordu →
    //  ünite her açılışta 0.5 birim batıya kayıyordu. Artık iki yol da unitBodyPos kullanıyor.)
    const idx = Number(p.id.slice('charger-'.length))
    world.moveCharger(idx, unitBodyPos(p.id, p.cx, p.cy, p.rot), p.rot)
  } else if (p.id.startsWith('pump-')) {
    // Pompa da döndürülebilir: seçilen açıyla (far-flip dahil) yeniden kur — slot açıyla döner.
    const idx = Number(p.id.slice('pump-'.length))
    world.movePump(idx, unitBodyPos(p.id, p.cx, p.cy, p.rot), p.rot)
  } else if (p.id !== 'tank' && p.id !== 'gatein' && p.id !== 'gateout' && p.id !== 'gatein2' && p.id !== 'gateout2') {
    world.rotateBuilding(p.id, p.rot)
  }
  placedPos[p.id] = [p.cx, p.cy]
  placedRot[p.id] = p.rot
  // Karşıya (yol karşısı) İLK gelir ünitesi konunca karşı istasyon aktive olur: otomatik
  // giriş-çıkış + karşı şerit trafiği. Eskiden yalnız pompa/şarj tetikliyordu; karşı
  // market/tuvalet/yıkama/tır parkı kuran oyuncuda kapı hiç açılmıyor, o tesisler
  // müşterisiz (dolayısıyla gelirsiz) kalıyordu — "karşı yol giriş/çıkışı açılamıyor".
  if ((p.id.startsWith('pump-') || p.id.startsWith('charger-') || FAR_ONLY.has(p.id.split('#')[0]))
      && p.cx > ROAD_X && !world.farStationOn) {
    enableFarStationClear() // kapıları mevcut karşı-yapılardan kaçırarak kur
    ui.toast('Yol karşısı istasyon açıldı! Otomatik giriş-çıkış geldi — karşı şeritten müşteri gelecek.', 'good', true)
  }
  const i = placedRects.findIndex(r => r.id === p.id)
  if (i >= 0) placedRects.splice(i, 1)
  if (p.id !== 'gatein' && p.id !== 'gateout' && p.id !== 'gatein2' && p.id !== 'gateout2') {
    const odd = p.rot % 2 === 1
    placedRects.push({ id: p.id, cx: p.cx, cy: p.cy, w: odd ? p.d : p.w, d: odd ? p.w : p.d })
  }
  cancelPlacement()
  persist()
  golgeTazele()
}

function confirmZone() {
  const z = zoneMode!
  const key = parcelKey(z.c, z.r)
  if (z.kind === 'land') {
    // METROPOL alan kıtlığı (§6.6): şehirde satın alınabilecek parsel sayısı sınırlı
    if (state.parcelLimitReached()) {
      ui.toast(t('Bu şubede arsa sınırına ulaştın ({0} parsel) — şehirde yer kıt, seçimini dikkatli yap.',
        String(state.parcelLimit())), 'bad')
      return
    }
    const cost = parcelCost(z.c, z.r, state)
    if (state.money < cost) { ui.toast(t('Para yetmiyor!'), 'bad'); return }
    state.money -= cost
    state.ownedParcels.add(key)
    world.markOwned(z.c, z.r)
    if (z.c >= 3) ui.toast('Yol karşısı arsa alındı — betonla, sonra pompa/şarj kur; ilk pompayla otomatik giriş-çıkış gelir.', 'good', true)
    ui.toast(t('Arsa satın alındı (-₺{0}) — yapı için Zemin Betonu döşe.', cost.toLocaleString('tr-TR')), 'good')
  } else {
    if (state.money < PAVE_COST) { ui.toast(t('Para yetmiyor!'), 'bad'); return }
    state.money -= PAVE_COST
    state.pavedParcels.add(key)
    world.paveParcel(z.c, z.r)
    ui.toast('Zemin betonlandı — artık yapı kurabilirsin!', 'good')
  }
  persist()
  // ZİNCİRLEME ALIM (oyuncu: "her arsa için mağazayı tekrar tekrar açmak işkence"):
  // alım başarılıysa mod AÇIK kalır, sıradaki parsele dokunup devam edilir. Bir sonraki
  // adım imkânsızsa (para bitti / sınır doldu / betonsuz arsa kalmadı) kendiliğinden kapanır.
  const devam = z.kind === 'land'
    ? !state.parcelLimitReached() && state.ownedParcels.size < 18 && state.money >= parcelCost(0, 0, state)
    : state.ownedParcels.size > state.pavedParcels.size && state.money >= PAVE_COST
  if (!devam) { cancelPlacement(); return }
  zoneMode = { kind: z.kind, ghost: z.ghost, c: -1, r: -1, valid: false }
  const zc2 = document.getElementById('zonecost')
  if (zc2) { zc2.style.color = 'var(--ink)'; zc2.textContent = z.kind === 'land' ? t('Parsele dokun…') : t('Arsana dokun…') }
}

window.addEventListener('keydown', e => {
  if (e.key === 'Escape') cancelPlacement()
  if ((e.key === 'r' || e.key === 'R') && placing) {
    // pompa artık DÖNDÜRÜLEBİLİR (charger gibi: açı + araç yanaşma slotu birlikte döner) —
    // 'karşı istasyonda döndüremiyoruz' şikayetinin fixi. Tank/kapı yönü sabit kalır.
    if (placing.id === 'tank' || placing.id === 'gatein' || placing.id === 'gateout' || placing.id === 'gatein2' || placing.id === 'gateout2') {
      ui.toast('Bu ünitenin yönü sabittir (araç yanaşması) — sadece yerini seçebilirsin.', '')
      return
    }
    placing.rot = (placing.rot + 1) % 4
    placing.root.rotation.z = placing.rot * Math.PI / 2 + (placingFarFlip() ? Math.PI : 0)
  }
})
renderer.domElement.addEventListener('contextmenu', e => { e.preventDefault(); cancelPlacement() })
// mobil: arsa/beton seçiminde tek iptal yolu (ESC ve sağ-tık yok) — #322 "iptal edilemiyor" fixi
document.getElementById('zonecancel')?.addEventListener('click', () => cancelPlacement())

const COUNTABLE: Record<string, () => number> = {
  parking: () => state.parkingCount,
  solar: () => state.solarCount,
  selfwash: () => state.selfWashCount,
  airwater: () => state.airWaterCount,
  lamp: () => state.lampCount,
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
    || (id === 'market2' && state.market2Level > 0)
    || (id === 'toilet2' && state.toilet2Level > 0)
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

/**
 * YERİNDE DÖNDÜR (6 şikayet: #918 "marketi döndürmeye çalışıyorum beceremedim hangi
 * harfle", #1142 "yapıları döndürme özelliği güzel olur", #935/#780/#750 "scroll/orta
 * tuş/ok tuşuyla döndüremiyorum", #1207 "yönünü değiştirecek [şey] aşağıya geliyor").
 *
 * Döndürme ZATEN vardı ama yalnız taşıma modunda R tuşuyla — yani önce "Taşı" demen,
 * sonra R'yi keşfetmen gerekiyordu. Kimse bulamadı. Artık bina kartında doğrudan
 * "Döndür" butonu var: yapı yerinden kalkmadan 90° döner.
 */
const SABIT_YON = new Set(['tank', 'gatein', 'gateout', 'gatein2', 'gateout2'])
ui.onRotate = id => {
  if (!footprintOf(id)) return
  if (SABIT_YON.has(id)) {
    ui.toast(t('Bu ünitenin yönü sabittir (araç yanaşması) — sadece yerini seçebilirsin.'), '')
    return
  }
  const yeni = ((placedRot[id] ?? 0) + 1) % 4
  // ÇAKIŞMA KONTROLÜ: döndürünce ayak izi 90° döner (w↔d). Yeni hâli sığmıyorsa
  // döndürme yapılmaz — yapı başka bir yapının/rezervin üstüne binmesin.
  const f = footprintOf(id)!
  const pos = placedPos[id]
  if (pos) {
    const tek = yeni % 2 === 1
    const eff = { cx: pos[0], cy: pos[1], w: tek ? f.d : f.w, d: tek ? f.w : f.d }
    const digerleri = placedRects.filter(r => r.id !== id)
    const carpisma = digerleri.some(o => overlaps(eff, o))
      || fixedObstacles(id).some(o => overlaps(eff, o))
    if (carpisma) {
      ui.toast(t('Buraya sığmıyor — döndürünce başka bir yapıya/araç yoluna çarpıyor. Önce taşı.'), 'bad')
      return
    }
    const i = placedRects.findIndex(r => r.id === id)
    if (i >= 0) placedRects[i] = { id, ...eff }
  }
  placedRot[id] = yeni
  world.rotateBuilding(id, yeni)
  // pompa/şarj: açı değişince araç yanaşma noktası da döner
  if (id.startsWith('pump-')) {
    const p2 = placedPos[id]
    if (p2) world.movePump(parseInt(id.slice(5)), new THREE.Vector2(p2[0] - 0.9, p2[1]), yeni)
  } else if (id.startsWith('charger-')) {
    const p2 = placedPos[id]
    if (p2) world.addEvCharger(parseInt(id.slice(8)), new THREE.Vector2(p2[0] - 0.5, p2[1]), yeni)
  }
  golgeTazele()
  Car.solids = hardRects()
  cars.rerouteForGates()          // otopark/pompa yönü değişti: rotalar tazelensin
  audio.click()
  ui.toast(t('Döndürüldü ({0}°)', String(yeni * 90)), 'good', true)
  persist()
  if (selectedBuilding === id) refreshBuildingCard()
}

ui.onSell = id => {
  if (!sellInfo(state, id)) return
  const refund = applySell(state, id)
  if (refund === null) return
  removeBuildingVisual(id)
  audio.build()
  ui.toast(t('Yıkıldı — yatırımın yarısı iade: +₺{0}', refund.toLocaleString('tr-TR')), 'good', true)
  selectedBuilding = null
  world.setSelected(null)
  ui.hideBuildingCard()
  Car.solids = hardRects()
  cars.rerouteForGates() // ünite/bina taşındı: araçlar eski konuma sürmesin (B3 ek kuralı)
  persist()
}

function buyToast(id: string) {
  audio.build()
  switch (id) {
    case 'pump': ui.toast(t('Pompa #{0} kuruldu!', state.pumps), 'good'); break
    case 'sign': ui.toast('Tabela büyüdü — daha çok müşteri gelecek!', 'good'); break
    case 'widegate': ui.toast(t('Giriş-çıkış genişledi — araçlar ikili sıra girip çıkıyor!'), 'good'); break
    case 'tank': ui.toast(t('Tank kapasitesi: {0}L', state.tankCapacity), 'good'); break
    case 'market': ui.toast('Market açıldı!', 'good'); break
    case 'market2': ui.toast(t('Karşı market açıldı — karşı yakanın müşterileri alışverişe başlayacak!'), 'good'); break
    case 'toilet': ui.toast('Tuvalet hizmete girdi!', 'good'); break
    case 'grid': ui.toast(t('Elektrik altyapısı Sv.{0} kuruldu!', state.gridLevel), 'good'); break
    case 'battery': ui.toast('Batarya deposu kuruldu — üretim biriktikçe dolacak.', 'good'); break
    case 'evcharger': syncSignPrices(); ui.toast('DC şarj ünitesi kuruldu!', 'good'); break
    case 'solar': ui.toast('Güneş santrali kuruldu. Paneller zamanla kirlenir!', 'good'); break
    case 'dieselgen': ui.toast('Jeneratör kuruldu. Gürültüsü EV müşterilerini kaçırabilir!', 'good'); break
    case 'smr': ui.toast('Reaktör devrede! BAKIMI ASLA AKSATMA — patlarsa her şey gider!', 'bad'); break
    case 'wash': ui.toast('Oto yıkama açıldı — müşteriler araç yıkatacak!', 'good'); break
    case 'oil': ui.toast('Yağ değişim istasyonu açıldı!', 'good'); break
    case 'coffee': ui.toast('Kahveci açıldı!', 'good'); break
    case 'restaurant': ui.toast('Restoran açıldı — yolcular yemek molası verecek!', 'good'); break
    case 'truckpark': ui.toast('Tır parkı açıldı — düzenli konaklama geliri!', 'good'); break
    case 'truckpark2': ui.toast(t('Karşı tır parkı açıldı — düzenli konaklama geliri!'), 'good'); break
    case 'hotel': ui.toast(t('Otel açıldı! Doluluk itibarınla artar — günlük işletme gideri de var.'), 'good', true); break
    case 'cleaner': ui.toast(t('Temizlikçi işe alındı — bakım özeni düşmeyecek, paneller kendiliğinden silinecek.'), 'good'); break
    case 'airwater': ui.toast('Hava-su ünitesi kuruldu!', 'good'); break
    case 'lamp': ui.toast(t('Sokak lambası kuruldu — gece istasyon aydınlık!'), 'good'); break
    case 'selfwash': ui.toast('Self yıkama açıldı — köpük ve su otomatik satılacak!', 'good'); break
    case 'parking': ui.toast('Otopark açıldı — müşteriler park edip tesisleri gezebilecek!', 'good'); break
  }
}

// FULL / vitrin modu: ?full=1 ile her şey kurulu başlar
const isFullMode = new URLSearchParams(location.search).has('full')
// VİTRİN MODU DEBUG KANCASI: yalnız ?full=1'de — headless E2E testler (ihale/filo
// doğrulaması vb.) state'e erişebilsin. Normal oyunda ASLA açılmaz.
if (isFullMode) (window as unknown as Record<string, unknown>).__dbg = {
  get state() { return state }, get cars() { return cars }, get world() { return world }, get att() { return attendantFigs },
  // TEST KANCALARI (yalnız ?full=1): otomatik doğrulama bina kartı akışını sürebilsin
  get ui() { return ui },
  sec(id: string) { selectedBuilding = id; world.setSelected(id); refreshBuildingCard() },
  // YERLEŞİM KANCASI (yalnız ?full=1): hayalet ile GERÇEK yerleşim aynı noktaya mı düşüyor?
  // tools/tests/yerlesim-check.mjs bunu sayıyla ölçer (hayalet gövdesi ↔ sahnedeki gövde).
  place: {
    start(id: string, move = false) { startPlacement(id, move) },
    at(x: number, y: number) { repositionPlacing(x, y) },
    rot(n: number) { if (placing) { placing.rot = ((n % 4) + 4) % 4; repositionPlacing(placing.cx, placing.cy) } },
    confirm() { confirmPlacement() },
    cancel() { cancelPlacement() },
    /** hayaletin durumu + GÖVDE önizlemesinin DÜNYA konumu (footprint merkezi değil) */
    ghost() {
      if (!placing) return null
      placing.root.updateMatrixWorld(true)
      const v = new THREE.Vector3(placing.cx, placing.cy, 0)
      if (placing.preview) placing.preview.getWorldPosition(v)
      return {
        id: placing.id, cx: placing.cx, cy: placing.cy, rot: placing.rot, valid: placing.valid,
        bx: v.x, by: v.y, rz: placing.root.rotation.z,
      }
    },
    /** sahnedeki GERÇEK yapının gövde konumu + yönü */
    real(id: string) {
      const b = world.buildings.find(x => x.id === id)
      if (!b) return null
      const g = b.group as THREE.Object3D
      return { bx: g.position.x, by: g.position.y, rz: g.rotation.z }
    },
    /** kayda giden değerler (placedPos = footprint merkezi) + araç yuvası */
    saved(id: string) {
      const n = Number(id.replace(/^\D+/, ''))
      const s = id.startsWith('pump-') ? world.pumpSlots[n] : id.startsWith('charger-') ? world.evSlots[n] : null
      return { pos: placedPos[id] ?? null, rot: placedRot[id] ?? null, slot: s ? { x: s.x, y: s.y } : null }
    },
    /** reload simülasyonu: sahneyi kayıtlı state'ten yeniden kur */
    rebuild() { rebuildFromState() },
    /** "boş görünüyor ama KIRMIZI yanıyor" teşhisi: hayaleti hangi rezerv reddediyor?
     *  Sabit rezervler (`lane` = araç şeridi) + yerleştirilmiş yapı dikdörtgenleri. */
    engeller(id: string) {
      return {
        sabit: fixedObstacles(id).map(o => ({ cx: o.cx, cy: o.cy, w: o.w, d: o.d, lane: !!o.lane })),
        yapilar: placedRects.map(o => ({ id: o.id, cx: o.cx, cy: o.cy, w: o.w, d: o.d })),
      }
    },
  },
  // KAYIT KAYBI KANCASI (yalnız ?full=1): tools/tests/kayit-kaybi-check.mjs
  // "arsa al → sahneyi yeniden kur → kaydet → yükle → hiçbir yapı kaybolmadı" turunu
  // ölçebilsin. Sahnedeki bina listesi + kayda giden yükün aynası; mutasyon yapmaz.
  kayit: {
    binalar() { return world.buildings.map(b => b.id) },
    yuk() { return JSON.parse(JSON.stringify(savePayload())) as Record<string, unknown> },
    /** kaydı YENİDEN uygula (reload'un applySaveData + rebuildFromState ayağı) */
    yukle(d: Record<string, unknown>) { applySaveData(d); rebuildFromState() },
    arsaAl(c: number, r: number, beton = true) {
      state.ownedParcels.add(parcelKey(c, r)); world.markOwned(c, r)
      if (beton) { state.pavedParcels.add(parcelKey(c, r)); world.paveParcel(c, r) }
      persist()
    },
  },
  // SİNEMATİK KAMERA (video stüdyosu için — yalnız vitrin modunda): pürüzsüz zoom/pan
  cine: {
    getCam() { return { x: camX, y: camY, zoom: camera.zoom } },
    setCam(x: number, y: number, zoom?: number) {
      camX = x; camY = y
      if (typeof zoom === 'number') camera.zoom = Math.min(2.6, Math.max(0.4, zoom))
      updateCamera()
      camera.updateProjectionMatrix()
    },
  },
}
let saveLoaded = false
if (!isFullMode && !isPromoMode && auth.loggedIn()) {
  try {
    const remote = await auth.pullSave()
    cloudSynced = true // bulut durumu bu sayfada BİLİNİYOR → artık yazmak güvenli
    if (remote) {
      applySaveData(remote as Record<string, unknown>)
      saveLoaded = true
      ui.toast(t('Bulut kaydı yüklendi — Gün {0} ({1})', state.day, auth.currentEmail() ?? ''), 'good', true)
      applyOfflineEarnings() // yokken geçen süre kadar pasif gelir
    }
  } catch (e) {
    const ed = (e as Error & { data?: { appeal?: boolean; token?: string } }).data
    if (ed?.appeal) {
      showAppealOverlay(ed.token) // izahat banı: bloklama yerine savunma formu
    } else {
      // Bulut kaydı yüklenemedi: TAZE oturumla oynamaya izin verme — yoksa
      // ilerlemiş bulut kaydının üstüne yazılır. Oyunu kilitle, kayıt gönderme.
      cloudBlocked = true
      showCloudBlockOverlay()
    }
  }
} else if (!isFullMode && !isPromoMode && !auth.loggedIn()) {
  // MİSAFİR: hesap yok → yerel misafir kaydını yükle (varsa). Oyun yine de gate ardında
  // DONUK bekler (guestPaused) — "Misafir olarak devam et"e basınca buradan sürer.
  const g = auth.loadGuest()
  if (g) { applySaveData(g as Record<string, unknown>); saveLoaded = true }
}
// KRİTİK: aşağıdaki iki kapı BİLEREK sonsuz bekler (cloud-block / e-posta doğrulama).
// Boot maskesi bu kapıların ÜSTÜNDE kalıyordu → doğrulanmamış kayıtlı oyuncu kapıyı
// hiç göremeden "İstasyonun hazırlanıyor"da takılıyordu (oyuncu raporu ×2). Maske
// motor durmadan önce KOŞULSUZ kalkar.
document.getElementById('boot')?.remove()
if (cloudBlocked) await new Promise(() => {}) // oyun motoru burada durur, hiç kayıt gitmez
// e-posta doğrulama kapısı: doğrulanmadan oyuna devam edilemez
if (!isFullMode && !isPromoMode && auth.needsVerify()) {
  showVerifyGate()
  await new Promise(() => {}) // doğrulanana dek motor durur
}
// Şube ipucu ile bulut kaydı uyuşmuyorsa (başka cihazda şube değişmiş) bir kez düzelt
// ŞUBE ÇİFTLEME: karşılaştırma HAM ipucuyla yapılır (locHintSave). locHint sahne id'si
// olduğu için 'otoyol-2' ↔ 'otoyol' her boot'ta "uyuşmazlık" sayılıp gereksiz reload atardı.
if (saveLoaded && state.activeLoc !== locHintSave && !sessionStorage.getItem('beneloil-loc-fixed')) {
  sessionStorage.setItem('beneloil-loc-fixed', '1') // yalnız BİR kez → sonsuz reload döngüsü yok
  localStorage.setItem(LOC_HINT_KEY, state.activeLoc)
  location.reload()
}
// Tutarlı boot → tek-seferlik sigorta sıfırlanır. Eski hali sekme ömrü boyunca kilitli
// kalıyordu: ilk uyuşmazlıktan sonra düzeltici bir daha ASLA çalışmıyordu (şube
// değiştirme raporlarının ikinci ayağı).
if (saveLoaded && state.activeLoc === locHintSave) sessionStorage.removeItem('beneloil-loc-fixed')
if (saveLoaded) rebuildFromState()
else if (!isFullMode && !isPromoMode) ui.toast('Sıfırdan başlıyorsun — hayırlı olsun patron!', 'good', true)
// C9 (analiz): eski şube-kasası bakiyesi varsa haber ver (ilk gün dönüşünde otomatik devredilir)
if (saveLoaded && state.branchVaultTotal() >= 100) {
  ui.toast(t('Şube kasalarında ₺{0} birikmiş — gün dönüşünde otomatik kasana aktarılacak.',
    Math.round(state.branchVaultTotal()).toLocaleString('tr-TR')), 'good', true)
}
// STEAM ANKETİ (Oğuz 17 Ağu): hesap başına ÖMÜRDE 1 kez — Steam kitlesini ölçmek için.
// Cevap save'e yazılır (steamPoll), sayım sunucu metriğine düşer (steam_yes/no/skip).
if (saveLoaded && auth.loggedIn() && !state.steamPoll && !isFullMode && !isPromoMode) {
  setTimeout(showSteamPoll, 20_000) // oyuncu oyuna otursun, açılış curcunasına denk gelmesin
}
// eski yerel kayıt kalıntılarını temizle (artık her şey SQL'de)
for (const key of Object.keys(localStorage)) {
  if (key.startsWith('benzinlik-save-v1')) localStorage.removeItem(key)
}
// sekme kapanırken son durumu buluta yaz.
// KRİTİK: bu istek de normal save ile AYNI korumaları taşımalı —
//  • cloudSynced: bu sayfa bulut kaydını gerçekten yükledi mi? (gate'te login olup reload eden
//    sayfa TAZE gün-1 state taşır; korumasız gönderirse hesabın kaydını siler)
//  • x-session: tek-cihaz kilidi (kicked sekme yazamasın)
//  • baseUpdatedAt: çoklu-cihaz 409 guard'ı (eski sekme yeniyi ezemesin)
let lastFlush = 0
function flushSaveNow() {
  if (isFullMode || isPromoMode || cloudBlocked || auth.isKicked() || sifirlaniyor) return
  if (!auth.loggedIn()) { auth.saveGuest(savePayload()); return } // misafir: yerel senkron flush
  if (!cloudSynced) return
  if (Date.now() - lastFlush < 2_000) return // hide/show flap'inde sunucu limitine (2/3sn) takılma
  lastFlush = Date.now()
  lastRemotePush = Date.now() // hemen ardından ikinci otomatik push açılmasın
  fetch('/api/save', {
    method: 'POST',
    keepalive: true,
    headers: {
      'content-type': 'application/json',
      'x-auth': localStorage.getItem('benzinlik-token') ?? '',
      'x-session': auth.sessionId(),
    },
    body: JSON.stringify({ save: savePayload(), baseUpdatedAt: auth.lastUpdatedAt() }),
  }).then(r => r.json()).then((d: { updatedAt?: string }) => {
    // KRİTİK: yanıt gelirse damgayı işle — sayfa ölmeyip geri dönerse (iOS arka plan /
    // bfcache) eski damgayla push atıp SAHTE 409 + zorunlu reload üretiyorduk.
    if (d?.updatedAt) auth.setLastUpdatedAt(d.updatedAt)
  }).catch(() => {})
}
window.addEventListener('pagehide', flushSaveNow)
// iOS app-switch'te pagehide her zaman ateşlenmez; visibilitychange daha güvenilir
document.addEventListener('visibilitychange', () => {
  if (document.hidden) flushSaveNow()
  else lastRemotePush = 0 // dönüşte ilk persist beklemeden buluta yazsın
})
// PERİYODİK OTOMATİK KAYIT (veri kaybı fixi): persist yalnız oyuncu aksiyonlarında ve gün
// sonunda (~2,7 dk) çağrılıyordu — pasif izlenen dakikalar refresh/crash'te kayboluyordu.
// 10 sn'lik tık, persist'in kendi 5 sn throttle'ından geçerek kaybı ≤10 sn'e indirir.
setInterval(() => { if (!document.hidden) persist() }, 10_000)
translateDom() // HUD + statik metinleri çevir
;(document.getElementById('lang-tr') as HTMLButtonElement).classList.toggle('good', lang === 'tr')
;(document.getElementById('lang-en') as HTMLButtonElement).classList.toggle('good', lang === 'en')
;(document.getElementById('lang-fr') as HTMLButtonElement).classList.toggle('good', lang === 'fr')
;(document.getElementById('lang-tr') as HTMLButtonElement).addEventListener('click', () => setLang('tr'))
;(document.getElementById('lang-en') as HTMLButtonElement).addEventListener('click', () => setLang('en'))
;(document.getElementById('lang-fr') as HTMLButtonElement).addEventListener('click', () => setLang('fr'))
// müşteri paneli otomatik açılma tercihi (ayarlar)
{
  const apBtn = document.getElementById('autopanelbtn') as HTMLButtonElement
  const syncAp = () => { apBtn.textContent = autoPanelPref ? t('Otomatik açıl: Açık') : t('Otomatik açıl: Kapalı') }
  syncAp()
  apBtn.addEventListener('click', () => {
    setAutoPanel(!autoPanelPref)
    syncAp()
    ui.toast(autoPanelPref ? t('Müşteri paneli araç gelince otomatik açılacak.') : t('Panel artık yalnız araca tıklayınca açılır.'), '', true)
  })
}
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
  // META: canlı kanal kendi backend'imize bağlanır — Instant Games'te böyle bir sunucu yok
  // (kayıt FBInstant player data'sında, bkz. fbinstant.ts). NEZP altında dış bağlantı istemiyoruz.
  if (isInstantGames()) return
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
      // tank/kapı yönü sabittir — pompa artık döndürülebilir (klavye ile aynı)
      if (placing.id === 'tank' || placing.id === 'gatein' || placing.id === 'gateout' || placing.id === 'gatein2' || placing.id === 'gateout2') {
        ui.toast(t('Bu ünitenin yönü sabittir (araç yanaşması) — sadece yerini seçebilirsin.'), '')
        return
      }
      placing.rot = (placing.rot + 1) % 4
      placing.root.rotation.z = placing.rot * Math.PI / 2 + (placingFarFlip() ? Math.PI : 0)
      repositionPlacing(placing.cx, placing.cy) // döndürünce yeniden doğrula
    })
    document.getElementById('mv-ok')?.addEventListener('click', () => {
      if (placing && placing.valid) confirmPlacement()
      else ui.toast(t('Buraya yerleştirilemez — kırmızıysa başka yere taşı.'), 'bad')
    })
    document.getElementById('mv-cancel')?.addEventListener('click', () => cancelPlacement())
  }
}

// ---- ÖĞRETİCİ: ilk 3-5 dakikanın BAĞLAMSAL el kitabı ----
//
// TASARIM İLKESİ (oyun sahibi): "Grind uzatmak retention değil churn üretir — tycoon'da
// doğru cevap her zaman daha fazla bekleme değil, DAHA FAZLA KARAR." Öğretici de oyunu
// YAVAŞLATMAZ: zorunlu bir tur değil, çekirdek döngünün (müşteri → servis → para →
// yükseltme → daha çok müşteri) her halkasında oyuncunun vereceği KARARI gösteren tek
// cümlelik bir ipucu. Buton turu YOK, modal YOK, oyunu durduran adım YOK.
//
// Neden yeni bir sistem kurulmadı: HUD ipucu kutusu (#tuthint), ui.toast ve günlük
// görevler (dailyQuests) zaten vardı. Öğretici bunların üstüne oturur ve 5. ipuçtan sonra
// "bugün ne yapmalıyım"ı GÜNLÜK GÖREVLERE devreder — kalıcı hedef zaten orada.
//
// EN KRİTİK DÜZELTME: eski tutActive() `auth.loggedIn()` şartı arıyordu. Oyuna giriş
// kapısının ta kendisi MİSAFİR düğmesi (#gguest) olduğundan öğretici, onu en çok gereken
// kitleye — hesapsız yeni oyuncuya — HİÇ GÖRÜNMÜYORDU. ("ne yapacağımı anlamadım", ~25 kayıt.)
const TUT_KEY = 'benzinlik-ogretici'          // 'bitti' → bir daha gösterme (kayıt formatına DOKUNMAZ)
const TUT_ESKI_KEY = 'beneloil-onboarded'     // eski anahtar: görmüş oyuncuya tekrar gösterme
const TUT_SON = 5
let tutStep = 0
const tutEl = document.getElementById('tuthint') as HTMLDivElement | null
const tutTextEl = document.getElementById('tut-text') as HTMLSpanElement | null

function tutBitti() { return !!(localStorage.getItem(TUT_KEY) || localStorage.getItem(TUT_ESKI_KEY)) }
/** öğretici bu oturumda gösterilebilir mi (vitrin/promo modu ve görmüş oyuncu hariç) */
function tutActive() {
  return !isFullMode && !isPromoMode && !tutBitti() && state.day <= 1
}
/** ipucunu ekrana bas — HER İPUCU BİR KARAR gösterir, buton tarifi değil */
function tutGoster(step: number, html: string) {
  if (!tutEl || !tutTextEl) return
  tutStep = step
  tutTextEl.innerHTML = html
  tutEl.style.display = 'flex'
}
/** öğretici kapanır: ATLA'ya basınca, son ipucundan sonra ya da pompacı işi devralınca */
function tutBitir() {
  tutStep = TUT_SON
  localStorage.setItem(TUT_KEY, 'bitti')
  if (tutEl) tutEl.style.display = 'none'
}

// 1) İLK MÜŞTERİ SAHNEDE → KARAR: hangi yakıt? (müşterinin istediği renk)
function tutStart() {
  if (tutStep !== 0 || !tutActive() || (state.stats.served || 0) > 0) return
  tutGoster(1, t('Hoş geldin patron! İlk müşterin geldi — panelde ne istediğine bak ve <b>o renkteki tabancayı</b> seç.'))
}
// 2) tabanca seçildi → KARAR: ne kadar veriyorsun?  3) dolum başladı → KARAR: hız mı özen mi?
function tutAdvance(to: number) {
  if (tutStep === 0 || tutStep >= TUT_SON) return
  if (to === 2 && tutStep < 2) {
    tutGoster(2, t('Tabanca seçildi. Şimdi <b>tutar gir</b> ya da <b>FULLE</b> bas — sonra <b>BAŞLAT</b>.'))
  } else if (to === 3 && tutStep < 3) {
    tutGoster(3, t('Dolum başladı. Beklerken <b>cam temizle</b>: bahşiş ve yıldız artar — hızlı servis seriyi büyütür.'))
  }
}
// 4) İLK SATIŞ TAMAM → asıl karar burada: para NEREYE gidiyor? (döngünün 3.→4. halkası)
function tutSatisTamam() {
  if (tutStep === 0 || tutStep >= 4 || !tutActive()) return
  // Butonun EKRANDAKİ adı yazılır ("İnşaat"); "mağaza" deseydik oyuncu aradığını bulamazdı.
  tutGoster(4, t('İlk satışın kasada. Asıl karar bu: parayı nereye yatıracaksın? <b>İNŞAAT</b>’ı aç — 2. pompa aynı anda iki müşteri demek.'))
}
// 5) MAĞAZA AÇILDI → öğretici biter ve hedef belirlemeyi GÜNLÜK GÖREVLERE devreder.
// Bu son söz KUTUYLA DEĞİL TOAST'la verilir: mağaza açıkken kutu tam sekme şeridinin
// (İstasyon/Tesisler/Enerji/Arsa) üstüne oturuyordu — ölçüldü. Toast hem çakışmaz hem de
// yapışkan olduğu için mesaj kutusuna düşer, oyuncu sonra tekrar okuyabilir.
function tutMagazaAcildi() {
  if (tutStep === 0 || tutStep >= TUT_SON || !tutActive()) return
  tutBitir()
  ui.toast(t('Kilitli satırların NEDENİ hep yazar. Sıradaki hedefin için günlük görevlere bak — hazırsın patron!'), 'good', true)
}
/** ipucu takılı kalmasın: pompacı manuel servisi devraldığında öğreticinin dayanağı kalmaz */
function tutDismiss() {
  if (tutStep === 0 || tutStep >= TUT_SON) return
  tutBitir()
}
// ATLANABİLİR (zorunlu tutmak deneyimli oyuncuyu kaçırır): ✕ her ipucunda görünür
document.getElementById('tut-skip')?.addEventListener('click', () => {
  tutBitir()
  ui.toast(t('Öğretici kapatıldı — Ayarlar’dan istediğin an yeniden başlatabilirsin.'), '')
})
// MAĞAZA hem masaüstü #shopbtn'inden hem alt navbardan (openSection('build') → aynı butonu
// tıklar) açılır; tek dinleyici iki yolu da yakalar.
document.getElementById('shopbtn')?.addEventListener('click', () => tutMagazaAcildi())
// AYARLAR → yeniden başlat (öğreticiyi kaçıran/yeniden görmek isteyen oyuncu için)
document.getElementById('set-tutorial')?.addEventListener('click', () => {
  localStorage.removeItem(TUT_KEY)
  localStorage.removeItem(TUT_ESKI_KEY)
  tutStep = 0
  if (tutEl) tutEl.style.display = 'none'
  ui.toast(state.day <= 1
    ? t('Öğretici yeniden başladı — sıradaki müşteride ilk ipucu gelecek.')
    : t('Öğretici sıfırlandı — ipuçları yeni bir istasyonun 1. gününde gösterilir.'), 'good', true)
})

// ═══════════════════════ BAŞTAN BAŞLA (oyunu sıfırlama) ═══════════════════════
//
// 6 açık geri bildirim doğrudan "oyunu nasıl sıfırlarım" diye soruyor (#77 #210 #228
// #251 #305 #1195). Düğme ASLINDA VARDI — ama iki kusurluydu:
//   1) BULUNAMIYORDU: "Oyun kaydı otomatik tutulur (her 5 sn)" başlığının altındaydı.
//   2) MİSAFİRDE ÇALIŞMIYORDU: eski akış yalnız auth.pushSave(null) çağırıyordu; giriş
//      yapmamış oyuncunun kaydı localStorage'daki 'benzinlik-guest' anahtarında durur ve
//      hiç silinmezdi → sayfa yenilenince aynı istasyon geri geliyordu. Sıfırlamak
//      isteyen oyuncuların çoğunluğu hesapsız oyuncudur; yani düğme tam da onlarda ölüydü.
//
// Sunucu tarafında MEŞRU sıfırlama yolu pushSave(null)'dır (server/index.js: save=NULL →
// sonraki push firstSave sayılır, anti-cheat serbest bırakır). Kendi yolumuzu icat
// etmiyoruz. DEVİRLE (prestige) KARIŞTIRILMAZ: devir ödüllüdür, yıldızları korur; bu
// işlem hiçbir şey taşımaz.
let sifirlaArmedAt = 0
let sifirlaTimer: ReturnType<typeof setTimeout> | null = null
const SIFIRLA_PENCERE = 8000 // ms: ikinci onay için süre (kaza ile üst üste basılmasın)
function sifirlaDugmesiniTazele() {
  const b = document.getElementById('set-restart')
  if (!b) return
  const armed = Date.now() - sifirlaArmedAt < SIFIRLA_PENCERE
  b.textContent = armed ? t('EMİN MİSİN? Silmek için tekrar bas') : t('Baştan Başla')
  b.classList.toggle('warn', armed)
}
async function oyunuSifirla() {
  sifirlaniyor = true
  ui.toast(t('Kayıt siliniyor — oyun baştan başlıyor…'), '', true)
  // 1) BULUT: meşru sıfırlama yolu (server/index.js yorumları) — save=NULL
  if (auth.loggedIn()) await auth.pushSave(null).catch(() => { /* çevrimdışı: yerel silme yine de olsun */ })
  // 2) YEREL: misafir kaydı + sahne ipucu. Bunlar silinmezse reload eski istasyonu geri kurar.
  auth.clearGuest()
  try {
    localStorage.removeItem(LOC_HINT_KEY)   // sahne varsayılan şubeyle (kasaba) kurulsun
    localStorage.removeItem(DEVIR_RAPOR_KEY) // önceki devrin raporu yeni oyuna taşmasın
    localStorage.removeItem(REHBER_KEY)      // rehber kilometre taşları yeniden duyurulsun
    localStorage.removeItem(TUT_KEY)         // baştan başlayan oyuncu ilk ipuçlarını yine görsün
    localStorage.removeItem(TUT_ESKI_KEY)
  } catch { /* kota/gizli sekme */ }
  // 3) Otomatik kayıt bu sıfırlamanın ÜSTÜNE yazmasın diye yeniden yükle (kalıcı hâl sunucuda NULL)
  location.reload()
}
document.getElementById('set-restart')?.addEventListener('click', () => {
  // ÇİFT ONAY: ilk basış düğmeyi "kurar", ikincisi siler. Kayıp listesi düğmenin hemen
  // üstünde zaten yazılı (#restart-what) — oyuncu neyi kaybettiğini okumadan basamaz.
  if (Date.now() - sifirlaArmedAt >= SIFIRLA_PENCERE) {
    sifirlaArmedAt = Date.now()
    sifirlaDugmesiniTazele()
    ui.toast(t('Bu işlem GERİ ALINAMAZ: istasyonun, paran, günün, marka yıldızların ve şubelerin silinir. Onaylamak için düğmeye 8 saniye içinde tekrar bas.'), 'bad', true)
    if (sifirlaTimer) clearTimeout(sifirlaTimer)
    sifirlaTimer = setTimeout(sifirlaDugmesiniTazele, SIFIRLA_PENCERE + 50) // süre dolunca kendini geri alır
    return
  }
  sifirlaArmedAt = 0
  if (sifirlaTimer) { clearTimeout(sifirlaTimer); sifirlaTimer = null }
  sifirlaDugmesiniTazele()
  void oyunuSifirla()
})

// ═══════════ SİSTEM ÖN-UYARILARI: "aniden gelen" sistemler önce haber verir ═══════════
//
// 4 açık kayıt (#453 #819 #1217 #1208) ruhsat/denetim, sözleşme cezası ve kredi gibi
// sistemlerin NE İŞE YARADIĞINI ve NE ZAMAN DEVREYE GİRDİĞİNİ soruyor. Bu sistemler
// oyuncuya ilk kez KESİNTİ olarak görünüyor — sebebini sonradan anlıyor.
//
// Yeni sistem kurulmadı: mevcut toast (yapışkan → mesaj kutusuna düşer) ve rehberDuyur'un
// tek-seferlik kilometre taşı defteri kullanıldı. Her uyarı bir kez, ilk devreye
// girmeden ÖNCE, tek cümlede.
function sistemOnUyarilari() {
  if (isFullMode || isPromoMode) return
  // RUHSAT & DENETİM — 30 günde bir kesilir. 3 gün önceden haber verilir ki oyuncu
  // kasasında parayı bulundursun (parası varsa otomatik ödenir, yoksa itibar cezası).
  if (state.day >= state.licenseDueDay - 3 && state.day < state.licenseDueDay) {
    rehberDuyur('sistem:ruhsat', t('Gün {0}: işletme ruhsatın yenilenecek (~₺{1}, 30 günde bir). Kasanda para varsa otomatik ödenir; yetmezse denetim itibarını düşürür.',
      String(state.licenseDueDay), trY(state.licenseFee())), '')
  }
  // SÖZLEŞME CEZASI — ilk ihale teklifi görününce, İMZALAMADAN önce.
  if (!state.contract && state.contractOffers().length > 0) {
    rehberDuyur('sistem:sozlesme', t('İhale teklifleri açıldı. Sözleşme bir GÜNLÜK TAAHHÜTTÜR: teslim edemediğin her gün ceza kesilir. Tankında taahhüdün 2 katını tutarsan gün sonunda otomatik tamamlanır ve ceza yemezsin.'), '')
  }
}

// KREDİ — banka ilk kez açıldığında, para almadan ÖNCE. Kredi yıldız yolunu da
// duraklatır (canHandover borçsuzluk ister); oyuncu bunu ödeme gecikince öğreniyordu.
document.getElementById('of-bank')?.addEventListener('click', () => {
  rehberDuyur('sistem:kredi', t('Kredi TEMİNATLIDIR: taksit gecikirse rehin verdiğin binalara haciz gelir. Ayrıca kredi açıkken istasyonu DEVREDEMEZSİN — marka yıldızı yolun kredi kapanana kadar durur.'), '')
})

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

// MİSAFİR canlı nabız: hesapsız oyuncu 60 sn'de bir varlık pingi atar → admin panelde
// "şu an kaç misafir oynuyor" görünür (WS token istediğinden misafir orada sayılamıyor)
function guestPing() {
  if (isPromoMode || auth.loggedIn()) return
  fetch('/api/guest-ping', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ sid: auth.sessionId() }),
  }).catch(() => {})
}
guestPing()
setInterval(guestPing, 60_000)

// ---- Zorunlu giriş kapısı: hesap yoksa oyun oynanmaz ----
async function doLogin(email: string, pass: string) {
  await auth.login(email, pass)
  location.reload()
}
async function doRegister(email: string, pass: string) {
  await auth.register(email, pass)
  location.reload()
}

// authgate yalnız HESAPLIYKEN kaldırılır — misafirde DOM'da KALIR (başta görünür + 'Şimdi Kayıt Ol' yeniden açar).
// (Eski halt akışından kalma koşulsuz remove(), misafirin gate'ini siliyordu → otomatik-giriş bug'ı.)
if (auth.loggedIn()) document.getElementById('authgate')?.remove()
{
  // ---- OPEX rampa başlangıcı: alan yoksa (eski save / yeni oyuncu) bu günden başlat ----
  // 10 günlük %0→%100 rampa: mevcut oyuncular şok yaşamaz; bir kez duyurulur.
  if (!isFullMode && !isPromoMode && !state.opexStart) {
    state.opexStart = state.day
    if (state.equipmentValue() > 50_000 && !localStorage.getItem('beneloil-opex-note')) {
      localStorage.setItem('beneloil-opex-note', '1')
      ui.toast(t('YENİ: İşletme giderleri geldi (bakım+vergi, varlıkla ölçekli) — 10 günde kademeli devreye girer. Ofis panelinden takip et.'), '', true)
    }
  }

  // ---- Kayıt bonusu: register / OAuth-yeni-hesap sonrası İLK açılışta bir kez ----
  if (!isFullMode && !isPromoMode && auth.loggedIn() && localStorage.getItem(auth.REG_BONUS_KEY)) {
    localStorage.removeItem(auth.REG_BONUS_KEY)
    state.money += 2500
    ui.toast(t('Kayıt bonusu: +₺2.500 kasana geçti — hoş geldin patron!'), 'good', true)
    audio.achieve()
    persist()
  }

  // ---- Günlük giriş bonusu + seri + görev sıfırlama ----
  // Seri bonusu KAYITLI oyunculara özel: misafir→kayıt dönüşüm teşviki. Misafir her gün
  // ne kaçırdığını görür (somut ₺ + kilit) — kayıt olunca seri sıfırdan başlar.
  const today = new Date().toISOString().slice(0, 10)
  if (!isFullMode && state.lastLoginDate !== today) {
    if (auth.loggedIn()) {
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
        ui.toast(t('Tekrar hoş geldin patron! Dönüş hediyesi: +₺1.000'), 'good', true)
      }
      state.dailyDate = today
      gunlukSayaclariSifirla()
      persist()
    } else {
      state.lastLoginDate = today // teaser günde 1 kez görünsün
      ui.toast(t('Günlük giriş bonusu (+₺500, seriyle ₺2.000’e kadar) kayıtlı oyunculara özel — kaydol, serin başlasın!'), '', true)
    }
  }
  if (state.dailyDate !== today) {
    state.dailyDate = today
    gunlukSayaclariSifirla()
  }

  // ---- Offline kazanç raporu: sen yokken tesisler çalıştı ----
  // KAPALI İSTASYON ÇALIŞMAZ (oyuncu raporu: "kapatıp gittim, dönünce 'senin için çalıştı'
  // bildirimi geldi") — bu blokta closed guard'ı yoktu; kumbara/idle/pompacı satışı
  // kapalıyken de işliyordu. Artık kapalıyken hiçbir offline kazanç işlemez.
  if (loadedSaveAt > 0) applyAwayEarnings((Date.now() - loadedSaveAt) / 1000) // guard'lar fonksiyonun içinde

  // ---- DEVİR RAPORU: yenilemenin diğer ucu ----
  // Devir sayfayı yeniliyor; oyuncu boş arsaya düşünce "ne kazandım?" boşluğu doğuyordu.
  // Kalıcı kazançlar burada sayıyla gösterilir. Offline modalından SONRA gelsin ki
  // en son okunan ekran "yeni tur" olsun.
  maybeShowDevirModal()
}

ui.onLogin = async (email, pass) => {
  try {
    await auth.login(email, pass)
    location.reload()
  } catch (err) {
    const ed = (err as Error & { data?: { appeal?: boolean; token?: string } }).data
    if (ed?.appeal) { showAppealOverlay(ed.token); return }
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
    'airwater', 'selfwash', 'coffee', 'restaurant', 'truckpark', 'hotel', 'cleaner', 'parking',
  ]
  state.money = 10_000_000
  for (const id of FULL_ORDER) {
    if (buyItem(state, id)) buildVisual(id)
  }
  state.money = 50_000
  for (const f of FUELS) state.tanks[f] = state.fuelCapacity(f)
  state.battery = state.batteryCapacity
  ui.toast('FULL MOD: her şey kurulu — sürükleyerek gez, tekerlekle yaklaş!', 'good')
}

ui.onMaint = id => {
  if (id === 'open-order') { ui.hideBuildingCard(); openSection('order'); return } // tanka tıkla → yakıt siparişi
  if (id === 'rename-sign') { ui.hideBuildingCard(); openRenameModal(); return } // tabelaya tıkla → isim değiştir
  if (id === 'clear-wreck') { // radyoaktif temizlik: enkaz kalkar, reaktör slotu yeniden açılır
    if (state.money < 18_000) { ui.toast(t('Temizlik için ₺18.000 gerekli — kasan yetmiyor.'), 'bad'); return }
    state.money -= 18_000
    state.smrWreck = false
    world.removeBuildingGroup('smrwreck')
    ui.hideBuildingCard()
    ui.toast(t('Radyoaktif enkaz kaldırıldı — bölge temiz, yeni reaktör kurulabilir.'), 'good', true)
    persist()
    return
  }
  if (id.startsWith('auto-pump-')) {
    const i = parseInt(id.slice(10))
    if (state.autoPumps.has(i)) {
      state.autoPumps.delete(i)
      ui.toast(t('Pompa #{0}: pompacı işten çıktı — dolum yine sende.', i + 1), '')
    } else {
      if (state.money < POMPACI_HIRE) {
        ui.toast(t('Para yetmiyor — pompacı işe alma ₺{0}.', POMPACI_HIRE.toLocaleString('tr-TR')), 'bad')
        return
      }
      state.money -= POMPACI_HIRE
      state.autoPumps.add(i)
      audio.build()
      ui.toast(t('Pompa #{0}: pompacı işe alındı — doğru yakıtı kendisi doldurur, satışın tamamı kasada. Yalnızca bahşiş pompacının.', i + 1), 'good')
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
        ui.toast(t('Para yetmiyor — şarjcı işe alma ₺{0}.', EV_ATTENDANT_HIRE.toLocaleString('tr-TR')), 'bad')
        return
      }
      state.money -= EV_ATTENDANT_HIRE
      state.autoChargers.add(i)
      ui.toast(t('DC Şarj #{0}: şarjcı işe alındı — EV sormadan şarj olur, gelir tamamen senin!', i + 1), 'good')
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
    if (id === 'clean-solar') ui.toast('Paneller tertemiz, üretim tam güçte!', 'good')
    else if (id === 'maint-smr') ui.toast('Reaktör bakımı yapıldı, güvendesin.', 'good')
    else if (id === 'order-uranium') ui.toast('Uranyum siparişi verildi — özel konvoy yolda!', 'good')
    else ui.toast('Tamir edildi, tekrar hizmette!', 'good')
    if (selectedBuilding) refreshBuildingCard()
  } else {
    ui.toast('Bunun için yeterli para yok!', 'bad')
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

// ---- İstasyon adı (TABELA kartından değiştirilir; ayarlardan kaldırıldı) ----
function applyStationName(name: string, silent = false) {
  world.setStationName(name)
  state.stationName = world.stationName // hesaba bağlı: bulut kaydıyla gezer
  document.title = `${world.stationName} — Benzinlik`
  if (!silent) {
    ui.toast(t('Tabela güncellendi: {0}', world.stationName), 'good')
    persist()
  }
}

/** tabelaya tıkla → küçük isim modalı (Oğuz: "ayarların içinde olmasın") */
function openRenameModal() {
  if (document.getElementById('renamewrap')) return
  const o = document.createElement('div')
  o.id = 'renamewrap'
  o.style.cssText = 'position:fixed;inset:0;z-index:9000;background:rgba(9,14,20,.45);display:flex;align-items:center;justify-content:center;padding:24px'
  o.innerHTML = `<div style="background:#faf6ec;border-radius:16px;padding:18px;max-width:340px;width:100%;box-shadow:0 12px 40px rgba(0,0,0,.28)">
    <div style="font-weight:800;font-size:16px;margin-bottom:10px;color:#1c2530">${t('Tabela adı')}</div>
    <input id="stname" type="text" maxlength="14" style="width:100%;box-sizing:border-box" />
    <div style="display:flex;gap:8px;margin-top:12px">
      <button id="rn-cancel" class="btn" style="flex:1;justify-content:center">${t('Vazgeç')}</button>
      <button id="rn-ok" class="btn good" style="flex:1;justify-content:center">${t('Kaydet')}</button>
    </div></div>`
  document.body.appendChild(o)
  const input = document.getElementById('stname') as HTMLInputElement
  input.value = world.stationName
  input.focus(); input.select()
  const close = () => o.remove()
  const save = () => { applyStationName(input.value); close() }
  document.getElementById('rn-ok')?.addEventListener('click', save)
  document.getElementById('rn-cancel')?.addEventListener('click', close)
  input.addEventListener('keydown', e => { if (e.key === 'Enter') save(); if (e.key === 'Escape') close() })
  o.addEventListener('pointerdown', e => { if (e.target === o) close() })
}

// eski tarayıcı-geneli isim kaydından hesaba göç (bir kereye mahsus)
const legacyName = localStorage.getItem('benzinlik-station-name')
applyStationName(
  state.stationName && state.stationName !== t('BENZİNLİK')
    ? state.stationName
    : (legacyName && legacyName !== 'OPET' ? legacyName : t('BENELOIL')),
  true,
)

// kâr marjı ayarı (ofis kartından): alış sabit, satışı oyuncu belirler
function syncSignPrices() {
  world.setPrices(state.prices.benzin, state.prices.dizel, state.prices.lpg,
    state.evChargers > 0 ? state.elecPrice : 0)
}
syncSignPrices()
ui.onPriceChange = (f, delta) => {
  if ((f as string) === 'mkt') {
    // reklam bütçesi: ± ₺1.000 kademe (0..8.000) — fiyat satırıyla aynı +/- kalıbı
    const step = delta < 0 ? -1000 : 1000
    state.marketingBudget = Math.min(8000, Math.max(0, state.marketingBudget + step))
  } else if (f === 'elec') {
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

/** yakıt + elektrik satış fiyatı stepper satırları (ofis kartı ve tabela paylaşır) */
function fuelPriceRows(): NonNullable<BuildingCard['priceRows']> {
  return [
    ...(['benzin', 'dizel', 'lpg'] as FuelType[]).map(f => {
      const [lo, hi] = priceBounds(f)
      return {
        f: f as FuelType | 'elec', label: FUEL_LABEL[f], price: state.prices[f],
        // Katman 4b: alış fiyatı artık PİYASA ile dalgalanıyor — yön oku ile göster
        cost: `${state.buyPrice(f)} ${state.marketIndex(state.day + 1, f) > state.marketIndex(state.day, f) ? '▲' : '▼'}` as number | string,
        canDown: state.prices[f] > lo, canUp: state.prices[f] < hi,
      }
    }),
    {
      f: 'elec' as FuelType | 'elec', label: 'Elektrik (kWh)', price: state.elecPrice, cost: 'santralden',
      canDown: state.elecPrice > 4, canUp: state.elecPrice < 18,
    },
    {
      // günlük reklam bütçesi — parayı doğrudan trafiğe çeviren sink (lategame raporu #2)
      f: 'mkt' as unknown as FuelType | 'elec', label: t('Reklam (günlük)'), price: state.marketingBudget,
      cost: t('trafik ×{0}', state.trafficPull().toFixed(2)),
      canDown: state.marketingBudget > 0, canUp: state.marketingBudget < 8000,
    },
  ]
}

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
        [t('Dolum hızı'), t('{0} L/sn', (FILL_RATE * state.pumpSpeedMult() * state.staffFillMult()).toFixed(1)), state.pumpSpeedLevel > 0 ? 'good' : ''],
        [t('Pompacı'), state.autoPumps.has(i) ? t('ÇALIŞIYOR (gelir senin)') : t('YOK'), state.autoPumps.has(i) ? 'good' : undefined],
        [t('Yovmiye'), t('₺{0}/gün', POMPACI_WAGE), state.autoPumps.has(i) ? 'bad' : undefined],
        [t('Benzin'), `₺${state.prices.benzin}/L`],
        [t('Dizel'), `₺${state.prices.dizel}/L`],
      ],
      action: broken
        ? { label: 'Tamir Et — ₺800', maintId: `fix-pump-${i}` }
        : state.autoPumps.has(i)
          ? { label: t('Pompacıyı işten çıkar'), maintId: `auto-pump-${i}` }
          : { label: t('Pompacı Tut — ₺{0} + ₺{1}/gün', POMPACI_HIRE.toLocaleString('tr-TR'), POMPACI_WAGE), maintId: `auto-pump-${i}` },
      // Oğuz: pompaya tıklayıp güçlendirme — hız seviyesi karttan alınır (tüm pompalara işler)
      buy: state.pumpSpeedLevel < 3
        ? { label: t('Hızlı Dolum Sv.{0} — ₺{1}', state.pumpSpeedLevel + 1, PUMPSPEED_COSTS[state.pumpSpeedLevel].toLocaleString('tr-TR')), id: 'pumpspeed' }
        : undefined,
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
        ? { label: 'Tamir Et — ₺1.000', maintId: `fix-charger-${i}` }
        : state.autoChargers.has(i)
          ? { label: t('Şarjcıyı işten çıkar'), maintId: `auto-charger-${i}` }
          : { label: t('Şarjcı Tut — ₺{0} + ₺{1}/gün', EV_ATTENDANT_HIRE.toLocaleString('tr-TR'), EV_ATTENDANT_WAGE), maintId: `auto-charger-${i}` },
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
        priceRows: fuelPriceRows(),
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
          ? { label: t('Geniş Giriş-Çıkış — ₺{0}', wg.cost.toLocaleString('tr-TR')), id: 'widegate' }
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
          ? { label: t('Geniş Giriş-Çıkış — ₺{0}', wg.cost.toLocaleString('tr-TR')), id: 'widegate' }
          : undefined,
      }
    }
    // KARŞI KAPILAR: genişlik satırı + satın alma butonu near kapılarla AYNI. "Geniş
    // Giriş-Çıkış" tek satın almadır ve artık her iki yakayı da genişletir; panel bunu
    // göstermeyince oyuncu mağazada "MAKS" görüp "karşı kapı genişlemiyor" sanıyordu.
    case 'gatein2': {
      const wg = getShopItems(state).find(r => r.id === 'widegate')
      return {
        icon: 'i-move', name: t('Karşı Giriş Kapısı'),
        desc: t('Karşı (yol karşısı) istasyona müşteriler buradan girer. Taşı ile yol kenarında yerini ayarla.'),
        stats: [
          [t('Genişlik'), state.wideGates ? t('Geniş · 2 şerit') : t('Tek şerit'), state.wideGates ? 'good' : ''],
          ['Kural', t('Çıkışla arası en az 5 birim')]],
        buy: (!state.wideGates && wg && wg.status === 'buy' && wg.cost !== null)
          ? { label: t('Geniş Giriş-Çıkış — ₺{0}', wg.cost.toLocaleString('tr-TR')), id: 'widegate' }
          : undefined,
      }
    }
    case 'gateout2': {
      const wg = getShopItems(state).find(r => r.id === 'widegate')
      return {
        icon: 'i-move', name: t('Karşı Çıkış Kapısı'),
        desc: t('Karşı istasyondan araçlar buradan çıkıp yola karışır. Taşı ile yerini belirle.'),
        stats: [
          [t('Genişlik'), state.wideGates ? t('Geniş · 2 şerit') : t('Tek şerit'), state.wideGates ? 'good' : ''],
          ['Kural', t('Girişle arası en az 5 birim')]],
        buy: (!state.wideGates && wg && wg.status === 'buy' && wg.cost !== null)
          ? { label: t('Geniş Giriş-Çıkış — ₺{0}', wg.cost.toLocaleString('tr-TR')), id: 'widegate' }
          : undefined,
      }
    }
    case 'sign':
      return {
        icon: 'i-sign', name: t('Tabela'),
        desc: t('Yoldan geçenlerin uğrama şansını artırır. Fiyatları buradan da ayarlayabilir, Taşı ile yerini değiştirebilirsin.'),
        stats: [
          [t('Seviye'), `${state.signLevel + 1}/4`],
          [t('Trafik etkisi'), `+%${state.signLevel * 10}`, state.signLevel > 0 ? 'good' : ''],
          [t('İsim'), world.stationName],
        ],
        priceRows: fuelPriceRows(), // tabela = fiyat panosu: yakıt + elektrik fiyatları buradan değişir
        action: { label: t('Adı Değiştir'), maintId: 'rename-sign' },
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
        action: { label: t('Yakıt Siparişi Ver'), maintId: 'open-order' },
        // Oğuz: tanka tıklayıp seviye artırma (marinada da çalışır — satır katalogda)
        buy: state.tankLevel < 3
          ? { label: t('Depoyu Büyüt — ₺{0} ({1}L)', TANK_COSTS[state.tankLevel].toLocaleString('tr-TR'), TANK_CAPACITY[state.tankLevel + 1]), id: 'tank' }
          : undefined,
      }
    case 'battery':
      return {
        icon: 'i-batt', name: 'Batarya Deposu',
        desc: t('Santrallerin ürettiği elektriği biriktirir. Elektrikli araçlar buradan anında şarj alır.'),
        stats: [
          [t('Dolu'), `${Math.floor(state.battery)} / ${state.batteryCapacity} kWh`],
          [t('Üretim'), t('+{0} kWh/sn (şebeke dahil)', state.genRate().toFixed(1)), 'good'],
          [t('Şebeke maliyeti'), `₺${GRID_COST_PER_KWH}/kWh`, 'bad'],
          [t('Araca akış'), `${DISCHARGE_RATE[state.batteryLevel] ?? DISCHARGE_RATE[DISCHARGE_RATE.length - 1]} kWh/sn`], // sv4+ 'undefined kWh/sn' fixi
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
    case 'toilet2':
      return { icon: 'i-toilet', name: t('Karşı Tuvalet Sv.{0}', state.toilet2Level),
        desc: t('Yol karşısı istasyonun tuvaleti — karşı yakanın müşterileri kullanır.'),
        stats: [[t('Ücret'), state.toiletFee > 0 ? `₺${state.toiletFee}` : t('ücretsiz')], [t('Kullanım oranı'), '~%12']] }
    case 'wash2':
      return { icon: 'i-wash', name: t('Karşı Oto Yıkama'),
        desc: t('Karşı yakadaki müşteriler araç yıkatır.'), stats: [['+₺60-120', '~%25']] }
    case 'oil2':
      return { icon: 'i-oil', name: t('Karşı Yağ Değişimi'),
        desc: t('Karşı yakada yağ değişimi hizmeti.'), stats: [['+₺150-250', '~%12']] }
    case 'coffee2':
      return { icon: 'i-coffee', name: t('Karşı Kahveci'),
        desc: t('Karşı yakadaki yolcular kahve molası verir.'), stats: [['+₺20-45', '~%30']] }
    case 'restaurant2':
      return { icon: 'i-food', name: t('Karşı Restoran'),
        desc: t('Karşı yakada yemek molası.'), stats: [['+₺80-160', '~%18']] }
    case 'truckpark2':
      return { icon: 'i-truck', name: t('Karşı Tır Parkı'),
        desc: t('Karşı yakada tırcılar konaklar — düzenli pasif gelir.'), stats: [['+₺90-160/dk', t('pasif')]] }
    case 'market2':
      return {
        icon: 'i-market', name: t('Karşı Market Sv.{0}', state.market2Level),
        desc: t('Yol karşısı istasyonun müşterileri buradan alışveriş yapar — karşı yakaya ekstra gelir.'),
        stats: [
          [t('Müşteri harcaması'), `₺${25 * state.market2Level}-${60 * state.market2Level}`],
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
      const net = 3 * (1 - 0.7 * state.solarDirt) * (state.gridLevel >= 2 ? 1.3 : 1) * state.sunFactor
      return {
        icon: 'i-solar', name: t('Güneş Santrali'),
        desc: t('Gündüz bedava elektrik üretir — GECE ÜRETMEZ, gündüz fazlasını Batarya Deposunda sakla. Paneller kirlendikçe verim düşer.'),
        stats: [
          [t('Üretim'), `+${net.toFixed(1)} kWh/sn`, net < 1 ? 'bad' : 'good'],
          [t('Gökyüzü'), state.sunFactor > 0.85 ? t('Güneşli') : state.sunFactor > 0.15 ? t('Alacakaranlık') : t('Gece — üretim yok'), state.sunFactor > 0.85 ? 'good' : state.sunFactor <= 0.15 ? 'bad' : ''],
          [t('Kirlilik'), `%${Math.round(state.solarDirt * 100)}`, state.solarDirt > 0.6 ? 'bad' : ''],
        ],
        action: state.solarDirt >= 0.15 ? { label: 'Temizle — ₺300', maintId: 'clean-solar' } : undefined,
      }
    }
    case 'dieselgen':
      return {
        icon: 'i-gen', name: t('Dizel Jeneratör'),
        desc: t('Tanktan mazot yakarak elektrik üretir. Çalışırken gürültüsü şarjdaki müşterileri rahatsız eder.'),
        stats: [
          [t('Üretim'), `+7 kWh/sn`],
          [t('Yakıt tüketimi'), '0.25 L/sn'],
          [t('Durum'), state.dieselRunning() ? t('ÇALIŞIYOR') : 'Beklemede', state.dieselRunning() ? 'bad' : 'good'],
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
    case 'hotel':
      return {
        icon: 'i-hotel', name: t('Yol Kenarı Oteli'),
        desc: t('Yolcular geceler. Doluluk itibarına bağlıdır — ihmal edilen istasyonde oda boş kalır.'),
        stats: [[t('Pasif gelir'), '₺260-480 / ~58sn'],
                [t('Doluluk'), `%${Math.round((0.45 + 0.13 * Math.min(4, state.reputation)) * 100)}`],
                [t('Günlük gider'), '₺900', 'bad'],
                [t('Trafik etkisi'), '+%5']],
      }
    case 'lamp':
      // Oyuncu raporu: "can't move street lamp" — kartı yoktu, tıklanınca hiçbir şey
      // açılmıyordu; Taşı/Yık butonları bu karta genel akıştan otomatik eklenir.
      return {
        icon: 'i-bolt', name: t('Sokak Lambası'),
        desc: t('Gece istasyonu aydınlatır, küçük itibar katkısı verir. Buradan taşıyabilirsin.'),
        stats: [[t('Adet'), `${state.lampCount}`]],
      }
    case 'airwater': {
      const n = Math.min(6, Math.max(1, state.airWaterCount))
      return {
        icon: 'i-air', name: state.airWaterCount > 1 ? t('Hava-Su Ünitesi (×{0} — ortak kumbara)', state.airWaterCount) : t('Hava-Su Ünitesi'),
        desc: t('Lastik havası ve su. Küçük gelir ama müşteri çeker. Üniteler ortak kumbarada biriktirir, gelir adetle artar.'),
        stats: [['Hizmet', `₺${10 * n}-${20 * n}`], [t('Kullanım'), '~%20']],
      }
    }
    case 'selfwash': {
      const n = Math.max(1, state.selfWashCount)
      return {
        icon: 'i-selfwash', name: n > 1 ? t('Self Yıkama (×{0} — ortak kumbara)', n) : t('Self Yıkama'),
        desc: t('Araçlar bölmelere girip kendileri yıkar; köpük ve su otomatik satılır. Üniteler ortak kumbarada biriktirir, gelir adetle artar.'),
        stats: [['Pasif gelir', `₺${30 * n}-${60 * n} / ~35sn`], ['Trafik etkisi', '+%2']],
      }
    }
    case 'parking':
      return {
        icon: 'i-parking', name: t('Otopark'),
        desc: t('Servisi biten müşteriler buraya park edip market, tuvalet, kahveci ve restoranı gezer.'),
        stats: (() => {
          const cap = world.getParkingSpots().length || 4
          const occ = Math.min(cars.cars.filter(c => c.phase === 'parked' || c.phase === 'toPark').length, cap)
          return [['Kapasite', t('{0} araç', cap)], ['Doluluk', `${occ}/${cap}`]]
        })(),
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
    case 'smrwreck':
      return {
        icon: 'i-reactor', name: t('Reaktör Enkazı'),
        desc: t('Patlamanın kalıntısı. Radyoaktif — temizletmeden bu bölgeye yeni reaktör kurulamaz.'),
        stats: [[t('Durum'), t('RADYOAKTİF'), 'bad']],
        action: { label: t('Radyoaktif Temizlik — ₺18.000'), maintId: 'clear-wreck' },
      }
    case 'smr': {
      const risk = state.smrWear > 0.7 ? t('YÜKSEK') : state.smrWear > 0.5 ? 'Orta' : t('Düşük')
      const producing = state.uranium > 0
      let action: BuildingCard['action']
      if (state.smrWear >= 0.5) action = { label: t('Bakım Yap — ₺1.500'), maintId: 'maint-smr' }
      else if (!state.uraniumPending && state.uranium <= 60) action = { label: t('Uranyum Sipariş Et — ₺{0}', URANIUM_COST.toLocaleString('tr-TR')), maintId: 'order-uranium' }
      else if (state.smrWear >= 0.1) action = { label: t('Bakım Yap — ₺1.500'), maintId: 'maint-smr' }
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
  if (['market', 'market2', 'toilet', 'toilet2', 'wash', 'wash2', 'oil', 'oil2', 'coffee', 'coffee2',
       'restaurant', 'restaurant2', 'truckpark', 'truckpark2', 'hotel', 'selfwash', 'airwater'].includes(facId)) {
    card.stats.push([t('Bugünkü ciro'), `₺${Math.round(state.facDaily[facId] ?? 0).toLocaleString('tr-TR')}`, 'good'])
    // SESSİZ GELİR SIFIRI (#1065 "Market üretim yapmıyor, yönünü değiştirdim çözüm olmadı"):
    // müşteri YAYA olarak yol karşısına geçmez. Tesis yolun bir yakasındayken o yakada
    // hiç pompa/şarj yoksa geliri MATEMATİKSEL OLARAK sıfırdır — ama hiçbir yerde
    // yazmıyordu, oyuncu binayı döndürüp duruyordu. Artık kart açıkça söylüyor.
    const b = world.buildings.find(x => x.id === selectedBuilding)
    if (b) {
      const karsida = b.group.position.x > ROAD_X
      const oYakadaUnite = world.pumpSlots.slice(0, state.pumps).some(p => (p.x > ROAD_X) === karsida)
        || world.evSlots.slice(0, state.evChargers).some(p => (p.x > ROAD_X) === karsida)
      if (!oYakadaUnite) {
        card.stats.push([t('UYARI'), t('Bu yakada pompa/şarj yok — müşteri karşıya yürümez, gelir sıfır kalır. Tesisi taşı.'), 'bad'])
      }
    }
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
  if (si) card.sell = { label: t('Yık — +₺{0}', si.refund.toLocaleString('tr-TR')), id: selectedBuilding }
  ui.setCardAnchor(binaEkranNoktasi(selectedBuilding))
  ui.showBuildingCard(card)
}

/** Seçili yapının ekran koordinatı — bilgi kartı onun üstünde açılsın diye (#1020). */
function binaEkranNoktasi(id: string): { x: number; y: number } | null {
  const b = world.buildings.find(x => x.id === id)
  if (!b) return null
  const g = b.group as THREE.Object3D
  g.updateMatrixWorld(true)
  // yapının tepesi: etiket yüksekliğini kullan (her bina kendi labelZ'sini veriyor)
  const p = new THREE.Vector3(0, 0, b.labelZ ?? 2.5).applyMatrix4(g.matrixWorld).project(camera)
  if (p.z > 1) return null                        // kamera arkasında
  return {
    x: (p.x * 0.5 + 0.5) * renderer.domElement.clientWidth,
    y: (-p.y * 0.5 + 0.5) * renderer.domElement.clientHeight,
  }
}

// ---- Ödüllü reklam: izle → müşteri patlaması ----
const adBtn = document.getElementById('adbtn') as HTMLButtonElement
const adBtnLabel = adBtn.querySelector('span') as HTMLSpanElement
let adCooldown = 120 // ilk fırsat: 2. dakika (baştan değil, biraz ilerleyince)
// fırsat-temelli ödüllü reklam teklifi (tycoon tarzı): müşteri patlaması VEYA gün kârını 2x
type AdUnit = { kind: 'pump' | 'charger'; i: number }
type AdOffer = {
  kind: 'rush' | 'double' | 'vip' | 'seri' | 'yakit' | 'tamir'
  profit: number
  fuel?: FuelType   // 'yakit': hangi tanka teslimat yapılacak
  unit?: AdUnit     // 'tamir': hangi ünite onarılacak
}
let adOffer: AdOffer = { kind: 'rush', profit: 0 }
// MOBİL GELİR REKLAMDAN: teklifler oyunun KRİZ anlarına bağlı (VIP kaçmak üzere,
// seri kırıldı, tank boşaldı, pompa patladı). Hepsi OPT-IN ve günlük sınırlı —
// nadir olan değerli görünür.
let vipAday: Car | null = null       // ekranda teklifi bekleyen VIP
let seriYedek = 0                    // kırılan seri, reklam izlenirse geri verilir
let teklifT = 0                      // teklifin ekranda kalma süresi (sn)
let doubleOfferT = 0 // 2x teklifi ekranda kalma süresi

/** teklif edilen ünite HÂLÂ bozuk mu — oyuncu kendi parasıyla tamir ettiyse teklif ölür */
function uniteBozukMu(u: AdUnit): boolean {
  return u.kind === 'pump' ? state.brokenPumps.has(u.i) : state.brokenChargers.has(u.i)
}

/**
 * Teklifi ekrana koyar. TEK KAPI: reklam altyapısı yoksa VEYA rewarded reklam
 * HENÜZ YÜKLENMEDİYSE buton HİÇ çıkmaz.
 *
 * Eskiden yalnız kriz çağrıları (VIP/seri) rewardedReady() kontrol ediyordu; 'rush' ve
 * 'double' etmiyordu → reklam hazır değilken buton görünüyor, oyuncu basıyor ve HİÇBİR
 * ŞEY olmuyordu ("reklam izle diyorum, açılmıyor"). Artık kontrol burada, tek yerde.
 *
 * Dönüş: teklif gerçekten gösterildiyse true. Çağıranlar teklife bağlı durumu
 * (vipAday, seriYedek, teklifT) SADECE true dönerse kurmalı — yoksa hayalet teklif kalır.
 */
function showAdOffer(kind: AdOffer['kind'], profit = 0, ek: { fuel?: FuelType; unit?: AdUnit } = {}): boolean {
  if (!adsEnabled() || !rewardedReady() || isFullMode || isPromoMode) return false
  adOffer = { kind, profit, ...ek }
  adBtnLabel.textContent =
      kind === 'double' ? t('Reklam İzle: Günü 2x Yap (+₺{0})', profit.toLocaleString('tr-TR'))
    : kind === 'vip' ? t('Reklam İzle: VIP\'yi Elde Tut (₺{0})', profit.toLocaleString('tr-TR'))
    : kind === 'seri' ? t('Reklam İzle: Seriyi Koru (×{0})', profit.toFixed(2))
    : kind === 'yakit' ? t('Reklam İzle: Acil {0} Teslimatı ({1} L)', t(FUEL_LABEL[ek.fuel ?? 'benzin']), GameState.AD_YAKIT_LITRE)
    : kind === 'tamir' ? t('Reklam İzle: Ücretsiz Tamir')
    : t('Reklam İzle: Müşteri Patlaması')
  adBtn.style.display = 'flex'
  return true
}

/**
 * ACİL YAKIT TESLİMATI TEKLİFİ — tetik: dolum sırasında tank boşaldı.
 * Kriz gerçek: müşteri yarım servisle gidiyor ve normal sipariş 1 GÜN sürüyor.
 * Tank zaten tepedeyse (ölü teklif) hiç sorulmaz.
 */
function teklifAcilYakit(f: FuelType) {
  if (state.adYakitHak <= 0 || adBtn.style.display !== 'none') return
  if (state.tanks[f] >= state.fuelCapacity(f)) return
  if (showAdOffer('yakit', 0, { fuel: f })) teklifT = 20   // 20 sn: an geçerse teklif iner
}

/**
 * ÜCRETSİZ TAMİR TEKLİFİ — tetik: dolum/şarj sırasında ünite arızalandı.
 * Kriz gerçek: kuyruk bekliyor, tamir hem para hem zaman istiyor.
 */
function teklifUcretsizTamir(kind: 'pump' | 'charger', i: number) {
  if (state.adTamirHak <= 0 || adBtn.style.display !== 'none' || i < 0) return
  if (!uniteBozukMu({ kind, i })) return
  if (showAdOffer('tamir', 0, { unit: { kind, i } })) teklifT = 18
}
adBtn.addEventListener('click', () => {
  adBtn.disabled = true
  const offer = adOffer
  rewarded(offer.kind === 'double' ? 'gun-2x' : offer.kind === 'vip' ? 'vip' : offer.kind === 'seri' ? 'seri'
    : offer.kind === 'yakit' ? 'acil-yakit' : offer.kind === 'tamir' ? 'ucretsiz-tamir' : 'musteri-patlamasi',
    () => {
      if (offer.kind === 'yakit') {
        // ACİL YAKIT TESLİMATI — NAKİT DEĞİL MAL. Sipariş 1 gün sürerken tanka anında
        // 300 L girer; kasaya kuruş girmez, satmak yine oyuncunun işi (ÖDÜL = FIRSAT).
        // Kapasite aşımı state tarafında kırpılır (dolu tanka fayda yok, hak da yanmaz).
        const f = offer.fuel ?? 'benzin'
        const gelen = state.adYakitTeslim(f)
        if (gelen > 0) {
          ui.toast(t('Acil teslimat geldi: {0} tankına +{1} L — satışa devam!', t(FUEL_LABEL[f]), Math.round(gelen)), 'good')
        } else {
          ui.toast(t('Tank zaten dolu — teslimata gerek kalmadı, hakkın duruyor.'), '')
        }
      } else if (offer.kind === 'tamir') {
        // ÜCRETSİZ TAMİR — gideri baştan engeller, para İADE ETMEZ. Oyuncu bu arada
        // kendi parasıyla tamir ettiyse state fail-closed davranır: hak harcanmaz.
        const u = offer.unit
        if (u && state.adTamirYap(u.kind, u.i)) {
          ui.toast(u.kind === 'pump'
            ? t('Pompa #{0} ücretsiz onarıldı — hemen servise hazır!', u.i + 1)
            : t('Şarj #{0} ücretsiz onarıldı — hemen servise hazır!', u.i + 1), 'good')
          if (selectedBuilding) refreshBuildingCard()   // bakım listesindeki tamir satırı anında düşsün
        } else {
          ui.toast(t('Ünite zaten onarılmış — hakkın duruyor.'), '')
        }
      } else if (offer.kind === 'vip') {
        // ÖDÜL = FIRSAT, nakit değil: sabır tazelenir + kuyrukta öne geçer. Ekonomiyi
        // şişirmediği için denge bozulmaz; oyuncu parayı yine SERVİS EDEREK kazanır.
        if (vipAday && vipAday.phase !== 'gone') {
          cars.vipKurtar(vipAday)
          state.adVipUsed++
          ui.toast(t('VIP müşteri elde tutuldu — sırayı ona verdik!'), 'good')
        }
        vipAday = null
      } else if (offer.kind === 'seri') {
        state.combo = seriYedek
        state.adSeriUsed++
        ui.toast(t('Seri kurtarıldı — ×{0} devam ediyor!', state.comboMult().toFixed(2)), 'good')
        seriYedek = 0
      } else if (offer.kind === 'double') {
        state.money += offer.profit
        ui.toast(t('Günün kârı 2 katına çıktı: +₺{0}!', offer.profit.toLocaleString('tr-TR')), 'good')
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
      teklifT = 0
      // vazgeçilen kriz teklifleri geri gelmez: aynı an bir kez sorulur, ısrar edilmez
      if (adOffer.kind === 'vip') vipAday = null
      if (adOffer.kind === 'seri') seriYedek = 0
      if (adOffer.kind === 'rush') adCooldown = watched ? 420 : 90 // izlediyse 7 dk, vazgeçtiyse 1.5 dk sonra tekrar
      // yakıt/tamir teklifleri de tek seferlik: aynı kriz için ikinci kez sorulmaz
      if (adOffer.kind === 'yakit' || adOffer.kind === 'tamir') adCooldown = Math.max(adCooldown, 45)
    })
})
/** gün sonu 2x-kâr fırsatı (kârlı gün + reklam varsa) — kısa süre görünür */
function offerDoubleProfit(profit: number) {
  if (profit <= 0) return
  // reklam hazır değilse showAdOffer false döner → sayaç da başlamaz (hayalet teklif yok)
  if (showAdOffer('double', profit)) doubleOfferT = 22 // 22 sn içinde izlemezsen kaçar
}

function tickAdOffer(dt: number) {
  if (!adsEnabled() || isFullMode || isPromoMode) return
  // KRİZ TEKLİFLERİ SÜRELİ (VIP / seri / yakıt / tamir): an geçince teklif anlamını
  // yitirir, ısrar edilmez. Kriz kendiliğinden çözüldüyse teklif ANINDA iner.
  if (teklifT > 0) {
    teklifT -= dt
    const vipGitti = adOffer.kind === 'vip' && (!vipAday || vipAday.phase === 'gone')
    // TAMİR: oyuncu bu arada üniteyi KENDİ parasıyla onardıysa teklif hemen kalkar —
    // yoksa reklam izletip çalışan üniteye "tamir ödülü" vermiş oluruz (bedava hak yakımı).
    const tamirBitti = adOffer.kind === 'tamir' && (!adOffer.unit || !uniteBozukMu(adOffer.unit))
    // YAKIT: tank bu arada (sipariş/başka yoldan) tepeye kadar dolduysa teslimatın
    // anlamı kalmaz — 0 L ödül vaat eden buton ekranda durmasın.
    const tankDoldu = adOffer.kind === 'yakit' && (!adOffer.fuel || state.tanks[adOffer.fuel] >= state.fuelCapacity(adOffer.fuel))
    if (teklifT <= 0 || vipGitti || tamirBitti || tankDoldu) {
      teklifT = 0
      if (adOffer.kind === 'vip' || adOffer.kind === 'seri' || adOffer.kind === 'yakit' || adOffer.kind === 'tamir') {
        adBtn.style.display = 'none'
        vipAday = null; seriYedek = 0
        adCooldown = Math.max(adCooldown, 45)   // kriz sonrası hemen 'rush' teklifi çıkmasın
      }
    }
    return
  }
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
    ? t('Düzenleme AÇIK — binaya dokun ve taşı')
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
      && !state.parcelLimitReached()
    : state.owns(c, r) && !state.isPaved(c, r) && state.money >= PAVE_COST
  ;(zoneMode.ghost.material as THREE.MeshBasicMaterial).color.setHex(zoneMode.valid ? 0x37c97e : 0xec5b5b)
  // canlı fiyat + durum etiketi (karşı/uzak arsalar pahalı — sürpriz olmasın) + mobil İPTAL
  const zw = document.getElementById('zonecostwrap')
  const zc = document.getElementById('zonecost')
  if (zw && zc) {
    const cost = zoneMode.kind === 'land' ? parcelCost(c, r, state) : PAVE_COST
    const lim = state.parcelLimit()
    const across = (c >= 3 ? t(' · yol karşısı') : '')
      + (lim !== null ? t(' · {0}/{1} parsel', String(state.ownedParcels.size), String(lim)) : '')
    zw.style.display = 'flex'
    // #1200: kendi arsanın üstündeyken etiket SATIŞ bedelini gösterir — oyuncu geri
    // satış diye bir şeyin var olduğunu ancak burada görebilir.
    const satis = zoneMode.kind === 'land' && state.owns(c, r) ? state.parcelRefund(c, r) : 0
    if (satis > 0) {
      zc.textContent = t('Arsan — dokun ve geri sat: +₺{0}', satis.toLocaleString('tr-TR'))
      zc.style.color = 'var(--green-dark)'
    } else {
      zc.textContent = `${zoneMode.kind === 'land' ? t('Arsa') : t('Beton')}: ₺${cost.toLocaleString('tr-TR')}${across}${zoneMode.valid ? ' ✓' : ''}`
      zc.style.color = zoneMode.valid ? 'var(--green-dark)' : 'var(--red)'
    }
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
      else ui.toast('Buraya yerleştiremezsin — sahipli ve betonlu alana koy.', 'bad')
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
        // #1200: KENDİ arsana dokunmak artık "zaten senin" çıkmaz sokağı değil, GERİ SATIŞ
        // kapısıdır. Arsanın tek çıkış yolu buydu; yoksa alınan arsa ölü sermaye kalıyordu.
        if (c >= 0 && state.owns(c, r) && state.parcelRefund(c, r) > 0) { arsaSatSor(c, r); return }
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
      // pompacı/şarjcı devredeyse otomasyon hallediyor → dokunulsa bile panel/popup AÇMA
      else if (isAttendantCar(c)) ui.toast(t('Pompacı bu aracı hallediyor.'), '', true)
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
      state.addSideRevenue(/2$/.test(cashFor.split('#')[0]), amt) // #317
      if (amt > 0) {
        state.dailyCollected++
        gorevOdulle()
        audio.cash()
        // çok üniteli tesiste kumbara ORTAKTIR (gelir zaten adetle çarpılır) — bunu söyle,
        // yoksa oyuncu "3 üniteden sadece 1'i kazanıyor" sanıyor (13 feedback)
        const cnt = COUNTABLE[cashFor]?.() ?? 0
        ui.toast(cnt > 1 ? t('+₺{0} toplandı! ({1} ünitenin ortak kumbarası — gelir ×{1})', amt, cnt)
          : t('+₺{0} toplandı!', amt), 'good', true)
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
let lastClockStr = ''
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

let bootRemoved = false
let frameQueued = false
function scheduleFrame() {
  if (frameQueued) return
  frameQueued = true
  requestAnimationFrame(() => { frameQueued = false; frame() })
}
function frame() {
  scheduleFrame()
  // AÇILIŞ MASKESİ — KOŞULSUZ KALDIRMA (KRİTİK regresyon fixi): eski kaldırma satırı
  // yalnız TOKEN'SIZ akışın (auth kapısı kurulumunun) içindeydi → KAYITLI her oyuncuda
  // maske sonsuza dek kalıyordu. İlk render karesi = sahne gerçekten hazır; kim olursan
  // ol maske burada kalkar.
  if (!bootRemoved) { bootRemoved = true; document.getElementById('boot')?.remove() }
  // SEKME ARKA PLANDA OYUN AKAR (Oğuz, 17 Ağu — "dümdüz devam etsin"): rAF arka planda
  // durur; Web Worker zamanlayıcısı (aşağıda, döngü başlatma noktasında) frame()'i
  // ~250 ms'de bir çağırıp simülasyonu GERÇEK ZAMANDA sürdürür. Görsel render arka planda
  // atlanır (GPU boşa çalışmasın); dt tavanı arka planda 0.34 ki 4 fps worker temposu
  // gerçek zamanı yakalasın. Ön planda 0.05 tavan aynen korunur (görsel stabilite).
  // Bilgi kartı seçili yapıya TUTUNUR (#1020) — yalnız görünürken, arka planda anlamsız.
  if (!document.hidden && selectedBuilding && ui.buildingCardVisible) {
    ui.setCardAnchor(binaEkranNoktasi(selectedBuilding))
  }
  const dt = Math.min(clock.getDelta(), document.hidden ? 0.34 : 0.05)
  promoTick?.(dt)
  if (exploding) { if (!document.hidden) renderFrame(); return }

  dayTime += dt
  const nightNow = nightFactor((dayTime % DAY_CYCLE) / DAY_CYCLE)
  world.setNight(nightNow)
  // GÜNEŞ EĞRİSİ (Oğuz: "gece üretimi 0'a düşebilir"): paneller karanlıkla ters orantılı
  // üretir — gece 0, şafak/akşam rampa. Batarya deposu artık gerçek değer kazanır.
  state.sunFactor = 1 - nightNow

  // GÜN İÇİ SAAT (HUD): döngü kesri → 24 saat; gün 06:00'da başlar (kredi taksidi
  // gün başında kesildiğinden oyuncular saati görmek istiyor). Metin değişince yazılır.
  {
    const frac = (dayTime % DAY_CYCLE) / DAY_CYCLE
    const hTot = (6 + frac * 24) % 24
    state.hourOfDay = hTot   // YOĞUN SAAT (Faz 2.2) bu değeri okuyor
    const str = `${String(Math.floor(hTot)).padStart(2, '0')}:${String(Math.floor((hTot % 1) * 60)).padStart(2, '0')}`
    if (str !== lastClockStr) { lastClockStr = str; const el = document.getElementById('hud-clock'); if (el) el.textContent = str }
  }
  // promo geri sayımı (14 feedback'in isteği): müşteri patlaması VE yakıt indirimi —
  // aktifken sağ üstte kalan saniye, kaybolmayan sabit rozet (oyuncu kampanyayı kaçırmaz).
  {
    const rt = document.getElementById('rushtimer') as HTMLDivElement | null
    if (rt) {
      const left = state.promo ? Math.max(0, Math.ceil((state.promo.until - Date.now()) / 1000)) : 0
      if (left > 0 && state.promo) {
        if (rt.style.display !== 'flex') { rt.style.display = 'flex'; audio.promo() } // rozet açılırken özgün jingle
        const lbl = document.getElementById('rushlabel')
        const want = state.promo.type === 'rush' ? t('MÜŞTERİ PATLAMASI') : t('YAKIT İNDİRİMİ %50')
        if (lbl && lbl.textContent !== want) lbl.textContent = want
        const sec = document.getElementById('rushsec')
        if (sec && sec.textContent !== String(left)) sec.textContent = String(left)
      } else if (rt.style.display !== 'none') rt.style.display = 'none'
    }
    // YOĞUN SAAT rozeti (Faz 2.2) — promo rozeti açıkken gizlenir, aynı köşeyi paylaşırlar
    const rh = document.getElementById('rushhour') as HTMLDivElement | null
    if (rh) {
      const goster = state.rushHour && (!rt || rt.style.display === 'none')
      const want = goster ? 'flex' : 'none'
      if (rh.style.display !== want) rh.style.display = want
    }
    // SERİ rozeti (Faz 3.2) — çarpan 1'in üstündeyken görünür
    const cb = document.getElementById('combobadge') as HTMLDivElement | null
    if (cb) {
      const mult = state.comboMult()
      const want = mult > 1 ? 'flex' : 'none'
      if (cb.style.display !== want) cb.style.display = want
      if (mult > 1) {
        const el = document.getElementById('combomult')
        const txt = `×${mult.toFixed(2)}`
        if (el && el.textContent !== txt) el.textContent = txt
      }
    }
  }

  if (guestPaused) {
    // Oyun DONUK ama YOL CANLI: transit trafiği akar (entryChance=0 → kimse istasyona
    // girmez, ilerleme/ekonomi işlemez). Eskiden cars.update hiç çağrılmıyordu — gate
    // arkasında ve gate'i yeni geçen misafirde yol BOMBOŞTU ("araçları göremiyorum").
    cars.update(dt)
    if (!document.hidden) renderFrame()
    return
  }
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
    state.smrWreck = true // ENKAZ kalır (Oğuz) — radyoaktif temizlik ödenene dek yeni reaktör yok
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
    if (!auth.loggedIn()) {
      auth.saveGuest(savePayload()); maybeGuestGate() // misafir: gün başı kaydet + gün-5 eşiği (boştayken de)
      // dönüşüm teşviki: gün 3-4 sonunda somut kayıp uyarısı (gün 5 zaten zorunlu gate)
      if (state.day >= 3 && state.day < GUEST_MAX_DAY) {
        ui.toast(t('{0} günlük ilerlemen sadece bu cihazda! Kaydol: buluta taşınır + ₺2.500 bonus + günlük seri bonusu.', state.day - 1), 'bad', true)
      }
    }
    // NOT: gider defteri (state.dayCosts) burada SIFIRLANMAZ — gün İÇİNDE ödenen
    // kalemler de (ör. ihale cayma bedeli) o günün raporunda görünsün diye defter
    // rapor yazıldıktan SONRA temizlenir (aşağıda, dayStartMoney ile birlikte).
    // `brut` = gün İÇİNDE (işletmeden) kazanılan; gün-sonu giderleri henüz düşülmedi.
    // Banka ortağının payı ve reklam bütçesi tarihsel olarak bu sayıya bakar — denge
    // değişmesin diye onlara BRÜT verilmeye devam ediyor. Oyuncuya gösterilen rapor
    // ise aşağıda NET (gerçek kasa değişimi) üzerinden yazılır.
    const brut = Math.round(state.money - state.dayStartMoney)
    // KAÇIRDIKLARIN (Faz 3.3): kaybı gün sonunda TEK acı sayıya topla — kâr raporunun
    // hemen ardından gelir, ertesi güne motivasyon üretir. Kayıp yoksa hiç gösterilmez
    // (mükemmel günü cezalandırmaz, tersine sessizliğiyle ödüllendirir).
    if (state.dayLostCount > 0) {
      ui.toast(t('Kaçırdığın müşteri: {0} → ₺{1}', state.dayLostCount, Math.round(state.dayLostMoney).toLocaleString('tr-TR')), 'bad')
    }
    state.dayLostCount = 0
    state.dayLostMoney = 0
    state.adSeriUsed = 0      // ödüllü reklam hakları her gün tazelenir
    state.adVipUsed = 0
    state.adYakitUsed = 0
    state.adTamirUsed = 0
    // B6 (analiz): İLK GÜN raporu = duygusal kontrol noktası — misafire kayıp-anı
    // hatırlatması (oturumda tek gate: 10k gate'i zaten çıktıysa tekrarlama)
    if (!auth.loggedIn() && state.day === 2 && brut > 0 && !firstTenGateShown && !guestGateShown) {
      firstTenGateShown = true
      showAuthGate(t('İlk günün kapandı: ₺{0} kâr! Bu ilerleme sadece bu cihazda — kaydol: buluta taşınır, üstüne ₺2.500 bonus.', brut.toLocaleString('tr-TR')))
    }
    // günlük yovmiye (pompacı + şarjcı) — recurring gider
    // spend(): kasa eksiye inmez ve kalem gider defterine yazılır. Muhasebe (wagesPaid,
    // wageLog) artık GERÇEKTEN ödenen tutarı işler — kasa yetmezse eksik ödeme yazılıyordu.
    const wages = state.spend(t('Yovmiye'), state.dailyWages())
    if (wages > 0) { state.wagesPaid += wages; state.wageLog.push({ day: state.day, amount: wages }); if (state.wageLog.length > 40) state.wageLog.shift() }
    // B2B sözleşme günü: taahhüt kapanışı, gelir/ceza, tamamlama primi
    const cres = state.processContractDay()
    if (cres.kind === 'ok') ui.toast(t('{0}: günlük taahhüt teslim edildi (+₺{1})', cres.name, cres.amount.toLocaleString('tr-TR')), 'good', true)
    else if (cres.kind === 'miss') ui.toast(t('{0}: taahhüt EKSİK teslim — ceza uygulandı ({1}₺)', cres.name, cres.amount.toLocaleString('tr-TR')), 'bad', true)
    else if (cres.kind === 'done') ui.toast(t('{0} sözleşmesi TAMAMLANDI! Prim: +₺{1} · itibar +0.3', cres.name, cres.amount.toLocaleString('tr-TR')), 'good', true)
    else if (cres.kind === 'fail') ui.toast(t('{0} sözleşmesi ihlalden feshedildi — prim yok.', cres.name), 'bad', true)
    // panel açıkken gün döndüyse tazele: teklif id'leri güne bağlı, eski butonlar ölü kalırdı
    if (document.getElementById('officewrap')?.classList.contains('show')) openOfficePanel()
    // Harita da güne bağlı: tedarik kotası gün dönüşünde sıfırlanır, bedeller/netler değişir
    if (haritaAcikMi()) haritaCiz()
    // SİSTEM ÖN-UYARILARI: ruhsat/denetim ve ihale cezası ilk kez devreye girmeden ÖNCE
    // tek cümleyle haber verilir (#453 #819 #1217 #1208). Gün dönümü doğru an: eşikler
    // güne bağlı ve toast gün sonu kalabalığında kaybolmaz (yapışkan → mesaj kutusunda).
    sistemOnUyarilari()
    // RUHSAT & DENETİM (Katman 2b): 30 günde bir, varlıkla ölçekli. Ödenmezse itibar cezası
    // — ritim + tehdit. Parası olan otomatik öder (mikro-yönetim yaratmaz).
    if (state.day >= state.licenseDueDay) {
      const fee = state.licenseFee()
      if (state.money >= fee) {
        state.spend(t('İşletme ruhsatı'), fee)
        state.licenseDueDay = state.day + 30
        ui.toast(t('İşletme ruhsatı yenilendi: -₺{0} (30 gün geçerli)', fee.toLocaleString('tr-TR')), '')
      } else {
        state.licenseDueDay = state.day + 3 // 3 günde bir tekrar dener
        state.addRep(-0.3)
        ui.toast(t('Ruhsat yenilenemedi (₺{0} gerekli) — denetim cezası: itibar düştü!', fee.toLocaleString('tr-TR')), 'bad', true)
      }
    }
    // İşletme gideri (OPEX): amortisman + emlak vergisi — geç oyunda birikimi düzleştiren sink.
    // 10 günlük rampayla devreye girer (enflasyon şoku yok); erken oyunda ~₺10, hissedilmez.
    const opex = state.dailyOpex()
    if (opex > 0) state.spend(t('İşletme gideri (bakım+vergi+kira)'), opex)
    // Reklam bütçesi tahsilatı: para yetmiyorsa o günün kampanyası kısılır (bütçe korunur)
    if (state.marketingBudget > 0) {
      const istenen = Math.min(state.marketingBudget, Math.max(0, Math.floor(state.money))) // floor: kesirli kasada eksiye taşma yok (reviewer bulgusu)
      const spend = state.spend(t('Reklam kampanyası'), istenen)
      if (spend < state.marketingBudget) ui.toast(t('Reklam bütçesine para yetmedi — kampanya bugün kısık.'), 'bad')
    }
    // ---- AI RAKİP (Katman 4d): günlük tepki ----
    const rivalMsg = state.rivalDayTurn()
    if (rivalMsg) ui.toast(rivalMsg, state.marketShare() < 0.45 ? 'bad' : '')
    // ---- MARİNA GÜN DÖNÜŞÜ (rapor §6.5): bağlama/kışlama geliri + risk olayı ----
    if (state.isMarina) {
      const mi = state.marinaDailyIncome()
      if (mi.total > 0) {
        state.money += mi.total
        ui.toast(mi.winter > 0
          ? t('Bağlama ₺{0} + kışlama ₺{1} tahsil edildi', mi.berth.toLocaleString('tr-TR'), mi.winter.toLocaleString('tr-TR'))
          : t('Bağlama geliri: +₺{0}', mi.berth.toLocaleString('tr-TR')), 'good')
        // ÜYELİK ayrı raporlanır: kışın bağlama düşerken bu gelirin AYAKTA kaldığını
        // görmek, yat kulübü yatırımının gerekçesini oyuncuya öğretir.
        if (mi.uyelik > 0) {
          ui.toast(t('Kulüp aidatı: {0} üye → +₺{1}', mi.uye, mi.uyelik.toLocaleString('tr-TR')), 'good')
        }
      }
      // ---- TERSANE: biten işler ödenir, yeni teklifler gelir ----
      const rf = state.processRefitDay()
      if (rf.biten > 0) {
        ui.toast(t('Tersane: {0} iş teslim edildi → +₺{1}', rf.biten, rf.kazanc.toLocaleString('tr-TR')), 'good', true)
        audio.achieve()
      }
      state.rollRefitOffers()
      if (state.refitOffers.length > 0) {
        ui.toast(t('Tersaneye {0} bakım işi geldi — Ofis › Marina\'dan kabul et ({1} kızak boş)',
          state.refitOffers.length, state.refitFree()), state.refitFree() > 0 ? '' : 'bad', true)
      }
      const ev = state.marinaDayEvent()
      if (ev) {
        // KRİTİK KURAL (§6.5.6): kalıcı silme YOK. Para/itibar ağır olabilir ama telafi edilir.
        if (ev.money) state.money = Math.max(0, state.money + ev.money)
        if (ev.rep) state.addRep(ev.rep)
        if (ev.money < 0 || ev.rep < 0) state.marinaViolations++
        ui.toast(ev.msg, ev.money < 0 || ev.rep < 0 ? 'bad' : '')
        const bf = state.blueFlag()
        if (!bf.ok && state.marinaViolations === 3) {
          ui.toast(t('Mavi Bayrak askıya alındı — sicilini temizleyince geri alırsın.'), 'bad')
        }
      } else if (state.marinaViolations > 0 && state.day % 15 === 0) {
        // sicil zamanla temizlenir: ceza kalıcı değil (raporun telafi ilkesi)
        state.marinaViolations--
        if (state.marinaViolations < 3 && state.blueFlag().ok) {
          ui.toast(t('Sicilin temizlendi — Mavi Bayrak geri alındı!'), 'good')
        }
      }
    }
    // ---- ŞUBE MÜDÜRLERİ (Oğuz 17 Ağu: "kasa tek olsun"): pasif şubelerin günlük net
    // geliri artık DOĞRUDAN ortak kasaya akar — toplama ritüeli yok, şube AFK kalmaz.
    // Eski şube-kasası bakiyeleri ilk gün dönüşünde otomatik devredilir (tek seferlik göç).
    {
      const legacyVault = state.collectBranchVaults()
      if (legacyVault > 0) ui.toast(t('Şube kasalarındaki birikim ortak kasaya aktarıldı: +₺{0}', legacyVault.toLocaleString('tr-TR')), 'good')
    }
    const vaults = state.accrueBranchVaults()
    if (vaults.length) {
      const added = vaults.reduce((a, v) => a + v.added, 0)
      if (added > 0) {
        ui.toast(t('Şube müdürlerinden kasaya +₺{0}', added.toLocaleString('tr-TR')), 'good')
      }
      // PAYLAŞILAN HAT SONUCU: kardeş şube yakıtsız kaldıysa oyuncu SEBEBİNİ görmeli —
      // yoksa "şubem neden az kazandı?" sessiz bir hayal kırıklığına dönüşür.
      const ac = vaults.filter(v => v.starved)
      if (ac.length) {
        ui.toast(t('{0}: ortak tedarik hattını dün sen tükettin — şube yakıtsız kaldı, günlük neti düştü.',
          ac.map(v => themeFor(v.loc).name).join(', ')), 'bad', true)
      }
    }
    // İTİBAR MUTABAKATI (#456): itibar günün hizmet kalitesine çekilir — 5.0'da donmaz
    const rep = state.reconcileReputation()
    if (Math.abs(rep.delta) >= 0.03) {
      ui.toast(rep.delta > 0
        ? t('İtibar yükseldi: {0} (bekleyen müşteri kaybın az)', state.reputation.toFixed(2))
        : t('İtibar düştü: {0} — müşteriler beklemekten gidiyor!', state.reputation.toFixed(2)),
        rep.delta > 0 ? 'good' : 'bad')
    }
    // kredi taksiti (aylık = 1 oyun günü)
    const loanRes = state.processLoanDay()
    if (loanRes === 'done') ui.toast(t('Kredi tamamen ödendi — teminatların serbest!'), 'good')
    else if (loanRes === 'warn') {
      // #445: uyarı SOYUTTU ("tahsilat/haciz gelir"). Oyuncu neyi kaybedeceğini bilmeden
      // krediyi umursamıyor, sonra her şeyi kaybedince oyunu bırakıyordu. Artık uyarı
      // tam olarak NEYİN gideceğini ve YARIN olacağını söylüyor.
      const rehin = state.loan.collateral
      const deger = rehin.reduce((a, id) => a + state.collateralValue(id), 0)
      ui.toast(rehin.length
        ? t('SON UYARI: yarın da ödeyemezsen {0} HACZEDİLİR (₺{1}). Kasanda ₺{2} olmalı.',
            rehin.map(collateralLabel).join(', '), deger.toLocaleString('tr-TR'),
            state.loan.monthly.toLocaleString('tr-TR'))
        : t('SON UYARI: yarın da ödeyemezsen banka istasyona ORTAK olur — kârının bir kısmını alır. Kasanda ₺{0} olmalı.',
            state.loan.monthly.toLocaleString('tr-TR')), 'bad', true)
    }
    else if (loanRes === 'seize') {
      // HACİZ YALNIZ KREDİNİN ALINDIĞI ŞUBEDE (canlı kayıt kanıtı: cevreyolu'nda oynayan
      // hesaplarda pompalar/ofis dışında HER ŞEY silinmişti). Teminat id'leri şube bazlı
      // olduğu için başka şubedeyken haciz, oyuncunun hiç rehin vermediği binaları yıkıyordu.
      // Şube bilinmiyorsa (alan eklenmeden önce alınmış eski kredi) da HACZETME — ortaklığa
      // düş: banka alacağını kâr payından tahsil eder, hiçbir bina kaybolmaz.
      const ayniSube = state.loan.loc === state.activeLoc
      if (state.loan.collateral.length && ayniSube) seizeCollateral() // teminatlı → haciz
      else {
        if (state.loan.collateral.length) {
          ui.toast(t('Borç ödenemedi — teminatların BAŞKA şubede olduğu için haczedilmedi.'), 'bad', true)
        }
        state.startPartnership(); ui.toast(t('Borç ödenemedi — banka istasyona %{0} ORTAK oldu, kâr payından tahsil edilecek!', Math.round(PARTNER_SHARE * 100)), 'bad')
      }
    }
    // banka ortaklığı aktifse günlük kârdan payını al (BRÜT üzerinden — denge korunur)
    const pc = state.applyPartnerCut(brut)
    if (pc?.kind === 'ended') ui.toast(t('Banka payını tamamladı — ortaklık bitti, istasyon tamamen senin!'), 'good')
    if (document.getElementById('bankwrap')?.classList.contains('show')) renderBank()

    // ── GÜN RAPORU: ÖNCE GİDER DÖKÜMÜ, SONRA GERÇEK KÂR ──
    // #74 #330 #983 #1140 #1220 "kasadan para eriyor / geriye sayıyor": eski rapor
    // "Gün X bitti — kâr ₺Y" derken Y'yi giderlerden ÖNCE hesaplıyordu ve her gider
    // ayrı, uçucu bir toast'tı. Oyuncu ekranda ₺Y kâr görüp kasada ₺Y-Z buluyordu —
    // sayı tutmadığı için "para eriyor" demesi tamamen haklıydı. Artık:
    //   1) tek dökümde HANGİ kalem NE kadar (yapışkan → mesaj kutusunda kalır),
    //   2) raporlanan kâr = kasadaki GERÇEK değişim (net), uydurma sayı yok.
    const gider = state.dayCostTotal()
    if (gider > 0) {
      ui.toast(t('Gün gideri -₺{0} → {1}', gider.toLocaleString('tr-TR'),
        state.dayCosts.map(c => `${c.kind} ₺${c.amount.toLocaleString('tr-TR')}`).join(' · ')), 'bad', true)
    }
    const net = Math.round(state.money - state.dayStartMoney)
    ui.toast(t('Gün {0} bitti — {1}: ₺{2}', state.day - 1, net >= 0 ? t('kâr') : t('zarar'),
      Math.abs(net).toLocaleString('tr-TR')), net >= 0 ? 'good' : 'bad')

    // dönemsel muhasebe: biten günün satış cirosunu kaydet
    const dayRev = Math.max(0, Math.round(state.stats.revenue - state.dayStartRevenue))
    // ADDITIVE: kâr + yaka dağılımı da kaydedilir; eski kayıtlarda bu alanlar yok, okuyucu ?? ile karşılar
    // profit artık NET (giderler düşülmüş) — ofis grafiği de kasadaki gerçekle örtüşsün
    state.salesLog.push({ day: state.day, rev: dayRev, profit: net,
      near: Math.round(state.sideDaily.near), far: Math.round(state.sideDaily.far) })
    if (state.salesLog.length > 370) state.salesLog.shift()
    state.sideDaily = { near: 0, far: 0 }
    state.dayStartRevenue = state.stats.revenue
    state.dayStartMoney = state.money
    state.facDaily = {}
    state.dayCosts = []   // defter kapandı: yeni gün sıfırdan biriksin
    // gün sonu: policy interstitial'a izin veriyorsa forced reklam; vermiyorsa opt-in "günü 2x" fırsatı sun
    if (!isFullMode && !isPromoMode) {
      if (mayShowInterstitial(state.day, net >= 0)) interstitial('gun-sonu', { day: state.day, won: net >= 0 })
      else offerDoubleProfit(net)
    }
    persist()
  }
  prevCycleT = cycleT

  // başarımlar + otomatik kayıt
  achieveT -= dt
  if (achieveT <= 0) {
    achieveT = 2
    checkAchievements(state)
    updateFarHint()
    // Dönüşüm anı: misafir İLK ₺10.000 başarımını açtı — gurur zirvesinde kayıt kapısı.
    // (Kapatılabilir: "Misafir olarak devam et" görünür kalır; oturumda 1 kez.)
    if (!auth.loggedIn() && !firstTenGateShown && state.achievements.has('first-10k')) {
      firstTenGateShown = true
      showAuthGate(t('İlk ₺10.000’i kazandın! Bu ilerleme sadece bu cihazda — kaydol: buluta taşınır, üstüne ₺2.500 bonus + günlük seri bonusu.'))
    }
  }
  saveT -= dt
  if (saveT <= 0) {
    saveT = 5
    persist()
  }

  // bina uyarı etiketleri
  const warns = new Map<string, { text: string; maintId: string }>()
  state.brokenPumps.forEach(i => warns.set(`pump-${i}`, { text: t('ARIZA · TAMİR ₺800'), maintId: `fix-pump-${i}` }))
  state.brokenChargers.forEach(i => warns.set(`charger-${i}`, { text: t('ARIZA · TAMİR ₺1.000'), maintId: `fix-charger-${i}` }))
  if (state.hasSolar && state.solarDirt >= 0.6) warns.set('solar', { text: t('TEMİZLİK ₺300'), maintId: 'clean-solar' })
  if (state.hasSMR && state.smrWear >= 0.5) {
    warns.set('smr', { text: state.smrWear > 0.75 ? t('BAKIM ŞART ₺1.500') : 'BAKIM ₺1.500', maintId: 'maint-smr' })
  } else if (state.hasSMR && state.uranium <= 15 && !state.uraniumPending) {
    warns.set('smr', {
      text: state.uranium === 0 ? t('URANYUM BİTTİ · ₺2.500') : 'URANYUM AZ · ₺2.500',
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
      const bozukPompa = c.slotIndex   // finishSale slotu boşaltıyor → önce yakala
      ui.toast(t('Pompa arızalandı — dolum yarıda kaldı, tamir gerekli.'), 'bad')
      notifyIfHidden(t('Pompa arızalandı — tamir gerekli!'), 'ariza-pompa')
      finishSale(c)
      teklifUcretsizTamir('pump', bozukPompa)
      continue
    }
    if (state.tanks[c.nozzle] <= 0) {
      const bosYakit = c.nozzle        // finishSale tabancayı bırakıyor → önce yakala
      ui.toast(t('{0} tankı boş kaldı! Satış yarım kaldı — sipariş ver.', t(FUEL_LABEL[c.nozzle])), 'bad')
      finishSale(c)
      teklifAcilYakit(bosYakit)
      continue
    }
    // personel eğitimi hızlandırır, EKİPMAN YIPRANMASI yavaşlatır (Katman 2b)
    const amount = Math.min(FILL_RATE * state.pumpSpeedMult() * state.staffFillMult() * state.wearEfficiency() * dt, state.tanks[c.nozzle])
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

  // yağ değişimi körüğü: içeri giren araç görünmez olur (binada), işi bitince kapıdan çıkar
  for (const [c, d] of oilPending) {
    if (c.phase !== 'toPark' && c.phase !== 'parked') { // dışarıdan uğurlandı (taşıma/yıkım)
      c.group.visible = true
      c.ghostSolid = false
      oilBusy.delete(d.bayId); oilPending.delete(c)
      continue
    }
    if (c.phase === 'toPark') {
      d.t += dt
      if (d.t > 45) { // yolda sıkıştı → vazgeç: körük serbest, araç uğurlanır
        c.ghostSolid = false
        oilBusy.delete(d.bayId); oilPending.delete(c)
        cars.releaseCar(c)
      }
      continue
    }
    if (!d.started) { d.started = true; d.t = 0; c.group.visible = false }
    d.t += dt
    if (d.t > 5) {
      const m = Math.round(150 + Math.random() * 100)
      state.addPending(d.bayId, m, t('Yağ değişimi'))
      ui.toast(t('Yağ değişimi: +₺{0} kumbarada', m), 'good')
      state.addRep((d.score - 3.3) * 0.08)
      c.group.visible = true
      c.group.position.copy(d.exit) // kapı önünden yola koyulur (duvardan geçmesin)
      c.ghostSolid = false // dışarıda: duvar çarpışması normale döner
      c.showFeedback(emojiFor(d.score))
      oilBusy.delete(d.bayId); oilPending.delete(c)
      cars.releaseCar(c)
    }
  }

  world.update(dt)
  // trafik ışığı: görsel lamba + HUD sayacı (yalnız ışıklı şubelerde)
  if (state.theme().features?.trafficLight) {
    world.setTrafficLight(state.lightRed())
    const chip = document.getElementById('hud-light-chip')
    if (chip) chip.style.display = 'flex'
    const el = document.getElementById('hud-light')
    if (el) {
      const red = state.lightRed()
      el.style.display = 'flex'
      el.textContent = red ? t('KIRMIZI {0}s · akın!', state.lightRemaining()) : t('yeşil {0}s', state.lightRemaining())
      el.style.color = red ? 'var(--red)' : 'var(--green-dark)'
    }
  } else {
    const chip = document.getElementById('hud-light-chip')
    if (chip && chip.style.display !== 'none') chip.style.display = 'none' // ışıksız şubede gizli
  }
  if (rampFullT > 0) rampFullT -= dt
  // MÜDÜR TURU RAPORU: sessiz çalışmasın, oyuncu parasının nereye gittiğini görsün
  if (state.managerResult) {
    const mr = state.managerResult
    state.managerResult = null
    const parts: string[] = []
    if (mr.collected > 0) parts.push(t('kumbaralar +₺{0}', mr.collected.toLocaleString('tr-TR')))
    if (mr.cleaned) parts.push(t('paneller temizlendi'))
    if (mr.fixed > 0) parts.push(t('{0} arıza tamir edildi', mr.fixed))
    if (mr.ordered > 0) parts.push(t('{0} yakıt siparişi verildi', mr.ordered))
    if (parts.length) ui.toast(`${t('Müdür turu')}: ${parts.join(' · ')}`, 'good')
    persist()
  }
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
      c.cleanWindows() // #451: şarj görevlisi de camı siler (eskiden yalnız yakıt pompacısı silerdi)
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
      c.cleanWindows() // #451: pompacı HER araçta camı siler — tam hizmet, parası bunun için veriliyor
      tutDismiss() // pompacı devraldı → "hoşgeldin patron" ipucu takılı kalmasın
    }
  }
  tickEvCharging(dt)
  syncHoses()
  updateCamera()
  ui.update(state, dt)
  // ORTA OYUN REHBERİ: rozet + proaktif bildirim. Her karede değil 2 sn'de bir bakılır —
  // rehber() şube anlık görüntülerini gezdiği için ucuz değil, HUD için de o kadar taze
  // olması yeterli. (ui.ts'e dokunulmuyor: rozet buradan sürülüyor.)
  rehberT -= dt
  if (rehberT <= 0) { rehberT = 2; markaRozetiniTazele(); rehberNabiz() }
  if (trafficDbg) trafficDbg.update({
    zones: cars.graphRef.zones,
    snapshot: () => cars.graphRef.snapshot(),
    cars: cars.cars,
    evap: cars.evapStats,
    reserve: cars.graphRef.stats,
  }, dt)
  if (!document.hidden) renderFrame()
}
// §6.1 trafik hata ayıklama katmanı — YALNIZ ?traffic=1 ile kurulur (normal oyunda kod çalışmaz)
const trafficDbg = trafficDebugOn ? new TrafficDebug(world.scene) : null
mountNewsButtons()  // Ayarlar'a "Yenilikler" + "Bildirim Geçmişi" düğmeleri
// "NELER YENİ" DÖNEN OYUNCU İÇİNDİR. Ölçüm (öğretici oturumu, ekran görüntüsü): hiç
// oynamamış oyuncuya açılışta sürüm notları duvarı çıkıyor, ilk müşteri panelini VE
// öğreticinin ilk ipucunu kapatıyordu — "ne yapacağımı anlamadım" temasını doğrudan
// besleyen bir ilk izlenim. 1. günde ve öğretici sürerken ertelenir (okundu işareti de
// atılmaz, ilerleyen günlerde çıkar); oyuncu Ayarlar > Yenilikler'den her an açabilir.
if (state.day > 1 || tutBitti()) maybeShowNews()  // sürüm değiştiyse notları bir kez göster (#465)
scheduleFrame()
// ARKA PLAN SÜRÜCÜSÜ: worker zamanlayıcıları tarayıcı tarafından KISILMAZ (ana thread
// zamanlayıcılarının aksine). Sekme gizliyken frame()'i doğrudan çağırır — oyun akar.
try {
  const bgWorker = new Worker(URL.createObjectURL(new Blob(['setInterval(function(){postMessage(0)},250)'], { type: 'text/javascript' })))
  bgWorker.onmessage = () => { if (document.hidden) frame() }
} catch { /* worker kurulamazsa (CSP vb.): arka planda eski davranış (durur) */ }


// REKLAM MODU (?promo=1): oyun kendi reklamını oynar — tek pompadan nükleer çağa.
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
