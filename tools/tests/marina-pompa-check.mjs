/**
 * MARİNA İSKELE POMPASI YERİ — #1280 #1298 #1301 #1303 #1307 (beş oyuncu, 29 Ağu–2 Eyl).
 *
 * ŞİKÂYET: "3. pompayı koyacak yer bulamıyor / hep kırmızı / where can I plant a dock pump".
 * GERÇEK KAYITLA (fuse.tea.lime, 2 pompa, 70 bağlama yeri) ÖLÇÜLDÜ: `pump-2` için 0..3
 * açıda 0 geçerli nokta. Kök: 3./4. pompa KARA yuva tablosundan (y −14/−18 = güney
 * parsel, marinada satın alınmaz) okunuyordu → `defaultSlotFree` "dolu" deyip oyuncuyu
 * 4,4×4'lük KARA yerleşimine düşürüyordu; tek parsel + market 6×7 + ofis + tank + tuvalet
 * + şerit rezervleri + kara şerit ağına bakan erişilebilirlik testi hiçbir kare bırakmıyordu.
 *
 * FIX: marinada pompa rıhtım yuvasına OTOMATİK kurulur (MARINA_PUMP_Y ±2.2/±6.6, x 4.0),
 * elle yerleştirmede rıhtım pompası suya taşabilir, şerit/erişim testleri atlanır.
 *
 * Kullanım: npx tsx tools/tests/marina-pompa-check.mjs   (dev sunucu 5311'de çalışıyor olmalı)
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

console.log('── KOD: marina rıhtım yuvaları ──')
const world = oku('src/world.ts'), main = oku('src/main.ts')
bekle(/export const MARINA_PUMP_Y = \[-2\.2, 2\.2, -6\.6, 6\.6\]/.test(world), 'MARINA_PUMP_Y: ilk ikisi eski değerler, 3./4. ±6.6')
bekle(/MARINA_PUMP_Y\[index\] \?\? dv\.y/.test(world), 'addPump su varsayılanı marina tablosundan okuyor')
bekle(/if \(kind === 'pump' && state\.isMarina\) return marinaRihtimBos\(i\)/.test(main), 'defaultSlotFree marinada rıhtım yuvasına bakıyor')
bekle(/const rihtim = state\.isMarina && skipId\.startsWith\('pump-'\)/.test(main)
  && /!\(rihtim && o\.lane\)/.test(main) && /!rihtim && \(skipId\.startsWith\('pump-'\)/.test(main),
  'isValidPlacement: rıhtım pompasında şerit rezervi + erişim testi atlanıyor')

// ── CANLI: gerçek raporlardaki yerleşimin eşdeğeri (tek parsel, market+ofis+tuvalet+tank, 2 pompa) ──
const kur = () => {
  const s = new GameState()
  s.unlockedLocs = ['kasaba', 'marina']
  s.activeLoc = 'marina'
  s.money = 50_000_000
  s.pumps = 2
  s.marketLevel = 2; s.toiletLevel = 1; s.tankLevel = 2
  s.marinaFacs = ['fueldock', 'chandlery', 'clubhouse', 'shower', 'travelift', 'icebait', 'pumpout', 'wasteoil', 'boom']
  s.berths = { buoy: 15, mega: 10, karsi: 15, finger8: 10, finger12: 10, finger18: 10 }
  s.ownedParcels = new Set(['0,1']); s.pavedParcels = new Set(['0,1'])
  s.tutorialDone = true
  const placedPos = { sign: [3, -23], tank: [-5, -8], gatein: [4.2, -9], market: [-2, -2], office: [-1, 7], toilet: [0, -8], gateout: [4.2, 13] }
  const placedRects = [
    { id: 'tank', cx: -5, cy: -8, w: 2, d: 2 }, { id: 'office', cx: -1, cy: 7, w: 5, d: 5.5 },
    { id: 'sign', cx: 3, cy: -23, w: 1.8, d: 1.8 }, { id: 'toilet', cx: 0, cy: -8, w: 3, d: 4 },
    { id: 'market', cx: -2, cy: -2, w: 6, d: 7 },
  ]
  return JSON.stringify({ s: serializeState(s), at: Date.now(), placedPos, placedRot: {}, placedRects })
}
const payload = kur()
const PORT = process.env.PORT ?? '5311'
const b = await chromium.launch({ channel: 'chrome' })
const ctx = await b.newContext({ viewport: { width: 1280, height: 800 } })
const p = await ctx.newPage()
const hatalar = []
p.on('pageerror', e => hatalar.push(String(e).slice(0, 200)))
await p.addInitScript(({ payload }) => {
  localStorage.setItem('benzinlik-guest', payload)
  localStorage.setItem('benzinlik-guest-joined', '1')
  localStorage.setItem('beneloil-loc', 'marina')
  localStorage.setItem('benzinlik-music', '0')
}, { payload })
const hazir = async () => {
  for (let i = 0; i < 20; i++) {
    const ok = await p.evaluate(() => {
      document.getElementById('gguest')?.click()
      document.querySelectorAll('.backdrop.show').forEach(x => x.classList.remove('show'))
      const g = document.getElementById('authgate')
      return (!g || getComputedStyle(g).display === 'none') && typeof window.__dbg === 'object' && window.__dbg.state.isMarina
    }).catch(() => false)
    if (ok) return true
    await p.waitForTimeout(800)
  }
  return false
}
await p.goto(`http://localhost:${PORT}/`, { waitUntil: 'domcontentloaded' })
await p.waitForTimeout(7000)
bekle(await hazir(), 'marina şubesi misafir kaydıyla açıldı')
await p.waitForTimeout(1500)

console.log('\n── CANLI 1: elle yerleştirme rıhtımda GEÇERLİ kare buluyor ──')
const elle = await p.evaluate(() => {
  const d = window.__dbg; const id = `pump-${d.state.pumps}`
  d.place.start(id)
  const gecerli = []
  for (let rot = 0; rot < 4; rot++) {
    d.place.rot(rot)
    for (let x = -8; x <= 8; x += 1) for (let y = -12; y <= 12; y += 1) {
      d.place.at(x, y); const g = d.place.ghost()
      if (g && g.valid) gecerli.push([rot, x, y])
    }
  }
  d.place.cancel()
  return { id, n: gecerli.length, rihtim: gecerli.filter(([, x]) => x >= 3).length, ornek: gecerli.slice(0, 6) }
})
bekle(elle.n > 0, `${elle.id} için en az bir geçerli kare var (eskiden 0)`, `${elle.n} kare, örnek ${JSON.stringify(elle.ornek)}`)
bekle(elle.rihtim > 0, 'geçerli karelerin bir kısmı RIHTIMDA (x ≥ 3)', `${elle.rihtim}`)

console.log('\n── CANLI 2: mağazadan alım rıhtım yuvasına OTOMATİK kurar (yerleştirme ekranı yok) ──')
const alim = await p.evaluate(() => {
  const d = window.__dbg; const s = d.state
  const once = s.pumps
  d.ui.onBuy('pump')
  const placing = d.place.ghost() !== null // yerleştirme modunda hayalet olurdu
  const b2 = d.world.pumpBase[once], sl2 = d.world.pumpSlots[once]
  const ikinci = { once: s.pumps }
  d.ui.onBuy('pump')
  const b3 = d.world.pumpBase[once + 1], sl3 = d.world.pumpSlots[once + 1]
  const ucuncu = s.pumps
  d.ui.onBuy('pump') // tavan 4: alınmamalı
  return { once, sonra: ikinci.once, ucuncu, tavan: s.pumps, placing,
    b2: b2 && [b2.x, b2.y], sl2: sl2 && [sl2.x, sl2.y], b3: b3 && [b3.x, b3.y], sl3: sl3 && [sl3.x, sl3.y],
    binalar: d.world.buildings.map(x => x.id).filter(x => x.startsWith('pump')) }
})
bekle(alim.once === 2 && alim.sonra === 3, '3. pompa tek tıkla kuruldu', `${alim.once}→${alim.sonra}, placing=${alim.placing}`)
bekle(!alim.placing, 'yerleştirme moduna düşmedi')
bekle(alim.b2 && Math.abs(alim.b2[0] - 4.0) < 0.01 && Math.abs(alim.b2[1] + 6.6) < 0.01, 'pump-2 gövdesi rıhtımda (4.0, −6.6)', JSON.stringify(alim.b2))
bekle(alim.sl2 && alim.sl2[0] >= 6.6 - 1e-6, 'pump-2 tekne yuvası SUDA (x ≥ 6.6)', JSON.stringify(alim.sl2))
bekle(alim.ucuncu === 4, '4. pompa da kuruldu', `${alim.ucuncu}`)
bekle(alim.b3 && Math.abs(alim.b3[0] - 4.0) < 0.01 && Math.abs(alim.b3[1] - 6.6) < 0.01, 'pump-3 gövdesi rıhtımda (4.0, 6.6)', JSON.stringify(alim.b3))
bekle(alim.tavan === 4, 'tavan 4 korunuyor (5. alınmadı)', `${alim.tavan}`)

console.log('\n── CANLI 3: yeniden yükleme aynı yerlere kurar (placedPos olmadan da) ──')
const tekrar = await p.evaluate(() => {
  const d = window.__dbg
  const yuk = d.kayit.yuk()
  d.kayit.yukle(yuk)
  const s = d.state
  const b = i => d.world.pumpBase[i], sl = i => d.world.pumpSlots[i]
  const mesafe = []
  for (let i = 0; i < s.pumps; i++) for (let j = i + 1; j < s.pumps; j++)
    mesafe.push(Math.hypot(sl(i).x - sl(j).x, sl(i).y - sl(j).y))
  return { pumps: s.pumps, base: [0, 1, 2, 3].map(i => b(i) && [+b(i).x.toFixed(2), +b(i).y.toFixed(2)]),
    enYakin: Math.min(...mesafe), placedPump: Object.keys(yuk.placedPos ?? {}).filter(k => k.startsWith('pump')) }
})
bekle(tekrar.pumps === 4, 'reload sonrası 4 pompa', `${tekrar.pumps}`)
bekle(JSON.stringify(tekrar.base) === JSON.stringify([[4, -2.2], [4, 2.2], [4, -6.6], [4, 6.6]]),
  'dört gövde de rıhtım hattında, eski iki pompa YERİNDEN OYNAMADI', JSON.stringify(tekrar.base))
bekle(tekrar.enYakin >= 2.8, 'tekne yuvaları ayrışma eşiğinin (2.8) üstünde', tekrar.enYakin.toFixed(2))

bekle(hatalar.length === 0, 'sayfa hatası yok', hatalar.join(' | '))
await b.close()
console.log(hata ? `\n❌ ${hata} kontrol düştü` : '\n✅ marina pompa kontrolleri geçti')
process.exit(hata ? 1 : 0)
