# Ödüllü Reklam Stratejisi — v2.1 (3 Eylül 2026)

Kod: istemci `src/reklam.ts` + `src/ads.ts` + `src/main.ts` (teklif butonu, Ofis paneli), sunucu
`server/reklam.js`. Rapor ucu `GET /vs/v1/ads?days=7` (aggregate, e-posta yok). Testler
`tools/tests/reklam-check.mjs` (istemci/sözleşme) ve `tools/tests/reklam-sunucu-check.mjs` (bilet/SSV/bütçe/KPI).

## 1. İlkeler (AppLovin MAX politikası + tycoon türü)

1. **Yalnız opt-in rewarded.** Interstitial yok, zorunlu video yok, "seriyi kaybedersin" tehdidi yok.
2. **Ödül ÖNCE ve NET yazılır** — bilet sunucudan alınır, butondaki tutar sunucunun kestiği tutardır.
3. **Ödül yalnız SSV ile** (`/api/ads/ssv/applovin`); istemci "izledim" demesiyle para verilmez.
4. **Aynı anda tek teklif**, tek buton; izlenen videodan sonra 60 sn nefes.
5. **Reklam parası ≤ aktif kazancın %30'u** (7 gün penceresi) — oyun idle'a kaymaz.
6. **ATT istenmez** (kişiselleştirilmemiş reklam); AB/UK için CMP (MAX ↔ Google UMP) şart.

## 2. Hedefler (`HEDEFLER`, `server/reklam.js`)

| KPI | Hedef | `/vs/v1/ads` alanı | Tycoon kıyası |
|---|---|---|---|
| İzlenme / aktif oyuncu / gün | **≥ 2,5** | `kpi.viewsPerActivePerDay` | idle/tycoon ortalaması 2–4 |
| Opt-in oranı (≥1 ödül alan / aktif) | **≥ %35** | `kpi.optInRate` | iyi rewarded oyunlar %30–50 |
| Tamamlama (complete / offer) | **≥ %55** | `kpi.completeRate` | teklif iyi konumlanmışsa %50+ |
| Yumuşak günlük tavan / oyuncu | **8** | `targets.softDailyMaxPerPlayer` | sert tavan toplamı 25 (yerleşim capleri) |
| ARPDAU (USD) | izlenir, hedef yok (eCPM ülkeye bağlı) | `kpi.arpdauUsd` | |

`kpi.*` değerleri `null` ise payda sıfır (veri yok) — henüz SDK anahtarı girilmemiş demektir.

## 3. Yerleşimler ve v2.1 değişiklikleri

| id | tür | tavan/gün | ne zaman | v2.1 |
|---|---|---|---|---|
| gun2x | para | 3 | gün sonu, net kâr 2× | teklif **22 → 90 sn** görünür (yarım oyun günü); ısrar yok |
| offline2x | para | 4 | dönüşte offline kazanç 2× | **30 → 60 sn** |
| **hediye** | para | 1 | oturum açılışı +12 sn, sahne boşken; Ofis panelinden de | **yeni** — günlük ritüel; tutar = dünkü kârın %25'i (≥ ₺500), sunucu tepe gelirin 40 sn'siyle keser |
| tamir | efekt | 6 | ödenmiş tamir sürüyorsa | buton meşgulse arıza **işaretlenmez**, sonraki taramada teklif edilir (eskiden kayboluyordu) |
| tanker | efekt | 3 | yolda sipariş varsa | — |
| event / premium / trafik | efekt | 2 / 3 / 2 | Ofis paneli (izle → kazan) | — |
| kurtarma | para | 1 (hafta 2) | kasa+tank ≈ 0 ve banka vermiyor | — |

**Askıya alma:** ekranda uzun ömürlü bir PARA teklifi (gun2x/offline2x/hediye) varken acil bir EFEKT
teklifi (tamir/tanker/kurtarma) gelirse para teklifi askıya alınır, acil teklif inince **kalan süresiyle**
geri gelir. Güvenli çünkü tavan sayacı **claim'de** artar, bilet 15 dk yaşar.

**Nefes:** izlenen videodan sonra otomatik teklif için 60 sn (`AD_IZLEME_NEFESI`); Ofis paneli
(oyuncunun kendi tıkladığı) bundan muaf. Zaman aşımı 10 sn, premium-otomatik 5 sn olarak kalır.

## 4. Uzaktan ayar (deploy'suz)

- `benzinlik_ad_config` tablosu: `key='placements'` → `{"gun2x":{"cap":2,"enabled":false},...}`; `key='ratio'` → `0.25`. 60 sn önbellek.
- Env tabanı: `AD_PLACEMENTS_JSON`, `AD_MAX_RATIO`. DB satırı env'i ezer.
- Cap tavanı 50; mergePlacements kırpar.

## 5. Canlıya alma ön koşulları (kullanıcı tarafı)

1. Dokploy env: `APPLOVIN_SDK_KEY`, `APPLOVIN_IOS_REWARDED`, `APPLOVIN_ANDROID_REWARDED`, `APPLOVIN_EVENT_KEY` (SSV imza anahtarı). Anahtar yoksa `/api/config` `ads.provider = null` → native'de reklam hiç görünmez, oyun bozulmaz.
2. MAX dashboard: rewarded ad unit → **S2S callback URL** `https://<host>/api/ads/ssv/applovin?event_id={EVENT_ID}&event_token={EVENT_TOKEN}&custom_data={CUSTOM_DATA}&user_id={USER_ID}&placement={PLACEMENT}`.
3. Mediation ağları (öncelik): AppLovin Exchange, Google AdMob (bidding), Unity, ironSource, Meta Audience Network; sonra Mintegral/Liftoff. Her ağ için SKAdNetwork ID plist'e.
4. CMP: MAX → Privacy → Google UMP; `Info.plist` `NSUserTrackingUsageDescription` **eklenmez** (ATT yok).
5. ASC App Privacy: Identifiers (Device ID), Usage Data, Diagnostics → "Third-Party Advertising". Bkz. `docs/ios-cikis-analizi.md` 1.3/1.6.

## 6. Okuma rehberi — `/vs/v1/ads?days=7`

```
totals.offer → start → complete → reward/ssv → granted      (huni; her adımda düşüş nerede?)
kpi.optInRate < 0.35     → teklif görünmüyor/anlaşılmıyor: hediye ve gün2× sürelerini, etiket metnini kontrol et
kpi.completeRate < 0.55  → offer çok ama tıklanmıyor: tutar küçük (moneyCap/ratio) ya da teklif yanlış anda
placements.X.nofill yüksek → o platformda dolum yok: mediation ağı ekle / ad unit yanlış
kpi.viewsPerActivePerDay > 8 → yumuşak tavan aşıldı: ratio/cap düşür (uzaktan ayar)
```
