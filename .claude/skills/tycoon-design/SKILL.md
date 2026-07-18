---
name: tycoon-design
description: Tycoon / işletme simülasyonu tasarım rehberi — Benzinlik oyununa yeni mekanik eklerken veya denge ayarı yaparken kullan. Progression eğrisi, retention döngüleri, ekonomi dengesi ve tür kalıpları.
---

# Tycoon / Management Sim Tasarım Rehberi

Bu oyunun türü: **tycoon (işletme simülasyonu)** + **time-management** (oyuncu servisi bizzat yapar, Diner Dash usulü) karışımı. Referanslar: Gas Station Simulator, Game Dev Tycoon, Township, Diner Dash.

## Çekirdek döngü (asla bozma)
1. Müşteri gelir → 2. Oyuncu servis yapar (beceri/dikkat) → 3. Para kazanılır → 4. Paranın harcanacağı anlamlı yükseltme olmalı → 5. Yükseltme daha çok/zengin müşteri getirir → 1'e dön.
Döngünün her halkasında oyuncunun "bir sonraki hedefi" görünür olmalı (kilitli mağaza satırları bunu sağlar — kilidin NEDENİ her zaman yazsın).

## Denge kuralları
- Yeni yatırım kendini ~3-5 dakikada amorti etmeli; geç oyun yatırımları 5-10 dakika.
- Pasif gelir (tır parkı, self yıkama) aktif gelirin %30'unu geçmesin — yoksa oyuncu servis yapmayı bırakır, tür time-management'tan idle'a kayar.
- Ceza aktif kazancın 1-2 müşterilik karşılığını geçmesin (yanlış yakıt = ~1.5 müşteri geliri). Felaketler (reaktör) hariç — onlar bilinçli kumar.
- Murphy prensibi: risk, oyuncunun tamponu azaldıkça artmalı (mevcut: para azken arıza olasılığı katlanır). Gerilim yaratır ama ölüm sarmalına sokma: aynı anda maks 2 arıza.

## Retention araçları (öncelik sırasıyla)
1. **Kayıt** — kaybolan ilerleme = silinen oyun. Her 5 sn otomatik kayıt mevcut.
2. **Gün döngüsü + günlük kâr raporu** — kısa oturum hedefi verir ("bir gün daha oynayayım").
3. **Başarımlar** — `state.ts ACHIEVEMENTS` listesine ekle; koşul `(s) => boolean`.
4. **Görünür büyüme** — her yatırım sahnede FİZİKSEL iz bırakmalı (bina, ışık, trafik artışı).
5. Eklenebilecekler: günlük hedef ("bugün ₺5.000 kazan"), rastgele olaylar (VIP müşteri, yakıt zammı), sezonluk döngü, offline kazanç (mobilde şart).

## Bu repoda mekanik ekleme kalıbı
1. `state.ts`: alan + mağaza satırı (`getShopItems`, sayısal `stat` rozeti zorunlu) + `buyItem` + `SAVE_FIELDS`.
2. `world.ts`: `buildX(pos?)` + `register(id, AD, group, labelZ)` — etiket/tıklama/uyarı otomatik gelir.
3. `main.ts`: `PLACEABLE` (yerleştirilebilirse) + `MOVE_COST` + `buildVisual` + `buyToast` + `buildingCard` + `rebuildFromState` + `FULL_ORDER`.
4. Negatif yüzü olsun: her güçlü yapının bakımı/riski/gürültüsü türün tuzudur.
5. Dengeyi değiştirince `?full=1` vitrin modunda ve temiz kayıtla ikisinde de test et.
