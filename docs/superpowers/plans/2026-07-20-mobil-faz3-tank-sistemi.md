# Mobil Faz 3 — Yakıt Başına Tank + Adet + Tip + 3D Doluluk (Uygulama Planı)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (inline). Steps use checkbox (`- [ ]`) syntax.

**Goal:** Her yakıt türü (benzin/dizel/lpg) kendi tank(lar)ına sahip olsun; tanklar yakıt tipine göre görsel olarak ayrışsın (renk), 3D'de doluluk oranı görünsün, ve pompa gibi adet artırılabilsin — tüm bunlar **additive save** ile (eski kayıtlar bozulmaz, prod izole).

**Architecture:** Mevcut `tankLevel` (ortak kapasite seviyesi) ve `tanks` (litre) alanları **korunur**. Yeni `tankCounts: Record<FuelType, number>` (yakıt başına tank adedi, default 1) eklenir. Yakıt kapasitesi `fuelCapacity(f) = TANK_CAPACITY[tankLevel] × tankCounts[f]` olur — adet=1'de eski davranışa birebir eşit (geriye uyum). Mağaza yakıt başına "Tank" satırı kazanır (tycoon "sonraki hedef" kalıbı). 3D'de yakıt tipine göre renkli kümeler + per-frame doluluk. `world.ts`/`main.ts` pompa "adet" kalıbını (`addPump index'li`) örnek alır.

**Tech Stack:** Vite + TS + three.js.

## Global Constraints

- **Yalnızca `dev` branch.** main'e push YOK (prod ayrı DB, izole).
- **Additive save ZORUNLU:** `tanks`, `tankLevel` alanlarına DOKUNMA; yalnızca `tankCounts` ekle. `hydrateState` eski save'i default `{benzin:1,dizel:1,lpg:1}` ile yükler. Eski kod (prod) yeni save'de `tankCounts`'u yoksayar.
- **Denge (tycoon-design):** ek tank yatırımı ~3-5 dk amorti; maliyet eğrisi artan; kilitli/maks durum "neden" yazsın. Kapasite adet=1'de mevcut ekonomiyle birebir aynı kalmalı (regresyon yok).
- Görsel dil (`ui-signage-design`): 3D tank renkleri HUD yakıt renkleriyle eşleşir (benzin=yeşil `#27a05a`, dizel=turuncu `#e8862e`, lpg=mavi `#2f6fed`); UI'da emoji yok.
- `npm run build` her görevde temiz. `?full=1` vitrin + temiz kayıtla test. Commit'ler Türkçe.

---

### Task 1: Veri modeli — tankCounts + fuelCapacity + additive save

**Files:**
- Modify: `src/state.ts` (`tankCounts` alanı; `fuelCapacity(f)`; `orderNeed`/`deliverFuel`/`orderCost` yakıt-başına kapasite; `SAVE_FIELDS`; `hydrateState` default)

**Interfaces:**
- Produces: `GameState.tankCounts: Record<FuelType, number>`; `GameState.fuelCapacity(f: FuelType): number`; `MAX_TANKS_PER_FUEL = 4`; `TANK_ADD_COSTS: number[]`.

- [ ] **Step 1: Alan + sabitler**

`src/state.ts`'te `tankLevel = 0` (satır 105) yakınına ekle (mevcut alanları KORU):
```ts
  /** yakıt başına fiziksel tank adedi (kapasite çarpanı) — additive, default 1 */
  tankCounts: Record<FuelType, number> = { benzin: 1, dizel: 1, lpg: 1 }
```
Sabitler (TANK_COSTS yakınına, satır 34):
```ts
export const MAX_TANKS_PER_FUEL = 4
export const TANK_ADD_COSTS = [0, 6000, 12000, 20000] // 2., 3., 4. tank (index = mevcut adet)
```

- [ ] **Step 2: fuelCapacity + kapasite kullanımlarını yakıt-başına yap**

