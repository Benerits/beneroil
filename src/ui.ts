import { Car } from './cars'
import { t } from './i18n'
import { FuelType, FUELS, FUEL_LABEL, GameState, getShopItems, getMaintenanceItems, dailyQuests, SUPPLIERS } from './state'
import { audio } from './audio'
import * as auth from './auth'
import { isNativePlatform } from './platform'

function el<T extends HTMLElement>(id: string): T {
  return document.getElementById(id) as T
}

/** UI'da emoji yok — metinlerden ayıkla (tasarım dili: ui-signage-design) */
function stripEmoji(s: string): string {
  return s.replace(/\p{Extended_Pictographic}/gu, '').replace(/️/g, '').replace(/\s{2,}/g, ' ').trim()
}

function icon(id: string, cls = 'ic'): string {
  return `<svg class="${cls}"><use href="#${id}"/></svg>`
}

export interface BuildingCard {
  icon: string // svg symbol id (i-...)
  name: string
  desc: string
  stats: [string, string, ('' | 'good' | 'bad')?][]
  action?: { label: string; maintId: string }
  move?: { label: string; id: string }
  /** binayı sat/yık (%iade) */
  sell?: { label: string; id: string }
  /** karttan doğrudan yükseltme/satın alma */
  buy?: { label: string; id: string }
  /** ofis kartı: yakıt satış fiyatı kontrolleri */
  priceRows?: { f: FuelType | 'elec'; label: string; price: number; cost: number | string; canDown: boolean; canUp: boolean }[]
}

/** ikon kutusu renkleri — her kalem kendi kimliğinde */
const ICON_COLORS: Record<string, string> = {
  land: '#27a05a', pave: '#7a8290', pump: '#d64545', sign: '#2f6fed', tank: '#5a6b7c',
  'tankadd-benzin': '#27a05a', 'tankadd-dizel': '#e8862e', 'tankadd-lpg': '#2f6fed',
  airwater: '#1fa8bc', parking: '#2f6fed', market: '#e8862e', toilet: '#2f6fed', wash: '#2f9fd6',
  selfwash: '#1fa8bc', oil: '#b08a3f', coffee: '#8a5a3c', restaurant: '#c9484f', truckpark: '#5a6b7c',
  grid: '#e0a121', battery: '#27a05a', evcharger: '#1fa8bc', solar: '#e8862e', dieselgen: '#b08a3f', smr: '#d64545',
  'clean-solar': '#2f9fd6', 'maint-smr': '#d64545', 'order-uranium': '#27a05a',
}

/** Koyu temada kart zemini koyulaşınca bu tonlar 3:1 grafik kontrastının ALTINA düşüyordu
 *  (gri tank/otopark, kahve, koyu mavi tabela/otopark/WC, koyu kırmızı lokanta).
 *  Yalnız bunlar açılır; kalan tonlar iki temada da geçiyor, kimlik bozulmasın diye elleşilmedi. */
const ICON_COLORS_DARK: Record<string, string> = {
  tank: '#8f9dad', truckpark: '#8f9dad', coffee: '#b5804f', restaurant: '#e0686d',
  sign: '#5b8ef5', parking: '#5b8ef5', toilet: '#5b8ef5',
}

/** Şu an koyu tema mı? Üç durum: attribute varsa o kazanır, yoksa sistem tercihi. */
function darkNow(): boolean {
  const attr = document.documentElement.getAttribute('data-theme')
  if (attr === 'dark') return true
  if (attr === 'light') return false
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false
}

function sicon(id: string, symbol: string): string {
  const base = ICON_COLORS[id] ?? (id.startsWith('fix-') ? '#d64545' : '#7a8290')
  const c = (darkNow() && ICON_COLORS_DARK[id]) || base
  return `<div class="sicon" style="color:${c};background:${c}1c;border-color:${c}44">${icon(symbol)}</div>`
}

/* ═══ TEMA (KARANLIK MOD) ═══
   Üç durum: 'system' (varsayılan) · 'light' · 'dark'.
   'system'de attribute YAZILMAZ — böylece telefon gece moduna geçtiğinde oyun,
   JS'e hiç dokunmadan, CSS'in prefers-color-scheme kuralıyla anında takip eder. */
export type ThemeMode = 'system' | 'light' | 'dark'
const THEME_KEY = 'benzinlik-theme'

export function getTheme(): ThemeMode {
  try {
    const v = localStorage.getItem(THEME_KEY)
    if (v === 'light' || v === 'dark' || v === 'system') return v
  } catch { /* gizli sekme: depolama kapalı → sistem tercihi */ }
  return 'system'
}

export function applyTheme(m: ThemeMode) {
  const root = document.documentElement
  if (m === 'system') root.removeAttribute('data-theme')
  else root.setAttribute('data-theme', m)
}

export function setTheme(m: ThemeMode) {
  applyTheme(m)
  try { localStorage.setItem(THEME_KEY, m) } catch { /* kalıcılık yoksa oturumluk çalışsın */ }
  // seçili düğme kırmızı (birincil) — hangi durumda olduğun tek bakışta görünsün
  for (const b of document.querySelectorAll<HTMLButtonElement>('[data-theme-opt]')) {
    b.classList.toggle('primary', b.dataset.themeOpt === m)
  }
}

/** yerleştirilebilirlerin kapladığı kare boyutu (görsel bilgi) */
const DIMS: Record<string, (s: GameState) => string> = {
  market: s => (s.marketLevel === 0 ? '5×6' : '6×8'),
  toilet: () => '3×4',
  battery: () => '3×2',
  solar: () => '5×7',
  dieselgen: () => '2×2',
  smr: () => '6×5',
  wash: () => '5×5',
  oil: () => '4×4',
  coffee: () => '3×3',
  restaurant: () => '6×6',
  truckpark: () => '8×6',
  airwater: () => '2×2',
  parking: () => '5×3',
  land: () => '12×14+',
}

/** inşaat sekmeleri — TAM eşleme (Oğuz: eşlenmeyen satır hiçbir sekmede görünmüyordu;
 *  marina kataloğunun tamamı + widegate/lamp/manager vb. görünmezdi) */
const CATEGORY_MAP: Record<string, string> = {
  land: 'arsa', pave: 'arsa', winterslot: 'arsa',
  pump: 'istasyon', sign: 'istasyon', tank: 'istasyon', airwater: 'istasyon', parking: 'istasyon',
  'tankadd-benzin': 'istasyon', 'tankadd-dizel': 'istasyon', 'tankadd-lpg': 'istasyon',
  // manager 'ofis': İNŞAAT sekmelerinde GÖRÜNMEZ (Oğuz: müdür Ofis'ten tutulur) —
  // satır getShopItems'ta kalır çünkü buyItem fiyat/kilit bilgisini oradan okur
  widegate: 'istasyon', lamp: 'istasyon', manager: 'ofis', train: 'istasyon',
  insurance: 'istasyon', renew: 'istasyon', fueldock: 'istasyon',
  // GENEL KONTROLÜN İLK AVI (ruzgar-check §9): bu üçü sekme sisteminden beri HİÇBİR
  // kategoride değildi — yani mağazadan satın alınamıyordu (git log -S doğruladı:
  // haritaya hiç eklenmemişler). pumpspeed çekirdek ilerleme kalemi; otel en büyük
  // pasif tesis; temizlikçi bakım otomasyonu. Kümeler: eğitim/sigorta gibi işletme
  // kalemleri 'istasyon'da, o yüzden pumpspeed+cleaner oraya; hotel 'tesis'e.
  pumpspeed: 'istasyon', cleaner: 'istasyon',
  market: 'tesis', market2: 'tesis', toilet: 'tesis', wash: 'tesis', selfwash: 'tesis', oil: 'tesis',
  coffee: 'tesis', restaurant: 'tesis', truckpark: 'tesis', decor: 'tesis', hotel: 'tesis',
  // KARŞI YAKA NÜSHALARI (görünmezlik fixi): CATEGORY_MAP'te olmayan id hiçbir sekmeye
  // düşmüyor ve İnşaat'ta HİÇ listelenmiyordu — market2 eklenmiş, kardeşleri unutulmuştu
  toilet2: 'tesis', wash2: 'tesis', oil2: 'tesis', coffee2: 'tesis', restaurant2: 'tesis', truckpark2: 'tesis',
  chandlery: 'tesis', shower: 'tesis', clubhouse: 'tesis', icebait: 'tesis',
  travelift: 'tesis', pumpout: 'tesis', wasteoil: 'tesis', boom: 'tesis',
  grid: 'enerji', battery: 'enerji', evcharger: 'enerji', solar: 'enerji', dieselgen: 'enerji', smr: 'enerji',
  // DİKKAT: yeni mağaza satırı eklerken buraya kategori YAZMAYI UNUTMA — yoksa satır
  // hiçbir sekmede görünmez (rüzgâr türbini böyle görünmez kaldı: state'te satır vardı,
  // İnşaat sekmesinde yoktu). ruzgar-check'teki genel kontrol artık bunu yakalıyor.
  wind: 'enerji',
}
/** berth_* gibi önekli satırlar dahil kategori çözümü */
const catOf = (id: string): string | undefined =>
  CATEGORY_MAP[id] ?? (id.startsWith('berth_') ? 'arsa' : undefined)

