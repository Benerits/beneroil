# BenelOil — App Store (iOS) Çıkış Hazırlık Analizi

BenelOil = Capacitor ile sarılmış web oyunu (`beneloil-ios` repo, web `dist`'i bundle'lar; TestFlight CI aktif). Aşağıda App Store'da **yayınlanmanın önündeki eksikler**, öncelik sırasıyla.

Etiketler: 🔴 **BLOKER** (review reddi riski) · 🟡 önemli · 🟢 iyileştirme

---

## 1) 🔴 App Store review'ı geçmek için ZORUNLU

| # | Konu | Durum / Eksik | Aksiyon |
|---|------|---------------|---------|
| 1.1 | **Hesap silme (in-app)** | Apple 5.1.1(v): hesap oluşturan uygulama **uygulama içinden hesap silmeyi** de sunmalı. Şu an sadece "Çıkış Yap" var; sunucuda DELETE var ama **kullanıcıya açık değil**. (feedback #72 "mailimi silin") | Ayarlar → "Hesabımı Sil" → onaylı `DELETE /api/account` ucu ekle (save + player kaydını siler) |
| 1.2 | **Gizlilik Politikası + Destek URL** | E-posta/oyun verisi topluyoruz; App Store Connect **Privacy Policy URL** ve **Support URL** ister | `benerits.com/privacy` + `benerits.com/beneloil/support` sayfaları yayınla |
| 1.3 | **App Privacy "nutrition labels"** | ASC'de veri toplama beyanı zorunlu (E-posta = Account; oyun ilerlemesi; **ödüllü reklam var** → AppLovin MAX'in topladığı Identifiers/Usage Data/Diagnostics beyan edilmeli, "used for third-party advertising") | ASC'de "Data Collection" doldur: Contact Info→Email (App Functionality), User Content, Identifiers (Device ID — Third-Party Advertising), Usage Data (Advertising Data), Diagnostics. Kaynak: AppLovin MAX privacy disclosure tablosu + mediation ağlarının kendi tabloları |
| 1.4 | **Review için demo hesap** | Oyun **login zorunlu, misafir yok** → reviewer giremez, otomatik red | Review Notes'a demo e-posta/şifre koy **veya** misafir/demo modu ekle |
| 1.5 | **Sign in with Apple** | Google login sunuluyorsa Apple 4.8: eşdeğer Apple girişi de gerekli | Apple login zaten kodda var (`SocialLogin apple`) — iOS build'de aktif ve çalışır olduğunu doğrula |
| 1.6 | **Ödüllü reklam: SKAdNetwork + CMP (ATT yok)** | Ödüllü reklam **var** (AppLovin MAX, yalnız opt-in rewarded; `src/ads.ts`, `docs/REKLAM-STRATEJI.md`). Tasarım kararı: **ATT istenmiyor** — MAX kişiselleştirilmemiş reklam gösterir; ATT'siz reklam Apple'a uygun, IDFA toplanmaz. Ama `Info.plist`'te MAX + her mediation ağının **SKAdNetworkItems** listesi ve AB/UK için **GDPR CMP** (MAX'in Google UMP entegrasyonu) şart | (1) `ios/App/App/Info.plist`: SKAdNetworkItems (AppLovin dashboard → "SKAdNetwork IDs" plist üretici) (2) MAX dashboard → Privacy → CMP aç (3) Dokploy env `APPLOVIN_SDK_KEY / APPLOVIN_IOS_REWARDED / APPLOVIN_EVENT_KEY` yoksa reklam hiç görünmez; 1.3 beyanı buna rağmen yapılmalı (SDK gömülü) |

## 2) 🟡 Teknik hazırlık (Capacitor/iOS)

