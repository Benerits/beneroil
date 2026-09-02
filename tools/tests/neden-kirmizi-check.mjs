/**
 * "NEDEN KIRMIZI?" — #1228 #1230 #1285 #1295 (dört oyuncu, 29–31 Ağu).
 *
 * ŞİKÂYET: "betonlu alana koymama rağmen köşelere konmuyor", "karşı petrolde yatay alana
 * hiçbir şey koyamıyorum", "karşı binalar sağa yapılmıyor", "boş alanı kullanamıyorum".
 * ÖLÇÜM: temiz 18-parsel kayıtta karşı yaka yerleşimi yakınla SİMETRİK açık (far-scan) —
 * yani kural değil, GERİ BİLDİRİM sorunu: ✓'ya basınca tek cümle çıkıyordu ("sahipli ve
 * betonlu alana koy"), oysa gerçek sebep şerit rezervi / taşan köşe / komşu yapıydı.
 * FIX: yerlesimNedeni() reddeden kuralı adıyla söyler; iki onay yolu da onu kullanır.
 *
 * Kullanım: npx tsx tools/tests/neden-kirmizi-check.mjs   (dev sunucu 5311'de çalışıyor olmalı)
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
const main = oku('src/main.ts')
bekle(/^function yerlesimNedeni\(\): string/m.test(main), 'yerlesimNedeni() var')
bekle((main.match(/else ui\.toast\(yerlesimNedeni\(\), 'bad'\)/g) || []).length === 2, 'iki onay yolu da (✓ butonu + dokunuş) sebebi söylüyor')
bekle(!/Buraya yerleştiremezsin — sahipli ve betonlu alana koy\./.test(main), 'eski genel "sahipli ve betonlu" cümlesi kalktı')

// ── CANLI: kasaba, 18 parsel sahipli; 0,0 ve 5,0 BETONSUZ, 5,2 SAHİPSİZ; karşı istasyon açık ──
const kur = () => {
  const s = new GameState()
  s.money = 5_000_000_000; s.pumps = 3; s.marketLevel = 1; s.tankLevel = 1; s.day = 90
  const all = []; for (let c = 0; c < 6; c++) for (let r = 0; r < 3; r++) all.push(`${c},${r}`)
  s.ownedParcels = new Set(all.filter(k => k !== '5,2'))
  s.pavedParcels = new Set(all.filter(k => k !== '5,2' && k !== '0,0' && k !== '5,0'))
  s.tutorialDone = true; s.farStationOn = true
  const placedPos = { sign: [3, -20], tank: [-5, -8], gatein: [4.2, -9], market: [-2, -2], office: [-1, 7], gateout: [4.2, 13],
    'pump-0': [-2, -14], 'pump-1': [-2, 14], 'pump-2': [20, 2], gatein2: [11.6, 18], gateout2: [11.6, -20] }
  const placedRects = [
    { id: 'tank', cx: -5, cy: -8, w: 2, d: 2 }, { id: 'office', cx: -1, cy: 7, w: 5, d: 5.5 },
    { id: 'sign', cx: 3, cy: -20, w: 1.8, d: 1.8 }, { id: 'market', cx: -2, cy: -2, w: 6, d: 7 },
    { id: 'pump-0', cx: -2, cy: -14, w: 4.4, d: 4 }, { id: 'pump-1', cx: -2, cy: 14, w: 4.4, d: 4 }, { id: 'pump-2', cx: 20, cy: 2, w: 4.4, d: 4 },
  ]
  return JSON.stringify({ s: serializeState(s), at: Date.now(), placedPos, placedRot: {}, placedRects })
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
      return (!g || getComputedStyle(g).display === 'none') && typeof window.__dbg === 'object' && window.__dbg.state.day === 90
    }).catch(() => false)
    if (ok) return true
    await p.waitForTimeout(800)
  }
  return false
}
await p.goto(`http://localhost:${PORT}/`, { waitUntil: 'domcontentloaded' })
await p.waitForTimeout(7000)
bekle(await hazir(), 'kayıt misafir olarak açıldı')
await p.waitForTimeout(2000)

console.log('\n── CANLI: karşı yakada hava-su — her kırmızı için AYRI sebep ──')
const r = await p.evaluate(() => {
  const d = window.__dbg
  const dene = (x, y, rot = 0) => {
    d.place.start('airwater'); d.place.rot(rot); d.place.at(x, y)
    const g = d.place.ghost()
    document.getElementById('mv-ok').click()
    const son = d.ui.inbox[d.ui.inbox.length - 1]?.text ?? ''
    const kuruldu = !d.place.ghost() // geçerliyse onaylanıp mod kapanır
    if (!kuruldu) d.place.cancel()
    return { valid: g.valid, kuruldu, msg: son }
  }
  return {
    acik: dene(30, 5),               // karşı yaka, betonlu, boş → KURULUR
    serit: dene(14, -5),             // karşı gelen omurga (x 13–15) → şerit sebebi
    sinir: dene(45, 5),              // 5,1 parseli doğu sınırı 45,4 → köşe dışarı
    sahipsiz: dene(40, 12),          // 5,2 sahipsiz (y ≥ 10)
    betonsuz: dene(40, -12),         // 5,0 betonsuz (y ≤ −10)
    yapi: dene(20, 2),               // pump-2 üstü
  }
})
bekle(r.acik.valid && r.acik.kuruldu, 'karşı yaka (30,5) betonlu boş → hava-su KURULDU', r.acik.msg)
bekle(!r.serit.valid && /turuncu araç şeridine/.test(r.serit.msg), 'gelen omurga üstü → "araç şeridi" sebebi', r.serit.msg)
bekle(!r.sinir.valid && /arsa sınırının dışına/.test(r.sinir.msg), 'doğu sınırından taşan köşe → "arsa sınırı" sebebi (#1228 köşe)', r.sinir.msg)
bekle(!r.sahipsiz.valid && /SAHİPSİZ/.test(r.sahipsiz.msg), 'sahipsiz 5,2 → "satın al" sebebi (#1285 sağa yapılmıyor)', r.sahipsiz.msg)
bekle(!r.betonsuz.valid && /BETONSUZ/.test(r.betonsuz.msg), 'betonsuz 5,0 → "betonla" sebebi', r.betonsuz.msg)
bekle(!r.yapi.valid && /ile çakışıyor/.test(r.yapi.msg), 'pompa üstü → yapı adıyla çakışma sebebi', r.yapi.msg)

bekle(hatalar.length === 0, 'sayfa hatası yok', hatalar.join(' | '))
await b.close()
console.log(hata ? `\n❌ ${hata} kontrol düştü` : '\n✅ neden-kırmızı kontrolleri geçti')
process.exit(hata ? 1 : 0)
