# BenelOil — Oyun Mantığı & Denge Analizi (Notlar)

*Tarih: 2026-07-21 · Kod-doğrulamalı (dosya:satır referanslı). Sıralama: kritik → denge → mantık/UX → minör.*

Bu bir "yapılacaklar" değil, gözlem/not dosyasıdır. Her madde bir **mantıksızlık ya da denge riski** + öneri içerir.

---

## 🔴 KRİTİK

### 1. ₺2.000.000 para tavanı üst oyuncuları cezalandırıyor
Sunucu `sanitizeSave` parayı **2M'ye clamp'liyor** (`server/index.js:260` — `clamp(s.money, 0, 2_000_000)`). Ama prod istatistiğine göre **en zengin oyuncu ₺1.985.633** — tavana çarpmak üzere. ₺2M'yi geçen *legit* bir oyuncu, çoklu-cihaz senkronunda parasının üstünü **kaybeder** (tıpkı bugün düzelttiğimiz tank/market clamp'i gibi).
**Öneri:** Tavanı dinamikleştir (ör. `max(2M, varlıkDeğeri × 3)`) veya sabit tavanı çok yükselt (ör. 100M). Günlük kazanç hız-freni (`allowance = 50.000 + 600×sn`) zaten hile koruması sağlıyor; sabit toplam tavana gerek yok.

---

## 🟡 DENGE

### 2. Fiyatlandırma kararı neredeyse tek-cevaplı (optimal fiyat ≈ tavan)
`priceDemandFactor` (`state.ts:380-388`) kârı `m × (1.3 − 0.3m)` yapıyor (m = normalize marj). Bu parabolün tepesi **m ≈ 2.17**, ki fiyat tavanı `maliyet × 2.2` ile neredeyse aynı noktada (`priceBounds`, `state.ts:11-13`). Yani matematiksel olarak **her akıllı oyuncu fiyatı tavana yakın tutar** — "fiyatlandırma" anlamlı bir karar olmaktan çıkıyor.
- Örnek (benzin): tavan ₺14,3 → marj ×2,23, talep ×0,64 → net **×1,43** kâr (varsayılana göre). Orta fiyat asla optimal değil.
**Öneri:** Talep cezasını sertleştir (`0.3` katsayısını ~`0.5`'e çıkar) ki orta fiyatlar da yarışsın; ya da yüksek fiyatın **itibarı/uzun-vade müşteri sadakatini** düşürmesini ekle (kısa vade kâr ↔ uzun vade hacim gerilimi).

### 3. LPG yatırımı zayıf ROI
Marjlar: benzin **₺3,5/L**, dizel **₺3**, LPG **₺2** (`FUEL_PRICE`/`FUEL_COST`, `state.ts:5-7`). LPG tankı/pompası benzinle aynı maliyette ama %43 daha düşük marj. Talep segmenti ayrışmıyorsa LPG'ye yatırım rasyonel değil.
**Öneri:** LPG'ye ayrı/daha yüksek talep (LPG'li araç oranı) ver ya da tank maliyetini düşür — böylece "hangi yakıt?" gerçek bir seçim olur.

### 4. Pasif gelir yığılması oyunu idle'a kaydırabilir
Tek tesis dengeli: tır parkı **₺90-160 / ~45sn ≈ ₺2-3,5/sn** (`main.ts:2507`), aktif servisin ~%20'si — `tycoon-design` kuralına uygun. **AMA** tır parkı + market + kafe + restoran + self-yıkama + otopark kumbaralarını (`addPending`/`pendingCash`, `state.ts:520-540`) üst üste koyunca toplam pasif, aktif servis gelirini geçebilir → oyun time-management'tan **idle'a** kayar (türün tuzu kaçar).
**Öneri:** Toplam pasif geliri aktifin ~%30'una yumuşak-çapala, ya da kumbara cap'lerini (`pendingCash` cap) düşür ki oyuncu toplamak için etkileşimde kalsın.

---

## 🟠 MANTIK / UX

