# BenelOil — iOS Port Planı (iPhone + iPad)

> **Amaç:** Tarayıcıda çalışan mevcut Three.js/Vite oyununu, tek kod tabanını koruyarak
> App Store'da yayınlanabilir bir iOS uygulamasına (iPhone + iPad, universal) dönüştürmek.
> **Yöntem:** Capacitor (WebView sarmalayıcı) — oyun native Metal/WebGL ile aynı motor
> üzerinden çalışır, ayrı bir engine portu gerekmez. Yazıldığı tarih: 2026-07-20.

---

## 0. Neden Capacitor (ve neden React Native/Unity değil)

- Oyun zaten **tek sayfalık WebGL uygulaması** (`index.html` + `src/*.ts`, Three.js). Motoru
  yeniden yazmak (Unity/SpriteKit) haftalar alır ve mevcut ekonomiyi/simülasyonu çöpe atar.
- Capacitor oyunu bir `WKWebView` içinde çalıştırır; WebGL iOS'ta Metal'e köprülenir —
  performans, mobil Safari'de zaten test edilmiş olan seviyenin aynısı.
- Native köprü gereken tek yerler: **IAP, push, safe-area, haptics, durum çubuğu, dosya
  saklama** — hepsi hazır Capacitor eklentileriyle karşılanır.
- Sunucu (petrol.benerits.com) **hiç değişmeden** kalır; uygulama aynı REST/WS API'yi çağırır.

**Riskler:** App Store, "sadece web sitesini saran" uygulamaları reddedebilir (Guideline
4.2 — minimum functionality). Bunu native entegrasyonlarla (IAP, push, haptics, offline,
paylaşım) ve app-özel bir deneyimle aşarız; salt WebView değil, mağazadan alınmış hissi verir.

---

## 1. Ön koşullar (bir kez)

- **Donanım/araç:** macOS + Xcode 16+, CocoaPods, Node 20, Apple Developer hesabı
  (Hopsule Inc. — Delaware; App Store hukuki sahibi bu, altbilgideki ibareyle uyumlu).
- **Bundle ID:** `com.benerits.beneloil` (sortubes `com.benerits.sorttubes` ile aynı ekip
  hesabı altında; APNs anahtarı paylaşılabilir ama §6'da kendi topic'ini öneriyoruz).
- **App Store Connect'te uygulama kaydı:** isim "BenelOil", kategori Games/Simulation,
  universal (iPhone + iPad).
- **Ekipteki hazır bilgi:** `.claude/skills/app-store-submission` ve `app-store-screenshots`
  skilleri bu repoda mevcut — submission ve görsel üretimi otomasyonu oradan.

---

## 2. Capacitor entegrasyonu (proje iskeleti)

```bash
npm i @capacitor/core @capacitor/ios
npm i -D @capacitor/cli
npx cap init BenelOil com.benerits.beneloil --web-dir=dist
npm run build          # dist/ üretir
npx cap add ios
npx cap sync ios
npx cap open ios       # Xcode
```

- `capacitor.config.ts`:
  - `server.androidScheme`/`iosScheme`: `capacitor` (varsayılan) — WKWebView `file://`
    yerine `capacitor://localhost` kullanır, CORS ve çerez davranışı native kalır.
  - `backgroundColor`: oyun arka planıyla aynı (#0d1420) — açılış flaş'ı olmasın.
  - `ios.contentInset: 'never'` — safe-area'yı biz yöneteceğiz (§4).
- **Eklentiler (aşamalı):** `@capacitor/status-bar`, `@capacitor/splash-screen`,
  `@capacitor/haptics`, `@capacitor/preferences` (yerel ayar), `@capacitor/app` (arka plan/ön
  plan olayları), `@capacitor/share`, ve IAP için `@capacitor-community/in-app-purchases`
  (veya RevenueCat — §5).

**Dikkat:** `index.html` şu an tek dosya; build çıktısı `dist/` Capacitor'ün `webDir`'i.
CI'da web deploy (Dokploy) ile iOS build **aynı `dist`'ten** beslenir — kod bölünmez.

---

## 3. Online-only mimarinin iOS'a etkisi (ÖNEMLİ karar)

Oyun bugün **sunucu-otoriter**: kayıt buluttan yüklenir, hesap duvarı var, misafir modu yok
(`main.ts` `await new Promise(()=>{})` login'e kadar motoru durdurur; `docs/WHY-IT-WORKS.md`
§6.1). iOS'ta bunun iki sonucu:

1. **App Review internetsiz cihazda test eder.** Uçak modunda açılışta boş/kilitli ekran =
   **reddedilme sebebi**. Çözüm: uygulama ilk açılışta ağ yoksa "bağlantı gerekli" yerine
   *oynanabilir bir tanıtım/sandbox* göstermeli VEYA en azından anlamlı bir offline ekran +
   otomatik yeniden deneme. Öneri: **ilk-müşteri sandbox'ı** (retention analizi zaten bunu
   en yüksek kaldıraç sayıyor) — hem review'ı geçirir hem day-1 churn'ü düşürür.