export class UI {
  activeCar: Car | null = null

  onNozzle: (car: Car, type: FuelType) => void = () => {}
  onStart: (car: Car, amount: number) => void = () => {}
  onStartFull: (car: Car) => void = () => {}
  onChargeEV: (car: Car) => void = () => {}
  onDismiss: (car: Car) => void = () => {}
  onCleanWindows: (car: Car) => void = () => {}
  onOrderFuel: (f: FuelType) => void = () => {}
  onOrderQty: (f: FuelType, d: number) => void = () => {}
  onOrderLiters: (f: FuelType, liters: number) => void = () => {}
  onBuy: (id: string) => void = () => {}
  onMaint: (id: string) => void = () => {}
  onCardClose: () => void = () => {}
  onMove: (id: string) => void = () => {}
  /** DÖNDÜR (6 şikayet: #918 "hangi harfle döndürülüyor", #1142 "döndürme özelliği güzel
   *  olur" — özellik VARDI ama yalnız taşıma modunda R ile, kimse bulamıyordu). */
  onRotate: (id: string) => void = () => {}
  onReset: () => void = () => {}
  onToggleClosed: () => void = () => {}
  onPriceChange: (f: FuelType | 'elec', delta: number) => void = () => {}
  private lastHudKey = ''
  /** sorun bildirimine iliştirilecek oyun bağlamı (main doldurur) */
  feedbackContext: () => Record<string, unknown> = () => ({})
  private setText(e: HTMLElement, v: string) { if (e.textContent !== v) e.textContent = v }
  private setHtml(e: HTMLElement, v: string) {
    if ((e as HTMLElement & { __h?: string }).__h !== v) {
      (e as HTMLElement & { __h?: string }).__h = v
      e.innerHTML = v
    }
  }
  private setDisp(e: HTMLElement, v: string) { if (e.style.display !== v) e.style.display = v }
  onLogin: (email: string, pass: string) => void = () => {}
  onRegister: (email: string, pass: string) => void = () => {}
  onLogout: () => void = () => {}
  batteryKwh: () => number = () => 0
  /** bu aracın pompasında/şarjında pompacı/şarjcı var mı (cam-sil butonunu gizlemek için) */
  attendantAt: (car: Car) => boolean = () => false
  /** canlı tanker durumu satırları (main bağlar) */
  tankerStatus: () => string[] = () => []
  /** gerçek 3D modelin PNG render'ı (main bağlar) */
  getThumb: (id: string) => string | null = () => null

  private money = el<HTMLSpanElement>('money')
  private day = el<HTMLSpanElement>('day')

  private battChip = el<HTMLDivElement>('battchip')
  private battFill = el<HTMLDivElement>('battfill')
  private battKwh = el<HTMLSpanElement>('battkwh')
  private rep = el<HTMLSpanElement>('rep')
  private orderBtn = el<HTMLButtonElement>('orderbtn')
  private orderLabel = el<HTMLSpanElement>('orderlabel')
  private shopBtn = el<HTMLButtonElement>('shopbtn')
  private shopLabel = el<HTMLSpanElement>('shoplabel')
  private closeBtn = el<HTMLButtonElement>('closebtn')
  private closeLabel = el<HTMLSpanElement>('closelabel')
  private shopWrap = el<HTMLDivElement>('shopwrap')
  private shopList = el<HTMLDivElement>('shoplist')
  private maintBadge = el<HTMLSpanElement>('maintbadge')
  private panel = el<HTMLDivElement>('panel')
  private demand = el<HTMLHeadingElement>('demand')
  private fuelCtl = el<HTMLDivElement>('fuelctl')
  private evCtl = el<HTMLDivElement>('evctl')
  private evNote = el<HTMLDivElement>('evnote')
  private chargeBtn = el<HTMLButtonElement>('chargebtn')
  private progress = el<HTMLDivElement>('liters')
  private amount = el<HTMLInputElement>('amount')
  private startBtn = el<HTMLButtonElement>('startbtn')
  private nozBenzin = el<HTMLButtonElement>('noz-benzin')
  private nozDizel = el<HTMLButtonElement>('noz-dizel')
  private nozLpg = el<HTMLButtonElement>('noz-lpg')
  private infoCard = el<HTMLDivElement>('infocard')
  private infoAction = el<HTMLButtonElement>('binfo-action')
  private infoMove = el<HTMLButtonElement>('binfo-move')
  private infoRot = el<HTMLButtonElement>('binfo-rot')
  private infoSell = el<HTMLButtonElement>('binfo-sell')
  private currentAction: string | null = null
  private currentMove: string | null = null
  private currentRot: string | null = null
  private currentBuy: string | null = null
  private currentSell: string | null = null
  onSell: (id: string) => void = () => {}

  private shopOpen = false
  private shopRenderT = 0
  private shopCat = 'istasyon'

