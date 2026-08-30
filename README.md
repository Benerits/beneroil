# ⛽ BenelOil

İzometrik benzin istasyonu tycoon'u. Three.js ile yazılmış, tarayıcıda çalışır, giriş
zorunlu değildir (misafir modu), iOS'ta Capacitor kabuğuyla dağıtılır.

Oyuncu tek pompalı bir kasaba istasyonuyla başlar; aracı elle doldurur, bahşiş toplar,
tesis kurar, sonunda beş şubeli bir zincire ve marka yıldızlarına ulaşır.

| | |
|---|---|
| **Prod** | [petrol.benerits.com](https://petrol.benerits.com) · [beneloil.com](https://beneloil.com) — `main` dalı |
| **Dev** | petrol-dev.benerits.com — `dev` dalı |
| **Diller** | Türkçe · İngilizce · Fransızca (tarayıcı diline göre otomatik) |
| **Depo** | `Benerits/beneroil` (dikkat: `beneloil` **değil**) · iOS kabuğu `Benerits/beneloil-ios` · landing `Benerits/beneloil-landing` |

> 📌 **Koda dokunmadan önce oku:** [`docs/CONTEXT.md`](docs/CONTEXT.md) — mimarinin
> gerekçeleri, değişmez kurallar ve bu projede gerçekten yaşanmış tuzaklar.
> 📊 **Oyun-hissi / ekonomi / onboarding'e dokunmadan önce oku:**
> [`docs/WHY-IT-WORKS.md`](docs/WHY-IT-WORKS.md) — tutma mekanikleri, lansman verisi,
> oyuncu kaybı noktaları.

---

## Hızlı başlangıç

```bash
npm install
npm run dev       # http://localhost:5173
npm run build     # tsc + vite build → dist/
npm run test:all  # 15 test dosyası, 700+ iddia
```

Sunucu ayrı çalışır (`server/index.js`, tek dosya, PostgreSQL). `DATABASE_URL` verilmezse
hesap API'si devre dışı kalır ve sunucu yalnız statik dosya servis eder — oyun misafir
modunda çalışmayı sürdürür.

---

## Oynanış

**Çekirdek döngü — elle servis.** Araç yoldan gelir, pompaya yanaşır, balonda isteğini
yazar (`30L DİZEL`). Doğru tabancayı seç, **DOLDUR**'a basılı tut, istenen litreye yakın
bırak. Yakınsan bahşiş, taşırırsan döküntü cezası, yanlış yakıt verirsen ağır ceza.
Araç üstündeki bar sabırdır; biterse müşteri sinirle gider ve itibar düşer.

Oyunun ayırt edici yanı bu: tycoon türünde alışılmış "kur ve bekle" yerine **her satışta
elini kirletirsin**. Otomasyon sonradan açılır ama aktif oynamak her zaman daha kârlıdır.

**Büyüme.** Arsa satın al → beton dök → tesis kur. Pompa (14'e kadar), tabela, tank,
market, tuvalet, oto yıkama, yağ değişimi, kafe, restoran, TIR parkı, self-servis yıkama,
hava/su, otopark, sokak lambası.

**Elektrik zinciri.** Altyapı → batarya deposu → DC şarj ünitesi (12'ye kadar). Üretim:
güneş paneli · dizel jeneratör · **SMR (mini nükleer reaktör)**. Paneller kirlenir,
jeneratör gürültüsü EV müşterisi kaçırır, bakımsız reaktör patlar ve enkaz bırakır —
temizlenmeden yeni reaktör kurulamaz.

**Şirket katmanı.** Kredi, ortak, kurumsal sözleşmeler, personel eğitimi, dekorasyon,
sigorta, pazarlama bütçesi, karşı yaka istasyonu, rakip istasyon fiyat savaşı, mevsimler,
sıralama tablosu.

---

## Şubeler

Para, gün ve itibar **şirket** seviyesinde; ekipman **şube** seviyesinde tutulur. Aktif
olmadığın şubeyi müdür çevirir (verim Sv.1/2/3 = %45/%65/%85 — aktif oynamak her zaman
daha kârlı), kasada biriken parayı Ofis › Şubeler'den toplarsın.

| Şube | Sıra | Gereken ★ | Bedel | İmzası |
|---|---|---|---|---|
| **Kasaba** | 1. | — | başlangıç | Müdavim müşteri: itibar yükseldikçe fiyattan bağımsız sadık taban |
| **Çevre yolu** | 2. | 2★ | ₺500.000 | Trafik ışığı: kırmızıda kuyruk → giriş şansı fırlar |
| **Otoyol** | 3. | 6★ | ₺2.500.000 | Yavaşlama şeridi + erken sapma kararı; şerit dolarsa müşteri kaçar |
| **Marina** | 4. | 9★ | ₺7.810.000 | Tekneler araçların 10-50 katı yakıt çeker; bağlama + kışlama |
| **Metropol** | 5. | 14★ | ₺23.440.000 | Alan kıtlığı: arsa hem az hem pahalı — "neyi kurmayacağım" kararı |

Bedeller temadaki taban değerin **açık şube başına ×1.25** bileşik çarpanıyla hesaplanır
(`BRANCH_COST_STEP`, `src/state.ts`). Şube açmak devir eşiği tavanını yükselttiği için
bedel de kademeli artar.

---

## Devir (prestij)

İstasyonu devredersen ekipman gider, **arsa/beton ve marka yıldızların kalır**, kasaya
devir bedeli girer ve kalıcı gelir çarpanın büyür.

- **Yıldız çarpanı:** ilk 10★ her biri +%25, 11-20★ +%10, 21★ ve sonrası +%5.
- **Devir bedeli:** ekipmanın %60'ı + son 30 günün ortalama kârının 10 katı (≤₺100.000).
  Eşik tavanındaysan katsayı %30'a iner — "kur-devret-kur" farmı kârlı olmasın diye.
- **Eşik:** ₺250.000'den başlar, her yıldızda katlanır, **ama şube başına ₺1.500.000'i
  hiçbir koşulda aşamaz.**

Bu tavan sert bir kuraldır ve nedeni vardır: eşik bir şubeye fiziksel olarak
kurulabilenden fazlasını isterse oyuncu kalıcı olarak kilitlenir. Ölçülen gerçek şube
kapasitesi ~₺1.72M olduğu için ₺1.5M tavanı her zaman ulaşılabilir pay bırakır.
Devir-çiftliğinin freni eşikte değil, artan şube bedeli + tavan devrindeki %60→%30
kırpma + azalan yıldız veriminde durur. Ayrıntı: `handoverThreshold()`, `src/state.ts`.

---

## Mimari

```
src/            istemci (TypeScript, Three.js — çerçeve yok)
  main.ts       oyun döngüsü, satış, gün dönüşü, arayüz bağlama  (en büyük dosya)
  state.ts      TÜM sabitler, maliyet tabloları, ekonomi, save şeması
  world.ts      3B sahne kurulumu, gündüz/gece ışık rampası
  cars.ts       araç/tanker/trafik yönetimi, sabır, tıkanma önleme
  themes.ts     şube temaları: topoloji + ekonomi + görsel kısıt seti
  scenery.ts    şube yerleşim planları (VERİ — world.ts yalnız uygular)
  i18n.ts       TR/EN/FR sözlükleri
  marina.ts · rival.ts · news.ts · auth.ts · ads.ts · store.ts · ui.ts · audio.ts
server/
  index.js      tek dosya: save API, kimlik doğrulama, anti-cheat, admin uçları
tools/tests/    15 test dosyası
tools/shot/     gerçek oyunu Chrome'da açıp şube ekran görüntüsü alan araç
docs/           mimari gerekçeleri, tasarım raporları, live-ops notları
```

**Kamera / koordinat:** `z` yukarı, `y` sağa, `x` izleyiciye doğru. Kamera `(1, 2, 1)`
yönünden ortografik bakar (sabit izometrik açı). 1 birim ≈ 1 metre. Gün döngüsü 160
gerçek saniye (~90 sn gündüz, ~40 sn gece).

**Sunucu uçları:** `/api/save` · `/api/register` · `/api/login` · `/api/auth/google` ·
`/api/auth/apple` · `/api/leaderboard` · `/api/feedback` · `/api/appeal` · `/api/iap` ·
`/api/config`. Admin paneli (`manage.benerits.com`) `/vs/v1/*` uçlarını Bearer anahtarla
çeker.

**Anti-cheat:** jeton kovası + ekipmandan türetilen `maxIncomeRate()`. Şube müdürlü
save'lerde kova hızına şube payı eklenir — eklenmezse meşru toplama 409 yer.

---

## Değişmez kurallar

Bunlar tercih değil, **kural**. Ayrıntılı gerekçeleri `docs/CONTEXT.md §1`'de.

1. **SQL'deki oyuncu save'lerine dokunma.** Hiçbir düzeltme `UPDATE`/`DELETE` ile
   yapılmaz — yalnız kodla.
2. **Save formatını bozma.** Yeni alanlar yalnız ADDITIVE eklenir; eski istemci alanı yok
   sayabilmeli, eksik alan varsayılana düşmeli.
3. **Varsayılan hedef `dev`.** Prod'a çıkmak ayrı ve açık bir karardır.
4. **`src/state.ts` maliyet tabloları ↔ `server/index.js` COST tabloları BİREBİR olmalı.**
   Ayrışırsa "para gitti, ürün yok" bug'ı çıkar.

---

## Test disiplini

```bash
npm run test:all       # hepsi
npm run test:faz       # ekonomi, mağaza, save, yerleştirme (en geniş dosya)
npm run test:framing   # sahne çerçeveleme / kamera matematiği
npm run test:branch    # şube müdürü davranışı
npm run test:anticheat # jeton kovası ↔ istemci senkronu
npm run test:i18n      # sözlük bütünlüğü (TR/EN/FR)
```

Kural: **her düzeltilen bug için, o bug'ı yakalayan bir iddia yazılır.** Testler Türkçe
yazılır, çıktı `✓/✗` listesi ve `SONUÇ: N geçti, M kaldı` ile biter. Testler üretim
yolunun kendisini çağırmalıdır — sabit okuyup "davranışı ölçtüm" sanmak bu projede
defalarca yanlış sonuç verdi.

---

## Ekran görüntüsü aracı

```bash
npm run dev -- --port 5199            # bir terminalde
ZOOM=1 OUT=/tmp/shots npm run shots   # başka terminalde
```

Gerçek oyunu Chrome'da açar, misafir kaydı enjekte eder (tüm şubeler açık), arayüzü
gizler ve her şubenin PNG'ini alır. Sistemdeki Chrome'u kullanır, ayrı tarayıcı indirmez.
**Sahne değiştirdiysen ekran görüntüsüne bak** — "iyi görünüyordur" varsayımı bu projede
defalarca yanlış çıktı.

## Asset üretimi

```bash
GEMINI_API_KEY=xxx npm run assets              # hepsini üret → assets/gen/
GEMINI_API_KEY=xxx npm run assets -- pump_red  # tek asset
```

Promptlar ve ortak stil bloğu `tools/prompts.json` içinde; stil kilidi orada olduğu için
assetler tutarlı çıkar. Görseller düz yeşil (#00FF00) fonla gelir, chroma-key ile
şeffaflaştırılır.

---

## Dağıtım

Dokploy üzerinde barındırılır, `main` ve `dev` dallarında **auto-deploy açıktır** — push
yeterlidir. Deploy'un "done" görünmesi yeni bundle'ın yayında olduğunu garanti etmez;
doğrulamak için canlı bundle'ın karmasını yerel `dist/` çıktısıyla karşılaştır
(`docs/CONTEXT.md §2.3`).

## Yol haritası

- [ ] **Tersane** — tekne tadilat/bakım tesisi (tam plan çıkarıldı, uygulanmadı)
- [ ] **Seviye B: eylemler sunucu-otoriter** — satın alma, yakıt siparişi, gün dönüşü ve
      IAP makbuz doğrulaması sunucuya taşınacak (onaylandı, başlanmadı)
- [ ] Tekne bileti bilanço dengesi tekrar gözden geçirilecek
