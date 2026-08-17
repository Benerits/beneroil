# TikTok/Shorts Video Pipeline

Tek komutla oyundan dikey (1080×1920) kısa video üretir: gameplay kaydı (Playwright,
mobil arayüz) + telifsiz chiptune müzik (synth.mjs) + ffmpeg montaj (hook, altyazı,
filigran, marka kapanışı).

## Kullanım
```bash
npm i          # playwright-core repo bağımlılığı; ffmpeg için: npm i -D ffmpeg-static
FFMPEG=$(node -e "console.log(require('ffmpeg-static'))") \
  node tools/tiktok/make.mjs tools/tiktok/recipes/rush.json cikti.mp4
```
Chrome kurulu olmalı (playwright `channel: 'chrome'`). Vite dev sunucusunu kendisi açar.

## Yeni video = yeni tarif (recipes/*.json)
- `seconds`: video süresi · `hook`: ilk saniyelerdeki büyük başlık (\n ile 2 satır)
- `captions`: `{from,to,text}` zamanlı altyazılar (Arial: emoji YOK, TR harf OK)
- `steps`: senaryo — `zoom` (n,dy), `pan` (from,to,ms), `wait` (ms),
  `rush`/`cheapFuel` (etkinlik tetikler), `money` (kasa), `eval` (serbest JS, __dbg ile)
- `musicSeed`: farklı müzik varyasyonu için değiştir
