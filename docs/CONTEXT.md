# BenelOil — Claude için proje bağlamı

Bu dosya, başka bir oturumda sıfırdan başlayan bir asistanın **kodu okumadan önce** bilmesi
gerekenleri tutar: mimarinin nedenleri, geçmişte yapılmış hatalar ve tekrar edilmemesi
gereken tuzaklar. Kod yapısını anlatmaz (onu kod anlatır) — **kararların gerekçesini** anlatır.

Son güncelleme: 2026-07-27

---

## 0. Otuz saniyelik özet

Three.js ile yazılmış izometrik benzin istasyonu tycoon oyunu. Tarayıcıda çalışır, giriş
şart değil (misafir modu), iOS'ta Capacitor kabuğuyla dağıtılır. Beş şube var: kasaba,
çevre yolu, otoyol, marina, metropol. Para/gün/itibar ŞİRKET seviyesinde, ekipman ŞUBE
seviyesinde tutulur.

| | |
|---|---|
| Oyun + sunucu reposu | `Benerits/beneroil` (dikkat: `beneloil` DEĞİL) |
| iOS kabuğu | `Benerits/beneloil-ios` |
| Landing | `Benerits/beneloil-landing` |
| Prod | `petrol.benerits.com` · Dokploy app `N3i_Xv8oDr_3O-AB_dTiT` · `main` dalı |
| Dev | `petrol-dev.benerits.com` · Dokploy app `zwTnXsVAFMl_ZeV_0gv-x` · `dev` dalı |
| Panel | `manage.benerits.com` (API: `x-api-key` başlığı) |
| Sunucu | `server/index.js` — tek dosya (save API + anti-cheat) |
| Veritabanı | prod ve dev **AYRI**; izolasyon yalnız `DATABASE_URL` ile |

---

## 1. Değişmez kurallar

Bunlar tercih değil, **kural**. Oğuz her ikisini de açıkça söyledi.

1. **SQL'deki oyuncu save'lerine dokunma.** Hiçbir fix `UPDATE`/`DELETE` ile yapılmaz;
   düzeltme yalnız kodla olur. (Tek istisna, açıkça izin verilen dev test hesaplarıydı ve
   önce yedek alındı.)
2. **Save formatını bozan değişiklik yapma.** Yeni alanlar yalnız ADDITIVE eklenir; eski
   istemci alanı yok sayabilmeli, eksik alan varsayılana düşmeli.
3. **Varsayılan hedef `dev`.** Prod'a çıkmak ayrı ve açık bir karardır.
4. **`src/state.ts` maliyet tabloları ↔ `server/index.js` COST tabloları BİREBİR olmalı.**
   Ayrışırsa "para gitti, ürün yok" bug'ı çıkar — 2026-07-25'te pompa 8→14 ve EV 8→12
   uyumsuzluğu tam bunu üretti.

---

## 2. Sık düşülen tuzaklar (hepsi bu projede gerçekten yaşandı)

### 2.1 Dokunulmayan kod
Python `str.replace()` ile yapılan yamalar, girinti eşleşmediği için **sessizce hiçbir şey
yapmadan** başarı raporladı. Bir dönem `boats` / `waterOnly` / `serviceLane` /
`carsPassThrough` seçenekleri `main.ts`'e hiç bağlanmadı; "trafik iyileştirmesi yapıldı"
diye rapor edilen şey oyunda YOKTU. **Her yamadan sonra çıktıyı doğrula** (grep + test).
`tools/tests/ui-check.mjs §6` bu sınıf için nöbetçidir.

### 2.2 Sabiti ölçüp "davranışı ölçtüm" sanmak
Marina bilet testi tabloyu okuyup aynı tabloya bakıyordu. Gerçekte `opts.boats` yalnız
`{id, share}` gönderiyordu, para KARA segmentlerinden geliyordu: süperyat ₺25.000 yerine
₺233 ödüyordu. **Test, üretim yolunun ta kendisini çağırmalı.**

