# BenelOil — Trafik Sistemi & Karşı (2.) İstasyon: Hata Analizi ve Çözüm Raporu

**Tarih:** 26 Temmuz 2026
**Kapsam:** `src/cars.ts` (1455 satır), `src/main.ts` trafik/yerleşim bölümleri, `src/world.ts` geometri · 529 geri bildirim
**Konu:** Yolun karşısına 2. istasyon açıldığında oluşan trafik hataları + genel yol bulma / sıkışma sorunları

---

## 0. Yönetici Özeti

**529 geri bildirimin 215'i (%41) trafikle ilgili.** Bu, oyunun tek başına en büyük şikâyet kümesi — ekonomiden de, bug'lardan da, mobilden de büyük.

Kod incelemesi, sorunun "rastgele path bug'ları" olmadığını gösteriyor. **Beş kesin, tekrarlanabilir koordinat/mimari hatası** var ve bunların üçü doğrudan karşı istasyonu bozuyor:

| # | Hata | Etki | Efor |
|---|---|---|---|
| **B1** | Karşı pompa/şarjın çarpışma kutusu **3.6 birim yanlış yerde** — hayalet duvar tam karşı kapı koridorunun üstünde, gerçek pompanın ise hiç çarpışması yok | 🔴 Karşı istasyonu fiilen kullanılamaz kılıyor | XS |
| **B2** | Çıkışta "yol ver" mantığı **sadece near koordinatlarında** (`p.x > 3.9 && p.x < 6.70`) | 🔴 Karşı istasyondan çıkanlar hiç yol vermiyor | XS |
| **B3** | `rerouteForGates()` başında `if (c.station !== 'near') continue` — ama oyuncu karşı kapıları **taşıyabiliyor** | 🔴 Karşı kapı taşınınca araçlar eski kapıya sürüp duvara çakılıyor | XS |
| **B4** | Otopark yerleri **pozisyon indeksiyle** takip ediliyor; bina taşınınca/eklenince indeksler kayıyor | 🔴 "Sadece bir otopark kullanılıyor", "araçlar üst üste biniyor" | S |
| **B5** | `WAIT_SPOTS` **sabit dünya koordinatı** — oyuncunun koyduğu binaları bilmiyor | 🟠 Araçlar binanın içinde bekliyor | S |
| **B6** | Tır parkı yolları **near-only sabit** (`x = 4.0`) | 🟠 Karşıya konan tır parkı hiç kullanılmıyor (₺12.000 ölü yatırım) | S |
| **B7** | Çarpışma kutuları **dönmeyi (rotation) hiç dikkate almıyor** | 🟠 90° döndürülmüş pompa/bina yanlış şekilde engel | XS |
| **B8** | Tek-nüsha tesisler + yaka filtresi → karşı yakada **sessiz gelir/servis kaybı** veya yayanın otoyolu geçmesi | 🟠 Karşı istasyon "yarım" hissettiriyor | M |

**B1+B2+B3 toplam efor: yarım gün. Karşı istasyon şikâyetlerinin ~%80'ini kapatıyor.**

Ayrıca kök mimari sorun var: **trafik sisteminde yol ağı (graph) yok.** Rota, gönderim anında hesaplanan serbest waypoint listesi; çakışma yönetimi tamamen reaktif (3.6 birimlik ileri koni). Bu yüzden her düzeltme yerel bir yamaya dönüşüyor ve kod tarihçesi ardışık yamalarla dolu. §5'te rezervasyon tabanlı bir mimari öneriliyor.

---

## 1. Mevcut Trafik Mimarisi — Nasıl Çalışıyor

```
spawnTransit(lane)                      ← sabit aralıkla araç doğur
   ↓  y = DECISION_Y noktasında
tryEnter(car)                           ← boş slot ara, REZERVE et
   ↓
entryPath(slot, station)                ← 4 waypoint'lik serbest rota üret
   ↓
Car.update()                            ← waypoint'e doğru yürü + katı cisimden kay
   ↓  her karede, tüm araçlar için
çarpışma taraması O(n²)                 ← 3.6 birim ileri koni, 1.25 yan → hold
   ↓
kilit çözümü                            ← kafa-kafaya dodge / zincir döngü kırıcı
   ↓
recoverStuck (6 sn) → evaporate (3.5-9 sn)   ← SİGORTA: aracı yok et
   ↓
releaseCar() → çıkış rotası
```

**Güçlü yanları:** çok sayıda özel durum yaması sayesinde near istasyon çoğu zaman akıyor; `evaporate` sayesinde kalıcı kilitlenme yok.

**Zayıf yanları:**
- Rota üretimi **statik**; üretildikten sonra dünya değişse bile (bina konuldu, kapı taşındı) rota güncellenmez — ancak elle `rerouteForGates()` çağrılırsa.
- Çakışma yönetimi **rezervasyonsuz**: iki araç aynı dar koridora aynı anda girer, sonra "kim geri çekilecek" pazarlığı yapılır.
- Kavşak kavramı yok. Kapı ağzı (giriş kuyruğu × çıkış akışı × şerit trafiği) üç akımın kesiştiği nokta ama hiçbir tahkim yok.
- `evaporate` bir çözüm değil, **kaybı gizleyen bir örtü**. Oyuncu "araç bir anda kayboldu" diye görüyor ve müşteri sessizce kayboluyor.

---

## 2. KESİN HATALAR — Kanıt, Kök Neden, Düzeltme

---

### 🔴 B1 · Karşı pompa/şarjın çarpışma kutusu 3.6 birim yanlış yerde

**BU RAPORUN EN ÖNEMLİ BULGUSU.**

#### Kök neden

`world.ts:1155` — araç yanaşma yuvası karşı yakada **aynalanıyor**:

```ts
const far = base.x > ROAD_X
const flip = far ? -1 : 1
this.pumpSlots[index] = new THREE.Vector3(base.x + Math.cos(ang) * 1.8 * flip, base.y + Math.sin(ang) * 1.8, 0)
```