### 5. Gece tamamen kozmetik
`nightFactor` (`main.ts:2852-2857`) yalnız ışıklandırmayı besliyor (`world.setNight`, `main.ts:2869`); müşteri gelişini/geliri **etkilemiyor** (`entryChance`, `state.ts:390-392` gece kullanmıyor). Bug değil ama bir mekanik fırsatı kaçırılmış.
**Öneri (opsiyonel):** Gece "az müşteri + yüksek marj kabulü" ya da "gece zammı" → gün döngüsüne oynanış anlamı katar.

### 6. Yovmiye sabit, gelirden bağımsız — amortisman görünmüyor
Pompacı **₺120/gün** her koşulda (`POMPACI_WAGE`, `state.ts:42`; `dailyWages`, `state.ts:456`). Erken oyunda bir günün fuel marjı < ₺120 olabilir → pompacı **net zarar**. Gating doğru ama oyuncuya "bu pompacı kendini çıkarıyor mu?" görünürlüğü yok.
**Öneri:** İşe-alma kartında (`main.ts:2326`) "beklenen günlük katkı ≈ ₺X" göster; erken oyuncu bilinçli karar versin.

### 7. Kredi + ortaklık + Murphy = ekonomik ölüm sarmalı riski
Teminatsız avans ödenmezse banka **günlük kârın %25'ine kalıcı ortak** olur (`PARTNER_SHARE=0.25`, `state.ts:19`; `applyPartnerCut`). Ayrıca para azken **arıza stresi artıyor** (Murphy — `state.ts:356-362`, `stress` düşük kasada yükselir). İkisi aynı anda tetiklenince kasa toparlanamayabilir. Max 2 eşzamanlı arıza kilidi var (`state.ts:359-360`) ama **ekonomik** sarmal için koruma yok.
**Öneri:** Ortak payını borç azaldıkça azalt (lineer) ya da "min-kasa koruması" (kasa < X iken faiz/ortak kesintisi ertelenir).

---

## ⚪ MİNÖR

### 8. Reaktör (SMR) ROI belirsiz
SMR **₺40.000** + uranyum **₺2.500 / ~5dk** (`URANIUM_COST`, `URANIUM_DRAIN_PER_S`, `state.ts:94-96`) + aşınma arızaları (`state.ts:314`). Getiri **+15 kWh/sn** (`state.ts:258,649`) yalnızca **EV şarj talebi varsa** değerli. EV talebi düşük istasyonda ₺40k asla amorti olmaz — "bilinçli kumar" olsa da net ROI oyuncuya görünmüyor.
**Öneri:** SMR fazlasını şebekeye sat (pasif ₺) ya da kartta "mevcut EV talebinle geri ödeme ≈ N gün" göster.

### 9. Başlangıç tankları çok düşük
Açılış: benzin **250L**, dizel 150, LPG 100 (`state.ts:107`). ~%3,5 marjla ve ortalama ~40L/müşteri ile ilk siparişe kadar birkaç müşteride biter. Kasıtlı "ilk tanker öğreticisi" ise OK; değilse yeni oyuncu erken "boş tank" duvarına çarpar.
**Öneri:** Ya biraz yükselt (ör. 400L) ya da ilk açılışta bir onboarding ipucu ("Tankın bitiyor — Sipariş ver!") garanti tetikle.

---

## 🔒 Ek güvenlik notu (ayrı iş — madde 7)
`/api/iap` App Store **makbuzunu doğrulamadan** client `productId`'sine güvenip para/no-ads veriyor (`server/index.js` IAP handler, kod içi `TODO`). Düzenli save money-cap'i sağlam ama IAP bu cap'i bypass ediyor → **prod'da bedava coin exploit** vektörü. Prod'a çıkmadan App Store Server API ile makbuz doğrulaması şart.

---

### Bugün düzeltilen (bu analizin tetiklediği)
- ✅ Tank 5000L clamp → gerçek kapasite (tankLevel × tankCounts, 20.000L'ye kadar)
- ✅ marketLevel 2→3 clamp (Sv.3 market senkronda geri düşmüyor)
- ✅ Dashboard/full-mod tank göstergesi çoklu-tank kapasitesini doğru gösteriyor
