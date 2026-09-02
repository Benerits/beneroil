/**
 * TRAFİK OLAY ANALİZİ — prod'daki anomali kayıtlarını çeker, kümeler, yeniden kurar.
 *
 * Veri kaynağı: benzinlik_trafficlog (istemci anomali anında snapshot gönderir:
 * tüm araç konumları + fazları + istasyon yerleşimi — bkz. main.ts trafik telemetrisi).
 * Her kayıt kendi başına yeniden kurulabilir bir hata raporudur: oyuncunun ekran
 * görüntüsü atmasına gerek kalmadan sahnesi lokalde birebir açılır.
 *
 * Kullanım:
 *   node tools/trafik-analiz.mjs                    # son 48 saatin özeti (kümeleme)
 *   node tools/trafik-analiz.mjs --saat 6           # son 6 saat
 *   node tools/trafik-analiz.mjs --replay 123       # olayı lokalde sahneye kur + SS al
 *   node tools/trafik-analiz.mjs --ornek            # sentetik fikstürle boru hattını dene
 *
 * --replay için dev sunucu gerekir: npm run dev -- --port 5399 (5311/5173 de taranır).
 */
import { execFileSync } from 'node:child_process'
import { writeFileSync, readFileSync } from 'node:fs'

const arg = (k, d = null) => { const i = process.argv.indexOf(k); return i >= 0 ? (process.argv[i + 1] ?? true) : d }
const SAAT = Number(arg('--saat', 48))
const REPLAY = arg('--replay')
const ORNEK = process.argv.includes('--ornek')

// ── prod DB erişimi: container adı SABİT DEĞİL, her seferinde bulunur (bkz. bellek notu) ──
function sqlCek(sql) {
  const ssh = (cmd) => execFileSync('ssh', ['ubuntu@5.135.142.214', cmd], { encoding: 'utf8' })
  const db = ssh("sudo -n docker ps --format '{{.Names}}' | grep '^benzinlik-db-o27xlv' | head -1").trim()
  if (!db) throw new Error('DB container bulunamadı')
  writeFileSync('/tmp/_ta.sql', sql)
  execFileSync('scp', ['-q', '/tmp/_ta.sql', 'ubuntu@5.135.142.214:/tmp/_ta.sql'])
  return ssh(`sudo -n docker exec -i ${db} psql -U benzinlik -d benzinlik -t -A -F'\t' < /tmp/_ta.sql`)
}

// ── yerleşim imzası: aynı istasyon düzeninden gelen olaylar aynı kümeye düşsün ──
// Pompa/EV slot koordinatları 2 birime yuvarlanır: milimetrik fark ayrı küme yaratmasın.
const imza = (sn) => {
  const yuvarla = (p) => `${Math.round(p[0] / 2) * 2},${Math.round(p[1] / 2) * 2}`
  const pump = (sn.slots?.pump ?? []).map(yuvarla).sort().join('|')
  const ev = (sn.slots?.ev ?? []).map(yuvarla).sort().join('|')
  return `p[${pump}] e[${ev}]`
}

