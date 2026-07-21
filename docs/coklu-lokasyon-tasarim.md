# Çoklu Lokasyon — Tasarım (madde 12, "geçişli tam istasyon")

*Taslak · 2026-07-21. Onaydan sonra fazlı kurulacak.*

## Hedef
Oyuncu birden fazla **tam oynanır** istasyona sahip olur, aralarında **geçiş** yapar (sahne yeniden kurulur). Bir lokasyona **müdür** atanırsa, sen başka lokasyondayken o istasyon **pasif** gelir üretir (müdür maaşı düşülür). Müdür yoksa lokasyon sen oradayken çalışır, yokken duraklar.

## Mimari (mevcut kodu maksimum yeniden kullan)
Her lokasyon = **tam bağımsız bir `GameState` + yerleşim** (placedPos/Rot/Rects). Bu, tüm mevcut tek-istasyon mantığını (satış, tank, arıza, kumbara, banka...) lokasyon başına aynen kullanır → en az invaziv yol.

- **Save şeması:** `save = { locations: [{ s, placedPos, placedRot, placedRects, mgr }], active: 0, at }`
  - Geriye dönük göç: eski tek save → `locations[0]` (otomatik, kayıpsız).
  - `mgr = { hired: bool, sinceDay, lastSettleAt }` (müdür durumu + pasif hesap için).
- **Geçiş:** aktif lokasyonun state'ini serialize et → hedefi hydrate et → `rebuildFromState()` (zaten var) sahneyi yeniden kurar. Cars/tankers sıfırlanır.
- **Yeni lokasyon:** sabit maliyetle satın alınır (kasadan), boş istasyon olarak başlar (yeni hesap gibi). Kademeli fiyat: 2. lokasyon ₺X, 3. daha pahalı.
- **Müdür pasif geliri:** sen away'ken geçen süreye göre, o lokasyonun *son dönem günlük net kârının* bir oranı (ör. %60, "müdür verimi") kadar birikir; müdür yovmiyesi düşülür. Dönüşte "settle" edilir (offline kazanç). Aktif servis kadar kârlı OLMAMALI (tycoon kuralı: pasif < aktif) — böylece oyuncu yine de bizzat oynamak ister.
- **Server:** `sanitizeSave` her lokasyonun `s`'ini ayrı ayrı clamp'ler; lokasyon sayısı tavanı (ör. 4) + müdür pasifi için hız-freni.

## Fazlar
1. **Save göçü + veri katmanı:** locations dizisi, aktif index, migrate, server sanitize (görünür değişiklik yok — güvenli temel).
2. **Geçiş UI + sahne:** "Lokasyonlar" paneli (liste + geç + yeni al), rebuild.
3. **Müdür + pasif gelir:** müdür ata/kaldır, offline settle, muhasebeye yansıt.
4. **Cila:** lokasyon adları, HUD'da aktif lokasyon rozeti, bildirim ("müdürlü şube ₺X kazandı").

## Açık karar (senden)
**Para modeli** — mimarinin temelini bu belirliyor:
- **A) Ortak şirket kasası:** tek cüzdan, tüm lokasyonlar aynı paradan harcar/kazanır. "Holding" hissi, lokasyonlar arası yatırım kolay. (state'ten money'i ayırmak gerektiği için orta refactor.)
- **B) Lokasyon başına ayrı kasa:** her istasyonun kendi parası; müdürlü şube kendi kasasına biriktirir. Mevcut koda **en yakın** (money zaten state'te), en hızlı. Ama lokasyonlar arası para aktarımı ayrı bir mekanik ister.
