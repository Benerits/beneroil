# BenelOil — Yol Haritası ve Rapor Takip Tablosu

> **TEK KAYNAK: `docs/raporlar/` altındaki iki rapor.** Bu dosya onların uygulama durumunu
> izler; kendi başına bir plan DEĞİLDİR.
>
> - `raporlar/beneloil-trafik-ve-karsi-istasyon-cozum-raporu.md` (26 Tem 2026)
> - `raporlar/beneloil-lategame-ekonomi-raporu.md` (26 Tem 2026)
>
> **Tarihçe:** Bu dosyanın ilk hali (25 Tem) raporlar gelmeden önce, 481 feedback'in
> kümelenmesi + `WHY-IT-WORKS.md` üzerine yazılmış "Faz 0-6" planıydı. Raporlar geldikten
> sonra uygulama tamamen rapor maddelerine göre yürüdü; bu sürüm o eski fazları bırakıp
> rapor maddeleriyle birebir eşleşen bir takip tablosuna dönüştü. (Eski faz numaralarının
> karşılığı en altta.)
>
> **Çalışma kuralları:** değişiklikler önce `dev` (petrol-dev) — prod'a alma yalnız Oğuz
> isteyince · SQL'de oyuncu save'ine dokunma yok · save formatı yalnız additive ·
> `state.ts` maliyet/limit değişince `server/index.js` COST/clamp senkronu şart.
>
> **Testler:** `npm run test:all` →
> faz-checks (345) · marina (69) · rival (41) · wealth-check (17) · news (11) ·
> metrics (11) · sim-smoke · traffic-load (A/B + T4/T5 otoyol).
> Ayrıca `npm run bench:collision` — çarpışma taramasının eski/yeni kıyası.

---

## 1. Trafik raporu — madde takibi

| # | Madde | Durum | Nerede |
|---|---|---|---|
| B1 | Karşı pompa/şarj çarpışma kutusu 3.6 birim kayık (hayalet duvar) | ✅ **prod** | `world.pumpBase/evBase` + `unitRect()` |
| B2 | Çıkışta yol verme yalnız near koordinatında | ✅ **prod** | `cars.ts` merge-yield, `geom()` tabanlı |
| B3 | `rerouteForGates` karşı yakayı atlıyor | ✅ **prod** | depth tabanlı, ünite taşımada da çağrılıyor |
| B4 | Otopark indeks kayması | ✅ **prod** | kararlı kimlik `parking#N:i` + `parkId` |
| B7 | Çarpışma kutuları rotasyonu yok sayıyor | ✅ **prod** | `unitRect()` en-boy takası |
| 3.1 | Buharlaşma telemetrisi | ✅ **prod** | `evapStats` |
| 3.2 | `atEntry` eşiği near sabiti | ✅ **prod** | depth tabanlı |
| §5 | **Rezervasyon tabanlı mimari** | ✅ **prod** + açlık fixi **dev** | `src/traffic-graph.ts` — A/B: buharlaşma %76↓ |
| §6.3 | Yaka simetrisi regresyon testi | ✅ | faz-checks §4/§14 |
| B5 | Bekleme noktaları sabit dünya koordinatı | ✅ **dev** | kapı-göreli `waitSpotAt()` |
| B6 | Tır parkı yalnız near yakada | ✅ **dev** | yaka-duyarlı |
| B8 | Yaka başına tesis nüshaları | ✅ **dev** | market2/toilet2/wash2/oil2/coffee2/restaurant2 |
| 3.3 | O(n²) çarpışma → uniform grid | ✅ **dev** | 25 araçta 2.8× hızlı, ayırma 600→0 |
| 3.4 | Kapı ayrım kısıtı | ✅ **dev** | — |
| 3.5 | İç koridor rezervasyonu | ✅ **dev** | — |
| §6.1 | `?traffic=1` debug overlay | ✅ **dev** | `src/traffic-debug.ts` |

## 2. Ekonomi raporu — madde takibi