  constructor() {
    // TEST KANCASI: tools/tests/toast-check.mjs bildirim davranışını (yığılma tavanı,
    // "×N" birleştirme, tıklayınca kapanma) GERÇEK sayfada doğrulayabilsin diye tek bir
    // fonksiyon açıyoruz. Oyun durumuna erişimi yok → anti-cheat açısından nötr.
    ;(window as unknown as { __toast?: unknown }).__toast =
      (m: string, k: 'good' | 'bad' | '' = '', s = true, o = false) => this.toast(m, k, s, o)
    const fuelWrap = el<HTMLDivElement>('fuelwrap')
    this.orderBtn.addEventListener('click', () => { fuelWrap.classList.add('show'); this.defterT = 0 })
    fuelWrap.addEventListener('pointerdown', e => { if (e.target === fuelWrap) fuelWrap.classList.remove('show') })
    for (const f of FUELS) {
      el<HTMLButtonElement>(`fbtn-${f}`).addEventListener('click', () => this.onOrderFuel(f))
    }
    // sipariş miktarı −/+ (ORDER_STEP=200L kademe → full)
    fuelWrap.addEventListener('click', e => {
      const b = (e.target as HTMLElement).closest('button.forder') as HTMLButtonElement | null
      if (b) this.onOrderQty(b.dataset.f as FuelType, b.dataset.d === 'max' ? 9999 : Number(b.dataset.d))
    })
    // elle litre girişi (B4): yazınca 200L partiye yuvarlanır; odaktayken sync ezmez
    for (const f of FUELS) {
      const inp = el<HTMLInputElement>(`fqty-${f}`)
      inp.addEventListener('change', () => this.onOrderLiters(f, Number(inp.value) || 0))
      inp.addEventListener('keydown', e => { if (e.key === 'Enter') inp.blur() })
    }
    this.closeBtn.addEventListener('click', () => this.onToggleClosed())
    const accWrap = el<HTMLDivElement>('accwrap')
    el<HTMLButtonElement>('accbtn').addEventListener('click', () => accWrap.classList.add('show'))
    accWrap.addEventListener('pointerdown', e => { if (e.target === accWrap) accWrap.classList.remove('show') })
    el<HTMLButtonElement>('acclogout').addEventListener('click', () => this.onLogout())

    // modallar
    const setWrap = el<HTMLDivElement>('setwrap')
    el<HTMLButtonElement>('setbtn').addEventListener('click', () => setWrap.classList.add('show'))
    this.shopBtn.addEventListener('click', () => {
      this.shopOpen = true
      this.shopWrap.classList.add('show')
      this.shopRenderT = 0
    })
    for (const btn of document.querySelectorAll<HTMLButtonElement>('.mclose')) {
      btn.addEventListener('click', () => {
        el<HTMLDivElement>(btn.dataset.close!).classList.remove('show')
        if (btn.dataset.close === 'shopwrap') this.shopOpen = false
      })
    }
    for (const wrap of [this.shopWrap, setWrap]) {
      wrap.addEventListener('pointerdown', e => {
        if (e.target === wrap) {
          wrap.classList.remove('show')
          if (wrap === this.shopWrap) this.shopOpen = false
        }
      })
    }

    // sekmeler
    for (const tab of document.querySelectorAll<HTMLButtonElement>('#shoptabs .tab')) {
      tab.addEventListener('click', () => {
        this.shopCat = tab.dataset.cat!
        for (const t of document.querySelectorAll('#shoptabs .tab')) t.classList.toggle('active', t === tab)
        this.shopRenderT = 0
      })
    }

    // istasyon adı artık ayarlarda değil — TABELA kartından değiştirilir (rename-sign)
    const fbWrap = el<HTMLDivElement>('fbwrap')
    const fbBtn = el<HTMLButtonElement>('fbbtn')
    // Sorun Bildir yalnızca web'de; native app'te gizli (mobil UI temiz kalsın).
    if (isNativePlatform()) fbBtn.style.display = 'none'
    fbBtn.addEventListener('click', () => fbWrap.classList.add('show'))
    // ayarların içindeki Sorun Bildir: ayarları kapat, geri bildirim modalını aç (mobil/native dahil)
    el<HTMLButtonElement>('set-feedback')?.addEventListener('click', () => {
      el<HTMLDivElement>('setwrap').classList.remove('show')
      fbWrap.classList.add('show')
    })
    fbWrap.addEventListener('pointerdown', e => { if (e.target === fbWrap) fbWrap.classList.remove('show') })
    el<HTMLButtonElement>('fbsend').addEventListener('click', async () => {
      const ta = el<HTMLTextAreaElement>('fbtext')
      const msg = ta.value.trim()
      if (msg.length < 3) { this.toast('Mesaj çok kısa — biraz detay ver.', 'bad'); return }
      const btn = el<HTMLButtonElement>('fbsend')
      btn.disabled = true
      try {
        await auth.sendFeedback(msg, this.feedbackContext())
        ta.value = ''
        el<HTMLDivElement>('fbwrap').classList.remove('show')
        this.toast('Bildirimin alındı — teşekkürler, okuyoruz!', 'good')
      } catch (e) {
        this.toast((e as Error).message || t('Gönderilemedi, tekrar dene.'), 'bad')
      }
      btn.disabled = false
    })
    el<HTMLButtonElement>('resetbtn').addEventListener('click', () => {
      if (confirm(t('Tüm ilerleme silinecek. Emin misin?'))) this.onReset()
    })
    // App Store zorunluluğu: uygulama içinden hesap silme
    el<HTMLButtonElement>('delaccbtn')?.addEventListener('click', async () => {
      if (!confirm(t('Hesabın ve TÜM verilerin kalıcı olarak silinecek. Bu işlem geri alınamaz. Emin misin?'))) return
      try { await auth.deleteAccount(); location.href = '/' }
      catch (e) { this.toast((e as Error).message || t('Silinemedi, tekrar dene.'), 'bad') }
    })

    // KARANLIK MOD seçici (Sistem / Açık / Koyu). Ayarların gövdesi mobilde Profil
    // sheet'ine TAŞINIYOR (main.ts appendChild) ama ID/düğmeler korunduğu için bu
    // dinleyiciler taşındıktan sonra da çalışır.
    setTheme(getTheme())
    for (const b of document.querySelectorAll<HTMLButtonElement>('[data-theme-opt]')) {
      b.addEventListener('click', () => { setTheme(b.dataset.themeOpt as ThemeMode); this.shopRenderT = 0 })
    }
    // TEST KANCASI: tools/tests/tema-check.mjs üç durumu gerçek sayfada sürebilsin.
    ;(window as unknown as { __setTheme?: (m: string) => void }).__setTheme = m => setTheme(m as ThemeMode)

    // ses ayarları: müzik seviyeli slider + efekt aç/kapa
    const musicVol = el<HTMLInputElement>('musicvol')
    const musicVolVal = el<HTMLSpanElement>('musicvolval')
    const sfxBtn = el<HTMLButtonElement>('sfxbtn')
    const paintSlider = (pct: number) => {
      musicVol.style.background = `linear-gradient(90deg, var(--red) 0 ${pct}%, var(--paper-2) ${pct}% 100%)`
      musicVolVal.textContent = `%${pct}`
    }
    // EFEKT SEVİYESİ (Twitter isteği, 29 Ağu: "ses efektleri ses düzeyi kontrolü —
    // şu an yalnızca müzikte var"). Müzikle aynı davranış: 0 = kapalı.
    const sfxVol = el<HTMLInputElement>('sfxvol')
    const sfxVolVal = el<HTMLSpanElement>('sfxvolval')
    const paintSfx = (pct: number) => {
      sfxVol.style.background = `linear-gradient(90deg, var(--red) 0 ${pct}%, var(--paper-2) ${pct}% 100%)`
      sfxVolVal.textContent = `%${pct}`
    }
    const syncAudioLabels = () => {
      sfxBtn.textContent = audio.sfxOn ? t('Efektler: Açık') : t('Efektler: Kapalı')
      const p = Math.round((audio.sfxOn ? audio.sfxVolume : 0) * 100)
      sfxVol.value = String(p); paintSfx(p)
    }
    syncAudioLabels()
    const initPct = Math.round(audio.musicVolume * 100)
    musicVol.value = String(initPct); paintSlider(initPct)
    musicVol.addEventListener('input', () => { const p = Number(musicVol.value); audio.setMusicVolume(p / 100); paintSlider(p) })
    sfxVol.addEventListener('input', () => {
      const p = Number(sfxVol.value); audio.setSfxVolume(p / 100); paintSfx(p)
      sfxBtn.textContent = audio.sfxOn ? t('Efektler: Açık') : t('Efektler: Kapalı')
    })
    sfxBtn.addEventListener('click', () => { audio.toggleSfx(); syncAudioLabels() })
    const notifBtn = el<HTMLButtonElement>('notifbtn')
    const capLN = () => (window as unknown as { Capacitor?: { Plugins?: { LocalNotifications?: any } } }).Capacitor?.Plugins?.LocalNotifications
    const syncNotif = async () => {
      if (isNativePlatform() && capLN()) {
        let st = 'prompt'
        try { st = (await capLN().checkPermissions())?.display ?? 'prompt' } catch { /* yok say */ }
        notifBtn.textContent = st === 'granted' ? t('Bildirimler: Açık') : st === 'denied' ? t('Bildirimler: Engelli') : t('Bildirimlere İzin Ver')
        notifBtn.disabled = st === 'granted' || st === 'denied'
        return
      }
      const p = 'Notification' in window ? Notification.permission : 'unsupported'
      notifBtn.textContent = p === 'granted' ? t('Bildirimler: Açık') : p === 'denied' ? t('Bildirimler: Engelli') : t('Bildirimlere İzin Ver')
      notifBtn.disabled = p === 'granted' || p === 'denied' || p === 'unsupported'
    }
    syncNotif()
    notifBtn.addEventListener('click', async () => {
      if (isNativePlatform() && capLN()) { try { await capLN().requestPermissions() } catch { /* yok say */ } }
      else if ('Notification' in window) await Notification.requestPermission()
      syncNotif()
    })

    // hesap
    const accEmail = el<HTMLInputElement>('accemail')
    const accPass = el<HTMLInputElement>('accpass')
    el<HTMLButtonElement>('loginbtn').addEventListener('click', () => this.onLogin(accEmail.value, accPass.value))
    el<HTMLButtonElement>('registerbtn').addEventListener('click', () => this.onRegister(accEmail.value, accPass.value))
    el<HTMLButtonElement>('logoutbtn').addEventListener('click', () => this.onLogout())

    // servis paneli
    this.nozBenzin.addEventListener('click', () => this.pickNozzle('benzin'))
    this.nozDizel.addEventListener('click', () => this.pickNozzle('dizel'))
    this.nozLpg.addEventListener('click', () => this.pickNozzle('lpg'))
    for (const b of document.querySelectorAll<HTMLButtonElement>('.quick')) {
      b.addEventListener('click', () => {
        this.amount.value = b.dataset.amt ?? ''
        this.refreshPanel()
      })
    }
    this.amount.addEventListener('input', () => this.refreshPanel())
    this.startBtn.addEventListener('click', () => {
      const car = this.activeCar
      const amt = Math.floor(Number(this.amount.value))
      if (!car || !car.nozzle || !(amt > 0) || car.filling || car.filled > 0) return
      this.onStart(car, amt)
      this.selectCar(null) // kutucuk kapanır, sayaç aracın üzerinde akar
    })
    el<HTMLButtonElement>('fullbtn').addEventListener('click', () => {
      const car = this.activeCar
      if (!car || !car.nozzle || car.filling || car.filled > 0) return
      this.onStartFull(car)
      this.selectCar(null)
    })
    this.chargeBtn.addEventListener('click', () => {
      if (this.activeCar?.kind === 'ev') {
        const car = this.activeCar
        this.onChargeEV(car)
        if (car.charging) this.selectCar(null)
      }
    })
    el<HTMLButtonElement>('dismissbtn').addEventListener('click', () => {
      if (this.activeCar) this.onDismiss(this.activeCar)
    })
    el<HTMLButtonElement>('cleanbtn').addEventListener('click', () => {
      const car = this.activeCar
      if (!car || car.windowsCleaned) return
      this.onCleanWindows(car)
      this.refreshPanel()
    })

    // bina kartı
    el<HTMLButtonElement>('binfo-close').addEventListener('click', () => {
      this.hideBuildingCard()
      this.onCardClose()
    })
    this.infoAction.addEventListener('click', () => {
      if (this.currentAction) this.onMaint(this.currentAction)
    })
    this.infoSell.addEventListener('click', () => {
      if (this.currentSell) this.onSell(this.currentSell)
    })
    this.infoRot.addEventListener('click', () => {
      if (this.currentRot) this.onRotate(this.currentRot)
    })
    this.infoMove.addEventListener('click', () => {
      if (this.currentMove) this.onMove(this.currentMove)
    })
    el<HTMLButtonElement>('binfo-buy').addEventListener('click', () => {
      if (this.currentBuy) this.onBuy(this.currentBuy)
    })
    el<HTMLDivElement>('binfo-prices').addEventListener('click', e => {
      const btn = (e.target as HTMLElement).closest('button[data-pf]') as HTMLButtonElement | null
      if (btn) this.onPriceChange(btn.dataset.pf as FuelType | 'elec', Number(btn.dataset.pd))
    })

    // mağaza tıklamaları
    this.shopList.addEventListener('click', e => {
      const btn = (e.target as HTMLElement).closest('button[data-buy], button[data-maint]') as HTMLButtonElement | null
      if (!btn) return
      if (btn.dataset.buy) this.onBuy(btn.dataset.buy)
      if (btn.dataset.maint) this.onMaint(btn.dataset.maint)
      this.shopRenderT = 0
    })
  }

