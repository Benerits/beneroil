---
name: godot-workflow
description: Godot 4.7 motorunu ajan/terminal ortamından headless sürme rehberi — binary yolu, syntax kontrolü, headless test koşumu, asset import, export ve çıktı okuma kuralları. Godot projesinde HERHANGİ bir komut çalıştırmadan, test yazmadan veya build almadan önce oku.
---

# Godot Workflow (headless, ajan-güvenli)

## Motor
- Sürüm: **4.7.1.stable.official** (2026-07-30'da doğrulandı). **GDScript-only build — C#/Mono YOK.** `.cs` script yazma, `csproj` üretme.
- Binary'yi şu sırayla çöz (kullanıcı `.app`'i taşımış olabilir):
  ```bash
  GODOT="${GODOT:-$(ls -d /Applications/Godot.app/Contents/MacOS/Godot \
    ~/Applications/Godot.app/Contents/MacOS/Godot \
    ~/Downloads/Godot.app/Contents/MacOS/Godot 2>/dev/null | head -1)}"
  "$GODOT" --version   # 4.7.1.stable... beklenir
  ```
- Kurulu konum: **`/Applications/Godot.app`** (2026-07-30'da buraya taşındı, quarantine bayrağı kaldırıldı).

## ⚠️ GUI editörü ASLA açma
`$GODOT --path .` (flag'siz) veya `-e` pencere açar ve terminali süresiz bloklar. Ajan bağlamında **her komut `--headless` almalı** — tek istisna kullanıcının kendi açtığı editör.

## Doğrulanmış reçeteler
```bash
# 1) Syntax/parse kontrolü (lint gate — hızlı, sahneye ihtiyaç yok)
"$GODOT" --headless --path . --script res://scripts/foo.gd --check-only

# 2) Headless test/sim koşumu  (SceneTree script kalıbı — aşağıda)
"$GODOT" --headless --path . --script res://tests/econ_test.gd

# 3) Dosya ekledikten/GLB koyduktan SONRA import şart (.godot/ cache üretir)
"$GODOT" --headless --path . --import

# 4) Gerçek sahneyi N kare koştur (smoke/perf)
"$GODOT" --headless --path . --scene res://scenes/station.tscn --quit-after 300

# 5) Export (önce export templates gerekir — aşağıya bak)
"$GODOT" --headless --path . --export-release "Windows Desktop" build/benzinlik.exe
```

## Headless test script kalıbı (çalıştığı doğrulandı)
`SceneTree`'yi extend et, `_init`'te koş, `quit(kod)` ile çık. **Girinti TAB — boşluk karıştırmak parse hatası verir.**
```gdscript
extends SceneTree

func _init() -> void:
	var fails := 0
	fails += _assert(Econ.fuel_margin("benzin") == 3.5, "benzin marjı 3.5")
	print("FAILS=", fails)
	quit(1 if fails > 0 else 0)

func _assert(cond: bool, label: String) -> int:
	print(("PASS  " if cond else "FAIL  ") + label)
	return 0 if cond else 1
```

### ⚠️ SceneTree testlerinde autoload YÜKLENMEZ
`--script` ile `SceneTree` koşarken `project.godot`'taki autoload'lar (ör. `Game`) **oluşturulmaz** — teste `Game.x` yazarsan "identifier not declared" alırsın. Bu yüzden:
- Veri/kural katmanı autoload'a bağımlı olmasın (statik API — `scripts/econ_data.gd` örneği).
- Durum node'u testte elle kurulur: `var g: Node = load("res://scripts/game.gd").new()` + `g.new_game()`. Bu yüzden kurulum kodu `_ready()`'de değil, ayrı çağrılabilir bir fonksiyonda durur.
- İş bitince `g.free()` — yoksa çıkışta ObjectDB uyarısı artar.

## Çıktı okuma kuralları (kritik)
- **Exit code'a tek başına güvenme.** Godot script hatasında bile 0 dönebilir. Çıktıyı metin olarak da denetle:
  `... 2>&1 | tee /dev/stderr | grep -qE "SCRIPT ERROR|^ERROR|FAIL" && echo "BAŞARISIZ"`
- **Normal gürültü — hata sanma:** `SceneTree` script'leri çıkışta düzenli olarak
  `WARNING: N RID of type "CanvasItem" was leaked` / `WARNING: N ObjectDB instance was leaked at exit`
  basar. Bu kalıp beklenen davranıştır, peşine düşme.
- Detay gerekince `--verbose`, ama çıktı çok uzar; önce grep'le.

## Export templates
`~/Library/Application Support/Godot/export_templates/` **şu an boş → hiçbir platforma build alınamaz.** İlk build'den önce templates kurulmalı (editörde Editor → Manage Export Templates, ya da sürümle **birebir** eşleşen `4.7.1.stable` paketi). Sürüm uyuşmazlığı export'u sessizce bozar. Detay için `godot-steam` skill'ine bak.

## Repo higyeni
- `.gitignore`: `.godot/` (import cache, asla commit edilmez), `build/`, `.DS_Store`.
- `*.uid` dosyaları **commit edilir** — Godot 4.4+ script/asset kimliği; silinmesi referansları kırar (`--scene` UID de kabul ediyor).
- `export_presets.cfg` içinde store/imza bilgisi tutulabiliyor; commit etmeden önce içine bak.