`main.ts:1795-1802` — ama çarpışma kutusu **aynalanmıyor**:

```ts
for (let i = 0; i < state.pumps; i++) {
  const s = world.pumpSlots[i]
  r.push({ cx: s.x - 1.8, cy: s.y, w: 1.5, d: 3.4 })   // ← flip YOK
}
for (let i = 0; i < state.evChargers; i++) {
  const s = world.evSlots[i]
  r.push({ cx: s.x - 1.1, cy: s.y, w: 0.9, d: 1.4 })   // ← flip YOK
}
```

Sonuç, karşı yakada (`base.x = 15.0` örneği):

| | Near (doğru) | **Far (hatalı)** |
|---|---|---|
| Pompa gövdesi | 15.0 değil, ör. 5.0 | **15.0** |
| Araç yuvası (`pumpSlots`) | 6.8 | 13.2 |
| Çarpışma kutusu (`hardRects`) | 5.0 ✅ | **11.4** ⛔ |
| Sapma | 0 | **3.6 birim BATIYA** |

Yani karşı yakada:
1. **Gerçek pompanın hiç çarpışma kutusu yok** → araçlar pompanın içinden geçiyor
2. **Pompadan 3.6 birim batıda görünmez bir duvar var** → tam olarak `FAR_GATE_X = 11.6` kapı koridorunun üstünde

Hesaplama (3 farklı yerleşim için):

```
POMPA base.x=13.5 → hardRect x 9.15..10.65   ⛔ koridor (10.10..13.10) ile çakışıyor
POMPA base.x=15.0 → hardRect x 10.65..12.15  ⛔ TAM KAPININ (11.6) ÜSTÜNDE
POMPA base.x=16.5 → hardRect x 12.15..13.65  ⛔ koridor içinde
ŞARJ  base.x=13.5 → hardRect x 10.85..11.75  ⛔ TAM KAPININ (11.6) ÜSTÜNDE
```

**Karşı yakaya kurulan her pompa/şarj, karşı istasyonun giriş kapısının önüne görünmez bir duvar dikiyor.** 4 pompa = 4 görünmez duvar. Araç kapıdan girmeye çalışıyor, duvara çarpıyor, `insideSolid` kaydırma denemesi yapıyor, sonunda `hardStuckT > 3.5` ile buharlaşıyor.

#### Kanıt (feedback)

| Gün | Kayıt |
|---|---|
| 238 | "yolun karşısına istasyon koyunca araçlar **çok değişik bir yol izliyor**... ve **çakışıyor araçlar hep**" |
| 150 | "yolun karşısındaki istasyonda araçlar yakıt alırken takılıyor, **5 araçtan 1 tanesi** yakıt alabiliyor" |
| 137 | "Karşı yola istasyon kurunca yakıt alan araçlar **istasyondan yola çıkamıyorlar. İçeride takılı kalıyorlar**" |
| 59 | "karşı yolda araçlar giremiyor, **değişik hareketler yapıyor**" |
| 41 | "Pompaları yan yan koyduğumda araçlar sıkışıyor, **2. istasyona geçiş yapamıyor**" |

