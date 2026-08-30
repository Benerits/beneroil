# BenelOil — Oyun & Metrik Analizi
*Rapor tarihi: 28 Temmuz 2026 · Veri kaynağı: canlı üretim veritabanı (beneloil.com)*

---

## 1. Oyun Nedir?

**BenelOil**, tarayıcıda çalışan bir **benzin istasyonu tycoon + time-management** oyunudur (Gas Station Simulator × Diner Dash karışımı). Oyuncu tek pompalı bir kasaba istasyonuyla başlar; müşterilere bizzat yakıt basar, cam siler, tank siparişi verir; kazandığıyla pompa/market/şarj/tesis kurar ve sonunda **5 farklı lokasyonda** (Kasaba, Çevre Yolu, Otoyol, Marina, Metropol) şube zinciri işletir.

**Çekirdek döngü:** Müşteri gelir → oyuncu servis yapar → para kazanılır → anlamlı yükseltme alınır → daha çok/zengin müşteri gelir.

**Öne çıkan sistemler:**
- **Çoklu şube:** her lokasyonun ayrı ekonomisi, sahne dokusu ve imza mekaniği (otoyolda rampa kapasitesi, çevre yolunda trafik ışığı, metropolde alan kıtlığı, marinada tekne/ÖTV defteri)
- **Marina:** tekneler yanaşır, yakıt gemiyle gelir, bağlama/kışlama pasif geliri, Mavi Bayrak uyum sistemi
- **Otomasyon merdiveni:** pompacı → şarjcı → müdür (kumbara + yakıt siparişi + pasif şube işletme)
- **Prestij (devir):** istasyonu devret → marka yıldızı → kalıcı gelir çarpanı
- **18 parsel arsa sistemi, banka/kredi, B2B ihaleler, AI rakip, sezonlar, başarımlar**

