# BenelOil Major Plan — 2026-07-25 (TARİHÎ BELGE)

> ⚠️ **BU DOSYA GÜNCEL PLAN DEĞİLDİR.** 25 Temmuz'da, 481 feedback'in kümelenmesi üzerine
> yazıldı; ertesi gün Oğuz iki kapsamlı rapor verdi ve uygulama tamamen onlara göre yürüdü.
>
> **Güncel yol haritası:** `docs/FAZ-PLANLARI.md` (rapor maddelerinin takip tablosu)
> **Kaynak raporlar:** `docs/raporlar/`
>
> Bu dosya, Faz 0-3'ün (save wipe, clamp, dönüşüm, karşı yaka, trafik) hangi kanıtla
> yapıldığını gösteren tarihî kayıt olarak duruyor.

---

Kanıta dayalı yol haritası: 481 açık feedback'in semantik kümelenmesi (`tycoon-feedback-ops`) +
`WHY-IT-WORKS.md` kayıp analizi üzerine kurulu. Her faz ilgili skill'e bağlı; bir faza başlarken
o skill'i yükle. Sıralama = frekans × etki × maliyet.

## Faz 0 — Kanama durdurma ✅ (2026-07-25'te yayınlandı)
- Save wipe zinciri kapandı (pagehide korumaları + sunucu taze-başlangıç guard'ı).
- "Para gitti ürün yok" kapandı (COST/clamp senkronu: pompa 14, EV 12, sınırsız üniteler 200, placedRects 512; garanti push).
- Misafir→kayıt teşvik paketi (₺2.500 bonus + kayıtlıya özel seri + dönüşüm anları).
- **Takip**: `guest_signups/guests` oranı (öncesi/sonrası), save-silindi şikâyetinin durması, #500/#448 tipi kayıtların yeniden açılmaması.

## Faz 1 — Şikâyet üçlüsü (quick wins, ~2-3 gün) — skill: tycoon-feedback-ops
1. **Müşteri isteği pop-up'ı** (~35 kayıt, #184 özeti: "if_pompacı_yes_müşteriisteği_no").
   Pompacılı/oto pompada popup açılmaz; manuel pompada açılır; ayarlardan "hep kapalı (araca tıklayınca aç)" tercihi. Mobilde panel küçültülüp kenara alınır.
   Kabul: pompacı çalışırken 1 dk boyunca hiç otomatik popup yok; manuel oyuncu akışı değişmedi.
2. **Çoklu tesis tek kumbara** (~13 kayıt, #462/#493/#501). `pendingCash` cap'i tesis ADETİYLE çarpılır, biriktirme hızı adede göre ölçeklenir; toplarken tek tıkla hepsi. Sunucu clamp'i `2500 × adet` (abuse tavanlı).
   Kabul: 3 self-yıkama = 1'in ~3 katı birikim; kumbara rozeti tesis başına doğru.
3. **Yakıt siparişi +/- mobil** (~7 yeni kayıt, #319/#483 + #473 kısmi teslimat). Touch hedefi büyüt, event fix, kısmi sipariş teslim miktarı doğrula (sipariş anındaki miktar teslim edilir — tank yükseltme yarışı regresyonu dahil).
4. **Arsa fiyat şeffaflığı** (~11 kayıt, #322). Parsel seçiminde gerçek fiyat onay balonunda; menüde aralık zaten var; seçim ESC/geri ile iptal edilebilir.
5. Feedback hijyeni: bu fazla kapanan kümelerdeki kayıtları resolved+not yap (panelde ~100 kayıt kapanır).

## Faz 2 — Yol karşısı istasyon overhaul (~30 kayıt) — skill: tycoon-design
- **UX**: karşı arsa satın alınınca ipucu: "İlk pompa/şarjı koy — giriş-çıkış otomatik gelir" (şu an kimse bilmiyor; ~15 kayıt sırf bu).
- **Bug'lar**: karşıda araç tıkanması (#353/#370/#399/#403), karşı çıkışın ana çıkışa dolanması (#269), karşı tesislerin gelir ayrımı (#317).
- **İçerik**: karşıya ikinci market/tuvalet/tabela kurulabilsin (#334/#422/#492) — "tek tesis tipi = tek adet" kısıtını karşı-yaka istisnasıyla esnet.
- Kabul: karşıya tam istasyon kurulup 5 dk takılmasız akış; karşı-yaka geliri ofis raporunda ayrı satır.

## Faz 3 — Trafik/pathfinding sertleştirme (~20 + otopark ~18) — skill: tycoon-design
- Pompa yanaşma/çıkış kilitleri (#324/#395/#439), yan yana pompa sıkışması (#65/#437), otopark açı/park yönü kalıntıları (#440/#469 — 883507a sonrası hâlâ).
- Yaklaşım: kümeleri ayrı ayrı değil, spot-tabanlı rezervasyon + tek yönlü iç akış şeması olarak ele al; `?full=1` vitrin modunda yoğun trafik testi.
- Kabul: 8 pompa + 8 şarj + 4 tesis yerleşiminde 10 dk gözlemde kalıcı kilitlenme 0.

## Faz 4 — Otomasyon + ekonomi derinliği — skill: tycoon-economy
- **Müdür/asistan** (~10 istek, #345/#481/#496): kumbara otomatik toplama, kademeli seviye (topla → panel temizle → tamir). Yovmiyesi pasif geliri %30 kuralına göre dengelenir.
- **Fulleme exploit'i** (#250/#292): istenen litre üstü dolum bahşiş/memnuniyet kesintisi.
- **İtibar + fiyat esnekliği** (#414/#456): tavan fiyatın trafik etkisi görünür (HUD trafik göstergesi, #79 isteği).
- **Geç oyun sink'leri**: batarya sv4 (#363), dekoratif ögeler (#216-6), oto yıkama kademeleri (#454).
- Kabul: gün-100+ oyuncu profili için para birikim eğrisi düzleşir; fulleme artık optimal strateji değil.

## Faz 5 — Endgame içerik (oyun bitti şikâyeti ~8) — skill: tycoon-design + tycoon-retention
- **Lastikçi** (3 bağımsız istek) + tamirci personeli (#398/#506).
- **Senaryo/risk olayları** (#350'de hazır liste: tanker kazası, zehirlenme, grev, vidanjör...) — Murphy prensibiyle, aynı anda maks 2.
- **Piyasa**: alış fiyatı dalgalanması + borsa-lite (#310/#409/#431) — indirim mekaniğinin genellemesi.
- **2. şehir/istasyon** (#479/#497): en büyük yapısal genişleme; prestij-reset alternatifiyle birlikte tasarlanacak (tycoon-economy sink kuralı).
- Sıralamalı sosyal katman (#16/#397): önce read-only leaderboard (istasyon adı + servet), klan sonra.

## Faz 6 — Platform & cila — skill: tycoon-retention
- **iOS lansmanı**: ORIGIN dev→prod kararı (Oğuz), TestFlight yeni build (istemci fixleri bundle'a girsin), RevenueCat env'leri, App Store v1 checklist.
- **Performans/ısınma** (#113/#117/#511): rAF bütçesi, arka plan sekmede throttle, düşük-güç modu.
- **Çeviri**: EN eksikleri (#464), FR talebi (#435 — i18n altyapısı hazır, dict eklemek yeter).
- **Güncelleme notları modali** (#465) + başarımların oyuncuya gösterimi (#367).

## Ölçüm panosu (her faz sonrası bak)
- Misafir→kayıt: `guest_signups/guests` (admin engagement).
- Kümelerin yeniden açılma hızı: fix sonrası aynı kümeden yeni feedback geliyor mu (tycoon-feedback-ops §triage-3).
- D1 dönüş: `last_seen_at` bazlı; seri bonusu değişikliğinin etkisi.
- Save bütünlüğü: gün-1'e dönme şikâyeti = 0 hedefi.
