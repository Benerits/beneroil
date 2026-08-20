---
name: godot-gdscript
description: Benzinlik Godot sürümü için GDScript 4.x yazım kuralları — tipli kod, sinyal/sahne mimarisi, autoload durum katmanı, determinizm ve trafik/kalabalık performans kalıpları. GDScript veya .tscn dosyasına dokunmadan önce oku.
---

# GDScript 4.x Kuralları (Benzinlik / Godot 4.7)

## Zorunlu yazım
- **Her yerde statik tip.** `var cash: float = 0.0`, `func sell(litres: float) -> float:`. Tipsiz kod hem yavaş hem `--check-only` gate'inde hataları saklar.
- Girinti **TAB**. Dosya başında `class_name` (global erişim gerekiyorsa), `@export` ile editör parametreleri, `@onready var x := $Path`.
- Sıra: `class_name` → `extends` → sinyaller → enum/const → `@export` → değişkenler → `_ready`/`_process` → public → private (`_` önekli).

## Mimari
- **Durum katmanı autoload.** Web'deki `src/state.ts` karşılığı tek bir autoload (`Game`) olsun; sahneler durumu okur, mutasyonu autoload'a delege eder. Sahnelere para/itibar state'i dağıtma — web sürümündeki senkron dersleri aynen geçerli.
- **Sinyal kullan, polling yapma.** `signal fuel_delivered(litres: float)`; bağlama 4.x sözdizimi: `pump.fuel_delivered.connect(_on_fuel_delivered)`.
- Node'a `get_node("../../Foo")` zinciriyle ulaşma; `@export var target: Node3D` ile enjekte et — sahne yeniden düzenlenince kırılmaz.
- Sahne = prefab. Pompa, EV şarj, müşteri arabası ayrı `.tscn`; `preload(...)` + `instantiate()` ile üret (`instance()` 3.x kalıntısıdır).
- Veri tabloları (maliyet kademeleri, marjlar) `Resource` (`.tres`) veya JSON olarak dursun, kod içine gömülmesin — dengeleme değişikliği script derlemesi gerektirmemeli.

## Zaman ve determinizm
- Ekonomi/gün döngüsü `delta` tabanlı olmalı (gün = 160 sn), kare sayısı tabanlı **asla** — FPS değişince denge kayar.
- Fizik/hareket `_physics_process`, UI/animasyon `_process`.
- **Simülasyon rastgeleliği tohumlu olsun:** global `randi()` yerine `RandomNumberGenerator.new()` + `seed`. Headless sim testleri (`godot-workflow`) ancak böyle tekrarlanabilir olur.

## Performans (trafik + dekor yoğun oyun)
- Müşteri arabaları için **object pooling**; her müşteride `instantiate()`/`queue_free()` döngüsü GC tırtıklaması yapar.
- Görünmeyen/boş üniteleri `set_process(false)` + `set_physics_process(false)` ile sustur.
- Tekrarlayan dekor (bina, ağaç, bordür) için `MultiMeshInstance3D`; web sürümünde sahne ağırlığı bilinen dertti.
- Tween'ler `create_tween()` ile üretilir ve node ölünce otomatik iptal — elle `Tween` node'u ekleme.

## ⚠️ .tscn elle yazarken: Transform3D SATIR-MAJOR
`.tscn` içindeki `Transform3D(...)` 12 sayısı **eksen sırasında değil, transpoze (satır-major)** yazılır. Ölçüldü (2026-07-30):
```
Transform3D(Vector3(1,2,3), Vector3(4,5,6), Vector3(7,8,9), Vector3(10,11,12))
  → .tscn: Transform3D(1, 4, 7, 2, 5, 8, 3, 6, 9, 10, 11, 12)
```
Yani `Transform3D(x.x, y.x, z.x, x.y, y.y, z.y, x.z, y.z, z.z, o.x, o.y, o.z)`. Elle eksen sırasıyla yazarsan matris **transpoze** olur; kamera/ışık sessizce yanlış yöne bakar — hata mesajı YOK, sadece boş gökyüzü görürsün.

**Matrisi elle hesaplama — motora hesaplat, çıktıyı yapıştır:**
```gdscript
# headless script içinde
var cam := Transform3D(Basis(), Vector3(22, 14, 26)).looking_at(Vector3(0, 2, 0), Vector3.UP)
print(var_to_str(cam))   # .tscn'e birebir yapıştırılacak metni verir
```
`var_to_str` tam olarak `.tscn` biçimini üretir; ortonormallik de garanti olur.

## JSON tuzağı (denge tabloları JSON'dan okunuyor)
`JSON.parse_string` **tüm sayıları float üretir.** Sonuçları:
- `EconData.arr("tank_capacity") == [800, 1500]` → **false** (`[800.0, 1500.0]` gelir). Diziyi eleman eleman `is_equal_approx` ile karşılaştır.
- `Dictionary`/`Array` dönüşlerini `as` ile cast et, sonra `float(...)`/`int(...)` ile daralt.
- Kademe/indeks olarak kullanacağın değeri mutlaka `int(...)` yap; float indeks sessiz hata kaynağı.

## 4.x tuzakları (3.x örneği kopyalarken)
- `yield` → `await`; `instance()` → `instantiate()`; `connect("sig", self, "_m")` → `sig.connect(_m)`.
- `OS.get_ticks_msec()` → `Time.get_ticks_msec()`.
- `KinematicBody` → `CharacterBody3D` (+ `velocity` alanı, `move_and_slide()` argümansız).
- `@tool` script'i editörde de koşar; sahneyi bozabilir — gerçekten gerekmiyorsa koyma.

## Gate
Her GDScript değişikliğinden sonra: `--check-only` ile parse, sonra ilgili headless test. Denge sayısı değiştiyse `tycoon-economy` skill'indeki exploit listesini de gez.