  private pickNozzle(type: FuelType) {
    if (!this.activeCar || this.activeCar.filled > 0 || this.activeCar.filling) return
    this.onNozzle(this.activeCar, type)
    this.refreshPanel()
  }

  closeShop() {
    this.shopOpen = false
    this.shopWrap.classList.remove('show')
  }

  selectCar(car: Car | null) {
    this.activeCar = car
    this.amount.value = ''
    this.refreshPanel()
  }

  refreshPanel() {
    const car = this.activeCar
    if (!car || car.phase !== 'atPump') {
      this.panel.classList.remove('show')
      return
    }
    this.panel.classList.add('show')
    // Hızlı tutar butonları TALEBE göre ölçeklenir: sabit 50-400 seti, segment müşterilerinin
    // (₺600-2500) taleplerini karşılamıyordu — oyuncu her seferinde elle yazıyordu.
    if (car.kind === 'fuel') {
      const d = car.demandAmount
      const set = d > 400
        ? [0.25, 0.5, 0.75, 1].flatMap(r => [Math.round(d * r / 10) * 10]).concat([Math.round(d * 1.1 / 10) * 10])
        : [50, 100, 150, 200, 250, 300, 350, 400]
      const btns = document.querySelectorAll<HTMLButtonElement>('.quick')
      btns.forEach((b, i) => {
        const v = set[Math.min(i, set.length - 1)]
        const show = i < set.length
        const disp = show ? '' : 'none'
        if (b.style.display !== disp) b.style.display = disp
        // KRİTİK (Oğuz: "makrolara tıklanmıyor"): refreshPanel HER FRAME çalışır;
        // textContent'i koşulsuz yazmak text node'u basılıyken değiştiriyordu —
        // mousedown/mouseup hedefleri kopunca tarayıcı click ÜRETMİYORDU.
        if (show && b.dataset.amt !== String(v)) { b.dataset.amt = String(v); b.textContent = String(v) }
      })
    }
    el<HTMLButtonElement>('dismissbtn').disabled = car.filling || car.filled > 0
    // camlar temizlenince VEYA bu pompa/şarjda pompacı/şarjcı varsa cam-sil butonu gizlenir (artık onun işi)
    el<HTMLDivElement>('cleanrow').style.display = (car.windowsCleaned || this.attendantAt(car)) ? 'none' : 'flex'

    if (car.kind === 'ev') {
      this.fuelCtl.style.display = 'none'
      this.evCtl.style.display = 'block'
      el<HTMLDivElement>('pumpdisp').style.display = 'none'
      this.setHtml(this.demand, `<span class="dlabel">${t('MÜŞTERİ İSTEĞİ')}</span>` +
        `<span class="fpill" style="background:#1fa8bc">${t('ELEKTRİK')}</span><span class="damt">${car.demandKwh} kWh</span>`)
      const have = this.batteryKwh()
      this.chargeBtn.disabled = car.charging || car.squatting
      this.setText(this.chargeBtn, car.squatting
        ? t('MOLADA — ünite işgal altında')
        : car.charging
          ? t('ŞARJ OLUYOR — {0}/{1} kWh', Math.floor(car.chargedKwh), car.demandKwh)
          : t('ŞARJ BAŞLAT ({0} kWh)', car.demandKwh))
      this.setText(this.evNote, car.squatting
        ? t('Şarj bitti ama müşteri tesislerde geziyor — MÜŞTERİYİ GÖNDER ile uğurla, yoksa yeni EV müşterileri kaçar!')
        : car.charging
          ? t('Depodan araca enerji akıyor... depo seviyesi akış hızını belirler.')
          : have < 1
            ? t('Bataryada enerji yok ({0} kWh) — dolmasını bekle.', Math.floor(have))
            : t('Depoda {0} kWh hazır — şarjı başlat.', Math.floor(have)))
      return
    }

    this.fuelCtl.style.display = 'block'
    this.evCtl.style.display = 'none'
    el<HTMLDivElement>('pumpdisp').style.display = 'flex'
    el<HTMLSpanElement>('pd-liters').textContent = car.filled.toFixed(1)
    el<HTMLSpanElement>('pd-total').textContent = Math.round(car.filledValue).toString()
    const fc = car.demandType === 'benzin' ? '#27a05a' : car.demandType === 'dizel' ? '#e8862e' : '#2f6fed'
    this.setHtml(this.demand, `<span class="dlabel">${t('MÜŞTERİ İSTEĞİ')}</span>` +
      `<span class="fpill" style="background:${fc}">${FUEL_LABEL[car.demandType]}</span>` +
      `<span class="damt">${car.wantsFull ? t('FULLE') : `₺${car.demandAmount}`}</span>`)
    this.nozBenzin.classList.toggle('sel', car.nozzle === 'benzin')
    this.nozDizel.classList.toggle('sel', car.nozzle === 'dizel')
    this.nozLpg.classList.toggle('sel', car.nozzle === 'lpg')
    const locked = car.filled > 0 || car.filling
    this.nozBenzin.disabled = locked
    this.nozDizel.disabled = locked
    this.nozLpg.disabled = locked
    this.amount.disabled = car.filling || car.wantsFull
    const amt = Math.floor(Number(this.amount.value))
    this.startBtn.disabled = !car.nozzle || !(amt > 0) || car.filling || car.filled > 0 || car.wantsFull
    // FULLE yalnızca gerçekten "full" isteyen müşteride (belirli tutar isteyeni FULLE'lemek anlamsız/exploit)
    el<HTMLButtonElement>('fullbtn').disabled = !car.nozzle || car.filling || car.filled > 0 || !car.wantsFull
    if (!car.filling && car.filled === 0)
      this.setText(this.progress, car.wantsFull
        ? t('Müşteri FULLE istiyor — tabancayı seç, FULLE bas')
        : t('Tabanca seç; tutar gir ya da FULLE'))
  }

