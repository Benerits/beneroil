# BenelOil — Değişiklik Günlüğü

## 16 Ağustos 2026 — Büyük Feedback Paketi
770 açık oyuncu feedback'i tek tek okundu, anlamca gruplandı ve en çok istenenler bu pakette çözüldü.

### Yeni / Düzeltilen
- **Molacı otomasyonu** (25 şikayet): EV şarjı bitince üniteyi işgal eden "molacı" araçları artık şarjcı personel 8 saniyede, Sv.3 müdür 25 saniyede otomatik uğurluyor. Elle gönderme duruyor.
- **Marina kayıt kaybı** (7 rapor, para kaybettiren en kritik bug): sunucu, marinanın "yakıt başına 8 tank + 3× kapasite" kuralını tanımıyor, her kayıtta yükseltmeleri ve depodaki yakıtı siliyordu. Aktif kayıt + şube anlık görüntüleri artık tema farkındalıklı doğrulanıyor.
- **Yakıt sipariş ekranı** (10 istek): litre artık elle yazılabiliyor, **MAX** butonu depoyu tek tıkla fulleyecek miktarı seçiyor; −/+ 200L adımlama duruyor.
- **Güneş paneli dengesi** (18 şikayet + GES uzmanı onayı): kirlenme hızı 3 kat yavaşlatıldı. (Sv.2+ müdür %35 üstü kiri zaten otomatik temizliyordu.)
- **Batarya Sv.4+ göstergesi**: "undefined kWh/sn" düzeltildi — gerçek akış hızı gösteriliyor.
- **Etkinlik jingle'ı**: yakıt indirimi / müşteri patlaması rozeti açılırken diğer bildirimlerden ayrışan özel bir ses çalıyor (rozet + geri sayım zaten vardı).
- **Karşı Tır Parkı**: tek kurulumlu tesislerin karşı yaka seti tamamlandı (Karşı Market/Tuvalet/Oto Yıkama/Yağ Değişimi/Kahveci/Restoran zaten vardı).
- **Trafik**: engelin etrafından dolanma manevrasına geniş yarıçap (3.6 birim) eklendi — arka sıradaki pompaya erişememe vakaları azalır. (Denenen "kurtarma hayaleti" yaklaşımı yük testinde servisi düşürdüğü için bilinçli olarak alınmadı; yük testi: 361+30+19+82 assertion yeşil.)
- **Teşhis**: "tesislerim yok oldu" raporları için sunucuya bina-değeri düşüş denetim kaydı eklendi (bval-drop) — kök neden gerçek trafikte yakalanacak.

### Güvenlik
- DevTools para enjeksiyonu raporu (feedback #875) doğrulandı: sunucu tarafı servet-bazlı jeton kovası enjeksiyonu zaten kırpıyor; eski dönemden kalan bir hileli bakiye (70M) elle düzeltildi. XSS denemeleri (#712/713) panelde etkisiz (React escape) — doğrulandı.

### Doğrulanan (değişiklik gerekmedi)
- Betonlanan arsalarda dekor temizliği üç şubede ekran görüntüsüyle test edildi — kural çalışıyor.
- Müdür Sv.1'den itibaren 45 sn'de bir tüm kumbaraları topluyor (en çok istenen özellik zaten oyundaydı).

## 15 Ağustos 2026
- **Sekme arka plan fixi** (13 şikayet): başka sekmeye geçip dönünce geçen süre artık pasif kazanca dönüyor (kumbara + idle tesis geliri + pompacı yakıt satışı; 90 sn eşik, 2 saat tavan). Açılıştaki offline formülüyle tek kaynaktan çalışıyor.