**43 kayıt bu kümede (20'si hâlâ açık).** "Değişik bir yol izliyor" ifadesi tam olarak `insideSolid` duvar-boyu-kayma davranışının görüntüsü.

#### Düzeltme — hızlı yama (tek satır × 2)

```ts
// main.ts:1795
for (let i = 0; i < state.pumps; i++) {
  const s = world.pumpSlots[i]
  const flip = s.x > ROAD_X ? -1 : 1
  r.push({ cx: s.x - 1.8 * flip, cy: s.y, w: 1.5, d: 3.4 })
}
for (let i = 0; i < state.evChargers; i++) {
  const s = world.evSlots[i]
  const flip = s.x > ROAD_X ? -1 : 1
  r.push({ cx: s.x - 1.1 * flip, cy: s.y, w: 0.9, d: 1.4 })
}
```

#### Düzeltme — doğru çözüm (B7 ile birlikte)

Slot'tan geriye türetmek kırılgan. `world`, gerçek gövde konumunu zaten biliyor — onu kullan:

```ts
// world.ts — addPump / addEvCharger içinde slot ile birlikte kaydet
this.pumpBase[index] = base.clone()
this.evBase[index]   = base.clone()

// main.ts:1793 — hardRects()
function unitRect(base: THREE.Vector2, ang: number, w: number, d: number) {
  const swap = Math.abs(Math.sin(ang)) > 0.5          // 90°/270° → en-boy takas (B7)
  return { cx: base.x, cy: base.y, w: swap ? d : w, d: swap ? w : d }
}
for (let i = 0; i < state.pumps; i++)
  r.push(unitRect(world.pumpBase[i], world.pumpAngles[i] ?? 0, 1.5, 3.4))
for (let i = 0; i < state.evChargers; i++)
  r.push(unitRect(world.evBase[i], world.evAngles[i] ?? 0, 0.9, 1.4))
```

Aynı düzeltme `fixedObstacles()` (main.ts:1833-1841) için de **şart** — orada da `cx: s.x - 0.9` / `cx: s.x - 0.6` aynı hatayı yapıyor. Bu yüzden oyuncu karşı yakada gerçek boş alana bina koyamıyor, gerçek pompanın üstüne ise koyabiliyor.

#### Kabul kriteri
`?full=1` modunda karşı yakaya 4 pompa + 4 şarj kur. 5 dakika izle: sıfır buharlaşma, sıfır "duvara sürtünme" hareketi. Debug overlay'de (§6) hayalet dikdörtgen görünmemeli.

---

### 🔴 B2 · Karşı istasyondan çıkan araçlar yaklaşan trafiğe yol vermiyor

#### Kök neden

`cars.ts:838-853`:

```ts
for (const c of this.cars) {
  if (c.hold || c.phase !== 'leaving') continue
  const p = c.group.position
  const inMergeZone = p.x > 3.9 && p.x < LANE_NEAR - 0.25     // ← 3.90 .. 6.70 (NEAR)
  if (!inMergeZone) continue
  const laneBusy = this.cars.some(o => {
    if (o === c || o.lane === 'far') return false             // ← far şerit yok sayılıyor
    ...
    if (o.phase === 'leaving' && o.group.position.x > 5.2 ...) // ← 5.2 NEAR sabiti
  })
  if (laneBusy) c.hold = true
}
```

Karşı istasyonun çıkışı `FAR_GATE_X = 11.6`'dan `LANE_FAR = 8.85`'e. Yani **gereken birleşme bölgesi 9.10..11.60** — mevcut kontrolün tamamen dışında. Ayrıca `o.lane === 'far'` filtresi karşı şerit trafiğini zaten hesaba katmıyor.

**Sonuç:** karşı istasyondan çıkan araç, akan karşı-şerit trafiğinin içine kör dalıyor. Reaktif çarpışma sistemi devreye giriyor, iki araç kilitleniyor, kapı ağzı tıkanıyor, arkadan gelenler birikiyor.

#### Kanıt

| Gün | Kayıt |
|---|---|
| 137 | "Karşı yola istasyon kurunca yakıt alan araçlar **istasyondan yola çıkamıyorlar**" |
| 102 | "karşı taraftan ana benzinliğe geçmeye çalışanlar **benzinlik çıkışını tıkıyor**" |
| 37 | "karşı yola kurduğum benzincide **çıkışta aşırı tıkanıyor** arabalar" |

#### Düzeltme — yakaya göre genelleştir

```ts
// cars.ts:838 — tamamını değiştir
for (const c of this.cars) {
  if (c.hold || c.phase !== 'leaving') continue
  const G = this.geom(c.station)
  const p = c.group.position
  // birleşme bölgesi: kapı ile servis şeridi arası (her iki yaka için simetrik)
  const lo = Math.min(G.gateX, G.lane) + 0.25
  const hi = Math.max(G.gateX, G.lane) - 0.25
  if (p.x <= lo || p.x >= hi) continue

  const laneBusy = this.cars.some(o => {
    if (o === c || o.lane !== c.station) return false        // yalnız KENDİ şeridi
    const oy = o.group.position.y
    // "arkadan yaklaşan" seyir yönüne göre tanımlanır (near +y, far −y)
    const behind = G.dirY > 0 ? (oy > p.y - 12 && oy < p.y + 1.5)
                              : (oy < p.y + 12 && oy > p.y - 1.5)
    if (o.phase === 'transit' && !o.hold && behind) return true
    // az önce şeride katılmış öndeki araç yeterince açılmadıysa bekle
    const merged = G.sideSign < 0 ? o.group.position.x > G.lane - 1.75
                                  : o.group.position.x < G.lane + 1.75
    const ahead  = G.dirY > 0 ? (oy > p.y - 1 && oy < p.y + 6)
                              : (oy < p.y + 1 && oy > p.y - 6)
    if (o.phase === 'leaving' && merged && ahead) return true
    return false
  })
  if (laneBusy) c.hold = true
}
```

#### Kabul kriteri
Karşı istasyonda 5 dakikada hiçbir araç karşı-şerit transit aracıyla çakışmamalı; çıkış kuyruğu apron'da (kapı içinde) beklemeli, şeridin üstünde değil.

---

### 🔴 B3 · Karşı kapı taşınınca hiçbir araç yeniden rotalanmıyor

#### Kök neden

`cars.ts:1146-1148`:

```ts
rerouteForGates() {
  for (const c of this.cars) {
    if (c.station !== 'near') continue    // ← "karşı kapılar sabit/otomatik"
```

Yorum satırı karşı kapıların sabit olduğunu varsayıyor. **Ama değiller.** `main.ts:2152-2153`:

```ts
else if (id === 'gatein2')  { world.buildGate('in',  new THREE.Vector2(cx, cy), 'far'); cars.rerouteForGates() }
else if (id === 'gateout2') { world.buildGate('out', new THREE.Vector2(cx, cy), 'far'); cars.rerouteForGates() }
```

Oyuncu karşı kapıyı taşıyor → `rerouteForGates()` çağrılıyor → fonksiyon **karşı yakadaki her aracı atlıyor** → araçlar eski kapı koordinatına sürmeye devam ediyor → çite/binaya çakılıyor → buharlaşıyor.

#### Kanıt

| Gün | Kayıt |
|---|---|
| 346 | "**2. istasyonda giriş çıkış yeri değişmiyor**" |
| 137 | "Karşı yola istasyon kurunca... İçeride takılı kalıyorlar" |
| 168 | "yolun diğer tarafındaki alana işletme koyduktan sonra arabalar **ne yaparsam yapayım tıkanıyor**" |

#### Düzeltme — `sideSign` ile genelleştir

Fonksiyondaki tüm `x` eşikleri near koordinatı (`5.5`, `3.9`, `1.75`, `0.45`). Bunları **derinlik** cinsinden yaz:

```ts
rerouteForGates() {
  for (const c of this.cars) {
    const G = this.geom(c.station)
    const p = c.group.position
    // depth: kapıdan istasyonun içine doğru mesafe. Negatif = hâlâ yol tarafında.
    const depth = G.sideSign < 0 ? (G.gateX - p.x) : (p.x - G.gateX)
    const innerLane = new THREE.Vector3(G.gateX + G.sideSign * 1.75, 0, 0)

    if (c.phase === 'driving' && depth < -1.3) {
      // henüz yolda: baştan tam giriş rotası
      if (c.slotIndex >= 0) {
        const slot = c.kind === 'ev' ? this.opts.evSlot(c.slotIndex) : this.opts.pumpSlot(c.slotIndex)
        c.setPath(this.entryPath(slot, c.station), () => this.arriveAtSlot(c))
      } else if (c.waitIndex >= 0) {
        c.setPath([
          new THREE.Vector3(G.lane, G.gateInY - G.dirY * 3.5, 0),
          new THREE.Vector3(G.gateX, G.gateInY, 0),
          this.waitSpotAt(c.waitIndex, c.station),
        ], () => { c.phase = 'waiting' })
      }
    } else if (c.phase === 'driving') {
      // apron içinde: kalan rotayı mevcut konumdan kur (eski kapı waypoint'i atılır)
      if (c.slotIndex >= 0) {
        const slot = c.kind === 'ev' ? this.opts.evSlot(c.slotIndex) : this.opts.pumpSlot(c.slotIndex)
        c.setPath([new THREE.Vector3(innerLane.x, slot.y - G.dirY * 2.5, 0), slot.clone()],
                  () => this.arriveAtSlot(c))
      } else if (c.waitIndex >= 0) {
        c.setPath([this.waitSpotAt(c.waitIndex, c.station)], () => { c.phase = 'waiting' })
      }
    } else if (c.phase === 'leaving' && depth > -1.3) {
      const outY = G.gateOutY
      c.setPath([
        new THREE.Vector3(G.gateX, outY, 0),
        new THREE.Vector3(G.lane, outY + G.dirY * 4, 0),
        new THREE.Vector3(G.lane, G.dirY * 44, 0),
      ])
    }
  }
}
```

**Ek:** `rerouteForGates()` yalnız kapı taşınınca çağrılıyor. **Pompa, şarj veya herhangi bir bina taşındığında da çağrılmalı** — şu an bir pompa taşınınca ona giden araç eski konuma sürüyor. `main.ts`'te `Car.solids = hardRects()` yazan **3 yerin hepsinde** (817, 2380, 3790) hemen ardından `cars.rerouteForGates()` çağrılsın.

#### Kabul kriteri
Trafik akarken karşı kapıyı 5 kez taşı. Hiçbir araç eski kapı konumuna gitmemeli, hiç buharlaşma olmamalı.

---

### 🔴 B4 · Otopark yerleri pozisyon indeksiyle takip ediliyor → indeks kayması

#### Kök neden

`world.ts:1626` her çağrıda **yeni bir dizi** üretiyor, sırası `this.buildings` dizisinin sırasına bağlı:

```ts
getParkingSpots() {
  const spots = []
  for (const b of this.buildings) {
    if (!(b.id === 'parking' || b.id.startsWith('parking#'))) continue
    for (let i = 0; i < 4; i++) spots.push({ pos, stage, rot })
  }
  return spots
}
```

`cars.ts` bunu **paralel bir diziyle** takip ediyor:

```ts
private parkOcc: (Car | null)[] = []
...
while (this.parkOcc.length < spots.length) this.parkOcc.push(null)
...
car.slotIndex = spot           // ← pompa indeksiyle AYNI alan!
this.parkOcc[spot] = car
```

Üç ayrı arıza:

1. **Bina taşınınca indeksler kayıyor.** `movePump` kalıbıyla aynı: `removeBuildingGroup` + yeniden `register` → bina `buildings` dizisinin **sonuna** gidiyor → o otoparkın 4 yeri artık farklı indekste. Halihazırda park etmiş araçlar yanlış yerleri işgal ediyor gösteriyor, yeni gelen araç **fiziksel olarak dolu** bir yere gönderiliyor.
2. **Bina yıkılınca `parkOcc` küçülmüyor.** Dizi hiç kısaltılmıyor (`while (length < spots.length) push`) → ölü kayıtlar kalıyor → o indeksler sonsuza kadar "dolu".
3. **`car.slotIndex` aşırı yüklenmiş.** Hem pompa hem şarj hem otopark indeksi olarak kullanılıyor; `releaseCar` / `evaporate` hangi diziyi temizleyeceğine `phase`'e bakarak karar veriyor. Faz geçişi sırasında hata olursa **slot kalıcı olarak kilitleniyor**.

#### Kanıt

| Gün | Kayıt |
|---|---|
| 242 | "**bir süre sonra** park eden araçlar - park yerine girmek isteyen araçlar **tamamı üst üste biniyor hiç biri hareket edemiyor**" |
| 108 | "otoparkların **sadece birine park ediliyor** hep. **otopark doluluk hatası**" |
| 106 | "**Sadece ilk otopark kullanılıyor**" |
| 170 | "araçlar otoparkın yönüne göre park etmiyorlar" |

**38 kayıt (35'i açık).** "Bir süre sonra" ifadesi kritik — hata anında değil, oyuncu bir şeyler taşıdıkça birikerek ortaya çıkıyor. Bu, indeks kaymasının imzası.

#### Düzeltme — kararlı kimlik (stable ID)

```ts
// world.ts
getParkingSpots(): { id: string; pos: THREE.Vector3; stage: THREE.Vector3; rot: number }[] {
  const spots = []
  for (const b of this.buildings) {
    if (!(b.id === 'parking' || b.id.startsWith('parking#'))) continue
    const g = b.group as THREE.Group
    g.updateMatrixWorld(true)
    for (let i = 0; i < 4; i++) {
      const lx = -1.53 + i * 1.02
      spots.push({
        id: `${b.id}:${i}`,                     // ← KARARLI KİMLİK
        pos: new THREE.Vector3(lx, -0.1, 0).applyMatrix4(g.matrixWorld),
        stage: new THREE.Vector3(lx, 2.4, 0).applyMatrix4(g.matrixWorld),
        rot: g.rotation.z - Math.PI / 2,
      })
    }
  }
  return spots
}
```

```ts
// cars.ts — dizi yerine Map, ayrı alan
private parkOcc = new Map<string, Car>()
// Car sınıfına: parkId: string | null = null

sendToParking(car: Car): boolean {
  const spots = this.opts.parkSpots()
  if (!spots.length) return false
  // ölü kayıtları temizle (bina taşındı / yıkıldı)
  const live = new Set(spots.map(s => s.id))
  for (const id of [...this.parkOcc.keys()]) if (!live.has(id)) this.parkOcc.delete(id)

  const s = spots.find(s => !this.parkOcc.has(s.id)
    && (s.pos.x > ROAD_X) === (car.station === 'far'))
  if (!s) return false

  // pompayı/şarjı boşalt — slotIndex'i EZME, ayrı alana yaz
  if (car.slotIndex >= 0) {
    if (car.kind === 'ev') this.evOcc[car.slotIndex] = null
    else this.pumpOcc[car.slotIndex] = null
    car.slotIndex = -1
  }
  car.parkId = s.id
  this.parkOcc.set(s.id, car)
  ...
}

releaseCar(car: Car) {
  if (car.parkId) { this.parkOcc.delete(car.parkId); car.parkId = null }
  if (car.waitIndex >= 0) { this.waitOccFor(car.station)[car.waitIndex] = null; car.waitIndex = -1 }
  if (car.slotIndex >= 0) {
    if (car.kind === 'ev') this.evOcc[car.slotIndex] = null
    else this.pumpOcc[car.slotIndex] = null
    car.slotIndex = -1
  }
  ...
}
```

`evaporate()` ve `recoverStuck()` de aynı şekilde `parkId` kullanacak. **Aynı düzeltme `truckOcc` için de gerekli** (`getTruckSpots()` aynı kalıpta).

#### Kabul kriteri
2 otopark kur, doldur, birini taşı, birini yık, üçüncüyü ekle. Her adımda: hiçbir araç dolu bir yere gönderilmemeli, hiçbir yer kalıcı "dolu" kalmamalı. Konsola `parkOcc.size` ile fiili dolu araç sayısını karşılaştıran bir assert eklenebilir.

---

### 🟠 B5 · Bekleme noktaları sabit dünya koordinatı

#### Kök neden

`cars.ts:680`:

```ts
const WAIT_SPOTS = [
  new THREE.Vector3(3.4, -4.6, 0), new THREE.Vector3(3.4, -7.4, 0),
  new THREE.Vector3(3.4, -16.8, 0), new THREE.Vector3(3.4, -19.6, 0),
]
```

Bunlar **mutlak koordinat** ve oyuncunun bina yerleşiminden habersiz. Oyuncu (3.4, −7.4)'e market/tuvalet koyarsa, bekleyen araç binanın içine gönderiliyor. `insideSolid` kaydırması aracı duvar boyunca sürüklüyor → "anlamsız hareketler". Karşı yaka aynası: (12.4, +4.6), (12.4, +7.4), (12.4, +16.8), (12.4, +19.6) — orası da korumasız.

Ayrıca `fixedObstacles()` bu 4 noktayı **rezerve etmiyor** — yalnız servis şeridi (`cx:4.3, w:2.0` → 3.3..5.3) rezerve. Bekleme x'i 3.4 bu bandın kenarında; y aralıkları hiç korunmuyor.

#### Kanıt

| Gün | Kayıt |
|---|---|
| 9 | "Müşteriler araçlarını otoparka çekmek istediğinde **ofisin içine giriyor** ve orada **anlamsız hareketler** yaparak vakit geçiriyorlar" |
| 170 | "araçların yürüdüğü yol - izlediği istikamette biraz sıkıntı var, sürekli **benzin alanlarına çarpmakta**" |

#### Düzeltme — kapıya göreli + katı-cisim kaçınmalı

```ts
// cars.ts — WAIT_SPOTS sabitini kaldır, üret
private static WAIT_OFFSETS = [3.2, 6.0, 8.8, 11.6]   // kapıdan içeri doğru

private waitSpotAt(i: number, st: 'near' | 'far'): THREE.Vector3 {
  const G = this.geom(st)
  const x = G.gateX + G.sideSign * 2.6          // iç bekleme koridoru
  let y = G.gateInY - G.dirY * CarManager.WAIT_OFFSETS[i]
  // katı cisme denk geldiyse koridor boyunca kaydır (maks 6 deneme)
  for (let k = 0; k < 6 && Car.isSolidAt(x, y); k++) y -= G.dirY * 1.4
  return new THREE.Vector3(x, y, 0)
}
```

`Car.insideSolid` şu an `private static` — `isSolidAt` adıyla public bir sarmalayıcı ekleyin.

**Ve** `fixedObstacles()`'a bekleme koridorunu rezerve edin ki oyuncu oraya bina koyamasın:

```ts
r.push({ cx: 4.2 - 2.6, cy: APRON_IN_Y - 7.4, w: 1.8, d: 12.0 })   // near bekleme koridoru
if (world.farStationOn)
  r.push({ cx: FAR_GATE_X + 2.6, cy: APRON_OUT_Y + 7.4, w: 1.8, d: 12.0 })  // far
```

---

### 🟠 B6 · Tır parkı yalnız near yakada çalışıyor

#### Kök neden

`cars.ts:1080` ve `1128`:

```ts
sendTruckToPark(car: Car): boolean {
  if (car.station !== 'near') return false                       // karşı tır giremez
  ...
  if (spots[i].spot.x > ROAD_X) continue                          // karşı park kullanılamaz
  ...
  path.push(new THREE.Vector3(4.0, stage.y, 0))                   // SABİT near koridoru
}
private leaveTruckPark(car: Car) {
  out.push(new THREE.Vector3(this.gateX, this.opts.gateOutY(), 0))   // HEP near kapı
  out.push(new THREE.Vector3(this.serveLane, ...))                   // HEP near şerit
}
```

Sonuç: **karşı yakaya konan tır parkı hiçbir zaman kullanılmıyor** — ₺12.000'lik tamamen ölü bina. Ve near tırı karşıdaki parka giderse (eski davranış) yolu dik kesiyordu.

#### Kanıt
- #269 (g73): "Tır parkında araçlar çıkış yaparken **karşı istasyondaki çıkış yoluna kadar giderek** oradan tekrardan çıkış yapıyor"
- #413 (g72): "Tır parkını oraya koydum **arabalar gelemedi**"

#### Düzeltme
`geom(car.station)` ile genelleştir; sabit `4.0` yerine `G.gateX + G.sideSign * 2.2`, `this.gateX`/`this.serveLane` yerine `G.gateX`/`G.lane`, `44` yerine `G.dirY * 44`. Yaka filtresi `spots[i].spot.x > ROAD_X` yerine `(spots[i].spot.x > ROAD_X) !== (car.station === 'far')` olsun.

---

### 🟠 B7 · Çarpışma kutuları dönmeyi hiç dikkate almıyor

`hardRects()` ve `fixedObstacles()` her birim için **sabit** `w`/`d` kullanıyor. Ama `world.pumpAngles[i]` / `placedRot[id]` ile pompalar, şarjlar ve binalar 90°/180°/270° döndürülebiliyor.

90° döndürülmüş bir pompa: gerçekte 3.4 × 1.7, çarpışma kutusu hâlâ 1.5 × 3.4. Yani **eninde 1.9 birim gerçek gövde korumasız**, boyunda 1.7 birim hayalet duvar.

**Düzeltme:** B1'in "doğru çözüm" bölümündeki `unitRect()` yardımcısı bunu da çözüyor. Aynı `swap` mantığı `placedRects` için de uygulanmalı (`main.ts:1806`) — oradaki `p.w`/`p.d` yerleştirme anında doğru kaydediliyorsa sorun yok, ama `placedRot` sonradan değişiyorsa senkronlanmalı.

---

### 🟠 B8 · Tek-nüsha tesisler + yaka filtresi → sessiz kayıp

`main.ts:1005` ziyaret filtresi:

```ts
return !b || (b.group.position.x > ROAD_X) === (car.station === 'far')
```

Doğru bir kural (yaya otoyolu geçmesin). **Ama** restoran, kafe, tuvalet, yağ değişimi, oto yıkama gibi tesislerden **yalnız bir tane** kurulabiliyor. Karşı yakadaki müşteri tuvalet istiyor, tuvalet near'da:

- `missingPenalty` ceza vermiyor (tesis "var")
- Ziyaret filtresi ziyareti düşürüyor
- **Ne gelir var, ne ceza, ne geri bildirim** → sessiz kayıp

Oyuncu bunu "karşı istasyon para kazandırmıyor" olarak yaşıyor.

#### Kanıt
- #422 (g129): "market, restaurant, kafe, wc, fiyat direği, TIR parkı gibi ögelerden **sadece bir tane alabiliyorum**, tek bir tarafta duruyor"
- #342 (g107): "karşı tarafta market yapamadığımız için karşıtaraftaki müşteriler **yürüyerek otoyoldan karşıya geçiyor**"
- #358 (g242): "yolun karşısına park edip, diğer tarafa yaya geçiyorlar, **arabalar yayalara çarpıyor**"

#### Düzeltme
1. `market2` kalıbını (zaten var) **tüm tesis tiplerine** genelleştir: `toilet2`, `coffee2`, `restaurant2`, `wash2`, `oil2`, `selfwash` zaten çoklu. Kural: *"aynı tip tesisten yaka başına 1 adet"*.
2. Ara dönemde, karşı yakada karşılığı olmayan bir istek için **açık geri bildirim** ver: `missingPenalty`'yi "tesis var ama bu yakada yok" durumunu da kapsayacak şekilde genişlet (küçük ceza + toast: *"🚻 Karşı yakada tuvalet yok — müşteri hoşnutsuz"*). Sessiz kayıp yerine oyuncuya sinyal.
3. Yaya sistemine mutlak kural: `walker` hiçbir koşulda `ROAD_X ± 1.5` bandını geçmesin (assert + güvenlik kesmesi).

---

## 3. Genel (Yakadan Bağımsız) Trafik Sorunları

Bunlar karşı istasyona özgü değil ama aynı kökten besleniyor.

### 3.1 Buharlaşma bir çözüm değil, ölçüm noktası

`cars.ts:970`:

```ts
const atEntry = car.phase === 'driving' && car.group.position.x > 2.5 && car.slotIndex < 0
if (car.hardStuckT > (atEntry ? 3.5 : 9)) this.evaporate(car)
```

Bu, kalıcı kilitlenmeyi önlüyor — iyi. **Ama şu an sessiz.** Öneri: her `evaporate` çağrısını sayaçla ve telemetriye gönder.

```ts
private evapStats = { total: 0, near: 0, far: 0, atEntry: 0, atExit: 0, atPark: 0 }
```

Bu sayaç, **trafik sağlığının tek objektif metriği** olur. Hedef: 10 dakikalık tam yüklü oturumda `total = 0`. Şu an muhtemelen onlarca. Debug overlay'de (§6) canlı gösterin.

### 3.2 `atEntry` eşiği near koordinatlı

Yukarıdaki `car.group.position.x > 2.5` yine near sabiti. Karşı yakada giriş rampası x ≈ 11.6–13.4; `x > 2.5` orada **her zaman doğru** → karşı yakadaki her sıkışan araç 3.5 saniyede buharlaşıyor (9 yerine). Karşı istasyonda müşteri kaybının sessiz sebebi bu.

**Düzeltme:** `const atEntry = car.phase === 'driving' && car.slotIndex < 0 && depthOf(car) > -1.3` (B3'teki `depth` yardımcısı).

### 3.3 Çarpışma taraması O(n²) ve her karede

`cars.ts:805-835` — ~30 araç × 30 araç = 900 vektör işlemi/kare. `extraObstacles()` de her araç için yeniden çağrılıyor. Mobil ısınma şikâyetlerinin (%22) bir bölümü buradan.

**Düzeltme:** basit uniform grid (hücre 4×4 birim) ile komşuluk sorgusu. `Map<string, Car[]>`, her karede bir kez doldurulur, araç yalnız kendi ve komşu 8 hücreye bakar. ~30 satır, %80+ tasarruf.

### 3.4 Kapı ağzında tahkim yok

Kapı ağzı üç akımın kesiştiği tek nokta:
1. Giriş kuyruğu (bankette bekleyen)
2. Çıkış akışı
3. Şerit transit trafiği

`gateInOff()`/`gateOutOff()` yalnız `wideGates` alındıysa (±1.2) ayırıyor. **Geniş kapı yoksa giriş ve çıkış aynı x'i (kapı merkezini) paylaşıyor** ve yalnızca farklı `y`'lerde. Ama `gateInY` ve `gateOutY` oyuncu tarafından **aynı y'ye taşınabiliyor** → giriş ve çıkış tam üst üste → kilitlenme garantisi.

**Düzeltme:** `main.ts:2174`'te zaten `otherY` okunuyor; oraya **minimum ayrım kısıtı** ekleyin: giriş ile çıkış arası `|Δy| ≥ 6` olmadan yerleştirme geçersiz sayılsın (kırmızı önizleme + toast: *"Giriş ve çıkış en az 6 metre ayrı olmalı"*).

### 3.5 Pompa yerleşimi doğrulaması araç koridorunu korumuyor

`fixedObstacles()` pompa için `{cx: s.x - 0.9, w: 4.4, d: 4.0}` rezerve ediyor — bu, pompanın *yanaşma alanı*. Ama **pompadan kapıya giden koridor** (x = `gateX + sideSign*1.75`) rezerve değil. Oyuncu oraya market koyabiliyor.

**Düzeltme:** iç koridoru `fixedObstacles()`'a ekleyin (her iki yaka için):

```ts
r.push({ cx: 4.2 - 1.75, cy: 0, w: 1.6, d: 44 })                    // near iç koridor
if (world.farStationOn) r.push({ cx: FAR_GATE_X + 1.75, cy: 0, w: 1.6, d: 44 })
```

---

## 4. Uygulama Sırası

| Faz | İş | Efor | Beklenen etki |
|---|---|---|---|
| **A** | B1 hızlı yama (flip düzeltmesi, 2 satır) | 15 dk | Karşı istasyon **çalışır hâle gelir** |
| **A** | B2 merge yield genelleştirme | 1 sa | Karşı çıkış tıkanması biter |
| **A** | B3 `rerouteForGates` genelleştirme + solids değişince çağır | 2 sa | Kapı/bina taşıma kaynaklı takılma biter |
| **A** | 3.2 `atEntry` eşiği düzeltmesi | 15 dk | Karşı yakada erken buharlaşma biter |
| **B** | B4 otopark kararlı kimlik (`parkId`) + `truckOcc` | 4 sa | "Üst üste biniyor", "sadece biri kullanılıyor" biter |
| **B** | B1 doğru çözüm + B7 rotasyon (`unitRect`) | 3 sa | Döndürülmüş birimlerdeki hayalet duvarlar biter |
| **B** | 3.1 `evaporate` telemetrisi + debug overlay (§6) | 3 sa | Ölçülebilirlik — bundan sonrası körlemesine olmaz |
| **C** | B5 dinamik bekleme noktaları + koridor rezervasyonu | 4 sa | Binaya çakılma biter |
| **C** | B6 tır parkı yaka desteği | 3 sa | Karşı tır parkı ölü yatırım olmaktan çıkar |
| **C** | 3.4 kapı ayrım kısıtı + 3.5 koridor rezervasyonu | 2 sa | Oyuncunun kendini kilitlemesi engellenir |
| **D** | 3.3 uniform grid (performans) | 4 sa | Mobil ısınmada iyileşme |
| **D** | B8 yaka başına tesis nüshaları | 1-2 gün | Karşı istasyon "tam istasyon" olur |
| **E** | §5 rezervasyon tabanlı trafik mimarisi | 3-5 gün | Yama döngüsü biter |

**Faz A toplam: ~4 saat.** Karşı istasyon şikâyetlerinin büyük çoğunluğunu kapatır.

---

## 5. Orta Vade: Rezervasyon Tabanlı Trafik Mimarisi

Mevcut sistemin kök sorunu, **paylaşılan bir yol ağı olmaması**. Her araç kendi waypoint listesiyle hareket ediyor, çakışmalar sonradan pazarlıkla çözülüyor. Bu, yama sayısı arttıkça karmaşıklığı üstel büyütüyor (kodda ardışık düzeltme yorumlarının uzunluğu bunun kanıtı).

### Önerilen model

**Düğüm + kenar grafiği, istasyon başına türetilmiş:**

```ts
type NodeId = string
interface TrafficNode { id: NodeId; pos: THREE.Vector3; capacity: number }
interface TrafficEdge { from: NodeId; to: NodeId; capacity: number; conflictsWith: NodeId[] }
```

Her istasyon için (near/far, `geom()`'dan otomatik türetilir):

```
şerit_giriş → banket → KAPI_GİRİŞ ─┬→ iç_koridor_K → pompa_yaklaşma[i] → POMPA[i]
                                   └→ bekleme[0..3]
POMPA[i] → çıkış_koridoru → KAPI_ÇIKIŞ → birleşme → şerit_çıkış
otopark_stage[j] → OTOPARK[j] → çıkış_koridoru
```

**Kurallar:**
1. Her kenar bir **kapasiteye** sahip (geniş kapı → 2, normal → 1).
2. Araç hareket etmeden önce **sonraki 2 kenarı rezerve eder**. Rezerve edemezse bulunduğu düğümde bekler.
3. `KAPI_GİRİŞ` ve `KAPI_ÇIKIŞ` **çakışma bölgesi** (conflict zone): aynı anda tek araç, FIFO token.
4. Rezervasyon yapılamazsa araç ilerlemiyor — **çarpışma sonradan çözülmüyor, baştan oluşmuyor.**

### Kazanımlar

| Şu an | Sonra |
|---|---|
| Kafa-kafaya dodge hack'i (`dodgeRight`) | Gereksiz — zıt yönlü kenarlar zaten ayrı |
| Zincir döngü kırıcı (A→B→C→A) | Gereksiz — döngü oluşamaz |
| `evaporate` sigortası | Yalnız gerçek anomali için kalır; normal işleyişte 0 |
| `recoverStuck` + `solidStuckT` dolanma | Gereksiz — rota grafik üzerinde, katı cisme girmiyor |
| Her bina taşınmasında manuel `reroute` | Grafik yeniden türetilir, araçlar en yakın düğümden devam eder |
| Yeni istasyon eklemek = tüm sabitleri aynalamak | Grafik `geom()`'dan üretilir; **N. istasyon bedava** |

Son madde önemli: çoklu lokasyon (`docs/coklu-lokasyon-tasarim.md`) planlanıyor. Mevcut mimariyle her yeni istasyon, B1-B6 sınıfı hataların **tekrar tekrar** yaşanması demek. Grafik modeliyle bu maliyet sıfırlanır.

**Tahmini büyüklük:** ~350-450 satır yeni kod, `cars.ts`'ten ~400 satır yama silinmesi. Net kod artışı ≈ 0, karmaşıklık ciddi düşüş.

---

## 6. Test Protokolü ve Debug Aracı

### 6.1 Debug overlay — `?traffic=1`

Bu olmadan hiçbir düzeltme güvenle doğrulanamaz. Minimum içerik:

- **Katı cisimler** (`Car.solids`) yarı saydam kırmızı dikdörtgen olarak çizilsin → B1/B7 hayalet duvarları **anında görünür**
- **Rezerve alanlar** (`fixedObstacles()`) mavi çerçeve
- **Araç rotaları** (aktif `path`) sarı çizgi
- **Slot durumu**: pompa/şarj/otopark/bekleme dolu-boş renk kodu + sahip aracın id'si
- **HUD sayaçları**: aktif araç, `hold` durumdaki araç, ortalama `holdTime`, **buharlaşma sayacı (near/far/giriş/çıkış/park kırılımlı)**

`?promo=1` ve `?full=1` modları zaten var; aynı kalıpla eklenebilir.

### 6.2 Kabul senaryoları

| # | Senaryo | Kriter |
|---|---|---|
| T1 | `?full=1`, 8 pompa + 8 şarj + 4 tesis, near yaka, 10 dk | Kalıcı kilit 0, buharlaşma 0 |
| T2 | **Karşı yakaya tam istasyon** (4 pompa + 4 şarj + market2 + otopark), 10 dk | Kalıcı kilit 0, buharlaşma 0, karşı şeritte çakışma 0 |
| T3 | Trafik akarken **near kapıları 5 kez taşı** | Hiçbir araç eski kapıya gitmemeli |
| T4 | Trafik akarken **karşı kapıları 5 kez taşı** | Aynı kriter (bugün başarısız — B3) |
| T5 | 2 otopark kur → doldur → birini taşı → birini yık → yenisini ekle | Çift işgal 0, kalıcı "dolu" yer 0 |
| T6 | Pompayı 90° döndür, yanına bina koymayı dene | Gerçek gövdenin üstüne konamamalı, boş alana konabilmeli |
| T7 | Karşı yakaya tır parkı koy | Tırlar oraya gitmeli ve karşı kapıdan çıkmalı |
| T8 | Giriş ve çıkışı **aynı y'ye** koymayı dene | Yerleştirme reddedilmeli |
| T9 | Karşı yaka müşterisi tuvalet/restoran istesin | Yaya otoyolu **geçmemeli**; ya karşı nüsha kullanılmalı ya açık ceza verilmeli |
| T10 | Mobil (orta segment cihaz), T2 senaryosu, 10 dk | Kare süresi bütçesi içinde, ısınma kabul edilebilir |

### 6.3 Regresyon koruması

Bu hataların hepsi "near'da çalışıyor, far'da bozuk" kalıbında. Kalıcı koruma için basit bir birim testi:

```ts
// test: her yaka-duyarlı fonksiyon simetrik mi
for (const st of ['near','far'] as const) {
  const G = geom(st)
  const mirror = (p: THREE.Vector3) => st === 'far'
    ? new THREE.Vector3(2*ROAD_X - p.x, -p.y, 0) : p
  // near sonucunun aynası, far sonucuna eşit olmalı (±0.01)
  expectClose(mirror(entryPath(slotNear, 'near')[k]), entryPath(slotFar, 'far')[k])
}
```

Bu test bugün **B1, B2, B3, B5, B6'nın hepsini yakalar.**

---

## 7. Özet

Karşı istasyonun bozukluğu tek bir tasarım hatasından geliyor: **karşı yaka "near'ın (ROAD_X, 0) etrafında 180° dönmüşü" olarak tanımlanmış, ama aynalama yalnız bazı yerlerde uygulanmış.** Uygulandığı yerler (`geom()`, `entryPath`, `waitSpotAt`, `pumpSlots`) doğru çalışıyor; uygulanmadığı yerler (`hardRects`, `fixedObstacles`, merge yield, `rerouteForGates`, tır parkı, `atEntry` eşiği) sessizce bozuk.

En kritik olanı B1: **karşı yakadaki her pompa/şarj, kendi giriş kapısının önüne görünmez bir duvar dikiyor.** İki satırlık bir düzeltme, 43 geri bildirimlik bir kümenin merkezinde duruyor.

İkinci sıradaki B4 (otopark indeks kayması) karşı istasyona özgü değil ama 38 açık kayıtla en büyük tek küme — ve "bir süre sonra bozuluyor" tarifi tam olarak indeks kaymasının imzası.

Faz A (~4 saat) uygulandıktan sonra §6.1'deki debug overlay'i kurun. Bundan sonraki her trafik düzeltmesi ölçülebilir olur; şu anki döngü ("şikâyet gelir → yama yazılır → yeni şikâyet gelir") ancak böyle kırılır.

Uzun vadede §5'teki grafik modeli, çoklu lokasyon planı devreye girmeden önce yapılmalı — aksi halde her yeni istasyon bu raporun tekrar yazılmasını gerektirir.

---

*Kaynaklar: `src/cars.ts`, `src/main.ts`, `src/world.ts` (repo @ main, 284 commit) · 529 geri bildirim kaydının 215'i trafik kümesinde · `docs/WHY-IT-WORKS.md` §5, `docs/MAJOR-PLAN.md` Faz 2-3, `docs/coklu-lokasyon-tasarim.md`*