  // ---- bina bilgi kartı ----

  showBuildingCard(card: BuildingCard) {
    el<HTMLDivElement>('binfo-icon').innerHTML = icon(card.icon)
    el<HTMLDivElement>('binfo-name').textContent = stripEmoji(card.name)
    el<HTMLDivElement>('binfo-desc').textContent = stripEmoji(card.desc)
    el<HTMLDivElement>('binfo-stats').innerHTML = card.stats.map(([k, v, cls]) =>
      `<div class="stat"><span class="k">${stripEmoji(k)}</span><span class="v ${cls ?? ''}">${stripEmoji(v)}</span></div>`).join('')
    el<HTMLDivElement>('binfo-prices').innerHTML = (card.priceRows ?? []).map(r =>
      `<div class="prow"><span class="pl">${t(r.label)}</span><span class="pc">${typeof r.cost === 'number' ? t('alış ₺{0}', String(r.cost)) : t(r.cost)}</span>` +
      `<button class="btn pbtn" data-pf="${r.f}" data-pd="-0.5" ${r.canDown ? '' : 'disabled'}>−</button>` +
      `<span class="pv">₺${r.price.toFixed(1)}</span>` +
      `<button class="btn pbtn" data-pf="${r.f}" data-pd="0.5" ${r.canUp ? '' : 'disabled'}>+</button></div>`).join('')
    if (card.action) {
      this.infoAction.style.display = 'flex'
      this.infoAction.textContent = stripEmoji(t(card.action.label))
      this.currentAction = card.action.maintId
    } else {
      this.infoAction.style.display = 'none'
      this.currentAction = null
    }
    if (card.move) {
      this.infoMove.style.display = 'flex'
      this.infoMove.textContent = stripEmoji(t(card.move.label))
      this.currentMove = card.move.id
      this.infoRot.style.display = 'flex'
      this.infoRot.textContent = t('Döndür')
      this.currentRot = card.move.id
    } else {
      this.infoMove.style.display = 'none'
      this.currentMove = null
      this.infoRot.style.display = 'none'
      this.currentRot = null
    }
    const buyBtn = el<HTMLButtonElement>('binfo-buy')
    if (card.buy) {
      buyBtn.style.display = 'flex'
      buyBtn.textContent = stripEmoji(t(card.buy.label))
      this.currentBuy = card.buy.id
    } else {
      buyBtn.style.display = 'none'
      this.currentBuy = null
    }
    if (card.sell) {
      this.infoSell.style.display = 'flex'
      this.infoSell.textContent = stripEmoji(t(card.sell.label))
      this.currentSell = card.sell.id
    } else {
      this.infoSell.style.display = 'none'
      this.currentSell = null
    }
    this.infoCard.classList.add('show')
    this.anchorInfoCard()
  }

  /** BİNANIN ÜSTÜNDE POPUP (#1020 "bir şeye tıkladığımızda sol altta çıkıyor, onu direkt
   *  onun üstünde popup olarak çıkarsak daha güzel olur"): kart artık seçilen yapının
   *  ekran konumuna tutunur. Mobilde CSS alt-sheet kuralları geçerli kalır (dar ekranda
   *  yüzen kart parmağın altında kalıyordu) — orada konumlandırma uygulanmaz. */
  private cardAnchor: { x: number; y: number } | null = null
  setCardAnchor(p: { x: number; y: number } | null) {
    this.cardAnchor = p
    if (this.buildingCardVisible) this.anchorInfoCard()
  }
  anchorInfoCard() {
    const c = this.infoCard
    const dar = window.matchMedia('(max-width: 820px)').matches
    if (dar || !this.cardAnchor) {                 // mobil: CSS'e bırak
      c.style.left = ''; c.style.top = ''; c.style.bottom = ''; c.style.transform = ''
      return
    }
    const k = c.getBoundingClientRect()
    const g = 14
    let x = this.cardAnchor.x - k.width / 2
    let y = this.cardAnchor.y - k.height - 18     // yapının ÜSTÜNDE
    if (y < g) y = Math.min(this.cardAnchor.y + 24, window.innerHeight - k.height - g)  // yer yoksa altına
    x = Math.max(g, Math.min(x, window.innerWidth - k.width - g))
    y = Math.max(g, Math.min(y, window.innerHeight - k.height - g))
    c.style.left = `${Math.round(x)}px`
    c.style.top = `${Math.round(y)}px`
    c.style.bottom = 'auto'
    c.style.transform = 'none'
  }

  private accountEmail: string | null = null

  /** hesap durumunu ayarlar panelinde göster */
  syncAccount(email: string | null) {
    this.accountEmail = email
    el<HTMLDivElement>('accstatus').textContent = email
      ? t('Giriş yapıldı: {0} — kaydın buluta senkronlanıyor.', email)
      : t('Giriş gerekli — oturum kapandı, sayfayı yenile.')
    el<HTMLInputElement>('accemail').style.display = email ? 'none' : 'block'
    el<HTMLInputElement>('accpass').style.display = email ? 'none' : 'block'
    el<HTMLButtonElement>('loginbtn').style.display = email ? 'none' : 'flex'
    el<HTMLButtonElement>('registerbtn').style.display = email ? 'none' : 'flex'
    el<HTMLButtonElement>('logoutbtn').style.display = email ? 'flex' : 'none'
  }

  hideBuildingCard() {
    this.infoCard.classList.remove('show')
    this.cardAnchor = null
    this.currentAction = null
    this.currentMove = null
    this.currentRot = null
    this.currentSell = null
  }

