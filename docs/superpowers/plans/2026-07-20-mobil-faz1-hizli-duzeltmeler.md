# Mobil Faz 1 — Hızlı Düzeltmeler (Uygulama Planı)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (inline) to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Mobil (Capacitor/iOS) deneyimindeki dört düşük-riskli hatayı düzelt: Sorun Bildir'i mobilde gizle, doldurma panelini dışa dokunuşla kapat, EV şarj ünitesinin yönünü değiştirilebilir yap, HUD'un dynamic island'a takılmasını gider.

**Architecture:** Mevcut dosyalara (`index.html`, `src/main.ts`, `src/ui.ts`, `src/world.ts`) hedefli düzenlemeler. Native tespiti için `window.Capacitor?.isNativePlatform()` kalıbı bir `isNative` yardımcısına çıkarılır. Test altyapısı yok (oyun/DOM) → doğrulama: `npm run dev` + tarayıcı mobil viewport (Playwright) ve/veya iOS simülatör ekran görüntüsü.

**Tech Stack:** Vite + TypeScript + three.js; Capacitor (native kabuk).

## Global Constraints

- **Yalnızca `dev` branch.** main'e push YOK — prod (`petrol.benerits.com`, ayrı DB) etkilenmez.
- Değişiklikler dev'e push edilince otomatik `petrol-dev.benerits.com` + TestFlight dev build üretir.
- Web deneyimi korunur: mobil-özel davranışlar yalnızca native veya `@media (max-width:680px)` altında.
- Save şemasına dokunulmaz (Faz 1'de yeni oyun alanı yok).
- Commit mesajları Türkçe.
- Her görev sonunda `npm run build` (tsc) hatasız geçmeli.

---

### Task 1: Native tespiti yardımcısı + Sorun Bildir'i mobilde gizle

**Files:**
- Modify: `src/main.ts` (yeni `isNative` yardımcısı yakın: dosya başı import'lardan sonra; `#fbbtn` gizleme)

**Interfaces:**
- Produces: modül düzeyinde `export function isNativePlatform(): boolean` — sonraki tüm mobil-özel davranışlar (Faz 2 navbar, panel dış-tıklama) bunu kullanır.

- [ ] **Step 1: `isNativePlatform` yardımcısını ekle**

`src/main.ts` içinde, mevcut `setupOAuth` (satır 105) dışına, modül düzeyinde tek kaynak:
```ts
/** Capacitor native (iOS/Android) mı? Mobil-özel davranışların tek kaynağı. */
export function isNativePlatform(): boolean {
  const cap = (window as unknown as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor
  return !!cap?.isNativePlatform?.()
}
```
Not: `setupOAuth` içindeki mevcut `const isNative = !!cap?.isNativePlatform?.()` (satır 110) bu yardımcıyı kullanacak şekilde `const isNative = isNativePlatform()` yapılır (DRY).

- [ ] **Step 2: `#fbbtn`'i native'de gizle**

`src/main.ts` içinde UI kurulumunun çalıştığı bir yerde (örn. `ui` oluşturulduktan / DOM hazır olduktan sonra, `setupOAuth` çağrısı yakını) ekle:
```ts
if (isNativePlatform()) {
  const fb = document.getElementById('fbbtn')
  if (fb) fb.style.display = 'none'
}
```
Gerekçe: `#fbbtn` (`index.html:591`) web'de görünür kalır; yalnızca native'de gizlenir.

- [ ] **Step 3: Derleme + doğrulama**

Run: `npm run build`
Expected: tsc hatasız.
Doğrulama (web): `npm run dev` → tarayıcıda `http://localhost:5173` → "Sorun Bildir" **görünür** (web'de değişmedi).
Doğrulama (native): Faz sonunda dev'e push edilince simülatörde gizli olduğu doğrulanır (Task 5).

- [ ] **Step 4: Commit**

```bash
git add src/main.ts
git commit -m "mobil: isNativePlatform yardımcısı + Sorun Bildir native'de gizli (web'de kalır)"
```

---

### Task 2: Doldurma paneli — mobilde dışa dokununca kapat

**Files:**
- Modify: `src/main.ts:2374-2377` (boşluğa tıklama bloğu)
- Modify: `src/ui.ts` (panel'i dışarıdan kapatacak açık bir yöntem)

**Interfaces:**
- Consumes: `isNativePlatform()` (Task 1).
- Produces: `UI.dismissActiveCarPanel(): void` — aktif araç panelini kapatır (aracı bırakmadan sadece paneli gizler; müşteri kaçmaz, tekrar tıklanınca açılır).

- [ ] **Step 1: UI'a panel-kapatma yöntemi ekle**

`src/ui.ts` içinde `refreshPanel` (satır 350) yakınına:
```ts
/** Paneli görsel olarak kapat (mobilde dışa dokunma). Aktif araç seçili kalır; panele
 *  tekrar erişim için araca yeniden dokunulur. Doldurma sürerken kapatma engellenir. */
dismissActiveCarPanel() {
  const car = this.activeCar
  if (car && car.filling) return // doldurma sürüyorsa kapatma
  this.panel.classList.remove('show')
}
```

- [ ] **Step 2: Boşluğa tıklamada paneli de kapat (yalnızca native)**

`src/main.ts:2374-2377` bloğunu genişlet:
```ts
  // 3) boşluğa tıklama → seçimi kapat
  selectedBuilding = null
  world.setSelected(null)
  ui.hideBuildingCard()
  if (isNativePlatform()) ui.dismissActiveCarPanel() // mobilde panel dışa dokunuşla kapanır
```
Gerekçe: `#panel`'in (`index.html:354`) backdrop'u yok; sahne boşluğuna dokunma tek doğal "dışarı" sinyali. Web'de davranış değişmez (native guard).

- [ ] **Step 3: Derleme + doğrulama**

Run: `npm run build`
Expected: tsc hatasız.
Doğrulama: dev push sonrası simülatörde (Task 5) — müşteri gelince panel açılır, sahne boşluğuna dokununca kapanır, araca tekrar dokununca yine açılır; doldurma sırasında kapanmaz.

- [ ] **Step 4: Commit**

```bash
git add src/main.ts src/ui.ts
git commit -m "mobil: doldurma paneli sahne boşluğuna dokununca kapanır (doldurma sürerken hariç)"
```

---

### Task 3: EV şarj ünitesi — yön değiştirilebilir + araç doğru yanaşır

**Files:**
- Modify: `src/world.ts:1071-1096` (`addEvCharger` rotasyon + slot; `moveCharger` rot koru)
- Modify: `src/main.ts:1364-1365` (confirmPlacement charger'a rotasyon uygula)
- Modify: `src/main.ts:1402` (klavye R guard'dan charger'ı çıkar)

**Interfaces:**
- Consumes: `World.rotateBuilding(id, rot)` (`world.ts:881`, mevcut).
- Produces: `World.addEvCharger(index, at?, rot?)` — rot (0-3, 90° adım) verilirse ünite döner ve **araç yanaşma slotu açıya göre hesaplanır**.

- [ ] **Step 1: `addEvCharger`'ı rotasyon-farkında yap**

`src/world.ts:1071` imzasını ve gövdesini güncelle. Slot offset'i (mevcut sabit `base.x + 1.1, base.y`) açıya göre döndürülür:
```ts
addEvCharger(index: number, at?: THREE.Vector2, rot = 0) {
  const base = at ?? new THREE.Vector2(0.7, EV_SLOTS_POS[Math.min(index, 3)].y)
  // Araç yanaşma noktası: varsayılan sağ tarafta (+1.1). Ünite döndükçe bu offset de döner.
  const ang = rot * Math.PI / 2
  const ox = Math.cos(ang) * 1.1, oy = Math.sin(ang) * 1.1
  this.evSlots[index] = new THREE.Vector3(base.x + ox, base.y + oy, 0)
  const g = new THREE.Group()
  // ... (mevcut mesh kurulumu aynen: pad, box'lar, stripe, cyl) ...
  g.position.set(base.x, base.y, 0)
  g.rotation.z = ang
  this.scene.add(g)
  this.register(`charger-${index}`, t('DC ŞARJ #{0}', index + 1), g, 2.3)
}
```
(Mevcut satır 1074-1090 arasındaki mesh kurulumu değişmez; yalnızca imzaya `rot`, slot hesabına offset döndürme, gruba `g.rotation.z = ang` eklenir.)

`moveCharger`'ı (satır 1093) mevcut rotasyonu koruyacak şekilde güncelle — çağıran taraf rot'u verir:
```ts
moveCharger(index: number, at: THREE.Vector2, rot = 0) {
  this.removeBuildingGroup(`charger-${index}`)
  this.addEvCharger(index, at, rot)
}
```

- [ ] **Step 2: `confirmPlacement`'ta charger'a rotasyonu uygula**

`src/main.ts:1364-1365` — charger'ı istisnadan çıkar. charger için `world.rotateBuilding` yerine yeniden-kurma yolu kullanılır (slot yeniden hesaplansın diye). Mevcut koşul:
```ts
if (!p.id.startsWith('pump-') && !p.id.startsWith('charger-') && p.id !== 'tank' && p.id !== 'gatein' && p.id !== 'gateout')
  world.rotateBuilding(p.id, p.rot)
```
şuna dönüşür:
```ts
if (p.id.startsWith('charger-')) {
  const idx = Number(p.id.slice('charger-'.length))
  world.moveCharger(idx, new THREE.Vector2(p.cx, p.cy), p.rot) // yön + slot yeniden kurulur
} else if (!p.id.startsWith('pump-') && p.id !== 'tank' && p.id !== 'gatein' && p.id !== 'gateout') {
  world.rotateBuilding(p.id, p.rot)
}
```
`placedRot[p.id] = p.rot` (satır 1367) zaten charger için de kaydediliyor; kayıttan geri yükleme (`main.ts:999-1000` restore döngüsü) `moveCharger`'ı rot ile çağıracak şekilde kontrol edilir — eğer restore `rotateBuilding` kullanıyorsa charger için `moveCharger(idx, pos, rot)` yoluna alınır (uygulama sırasında `placedPos`/`placedRot` restore koduna bakılıp charger dalı eklenir).

- [ ] **Step 3: Klavye R guard'dan charger'ı çıkar**

`src/main.ts:1402` — charger artık döndürülebilir:
```ts
if (placing.id.startsWith('pump-') || placing.id === 'tank' || placing.id === 'gatein' || placing.id === 'gateout') {
  ui.toast('Bu ünitenin yönü sabittir (araç yanaşması) — sadece yerini seçebilirsin.', '')
  return
}
```
(mobil ⟳ butonu `main.ts:1636` zaten guard'sız; artık tutarlı — ikisi de charger'ı döndürür.)

- [ ] **Step 4: Derleme + doğrulama**

Run: `npm run build`
Expected: tsc hatasız.
Doğrulama: dev push sonrası (Task 5) — düzenleme modunda EV şarj ünitesi seçilip ⟳ (mobil) veya R (web) ile döndürülür; ünite döner, onaylanınca gerçek ünite de döner ve **araç doğru (dönen) taraftan yanaşır**. Kayıt/geri yüklemede yön korunur.

- [ ] **Step 5: Commit**

```bash
git add src/world.ts src/main.ts
git commit -m "mobil/oyun: EV şarj ünitesi döndürülebilir — araç yanaşma slotu açıya göre hesaplanır"
```

---

### Task 4: HUD dynamic island — safe-area doğrulama + gerekiyorsa native tampon

**Files:**
- Modify (gerekirse): `index.html:51-54` (`.hud` padding) veya beneloil-ios native StatusBar ayarı
- Test aracı: iOS simülatör ekran görüntüsü

**Interfaces:** —

- [ ] **Step 1: Mevcut durumu simülatörde ölç**

safe-area CSS'i zaten var (`index.html:53` `env(safe-area-inset-top)`, `index.html:5` `viewport-fit=cover`). Önce Task 1-3 dev'e push edilip simülatörde gerçek kesme durumu görülür (Task 5). HUD üst satırının dynamic island altında kalıp kalmadığı ekran görüntüsüyle teyit edilir.

- [ ] **Step 2: Kesme sürüyorsa çözüm uygula**

İki olası sebep + çözüm (simülatör bulgusuna göre biri):
- **(a) WKWebView status bar overlay etmiyorsa:** `viewport-fit=cover` etkisizdir. Çözüm native tarafta: `beneloil-ios` Capacitor config'e/Info.plist'e status bar'ı overlay yapan ayar (WebView tam ekran, safe-area env'leri nonzero döner). Bu değişiklik **beneloil-ios reposunda** yapılır (ayrı commit).
- **(b) env değeri geliyor ama HUD yine dar:** `index.html:53` top padding tamponu artırılır:
  ```css
  padding: calc(12px + env(safe-area-inset-top)) calc(12px + env(safe-area-inset-right)) 10px calc(12px + env(safe-area-inset-left));
  ```
  ve mobil breakpoint (`index.html:73`) benzer şekilde. `flex-wrap` taşması için gerekiyorsa HUD ilk satır yüksekliği/kompaktlığı gözden geçirilir.

- [ ] **Step 3: Derleme + doğrulama**

Run: `npm run build` (CSS/HTML değişikliği varsa yine tsc temiz kalmalı).
Doğrulama: simülatörde HUD üst satırı dynamic island'ın altında, tam görünür.

- [ ] **Step 4: Commit**

```bash
# BenerOil tarafı (CSS değiştiyse):
git add index.html
git commit -m "mobil: HUD dynamic island tamponu (safe-area)"
# beneloil-ios tarafı gerektiyse ayrı repoda ayrı commit (native StatusBar)
```

---

### Task 5: dev'e push + iOS simülatörde uçtan uca doğrulama

**Files:** — (yalnızca push + doğrulama)

- [ ] **Step 1: dev'e push (otomatik dev build + TestFlight tetikler)**

```bash
git push origin dev
```
Not: Bu push `petrol-dev.benerits.com` deploy'unu ve TestFlight dev build'ini otomatik tetikler.

- [ ] **Step 2: iOS simülatörde doğrula**

`beneloil-ios` gömülü modda simülatöre kurulur (web build → cap sync → run) VEYA dev sunucusuna bağlı test edilir; ekran görüntüsüyle dört düzeltme teyit edilir:
1. Sorun Bildir görünmez (native).
2. Doldurma paneli sahne boşluğuna dokununca kapanır.
3. EV şarj ünitesi döndürülebilir, araç doğru yanaşır.
4. HUD dynamic island'a takılmaz.

- [ ] **Step 3: Web regresyon kontrolü**

Tarayıcı masaüstü + mobil viewport (`http://localhost:5173`): Sorun Bildir görünür, panel davranışı web'de bozulmamış, HUD normal.

---

## Plan Sonu Kontrolü

Faz 1 bitince: dört mobil düzeltme dev'de canlı, web ve prod değişmemiş. Faz 2 (navbar + kamera açısı) bunun üstüne gelir.
