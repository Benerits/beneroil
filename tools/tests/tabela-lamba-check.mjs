/**
 * TABELA YERİNDE YÜKSELTME + SOKAK LAMBASI YOL KENARI + LAMBA DONMASI — #1282 #1286 #1287.
 *
 * #1282 "tabela seviyesi yükselttiğimizde her seferinde yeniden konumlandırmak zorunda":
 *   sign PLACEABLE'da ama inPlaceUpgrade listesinde YOKTU → her seviyede yerleştirme ekranı,
 *   hayalet (0,0)'dan başlıyordu. Fix: sign hep yerinde yükselir, açı da korunur.
 * #1286 "alınan lambalar yol kenarına konulmuyor": lamba genel (bina) yerleştirme yolundan
 *   geçiyordu → yol kenarı parsel dışı + şerit rezervleri → cx ≤ 1,45'e sıkışıyordu.
 *   Fix: dekoratif kural — sahip olunan arsa VEYA asfalt kenarındaki 1,5 birimlik bant.
 * #1287 "lamba alınınca ilk sefer uzun, sonra kısa takılma": her lamba yeni PointLight
 *   ekliyordu → sahnedeki ışık sayısı değişince three.js TÜM shader'ları yeniden derler.
 *   Fix: sabit ışık havuzu; satın alma boyunca sahnedeki ışık sayısı DEĞİŞMEZ.
 *
 * Kullanım: npx tsx tools/tests/tabela-lamba-check.mjs   (dev sunucu 5311'de çalışıyor olmalı)
 */
globalThis.localStorage = {
  _d: {}, getItem(k) { return this._d[k] ?? null },
  setItem(k, v) { this._d[k] = String(v) }, removeItem(k) { delete this._d[k] },
}
Object.defineProperty(globalThis, 'navigator', { value: { language: 'tr' }, configurable: true })
import { readFileSync } from 'node:fs'
import { chromium } from 'playwright-core'
const { GameState, serializeState } = await import('../../src/state.ts')

let hata = 0
const bekle = (k, ad, ek = '') => { console.log(`${k ? '✅' : '❌'} ${ad}${ek ? ' · ' + ek : ''}`); if (!k) hata++ }
const oku = f => readFileSync(new URL('../../' + f, import.meta.url), 'utf8')