  get buildingCardVisible() {
    return this.infoCard.classList.contains('show')
  }

  // ---- mağaza ----

  /** İÇİ BOŞ SEKME GİZLENİR (Oğuz) — aktif sekme gizlendiyse ilk görünür sekmeye geç */
  private refreshShopTabs(state: GameState) {
    const have = new Set(getShopItems(state).map(r => catOf(r.id)).filter(Boolean) as string[])
    if (getMaintenanceItems(state).length > 0) have.add('bakim')
    const tabs = [...document.querySelectorAll<HTMLButtonElement>('#shoptabs .tab')]
    let activeHidden = false
    for (const tab of tabs) {
      const show = have.has(tab.dataset.cat!)
      tab.style.display = show ? '' : 'none'
      if (!show && tab.classList.contains('active')) activeHidden = true
    }
    if (activeHidden) {
      const first = tabs.find(tb => tb.style.display !== 'none')
      if (first) {
        this.shopCat = first.dataset.cat!
        for (const tb of tabs) tb.classList.toggle('active', tb === first)
      }
    }
  }

  private renderShop(state: GameState) {
    this.refreshShopTabs(state)
    if (this.shopCat === 'bakim') {
      const maint = getMaintenanceItems(state)
      this.shopList.innerHTML = maint.length === 0
        ? `<div class="sd" style="text-align:center; padding:18px 0">${t('Her şey yolunda')} — bakım gereken bir şey yok.</div>`
        : maint.map(r => {
          const cls = r.urgent ? 'shoprow urgent' : 'shoprow'
          const disabled = r.disabled || state.money < r.cost
          return `<div class="${cls}">
            ${sicon(r.id, r.icon)}
            <div class="sinfo"><div class="st">${stripEmoji(r.title)}</div></div>
            <button class="btn sbuy ${r.urgent ? 'danger' : ''}" data-maint="${r.id}" ${disabled ? 'disabled' : ''}>₺${r.cost.toLocaleString('tr-TR')}</button></div>`
        }).join('')
      return
    }
    const rows = getShopItems(state).filter(r => catOf(r.id) === this.shopCat)
    this.shopList.innerHTML = '<div class="shopgrid">' + rows.map(r => {
      const cls = r.status === 'maxed' ? 'card maxed' : r.status === 'locked' ? 'card locked' : 'card'
      let btn: string
      if (r.status === 'maxed') btn = `<button class="btn cbuy" disabled>${t('MAKS')}</button>`
      else if (r.status === 'locked') btn = `<button class="btn cbuy" disabled>${t('KİLİTLİ')}</button>`
      else {
        const afford = state.money >= (r.cost ?? 0)
        btn = `<button class="btn cbuy ${afford ? 'good' : ''}" data-buy="${r.id}" ${afford ? '' : 'disabled'}>₺${r.cost?.toLocaleString('tr-TR')}</button>`
      }
      const thumb = this.getThumb(r.id)
      const visual = thumb
        ? `<img src="${thumb}" alt="">`
        : `<span style="color:#7a8290">${icon(r.icon, 'ic cbig')}</span>`
      const lock = r.status === 'locked' ? `<div class="slock">${stripEmoji(r.note)}</div>` : ''
      const dims = DIMS[r.id] ? `<span class="stat-badge dim">${DIMS[r.id](state)}</span>` : ''
      return `<div class="${cls}">
        <div class="cthumb">${visual}</div>
        <div class="cname">${stripEmoji(r.title)}</div>
        <div class="cbadges"><span class="stat-badge">${stripEmoji(r.stat)}</span>${dims}</div>
        <div class="cdesc">${stripEmoji(r.desc)}</div>${lock}
        ${btn}</div>`
    }).join('') + '</div>'
  }

  /** ALIM DEFTERİ (Oğuz): sipariş modalında son yakıt alımları — gün, litre, tutar, ₺/L */
  private defterT = 0
  private renderFuelLog(state: GameState) {
    const list = el<HTMLDivElement>('fueldefter')
    const sum = el<HTMLDivElement>('fueldefter-sum')
    if (!list || !sum) return
    if (state.fuelLog.length === 0) {
      list.innerHTML = `<div class="sd" style="text-align:center; padding:8px 0">${t('Henüz yakıt alımı yok.')}</div>`
      sum.textContent = ''
      return
    }
    const NAME: Record<string, string> = { benzin: 'Benzin', dizel: 'Dizel', lpg: 'LPG' }
    const CLR: Record<string, string> = { benzin: 'var(--green)', dizel: 'var(--orange)', lpg: 'var(--blue)' }
    list.innerHTML = [...state.fuelLog].reverse().slice(0, 20).map(x =>
      `<div class="sd" style="display:flex; gap:8px; align-items:baseline; padding:2px 0">
        <span style="min-width:52px">${t('Gün {0}', String(x.day))}</span>
        <span style="min-width:52px; font-weight:800; color:${CLR[x.f]}">${NAME[x.f]}</span>
        <span style="min-width:64px; text-align:right">${Math.round(x.liters).toLocaleString('tr-TR')}L</span>
        <span style="flex:1; text-align:right">₺${x.cost.toLocaleString('tr-TR')}</span>
        <span style="min-width:58px; text-align:right; color:var(--muted)">₺${x.liters > 0 ? (x.cost / x.liters).toFixed(1) : '—'}/L</span>
      </div>`).join('')
    sum.textContent = t('Son 7 gün yakıt gideri: ₺{0}', state.fuelCostInPeriod(7).toLocaleString('tr-TR'))
  }