`src/state.ts:211` mevcut `get tankCapacity()` KORUNUR (adet=1 yollarıyla uyum). Yeni metod ekle:
```ts
  /** yakıt başına toplam kapasite = seviye kapasitesi × tank adedi */
  fuelCapacity(f: FuelType): number { return TANK_CAPACITY[this.tankLevel] * this.tankCounts[f] }
```
`orderNeed` (satır 381), `deliverFuel` (satır 401), `orderCost` (satır 375 civarı) `this.tankCapacity` yerine `this.fuelCapacity(f)` kullanır:
```ts
  orderNeed(f: FuelType) { return Math.floor(this.fuelCapacity(f) - this.tanks[f]) }
  // deliverFuel: this.tanks[f] = this.fuelCapacity(f)
```
(adet=1'de `fuelCapacity(f) === tankCapacity` olduğundan davranış birebir korunur.)

- [ ] **Step 3: Save additive**

`SAVE_FIELDS` (satır 606) dizisine `'tankCounts'` ekle. `hydrateState` (satır 634) — `tankCounts` eski save'de yoksa default kalır (mevcut `for (f of SAVE_FIELDS) if (f in data)` deseni bunu zaten sağlar); ama iç obje güvenliği için ekle:
```ts
  if (data.tankCounts && typeof data.tankCounts === 'object') Object.assign(s.tankCounts, data.tankCounts)
```
(`tanks` satırındaki `Object.assign` deseniyle aynı, satır 643 yakını.)

- [ ] **Step 4: Derleme + regresyon**

Run: `npm run build` → tsc temiz.
Regresyon: adet=1 iken `fuelCapacity(f) === TANK_CAPACITY[tankLevel]` (eski kapasite). Sipariş/teslimat mantığı değişmez.

- [ ] **Step 5: Commit**

```bash
git add src/state.ts
git commit -m "faz3: tankCounts (yakıt başına adet) + fuelCapacity — additive save, adet=1'de birebir uyum"
```

---

### Task 2: Ekonomi — yakıt başına tank mağaza satırı + satın alma

**Files:**
- Modify: `src/state.ts` (`getShopItems` tank satırları; `buyItem` tank ekleme)

**Interfaces:**
- Consumes: `tankCounts`, `TANK_ADD_COSTS`, `MAX_TANKS_PER_FUEL`.

- [ ] **Step 1: Mağaza satırları**

`src/state.ts:479` mevcut tek `row('tank', ...)` tankLevel yükseltmesi KORUNUR (kapasite seviyesi). Ek olarak, yakıt başına adet satırı (tycoon "sonraki hedef" — kilit nedeni yazılı):
```ts
  for (const f of FUELS) {
    const c = s.tankCounts[f]
    row(`tankadd-${f}`, 'i-tank', t('{0} Tankı #{1}', FUEL_LABEL[f], c + 1),
      c >= MAX_TANKS_PER_FUEL ? t('Maks') : `+${TANK_CAPACITY[s.tankLevel]}L`,
      c >= MAX_TANKS_PER_FUEL ? null : TANK_ADD_COSTS[c], null)
  }
```
(`row` imzası ve kategori — mevcut tank satırıyla aynı kalıp; kategori `CATEGORY_MAP`'e `tankadd-*` → İstasyon/Tesisler eklenir, `ui.ts`.)

- [ ] **Step 2: buyItem**

`src/state.ts:715` `case 'tank'` KORUNUR. Ek dal (buyItem switch'inde id `tankadd-<fuel>`):
```ts
  if (id.startsWith('tankadd-')) {
    const f = id.slice('tankadd-'.length) as FuelType
    if (s.tankCounts[f] >= MAX_TANKS_PER_FUEL) return false
    const cost = TANK_ADD_COSTS[s.tankCounts[f]]
    if (s.money < cost) return false
    s.money -= cost; s.tankCounts[f]++
    return true
  }
```
(buyItem'ın para kontrolü/döndürme kalıbına uyulur — mevcut case'lerdeki gibi.)

- [ ] **Step 3: Derleme + denge kontrolü**

Run: `npm run build` → tsc temiz.
Denge: 2. benzin tankı ₺6000, +kapasite = `TANK_CAPACITY[tankLevel]`. Amorti: ek kapasite daha uzun satış kesintisiz servis → makul (dev'de `?full=1` ile gözlem).

- [ ] **Step 4: Commit**

```bash
git add src/state.ts src/ui.ts
git commit -m "faz3: yakıt başına 'Tank #n' mağaza satırı + satın alma (adet artırma)"
```

---

### Task 3: 3D görsel — yakıt tipine göre renkli tanklar + adet + doluluk

**Files:**
- Modify: `src/world.ts` (`buildTankCluster` yakıt-tipi renk + adet; `updateTankFill(ratios)`; `addSphereTank` doluluk göstergesi)
- Modify: `src/main.ts` (per-frame `updateTankFill` çağrısı; rebuild)

**Interfaces:**
- Consumes: `state.tankCounts`, `state.tanks`, `state.fuelCapacity`.
- Produces: `World.updateTankFill(ratios: Record<FuelType, number>)`.

- [ ] **Step 1: Yakıt tipine göre renkli kümeler**

`src/world.ts:669` `buildTankCluster` — renk paletini seviye yerine yakıt tipine göre; her yakıt için `tankCounts[f]` kadar küre. Yakıt renkleri: benzin `0x27a05a`, dizel `0xe8862e`, lpg `0x2f6fed`. (Mevcut tek-küme mantığı yakıt-gruplu hale gelir; `moveTank`/`upgradeTankVisual` çağrıları korunur, adet parametresi eklenir.)

- [ ] **Step 2: 3D doluluk göstergesi + updateTankFill**

`addSphereTank` (satır 651) her küreye doluluk göstergesi (dikey dolum meshi / iç seviye) ekler; küre referansları saklanır. Yeni:
```ts
updateTankFill(ratios: Record<FuelType, number>) { /* saklanan küre meshlerinin dolum scale/clip'ini ratios[f] ile güncelle */ }
```
`src/main.ts` ana döngüsünde (tank/tanker güncellemesi yakını) her yakıt için `state.tanks[f] / state.fuelCapacity(f)` oranıyla `world.updateTankFill(...)` çağrılır.

- [ ] **Step 3: rebuild + build**

`main.ts` rebuild (satır 962 `upgradeTankVisual`) + `moveTank` (satır 1000) çağrıları yeni imzayla (adet dahil). `npm run build` temiz.
Doğrulama: web'de tanklar yakıt rengine göre ayrı; adet artınca yeni tank belirir; satış/dolumda 3D doluluk değişir.

- [ ] **Step 4: Commit**

```bash
git add src/world.ts src/main.ts
git commit -m "faz3: 3D tanklar yakıt tipine göre renkli + adet + canlı doluluk göstergesi"
```

---

### Task 4: HUD + dev push + doğrulama

**Files:**
- Modify: `src/ui.ts` (HUD bar `fuelCapacity(f)`; adet göstergesi; ölü `#tankfill` temizliği `index.html:66`)

- [ ] **Step 1: HUD kapasite + adet**

`src/ui.ts:540-564` tank barı doluluk `lvl / state.tankCapacity` → `lvl / state.fuelCapacity(f)`. Adet >1 ise chip'te küçük "×n" göstergesi (opsiyonel, sığarsa). Ölü `#tankfill` (`index.html:66`) kaldır.

- [ ] **Step 2: build + dev push**

`npm run build` temiz. `git push origin dev`.

- [ ] **Step 3: Doğrulama**

Web (`?full=1` vitrin + normal): tanklar tipe göre renkli, adet artırılabilir, doluluk HUD+3D tutarlı; eski kayıt (adet yok) default 1 ile sorunsuz yüklenir (regresyon yok). iOS simülatör: görsel teyit.

- [ ] **Step 4: Commit + push**

```bash
git add src/ui.ts index.html
git commit -m "faz3: HUD yakıt-başına kapasite + adet göstergesi; ölü #tankfill temizliği"
git push origin dev
```

---

## Plan Sonu Kontrolü

Faz 3 bitince: yakıt başına ayrı/renkli tanklar, adet artırılabilir, 3D+HUD doluluk; eski kayıtlar bozulmadan yüklenir (additive); prod izole. Faz 4 (roadmap) son faz.
