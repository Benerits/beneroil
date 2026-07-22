# BenelOil Mobil Elden Geçirme — Tasarım Dokümanı

> Tarih: 2026-07-20 · Durum: kullanıcı onaylı tasarım (brainstorm çıktısı)
> Kapsam: mobil (Capacitor/iOS) deneyiminin düzeltilmesi ve genişletilmesi.
> **Tüm çalışma yalnızca `dev` branch'te** → push → `petrol-dev.benerits.com` + TestFlight dev build.

## 0. Prod izolasyon güvencesi (en kritik kısıt)

- dev ve prod **ayrı veritabanı** kullanır (Dokploy). Kodda dev/prod ayrımı yok; izolasyon deploy'daki `DATABASE_URL` ile.
- **main'e hiçbir şey push edilmez** → prod (`petrol.benerits.com`) hiçbir değişiklikten etkilenmez.
- Save yükleme (`hydrateState`, `state.ts:634`) defansiftir: tanımadığı alanları yoksayar, eksikleri default'lar.
- Yine de disiplin: Faz 3 save şeması **yalnızca additive** — mevcut `tanks: Record<FuelType, number>` ve `tankLevel` alanlarına dokunulmaz, yeni alanlar ayrı eklenir.
- Web deneyimi korunur: navbar, "Sorun Bildir" gizleme yalnızca native/mobilde; masaüstü web aynı kalır.

## 1. Kararlar (kullanıcı ile netleşti)

| Konu | Karar |
|---|---|
| Tank sistemi | Yakıt başına ayrı tank + adet artırma + görsel tip + 3D doluluk |
| Kamera açısı | "Açı değiştir" butonu, 3 sabit açı arası geçiş |
| Navbar sekmeleri | Ofis · İnşaat · Sipariş · Roadmap · Profil |
| Ofis sekmesi | aç/kapa toggle + finansal özet (kasa, günlük kâr/zarar, gider akışı) |
| Roadmap | oyunun tabela/harita dilinde kilitli yol haritası, "coming soon" |

## 2. Mimari yaklaşım

- Değişiklikler mevcut dosyalara yayılır: `index.html` (CSS+HTML), `src/main.ts`, `src/ui.ts`, `src/world.ts`, `src/state.ts`.
- **Mobil/native tespiti** tek bir yardımcıyla merkezileşir: `main.ts:109`'daki `window.Capacitor?.isNativePlatform()` kalıbı bir `isNative` bayrağına çıkarılır; navbar, report gizleme, panel dış-tıklama gibi mobil-özel davranışlar bunu ve/veya `@media (max-width:680px)` CSS breakpoint'ini kullanır.
- Oyunun görsel dili (`ui-signage-design` skill) ve mekanik/denge (`tycoon-design` skill) ilgili fazların uygulanışında rehber alınır.
- İnce UI ayrımları için mevcut kalıplar korunur: modal `.backdrop`/`.show` deseni (`ui.ts:184-191`), sayaç-tabanlı yapı (pump: `state.ts` `pumps` + `world.ts addPump index'li`) tank adet sistemine örnek.

## 3. Faz 1 — Hızlı düzeltmeler (düşük risk, önce)

1. **Sorun Bildir mobilde gizli.** `#fbbtn` (`index.html:591`) native'de `display:none`. `isNative` bayrağıyla `main.ts`'te gizlenir; web'de görünür kalır.
2. **Doldurma paneli dışına tıkla-kapat.** `#panel` (`index.html:354`, `ui.ts:350-356`) şu an yalnızca `car.phase==='atPump'` ile kapanır, dış-tıklama kancası yok. Mobilde sahne boşluğuna/karanlığa dokununca `ui.selectCar(null)` çağrılır (kanca `main.ts:2374` boşluk-tıklama bloğuna eklenir). Web davranışı değişmez.
3. **EV şarj yön düzeltme.** Kök neden: `confirmPlacement` (`main.ts:1364`) charger'ı `rotateBuilding`'den dışlıyor; `addEvCharger`/`moveCharger` (`world.ts:1071-1096`) kayıtlı açıyı uygulamıyor; klavye guard (`main.ts:1401`) ile mobil ⟳ (`main.ts:1636`) tutarsız. Çözüm: charger'a rotasyon izni ver, `addEvCharger` kuruluşta `placedRot`/rot uygular, **araç yanaşma noktası `evSlots` (`world.ts:1073`) açıya göre hesaplanır** (döndürülen üniteye araç doğru taraftan yanaşsın). Not: aynı sabit-yön guard'ı pompayı da etkiliyor; kapsam EV ile sınırlı tutulur, pompa mevcut davranışında bırakılır (istenirse ayrı iş).
4. **HUD dynamic island.** safe-area CSS'i zaten var (`index.html:53`, `viewport-fit=cover` `index.html:5`). Simülatörde doğrulanır; kesme sürüyorsa Capacitor **StatusBar overlay** ayarı (beneloil-ios native tarafı: status bar'ı overlay yapıp WebView'ı safe-area'ya bırakmak) + gerekiyorsa HUD top tamponu artırılır.

## 4. Faz 2 — Mobil navbar + kamera açısı