  update(state: GameState, dt: number) {
    // alım defteri: modal açıkken saniyede bir tazele (her frame DOM yazmak israf)
    if (el<HTMLDivElement>('fuelwrap')?.classList.contains('show')) {
      this.defterT -= dt
      if (this.defterT <= 0) { this.defterT = 1; this.renderFuelLog(state) }
    }
    this.setText(this.money, Math.round(state.money).toLocaleString('tr-TR'))
    this.setText(this.day, `${state.day}`)
    // C10: giriş serisi rozeti (seri ≥2'de görünür)
    const sc = el<HTMLDivElement>('streak-chip')
    if (sc) {
      const show = state.loginStreak >= 2 ? 'flex' : 'none'
      if (sc.style.display !== show) sc.style.display = show
      if (state.loginStreak >= 2) this.setText(el<HTMLSpanElement>('streak-n'), `${state.loginStreak}`)
    }
    this.setText(this.rep, state.reputation.toFixed(1))
    // rozet artık ÜÇ görevin kaçının bittiğini gösterir (eski hâli tek sabit 15-müşteri
    // sayacıydı ve mobilde hiç görünmüyordu — #1004)
    {
      const bitti = dailyQuests(state).filter(q => q.done).length
      this.setText(el<HTMLSpanElement>('quest'), bitti >= 3 ? t('TAMAM') : `${bitti}/3`)
    }
    if (this.activeCar) this.refreshPanel()
    const ts = this.tankerStatus()
    const tpanel = el<HTMLDivElement>('tankerpanel')
    this.setDisp(tpanel, ts.length ? 'flex' : 'none')
    if (ts.length) {
      tpanel.innerHTML = ts.map(t =>
        `<div class="trow">${icon('i-truck')} <span>${t}</span></div>`).join('')
    }
    // profil kartı açıldığında renderProfile() ile doldurulur (her frame değil)

    // yakıt türü başına tank barları + sipariş modalı satırları
    let anyLow = false
    for (const f of FUELS) {
      const lvl = state.tanks[f]
      const cap = state.fuelCapacity(f)
      if (lvl < cap * 0.15) anyLow = true
      el<HTMLDivElement>(`fill-${f}`).style.width = `${(lvl / cap) * 100}%`
      this.setText(el<HTMLSpanElement>(`lvl-${f}`), `${Math.round(lvl)}L`)
      const o = state.orders[f]
      const need = state.orderNeed(f)
      const btn = el<HTMLButtonElement>(`fbtn-${f}`)
      const info = el<HTMLDivElement>(`fneed-${f}`)
      if (o.pending || o.delivering) {
        this.setText(info, o.delivering ? t('Tanker istasyona yaklaşıyor…') : `Tanker yolda — ${Math.ceil(o.eta)} sn`)
        this.setText(btn, t('Yolda'))
        btn.disabled = true
      } else if (need < 100) {
        // SEBEP TEŞHİSİ ÜÇ AYRI DURUM — canlı rapor (Oğuz, Çevre Yolu): ortak tedarik
        // hattının günlük kotası bitince de "Para yetersiz" yazıyordu. Kasada ₺496k
        // varken üç yakıtta birden "para yok" görmek oyuncuyu deli ediyor; gerçek
        // sebep kotaydı ve EKRANDA HİÇ görünmüyordu. Öncelik sırası: kota > para > dolu
        // (kota, para kontrolünden ÖNCE — ikisi birden sıfırsa asıl kilit kotadır).
        const space = cap - lvl
        const hatKalan = state.supplyRemaining()
        if (hatKalan < 100 && space >= 100) {
          this.setText(info, t('Ortak hat kotası bugün doldu — yarın tazelenir'))
          this.setText(btn, t('Kota Doldu'))
        } else if (space >= 100) {
          this.setText(info, t('Para yetersiz — alış ₺{0}/L', state.buyPrice(f).toFixed(1)))
          this.setText(btn, t('Para Yok'))
        } else {
          this.setText(info, t('Tank dolu'))
          this.setText(btn, t('Dolu'))
        }
        btn.disabled = true
      } else {
        // oyuncu isteği: sipariş ekranında ALIŞ fiyatı görünsün
        // hat varsa kalan kota da yazılır — oyuncu duvara TOSLAMADAN görsün
        const hatK = state.supplyRemaining()
        this.setText(info, t('{0} / {1}L · +{2}L · alış ₺{3}/L', Math.round(state.tanks[f]), cap,
          need, (state.buyPrice(f) * state.supplierMult()).toFixed(1))
          + (isFinite(hatK) ? t(' · hat kotası: {0}L', Math.round(hatK).toLocaleString('tr-TR')) : ''))
        this.setText(btn, `₺${state.orderCost(f).toLocaleString('tr-TR')}`)
        btn.disabled = !state.canOrder(f)
      }
      {
        const inp = el<HTMLInputElement>(`fqty-${f}`)
        if (document.activeElement !== inp) inp.value = String(need)
      }
    }
    // TEDARİKÇİ SATIRI (#1067): hız/fiyat takası; teslimat bekleyen sipariş varken
    // değiştirmek yolda olan tankerin süresini değiştirmez (eta zaten yazılmış).
    {
      const row = document.getElementById('supplierrow')
      if (row) {
        const html = (Object.keys(SUPPLIERS) as (keyof typeof SUPPLIERS)[]).map(id => {
          const sp = SUPPLIERS[id]
          const fark = Math.round((sp.priceMult - 1) * 100)
          return `<button class="btn${id === state.supplier ? ' primary' : ''}" data-sup="${id}"`
            + ` style="flex:1; justify-content:center; flex-direction:column; gap:2px; height:auto; padding:7px 4px">`
            + `<span style="font-size:12px">${t(sp.label)}</span>`
            + `<span style="font-size:11px; opacity:.75">${fark === 0 ? t('piyasa') : `${fark > 0 ? '+' : ''}%${fark}`}`
            + ` · ${sp.etaMult < 1 ? t('hızlı') : sp.etaMult > 1 ? t('yavaş') : t('normal')}</span></button>`
        }).join('')
        if (row.dataset.sup !== state.supplier) { row.innerHTML = html; row.dataset.sup = state.supplier }
      }
      const d = document.getElementById('supplierdesc')
      if (d) this.setText(d as HTMLDivElement, t(SUPPLIERS[state.supplier].desc))
    }

    this.setText(this.closeLabel, state.closed ? t('KAPALI') : t('Açık'))

    if (state.batteryLevel > 0) {
      this.setDisp(this.battChip, 'flex')
      this.battFill.style.width = `${(state.battery / state.batteryCapacity) * 100}%`
      this.setText(this.battKwh, `${Math.floor(state.battery)}/${state.batteryCapacity}`)
    }

    const maintCount = getMaintenanceItems(state).filter(m => !m.disabled).length
    // sınıflar yalnızca durum DEĞİŞİNCE yazılır — her karede toggle gölge flash'ı yapıyordu
    const hudKey = `${state.closed}|${anyLow}|${maintCount > 0}`
    if (hudKey !== this.lastHudKey) {
      this.lastHudKey = hudKey
      this.closeBtn.classList.toggle('danger', state.closed)
      this.orderBtn.classList.toggle('danger', anyLow)
      this.orderBtn.classList.toggle('warn', !anyLow)
      this.shopBtn.classList.toggle('danger', maintCount > 0)
      this.shopBtn.classList.toggle('primary', maintCount === 0)
    }
    this.setDisp(this.maintBadge, maintCount > 0 ? 'inline-block' : 'none')
    this.setText(this.maintBadge, `${maintCount}`)
    const dot = el<HTMLSpanElement>('shopdot')
    this.setDisp(dot, maintCount > 0 ? 'flex' : 'none')
    this.setText(dot, `${maintCount}`)

    if (this.shopOpen) {
      this.shopRenderT -= dt
      if (this.shopRenderT <= 0) {
        this.renderShop(state)
        this.shopRenderT = 0.4
      }
    }

    const car = this.activeCar
    if (car && car.phase === 'atPump' && car.kind === 'fuel') {
      // dijital pompa ekranı canlı artar
      el<HTMLSpanElement>('pd-liters').textContent = car.filled.toFixed(1)
      el<HTMLSpanElement>('pd-total').textContent = Math.round(car.filledValue).toString()
      if (car.filling || car.filled > 0)
        this.progress.textContent = car.fullMode
          ? t('doluyor… hedef FULL')
          : t('doluyor… hedef ₺{0}', car.targetAmount)
    }
  }

  /** MESAJ KUTUSU (#1018 "uyarıyı gözden kaçırdım, tekrar bakmam için bir mesaj kutusu
   *  olsun"): toast 3.5 sn sonra siliniyordu ve geri dönüşü yoktu. Her toast artık burada
   *  da birikiyor; son 60 kayıt saklanır. */
  readonly inbox: { text: string; kind: string; t: number }[] = []
  private inboxUnread = 0
  get unreadCount() { return this.inboxUnread }
  markInboxRead() { this.inboxUnread = 0; this.syncInboxBadge() }
  private syncInboxBadge() {
    const b = document.getElementById('inboxdot')
    if (b) {
      b.textContent = this.inboxUnread > 9 ? '9+' : String(this.inboxUnread)
      b.style.display = this.inboxUnread > 0 ? 'flex' : 'none'
    }
  }