| Katman | Madde | Durum | Nerede |
|---|---|---|---|
| 1a | `entryChance` yumuşak tavan (Kusur #1) | ✅ **prod** | asimptotik 0.95 |
| 1b | Trafik arzı gelişmişliğe bağlı (Kusur #2) | ✅ **prod** | `trafficPull()` |
| 1c | Müşteri segmentleri — ₺/müşteri ekseni | ✅ **prod** | premium/filo/otobüs, ₺233→₺1.076 |
| 2a | Varlığa bağlı OPEX | ✅ **prod** | 10 günlük rampa |
| 2b | Reklam/pazarlama bütçesi sink'i | ✅ **prod** | ₺0-8.000/gün |
| 2b | Ruhsat, sigorta, personel eğitimi, dekorasyon, ekipman yaşlanması | ✅ **dev** | — |
| 2c | Her yapı için yıkma/satma | ✅ **dev** | herhangi bir örnek satılabilir |
| 3a | Ortak şirket kasası + şube bazlı P&L | ✅ **dev** | `locSnapshots`, `switchLoc()` |
| 3b | Prestij "Devret" | ✅ **prod** | marka yıldızı, eşik ikiye katlanır |
| 3c | Şehir katmanı (5 lokasyon) | ✅ **5/5 dev** | kasaba · çevre yolu · otoyol · **marina** · **metropol** |
| 4a | B2B sözleşmeler | ✅ **prod** | 5 şablon, kapasite şartı |
| 4b | Piyasa dalgalanması | ✅ **dev** | günlük ±%15, 7 günlük tahmin |
| 4c | Leaderboard + sezon | ✅ **dev** | `/api/leaderboard` + 4 mevsim döngüsü |
| 4d | AI rakip istasyon | ✅ **dev** | `src/rival.ts` — pazar payı + 3 denge valfi |
| §6.1 | `LocationTheme` altyapısı | ✅ **prod** | `src/themes.ts` |
| §6.2 | Kasaba — "müdavim müşteri" mekaniği | ✅ **dev** | fiyata duyarsız sadık taban |
| §6.3 | **Çevre Yolu** (ışık penceresi + yaya müşteri) | ✅ **dev** | — |
| §6.4 | **Otoyol** (ramp/merge + kaçan müşteri) | ✅ **dev** | — |
| §6.5 | **Marina** | ✅ **dev** | `src/marina.ts` — segmentler, ÖTV defteri, bağlama, Mavi Bayrak |
| §6.6 | Metropol | ✅ **dev** | alan kıtlığı (6 parsel, 3.2× fiyat) + gökdelen silueti |
| §7 #5 | **Müdür/asistan otomasyonu** | ✅ **dev** | 3 kademe |
| §7 #7 | Personel derinliği | ✅ **dev** | 4 kademe eğitim |
| §9 | Ölçüm planı | ✅ **dev** | `/api/metrics` — doygunluk, nakit/varlık, D1/D7/D30 |

## 3. Raporlarda olmayan, feedback'ten gelenler

| Madde | Durum | Nerede |
|---|---|---|
| Restoran/kafe ciro 0 (#193) · market kasaya eklemiyor (#423) | ✅ **dev** | kumbara taşması sessizce siliniyordu — %40 verimle devam + kayıp raporu |
| Haciz sonrası işlevsiz bina (#495) | ✅ **dev** | haciz artık satışla aynı yoldan geçiyor |
| Pompacı cam silmiyor (#451) | ✅ **dev** | her araçta siler; şarj görevlisi de |
| İtibar 5.0'da yapışıyor (#456, #216-4) | ✅ **dev** | günlük hizmet kalitesine mutabakat |
| 7 günlük kâr grafiği + yaka gelir ayrımı (#317) | ✅ **dev** | ofis paneli |
| Sokak lambası geri konamıyor (#358, #679-1, #835) | ✅ **dev** | satın alınabilir/taşınabilir obje |
| "Yenilikler" modali (#465) + bildirim geçmişi | ✅ **dev** | `src/news.ts` |
| EN eksik çeviriler (#464) · FR (#435) | ✅ **dev** | +67 EN anahtarı, 835 anahtarlık FR |
| Perf: mobil ısınma (#113/#117/#511) | ✅ **dev** | uniform grid + InstancedMesh |

## 4. Operasyonel (kod dışı)

| İş | Durum |
|---|---|
| iOS build + `native-shim.js` ORIGIN kararı (dev→prod) | ⬜ Oğuz kararı — bugünkü hiçbir fix TestFlight'ta yok |
| Dokploy API key rotasyonu | ⬜ |
| GitHub Support: eski commit cache'inden SQL dump temizliği | ⬜ |
| Dev'deki 3 paketin prod'a alınması | ⬜ Oğuz onayı |
| Prod'a çıkan fixlerin feedback'te kapatılması | ⬜ |

---

### Eski faz numaralarının karşılığı (25 Tem sürümü)
Faz 0-3 = save/clamp/şikâyet/karşı-yaka paketleri (hepsi prod) · Faz 4 ≈ ekonomi
Katman 1-2 + müdür · Faz 5 ≈ Katman 4 + lokasyonlar · Faz 6 = platform/cila.

---

## 5. Durum özeti (26 Tem 2026)

**Her iki rapordaki KOD maddelerinin tamamı `dev` üzerinde uygulandı ve testle kilitlendi.**
Prod'a alma bekliyor (Oğuz kararı). Açık kalan tek başlık §4 operasyonel işler.

Yeni test dosyaları: `marina-check` · `rival-check` · `news-check` · `metrics-check` ·
`collision-bench`. Toplam otomatik doğrulama: **494 assertion + A/B yük testi**.
