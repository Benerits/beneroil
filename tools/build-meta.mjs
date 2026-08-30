#!/usr/bin/env node
/**
 * Facebook Instant Games bundle'ı üretir.
 *   npm run build:meta
 *
 * Çıktı: ../beneloil-meta/beneloil-meta-<tarih>.zip  (index.html zip KÖKÜNDE olmalı)
 * Yükleme: App Dashboard → Instant Games → Web Hosting → Upload Version.
 *
 * Reklam placement ID'leri .env.meta'dan gelir (bkz. .env.meta.example).
 */
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { basename, join, resolve, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)))
const DIST = join(ROOT, 'dist-meta')
const OUT_DIR = resolve(ROOT, '..', 'beneloil-meta')

const run = (cmd, args, opts = {}) =>
  execFileSync(cmd, args, { cwd: ROOT, stdio: 'inherit', ...opts })

// 1) tip kontrolü + build
run('npx', ['tsc', '--noEmit'])
// Build damgası: açılış teşhisinde görünür → hangi bundle'ın CANLI olduğunu
// tahmin etmek yerine ekrandan okuruz.
const BUILD_ID = new Date().toISOString().slice(5, 16).replace(/[-T:]/g, '')
run('npx', ['vite', 'build', '--mode', 'meta'], { env: { ...process.env, VITE_BUILD_ID: BUILD_ID } })
console.log(`\nBuild ID: ${BUILD_ID}  (oyun açılış ekranında bu yazacak)`)

// 2) doğrulama: index.html kökte mi, dış istek kaldı mı
if (!existsSync(join(DIST, 'index.html'))) {
  console.error('HATA: dist-meta/index.html yok — bundle geçersiz.')
  process.exit(1)
}
const html = readFileSync(join(DIST, 'index.html'), 'utf8')
// yalnız KAYNAK yüklemeleri (<link>/<script>/<img>) — <a href> dış link sorun değil
const externals = [...html.matchAll(/<(?:link|script|img)\b[^>]*?(?:src|href)="(https?:\/\/[^"]+)"/g)].map(m => m[1])
const allowed = externals.filter(u => u.startsWith('https://connect.facebook.net/'))
const suspect = externals.filter(u => !u.startsWith('https://connect.facebook.net/'))
if (suspect.length) {
  console.warn('\nUYARI — index.html hâlâ dış kaynak istiyor (NEZP altında engellenebilir):')
  for (const u of suspect) console.warn('  ' + u)
}
if (!allowed.length) {
  console.error('\nHATA: FBInstant SDK script\'i enjekte edilmemiş.')
  process.exit(1)
}

// 3) fbapp-config.json — bundle KÖKÜNDE olmalı, yükleme sırasında Meta doğruluyor.
//
// UYARI: Meta'nın bundle-configuration dokümanı bu dosya için ÜÇ KEZ yanlış. Aşağıdaki
// şema deneme-yanılmayla, yükleyicinin kendi hata mesajlarından çıkarıldı ve GEÇTİĞİ
// doğrulandı (14 Ağu 2026). Dokümana bakıp "düzeltme" — geri kırarsın.
//   Doküman der ki                          Gerçek
//   ─────────────────────────────────────   ──────────────────────────────────────
//   "dosya opsiyonel"                       ZORUNLU ("Bundle Config is Missing")
//   navigation_menu_version opsiyonel       ZORUNLU ("Must specify property...")
//   NAV_1 | NAV_2                           NAV_FLOATING | NAV_BAR
//   orientation: "portrait" (küçük harf)    "PORTRAIT" (şema SCREAMING_CASE)
//   platform_version önerilir               eklendiğinde reddedildi → hiç yazmıyoruz
//                                           (SDK sürümü zaten fbinstant.8.0.js ile sabit)
//
// NAV_FLOATING seçildi: BenelOil'in HUD'ı üstte yoğun, kalıcı çubuk dikey alan yiyor.
writeFileSync(join(DIST, 'fbapp-config.json'), JSON.stringify({
  instant_games: {
    orientation: 'PORTRAIT',
    navigation_menu_version: 'NAV_FLOATING',
  },
}, null, 2) + '\n')

// 4) ölü varlıkları buda — kaynak repoya DOKUNMADAN, yalnız bundle'dan çıkarır.
// Referans tespiti src/*.ts + index.html içindeki dosya adı geçişine bakar; kits.ts'e yeni
// bir model eklediğinde otomatik olarak budanmaktan çıkar (elle liste tutmaya gerek yok).
function walk(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap(e => {
    const p = join(dir, e.name)
    return e.isDirectory() ? walk(p) : [{ path: p, size: statSync(p).size }]
  })
}
const srcText = walk(join(ROOT, 'src')).filter(f => f.path.endsWith('.ts'))
  .map(f => readFileSync(f.path, 'utf8')).join('\n') + readFileSync(join(ROOT, 'index.html'), 'utf8')

/** Bundle'da kalmalı mı? */
function keep(rel) {
  // glb'ler Textures/colormap.png'ye DIŞARIDAN referans verir — asla budama
  if (rel.includes('/Textures/')) return true
  // şube küçük resimleri kodda `loc-${id}.jpg` olarak dinamik kuruluyor
  if (basename(rel).startsWith('loc-')) return true
  // light mod optimize dokuları kullanıyor → orijinal 4,8 MB'lık PNG'ler gereksiz
  if (/^gen\/ground_.*\.png$/.test(rel)) return false
  if (rel === 'promo-stations.json') return false // yalnız tanıtım modunda kullanılıyor
  if (!rel.startsWith('gen/') && !rel.startsWith('kenney/')) return true
  return srcText.includes(basename(rel).replace(/\.[a-z0-9]+$/i, ''))
}

const pruned = []
for (const f of walk(DIST)) {
  const rel = relative(DIST, f.path)
  if (!keep(rel)) { pruned.push({ rel, size: f.size }); rmSync(f.path) }
}
if (pruned.length) {
  const saved = pruned.reduce((a, f) => a + f.size, 0)
  console.log(`\nBudandı: ${pruned.length} referanssız dosya, ${(saved / 1048576).toFixed(1)} MB`)
  for (const f of pruned.sort((a, b) => b.size - a.size).slice(0, 6)) {
    console.log(`  ${(f.size / 1024).toFixed(0).padStart(7)} KB  ${f.rel}`)
  }
  if (pruned.length > 6) console.log(`  … +${pruned.length - 6} dosya daha`)
}

const files = walk(DIST)
const total = files.reduce((a, f) => a + f.size, 0)
console.log(`\nBundle: ${files.length} dosya, ${(total / 1048576).toFixed(1)} MB (sıkıştırılmamış)`)
console.log('En büyük 8 dosya:')
for (const f of files.sort((a, b) => b.size - a.size).slice(0, 8)) {
  console.log(`  ${(f.size / 1024).toFixed(0).padStart(7)} KB  ${relative(DIST, f.path)}`)
}

// 4) zip
mkdirSync(OUT_DIR, { recursive: true })
const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, '')
const zipPath = join(OUT_DIR, `beneloil-meta-${stamp}.zip`)
// zip VARSA üstüne ekler (eski dosyalar arşivde kalır, boyut şişer) → önce sil
rmSync(zipPath, { force: true })
run('zip', ['-qr', zipPath, '.', '-x', '.DS_Store', '-x', '*/.DS_Store'], { cwd: DIST })
console.log(`\n✓ ${zipPath}  (${(statSync(zipPath).size / 1048576).toFixed(1)} MB)`)
console.log('  → App Dashboard → Instant Games → Web Hosting → Upload Version')
