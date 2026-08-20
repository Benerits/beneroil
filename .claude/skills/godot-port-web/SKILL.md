---
name: godot-port-web
description: Web/three.js Benzinlik sürümünü Godot'a taşıma haritası — hangi mantık birebir kopyalanır, GLB asset ve karakter kalibrasyon tuzağı, i18n/UI/kayıt dönüşümü, test paritesi. beneloil-steam altında yeni sistem kurarken veya web'deki bir mekaniği Godot'a geçirirken kullan.
---

# Web (three.js/TS) → Godot Port Haritası

Kaynak: repo kökündeki Vite + TypeScript + three.js sürümü. Hedef: `beneloil-steam/` (Godot 4.7, şu an boş).

## Neyi kopyala, neyi yeniden yaz
| Katman | Kaynak | Karar |
|---|---|---|
| Ekonomi/denge sayıları | `src/state.ts` (~2400 satır) | **BİREBİR KOPYALA.** Port sırasında yeniden dengeleme yapma; iki sürüm ayrışırsa hangi sayının doğru olduğu kaybolur. Değişiklik gerekiyorsa `tycoon-economy` üzerinden ayrı iş. |
| Oyun mantığı (müşteri akışı, kumbara, itibar) | `src/world.ts`, `src/cars.ts`, `src/rival.ts`, `src/news.ts` | Mantığı taşı, uygulamayı yeniden yaz — DOM/three.js kancaları Godot node'larına çevrilir. |
| Render/sahne kurulumu | `src/scenery.ts`, `src/models.ts` | **Yeniden yaz.** Godot sahne ağacı + import edilmiş GLB; three.js sahne kodu taşınmaz. |
| DOM UI | `src/ui.ts`, `src/logbook-ui.ts` | Yeniden yaz (Control node + Theme). Tasarım dili `ui-signage-design`. |
| Sunucu/anti-cheat | `server/index.js` | Taşınmaz — Steam sürümü offline. Bkz. `godot-steam` §4. |
| Reklamlar | `src/ads.ts` | **Taşınmaz.** Steam'de reklam yok; `game-ads-pacing` bu hedefte geçersiz. Gelir modeli tek seferlik satın alma. |

## Asset'ler
- `public/kenney/**.glb` (araçlar, binalar) Godot'un glTF importer'ıyla **doğrudan** kullanılır — Kenney CC0, lisans engeli yok. `beneloil-steam/assets/` altına kopyala, sonra `--headless --import` (bkz. `godot-workflow`).
- ⚠️ **Karakter yer hizası tuzağı:** web sürümünde karakterler havada/gömülü kaldı, kök neden SkinnedMesh **bind-pose bbox**'ıydı (commit `790ed66`). Godot'ta aynı sınıf hata skeleton rest-pose AABB'sinden gelir. Her karakter/araç import'undan sonra ayakların `y=0`'da olduğunu tek karelik headless sahneyle doğrula, göz kararıyla offset girme.
- Ölçek: three.js ve Godot da metre + Y-up. Modelleri ölçeklemeden koy, sonra ölç.

## i18n
`src/i18n.ts` (~2300 satır) anahtar-değer sözlüğü → Godot `Translation` (CSV veya PO) + `tr()`. **Anahtar isimlerini koru** — iki sürüm arasında metin paritesini kontrol edilebilir tutar; anahtar yeniden adlandırma port sırasında yapılacak en pahalı iş.

## Kayıt
- Web: sunucu otoriteli. Godot: `user://save.json` (veya `ConfigFile`), `save_version` alanı zorunlu, Steam Cloud'a bağlanır.
- Alan isimlerini web save şemasından kopyala; ileride oyuncu web'den Steam'e taşınmak isterse tek yönlü import yazılabilir kalsın.

## Test paritesi
Web tarafında `tools/tests/*.mjs` (sim-smoke, wealth-check, traffic-load, anticheat...) var. Godot'ta karşılıklarını **headless SceneTree test'i** olarak kur (`godot-workflow`'daki kalıp) ve aynı isimleri kullan: `tests/sim_smoke.gd`, `tests/wealth_check.gd`. Aynı denge girdisine iki motorun aynı çıktıyı vermesi, portun doğru olduğunun tek somut kanıtı.

## Sıra önerisi
1. `project.godot` + autoload `Game` + `state.ts` sayı tablolarının `.tres`/JSON aktarımı, üstüne `wealth_check` testi.
2. Tek pompa + tek müşteri döngüsü (mekaniğin çekirdeği), `sim_smoke` testi.
3. GLB import + yer hizası kalibrasyonu.
4. UI/Theme, i18n.
5. Steam katmanı (en son — oyun çalışmadan SDK bağlamak zaman kaybı).