const FIKSTUR = [
  { id: 1, kind: 'yigilma', created_at: 'ornek', payload: { k: 'yigilma', day: 96, loc: 'kasaba', pumps: 6, ev: 2,
    cars: [[1.8, -18, 'atPump', 3, 'fuel'], [1.9, -17.9, 'atPump', 4, 'fuel'], [1.7, -18.1, 'atPump', 5, 'fuel'], [2.0, -18, 'toPump', 6, 'fuel']],
    slots: { pump: [[1.8, -2.2], [1.8, 2.2], [1.8, -14], [1.8, -18], [1.8, -18], [1.8, -18]], ev: [] }, yapi: [] } },
  { id: 2, kind: 'yigilma', created_at: 'ornek', payload: { k: 'yigilma', day: 40, loc: 'kasaba', pumps: 6, ev: 0,
    cars: [[1.8, -18, 'atPump', 3, 'fuel'], [1.8, -17.8, 'atPump', 4, 'fuel'], [1.9, -18, 'toPump', 5, 'fuel'], [1.7, -18, 'toPump', 6, 'fuel']],
    slots: { pump: [[1.8, -2.2], [1.8, 2.2], [1.8, -14], [1.8, -18], [1.8, -18], [1.8, -18]], ev: [] }, yapi: [] } },
  { id: 3, kind: 'sikisma', created_at: 'ornek', payload: { k: 'sikisma', day: 12, loc: 'otoyol', pumps: 2, ev: 1,
    cars: [[8, 4, 'driving', -1, 'fuel']], slots: { pump: [[1.8, -2.2], [1.8, 2.2]], ev: [[1.8, 6.2]] }, yapi: [] } },
  // 'kurtarma' = bekçi bir aracı kilitten çıkardı (en ağır tür, src/cars.ts BEKCI_*).
  // Fikstürde de var ki --ornek boru hattı yeni türü kümeleme/replay ile birlikte gezsin.
  { id: 4, kind: 'kurtarma', created_at: 'ornek', payload: { k: 'kurtarma', day: 58, loc: 'kasaba', pumps: 3, ev: 0,
    cars: [[2.0, 2.3, 'toPark', -1, 'fuel'], [1.9, -0.1, 'toPark', -1, 'fuel'], [1.9, 0.1, 'leaving', -1, 'fuel']],
    slots: { pump: [[1.8, -2.2], [1.8, 2.2], [1.8, 6.2]], ev: [] }, yapi: [['parking', 0.4, -0.2, 0]] } },
]

async function olaylariGetir() {
  if (ORNEK) return FIKSTUR
  const raw = sqlCek(`SELECT id, kind, created_at, payload FROM benzinlik_trafficlog
    WHERE created_at > now() - interval '${SAAT} hours' ORDER BY id DESC LIMIT 500;`)
  return raw.split('\n').filter(Boolean).map(l => {
    const [id, kind, created_at, payload] = l.split('\t')
    try { return { id: +id, kind, created_at, payload: JSON.parse(payload) } } catch { return null }
  }).filter(Boolean)
}

// ── REPLAY: olayı lokal sahnede birebir kur ──
async function replay(olay) {
  const { chromium } = await import('playwright-core')
  const PORTLAR = ['5399', '5311', '5173', '5174']
  let PORT = null
  for (const p of PORTLAR) {
    try { if ((await fetch(`http://localhost:${p}/`, { signal: AbortSignal.timeout(1500) })).ok) { PORT = p; break } } catch { /* sıradaki */ }
  }
  if (!PORT) { console.error(`dev sunucu yok (${PORTLAR.join(',')}) — npm run dev -- --port 5399`); process.exit(1) }
  const b = await chromium.launch({ channel: 'chrome' })
  const p = await (await b.newContext({ viewport: { width: 1280, height: 960 } })).newPage()
  p.on('pageerror', e => console.error('sayfa hatası:', String(e).slice(0, 150)))
  await p.goto(`http://localhost:${PORT}/?full=1`, { waitUntil: 'domcontentloaded' })
  await p.waitForFunction(() => !!window.__dbg?.kayit?.trafikSahnesi, null, { timeout: 40000 })
  await p.evaluate(() => document.getElementById('gguest')?.dispatchEvent(new MouseEvent('click', { bubbles: true })))
  await p.waitForTimeout(2500)
  const r = await p.evaluate(sn => window.__dbg.kayit.trafikSahnesi(sn), olay.payload)
  console.log(`kuruldu: ${r.kuruldu} araç` + (r.uyumsuz?.length ? ` · uyumsuz: ${r.uyumsuz.join(',')}` : ''))
  // olayın merkezine bak: araçların ağırlık merkezi
  const cars = olay.payload.cars ?? []
  if (cars.length) {
    const cx = cars.reduce((a, c) => a + c[0], 0) / cars.length
    const cy = cars.reduce((a, c) => a + c[1], 0) / cars.length
    await p.evaluate(([x, y]) => window.__dbg.cine.setCam(x, y, 1.8), [cx, cy])
  }
  await p.waitForTimeout(900)
  const yol = `/tmp/trafik-olay-${olay.id}.png`
  await p.screenshot({ path: yol })
  console.log(`SS: ${yol}`)
  await b.close()
}