**Teknik:** Three.js + TypeScript (tek sayfa web), Node/Postgres backend, Capacitor iOS (TestFlight'ta; App Store incelemede). Kenney CC0 asset'leri. Monetizasyon: yalnız **opt-in rewarded reklam** (mobilde otomatik reklam yok), IAP altyapısı hazır (kapalı). TR/EN/FR dilleri.

**Yayın zaman çizelgesi:** ~18 Temmuz canlıya çıkış → 20 Temmuz viral zirve → 24 Temmuz App Store'a gönderim + AdMob → 27 Temmuz çoklu-şube büyük güncellemesi + duyuru.

---

## 2. Güncel Durum (28 Temmuz, tek bakış)

| Metrik | Değer | Not |
|---|---|---|
| Kayıtlı oyuncu | **2.042** | +~1.983 misafir → **~4.000 tekil oyuncu** |
| Google ile giriş | 442 (%22) | Apple girişi 0 — yalnız web'de olduğundan normal |
| Şu an oyunda | 35 | son 5 dk |
| **DAU** (24 saat) | **433** | kayıtlılar; misafirler hariç |
| **WAU** (7 gün) | **1.479** | kayıtlı tabanın %72'si — çok sağlıklı |
| DAU/WAU (stickiness) | **%29** | mobil oyun ortalaması ~%20; iyi |
| Kayıtlı saveli oyuncu | 1.689 | kayıt olup hiç oynamayan az |
| Feedback | 595 (422 açık) | oyuncular konuşkan — altın madeni |
| Banlı | 2 | hile vakaları (depo exploiti kapatıldı) |

---

## 3. Haftalık Trend (günlük kırılım)

| Gün | Ziyaret | Yeni Misafir* | Yeni Kayıt | Giriş | Misafir→Kayıt |
|---|---|---|---|---|---|
| 19 Tem (Cmt) | 222 | — | 138 | 35 | — |
| **20 Tem (Paz)** | **3.082** | — | **714** | 246 | — |
| 21 Tem | 1.726 | — | 343 | 146 | — |
| 22 Tem | 1.227 | — | 275 | 177 | — |
| 23 Tem | 1.485 | 708 | 192 | 256 | 100 |
| 24 Tem | 731 | 460 | 53 | 156 | 83 |
| 25 Tem | 750 | 498 | 81 | 202 | 66 |
| 26 Tem (Cmt) | 639 | 167 | 71 | 139 | 20 |
| **27 Tem (Paz)** | **1.138** | 290 | **154** | **324** | 49 |
| 28 Tem (kısmi) | 141 | 30 | 19 | 42 | 7 |

*\*Misafir sayacı 23 Temmuz'da eklendi — öncesi ölçülmedi.*

**Okuma:**
- **20 Temmuz lansman zirvesi** (714 kayıt/gün) sonrası doğal soğuma — normal viral eğrisi.
- **27 Temmuz güncelleme etkisi net:** ziyaret %78 ↑ (639→1.138), kayıt %117 ↑ (71→154), giriş **324 ile tüm zamanların rekoru** — çoklu-şube güncellemesi eski oyuncuları geri getirdi. İçerik güncellemesi = dönüş kancası tezi doğrulandı.
- Ziyaret→kayıt dönüşümü **%13-23** bandında (27 Tem: %13,5) — web oyunu için çok iyi (sektör ~%5-10).
- Misafir→kayıt dönüşümü kancaları (bonus, bulut kaydı, gün-eşiği gate) çalışıyor: misafirlerin kabaca **%15-20'si** kayda dönüyor.

---

## 4. Retention & Bağlılık

| Metrik | Değer | Yorum |
|---|---|---|
| 1+ gün önce kayıt olup son 24 saatte dönen | **304 / 1.911 = %15,9** | web oyunları için iyi (tipik %10-15) |
| 3+ gün önce kayıt olup son 24 saatte dönen | **241 / 1.745 = %13,8** | uzun vade tutunması güçlü |
| WAU / toplam kayıt | **%72** | taban henüz "ölü ağırlık" biriktirmedi |
| En yüksek oturum sayısı | 36 | süper-fan segmenti mevcut |

---

## 5. Oyuncu İlerlemesi (oyun derinliği)

| Metrik | Değer |
|---|---|
| Medyan oyun günü | **7. gün** |
| P90 oyun günü | **113. gün** |
| En ilerideki oyuncu | **1.132. gün** (!) |
| Medyan kasa | ₺5.500 |
| En zengin kasa | ₺20,7M |
| 30+ gün oynayan | **532 oyuncu (%31)** |
| 100+ gün oynayan | **208 oyuncu (%12)** |
| Müdür tutan | 161 |
| En az 1 devir yapan (prestij) | 125 |

**Okuma:** Dağılım sağlıklı bir "uzun kuyruk": oyuncuların üçte biri 30+ güne ulaşıyor — çekirdek döngü tutuyor. 208 kişilik 100+ gün segmenti, geç-oyun içeriğinin (çoklu şube, devir, ihale) asıl müşterisi; bu haftaki devir-eşiği fixi ve şube sistemi tam bu kitleye geldi.

---

## 6. Çoklu Şube Adaptasyonu (27 Tem'de çıktı — 1 günlük veri)

| Metrik | Değer |
|---|---|
| 2+ şube açan | **45 oyuncu** |
| 3 şube açan | 1 oyuncu |
| Aktif şubesi kasaba dışı olan | 15 (14 çevre yolu, 1 otoyol) |

İlk 24 saat için makul başlangıç; şube açma eşiği (₺500k+) gereği doğal olarak geç-oyun özelliği. **Önümüzdeki haftanın ana takip metriği bu tablo olmalı** — marina (₺5M) ve metropol (₺12M) açılışları geldikçe P90 segmentinin hedefi olacak.

---

## 7. Huni (Funnel) Özeti

```
Ziyaret (27 Tem: 1.138)
   └─→ Misafir başlangıç: ~%25        (290)
         └─→ Kayıt: ~%15-20           (154 yeni kayıt/gün)
               └─→ D1 dönüş: ~%16
                     └─→ 30+ gün: %31  (kayıtlı tabanda)
                           └─→ Devir/çoklu şube: %6-7
```

En zayıf halka: **ziyaret → misafir başlama** (%25). Landing/auth ekranı iyileştirmeleri (sosyal kanıt banner'ı, "18 oyuncu istasyonunu kurdu") doğru yönde; giriş ekranında oynanış videosu/canlı sahne denenebilir.

---

## 8. Operasyon Notları

- **Feedback hattı çok verimli:** 595 bildirim; bugüne kadar trafik, ekonomi, UI ve exploit fixlerinin çoğu buradan geldi. 422 açık kaydın çoğu eski/çözülmüş-ama-işaretlenmemiş — haftalık triage önerilir.
- **Anticheat:** ilk-save limiti + para sıçrama kontrolü aktif; depo exploiti (şubeler arası sipariş) 27 Tem'de kapatıldı. 2 ban.
- **iOS:** build 262082033 TestFlight'ta; App Store sürümü incelemede (reviewsız uyum çalışması tamam).
- **Bildirim stack'i:** misafir push'ları artık 10'da bir — ekip bildirimi gürültüsü düştü.

## 9. Riskler & Öneriler (önümüzdeki hafta)

1. **Soğuma eğrisini içerikle kırmak işe yarıyor** (27 Tem kanıtı) → haftada 1 görünür güncelleme + duyuru ritmi öneririm.
2. **Misafir → kayıt** dönüşümünde 26 Tem düşüşü (%12'ye) izlenmeli; gün-eşiği gate'inin agresifliği A/B'lenebilir.
3. **Şube adaptasyonu** haftalık raporun ana KPI'sı olsun: `2+ şube açan / 30+ gün oynayan` oranı (şu an 45/532 = %8,5).
4. **Ölçüm eksikleri:** oturum süresi, şube başına gelir ve reklam izlenme sayısı henüz loglanmıyor — stat_hourly'ye `ad_views` ve `session_minutes` kolonları eklemek 1 saatlik iş, monetizasyon kararlarını veriye bağlar.
5. **App Store onayı gelince** iOS lansmanı ayrı bir zirve yaratacak — push izni akışı ve "cihazlar arası senkron" mesajı hazır.

---
*Sorgular: benzinlik_player, benzinlik_stat_hourly, benzinlik_feedback (canlı DB, 28 Tem 00:xx). Misafir metrikleri localStorage-dedup'lı sayaçtır; gerçek tekil kişi sayısı bir miktar daha yüksek olabilir.*

---

## 10. Hedef Kartı (28 Tem itibarıyla)

| Metrik | Şu an | 2 Hafta | 1 Ay |
|---|---|---|---|
| Ziyaret → oyuna başlama | %25 | %35 | %45 |
| Misafir → kayıt | %15-20 | %20 | %25 |
| D1 dönüş | %16 | %19 | %22 |
| DAU / WAU | 433 / 1.479 | 500 / 1.700 | 700 / 2.500 |
| Stickiness | %29 | koru | %30+ |
| 2+ şube / 30+ gün ⭐ | %8,5 | %15 | %25 |
| Devir yapan / Müdürlü | 125 / 161 | 160 / 220 | 220 / 300 |
| Toplam kayıt | 2.042 | 2.800 | 4.000 |
| Açık feedback | 422 | <100 | <50 |

**28 Tem'de uygulanan iyileştirmeler:** A1 canlı sahneli kapı · A2 misafir birincil buton · A4 ara modal kaldırıldı · A5 yükleme maskesi · C10 seri rozeti · D11 şube hedef çubuğu · E14-15 ölçüm kolonları (gate_shown/converted, ad_views, session_minutes). Sonraki rapor bu kartın "Şu an" kolonunu güncelleyerek kıyaslamalı.