- **Alt navbar** yalnızca mobil/native'de görünür (`@media max-width:680px` + `isNative`). Sabit alt bar, 5 sekme:
  - **Ofis** → aç/kapa toggle (`#closebtn` mantığı) + finansal özet panel: kasa, günlük gelir/gider, kâr/zarar. Veri `state.stats` (`revenue` vb.) ve mevcut ekonomi alanlarından türetilir; salt-okunur özet (yeni ekonomi mekaniği yok).
  - **İnşaat** → mevcut `#shopbtn` menüsü.
  - **Sipariş** → mevcut `#orderbtn` modalı.
  - **Roadmap** → Faz 4'teki yeni sayfa.
  - **Profil** → mevcut `#accbtn` (Hesabım).
- Butonların DOM id'leri korunur (handler'lar `ui.ts`/`main.ts`'te değişmez), yalnızca mobilde konumlanışları navbar'a taşınır; HUD'da bu butonlar mobilde gizlenir. Masaüstü web HUD düzeni değişmez.
- Navbar, oyun raycast/zoom'unu engelleyen selektör listesine (`main.ts:220,229`) eklenir — navbar'a dokunuş sahneye geçmez.
- **Kamera açısı:** `main.ts:192`'deki sabit `camDir` yerine 2-3 hazır açı vektörü; bir "açı değiştir" butonu (navbar veya HUD) aralarında döner, `updateCamera()` çağrılır. Zoom (`main.ts:218`, pinch `225-243`) ve pan (`2277-2285`) korunur. Seçilen açı save'e additive olarak yazılabilir (opsiyonel, yoksa default).

## 5. Faz 3 — Tank sistemi (en büyük; additive save)

- **Veri modeli (additive):** mevcut `tanks: Record<FuelType, number>` (o anki litre) ve `tankLevel` **korunur**. Eklenen: yakıt başına tank adedi (ör. `tankCounts: Record<FuelType, number>`, default 1) ve gerekiyorsa yakıt başına kapasite seviyesi. Kapasite = adet/level'den türetilir. `serializeState`/`hydrateState` (`state.ts:613,634`) yeni alanları additive ekler; eski save'ler default 1 adet ile sorunsuz yüklenir.
- **Ekonomi:** pompa modeli örnek (`state.ts` `pumps` sayacı, shop satırı `Pompa #{n}`, `buyItem case 'pump'`, `world.addPump(index)`). Tank için yakıt-başına `Tank #{n}` satırı, maliyet eğrisi (`tycoon-design` ile dengelenir), `buyItem` artırma, `sellInfo`. Denge, mevcut ekonomiyi bozmayacak şekilde ayarlanır (dev'de test).
- **3D görsel (`world.ts`):** tek `buildTankCluster(level)` (renk seviyeye göre, `world.ts:669-679`) yerine yakıt-tipine-göre renkli kümeler (benzin=yeşil, dizel=turuncu, lpg=mavi — HUD renkleriyle eşleşir, `ui.ts:385`). Her yakıt için adet kadar ayrı tank; taşıma/rebuild mevcut kalıpla.
- **3D doluluk:** `addSphereTank` (`world.ts:651-666`) doluluk göstergesi kazanır (iç dolum/dikey clip/yan bar). Her-frame `updateTankFill(ratios)` metodu ana döngüde (`main.ts` tank/tanker güncellemesi yakını) `state.tanks[f]/kapasite` ile beslenir.
- **HUD:** yakıt-tipi chip + doluluk barı zaten var (`index.html:337-339`, `ui.ts:540-564`); adet göstergesi eklenir. Ölü `#tankfill` (`index.html:66`) temizlenir.

## 6. Faz 4 — Roadmap sayfası (coming soon)

- Navbar'daki Roadmap sekmesi tam-ekran bir panel açar (mobil öncelikli; web'de de erişilebilir olabilir).
- İçerik: oyunun **tabela/harita estetiğinde** (`ui-signage-design`) kilitli düğümlerden oluşan yol haritası:
  - **İstasyon → Liman:** 5 benzin istasyonu kurunca 1 liman açılır.
  - **Liman-takımı → Rafineri:** 3 (5-istasyon+1-liman) takımı olunca 1 rafineri işletilir.
- Her düğüm "coming soon" rozetli; ön koşul (ör. "5/5 istasyon") görsel gösterilir. **Yalnızca görsel/tanıtım** — gerçek mekanik yok (ileride).
- Salt-okunur, oyun state'ini değiştirmez.

## 7. Uygulama sırası ve test

- Fazlar sırayla dev'e push edilir; her push otomatik `petrol-dev.benerits.com` + TestFlight dev build üretir (kurulu otomasyon).
- Her faz sonrası doğrulama: web (Playwright/tarayıcı mobil viewport) + iOS simülatör ekran görüntüsü.
- Faz 1 en düşük riskli, ilk gider (hızlı kazanım + boru hattını doğrular). Faz 3 en büyük, ekonomi dengesi dev'de gözlemlenir.

## 8. Başarı kriterleri

- Mobilde: Sorun Bildir görünmez, doldurma paneli dışa dokunuşla kapanır, EV ünitesi döndürülebilir ve araç doğru yanaşır, HUD dynamic island'a takılmaz.
- Alt navbar 5 sekmeyle çalışır; Ofis finansal özet gösterir; kamera açısı değiştirilebilir.
- Yakıt tankları tipe göre ayrı/renkli, doluluk 3D'de görünür, adet artırılabilir; eski save'ler bozulmadan yüklenir.
- Roadmap sayfası tabela dilinde, kilitli+coming soon.
- Web deneyimi ve **prod tamamen değişmeden** kalır.