### 2.3 "Deploy done" ≠ yeni bundle yayında
Dokploy'da `done` yalnız BUILD'in bittiğini söyler. Swarm container swap'i ayrıca
başarısız olabilir ("Address already in use"); eski task çalışmaya devam eder.
**Her deploy sonrası canlıdan bundle hash'ini doğrula.** Takılırsa:
`ssh ubuntu@5.135.142.214` → `sudo docker service ps benzinlik-web-cqzlct` →
`sudo docker service update --force benzinlik-web-cqzlct`.

### 2.4 Tarayıcı önbelleği
Kenney model dokuları (`Textures/colormap.png`) eklenmeden önce 404 veriyordu; bu 404
tarayıcıda önbelleğe düşünce modeller **bembeyaz** render oldu. Sunucuda dosyalar 200
dönerken bile kullanıcı beyaz görüyordu. Beyaz model şikâyetinde önce **hard refresh**
söylet, sonra kodu suçla.

### 2.5 Normalsiz geometri siyah çıkar
Elle `BufferGeometry` üretirken `computeVertexNormals()` çağırmazsan Lambert altında mesh
kapkara olur ve ekranın yarısını yutar (marina sahil patikasında oldu).

---

## 3. Sahne / kamera — ölçülmüş gerçekler

Kamera ortografik izometrik, `VIEW = 26`, zoom 0.62–2.6, üç hazır açı (`main.ts CAM_ANGLES`).

Ekran projeksiyonu (varsayılan açı `(1,2,1)`):

```
sx = -0.894·x + 0.447·y          → +x EKRAN SOLU,  +y EKRAN SAĞI
sy = -0.182·x - 0.365·y + 0.913·z
derinlik = 0.408·(x + 2y + z)    → büyük x ve y kameraya YAKIN
```

Bundan çıkan tasarım kuralları (`src/scenery.ts` içinde `RULES`, test:
`npm run test:framing`):

| | kural | sebep |
|---|---|---|
| K1 | x 4.0–11.6 koridoruna dekor girmez | yol / seyir kanalı |
| K2 | x > 11.6 ve \|y\| ≤ 26 ise **yükseklik ≤ 5** | karşı yaka kameraya yakın; yüksek kütle istasyonun önüne geçer |
| K3 | yüksek kütle x ≤ −16'ya | batı ekranın sağı ve derinlikte gerisi — asla örtmez |
| K4 | parsel bandındaki her şey `parcel: true` | oyuncu arsayı betonlayınca bina silinsin |
| K5 | istasyonu örtme oranı ≤ %6 (yatık açıda %20) | ölçülen ekran kutusu kesişimi |

**Parsel haritası** (`state.ts PARCEL_COLS/ROWS`): near kolonları x −6.5..5, −18..−6.5,
−29.5..−18; far kolonları 10.9..22.4, 22.4..33.9, 33.9..45.4. Satırlar y −24..−10,
−10..10, 10..24. Yani **görünür alanın neredeyse tamamı satın alınabilir arsadır** —
dekoru oraya koyarken `parcel: true` şart.

### Sahne yerleşimi artık VERİ
`src/scenery.ts` dört planı tutar (`OTOYOL_PLAN`, `CEVREYOLU_PLAN`, `METROPOL_PLAN`,
`MARINA_PLAN`). `world.ts` yalnız `placePlan()` ile bunları sahneye döker. Yerleşim
değiştirmek = tabloya satır eklemek + `npm run test:framing`.

