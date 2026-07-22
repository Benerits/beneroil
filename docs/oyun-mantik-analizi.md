# BenelOil — Oyun Mantık Analizi

Kod incelemesi + 101 açık oyuncu feedback'i temel alınarak hazırlandı. Amaç: mantıksız / dengesiz / tutarsız gördüğüm noktaları not bırakmak. **Not:** Bu bir analiz belgesidir — mekanik değiştiren maddeler senin onayınla ele alınmalı.

Durum etiketleri: ✅ bu turda düzeltildi · 🔧 kısmen · ⚠️ açık (öneri var)

---

## 1) Ekonomi & Denge

| # | Gözlem | Neden mantıksız | Öneri | Durum |
|---|--------|-----------------|-------|:-----:|
| 1.1 | **Fiyatın müşteriye etkisi zayıf** (feedback: fiyatı fullesem de düşürsem de fark yok) | `priceDemandFactor()` var ama trafiğe etkisi hissedilmiyor; fiyatlandırma anlamsızlaşıyor | Fiyat→gelme olasılığı eğrisini belirginleştir; ekranda "fiyat etkisi %+X trafik" göster (ofiste var, sahnede de gösterilebilir) | ⚠️ |
| 1.2 | **Pompa sayısı ↔ müşteri yoğunluğu ölçeklenmiyor** (feedback #89) | 2. pompa alınca kuyruk azalıyor ama toplam müşteri ~aynı; yatırımın getirisi belirsiz | Spawn hızını kapasiteyle (pompa+şarj) hafifçe ölçekle | ⚠️ |
| 1.3 | **Dizel oransal fazla satılıyor** (feedback #60) | Talep dağılımı benzin/dizel/lpg arasında dengesiz görünüyor | `DEMAND` yakıt-tipi olasılıklarını gözden geçir | ⚠️ |
| 1.4 | **FULLE exploit** — ₺200 isteyen müşteriyi FULLE'leyip ₺500 kazanma, itibar düşmeden | Talep-üstü gelir + ceza yok = para hilesi | Talep-üstü gelir cap'lendi; FULLE yalnız gerçekten "full" isteyende aktif | ✅ |
| 1.5 | **Pompacı ücreti tek seferlik görünüyordu** | İşçi maliyeti gerçekçi değildi (recurring olmalı) | Günlük yovmiye eklendi (₺120/₺150), her gün kasadan; kartta net yazıyor | ✅ |
| 1.6 | **Arıza + parasızlık soft-lock'u** (feedback #81, #87) | Pompa arızalanır, para yoksa tamir edilemez → oyun kilitlenir | Banka **teminatsız avans** eklendi (assetsiz de çekilebilir) — kurtarma yolu var; ek olarak arıza kendiliğinden ucuz tamir/pasif gelir düşünülebilir | 🔧 |

## 2) Mekanik tutarsızlıklar

| # | Gözlem | Öneri | Durum |
|---|--------|-------|:-----:|
| 2.1 | **Pompa kartında eski fiyat** (feedback #64, #101) — satış fiyatı değişince yansımıyordu | Kart artık `state.prices`'i gösteriyor | ✅ |
| 2.2 | **"Hoş geldin patron" takılması** (feedback #80, #82, #102) — pompacı ilk müşteriyi devralınca ipucu kalıyordu | Pompacı devralınca onboarding ipucu kapanıyor | ✅ |
| 2.3 | **Pompacı/şarjcı varken müşteri-isteği & dolum paneli açılması** (14+ feedback) | Otomasyon devredeyken panel/popup çıkmıyor, cam-sil gizli | ✅ |
| 2.4 | **Market 2 level + yeniden kurma** (feedback #111) — 2. market için eskisini yıkmak gerekiyor | Market 3 level, **yerinde** yükseltme (aynı footprint), gelir level'a göre | ⚠️ (istendi) |
| 2.5 | **İstasyon kapalıyken gün ilerliyor** (feedback #111) | Kapalıyken gün döngüsü (ve yovmiye/taksit) devam etmeli mi? En azından bilinçli tasarım kararı olmalı | ⚠️ |
| 2.6 | **Sipariş miktarı seçilemiyordu** (feedback #76, #95, #118) — büyük tankta bile sabit | Min 800L → full arası **−/+ step** eklendi | ✅ |

## 3) UX & Görünürlük

| # | Gözlem | Öneri | Durum |
|---|--------|-------|:-----:|
| 3.1 | **İndirim/kampanya belirsiz** (feedback #93, #108, #79) | Yakıt indiriminde sipariş butonunda rozet + geri sayım; kritik olaylara ayrı ses | ⚠️ |
| 3.2 | **Bildirimler ekranı kaplıyordu / kaçıyordu** (feedback #109, #116) | Toast'lar sağ-üstte kompakt kolona alındı, 2 satıra kırpılıyor | ✅ |
| 3.3 | **Molada EV'yi göndermek zordu** | Araca dokununca direkt gönderiliyor (popup yok), "GÖNDER →" ipucu | ✅ |
| 3.4 | **Tabela/lamba taşınamıyor** (feedback #68, #94) | Taşınabilir yapılar listesine eklenmeli | ⚠️ (istendi) |

## 4) Teknik & Pathfinding

| # | Gözlem | Öneri | Durum |
|---|--------|-------|:-----:|
| 4.1 | **Araçlar pompalara/birbirine takılıyor** (feedback #85, #116) | Kuyruk/rota mantığı; pompa dizilimine göre yol; çarpışma toleransı | ⚠️ |
| 4.2 | **Otoparkta hep aynı yönde park + üst üste binme** (feedback #106, #107) | Park yön/slot ataması; diklemesine park seçeneği | ⚠️ |
| 4.3 | **Karşı araziye/tarafa inşa edilemiyor** (feedback #84) | Parsel ızgarası yol karşısını buildable yapmalı | ⚠️ (istendi) |
| 4.4 | **Mobilde taşımada izdüşüm kayması** (feedback #91) | Placement raycast/grid hizası mobilde düzeltilmeli | ⚠️ |
| 4.5 | **Performans/ısınma** (feedback #105, #113, #117) — özellikle Android/Mac | Bloom yarı çöz. zaten var; ek olarak DPR clamp, gölge/segment azaltma, idle throttle | ⚠️ |
| 4.6 | **Çoklu cihaz save senkronu** (feedback: ilerleme karışıyor) | Sunucu-otoriter save + versiyon/timestamp guard (son yazan kazanır) | ⚠️ |

---

### Özet öncelik önerisi
1. **Soft-lock & ekonomi** (1.1, 1.2, 1.6) — retention'a doğrudan etki
2. **Pathfinding/park** (4.1, 4.2) — en çok tekrar eden görsel şikayet
3. **Çoklu cihaz senkron** (4.6) — ilerleme kaybı = silinen oyun hissi
4. **Market level & taşınabilir tabela** (2.4, 3.4) — istenen QoL