2. **Offline kazanç / tekrar açılış:** mobilde "geri gel, biriken parayı topla" beklenir.
   Mevcut offline layer zayıf (2 saat cap, sadece truck-park + self-wash). iOS öncesi
   güçlendirilmeli (bkz. §9 yol haritası).

> Bu, iOS'un ürüne dayattığı en büyük değişiklik. Teknik port kolay; **online-only duvarı**
> hem App Review hem retention açısından port'un asıl işi.

---

## 4. Dokunmatik, safe-area ve ekran (iPhone + iPad)

- **Safe-area:** notch/dinamik ada ve alt home-indicator için tüm sabit UI
  `env(safe-area-inset-*)` kullanmalı. HUD'a üst inset eklendi (2026-07-20 mobil kompakt
  media query); `movectl`, `#fbbtn`, panel ve modallar için de alt/yan inset gözden geçir.
- **Viewport:** `<meta name="viewport" ... viewport-fit=cover, user-scalable=no>` (pinch-zoom
  kapalı; oyun kendi kamerasını yönetiyor).
- **iPad:** geniş ekran + çoklu pencere (Split View). Oyun ortografik kamera kullanıyor;
  `resize` doğru dinleniyor mu doğrula. iPad'de HUD masaüstü düzenine dönmeli (media query
  eşiği 680px — iPad portre 768/834px zaten masaüstü düzenini alır, bu doğru).
- **Yerleştirme kolaylığı (aktif şikayet):** 2026-07-20'de dokunuşla-konumlandır +
  12px tap toleransı eklendi; iOS'ta ayrıca:
  - `movectl` ok butonlarını iOS'ta biraz büyüt (min 48×48pt Apple HIG).
  - Haptic feedback: geçerli yerleşim/onay/iptal'de `Haptics.impact()` — dokunsal net geri
    bildirim, "nereye bıraktım" belirsizliğini azaltır.
  - Uzun-basıp-sürükle alternatifi: ghost'u parmakla sürükleyip bırakınca yerleştir (şu an
    tek-dokunuş konumlandırıyor; sürükle daha sezgisel olabilir — A/B).
- **Tam ekran:** durum çubuğunu gizle/şeffaflaştır (`StatusBar.setOverlaysWebView(true)`),
  arka planı oyunla eşle.

---

## 5. Para kazanma — In-App Purchase (App Store zorunlu)

App Store dijital malları **kendi IAP'si dışında satmayı yasaklar** (Guideline 3.1.1).
Oyunda para/ekonomi olduğundan, gerçek-para satışı olacaksa IAP şart. Seçenekler:

- **Tüketilebilir (consumable):** "₺ paketi" / "yakıt takviyesi" / "bir günlük 2× kazanç".
  Mevcut ekonomiye en uygun. Sunucu-otoriter olduğu için satın alım **sunucuda doğrulanmalı**
  (App Store receipt → `/api/iap/verify` → bakiye ekle; client'a güvenme, para clamp'i zaten
  var). 
- **Reklam kaldırma (non-consumable)** veya **abonelik:** "BenelOil Plus" (offline cap
  artışı, özel istasyon teması). Retention'a bağlar.
- **Reklamlar:** oyunda zaten ödüllü reklam ("MÜŞTERİ PATLAMASI") var. iOS'ta AdMob/native
  reklam SDK'sı + **ATT (App Tracking Transparency)** izin diyaloğu gerekir (kişiselleştirilmiş
  reklam için). ATT olmadan da reklam gösterilebilir (bağlamsal).
- **Öneri:** MVP'de RevenueCat + 2-3 consumable ile başla (receipt doğrulamayı RevenueCat
  server-side halleder, kendi verify endpoint'ini yazma yükünü azaltır). ATT ve reklam SDK'sı
  ikinci sürüme.

**Sunucu işi:** `benzinlik_player`'a `iap_ledger` / entitlement kolonları; `/api/iap/verify`
(App Store Server API veya RevenueCat webhook). Para clamp'i (`sanitizeSave`, 2M limit + hız
freni) IAP kredisini ayrı kanaldan geçirmeli (client save değil, sunucu yazar — mevcut
`/vs/v1/users/:id/live {kind:balance}` mekanizmasına benzer güvenli yol).

---

## 6. Push bildirimleri (retention motoru)

