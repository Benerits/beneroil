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
const FONT = process.env.FONT || '/System/Library/Fonts/Supplemental/Arial Rounded Bold.ttf'

const tmp = mkdtempSync(join(tmpdir(), 'tiktok-'))
const rawWebm = join(tmp, 'raw.mp4') // CDP screencast → h264 (record.mjs muxlar)
const musicWav = join(tmp, 'music.wav')

// 1) kayıt + 2) müzik
execFileSync('node', ['tools/tiktok/record.mjs', RECIPE_PATH, rawWebm], { stdio: 'inherit' })
execFileSync('node', ['tools/tiktok/synth.mjs', String(R.seconds + 1), musicWav, String(R.musicSeed ?? 7)], { stdio: 'inherit' })

// 3) ffmpeg montaj
// drawtext metinleri: TR karakter/escape derdi olmasın diye textfile kullanılır
const tf = (name, text) => { const p = join(tmp, name); writeFileSync(p, text); return p }
const esc = p => p.replace(/([:\\])/g, '\\$1').replace(/'/g, "\\\\'")

const filters = ['scale=1080:1920:flags=lanczos', 'fps=30']
// YAZILAR ARTIK TARAYICIDA (overlay motoru, record.mjs) — Baloo 2 + emoji + spring
// animasyonlarla. ffmpeg yalnız ölçek + müzik + fade yapar.

const TRIM = R.trimStart ?? 0
execFileSync(FFMPEG, [
  '-y', '-ss', String(TRIM), '-i', rawWebm, '-i', musicWav,
  '-t', String(R.seconds),
  '-vf', filters.join(','),
  '-af', `afade=t=out:st=${R.seconds - 1.4}:d=1.4,loudnorm=I=-14:TP=-1.5`,
  '-map', '0:v:0', '-map', '1:a:0',
  '-c:v', 'libx264', '-preset', 'medium', '-crf', '20', '-pix_fmt', 'yuv420p',
  '-c:a', 'aac', '-b:a', '160k', '-shortest', OUT,
], { stdio: 'inherit' })
rmSync(tmp, { recursive: true, force: true })
console.log(`\n✓ HAZIR: ${OUT}`)
