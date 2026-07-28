// ŞUBE ↔ SUNUCU SERVET TUTARLILIĞI: şube geçişinde toplam servet SABİT kalmalı,
// yoksa anti-cheat (buildingValue + snapshotsValue) 409/para kırpma üretir.
// Sunucu fonksiyonlarının aynısını burada uygular (SYNC: server/index.js COST/FLAT).
globalThis.localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} }
Object.defineProperty(globalThis, 'navigator', { value: { language: 'tr' }, configurable: true })
const { GameState, serializeState, hydrateState } = await import('../../src/state.ts')
const fs = await import('node:fs')

// sunucu servet fonksiyonlarını server/index.js'ten AYNEN çalıştır (kopya sürüklenmesi olmasın)
const src = fs.readFileSync(new URL('../../server/index.js', import.meta.url), 'utf8')
// clamp'ten başlanır: clampMarina ona bağımlı (COST'tan başlayınca ReferenceError verirdi)
const block = src.slice(src.indexOf('const clamp = '), src.indexOf('function sanitizeSave'))
const fn = new Function(block + '; return { buildingValue, snapshotsValue, marinaValue, clampMarina }')()
const { buildingValue, snapshotsValue, marinaValue, clampMarina } = fn
const wealth = ser => (Number(ser.money) || 0) + buildingValue(ser) + snapshotsValue(ser)

let pass = 0, fail = 0
const check = (n, c, d = '') => { if (c) { pass++; console.log('  ✓ ' + n) } else { fail++; console.log(`  ✗ ${n}${d ? ' — ' + d : ''}`) } }

const layout = () => ({ placedPos: {}, placedRot: {}, placedRects: [] })
const s = new GameState()
s.money = 400_000; s.brandStars = 2; s.day = 80
s.pumps = 6; s.marketLevel = 3; s.hasSMR = true; s.tankLevel = 3; s.evChargers = 4
s.ownedParcels = new Set(['0,0', '1,1', '2,1']); s.pavedParcels = new Set(['0,0', '1,1'])
const w0 = wealth(serializeState(s))
console.log(`başlangıç servet: ₺${Math.round(w0).toLocaleString('tr-TR')}`)

s.unlockedLocs.push('cevreyolu')
s.switchLoc('cevreyolu', layout())
const w1 = wealth(serializeState(s))
// İLK kez açılan şube: başlangıç arsası (+₺7.000) + D12 İLK-ŞUBE HEDİYESİ
// (Müdür Sv.1 = ₺18.000 kurulum değeri, TEK SEFER) = ≤ ₺26.000 — sunucu
// allowance'ının (≈100k) hâlâ çok altında. Ekipman devri birebir korunur.
check(`ilk şube geçişinde arsa + tek seferlik müdür hediyesi eklenir (₺${Math.round(w1 - w0)})`,
  w1 - w0 >= 0 && w1 - w0 <= 26_000, `${Math.round(w1)} vs ${Math.round(w0)}`)

// yeni şubede yatırım yap — GERÇEK maliyetle (pompa 2:5000 + 3:8000, tabela 1:1500 + 2:4000)
s.money -= 18_500; s.pumps = 3; s.signLevel = 2
const w2 = wealth(serializeState(s))
check('yeni şubede yatırım SERVET-NÖTR (para↓ = bina↑)', Math.abs(w2 - w1) < 1, `${Math.round(w2)} vs ${Math.round(w1)}`)

// geri dön — ÇİFT SAYIM olmamalı
s.switchLoc('kasaba', layout())
const w3 = wealth(serializeState(s))
check(`geri dönüşte servet sabit — çift sayım YOK (${Math.round(w3)} vs ${Math.round(w2)})`, Math.abs(w3 - w2) < 1)

// save round-trip sonrası da sabit
const d = new GameState(); hydrateState(d, serializeState(s))
const w4 = wealth(serializeState(d))
check(`save round-trip sonrası servet sabit (${Math.round(w4)})`, Math.abs(w4 - w3) < 1)

