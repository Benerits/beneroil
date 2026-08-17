/**
 * TIKTOK VİDEO MONTAJI — tarif (recipe) dosyasından bitmiş MP4 üretir.
 *
 * Boru hattı: record.mjs (dikey gameplay webm) + synth.mjs (chiptune WAV)
 * → ffmpeg: 1080×1920 H.264, hook yazısı, zamanlı altyazılar, kalıcı filigran,
 * son 2.5 sn marka kapanışı, müzik + fade-out.
 *
 *   FFMPEG=/path/to/ffmpeg node tools/tiktok/make.mjs tools/tiktok/recipes/rush.json out.mp4
 *
 * ffmpeg yolu: FFMPEG env > `ffmpeg-static` paketi > PATH'teki ffmpeg.
 */
import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const RECIPE_PATH = process.argv[2]
const OUT = process.argv[3] || '/tmp/tiktok.mp4'
const R = JSON.parse(readFileSync(RECIPE_PATH, 'utf8'))

let FFMPEG = process.env.FFMPEG
if (!FFMPEG) { try { FFMPEG = (await import('ffmpeg-static')).default } catch { FFMPEG = 'ffmpeg' } }
const FONT = process.env.FONT || '/System/Library/Fonts/Supplemental/Arial Bold.ttf'

const tmp = mkdtempSync(join(tmpdir(), 'tiktok-'))
const rawWebm = join(tmp, 'raw.webm')
const musicWav = join(tmp, 'music.wav')

// 1) kayıt + 2) müzik
execFileSync('node', ['tools/tiktok/record.mjs', RECIPE_PATH, rawWebm], { stdio: 'inherit' })
execFileSync('node', ['tools/tiktok/synth.mjs', String(R.seconds + 1), musicWav, String(R.musicSeed ?? 7)], { stdio: 'inherit' })

// 3) ffmpeg montaj
// drawtext metinleri: TR karakter/escape derdi olmasın diye textfile kullanılır
const tf = (name, text) => { const p = join(tmp, name); writeFileSync(p, text); return p }
const esc = p => p.replace(/([:\\])/g, '\\$1').replace(/'/g, "\\\\'")

const filters = ['scale=1080:1920:flags=lanczos', 'fps=30']
// HOOK: ilk saniyelerde üstte büyük kutu yazı
if (R.hook) {
  filters.push(`drawtext=fontfile='${esc(FONT)}':textfile='${esc(tf('hook.txt', R.hook))}'` +
    `:fontsize=62:fontcolor=white:borderw=3:bordercolor=black@0.65` +
    `:box=1:boxcolor=0xd64545@0.92:boxborderw=22` +
    `:x=(w-text_w)/2:y=170:enable='between(t,${R.hookFrom ?? 0.4},${R.hookTo ?? 4.6})'`)
}
// ZAMANLI ALTYAZILAR: alt üçte birlik bantta
for (let i = 0; i < (R.captions ?? []).length; i++) {
  const c = R.captions[i]
  filters.push(`drawtext=fontfile='${esc(FONT)}':textfile='${esc(tf(`cap${i}.txt`, c.text))}'` +
    `:fontsize=52:fontcolor=white:borderw=3:bordercolor=black@0.7` +
    `:box=1:boxcolor=black@0.45:boxborderw=16` +
    `:x=(w-text_w)/2:y=h-430:enable='between(t,${c.from},${c.to})'`)
}
// FİLİGRAN: köşede sürekli beneloil.com
filters.push(`drawtext=fontfile='${esc(FONT)}':text='beneloil.com'` +
  `:fontsize=34:fontcolor=white@0.85:borderw=2:bordercolor=black@0.5:x=w-text_w-28:y=64`)
// KAPANIŞ: son 2.5 sn kararan zemin + büyük çağrı
const endFrom = R.seconds - 2.5
filters.push(`drawbox=x=0:y=0:w=iw:h=ih:color=black@0.55:t=fill:enable='gte(t,${endFrom})'`)
filters.push(`drawtext=fontfile='${esc(FONT)}':textfile='${esc(tf('end1.txt', R.endTitle ?? 'BENELOIL'))}'` +
  `:fontsize=110:fontcolor=white:borderw=4:bordercolor=0xd64545` +
  `:x=(w-text_w)/2:y=(h/2)-140:enable='gte(t,${endFrom})'`)
filters.push(`drawtext=fontfile='${esc(FONT)}':textfile='${esc(tf('end2.txt', R.endSub ?? 'beneloil.com — ücretsiz oyna'))}'` +
  `:fontsize=54:fontcolor=white:box=1:boxcolor=0xd64545@0.95:boxborderw=18` +
  `:x=(w-text_w)/2:y=(h/2)+30:enable='gte(t,${endFrom})'`)

execFileSync(FFMPEG, [
  '-y', '-i', rawWebm, '-i', musicWav,
  '-t', String(R.seconds),
  '-vf', filters.join(','),
  '-af', `afade=t=out:st=${R.seconds - 1.4}:d=1.4,loudnorm=I=-14:TP=-1.5`,
  '-map', '0:v:0', '-map', '1:a:0',
  '-c:v', 'libx264', '-preset', 'medium', '-crf', '20', '-pix_fmt', 'yuv420p',
  '-c:a', 'aac', '-b:a', '160k', '-shortest', OUT,
], { stdio: 'inherit' })
rmSync(tmp, { recursive: true, force: true })
console.log(`\n✓ HAZIR: ${OUT}`)
