# BenelOil — Kalan Faz Planları (2026-07-25 itibarıyla)

> Ana yol haritası: `MAJOR-PLAN.md`. Bu dosya KALAN fazların uygulanabilir detay planı.
> Çalışma kuralları: değişiklik önce `dev` (petrol-dev), prod'a Oğuz onayıyla · SQL'de
> oyuncu save'ine dokunma YOK · save formatı yalnız additive · `state.ts` maliyet/limit
> değişince `server/index.js` COST/clamp senkronu ŞART (tycoon-economy skill'i).

## Tamamlananlar (özet)
- **Faz 0-3 ✅ PROD'da** (25 Tem): save-wipe + clamp fixleri, dönüşüm paketi, şikâyet
  üçlüsü, karşı-yaka istasyon + Karşı Market, trafik rahatlaması (banket kuyruğu, tabela,
  otopark tahliyesi), rezerv görselleştirme. Feedback: 515 → ~340 açık.

---

## Faz 4 — Otomasyon + Ekonomi Derinliği (~1 gün, skill: tycoon-economy)

### 4.1 Müdür/Asistan (en çok istenen QoL, ~10 kayıt: #345 #481 #496 #351 #358 #368)
- Yeni tesis "Yönetici Ofisi" personeli: **Müdür** — kademeli (Sv.1-3):
  Sv.1 kumbara otomatik toplama (60 sn'de bir) · Sv.2 + panel temizliği · Sv.3 + arıza tamiri.
- Yovmiye: pasif gelir %30 kuralına göre dengele (Sv.1 ~₺400/gün, Sv.3 ~₺1.200/gün).
- Save: `managerLevel` (additive). Sunucu: COST tablosuna müdür kademe maliyetleri.
- Kabul: müdürlü oyuncu 10 dk hiç tıklamadan kumbara kaybetmiyor; müdürsüz oyuncunun
  geliri değişmiyor (nötr).

### 4.2 İtibar + fiyat esnekliği görünürlüğü (#414 #456 #124 #290 #143)
- İtibar 5.0'da yapışıp kalıyor → addRep kaynakları denetle; tavan fiyatta memnuniyet
  düşüşü ekle (fiyat oranı entryChance'e ZATEN etkiyorsa oyuncuya GÖSTER).
- HUD'a trafik göstergesi (#79 isteği): mevcut entryChance'i %'lik "müşteri akışı" chip'i.
- elecPrice müşteri etkisi (#143 #290): EV entryChance'ine elektrik fiyat oranını bağla.
- Kabul: fiyatı tavana çeken oyuncu trafik chip'inin düştüğünü GÖRÜYOR.

### 4.3 Tekil ekonomi bug'ları
- Restoran/kafe "Bugünkü ciro 0" (#193): facDaily key uyuşmazlığı kontrolü.
- Market alışverişi kasaya eklenmiyor iddiası (#423): kumbara vs kasa karışıklığı —
  muhtemelen UX (kumbarada birikiyor); kartta "kumbarada" ibaresini netleştir.
- Haciz sonrası bina görünüyor ama çalışmıyor (#495): seizeCollateral görsel kaldırma.
- Pompacı cam silmiyor (#451): attendant akışında cam-silme rastgeleliği (bahşiş %20 şansı).
- Karşı yaka gelir ayrımı raporu (#317): ofis panelinde near/far satırları.

### 4.4 Raporlama (#430 #480 #245 #384)
- Gün sonu özet modali: tesis bazlı gelir dökümü + kâr/zarar sade tablo.
- Ofis panelinde son 7 gün kâr grafiği (basit sparkline).

---

## Faz 5 — Endgame İçerik (~2-3 gün, skill: tycoon-design + tycoon-economy)

> Sorun: "oyun bitti, para var harcayacak yer yok" (~8 kayıt: #420 #422 #497 #503 #512).
> Kural: her yeni gelir kaynağının yanına SINK koy (bakım/riziko/artan maliyet).

### 5.1 Lastikçi (3 bağımsız istek: #376 #377 #496)
- vehicleServices kalıbında yeni tesis (yağ değişimi klonu): ₺120-200/servis, %10 kullanım.
- Kademe: Sv.1 tamir → Sv.2 + satış → Sv.3 + balans (gelir artar, yovmiye ekle).

### 5.2 Senaryo/risk olayları (#350'de hazır liste, #328 #152)
- Olay motoru: gün başında zar — tanker kazası (yakıt gelmez, iade), lavabo tıkanması
  (vidanjör ₺), pompacı grevi (1 gün otomasyon kapalı), müfettiş denetimi (temiz istasyona
  bonus itibar). Murphy kuralı: aynı anda maks 1 olay, para tamponuna göre tartılı.
- Kabul: olaylar gün geliri ±%15 bandında kalır; grace (gün 1-2) muaf.

### 5.3 Piyasa dalgalanması / borsa-lite (#310 #409 #431)
- FUEL_COST günlük ±%15 salınım (haber toast'u: "OPEC toplantısı — mazot ucuzladı").
- İleri seviye: vadeli alım (3 gün sonrası için bugünden fiyat kilitle) — tek buton.
- Sunucu senkronu: anti-cheat servet tavanı fiyat salınımını hesaba katmalı (allowance payı).

### 5.4 İkinci şehir / prestij (#479 #274 #497)
- Tasarım kararı gerekli (Oğuz): (A) prestij-reset — istasyonu "sat", kalıcı çarpanla
  yeniden başla (ucuz, hızlı) vs (B) gerçek 2. harita (pahalı, büyük).
- Öneri: önce (A) — endgame parası için dev sink + tekrar oynanabilirlik.

### 5.5 Sosyal (#16 #397 #70 #361)
- Read-only leaderboard: istasyon adı + servet + gün (sunucuda mevcut save verisinden,
  yeni tablo gerekmez). Oyun içi "Sıralama" sekmesi.
- Klan/ittifak: v2'ye ertele (sunucu yükü + moderasyon maliyeti).

---

## Faz 6 — Platform & Cila (~1 gün + App Store süreci, skill: tycoon-retention)

### 6.1 iOS lansmanı (EN KRİTİK — bugünkü fixlerin hiçbiri iOS'ta yok)
1. `beneloil-ios/scripts/native-shim.js` ORIGIN kararı: petrol-dev → petrol.benerits.com (Oğuz onayı).
2. CI tetikle (`build-testflight.yml`) → yeni bundle TestFlight'a.
3. RevenueCat env'leri prod'a (`REVENUECAT_SECRET_KEY` fail-closed doğrulama hazır).
4. App Store v1 checklist: `docs/ios-cikis-analizi.md` + reklamsız v1 kararı.

### 6.2 Performans/ısınma (#113 #117 #511 #105)
- rAF bütçesi: arka plan sekmede render durdur (ses de sussun — #325 bug'ı birlikte çözülür).
- Düşük güç modu: gölge/bloom kapat toggle'ı (Ayarlar).
- Kabul: iPhone'da 10 dk oyunda ısınma şikâyeti smoke-test ile makul.

### 6.3 Oyun içi güncelleme notları (#465 #264)
- Ayarlar'a "Yenilikler" modali: sürüm başlıkları elle `CHANGELOG.md`'den (build'e gömülü).
- Yeni sürümde bir kez rozet göster.

### 6.4 Çeviri tamamlama (#464 #435)
- EN eksikleri: i18n dict taraması (t() çağrısı olup dict'te olmayanlar) — script yaz.
- FR: i18n altyapısı hazır; dict çevirisi + dil seçici 3. buton.

---

## Sıralama önerisi
1. **Faz 6.1 iOS** (öne çekilebilir — oyuncu tabanının fixleri alması her şeyden değerli)
2. Faz 4 (otomasyon en çok istenen; müdür = tık angaryasının sonu)
3. Faz 5 (içerik — retention'ın uzun vadeli bacağı)
4. Faz 6 kalanı (cila)