// 5 şube dolu senaryosu: her geçişte sabit mi
const m = new GameState(); m.money = 5_000_000; m.brandStars = 20
m.unlockedLocs = ['kasaba', 'cevreyolu', 'otoyol', 'marina', 'metropol']
const seen = new Set(['kasaba'])
let firstOpenJump = 0, repeatOk = true
for (const loc of ['cevreyolu', 'otoyol', 'marina', 'metropol', 'kasaba', 'otoyol', 'cevreyolu']) {
  m.pumps = 5; m.marketLevel = 2
  const before = wealth(serializeState(m))
  m.switchLoc(loc, layout())
  const after = wealth(serializeState(m))
  const diff = after - before
  if (!seen.has(loc)) { seen.add(loc); firstOpenJump = Math.max(firstOpenJump, Math.abs(diff)) }
  else if (Math.abs(diff) > 1) { repeatOk = false; console.log(`     ${loc} (tekrar): ${Math.round(before)} → ${Math.round(after)}`) }
}
check(`ilk açılışta artış küçük (arsa + D12 müdür hediyesi, ₺${Math.round(firstOpenJump)} ≤ 26k → allowance içinde)`, firstOpenJump <= 26_000)
check('DAHA ÖNCE görülen şubeye geçişte servet SABİT (çift sayım yok)', repeatOk)

// şube açma: servet DÜŞER (sink) ama regresyon guard'ını tetiklemez (fresh-start değil)
const u = new GameState(); u.money = 700_000; u.brandStars = 3; u.pumps = 5; u.marketLevel = 2; u.day = 60
const wu0 = wealth(serializeState(u))
u.unlockLoc('cevreyolu')
const wu1 = wealth(serializeState(u))
check(`şube açma serveti 500k düşürür (sink): ${Math.round(wu0 - wu1)}`, Math.abs((wu0 - wu1) - 500_000) < 1)
check('şube açtıktan sonra ekipman AYNEN durur (fresh-start guard tetiklenmez)', u.pumps === 5 && u.marketLevel === 2)

// ---- MARİNA: istemci ve sunucu AYNI değeri hesaplamalı, yoksa yatırım 409 üretir ----
console.log('\n-- Marina istemci/sunucu senkronu --')
{
  const m = new GameState()
  m.unlockedLocs.push('marina')
  m.switchLoc('marina', layout())
  m.money = 3_000_000
  m.marinaFacs = ['fueldock', 'pumpout', 'wasteoil', 'boom', 'travelift', 'shower']
  m.berths = { finger12: 8, finger18: 3, mega: 1 }
  m.winterSlots = 24
  const ser = serializeState(m)
  const cli = m.marinaValue()
  const srv = marinaValue(ser)
  check(`istemci ₺${cli.toLocaleString('tr-TR')} = sunucu ₺${srv.toLocaleString('tr-TR')}`, cli === srv,
    'src/marina.ts ile server/index.js maliyet tabloları AYRIŞMIŞ')
  check('marina yatırımı sunucu servetine giriyor (409 olmaz)', buildingValue(ser) >= srv)

  // UYDURMA anahtarla servet şişirme kapalı olmalı
  const hack = { marinaFacs: ['fueldock', 'sahte_tesis', 'altin_iskele'], berths: { mega: 5, sahte: 999 }, winterSlots: 99999 }
  const before = marinaValue(hack)
  clampMarina(hack)
  const after = marinaValue(hack)
  check('bilinmeyen tesis anahtarı ATILIR', !hack.marinaFacs.includes('sahte_tesis'))
  check('bilinmeyen bağlama anahtarı ATILIR', !('sahte' in hack.berths))
  check(`abuse tavanı uygulanır (₺${before.toLocaleString('tr-TR')} → ₺${after.toLocaleString('tr-TR')})`, after < before)
  check('meşru tesis KORUNUR (aşırı temizlik yok)', hack.marinaFacs.includes('fueldock') && hack.berths.mega === 5)

  // şube geçişinde marina serveti KAYBOLMAZ (locSnapshots yolu)
  const w1 = wealth(serializeState(m))
  m.switchLoc('kasaba', layout())
  const w2 = wealth(serializeState(m))
  check(`marinadan çıkınca servet SABİT (₺${Math.round(w1).toLocaleString('tr-TR')} → ₺${Math.round(w2).toLocaleString('tr-TR')})`,
    Math.abs(w1 - w2) < 1)
  m.switchLoc('marina', layout())
  const w3 = wealth(serializeState(m))
  check('marinaya dönünce de sabit (çifte sayım yok)', Math.abs(w1 - w3) < 1)
  check('dönünce tesisler AYNEN duruyor', m.marinaFacs.length === 6 && m.berths.finger12 === 8 && m.winterSlots === 24)
}

