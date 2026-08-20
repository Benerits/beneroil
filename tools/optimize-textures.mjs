#!/usr/bin/env node
/**
 * Zemin dokularını Meta (light) build'i için küçültür.
 *   node tools/optimize-textures.mjs
 *
 * Neden: gen/ground_*.png toplam ~4,9 MB ve bunlar TEKRARLAYAN (tiling) zemin dokuları —
 * ekranda 146x159 kez tekrarlanıyorlar, 1024px çözünürlük gözle ayırt edilemez.
 * 512px JPEG'e indirince ~30x küçülüyorlar (1702 KB → ~56 KB). Alfa kanalı gerekmiyor.
 *
 * Çıktı: public/gen/opt/*.jpg — repoya girer, yalnız meta build'i kullanır
 * (bkz. platform.ts texture(); web/iOS orijinal PNG'lerle aynı görünümde kalır).
 *
 * macOS'un yerleşik `sips`'ini kullanır — ek bağımlılık yok.
 */
import { execFileSync } from 'node:child_process'
import { mkdirSync, readdirSync, statSync } from 'node:fs'
import { join, resolve, basename } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)))
const SRC = join(ROOT, 'public', 'gen')
const OUT = join(SRC, 'opt')
const MAX_PX = 512
const QUALITY = 72

mkdirSync(OUT, { recursive: true })

const sources = readdirSync(SRC).filter(f => f.startsWith('ground_') && f.endsWith('.png'))
if (!sources.length) { console.error('HATA: public/gen/ground_*.png bulunamadı'); process.exit(1) }

let before = 0, after = 0
for (const f of sources) {
  const src = join(SRC, f)
  const dst = join(OUT, basename(f, '.png') + '.jpg')
  execFileSync('sips', ['-s', 'format', 'jpeg', '-s', 'formatOptions', String(QUALITY), '-Z', String(MAX_PX), src, '--out', dst], { stdio: 'ignore' })
  const b = statSync(src).size, a = statSync(dst).size
  before += b; after += a
  console.log(`${f.padEnd(24)} ${(b / 1024).toFixed(0).padStart(6)} KB → ${(a / 1024).toFixed(0).padStart(5)} KB  (${(b / a).toFixed(0)}x)`)
}
console.log(`\nToplam: ${(before / 1048576).toFixed(2)} MB → ${(after / 1024).toFixed(0)} KB  (${(before / after).toFixed(0)}x küçük)`)