console.log('── KOD ──')
const world = oku('src/world.ts'), main = oku('src/main.ts')
bekle(/const inPlaceUpgrade = id === 'sign'/.test(main), 'tabela yükseltmesi YERİNDE (inPlaceUpgrade)')
bekle(/if \(placedRot\[id\]\) world\.rotateBuilding\(id, placedRot\[id\]\)/.test(main), 'yerinde yükseltmede açı geri uygulanıyor')
bekle(/p\.id === 'sign' \|\| p\.id\.startsWith\('lamp'\)\) continue/.test(main), 'hardRects: lamba araç engeli değil')
bekle(/placing\.id\.startsWith\('lamp'\)\) \{/.test(main) && /const kenar = !asfalt && asfaltMesafe <= 1\.5/.test(main), 'lamba yerleştirme: dekoratif kenar kuralı')
const lampFn = world.slice(world.indexOf('buildStreetLamp(pos?'), world.indexOf('private lampPoolAl'))
bekle(!/new THREE\.PointLight/.test(lampFn) && /this\.lampPoolAl\(regId/.test(lampFn), 'buildStreetLamp yeni PointLight yaratmıyor, havuzdan alıyor')
bekle(/static readonly LAMP_POOL = 10/.test(world), 'havuz boyu 10 (6 oyuncu + 4 dekor — beton-tekrar-check)')

// ── CANLI: kasaba, tabela (3,-20) açı 1, 1 lamba kurulu ──
const kur = () => {
  const s = new GameState()
  s.money = 5_000_000; s.pumps = 2; s.marketLevel = 1; s.tankLevel = 1
  s.ownedParcels = new Set(['0,1']); s.pavedParcels = new Set(['0,1'])
  s.tutorialDone = true; s.signLevel = 0; s.lampCount = 1
  const placedPos = { sign: [3, -20], lamp: [-4, 8], tank: [-5, -8], gatein: [4.2, -9], market: [-2, -2], office: [-1, 7], gateout: [4.2, 13] }
  const placedRects = [
    { id: 'tank', cx: -5, cy: -8, w: 2, d: 2 }, { id: 'office', cx: -1, cy: 7, w: 5, d: 5.5 },
    { id: 'sign', cx: 3, cy: -20, w: 1.8, d: 1.8 }, { id: 'market', cx: -2, cy: -2, w: 6, d: 7 },
    { id: 'lamp', cx: -4, cy: 8, w: 1.2, d: 1.2 },
  ]
  return JSON.stringify({ s: serializeState(s), at: Date.now(), placedPos, placedRot: { sign: 1 }, placedRects })
}
const PORT = process.env.PORT ?? '5311'
const b = await chromium.launch({ channel: 'chrome' })
const ctx = await b.newContext({ viewport: { width: 1280, height: 800 } })
const p = await ctx.newPage()
const hatalar = []
p.on('pageerror', e => hatalar.push(String(e).slice(0, 200)))
await p.addInitScript(({ payload }) => {
  localStorage.setItem('benzinlik-guest', payload)
  localStorage.setItem('benzinlik-guest-joined', '1')
  localStorage.setItem('benzinlik-music', '0')
}, { payload: kur() })
const hazir = async () => {
  for (let i = 0; i < 20; i++) {
    const ok = await p.evaluate(() => {
      document.getElementById('gguest')?.click()
      document.querySelectorAll('.backdrop.show').forEach(x => x.classList.remove('show'))
      const g = document.getElementById('authgate')
      return (!g || getComputedStyle(g).display === 'none') && typeof window.__dbg === 'object' && window.__dbg.state.lampCount === 1
    }).catch(() => false)
    if (ok) return true
    await p.waitForTimeout(800)
  }
  return false
}
await p.goto(`http://localhost:${PORT}/`, { waitUntil: 'domcontentloaded' })
await p.waitForTimeout(7000)
bekle(await hazir(), 'kayıt misafir olarak açıldı')
await p.waitForTimeout(1500)

console.log('\n── CANLI 1: tabela yükseltmesi yerinde, açı korunur, yerleştirme ekranı yok ──')
const tabela = await p.evaluate(() => {
  const d = window.__dbg
  const once = d.place.real('sign')
  d.ui.onBuy('sign')
  const placing = d.place.ghost() !== null
  const sonra = d.place.real('sign')
  d.ui.onBuy('sign')
  const sonra2 = d.place.real('sign')
  return { once, sonra, sonra2, placing, level: d.state.signLevel }
})
bekle(tabela.level === 2, 'iki yükseltme sonrası seviye 2', `${tabela.level}`)
bekle(!tabela.placing, 'yerleştirme moduna DÜŞMEDİ')
bekle(tabela.sonra && Math.abs(tabela.sonra.bx - 3) < 0.01 && Math.abs(tabela.sonra.by + 20) < 0.01, 'tabela (3,−20)’de kaldı', JSON.stringify(tabela.sonra))
bekle(tabela.sonra2 && Math.abs(tabela.sonra2.rz - Math.PI / 2) < 0.01, 'açı (90°) korundu', `${tabela.sonra2?.rz.toFixed(3)}`)

console.log('\n── CANLI 2: lamba yol kenarına konabiliyor, asfalta konamıyor, sahipsiz arsaya konamıyor ──')
const lamba = await p.evaluate(() => {
  const d = window.__dbg
  d.place.start('lamp#1')
  const dene = (x, y) => { d.place.at(x, y); const g = d.place.ghost(); return { x: g.cx, y: g.cy, ok: g.valid } }
  const r = {
    kenar: dene(5, 3), kenarGuney: dene(5, -20), asfalt: dene(7.5, 3), karsiKenar: dene(11, 3),
    sahipsizBati: dene(-15, 3), sahipsizKarsi: dene(15, 3), arsaIci: dene(-6, 3), binaUstu: dene(-2, -2),
  }
  d.place.cancel()
  return r
})
bekle(lamba.kenar.ok, 'yol kenarı (5,3) GEÇERLİ — eskiden kırmızıydı', JSON.stringify(lamba.kenar))
bekle(lamba.kenarGuney.ok, 'yol kenarı güneyde de geçerli', JSON.stringify(lamba.kenarGuney))
bekle(!lamba.asfalt.ok, 'asfalt (7.5,3) RED', JSON.stringify(lamba.asfalt))
bekle(lamba.karsiKenar.ok, 'karşı yol kenarı (11,3) geçerli', JSON.stringify(lamba.karsiKenar))
bekle(!lamba.sahipsizBati.ok && !lamba.sahipsizKarsi.ok, 'sahipsiz arsa (batı/karşı) RED')
bekle(lamba.arsaIci.ok, 'kendi arsasında boş kare geçerli (eski davranış korundu)', JSON.stringify(lamba.arsaIci))
bekle(!lamba.binaUstu.ok, 'market üstü RED', JSON.stringify(lamba.binaUstu))

console.log('\n── CANLI 3: lamba satın alma boyunca sahnedeki ışık SAYISI değişmiyor (shader derlemesi yok) ──')
const isik = await p.evaluate(() => {
  const d = window.__dbg
  const say = () => { let n = 0; d.world.scene.traverse(o => { if (o.isPointLight) n++ }); return n }
  const seri = [say()]
  for (let i = 1; i <= 3; i++) {
    d.ui.onBuy('lamp')           // yerleştirme ekranı (önizleme kurar)
    seri.push(say())
    d.place.at(5, -6 + i * 4)    // yol kenarı
    d.place.confirm()
    seri.push(say())
  }
  const havuz = d.world.lampPoolDurum()
  return { seri, havuz, lampCount: d.state.lampCount }
})
bekle(isik.lampCount === 4, '3 lamba daha alındı (toplam 4)', `${isik.lampCount}`)
bekle(isik.seri.every(n => n === isik.seri[0]), 'ışık sayısı satın alma boyunca SABİT', isik.seri.join('→'))
const oyuncu = h => h.filter(x => x && x.startsWith('lamp'))
bekle(oyuncu(isik.havuz).length === 4 && new Set(oyuncu(isik.havuz)).size === 4, 'havuzda 4 oyuncu lambası, her biri farklı sahip (dekor lambalar ayrı)', JSON.stringify(isik.havuz))

console.log('\n── CANLI 4: taşıma + satış ışığı serbest bırakır; yeniden yükleme aynı sayıyı verir ──')
const tasi = await p.evaluate(() => {
  const d = window.__dbg
  const say = () => { let n = 0; d.world.scene.traverse(o => { if (o.isPointLight) n++ }); return n }
  const n0 = say()
  d.place.start('lamp#1', true); d.place.at(5, 10); d.place.confirm()
  const n1 = say()
  const h1 = d.world.lampPoolDurum()
  d.kayit.yukle(d.kayit.yuk())
  const n2 = say()
  const h2 = d.world.lampPoolDurum()
  return { n0, n1, n2, h1, h2 }
})
bekle(tasi.n0 === tasi.n1 && tasi.n1 === tasi.n2, 'taşıma + reload sonrası ışık sayısı sabit', `${tasi.n0}/${tasi.n1}/${tasi.n2}`)
bekle(oyuncu(tasi.h1).length === 4 && oyuncu(tasi.h2).length === 4, 'havuz taşıma ve reload sonrası 4 oyuncu lambası', JSON.stringify(tasi.h2))

bekle(hatalar.length === 0, 'sayfa hatası yok', hatalar.join(' | '))
await b.close()
console.log(hata ? `\n❌ ${hata} kontrol düştü` : '\n✅ tabela/lamba kontrolleri geçti')
process.exit(hata ? 1 : 0)
