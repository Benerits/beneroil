# Mobil Faz 2 — Alt Navbar + Ofis Özet + Kamera Açısı (Uygulama Planı)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (inline). Steps use checkbox (`- [ ]`) syntax.

**Goal:** Mobilde alt navbar (Ofis · İnşaat · Sipariş · Roadmap · Profil), Ofis sekmesinde finansal özet paneli, ve harita açısını değiştiren bir kamera butonu ekle.

**Architecture:** Mobil (dar ekran) navbar `index.html`'e sabit alt bar olarak eklenir; sekmeler mevcut HUD butonlarını/handler'larını yeniden kullanır (DRY, id'ler korunur). Ofis paneli mevcut modal kalıbını (`.backdrop`/`.mhead` kırmızı bant) izler. Kamera, `main.ts`'teki sabit `camDir` yerine 3 hazır açı arasında döner. Görsel dil `ui-signage-design` skill'ine uyar: emoji YOK (SVG `#i-*`), basılabilir butonlar, tabular-nums sayılar, cam blur yok.

**Tech Stack:** Vite + TS + three.js; Capacitor.

## Global Constraints

- **Yalnızca `dev` branch.** main'e push YOK (prod izole, ayrı DB).
- Görsel dil: `ui-signage-design` — UI'da emoji yasak (SVG sprite `#i-*`); modal başlığı kırmızı bant; kart krem + alt koyu kenar; buton basılabilir (alt 3px, `:active` 2px iner); sayılar `tabular-nums` 800; radius 10/13/17 (asla 999px pill); token'lar `index.html :root`'tan.
- Navbar yalnızca mobilde: `@media (max-width:680px)`. Masaüstü web HUD düzeni değişmez.
- Navbar UI, oyun raycast/zoom'unu engelleyen guard'a eklenir (`main.ts` wheel guard `.closest('.hud, .modal, .backdrop, #panel, #infocard')` → `.navbar` eklenir).
- Save şemasına dokunma yok (kamera açısı opsiyonel additive alan; yoksa default 0).
- `npm run build` her görevde temiz geçmeli. Commit mesajları Türkçe.

---

### Task 1: Roadmap SVG ikonu + alt navbar iskeleti (mevcut modalları bağla)

**Files:**
- Modify: `index.html` (yeni `#i-map` symbol; `<nav class="navbar">`; `.navbar` CSS; mobil breakpoint'te HUD butonlarını gizle)
- Modify: `src/main.ts` (wheel/raycast guard'a `.navbar`; navbar sekme → mevcut handler proxy)

**Interfaces:**
- Consumes: mevcut buton id'leri (`shopbtn`, `orderbtn`, `accbtn`, `closebtn`).
- Produces: `.navbar` DOM; Roadmap sekmesi `#nav-roadmap` (Task 4/Faz 4 içeriğini açar; şimdilik "coming soon" toast).

- [ ] **Step 1: Roadmap ikonu (SVG symbol)**

`index.html` SVG defs bloğuna (diğer `<symbol>`'lerin yanına, `#i-user`'dan sonra) ekle — stroke-based, 24 viewBox, tabela diliyle uyumlu (katlanmış harita + rota):
```html
<symbol id="i-map" viewBox="0 0 24 24"><path d="M9 4.5 4 6.5v13l5-2 6 2 5-2v-13l-5 2-6-2z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/><path d="M9 4.5v13M15 6.5v13" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></symbol>
```

- [ ] **Step 2: Alt navbar HTML**

`index.html`'de `</div>` (hud kapanışı) sonrasına ekle. Her sekme = ikon + küçük etiket; basılabilir stil `.navbtn` ile:
```html
<nav class="navbar" id="navbar">
  <button class="navbtn" id="nav-office"><svg class="ic"><use href="#i-office"/></svg><span data-i18n="Ofis">Ofis</span></button>
  <button class="navbtn" id="nav-build"><svg class="ic"><use href="#i-build"/></svg><span data-i18n="İnşaat">İnşaat</span></button>
  <button class="navbtn" id="nav-order"><svg class="ic"><use href="#i-truck"/></svg><span data-i18n="Sipariş">Sipariş</span></button>
  <button class="navbtn" id="nav-roadmap"><svg class="ic"><use href="#i-map"/></svg><span data-i18n="Yol Haritası">Yol Har.</span></button>
  <button class="navbtn" id="nav-profile"><svg class="ic"><use href="#i-user"/></svg><span data-i18n="Profil">Profil</span></button>
</nav>
```

- [ ] **Step 3: Navbar CSS (yalnızca mobil)**

`index.html` `<style>` içinde, mobil breakpoint dışında `.navbar { display:none }`; `@media (max-width:680px)` içinde göster ve HUD'daki taşınan butonları gizle. Tabela dili: krem zemin, üst koyu kenar, safe-area bottom.
```css
.navbar { display:none; }
.navbtn { background:none; border:0; font-family:var(--font); }
@media (max-width:680px) {
  .navbar { display:flex; position:fixed; left:0; right:0; bottom:0; z-index:20;
    justify-content:space-around; align-items:center; gap:2px;
    background:var(--paper); border-top:2px solid var(--edge);
    padding:6px 8px calc(6px + env(safe-area-inset-bottom));
    box-shadow:0 -4px 14px rgba(34,48,60,.16); }
  .navbtn { flex:1; display:flex; flex-direction:column; align-items:center; gap:3px;
    color:var(--muted); cursor:pointer; padding:4px 0; border-radius:var(--r-sm);
    transition:color .12s, transform .05s; }
  .navbtn .ic { width:22px; height:22px; }
  .navbtn span { font-size:10px; font-weight:800; letter-spacing:.02em; }
  .navbtn:active { transform:translateY(1px); }
  .navbtn.on { color:var(--red); }
  /* HUD'dan alta taşınanları mobilde gizle */
  #closebtn, #orderbtn, #shopbtn, #accbtn { display:none; }
  /* oyun sahnesi navbar'ın altına girmesin diye alt güvenli alan zaten fixed */
}
```

- [ ] **Step 4: Navbar sekmelerini bağla + guard (main.ts)**

`src/main.ts`'te UI kurulumu sonrası (ör. `isNativePlatform()` fbbtn bloğu yakını) sekmeleri mevcut butonlara proxy'le:
```ts
// Alt navbar (mobil): sekmeler mevcut HUD handler'larını yeniden kullanır (DRY).
const navProxy: Array<[string, string]> = [
  ['nav-build', 'shopbtn'], ['nav-order', 'orderbtn'], ['nav-profile', 'accbtn'],
]
for (const [nav, target] of navProxy) {
  document.getElementById(nav)?.addEventListener('click', () => document.getElementById(target)?.click())
}
document.getElementById('nav-office')?.addEventListener('click', () => openOfficePanel()) // Task 3
document.getElementById('nav-roadmap')?.addEventListener('click', () => ui.toast(t('Yol haritası yakında!'), ''))
```
Wheel/raycast guard'ına `.navbar` ekle — mevcut `.closest('.hud, .modal, .backdrop, #panel, #infocard')` iki yerde (`main.ts:220` wheel, `main.ts:229` touch civarı) `'.navbar'` eklenmiş yeni string'e güncellenir (navbar'a dokunuş sahneye zoom/tap geçirmesin).

Not: `openOfficePanel` Task 3'te tanımlanır; Task 1'de nav-office geçici olarak `document.getElementById('closebtn')?.click()` (aç/kapa) yapar, Task 3'te panel'e bağlanır.

- [ ] **Step 5: Derleme + web doğrulama (dar viewport)**

Run: `npm run build` → tsc temiz.
Doğrulama: `npm run dev`, tarayıcı 390px genişlikte → alt navbar 5 sekmeyle görünür, sekmeler ilgili modalları açar; masaüstü genişlikte navbar gizli, HUD normal.

- [ ] **Step 6: Commit**

```bash
git add index.html src/main.ts
git commit -m "mobil: alt navbar (Ofis/İnşaat/Sipariş/Roadmap/Profil) + i-map ikonu; sekmeler mevcut modalları proxy'ler"
```

---

### Task 2: Kamera açısı — 3 hazır açı arası geçiş

**Files:**
- Modify: `src/main.ts` (`camDir` sabitini açı dizisine çevir; navbar veya HUD'a "açı" butonu)
- Modify: `index.html` (açı butonu + gerekiyorsa `#i-angle` symbol)

**Interfaces:**
- Consumes: mevcut `updateCamera()`, `resize()`.
- Produces: `cycleCameraAngle()` — sıradaki açıya geçer, `updateCamera()` çağırır.

- [ ] **Step 1: Açı dizisi + döngü fonksiyonu**

`src/main.ts:192` civarı sabit `camDir`'i değiştir:
```ts
// Harita açısı: birkaç hazır izometrik yön; oyuncu "açı" butonuyla döner.
const CAM_ANGLES = [
  new THREE.Vector3(1, 2, 1), new THREE.Vector3(1.6, 2, 0.5), new THREE.Vector3(0.5, 2.2, 1.6),
].map(v => v.normalize().multiplyScalar(42))
let camAngleIdx = 0
let camDir = CAM_ANGLES[camAngleIdx].clone()
function cycleCameraAngle() {
  camAngleIdx = (camAngleIdx + 1) % CAM_ANGLES.length
  camDir = CAM_ANGLES[camAngleIdx].clone()
  updateCamera()
}
```
(`camDir` artık `let`; `updateCamera()` mevcut haliyle `camDir`'i kullanmaya devam eder.)

- [ ] **Step 2: Açı butonu (HUD editbtn yakını + navbar üstünde yüzen)**

`index.html`'de HUD'a küçük bir açı butonu (mobilde navbar üstünde de erişilir). `#i-angle` symbol (izometrik küp/ok):
```html
<symbol id="i-angle" viewBox="0 0 24 24"><path d="M12 3.5 20 8v8l-8 4.5L4 16V8z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/><path d="M12 3.5v17M4 8l8 4.5L20 8" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/></symbol>
```
HUD `editbtn`'den sonra:
```html
<button id="anglebtn" class="btn" title="Kamera açısı" style="width:52px; justify-content:center"><svg class="ic" style="margin:0"><use href="#i-angle"/></svg></button>
```

- [ ] **Step 3: Butonu bağla**

`src/main.ts` UI kurulumunda:
```ts
document.getElementById('anglebtn')?.addEventListener('click', () => cycleCameraAngle())
```

- [ ] **Step 4: Derleme + doğrulama**

Run: `npm run build` → tsc temiz.
Doğrulama: web'de açı butonuna basınca kamera 3 açı arasında döner; zoom/pan bozulmaz.

- [ ] **Step 5: Commit**

```bash
git add index.html src/main.ts
git commit -m "mobil: kamera açı butonu — 3 hazır izometrik açı arası geçiş"
```

---

### Task 3: Ofis finansal özet paneli

**Files:**
- Modify: `index.html` (Ofis modal: kırmızı bant başlık + özet kartlar)
- Modify: `src/main.ts` (`openOfficePanel()`; nav-office bağla; özet verisini state'ten doldur)

**Interfaces:**
- Consumes: `state` (kasa `money`, `stats.revenue`, `stats.served`, gün sonu raporu verisi), `isNativePlatform`.
- Produces: `openOfficePanel(): void`.

- [ ] **Step 1: Ofis modal HTML**

`index.html`'de mevcut modal kalıbıyla (ör. hesabım `#accwrap` yakını) yeni bir `.backdrop`:
```html
<div class="backdrop" id="officewrap">
  <div class="modal">
    <div class="mhead"><svg class="ic"><use href="#i-office"/></svg><h3 data-i18n="Ofis">Ofis</h3><button class="mclose" data-close="officewrap"><svg class="ic"><use href="#i-x"/></svg></button></div>
    <div class="mbody">
      <div class="stat-row"><span data-i18n="Kasa">Kasa</span><b id="of-cash" class="num">0 ₺</b></div>
      <div class="stat-row"><span data-i18n="Bugün gelir">Bugün gelir</span><b id="of-rev" class="num">0 ₺</b></div>
      <div class="stat-row"><span data-i18n="Bugün müşteri">Bugün müşteri</span><b id="of-served" class="num">0</b></div>
      <div class="stat-row"><span data-i18n="Günlük kâr/zarar">Günlük kâr/zarar</span><b id="of-net" class="num">0 ₺</b></div>
      <button class="btn primary" id="of-toggle" style="width:100%; justify-content:center; margin-top:10px"><svg class="ic"><use href="#i-power"/></svg><span id="of-toggle-label" data-i18n="İstasyonu Aç/Kapa">İstasyonu Aç/Kapa</span></button>
    </div>
  </div>
</div>
```
(`.stat-row`, `.num` mevcut değilse `<style>`'a ekle: `.stat-row{display:flex;justify-content:space-between;padding:8px 0;border-top:1px solid var(--line);font-weight:700}` `.num{font-variant-numeric:tabular-nums;font-weight:800}`; `.stat-row:first-child{border-top:0}`.)

- [ ] **Step 2: openOfficePanel + veri doldurma**

`src/main.ts`:
```ts
function openOfficePanel() {
  const set = (id: string, v: string) => { const e = document.getElementById(id); if (e) e.textContent = v }
  set('of-cash', `${Math.round(state.money)} ₺`)
  set('of-rev', `${Math.round(state.stats.revenue)} ₺`)      // kümülatif gelir (mevcut stat)
  set('of-served', `${state.stats.served}`)
  set('of-net', `${Math.round(dayNetProfit())} ₺`)           // gün sonu rapor verisi (aşağıda)
  document.getElementById('officewrap')?.classList.add('show')
}
document.getElementById('of-toggle')?.addEventListener('click', () => { document.getElementById('closebtn')?.click(); openOfficePanel() })
```
`dayNetProfit()`: gün sonu profit raporu zaten hesaplanıyorsa (`main.ts:~1997` day-end report) o değeri bir modül değişkeninde tut ve döndür; yoksa `state.stats.revenue - <o güne ait giderler>` — uygulama sırasında day-end report kodundaki mevcut kâr değişkeni kullanılır (yeni ekonomi hesabı EKLENMEZ, mevcut değer okunur).

Task 1'deki `nav-office` proxy'sini gerçek panele bağla: `openOfficePanel()`.

- [ ] **Step 3: Modal kapatma kancası**

Mevcut genel modal kapatma kalıbı (`ui.ts:184-191` `.backdrop` dış-tıklama + `.mclose`) `officewrap`'i otomatik kapsıyorsa ek kod gerekmez; kapsamıyorsa `officewrap`'i o kalıba dahil et.

- [ ] **Step 4: Derleme + doğrulama**

Run: `npm run build` → tsc temiz.
Doğrulama: web dar viewport → Ofis sekmesi paneli açar; kasa/gelir/müşteri/net doğru; aç/kapa çalışır; dışa tıklayınca kapanır.

- [ ] **Step 5: Commit**

```bash
git add index.html src/main.ts
git commit -m "mobil: Ofis finansal özet paneli (kasa/gelir/müşteri/kâr-zarar + aç-kapa)"
```

---

### Task 4: dev push + doğrulama

- [ ] **Step 1: dev'e push**

```bash
git push origin dev
```

- [ ] **Step 2: Doğrulama**

Web (dar viewport) + iOS simülatör (PoC localhost canlı): navbar 5 sekme, sekmeler modalları açar, Ofis paneli özet gösterir, kamera açı butonu çalışır. Web masaüstü regresyon: HUD normal, navbar gizli.

---

## Plan Sonu Kontrolü

Faz 2 bitince: mobilde alt navbar + Ofis özet + kamera açısı canlı; web masaüstü değişmemiş; prod izole. Faz 3 (tank sistemi) sonra gelir.