| # | Konu | Eksik | Aksiyon |
|---|------|-------|---------|
| 2.1 | **Yerel bildirimler** | Kodda `LocalNotifications` kullanımı **eklendi** (kumbara/arıza/indirim + tanker ETA). iOS app'te `@capacitor/local-notifications` plugin'i kurulu + `Info.plist` izni olmalı | `npm i @capacitor/local-notifications` (iOS repo) + `npx cap sync`; ilk açılışta izin iste |
| 2.2 | **Arka plan** | WebView arka planda uykuya dalar → oyun döngüsü durur. "Arka planda çalışma" = **önden planlanmış yerel bildirim** ile çözüldü (tanker ETA). Gerçek background compute yok (Apple kısıtı) | Mevcut yaklaşım App Store-uyumlu; ek: uygulama tekrar açılınca offline-kazanç/geçen süre uygula |
| 2.3 | **Performans/ısınma** | feedback #105/#113/#117: CPU ~full, cihaz ısınıyor (Android'de daha kötü). Bloom yarı-çözünürlük var | DPR clamp (≤2), gölge/segment azalt, sekme gizliyken rAF durdur, uzak nesne LOD |
| 2.4 | **Safe-area & iPad** | Placement kayması **düzeltildi** (canvas rect NDC). iPad yatay/dikey ve notch testleri | Farklı cihaz boyutlarında UI + dokunuş testi (özellikle taşıma modu) |
| 2.5 | **Uygulama ikonu + launch screen** | Tüm boyutlarda ikon + LaunchScreen storyboard | iOS repo'da `Assets.xcassets` ikon setleri + launch screen kontrol |
| 2.6 | **Sürüm/build numarası** | Her TestFlight yüklemesinde build number artmalı | CI'da otomatik build-number bump doğrula |
| 2.7 | **Ağ hatası / offline** | Login/save sunucuya bağımlı; ağ yokken zarif bozulma | Offline uyarısı + tekrar dene; cloudBlock overlay mevcut |

## 3) 🟡 Oyun kalitesi / stabilite (review'da "min. işlevsellik")

| # | Konu | Durum |
|---|------|-------|
| 3.1 | Soft-lock (arıza + parasızlık) | Banka **teminatsız avans** ile kurtarma yolu eklendi ✅ (feedback #81/#87) |
| 3.2 | Pathfinding/park çakışmaları | feedback #85/#106/#107 — hâlâ açık; review'ı bloklamaz ama puan düşürür |
| 3.3 | Onboarding | "Hoş geldin" akışı + pompacı devri düzeltildi ✅ |
| 3.4 | Çoklu cihaz senkron | 409 guard + odak-pull eklendi ✅ (ilerleme karışması biter) |

## 4) 🟢 Mağaza metadata (yayın öncesi hazırlık)

- **Ekran görüntüleri**: 6.7"/6.5" iPhone + 12.9" iPad (zorunlu boyutlar), 3-5 adet, oyun içi + değer önerisi
- **Açıklama + anahtar kelimeler**: TR + EN; "benzin istasyonu, tycoon, işletme, idle"
- **Kategori**: Games → Simulation/Casual
- **Yaş sınırı**: muhtemelen 4+ (şiddet yok; reaktör patlaması komik/soyut)
- **Önizleme videosu** (opsiyonel ama dönüşümü artırır)
- **Pazarlama**: "İlk 24 saat" / "Teşekkür" görselleri hazır (Gemini + HTML)

---

## Öncelikli yol haritası (çıkışa kadar)
1. **1.1 Hesap silme** + **1.2 Privacy/Support URL** + **1.3 App Privacy labels** + **1.4 demo hesap** → bunlar olmadan **kesin red**.
2. **2.1 LocalNotifications plugin** kurulumu (kod hazır) + **2.5 ikon/launch** doğrulama.
3. **2.3 Performans** geçişi (ısınma şikayetleri App Store yorumlarını düşürür).
4. **3.2 Pathfinding** iyileştirme (kalite).
5. **4) Metadata** + ekran görüntüleri → ASC'ye yükle → review'a gönder.

> Özet: Teknik olarak TestFlight'a çıkıyor; **yayın blokerleri esas olarak hesap-silme, gizlilik/privacy beyanları ve reviewer için demo erişimi.** Bunlar tamamlanınca review'a gönderilebilir.
