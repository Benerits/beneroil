---
name: tycoon-economy
description: Benzinlik ekonomi dengesi — para muslukları/giderleri haritası, amortisman kuralları, exploit kontrol listesi ve anti-cheat senkron kuralı. Fiyat/maliyet/gelir değişikliği yaparken veya yeni gelir kaynağı eklerken kullan.
---

# Tycoon Ekonomi Dengesi (Benzinlik)

## Para muslukları (faucet) ve giderler (sink) — mevcut harita
- **Aktif gelir**: yakıt satışı (marj benzin 3.5 / dizel 3.0 / lpg 2.0 ₺/L), bahşiş %10 (cam silinince %20), EV şarj (kWh × elecPrice − 3.5 ₺/kWh şebeke; solar/SMR bedava).
- **Pasif gelir (kumbara/pendingCash)**: market, tır parkı, self yıkama, oto yıkama, hava-su, kahveci, restoran. Kumbara cap'i tesis gelişmişliğiyle 1800'e kadar (sunucu clamp 2500).
- **Giderler**: yakıt alımı (FUEL_COST), yovmiye (pompacı/şarjcı), tamirler (pompa 800 / şarj 1000 / SMR bakım 1500 / panel 300), kredi taksidi, banka ortaklık payı.
- **Tek seferlik sink'ler**: tüm inşaat tabloları `state.ts` (PUMP_COSTS 14 kademe, EV_COSTS 12, arsa 6k-28k dinamik).

## Denge kuralları
- Yeni yatırım erken oyunda ~3-5 dk, geç oyunda 5-10 dk içinde kendini amorti etmeli (gün = 160 sn).
- Pasif gelir aktif gelirin %30'unu geçmesin — geçerse tür idle'a kayar, servis oynanışı ölür.
- **Geç oyun para fazlası bilinen sorun** (feedback: "milyonlarca para var, harcayacak yer yok"). Yeni içerik eklerken önce SINK ekle: artan-maliyet eğrileri, bakım kalemleri, prestij-reset, lüks/dekoratif harcamalar.
- Ceza tek hatada 1-2 müşteri gelirini geçmesin; felaketler (reaktör) bilinçli kumar — ama artık TAM WIPE YOK (yarı kasa + itibar).

## Exploit kontrol listesi (her ekonomi değişikliğinde bak)
1. **Fulleme exploit'i (AÇIK)**: müşteri 200₺ istese de FULL basınca ceza yok, tam para + memnuniyet. İstenen litreyi aşan dolum bahşişi kesmeli/memnuniyeti düşürmeli.
2. **İtibar tabanı**: itibar 5.0'a çıkıp hiç düşmüyor şikâyeti var — addRep akışını yeni mekaniklerde test et.
3. **Fiyat esnekliği**: tavan fiyat = daha çok kâr, müşteri kaybı hissedilmiyor. entryChance'e fiyat etkisini görünür yap (trafik göstergesi).
4. **Sipariş yarışları**: yakıt siparişi + tank yükseltme sırası (sipariş verip depoyu büyütünce bedava fulleme) — geçmişte iki kez fixlendi, regresyon testi yap.

## ⚠️ Anti-cheat senkron KURALI (ihlali oyuncu parası yakar)
`server/index.js` içindeki `COST`/`FLAT` tabloları ve `sanitizeSave` clamp'leri `state.ts` maliyet/maks değerleriyle **BİREBİR** kalmak zorunda. Uyumsuzluk şunu üretir: oyuncu ünite alır → sunucu save'de kırpar → "param gitti, ürün yok" (2026-07-25'te pompa 8→14 / EV 8→12 vakası, ~11 feedback). `state.ts`'te MAX/COST değiştiren HER PR sunucu tablolarını da güncellemeli. "Sınırsız" ürünlerin sunucu clamp'i 200.