- Mevcut altyapı: `docs/LIVE-OPS.md` §5 — **geçici** sortubes (tubes-api) APNs köprüsü ekibe
  "+1 oyuncu" push atıyor. Oyunculara push için BenelOil **kendi APNs topic'ini** almalı:
  - Apple Developer'da `com.benerits.beneloil` için APNs key (.p8) üret (veya ekip anahtarını
    paylaş, farklı topic).
  - Capacitor `@capacitor/push-notifications`: cihaz token'ı → `/api/push/register {token}`
    → `benzinlik_player`'a APNs token kolonu (arrower_push_token benzeri).
  - Sunucuda `lib/notify.ts` (tubes-api'deki HTTP/2 token-auth APNs kodu) kopyalanır; segment
    bazlı gönderim: "yakıtın bitmek üzere", "günlük görev bekliyor", "offline ₺X birikti".
- **LIVE-OPS §5'teki TODO:** iOS'a çıkarken sortubes köprüsünü **kes**, kendi topic'ine geç.
- **İzin akışı:** push izni ilk açılışta değil, oyuncu değer gördükten sonra iste (ör. ilk gün
  sonu raporunda) — kabul oranı yükselir.

---

## 7. Yerel saklama & durum

- WKWebView'de `localStorage` kalıcıdır ama iOS düşük-disk temizliğinde silinebilir → kritik
  state zaten **sunucuda** (iyi). Yalnızca dil/ses gibi tercihler `@capacitor/preferences`'e
  taşınmalı (localStorage yerine, garantili kalıcılık).
- **Arka plan/ön plan:** `@capacitor/app` `appStateChange` — arka plana geçince
  `pagehide` keepalive save zaten var; ön plana dönünce WS yeniden bağlan (`connectLive`
  reconnect mantığı mevcut, doğrula).
- **cloudBlocked guard** (override koruması, `main.ts:702`) iOS'ta da kritik — dokunma.

---

## 8. Submission — App Store Connect (adım adım)

Ayrıntılı otomasyon için `.claude/skills/app-store-submission` skill'i kullanılacak. Özet:

1. **Xcode:** signing (otomatik, ekip=Hopsule Inc.), version 1.0 / build 1, capabilities
   (Push, In-App Purchase), `Info.plist` (ATT açıklaması, push arka plan modu, encryption
   exempt).
2. **İkon + launch:** 1024² App Store ikonu + tüm boyutlar; launch screen oyun arka planıyla.
3. **Ekran görüntüleri:** iPhone 6.9"/6.5" + iPad 13" zorunlu; `app-store-screenshots` skill'i
   ile TR/EN çerçeveli, lokalize (Benerits/Arrower listelerindeki stil).
4. **Metadata:** açıklama, anahtar kelimeler (TR+EN), gizlilik politikası URL'si (mevcut),
   **App Privacy** formu (topladığın veri: e-posta, oyun state — "linked to identity").
5. **IAP kalemleri:** ASC'de tanımla, review'a **build ile birlikte** gönder (yoksa reddedilir).
6. **Yaş sınırı:** 4+ muhtemel (kumar yok; "simülasyon"). Reklam varsa 12+ olabilir.
7. **TestFlight:** iç test → ekip; sonra App Review'a submit.
8. **Review notları:** demo hesap (ağ gerektiğinden test kullanıcısı ver!) + "online oyun,
   sunucu petrol.benerits.com" açıklaması. §3'teki offline davranışı reviewer'ın ilk göreceği
   şey — sağlam olmalı.

---

## 9. Port öncesi kapatılması gereken ürün açıkları (sıra önemli)

Teknik port'tan **önce/paralel** yapılması gerekenler (retention + review riski):

- [ ] **Online-only duvarı yumuşat** (§3): ilk-müşteri sandbox veya offline anlamlı ekran.
      *App Review geçişi için neredeyse zorunlu.*
- [ ] **Offline kazanç katmanını güçlendir** (2h cap → mobil beklentisi, tüm tesisler).
- [ ] **Onboarding/tutorial** (WHY-IT-WORKS §6.2) — mobilde ilk 30 sn kritik.
- [ ] **IAP ekonomisi tasarımı** (§5) — neyi satacağız, dengeyi bozmadan.
- [ ] **Push segmentleri** (§6) — hangi olay hangi bildirimi tetikler.
- [ ] Safe-area + haptics + iPad Split View testleri (§4).
- [ ] Resend Türkçe-karakterli e-posta hatası (loglarda `non-ASCII`) — kayıt akışını etkiler.

---

## 10. Önerilen sıra (özet yol haritası)

| Aşama | İş | Çıktı |
|------|-----|-------|
| 1 | Capacitor iskelet + `npx cap add ios`, boş WebView'de oyun açılır | TestFlight'a çıkan iskelet |
| 2 | Safe-area, status bar, splash, haptics, viewport | Native hisli tam-ekran |
| 3 | Online-only duvarı + offline ekran/sandbox (§3) | Review'a dayanıklı açılış |
| 4 | Push (kendi APNs topic'i) + izin akışı | Retention bildirimleri |
| 5 | IAP (RevenueCat + consumable) + sunucu doğrulama | Para kazanma |
| 6 | Görseller, metadata, App Privacy, IAP kalemleri | Submission paketi |
| 7 | TestFlight → App Review → yayın | App Store'da BenelOil |

> **Tek cümle:** Motor portu Capacitor'la birkaç günlük iş; asıl emek **online-only duvarını
> mobil/review dostu hale getirmek**, **IAP + push** eklemek ve **App Store submission**
> hijyeni. Sunucu neredeyse hiç değişmez.