  /** EKRANDA DURAN toast'lar. Eskiden sadece DOM vardı; zamanlayıcılar node'a bağlı
   *  değildi, bu yüzden ne süre tazeleme ne de tıklayınca temiz kapatma yapılabiliyordu.
   *  (~20 açık geri bildirim: "çok hızlı kayboluyor", "üst üste yığılıyor", "tıklanamıyor") */
  private toastLive: {
    node: HTMLDivElement; base: string; n: number; onemli: boolean
    dogum: number; solma: number; silme: number
  }[] = []
  /** Aynı anda ekranda duracak EN FAZLA toast — fazlası "ekranı kaplıyor" şikayeti.
   *  3 satır, mobil dar kolonda bile ekranın küçük bir kısmını tutar. */
  private readonly toastMax = 3
  /** Bir toast'ın (birleştirmelerle uzasa da) ekranda kalabileceği TOPLAM süre. Aynı mesaj
   *  sürekli tekrar gelince (ör. her saniye "araç bekliyor") her birleştirme süreyi
   *  tazeliyordu → toast hiç gitmiyordu (#1305 "tıklayınca bile gitmiyor"). */
  private readonly toastOmurMs = 20000
  /** Ekran bildirimi tercihi (#1297 #1299 "kapatılabilmeli"): 'onemli' modunda sıradan
   *  bilgi toast'ları ekrana ÇIKMAZ, yalnız gelen kutusuna düşer (zil rozeti sayar);
   *  hata/uyarı ('bad') ve önemli olanlar yine görünür. localStorage: benzinlik-toast */
  toastMod: 'hepsi' | 'onemli' = 'hepsi'

  /** GÖRÜNME SÜRESİ okuma hızına göre: "okumaya vakit kalmıyor" şikayeti sabit 3.5 sn'den
   *  geliyordu — uzun cümle de kısa cümle de aynı sürede kayboluyordu. Artık taban süre +
   *  karakter başına ~55 ms; ayrıca önem derecesi tabanı yükseltir ('bad'/önemli en uzun,
   *  sıradan bilgi en kısa kalsın ki önemli olan spam içinde boğulmasın). */
  private toastSure(text: string, kind: string, onemli: boolean) {
    const taban = onemli ? 5200 : kind === 'good' ? 4200 : 3600
    const tavan = onemli ? 11000 : 8000
    return Math.min(tavan, taban + text.length * 55)
  }

  private toastKapat(rec: { node: HTMLDivElement; solma: number; silme: number }) {
    clearTimeout(rec.solma); clearTimeout(rec.silme)
    rec.node.remove()
    const i = this.toastLive.findIndex(x => x.node === rec.node)
    if (i >= 0) this.toastLive.splice(i, 1)
  }

  /** Sayacı artan toast'ın süresini SIFIRDAN başlat — birleştirme yapıp süreyi
   *  tazelemezsek "×3" yazısı görünür görünmez kaybolurdu. */
  private toastZamanla(rec: { node: HTMLDivElement; base: string; onemli: boolean; dogum: number; solma: number; silme: number }, kind: string) {
    clearTimeout(rec.solma); clearTimeout(rec.silme)
    rec.node.style.transition = ''
    rec.node.style.opacity = ''
    // ömür tavanı: birleştirme süreyi tazeler ama doğumdan itibaren toastOmurMs'i aşamaz
    const kalanOmur = Math.max(1500, rec.dogum + this.toastOmurMs - Date.now())
    const ms = Math.min(kalanOmur, this.toastSure(rec.node.textContent ?? rec.base, kind, rec.onemli))
    rec.solma = window.setTimeout(() => { rec.node.style.transition = 'opacity .4s'; rec.node.style.opacity = '0' }, ms)
    rec.silme = window.setTimeout(() => this.toastKapat(rec), ms + 400)
  }

  /**
   * @param silent  ses ÇALMASIN (mevcut çağrıların 3. parametresi — "kalıcı" DEĞİL)
   * @param onemli  görsel olarak öne çıksın + daha uzun dursun + eleme sırasında en son düşsün
   *                (yeni ve opsiyonel; mevcut yüzlerce çağrı etkilenmez)
   */
  toast(msg: string, kind: 'good' | 'bad' | '' = '', silent = false, onemli = false) {
    {
      const kayit = stripEmoji(t(msg))
      const son = this.inbox[this.inbox.length - 1]
      if (!son || son.text !== kayit) {
        this.inbox.push({ text: kayit, kind, t: Date.now() })
        if (this.inbox.length > 60) this.inbox.shift()
        this.inboxUnread++
        this.syncInboxBadge()
      }
    }
    const box = el<HTMLDivElement>('toasts')
    // DOM'dan bizim dışımızda silinmiş kayıtları at (dil değişimi, sahne yeniden kurulumu,
    // test): kalırsa hem tavanı boş yere doldururlar hem de "×N" görünmeyen bir node'a yazılır.
    for (let i = this.toastLive.length - 1; i >= 0; i--) {
      const r = this.toastLive[i]
      if (!r.node.isConnected) { clearTimeout(r.solma); clearTimeout(r.silme); this.toastLive.splice(i, 1) }
    }
    // sarılmamış Türkçe toast'lar da İngilizce moda çevrilsin (t() bilinen key'i çevirir, değilse aynen bırakır)
    const text = stripEmoji(t(msg))
    // 'bad' her zaman önemlidir: hata/uyarı gözden kaçmamalı
    const vurgulu = onemli || kind === 'bad'
    // "Yalnız önemli" modu: sıradan bilgi gelen kutusunda kaldı (yukarıda yazıldı), ekrana çıkmaz
    if (this.toastMod === 'onemli' && !vurgulu) return

    // SPAM KIRICI: aynı mesaj tekrar gelirse YENİ toast dizmek yerine mevcudun üstüne
    // "×N" koy ve süresini tazele. Eskiden yalnızca EN SON toast'a bakılıyordu; araya
    // başka bir mesaj girince aynı metin tekrar tekrar diziliyordu (yığılmanın asıl kaynağı).
    // Ayrıca birleştirmede SES ÇALMIYORUZ → "arka arkaya bildirim sesi" şikayeti biter.
    const ayni = this.toastLive.find(x => x.base === text)
    if (ayni) {
      ayni.n++
      ayni.node.textContent = `${text} ×${ayni.n}`
      ayni.node.dataset.n = String(ayni.n)
      // sayaç arttı: kısa bir vurgu (reduced-motion'da CSS animasyonu devre dışı)
      ayni.node.classList.remove('bump')
      void ayni.node.offsetWidth
      ayni.node.classList.add('bump')
      this.toastZamanla(ayni, kind)
      return
    }

    if (!silent) audio.toastSfx(kind)   // ses kapısı audio.ts'te: kısa aralıkta tekrar çalmaz

    // TAVAN: fazlası varsa önce SIRADAN olanı düşür, önemliler (bad/onemli) ekranda kalsın —
    // "önemli olan spam içinde gözden kaçıyor" şikayetinin çözümü.
    while (this.toastLive.length >= this.toastMax) {
      const kurban = this.toastLive.find(x => !x.onemli) ?? this.toastLive[0]
      this.toastKapat(kurban)
    }

    const node = document.createElement('div')
    node.className = `toast ${kind}${vurgulu ? ' imp' : ''}`
    node.textContent = text
    node.dataset.base = text
    node.dataset.n = '1'
    const rec = { node, base: text, n: 1, onemli: vurgulu, dogum: Date.now(), solma: 0, silme: 0 }
    // TIKLAYINCA KAPANSIN ("kapatmak mümkün değil"). stopPropagation: tıklama altındaki
    // sahneye/butona geçip yanlışlıkla bina koymasın/kamerayı oynatmasın.
    // Kapatma pointerUP'ta: pointerdown'daki preventDefault bazı mobil tarayıcılarda
    // takip eden click'i yutuyordu → "üstüne tıklayınca bile gitmiyor" (#1305).
    node.addEventListener('pointerdown', e => { e.stopPropagation(); e.preventDefault() })
    // Node HEMEN silinmez: click olayı hâlâ bu node'a gelsin ki altındaki sahneye düşmesin.
    node.addEventListener('pointerup', e => { e.stopPropagation(); node.style.opacity = '0'; window.setTimeout(() => this.toastKapat(rec), 80) })
    node.addEventListener('click', e => { e.stopPropagation(); this.toastKapat(rec) })
    box.appendChild(node)
    this.toastLive.push(rec)
    this.toastZamanla(rec, kind)
  }

  showBoom() {
    el<HTMLDivElement>('boom').classList.add('show')
  }
}