### Şube kimlikleri (kit seçimi bilinçli)
- **otoyol** → `industrial` kiti, AĞIR ölçek (16 birim baca, santral)
- **çevre yolu** → `industrial` kiti, KÜÇÜK ölçek (4-6 birim atölye, sanayi sitesi)
- **metropol** → `commercial2` kiti (camlı kuleler batıda, alçak dükkân doğuda)
- **marina** → `watercraft` kiti; **adaya yapı konmaz** (Oğuz'un açık kısıtı), tek dikey
  aksan fener
- **kasaba** → hiç ek paket indirmez (bir bayt bile)

`low-detail-building-*` ailesi yakın planda **kullanılmaz**: kutuları ince-uzun, h≈4.5'e
ölçeklenince detaysız beyaz dilimlere dönüşüyorlar.

---

## 4. Ekran görüntüsü aracı (körlemesine tasarımı bitirir)

```bash
npm run dev -- --port 5199          # bir terminalde
ZOOM=1 OUT=/tmp/shots npm run shots  # başka terminalde
```

`tools/shot/shoot.mjs` gerçek oyunu Chrome'da açar, misafir kaydını enjekte eder (tüm
şubeler açık), arayüzü gizler ve her şubenin PNG'ini alır. `playwright-core` + sistemdeki
Chrome kullanır (ayrı tarayıcı indirmez). **Sahne değiştirdiysen ekran görüntüsüne bak** —
bu projede "iyi görünüyordur" varsayımı defalarca yanlış çıktı.

---

## 5. Ekonomi ve mekanik notları

- **Marina teknesi:** `boatSegments()` artık yakıt iskelesi olmadan da küçük tekneleri
  (jet ski / sürat / balıkçı) getirir. Eskiden iskele yoksa BOŞ dizi dönüyordu ve
  ₺5.000.000'a açılan şube tamamen ölü görünüyordu. İskele artık **büyük tekne kilidi**.
- **Şube müdürü:** `managerLevel` şube bazlı bir alan. Pasif şubede de çalışır: gün
  dönüşünde `accrueBranchVaults()` net geliri `branchVault`'a yazar, oyuncu Ofis ›
  Şubeler'den toplar. Verim Sv.1/2/3 = %45/%65/%85 — **aktif oynamak her zaman kârlı**.
  Kasa tavanlı (₺220.000 mutlak) ki hem oyuncu geri dönsün hem sunucunun jeton kovası
  patlamasın.
- **Anti-cheat:** jeton kovası + `maxIncomeRate()` (ekipmandan türetilir, `SAFETY = 3`),
  `ALLOW_BURST = 260_000`, `_ab` sunucu-sahipli alan. Şube müdürlü save'lerde kova hızına
  şube payı eklenir; eklenmezse meşru toplama 409 yer.
- **Kumbara taşması:** dolu kumbaranın üstüne gelen gelir %40 verimle 3× tavana kadar
  birikir, kaybı `facLost` tutar. Hiçbir şey sessizce buharlaşmaz.
- **İtibar** günlük hizmet kalitesine çekilir (±0.30/gün), 5.0'da donmaz.

---

## 6. Test disiplini

```bash
npm run test:all       # 13 dosya, ~750 iddia
npm run test:framing   # sahne çerçeveleme (kamera matematiği)
npm run test:branch    # şube müdürü davranışı
npm run test:scene     # sahne kurulum bağlantıları
```

Kural: **her düzeltilen bug için, o bug'ı yakalayan bir iddia yazılır.** Testler Türkçe
yazılır, çıktı `✓/✗` listesi ve `SONUÇ: N geçti, M kaldı` ile biter.

---

## 7. Açık işler

- **Tersane (tekne tadilat/bakım tesisi):** tam plan çıkarıldı, uygulanmadı. Kritik
  kararlar: `winterSlots`'a dokunma; `yardCap` yalnız tesisten türesin; kızaktaki tekne
  kışlayan tekneyi düşürsün; ₺1.8M `travelift300` reddedildi (−₺883k/yıl); depozito yok;
  jet ski karaya çekilmez; `handover()` `yardJobs`'u sıfırlamalı.
- **Seviye B — eylemler sunucu-otoriter:** satın alma → yakıt siparişi → gün dönüşü → IAP
  makbuz doğrulaması. Onaylandı, başlanmadı. Save-push yolu reponun en hassas kodu.
- **Tekne bileti bilançosu:** ₺4.624 ortalama bilet yaz aylarında ~₺161.909/gün yakıt kârı
  üretiyor; denge tekrar bakılmalı.