// ── ana akış ──
const olaylar = await olaylariGetir()
if (REPLAY) {
  const o = olaylar.find(x => String(x.id) === String(REPLAY)) ??
    (ORNEK ? null : (() => { const raw = sqlCek(`SELECT id, kind, created_at, payload FROM benzinlik_trafficlog WHERE id=${Number(REPLAY)};`)
      const [id, kind, created_at, payload] = raw.trim().split('\t')
      return id ? { id: +id, kind, created_at, payload: JSON.parse(payload) } : null })())
  if (!o) { console.error(`olay #${REPLAY} bulunamadı`); process.exit(1) }
  console.log(`#${o.id} · ${o.kind} · gün ${o.payload.day} · ${o.payload.loc} · ${o.payload.cars?.length ?? 0} araç`)
  await replay(o)
  process.exit(0)
}

if (!olaylar.length) { console.log(`Son ${SAAT} saatte olay yok.`); process.exit(0) }
console.log(`── SON ${ORNEK ? '(örnek fikstür)' : SAAT + ' SAAT'}: ${olaylar.length} olay ──\n`)

// tür dağılımı
const turler = {}
olaylar.forEach(o => turler[o.kind] = (turler[o.kind] || 0) + 1)
console.log('TÜR DAĞILIMI:', Object.entries(turler).sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k}=${n}`).join('  '))

// sürüm dağılımı: dağıtımdan sonra açık kalan ESKİ sekmeler yeni kodun hanesine yazılmasın
// ('?' = damgasız eski bundle). Tür × sürüm birlikte basılır ki "hangi tür hangi kodda" görülsün.
const surumler = {}
olaylar.forEach(o => { const v = o.payload.v || '?'; (surumler[v] ??= {})[o.kind] = (surumler[v][o.kind] || 0) + 1 })
console.log('SÜRÜM DAĞILIMI:', Object.entries(surumler).sort((a, b) => a[0].localeCompare(b[0]))
  .map(([v, t]) => `${v}{${Object.entries(t).map(([k, n]) => `${k}=${n}`).join(' ')}}`).join('  '))

// küme: tür × yerleşim imzası — aynı düzenden gelen olaylar tek sorundur
const kume = new Map()
for (const o of olaylar) {
  const k = `${o.kind} @ ${imza(o.payload)}`
  if (!kume.has(k)) kume.set(k, { adet: 0, ornekler: [], pompalar: o.payload.pumps, loc: o.payload.loc })
  const c = kume.get(k); c.adet++; if (c.ornekler.length < 3) c.ornekler.push(o.id)
}
console.log(`\nKÜMELER (${kume.size} farklı sorun deseni):`)
const sirali = [...kume.entries()].sort((a, b) => b[1].adet - a[1].adet)
for (const [k, v] of sirali.slice(0, 12)) {
  console.log(`  ${String(v.adet).padStart(3)}× ${k.slice(0, 96)}`)
  console.log(`       ${v.loc} · ${v.pompalar} pompa · replay: node tools/trafik-analiz.mjs --replay ${v.ornekler[0]}`)
}

// AYNI NOKTAYA YIĞILMA teşhisi: slot listesinde mükerrer koordinat var mı?
let mukerrerli = 0
for (const o of olaylar) {
  const ps = (o.payload.slots?.pump ?? []).map(p => p.join(','))
  if (new Set(ps).size < ps.length) mukerrerli++
}
if (mukerrerli) console.log(`\n⚠ ${mukerrerli}/${olaylar.length} olayda MÜKERRER pompa slotu var (aynı koordinatta ≥2 slot) — pompa-slot fixi bu popülasyonu hedefliyor.`)
