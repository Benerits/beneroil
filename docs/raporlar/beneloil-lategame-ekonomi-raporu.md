# BenelOil — Geç Oyun (Late Game) Ekonomi Analizi ve İyileştirme Raporu

**Tarih:** 26 Temmuz 2026
**Kapsam:** `Benerits/beneroil` @ main (284 commit) · 529 oyuncu geri bildirimi · tycoon/idle tür literatürü
**Soru:** Oyuncular 1 hafta sonunda çok para kazanıp yapacak bir şey bulamıyor. Late game ekonomisi nasıl düzeltilir, oyun ilerledikçe nasıl tıkanmaz?

---

## 0. Tek Cümlelik Teşhis

> **Oyunun içeriği ₺1.78M'lik bir bütçe; oyuncunun geliri ise sabit bir tavana (₺~9.000/oyun-günü) çarpıp orada donuyor. Ama asıl kırılma noktası bu değil: talep formülü ₺122.000'lik yatırımdan sonra matematiksel olarak doyuyor (`entryChance` 0.95'te sert kesiliyor), yani oyuncunun ondan sonra aldığı HER ŞEY trafiğe sıfır katkı yapıyor. Oyuncu "yaptım ama bir şey değişmedi" diyor; haklı — kod birebir bunu yapıyor.**

Bu bir "içerik azlığı" problemi değil. **Yapısal bir doygunluk problemi.** Yeni bina eklemek semptomu 2 gün erteler; formül değişmezse 3 gün sonra aynı şikâyet geri gelir.

---

## 1. Yöntem

| Kaynak | Ne yapıldı |
|---|---|
| Kod | Repo klonlandı; `state.ts` (1025 satır), `main.ts` (3907), `cars.ts` (1455) ekonomi sabitleri ve formülleri çıkarıldı |
| Feedback | 529 kayıt parse edildi (gün + kasa + metin + çözüm durumu), erken/geç oyun olarak segmentlendi, tema bazlı sayıldı |
| Simülasyon | `entryChance` doygunluk noktası, trafik arz tavanı, toplam içerik bütçesi ve teorik gelir tavanı hesaplandı |
| Literatür | Sim/idle/tycoon ekonomi tasarımı kaynakları + tür içi emsal analizi (Idle Miner Tycoon, Gas Station Simulator, Stardew Valley) |

**Feedback veri profili:** 225 tekil oyuncu · medyan gün 40 · ortalama gün 58 · maks gün 385 · maks kasa ₺5.19M

---

## 2. TEŞHİS — Beş Yapısal Kusur

### Kusur #1 · Talep formülü ₺122.000'de doyuyor (EN KRİTİK)

`state.ts:407-421`:

```ts
const c = 0.32 + 0.1*signLevel + 0.05*(reputation-3) + 0.04*marketLevel
        + 0.02*toiletLevel + 0.02*evChargers + (hasWash?0.03:0) + (hasOil?0.03:0)
        + (hasCoffee?0.02:0) + (hasRestaurant?0.03:0) + (hasTruckPark?0.02:0)
        + 0.02*Math.min(airWaterCount,3) + 0.02*Math.min(selfWashCount,3)
return Math.min(0.95, Math.max(0.05, c * boost))   // ← SERT TAVAN
```

Hesap:

| Durum | Ham `c` | `entryChance` | Yorum |
|---|---|---|---|
| Başlangıç | 0.32 | 0.32 | — |
| Tabela3 + İtibar5 + Market3 + Tuvalet2 | 0.88 | 0.88 | hâlâ artıyor |
| **+ 4 DC şarj ünitesi** | **0.96** | **0.95** ⛔ | **TAVAN. Maliyet ≈ ₺122.000** |
| Her şey maks (14 pompa, 12 EV, tüm tesisler) | **1.37** | **0.95** | **0.42 puan tamamen çöp** |

**Sonuç:** Ham çekicilik skoru tavanın **%44 üstünde**. Yani oyuncunun ₺122k'dan sonra harcadığı **~₺1.65 milyon**, müşteri akışına **matematiksel olarak sıfır** katkı yapıyor. Restoran, yağ değişimi, kahveci, oto yıkama, 5-12. şarj ünitesi, 5-14. pompa — hepsi trafik açısından **ölü yatırım**.

> Feedback #192 (gün 192, ₺662.869): *"8 pompa 8 şarj ünitesi koyduk. oyunun eğlencesi bitti 2 günde."*
> Feedback #109 (gün 109, ₺242.768): *"Yakıtların tamamını en yüksek fiyatlardan satmama rağmen müşteri trafiğinde bir dalgalanma olmuyor."*
> Feedback #246 (gün 246, ₺500.770): *"yakıt fiyatını 2 katına çekmeme rağmen halen müşteri geliyor."*

Bu üç şikâyet **aynı kök nedenin** üç yüzü: talep sabiti tavanda kilitli. Fiyat çarpanı (`priceDemandFactor`) tavanda %65 kesinti yapsa bile `0.95 → 0.33`… ama tavan öncesi ham skor 1.37 olduğu için `1.37 × 0.35 = 0.48` hâlâ 0.95'in altında değil hissedilir bir düşüş yaratmıyor. **Sert tavan, fiyat kaldıracını da öldürüyor.**

---

### Kusur #2 · Trafik ARZI sabit — gelir tavanı yapısal

`cars.ts:788-800`:

```ts
this.nearTimer = 1.5 + Math.random() * 1.8   // sabit
this.farTimer  = 2.0 + Math.random() * 2.4   // sabit
if (transitCount < 18) { ... }               // sabit
```

Yolda akan araç sayısı, oyuncunun istasyonu ne kadar geliştiğinden **tamamen bağımsız**.

```
Yol arzı      = 1/2.4 + 1/3.2 = 0.73 araç/sn
Tavanda giriş = 0.73 × 0.95   = 0.69 araç/sn
Ort. satış    = ₺233 (DEMAND_AMOUNTS ortalaması)
Brüt marj     = %35 (benzin 10 → 6.5)
────────────────────────────────────────────
Teorik gelir tavanı ≈ 56.6 ₺/sn ≈ ₺9.051 / oyun-günü (160 sn)
```

Bu tavan **hiçbir yatırımla aşılamıyor**. Tycoon türünde ölümcül: oyuncu büyüyor ama geliri büyümüyor.

---

### Kusur #3 · İçerik bütçesi sonlu ve çok küçük

Tüm satın alınabilir içeriğin toplam maliyeti:

| Kalem | Tutar |
|---|---|
| Pompalar (1→14) | ₺550.000 |
| DC şarj (1→12) | ₺419.000 |
| Tabela + tank + market + tuvalet + şebeke + batarya | ₺132.500 |
| Tekil tesisler (yıkama, yağ, kahve, restoran, TIR parkı, güneş, jeneratör, SMR, geniş kapı) | ₺110.000 |
| Ek tanklar (3 yakıt × 3 tank) | ₺114.000 |
| 18 arsa + beton (gelişmişlik çarpanıyla) | ₺441.000 |
| **TOPLAM** | **₺1.776.000** |

Teorik tavanda: **196 oyun günü ≈ 8.7 saat**.

Ama asıl mesele bu değil. **Niteliksel olarak yeni** içerik (tekrar eden pompa/şarj hariç) sadece **₺421.000** — yani:

```
₺421.000 / ₺9.051 = 47 oyun günü ≈ 2.1 SAAT
```

> Feedback #43 (gün 43): *"yapacak hiçbir şey kalmıyor bir süre sonra. **2 saatte tükettim oyunu** tekrar girmem mesela."*

Hesap ile oyuncu ifadesi **birebir tutuyor.** Kalan ₺1.35M ise "aynı şeyden bir tane daha" — ve Kusur #1 sayesinde o bile bir işe yaramıyor.

---

### Kusur #4 · Sink (gider) mimarisi yok — musluk açık, gider yok

Oyunda paranın **kalıcı olarak sistemden çıktığı** tek düzenli kanal var: yovmiye.

| Gider | Tutar | Ölçekleniyor mu? |
|---|---|---|
| Pompacı yovmiyesi | ₺120/gün × pompa | Kısmen (14'te tavan) |
| Şarjcı yovmiyesi | ₺150/gün × ünite | Kısmen (12'de tavan) |
| Yakıt alımı | Marjın içinde | Gerçek sink değil |
| Bakım/tamir | Rastgele, küçük | Hayır |
| Vergi / kira / amortisman / sigorta / fatura | **YOK** | — |

Tam kadro yovmiye = ₺3.480/gün. Brüt ₺9.051 → **net birikim ₺5.500/gün, sonsuza kadar.**
100 günde ₺550.000 birikiyor, harcanacak yer yok.

> Feedback #173 (gün 173, ₺1.592.371): *"şu an **milyonlarca para var ama harcayacak yer yok**. Ürün dükkan çeşitliliğini arttırın."*
> Feedback #153 (gün 153): *"**31 tane self yıkama açtım. kendimi patlatıcam amaç kalmadı**."*

Tür literatürünün temel kuralı: **her musluğun (faucet) bir gideri (sink) olmalı.** Gider yoksa enflasyon olur ve para anlamını yitirir. BenelOil'de gider mimarisi neredeyse hiç yok.

---

### Kusur #5 · Sürtünme (friction) ölçekle birlikte artıyor, otomasyon artmıyor

`state.ts:566-580` — kumbara limitleri: market ₺600, self-yıkama ₺400, hava-su ₺250, otopark ₺300.

Gün 150'de 20+ tesisi olan oyuncu, her 1-2 dakikada **20 ayrı kumbaraya tıklamak** zorunda. Bu, geliri artırmıyor — sadece **iş yükünü** artırıyor. Tycoon türünde geç oyun **daha az mikro-yönetim, daha çok stratejik karar** demeli; burada tersi oluyor.

> Feedback #161 (gün 161): *"tesislerin sayısı arttıkça ücretlerini tek tek toplamak saçma olabiliyor."*
> Feedback #166 (gün 166): *"para birikme sınırı çok az, 600 altın zaten 2 dk'de oluyor."*

Bu, gerçek bir "içerik" hissi vermeden oyuncuyu yoran negatif ölçekleme. (Faz 4 planındaki Müdür sistemi doğru yönde — ama tek başına yeterli değil.)

---

## 3. Feedback Verisiyle Doğrulama

**529 kayıt · geç oyun (gün≥60 veya kasa≥₺150k) = 198 kayıt**

| Tema | Geç oyun | Erken oyun | Yorum |
|---|---|---|---|
| Yeni bina/tesis isteği | **%26** | %6 | İçerik açlığı geç oyunda 4× artıyor |
| Mobil/performans | %22 | %22 | Segmentten bağımsız — ayrı bir eksen |
| Personel/otomasyon | %13 | %15 | Sürekli, güçlü talep |
| Fiyat/ekonomi kontrolü | **%9** | %7 | "Fiyatı ben belirleyeyim, etkisini göreyim" |
| "Amaç kalmadı / oyun bitti" | **%7** | %1 | **7× fark — asıl sinyal** |
| Para fazlalığı | %3 | %1 | Az ama en yüksek günlü oyunculardan |
| Prestij / 2. şube / yeni harita | %4 | %1 | Oyuncular çözümü kendileri öneriyor |

**Gün dağılımı:** 1-5: 69 · 6-15: 81 · 16-40: 121 · 41-80: **129** · 81-150: 84 · 151-300: 41 · 300+: 4

Feedback yoğunluğunun **41-80 gün** bandında zirve yapması anlamlı: bu, `entryChance` doygunluğunun (₺122k) ve niteliksel içeriğin tükenişinin (₺421k) tam olarak gerçekleştiği bant.

**Doğrudan alıntılar — geç oyun oyuncuları:**

| Gün / Kasa | Söylediği |
|---|---|
| 192 / ₺662k | "8 pompa 8 şarj koyduk, oyunun eğlencesi bitti 2 günde. sürekliliği kalmadı." |
| 173 / ₺1.59M | "milyonlarca para var ama harcayacak yer yok" |
| 153 / ₺4k | "31 tane self yıkama açtım, amaç kalmadı" |
| 99 / ₺22k | "oyun bitti bende arsa kalmadı bişey kalmadı" |
| 69 / ₺62k | "belli bir süreden sonra nükleer hariç hepsi yapıldı sonrası yok" |
| 60 / ₺4.7k | "oyun bitti artık napcam" |
| 246 / ₺500k | "fiyatı 2 katına çekmeme rağmen hâlâ müşteri geliyor" |

---

## 4. Tycoon/Idle Türünün Genel Kuralları (Literatür)

Kaynaklardan derlenen ve BenelOil'e doğrudan uygulanan ilkeler:

1. **Kazanç eğrisi logaritmik olmalı** — lineer sıkar, üstel geç oyun parasını anlamsızlaştırır. Doğru nokta: erken hızlı, orta istikrarlı, geç yavaşlayan ama **yeni hedeflerle tazelenen**. *(Althera Games, sim ekonomi analizi)*

2. **Her musluğun bir gideri olmalı.** Gider yoksa enflasyon ve "para anlamını yitirdi" hâli kaçınılmaz. Bakım, vergi, dekorasyon, sertifikasyon klasik sink'ler. *(Gold sink literatürü; Althera)*

3. **Sert tavan (hard cap) yerine yumuşak tavan (soft cap).** Yumuşak tavan yasaklamaz, sadece yavaşlatır — oyuncu farkında olmadan yavaşlar ve **yeni strateji aramaya başlar.** Aynı şeyden daha fazla almak, farklı bir şey denemekten daha verimsiz hâle gelir. *(Althera; Paradox forum ekonomi tartışması: "mevcut maksimuma ulaşınca genişletme maliyeti artmalı, ROI lojistik eğri gibi olmalı")*

4. **20 saatten uzun sim oyunlarında yumuşak reset (soft reset) neredeyse zorunlu.** Oyuncu her şeyi alabilir hâle gelince motivasyon çöker. Çözüm yeni bir kademe açmak: yeni şehir, yeni müşteri sınıfı, yeni yatırım hedefi. Bu, **oyuncunun emeğini silmeden** parayı değersizleştirir. Stardew Valley'nin Ginger Island'ı ders kitabı örneği. *(Althera)*

5. **Prestij, tür standardı sonsuz ilerleme motorudur.** Idle Miner Tycoon'da her maden **6 kademeye kadar** ayrı ayrı prestij yapılabilir; prestij o madeni sıfırlar ama **kalıcı gelir çarpanı** verir. Kıta yapısı ile birleşince ilerleme fiilen sonsuzlaşır. Kritik detay: prestij ekranında **"prestij sonrası kazancın 2.3× olacak"** gibi somut önizleme gösterilmezse oyuncu resetlemeyi kayıp olarak algılar.

6. **Pasif gelir < aktif gelir olmalı**, yoksa oyuncu bizzat oynamak istemez. (Ekibin `coklu-lokasyon-tasarim.md`'sinde zaten doğru saptanmış.)

7. **Geç oyun rolü değişmeli, yok olmamalı.** Gas Station Simulator ve The Last Gas Station'da tekrarlayan görevler yüzünden geç oyun "sıkıcı" olarak eleştiriliyor; oyuncular ise **vardiya planlama, personel atama, otomatik stok** gibi *yönetim katmanı* istiyor. Yani geç oyun = pompacılıktan **CEO'luğa terfi**.

8. **LiveOps ritmi retention'ın kendisidir.** Casual başlıklarda anlamlı bir etkinlik/içerik düşüşü **2-4 haftada bir**; günlük görev + haftalık sıralama + sezonluk koleksiyon üçlüsü standart. Ve kritik uyarı: **bitişi olan koleksiyonlar sert içerik tavanı yaratır** — tamamlayan oyuncunun motivasyonu düşer; bu yüzden sektör "sonsuz tekrarlanabilir" sezonlara geçti.

9. **Yatay + dikey + döngüsel ilerlemeyi birlikte kullan.** Sadece dikey (daha büyük sayı) treadmill hissi verir.

---

## 5. ÇÖZÜM MİMARİSİ — 4 Katman

> **Tasarım ilkesi:** Mobil ısınma şikâyetleri (%22) yüzünden geç oyun büyümesi **araç sayısını artırarak** yapılamaz. Büyüme ekseni **₺/müşteri** olmalı, **müşteri/saniye** değil. Bu, hem performansı korur hem de daha derin bir ekonomi verir.

### Katman 1 — Tavanı kaldır, doygunluğu yumuşat *(2-3 gün)*

**1a. `entryChance` sert tavanını yumuşak tavana çevir**

```ts
// state.ts:407 — mevcut Math.min(0.95, ...) yerine
const raw = c * boost
const ent = raw <= 0.80
  ? raw
  : 0.80 + 0.15 * (1 - Math.exp(-(raw - 0.80) / 0.25))
return Math.max(0.05, ent)
```

| Ham `c` | Eski | Yeni |
|---|---|---|
| 0.80 | 0.80 | 0.80 |
| 0.95 | 0.95 | 0.87 |
| 1.20 | 0.95 | 0.92 |
| 1.37 | 0.95 | 0.94 |

Etkisi: son yatırımlar **hâlâ bir şey yapıyor** (azalan verimle) ve — daha önemlisi — **fiyat kaldıracı canlanıyor**, çünkü artık tavana yaslanmıyor.

**1b. Trafik arzını gelişmişliğe + reklama bağla**

```ts
// cars.ts:790 — sabit yerine
const pull = 1 + 0.15*state.signLevel + 0.6*state.marketingLevel  // 1.0 .. ~2.05
this.nearTimer = (1.5 + Math.random()*1.8) / pull
transitCap = state.lowPowerMode ? 18 : 18 + Math.round(8 * (pull-1))
```

Mobilde `lowPowerMode` ile araç sayısı sabit kalır; masaüstünde artar. **Ana kazanç yine de 1c'den gelecek.**

**1c. ₺/müşteri eksenini aç — GEÇ OYUNUN ASIL MOTORU**

Şu an `DEMAND_AMOUNTS = [100,150,200,250,300,400]` sabit. Öneri: müşteri **segmentleri** ekle; segment kilidi itibar + tesis + kapasiteyle açılsın.

| Segment | Talep | Açılış koşulu | Not |
|---|---|---|---|
| Standart (mevcut) | ₺100-400 | — | — |
| Premium yakıt müşterisi | ₺300-600, **marj ×1.6** | Tank Sv.4 + itibar ≥4.3 | Yeni yakıt türü değil, mevcut yakıtın "premium" varyantı |
| TIR / filo aracı | ₺800-2.000 | TIR parkı + 2 dizel tankı | Zaten var olan TIR sistemi işe yarar hâle gelir |
| Otobüs / servis | ₺1.200-2.500 | Geniş kapı + 6+ pompa | Yer/akış planlaması gerektirir |
| Kurumsal filo (sözleşmeli) | Bkz. Katman 4 | Sözleşme sistemi | Asıl derinlik burada |

**Hedef:** geç oyunda ortalama satış ₺233 → **₺700-900**. Araç sayısı **sabit**, gelir **3-4×**. Mobil performans korunur.

---

### Katman 2 — Sink mimarisi kur *(3-4 gün)*

**Kural:** Geç oyunda toplam zorunlu gider, brüt gelirin **%55-70'i** olmalı. Böylece net birikim düzleşir (logaritmik eğri) ama oyuncu asla batmaz.

**2a. Varlığa bağlı işletme gideri (OPEX)**

```ts
dailyOpex() {
  const equip = this.equipmentValue()      // pompa+EV+tesis alış değerleri toplamı
  const land  = this.landValue()           // sahip olunan arsaların güncel değeri
  return Math.round(
      0.0020 * equip        // amortisman + bakım
    + 0.0020 * land         // emlak vergisi
    + this.dailyWages()     // mevcut yovmiye
    + this.utilityBill()    // elektrik/su — gridRate zaten var, faturaya çevir
  )
}
```

Ölçekleme kontrolü:

| Aşama | Ekipman değeri | Günlük OPEX | Brüt gelir | Net |
|---|---|---|---|---|
| Gün 5 (1 pompa) | ₺5.000 | ~₺10 | ~₺600 | +₺590 |
| Gün 40 (4 pompa, market, tabela) | ₺90.000 | ~₺500 | ~₺3.000 | +₺2.500 |
| Gün 100 (tam istasyon) | ₺700.000 | ~₺3.900 | ~₺7.000 | +₺3.100 |
| Gün 200 (her şey maks) | ₺1.335.000 | **~₺7.100** | ₺9.051 | **+₺1.950** |

Erken oyunu **hiç** etkilemiyor (₺10/gün), geç oyunda birikimi %65 kesiyor. Tam istenen davranış.

**2b. Kalıcı, tekrarlayan sink'ler**

| Sink | Mekanik | Neden |
|---|---|---|
| **Reklam/pazarlama bütçesi** | Oyuncu günlük ₺0-8.000 ayarlar → `marketingLevel` 0-1 → trafik ×1.0-1.6 | **En önemlisi.** Parayı doğrudan talebe çeviren sink. Sonsuza kadar anlamlı, çünkü sınır yok ve azalan verimli. |
| Ruhsat & denetim | 30 günde bir ₺X (varlıkla ölçekli); ödenmezse itibar cezası | Ritim + tehdit |
| Sigorta primi | Günlük; ödenmezse SMR patlaması/arıza maliyeti tam yansır | Mevcut risk sistemine bağlanır |
| Personel eğitimi | Pompacı Sv.1-5; her seviye hız/bahşiş/hata oranı iyileştirir, maaşı artırır | Feedback'te 76 kayıt personel istiyor |
| Dekorasyon / kozmetik | Peyzaj, aydınlatma, marka renkleri, özel tabelalar — gelir etkisi ~0, itibar +küçük | Klasik "parayı göster" sink'i (#216: "estetik dekorasyon malzemeleri hiç yok") |
| Ekipman yaşlanması | Her ünitenin `wear` değeri; %100'de verim −%40, yenileme maliyeti alışın %60'ı | Varlıkları "kalıcı" olmaktan çıkarır |

**2c. Ölü sermayeyi geri döndür**
Yıkma/satma her yapı için mümkün olsun (alış değerinin %50'si). Feedback'te tekrar eden şikâyet ("hava su ünitesinin yıkılmaması çok saçma", "otopark yıkılmıyor"). Bu aynı zamanda **yeniden planlama** eylemini bir strateji hâline getirir.

---

### Katman 3 — Yeni dikey: Franchise / Prestij *(1-2 hafta)*

Ekibin `coklu-lokasyon-tasarim.md`'si doğru yolda. İki katkı:

**3a. Açık kararın cevabı: A (ortak şirket kasası) — ama lokasyon bazlı P&L ile**

Gerekçe:
- Katman 2'deki **kurumsal sink'ler** (vergi, ruhsat, reklam, HQ) tek kasa ister; lokasyon başına kasa bunları anlamsızlaştırır.
- Geç oyunun kimlik fantezisi "istasyon sahibi" değil **"holding patronu"**; tek kasa bu fantezinin taşıyıcısı.
- B modeli "hangi cüzdandan" kafa karışıklığı yaratır ve lokasyonlar arası yatırımı bloke eder — yani **yeni lokasyon açmayı cezalandırır.**
- Mevcut `facDaily` / `facTotal` / `salesLog` altyapısı zaten lokasyon bazlı raporlamaya uygun; refactor maliyeti sanıldığından düşük.

**Uygulama:** `money` `GameState`'ten `Company`'ye taşınır; her `location.s` kendi `facDaily`/`salesLog`'unu tutar, Ofis ekranı lokasyon bazlı kâr/zarar tablosu gösterir.

**3b. Prestij: "Devret" mekaniği (reset değil, satış)**

Ham reset türk oyuncu tabanında kayıp olarak algılanır (feedback'te save silinmesine verilen tepkiler bunu gösteriyor). Bunun yerine **anlatısal olarak tutarlı** bir versiyonu:

```
İSTASYONU DEVRET
  Değerleme: ekipman + arsa + son 30 gün kârının 20 katı  →  ₺X nakit
  Kazanç:    +1 Marka Yıldızı (kalıcı)
  Etki:      Tüm lokasyonlarda gelir ×(1 + 0.25 × yıldız)  ve  giriş kapasitesi +%10
  Kayıp:     O lokasyon sıfırlanır (arsa/yerleşim korunur, ekipman gider)
  Önizleme:  "Devirden sonra bu istasyon 2.3× daha hızlı büyür"  ← ZORUNLU
```

Idle Miner Tycoon modelini takip et: **lokasyon başına 6 kademe**, her kademe daha pahalı ve daha yüksek çarpanlı. 4 lokasyon × 6 kademe = **24 kademelik sonsuz-hissi ilerleme.**

**3c. Şehir katmanı**

| # | Lokasyon | Açılış | Karakteri belirleyen kısıt |
|---|---|---|---|
| 1 | **Anadolu Kasabası** | Başlangıç | Mevcut denge — öğrenme alanı |
| 2 | **Şehir Çevre Yolu** | ₺500k + 2 Marka Yıldızı | Arsa ×2.5, yer dar → yerleşim optimizasyonu |
| 3 | **Otoyol Dinlenme Tesisi** | ₺2M + 6 yıldız | Hız yüksek → *yavaşlama şeridi* zorunlu; TIR/otobüs ağırlıklı, sözleşme merkezli |
| 4 | **Marina / Deniz Kıyısı** | ₺5M + 9 yıldız | Kara aracı YOK — tekne; kapasite iskeleyle sınırlı, ₺/müşteri 20× |
| 5 | **Metropol** | ₺12M + 14 yıldız | EV ağırlıklı, arsa ×6, çok kısıtlı alan |

Her lokasyon aynı motoru kullanır (kod tekrarı yok) ama **farklı optimal strateji ve farklı görsel kimlik** taşır — yatay ilerleme.

> **Ayrıntılı tasarım:** Marina şubesinin tam hizmet kurgusu ve her lokasyonun çevre düzenlemesi/sanat yönü için bkz. **§6 — Lokasyon Atlası**.

---

### Katman 4 — Sonsuz katman: Sözleşmeler, sıralama, sezon *(sürekli)*

**4a. B2B Sözleşme sistemi — geç oyunun karar motoru**

Bu, raporun en yüksek ROI'li tek önerisi olabilir: **mevcut tank/tanker/lojistik sistemlerini yeniden anlamlı kılıyor**, yeni 3D asset gerektirmiyor.

```
📋 BELEDİYE OTOBÜS FİLOSU
   Süre:    15 gün
   Taahhüt: günde 3.000 L dizel
   Fiyat:   ₺8.20/L  (piyasa altı — marj düşük ama hacim garantili)
   Bonus:   tamamlarsan +₺180.000 ve itibar +0.3
   Ceza:    yakıt yetmezse gün başına ₺12.000
   Şart:    dizel kapasitesi ≥ 6.000 L
```

Neden işe yarıyor:
- **Tank kapasitesine gerçek bir sebep** verir (şu an 20k litre "çok fazla" diye şikâyet var)
- **Başarısızlık riski** yaratır → gerilim geri gelir
- **Hacim** getirir ama **araç sayısını artırmaz** → mobil performans korunur
- Zorluk kademeli ölçeklenir → sonsuz içerik, sıfır asset maliyeti
- Oyuncuya *planlama* yaptırır: "bu sözleşmeyi alırsam perakendeye yakıt kalır mı?"

Sözleşme tipleri: kargo filosu, taksi durağı, tarım kooperatifi (mevsimsel), inşaat şantiyesi (LPG), belediye, kamu ihalesi (yüksek hacim + denetim riski).

**4b. Piyasa dalgalanması**
`FUEL_COST` sabit (benzin 6.5, dizel 6.0, LPG 4.0). Bunu günlük ±%15 dalgalanan bir seriye çevir + 7 günlük tahmin grafiği. Böylece:
- **Stoklama** stratejik bir karar hâline gelir (ucuzken doldur)
- Mevcut "yakıt indirimi" promosyonu bu sistemin özel hâli olur
- Tank kapasitesi yatırımının ikinci gerekçesi doğar

**4c. Sıralama + sezon**
- **Read-only leaderboard** (istasyon adı + net varlık + günlük ciro) — 6 feedback doğrudan istiyor, teknik maliyeti düşük, sosyal döngüyü açar
- **Haftalık meydan okuma:** "Bu hafta en çok EV kWh satan 10 istasyon" → ödül kozmetik + Marka Yıldızı ilerlemesi
- **Sezonluk tema:** yaz tatili trafiği (+%40 TIR/tatilci), kış (EV menzil düşer, şarj talebi artar), bayram trafiği
- Ritim: literatürün önerdiği gibi **14 günde bir** anlamlı etkinlik; 3-4 günlük döngüler oyuncuyu yakar
- **Kritik:** sezonluk koleksiyonlar **tekrarlanabilir** olsun (bitişli koleksiyon = yeni içerik tavanı)

**4d. Rakip istasyon (ileri seviye, opsiyonel)**
Şehir 2+'de yol karşısında AI rakip: fiyat savaşı, pazar payı yüzdesi, kampanya karşılığı. Bu, fiyat kaldıracına **gerçek** bir anlam verir. Yüksek maliyetli — Katman 1-3 tamamlanmadan başlanmamalı.

---

## 6. Lokasyon Atlası — Çevre Düzenlemesi ve Şube Kurguları

### 6.0 İlke: lokasyon bir "skin" değil, bir kısıt seti

Yeni lokasyonu sadece farklı ağaçlarla döşemek, oyuncuya **aynı oyunu ikinci kez oynatmak** olur — ki bu, §2'de teşhis edilen doygunluk probleminin tekrarıdır. Her lokasyon üç şeyi birden değiştirmeli:

1. **Görsel kimlik** — zemin, yol, ışık, palet, çevre propları, ses
2. **Trafik topolojisi** — aracın istasyona *nasıl* ulaştığı (bu, en çok fark yaratan kısım)
3. **Ekonomik kısıt** — hangi kaldıracın işe yaradığı (fiyat mı, tabela mı, kapasite mi, sözleşme mi)

Aşağıdaki beş lokasyonun her biri bu üçünde de ayrışıyor. Ortak motor (satış, tank, kumbara, arıza, banka, personel) **birebir yeniden kullanılıyor**.

---

### 6.1 Teknik temel — `LocationTheme` tanımlayıcısı

Tek bir veri yapısı tüm görsel ve topolojik farkı taşısın; sahne kurulumu bunu okusun. Böylece yeni lokasyon eklemek = yeni bir tema nesnesi yazmak.

```ts
export interface LocationTheme {
  id: 'kasaba' | 'cevreyolu' | 'otoyol' | 'marina' | 'metropol'
  name: string

  // --- zemin & atmosfer ---
  ground:  { tex: string; tint: number; tile: number }
  sky:     { day: number; night: number; fog: number }
  light:   { sunColor: number; sunAngle: number; ambient: number }
  palette: { surface: number; line: number; accent: number; vegetation: number }

  // --- yol / seyir yolu ---
  lane: {
    kind: 'road' | 'water'
    count: number            // tek yöndeki şerit sayısı
    width: number            // şerit genişliği (birim)
    median: boolean          // orta refüj
    barrier: boolean         // bariyer (araç karşıya geçemez)
    rampLength: number       // 0 = doğrudan giriş; >0 = yavaşlama/hızlanma şeridi
    speed: number            // taban hız çarpanı
    markings: 'dashed' | 'solid' | 'none' | 'buoys'
  }

  // --- trafik karışımı (model → ağırlık) ---
  vehicleMix: Record<string, number>

  // --- çevre propları: yol bandına prosedürel serpiştirme ---
  props: { model: string; density: number; band: [number, number]; jitter: number; scale: [number, number] }[]

  // --- ses ---
  ambient: { loop: string; oneshots: string[] }

  // --- ekonomik ayar ---
  econ: { entryBase: number; priceElasticity: number; repWeight: number; signWeight: number; tipRate: number }
}
```

**Prosedürel çevre serpiştirme** (tek fonksiyon, tüm lokasyonlar için):

```ts
function decorateRoadside(theme: LocationTheme, seed: number) {
  const rng = mulberry32(seed)                    // determinist → save'e yazmaya gerek yok
  for (const p of theme.props) {
    const count = Math.round(p.density * 220)     // yol uzunluğu 220 birim
    for (let i = 0; i < count; i++) {
      const y = -110 + rng() * 220
      const side = rng() < 0.5 ? -1 : 1
      const x = side * (p.band[0] + rng() * (p.band[1] - p.band[0]))
      if (Car.isSolidAt(x, y)) continue           // yerleşimi bozma
      const g = fitModel(lib[p.model], p.scale[0] + rng() * (p.scale[1] - p.scale[0]))
      g.position.set(x, y + (rng() - 0.5) * p.jitter, 0)
      g.rotation.z = rng() * Math.PI * 2
      scene.add(g)
    }
  }
}
```

Determinist seed sayesinde her oyuncunun sahili/kasabası **kendine özgü ama kalıcı** olur (istasyon adının hash'i seed olabilir — ücretsiz kişiselleştirme).

---

### 6.2 Lokasyon 1 · Anadolu Kasabası *(mevcut)*

| | |
|---|---|
| **Zemin** | Kuru toprak, seyrek bozkır otu, taş sekiler |
| **Yol** | 2 şerit, kesikli sarı orta çizgi, **toprak banket** (araç bankete taşabilir) |
| **Çevre propları** | Kavak sırası, taş duvar, kerpiç ev, su kuyusu, seyyar tezgâh, uzakta minare silüeti, saman balyası |
| **Palet** | Sıcak toprak (#c9a86a), sarımsı öğle ışığı, uzun akşam gölgeleri |
| **Trafik karışımı** | Eski sedan %30, kamyonet %25, minibüs %15, traktör %10, motosiklet %10, TIR %10 |
| **Ses** | Cırcır böceği, uzaktan köpek, traktör motoru, rüzgâr |
| **Ayırt edici mekanik** | **Müdavim müşteri.** Düşük trafik ama aynı araçlar tekrar gelir. Bir aracı 3+ kez doğru servis edersen "müdavim" olur: ismiyle selamlar, bahşişi ×1.5, itibar kaybını yarıya indirir. |
| **Optimal strateji** | İtibar ve hizmet kalitesi. Fiyat esnekliği düşük (alternatif yok), tabela önemsiz (herkes zaten biliyor). |

Kenney kiti: mevcut `city/suburban` + Nature Kit (kavak/çalı).

---

### 6.3 Lokasyon 2 · Şehir Çevre Yolu

| | |
|---|---|
| **Zemin** | Asfalt, beton kaldırım, parke taş adacıklar |
| **Yol** | **2×2 şerit + orta refüj** (yeşil bant, ağaçlı), yaya geçidi, **trafik ışığı** |
| **Çevre propları** | Apartman blokları, billboard, otobüs durağı, çöp konteyneri, bisiklet yolu, trafo, AVM silüeti |
| **Palet** | Gri-mavi beton, gece neon tabelalar (istasyon geceleri daha canlı) |
| **Trafik karışımı** | Taksi %20, sedan %25, ticari araç %15, **moto kurye %15**, belediye otobüsü %10, EV %15 |
| **Ses** | Şehir uğultusu, korna, otobüs freni, ezan (gün döngüsüne bağlı) |
| **Ayırt edici mekanik** | **Kırmızı ışık avantajı.** Işık ~40 sn'de bir kırmızıya döner, istasyon önünde kuyruk oluşur. Kırmızı süresince `entryChance` ×2.2 — sıkışan sürücü "hazır durmuşken" giriyor. Oyuncu bu 15 saniyelik pencereleri yakalamayı öğrenir. **Ayrıca yaya müşteri:** yaya geçidinden gelen müşteriler araçsız markete girer (yakıt yok, sadece market/kafe cirosu). |
| **Optimal strateji** | Market/kafe cirosu ve hızlı servis. Kapasite planlaması: ışık kuyruğunu karşılayacak pompa sayısı. |

Kenney kiti: mevcut `city/commercial` + `city/roads` (trafik ışığı, yaya geçidi zaten var).

---

### 6.4 Lokasyon 3 · Otoyol Dinlenme Tesisi

**Kullanıcının özellikle istediği "otobanda yol düzeni farklı olmalı" maddesi burada karşılanıyor** — ve bu, sadece görsel değil **mekanik** bir fark.

| | |
|---|---|
| **Zemin** | Geniş beton apron, sarı park çizgileri, yağ lekeleri |
| **Yol** | **2×3 şerit, orta bariyerle bölünmüş.** Karşı yön fiziksel olarak erişilemez → *karşı istasyon burada YOK*, bunun yerine ayna simetrik ikinci tesis (ayrı yatırım). |
| **Yeni yol öğesi** | **Yavaşlama şeridi (20 birim) + hızlanma şeridi (24 birim)** — istasyona doğrudan sapma yok |
| **Çevre propları** | Gürültü bariyeri, yüksek direkli aydınlatma (12 m), yön levhaları, kilometre taşı, TIR park cebi, uzakta dağ silüeti, elektrik hattı |
| **Palet** | Soğuk beton grisi, geceleri turuncu sodyum lambaları, uzun ışık hüzmeleri |
| **Trafik karışımı** | **TIR %35**, otobüs %15, karavan %10, sedan %25, EV %15 |
| **Ses** | Yüksek hızlı araç geçişi (doppler), TIR hava freni, rüzgâr |

#### Yol topolojisinin oyuna etkisi

```
      ══════════════════════════════════  ← 3. şerit (hızlı, hiç sapmaz)
      ══════════════════════════════════  ← 2. şerit
      ══════════╗                ╔═══════  ← 1. şerit
                ╚════ YAVAŞLAMA ═╝
                    ↓  (20 birim)
              ┌──── TESİS APRONU ────┐
                    ↓  (24 birim)
                ╔═══ HIZLANMA ═══╗
      ══════════╝                ╚═══════
```

Üç yeni kural, üçü de yeni karar üretir:

1. **Sapma kararı erken verilir.** Araç, yavaşlama şeridine girmek için tesisten 40 birim önce 1. şeride geçmeli. Geç fark ederse **kaçırır** — yeni bir kayıp müşteri türü. Bu, `signLevel`'ı hayati hale getirir: tabela ne kadar büyükse karar o kadar erken verilir. *(Kasabada tabela önemsizdi; burada birinci kaldıraç.)*
2. **Yavaşlama şeridi kuyruklanabilir.** Kapasitesi 3 araç. Doluysa arkadan gelen giremez ve otobana geri döner → kayıp. Bu, "apron kapasitesi" yatırımına gerçek bir sebep verir.
3. **Hızlanma şeridinde birleşme zor.** Yüksek hızlı akışa katılmak için boşluk gerekir; boşluk yoksa araç şeridin sonuna kadar bekler. Çıkış tıkanırsa apron dolar → **domino etkisi.** Trafik raporundaki (§5) rezervasyon tabanlı grafik mimarisi burada zorunlu hale gelir.

| **Ayırt edici mekanik** | **Kaçan müşteri & sözleşme merkezli ekonomi.** Fiyat esnekliği neredeyse sıfır (sürücünün alternatifi yok, 60 km sonraki tesis) → fiyatı yükselt, kimse kaçmaz. Ama itibar da önemsiz (kimse geri gelmiyor). Geriye tek kaldıraç kalır: **hacim ve sözleşme.** Filo anlaşmaları, TIR kart sistemi, otobüs firması kontratları. |
|---|---|
| **Optimal strateji** | Tabela + apron kapasitesi + TIR tesisleri (duş, çamaşır, uyku kabini, lokanta) + sözleşmeler. |

Kenney kiti: `city/roads` (bariyer, levha) + Highway/Road kit varsa; yoksa mevcut yol düzlemleri parametrik olarak genişletilebilir (`world.ts:318` yol `PlaneGeometry(4.6, 220)` → temadan `count × width`).

---

### 6.5 Lokasyon 4 · MARINA — Deniz Kıyısı Şubesi

> Kullanıcının talebi doğrultusunda tasarlandı. **Kenney Watercraft Kit** (CC0, 45 model, v2.1) temel alınmıştır.

#### 6.5.1 Neden marina, tam olarak doğru dördüncü lokasyon

Bu rapor §5 Katman 1c'de şunu savundu: *geç oyun büyümesi araç sayısıyla değil, **₺/müşteri** ile yapılmalı — çünkü geri bildirimlerin %22'si mobil ısınma.* Marina bu ilkenin saf hâli:

| | Otoyol istasyonu | **Marina** |
|---|---|---|
| Ekranda aynı anda entity | 25-30 araç | **6-10 tekne** |
| Müşteri geliş sıklığı | 0.7/sn | **~0.06/sn** (10× az) |
| Ortalama satış | ₺233 | **₺4.500** (19× fazla) |
| Servis süresi | 8-20 sn | **40-150 sn** |
| Net gelir etkisi | taban | **≈2.5×** |
| GPU yükü | taban | **≈0.4×** |

Yani marina, oyuncuya **daha yüksek gelir + daha az ekran kalabalığı** verir. Mobilde ısınma sorununu çözerken geç oyun ekonomisini de açar. İkisi aynı anda.

Ayrıca çekirdek fanteziyi (`WHY-IT-WORKS.md` §2.1: *"pompacı sensin"*) bozmuyor — sadece kıyafeti değişiyor: artık **iskele görevlisisin**. Halatı alırsın, tabancayı seçersin, doldurursun, güverteyi silersin.

#### 6.5.2 Su trafiği modeli

Kara trafiğinin birebir izomorfu; sadece geometri değişiyor. Trafik raporundaki grafik mimarisi (§5) aynen çalışır:

| Kara | Deniz | Not |
|---|---|---|
| Şerit (`LANE_NEAR`) | **Seyir kanalı (fairway)** | Şamandıralarla işaretli, iki yönlü |
| Giriş kapısı | **Liman ağzı** (dalgakıranlar arası) | Tek sıra, doğal darboğaz — kapı tahkimi için ideal |
| Apron | **İç havuz** | Manevra alanı, geniş |
| Pompa slotu | **Yakıt iskelesi mevkisi** | Tekne iskeleye *paralel* yanaşır |
| Bekleme noktası | **Demirleme sahası** | Sırada bekleyen tekne demir atar |
| Otopark | **Bağlama parmakları** (finger pontoon) | Uzunluğa göre yer (8m / 12m / 18m / 24m+) |
| Tanker | **Yakıt ikmal barcı** | Denizden gelir — kara tankerinin muadili |

**Yanaşma (mooring) fazı — yeni ve önemli.** Tekne iskeleye vardığında hemen servis başlamaz:

```
yaklaşma → hız kes → paralel hizalan → halat at (baş + kıç) → usturmaça → SERVİS
                                          ↑
                              3-6 sn, oyuncu "HALAT AL" ile hızlandırabilir (+bahşiş)
```

Bu, kara istasyonundaki "pompaya yanaşma" fazının uzatılmış hâli ve **oyuncuya yeni bir aktif eylem** verir. Geç oyunun "tıklayacak bir şey kalmadı" hissine doğrudan panzehir.

**Fizik farkları (basit ama hissedilir):**
- Tekneler **daha yavaş döner** (dönüş yarıçapı büyük) → yerleşim planlaması gerçekten önemli
- **Sürüklenme (drift):** rüzgâr yönüne göre küçük yanal kayma — yanaşma bir beceri hâline gelir
- **Çarpışma daha affedici:** su üstünde geniş alan var → kara trafiğindeki sıkışma bug'ları buraya taşınmaz *(mevcut trafik borcunu miras almayan temiz bir başlangıç)*

#### 6.5.3 Hizmet kurgusu

**A · Yakıt İskelesi** — çekirdek döngü

| Öğe | Tasarım |
|---|---|
| Yakıt türleri | **Deniz motorini** (ana), **95 oktan kurşunsuz** (dıştan takma motorlar), **ÖTV'siz motorin** (ticari tekneler) |
| Tabanca hatası | Yanlış yakıt cezası kara istasyonundan çok daha ağır: tekne motoru hasarı **−₺15.000** + itibar −0.8 |
| Dolum hızı | `FILL_RATE` düşük (statik elektrik ve taşma riski gerçek) → dolum daha uzun, gerilim daha uzun |
| Taşma cezası | **Denize döküntü** — para cezası + çevre puanı düşer + Mavi Bayrak riski (§6.5.6) |
| **Yakıt Alım Defteri kontrolü** | 🆕 En özgün mekanik — aşağıda |

**🆕 Yakıt Alım Defteri (ÖTV'siz yakıt kontrolü)**

Türkiye'de ticari tekneler (balıkçı, ticari yat) vergi muafiyetli deniz yakıtı alabilir; bunun için tekne bir **yakıt alım defteri** ibraz eder. Bu, oyuna nefis bir karar anı olarak giriyor:

```
🚤 "MAVİ RÜZGAR" — Balıkçı Teknesi
   İstek: 1.800 L  ÖTV'siz motorin   (₺11/L yerine ₺6.5/L)
   📄 Defter ibraz edildi

   [İNCELE]   ← Kota: 1.400/2.000 L · Vize: geçerli · İmza: ✓
   [ONAYLA — ÖTV'siz ver]        [REDDET — tam fiyat teklif et]
```

- **Doğru onay** → düşük marj (%12) ama yüksek hacim + müdavim ticari müşteri
- **Sahte/kotası dolu deftere onay** → sonraki denetimde **₺50.000 ceza** + ruhsat askı riski
- **Haklı reddetme** → müşteri kızar (itibar −0.2) ama güvendesin; bazen tam fiyattan alır
- **Haksız reddetme** → ticari müşteri bir daha gelmez

Zorluk kademeli artar: erken oyunda defterler apaçık, geç oyunda sahtecilik incelir (tarih uyuşmazlığı, silinti, kota aşımı). **Denetim sıklığı** çevre puanı ve geçmiş ihlallere bağlıdır. Bu, "yanlış tabanca" hatasının zihinsel muadili ama *bilgi işleme* eksenli — oyuna yeni bir beceri türü ekler.

---

**B · Bağlama & Marina İşletmesi** — pasif gelir omurgası

| Hizmet | Mekanik | Gelir |
|---|---|---|
| **Bağlama yeri kiralama** | Parmak iskeleye tekne boyuna göre yer sat. Günlük / aylık / **yıllık sözleşme** | Metre-gün başına ₺ · yıllık kontrat = garantili nakit akışı |
| **Şamandıra bağlama** | Ucuz alternatif, iskele yeri gerektirmez, servis erişimi zayıf | Düşük ₺, yüksek kapasite |
| **Rıhtım kolonu (elektrik + su)** | Mevcut **DC şarj mekaniğinin birebir kopyası** — kWh + m³ satışı, sayaç, fiyat kaldıracı | Kod yeniden kullanımı %90 |
| **Süperyat mevkisi** | Tek, çok pahalı, derin su + ağır elektrik altyapısı ister | Tek müşteri = günlük cironun katı |

**C · Teknik Servis (Tersane)** — kışın ekmek kapısı

| Hizmet | Mekanik |
|---|---|
| **Travel lift / tekne asansörü** | Karaya çekme-indirme operasyonu; ücret tonaja göre. Görsel olarak etkileyici bir yapı — marinanın "SMR"i, prestij ögesi |
| **Karada kışlama** | Mevsimlik sözleşme; kara alanı kapasitesi = yeni bir arsa kısıtı |
| **Dip temizliği + zehirli boya (antifouling)** | Süreli iş; tekne 2 gün "serviste" kalır, yer işgal eder → kapasite kararı |
| **Motor bakımı / dıştan takma servisi** | Yağ değişiminin muadili |
| **Elektronik & yelken servisi** | Üst kademe; süperyat müşterisi için kilit |

**D · Çevre & Uyum** — 🆕 yeni risk ekseni

| Hizmet | Mekanik |
|---|---|
| **Atık su tahliyesi (pump-out)** | Zorunlu hizmet. Kurmazsan tekneler denize basar → **sana** çevre cezası yazılır. Kurarsan hem gelir hem koruma. |
| **Atık yağ & pis su toplama** | Periyodik bertaraf gideri (sink) |
| **Yakıt sızıntı bariyeri** | Acil durum ekipmanı — bulundurmak gider, bulundurmamak felaket |
| **Mavi Bayrak sertifikası** | Tüm çevre hizmetleri + temizlik + can güvenliği aktifse kazanılır. Etkisi: itibar +0.5, **süperyat müşterisi kilidi açılır**, denetim sıklığı yarıya iner, marina ücretine %15 prim yapabilirsin. |

**E · Ticaret & Yaşam** — kara istasyonundaki tesislerin deniz karşılıkları

| Marina | Kara muadili | Fark |
|---|---|---|
| Denizci malzemecisi (chandlery) | Market | Halat, can yeleği, olta, harita — sepet tutarı 3× |
| **Buz & yem satışı** | — | 🆕 Sabah 04:00-06:00 balıkçı akınında talep patlaması; buz stoğu erirse kayıp |
| Yat kulübü / sahil restoranı | Restoran | Akşam saatlerinde zirve; manzara kalitesi (dekorasyon) ciroyu etkiler |
| Duş & çamaşırhane | Tuvalet | Gulet mürettebatı için zorunlu; yoksa gulet gelmez |
| Tekne kiralama komisyonu | — | 🆕 Pasif; sezonluk. Filoya bağlı tekne sayısıyla ölçeklenir |
| Dalış merkezi / su sporları | — | 🆕 Jet ski & dalış turu; yaz sezonunda yüksek marj |

**F · Personel** — kara personelinin karşılıkları

İskele görevlisi (pompacı), marina müdürü (müdür), tersane ustası (tamirci), **liman kılavuzu** (🆕 — yanaşmayı hızlandırır, sıkışmayı önler), güvenlik.

#### 6.5.4 Müşteri segmentleri ve ekonomi

| Tekne | Talep | Marj | Servis | Frekans | Ek hizmet talebi |
|---|---|---|---|---|---|
| Jet ski / şişme bot | ₺400-800 | %35 | ~15 sn | çok yüksek | — |
| Sürat teknesi | ₺1.500-3.000 | %38 | ~25 sn | yüksek | yakıt + buz |
| **Balıkçı teknesi (ticari)** | ₺2.000-5.000 | **%12** (ÖTV'siz) | ~40 sn | yüksek (sabah) | buz, yem, defter kontrolü |
| Yelkenli | ₺2.500-6.000 | %30 | ~50 sn | orta | su, elektrik, duş |
| Gulet (mürettebatlı) | ₺4.000-9.000 | %28 | ~60 sn | orta | su, atık, çamaşır, market |
| Motor yat (12-18 m) | ₺6.000-12.000 | %32 | ~70 sn | düşük | tam paket + bağlama |
| **Süperyat (25 m+)** | ₺25.000-60.000 | %28 | ~150 sn | çok düşük | randevulu, özel mevki, VIP servis, Mavi Bayrak şartı |

**Ortalama satış ≈ ₺4.500** (otoyol: ₺233). Geliş sıklığı 10× düşük olduğu için net gelir ≈ 2.5×, ekran yükü ≈ 0.4×.

**Kurulum maliyeti:** ₺5.000.000 + 9 Marka Yıldızı. Bu, §7'deki hedef eğride gün 160-200 bandına denk gelir — yani oyuncunun "harcayacak yer yok" dediği tam noktaya.

#### 6.5.5 Mevsimsellik — marinanın imzası

Marina, oyuna **ilk gerçek mevsim döngüsünü** getirir ve bu, tek başına bir içerik motorudur:

| Sezon | Süre | Tekne trafiği | Baskın gelir | Oyuncunun işi |
|---|---|---|---|---|
| **Yaz** | 90 gün | ×2.5 | Yakıt + restoran + kiralama | Kapasite yönetimi, yetişememe |
| **Sonbahar** | 45 gün | ×1.0 | Yakıt + servis | Bakım, hazırlık |
| **Kış** | 90 gün | **×0.3** | **Kışlama + tersane + sözleşme** | Tamamen farklı bir işletme modeli |
| **İlkbahar** | 45 gün | ×1.2 | Denize indirme + boya + servis | Sezon açılışı yarışı |

Kışın tekne trafiği çöker ama **kışlama ve bakım geliri zirve yapar** — oyuncu iki farklı optimizasyon problemi öğrenir. Bu, tür literatürünün "geç oyunu yeni hedeflerle tazele" ilkesinin somut hâli ve *tekrarlanabilir* (bitişli koleksiyon tuzağına düşmez).

#### 6.5.6 Risk olayları — SMR'ın deniz muadili

Kara istasyonunda nükleer reaktör patlaması var; marinada karşılığı:

| Olay | Tetik | Sonuç | Oyuncunun tepkisi |
|---|---|---|---|
| **🛢️ Yakıt sızıntısı** | Bakımsız hortum/pompa + taşma | Denize yayılım; her saniye ceza büyür | **Bariyer serme mini-oyunu** (60 sn): halka kapatılırsa hasar sınırlı |
| **🌊 Lodos / fırtına** | Rastgele + mevsim ağırlıklı | 60 sn uyarı; sonra bağlantısı zayıf tekneler hasar görür | Tekneleri iç limana al, halatları sıkılaştır, tenteleri topla |
| **⚓ Sürüklenen tekne** | Fırtına + zayıf bağlama | Başka tekneye çarpar, zincirleme hasar | Kılavuz personel varsa otomatik önlenir |
| **🚫 Denetim** | Periyodik + ihlal geçmişine bağlı | Defter/atık/güvenlik kontrolü | Belgeler düzgünse sorunsuz; değilse ağır ceza |
| **🦑 Deniz kirliliği (müsilaj vb.)** | Nadir, sezonluk | Turistik tekne trafiği ×0.4, 20 gün | Temizlik yatırımı süreyi kısaltır |

**Kritik tasarım kuralı:** SMR patlaması "her şey sıfırlanır" hissiyle rage-quit üretmişti (feedback'te bunun izleri var, sonradan yumuşatıldı). Marina olayları **hiçbir zaman kalıcı silme yapmamalı** — ağır ama telafi edilebilir: para cezası, itibar kaybı, Mavi Bayrak'ın geçici kaybı. Hepsi geri kazanılabilir.

#### 6.5.7 Kenney Watercraft Kit — eşleme ve pipeline

Kit: **CC0 1.0 Universal**, 45 model, sürüm 2.1 (*"Separated sails and flags"*), OBJ + FBX + glTF formatlarında, ~1.7 MB. Atıf zorunlu değil ama uygun (`public/kenney/License.txt` zaten var, aynı kalıp izlenir).

**Kurulum** — mevcut pipeline'a birebir oturuyor:

```
public/kenney/watercraft/
  ├── Textures/colormap.png
  ├── boat-*.glb  ship-*.glb  ...
  └── License.txt
```

```ts
// src/models.ts — mevcut loadStatics() kalıbının aynısı
export interface BoatLib { [key: string]: THREE.Group | null }

export async function loadBoats(): Promise<BoatLib | null> {
  try {
    const loader = new GLTFLoader()
    const load = (n: string) =>
      loader.loadAsync(`/kenney/watercraft/${n}.glb`)
        .then(g => convert(g.scene as unknown as THREE.Group))
        .catch(() => null)
    const names = BOAT_MANIFEST                    // aşağıdaki komutla üretilen liste
    const models = await Promise.all(names.map(load))
    return Object.fromEntries(names.map((n, i) => [n, models[i]]))
  } catch (e) { console.warn('Watercraft modelleri yüklenemedi:', e); return null }
}
```

> **Not:** Kitin tam dosya adları indirilen zip'ten doğrulanmalı — bu rapor için erişilemedi. Manifesti üretmek için:
> ```bash
> unzip -Z1 kenney_watercraft-pack.zip | grep -i '\.glb$' | xargs -n1 basename | sed 's/\.glb$//' | sort
> ```
> Aşağıdaki eşleme **sınıf** bazlıdır; adlar manifeste göre bağlanır.

| Oyun içi segment | Kitten kullanılacak sınıf | Ölçek (m) | Not |
|---|---|---|---|
| Jet ski / şişme bot | en küçük motorlu tekne / bot | 3-4 | Hızlı, çevik |
| Sürat teknesi | speedboat / motorboat | 6-8 | — |
| Balıkçı teknesi | fishing boat / trawler | 10-14 | Ağ/vinç detayı önemli |
| Yelkenli | sailboat (yelken **ayrı mesh** — v2.1) | 9-12 | Yelken ayrı olduğu için **rüzgârda salınım animasyonu** ücretsiz |
| Gulet | büyük yelkenli / ahşap gövde | 18-24 | Bayrak da ayrı mesh → dalgalanma |
| Motor yat | yacht / cabin cruiser | 12-18 | — |
| Süperyat | en büyük yat/gemi gövdesi | 25-40 | Tek adet; sahnede olayı kendisi |
| Yakıt ikmal barcı | tugboat / cargo | 15 | Tanker muadili |
| Dekor: batık, şamandıra, kayık | wreck, buoy, canoe, kayak | — | Prosedürel serpiştirme |

**Eksik parçalar (kitte yok, üretilecek):** iskele/ponton modülleri, dalgakıran blokları, travel lift, deniz feneri, usturmaça, baba (bollard), halat. Bunlar **basit prosedürel geometri** ile yapılabilir (kutu + silindir) — projede zaten `box()` / `cyl()` yardımcıları var ve pompa/şarj bu şekilde üretiliyor. Alternatif olarak Kenney **Pirate Kit** (iskele, fıçı, direk) ve **Nature Kit** (palmiye, kaya) aynı CC0 lisansıyla eklenebilir.

**Su yüzeyi:** pahalı shader gerekmez. `PlaneGeometry` + iki katman kaydırmalı normal doku + hafif vertex dalgalanması yeterli ve mobil dostudur. Tekneler için küçük bir **köpük izi (wake)** parçacığı ve yumuşak z-salınımı, "canlılık" hissinin %90'ını verir.

**Performans bütçesi:** ekranda ≤10 tekne, ≤3 aktif iz efekti, su düzlemi tek draw call. Otoyol lokasyonunun altında kalmalı.

---

### 6.6 Lokasyon 5 · Metropol

| | |
|---|---|
| **Zemin** | Asfalt, boyalı yön okları, ıslak yansımalar (yağmur olayı) |
| **Yol** | Tek yön 3 şerit + otobüs şeridi, çok dar parsel, **yer altı tankı zorunlu** |
| **Çevre propları** | Gökdelen silüetleri, metro girişi, taksi durağı, dijital billboard, scooter park |
| **Palet** | Gece-ağırlıklı, neon, ıslak asfalt yansıması |
| **Trafik** | EV %40, taksi %20, moto kurye %25, sedan %15 — **TIR yok** |
| **Ayırt edici mekanik** | **Alan kıtlığı.** Arsa ×6 pahalı ve sadece 2 parsel var. Her metrekare kararı ağır. Şarj kuyruğu asıl darboğaz; TIR parkı/tersane gibi büyük tesisler imkânsız → **dikey yatırım** (çok katlı otopark, yer altı tankı) tek çıkış. |
| **Optimal strateji** | EV altyapısı + hız + market cirosu. Yakıt marjı ikincil. |

---

### 6.7 Ortak: içerik üretim maliyeti

| Lokasyon | Yeni 3D varlık | Yeni mekanik | Tahmini süre |
|---|---|---|---|
| Kasaba (mevcut) | — | Müdavim müşteri | 2 gün |
| Çevre yolu | Trafik ışığı, yaya, refüj | Işık penceresi, yaya müşteri | 4 gün |
| Otoyol | Bariyer, levha, yüksek direk | **Ramp/merge topolojisi** | 6 gün *(grafik mimarisi şart)* |
| **Marina** | Watercraft Kit + iskele/dalgakıran/lift | Su trafiği, yanaşma, defter, mevsim, Mavi Bayrak | **10-14 gün** |
| Metropol | Gökdelen silüeti, neon | Alan kıtlığı, dikey yapı | 5 gün |

Marina en pahalısı ama **en yüksek getirili**: tek başına yeni bir oyun modu hissi veriyor, mevsim sistemini oyuna sokuyor ve mobil performansı *iyileştirerek* geliri artırıyor.

### 6.8 Uygulama sırası

1. **`LocationTheme` altyapısı + tema-güdümlü sahne kurulumu** (mevcut kasaba temaya taşınır, görünür değişiklik yok — güvenli temel)
2. **Çevre yolu** — en ucuz ikinci lokasyon, çoklu-lokasyon save şemasını gerçek yükle test eder
3. **Trafik grafiği mimarisi** *(trafik raporu §5)* — otoyol ve marina bunsuz yapılamaz
4. **Otoyol** — ramp/merge, grafiğin ilk ciddi sınavı
5. **Marina** — mevsim sistemi + su trafiği; en büyük içerik sıçraması
6. **Metropol** — son kademe, mevcut sistemlerin sıkıştırılmış hâli

---

## 7. Öncelik Matrisi

| # | İş | Efor | Etki | Kanıt gücü | Sıra |
|---|---|---|---|---|---|
| 1 | `entryChance` yumuşak tavan | **XS** (1 fonksiyon) | **Çok yüksek** | Matematiksel kanıt + 3 feedback kümesi | **🔴 1** |
| 2 | Reklam/pazarlama bütçesi sink'i | S | **Çok yüksek** | Tür standardı | **🔴 2** |
| 3 | Varlığa bağlı OPEX | S | **Çok yüksek** | 6 geç-oyun feedback | **🔴 3** |
| 4 | Müşteri segmentleri (₺/müşteri) | M | **Çok yüksek** | Mobil perf kısıtıyla uyumlu | **🔴 4** |
| 5 | Müdür + toplu kumbara toplama | S | Yüksek | ~15 feedback | 🟠 5 *(Faz 4'te planlı)* |
| 6 | Sözleşme sistemi | M | **Çok yüksek** | Mevcut sistemleri diriltir | 🟠 6 |
| 7 | Personel derinliği (kademe/maaş/skill) | M | Yüksek | 76 feedback | 🟠 7 |
| 8 | Yıkma/satma her yapı için | XS | Orta | 8 feedback | 🟠 8 |
| 9 | Piyasa dalgalanması | S | Orta-yüksek | 4 feedback | 🟡 9 |
| 10 | Leaderboard (read-only) | S | Orta | 6 feedback | 🟡 10 |
| 11 | Çoklu lokasyon + prestij (veri katmanı) | **L** | **Çok yüksek** | Yapısal çözüm | 🟡 11 |
| 12 | `LocationTheme` altyapısı (§6.1) | M | Yüksek | Tüm lokasyonların ön koşulu | 🟡 12 |
| 13 | Lokasyon: Çevre Yolu | M | Yüksek | En ucuz 2. lokasyon | 🟡 13 |
| 14 | Dekorasyon/kozmetik sink | M | Orta | 3 feedback | 🟢 14 |
| 15 | Sezonluk etkinlik altyapısı | M | Yüksek (D30) | Tür standardı | 🟢 15 |
| 16 | Lokasyon: Otoyol (ramp/merge) | L | Yüksek | Trafik grafiği şart | 🟢 16 |
| 17 | **Lokasyon: MARİNA** | **XL** | **Çok yüksek** | Yeni oyun modu hissi + mevsim + mobil dostu | 🟢 17 |
| 18 | Lokasyon: Metropol | M | Orta-yüksek | Son kademe | 🟢 18 |
| 19 | AI rakip istasyon | XL | Yüksek | 3 feedback | 🟢 19 |

**Önerilen ilk sprint (1 hafta):** #1 + #2 + #3 + #8.
Bu dört madde tek başına *"para birikiyor, yapacak şey yok"* şikâyetinin **kök nedenini** kapatır ve toplam eforu ~3 gündür. #4 ve #6 ikinci sprint.

**Lokasyon hattı ayrı bir iş kolu.** #11 → #12 → #13 sırayla ilerlemeli; #16 ve #17 trafik raporundaki grafik mimarisi tamamlanmadan başlatılmamalı. Marina (#17) uzun vadeli hedef olarak yol haritasında görünmeli — oyunculara duyurulacak "büyük güncelleme" bu olmalı.

---

## 8. Hedef Ekonomi Eğrisi

Şu anki durum ve hedef:

```
Net birikim / oyun-günü

MEVCUT:  ▁▂▃▅▇███████████████████  (lineer, sonsuz birikim)
HEDEF:   ▁▂▄▆▇▇▆▅▄▄▃▃▃▂▂▂▂▂▂▂▂▂▂▂  (logaritmik, düzleşen)
                    ↑         ↑
              prestij açılır  yeni şehir
```

**Somut hedef sayılar:**

| Gün | Brüt/gün | OPEX/gün | Net/gün | Kümülatif nakit | Oyuncunun sorduğu |
|---|---|---|---|---|---|
| 10 | ₺900 | ₺40 | ₺860 | ₺8k | "2. pompayı mı market mi?" |
| 40 | ₺3.000 | ₺500 | ₺2.500 | ₺70k | "EV'ye mi geçsem, restoran mı?" |
| 80 | ₺6.000 | ₺2.800 | ₺3.200 | ₺190k | "Reklam bütçesini artırsam mı?" |
| 120 | ₺9.000 | ₺5.500 | ₺3.500 | ₺340k | "Bu sözleşmeyi alırsam yakıt yeter mi?" |
| 160 | ₺13.000 | ₺9.000 | ₺4.000 | ₺500k | "Devretsem mi, 2. şehri mi açsam?" |
| 200+ | ₺20.000+ | ₺14.000+ | ₺6.000 | — | "Marka yıldızı için hangi lokasyonu devredeyim?" |

Kritik nokta: **her satırda oyuncunun cevaplaması gereken bir soru var.** Şu an gün 60'tan sonra soru kalmıyor.

**Sağlık testi (her build'de):** ₺122k'lık standart istasyonda 30 dakika hiç tıklamadan bekle. Net birikim, aynı sürede yapılabilecek en ucuz **anlamlı** yükseltmenin maliyetini **aşmamalı**. Aşıyorsa sink yetersiz.

---

## 9. Ölçüm Planı

| Metrik | Nasıl | Hedef |
|---|---|---|
| **Doygunluk günü** | `entryChance ≥ 0.90` olan ilk gün (telemetri) | 60 → **150+** |
| **Nakit/varlık oranı** | `money / assets()` | Gün 100'de < 0.25 (şu an çok yüksek) |
| **Harcama frekansı** | Son 10 günde ≥1 satın alma yapan gün-80+ oyuncu oranı | > %70 |
| **"Oyun bitti" feedback oranı** | Geç oyun segmentinde tema payı | %7 → **< %2** |
| **D7 / D30** | `last_seen_at` bazlı | D7 %23 → %35+; D30 ölç ve taban belirle |
| **Gün-100 üstü oyuncu sayısı** | Haftalık | Mutlak artış |
| **Sözleşme tamamlama oranı** | Alınan / başarılı | %60-75 (çok yüksekse kolay, çok düşükse cezalandırıcı) |
| **Lokasyon dağılımı** | Oyuncu başına açılmış lokasyon sayısı | Gün 200'de medyan ≥ 2 |
| **Lokasyon başına oturum payı** | Hangi şubede ne kadar vakit geçiriliyor | Hiçbiri < %10 olmamalı (ölü lokasyon = kötü tasarım) |
| **Marina: ₺/müşteri** | Ortalama tekne satışı | ≈ ₺4.500 (otoyol ₺233'e karşı) |
| **Marina: kare süresi** | Aynı cihazda otoyol vs marina | Marina **daha düşük** olmalı (az entity) |
| **Mevsim etkisi** | Kış dönemi oturum sayısı / yaz | > 0.7 (kışlama geliri işini yapıyorsa oyuncu kaçmaz) |

---

## 10. Riskler ve Yapılmaması Gerekenler

**⚠️ Sadece yeni bina eklemeyin.** "Lastikçi" (3 istek) ve benzeri talepler haklı ama Kusur #1 düzelmeden eklenirse: yeni bina → `entryChance` zaten tavanda → trafiğe etkisi sıfır → oyuncu 2 gün oynayıp aynı şikâyeti tekrarlar. **Önce formül, sonra içerik.**

**⚠️ Enflasyon şoku yapmayın.** OPEX'i mevcut oyunculara geriye dönük tam uygulamak "param eriyor" tepkisi doğurur. Kademeli devreye alın (10 günde %0→%100 rampası) ve **ilk gün açık bir bildirimle** duyurun.

**⚠️ Prestiji zorunlu kılmayın.** Gönüllü olsun; önizleme (`2.3× hızlı büyüme`) zorunlu olsun. Save silinme travması taze — reset kelimesini kullanmayın, **"devret"** deyin.

**⚠️ Mobil performansı unutmayın.** Feedback'in %22'si mobil/ısınma. Trafik yoğunluğunu artıran her çözüm burada risk. Bu yüzden geç oyun büyümesi **₺/müşteri** üzerinden kurgulandı — bu bir tercih değil, kısıt.

**⚠️ Sunucu senkronu.** `state.ts`'teki her maliyet/limit değişikliği `server/index.js` COST/clamp tablosuna yansıtılmalı; yoksa "param gitti ürün yok" sınıfı hatalar geri gelir (Faz 0'da kapatılmıştı).

**⚠️ Güvenlik notu (ekonomiyle ilgili).** `beneloil-db-backup-20260719.sql` public repo'nun kökünde duruyor. İçinde oyuncu e-postaları/save'leri varsa bu bir veri sızıntısıdır; dosyayı silmek yetmez — git geçmişi de temizlenmeli (`git filter-repo` / BFG) ve sızmış kredensiyeller rotasyona sokulmalı. Ayrıca feedback #14'te bir oyuncu `/api/save` doğrulama açığını bildirmiş; ekonomi değişikliklerinden önce kapatılmalı, yoksa yeni denge de sömürülür.

**⚠️ Lokasyonu "skin" olarak yapmayın.** Sadece ağaçları ve zemini değiştiren bir ikinci harita, §2'deki doygunluk problemini bir kez daha üretir — oyuncu 2 gün oynar, "aynı oyun" der. Her lokasyon **§6.0'daki üç eksende de** (görsel + topoloji + ekonomik kısıt) ayrışmalı. Ayrışmıyorsa o lokasyonu yapmayın.

**⚠️ Marinayı trafik borcu ödenmeden başlatmayın.** Karşı istasyonun bugünkü hâli (bkz. trafik raporu), yaka aynalamasının yarım kalmasından kaynaklanıyor. Su trafiği yeni bir geometri ailesi; mevcut ad-hoc waypoint sistemiyle yapılırsa **aynı hata sınıfı üçüncü kez** yaşanır. Grafik mimarisi önce.

**⚠️ Marina risk olayları asla kalıcı silme yapmasın.** SMR patlamasının "her şey gitti" hissi rage-quit üretmişti. Sızıntı, fırtına ve denetim ağır olsun ama **telafi edilebilir** olsun: para, itibar, geçici Mavi Bayrak kaybı — hepsi geri kazanılabilir.

**⚠️ Watercraft Kit dosya adları doğrulanmalı.** Bu rapordaki eşleme sınıf bazlıdır; kitin gerçek dosya adları indirilen zip'ten (`unzip -Z1 … | grep .glb`) çıkarılıp manifest oluşturulmalı. Lisans CC0 — ticari kullanım serbest, atıf zorunlu değil ama `public/kenney/watercraft/License.txt` mevcut kalıba uygun şekilde eklensin.

**⚠️ Mevsim sistemi save şemasını etkiler.** `season` ve `seasonDay` alanları **additive** eklenmeli; eski save'ler yaz sezonunun 1. gününden başlatılmalı (`docs/FAZ-PLANLARI.md` çalışma kuralı: save formatı yalnız additive).

---

## 11. Özet

BenelOil'in geç oyun problemi içerik eksikliğinden değil, **üç matematiksel sınırdan** kaynaklanıyor:

1. Talep `entryChance` 0.95'te sert kesiliyor → **₺122k'dan sonraki her yatırım trafiğe ölü**
2. Trafik arzı sabit → **gelir tavanı ₺9k/gün, aşılamıyor**
3. Sink yok → **para birikiyor, harcanacak yer yok**

Bu üçü sırasıyla **yumuşak tavan**, **₺/müşteri ekseni** ve **varlığa bağlı OPEX + reklam sink'i** ile çözülüyor — toplam efor yaklaşık **3-4 gün**. Ondan sonra sözleşmeler, prestij ve çoklu lokasyon oyunu *sonsuz* hâle getiriyor.

**Lokasyon sistemi (§6) bu mimarinin tepe taşı.** Beş lokasyonun her biri farklı bir kısıt öğretiyor: kasabada itibar, çevre yolunda zamanlama, otoyolda kapasite ve sözleşme, marinada ₺/müşteri ve mevsim, metropolde alan. Aynı motor, beş farklı optimizasyon problemi.

Marina şubesi ayrıca teknik bir çelişkiyi çözüyor: geri bildirimlerin %22'si mobil ısınmadan şikâyetçi, ama geç oyun daha fazla gelir istiyor. Marina **10× daha az entity ile 19× daha yüksek müşteri değeri** getirerek ikisini birden karşılıyor — ve mevsim döngüsüyle oyuna ilk gerçek "yılın farklı zamanında farklı oyun" katmanını ekliyor.

Oyunun asıl gücü (`WHY-IT-WORKS.md`'de doğru saptandığı gibi) **pompacı olma fantezisi**. Geç oyun bu fantaziyi öldürmemeli, **terfi ettirmeli**: pompacıdan istasyon sahibine, oradan holding patronuna. Marinada bile oyuncu hâlâ halatı alan, tabancayı seçen, güverteyi silen kişi — sadece iskelede. Şu an oyun oyuncuyu bu yolculuğun ikinci adımında bırakıyor.

---

*Kaynaklar: repo kodu (`src/state.ts`, `src/cars.ts`, `src/main.ts`, `src/models.ts`, `src/world.ts`, `docs/WHY-IT-WORKS.md`, `docs/MAJOR-PLAN.md`, `docs/coklu-lokasyon-tasarim.md`) · 529 oyuncu feedback kaydı · Kenney Watercraft Kit (kenney.nl/assets/watercraft-kit — CC0, 45 model, v2.1) · Althera Games — Economy Design in Simulation Games · Idle Miner Tycoon Wiki (prestij/kıta yapısı) · Naavik — Live Ops Trends · Gas Station Simulator ve The Last Gas Station oyuncu/inceleme geri bildirimleri · gold sink & progression curve literatürü*

*İlgili doküman: `beneloil-trafik-ve-karsi-istasyon-cozum-raporu.md` — §6.4 (otoyol ramp) ve §6.5 (marina su trafiği) oradaki grafik mimarisine bağımlıdır.*