// ---- BATARYA: istemci/sunucu maliyet senkronu (ayrışma = 409) ----
console.log('\n-- Batarya kademeleri --')
{
  const { BATTERY_CAP } = await import('../../src/state.ts')
  // sunucu COST tablosunu kaynaktan çıkar
  const srvCost = JSON.parse('[' + (src.match(/battery:\s*\[([^\]]+)\]/) || [])[1] + ']')
  const cliCost = JSON.parse('[' + (fs.readFileSync(new URL('../../src/state.ts', import.meta.url), 'utf8')
    .match(/const BATTERY_COSTS = \[([^\]]+)\]/) || [])[1] + ']')
  check(`istemci ve sunucu batarya maliyetleri AYNI (${cliCost.length} kademe)`,
    JSON.stringify(cliCost) === JSON.stringify(srvCost), `istemci ${cliCost} · sunucu ${srvCost}`)
  check('her kademenin bir kapasitesi var', BATTERY_CAP.length === cliCost.length + 1)
  // sunucu clamp'i en yüksek kademeyi ve kapasiteyi KABUL etmeli
  const maxLvl = cliCost.length
  const lvlClamp = +(src.match(/s\.batteryLevel = clamp\(s\.batteryLevel, 0, (\d+)/) || [])[1]
  const capClamp = +(src.match(/s\.battery = clamp\(s\.battery, 0, (\d+)/) || [])[1]
  check(`sunucu clamp'i en yüksek kademeyi kesmiyor (${lvlClamp} ≥ ${maxLvl})`, lvlClamp >= maxLvl)
  check(`sunucu clamp'i en yüksek kapasiteyi kesmiyor (${capClamp} ≥ ${BATTERY_CAP[maxLvl]})`,
    capClamp >= BATTERY_CAP[maxLvl])
  // şube anlık görüntüsünde de aynı sınırlar olmalı (yoksa şube değişince depo kırpılır)
  check('şube anlık görüntüsünde de aynı clamp',
    /f\.batteryLevel = clamp\(f\.batteryLevel, 0, 6/.test(src) && /f\.battery = clamp\(f\.battery, 0, 4500/.test(src))
  // kWh başına maliyet ARTMALI — yoksa sonsuz depo sömürüsü olur
  const perKwh = cliCost.map((c, i) => c / (BATTERY_CAP[i + 1] - BATTERY_CAP[i]))
  check(`en üst kademe kWh başına EN PAHALI (${perKwh[0].toFixed(0)} → ${perKwh.at(-1).toFixed(0)} ₺/kWh)`,
    perKwh.at(-1) > perKwh[0])
  // ekipman değeri: istemci ve sunucu aynı serveti görmeli
  const g = new GameState(); g.money = 1e9; g.gridLevel = 2
  g.batteryLevel = maxLvl
  const ser = serializeState(g)
  const cliVal = g.equipmentValue()
  check('en yüksek batarya SUNUCU servetine de giriyor', buildingValue(ser) > 0 && cliVal > 0)
}

console.log(`\nSONUÇ: ${pass} geçti, ${fail} kaldı`)
process.exit(fail ? 1 : 0)
