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
> **Testler:** `npm run test:all` → faz-checks (200) · wealth-check (8) · sim-smoke ·
> traffic-load (A/B + T4/T5 otoyol).

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
| §5 | **Rezervasyon tabanlı mimari** | ✅ **prod** | `src/traffic-graph.ts` — A/B: buharlaşma %55↓ |
| §6.3 | Yaka simetrisi regresyon testi | ✅ | faz-checks §4/§14 |
| B5 | Bekleme noktaları sabit dünya koordinatı | ⬜ | S |
| B6 | Tır parkı yalnız near yakada | ⬜ | S |
| B8 | Yaka başına tesis nüshaları | 🟡 yalnız `market2` | M |
| 3.3 | O(n²) çarpışma → uniform grid | ⬜ | M (mobil ısınma) |
| 3.4 | Kapı ayrım kısıtı (giriş/çıkış ≥6 birim) | 🟡 mevcut kısıt ≥5 | XS |
| 3.5 | İç koridor rezervasyonu | ⬜ | XS |
| §6.1 | `?traffic=1` debug overlay | ⬜ | S |

## 2. Ekonomi raporu — madde takibi

| Katman | Madde | Durum | Nerede |
|---|---|---|---|
| 1a | `entryChance` yumuşak tavan (Kusur #1) | ✅ **prod** | asimptotik 0.95 |
| 1b | Trafik arzı gelişmişliğe bağlı (Kusur #2) | ✅ **prod** | `trafficPull()` |
| 1c | Müşteri segmentleri — ₺/müşteri ekseni | ✅ **prod** | premium/filo/otobüs, ₺233→₺1.076 |
| 2a | Varlığa bağlı OPEX | ✅ **prod** | 10 günlük rampa |
| 2b | Reklam/pazarlama bütçesi sink'i | ✅ **prod** | ₺0-8.000/gün |
| 2b | Ruhsat, sigorta, personel eğitimi, dekorasyon, ekipman yaşlanması | ⬜ | M |
| 2c | Her yapı için yıkma/satma | 🟡 kısmen | XS |
| 3a | Ortak şirket kasası + şube bazlı P&L | ✅ **dev** | `locSnapshots`, `switchLoc()` |
| 3b | Prestij "Devret" | ✅ **prod** | marka yıldızı, eşik ikiye katlanır |
| 3c | Şehir katmanı (5 lokasyon) | 🟡 **3/5** | kasaba ✅ · çevre yolu ✅dev · otoyol ✅dev |
| 4a | B2B sözleşmeler | ✅ **prod** | 5 şablon, kapasite şartı |
| 4b | Piyasa dalgalanması | ⬜ | S |
| 4c | Leaderboard + haftalık + sezon | ⬜ | S / M |
| 4d | AI rakip istasyon | ⬜ | XL |
| §6.1 | `LocationTheme` altyapısı | ✅ **prod** | `src/themes.ts` |
| §6.2 | Kasaba — "müdavim müşteri" mekaniği | ⬜ | S |
| §6.3 | **Çevre Yolu** (ışık penceresi + yaya müşteri) | ✅ **dev** | — |
| §6.4 | **Otoyol** (ramp/merge + kaçan müşteri) | ✅ **dev** | — |
| §6.5 | **Marina** | ⬜ | XL (10-14 gün) |
| §6.6 | Metropol | 🟡 tema+ışık var, sahne yok | M |
| §7 #5 | **Müdür/asistan otomasyonu** | ⬜ | S — ~10 feedback ister, en çok istenen QoL |
| §7 #7 | Personel derinliği (kademe/maaş/skill) | ⬜ | M — 76 feedback |
| §9 | Ölçüm planı (doygunluk günü, nakit/varlık, D7/D30) | ⬜ | telemetri yok |

## 3. Raporlarda olmayan, feedback'ten gelen kalanlar

- Tekil bug'lar: restoran/kafe ciro 0 (#193) · market kasaya eklemiyor (#423) · haciz sonrası işlevsiz bina (#495) · pompacı cam silmiyor (#451)
- İtibar 5.0'da yapışıyor (#456)
- Raporlama: gün sonu özet modali, 7 günlük kâr grafiği, karşı yaka gelir ayrımı (#317)
- Taşınamayan objeler: tabela/totem (~10), sokak lambası geri konamıyor (#358)
- Oyun içi "Yenilikler" modali (#465) · EN eksik çeviriler (#464) · FR (#435)
- Perf: rAF bütçesi + düşük güç modu (InstancedMesh yapıldı)

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
