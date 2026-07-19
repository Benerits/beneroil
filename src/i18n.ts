/**
 * Basit i18n: TR anahtar → EN değer. Varsayılan TR; EN eksikse TR'ye düşer (asla boş kalmaz).
 * Dil: localStorage > tarayıcı dili. Değişince reload (tüm metinler tazelenir).
 */
const LANG_KEY = 'beneloil-lang'

function detect(): 'tr' | 'en' {
  const saved = localStorage.getItem(LANG_KEY)
  if (saved === 'tr' || saved === 'en') return saved
  return (navigator.language || '').toLowerCase().startsWith('tr') ? 'tr' : 'en'
}

export let lang: 'tr' | 'en' = detect()

export function setLang(l: 'tr' | 'en') {
  localStorage.setItem(LANG_KEY, l)
  location.reload()
}

// TR metin → EN karşılığı. Anahtar = kaynak koddaki TR string.
const EN: Record<string, string> = {
  // --- Giriş ekranı ---
  'BENELOIL': 'BENELOIL',
  'İstasyonunu kur, imparatorluğunu büyüt. İlerlemen hesabında güvende.':
    'Build your station, grow your empire. Your progress is saved to your account.',
  'oyuncu istasyonunu kurdu': 'players built their station',
  'şu an oyunda': 'playing now',
  'e-posta': 'email',
  'şifre': 'password',
  'Giriş Yap': 'Sign In',
  'Kayıt Ol': 'Sign Up',
  'Kayıt olarak': 'By signing up you accept our',
  'Kullanım Şartları': 'Terms of Service',
  've': 'and',
  "Gizlilik Politikası'nı kabul etmiş olursun.": 'Privacy Policy.',
  'Sunucuya ulaşılamadı.': 'Could not reach the server.',
  'Sunucu hatası.': 'Server error.',

  // --- HUD ---
  'GÜN': 'DAY', 'KASA': 'CASH', 'BENZİN': 'PETROL', 'DİZEL': 'DIESEL', 'LPG': 'LPG',
  'BATARYA': 'BATTERY', 'İTİBAR': 'RATING', 'GÜNLÜK GÖREV': 'DAILY QUEST', 'OYUNDA': 'ONLINE',
  'Açık': 'Open', 'KAPALI': 'CLOSED', 'Yakıt Siparişi': 'Order Fuel', 'İnşaat': 'Build',
  'Düzenleme modu': 'Edit mode', 'Hesabım': 'My Account', 'Ayarlar': 'Settings', 'Sorun Bildir': 'Report Issue',

  // --- Servis paneli ---
  'MÜŞTERİ İSTEĞİ': 'CUSTOMER REQUEST', 'Benzin': 'Petrol', 'Dizel': 'Diesel',
  'FULLE': 'FILL UP', 'BAŞLAT': 'START', 'HIZLI ŞARJ': 'FAST CHARGE', 'ŞARJ BAŞLAT': 'START CHARGING',
  'Müşteriyi Gönder': 'Dismiss Customer', 'Tabanca seç; tutar gir ya da FULLE': 'Pick a nozzle; enter amount or FILL UP',
  '₺ tutar gir': '₺ enter amount',

  // --- Sipariş modalı ---
  'Yolda': 'On the way', 'Dolu': 'Full', 'Tank dolu': 'Tank full', 'Sipariş': 'Order',
  'Tanker istasyona yaklaşıyor…': 'Tanker approaching the station…',

  // --- İnşaat / genel butonlar ---
  'İnşaat & Yatırım': 'Build & Invest', 'İstasyon': 'Station', 'Tesisler': 'Facilities',
  'Enerji': 'Energy', 'Arsa': 'Land', 'Bakım': 'Maintenance',
  'Taşı': 'Move', 'Yükselt': 'Upgrade', 'Satın Al': 'Buy', 'Kapat': 'Close', 'Gönder': 'Send',

  // --- Ayarlar ---
  'Dil': 'Language', 'Türkçe': 'Turkish', 'İngilizce': 'English',
  'Kaydı Sil ve Baştan Başla': 'Delete Save & Restart',
  'Hesap (kaydın bulutta saklanır)': 'Account (your save is stored in the cloud)',
  'Giriş yapılmadı.': 'Not signed in.', 'Çıkış Yap': 'Log Out',
  'Bug mu buldun, önerin mi var? Yaz gönder — hepsini okuyoruz.':
    'Found a bug or have a suggestion? Write it — we read them all.',
  'Örn: girişte araçlar sıkışıyor / şu özellik olsa süper olur...':
    'e.g. cars jam at the entrance / this feature would be great...',
  'Bildirimin alındı — teşekkürler, okuyoruz!': 'Feedback received — thank you, we read them!',
  'Mesaj çok kısa — biraz detay ver.': 'Message too short — add a bit more detail.',

  // --- Sık toast'lar ---
  'Taşındı!': 'Moved!', '💸 Para yetmiyor!': "💸 Can't afford it!",
  'Sıfırdan başlıyorsun — hayırlı olsun patron!': 'Starting fresh — good luck, boss!',
  'İstasyon tekrar AÇIK — bekleriz!': 'Station is OPEN again — welcome!',
  'Müşteri beklemekten sıkıldı ve gitti!': 'Customer got tired of waiting and left!',
  'Çıkış yapıldı.': 'Logged out.',

  // --- 3D bina etiketleri ---
  'YAKIT TANKI': 'FUEL TANK', 'GİRİŞ': 'ENTRANCE', 'ÇIKIŞ': 'EXIT', 'OFİS': 'OFFICE',
  'MARKET': 'MARKET', 'TUVALET': 'RESTROOM', 'BATARYA DEPOSU': 'BATTERY DEPOT',
  'GÜNEŞ SANTRALİ': 'SOLAR PLANT', 'JENERATÖR': 'GENERATOR', 'OTO YIKAMA': 'CAR WASH',
  'KAHVECİ': 'CAFE', 'RESTORAN': 'RESTAURANT', 'TIR PARKI': 'TRUCK STOP', 'SELF YIKAMA': 'SELF WASH',
  'OTOPARK': 'PARKING', 'HAVA-SU ÜNİTESİ': 'AIR & WATER', 'REAKTÖR': 'REACTOR',
  'POMPA #{0}': 'PUMP #{0}', 'DC ŞARJ #{0}': 'DC CHARGER #{0}',

  // --- İnşaat menüsü (shop) ---
  'Arsa Satın Al ({0}/18)': 'Buy Land ({0}/18)', '2 blok 3×3': '2 blocks 3×3',
  'Bitişik arsalardan birini seç — istasyon geliştikçe emlak fiyatları artar':
    'Pick an adjacent plot — prices rise as your station grows',
  'Zemin Betonu': 'Paving', 'arsa başı': 'per plot',
  'Çimen arsana beton döşe (yapı kurmak için şart, güneş paneli hariç)':
    'Pave a grass plot (required to build, except solar)',
  'Betonsuz arsan yok': 'No unpaved plot',
  'Pompa #{0}': 'Pump #{0}', '+1 pompa': '+1 pump', 'Aynı anda bir müşteri daha alırsın': 'Serve one more customer at once',
  'Tabela Sv.{0}': 'Sign Lv.{0}', '+%10 trafik': '+10% traffic', 'Yoldan geçenlerin uğrama şansı artar': 'More passers-by stop by',
  'Yakıt Tankı': 'Fuel Tank', 'Depo büyür, daha seyrek sipariş verirsin': 'Bigger storage, fewer orders needed',
  'Hava-Su Ünitesi': 'Air & Water Unit', 'Hava-Su Ünitesi ({0})': 'Air & Water Unit ({0})',
  'Lastik havası ve su — ucuz ama müşteri çeker (sınırsız kurulur)':
    'Tire air & water — cheap but draws customers (unlimited)',
  'Otopark': 'Parking Lot', 'Otopark ({0})': 'Parking Lot ({0})', '+4 araç': '+4 cars',
  'Çizgili park alanı — müşteriler park edip tesisleri kullanır (sınırsız kurulur)':
    'Striped lot — customers park and use facilities (unlimited)',
  'Market': 'Market', 'Market Sv.2': 'Market Lv.2', 'Müşteriler ekstra alışveriş yapar': 'Customers shop extra',
  'Tuvalet': 'Restroom', 'Tuvalet Sv.2': 'Restroom Lv.2', '+moral': '+morale',
  'Müşteri memnuniyetini ve itibarı artırır': 'Boosts satisfaction and rating',
  'Oto Yıkama': 'Car Wash', 'Yağ Değişimi': 'Oil Change', 'Self Yıkama': 'Self Wash', 'Self Yıkama ({0})': 'Self Wash ({0})',
  'Araçlar kendisi yıkar; gelir kurulum sayısıyla artar (sınırsız)':
    'Self-service wash; income scales with count (unlimited)',
  'Kahveci': 'Cafe', 'Restoran': 'Restaurant', 'Tır Parkı': 'Truck Stop',
  'Yolcular kahve molası verir': 'Travelers take a coffee break',
  'Uzun yol müşterisi yemek molası verir': 'Long-haul customers take a meal break',
  'Tırcılar konaklar — düzenli pasif gelir': 'Truckers stay over — steady passive income',
  'Elektrik Altyapısı Sv.{0}': 'Power Grid Lv.{0}', 'temel': 'basic', '+%30 üretim': '+30% output',
  'Şarj ve enerji yapılarının önünü açar': 'Unlocks charging and energy buildings',
  'Tüm üretimi güçlendirir, yeni yapılar açılır': 'Boosts all output, unlocks new buildings',
  'Batarya Deposu Sv.{0}': 'Battery Depot Lv.{0}',
  'Üretilen elektriği biriktirir, araçlar buradan anında şarj olur':
    'Stores generated power; cars charge from here instantly',
  'Elektrik altyapısı gerekli': 'Power grid required',
  'DC Şarj Ünitesi #{0}': 'DC Charger #{0}', '+1 ünite': '+1 unit',
  'Elektrikli araç müşterileri gelmeye başlar; ünite arttıkça EV trafiği artar':
    'EV customers start arriving; more units bring more EV traffic',
  'Güneş Santrali': 'Solar Plant', 'Dizel Jeneratör': 'Diesel Generator', 'Modüler Reaktör': 'Modular Reactor',
  'Bedava üretim — ama kirlenir, düzenli temizlik ister (sınırsız kurulur)':
    'Free power — but gets dirty, needs regular cleaning (unlimited)',
  'Tanktan mazot yakar — gürültüsü şarjdaki müşterileri kaçırır':
    'Burns diesel from tank — noise scares charging customers away',
  'Dev üretim — bakımsız kalırsa PATLAR, her şey sıfırlanır':
    'Massive output — EXPLODES if neglected, resets everything',
  'MAKS': 'MAX',

  // --- Bina kartları (genel) ---
  'Çalışıyor': 'Running', 'ARIZALI': 'BROKEN', 'Durum': 'Status', 'Seviye': 'Level', 'Üretim': 'Output',
  'Anında': 'Instant', 'Şarj süresi': 'Charge time', 'Satış': 'Price',
  'Araca akış': 'Flow to car', 'Şebeke maliyeti': 'Grid cost', 'Kirlilik': 'Dirt', 'Bugünkü ciro': "Today's revenue",
  'İtibar': 'Rating', 'Müşteri etkisi': 'Customer impact', 'Kullanım ücreti': 'Usage fee',

  // --- Sık toast / bildirim ---
  '{0} tankeri yola çıktı!': '{0} tanker is on the way!',
  '{0} tankı dolduruldu!': '{0} tank refilled!',
  '{0} teslimatı gecikti — yakıt yine de teslim edildi.': '{0} delivery delayed — fuel delivered anyway.',
  '{0} tankeri zaten yolda — teslimatı bekle.': '{0} tanker already on the way — wait for delivery.',
  'Bahşiş: +₺{0}': 'Tip: +₺{0}', 'Taşan yakıt cezası: -₺{0}': 'Spill penalty: -₺{0}',
  'MÜŞTERİ PATLAMASI! 90 saniye yoğun akın — pompalara koş!': 'CUSTOMER RUSH! 90 seconds of heavy traffic — hit the pumps!',
  '🅿️ Müşteri aracını otoparka çekti, tesisleri kullanacak.': '🅿️ Customer parked to use the facilities.',
  'Tuvalet artık ücretsiz.': 'Restroom is now free.', 'Tuvalet ücreti: ₺{0}': 'Restroom fee: ₺{0}',
  'Ücretsiz': 'Free', 'GÜNLÜK GÖREV TAMAM: 15 müşteri — ödül +₺1.000!': 'DAILY QUEST DONE: 15 customers — reward +₺1,000!',
  'İstasyon bakıma alındı — itibar düşmez.': 'Station under maintenance — rating protected.',
}

export function t(tr: string, ...args: (string | number)[]): string {
  let s = lang === 'tr' ? tr : (EN[tr] ?? tr)
  args.forEach((a, idx) => { s = s.replace(`{${idx}}`, String(a)) })
  return s
}

/** data-i18n="TR metin" olan tüm elemanları çevir (index.html statik metinleri) */
export function translateDom(root: ParentNode = document) {
  if (lang === 'tr') return
  for (const el of root.querySelectorAll<HTMLElement>('[data-i18n]')) {
    const key = el.getAttribute('data-i18n') || ''
    if (key && EN[key]) el.textContent = EN[key]
  }
  for (const el of root.querySelectorAll<HTMLElement>('[data-i18n-ph]')) {
    const key = el.getAttribute('data-i18n-ph') || ''
    if (key && EN[key]) (el as HTMLInputElement).placeholder = EN[key]
  }
}
