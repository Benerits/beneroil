#!/usr/bin/env bash
# BenelOil Steam — headless test koşucusu.
# Kullanım: ./run-tests.sh            (tüm testler)
#           ./run-tests.sh wealth     (isim filtresi)
set -uo pipefail
cd "$(dirname "$0")"

GODOT="${GODOT:-$(ls -d /Applications/Godot.app/Contents/MacOS/Godot \
  ~/Applications/Godot.app/Contents/MacOS/Godot \
  ~/Downloads/Godot.app/Contents/MacOS/Godot 2>/dev/null | head -1)}"
[ -x "$GODOT" ] || { echo "Godot bulunamadı. GODOT=... ile yol ver."; exit 127; }

filter="${1:-}"
fails=0

for t in tests/*.gd; do
  name="$(basename "$t" .gd)"
  [ -n "$filter" ] && [[ "$name" != *"$filter"* ]] && continue

  # Önce parse gate — sözdizimi hatasını test çıktısına karıştırmadan yakala.
  if ! "$GODOT" --headless --path . --script "res://$t" --check-only >/dev/null 2>&1; then
    echo "✗ $name — PARSE HATASI"
    "$GODOT" --headless --path . --script "res://$t" --check-only 2>&1 | grep -E "SCRIPT ERROR|Parse Error" | head -5
    fails=$((fails + 1))
    continue
  fi

  out="$("$GODOT" --headless --path . --script "res://$t" 2>&1)"
  # Exit code'a tek başına güvenilmez; çıktı metnini de denetle.
  if grep -qE "SCRIPT ERROR|^ERROR|FAIL " <<<"$out"; then
    echo "✗ $name"
    grep -E "SCRIPT ERROR|^ERROR|FAIL |SONUÇ" <<<"$out" | head -20
    fails=$((fails + 1))
  else
    echo "✓ $name  ($(grep -c "PASS " <<<"$out") kontrol)"
  fi
done

echo "———"
[ "$fails" -eq 0 ] && echo "tüm testler geçti" || echo "$fails test başarısız"
exit "$fails"
