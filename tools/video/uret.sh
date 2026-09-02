#!/bin/bash
# TANITIM VİDEOLARI ÜRETİCİ — yakalanan kareleri MP4'e çevirir, müzik + hook sesi ekler.
# Her videonun hook sesi ve müziği AYRI: 5 video arka arkaya izlenince tekdüze olmasın.
set -e
KARE=${1:-/tmp/beneloil-video}
CIKTI=${2:-$HOME/Desktop/beneloil-tanitim-videolari}
SES=$HOME/Desktop/beneloil-sesler/normalize
mkdir -p "$CIKTI"
cd "$(dirname "$0")"

uret() {  # klasor  cikti-ad  hook-ses  muzik
  local d="$KARE/$1"
  [ -d "$d" ] || { echo "atlandı (kare yok): $1"; return; }
  echo "▶ $2"
  swift kareler-mp4.swift "$d" 60 "/tmp/_ham-$1.mp4"
  swift tamamla.swift "/tmp/_ham-$1.mp4" "$SES/$4" "$SES/$3" "$CIKTI/$2.mp4"
}

uret mudur      1-mudur-yetkileri  basarim.wav      muzik-4-major.wav
uret dondur     2-dondurme         insaat.wav       muzik-1-pentatonik.wav
uret otopark    3-otopark-bugu     hata.wav         muzik-3-nihavend.wav
uret performans 4-performans       patlama.wav      muzik-2-hicaz.wav
uret bilgi      5-bilgi-kutulari   para.wav         muzik-tam.wav
# harita v3 (2 Eyl): hook = başarım çanı ("tek istasyon" → geri çekil), müzik = pentatonik (sakin, harita)
uret harita2    6-sube-agi-haritasi-v3  basarim.wav  muzik-1-pentatonik.wav

echo; echo "✓ hazır: $CIKTI"
ls -lh "$CIKTI"
